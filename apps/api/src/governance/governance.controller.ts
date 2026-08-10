import { Allow, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { GovernanceService } from './governance.service';
import { AnchorService } from '../cardano/anchor.service';

export class UpdateParamDto {
  @IsString() @IsNotEmpty() @MaxLength(80) key!: string;
  @Allow() value!: unknown;
}

// §6/§28 — board configures platform governance parameters.
@Controller('admin/governance')
@UseGuards(JwtAuthGuard, BoardGuard)
export class GovernanceController {
  constructor(
    private readonly gov: GovernanceService,
    private readonly anchor: AnchorService,
  ) {}

  @Get()
  list() {
    return this.gov.getParams();
  }

  @Get('wallets')
  wallets() {
    return this.anchor.walletStatus();
  }

  @Patch()
  update(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateParamDto) {
    return this.gov.updateParam(ctx.userId, dto.key, dto.value);
  }
}
