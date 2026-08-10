import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { ProposalMessagesService } from './proposal-messages.service';
import { MessageBodyDto } from './dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProposalMessagesController {
  constructor(private readonly svc: ProposalMessagesService) {}

  // Board opens a new message thread on a proposal.
  @Post('proposals/:proposalId/messages')
  @UseGuards(BoardGuard)
  start(@CurrentUser() ctx: AuthContext, @Param('proposalId', ParseUUIDPipe) proposalId: string, @Body() dto: MessageBodyDto) {
    return this.svc.startThread(ctx.userId, proposalId, dto.body);
  }

  // All threads on a proposal (board + submitter only).
  @Get('proposals/:proposalId/messages')
  list(@CurrentUser() ctx: AuthContext, @Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.svc.listForProposal(ctx.userId, proposalId);
  }

  // Reply within a thread (board OR the submitter).
  @Post('messages/:threadId/reply')
  reply(@CurrentUser() ctx: AuthContext, @Param('threadId', ParseUUIDPipe) threadId: string, @Body() dto: MessageBodyDto) {
    return this.svc.addEntry(ctx.userId, threadId, dto.body);
  }

  // Board marks a thread DONE → history.
  @Post('messages/:threadId/done')
  @UseGuards(BoardGuard)
  done(@CurrentUser() ctx: AuthContext, @Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.svc.markDone(ctx.userId, threadId);
  }

  // Board to-do: threads where the submitter replied last.
  @Get('messages/board-pending')
  @UseGuards(BoardGuard)
  boardPending() {
    return this.svc.boardPending();
  }

  // Board: every thread (active + done) for the all-messages screen.
  @Get('messages/board-all')
  @UseGuards(BoardGuard)
  boardAll() {
    return this.svc.boardAll();
  }

  // Submitter's My-Area Messages.
  @Get('my/messages')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.svc.mySubmitterThreads(ctx.userId);
  }
}
