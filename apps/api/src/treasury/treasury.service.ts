import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { boardActionMessage } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { TreasuryBucketsService } from './treasury-buckets.service';
import { PledgeReturnService } from './pledge-return.service';
import { verifyCip30Signature } from '../auth/cip30';

const ADA = 1_000_000;

export interface TreasuryTx {
  hash: string;
  time: number; // unix seconds
  // INTERNAL = both ends are DAO wallets (multisig/buckets/hot wallet) — money
  // moved, but none left the DAO. OUT is reserved for external destinations.
  direction: 'IN' | 'OUT' | 'INTERNAL';
  amountAda: number;
  label: string; // auto-detected: "submission fee", "hot-wallet top-up", "anonymous income"…
  proposalId?: string;
  proposalPublicId?: string; // R<round>-P<n>
  proposalTitle?: string;
  submitter?: string; // display name of the fee payer (incoming submission fees)
  destAddress?: string; // recipient (outgoing board actions)
  // §15 — board-provided context (overrides `label` for display when set).
  annotationTitle?: string;
  annotationNote?: string;
  annotatedBy?: string; // board member who set the context
  // §15 — board members who signed the multisig tx (outgoing/internal board
  // actions only; deposits have no platform signers).
  signers?: string[];
  // Which treasury address the funds left (board actions; for search).
  sourceAddress?: string;
}
const APPROVAL_THRESHOLD = 3; // 3-of-5 board multisig
const HOT_WALLET_MIN_ADA = 100; // below this, the platform prepares a top-up
const HOT_WALLET_TOPUP_ADA = 500;
// §15.3 — hard cap on a single board-prepared top-up. The hot wallet only
// pays Cardano fees for anchor txs, so a small running balance is enough;
// large amounts shouldn't sit there unsigned. Configurable later if needed.
const HOT_WALLET_TOPUP_MAX_ADA = 1000;

@Injectable()
export class TreasuryService implements OnModuleInit {
  onModuleInit() {
    if (process.env.ROUNDS_SCHEDULER_DISABLED === '1') return; // skip in tests / CLI
    // Pre-warm the on-chain transactions cache a few seconds after boot so the first
    // Treasury → Transactions load is instant (the cold db-sync history query is slow).
    setTimeout(() => { void this.treasuryTransactions().catch(() => undefined); }, 8000).unref?.();
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cardano: CardanoQueryService,
    private readonly anchor: AnchorService,
    private readonly buckets: TreasuryBucketsService,
    @Optional() private readonly pledgeReturn?: PledgeReturnService,
  ) {}

