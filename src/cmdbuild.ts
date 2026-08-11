import { fingerprint } from './logger.js';

export interface CmdbuildApiConfig {
  cmdbuildBaseUrl: string;
  demoClass: string;
  demoCardId?: string;
  writableAttributes: Set<string>;
}

export class CmdbuildApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function endpoint(baseUrl: string, path: string): URL {
  return new URL(`/cmdbuild/services/rest/v3/${path.replace(/^\//, '')}`, `${baseUrl}/`);
}

async function cmdbuildRequest(
  config: CmdbuildApiConfig,
  userToken: string,
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(endpoint(config.cmdbuildBaseUrl, path), {
    method,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${userToken}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? 'cmdbuild_rejected_forwarded_user_token'
      : 'cmdbuild_api_error';
    throw new CmdbuildApiError(response.status, code);
  }
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

export async function currentUser(config: CmdbuildApiConfig, userToken: string): Promise<unknown> {
  return cmdbuildRequest(config, userToken, 'GET', 'sessions/current');
}

export async function readDemoCards(config: CmdbuildApiConfig, userToken: string, limit: number): Promise<unknown> {
  return cmdbuildRequest(config, userToken, 'GET', `classes/${encodeURIComponent(config.demoClass)}/cards?limit=${limit}`);
}

export async function readDemoCard(config: CmdbuildApiConfig, userToken: string): Promise<unknown> {
  if (!config.demoCardId) throw new CmdbuildApiError(409, 'cmdbuild_demo_card_not_configured');
  return cmdbuildRequest(
    config,
    userToken,
    'GET',
    `classes/${encodeURIComponent(config.demoClass)}/cards/${encodeURIComponent(config.demoCardId)}`
  );
}

export async function updateDemoCard(
  config: CmdbuildApiConfig,
  userToken: string,
  attribute: string,
  value: string
): Promise<unknown> {
  if (!config.demoCardId) throw new CmdbuildApiError(409, 'cmdbuild_demo_card_not_configured');
  if (!config.writableAttributes.has(attribute)) throw new CmdbuildApiError(403, 'cmdbuild_attribute_not_allowlisted');
  return cmdbuildRequest(
    config,
    userToken,
    'PUT',
    `classes/${encodeURIComponent(config.demoClass)}/cards/${encodeURIComponent(config.demoCardId)}`,
    { [attribute]: value }
  );
}

export function forwardedTokenFingerprint(token: string): string {
  return fingerprint(token);
}
