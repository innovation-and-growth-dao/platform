'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/admin-auth-context';

export default function AdminLoginPage() {
  const { admin, loading, login, login2fa } = useAdminAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && admin) router.replace('/admin');
  }, [loading, admin, router]);

  const field =
    'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500';

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(username.trim(), password);
      if (res.status === '2fa_required') setPendingToken(res.pendingToken);
      else router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const submit2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login2fa(pendingToken!, code.trim());
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-xl font-bold">Platform Admin</h1>
      <p className="mt-1 text-sm text-slate-400">Sign in with username + password.</p>

      {pendingToken === null ? (
        <form onSubmit={submitPassword} className="mt-6 space-y-3">
          <input
            className={field}
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <div className="relative">
            <input
              className={`${field} pr-10`}
              type={showPw ? 'text' : 'password'}
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {/* Eye toggle — show the password on demand. */}
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              title={showPw ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-300"
            >
              {showPw ? '🙈' : '👁'}
            </button>
          </div>
          {error ? <div className="text-sm text-red-400">{error}</div> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form onSubmit={submit2fa} className="mt-6 space-y-3">
          <p className="text-sm text-slate-400">Enter the 6-digit code from your authenticator.</p>
          <input
            className={field}
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
          {error ? <div className="text-sm text-red-400">{error}</div> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      )}
    </div>
  );
}
