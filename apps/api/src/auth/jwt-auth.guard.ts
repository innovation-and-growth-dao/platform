import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, SESSION_COOKIE } from './auth.service';
import type { AuthContext } from './current-user.decorator';

/** Authenticates a request from the session cookie and attaches AuthContext. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthContext }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('not authenticated');

    const payload = await this.auth.verifyToken(token);
    if (!payload) throw new UnauthorizedException('invalid or expired session');

    req.user = { userId: payload.sub, stakeKeyHash: payload.skh, payload };
    return true;
  }
}
