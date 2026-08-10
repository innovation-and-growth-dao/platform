import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drepKeyHashFromId } from '@drep-dao/cardano';

export interface DRepStatus {
  registered: boolean;
  keyHashHex: string | null; // 28-byte DRep credential, from chain
  amountLovelace: bigint; // on-chain voting power (total delegated stake), 0 if none/unknown
}

export interface AddressTx {
  hash: string;
  time: number; // unix seconds
  inLovelace: bigint; // gross lovelace the queried addresses RECEIVED in this tx
  outLovelace: bigint; // gross lovelace the queried addresses SPENT in this tx
}

/**
 * Read-only on-chain queries via Koios (free, no key). Used to verify that a
 * DRep ID is actually registered on-chain (§22.4) before seating/admitting it.
 */
@Injectable()
export class CardanoQueryService {
  private readonly logger = new Logger(CardanoQueryService.name);
  private readonly base: string;
  // Short-TTL in-memory cache for the per-DRep voting-power lookups. Without it
  // every page view of the overview re-hits Koios for N DReps + their delegators
  // and hammers the free-tier rate limit (we saw 429s after a heavy test run).
  // Single process, so a plain Map is enough; lost on restart by design.
  private readonly vpCache = new Map<string, { value: { votingPowerLovelace: bigint; delegators: number }; expiresAt: number }>();
  private readonly VP_TTL_MS = 10 * 60 * 1000;
  // Same idea for the on-chain DRep registration check, which runs on EVERY login.
  // A 60s TTL keeps role recognition fresh while collapsing repeated logins of the
  // same DRep into one Koios call (the test suite alone logs in ~10 personas many
  // times — without this it trips the public-tier 429 limit).
  private readonly drepStatusCache = new Map<string, { value: DRepStatus; expiresAt: number }>();
  private readonly DREP_STATUS_TTL_MS = 60 * 1000;
  // Treasury tx history is a heavier scan; cache per address-set so repeat opens
  // of the Transactions tab are instant (on-chain history changes slowly).
  private readonly addrTxCache = new Map<string, { value: AddressTx[]; expiresAt: number }>();
  private readonly addrTxRefreshing = new Set<string>(); // keys with a background refresh in flight
  private readonly ADDR_TX_TTL_MS = 30 * 1000;
  // How long a cold-cache request waits for the (possibly slow) db-sync query before giving up
  // and returning empty — well under the frontend's 10s fetch timeout, so a slow query surfaces
  // as a momentarily-empty list (the next auto-refresh fills it in) instead of "Cannot reach the API".
  private readonly ADDR_TX_COLD_DEADLINE_MS = 6500;
  // Short balance cache so the Actions/Treasury polls (and concurrent badge + list fetches)
  // don't each pay a fresh remote db-sync round-trip; balances change slowly.
  private readonly addrBalCache = new Map<string, { value: Map<string, bigint>; expiresAt: number }>();
  private readonly ADDR_BAL_TTL_MS = 12 * 1000;

  // Expired entries were only checked on read, never deleted — a long-running process
  // accumulated every key it ever cached (memory leak). Sweep all caches periodically.
  private readonly cacheSweeper = (() => {
    const t = setInterval(() => {
      const now = Date.now();
      for (const m of [this.vpCache, this.drepStatusCache, this.addrTxCache, this.addrBalCache] as Map<string, { expiresAt: number }>[]) {
        for (const [k, v] of m) if (v.expiresAt <= now) m.delete(k);
      }
    }, 10 * 60 * 1000);
    t.unref?.();
    return t;
  })();

  // On-chain data source — two options, chosen by CARDANO_ONCHAIN_SOURCE:
  //   'koios'  (default) → the public Koios tier
  //   'dbsync'           → our own cardano-db-sync Postgres (no rate limit), set
  //                        via DBSYNC_URL. Every db-sync read falls back to Koios
  //                        on error, so db-sync is never a hard dependency.
  private readonly onchainSource: 'koios' | 'dbsync';
  private readonly dbsyncUrl: string | undefined;
  private dbsyncPool: Pool | null = null;

