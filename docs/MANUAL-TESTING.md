# Manual testing guide — DRep DAO (Monday)

A walkthrough for hands-on testing on **Preprod**. The dev DB is pre-seeded with a
completed round and an active round, both with **real on-chain proofs**.

> Last updated: 2026-05-23.

## 0. Start the stack

```bash
cd ~/projects/drep-dao
pnpm infra:up                 # Postgres + Redis (if not already up)
pnpm -C apps/api dev          # API on http://localhost:4000  (global prefix /api/v1)
pnpm -C apps/web dev          # Web on http://localhost:3000
```

If a page ever shows *"Application error: a client-side exception"* after a package
rebuild, it's a stale dev bundle — stop `next dev`, `rm -rf apps/web/.next`, restart,
and hard-refresh (Ctrl+Shift+R).

## 1. Personas (import in Eternl/Lace, **Preprod**, 24-word)

Seeds in `tools/persona-wallets.json` (gitignored); see `docs/ACTORS.md`.

| Use for testing | Persona | Role |
|---|---|---|
| Board actions, voting, stage control, fee confirmation | **Alice** (`regular`) and Dave/Erin/Frank/Grace | BOARD (5-of-5) |
| Submitting proposals, paying fees | **Carol** (`holder`) | ADA holder / submitter |
| A registered DRep that is **not** a DAO member | Heidi / Ivan / Judy | DREP (not admitted) |

Admin (separate): `/admin/login`, user `satucha`.

## 2. What's pre-seeded (to look at first)

- **Rounds** → **Round Alpha (demo)** — `CLOSED`; its proposal *"Cardano wallet UX
  toolkit"* is `COMPLETE` (it went fee → edit → filtering → D&V → milestone).
- **Rounds** → **Round Beta (demo)** — `active`, in FILTERING, with two proposals
  under review (*Open liquidity router*, *Managed Koios mirror (RFP)*).
- **Rounds** → **Round Gamma (demo)** — `active` (FUNDING), with varied projects: an
  approved+**COMPLETE** project (*Cardano DEX aggregator v2*, all 3 milestones), an
  approved+**ACTIVE** project (*Open mobile wallet*, 1/3 milestones, 1 in review), and a
  filtering-**REJECTED** proposal (*Token airdrop blaster*).
- **DAO Member overview** — board + two non-board members (Heidi, Judy) with varied
  voting power; **Experts** shows Ivan with expertise chips + bio. **Every column header
  is click-to-sort** (toggles ▲/▼; default = adjusted power, highest first).
- **On-chain proofs** — filtering / D&V / milestone anchors for Round Alpha (plus
  earlier admission anchors), each with an explorer link. Confirmed Preprod txs:
  filtering `80d2a6d5…`, D&V `23f8ec68…`, milestone `88c870d0…`.

## 3. Test checklist

### Identity & preferences
- [ ] Sign in with a board wallet → login card shows the **name** on top, role below.
- [ ] **My area → Preferences** → switch the block explorer (Cardanoscan / Cexplorer /
      AdaStat / Custom) → Save → open any on-chain link and confirm it uses your choice.

### Rounds & proposals
- [ ] **Rounds**: Alpha #1 `closed`, Beta #2 `funding` (older, in-flight project),
      Gamma #3 `filtering` (newest) — a later round is never ahead of an earlier one,
      and only one round is in Filtering/Debate & Vote at a time (§5.1). Per-status
      proposal-count chips on each. Click a round → see its proposals.
- [ ] **Proposals**: the round submenu switches between rounds — the proposal list
      updates each time (no stuck detail view).
- [ ] A FILTERING proposal lists exactly the assigned jury (FILTER_REVIEWER_COUNT = 5),
      each with **YES / NO / not voted** (no abstain) and their rationale inline.
- [ ] Open a proposal → the detail shows: content, **filtering** result with each
      reviewer's **public rationale** + an on-chain proof link, **D&V** result with
      rationales + weights + proof link, **milestones**, and **comments on that proposal**.
- [ ] For Alpha's proposal, the **"Edits — original vs updated"** diff is visible.
- [ ] Post a **comment** and a **reply** (5-minute edit window applies).

