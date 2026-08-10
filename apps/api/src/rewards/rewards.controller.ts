import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { RewardsService } from './rewards.service';

class OverrideDto {
  @IsOptional() @IsNumber() @Min(0) ada?: number; // omit/null to clear the override
}
class ExpertRewardDto {
  @IsOptional() @IsNumber() @Min(0) filteringAda?: number;
  @IsOptional() @IsNumber() @Min(0) dvAda?: number;
  @IsOptional() @IsNumber() @Min(0) milestoneAda?: number;
  @IsOptional() @IsBoolean() milestoneLikeDrep?: boolean;
}
class BoardYearlyDto {
  @IsNumber() @Min(0) ada!: number;
}
class PayoutDto {
  @IsOptional() @IsString() sourceBucketId?: string;
}

@UseGuards(JwtAuthGuard, BoardGuard)
@Controller('admin/rewards')
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get('round/:roundId')
  overview(@Param('roundId') roundId: string) {
    return this.rewards.overview(roundId);
  }

  @Post('round/:roundId/compute/filtering')
  computeFiltering(@Param('roundId') roundId: string) {
    return this.rewards.computeFiltering(roundId);
  }

  @Post('round/:roundId/compute/dv')
  computeDv(@Param('roundId') roundId: string) {
    return this.rewards.computeDv(roundId);
  }

  @Post('round/:roundId/compute/milestone')
  computeMilestone(@Param('roundId') roundId: string) {
    return this.rewards.computeMilestone(roundId);
  }

  @Post('board-monthly/compute')
  computeBoardMonthly(@Body() body: { periodKey?: string }) {
    return this.rewards.computeBoardMonthly(body?.periodKey);
  }

  @Post('board-monthly/months')
  computeBoardMonths(@Body() body: { months?: number }) {
    return this.rewards.computeBoardMonths(body?.months ?? 12);
  }

  @Get('board-monthly')
  boardMonths() {
    return this.rewards.listBoardMonths();
  }

  @Post('board-monthly/reset')
  resetBoardMonths() {
    return this.rewards.resetBoardMonths();
  }

  @Patch('entry/:id')
  setOverride(@Param('id') id: string, @Body() dto: OverrideDto) {
    return this.rewards.setOverride(id, dto.ada ?? null);
  }

  @Post('calc/:id/prepare-payout')
  preparePayout(@Param('id') id: string, @Body() dto: PayoutDto) {
    return this.rewards.preparePayout(id, dto.sourceBucketId);
  }

  // ── expert reward config ──
  @Get('round/:roundId/experts')
  listExpertRewards(@Param('roundId') roundId: string) {
    return this.rewards.listExpertRewards(roundId);
  }

  @Put('round/:roundId/expert/:expertId')
  setExpertReward(@Param('roundId') roundId: string, @Param('expertId') expertId: string, @Body() dto: ExpertRewardDto) {
    return this.rewards.setExpertReward(roundId, expertId, dto);
  }

  // ── board yearly comp budget ──
  @Get('board-yearly')
  getBoardYearly() {
    return this.rewards.getBoardYearly();
  }

  @Put('board-yearly')
  setBoardYearly(@Body() dto: BoardYearlyDto) {
    return this.rewards.setBoardYearly(dto.ada);
  }
}
