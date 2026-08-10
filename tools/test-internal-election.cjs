/**
 * §14 board-member election: validation, voting → approval, install authorization, manual
 * install, auto-install on read after the installation date, and idempotency. Self-cleaning
 * (deletes its throwaway proposals + restores the original board roster).
 *
 *   node tools/test-internal-election.cjs
 */
require('./_test-env.cjs');
const fs = require('node:fs');
const path = require('node:path');
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
const isoFuture = (ms) => new Date(Date.now() + ms).toISOString();
const created = [];

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const anchor = new AnchorService(config, prisma, cardano);
  const svc = new InternalProposalsService(prisma, config, anchor, cardano);

  // Current board members (snapshot, to restore after the test).
  const boardBefore = await db.boardSeat.findMany({ orderBy: { addedAt: 'asc' } });
  if (boardBefore.length < 5) { console.error('need 5 board members seated'); process.exit(1); }

  // Map board drepKeyHashes → AppUser → Drep rows (drep.id = the UUID candidates use).
  const boardDrepIds = [];
  const boardUserIds = [];
  for (const seat of boardBefore) {
    const u = await db.appUser.findFirst({ where: { drepKeyHash: seat.drepKeyHash }, select: { id: true } });
    if (!u) continue;
    const d = await db.drep.findUnique({ where: { userId: u.id }, select: { id: true } });
    if (d) { boardDrepIds.push(d.id); boardUserIds.push(u.id); }
  }
  if (boardDrepIds.length < 5) { console.error('could not resolve 5 board drep ids'); process.exit(1); }
  const proposer = boardUserIds[0];
  const candidates5 = boardDrepIds.slice(0, 5);
  // Optional non-board admitted DRep for the "not allowed to install" check.
  const nonBoardDrep = await db.drep.findFirst({
    where: { status: 'ADMITTED', user: { drepKeyHash: { notIn: boardBefore.map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });

  try {
    // 1) VALIDATION — < 5, duplicates, missing deliveryDate, deliveryDate ≤ end, isPrivate, unknown drep.
    const baseValid = {
      title: '__test__ election base', contentMd: 'pick 5', internalType: 'INSTRUCTIVE',
      votersScope: 'BOTH', thresholdKind: 'IMPORTANT', votingType: 'BALANCED',
      votingEndAt: isoFuture(86_400_000),
      isBoardElection: true,
    };
    const validInstall = isoFuture(2 * 86_400_000);

    let threwFour = false;
    try { await svc.submit(proposer, { ...baseValid, candidates: candidates5.slice(0, 4), deliveryDate: validInstall }); }
    catch { threwFour = true; }
    ok('rejects fewer than 5 candidates', threwFour);

    let threwDup = false;
    try {
      await svc.submit(proposer, { ...baseValid, candidates: [...candidates5.slice(0, 4), candidates5[0]], deliveryDate: validInstall });
    } catch { threwDup = true; }
    ok('rejects duplicate candidates', threwDup);

    let threwNoInstall = false;
    try { await svc.submit(proposer, { ...baseValid, candidates: candidates5 }); }
    catch { threwNoInstall = true; }
    ok('rejects when no installation date', threwNoInstall);

    let threwInstallTooEarly = false;
    try {
      await svc.submit(proposer, {
        ...baseValid, candidates: candidates5,
        deliveryDate: new Date(new Date(baseValid.votingEndAt).getTime() - 60_000).toISOString(),
      });
    } catch { threwInstallTooEarly = true; }
    ok('rejects installation date ≤ voting end', threwInstallTooEarly);

    let threwPrivate = false;
    try { await svc.submit(proposer, { ...baseValid, candidates: candidates5, deliveryDate: validInstall, isPrivate: true }); }
    catch { threwPrivate = true; }
    ok('rejects PRIVATE election (must be public)', threwPrivate);

    let threwUnknown = false;
    try {
      await svc.submit(proposer, {
        ...baseValid, candidates: [...candidates5.slice(0, 4), '00000000-0000-0000-0000-000000000000'],
        deliveryDate: validInstall,
      });
    } catch { threwUnknown = true; }
    ok('rejects unknown / non-admitted candidate', threwUnknown);

    // 2) SUBMIT a valid election → ACTIVE, forced defaults, isBoardElection.
    const election = await svc.submit(proposer, {
      ...baseValid, candidates: candidates5, deliveryDate: validInstall,
    });
    created.push(election.id);
    ok('election → ACTIVE', election.status === 'ACTIVE', election.status);
    ok('election forces scope BOTH', election.votersScope === 'BOTH', election.votersScope);
    ok('election forces voting type BALANCED', election.votingType === 'BALANCED', election.votingType);
    ok('election forces threshold IMPORTANT', election.thresholdKind === 'IMPORTANT', election.thresholdKind);
    ok('isBoardElection true', election.isBoardElection === true);
    ok('5 candidates resolved with names', election.candidates?.length === 5 && election.candidates.every((c) => c.displayName && c.drepKeyHash));

    // 3) INSTALL is forbidden BEFORE approval (proposal still ACTIVE).
    let prematureBlocked = false;
    try { await svc.installNewBoard(proposer, election.id); } catch { prematureBlocked = true; }
    ok('install rejected while proposal is ACTIVE', prematureBlocked);

    // 4) Approve: every board votes YES (5/5 = 100% ≥ 75% IMPORTANT) → APPROVED on finalize.
    for (const uid of boardUserIds.slice(0, 5)) await svc.vote(uid, election.id, { choice: 'YES' });
    const fin = await svc.finalize(election.id);
    ok('election approved (5 YES)', fin.status === 'APPROVED', fin.status);

    // 4b) On-chain anchor includes the elected board (drep id + name) alongside the voters,
    //     proposal id and document hash.
    const a = await db.anchor.findFirst({ where: { proposalId: election.id, kind: 'internal' }, orderBy: { createdAt: 'desc' } });
    ok('election anchor recorded', !!a && a.metadataLabel === 80808081);
    ok('anchor preimage has publicId', a?.preimage?.publicId === election.publicId);
    ok('anchor preimage has docHash', typeof a?.preimage?.docHash === 'string' && a.preimage.docHash.length === 64);
    const elected = a?.preimage?.electedBoard;
    ok('anchor preimage has 5 elected board members', Array.isArray(elected) && elected.length === 5, JSON.stringify(elected?.map((x) => x.name)));
    const electedDreps = new Set((elected ?? []).map((e) => e.drep));
    const candidateDreps = new Set(election.candidates.map((c) => c.drepIdOnchain));
    ok('elected drep ids match the candidates', electedDreps.size === 5 && [...candidateDreps].every((d) => electedDreps.has(d)));
    const voterCount = Array.isArray(a?.preimage?.votes) ? a.preimage.votes.length : 0;
    ok('anchor preimage records each voter (drep + choice)', voterCount === 5, `${voterCount} votes`);

    // 5) AUTHORIZATION — non-board user cannot install.
    if (nonBoardDrep?.user?.id) {
      let nbBlocked = false;
      try { await svc.installNewBoard(nonBoardDrep.user.id, election.id); } catch { nbBlocked = true; }
      ok('non-board DRep cannot install the new board', nbBlocked);
    } else {
      ok('non-board DRep cannot install the new board', true, 'skipped (no admitted non-board DRep)');
    }

    // 6) MANUAL install by a board member.
    const r1 = await svc.installNewBoard(proposer, election.id);
    ok('manual install marks boardInstalledAt', !!r1.boardInstalledAt, String(r1.boardInstalledAt));
    const boardAfter = await db.boardSeat.findMany({});
    const wantHashes = new Set(election.candidates.map((c) => c.drepKeyHash));
    const gotHashes = new Set(boardAfter.map((s) => s.drepKeyHash));
    const same = wantHashes.size === gotHashes.size && [...wantHashes].every((h) => gotHashes.has(h));
    ok('boardSeat now matches the elected candidates', same, `${boardAfter.length} seats`);

    // 7) Idempotent — second install call is a no-op (returns the existing boardInstalledAt).
    const r2 = await svc.installNewBoard(proposer, election.id);
    ok('install is idempotent', r2.boardInstalledAt && r2.boardInstalledAt.getTime() === r1.boardInstalledAt.getTime());

    // 8) AUTO-INSTALL on read: another election whose installation date has passed.
    const election2 = await svc.submit(proposer, {
      ...baseValid, title: '__test__ election auto', candidates: candidates5,
      votingEndAt: isoFuture(60 * 1000), // short voting window
      deliveryDate: isoFuture(2 * 60 * 1000),
    });
    created.push(election2.id);
    // Force-approve + push deliveryDate into the past, then read — auto-install should run.
    await db.proposal.update({ where: { id: election2.id }, data: {
      status: 'APPROVED', resultFinalizedAt: new Date(),
      deliveryDate: new Date(Date.now() - 60_000),
    }});
    const det2 = await svc.detail(election2.id, proposer);
    ok('auto-install on read after deliveryDate', !!det2.boardInstalledAt, String(det2.boardInstalledAt));
  } finally {
    // Restore the original board roster (the installs swapped it for the candidates).
    await db.boardSeat.deleteMany({});
    for (const s of boardBefore) {
      await db.boardSeat.create({ data: { drepKeyHash: s.drepKeyHash, drepId: s.drepId, displayName: s.displayName } });
    }
    // Clean the throwaway election proposals.
    for (const id of created) {
      await db.vote.deleteMany({ where: { proposalId: id } });
      const snaps = await db.voteSnapshot.findMany({ where: { proposalId: id }, select: { id: true } });
      await db.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snaps.map((s) => s.id) } } });
      await db.voteSnapshot.deleteMany({ where: { proposalId: id } });
      await db.anchor.deleteMany({ where: { proposalId: id } });
      await db.proposal.deleteMany({ where: { id } });
    }
  }

  await prisma.$disconnect();
  await db.$disconnect();
  console.log(fail ? `\n❌ ${fail} check(s) failed.` : '\n✅ All board-election checks passed.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
