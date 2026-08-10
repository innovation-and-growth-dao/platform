'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardSubmittersApi, type SubmitterApplication } from '@/lib/api';
import { ClampedMarkdown } from './clamped-markdown';
import { useT } from '@/lib/prefs-context';

/** §2.1 — board to-do: approve/reject submitter applications. Reject requires a reason (shown to the applicant). */
export function SubmitterReviewPanel({ onChange, history = false }: { onChange?: () => void; history?: boolean }) {
  const t = useT();
  const [apps, setApps] = useState<SubmitterApplication[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(() => { boardSubmittersApi.applications(history).then(setApps).catch(() => setApps([])); }, [history]);
  useEffect(() => { load(); }, [load]);

  const list = history ? apps : apps.filter((a) => a.status === 'PENDING');
  if (list.length === 0) return null;

  const approve = async (id: string) => {
    setBusy(id);
    try { await boardSubmittersApi.approve(id); load(); onChange?.(); }
    catch { /* */ } finally { setBusy(null); }
  };
  const doReject = async () => {
    if (!rejectId || !reason.trim()) return;
    setBusy(rejectId);
    try { await boardSubmittersApi.reject(rejectId, reason.trim()); setRejectId(null); setReason(''); load(); onChange?.(); }
    catch { /* */ } finally { setBusy(null); }
  };

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-base font-semibold">{t('Submitter applications')} ({list.length})</h3>
      <p className="text-xs text-neutral-500">{t('§2.1 — approve to let them submit proposals, or reject with a reason (the applicant sees it and can re-apply).')}</p>
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                {a.logoDataUrl ? <img src={a.logoDataUrl} alt="" className="h-8 w-8 rounded object-cover" /> : null}
                <span className="font-medium">{a.displayName}</span>
                <span className="text-xs text-neutral-500">{a.country}</span>
                {a.status === 'APPROVED' ? <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">✓ {t('APPROVED')}</span>
                  : a.status === 'REJECTED' ? <span className="rounded bg-red-100 px-1 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">{t('REJECTED')}</span> : null}
              </span>
              {a.status === 'PENDING' ? (
                <span className="flex gap-2">
                  <button onClick={() => approve(a.id)} disabled={busy === a.id} className="rounded border border-emerald-500 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300">{t('Approve')}</button>
                  <button onClick={() => { setRejectId(rejectId === a.id ? null : a.id); setReason(''); }} disabled={busy === a.id} className="rounded border border-red-500 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300">{t('Reject')}</button>
                </span>
              ) : null}
            </div>
            <div className="mt-1 break-all font-mono text-[11px] text-neutral-400">{a.stakeAddress}</div>
            <ClampedMarkdown className="mt-1 text-xs text-neutral-600 dark:text-neutral-300" empty="—" maxLines={15}>{a.description}</ClampedMarkdown>
            <div className="mt-1 text-xs"><span className="font-medium">GitHub:</span>{' '}
              {a.githubUrls.length ? a.githubUrls.map((g, i) => <a key={i} href={g} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{g}</a>) : <span className="text-neutral-400">{t('not provided')}</span>}
            </div>
            {a.previousFunding ? (
              <div className="mt-1 text-xs"><span className="font-medium">{t('Previous funding:')}</span>
                <ClampedMarkdown className="text-neutral-600 dark:text-neutral-300" empty="—" maxLines={15}>{a.previousFunding}</ClampedMarkdown>
              </div>
            ) : null}
            {/* §2.1 — disclosure + contact for the board's review. */}
            <div className="mt-1 text-xs">
              <span className="font-medium">{t('Conflict of interest:')}</span>
              <ClampedMarkdown className="text-neutral-600 dark:text-neutral-300" empty="—" maxLines={15}>{a.conflictOfInterest}</ClampedMarkdown>
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {a.noSelfVotePledge ? t('✓ pledges not to vote for own proposals') : t('no self-vote pledge given (informative)')}
              {' · '}{t('Telegram:')} <span className="font-mono">{a.telegram || '—'}</span>
              {' · '}{t('Email:')} <a href={`mailto:${a.email}`} className="text-emerald-700 underline dark:text-emerald-400">{a.email || '—'}</a>
            </div>
            <div className="mt-1 text-xs"><span className="font-medium">{t('Social media:')}</span>{' '}
              {a.socialLinks.length ? a.socialLinks.map((l, i) => <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>) : <span className="text-neutral-400">{t('not provided')}</span>}
            </div>
            {a.status === 'REJECTED' && a.rejectionReason ? <div className="mt-1 text-xs text-red-600">{t('Reason:')} {a.rejectionReason}</div> : null}
            {a.history.length > 0 ? (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-neutral-500">{t('Change history')} ({a.history.length})</summary>
                <ul className="mt-1 space-y-1">
                  {a.history.map((h, i) => (
                    <li key={i} className="rounded border border-neutral-200 p-1.5 dark:border-neutral-800">
                      <div className="text-neutral-400">{t('Replaced')} {new Date(h.snapshotAt).toLocaleString()}</div>
                      <div className="flex items-center gap-2">
                        {h.logoDataUrl ? <img src={h.logoDataUrl} alt="" className="h-6 w-6 rounded object-cover" /> : null}
                        <span className="font-medium">{h.displayName}</span> · {h.country}
                      </div>
                      <div className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{h.description}</div>
                      {h.conflictOfInterest ? <div className="mt-0.5"><span className="font-medium">{t('Conflict of interest:')}</span> <span className="whitespace-pre-wrap">{h.conflictOfInterest}</span></div> : null}
                      <div className="mt-0.5 text-neutral-500">
                        {h.noSelfVotePledge ? t('✓ no-self-vote pledge') : t('no self-vote pledge')}
                        {h.telegram ? <> · {t('Telegram:')} <span className="font-mono">{h.telegram}</span></> : null}
                        {h.email ? <> · {t('Email:')} {h.email}</> : null}
                      </div>
                      {(h.githubUrls?.length || h.socialLinks?.length) ? (
                        <div className="mt-0.5 flex flex-wrap gap-2">
                          {[...(h.githubUrls ?? []), ...(h.socialLinks ?? [])].map((l, j) => <span key={j} className="break-all text-neutral-500">{l}</span>)}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {rejectId === a.id ? (
              <div className="mt-2 space-y-1">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('Reason (shown to the applicant)…')} className="w-full rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900" />
                <div className="flex gap-2">
                  <button onClick={doReject} disabled={busy === a.id || !reason.trim()} className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50">{t('Confirm reject')}</button>
                  <button onClick={() => { setRejectId(null); setReason(''); }} className="rounded border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-700">{t('Cancel')}</button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
