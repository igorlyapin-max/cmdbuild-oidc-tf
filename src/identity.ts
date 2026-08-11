import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { GatewayConfig } from './config.js';
import { isPlaceholder } from './config.js';

export type Role = 'admin' | 'editor' | 'reader';

export interface Principal {
  subject: string;
  groups: readonly string[];
  role: Role;
  token: string;
  claims: JWTPayload;
}

export class TokenValidationError extends Error {}

const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function remoteJwks(uri: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksByUri.get(uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(uri));
    jwksByUri.set(uri, jwks);
  }
  return jwks;
}

export function clearJwksCacheForTest(): void {
  jwksByUri.clear();
}

export function groupsFromClaim(value: unknown): string[] {
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return [...new Set(value.map(item => item.trim()).filter(Boolean))];
  }
  if (typeof value === 'string') {
    return [...new Set(value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean))];
  }
  // ZITADEL project-role assertion uses role names as keys and organization
  // metadata as string values. All other object shapes are denied.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    const isRoleGrant = (grant: unknown): boolean =>
      typeof grant === 'string' || (
        grant !== null && typeof grant === 'object' && !Array.isArray(grant) &&
        Object.values(grant).every((organization) => typeof organization === 'string')
      );
    if (entries.every(([, grant]) => isRoleGrant(grant))) {
      return [...new Set(entries.map(([role]) => role.trim()).filter(Boolean))];
    }
  }
  return [];
}

export function roleFor(groups: readonly string[], config: Pick<GatewayConfig, 'groups'>): Role | undefined {
  if (groups.includes(config.groups.admin)) return 'admin';
  if (groups.includes(config.groups.editor)) return 'editor';
  if (groups.includes(config.groups.reader)) return 'reader';
  return undefined;
}

export function authorizationHeader(requestHeaders: Record<string, string | string[] | undefined>): string {
  const header = requestHeaders.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith('Bearer ')) throw new TokenValidationError('missing_bearer_token');
  const token = value.slice('Bearer '.length).trim();
  if (!token || token.includes(' ')) throw new TokenValidationError('malformed_bearer_token');
  return token;
}

async function groupsFromUserInfo(token: string, subject: string, config: GatewayConfig): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(config.oidcUserInfoUrl, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000)
    });
  } catch {
    throw new TokenValidationError('oidc_userinfo_unavailable');
  }
  if (!response.ok) throw new TokenValidationError('oidc_userinfo_rejected_token');
  let claims: unknown;
  try {
    claims = await response.json();
  } catch {
    throw new TokenValidationError('oidc_userinfo_invalid_response');
  }
  if (!claims || typeof claims !== 'object' || (claims as { sub?: unknown }).sub !== subject) {
    throw new TokenValidationError('oidc_userinfo_subject_mismatch');
  }
  return groupsFromClaim((claims as Record<string, unknown>)[config.groupClaimName]);
}

export async function validateUserToken(token: string, config: GatewayConfig): Promise<Principal> {
  if (isPlaceholder(config.resourceAudience)) {
    throw new TokenValidationError('oidc_audience_not_configured');
  }
  const jwks = remoteJwks(config.oidcJwksUri);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: config.oidcIssuer,
      audience: config.resourceAudience
    }));
  } catch {
    throw new TokenValidationError('invalid_or_expired_token');
  }
  if (!payload.sub || typeof payload.sub !== 'string') throw new TokenValidationError('token_has_no_subject');
  const directGroups = groupsFromClaim(payload[config.groupClaimName]);
  const groups = directGroups.length > 0 ? directGroups : await groupsFromUserInfo(token, payload.sub, config);
  const role = roleFor(groups, config);
  if (!role) throw new TokenValidationError('required_group_missing');
  return { subject: payload.sub, groups, role, token, claims: payload };
}

export function canWrite(role: Role): boolean {
  return role === 'admin' || role === 'editor';
}
