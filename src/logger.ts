import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { DiagnosticLevel } from './config.js';

type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue | readonly string[]>;

const SENSITIVE_KEY = /(authorization|token|secret|password|cookie|code_verifier|id_token|access_token)/i;
const sinkFailures = new Map<string, number>();

function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]));
  }
  return value;
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export class Logger {
  readonly requestId = randomUUID();

  constructor(
    private readonly service: string,
    private readonly sinkUrl: string,
    private readonly sinkHmacKey: string,
    private readonly level: DiagnosticLevel
  ) {}

  info(event: string, fields: LogFields = {}): void {
    this.emit('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.emit('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.emit('error', event, fields);
  }

  verbose(event: string, fields: LogFields = {}): void {
    if (this.level === 'verbose') this.emit('debug', event, fields);
  }

  private emit(level: 'debug' | 'info' | 'warn' | 'error', event: string, fields: LogFields): void {
    const record = redact({
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      event,
      request_id: this.requestId,
      ...fields
    }) as Record<string, unknown>;
    process.stdout.write(`${JSON.stringify(record)}\n`);
    void this.deliver(record);
  }

  private async deliver(record: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify(record);
    try {
      const response = await fetch(this.sinkUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-log-signature': createHmac('sha256', this.sinkHmacKey).update(body).digest('hex')
        },
        body,
        signal: AbortSignal.timeout(1500)
      });
      if (!response.ok) throw new Error(`log sink returned ${response.status}`);
      sinkFailures.set(this.sinkUrl, 0);
    } catch {
      // The structured stdout record is retained. Never recurse by logging a sink failure.
      sinkFailures.set(this.sinkUrl, (sinkFailures.get(this.sinkUrl) ?? 0) + 1);
    }
  }
}

export function logSinkReady(logSinkUrl: string): boolean {
  return (sinkFailures.get(logSinkUrl) ?? 0) < 3;
}

export async function assertLogSinkHealthy(logSinkUrl: string): Promise<void> {
  const healthUrl = new URL(logSinkUrl);
  healthUrl.pathname = '/health';
  healthUrl.search = '';
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Log sink health check failed with HTTP ${response.status}`);
}
