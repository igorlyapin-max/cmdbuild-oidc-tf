import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 128 * 1024;

export function hostAllowed(request: IncomingMessage, allowedHosts: Set<string>): boolean {
  const host = request.headers.host?.split(':')[0]?.toLowerCase();
  return Boolean(host && allowedHosts.has(host));
}

export async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(request);
  if (raw.length === 0) return undefined;
  return JSON.parse(raw.toString('utf8'));
}

export function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(value));
}

export function text(response: ServerResponse, status: number, value: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(value);
}

export function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
}
