import { LOVELACE_PER_ADA } from './money';

/**
 * §12 — reward pool partitioning, the single source of truth shared by the backend
 * computation (BigInt lovelace) and the frontend breakdown chart (ADA numbers).
 *
 * Experts are carved out FIRST: drepPool = pool × (1 − expertShare). The DRep pool then
 * splits into D&V (dvShare) vs milestone (rest); D&V splits into fixed (equal per vote)
 * vs bonus (power-weighted).
 */
export interface RewardPoolsLovelace {
  drepPool: bigint;
  dvPool: bigint;
  dvFixedPool: bigint;
  dvBonusPool: bigint;
  milestonePool: bigint;
}

export function computeRewardPools(
  poolLovelace: bigint,
  expertSharePct: number,
  dvSharePct: number,
  dvFixedSharePct: number,
): RewardPoolsLovelace {
  const pct = (v: bigint, p: number) => (v * BigInt(Math.round(p * 100))) / 10_000n;
  const drepPool = pct(poolLovelace, 100 - expertSharePct);
  const dvPool = pct(drepPool, dvSharePct);
  const dvFixedPool = pct(dvPool, dvFixedSharePct);
  return {
    drepPool,
    dvPool,
    dvFixedPool,
    dvBonusPool: dvPool - dvFixedPool,
    milestonePool: drepPool - dvPool,
  };
}

/** ADA-number variant for UI charts — same math, floating point. */
export function computeRewardPoolsAda(
  poolAda: number,
  expertSharePct: number,
  dvSharePct: number,
  dvFixedSharePct: number,
) {
  const r = computeRewardPools(BigInt(Math.round(poolAda * LOVELACE_PER_ADA)), expertSharePct, dvSharePct, dvFixedSharePct);
  return {
    expertAda: poolAda - Number(r.drepPool) / LOVELACE_PER_ADA,
    drepPoolAda: Number(r.drepPool) / LOVELACE_PER_ADA,
    dvFixedAda: Number(r.dvFixedPool) / LOVELACE_PER_ADA,
    dvBonusAda: Number(r.dvBonusPool) / LOVELACE_PER_ADA,
    milestoneAda: Number(r.milestonePool) / LOVELACE_PER_ADA,
  };
}
