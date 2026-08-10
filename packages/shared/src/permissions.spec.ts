import { describe, it, expect } from 'vitest';
import { canCommentOnProposal } from './permissions';

describe('canCommentOnProposal (§20 — who can post a comment)', () => {
  it('lets an APPROVED expert (role EXPERT) post — the original bug', () => {
    expect(canCommentOnProposal(['EXPERT'], false)).toBe(true);
    // login profiles often carry a viewer role alongside the real one
    expect(canCommentOnProposal(['VIEWER', 'EXPERT'], false)).toBe(true);
  });

  it('lets board / DReps / DAO members post', () => {
    expect(canCommentOnProposal(['BOARD'], false)).toBe(true);
    expect(canCommentOnProposal(['DREP'], false)).toBe(true);
    expect(canCommentOnProposal(['DAO_MEMBER'], false)).toBe(true);
  });

  it('lets the proposal team post regardless of role', () => {
    expect(canCommentOnProposal([], true)).toBe(true);
    expect(canCommentOnProposal(['VIEWER'], true)).toBe(true);
  });

  it('blocks viewers / role-less / pending experts (no EXPERT role) who are not the team', () => {
    expect(canCommentOnProposal(['VIEWER'], false)).toBe(false);
    expect(canCommentOnProposal([], false)).toBe(false);
    expect(canCommentOnProposal(undefined, false)).toBe(false);
    // the bogus role that caused the bug must NOT grant posting
    expect(canCommentOnProposal(['EXPERT_APPROVED'], false)).toBe(false);
  });
});
