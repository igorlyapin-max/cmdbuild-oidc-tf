import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { loadBffConfig, isPlaceholder, type BffConfig } from './config.js';
import { hostAllowed, json, requestUrl, text } from './http.js';
import { assertLogSinkHealthy, fingerprint, Logger } from './logger.js';

interface OidcMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
}

interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  createdAt: number;
}

interface BrowserSession {
  accessToken: string;
  idToken: string;
  subjectHash: string;
  expiresAt: number;
}

const pendingLogins = new Map<string, PendingLogin>();
const browserSessions = new Map<string, BrowserSession>();

function configured(config: BffConfig): boolean {
  return !isPlaceholder(config.clientId) && !isPlaceholder(config.oidcAudience);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const prefix = `${name}=`;
  return request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(prefix))?.slice(prefix.length);
}

function setCookie(response: ServerResponse, name: string, value: string, maxAgeSeconds: number): void {
  response.setHeader('set-cookie', `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
}

function sha256base64url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function authorizationScopes(): string {
  return [
    'openid', 'profile', 'email',
    'urn:zitadel:iam:org:project:role:admin',
    'urn:zitadel:iam:org:project:role:editor',
    'urn:zitadel:iam:org:project:role:reader'
  ].join(' ');
}

function oidcErrorCode(error: unknown): { code: string; type: string; libraryCode?: string } {
  const message = error instanceof Error ? error.message : '';
  const type = error instanceof Error ? error.name : 'UnknownError';
  const libraryCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  const code = new Set([
    'oidc_discovery_failed',
    'oidc_discovery_incomplete',
    'oidc_code_exchange_failed',
    'oidc_token_response_incomplete',
    'oidc_id_token_validation_failed'
  ]).has(message)
    ? message
    : type === 'JWTClaimValidationFailed'
      ? 'oidc_id_token_claims_invalid'
      : type === 'JWSSignatureVerificationFailed'
        ? 'oidc_id_token_signature_invalid'
        : type === 'TypeError'
          ? 'oidc_network_error'
          : 'oidc_callback_failed';
  return { code, type, libraryCode };
}

function clearExpired(): void {
  const now = Date.now();
  for (const [id, pending] of pendingLogins) if (pending.createdAt + 10 * 60_000 < now) pendingLogins.delete(id);
  for (const [id, session] of browserSessions) if (session.expiresAt < now) browserSessions.delete(id);
}

async function oidcMetadata(config: BffConfig): Promise<OidcMetadata> {
  const response = await fetch(`${config.oidcIssuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('oidc_discovery_failed');
  const metadata = await response.json() as Partial<OidcMetadata>;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('oidc_discovery_incomplete');
  return { authorization_endpoint: metadata.authorization_endpoint, token_endpoint: metadata.token_endpoint };
}

async function exchangeCode(config: BffConfig, metadata: OidcMetadata, code: string, pending: PendingLogin): Promise<BrowserSession> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: pending.verifier
  });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (config.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
  } else {
    // Public authorization-code clients identify themselves here and rely on
    // PKCE instead of a browser-exposed static client secret.
    body.set('client_id', config.clientId);
  }
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('oidc_code_exchange_failed');
  const token = await response.json() as { access_token?: string; id_token?: string; expires_in?: number };
  if (!token.access_token || !token.id_token) throw new Error('oidc_token_response_incomplete');
  const jwks = createRemoteJWKSet(new URL(config.oidcJwksUri));
  const { payload } = await jwtVerify(token.id_token, jwks, { issuer: config.oidcIssuer, audience: config.clientId });
  if (payload.nonce !== pending.nonce || typeof payload.sub !== 'string') throw new Error('oidc_id_token_validation_failed');
  return {
    accessToken: token.access_token,
    idToken: token.id_token,
    subjectHash: fingerprint(payload.sub),
    expiresAt: Date.now() + Math.max(60, Math.min(token.expires_in ?? 3600, 3600)) * 1000
  };
}

function authorizationSummary(token: string): Record<string, unknown> {
  const claims = decodeJwt(token);
  const roleClaimNames = Object.keys(claims).filter((name) => /role|group|project/i.test(name));
  return {
    audience: claims.aud,
    scope: claims.scope,
    role_claims: Object.fromEntries(roleClaimNames.map((name) => [name, claims[name]]))
  };
}

