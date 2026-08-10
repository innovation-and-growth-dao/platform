/**
 * §20 — who may POST a comment on a proposal: the proposal's own team, plus any signed-in board
 * member, DRep, DAO member, or APPROVED expert. Viewers may read only.
 *
 * The expert role is exactly `'EXPERT'`, granted only once the board approves the expert and they
 * haven't left (see users.service). There is no `'EXPERT_APPROVED'` role — that earlier typo wrongly
 * blocked approved experts, which this helper (pure + unit-tested) prevents from regressing.
 */
const COMMENTER_ROLES = ['BOARD', 'DREP', 'DAO_MEMBER', 'EXPERT'];

export function canCommentOnProposal(roles: string[] | undefined | null, isTeamMember: boolean): boolean {
  if (isTeamMember) return true;
  return (roles ?? []).some((r) => COMMENTER_ROLES.includes(r));
}
