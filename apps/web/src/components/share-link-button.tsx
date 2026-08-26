'use client';

import { useState } from 'react';
import { useT } from '@/lib/prefs-context';

/** Copies the current page URL — which deep-links to the open proposal — so it can be shared.
 *  Anyone who opens the link lands on the proposal, logs in, and can view or vote. */
export function ShareLinkButton({ className }: { className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard unavailable (non-secure context) — ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800 ${className ?? ''}`}
    >
      {done ? t('✓ Link copied') : `🔗 ${t('Copy share link')}`}
    </button>
  );
}
