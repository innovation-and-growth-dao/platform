import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { drepKeyHashFromPubKeyHex, isStakeAddress, stakeKeyHashFromBech32 } from '@drep-dao/cardano';
import { NonceService } from './nonce.service';
import { DrepLinkService } from './drep-link.service';
import { AuthService, SESSION_COOKIE } from './auth.service';
import { UsersService } from '../users/users.service';
import { DrepChallengeDto, DrepVerifyDto, NonceRequestDto, VerifyRequestDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { CurrentUser, AuthContext } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly nonce: NonceService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly drepLink: DrepLinkService,
  ) {}

  // POST /api/v1/auth/nonce → message for the wallet to sign
  @Post('nonce')
  @RateLimit({ points: 5, durationSec: 60, by: 'ip' }, { points: 3, durationSec: 60, by: 'stakeBody' })
  async getNonce(@Body() dto: NonceRequestDto) {
    if (!isStakeAddress(dto.stakeAddress)) {
      throw new BadRequestException('stakeAddress must be a bech32 stake address (stake1.../stake_test1...)');
    }
    return this.nonce.issue(dto.stakeAddress);
  }

  // POST /api/v1/auth/verify → check CIP-8 signature, set session cookie
  @Post('verify')
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' }, { points: 5, durationSec: 60, by: 'stakeBody' })
  async verify(@Body() dto: VerifyRequestDto, @Res({ passthrough: true }) res: Response) {
    if (!isStakeAddress(dto.stakeAddress)) {
      throw new BadRequestException('stakeAddress must be a bech32 stake address');
    }

    const message = await this.nonce.consume(dto.stakeAddress);
    if (!message) {
      throw new UnauthorizedException('nonce expired or already used — request a new one');
    }

    const ok = this.auth.verifyWalletSignature({
      signature: dto.signature,
      key: dto.key,
      message,
      stakeAddress: dto.stakeAddress,
    });
    if (!ok) throw new UnauthorizedException('signature verification failed');

    const stakeKeyHash = stakeKeyHashFromBech32(dto.stakeAddress);
    const drepKeyHash = dto.drepKeyHex ? safeDrepKeyHash(dto.drepKeyHex) : undefined;
    const user = await this.users.upsertByStakeKey({
      stakeKeyHash,
      stakeAddress: dto.stakeAddress,
      drepKeyHash,
    });

    const token = await this.auth.issueSession(user);
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions());

    const profile = await this.users.getProfile(user.id);
    return profile;
  }

  // POST /api/v1/auth/drep/challenge → SEC-01: issue a challenge to prove DRep-key ownership
  @UseGuards(JwtAuthGuard)
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' })
  @Post('drep/challenge')
  async drepChallenge(@CurrentUser() ctx: AuthContext, @Body() dto: DrepChallengeDto) {
    return this.drepLink.issueChallenge(ctx.userId, ctx.stakeKeyHash, dto.drepKeyHex);
  }

  // POST /api/v1/auth/drep/verify → SEC-01: verify the DRep-key signature, record a proven binding
  @UseGuards(JwtAuthGuard)
  @RateLimit({ points: 10, durationSec: 60, by: 'ip' })
  @Post('drep/verify')
  async drepVerify(@CurrentUser() ctx: AuthContext, @Body() dto: DrepVerifyDto) {
    const result = await this.drepLink.verifyChallenge({
      userId: ctx.userId,
      drepKeyHex: dto.drepKeyHex,
      signature: dto.signature,
      key: dto.key,
    });
    const profile = await this.users.getProfile(ctx.userId);
    return { ...result, profile };
  }

  // GET /api/v1/auth/me → current user, roles, DRep status
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() ctx: AuthContext) {
    const profile = await this.users.getProfile(ctx.userId);
    if (!profile) throw new UnauthorizedException();
    return profile;
  }

  // POST /api/v1/auth/logout → revoke session
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() ctx: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.revoke(ctx.payload);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }
}

/** Derive the DRep key hash from a CIP-95 pubkey hex; ignore malformed input. */
function safeDrepKeyHash(drepKeyHex: string): string | undefined {
  try {
    return drepKeyHashFromPubKeyHex(drepKeyHex);
  } catch {
    return undefined;
  }
}
