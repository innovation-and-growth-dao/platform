'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { adminApi } from '@/lib/admin-api';

function AcceptInviteInner() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ totpQrDataUrl: string; totpBase32: string; recoveryCodes: string[] } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    setBusy(true);
    try {
      const res = await adminApi.accounts.accept(token, password);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not accept invitation');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full rounded-md border border-neutral-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-500';

  if (!token) return <p className="text-sm text-red-400">Missing invitation token.</p>;

  if (result) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-emerald-400">Account created ✓</h1>
        <div>
          <p className="text-sm text-neutral-700 dark:text-slate-300">Scan this in your authenticator app:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.totpQrDataUrl} alt="2FA QR" className="mt-2 rounded bg-white p-2" width={180} height={180} />
          <p className="mt-1 break-all font-mono text-xs text-neutral-500 dark:text-slate-400">secret: {result.totpBase32}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-amber-300">Recovery codes (save now — shown once):</p>
          <ul className="mt-1 grid grid-cols-2 gap-1 font-mono text-xs text-neutral-800 dark:text-slate-200">
            {result.recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <Link href="/admin/login" className="inline-block rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-xl font-bold">Accept admin invitation</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-slate-400">Set your password to activate the account.</p>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input className={field} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        <input className={field} type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        {error ? <div className="text-sm text-red-400">{error}</div> : null}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500 dark:text-slate-400">Loading…</p>}>
      <AcceptInviteInner />
    </Suspense>
  );
}
