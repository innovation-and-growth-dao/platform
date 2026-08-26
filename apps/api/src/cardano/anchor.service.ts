import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../common/secret-cipher';
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bip39 from 'bip39';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import {
  GOVERNANCE_METADATA_LABEL,
  GovSubject,
  SUBJECT_TITLE,
  VotingStyle,
  buildResultMetadata,
  buildSubmissionMetadata,
  buildPayoutMetadata,
  buildDocHashMetadata,
  buildMultisigNewMetadata,
  buildMultisigMigrationMetadata,
  type AnchorResultMetadata,
  type AnchorSubmissionMetadata,
  type AnchorPayoutMetadata,
  type AnchorDocHashMetadata,
  type GovVoteEvent,
} from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from './cardano-query.service';

const harden = (n: number): number => n + 0x80000000;
const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface AnchorResult {
  hash: string;
  txHash: string | null;
  submitted: boolean;
}

interface Utxo {
  tx_hash: string;
  tx_index: number;
  value: string;
}

/**
 * §18 anchor hot wallet. Posts ONE Cardano tx per voting decision that commits
 * (by hash) to the full set of signed votes + the tally, so anyone can re-verify
 * — without a fee/tx per vote. If ANCHOR_MNEMONIC is unset it still records the
 * computed anchor (txHash null) so the app degrades gracefully.
 */
@Injectable()
export class AnchorService implements OnModuleInit {
  private readonly logger = new Logger(AnchorService.name);
  private readonly base: string;
  private readonly networkId: number;
  private mnemonic?: string; // mutable: an in-platform SEED rotation (admin) replaces it
  private readonly treasuryAddress?: string;
  private readonly submitApiUrl?: string; // optional cardano-submit-api; falls back to Koios /submittx
  private submitting = false; // serializes submitAllPending: the auto-sweep and a manual click must not race the same UTxOs

