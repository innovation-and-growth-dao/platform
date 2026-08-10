# Innovation & Growth DAO — User Guide

A practical guide for the people who use the platform: viewers, submitters, DReps, and
board members. It covers what each screen does and how the funding process works, using
the same labels you see in the app.

---

## 1. Overview

Innovation & Growth DAO is a self-hosted web platform where registered Cardano DReps
collectively fund projects. Work happens in **rounds**: teams submit funding proposals, a
small jury filters them, all DAO members debate and vote, budgets are allocated, and a
**3-of-5 multisig treasury** pays out project funding and rewards. The DAO also runs its
own **internal proposals** to govern itself (process changes, parameters, electing the
board).

**Where the source of truth lives.** The backend and its PostgreSQL database are
authoritative for everything operational: proposals, votes, tallies, merit points, reward
calculations, and configuration. The Cardano chain is used for a specific set of things:

- **Wallet login** — you sign in by signing a message with your wallet (CIP-30).
- **DRep identity** — your on-chain DRep registration is what makes you a DRep.
- **Treasury** — funds sit in a native 3-of-5 multisig address (no smart contract).
- **Fee and pledge verification** — the platform reads the chain to confirm a submission
  fee or pledge transaction really landed.
- **Daily anchoring** — the platform posts hashes of its key data to the chain each day so
  anyone can verify it wasn't altered after the fact.

There is **no Plutus / smart-contract layer.** The multisig is a plain multi-signature
payment address, and governance logic runs in the backend, not on-chain.

---

## 2. Getting started

### Connect a wallet

You log in with a Cardano wallet browser extension that supports **CIP-30** (for example
**Lace** or **Eternl**). Set the wallet to the network the platform is configured for
(the test deployment runs on **Preprod**).

1. Open the site. The login box says **"Sign in with your Cardano wallet."**
2. Click **Connect** next to your wallet. If no wallet is listed, install/enable one and
   click **Re-scan**.
3. Approve the connection in the wallet popup, then approve the **signature request**. The
   platform reads your stake key from the signature and grants your role automatically. No
   transaction and no fee is involved in logging in — it is just a signed message.

If you switched account or wallet, use **"Switched account or wallet? Re-scan wallets."**

### What you can do with no role (Viewer)

Any connected wallet is at least a **Viewer**. The login box shows your status (for
example `Viewer`, or `Registered DRep` if your DRep key is registered on-chain). As a
Viewer you can browse everything the DAO does: the **DAO Member overview**, **DAO
members**, **Submitters** and **Experts** directories, **Rounds** and their proposals,
**Funding proposals**, **Internal proposals**, **On-chain proofs**, and the **Treasury**
overview. You cannot submit, vote, or sign.

> Platform operators sign in separately at **Admin login** (`/admin/login`) with a
> username and password — that is an operational account, not a governance role.

---

## 3. Roles & how to get them

Your role is derived from your wallet plus a few applications. One account can hold several
roles at once (for example DAO member + Submitter).

| Role | What it is | How to get it |
|---|---|---|
| **Viewer** | Any connected wallet. Read-only. | Just connect a wallet. |
| **Submitter** | Can submit funding proposals. | Apply on the **Profile** tab; a board member approves it. |
| **DRep / DAO member** | Can vote and review. | Register your DRep key on-chain, then **Join DAO**. |
| **Board member** | A seated DRep who runs the DAO's operations. | Elected by the DAO via an internal proposal (the founding board is seated at launch). |
| **Expert** | A non-DRep with subject knowledge; helps review milestones. | Apply on the **Profile** tab; a board member approves it. |

### Becoming a Submitter

On **My area → Profile**, choose **Become a submitter** (or **Apply to become a
submitter**). Fill in a short submitter profile. A board member reviews it; once approved,
a **My proposals** area lets you submit. The submitter profile is a separate sub-profile —
if you are also a DAO member, both profiles live on their own tabs.

### Becoming a DRep / DAO member

1. **Register as a DRep on-chain** in your wallet (e.g. Eternl → Governance → Register as
   a DRep). This is the on-chain step that establishes your DRep identity. Sign in again
   afterwards; the login box will now read **Registered DRep**.
2. **Join the DAO.** A **JOIN DAO** button appears in the right sidebar (and a "Join as a
   DAO member" option under **My area → Profile**). Complete your DRep profile (name,
   contacts, categories you understand, motivation, experience).

