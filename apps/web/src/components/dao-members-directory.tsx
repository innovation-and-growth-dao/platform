'use client';

import { useEffect, useMemo, useState } from 'react';
import { daoApi, submitterApi, type DaoMember, type DaoMemberDetail, type ApprovedSubmitter } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';
import { FallbackAvatar } from './fallback-avatar';
import { ClampedMarkdown } from './clamped-markdown';
import { Markdown } from './markdown';
import { useSubcategories } from '@/lib/subcategories';

/**
 * "DAO members" left-nav view: a directory of every current DAO member as a card grid.
 * Each card is a square photo + name + (Board chip) + DRep ID + bio preview. Clicking
 * the photo opens a full detail page (bio, voting power, merit, admission-vote tally,
 * socials/contact) with a back link to the grid. Board members are shown first.
 */
export function DaoMembersDirectory() {
  const t = useT();
  const [rows, setRows] = useState<DaoMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    daoApi.members().then(setRows).catch((e) => setError(e.message ?? String(e)));
  }, []);

  const ordered = useMemo(() => {
    if (!rows) return [];
    // Server orders by adjusted power. Hoist board members to the top while keeping
    // the relative order within each group; non-board stay power-sorted.
    const board = rows.filter((r) => r.isBoard);
    const rest = rows.filter((r) => !r.isBoard);
    return [...board, ...rest];
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (r) => r.displayName.toLowerCase().includes(q) || r.drepId.toLowerCase().includes(q),
    );
  }, [ordered, query]);

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {openId ? (
        <MemberDetail drepId={openId} onBack={() => setOpenId(null)} />
      ) : (
        <>
          <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{t('DAO members')}</h2>
              <p className="text-xs text-neutral-500">
                {t('Board members first, then admitted DReps. Click a photo to open the full profile.')}
              </p>
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search by name or DRep ID…')}
              className="w-full sm:w-72 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </header>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!rows ? (
            <p className="text-sm text-neutral-500">{t('Loading…')}</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-neutral-500">{t('No members match')} “{query}”.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((m) => (
                <MemberCard key={m.drepId} m={m} onOpen={() => setOpenId(m.drepId)} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MemberCard({ m, onOpen }: { m: DaoMember; onOpen: () => void }) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 transition hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900/60">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full focus:outline-none focus:ring-2 focus:ring-emerald-500"
        aria-label={`${t('Open profile of')} ${m.displayName}`}
      >
        <AspectSquare>
          <Avatar src={m.image} name={m.displayName} />
        </AspectSquare>
      </button>
      <div className="space-y-1 p-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpen}
            className="truncate text-left text-sm font-semibold hover:underline"
          >
            {m.displayName}
          </button>
          {m.isBoard ? (
            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              {t('Board')}
            </span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-neutral-500">
          {m.drepId.slice(0, 18)}…{m.drepId.slice(-6)}
        </div>
        <BioPreview drepId={m.drepId} />
      </div>
    </div>
  );
}

/**
 * BIO preview shown on each card. The list endpoint doesn't return bios (kept lean for
 * the directory), so we lazy-fetch per visible card. Cards that aren't opened won't
 * trigger a re-fetch on subsequent renders thanks to the local cache.
 */
const bioCache = new Map<string, string | null>();

function BioPreview({ drepId }: { drepId: string }) {
  const t = useT();
  const [bio, setBio] = useState<string | null | undefined>(() => bioCache.get(drepId));
  useEffect(() => {
    if (bioCache.has(drepId)) return;
    let cancelled = false;
    daoApi
      .member(drepId)
      .then((d) => {
        bioCache.set(drepId, d.bio);
        if (!cancelled) setBio(d.bio);
      })
      .catch(() => {
        bioCache.set(drepId, null);
        if (!cancelled) setBio(null);
      });
    return () => {
      cancelled = true;
    };
  }, [drepId]);
  if (bio === undefined) return <p className="line-clamp-4 text-xs text-neutral-400">{t('Loading bio…')}</p>;
  if (!bio) return <p className="line-clamp-4 text-xs italic text-neutral-400">{t('No bio provided.')}</p>;
  // Render the bio as markdown (bold/italic/headings/links) — the same way the full profile shows
  // it — instead of the raw source, so "**Objectives**" reads as bold, not literal asterisks.
  // Headings are flattened to the card's text size so a heading-first bio stays compact, and the
  // whole preview is height-clamped to ~4 lines.
  return (
    <div className="max-h-[4.75rem] overflow-hidden text-xs leading-relaxed text-neutral-600 dark:text-neutral-300 [&_h2]:mt-0 [&_h2]:text-xs [&_h3]:mt-0 [&_h3]:text-xs [&_h4]:mt-0 [&_h4]:text-xs [&_p]:my-0 [&_ul]:my-0 [&_ol]:my-0">
      <Markdown>{bio}</Markdown>
    </div>
  );
}

function MemberDetail({ drepId, onBack }: { drepId: string; onBack: () => void }) {
  const t = useT();
  const { drepUrl } = useExplorer();
  const [d, setD] = useState<DaoMemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    setError(null);
    daoApi.member(drepId).then(setD).catch((e) => setError(e.message ?? String(e)));
  }, [drepId]);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
      >
        ← {t('Back to DAO members')}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!d ? (
        <p className="text-sm text-neutral-500">{t('Loading…')}</p>
      ) : (
        <>
        {/* DRep ID: fully visible on one line (whole card width), linked to cexplorer, with copy. */}
        <div className="flex items-center gap-2 overflow-x-auto rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="shrink-0 text-[11px] font-medium text-neutral-500">{t('DRep ID:')}</span>
          <a href={drepUrl(d.drepId)} target="_blank" rel="noreferrer" className="whitespace-nowrap font-mono text-[11px] text-emerald-700 underline dark:text-emerald-400">{d.drepId}</a>
          <CopyButton text={d.drepId} label={t('Copy')} />
        </div>
        <div className="grid gap-6 md:grid-cols-[280px_1fr]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
              <AspectSquare>
                <Avatar src={d.image} name={d.displayName} />
              </AspectSquare>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{d.displayName}</h3>
                {d.isBoard ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {t('Board member')}
                  </span>
                ) : null}
                {/* §2 — also a submitter? show the (possibly different) submitter name. */}
                {d.isSubmitter ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" title={t('Also an approved submitter — can submit funding proposals')}>
                    {t('also a submitter')}{d.submitterName ? ` (${d.submitterName})` : ''}
                  </span>
                ) : null}
              </div>
              {/* §2 (board) — override this member's cross-wallet link to a submitter profile. */}
              <MemberLinkEditor d={d} onSaved={setD} />
            </div>
          </div>
          <div className="space-y-4">
            <Stats d={d} />
            <Activity d={d} />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Bio')}</div>
              <ClampedMarkdown className="mt-1 text-sm text-neutral-800 dark:text-neutral-200" empty={t('No bio provided.')} maxLines={15}>
                {d.bio}
              </ClampedMarkdown>
              <div className="mt-2 text-xs text-neutral-500">{t('Country:')} {d.country ? <span className="font-medium text-neutral-700 dark:text-neutral-300">{d.country}</span> : <span className="italic text-neutral-400">{t('not provided')}</span>}</div>
              {/* §2.1 — conflict-of-interest disclosure + pledge (transparency). */}
              <div className="mt-2 text-xs">
                <span className="font-medium">{t('Conflict of interest:')}</span>
                <ClampedMarkdown className="mt-0.5 text-neutral-600 dark:text-neutral-300" empty={t('not provided')} maxLines={15}>
                  {d.conflictOfInterest}
                </ClampedMarkdown>
              </div>
              <div className="mt-1 text-xs">
                {d.noSelfVotePledge
                  ? <span className="font-medium text-emerald-600">{t('✓ Pledged NOT to vote for own proposals')}</span>
                  : <span className="font-medium text-red-600">{t('✗ Has NOT pledged to abstain from voting on own proposals')}</span>}
              </div>
            </div>
            <Expertise ids={d.subcategoryIds} />
            <Links socials={d.socials} contact={d.contact} />
          </div>
        </div>
        </>
      )}
    </div>
  );
}

