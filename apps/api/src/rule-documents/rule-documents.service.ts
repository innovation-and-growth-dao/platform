import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InternalProposalsService } from '../internal-proposals/internal-proposals.service';
import { BoardService } from '../auth/board.service';
import { MeritService } from '../merit/merit.service';

const sha256hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const PUBLIC_STATUSES = ['DRAFT', 'ACTIVE', 'DELETED'];

/**
 * §27 — Rule Documents. A DRep authors a document (PRIVATE, owner-only), publishes it (DRAFT,
 * public + open to feedback while the owner keeps editing), and any DRep opens a RULE_APPROVAL
 * internal vote (handled by InternalProposalsService, which freezes + anchors the content hash on
 * submit and flips the status on the outcome). This service owns the document CRUD + feedback.
 */
@Injectable()
export class RuleDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly internal: InternalProposalsService,
    private readonly board: BoardService,
    private readonly merit: MeritService,
  ) {}

  private async admittedDrep(userId: string): Promise<boolean> {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { status: true } });
    return drep?.status === 'ADMITTED';
  }

  /** Is there a rule-approval vote currently in progress for this document? (→ content is locked). */
  private async hasLiveVote(documentId: string): Promise<boolean> {
    const p = await this.prisma.proposal.findFirst({
      where: { ruleDocumentId: documentId, internalType: 'RULE_APPROVAL', status: 'ACTIVE' },
      select: { id: true },
    });
    return !!p;
  }

  /** Has this document ever been put to a vote? (once so, it can only be removed by a delete vote). */
  private async hasAnyVote(documentId: string): Promise<boolean> {
    const p = await this.prisma.proposal.findFirst({
      where: { ruleDocumentId: documentId, internalType: 'RULE_APPROVAL' },
      select: { id: true },
    });
    return !!p;
  }

  /** The latest rule-approval vote's compact score, or null if the document was never voted. */
  private async lastVote(documentId: string) {
    const p = await this.prisma.proposal.findFirst({
      where: { ruleDocumentId: documentId, internalType: 'RULE_APPROVAL' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return p ? this.internal.ruleVoteScore(p.id) : null;
  }

  /** When the document was approved into effect: the finalize time of the latest approved
   *  (non-delete) approval vote. null if it was never approved. */
  private async approvedAt(documentId: string): Promise<string | null> {
    const p = await this.prisma.proposal.findFirst({
      where: { ruleDocumentId: documentId, internalType: 'RULE_APPROVAL', ruleDeleteRequested: false, status: 'APPROVED' },
      orderBy: { resultFinalizedAt: 'desc' },
      select: { resultFinalizedAt: true, votingEndAt: true },
    });
    const d = p?.resultFinalizedAt ?? p?.votingEndAt;
    return d ? d.toISOString() : null;
  }

  private summary(doc: { id: string; title: string; status: string; publishedAt: Date | null; updatedAt: Date; owner: { displayName: string | null } }) {
    return {
      id: doc.id,
      title: doc.title,
      status: doc.status,
      ownerName: doc.owner.displayName ?? 'DRep',
      publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : null,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /** Public list (never PRIVATE), filtered by status. filter: all | active | draft | deleted. */
  async list(filter?: string) {
    const f = (filter ?? 'all').toLowerCase();
    const statuses =
      f === 'active' ? ['ACTIVE'] : f === 'draft' ? ['DRAFT'] : f === 'deleted' ? ['DELETED'] : PUBLIC_STATUSES;
    const docs = await this.prisma.ruleDocument.findMany({
      where: { status: { in: statuses } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: { owner: { select: { displayName: true } } },
    });
    return Promise.all(docs.map(async (d) => ({ ...this.summary(d), lastVote: await this.lastVote(d.id), approvedAt: await this.approvedAt(d.id) })));
  }

  /** The caller's own documents (every status, including PRIVATE) with an `editable` flag. */
  async listMine(userId: string) {
    const docs = await this.prisma.ruleDocument.findMany({
      where: { ownerUserId: userId },
      orderBy: { updatedAt: 'desc' },
      include: { owner: { select: { displayName: true } } },
    });
    return Promise.all(
      docs.map(async (d) => ({
        ...this.summary(d),
        editable: d.status === 'PRIVATE' || (d.status === 'DRAFT' && !(await this.hasLiveVote(d.id))),
        deletable: d.status === 'PRIVATE' || (d.status === 'DRAFT' && !(await this.hasAnyVote(d.id))),
        lastVote: await this.lastVote(d.id),
        approvedAt: await this.approvedAt(d.id),
      })),
    );
  }

  async getOne(id: string, userId?: string) {
    const initial = await this.prisma.ruleDocument.findUnique({
      where: { id },
      include: { owner: { select: { displayName: true } } },
    });
    if (!initial) throw new NotFoundException('rule document not found');
    const isOwner = !!userId && initial.ownerUserId === userId;
    if (initial.status === 'PRIVATE' && !isOwner) throw new ForbiddenException('this document is private');

    // Compute the latest vote FIRST: it auto-finalizes a past-due vote, which may flip the
    // document's status (DRAFT → ACTIVE, or DELETED). Re-read so we return the up-to-date status
    // in the same response rather than a stale "still voting" view.
    const lastVote = await this.lastVote(id);
    const doc =
      (await this.prisma.ruleDocument.findUnique({ where: { id }, include: { owner: { select: { displayName: true } } } })) ?? initial;

    const isDrep = !!userId && (await this.admittedDrep(userId));
    const canModerate = !!userId && (await this.board.isBoardMember(userId)); // board can delete any comment
    const live = await this.hasLiveVote(doc.id);
    const editable = isOwner && (doc.status === 'PRIVATE' || (doc.status === 'DRAFT' && !live));
    const comments = doc.status === 'PRIVATE' ? [] : await this.loadComments(doc.id, userId);

    return {
      canModerate,
      ...this.summary(doc),
      contentMd: doc.contentMd,
      // sha256 of the raw content (UTF-8), hex — the exact value a user can reproduce from the
      // downloaded text. For an ACTIVE document this equals the frozen, on-chain-anchored hash.
      contentHash: sha256hex(doc.contentMd),
      isOwner,
      editable,
      // A document with a live vote is locked; a DRAFT with no live vote can be voted; ACTIVE can
      // only be deleted (via a delete vote); PRIVATE/DELETED can't be voted.
      canPropose: isDrep && !live && (doc.status === 'DRAFT' || doc.status === 'ACTIVE'),
      canComment: isDrep && doc.status !== 'PRIVATE' && doc.status !== 'DELETED',
      comments,
      lastVote,
      approvedAt: await this.approvedAt(doc.id),
    };
  }

  async create(userId: string, dto: { title: string; contentMd: string }) {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true, status: true } });
    if (drep?.status !== 'ADMITTED') throw new ForbiddenException('you must be a Council member to author rule documents — join the Council first (it is free)');
    const doc = await this.prisma.ruleDocument.create({
      data: { title: dto.title.trim(), contentMd: dto.contentMd, ownerUserId: userId, status: 'PRIVATE' },
    });
    // §13 — +1 merit for authoring a new rule document (no-op while the merit system is disabled).
    await this.merit.tryAward(drep.id, 'RULE_DOC_SUBMIT', doc.id);
    return this.getOne(doc.id, userId);
  }

  private async ownEditable(id: string, userId: string) {
    const doc = await this.prisma.ruleDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('rule document not found');
    if (doc.ownerUserId !== userId) throw new ForbiddenException('not your document');
    return doc;
  }

  async update(userId: string, id: string, dto: { title?: string; contentMd?: string }) {
    const doc = await this.ownEditable(id, userId);
    if (doc.status !== 'PRIVATE' && doc.status !== 'DRAFT') throw new BadRequestException('this document can no longer be edited');
    if (doc.status === 'DRAFT' && (await this.hasLiveVote(id))) throw new BadRequestException('a vote is in progress — the document is locked');
    await this.prisma.ruleDocument.update({
      where: { id },
      data: { title: dto.title?.trim() ?? doc.title, contentMd: dto.contentMd ?? doc.contentMd },
    });
    return this.getOne(id, userId);
  }

  /** PRIVATE → DRAFT: publish so other DReps can read + give feedback (still editable by the owner). */
  async publish(userId: string, id: string) {
    const doc = await this.ownEditable(id, userId);
    if (doc.status !== 'PRIVATE') throw new BadRequestException('only a private document can be published');
    await this.prisma.ruleDocument.update({ where: { id }, data: { status: 'DRAFT', publishedAt: new Date() } });
    return this.getOne(id, userId);
  }

  /** The owner may delete their document any time BEFORE it is put to a vote (PRIVATE, or a DRAFT
   *  that has never had an approval vote). Once voted, an ACTIVE/DELETED — or a DRAFT that was
   *  already voted — can only be removed by a delete vote. */
  async remove(userId: string, id: string) {
    const doc = await this.ownEditable(id, userId);
    if (doc.status !== 'PRIVATE' && doc.status !== 'DRAFT') {
      throw new BadRequestException('an active document can only be removed by a delete vote');
    }
    if (await this.hasAnyVote(id)) {
      throw new BadRequestException('this document has been put to a vote — remove it with a delete vote');
    }
    await this.prisma.$transaction([
      this.prisma.ruleDocumentComment.deleteMany({ where: { documentId: id } }),
      this.prisma.ruleDocument.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  // §27 — feedback thread: top-level comments each with one level of replies. Author role (board /
  // council member) is shown beside the name; deleted comments are kept as tombstones so replies
  // beneath them still make sense.
  private async loadComments(documentId: string, userId?: string) {
    const [rows, boardSeats, admitted] = await Promise.all([
      this.prisma.ruleDocumentComment.findMany({
        where: { documentId },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { displayName: true, drepKeyHash: true } } },
      }),
      this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } }),
      this.prisma.drep.findMany({ where: { status: 'ADMITTED' }, select: { userId: true } }),
    ]);
    const boardHashes = new Set(boardSeats.map((s) => s.drepKeyHash));
    const admittedIds = new Set(admitted.map((d) => d.userId));
    type Row = (typeof rows)[number];
    const role = (r: Row) => (r.author.drepKeyHash && boardHashes.has(r.author.drepKeyHash) ? 'Board member' : admittedIds.has(r.authorUserId) ? 'Council member' : null);
    const shape = (r: Row) => ({
      id: r.id,
      authorName: r.author.displayName ?? 'DRep',
      authorRole: role(r),
      isMine: r.authorUserId === userId,
      contentMd: r.deletedAt ? null : r.contentMd,
      deleted: !!r.deletedAt,
      createdAt: r.createdAt.toISOString(),
    });
    return rows
      .filter((r) => !r.parentId)
      .map((t) => ({ ...shape(t), replies: rows.filter((r) => r.parentId === t.id).map(shape) }))
      .filter((t) => !t.deleted || t.replies.length > 0); // drop a bare deleted top-level with no replies
  }

  async addComment(userId: string, id: string, dto: { contentMd: string; parentId?: string }) {
    if (!(await this.admittedDrep(userId))) throw new ForbiddenException('you must be a Council member to comment — join the Council first (it is free)');
    const doc = await this.prisma.ruleDocument.findUnique({ where: { id }, select: { status: true } });
    if (!doc) throw new NotFoundException('rule document not found');
    if (doc.status === 'PRIVATE' || doc.status === 'DELETED') throw new BadRequestException('this document is not open for feedback');
    let parentId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.ruleDocumentComment.findUnique({ where: { id: dto.parentId }, select: { documentId: true, parentId: true } });
      if (!parent || parent.documentId !== id) throw new BadRequestException('invalid parent comment');
      // One level only: a reply to a reply attaches to its top-level comment.
      parentId = parent.parentId ?? dto.parentId;
    }
    await this.prisma.ruleDocumentComment.create({ data: { documentId: id, authorUserId: userId, contentMd: dto.contentMd, parentId } });
    return this.getOne(id, userId);
  }

  // Author may delete their own comment; board members may moderate any. The document owner has no
  // special power over others' comments.
  async deleteComment(userId: string, commentId: string) {
    const c = await this.prisma.ruleDocumentComment.findUnique({ where: { id: commentId } });
    if (!c) throw new NotFoundException('comment not found');
    const canDelete = c.authorUserId === userId || (await this.board.isBoardMember(userId));
    if (!canDelete) throw new ForbiddenException('only the comment author or a board member can delete a comment');
    if (!c.deletedAt) await this.prisma.ruleDocumentComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }
}