  /**
   * On boot, resolve the anchor hot-wallet seed in priority order:
   *   1. a DB-stored (rotated/bootstrapped) seed in platform_secret,
   *   2. the ANCHOR_MNEMONIC env (operator-provided),
   *   3. otherwise the platform GENERATES its own single-sig wallet and stores it.
   * §23 — the hot wallet is independent of the multisig: it exists from the start
   * so the UI can surface its address + "needs funding"; the multisig later tops
   * it up. (Prod should provide ANCHOR_MNEMONIC from a KMS instead of auto-gen.)
   */
  async onModuleInit() {
    const row = await this.prisma.platformSecret.findUnique({ where: { key: 'ANCHOR_MNEMONIC' } });
    if (row?.value) {
      this.mnemonic = decryptSecret(row.value) ?? undefined;
      this.logger.log('anchor hot-wallet seed loaded from platform_secret');
      return;
    }
    if (this.mnemonic) return; // operator-provided via ANCHOR_MNEMONIC env — keep it.
    const fresh = bip39.generateMnemonic(256); // 24-word
    const encFresh = encryptSecret(fresh);
    await this.prisma.platformSecret.upsert({
      where: { key: 'ANCHOR_MNEMONIC' },
      update: { value: encFresh },
      create: { key: 'ANCHOR_MNEMONIC', value: encFresh, updatedBy: null },
    });
    this.mnemonic = fresh;
    this.logger.warn(`anchor hot wallet auto-generated → ${this.hotWalletAddress()} (needs funding)`);
  }

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly cardano: CardanoQueryService,
  ) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.networkId = net === 'Mainnet' ? 1 : 0;
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
    this.mnemonic = config.get<string>('ANCHOR_MNEMONIC') || undefined;
    this.treasuryAddress = config.get<string>('TREASURY_ADDRESS') || undefined;
    this.submitApiUrl = config.get<string>('CARDANO_SUBMIT_API_URL') || undefined;
  }

  /** Bech32 address of the configured anchor hot wallet (or null if unset). */
  hotWalletAddress(): string | null {
    return this.mnemonic ? this.anchorKeys(this.mnemonic).addr.to_bech32() : null;
  }

  /** Whether an anchor hot wallet seed is available to submit metadata txs. */
  walletConfigured(): boolean {
    return !!this.mnemonic;
  }

  /**
   * Board view of the platform's on-chain wallets: the low-balance anchor HOT
   * wallet (pays tx fees) and the TREASURY (3-of-5 multisig) that tops it up.
   * The hot wallet's signing key is an operator secret (env/KMS), never exposed
   * here — the board sees the address + balance for oversight.
   */
  private readonly DEFAULT_SWEEP_HOURS = 24;
  async getSweepHours(): Promise<number> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'ANCHOR_SWEEP_HOURS' } });
    const h = row ? Number(row.value) : this.DEFAULT_SWEEP_HOURS;
    return Number.isFinite(h) && h >= 1 && h <= 168 ? h : this.DEFAULT_SWEEP_HOURS;
  }
  async setSweepHours(hours: number): Promise<number> {
    const h = Math.round(hours);
    if (!Number.isFinite(h) || h < 1 || h > 168) throw new BadRequestException('anchor interval must be between 1 and 168 hours');
    await this.prisma.platformConfig.upsert({ where: { key: 'ANCHOR_SWEEP_HOURS' }, update: { value: String(h) }, create: { key: 'ANCHOR_SWEEP_HOURS', value: String(h) } });
    return h;
  }
  async pendingAnchorCount(): Promise<number> {
    return this.prisma.anchor.count({ where: { txHash: null } });
  }

  async walletStatus() {
    const hot = this.hotWalletAddress();
    const envTreasury = this.treasuryAddress ?? null;
    // §15.3 — the actual on-chain treasury is the assembled multisig once
    // it exists. The env TREASURY_ADDRESS is a legacy fallback used only
    // while no multisig has been built (fresh install / after reset).
    const active = await this.prisma.multisigConfig.findFirst({
      where: { replacedAt: null },
      orderBy: { assembledAt: 'desc' },
      select: { bech32Address: true, threshold: true, totalKeys: true },
    });
    const activeMultisigAddress = active?.bech32Address ?? null;
    const addrs = [hot, envTreasury, activeMultisigAddress].filter((a): a is string => !!a);
    const bal = await this.cardano.addressBalance(addrs);
    const ada = (a: string | null) => (a ? Number(bal.get(a) ?? 0n) / 1_000_000 : 0);
    return {
      hotWallet: { address: hot, balanceAda: ada(hot), configured: !!this.mnemonic },
      treasury: { address: envTreasury, balanceAda: ada(envTreasury), configured: !!envTreasury },
      activeMultisig: active
        ? {
            address: active.bech32Address,
            balanceAda: ada(active.bech32Address),
            threshold: active.threshold,
            totalKeys: active.totalKeys,
          }
        : null,
      anchorSweepHours: await this.getSweepHours(),
      pendingAnchors: await this.pendingAnchorCount(),
    };
  }

  /**
   * §18/§23 (admin) — sweep ALL hot-wallet funds to the treasury (multisig). Must be
   * done before rotating the seed so nothing is stranded on the old key.
   */
  async sweepToMultisig(): Promise<{ txHash: string; to: string }> {
    if (!this.mnemonic) throw new BadRequestException('no anchor hot wallet is configured');
    if (!this.treasuryAddress) throw new BadRequestException('no treasury (multisig) address is configured');
    const { prv, addr } = this.anchorKeys(this.mnemonic);
    const utxos = await this.cardano.addressUtxos([addr.to_bech32()]);
    if (!utxos.length) throw new BadRequestException('the hot wallet is already empty');

    const pp = await this.cardano.epochParams();
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));
    const unspent = CSL.TransactionUnspentOutputs.new();
    for (const u of utxos) {
      unspent.add(
        CSL.TransactionUnspentOutput.new(
          CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
          CSL.TransactionOutput.new(addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value)))),
        ),
      );
    }
    txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
    txb.add_change_if_needed(CSL.Address.from_bech32(this.treasuryAddress)); // everything (minus fee) → treasury
    const fixed = CSL.FixedTransaction.from_hex(txb.build_tx().to_hex());
    fixed.sign_and_add_vkey_signature(prv);
    const txHash = fixed.transaction_hash().to_hex();
    await this.submitTxHex(fixed.to_hex());
    this.logger.warn(`hot wallet swept to treasury: ${txHash}`);
    return { txHash, to: this.treasuryAddress };
  }

  /**
   * §18/§23 (admin) — rotate the anchor hot-wallet SEED. Only allowed once the hot
   * wallet is (near) empty, so no funds are lost. The platform generates + stores a
   * fresh seed (never revealed); the new address is funded afresh from the treasury.
   * SECURITY: the seed now lives in platform_secret — gate behind admin auth + audit;
   * prod should hold it in a KMS rather than the DB.
   */
  async rotateSeed(adminId?: string | null): Promise<{ address: string | null }> {
    if (!this.treasuryAddress) throw new BadRequestException('configure the treasury (multisig) address first');
    const status = await this.walletStatus();
    if (status.hotWallet.balanceAda > 2) {
      throw new BadRequestException('move the hot-wallet funds to the multisig (sweep) before exchanging the seed');
    }
    const fresh = bip39.generateMnemonic(256); // 24-word
    const encFresh = encryptSecret(fresh);
    await this.prisma.platformSecret.upsert({
      where: { key: 'ANCHOR_MNEMONIC' },
      update: { value: encFresh, updatedBy: adminId ?? null },
      create: { key: 'ANCHOR_MNEMONIC', value: encFresh, updatedBy: adminId ?? null },
    });
    this.mnemonic = fresh;
    this.logger.warn('anchor hot-wallet SEED rotated (admin)');
    return { address: this.hotWalletAddress() };
  }

  private builderCfg(pp: Record<string, string | number>) {
    return CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(pp.min_fee_a)), CSL.BigNum.from_str(String(pp.min_fee_b))))
      .pool_deposit(CSL.BigNum.from_str(String(pp.pool_deposit)))
      .key_deposit(CSL.BigNum.from_str(String(pp.key_deposit)))
      .max_value_size(Number(pp.max_val_size))
      .max_tx_size(Number(pp.max_tx_size))
      .coins_per_utxo_byte(CSL.BigNum.from_str(String(pp.coins_per_utxo_size)))
      .build();
  }

  /**
   * Commit any voting decision on-chain (admission, filtering, D&V, milestone, …).
   * Posts ONE metadata tx with a self-describing result (title + each voter's
   * choice + tally) and a `proofHash` over the off-chain preimage, and records an
   * Anchor row. Degrades gracefully (txHash null) when ANCHOR_MNEMONIC is unset.
   */
  async anchorResult(params: {
    kind: string; // Anchor.kind: 'admission' | 'filtering' | 'dv' | 'milestone' | 'removal'
    subject: GovSubject;
    style: VotingStyle;
    ref: string; // readable subject reference, shown as "applicant" in the JSON
    proposalId?: string | null; // Anchor.proposalId (proposal row or applicant drep row)
    publicId?: string | null; // structured proposal id (e.g. "R3-P2", "Internal 4") embedded on-chain
    docHash?: string | null; // sha256 of title+content (internal proposals) — date-independent
    electedBoard?: { drep: string; name: string }[] | null; // §14 — set on a board-election anchor
    roundId?: string | null;
    votes: { drep: string; vote: string; power?: number }[];
    outcome: string;
    yes: number;
    no: number;
    threshold: number;
    totalPower?: number; // BAL: total eligible voting power (for the on-chain tally)
    preimageVotes?: unknown; // richer votes (rationale/signature) for the off-chain preimage
  }): Promise<AnchorResult> {
    const preimage = {
      subject: params.subject,
      style: params.style,
      ref: params.ref,
      ...(params.publicId ? { publicId: params.publicId } : {}),
      ...(params.docHash ? { docHash: params.docHash } : {}),
      ...(params.electedBoard?.length ? { electedBoard: params.electedBoard } : {}),
      votes: params.preimageVotes ?? params.votes,
      result: { outcome: params.outcome, yes: params.yes, no: params.no, threshold: params.threshold },
    };
    const hash = sha256hex(JSON.stringify(preimage));

    // §3 — self-describing on-chain JSON: title + the proposal id (if any) + every voter's choice + tally.
    const metadata = buildResultMetadata({
      subject: params.subject,
      style: params.style,
      applicant: params.ref,
      proposalId: params.publicId ?? null,
      docHash: params.docHash ?? null,
      electedBoard: params.electedBoard ?? null,
      votes: params.votes,
      yes: params.yes,
      no: params.no,
      threshold: params.threshold,
      totalPower: params.totalPower,
      outcome: params.outcome,
      proofHash: hash,
    })[GOVERNANCE_METADATA_LABEL];

    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata);
    } catch (e) {
      this.logger.warn(`anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }

    await this.prisma.anchor.create({
      data: {
        kind: params.kind,
        proposalId: params.proposalId ?? null,
        roundId: params.roundId ?? null,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §3/§12 — anchor a funding proposal's **acceptance** into a round (fee paid + confirmed,
   * or no fee required). Records the unique proposal id, the submitter (DRep id, or stake
   * address if not a DRep), and the fee facts (paid? amount? which tx paid it).
   */
  async anchorSubmission(params: {
    proposalRowId: string;
    publicId: string;
    title: string;
    roundId?: string | null;
    roundNumber?: number | null;
    submitter: string;
    submitterType: 'DRep' | 'Wallet';
    feeAda: number;
    feeTxHash?: string | null;
    requestedAda?: number | null;
    outcome?: 'accepted' | 'rejected';
    reason?: string | null;
  }): Promise<AnchorResult> {
    const outcome = params.outcome ?? 'accepted';
    const preimage = {
      proposalId: params.publicId,
      title: params.title,
      round: params.roundNumber ?? null,
      submitter: params.submitter,
      submitterType: params.submitterType,
      outcome,
      reason: outcome === 'rejected' ? params.reason ?? null : null,
      requested: params.requestedAda ?? null,
      fee: { ada: params.feeAda, txHash: params.feeTxHash ?? null },
      decidedAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = buildSubmissionMetadata({
      title: params.title,
      proposalId: params.publicId,
      round: params.roundNumber ?? null,
      submitter: params.submitter,
      submitterType: params.submitterType,
      feeAda: params.feeAda,
      feeTxHash: params.feeTxHash ?? null,
      requestedAda: params.requestedAda ?? null,
      outcome,
      reason: preimage.reason,
      decidedAt: preimage.decidedAt,
    })[GOVERNANCE_METADATA_LABEL];

    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata);
    } catch (e) {
      this.logger.warn(`submission anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }
    await this.prisma.anchor.create({
      data: {
        kind: GovSubject.SUBMISSION,
        proposalId: params.proposalRowId,
        roundId: params.roundId ?? null,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §8.1 — anchor a proposal's **content fingerprint** when the Debate stage ends and the
   * proposal is frozen. We hash a canonical textual form of the proposal (SHA-256) and post
   * that hash + the algorithm on-chain; the full text is kept in the anchor preimage so the
   * UI can show it and anyone can re-hash it to verify. Idempotent per proposal — a second
   * call (e.g. if voting is re-opened) returns the existing anchor instead of duplicating it.
   */
  async anchorProposalDoc(params: {
    proposalRowId: string;
    publicId: string;
    title: string;
    roundId?: string | null;
    roundNumber?: number | null;
    text: string; // the canonical textual form of the frozen proposal
  }): Promise<AnchorResult> {
    const existing = await this.prisma.anchor.findFirst({
      where: { kind: GovSubject.PROPOSAL_DOC, proposalId: params.proposalRowId },
    });
    if (existing) return { hash: existing.hash, txHash: existing.txHash, submitted: !!existing.txHash };

    const hashAlgo = 'SHA-256';
    const contentHash = sha256hex(params.text); // the on-chain hash IS the hash of the text
    const frozenAt = new Date().toISOString();
    const preimage = {
      subject: GovSubject.PROPOSAL_DOC,
      proposalId: params.publicId,
      title: params.title,
      round: params.roundNumber ?? null,
      hashAlgo,
      text: params.text,
      contentHash,
      frozenAt,
    };
    const metadata = buildDocHashMetadata({
      title: params.title,
      proposalId: params.publicId,
      round: params.roundNumber ?? null,
      hashAlgo,
      contentHash,
      frozenAt,
    })[GOVERNANCE_METADATA_LABEL];

    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata);
    } catch (e) {
      this.logger.warn(`proposal-doc anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }
    await this.prisma.anchor.create({
      data: {
        kind: GovSubject.PROPOSAL_DOC,
        proposalId: params.proposalRowId,
        roundId: params.roundId ?? null,
        hash: contentHash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash: contentHash, txHash, submitted: !!txHash };
  }

  /**
   * §12 — anchor a **reward payout** on-chain: the stage it rewards, the payout tx hash, every
   * recipient (DRep id, or name for an expert) with the lovelace paid, and the board members who
   * signed the multisig. Records an Anchor row (kind 'reward_payout'). Degrades gracefully
   * (txHash null) when no anchor hot wallet is configured. Used for every payout stage —
   * filtering, debate & vote, milestone review, expert, board — via the multisig confirm hook.
   */
  async anchorPayout(params: {
    stage: string; // human-readable stage label
    round?: string | null; // round name / period the rewards are for
    roundId?: string | null;
    payoutTxHash: string; // the on-chain tx that moved the funds
    recipients: { to: string; lovelace: number }[]; // DRep id (or expert name) + amount
    signers: string[]; // board DRep ids that signed
  }): Promise<AnchorResult> {
    const recipients = params.recipients.map((r) => ({ to: r.to, lovelace: Math.round(r.lovelace) }));
    const preimage = {
      subject: GovSubject.REWARD_PAYOUT,
      stage: params.stage,
      ...(params.round ? { round: params.round } : {}),
      payoutTx: params.payoutTxHash,
      totalLovelace: recipients.reduce((s, r) => s + r.lovelace, 0),
      recipients,
      signers: params.signers,
      paidAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = buildPayoutMetadata({
      stage: params.stage,
      round: params.round ?? null,
      payoutTx: params.payoutTxHash,
      recipients,
      signers: params.signers,
      proofHash: hash,
    })[GOVERNANCE_METADATA_LABEL];

    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata);
    } catch (e) {
      this.logger.warn(`payout anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }
    await this.prisma.anchor.create({
      data: {
        kind: GovSubject.REWARD_PAYOUT,
        roundId: params.roundId ?? null,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §15.2 — anchor a NEW treasury multisig when it assembles: the new script address + every
   * board member's DRep ID and the payment address they provided. Best-effort (never blocks
   * assembly); degrades to txHash null when no anchor hot wallet is configured.
   */
  async anchorMultisigNew(params: {
    bech32Address: string;
    threshold: number;
    totalKeys: number;
    signers: { drep: string; address: string }[];
  }): Promise<AnchorResult> {
    const preimage = {
      subject: GovSubject.MULTISIG_NEW,
      address: params.bech32Address,
      threshold: params.threshold,
      totalKeys: params.totalKeys,
      signers: params.signers,
      preparedAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = buildMultisigNewMetadata({
      address: params.bech32Address,
      threshold: params.threshold,
      totalKeys: params.totalKeys,
      signers: params.signers,
      proofHash: hash,
    })[GOVERNANCE_METADATA_LABEL];
    let txHash: string | null = null;
    try { txHash = await this.submitMetadataTx(metadata as unknown as Record<string, unknown>); }
    catch (e) { this.logger.warn(`multisig-new anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`); }
    await this.prisma.anchor.create({
      data: { kind: GovSubject.MULTISIG_NEW, hash, preimage: preimage as unknown as object, metadataLabel: GOVERNANCE_METADATA_LABEL, txHash, submittedAt: txHash ? new Date() : null },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §15.2 — anchor the fund migration once the OLD multisig has been emptied into the NEW one:
   * every move (old source address → amount → tx hash) + the new primary address. Best-effort.
   */
  async anchorMultisigMigration(params: {
    newAddress: string;
    moves: { from: string; lovelace: number; tx: string }[];
  }): Promise<AnchorResult> {
    const moves = params.moves.map((m) => ({ from: m.from, lovelace: Math.round(m.lovelace), tx: m.tx }));
    const preimage = {
      subject: GovSubject.MULTISIG_MIGRATION,
      newAddress: params.newAddress,
      moves,
      totalLovelace: moves.reduce((s, m) => s + m.lovelace, 0),
      movedAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = buildMultisigMigrationMetadata({ newAddress: params.newAddress, moves, proofHash: hash })[GOVERNANCE_METADATA_LABEL];
    let txHash: string | null = null;
    try { txHash = await this.submitMetadataTx(metadata as unknown as Record<string, unknown>); }
    catch (e) { this.logger.warn(`multisig-migration anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`); }
    await this.prisma.anchor.create({
      data: { kind: GovSubject.MULTISIG_MIGRATION, hash, preimage: preimage as unknown as object, metadataLabel: GOVERNANCE_METADATA_LABEL, txHash, submittedAt: txHash ? new Date() : null },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §2.1/§14 — membership anchor: a short proof that a member was admitted (new DAO member /
   * new submitter), naming them and their wallet identity (DRep ID for DAO members; stake
   * address — or DRep ID when they have one — for submitters).
   */
  async anchorMembership(params: {
    kind: GovSubject;
    event: string; // e.g. "new submitter admitted"
    name: string;
    walletKind: 'drep_id' | 'stake_address';
    walletId: string;
  }): Promise<AnchorResult> {
    const preimage = {
      subject: params.kind,
      ref: `${params.event} — ${params.name}`,
      event: params.event,
      name: params.name,
      wallet: { kind: params.walletKind, id: params.walletId },
      decidedAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = {
      v: 1,
      title: SUBJECT_TITLE[params.kind],
      subject: params.kind,
      event: params.event,
      name: params.name,
      wallet_kind: params.walletKind,
      wallet_id: params.walletId,
      decided_at: preimage.decidedAt,
      proof_hash: hash,
    };
    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata as Record<string, unknown>);
    } catch (e) {
      this.logger.warn(`membership anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }
    await this.prisma.anchor.create({
      data: {
        kind: params.kind,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §24.1 — daily digest anchor: hash of yesterday's vote rows / merit deltas. The preimage
   * keeps the full row digest so anyone can recompute the hash from the API data.
   */
  async anchorDigest(params: {
    kind: typeof GovSubject.DAILY_VOTES | typeof GovSubject.DAILY_MERIT;
    day: string; // YYYY-MM-DD (UTC)
    rows: unknown[]; // serialized rows for that day (already stable-ordered)
  }): Promise<AnchorResult> {
    const preimage = {
      subject: params.kind,
      day: params.day,
      count: params.rows.length,
      rowsHash: sha256hex(JSON.stringify(params.rows)),
      anchoredAt: new Date().toISOString(),
    };
    const hash = sha256hex(JSON.stringify(preimage));
    const metadata = {
      v: 1,
      title: SUBJECT_TITLE[params.kind],
      subject: params.kind,
      day: params.day,
      count: params.rows.length,
      rows_hash: preimage.rowsHash,
      proof_hash: hash,
    };
    let txHash: string | null = null;
    try {
      txHash = await this.submitMetadataTx(metadata as Record<string, unknown>);
    } catch (e) {
      this.logger.warn(`daily digest anchor submit skipped/failed: ${e instanceof Error ? e.message : e}`);
    }
    await this.prisma.anchor.create({
      data: {
        kind: params.kind,
        hash,
        preimage: preimage as unknown as object,
        metadataLabel: GOVERNANCE_METADATA_LABEL,
        txHash,
        submittedAt: txHash ? new Date() : null,
      },
    });
    return { hash, txHash, submitted: !!txHash };
  }

  /**
   * §18 (board) — force-submit an anchor that was recorded but never reached the chain
   * (e.g. the hot wallet was unconfigured/offline when the decision was made). Rebuilds
   * the self-describing metadata from the stored preimage (same `proofHash`) and submits
   * one tx. Idempotent: a no-op if it is already on-chain.
   */
  async submitPending(anchorId: string): Promise<AnchorResult> {
    const a = await this.prisma.anchor.findUnique({ where: { id: anchorId } });
    if (!a) throw new NotFoundException('anchor not found');
    if (a.txHash) return { hash: a.hash, txHash: a.txHash, submitted: true };
    if (!this.mnemonic) {
      throw new BadRequestException('no anchor hot wallet is configured — set or rotate the seed first');
    }
    let txHash: string;
    try {
      txHash = await this.submitMetadataTx(this.metadataFromAnchor(a));
    } catch (e) {
      // Operational failures — an empty/under-funded hot wallet, a node rejection, or a malformed
      // historical preimage — must surface as a readable message, not a bare 500.
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`submit anchor ${anchorId} failed: ${msg}`);
      throw new BadRequestException(msg);
    }
    await this.prisma.anchor.update({ where: { id: anchorId }, data: { txHash, submittedAt: new Date() } });
    return { hash: a.hash, txHash, submitted: true };
  }

  /**
   * §18 (board) — submit every anchor that is recorded but not yet on-chain. Each
   * anchor is its own metadata tx, all paid from the same hot wallet. Koios's
   * `/address_utxos` lags the mempool, so we fetch UTxOs ONCE and chain each tx's
   * change output into the next input (otherwise every tx after the first reuses the
   * already-spent UTxO and is rejected — the "1 passed, 8 failed" symptom).
   */
  async submitAllPending(): Promise<{ submitted: number; failed: number; total: number; reason?: string }> {
    const pending = await this.prisma.anchor.findMany({ where: { txHash: null }, orderBy: { createdAt: 'asc' } });
    if (pending.length === 0) return { submitted: 0, failed: 0, total: 0 };
    if (!this.mnemonic) {
      throw new BadRequestException('no anchor hot wallet is configured — set or rotate the seed first');
    }
    // Serialize submission: the 5-minute auto-sweep and a manual "Submit all" must not run at the
    // same time, or they pick the same UTxOs and the node rejects all but one as double-spends.
    if (this.submitting) {
      return { submitted: 0, failed: 0, total: pending.length, reason: 'a submission is already in progress — retry in a moment' };
    }
    this.submitting = true;
    try {
      const { prv, addr } = this.anchorKeys(this.mnemonic);
      const pp = await this.cardano.epochParams();
      // Candidate UTxOs from db-sync. db-sync can lag the node — a UTxO it still
      // reports as unspent may already be spent on-chain — so any input the node
      // rejects is added to `bad` and the same anchor is retried with the rest.
      const pool = await this.cardano.addressUtxos([addr.to_bech32()]);
      // A representative reason for the failures, surfaced to the board so a stuck queue is actionable
      // (the commonest cause is an empty/under-funded hot wallet — nothing to pay tx fees with).
      let reason: string | undefined =
        pool.length === 0 ? 'the anchor hot wallet has no UTxOs — top it up with ADA to cover tx fees, then retry' : undefined;
      const bad = new Set<string>(); // consumed (after success) or node-rejected input refs
      const ref = (u: Utxo) => `${u.tx_hash}#${u.tx_index}`;

      let submitted = 0;
      let failed = 0;
      for (let i = 0; i < pending.length; i++) {
        const a = pending[i];
        // Rebuilding metadata from a malformed/legacy preimage can throw — count it as a failure
        // (with a reason) instead of aborting the whole batch with a 500.
        let event: ReturnType<AnchorService['metadataFromAnchor']>;
        try {
          event = this.metadataFromAnchor(a);
        } catch (e) {
          reason ??= e instanceof Error ? e.message : String(e);
          this.logger.warn(`force-submit ${a.id}: cannot rebuild metadata — ${e instanceof Error ? e.message : e}`);
          failed++;
          continue;
        }
        let ok = false;
        // Try the largest spendable UTxO; if the node rejects it, drop it and retry.
        while (!ok) {
          const candidates = pool.filter((u) => !bad.has(ref(u)));
          if (candidates.length === 0) break; // no spendable UTxO left for this anchor
          let built: { fixedHex: string; txHash: string; change: Utxo | null; inputs: string[] };
          try {
            built = this.buildMetadataTx(event, candidates, pp, prv, addr);
          } catch (e) {
            reason ??= e instanceof Error ? e.message : String(e);
            this.logger.warn(`force-submit ${a.id} failed to build: ${e instanceof Error ? e.message : e}`);
            break; // malformed anchor — skip it, keep the pool for the others
          }
          built.inputs.forEach((r) => bad.add(r)); // either spent (success) or rejected (failure)
          try {
            await this.submitTxHex(built.fixedHex);
            await this.prisma.anchor.update({ where: { id: a.id }, data: { txHash: built.txHash, submittedAt: new Date() } });
            this.logger.log(`anchored on-chain: ${built.txHash}`);
            submitted++;
            if (built.change) pool.push(built.change); // chain: the change funds later anchors
            ok = true;
            // A local cardano-submit-api has the change in its mempool instantly, so no
            // wait is needed; only Koios's load-balanced relays need time to propagate.
            if (i < pending.length - 1 && !this.submitApiUrl) await this.sleep(4000);
          } catch (e) {
            // The chosen input isn't really spendable (stale db-sync / already in-flight).
            // It's now in `bad`; the loop retries this same anchor with the remaining UTxOs.
            reason ??= e instanceof Error ? e.message : String(e);
            this.logger.warn(`force-submit ${a.id}: input rejected (${built.inputs.join(',')}), retrying with remaining UTxOs — ${e instanceof Error ? e.message : e}`);
          }
        }
        if (!ok) failed++;
      }
      return { submitted, failed, total: pending.length, ...(failed && reason ? { reason } : {}) };
    } finally {
      this.submitting = false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Rebuild the on-chain metadata for an anchor from its stored preimage. */
  private metadataFromAnchor(a: { kind: string; hash: string; preimage: unknown }): AnchorResultMetadata | AnchorSubmissionMetadata | AnchorPayoutMetadata | AnchorDocHashMetadata {
    const p = (a.preimage ?? {}) as {
      subject?: GovSubject;
      style?: VotingStyle;
      ref?: string;
      publicId?: string;
      docHash?: string;
      electedBoard?: { drep: string; name: string }[];
      votes?: { drep?: string; voter?: string; vote?: string; choice?: string; power?: number; weight?: number }[];
      result?: { outcome?: string; yes?: number; no?: number; threshold?: number; totalPower?: number };
      // submission-anchor preimage fields
      proposalId?: string;
      title?: string;
      round?: number | string | null; // submission: round number; payout: round name
      submitter?: string;
      submitterType?: 'DRep' | 'Wallet';
      outcome?: 'accepted' | 'rejected';
      reason?: string | null;
      requested?: number | null; // requested funding (ADA) — added to newer submission anchors
      decidedAt?: string;
      acceptedAt?: string; // older anchors used this name
      fee?: { required?: boolean; paid?: boolean; ada?: number; txHash?: string | null };
      // payout-anchor preimage fields (§12)
      stage?: string;
      payoutTx?: string;
      recipients?: { to: string; lovelace: number }[];
      signers?: string[];
      // proposal-doc preimage fields (§8.1)
      hashAlgo?: string;
      contentHash?: string;
      frozenAt?: string;
    };
    if ((p.subject ?? a.kind) === GovSubject.PROPOSAL_DOC) {
      return buildDocHashMetadata({
        title: p.title ?? p.proposalId ?? '',
        proposalId: p.proposalId ?? '',
        round: typeof p.round === 'number' ? p.round : null,
        hashAlgo: p.hashAlgo ?? 'SHA-256',
        contentHash: p.contentHash ?? a.hash,
        frozenAt: p.frozenAt ?? p.decidedAt ?? new Date().toISOString(),
      })[GOVERNANCE_METADATA_LABEL];
    }
    if ((p.subject ?? a.kind) === GovSubject.REWARD_PAYOUT) {
      return buildPayoutMetadata({
        stage: p.stage ?? '',
        round: typeof p.round === 'string' ? p.round : null,
        payoutTx: p.payoutTx ?? '',
        recipients: p.recipients ?? [],
        signers: p.signers ?? [],
        proofHash: a.hash,
      })[GOVERNANCE_METADATA_LABEL];
    }
    if ((p.subject ?? a.kind) === GovSubject.SUBMISSION) {
      return buildSubmissionMetadata({
        title: p.title ?? p.proposalId ?? '',
        proposalId: p.proposalId ?? '',
        round: typeof p.round === 'number' ? p.round : null,
        submitter: p.submitter ?? '',
        submitterType: p.submitterType ?? 'Wallet',
        feeAda: p.fee?.ada ?? 0,
        feeTxHash: p.fee?.txHash ?? null,
        requestedAda: p.requested ?? null,
        outcome: p.outcome ?? 'accepted',
        reason: p.reason ?? null,
        decidedAt: p.decidedAt ?? p.acceptedAt,
      })[GOVERNANCE_METADATA_LABEL];
    }
    const votes = (p.votes ?? []).map((v) => ({
      // The preimage stores the voter's DRep id under `voter` (GovVoteEvent shape);
      // accept `drep` too for older/other anchor kinds.
      drep: v.voter ?? v.drep ?? '',
      vote: v.vote ?? v.choice ?? '',
      power: v.power ?? v.weight,
    }));
    const r = p.result ?? {};
    return buildResultMetadata({
      subject: (p.subject ?? a.kind) as GovSubject,
      style: (p.style ?? VotingStyle.ONE_PERSON_ONE_VOTE) as VotingStyle,
      applicant: p.ref ?? '',
      proposalId: p.publicId ?? null,
      docHash: p.docHash ?? null,
      electedBoard: p.electedBoard ?? null,
      votes,
      yes: r.yes ?? 0,
      no: r.no ?? 0,
      threshold: r.threshold ?? 0,
      totalPower: r.totalPower,
      outcome: r.outcome ?? '',
      proofHash: a.hash,
    })[GOVERNANCE_METADATA_LABEL];
  }

  /** Admission decision (1P1V). `votes` carry each board member's CIP-30 signature. */
  async anchorAdmissionResult(params: {
    applicantDrepRowId: string;
    applicantDrepId: string;
    votes: (GovVoteEvent & { signature?: string | null; signingKey?: string | null })[];
    outcome: 'ADMITTED' | 'REJECTED';
    yes: number;
    no: number;
    threshold: number;
  }): Promise<AnchorResult> {
    return this.anchorResult({
      kind: 'admission',
      subject: GovSubject.ADMISSION,
      style: VotingStyle.ONE_PERSON_ONE_VOTE,
      ref: params.applicantDrepId,
      proposalId: params.applicantDrepRowId,
      votes: params.votes.map((v) => ({ drep: v.voter, vote: v.choice })),
      preimageVotes: params.votes,
      outcome: params.outcome,
      yes: params.yes,
      no: params.no,
      threshold: params.threshold,
    });
  }

  /** Build + sign + submit a single tx carrying `event` as metadata, from the anchor wallet. */
  private async submitMetadataTx(event: AnchorResultMetadata | AnchorSubmissionMetadata | AnchorPayoutMetadata | AnchorDocHashMetadata | Record<string, unknown>): Promise<string> {
    if (!this.mnemonic) throw new Error('ANCHOR_MNEMONIC not configured (anchor recorded, not submitted)');
    const { prv, addr } = this.anchorKeys(this.mnemonic);
    const pp = await this.cardano.epochParams();
    const utxos = await this.cardano.addressUtxos([addr.to_bech32()]);
    if (!utxos.length) throw new Error('anchor wallet has no UTxOs');
    const built = this.buildMetadataTx(event, utxos, pp, prv, addr);
    await this.submitTxHex(built.fixedHex);
    this.logger.log(`anchored on-chain: ${built.txHash}`);
    return built.txHash;
  }

  /**
   * Build + sign one metadata tx from the given UTxOs. Returns the signed tx hex, its
   * hash, and the change output (so a batch can chain txs without re-querying Koios).
   */
  private buildMetadataTx(
    event: AnchorResultMetadata | AnchorSubmissionMetadata | AnchorPayoutMetadata | AnchorDocHashMetadata | Record<string, unknown>,
    utxos: Utxo[],
    pp: Record<string, string | number>,
    prv: CSL.PrivateKey,
    addr: CSL.Address,
  ): { fixedHex: string; txHash: string; change: Utxo | null; inputs: string[] } {
    if (!utxos.length) throw new Error('anchor wallet has no UTxOs');
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));
    txb.add_json_metadatum_with_schema(
      CSL.BigNum.from_str(String(GOVERNANCE_METADATA_LABEL)),
      JSON.stringify(this.chunkLongStrings(event)),
      CSL.MetadataJsonSchema.NoConversions,
    );
    const unspent = CSL.TransactionUnspentOutputs.new();
    for (const u of utxos) {
      unspent.add(
        CSL.TransactionUnspentOutput.new(
          CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index)),
          CSL.TransactionOutput.new(addr, CSL.Value.new(CSL.BigNum.from_str(String(u.value)))),
        ),
      );
    }
    txb.add_inputs_from(unspent, CSL.CoinSelectionStrategyCIP2.LargestFirst);
    txb.add_change_if_needed(addr);

    const built = txb.build_tx();
    const fixed = CSL.FixedTransaction.from_hex(built.to_hex());
    fixed.sign_and_add_vkey_signature(prv);
    const txHash = fixed.transaction_hash().to_hex();

    // The exact inputs selected — a batch marks any node-rejected input as bad
    // (db-sync can lag and still offer a UTxO the node has already spent).
    const inputRefs: string[] = [];
    const bodyIns = built.body().inputs();
    for (let k = 0; k < bodyIns.len(); k++) inputRefs.push(`${bodyIns.get(k).transaction_id().to_hex()}#${bodyIns.get(k).index()}`);

    // The single change output (back to our address) becomes the next chained input.
    const addrBech = addr.to_bech32();
    const outs = built.body().outputs();
    let change: Utxo | null = null;
    for (let i = 0; i < outs.len(); i++) {
      const o = outs.get(i);
      if (o.address().to_bech32() === addrBech) {
        change = { tx_hash: txHash, tx_index: i, value: o.amount().coin().to_str() };
        break;
      }
    }
    return { fixedHex: fixed.to_hex(), txHash, change, inputs: inputRefs };
  }

  /**
   * Cardano tx metadata caps each text string at 64 BYTES. A long title/outcome (e.g. a 66-byte
   * proposal name) would otherwise make encoding throw "Max metadata string too long". We split any
   * over-long string into an array of ≤64-byte chunks (the standard, lossless approach — a reader
   * concatenates the array), walking the whole metadata object recursively before encoding.
   */
  private chunkLongStrings(value: unknown): unknown {
    if (typeof value === 'string') {
      return Buffer.byteLength(value, 'utf8') <= 64 ? value : this.splitTo64Bytes(value);
    }
    if (Array.isArray(value)) return value.map((v) => this.chunkLongStrings(v));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.chunkLongStrings(v)]));
    }
    return value;
  }

  /** Split a string into ≤64-byte UTF-8 chunks without cutting a multi-byte character in half. */
  private splitTo64Bytes(s: string): string[] {
    const chunks: string[] = [];
    let buf = '';
    for (const ch of s) {
      if (Buffer.byteLength(buf + ch, 'utf8') > 64) {
        chunks.push(buf);
        buf = ch;
      } else {
        buf += ch;
      }
    }
    if (buf) chunks.push(buf);
    return chunks;
  }

  private async submitTxHex(hex: string): Promise<void> {
    // Prefer a cardano-submit-api (our own node) when configured — it avoids Koios
    // entirely for the broadcast, so a Koios daily-cap 429 can't block submission.
    const url = this.submitApiUrl ? `${this.submitApiUrl.replace(/\/$/, '')}/api/submit/tx` : `${this.base}/submittx`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(hex, 'hex'),
    });
    if (!res.ok) throw new Error(`submittx ${res.status}: ${await res.text()}`);
  }

  private anchorKeys(mnemonic: string) {
    const root = CSL.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'),
      Buffer.from(''),
    );
    const acct = root.derive(harden(1852)).derive(harden(1815)).derive(harden(0));
    const payKey = acct.derive(0).derive(0);
    const pc = CSL.Credential.from_keyhash(payKey.to_public().to_raw_key().hash());
    const sc = CSL.Credential.from_keyhash(acct.derive(2).derive(0).to_public().to_raw_key().hash());
    return { prv: payKey.to_raw_key(), addr: CSL.BaseAddress.new(this.networkId, pc, sc).to_address() };
  }
}
