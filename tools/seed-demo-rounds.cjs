/**
 * Seed live demo data so the platform shows 1 completed (old) round + 1 active
 * (current) round, with REAL on-chain anchors for the filtering / D&V / milestone
 * decisions (uses ANCHOR_MNEMONIC = the anchor hot wallet). Reviewers/voters are
 * the seated board; the submitter is the holder persona (Carol). Idempotent: skips
 * if "Round Alpha (demo)" already exists.
 *
 *   node tools/seed-demo-rounds.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const root = require('node:path').join(__dirname, '..');
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { PrismaService } = require(root + '/apps/api/dist/prisma/prisma.service.js');
const { CardanoQueryService } = require(root + '/apps/api/dist/cardano/cardano-query.service.js');
const { AnchorService } = require(root + '/apps/api/dist/cardano/anchor.service.js');
const { UsersService } = require(root + '/apps/api/dist/users/users.service.js');
const { RoundsService } = require(root + '/apps/api/dist/rounds/rounds.service.js');
const { ProposalsService } = require(root + '/apps/api/dist/proposals/proposals.service.js');
const { FilteringService } = require(root + '/apps/api/dist/proposals/filtering.service.js');
const { DvService } = require(root + '/apps/api/dist/proposals/dv.service.js');
const { MilestonesService } = require(root + '/apps/api/dist/milestones/milestones.service.js');
const { CommentsService } = require(root + '/apps/api/dist/comments/comments.service.js');
const { stakeKeyHashFromBech32 } = require(root + '/packages/cardano/dist/index.js');
const personas = require(root + '/tools/persona-wallets.json');

const config = { get: (k) => process.env[k] };
const KOIOS = process.env.KOIOS_URL || 'https://preprod.koios.rest/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function waitConfirm(txHash, label) {
  if (!txHash) { log(`   ⚠ ${label}: anchor recorded but NOT submitted (no ANCHOR_MNEMONIC?)`); return; }
  log(`   ⏳ ${label}: ${txHash} — waiting for confirmation…`);
  for (let i = 0; i < 30; i++) {
    await sleep(8000);
    try {
      const r = await fetch(`${KOIOS}/tx_status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ _tx_hashes: [txHash] }),
      });
      const j = await r.json();
      const conf = Array.isArray(j) && j[0] ? Number(j[0].num_confirmations ?? 0) : 0;
      if (conf >= 1) { log(`   ✅ ${label} confirmed (${conf} conf)`); return; }
    } catch { /* keep polling */ }
  }
  log(`   ⚠ ${label}: not confirmed within timeout (continuing; tx may still settle)`);
}

