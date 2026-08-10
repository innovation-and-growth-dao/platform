/**
 * Pure unit tests for the shared single-source-of-truth helpers introduced by the audit:
 *   - money.ts        toLovelace / toAda round-trip
 *   - reward-math.ts  §12 pool partitioning (verifies the design's worked example:
 *                     2000 ₳ pool · 30% experts · 60% D&V · 70% fixed → 588/252/560)
 *   - candidate-ranking.ts  §7.1/§11.1 expertise → least-load → random draw ordering
 *   - voting.ts       §4.2 balanced power formula spot-check
 *
 * No DB, no network. node tools/test-shared-math.cjs
 */
require('./_test-env.cjs');
const root = require('node:path').join(__dirname, '..');
const { toLovelace, toAda, computeRewardPools, computeRewardPoolsAda, basePower, meritMultiplier, finalPower } =
  require(root + '/packages/shared/dist/index.js');
const { rankReviewerCandidates } = require(root + '/apps/api/dist/proposals/candidate-ranking.js');

let fail = 0;
const ok = (l, c, d) => { console.log(`  ${c ? '✅' : '❌'} ${l}${d ? ` — ${d}` : ''}`); if (!c) fail++; };

(() => {
  // money
  ok('toLovelace(1.5) = 1_500_000n', toLovelace(1.5) === 1_500_000n);
  ok('toAda(1_500_000n) = 1.5', toAda(1_500_000n) === 1.5);
  ok('toAda(null) = 0', toAda(null) === 0);
  ok('round-trip 123.456789 ₳', toAda(toLovelace(123.456789)) === 123.456789);

  // reward-math — the §12.2 worked example used across the design + round-setup chart.
  const pools = computeRewardPools(toLovelace(2000), 30, 60, 70);
  ok('drepPool = 1400 ₳ (2000 − 30% experts)', toAda(pools.drepPool) === 1400, String(toAda(pools.drepPool)));
  ok('dvFixedPool = 588 ₳', toAda(pools.dvFixedPool) === 588, String(toAda(pools.dvFixedPool)));
  ok('dvBonusPool = 252 ₳', toAda(pools.dvBonusPool) === 252, String(toAda(pools.dvBonusPool)));
  ok('milestonePool = 560 ₳', toAda(pools.milestonePool) === 560, String(toAda(pools.milestonePool)));
  ok('pools sum to drepPool', pools.dvFixedPool + pools.dvBonusPool + pools.milestonePool === pools.drepPool);
  const ada = computeRewardPoolsAda(2000, 30, 60, 70);
  ok('ADA variant matches (chart uses the same math)', ada.dvFixedAda === 588 && ada.dvBonusAda === 252 && ada.milestoneAda === 560 && ada.expertAda === 600);

  // candidate-ranking — expertise first, then least load; random only breaks ties.
  const ranked = rankReviewerCandidates([
    { name: 'no-match-load0', expertiseMatch: false, loadInRound: 0 },
    { name: 'match-load2', expertiseMatch: true, loadInRound: 2 },
    { name: 'match-load0', expertiseMatch: true, loadInRound: 0 },
  ]);
  ok('expertise+least-load ranks first', ranked[0].name === 'match-load0', ranked.map((r) => r.name).join(','));
  ok('expertise beats lower load without match', ranked[1].name === 'match-load2');
  ok('no-match ranks last', ranked[2].name === 'no-match-load0');
  // ties broken randomly but stably within constraints: all tied candidates still present.
  const tied = rankReviewerCandidates(Array.from({ length: 5 }, (_, i) => ({ i, expertiseMatch: true, loadInRound: 1 })));
  ok('random tiebreak keeps all candidates', new Set(tied.map((t) => t.i)).size === 5);

  // voting — §4.2: log10 stake, merit ±cap multiplier.
  ok('basePower(1M ₳) = 6', basePower(toLovelace(1_000_000)) === 6);
  ok('meritMultiplier(200, 200) = 2', meritMultiplier(200, 200) === 2);
  ok('finalPower = base × multiplier', finalPower(toLovelace(1_000_000), 200, 200) === 12);

  console.log(fail ? `\n${fail} failure(s)` : '\nall good');
  process.exit(fail ? 1 : 0);
})();
