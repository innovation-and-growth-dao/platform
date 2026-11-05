'use client';

import { useEffect, useRef, useState } from 'react';
import { maintenanceApi } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

/**
 * §26 — the maintenance experience for anyone with the app open during a deploy:
 *  1. a countdown banner ~60s BEFORE the platform goes offline (so you can finish + save),
 *  2. when it reaches 0 / the app actually goes down, a full-screen "update in progress" cover,
 *  3. and once the platform is back, the page reloads itself so the app returns automatically.
 *
 * The deploy-guard writes the pending signal; we poll `/maintenance/status`. While maintenance runs
 * the API is unreachable (Caddy serves the 503 maintenance page), so a failed poll IS the signal
 * that we're offline; a successful poll afterwards means the platform is back.
 */
export function MaintenanceNotice() {
  const t = useT();
  const [left, setLeft] = useState<number | null>(null); // countdown seconds (null = none)
  const [offline, setOffline] = useState(false); // full-screen cover: maintenance in progress
  const leftRef = useRef<number | null>(null);
  const offlineRef = useRef(false);
  leftRef.current = left;
  offlineRef.current = offline;

  useEffect(() => {
    let alive = true;
    const poll = () =>
      maintenanceApi
        .status()
        .then((s) => {
          if (!alive) return;
          if (s.pending && s.secondsLeft > 0) {
            setLeft(s.secondsLeft);
            setOffline(false);
          } else if (offlineRef.current) {
            // We were offline and the API is reachable again → the update finished → return the app.
            window.location.reload();
          } else {
            setLeft(null); // no countdown, not offline → nothing to show
          }
        })
        .catch(() => {
          // API unreachable. If we were counting down (or already offline), maintenance is running.
          if (alive && (leftRef.current !== null || offlineRef.current)) setOffline(true);
        });
    poll();
    const pollId = setInterval(poll, 5000); // re-sync + detect the platform coming back
    const tickId = setInterval(() => setLeft((v) => (v !== null && v > 0 ? v - 1 : v)), 1000); // reaches 0
    return () => { alive = false; clearInterval(pollId); clearInterval(tickId); };
  }, []);

  // Full-screen cover once the countdown has elapsed or the app is actually offline.
  if (offline || left === 0) {
    return (
      <div
        role="alertdialog"
        aria-live="assertive"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-900/80 p-6 text-center backdrop-blur-sm"
      >
        <div className="max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neutral-300 border-t-emerald-500 dark:border-neutral-700 dark:border-t-emerald-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t('A short maintenance update is in progress')}</h2>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{t('The platform is briefly offline and will return here automatically — no need to refresh.')}</p>
        </div>
      </div>
    );
  }

  // Pre-warning countdown banner.
  if (left !== null && left > 0) {
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

  return null;
}
