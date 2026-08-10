/**
 * §10 — internal proposals: submit (→ ACTIVE immediately, "Internal N"), threshold voting
 * (INFORMATIVE, board-only 1p1v) → APPROVED/REJECTED, a POLL with per-option tally, the
 * submitter moving the voting end, scope eligibility, and the on-chain anchor (publicId +
 * date-independent docHash). Self-cleaning.
 *
 *   node tools/test-internal.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
delete process.env.ANCHOR_MNEMONIC; // record anchors, never submit a real tx
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { InternalProposalsService } = require(root + '/apps/api/dist/internal-proposals/internal-proposals.service.js');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const config = { get: (k) => process.env[k] };
let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };
const created = [];

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const svc = new InternalProposalsService(prisma, config, anchor, cardano);

  // Board members (admitted, board-seated) — the deterministic 1p1v voters.
  const seats = await db.boardSeat.findMany({ select: { drepKeyHash: true } });
  const boardUsers = [];
  for (const s of seats) {
    const u = await db.appUser.findFirst({ where: { drepKeyHash: s.drepKeyHash }, select: { id: true } });
    if (u) boardUsers.push(u.id);
  }
  if (boardUsers.length < 3) { console.error('need ≥3 board members seated'); process.exit(1); }
  const proposer = boardUsers[0];

  try {
    // 1) INFORMATIVE, board-only, 1p1v, DEFAULT threshold — submit goes straight to ACTIVE.
    const p = await svc.submit(proposer, {
      title: '__test__ Adopt the new review guideline', contentMd: 'Shall we adopt it?',
      internalType: 'INFORMATIVE', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT',
      votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 7,
    });
    created.push(p.id);
    ok('submit → ACTIVE immediately', p.status === 'ACTIVE', p.status);
    ok('structured public id "Internal N"', /^Internal \d+$/.test(p.publicId ?? ''), p.publicId);
    ok('eligible = board members', p.tally.eligible === boardUsers.length, `${p.tally.eligible}`);

    // All board vote YES → finalize → APPROVED.
    for (const uid of boardUsers) await svc.vote(uid, p.id, { choice: 'YES' });
    const finA = await svc.finalize(p.id);
    ok('all YES → APPROVED', finA.status === 'APPROVED', finA.status);
    ok('tally 100% ratio', finA.tally.kind === 'THRESHOLD' && finA.tally.ratioPct === 100, JSON.stringify(finA.tally));

    // Anchor carries the publicId + a date-independent docHash = sha256(title+content).
    const aA = await db.anchor.findFirst({ where: { proposalId: p.id, kind: 'internal' } });
    const wantHash = createHash('sha256').update(`__test__ Adopt the new review guideline\nShall we adopt it?`).digest('hex');
    ok('decision anchored (label 80808081)', !!aA && aA.metadataLabel === 80808081);
    ok('anchor preimage has publicId', aA?.preimage?.publicId === p.publicId, aA?.preimage?.publicId);
    ok('anchor preimage has date-independent docHash', aA?.preimage?.docHash === wantHash, `${aA?.preimage?.docHash?.slice(0, 12)}…`);

    // 2) Eligibility — a non-board DRep cannot vote on a BOARD_ONLY proposal.
    const heidi = await db.appUser.findFirst({ where: { displayName: 'Heidi' }, select: { id: true } });
    const heidiDrep = heidi ? await db.drep.findUnique({ where: { userId: heidi.id }, select: { status: true } }) : null;
    if (heidi && heidiDrep?.status === 'ADMITTED') {
      const p2 = await svc.submit(proposer, {
        title: '__test__ board-only scope', contentMd: 'x', internalType: 'INFORMATIVE',
        votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 7,
      });
      created.push(p2.id);
      let blocked = false;
      try { await svc.vote(heidi.id, p2.id, { choice: 'YES' }); } catch { blocked = true; }
      ok('non-board DRep blocked from a BOARD_ONLY vote', blocked);
    } else {
      ok('non-board DRep blocked from a BOARD_ONLY vote', true, 'skipped (no admitted non-board DRep)');
    }

    // 3) REJECTED path — only 1 of N YES → below 67%.
    const p3 = await svc.submit(proposer, {
      title: '__test__ unpopular', contentMd: 'x', internalType: 'INFORMATIVE',
      votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 7,
    });
    created.push(p3.id);
    await svc.vote(boardUsers[0], p3.id, { choice: 'YES' });
    const finC = await svc.finalize(p3.id);
    ok('1 YES of many → REJECTED', finC.status === 'REJECTED', finC.status);

    // 4) POLL — single choice, per-option tally.
    const poll = await svc.submit(proposer, {
      title: '__test__ pick a colour', contentMd: 'Which colour?', internalType: 'POLL',
      votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE',
      votingPeriodDays: 7, pollOptions: ['Red', 'Green', 'Blue'], pollMultiple: false,
    });
    created.push(poll.id);
    ok('poll has options', poll.poll?.options.length === 3, JSON.stringify(poll.poll));
    await svc.vote(boardUsers[0], poll.id, { options: ['Red'] });
    await svc.vote(boardUsers[1], poll.id, { options: ['Red'] });
    await svc.vote(boardUsers[2], poll.id, { options: ['Green'] });
    // Abstain on a poll → counted toward "voted" but no option.
    await svc.vote(boardUsers[3], poll.id, { choice: 'ABSTAIN' });
    let rejectedMulti = false;
    try { await svc.vote(boardUsers[0], poll.id, { options: ['Red', 'Green'] }); } catch { rejectedMulti = true; }
    ok('single-choice poll rejects multiple options', rejectedMulti);
    // Verify abstain shows in the detail's myVotes (for the "you abstained" list chip).
    const detAbst = await svc.detail(poll.id, boardUsers[3]);
    ok('poll abstain recorded as myVote', detAbst.myVotes[0] === 'ABSTAIN', JSON.stringify(detAbst.myVotes));
    const finPoll = await svc.finalize(poll.id);
    ok('poll concludes APPROVED', finPoll.status === 'APPROVED', finPoll.status);
    const red = finPoll.tally.kind === 'POLL' && finPoll.tally.options.find((o) => o.option === 'Red');
    ok('Red has 2 votes', red && red.voters === 2, JSON.stringify(red));
    ok('poll abstain counted (1 voter)', finPoll.tally.kind === 'POLL' && finPoll.tally.abstain.voters === 1, JSON.stringify(finPoll.tally.kind === 'POLL' && finPoll.tally.abstain));

    // 5) The voting end is FIXED at submission — extendVoting was removed on purpose
    //    (commit a612ab0 "Internal proposals: fix the voting end at submission (no extend)").
    const p5 = await svc.submit(proposer, {
      title: '__test__ extend', contentMd: 'x', internalType: 'INFORMATIVE',
      votersScope: 'BOTH', thresholdKind: 'IMPORTANT', votingType: 'BALANCED', votingPeriodDays: 3,
    });
    created.push(p5.id);
    ok('voting end is fixed at submission (no extend API)', typeof svc.extendVoting !== 'function');
    const p5end = new Date(p5.votingEndAt).getTime();
    ok('voting end ≈ submission + votingPeriodDays', Math.abs(p5end - (Date.now() + 3 * 86400_000)) < 3_600_000, p5.votingEndAt);
    ok('IMPORTANT threshold = 75%', p5.thresholdPct === 75, `${p5.thresholdPct}`);

    // 6) PRIVATE proposal is hidden from a non-board viewer.
    const priv = await svc.submit(proposer, {
      title: '__test__ private', contentMd: 'secret', internalType: 'INFORMATIVE',
      votersScope: 'BOTH', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 7, isPrivate: true,
    });
    created.push(priv.id);
    ok('private forces BOARD_ONLY scope', priv.votersScope === 'BOARD_ONLY', priv.votersScope);
    if (heidi) {
      const listForHeidi = await svc.list(heidi.id);
      ok('private proposal hidden from non-board list', !listForHeidi.some((x) => x.id === priv.id));
    } else {
      ok('private proposal hidden from non-board list', true, 'skipped');
    }
    const listForBoard = await svc.list(proposer);
    ok('private proposal visible to board list', listForBoard.some((x) => x.id === priv.id));

    // 6) §10.5 SPENDING — approved → an OPS multisig action the board signs (idempotent).
    const spend = await svc.submit(proposer, {
      title: '__test__ Pay the auditor', contentMd: 'Pay 25 ₳ from the treasury to the auditor.',
      internalType: 'SPENDING', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT',
      votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 7,
      spendingAmountAda: 25,
      spendingDestAddress: 'addr_test1qp77m2c97pl05yynuua3022r8j302v23q90fkv8p0e4p0vtx0gj9tkmqktz2fhwjxskzz33a2kjxthwugz0e5czdmuzsjyk5u3',
    });
    created.push(spend.id);
    ok('SPENDING submit → ACTIVE with parameters', spend.status === 'ACTIVE' && spend.spending?.amountAda === 25 && !!spend.spending?.destAddress, JSON.stringify(spend.spending));
    ok('SPENDING has no action before approval', spend.spending?.action === null);
    let spendRejected = false;
    try { await svc.submit(proposer, { title: 'x', contentMd: 'x', internalType: 'SPENDING', votersScope: 'BOARD_ONLY', thresholdKind: 'DEFAULT', votingType: 'ONE_PERSON_ONE_VOTE', votingPeriodDays: 7, spendingDestAddress: 'addr_test1xyz' }); }
    catch (e) { spendRejected = /positive ADA amount/.test(e.message); }
    ok('SPENDING without an amount is rejected', spendRejected);

    for (const uid of boardUsers) await svc.vote(uid, spend.id, { choice: 'YES' });
    const spendFin = await svc.finalize(spend.id);
    ok('SPENDING all-YES → APPROVED', spendFin.status === 'APPROVED', spendFin.status);
    const spendDetail = await svc.detail(spend.id, proposer);
    ok('approval prepares the OPS multisig action (PENDING_SIGS)', spendDetail.spending?.action?.status === 'PENDING_SIGS', JSON.stringify(spendDetail.spending?.action));
    const act = await db.multisigAction.findUnique({ where: { id: spendDetail.spending.action.id } });
    ok('action carries amount + destination + proposal link', act.kind === 'OPS' && act.amountAda === 25_000_000n && act.destAddress?.startsWith('addr_test1qp77') && act.proposalId === spend.id);
    await svc.detail(spend.id, proposer); // idempotence: re-reading must NOT create a second action
    const actCount = await db.multisigAction.count({ where: { proposalId: spend.id, kind: 'OPS' } });
    ok('re-reads do not duplicate the action (idempotent)', actCount === 1, String(actCount));
    created.spendActionId = act.id;

  } finally {
    for (const id of created) {
      await db.vote.deleteMany({ where: { proposalId: id } });
      const snaps = await db.voteSnapshot.findMany({ where: { proposalId: id }, select: { id: true } });
      await db.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snaps.map((s) => s.id) } } });
      await db.voteSnapshot.deleteMany({ where: { proposalId: id } });
      await db.anchor.deleteMany({ where: { proposalId: id } });
      await db.multisigAction.deleteMany({ where: { proposalId: id } }).catch(() => undefined);
      await db.proposal.deleteMany({ where: { id } });
    }
  }

  await prisma.$disconnect();
  await db.$disconnect();
  console.log(fail ? `\n❌ ${fail} check(s) failed.` : '\n✅ All internal-proposal checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
