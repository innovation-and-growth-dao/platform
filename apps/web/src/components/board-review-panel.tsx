'use client';

import { useCallback, useEffect, useState } from 'react';
import { admissionVoteMessage } from '@drep-dao/cardano';
import { boardApi, type PendingApplication } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useExplorer } from '@/lib/explorer';
import { useT } from '@/lib/prefs-context';
import { VotingStyleBadge } from './voting-style-badge';
import { ClampedMarkdown } from './clamped-markdown';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 font-medium text-neutral-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-300">{children}</dd>
    </div>
  );
}

const optins = (a: PendingApplication) =>
  [
    a.kycOptin ? 'KYC' : null,
    a.callsOptin ? 'Calls' : null,
    a.admissionCallOptin ? 'Admission call' : null,
  ].filter(Boolean) as string[];

export function BoardReviewPanel({ history = false }: { history?: boolean }) {
  const t = useT();
  const { profile, signMessage } = useAuth();
  const { txUrl } = useExplorer();
  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [anchorTx, setAnchorTx] = useState<string | null>(null);
  const [rationale, setRationale] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    boardApi
      .listApplications(history)
      .then((list) => {
        setApps(list);
        // Prefill each rationale box with this board member's saved rationale.
        setRationale(Object.fromEntries(list.map((a) => [a.drepId, a.myVote?.feedback ?? ''])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('Failed to load')))
      .finally(() => setLoading(false));
  }, [history, t]);

  useEffect(load, [load]);

  const vote = async (app: PendingApplication, choice: 'YES' | 'NO') => {
    setError(null);
    setMsg(null);
    const feedback = (rationale[app.drepId] ?? '').trim();
    if (!feedback) {
      setError(t('A written rationale is required for every vote (YES or NO).'));
      return;
    }
    setBusy(app.drepId);
    try {
      // §C — sign the vote with the wallet's stake key (free, no tx). Falls back
      // to an unsigned (platform-attested) vote if the wallet can't sign.
      let sig: { signature: string; signingKey: string; ts: string } | undefined;
      const ts = new Date().toISOString();
      if (profile) {
        const message = admissionVoteMessage({
          applicantDrepId: app.drepIdOnchain,
          voterStakeAddress: profile.user.stakeAddress,
          choice,
          rationale: feedback,
          ts,
        });
        const s = await signMessage(message);
        if (s) sig = { signature: s.signature, signingKey: s.key, ts };
      }
      const res = await boardApi.vote(app.drepId, { choice, feedback, ...sig });
      if (res.anchorTxHash) {
        setAnchorTx(res.anchorTxHash);
        setMsg(`${t('Decision')} (${res.status}) ${t('anchored on-chain.')}`);
      } else if (res.status === 'ADMITTED' || res.status === 'REJECTED') {
        setMsg(`${t('Decision:')} ${res.status} ${t('(anchor pending).')}`);
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Vote failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {t('Board — DRep applications')}{' '}
        <span className="text-sm font-normal text-neutral-500">
          ({apps.filter((a) => a.status === 'PENDING_ADMISSION').length} {t('pending')})
        </span>
        <VotingStyleBadge style="1P1V" />
      </h3>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {msg ? (
        <div className="text-sm text-emerald-600">
          {msg}
          {anchorTx ? (
            <>
              {' '}
              <a href={txUrl(anchorTx)} target="_blank" rel="noreferrer" className="underline">
                {t('view tx')}
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <p className="text-sm text-neutral-500">{t('Loading…')}</p>
      ) : apps.length === 0 ? (
        <p className="text-sm text-neutral-500">{history ? t('No applications.') : t('No pending applications.')}</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a) => {
            const noRationale = !(rationale[a.drepId] ?? '').trim();
            const contact = a.contact ?? {};
            const done = a.status !== 'PENDING_ADMISSION'; // ADMITTED / REJECTED — read-only history row
            return (
              <li key={a.drepId} className={`rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800 ${done ? 'opacity-70' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.displayName ?? t('(no name)')}</span>
                  {done ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        a.status === 'ADMITTED'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {a.status === 'ADMITTED' ? t('✓ ADMITTED') : t('✗ REJECTED')}
                    </span>
                  ) : null}
                  {a.myVote ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        a.myVote.choice === 'YES'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {t('YOU VOTED')} {a.myVote.choice}
                    </span>
                  ) : null}
                </div>
                <dl className="mt-1 space-y-1 text-xs">
                  <Row label={t('DRep ID')}>
                    <span className="break-all font-mono text-neutral-500">{a.drepIdOnchain}</span>
                  </Row>
                  {a.bio ? <Row label={t('Motivation')}><ClampedMarkdown maxLines={15}>{a.bio}</ClampedMarkdown></Row> : null}
                  {a.subcategoryIds.length ? (
                    <Row label={t('Categories')}>
                      <span className="flex flex-wrap gap-1">
                        {a.subcategoryIds.map((s) => (
                          <span key={s} className="rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-800">
                            {s}
                          </span>
                        ))}
                      </span>
                    </Row>
                  ) : null}
                  {contact.email || contact.telegram ? (
                    <Row label={t('Contact')}>
                      {[contact.email, contact.telegram].filter(Boolean).join(' · ')}
                    </Row>
                  ) : null}
                  <Row label={t('Opt-ins')}>{optins(a).length ? optins(a).join(', ') : t('none')}</Row>
                  <Row label={t('Board votes')}>
                    {a.yes}/{a.threshold} {t('YES')}{a.no ? ` · ${a.no} ${t('NO')}` : ''}
                  </Row>
                </dl>
                {/* Resolved applications are read-only history — no rationale box or vote buttons. */}
                {done ? null : (
                  <>
                    <textarea
                      value={rationale[a.drepId] ?? ''}
                      onChange={(e) => setRationale((r) => ({ ...r, [a.drepId]: e.target.value }))}
                      placeholder={t('Rationale (required for YES and NO) — visible to the applicant')}
                      rows={2}
                      className="mt-2 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        disabled={busy === a.drepId || noRationale}
                        onClick={() => vote(a, 'YES')}
                        className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      >
                        {a.myVote?.choice === 'YES' ? t('Update YES') : t('Approve (YES)')}
                      </button>
                      <button
                        disabled={busy === a.drepId || noRationale}
                        onClick={() => vote(a, 'NO')}
                        className="rounded border border-red-400 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-950"
                      >
                        {a.myVote?.choice === 'NO' ? t('Update NO') : t('Reject (NO)')}
                      </button>
                      {noRationale ? <span className="text-xs text-neutral-400">{t('enter a rationale to vote')}</span> : null}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