**Open vs. board-approved admission.** Membership is **open by default**
(`DREP_OPEN_ADMISSION` is on): a registered DRep who completes the profile **joins
immediately and can vote — no board vote is held.** You'll see an "Open membership" note
confirming this. The board can switch open admission **off**; membership then requires a
board approval vote (3 of 5) and your application waits as **pending** until then. While
**no board is seated yet**, admission stays open no matter the setting — DReps must be able
to join and vote in the very proposal that elects the first board.

> If the board has turned on **entry requirements** (minimum self-delegated voting power,
> or a number of delegators, or on-chain voting activity), the Join form shows exactly
> which requirements you don't yet meet instead of the application. These gates are off by
> default on testnet.

### Becoming a Board member

The board has 5 seats. The founding board is seated when the platform is deployed (from a
public `genesis.json`). After that, board changes happen through a normal **internal
proposal** flagged *important* (75% threshold) — the DAO elects and removes board members
itself.

---

## 4. For DReps (DAO members)

Your home is **My area**. It splits into tabs; a red badge marks anything awaiting you, and
the same count is mirrored on the left-nav **My area** item and the notification badge.

Your tabs as a DAO member:

- **Profile** — your DRep profile, reward payment address, merit panel, avoid period, and
  preferences. You can also apply for the separate submitter role here, or leave the DAO.
- **Voting & reviews** — everything awaiting your vote or review.
- **Internal proposals** — submit and vote on DAO-governance proposals.
- **My proposals** — appears once you also hold the submitter role.

The **Voting & reviews** tab has a **To do / Recent / History** switch and a search box.
It gathers four kinds of work:

### Filtering (jury)

When a round's Submission window closes, the platform randomly draws a small jury (default
5) per proposal, matched by the sub-categories you said you understand. If you're drawn,
the proposal appears here to review. You vote **YES / NO / ABSTAIN** — one person, one
vote. A **NO** requires written rationale. There are two feedback rounds: after the first,
the submitter may revise; the second is final. Reaching the approval count (default 3 YES)
advances the proposal; 3 NO rejects it.

### Debate & Vote

Proposals that pass filtering enter **Debate & Vote**, open to all eligible DAO members.
First you can comment/debate while the submitter revises; then voting opens. You vote
**YES / NO / ABSTAIN**; **rationale is required.** You can change your vote while voting is
open (the last one counts). Here your ballot carries **balanced voting power** — based on
your on-chain stake and adjusted by your merit points — not one-person-one-vote.

### Tally — tie-break quick polls (ranked priority)

After voting closes, the platform ranks each category's passing proposals and funds them
top-down until the category budget runs out. If two or more proposals **tie at the budget
cliff** (equal scores, not enough budget for all), a **quick poll** decides who gets the
remaining budget. The board launches the poll; eligible DReps then **rank the tied
proposals by priority** (highest first, reorder to change). The remaining budget is filled
top-down by the aggregated ranking, funding as many as fit. A poll runs ~48 hours and needs
51% participation; if turnout is too low it extends up to 3 times. You'll find live polls
in **Voting & reviews** and in **Rounds → Tally**.

### Voting Result

Open a round and pick the **Voting Result** tab to see, per category, every proposal that
reached Debate & Vote ordered most-supported to least, each with its YES/NO/abstain bar and
threshold. Cards are colour-coded: **APPROVED** (green), **PENDING** (amber — awaiting a
tie-break quick poll), **REJECTED** (red), and each says why it landed there (funded,
budget-cut, below threshold, or no voting power).

### Internal proposals

Any DAO member can **submit an internal proposal** (process change, poll, an instruction to
named actors, or — importantly — the proposal that installs the board) and vote on others'.
Internal votes use balanced voting power and a threshold (default 67%, or 75% if flagged
important). Board-only internal proposals use one-member-one-vote.

### Merit & rewards

Your **merit points** (range −200 to +200) multiply your voting power (−200 = silent,
0 = normal, +200 = double). You gain +1 for each vote or review you complete and lose
points for missing assigned work; the **Merit panel** on your Profile shows your ledger and
an explainer of how points are earned. Rewards are paid in ADA from each round's reward
pool and from submission fees, for filtering, Debate & Vote (a fixed part plus a bonus),
and milestone reviews. Set a **reward payment address** on your Profile — the panel nags in
amber until you do, or you won't be paid.

### Avoid signaling

