'use client';

import { useEffect, useRef } from 'react';
import { useT } from '@/lib/prefs-context';

/**
 * §20 — in-platform modal that replaces native `window.confirm`. Styled to
 * match the rest of the app, keyboard-accessible (Escape cancels, Enter
 * confirms), and traps focus so the underlying page can't be interacted
 * with until the user decides.
 *
 * Pattern at the call site:
 *   const [confirming, setConfirming] = useState(false);
 *   ...
 *   <button onClick={() => setConfirming(true)}>Sweep</button>
 *   <ConfirmDialog
 *     open={confirming}
 *     title="Sweep hot wallet?"
 *     message={`Move ${balance} ₳ back to treasury?`}
 *     onCancel={() => setConfirming(false)}
 *     onConfirm={async () => { setConfirming(false); await doSweep(); }}
 *   />
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  hideCancel = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' tints the confirm button red for destructive ops. */
  tone?: 'default' | 'danger';
  /** Hide the cancel button for a single-OK acknowledgement (alert-style warning). */
  hideCancel?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  // Callbacks live in refs so the open-effect below depends ONLY on `open`.
  // Call sites pass inline arrows (new identity every render); if the effect
  // re-ran on them it would re-focus the confirm button on EVERY parent
  // re-render — stealing focus from a textarea inside `message` after each
  // typed character.
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => { onCancelRef.current = onCancel; onConfirmRef.current = onConfirm; });
  useEffect(() => {
    if (!open) return;
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancelRef.current(); }
      else if (e.key === 'Enter') {
        // Enter inside a textarea makes a newline, never a confirm.
        if ((e.target as HTMLElement | null)?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        void onConfirmRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;
  const confirmCls = tone === 'danger'
    ? 'rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700'
    : 'rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 px-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h3 id="confirm-dialog-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {title}
        </h3>
        <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{message}</div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {hideCancel ? null : (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {cancelLabel ?? t('Cancel')}
            </button>
          )}
          <button ref={confirmBtnRef} type="button" onClick={() => { void onConfirm(); }} className={confirmCls}>
            {confirmLabel ?? t('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
