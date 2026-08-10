import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, SESSION_COOKIE } from './auth.service';
import type { AuthContext } from './current-user.decorator';

/**
 * Like JwtAuthGuard, but never rejects: if a valid session cookie is present it
 * attaches AuthContext, otherwise it lets the request through unauthenticated.
 * Used on public reads that show extra data to the owner (e.g. a submitter's own
 * private DRAFT/PENDING proposal).
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthContext }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (token) {
      const payload = await this.auth.verifyToken(token);
      if (payload) req.user = { userId: payload.sub, stakeKeyHash: payload.skh, payload };
    }
    return true;
  }
}
