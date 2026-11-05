'use client';

import { useT } from '@/lib/prefs-context';

/**
 * §3 — the proposal's document hash (SHA-256 of its title + content). This is the exact value
 * anchored on-chain in the decision's `docHash`, so anyone can compare the two and confirm the
 * anchored record refers to this proposal. Shown for every proposal type (OG, internal, funding).
 */
export function DocHashRow({ hash }: { hash: string | null | undefined }) {
  const t = useT();
  if (!hash) return null;
  return (
    <div className="mt-2 text-xs text-neutral-500">
      <span className="font-medium">{t('Document hash')}</span>{' '}
      <span className="text-[10px] text-neutral-400">({t('SHA-256 of title + content — matches the on-chain anchor')})</span>
      <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{hash}</div>
    </div>
  );
}