  constructor(config: ConfigService) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
    this.dbsyncUrl = config.get<string>('DBSYNC_URL') || undefined;
    this.onchainSource = (config.get<string>('CARDANO_ONCHAIN_SOURCE') ?? 'koios').trim().toLowerCase() === 'dbsync'
      ? 'dbsync'
      : 'koios';
    if (this.onchainSource === 'dbsync' && !this.dbsyncUrl) {
      this.logger.warn('CARDANO_ONCHAIN_SOURCE=dbsync but DBSYNC_URL is unset — using Koios');
    }
    this.logger.log(`on-chain source: ${this.onchainSource === 'dbsync' && this.dbsyncUrl ? 'cardano-db-sync' : 'koios'}`);
  }

  /** The db-sync pool when CARDANO_ONCHAIN_SOURCE=dbsync (and DBSYNC_URL is set); null ⇒ use Koios. */
  private dbsync(): Pool | null {
    if (this.onchainSource !== 'dbsync' || !this.dbsyncUrl) return null;
    if (!this.dbsyncPool) {
      this.dbsyncPool = new Pool({ connectionString: this.dbsyncUrl, max: 4, statement_timeout: 15000 });
    }
    return this.dbsyncPool;
  }

  /** §22.4 — DRep registration + active + voting power straight from db-sync,
   *  matched by key hash (db-sync's drep_hash.view is CIP-105, our ids are
   *  CIP-129, so we convert id → key hash). Mirrors Koios /drep_info semantics:
   *  registered = has a live registration cert AND not expired (active_until ≥ tip epoch). */
  private async verifyDRepsViaDbSync(pool: Pool, drepIds: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      drepIds.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    const khToId = new Map<string, string>();
    for (const id of drepIds) {
      try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* malformed id → stays not-registered */ }
    }
    const khs = [...khToId.keys()];
    if (khs.length === 0) return out;
    const { rows } = await pool.query<{ kh: string; registered: boolean; amount: string | null; active_until: string | null; cur: string | null }>(
      // A DRep is registered if its LATEST cert is a registration or a metadata update — NOT a
      // deregistration. db-sync's drep_registration.deposit is positive for a registration, NULL
      // for an update, and negative for a deregistration; so the old `deposit IS NOT NULL` test
      // wrongly marked an *updated* DRep as unregistered (latest deposit is NULL) and a *retired*
      // one as registered. Check the cert kind instead.
      `SELECT encode(dh.raw,'hex') AS kh,
              COALESCE(reg.is_reg, false) AS registered,
              COALESCE(dd.amount,0)::text AS amount,
              dd.active_until::text AS active_until,
              (SELECT max(epoch_no) FROM block) AS cur
         FROM drep_hash dh
         LEFT JOIN LATERAL (SELECT (r.deposit IS NULL OR r.deposit >= 0) AS is_reg FROM drep_registration r
                            WHERE r.drep_hash_id = dh.id ORDER BY r.tx_id DESC, r.cert_index DESC LIMIT 1) reg ON true
         LEFT JOIN LATERAL (SELECT amount, active_until FROM drep_distr d
                            WHERE d.hash_id = dh.id ORDER BY d.epoch_no DESC LIMIT 1) dd ON true
        WHERE encode(dh.raw,'hex') = ANY($1::text[])`,
      [khs],
    );
    for (const r of rows) {
      const id = khToId.get(r.kh.toLowerCase());
      if (!id) continue;
      // A registered DRep is active unless it carries an explicit expiry epoch in
      // the past. No drep_distr row (active_until null) ⇒ recently registered / no
      // delegated stake ⇒ still active (matches Koios, which keeps it registered).
      const active = r.active_until == null || (r.cur != null && Number(r.active_until) >= Number(r.cur));
      out.set(id, { registered: !!r.registered && active, keyHashHex: r.kh, amountLovelace: BigInt(r.amount ?? '0') });
    }
    return out;
  }

  /** Voting power (drep_distr.amount) + current delegator count (latest vote-
   *  delegation per stake account that points at this DRep), straight from db-sync. */
  private async drepVotingPowerViaDbSync(pool: Pool, drepIds: string[]): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number }>> {
    const out = new Map<string, { votingPowerLovelace: bigint; delegators: number }>(
      drepIds.map((id) => [id, { votingPowerLovelace: 0n, delegators: 0 }]),
    );
    const khToId = new Map<string, string>();
    for (const id of drepIds) { try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* skip malformed */ } }
    const khs = [...khToId.keys()];
    if (khs.length === 0) return out;
    const { rows } = await pool.query<{ kh: string; amount: string; delegators: string }>(
      `WITH cur AS (
         SELECT DISTINCT ON (dv.addr_id) dv.addr_id, dv.drep_hash_id
           FROM delegation_vote dv ORDER BY dv.addr_id, dv.tx_id DESC, dv.cert_index DESC)
       SELECT encode(dh.raw,'hex') AS kh,
              COALESCE(dd.amount,0)::text AS amount,
              (SELECT count(*) FROM cur WHERE cur.drep_hash_id = dh.id)::text AS delegators
         FROM drep_hash dh
         LEFT JOIN LATERAL (SELECT amount FROM drep_distr d WHERE d.hash_id = dh.id ORDER BY d.epoch_no DESC LIMIT 1) dd ON true
        WHERE encode(dh.raw,'hex') = ANY($1::text[])`,
      [khs],
    );
    for (const r of rows) {
      const id = khToId.get(r.kh.toLowerCase());
      if (!id) continue;
      out.set(id, { votingPowerLovelace: BigInt(r.amount ?? '0'), delegators: Number(r.delegators ?? '0') });
    }
    return out;
  }

  /** Per-DRep delegator stakes from db-sync: each DRep's current vote-delegators
   *  (delegation_vote) joined to their latest epoch_stake — the basis for total
   *  power, delegator count, own (self-delegated) power, and qualifying delegators. */
  private async entryMetricsViaDbSync(
    pool: Pool,
    entries: { drepId: string; ownStakeAddress?: string }[],
    minDelegatorStakeLovelace: bigint,
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number; ownVotingPowerLovelace: bigint; qualifyingDelegators: number }>> {
    const out = new Map(entries.map((e) => [e.drepId, { votingPowerLovelace: 0n, delegators: 0, ownVotingPowerLovelace: 0n, qualifyingDelegators: 0 }]));
    const khToEntry = new Map<string, { drepId: string; ownStakeAddress?: string }>();
    for (const e of entries) { try { khToEntry.set(drepKeyHashFromId(e.drepId).toLowerCase(), e); } catch { /* skip */ } }
    const khs = [...khToEntry.keys()];
    if (khs.length === 0) return out;
    // Total voting power comes from drep_distr (the ledger's own per-DRep tally —
    // reliable). Per-delegator stake (for own/qualifying) is taken from the latest
    // epoch_stake snapshot, pinned to one epoch so the lookup stays fast.
    const { rows } = await pool.query<{ kh: string; stake_address: string | null; amount: string; total: string }>(
      `WITH cur AS (SELECT DISTINCT ON (dv.addr_id) dv.addr_id, dv.drep_hash_id
                      FROM delegation_vote dv ORDER BY dv.addr_id, dv.tx_id DESC, dv.cert_index DESC),
            le AS (SELECT max(epoch_no) en FROM epoch_stake)
       SELECT encode(dh.raw,'hex') AS kh, sa.view AS stake_address,
              COALESCE((SELECT es.amount FROM epoch_stake es WHERE es.addr_id = cur.addr_id AND es.epoch_no = (SELECT en FROM le) LIMIT 1),0)::text AS amount,
              (SELECT amount FROM drep_distr d WHERE d.hash_id = dh.id ORDER BY d.epoch_no DESC LIMIT 1)::text AS total
         FROM drep_hash dh
         LEFT JOIN cur ON cur.drep_hash_id = dh.id
         LEFT JOIN stake_address sa ON sa.id = cur.addr_id
        WHERE encode(dh.raw,'hex') = ANY($1::text[])`,
      [khs],
    );
    const byKh = new Map<string, { total: bigint; dels: { stake_address: string; amount: bigint }[] }>();
    for (const r of rows) {
      const entry = byKh.get(r.kh.toLowerCase()) ?? { total: BigInt(r.total ?? '0'), dels: [] };
      if (r.stake_address) entry.dels.push({ stake_address: r.stake_address, amount: BigInt(r.amount ?? '0') });
      byKh.set(r.kh.toLowerCase(), entry);
    }
    for (const [kh, e] of khToEntry) {
      const g = byKh.get(kh) ?? { total: 0n, dels: [] };
      let own = 0n, qualifying = 0;
      for (const d of g.dels) {
        if (e.ownStakeAddress && d.stake_address === e.ownStakeAddress) own = d.amount;
        if (d.amount >= minDelegatorStakeLovelace) qualifying++;
      }
      out.set(e.drepId, { votingPowerLovelace: g.total, delegators: g.dels.length, ownVotingPowerLovelace: own, qualifyingDelegators: qualifying });
    }
    return out;
  }

  /** Per-DRep vote counts over the most recent `windowSize` governance actions,
   *  from db-sync (voting_procedure → drep_hash); optionally only votes carrying
   *  an on-chain rationale (voting_anchor_id). */
  private async activityMetricsViaDbSync(
    pool: Pool,
    drepIds: string[],
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<Map<string, { votesInWindow: number; windowConsidered: number }>> {
    const out = new Map(drepIds.map((id) => [id, { votesInWindow: 0, windowConsidered: 0 }]));
    const khToId = new Map<string, string>();
    for (const id of drepIds) { try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* skip */ } }
    const khs = [...khToId.keys()];
    if (khs.length === 0) return out;
    const winRes = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM (SELECT id FROM gov_action_proposal ORDER BY id DESC LIMIT $1) w`,
      [Math.max(1, windowSize)],
    );
    const windowConsidered = Number(winRes.rows[0]?.n ?? '0');
    const { rows } = await pool.query<{ kh: string; votes: string }>(
      `WITH win AS (SELECT id FROM gov_action_proposal ORDER BY id DESC LIMIT $2)
       SELECT encode(dh.raw,'hex') AS kh, count(*)::text AS votes
         FROM voting_procedure vp
         JOIN drep_hash dh ON dh.id = vp.drep_voter
        WHERE vp.gov_action_proposal_id IN (SELECT id FROM win)
          AND ($3 = false OR vp.voting_anchor_id IS NOT NULL)
          AND encode(dh.raw,'hex') = ANY($1::text[])
        GROUP BY dh.raw`,
      [khs, Math.max(1, windowSize), onlyWithRationale],
    );
    for (const id of drepIds) out.set(id, { votesInWindow: 0, windowConsidered });
    for (const r of rows) {
      const id = khToId.get(r.kh.toLowerCase());
      if (id) out.set(id, { votesInWindow: Number(r.votes ?? '0'), windowConsidered });
    }
    return out;
  }

  /** §CIP-119 — on-chain DRep metadata (name + image) per drep id, via Koios. Best-effort. */
  async drepMetadata(drepIds: string[]): Promise<Map<string, { name?: string; image?: string }>> {
    const out = new Map<string, { name?: string; image?: string }>();
    if (drepIds.length === 0) return out;
    const pool = this.dbsync();
    if (pool) {
      try {
        const khToId = new Map<string, string>();
        for (const id of drepIds) { try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* skip */ } }
        const khs = [...khToId.keys()];
        if (khs.length) {
          const { rows } = await pool.query<{ kh: string; name: string | null; image: string | null }>(
            `SELECT encode(dh.raw,'hex') AS kh, d.given_name AS name, d.image_url AS image
               FROM drep_hash dh
               JOIN LATERAL (SELECT voting_anchor_id FROM drep_registration r
                             WHERE r.drep_hash_id = dh.id AND r.voting_anchor_id IS NOT NULL
                             ORDER BY r.tx_id DESC, r.cert_index DESC LIMIT 1) reg ON true
               JOIN off_chain_vote_data ocd ON ocd.voting_anchor_id = reg.voting_anchor_id
               JOIN off_chain_vote_drep_data d ON d.off_chain_vote_data_id = ocd.id
              WHERE encode(dh.raw,'hex') = ANY($1::text[])`,
            [khs],
          );
          for (const r of rows) {
            const id = khToId.get(r.kh.toLowerCase());
            if (id) out.set(id, { name: r.name ?? undefined, image: normalizeImageUri(r.image ?? undefined) });
          }
        }
        // Only trust db-sync here if it actually returned metadata. db-sync only
        // populates DRep off-chain data when its off-chain governance fetcher is
        // enabled; if it's off (no rows), fall through to Koios so names/images
        // still resolve. Low-frequency call, so the Koios hit is harmless.
        if (out.size > 0) return out;
      } catch (e) { this.logger.warn(`db-sync drep metadata failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const res = await fetch(`${this.base}/drep_metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _drep_ids: drepIds }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return out;
      const rows = (await res.json()) as { drep_id: string; meta_json: unknown }[];
      for (const r of rows) {
        const body = (r.meta_json as { body?: Record<string, unknown> })?.body;
        if (!body) continue;
        out.set(r.drep_id, { name: cip119Name(body), image: normalizeImageUri(cip119Image(body)) });
      }
    } catch (e) {
      this.logger.warn(`drep_metadata: ${e instanceof Error ? e.message : e}`);
    }
    return out;
  }

  /**
   * Like addressBalance, but returns NULL when the on-chain lookup actually
   * fails (Koios down / timeout / non-OK) instead of a 0-filled map — so callers
   * can distinguish "Koios unavailable" from "genuinely 0". Used before the
   * platform auto-prepares a hot-wallet top-up, so a transient Koios failure
   * isn't read as "empty wallet" and trigger a spurious top-up.
   */
  async addressBalanceStrict(addresses: string[]): Promise<Map<string, bigint> | null> {
    if (addresses.length === 0) return new Map();
    const pool = this.dbsync();
    if (pool) {
      try { return await this.addressBalanceViaDbSync(pool, addresses); }
      catch (e) { this.logger.warn(`db-sync address balance failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const res = await fetch(`${this.base}/address_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _addresses: addresses }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as { address: string; balance: string | null }[];
      const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
      for (const r of rows) {
        if (!out.has(r.address)) continue;
        try { out.set(r.address, r.balance ? BigInt(r.balance) : 0n); } catch { /* leave 0 */ }
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Sum of unspent tx_out at each address, straight from db-sync. */
  private async addressBalanceViaDbSync(pool: Pool, addresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
    // "unspent" = no tx_in consumes the output. This db-sync has consumed_by_tx_id tracking
    // DISABLED (never populated), so `consumed_by_tx_id IS NULL` would count every output ever
    // created — including long-spent ones — and grossly overstate the balance. tx_in is the
    // reliable spent marker (matches Koios / the real ledger UTxO set).
    const { rows } = await pool.query<{ address: string; bal: string }>(
      `SELECT o.address, COALESCE(sum(o.value),0)::text AS bal
         FROM tx_out o
        WHERE o.address = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM tx_in i WHERE i.tx_out_id = o.tx_id AND i.tx_out_index = o.index)
        GROUP BY o.address`,
      [addresses],
    );
    for (const r of rows) if (out.has(r.address)) out.set(r.address, BigInt(r.bal ?? '0'));
    return out;
  }

  /** Total controlled balance (Lovelace) per payment/base address, via Koios /address_info. */
  async addressBalance(addresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
    if (addresses.length === 0) return out;
    const key = [...addresses].sort().join(',');
    const cached = this.addrBalCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return new Map(cached.value);
    const pool = this.dbsync();
    if (pool) {
      try {
        const r = await this.addressBalanceViaDbSync(pool, addresses);
        this.addrBalCache.set(key, { value: new Map(r), expiresAt: Date.now() + this.ADDR_BAL_TTL_MS });
        return r;
      } catch (e) { this.logger.warn(`db-sync address balance failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const res = await fetch(`${this.base}/address_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _addresses: addresses }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return out;
      const rows = (await res.json()) as { address: string; balance: string | null }[];
      for (const r of rows) {
        if (!out.has(r.address)) continue;
        try {
          out.set(r.address, r.balance ? BigInt(r.balance) : 0n);
        } catch {
          /* leave 0 */
        }
      }
    } catch (e) {
      this.logger.warn(`address_info: ${e instanceof Error ? e.message : e}`);
    }
    return out;
  }

  /**
   * §16 — verify on-chain that `txHash` paid at least `minLovelace` to `toAddress`
   * (the submission-fee address). Sums the tx's outputs to that address via Koios
   * /tx_info. Best-effort: `found=false` if the tx isn't on-chain yet / Koios errors.
   */
  async verifyPayment(
    txHash: string,
    toAddress: string,
    minLovelace: bigint,
  ): Promise<{ found: boolean; paid: boolean; paidLovelace: bigint; koiosAvailable: boolean }> {
    const unavail = { found: false, paid: false, paidLovelace: 0n, koiosAvailable: false };
    const miss = { found: false, paid: false, paidLovelace: 0n, koiosAvailable: true };
    if (!txHash || !toAddress) return miss;
    const pool = this.dbsync();
    if (pool && /^[0-9a-fA-F]{64}$/.test(txHash)) {
      try {
        const { rows } = await pool.query<{ found: boolean; paid: string }>(
          `SELECT EXISTS(SELECT 1 FROM tx WHERE hash = decode($1,'hex')) AS found,
                  COALESCE((SELECT sum(o.value) FROM tx t JOIN tx_out o ON o.tx_id = t.id
                            WHERE t.hash = decode($1,'hex') AND o.address = $2),0)::text AS paid`,
          [txHash, toAddress],
        );
        if (!rows[0]?.found) return miss;
        const paid = BigInt(rows[0].paid ?? '0');
        return { found: true, paid: paid >= minLovelace, paidLovelace: paid, koiosAvailable: true };
      } catch (e) { this.logger.warn(`db-sync tx verify failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const res = await fetch(`${this.base}/tx_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _tx_hashes: [txHash] }),
        signal: AbortSignal.timeout(15000),
      });
      // 429 / 5xx / timeout = we can't tell what's on-chain right now.
      if (!res.ok) return unavail;
      const rows = (await res.json()) as { outputs?: { payment_addr?: { bech32?: string }; value?: string }[] }[];
      const tx = rows[0];
      // Empty rows array = Koios responded fine but the tx really doesn't exist (not unavailable).
      if (!tx) return miss;
      let paid = 0n;
      for (const o of tx.outputs ?? []) {
        if (o.payment_addr?.bech32 === toAddress) {
          try { paid += BigInt(o.value ?? '0'); } catch { /* ignore */ }
        }
      }
      return { found: true, paid: paid >= minLovelace, paidLovelace: paid, koiosAvailable: true };
    } catch (e) {
      this.logger.warn(`tx_info verify: ${e instanceof Error ? e.message : e}`);
      return unavail;
    }
  }

  /**
   * §16.3 — the address that funded `txHash` (its first input). Used as the destination for
   * pledge returns: the pledge goes back where it came from. Null if the tx isn't visible.
   */
  async txSenderAddress(txHash: string): Promise<string | null> {
    if (!/^[0-9a-fA-F]{64}$/.test(txHash ?? '')) return null;
    const pool = this.dbsync();
    if (pool) {
      try {
        const { rows } = await pool.query<{ address: string }>(
          `SELECT o.address FROM tx t
             JOIN tx_in i ON i.tx_in_id = t.id
             JOIN tx_out o ON o.tx_id = i.tx_out_id AND o.index = i.tx_out_index
            WHERE t.hash = decode($1,'hex') LIMIT 1`,
          [txHash],
        );
        if (rows[0]?.address) return rows[0].address;
      } catch (e) { this.logger.warn(`db-sync tx sender failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const res = await fetch(`${this.base}/tx_utxos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _tx_hashes: [txHash] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as { inputs?: { payment_addr?: { bech32?: string } }[] }[];
      return rows[0]?.inputs?.[0]?.payment_addr?.bech32 ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Treasury tx history — every tx that paid into OR spent from any of `addresses`,
   * newest first, with the gross lovelace those addresses received (`inLovelace`) and
   * spent (`outLovelace`) in that tx. `net = in - out` gives direction + amount.
   */
  async addressTransactions(addresses: string[], limit = 100): Promise<AddressTx[]> {
    if (addresses.length === 0) return [];
    const key = [...addresses].sort().join(',') + ':' + limit;
    const cached = this.addrTxCache.get(key);
    if (cached) {
      // Stale-while-revalidate: serve the cached value immediately and refresh in the background
      // if it's stale. The remote db-sync query can be slow; never block the request on it (that
      // surfaced as "Cannot reach the API" once the request passed the frontend's 10s timeout).
      if (cached.expiresAt <= Date.now() && !this.addrTxRefreshing.has(key)) {
        this.addrTxRefreshing.add(key);
        void this.fetchAddressTransactions(addresses, limit)
          .then((v) => this.addrTxCache.set(key, { value: v, expiresAt: Date.now() + this.ADDR_TX_TTL_MS }))
          .catch(() => { /* keep serving the last good value */ })
          .finally(() => this.addrTxRefreshing.delete(key));
      }
      return cached.value;
    }
    // Cold (nothing cached yet, e.g. just after a restart): fetch once, then it's always warm.
    // The db-sync query can be slow; never let it blow past the frontend's 10s timeout (which
    // surfaced as "Cannot reach the API"). Kick off (or join) the fetch, then race it against a
    // server deadline — if it lands in time, serve + cache it; otherwise return empty now and let
    // it finish in the background so the next request / auto-refresh poll serves it instantly.
    if (!this.addrTxRefreshing.has(key)) {
      this.addrTxRefreshing.add(key);
      void this.fetchAddressTransactions(addresses, limit)
        .then((v) => this.addrTxCache.set(key, { value: v, expiresAt: Date.now() + this.ADDR_TX_TTL_MS }))
        .catch(() => { /* leave the cache empty; a later request retries */ })
        .finally(() => this.addrTxRefreshing.delete(key));
    }
    const deadline = Date.now() + this.ADDR_TX_COLD_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      const ready = this.addrTxCache.get(key);
      if (ready) return ready.value;
    }
    return [];
  }

  private async fetchAddressTransactions(addresses: string[], limit: number): Promise<AddressTx[]> {
    if (addresses.length === 0) return [];
    const pool = this.dbsync();
    if (pool) {
      try {
        const { rows } = await pool.query<{ hash: string; time: string; in_amt: string; out_amt: string }>(
          `WITH ins AS (SELECT o.tx_id, sum(o.value) AS amt FROM tx_out o WHERE o.address = ANY($1::text[]) GROUP BY o.tx_id),
                -- "spent" via tx_in (the spending relation). This db-sync has consumed_by_tx_id
                -- DISABLED (never populated), so it can't be used to detect spends — every
                -- outgoing tx (incl. the anchor wallet's self-transfers) would otherwise show as
                -- incoming change. tx_in is accurate and indexed on tx_out_id.
                outs AS (SELECT i.tx_in_id AS tx_id, sum(o.value) AS amt
                           FROM tx_out o JOIN tx_in i ON i.tx_out_id = o.tx_id AND i.tx_out_index = o.index
                          WHERE o.address = ANY($1::text[])
                          GROUP BY i.tx_in_id),
                involved AS (SELECT tx_id FROM ins UNION SELECT tx_id FROM outs)
           SELECT encode(t.hash,'hex') AS hash, extract(epoch FROM b.time)::bigint::text AS time,
                  COALESCE(ins.amt,0)::text AS in_amt, COALESCE(outs.amt,0)::text AS out_amt
             FROM involved
             JOIN tx t ON t.id = involved.tx_id
             JOIN block b ON b.id = t.block_id
             LEFT JOIN ins ON ins.tx_id = involved.tx_id
             LEFT JOIN outs ON outs.tx_id = involved.tx_id
            ORDER BY b.time DESC LIMIT $2`,
          [addresses, limit],
        );
        return rows.map((r) => ({ hash: r.hash, time: Number(r.time), inLovelace: BigInt(r.in_amt || '0'), outLovelace: BigInt(r.out_amt || '0') }));
      } catch (e) { this.logger.warn(`db-sync address txs failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    // Koios: address_txs → recent tx hashes, then tx_info → per-tx in/out amounts.
    try {
      const txRes = await fetch(`${this.base}/address_txs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _addresses: addresses }), signal: AbortSignal.timeout(15000),
      });
      if (!txRes.ok) return [];
      const txRows = (await txRes.json()) as { tx_hash: string; block_time?: number }[];
      const hashes = txRows.sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0)).slice(0, limit).map((r) => r.tx_hash);
      if (hashes.length === 0) return [];
      const infoRes = await fetch(`${this.base}/tx_info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _tx_hashes: hashes }), signal: AbortSignal.timeout(15000),
      });
      if (!infoRes.ok) return [];
      const set = new Set(addresses);
      const infos = (await infoRes.json()) as {
        tx_hash: string; tx_timestamp?: number;
        outputs?: { payment_addr?: { bech32?: string }; value?: string }[];
        inputs?: { payment_addr?: { bech32?: string }; value?: string }[];
      }[];
      return infos
        .map((tx) => {
          let inLovelace = 0n, outLovelace = 0n;
          for (const o of tx.outputs ?? []) if (o.payment_addr?.bech32 && set.has(o.payment_addr.bech32)) { try { inLovelace += BigInt(o.value ?? '0'); } catch { /* skip */ } }
          for (const i of tx.inputs ?? []) if (i.payment_addr?.bech32 && set.has(i.payment_addr.bech32)) { try { outLovelace += BigInt(i.value ?? '0'); } catch { /* skip */ } }
          return { hash: tx.tx_hash, time: tx.tx_timestamp ?? 0, inLovelace, outLovelace };
        })
        .sort((a, b) => b.time - a.time);
    } catch (e) {
      this.logger.warn(`address_txs: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  /**
   * Latest protocol params in the Koios `/epoch_params` shape the tx builder
   * expects. db-sync when configured (no rate limit), else Koios. The tx-building
   * path uses this so a Koios 429 doesn't block on-chain anchoring/sweeps.
   */
  async epochParams(): Promise<Record<string, string | number>> {
    const pool = this.dbsync();
    if (pool) {
      try {
        const { rows } = await pool.query<Record<string, string | number>>(
          `SELECT min_fee_a, min_fee_b, key_deposit::text, pool_deposit::text, max_tx_size, max_val_size, coins_per_utxo_size::text
             FROM epoch_param ORDER BY epoch_no DESC LIMIT 1`,
        );
        if (rows[0]) return rows[0];
      } catch (e) { this.logger.warn(`db-sync epoch_params failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    const res = await fetch(`${this.base}/epoch_params`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`koios /epoch_params: ${res.status}`);
    return ((await res.json()) as Record<string, string | number>[])[0];
  }

  /**
   * Unspent UTxOs at the given addresses in the Koios `/address_utxos` shape
   * (tx_hash/tx_index/value). db-sync when configured, else Koios.
   */
  async addressUtxos(addresses: string[]): Promise<{ tx_hash: string; tx_index: number; value: string }[]> {
    if (addresses.length === 0) return [];
    const pool = this.dbsync();
    if (pool) {
      try {
        // "unspent" = no tx_in consumes this output. tx_in is written the instant the spending
        // tx is indexed, so this never returns an already-spent UTxO — unlike
        // consumed_by_tx_id, which db-sync populates with a lag and would yield inputs the
        // ledger rejects at submit (BadInputsUTxO).
        const { rows } = await pool.query<{ tx_hash: string; tx_index: number; value: string }>(
          `SELECT encode(t.hash,'hex') AS tx_hash, o.index AS tx_index, o.value::text AS value
             FROM tx_out o JOIN tx t ON t.id = o.tx_id
            WHERE o.address = ANY($1::text[])
              AND NOT EXISTS (SELECT 1 FROM tx_in i WHERE i.tx_out_id = o.tx_id AND i.tx_out_index = o.index)`,
          [addresses],
        );
        return rows.map((r) => ({ tx_hash: r.tx_hash, tx_index: Number(r.tx_index), value: r.value }));
      } catch (e) { this.logger.warn(`db-sync address_utxos failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    const res = await fetch(`${this.base}/address_utxos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: addresses }), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /address_utxos: ${res.status}`);
    return (await res.json()) as { tx_hash: string; tx_index: number; value: string }[];
  }

  /**
   * Controlled on-chain stake (Lovelace) per stake address, via Koios
   * /account_info `total_balance`. For a self-delegated DRep this equals their
   * voting power, and it's available immediately (no epoch lag). Best-effort:
   * returns 0 for unknown / on any Koios error (used for the dashboard).
   */
  async accountStake(stakeAddresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(stakeAddresses.map((a) => [a, 0n]));
    if (stakeAddresses.length === 0) return out;
    try {
      const res = await fetch(`${this.base}/account_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _stake_addresses: stakeAddresses }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.logger.warn(`Koios /account_info ${res.status}`);
        return out;
      }
      const rows = (await res.json()) as { stake_address: string; total_balance: string | null }[];
      for (const r of rows) {
        if (!out.has(r.stake_address)) continue;
        try {
          out.set(r.stake_address, r.total_balance ? BigInt(r.total_balance) : 0n);
        } catch {
          /* non-numeric — leave 0 */
        }
      }
    } catch (e) {
      this.logger.warn(`Koios account_info unreachable: ${e instanceof Error ? e.message : e}`);
    }
    return out;
  }

  /**
   * §4 — a DRep's on-chain VOTING power (CIP-1694 vote delegation, NOT pool
   * stake): the live sum of the controlled stake of every account that delegated
   * its vote to the DRep, plus the delegator count. Computed live from
   * /drep_delegators + /account_info so it reflects new delegations immediately
   * (drep_info.amount only updates at the epoch boundary). Best-effort → 0.
   */
  async drepVotingPower(
    drepIds: string[],
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number }>> {
    const out = new Map<string, { votingPowerLovelace: bigint; delegators: number }>();
    if (drepIds.length === 0) return out;

    // Serve from cache where we can; only hit Koios for entries that are stale.
    const now = Date.now();
    const miss: string[] = [];
    for (const id of drepIds) {
      const c = this.vpCache.get(id);
      if (c && c.expiresAt > now) out.set(id, c.value);
      else miss.push(id);
    }
    if (miss.length === 0) return out;

    // Prefer db-sync when configured — voting power from drep_distr, delegator
    // count from the current vote-delegations (delegation_vote).
    const pool = this.dbsync();
    if (pool) {
      try {
        const fromDb = await this.drepVotingPowerViaDbSync(pool, miss);
        for (const id of miss) {
          const v = fromDb.get(id)!;
          out.set(id, v);
          this.vpCache.set(id, { value: v, expiresAt: now + this.VP_TTL_MS });
        }
        return out;
      } catch (e) {
        this.logger.warn(`db-sync voting-power failed, falling back to Koios: ${e instanceof Error ? e.message : e}`);
      }
    }

    const addrsByDrep = new Map<string, string[]>();
    const allAddrs = new Set<string>();
    let anyKoiosFailure = false;
    await Promise.all(
      miss.map(async (id) => {
        try {
          const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) { anyKoiosFailure = true; return; }
          const rows = (await res.json()) as { stake_address: string }[];
          const addrs = rows.map((r) => r.stake_address).filter(Boolean);
          addrsByDrep.set(id, addrs);
          addrs.forEach((a) => allAddrs.add(a));
        } catch (e) {
          anyKoiosFailure = true;
          this.logger.warn(`drep_delegators ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );

    const stake = await this.accountStake([...allAddrs]);
    for (const id of miss) {
      const addrs = addrsByDrep.get(id) ?? [];
      let sum = 0n;
      for (const a of addrs) sum += stake.get(a) ?? 0n;
      const value = { votingPowerLovelace: sum, delegators: addrs.length };
      out.set(id, value);
      // Cache only fully-successful lookups for this DRep — a Koios failure
      // should not bake "0" into the cache and shadow real data when the rate
      // limit recovers.
      if (!anyKoiosFailure || addrsByDrep.has(id)) {
        this.vpCache.set(id, { value, expiresAt: now + this.VP_TTL_MS });
      }
    }
    return out;
  }

  /**
   * §14.1 entry gate (power/delegators): for a DRep, the OWN voting power (stake
   * self-delegated from `ownStakeAddress`) and how many delegators each delegated at
   * least `minDelegatorStakeLovelace`. Best-effort → available=false on any Koios error.
   */
  async drepEntryMetrics(
    drepId: string,
    ownStakeAddress: string,
    minDelegatorStakeLovelace: bigint,
  ): Promise<{ available: boolean; ownVotingPowerLovelace: bigint; delegators: number; qualifyingDelegators: number }> {
    const miss = { available: false, ownVotingPowerLovelace: 0n, delegators: 0, qualifyingDelegators: 0 };
    const pool = this.dbsync();
    if (pool) {
      try {
        const m = (await this.entryMetricsViaDbSync(pool, [{ drepId, ownStakeAddress }], minDelegatorStakeLovelace)).get(drepId)!;
        return { available: true, ownVotingPowerLovelace: m.ownVotingPowerLovelace, delegators: m.delegators, qualifyingDelegators: m.qualifyingDelegators };
      } catch (e) { this.logger.warn(`db-sync entry-metrics ${drepId}: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(drepId)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return miss;
      const rows = (await res.json()) as { stake_address: string }[];
      const addrs = rows.map((r) => r.stake_address).filter(Boolean);
      const stake = await this.accountStake(addrs);
      let ownVotingPowerLovelace = 0n;
      let qualifyingDelegators = 0;
      for (const a of addrs) {
        const s = stake.get(a) ?? 0n;
        if (a === ownStakeAddress) ownVotingPowerLovelace = s;
        if (s >= minDelegatorStakeLovelace) qualifyingDelegators++;
      }
      return { available: true, ownVotingPowerLovelace, delegators: addrs.length, qualifyingDelegators };
    } catch (e) {
      this.logger.warn(`drepEntryMetrics ${drepId}: ${e instanceof Error ? e.message : e}`);
      return miss;
    }
  }

  /**
   * §4/§14.1 — batch version for the member overview: per DRep, the total voting power,
   * delegator count, OWN power (self-delegated from `ownStakeAddress`), and how many
   * delegators each delegated ≥ `minDelegatorStakeLovelace`. One /drep_delegators per
   * DRep + a single batched /account_info (same cost as drepVotingPower).
   */
  async drepEntryMetricsBatch(
    entries: { drepId: string; ownStakeAddress?: string }[],
    minDelegatorStakeLovelace: bigint,
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number; ownVotingPowerLovelace: bigint; qualifyingDelegators: number }>> {
    const out = new Map(
      entries.map((e) => [e.drepId, { votingPowerLovelace: 0n, delegators: 0, ownVotingPowerLovelace: 0n, qualifyingDelegators: 0 }]),
    );
    if (entries.length === 0) return out;

    const dbsyncPool = this.dbsync();
    if (dbsyncPool) {
      try { return await this.entryMetricsViaDbSync(dbsyncPool, entries, minDelegatorStakeLovelace); }
      catch (e) { this.logger.warn(`db-sync entry-metrics failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }

    const addrsByDrep = new Map<string, string[]>();
    const allAddrs = new Set<string>();
    await Promise.all(
      entries.map(async (e) => {
        try {
          const res = await fetch(`${this.base}/drep_delegators?_drep_id=${encodeURIComponent(e.drepId)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return;
          const rows = (await res.json()) as { stake_address: string }[];
          const addrs = rows.map((r) => r.stake_address).filter(Boolean);
          addrsByDrep.set(e.drepId, addrs);
          addrs.forEach((a) => allAddrs.add(a));
        } catch (err) {
          this.logger.warn(`drep_delegators ${e.drepId}: ${err instanceof Error ? err.message : err}`);
        }
      }),
    );
    const stake = await this.accountStake([...allAddrs]);
    for (const e of entries) {
      const addrs = addrsByDrep.get(e.drepId) ?? [];
      let total = 0n;
      let own = 0n;
      let qualifying = 0;
      for (const a of addrs) {
        const s = stake.get(a) ?? 0n;
        total += s;
        if (e.ownStakeAddress && a === e.ownStakeAddress) own = s;
        if (s >= minDelegatorStakeLovelace) qualifying++;
      }
      out.set(e.drepId, { votingPowerLovelace: total, delegators: addrs.length, ownVotingPowerLovelace: own, qualifyingDelegators: qualifying });
    }
    return out;
  }

  /**
   * §14.1 entry gate (activity) — batch for the member overview: fetch the recent
   * governance-action window ONCE, then per DRep count how many of those it voted on.
   * Best-effort → a DRep's `available=false` on Koios error (treated as not-met).
   */
  async drepActivityMetricsBatch(
    drepIds: string[],
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<Map<string, { available: boolean; votesInWindow: number; windowConsidered: number }>> {
    const out = new Map(drepIds.map((id) => [id, { available: false, votesInWindow: 0, windowConsidered: 0 }]));
    if (drepIds.length === 0) return out;
    const dbsyncPool = this.dbsync();
    if (dbsyncPool) {
      try {
        const m = await this.activityMetricsViaDbSync(dbsyncPool, drepIds, windowSize, onlyWithRationale);
        for (const id of drepIds) { const v = m.get(id)!; out.set(id, { available: true, votesInWindow: v.votesInWindow, windowConsidered: v.windowConsidered }); }
        return out;
      } catch (e) { this.logger.warn(`db-sync activity-metrics failed, falling back to Koios: ${e instanceof Error ? e.message : e}`); }
    }
    let windowIds: Set<string>;
    try {
      const propRes = await fetch(`${this.base}/proposal_list`, { signal: AbortSignal.timeout(15000) });
      if (!propRes.ok) return out;
      const props = ((await propRes.json()) as { proposal_id?: string; block_time?: number }[])
        .filter((p) => p.proposal_id)
        .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0))
        .slice(0, Math.max(1, windowSize));
      windowIds = new Set(props.map((p) => p.proposal_id!));
    } catch (e) {
      this.logger.warn(`proposal_list: ${e instanceof Error ? e.message : e}`);
      return out;
    }
    await Promise.all(
      drepIds.map(async (id) => {
        try {
          const r = await fetch(`${this.base}/drep_votes?_drep_id=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (!r.ok) return; // leave available=false
          const votes = (await r.json()) as { proposal_id?: string; meta_url?: string | null }[];
          let count = 0;
          for (const v of votes) {
            if (!v.proposal_id || !windowIds.has(v.proposal_id)) continue;
            if (onlyWithRationale && !v.meta_url) continue;
            count++;
          }
          out.set(id, { available: true, votesInWindow: count, windowConsidered: windowIds.size });
        } catch (e) {
          this.logger.warn(`drep_votes ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );
    return out;
  }

  /**
   * §14.1 entry gate (activity): of the most recent `windowSize` governance actions,
   * how many the DRep voted on (optionally only votes carrying an on-chain rationale).
   * Best-effort → available=false on any Koios error.
   */
  async drepActivityMetrics(
    drepId: string,
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<{ available: boolean; votesInWindow: number; windowConsidered: number }> {
    const miss = { available: false, votesInWindow: 0, windowConsidered: 0 };
    const pool = this.dbsync();
    if (pool) {
      try { const v = (await this.activityMetricsViaDbSync(pool, [drepId], windowSize, onlyWithRationale)).get(drepId)!; return { available: true, votesInWindow: v.votesInWindow, windowConsidered: v.windowConsidered }; }
      catch (e) { this.logger.warn(`db-sync activity-metrics ${drepId}: ${e instanceof Error ? e.message : e}`); }
    }
    try {
      const propRes = await fetch(`${this.base}/proposal_list`, { signal: AbortSignal.timeout(15000) });
      if (!propRes.ok) return miss;
      const props = ((await propRes.json()) as { proposal_id?: string; block_time?: number }[])
        .filter((p) => p.proposal_id)
        .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0))
        .slice(0, Math.max(1, windowSize));
      const windowIds = new Set(props.map((p) => p.proposal_id));

      const voteRes = await fetch(`${this.base}/drep_votes?_drep_id=${encodeURIComponent(drepId)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!voteRes.ok) return miss;
      const votes = (await voteRes.json()) as { proposal_id?: string; meta_url?: string | null }[];
      let votesInWindow = 0;
      for (const v of votes) {
        if (!v.proposal_id || !windowIds.has(v.proposal_id)) continue;
        if (onlyWithRationale && !v.meta_url) continue;
        votesInWindow++;
      }
      return { available: true, votesInWindow, windowConsidered: windowIds.size };
    } catch (e) {
      this.logger.warn(`drepActivityMetrics ${drepId}: ${e instanceof Error ? e.message : e}`);
      return miss;
    }
  }

  /** For each bech32 drep id: is it a registered on-chain DRep, and its key hash. */
  async verifyDReps(drepIds: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      drepIds.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    if (drepIds.length === 0) return out;

    // Serve fresh cache hits; only query Koios for the misses.
    const now = Date.now();
    const misses: string[] = [];
    for (const id of drepIds) {
      const c = this.drepStatusCache.get(id);
      if (c && c.expiresAt > now) out.set(id, c.value);
      else misses.push(id);
    }
    if (misses.length === 0) return out;

    // Prefer our own db-sync when configured — same data, no rate limit.
    const pool = this.dbsync();
    if (pool) {
      try {
        const fromDb = await this.verifyDRepsViaDbSync(pool, misses);
        for (const id of misses) {
          const v = fromDb.get(id)!;
          out.set(id, v);
          this.drepStatusCache.set(id, { value: v, expiresAt: now + this.DREP_STATUS_TTL_MS });
        }
        return out;
      } catch (e) {
        this.logger.warn(`db-sync drep query failed, falling back to Koios: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Koios on the public tier has intermittent "fetch failed" / 5xx blips. This
    // check runs on every login, so retry a few times with backoff before giving
    // up — a transient blip should never deny a board member their role.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`${this.base}/drep_info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _drep_ids: misses }),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) { res = r; break; }
        this.logger.warn(`Koios /drep_info ${r.status} (attempt ${attempt + 1}/3)`);
      } catch (e) {
        this.logger.warn(`Koios unreachable (attempt ${attempt + 1}/3): ${e instanceof Error ? e.message : e}`);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    if (!res) {
      // exhausted retries — surface as a clean 503, never an unhandled 500.
      throw new ServiceUnavailableException('on-chain lookup failed (Koios unreachable) — please try again');
    }
    const rows = (await res.json()) as {
      drep_id: string;
      hex: string | null;
      drep_status: string | null;
      active: boolean | null;
      amount: string | null;
    }[];
    // Koios may echo a drep id in a different bech32 form (legacy CIP-105 vs CIP-129) than the
    // CIP-129 id we sent, so matching the response by the exact id STRING can silently drop a
    // genuinely-registered DRep (the symptom: a real DRep shows up as a plain "Viewer"). Match by
    // KEY HASH instead — format-agnostic, the same way the db-sync path does.
    const khToId = new Map<string, string>();
    for (const id of misses) {
      try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* malformed → skip */ }
    }
    const idForRow = (r: { drep_id: string; hex: string | null }): string | undefined => {
      if (out.has(r.drep_id)) return r.drep_id; // exact match (already the common case)
      const hex = (r.hex ?? '').toLowerCase();
      const byHex = hex ? khToId.get(hex.length === 58 ? hex.slice(2) : hex) : undefined; // drop a CIP-129 header byte if present
      if (byHex) return byHex;
      try { return khToId.get(drepKeyHashFromId(r.drep_id).toLowerCase()); } catch { return undefined; }
    };
    for (const r of rows) {
      const id = idForRow(r);
      if (!id) continue;
      // §22.4 — a DRep counts as registered only if it exists on-chain AND is
      // active (not retired, not expired). Koios omits unknown ids entirely.
      const registered = r.drep_status === 'registered' && r.active === true;
      let amountLovelace = 0n;
      try {
        amountLovelace = r.amount ? BigInt(r.amount) : 0n;
      } catch {
        /* non-numeric — leave 0 */
      }
      out.set(id, { registered, keyHashHex: r.hex, amountLovelace });
    }
    // Cache every miss we just resolved — including ids Koios omitted (left at the
    // not-registered default) so we don't re-query unknown DReps each login.
    for (const id of misses) {
      this.drepStatusCache.set(id, { value: out.get(id)!, expiresAt: now + this.DREP_STATUS_TTL_MS });
    }
    return out;
  }
}

/** CIP-119 fields can be a plain string or a `{ "@value": ... }` object. */
function cip119Str(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { '@value'?: unknown })['@value'] === 'string') {
    return (v as { '@value': string })['@value'];
  }
  return undefined;
}
function cip119Name(body: Record<string, unknown>): string | undefined {
  return cip119Str(body.givenName) ?? cip119Str(body.name);
}
function cip119Image(body: Record<string, unknown>): string | undefined {
  const img = body.image;
  if (typeof img === 'string') return img;
  if (img && typeof img === 'object') return cip119Str((img as { contentUrl?: unknown }).contentUrl);
  return undefined;
}
/** Only allow http(s)/ipfs images; map ipfs:// to a public gateway. */
function normalizeImageUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice('ipfs://'.length)}`;
  if (uri.startsWith('https://') || uri.startsWith('http://')) return uri;
  return undefined;
}
