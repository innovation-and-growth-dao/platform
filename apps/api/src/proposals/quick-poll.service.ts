import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ROUND_SETTING_DEFAULTS, ProposalStatus } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DvService } from './dv.service';
import { MeritService } from '../merit/merit.service';
import { bordaScores, walkBudget } from './quick-poll-math';

/**
 * §9.2 — Quick Poll tie-break. Auto-created by finalizeRound when equal scores collide at the
 * budget cliff; the board confirms with one click; eligible DReps (frozen at creation, same as
 * D&V) vote with balanced power for 48 h (configurable). 51% participation required — else
 * extend (≤3×); final fallback: none of the tied proposals are funded.
 *
 * Voting is RANKED: each DRep orders the tied candidates by priority. The poll aggregates a
 * power-weighted Borda score and walks the category's remaining budget top-down, funding every
 * candidate that still fits — so one poll funds as many as the budget allows, not just one. A
 * genuine tie (equal aggregate score) for the last affordable slot spawns a smaller follow-up
 * poll between just those candidates.
 */
@Injectable()
export class QuickPollService {
  private readonly logger = new Logger(QuickPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dv: DvService,
    @Optional() private readonly merit?: MeritService,
  ) {}

  private async settings(roundId: string) {
    const r = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: { quickPollParticipationPct: true, quickPollDurationHours: true, quickPollMaxExtensions: true },
    });
    return {
      participationPct: r?.quickPollParticipationPct ?? ROUND_SETTING_DEFAULTS.quickPollParticipationPct,
      durationHours: r?.quickPollDurationHours ?? ROUND_SETTING_DEFAULTS.quickPollDurationHours,
      maxExtensions: r?.quickPollMaxExtensions ?? ROUND_SETTING_DEFAULTS.quickPollMaxExtensions,
    };
  }

  /** The category budget still unallocated when this poll resolves: total minus what's already
   *  been APPROVED. The tied candidates compete for this remainder. Lovelace (may be ≤ 0). */
  private async categoryRemainingLovelace(roundId: string, categoryId: string): Promise<bigint> {
    const cat = await this.prisma.roundCategory.findUnique({ where: { id: categoryId }, select: { allocatedAda: true } });
    if (!cat) return 0n;
    const approved = await this.prisma.proposal.findMany({
      where: { roundId, categoryId, status: ProposalStatus.APPROVED },
      select: { requestedAmountAda: true },
    });
    const used = approved.reduce((s, p) => s + (p.requestedAmountAda ?? 0n), 0n);
    return (cat.allocatedAda ?? 0n) - used;
  }

  /** Candidates with their amount + Borda score, sorted by score desc then earliest submission. */
  private async rankedCandidates(poll: { candidates: string[]; votes: { ranking: string[]; choice: string | null; power: number }[] }) {
    const score = bordaScores(poll.candidates, poll.votes);
    const props = await this.prisma.proposal.findMany({
      where: { id: { in: poll.candidates } },
      select: { id: true, requestedAmountAda: true, submittedAt: true, createdAt: true },
    });
    const byId = new Map(props.map((p) => [p.id, p]));
    return poll.candidates
      .map((id) => ({
        id,
        amount: byId.get(id)?.requestedAmountAda ?? 0n,
        score: score.get(id) ?? 0,
        submittedAt: (byId.get(id)?.submittedAt ?? byId.get(id)?.createdAt ?? new Date(0)).getTime(),
      }))
      .sort((a, b) => b.score - a.score || a.submittedAt - b.submittedAt);
  }

  async listForRound(roundId: string, userId?: string) {
    const polls = await this.prisma.quickPoll.findMany({
      where: { roundId },
      include: { votes: true, category: { select: { name: true } } },
      orderBy: { startsAt: 'desc' },
    });
    const myDrep = userId ? await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } }) : null;
    const candidates = await this.prisma.proposal.findMany({
      where: { id: { in: polls.flatMap((p) => p.candidates) } },
      select: { id: true, title: true, publicId: true, requestedAmountAda: true },
    });
    const candById = new Map(candidates.map((c) => [c.id, c]));
    return Promise.all(polls.map(async (p) => {
      const sorted = await this.rankedCandidates(p);
      const remaining = await this.categoryRemainingLovelace(roundId, p.categoryId);
      // Projected outcome if the poll resolved right now (live "who's winning").
      const projection = walkBudget(sorted.map((s) => ({ id: s.id, amount: s.amount, score: s.score })), remaining);
      const fundedSet = new Set(projection.funded);
      const tieSet = new Set(projection.tieGroup);
      const scoreById = new Map(sorted.map((s) => [s.id, s.score]));
      const myVote = myDrep ? p.votes.find((v) => v.drepId === myDrep.id) : undefined;
      return {
        id: p.id,
        categoryName: p.category?.name ?? null,
        status: p.status,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        extensions: p.extensions,
        winnerId: p.winnerId,
        eligibleCount: p.eligibleDrepIds.length,
        votedCount: p.votes.length,
        iAmEligible: !!myDrep && p.eligibleDrepIds.includes(myDrep.id),
        remainingAda: Number(remaining) / 1e6,
        // The caller's current ranking (ordered candidate ids), if they voted.
        myRanking: myVote ? (myVote.ranking.length ? myVote.ranking : myVote.choice ? [myVote.choice] : []) : null,
        // Candidates in priority (aggregate score) order, with the live projection.
        candidates: sorted.map((s) => ({
          id: s.id,
          title: candById.get(s.id)?.title ?? '?',
          publicId: candById.get(s.id)?.publicId ?? null,
          requestedAmountAda: Number(candById.get(s.id)?.requestedAmountAda ?? 0n) / 1e6,
          score: Math.round((scoreById.get(s.id) ?? 0) * 100) / 100,
          projectedFunded: fundedSet.has(s.id),
          projectedTie: tieSet.has(s.id),
        })),
      };
    }));
  }

  /** Board's one-click confirm — opens voting for the configured window. */
  async launch(pollId: string) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('quick poll not found');
    if (poll.status !== 'PENDING_BOARD') throw new ConflictException('this poll has already been launched');
    const s = await this.settings(poll.roundId);
    const now = new Date();
    await this.prisma.quickPoll.update({
      where: { id: pollId },
      data: { status: 'ACTIVE', startsAt: now, endsAt: new Date(now.getTime() + s.durationHours * 3600_000) },
    });
    return this.listOne(pollId);
  }

  /** §9.2 — an eligible DRep submits/updates their priority ranking of the tied candidates. */
  async vote(userId: string, pollId: string, ranking: string[]) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw new NotFoundException('quick poll not found');
    if (poll.status !== 'ACTIVE') throw new ConflictException('this poll is not open for voting');
    if (poll.endsAt && poll.endsAt <= new Date()) throw new ConflictException('this poll has ended');
    // The ranking must be a full ordering of the candidates — every candidate exactly once.
    const candidateSet = new Set(poll.candidates);
    const seen = new Set<string>();
    for (const id of ranking) {
      if (!candidateSet.has(id)) throw new BadRequestException('ranking contains a proposal that is not a candidate of this poll');
      if (seen.has(id)) throw new BadRequestException('ranking lists a proposal more than once');
      seen.add(id);
    }
    if (ranking.length !== poll.candidates.length) throw new BadRequestException('rank every candidate exactly once');
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep || !poll.eligibleDrepIds.includes(drep.id)) throw new ForbiddenException('you are not eligible to vote in this poll');
    const power = (await this.dv.liveBalancedPower([drep.id])).get(drep.id) ?? 0;
    await this.prisma.quickPollVote.upsert({
      where: { quickPollId_drepId: { quickPollId: pollId, drepId: drep.id } },
      update: { ranking, choice: ranking[0] ?? null, power, castAt: new Date() },
      create: { quickPollId: pollId, drepId: drep.id, ranking, choice: ranking[0] ?? null, power },
    });
    await this.merit?.tryAward(drep.id, 'QUICK_POLL_VOTE', pollId);
    // Resolve as soon as every eligible DRep has voted — no more votes can arrive, so there's
    // no point waiting out the window; the funding result reflects immediately.
    const voted = await this.prisma.quickPollVote.count({ where: { quickPollId: pollId } });
    if (poll.eligibleDrepIds.length > 0 && voted >= poll.eligibleDrepIds.length) {
      await this.resolve(pollId).catch((e) => this.logger.warn(`auto-resolve of ${pollId} failed: ${e instanceof Error ? e.message : e}`));
    }
    return this.listOne(pollId, userId);
  }

  /** §9.2 — resolve every ACTIVE poll whose window ended (called by the jobs scheduler). */
  async resolveDue(): Promise<number> {
    const due = await this.prisma.quickPoll.findMany({
      where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
      include: { votes: true },
    });
    for (const poll of due) {
      try {
        await this.resolve(poll.id);
      } catch (e) {
        this.logger.warn(`quick poll ${poll.id} resolution failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return due.length;
  }

  /**
   * Resolve a tie-break poll. Normally called by the scheduler when the window ends, or the
   * instant every eligible DRep has voted (no point waiting). `force` (board "Resolve now")
   * finalises immediately with whatever votes exist, skipping the participation/extension gate —
   * unless nobody voted, in which case it fails (no basis to decide).
   */
  async resolve(pollId: string, opts: { force?: boolean } = {}) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId }, include: { votes: true } });
    if (!poll) throw new NotFoundException('quick poll not found');
    if (poll.status !== 'ACTIVE') throw new ConflictException('poll is not active');
    const s = await this.settings(poll.roundId);

    // Participation = voted power / total eligible power (computed live for the frozen voters).
    const allPower = await this.dv.liveBalancedPower(poll.eligibleDrepIds);
    const totalEligible = [...allPower.values()].reduce((a, b) => a + b, 0);
    const votedPower = poll.votes.reduce((sum, v) => sum + v.power, 0);
    const participationPct = totalEligible > 0 ? (votedPower / totalEligible) * 100 : 0;

    if (opts.force && poll.votes.length === 0) {
      // Board closed the poll with no votes cast → nothing to decide; none funded.
      await this.prisma.quickPoll.update({ where: { id: pollId }, data: { status: 'FAILED' } });
      for (const id of poll.candidates) {
        await this.dv.finalize(id, { forcedOutcome: 'REJECTED', note: 'budget-cut (quick poll closed with no votes)' }).catch(() => undefined);
      }
      return { status: 'FAILED' };
    }

    if (!opts.force && participationPct < s.participationPct) {
      if (poll.extensions < s.maxExtensions) {
        const endsAt = new Date((poll.endsAt ?? new Date()).getTime() + s.durationHours * 3600_000);
        await this.prisma.quickPoll.update({ where: { id: pollId }, data: { extensions: poll.extensions + 1, endsAt } });
        this.logger.log(`quick poll ${pollId}: participation ${participationPct.toFixed(1)}% < ${s.participationPct}% — extended (${poll.extensions + 1}/${s.maxExtensions})`);
        return { status: 'ACTIVE', extended: true };
      }
      // Final fallback — none of the tied proposals are funded.
      await this.prisma.quickPoll.update({ where: { id: pollId }, data: { status: 'FAILED' } });
      for (const id of poll.candidates) {
        await this.dv.finalize(id, { forcedOutcome: 'REJECTED', note: 'budget-cut (quick poll failed — participation too low)' }).catch(() => undefined);
      }
      return { status: 'FAILED' };
    }

    // Rank by power-weighted priority, then fill the remaining category budget top-down.
    const sorted = await this.rankedCandidates(poll);
    const remaining = await this.categoryRemainingLovelace(poll.roundId, poll.categoryId);
    const { funded, rejected, tieGroup } = walkBudget(sorted.map((c) => ({ id: c.id, amount: c.amount, score: c.score })), remaining);

    // Mark this poll resolved BEFORE creating any follow-up, so createQuickPoll's "one open poll
    // per category" guard doesn't see this one as still active.
    await this.prisma.quickPoll.update({ where: { id: pollId }, data: { status: 'RESOLVED', winnerId: funded[0] ?? null } });
    for (const id of funded) {
      await this.dv.finalize(id, { forcedOutcome: 'APPROVED', note: 'ranked quick-poll winner' }).catch(() => undefined);
    }
    for (const id of rejected) {
      await this.dv.finalize(id, { forcedOutcome: 'REJECTED', note: 'budget-cut (lost ranked quick poll)' }).catch(() => undefined);
    }
    if (tieGroup.length > 1) {
      // Genuine tie for the last affordable slot → a smaller follow-up poll decides it.
      await this.dv.createQuickPoll(poll.roundId, poll.categoryId, tieGroup);
      this.logger.log(`quick poll ${pollId}: ${funded.length} funded, follow-up poll for ${tieGroup.length}-way tie`);
    }
    return { status: 'RESOLVED', funded, followUp: tieGroup.length > 1 ? tieGroup : undefined };
  }

  /** Polls awaiting THIS DRep's vote (drives the voting to-do badge). */
  async myPendingCount(userId: string): Promise<number> {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (!drep) return 0;
    const polls = await this.prisma.quickPoll.findMany({
      where: { status: 'ACTIVE', eligibleDrepIds: { has: drep.id } },
      include: { votes: { where: { drepId: drep.id }, select: { drepId: true } } },
    });
    return polls.filter((p) => p.votes.length === 0).length;
  }

  private async listOne(pollId: string, userId?: string) {
    const poll = await this.prisma.quickPoll.findUnique({ where: { id: pollId }, select: { roundId: true } });
    const list = await this.listForRound(poll?.roundId ?? '', userId);
    return list.find((p) => p.id === pollId) ?? null;
  }
}
