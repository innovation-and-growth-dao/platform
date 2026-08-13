import { Allow, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
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

export class UpdateOnchainSourceDto {
  // Ordered source list, tried first→last on each read (e.g. ["koios","blockfrost"]).
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) @MaxLength(20, { each: true }) order?: string[];
  // Optional Koios API token (secret) — authenticates Koios for higher rate limits. Empty clears it.
  @IsOptional() @IsString() @MaxLength(400) koiosApiToken?: string;
  // Blockfrost project id (secret). Empty string clears it.
  @IsOptional() @IsString() @MaxLength(120) blockfrostProjectId?: string;
  // cardano-db-sync connection URL (secret). Empty string clears it.
  @IsOptional() @IsString() @MaxLength(500) dbsyncUrl?: string;
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

  // §22 — on-chain data source: ordered fallback + Blockfrost key + db-sync URL.
  @Get('onchain-source')
  onchainSource() {
    return this.gov.getOnchainSource();
  }

  @Patch('onchain-source')
  updateOnchainSource(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateOnchainSourceDto) {
    return this.gov.updateOnchainSource(ctx.userId, dto);
  }
}
