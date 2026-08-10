import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { DrepService } from './drep.service';
import { SetMemberLinkDto } from './dto';

// §2/§4 — DAO member overview (board + admitted DReps) with balanced voting power.
@Controller('dao')
@UseGuards(JwtAuthGuard)
export class DaoController {
  constructor(private readonly drep: DrepService) {}

  @Get('members')
  members() {
    return this.drep.listDaoMembers();
  }

  @Get('members/:drepId')
  member(@Param('drepId') drepId: string) {
    return this.drep.getDaoMemberDetail(drepId);
  }

  // §2 — board override of a DAO member's cross-wallet link to a submitter (set or clear).
  @Patch('members/:drepId/link')
  @UseGuards(BoardGuard)
  setLink(@Param('drepId') drepId: string, @Body() dto: SetMemberLinkDto) {
    return this.drep.setSubmitterLink(drepId, dto.linkedSubmitterUserId ?? null);
  }

  @Get('experts')
  experts() {
    return this.drep.listApprovedExperts();
  }

  @Get('proofs')
  proofs() {
    return this.drep.listOnChainProofs();
  }
}
