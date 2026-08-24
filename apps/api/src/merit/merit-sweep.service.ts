import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MeritService } from './merit.service';
import { ROUND_SETTING_DEFAULTS, RoundStatus, VotePhase, PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';

const DAY_MS = 24 * 3600 * 1000;
const SWEEP_MS = 60 * 60 * 1000; // hourly; idempotent so frequency is just responsiveness

/**
 * §13.3 — the daily sweep applies merit PENALTIES once a voting window / review
 * window / payout deadline has lapsed, plus the per-signer milestone-payout reward.
 * Everything is idempotent via the ledger (one row per drep+reason+reference), so
 * the sweep can run as often as we like. Gains for actually participating are
 * awarded immediately at the vote; only the lapse-based deltas live here.
 */
@Injectable()
export class MeritSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeritSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly merit: MeritService,
  ) {}

  onModuleInit() {
    if (process.env.ROUNDS_SCHEDULER_DISABLED === '1') return; // off in tests/CLI
    this.timer = setInterval(() => void this.run(), SWEEP_MS);
    if (this.timer.unref) this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      if (!(await this.merit.meritEnabled())) return; // §13 merit disabled → nothing to sweep
      await this.missedFilter();
      await this.missedDv();
      await this.missedInternal();
      await this.missedMilestone();
      await this.payouts();
      await this.rewardDistributionLate();
    } catch (e) {
      this.logger.warn(`merit sweep failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** §13.3 — BOARD_REWARD_LATE (−10 collective): a reward calculation computed more than
   *  BOARD_REWARD_DEADLINE_DAYS ago still has unpaid, unqueued entries. Once per calc. */
  private async rewardDistributionLate(): Promise<void> {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key: 'BOARD_REWARD_DEADLINE_DAYS' } });
    const days = typeof cfg?.value === 'number' ? cfg.value : (PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)['BOARD_REWARD_DEADLINE_DAYS'] as number;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = await this.prisma.rewardCalculation.findMany({
      where: { computedAt: { lte: cutoff }, entries: { some: { paidAt: null, payoutActionId: null } } },
      select: { id: true },
    });
    for (const c of stale) {
      await this.merit.awardBoard('BOARD_REWARD_LATE', c.id);
    }
  }

  /** §13.4 — an avoid period overlapping [start, end] excuses a missed vote. */
  private async exempt(drepId: string, start?: Date | null, end?: Date | null): Promise<boolean> {
    if (!start || !end) return false;
    const a = await this.prisma.drepAvoidPeriod.findFirst({
      where: { drepId, startsAt: { lte: end }, endsAt: { gte: start } },
      select: { id: true },
    });
    return !!a;
  }

  private async stageWindow(roundId: string, prefix: string): Promise<{ start: Date; end: Date } | null> {
    const rows = await this.prisma.roundSchedule.findMany({
      where: { roundId, stageKey: { startsWith: prefix } },
      select: { startsAt: true, endsAt: true },
    });
    if (!rows.length) return null;
    return {
      start: new Date(Math.min(...rows.map((r) => r.startsAt.getTime()))),
      end: new Date(Math.max(...rows.map((r) => r.endsAt.getTime()))),
    };
  }

  /** Assigned filter reviewers who never voted, in rounds past FILTERING → −1. */
  private async missedFilter(): Promise<void> {
    const rounds = await this.prisma.round.findMany({
      where: { status: { in: [RoundStatus.DEBATE, RoundStatus.VOTE, RoundStatus.DV, RoundStatus.TALLY, RoundStatus.FUNDING, RoundStatus.CLOSED] } },
      select: { id: true },
    });
    for (const r of rounds) {
      const win = await this.stageWindow(r.id, 'filter');
      const assigns = await this.prisma.filterAssignment.findMany({
        where: { releasedAt: null, proposal: { roundId: r.id } },
        select: { proposalId: true, drepId: true },
      });
      for (const a of assigns) {
        const voted = await this.prisma.vote.findFirst({
          where: { proposalId: a.proposalId, drepId: a.drepId, phase: VotePhase.FILTERING },
          select: { id: true },
        });
        if (voted) continue;
        if (await this.exempt(a.drepId, win?.start, win?.end)) continue;
        await this.merit.tryAward(a.drepId, 'MISSED_FILTER', a.proposalId);
      }
    }
  }

  /** Snapshot voters who never cast a D&V ballot, in rounds past VOTE → −1 (§4.4/§13.3). */
  private async missedDv(): Promise<void> {
    const rounds = await this.prisma.round.findMany({
      where: { status: { in: [RoundStatus.TALLY, RoundStatus.FUNDING, RoundStatus.CLOSED] } },
      select: { id: true },
    });
    for (const r of rounds) {
      const win = (await this.stageWindow(r.id, 'vote')) ?? (await this.stageWindow(r.id, 'debate'));
      const proposals = await this.prisma.proposal.findMany({
        where: { roundId: r.id, stage: 'DEBATE_VOTE' },
        select: { id: true },
      });
      for (const p of proposals) {
        const snap = await this.prisma.voteSnapshot.findFirst({ where: { proposalId: p.id }, select: { id: true } });
        if (!snap) continue;
        const entries = await this.prisma.voteSnapshotEntry.findMany({ where: { snapshotId: snap.id }, select: { drepId: true } });
        for (const e of entries) {
          const voted = await this.prisma.vote.findFirst({
            where: { proposalId: p.id, drepId: e.drepId, phase: VotePhase.DEBATE_VOTE },
            select: { id: true },
          });
          if (voted) continue;
          if (await this.boardOptedOut(e.drepId)) continue; // §8.2 — opted-out board member isn't penalized
          if (await this.exempt(e.drepId, win?.start, win?.end)) continue;
          await this.merit.tryAward(e.drepId, 'MISSED_DV', p.id);
        }
      }
    }
  }

  /** §13.3 — DAO members eligible to vote on an internal proposal who didn't, once its voting
   *  window has closed → −1 each. Skipped for anyone whose avoid period covers the window. */
  private async missedInternal(): Promise<void> {
    const now = new Date();
    const proposals = await this.prisma.proposal.findMany({
      where: { type: 'INTERNAL', status: { in: ['APPROVED', 'REJECTED'] }, votingEndAt: { not: null, lt: now } },
      select: { id: true, createdAt: true, votingEndAt: true },
    });
    for (const p of proposals) {
      const snap = await this.prisma.voteSnapshot.findFirst({ where: { proposalId: p.id }, select: { id: true } });
      if (!snap) continue;
      const entries = await this.prisma.voteSnapshotEntry.findMany({ where: { snapshotId: snap.id }, select: { drepId: true } });
      for (const e of entries) {
        const voted = await this.prisma.vote.findFirst({
          where: { proposalId: p.id, drepId: e.drepId, phase: VotePhase.INTERNAL },
          select: { id: true },
        });
        if (voted) continue;
        if (await this.exempt(e.drepId, p.createdAt, p.votingEndAt)) continue;
        await this.merit.tryAward(e.drepId, 'MISSED_INTERNAL', p.id);
      }
    }
  }

  private async boardOptedOut(drepId: string): Promise<boolean> {
    const drep = await this.prisma.drep.findUnique({
      where: { id: drepId },
      select: { votesOnFundingProposals: true, user: { select: { drepKeyHash: true } } },
    });
    if (!drep || drep.votesOnFundingProposals || !drep.user.drepKeyHash) return false;
    const seat = await this.prisma.boardSeat.findFirst({
      where: { removedAt: null, drepKeyHash: drep.user.drepKeyHash },
      select: { id: true },
    });
    return !!seat;
  }

  /** Milestone reviewers who didn't check a POA before the review window closed → −1. */
  private async missedMilestone(): Promise<void> {
    const milestones = await this.prisma.milestone.findMany({
      where: { status: { in: ['POA_SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED'] } },
      select: {
        id: true,
        proposalId: true,
        poas: { orderBy: { submittedAt: 'desc' }, take: 1, select: { submittedAt: true } },
        assignments: { where: { releasedAt: null }, select: { reviewerDrepId: true } },
      },
    });
    for (const m of milestones) {
      const poaAt = m.poas[0]?.submittedAt;
      if (!poaAt) continue;
      const days = await this.roundDays(m.proposalId, 'milestoneCheckPeriodDays');
      const windowEnd = new Date(poaAt.getTime() + days * DAY_MS);
      if (windowEnd.getTime() > Date.now()) continue; // review window still open
      for (const a of m.assignments) {
        if (!a.reviewerDrepId) continue;
        const voted = await this.prisma.vote.findFirst({
          where: { milestoneId: m.id, drepId: a.reviewerDrepId, phase: VotePhase.MILESTONE },
          select: { id: true },
        });
        if (voted) continue;
        if (await this.exempt(a.reviewerDrepId, poaAt, windowEnd)) continue;
        await this.merit.tryAward(a.reviewerDrepId, 'MISSED_MILESTONE', m.id);
      }
    }
  }

  /** Milestone payouts: per-signer +5 when paid in time; collective −10 when the deadline lapses. */
  private async payouts(): Promise<void> {
    const actions = await this.prisma.multisigAction.findMany({
      where: { kind: 'PROJECT_FUNDING', milestoneId: { not: null } },
      select: {
        id: true,
        milestoneId: true,
        createdAt: true,
        paidAt: true,
        signatures: { select: { boardDrepId: true } },
      },
    });
    for (const act of actions) {
      const days = await this.payoutDeadlineDays(act.milestoneId!);
      const deadline = new Date(act.createdAt.getTime() + days * DAY_MS);
      if (act.paidAt) {
        if (act.paidAt.getTime() <= deadline.getTime()) {
          // Paid in time → the board members who signed earn merit (the doers).
          await this.merit.awardMany(act.signatures.map((s) => s.boardDrepId), 'BOARD_PAYOUT_SIGNED', act.id);
        }
      } else if (deadline.getTime() < Date.now()) {
        // Not paid + deadline passed → the whole board loses merit (collective).
        await this.merit.awardBoard('BOARD_PAYOUT_LATE', act.id);
      }
    }
  }

  private async roundDays(proposalId: string, field: 'milestoneCheckPeriodDays'): Promise<number> {
    const p = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { round: { select: { [field]: true } as Record<string, true> } },
    });
    const v = (p?.round as Record<string, number | null> | null | undefined)?.[field];
    return v ?? ROUND_SETTING_DEFAULTS[field];
  }

  private async payoutDeadlineDays(milestoneId: string): Promise<number> {
    const m = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { proposal: { select: { round: { select: { boardPayoutDeadlineDays: true } } } } },
    });
    return m?.proposal?.round?.boardPayoutDeadlineDays ?? ROUND_SETTING_DEFAULTS.boardPayoutDeadlineDays;
  }
}
