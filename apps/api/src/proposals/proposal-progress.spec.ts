import { describe, it, expect } from 'vitest';
import { rejectedProgress } from './proposal-progress';

describe('rejectedProgress (§7.4/§16 — submitter rejection notice)', () => {
  it('flags a filtering rejection as revisable while the round is still in FILTERING', () => {
    const r = rejectedProgress('FILTERING', 'FILTERING', null);
    expect(r.tone).toBe('red');
    expect(r.label).toContain('resubmit'); // → counted by the My-proposals badge
  });

  it('marks a filtering rejection final once the round has moved past FILTERING', () => {
    const r = rejectedProgress('FILTERING', 'DEBATE', null);
    expect(r.tone).toBe('red');
    expect(r.label).not.toContain('resubmit'); // no longer revisable → not badged
  });

  it('flags a fee rejection as revisable during SUBMISSION (stage null + fee feedback)', () => {
    const r = rejectedProgress(null, 'SUBMISSION', 'pay the full fee');
    expect(r.label).toContain('resubmit');
  });

  it('treats a Debate & Vote rejection (stage null, no fee feedback) as final', () => {
    const r = rejectedProgress(null, 'VOTE', null);
    expect(r.tone).toBe('red');
    expect(r.label).not.toContain('resubmit');
    expect(r.label).toContain('Debate & Vote');
  });

  it('does NOT read a finalized D&V loss as a fee rejection, even with an admission fee note', () => {
    // A proposal admitted with a "paid" note, then budget-cut in D&V: stage nulled by finalize,
    // result finalized. It must read as a Debate & Vote loss, not a fee rejection.
    const r = rejectedProgress(null, 'TALLY', 'paid', new Date());
    expect(r.stage).toBe('DV');
    expect(r.label).toContain('Debate & Vote');
  });
});
