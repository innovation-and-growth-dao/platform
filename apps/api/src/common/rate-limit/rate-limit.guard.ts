import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { RATE_LIMIT_KEY, RateLimitBy, RateLimitRule } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

// SEC-05 — global guard. Routes carrying @RateLimit(...) get exactly those rules. Un-annotated
// WRITE requests (POST/PUT/PATCH/DELETE) get a generous default budget so scripted spam is capped
// without ever throttling a real participant; un-annotated GETs pass through untouched. Runs before
// route guards, so it keys off request-visible data (IP, session cookie, request body).
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_COOKIE = 'drep_session';
// Deliberately high: a human never writes this fast; a spam script does.
const DEFAULT_WRITE_RULES: RateLimitRule[] = [
  { points: 60, durationSec: 60, by: 'session' },
  { points: 120, durationSec: 60, by: 'ip' },
];

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const explicit = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Explicit rules win. Otherwise apply the default write budget to public/member state-changing
    // requests only — admin/internal routes are trusted (admin-authenticated) and may legitimately
    // burst (e.g. approving many applications), so they are exempt from the blanket default.
    const isPrivileged = /\/(sysadmin|admin|internal)(\/|$)/.test(req.path);
    const rules = explicit?.length
      ? explicit
      : WRITE_METHODS.has(req.method) && !isPrivileged
        ? DEFAULT_WRITE_RULES
        : null;
    if (!rules) return true;

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
  if (by === 'session') {
    // Per-logged-in-identity without needing the JWT guard to have run: hash the session cookie.
    const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
    return cookie ? createHash('sha256').update(cookie).digest('hex').slice(0, 24) : undefined;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (by === 'stakeBody') return typeof body.stakeAddress === 'string' ? body.stakeAddress : undefined;
  if (by === 'accountBody') return typeof body.username === 'string' ? body.username.toLowerCase() : undefined;
  return undefined;
}
