import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { decryptSecret } from '../common/secret-cipher';
import { verifyTotp } from './admin-crypto';
import type { AdminIdentity } from './admin-auth.service';

// SEC-03 — step-up authentication for high-impact admin actions (hot-wallet sweep, seed rotation,
// genesis approval, admin lifecycle). A live admin session is NOT enough: the caller must present a
// FRESH TOTP code from the admin's 2FA at action time, so a stolen cookie / XSS can't perform them.
// Runs AFTER AdminGuard (which sets req.admin). The code is single-use within its validity window.
const STEP_UP_HEADER = 'x-stepup-totp';

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { admin?: AdminIdentity }>();
    const adminId = req.admin?.adminId;
    if (!adminId) throw new UnauthorizedException('admin authentication required');

    const twoFa = await this.prisma.admin2fa.findUnique({ where: { adminId } });
    if (!twoFa) {
      // TOTP is the only step-up factor; without 2FA the action cannot be authorized.
      throw new ForbiddenException({ error: 'step_up_2fa_not_enrolled', message: 'Enable two-factor authentication to perform this action.' });
    }

    const code = (req.headers[STEP_UP_HEADER] as string | undefined)?.trim();
    if (!code) {
      throw new HttpException({ error: 'step_up_required', message: 'A fresh 2FA code is required for this action.' }, HttpStatus.UNAUTHORIZED);
    }

    const secret = decryptSecret(twoFa.totpSecret) ?? '';
    if (!verifyTotp(secret, code)) {
      throw new HttpException({ error: 'step_up_invalid', message: 'That 2FA code is not valid.' }, HttpStatus.UNAUTHORIZED);
    }

    // Single-use: reserve this code for ~90s (covers the ±1-step validation window) so a captured
    // code can't be replayed on a second privileged action.
    const reserved = await this.redis.client.set(`stepup:used:${adminId}:${code}`, '1', 'EX', 90, 'NX');
    if (reserved === null) {
      throw new HttpException({ error: 'step_up_replay', message: 'That 2FA code was already used — wait for the next one.' }, HttpStatus.UNAUTHORIZED);
    }

    return true;
  }
}
