import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { PrismaService } from '../prisma/prisma.service';
import { AnchorService } from '../cardano/anchor.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { verifyCip30Signature } from '../auth/cip30';
import { PledgeReturnService } from './pledge-return.service';
import { MeritService } from '../merit/merit.service';

const LOVELACE = 1_000_000;
const SIGNING_THRESHOLD = 3; // §15 — 3-of-5 board signatures required to broadcast

// §12 — reward-calculation kind → human-readable payout stage for the on-chain proof.
const STAGE_LABEL: Record<string, string> = {
  FILTER: 'Filtering',
  DV_FIXED: 'Debate & Vote',
  DV_BONUS: 'Debate & Vote (bonus)',
  MILESTONE: 'Milestone review',
  EXPERT: 'Expert rewards',
  BOARD_MONTHLY: 'Board compensation',
};

/**
 * §15 — real native-script multisig broadcast — 3-of-5.
 *
 * Two ceremonies, switched by the TX_SIGNING_PROCESS platform parameter:
 *
 * 1_PHASE (default — requires the Eternl wallet)
 *   The ledger never required required_signers for native scripts — it only
 *   checks that the final tx carries ≥ M valid vkey witnesses matching keys
 *   in the script. So we build ONE shared unsigned body with NO
 *   required_signers, every board member sees a single Sign button, and the
 *   platform broadcasts the moment the 3rd witness lands (first-3-wins).
 *   The unsigned tx carries the multisig script in its witness set — that's
 *   how a wallet detects its key participates (there are no required_signers
 *   to tell it). Eternl signs script-input txs this way; wallets that still
 *   refuse are why the 2-phase fallback exists.
 *
 * 2_PHASE (fallback — works with any CIP-30 wallet)
 *   The tx body's required_signers list names which M keys WILL sign, so it
 *   has to be decided BEFORE any wallet can sign. We run a small
 *   Authorize → Sign ceremony:
 *
 *   Phase 1 (Authorize)
 *     Board member CIP-30 data-signs a cheap commit message ("I commit to
 *     signing action X"). Stored as a MultisigCommitment. No HW wallet
 *     touched; no tx fee.
 *
 *   Phase 2 (Sign tx) — kicks in the moment M commitments are collected
 *     The platform snapshots those M signers' keyhashes onto the action
 *     (committedKeyHashes), builds the unsigned tx body with EXACTLY those
 *     M keys in required_signers, and asks each committed member to sign
 *     it for real with their HW wallet (api.signTx, partial=true). Wallets
 *     pop a sign prompt because their key IS in required_signers.
 *
 *   When all M tx witnesses are collected, the platform combines them with
 *   the native script (ScriptNOfK(M, [N keys])) and submits via Koios.
 *
 * Per action methods:
 *   1. commitToSign(actionId, userId, sig) — 2_PHASE only; promotes at threshold.
 *   2. prepareTxBody(actionId)             — builds the body for the CURRENT mode
 *      (a cached body built under the other mode is discarded together with its
 *      witnesses — they signed a different body hash).
 *   3. submitWitness(actionId, hex, userId) — combines + broadcasts at M.
 *
 * Source script is determined by action kind:
 *   • OPS / PROJECT_FUNDING / REWARD_PAYOUT / BOARD_TRANSFER → active multisig.
 *   • MIGRATION → the OLD multisig (action.fromConfigId), signed by the
 *     keyholders of THAT script (typically the previous board).
 */
