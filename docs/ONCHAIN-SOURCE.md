# On-chain data source — Koios or your own db-sync

All on-chain reads go through `apps/api/src/cardano/cardano-query.service.ts`,
which supports **two interchangeable sources**, chosen by one env var.

## Switching

```env
# .env
CARDANO_ONCHAIN_SOURCE=koios     # default — the public Koios tier (no infra needed)
# or:
CARDANO_ONCHAIN_SOURCE=dbsync    # read from our own cardano-db-sync
DBSYNC_URL=postgresql://drep_ro:****@<host>:5433/cexplorer   # required for dbsync mode
```

- **`koios`** (default): reads from `https://*.koios.rest`. Zero infrastructure, but the
  free tier is **rate-limited** (a heavy run can hit a daily 429 cap).
- **`dbsync`**: reads straight from a cardano-node + cardano-db-sync Postgres
  (`cexplorer`). **No rate limit**, same data. Requires `DBSYNC_URL`.
- **Resilience:** every db-sync read **falls back to Koios on error**, so db-sync is
  never a hard dependency — a transient db-sync hiccup degrades to Koios, not an outage.

## What each method reads in db-sync mode

| Method | db-sync source |
|---|---|
| `verifyDReps` (registration/active/power) | `drep_hash` + `drep_registration` + `drep_distr` (matched by key hash; db-sync `view` is CIP-105, our ids CIP-129) |
| `drepVotingPower` | `drep_distr.amount` + current `delegation_vote` count |
| `drepEntryMetrics(Batch)` | total power from `drep_distr`; delegators + per-delegator stake via `delegation_vote` → `epoch_stake` |
| `drepActivityMetrics(Batch)` | votes over recent `gov_action_proposal` from `voting_procedure` |
| `addressBalance` / `addressBalanceStrict` | sum of unspent `tx_out` (`consumed_by_tx_id IS NULL`) |
| `verifyPayment` | `tx` + `tx_out` by tx hash (hex-guarded; non-hex/test hashes skip to Koios) |
| `drepMetadata` (name/image) | `off_chain_vote_drep_data` via the registration anchor |

## Caveats

- **DRep metadata (`drepMetadata`)** needs db-sync's **off-chain governance fetcher**
  enabled — it's optional and may be off (then `off_chain_vote_data` is empty). When
  db-sync has no rows, `drepMetadata` **falls through to Koios** so names/images still
  resolve. To make db-sync mode fully Koios-free for metadata, enable off-chain
  fetching in the db-sync config and let it backfill the registered anchors.
- **Per-delegator *current* stake** isn't cheap in db-sync (`epoch_stake` is pool-stake
  and lags; vote-only delegators show 0). Total voting power is taken reliably from
  `drep_distr`; per-delegator own/qualifying figures are best-effort.
- `accountStake` is Koios-only but is only used on the Koios metrics path — never
  reached in db-sync mode.

## Operational note

The self-hosted stack lives on the server at `/opt/cardano` (node + db-sync + Postgres,
host port **5433**). See [[drep-dao-server-deploy]] in memory for host/role details.
