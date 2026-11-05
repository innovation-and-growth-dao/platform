import { describe, expect, it } from 'vitest';
import { blockfrostDrepStatus, blockfrostLovelace } from './blockfrost-map';

describe('blockfrostDrepStatus — registration vs activity are separate', () => {
  // Real Preprod DRep observed as active:false on Koios and active:true, expired:true on
  // Blockfrost. It is still REGISTERED (no dereg cert) — only its activity window lapsed, so
  // registered:true but active:false. The platform must not reject it as "not a DRep".
  it('treats an expired DRep as registered but NOT active (matches Koios drep_status:registered)', () => {
    const s = blockfrostDrepStatus({ hex: '22f0ed00410031f3288d7889aa896cfdad79a7441885d3bae8982ac151', amount: '11750133037', active: true, retired: false, expired: true });
    expect(s.registered).toBe(true);
    expect(s.active).toBe(false);
    // header byte (0x22) stripped → 28-byte / 56-char key hash, matching Koios' hex.
    expect(s.keyHashHex).toBe('f0ed00410031f3288d7889aa896cfdad79a7441885d3bae8982ac151');
    expect(s.keyHashHex).toHaveLength(56);
    expect(s.amountLovelace).toBe(11750133037n);
  });

  it('registers AND activates a live, non-expired, non-retired DRep', () => {
    const s = blockfrostDrepStatus({ hex: 'aa'.repeat(28), amount: '1000000', active: true, retired: false, expired: false });
    expect(s.registered).toBe(true);
    expect(s.active).toBe(true);
    expect(s.keyHashHex).toBe('aa'.repeat(28)); // already 56 chars → unchanged
  });

  it('does not register (nor activate) a retired DRep', () => {
    const s = blockfrostDrepStatus({ hex: 'ab'.repeat(28), amount: '0', active: false, retired: true, expired: false });
    expect(s.registered).toBe(false);
    expect(s.active).toBe(false);
  });

  it('is defensive about missing / malformed fields', () => {
    const s = blockfrostDrepStatus({});
    expect(s).toEqual({ registered: false, active: false, keyHashHex: null, amountLovelace: 0n });
    expect(blockfrostDrepStatus({ hex: 'aa'.repeat(28), amount: 'not-a-number', active: true, retired: false, expired: false }).amountLovelace).toBe(0n);
  });
});

describe('blockfrostLovelace', () => {
  it('sums only the lovelace unit', () => {
    expect(blockfrostLovelace([{ unit: 'lovelace', quantity: '100' }, { unit: 'abc123', quantity: '5' }, { unit: 'lovelace', quantity: '50' }])).toBe(150n);
  });
  it('handles empty / undefined', () => {
    expect(blockfrostLovelace(undefined)).toBe(0n);
    expect(blockfrostLovelace([])).toBe(0n);
  });
});
