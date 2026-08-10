/**
 * On-chain anchoring metadata schema (§23.2). Metadata label 80808080 is
 * reserved for the DAO. The hash (`h`) commits to canonical preimage data so a
 * DRep can independently recompute and verify it (§23.5).
 */
import type { AnchorKind } from '@drep-dao/shared';

export const ANCHOR_METADATA_LABEL = 80808080;

export interface AnchorMetadata {
  /** schema version */
  v: 1;
  /** anchor kind */
  k: AnchorKind;
  /** round id (if applicable) */
  r?: string | null;
  /** proposal id (if applicable) */
  p?: string | null;
  /** the hash being anchored (0x-prefixed sha256 or merkle root) */
  h: string;
  /** ISO-8601 UTC timestamp */
  ts: string;
  /** verification URL on the platform */
  u: string;
}

/** Build the metadata object posted under label 80808080. */
export function buildAnchorMetadata(meta: AnchorMetadata): Record<string, AnchorMetadata> {
  return { [ANCHOR_METADATA_LABEL]: meta };
}
