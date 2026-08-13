import { describe, expect, it } from 'vitest';
import { blockfrostDrepStatus, blockfrostLovelace } from './blockfrost-map';

describe('blockfrostDrepStatus — must match Koios registration semantics', () => {
  // Real Preprod DRep observed as active:false on Koios (→ not registered) and
  // active:true, expired:true on Blockfrost. Both must resolve to NOT registered.
  it('treats an expired DRep as NOT registered (matches Koios active:false)', () => {
    const s = blockfrostDrepStatus({ hex: '22f0ed00410031f3288d7889aa896cfdad79a7441885d3bae8982ac151', amount: '11750133037', active: true, retired: false, expired: true });
    expect(s.registered).toBe(false);
    // header byte (0x22) stripped → 28-byte / 56-char key hash, matching Koios' hex.
    expect(s.keyHashHex).toBe('f0ed00410031f3288d7889aa896cfdad79a7441885d3bae8982ac151');
    expect(s.keyHashHex).toHaveLength(56);
    expect(s.amountLovelace).toBe(11750133037n);
  });

  it('registers a live, non-expired, non-retired DRep', () => {
    const s = blockfrostDrepStatus({ hex: 'aa'.repeat(28), amount: '1000000', active: true, retired: false, expired: false });
    expect(s.registered).toBe(true);
    expect(s.keyHashHex).toBe('aa'.repeat(28)); // already 56 chars → unchanged
  });

  it('does not register a retired DRep', () => {
    expect(blockfrostDrepStatus({ hex: 'ab'.repeat(28), amount: '0', active: false, retired: true, expired: false }).registered).toBe(false);
  });

  it('is defensive about missing / malformed fields', () => {
    const s = blockfrostDrepStatus({});
    expect(s).toEqual({ registered: false, keyHashHex: null, amountLovelace: 0n });
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
