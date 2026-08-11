import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, access, mkdir, rename, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { json, readRawBody } from './http.js';

const port = Number.parseInt(process.env.LOG_COLLECTOR_PORT ?? '18101', 10);
const directory = process.env.LOG_DIRECTORY ?? '/var/lib/cmdbuild-oidc-tf-logs';
const logPath = join(directory, 'structured.jsonl');
const sensitiveKey = /(authorization|token|secret|password|cookie|code_verifier|id_token|access_token)/i;
const maxLogBytes = 10 * 1024 * 1024;
const maxRotatedFiles = 5;
const hmacKeyPath = process.env.LOG_COLLECTOR_HMAC_KEY_FILE;
const hmacKey = hmacKeyPath ? readFileSync(hmacKeyPath, 'utf8').trim() : '';
let storageReady = false;

function redact(value: unknown, key?: string): unknown {
  if (key && sensitiveKey.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

function signatureValid(body: Buffer, signature: string | undefined): boolean {
  if (!hmacKey || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(createHmac('sha256', hmacKey).update(body).digest('hex'), 'utf8');
  const received = Buffer.from(signature, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function rotateIfNeeded(nextRecordBytes: number): Promise<void> {
  try {
    const current = await stat(logPath);
    if (current.size + nextRecordBytes <= maxLogBytes) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (let index = maxRotatedFiles - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    const target = `${logPath}.${index + 1}`;
    try {
      await rename(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await rename(logPath, `${logPath}.1`);
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && pathname === '/health') {
    json(response, storageReady ? 200 : 503, {
      status: storageReady ? 'ok' : 'not_ready',
      service: 'log-collector',
      storage_ready: storageReady
    });
    return;
  }
  if (request.method === 'POST' && pathname === '/v1/logs') {
    try {
      const raw = await readRawBody(request);
      const signature = request.headers['x-log-signature'];
      const signatureValue = Array.isArray(signature) ? signature[0] : signature;
      if (!signatureValid(raw, signatureValue)) {
        json(response, 401, { accepted: false, error: 'invalid_log_signature' });
        return;
      }
      let record: unknown;
      try {
        record = redact(JSON.parse(raw.toString('utf8')));
      } catch {
        json(response, 400, { accepted: false, error: 'invalid_log_record' });
        return;
      }
      const line = `${JSON.stringify(record)}\n`;
      try {
        await rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(logPath, line, { encoding: 'utf8', mode: 0o600 });
        storageReady = true;
      } catch {
        storageReady = false;
        json(response, 503, { accepted: false, error: 'log_storage_unavailable' });
        return;
      }
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
  if (!hmacKey) throw new Error('LOG_COLLECTOR_HMAC_KEY_FILE must reference a readable configured secret file');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await access(directory, fsConstants.W_OK);
  storageReady = true;
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
