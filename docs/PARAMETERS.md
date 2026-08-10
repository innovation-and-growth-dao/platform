# Parameters — every configurable value and where to change it

> Living doc. **Last updated: 2026-07-20.** Single source of truth in code:
> `packages/shared/src/config.ts` (`PLATFORM_CONFIG_DEFAULTS`,
> `ROUND_SETTING_DEFAULTS`, `MERIT_DELTAS`). This file explains them for humans;
> when the two disagree, the code wins — update this doc.

There are three layers of configuration:

| Layer | Where edited | Stored | Applies |
|---|---|---|---|
| **Platform parameters** | My area → Platform setup (board) | `platform_config` table (defaults overlaid) | platform-wide, immediately |
| **Round settings** | Round setup form (board, per round) | columns on the round (blank = default) | that round only |
| **Merit deltas** | code only (`MERIT_DELTAS`) | — | shown in the DAO Member overview explainer table |

## Platform parameters (Platform setup)

Edited by the board in **My area → Platform setup**. Each row shows the saved value
and the default; values are type-checked against the default's type.

### Governance & admission

| Parameter | Default | Meaning |
|---|---|---|
| `DREP_OPEN_ADMISSION` | **on** | **Open membership.** ON: any registered DRep who completes the profile joins the DAO straight away and can vote — no board admission vote is held. OFF: each applicant waits as `PENDING` and joins only once the board approves them (`ADMISSION_APPROVAL_VOTES` yes-votes). While **no board is seated** admission stays open whatever this is set to — there would be nobody to run the vote, and DReps must be able to join and vote in the proposal that elects the first board. |
| `ADMISSION_APPROVAL_VOTES` | 3 | Board YES votes needed to admit a new DAO member (3-of-5). Only consulted when `DREP_OPEN_ADMISSION` is OFF. |
| `INTERNAL_DEFAULT_THRESHOLD_PCT` | 67 | Approval threshold (%) for ordinary internal proposals. |
| `INTERNAL_IMPORTANT_THRESHOLD_PCT` | 75 | Approval threshold (%) for internal proposals flagged important. |

### DAO-entry gate (§14.1)

Two independently-switched groups; the parameters under a switch are shadowed (not
applied) while the switch is off. Both OFF by default so testnet entry stays open —
turn ON for mainnet.

| Parameter | Default | Meaning |
|---|---|---|
| `ENTRY_REQUIRE_VOTING_POWER` | off | **Switch** for the voting-power/delegator group. |
| ↳ `MIN_OWN_VOTING_POWER_ADA` | 1,000,000 | Minimum OWN voting power (self-delegated ADA). Meeting this alone qualifies. |
| ↳ `MIN_DELEGATORS` | 20 | OR: at least this many delegators… |
| ↳ `MIN_DELEGATOR_STAKE_ADA` | 50,000 | …each delegating at least this much (ADA). |
| `ENTRY_REQUIRE_ACTIVITY` | off | **Switch** for the on-chain voting-activity group. |
| ↳ `MINIMUM_VOTES_CASTED` | 50 | Window: the DRep's last N governance votes considered. |
| ↳ `MINIMUM_DREP_ACTIVITY` | 50 | % of that window the DRep must have voted on (50% of 50 = 25). |
| ↳ `ONLY_VOTES_WITH_RATIONALE` | off | When ON, only votes carrying an on-chain rationale count. |

### Merit & board duties

| Parameter | Default | Meaning |
|---|---|---|
| `AVOID_PERIOD_MAX_DAYS_PER_YEAR` | 42 | Max days/year a DRep may mark themselves unavailable. |
| `MERIT_POINT_MAX` | 200 | Cap on a DRep's merit score; also bounds the voting-power multiplier (×Mult = 1 + merit/cap). Changing it re-clamps live. |
| `BOARD_REWARD_DEADLINE_DAYS` | 30 | Days the board has to distribute rewards after a round before the −10 penalty. |

### Operations

| Parameter | Default | Meaning |
|---|---|---|
| `ANCHOR_SCHEDULE_CRON` | `0 2 * * *` | Time-of-day for the daily on-chain anchoring batch (digest, merit, votes). |
| `CARDANO_EXPLORER` | `cardanoscan` | Block explorer for all on-chain links: `cardanoscan` \| `cexplorer` \| `adastat`. Changing it re-resolves links live. |
| `TX_SIGNING_PROCESS` | `1_PHASE` | Multisig signing ceremony. **1-Phase**: each board member signs the tx once — requires the **Eternl** wallet (first 3 signatures broadcast). **2-Phase**: Authorize → Sign, works with any CIP-30 wallet. Only these two values are accepted; switching mid-action safely rebuilds the pending tx body (see `MULTISIG-SIGNING.md`). |

