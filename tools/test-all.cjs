/**
 * Runs the whole DRep DAO service-level test suite, in order, against the
 * isolated `drepdao_test` database (NOT the dev DB) + live Koios (Preprod).
 *
 * Each test file `require()`s `tools/_test-env.cjs` first, which redirects
 * DATABASE_URL to the test DB so the dev DB is never touched. This runner
 * additionally:
 *   1. Bootstraps `drepdao_test` (creates it + runs `prisma migrate deploy`).
 *   2. TRUNCATEs every table before the run for a deterministic starting state.
 *
 * Prereqs: infra up (pnpm infra:up) and the built dist (the dev server keeps
 * it fresh; otherwise run `pnpm build`).
 *
 *   node tools/test-all.cjs   (or: pnpm test:e2e)
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

if (!fs.existsSync(path.join(__dirname, '..', 'apps/api/dist/drep/drep.service.js'))) {
  console.error('apps/api/dist is missing — run `pnpm build` (or start `pnpm dev`) first.');
  process.exit(1);
}

const setup = spawnSync(process.execPath, [path.join(__dirname, 'setup-test-db.cjs'), '--reset'], { stdio: 'inherit' });
if (setup.status !== 0) {
  console.error('test-db setup failed.');
  process.exit(setup.status ?? 1);
}

// Order matters: genesis leaves the 5-board seated; the rest build on it.
const SUITES = [
  ['test-genesis', 'Genesis: JSON load, partial load, add/remove, incremental'],
  ['test-cast', 'Cast roles: board / voting DRep / ADA holder + genesis verify'],
  ['test-dao', 'DAO membership: board auto-member, join + 3-of-5 admission'],
  ['test-free-period', '§14 free period: no board ⇒ auto-admission (anchored); submitter apps queue for the board; board back ⇒ 3-of-5 flow again (self-cleaning)'],
  ['test-overview', 'DAO overview voting power + Expert apply/approve'],
  ['test-entry-gate', '§14.1 entry gate: config save, eligibility, below-min flag, MERIT cap (self-restoring)'],
  ['test-removal', 'Removal: propose + 3-of-5 vote → REMOVED, re-apply'],
  ['test-rounds', 'Rounds: stage transitions gate submission + governance params'],
  ['test-stage-flow', 'Stage flow: budget/schedule validation, confirm/launch/auto-start/close, proposal counts'],
  ['test-proposal-flow', 'Proposal lifecycle: fee, edit/version, filtering+D&V+milestone anchored, comments'],
  ['test-milestone-flow', '§11 milestone: board allocates reviewers (expertise+load), POA immutable, payout auto-prep, stop-funding (1p1v, 3-YES → FAILED + anchor)'],
  ['test-submission-phase', '§3/§5 SUBMISSION phase: pre-assign reviewers OK, vote blocked, no DRep pings; SUBMISSION→FILTERING auto-rejects unpaid/unsubmitted with clear reason'],
  ['test-pledge', '§3 proposer pledge: optional opt-in (≥ round threshold + return method required), tx hash submit, board APPROVE/REJECT, POA gated on confirmation'],
  ['test-category-ask', '§5.2 category min/max ask enforced on submit + §3.4 funding fields (self-cleaning)'],
  ['test-round-counts', '§9 round overview per-status counts incl. DRAFT/PENDING, update as status changes (self-cleaning)'],
  ['test-internal', '§10 internal proposals: submit/threshold/poll/extend/scope/private + on-chain anchor (self-cleaning)'],
  ['test-internal-election', '§14 board-member election: validation, voting → approval, install authorization, manual + auto install (self-cleaning, restores board)'],
  ['test-shared-math', 'Shared single-source math: money, §12 reward pools (588/252/560), reviewer ranking, §4.2 power'],
  ['test-audit-flows', 'Audit batch: §9.1 budget ranking, §9.2 quick polls, §11.5 extensions, §16.4 pledge grace, §2.1 submitter gating, §20.3 notifications, §6 auto-shift'],
  ['test-signing-mode', '§15/§20 TX_SIGNING_PROCESS: 1-phase default + gates, 2-phase fallback gates, governance validation'],
  ['test-merit-tx', '§13.2 treasury-action merit: TX_INITIATED/TX_SIGNED deltas, initiator tracking, idempotent award'],
  ['test-internal-transfer', '§15.5 internal transfers: board-only, distinct buckets, bucket-address destination, initiator stamp'],
  ['test-tally-rewards', '§9/§12/§16 round end-game: VOTE→TALLY tally (approve/budget-cut/reject), TALLY→FUNDING poll guard, D&V reward calc + payout freeze, pledge return shares (self-cleaning)'],
  ['test-multisig-migration', '§15.2 board hand-over: assembly + carry-over keys, key reminder, auto FUND MIGRATION per source, resolveSource, terminate + both on-chain proofs (self-cleaning)'],
  ['test-proposer-journey', 'Proposer journey: draft/fee/mandatory-words edges, filtering 2-of-3, debate versioning, tally, pledge cycle, POA rejections → AUTO stop-funding (MILESTONE_MAX_REJECTIONS) (self-cleaning)'],
  ['test-dreps-at-scale', '12 DReps: overview power math, 5-of-12 filtering jury, exact tie → quick poll → funded, merit (filter/DV/poll), reward split + payout links, comments, history (self-cleaning)'],
  ['test-board-operations', 'Board ops: REAL 3-of-5 signing ceremony (Ed25519 + CSL txs) for OPS/milestone/reward/transfer, all internal types, pledge return, TX_SIGNED merit, Transactions visibility, signature history (self-cleaning)'],
];

const failed = [];
for (const [file, desc] of SUITES) {
  console.log(`\n████ ${file} — ${desc} ████`);
  const r = spawnSync(process.execPath, [path.join(__dirname, `${file}.cjs`)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
}

console.log('\n==================== SUMMARY ====================');
for (const [file, desc] of SUITES) {
  console.log(`  ${failed.includes(file) ? '❌ FAIL' : '✅ PASS'}  ${file.padEnd(14)} ${desc}`);
}
console.log(failed.length ? `\n❌ ${failed.length} suite(s) failed.` : '\n✅ All suites passed.');
process.exit(failed.length ? 1 : 0);
