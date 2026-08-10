/**
 * §20 — the colour "tone" a proposal comment gets from its author's class, so the team can scan who
 * said what at a glance:
 *   - Expert                          → violet
 *   - DRep / DAO member / board member → grey
 *   - no special class                 → neutral
 *
 * The role strings match the backend's `roleOf` ('Board member' > 'Expert' > 'DAO member'); kept
 * pure + unit-tested so a backend label rename can't silently break the colouring.
 */
export function commentAuthorTone(role: string | null | undefined): 'violet' | 'grey' | 'neutral' {
  if (role === 'Expert') return 'violet';
  if (role === 'Board member' || role === 'DAO member') return 'grey';
  return 'neutral';
}