### Intentionally NOT in Platform setup

- **`BOARD_YEARLY_REWARD_ADA`** — the yearly board reward budget has a **single
  editing place: Rewards → Board rewards** ("Yearly board reward" box). It writes
  the same `platform_config` row the computation reads
  (`RewardsService.get/setBoardYearly`); missing row = 0 = board compensation
  disabled. It was removed from Platform setup so the same value never shows as two
  seemingly independent settings.

## Round settings (per round, in the round setup)

Defaults from `ROUND_SETTING_DEFAULTS`; each is stored on the round (blank = default).

| Setting | Default | Meaning |
|---|---|---|
| `filterReviewerCount` | 5 | DReps randomly drawn to review each proposal in Filtering. |
| `filterApprovalVotes` | 3 | YES votes among them to advance (same count of NO rejects). |
| `milestoneReviewerCount` | 3 | DReps drawn to review each funded milestone delivery. |
| `milestoneApprovalVotes` | 2 | YES votes to approve a milestone payout. |
| `dvApprovalThresholdPct` | 67 | % of balanced voting power to approve in Debate & Vote. |
| `rewardExpertSharePct` | 0 | % of the reward pool paid directly to experts (subtracted first). |
| `rewardDvSharePct` | 60 | Of the DReps' pool: % → Debate & Vote (rest → milestone review). |
| `rewardFixedPct` | 70 | Within the D&V slice: % fixed (bonus = remainder). |
| `feeCommercialPct` / `feeCommercialCapAda` | 3 / 5,000 | Submission fee for commercial proposals (% of ask, capped). |
| `feeOssPct` / `feeOssCapAda` | 1 / 1,000 | Submission fee for open-source proposals. |
| `feeCapPerRoundAda` | 50,000 | Total fee cap per round. |
| `quickPollParticipationPct` | 51 | Participation needed for a quick poll to be valid. |
| `quickPollDurationHours` | 48 | Quick-poll voting window. |
| `quickPollMaxExtensions` | 3 | Low-participation extensions before the poll fails. |
| `milestoneNotificationDaysBeforeEnd` | 3 | Reminder before a milestone stage ends. |
| `milestoneAutoExtensionDays` | 28 | Automatic one-time milestone extension. |
| `milestoneCheckPeriodDays` | 10 | Reviewers' window to check a delivered milestone. |
| `milestoneBoardExtraExtensionDays` | 90 | Board's one-time extra extension (§11.5). |
| `boardPayoutDeadlineDays` | 5 | Days the board has to pay an approved milestone before the −10 penalty. |
| `pledgeThresholdAda` | 0 | Ask size above which a proposer pledge is offered (0 = always optional). |
| `pledgeGraceDays` | 14 | Grace period to pay the pledge before auto-expiry. |
| `filterResubmissionsAllowed` | 2 | Revise-and-resubmit attempts after a filtering rejection. |
| `filterBudgetChangesAllowed` | 2 | Budget-change requests while in Filtering (0 = disabled). |
| `mandatoryWords` | 1 | Minimum word count per mandatory proposal text field (0 = off). |

## Merit deltas (§13 — code-defined, shown in the DAO Member overview)

The "How merit points work" table at the bottom of the DAO Member overview renders
from `MERIT_DELTAS`, so the UI can never drift from what the backend awards. Awards
are idempotent per `(drep, reason, reference)`; misses are deducted by the daily
sweep unless an avoid period covers them.

**All DAO members:** filtering review +1 · D&V vote +1 · internal-proposal vote +1 ·
quick-poll vote +1 · milestone review +1 · internal proposal submitted +1.
Misses: filtering −1 · D&V −1 · quick poll −1 · milestone review −1.

**Board members (on top):** application review +1 · multisig key provided +1 ·
multisig assembled +1 · treasury action initiated (`TX_INITIATED`) +1 · tx signed
(`TX_SIGNED`) +1 · on-time milestone payout signed +5 · round configure/start/end
+10 each (whole board) · reward distribution +10 (whole board) · monthly ledger +2
(whole board). Misses: late reward distribution −10 · late milestone payout −10
(both whole board).

## Environment (.env) — not editable in the UI

Operational settings live in `.env`, not the database: `CARDANO_NETWORK`,
`DBSYNC_URL` + `CARDANO_ONCHAIN_SOURCE` (see `ONCHAIN-SOURCE.md`),
`CARDANO_SUBMIT_API_URL`, `KOIOS_URL`, `ANCHOR_MNEMONIC` (hot wallet),
`TREASURY_ADDRESS` (pre-multisig fallback), `RESEND_API_KEY`, `DATABASE_URL`,
`JOBS_DISABLED` (tests). See `.env.example` and `ANCHOR-WALLET.md`.
