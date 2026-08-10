import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, ADMIN_SESSION_COOKIE, type AdminIdentity } from './admin-auth.service';

/**
 * Authorizes /sysadmin endpoints via the admin_session cookie. Wallet
 * (app_session) cookies have no access here — separate identity (§18.3).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { admin?: AdminIdentity }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
    if (!token) throw new UnauthorizedException('admin authentication required');

    const admin = await this.auth.verifySession(token);
    if (!admin) throw new UnauthorizedException('invalid or expired admin session');

    req.admin = admin;
    return true;
  }
}
