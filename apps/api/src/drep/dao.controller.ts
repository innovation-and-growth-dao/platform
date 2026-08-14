import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { DrepService } from './drep.service';
import { SetMemberLinkDto } from './dto';

// §2/§4 — DAO member overview (board + admitted DReps) with balanced voting power.
// The member directory, per-member detail and on-chain proofs are public read-only
// (optional auth) so anyone can inspect the DAO; a member's PRIVATE contact is redacted
// for anonymous viewers, and the experts directory (which carries email/telegram) stays
// login-only.
@Controller('dao')
export class DaoController {
  constructor(private readonly drep: DrepService) {}

  @Get('members')
  @UseGuards(OptionalJwtAuthGuard)
  members() {
    return this.drep.listDaoMembers();
  }

  @Get('members/:drepId')
  @UseGuards(OptionalJwtAuthGuard)
  member(@Param('drepId') drepId: string, @CurrentUser() ctx?: AuthContext) {
    return this.drep.getDaoMemberDetail(drepId, { includeContact: !!ctx });
  }

  // §2 — board override of a DAO member's cross-wallet link to a submitter (set or clear).
  @Patch('members/:drepId/link')
  @UseGuards(JwtAuthGuard, BoardGuard)
  setLink(@Param('drepId') drepId: string, @Body() dto: SetMemberLinkDto) {
    return this.drep.setSubmitterLink(drepId, dto.linkedSubmitterUserId ?? null);
  }

  @Get('experts')
  @UseGuards(JwtAuthGuard)
  experts() {
    return this.drep.listApprovedExperts();
  }

  @Get('proofs')
  @UseGuards(OptionalJwtAuthGuard)
  proofs() {
    return this.drep.listOnChainProofs();
  }
}
