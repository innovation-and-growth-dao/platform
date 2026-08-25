import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { decryptSecret } from '../common/secret-cipher';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drepKeyHashFromId } from '@drep-dao/cardano';
import { PrismaService } from '../prisma/prisma.service';
import { blockfrostDrepStatus, blockfrostLovelace, type BlockfrostDRepRow } from './blockfrost-map';

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

  // §22 — On-chain data source is board-configurable at runtime (My area → Platform setup →
  // On-chain data source). We keep an ordered list of sources (tried first→last per read),
  // an optional Koios API token (higher rate limits), a Blockfrost key, and a db-sync URL.
  // Values are read from the DB (platform_config / platform_secret) with env fallback, refreshed
  // on a timer so a change takes effect within ~30s without a restart. Env seeds the values so a
  // fresh boot works before the first DB read.
  private order: string[] = ['koios'];
  private koiosToken = '';
  private blockfrostKey = '';
  private dbsyncUrl = '';
  private dbsyncPool: Pool | null = null;
  private dbsyncPoolUrl = '';

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const net = config.get<string>('CARDANO_NETWORK') ?? 'Preprod';
    this.base =
      net === 'Mainnet'
        ? 'https://api.koios.rest/api/v1'
        : net === 'Preview'
          ? 'https://preview.koios.rest/api/v1'
          : 'https://preprod.koios.rest/api/v1';
    this.blockfrostBase =
      net === 'Mainnet'
        ? 'https://cardano-mainnet.blockfrost.io/api/v0'
        : net === 'Preview'
          ? 'https://cardano-preview.blockfrost.io/api/v0'
          : 'https://cardano-preprod.blockfrost.io/api/v0';
    // Seed from env, then load the DB overrides.
    this.koiosToken = config.get<string>('KOIOS_API_TOKEN')?.trim() || '';
    this.blockfrostKey = config.get<string>('BLOCKFROST_PROJECT_ID')?.trim() || '';
    this.dbsyncUrl = config.get<string>('DBSYNC_URL')?.trim() || '';
    const envSrc = (config.get<string>('CARDANO_ONCHAIN_SOURCE') ?? '').trim().toLowerCase();
    this.order = envSrc === 'dbsync' ? ['dbsync', 'koios'] : ['koios'];
    void this.refreshConfig();
    const t = setInterval(() => void this.refreshConfig(), 30_000);
    t.unref?.();
  }
  private readonly blockfrostBase: string;

  /** Re-read the source order + credentials from the DB (env fallback). Best-effort. */
  private async refreshConfig(): Promise<void> {
    try {
      const [orderRow, kt, bf, dbs] = await Promise.all([
        this.prisma.platformConfig.findUnique({ where: { key: 'CARDANO_ONCHAIN_ORDER' } }),
        this.prisma.platformSecret.findUnique({ where: { key: 'KOIOS_API_TOKEN' } }),
        this.prisma.platformSecret.findUnique({ where: { key: 'BLOCKFROST_PROJECT_ID' } }),
        this.prisma.platformSecret.findUnique({ where: { key: 'DBSYNC_URL' } }),
      ]);
      const parsed = (typeof orderRow?.value === 'string' ? orderRow.value : '')
        .split(',').map((s) => s.trim().toLowerCase())
        .filter((s) => s === 'koios' || s === 'blockfrost' || s === 'dbsync');
      if (parsed.length) this.order = [...new Set(parsed)];
      this.koiosToken = decryptSecret(kt?.value)?.trim() || process.env.KOIOS_API_TOKEN?.trim() || '';
      this.blockfrostKey = decryptSecret(bf?.value)?.trim() || process.env.BLOCKFROST_PROJECT_ID?.trim() || '';
      this.dbsyncUrl = decryptSecret(dbs?.value)?.trim() || process.env.DBSYNC_URL?.trim() || '';
    } catch {
      /* keep the last-known config on a transient DB hiccup */
    }
  }

  /** A Koios fetch — prepends the base and adds the Bearer token when one is configured. */
  private koiosFetch(pathAndQuery: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
    if (this.koiosToken) headers['Authorization'] = `Bearer ${this.koiosToken}`;
    return fetch(`${this.base}${pathAndQuery}`, { ...init, headers });
  }

  /** A Blockfrost fetch — prepends the base and adds the project_id header. Throws if no key. */
  private async blockfrostFetch(pathAndQuery: string, init?: RequestInit): Promise<Response> {
    if (!this.blockfrostKey) throw new Error('Blockfrost not configured');
    const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}), project_id: this.blockfrostKey };
    return fetch(`${this.blockfrostBase}${pathAndQuery}`, { ...init, headers });
  }

  /**
   * §22 — run one read against the configured sources in priority order; the first that succeeds
   * wins. A source with no implementation, or one that can't run (Blockfrost with no key, db-sync
   * with no URL), is skipped. If every source throws, the last error is re-thrown so the caller's
   * existing catch/degrade path still applies. Koios is always attempted as a final safety net.
   */
  private async fromSources<T>(
    label: string,
    impls: { koios?: () => Promise<T>; blockfrost?: () => Promise<T>; dbsync?: () => Promise<T> },
  ): Promise<T> {
    const seq = this.order.includes('koios') ? this.order : [...this.order, 'koios'];
    let lastErr: unknown = new Error(`${label}: no source available`);
    for (const src of seq) {
      const impl = impls[src as 'koios' | 'blockfrost' | 'dbsync'];
      if (!impl) continue;
      if (src === 'blockfrost' && !this.blockfrostKey) continue;
      if (src === 'dbsync' && !this.dbsync()) continue;
      try {
        return await impl();
      } catch (e) {
        lastErr = e;
        this.logger.warn(`${label}: ${src} failed → next source: ${e instanceof Error ? e.message : e}`);
      }
    }
    throw lastErr;
  }

  /** The db-sync pool when db-sync is in the source order and a URL is set; null ⇒ don't use it.
   *  Rebuilds the pool if the URL changed (admin edited it). */
  private dbsync(): Pool | null {
    if (!this.order.includes('dbsync') || !this.dbsyncUrl) return null;
    if (!this.dbsyncPool || this.dbsyncPoolUrl !== this.dbsyncUrl) {
      void this.dbsyncPool?.end().catch(() => undefined);
      this.dbsyncPool = new Pool({ connectionString: this.dbsyncUrl, max: 4, statement_timeout: 15000 });
      this.dbsyncPoolUrl = this.dbsyncUrl;
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
    if (drepIds.length === 0) return new Map();
    // db-sync only populates DRep off-chain data when its governance fetcher is on;
    // if that source returns nothing it's treated as a failure so we fall through.
    try {
      return await this.fromSources('drepMetadata', {
        koios: () => this.drepMetadataViaKoios(drepIds),
        blockfrost: () => this.drepMetadataViaBlockfrost(drepIds),
        dbsync: () => this.drepMetadataViaDbSync(this.dbsync()!, drepIds),
      });
    } catch (e) {
      this.logger.warn(`drepMetadata — all sources failed: ${e instanceof Error ? e.message : e}`);
      return new Map();
    }
  }

  private async drepMetadataViaKoios(drepIds: string[]): Promise<Map<string, { name?: string; image?: string }>> {
    const out = new Map<string, { name?: string; image?: string }>();
    const res = await this.koiosFetch(`/drep_metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _drep_ids: drepIds }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /drep_metadata ${res.status}`);
    const rows = (await res.json()) as { drep_id: string; meta_json: unknown }[];
    for (const r of rows) {
      const body = (r.meta_json as { body?: Record<string, unknown> })?.body;
      if (!body) continue;
      out.set(r.drep_id, { name: cip119Name(body), image: normalizeImageUri(cip119Image(body)) });
    }
    return out;
  }

  /** CIP-119 metadata via Blockfrost `GET /governance/dreps/{id}/metadata` (json_metadata.body). */
  private async drepMetadataViaBlockfrost(drepIds: string[]): Promise<Map<string, { name?: string; image?: string }>> {
    const out = new Map<string, { name?: string; image?: string }>();
    await Promise.all(drepIds.map(async (id) => {
      const r = await this.blockfrostFetch(`/governance/dreps/${encodeURIComponent(id)}/metadata`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return; // no anchor / no metadata registered
      if (!r.ok) throw new Error(`Blockfrost /governance/dreps/metadata ${r.status}`);
      const row = (await r.json()) as { json_metadata?: { body?: Record<string, unknown> } | null };
      const body = row.json_metadata?.body;
      if (!body) return;
      out.set(id, { name: cip119Name(body), image: normalizeImageUri(cip119Image(body)) });
    }));
    return out;
  }

  private async drepMetadataViaDbSync(pool: Pool, drepIds: string[]): Promise<Map<string, { name?: string; image?: string }>> {
    const out = new Map<string, { name?: string; image?: string }>();
    const khToId = new Map<string, string>();
    for (const id of drepIds) { try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* skip */ } }
    const khs = [...khToId.keys()];
    if (!khs.length) return out;
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
    // db-sync's off-chain fetcher may be off → no rows. Treat empty as a failure so
    // fromSources falls through to Koios/Blockfrost, which still resolve names/images.
    if (out.size === 0) throw new Error('db-sync returned no DRep metadata');
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
    try {
      return await this.fromSources('addressBalance', {
        koios: () => this.addressBalanceViaKoios(addresses),
        blockfrost: () => this.addressBalanceViaBlockfrost(addresses),
        dbsync: () => this.addressBalanceViaDbSync(this.dbsync()!, addresses),
      });
    } catch {
      return null; // strict caller wants null (not a throw) when no source can answer
    }
  }

  /** Address balance via Koios /address_info. */
  private async addressBalanceViaKoios(addresses: string[]): Promise<Map<string, bigint>> {
    const res = await this.koiosFetch(`/address_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: addresses }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /address_info: ${res.status}`);
    const rows = (await res.json()) as { address: string; balance: string | null }[];
    const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
    for (const r of rows) {
      if (!out.has(r.address)) continue;
      try { out.set(r.address, r.balance ? BigInt(r.balance) : 0n); } catch { /* leave 0 */ }
    }
    return out;
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
    try {
      const r = await this.fromSources('addressBalance', {
        koios: () => this.addressBalanceViaKoios(addresses),
        blockfrost: () => this.addressBalanceViaBlockfrost(addresses),
        dbsync: () => this.addressBalanceViaDbSync(this.dbsync()!, addresses),
      });
      this.addrBalCache.set(key, { value: new Map(r), expiresAt: Date.now() + this.ADDR_BAL_TTL_MS });
      return r;
    } catch (e) {
      // best-effort read (dashboard) — return zeros rather than throwing.
      this.logger.warn(`addressBalance: all sources failed: ${e instanceof Error ? e.message : e}`);
      return out;
    }
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
    if (!txHash || !toAddress) return { found: false, paid: false, paidLovelace: 0n, koiosAvailable: true };
    // `koiosAvailable` = "some on-chain source could answer". A source that responds
    // "tx not found" IS available (found:false, available:true); only unreachability
    // (429 / 5xx / timeout on every source) yields available:false.
    try {
      const r = await this.fromSources('verifyPayment', {
        koios: () => this.verifyPaymentViaKoios(txHash, toAddress, minLovelace),
        blockfrost: () => this.verifyPaymentViaBlockfrost(txHash, toAddress, minLovelace),
        dbsync: () => this.verifyPaymentViaDbSync(this.dbsync()!, txHash, toAddress, minLovelace),
      });
      return { ...r, koiosAvailable: true };
    } catch (e) {
      this.logger.warn(`verifyPayment — all sources failed: ${e instanceof Error ? e.message : e}`);
      return { found: false, paid: false, paidLovelace: 0n, koiosAvailable: false };
    }
  }

  private async verifyPaymentViaDbSync(pool: Pool, txHash: string, toAddress: string, minLovelace: bigint): Promise<{ found: boolean; paid: boolean; paidLovelace: bigint }> {
    if (!/^[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('non-hex tx hash'); // let another source try
    const { rows } = await pool.query<{ found: boolean; paid: string }>(
      `SELECT EXISTS(SELECT 1 FROM tx WHERE hash = decode($1,'hex')) AS found,
              COALESCE((SELECT sum(o.value) FROM tx t JOIN tx_out o ON o.tx_id = t.id
                        WHERE t.hash = decode($1,'hex') AND o.address = $2),0)::text AS paid`,
      [txHash, toAddress],
    );
    if (!rows[0]?.found) return { found: false, paid: false, paidLovelace: 0n };
    const paid = BigInt(rows[0].paid ?? '0');
    return { found: true, paid: paid >= minLovelace, paidLovelace: paid };
  }

  /**
   * §16.3 — the address that funded `txHash` (its first input). Used as the destination for
   * pledge returns: the pledge goes back where it came from. Null if the tx isn't visible.
   */
  async txSenderAddress(txHash: string): Promise<string | null> {
    if (!/^[0-9a-fA-F]{64}$/.test(txHash ?? '')) return null;
    try {
      return await this.fromSources('txSenderAddress', {
        koios: () => this.txSenderViaKoios(txHash),
        blockfrost: () => this.txSenderViaBlockfrost(txHash),
        dbsync: () => this.txSenderViaDbSync(this.dbsync()!, txHash),
      });
    } catch (e) {
      this.logger.warn(`txSenderAddress — all sources failed: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private async txSenderViaDbSync(pool: Pool, txHash: string): Promise<string | null> {
    const { rows } = await pool.query<{ address: string }>(
      `SELECT o.address FROM tx t
         JOIN tx_in i ON i.tx_in_id = t.id
         JOIN tx_out o ON o.tx_id = i.tx_out_id AND o.index = i.tx_out_index
        WHERE t.hash = decode($1,'hex') LIMIT 1`,
      [txHash],
    );
    return rows[0]?.address ?? null;
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
    try {
      return await this.fromSources('addressTransactions', {
        koios: () => this.addressTxsViaKoios(addresses, limit),
        blockfrost: () => this.addressTxsViaBlockfrost(addresses, limit),
        dbsync: () => this.addressTxsViaDbSync(this.dbsync()!, addresses, limit),
      });
    } catch (e) {
      this.logger.warn(`addressTransactions — all sources failed: ${e instanceof Error ? e.message : e}`);
      return [];
    }
  }

  private async addressTxsViaDbSync(pool: Pool, addresses: string[], limit: number): Promise<AddressTx[]> {
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
  }

  /**
   * Latest protocol params in the Koios `/epoch_params` shape the tx builder
   * expects. db-sync when configured (no rate limit), else Koios. The tx-building
   * path uses this so a Koios 429 doesn't block on-chain anchoring/sweeps.
   */
  async epochParams(): Promise<Record<string, string | number>> {
    return this.fromSources('epochParams', {
      koios: async () => {
        const res = await this.koiosFetch(`/epoch_params`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`koios /epoch_params: ${res.status}`);
        return ((await res.json()) as Record<string, string | number>[])[0];
      },
      blockfrost: () => this.epochParamsViaBlockfrost(),
      dbsync: async () => {
        const { rows } = await this.dbsync()!.query<Record<string, string | number>>(
          `SELECT min_fee_a, min_fee_b, key_deposit::text, pool_deposit::text, max_tx_size, max_val_size, coins_per_utxo_size::text
             FROM epoch_param ORDER BY epoch_no DESC LIMIT 1`,
        );
        if (!rows[0]) throw new Error('db-sync epoch_param empty');
        return rows[0];
      },
    });
  }

  /**
   * Unspent UTxOs at the given addresses in the Koios `/address_utxos` shape
   * (tx_hash/tx_index/value). db-sync when configured, else Koios.
   */
  async addressUtxos(addresses: string[]): Promise<{ tx_hash: string; tx_index: number; value: string }[]> {
    if (addresses.length === 0) return [];
    // Used to BUILD txs, so a wrong/empty answer risks BadInputsUTxO — never swallow a
    // total failure here; let it throw so the caller aborts rather than builds on nothing.
    return this.fromSources('addressUtxos', {
      koios: () => this.addressUtxosViaKoios(addresses),
      blockfrost: () => this.addressUtxosViaBlockfrost(addresses),
      dbsync: () => this.addressUtxosViaDbSync(this.dbsync()!, addresses),
    });
  }

  private async addressUtxosViaDbSync(pool: Pool, addresses: string[]): Promise<{ tx_hash: string; tx_index: number; value: string }[]> {
    // "unspent" = no tx_in consumes this output. tx_in is written the instant the spending
    // tx is indexed, so this never returns an already-spent UTxO — unlike consumed_by_tx_id,
    // which db-sync populates with a lag and would yield inputs the ledger rejects (BadInputsUTxO).
    const { rows } = await pool.query<{ tx_hash: string; tx_index: number; value: string }>(
      `SELECT encode(t.hash,'hex') AS tx_hash, o.index AS tx_index, o.value::text AS value
         FROM tx_out o JOIN tx t ON t.id = o.tx_id
        WHERE o.address = ANY($1::text[])
          AND NOT EXISTS (SELECT 1 FROM tx_in i WHERE i.tx_out_id = o.tx_id AND i.tx_out_index = o.index)`,
      [addresses],
    );
    return rows.map((r) => ({ tx_hash: r.tx_hash, tx_index: Number(r.tx_index), value: r.value }));
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
      return await this.fromSources('accountStake', {
        koios: () => this.accountStakeViaKoios(stakeAddresses),
        blockfrost: () => this.accountStakeViaBlockfrost(stakeAddresses),
      });
    } catch (e) {
      // best-effort (dashboard) — zeros rather than throwing.
      this.logger.warn(`accountStake: all sources failed: ${e instanceof Error ? e.message : e}`);
      return out;
    }
  }

  /** Controlled stake per stake address via Koios /account_info total_balance. */
  private async accountStakeViaKoios(stakeAddresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(stakeAddresses.map((a) => [a, 0n]));
    // Koios caps the number of addresses per /account_info request — chunk so large
    // delegator sets don't get rejected (which previously zeroed a DRep's voting power).
    const CHUNK = 50;
    for (let i = 0; i < stakeAddresses.length; i += CHUNK) {
      const batch = stakeAddresses.slice(i, i + CHUNK);
      const res = await this.koiosFetch(`/account_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _stake_addresses: batch }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`koios /account_info: ${res.status}`);
      const rows = (await res.json()) as { stake_address: string; total_balance: string | null }[];
      for (const r of rows) {
        if (!out.has(r.stake_address)) continue;
        try { out.set(r.stake_address, r.total_balance ? BigInt(r.total_balance) : 0n); } catch { /* leave 0 */ }
      }
    }
    return out;
  }

  /**
   * §4 — a DRep's total on-chain voting power + delegator count, straight from Koios
   * `drep_info` (a single batched call). This is the epoch-boundary figure the whole
   * ecosystem shows; it's reliable even for DReps with thousands of delegators, unlike
   * summing every delegator's stake live (which Koios can't do in one shot).
   */
  private async drepInfoBatchKoios(drepIds: string[]): Promise<Map<string, { amount: bigint; delegators: number }>> {
    const out = new Map<string, { amount: bigint; delegators: number }>();
    if (drepIds.length === 0) return out;
    const res = await this.koiosFetch(`/drep_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _drep_ids: drepIds }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /drep_info: ${res.status}`);
    const rows = (await res.json()) as { drep_id: string; amount: string | null; live_delegator_count: number | null }[];
    for (const r of rows) {
      let amount = 0n;
      try { amount = r.amount ? BigInt(r.amount) : 0n; } catch { amount = 0n; }
      out.set(r.drep_id, { amount, delegators: Number(r.live_delegator_count ?? 0) });
    }
    return out;
  }

  /** All vote-delegator stake addresses of a DRep via Koios (paginated, 1000/page). */
  private async drepDelegatorAddrsKoios(drepId: string): Promise<string[]> {
    const all: string[] = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const res = await this.koiosFetch(`/drep_delegators?_drep_id=${encodeURIComponent(drepId)}&offset=${offset}&limit=1000`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`koios /drep_delegators ${res.status}`);
      const rows = (await res.json()) as { stake_address: string }[];
      for (const r of rows) if (r.stake_address) all.push(r.stake_address);
      if (rows.length < 1000) break;
    }
    return all;
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

    // §22 — tried in the admin-configured order (Koios → Blockfrost → db-sync by
    // default), first source that answers wins. A total failure leaves zeros for
    // the missing DReps (best-effort) and is NOT cached, so real data returns once
    // a source recovers.
    try {
      const fromSource = await this.fromSources('drepVotingPower', {
        koios: () => this.drepVotingPowerViaKoios(miss),
        blockfrost: () => this.drepVotingPowerViaBlockfrost(miss),
        dbsync: () => this.drepVotingPowerViaDbSync(this.dbsync()!, miss),
      });
      for (const id of miss) {
        const value = fromSource.get(id) ?? { votingPowerLovelace: 0n, delegators: 0 };
        out.set(id, value);
        this.vpCache.set(id, { value, expiresAt: now + this.VP_TTL_MS });
      }
    } catch (e) {
      this.logger.warn(`drepVotingPower — all sources failed: ${e instanceof Error ? e.message : e}`);
      for (const id of miss) out.set(id, { votingPowerLovelace: 0n, delegators: 0 });
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
    try {
      const m = await this.fromSources('drepEntryMetrics', {
        koios: () => this.entryMetricsViaKoios([{ drepId, ownStakeAddress }], minDelegatorStakeLovelace),
        blockfrost: () => this.entryMetricsViaBlockfrost([{ drepId, ownStakeAddress }], minDelegatorStakeLovelace),
        dbsync: () => this.entryMetricsViaDbSync(this.dbsync()!, [{ drepId, ownStakeAddress }], minDelegatorStakeLovelace),
      });
      const e = m.get(drepId)!;
      return { available: true, ownVotingPowerLovelace: e.ownVotingPowerLovelace, delegators: e.delegators, qualifyingDelegators: e.qualifyingDelegators };
    } catch (e) {
      this.logger.warn(`drepEntryMetrics ${drepId} — all sources failed: ${e instanceof Error ? e.message : e}`);
      return { available: false, ownVotingPowerLovelace: 0n, delegators: 0, qualifyingDelegators: 0 };
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

    // §22 — configured source order (Koios → Blockfrost → db-sync). Best-effort:
    // total failure leaves the zero-initialised map so the entry gate treats it as
    // "not yet met" rather than erroring the member overview.
    try {
      return await this.fromSources('drepEntryMetrics', {
        koios: () => this.entryMetricsViaKoios(entries, minDelegatorStakeLovelace),
        blockfrost: () => this.entryMetricsViaBlockfrost(entries, minDelegatorStakeLovelace),
        dbsync: () => this.entryMetricsViaDbSync(this.dbsync()!, entries, minDelegatorStakeLovelace),
      });
    } catch (e) {
      this.logger.warn(`drepEntryMetrics — all sources failed: ${e instanceof Error ? e.message : e}`);
      return out;
    }
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
    try {
      const m = await this.fromSources('drepActivityMetrics', {
        koios: () => this.activityMetricsViaKoios(drepIds, windowSize, onlyWithRationale),
        blockfrost: () => this.activityMetricsViaBlockfrost(drepIds, windowSize, onlyWithRationale),
        dbsync: () => this.activityMetricsViaDbSync(this.dbsync()!, drepIds, windowSize, onlyWithRationale),
      });
      for (const id of drepIds) { const v = m.get(id)!; out.set(id, { available: true, votesInWindow: v.votesInWindow, windowConsidered: v.windowConsidered }); }
    } catch (e) {
      this.logger.warn(`drepActivityMetrics — all sources failed: ${e instanceof Error ? e.message : e}`);
    }
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
    try {
      const v = (await this.fromSources('drepActivityMetrics', {
        koios: () => this.activityMetricsViaKoios([drepId], windowSize, onlyWithRationale),
        blockfrost: () => this.activityMetricsViaBlockfrost([drepId], windowSize, onlyWithRationale),
        dbsync: () => this.activityMetricsViaDbSync(this.dbsync()!, [drepId], windowSize, onlyWithRationale),
      })).get(drepId)!;
      return { available: true, votesInWindow: v.votesInWindow, windowConsidered: v.windowConsidered };
    } catch (e) {
      this.logger.warn(`drepActivityMetrics ${drepId} — all sources failed: ${e instanceof Error ? e.message : e}`);
      return { available: false, votesInWindow: 0, windowConsidered: 0 };
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

    // §22 — try the configured sources in priority order (default koios). Each impl returns a
    // full map for the misses; the first source that answers wins.
    try {
      const resolved = await this.fromSources('verifyDReps', {
        koios: () => this.verifyDRepsViaKoios(misses),
        blockfrost: () => this.verifyDRepsViaBlockfrost(misses),
        dbsync: () => this.verifyDRepsViaDbSync(this.dbsync()!, misses),
      });
      for (const id of misses) {
        const v = resolved.get(id) ?? { registered: false, keyHashHex: null, amountLovelace: 0n };
        out.set(id, v);
        // Cache every resolved miss — including ids omitted (left not-registered) so we don't
        // re-query unknown DReps each login.
        this.drepStatusCache.set(id, { value: v, expiresAt: now + this.DREP_STATUS_TTL_MS });
      }
      return out;
    } catch (e) {
      // exhausted every source — surface as a clean 503, never an unhandled 500.
      this.logger.warn(`verifyDReps: all sources failed: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('on-chain lookup failed — please try again');
    }
  }

  /** §22.4 DRep registration via Koios /drep_info (batch). Throws if Koios is unreachable so the
   *  ordered fallback moves on. Matches by key hash (CIP-105/129 agnostic). */
  private async verifyDRepsViaKoios(misses: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      misses.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    // Koios's public tier has intermittent 5xx blips; this runs on every login, so retry a few
    // times with backoff — a transient blip should never deny a board member their role.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await this.koiosFetch(`/drep_info`, {
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
    if (!res) throw new Error('Koios /drep_info unreachable');
    const rows = (await res.json()) as {
      drep_id: string; hex: string | null; drep_status: string | null; active: boolean | null; amount: string | null;
    }[];
    // Koios may echo a drep id in a different bech32 form (CIP-105 vs CIP-129) than we sent, so
    // match by KEY HASH (format-agnostic) rather than the exact id string.
    const khToId = new Map<string, string>();
    for (const id of misses) { try { khToId.set(drepKeyHashFromId(id).toLowerCase(), id); } catch { /* skip */ } }
    const idForRow = (r: { drep_id: string; hex: string | null }): string | undefined => {
      if (out.has(r.drep_id)) return r.drep_id;
      const hex = (r.hex ?? '').toLowerCase();
      const byHex = hex ? khToId.get(hex.length === 58 ? hex.slice(2) : hex) : undefined;
      if (byHex) return byHex;
      try { return khToId.get(drepKeyHashFromId(r.drep_id).toLowerCase()); } catch { return undefined; }
    };
    for (const r of rows) {
      const id = idForRow(r);
      if (!id) continue;
      const registered = r.drep_status === 'registered' && r.active === true;
      let amountLovelace = 0n;
      try { amountLovelace = r.amount ? BigInt(r.amount) : 0n; } catch { /* leave 0 */ }
      out.set(id, { registered, keyHashHex: r.hex, amountLovelace });
    }
    return out;
  }

  /** §22.4 DRep registration via Blockfrost — one GET /governance/dreps/{id} per id (404 ⇒ not a
   *  DRep). The pure blockfrostDrepStatus mapping matches Koios (registered = active & !retired &
   *  !expired) so a DRep is recognised identically whichever source answers. */
  private async verifyDRepsViaBlockfrost(misses: string[]): Promise<Map<string, DRepStatus>> {
    const out = new Map<string, DRepStatus>(
      misses.map((id) => [id, { registered: false, keyHashHex: null, amountLovelace: 0n }]),
    );
    await Promise.all(misses.map(async (id) => {
      const r = await this.blockfrostFetch(`/governance/dreps/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return; // unknown id → not a registered DRep (keep default)
      if (!r.ok) throw new Error(`Blockfrost /governance/dreps ${r.status}`);
      out.set(id, blockfrostDrepStatus((await r.json()) as BlockfrostDRepRow));
    }));
    return out;
  }

  /** Controlled stake per stake address via Blockfrost /accounts/{stake} (404 ⇒ 0). */
  private async accountStakeViaBlockfrost(stakeAddresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(stakeAddresses.map((a) => [a, 0n]));
    await Promise.all(stakeAddresses.map(async (a) => {
      const r = await this.blockfrostFetch(`/accounts/${encodeURIComponent(a)}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return; // never seen → 0
      if (!r.ok) throw new Error(`Blockfrost /accounts ${r.status}`);
      const d = (await r.json()) as { controlled_amount?: string };
      try { out.set(a, d.controlled_amount ? BigInt(d.controlled_amount) : 0n); } catch { /* leave 0 */ }
    }));
    return out;
  }

  /** Total balance (lovelace) per address via Blockfrost /addresses/{addr} (404 ⇒ 0). */
  private async addressBalanceViaBlockfrost(addresses: string[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>(addresses.map((a) => [a, 0n]));
    await Promise.all(addresses.map(async (a) => {
      const r = await this.blockfrostFetch(`/addresses/${encodeURIComponent(a)}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return; // never used → 0
      if (!r.ok) throw new Error(`Blockfrost /addresses ${r.status}`);
      const d = (await r.json()) as { amount?: { unit: string; quantity: string }[] };
      out.set(a, blockfrostLovelace(d.amount));
    }));
    return out;
  }

  /** All vote-delegators of a DRep via Blockfrost (paginated) — {stakeAddress, amount}. */
  private async drepDelegatorsBlockfrost(drepId: string): Promise<{ stakeAddress: string; amount: bigint }[]> {
    const all: { stakeAddress: string; amount: bigint }[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await this.blockfrostFetch(`/governance/dreps/${encodeURIComponent(drepId)}/delegators?count=100&page=${page}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) break; // unknown drep → no delegators
      if (!r.ok) throw new Error(`Blockfrost /governance/dreps/delegators ${r.status}`);
      const rows = (await r.json()) as { address: string; amount: string }[];
      for (const row of rows) {
        let amount = 0n;
        try { amount = BigInt(row.amount); } catch { amount = 0n; }
        all.push({ stakeAddress: row.address, amount });
      }
      if (rows.length < 100) break;
    }
    return all;
  }

  private async drepVotingPowerViaBlockfrost(drepIds: string[]): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number }>> {
    const out = new Map<string, { votingPowerLovelace: bigint; delegators: number }>();
    await Promise.all(drepIds.map(async (id) => {
      const dels = await this.drepDelegatorsBlockfrost(id);
      out.set(id, { votingPowerLovelace: dels.reduce((s, d) => s + d.amount, 0n), delegators: dels.length });
    }));
    return out;
  }

  private async entryMetricsViaBlockfrost(
    entries: { drepId: string; ownStakeAddress?: string }[],
    minDelegatorStakeLovelace: bigint,
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number; ownVotingPowerLovelace: bigint; qualifyingDelegators: number }>> {
    const out = new Map(entries.map((e) => [e.drepId, { votingPowerLovelace: 0n, delegators: 0, ownVotingPowerLovelace: 0n, qualifyingDelegators: 0 }]));
    await Promise.all(entries.map(async (e) => {
      const dels = await this.drepDelegatorsBlockfrost(e.drepId);
      let total = 0n, own = 0n, qualifying = 0;
      for (const d of dels) {
        total += d.amount;
        if (e.ownStakeAddress && d.stakeAddress === e.ownStakeAddress) own = d.amount;
        if (d.amount >= minDelegatorStakeLovelace) qualifying++;
      }
      out.set(e.drepId, { votingPowerLovelace: total, delegators: dels.length, ownVotingPowerLovelace: own, qualifyingDelegators: qualifying });
    }));
    return out;
  }

  /** Voting power via Koios /drep_delegators + /account_info (stake per delegator). */
  private async drepVotingPowerViaKoios(drepIds: string[]): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number }>> {
    const m = await this.entryMetricsViaKoios(drepIds.map((drepId) => ({ drepId })), 0n);
    const out = new Map<string, { votingPowerLovelace: bigint; delegators: number }>();
    for (const id of drepIds) { const e = m.get(id)!; out.set(id, { votingPowerLovelace: e.votingPowerLovelace, delegators: e.delegators }); }
    return out;
  }

  /** Entry metrics via Koios: /drep_delegators (stake addrs) → /account_info (stake per addr). */
  private async entryMetricsViaKoios(
    entries: { drepId: string; ownStakeAddress?: string }[],
    minDelegatorStakeLovelace: bigint,
  ): Promise<Map<string, { votingPowerLovelace: bigint; delegators: number; ownVotingPowerLovelace: bigint; qualifyingDelegators: number }>> {
    const out = new Map(entries.map((e) => [e.drepId, { votingPowerLovelace: 0n, delegators: 0, ownVotingPowerLovelace: 0n, qualifyingDelegators: 0 }]));

    // 1) Total voting power + delegator count from drep_info (reliable; throws → source fails over).
    const info = await this.drepInfoBatchKoios(entries.map((e) => e.drepId));
    for (const e of entries) {
      const i = info.get(e.drepId);
      if (i) out.set(e.drepId, { ...out.get(e.drepId)!, votingPowerLovelace: i.amount, delegators: i.delegators });
    }

    // 2) Own voting power + qualifying-delegator count (§14.1 entry gate) — needs per-delegator
    // stake, so it's best-effort: computed only when a gate actually needs it, skipped for very
    // large delegator sets (to avoid request storms), and a failure never zeroes the total above.
    const needsOwn = minDelegatorStakeLovelace > 0n || entries.some((e) => e.ownStakeAddress);
    const PER_DELEGATOR_CAP = 800;
    if (needsOwn) {
      await Promise.all(entries.map(async (e) => {
        const cur = out.get(e.drepId)!;
        if (cur.delegators > PER_DELEGATOR_CAP) return; // skip the storm; total already correct
        try {
          const addrs = await this.drepDelegatorAddrsKoios(e.drepId);
          const stake = await this.accountStakeViaKoios(addrs);
          let own = 0n, qualifying = 0;
          for (const a of addrs) {
            const s = stake.get(a) ?? 0n;
            if (e.ownStakeAddress && a === e.ownStakeAddress) own = s;
            if (s >= minDelegatorStakeLovelace) qualifying++;
          }
          out.set(e.drepId, { ...cur, ownVotingPowerLovelace: own, qualifyingDelegators: qualifying });
        } catch { /* keep own/qualifying 0 — total from drep_info stands */ }
      }));
    }
    return out;
  }

  // §14.1 activity — the most-recent `windowSize` governance actions as a set of
  // gov_action ids. Koios sorts /proposal_list by block_time desc; Blockfrost's
  // ?order=desc is newest-first, so both yield the same top-N id set.
  private async activityMetricsViaKoios(
    drepIds: string[],
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<Map<string, { votesInWindow: number; windowConsidered: number }>> {
    const propRes = await this.koiosFetch(`/proposal_list`, { signal: AbortSignal.timeout(15000) });
    if (!propRes.ok) throw new Error(`koios /proposal_list ${propRes.status}`);
    const props = ((await propRes.json()) as { proposal_id?: string; block_time?: number }[])
      .filter((p) => p.proposal_id)
      .sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0))
      .slice(0, Math.max(1, windowSize));
    const windowIds = new Set(props.map((p) => p.proposal_id!));
    const out = new Map(drepIds.map((id) => [id, { votesInWindow: 0, windowConsidered: windowIds.size }]));
    await Promise.all(drepIds.map(async (id) => {
      const r = await this.koiosFetch(`/drep_votes?_drep_id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`koios /drep_votes ${r.status}`);
      const votes = (await r.json()) as { proposal_id?: string; meta_url?: string | null }[];
      let count = 0;
      for (const v of votes) {
        if (!v.proposal_id || !windowIds.has(v.proposal_id)) continue;
        if (onlyWithRationale && !v.meta_url) continue;
        count++;
      }
      out.set(id, { votesInWindow: count, windowConsidered: windowIds.size });
    }));
    return out;
  }

  private async activityMetricsViaBlockfrost(
    drepIds: string[],
    windowSize: number,
    onlyWithRationale: boolean,
  ): Promise<Map<string, { votesInWindow: number; windowConsidered: number }>> {
    // Blockfrost's drep-votes list carries no per-vote rationale anchor, so it can't
    // honour the rationale filter — fail over to Koios (which has meta_url) instead.
    if (onlyWithRationale) throw new Error('Blockfrost cannot verify per-vote rationale anchors');
    const need = Math.max(1, windowSize);
    const windowArr: string[] = [];
    for (let page = 1; page <= 20 && windowArr.length < need; page++) {
      const r = await this.blockfrostFetch(`/governance/proposals?order=desc&count=100&page=${page}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`Blockfrost /governance/proposals ${r.status}`);
      const rows = (await r.json()) as { id?: string }[];
      for (const p of rows) { if (p.id) windowArr.push(p.id); }
      if (rows.length < 100) break;
    }
    const windowIds = new Set(windowArr.slice(0, need));
    const out = new Map(drepIds.map((id) => [id, { votesInWindow: 0, windowConsidered: windowIds.size }]));
    await Promise.all(drepIds.map(async (id) => {
      let count = 0;
      for (let page = 1; page <= 50; page++) {
        const r = await this.blockfrostFetch(`/governance/dreps/${encodeURIComponent(id)}/votes?order=desc&count=100&page=${page}`, { signal: AbortSignal.timeout(15000) });
        if (r.status === 404) break; // drep cast no votes
        if (!r.ok) throw new Error(`Blockfrost /governance/dreps/votes ${r.status}`);
        const rows = (await r.json()) as { proposal_id?: string }[];
        for (const v of rows) { if (v.proposal_id && windowIds.has(v.proposal_id)) count++; }
        if (rows.length < 100) break;
      }
      out.set(id, { votesInWindow: count, windowConsidered: windowIds.size });
    }));
    return out;
  }

  // Shared Blockfrost tx UTxO fetch (inputs + outputs, each with address + lovelace).
  // Returns null when the tx isn't on-chain (404) — a definitive "not found", NOT an
  // availability failure, so callers can distinguish the two.
  private async blockfrostTxUtxos(txHash: string): Promise<{ inputs: { address: string; lovelace: bigint }[]; outputs: { address: string; lovelace: bigint }[] } | null> {
    const r = await this.blockfrostFetch(`/txs/${encodeURIComponent(txHash)}/utxos`, { signal: AbortSignal.timeout(15000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Blockfrost /txs/utxos ${r.status}`);
    const j = (await r.json()) as {
      inputs?: { address: string; amount: { unit: string; quantity: string }[] }[];
      outputs?: { address: string; amount: { unit: string; quantity: string }[] }[];
    };
    const map = (arr?: { address: string; amount: { unit: string; quantity: string }[] }[]) =>
      (arr ?? []).map((o) => ({ address: o.address, lovelace: blockfrostLovelace(o.amount) }));
    return { inputs: map(j.inputs), outputs: map(j.outputs) };
  }

  private async verifyPaymentViaKoios(txHash: string, toAddress: string, minLovelace: bigint): Promise<{ found: boolean; paid: boolean; paidLovelace: bigint }> {
    const res = await this.koiosFetch(`/tx_info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _tx_hashes: [txHash] }), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /tx_info ${res.status}`); // unavailable → fail over
    const rows = (await res.json()) as { outputs?: { payment_addr?: { bech32?: string }; value?: string }[] }[];
    const tx = rows[0];
    if (!tx) return { found: false, paid: false, paidLovelace: 0n }; // responded, tx genuinely absent
    let paid = 0n;
    for (const o of tx.outputs ?? []) if (o.payment_addr?.bech32 === toAddress) { try { paid += BigInt(o.value ?? '0'); } catch { /* ignore */ } }
    return { found: true, paid: paid >= minLovelace, paidLovelace: paid };
  }

  private async verifyPaymentViaBlockfrost(txHash: string, toAddress: string, minLovelace: bigint): Promise<{ found: boolean; paid: boolean; paidLovelace: bigint }> {
    const utxos = await this.blockfrostTxUtxos(txHash);
    if (!utxos) return { found: false, paid: false, paidLovelace: 0n };
    let paid = 0n;
    for (const o of utxos.outputs) if (o.address === toAddress) paid += o.lovelace;
    return { found: true, paid: paid >= minLovelace, paidLovelace: paid };
  }

  private async txSenderViaKoios(txHash: string): Promise<string | null> {
    const res = await this.koiosFetch(`/tx_utxos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _tx_hashes: [txHash] }), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /tx_utxos ${res.status}`);
    const rows = (await res.json()) as { inputs?: { payment_addr?: { bech32?: string } }[] }[];
    return rows[0]?.inputs?.[0]?.payment_addr?.bech32 ?? null;
  }

  private async txSenderViaBlockfrost(txHash: string): Promise<string | null> {
    const utxos = await this.blockfrostTxUtxos(txHash);
    return utxos?.inputs?.[0]?.address ?? null;
  }

  private async addressUtxosViaKoios(addresses: string[]): Promise<{ tx_hash: string; tx_index: number; value: string }[]> {
    const res = await this.koiosFetch(`/address_utxos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: addresses }), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`koios /address_utxos ${res.status}`);
    return (await res.json()) as { tx_hash: string; tx_index: number; value: string }[];
  }

  /** Unspent UTxOs via Blockfrost `GET /addresses/{addr}/utxos` (paginated), lovelace only. */
  private async addressUtxosViaBlockfrost(addresses: string[]): Promise<{ tx_hash: string; tx_index: number; value: string }[]> {
    const out: { tx_hash: string; tx_index: number; value: string }[] = [];
    for (const addr of addresses) {
      for (let page = 1; page <= 100; page++) {
        const r = await this.blockfrostFetch(`/addresses/${encodeURIComponent(addr)}/utxos?count=100&page=${page}`, { signal: AbortSignal.timeout(15000) });
        if (r.status === 404) break; // address never used
        if (!r.ok) throw new Error(`Blockfrost /addresses/utxos ${r.status}`);
        const rows = (await r.json()) as { tx_hash: string; output_index: number; amount: { unit: string; quantity: string }[] }[];
        for (const u of rows) out.push({ tx_hash: u.tx_hash, tx_index: u.output_index, value: blockfrostLovelace(u.amount).toString() });
        if (rows.length < 100) break;
      }
    }
    return out;
  }

  private async addressTxsViaKoios(addresses: string[], limit: number): Promise<AddressTx[]> {
    const txRes = await this.koiosFetch(`/address_txs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _addresses: addresses }), signal: AbortSignal.timeout(15000),
    });
    if (!txRes.ok) throw new Error(`koios /address_txs ${txRes.status}`);
    const txRows = (await txRes.json()) as { tx_hash: string; block_time?: number }[];
    const timeByHash = new Map(txRows.map((r) => [r.tx_hash, r.block_time ?? 0]));
    const hashes = txRows.sort((a, b) => (b.block_time ?? 0) - (a.block_time ?? 0)).slice(0, limit).map((r) => r.tx_hash);
    if (hashes.length === 0) return [];
    // /tx_utxos, NOT /tx_info: on this Koios the tx_info `inputs` array comes back EMPTY, so the
    // input addresses — needed to see what OUR wallets SPENT (outLovelace) — were never attributed,
    // and every change-return (the anchor wallet's fee-only self-transfers) read as fresh incoming
    // "anonymous income". /tx_utxos returns inputs AND outputs with resolved payment_addr, so
    // outLovelace is correct and the treasury view's self-transfer filter can hide those.
    const utxoRes = await this.koiosFetch(`/tx_utxos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _tx_hashes: hashes }), signal: AbortSignal.timeout(15000),
    });
    if (!utxoRes.ok) throw new Error(`koios /tx_utxos ${utxoRes.status}`);
    const set = new Set(addresses);
    const infos = (await utxoRes.json()) as {
      tx_hash: string;
      outputs?: { payment_addr?: { bech32?: string }; value?: string }[];
      inputs?: { payment_addr?: { bech32?: string }; value?: string }[];
    }[];
    return infos
      .map((tx) => {
        let inLovelace = 0n, outLovelace = 0n;
        for (const o of tx.outputs ?? []) if (o.payment_addr?.bech32 && set.has(o.payment_addr.bech32)) { try { inLovelace += BigInt(o.value ?? '0'); } catch { /* skip */ } }
        for (const i of tx.inputs ?? []) if (i.payment_addr?.bech32 && set.has(i.payment_addr.bech32)) { try { outLovelace += BigInt(i.value ?? '0'); } catch { /* skip */ } }
        return { hash: tx.tx_hash, time: timeByHash.get(tx.tx_hash) ?? 0, inLovelace, outLovelace };
      })
      .sort((a, b) => b.time - a.time);
  }

  /**
   * Treasury tx history via Blockfrost: /addresses/{addr}/transactions (newest first) merged
   * across addresses → top `limit` by block time → per-tx /txs/{hash}/utxos for the gross
   * lovelace those addresses received (in) and spent (out). Matches the Koios shape exactly.
   */
  private async addressTxsViaBlockfrost(addresses: string[], limit: number): Promise<AddressTx[]> {
    const set = new Set(addresses);
    const seen = new Map<string, number>(); // tx_hash → block_time
    for (const addr of addresses) {
      // A few pages of newest-first history per address is plenty for `limit` after the merge.
      for (let page = 1; page <= 10 && seen.size < limit * addresses.length + limit; page++) {
        const r = await this.blockfrostFetch(`/addresses/${encodeURIComponent(addr)}/transactions?order=desc&count=100&page=${page}`, { signal: AbortSignal.timeout(15000) });
        if (r.status === 404) break;
        if (!r.ok) throw new Error(`Blockfrost /addresses/transactions ${r.status}`);
        const rows = (await r.json()) as { tx_hash: string; block_time?: number }[];
        for (const t of rows) if (!seen.has(t.tx_hash)) seen.set(t.tx_hash, t.block_time ?? 0);
        if (rows.length < 100) break;
      }
    }
    const hashes = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    const results = await Promise.all(hashes.map(async ([hash, time]) => {
      const utxos = await this.blockfrostTxUtxos(hash);
      let inLovelace = 0n, outLovelace = 0n;
      if (utxos) {
        for (const o of utxos.outputs) if (set.has(o.address)) inLovelace += o.lovelace;
        for (const i of utxos.inputs) if (set.has(i.address)) outLovelace += i.lovelace;
      }
      return { hash, time, inLovelace, outLovelace };
    }));
    return results.sort((a, b) => b.time - a.time);
  }

  /** Latest protocol params via Blockfrost, mapped to the Koios /epoch_params field names. */
  private async epochParamsViaBlockfrost(): Promise<Record<string, string | number>> {
    const r = await this.blockfrostFetch(`/epochs/latest/parameters`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Blockfrost /epochs/latest/parameters ${r.status}`);
    const p = (await r.json()) as Record<string, unknown>;
    return {
      min_fee_a: Number(p.min_fee_a ?? 0),
      min_fee_b: Number(p.min_fee_b ?? 0),
      key_deposit: String(p.key_deposit ?? '0'),
      pool_deposit: String(p.pool_deposit ?? '0'),
      max_tx_size: Number(p.max_tx_size ?? 0),
      max_val_size: Number(p.max_val_size ?? 0),
      coins_per_utxo_size: String(p.coins_per_utxo_size ?? '0'),
    };
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