@Injectable()
export class MultisigBroadcastService {
  private readonly logger = new Logger(MultisigBroadcastService.name);
  private readonly networkId: number;
  private readonly base: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly anchor: AnchorService,
    private readonly cardano: CardanoQueryService,
    private readonly pledgeReturn: PledgeReturnService,
    @Optional() private readonly merit?: MeritService,
  ) {
    const net = (this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod').trim();
    this.networkId = net === 'Mainnet' ? 1 : 0;
    this.base = this.config.get<string>('KOIOS_URL')
      ?? (net === 'Mainnet' ? 'https://api.koios.rest/api/v1' : 'https://preprod.koios.rest/api/v1');
  }

  /** §15/§20 — current signing ceremony from the TX_SIGNING_PROCESS platform
   *  parameter. Anything other than an explicit '2_PHASE' means 1-phase (the
   *  default), so a missing/garbled row can never strand actions. */
  async signingMode(): Promise<'1_PHASE' | '2_PHASE'> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'TX_SIGNING_PROCESS' } });
    return row?.value === '2_PHASE' ? '2_PHASE' : '1_PHASE';
  }

  /** §15 1-phase — make sure the unsigned tx carries the multisig script in
   *  its witness set. Without it (and without required_signers) a wallet has
   *  no way to know its key participates and refuses to sign. Re-wrapping
   *  changes only the witness set — the body (and thus its hash, which is
   *  what gets signed) stays byte-identical. Returns the input on any
   *  parse hiccup. */
  private ensureScriptAttached(txCbor: string, spendingScriptJson: object): string {
    try {
      const tx = CSL.Transaction.from_hex(txCbor);
      const existing = tx.witness_set().native_scripts();
      if (existing && existing.len() > 0) return txCbor;
      const ws = CSL.TransactionWitnessSet.new();
      const scripts = CSL.NativeScripts.new();
      scripts.add(this.scriptJsonToCSL(spendingScriptJson));
      ws.set_native_scripts(scripts);
      return Buffer.from(CSL.Transaction.new(tx.body(), ws).to_bytes()).toString('hex');
    } catch {
      return txCbor;
    }
  }

  /** A cached tx body is only reusable under the mode it was built for:
   *  2-phase bodies carry required_signers, 1-phase bodies don't. */
  private bodyModeMismatch(txCbor: string, mode: '1_PHASE' | '2_PHASE'): boolean {
    try {
      const rs = CSL.Transaction.from_hex(txCbor).body().required_signers();
      const hasRequired = !!rs && rs.len() > 0;
      return hasRequired !== (mode === '2_PHASE');
    } catch {
      return true; // un-parseable cache → rebuild
    }
  }

  /** Canonical phase-1 commit message — what each board member CIP-30
   *  data-signs to authorize signing an action. Bound to (actionId,
   *  stakeAddress, ts) so signatures can't replay. */
  static commitMessage(args: { actionId: string; stakeAddress: string; ts: string }): string {
    return [
      'drep-dao | multisig commit',
      `action:${args.actionId}`,
      `signer:${args.stakeAddress}`,
      `ts:${args.ts}`,
    ].join('\n');
  }

  /**
   * §15 phase 1 — board member commits to signing this action. Verifies the
   * CIP-30 data-signature (proves the user actually clicked their wallet),
   * looks up their multisig keyhash, stores the commitment. When SIGNING_
   * THRESHOLD commitments are collected, snapshots those M keyhashes onto
   * the action — from that moment prepareTxBody / submitWitness work.
   */
  async commitToSign(actionId: string, userId: string, dto: { signature: string; key: string; ts: string }) {
    const action = await this.prisma.multisigAction.findUnique({
      where: { id: actionId },
      include: { commitments: true },
    });
    if (!action) throw new NotFoundException('action not found');
    if (action.status !== 'PENDING_SIGS') {
      throw new ConflictException(`action is past the authorization phase (status ${action.status})`);
    }
    if ((await this.signingMode()) === '1_PHASE') {
      throw new ConflictException('1-Phase signing is enabled — no authorization step; sign the transaction directly');
    }
    const source = await this.resolveSource(action);
    const scriptKeyHashes = new Set(source.keyHashes.map((k) => k.toLowerCase()));

    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { id: true, stakeAddress: true, drepKeyHash: true },
    });
    if (!user?.drepKeyHash) throw new ForbiddenException('board members only');
    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('signer has no DRep record');
    const myKey = await this.prisma.boardMultisigKey.findFirst({ where: { userId } });
    if (!myKey || !scriptKeyHashes.has(myKey.paymentKeyHash.toLowerCase())) {
      throw new ForbiddenException('your multisig signing key is not part of the source script — cannot authorize');
    }

    const message = MultisigBroadcastService.commitMessage({
      actionId,
      stakeAddress: user.stakeAddress,
      ts: dto.ts,
    });
    if (!verifyCip30Signature(dto.signature, dto.key, message, user.stakeAddress)) {
      throw new BadRequestException('commit signature did not verify');
    }

    await this.prisma.multisigCommitment.upsert({
      where: { actionId_userId: { actionId, userId } },
      update: { keyHash: myKey.paymentKeyHash, signature: dto.signature, signingKey: dto.key, ts: dto.ts, drepId: drep.id },
      create: { actionId, userId, drepId: drep.id, keyHash: myKey.paymentKeyHash, signature: dto.signature, signingKey: dto.key, ts: dto.ts },
    });

    // Threshold reached? Snapshot the M chosen keyhashes (insertion order)
    // and reset any cached tx body so the next prepareTxBody rebuilds with
    // exactly those M keys in required_signers.
    const all = await this.prisma.multisigCommitment.findMany({ where: { actionId } });
    if (all.length >= SIGNING_THRESHOLD && (action.committedKeyHashes?.length ?? 0) === 0) {
      const sorted = all.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime());
      const chosen: string[] = [];
      const seen = new Set<string>();
      for (const c of sorted) {
        const kh = c.keyHash.toLowerCase();
        if (seen.has(kh)) continue;
        seen.add(kh);
        chosen.push(c.keyHash);
        if (chosen.length === SIGNING_THRESHOLD) break;
      }
      await this.prisma.multisigAction.update({
        where: { id: actionId },
        data: { committedKeyHashes: chosen, txCbor: null },
      });
    }

    const refreshed = await this.prisma.multisigAction.findUnique({
      where: { id: actionId },
      include: { commitments: true },
    });
    return {
      status: refreshed?.status ?? action.status,
      commitments: refreshed?.commitments.length ?? all.length,
      threshold: SIGNING_THRESHOLD,
      ready: (refreshed?.committedKeyHashes?.length ?? 0) >= SIGNING_THRESHOLD,
    };
  }

  /** Returns the cached / freshly-built unsigned tx body hex for an action,
   *  plus the source script address (so the UI can say "signing as wallet X
   *  for multisig Y"). Idempotent: subsequent calls return the cached body. */
  async prepareTxBody(actionId: string) {
    const action = await this.prisma.multisigAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('action not found');
    if (action.status === 'CONFIRMED') throw new ConflictException('action already broadcast');
    const mode = await this.signingMode();
    // §15 2-phase gate: the body can only be built once the M signers have
    // been chosen via commitments (committedKeyHashes goes into
    // required_signers verbatim). In 1-phase there's nothing to wait for.
    const committed = action.committedKeyHashes ?? [];
    if (mode === '2_PHASE' && committed.length < SIGNING_THRESHOLD) {
      throw new ConflictException(`waiting on board authorizations — ${committed.length}/${SIGNING_THRESHOLD} committed`);
    }
    let source = await this.resolveSource(action);
    if (action.txCbor) {
      if (!this.bodyModeMismatch(action.txCbor, mode)) {
        // §15 1-phase — older cached bodies were wrapped with an EMPTY witness
        // set; wallets then can't tell their key is involved (no
        // required_signers either) and refuse with "signature not needed".
        // Re-wrap with the script attached — the BODY is untouched, so any
        // witnesses already collected stay valid.
        let txHex = action.txCbor;
        if (mode === '1_PHASE') {
          const rewrapped = this.ensureScriptAttached(txHex, source.spendingScriptJson);
          if (rewrapped !== txHex) {
            txHex = rewrapped;
            await this.prisma.multisigAction.update({ where: { id: actionId }, data: { txCbor: txHex } });
          }
        }
        return {
          txBodyHex: txHex,
          sourceAddress: source.bech32Address,
          scriptHash: source.scriptHash,
          keyHashes: source.keyHashes,
        };
      }
      // TX_SIGNING_PROCESS flipped since this body was cached — witnesses
      // collected so far signed a different body hash, so they go too.
      await this.prisma.multisigSignature.deleteMany({ where: { actionId } });
      await this.prisma.multisigAction.update({ where: { id: actionId }, data: { txCbor: null } });
      action.txCbor = null;
    }
    // REWARD_PAYOUT is multi-output (one per linked reward entry), so it has no single destAddress.
    if (!action.destAddress && action.kind !== 'REWARD_PAYOUT') throw new ConflictException('action has no destination address');
    if (!action.amountAda) throw new ConflictException('action has no amount');

    // §15.6 — read UTxOs from db-sync (the same source the rest of the app uses), not Koios:
    // Koios returns a stale/partial set that can omit funds, leaving the tx short on inputs.
    let utxos = await this.cardano.addressUtxos([source.bech32Address]);
    // §15.6 — a chosen source BUCKET is its own sub-address and may be empty (the
    // board funded the primary multisig, not that bucket). Rather than dead-end,
    // fall back to the primary multisig (bare script), where the treasury's funds
    // usually sit; change returns there too. The committed 3-of-5 board keys spend
    // the primary script just the same (the bucket wrapper adds no extra signers).
    if (!utxos.length && action.sourceBucketId) {
      const primary = await this.resolveSource({ kind: action.kind, fromConfigId: action.fromConfigId, sourceBucketId: null });
      if (primary.bech32Address !== source.bech32Address) {
        const primaryUtxos = await this.cardano.addressUtxos([primary.bech32Address]);
        if (primaryUtxos.length) {
          source = primary;
          utxos = primaryUtxos;
          // Persist the effective source so submitWitness + combineAndSubmit resolve
          // the SAME (primary) script when attaching the native-script witness.
          // Otherwise the tx (built from the primary) gets the bucket script
          // attached at submit → MissingScriptWitnesses / ExtraneousScriptWitnesses.
          await this.prisma.multisigAction.update({ where: { id: actionId }, data: { sourceBucketId: null } });
        }
      }
    }
    if (!utxos.length) {
      throw new ConflictException(`source multisig has no on-chain UTxOs (${source.bech32Address})`);
    }

    const pp = await this.cardano.epochParams();
    const txb = CSL.TransactionBuilder.new(this.builderCfg(pp));
    const srcAddr = CSL.Address.from_bech32(source.bech32Address);

    // Build the native script that actually locks the source UTxOs. For a
    // labeled bucket this is the wrapped script (bucket = multisig + label
    // clause); for the primary multisig or migration source it's the bare
    // multisig script. Both spend with the same N board witnesses.
    const nativeScript = this.scriptJsonToCSL(source.spendingScriptJson);

    let totalIn = 0n;
    for (const u of utxos) {
      const input = CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), Number(u.tx_index));
      const value = CSL.Value.new(CSL.BigNum.from_str(String(u.value)));
      txb.add_native_script_input(nativeScript, input, value);
      totalIn += BigInt(u.value);
    }

    if (action.kind === 'REWARD_PAYOUT') {
      // §12 — one output per linked reward entry (the recipient's reward address);
      // change returns to the source. This is the "bulk transaction".
      const entries = await this.prisma.rewardEntry.findMany({
        where: { payoutActionId: action.id },
        include: {
          drep: { select: { user: { select: { rewardPaymentAddress: true } } } },
          expert: { select: { user: { select: { rewardPaymentAddress: true } } } },
        },
      });
      let added = 0;
      for (const e of entries) {
        const addr = e.drep?.user.rewardPaymentAddress ?? e.expert?.user.rewardPaymentAddress;
        const amt = e.overrideAda ?? e.amountAda;
        if (!addr || amt <= 0n) continue;
        txb.add_output(CSL.TransactionOutput.new(CSL.Address.from_bech32(addr), CSL.Value.new(CSL.BigNum.from_str(String(amt)))));
        added++;
      }
      if (added === 0) throw new ConflictException('reward payout has no payable recipients');
      txb.add_change_if_needed(srcAddr);
    } else {
      const destAddr = CSL.Address.from_bech32(action.destAddress!);
      if (action.kind === 'MIGRATION') {
        // Drain: route change to dest, no explicit output (change = full balance minus fee).
        txb.add_change_if_needed(destAddr);
      } else {
        txb.add_output(CSL.TransactionOutput.new(destAddr, CSL.Value.new(CSL.BigNum.from_str(String(action.amountAda)))));
        txb.add_change_if_needed(srcAddr);
      }
    }
    // §15 2-phase only — required_signers = the M committed keyhashes (NOT
    // all N script keys). The ledger then enforces "these M must sign",
    // matching what the M committed wallets will actually provide. In
    // 1-phase the body names nobody: the native script's ScriptNOfK(M,N) is
    // satisfied by whichever M script keys end up witnessing.
    if (mode === '2_PHASE') {
      for (const kh of committed) {
        txb.add_required_signer(CSL.Ed25519KeyHash.from_hex(kh));
      }
    }

    const txBody = txb.build();
    void totalIn;
    // CIP-30 signTx expects a full Transaction CBOR (Array), not a raw
    // TransactionBody (Map). In 1-phase the body names no required_signers,
    // so the multisig script rides along in the witness set — that's how a
    // wallet (Eternl) learns its key participates and prompts to sign.
    // Doesn't affect the body hash, so it never invalidates witnesses.
    const ws = CSL.TransactionWitnessSet.new();
    if (mode === '1_PHASE') {
      const scripts = CSL.NativeScripts.new();
      scripts.add(nativeScript);
      ws.set_native_scripts(scripts);
    }
    const tx = CSL.Transaction.new(txBody, ws);
    const txHex = Buffer.from(tx.to_bytes()).toString('hex');
    await this.prisma.multisigAction.update({ where: { id: actionId }, data: { txCbor: txHex } });
    return {
      txBodyHex: txHex,
      sourceAddress: source.bech32Address,
      scriptHash: source.scriptHash,
      keyHashes: source.keyHashes,
    };
  }

  /** Accept one board member's vkey witness. Verifies the vkey's hash is in
   *  the action's source script so a random signature can't pollute the set.
   *  When all N witnesses are collected, broadcasts. */
  async submitWitness(actionId: string, witnessHex: string, userId: string): Promise<{ status: string; approvals: number; threshold: number; txHash?: string | null; stored?: number }> {
    const action = await this.prisma.multisigAction.findUnique({
      where: { id: actionId },
      include: { signatures: true },
    });
    if (!action) throw new NotFoundException('action not found');
    // §15 — 3-of-5: threshold = SIGNING_THRESHOLD, not source.keyHashes.length.
    const threshold = SIGNING_THRESHOLD;
    if (action.status === 'CONFIRMED') {
      return { status: 'CONFIRMED', txHash: action.txHash, approvals: action.signatures.length, threshold };
    }
    const mode = await this.signingMode();
    // §15 2-phase — only the M committed signers may submit witnesses.
    const committed = action.committedKeyHashes ?? [];
    if (mode === '2_PHASE' && committed.length < SIGNING_THRESHOLD) {
      throw new ConflictException('action is still in the authorization phase — collect commits first');
    }
    const source = await this.resolveSource(action);
    if (!action.txCbor || this.bodyModeMismatch(action.txCbor, mode)) {
      // Lazily (re)build the tx body — either the witness arrived before
      // prepare was called, or the signing mode flipped since the cache
      // (prepareTxBody discards the stale body + its witnesses).
      await this.prepareTxBody(actionId);
      return this.submitWitness(actionId, witnessHex, userId);
    }
    // 2-phase: accept witnesses only from the committed set —
    // required_signers enforces exactly these. 1-phase: any of the N script
    // keys may witness; the first M to land win.
    const scriptKeyHashes = new Set((mode === '2_PHASE' ? committed : source.keyHashes).map((k) => k.toLowerCase()));

    let ws: CSL.TransactionWitnessSet;
    try { ws = CSL.TransactionWitnessSet.from_hex(witnessHex); }
    catch { throw new BadRequestException('witness CBOR is not a valid TransactionWitnessSet'); }
    const vkeys = ws.vkeys();
    if (!vkeys || vkeys.len() === 0) {
      throw new BadRequestException('wallet returned no vkey witnesses — switch your wallet to the account that holds your submitted multisig key, then click Sign again.');
    }

    const ourWitnesses: { keyHashHex: string; vkeyWitnessHex: string }[] = [];
    for (let i = 0; i < vkeys.len(); i++) {
      const v = vkeys.get(i);
      const keyHashHex = v.vkey().public_key().hash().to_hex();
      if (!scriptKeyHashes.has(keyHashHex.toLowerCase())) continue;
      ourWitnesses.push({ keyHashHex, vkeyWitnessHex: Buffer.from(v.to_bytes()).toString('hex') });
    }
    if (ourWitnesses.length === 0) {
      throw new BadRequestException('none of the wallet\'s vkey witnesses correspond to a board signing key for this multisig — switch wallet account and try again.');
    }

    const drep = await this.prisma.drep.findUnique({ where: { userId } });
    if (!drep) throw new ForbiddenException('signer has no DRep record — cannot bind witness to identity');
    let stored = 0;
    for (const w of ourWitnesses) {
      try {
        await this.prisma.multisigSignature.upsert({
          where: { actionId_boardDrepId: { actionId, boardDrepId: drep.id } },
          update: { witnessCbor: w.vkeyWitnessHex },
          create: { actionId, boardDrepId: drep.id, witnessCbor: w.vkeyWitnessHex },
        });
        stored++;
      } catch (e) {
        void e;
      }
    }

    const all = await this.prisma.multisigSignature.findMany({ where: { actionId } });
    if (all.length >= threshold) {
      try { return await this.combineAndSubmit(actionId); }
      catch (e) {
        this.logger.warn(`combine+submit failed for ${actionId}: ${e instanceof Error ? e.message : e}`);
        // Never downgrade a CONFIRMED action: when two witnesses arrive near-simultaneously the
        // winning combineAndSubmit stamps CONFIRMED while the loser's duplicate submit fails —
        // clobbering to READY here would reopen a paid action as signable.
        await this.prisma.multisigAction.updateMany({ where: { id: actionId, status: { not: 'CONFIRMED' } }, data: { status: 'READY' } });
        throw e;
      }
    }
    return { status: 'PENDING_SIGS', approvals: all.length, threshold, stored };
  }

  /** Combine every stored vkey witness with the source script, wrap the
   *  cached tx body, submit via Koios, stamp the action CONFIRMED. */
  private async combineAndSubmit(actionId: string) {
    const action = await this.prisma.multisigAction.findUnique({
      where: { id: actionId },
      include: { signatures: true },
    });
    if (!action) throw new NotFoundException('action not found');
    if (!action.txCbor) throw new ConflictException('tx body not prepared');
    const source = await this.resolveSource(action);
    const threshold = SIGNING_THRESHOLD; // §15 — 3-of-5 collected witnesses suffice

    const cachedTx = CSL.Transaction.from_hex(action.txCbor);
    const txBody = cachedTx.body();
    const vkeyWitnesses = CSL.Vkeywitnesses.new();
    const seen = new Set<string>();
    for (const s of action.signatures) {
      try {
        const v = CSL.Vkeywitness.from_hex(s.witnessCbor);
        const kh = v.vkey().public_key().hash().to_hex().toLowerCase();
        if (seen.has(kh)) continue;
        seen.add(kh);
        vkeyWitnesses.add(v);
      } catch (e) {
        this.logger.warn(`skipping un-parseable witness on action ${actionId}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (vkeyWitnesses.len() < threshold) {
      throw new ConflictException(`only ${vkeyWitnesses.len()} valid vkey witnesses; need ${threshold} board members to sign`);
    }

    const witnessSet = CSL.TransactionWitnessSet.new();
    witnessSet.set_vkeys(vkeyWitnesses);
    const nativeScripts = CSL.NativeScripts.new();
    // Attach the exact script that locks the source UTxOs (bare multisig
    // for primary/migration; wrapped script for labeled buckets).
    nativeScripts.add(this.scriptJsonToCSL(source.spendingScriptJson));
    witnessSet.set_native_scripts(nativeScripts);

    const tx = CSL.Transaction.new(txBody, witnessSet);
    const fixed = CSL.FixedTransaction.from_hex(Buffer.from(tx.to_bytes()).toString('hex'));
    const txHash = fixed.transaction_hash().to_hex();
    const txHex = fixed.to_hex();

    const res = await fetch(`${this.base}/submittx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: Buffer.from(txHex, 'hex'),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Koios submittx ${res.status}: ${body.slice(0, 400)}`);
    }

    await this.prisma.multisigAction.update({
      where: { id: actionId },
      data: { status: 'CONFIRMED', txHash, paidAt: new Date() },
    });
    // §12 — stamp each reward entry this payout covered as paid (immutable history).
    if (action.kind === 'REWARD_PAYOUT') {
      const entries = await this.prisma.rewardEntry.findMany({
        where: { payoutActionId: actionId, paidAt: null },
        include: {
          drep: { select: { drepIdOnchain: true, user: { select: { rewardPaymentAddress: true } } } },
          expert: { select: { displayName: true, user: { select: { rewardPaymentAddress: true } } } },
          rewardCalculation: { select: { kind: true, roundId: true, periodKey: true, round: { select: { name: true, number: true } } } },
        },
      });
      for (const e of entries) {
        const addr = e.drep?.user.rewardPaymentAddress ?? e.expert?.user.rewardPaymentAddress ?? null;
        const amt = e.overrideAda ?? e.amountAda;
        // Stamp ONLY entries the tx could actually pay: prepareTxBody skips address-less or
        // zero-amount entries, so stamping them here would mark them paid with no output on-chain
        // (and paid entries are immutable — the recipient could never be paid later).
        if (!addr || amt <= 0n) continue;
        await this.prisma.rewardEntry.update({
          where: { id: e.id },
          data: { paidAt: new Date(), paidInTx: txHash, paidToAddress: addr },
        });
      }
      // §12 — anchor an on-chain proof of the payout: stage, tx hash, every recipient (DRep id /
      // expert name) + lovelace, and the board signers. Best-effort; never block the payout.
      try {
        const calc = entries[0]?.rewardCalculation;
        const sigs = await this.prisma.multisigSignature.findMany({
          where: { actionId },
          include: { drep: { select: { drepIdOnchain: true } } },
        });
        await this.anchor.anchorPayout({
          stage: calc ? STAGE_LABEL[calc.kind] ?? calc.kind : 'Reward',
          round: calc?.round?.name ?? (calc?.round?.number != null ? `Round #${calc.round.number}` : calc?.periodKey ?? null),
          roundId: calc?.roundId ?? null,
          payoutTxHash: txHash,
          recipients: entries.map((e) => ({
            to: e.drep?.drepIdOnchain ?? e.expert?.displayName ?? 'recipient',
            lovelace: Number(e.overrideAda ?? e.amountAda),
          })),
          signers: sigs.map((s) => s.drep.drepIdOnchain),
        });
      } catch (e) {
        this.logger.warn(`reward payout anchor skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Anchor the recipient address, amount, and tx hash of a single-output spend
    // (funding-milestone payout or internal-proposal spending). Best-effort; never blocks.
    const anchorSpend = async (stage: string) => {
      if (!action.destAddress || action.amountAda == null) return;
      try {
        const sigs = await this.prisma.multisigSignature.findMany({
          where: { actionId },
          include: { drep: { select: { drepIdOnchain: true } } },
        });
        await this.anchor.anchorPayout({
          stage,
          round: action.proposalTitle ?? null,
          roundId: null,
          payoutTxHash: txHash,
          recipients: [{ to: action.destAddress, lovelace: Number(action.amountAda) }],
          signers: sigs.map((s) => s.drep.drepIdOnchain),
        });
      } catch (e) {
        this.logger.warn(`spend anchor skipped: ${e instanceof Error ? e.message : e}`);
      }
    };
    // §11.4 — a confirmed PROJECT_FUNDING payout stamps the milestone PAID (the schema always
    // promised this), then §16.3 checks whether a pledge-return share is due.
    if (action.kind === 'PROJECT_FUNDING' && action.milestoneId) {
      await this.prisma.milestone.update({
        where: { id: action.milestoneId },
        data: { paidAt: new Date(), paidInTx: txHash },
      });
      await anchorSpend(
        action.milestoneIdx != null ? `Milestone #${action.milestoneIdx + 1} payout` : 'Milestone payout',
      );
      if (action.proposalId && this.pledgeReturn) {
        try {
          await this.pledgeReturn.maybePrepareReturn(action.proposalId, action.milestoneId);
        } catch (e) {
          this.logger.warn(`pledge-return check failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    // An OPS spend that funds an internal proposal (carries proposalId + destAddress) — anchor
    // the recipient, amount, and tx so the proof matches funding-milestone payouts.
    if (action.kind === 'OPS' && action.proposalId && action.destAddress) {
      await anchorSpend('Internal proposal payout');
    }
    // §15.2 — when the LAST migration tx out of an old multisig confirms, anchor the whole fund
    // move: every old source address + amount + tx, and the new primary address funds landed at.
    if (action.kind === 'MIGRATION' && action.fromConfigId) {
      try {
        const stillPending = await this.prisma.multisigAction.count({
          where: { kind: 'MIGRATION', fromConfigId: action.fromConfigId, status: { in: ['PENDING_SIGS', 'READY', 'BROADCASTED'] } },
        });
        if (stillPending === 0) {
          const done = await this.prisma.multisigAction.findMany({
            where: { kind: 'MIGRATION', fromConfigId: action.fromConfigId, status: 'CONFIRMED', txHash: { not: null } },
            select: { amountAda: true, txHash: true, destAddress: true, sourceBucketId: true },
          });
          const fromCfg = await this.prisma.multisigConfig.findUnique({ where: { id: action.fromConfigId }, select: { bech32Address: true } });
          const bucketIds = [...new Set(done.map((d) => d.sourceBucketId).filter((x): x is string => !!x))];
          const bucketAddr = new Map(
            (bucketIds.length ? await this.prisma.treasuryBucket.findMany({ where: { id: { in: bucketIds } }, select: { id: true, bech32Address: true } }) : [])
              .map((b) => [b.id, b.bech32Address]),
          );
          const moves = done.map((d) => ({
            from: d.sourceBucketId ? (bucketAddr.get(d.sourceBucketId) ?? '') : (fromCfg?.bech32Address ?? ''),
            lovelace: Number(d.amountAda ?? 0n),
            tx: d.txHash as string,
          }));
          const newAddress = done.find((d) => d.destAddress)?.destAddress ?? action.destAddress ?? '';
          if (moves.length && newAddress) await this.anchor.anchorMultisigMigration({ newAddress, moves });
        }
      } catch (e) {
        this.logger.warn(`multisig migration anchor skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    // §13.2 — every signer of a tx that reached the network earns +1 (once per action).
    try {
      const sigs = await this.prisma.multisigSignature.findMany({ where: { actionId }, select: { boardDrepId: true } });
      await this.merit?.awardMany(sigs.map((s) => s.boardDrepId), 'TX_SIGNED', actionId);
    } catch (e) {
      this.logger.warn(`TX_SIGNED merit skipped: ${e instanceof Error ? e.message : e}`);
    }
    // §13.2 — the board member who initiated the action (e.g. requested the
    // hot-wallet top-up) earns +1 on top of any TX_SIGNED they may also get.
    // Platform-prepared actions have no initiator. Idempotent per action.
    if (action.initiatorUserId) {
      try {
        const initiator = await this.prisma.drep.findUnique({ where: { userId: action.initiatorUserId }, select: { id: true } });
        if (initiator) await this.merit?.tryAward(initiator.id, 'TX_INITIATED', actionId);
      } catch (e) {
        this.logger.warn(`TX_INITIATED merit skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    this.logger.warn(`multisig action ${actionId} broadcast: ${txHash}`);
    return { status: 'CONFIRMED', txHash, approvals: vkeyWitnesses.len(), threshold };
  }

  /** Resolve which script address + script (for witness packing) + signing
   *  keyhashes the action moves funds OUT of. The script attached to inputs
   *  is the *bucket's* full script (which embeds the multisig); the
   *  threshold + required-signer keys still come from the underlying
   *  multisig. */
  private async resolveSource(action: { kind: string; fromConfigId: string | null; sourceBucketId?: string | null }): Promise<{ bech32Address: string; scriptHash: string; keyHashes: string[]; threshold: number; spendingScriptJson: object }> {
    // §15.5 — bucket-aware lookup FIRST. When the action targets a labeled bucket (incl. a
    // per-bucket MIGRATION), we spend from THAT bucket's address with THAT bucket's wrapped
    // script — not the config's bare script. Signing requirements come from the multisig keys
    // (same N keys, same N-of-N rule). Checked before the MIGRATION/config branch so a bucket
    // migration signs with the correct script.
    if (action.sourceBucketId) {
      const bucket = await this.prisma.treasuryBucket.findUnique({
        where: { id: action.sourceBucketId },
        include: { config: true },
      });
      if (!bucket) throw new ConflictException('source bucket missing');
      const keyHashes = ((bucket.config.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => s.keyHash);
      return {
        bech32Address: bucket.bech32Address,
        scriptHash: bucket.scriptHash,
        keyHashes,
        threshold: bucket.config.threshold,
        spendingScriptJson: bucket.scriptJson as object,
      };
    }
    if (action.kind === 'MIGRATION' && action.fromConfigId) {
      const c = await this.prisma.multisigConfig.findUnique({ where: { id: action.fromConfigId } });
      if (!c) throw new ConflictException('migration source multisig missing');
      const keyHashes = ((c.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => s.keyHash);
      return { bech32Address: c.bech32Address, scriptHash: c.scriptHash, keyHashes, threshold: c.threshold, spendingScriptJson: c.scriptJson as object };
    }
    const active = await this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
    if (!active) throw new ConflictException('no active multisig — assemble the board signing keys first');
    const keyHashes = ((active.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => s.keyHash);
    return { bech32Address: active.bech32Address, scriptHash: active.scriptHash, keyHashes, threshold: active.threshold, spendingScriptJson: active.scriptJson as object };
  }

  /** N-of-N native script: every key in the multisig must sign. */
  private buildNativeScript(keyHashes: string[]): CSL.NativeScript {
    const scripts = CSL.NativeScripts.new();
    for (const kh of keyHashes) {
      const ed = CSL.Ed25519KeyHash.from_hex(kh);
      scripts.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(ed)));
    }
    return CSL.NativeScript.new_script_all(CSL.ScriptAll.new(scripts));
  }

  /** Reconstruct a CSL.NativeScript from our stored JSON shape. Mirrors the
   *  reader in TreasuryBucketsService so labeled buckets can be re-built
   *  byte-for-byte at submit time. */
  private scriptJsonToCSL(json: object): CSL.NativeScript {
    const node = json as { type: string; required?: number; scripts?: object[] };
    if (node.type === 'sig') {
      const kh = (json as { keyHash: string }).keyHash;
      return CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(CSL.Ed25519KeyHash.from_hex(kh)));
    }
    if (node.type === 'all') {
      const arr = CSL.NativeScripts.new();
      for (const child of node.scripts ?? []) arr.add(this.scriptJsonToCSL(child));
      return CSL.NativeScript.new_script_all(CSL.ScriptAll.new(arr));
    }
    if (node.type === 'any') {
      const arr = CSL.NativeScripts.new();
      for (const child of node.scripts ?? []) arr.add(this.scriptJsonToCSL(child));
      return CSL.NativeScript.new_script_any(CSL.ScriptAny.new(arr));
    }
    if (node.type === 'atLeast') {
      const arr = CSL.NativeScripts.new();
      for (const child of node.scripts ?? []) arr.add(this.scriptJsonToCSL(child));
      return CSL.NativeScript.new_script_n_of_k(CSL.ScriptNOfK.new(node.required ?? 0, arr));
    }
    throw new Error(`unknown native-script node type: ${node.type}`);
  }

  private builderCfg(pp: Record<string, string | number>) {
    const num = (k: string) => Number(pp[k]);
    return CSL.TransactionBuilderConfigBuilder.new()
      .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str(String(num('min_fee_a'))), CSL.BigNum.from_str(String(num('min_fee_b')))))
      .pool_deposit(CSL.BigNum.from_str(String(num('pool_deposit'))))
      .key_deposit(CSL.BigNum.from_str(String(num('key_deposit'))))
      .max_value_size(num('max_val_size'))
      .max_tx_size(num('max_tx_size'))
      .coins_per_utxo_byte(CSL.BigNum.from_str(String(num('coins_per_utxo_size'))))
      .build();
  }

}
