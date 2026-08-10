import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Single source of truth for "is this user an active board member?" (§17/§25.5):
 * the user's CIP-95 DRep key hash holds a non-removed board seat. Used by BoardGuard
 * and by services that need a boolean instead of a thrown 403.
 */
@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

  async isBoardMember(userId: string): Promise<boolean> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { drepKeyHash: true } });
    if (!user?.drepKeyHash) return false;
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash } });
    return !!seat;
  }
}
