'use client';

import { useState } from 'react';
import { adminApi } from '@/lib/admin-api';

// SEC-03 — self-service 2FA enrollment. Required before an admin can perform step-up actions
// (hot-wallet sweep, seed rotation, genesis, admin lifecycle). Scan the QR (or key), then confirm a
// code to persist it. The secret is only stored server-side once a code is confirmed.
export function Enable2FA({ onEnabled }: { onEnabled: () => void }) {
  const [setup, setSetup] = useState<{ totpQrDataUrl: string; totpBase32: string; recoveryCodes: string[] } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      setSetup(await adminApi.twoFa.setup());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start 2FA setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setErr(null);
    setBusy(true);
    try {
      await adminApi.twoFa.enable(code.trim());
      onEnabled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not enable 2FA.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-4">
      <h2 className="text-sm font-semibold text-amber-300">Two-factor authentication is not enabled</h2>
      <p className="mt-1 text-sm text-neutral-500 dark:text-slate-400">
        Privileged actions (hot-wallet sweep, seed rotation, genesis, admin changes) require a fresh 2FA code. Enable it to use them.
      </p>

      {!setup ? (
        <button
          onClick={start}
          disabled={busy}
          className="mt-3 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Enable 2FA'}
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.totpQrDataUrl} alt="2FA QR code" width={160} height={160} className="rounded bg-white p-1" />
            <div className="min-w-0 space-y-2 text-sm">
              <div>
                <div className="text-neutral-500 dark:text-slate-400">Or enter this key manually:</div>
                <code className="break-all font-mono text-xs text-neutral-800 dark:text-slate-200">{setup.totpBase32}</code>
              </div>
              <div>
                <div className="text-neutral-500 dark:text-slate-400">Recovery codes (store safely — shown once):</div>
                <div className="mt-1 grid grid-cols-2 gap-x-4 font-mono text-xs text-neutral-700 dark:text-slate-300">
                  {setup.recoveryCodes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="Enter code to confirm"
              className="rounded-md border border-neutral-300 dark:border-slate-700 bg-neutral-100 dark:bg-slate-950 px-3 py-2 text-center font-mono tracking-widest text-neutral-900 dark:text-slate-100 outline-none focus:border-emerald-500"
            />
            <button
              onClick={confirm}
              disabled={busy || !code.trim()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? 'Confirming…' : 'Confirm & enable'}
            </button>
          </div>
        </div>
      )}
      {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}
    </section>
  );
}
