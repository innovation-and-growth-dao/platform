/**
 * §22 — pure mappers from Blockfrost API rows to the shapes CardanoQueryService returns.
 * Kept free of HTTP/Prisma so the field mapping (which must match Koios/db-sync EXACTLY —
 * a mismatch would recognise a DRep on one source but not another) is unit-testable.
 */

export interface DRepStatusShape {
  registered: boolean; // live registration (not retired/deregistered); independent of the activity window
  active: boolean; // registered AND not expired (activity window not lapsed)
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
 * `registered` = a live, non-retired registration — matching Koios (`drep_status==='registered'`)
 * and db-sync (latest cert is a registration, not a dereg). It is INDEPENDENT of the CIP-1694
 * activity window: a DRep that stops voting goes inactive/expired WITHOUT any certificate but stays
 * registered. `active` additionally requires not-expired (Koios `active:true`). Blockfrost splits
 * this as `active` (registered & not retired) + a separate `expired`, so registered = active &
 * !retired, and active(ours) = registered & !expired. Keeping registration and activity separate
 * lets the platform recognise a registered-but-inactive DRep instead of rejecting it as "not a DRep".
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
  // Blockfrost `active` = registered & not retired (does NOT account for expiry); `expired` is
  // separate. So `registered` (live registration) ignores expiry; `active` additionally requires
  // not expired — matching Koios (drep_status registered) and db-sync (latest cert is a reg).
  const registered = row.active === true && row.retired !== true;
  const active = registered && row.expired !== true;
  return { registered, active, keyHashHex, amountLovelace };
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
