import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitBy, RateLimitRule } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

// SEC-05 — global guard that enforces only the routes carrying @RateLimit(...) metadata; every
// other route passes through untouched, so normal read traffic is never throttled. Runs before
// route guards, so it keys off request-visible data (IP, request body) rather than the session.
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    for (const rule of rules) {
      const id = identity(rule.by, req);
      if (!id) continue; // dimension not resolvable for this request — skip it
      const key = `rl:${route}:${rule.by}:${id}`;
      let outcome;
      try {
        outcome = await this.limiter.hit(key, rule.points, rule.durationSec);
      } catch {
        if (rule.failClosed) {
          throw new HttpException('Rate limiter unavailable', HttpStatus.SERVICE_UNAVAILABLE);
        }
        continue; // fail open for non-privileged endpoints so a Redis blip can't lock users out
      }
      if (!outcome.allowed) {
        res.setHeader('Retry-After', String(outcome.retryAfterSec));
        throw new HttpException('Too many requests — slow down and retry later.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }
}

function identity(by: RateLimitBy, req: Request): string | undefined {
  if (by === 'ip') return req.ip; // trust proxy=1 → real client IP behind the reverse proxy
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (by === 'stakeBody') return typeof body.stakeAddress === 'string' ? body.stakeAddress : undefined;
  if (by === 'accountBody') return typeof body.username === 'string' ? body.username.toLowerCase() : undefined;
  return undefined;
}
