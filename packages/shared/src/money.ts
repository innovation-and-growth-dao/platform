/**
 * Single source of truth for ADA ↔ lovelace conversion. Every BigInt money column in the
 * DB stores LOVELACE; user-facing numbers are ADA. (Was re-declared per service — D25.)
 */
export const LOVELACE_PER_ADA = 1_000_000;

export const toLovelace = (ada: number): bigint => BigInt(Math.round(ada * LOVELACE_PER_ADA));

export const toAda = (lovelace: bigint | number | null | undefined): number =>
  lovelace == null ? 0 : Number(lovelace) / LOVELACE_PER_ADA;
