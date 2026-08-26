import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { GovSubject } from '@drep-dao/cardano';
import { ROUND_SETTING_DEFAULTS, PLATFORM_CONFIG_DEFAULTS } from '@drep-dao/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TreasuryBucketsService } from '../treasury/treasury-buckets.service';
import { QuickPollService } from '../proposals/quick-poll.service';
import { RoundsService } from '../rounds/rounds.service';

const FAST_MS = 30_000; // §27 cardano-tx-poller
const MID_MS = 5 * 60_000; // §27 deadline checks + quick-poll end
const DAILY_MS = 10 * 60_000; // daily jobs gate themselves by date, ticked every 10 min

/**
 * §27 — background jobs. Plain unref'd intervals (same pattern as RoundsSchedulerService —
 * no scheduling package). Set JOBS_DISABLED=1 to keep tests/CLI deterministic.
 *
 * fast  (30s): tx-poller — auto-detect submission-fee + pledge payments on-chain → notify board.
 * mid   (5m):  quick-poll end check; overdue stage windows → notify board.
 * daily:       daily anchors (votes + merit), pledge-grace expiry, treasury reconciliation,
 *              milestone-deadline reminders (3/2/1 days), internal-proposal delivery reminders,
 *              board-reward-deadline flag (Mondays).
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private timers: NodeJS.Timeout[] = [];
  // Guards the pending-anchor sweep so a long batch (Koios propagation waits) can't overlap the next tick.
  private anchorSweepRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
    private readonly anchor: AnchorService,
    private readonly notify: NotificationsService,
    private readonly buckets: TreasuryBucketsService,
    private readonly quickPolls: QuickPollService,
    @Optional() private readonly rounds?: RoundsService,
  ) {}

  onModuleInit() {
    if (process.env.JOBS_DISABLED === '1') return;
    const mk = (fn: () => Promise<void>, ms: number, name: string) => {
      const t = setInterval(() => fn().catch((e) => this.logger.warn(`${name} tick failed: ${e instanceof Error ? e.message : e}`)), ms);
      t.unref?.();
      this.timers.push(t);
    };
    mk(() => this.txPoller(), FAST_MS, 'tx-poller');
    mk(() => this.midTick(), MID_MS, 'mid');
    mk(() => this.dailyTick(), DAILY_MS, 'daily');
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
  }

  // ── §27 cardano-tx-poller (30s) ───────────────────────────────────────────────

  async txPoller() {
    // Submission fees: PENDING proposals with a fee tx the platform hasn't seen paid yet.
    const feeBucket = await this.buckets.defaultBucketFor('SUBMISSION_FEES');
    if (feeBucket?.bech32Address) {
      const pend = await this.prisma.proposal.findMany({
        where: { status: 'PENDING', submissionFeeTxHash: { not: null }, feeSeenOnchainAt: null },
        select: { id: true, publicId: true, title: true, submissionFeeTxHash: true, submissionFeeAda: true },
        take: 20,
      });
      for (const p of pend) {
        const v = await this.cardano.verifyPayment(p.submissionFeeTxHash!, feeBucket.bech32Address, p.submissionFeeAda ?? 0n);
        if (v.found && v.paid) {
          await this.prisma.proposal.update({ where: { id: p.id }, data: { feeSeenOnchainAt: new Date() } });
          await this.notify.notifyBoard('FEE_SEEN', p.id, {
            title: `Submission fee verified on-chain — ${p.publicId ?? p.title}`,
            body: 'The fee payment is visible on-chain. Confirm it under Actions → fee confirmations.',
            proposalId: p.id,
          });
        }
      }
    }
    // Pledges: approved proposals with a pledge tx not yet board-confirmed.
    const pledgeBucket = await this.buckets.defaultBucketFor('PLEDGE');
    if (pledgeBucket?.bech32Address) {
      const pend = await this.prisma.proposal.findMany({
        where: { pledgeTxHash: { not: null }, pledgeConfirmedAt: null, pledgeSeenOnchainAt: null },
        select: { id: true, publicId: true, title: true, pledgeTxHash: true, pledgeAmountAda: true },
        take: 20,
      });
      for (const p of pend) {
        const v = await this.cardano.verifyPayment(p.pledgeTxHash!, pledgeBucket.bech32Address, p.pledgeAmountAda ?? 0n);
        if (v.found && v.paid) {
          await this.prisma.proposal.update({ where: { id: p.id }, data: { pledgeSeenOnchainAt: new Date() } });
          await this.notify.notifyBoard('PLEDGE_SEEN', p.id, {
            title: `Pledge verified on-chain — ${p.publicId ?? p.title}`,
            body: 'The pledge payment is visible on-chain. Confirm it under Actions → pledge confirmations.',
            proposalId: p.id,
          });
        }
      }
    }
  }

  // ── 5-minute tick ─────────────────────────────────────────────────────────────

  async midTick() {
    // §9.2 — resolve quick polls whose window ended (extend / resolve / fail).
    await this.quickPolls.resolveDue();
    // §24 — sweep up any anchors that were recorded but not submitted on-chain (see retryPendingAnchors).
    await this.anchorSweepIfDue().catch((e) => this.logger.warn(`anchor sweep: ${e instanceof Error ? e.message : e}`));
    // §27 voting-deadline-check — stage windows that ended without auto-advance.
    if (this.rounds) {
      for (const o of await this.rounds.listOverdueStages()) {
        await this.notify.notifyBoard('STAGE_OVERDUE', `${o.roundId}:${o.status}`, {
          title: `${o.name}: the ${o.status} window ended ${o.endsAt.toISOString().slice(0, 10)}`,
          body: 'The stage window has passed — advance the round (Round control) or extend the schedule.',
          roundId: o.roundId,
        });
      }
    }
    // §15.2 — remind board members who still owe their treasury multisig signing key (initial
    // setup OR after a board rotation), so the new multisig can be assembled + funds migrated.
    await this.remindMultisigKeys().catch((e) => this.logger.warn(`multisig-key reminder: ${e instanceof Error ? e.message : e}`));
  }

  /**
   * §15.2 — notify each board member whose active seat is still awaiting their multisig signing
   * key. A member "owes" a key when their seat has no own key AND they have no prior key that
   * carries over (mirrors BoardMultisigService.tryAssemble's resolution — a returning member's
   * carried-over key doesn't block assembly, so they aren't nagged). Deduped per seat (refId =
   * seat id), so it's created once and clears itself once they submit.
   */
  private async remindMultisigKeys() {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, include: { multisigKey: true } });
    if (seats.length === 0) return;
    const keyedUsers = new Set(
      (await this.prisma.boardMultisigKey.findMany({ select: { userId: true } })).map((k) => k.userId),
    );
    for (const s of seats) {
      if (s.multisigKey) continue; // this seat already has its own key
      const member = await this.prisma.appUser.findFirst({ where: { drepKeyHash: s.drepKeyHash }, select: { id: true } });
      if (!member || keyedUsers.has(member.id)) continue; // no account yet, or a carried-over key exists
      await this.notify.notifyUsers([member.id], 'MULTISIG_KEY_NEEDED', s.id, {
        title: 'Action needed: submit your treasury multisig signing key — open Treasury → Multisig setup so the new multisig can be assembled.',
        body: 'You are on the board but haven\'t submitted your hardware signing key yet. The platform can\'t assemble the treasury multisig (and migrate funds) until every seat has a key.',
      });
    }
  }

  /**
   * §24 — auto-submit anchors that were recorded but never made it on-chain (txHash null). The
   * inline submit at finalize time fetches the hot wallet's UTxOs independently, so when several
   * decisions conclude close together they race for the same UTxO and all but the first are left
   * pending (the "1 passed, N failed" symptom). This mirrors the board's "Submit all pending"
   * button — which chains each tx's change into the next — so every decision ends up anchored
   * within a tick, without anyone clicking. No-op when nothing is pending or no hot wallet is set.
   */
  private async anchorSweepIfDue() {
    const hours = await this.anchor.getSweepHours();
    const key = 'JOB_LAST_RUN:anchor_sweep';
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    const last = row ? Number(row.value) : 0;
    if (Number.isFinite(last) && last > 0 && Date.now() - last < hours * 3_600_000) return;
    await this.retryPendingAnchors();
    const now = String(Date.now());
    await this.prisma.platformConfig.upsert({ where: { key }, update: { value: now }, create: { key, value: now } });
  }

  async retryPendingAnchors() {
    if (this.anchorSweepRunning) return; // a previous sweep is still draining the queue
    if (!this.anchor.walletConfigured()) return; // leave pending for manual submission
    const pending = await this.prisma.anchor.count({ where: { txHash: null } });
    if (pending === 0) return;
    this.anchorSweepRunning = true;
    try {
      const r = await this.anchor.submitAllPending();
      if (r.submitted || r.failed) {
        this.logger.log(`auto-anchor sweep: submitted ${r.submitted}/${r.total}${r.failed ? `, ${r.failed} still pending` : ''}`);
      }
    } finally {
      this.anchorSweepRunning = false;
    }
  }

  // ── daily jobs (gated by date via platform_config JOB_LAST_RUN keys) ──────────

  private async ranToday(name: string): Promise<boolean> {
    const key = `JOB_LAST_RUN:${name}`;
    const today = new Date().toISOString().slice(0, 10);
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (row?.value === today) return true;
    await this.prisma.platformConfig.upsert({ where: { key }, update: { value: today }, create: { key, value: today } });
    return false;
  }

  /** ANCHOR_SCHEDULE_CRON ("m h * * *") → the UTC time-of-day the daily batch runs after. */
  private async dailyRunAfterUtc(): Promise<{ h: number; m: number }> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'ANCHOR_SCHEDULE_CRON' } });
    const cron = typeof row?.value === 'string' ? row.value : '0 2 * * *';
    const [m, h] = cron.trim().split(/\s+/);
    return { h: Number.isFinite(Number(h)) ? Number(h) : 2, m: Number.isFinite(Number(m)) ? Number(m) : 0 };
  }

  async dailyTick() {
    // §27 — honor the configured schedule: don't start today's batch before the cron time (UTC).
    const at = await this.dailyRunAfterUtc();
    const now = new Date();
    if (now.getUTCHours() * 60 + now.getUTCMinutes() < at.h * 60 + at.m) return;
    if (!(await this.ranToday('daily'))) {
      await this.dailyAnchors().catch((e) => this.logger.warn(`daily anchors: ${e instanceof Error ? e.message : e}`));
      await this.pledgeGraceCheck().catch((e) => this.logger.warn(`pledge grace: ${e instanceof Error ? e.message : e}`));
      await this.treasuryReconciliation().catch((e) => this.logger.warn(`reconciliation: ${e instanceof Error ? e.message : e}`));
      await this.milestoneDeadlineReminders().catch((e) => this.logger.warn(`milestone reminders: ${e instanceof Error ? e.message : e}`));
      await this.deliveryReminders().catch((e) => this.logger.warn(`delivery reminders: ${e instanceof Error ? e.message : e}`));
      if (new Date().getUTCDay() === 1) {
        await this.boardRewardDeadlineCheck().catch((e) => this.logger.warn(`reward deadline: ${e instanceof Error ? e.message : e}`));
      }
    }
  }

  /** §24.1 — anchor a digest of yesterday's votes + merit deltas. */
  async dailyAnchors() {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 86_400_000);
    const day = yesterday.toISOString().slice(0, 10);

    const votes = await this.prisma.vote.findMany({
      where: { castAt: { gte: yesterday, lt: today } },
      orderBy: { castAt: 'asc' },
      select: { proposalId: true, drepId: true, phase: true, choice: true, castAt: true },
    });
    if (votes.length) {
      await this.anchor.anchorDigest({ kind: GovSubject.DAILY_VOTES, day, rows: votes.map((v) => ({ ...v, castAt: v.castAt.toISOString() })) });
    }
    const merit = await this.prisma.meritLedger.findMany({
      where: { occurredAt: { gte: yesterday, lt: today } },
      orderBy: { occurredAt: 'asc' },
      select: { drepId: true, delta: true, reasonCode: true, occurredAt: true },
    });
    if (merit.length) {
      await this.anchor.anchorDigest({ kind: GovSubject.DAILY_MERIT, day, rows: merit.map((m) => ({ drepId: m.drepId, delta: Number(m.delta), reasonCode: m.reasonCode, occurredAt: m.occurredAt.toISOString() })) });
    }
  }

  /** §16.4 — pledge grace expired and still unpaid → alert the board (once). */
  async pledgeGraceCheck() {
    const due = await this.prisma.proposal.findMany({
      where: { pledgeGraceEndsAt: { lte: new Date() }, pledgeConfirmedAt: null, pledgeGraceNotifiedAt: null, status: 'APPROVED' },
      select: { id: true, publicId: true, title: true, pledgeGraceEndsAt: true },
    });
    for (const p of due) {
      await this.prisma.proposal.update({ where: { id: p.id }, data: { pledgeGraceNotifiedAt: new Date() } });
      await this.notify.notifyBoard('PLEDGE_GRACE_EXPIRED', p.id, {
        title: `Pledge grace period expired — ${p.publicId ?? p.title}`,
        body: 'The team has not sent the pledge within the grace period. Extend the grace window or terminate the proposal (§16.4).',
        proposalId: p.id,
      });
    }
  }

  /** §15.4 — daily multisig balance snapshot; unexplained OUTFLOW alerts the board. */
  async treasuryReconciliation() {
    const { buckets } = await this.buckets.list();
    const addrs = buckets.map((b: { bech32Address: string }) => b.bech32Address).filter(Boolean);
    if (!addrs.length) return;
    const bal = await this.cardano.addressBalance(addrs);
    const total = [...bal.values()].reduce((s, v) => s + v, 0n);
    const day = new Date().toISOString().slice(0, 10);
    const prev = await this.prisma.treasuryDailySnapshot.findFirst({ orderBy: { day: 'desc' } });
    const since = prev?.createdAt ?? new Date(Date.now() - 86_400_000);
    const confirmed = await this.prisma.multisigAction.findMany({
      where: { status: 'CONFIRMED', paidAt: { gte: since } },
      select: { amountAda: true },
    });
    const explained = confirmed.reduce((s, a) => s + (a.amountAda ?? 0n), 0n); // outbound lovelace
    const delta = prev ? total - prev.totalLovelace : 0n;
    // Outflow beyond confirmed actions + 2 ADA fee buffer = the alarm condition.
    const mismatch = !!prev && delta < 0n && -delta > explained + 2_000_000n;
    await this.prisma.treasuryDailySnapshot.upsert({
      where: { day },
      update: { totalLovelace: total, prevLovelace: prev?.totalLovelace ?? null, explainedLovelace: explained, mismatch },
      create: { day, totalLovelace: total, prevLovelace: prev?.totalLovelace ?? null, explainedLovelace: explained, mismatch },
    });
    if (mismatch) {
      await this.notify.notifyBoard('TREASURY_MISMATCH', day, {
        title: `Treasury reconciliation mismatch (${day})`,
        body: `Balance dropped ${(Number(-delta) / 1e6).toLocaleString()} ₳ but confirmed actions explain only ${(Number(explained) / 1e6).toLocaleString()} ₳. Review Treasury → Transactions.`,
      });
    }
  }

  /** §27 milestone-notice-3-2-1 — POA deadline approaching → remind the submitter + reviewers. */
  async milestoneDeadlineReminders() {
    const now = Date.now();
    const soon = new Date(now + 3 * 86_400_000);
    const ms = await this.prisma.milestone.findMany({
      where: { deadlineAt: { lte: soon, gte: new Date(now) }, status: { in: ['NOT_STARTED', 'REJECTED'] } },
      select: {
        id: true, idx: true, deadlineAt: true,
        proposal: { select: { id: true, publicId: true, title: true, submitterUserId: true } },
        assignments: { where: { releasedAt: null }, select: { reviewerDrep: { select: { userId: true } } } },
      },
    });
    for (const m of ms) {
      const daysLeft = Math.ceil((m.deadlineAt!.getTime() - now) / 86_400_000);
      if (daysLeft > 3 || daysLeft < 1) continue;
      const userIds = [m.proposal.submitterUserId, ...m.assignments.map((a) => a.reviewerDrep?.userId)].filter((x): x is string => !!x);
      await this.notify.notifyUsers(userIds, 'MILESTONE_DEADLINE', `${m.id}:${daysLeft}`, {
        title: `Milestone #${m.idx + 1} of ${m.proposal.publicId ?? m.proposal.title}: ${daysLeft} day${daysLeft === 1 ? '' : 's'} to the POA deadline`,
        proposalId: m.proposal.id,
      });
    }
  }

  /** §10.4 — approved INSTRUCTIVE internal proposals: remind actors near/at the delivery date. */
  async deliveryReminders() {
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const due = await this.prisma.proposal.findMany({
      where: { type: 'INTERNAL', internalType: 'INSTRUCTIVE', status: 'APPROVED', deliveryDate: { lte: soon }, deliveryRemindedAt: null },
      select: { id: true, title: true, deliveryDate: true, submitterUserId: true },
    });
    for (const p of due) {
      await this.prisma.proposal.update({ where: { id: p.id }, data: { deliveryRemindedAt: new Date() } });
      await this.notify.notifyBoard('DELIVERY_DUE', p.id, {
        title: `Internal proposal delivery due — ${p.title}`,
        body: `Delivery date ${p.deliveryDate?.toISOString().slice(0, 10)}: the assigned actors should act on the approved proposal.`,
        proposalId: p.id,
      });
      if (p.submitterUserId) {
        await this.notify.notifyUsers([p.submitterUserId], 'DELIVERY_DUE', p.id, {
          title: `Delivery due — ${p.title}`,
          proposalId: p.id,
        });
      }
    }
  }

  /** §27 board-reward-deadline (weekly) — reward calcs unpaid past the configured deadline. */
  async boardRewardDeadlineCheck() {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'BOARD_REWARD_DEADLINE_DAYS' } });
    const days = typeof row?.value === 'number' ? row.value : (PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)['BOARD_REWARD_DEADLINE_DAYS'] as number ?? 30;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const stale = await this.prisma.rewardCalculation.findMany({
      where: { computedAt: { lte: cutoff }, entries: { some: { paidAt: null, payoutActionId: null } } },
      select: { id: true, kind: true, roundId: true, periodKey: true },
      take: 20,
    });
    for (const c of stale) {
      await this.notify.notifyBoard('REWARD_OVERDUE', c.id, {
        title: `Reward distribution overdue (${c.kind}${c.periodKey ? ` · ${c.periodKey}` : ''})`,
        body: `Computed more than ${days} days ago with unpaid entries — prepare the payout under Rewards.`,
      });
    }
  }
}