(async () => {
  const prisma = new PrismaService(config);
  const cardano = new CardanoQueryService(config);
  const users = new UsersService(prisma, cardano);
  const anchor = new AnchorService(config, prisma, cardano);
  const rounds = new RoundsService(prisma, config);
  const proposals = new ProposalsService(prisma, config, cardano);
  const filtering = new FilteringService(prisma, anchor);
  const dv = new DvService(prisma, config, anchor, cardano);
  const milestones = new MilestonesService(prisma, anchor);
  const comments = new CommentsService(prisma);

  if (await prisma.round.findFirst({ where: { name: 'Round Alpha (demo)' } })) {
    log('Demo rounds already exist — nothing to do.');
    await prisma.$disconnect();
    return;
  }
  if (!process.env.ANCHOR_MNEMONIC) log('⚠ ANCHOR_MNEMONIC not set — decisions will be recorded but not submitted on-chain.');

  const seats = await prisma.boardSeat.findMany();
  const board = await prisma.drep.findMany({
    where: { user: { drepKeyHash: { in: seats.map((s) => s.drepKeyHash) } } },
    include: { user: { select: { id: true } } },
  });
  if (board.length < 3) throw new Error(`need ≥3 board reviewers, found ${board.length}`);
  const uid = (drepId) => board.find((d) => d.id === drepId)?.user.id;
  const carol = await users.upsertByStakeKey({
    stakeKeyHash: stakeKeyHashFromBech32(personas.holder.stakeAddress),
    stakeAddress: personas.holder.stakeAddress,
    drepKeyHash: personas.holder.drepKeyHash,
  });
  const longRat = 'I support this because the team is credible, the milestones are realistic, and the deliverable benefits the whole ecosystem. '.padEnd(220, '.');

  const drawAndVote = async (proposalId, n, choice, rat) => {
    await filtering.drawReviewers(proposalId);
    const a = await prisma.filterAssignment.findMany({ where: { proposalId, releasedAt: null } });
    let c = 0;
    for (const x of a) { const u = uid(x.drepId); if (u) { await filtering.vote(u, proposalId, choice, rat); if (++c >= n) break; } }
  };

  // ========================= Round Alpha (completed) =========================
  log('\n=== Round Alpha (demo) — full lifecycle → CLOSED ===');
  const alpha = await rounds.create({
    name: 'Round Alpha (demo)', budgetAda: 1_000_000, rewardsPoolAda: 50_000,
    categories: [{ name: 'Tooling', type: 'GRANT', allocatedAda: 1_000_000, description: 'Developer tooling & libraries' }],
  });
  await rounds.startStage(alpha.id, 'SUBMISSION');
  const p1 = await proposals.createDraft(carol.id, {
    roundId: alpha.id, categoryId: alpha.categories[0].id, title: 'Cardano wallet UX toolkit',
    contentMd: 'A reusable React toolkit for CIP-30 wallet flows.\n\n- connect\n- sign\n- submit',
    isCommercial: true, requestedAmountAda: 1000, milestones: [{ description: 'Ship the toolkit v1', amountAda: 1000 }],
  });
  await proposals.submit(carol.id, p1.id, { submissionFeeTxHash: 'demo-fee-tx-alpha' });
  await proposals.reviewFee(p1.id, { decision: 'APPROVE' });
  log('  proposal submitted, fee confirmed → FILTERING');
  await proposals.updateDraft(carol.id, p1.id, { contentMd: 'A reusable React toolkit for CIP-30 wallet flows.\n\n- connect\n- sign\n- submit\n- (v2) batch & multi-sig support added after reviewer feedback' });
  log('  edited (version snapshot created for the diff view)');
  await drawAndVote(p1.id, 3, 'YES', 'Clear scope and a credible team.');
  await waitConfirm((await prisma.anchor.findFirst({ where: { proposalId: p1.id, kind: 'filtering' }, orderBy: { createdAt: 'desc' } }))?.txHash, 'filtering anchor');
  await dv.openVoting(p1.id);
  for (const d of board) await dv.vote(d.user.id, p1.id, 'YES', longRat);
  await dv.finalize(p1.id);
  await waitConfirm((await prisma.anchor.findFirst({ where: { proposalId: p1.id, kind: 'dv' }, orderBy: { createdAt: 'desc' } }))?.txHash, 'D&V anchor');
  log('  D&V APPROVED → FUNDING');
  await milestones.drawReviewers(p1.id);
  for (const m of await milestones.forProposal(p1.id)) {
    await milestones.submitPoa(carol.id, m.id, 'Delivered: repo + npm package + docs (links in the PoA).');
    const ma = await prisma.milestoneAssignment.findMany({ where: { milestoneId: m.id, releasedAt: null } });
    let c = 0;
    for (const x of ma) { const u = uid(x.reviewerDrepId); if (u) { await milestones.vote(u, m.id, 'YES', 'Verified, looks complete.'); if (++c >= 2) break; } }
    await waitConfirm((await prisma.anchor.findFirst({ where: { proposalId: p1.id, kind: 'milestone' }, orderBy: { createdAt: 'desc' } }))?.txHash, 'milestone anchor');
  }
  await comments.create(carol.id, p1.id, 'Thanks to the reviewers for the multi-sig suggestion — added in v2!');
  await rounds.closeRound(alpha.id, board[0].user.id);
  log('  Round Alpha CLOSED (proposal COMPLETE).');

  // ========================= Round Beta (current) ===========================
  log('\n=== Round Beta (demo) — active, proposals in Filtering ===');
  const beta = await rounds.create({
    name: 'Round Beta (demo)', budgetAda: 4_000_000, rewardsPoolAda: 200_000,
    categories: [
      { name: 'DeFi', type: 'GRANT', allocatedAda: 2_500_000, description: 'DeFi protocols & liquidity' },
      { name: 'Infrastructure RFP', type: 'RFP', allocatedAda: 1_500_000, description: 'RFP: indexing & node infra' },
    ],
  });
  await rounds.startStage(beta.id, 'SUBMISSION');
  const p2 = await proposals.createDraft(carol.id, {
    roundId: beta.id, categoryId: beta.categories[0].id, title: 'Open liquidity router',
    contentMd: 'An open-source liquidity router aggregating Cardano DEXes.',
    isCommercial: false, requestedAmountAda: 80000, milestones: [{ description: 'MVP router', amountAda: 50000 }, { description: 'Audit + mainnet', amountAda: 30000 }],
  });
  const p3 = await proposals.createDraft(carol.id, {
    roundId: beta.id, categoryId: beta.categories[1].id, title: 'Managed Koios mirror (RFP)',
    contentMd: 'A managed, monitored Koios mirror for the DAO with SLAs.',
    isCommercial: true, requestedAmountAda: 120000, milestones: [{ description: 'Deploy + monitor', amountAda: 120000 }],
  });
  for (const p of [p2, p3]) { await proposals.submit(carol.id, p.id, { submissionFeeTxHash: `demo-fee-${p.id.slice(0, 6)}` }); await proposals.reviewFee(p.id, { decision: 'APPROVE' }); }
  // In-progress filtering (no decision yet): one YES on each, a NO+rationale, and comments.
  await drawAndVote(p2.id, 1, 'YES', 'Promising; want to see the audit plan.');
  await comments.create(carol.id, p2.id, 'Audit will be done by a CF-recommended firm — details in the next edit.');
  await drawAndVote(p3.id, 1, 'NO', 'Concerned about ongoing hosting costs vs. a community-run node.');
  await rounds.startStage(beta.id, 'FILTERING');
  log('  Round Beta active in FILTERING with 2 proposals under review.');

  await prisma.$disconnect();
  log('\n✅ Demo seeded: Round Alpha (CLOSED) + Round Beta (active). Check the Rounds + On-chain proofs views.');
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
