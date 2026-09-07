import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/** Field/header names whose values must never reach the logs. */
const SECRET_PATTERN =
  /(authorization|api[-_]?key|token|secret|password|passwd|credential)/i;

/** Response bodies are truncated so one fat payload can't flood CloudWatch. */
const MAX_BODY_CHARS = 1500;

/**
 * Logs every inbound request and its response — method, path, query, body,
 * status, duration. See "Coding Guidelines — Logging" in CLAUDE.md.
 *
 * Secrets are redacted rather than omitted, so it's visible that a credential was
 * present without leaking it: logs go to CloudWatch, a far wider audience than
 * the secret store.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest();
    const method = req.method;
    const url = req.originalUrl ?? req.url;
    const started = Date.now();

    const parts: string[] = [`--> ${method} ${url}`];
    const body = redact(req.body);
    if (body && Object.keys(body).length) {
      parts.push(`body=${truncate(JSON.stringify(body))}`);
    }
    this.logger.log(parts.join(' '));

    return next.handle().pipe(
      tap({
        next: (data) => {
          const status = http.getResponse()?.statusCode;
          this.logger.log(
            `<-- ${method} ${url} ${status} ${Date.now() - started}ms ${describe(data)}`,
          );
        },
        error: (err) => {
          const status = err?.status ?? err?.statusCode ?? 500;
          this.logger.error(
            `<-- ${method} ${url} ${status} ${Date.now() - started}ms FAILED: ${
              err?.message ?? String(err)
            }`,
          );
        },
      }),
    );
  }
}

/** Deep-copy with sensitive values replaced. */
function redact(value: unknown, depth = 0): any {
  if (value === null || value === undefined || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_PATTERN.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

/** Short, useful shape of a response rather than a full dump. */
function describe(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (Array.isArray(data)) {
    return `[${data.length} items] ${truncate(JSON.stringify(redact(data)))}`;
  }
  if (typeof data === 'object') {
    return truncate(JSON.stringify(redact(data)));
  }
  return truncate(String(data));
}

function truncate(s: string): string {
  return s.length > MAX_BODY_CHARS
    ? `${s.slice(0, MAX_BODY_CHARS)}…(+${s.length - MAX_BODY_CHARS} chars)`
    : s;
}
