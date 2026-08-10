/**
 * §5/§6/§8 — round stage confirmation + launch + auto-start scheduler + close, plus
 * the P4 (categories must cover budget) and P7 (schedule order) validations and the
 * P9 per-status proposal counts. Cleans up its test round/proposal at the end.
 *
 *   node tools/test-stage-flow.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => {
  try { await fn(); ok(l, false, 'did not throw'); }
  catch (e) { ok(l, re.test(e.message), e.message); }
};
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const HOUR = 3_600_000;

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
  const users = new UsersService(prisma, new CardanoQueryService(config));
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma, config, new CardanoQueryService(config));
  const actor = await prisma.appUser.findFirst(); // any user id for confirmedBy

  console.log('\n=== P4/P7 — creation validations ===');
  await throws(
    'budget not fully allocated rejected',
    () => rounds.create({ name: 'bad', mandatoryWords: 0, budgetAda: 4_000_000, rewardsPoolAda: 0, categories: [{ name: 'A', allocatedAda: 1_000_000 }] }),
    /allocate the full budget/i,
  );
  await throws(
    'out-of-order schedule rejected',
    () =>
      rounds.create({
        name: 'bad', mandatoryWords: 0, budgetAda: 1_000_000, rewardsPoolAda: 0,
        categories: [{ name: 'A', allocatedAda: 1_000_000 }],
        schedule: [
          { stageKey: 'submission', startsAt: iso(0), endsAt: iso(2 * HOUR) },
          { stageKey: 'filtering', startsAt: iso(HOUR), endsAt: iso(3 * HOUR) }, // starts before submission ends
        ],
      }),
    /must start after the submission stage ends/i,
  );

  console.log('\n=== Create a well-formed round (categories cover budget) ===');
  const round = await rounds.create({
    name: 'Stage-flow round',
    mandatoryWords: 0, budgetAda: 4_000_000,
    rewardsPoolAda: 200_000,
    categories: [
      { name: 'Ecosystem', type: 'GRANT', allocatedAda: 3_000_000, description: 'core' },
      { name: 'RFP track', type: 'RFP', allocatedAda: 1_000_000 },
    ],
    schedule: [{ stageKey: 'submission', startsAt: iso(-HOUR), endsAt: iso(HOUR) }],
  });
  ok('round created in PREPARATION', round.status === 'PREPARATION');
  ok('RFP category type stored', round.categories.some((c) => c.type === 'RFP'));
  ok('nextStage is SUBMISSION', round.nextStage && round.nextStage.status === 'SUBMISSION');
  ok('list shows active=false in PREPARATION', (await rounds.list()).find((r) => r.id === round.id).active === false);

  console.log('\n=== §8 confirm + launch SUBMISSION (delay shift) ===');
  await throws(
    'confirming a non-next stage rejected',
    () => rounds.confirmStage(round.id, 'filtering', { autoStart: false }, actor.id),
    /not the next stage/i,
  );
  await rounds.confirmStage(round.id, 'submission', { autoStart: false, startsAt: iso(-HOUR), endsAt: iso(HOUR) }, actor.id);
  let detail = await rounds.get(round.id);
  ok('submission confirmed', detail.nextStage.confirmed === true);

  await rounds.launchNextStage(round.id, actor.id);
  detail = await rounds.get(round.id);
  ok('launched → SUBMISSION', detail.status === 'SUBMISSION');
  const subRow = detail.schedule.find((s) => s.stageKey === 'submission');
  ok('delayed start shifted to ~now', subRow && Math.abs(new Date(subRow.startsAt).getTime() - Date.now()) < 60_000);
  ok('prolongedFrom recorded (was overdue)', subRow && subRow.prolongedFrom != null);
  ok('list shows active=true in SUBMISSION', (await rounds.list()).find((r) => r.id === round.id).active === true);
  ok('activeRound() returns this round', (await rounds.activeRound())?.id === round.id);

  console.log('\n=== P9 — per-status proposal counts ===');
  const bob = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.board.stakeAddress),
    stakeAddress: personas.board.stakeAddress,
    drepKeyHash: personas.board.drepKeyHash,
  });
  const created = await proposals.createDraft(bob.id, {
    roundId: round.id, categoryId: round.categories[0].id, title: 'Counted proposal',
    payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'Pitch.', isCommercial: false, requestedAmountAda: 1000,
    milestones: [{ title: 'Milestone 1', description: 'Deliver', amountAda: 1000 }],
  });
  await proposals.submit(bob.id, created.id, { submissionFeeTxHash: 'devhash' });
  await proposals.reviewFee(created.id, { decision: 'APPROVE' }); // → ACTIVE
  const listed = (await rounds.list()).find((r) => r.id === round.id);
  ok('ACTIVE counted in the rounds list', listed.proposalCounts.ACTIVE === 1, JSON.stringify(listed.proposalCounts));

  console.log('\n=== §8 auto-start scheduler (filtering) ===');
  const otherFiltering = await prisma.round.findFirst({ where: { status: 'FILTERING', id: { not: round.id } } });
  if (otherFiltering) {
    ok('skip auto-advance test (another round holds FILTERING §5.1)', true, `round #${otherFiltering.number}`);
  } else {
    // Confirm filtering as auto-start with a valid future window (after submission ends).
    const subEnd = new Date(subRow ? new Date(subRow.startsAt).getTime() + 2 * HOUR : Date.now() + 2 * HOUR);
    await rounds.confirmStage(round.id, 'filtering', { autoStart: true, startsAt: subEnd.toISOString(), endsAt: iso(4 * HOUR) }, actor.id);
    ok('not advanced while future-dated', (await rounds.advanceDueStages()).length === 0 || (await rounds.get(round.id)).status === 'SUBMISSION');
    // Make it due, then the scheduler should advance it.
    await prisma.roundSchedule.update({ where: { roundId_stageKey: { roundId: round.id, stageKey: 'filtering' } }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const advanced = await rounds.advanceDueStages();
    ok('scheduler advanced due stage → FILTERING', advanced.includes(round.id) && (await rounds.get(round.id)).status === 'FILTERING');
  }

  console.log('\n=== §8 close (manual confirmation of the final stage) ===');
  // Drive to FUNDING then close (skip if not in FILTERING due to §5.1 above).
  let cur = (await rounds.get(round.id)).status;
  if (cur === 'FILTERING') { await rounds.launchNextStage(round.id, actor.id); cur = 'DV'; }
  if (cur === 'DV') { await rounds.launchNextStage(round.id, actor.id); cur = 'FUNDING'; }
  if ((await rounds.get(round.id)).status === 'FUNDING') {
    await throws('launch-next at FUNDING points to close', () => rounds.launchNextStage(round.id, actor.id), /closeRound|funding stage end/i);
    const closed = await rounds.closeRound(round.id, actor.id);
    ok('round closed', closed.status === 'CLOSED' && closed.endedAt != null);
    ok('closed round nextStage is null', closed.nextStage === null);
  } else {
    // The round never reached FILTERING because another round holds the single Filtering/D&V
    // slot (§5.1) — same environmental skip as the auto-advance test above.
    ok('skip close test (another round holds the Filtering/D&V slot §5.1)', true, `status=${(await rounds.get(round.id)).status}`);
  }

  console.log('\n=== Cleanup ===');
  await prisma.milestone.deleteMany({ where: { proposalId: created.id } });
  await prisma.proposal.deleteMany({ where: { roundId: round.id } });
  await prisma.roundDrepEligibility.deleteMany({ where: { roundId: round.id } });
  await prisma.roundSchedule.deleteMany({ where: { roundId: round.id } });
  await prisma.roundCategory.deleteMany({ where: { roundId: round.id } });
  await prisma.round.delete({ where: { id: round.id } });
  ok('test round removed', (await prisma.round.findUnique({ where: { id: round.id } })) === null);

  await prisma.$disconnect();
  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : `❌ ${fail} FAILED`}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
