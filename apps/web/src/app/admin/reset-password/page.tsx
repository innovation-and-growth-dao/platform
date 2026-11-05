'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { adminApi } from '@/lib/admin-api';

/** §18.8 — the target admin opens the one-time reset link and sets a new password. */
function ResetPasswordInner() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError('passwords do not match'); return; }
    setBusy(true);
    try {
      await adminApi.accounts.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-md border border-neutral-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-500';

  if (!token) return <p className="text-sm text-red-400">Missing reset token.</p>;
  if (done) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-400">Password updated — all old sessions were revoked.</p>
        <Link href="/admin/login" className="text-sm text-amber-400 underline">Sign in</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <h1 className="text-lg font-semibold">Reset admin password</h1>
      <input type="password" className={field} placeholder="new password (min 12 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <input type="password" className={field} placeholder="confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50">
        {busy ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-md p-6 text-neutral-800 dark:text-slate-200">
      <Suspense fallback={null}>
        <ResetPasswordInner />
      </Suspense>
    </main>
  );
}
