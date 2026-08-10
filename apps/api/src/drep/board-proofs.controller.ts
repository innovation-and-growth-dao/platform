import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { AnchorService } from '../cardano/anchor.service';

// §18 — board can force-submit anchors that were recorded but never reached the chain
// (e.g. the hot wallet was unconfigured/offline when the decision was made).
@Controller('admin/proofs')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardProofsController {
  constructor(private readonly anchor: AnchorService) {}

  @Post('submit-all')
  submitAll() {
    return this.anchor.submitAllPending();
  }

  @Post(':id/submit')
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.anchor.submitPending(id);
  }
}
