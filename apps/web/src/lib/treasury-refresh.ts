'use client';

import { useEffect } from 'react';

/**
 * §15 — auto-refresh for treasury views. Two triggers:
 *   • notifyTreasuryChanged() — fired the moment a multisig tx is broadcast
 *     (last signature collected). Subscribed views reload immediately and
 *     then re-check a few times, because db-sync indexes the new tx with a
 *     small lag (seconds to ~a minute) — the first reload usually still
 *     shows the old balance.
 *   • a slow background poll, so changes made by OTHER members (their
 *     browser fired the event, not ours) appear without a manual refresh.
 */
const EVENT = 'drepdao:treasury-changed';

export function notifyTreasuryChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** `cb` must be referentially stable (wrap in useCallback at the call site). */
export function useTreasuryAutoRefresh(cb: () => void, pollMs = 30_000) {
  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    const onEvent = () => {
      cb();
      timers.forEach(clearTimeout);
      timers = [10_000, 30_000, 75_000].map((d) => setTimeout(cb, d));
    };
    window.addEventListener(EVENT, onEvent);
    const iv = setInterval(cb, pollMs);
    return () => {
      window.removeEventListener(EVENT, onEvent);
      clearInterval(iv);
      timers.forEach(clearTimeout);
    };
  }, [cb, pollMs]);
}
