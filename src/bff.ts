import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { decodeJwt, jwtVerify } from 'jose';
import { loadBffConfig, isPlaceholder, type BffConfig } from './config.js';
import { currentUser, CmdbuildApiError, forwardedTokenFingerprint, readDemoCard, readDemoCards, updateDemoCard } from './cmdbuild.js';
import { canWrite, groupsFromClaim, remoteJwks, roleFor, type Role } from './identity.js';
import { hostAllowed, json, readJson, requestUrl, text } from './http.js';
import { assertLogSinkHealthy, fingerprint, Logger, logSinkReady } from './logger.js';

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
  role?: Role;
  expiresAt: number;
}

const pendingLogins = new Map<string, PendingLogin>();
const browserSessions = new Map<string, BrowserSession>();
const loginAttempts = new Map<string, { startedAt: number; count: number }>();
const LOGIN_WINDOW_MS = 60_000;
const MAX_LOGIN_TRACKED_CLIENTS = 4096;

function configured(config: BffConfig): boolean {
  return !isPlaceholder(config.clientId) && !isPlaceholder(config.resourceAudience);
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

function authorizationScopes(config: BffConfig): string {
  return [
    'openid', 'profile', 'email',
    'urn:zitadel:iam:org:project:role:admin',
    'urn:zitadel:iam:org:project:role:editor',
    'urn:zitadel:iam:org:project:role:reader',
    `urn:zitadel:iam:org:project:id:${config.resourceProjectId}:aud`
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
  for (const [client, attempt] of loginAttempts) if (attempt.startedAt + LOGIN_WINDOW_MS < now) loginAttempts.delete(client);
}

function loginAllowed(request: IncomingMessage, config: BffConfig): boolean {
  const client = request.socket.remoteAddress ?? 'unknown';
  const now = Date.now();
  const previous = loginAttempts.get(client);
  const attempt = !previous || previous.startedAt + LOGIN_WINDOW_MS < now
    ? { startedAt: now, count: 1 }
    : { ...previous, count: previous.count + 1 };
  if (!previous && loginAttempts.size >= MAX_LOGIN_TRACKED_CLIENTS) {
    const oldest = loginAttempts.keys().next().value;
    if (oldest) loginAttempts.delete(oldest);
  }
  loginAttempts.set(client, attempt);
  return attempt.count <= config.loginRateLimitPerMinute;
}

async function oidcMetadata(config: BffConfig): Promise<OidcMetadata> {
  const response = await fetch(`${config.oidcIssuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('oidc_discovery_failed');
  const metadata = await response.json() as Partial<OidcMetadata>;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('oidc_discovery_incomplete');
  return { authorization_endpoint: metadata.authorization_endpoint, token_endpoint: metadata.token_endpoint };
}

async function roleForSession(config: BffConfig, payload: Record<string, unknown>, accessToken: string): Promise<Role | undefined> {
  const directRole = roleFor(groupsFromClaim(payload[config.groupClaimName]), config);
  if (directRole) return directRole;
  const subject = payload.sub;
  if (typeof subject !== 'string') return undefined;
  try {
    const response = await fetch(`${config.oidcIssuer}/oidc/v1/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return undefined;
    const userInfo = await response.json() as Record<string, unknown>;
    if (userInfo.sub !== subject) return undefined;
    return roleFor(groupsFromClaim(userInfo[config.groupClaimName]), config);
  } catch {
    return undefined;
  }
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
  const jwks = remoteJwks(config.oidcJwksUri);
  const { payload } = await jwtVerify(token.id_token, jwks, { issuer: config.oidcIssuer, audience: config.clientId });
  if (payload.nonce !== pending.nonce || typeof payload.sub !== 'string') throw new Error('oidc_id_token_validation_failed');
  return {
    accessToken: token.access_token,
    idToken: token.id_token,
    subjectHash: fingerprint(payload.sub),
    role: await roleForSession(config, payload, token.access_token),
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

function cmdbuildStatus(error: unknown): number {
  return error instanceof CmdbuildApiError ? error.status : 502;
}

function cmdbuildFailure(error: unknown): string {
  return error instanceof CmdbuildApiError ? error.code : 'cmdbuild_unavailable';
}

function boundedLimit(value: string | null): number | undefined {
  if (value === null) return 10;
  if (!/^\d+$/.test(value)) return undefined;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : undefined;
}

function writeRequest(value: unknown): { attribute: string; value: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const request = value as { attribute?: unknown; value?: unknown };
  if (typeof request.attribute !== 'string' || typeof request.value !== 'string') return undefined;
  const attribute = request.attribute.trim();
  if (!attribute || attribute.length > 80 || !request.value || request.value.length > 500) return undefined;
  return { attribute, value: request.value };
}

function sessionFor(request: IncomingMessage): BrowserSession | undefined {
  const sessionId = cookieValue(request, 'cmdbuild_oidc_tf_session');
  const session = sessionId ? browserSessions.get(sessionId) : undefined;
  return session && session.expiresAt >= Date.now() ? session : undefined;
}

function requireRole(response: ServerResponse, session: BrowserSession): session is BrowserSession & { role: Role } {
  if (session.role) return true;
  json(response, 403, { error: 'group_not_allowed' });
  return false;
}

function html(): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>cmdbuild-oidc-tf CMDBuild OIDC BFF</title><body><h1>CMDBuild OIDC BFF analogue</h1><p>This direct service has no reverse proxy. It stores tokens server-side and forwards only the authenticated user's access token to CMDBuild.</p><p><a href="/login">Sign in with ZITADEL</a> · <a href="/api/oidc/authorization-summary">View redacted OIDC authorization summary</a> · <a href="/api/cmdbuild/whoami">Test CMDBuild API</a> · <a href="/api/cmdbuild/demo-cards">Read demo cards</a> · <a href="/logout">Sign out</a></p></body></html>`;
}

async function handle(request: IncomingMessage, response: ServerResponse, config: BffConfig): Promise<void> {
  if (!hostAllowed(request, config.allowedHosts)) {
    text(response, 421, 'Misdirected Request');
    return;
  }
  clearExpired();
  const url = requestUrl(request);
  const logger = new Logger('cmdb-oidc-bff', config.logSinkUrl, config.logSinkHmacKey, config.diagnosticLevel);
  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { status: 'ok', service: 'cmdb-oidc-bff' });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/ready') {
    const ready = configured(config) && logSinkReady(config.logSinkUrl);
    json(response, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', oidc_configured: configured(config), log_sink_ready: logSinkReady(config.logSinkUrl) });
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
    if (!loginAllowed(request, config)) {
      json(response, 429, { error: 'login_rate_limited' }, { 'retry-after': '60' });
      return;
    }
    if (pendingLogins.size >= config.maxPendingLogins) {
      json(response, 429, { error: 'login_capacity_reached' });
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
        scope: authorizationScopes(config),
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
      if (browserSessions.size >= config.maxBrowserSessions) {
        json(response, 429, { error: 'browser_session_capacity_reached' });
        return;
      }
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
    const session = sessionFor(request);
    if (!session) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    if (!requireRole(response, session)) return;
    try {
      const result = await currentUser(config, session.accessToken);
      logger.info('cmdbuild.user_token_forwarded', {
        subject_hash: session.subjectHash,
        role: session.role,
        forwarded_credential_fingerprint: forwardedTokenFingerprint(session.accessToken)
      });
      json(response, 200, result);
    } catch (error) {
      const status = cmdbuildStatus(error);
      logger.warn('cmdbuild.user_token_forward_failed', { subject_hash: session.subjectHash, role: session.role, status, code: cmdbuildFailure(error) });
      json(response, status, { error: cmdbuildFailure(error) });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/cmdbuild/demo-cards') {
    const session = sessionFor(request);
    const limit = boundedLimit(url.searchParams.get('limit'));
    if (!session) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    if (!requireRole(response, session)) return;
    if (!limit) {
      json(response, 400, { error: 'invalid_demo_card_limit' });
      return;
    }
    try {
      const result = await readDemoCards(config, session.accessToken, limit);
      logger.info('cmdbuild.demo.read.success', { subject_hash: session.subjectHash, role: session.role, class_name: config.demoClass, limit });
      json(response, 200, result);
    } catch (error) {
      const status = cmdbuildStatus(error);
      logger.warn('cmdbuild.demo.read.failed', { subject_hash: session.subjectHash, role: session.role, status, code: cmdbuildFailure(error) });
      json(response, status, { error: cmdbuildFailure(error) });
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/cmdbuild/demo-card') {
    const session = sessionFor(request);
    if (!session) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    if (!requireRole(response, session)) return;
    try {
      const result = await readDemoCard(config, session.accessToken);
      logger.info('cmdbuild.demo.card.read.success', { subject_hash: session.subjectHash, role: session.role, class_name: config.demoClass });
      json(response, 200, result);
    } catch (error) {
      const status = cmdbuildStatus(error);
      logger.warn('cmdbuild.demo.card.read.failed', { subject_hash: session.subjectHash, role: session.role, status, code: cmdbuildFailure(error) });
      json(response, status, { error: cmdbuildFailure(error) });
    }
    return;
  }
  if (request.method === 'PUT' && url.pathname === '/api/cmdbuild/demo-card') {
    const session = sessionFor(request);
    if (!session) {
      json(response, 401, { error: 'authentication_required' });
      return;
    }
    if (!requireRole(response, session)) return;
    if (!config.pocWriteEnabled) {
      json(response, 403, { error: 'bff_poc_write_disabled' });
      return;
    }
    if (!canWrite(session.role)) {
      logger.warn('cmdbuild.demo.write.denied', { subject_hash: session.subjectHash, role: session.role, code: 'group_does_not_allow_write' });
      json(response, 403, { error: 'group_does_not_allow_write' });
      return;
    }
    let write: { attribute: string; value: string } | undefined;
    try {
      write = writeRequest(await readJson(request));
    } catch {
      write = undefined;
    }
    if (!write) {
      json(response, 400, { error: 'invalid_demo_card_write' });
      return;
    }
    try {
      const result = await updateDemoCard(config, session.accessToken, write.attribute, write.value);
      logger.info('cmdbuild.demo.write.success', { subject_hash: session.subjectHash, role: session.role, class_name: config.demoClass, attribute: write.attribute });
      json(response, 200, result);
    } catch (error) {
      const status = cmdbuildStatus(error);
      logger.warn('cmdbuild.demo.write.failed', { subject_hash: session.subjectHash, role: session.role, status, code: cmdbuildFailure(error), attribute: write.attribute });
      json(response, status, { error: cmdbuildFailure(error) });
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
  const logger = new Logger('cmdb-oidc-bff', config.logSinkUrl, config.logSinkHmacKey, config.diagnosticLevel);
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
