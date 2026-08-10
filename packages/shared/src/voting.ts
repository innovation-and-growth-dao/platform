/**
 * Voting power and approval math (§4). Pure functions — the canonical
 * implementation the backend uses for snapshots and tallies, and the same
 * formulas a DRep can re-run to verify a published result (§23.5).
 */
import { PLATFORM_CONFIG_DEFAULTS } from './config';

const LOVELACE_PER_ADA = 1_000_000n;
export const MERIT_POINT_MAX = PLATFORM_CONFIG_DEFAULTS.MERIT_POINT_MAX; // 200

/** Clamp merit points to [-MAX, +MAX] (§13.5 cap behavior). */
export function clampMerit(points: number, max: number = MERIT_POINT_MAX): number {
  return Math.max(-max, Math.min(max, points));
}

/**
 * §4.2 BasePower = log10(stake_in_ADA). 100,000 ADA → 5, 1,000,000 → 6, etc.
 * Clamped at 0 so a sub-1-ADA / zero stake never yields negative or -Infinity power.
 */
export function basePower(stakeLovelace: bigint): number {
  if (stakeLovelace <= 0n) return 0;
  const ada = Number(stakeLovelace) / Number(LOVELACE_PER_ADA);
  return Math.max(0, Math.log10(ada));
}

/** §4.2 MeritMultiplier = 1 + merit/200, so merit ∈ [-200,200] → multiplier ∈ [0,2]. */
export function meritMultiplier(meritPoints: number, max: number = MERIT_POINT_MAX): number {
  return 1 + clampMerit(meritPoints, max) / max;
}

/** §4.2 FinalPower = BasePower × MeritMultiplier. */
export function finalPower(stakeLovelace: bigint, meritPoints: number): number {
  return basePower(stakeLovelace) * meritMultiplier(meritPoints);
}


export interface TallyInput {
  /** Sum of FinalPower of voters who chose YES. */
  yesPower: number;
  /** Sum of FinalPower across ALL eligible voters (missing-no-avoid counts as implicit NO). */
  totalPower: number;
  /** Sum of FinalPower of voters who chose ABSTAIN (removed from denominator). */
  abstainPower: number;
  /** Approval threshold, e.g. 67 or 75. */
  thresholdPct: number;
}

/** §4.4 denominator = total − abstain. */
export function denominator(input: TallyInput): number {
  return input.totalPower - input.abstainPower;
}

/** §4.4 YES ratio against the abstain-adjusted denominator (0 if denominator is 0). */
export function approvalRatio(input: TallyInput): number {
  const denom = denominator(input);
  return denom <= 0 ? 0 : input.yesPower / denom;
}

/** §4.4 approved iff yes_power / (total_power − abstain_power) >= threshold. */
export function isApproved(input: TallyInput): boolean {
  return approvalRatio(input) >= input.thresholdPct / 100;
}
