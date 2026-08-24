import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
  VoteChoice,
  VotePhase,
  VotersScope,
  VotingType,
  InternalType,
  ProposalType,
} from '@drep-dao/shared';
import { GovSubject, VotingStyle } from '@drep-dao/cardano';
import { Prisma } from '@drep-dao/db';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { CreateInternalProposalDto, SaveDraftDto, VoteInternalDto } from './dto';

const LOVELACE = 1_000_000n;
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

interface Ctx {
  userId: string;
  isBoard: boolean;
}

/**
 * §10 — Internal proposals: DAO-governance decisions (process changes, polls, board changes…).
 * Not tied to a round; voting opens immediately on submission. Lifecycle DRAFT→ACTIVE→APPROVED|
 * REJECTED (we submit straight to ACTIVE). Threshold proposals (INSTRUCTIVE/INFORMATIVE) use the
 * §4.4 tally; POLLs tally votes per option. Decisions are anchored on-chain with a date-independent
 * document hash and the structured id "Internal N".
 */
@Injectable()
export class InternalProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anchor: AnchorService,
    private readonly cardano: CardanoQueryService,
  ) {}

  // ---- submission -----------------------------------------------------------

  async submit(userId: string, dto: CreateInternalProposalDto) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep || drep.status !== 'ADMITTED') {
      throw new ForbiddenException('only admitted DReps (board members included) can submit internal proposals');
    }
    if (dto.internalType === InternalType.POLL && (!dto.pollOptions || dto.pollOptions.length < 2)) {
      throw new BadRequestException('a poll needs at least two options');
    }
    // §10.5 — "Spending internal proposal": amount + destination required; the source bucket is
    // optional (defaults to the Operations bucket when the action is prepared on approval).
    if (dto.internalType === InternalType.SPENDING) {
      if (!(dto.spendingAmountAda && dto.spendingAmountAda > 0)) {
        throw new BadRequestException('a spending proposal needs a positive ADA amount');
      }
      if (!dto.spendingDestAddress?.trim().startsWith('addr')) {
        throw new BadRequestException('a spending proposal needs a destination address (bech32, addr…)');
      }
      if (dto.spendingSourceBucketId) {
        const b = await this.prisma.treasuryBucket.findUnique({ where: { id: dto.spendingSourceBucketId } });
        const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
        if (!b || !active || b.configId !== active.id) {
          throw new BadRequestException('the source address must belong to the active treasury multisig');
        }
      }
    }

    const now = new Date();
    // Submitter picks an end date (the platform derives the days); a days duration is the fallback.
    const end = dto.votingEndAt
      ? new Date(dto.votingEndAt)
      : new Date(now.getTime() + (dto.votingPeriodDays ?? 7) * DAY_MS);
    if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) {
      throw new BadRequestException('the voting end must be a date in the future');
    }

    // §14 — Board-member election: an INSTRUCTIVE internal proposal with forced defaults.
    // Voters scope / voting type / threshold are NOT submitter-configurable for elections.
    let internalType = dto.internalType;
    let scope = dto.isPrivate ? VotersScope.BOARD_ONLY : dto.votersScope;
    let votingType = dto.votingType;
    let thresholdKind = dto.thresholdKind;
    let actorsData: unknown = dto.internalType === InternalType.INSTRUCTIVE && dto.actors?.length ? dto.actors : undefined;
    let deliveryDate: Date | undefined =
      dto.internalType === InternalType.INSTRUCTIVE && dto.deliveryDate ? new Date(dto.deliveryDate) : undefined;

    if (dto.isBoardElection) {
      internalType = InternalType.INSTRUCTIVE;
      scope = VotersScope.BOTH;
      votingType = VotingType.BALANCED;
      thresholdKind = 'IMPORTANT';
      if (dto.isPrivate) throw new BadRequestException('board-member elections are public — cannot be PRIVATE');
      if (!dto.candidates || dto.candidates.length !== 5) {
        throw new BadRequestException('a board-member election must include exactly 5 candidates');
      }
      if (new Set(dto.candidates).size !== 5) throw new BadRequestException('candidates must be distinct');
      if (!dto.deliveryDate) throw new BadRequestException('an installation date (delivery date) is required');
      deliveryDate = new Date(dto.deliveryDate);
      if (Number.isNaN(deliveryDate.getTime()) || deliveryDate.getTime() <= end.getTime()) {
        throw new BadRequestException('the installation date must be later than the voting end');
      }
      // Resolve candidates → store {drepId, drepKeyHash, drepIdOnchain, displayName} in actors.
      // Accept either a `drep.id` UUID (tests/admin tooling) or a `drep_id_onchain` bech32 string
      // (what `daoApi.members()` returns to the form).
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = dto.candidates.filter((c) => uuidRe.test(c));
      const bechs = dto.candidates.filter((c) => !uuidRe.test(c));
      const dreps = await this.prisma.drep.findMany({
        where: {
          status: 'ADMITTED',
          OR: [
            ...(ids.length ? [{ id: { in: ids } }] : []),
            ...(bechs.length ? [{ drepIdOnchain: { in: bechs } }] : []),
          ],
        },
        include: { user: { select: { drepKeyHash: true, displayName: true } } },
      });
      if (dreps.length !== 5) throw new BadRequestException('every candidate must be an admitted DRep');
      const missingKey = dreps.find((d) => !d.user?.drepKeyHash);
      if (missingKey) throw new BadRequestException('a candidate has no on-chain DRep key — cannot install');
      actorsData = dreps.map((d) => ({
        drepId: d.id,
        drepKeyHash: d.user!.drepKeyHash!,
        drepIdOnchain: d.drepIdOnchain,
        displayName: d.user?.displayName ?? '(no name)',
      }));
    }

    // §27 — "Approval of a rule document": one published document must be selected. Approval votes
    // target DRAFT documents; a delete vote can target a DRAFT or ACTIVE one. Submitting freezes the
    // content hash (below) and locks the document while the vote is live.
    let ruleDoc: { id: string; contentMd: string } | null = null;
    if (dto.internalType === InternalType.RULE_APPROVAL) {
      if (!dto.ruleDocumentId) throw new BadRequestException('select a rule document for this proposal');
      const doc = await this.prisma.ruleDocument.findUnique({ where: { id: dto.ruleDocumentId } });
      if (!doc || doc.status === 'PRIVATE' || doc.status === 'DELETED') {
        throw new BadRequestException('the rule document must be a published (draft or active) document');
      }
      if (!dto.ruleDeleteRequested && doc.status !== 'DRAFT') {
        throw new BadRequestException('only a draft document can be submitted for approval');
      }
      const liveVote = await this.prisma.proposal.findFirst({
        where: { ruleDocumentId: doc.id, internalType: InternalType.RULE_APPROVAL, status: ProposalStatus.ACTIVE },
        select: { id: true },
      });
      if (liveVote) throw new BadRequestException('this document already has a vote in progress');
      ruleDoc = { id: doc.id, contentMd: doc.contentMd };
    }

    // §28 — decision approval (mirror of rule-document approval on the `decision` table).
    let decisionRow: { id: string; contentMd: string } | null = null;
    if (dto.internalType === InternalType.DECISION_APPROVAL) {
      if (!dto.decisionId) throw new BadRequestException('select a decision for this proposal');
      const dec = await this.prisma.decision.findUnique({ where: { id: dto.decisionId } });
      if (!dec || dec.status === 'PRIVATE' || dec.status === 'DELETED') {
        throw new BadRequestException('the decision must be a published (draft or active) decision');
      }
      if (!dto.decisionDeleteRequested && dec.status !== 'DRAFT') {
        throw new BadRequestException('only a draft decision can be submitted for approval');
      }
      const liveVote = await this.prisma.proposal.findFirst({
        where: { decisionId: dec.id, internalType: InternalType.DECISION_APPROVAL, status: ProposalStatus.ACTIVE },
        select: { id: true },
      });
      if (liveVote) throw new BadRequestException('this decision already has a vote in progress');
      decisionRow = { id: dec.id, contentMd: dec.contentMd };
    }

    const thresholdPct = await this.thresholdPct(thresholdKind);
    const publicId = await this.nextPublicId();

    const proposal = await this.prisma.proposal.create({
      data: {
        type: ProposalType.INTERNAL,
        status: ProposalStatus.ACTIVE,
        stage: ProposalStage.VOTING,
        publicId,
        submitterUserId: userId,
        submitterDrepId: drep.id,
        title: dto.title.trim(),
        contentMd: dto.contentMd,
        internalType,
        votersScope: scope,
        thresholdKind,
        isPrivate: !!dto.isPrivate && !dto.isBoardElection,
        isBoardElection: !!dto.isBoardElection,
        pollOptions:
          internalType === InternalType.POLL
            ? { multiple: !!dto.pollMultiple, options: dto.pollOptions }
            : undefined,
        actors: actorsData as Prisma.InputJsonValue | undefined,
        deliveryDate,
        votingType,
        approvalThresholdPct: thresholdPct,
        votingStartAt: now,
        votingEndAt: end,
        submittedAt: now,
        // §10.5 — spending parameters (lovelace), executed via multisig on approval.
        spendingAmountAda: internalType === InternalType.SPENDING ? BigInt(Math.round(dto.spendingAmountAda! * 1_000_000)) : undefined,
        spendingSourceBucketId: internalType === InternalType.SPENDING ? dto.spendingSourceBucketId ?? null : undefined,
        spendingDestAddress: internalType === InternalType.SPENDING ? dto.spendingDestAddress!.trim() : undefined,
        // §27 — associate the rule document + FREEZE its content hash now (vote opens = hash made).
        ruleDocumentId: internalType === InternalType.RULE_APPROVAL ? ruleDoc!.id : undefined,
        ruleDeleteRequested: internalType === InternalType.RULE_APPROVAL ? !!dto.ruleDeleteRequested : undefined,
        ruleDocContentHash: internalType === InternalType.RULE_APPROVAL ? sha256hex(ruleDoc!.contentMd) : undefined,
        decisionId: internalType === InternalType.DECISION_APPROVAL ? decisionRow!.id : undefined,
        decisionDeleteRequested: internalType === InternalType.DECISION_APPROVAL ? !!dto.decisionDeleteRequested : undefined,
        decisionContentHash: internalType === InternalType.DECISION_APPROVAL ? sha256hex(decisionRow!.contentMd) : undefined,
      },
    });
    // Freeze the eligible-voter set + power now, so voting can start immediately.
    await this.buildSnapshot(proposal.id, scope, votingType);
    // Submitted from a saved draft → remove the draft now that the live proposal exists.
    if (dto.draftId) await this.deleteDraft(userId, dto.draftId).catch(() => undefined);
    return this.detail(proposal.id, userId);
  }

  // ---- drafts (§10) ---------------------------------------------------------
  // A draft is an INTERNAL proposal with status DRAFT: no public id, no vote snapshot, no voting
  // window. It is visible and editable only to its author and is removed once submitted.

  async saveDraft(userId: string, dto: SaveDraftDto) {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep || drep.status !== 'ADMITTED') {
      throw new ForbiddenException('only admitted DReps (board members included) can save drafts');
    }
    const draft = await this.prisma.proposal.create({
      data: {
        type: ProposalType.INTERNAL,
        status: ProposalStatus.DRAFT,
        submitterUserId: userId,
        submitterDrepId: drep.id,
        ...this.draftData(dto),
      },
    });
    return this.detail(draft.id, userId);
  }

  async updateDraft(userId: string, draftId: string, dto: SaveDraftDto) {
    await this.ownDraft(userId, draftId);
    await this.prisma.proposal.update({ where: { id: draftId }, data: this.draftData(dto) });
    return this.detail(draftId, userId);
  }

  async deleteDraft(userId: string, draftId: string) {
    await this.ownDraft(userId, draftId);
    await this.prisma.proposal.delete({ where: { id: draftId } });
    return { id: draftId, deleted: true };
  }

  /** Assert the row is an INTERNAL DRAFT owned by the caller (throws otherwise). */
  private async ownDraft(userId: string, draftId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: draftId } });
    if (!p || p.type !== ProposalType.INTERNAL || p.status !== ProposalStatus.DRAFT) {
      throw new NotFoundException('draft not found');
    }
    if (p.submitterUserId !== userId) throw new ForbiddenException('not your draft');
    return p;
  }

  /** Map a (lenient) draft DTO to Proposal column values — shared by create + update. */
  private draftData(dto: SaveDraftDto) {
    const internalType = dto.internalType ?? InternalType.INFORMATIVE;
    const poll = internalType === InternalType.POLL;
    const spending = internalType === InternalType.SPENDING;
    const instructive = internalType === InternalType.INSTRUCTIVE;
    return {
      title: (dto.title ?? '').trim(),
      contentMd: dto.contentMd ?? '',
      internalType,
      votersScope: dto.isPrivate ? VotersScope.BOARD_ONLY : (dto.votersScope ?? VotersScope.BOTH),
      thresholdKind: dto.thresholdKind ?? 'DEFAULT',
      isPrivate: !!dto.isPrivate,
      votingType: dto.votingType ?? VotingType.BALANCED,
      pollOptions: poll
        ? ({ multiple: !!dto.pollMultiple, options: dto.pollOptions ?? [] } as Prisma.InputJsonValue)
        : Prisma.DbNull,
      actors: instructive && dto.actors?.length ? (dto.actors as Prisma.InputJsonValue) : Prisma.DbNull,
      deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
      votingEndAt: dto.votingEndAt ? new Date(dto.votingEndAt) : null,
      spendingAmountAda: spending && dto.spendingAmountAda ? BigInt(Math.round(dto.spendingAmountAda * 1_000_000)) : null,
      spendingSourceBucketId: spending ? dto.spendingSourceBucketId ?? null : null,
      spendingDestAddress: spending ? dto.spendingDestAddress?.trim() ?? null : null,
    };
  }

  /** "Internal 1", "Internal 2", … — the structured public id used in the UI + on-chain. */
  private async nextPublicId(): Promise<string> {
    const n = await this.prisma.proposal.count({ where: { type: ProposalType.INTERNAL, publicId: { not: null } } });
    return `Internal ${n + 1}`;
  }

  private async thresholdPct(kind: string): Promise<number> {
    const key = kind === 'IMPORTANT' ? 'INTERNAL_IMPORTANT_THRESHOLD_PCT' : 'INTERNAL_DEFAULT_THRESHOLD_PCT';
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    return typeof row?.value === 'number'
      ? row.value
      : ((PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)[key] as number);
  }

  // ---- eligibility + snapshot ----------------------------------------------

  /** Admitted DReps in scope: BOARD_ONLY → board seats; DREPS_ONLY → non-board; BOTH → everyone. */
  private async eligibleDreps(scope: string) {
    const dreps = await this.prisma.drep.findMany({
      where: { status: 'ADMITTED' },
      select: { id: true, drepIdOnchain: true, user: { select: { drepKeyHash: true } } },
    });
    const boardHashes = new Set(
      (await this.prisma.boardSeat.findMany({ where: { removedAt: null }, select: { drepKeyHash: true } })).map((s) => s.drepKeyHash),
    );
    const board = (d: (typeof dreps)[number]) => (d.user?.drepKeyHash ? boardHashes.has(d.user.drepKeyHash) : false);
    if (scope === VotersScope.BOARD_ONLY) return dreps.filter(board);
    if (scope === VotersScope.DREPS_ONLY) return dreps.filter((d) => !board(d));
    return dreps;
  }

  private async buildSnapshot(proposalId: string, scope: string, votingType: string) {
    const voters = await this.eligibleDreps(scope);
    const snapshot = await this.prisma.voteSnapshot.create({ data: { proposalId } });
    const usesStake = votingType === VotingType.BALANCED || votingType === VotingType.ONCHAIN;
    const power = usesStake ? await this.realVotingPower(voters.map((v) => v.drepIdOnchain)) : new Map<string, bigint>();
    for (const v of voters) {
      const stake = power.get(v.drepIdOnchain) ?? 0n;
      if (votingType === VotingType.BALANCED) {
        await this.addBalancedEntry(snapshot.id, v.id, stake);
      } else if (votingType === VotingType.ONCHAIN) {
        await this.addOnchainEntry(snapshot.id, v.id, stake);
      } else {
        // 1 member = 1 vote: everyone carries equal weight 1.
        await this.prisma.voteSnapshotEntry.create({
          data: { snapshotId: snapshot.id, drepId: v.id, stakeLovelace: 0n, meritPoints: 0, basePower: 1, meritMultiplier: 1, finalPower: 1 },
        });
      }
    }
  }

  private async realVotingPower(drepIds: string[]): Promise<Map<string, bigint>> {
    const fallback = BigInt(Math.round(Number(this.config.get('DV_SNAPSHOT_STAKE_ADA') ?? 1_000_000))) * LOVELACE;
    const out = new Map<string, bigint>();
    try {
      const vp = await this.cardano.drepVotingPower(drepIds);
      for (const id of drepIds) {
        const lovelace = vp.get(id)?.votingPowerLovelace ?? 0n;
        out.set(id, lovelace > 0n ? lovelace : fallback);
      }
    } catch {
      for (const id of drepIds) out.set(id, fallback);
    }
    return out;
  }

  private async addBalancedEntry(snapshotId: string, drepId: string, stakeLovelace: bigint) {
    const max = await this.meritMax();
    const merit = await this.currentMerit(drepId, max);
    const bp = basePower(stakeLovelace);
    const mm = meritMultiplier(merit, max);
    await this.prisma.voteSnapshotEntry.create({
      data: { snapshotId, drepId, stakeLovelace, meritPoints: merit, basePower: bp, meritMultiplier: mm, finalPower: bp * mm },
    });
  }

  private async addOnchainEntry(snapshotId: string, drepId: string, stakeLovelace: bigint) {
    // On-chain (unadjusted): raw delegated voting power in ADA — no log compression, no merit.
    const ada = Number(stakeLovelace) / Number(LOVELACE);
    await this.prisma.voteSnapshotEntry.create({
      data: { snapshotId, drepId, stakeLovelace, meritPoints: 0, basePower: ada, meritMultiplier: 1, finalPower: ada },
    });
  }

  private async meritMax(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'MERIT_POINT_MAX' } });
    return typeof row?.value === 'number' ? row.value : PLATFORM_CONFIG_DEFAULTS.MERIT_POINT_MAX;
  }

  private async currentMerit(drepId: string, max: number): Promise<number> {
    const rows = await this.prisma.meritLedger.aggregate({ where: { drepId }, _sum: { delta: true } });
    return clampMerit(rows._sum.delta ? Number(rows._sum.delta) : 0, max);
  }

  // Internal proposals only — per-choice minimum words required in the rationale (0 = not required).
  private async rationaleMinWords(): Promise<{ YES: number; NO: number; ABSTAIN: number }> {
    const keys = {
      YES: 'MIN_LEN_OF_WORDS_IN_RATIONALE_FOR_VOTE_YES',
      NO: 'MIN_LEN_OF_WORDS_IN_RATIONALE_FOR_VOTE_NO',
      ABSTAIN: 'MIN_LEN_OF_WORDS_IN_RATIONALE_FOR_VOTE_ABSTAIN',
    } as const;
    const rows = await this.prisma.platformConfig.findMany({ where: { key: { in: Object.values(keys) } } });
    const read = (key: string) => {
      const row = rows.find((r) => r.key === key);
      return typeof row?.value === 'number' ? row.value : ((PLATFORM_CONFIG_DEFAULTS as Record<string, unknown>)[key] as number);
    };
    return { YES: read(keys.YES), NO: read(keys.NO), ABSTAIN: read(keys.ABSTAIN) };
  }

  // Record a vote (or set of poll options) and supersede the voter's prior current vote instead of
  // deleting it — every prior vote stays as read-only history (marked superseded). `castAt` defaults
  // to now() so the history orders correctly.
  private async castVotes(proposalId: string, drepId: string, rows: { choice: string; rationale: string | null }[]): Promise<void> {
    const prior = await this.prisma.vote.findMany({
      where: { proposalId, drepId, phase: VotePhase.INTERNAL, supersededBy: null },
      select: { id: true },
    });
    const created: string[] = [];
    for (const r of rows) {
      const v = await this.prisma.vote.create({
        data: { proposalId, drepId, phase: VotePhase.INTERNAL, choice: r.choice, rationale: r.rationale },
      });
      created.push(v.id);
    }
    if (prior.length) {
      await this.prisma.vote.updateMany({ where: { id: { in: prior.map((p) => p.id) } }, data: { supersededBy: created[0] } });
    }
  }

  // Enforce the per-choice rationale word minimum server-side (the UI also gates the buttons).
  private async requireRationale(choice: string, rationale: string | null): Promise<void> {
    const mins = await this.rationaleMinWords();
    const min = mins[choice as keyof typeof mins] ?? 0;
    if (min <= 0) return;
    const words = (rationale ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (words < min) {
      throw new BadRequestException(`voting ${choice} requires a rationale of at least ${min} word(s) (you wrote ${words}).`);
    }
  }

  // ---- voting ---------------------------------------------------------------

  async vote(userId: string, proposalId: string, dto: VoteInternalDto) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    await this.maybeFinalize(proposal);
    const fresh = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!fresh || fresh.status !== ProposalStatus.ACTIVE) throw new ConflictException('voting is closed for this proposal');

    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('DReps only');
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    const entry = snapshot
      ? await this.prisma.voteSnapshotEntry.findUnique({ where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: drep.id } } })
      : null;
    if (!entry) throw new ForbiddenException('you are not eligible to vote on this proposal');

    const rationale = dto.rationale?.trim() || null;
    // Validate the selection BEFORE casting, so a rejected re-vote leaves the existing vote intact.
    // A vote change supersedes (never deletes) the prior vote so the full history stays viewable.
    if (fresh.internalType === InternalType.POLL) {
      // Voters may abstain on a poll (counted toward "voted" but no option). Exclusive with options.
      if (dto.choice === VoteChoice.ABSTAIN) {
        await this.requireRationale(VoteChoice.ABSTAIN, rationale);
        await this.castVotes(proposalId, drep.id, [{ choice: VoteChoice.ABSTAIN, rationale }]);
      } else {
        const cfg = (fresh.pollOptions ?? {}) as { multiple?: boolean; options?: string[] };
        const options = cfg.options ?? [];
        const chosen = dto.options ?? [];
        if (chosen.length === 0) throw new BadRequestException('select at least one option');
        if (!cfg.multiple && chosen.length !== 1) throw new BadRequestException('this poll allows exactly one option');
        for (const o of chosen) if (!options.includes(o)) throw new BadRequestException(`unknown option: ${o}`);
        await this.castVotes(proposalId, drep.id, chosen.map((o) => ({ choice: o, rationale })));
      }
    } else {
      const choice = dto.choice;
      if (!choice || ![VoteChoice.YES, VoteChoice.NO, VoteChoice.ABSTAIN].includes(choice as VoteChoice)) {
        throw new BadRequestException('choice must be YES, NO or ABSTAIN');
      }
      await this.requireRationale(choice, rationale);
      await this.castVotes(proposalId, drep.id, [{ choice, rationale }]);
    }
    return this.detail(proposalId, userId);
  }

  // §10 — the voting end is fixed at submission and never changes afterwards (set it before
  // submitting / while it's a draft). There is intentionally no "extend voting" endpoint.

  // ---- listing + detail -----------------------------------------------------

  /**
   * Count of internal proposals awaiting THIS user's vote: still ACTIVE + end in the future +
   * this DRep is in the snapshot + no INTERNAL vote yet + visibility allows (PRIVATE → board).
   * Powers the "Internal proposals" tab badge in My area.
   */
  async pendingCount(userId: string): Promise<{ count: number }> {
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) return { count: 0 };
    const isBoard = await this.isBoardUser(userId);
    const entries = await this.prisma.voteSnapshotEntry.findMany({
      where: {
        drepId: drep.id,
        snapshot: {
          proposal: {
            type: ProposalType.INTERNAL,
            status: ProposalStatus.ACTIVE,
            votingEndAt: { gt: new Date() }, // skip those that should auto-finalize on next read
            ...(isBoard ? {} : { isPrivate: false }),
          },
        },
      },
      select: { snapshot: { select: { proposalId: true } } },
    });
    const proposalIds = [...new Set(entries.map((e) => e.snapshot.proposalId))];
    if (proposalIds.length === 0) return { count: 0 };
    const voted = new Set(
      (
        await this.prisma.vote.findMany({
          where: { drepId: drep.id, phase: VotePhase.INTERNAL, proposalId: { in: proposalIds } },
          select: { proposalId: true },
        })
      ).map((v) => v.proposalId),
    );
    return { count: proposalIds.filter((pid) => !voted.has(pid)).length };
  }

  async list(viewerUserId: string) {
    const isBoard = await this.isBoardUser(viewerUserId);
    const all = await this.prisma.proposal.findMany({
      where: { type: ProposalType.INTERNAL },
      orderBy: { createdAt: 'desc' },
      include: { submitterUser: { select: { displayName: true } } },
    });
    const out = [];
    for (const p of all) {
      await this.maybeFinalize(p);
      const mine = p.submitterUserId === viewerUserId;
      if (p.status === ProposalStatus.DRAFT) {
        if (!mine) continue; // §10 — a draft is private work-in-progress, visible only to its author
      } else if (p.isPrivate && !isBoard) {
        continue; // PRIVATE submitted → board only
      }
      out.push(await this.summary(p.id, { userId: viewerUserId, isBoard }));
    }
    return out;
  }

  /** Public entry: resolve the viewer's board status, then build the detail. */
  async detail(proposalId: string, viewerUserId: string) {
    return this.build(proposalId, { userId: viewerUserId, isBoard: await this.isBoardUser(viewerUserId) });
  }

  private async build(proposalId: string, ctx: Ctx) {
    const p = await this.prisma.proposal.findUnique({
      where: { id: proposalId },
      include: { submitterUser: { select: { displayName: true } }, submitterDrep: { select: { drepIdOnchain: true } } },
    });
    if (!p || p.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    await this.maybeFinalize(p);
    // §14 auto-install: an approved election whose installation date has passed → install now.
    await this.maybeInstallElection(p.id);
    // §10.5 — make sure an approved spending proposal has its multisig action queued.
    await this.maybePrepareSpending(p.id).catch(() => undefined);
    if (p.isPrivate && !ctx.isBoard && p.submitterUserId !== ctx.userId) {
      throw new ForbiddenException('this internal proposal is private to the board');
    }

    const fresh = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    const tally = await this.tally(proposalId);
    const myDrep = await this.prisma.drep.findUnique({ where: { userId: ctx.userId }, select: { id: true } });
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId } });
    const eligibleEntry = myDrep && snapshot
      ? await this.prisma.voteSnapshotEntry.findUnique({ where: { snapshotId_drepId: { snapshotId: snapshot.id, drepId: myDrep.id } } })
      : null;
    const myCurrentVotes = myDrep
      ? await this.prisma.vote.findMany({ where: { proposalId, drepId: myDrep.id, phase: VotePhase.INTERNAL, supersededBy: null } })
      : [];
    const myVotes = myCurrentVotes.map((v) => v.choice);
    const myRationale = myCurrentVotes[0]?.rationale ?? null;
    // Full per-voter history (current + superseded) with the on-chain DRep id, display name, choice
    // (or option label), weight, rationale, and cast time — the detail page renders the whole trail
    // so viewers see who voted how, why, and how votes changed over time.
    const voters = await this.voteHistory(proposalId);
    const rationaleMinWords = await this.rationaleMinWords();
    const anchor = await this.prisma.anchor.findFirst({ where: { proposalId, kind: 'internal' }, orderBy: { createdAt: 'desc' } });
    // §27 — for a rule-approval vote, the targeted document + the content hash frozen when the vote opened.
    const ruleDoc = p.internalType === 'RULE_APPROVAL' && p.ruleDocumentId
      ? await this.prisma.ruleDocument.findUnique({ where: { id: p.ruleDocumentId }, select: { id: true, title: true, status: true } })
      : null;
    const decisionRow = p.internalType === 'DECISION_APPROVAL' && p.decisionId
      ? await this.prisma.decision.findUnique({ where: { id: p.decisionId }, select: { id: true, title: true, status: true } })
      : null;
    const pollCfg = (p.pollOptions ?? null) as { multiple?: boolean; options?: string[] } | null;

    // For elections, `actors` is a JSON array of {drepId, drepKeyHash, drepIdOnchain, displayName};
    // for plain instructive proposals it's a plain string[] of names.
    const isElection = !!p.isBoardElection;
    const rawActors = p.actors as unknown;
    const candidates = isElection && Array.isArray(rawActors)
      ? (rawActors as { drepId: string; drepKeyHash: string; drepIdOnchain: string; displayName: string }[])
      : null;
    const freshAfterInstall = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    // §10.5 — spending proposals expose the parameters + the prepared multisig action's status.
    const spendingAction = freshAfterInstall?.spendingActionId
      ? await this.prisma.multisigAction.findUnique({
          where: { id: freshAfterInstall.spendingActionId },
          select: { id: true, status: true, txHash: true, paidAt: true },
        })
      : null;
    const spendingBucket = freshAfterInstall?.spendingSourceBucketId
      ? await this.prisma.treasuryBucket.findUnique({ where: { id: freshAfterInstall.spendingSourceBucketId }, select: { label: true } })
      : null;
    return {
      id: p.id,
      publicId: p.publicId,
      title: p.title,
      contentMd: p.contentMd,
      internalType: p.internalType,
      votersScope: p.votersScope,
      thresholdKind: p.thresholdKind,
      votingType: p.votingType,
      isPrivate: p.isPrivate,
      isBoardElection: isElection,
      boardInstalledAt: freshAfterInstall?.boardInstalledAt ?? null,
      status: freshAfterInstall?.status ?? fresh?.status ?? p.status,
      submitter: p.submitterUser?.displayName ?? null,
      submitterDrepId: p.submitterDrep?.drepIdOnchain ?? null,
      isMine: p.submitterUserId === ctx.userId,
      // legacy `actors: string[]` for non-election Instructive proposals
      actors: !isElection && Array.isArray(rawActors) ? (rawActors as string[]) : null,
      candidates,
      deliveryDate: p.deliveryDate,
      poll: pollCfg ? { multiple: !!pollCfg.multiple, options: pollCfg.options ?? [] } : null,
      thresholdPct: p.approvalThresholdPct ? Number(p.approvalThresholdPct) : null,
      votingStartAt: p.votingStartAt,
      votingEndAt: p.votingEndAt,
      resultFinalizedAt: p.resultFinalizedAt,
      canVote: !!eligibleEntry && (fresh?.status ?? p.status) === ProposalStatus.ACTIVE,
      rationaleMinWords,
      myVotes,
      myRationale,
      voters,
      tally,
      anchorTxHash: anchor?.txHash ?? null,
      anchorHash: anchor?.hash ?? null,
      // §27 — rule-approval target: the document, whether this is a delete vote, and the frozen hash.
      rule: ruleDoc ? {
        documentId: ruleDoc.id,
        title: ruleDoc.title,
        documentStatus: ruleDoc.status,
        deleteRequested: !!p.ruleDeleteRequested,
        contentHash: p.ruleDocContentHash ?? null,
      } : null,
      decision: decisionRow ? {
        decisionId: decisionRow.id,
        title: decisionRow.title,
        decisionStatus: decisionRow.status,
        deleteRequested: !!p.decisionDeleteRequested,
        contentHash: p.decisionContentHash ?? null,
      } : null,
      // §10.5 — spending parameters (ADA) + the board-signing action once approved.
      spending: p.internalType === 'SPENDING' ? {
        amountAda: Number(freshAfterInstall?.spendingAmountAda ?? 0n) / 1e6,
        destAddress: freshAfterInstall?.spendingDestAddress ?? null,
        sourceBucketId: freshAfterInstall?.spendingSourceBucketId ?? null,
        sourceBucketLabel: spendingBucket?.label ?? null,
        action: spendingAction,
      } : null,
    };
  }

  private async summary(proposalId: string, ctx: Ctx) {
    const d = await this.build(proposalId, ctx);
    return {
      id: d.id,
      publicId: d.publicId,
      title: d.title,
      internalType: d.internalType,
      votersScope: d.votersScope,
      votingType: d.votingType,
      thresholdKind: d.thresholdKind,
      isPrivate: d.isPrivate,
      isBoardElection: d.isBoardElection,
      boardInstalledAt: d.boardInstalledAt,
      status: d.status,
      submitter: d.submitter,
      votingEndAt: d.votingEndAt,
      thresholdPct: d.thresholdPct,
      tally: d.tally,
      isMine: d.isMine,
      myVotes: d.myVotes, // surface "you voted ..." in the list row
      canVote: d.canVote,
      // §10.5 — the ADA a SPENDING proposal pays out (null for every other type), shown in the list.
      spendingAmountAda: d.spending?.amountAda ?? null,
    };
  }

  // ---- tally + finalize -----------------------------------------------------

  /** §4.4 for threshold proposals; per-option counts for polls. */
  private async tally(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const votes = await this.prisma.vote.findMany({ where: { proposalId, phase: VotePhase.INTERNAL, supersededBy: null } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const eligible = snapshot?.entries.length ?? 0;
    const thresholdPct = proposal?.approvalThresholdPct ? Number(proposal.approvalThresholdPct) : 67;

    if (proposal?.internalType === InternalType.POLL) {
      const cfg = (proposal.pollOptions ?? {}) as { options?: string[] };
      const counts = new Map<string, { power: number; voters: number }>();
      for (const o of cfg.options ?? []) counts.set(o, { power: 0, voters: 0 });
      const votersSet = new Set<string>();
      const abstain = { power: 0, voters: 0 };
      for (const v of votes) {
        votersSet.add(v.drepId);
        if (v.choice === VoteChoice.ABSTAIN) {
          abstain.power += powerByDrep.get(v.drepId) ?? 0;
          abstain.voters += 1;
          continue; // abstain is counted toward "voted" but not toward any option
        }
        const c = counts.get(v.choice) ?? { power: 0, voters: 0 };
        c.power += powerByDrep.get(v.drepId) ?? 0;
        c.voters += 1;
        counts.set(v.choice, c);
      }
      return {
        kind: 'POLL' as const,
        eligible,
        voted: votersSet.size,
        abstain: { power: round2(abstain.power), voters: abstain.voters },
        options: [...counts.entries()].map(([option, c]) => ({ option, power: round2(c.power), voters: c.voters })),
      };
    }

    // INSTRUCTIVE / INFORMATIVE — §4.4 threshold tally.
    const choiceByDrep = new Map(votes.map((v) => [v.drepId, v.choice]));
    let yesPower = 0;
    let abstainPower = 0;
    let totalPower = 0;
    let cast = 0;
    for (const e of snapshot?.entries ?? []) {
      const fp = Number(e.finalPower ?? 0);
      totalPower += fp;
      const c = choiceByDrep.get(e.drepId);
      if (c) cast++;
      if (c === VoteChoice.YES) yesPower += fp;
      else if (c === VoteChoice.ABSTAIN) abstainPower += fp;
    }
    const t = { yesPower, totalPower, abstainPower, thresholdPct };
    return {
      kind: 'THRESHOLD' as const,
      eligible,
      cast,
      yesPower: round2(yesPower),
      abstainPower: round2(abstainPower),
      totalPower: round2(totalPower),
      denominator: round2(totalPower - abstainPower),
      ratioPct: round2(approvalRatio(t) * 100),
      thresholdPct,
      approved: isApproved(t),
    };
  }

  /** Auto-conclude once the voting period ends (called on every read + vote). */
  private async maybeFinalize(p: { id: string; status: string; votingEndAt: Date | null; type: string }) {
    if (p.type !== ProposalType.INTERNAL) return;
    if (p.status !== ProposalStatus.ACTIVE) return;
    if (!p.votingEndAt || p.votingEndAt.getTime() > Date.now()) return;
    await this.finalize(p.id);
  }

  /**
   * §10.5 — an APPROVED spending proposal prepares ONE OPS multisig action (amount from the
   * chosen treasury bucket — Operations by default — to the destination). The board signs it
   * through the normal Actions queue. Idempotent via spendingActionId.
   */
  private async maybePrepareSpending(proposalId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p || p.internalType !== InternalType.SPENDING) return;
    if (p.status !== ProposalStatus.APPROVED) return;
    if (p.spendingActionId || !p.spendingAmountAda || !p.spendingDestAddress) return;
    const amountAda = p.spendingAmountAda;
    const destAddress = p.spendingDestAddress;
    const sourceBucketId = p.spendingSourceBucketId
      ?? (await this.prisma.treasuryBucket.findFirst({
        where: { isDefaultOperations: true, config: { replacedAt: null } },
        select: { id: true },
      }))?.id
      ?? null;
    // §10.5 — this runs on EVERY detail read, so two board members opening the approved proposal at
    // once would both pass the guard above and each create an action — the "two identical signing
    // events" bug. Lock the proposal row so the check-and-create is atomic, re-check under the lock,
    // and adopt any existing OPS action instead of making a second one.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM proposal WHERE id = ${proposalId}::uuid FOR UPDATE`;
      const fresh = await tx.proposal.findUnique({ where: { id: proposalId }, select: { spendingActionId: true } });
      if (fresh?.spendingActionId) return; // another concurrent call already prepared it
      const existing = await tx.multisigAction.findFirst({ where: { proposalId, kind: 'OPS' }, select: { id: true } });
      const actionId = existing?.id ?? (await tx.multisigAction.create({
        data: {
          kind: 'OPS',
          status: 'PENDING_SIGS',
          amountAda,
          destAddress,
          sourceBucketId,
          proposalId: p.id,
          proposalTitle: p.title,
          description: `Spending internal proposal · ${p.publicId ?? p.title} — approved by vote, ${(Number(amountAda) / 1e6).toLocaleString()} ₳ to ${destAddress.slice(0, 24)}…`,
        },
        select: { id: true },
      })).id;
      await tx.proposal.update({ where: { id: proposalId }, data: { spendingActionId: actionId } });
    });
  }

  /**
   * §14 — auto-install the new board when an approved election's installation date has passed
   * and we haven't installed yet. Triggered on every detail read so an admin needn't intervene.
   */
  private async maybeInstallElection(proposalId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p || !p.isBoardElection) return;
    if (p.status !== ProposalStatus.APPROVED) return;
    if (p.boardInstalledAt) return;
    if (!p.deliveryDate || p.deliveryDate.getTime() > Date.now()) return;
    await this.installBoardFromProposal(p.id);
  }

  /**
   * §14 manual install — a current board member triggers the new board's installation early
   * (i.e. before deliveryDate) once the election was approved. Idempotent (no-op if already installed).
   */
  async installNewBoard(userId: string, proposalId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p || !p.isBoardElection) throw new NotFoundException('board-election proposal not found');
    if (p.status !== ProposalStatus.APPROVED) {
      throw new ConflictException('the election must be APPROVED before the new board can be installed');
    }
    if (p.boardInstalledAt) {
      return { id: p.id, publicId: p.publicId, boardInstalledAt: p.boardInstalledAt };
    }
    if (!(await this.isBoardUser(userId))) {
      throw new ForbiddenException('only a current board member can install the new board');
    }
    return this.installBoardFromProposal(p.id);
  }

  /** Replace the board seats with the proposal's 5 candidates in one transaction, mark installed. */
  private async installBoardFromProposal(proposalId: string) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p) throw new NotFoundException('proposal not found');
    const candidates = (p.actors as unknown) as { drepKeyHash: string; drepIdOnchain: string; displayName: string }[];
    if (!Array.isArray(candidates) || candidates.length !== 5) {
      throw new BadRequestException('election has no valid candidate set');
    }
    await this.prisma.$transaction(async (tx) => {
      // §15 — soft-delete the OUTGOING board so their multisig keys remain
      // linked (needed to sign the migration tx out of the old wallet). The
      // partial unique index on drep_key_hash only covers active rows, so a
      // re-elected member's new seat won't conflict with their archived one.
      const now = new Date();
      await tx.boardSeat.updateMany({ where: { removedAt: null }, data: { removedAt: now } });
      for (const c of candidates) {
        await tx.boardSeat.create({
          data: { drepKeyHash: c.drepKeyHash, drepId: c.drepIdOnchain, displayName: c.displayName },
        });
      }
      await tx.proposal.update({ where: { id: proposalId }, data: { boardInstalledAt: new Date() } });
    });
    // §15.2 — the "submit your multisig key" reminder is driven by JobsService.remindMultisigKeys
    // (a periodic, deduped check of every board seat still awaiting a key), so it fires reliably
    // whether the board was installed manually or auto-installed, and re-covers members who linked
    // their account after the install — not a one-shot notification tied to this install call.
    const fresh = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    return { id: proposalId, publicId: fresh?.publicId ?? null, boardInstalledAt: fresh?.boardInstalledAt ?? null };
  }

  /** Conclude voting → APPROVED/REJECTED (threshold) or APPROVED (poll), and anchor on-chain. */
  async finalize(proposalId: string) {
    const proposal = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal || proposal.type !== ProposalType.INTERNAL) throw new NotFoundException('internal proposal not found');
    if (proposal.status !== ProposalStatus.ACTIVE) {
      return { id: proposalId, publicId: proposal.publicId, status: proposal.status, tally: await this.tally(proposalId) };
    }
    const t = await this.tally(proposalId);
    // A poll has no pass/fail — it concludes (APPROVED). Threshold proposals pass iff §4.4 met.
    const approved = t.kind === 'POLL' ? true : t.approved;
    const status = approved ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;
    await this.prisma.proposal.update({ where: { id: proposalId }, data: { status, resultFinalizedAt: new Date() } });
    // §27 — a rule-approval vote flips the document's status on the outcome.
    if (proposal.internalType === InternalType.RULE_APPROVAL && proposal.ruleDocumentId) {
      await this.applyRuleDecision(proposal.ruleDocumentId, !!proposal.ruleDeleteRequested, approved).catch(() => undefined);
    }
    if (proposal.internalType === InternalType.DECISION_APPROVAL && proposal.decisionId) {
      await this.applyDecisionDecision(proposal.decisionId, !!proposal.decisionDeleteRequested, approved).catch(() => undefined);
    }
    // §10.5 — an approved spending proposal queues the multisig action for the board.
    await this.maybePrepareSpending(proposalId).catch(() => undefined);
    await this.anchorResult(proposalId, status, t).catch(() => undefined); // anchoring never blocks the conclusion
    return { id: proposalId, publicId: proposal.publicId, status, tally: t };
  }

  // §27 — compact score of a rule-document's latest approval vote, for the Rule Documents page.
  // Auto-finalizes a past-due vote first (which flips the document's status via finalize()).
  async ruleVoteScore(proposalId: string) {
    const sel = { id: true, type: true, publicId: true, status: true, votingEndAt: true, ruleDeleteRequested: true, ruleDocContentHash: true } as const;
    let p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: sel });
    if (!p) return null;
    await this.maybeFinalize({ id: p.id, status: p.status, votingEndAt: p.votingEndAt, type: p.type });
    p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: sel });
    if (!p) return null;
    const t = await this.tally(proposalId);
    const anchor = await this.prisma.anchor.findFirst({
      where: { proposalId, kind: 'internal' }, orderBy: { createdAt: 'desc' }, select: { txHash: true },
    });
    return {
      proposalId: p.id,
      publicId: p.publicId,
      status: p.status,
      deleteVote: !!p.ruleDeleteRequested,
      votingEndAt: p.votingEndAt ? p.votingEndAt.toISOString() : null,
      eligible: t.kind === 'THRESHOLD' ? t.eligible : 0,
      voted: t.kind === 'THRESHOLD' ? t.cast : 0,
      ratioPct: t.kind === 'THRESHOLD' ? t.ratioPct : 0,
      thresholdPct: t.kind === 'THRESHOLD' ? t.thresholdPct : 0,
      approved: t.kind === 'THRESHOLD' ? t.approved : false,
      contentHash: p.ruleDocContentHash ?? null,
      anchorTxHash: anchor?.txHash ?? null,
    };
  }

  async decisionVoteScore(proposalId: string) {
    const sel = { id: true, type: true, publicId: true, status: true, votingEndAt: true, decisionDeleteRequested: true, decisionContentHash: true } as const;
    let p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: sel });
    if (!p) return null;
    await this.maybeFinalize({ id: p.id, status: p.status, votingEndAt: p.votingEndAt, type: p.type });
    p = await this.prisma.proposal.findUnique({ where: { id: proposalId }, select: sel });
    if (!p) return null;
    const t = await this.tally(proposalId);
    const anchor = await this.prisma.anchor.findFirst({ where: { proposalId, kind: 'internal' }, orderBy: { createdAt: 'desc' }, select: { txHash: true } });
    return {
      proposalId: p.id,
      publicId: p.publicId,
      status: p.status,
      deleteVote: !!p.decisionDeleteRequested,
      votingEndAt: p.votingEndAt ? p.votingEndAt.toISOString() : null,
      eligible: t.kind === 'THRESHOLD' ? t.eligible : 0,
      voted: t.kind === 'THRESHOLD' ? t.cast : 0,
      ratioPct: t.kind === 'THRESHOLD' ? t.ratioPct : 0,
      thresholdPct: t.kind === 'THRESHOLD' ? t.thresholdPct : 0,
      approved: t.kind === 'THRESHOLD' ? t.approved : false,
      contentHash: p.decisionContentHash ?? null,
      anchorTxHash: anchor?.txHash ?? null,
    };
  }

  // Active internal votes for the public landing dashboard (board-only PRIVATE ones excluded).
  // Each carries the voting-end date + a threshold tally for the mini result chart.
  async activeVoteSummaries() {
    const active = await this.prisma.proposal.findMany({
      where: { type: ProposalType.INTERNAL, status: ProposalStatus.ACTIVE, isPrivate: false },
      orderBy: { votingEndAt: 'asc' },
      select: { id: true, publicId: true, title: true, internalType: true, votingEndAt: true },
    });
    const out: {
      id: string; publicId: string | null; title: string; internalType: string | null;
      votingEndAt: string | null; kind: 'THRESHOLD' | 'POLL';
      yesPower?: number; noPower?: number; totalPower?: number; thresholdPct?: number;
      ratioPct?: number; eligible?: number; voted?: number; passing?: boolean;
    }[] = [];
    for (const p of active) {
      const t = await this.tally(p.id);
      const base = { id: p.id, publicId: p.publicId, title: p.title, internalType: p.internalType, votingEndAt: p.votingEndAt ? p.votingEndAt.toISOString() : null };
      if (t.kind !== 'THRESHOLD') { out.push({ ...base, kind: 'POLL' }); continue; }
      out.push({
        ...base, kind: 'THRESHOLD',
        yesPower: round2(t.yesPower), noPower: round2(t.totalPower - t.yesPower - t.abstainPower), totalPower: round2(t.totalPower),
        thresholdPct: t.thresholdPct, ratioPct: t.ratioPct, eligible: t.eligible, voted: t.cast, passing: t.approved,
      });
    }
    return out;
  }

  // §27 — apply a finalized rule-approval vote to the document. Approval votes act on a DRAFT
  // (approved → ACTIVE, obligatory; rejected → stays DRAFT); a delete vote removes it when approved
  // and leaves it untouched when rejected.
  private async applyRuleDecision(documentId: string, deleteRequested: boolean, approved: boolean) {
    const status = deleteRequested ? (approved ? 'DELETED' : null) : approved ? 'ACTIVE' : 'DRAFT';
    if (status) await this.prisma.ruleDocument.update({ where: { id: documentId }, data: { status } });
  }

  private async applyDecisionDecision(decisionId: string, deleteRequested: boolean, approved: boolean) {
    const status = deleteRequested ? (approved ? 'DELETED' : null) : approved ? 'ACTIVE' : 'DRAFT';
    if (status) await this.prisma.decision.update({ where: { id: decisionId }, data: { status } });
  }

  private async anchorResult(proposalId: string, status: string, t: Awaited<ReturnType<InternalProposalsService['tally']>>) {
    const p = await this.prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!p) return;
    const voteList = await this.voteList(proposalId);
    // §27 — for a rule-approval vote, anchor the FROZEN rule-document content hash (what was voted
    // on). Otherwise hash the proposal's own title + content (date-independent — the end can move).
    const docHash =
      p.internalType === InternalType.RULE_APPROVAL && p.ruleDocContentHash
        ? p.ruleDocContentHash
        : p.internalType === InternalType.DECISION_APPROVAL && p.decisionContentHash
          ? p.decisionContentHash
          : sha256hex(`${p.title}\n${p.contentMd}`);
    const weighted = p.votingType !== VotingType.ONE_PERSON_ONE_VOTE;
    const style =
      p.votingType === VotingType.BALANCED
        ? VotingStyle.BALANCED
        : p.votingType === VotingType.ONCHAIN
          ? VotingStyle.ONCHAIN
          : VotingStyle.ONE_PERSON_ONE_VOTE;
    const outcome =
      t.kind === 'POLL'
        ? `CONCLUDED — ${t.options.map((o) => `${o.option}: ${weighted ? o.power : o.voters}`).join(', ')}`
        : status;
    // §14 — for a board-member election, include the elected candidates on-chain so anyone
    // parsing the anchor JSON can see who took the seats (the platform also installs them).
    let electedBoard: { drep: string; name: string }[] | null = null;
    if (p.isBoardElection && status === ProposalStatus.APPROVED && Array.isArray(p.actors)) {
      const raw = p.actors as unknown as { drepIdOnchain?: string; displayName?: string }[];
      electedBoard = raw
        .filter((c) => c && typeof c.drepIdOnchain === 'string')
        .map((c) => ({ drep: c.drepIdOnchain as string, name: c.displayName ?? '(unknown)' }));
    }
    await this.anchor.anchorResult({
      kind: 'internal',
      subject: GovSubject.INTERNAL,
      style,
      ref: p.title,
      publicId: p.publicId,
      docHash,
      electedBoard,
      proposalId,
      roundId: null,
      votes: voteList.map((v) => ({ drep: v.drep, vote: v.choice, power: weighted ? v.weight : undefined })),
      preimageVotes: voteList,
      outcome,
      yes: t.kind === 'THRESHOLD' ? round2(t.yesPower) : 0,
      no: t.kind === 'THRESHOLD' ? round2(t.totalPower - t.yesPower - t.abstainPower) : 0,
      threshold: t.kind === 'THRESHOLD' ? t.thresholdPct : 0,
      totalPower: t.kind === 'THRESHOLD' ? round2(t.totalPower) : undefined,
    });
  }

  /** The CURRENT internal votes only (superseded ones excluded) — used for the on-chain anchor. */
  private async voteList(proposalId: string) {
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.INTERNAL, supersededBy: null },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'asc' },
    });
    return votes.map((v) => ({
      drep: v.drep.drepIdOnchain,
      displayName: v.drep.user?.displayName ?? null,
      choice: v.choice,
      weight: round2(powerByDrep.get(v.drepId) ?? 0),
      rationale: v.rationale ?? null,
    }));
  }

  /** The full internal-vote history (current + superseded), newest first — shown on the detail page.
   *  Each superseded entry is flagged so the UI can cross it out; only the latest per voter is live. */
  private async voteHistory(proposalId: string) {
    const snapshot = await this.prisma.voteSnapshot.findFirst({ where: { proposalId }, include: { entries: true } });
    const powerByDrep = new Map((snapshot?.entries ?? []).map((e) => [e.drepId, Number(e.finalPower ?? 0)]));
    const votes = await this.prisma.vote.findMany({
      where: { proposalId, phase: VotePhase.INTERNAL },
      include: { drep: { select: { drepIdOnchain: true, user: { select: { displayName: true } } } } },
      orderBy: { castAt: 'desc' },
    });
    return votes.map((v) => ({
      drep: v.drep.drepIdOnchain,
      displayName: v.drep.user?.displayName ?? null,
      choice: v.choice,
      weight: round2(powerByDrep.get(v.drepId) ?? 0),
      rationale: v.rationale ?? null,
      castAt: v.castAt.toISOString(),
      superseded: v.supersededBy != null,
    }));
  }

  private async isBoardUser(userId: string): Promise<boolean> {
    const u = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { drepKeyHash: true } });
    if (!u?.drepKeyHash) return false;
    return !!(await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: u.drepKeyHash } }));
  }
}
