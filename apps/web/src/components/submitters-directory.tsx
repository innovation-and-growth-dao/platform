'use client';

import { useEffect, useState } from 'react';
import { submitterApi, daoApi, boardSubmittersApi, type ApprovedSubmitter, type SubmitterPortfolio, type DaoMember } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { useAuth } from '@/lib/auth-context';
import { card } from '@/lib/ui';
import { FallbackAvatar } from './fallback-avatar';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';
import { StatusBadge, PROPOSAL_STATUS_CLS } from './round-ui';
import { ClampedMarkdown } from './clamped-markdown';

/**
 * §2.1 — public directory of APPROVED submitters (mirrors the DAO members overview).
 * Click a row to open the FULL profile (photo — or a universal B/W placeholder head —
 * description, country, conflict-of-interest, pledge, contact, every link). A submitter
 * who is ALSO a DAO member is flagged prominently: they both submit and vote.
 */
export function SubmittersDirectory() {
  const t = useT();
  const { drepUrl } = useExplorer();
  const [rows, setRows] = useState<ApprovedSubmitter[] | null>(null);
  // §2.1/§14 — applications awaiting board approval (queue up during the pre-election free period).
  const [pending, setPending] = useState<{ count: number; boardElected: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // §2.1 — deregistered profiles stay in the history; show them on demand.
  const [showLeft, setShowLeft] = useState(false);
  const reload = () => { submitterApi.directory(showLeft).then(setRows).catch(() => setRows([])); };
  useEffect(() => {
    setRows(null);
    submitterApi.directory(showLeft).then(setRows).catch(() => setRows([]));
  }, [showLeft]);
  useEffect(() => {
    submitterApi.pendingCount().then(setPending).catch(() => setPending(null));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Submitters')}</h2>
        <p className="text-sm text-neutral-500">
          {t('Approved submitters — accounts allowed to submit funding proposals. Click a row for the full profile. Submitters who are also DAO members (they vote, too) are flagged.')}
        </p>
      </div>
      {/* §2.1/§14 — pending applications always need BOARD approval; during the pre-election
          free period they queue here until the first board exists to approve them. */}
      {pending && pending.count > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <strong>{pending.count}</strong> {pending.count === 1 ? t('application waiting for board approval.') : t('applications waiting for board approval.')}
          {!pending.boardElected ? <> {t('The board has not been elected yet — they will be approved once a board is in place.')}</> : null}
        </div>
      ) : null}
      <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
        {t('Show deleted accounts (submitters who left — profiles are kept in the history)')}
      </label>
      {rows === null ? <p className="text-sm text-neutral-500">{t('Loading…')}</p> : null}
      {rows?.length === 0 ? <p className="text-sm text-neutral-500">{t('No approved submitters yet.')}</p> : null}
      <div className="space-y-3">
        {rows?.map((s) => {
          const open = openId === s.id;
          return (
            <section key={s.id} className={card}>
              <button onClick={() => setOpenId(open ? null : s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span className="flex items-center gap-2">
                  {s.logoDataUrl
                    ? <img src={s.logoDataUrl} alt="" className="h-9 w-9 rounded object-cover" />
                    : <FallbackAvatar name={s.displayName} className="h-9 w-9 rounded" />}
                  <span className="font-medium">{s.displayName}</span>
                  {s.country ? <span className="text-xs text-neutral-500">{s.country}</span> : null}
                  {s.status === 'LEFT' ? (
                    <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" title={s.leftAt ? `${t('left')} ${new Date(s.leftAt).toLocaleDateString()}` : t('left the platform')}>
                      {t('left')}{s.leftAt ? ` ${new Date(s.leftAt).toLocaleDateString()}` : ''}
                    </span>
                  ) : null}
                  {s.isDaoMember ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200" title={t('This submitter also votes on funding proposals')}>
                      {t('⚠ also a DAO member')}{s.daoMemberName ? ` (${s.daoMemberName})` : ''}
                    </span>
                  ) : null}
                  {s.noSelfVotePledge ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t('✓ no self-vote pledge')}</span> : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-neutral-400">
                  {s.since ? <span>{t('approved')} {new Date(s.since).toLocaleDateString()}</span> : null}
                  <span>{open ? '▴' : '▾'}</span>
                </span>
              </button>

              {open ? (
                <div className="mt-3 flex flex-wrap gap-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                  {s.logoDataUrl
                    ? <img src={s.logoDataUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
                    : <FallbackAvatar name={s.displayName} className="h-24 w-24 rounded-lg" />}
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Description')}</div>
                      <ClampedMarkdown className="mt-0.5 text-neutral-700 dark:text-neutral-300" empty="—" maxLines={15}>{s.description}</ClampedMarkdown>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Previous funding')}</div>
                      <ClampedMarkdown className="mt-0.5 text-neutral-700 dark:text-neutral-300" empty={t('— none declared —')} maxLines={15}>{s.previousFunding}</ClampedMarkdown>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Conflict of interest')}</div>
                      <ClampedMarkdown className="mt-0.5 text-neutral-700 dark:text-neutral-300" empty="—" maxLines={15}>{s.conflictOfInterest}</ClampedMarkdown>
                    </div>
                    <div className="text-xs text-neutral-600 dark:text-neutral-300">
                      <span className="font-medium">{t('Pledge:')}</span> {s.noSelfVotePledge ? t('✓ will not vote for own proposals') : t('no self-vote pledge given (informative)')}
                      {s.isDaoMember ? <span className="ml-2 font-medium text-amber-700 dark:text-amber-300">{t('⚠ this submitter is also a DAO member and votes on funding')}</span> : null}
                    </div>
                    {/* §2 (board) — override this submitter's cross-wallet link to a DAO member. */}
                    <SubmitterLinkEditor s={s} onSaved={reload} />
                    <div className="text-xs">
                      <span className="font-medium">{t('Contact:')}</span>{' '}
                      {s.telegram ? <span className="font-mono">{s.telegram}</span> : '—'}
                      {' · '}
                      {s.email ? <a href={`mailto:${s.email}`} className="text-emerald-700 underline dark:text-emerald-400">{s.email}</a> : '—'}
                    </div>
                    {/* The platform knows the wallet — surface the on-chain identity. */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium">{t('Wallet (stake):')}</span>
                      <span className="break-all font-mono text-neutral-600 dark:text-neutral-300">{s.stakeAddress}</span>
                      <CopyButton text={s.stakeAddress} label={t('Copy')} />
                    </div>
                    {s.drepIdOnchain ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium">{t('DRep ID:')}</span>
                        <a href={drepUrl(s.drepIdOnchain)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">{s.drepIdOnchain}</a>
                        <CopyButton text={s.drepIdOnchain} label={t('Copy')} />
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Links')}</div>
                      <div className="mt-0.5 space-y-0.5 text-xs">
                        <div>
                          <span className="font-medium">{t('GitHub:')}</span>{' '}
                          {s.githubUrls.length
                            ? s.githubUrls.map((l, i) => (
                                <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>
                              ))
                            : <span className="text-neutral-400">{t('not provided')}</span>}
                        </div>
                        <div>
                          <span className="font-medium">{t('Social media:')}</span>{' '}
                          {s.socialLinks.length
                            ? s.socialLinks.map((l, i) => (
                                <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>
                              ))
                            : <span className="text-neutral-400">{t('not provided')}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* §2.1 — full funding-proposal portfolio + headline stats. */}
                  <div className="w-full border-t border-neutral-200 pt-3 dark:border-neutral-800">
                    <SubmitterPortfolioSection submitterId={s.id} />
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** §2.1 — a submitter's funding proposals (status + round) and the headline numbers:
 *  how many submitted, total requested, granted budget, paid so far, completed,
 *  in-progress + milestones still missing. Lazy-loaded when the profile opens. */
function SubmitterPortfolioSection({ submitterId }: { submitterId: string }) {
  const t = useT();
  const { setParams } = useUrlNav();
  const [data, setData] = useState<SubmitterPortfolio | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    submitterApi.portfolio(submitterId).then((d) => alive && setData(d)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [submitterId]);

  if (error) return <p className="text-xs text-red-600">{t('Couldn’t load this submitter’s proposals.')}</p>;
  if (!data) return <p className="text-xs text-neutral-500">{t('Loading proposals…')}</p>;

  const { stats, proposals } = data;
  const ada = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ₳`;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Funding proposals')}</div>

      {/* Headline stats. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <Stat label={t('Submitted')} value={String(stats.submitted)} />
        <Stat label={t('Requested')} value={ada(stats.requestedAda)} />
        <Stat label={t('Granted budget')} value={ada(stats.approvedAda)} hint={t('proposals that were approved for funding')} />
        <Stat label={t('Paid so far')} value={ada(stats.paidAda)} hint={t('sent after delivered milestones')} />
        <Stat label={t('Completed')} value={String(stats.completed)} />
        <Stat
          label={t('In progress')}
          value={String(stats.inProgress)}
          hint={`${stats.missingMilestones} ${stats.missingMilestones === 1 ? t('milestone still to deliver') : t('milestones still to deliver')}`}
        />
        <Stat label={t('Rejected')} value={String(stats.rejected)} hint={t('proposals turned down at filtering or Debate & Vote')} />
      </div>
      {stats.inProgress > 0 ? (
        <p className="text-[11px] text-neutral-500">
          {stats.inProgress} {stats.inProgress === 1 ? t('funded proposal not yet completed —') : t('funded proposals not yet completed —')}{' '}
          <span className="font-medium text-amber-700 dark:text-amber-300">{stats.missingMilestones} {stats.missingMilestones === 1 ? t('milestone still missing') : t('milestones still missing')}</span>.
        </p>
      ) : null}

      {/* Per-proposal list. */}
      {proposals.length === 0 ? (
        <p className="text-xs text-neutral-500">{t('No funding proposals submitted yet.')}</p>
      ) : (
        <ul className="space-y-1.5">
          {proposals.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setParams({ proposal: p.id })}
                className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:border-emerald-400 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.publicId ? <span className="mr-2 font-mono text-xs text-neutral-500">{p.publicId}</span> : null}
                    {p.title}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-neutral-500">
                    {p.roundNumber != null ? (
                      <span>{t('Round #')}{p.roundNumber}{p.roundName ? ` — ${p.roundName}` : ''}</span>
                    ) : <span className="italic text-neutral-400">{t('no round')}</span>}
                    <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} />
                  </span>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {p.requestedAda > 0 ? `${t('Requested')} ${ada(p.requestedAda)}` : t('no budget set')}
                  {p.milestonesTotal > 0 ? ` · ${t('milestones')} ${p.milestonesPaid}/${p.milestonesTotal} ${t('paid')} · ${ada(p.paidAda)} ${t('received')}` : ''}
                  {p.stage ? ` · ${t('stage')} ${p.stage}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 px-2.5 py-1.5 dark:border-neutral-800" title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** §2 (board) — set/clear this submitter's cross-wallet link to a DAO-member profile. Board-only. */
function SubmitterLinkEditor({ s, onSaved }: { s: ApprovedSubmitter; onSaved: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [members, setMembers] = useState<DaoMember[]>([]);
  const [sel, setSel] = useState(s.daoMemberDrepId ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isBoard) daoApi.members().then(setMembers).catch(() => setMembers([])); }, [isBoard]);
  useEffect(() => { setSel(s.daoMemberDrepId ?? ''); }, [s.daoMemberDrepId]);
  if (!isBoard) return null;
  const save = async () => {
    setBusy(true);
    try { await boardSubmittersApi.setLink(s.id, sel || null); onSaved(); } finally { setBusy(false); }
  };
  return (
    <div className="mt-1 rounded border border-dashed border-neutral-300 p-2 text-xs dark:border-neutral-700">
      <div className="font-medium text-neutral-500">{t('Board override: link to a DAO-member profile')}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={busy} className="rounded border border-neutral-300 px-1.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900">
          <option value="">{t('— none —')}</option>
          {members.map((m) => <option key={m.drepId} value={m.drepId}>{m.displayName}</option>)}
        </select>
        <button type="button" disabled={busy || sel === (s.daoMemberDrepId ?? '')} onClick={save} className="rounded bg-emerald-600 px-2 py-1 font-medium text-white disabled:opacity-50">{t('Save')}</button>
      </div>
    </div>
  );
}
