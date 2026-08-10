'use client';

import { useState } from 'react';
import { drepApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';

/** §14 — voluntarily leave the DAO, with a styled confirmation dialog. */
export function LeaveDao({ isBoard = false }: { isBoard?: boolean }) {
  const t = useT();
  const { refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    setError(null);
    setBusy(true);
    try {
      await drepApi.leaveDao();
      await refresh();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed to leave'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      >
        {isBoard ? t('Step down & leave the DAO') : t('Leave the DAO')}
      </button>
      <p className="mt-1 text-xs text-neutral-500">{t('You can re-apply later. This does not deregister your on-chain DRep.')}</p>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {isBoard ? t('Step down and leave the DAO?') : t('Leave the DAO?')}
            </h3>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              {t('You will stop being a DAO member: you won’t be drawn for filtering or vote in Debate & Vote.')}
              {isBoard ? t(' As a board member you will also resign your board seat — the board drops below five until an admin seats a replacement.') : ''}
              {' '}{t('Your on-chain DRep registration is unaffected, and you can request to re-join later.')}
            </p>
            {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={leave}
                disabled={busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? t('Leaving…') : t('Yes, leave the DAO')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
