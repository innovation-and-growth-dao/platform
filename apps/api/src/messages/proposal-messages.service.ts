import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BoardService } from '../auth/board.service';

/**
 * §3.5 — board ↔ submitter messaging per proposal. The board opens a thread to ask the team to do
 * something (e.g. send tokens to the Treasury for revenue-sharing / pledge / skin-in-the-game), the
 * submitter replies, back and forth, until the board marks it DONE. Visible to all board members and
 * the proposal's submitter only.
 */
@Injectable()
export class ProposalMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly board: BoardService,
  ) {}

  private isBoard(userId: string): Promise<boolean> {
    return this.board.isBoardMember(userId);
  }

  async startThread(boardUserId: string, proposalId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('message cannot be empty');
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { id: true } });
    if (!p) throw new NotFoundException('proposal not found');
    const thread = await this.prisma.proposalMessageThread.create({
      data: { proposalId, createdById: boardUserId, entries: { create: { authorId: boardUserId, fromBoard: true, body: text } } },
    });
    return this.threadView(thread.id, boardUserId);
  }

  async addEntry(userId: string, threadId: string, body: string) {
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException('message cannot be empty');
    const thread = await this.prisma.proposalMessageThread.findUnique({
      where: { id: threadId },
      include: { proposal: { select: { submitterUserId: true } } },
    });
    if (!thread) throw new NotFoundException('message not found');
    if (thread.status === 'DONE') throw new ConflictException('this message thread is closed');
    const board = await this.isBoard(userId);
    const isSubmitter = thread.proposal.submitterUserId === userId;
    if (!board && !isSubmitter) throw new ForbiddenException('not allowed');
    await this.prisma.proposalMessageEntry.create({ data: { threadId, authorId: userId, fromBoard: board, body: text } });
    return this.threadView(threadId, userId);
  }

  async markDone(boardUserId: string, threadId: string) {
    const thread = await this.prisma.proposalMessageThread.findUnique({ where: { id: threadId }, select: { id: true, status: true } });
    if (!thread) throw new NotFoundException('message not found');
    if (thread.status !== 'DONE') {
      await this.prisma.proposalMessageThread.update({ where: { id: threadId }, data: { status: 'DONE', doneAt: new Date() } });
    }
    return this.threadView(threadId, boardUserId);
  }

  /** Every thread on a proposal — visible to board members and the proposal's submitter only. */
  async listForProposal(userId: string, proposalId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: { submitterUserId: true } });
    if (!p) throw new NotFoundException('proposal not found');
    const board = await this.isBoard(userId);
    if (!board && p.submitterUserId !== userId) return [];
    const threads = await this.prisma.proposalMessageThread.findMany({ where: { proposalId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(threads.map((t) => this.threadView(t.id, userId)));
  }

  /** Submitter's My-Area Messages: every thread across the proposals they submitted. */
  async mySubmitterThreads(userId: string) {
    const threads = await this.prisma.proposalMessageThread.findMany({
      where: { proposal: { submitterUserId: userId } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    return Promise.all(threads.map((t) => this.threadView(t.id, userId)));
  }

  /** Board Actions to-do: OPEN threads where the submitter spoke last (a reply to read/act on). */
  async boardPending() {
    const threads = await this.prisma.proposalMessageThread.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, entries: { orderBy: { createdAt: 'desc' }, take: 1, select: { fromBoard: true } } },
    });
    const ids = threads.filter((t) => t.entries[0] && !t.entries[0].fromBoard).map((t) => t.id);
    return Promise.all(ids.map((id) => this.threadView(id, '')));
  }

  /** Board view of every thread (active first, then done) — for the "all messages" screen. */
  async boardAll() {
    const threads = await this.prisma.proposalMessageThread.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    return Promise.all(threads.map((t) => this.threadView(t.id, '')));
  }

  private async threadView(threadId: string, viewerId: string) {
    const t = await this.prisma.proposalMessageThread.findUnique({
      where: { id: threadId },
      include: {
        proposal: { select: { id: true, title: true, publicId: true } },
        entries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException('message not found');
    const authorIds = [...new Set(t.entries.map((e) => e.authorId))];
    const users = await this.prisma.appUser.findMany({ where: { id: { in: authorIds } }, select: { id: true, displayName: true } });
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    const last = t.entries[t.entries.length - 1];
    return {
      id: t.id,
      proposalId: t.proposal.id,
      proposalTitle: t.proposal.title,
      proposalPublicId: t.proposal.publicId,
      status: t.status,
      createdAt: t.createdAt,
      doneAt: t.doneAt,
      lastFromBoard: last ? last.fromBoard : true,
      entries: t.entries.map((e) => ({
        id: e.id,
        fromBoard: e.fromBoard,
        author: nameById.get(e.authorId) ?? (e.fromBoard ? 'Board' : 'Submitter'),
        body: e.body,
        createdAt: e.createdAt,
        mine: !!viewerId && e.authorId === viewerId,
      })),
    };
  }
}