If you'll be unavailable (vacation, illness), signal an **avoid period** from the Merit
panel (up to 42 days/year, can be split). During it you won't be assigned to filtering or
milestone review, and missing Debate & Vote votes won't cost you merit. If you're already
assigned when you signal, the platform reassigns your work with no penalty to you.

---

## 5. For Submitters

### Apply

On **My area → Profile**, apply for the **submitter** role and fill in the short profile. A
board member approves it. Until then, **My proposals** explains that you need approval
first.

### Submit a funding proposal

Once approved, go to **My proposals** and fill in the submission form. It captures: title,
category (from the active round) and sub-categories, **project type** (Commercial or
Open-source — this sets the fee tier), **requested amount**, milestones (each with a
description, amount, deadline and deliverables — amounts must sum to the total ask), team
info, cost breakdown, revenue sharing (for commercial), and the project narrative. You can
save a **draft** before submitting.

### Submission fee + pledge

- **Submission fee.** The form auto-computes the fee (commercial vs open-source rate, each
  capped). You pay it on-chain and paste the **transaction hash**; the platform confirms it
  on-chain before your proposal goes **active**. Until confirmed it stays **pending**.
- **Pledge (skin in the game).** Commercial proposals above the configured threshold
  require a **pledge** (1–5% of the ask, set by you). You only send the pledge **after**
  your proposal is approved in Debate & Vote — it moves to *pending (pledge)*, you send it
  to the DAO multisig and paste the TX hash, the platform verifies the amount and sender,
  and a board member confirms. There's a grace period (default 14 days). The pledge is
  returned as milestones are approved (all at the last milestone, or pro-rata per
  milestone), and forfeited if the project fails.

### The stages your proposal passes through

Submission → **Filtering** (jury review, with a chance to revise) → **Debate & Vote** (all
members) → **Tally** (budget allocation; a tie-break quick poll may apply) → **Funding**.
In Funding, you deliver each milestone: submit a **Proof of Achievement** on the milestone
page, assigned reviewers vote, and approved milestones release funds from the treasury.

### Budget changes

While in Filtering, a limited number of **budget-change** requests are allowed (configured
per round). Depending on round settings, an increase may require topping up the fee and a
decrease may return part of it; the board settles these.

---

## 6. For Board members

Board members are DAO members with extra tabs in **My area** plus the board-only **Platform
setup** item in the left nav.

### Round setup & stage control

- **Rounds → + Create round** — set the budget and reward pool, define **categories**
  (Grant or RFP, with allocation and optional min/max ask; allocations must sum to the
  budget), tune per-round parameters and the **reward split** (three sliders: experts'
  cut, Debate & Vote vs milestone review, fixed vs bonus), and lay out the **schedule**
  for every stage (Submission → Filtering → Debate → Vote → Tally → Funding). An
  "expected days" helper fills dates; moving a stage cascades later ones.
- **My area → Round control** — advance the round through its stages. The stages bar warns
  in red when a stage is overdue to start. Most settings stay editable mid-round.

### Admitting members (when open membership is off)

- **My area → Applications** — review DRep, Expert, and Submitter applications and
  member-removal votes. When open admission is off, admitting a DAO member needs 3 of 5
  board YES votes; a NO needs written feedback.

### Confirmations (fees, pledges, revenue sharing)

- **My area → Actions** — the non-treasury to-do queue: confirm submission-fee payments,
  confirm pledges received, verify revenue-sharing, settle budget changes, review reward
  payouts, and vote on stop-funding. Assigning/confirming reviewer assignments also lives
  here.

### Treasury (3-of-5 multisig signing)

- **My area → Treasury** has three parts:
  - **Signatures** — the **Approve & sign** queue: every multisig action (project funding,
    rewards, pledge returns) awaiting the board's 3-of-5 ceremony. Depending on the
    configured signing process, you either sign once (Eternl, 1-phase) or Authorize then
    Sign (2-phase, any CIP-30 wallet).
  - **Actions** — board-initiated transfers, hot-wallet top-ups/sweeps, and treasury
    bucket configuration.
  - **Multisig setup** — the native 3-of-5 script and signer keys.

### Rewards

- **My area → Rewards** — review and sign reward distributions; also set the **yearly
  board reward** budget. Rewards must be sent within the deadline or the whole board takes
  a merit penalty.

### Platform setup (parameters)

