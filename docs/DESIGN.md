# DRep DAO — Platform Design v2

---

## Table of Contents

**Part I — Functional Design**

1. [System Architecture](#1-system-architecture)
2. [Roles](#2-roles)
3. [Proposal Types and Lifecycles](#3-proposal-types-and-lifecycles)
4. [Voting Power](#4-voting-power)
5. [Rounds and Categories](#5-rounds-and-categories)
6. [Round Preparation Stage](#6-round-preparation-stage)
7. [Filtering Stage](#7-filtering-stage)
8. [Debate and Vote Stage](#8-debate-and-vote-stage)
9. [Voting Result Stage and Quick Polls](#9-voting-result-stage-and-quick-polls)
10. [Internal Proposals (Threshold Voting)](#10-internal-proposals-threshold-voting)
11. [Funding Stage — Checking Milestones](#11-funding-stage--checking-milestones)
12. [Reward System](#12-reward-system)
13. [Merit Points System](#13-merit-points-system)
14. [DRep Admission and Removal](#14-drep-admission-and-removal)
15. [DAO Treasury](#15-dao-treasury)
16. [Pledge (Skin in the Game)](#16-pledge-skin-in-the-game)
17. [DAO Board (Interim)](#17-dao-board-interim)
18. [Platform Administration](#18-platform-administration)
19. [Submission Form](#19-submission-form)
20. [Communication and Notifications](#20-communication-and-notifications)
21. [Configurable Platform Parameters](#21-configurable-platform-parameters)

**Part II — Technical Architecture**

22. [Technology Stack](#22-technology-stack)
23. [Cardano Integration](#23-cardano-integration)
24. [On-Chain Anchoring](#24-on-chain-anchoring)
25. [Database Schema](#25-database-schema)
26. [API Surface](#26-api-surface)
27. [Background Jobs and Scheduler](#27-background-jobs-and-scheduler)

**Part III — Delivery**

28. [MVP Scope Cut and Phases](#28-mvp-scope-cut-and-phases)
29. [Open Questions and TODOs](#29-open-questions-and-todos)

---

## 1. System Architecture

The DRep DAO platform is a self-hosted web application that integrates directly with the Cardano network. There is no off-platform contract layer.

### High-level component diagram

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 460" font-family="Arial, sans-serif" font-size="13">
  <defs>
    <marker id="ah" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <!-- Users -->
  <rect x="20" y="20" width="120" height="50" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="80" y="42" text-anchor="middle">DReps / Submitters /</text>
  <text x="80" y="58" text-anchor="middle">Board / Viewers</text>
  <!-- Frontend -->
  <rect x="200" y="20" width="140" height="50" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="270" y="42" text-anchor="middle">Web Frontend</text>
  <text x="270" y="58" text-anchor="middle">(React + CIP-30)</text>
  <!-- Backend -->
  <rect x="200" y="160" width="140" height="60" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="270" y="184" text-anchor="middle">DAO Backend</text>
  <text x="270" y="200" text-anchor="middle">(REST + jobs)</text>
  <text x="270" y="214" text-anchor="middle">Source of truth</text>
  <!-- DB -->
  <ellipse cx="270" cy="320" rx="80" ry="30" fill="#fce7f3" stroke="#333"/>
  <text x="270" y="318" text-anchor="middle">PostgreSQL</text>
  <text x="270" y="334" text-anchor="middle">(operational data)</text>
  <!-- Notifications -->
  <rect x="20" y="160" width="140" height="60" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="90" y="184" text-anchor="middle">Notifier</text>
  <text x="90" y="200" text-anchor="middle">In-app · Email</text>
  <text x="90" y="214" text-anchor="middle">Telegram bot</text>
  <!-- Cardano data provider -->
  <rect x="400" y="160" width="160" height="60" rx="6" fill="#d1fae5" stroke="#333"/>
  <text x="480" y="184" text-anchor="middle">Cardano Indexer</text>
  <text x="480" y="200" text-anchor="middle">(Blockfrost / Koios)</text>
  <text x="480" y="214" text-anchor="middle">Read-only queries</text>
  <!-- Cardano network -->
  <rect x="600" y="20" width="140" height="60" rx="6" fill="#d1fae5" stroke="#333"/>
  <text x="670" y="44" text-anchor="middle">Cardano Network</text>
  <text x="670" y="60" text-anchor="middle">(Preview → Mainnet)</text>
  <!-- DAO multisig -->
  <rect x="600" y="160" width="140" height="60" rx="6" fill="#d1fae5" stroke="#333"/>
  <text x="670" y="184" text-anchor="middle">DAO Multisig</text>
  <text x="670" y="200" text-anchor="middle">3-of-5 Wallet</text>
  <text x="670" y="214" text-anchor="middle">(operated by Board)</text>
  <!-- Anchoring service -->
  <rect x="400" y="300" width="160" height="60" rx="6" fill="#fde68a" stroke="#333"/>
  <text x="480" y="324" text-anchor="middle">Anchor Service</text>
  <text x="480" y="340" text-anchor="middle">(hash + sign + submit</text>
  <text x="480" y="354" text-anchor="middle">metadata TX)</text>
  <!-- Intersect (external) -->
  <rect x="600" y="300" width="140" height="60" rx="6" fill="#e5e7eb" stroke="#333" stroke-dasharray="4 3"/>
  <text x="670" y="324" text-anchor="middle">Intersect</text>
  <text x="670" y="340" text-anchor="middle">(off-platform,</text>
  <text x="670" y="354" text-anchor="middle">TW recipient setup)</text>
  <!-- Arrows -->
  <line x1="140" y1="45" x2="195" y2="45" stroke="#333" marker-end="url(#ah)"/>
  <line x1="270" y1="75" x2="270" y2="155" stroke="#333" marker-end="url(#ah)" stroke-dasharray="4 3"/>
  <line x1="270" y1="155" x2="270" y2="75" stroke="#333" marker-end="url(#ah)" stroke-dasharray="4 3"/>
  <line x1="270" y1="225" x2="270" y2="285" stroke="#333" marker-end="url(#ah)"/>
  <line x1="160" y1="190" x2="195" y2="190" stroke="#333" marker-end="url(#ah)"/>
  <line x1="340" y1="190" x2="395" y2="190" stroke="#333" marker-end="url(#ah)"/>
  <line x1="480" y1="155" x2="480" y2="85" stroke="#333" stroke-dasharray="4 3"/>
  <line x1="480" y1="85" x2="595" y2="50" stroke="#333" marker-end="url(#ah)"/>
  <line x1="480" y1="295" x2="480" y2="225" stroke="#333" marker-end="url(#ah)"/>
  <line x1="350" y1="320" x2="395" y2="320" stroke="#333" marker-end="url(#ah)"/>
  <line x1="560" y1="330" x2="595" y2="200" stroke="#333" marker-end="url(#ah)"/>
  <line x1="670" y1="295" x2="670" y2="225" stroke="#333" marker-end="url(#ah)" stroke-dasharray="4 3"/>
</svg>
```

### Component responsibilities

**Web Frontend (browser app)**
- Renders proposals, votes, dashboards, forms
- Wallet connection via CIP-30 (sign-message login)
- Calls backend REST API; does not talk to Cardano directly except for wallet signing

**DAO Backend** *(source of truth)*
- All business logic: proposal lifecycle, voting tally, merit points, reward calculations, reviewer assignment
- REST API for frontend
- Job scheduler for time-based transitions (stage end, notification dispatch)
- Issues signing requests to the board multisig for treasury actions

**PostgreSQL Database**
- All operational data: proposals, votes, comments, users, rewards, configuration
- See section 25 for schema

**Notifier**
- Three channels: in-app notifications (delivered when user is logged in), email (SendGrid or equivalent), Telegram bot
- Templated, throttled, idempotent

**Cardano Indexer**
- Blockfrost on mainnet (paid plan) or Koios (free, community-run) as backup
- Used for: verifying pledge transactions, reading DRep on-chain voting power, reading delegator counts, fetching block hashes for randomness
- All access is **read-only**; no transaction submission through indexer

**DAO Multisig (3-of-5)**
- Holds: round operational budget, submission fees, pledges
- Disburses: rewards, project funding, pledge returns
- Board members run the wallet client (e.g., Eternl) and co-sign transactions prepared by the backend

**Anchor Service**
- Periodically computes Merkle hashes of designated state (proposals, vote tallies, voting power snapshots, merit ledger)
- Builds a Cardano metadata transaction containing the hash + a state identifier
- Submits via a board signer's hot key (operational, not the multisig — see section 24)

**Intersect** *(external, off-platform)*
- Sends the per-round Treasury Withdrawal (project funding + operations) to the DAO Multisig address
- Not integrated programmatically; this is a manual off-chain coordination step

### Authoritative data flows

| Action | Origin of truth | On-chain trace |
|---|---|---|
| Submit proposal | DB | TX hash of submission fee payment |
| Filtering vote cast | DB | Periodic anchor (hash of day's votes) |
| Debate & Vote tally finalized | DB | One-shot anchor at stage end |
| Voting power snapshot | DB (computed from chain data) | Anchor at snapshot time |
| Merit point change | DB ledger | Daily anchor of merit deltas |
| Pledge paid in | Cardano | TX confirmed by indexer, stored in DB |
| Project funding paid out | Cardano | Multisig TX signed by board |
| Reward paid out | Cardano | Multisig TX signed by board |

A DRep can independently verify any of these by querying the platform's read-only verification API, which returns the data and its on-chain anchor reference.

---

## 2. Roles

| Role | Capabilities |
|---|---|
| **Viewer** | Browse all proposals, votes, results, member lists. No login required for read-only; wallet login for personalized views. |
| **Submitter** | Everything a Viewer can do + draft, submit, edit (during permitted windows), pay submission fee, send pledge, submit Proof of Achievement. Identified by wallet stake key. |
| **DRep** | Everything above + opt into filtering pool, opt into milestone review pool, vote in Debate & Vote stage, signal avoid period, provide rationale, submit internal proposals. Identified by on-chain DRep ID. |
| **DRep — Filter Reviewer** | A DRep currently assigned to filter a specific proposal in the current round. Must provide feedback + vote within 1-person-1-vote system. |
| **DRep — Milestone Reviewer** | A DRep (or Expert) assigned to check milestones for a specific funded project. |
| **Expert** | A non-DRep with subject-matter knowledge, eligible only for milestone review. Approved per round by the board. |
| **DAO Board Member** | A DRep with elevated capabilities: configure rounds, confirm assignments, distribute rewards (multisig), admit/remove DReps, prolong periods, launch quick polls. 5 members, 3-of-5 multisig for treasury actions. |
| **Platform Admin** | An operational role, **not** a governance role. Manages the running platform: admin accounts, system health, backups, technical config, anchor hot wallet, genesis approval. Up to 3 Admins. Logs in with username + password + 2FA at `/sysadmin/login`. May or may not also be a DRep / board member — the two identities are separate. See section 18 for details. |

A user can hold multiple roles simultaneously (e.g., a board member can also act as a regular DRep voter in the Debate & Vote stage if they explicitly opt in). The Platform Admin role is independent of all governance roles — see section 18.3.

### Login

There are **two independent authentication systems**:

- **Wallet-based login** (`/login`) — for Viewers, Submitters, DReps, Board Members
  - CIP-30 `signData` with a server-issued nonce; backend verifies signature against the stake key
  - A `User` record is auto-created on first login, keyed by stake key hash
  - DRep status is granted only after admission (see section 14)
  - Session TTL 7 days, rolling
- **Admin login** (`/sysadmin/login`) — for Platform Admins only
  - Username + password (Argon2id) + mandatory 2FA on mainnet
  - Session TTL 4 hours, non-rolling
  - See section 18 for full details

---

## 3. Proposal Types and Lifecycles

### 3.1 Funding Proposals

Submitted by external teams (or DReps after disclosure). Pass through three sequential stages: **Filtering → Debate & Vote → Funding (Milestones)**. Two-phase approval inside Filtering; single-phase vote inside Debate & Vote; multi-milestone funding release.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 240" font-family="Arial, sans-serif" font-size="13">
  <defs>
    <marker id="a1" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="380" y="20" text-anchor="middle" font-weight="bold">Funding Proposal Lifecycle</text>
  <rect x="20" y="80" width="100" height="50" rx="6" fill="#fff" stroke="#333"/>
  <text x="70" y="102" text-anchor="middle">Proposal</text>
  <text x="70" y="118" text-anchor="middle">Submission</text>
  <rect x="160" y="80" width="100" height="50" rx="6" fill="#bfdbfe" stroke="#333"/>
  <text x="210" y="102" text-anchor="middle">Filtering</text>
  <text x="210" y="118" text-anchor="middle">(1p=1v)</text>
  <rect x="300" y="40" width="100" height="40" rx="6" fill="#d1fae5" stroke="#333"/>
  <text x="350" y="65" text-anchor="middle">Accepted</text>
  <rect x="300" y="150" width="100" height="40" rx="6" fill="#fecaca" stroke="#333"/>
  <text x="350" y="175" text-anchor="middle">Rejected</text>
  <rect x="430" y="80" width="110" height="50" rx="6" fill="#bfdbfe" stroke="#333"/>
  <text x="485" y="102" text-anchor="middle">Debate &amp; Vote</text>
  <text x="485" y="118" text-anchor="middle">(balanced)</text>
  <rect x="580" y="40" width="100" height="40" rx="6" fill="#d1fae5" stroke="#333"/>
  <text x="630" y="65" text-anchor="middle">Approved</text>
  <text x="630" y="78" text-anchor="middle" font-size="10">(Funded)</text>
  <rect x="580" y="150" width="100" height="40" rx="6" fill="#fecaca" stroke="#333"/>
  <text x="630" y="175" text-anchor="middle">Rejected</text>
  <rect x="690" y="40" width="60" height="40" rx="6" fill="#bbf7d0" stroke="#333"/>
  <text x="720" y="65" text-anchor="middle">Funding</text>
  <line x1="120" y1="105" x2="155" y2="105" stroke="#333" marker-end="url(#a1)"/>
  <line x1="260" y1="100" x2="295" y2="80" stroke="#333" marker-end="url(#a1)"/>
  <line x1="260" y1="115" x2="295" y2="160" stroke="#333" marker-end="url(#a1)"/>
  <line x1="400" y1="60" x2="430" y2="100" stroke="#333" marker-end="url(#a1)"/>
  <line x1="540" y1="100" x2="575" y2="60" stroke="#333" marker-end="url(#a1)"/>
  <line x1="540" y1="110" x2="575" y2="160" stroke="#333" marker-end="url(#a1)"/>
  <line x1="680" y1="60" x2="690" y2="60" stroke="#333" marker-end="url(#a1)"/>
</svg>
```

### 3.2 Internal Proposals

Submitted by DReps or board members. Single Vote stage. No filtering. No edits during voting (only comments). May be submitted at any time, independently of rounds.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 200" font-family="Arial, sans-serif" font-size="13">
  <defs>
    <marker id="a2" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="350" y="20" text-anchor="middle" font-weight="bold">Internal Proposal Lifecycle</text>
  <rect x="20" y="80" width="100" height="50" rx="6" fill="#fff" stroke="#333"/>
  <text x="70" y="108" text-anchor="middle">Submission</text>
  <rect x="200" y="80" width="160" height="50" rx="6" fill="#bfdbfe" stroke="#333"/>
  <text x="280" y="102" text-anchor="middle">Vote Process</text>
  <text x="280" y="118" text-anchor="middle" font-size="11">(no edits during voting)</text>
  <rect x="440" y="40" width="120" height="40" rx="6" fill="#d1fae5" stroke="#333"/>
  <text x="500" y="65" text-anchor="middle">Approved</text>
  <rect x="440" y="150" width="120" height="40" rx="6" fill="#fecaca" stroke="#333"/>
  <text x="500" y="175" text-anchor="middle">Rejected</text>
  <line x1="120" y1="105" x2="195" y2="105" stroke="#333" marker-end="url(#a2)"/>
  <line x1="360" y1="100" x2="435" y2="60" stroke="#333" marker-end="url(#a2)"/>
  <line x1="360" y1="115" x2="435" y2="160" stroke="#333" marker-end="url(#a2)"/>
</svg>
```

### 3.3 Statuses

| Status | Funding | Internal | Meaning |
|---|---|---|---|
| **DRAFT** | ✓ | ✓ | Saved by submitter, not yet submitted. Visible only to submitter. |
| **PENDING** | ✓ | — | Submitter or board action required (fee check, pledge sending) |
| **ACTIVE** | ✓ | ✓ | Open for voting and/or editing during the current stage |
| **APPROVED** | ✓ | ✓ | Voting concluded positively. For funding: proceeds to milestone funding. |
| **REJECTED** | ✓ | ✓ | Voting concluded negatively, or threshold not reached, or expired |
| **COMPLETE** | ✓ | — | All milestones delivered |
| **FAILED** | ✓ | — | Project terminated before all milestones delivered |

**Status transition graph for funding proposals:**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 360" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="a3" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="410" y="22" text-anchor="middle" font-weight="bold">Funding Proposal — Status Transitions Across Stages</text>
  <!-- Filtering stage band -->
  <rect x="20" y="290" width="240" height="20" fill="#e0f2fe" stroke="#0284c7"/>
  <text x="140" y="304" text-anchor="middle" font-size="11">Filtering stage</text>
  <rect x="270" y="290" width="200" height="20" fill="#e0e7ff" stroke="#4338ca"/>
  <text x="370" y="304" text-anchor="middle" font-size="11">Debate &amp; Vote stage</text>
  <rect x="480" y="290" width="320" height="20" fill="#dcfce7" stroke="#15803d"/>
  <text x="640" y="304" text-anchor="middle" font-size="11">Funding (Milestones) stage</text>
  <!-- Boxes -->
  <rect x="30" y="120" width="80" height="36" rx="5" fill="#f3f4f6" stroke="#333"/>
  <text x="70" y="142" text-anchor="middle">DRAFT</text>
  <rect x="130" y="120" width="80" height="36" rx="5" fill="#fef9c3" stroke="#333"/>
  <text x="170" y="142" text-anchor="middle">PENDING</text>
  <text x="170" y="100" text-anchor="middle" font-size="10">fee paid?</text>
  <rect x="230" y="120" width="80" height="36" rx="5" fill="#bfdbfe" stroke="#333"/>
  <text x="270" y="142" text-anchor="middle">ACTIVE</text>
  <rect x="330" y="120" width="100" height="36" rx="5" fill="#bfdbfe" stroke="#333"/>
  <text x="380" y="142" text-anchor="middle">ACTIVE (D&amp;V)</text>
  <rect x="450" y="60" width="100" height="36" rx="5" fill="#fef9c3" stroke="#333"/>
  <text x="500" y="82" text-anchor="middle">PENDING</text>
  <text x="500" y="50" text-anchor="middle" font-size="10">pledge sent?</text>
  <rect x="580" y="60" width="100" height="36" rx="5" fill="#dcfce7" stroke="#333"/>
  <text x="630" y="82" text-anchor="middle">APPROVED</text>
  <rect x="700" y="60" width="90" height="36" rx="5" fill="#86efac" stroke="#333"/>
  <text x="745" y="82" text-anchor="middle">COMPLETE</text>
  <rect x="700" y="200" width="90" height="36" rx="5" fill="#fca5a5" stroke="#333"/>
  <text x="745" y="222" text-anchor="middle">FAILED</text>
  <rect x="320" y="200" width="100" height="36" rx="5" fill="#fecaca" stroke="#333"/>
  <text x="370" y="222" text-anchor="middle">REJECTED (D&amp;V)</text>
  <rect x="200" y="200" width="100" height="36" rx="5" fill="#fecaca" stroke="#333"/>
  <text x="250" y="222" text-anchor="middle">REJECTED (filter)</text>
  <!-- Arrows -->
  <line x1="110" y1="138" x2="128" y2="138" stroke="#333" marker-end="url(#a3)"/>
  <line x1="210" y1="138" x2="228" y2="138" stroke="#333" marker-end="url(#a3)"/>
  <line x1="310" y1="138" x2="328" y2="138" stroke="#333" marker-end="url(#a3)"/>
  <line x1="270" y1="156" x2="270" y2="198" stroke="#333" marker-end="url(#a3)"/>
  <line x1="380" y1="156" x2="380" y2="198" stroke="#333" marker-end="url(#a3)"/>
  <line x1="430" y1="138" x2="448" y2="100" stroke="#333" marker-end="url(#a3)"/>
  <line x1="430" y1="138" x2="578" y2="80" stroke="#333" marker-end="url(#a3)" stroke-dasharray="4 3"/>
  <line x1="550" y1="80" x2="578" y2="80" stroke="#333" marker-end="url(#a3)"/>
  <line x1="680" y1="80" x2="698" y2="80" stroke="#333" marker-end="url(#a3)"/>
  <line x1="630" y1="96" x2="745" y2="198" stroke="#333" marker-end="url(#a3)" stroke-dasharray="3 3"/>
  <text x="700" y="160" font-size="10" fill="#666">terminated</text>
</svg>
```

Notes on `PENDING`:
- **After submission:** proposal is `PENDING` until backend confirms the submission-fee TX hash on-chain, then transitions to `ACTIVE`.
- **After approval (before milestone funding):** if a pledge is required, proposal is `PENDING` until the board confirms the pledge has been received, then transitions to `APPROVED` / milestone funding begins.

### 3.4 Proposal Structure

Both funding and internal proposals share a common header; type-specific fields are added on top.

**Common fields (all proposals):**

- `id` (UUID)
- `type` — `FUNDING` or `INTERNAL`
- `status` — see table above
- `stage` — `FILTERING` / `DEBATE_VOTE` / `FUNDING` (funding only) / `VOTING` (internal only)
- `submitter_user_id`, `submitter_drep_id` (if applicable)
- `title`, `content` (markdown)
- `category_id` (FK)
- `submitted_at`, `voting_start_at`, `voting_end_at`, `result_finalized_at`
- `voting_type` — `ONE_PERSON_ONE_VOTE` or `BALANCED`
- `approval_threshold_pct` — 51, 67, 75, … (set by platform per proposal kind)
- `version` (incremented on each edit; older versions retained for audit)
- `round_id` (funding only; nullable for internal)

**Funding-specific fields:**

- `requested_amount_ada`
- `is_commercial` (boolean — determines submission-fee tier)
- `submission_fee_ada` (computed at submission time)
- `submission_fee_tx_hash` (provided by submitter)
- `pledge_amount_ada` (0 if no pledge required)
- `pledge_return_method` — `LAST_MILESTONE` or `PER_MILESTONE`
- `pledge_tx_hash` (provided by submitter when sending pledge)
- `milestones[]` — array of `{ idx, description, amount_ada, deadline }`
- `team_info`, `cost_breakdown`, `revenue_sharing`
- `category_type` — `GRANT` or `RFP`

**Internal-specific fields:**

- `internal_type` — `INSTRUCTIVE`, `INFORMATIVE`, `POLL`
- `voters_scope` — `DREPS_ONLY`, `BOARD_ONLY`, `BOTH`
- `actors[]` (for `INSTRUCTIVE`) — who is supposed to act
- `delivery_date` (for `INSTRUCTIVE`)
- `poll_options[]` (for `POLL`)
- `threshold_kind` — `DEFAULT` or `IMPORTANT` (selects which configurable threshold to apply)

### 3.5 Proposal Queues

The platform exposes browsable queues per round and a unified internal queue.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 320" font-family="Arial, sans-serif" font-size="11">
  <text x="440" y="22" text-anchor="middle" font-weight="bold">Proposal Queues</text>
  <!-- Old round -->
  <rect x="20" y="50" width="130" height="240" rx="8" fill="#f3f4f6" stroke="#333"/>
  <text x="85" y="70" text-anchor="middle" font-weight="bold">OLD ROUND(S)</text>
  <text x="85" y="84" text-anchor="middle" font-size="10">Round 1 (closed)</text>
  <rect x="35" y="100" width="100" height="28" rx="4" fill="#bbf7d0" stroke="#333"/>
  <text x="85" y="118" text-anchor="middle">Approved</text>
  <rect x="35" y="135" width="100" height="28" rx="4" fill="#fca5a5" stroke="#333"/>
  <text x="85" y="153" text-anchor="middle">Rejected</text>
  <rect x="35" y="170" width="100" height="28" rx="4" fill="#fde68a" stroke="#333"/>
  <text x="85" y="188" text-anchor="middle">Failed</text>
  <!-- Active round drafts -->
  <rect x="170" y="50" width="130" height="240" rx="8" fill="#fffbeb" stroke="#333"/>
  <text x="235" y="70" text-anchor="middle" font-weight="bold">ACTIVE: DRAFTS</text>
  <text x="235" y="84" text-anchor="middle" font-size="10">Round 2</text>
  <rect x="185" y="100" width="100" height="28" rx="4" fill="#f3f4f6" stroke="#333"/>
  <text x="235" y="118" text-anchor="middle">Draft</text>
  <rect x="185" y="135" width="100" height="28" rx="4" fill="#f3f4f6" stroke="#333"/>
  <text x="235" y="153" text-anchor="middle">Draft</text>
  <!-- Active pending -->
  <rect x="320" y="50" width="130" height="240" rx="8" fill="#fef9c3" stroke="#333"/>
  <text x="385" y="70" text-anchor="middle" font-weight="bold">ACTIVE: PENDING</text>
  <text x="385" y="84" text-anchor="middle" font-size="10">Round 2</text>
  <rect x="335" y="100" width="100" height="28" rx="4" fill="#fef9c3" stroke="#333"/>
  <text x="385" y="118" text-anchor="middle">Pending fee</text>
  <rect x="335" y="135" width="100" height="28" rx="4" fill="#fef9c3" stroke="#333"/>
  <text x="385" y="153" text-anchor="middle">Pending pledge</text>
  <!-- Active filtering/D&V -->
  <rect x="470" y="50" width="130" height="240" rx="8" fill="#dbeafe" stroke="#333"/>
  <text x="535" y="70" text-anchor="middle" font-weight="bold">ACTIVE</text>
  <text x="535" y="84" text-anchor="middle" font-size="10">In filtering / D&amp;V</text>
  <rect x="485" y="100" width="100" height="28" rx="4" fill="#bfdbfe" stroke="#333"/>
  <text x="535" y="118" text-anchor="middle">Active (filter)</text>
  <rect x="485" y="135" width="100" height="28" rx="4" fill="#bfdbfe" stroke="#333"/>
  <text x="535" y="153" text-anchor="middle">Active (D&amp;V)</text>
  <!-- Approved (funding) -->
  <rect x="620" y="50" width="130" height="240" rx="8" fill="#dcfce7" stroke="#333"/>
  <text x="685" y="70" text-anchor="middle" font-weight="bold">FUNDED</text>
  <text x="685" y="84" text-anchor="middle" font-size="10">Milestones ongoing</text>
  <rect x="635" y="100" width="100" height="28" rx="4" fill="#bbf7d0" stroke="#333"/>
  <text x="685" y="118" text-anchor="middle">Approved</text>
  <rect x="635" y="135" width="100" height="28" rx="4" fill="#bbf7d0" stroke="#333"/>
  <text x="685" y="153" text-anchor="middle">Approved</text>
  <!-- Internals -->
  <rect x="770" y="50" width="100" height="240" rx="8" fill="#ede9fe" stroke="#333"/>
  <text x="820" y="70" text-anchor="middle" font-weight="bold">INTERNALS</text>
  <text x="820" y="84" text-anchor="middle" font-size="10">all-time</text>
  <rect x="780" y="100" width="80" height="28" rx="4" fill="#c4b5fd" stroke="#333"/>
  <text x="820" y="118" text-anchor="middle">Active</text>
  <rect x="780" y="135" width="80" height="28" rx="4" fill="#bbf7d0" stroke="#333"/>
  <text x="820" y="153" text-anchor="middle">Approved</text>
  <rect x="780" y="170" width="80" height="28" rx="4" fill="#fca5a5" stroke="#333"/>
  <text x="820" y="188" text-anchor="middle">Rejected</text>
</svg>
```

---

## 4. Voting Power

### 4.1 Two systems used at different stages

| Stage | System | Rationale |
|---|---|---|
| Filtering (per-proposal review by 5 DReps) | **1-person = 1 vote** | Small jury; balanced power is meaningless with 5 voters |
| Milestone checking (per-proposal review by ~3 DReps) | **1-person = 1 vote** | Same reasoning |
| Debate & Vote (funding) | **Balanced voting power** | Reflects on-chain delegation; tempered by merit |
| Internal proposals (Vote stage) | **Balanced voting power** | Same |
| Quick polls (tie-breaks) | **Balanced voting power** | Consistent with the parent D&V stage |
| Board-only internal proposals | **1 member = 1 vote** (5 voters) | Small group |

### 4.2 Balanced voting power formula

```
BasePower      = log10(on_chain_stake_in_lovelace_div_1_million)
MeritMultiplier = 1 + (merit_points / 200)         where merit_points in [-200, +200]
FinalPower     = BasePower × MeritMultiplier
```

Worked example:

| On-chain stake (ADA) | BasePower (log10) | Merit | Multiplier | FinalPower |
|---|---|---|---|---|
| 100,000 | 5 | 0 | 1.00 | 5.0 |
| 1,000,000 | 6 | +100 | 1.50 | 9.0 |
| 100,000,000 | 8 | −100 | 0.50 | 4.0 |
| 100,000,000 | 8 | +200 | 2.00 | 16.0 (max) |
| 1,000,000 | 6 | −200 | 0.00 | 0.0 (min) |

A DRep at -200 merit effectively has zero voting power. This is deliberate: it serves as a "soft removal" without requiring a board action. A DRep at +200 doubles their voice.

### 4.3 Snapshots

- **When taken:** At the moment voting opens for a proposal. Frozen for the duration of voting and result-calculation.
- **What's captured per voter:** stake (Lovelace), merit points, BasePower, MeritMultiplier, FinalPower
- **Persistence:** Stored in `vote_snapshot` table with proposal_id; anchored on-chain (hash) at snapshot time.
- **Why fixed:** Prevents vote-buying via short-term stake movement; verifiable post-hoc.

### 4.4 Abstain and missing votes — denominator rules

| Vote | Counts toward denominator? | Earns merit? |
|---|---|---|
| YES | yes | +1 |
| NO | yes | +1 |
| ABSTAIN | **subtracted from denominator** | 0 |
| No vote cast (no avoid signaled) | yes (as implicit NO) | −1 |
| No vote cast (avoid signaled) | yes (as implicit NO) | 0 |

Approval formula:
```
approved iff (yes_power) / (total_power - abstain_power) >= threshold
```

Worked examples (threshold 75%):

| Total power | YES | NO | Abstain | Missing | Denominator | YES% | Result |
|---|---|---|---|---|---|---|---|
| 36 | 28 | 8 | 0 | 0 | 36 | 77.8% | APPROVED |
| 36 | 20 | 8 | 8 | 0 | 28 | 71.4% | REJECTED |
| 36 | 17 | 8 | 0 | 11 (impl. NO) | 36 | 47.2% | REJECTED |

---

## 5. Rounds and Categories

### 5.1 Concepts

A **round** is the unit of operation. It bundles:
- A budget (received from Intersect via Treasury Withdrawal)
- A set of categories (board-defined per round)
- A sequence of stages: Preparation → Filtering → Debate & Vote → Voting Result → Funding (Milestones)
- A roster of eligible DReps

Multiple rounds can be active simultaneously, but **only one Filtering _or_ Debate & Vote stage can be active at any time** (operational simplification — reviewing DReps shouldn't be torn between two rounds, and a later round must never be further along than an earlier one).

### 5.2 Round structure (single round, time-wise)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 160" font-family="Arial, sans-serif" font-size="13">
  <text x="400" y="22" text-anchor="middle" font-weight="bold">Round Structure (single round)</text>
  <rect x="40" y="50" width="160" height="50" fill="#dbeafe" stroke="#333"/>
  <text x="120" y="78" text-anchor="middle">FILTERING</text>
  <text x="120" y="120" text-anchor="middle" font-size="11">6–8 weeks</text>
  <rect x="200" y="50" width="200" height="50" fill="#c7d2fe" stroke="#333"/>
  <text x="300" y="78" text-anchor="middle">DEBATE &amp; VOTE</text>
  <text x="300" y="120" text-anchor="middle" font-size="11">6–10 weeks</text>
  <rect x="400" y="50" width="360" height="50" fill="#bbf7d0" stroke="#333"/>
  <text x="580" y="78" text-anchor="middle">MILESTONE-BASED FUNDING</text>
  <text x="580" y="120" text-anchor="middle" font-size="11">1–1.5 years</text>
</svg>
```

### 5.3 Categories

Each round defines a list of **categories**. A category has:
- Name and description
- `category_type` — `GRANT` (multi-winner) or `RFP` (single-winner)
- Allocated budget (ADA)
- Min and max funding request per proposal
- Conditions / restrictions text

Two categories may share a name if they have different types (e.g., "Ecosystem Growth [GRANT]" vs "Ecosystem Growth [RFP]"). Only one RFP per unique name per round.

**Subcategories** (cross-cutting tags) are configurable globally by the board, used for matching proposals to filtering DReps by expertise. Defaults: *Governance, DeFi, RWA & Tokenization, L2s, Liquidity, Infrastructure, Hackathon, Meetup, Ecosystem, Tooling, Libraries, Documentation, Marketing*.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 220" font-family="Arial, sans-serif" font-size="12">
  <text x="350" y="22" text-anchor="middle" font-weight="bold">Round Categories — example</text>
  <rect x="20" y="40" width="660" height="160" rx="8" fill="#f9fafb" stroke="#333"/>
  <text x="350" y="62" text-anchor="middle" font-weight="bold">ROUND 1</text>
  <rect x="40" y="80" width="140" height="40" rx="4" fill="#fee2e2" stroke="#333"/>
  <text x="110" y="95" text-anchor="middle">Governance</text>
  <text x="110" y="110" text-anchor="middle" font-size="10">GRANT · 1M ADA</text>
  <rect x="190" y="80" width="140" height="40" rx="4" fill="#fee2e2" stroke="#333"/>
  <text x="260" y="95" text-anchor="middle">DeFi</text>
  <text x="260" y="110" text-anchor="middle" font-size="10">GRANT · 1M ADA</text>
  <rect x="340" y="80" width="140" height="40" rx="4" fill="#fee2e2" stroke="#333"/>
  <text x="410" y="95" text-anchor="middle">Ecosystem</text>
  <text x="410" y="110" text-anchor="middle" font-size="10">GRANT · 1M ADA</text>
  <rect x="490" y="80" width="170" height="40" rx="4" fill="#dbeafe" stroke="#333"/>
  <text x="575" y="95" text-anchor="middle">Ecosystem Growth</text>
  <text x="575" y="110" text-anchor="middle" font-size="10">RFP · 1M ADA · 1 winner</text>
  <rect x="40" y="140" width="140" height="40" rx="4" fill="#fee2e2" stroke="#333"/>
  <text x="110" y="155" text-anchor="middle">Research</text>
  <text x="110" y="170" text-anchor="middle" font-size="10">GRANT · 500K ADA</text>
</svg>
```

### 5.4 Round lifecycle and parallel rounds

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 280" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="ar1" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="440" y="22" text-anchor="middle" font-weight="bold">Parallel Rounds — staggered start, overlapping funding stage</text>
  <!-- Round 1 -->
  <rect x="40" y="50" width="80" height="36" fill="#dbeafe" stroke="#333"/>
  <text x="80" y="72" text-anchor="middle">FILTER</text>
  <rect x="120" y="50" width="100" height="36" fill="#c7d2fe" stroke="#333"/>
  <text x="170" y="72" text-anchor="middle">D &amp; V</text>
  <rect x="220" y="50" width="540" height="36" fill="#bbf7d0" stroke="#333"/>
  <text x="490" y="72" text-anchor="middle">MILESTONE FUNDING (Round 1)</text>
  <!-- Round 2 -->
  <rect x="200" y="100" width="80" height="36" fill="#dbeafe" stroke="#333"/>
  <text x="240" y="122" text-anchor="middle">FILTER</text>
  <rect x="280" y="100" width="100" height="36" fill="#c7d2fe" stroke="#333"/>
  <text x="330" y="122" text-anchor="middle">D &amp; V</text>
  <rect x="380" y="100" width="380" height="36" fill="#bbf7d0" stroke="#333"/>
  <text x="570" y="122" text-anchor="middle">MILESTONE FUNDING (Round 2)</text>
  <!-- Round 3 -->
  <rect x="380" y="150" width="80" height="36" fill="#dbeafe" stroke="#333"/>
  <text x="420" y="172" text-anchor="middle">FILTER</text>
  <rect x="460" y="150" width="100" height="36" fill="#c7d2fe" stroke="#333"/>
  <text x="510" y="172" text-anchor="middle">D &amp; V</text>
  <rect x="560" y="150" width="200" height="36" fill="#bbf7d0" stroke="#333"/>
  <text x="660" y="172" text-anchor="middle">MILESTONE FUNDING (R3)</text>
  <!-- Time axis -->
  <line x1="40" y1="220" x2="780" y2="220" stroke="#333" marker-end="url(#ar1)"/>
  <text x="100" y="240" text-anchor="middle" font-size="11">Year 1</text>
  <text x="450" y="240" text-anchor="middle" font-size="11">Year 2</text>
  <line x1="440" y1="215" x2="440" y2="225" stroke="#333"/>
  <text x="50" y="260" font-size="11" fill="#666">Note: only ONE Filtering OR Debate &amp; Vote stage is active at any given time across all rounds.</text>
</svg>
```

### 5.5 Leftover funds

If a project fails to deliver all milestones, its remaining allocation is **not** redistributed within the same round. Instead, at round close (when the last milestone-checking stage ends), the platform produces a leftover report and the board moves the unused funds either to a subsequent round's budget address or returns them to the Cardano Treasury via the multisig.

This is handled **operationally** by the board, not automatically by the platform.

---

## 6. Round Preparation Stage

When a round is started, the board configures it before the Submission period opens. All settings remain editable mid-round (with auto-shift of dependent periods).

**Configuration fields:**

- `round_number` (auto), `round_name` (optional override)
- `categories[]` — name, type (GRANT/RFP), description, conditions, min/max ADA, allocated budget
- `submission_template_id` per category
- `eligible_dreps[]` — defaults to all admitted DReps; board can deselect
- `filter_reviewer_count` — default 5
- `filter_approval_votes` — default 3
- `dv_approval_threshold_pct` — default 67
- `milestone_reviewer_count` — default 3
- Period start/end dates for each sub-stage:
  - Submission start / end
  - Filtering Feedback 1 start / end
  - Editing window (overlaps with Feedback 1 in part, must end before Feedback 2)
  - Filtering Feedback 2 start / end
  - D&V Feedback start / end
  - D&V Editing start / end
  - D&V Voting start / end
  - Voting Result validation start / end
  - Voting Result publication date

**Auto-shift rule:** If the board edits any period to extend it, all subsequent periods shift by the same delta. The platform writes the new schedule to a `round_schedule_history` audit log.

**Board action required when:**
- A DRep can't vote and there's no obvious replacement (rare)
- A voting period needs explicit prolongation
- Submissions arrived with unpaid fees and the period is ending

---

## 7. Filtering Stage

Goal: 5 randomly selected DReps decide whether a proposal proceeds to Debate & Vote. Default approval: 3 of 5.

### 7.1 Reviewer assignment

A DRep opts into the filtering pool and declares **subcategories** they understand. When the Submission stage ends, the platform automatically assigns reviewers per proposal:

1. **Filter the pool by category match** — collect all opted-in DReps whose declared subcategories overlap with the proposal's subcategories.
2. **Random draw within the filtered subset** — using a verifiable seed derived from the latest Cardano block hash + proposal id, draw 5 DReps. The algorithm preferentially picks DReps who have been assigned the fewest times this round (equal-participation property).
3. **Notify the 5 DReps** — they have 2 days to accept the assignment.
4. **If an assigned DRep declines or doesn't respond in 48h:** the platform draws 3 replacements; the first to accept gets the assignment.
5. **If an assigned DRep later signals avoid (vacation/sickness):** auto-reassigned (per decision #31), no merit penalty.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 360" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="af" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="440" y="22" text-anchor="middle" font-weight="bold">Filtering — Reviewer Assignment and Voting</text>
  <!-- Pool -->
  <rect x="30" y="50" width="220" height="60" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="140" y="78" text-anchor="middle">DRep filtering pool</text>
  <text x="140" y="94" text-anchor="middle" font-size="10">(all DReps opted in)</text>
  <!-- Category filter -->
  <rect x="290" y="50" width="180" height="60" rx="6" fill="#fde68a" stroke="#333"/>
  <text x="380" y="78" text-anchor="middle">Category-match filter</text>
  <text x="380" y="94" text-anchor="middle" font-size="10">(subcategory overlap)</text>
  <!-- Random draw -->
  <rect x="510" y="50" width="180" height="60" rx="6" fill="#fcd34d" stroke="#333"/>
  <text x="600" y="74" text-anchor="middle">Random draw</text>
  <text x="600" y="90" text-anchor="middle" font-size="10">seed = blockhash + proposal_id</text>
  <text x="600" y="104" text-anchor="middle" font-size="10">prefer least-assigned DReps</text>
  <!-- Assigned 5 -->
  <rect x="290" y="160" width="400" height="60" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="490" y="184" text-anchor="middle">5 assigned DReps — must accept within 2 days</text>
  <text x="490" y="202" text-anchor="middle" font-size="10">declines / no-show → draw 3 replacements (first-accept wins)</text>
  <!-- Vote 1 -->
  <rect x="40" y="260" width="200" height="60" rx="6" fill="#bfdbfe" stroke="#333"/>
  <text x="140" y="282" text-anchor="middle">Feedback &amp; Vote 1</text>
  <text x="140" y="300" text-anchor="middle" font-size="10">1p=1v · ≥3 YES → ACCEPTED</text>
  <text x="140" y="314" text-anchor="middle" font-size="10">&lt;3 YES → submitter may edit</text>
  <rect x="280" y="260" width="200" height="60" rx="6" fill="#fde68a" stroke="#333"/>
  <text x="380" y="282" text-anchor="middle">Editing period</text>
  <text x="380" y="300" text-anchor="middle" font-size="10">submitter revises &amp; resubmits</text>
  <rect x="520" y="260" width="200" height="60" rx="6" fill="#bfdbfe" stroke="#333"/>
  <text x="620" y="282" text-anchor="middle">Feedback &amp; Vote 2</text>
  <text x="620" y="300" text-anchor="middle" font-size="10">final accept or reject</text>
  <line x1="250" y1="80" x2="285" y2="80" stroke="#333" marker-end="url(#af)"/>
  <line x1="470" y1="80" x2="505" y2="80" stroke="#333" marker-end="url(#af)"/>
  <line x1="600" y1="110" x2="490" y2="158" stroke="#333" marker-end="url(#af)"/>
  <line x1="240" y1="290" x2="278" y2="290" stroke="#333" marker-end="url(#af)"/>
  <line x1="480" y1="290" x2="518" y2="290" stroke="#333" marker-end="url(#af)"/>
</svg>
```

### 7.2 Voting logic

- Each of the 5 assigned DReps casts **YES**, **NO**, or **ABSTAIN** (abstain only for conflict of interest or signaled avoid).
- If 3 YES are reached before the period ends, the proposal can be moved to ACCEPTED immediately (no need to wait for stragglers — the result is mathematically determined).
- If 3 NO are reached, similarly: the proposal is REJECTED immediately and moves to the editing period.
- An ABSTAIN triggers automatic reassignment to another DRep (since 1p=1v needs a cast vote).
- A NO vote requires written rationale. YES vote: rationale optional.

### 7.3 Timeline (visual)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 280" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="at" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="430" y="22" text-anchor="middle" font-weight="bold">Filtering Stage — Timeline</text>
  <rect x="30" y="60" width="140" height="40" fill="#fff" stroke="#333"/>
  <text x="100" y="84" text-anchor="middle">Submission window</text>
  <rect x="180" y="60" width="180" height="40" fill="#bfdbfe" stroke="#333"/>
  <text x="270" y="84" text-anchor="middle">Feedback &amp; Vote 1</text>
  <rect x="370" y="60" width="160" height="40" fill="#fde68a" stroke="#333"/>
  <text x="450" y="84" text-anchor="middle">Editing (if rejected)</text>
  <rect x="540" y="60" width="180" height="40" fill="#bfdbfe" stroke="#333"/>
  <text x="630" y="84" text-anchor="middle">Feedback &amp; Vote 2</text>
  <rect x="730" y="60" width="100" height="40" fill="#dcfce7" stroke="#333"/>
  <text x="780" y="80" text-anchor="middle">Result</text>
  <text x="780" y="94" text-anchor="middle" font-size="10">to D&amp;V or final NO</text>
  <text x="100" y="130" text-anchor="middle" font-size="10">2–3 weeks</text>
  <text x="270" y="130" text-anchor="middle" font-size="10">1 week</text>
  <text x="450" y="130" text-anchor="middle" font-size="10">3–5 days</text>
  <text x="630" y="130" text-anchor="middle" font-size="10">1 week</text>
  <text x="430" y="160" text-anchor="middle" font-size="11" fill="#374151">Editing period must overlap Feedback 1 end and finish before Feedback 2 begins.</text>
  <!-- Result clear -->
  <text x="30" y="200" font-weight="bold">Result-clear shortcut:</text>
  <text x="30" y="218" font-size="11">If 3 YES (or 3 NO) reached early → proposal advances/rejects immediately; remaining DReps' votes are recorded but not required for the decision.</text>
  <text x="30" y="240" font-weight="bold">Replacement:</text>
  <text x="30" y="258" font-size="11">If result is not yet clear and a DRep is absent at deadline → auto-extend voting by 3 days and draw a replacement.</text>
</svg>
```

### 7.4 Edge cases

| Case | Handling |
|---|---|
| Assigned DRep doesn't accept in 48h | Draw 3 replacements, first-accept wins |
| Assigned DRep accepts then signals avoid | Auto-replace; no merit penalty |
| 4 DReps voted YES (or NO) — clear result | Proposal advances immediately; 5th DRep still gets reward if they vote on time |
| Voting deadline passes with split 2-2 | Auto-extend 3 days, draw a replacement for the missing 5th |
| Submitter resubmits before Feedback 2 | DReps re-review the edited version and vote again |
| Same DRep votes differently in F1 vs F2 | Allowed; only F2 result counts toward final filtering outcome |

---

## 8. Debate and Vote Stage

Once a proposal passes Filtering, it enters Debate & Vote. All admitted DReps can participate; board members can opt in.

### 8.1 Sub-phases

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 220" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="adv" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="430" y="22" text-anchor="middle" font-weight="bold">Debate &amp; Vote Stage — Sub-phases</text>
  <rect x="40" y="60" width="180" height="50" fill="#fff7ed" stroke="#333"/>
  <text x="130" y="80" text-anchor="middle">Feedback / Debate</text>
  <text x="130" y="96" text-anchor="middle" font-size="10">DReps comment; submitter</text>
  <text x="130" y="108" text-anchor="middle" font-size="10">may edit</text>
  <rect x="240" y="60" width="180" height="50" fill="#fff7ed" stroke="#333"/>
  <text x="330" y="80" text-anchor="middle">Editing (extended)</text>
  <text x="330" y="96" text-anchor="middle" font-size="10">Edits close; feedback may</text>
  <text x="330" y="108" text-anchor="middle" font-size="10">continue read-only</text>
  <rect x="440" y="60" width="180" height="50" fill="#bfdbfe" stroke="#333"/>
  <text x="530" y="80" text-anchor="middle">Voting</text>
  <text x="530" y="96" text-anchor="middle" font-size="10">balanced power · 3 options</text>
  <text x="530" y="108" text-anchor="middle" font-size="10">rationale required</text>
  <rect x="640" y="60" width="180" height="50" fill="#dcfce7" stroke="#333"/>
  <text x="730" y="80" text-anchor="middle">Result</text>
  <text x="730" y="96" text-anchor="middle" font-size="10">tally · quick poll (if tie)</text>
  <text x="730" y="108" text-anchor="middle" font-size="10">board publishes</text>
  <line x1="220" y1="85" x2="238" y2="85" stroke="#333" marker-end="url(#adv)"/>
  <line x1="420" y1="85" x2="438" y2="85" stroke="#333" marker-end="url(#adv)"/>
  <line x1="620" y1="85" x2="638" y2="85" stroke="#333" marker-end="url(#adv)"/>
  <text x="430" y="160" text-anchor="middle" font-size="11" fill="#374151">During Voting: votes can be changed (last vote wins). Rationale required for any cast vote.</text>
</svg>
```

### 8.2 Vote mechanics

- **Voters:** all admitted DReps eligible for the round, plus any board members who explicitly opt in
- **Voting power:** snapshotted at vote-start (section 4.3)
- **Options:** `YES`, `NO`, `ABSTAIN`
- **Rationale:** mandatory (minimum 200 characters) for any cast vote
- **Vote change:** allowed during the voting period; the latest vote counts
- **Threshold:** default 67% (configurable per round)

### 8.3 Threshold examples

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 460" font-family="Arial, sans-serif" font-size="11">
  <text x="410" y="22" text-anchor="middle" font-weight="bold">Threshold (75%) — Three Outcomes</text>
  <!-- Case 1 -->
  <text x="30" y="60" font-weight="bold">Case 1 — All vote, no abstain. APPROVED.</text>
  <text x="30" y="78">Total power 36 · YES 28 · NO 8 · Abstain 0 · Denominator 36 · YES% 77.8</text>
  <rect x="30" y="90" width="600" height="22" fill="#fecaca" stroke="#333"/>
  <rect x="30" y="90" width="467" height="22" fill="#86efac" stroke="#333"/>
  <line x1="480" y1="86" x2="480" y2="116" stroke="#dc2626" stroke-width="2"/>
  <text x="488" y="130" font-size="10" fill="#dc2626">threshold 75%</text>
  <!-- Case 2 -->
  <text x="30" y="180" font-weight="bold">Case 2 — Abstain reduces denominator. REJECTED.</text>
  <text x="30" y="198">Total power 36 · YES 20 · NO 8 · Abstain 8 · Denominator 28 · YES% 71.4</text>
  <rect x="30" y="210" width="600" height="22" fill="#fecaca" stroke="#333"/>
  <rect x="30" y="210" width="429" height="22" fill="#86efac" stroke="#333"/>
  <line x1="480" y1="206" x2="480" y2="236" stroke="#dc2626" stroke-width="2"/>
  <text x="488" y="250" font-size="10" fill="#dc2626">threshold 75% of denom 28</text>
  <!-- Case 3 -->
  <text x="30" y="300" font-weight="bold">Case 3 — Missing votes count as implicit NO. REJECTED.</text>
  <text x="30" y="318">Total power 36 · YES 17 · explicit NO 8 · implicit NO 11 · Denominator 36 · YES% 47.2</text>
  <rect x="30" y="330" width="600" height="22" fill="#fecaca" stroke="#333"/>
  <rect x="30" y="330" width="283" height="22" fill="#86efac" stroke="#333"/>
  <line x1="480" y1="326" x2="480" y2="356" stroke="#dc2626" stroke-width="2"/>
  <text x="488" y="370" font-size="10" fill="#dc2626">threshold 75%</text>
</svg>
```

---

## 9. Voting Result Stage and Quick Polls

After voting ends, the platform automatically computes scores and ranks proposals per category. Funding decisions follow Catalyst-style logic: top-ranked proposals that pass the threshold get funded, up to the category budget.

### 9.1 Auto-ranking

For each category, the platform:
1. Filters proposals that **passed the threshold** (e.g., 67% YES).
2. Sorts by `yes_power` descending, breaks ties by `yes_power / denominator` (the score percentage), then by submission timestamp ascending.
3. Walks down the sorted list, assigning the category budget to proposals until the next proposal would exceed the budget.
4. Proposals that fit → `APPROVED`. Proposals that pass the threshold but don't fit the budget → `REJECTED (budget-cut)`.

### 9.2 Tie-break (Quick Poll)

If two or more proposals at the budget cliff have identical scores, a Quick Poll is triggered.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 340" font-family="Arial, sans-serif" font-size="11">
  <text x="410" y="22" text-anchor="middle" font-weight="bold">Quick Poll — Tie at the Budget Cliff</text>
  <!-- Ranked list -->
  <rect x="40" y="50" width="120" height="30" fill="#bbf7d0" stroke="#333"/>
  <text x="100" y="69" text-anchor="middle">Proposal A · 100</text>
  <text x="180" y="69" font-size="10">funded</text>
  <rect x="40" y="85" width="120" height="30" fill="#bbf7d0" stroke="#333"/>
  <text x="100" y="104" text-anchor="middle">Proposal B · 84</text>
  <text x="180" y="104" font-size="10">funded</text>
  <rect x="40" y="120" width="120" height="30" fill="#fef9c3" stroke="#333"/>
  <text x="100" y="139" text-anchor="middle">Proposal C · 75</text>
  <text x="180" y="139" font-size="10">budget cliff — tie</text>
  <rect x="40" y="155" width="120" height="30" fill="#fef9c3" stroke="#333"/>
  <text x="100" y="174" text-anchor="middle">Proposal D · 75</text>
  <text x="180" y="174" font-size="10">budget cliff — tie</text>
  <line x1="30" y1="190" x2="290" y2="190" stroke="#dc2626" stroke-dasharray="4 3"/>
  <text x="300" y="194" font-size="10" fill="#dc2626">threshold 67%</text>
  <rect x="40" y="200" width="120" height="30" fill="#fecaca" stroke="#333"/>
  <text x="100" y="219" text-anchor="middle">Proposal E · 61</text>
  <!-- Quick poll panel -->
  <rect x="380" y="50" width="400" height="200" rx="8" fill="#fff7ed" stroke="#333"/>
  <text x="580" y="72" text-anchor="middle" font-weight="bold">Quick Poll</text>
  <text x="580" y="92" text-anchor="middle" font-size="10">Auto-triggered by platform; board confirms with one click.</text>
  <text x="395" y="115" font-size="11">• Voting system: balanced voting power (consistent with D&amp;V)</text>
  <text x="395" y="133" font-size="11">• Voters: same eligibility as the D&amp;V stage</text>
  <text x="395" y="151" font-size="11">• Duration: 48 hours (configurable)</text>
  <text x="395" y="169" font-size="11">• Participation threshold: 51% of voting power (configurable)</text>
  <text x="395" y="187" font-size="11">• If threshold not reached: extend up to 3 times</text>
  <text x="395" y="205" font-size="11">• Final fallback: neither tied proposal is funded</text>
  <text x="395" y="223" font-size="11" font-weight="bold">Question: "Which of C or D should be funded?"</text>
</svg>
```

### 9.3 Result publishing

The result becomes visible immediately as votes are tallied (transparency), but is **not official** until:
1. Platform calculates results
2. Board launches quick poll(s) if needed (one-click confirm)
3. Quick poll resolves
4. Board finalizes the result via a "publish" action

The publish action triggers an on-chain anchor (hash of final tally).

---

## 10. Internal Proposals (Threshold Voting)

Internal proposals are decisions about the DAO itself: process changes, board member removal, parameter changes, polls. They can be submitted by any admitted DRep or by a board member.

### 10.1 Structure of an internal proposal

When submitting, the submitter sets:

- `internal_type` — `INSTRUCTIVE` / `INFORMATIVE` / `POLL`
- `voters_scope` — `DREPS_ONLY` / `BOARD_ONLY` / `BOTH`
- `actors[]` (for INSTRUCTIVE only) — who must act if approved
- `threshold_kind` — `DEFAULT` (default 67%) or `IMPORTANT` (default 75%)
- `voting_period_days`
- `delivery_date` (for INSTRUCTIVE)
- `poll_options[]` (for POLL — multiple-choice)

Examples of `IMPORTANT` proposals: removing a board member, replacing the entire board, changing the platform's reward formula.

### 10.2 Lifecycle

`DRAFT → ACTIVE → APPROVED | REJECTED`

- No `PENDING` (no fee, no pledge)
- No editing during the Vote phase; only comments
- No `COMPLETE` (no enforcement authority within the DAO platform — actions are off-platform)

### 10.3 Voting

- Voting system: **balanced voting power** (consistent with D&V), except when `voters_scope = BOARD_ONLY`, in which case 1 member = 1 vote (5 voters).
- Threshold formula: same as Debate & Vote (section 4.4).
- No rationale required (but allowed).
- Vote change allowed during the voting period.

### 10.4 Effect of approval

Approval has **no automatic on-chain action**. The proposal is published, anchored on-chain, and the named `actors` are expected to act off-platform. The platform tracks the `delivery_date` and sends reminder notifications, but enforcement is by social consensus + DRep accountability via merit points.

---

## 11. Funding Stage — Checking Milestones

After D&V approval and pledge confirmation, the proposal enters the Funding stage. This consists of: **Reviewer Assignment → repeated (POA submission → Vote → Disbursement) for each milestone**.

### 11.1 Reviewer assignment

- Same algorithm as filtering: category-match filter, then random draw, prefer least-assigned.
- `milestone_reviewer_count` reviewers per proposal (default 3).
- Reviewers may be DReps or registered Experts.
- **Board must confirm the assignment** before the funding stage begins (any board member can confirm; no vote needed). Board may also reassign at any time.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 220" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="amr" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="410" y="22" text-anchor="middle" font-weight="bold">Milestone Reviewer Assignment</text>
  <rect x="20" y="60" width="180" height="60" rx="6" fill="#dcfce7" stroke="#333"/>
  <text x="110" y="84" text-anchor="middle">Proposal APPROVED</text>
  <text x="110" y="100" text-anchor="middle" font-size="10">(after D&amp;V + pledge)</text>
  <rect x="220" y="60" width="200" height="60" rx="6" fill="#fde68a" stroke="#333"/>
  <text x="320" y="80" text-anchor="middle">Platform nominates</text>
  <text x="320" y="96" text-anchor="middle">3 reviewers</text>
  <text x="320" y="112" text-anchor="middle" font-size="10">category-match + random</text>
  <rect x="440" y="60" width="180" height="60" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="530" y="80" text-anchor="middle">Board confirms</text>
  <text x="530" y="96" text-anchor="middle" font-size="10">(any 1 board member)</text>
  <text x="530" y="112" text-anchor="middle" font-size="10">may swap reviewers</text>
  <rect x="640" y="60" width="160" height="60" rx="6" fill="#bbf7d0" stroke="#333"/>
  <text x="720" y="80" text-anchor="middle">Funding stage</text>
  <text x="720" y="96" text-anchor="middle" font-size="10">begins per milestone</text>
  <line x1="200" y1="90" x2="218" y2="90" stroke="#333" marker-end="url(#amr)"/>
  <line x1="420" y1="90" x2="438" y2="90" stroke="#333" marker-end="url(#amr)"/>
  <line x1="620" y1="90" x2="638" y2="90" stroke="#333" marker-end="url(#amr)"/>
  <text x="410" y="180" text-anchor="middle" font-size="11" fill="#374151">Reviewers may be replaced at any time during funding by any board member.</text>
</svg>
```

### 11.2 Proof of Achievement (POA) submission

For each milestone:
- Submitter uploads/drafts POA on the milestone page (markdown + links to artifacts; no file uploads on-chain, only off-chain links)
- Platform notifies the assigned reviewers immediately
- Reviewers and submitter can communicate via comments

### 11.3 Milestone voting

- 3 reviewers, **1-person = 1 vote**
- YES vote: feedback optional. NO vote: feedback mandatory.
- Abstention not allowed (signaled avoid only).
- Result-clear shortcut: 2 YES (or 2 NO) → milestone closes immediately.
- The board may cast a vote to provide a missing 3rd (replacing an absent reviewer).

### 11.4 Milestone outcomes

| Outcome | Trigger | Action |
|---|---|---|
| Approved | ≥ 2 YES, votes complete OR period expired with YES majority | Funds released; if pledge return is `PER_MILESTONE`, return that portion |
| Rejected (period still open) | ≥ 1 NO with feedback | Submitter may resubmit POA; period auto-extends 4 weeks (configurable) |
| Rejected (period exhausted) | NO majority, no further attempts allowed | Project terminated → `FAILED`. Reviewers get reward for remaining unreviewed milestones (see 12.6). |

### 11.5 Period and prolongation rules

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 320" font-family="Arial, sans-serif" font-size="11">
  <text x="430" y="22" text-anchor="middle" font-weight="bold">Milestone Timeline Variants</text>
  <!-- A: clean approval -->
  <text x="30" y="55" font-weight="bold">A) Clean approval (POA submitted, all reviewers vote YES)</text>
  <rect x="30" y="65" width="200" height="20" fill="#fde68a" stroke="#333"/>
  <text x="130" y="80" text-anchor="middle">Base period to provide POA</text>
  <rect x="230" y="65" width="180" height="20" fill="#bfdbfe" stroke="#333"/>
  <text x="320" y="80" text-anchor="middle">Feedback &amp; Vote</text>
  <rect x="410" y="65" width="80" height="20" fill="#86efac" stroke="#333"/>
  <text x="450" y="80" text-anchor="middle">CLOSED</text>
  <!-- B: rejected, re-submit -->
  <text x="30" y="125" font-weight="bold">B) First POA rejected, second submitted, accepted</text>
  <rect x="30" y="135" width="160" height="20" fill="#fde68a" stroke="#333"/>
  <text x="110" y="150" text-anchor="middle">Base period</text>
  <rect x="190" y="135" width="60" height="20" fill="#fca5a5" stroke="#333"/>
  <text x="220" y="150" text-anchor="middle">NO</text>
  <rect x="250" y="135" width="160" height="20" fill="#fde68a" stroke="#333"/>
  <text x="330" y="150" text-anchor="middle">Auto-extended 4 weeks</text>
  <rect x="410" y="135" width="160" height="20" fill="#bfdbfe" stroke="#333"/>
  <text x="490" y="150" text-anchor="middle">Feedback &amp; Vote (2)</text>
  <rect x="570" y="135" width="80" height="20" fill="#86efac" stroke="#333"/>
  <text x="610" y="150" text-anchor="middle">CLOSED</text>
  <!-- C: board acts -->
  <text x="30" y="195" font-weight="bold">C) Reviewers missing — board extends and replaces</text>
  <rect x="30" y="205" width="160" height="20" fill="#fde68a" stroke="#333"/>
  <text x="110" y="220" text-anchor="middle">Base period</text>
  <rect x="190" y="205" width="180" height="20" fill="#bfdbfe" stroke="#333"/>
  <text x="280" y="220" text-anchor="middle">Feedback &amp; Vote (insufficient)</text>
  <rect x="370" y="205" width="180" height="20" fill="#fbbf24" stroke="#333"/>
  <text x="460" y="220" text-anchor="middle">Board acts (extend / replace)</text>
  <rect x="550" y="205" width="100" height="20" fill="#86efac" stroke="#333"/>
  <text x="600" y="220" text-anchor="middle">CLOSED</text>
  <!-- D: terminal -->
  <text x="30" y="265" font-weight="bold">D) Multiple POAs rejected, period exhausted</text>
  <rect x="30" y="275" width="160" height="20" fill="#fde68a" stroke="#333"/>
  <text x="110" y="290" text-anchor="middle">Base period</text>
  <rect x="190" y="275" width="60" height="20" fill="#fca5a5" stroke="#333"/>
  <text x="220" y="290" text-anchor="middle">NO</text>
  <rect x="250" y="275" width="120" height="20" fill="#fde68a" stroke="#333"/>
  <text x="310" y="290" text-anchor="middle">Extension</text>
  <rect x="370" y="275" width="60" height="20" fill="#fca5a5" stroke="#333"/>
  <text x="400" y="290" text-anchor="middle">NO</text>
  <rect x="430" y="275" width="120" height="20" fill="#dc2626" stroke="#333"/>
  <text x="490" y="290" text-anchor="middle" fill="#fff">FAILED</text>
</svg>
```

| Setting | Default | Notes |
|---|---|---|
| `MILESTONE_NOTIFICATION_DAYS_BEFORE_END` | 3 | Notify submitter that POA is due |
| `MILESTONE_AUTO_EXTENSION_DAYS` | 28 | One automatic 4-week extension if POA missing or rejected |
| `MILESTONE_CHECK_PERIOD_DAYS` | 10 | After POA submitted, reviewers have 10 days |
| `MILESTONE_BOARD_EXTRA_EXTENSION_DAYS` | 90 max, one-time | Only the board can grant this |

The board may also terminate a project at any time (e.g., due to non-response), setting status to `FAILED`.

---

## 12. Reward System

### 12.1 Income sources and sinks

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 360" font-family="Arial, sans-serif" font-size="11">
  <defs>
    <marker id="ar" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="440" y="22" text-anchor="middle" font-weight="bold">Reward Sources → Sinks</text>
  <!-- Sources -->
  <rect x="30" y="60" width="180" height="50" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="120" y="82" text-anchor="middle" font-weight="bold">Submission fees</text>
  <text x="120" y="98" text-anchor="middle" font-size="10">Commercial 2–3% · OSS 1%</text>
  <rect x="30" y="160" width="180" height="50" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="120" y="182" text-anchor="middle" font-weight="bold">Round rewards bucket</text>
  <text x="120" y="198" text-anchor="middle" font-size="10">5% of TW (or fixed amount)</text>
  <!-- Sinks -->
  <rect x="380" y="60" width="180" height="50" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="470" y="82" text-anchor="middle">Filtering DReps</text>
  <text x="470" y="98" text-anchor="middle" font-size="10">fixed reward only</text>
  <rect x="380" y="130" width="180" height="50" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="470" y="152" text-anchor="middle">D&amp;V DReps — fixed</text>
  <text x="470" y="168" text-anchor="middle" font-size="10">70% of D&amp;V allocation</text>
  <rect x="380" y="195" width="180" height="50" rx="6" fill="#c7d2fe" stroke="#333"/>
  <text x="470" y="217" text-anchor="middle">D&amp;V DReps — bonus</text>
  <text x="470" y="233" text-anchor="middle" font-size="10">30% of D&amp;V allocation</text>
  <rect x="380" y="260" width="180" height="50" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="470" y="282" text-anchor="middle">Milestone reviewers</text>
  <text x="470" y="298" text-anchor="middle" font-size="10">fixed only · 40% of round bucket</text>
  <!-- Arrows -->
  <line x1="210" y1="85" x2="378" y2="85" stroke="#333" marker-end="url(#ar)"/>
  <line x1="210" y1="185" x2="378" y2="155" stroke="#333" marker-end="url(#ar)"/>
  <line x1="210" y1="185" x2="378" y2="220" stroke="#333" marker-end="url(#ar)"/>
  <line x1="210" y1="185" x2="378" y2="280" stroke="#333" marker-end="url(#ar)"/>
  <!-- Cap note -->
  <rect x="600" y="60" width="260" height="240" rx="6" fill="#f3f4f6" stroke="#666"/>
  <text x="730" y="82" text-anchor="middle" font-weight="bold">Splits (defaults, all configurable)</text>
  <text x="615" y="108" font-size="11">• Submission fees → 100% Filtering, no bonus</text>
  <text x="615" y="128" font-size="11">• Round bucket → 60% D&amp;V, 40% Milestones</text>
  <text x="615" y="148" font-size="11">• D&amp;V slice → 70% fixed, 30% bonus</text>
  <text x="615" y="168" font-size="11">• Milestone slice → 100% fixed, no bonus</text>
  <text x="615" y="198" font-size="11" font-weight="bold">FEE_CAP_PER_ROUND</text>
  <text x="615" y="216" font-size="11">If submission fees exceed cap, overflow</text>
  <text x="615" y="232" font-size="11">moves to D&amp;V slice (no over-rewarding filtering).</text>
</svg>
```

**Resolved from v1 ambiguity:** Submission fees fund **filtering only**, with no bonus split. The 5% (or fixed) round bucket funds Debate & Vote and Milestones according to two configurable splits.

### 12.2 Configurable parameters

> **Updated (implementation):** these are now **per-round settings** configured in the
> round setup (stored on the round; the values below are the `ROUND_SETTING_DEFAULTS`
> fallback), not platform-wide config. The reward split is set with **two sliders**:
> `rewardDvSharePct` splits the reward pool between **Debate & Vote** (left) and
> **Milestone review** (right), and `rewardFixedPct` splits the D&V slice between
> **fixed** (left) and **bonus** (right). Milestone-review rewards are always fixed.
> The round setup shows a live bar of the resulting distribution. The §12.3–12.4
> formulas still apply (`rewardDvSharePct` plays the role of the old
> `STAGES_REWARD_SPLIT_DV_PCT`; `100 − rewardFixedPct` is the old `BONUS_SHARE_DV_PCT`).

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `rewardExpertSharePct` | 0 | 0–100 | Experts' direct cut (%) of the reward pool, subtracted before the DReps' split |
| `rewardDvSharePct` | 60 | 0–100 | Of the DReps' pool (after experts): % → Debate & Vote (rest → milestone review) |
| `rewardFixedPct` | 70 | 0–100 | Within the D&V slice, fixed share (%); bonus = 100 − fixed |
| `feeCapPerRoundAda` | 50,000 | ≥0 | Cap on filtering reward pool from submission fees (overflow → D&V) |
| `feeCommercialPct` | 3 | 0–100 | Submission fee for commercial projects |
| `feeCommercialCapAda` | 5,000 | ≥0 | Cap on commercial submission fee |
| `feeOssPct` | 1 | 0–100 | Submission fee for open-source projects |
| `feeOssCapAda` | 1,000 | ≥0 | Cap on OSS submission fee |

### 12.3 Filtering rewards (formula)

```
filter_reward_per_vote = min(sum(submission_fees_in_round), FEE_CAP_PER_ROUND) / total_cast_filter_votes
drep_filter_reward    = filter_reward_per_vote × votes_cast_by_drep
```

Worked example (180K ADA in fees, 3,750 cast votes):
- `filter_reward_per_vote = 180,000 / 3,750 = 48 ADA`
- DRep with 100 cast votes earns `100 × 48 = 4,800 ADA`

### 12.4 D&V fixed rewards (formula)

```
dv_fixed_pool         = round_bucket × STAGES_REWARD_SPLIT_DV_PCT/100 × (100 - BONUS_SHARE_DV_PCT)/100
dv_fixed_per_vote     = dv_fixed_pool / total_dv_cast_votes
drep_dv_fixed_reward  = dv_fixed_per_vote × votes_cast_by_drep
```

**Per decision #11:** board members use the **same formula as DReps** for fixed rewards (no weight differentiation). This is the simpler of the two models considered in v1.

### 12.5 D&V bonuses (formula)

Bonuses reward both **participation** (how many votes cast) and **voting power** (how much a DRep represents). Board members get bonuses **only** if they opted into the funding vote.

```
participation_i = cast_votes_i / max_possible_votes_in_round
weight_i        = participation_i × final_voting_power_i
total_weight    = sum(weight_i for i in eligible_voters)
drep_bonus_i    = bonus_pool × (weight_i / total_weight)
```

Worked example (bonus pool 34,000 ADA, max votes = 10):

| DRep | FinalPower | Cast | Participation | Weight | Bonus |
|---|---|---|---|---|---|
| A | 5 | 5 | 0.5 | 2.5 | 3,935 |
| B | 6 | 7 | 0.7 | 4.2 | 6,611 |
| C | 7 | 10 | 1.0 | 7.0 | 11,019 |
| D | 8 | 3 | 0.3 | 2.4 | 3,778 |
| E | 9 | 6 | 0.6 | 5.4 | 8,500 |
| **Total** | | | | **21.5** | **33,843 ≈ 34K** |

### 12.6 Milestone rewards (formula)

Per-vote model, identical structure to D&V fixed.

```
milestone_pool          = round_bucket × (100 - STAGES_REWARD_SPLIT_DV_PCT)/100
total_milestone_checks  = total_milestones × milestone_reviewer_count
reward_per_check        = milestone_pool / total_milestone_checks
drep_milestone_reward   = reward_per_check × checks_performed_by_drep
```

**Special rule for early termination:** If a project is terminated at milestone N (out of M), the assigned reviewers still receive credit for milestones N+1…M (they were prepared to do the work; the project failed, not the reviewer). They're paid at the end of the funding stage for the project.

### 12.7 Distribution timeline

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 220" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="ad" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="430" y="22" text-anchor="middle" font-weight="bold">Reward Distribution Events (per round)</text>
  <line x1="40" y1="120" x2="820" y2="120" stroke="#333" marker-end="url(#ad)"/>
  <circle cx="120" cy="120" r="8" fill="#fde68a" stroke="#333"/>
  <text x="120" y="100" text-anchor="middle" font-size="11">Filter end</text>
  <text x="120" y="150" text-anchor="middle" font-size="10">payout 1×</text>
  <circle cx="260" cy="120" r="8" fill="#fde68a" stroke="#333"/>
  <text x="260" y="100" text-anchor="middle" font-size="11">D&amp;V end</text>
  <text x="260" y="150" text-anchor="middle" font-size="10">payout 1×</text>
  <circle cx="420" cy="120" r="8" fill="#bbf7d0" stroke="#333"/>
  <text x="420" y="100" text-anchor="middle" font-size="11">Milestone Q1</text>
  <text x="420" y="150" text-anchor="middle" font-size="10">interim payout</text>
  <circle cx="540" cy="120" r="8" fill="#bbf7d0" stroke="#333"/>
  <text x="540" y="100" text-anchor="middle" font-size="11">Milestone Q2</text>
  <text x="540" y="150" text-anchor="middle" font-size="10">interim payout</text>
  <circle cx="660" cy="120" r="8" fill="#bbf7d0" stroke="#333"/>
  <text x="660" y="100" text-anchor="middle" font-size="11">Milestone Q3</text>
  <text x="660" y="150" text-anchor="middle" font-size="10">interim payout</text>
  <circle cx="780" cy="120" r="8" fill="#86efac" stroke="#333"/>
  <text x="780" y="100" text-anchor="middle" font-size="11">Round close</text>
  <text x="780" y="150" text-anchor="middle" font-size="10">final payout</text>
</svg>
```

Total: 6 reward distributions per round (1 for filtering, 1 for D&V, 4 over milestone funding).

### 12.8 Distribution mechanism

For each distribution event, the backend:
1. Computes each DRep's reward
2. Builds a Cardano multisig transaction with one output per DRep (or batched per-page if many)
3. Notifies the board to co-sign
4. After 3-of-5 signatures, submits to the network
5. Records on-chain TX hash in the `reward_payout` table

DReps can view their per-event reward in their dashboard before payout. The whole table is visible to the board.

---

## 13. Merit Points System

### 13.1 Range and effect

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 200" font-family="Arial, sans-serif" font-size="12">
  <text x="380" y="22" text-anchor="middle" font-weight="bold">Merit Points → Voting Power Multiplier</text>
  <line x1="60" y1="100" x2="700" y2="100" stroke="#333" stroke-width="2"/>
  <line x1="60" y1="90" x2="60" y2="110" stroke="#333" stroke-width="2"/>
  <line x1="380" y1="90" x2="380" y2="110" stroke="#333" stroke-width="2"/>
  <line x1="700" y1="90" x2="700" y2="110" stroke="#333" stroke-width="2"/>
  <text x="60" y="80" text-anchor="middle" font-weight="bold">−200 pts</text>
  <text x="60" y="135" text-anchor="middle" font-size="10">multiplier 0.00</text>
  <text x="60" y="150" text-anchor="middle" font-size="10">(silent DRep)</text>
  <text x="380" y="80" text-anchor="middle" font-weight="bold">0 pts (start)</text>
  <text x="380" y="135" text-anchor="middle" font-size="10">multiplier 1.00</text>
  <text x="700" y="80" text-anchor="middle" font-weight="bold">+200 pts</text>
  <text x="700" y="135" text-anchor="middle" font-size="10">multiplier 2.00</text>
  <text x="700" y="150" text-anchor="middle" font-size="10">(power × 2)</text>
  <rect x="60" y="95" width="320" height="10" fill="#fca5a5"/>
  <rect x="380" y="95" width="320" height="10" fill="#86efac"/>
  <text x="220" y="170" text-anchor="middle" font-size="11" fill="#666">decreasing voting power</text>
  <text x="540" y="170" text-anchor="middle" font-size="11" fill="#666">increasing voting power</text>
</svg>
```

A DRep starts at 0 merit points. Range is `[−200, +200]`. Linear mapping: every 2 points = 1% adjustment to base voting power.

### 13.2 Point sources (gain)

**DReps:**

| Action | Points |
|---|---|
| Vote in D&V (funding) | +1 per vote |
| Vote in D&V (internal) | +1 per vote |
| Complete a filtering review (Feedback 1+2) | +1 |
| Check a milestone | +1 |
| Submit an internal proposal | +1 |
| Vote in a Quick Poll | +1 |

**Board members** (collective rewards — all board members earn even if only one did the action; assumes board operates as a team):

| Action | Points (per board member) |
|---|---|
| Start a round | +10 |
| End a round | +10 |
| Configure a round | +10 |
| Submit an internal proposal | +5 |
| Distribute a reward batch via multisig | +10 |
| Keep DAO ledger (per month) | +2 |

### 13.3 Point sinks (loss)

| Action | Points |
|---|---|
| **DReps:** miss vote in D&V (no avoid signaled) | −1 per missed vote |
| **DReps:** miss filtering vote in time | −1 |
| **DReps:** miss milestone check in time | −1 |
| **DReps:** miss a Quick Poll | −1 |
| **Board:** fail to send rewards in time (>1 month after stage end) | −10 |

### 13.4 Avoid period interaction (per decision #13)

- A DRep may pre-signal an **avoid period** (up to 6 weeks/year, can be split). During this period, they cannot be assigned to filtering or milestone review, **and** missing D&V votes during this period does **not** deduct merit points.
- If a DRep is *already* assigned at the time they signal avoid, the platform auto-reassigns and notifies the board. The DRep loses no merit; their replacement gets the credit.
- A DRep who ghosts (no signal, no vote) loses points per the table above.

### 13.5 Cap behavior

- A DRep at +200 cannot earn more; they retain +200 until they lose points.
- A DRep at −200 cannot lose more; they retain −200 until they gain points.
- No decay: merit points are sticky over time.

### 13.6 Ledger

Every change is recorded in a `merit_ledger` table: `(drep_id, delta, reason_code, reference_id, occurred_at)`. The current points are computed by summing the ledger. The daily anchor service hashes this ledger and posts to chain (section 24).

---

## 14. DRep Admission and Removal

### 14.1 Sybil protection — two layers

**Layer 1 — Autonomous admission gate (configurable):**

A DRep can submit the application form only if they meet ONE of:
- `MIN_OWN_VOTING_POWER_ADA` (default 1,000,000) — own stake delegated to themselves as DRep
- OR `MIN_DELEGATORS` (default 20) where each has at least `MIN_DELEGATOR_STAKE_ADA` (default 50,000)
- OR recommendation from an existing admitted DRep

**Layer 2 — Board review:**

After application, 3 of 5 board members must approve for admission. A NO vote requires written feedback.

### 14.2 Admission flow

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 240" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="aa" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="440" y="22" text-anchor="middle" font-weight="bold">DRep Admission</text>
  <rect x="20" y="60" width="140" height="50" rx="6" fill="#fff" stroke="#333"/>
  <text x="90" y="84" text-anchor="middle">Wallet login</text>
  <text x="90" y="100" text-anchor="middle" font-size="10">(viewer rights)</text>
  <rect x="180" y="60" width="140" height="50" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="250" y="80" text-anchor="middle">Auto-gate check</text>
  <text x="250" y="96" text-anchor="middle" font-size="10">stake / delegators</text>
  <text x="250" y="108" text-anchor="middle" font-size="10">/ recommendation</text>
  <rect x="340" y="60" width="140" height="50" rx="6" fill="#fde68a" stroke="#333"/>
  <text x="410" y="84" text-anchor="middle">Application form</text>
  <text x="410" y="100" text-anchor="middle" font-size="10">bio · categories · KYC opt-in</text>
  <rect x="500" y="60" width="140" height="50" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="570" y="84" text-anchor="middle">Board review</text>
  <text x="570" y="100" text-anchor="middle" font-size="10">3 of 5 YES needed</text>
  <rect x="680" y="40" width="160" height="40" rx="6" fill="#dcfce7" stroke="#333"/>
  <text x="760" y="64" text-anchor="middle">Admitted</text>
  <rect x="680" y="100" width="160" height="40" rx="6" fill="#fecaca" stroke="#333"/>
  <text x="760" y="124" text-anchor="middle">Rejected (with feedback)</text>
  <line x1="160" y1="85" x2="178" y2="85" stroke="#333" marker-end="url(#aa)"/>
  <line x1="320" y1="85" x2="338" y2="85" stroke="#333" marker-end="url(#aa)"/>
  <line x1="480" y1="85" x2="498" y2="85" stroke="#333" marker-end="url(#aa)"/>
  <line x1="640" y1="80" x2="678" y2="60" stroke="#333" marker-end="url(#aa)"/>
  <line x1="640" y1="90" x2="678" y2="120" stroke="#333" marker-end="url(#aa)"/>
  <text x="440" y="175" text-anchor="middle" font-size="11" fill="#374151">Admission ≠ automatic participation in ongoing rounds. Board adds new DReps to a round explicitly.</text>
</svg>
```

### 14.3 Application form fields

- DRep ID (on-chain, CIP-95) — auto-detected from wallet
- Display name / nickname
- Social handles (X, LinkedIn, GitHub)
- Contact (Telegram, email)
- Categories (subcategory list — multi-select)
- Motivation (long text)
- Experience / education / skills
- KYC opt-in (yes/no, not enforced in MVP)
- Calls opt-in (yes/no)
- Admission-call opt-in (yes/no)

### 14.4 Removal

- Any board member can propose removal of a specific DRep
- Internal proposal with `voters_scope = BOARD_ONLY`, threshold 3 of 5
- During the review, the DRep can continue acting normally
- If approved, DRep loses DRep status (returns to viewer-only); they forfeit any unpaid rewards from the current round
- DRep history (votes, rationales) remains visible and attributed

---

## 15. DAO Treasury

### 15.1 Multisig

- **3-of-5 native multisig** wallet on Cardano (no smart contract; just a multi-signature payment address)
- Signers: the 5 board members; each uses a hardware-backed wallet on their own machine
- The DAO Multisig holds: round operational budget (from Intersect TW), submission fees, pledges, and any reserves

### 15.2 Per-purpose addresses

To simplify accounting, the platform uses **derived addresses** from the same multisig:

| Purpose | Address kind | Lifetime |
|---|---|---|
| Round budget | One per round | Funded by Intersect TW |
| Submission fees | One per round | Receives all fees in that round |
| Pledges | One per round | Receives pledges from approved-pending teams |
| Rewards | Reuses round budget address (no separation) | — |
| Operations | Single, persistent | Hosting, legals, ledger keeping |

A "round budget address" need not be a unique derivation; it can simply be the multisig address with the round id encoded in transaction metadata. This is the simpler approach and is the default in MVP.

### 15.3 Fund flow

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 320" font-family="Arial, sans-serif" font-size="11">
  <defs>
    <marker id="af2" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="440" y="22" text-anchor="middle" font-weight="bold">Fund Flow (per Round)</text>
  <!-- Intersect -->
  <rect x="20" y="60" width="150" height="50" rx="6" fill="#e5e7eb" stroke="#333" stroke-dasharray="4 3"/>
  <text x="95" y="82" text-anchor="middle">Intersect</text>
  <text x="95" y="98" text-anchor="middle" font-size="10">(Treasury Withdrawal)</text>
  <!-- DAO multisig -->
  <rect x="240" y="60" width="180" height="50" rx="6" fill="#fef3c7" stroke="#333"/>
  <text x="330" y="82" text-anchor="middle" font-weight="bold">DAO Multisig</text>
  <text x="330" y="98" text-anchor="middle" font-size="10">Project funding + Rewards + Ops</text>
  <!-- Submitters -->
  <rect x="20" y="160" width="150" height="50" rx="6" fill="#fef9c3" stroke="#333"/>
  <text x="95" y="184" text-anchor="middle">Submitters</text>
  <text x="95" y="200" text-anchor="middle" font-size="10">submission fees + pledges</text>
  <!-- Sinks -->
  <rect x="500" y="40" width="140" height="40" rx="6" fill="#dcfce7" stroke="#333"/>
  <text x="570" y="64" text-anchor="middle">Project teams</text>
  <rect x="500" y="90" width="140" height="40" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="570" y="114" text-anchor="middle">DRep rewards</text>
  <rect x="500" y="140" width="140" height="40" rx="6" fill="#fbcfe8" stroke="#333"/>
  <text x="570" y="164" text-anchor="middle">Pledge returns</text>
  <rect x="500" y="190" width="140" height="40" rx="6" fill="#e9d5ff" stroke="#333"/>
  <text x="570" y="214" text-anchor="middle">Operations &amp; hosting</text>
  <!-- Cardano treasury (leftovers) -->
  <rect x="680" y="240" width="180" height="50" rx="6" fill="#e5e7eb" stroke="#333" stroke-dasharray="4 3"/>
  <text x="770" y="262" text-anchor="middle">Cardano Treasury</text>
  <text x="770" y="278" text-anchor="middle" font-size="10">(leftovers, end of round)</text>
  <line x1="170" y1="85" x2="238" y2="85" stroke="#333" marker-end="url(#af2)"/>
  <line x1="170" y1="185" x2="238" y2="110" stroke="#333" marker-end="url(#af2)"/>
  <line x1="420" y1="85" x2="498" y2="60" stroke="#333" marker-end="url(#af2)"/>
  <line x1="420" y1="85" x2="498" y2="110" stroke="#333" marker-end="url(#af2)"/>
  <line x1="420" y1="85" x2="498" y2="160" stroke="#333" marker-end="url(#af2)"/>
  <line x1="420" y1="85" x2="498" y2="210" stroke="#333" marker-end="url(#af2)"/>
  <line x1="420" y1="110" x2="680" y2="265" stroke="#333" stroke-dasharray="3 3" marker-end="url(#af2)"/>
</svg>
```

### 15.4 Reconciliation

At any time, the DAO Multisig's on-chain balance should equal:
```
TW_received + fees_received + pledges_received
  − project_disbursements_made − rewards_paid − pledges_returned − ops_paid
```
A daily reconciliation job verifies this and alerts the board on mismatch.

---

## 16. Pledge (Skin in the Game)

### 16.1 When required

A pledge is required when:
- The proposal is `is_commercial = true` AND
- The proposal `requested_amount_ada > PLEDGE_THRESHOLD_ADA` (configurable, default 0 = always)
- Pledge amount: between 1% and 5% of `requested_amount_ada`, set by submitter, recorded in the proposal

OSS proposals are not required to pledge.

### 16.2 Submission flow (per decision #25)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 280" font-family="Arial, sans-serif" font-size="12">
  <defs>
    <marker id="ap" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#333"/>
    </marker>
  </defs>
  <text x="430" y="22" text-anchor="middle" font-weight="bold">Pledge Submission and Verification</text>
  <rect x="30" y="60" width="180" height="60" rx="6" fill="#dcfce7" stroke="#333"/>
  <text x="120" y="82" text-anchor="middle">Proposal APPROVED</text>
  <text x="120" y="98" text-anchor="middle" font-size="10">(after D&amp;V)</text>
  <text x="120" y="112" text-anchor="middle" font-size="10">→ status PENDING (pledge)</text>
  <rect x="240" y="60" width="200" height="60" rx="6" fill="#fef9c3" stroke="#333"/>
  <text x="340" y="82" text-anchor="middle">Submitter sends pledge</text>
  <text x="340" y="98" text-anchor="middle" font-size="10">to DAO Multisig address</text>
  <text x="340" y="112" text-anchor="middle" font-size="10">(no metadata needed)</text>
  <rect x="470" y="60" width="200" height="60" rx="6" fill="#fde68a" stroke="#333"/>
  <text x="570" y="82" text-anchor="middle">Submitter provides TX hash</text>
  <text x="570" y="98" text-anchor="middle" font-size="10">via proposal page</text>
  <rect x="700" y="60" width="140" height="60" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="770" y="80" text-anchor="middle">Platform verifies</text>
  <text x="770" y="96" text-anchor="middle" font-size="10">TX confirmed</text>
  <text x="770" y="110" text-anchor="middle" font-size="10">amount matches</text>
  <rect x="240" y="180" width="200" height="50" rx="6" fill="#dcfce7" stroke="#333"/>
  <text x="340" y="200" text-anchor="middle">Status → APPROVED</text>
  <text x="340" y="216" text-anchor="middle" font-size="10">milestone funding can begin</text>
  <rect x="470" y="180" width="200" height="50" rx="6" fill="#dbeafe" stroke="#333"/>
  <text x="570" y="200" text-anchor="middle">Board confirms</text>
  <text x="570" y="216" text-anchor="middle" font-size="10">(any 1 member)</text>
  <line x1="210" y1="90" x2="238" y2="90" stroke="#333" marker-end="url(#ap)"/>
  <line x1="440" y1="90" x2="468" y2="90" stroke="#333" marker-end="url(#ap)"/>
  <line x1="670" y1="90" x2="698" y2="90" stroke="#333" marker-end="url(#ap)"/>
  <line x1="770" y1="120" x2="570" y2="178" stroke="#333" marker-end="url(#ap)"/>
  <line x1="470" y1="205" x2="442" y2="205" stroke="#333" marker-end="url(#ap)"/>
</svg>
```

**No new address per proposal.** Submitters send pledges to the same DAO Multisig pledge address for the round. Identification is via:
1. TX hash provided by the submitter
2. Platform polls Cardano via indexer to confirm the TX exists, is confirmed (≥ 2 confirmations), and the output amount ≥ required pledge
3. The sender wallet's stake key is cross-checked against the submitter's wallet (must match)

If the verification fails (wrong amount, wrong sender, TX not found), the proposal page shows an error and the submitter can re-submit with a corrected TX hash.

### 16.3 Pledge return

| Method | When |
|---|---|
| `LAST_MILESTONE` | 100% returned after the last milestone is approved |
| `PER_MILESTONE` | Equal pro-rata share returned after each milestone is approved (e.g., 20% × 5 milestones) |

In both methods, the platform calculates the return amount, prepares the multisig TX, and notifies the board to sign.

If the project fails before delivering all milestones:
- `LAST_MILESTONE`: the pledge is **forfeited** to the DAO Treasury reserves.
- `PER_MILESTONE`: only the proportional unreturned portion is forfeited.

### 16.4 If the team cannot send the pledge

After D&V approval, the proposal sits in `PENDING (pledge)` for `PLEDGE_GRACE_DAYS` (default 14). If not received by then, the board may terminate the proposal (status → `REJECTED`, no funding) or extend the grace period.

---

## 17. DAO Board (Interim)

- 5 board members, elected off-chain initially (no on-chain election in MVP)
- 1-year terms; re-election allowed (no term limits)
- A board member is also a DRep
- Board members can be removed via an internal proposal with `IMPORTANT` threshold (75%), `voters_scope = DREPS_ONLY` (board excluded from this specific vote to avoid self-defense)

**Board responsibilities (recap):**

- Configure rounds (Preparation stage)
- Confirm reviewer assignments
- Distribute rewards (multisig signing)
- Admit/remove DReps
- Prolong periods when necessary
- Launch quick polls (one-click confirm)
- Verify pledges received
- Hosting/maintenance procurement
- Move leftovers to next round or back to Cardano Treasury
- Keep accounting ledger

### 17.5 Bootstrap (Founding Board)

The 5 initial board members are determined off-platform during the Catalyst proposal phase. Their identities (Cardano stake addresses + on-chain DRep IDs) are committed to a `genesis.json` file that ships with the platform deployment. On first boot with an empty database, an Admin (see next section) reviews and approves the file; the backend then seeds the `board_membership` table.

**The genesis file is public.** It is part of the Catalyst deliverable and is checked into the project repository before mainnet deployment. There is no hidden installer or auto-seeding.

**Genesis schema (illustrative):**

```json
{
  "deployment": {
    "name": "DRep DAO — Production",
    "network": "mainnet",
    "deployed_at": "2026-04-01T00:00:00Z"
  },
  "founding_board": [
    { "display_name": "Alice", "stake_address": "stake1...", "drep_id": "drep1..." },
    { "display_name": "Bob",   "stake_address": "stake1...", "drep_id": "drep1..." },
    { "display_name": "Carol", "stake_address": "stake1...", "drep_id": "drep1..." },
    { "display_name": "Dave",  "stake_address": "stake1...", "drep_id": "drep1..." },
    { "display_name": "Eve",   "stake_address": "stake1...", "drep_id": "drep1..." }
  ],
  "multisig_native_script": {
    "type": "atLeast",
    "required": 3,
    "scripts": [
      { "type": "sig", "keyHash": "..." }
    ]
  },
  "anchor_hot_wallet_pubkeyhash": "..."
}
```

**Subsequent board changes** happen through the normal mechanism — internal proposal with `IMPORTANT` threshold (section 10). Once the genesis board is seated, the platform itself is the authority for governance; Admins no longer touch the board roster.

### 17.6 Founder selection (off-platform process)

This is project-governance, not platform-design, but documented here for completeness:

1. The Catalyst proposal lists candidates or selection criteria.
2. Selection happens via one of:
   - Direct nomination by the project team
   - Off-chain poll among initial DReps interested in joining (Snapshot, Telegram, Google Form)
   - Hybrid: project team nominates, an open call gathers volunteers, an off-chain vote selects 5
3. The 5 confirmed founders provide their wallet stake addresses and DRep IDs.
4. Those go into `genesis.json` before deployment.
5. After 1 year, the first on-platform election happens via internal proposal.

---

## 18. Platform Administration

The **Admin** is an operational role — distinct from any governance role. Admins keep the platform running. They do not vote, do not configure governance parameters, and do not control DAO funds. A DRep or board member *may also* hold an Admin account, but the two identities are strictly separate within the system.

### 18.1 Why Admin is separate from Board

| Concern | Belongs to |
|---|---|
| "The server is down, restart it" | Admin |
| "Email provider quota exhausted, swap keys" | Admin |
| "Database corruption, restore from backup" | Admin |
| "Should we fund proposal X?" | Board (via voting) |
| "Reduce voting threshold from 67% to 60%" | Board (via internal proposal) |
| "Distribute round rewards" | Board (via multisig) |

Mixing these into one role makes audit trails ambiguous and creates an "admin = secret board" anti-pattern. The split keeps each role minimal and accountable.

### 18.2 Admin powers

**Admin can:**

- Manage admin accounts (create, disable, rotate credentials, force password reset, manage 2FA)
- Approve / reject the `genesis.json` board roster on first boot
- View system health, logs, error reports, metrics
- Trigger backups, restores, maintenance mode
- Force-pause the platform (e.g., during an incident — blocks all writes except by Admin)
- Manage technical config that has no governance meaning: API rate limits, log retention, monitoring thresholds, email/Telegram provider keys
- Manage the anchor hot wallet (rotate keys, top up ADA balance)
- Reset/rotate compromised credentials
- **Switch all admins at once** — see 18.6 below

**Admin cannot:**

- Cast any vote (filtering, D&V, quick poll, internal)
- Sign DAO Multisig transactions
- Modify governance configuration parameters (thresholds, fees, period defaults, splits)
- Add or remove board members (except via the initial genesis approval)
- Change merit points, vote tallies, or reward calculations
- Submit proposals as themselves (their Admin identity has no DRep status)

If an attempt is made from an Admin session to perform a board-only action, the API returns `403 Forbidden — wrong identity, log in with your wallet`.

### 18.3 Admin and DRep are separate identities

A single human may hold both. The system stores them in **separate tables** (`admin_user` and `app_user`/`drep`) with **no foreign-key link between them**.

- When acting as **Admin**: log in at `/sysadmin/login` with username + password + 2FA. Session is `admin_session`, 4-hour TTL, no rolling.
- When acting as **DRep / Board**: log in at `/login` with a Cardano wallet (CIP-30 + CIP-8). Session is `app_session`, 7-day rolling TTL.

The two sessions are independent. If you are logged in as Admin and you want to vote on a proposal, you log out of Admin and log in with your wallet. The audit log records each session separately, so "Satucha-as-admin restarted the server at 10:00" and "Satucha-as-board signed payout TX at 10:30" are two unambiguous entries.

It is allowed (and expected) that **some Admins are not DReps at all** — for example, a paid sysadmin or DevOps contractor.

### 18.4 Authentication

- **Login:** username + password
- **Password hashing:** Argon2id (memory-hard, modern KDF)
- **2FA:** TOTP (Time-based One-Time Password — compatible with Google Authenticator, Authy, 1Password)
  - **Mandatory on mainnet**
  - **Optional on testnet** (so testing isn't slowed down)
- **Recovery codes:** 10 one-time backup codes generated at 2FA enrollment, shown once, hash-stored
- **Session:** HTTP-only cookie, SameSite=Strict, 4-hour TTL, no rolling refresh
- **Brute-force protection:** 5 failed login attempts → 15-minute lockout per IP + per account
- **Audit log:** every Admin action recorded as `(admin_id, action, target, timestamp, ip, user_agent)` — append-only, visible to all Admins, exportable

### 18.5 Admin lifecycle

**Initial admin creation (bootstrap):**

At deployment time, a CLI command creates the first Admin:

```bash
npm run admin:create -- --username=satucha --email=satucha@example.com
# prompts for password (Argon2id-hashed)
# outputs 2FA QR code on stdout
# prints 10 recovery codes (shown once)
```

This is the **only** way to create the first Admin. After that, all admin creation happens through the platform UI by an existing Admin.

**Up to 3 Admins.** This is a hard cap. Adding a 4th requires removing one first.

**Adding a new Admin:**

1. Existing Admin (any of the 3) opens the Admin dashboard → "Admins" page
2. Clicks "Add Admin" → enters username + email
3. System generates a one-time invitation token (24h TTL), shows a URL to share securely
4. New Admin opens the URL, sets their password, enrolls 2FA, receives recovery codes
5. New Admin is active

**Removing an Admin:**

Any existing Admin can remove any other Admin (including themselves — but the system refuses if it would leave 0 Admins).

- Click "Remove" → confirm with own password
- Removed Admin's sessions are revoked immediately
- Their `admin_user` row is marked `status = 'REMOVED'`, NOT deleted (preserves audit log integrity)

### 18.6 Switch all admins at once (key rotation)

Use case: suspected compromise, team handover, end of contract.

1. Any Admin opens "Switch All Admins" page
2. Enters details for 1–3 new Admins (same fields as Add Admin)
3. Confirms with own password + 2FA code
4. System creates the new Admins (invitation URLs)
5. **After the new Admins have completed enrollment**, the initiating Admin clicks "Disable Old Admins"
6. All previously-existing Admins are marked `REMOVED`; their sessions are killed
7. Result: only the newly enrolled Admins can log in

This is a single audited operation — one row in `admin_audit_log` with `action = 'SWITCH_ALL'` containing the before/after roster.

If the initiating Admin's account is itself the one being switched out, the workflow still works: they enroll the replacements, then remove themselves last.

### 18.7 Genesis approval flow

When the platform boots with an empty database:

1. The first Admin (created via CLI) logs in
2. The dashboard shows a banner: "No board configured. Approve `genesis.json` to install founding board."
3. Admin uploads or selects the `genesis.json` file
4. UI shows the 5 proposed board members: display name, stake address, DRep ID
5. For each, a "Verify on-chain" button queries Blockfrost to confirm the DRep ID is registered
6. Admin clicks "Approve and install"
7. System writes 5 rows into `board_membership` + 1 row into `admin_audit_log` (action `GENESIS_APPROVED`)
8. The genesis approval flow is **permanently disabled** for this deployment
9. The 5 board members can now log in via wallet and start operating the DAO

### 18.8 Recovery scenarios

| Scenario | Recovery |
|---|---|
| Admin loses 2FA device | Use one of 10 recovery codes; after login, regenerate 2FA + new recovery codes |
| Admin loses recovery codes too | Another Admin resets their 2FA (requires 2FA on the resetter) |
| Admin forgets password | Another Admin triggers a password reset email (token-based, 1h TTL) |
| All Admins locked out | Last-resort: direct database intervention by whoever has Postgres access — re-run `npm run admin:create` against the live DB, then log in and rotate everything |
| Admin account compromised | Another Admin disables it immediately; review audit log; rotate any credentials the compromised admin had access to (anchor hot wallet, email provider keys, etc.) |
| All 3 Admins compromised | Same as "all locked out" — DB intervention |

### 18.9 Admin UI surface

A dedicated dashboard at `/sysadmin/*`, visually distinct from the public site (different color scheme, banner "PLATFORM ADMIN — handle with care"). Sections:

- **Overview** — system health (DB, Redis, Cardano indexer status), recent errors, queue depths
- **Admins** — list, add, remove, switch-all
- **Genesis** — only visible if board not yet seeded
- **Audit log** — filterable, exportable
- **Maintenance** — backup trigger, restore form, maintenance mode toggle, force-pause
- **Technical config** — non-governance settings (rate limits, provider keys, etc.)
- **Anchor wallet** — current balance, recent anchoring TXs, key rotation
- **Logs** — application logs (filtered, paginated)

---

## 19. Submission Form

Submitters fill in a single form. Fields by section:

**Header**

Submitters fill in a single form. Fields by section:

**Header**
- Title
- Submitter — auto-filled from wallet
- Category — dropdown (per active round)
- Sub-categories — multi-select (used for reviewer matching)
- Project type — `COMMERCIAL` or `OSS` (affects fee calculation)

**Funding ask**
- Requested amount (ADA)
- Submission fee — auto-computed and displayed, with TX hash field

**Pledge** (commercial only)
- Pledge amount (1–5% of requested)
- Return method (`LAST_MILESTONE` / `PER_MILESTONE`)

**Milestones** (repeatable rows)
- Index (auto)
- Description
- Amount (ADA) — must sum to `requested_amount_ada`
- Deadline (days from project start)
- Deliverables (markdown)

**Team**
- Team size
- FTEs per role
- Key members (name + experience + LinkedIn/GitHub)

**Financials**
- Cost breakdown (markdown table)
- Skin-in-the-game (own capital provided, return preference)
- Revenue sharing (% tokens, % fees, period — for commercial)

**Project**
- Problem statement
- Solution overview
- Roadmap and timeline
- Risks and mitigations
- Final pitch (max 500 words)

Validation: all required fields present, milestone amounts sum to total, submission fee paid.

---

## 20. Communication and Notifications

### 20.1 Comments (public)

Every proposal has a comment thread:
- Visible to everyone (no role gating)
- Comments attributed by display name + DRep ID
- Threaded one level (a comment can have replies; no nested replies)
- Editable for 5 minutes after posting; deletion creates a tombstone

### 20.2 Private messaging

- **Submitter ↔ Board**: dedicated thread on each proposal page (only submitter + 5 board members can see)
- **DReps ↔ Board (shared inbox)**: any DRep can DM "the board" — message visible to all 5
- **No DM between individual DReps in MVP** (deferred — Telegram works for that)

### 20.3 Notifications

Three channels, all opt-in per user (defaults given):

| Channel | Default ON for | Implementation |
|---|---|---|
| In-platform | Everyone (when logged in) | Bell icon + dropdown; persisted in DB until marked read |
| Email | DReps and Board | Transactional email service (SendGrid or AWS SES) |
| Telegram | Opt-in only | Telegram bot; user binds chat_id via `/start` flow |

**Event triggers (full list):**

| Event | Recipients |
|---|---|
| Proposal submitted (fee paid) | Filter pool DReps in matching categories |
| Filter assignment | The 5 assigned DReps |
| Filter feedback received | Submitter |
| Filter result | Submitter |
| D&V starts | All eligible DReps; submitter |
| D&V vote period last 3/2/1 day | Eligible DReps who haven't voted |
| D&V result | All DReps; submitter; board |
| Milestone reviewer assignment | The 3 assigned reviewers |
| Milestone POA submitted | The 3 reviewers + board |
| Milestone period last 3/2/1 day | Reviewers who haven't voted |
| Milestone approved/rejected | Submitter; board |
| Reward calculation ready | Board |
| Reward payout TX submitted | Affected DReps |
| Pledge received and verified | Submitter; board |
| Quick poll launched | All DReps; board |
| Internal proposal submitted | All eligible voters |
| DRep application received | Board |
| DRep admitted/rejected | The applicant |

---

## 21. Configurable Parameters

Configuration is split in two: **platform-wide** parameters (board-editable in *Platform
setup*) and **per-round** parameters (set in the round setup, stored on the round). The
per-round defaults below live in `ROUND_SETTING_DEFAULTS` and are used when a round leaves
a field blank. `NUMBER_OF_ROUNDS_PER_BUDGET` was removed — a new budget simply means a new
round.

### 21.1 Platform-wide (`PLATFORM_CONFIG_DEFAULTS`, Platform setup)

| Parameter | Default | Used in |
|---|---|---|
| `ADMISSION_APPROVAL_VOTES` | 3 | DAO admission (3-of-5) |
| `INTERNAL_DEFAULT_THRESHOLD_PCT` | 67 | Internal |
| `INTERNAL_IMPORTANT_THRESHOLD_PCT` | 75 | Internal (sensitive) |
| `ENTRY_REQUIRE_VOTING_POWER` | false | Entry gate — switch for the power/delegator group |
| `MIN_OWN_VOTING_POWER_ADA` | 1,000,000 | Entry gate — own self-delegated power (ADA) |
| `MIN_DELEGATORS` | 20 | Entry gate — min delegators (alt to own power) |
| `MIN_DELEGATOR_STAKE_ADA` | 50,000 | Entry gate — min stake per counted delegator (ADA) |
| `ENTRY_REQUIRE_ACTIVITY` | false | Entry gate — switch for the voting-activity group |
| `MINIMUM_VOTES_CASTED` | 50 | Entry gate — activity window (last N votes) |
| `MINIMUM_DREP_ACTIVITY` | 50 | Entry gate — % of the window voted on |
| `ONLY_VOTES_WITH_RATIONALE` | false | Entry gate — count only votes with a rationale |
| `AVOID_PERIOD_MAX_DAYS_PER_YEAR` | 42 | Avoid signaling |
| `MERIT_POINT_MAX` | 200 | Merit cap |
| `BOARD_REWARD_DEADLINE_DAYS` | 30 | Merit penalty trigger |
| `ANCHOR_SCHEDULE_CRON` | `0 2 * * *` | Daily anchoring |
| `CARDANO_EXPLORER` | `cardanoscan` | On-chain links |

### 21.2 Per-round (`ROUND_SETTING_DEFAULTS`, round setup)

| Parameter | Default | Used in |
|---|---|---|
| `filterReviewerCount` | 5 | Filtering |
| `filterApprovalVotes` | 3 | Filtering (≤ reviewer count) |
| `milestoneReviewerCount` | 3 | Milestones |
| `milestoneApprovalVotes` | 2 | Milestones (≤ reviewer count) |
| `dvApprovalThresholdPct` | 67 | D&V |
| `rewardExpertSharePct` | 0 | Reward split: experts' direct cut (subtracted first) |
| `rewardDvSharePct` | 60 | Reward split (DReps' pool): D&V vs milestone review |
| `rewardFixedPct` | 70 | Within D&V: fixed vs bonus (bonus = 100 − fixed) |
| `feeCommercialPct` | 3 | Submission fees |
| `feeCommercialCapAda` | 5,000 | Submission fees |
| `feeOssPct` | 1 | Submission fees |
| `feeOssCapAda` | 1,000 | Submission fees |
| `feeCapPerRoundAda` | 50,000 | Filtering reward overflow |
| `quickPollParticipationPct` | 51 | Quick poll |
| `quickPollDurationHours` | 48 | Quick poll |
| `quickPollMaxExtensions` | 3 | Quick poll |
| `milestoneNotificationDaysBeforeEnd` | 3 | Milestones |
| `milestoneAutoExtensionDays` | 28 | Milestones |
| `milestoneCheckPeriodDays` | 10 | Milestones |
| `milestoneBoardExtraExtensionDays` | 90 | Milestones |
| `pledgeThresholdAda` | 0 | Pledge required threshold |
| `pledgeGraceDays` | 14 | Pledge timeout |

---

# Part II — Technical Architecture

## 22. Technology Stack

Pragmatic, mainstream choices. The selection rationale: maximize free-tier hosting, minimize integration custom code, and lean on libraries with active Cardano community support.

### 22.1 Stack overview

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | **Next.js 15 + React 19 + TypeScript + Tailwind CSS + shadcn/ui** | Server components where useful; SSR for SEO of public proposals; well-supported Cardano wallet integration via existing libraries. |
| **Wallet integration** | **MeshJS** (`@meshsdk/core` + `@meshsdk/react`) | Active Cardano-native SDK; supports CIP-30 wallets out of the box; handles signature verification helpers. |
| **Backend** | **NestJS** (Node.js + TypeScript) | Sharing types with frontend; mature DI/modules; great for REST + jobs. Alternative: tRPC for end-to-end type safety; FastAPI (Python) if you prefer Python. |
| **Database** | **PostgreSQL 16** | Mature, well-supported, JSON columns for flexible config, MERIT_LEDGER as table. |
| **ORM** | **Prisma** | Excellent TypeScript DX; migrations clean; good with Postgres JSON. |
| **Job scheduler** | **BullMQ** on Redis | Time-based transitions, retries, repeatable jobs (anchoring). |
| **Cardano data** | **Blockfrost** (paid, primary) + **Koios** (free, fallback) | UTxO lookups, TX confirmation, DRep on-chain state. |
| **Cardano tx building** | **Lucid Evolution** | Successor to Lucid; clean API; multisig support. |
| **DRep on-chain** | **CIP-95 wallets** (Eternl, Lace, Yoroi 2025+) | Native DRep ID exposure via `wallet.getRegisteredPubStakeKeys` etc. |
| **Email** | **AWS SES** or **Resend** | Cheap transactional email; Resend has nice developer API. |
| **Telegram bot** | **Telegraf** | Standard Telegram bot library for Node. |
| **Object storage** | **None in MVP** | Markdown content lives in Postgres; large artifacts referenced by external URL only. |
| **Hosting** | **Fly.io** or **Railway** (backend), **Vercel** (frontend), **Neon** or **Supabase** (Postgres) | All have generous free tiers; production scaling later. |
| **Observability** | **Sentry** + **OpenTelemetry** | Errors and traces; Grafana Cloud free tier for metrics. |
| **CI/CD** | **GitHub Actions** | Free for public repos. |

### 22.2 Why not the alternatives

- **Aiken/Plutus on-chain logic:** Out of scope. The design intentionally puts logic off-chain (backend = source of truth). Aiken would only be needed if we wanted on-chain enforcement of voting rules — explicitly deferred.
- **GraphQL:** REST is sufficient and faster to build. Frontend doesn't have wildly varying query shapes.
- **Cardano-CLI scripts:** Lucid Evolution handles everything from the backend; no need to shell out.
- **MongoDB:** This domain is fundamentally relational (proposals → votes → users → merit deltas → rewards). Postgres is the right fit.

### 22.3 Repo layout (proposed)

```
drep-dao/
├── apps/
│   ├── web/                   # Next.js frontend
│   └── api/                   # NestJS backend
├── packages/
│   ├── shared/                # Shared types, DTOs, constants
│   ├── cardano/               # Cardano integration helpers (Lucid wrappers, anchor service)
│   └── db/                    # Prisma schema, migrations, seed data
├── infra/                     # IaC (terraform / fly.toml / vercel.json)
├── docs/                      # This document + ADRs
└── .github/workflows/         # CI
```

Monorepo with **pnpm workspaces** + **Turborepo** for build orchestration.

---

## 23. Cardano Integration

### 23.1 Wallet authentication (CIP-30 + CIP-8)

Login flow:
1. User clicks "Connect Wallet" in frontend
2. MeshJS triggers CIP-30 `enable()` on the chosen wallet (Eternl/Lace/Yoroi/Nami)
3. Backend issues a nonce: `POST /auth/nonce` → returns `{ nonce, expiresAt }` (5-min TTL)
4. Frontend asks wallet to sign the nonce: `wallet.signData(stakeAddr, nonceMessage)` (CIP-8 signing)
5. Frontend posts the signature + nonce to backend: `POST /auth/verify`
6. Backend verifies CIP-8 signature against the stake key; on success, issues a session JWT
7. Backend upserts a `user` row keyed by `stake_key_hash`

The session cookie is HTTP-only, SameSite=Lax, 7-day rolling expiry. Logout revokes the JWT via a denylist (Redis).

### 23.2 DRep identity (CIP-95)

CIP-95-capable wallets expose:
- `wallet.cip95.getPubDRepKey()` — the DRep public key
- `wallet.cip95.getRegisteredPubStakeKeys()` — stake keys registered as DRep on-chain

The platform stores both. When a DRep applies for admission, the backend verifies on-chain that this DRep ID is registered (via Blockfrost `/governance/dreps/{drep_id}`). The DRep's on-chain voting power (delegated stake) is fetched from `/governance/dreps/{drep_id}/delegators`.

### 23.3 Multisig wallet (3-of-5)

A **native multisig** (no Plutus script) is built using a `NativeScript` of type `atLeast`:

```
{
  "type": "atLeast",
  "required": 3,
  "scripts": [
    { "type": "sig", "keyHash": "<board1>" },
    { "type": "sig", "keyHash": "<board2>" },
    { "type": "sig", "keyHash": "<board3>" },
    { "type": "sig", "keyHash": "<board4>" },
    { "type": "sig", "keyHash": "<board5>" }
  ]
}
```

The script address is the DAO Multisig address.

**Signing workflow:**
1. Backend builds an unsigned TX using Lucid Evolution (e.g., a reward payout batch)
2. Backend stores the TX CBOR in the DB and notifies all 5 board members
3. Board members visit the platform, see "Pending TX" page, and click "Sign"
4. Each click triggers their wallet to sign the CBOR (CIP-30 `signTx`)
5. Backend collects partial signatures; when 3 are gathered, it assembles the witness set and submits the TX
6. Result (TX hash) is stored against the action that triggered it

### 23.4 Reading on-chain state

For each functional need:

| Need | API |
|---|---|
| Verify submission fee TX | `blockfrost.txs(tx_hash)` + check output to fees address + amount + sender stake key |
| Verify pledge TX | Same as above |
| Read DRep voting power | `blockfrost.governance.dreps(drep_id)` + sum delegators |
| Read DRep delegator count | `blockfrost.governance.dreps(drep_id).delegators` (paginated) |
| Get latest block hash (for randomness) | `blockfrost.blocks.latest()` |
| Confirm multisig TX submission | `blockfrost.txs(tx_hash)` polling until ≥ 2 confirmations |
| Detect pledge address inflow | Webhook from Blockfrost (paid plan) or polling job |

Koios is the fallback for free reads when Blockfrost is rate-limited; we abstract behind a `CardanoQueryService` interface.

---

## 24. On-Chain Anchoring

### 24.1 What gets anchored

Per decision #15, anchored items are:
1. **Ready proposals** — when a proposal moves from `DRAFT/PENDING` to `ACTIVE` (filtering or D&V), anchor `hash(proposal_content + metadata)`
2. **Vote tallies** — once per day, anchor `hash(all_votes_cast_today)`; also a one-shot anchor at vote-end with the final tally hash
3. **Voting power snapshots** — at every snapshot event, anchor `hash(snapshot)` (one anchor per proposal vote-start)
4. **Merit ledger** — once per day, anchor `hash(all_merit_deltas_today)`
5. **Reward payouts** — already on-chain (the multisig TX itself)
6. **Configuration changes** — anchor a "configuration change" record whenever the board updates a parameter

### 24.2 Anchor metadata schema

Cardano transaction metadata is JSON under a numeric label. We use label **`80808080`** (reserved for the DAO).

```json
{
  "80808080": {
    "v": 1,
    "k": "vote_tally_daily",
    "r": "round_3",
    "p": "proposal_uuid_or_null",
    "h": "0x<merkle_root_or_sha256>",
    "ts": "2026-05-20T02:00:00Z",
    "u": "https://dao.example/verify/<id>"
  }
}
```

Fields:
- `v` — schema version
- `k` — anchor kind (`proposal_ready`, `vote_tally_daily`, `vote_tally_final`, `power_snapshot`, `merit_daily`, `config_change`)
- `r` — round id (if applicable)
- `p` — proposal id (if applicable)
- `h` — the hash being anchored
- `ts` — timestamp
- `u` — verification URL on the platform

### 24.3 Hashing scheme

For collections (vote tallies, merit deltas), we compute a **Merkle root** so a DRep can produce an inclusion proof for their own vote without revealing other votes' details.

For single objects (proposal content), a simple SHA-256 over the canonicalized JSON is sufficient.

### 24.4 Anchoring transaction

Anchoring TXs are sent **from a hot wallet operated by the backend**, *not* from the multisig. Reason: anchoring happens daily and would require board signatures otherwise, which is impractical.

The hot wallet holds a small operating balance (~50 ADA, refilled monthly by the multisig). Each anchor TX costs ~0.17–0.20 ADA. The hot wallet is configured with a single signer key; if it's compromised, the worst-case is fake anchors — which DReps would catch via the verification UI because the hashes wouldn't match the platform's data.

For higher security, the hot wallet's signer could be a 2-of-3 quorum among board members (still operationally tolerable for daily TXs).

### 24.5 Verification UX

The platform exposes `GET /verify/<anchor_id>` showing:
- The anchored data (preimage)
- The hash
- The Cardano TX hash containing the anchor
- A link to a block explorer (cexplorer.io / cardanoscan.io)
- For collections: a search box to verify your own vote with a Merkle inclusion proof

Any DRep can independently recompute the hash from the displayed preimage and check it against the TX metadata.

---

## 25. Database Schema

PostgreSQL, managed via Prisma. Tables grouped by domain.

### 25.1 Identity and access

```sql
-- Cardano wallet-authenticated users (everyone who logs in)
CREATE TABLE app_user (
  id              UUID PRIMARY KEY,
  stake_key_hash  TEXT UNIQUE NOT NULL,
  stake_address   TEXT NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- DRep profile (created after admission)
CREATE TABLE drep (
  id                    UUID PRIMARY KEY,
  user_id               UUID UNIQUE REFERENCES app_user(id),
  drep_id_onchain       TEXT UNIQUE NOT NULL,   -- CIP-95 DRep ID
  status                TEXT NOT NULL,          -- PENDING_ADMISSION, ADMITTED, REMOVED
  bio                   TEXT,
  socials               JSONB,
  contact               JSONB,
  subcategory_ids       TEXT[],
  kyc_optin             BOOLEAN DEFAULT FALSE,
  calls_optin           BOOLEAN DEFAULT FALSE,
  admission_call_optin  BOOLEAN DEFAULT FALSE,
  admitted_at           TIMESTAMPTZ,
  removed_at            TIMESTAMPTZ
);

-- Board membership (a DRep can be elevated to board)
CREATE TABLE board_membership (
  id          UUID PRIMARY KEY,
  drep_id     UUID REFERENCES drep(id),
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ
);

-- Expert (non-DRep) — for milestone reviewing only
CREATE TABLE expert (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES app_user(id),
  display_name  TEXT NOT NULL,
  bio           TEXT,
  subcategory_ids TEXT[],
  approved_by_board BOOLEAN DEFAULT FALSE
);
```

### 25.2 Configuration and taxonomy

```sql
-- Singleton-row table of platform-level configurable parameters
CREATE TABLE platform_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,        -- typed JSON value
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_by  UUID REFERENCES app_user(id)
);

-- Configurable subcategories (e.g., DeFi, Governance, Marketing)
CREATE TABLE subcategory (
  id       TEXT PRIMARY KEY,         -- slug
  label    TEXT NOT NULL,
  active   BOOLEAN DEFAULT TRUE,
  sort_idx INT DEFAULT 0
);
```

### 25.3 Rounds and categories

```sql
CREATE TABLE round (
  id              UUID PRIMARY KEY,
  number          INT UNIQUE NOT NULL,
  name            TEXT,
  status          TEXT NOT NULL,    -- PREPARATION, FILTERING, DV, FUNDING, CLOSED
  budget_ada      BIGINT NOT NULL,  -- in Lovelace
  rewards_pool_ada BIGINT NOT NULL,
  multisig_address TEXT NOT NULL,
  intersect_tx_hash TEXT,           -- TW receipt
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ
);

CREATE TABLE round_category (
  id              UUID PRIMARY KEY,
  round_id        UUID REFERENCES round(id),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,    -- GRANT or RFP
  description     TEXT,
  conditions      TEXT,
  min_ada         BIGINT,
  max_ada         BIGINT,
  allocated_ada   BIGINT NOT NULL
);

CREATE TABLE round_drep_eligibility (
  round_id   UUID REFERENCES round(id),
  drep_id    UUID REFERENCES drep(id),
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (round_id, drep_id)
);

CREATE TABLE round_schedule (
  round_id        UUID REFERENCES round(id),
  stage_key       TEXT NOT NULL,    -- 'submission', 'filter_fb1', 'filter_edit', ...
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  prolonged_from  TIMESTAMPTZ,
  PRIMARY KEY (round_id, stage_key)
);
```

### 25.4 Proposals

```sql
CREATE TABLE proposal (
  id                       UUID PRIMARY KEY,
  type                     TEXT NOT NULL,   -- FUNDING or INTERNAL
  status                   TEXT NOT NULL,   -- DRAFT, PENDING, ACTIVE, APPROVED, REJECTED, COMPLETE, FAILED
  stage                    TEXT,            -- FILTERING, DV, FUNDING, VOTING (internal)
  submitter_user_id        UUID REFERENCES app_user(id),
  submitter_drep_id        UUID REFERENCES drep(id),
  title                    TEXT NOT NULL,
  content_md               TEXT NOT NULL,
  category_id              UUID REFERENCES round_category(id),
  subcategory_ids          TEXT[],
  round_id                 UUID REFERENCES round(id),
  -- funding
  is_commercial            BOOLEAN,
  requested_amount_ada     BIGINT,
  submission_fee_ada       BIGINT,
  submission_fee_tx_hash   TEXT,
  pledge_amount_ada        BIGINT,
  pledge_return_method     TEXT,  -- LAST_MILESTONE or PER_MILESTONE
  pledge_tx_hash           TEXT,
  team_info                JSONB,
  cost_breakdown_md        TEXT,
  revenue_sharing          JSONB,
  -- internal
  internal_type            TEXT,  -- INSTRUCTIVE, INFORMATIVE, POLL
  voters_scope             TEXT,  -- DREPS_ONLY, BOARD_ONLY, BOTH
  actors                   JSONB,
  delivery_date            TIMESTAMPTZ,
  poll_options             JSONB,
  threshold_kind           TEXT,
  -- common
  voting_type              TEXT NOT NULL,   -- ONE_PERSON_ONE_VOTE or BALANCED
  approval_threshold_pct   NUMERIC(5,2),
  voting_start_at          TIMESTAMPTZ,
  voting_end_at            TIMESTAMPTZ,
  result_finalized_at      TIMESTAMPTZ,
  version                  INT DEFAULT 1,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE proposal_version (
  id               UUID PRIMARY KEY,
  proposal_id      UUID REFERENCES proposal(id),
  version          INT NOT NULL,
  content_md       TEXT NOT NULL,
  edited_by        UUID REFERENCES app_user(id),
  edited_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (proposal_id, version)
);

CREATE TABLE milestone (
  id            UUID PRIMARY KEY,
  proposal_id   UUID REFERENCES proposal(id),
  idx           INT NOT NULL,
  description   TEXT,
  amount_ada    BIGINT NOT NULL,
  deadline_at   TIMESTAMPTZ,
  status        TEXT NOT NULL,   -- NOT_STARTED, POA_SUBMITTED, IN_REVIEW, APPROVED, REJECTED
  closed_at     TIMESTAMPTZ
);

CREATE TABLE milestone_poa (
  id           UUID PRIMARY KEY,
  milestone_id UUID REFERENCES milestone(id),
  content_md   TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  attempt      INT NOT NULL
);
```

### 25.5 Reviewer assignments

```sql
CREATE TABLE filter_assignment (
  id           UUID PRIMARY KEY,
  proposal_id  UUID REFERENCES proposal(id),
  drep_id      UUID REFERENCES drep(id),
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  accepted_at  TIMESTAMPTZ,
  released_at  TIMESTAMPTZ,        -- if reassigned
  replaced_by  UUID REFERENCES drep(id)
);

CREATE TABLE milestone_assignment (
  id           UUID PRIMARY KEY,
  milestone_id UUID REFERENCES milestone(id),
  reviewer_drep_id  UUID REFERENCES drep(id),
  reviewer_expert_id UUID REFERENCES expert(id),
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  confirmed_by_board_at TIMESTAMPTZ,
  released_at  TIMESTAMPTZ
);
```

### 25.6 Votes and snapshots

```sql
CREATE TABLE vote_snapshot (
  id                  UUID PRIMARY KEY,
  proposal_id         UUID REFERENCES proposal(id),
  taken_at            TIMESTAMPTZ DEFAULT NOW(),
  anchor_id           UUID                              -- FK to anchor; null until anchored
);

CREATE TABLE vote_snapshot_entry (
  snapshot_id         UUID REFERENCES vote_snapshot(id),
  drep_id             UUID REFERENCES drep(id),
  stake_lovelace      BIGINT NOT NULL,
  merit_points        INT NOT NULL,
  base_power          NUMERIC(12,4),
  merit_multiplier    NUMERIC(12,4),
  final_power         NUMERIC(12,4),
  PRIMARY KEY (snapshot_id, drep_id)
);

CREATE TABLE vote (
  id            UUID PRIMARY KEY,
  proposal_id   UUID REFERENCES proposal(id),
  drep_id       UUID REFERENCES drep(id),
  milestone_id  UUID REFERENCES milestone(id),     -- nullable; set for milestone votes
  choice        TEXT NOT NULL,    -- YES, NO, ABSTAIN
  rationale     TEXT,
  cast_at       TIMESTAMPTZ DEFAULT NOW(),
  superseded_by UUID REFERENCES vote(id)           -- vote changes
);

CREATE TABLE quick_poll (
  id           UUID PRIMARY KEY,
  round_id     UUID REFERENCES round(id),
  category_id  UUID REFERENCES round_category(id),
  candidates   UUID[],                          -- proposal ids tied
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  extensions   INT DEFAULT 0,
  status       TEXT,                             -- PENDING_BOARD, ACTIVE, RESOLVED, FAILED
  winner_id    UUID REFERENCES proposal(id)
);

CREATE TABLE quick_poll_vote (
  quick_poll_id UUID REFERENCES quick_poll(id),
  drep_id       UUID REFERENCES drep(id),
  choice        UUID REFERENCES proposal(id),   -- which tied proposal they chose
  cast_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (quick_poll_id, drep_id)
);
```

### 25.7 Merit ledger

```sql
CREATE TABLE merit_ledger (
  id           UUID PRIMARY KEY,
  drep_id      UUID REFERENCES drep(id),
  delta        NUMERIC(6,2) NOT NULL,        -- e.g. +1, -1, +0.5, +10
  reason_code  TEXT NOT NULL,                -- e.g. 'DV_VOTE', 'FILTER_COMPLETE', 'MISSED_DV', 'BOARD_ROUND_START'
  reference_id UUID,                          -- proposal_id, milestone_id, round_id, etc.
  occurred_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX merit_ledger_drep_idx ON merit_ledger(drep_id, occurred_at);

-- Computed view for current balance
CREATE VIEW drep_merit_current AS
  SELECT drep_id, GREATEST(-200, LEAST(200, SUM(delta))) AS current_points
  FROM merit_ledger
  GROUP BY drep_id;
```

### 25.8 Rewards

```sql
CREATE TABLE reward_calculation (
  id            UUID PRIMARY KEY,
  round_id      UUID REFERENCES round(id),
  kind          TEXT NOT NULL,     -- FILTER, DV_FIXED, DV_BONUS, MILESTONE
  pool_ada      BIGINT NOT NULL,
  total_units   NUMERIC,           -- total cast votes / total weight, etc.
  computed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reward_entry (
  id                UUID PRIMARY KEY,
  reward_calculation_id UUID REFERENCES reward_calculation(id),
  drep_id           UUID REFERENCES drep(id),
  amount_ada        BIGINT NOT NULL,
  paid_in_tx        TEXT,            -- multisig TX hash once paid
  paid_at           TIMESTAMPTZ
);
```

### 25.9 Treasury and Cardano

```sql
CREATE TABLE multisig_action (
  id            UUID PRIMARY KEY,
  kind          TEXT NOT NULL,   -- REWARD_PAYOUT, PROJECT_FUNDING, PLEDGE_RETURN, OPS, LEFTOVER_RETURN
  tx_cbor       TEXT,            -- unsigned tx cbor
  tx_hash       TEXT,            -- once submitted
  status        TEXT NOT NULL,   -- PENDING_SIGS, BROADCASTED, CONFIRMED, FAILED
  amount_ada    BIGINT,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE multisig_signature (
  id            UUID PRIMARY KEY,
  action_id     UUID REFERENCES multisig_action(id),
  board_drep_id UUID REFERENCES drep(id),
  witness_cbor  TEXT NOT NULL,
  signed_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (action_id, board_drep_id)
);

CREATE TABLE cardano_tx_observation (
  tx_hash       TEXT PRIMARY KEY,
  block_height  BIGINT,
  confirmed_at  TIMESTAMPTZ,
  metadata      JSONB,
  observed_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### 25.10 Anchoring

```sql
CREATE TABLE anchor (
  id            UUID PRIMARY KEY,
  kind          TEXT NOT NULL,
  round_id      UUID,
  proposal_id   UUID,
  hash          TEXT NOT NULL,
  preimage      JSONB,           -- the canonical data being hashed
  tx_hash       TEXT,            -- Cardano TX hash carrying the anchor metadata
  metadata_label INT NOT NULL,   -- 80808080
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  submitted_at  TIMESTAMPTZ,
  confirmed_at  TIMESTAMPTZ
);

CREATE INDEX anchor_kind_idx ON anchor(kind, created_at);
```

### 25.11 Communication and notifications

```sql
CREATE TABLE comment (
  id            UUID PRIMARY KEY,
  proposal_id   UUID REFERENCES proposal(id),
  parent_id     UUID REFERENCES comment(id),
  author_user_id UUID REFERENCES app_user(id),
  content_md    TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE private_thread (
  id            UUID PRIMARY KEY,
  proposal_id   UUID REFERENCES proposal(id),
  kind          TEXT NOT NULL    -- SUBMITTER_BOARD, DREP_BOARD_SHARED
);

CREATE TABLE private_message (
  id            UUID PRIMARY KEY,
  thread_id     UUID REFERENCES private_thread(id),
  author_user_id UUID REFERENCES app_user(id),
  content_md    TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notification (
  id            UUID PRIMARY KEY,
  user_id       UUID REFERENCES app_user(id),
  kind          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  channels_sent TEXT[],        -- which channels succeeded
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notification_preference (
  user_id       UUID PRIMARY KEY REFERENCES app_user(id),
  in_app        BOOLEAN DEFAULT TRUE,
  email         BOOLEAN DEFAULT TRUE,
  email_addr    TEXT,
  telegram      BOOLEAN DEFAULT FALSE,
  telegram_chat_id TEXT
);
```

### 25.12 Avoid periods and recommendations

```sql
CREATE TABLE drep_avoid_period (
  id          UUID PRIMARY KEY,
  drep_id     UUID REFERENCES drep(id),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE drep_recommendation (
  id              UUID PRIMARY KEY,
  recommended_drep_id UUID REFERENCES drep(id),       -- the applicant
  recommender_drep_id UUID REFERENCES drep(id),       -- existing DRep vouching
  note            TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 25.13 Platform Administration

Completely separate from the wallet-authenticated user tables. No foreign keys link `admin_user` to `app_user` or `drep` — the identities are independent by design.

```sql
CREATE TABLE admin_user (
  id              UUID PRIMARY KEY,
  username        TEXT UNIQUE NOT NULL,
  email           TEXT NOT NULL,
  password_hash   TEXT NOT NULL,                -- Argon2id
  status          TEXT NOT NULL,                -- ACTIVE, DISABLED, REMOVED
  created_by      UUID REFERENCES admin_user(id),  -- nullable; first admin has NULL (created via CLI)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ,
  removed_at      TIMESTAMPTZ
);

-- Hard cap of 3 active admins enforced by application logic.

CREATE TABLE admin_2fa (
  admin_id        UUID PRIMARY KEY REFERENCES admin_user(id),
  totp_secret     TEXT NOT NULL,                -- encrypted at rest
  enrolled_at     TIMESTAMPTZ,
  required        BOOLEAN DEFAULT TRUE          -- mandatory mainnet, may be FALSE on testnet
);

CREATE TABLE admin_recovery_code (
  id              UUID PRIMARY KEY,
  admin_id        UUID REFERENCES admin_user(id),
  code_hash       TEXT NOT NULL,                -- Argon2id of the code
  used_at         TIMESTAMPTZ                   -- NULL = unused
);

CREATE TABLE admin_session (
  id              UUID PRIMARY KEY,
  admin_id        UUID REFERENCES admin_user(id),
  ip              INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

CREATE TABLE admin_invitation (
  id              UUID PRIMARY KEY,
  username        TEXT NOT NULL,
  email           TEXT NOT NULL,
  token_hash      TEXT NOT NULL,                -- one-time invitation token
  created_by      UUID REFERENCES admin_user(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ
);

CREATE TABLE admin_audit_log (
  id              UUID PRIMARY KEY,
  admin_id        UUID REFERENCES admin_user(id),
  action          TEXT NOT NULL,                -- e.g. GENESIS_APPROVED, ADMIN_ADDED, ADMIN_REMOVED, SWITCH_ALL, MAINTENANCE_MODE_ON, etc.
  target          TEXT,                          -- free-form: target admin id, config key, etc.
  payload         JSONB,                         -- structured details (before/after for switches)
  ip              INET,
  user_agent      TEXT,
  occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only; no UPDATE or DELETE in application code.
CREATE INDEX admin_audit_log_admin_idx ON admin_audit_log(admin_id, occurred_at);
CREATE INDEX admin_audit_log_action_idx ON admin_audit_log(action, occurred_at);

CREATE TABLE admin_login_attempt (
  id              UUID PRIMARY KEY,
  username        TEXT NOT NULL,
  ip              INET NOT NULL,
  success         BOOLEAN NOT NULL,
  attempted_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Used for brute-force protection. Rows older than 24h are pruned by a daily job.
CREATE INDEX admin_login_attempt_username_idx ON admin_login_attempt(username, attempted_at);
CREATE INDEX admin_login_attempt_ip_idx ON admin_login_attempt(ip, attempted_at);

CREATE TABLE platform_state (
  id              SMALLINT PRIMARY KEY DEFAULT 1, -- singleton row
  genesis_approved_at  TIMESTAMPTZ,
  genesis_approved_by  UUID REFERENCES admin_user(id),
  genesis_payload      JSONB,                     -- preserved for audit
  maintenance_mode     BOOLEAN DEFAULT FALSE,
  paused               BOOLEAN DEFAULT FALSE,
  CHECK (id = 1)
);
```

---

## 26. API Surface

REST over HTTPS. JSON bodies. JWT session cookies for auth. Versioned under `/api/v1`. Read-only endpoints are open; write endpoints require an authenticated session.

### 26.1 Authentication

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/nonce` | Issue a signing nonce for wallet login |
| POST | `/auth/verify` | Verify CIP-8 signature, issue session JWT |
| POST | `/auth/logout` | Revoke session |
| GET  | `/auth/me` | Current user, roles, DRep status |

### 26.2 Public read (no auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/rounds` | List all rounds with status and stage |
| GET | `/rounds/:id` | Round detail (categories, schedule, eligible DReps) |
| GET | `/rounds/:id/proposals` | All proposals in a round, filterable by status/category |
| GET | `/proposals/:id` | Proposal detail (current version + comments) |
| GET | `/proposals/:id/versions` | Edit history |
| GET | `/proposals/:id/votes` | Vote tally (per choice, per DRep with FinalPower) |
| GET | `/proposals/:id/milestones` | Milestones with status |
| GET | `/internal-proposals` | List internal proposals |
| GET | `/internal-proposals/:id` | Internal proposal detail |
| GET | `/dreps` | All admitted DReps with current voting power + merit |
| GET | `/dreps/:id` | DRep profile + voting history |
| GET | `/board` | Current board members |
| GET | `/verify/anchor/:id` | Anchor verification page data |
| GET | `/config` | Public-readable platform parameters |

### 26.3 Submitters

| Method | Path | Purpose |
|---|---|---|
| POST | `/proposals` | Create draft funding proposal |
| PATCH | `/proposals/:id` | Edit draft / edit during allowed window |
| POST | `/proposals/:id/submit` | Submit (requires fee TX hash) |
| POST | `/proposals/:id/pledge` | Submit pledge TX hash |
| POST | `/proposals/:id/milestones/:idx/poa` | Submit Proof of Achievement |
| POST | `/proposals/:id/comments` | Post a public comment |
| GET | `/me/proposals` | My proposals (drafts, active, history) |

### 26.4 DReps

| Method | Path | Purpose |
|---|---|---|
| POST | `/me/drep-application` | Submit DRep admission form |
| GET | `/me/drep` | My DRep profile |
| PATCH | `/me/drep` | Update bio / categories / contact |
| POST | `/me/filter-optin` | Opt into the filtering pool |
| DELETE | `/me/filter-optin` | Opt out |
| POST | `/me/milestone-review-optin` | Opt into milestone review pool |
| POST | `/me/avoid-period` | Signal an upcoming avoid period |
| GET | `/me/assignments` | My current filter / milestone assignments |
| POST | `/assignments/filter/:id/accept` | Accept a filter assignment |
| POST | `/assignments/filter/:id/decline` | Decline (triggers reassignment) |
| POST | `/proposals/:id/votes` | Cast / change a vote |
| POST | `/quick-polls/:id/votes` | Cast a quick-poll vote |
| POST | `/internal-proposals` | Submit an internal proposal |
| GET | `/me/rewards` | My pending and historical rewards |
| GET | `/me/merit` | My merit ledger |
| GET | `/me/notifications` | My notifications |

### 26.5 Board (elevated)

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/rounds` | Create round |
| PATCH | `/admin/rounds/:id` | Update configuration (categories, periods, eligible DReps) |
| POST | `/admin/rounds/:id/start-stage/:stage` | Manually transition |
| POST | `/admin/rounds/:id/prolong` | Prolong a period (auto-shifts downstream) |
| POST | `/admin/drep-applications/:id/vote` | Board vote on DRep admission |
| POST | `/admin/dreps/:id/propose-removal` | Initiate removal proposal |
| POST | `/admin/proposals/:id/confirm-fee` | Manually confirm a fee payment (override) |
| POST | `/admin/proposals/:id/confirm-pledge` | Manually confirm a pledge payment (override) |
| POST | `/admin/proposals/:id/terminate` | Mark proposal FAILED |
| POST | `/admin/milestones/:id/reassign` | Reassign a reviewer |
| POST | `/admin/milestones/:id/extend` | Grant extension beyond auto-extension |
| POST | `/admin/quick-polls/:id/confirm-launch` | One-click confirm for auto-detected ties |
| POST | `/admin/rewards/:id/prepare-payout` | Build the multisig TX for a reward batch |
| POST | `/admin/multisig-actions/:id/sign` | Submit board member's witness |
| POST | `/admin/multisig-actions/:id/broadcast` | Submit when 3 sigs collected |
| GET | `/admin/dashboard` | Pending actions, calendar of stages, reconciliation status |
| PATCH | `/admin/config/:key` | Update a platform parameter |
| POST | `/admin/subcategories` | Add a subcategory |
| PATCH | `/admin/subcategories/:id` | Edit / deactivate |
| POST | `/admin/experts` | Approve an expert |

> Note: the `/admin/*` namespace is for **board** governance actions (named historically). The Platform Admin (sysadmin) namespace is `/sysadmin/*` below — entirely separate auth, entirely separate scope.

### 26.6 Platform Admin (sysadmin)

All `/sysadmin/*` endpoints require an `admin_session` cookie (username + password + 2FA login). Wallet sessions are rejected; `app_session` cookies cannot access this namespace. All actions are recorded in `admin_audit_log`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/sysadmin/login` | Username + password; returns a one-time challenge requiring 2FA |
| POST | `/sysadmin/login/2fa` | Submit TOTP code; on success, issues `admin_session` |
| POST | `/sysadmin/login/recovery` | Submit a one-time recovery code instead of TOTP |
| POST | `/sysadmin/logout` | Revoke current admin session |
| GET | `/sysadmin/me` | Current admin identity |
| GET | `/sysadmin/admins` | List all admins (active + removed) |
| POST | `/sysadmin/admins/invite` | Create an invitation token for a new admin |
| POST | `/sysadmin/admins/accept-invite` | Consume an invitation: set password + enroll 2FA |
| POST | `/sysadmin/admins/:id/disable` | Disable an admin (revokes sessions) |
| POST | `/sysadmin/admins/:id/remove` | Remove an admin (status → REMOVED) |
| POST | `/sysadmin/admins/:id/reset-2fa` | Reset another admin's 2FA (caller must complete 2FA) |
| POST | `/sysadmin/admins/:id/reset-password` | Trigger password-reset email for another admin |
| POST | `/sysadmin/admins/switch-all` | Atomic rotate: enroll new set, then disable old set |
| GET | `/sysadmin/genesis` | Show current genesis state (proposed / approved) |
| POST | `/sysadmin/genesis/upload` | Upload `genesis.json` for review |
| POST | `/sysadmin/genesis/approve` | Approve the proposed founding board (one-time, irreversible) |
| POST | `/sysadmin/genesis/reject` | Reject the proposed file (admin can re-upload) |
| GET | `/sysadmin/health` | Detailed system health (DB, Redis, Cardano indexer, queue depths) |
| GET | `/sysadmin/audit-log` | Filterable, paginated audit log; exportable |
| POST | `/sysadmin/maintenance-mode` | Toggle read-only maintenance mode |
| POST | `/sysadmin/pause` | Force-pause platform (block all non-admin writes) |
| POST | `/sysadmin/backup` | Trigger an on-demand backup |
| POST | `/sysadmin/restore` | Restore from a named backup (irreversible; requires re-confirmation) |
| GET | `/sysadmin/tech-config` | Read non-governance technical config |
| PATCH | `/sysadmin/tech-config/:key` | Update non-governance technical config |
| GET | `/sysadmin/anchor-wallet` | Anchor hot wallet status (balance, recent TXs) |
| POST | `/sysadmin/anchor-wallet/rotate-key` | Rotate the anchor hot wallet signing key |
| POST | `/sysadmin/anchor-wallet/topup-request` | Build an unsigned TX from DAO Multisig → hot wallet (board must sign) |
| GET | `/sysadmin/logs` | Stream / page through application logs |

### 26.7 Webhooks / internal

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/cardano/tx-confirmed` | Blockfrost webhook (paid plan) |
| GET | `/internal/healthz` | Health check |
| GET | `/internal/metrics` | Prometheus metrics |

### 26.8 Standard conventions

- Pagination via `?cursor=` and `?limit=` (max 100)
- Filtering via query params (`?status=ACTIVE&category=Governance`)
- Errors as RFC 7807 problem details
- Rate limiting: 60 req/min per IP for unauth, 600 req/min per user for auth, no limit for board
- All write endpoints return the resulting resource (no separate GET needed)
- All times in ISO-8601 UTC

---

## 27. Background Jobs and Scheduler

BullMQ on Redis. Three job types: **scheduled** (cron-style), **delayed** (single-fire after N seconds), and **on-demand** (enqueued by API handlers).

### 27.1 Scheduled jobs

| Job | Schedule | Purpose |
|---|---|---|
| `stage-transition-check` | every 5 minutes | Detect periods that have ended; advance stage; trigger downstream actions |
| `voting-deadline-check` | every 5 minutes | Check D&V and milestone deadlines; auto-extend if needed; alert board |
| `cardano-tx-poller` | every 30 seconds | Poll pending submission-fee and pledge TX hashes for confirmation |
| `cardano-balance-recon` | daily 01:00 UTC | Reconcile DAO multisig on-chain balance against DB ledger |
| `daily-anchor-vote-tallies` | daily 02:00 UTC | Anchor `hash(yesterday's votes)` to Cardano |
| `daily-anchor-merit` | daily 02:10 UTC | Anchor `hash(yesterday's merit deltas)` |
| `notification-digest-email` | daily 08:00 UTC | Email digest of in-app notifications for users without per-event email |
| `pledge-grace-check` | daily 00:00 UTC | Check if pledge grace period expired; alert board to act |
| `milestone-notice-3-2-1` | daily 00:00 UTC | Send 3-day / 2-day / 1-day reminders before milestone deadlines |
| `board-reward-deadline-check` | weekly | Flag boards that haven't distributed rewards within 30 days |
| `avoid-period-cleanup` | hourly | Activate/deactivate avoid periods based on time |

### 27.2 Delayed jobs

| Job | Triggered by | Delay |
|---|---|---|
| `filter-assignment-timeout` | filter assignment created | 48 hours — reassign if not accepted |
| `quick-poll-end-check` | quick poll launched | end_at − now |
| `milestone-period-end` | POA submitted | `MILESTONE_CHECK_PERIOD_DAYS` |
| `voting-period-end` | voting started | end_at − now |

### 27.3 On-demand jobs

| Job | Triggered by | Action |
|---|---|---|
| `compute-rewards` | board action / stage end | Compute reward entries for a calculation kind |
| `prepare-multisig-tx` | board action | Build TX CBOR for a batch payout |
| `submit-anchor` | hash-able event | Build and broadcast metadata TX (hot wallet) |
| `send-notification` | many events | Dispatch to in-app / email / Telegram |
| `random-draw-reviewers` | submission stage end | Run category-match + random draw for all proposals |

### 27.4 Idempotency and retries

- Every job is keyed by a deterministic id (`{kind}:{reference_id}:{date}`) and the queue rejects duplicates within 24h
- 3 retries with exponential backoff (1m, 5m, 30m) for transient failures
- Permanent failures go to a dead-letter queue; on-call (the board) is alerted via email
- Cardano TX submission is the most failure-prone path; we use Lucid's retry helpers + manual board action as fallback

---

# Part III — Delivery

## 28. MVP Scope Cut and Phases

The full spec is a multi-month build. We slice the MVP to **the thinnest end-to-end path** that demonstrates the DAO can operate one round and one proposal through filtering, vote, funding, and one milestone review. Everything outside that path is deferred.

### 28.1 MVP definition

A real DRep must be able to do, end-to-end:
1. Connect their wallet, apply, and be admitted by the board
2. See an active round and submit a funding proposal with a fee TX
3. Be assigned (as a different DRep) to filter that proposal and vote
4. See the proposal in Debate & Vote, comment, and vote with balanced power
5. See the result, including any quick-poll tie-break
6. Send a pledge and have it auto-verified
7. As a reviewer, see the milestone, receive POA, and vote
8. See a reward calculation and the multisig TX paying it out
9. Independently verify a vote tally hash against the on-chain anchor

If those work, the platform is operational.

### 28.2 Phase 1 — MVP (target: ~3 months)

**In:**
- Wallet login (CIP-30 + CIP-8 for Eternl, Lace) — Yoroi and Nami in Phase 2
- DRep admission (manual board review only — autonomous gate deferred)
- Rounds (one at a time — parallel rounds in Phase 2)
- Categories (no RFP type in MVP, only GRANT — RFP in Phase 2)
- Funding proposals: submit, filter, D&V, single quick-poll if needed
- Internal proposals: submit, vote, result (no polls, only instructive/informative)
- Milestone review: POA submission, vote, board confirm, payout
- Pledge: TX-hash flow
- Merit ledger with all earn/lose events
- DAO multisig: build → sign → broadcast workflow with 3-of-5
- On-chain anchoring: daily vote-tally + merit hashes; per-proposal snapshot hashes
- Notifications: in-app + email (Telegram in Phase 2)
- Configurable parameters (admin UI)
- Public proposal browser, vote viewer, DRep profile pages

**Out:**
- Experts (only DReps can review milestones)
- Private messaging (use Telegram externally)
- Autonomous Sybil-protection engine
- RFP category type
- Telegram bot
- Parallel rounds
- Reward bonuses (only fixed rewards in MVP)
- Quick-poll auto-detection (board manually launches)
- Cardano webhook (use 30s polling)
- Recommendation-based admission

### 28.3 Phase 2 — Production (target: +2 months after MVP)

- Parallel rounds
- Reward bonuses (full formula)
- Quick-poll auto-detection and one-click confirm
- RFP categories
- Experts for milestone review
- Telegram notifications
- Autonomous Sybil-protection engine
- Recommendation-based admission
- Private messaging (submitter ↔ board, DRep ↔ board)
- Blockfrost webhook integration

### 28.4 Phase 3 — Hardening (target: +1-2 months)

- Hot wallet → 2-of-3 quorum for anchoring
- Audit logging UI for board actions
- Disaster recovery: full backup + restore drill
- Load testing (target: 500 DReps, 200 active proposals, 50 RPS)
- Security review and penetration test
- Internationalisation framework (English-only content, but i18n-ready)

### 28.5 Deferred (post-Phase 3)

- Private votes / blurred voting power
- Stablecoin support
- Automated on-chain execution of internal proposals
- Third income pillar (% from funded project)
- Mobile app (web is mobile-responsive)
- Catalyst-style ranking refinements
- Multiple language translations

---

## 29. Open Questions and TODOs

Items that need a decision, verification, or further investigation before or during implementation.

### 29.1 Verification required (external)

| # | Item | Owner | Notes |
|---|---|---|---|
| Q1 | **Confirm Intersect can send TW directly to a 3-of-5 multisig address.** Per decision #26, the DAO Multisig is the recipient. Verify this is allowed by Intersect's current TW recipient policy. | You (contact Intersect) | If not allowed, alternative: an EOA controlled by a board member, who then immediately forwards to multisig. Inferior but viable. |
| Q2 | **Verify the chosen TW amount (4M ADA per round) covers project funding + DAO ops + rewards.** | You | Reconcile the per-round budget breakdown with the planned proposal sizes. |
| Q3 | **Mainnet vs Preview/Preprod for initial testing.** Cardano DRep registration is mainnet-only for production. | You | Recommend: build/test on Preprod, deploy MVP on mainnet with limited initial DRep cohort. |

### 29.2 Implementation decisions needed during build

| # | Item | Notes |
|---|---|---|
| I1 | ~~Board election mechanism for the interim period.~~ **Resolved in section 18** (genesis.json + Admin approval flow). The 5 names are nominated off-platform per the Catalyst proposal; see section 17.6. |
| I2 | **Hot wallet for anchoring — single signer or 2-of-3?** Section 24.4 recommends single signer for MVP; revisit before mainnet launch. |
| I3 | **Exact Merkle tree library.** Standard sorted-keccak Merkle trees are fine; pick a Node.js lib with TypeScript types (e.g., `merkletreejs`). |
| I4 | **Email service:** Resend has a clean DX; AWS SES is cheaper at scale. Recommend Resend for MVP. |
| I5 | **What is the DAO Multisig's "operations" balance kept at?** A floor amount (e.g., 5,000 ADA) below which automated alerts fire. |
| I6 | **DRep ID change handling.** If a DRep retires their on-chain DRep and registers a new one, what's the platform's behavior? Recommend: treat as a new DRep; old votes/merit stay with the old ID and are visible historically. |
| I7 | **What's the "round number" for the first round?** Recommend: 1. Document for clarity. |
| I8 | **Comment moderation policy.** No moderation in MVP; if abuse happens, board can soft-delete a comment via DB. Document this. |
| I9 | **Vote rationale minimum length.** Tentatively 200 chars; might need to lower to 100 or raise. Validate with a few real proposals. |

### 29.3 Risk items to monitor

| # | Item | Mitigation |
|---|---|---|
| R1 | **Blockfrost downtime.** Free Koios as fallback; circuit-breaker pattern in `CardanoQueryService`. |
| R2 | **Multisig coordination failure.** If 2 board members go silent, no rewards can be paid. Mitigation: design the workflow to surface "needs sigs" prominently; add SMS escalation in Phase 3. |
| R3 | **Vote-buying via merit-multiplier abuse.** A DRep at +200 has 2× power. If +200 is too easy to reach, top DReps become unkillable. Monitor distribution; consider raising the cap or adding decay in Phase 2 if the distribution skews. |
| R4 | **Submitter sends wrong fee amount.** Backend rejects; submitter must re-send. Document this case in the form UI. |
| R5 | **Cardano block hash unreliability for randomness.** Block hashes are theoretically grindable by a single block producer. For MVP this is acceptable; for Phase 3, consider a commit-reveal scheme using multiple recent block hashes. |
| R6 | **Submission-fee TX hash from a different wallet than the submitter.** Reject in verification; show clear error. |
| R7 | **Pledge sent to wrong address.** Submitter loses funds; this is on them, but the form should *prominently* display the correct address with a copy button + QR code. |

### 29.4 Things we know we're skipping

- Multi-language UI (Phase 3+ with framework, no translations in MVP)
- Mobile app (responsive web is sufficient)
- Slack / Discord integration (Telegram only)
- On-chain enforcement of internal proposal actions (always off-platform)
- Stablecoin (USDM, DJED, USDA) support
- Automated KYC/KYB
- Cross-DAO interoperability

### 29.5 Action items for next session

Before writing code, we should:

1. **Get answer to Q1 from Intersect** (recipient address policy for TW)
2. **Confirm the 5 initial board members** are identified, have wallets ready, agree to operate the multisig, and provide their stake addresses + DRep IDs for inclusion in `genesis.json` (section 17.5)
3. **Identify the first Platform Admin** (likely the project lead / yourself) and decide on the 2nd and optionally 3rd Admin for redundancy (section 18.5)
4. **Decide hosting region** (latency for board members? GDPR for European users?)
5. **Set up a clean monorepo** with the layout in 22.3
6. **Begin Phase 1 MVP** starting with: Admin bootstrap → genesis approval → wallet login → DRep admission → board UI for rounds. These steps unblock everything else.

---

## Document end

This v2 design integrates the 32 decisions from your review session, removes all Clarity references, and adds the technical layer (DB schema, API surface, anchoring spec, MVP cut) needed to start building.

It is a draft. Items flagged in section 29 are open. Items flagged inline with `(per decision #N)` reference your earlier responses.

Next steps:
1. Read this end-to-end. Mark anything you disagree with or that doesn't match your intent.
2. Resolve open questions in section 29.
3. Start implementation — proposed entry point is Phase 1 MVP per section 28.2.

---
