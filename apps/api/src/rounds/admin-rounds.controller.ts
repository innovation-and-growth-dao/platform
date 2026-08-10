import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { RoundsService } from './rounds.service';
import { CreateRoundDto, UpdateRoundDto, ConfirmStageDto, UpdateCurrentStageDto } from './dto';

// §26.5 — board-only round configuration (Round Preparation, §6).
@Controller('admin/rounds')
@UseGuards(JwtAuthGuard, BoardGuard)
export class AdminRoundsController {
  constructor(private readonly rounds: RoundsService) {}

  @Post()
  create(@Body() dto: CreateRoundDto) {
    return this.rounds.create(dto);
  }

  // §6/§8 — count of overdue stage starts (board to-do badge).
  @Get('overdue-stages')
  async overdueStages() {
    return { count: await this.rounds.countOverdueStages() };
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoundDto) {
    return this.rounds.update(id, dto);
  }

  @Post(':id/start-stage/:stage')
  startStage(@Param('id', ParseUUIDPipe) id: string, @Param('stage') stage: string) {
    return this.rounds.startStage(id, stage);
  }

  // §8 — confirm the next stage (auto-start at the date, or manual launch).
  @Post(':id/stages/:stageKey/confirm')
  confirmStage(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageKey') stageKey: string,
    @Body() dto: ConfirmStageDto,
  ) {
    return this.rounds.confirmStage(id, stageKey, dto, ctx.userId);
  }

  // §6 — update a FUTURE stage's planned start/end without advancing the round.
  // Distinct from confirm: used for stages strictly after the immediate-next one.
  @Patch(':id/stages/:stageKey/plan')
  updatePlannedStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageKey') stageKey: string,
    @Body() dto: ConfirmStageDto,
  ) {
    return this.rounds.updatePlannedStage(id, stageKey, {
      startsAt: dto.startsAt!,
      endsAt: dto.endsAt!,
      autoStart: dto.autoStart,
    });
  }

  // §6 — board shortens or extends the currently-running stage (start is frozen).
  @Patch(':id/current-stage')
  updateCurrentStage(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCurrentStageDto,
  ) {
    return this.rounds.updateCurrentStageWindow(id, dto, ctx.userId);
  }

  // §8 — launch the next stage now (board member's explicit early/on-time action).
  @Post(':id/launch-next')
  launchNext(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rounds.launchNextStage(id, ctx.userId);
  }

  // §8 — close the round (the funding stage end is confirmed manually).
  @Post(':id/close')
  close(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.rounds.closeRound(id, ctx.userId);
  }
}