/** §2 (board) — set/clear this DAO member's cross-wallet link to a submitter profile. Board-only. */
function MemberLinkEditor({ d, onSaved }: { d: DaoMemberDetail; onSaved: (d: DaoMemberDetail) => void }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [submitters, setSubmitters] = useState<ApprovedSubmitter[]>([]);
  const [sel, setSel] = useState(d.linkedSubmitterUserId ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isBoard) submitterApi.directory().then(setSubmitters).catch(() => setSubmitters([])); }, [isBoard]);
  useEffect(() => { setSel(d.linkedSubmitterUserId ?? ''); }, [d.linkedSubmitterUserId]);
  if (!isBoard) return null;
  const save = async () => {
    setBusy(true);
    try { onSaved(await daoApi.setMemberLink(d.drepId, sel || null)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 rounded border border-dashed border-neutral-300 p-2 text-xs dark:border-neutral-700">
      <div className="font-medium text-neutral-500">{t('Board override: link to a submitter profile')}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={busy} className="rounded border border-neutral-300 px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
          <option value="">{t('— none —')}</option>
          {submitters.map((s) => <option key={s.userId} value={s.userId}>{s.displayName}</option>)}
        </select>
        <button type="button" disabled={busy || sel === (d.linkedSubmitterUserId ?? '')} onClick={save} className="rounded bg-emerald-600 px-2 py-1 font-medium text-white disabled:opacity-50">{t('Save')}</button>
      </div>
    </div>
  );
}

function Stats({ d }: { d: DaoMemberDetail }) {
  const t = useT();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3 lg:grid-cols-4">
      <Stat label={t('Voting power')} value={`${d.votingPowerAda.toLocaleString()} ₳`} />
      <Stat label={t('Delegators')} value={d.delegators.toLocaleString()} />
      <Stat label={t('Merit')} value={d.merit.toLocaleString()} />
      <Stat label={t('Adjusted power')} value={d.adjustedPower.toFixed(2)} />
      <Stat label={t('Member since')} value={d.since ? new Date(d.since).toLocaleDateString() : '—'} />
      {/* §8.2 — board-only opt-in flag (non-board always vote, so hidden for them). It's a
          flag, not an activity count, so it sits with the headline stats. */}
      {d.isBoard ? <Stat label={t('Votes on funding')} value={d.votesOnFundingProposals ? t('✓ yes') : t('✗ opted out')} /> : null}
    </dl>
  );
}

