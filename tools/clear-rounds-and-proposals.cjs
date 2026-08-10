/**
 * Dev-only — wipes every round + every proposal (with all their child rows) so the
 * platform can be tested from scratch. Keeps users, DReps, board seats, admins,
 * platform config. Anchors that pointed at proposals are deleted; per-round
 * eligibilities/schedules/categories too. Reward calculations & their entries
 * are deleted. PROJECT_FUNDING multisig actions queued for milestone payouts are
 * deleted; OPS hot-wallet top-ups are kept (they're independent).
 *
 *   node tools/clear-rounds-and-proposals.cjs
 *
 * Asks for confirmation unless run with --yes.
 */
const readline = require('node:readline');
const root = require('node:path').join(__dirname, '..');
const { prisma: db } = require(root + '/packages/db/dist/index.js');

const argv = process.argv.slice(2);
const auto = argv.includes('--yes') || argv.includes('-y');

async function confirm() {
  if (auto) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question('Type DELETE to confirm: ', (a) => { rl.close(); res(a); }));
  return answer === 'DELETE';
}

(async () => {
  const roundCount = await db.round.count();
  const propCount = await db.proposal.count();
  console.log(`This will DELETE: ${roundCount} round(s), ${propCount} proposal(s), and all their child rows.`);
  if (!(await confirm())) { console.log('Aborted.'); process.exit(1); }

  // Order matters — child tables before parents.
  const milestoneIds = (await db.milestone.findMany({ select: { id: true } })).map((m) => m.id);
  const proposalIds = (await db.proposal.findMany({ select: { id: true } })).map((p) => p.id);
  const snapshotIds = (await db.voteSnapshot.findMany({ select: { id: true } })).map((s) => s.id);
  const stopIds = (await db.stopFundingProposal.findMany({ select: { id: true } })).map((s) => s.id);

  if (stopIds.length) await db.stopFundingVote.deleteMany({ where: { stopId: { in: stopIds } } });
  await db.stopFundingProposal.deleteMany({});
  if (snapshotIds.length) await db.voteSnapshotEntry.deleteMany({ where: { snapshotId: { in: snapshotIds } } });
  await db.voteSnapshot.deleteMany({});
  await db.vote.deleteMany({});
  if (milestoneIds.length) {
    await db.milestonePoa.deleteMany({ where: { milestoneId: { in: milestoneIds } } });
    await db.milestoneAssignment.deleteMany({ where: { milestoneId: { in: milestoneIds } } });
  }
  await db.milestone.deleteMany({});
  await db.filterAssignment.deleteMany({});
  await db.proposalVersion.deleteMany({});
  await db.comment.deleteMany({});
  await db.feeAdjustment.deleteMany({});
  if (proposalIds.length) await db.anchor.deleteMany({ where: { proposalId: { in: proposalIds } } });
  await db.proposal.deleteMany({});
  await db.rewardEntry.deleteMany({});
  await db.rewardCalculation.deleteMany({});
  await db.roundDrepEligibility.deleteMany({});
  await db.roundSchedule.deleteMany({});
  await db.roundCategory.deleteMany({});
  await db.round.deleteMany({});
  // Round-anchors with no proposalId (e.g. round-summary anchors) — drop too.
  await db.anchor.deleteMany({ where: { proposalId: null, roundId: null } }).catch(() => {});
  await db.anchor.deleteMany({ where: { roundId: { not: null } } }).catch(() => {});
  // Milestone PROJECT_FUNDING payouts auto-queued by maybeDecide; OPS top-ups stay.
  await db.multisigAction.deleteMany({ where: { kind: 'PROJECT_FUNDING' } });

  const afterRounds = await db.round.count();
  const afterProps = await db.proposal.count();
  console.log(`Done. rounds=${afterRounds}, proposals=${afterProps}.`);
  await db.$disconnect();
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
