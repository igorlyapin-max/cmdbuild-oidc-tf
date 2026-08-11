import { readFileSync } from 'node:fs';

export type DiagnosticLevel = 'basic' | 'verbose';
export type DeploymentProfile = 'poc-http';

export interface CommonConfig {
  diagnosticLevel: DiagnosticLevel;
  allowedHosts: Set<string>;
  logSinkUrl: string;
  logSinkHmacKey: string;
  deploymentProfile: DeploymentProfile;
}

export interface GatewayConfig extends CommonConfig {
  port: number;
  publicUrl: string;
  oidcIssuer: string;
  oidcJwksUri: string;
  oidcUserInfoUrl: string;
  resourceProjectId: string;
  resourceAudience: string;
  groupClaimName: string;
  groups: {
    admin: string;
    editor: string;
    reader: string;
  };
  cmdbuildBaseUrl: string;
  demoClass: string;
  demoCardId?: string;
  writableAttributes: Set<string>;
  maxMcpSessions: number;
  maxMcpSessionsPerSubject: number;
}

export interface BffConfig extends CommonConfig {
  port: number;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  oidcIssuer: string;
  oidcJwksUri: string;
  resourceProjectId: string;
  resourceAudience: string;
  cmdbuildBaseUrl: string;
  groupClaimName: string;
  groups: {
    admin: string;
    editor: string;
    reader: string;
  };
  demoClass: string;
  demoCardId?: string;
  writableAttributes: Set<string>;
  pocWriteEnabled: boolean;
  maxPendingLogins: number;
  maxBrowserSessions: number;
  loginRateLimitPerMinute: number;
}

