'use client';

import { useEffect, useState } from 'react';
import { drepApi, type MyRemoval } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

/** §14.4 — warns a DAO member that the board is voting on removing them. */
export function RemovalBanner() {
  const t = useT();
  const [r, setR] = useState<MyRemoval | null>(null);
  useEffect(() => {
    void drepApi.myRemoval().then(setR).catch(() => setR(null));
  }, []);
  if (!r) return null;
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
      <h3 className="font-semibold text-red-700 dark:text-red-300">⚠ {t('Removal vote in progress')}</h3>
      <p className="mt-1 text-neutral-700 dark:text-neutral-300">
        {r.proposedByName} {t('proposed removing you from the DAO')} — <strong>{r.yes}/{r.threshold}</strong> {t('YES so far.')}
        {r.reason ? ` ${t('Reason:')} ${r.reason}` : ''} {t('If')} {r.threshold} {t('board members vote YES you lose membership (you can re-apply afterwards).')}
      </p>
      {r.votes.length ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {r.votes.map((v, i) => (
            <li key={i}>
              <span className={v.choice === 'YES' ? 'text-red-600' : 'text-emerald-600'}>{v.choice}</span> · {v.voterName}
              {v.rationale ? <span className="text-neutral-500"> — {v.rationale}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
