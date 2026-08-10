# DRep DAO — service-level test suite

Integration tests that exercise the real services (`UsersService`, `DrepService`,
`GenesisService`, `CardanoQueryService`) against the **dev Postgres** and **live
Koios (Preprod)** — the realistic seam for this off-chain-source-of-truth +
on-chain platform. Each suite cleans up after itself and the suite leaves the
**5-member board seated** with no leftover test applicants.

## Run

```bash
pnpm infra:up        # Postgres + Redis (once)
pnpm build           # or have `pnpm dev` running — the suite uses the built dist
pnpm test:e2e        # = node tools/test-all.cjs
```

Prereqs: an admin (`pnpm admin:create`), and the fixed cast generated + funded +
registered on-chain (see `docs/ACTORS.md`; `gen-cast` → `fund-cast` →
`register-dreps` → `seat-board` → `delegate-votes`).

## Suites (run in this order by `test-all.cjs`)

| Suite | Covers |
|---|---|
| `test-genesis` | Loading the genesis JSON (array / `founding_board` / name→id map / pairs), **partial load** (keep valid, report invalid), empty/garbage rejection, **manual add/remove** board members, **incremental re-load** (3 then +2 = 5). Leaves the 5-member board seated. |
| `test-cast` | Role recognition for all 10 actors (board → DRep+DAO_MEMBER+BOARD; voting DReps → DREP; ADA holders → Viewer/Submitter) + non-mutating genesis verify. |
| `test-dao` | Board members are DAO members automatically; a non-board DRep joins via the §14.2 **3-of-5 admission vote** (rationale required); applicant sees votes + rationales; overview voting power. |
| `test-overview` | DAO overview **voting power** = log10(on-chain DRep vote-delegation stake) × (1 + merit/200) with delegator counts; **Expert** apply → board approve → listed. |
| `test-entry-gate` | §14.1 **DAO-entry gate**: boolean+number config **save roundtrip** (real `updateParam`→`getParams`); `entryEligibility` open when gates off / gated with reasons when on; the **⚠ below-minimum** overview flag (board exempt from power, everyone incl. board for activity); **`MERIT_POINT_MAX`** changes the voting-power multiplier at runtime (×1.5 at cap 200, ×2.0 at cap 100). **Self-restoring** — snapshots every `platform_config` key it touches and restores it, and removes its temp merit-ledger row, so it never clobbers live settings. |
| `test-removal` | §14.4 board **removal**: propose → 3-of-5 vote → `REMOVED`; removed member can re-apply. Resolved removals are **anchored on-chain** (proof in *On-chain proofs*). |
| `test-category-ask` | §5.2 a category's **min/max funding-request bounds** are enforced when a proposal is created (below-min and above-max rejected, in-range accepted), the detail exposes the ask range + conditions, the §3.4 funding fields (team info, cost breakdown, revenue sharing) round-trip, and a **milestone's title + acceptance criteria + budget** round-trip. Also §12 submission-fee flow: the **tx hash persists** on a draft + survives reload, **changing it keeps a history** of every hash, a fee>0 submit → PENDING + **fully editable** (amount+milestones, fee recomputed), **board fee review** (reject needs a reason → REJECTED + feedback), a fee-rejected proposal is editable + **re-submittable** (→ PENDING, feedback cleared), and a **0% fee** submit goes straight to ACTIVE/Filtering with no tx. On activation a proposal gets a **structured publicId** (`R{n}-P{k}`) and an **on-chain acceptance anchor** (subject `submission`) recording proposalId + submitter + fee facts (paid/tx, or "no fee required") — verified for both the fee-paid and zero-fee paths (recorded, not submitted: `ANCHOR_MNEMONIC` deleted). §12 fee integrity: the **requested amount is locked while PENDING** (anti-gaming), and an **ACTIVE budget change** creates a board **settlement** — increase → `TOPUP` (= fee delta), decrease → `REFUND`, settle clears it from the pending list. Self-cleaning (deletes its throwaway rounds + proposals + anchors + fee adjustments). |
| `test-rounds` | §6/§3 **round lifecycle**: board creates a round and moves it stage to stage; proposals submit **only** in the `SUBMISSION` stage (blocked in PREPARATION/FILTERING). Board-editable **governance parameters** (get/update/validate). Cleans up the test round + proposal. |
| `test-round-counts` | §9 a round's overview shows **per-status proposal counts for every status, including DRAFT and PENDING** (a count only — proposal content stays private), and the counts **update as a proposal's status changes**: empty → no counts; `createDraft` → DRAFT:1; submit (fee>0) → PENDING:1/DRAFT:0; board approve → ACTIVE:1; a second proposal submit+reject → REJECTED:1 alongside ACTIVE:1. Checks both the round detail (`get`) and the rounds list (`list`). Self-cleaning (deletes its throwaway round + proposals + child rows). |
| `test-internal` | §10 **internal proposals** (not round-tied): submit goes straight to **ACTIVE** with a structured id `Internal N` and voting opens immediately; an INFORMATIVE board-only 1p1v proposal with all YES → **APPROVED** (and 1-of-many YES → **REJECTED**) per the §4.4 threshold; the decision is **anchored** (label 80808081) carrying the `publicId` + a **date-independent `docHash`** = sha256(title+content); `voters_scope` is enforced (a non-board DRep can't vote on a `BOARD_ONLY` proposal); a single-choice **POLL** tallies per option and rejects a multi-option vote (without wiping the prior vote); the submitter can **move the voting end**; `IMPORTANT` resolves to 75%; and a **PRIVATE** proposal forces board-only scope and is hidden from a non-board viewer's list. Self-cleaning. |
| `test-internal-election` | §14 **board-member election** (INSTRUCTIVE internal proposal whose 5 actors are candidates and whose `deliveryDate` is the installation date): submit **validation** (rejects <5 / duplicates / no install date / install ≤ voting end / PRIVATE / unknown candidate); valid submit yields **forced defaults** (`votersScope=BOTH`, `votingType=BALANCED`, `thresholdKind=IMPORTANT`, `isBoardElection=true`) with 5 resolved candidates (name + drepKeyHash); install **blocked while ACTIVE**; all-YES vote → APPROVED; **non-board DRep can't install**; a board member's manual `installNewBoard` swaps the `board_seat` roster to the 5 elected candidates + marks `boardInstalledAt` and is **idempotent**; **auto-install on read** runs once an approved election's `deliveryDate` has passed. Self-cleaning (deletes the throwaway proposals AND restores the pre-test board roster). |
| `test-pledge` | §3 **proposer pledge**: at `createDraft` the pledge is **optional** — opting in requires `pledgeAmountAda ≥ round.pledgeThresholdAda` and a return-method description (below-min + missing method rejected; opt-out always allowed). The actual on-chain payment happens AFTER approval (FUNDING): submitter calls `submitPledgeTxHash`, the proposal appears in `listPendingPledge` with an on-chain verification result; board `reviewPledge` APPROVE sets `pledgeConfirmedAt`, REJECT clears the tx hash + stores feedback so the team can re-paste. **Milestone POAs are blocked** while a pledge is promised but not confirmed; pledge fields are locked once the proposal reaches FUNDING (general editing lock). Self-cleaning. |
| `test-submission-phase` | §3/§5 **SUBMISSION-phase rules**: during a round's SUBMISSION stage, proposals can be drafted/submitted/fee-paid and reviewers can be **pre-assigned**, but the filtering **vote is blocked** (`round.status !== FILTERING`) and `votingTasksCount` returns 0 for all DReps (no notifications). When the board moves the round SUBMISSION → FILTERING, any DRAFT or PENDING (fee unpaid OR not confirmed) proposal is **auto-REJECTED** with a clear `feeReviewFeedback` reason ("Not submitted before…", "Submission fee was not paid before…", "Submission fee was not confirmed by the board before…"); ACTIVE proposals advance and their pre-assigned reviewers can now vote. Self-cleaning. |
| `test-milestone-flow` | §11 **milestone allocation + POA gating + stop-funding**. Board sees ranked candidates (expertise overlap first, then per-round load) and **picks exactly `milestoneReviewerCount` DReps** (wrong count / duplicates / submitter / non-eligible all rejected); the same set is assigned to every milestone of the proposal; re-allocation requires `releaseReviewers` which is **blocked once a POA exists**. POA submission is gated to **round.status = FUNDING** and is **immutable once submitted** — `submitPoa` rejects a re-submit while `POA_SUBMITTED`; only after the milestone is REJECTED can the submitter post a new POA (which clears the prior votes). APPROVED milestone **auto-prepares a PROJECT_FUNDING multisig action** so the board has a "pay the milestone" task in Actions. **Stop-funding** (any assigned reviewer OR any board member proposes; duplicate ACTIVE blocked; submitter/non-DRep cannot): board votes 1p1v; 3 YES → status APPROVED + **proposal FAILED** + decision **anchored on-chain** (label 80808081, subject `stop_funding`); each board member's `pendingStopFunding` count drops by 1 after voting, to 0 once decided. Self-cleaning. |

Individual suites can be run directly, e.g. `node tools/test-genesis.cjs`.

## Manual on-chain PoC (not in `test-all`)

`tools/gov-anchor-poc.cjs` — proof-of-concept for **on-chain governance voting via tx
metadata** (WingRiders pattern, our `@drep-dao/cardano` `governance-metadata` module).
Anchors a DRep admission (application + 3 board votes + result) on Preprod under label
**80808081**, then reads it back from Koios and **re-tallies independently** (1-person-1-vote).
Excluded from the automated suite because it submits real transactions and spends tADA.
Run manually: `node tools/gov-anchor-poc.cjs`.

`tools/test-anchor.cjs` — the **wired** §C flow on live admission: signed votes (CIP-30)
+ one on-chain anchor per decision. Verifies a bogus signature is rejected, a real
CIP-8 signature is accepted/stored/re-verified, and the 3rd YES auto-anchors a Preprod
tx (label 80808081) that Koios indexes with the ADMITTED result + vote-set hash. Needs
`ANCHOR_MNEMONIC` in `.env` (a funded Preprod wallet). The automated suites delete
`ANCHOR_MNEMONIC` at load so admission decisions there record a *pending* anchor without
submitting. Run manually: `node tools/test-anchor.cjs`.
