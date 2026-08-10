import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EDIT_WINDOW_MS = 5 * 60 * 1000; // §20.1 — editable for 5 minutes after posting

const authorSelect = {
  select: {
    id: true,
    displayName: true,
    drepKeyHash: true,
    drep: { select: { id: true, drepIdOnchain: true, status: true } },
    experts: { select: { approvedByBoard: true } },
  },
} as const;

/** §20.1 — public proposal comments: threaded one level, 5-min edit, tombstone delete. */
@Injectable()
export class CommentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Threaded list (top-level comments with one level of replies). Tombstones shown as [deleted]. */
  async list(proposalId: string, viewerUserId?: string) {
    // §20 — also fetch the proposal's submitter so each comment can be flagged
    // `isSubmitter` (the team's own posts get a distinct visual treatment).
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { submitterUserId: true, roundId: true },
    });
    const submitterUserId = proposal?.submitterUserId ?? null;
    const rows = await this.prisma.comment.findMany({
      where: { proposalId },
      orderBy: { createdAt: 'asc' },
      include: { author: authorSelect },
    });
    // §7/§20 — show each author's role (board / expert / DAO member) beside the name.
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    // §8.1 — Debate-stage comments from a DRep who is eligible to vote on this
    // round (admitted + in the round's eligibility list) get a distinct purple
    // treatment in the UI so the team can tell a voter's feedback at a glance.
    const eligibleDrepIds = proposal?.roundId
      ? new Set(
          (
            await this.prisma.roundDrepEligibility.findMany({
              where: { roundId: proposal.roundId },
              select: { drepId: true },
            })
          ).map((e) => e.drepId),
        )
      : new Set<string>();
    const roleOf = (a: (typeof rows)[number]['author']): string | null => {
      if (a.drepKeyHash && boardHashes.has(a.drepKeyHash)) return 'Board member';
      if (a.experts?.some((e) => e.approvedByBoard)) return 'Expert';
      if (a.drep?.status === 'ADMITTED') return 'DAO member';
      return null;
    };
    const view = (c: (typeof rows)[number]) => ({
      id: c.id,
      parentId: c.parentId,
      author: { displayName: c.author.displayName, drepId: c.author.drep?.drepIdOnchain ?? null, role: roleOf(c.author) },
      contentMd: c.deletedAt ? null : c.contentMd,
      deleted: !!c.deletedAt,
      createdAt: c.createdAt,
      // §20 — the team's own posts vs everyone else.
      isSubmitter: submitterUserId != null && c.authorUserId === submitterUserId,
      // Whether the (signed-in) viewer wrote this post — drives the inline
      // Edit / Delete controls. False when no viewer is supplied.
      isMine: viewerUserId != null && c.authorUserId === viewerUserId,
      // §8.1 — author is in the round's voting eligibility list (drives the
      // purple Debate-feedback styling). Board members count when they're
      // in eligibility (i.e. seated DReps); the strict opt-in (§8.2) only
      // gates ballots, not who's a voter for this purpose.
      isVotingEligible: !!c.author.drep?.id && eligibleDrepIds.has(c.author.drep.id),
    });
    // §20.1 — replies nest indefinitely. Group every comment by parentId, then
    // recursively attach so a reply-to-a-reply (and deeper) carries its own
    // `replies` array. Top-level rows have parentId === null.
    const repliesByParent = new Map<string, (typeof rows)[number][]>();
    for (const c of rows) {
      if (c.parentId) {
        const arr = repliesByParent.get(c.parentId) ?? [];
        arr.push(c);
        repliesByParent.set(c.parentId, arr);
      }
    }
    type Node = ReturnType<typeof view> & { replies: Node[] };
    const attach = (c: (typeof rows)[number]): Node => ({
      ...view(c),
      replies: (repliesByParent.get(c.id) ?? []).map(attach),
    });
    return rows.filter((c) => !c.parentId).map(attach);
  }

  async create(userId: string, proposalId: string, contentMd: string, parentId?: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { id: true } });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent || parent.proposalId !== proposalId) throw new BadRequestException('parent comment not found on this proposal');
      // §20.1 — replies can nest indefinitely. The frontend renders each level
      // with an added left border + padding so the thread tree stays readable.
    }
    const c = await this.prisma.comment.create({
      data: { proposalId, authorUserId: userId, contentMd, parentId: parentId ?? null },
    });
    return { id: c.id };
  }

  async edit(userId: string, commentId: string, contentMd: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('comment not found');
    if (c.authorUserId !== userId) throw new ForbiddenException('not your comment');
    if (c.deletedAt) throw new ConflictException('comment was deleted');
    if (Date.now() - c.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new ConflictException('the 5-minute edit window has closed');
    }
    await this.prisma.comment.update({ where: { id: commentId }, data: { contentMd } });
    return { ok: true };
  }

  /** Tombstone delete (the row remains so threads stay intact; content hidden). */
  async remove(userId: string, commentId: string) {
    const c = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('comment not found');
    if (c.authorUserId !== userId) throw new ForbiddenException('not your comment');
    if (!c.deletedAt) await this.prisma.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
