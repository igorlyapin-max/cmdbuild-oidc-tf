import { appendFile, mkdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { json, readJson } from './http.js';

const port = Number.parseInt(process.env.LOG_COLLECTOR_PORT ?? '18101', 10);
const directory = process.env.LOG_DIRECTORY ?? '/var/lib/cmdbuild-oidc-tf-logs';
const logPath = join(directory, 'structured.jsonl');
const sensitiveKey = /(authorization|token|secret|password|cookie|code_verifier|id_token|access_token)/i;

function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && pathname === '/health') {
    json(response, 200, { status: 'ok', service: 'log-collector' });
    return;
  }
  if (request.method === 'POST' && pathname === '/v1/logs') {
    try {
      const record = redact(await readJson(request));
      await appendFile(logPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      json(response, 202, { accepted: true });
    } catch {
      json(response, 400, { accepted: false });
    }
    return;
  }
  json(response, 404, { error: 'not_found' });
}

async function main(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LOG_COLLECTOR_PORT must be a TCP port');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const server = createServer((request, response) => void handle(request, response));
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', service: 'log-collector', event: 'service.started', port })}\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch(error => {
  process.stderr.write(`${JSON.stringify({ service: 'log-collector', level: 'error', event: 'startup.failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
  process.exit(1);
});
