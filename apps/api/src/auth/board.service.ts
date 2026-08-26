import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isProvenDrepRequired } from './drep-link.service';

/**
 * Single source of truth for "is this user an active board member?" (§17/§25.5):
 * the user's CIP-95 DRep key hash holds a non-removed board seat. Used by BoardGuard
 * and by services that need a boolean instead of a thrown 403.
 */
@Injectable()
export class BoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async isBoardMember(userId: string): Promise<boolean> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { drepKeyHash: true, drepKeyProvenAt: true },
    });
    if (!user?.drepKeyHash) return false;
    // SEC-01 — when enabled, only a cryptographically proven DRep binding grants board authority.
    if (isProvenDrepRequired(this.config) && !user.drepKeyProvenAt) return false;
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash } });
    return !!seat;
  }

  async isBoardSeated(): Promise<boolean> {
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null }, select: { id: true } });
    return !!seat;
  }

  // The board reviews Expert/Submitter applications; while no board is seated (pre-election
  // bootstrap) an admitted DRep may review, so these human-approval-only applications never stall.
  async canReviewApplications(userId: string): Promise<boolean> {
    if (await this.isBoardMember(userId)) return true;
    if (await this.isBoardSeated()) return false;
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { status: true } });
    return drep?.status === 'ADMITTED';
  }
}
