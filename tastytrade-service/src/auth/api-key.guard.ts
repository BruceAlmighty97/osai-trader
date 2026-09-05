import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

const API_KEY_HEADER = 'x-api-key';

/**
 * Global guard: every route requires a valid `X-API-Key` header matching the
 * API_KEY env var (sourced from the osai-trader/api-key secret in prod). Routes
 * marked with @Public() are exempt.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const expected = process.env.API_KEY;
    if (!expected) {
      // Misconfiguration: fail closed in prod, but stay usable in local dev.
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('API_KEY is not set — denying all requests.');
        throw new UnauthorizedException();
      }
      this.logger.warn('API_KEY not set — API-key auth disabled (non-production).');
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header(API_KEY_HEADER);
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}

/** Constant-time comparison to avoid leaking the key via response timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