function requiredString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function port(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a TCP port`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function url(name: string, fallback?: string): string {
  const value = requiredString(name, fallback);
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
}

function commaSet(value: string): Set<string> {
  return new Set(value.split(',').map(item => item.trim()).filter(Boolean));
}

function boolean(name: string, fallback: boolean): boolean {
  const value = (process.env[name] ?? String(fallback)).trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function diagnosticLevel(): DiagnosticLevel {
  const value = (process.env.DIAGNOSTIC_LEVEL ?? 'basic').toLowerCase();
  if (value !== 'basic' && value !== 'verbose') {
    throw new Error('DIAGNOSTIC_LEVEL must be basic or verbose');
  }
  return value;
}

function commonConfig(): CommonConfig {
  const allowedHosts = commaSet(process.env.ALLOWED_HOSTS ?? '127.0.0.1,localhost');
  if (allowedHosts.size === 0) {
    throw new Error('ALLOWED_HOSTS must contain at least one host');
  }
  const deploymentProfile = (process.env.DEPLOYMENT_PROFILE ?? 'poc-http').trim();
  if (deploymentProfile !== 'poc-http') {
    throw new Error('DEPLOYMENT_PROFILE must be poc-http; this repository has no production HTTP profile');
  }
  return {
    diagnosticLevel: diagnosticLevel(),
    allowedHosts,
    logSinkUrl: url('LOG_SINK_URL', 'http://127.0.0.1:18101/v1/logs'),
    logSinkHmacKey: requiredSecretFile('LOG_SINK_HMAC_KEY_FILE'),
    deploymentProfile
  };
}

function optionalSecretFile(name: string): string | undefined {
  const path = process.env[name]?.trim();
  if (!path) return undefined;
  try {
    const value = readFileSync(path, 'utf8').trim();
    return value && !isPlaceholder(value) && value !== 'unconfigured' ? value : undefined;
  } catch {
    return undefined;
  }
}

function requiredSecretFile(name: string): string {
  const value = optionalSecretFile(name);
  if (!value) throw new Error(`${name} must reference a readable configured secret file`);
  return value;
}

function resourceAudience(): { resourceProjectId: string; resourceAudience: string } {
  const resourceProjectId = requiredString('CMDBUILD_RESOURCE_PROJECT_ID');
  const resourceAudience = requiredString('CMDBUILD_RESOURCE_AUDIENCE', resourceProjectId);
  if (isPlaceholder(resourceProjectId) || isPlaceholder(resourceAudience) || resourceAudience !== resourceProjectId) {
    throw new Error('CMDBUILD_RESOURCE_AUDIENCE must equal the configured non-placeholder CMDBUILD_RESOURCE_PROJECT_ID');
  }
  return { resourceProjectId, resourceAudience };
}

export function isPlaceholder(value: string | undefined): boolean {
  return !value || value.startsWith('replace-with-');
}

export function loadGatewayConfig(): GatewayConfig {
  const oidcIssuer = url('OIDC_ISSUER');
  return {
    ...commonConfig(),
    port: port('MCP_GATEWAY_PORT', 18100),
    publicUrl: url('MCP_PUBLIC_URL', 'http://127.0.0.1:8085'),
    oidcIssuer,
    oidcJwksUri: url('OIDC_JWKS_URI'),
    oidcUserInfoUrl: url('OIDC_USERINFO_URL', `${oidcIssuer}/oidc/v1/userinfo`),
    ...resourceAudience(),
    groupClaimName: requiredString('GROUP_CLAIM_NAME', 'urn:zitadel:iam:org:project:roles'),
    groups: {
      admin: requiredString('GROUP_ADMIN', 'admin'),
      editor: requiredString('GROUP_EDITOR', 'editor'),
      reader: requiredString('GROUP_READER', 'reader')
    },
    cmdbuildBaseUrl: url('CMDBUILD_BASE_URL', 'http://127.0.0.1:18090'),
    demoClass: requiredString('CMDBUILD_DEMO_CLASS', 'Building'),
    demoCardId: process.env.CMDBUILD_DEMO_CARD_ID?.trim() || undefined,
    writableAttributes: commaSet(process.env.CMDBUILD_WRITABLE_ATTRIBUTES ?? 'Description,Notes'),
    maxMcpSessions: positiveInteger('MCP_MAX_SESSIONS', 500, 10_000),
    maxMcpSessionsPerSubject: positiveInteger('MCP_MAX_SESSIONS_PER_SUBJECT', 10, 100)
  };
}

export function loadBffConfig(): BffConfig {
  return {
    ...commonConfig(),
    port: port('BFF_PORT', 18086),
    clientId: requiredString('BFF_CLIENT_ID'),
    clientSecret: optionalSecretFile('BFF_CLIENT_SECRET_FILE'),
    redirectUri: url('BFF_REDIRECT_URI'),
    oidcIssuer: url('OIDC_ISSUER'),
    oidcJwksUri: url('OIDC_JWKS_URI'),
    ...resourceAudience(),
    cmdbuildBaseUrl: url('CMDBUILD_BASE_URL', 'http://127.0.0.1:18090'),
    groupClaimName: requiredString('GROUP_CLAIM_NAME', 'urn:zitadel:iam:org:project:roles'),
    groups: {
      admin: requiredString('GROUP_ADMIN', 'admin'),
      editor: requiredString('GROUP_EDITOR', 'editor'),
      reader: requiredString('GROUP_READER', 'reader')
    },
    demoClass: requiredString('CMDBUILD_DEMO_CLASS', 'Building'),
    demoCardId: process.env.CMDBUILD_DEMO_CARD_ID?.trim() || undefined,
    writableAttributes: commaSet(process.env.CMDBUILD_WRITABLE_ATTRIBUTES ?? 'Description,Notes'),
    pocWriteEnabled: boolean('BFF_POC_WRITE_ENABLED', false),
    maxPendingLogins: positiveInteger('BFF_MAX_PENDING_LOGINS', 1000, 10_000),
    maxBrowserSessions: positiveInteger('BFF_MAX_BROWSER_SESSIONS', 2000, 20_000),
    loginRateLimitPerMinute: positiveInteger('BFF_LOGIN_RATE_LIMIT_PER_MINUTE', 30, 600)
  };
}
