import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { SESSION_COOKIE } from '../auth/auth.service';
import { ActivityTracker } from './activity.tracker';

/**
 * §26 — stamp every real user request into the ActivityTracker so the deploy-guard readiness
 * probe can tell whether the platform is in use. Excludes the probe itself, health/metrics and
 * CORS preflights so a merely-polling deploy script or monitor never registers as "a user".
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly tracker: ActivityTracker) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const path = (req.baseUrl || '') + (req.path || req.url || '');
    const skip =
      req.method === 'OPTIONS' ||
      path.includes('/internal/deploy/readiness') ||
      path.includes('/maintenance/status') ||
      path.includes('/healthz') ||
      path.includes('/internal/metrics');
    if (!skip) {
      const cookie = (req.cookies?.[SESSION_COOKIE] as string | undefined) ?? null;
      const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
      const client = cookie ? `s:${cookie.slice(0, 12)}` : `ip:${xff || req.ip || 'anon'}`;
      this.tracker.record(client, req.method, path);
    }
    return next.handle();
  }
}
