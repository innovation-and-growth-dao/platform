'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardExpertsApi, type ExpertApplication } from '@/lib/api';
import { ClampedMarkdown } from './clamped-markdown';
import { useT } from '@/lib/prefs-context';

/** Board-only: review Expert applications (§2 — approved by the board). `history` also shows
 *  already-approved experts (done); rejected applications are deleted, so they leave no record. */
export function ExpertReviewPanel({ history = false }: { history?: boolean }) {
  const t = useT();
  const [apps, setApps] = useState<ExpertApplication[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    boardExpertsApi.applications(history).then(setApps).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [history]);
  useEffect(load, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(id);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">
        {t('Board — Expert applications')}{' '}
        <span className="text-sm font-normal text-neutral-500">({apps.filter((a) => !a.approved).length} {t('pending')})</span>
      </h3>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {apps.length === 0 ? (
        <p className="text-sm text-neutral-500">{history ? t('No expert applications.') : t('No pending expert applications.')}</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => (
            <li key={a.id} className={`rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800 ${a.approved ? 'opacity-70' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.displayName}</span>
                {a.approved ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    ✓ {t('APPROVED')}
                  </span>
                ) : null}
              </div>
              <div className="font-mono text-xs text-neutral-500 break-all">{a.stakeAddress}</div>
              {a.bio ? <div className="mt-1 text-neutral-600 dark:text-neutral-400"><ClampedMarkdown maxLines={15}>{a.bio}</ClampedMarkdown></div> : null}
              {a.motivation ? (
                <div className="mt-1 text-xs">
                  <span className="font-medium text-neutral-500">{t('Motivation / area of help:')}</span>
                  <ClampedMarkdown className="text-neutral-600 dark:text-neutral-400" maxLines={15}>{a.motivation}</ClampedMarkdown>
                </div>
              ) : null}
              {a.conflictOfInterest ? (
                <div className="mt-1 text-xs">
                  <span className="font-medium text-neutral-500">{t('Conflict of interest:')}</span>
                  <ClampedMarkdown className="text-neutral-600 dark:text-neutral-400" maxLines={15}>{a.conflictOfInterest}</ClampedMarkdown>
                </div>
              ) : null}
              {a.subcategoryIds.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {a.subcategoryIds.map((s) => (
                    <span key={s} className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
              {/* §2 — contact + social + wallet identity for the board's review. */}
              <div className="mt-1 text-xs text-neutral-500">
                {t('Telegram:')} <span className="font-mono">{a.telegram || '—'}</span>
                {' · '}{t('Email:')} {a.email ? <a href={`mailto:${a.email}`} className="text-emerald-700 underline dark:text-emerald-400">{a.email}</a> : '—'}
              </div>
              {a.socialLinks.length ? (
                <div className="mt-0.5 text-xs"><span className="font-medium text-neutral-500">{t('Social media:')}</span>{' '}
                  {a.socialLinks.map((l, i) => <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>)}
                </div>
              ) : null}
              {a.drepIdOnchain ? (
                <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-400">{t('DRep ID:')} {a.drepIdOnchain}</div>
              ) : null}
              {/* Approved experts are read-only history — no action buttons. */}
              {a.approved ? null : (
                <div className="mt-2 flex gap-3">
                  <button
                    disabled={busy === a.id}
                    onClick={() => act(a.id, () => boardExpertsApi.approve(a.id))}
                    className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  >
                    {t('Approve')}
                  </button>
                  <button
                    disabled={busy === a.id}
                    onClick={() => act(a.id, () => boardExpertsApi.reject(a.id))}
                    className="rounded border border-red-400 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
                  >
                    {t('Reject')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
