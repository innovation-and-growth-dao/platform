import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { PrismaService } from '../prisma/prisma.service';
import { CardanoQueryService } from '../cardano/cardano-query.service';
import { AnchorService } from '../cardano/anchor.service';
import { MeritService } from '../merit/merit.service';
import { verifyCip30Signature } from '../auth/cip30';

const LOVELACE = 1_000_000;

/**
 * §15 — board multisig setup + rotation.
 *
 * Each active board seat submits ONE payment verification-key (typically from
 * a hardware wallet). The board member attests via a CIP-30 data-signature
 * proving they actually control that key. Once every active seat has
 * submitted, the platform auto-assembles an `atLeast 3-of-N` Cardano native
 * script, derives its enterprise address, and stores it as a new
 * `MultisigConfig`. The previous active config is stamped `replacedAt`.
 *
 * Rotation flow when the board changes (re-election / resignation):
 *   1. Old seats are soft-deleted (`removedAt`); their `BoardMultisigKey`
 *      rows remain so we can later identify who is allowed to sign a
 *      migration tx out of the old multisig.
 *   2. New seats are inserted as fresh BoardSeat rows. The status() call
 *      surfaces "rotation in progress: N/M new keys collected".
 *   3. Once every new seat has submitted a key, a new MultisigConfig is
 *      assembled. The previous one is marked replaced + linked via
 *      `replacedByConfigId`.
 *   4. Any current board member may `prepareMigration(fromConfigId)` to
 *      create a MIGRATION-kind MultisigAction (from=old, to=new). The OLD
 *      board signs that action; Phase 2 will assemble + broadcast the real
 *      native-script tx.
 */
