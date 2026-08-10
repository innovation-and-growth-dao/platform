/**
 * Targeted dev-only cleanup — wipes every round EXCEPT the ones listed on the
 * command line (or in $KEEP=4,13), and every child row tied to a removed
 * round (proposals, milestones, votes, anchors, snapshots, etc.). The board
 * roster + users + admins are not touched.
 *
 *   node tools/clear-rounds-keep.cjs 13         # keep round #13
 *   node tools/clear-rounds-keep.cjs 4 13       # keep rounds #4 and #13
 *   node tools/clear-rounds-keep.cjs --yes 13   # skip the confirmation prompt
 *
 * Use this when leftover test rounds are crowding the §5.1 single-active
 * Filtering/DV slot and you don't want to nuke everything.
 */
const readline = require('node:readline');
const root = require('node:path').join(__dirname, '..');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const argv = process.argv.slice(2);
const auto = argv.includes('--yes') || argv.includes('-y');
const keepNumbers = argv
  .filter((a) => !a.startsWith('-'))
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n));
if (keepNumbers.length === 0) {
  console.error('Usage: node tools/clear-rounds-keep.cjs [--yes] <round-number...>');
  process.exit(2);
}

async function confirm(prompt) {
  if (auto) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(prompt + ' Type DELETE to confirm: ', (a) => { rl.close(); res(a); }));
  return answer === 'DELETE';
}

(async () => {
  const keep = await db.round.findMany({ where: { number: { in: keepNumbers } }, select: { id: true, number: true, name: true } });
  if (keep.length === 0) {
    console.error(`No rounds matched ${keepNumbers.join(',')} — refusing to delete everything.`);
    process.exit(1);
  }
  const keepIds = keep.map((r) => r.id);
  const remove = await db.round.findMany({ where: { id: { notIn: keepIds } }, select: { id: true, number: true, status: true, name: true, _count: { select: { proposals: true } } } });
  if (remove.length === 0) { console.log('Nothing to remove.'); await db.$disconnect(); return; }

  console.log('Keeping:');
  for (const r of keep) console.log('  ✓ #' + r.number, '·', r.name ?? '');
  console.log('Removing:');
  for (const r of remove) console.log('  ✗ #' + r.number, '·', r.status.padEnd(11), '·', r._count.proposals, 'proposals ·', r.name ?? '');

  if (!(await confirm(`Delete ${remove.length} round(s) and every proposal/vote/milestone tied to them?`))) {
    console.log('Aborted.');
    process.exit(1);
  }

  const removeIds = remove.map((r) => r.id);
  const props = await db.proposal.findMany({ where: { roundId: { in: removeIds } }, select: { id: true } });
  const propIds = props.map((p) => p.id);
  const msIds = (await db.milestone.findMany({ where: { proposalId: { in: propIds } }, select: { id: true } })).map((m) => m.id);
  const snapIds = (await db.voteSnapshot.findMany({ where: { proposalId: { in: propIds } }, select: { id: true } })).map((s) => s.id);
  const stopIds = (await db.stopFundingProposal.findMany({ where: { proposalId: { in: propIds } }, select: { id: true } })).map((s) => s.id);

  if (stopIds.length) await db.stopFundingVote.deleteMany({ where: { stopId: { in: stopIds } } });
  if (stopIds.length) await db.stopFundingProposal.deleteMany({ where: { id: { in: stopIds } } });
  if (snapIds.length) await db.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapIds } } });
  if (snapIds.length) await db.voteSnapshot.deleteMany({ where: { id: { in: snapIds } } });
  if (propIds.length) await db.vote.deleteMany({ where: { proposalId: { in: propIds } } });
  if (msIds.length) {
    await db.milestonePoa.deleteMany({ where: { milestoneId: { in: msIds } } });
    await db.milestoneAssignment.deleteMany({ where: { milestoneId: { in: msIds } } });
  }
  if (propIds.length) {
    await db.milestone.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.filterAssignment.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.proposalVersion.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.comment.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.feeAdjustment.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.budgetChangeRequest.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.anchor.deleteMany({ where: { proposalId: { in: propIds } } });
    await db.proposal.deleteMany({ where: { id: { in: propIds } } });
  }
  // PROJECT_FUNDING multisig actions tagged with any of the removed proposal ids.
  // (Bulk delete; OPS top-ups don't share kind.)
  await db.multisigAction.deleteMany({ where: { kind: 'PROJECT_FUNDING' } });
  await db.rewardEntry.deleteMany({ where: { rewardCalculation: { roundId: { in: removeIds } } } });
  await db.rewardCalculation.deleteMany({ where: { roundId: { in: removeIds } } });
  await db.roundDrepEligibility.deleteMany({ where: { roundId: { in: removeIds } } });
  await db.roundSchedule.deleteMany({ where: { roundId: { in: removeIds } } });
  await db.roundCategory.deleteMany({ where: { roundId: { in: removeIds } } });
  // Anchors that only had a roundId (no proposalId).
  await db.anchor.deleteMany({ where: { proposalId: null, roundId: { in: removeIds } } });
  await db.round.deleteMany({ where: { id: { in: removeIds } } });

  const after = await db.round.findMany({ select: { number: true, status: true, name: true }, orderBy: { number: 'asc' } });
  console.log('\nDone. Remaining rounds:');
  for (const r of after) console.log('  · #' + r.number, '·', r.status.padEnd(11), '·', r.name ?? '');
  await db.$disconnect();
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