### Submission + fee (commercial 3% / OSS 1%)
- [ ] **Category min/max ask (§5.2)**: when creating a round, each category has **min ask /
      max ask** inputs + a **conditions** field (min ≤ max enforced). When submitting, the form
      shows the selected category's allowed range; a requested amount outside it is rejected
      (red, both client-side and by the API: "below/exceeds the … ask"). The proposal form also
      has **cost breakdown / team info / revenue sharing** + **expertise tags** (§3.4/§7.1);
      they show on the proposal detail.
- [ ] As Carol, compose a proposal. **Save Draft** keeps it **private** — it shows in *My
      proposals* tagged "DRAFT · private" and is invisible to everyone else (browse the round
      as another user: it isn't listed). The form explains drafts are private.
- [ ] **Open / Edit a draft**: clicking the draft's title opens its read view (no longer
      "proposal not found"); the row also has an **Edit** button that reopens the full form
      pre-filled (title, pitch, amount, milestones, §3.4) so you can change anything and
      Save again — and a **Submit** button. The "DRAFT · private" status stays on the row.
      While editing, the proposal is **not** also listed under the Save/Submit buttons
      (no confusing duplicate), and the **Round** select is locked (round can't change).
- [ ] **Fee tx hash persists**: paste a tx hash, **Save Draft**, reopen via **Edit** — the
      hash is still there (and prefilled in the row's inline Submit). It's just a saved note
      until you Submit; the board still verifies it on-chain before confirming the fee.
- [ ] **Edit after submitting (PENDING)**: a submitted proposal sits at **PENDING** (board
      must confirm the fee). Its **Edit** button opens the **full form** — you can change
      **every** field (title, pitch, amount, milestones, §3.4, and the fee tx); changing the
      amount **recomputes the fee**. Structure only locks once it's ACTIVE (public).
- [ ] **Fix & re-submit a rejected proposal**: when the board rejects the fee, the submitter
      sees the red FEEDBACK and the proposal is **REJECTED** but fully editable — open it,
      enter a **new tx hash** (kept in the history) + change anything, then **Re-submit** → it
      returns to PENDING and the old feedback clears.
- [ ] **Wallet signing (bug check)**: log in with one wallet (e.g. Eternl). On *Actions to
      sign* → Approve, the **same** wallet opens (not a different one). **Cancel** the wallet
      prompt → the action is **NOT** marked approved (you see "Approve cancelled — nothing was
      recorded"). Only a real signature counts.
- [ ] **Submit** needs the on-chain fee **tx hash** (Submit is disabled without it); the draft
      can also be **submitted later** via the inline **Submit** on its My-proposals row. After
      submitting, status is PENDING — still **not public** (only the submitter sees it).
- [ ] As a board member: **My area → "Submission fees to confirm"** shows **every tx hash**
      the submitter entered, each with its own on-chain check (✓ paid / ✗ underpaid / ⏳ not
      found). **Approve** → ACTIVE/Filtering (public); **Reject** → REJECTED (a reason is
      required). Any feedback you type shows the submitter a red **FEEDBACK** box next to the
      fee tx on their proposal.
- [ ] **Change the tx after submitting**: while PENDING, the submitter can open the proposal
      and edit the fee tx hash — the board then sees all hashes entered (the latest is marked).
      Once ACTIVE, the tx can no longer be changed.
- [ ] **Zero fee**: set a round's open-source (or commercial) submission fee to **0%** in its
      settings. On the submit form, ticking/unticking **Commercial** shows/hides the tx field
      accordingly; for the 0% type there's no fee box and **Submit makes the proposal ACTIVE
      immediately** (no payment, no board confirmation).
- [ ] **Acceptance anchor (§3/§12)**: when a proposal becomes **ACTIVE** (fee approved, or no
      fee), it gets a **unique id** (e.g. `R6-P3`, shown by the title) and an **On-chain proofs**
      entry "Funding proposal accepted" recording the proposal id, the submitter (DRep id or
      wallet address), and the fee facts (paid? which tx?). On Preprod the anchor tx is real.
- [ ] **Amount locked after submission**: edit a PENDING proposal — the **Requested ₳** field
      (and Commercial) are **disabled** (you can still fix the tx + other fields). This stops the
      "pay a small fee, then raise the budget" gaming.
- [ ] **Budget change (ACTIVE) → Actions**: open your ACTIVE proposal → **Request a budget
      change**. **Increase** → a **top-up** appears for a board member in *My Area → Actions*
      ("submitter owes X ₳") and bumps the **notification badge**; **decrease** → a **refund**
      ("return X ₳"). The settlement shows the **old → new fee** and the budget change; for a
      refund it shows the submitter's **payout address with a Copy button**. The board pastes
      the on-chain tx and clicks **Mark settled**.
- [ ] **Actions history toggle**: the board **Actions** tab defaults to only what needs doing
      (done items disappear). Tick **Show history** (top-right) → settled budget settlements
      (with their tx) and executed treasury actions also appear, read-only, so DReps can audit.
      Untick → back to just the to-dos. The notification badge always counts only pending items.
- [ ] **Payout / refund address**: the proposal form has a **Payout / refund address** field;
      it shows (read-only, with Copy) near the bottom of the proposal detail and is where the
      DAO sends refunds + the funded budget.

### Filtering → D&V → milestones (a fresh proposal)
- [ ] Board: draw filtering reviewers; assigned DReps vote (NO needs rationale);
      ≥3 YES → advances to D&V and **anchors on-chain** (check On-chain proofs).
- [ ] Submitter edits during filtering → a new version appears in the diff.
- [ ] Board opens D&V; eligible DReps vote (rationale ≥200 chars); board finalizes →
      APPROVED + **anchored**.
- [ ] Board draws milestone reviewers; submitter posts a Proof of Achievement;
      reviewers vote (2-of-3) → milestone APPROVED + **anchored**; all milestones
      approved → proposal **COMPLETE**.

### Rounds admin / treasury (board)
- [ ] **My area → Round stage controls**: confirm a next stage (auto/at-date or launch
      now); the final stage closes manually.
- [ ] **Treasury**: balances + budget buckets; **Actions to sign** (multisig top-ups)
      with signData approval.

### Eligibility (bug check)
- [ ] Only **DAO members** (board + admitted DReps) can be drawn/vote. A registered but
      **non-admitted** DRep cannot vote — they aren't in the round's eligibility and
      aren't drawn. Voters display by **name** in the vote lists.

### Round 2 review fixes (verify these specifically)
- [ ] **D&V power bar**: a proposal in Debate & Vote shows a YES/NO/abstain **bar scaled
      to total voting power** with a **threshold marker** (not just "YES 6 power").
- [ ] **Board opt-in (§8.2)**: board members do NOT auto-vote on funding proposals — the
      D&V panel shows an **"Opt in to vote"** button for board; after opting in they
      become eligible (and can vote in My area). Regular admitted DReps vote by default.
- [ ] **Per-round settings (round setup)**: creating a round shows a **Reward distribution**
      block with **three sliders** — DReps vs **Experts** (experts' cut subtracted first), then
      on the DReps' pool D&V vs Milestone review, and (within D&V) Fixed vs Bonus — plus a
      **live bar** that re-splits the reward pool four ways (experts / D&V fixed / D&V bonus /
      milestone) in ADA + % as you drag. E.g. 200K pool, experts 25% → 50K experts, then the
      remaining 150K splits as before. Below, **Round parameters** are grouped with an
      **explanation under each field**:
      review & approval ordered **Filtering → D&V → Milestone**, **submission fees**, **quick
      poll**, **milestone timing**, **proposer pledge**. Each box shows its default; blank ⇒
      default. The **approval** inputs cap to their reviewer count (and the API rejects
      approval > reviewer).
- [ ] **Create round is gated**: the **Create round** button is disabled until everything is
      filled — round **name**, every category's **name + description + allocation**, the **full
      budget** allocated, and **all four** schedule windows set & valid — with a "still needed"
      hint listing what's missing.
- [ ] **Schedule picker**: stage dates use a **month-name** picker (Month / Day / Year + time),
      not numeric `mm/dd`; the **time defaults to midnight (12:00 AM)**. Setting an end at/before
      its start (or a stage before the previous ends) shows an **immediate red warning**; a valid
      window shows its **duration** (e.g. "3 weeks"). The first category starts **blank** (no
      default "Ecosystem").
- [ ] **Round page shows the setup**: clicking a round shows a **Round setup** card (reward
      bar + resolved settings, each tagged `(default)` when not overridden) above its proposals.
- [ ] **Platform params save + apply**: in *Platform setup*, set a param's **New value**
      (e.g. a boolean to **Enabled**) and click **Save** — the **Saved** column updates to match
      (e.g. "Enabled", with a muted "(default Disabled)" hint) and Save greys out. Wired params
      take effect immediately (`MERIT_POINT_MAX` changes the overview ×Mult when a member has
      merit; the `ENTRY_REQUIRE_*` switches toggle the gate + overview flag). Params with a
      **⏳ not yet wired** note are stored but not yet read by any feature.
- [ ] **Platform setup is leaner**: *Platform setup* lists only genuinely global params
      (admission votes, internal thresholds, eligibility minimums, merit cap, anchor cron,
      explorer) — round/fee/quick-poll/milestone-timing/pledge/reward params live in the round setup.
- [ ] **DAO entry gate (§14.1)**: in *Platform setup* the gated params are **grouped under
      their switch** (`↳`, green accent) and **shadowed/disabled** while the switch is
      Disabled — toggling `ENTRY_REQUIRE_VOTING_POWER`/`ENTRY_REQUIRE_ACTIVITY` greys/ungreys
      their params live. Both default **Disabled**, so a registered DRep's **JOIN DAO** button
      is **active**. Flip a switch to **Enabled** → the button **disables** with a note (e.g.
      "Voting power — own 4,998 ₳ (need 1,000,000), or 0 delegators ≥ 50,000 ₳ (need 20)"),
      metrics read live from Koios; `/me/drep-application` also rejects an ineligible apply.
- [ ] **Delegator-path test (Heidi)**: `node tools/seed-heidi-delegators.cjs` created 2
      delegators that each vote-delegated ~1,100 tADA to Heidi (she now has **3 delegators,
      all ≥ 1,000 ₳**). Enable `ENTRY_REQUIRE_VOTING_POWER` and set `MIN_DELEGATORS=2`,
      `MIN_DELEGATOR_STAKE_ADA=1000` → as Heidi the **JOIN DAO** button becomes **active**
      (qualifies via the delegator path); with the defaults (20 / 50,000) it stays disabled.
- [ ] **Removal is anchored**: a board 3-of-5 removal vote that resolves now posts an
      on-chain proof — *On-chain proofs* shows **"Removal of a DAO member"** (like admission).
- [ ] **Below-minimum flag (§14.1)**: in *DAO Member overview*, a member who fails an
      **enabled** gate shows a **⚠ below minimum** badge (full voting member; informational).
      Both gates off (testnet default) ⇒ no flag. **Power gate** (`ENTRY_REQUIRE_VOTING_POWER`):
      non-board members under the own-power/delegator minimum flag; **board is exempt**.
      **Activity gate** (`ENTRY_REQUIRE_ACTIVITY`): **everyone incl. board** must have voted on
      ≥ `MINIMUM_DREP_ACTIVITY`% of the last `MINIMUM_VOTES_CASTED` governance actions — on
      Preprod nobody has vote history, so enabling it flags **all** members (board included).
- [ ] **Board enforces anchor submission**: on *On-chain proofs*, a board member sees
      **Submit on-chain** beside any "anchor pending" record and a **Submit all pending (N)**
      button; non-board members don't. **Submit all pending** chains the txs through one hot
      wallet (so a batch of 8 all land, not just the first) and rounds the fractional D&V
      voting power so those anchors no longer fail with "floats not allowed in metadata".
- [ ] **Filtering shows one proposal at a time**: in *My area → Voting & reviews*, opening
      **View full proposal** on a filtering assignment shows ONLY that proposal (its detail +
      its own rationale/vote box) — the other assignments are hidden until you go back.
- [ ] **Edit history**: the proposal detail shows a collapsed **"Edit history"** — expand it
      to compare any earlier version with the current one (diff or full side-by-side).
- [ ] **Comment roles**: each comment shows a role badge — **Board member / DAO member /
      Expert** — beside the name. **Expert** comments are highlighted (amber). The seeded
      demo has an expert comment (Ivan) and a board comment (frank) on Round Beta proposals.
- [ ] **On-chain JSON (D&V)**: open a D&V proof on the explorer — each vote shows the DRep's
      **voting power**, YES/NO are in **power**, threshold is a **%**, and **totalPower** is
      included.

### Round 3 review fixes (verify these specifically)
- [ ] **My area loads** with no console hydration error (the Grammarly/extension warning is
      suppressed).
- [ ] **Voting power matches**: a DRep's **adjusted power** in the members overview equals the
      power used in **new** Debate & Vote rounds (both = log₁₀(real on-chain voting power) ×
      merit). Note: the *existing* Round Alpha D&V was snapshotted earlier with the old flat
      value (historical, frozen) — the fix applies to **new** D&V rounds.
- [ ] **Non-board voters**: the members overview now lists **Heidi** and **Judy** (admitted,
      non-board) alongside the board. Regular admitted DReps are the default voter base; only
      board members who opt in vote on funding (and in practice only a few will).
- [ ] **Experts overview** shows each expert's **expertise areas** (chips) + **bio** (Ivan:
      infrastructure, libraries). The apply form has the expertise picker.
- [ ] **Explorer combobox**: in *Platform setup*, **CARDANO_EXPLORER** is now a dropdown
      (cardanoscan/cexplorer/adastat/custom). Change it (or your personal one in My area →
      Preferences), Save, then click an on-chain link — it opens in the chosen explorer
      **without a page refresh**.
- [ ] **Round name in JSON**: an on-chain proof's `applicant`/subject reference includes the
      **round name** (e.g. "… · Round Alpha (demo)"), not just "round #N".

### Round 4 review fixes (verify these specifically)
- [ ] **My Area tabs**: My area is split into tabs (Profile · Voting & reviews · My proposals
      · board: Actions to sign / Round control / Applications) — not one long page.
- [ ] **Leave the DAO**: Profile tab (non-board member) has a "Leave the DAO" button → a
      styled confirmation dialog. Board members don't see it (genesis-managed).
- [ ] **Voting rationale**: filtering / D&V show a **large Markdown rationale box** (no
      browser prompt) + a **"View full proposal"** link that expands the proposal inline.
- [ ] **Submitter (sign in as Carol / `holder`)**: My proposals → open one → edit it (during
      Filtering / pre-vote D&V) and submit milestone **Proof of Achievement**.
- [ ] **Projects**: Round Gamma shows a COMPLETE project, an ACTIVE project (partial
      milestones), and a REJECTED proposal.
- [ ] **Admin hot wallet** (sign in at `/admin`): the **Anchor hot wallet** panel shows the
      hot + treasury balances, **"1. Move everything to the multisig"** (sweep), then
      **"2. Exchange the seed"** (enabled only after the sweep). The board's Platform setup
      no longer shows wallets. Each admin action is in the audit log.

### Proposals list + detail (verify these specifically)
- [ ] **Round picker is a combo box** (not a wrapping row of buttons) and defaults to the
      **latest round in the Submission phase**. Picking a round updates `?round=`.
- [ ] **Submitter shown** next to each proposal's title — in the list and on the detail page.
- [ ] **All fields visible on the detail** (read-only for non-authors — try as Bob): title,
      submitter, public id, category/amount/fee, pitch, cost breakdown / team / revenue (when
      filled), expertise tags, and the **milestone plan** (title · budget · description ·
      acceptance). Only the author sees Edit / Request-a-budget-change / fee controls.
- [ ] **Labelled metadata + collapsible sections**: the header reads **Proposal ID: R5-P1 ·
      Stage: FILTERING · Status: ACTIVE** (labels, not bare chips). Each content section has a
      clickable header (▾/▸) to **shrink/expand** it — like the form fields — so a long proposal
      stays manageable.

### Proposal-form UX (verify these specifically)
- [ ] **Category appears after a round**: the **Category** combo is labelled and shows only
      once a **Round** is picked; if exactly one round is in Submission it's preselected.
- [ ] **Commercial label** reads **"Commercial / for profit"**.
- [ ] **What's missing is explicit**: with the form incomplete, an amber **"Still needed
      before you can submit or save"** checklist lists exactly what's missing, and **both
      Submit and Save Draft are disabled** until it clears.
- [ ] **Milestone budget check**: set requested = 150,000 ₳ but milestones summing to
      120,000 ₳ → a red line warns they must be equal (off by 30,000 ₳) and Submit stays
      disabled. Make them equal → it turns green and the button enables.
- [ ] **Formatting + sizing**: the pitch / cost breakdown / team / revenue / milestone fields
      have a toolbar (Heading / **B** / *I* / • List / 1. List / 🔗 Link), a **Preview** toggle
      that renders the markdown, a **Taller/Shorter** height toggle, and a **Shrink** button
      that collapses the field to **just its name** (with a "✓ filled / empty" hint) — click the
      name to expand again. The rendered formatting (headings, bold, bullets, links) shows on
      the proposal detail page.
- [ ] **Milestones have 4 parts**: each milestone block has **Title**, **Requested budget (₳)**
      directly under the title, **Description**, and **Acceptance criteria** (the last two are
      full markdown editors that can be enlarged/collapsed). Title + Description are required;
      acceptance criteria is optional. The proposal detail shows the milestone title + budget +
      description + acceptance criteria.

### Edit a round (board, verify these specifically)
- [ ] In **My area → Round control**, a round in **Preparation or Submission** has an **Edit
      round** button. It opens the round form pre-filled (name, budget, rewards, categories incl.
      min/max ask + conditions, reward sliders, settings); the schedule isn't editable here (use
      the stage confirm/launch controls). Change a field → **Save changes**.
- [ ] **Category edits are proposal-safe**: editing an existing category's fields keeps proposals
      attached; trying to remove a category that has proposals is rejected with a clear message.
      Rounds in Filtering/D&V/Funding aren't editable (no Edit button).

### URL navigation (verify these specifically)
- [ ] **Menu + submenu update the URL**: clicking left-nav items changes `?view=…`; My-area
      tabs change `?tab=…`; the Proposals/Rounds round submenu changes `?round=…`. The browser
      **back button** walks back through them.
- [ ] **Shareable proposal link**: open a proposal from the Proposals list — the URL gets
      `?proposal=<id>`. Copy it, open in a new tab (or send it) → it shows the **same proposal**
      page (after login if needed; public proposals are readable by anyone). **Back** returns to
      the list with the same round selected.

## 4. Known limitations / deferred (by design, for now)
- **Real ADA payouts** (milestone disbursement, treasury top-ups) are recorded +
  the multisig action collects 3-of-5 approvals, but the actual native-multisig
  payment tx is **not broadcast yet** (waits for the on-chain 3-of-5 to be set up).
- Filtering/D&V/milestone **votes are not individually CIP-30-signed** (only admission
  is); the *decision* is anchored and authenticity is via the session. Can add per-vote
  signatures later.
- Filtering edge cases (two-round feedback, auto-replacement of absent reviewers,
  quick-poll tie-breaks) are not yet implemented — single feedback round + manual draw.

## 5. Running the automated suite
`pnpm test:e2e` (= `node tools/test-all.cjs`) runs 8 service-level suites. **Note:** the
demo's *Round Gamma* occupies the single active reviewing slot — only one round may be
in Filtering **or** Debate & Vote at a time (§5.1) — which conflicts with the
filtering/D&V-stage suites. Run the suite on a clean DB, or remove the demo rounds
first. Re-seed with `node tools/seed-demo-rounds.cjs` (idempotent); after the full demo
seed (`seed-demo-rounds` → `seed-demo-projects` → `seed-demo-round3`) the round order is
normalized automatically (Beta #2 funding, Gamma #3 filtering).

## 6. Next on-chain run (after Monday review)
Generate **6 new DReps**, fund from Alice (~12,500 tADA available), register them
on-chain, board admits all 6 (each admission anchored), then they participate in a
fresh round (filtering + D&V + milestones, all anchored).