@Injectable()
export class BoardMultisigService {
  private readonly networkId: number;
  private readonly threshold = 3; // 3-of-N for the time being

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cardano: CardanoQueryService,
    @Optional() private readonly merit?: MeritService,
    @Optional() private readonly anchor?: AnchorService,
  ) {
    const net = (this.config.get<string>('CARDANO_NETWORK') ?? 'Preprod').trim();
    this.networkId = net === 'Mainnet' ? 1 : 0;
  }

  /** Canonical challenge message the wallet signs to prove possession of
   *  the multisig payment key. */
  static attestationMessage(args: { stakeAddress: string; paymentBech32: string; ts: string }): string {
    return [
      'drep-dao | multisig key attestation',
      `seat:${args.stakeAddress}`,
      `pay:${args.paymentBech32}`,
      `ts:${args.ts}`,
    ].join('\n');
  }

  /** The active multisig (latest non-replaced), or null if not yet assembled. */
  async active() {
    return this.prisma.multisigConfig.findFirst({ where: { replacedAt: null }, orderBy: { assembledAt: 'desc' } });
  }

  /** Predecessor configs (replacedAt IS NOT NULL), newest first. */
  async history() {
    return this.prisma.multisigConfig.findMany({
      where: { replacedAt: { not: null } },
      orderBy: { assembledAt: 'desc' },
    });
  }

  /**
   * Status + rotation state + balances. Returns:
   *   - active: the current assembled config (with live balance)
   *   - history: prior configs (with live balance) — boards can see which
   *     old wallets still hold un-migrated funds
   *   - seats: per-active-board-member key submission status
   *   - rotationInProgress: there's an active config but the current board's
   *     keys would assemble to a different script (i.e. a re-election
   *     happened and we're waiting on new keys)
   *   - migrationsPending: open MIGRATION actions awaiting signatures
   */
  async status() {
    // §15.2 — opportunistic assembly. submitKey() triggers assembly, but a rotated board whose
    // EVERY member's key carries over (all served before) has nothing left to submit — without
    // this, that hand-over would stall forever. Also makes the UI's promise true ("the platform
    // will assemble the new multisig on the next status refresh"). Cheap no-op when not ready:
    // tryAssemble bails early when a seat lacks a resolvable key or the script already matches.
    await this.tryAssemble().catch(() => null);
    const [seats, active, hist, keys] = await Promise.all([
      this.prisma.boardSeat.findMany({ where: { removedAt: null }, include: { multisigKey: true }, orderBy: { addedAt: 'asc' } }),
      this.active(),
      this.history(),
      this.prisma.boardMultisigKey.findMany({ include: { user: { select: { displayName: true } }, boardSeat: { select: { drepId: true, displayName: true } } } }),
    ]);
    const byUserId = new Map(keys.map((k) => [k.userId, k]));
    // Resolve the ACTIVE multisig's on-chain signers → member name + address (by matching each of
    // its script key hashes to a submitted key). Lets the UI show the old multisig's roster
    // (names + addresses) during a hand-over, exactly like the new-board roster.
    const keysByHash = new Map(keys.map((k) => [k.paymentKeyHash.toLowerCase(), k]));
    const signersOf = (cfg: { scriptJson: unknown } | null) =>
      (((cfg?.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => {
        const k = keysByHash.get(s.keyHash.toLowerCase());
        return {
          keyHash: s.keyHash,
          displayName: k?.user.displayName ?? k?.boardSeat?.displayName ?? null,
          drepId: k?.boardSeat?.drepId ?? null,
          paymentBech32: k?.paymentBech32 ?? null,
        };
      }));
    const seatRows = await Promise.all(seats.map(async (s) => {
      const linked = await this.prisma.appUser.findFirst({ where: { drepKeyHash: s.drepKeyHash } }).catch(() => null);
      const key = s.multisigKey ?? (linked ? byUserId.get(linked.id) ?? null : null);
      return {
        seatId: s.id,
        drepId: s.drepId,
        drepKeyHash: s.drepKeyHash,
        displayName: s.displayName,
        userId: linked?.id ?? null,
        hasKey: !!key,
        keyHash: key?.paymentKeyHash ?? null,
        paymentBech32: key?.paymentBech32 ?? null,
        hardwareAttested: key?.hardwareAttested ?? false,
        submittedAt: key?.submittedAt ?? null,
      };
    }));

    // Live balances for every known config (active + history) INCLUDING their labeled buckets,
    // so an old config only reads as "empty/terminated" once its main address AND every bucket
    // are drained (migration moves all of them to the new primary address).
    const cfgIds = [active?.id, ...hist.map((h) => h.id)].filter((id): id is string => !!id);
    const cfgBuckets = cfgIds.length
      ? await this.prisma.treasuryBucket.findMany({ where: { configId: { in: cfgIds } }, select: { configId: true, bech32Address: true } })
      : [];
    const bucketAddrsByConfig = new Map<string, string[]>();
    for (const b of cfgBuckets) bucketAddrsByConfig.set(b.configId, [...(bucketAddrsByConfig.get(b.configId) ?? []), b.bech32Address]);
    const allAddrs = [
      active?.bech32Address,
      ...hist.map((h) => h.bech32Address),
      ...cfgBuckets.map((b) => b.bech32Address),
    ].filter((a): a is string => !!a);
    const balMap = allAddrs.length ? await this.cardano.addressBalance(allAddrs).catch(() => new Map<string, bigint>()) : new Map<string, bigint>();
    const adaOf = (addr: string | null | undefined) => (addr ? Number(balMap.get(addr) ?? 0n) / LOVELACE : 0);
    // Total held by a config = its main address + all its buckets.
    const configTotalAda = (configId: string, mainAddr: string) =>
      adaOf(mainAddr) + (bucketAddrsByConfig.get(configId) ?? []).reduce((s, a) => s + adaOf(a), 0);

    // Rotation detection: the current board's keys would assemble to a
    // different script hash than the active one. (When no active config or
    // not all current seats have keys, we still surface "submitted/total"
    // counts — rotation is just one shape of "incomplete".)
    const currentKeyHashes = seatRows.filter((r) => r.keyHash).map((r) => (r.keyHash as string).toLowerCase()).sort();
    const expectedScriptHash = await this.computeScriptHashFromKeyHashes(currentKeyHashes).catch(() => null);
    const submitted = seatRows.filter((r) => r.hasKey).length;
    const allSubmitted = submitted === seats.length && seats.length > 0;
    const rotationInProgress = !!active && (allSubmitted ? expectedScriptHash !== active.scriptHash : true);

    // Predecessor seats: keys that are recorded but whose boardSeat is no
    // longer active. Shown in the "old multisig signers" list when the UI
    // expands a history entry.
    const inactiveKeys = await this.prisma.boardMultisigKey.findMany({
      where: { boardSeat: { removedAt: { not: null } } },
      include: { user: { select: { displayName: true } }, boardSeat: { select: { drepId: true, displayName: true } } },
    });

    const migrationsPending = await this.prisma.multisigAction.findMany({
      where: { kind: 'MIGRATION', status: { in: ['PENDING_SIGS', 'READY', 'BROADCASTED'] } },
      include: { signatures: { select: { boardDrepId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    // Confirmed migrations — a predecessor config is "terminated" on the date its funds were
    // last sent to the successor (the migration tx's paidAt). Newest paidAt per source config.
    const migrationsDone = await this.prisma.multisigAction.findMany({
      where: { kind: 'MIGRATION', status: 'CONFIRMED', fromConfigId: { not: null } },
      select: { fromConfigId: true, paidAt: true },
      orderBy: { paidAt: 'desc' },
    });
    const migratedAtByConfig = new Map<string, Date | null>();
    for (const m of migrationsDone) if (m.fromConfigId && !migratedAtByConfig.has(m.fromConfigId)) migratedAtByConfig.set(m.fromConfigId, m.paidAt);

    return {
      threshold: this.threshold,
      total: seats.length,
      submitted,
      allSubmitted,
      rotationInProgress,
      active: active
        ? {
            id: active.id,
            scriptHash: active.scriptHash,
            bech32Address: active.bech32Address,
            threshold: active.threshold,
            totalKeys: active.totalKeys,
            assembledAt: active.assembledAt,
            balanceAda: adaOf(active.bech32Address),
            signers: signersOf(active),
          }
        : null,
      history: hist.map((h) => ({
        id: h.id,
        scriptHash: h.scriptHash,
        bech32Address: h.bech32Address,
        threshold: h.threshold,
        totalKeys: h.totalKeys,
        assembledAt: h.assembledAt,
        replacedAt: h.replacedAt,
        replacedByConfigId: h.replacedByConfigId,
        balanceAda: configTotalAda(h.id, h.bech32Address), // main + buckets
        // Terminated = ALL funds emptied (main + every bucket). Date the last migration tx was
        // paid; if it never held funds, terminated as of when it was replaced. Null while any
        // address still holds a balance.
        terminatedAt: configTotalAda(h.id, h.bech32Address) === 0 ? (migratedAtByConfig.get(h.id) ?? h.replacedAt) : null,
        // Old script's key hashes — used by the UI to show "still-reachable
        // signers" when offering a migration.
        keyHashes: ((h.scriptJson as { scripts?: { keyHash: string }[] } | null)?.scripts ?? []).map((s) => s.keyHash),
      })),
      seats: seatRows,
      // Past-board members who already submitted a key — they can sign
      // migration txs out of the wallets that used their key.
      inactiveSigners: inactiveKeys.map((k) => ({
        boardSeatId: k.boardSeatId,
        userId: k.userId,
        displayName: k.user.displayName ?? k.boardSeat.displayName,
        drepId: k.boardSeat.drepId,
        keyHash: k.paymentKeyHash,
        paymentBech32: k.paymentBech32,
      })),
      migrationsPending: migrationsPending.map((a) => ({
        id: a.id,
        fromConfigId: a.fromConfigId,
        toConfigId: a.toConfigId,
        amountAda: a.amountAda ? Number(a.amountAda) / LOVELACE : null,
        status: a.status,
        approvals: a.signatures.length,
        threshold: this.threshold,
        txHash: a.txHash,
        createdAt: a.createdAt,
      })),
    };
  }

  /** Board member submits THEIR signing key (current board only). */
  async submitKey(userId: string, dto: {
    paymentBech32: string;
    hardwareAttested: boolean;
    signature: string;
    key: string;
    ts: string;
  }) {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { id: true, stakeAddress: true, drepKeyHash: true },
    });
    if (!user?.drepKeyHash) throw new ForbiddenException('board members only');
    const seat = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash } });
    if (!seat) throw new ForbiddenException('not a board seat');

    const bech = dto.paymentBech32.trim();
    if (!bech || !bech.startsWith('addr')) {
      throw new BadRequestException('paymentBech32 must be a Cardano payment address (addr… / addr_test…)');
    }
    let addr: CSL.Address;
    try { addr = CSL.Address.from_bech32(bech); } catch { throw new BadRequestException('paymentBech32 is not a valid Cardano address'); }
    if (addr.network_id() !== this.networkId) {
      throw new BadRequestException(`address is on the wrong network (need ${this.networkId === 1 ? 'Mainnet' : 'Preprod/testnet'})`);
    }
    const cred = CSL.BaseAddress.from_address(addr)?.payment_cred() ?? CSL.EnterpriseAddress.from_address(addr)?.payment_cred() ?? null;
    if (!cred) throw new BadRequestException('only base/enterprise addresses are accepted');
    const keyHashObj = cred.to_keyhash();
    if (!keyHashObj) throw new BadRequestException('the address uses a script credential — submit a key-based address (HW wallets always provide one)');
    const paymentKeyHash = keyHashObj.to_hex();

    const message = BoardMultisigService.attestationMessage({ stakeAddress: user.stakeAddress, paymentBech32: bech, ts: dto.ts });
    if (!verifyCip30Signature(dto.signature, dto.key, message, bech)) {
      throw new BadRequestException('signature did not verify against the submitted address — sign the message with the wallet that holds the multisig key');
    }

    const dup = await this.prisma.boardMultisigKey.findFirst({ where: { paymentKeyHash, boardSeatId: { not: seat.id } } });
    if (dup) throw new ConflictException('that payment key is already used by another board seat');

    await this.prisma.boardMultisigKey.upsert({
      where: { boardSeatId: seat.id },
      update: { userId, paymentKeyHash, paymentBech32: bech, hardwareAttested: !!dto.hardwareAttested, attestationSignature: dto.signature, attestationKey: dto.key, attestationTs: dto.ts, submittedAt: new Date() },
      create: { boardSeatId: seat.id, userId, paymentKeyHash, paymentBech32: bech, hardwareAttested: !!dto.hardwareAttested, attestationSignature: dto.signature, attestationKey: dto.key, attestationTs: dto.ts },
    });

    // §13.2 — providing a multisig key is board setup work: +1, once per seat.
    const myDrep = await this.prisma.drep.findUnique({ where: { userId }, select: { id: true } });
    if (myDrep) await this.merit?.tryAward(myDrep.id, 'MULTISIG_KEY_PROVIDED', seat.id);

    await this.tryAssemble();
    return this.status();
  }

  /**
   * Auto-assemble the native script + derive its address once every ACTIVE
   * seat has a key. When a new script differs from the current active one
   * (board changed / first assembly), insert a fresh MultisigConfig and
   * stamp the previous active one as replaced.
   */
  private async tryAssemble() {
    const seats = await this.prisma.boardSeat.findMany({ where: { removedAt: null }, include: { multisigKey: true }, orderBy: { addedAt: 'asc' } });
    if (seats.length === 0) return null;

    // Resolve each seat's signing key: the seat's OWN submitted key, else the member's most-recent
    // known key (a returning board member's key carries over — the same fallback status() uses to
    // pre-fill the roster). They can still change it via submitKey (which writes the seat's own key
    // and takes precedence). This keeps assembly consistent with the "X/Y keys collected" count.
    const resolved = await Promise.all(seats.map(async (s) => {
      if (s.multisigKey) return { drepId: s.drepId, keyHash: s.multisigKey.paymentKeyHash, address: s.multisigKey.paymentBech32 };
      const member = await this.prisma.appUser.findFirst({ where: { drepKeyHash: s.drepKeyHash }, select: { id: true } });
      if (!member) return null;
      const prior = await this.prisma.boardMultisigKey.findFirst({ where: { userId: member.id }, orderBy: { submittedAt: 'desc' } });
      return prior ? { drepId: s.drepId, keyHash: prior.paymentKeyHash, address: prior.paymentBech32 } : null;
    }));
    if (resolved.some((r) => !r)) return null; // some seat has no resolvable key yet
    const signers = (resolved as { drepId: string; keyHash: string; address: string | null }[]).map((r) => ({ drep: r.drepId, address: r.address ?? '' }));

    const keyHashes = (resolved as { keyHash: string }[]).map((r) => r.keyHash.toLowerCase()).sort();
    const built = this.buildNativeScript(keyHashes);

    const active = await this.active();
    if (active && active.scriptHash === built.scriptHash) return active; // no-op

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const created = await tx.multisigConfig.create({
        // §15 — 3-of-N (clamped to keys.length): only 3 of the submitted
        // board keys are needed to sign each tx. Threshold is shown to the
        // UI alongside totalKeys (e.g. "3-of-5").
        data: {
          scriptJson: built.scriptJson,
          scriptHash: built.scriptHash,
          bech32Address: built.bech32Address,
          threshold: Math.min(this.threshold, keyHashes.length),
          totalKeys: keyHashes.length,
        },
      });
      // Stamp the previous active as replaced + link to the new one.
      if (active) {
        await tx.multisigConfig.update({ where: { id: active.id }, data: { replacedAt: now, replacedByConfigId: created.id } });
      }
      return created;
    }).then(async (created) => {
      // §15.2 — on-chain proof: a new multisig was prepared (its address + every signer's DRep ID
      // and provided address). Best-effort; never blocks assembly.
      try {
        await this.anchor?.anchorMultisigNew({
          bech32Address: created.bech32Address,
          threshold: created.threshold,
          totalKeys: created.totalKeys,
          signers,
        });
      } catch { /* anchoring is best-effort */ }
      // §15.2 — the platform takes care of the hand-over: as soon as the new multisig
      // is assembled, auto-create the migration tx(s) that move the OLD board's funds
      // to the new address. The OLD board just signs them in Approve & sign. Best-effort
      // (never block assembly); the manual "Migrate funds" button remains as a fallback.
      if (active) {
        try { await this.migrateAllFundedSources(active, created); } catch { /* funds may be 0 / already queued */ }
      }
      return created;
    }).then(async (created) => {
      // §13.2 — multisig READY: +1 to every board member who contributed a key (once per config).
      const contributors = await this.prisma.boardMultisigKey.findMany({
        where: { boardSeatId: { in: seats.map((s) => s.id) } },
        select: { userId: true },
      });
      const dreps = await this.prisma.drep.findMany({
        where: { userId: { in: contributors.map((c) => c.userId) } },
        select: { id: true },
      });
      await this.merit?.awardMany(dreps.map((d) => d.id), 'MULTISIG_READY', created.id);
      return created;
    });
  }

  /**
   * §15.2 — any current board member can prepare a migration tx that moves
   * the full balance of an old multisig to the new active one. The created
   * MultisigAction is signed by the OLD board (whose keyhashes are in the
   * old script). Phase 2 of the multisig work will assemble + broadcast the
   * actual native-script tx; this turn only creates the record.
   */
  async prepareMigration(userId: string, fromConfigId: string) {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { drepKeyHash: true },
    });
    if (!user?.drepKeyHash) throw new ForbiddenException('board members only');
    const onBoard = await this.prisma.boardSeat.findFirst({ where: { removedAt: null, drepKeyHash: user.drepKeyHash } });
    if (!onBoard) throw new ForbiddenException('board members only');

    const from = await this.prisma.multisigConfig.findUnique({ where: { id: fromConfigId } });
    if (!from) throw new NotFoundException('multisig config not found');
    if (!from.replacedAt) {
      throw new ConflictException('that multisig is the current active one — nothing to migrate');
    }
    const to = await this.active();
    if (!to) throw new ConflictException('no active multisig to migrate to (assemble the new one first)');

    const summary = await this.migrateAllFundedSources(from, to);
    if (summary.created === 0 && summary.existing === 0) {
      throw new ConflictException('the old multisig (and its buckets) have no on-chain funds — nothing to migrate');
    }
    return summary;
  }

  /**
   * §15.2 — move ALL of an old config's funds to the NEW multisig's PRIMARY address: one
   * MIGRATION tx for the main script address, plus one per labeled bucket that still holds funds.
   * The new board decides later whether to (re)create buckets and split funds. Each tx is signed
   * by the OLD board (their keyhashes are in the source's script) and is idempotent per source.
   */
  private async migrateAllFundedSources(from: { id: string; bech32Address: string }, to: { id: string; bech32Address: string }) {
    const buckets = await this.prisma.treasuryBucket.findMany({ where: { configId: from.id } });
    // Sources = the main script address (no bucket) + every NON-primary bucket (the primary
    // bucket shares the main address, so it's already covered by the main source).
    const sources: { bucketId: string | null; bech32Address: string; label: string }[] = [
      { bucketId: null, bech32Address: from.bech32Address, label: 'Primary treasury' },
      ...buckets.filter((b) => !b.isPrimary).map((b) => ({ bucketId: b.id, bech32Address: b.bech32Address, label: `${b.label || 'Unnamed'} bucket` })),
    ];
    const balMap = await this.cardano.addressBalance(sources.map((s) => s.bech32Address)).catch(() => new Map<string, bigint>());
    let created = 0, existing = 0, totalAda = 0;
    for (const s of sources) {
      const r = await this.ensureMigration({ configId: from.id, ...s, balance: balMap.get(s.bech32Address) ?? 0n }, to);
      if (r.reason === 'created') { created++; totalAda += Number(r.action!.amountAda ?? 0n) / LOVELACE; }
      else if (r.reason === 'existing') existing++;
    }
    return { created, existing, totalAda };
  }

  /**
   * Idempotently create ONE MIGRATION action that empties a single source (the main address or a
   * labeled bucket) into the new multisig's primary address. Reuses an open migration for that
   * exact source; returns reason 'empty' when there's nothing on-chain to move. The tx is labelled
   * "FUND MIGRATION" in the treasury history with the source name (e.g. "Rewards bucket → …").
   */
  private async ensureMigration(
    src: { configId: string; bucketId: string | null; bech32Address: string; label: string; balance: bigint },
    to: { id: string; bech32Address: string },
  ) {
    const existing = await this.prisma.multisigAction.findFirst({
      where: { kind: 'MIGRATION', fromConfigId: src.configId, sourceBucketId: src.bucketId, status: { in: ['PENDING_SIGS', 'READY', 'BROADCASTED'] } },
    });
    if (existing) return { action: existing, reason: 'existing' as const };
    if (src.balance === 0n) return { action: null, reason: 'empty' as const };

    const action = await this.prisma.multisigAction.create({
      data: {
        kind: 'MIGRATION',
        status: 'PENDING_SIGS',
        amountAda: src.balance,
        description: `${src.label} → new primary address`,
        destAddress: to.bech32Address,
        fromConfigId: src.configId,
        sourceBucketId: src.bucketId,
        toConfigId: to.id,
      },
    });
    return { action, reason: 'created' as const };
  }

  /** Hash-only check (used by status() to detect rotation). */
  private async computeScriptHashFromKeyHashes(keyHashes: string[]): Promise<string | null> {
    if (keyHashes.length === 0) return null;
    return this.buildNativeScript(keyHashes).scriptHash;
  }

  /** §15 — 3-of-N native script: at-least 3 of the submitted board keys
   *  must sign. Pairs with the 2-phase Authorize → Sign ceremony in
   *  MultisigBroadcastService: phase 1 picks WHICH 3 sign, the tx body
   *  declares those 3 in required_signers, and the script's NOfK clause
   *  is satisfied by their 3 witnesses. */
  private buildNativeScript(keyHashes: string[]) {
    const scripts = CSL.NativeScripts.new();
    for (const kh of keyHashes) {
      const ed = CSL.Ed25519KeyHash.from_hex(kh);
      scripts.add(CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(ed)));
    }
    const required = Math.min(this.threshold, keyHashes.length);
    const nofk = CSL.ScriptNOfK.new(required, scripts);
    const top = CSL.NativeScript.new_script_n_of_k(nofk);
    const scriptHashObj = top.hash();
    const scriptHash = scriptHashObj.to_hex();
    const bech32Address = CSL.EnterpriseAddress.new(
      this.networkId,
      CSL.Credential.from_scripthash(scriptHashObj),
    ).to_address().to_bech32();
    const scriptJson = {
      type: 'atLeast' as const,
      required,
      scripts: keyHashes.map((keyHash) => ({ type: 'sig' as const, keyHash })),
    };
    return { scriptJson, scriptHash, bech32Address };
  }
}
