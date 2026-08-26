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
import { StepUpGuard } from './step-up.guard';
import { CurrentAdmin } from './current-admin.decorator';
import { Admin2faDto, AdminLoginDto, TwoFaCodeDto } from './dto';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';

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
    // SEC-06 — trust the framework's req.ip (Express 'trust proxy' is configured to our edge in main.ts); do not read raw x-forwarded-for.
    return req.ip;
  }

  @Post('login')
  // SEC-06 — no per-username limit here (an anon attacker could weaponize it to lock a real admin);
  // account safety is the progressive per-(username, ip) backoff in AdminAuthService. Keep a broad
  // per-IP ceiling to blunt a single-source brute force.
  @RateLimit({ points: 30, durationSec: 60, by: 'ip', failClosed: true })
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
  @RateLimit({ points: 10, durationSec: 60, by: 'ip', failClosed: true })
  async login2fa(@Body() dto: Admin2faDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { sessionToken, admin } = await this.auth.complete2fa(dto.pendingToken, dto.code);
    this.setSession(res, sessionToken);
    await this.audit.log({ adminId: admin.adminId, action: 'LOGIN_2FA', ip: this.clientIp(req) });
    return { status: 'ok', admin };
  }

  @Post('login/recovery')
  @RateLimit({ points: 10, durationSec: 60, by: 'ip', failClosed: true })
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
  async me(@CurrentAdmin() admin: AdminIdentity) {
    return { ...admin, twoFaEnabled: await this.auth.adminHasTwoFa(admin.adminId) };
  }

  // SEC-03 — self-service 2FA enrollment (needed for step-up on privileged actions).
  @UseGuards(AdminGuard)
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' })
  @Post('2fa/setup')
  twoFaSetup(@CurrentAdmin() admin: AdminIdentity) {
    return this.auth.beginTwoFaSetup(admin.adminId, admin.username);
  }

  @UseGuards(AdminGuard)
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' })
  @Post('2fa/enable')
  twoFaEnable(@CurrentAdmin() admin: AdminIdentity, @Body() dto: TwoFaCodeDto) {
    return this.auth.enableTwoFa(admin.adminId, dto.code);
  }

  // SEC-03 — disabling 2FA is itself step-up-gated (needs a fresh code), so a stolen session can't remove it.
  @UseGuards(AdminGuard, StepUpGuard)
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' })
  @Post('2fa/disable')
  twoFaDisable(@CurrentAdmin() admin: AdminIdentity) {
    return this.auth.disableTwoFa(admin.adminId);
  }

  private setSession(res: Response, token: string) {
    res.cookie(ADMIN_SESSION_COOKIE, token, adminCookieOptions(process.env.NODE_ENV === 'production'));
  }
}