  /**
   * §15 — treasury overview: the 3-of-5 multisig balance + budget buckets
   * (rewards, operations, per-round) with allocated / spent / remaining, plus
   * the anchor hot wallet. Budgets are configurable; spend is read from data.
   */
  /**
   * §15.3 — the LIVE treasury address. Once the board has assembled the
   * multisig, that script address is the canonical home; the env
   * TREASURY_ADDRESS is only used as a fallback while no multisig exists
   * (fresh install, or after a reset). Inbound flows (submission fees,
   * pledges) and outbound flows (payouts, top-ups) all read through here so
   * the address auto-rotates when the board changes.
   */
  async resolveTreasuryAddress(): Promise<string | null> {
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
      select: { bech32Address: true },
    });
    return active?.bech32Address ?? this.config.get<string>('TREASURY_ADDRESS') ?? null;
  }

  async overview() {
    const treasury = await this.resolveTreasuryAddress();
    const hot = this.anchor.hotWalletAddress();
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
    const bks = active ? await this.prisma.treasuryBucket.findMany({ where: { configId: active.id }, select: { bech32Address: true } }) : [];
    const allAddrs = [...new Set([treasury, hot, ...bks.map((b) => b.bech32Address)].filter((a): a is string => !!a))];
    const bal = await this.cardano.addressBalance(allAddrs);
    const ada = (a: string | null) => (a ? Number(bal.get(a) ?? 0n) / ADA : 0);
    // Total ADA the DAO controls across every address — the pool the categories partition.
    const totalAda = allAddrs.reduce((s, a) => s + ada(a), 0);

    // §15 — categories are by PURPOSE, not by the address funds left from.
    // Rewards = every paid reward (DReps + experts: filtering / D&V / milestone / board), wherever sourced.
    const rewardsPaid = await this.prisma.rewardEntry.aggregate({ _sum: { amountAda: true }, where: { paidAt: { not: null } } });
    const rewardsSpent = Number(rewardsPaid._sum.amountAda ?? 0n) / ADA;
    // Operations = every other confirmed outgoing action (top-ups, transfers, returns) — not a
    // reward, not project funding, not an internal treasury migration. Again, regardless of source.
    const opsAgg = await this.prisma.multisigAction.aggregate({
      _sum: { amountAda: true },
      where: { status: 'CONFIRMED', amountAda: { not: null }, kind: { notIn: ['REWARD_PAYOUT', 'PROJECT_FUNDING', 'MIGRATION'] } },
    });
    const opsSpent = Number(opsAgg._sum.amountAda ?? 0n) / ADA;

    // Project funding per round = confirmed PROJECT_FUNDING (milestone payouts) for that round's proposals.
    const rounds = await this.prisma.round.findMany({ orderBy: { number: 'asc' } });
    const fundingActions = await this.prisma.multisigAction.findMany({
      where: { kind: 'PROJECT_FUNDING', status: 'CONFIRMED', amountAda: { not: null }, proposalId: { not: null } },
      select: { amountAda: true, proposalId: true },
    });
    const props = fundingActions.length
      ? await this.prisma.proposal.findMany({ where: { id: { in: [...new Set(fundingActions.map((a) => a.proposalId as string))] } }, select: { id: true, roundId: true } })
      : [];
    const roundByProp = new Map(props.map((p) => [p.id, p.roundId]));
    const spentByRound = new Map<string, number>();
    for (const a of fundingActions) {
      const rid = a.proposalId ? roundByProp.get(a.proposalId) : null;
      if (rid) spentByRound.set(rid, (spentByRound.get(rid) ?? 0) + Number(a.amountAda ?? 0n) / ADA);
    }
    // §12.2 — maximums come from the round setups: funding = Σ round budgets, rewards = Σ round
    // reward pools (DRep + bonus + expert). Operations gets the REST of the treasury, so newly
    // received ADA lands in operations until a round earmarks it. The three partition totalAda.
    const fundingMax = rounds.reduce((s, r) => s + Number(r.budgetAda) / ADA, 0);
    const rewardsMax = rounds.reduce((s, r) => s + Number(r.rewardsPoolAda) / ADA, 0);
    const opsMax = Math.max(0, totalAda - fundingMax - rewardsMax);
    const totalFundingSpent = rounds.reduce((s, r) => s + (spentByRound.get(r.id) ?? 0), 0);

    const bucket = (key: string, name: string, allocatedAda: number, spentAda: number, address: string | null) => ({
      key, name, allocatedAda, spentAda, remainingAda: Math.max(0, allocatedAda - spentAda), address,
    });

    const buckets = [
      bucket('rewards', 'Rewards', rewardsMax, rewardsSpent, null),
      bucket('operations', 'Operations', opsMax, opsSpent, null),
      bucket('total-funding', 'Total funding (all rounds)', fundingMax, totalFundingSpent, null),
      ...rounds.map((r) =>
        bucket(`round-${r.number}`, `Round #${r.number}${r.name ? ` — ${r.name}` : ''}`, Number(r.budgetAda) / ADA, spentByRound.get(r.id) ?? 0, r.multisigAddress || treasury),
      ),
    ];

    return {
      treasury: { address: treasury, balanceAda: ada(treasury), configured: !!treasury },
      hotWallet: { address: hot, balanceAda: ada(hot), minAda: HOT_WALLET_MIN_ADA },
      buckets,
      // Treasury total = all ADA the DAO controls (not a sum of the bars, which would double-count
      // the per-round breakdown of funding). Total spent = the three top categories' spend.
      totalAllocatedAda: totalAda,
      totalSpentAda: rewardsSpent + opsSpent + totalFundingSpent,
      spent: { funding: totalFundingSpent, rewards: rewardsSpent, operations: opsSpent },
    };
  }

  /** Pending board actions for a board member (drives the notification badge).
   *  Returns enriched fields per action: proposalTitle, milestoneIdx, full
   *  destAddress, the on-chain payout tx hash, and an `insufficient` flag
   *  computed against the live treasury balance so the board can SEE the
   *  funding gap before they approve. */
  async boardActionsFor(userId: string, includeHistory = false) {
    const board = await this.boardDrep(userId);
    if (!board) return { count: 0, actions: [], history: [], treasury: null, signingMode: '1_PHASE' as const };
    // The hot-wallet top-up check hits remote db-sync; run it fire-and-forget so it never
    // delays the actions list (a top-up it prepares simply shows up on the next poll).
    void this.maybePrepareTopUp().catch(() => { /* platform top-up is non-critical */ });

    const treasuryAddress = await this.resolveTreasuryAddress();
    let treasuryBalanceAda = 0;
    try {
      const balMap = treasuryAddress ? await this.cardano.addressBalance([treasuryAddress]) : new Map<string, bigint>();
      treasuryBalanceAda = treasuryAddress ? Number(balMap.get(treasuryAddress) ?? 0n) / ADA : 0;
    } catch { /* balance only feeds the insufficient-funds warning */ }

    // §15 — 3-of-5 threshold (APPROVAL_THRESHOLD); totalKeys comes from the
    // active multisig so the UI can render "3-of-5" rather than just "3".
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
      select: { totalKeys: true, threshold: true },
    });
    const threshold = active?.threshold ?? APPROVAL_THRESHOLD;
    const totalKeys = active?.totalKeys ?? APPROVAL_THRESHOLD;

    // §15/§20 — TX_SIGNING_PROCESS: 1-phase has no Authorize step, so every
    // pending action is immediately signable by any of the N keyholders.
    const modeRow = await this.prisma.platformConfig.findUnique({ where: { key: 'TX_SIGNING_PROCESS' } });
    const signingMode: '1_PHASE' | '2_PHASE' = modeRow?.value === '2_PHASE' ? '2_PHASE' : '1_PHASE';

    const actions = await this.prisma.multisigAction.findMany({
      where: { status: 'PENDING_SIGS' },
      include: {
        signatures: { select: { boardDrepId: true, drep: { select: { user: { select: { displayName: true } } } } } },
        commitments: { select: { userId: true, user: { select: { displayName: true } } } },
        // §12 — REWARD_PAYOUT is multi-output; surface the per-recipient list for the board to review.
        rewardEntries: { select: { amountAda: true, overrideAda: true, drep: { select: { user: { select: { displayName: true } } } }, expert: { select: { displayName: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    type Row = {
      id: string; kind: string; description: string | null; amountAda: bigint | null; status: string;
      txHash: string | null; createdAt: Date;
      signatures: { boardDrepId: string; drep: { user: { displayName: string | null } | null } | null }[];
      commitments: { userId: string; user: { displayName: string | null } | null }[];
      rewardEntries: { amountAda: bigint; overrideAda: bigint | null; drep: { user: { displayName: string | null } | null } | null; expert: { displayName: string } | null }[];
      committedKeyHashes: string[];
      proposalId: string | null; milestoneId: string | null; milestoneIdx: number | null;
      proposalTitle: string | null; destAddress: string | null; paidAt: Date | null;
    };
    const map = (a: Row) => {
      const amt = a.amountAda ? Number(a.amountAda) / ADA : null;
      // §15 phase tracking (2-phase): AUTHORIZE while committedKeyHashes is
      // empty; SIGN once the M keys are snapshotted. 1-phase is always SIGN.
      const inSignPhase = signingMode === '1_PHASE' || (a.committedKeyHashes?.length ?? 0) >= threshold;
      return {
        id: a.id,
        kind: a.kind,
        description: a.description,
        amountAda: amt,
        status: a.status,
        txHash: a.txHash,
        approvals: a.signatures.length,
        commitments: a.commitments.length,
        threshold,
        totalKeys,
        phase: inSignPhase ? 'SIGN' : 'AUTHORIZE',
        mineApproved: a.signatures.some((s) => s.boardDrepId === board.id),
        mineCommitted: a.commitments.some((c) => c.userId === userId),
        // §15 — who authorized (phase 1) and who has signed the tx (phase 2),
        // so the dialog can show names instead of just counts.
        committedBy: a.commitments.map((c) => c.user?.displayName ?? 'board member'),
        signedBy: a.signatures.map((s) => s.drep?.user?.displayName ?? 'board member'),
        createdAt: a.createdAt,
        proposalId: a.proposalId,
        milestoneId: a.milestoneId,
        milestoneIdx: a.milestoneIdx,
        proposalTitle: a.proposalTitle,
        destAddress: a.destAddress,
        paidAt: a.paidAt,
        // §12 — per-recipient list for a reward payout (empty for single-output actions).
        recipients: (a.rewardEntries ?? []).map((e) => ({
          name: e.drep?.user?.displayName ?? e.expert?.displayName ?? 'recipient',
          ada: Number(e.overrideAda ?? e.amountAda) / ADA,
        })),
        insufficient: amt != null && treasuryBalanceAda < amt,
      };
    };
    const view = (actions as unknown as Row[]).map(map);
    const history = includeHistory
      ? ((await this.prisma.multisigAction.findMany({
          where: { status: { not: 'PENDING_SIGS' } },
          include: {
            signatures: { select: { boardDrepId: true, drep: { select: { user: { select: { displayName: true } } } } } },
            commitments: { select: { userId: true, user: { select: { displayName: true } } } },
            rewardEntries: { select: { amountAda: true, overrideAda: true, drep: { select: { user: { select: { displayName: true } } } }, expert: { select: { displayName: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })) as unknown as Row[]).map(map)
      : [];
    return {
      // Count an action as a to-do when the user hasn't completed the
      // CURRENT phase yet: phase 1 → commit, phase 2 → sign.
      count: view.filter((a) => (a.phase === 'AUTHORIZE' ? !a.mineCommitted : !a.mineApproved)).length,
      actions: view,
      history,
      treasury: { address: treasuryAddress, balanceAda: treasuryBalanceAda },
      signingMode,
    };
  }

  /** §15.3 — platform prepares a treasury→hot-wallet top-up when the hot wallet runs low. */
  async maybePrepareTopUp() {
    const hot = this.anchor.hotWalletAddress();
    if (!hot) return;
    const open = await this.prisma.multisigAction.findFirst({ where: { kind: 'OPS', status: 'PENDING_SIGS', description: { contains: 'hot wallet' } } });
    if (open) return;
    // Strict read: Koios unavailable → null (NOT a 0-filled map), so a transient
    // lookup failure is never mistaken for an empty wallet → no spurious top-up.
    const bal = await this.cardano.addressBalanceStrict([hot]);
    if (!bal) return;
    if (Number(bal.get(hot) ?? 0n) / ADA >= HOT_WALLET_MIN_ADA) return;
    // §15.6 — route to the OPERATIONS default bucket (fallback primary).
    const bucket = await this.buckets.defaultBucketFor('OPERATIONS');
    await this.prisma.multisigAction.create({
      data: {
        kind: 'OPS',
        status: 'PENDING_SIGS',
        amountAda: BigInt(HOT_WALLET_TOPUP_ADA * ADA),
        // destAddress = hot wallet so the Actions UI shows the full destination + Copy button.
        destAddress: hot,
        description: `Top up the anchor hot wallet — balance below ${HOT_WALLET_MIN_ADA} ₳`,
        sourceBucketId: bucket?.id ?? null,
      },
    });
  }

  /** §15.3 — board member explicitly prepares a top-up (in addition to the
   *  auto-trigger). Capped at HOT_WALLET_TOPUP_MAX_ADA so we never sit a
   *  large balance on a single-sig hot wallet. */
  async prepareTopUp(userId: string, amountAda: number, sourceBucketId?: string) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const hot = this.anchor.hotWalletAddress();
    if (!hot) throw new BadRequestException('no hot wallet configured');
    if (!(amountAda > 0)) throw new BadRequestException('amount must be > 0');
    if (amountAda > HOT_WALLET_TOPUP_MAX_ADA) {
      throw new BadRequestException(`a single top-up is capped at ${HOT_WALLET_TOPUP_MAX_ADA} ₳ — split into multiple top-ups if you need more`);
    }
    // Multiple pending top-ups are allowed on purpose: the board may want to
    // queue more than one (different amounts / source buckets), and any unwanted
    // ones can be cancelled in "Actions to sign" (→ FAILED, no longer notified).
    // The UI already disables the button mid-request, which prevents accidental
    // double-clicks; we no longer hard-block a second queued top-up here.
    // §15.6 — source bucket: the board can pick which bucket the funds come from;
    // the default (no explicit choice) is the OPERATIONS-flagged bucket, falling
    // back to the primary. An explicit choice must belong to the active multisig.
    let sourceId: string | null;
    if (sourceBucketId) {
      const b = await this.prisma.treasuryBucket.findUnique({ where: { id: sourceBucketId } });
      const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
      if (!b || !active || b.configId !== active.id) {
        throw new BadRequestException('sourceBucketId does not belong to the active multisig');
      }
      sourceId = b.id;
    } else {
      sourceId = (await this.buckets.defaultBucketFor('OPERATIONS'))?.id ?? null;
    }
    const row = await this.prisma.multisigAction.create({
      data: {
        kind: 'OPS',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(amountAda * ADA)),
        destAddress: hot,
        description: `Top up the anchor hot wallet (board-requested)`,
        sourceBucketId: sourceId,
        // §13.2 — the requester earns +1 (TX_INITIATED) once the tx is on-chain.
        initiatorUserId: userId,
      },
    });
    // Strip BigInt so the JSON serializer doesn't choke; the UI only needs
    // a confirmation it landed.
    return { id: row.id, status: row.status, amountAda };
  }

  /** §15.4 — any board member can initiate an arbitrary transfer of ADA from
   *  the treasury (multisig) to an address of their choice. Requires the
   *  same 3-of-N board signing flow (via the Approve & sign queue) and a
   *  written context that gets recorded as the action description (audit
   *  trail). Refuses when the destination address is malformed, the amount
   *  is non-positive, or the live treasury balance can't cover it. */
  async prepareBoardTransfer(userId: string, dto: { destAddress: string; amountAda: number; context: string; sourceBucketId?: string }) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const dest = (dto.destAddress ?? '').trim();
    if (!/^addr(_test)?[a-z0-9]+$/i.test(dest)) {
      throw new BadRequestException('destAddress must be a Cardano bech32 address (addr… / addr_test…)');
    }
    if (!Number.isFinite(dto.amountAda) || dto.amountAda <= 0) {
      throw new BadRequestException('amountAda must be a positive number');
    }
    const context = (dto.context ?? '').trim();
    if (context.length < 10) {
      throw new BadRequestException('please provide at least 10 characters of context — every transfer is audited');
    }
    if (context.length > 2000) {
      throw new BadRequestException('context is capped at 2000 characters');
    }
    // No queue-time balance precheck on purpose: a board member may want to
    // queue + collect authorizations BEFORE funds arrive (e.g. waiting on an
    // incoming sweep). The 3rd-signature path (approve()) already refuses to
    // push to READY when the treasury can't cover the amount, so queueing
    // when underfunded is harmless — boardActionsFor() also flags it with
    // `insufficient: true` so signers see the gap before they approve.
    // §15.5 — validate sourceBucketId (must belong to the active multisig).
    // NULL = primary bucket; the broadcast service falls back to the active
    // multisig's bare script in that case.
    let sourceBucketId: string | null = null;
    if (dto.sourceBucketId) {
      const bucket = await this.prisma.treasuryBucket.findUnique({ where: { id: dto.sourceBucketId } });
      const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
      if (!bucket || !active || bucket.configId !== active.id) {
        throw new BadRequestException('sourceBucketId does not belong to the active multisig');
      }
      sourceBucketId = bucket.id;
    }
    const row = await this.prisma.multisigAction.create({
      data: {
        kind: 'BOARD_TRANSFER',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(dto.amountAda * ADA)),
        destAddress: dest,
        description: context,
        sourceBucketId,
      },
    });
    return { id: row.id, status: row.status, amountAda: dto.amountAda, destAddress: dest };
  }

  /** §15.5 — internal transfer between two treasury buckets (incl. the
   *  primary). Both ends are chosen from the active multisig's buckets — no
   *  free-form address — so funds can't leave the DAO through this path.
   *  Same 3-of-5 signing flow; shows as INTERNAL in the tx history. */
  async prepareInternalTransfer(userId: string, dto: { sourceBucketId: string; destBucketId: string; amountAda: number }) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    if (!Number.isFinite(dto.amountAda) || dto.amountAda <= 0) {
      throw new BadRequestException('amountAda must be a positive number');
    }
    if (!dto.sourceBucketId || !dto.destBucketId) throw new BadRequestException('pick a source and a destination bucket');
    if (dto.sourceBucketId === dto.destBucketId) {
      throw new BadRequestException('source and destination must be two different treasury addresses');
    }
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
    if (!active) throw new BadRequestException('no active multisig');
    const [src, dst] = await Promise.all([
      this.prisma.treasuryBucket.findUnique({ where: { id: dto.sourceBucketId } }),
      this.prisma.treasuryBucket.findUnique({ where: { id: dto.destBucketId } }),
    ]);
    if (!src || src.configId !== active.id) throw new BadRequestException('source bucket does not belong to the active multisig');
    if (!dst || dst.configId !== active.id) throw new BadRequestException('destination bucket does not belong to the active multisig');
    const row = await this.prisma.multisigAction.create({
      data: {
        kind: 'BOARD_TRANSFER',
        status: 'PENDING_SIGS',
        amountAda: BigInt(Math.round(dto.amountAda * ADA)),
        destAddress: dst.bech32Address,
        // The primary bucket's stored label is '' (the list API synthesizes it).
        description: `Internal transfer: ${src.label || 'Primary'} → ${dst.label || 'Primary'}`,
        // NULL = primary bucket (bare multisig script) for the broadcast service.
        sourceBucketId: src.isPrimary ? null : src.id,
        // §13.2 — the requester earns +1 (TX_INITIATED) once the tx is on-chain.
        initiatorUserId: userId,
      },
    });
    return { id: row.id, status: row.status, amountAda: dto.amountAda, destAddress: dst.bech32Address };
  }

  /** §15.4 — any board member can cancel a pending multisig action. Single
   *  click (no threshold). Marks the action FAILED so it disappears from
   *  the live queue + appears in history with the cancellation reason.
   *  Allowed only while the action is still PENDING_SIGS or READY — once a
   *  tx is broadcast (BROADCASTED) or confirmed on-chain (CONFIRMED) it
   *  cannot be cancelled. */
  async cancelBoardAction(userId: string, actionId: string, reason: string) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status !== 'PENDING_SIGS' && action.status !== 'READY') {
      throw new ConflictException(`cannot cancel an action in status ${action.status}`);
    }
    const r = (reason ?? '').trim();
    if (r.length < 5) {
      throw new BadRequestException('please provide a short cancellation reason (audit trail)');
    }
    if (r.length > 500) {
      throw new BadRequestException('cancellation reason is capped at 500 characters');
    }
    const me = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true } });
    const note = `[CANCELLED by ${me?.displayName ?? 'board'}: ${r}]`;
    await this.prisma.multisigAction.update({
      where: { id: actionId },
      data: {
        status: 'FAILED',
        // Preserve the original description; append the cancellation note so
        // the history row says WHY it was cancelled and by whom.
        description: action.description ? `${action.description}\n\n${note}` : note,
      },
    });
    // §12 — a cancelled reward payout frees its (unpaid) entries so the board can recompute + re-prepare.
    if (action.kind === 'REWARD_PAYOUT') {
      await this.prisma.rewardEntry.updateMany({ where: { payoutActionId: actionId, paidAt: null }, data: { payoutActionId: null } });
    }
    return { id: actionId, status: 'FAILED' };
  }

  /** §15.3 — board-callable sweep of ALL hot-wallet funds back into the
   *  multisig treasury. Single-click: the hot wallet is single-sig (its
   *  mnemonic is platform-held) so no multisig threshold is required to move
   *  funds INTO the treasury. We persist the sweep so the Treasury history
   *  panel can show what moved + link the explorer even after a refresh. */
  async sweepHotWallet(userId: string) {
    if (!(await this.boardDrep(userId))) throw new ForbiddenException('board members only');
    // Snapshot the balance BEFORE the sweep — this is what the tx is moving
    // (minus the fee). The post-sweep balance read would already be 0 / dust.
    const hotAddr = this.anchor.hotWalletAddress();
    let preBalance = 0n;
    if (hotAddr) {
      const m = await this.cardano.addressBalance([hotAddr]).catch(() => new Map<string, bigint>());
      preBalance = m.get(hotAddr) ?? 0n;
    }
    const r = await this.anchor.sweepToMultisig();
    // Best-effort persistence — never block the user on a history-record
    // failure (the on-chain tx already broadcast).
    try {
      await this.prisma.hotWalletSweep.create({
        data: {
          txHash: r.txHash,
          amountLovelace: preBalance,
          fromAddress: hotAddr ?? '',
          toAddress: r.to,
          initiatedByUserId: userId,
        },
      });
    } catch (e) {
      // Unique-conflict on txHash means we already persisted (e.g. retry) —
      // that's fine.
      void e;
    }
    return r;
  }

  /**
   * §15.3 — merged hot-wallet TX history. Combines:
   *   • TREASURY → HOT (top-ups): every OPS-kind MultisigAction whose
   *     destAddress matches the hot wallet, regardless of status — so the
   *     UI can show "pending signatures" / "awaiting broadcast" / "PAID"
   *     all in one place (not just the CONFIRMED end-state).
   *   • HOT → TREASURY (sweeps): rows from the HotWalletSweep table.
   * Sorted newest first; capped at 50.
   */
  async hotWalletHistory(limit = 50) {
    const hotAddr = this.anchor.hotWalletAddress();
    if (!hotAddr) return { items: [], hotWalletAddress: null };
    const [topups, sweeps] = await Promise.all([
      this.prisma.multisigAction.findMany({
        where: { kind: 'OPS', destAddress: hotAddr },
        include: { signatures: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.hotWalletSweep.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { initiatedBy: { select: { displayName: true } } },
      }),
    ]);
    type Item = {
      id: string;
      direction: 'TOP_UP' | 'SWEEP';
      amountAda: number;
      txHash: string | null;
      at: Date;
      description: string | null;
      initiatedBy: string | null;
      status: string;       // PENDING_SIGS / READY / BROADCASTED / CONFIRMED / FAILED / SWEPT
      approvals?: number;   // for top-ups: how many sigs collected
      threshold?: number;   // for top-ups: how many needed (always 3)
    };
    const items: Item[] = [];
    for (const t of topups) {
      items.push({
        id: t.id,
        direction: 'TOP_UP',
        amountAda: t.amountAda ? Number(t.amountAda) / ADA : 0,
        txHash: t.txHash,
        at: t.paidAt ?? t.createdAt,
        description: t.description,
        initiatedBy: null,
        status: t.status,
        approvals: t.signatures.length,
        threshold: APPROVAL_THRESHOLD,
      });
    }
    for (const s of sweeps) {
      items.push({
        id: s.id,
        direction: 'SWEEP',
        amountAda: Number(s.amountLovelace) / ADA,
        txHash: s.txHash,
        at: s.createdAt,
        description: null,
        initiatedBy: s.initiatedBy?.displayName ?? null,
        status: 'SWEPT',
      });
    }
    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return { items: items.slice(0, limit), hotWalletAddress: hotAddr };
  }

  /** Surface the per-platform constants the UI needs (top-up cap, low-balance
   *  threshold) so the form can validate locally + show the right help text. */
  hotWalletPolicy() {
    return {
      minAda: HOT_WALLET_MIN_ADA,
      topUpMaxAda: HOT_WALLET_TOPUP_MAX_ADA,
      autoTopUpAda: HOT_WALLET_TOPUP_ADA,
    };
  }

  /**
   * §15 — every on-chain tx that touched a treasury address (multisig sub-addresses
   * + hot wallet), newest first, enriched with what the platform knows:
   *   • incoming matching a proposal's submission-fee tx → "submission fee" + proposal + submitter
   *   • outgoing matching a board MultisigAction → the action's purpose + destination
   *   • incoming with no known context → "anonymous income"
   * Direction/amount from net (received − spent) at the treasury addresses.
   */
  async treasuryTransactions(opts?: { direction?: 'IN' | 'OUT' | 'INTERNAL'; q?: string; page?: number; pageSize?: number }) {
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
    const bks = active
      ? await this.prisma.treasuryBucket.findMany({ where: { configId: active.id }, select: { id: true, bech32Address: true } })
      : [];
    // §15 — the multisig + its labeled buckets + the anchor hot wallet, so funds arriving at the
    // hot wallet are visible too (e.g. an initial top-up before the multisig is even configured —
    // otherwise the list looks empty even though the balance went up). The hot wallet's own
    // on-chain-proof self-transfers are filtered out below as internal noise, and the SWR cache in
    // addressTransactions keeps a slow db-sync query from ever blocking the request.
    const hotAddr = this.anchor.hotWalletAddress();
    const addrSet = new Set<string>();
    if (active?.bech32Address) addrSet.add(active.bech32Address);
    for (const b of bks) if (b.bech32Address) addrSet.add(b.bech32Address);
    if (hotAddr) addrSet.add(hotAddr);
    const addresses = [...addrSet];
    if (addresses.length === 0) return { transactions: [] as TreasuryTx[], total: 0, page: 1, pageSize: opts?.pageSize ?? 50 };

    // 1000 most recent — filter/search/pagination below work over this window.
    const txs = await this.cardano.addressTransactions(addresses, 1000);

    // Submission-fee context: proposal + submitter, keyed by every fee tx hash.
    const proposals = await this.prisma.proposal.findMany({
      where: { OR: [{ submissionFeeTxHash: { not: null } }, { submissionFeeTxHashes: { isEmpty: false } }] },
      select: { id: true, publicId: true, title: true, submissionFeeTxHash: true, submissionFeeTxHashes: true, submitterUserId: true },
    });
    const submitterIds = [...new Set(proposals.map((p) => p.submitterUserId).filter(Boolean) as string[])];
    const users = submitterIds.length
      ? await this.prisma.appUser.findMany({ where: { id: { in: submitterIds } }, select: { id: true, displayName: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.displayName]));
    const feeByHash = new Map<string, { id: string; publicId: string | null; title: string; submitter: string | null }>();
    for (const p of proposals) {
      const submitter = p.submitterUserId ? nameById.get(p.submitterUserId) ?? null : null;
      for (const h of new Set([p.submissionFeeTxHash, ...(p.submissionFeeTxHashes ?? [])].filter(Boolean) as string[])) {
        feeByHash.set(h, { id: p.id, publicId: p.publicId, title: p.title, submitter });
      }
    }

    // Board-action context, keyed by the broadcast tx hash (+ their proposals' public ids).
    const actions = await this.prisma.multisigAction.findMany({
      where: { txHash: { not: null } },
      select: {
        txHash: true, kind: true, status: true, amountAda: true, description: true, proposalTitle: true, proposalId: true,
        destAddress: true, sourceBucketId: true, paidAt: true, createdAt: true,
        // §15 — who signed, so the history shows the 3-of-5 behind each tx.
        signatures: { select: { drep: { select: { user: { select: { displayName: true } } } } } },
      },
    });
    // Source address per action (bucket address; NULL bucket = the primary multisig).
    const bucketAddrById = new Map(bks.map((b) => [b.id, b.bech32Address]));
    const actionByHash = new Map(actions.filter((a) => a.txHash).map((a) => [a.txHash as string, a]));
    const actionPropIds = [...new Set(actions.map((a) => a.proposalId).filter(Boolean) as string[])];
    const publicIdById = new Map(
      (actionPropIds.length
        ? await this.prisma.proposal.findMany({ where: { id: { in: actionPropIds } }, select: { id: true, publicId: true } })
        : []
      ).map((p) => [p.id, p.publicId]),
    );
    const KIND_LABEL: Record<string, string> = {
      OPS: 'hot-wallet top-up', PROJECT_FUNDING: 'milestone payout', REWARD_PAYOUT: 'reward payout',
      PLEDGE_RETURN: 'pledge return', LEFTOVER_RETURN: 'leftover return', MIGRATION: 'FUND MIGRATION',
      BOARD_TRANSFER: 'treasury transfer',
    };
    // OPS covers BOTH hot-wallet top-ups (no proposal) and internal-spending-proposal payouts
    // (have a proposal) — label them apart so a spending payout doesn't read as a "top-up".
    const actionLabel = (a: { kind: string; proposalId?: string | null }) =>
      a.kind === 'OPS' ? (a.proposalId ? 'internal-proposal payout' : 'hot-wallet top-up') : KIND_LABEL[a.kind] ?? 'treasury spend';

    // §15 — every wallet the DAO controls (multisig + buckets + hot wallet, all already in
    // `addresses`). A tx whose destination is one of these moved money around, not out — INTERNAL.
    const internalAddrs = new Set(addresses);
    // Hot-wallet sweeps land at the multisig as plain incoming with no
    // MultisigAction — recognize them by their recorded tx hash.
    const sweeps = await this.prisma.hotWalletSweep.findMany({ select: { txHash: true } });
    const sweepHashes = new Set(sweeps.map((s) => s.txHash).filter(Boolean));

    const transactions: TreasuryTx[] = txs.map((t): TreasuryTx | null => {
      const net = t.inLovelace - t.outLovelace;
      const fee = feeByHash.get(t.hash);
      const action = actionByHash.get(t.hash);
      // Hide internal self-transfers (the anchor wallet's on-chain-proof txs, change-only moves):
      // the treasury spent and got it all back bar the network fee, so it's not a treasury event
      // and would otherwise show as a stray "anonymous income"/dust row. One real event = one row
      // (a payout is its single red tx; a deposit its single green tx). Board-recorded actions and
      // submission-fee deposits are always kept.
      const movedOut = t.outLovelace - t.inLovelace;
      if (!action && !fee && t.inLovelace > 0n && t.outLovelace > 0n && movedOut >= 0n && movedOut < 2_000_000n) {
        return null;
      }
      // A board action whose destination is one of OUR wallets (top-up to the
      // hot wallet, bucket-to-bucket transfer, migration to the new multisig)
      // moved money around, not out → INTERNAL. A board action to an external
      // address is a real payout — always OUT with the action's amount. Trust
      // that over the computed net, because db-sync's consumed-marking lags
      // and a just-sent payout can look like incoming change. Hot-wallet
      // sweeps come back as plain incoming → INTERNAL via their tx hash.
      // Internal = the destination is one of OUR wallets (hot-wallet top-up, bucket-to-bucket
      // move, migration). An OPS action that pays an EXTERNAL address (an internal SPENDING
      // proposal's payout) is a real OUTGOING spend — so classify by destination, not by kind.
      const internalMove = action
        ? (action.destAddress != null && internalAddrs.has(action.destAddress))
        : sweepHashes.has(t.hash);
      const boardPayout = action && !internalMove;
      const direction: 'IN' | 'OUT' | 'INTERNAL' = internalMove ? 'INTERNAL' : boardPayout ? 'OUT' : net >= 0n ? 'IN' : 'OUT';
      const amountAda = action?.amountAda != null && (boardPayout || internalMove)
        ? Number(action.amountAda) / ADA
        : Number(net >= 0n ? net : -net) / ADA;
      const tx: TreasuryTx = { hash: t.hash, time: t.time, direction, amountAda, label: 'outgoing transfer' };
      if (direction === 'INTERNAL' && !action) {
        tx.label = 'hot-wallet sweep';
      } else if (direction === 'IN') {
        if (fee) {
          tx.label = 'submission fee';
          tx.proposalId = fee.id;
          tx.proposalPublicId = fee.publicId ?? undefined;
          tx.proposalTitle = fee.title;
          tx.submitter = fee.submitter ?? undefined;
        } else tx.label = 'anonymous income';
      } else if (action) {
        tx.label = actionLabel(action);
        tx.proposalId = action.proposalId ?? undefined;
        tx.proposalPublicId = action.proposalId ? publicIdById.get(action.proposalId) ?? undefined : undefined;
        tx.proposalTitle = action.proposalTitle ?? action.description ?? undefined;
        tx.destAddress = action.destAddress ?? undefined;
      }
      if (action && action.signatures.length > 0) {
        tx.signers = action.signatures.map((s) => s.drep?.user?.displayName ?? 'board member');
      }
      if (action) {
        tx.sourceAddress = (action.sourceBucketId ? bucketAddrById.get(action.sourceBucketId) : undefined) ?? active?.bech32Address ?? undefined;
      }
      return tx;
    }).filter((t): t is TreasuryTx => t !== null);

    // §15 — guarantee every executed treasury spend shows even if the on-chain address scan
    // (db-sync/Koios) returned nothing for it (sync lag, rate-limit, or the address isn't indexed
    // yet — the symptom: an approved internal-spending payout went out but "No transactions yet").
    // Add any broadcast/confirmed multisig action by its recorded tx hash that isn't already listed.
    const present = new Set(transactions.map((t) => t.hash));
    for (const a of actions) {
      if (!a.txHash || present.has(a.txHash) || a.status === 'FAILED') continue;
      const internalMove = a.destAddress != null && internalAddrs.has(a.destAddress);
      transactions.push({
        hash: a.txHash,
        time: Math.floor((a.paidAt ?? a.createdAt).getTime() / 1000),
        direction: internalMove ? 'INTERNAL' : 'OUT',
        amountAda: a.amountAda != null ? Number(a.amountAda) / ADA : 0,
        label: actionLabel(a),
        proposalId: a.proposalId ?? undefined,
        proposalPublicId: a.proposalId ? publicIdById.get(a.proposalId) ?? undefined : undefined,
        proposalTitle: a.proposalTitle ?? a.description ?? undefined,
        destAddress: a.destAddress ?? undefined,
        sourceAddress: (a.sourceBucketId ? bucketAddrById.get(a.sourceBucketId) : undefined) ?? active?.bech32Address ?? undefined,
        signers: a.signatures.length ? a.signatures.map((s) => s.drep?.user?.displayName ?? 'board member') : undefined,
      });
    }
    transactions.sort((x, y) => y.time - x.time); // newest first (after merging the fallback rows)

    // Merge any board-provided context (overrides the auto label + adds an attributed note).
    const hashes = transactions.map((t) => t.hash);
    const annotations = hashes.length
      ? await this.prisma.treasuryTxAnnotation.findMany({ where: { txHash: { in: hashes } } })
      : [];
    const annByHash = new Map(annotations.map((a) => [a.txHash, a]));
    for (const t of transactions) {
      const a = annByHash.get(t.hash);
      if (a) {
        t.annotationTitle = a.title ?? undefined;
        t.annotationNote = a.description ?? undefined;
        t.annotatedBy = a.byName;
      }
    }

    // §15 — direction filter + free-text search + pagination (max 50/page).
    // Search matches addresses (source + destination), tx hash, proposal id
    // (R1-P2) / title, labels, annotations, submitter and signer names.
    let filtered = transactions;
    if (opts?.direction) filtered = filtered.filter((t) => t.direction === opts.direction);
    const q = opts?.q?.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((t) =>
        [
          t.hash, t.destAddress, t.sourceAddress, t.label,
          t.proposalPublicId, t.proposalTitle, t.submitter,
          t.annotationTitle, t.annotationNote,
          ...(t.signers ?? []),
        ].some((v) => v?.toLowerCase().includes(q)),
      );
    }
    const pageSize = Math.min(Math.max(opts?.pageSize ?? 50, 1), 50);
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(opts?.page ?? 1, 1), pages);
    return { transactions: filtered.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
  }

  /** §15 — a board member sets/updates/clears the context for a treasury tx.
   *  Clearing both fields removes the annotation. */
  async annotateTransaction(userId: string, txHash: string, dto: { title?: string; description?: string }) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { displayName: true } });
    const byName = user?.displayName ?? 'Board member';
    const title = dto.title?.trim() || null;
    const description = dto.description?.trim() || null;
    if (!title && !description) {
      await this.prisma.treasuryTxAnnotation.deleteMany({ where: { txHash } });
      return { ok: true };
    }
    await this.prisma.treasuryTxAnnotation.upsert({
      where: { txHash },
      update: { title, description, byUserId: userId, byName },
      create: { txHash, title, description, byUserId: userId, byName },
    });
    return { ok: true };
  }

  /** A board member approves an action with a CIP-30 signature (3-of-5 to proceed). */
  async approve(userId: string, actionId: string, dto: { signature?: string; signingKey?: string; ts?: string }) {
    const board = await this.boardDrep(userId);
    if (!board) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId }, include: { signatures: true } });
    if (!action || action.status !== 'PENDING_SIGS') throw new ConflictException('action is not pending signatures');

    // A treasury approval MUST carry a valid CIP-30 signature from the board member's own
    // wallet — never record an unsigned/cancelled approval (it moves funds at 3-of-5).
    if (!dto.signature || !dto.signingKey || !dto.ts) {
      throw new BadRequestException('a wallet signature is required to approve a treasury action');
    }
    const message = boardActionMessage({
      actionId,
      kind: action.kind,
      amountAda: action.amountAda ? Number(action.amountAda) / ADA : 0,
      voterStakeAddress: board.stakeAddress,
      ts: dto.ts,
    });
    if (!verifyCip30Signature(dto.signature, dto.signingKey, message, board.stakeAddress)) {
      throw new BadRequestException('approval signature verification failed');
    }
    const witnessCbor = dto.signature;

    await this.prisma.multisigSignature.upsert({
      where: { actionId_boardDrepId: { actionId, boardDrepId: board.id } },
      update: { witnessCbor },
      create: { actionId, boardDrepId: board.id, witnessCbor },
    });

    const count = await this.prisma.multisigSignature.count({ where: { actionId } });
    let status = action.status;
    if (count >= APPROVAL_THRESHOLD) {
      // 3-of-5 reached. Before flipping to READY, sanity-check that the
      // treasury can actually cover the amount — otherwise the disbursement
      // would fail at broadcast and the action would sit in limbo. Refuse
      // here so the board knows to wait for funds (or cancel) instead of
      // collecting a 4th/5th signature that can't be acted on.
      if (action.amountAda) {
        const treasuryAddr = await this.resolveTreasuryAddress();
        if (treasuryAddr) {
          const bal = await this.cardano.addressBalance([treasuryAddr]);
          const treasuryLovelace = bal.get(treasuryAddr) ?? 0n;
          if (treasuryLovelace < action.amountAda) {
            const need = Number(action.amountAda) / ADA;
            const have = Number(treasuryLovelace) / ADA;
            throw new ConflictException(
              `treasury has only ${have.toLocaleString()} ₳ on-chain — this action needs ${need.toLocaleString()} ₳. Top up the treasury (or wait for incoming funds) and try again; your signature is recorded.`,
            );
          }
        }
      }
      status = 'READY';
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status } });
    }
    return { approvals: count, threshold: APPROVAL_THRESHOLD, status };
  }

  /**
   * §11/§15 — once 3-of-5 signatures are collected (status=READY) the board
   * member who broadcasts the assembled multisig tx pastes the on-chain hash
   * here. The platform verifies it against the destination address + the
   * amount via Koios (mirrors the pledge + fee verification flow) and only
   * then flips the action to CONFIRMED + stamps paidAt. The corresponding
   * milestone is then displayed as PAID with the tx link.
   */
  async submitPayoutTxHash(userId: string, actionId: string, txHash: string) {
    const board = await this.boardDrep(userId);
    if (!board) throw new ForbiddenException('board members only');
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new ConflictException('action not found');
    if (action.status === 'CONFIRMED') return { status: 'CONFIRMED', txHash: action.txHash, paidAt: action.paidAt };
    if (action.status !== 'READY' && action.status !== 'BROADCASTED') {
      throw new ConflictException('this action is not ready for broadcast yet (still collecting signatures)');
    }
    const hash = txHash.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new BadRequestException('a Cardano tx hash is 64 hex characters');
    }
    if (!action.destAddress) {
      throw new ConflictException('this action has no destination address on file — cannot verify');
    }
    const v = await this.cardano.verifyPayment(hash, action.destAddress, action.amountAda ?? 0n);
    if (!v.koiosAvailable) {
      // Don't move state on a transient chain-reader failure; the board can retry.
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'BROADCASTED', txHash: hash } });
      return { status: 'BROADCASTED', txHash: hash, koiosAvailable: false, found: false, paid: false };
    }
    if (!v.found) {
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { status: 'BROADCASTED', txHash: hash } });
      return { status: 'BROADCASTED', txHash: hash, koiosAvailable: true, found: false, paid: false };
    }
    if (!v.paid) {
      throw new ConflictException(
        `the tx is on-chain but didn't pay ${(Number(action.amountAda ?? 0n) / ADA).toLocaleString()} ₳ to the destination address. Did you submit the right tx?`,
      );
    }
    await this.prisma.multisigAction.update({
      where: { id: actionId },
      data: { status: 'CONFIRMED', txHash: hash, paidAt: new Date() },
    });
    // §11.4/§16.3 — mirror the platform-broadcast confirmation side effects. This manual path
    // previously flipped the action CONFIRMED but left the milestone un-stamped and never
    // triggered the pledge return — the milestone showed unpaid forever and the pledge (or its
    // last share) was silently stranded with no later trigger.
    if (action.kind === 'PROJECT_FUNDING' && action.milestoneId) {
      await this.prisma.milestone
        .update({ where: { id: action.milestoneId }, data: { paidAt: new Date(), paidInTx: hash } })
        .catch(() => undefined);
      if (action.proposalId && this.pledgeReturn) {
        try {
          await this.pledgeReturn.maybePrepareReturn(action.proposalId, action.milestoneId);
        } catch {
          /* best-effort — the pledge return can also be prepared manually */
        }
      }
    }
    return { status: 'CONFIRMED', txHash: hash, paid: true, paidLovelace: v.paidLovelace.toString() };
  }

  /** The user's seated-board Drep (id + stake address), or null. */
  private async boardDrep(userId: string) {
    const d = await this.prisma.drep.findUnique({
      where: { userId },
      include: { user: { select: { drepKeyHash: true, stakeAddress: true } } },
    });
    if (!d?.user.drepKeyHash) return null;
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: d.user.drepKeyHash } });
    return seat ? { id: d.id, stakeAddress: d.user.stakeAddress } : null;
  }
}
