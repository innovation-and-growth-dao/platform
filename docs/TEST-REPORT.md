# Test Report — Innovation & Growth DAO

**Date:** 2026-07-20 · **Version:** 1.0.0

This report summarises the automated quality gates for the platform: strict type
checking, unit tests, a production build, and the end-to-end suite inventory.

## Summary

| Gate | Command | Result |
|---|---|---|
| Static typecheck (strict TS) | `pnpm typecheck` | ✅ **8 / 8 packages pass** |
| Unit tests (vitest) | `pnpm test` | ✅ **120 / 120 pass** (17 files) |
| Production build | `pnpm build` | ✅ **5 / 5 packages build** |
| End-to-end suites | `pnpm test:e2e` | ⚙️ ~26 suites — run in a self-hosted env (Postgres + Redis + Preprod wallets) |

TypeScript strict mode is the static-analysis gate (there is no ESLint config).
`pnpm typecheck`, `pnpm test`, and `pnpm build` run on every push via
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Environment

| | |
|---|---|
| Node.js | ≥ 20 (developed on 24) |
| pnpm | 9.15.9 |
| Test runner | vitest |
| Database (e2e) | Postgres 16 |
| Queue/cache (e2e) | Redis 7 |
| Cardano network (e2e) | Preprod |

## Unit tests — 120 passing

Pure logic (allocation maths, tallies, state classifiers, config guards) is
factored into standalone modules so it is unit-testable without a database.

### `@drep-dao/shared` — 38 tests, 7 files

| File | Covers |
|---|---|
| `config.spec.ts` | every platform parameter is documented, correctly typed, and `DREP_OPEN_ADMISSION` ships open |
| `round-stages.spec.ts` | round-stage ordering incl. Tally; stage helpers |
| `proposal-lifecycle.spec.ts` | proposal status/stage transitions |
| `budget-change.spec.ts` | mid-round budget-change settlement |
| `permissions.spec.ts` | role-based permission helpers |
| `comments.spec.ts` | comment author tone / rules |
| `search.spec.ts` | proposal search matching (title / proposer / id) |

### `@drep-dao/cardano` — 19 tests, 1 file

| File | Covers |
|---|---|
| `governance-metadata.spec.ts` | CIP-100/anchoring governance-metadata encoding |

### `@drep-dao/api` — 63 tests, 9 files

| File | Covers |
|---|---|
| `proposals/quick-poll-math.spec.ts` | ranked-priority tie-break: power-weighted Borda + budget-greedy allocation (boundaries: exact fit, spent/negative budget, no-fit tie, empty poll) |
| `proposals/dv-results.spec.ts` | Debate & Vote result tallies |
| `proposals/proposal-progress.spec.ts` | rejection-reason classification (fee vs. filtering vs. D&V, incl. finalized budget-cut) |
| `proposals/proposal-state.spec.ts` | fee-stage vs. D&V reject; milestone-content preservation |
| `proposals/filtering.service.spec.ts` | filtering jury vote rules |
| `drep/admission.spec.ts` | open-membership vs. board-approval admission matrix |
| `drep/drep.contact.spec.ts` | required contact-detail validation |
| `rounds/stage-schedule.spec.ts` | stage auto-start scheduling |
| `submitter/submitter.service.spec.ts` | submitter application / proposal state |

## End-to-end suites

The e2e suites in [`tools/`](../tools/) drive the real API against a real
Postgres + Redis, and exercise on-chain flows with funded **Preprod** test
wallets. Because they require that environment (and wallet seeds that are
intentionally **not** committed), they run in a self-hosted setup rather than in
the default CI. Run them with:

```bash
pnpm infra:up            # Postgres + Redis
pnpm test:e2e            # runs tools/test-all.cjs
```

Representative coverage (see each `tools/test-*.cjs`):

- **Governance & membership:** `test-genesis`, `test-free-period`,
  `test-entry-gate`, `test-dao`, `test-removal`
- **Internal proposals:** `test-internal`, `test-internal-election` (installs the
  board), `test-internal-transfer`
- **Funding rounds:** `test-rounds`, `test-round-counts`, `test-stage-flow`,
  `test-submission-phase`, `test-proposal-flow`, `test-category-ask`,
  `test-milestone-flow`, `test-pledge`, `test-tally-rewards`,
  `test-proposer-journey`, `test-dreps-at-scale`
- **Treasury & signing:** `test-board-operations` (real 3-of-5 Ed25519 signing
  ceremony), `test-multisig-migration`, `test-signing-mode`, `test-merit-tx`
- **Audit & on-chain:** `test-audit-flows`, `test-anchor`, `test-cast`
- **Overview / dashboards:** `test-overview`

## Reproducing

```bash
pnpm install
pnpm db:generate
pnpm typecheck      # 8/8
pnpm test           # 120/120
pnpm build          # 5/5
```
