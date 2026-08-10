import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ROUND_SETTING_DEFAULTS,
  ProposalStage,
  ProposalStatus,
  RoundStatus,
  VoteChoice,
  VotePhase,
  VotingType,
} from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { rankReviewerCandidates } from './candidate-ranking';
import { AnchorService } from '../cardano/anchor.service';
import { MeritService } from '../merit/merit.service';

@Injectable()
export class FilteringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly anchor: AnchorService,
    @Optional() private readonly merit?: MeritService,
  ) {}

  /**
   * §7.1 — draw reviewers for a proposal in FILTERING. MVP: random draw from the
   * round's eligible (admitted) DReps, excluding the submitter. (The opt-in pool,
   * subcategory match, and verifiable block-hash seed are deferred.) Idempotent.
   */
  async drawReviewers(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { filterReviewerCount: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.FILTERING || proposal.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }

    const existing = await this.prisma.filterAssignment.findMany({
      where: { proposalId, releasedAt: null },
    });
    if (existing.length > 0) return this.result(proposalId);

    // §7.1 — eligible admitted DReps in the round, with their declared subcategories.
    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      select: { drepId: true, drep: { select: { subcategoryIds: true, userId: true } } },
    });
    // The submitter NEVER reviews their own proposal — excluded by drep id AND by user id
    // (covers proposals submitted before the user had a DRep row).
    let cands = eligible.filter((e) => e.drepId !== proposal.submitterDrepId && e.drep.userId !== proposal.submitterUserId);
    if (cands.length === 0) throw new BadRequestException('no eligible reviewers in this round');
    // §13.4 — DReps who signalled an avoid period aren't drawn (unless excluding
    // them would leave nobody, in which case the board reassigns manually).
    if (this.merit) {
      const avail: typeof cands = [];
      for (const c of cands) if (!(await this.merit.isInAvoidPeriod(c.drepId))) avail.push(c);
      if (avail.length > 0) cands = avail;
    }

    // §7.1 equal-participation: how many times each DRep has been drawn this round.
    const roundProposals = await this.prisma.proposal.findMany({
      where: { roundId: proposal.roundId ?? undefined },
      select: { id: true },
    });
    const counts = await this.prisma.filterAssignment.groupBy({
      by: ['drepId'],
      where: { proposalId: { in: roundProposals.map((p) => p.id) } },
      _count: { _all: true },
    });
    const drawnCount = new Map(counts.map((c) => [c.drepId, c._count._all]));

    // §7.1 — prefer DReps whose subcategories overlap the proposal's; within a tier
    // prefer the least-drawn so far (equal participation), breaking ties randomly.
    const propSubs = new Set(proposal.subcategoryIds ?? []);
    const expertiseMatch = (subs: string[]) => propSubs.size > 0 && subs.some((s) => propSubs.has(s));
    const ranked = rankReviewerCandidates(
      cands.map((e) => ({
        drepId: e.drepId,
        expertiseMatch: expertiseMatch(e.drep.subcategoryIds),
        loadInRound: drawnCount.get(e.drepId) ?? 0,
      })),
    );
    // §6 — per-round override of the reviewer count, else the platform default.
    const count = Math.min(proposal.round?.filterReviewerCount ?? ROUND_SETTING_DEFAULTS.filterReviewerCount, ranked.length);
    const chosen = ranked.slice(0, count).map((r) => r.drepId);

    await this.prisma.filterAssignment.createMany({
      data: chosen.map((drepId) => ({ proposalId, drepId, acceptedAt: new Date() })),
    });
    return this.result(proposalId);
  }

  /**
   * §7 — a reviewer's filtering assignments in one of three views (To do / Recent / History
   * partition cleanly — a proposal is in exactly one):
   *  - 'pending' (To do): assignments in a CURRENT filtering stage they HAVEN'T voted on yet —
   *                the actionable to-do list. Once they vote, it leaves this view for Recent.
   *  - 'recent'  : assignments in a current filtering stage they HAVE voted on — still changeable
   *                while the round stays in filtering. Not-voted ones live in To do, not here.
   *  - 'history' : every assignment they ever had whose round has moved PAST filtering.
   */
  async myAssignments(userId: string, mode: 'pending' | 'recent' | 'history' = 'pending') {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return [];
    // Recent/pending = rounds still in the filtering stage (SUBMISSION pre-open + FILTERING),
    // across every active round. History = rounds that have moved PAST filtering (Debate/Vote/
    // Funding/Closed) — so Recent and History are disjoint. Note recent/history gate on the ROUND,
    // not the proposal's own status, so a proposal rejected this round (a NO vote) still shows
    // under Recent (it was filtered in the active stage) and only moves to History when the round
    // advances. Pending additionally needs the proposal still votable (ACTIVE @ FILTERING).
    const activeFilteringRound = { status: { in: [RoundStatus.SUBMISSION, RoundStatus.FILTERING] } };
    const where = mode === 'history'
      ? { drepId: drep.id, proposal: { round: { status: { notIn: [RoundStatus.SUBMISSION, RoundStatus.FILTERING] } } } }
      : mode === 'recent'
        ? { drepId: drep.id, proposal: { round: activeFilteringRound } }
        : {
            drepId: drep.id,
            releasedAt: null,
            proposal: { stage: ProposalStage.FILTERING, status: ProposalStatus.ACTIVE, round: activeFilteringRound },
          };
    const assignments = await this.prisma.filterAssignment.findMany({
      where,
      include: {
        proposal: {
          select: {
            id: true, title: true, publicId: true, status: true, stage: true,
            round: { select: { status: true } },
            submitterUser: { select: { displayName: true } },
            submitterDrep: { select: { drepIdOnchain: true } },
          },
        },
      },
      // Stable order (assignedAt can tie) so the list doesn't reshuffle between loads.
      orderBy: [{ assignedAt: 'desc' }, { proposalId: 'asc' }],
    });
    // A reviewer can hold several assignment rows for the SAME proposal (re-draws / replacements);
    // collapse to one row per proposal (the newest, kept by the sort above).
    const seen = new Set<string>();
    const unique = assignments.filter((a) => (seen.has(a.proposalId) ? false : (seen.add(a.proposalId), true)));
    const myVotes = await this.prisma.vote.findMany({
      where: { drepId: drep.id, phase: VotePhase.FILTERING, proposalId: { in: unique.map((a) => a.proposalId) } },
    });
    const rows = unique.map((a) => ({
      proposalId: a.proposalId,
      title: a.proposal.title,
      // §UI — searchable metadata: public id + proposer name (display name → DRep id).
      publicId: a.proposal.publicId ?? null,
      proposer: a.proposal.submitterUser?.displayName ?? a.proposal.submitterDrep?.drepIdOnchain ?? null,
      myVote: myVotes.find((v) => v.proposalId === a.proposalId)?.choice ?? null,
      proposalStatus: a.proposal.status,
      proposalStage: a.proposal.stage,
      // True = pre-assigned but the round hasn't opened FILTERING yet → UI shows
      // a QUEUED badge and disables the Vote action until the round moves.
      queued: a.proposal.round?.status === RoundStatus.SUBMISSION,
    }));
    // To do / Recent split on whether THIS reviewer has voted, so the two are disjoint:
    //  - 'pending' (To do): not yet voted (queued ones included — votable once the round opens).
    //  - 'recent'         : already voted (still changeable while the round stays in filtering).
    // 'history' returns every past-filtering assignment regardless of vote.
    return mode === 'pending' ? rows.filter((r) => r.myVote == null)
      : mode === 'recent' ? rows.filter((r) => r.myVote != null)
        : rows;
  }

  /**
   * Count the items awaiting THIS user across the "Voting & reviews" tab — open filtering
   * assignments, open D&V proposals they're eligible for, and open milestone reviews — each
   * not yet voted on. Powers the tab's red badge + the login notification routing.
   */
  async votingTasksCount(userId: string) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return { filtering: 0, dv: 0, milestone: 0, total: 0 };

    const fAssign = await this.prisma.filterAssignment.findMany({
      // §3/§5 — only count tasks where the ROUND is in FILTERING (voting open).
      // During SUBMISSION, reviewers may already be assigned but voting is closed,
      // so we don't ping DReps to vote until the round actually opens it.
      where: {
        drepId: drep.id,
        releasedAt: null,
        proposal: {
          stage: ProposalStage.FILTERING,
          status: ProposalStatus.ACTIVE,
          round: { status: RoundStatus.FILTERING },
        },
      },
      select: { proposalId: true },
    });
    const fVoted = new Set(
      (await this.prisma.vote.findMany({
        where: { drepId: drep.id, phase: VotePhase.FILTERING, proposalId: { in: fAssign.map((a) => a.proposalId) } },
        select: { proposalId: true },
      })).map((v) => v.proposalId),
    );
    const filtering = fAssign.filter((a) => !fVoted.has(a.proposalId)).length;

    const dvEntries = await this.prisma.voteSnapshotEntry.findMany({
      where: { drepId: drep.id, snapshot: { proposal: { stage: ProposalStage.DEBATE_VOTE, status: ProposalStatus.ACTIVE } } },
      select: { snapshot: { select: { proposalId: true } } },
    });
    const dvProps = [...new Set(dvEntries.map((e) => e.snapshot.proposalId))];
    const dvVoted = new Set(
      (await this.prisma.vote.findMany({
        where: { drepId: drep.id, phase: VotePhase.DEBATE_VOTE, proposalId: { in: dvProps } },
        select: { proposalId: true },
      })).map((v) => v.proposalId),
    );
    const dv = dvProps.filter((pid) => !dvVoted.has(pid)).length;

    const mAssign = await this.prisma.milestoneAssignment.findMany({
      where: { reviewerDrepId: drep.id, releasedAt: null, milestone: { status: 'POA_SUBMITTED' } },
      select: { milestoneId: true },
    });
    const mVoted = new Set(
      (await this.prisma.vote.findMany({
        where: { drepId: drep.id, phase: VotePhase.MILESTONE, milestoneId: { in: mAssign.map((a) => a.milestoneId) } },
        select: { milestoneId: true },
      })).map((v) => v.milestoneId),
    );
    const milestone = mAssign.filter((a) => !mVoted.has(a.milestoneId)).length;

    return { filtering, dv, milestone, total: filtering + dv + milestone };
  }

  /** §7.2 — assigned reviewer casts/changes a 1p1v filtering vote. NO requires rationale. */
  async vote(userId: string, proposalId: string, choice: string, rationale?: string) {
    if (!Object.values(VoteChoice).includes(choice as VoteChoice)) {
      throw new BadRequestException('choice must be YES, NO or ABSTAIN');
    }
    if (choice === VoteChoice.NO && !rationale?.trim()) {
      throw new BadRequestException('a NO vote requires written rationale');
    }
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { status: true } } },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    // §3/§5/§7 — the gate is the ROUND, not the proposal stage. A proposal's stage
    // flips to DEBATE_VOTE the moment its filtering threshold is met, but DReps can
    // still change their filtering vote for the whole window the round is in
    // FILTERING (the on-chain anchor that fired at first-decision time is final;
    // post-decision vote changes update only the per-DRep record). During SUBMISSION
    // reviewers may be pre-assigned but votes are not yet accepted.
    if (proposal.round && proposal.round.status !== RoundStatus.FILTERING) {
      throw new ConflictException(
        `filtering voting is closed — the round is in ${proposal.round.status}, not FILTERING`,
      );
    }
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('DReps only');
    const assignment = await this.prisma.filterAssignment.findFirst({
      where: { proposalId, drepId: drep.id, releasedAt: null },
    });
    if (!assignment) throw new ForbiddenException('you are not assigned to filter this proposal');

    const existing = await this.prisma.vote.findFirst({
      where: { proposalId, drepId: drep.id, phase: VotePhase.FILTERING },
    });
    if (existing) {
      await this.prisma.vote.update({ where: { id: existing.id }, data: { choice, rationale: rationale ?? null } });
    } else {
      await this.prisma.vote.create({
        data: { proposalId, drepId: drep.id, phase: VotePhase.FILTERING, choice, rationale: rationale ?? null },
      });
    }
    // §13.2 — completing a filtering review earns +1 merit (idempotent per proposal,
    // so re-casting doesn't re-award). Missed reviews are penalized by the daily sweep.
    await this.merit?.tryAward(drep.id, 'FILTER_COMPLETE', proposalId);
    await this.maybeDecide(proposalId);
    return this.result(proposalId);
  }

  /**
   * §7.2 — recompute the filtering decision against the live tally and move the
   * proposal there if its current state doesn't match. Runs after every vote
   * change (cast / re-cast / replacement) while the round is in FILTERING.
   *
   *  - yes >= threshold → ACTIVE + DEBATE_VOTE (advanced; anchor on transition)
   *  - no  >= threshold → REJECTED + FILTERING (rejected; anchor on transition)
   *  - neither           → ACTIVE + FILTERING (revert if a previous decision
   *                        is no longer supported by the current votes)
   *
   * Anchors are written on every transition into a decided state — so if a
   * proposal flips ACCEPTED → reverted → REJECTED → reverted → ACCEPTED, the
   * on-chain history shows all three decisions and the latest one wins, per
   * the "ensure the latest change is written" rule.
   *
   * Skipped entirely once the round leaves FILTERING — at that point the
   * decision is frozen and vote changes can't move the proposal anymore.
   */
  private async maybeDecide(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { round: { select: { number: true, id: true, name: true, status: true, filterApprovalVotes: true, dvApprovalThresholdPct: true } } },
    });
    if (!proposal) return;
    if (proposal.round?.status !== RoundStatus.FILTERING) return;

    const threshold = proposal.round.filterApprovalVotes ?? ROUND_SETTING_DEFAULTS.filterApprovalVotes;
    const dvThresholdPct = proposal.round.dvApprovalThresholdPct ?? ROUND_SETTING_DEFAULTS.dvApprovalThresholdPct;
    const votes = await this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.FILTERING } });
    const yes = votes.filter((v) => v.choice === VoteChoice.YES).length;
    const no = votes.filter((v) => v.choice === VoteChoice.NO).length;
    // §7.2 — rejection requires YES to be mathematically out of reach, not just
    // "NO matches the YES threshold". With 4 reviewers and threshold 2, two NOs
    // still leave two unvoted reviewers who could deliver the YES; three NOs
    // mean only one reviewer is left and a 2-YES majority is impossible.
    const assignedCount = await this.prisma.filterAssignment.count({
      where: { proposalId, releasedAt: null },
    });
    const maxPossibleYes = Math.max(0, assignedCount - no);

    // Where the live tally says the proposal should be right now.
    const desired: { status: ProposalStatus; stage: ProposalStage; outcome: 'ACCEPTED' | 'REJECTED' | null } =
      yes >= threshold
        ? { status: ProposalStatus.ACTIVE, stage: ProposalStage.DEBATE_VOTE, outcome: 'ACCEPTED' }
        : maxPossibleYes < threshold
          ? { status: ProposalStatus.REJECTED, stage: ProposalStage.FILTERING, outcome: 'REJECTED' }
          : { status: ProposalStatus.ACTIVE, stage: ProposalStage.FILTERING, outcome: null };

    if (proposal.status === desired.status && proposal.stage === desired.stage) return;

    if (desired.outcome === 'ACCEPTED') {
      await this.prisma.proposal.update({
        where: { id: proposalId },
        data: {
          status: ProposalStatus.ACTIVE,
          stage: ProposalStage.DEBATE_VOTE,
          votingType: VotingType.BALANCED,
          approvalThresholdPct: dvThresholdPct,
        },
      });
    } else if (desired.outcome === 'REJECTED') {
      await this.prisma.proposal.update({
        where: { id: proposalId },
        data: { status: ProposalStatus.REJECTED, stage: ProposalStage.FILTERING },
      });
    } else {
      // Revert — a vote change undid the prior decision. Drop back to active
      // filtering; no anchor is written here (the prior anchor stays as the
      // historical record; the next threshold crossing writes a fresh one).
      await this.prisma.proposal.update({
        where: { id: proposalId },
        data: { status: ProposalStatus.ACTIVE, stage: ProposalStage.FILTERING },
      });
      return;
    }

    // §C — anchor the new decision on-chain (subject + every reviewer's vote + tally).
    try {
      const voteList = await this.anchorVoteList(proposalId);
      await this.anchor.anchorResult({
        kind: 'filtering',
        subject: GovSubject.FILTERING,
        style: VotingStyle.ONE_PERSON_ONE_VOTE,
        ref: `${proposal.title} · ${proposal.round?.name ?? `Round #${proposal.round?.number ?? '?'}`}`,
        proposalId,
        publicId: proposal.publicId ?? null,
        roundId: proposal.round?.id ?? proposal.roundId ?? null,
        votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice })),
        preimageVotes: voteList,
        outcome: desired.outcome,
        yes,
        no,
        threshold,
      });
    } catch (e) {
      // Anchoring must never undo the decision; it's recorded for retry by AnchorService.
    }
  }

  /** Reviewer votes with on-chain DRep id + rationale, latest per reviewer (for anchor + public view). */
  private async anchorVoteList(proposalId: string) {
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.FILTERING },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    return votes.map((v) => ({
      drep: v.drep.drepIdOnchain,
      displayName: v.drep.user?.displayName ?? null,
      choice: v.choice,
      rationale: v.rationale ?? null,
    }));
  }

  async result(proposalId: string) {
    const [assignments, votes, proposal, voteList, anchor] = await Promise.all([
      this.prisma.filterAssignment.findMany({
        where: { proposalId, releasedAt: null },
        include: { drep: { select: { drepIdOnchain: true, subcategoryIds: true, user: { select: { displayName: true } } } } },
      }),
      this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.FILTERING } }),
      this.prisma.proposal.findUnique({
        where: { id: proposalId },
        select: { status: true, stage: true, subcategoryIds: true, round: { select: { filterApprovalVotes: true } } },
      }),
      this.anchorVoteList(proposalId),
      this.prisma.anchor.findFirst({ where: { proposalId, kind: 'filtering' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const threshold = proposal?.round?.filterApprovalVotes ?? ROUND_SETTING_DEFAULTS.filterApprovalVotes;
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
    const propSubs = new Set(proposal?.subcategoryIds ?? []);
    // §7.1 — who is assigned, whether they've voted yet, and if they matched the expertise.
    const assigned = assignments.map((a) => ({
      drepId: a.drepId, // internal UUID — used by the board's "Change" action
      drep: a.drep.drepIdOnchain,
      displayName: a.drep.user?.displayName ?? null,
      voted: choiceByDrep.has(a.drepId),
      choice: choiceByDrep.get(a.drepId) ?? null,
      expertiseMatch: propSubs.size > 0 && a.drep.subcategoryIds.some((s) => propSubs.has(s)),
    }));
    return {
      reviewers: assignments.length,
      assigned,
      yes: votes.filter((v) => v.choice === VoteChoice.YES).length,
      no: votes.filter((v) => v.choice === VoteChoice.NO).length,
      abstain: votes.filter((v) => v.choice === VoteChoice.ABSTAIN).length,
      threshold,
      status: proposal?.status,
      stage: proposal?.stage,
      votes: voteList, // §7 public rationale: drep id, display name, choice, rationale
      anchorTxHash: anchor?.txHash ?? null,
      anchorHash: anchor?.hash ?? null,
    };
  }

  /**
   * §7.1 — board view: every admitted DRep eligible to filter this proposal, with
   * (a) expertise overlap with the proposal's subcategories, (b) the DRep's load
   * across the round so far (how many filterings they're already on), (c) whether
   * they're currently assigned to THIS proposal, and (d) whether they've already
   * voted (vote is final — can't be reassigned). The submitter is excluded. Used
   * by the board's "Change reviewer" picker on the proposal page.
   */
  /**
   * §7.1 — board view. Default = every admitted DRep eligible for the round.
   * With `{ includeOutsideRound: true }` the result also includes admitted DReps
   * NOT yet in this round's eligibility (each carries `inRound: false`); picking
   * one auto-adds them to the round on assignment (see replaceReviewer).
   */
  async candidates(proposalId: string, options: { includeOutsideRound?: boolean } = {}) {
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, subcategoryIds: true, submitterDrepId: true, submitterUserId: true, roundId: true },
    });
    if (!proposal) throw new NotFoundException('proposal not found');

    const eligible = await this.prisma.roundDrepEligibility.findMany({
      where: { roundId: proposal.roundId ?? undefined, drep: { status: 'ADMITTED' } },
      include: { drep: { select: { id: true, userId: true, drepIdOnchain: true, subcategoryIds: true, user: { select: { displayName: true } } } } },
    });
    // The full set of admitted DReps in the DAO, when the board wants to pick one
    // who is not yet in this round's eligibility list.
    const eligibleSet = new Set(eligible.map((e) => e.drepId));
    const outside = options.includeOutsideRound
      ? await this.prisma.drep.findMany({
          where: { status: 'ADMITTED', id: { notIn: [...eligibleSet] } },
          select: { id: true, userId: true, drepIdOnchain: true, subcategoryIds: true, user: { select: { displayName: true } } },
        })
      : [];

    // Load count = how many filtering assignments the DRep has across the round.
    const roundProposalIds = (await this.prisma.proposal.findMany({
      where: { roundId: proposal.roundId ?? undefined },
      select: { id: true },
    })).map((p) => p.id);
    const loadRows = await this.prisma.filterAssignment.groupBy({
      by: ['drepId'],
      where: { proposalId: { in: roundProposalIds }, releasedAt: null },
      _count: { _all: true },
    });
    const load = new Map(loadRows.map((r) => [r.drepId, r._count._all]));

    // Currently-assigned + voted state for THIS proposal only.
    const active = await this.prisma.filterAssignment.findMany({
      where: { proposalId, releasedAt: null },
      select: { drepId: true },
    });
    const activeSet = new Set(active.map((a) => a.drepId));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.FILTERING },
      select: { drepId: true },
    });
    const votedSet = new Set(votes.map((v) => v.drepId));

    const propSubs = new Set(proposal.subcategoryIds ?? []);
    const inRoundRows = eligible
      .filter((e) => e.drepId !== proposal.submitterDrepId && e.drep.userId !== proposal.submitterUserId)
      .map((e) => {
        const match = propSubs.size > 0 && e.drep.subcategoryIds.some((s) => propSubs.has(s));
        return {
          drepId: e.drep.id,
          drepIdOnchain: e.drep.drepIdOnchain,
          displayName: e.drep.user?.displayName ?? null,
          subcategoryIds: e.drep.subcategoryIds,
          expertiseMatch: !!match,
          matchedSubcategoryIds: e.drep.subcategoryIds.filter((s) => propSubs.has(s)),
          loadInRound: load.get(e.drep.id) ?? 0,
          alreadyAssigned: activeSet.has(e.drep.id),
          alreadyVoted: votedSet.has(e.drep.id),
          inRound: true,
        };
      });
    const outsideRows = outside
      .filter((d) => d.id !== proposal.submitterDrepId && d.userId !== proposal.submitterUserId)
      .map((d) => {
        const match = propSubs.size > 0 && d.subcategoryIds.some((s) => propSubs.has(s));
        return {
          drepId: d.id,
          drepIdOnchain: d.drepIdOnchain,
          displayName: d.user?.displayName ?? null,
          subcategoryIds: d.subcategoryIds,
          expertiseMatch: !!match,
          matchedSubcategoryIds: d.subcategoryIds.filter((s) => propSubs.has(s)),
          loadInRound: 0,
          alreadyAssigned: false,
          alreadyVoted: false,
          inRound: false,
        };
      });
    const out = [...inRoundRows, ...outsideRows].sort((a, b) =>
      // In-round first, then expertise-matched first, then least-drawn, then by name.
      Number(b.inRound) - Number(a.inRound) ||
      Number(b.expertiseMatch) - Number(a.expertiseMatch) ||
      a.loadInRound - b.loadInRound ||
      (a.displayName ?? '').localeCompare(b.displayName ?? ''),
    );
    return out;
  }

  /**
   * §7.1 — board swaps one assigned reviewer for another on a proposal still in
   * FILTERING. Gated: the old reviewer must currently be assigned AND must not
   * have voted yet (a cast vote is final); the new DRep must be eligible for the
   * round, not the submitter, and not already on this proposal. Soft-releases the
   * old assignment (`releasedAt = now`, `replacedBy = newDrepId`) and creates a
   * fresh assignment for the new DRep.
   */
  async replaceReviewer(proposalId: string, oldDrepId: string, newDrepId: string, _userId: string) {
    void _userId;
    if (oldDrepId === newDrepId) {
      throw new BadRequestException('the replacement DRep must be different');
    }
    const proposal = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, status: true, stage: true, roundId: true, submitterDrepId: true, submitterUserId: true },
    });
    if (!proposal) throw new NotFoundException('proposal not found');
    if (proposal.stage !== ProposalStage.FILTERING || proposal.status !== ProposalStatus.ACTIVE) {
      throw new ConflictException('proposal is not in the FILTERING stage');
    }

    const oldAssignment = await this.prisma.filterAssignment.findFirst({
      where: { proposalId, drepId: oldDrepId, releasedAt: null },
    });
    if (!oldAssignment) {
      throw new ConflictException('that DRep is not currently assigned to this proposal');
    }
    // Vote is final — can't swap a reviewer who's already cast it.
    const alreadyVoted = await this.prisma.vote.findFirst({
      where: { proposalId, drepId: oldDrepId, phase: VotePhase.FILTERING },
    });
    if (alreadyVoted) {
      throw new ConflictException('this reviewer has already voted — their vote is final and cannot be replaced');
    }
    // The replacement must be an admitted DRep + not the submitter + not already on this proposal.
    const newDrepUser = await this.prisma.drep.findUnique({ where: { id: newDrepId }, select: { userId: true } });
    if (newDrepUser?.userId === proposal.submitterUserId) {
      throw new BadRequestException('the submitter cannot review their own proposal');
    }
    if (newDrepId === proposal.submitterDrepId) {
      throw new BadRequestException('the submitter cannot review their own proposal');
    }
    const newDrep = await this.prisma.drep.findUnique({
      where: { id: newDrepId },
      select: { id: true, status: true },
    });
    if (!newDrep || newDrep.status !== 'ADMITTED') {
      throw new BadRequestException('replacement is not an admitted DRep');
    }
    const eligibleRow = await this.prisma.roundDrepEligibility.findUnique({
      where: { roundId_drepId: { roundId: proposal.roundId!, drepId: newDrepId } },
    });
    const conflict = await this.prisma.filterAssignment.findFirst({
      where: { proposalId, drepId: newDrepId, releasedAt: null },
    });
    if (conflict) {
      throw new BadRequestException('that DRep is already assigned to this proposal');
    }

    // If the new DRep isn't yet in this round's eligibility list, add them — the
    // board explicitly chose them, so we widen the round's pool by one. Existing
    // assignments / votes elsewhere in the round are untouched.
    const writes: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.filterAssignment.update({
        where: { id: oldAssignment.id },
        data: { releasedAt: new Date(), replacedBy: newDrepId },
      }),
      this.prisma.filterAssignment.create({
        data: { proposalId, drepId: newDrepId, acceptedAt: new Date() },
      }),
    ];
    if (!eligibleRow) {
      writes.push(
        this.prisma.roundDrepEligibility.create({
          data: { roundId: proposal.roundId!, drepId: newDrepId },
        }),
      );
    }
    await this.prisma.$transaction(writes);
    return this.result(proposalId);
  }
}
