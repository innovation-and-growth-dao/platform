/**
 * Seed a richer set of example proposals in varied end states (Round Gamma demo),
 * so the platform shows: an approved+COMPLETE project (all milestones approved), an
 * approved+ACTIVE project (some milestones approved), and a REJECTED proposal
 * (filtering). Drives the real service flow; anchoring is OFF (recorded, not
 * submitted) so it's fast. Idempotent (skips if "Round Gamma (demo)" exists).
 *
 *   node tools/seed-demo-projects.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // record anchors, don't submit (fast)

const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { FilteringService } = require(root + '/apps/api/dist/proposals/filtering.service.js');
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { MilestonesService } = require(root + '/apps/api/dist/milestones/milestones.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');
const cfg = { get: (k) => process.env[k] };
const log = (...a) => console.log(...a);

(async () => {
  const prisma = new PrismaService(cfg);
  const cardano = new CardanoQueryService(cfg);
  const users = new UsersService(prisma, cardano);
  const anchor = new AnchorService(cfg, prisma, cardano);
  const rounds = new RoundsService(prisma, cfg);
  const proposals = new ProposalsService(prisma, cfg, cardano);
  const filtering = new FilteringService(prisma, anchor);
  const dv = new DvService(prisma, cfg, anchor, cardano);
  const milestones = new MilestonesService(prisma, anchor);

  if (await prisma.round.findFirst({ where: { name: 'Round Gamma (demo)' } })) {
    log('Round Gamma (demo) already exists — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  const board = await prisma.drep.findMany({
    where: { user: { drepKeyHash: { in: (await prisma.boardSeat.findMany()).map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });
  const uid = (drepId) => board.find((d) => d.id === drepId)?.user.id;
  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });
  const longRat = 'After reviewing the scope, team, and budget I am confident this delivers clear value to the ecosystem; the milestones are realistic and independently verifiable. '.padEnd(230, '.');

  // Eligibility scoped to the board (deterministic), board opt-in for D&V.
  const gamma = await rounds.create({
    name: 'Round Gamma (demo)', budgetAda: 5_000_000, rewardsPoolAda: 250_000,
    categories: [{ name: 'Ecosystem', type: 'GRANT', allocatedAda: 5_000_000, description: 'Ecosystem grants' }],
    eligibleDrepIds: board.map((d) => d.id),
  });
  await rounds.startStage(gamma.id, 'SUBMISSION');
  const cat = gamma.categories[0].id;

  const submit = async (title, contentMd, ms) => {
    const d = await proposals.createDraft(carol.id, { roundId: gamma.id, categoryId: cat, title, contentMd, isCommercial: false, requestedAmountAda: ms.reduce((s, m) => s + m.amountAda, 0), milestones: ms });
    await proposals.submit(carol.id, d.id, { submissionFeeTxHash: `demo-fee-${d.id.slice(0, 6)}` });
    await proposals.reviewFee(d.id, { decision: 'APPROVE' });
    return d.id;
  };
  const filterDecide = async (id, choice) => {
    await filtering.drawReviewers(id);
    const a = await prisma.filterAssignment.findMany({ where: { proposalId: id, releasedAt: null } });
    let c = 0;
    for (const x of a) { const u = uid(x.drepId); if (u) { await filtering.vote(u, id, choice, choice === 'NO' ? 'Out of scope / weak plan.' : 'Solid.'); if (++c >= 3) break; } }
  };
  const dvApprove = async (id) => {
    for (const d of board) await dv.optIn(d.user.id, id);
    await dv.openVoting(id);
    for (const d of board) await dv.vote(d.user.id, id, 'YES', longRat);
    await dv.finalize(id);
  };
  const approveMilestone = async (id, mIdx) => {
    const ms = await milestones.forProposal(id);
    const m = ms.find((x) => x.idx === mIdx);
    await milestones.submitPoa(carol.id, m.id, `Delivered milestone ${mIdx + 1} — repo, demo, and docs linked.`);
    const a = await prisma.milestoneAssignment.findMany({ where: { milestoneId: m.id, releasedAt: null } });
    let c = 0;
    for (const x of a) { const u = uid(x.reviewerDrepId); if (u) { await milestones.vote(u, m.id, 'YES', 'Verified.'); if (++c >= 2) break; } }
  };

  log('\n=== A) COMPLETE project (all milestones approved) ===');
  const a = await submit('Cardano DEX aggregator v2', 'Best-price routing across all major Cardano DEXes, open-source.', [
    { description: 'Routing engine + tests', amountAda: 1000 },
    { description: 'UI + wallet integration', amountAda: 800 },
    { description: 'Audit + mainnet launch', amountAda: 1200 },
  ]);
  await filterDecide(a, 'YES');
  await dvApprove(a);
  await milestones.drawReviewers(a);
  for (const idx of [0, 1, 2]) await approveMilestone(a, idx); // all → COMPLETE
  log('  Cardano DEX aggregator v2 →', (await proposals.get(a)).status);

  log('\n=== B) ACTIVE project (1 of 3 milestones approved) ===');
  const b = await submit('Open mobile wallet', 'A privacy-respecting open-source mobile wallet for Cardano.', [
    { description: 'iOS + Android MVP', amountAda: 1500 },
    { description: 'Hardware-wallet support', amountAda: 1000 },
    { description: 'Audit + store release', amountAda: 1500 },
  ]);
  await filterDecide(b, 'YES');
  await dvApprove(b);
  await milestones.drawReviewers(b);
  await approveMilestone(b, 0); // only the first → still APPROVED/FUNDING (active)
  // leave a POA on milestone 2 awaiting review, milestone 3 not started
  const bms = await milestones.forProposal(b);
  await milestones.submitPoa(carol.id, bms.find((x) => x.idx === 1).id, 'Hardware-wallet support delivered — awaiting review.');
  log('  Open mobile wallet →', (await proposals.get(b)).status, '(milestone 1 approved, 2 in review, 3 not started)');

  log('\n=== C) REJECTED at filtering ===');
  const c = await submit('Token airdrop blaster', 'Mass-airdrop tool (spammy).', [{ description: 'Build the blaster', amountAda: 2000 }]);
  await filterDecide(c, 'NO');
  log('  Token airdrop blaster →', (await proposals.get(c)).status);

  // This round has an in-flight funded project, so leave it in FUNDING. Set the status
  // directly to avoid the §5.1 single-active-reviewing-stage conflict with the filtering round.
  await prisma.round.update({ where: { id: gamma.id }, data: { status: 'FUNDING' } });

  await prisma.$disconnect();
  log('\n✅ Seeded a funded round (demo): 1 COMPLETE, 1 ACTIVE, 1 REJECTED.');

  // §5.1 — a later round must never be ahead of an earlier one. Normalize identity so
  // the FUNDING round is the earlier #2 (Beta) and the live FILTERING round the newest
  // #3 (Gamma). Idempotent; runs in its own process (own Prisma connection).
  const { spawnSync } = require('node:child_process');
  spawnSync(process.execPath, [path.join(__dirname, 'fix-round-order.cjs')], { stdio: 'inherit' });
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
