'use client';

import { useEffect, useRef, useState } from 'react';
import { setStepUpHandler } from '@/lib/admin-api';

// SEC-03 — renders the step-up prompt. It registers a handler that admin-api calls whenever a
// privileged action needs a fresh 2FA code: the modal opens, the admin enters the current code, and
// the promise resolves so the request retries with it. Cancelling resolves null (action aborts).
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const resolveRef = useRef<((v: string | null) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(
      (retryMessage) =>
        new Promise<string | null>((resolve) => {
          setMessage(retryMessage);
          setCode('');
          setOpen(true);
          resolveRef.current = resolve;
        }),
    );
    return () => setStepUpHandler(null);
  }, []);

  const finish = (value: string | null) => {
    setOpen(false);
    resolveRef.current?.(value);
    resolveRef.current = null;
  };
  const submit = () => {
    const c = code.trim();
    if (c) finish(c);
  };

  return (
    <>
      {children}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-lg border border-neutral-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-xl">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-slate-100">Confirm with your 2FA code</h3>
            <p className="mt-1 text-sm text-neutral-500 dark:text-slate-400">
              This action needs a fresh code from your authenticator app.
            </p>
            {message ? <p className="mt-2 text-sm text-rose-400">{message}</p> : null}
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') finish(null);
              }}
              placeholder="123456"
              className="mt-3 w-full rounded-md border border-neutral-300 dark:border-slate-700 bg-neutral-100 dark:bg-slate-950 px-3 py-2 text-center font-mono text-lg tracking-widest text-neutral-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => finish(null)}
                className="rounded-md border border-neutral-300 dark:border-slate-700 px-3 py-1.5 text-sm text-neutral-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={!code.trim()}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
