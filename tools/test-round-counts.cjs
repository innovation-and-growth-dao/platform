/**
 * §9 — a round's per-status proposal counts in the overview reflect every status, including
 * DRAFT and PENDING, and update as a proposal's status changes (DRAFT → PENDING → ACTIVE, and
 * a separate one → REJECTED). Checks both the round detail (get) and the rounds list (list).
 *
 * Creates a throwaway round + proposals and deletes them at the end.
 *
 *   node tools/test-round-counts.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // never submit a real tx from the test
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(async () => {

  // §2.1 — proposal creation now requires an APPROVED submitter role; grant it to every test user.
  const { prisma: __sdb } = require(root + '/packages/db/dist/index.js');
  const __approveSubmitter = async (userId) => __sdb.submitterApplication.upsert({
    where: { userId },
    update: { status: 'APPROVED' },
    create: { userId, status: 'APPROVED', displayName: 'Test Submitter', description: 'test', socialLinks: [], country: 'Testland' },
  });
  for (const au of await __sdb.appUser.findMany({ select: { id: true } })) await __approveSubmitter(au.id);
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma, config, cardano);
  const u = await db.appUser.findFirst({ select: { id: true } });
  if (!u) { console.error('need at least one app_user'); process.exit(1); }

  const r = await rounds.create({
    name: '__round_counts_test__', mandatoryWords: 0, budgetAda: 100000, rewardsPoolAda: 1000,
    categories: [{ name: 'C', type: 'GRANT', allocatedAda: 100000, description: 'd' }],
  });
  await db.round.update({ where: { id: r.id }, data: { status: 'SUBMISSION' } });
  const catId = r.categories[0].id;
  const mk = (amt) => ({ roundId: r.id, categoryId: catId, title: 'Count test proposal', payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'c', isCommercial: false, requestedAmountAda: amt, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: amt }] });

  // The round overview reads counts from get(); the rounds list reads them from list().
  const getCounts = async () => (await rounds.get(r.id)).proposalCounts ?? {};
  const listCounts = async () => (await rounds.list()).find((x) => x.id === r.id)?.proposalCounts ?? {};

  try {
    ok('empty round → no counts', Object.keys(await getCounts()).length === 0);

    // DRAFT — visible in both the detail and the rounds list (count only).
    const draft = await proposals.createDraft(u.id, mk(50000));
    ok('DRAFT shows in round detail', (await getCounts()).DRAFT === 1, JSON.stringify(await getCounts()));
    ok('DRAFT shows in rounds list', (await listCounts()).DRAFT === 1, JSON.stringify(await listCounts()));

    // Submit → PENDING (fee 1% of 50,000 = 500 > 0): DRAFT count drops, PENDING appears.
    await proposals.submit(u.id, draft.id, { submissionFeeTxHash: 'tx-pending' });
    let c = await getCounts();
    ok('after submit → PENDING:1, DRAFT:0', c.PENDING === 1 && !c.DRAFT, JSON.stringify(c));
    ok('PENDING shows in rounds list too', (await listCounts()).PENDING === 1, JSON.stringify(await listCounts()));

    // Board approves the fee → ACTIVE: PENDING drops, ACTIVE appears.
    await proposals.reviewFee(draft.id, { decision: 'APPROVE' });
    c = await getCounts();
    ok('after approve → ACTIVE:1, PENDING:0', c.ACTIVE === 1 && !c.PENDING, JSON.stringify(c));

    // A second proposal the board rejects at the fee → REJECTED appears alongside ACTIVE.
    const draft2 = await proposals.createDraft(u.id, mk(50000));
    await proposals.submit(u.id, draft2.id, { submissionFeeTxHash: 'tx-reject' });
    await proposals.reviewFee(draft2.id, { decision: 'REJECT', feedback: 'no' });
    c = await getCounts();
    ok('after reject → REJECTED:1 (with ACTIVE:1)', c.REJECTED === 1 && c.ACTIVE === 1, JSON.stringify(c));
  } finally {
    const props = await db.proposal.findMany({ where: { roundId: r.id }, select: { id: true } });
    const ids = props.map((p) => p.id);
    await db.milestone.deleteMany({ where: { proposalId: { in: ids } } });
    await db.proposalVersion.deleteMany({ where: { proposalId: { in: ids } } });
    await db.feeAdjustment.deleteMany({ where: { proposalId: { in: ids } } });
    await db.anchor.deleteMany({ where: { proposalId: { in: ids } } });
    await db.proposal.deleteMany({ where: { roundId: r.id } });
    await db.roundCategory.deleteMany({ where: { roundId: r.id } });
    await db.roundDrepEligibility.deleteMany({ where: { roundId: r.id } });
    await db.roundSchedule.deleteMany({ where: { roundId: r.id } });
    await db.round.delete({ where: { id: r.id } });
  }

  await prisma.$disconnect();
  await db.$disconnect();
  console.log(fail ? `\n❌ ${fail} check(s) failed.` : '\n✅ All round-count checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
