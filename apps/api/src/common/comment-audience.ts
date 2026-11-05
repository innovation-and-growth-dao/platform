// §27/§30 — who may comment on a document (rule document or document-for-comment). Three ascending
// tiers, author-chosen:
//   BOARD    — board members only
//   MEMBERS  — board members + admitted DReps + approved experts
//   EVERYONE — anyone signed in (any wallet)
// Legacy §30 values are mapped so existing rows keep working without a data migration:
//   DREPS → MEMBERS, ANY_WALLET / null / unknown → EVERYONE.
import type { PrismaService } from '../prisma/prisma.service';

export type CommentAudience = 'BOARD' | 'MEMBERS' | 'EVERYONE';

export function normalizeAudience(a: string | null | undefined): CommentAudience {
  if (a === 'BOARD') return 'BOARD';
  if (a === 'MEMBERS' || a === 'DREPS') return 'MEMBERS';
  return 'EVERYONE';
}

/** Can this signed-in user comment given the document's audience setting? */
export async function canCommentWith(
  prisma: PrismaService,
  userId: string,
  audience: string | null | undefined,
): Promise<boolean> {
  const a = normalizeAudience(audience);
  if (a === 'EVERYONE') return true;

  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { drepKeyHash: true } });
  if (user?.drepKeyHash) {
    const seat = await prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash }, select: { id: true } });
    if (seat) return true; // board member — allowed by every tier
  }
  if (a === 'BOARD') return false;

  // MEMBERS: also an admitted DRep or an approved, still-active expert.
  const drep = await prisma.drep.findUnique({ where: { userId }, select: { status: true } });
  if (drep?.status === 'ADMITTED') return true;
  const expert = await prisma.expert.findFirst({ where: { userId, approvedByBoard: true, leftAt: null }, select: { id: true } });
  return !!expert;
}