- Left nav → **Platform setup** (board only) — platform-wide parameters: open admission on/
  off and the admission vote count, internal-proposal thresholds, entry-requirement gates,
  merit cap, avoid-period cap, the anchoring schedule, block explorer, and the multisig
  signing process. Each row shows the saved value and its default.

### Stop-funding

If a funded project goes wrong, the board can vote to **stop funding** it (a to-do in
**Actions**), terminating the project and stopping further payouts.

---

## 7. Funding round lifecycle

A round moves through these stages (visible on the round's **Schedule and Round Setup**
tab, with countdowns):

1. **Preparation** — the board configures the round: budget, categories, reward split,
   parameters, schedule. Nothing is public-facing yet.
2. **Submission** — approved submitters post proposals and pay the submission fee. A
   proposal is *pending* until its fee is confirmed on-chain, then *active*.
3. **Filtering** — a random, category-matched jury (default 5) reviews each proposal, with
   two feedback rounds and a revision window. Reaching the approval count advances it;
   otherwise it's rejected.
4. **Debate** — proposals that passed filtering are opened for comment and revision by all
   eligible members.
5. **Vote** — balanced-power voting with required rationale; votes can change until close.
6. **Tally** — voting is closed and results are published. Each category's passing
   proposals are funded top-down until the budget runs out. Ties at the budget cliff are
   resolved by **ranked-priority quick polls** that the board launches. Funding begins only
   once every quick poll has resolved.
7. **Funding** — for each approved project, reviewers are assigned (board confirms), the
   team submits Proof of Achievement per milestone, reviewers vote, and approved milestones
   release funds from the treasury. Pledges are returned as milestones complete.
8. **Closed** — all milestone work is done. Leftover funds are handled by the board
   (moved to a later round or returned to the Cardano Treasury).

Multiple rounds can overlap, but only one Filtering **or** Debate & Vote stage is active at
a time across all rounds.

---

## 8. On-chain verification

The platform's data is anchored to Cardano so anyone can check it hasn't been altered.

- **Daily anchoring.** Once a day (and at key moments) the backend posts a small metadata
  transaction containing a **hash** of designated data — ready proposals, vote tallies,
  voting-power snapshots, the merit ledger, and configuration changes. These are sent from
  an operational hot wallet, not the multisig, so they don't need board signatures. Reward
  payouts are already on-chain (they *are* the multisig transactions).
- **On-chain proofs.** The left-nav **On-chain proofs** page lets you see anchored records:
  the underlying data, its hash, the Cardano transaction that carries the anchor, and a link
  to a block explorer. For collections like vote tallies you can verify your own vote via an
  inclusion proof. Because the platform's data is authoritative and only its hash goes
  on-chain, you (or any DRep) can recompute the hash yourself and confirm it matches.

---

## 9. Glossary

- **DRep** — a Delegated Representative registered on the Cardano chain. Only a registered
  DRep can join the DAO and vote.
- **DAO member** — a DRep who has joined this DAO and can vote and review.
- **Board** — the 5 seated DReps who operate the DAO: set up rounds, confirm assignments,
  sign treasury transactions, and (when open admission is off) admit members. Treasury
  actions need 3 of 5 signatures.
- **Round** — one cycle of funding: budget, categories, and the stages proposals pass
  through.
- **Category** — a funding bucket within a round; **Grant** (many winners) or **RFP** (one
  winner), with its own allocation and ask range.
- **Filtering** — the first jury stage: a small, randomly drawn group of DReps decides
  whether a proposal advances, one person one vote.
- **Debate & Vote (D&V)** — the main stage where all eligible members debate and then vote
  with **balanced voting power**.
- **Tally** — the stage after voting where results are published and budgets allocated;
  only tie-break quick polls run here.
- **Quick poll** — a short tie-break vote where DReps **rank** proposals tied at the budget
  cliff by priority; the remaining budget is filled top-down.
- **Milestone** — a deliverable within a funded project; the team submits a **Proof of
  Achievement**, reviewers vote, and approval releases that milestone's funds.
- **Pledge** — refundable "skin in the game" a commercial team sends after approval;
  returned as milestones complete, forfeited on failure.
- **Merit points** — a per-DRep score (−200…+200) that multiplies voting power and reflects
  participation; earned by voting/reviewing, lost by missing assigned work.
- **Anchoring** — posting a hash of the platform's data to Cardano so it can be
  independently verified later.
- **Multisig** — the DAO's 3-of-5 native multi-signature treasury address (no smart
  contract); board members co-sign to move funds.
