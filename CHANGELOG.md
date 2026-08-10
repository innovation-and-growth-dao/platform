# Changelog

All notable changes to this project are documented here. A detailed,
running engineering log lives in [docs/PROJECT.md](docs/PROJECT.md); this file
is the high-level summary.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-07-20

First public release of the Innovation & Growth DAO platform.

### Platform

- Cardano wallet auth (CIP-30/CIP-8) and on-chain DRep identity (CIP-95); the
  backend + Postgres are the source of truth, with **no Plutus/on-chain logic**.
- Daily Merkle-hash **anchoring** of the audit trail for independent verifiability
  (On-chain proofs page).
- Roles: Viewer, Submitter, DRep, Board member, and platform Admin (with 2FA).
- 3-of-5 native-script **multisig treasury** with 1-phase and 2-phase signing.
- Merit ledger and reward payouts.

### Funding rounds

- Full round lifecycle: Preparation → Submission → Filtering → Debate → Vote →
  **Tally** → Funding → Closed.
- **Tally stage** decides budget-cliff ties with **ranked-priority quick polls**
  (power-weighted Borda + budget-greedy fill; a genuine tie spawns a smaller
  follow-up poll). Funding mechanics (pledge clock, milestone reviewers,
  revenue-sharing) activate only when a round enters Funding.
- **Voting Result** tab: per-category, outcome-ordered results with the vote
  power bar and per-category budget (allocated / unallocated, funded vs. cut).
- Milestone-based funding release with reviewer assignment, POAs, and
  stop-funding escalation.

### Governance & membership

- **Open DAO membership** by default (`DREP_OPEN_ADMISSION`): a registered DRep
  with a complete profile joins immediately and can vote — no board admission
  vote. The board can switch it off to require approval; while no board is
  seated, admission stays open regardless.
- Internal proposals (submit + vote), including the proposal that installs the
  board.
- Board-configurable platform parameters (Platform setup) and per-round settings.

### Branding

- Per-deployment branding via `NEXT_PUBLIC_APP_NAME` (tab title + icon). This
  repository is the **Innovation & Growth DAO** edition; a sibling **DRep DAO**
  governance edition builds from the same code base.

See [docs/PROJECT.md](docs/PROJECT.md) for the full change history leading up to
this release.
