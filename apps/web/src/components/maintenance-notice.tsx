'use client';

import { useEffect, useState } from 'react';
import { maintenanceApi } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

/**
 * §26 — a banner that appears ~60s BEFORE a deploy takes the platform into maintenance, counting
 * down, so anyone mid-action can finish and save before the page briefly goes offline. The
 * deploy-guard sets the pending signal; we poll it and tick down locally between polls.
 */
export function MaintenanceNotice() {
  const t = useT();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      maintenanceApi
        .status()
        .then((s) => { if (alive) setLeft(s.pending ? s.secondsLeft : null); })
        .catch(() => { /* API unreachable (already restarting) — ignore */ });
    poll();
    const pollId = setInterval(poll, 15000); // re-sync with the server
    const tickId = setInterval(() => setLeft((v) => (v && v > 1 ? v - 1 : v)), 1000); // local countdown
    return () => { alive = false; clearInterval(pollId); clearInterval(tickId); };
  }, []);

  if (left === null || left <= 0) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white shadow"
    >
      <span aria-hidden="true">⚠</span>
      <span>{t('A short maintenance update starts in')} <span className="tabular-nums font-semibold">{left}s</span>.</span>
      <span className="opacity-95">{t('Please finish and save your work — the page will briefly go offline and return on its own.')}</span>
    </div>
  );
}