async function userInfoAuthorizationSummary(config: BffConfig, accessToken: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.oidcIssuer}/oidc/v1/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5_000)
  });
  if (!response.ok) return { status: response.status, role_claims: {} };
  const claims = await response.json() as Record<string, unknown>;
  const roleClaimNames = Object.keys(claims).filter((name) => /role|group|project/i.test(name));
  return { status: response.status, role_claims: Object.fromEntries(roleClaimNames.map((name) => [name, claims[name]])) };
}

async function cmdbuildWhoAmI(config: BffConfig, accessToken: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${config.cmdbuildBaseUrl}/cmdbuild/services/rest/v3/sessions/current`, {
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000)
  });
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: contentType.includes('application/json') ? await response.json() : { result: 'non_json_response' }
  };
}

async function mcpPost(config: BffConfig, accessToken: string, body: unknown, sessionId?: string): Promise<{ status: number; sessionId?: string; body: unknown }> {
  const response = await fetch(config.mcpGatewayUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-03-26',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    sessionId: response.headers.get('mcp-session-id') ?? undefined,
    body: contentType.includes('application/json') ? await response.json() : { result: 'non_json_response' }
  };
}

async function mcpReaderWriteCheck(config: BffConfig, accessToken: string): Promise<{ status: number; body: unknown }> {
  const initialization = await mcpPost(config, accessToken, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cmdbuild-oidc-tf-bff', version: '0.1.0' } }
  });
  if (initialization.status !== 200 || !initialization.sessionId) {
    return { status: initialization.status, body: initialization.body };
  }
  const sessionId = initialization.sessionId;
  try {
    const initialized = await mcpPost(config, accessToken, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sessionId);
    if (initialized.status < 200 || initialized.status >= 300) return { status: initialized.status, body: initialized.body };
    const tool = await mcpPost(config, accessToken, {
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'cmdbuild_update_demo_card', arguments: { attribute: 'Description', value: 'authorization-check' } }
    }, sessionId);
    return { status: tool.status, body: tool.body };
  } finally {
    void fetch(config.mcpGatewayUrl, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${accessToken}`, 'mcp-session-id': sessionId },
      signal: AbortSignal.timeout(5_000)
    }).catch(() => undefined);
  }
}

function html(): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>cmdbuild-oidc-tf CMDBuild OIDC BFF</title><body><h1>CMDBuild OIDC BFF analogue</h1><p>This direct service has no reverse proxy. It stores tokens server-side and forwards only the authenticated user's access token to CMDBuild.</p><p><a href="/login">Sign in with ZITADEL</a> · <a href="/api/oidc/authorization-summary">View redacted OIDC authorization summary</a> · <a href="/api/cmdbuild/whoami">Test CMDBuild API</a> · <a href="/api/mcp/reader-write-check">Test reader MCP write deny</a> · <a href="/logout">Sign out</a></p></body></html>`;
}

