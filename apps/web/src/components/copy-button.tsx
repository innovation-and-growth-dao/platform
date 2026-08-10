'use client';

import { useState } from 'react';
import { useT } from '@/lib/prefs-context';

/** A small "Copy" button that copies `text` to the clipboard and briefly confirms. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. non-secure context) — ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      {done ? t('✓ Copied') : (label ?? t('Copy'))}
    </button>
  );
}
