/**
 * §8 — splits any leftover round_schedule row with stageKey='debate_vote' into
 * two consecutive halves: 'debate' (first half) → 'vote' (second half). Each
 * inherits the original row's autoStart / confirmedAt / confirmedBy.
 *
 * Idempotent — already-split rounds (those with both 'debate' and 'vote'
 * present) are left alone; mixed rows (only one of the two present) are
 * reported and skipped.
 *
 *   node tools/split-debate-vote-schedules.cjs        # dry run
 *   node tools/split-debate-vote-schedules.cjs --apply # actually do it
 */
const root = require('node:path').join(__dirname, '..');
const { prisma } = require(root + '/packages/db/dist/index.js');

const apply = process.argv.includes('--apply');

(async () => {
  const rounds = await prisma.round.findMany({
    include: { schedule: { orderBy: { startsAt: 'asc' } } },
    orderBy: { number: 'asc' },
  });
  let touched = 0;
  for (const r of rounds) {
    const keys = new Set(r.schedule.map((s) => s.stageKey));
    const dv = r.schedule.find((s) => s.stageKey === 'debate_vote');
    if (!dv) continue; // nothing to split
    if (keys.has('debate') && keys.has('vote')) {
      console.log(`  · #${r.number} already split (debate + vote present) — leaving debate_vote row`);
      continue;
    }
    if (keys.has('debate') || keys.has('vote')) {
      console.warn(`  ! #${r.number} partial split (only one of debate/vote present) — skipping`);
      continue;
    }
    const totalMs = dv.endsAt.getTime() - dv.startsAt.getTime();
    const midMs = dv.startsAt.getTime() + Math.floor(totalMs / 2);
    const debateStart = dv.startsAt;
    const debateEnd = new Date(midMs);
    const voteStart = new Date(midMs);
    const voteEnd = dv.endsAt;
    console.log(
      `  · #${r.number} debate_vote ${dv.startsAt.toISOString()} → ${dv.endsAt.toISOString()} ` +
        `splits into debate ${debateStart.toISOString()} → ${debateEnd.toISOString()} + ` +
        `vote ${voteStart.toISOString()} → ${voteEnd.toISOString()}`,
    );
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      await tx.roundSchedule.create({
        data: {
          roundId: r.id,
          stageKey: 'debate',
          startsAt: debateStart,
          endsAt: debateEnd,
          autoStart: dv.autoStart,
          prolongedFrom: dv.prolongedFrom,
          confirmedAt: dv.confirmedAt,
          confirmedBy: dv.confirmedBy,
        },
      });
      await tx.roundSchedule.create({
        data: {
          roundId: r.id,
          stageKey: 'vote',
          startsAt: voteStart,
          endsAt: voteEnd,
          autoStart: dv.autoStart,
          confirmedAt: dv.confirmedAt,
          confirmedBy: dv.confirmedBy,
        },
      });
      await tx.roundSchedule.delete({ where: { roundId_stageKey: { roundId: r.id, stageKey: 'debate_vote' } } });
    });
    touched++;
  }
  console.log(`\n${apply ? 'Updated' : 'Would update'} ${touched} round(s).${apply ? '' : ' Re-run with --apply to commit.'}`);
  await prisma.$disconnect();
})();