/** §13 — all of the member's governance participation, grouped side by side. Totals across
 *  every round for the lifetime of the profile. */
function Activity({ d }: { d: DaoMemberDetail }) {
  const t = useT();
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Activity')}</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={t('Admission votes cast')}
          value={d.isBoard ? `${d.admissionVotesCast.total} (${d.admissionVotesCast.yes} ${t('YES')} · ${d.admissionVotesCast.no} ${t('NO')})` : t('— (non-board)')}
        />
        <Stat label={t('Filtering reviews')} value={`${d.votingActivity.filtering.total} (${d.votingActivity.filtering.yes} ${t('YES')} · ${d.votingActivity.filtering.no} ${t('NO')})`} />
        <Stat label={t('Funding votes')} value={`${d.votingActivity.funding.total} (${d.votingActivity.funding.yes} ${t('YES')} · ${d.votingActivity.funding.no} ${t('NO')} · ${t('Abstain')} ${d.votingActivity.funding.abstain})`} />
        <Stat label={t('Milestone reviews')} value={`${d.votingActivity.milestone.total} (${d.votingActivity.milestone.yes} ${t('YES')} · ${d.votingActivity.milestone.no} ${t('NO')})`} />
        <Stat label={t('Internal proposal votes')} value={`${d.votingActivity.internal.total} (${d.votingActivity.internal.yes} ${t('YES')} · ${d.votingActivity.internal.no} ${t('NO')} · ${t('Abstain')} ${d.votingActivity.internal.abstain})`} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** The member's expertise as labelled chips (same subcategories they pick in their profile form). */
function Expertise({ ids }: { ids: string[] | null | undefined }) {
  const t = useT();
  const { labelOf } = useSubcategories();
  const list = (ids ?? []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Expertise')}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {list.map((id) => (
          <span key={id} className="rounded-full border border-emerald-300 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
            {labelOf(id)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Turn a stored contact/social value into a real href. Full URLs pass through; emails become
 *  mailto:, Telegram handles/usernames become t.me links, bare domains get https://. */
function linkHref(key: string, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const k = key.toLowerCase();
  if (k === 'email' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return `mailto:${v.replace(/^mailto:/i, '')}`;
  if (k === 'telegram' || v.startsWith('@')) return `https://t.me/${v.replace(/^@/, '')}`;
  if (/^[\w-]+\.[\w.-]+/.test(v)) return `https://${v}`; // bare domain
  return null;
}

function Links({ socials, contact }: { socials: Record<string, string> | null; contact: Record<string, string> | null }) {
  const t = useT();
  const all = [
    ...Object.entries(socials ?? {}),
    ...Object.entries(contact ?? {}),
  ].filter(([, v]) => v && v.trim());
  if (all.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Links')}</div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {all.map(([k, v]) => {
          const href = linkHref(k, v);
          return (
            <li key={k}>
              <span className="mr-1 text-neutral-500">{k}:</span>
              {href ? (
                <a
                  href={href}
                  target={href.startsWith('mailto:') ? undefined : '_blank'}
                  rel="noopener noreferrer"
                  className="font-mono text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {v}
                </a>
              ) : (
                <span className="font-mono text-neutral-700 dark:text-neutral-300">{v}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Square wrapper — matches the reference layout where the photo is the dominant card element. */
function AspectSquare({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full" style={{ paddingBottom: '100%' }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className="h-full w-full object-cover" />;
  }
  // §2.1 — universal placeholder: a funny black-and-white head, stable per name.
  return <FallbackAvatar name={name} className="h-full w-full object-cover" />;
}
