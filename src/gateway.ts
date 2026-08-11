import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { loadGatewayConfig, type GatewayConfig } from './config.js';
import { currentUser, CmdbuildApiError, forwardedTokenFingerprint, readDemoCards, updateDemoCard } from './cmdbuild.js';
import { hostAllowed, json, readJson, text } from './http.js';
import { authorizationHeader, canWrite, TokenValidationError, validateUserToken, type Principal } from './identity.js';
import { assertLogSinkHealthy, fingerprint, Logger, logSinkReady } from './logger.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  subject: string;
  tokenFingerprint: string;
  lastSeenAt: number;
}

const mcpSessions = new Map<string, McpSession>();
const MCP_SESSION_TTL_MS = 30 * 60_000;

function result(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function failure(code: string, status?: number): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: code, ...(status ? { status } : {}) }) }], isError: true };
}

function buildMcpServer(config: GatewayConfig, principal: Principal, logger: Logger): McpServer {
  const server = new McpServer(
    { name: 'cmdbuild-oidc-tf-cmdbuild-gateway', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );

  server.registerTool(
    'cmdbuild_whoami',
    {
      title: 'CMDBuild current user',
      description: 'Forwards the current OpenWebUI OAuth access token to CMDBuild and returns its current-session result. No service account is used.'
    },
    async () => {
      try {
        const response = await currentUser(config, principal.token);
        logger.info('cmdbuild.whoami.success', {
          subject_hash: fingerprint(principal.subject),
          role: principal.role,
          forwarded_credential_fingerprint: forwardedTokenFingerprint(principal.token)
        });
        return result(response);
      } catch (error) {
        return cmdbuildFailure(error, logger);
      }
    }
  );

  server.registerTool(
    'cmdbuild_read_demo_cards',
    {
      title: 'Read isolated CMDBuild demo cards',
      description: 'Reads only the configured demonstration class through the caller token.',
      inputSchema: { limit: z.number().int().min(1).max(100).default(10) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async ({ limit }) => {
      try {
        const response = await readDemoCards(config, principal.token, limit);
        logger.info('cmdbuild.demo.read.success', { subject_hash: fingerprint(principal.subject), role: principal.role, class_name: config.demoClass, limit });
        return result(response);
      } catch (error) {
        return cmdbuildFailure(error, logger);
      }
    }
  );

  server.registerTool(
    'cmdbuild_update_demo_card',
    {
      title: 'Update an allowlisted demo card attribute',
      description: 'Admin/editor only. Updates only the configured isolated demo card and allowlisted attributes through the caller token.',
      inputSchema: {
        attribute: z.string().min(1).max(80),
        value: z.string().min(1).max(500)
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
    },
    async ({ attribute, value }) => {
      if (!canWrite(principal.role)) {
        logger.warn('cmdbuild.demo.write.denied', { subject_hash: fingerprint(principal.subject), role: principal.role, attribute });
        return failure('group_does_not_allow_write');
      }
      try {
        const response = await updateDemoCard(config, principal.token, attribute, value);
        logger.info('cmdbuild.demo.write.success', { subject_hash: fingerprint(principal.subject), role: principal.role, class_name: config.demoClass, attribute });
        return result(response);
      } catch (error) {
        return cmdbuildFailure(error, logger);
      }
    }
  );

  return server;
}

function cmdbuildFailure(error: unknown, logger: Logger): ToolResult {
  if (error instanceof CmdbuildApiError) {
    logger.warn('cmdbuild.request.failed', { code: error.code, status: error.status });
    return failure(error.code, error.status);
  }
  logger.error('cmdbuild.request.failed', { code: 'cmdbuild_request_unavailable' });
  return failure('cmdbuild_request_unavailable');
}

function resourceMetadata(config: GatewayConfig): Record<string, unknown> {
  return {
    resource: `${config.publicUrl}/mcp`,
    authorization_servers: [config.oidcIssuer],
    scopes_supported: ['openid', 'profile', 'email', `urn:zitadel:iam:org:project:id:${config.resourceProjectId}:aud`],
    bearer_methods_supported: ['header'],
    resource_name: 'cmdbuild-oidc-tf CMDBuild MCP gateway'
  };
}

function writeUnauthorized(response: ServerResponse, config: GatewayConfig, code: string): void {
  json(response, 401, { error: 'invalid_token', error_description: code }, {
    'www-authenticate': `Bearer error="invalid_token", resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource/mcp"`
  });
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isInitializationRequest(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { method?: unknown }).method === 'initialize';
}

function clearExpiredSessions(): void {
  const expiredBefore = Date.now() - MCP_SESSION_TTL_MS;
  for (const [id, session] of mcpSessions) {
    if (session.lastSeenAt < expiredBefore) {
      mcpSessions.delete(id);
      void session.transport.close();
      void session.server.close();
    }
  }
}

function canOpenSession(config: GatewayConfig, subject: string): boolean {
  if (mcpSessions.size >= config.maxMcpSessions) return false;
  let subjectSessions = 0;
  for (const session of mcpSessions.values()) {
    if (session.subject === subject) subjectSessions += 1;
  }
  return subjectSessions < config.maxMcpSessionsPerSubject;
}

function writeMcpSessionError(response: ServerResponse, status: number, message: string): void {
  json(response, status, { jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

async function handleMcp(request: IncomingMessage, response: ServerResponse, config: GatewayConfig): Promise<void> {
  const logger = new Logger('mcp-gateway', config.logSinkUrl, config.logSinkHmacKey, config.diagnosticLevel);
  let principal: Principal;
  try {
    const token = authorizationHeader(request.headers);
    principal = await validateUserToken(token, config);
  } catch (error) {
    const code = error instanceof TokenValidationError ? error.message : 'token_validation_failed';
    logger.warn('mcp.authorization.denied', { code });
    writeUnauthorized(response, config, code);
    return;
  }

  try {
    clearExpiredSessions();
    const body = await readJson(request);
    const sessionId = headerValue(request, 'mcp-session-id');
    const tokenFingerprint = forwardedTokenFingerprint(principal.token);

    if (sessionId) {
      const session = mcpSessions.get(sessionId);
      if (!session) {
        writeMcpSessionError(response, 404, 'MCP session not found');
        return;
      }
      if (session.subject !== principal.subject || session.tokenFingerprint !== tokenFingerprint) {
        writeUnauthorized(response, config, 'mcp_session_token_mismatch');
        return;
      }
      session.lastSeenAt = Date.now();
      await session.transport.handleRequest(request, response, body);
      logger.verbose('mcp.request.accepted', { subject_hash: fingerprint(principal.subject), role: principal.role, session: 'existing' });
      return;
    }

    if (!isInitializationRequest(body)) {
      writeMcpSessionError(response, 400, 'MCP session initialization is required');
      return;
    }
    if (!canOpenSession(config, principal.subject)) {
      writeMcpSessionError(response, 429, 'MCP session capacity reached');
      return;
    }

    const server = buildMcpServer(config, principal, logger);
    let newSession: McpSession | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        newSession = { server, transport, subject: principal.subject, tokenFingerprint, lastSeenAt: Date.now() };
        mcpSessions.set(id, newSession);
      }
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
    logger.verbose('mcp.request.accepted', { subject_hash: fingerprint(principal.subject), role: principal.role, session: newSession ? 'new' : 'pending' });
  } catch {
    logger.error('mcp.request.failed', { code: 'mcp_request_failed' });
    if (!response.headersSent) {
      json(response, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
}

async function handleMcpDelete(request: IncomingMessage, response: ServerResponse, config: GatewayConfig): Promise<void> {
  let principal: Principal;
  try {
    principal = await validateUserToken(authorizationHeader(request.headers), config);
  } catch (error) {
    const code = error instanceof TokenValidationError ? error.message : 'token_validation_failed';
    writeUnauthorized(response, config, code);
    return;
  }
  const sessionId = headerValue(request, 'mcp-session-id');
  const session = sessionId ? mcpSessions.get(sessionId) : undefined;
  if (!session || !sessionId) {
    writeMcpSessionError(response, 404, 'MCP session not found');
    return;
  }
  if (session.subject !== principal.subject || session.tokenFingerprint !== forwardedTokenFingerprint(principal.token)) {
    writeUnauthorized(response, config, 'mcp_session_token_mismatch');
    return;
  }
  mcpSessions.delete(sessionId);
  await session.transport.close();
  await session.server.close();
  response.writeHead(204);
  response.end();
}

async function requestHandler(request: IncomingMessage, response: ServerResponse, config: GatewayConfig): Promise<void> {
  if (!hostAllowed(request, config.allowedHosts)) {
    text(response, 421, 'Misdirected Request');
    return;
  }
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && pathname === '/health') {
    json(response, 200, { status: 'ok', service: 'mcp-gateway' });
    return;
  }
  if (request.method === 'GET' && pathname === '/ready') {
    const ready = Boolean(config.resourceAudience) && logSinkReady(config.logSinkUrl);
    json(response, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', resource_audience_configured: Boolean(config.resourceAudience), log_sink_ready: logSinkReady(config.logSinkUrl) });
    return;
  }
  if (request.method === 'GET' && (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp')) {
    json(response, 200, resourceMetadata(config));
    return;
  }
  if (pathname === '/mcp' && request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-methods': 'POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
      'access-control-max-age': '600'
    });
    response.end();
    return;
  }
  if (pathname === '/mcp' && request.method === 'POST') {
    await handleMcp(request, response, config);
    return;
  }
  if (pathname === '/mcp' && request.method === 'DELETE') {
    await handleMcpDelete(request, response, config);
    return;
  }
  if (pathname === '/mcp') {
    json(response, 405, { error: 'method_not_allowed' }, { allow: 'POST, DELETE, OPTIONS' });
    return;
  }
  json(response, 404, { error: 'not_found' });
}

async function main(): Promise<void> {
  const config = loadGatewayConfig();
  await assertLogSinkHealthy(config.logSinkUrl);
  const startupLogger = new Logger('mcp-gateway', config.logSinkUrl, config.logSinkHmacKey, config.diagnosticLevel);
  const server = createServer((request, response) => void requestHandler(request, response, config));
  server.requestTimeout = 15_000;
  server.headersTimeout = 20_000;
  server.listen(config.port, '127.0.0.1', () => {
    startupLogger.info('service.started', { port: config.port, public_url: config.publicUrl, ready: true });
  });
  const cleanupTimer = setInterval(clearExpiredSessions, 60_000);
  cleanupTimer.unref();
  const shutdown = () => {
    clearInterval(cleanupTimer);
    for (const session of mcpSessions.values()) {
      void session.transport.close();
      void session.server.close();
    }
    mcpSessions.clear();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ service: 'mcp-gateway', level: 'error', event: 'startup.failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
  process.exit(1);
});
