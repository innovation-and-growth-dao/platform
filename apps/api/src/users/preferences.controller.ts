import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { UsersService } from './users.service';

export class PreferencesDto {
  @IsOptional() @IsIn(['cardanoscan', 'cexplorer', 'adastat', '']) explorer?: string;
  @IsOptional() @IsString() @MaxLength(300) explorerCustomTxUrl?: string;
}

export class RewardAddressDto {
  @IsOptional() @IsString() @MaxLength(200) address?: string | null;
}

/** §20 — per-user personal preferences (My area). */
@Controller()
@UseGuards(JwtAuthGuard)
export class PreferencesController {
  constructor(private readonly users: UsersService) {}

  @Get('me/preferences')
  get(@CurrentUser() ctx: AuthContext) {
    return this.users.getPreferences(ctx.userId);
  }

  @Patch('me/preferences')
  set(@CurrentUser() ctx: AuthContext, @Body() dto: PreferencesDto) {
    return this.users.setPreferences(ctx.userId, dto);
  }

  /** §15.4 — DReps' reward payment address (also used by board members). */
  @Get('me/reward-address')
  getRewardAddress(@CurrentUser() ctx: AuthContext) {
    return this.users.getRewardPaymentAddress(ctx.userId);
  }

  @Patch('me/reward-address')
  async setRewardAddress(@CurrentUser() ctx: AuthContext, @Body() dto: RewardAddressDto) {
    try {
      return await this.users.setRewardPaymentAddress(ctx.userId, dto.address ?? null);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'invalid address');
    }
  }
}
