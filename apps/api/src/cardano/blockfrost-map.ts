/**
 * §22 — pure mappers from Blockfrost API rows to the shapes CardanoQueryService returns.
 * Kept free of HTTP/Prisma so the field mapping (which must match Koios/db-sync EXACTLY —
 * a mismatch would recognise a DRep on one source but not another) is unit-testable.
 */

export interface DRepStatusShape {
  registered: boolean;
  keyHashHex: string | null;
  amountLovelace: bigint;
}

/** Blockfrost `GET /governance/dreps/{drep_id}` row. */
export interface BlockfrostDRepRow {
  hex?: string | null;
  amount?: string | null;
  active?: boolean | null;
  retired?: boolean | null;
  expired?: boolean | null;
}

/**
 * A DRep is "registered" for the platform only if it's a live, non-retired, **non-expired**
 * DRep — the same rule Koios enforces (`drep_status==='registered' && active===true`, where
 * Koios's `active` means "not expired"). Blockfrost splits that into `active` (registered &
 * not retired) + `expired`, so all three must be checked.
 *
 * Blockfrost's `hex` includes the CIP-129 header byte (29 bytes / 58 hex chars); Koios/db-sync
 * return the raw 28-byte key hash, so we strip the header for a matching keyHashHex.
 */
export function blockfrostDrepStatus(row: BlockfrostDRepRow): DRepStatusShape {
  const hex = (row.hex ?? '').toLowerCase();
  const keyHashHex = hex ? (hex.length === 58 ? hex.slice(2) : hex) : null;
  let amountLovelace = 0n;
  try {
    amountLovelace = row.amount ? BigInt(row.amount) : 0n;
  } catch {
    amountLovelace = 0n;
  }
  const registered = row.active === true && row.retired !== true && row.expired !== true;
  return { registered, keyHashHex, amountLovelace };
}

/** Sum of lovelace across a Blockfrost `amount` array (e.g. address balance), lovelace unit only. */
export function blockfrostLovelace(amounts: { unit: string; quantity: string }[] | undefined): bigint {
  let sum = 0n;
  for (const a of amounts ?? []) {
    if (a.unit !== 'lovelace') continue;
    try { sum += BigInt(a.quantity); } catch { /* skip */ }
  }
  return sum;
}
