import { describe, it, expect, vi } from 'vitest';

// Keep CSL / signature / query modules out of the import graph for this pure-logic test.
vi.mock('../cardano/anchor.service', () => ({ AnchorService: class {} }));
vi.mock('../cardano/cardano-query.service', () => ({ CardanoQueryService: class {} }));
vi.mock('../auth/cip30', () => ({ verifyCip30Signature: () => true }));

import { DrepService } from './drep.service';

type WithAssert = { assertContact: (c: Record<string, unknown> | undefined) => void };
const svc = new DrepService({} as never, {} as never, {} as never) as never as WithAssert;

describe('DrepService.assertContact — §14.3 mandatory Telegram + email', () => {
  it('requires a Telegram handle', () => {
    expect(() => svc.assertContact({ email: 'a@b.co' })).toThrow(/Telegram/i);
  });
  it('requires an email', () => {
    expect(() => svc.assertContact({ telegram: '@alice' })).toThrow(/email/i);
  });
  it('rejects a malformed email', () => {
    expect(() => svc.assertContact({ telegram: '@alice', email: 'not-an-email' })).toThrow(/email/i);
  });
  it('rejects an empty/undefined contact', () => {
    expect(() => svc.assertContact(undefined)).toThrow(/Telegram/i);
    expect(() => svc.assertContact({})).toThrow(/Telegram/i);
  });
  it('passes when both a Telegram handle and a valid email are present', () => {
    expect(() => svc.assertContact({ telegram: '@alice', email: 'alice@example.org' })).not.toThrow();
  });
});
