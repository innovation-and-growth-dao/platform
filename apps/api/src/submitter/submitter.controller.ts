import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { ApplicationReviewGuard } from '../auth/application-review.guard';
import { SubmitterService } from './submitter.service';
import { RejectSubmitterDto, SetSubmitterLinkDto, SubmitterApplicationDto } from './dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeSubmitterController {
  constructor(private readonly svc: SubmitterService) {}

  @Post('submitter-application')
  apply(@CurrentUser() ctx: AuthContext, @Body() dto: SubmitterApplicationDto) {
    return this.svc.apply(ctx.userId, dto);
  }

  @Get('submitter')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.svc.mine(ctx.userId);
  }

  // §3 — validate a payout/refund address + flag whether it's the submitter's own wallet.
  @Get('check-payout-address')
  checkPayoutAddress(@CurrentUser() ctx: AuthContext, @Query('address') address?: string) {
    return this.svc.checkAddress(ctx.userId, address ?? '');
  }

  // §2.1 — an approved submitter deregisters (blocked while proposals are in flight).
  @Post('submitter/leave')
  leave(@CurrentUser() ctx: AuthContext) {
    return this.svc.leave(ctx.userId);
  }
}

@Controller('dao')
@UseGuards(JwtAuthGuard)
export class DaoSubmittersController {
  constructor(private readonly svc: SubmitterService) {}

  // §2.1 — public (logged-in) directory of approved submitters (+ left ones on demand).
  @Get('submitters')
  list(@Query('includeLeft') includeLeft?: string) {
    return this.svc.listApproved(includeLeft === '1' || includeLeft === 'true');
  }

  // §2.1 — a submitter's funding-proposal portfolio + stats (bottom of the profile).
  @Get('submitters/:id/portfolio')
  portfolio(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.submitterPortfolio(id);
  }

  // §2.1/§14 — count of applications awaiting board approval (count only, no content), and
  // whether a board is seated. During the pre-election "free period" submitter applications
  // queue up until the first board exists to approve them — the directory shows how many wait.
  @Get('submitters/pending-count')
  pendingCount() {
    return this.svc.pendingPublicCount();
  }
}

@Controller('admin/submitters')
@UseGuards(JwtAuthGuard)
export class BoardSubmittersController {
  constructor(private readonly svc: SubmitterService) {}

  @Get('applications')
  @UseGuards(ApplicationReviewGuard)
  list(@Query('history') history?: string) {
    return this.svc.listApplications(history === '1' || history === 'true');
  }

  @Post(':id/approve')
  @UseGuards(ApplicationReviewGuard)
  approve(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(id, ctx.userId);
  }

  @Post(':id/reject')
  @UseGuards(ApplicationReviewGuard)
  reject(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectSubmitterDto) {
    return this.svc.reject(id, dto.reason, ctx.userId);
  }

  // §2 — board override of a submitter's cross-wallet link to a DAO member (set or clear).
  @Patch(':id/link')
  @UseGuards(BoardGuard)
  setLink(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSubmitterLinkDto) {
    return this.svc.setLink(id, dto.linkedDrepIdOnchain ?? null);
  }
}
