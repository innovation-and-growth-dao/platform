/**
 * §5.2 — a category's min/max funding-request bounds are enforced when a proposal is
 * created: a request below the min or above the max is rejected; an in-range request
 * is accepted, and the proposal detail exposes the category's ask range. Also checks
 * the §3.4 funding fields (team info, cost breakdown, revenue sharing) round-trip.
 *
 * Creates a throwaway round + proposals and deletes them at the end.
 *
 *   node tools/test-category-ask.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
// Never submit a real tx from the test — record the anchor only.
delete process.env.ANCHOR_MNEMONIC;
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const throws = async (l, fn, re) => { try { await fn(); ok(l, false, 'did not throw'); } catch (e) { ok(l, re.test(e.message), e.message); } };

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
  const anchor = new AnchorService(config, prisma, cardano);
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma, config, cardano, anchor);
  const u = await db.appUser.findFirst({ select: { id: true } });
  if (!u) { console.error('need at least one app_user'); process.exit(1); }

  // A round with a category bounded to a 10,000–100,000 ₳ ask per proposal.
  const r = await rounds.create({
    ignoreBudgetChange: 0, requireFeeTopUp: 1, requireFeeReturn: 1,
    name: '__category_ask_test__', mandatoryWords: 0, budgetAda: 500000, rewardsPoolAda: 1000,
    categories: [{ name: 'Bounded', type: 'GRANT', allocatedAda: 500000, minAda: 10000, maxAda: 100000, conditions: 'OSS only' }],
  });
  const catId = r.categories[0].id;
  const roundIds = [r.id];
  await db.round.update({ where: { id: r.id }, data: { status: 'SUBMISSION' } });
  const mk = (amt, extra = {}) => ({ roundId: r.id, categoryId: catId, title: 'Ask range test', payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'c', isCommercial: false, requestedAmountAda: amt, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: amt }], ...extra });

  try {
    await throws('request below min (5,000) rejected', () => proposals.createDraft(u.id, mk(5000)), /below.*minimum/);
    await throws('request above max (200,000) rejected', () => proposals.createDraft(u.id, mk(200000)), /exceeds.*maximum/);
    const good = await proposals.createDraft(u.id, mk(50000, {
      teamInfoMd: 'Core team', costBreakdownMd: 'Dev 40k', revenueSharingMd: '5% to DAO', payoutAddress: 'addr_test1_PAYOUT',
      // §3 milestone parts: title + description + acceptance criteria + budget.
      milestones: [{ title: 'MVP', description: 'Build the MVP', acceptanceCriteria: 'Demo on Preprod', amountAda: 50000 }],
    }));
    ok('in-range request (50,000) accepted', good.requestedAmountAda === 50000, String(good.requestedAmountAda));
    ok('payout address round-trips', good.payoutAddress === 'addr_test1_PAYOUT', String(good.payoutAddress));
    ok('detail exposes category ask range + conditions', good.categoryAsk?.minAda === 10000 && good.categoryAsk?.maxAda === 100000 && good.categoryAsk?.conditions === 'OSS only');
    ok('detail exposes §3.4 fields', good.teamInfoMd === 'Core team' && good.costBreakdownMd === 'Dev 40k' && good.revenueSharingMd === '5% to DAO');
    const m0 = good.milestones?.[0];
    ok('milestone keeps title + acceptance criteria + budget', m0?.title === 'MVP' && m0?.acceptanceCriteria === 'Demo on Preprod' && m0?.description === 'Build the MVP' && m0?.amountAda === 50000, JSON.stringify(m0));
    // Editing a draft: the frontend PATCH carries categoryId (allowed) but NOT roundId
    // (immutable). updateDraft must accept that shape and persist the change.
    const edited = await proposals.updateDraft(u.id, good.id, {
      categoryId: catId, title: 'Ask range test', payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'changed pitch', isCommercial: false, requestedAmountAda: 50000,
      submissionFeeTxHash: 'tx12345',
      milestones: [{ title: 'MVP', description: 'Build the MVP', acceptanceCriteria: 'Demo on Preprod', amountAda: 50000 }],
    });
    ok('editing a draft (categoryId, no roundId) persists', edited.contentMd === 'changed pitch', edited.contentMd);
    ok('fee tx hash persists on a saved draft', edited.submissionFeeTxHash === 'tx12345', String(edited.submissionFeeTxHash));
    const reread = await proposals.get(good.id, u.id);
    ok('fee tx hash survives reload', reread.submissionFeeTxHash === 'tx12345', String(reread.submissionFeeTxHash));
    // Changing the tx keeps every hash entered so the board reviewer sees the full history.
    const edited2 = await proposals.updateDraft(u.id, good.id, { submissionFeeTxHash: 'tx67890' });
    ok('changing the tx keeps a history', JSON.stringify(edited2.submissionFeeTxHashes) === JSON.stringify(['tx12345', 'tx67890']), JSON.stringify(edited2.submissionFeeTxHashes));
    // A submitted (PENDING) proposal stays editable while it awaits the board's fee confirmation.
    const submitted = await proposals.submit(u.id, good.id, { submissionFeeTxHash: 'tx67890' });
    ok('submit moves DRAFT → PENDING (fee > 0)', submitted.status === 'PENDING', submitted.status);
    // PENDING: content/fields editable, but the requested amount is LOCKED (anti-gaming) —
    // you can't quote+pay a small fee then raise the budget for free.
    const pendingEdit = await proposals.updateDraft(u.id, good.id, { payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'edited while pending' });
    ok('PENDING content is editable', pendingEdit.status === 'PENDING' && pendingEdit.contentMd === 'edited while pending' && pendingEdit.requestedAmountAda === 50000, `${pendingEdit.status}/${pendingEdit.requestedAmountAda}`);
    await throws('requested amount is LOCKED while PENDING', () => proposals.updateDraft(u.id, good.id, { requestedAmountAda: 60000, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 60000 }] }), /locked after submission/);
    // Board fee review: reject needs a reason, then sets REJECTED + the feedback the submitter sees.
    await throws('reject needs a reason', () => proposals.reviewFee(good.id, { decision: 'REJECT' }), /reason is required/);
    const reviewed = await proposals.reviewFee(good.id, { decision: 'REJECT', feedback: 'fee underpaid' });
    ok('reject → REJECTED + feedback', reviewed.status === 'REJECTED' && reviewed.feeReviewFeedback === 'fee underpaid', `${reviewed.status}/${reviewed.feeReviewFeedback}`);
    // A fee-rejected proposal can be fixed (new tx, kept in history) and re-submitted → PENDING, feedback cleared.
    const fixedTx = await proposals.updateDraft(u.id, good.id, { submissionFeeTxHash: 'txFIXED' });
    ok('fee-rejected proposal is editable (tx history grows)', fixedTx.submissionFeeTxHashes.includes('txFIXED'), JSON.stringify(fixedTx.submissionFeeTxHashes));
    const resubmitted = await proposals.submit(u.id, good.id, { submissionFeeTxHash: 'txFIXED' });
    ok('re-submit a fee-rejected proposal → PENDING, feedback cleared', resubmitted.status === 'PENDING' && resubmitted.feeReviewFeedback === null, `${resubmitted.status}/${resubmitted.feeReviewFeedback}`);
    // Approve the fee → ACTIVE + a structured public id + an on-chain acceptance anchor (fee paid + tx).
    const approved = await proposals.reviewFee(good.id, { decision: 'APPROVE', feedback: 'looks good' });
    ok('approve → ACTIVE + structured publicId', approved.status === 'ACTIVE' && /^R\d+-P\d+$/.test(approved.publicId || ''), `${approved.status}/${approved.publicId}`);
    const feeAnchor = await db.anchor.findFirst({ where: { proposalId: good.id, kind: 'submission' }, orderBy: { createdAt: 'desc' } });
    ok('acceptance anchored with proposalId+submitter+fee tx', !!feeAnchor && feeAnchor.preimage?.proposalId === approved.publicId && feeAnchor.preimage?.fee?.txHash === 'txFIXED' && !!feeAnchor.preimage?.submitter, JSON.stringify(feeAnchor?.preimage));

    // EditSection (ACTIVE/Filtering): all descriptive fields stay editable + persist; amount stays locked.
    const reviewEdit = await proposals.updateDraft(u.id, good.id, { teamInfoMd: 'Updated team', revenueSharingMd: '10% to DAO', costBreakdownMd: 'Dev + ops', subcategoryIds: ['governance'] });
    ok('ACTIVE edit persists §3.4 + expertise', reviewEdit.teamInfoMd === 'Updated team' && reviewEdit.revenueSharingMd === '10% to DAO' && reviewEdit.costBreakdownMd === 'Dev + ops' && JSON.stringify(reviewEdit.subcategoryIds) === JSON.stringify(['governance']), JSON.stringify({ t: reviewEdit.teamInfoMd, r: reviewEdit.revenueSharingMd, s: reviewEdit.subcategoryIds }));
    await throws('amount still locked while ACTIVE', () => proposals.updateDraft(u.id, good.id, { requestedAmountAda: 70000 }), /locked after submission/);

    // §12 budget change on an ACTIVE proposal (OSS 1%, current fee 500 for 50,000 ₳).
    const incReq = await proposals.requestBudgetChange(u.id, good.id, { requestedAmountAda: 80000, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 80000 }] });
    ok('budget increase creates a PENDING board request (§12)', incReq.status === 'PENDING', incReq.status);
    await proposals.approveBudgetChange(u.id, incReq.id);
    const increased = await proposals.get(good.id, u.id);
    ok('approved budget increase applies + stays ACTIVE', increased.status === 'ACTIVE' && increased.requestedAmountAda === 80000, `${increased.status}/${increased.requestedAmountAda}`);
    let pays = await proposals.listPayments();
    const topup = pays.find((x) => x.proposalId === good.id && x.kind === 'TOPUP');
    ok('increase → TOPUP owed = fee delta (800−500)', !!topup && topup.amountAda === 300, JSON.stringify(topup));
    ok('settlement carries old→new fee + payout address', !!topup && topup.prevFeeAda === 500 && topup.newFeeAda === 800 && topup.payoutAddress === 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', JSON.stringify({ prev: topup?.prevFeeAda, next: topup?.newFeeAda, addr: topup?.payoutAddress }));
    await proposals.submitterTopUp(u.id, good.id, 'txTOPUP');
    await proposals.settlePayment(u.id, topup.id, 'txTOPUP');
    pays = await proposals.listPayments();
    ok('settled top-up leaves the pending list', !pays.find((x) => x.id === topup.id));
    const decReq = await proposals.requestBudgetChange(u.id, good.id, { requestedAmountAda: 30000, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 30000 }] });
    await proposals.approveBudgetChange(u.id, decReq.id);
    const decreased = await proposals.get(good.id, u.id);
    ok('approved budget decrease applies', decreased.requestedAmountAda === 30000, String(decreased.requestedAmountAda));
    const refund = (await proposals.listPayments()).find((x) => x.proposalId === good.id && x.kind === 'REFUND');
    ok('decrease → REFUND owed = fee delta (800−300)', !!refund && refund.amountAda === 500, JSON.stringify(refund));

    // §12 zero-fee: a round whose OSS fee is 0% admits an open-source proposal immediately (no tx).
    const freeRound = await rounds.create({
      name: '__category_ask_free__', mandatoryWords: 0, budgetAda: 100000, rewardsPoolAda: 1000, feeOssPct: 0,
      categories: [{ name: 'Free', type: 'GRANT', allocatedAda: 100000 }],
    });
    roundIds.push(freeRound.id);
    await db.round.update({ where: { id: freeRound.id }, data: { status: 'SUBMISSION' } });
    const freeDraft = await proposals.createDraft(u.id, { roundId: freeRound.id, categoryId: freeRound.categories[0].id, title: 'free', payoutAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3', contentMd: 'c', isCommercial: false, requestedAmountAda: 1000, milestones: [{ title: 'Milestone 1', description: 'm', amountAda: 1000 }] });
    const freeSubmitted = await proposals.submit(u.id, freeDraft.id, {});
    ok('zero-fee OSS proposal goes ACTIVE on submit (no tx)', freeSubmitted.status === 'ACTIVE' && freeSubmitted.stage === 'FILTERING', `${freeSubmitted.status}/${freeSubmitted.stage}`);
    ok('zero-fee proposal gets a structured publicId', /^R\d+-P\d+$/.test(freeSubmitted.publicId || ''), freeSubmitted.publicId);
    const freeAnchor = await db.anchor.findFirst({ where: { proposalId: freeDraft.id, kind: 'submission' } });
    ok('zero-fee acceptance anchored (no fee required)', !!freeAnchor && (freeAnchor.preimage?.fee?.ada ?? 0) === 0 && !freeAnchor.preimage?.fee?.txHash, JSON.stringify(freeAnchor?.preimage?.fee));
  } finally {
    for (const rid of roundIds) {
      const props = await db.proposal.findMany({ where: { roundId: rid }, select: { id: true } });
      await db.feeAdjustment.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
      await db.budgetChangeRequest.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
      await db.proposalVersion.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
      await db.anchor.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
      await db.milestone.deleteMany({ where: { proposalId: { in: props.map((p) => p.id) } } });
      await db.proposal.deleteMany({ where: { roundId: rid } });
      await db.roundCategory.deleteMany({ where: { roundId: rid } });
      await db.roundDrepEligibility.deleteMany({ where: { roundId: rid } });
      await db.roundSchedule.deleteMany({ where: { roundId: rid } });
      await db.round.delete({ where: { id: rid } });
    }
  }

  await prisma.$disconnect();
  await db.$disconnect();
  console.log(fail ? `\n❌ ${fail} check(s) failed.` : '\n✅ All category-ask checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
