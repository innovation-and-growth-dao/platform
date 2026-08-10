import { describe, it, expect } from 'vitest';
import { commentAuthorTone } from './comments';

describe('commentAuthorTone (§20 — comment colour by author class)', () => {
  it('experts are violet', () => {
    expect(commentAuthorTone('Expert')).toBe('violet');
  });

  it('DReps and board members are grey', () => {
    expect(commentAuthorTone('Board member')).toBe('grey');
    expect(commentAuthorTone('DAO member')).toBe('grey'); // admitted DRep
  });

  it('no recognised class is neutral', () => {
    expect(commentAuthorTone(null)).toBe('neutral');
    expect(commentAuthorTone(undefined)).toBe('neutral');
    expect(commentAuthorTone('Team')).toBe('neutral');
  });
});
