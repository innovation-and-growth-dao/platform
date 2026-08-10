import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { MeritService } from './merit.service';
import { MeritSweepService } from './merit-sweep.service';

class AvoidPeriodDto {
  @IsString() startsAt!: string; // ISO
  @IsString() endsAt!: string; // ISO
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

@Controller()
export class MeritController {
  constructor(
    private readonly merit: MeritService,
    private readonly sweep: MeritSweepService,
  ) {}

  /** §13 — the signed-in DRep's current merit + recent ledger. */
  @UseGuards(JwtAuthGuard)
  @Get('me/merit')
  myMerit(@CurrentUser() ctx: AuthContext) {
    return this.merit.myMerit(ctx.userId);
  }

  // §13.4 — avoid-period ("vacancy") signalling: while active, the DRep isn't
  // assigned to filtering/milestone review and missed D&V votes aren't penalized.
  @UseGuards(JwtAuthGuard)
  @Get('me/avoid-periods')
  listAvoid(@CurrentUser() ctx: AuthContext) {
    return this.merit.listAvoidPeriods(ctx.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/avoid-period')
  setAvoid(@CurrentUser() ctx: AuthContext, @Body() dto: AvoidPeriodDto) {
    return this.merit.setAvoidPeriod(ctx.userId, dto.startsAt, dto.endsAt, dto.reason);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/avoid-period/:id')
  removeAvoid(@CurrentUser() ctx: AuthContext, @Param('id') id: string) {
    return this.merit.removeAvoidPeriod(ctx.userId, id);
  }

  /** Run the merit sweep on demand (it also runs hourly). Board-gated. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/merit/sweep')
  async runSweep() {
    await this.sweep.run();
    return { ok: true };
  }
}
