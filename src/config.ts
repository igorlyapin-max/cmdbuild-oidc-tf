import { readFileSync } from 'node:fs';

export type DiagnosticLevel = 'basic' | 'verbose';

export interface CommonConfig {
  diagnosticLevel: DiagnosticLevel;
  allowedHosts: Set<string>;
  logSinkUrl: string;
}

export interface GatewayConfig extends CommonConfig {
  port: number;
  publicUrl: string;
  oidcIssuer: string;
  oidcJwksUri: string;
  oidcUserInfoUrl: string;
  oidcAudience: string;
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
}

export interface BffConfig extends CommonConfig {
  port: number;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  oidcIssuer: string;
  oidcJwksUri: string;
  oidcAudience: string;
  cmdbuildBaseUrl: string;
  mcpGatewayUrl: string;
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
  return {
    diagnosticLevel: diagnosticLevel(),
    allowedHosts,
    logSinkUrl: url('LOG_SINK_URL', 'http://127.0.0.1:18101/v1/logs')
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
    oidcAudience: requiredString('OIDC_AUDIENCE'),
    groupClaimName: requiredString('GROUP_CLAIM_NAME', 'urn:zitadel:iam:org:project:roles'),
    groups: {
      admin: requiredString('GROUP_ADMIN', 'admin'),
      editor: requiredString('GROUP_EDITOR', 'editor'),
      reader: requiredString('GROUP_READER', 'reader')
    },
    cmdbuildBaseUrl: url('CMDBUILD_BASE_URL', 'http://127.0.0.1:18090'),
    demoClass: requiredString('CMDBUILD_DEMO_CLASS', 'Building'),
    demoCardId: process.env.CMDBUILD_DEMO_CARD_ID?.trim() || undefined,
    writableAttributes: commaSet(process.env.CMDBUILD_WRITABLE_ATTRIBUTES ?? 'Description,Notes')
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
    oidcAudience: requiredString('OIDC_AUDIENCE'),
    cmdbuildBaseUrl: url('CMDBUILD_BASE_URL', 'http://127.0.0.1:18090'),
    mcpGatewayUrl: url('MCP_GATEWAY_URL', 'http://127.0.0.1:18100/mcp')
  };
}
