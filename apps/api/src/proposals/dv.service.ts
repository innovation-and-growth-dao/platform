import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  basePower,
  clampMerit,
  isApproved,
  approvalRatio,
  meritMultiplier,
  PLATFORM_CONFIG_DEFAULTS,
  ProposalStage,
  ProposalStatus,
  RoundStatus,
  ROUND_SETTING_DEFAULTS,
  VoteChoice,
  VotePhase,
} from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { classifyBudgetOutcome, voteRatio } from './dv-results';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { MeritService } from '../merit/merit.service';

const LOVELACE = 1_000_000n;

@Injectable()
export class DvService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anchor: AnchorService,
    private readonly cardano: CardanoQueryService,
    @Optional() private readonly merit?: MeritService,
  ) {}

  /**
   * §4.3 — take the voting-power snapshot and open D&V voting. Idempotent.
   * Each voter's power = log10(their REAL on-chain CIP-1694 voting power in ADA) ×
   * merit multiplier — the SAME computation as the members overview, so the numbers
   * match. If a DRep has no on-chain delegation yet, their stake falls back to a
   * nominal value (DV_SNAPSHOT_STAKE_ADA) so they aren't powerless in the demo.
   */
  async openVoting(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.DEBATE_VOTE) {
      throw new ConflictException('proposal is not in the DEBATE_VOTE stage');
    }
    // The proposal's stage flips to DEBATE_VOTE the moment it passes filtering.
    // §8 — the round-level "Debate & Vote" is now two sub-stages: DEBATE (comments
    // + revisions, no ballots) → VOTE (ballots open). Voting must wait until the
    // round advances to VOTE — comments during DEBATE go through CommentsModule,
    // not here. DV is the deprecated alias and is accepted as if it were VOTE.
    if (proposal.round && proposal.round.status !== RoundStatus.VOTE && proposal.round.status !== RoundStatus.DV) {
      throw new ConflictException(
        `round is in ${proposal.round.status}; Debate & Vote ballots open when the round advances to VOTE`,
      );
    }

    const existing = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (existing) return this.result(proposalId);

    // §8.2 — voters are EVERY admitted DRep eligible for the round (board +
    // non-board). The per-board-member opt-out is enforced LIVE via the
    // `votesOnFundingProposals` flag on Drep, not via the snapshot, so flipping
    // the toggle off mid-vote zeroes that member's contribution without
    // mutating the snapshot, and flipping it back on restores it instantly.
    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true, drep: { select: { drepIdOnchain: true } } },
    });

    const power = await this.realVotingPower(eligible.map((v) => v.drep.drepIdOnchain));
    const snapshot = await this.prisma.voteSnapshot.create({ data: { proposalId } });
    for (const v of eligible) await this.addSnapshotEntry(snapshot.id, v.drepId, power.get(v.drep.drepIdOnchain) ?? 0n);
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { votingStartAt: new Date() } });
    return this.result(proposalId);
  }

  /**
   * §8 — called by the round-transition flow when a round enters VOTE. Refreshes
   * every DEBATE_VOTE-stage proposal in the round: clears any pre-VOTE snapshot
   * + DV vote records (those were stale per §8.2 — see the historical opt-in
   * model), then takes a fresh snapshot capturing the full current electorate
   * (admitted DReps + opted-in board members). Auto-opens voting so the board
   * doesn't have to click "open voting" on each proposal manually.
   */
  async openVotingForRound(roundId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE },
      select: { id: true },
    });
    for (const p of proposals) {
      const stale = await this.prisma.voteSnapshot.findMany({
        where: { proposalId: p.id },
        select: { id: true },
      });
      if (stale.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: stale.map((s) => s.id) } } });
          await tx.voteSnapshot.deleteMany({ where: { proposalId: p.id } });
        });
      }
      // DV votes pre-snapshot-refresh would be against a deleted snapshot; clear
      // them too. (Vote rows reference proposalId + drepId, not the snapshot,
      // so removing votes here is the safe equivalent of "start the tally over".)
      await this.prisma.vote.deleteMany({ where: { proposalId: p.id, phase: VotePhase.DEBATE_VOTE } });
      await this.openVoting(p.id);
    }
    // §8.1 — Debate has ended (round entered VOTE): the proposal can no longer be
    // edited, so freeze a content fingerprint on-chain (canonical text → SHA-256).
    await this.anchorProposalDocs(roundId);
  }

  /**
   * §8.1 — for every just-frozen proposal in the round, build a canonical textual
   * form and anchor its SHA-256 on-chain. Idempotent (the anchor service skips a
   * proposal that already has a content-fingerprint anchor); best-effort so a
   * hiccup never blocks the round advancing.
   */
  private async anchorProposalDocs(roundId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE },
      include: {
        milestones: { orderBy: { idx: 'asc' } },
        category: { select: { name: true } },
        round: { select: { number: true } },
        submitterUser: { select: { displayName: true } },
        submitterDrep: { select: { drepIdOnchain: true } },
      },
    });
    for (const p of proposals) {
      try {
        await this.anchor.anchorProposalDoc({
          proposalRowId: p.id,
          publicId: p.publicId ?? p.id,
          title: p.title,
          roundId,
          roundNumber: p.round?.number ?? null,
          text: this.buildProposalDocText(p),
        });
      } catch {
        /* re-anchored on the next openVoting / board force-submit */
      }
    }
  }

  /**
   * §8.1 — the canonical, human-readable textual form of a frozen proposal. This exact
   * string is what gets hashed (SHA-256) and stored alongside the hash, so anyone can
   * re-hash it to verify the on-chain fingerprint. Field order is fixed; empty optional
   * sections are omitted so the text reads cleanly.
   */
  private buildProposalDocText(p: {
    publicId: string | null;
    title: string;
    type: string;
    isCommercial: boolean | null;
    requestedAmountAda: bigint | null;
    contentMd: string;
    ecosystemImpactMd: string | null;
    successMetricsMd: string | null;
    costBreakdownMd: string | null;
    teamInfo: unknown;
    revenueSharing: unknown;
    pledgeAmountAda: bigint | null;
    pledgeReturnMethod: string | null;
    category: { name: string } | null;
    round: { number: number } | null;
    submitterUser: { displayName: string | null } | null;
    submitterDrep: { drepIdOnchain: string | null } | null;
    milestones: { idx: number; title: string | null; description: string | null; acceptanceCriteria: string | null; amountAda: bigint }[];
  }): string {
    const ada = (x: bigint | null) => (x == null ? '0' : (Number(x) / 1_000_000).toLocaleString('en-US'));
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const submitter = p.submitterUser?.displayName ?? p.submitterDrep?.drepIdOnchain ?? 'unknown';
    const lines: string[] = [];
    lines.push('DRep DAO — frozen proposal content (v1)');
    lines.push(`Proposal: ${p.publicId ?? '(unassigned)'}`);
    if (p.round) lines.push(`Round: ${p.round.number}`);
    lines.push(`Title: ${p.title}`);
    lines.push(`Type: ${p.type}`);
    if (p.category) lines.push(`Category: ${p.category.name}`);
    lines.push(`Submitter: ${submitter}`);
    lines.push(`Requested: ${ada(p.requestedAmountAda)} ADA`);
    lines.push(`Commercial: ${p.isCommercial ? 'yes' : 'no'}`);
    lines.push('');
    lines.push('## Pitch / summary');
    lines.push(p.contentMd.trim());
    const section = (heading: string, body: string) => {
      const t = body.trim();
      if (!t) return;
      lines.push('');
      lines.push(`## ${heading}`);
      lines.push(t);
    };
    section('Expected ecosystem impact', str(p.ecosystemImpactMd));
    section('Success metrics / KPIs', str(p.successMetricsMd));
    section('Cost breakdown', str(p.costBreakdownMd));
    section('Team info', str(p.teamInfo));
    section('Revenue sharing', str(p.revenueSharing));
    if (p.pledgeAmountAda && p.pledgeAmountAda > 0n) {
      section('Pledge (skin in the game)', `${ada(p.pledgeAmountAda)} ADA — return method: ${p.pledgeReturnMethod ?? 'n/a'}`);
    }
    if (p.milestones.length) {
      lines.push('');
      lines.push('## Milestones');
      for (const m of p.milestones) {
        lines.push('');
        lines.push(`### Milestone ${m.idx + 1}: ${m.title ?? '(untitled)'} — ${ada(m.amountAda)} ADA`);
        if (m.description?.trim()) lines.push(m.description.trim());
        if (m.acceptanceCriteria?.trim()) {
          lines.push('Acceptance criteria:');
          lines.push(m.acceptanceCriteria.trim());
        }
      }
    }
    return lines.join('\n');
  }

  /**
   * §9.3 — called by the round-transition flow when the VOTE stage ends (round
   * moves to TALLY). Finalizes every DEBATE_VOTE-stage proposal in the round
   * — APPROVED if threshold met, REJECTED otherwise. The finalize() guard that
   * refuses mid-VOTE doesn't apply here because we're called AFTER the round
   * left VOTE (round.status === TALLY when this runs).
   */
  /**
   * §9.1 — auto-ranking per category: passing proposals are sorted by yes-power (then score %,
   * then submission time) and walked down the category budget. Fits → APPROVED; passes but
   * doesn't fit → REJECTED (budget-cut). §9.2 — identical scores at the budget cliff trigger a
   * Quick Poll (candidates stay ACTIVE until the poll resolves).
   */
  async finalizeRound(roundId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId, stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE },
      select: { id: true, categoryId: true, requestedAmountAda: true, submittedAt: true, createdAt: true },
    });
    type Ranked = { id: string; amount: bigint; submittedAt: Date; yesPower: number; pct: number };
    const byCategory = new Map<string, Ranked[]>();
    for (const p of proposals) {
      try {
        const r = await this.result(p.id);
        if (!('open' in r) || !r.open) continue; // no snapshot — board finalizes manually
        if (!r.approved) {
          await this.finalize(p.id); // failed the threshold → REJECTED as before
          continue;
        }
        const denom = Math.max(0, (r.totalPower ?? 0) - (r.abstainPower ?? 0));
        const key = p.categoryId ?? '';
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key)!.push({
          id: p.id,
          amount: p.requestedAmountAda ?? 0n,
          submittedAt: p.submittedAt ?? p.createdAt,
          yesPower: r.yesPower ?? 0,
          pct: denom > 0 ? (r.yesPower ?? 0) / denom : 0,
        });
      } catch {
        // Leave un-finalizable proposals ACTIVE for manual board action.
      }
    }

    const EPS = 1e-9;
    for (const [categoryId, list] of byCategory) {
      const cat = categoryId
        ? await this.prisma.roundCategory.findUnique({ where: { id: categoryId }, select: { allocatedAda: true } })
        : null;
      let remaining = cat ? cat.allocatedAda : null; // both allocatedAda + requestedAmountAda are lovelace
      list.sort((a, b) => b.yesPower - a.yesPower || b.pct - a.pct || a.submittedAt.getTime() - b.submittedAt.getTime());

      let i = 0;
      let cliff = false; // once the budget is exhausted, everything below is budget-cut
      while (i < list.length) {
        // Group proposals with identical scores — they rank equally, so the budget can't
        // legitimately prefer one over another.
        const group = [list[i]];
        while (i + group.length < list.length &&
               Math.abs(list[i + group.length].yesPower - list[i].yesPower) < EPS &&
               Math.abs(list[i + group.length].pct - list[i].pct) < EPS) {
          group.push(list[i + group.length]);
        }
        const groupCost = group.reduce((s, g) => s + g.amount, 0n);

        if (!cliff && (remaining === null || groupCost <= remaining)) {
          for (const g of group) await this.safeFinalize(g.id, { forcedOutcome: 'APPROVED' });
          if (remaining !== null) remaining -= groupCost;
        } else if (!cliff && group.length > 1 && remaining !== null && group.some((g) => g.amount <= remaining!)) {
          // §9.2 — tie at the budget cliff: equal scores, budget fits only some.
          await this.createQuickPoll(roundId, categoryId, group.map((g) => g.id));
          cliff = true;
        } else {
          for (const g of group) await this.safeFinalize(g.id, { forcedOutcome: 'REJECTED', note: 'budget-cut' });
          cliff = true;
        }
        i += group.length;
      }
    }
  }

  private async safeFinalize(proposalId: string, opts: { forcedOutcome?: 'APPROVED' | 'REJECTED'; note?: string }) {
    try { await this.finalize(proposalId, opts); } catch { /* board finalizes manually */ }
  }

  /**
   * §11 — called by the round-transition flow when the round enters FUNDING. The
   * funding mechanics activate only now (not during TALLY): the skin-in-the-game
   * pledge clock starts for every approved proposal whose promised pledge is still
   * unconfirmed. Idempotent — proposals that already have a grace window are left
   * alone, so re-entering FUNDING never resets the clock.
   */
  async activateFunding(roundId: string) {
    const round = await this.prisma.round.findUnique({ where: { id: roundId }, select: { pledgeGraceDays: true } });
    const days = round?.pledgeGraceDays ?? ROUND_SETTING_DEFAULTS.pledgeGraceDays;
    const approved = await this.prisma.proposal.findMany({
      where: {
        roundId,
        status: ProposalStatus.APPROVED,
        pledgeAmountAda: { gt: 0n },
        pledgeConfirmedAt: null,
        pledgeGraceEndsAt: null,
      },
      select: { id: true },
    });
    const endsAt = new Date(Date.now() + days * 86_400_000);
    for (const p of approved) {
      await this.prisma.proposal.update({ where: { id: p.id }, data: { pledgeGraceEndsAt: endsAt } });
    }
  }

  /** §9.2 — auto-trigger: poll awaits the board's one-click confirm before voting opens.
   *  Public so a ranked poll's resolution can spawn a follow-up poll for a genuine sub-tie. */
  async createQuickPoll(roundId: string, categoryId: string, candidateIds: string[]) {
    const existing = await this.prisma.quickPoll.findFirst({
      where: { roundId, categoryId, status: { in: ['PENDING_BOARD', 'ACTIVE'] } },
      select: { id: true },
    });
    if (existing) return existing.id;
    // Voters frozen now: everyone in any candidate's D&V snapshot (same eligibility as D&V).
    const snaps = await this.prisma.voteSnapshot.findMany({
      where: { proposalId: { in: candidateIds } },
      include: { entries: { select: { drepId: true } } },
    });
    const eligible = [...new Set(snaps.flatMap((s) => s.entries.map((e) => e.drepId)))];
    const poll = await this.prisma.quickPoll.create({
      data: { roundId, categoryId, candidates: candidateIds, status: 'PENDING_BOARD', eligibleDrepIds: eligible },
    });
    return poll.id;
  }

  /** §8.2 — a board member opts in to vote on this funding proposal (adds them to the snapshot if open). */
  async optIn(userId: string, proposalId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId }, include: { user: { select: { drepKeyHash: true } } } });
    if (!drep) throw new ForbiddenException('DReps only');
    const seat = drep.user.drepKeyHash ? await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: drep.user.drepKeyHash } }) : null;
    if (!seat) throw new ForbiddenException('only board members opt in; admitted DReps vote by default');
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.stage !== ProposalStage.DEBATE_VOTE) throw new ConflictException('proposal is not in the DEBATE_VOTE stage');

    await this.prisma.dvBoardOptIn.upsert({
      where: { proposalId_drepId: { proposalId, drepId: drep.id } },
      update: {},
      create: { proposalId, drepId: drep.id },
    });
    // If voting already opened, add them to the live snapshot so they can vote now.
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (snapshot) {
      const has = await this.prisma.voteSnapshotEntry.findUnique({ where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: drep.id } } });
      if (!has) {
        const power = await this.realVotingPower([drep.drepIdOnchain]);
        await this.addSnapshotEntry(snapshot.id, drep.id, power.get(drep.drepIdOnchain) ?? 0n);
      }
    }
    return this.result(proposalId);
  }

  /** §9.2 — live balanced voting power (basePower × merit multiplier) for quick polls. */
  async liveBalancedPower(drepIds: string[]): Promise<Map<string, number>> {
    const dreps = await this.prisma.drep.findMany({ where: { id: { in: drepIds } }, select: { id: true, drepIdOnchain: true } });
    const stake = await this.realVotingPower(dreps.map((d) => d.drepIdOnchain));
    const max = await this.meritMax();
    const out = new Map<string, number>();
    for (const d of dreps) {
      const merit = await this.currentMerit(d.id, max);
      out.set(d.id, basePower(stake.get(d.drepIdOnchain) ?? 0n) * meritMultiplier(merit, max));
    }
    return out;
  }

  /** Real on-chain CIP-1694 voting power (lovelace) per DRep id; falls back to a nominal stake if 0. */
  private async realVotingPower(drepIds: string[]): Promise<Map<string, bigint>> {
    const fallback = toLovelaceAda(Number(this.config.get('DV_SNAPSHOT_STAKE_ADA') ?? 1_000_000));
    const out = new Map<string, bigint>();
    try {
      const vp = await this.cardano.drepVotingPower(drepIds);
      for (const id of drepIds) {
        const lovelace = vp.get(id)?.votingPowerLovelace ?? 0n;
        out.set(id, lovelace > 0n ? lovelace : fallback);
      }
    } catch {
      for (const id of drepIds) out.set(id, fallback); // Koios hiccup → nominal so voting still works
    }
    return out;
  }

  private async addSnapshotEntry(snapshotId: string, drepId: string, stakeLovelace: bigint) {
    const max = await this.meritMax();
    const merit = await this.currentMerit(drepId, max);
    const bp = basePower(stakeLovelace);
    const mm = meritMultiplier(merit, max);
    await this.prisma.voteSnapshotEntry.create({
      data: { snapshotId, drepId, stakeLovelace, meritPoints: merit, basePower: bp, meritMultiplier: mm, finalPower: bp * mm },
    });
  }

  /** §13 merit cap (runtime-configurable via MERIT_POINT_MAX). */
  private async meritMax(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'MERIT_POINT_MAX' } });
    return typeof row?.value === 'number' ? row.value : PLATFORM_CONFIG_DEFAULTS.MERIT_POINT_MAX;
  }

  /** §8.2 — eligible DRep casts/changes a balanced D&V vote (rationale mandatory). */
  async vote(userId: string, proposalId: string, choice: string, rationale: string) {
    // §8.2 — rationale is mandatory for a YES/NO ballot (enforced server-side, not just in the UI).
    if ((choice === 'YES' || choice === 'NO') && !(rationale ?? '').trim()) {
      throw new BadRequestException('a rationale is required for a YES/NO vote');
    }
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal || proposal.stage !== ProposalStage.DEBATE_VOTE) {
      throw new ConflictException('proposal is not in the DEBATE_VOTE stage');
    }
    if (proposal.round && proposal.round.status !== RoundStatus.VOTE && proposal.round.status !== RoundStatus.DV) {
      throw new ConflictException(
        `round is in ${proposal.round.status}; Debate & Vote ballots are accepted only while the round is in VOTE`,
      );
    }
    const drep = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true } } },
    });
    if (!drep) throw new ForbiddenException('DReps only');

    // §8.2 — a board member who has opted out of voting on funding D&V cannot
    // cast a ballot. The setting is on by default and toggleable from their
    // profile. Non-board DReps are unaffected.
    if (!drep.votesOnFundingProposals) {
      const seat = drep.user.drepKeyHash
        ? await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: drep.user.drepKeyHash } })
        : null;
      if (seat) {
        throw new ForbiddenException(
          'you have opted out of voting on funding proposals — enable it in your profile to cast a ballot',
        );
      }
    }

    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    if (!snapshot) throw new ConflictException('voting has not opened yet');
    const entry = await this.prisma.voteSnapshotEntry.findUnique({
      where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: drep.id } },
    });
    if (!entry) throw new ForbiddenException('you are not eligible to vote in this round');

    const existing = await this.prisma.vote.findFirst({
      where: { proposalId, drepId: drep.id, phase: VotePhase.DEBATE_VOTE },
    });
    if (existing) {
      // §8 — archive the rationale being replaced so every prior reasoning stays viewable
      // (read-only history), then overwrite the live vote + refresh its cast time.
      await this.prisma.dvRationale.create({
        data: { proposalId, drepId: drep.id, choice: existing.choice, rationale: existing.rationale, castAt: existing.castAt },
      });
      await this.prisma.vote.update({ where: { id: existing.id }, data: { choice, rationale, castAt: new Date() } });
    } else {
      await this.prisma.vote.create({
        data: { proposalId, drepId: drep.id, phase: VotePhase.DEBATE_VOTE, choice, rationale },
      });
    }
    // §13.2/§4.4 — YES/NO earns +1 (idempotent per proposal); ABSTAIN earns 0.
    // Missed ballots (no avoid signaled) are penalized by the daily sweep.
    if (choice !== VoteChoice.ABSTAIN) await this.merit?.tryAward(drep.id, 'DV_VOTE', proposalId);
    return this.result(proposalId);
  }

  /** §4.4 tally against the frozen snapshot; missing-no-avoid = implicit NO. */
  async result(proposalId: string, userId?: string) {
    // The caller's own DRep vote (if logged in) so the UI can flag it. Resolved up front
    // so the early "not open yet" return can still report it.
    const myDrep = userId ? await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } }) : null;
    const snapshot = await this.prisma.voteSnapshot.findFirst({
      where: { proposalId },
      include: { entries: true },
    });
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { status: true, stage: true, approvalThresholdPct: true, round: { select: { dvApprovalThresholdPct: true } } },
    });
    if (!snapshot) {
      return { open: false, status: proposal?.status, stage: proposal?.stage, myChoice: null, myRationale: null, myRationaleHistory: [] };
    }
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.DEBATE_VOTE },
    });
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
    const myChoice = myDrep ? choiceByDrep.get(myDrep.id) ?? null : null;
    const myRationale = myDrep ? votes.find((v) => v.drepId === myDrep.id)?.rationale ?? null : null;
    const myRationaleHistory = myDrep
      ? await this.prisma.dvRationale.findMany({
          where: { proposalId, drepId: myDrep.id },
          orderBy: { castAt: 'desc' },
          select: { choice: true, rationale: true, castAt: true },
        })
      : [];

    // §8.2 — board members who have toggled OFF voteOnFundingProposals are
    // skipped at tally time (their snapshot entry contributes 0 to YES /
    // denominator / eligible count). The snapshot itself is never mutated —
    // toggling the flag back on instantly restores their weight on the next
    // tally read.
    const drepIds = snapshot.entries.map((e) => e.drepId);
    const dreps = await this.prisma.drep.findMany({
      where: { id: { in: drepIds } },
      select: { id: true, votesOnFundingProposals: true, user: { select: { drepKeyHash: true } } },
    });
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    const skipDrepIds = new Set(
      dreps
        .filter((d) => !d.votesOnFundingProposals && d.user.drepKeyHash && boardHashes.has(d.user.drepKeyHash))
        .map((d) => d.id),
    );

    let yesPower = 0;
    let abstainPower = 0;
    let totalPower = 0;
    let cast = 0;
    let eligibleCount = 0;
    for (const e of snapshot.entries) {
      if (skipDrepIds.has(e.drepId)) continue; // board member opted out → effective abstain (zero weight)
      eligibleCount++;
      const fp = Number(e.finalPower ?? 0);
      totalPower += fp;
      const c = choiceByDrep.get(e.drepId);
      if (c) cast++;
      if (c === VoteChoice.YES) yesPower += fp;
      else if (c === VoteChoice.ABSTAIN) abstainPower += fp;
      // NO or missing → counts in denominator (implicit NO), not in yes/abstain
    }
    // Fallback order: the per-proposal stamp (set when filtering advances it) → the ROUND's
    // configured threshold → the platform default. Previously the round's own setting was
    // skipped, so an unstamped proposal in a 60%-round evaluated at the 67% global default.
    const thresholdPct = proposal?.approvalThresholdPct
      ? Number(proposal.approvalThresholdPct)
      : proposal?.round?.dvApprovalThresholdPct != null
        ? Number(proposal.round.dvApprovalThresholdPct)
        : ROUND_SETTING_DEFAULTS.dvApprovalThresholdPct;
    const tally = { yesPower, totalPower, abstainPower, thresholdPct };

    const anchor = await this.prisma.anchor.findFirst({ where: { proposalId, kind: 'dv' }, orderBy: { createdAt: 'desc' } });
    return {
      open: true,
      eligible: eligibleCount,
      cast,
      yesPower: round2(yesPower),
      abstainPower: round2(abstainPower),
      totalPower: round2(totalPower),
      denominator: round2(totalPower - abstainPower),
      ratioPct: round2(approvalRatio(tally) * 100),
      thresholdPct,
      approved: isApproved(tally),
      status: proposal?.status,
      stage: proposal?.stage,
      myChoice, // the caller's own vote (YES/NO/ABSTAIN) or null if not voted — drives the UI flag
      myRationale, // the caller's current rationale (pre-fills the box on re-vote)
      myRationaleHistory, // superseded rationales, newest first (read-only)
      votes: await this.dvVoteList(proposalId), // §8 public rationale + weight per voter
      anchorTxHash: anchor?.txHash ?? null,
      anchorHash: anchor?.hash ?? null,
    };
  }

  /**
   * §9 — continuous per-category Debate & Vote results for a whole round, for the
   * round's "Voting Result" tab. Every proposal that reached Debate & Vote (i.e. has
   * a vote snapshot — filtering-rejected ones never got one) gets the same YES / NO /
   * abstain / threshold tally shown in the vote phase, plus an outcome:
   *   - APPROVED  — funded (status APPROVED / COMPLETE / FAILED)
   *   - REJECTED  — lost (threshold miss or budget-cut)
   *   - PENDING   — not yet decided: voting still open, or a tie-break quick poll is running.
   * Within a category, proposals are ordered most-supported → least (YES power), with the
   * live quick-poll standing breaking ties so PENDING candidates reflect the ongoing poll.
   */
  async votingResults(roundId: string) {
    const proposals = await this.prisma.proposal.findMany({
      where: { roundId },
      select: {
        id: true, publicId: true, title: true, requestedAmountAda: true,
        status: true, approvalThresholdPct: true, round: { select: { dvApprovalThresholdPct: true } },
        categoryId: true, category: { select: { id: true, name: true } },
      },
    });
    if (proposals.length === 0) return { categories: [] };
    const ids = proposals.map((p) => p.id);

    // §9 — per-category budget (allocatedAda is stored in lovelace, like requestedAmountAda).
    const cats = await this.prisma.roundCategory.findMany({ where: { roundId }, select: { id: true, allocatedAda: true } });
    const allocByCat = new Map(cats.map((c) => [c.id, Number(c.allocatedAda ?? 0n) / 1e6]));

    // §8.2 — board members who opted out of funding votes carry zero weight in every tally.
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    const snapshots = await this.prisma.voteSnapshot.findMany({ where: { proposalId: { in: ids } }, include: { entries: true } });
    const snapByProposal = new Map(snapshots.map((s) => [s.proposalId, s]));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId: { in: ids }, phase: VotePhase.DEBATE_VOTE },
      select: { proposalId: true, drepId: true, choice: true },
    });
    const voteByProposalDrep = new Map<string, Map<string, string>>();
    for (const v of votes) {
      if (!voteByProposalDrep.has(v.proposalId)) voteByProposalDrep.set(v.proposalId, new Map());
      voteByProposalDrep.get(v.proposalId)!.set(v.drepId, v.choice);
    }
    const allDrepIds = [...new Set(snapshots.flatMap((s) => s.entries.map((e) => e.drepId)))];
    const dreps = await this.prisma.drep.findMany({
      where: { id: { in: allDrepIds } },
      select: { id: true, votesOnFundingProposals: true, user: { select: { drepKeyHash: true } } },
    });
    const skip = new Set(
      dreps.filter((d) => !d.votesOnFundingProposals && d.user.drepKeyHash && boardHashes.has(d.user.drepKeyHash)).map((d) => d.id),
    );

    // Live quick-poll power per candidate — orders PENDING proposals by the ongoing tie-break.
    const polls = await this.prisma.quickPoll.findMany({ where: { roundId }, include: { votes: true } });
    const pollPowerByProposal = new Map<string, number>();
    const inActivePoll = new Set<string>();
    for (const poll of polls) {
      for (const cand of poll.candidates) {
        const power = poll.votes.filter((v) => v.choice === cand).reduce((s, v) => s + v.power, 0);
        pollPowerByProposal.set(cand, (pollPowerByProposal.get(cand) ?? 0) + power);
        if (poll.status === 'PENDING_BOARD' || poll.status === 'ACTIVE') inActivePoll.add(cand);
      }
    }

    type Row = {
      id: string; publicId: string | null; title: string; requestedAmountAda: number;
      categoryId: string | null; categoryName: string | null;
      outcome: 'APPROVED' | 'PENDING' | 'REJECTED';
      // Why the budget mattered for this proposal:
      //  funded — won funding · cut — passed the vote but the category budget ran out (budget-cut)
      //  tie    — tied at the budget cliff, a quick poll decides · votes — got decisive votes but
      //  fell below the approval threshold · nopower — no voting power: no eligible DRep cast a
      //  decisive vote (no YES/NO power), so the threshold could never be met
      budgetOutcome: 'funded' | 'cut' | 'tie' | 'votes' | 'nopower';
      yesPower: number; noPower: number; abstainPower: number; totalPower: number;
      thresholdPct: number; ratioPct: number; cast: number; eligible: number;
      inQuickPoll: boolean; quickPollPower: number;
    };
    const rows: Row[] = [];
    for (const p of proposals) {
      const snap = snapByProposal.get(p.id);
      if (!snap) continue; // never reached Debate & Vote → not a voting result
      const voteByDrep = voteByProposalDrep.get(p.id) ?? new Map<string, string>();
      let yesPower = 0, abstainPower = 0, totalPower = 0, cast = 0, eligible = 0;
      for (const e of snap.entries) {
        if (skip.has(e.drepId)) continue;
        eligible++;
        const fp = Number(e.finalPower ?? 0);
        totalPower += fp;
        const c = voteByDrep.get(e.drepId);
        if (c) cast++;
        if (c === VoteChoice.YES) yesPower += fp;
        else if (c === VoteChoice.ABSTAIN) abstainPower += fp;
      }
      const noPower = Math.max(0, totalPower - yesPower - abstainPower);
      const thresholdPct = p.approvalThresholdPct
        ? Number(p.approvalThresholdPct)
        : p.round?.dvApprovalThresholdPct != null ? Number(p.round.dvApprovalThresholdPct) : ROUND_SETTING_DEFAULTS.dvApprovalThresholdPct;
      const { denom, ratioPct, passedThreshold } = voteRatio(yesPower, abstainPower, totalPower, thresholdPct);
      const outcome: Row['outcome'] =
        p.status === ProposalStatus.APPROVED || p.status === ProposalStatus.COMPLETE || p.status === ProposalStatus.FAILED ? 'APPROVED'
        : p.status === ProposalStatus.REJECTED ? 'REJECTED'
        : 'PENDING';
      const budgetOutcome = classifyBudgetOutcome(outcome, passedThreshold, denom);
      rows.push({
        id: p.id, publicId: p.publicId, title: p.title,
        requestedAmountAda: Number(p.requestedAmountAda ?? 0n) / 1e6,
        categoryId: p.categoryId, categoryName: p.category?.name ?? null,
        outcome, budgetOutcome,
        yesPower: round2(yesPower), noPower: round2(noPower), abstainPower: round2(abstainPower),
        totalPower: round2(totalPower), thresholdPct, ratioPct: round2(ratioPct),
        cast, eligible,
        inQuickPoll: inActivePoll.has(p.id), quickPollPower: round2(pollPowerByProposal.get(p.id) ?? 0),
      });
    }

    const byCat = new Map<string, { id: string | null; name: string | null; allocatedAda: number; allocatedToApprovedAda: number; remainingAda: number; proposals: Row[] }>();
    for (const r of rows) {
      const key = r.categoryId ?? '';
      if (!byCat.has(key)) {
        byCat.set(key, { id: r.categoryId, name: r.categoryName, allocatedAda: allocByCat.get(r.categoryId ?? '') ?? 0, allocatedToApprovedAda: 0, remainingAda: 0, proposals: [] });
      }
      byCat.get(key)!.proposals.push(r);
    }
    // APPROVED first, then PENDING (still in a tie-break), then REJECTED — and within each
    // group most-supported → least (D&V power, then the live quick-poll standing, then ratio).
    // Outcome leads because tied proposals share the same D&V power, so the result must order them.
    const outcomeRank: Record<string, number> = { APPROVED: 0, PENDING: 1, REJECTED: 2 };
    for (const c of byCat.values()) {
      c.proposals.sort((a, b) =>
        (outcomeRank[a.outcome] ?? 3) - (outcomeRank[b.outcome] ?? 3)
        || b.yesPower - a.yesPower
        || b.quickPollPower - a.quickPollPower
        || b.ratioPct - a.ratioPct);
      // Budget actually committed to funded proposals, and what's left unallocated.
      c.allocatedToApprovedAda = round2(c.proposals.filter((p) => p.outcome === 'APPROVED').reduce((s, p) => s + p.requestedAmountAda, 0));
      c.remainingAda = round2(c.allocatedAda - c.allocatedToApprovedAda);
    }
    return { categories: [...byCat.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')) };
  }

  /**
   * §9.3 — finalize the tally and publish the result. APPROVED if threshold met,
   * else REJECTED. Anchors the result on-chain. Refuses while the round is still
   * in VOTE — finalizing mid-vote would publish a half-counted result based on
   * implicit-NO from voters who simply haven't voted yet. The board advances the
   * round to FUNDING (or the VOTE window expires) and finalize is auto-triggered
   * from the round-transition flow then.
   */
  async finalize(proposalId: string, opts: { forcedOutcome?: 'APPROVED' | 'REJECTED'; note?: string } = {}) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal) throw new BadRequestException('proposal not found');
    if (proposal.round?.status === RoundStatus.VOTE) {
      throw new ConflictException(
        'voting is still in progress (round is in VOTE); the tally is finalized automatically when the round advances to TALLY',
      );
    }
    const r = await this.result(proposalId);
    if (!('open' in r) || !r.open) throw new BadRequestException('voting has not opened');
    // §9.1/§9.2 — finalizeRound (auto-ranking) and quick-poll resolution can force the outcome:
    // a proposal can pass the threshold yet be REJECTED (budget-cut), or win a tie-break.
    const status = (opts.forcedOutcome as ProposalStatus | undefined) ?? (r.approved ? ProposalStatus.APPROVED : ProposalStatus.REJECTED);
    const stage = status === ProposalStatus.APPROVED ? ProposalStage.FUNDING : null;
    // §16.4 — the skin-in-the-game pledge clock is NOT started here. finalize() runs at
    // the VOTE→TALLY boundary, but the pledge grace (and the rest of the funding mechanics)
    // only activate when the round reaches FUNDING — see activateFunding().
    await this.prisma.proposal.update({
      where: { id: proposalId },
      data: { status, stage, resultFinalizedAt: new Date() },
    });

    // §9.3 — the publish action anchors the final tally on-chain.
    try {
      const proposal = await this.prisma.proposal.findUnique({
        where: { id: proposalId },
        include: { round: { select: { number: true, id: true, name: true } } },
      });
      const voteList = await this.dvVoteList(proposalId);
      // §4.4 — missing voters count as implicit NO in the tally; record them explicitly in the
      // anchored audit trail so "who voted NO" is answerable from the proof, not by absence.
      const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: { include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } } } } });
      const votedDreps = new Set(voteList.map((v) => v.drep));
      for (const e of snapshot?.entries ?? []) {
        if (!votedDreps.has(e.drep.drepIdOnchain)) {
          voteList.push({
            drep: e.drep.drepIdOnchain,
            displayName: e.drep.user?.displayName ?? null,
            choice: 'IMPLICIT_NO',
            weight: round2(Number(e.finalPower ?? 0)),
            rationale: null,
          });
        }
      }
      const noPower = Math.max(0, (r.totalPower ?? 0) - (r.yesPower ?? 0) - (r.abstainPower ?? 0));
      await this.anchor.anchorResult({
        kind: 'dv',
        subject: GovSubject.DV,
        style: VotingStyle.BALANCED,
        ref: `${proposal?.title ?? 'proposal'} · ${proposal?.round?.name ?? `Round #${proposal?.round?.number ?? '?'}`}${opts.note ? ` · ${opts.note}` : ''}`,
        proposalId,
        publicId: proposal?.publicId ?? null,
        roundId: proposal?.round?.id ?? proposal?.roundId ?? null,
        votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice, power: v.weight })),
        preimageVotes: voteList,
        outcome: status,
        yes: round2(r.yesPower ?? 0),
        no: round2(noPower),
        threshold: r.thresholdPct ?? 0,
        totalPower: round2(r.totalPower ?? 0),
      });
    } catch {
      // anchoring failure must not undo the published result (recorded for retry).
    }
    return { ...r, status, stage, finalized: true };
  }

  /** D&V votes with on-chain DRep id, choice, weight (final power) and rationale. */
  private async dvVoteList(proposalId: string) {
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.DEBATE_VOTE },
      include: { drep: { select: { id: true, drepIdOnchain: true, votesOnFundingProposals: true, user: { select: { displayName: true, drepKeyHash: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    // §8.2 — a board member who has opted out has their weight zeroed in the
    // public vote list so the audit row makes sense alongside the tally.
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    return votes.map((v) => {
      const isBoard = !!v.drep.user?.drepKeyHash && boardHashes.has(v.drep.user.drepKeyHash);
      const optedOut = isBoard && !v.drep.votesOnFundingProposals;
      return {
        drep: v.drep.drepIdOnchain,
        displayName: v.drep.user?.displayName ?? null,
        choice: v.choice,
        weight: optedOut ? 0 : round2(powerByDrep.get(v.drepId) ?? 0),
        rationale: v.rationale ?? null,
      };
    });
  }

  private async currentMerit(drepId: string, max?: number): Promise<number> {
    const rows = await this.prisma.meritLedger.aggregate({
      where: { drepId },
      _sum: { delta: true },
    });
    const sum = rows._sum.delta ? Number(rows._sum.delta) : 0;
    return clampMerit(sum, max ?? (await this.meritMax()));
  }
}

function toLovelaceAda(ada: number): bigint {
  return BigInt(Math.round(ada)) * LOVELACE;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
