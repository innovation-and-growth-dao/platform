'use client';

import { useCallback, useEffect, useState } from 'react';
import { boardProofsApi, daoApi, type OnChainProof } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { useExplorer } from '@/lib/explorer';
import { fmtDateTime } from './round-ui';

/** Everything the platform has anchored on-chain — human-readable + verifiable. */
export function OnChainProofs() {
  const t = useT();
  const { txUrl } = useExplorer();
  const { profile } = useAuth();
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  const [proofs, setProofs] = useState<OnChainProof[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    daoApi.proofs().then(setProofs).catch((e) => setError(e instanceof Error ? e.message : t('Failed to load')));
  }, [t]);
  useEffect(load, [load]);

  const pending = (proofs ?? []).filter((p) => !p.txHash).length;

  const submitOne = async (id: string) => {
    setBusy(id);
    setError(null);
    setMsg(null);
    try {
      await boardProofsApi.submit(id);
      setMsg(t('Anchor submitted on-chain.'));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('submission failed'));
    } finally {
      setBusy(null);
    }
  };

  const submitAll = async () => {
    setBusy('all');
    setError(null);
    setMsg(null);
    try {
      const r = await boardProofsApi.submitAll();
      const text = `${t('Submitted')} ${r.submitted}/${r.total} ${t('pending anchor')}${r.total === 1 ? '' : 's'}${r.failed ? ` (${r.failed} ${t('failed')})` : ''}.${r.reason ? ` ${r.reason}.` : ''}`;
      // Anything short of a clean full submission (failures, or a reason returned) is an error → red.
      if (r.submitted === r.total && !r.reason) setMsg(text);
      else setError(text);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('submission failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('On-chain proofs')}</h2>
          <p className="text-sm text-neutral-500">
            {t('Decisions anchored on Cardano as transaction metadata. Each links to the explorer; the metadata itself lists the voters and outcome, so anyone can verify it independently.')}
          </p>
        </div>
        {/* §18 — only board members can force pending anchors onto the chain. */}
        {isBoard && pending > 0 ? (
          <button
            onClick={submitAll}
            disabled={busy !== null}
            className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === 'all' ? t('Submitting…') : `${t('Submit all pending')} (${pending})`}
          </button>
        ) : null}
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {msg ? <div className="text-sm text-emerald-600">{msg}</div> : null}
      {!proofs ? (
        <p className="text-sm text-neutral-500">{t('Loading…')}</p>
      ) : proofs.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('Nothing anchored on-chain yet.')}</p>
      ) : (
        <ul className="space-y-2">
          {proofs.map((p) => (
            <li key={p.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{p.title}</span>
                <span className="text-xs text-neutral-500">{fmtDateTime(p.createdAt)}</span>
              </div>
              {p.detail ? <div className="text-neutral-600 dark:text-neutral-400">{p.detail}</div> : null}
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <span>{t('metadata label')} {p.label}</span>
                {p.txHash ? (
                  <a href={txUrl(p.txHash)} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">
                    {t('view on explorer ↗')}
                  </a>
                ) : (
                  <>
                    <span className="text-amber-600">{t('anchor pending (not yet submitted)')}</span>
                    {/* §18 — board can enforce submission for this record. */}
                    {isBoard ? (
                      <button
                        onClick={() => submitOne(p.id)}
                        disabled={busy !== null}
                        className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      >
                        {busy === p.id ? t('Submitting…') : t('Submit on-chain')}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
