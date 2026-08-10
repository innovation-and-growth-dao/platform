'use client';

import { useEffect, useState } from 'react';
import { drepApi, type MyDrep } from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { useT } from '@/lib/prefs-context';

const LABEL_CLS: Record<string, string> = {
  PENDING_ADMISSION: 'text-amber-600',
  ADMITTED: 'text-emerald-600',
  REJECTED: 'text-red-600',
  REMOVED: 'text-red-600',
};

export function MyDrepStatus() {
  const t = useT();
  const LABEL_TEXT: Record<string, string> = {
    PENDING_ADMISSION: t('Membership request under board review'),
    ADMITTED: t('You are a DAO member ✅'),
    REJECTED: t('Membership request rejected'),
    REMOVED: t('DAO membership removed'),
  };
  const { txUrl } = useExplorer();
  const [drep, setDrep] = useState<MyDrep | null>(null);

  useEffect(() => {
    void drepApi.mine().then(setDrep).catch(() => setDrep(null));
  }, []);

  if (!drep) return null;
  const label = { text: LABEL_TEXT[drep.status] ?? drep.status, cls: LABEL_CLS[drep.status] ?? '' };
  const pending = drep.status === 'PENDING_ADMISSION';

  return (
    <div className="space-y-2 text-sm">
      <h3 className="text-base font-semibold">{t('DAO membership')}</h3>
      <div className={label.cls}>{label.text}</div>
      <div className="font-mono text-xs text-neutral-500 break-all">{drep.drepIdOnchain}</div>
      {drep.anchorTxHash ? (
        <div className="text-xs text-neutral-500">
          {t('Decision anchored on-chain ✓')}{' '}
          <a
            href={txUrl(drep.anchorTxHash)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {t('view tx')}
          </a>
        </div>
      ) : null}

      {pending ? (
        <div className="text-sm">
          <span className="font-medium text-emerald-600">{drep.yes}</span> {t('of')}{' '}
          <span className="font-medium">{drep.threshold}</span> {t('required YES votes')}
          {drep.no ? <span className="text-red-600"> · {drep.no} NO</span> : null}
        </div>
      ) : null}

      {drep.admissionVotesReceived.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-neutral-500">{t('Board votes')}</div>
          <ul className="space-y-1">
            {drep.admissionVotesReceived.map((v, i) => (
              <li
                key={i}
                className="rounded-md border border-neutral-200 p-2 text-xs dark:border-neutral-800"
              >
                <span className={v.choice === 'YES' ? 'font-medium text-emerald-600' : 'font-medium text-red-600'}>
                  {v.choice}
                </span>{' '}
                <span className="text-neutral-500">— {v.voterName}</span>
                {v.feedback ? <div className="mt-0.5 text-neutral-600 dark:text-neutral-400">{v.feedback}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : pending ? (
        <p className="text-xs text-neutral-500">{t('No board votes cast yet.')}</p>
      ) : null}
    </div>
  );
}