async function handle(request: IncomingMessage, response: ServerResponse, config: BffConfig): Promise<void> {
  if (!hostAllowed(request, config.allowedHosts)) {
    text(response, 421, 'Misdirected Request');
    return;
  }
  clearExpired();
  const url = requestUrl(request);
  const logger = new Logger('cmdb-oidc-bff', config.logSinkUrl, config.diagnosticLevel);
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok', service: 'cmdb-oidc-bff' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/ready') {
    json(response, configured(config) ? 200 : 503, { status: configured(config) ? 'ready' : 'not_ready', oidc_configured: configured(config) });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html());
    return;
  }
  if (request.method === 'GET' && url.pathname === '/login') {
    if (!configured(config)) {
      json(response, 503, { error: 'bff_oidc_client_not_configured' });
      return;
    }
    try {
      const metadata = await oidcMetadata(config);
      const loginId = randomUUID();
      const state = randomBytes(32).toString('base64url');
      const nonce = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      pendingLogins.set(loginId, { state, nonce, verifier, createdAt: Date.now() });
      setCookie(response, 'cmdbuild_oidc_tf_login', loginId, 600);
      const authorizationUrl = new URL(metadata.authorization_endpoint);
      authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: authorizationScopes(),
        state,
        nonce,
        code_challenge: sha256base64url(verifier),
        code_challenge_method: 'S256'
      }).toString();
      logger.info('oidc.login.redirect');
      redirect(response, authorizationUrl.toString());
    } catch {
      logger.error('oidc.login.failed', { code: 'oidc_discovery_failed' });
      json(response, 502, { error: 'oidc_discovery_failed' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/oauth/callback') {
    const loginId = cookieValue(request, 'cmdbuild_oidc_tf_login');
    const pending = loginId ? pendingLogins.get(loginId) : undefined;
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!configured(config) || !loginId || !pending || !state || state !== pending.state || !code) {
      json(response, 400, { error: 'invalid_oidc_callback' });
      return;
    }
    try {
      const session = await exchangeCode(config, await oidcMetadata(config), code, pending);
      const sessionId = randomUUID();
      browserSessions.set(sessionId, session);
      pendingLogins.delete(loginId);
      setCookie(response, 'cmdbuild_oidc_tf_session', sessionId, 3600);
      logger.info('oidc.callback.success', { subject_hash: session.subjectHash });
      redirect(response, '/');
    } catch (error) {
      const diagnostic = oidcErrorCode(error);
      logger.warn('oidc.callback.failed', {
        code: diagnostic.code,
        error_type: diagnostic.type,
        oidc_library_code: diagnostic.libraryCode
      });
      json(response, 401, { error: 'oidc_callback_failed' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/cmdbuild/whoami') {
    const sessionId = cookieValue(request, 'cmdbuild_oidc_tf_session');
    const session = sessionId ? browserSessions.get(sessionId) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    try {
      const result = await cmdbuildWhoAmI(config, session.accessToken);
      logger.info('cmdbuild.user_token_forwarded', { subject_hash: session.subjectHash, cmdbuild_status: result.status });
      json(response, result.status, result.body);
    } catch {
      logger.error('cmdbuild.user_token_forward_failed');
      json(response, 502, { error: 'cmdbuild_unavailable' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/oidc/authorization-summary') {
    const sessionId = cookieValue(request, 'cmdbuild_oidc_tf_session');
    const session = sessionId ? browserSessions.get(sessionId) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    json(response, 200, {
      access_token: authorizationSummary(session.accessToken),
      id_token: authorizationSummary(session.idToken),
      userinfo: await userInfoAuthorizationSummary(config, session.accessToken)
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/mcp/reader-write-check') {
    const sessionId = cookieValue(request, 'cmdbuild_oidc_tf_session');
    const session = sessionId ? browserSessions.get(sessionId) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    try {
      const result = await mcpReaderWriteCheck(config, session.accessToken);
      logger.info('mcp.user_token_forwarded', { subject_hash: session.subjectHash, mcp_status: result.status, tool: 'cmdbuild_update_demo_card' });
      json(response, result.status, result.body);
    } catch {
      logger.error('mcp.user_token_forward_failed');
      json(response, 502, { error: 'mcp_gateway_unavailable' });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/logout') {
    const sessionId = cookieValue(request, 'cmdbuild_oidc_tf_session');
    if (sessionId) browserSessions.delete(sessionId);
    setCookie(response, 'cmdbuild_oidc_tf_session', '', 0);
    redirect(response, '/');
    return;
  }
  json(response, 404, { error: 'not_found' });
}

async function main(): Promise<void> {
  const config = loadBffConfig();
  await assertLogSinkHealthy(config.logSinkUrl);
  const logger = new Logger('cmdb-oidc-bff', config.logSinkUrl, config.diagnosticLevel);
  const server = createServer((request, response) => void handle(request, response, config));
  server.requestTimeout = 15_000;
  server.headersTimeout = 20_000;
  server.listen(config.port, '0.0.0.0', () => logger.info('service.started', { port: config.port, direct_no_reverse_proxy: true, ready: configured(config) }));
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ service: 'cmdb-oidc-bff', level: 'error', event: 'startup.failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
  process.exit(1);
});
