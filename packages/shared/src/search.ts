/**
 * §UI — case-insensitive client-side search across a proposal's Title, Proposer name, and
 * public Proposal ID. An empty/blank query matches everything. `extra` lets a caller feed
 * additional searchable text (e.g. a board action's description / recipient names).
 *
 * Each whitespace-separated term must match at least one field (so "tool great" finds
 * "Dave's great tool"); a single term stays a plain substring match.
 */
export function matchesProposalSearch(
  query: string | undefined,
  fields: { title?: string | null; proposer?: string | null; publicId?: string | null; extra?: (string | null | undefined)[] },
): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return true;
  const haystacks = [fields.title, fields.proposer, fields.publicId, ...(fields.extra ?? [])]
    .map((f) => (f ?? '').toLowerCase());
  return q.split(/\s+/).every((term) => haystacks.some((f) => f.includes(term)));
}
