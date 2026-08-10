import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AdminAuthService,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_HOURS,
  type AdminIdentity,
} from './admin-auth.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminGuard } from './admin.guard';
import { CurrentAdmin } from './current-admin.decorator';
import { Admin2faDto, AdminLoginDto } from './dto';

function adminCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
    maxAge: ADMIN_SESSION_TTL_HOURS * 3600 * 1000,
    path: '/',
  };
}

// §26.6 — admin auth. Mounted under the global /api/v1 prefix as /api/v1/sysadmin/*.
@Controller('sysadmin')
export class SysadminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly audit: AdminAuditService,
  ) {}

  private clientIp(req: Request): string | undefined {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
  }

  @Post('login')
  async login(@Body() dto: AdminLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = this.clientIp(req);
    const result = await this.auth.login(dto.username, dto.password, ip);
    if (result.kind === '2fa_required') {
      return { status: '2fa_required', pendingToken: result.pendingToken };
    }
    this.setSession(res, result.sessionToken);
    await this.audit.log({ adminId: result.admin.adminId, action: 'LOGIN', ip, userAgent: req.headers['user-agent'] });
    return { status: 'ok', admin: result.admin };
  }

  @Post('login/2fa')
  async login2fa(@Body() dto: Admin2faDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { sessionToken, admin } = await this.auth.complete2fa(dto.pendingToken, dto.code);
    this.setSession(res, sessionToken);
    await this.audit.log({ adminId: admin.adminId, action: 'LOGIN_2FA', ip: this.clientIp(req) });
    return { status: 'ok', admin };
  }

  @Post('login/recovery')
  async loginRecovery(@Body() dto: Admin2faDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { sessionToken, admin } = await this.auth.loginRecovery(dto.pendingToken, dto.code);
    this.setSession(res, sessionToken);
    await this.audit.log({ adminId: admin.adminId, action: 'LOGIN_RECOVERY', ip: this.clientIp(req) });
    return { status: 'ok', admin };
  }

  @UseGuards(AdminGuard)
  @Post('logout')
  async logout(@CurrentAdmin() admin: AdminIdentity, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)?.[ADMIN_SESSION_COOKIE];
    if (token) await this.auth.revokeSession(token);
    res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    await this.audit.log({ adminId: admin.adminId, action: 'LOGOUT' });
    return { ok: true };
  }

  @UseGuards(AdminGuard)
  @Get('me')
  me(@CurrentAdmin() admin: AdminIdentity) {
    return admin;
  }

  private setSession(res: Response, token: string) {
    res.cookie(ADMIN_SESSION_COOKIE, token, adminCookieOptions(process.env.NODE_ENV === 'production'));
  }
}
