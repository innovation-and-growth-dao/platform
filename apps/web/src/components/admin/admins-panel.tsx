'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminRow } from '@/lib/admin-api';
import { ConfirmDialog } from '../confirm-dialog';

export function AdminsPanel({ currentAdminId }: { currentAdminId: string }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  // §18.8 / §18.6 — one-time reset link + switch-all rotation results (shown once).
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchText, setSwitchText] = useState('');
  const [switchInvites, setSwitchInvites] = useState<{ username: string; token: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminApi.admins().then(setAdmins).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await adminApi.accounts.invite(username.trim(), email.trim());
      setInviteUrl(`${window.location.origin}/admin/accept-invite?token=${token}`);
      setUsername('');
      setEmail('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'invite failed');
    } finally {
      setBusy(false);
    }
  };

  const [pendingAct, setPendingAct] = useState<{ id: string; kind: 'remove' | 'disable' } | null>(null);
  const act = (id: string, kind: 'remove' | 'disable') => setPendingAct({ id, kind });
  const doAct = async () => {
    if (!pendingAct) return;
    const { id, kind } = pendingAct;
    setPendingAct(null);
    setError(null);
    try {
      await adminApi.accounts[kind](id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind} failed`);
    }
  };

  const field =
    'w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-500';

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Admins ({admins.filter((a) => a.status === 'ACTIVE').length} active)
        </h2>
        <button
          onClick={() => setInviteOpen((v) => !v)}
          className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
        >
          {inviteOpen ? 'Cancel' : 'Invite admin'}
        </button>
      </div>

      {inviteOpen ? (
        <form onSubmit={invite} className="mb-3 space-y-2 rounded border border-slate-800 p-3">
          <input className={field} placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input className={field} placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create invitation'}
          </button>
        </form>
      ) : null}

      {inviteUrl ? (
        <div className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs">
          <div className="mb-1 font-medium text-amber-300">Share this one-time link (24h):</div>
          <code className="block break-all text-amber-200">{inviteUrl}</code>
        </div>
      ) : null}

      <ul className="space-y-1 text-sm">
        {admins.map((a) => (
          <li key={a.id} className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5">
            <span>
              {a.username} <span className="text-slate-500">· {a.email}</span>
              {a.id === currentAdminId ? <span className="ml-1 text-xs text-amber-400">(you)</span> : null}
            </span>
            <span className="flex items-center gap-2">
              <span className={a.status === 'ACTIVE' ? 'text-emerald-400' : 'text-slate-500'}>{a.status}</span>
              {a.status === 'ACTIVE' ? (
                <>
                  <button onClick={() => act(a.id, 'disable')} className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800">
                    Disable
                  </button>
                  <button onClick={() => act(a.id, 'remove')} className="rounded border border-red-700 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950">
                    Remove
                  </button>
                  <button
                    onClick={() => void adminApi.accounts.passwordReset(a.id).then((r) => setResetUrl(`${window.location.origin}/admin/reset-password?token=${r.token}`)).catch((e) => setError(e instanceof Error ? e.message : 'failed'))}
                    title="Generate a one-time password-reset link (1 hour)"
                    className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
                  >
                    Reset password
                  </button>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {resetUrl ? (
        <div className="mt-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs">
          <div className="mb-1 font-medium text-amber-300">One-time password-reset link (1 hour, shown once) — hand it to the admin out of band:</div>
          <code className="block break-all text-amber-200">{resetUrl}</code>
        </div>
      ) : null}

      {/* §18.6 — switch ALL admins: invite a fresh roster; current admins auto-disable when the last invite is accepted. */}
      <div className="mt-4 border-t border-slate-800 pt-3">
        <button onClick={() => setSwitchOpen((v) => !v)} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950">
          {switchOpen ? 'Cancel switch-all' : 'Switch all admins (rotation)'}
        </button>
        {switchOpen ? (
          <div className="mt-2 space-y-2 rounded border border-slate-800 p-3 text-xs">
            <p className="text-slate-400">One <code>username,email</code> per line. Every current admin is disabled automatically once the LAST new admin accepts their invite. Single audit event.</p>
            <textarea value={switchText} onChange={(e) => setSwitchText(e.target.value)} rows={3} placeholder={'alice2,alice@example.org\nbob2,bob@example.org'} className={field} />
            <button
              onClick={() => {
                const admins = switchText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [u, e] = l.split(','); return { username: (u ?? '').trim(), email: (e ?? '').trim() }; });
                void adminApi.accounts.switchAll(admins).then((r) => { setSwitchInvites(r.invites); setSwitchOpen(false); load(); }).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
              }}
              className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-600"
            >
              Start rotation
            </button>
          </div>
        ) : null}
        {switchInvites ? (
          <div className="mt-2 rounded border border-amber-700 bg-amber-950/40 p-2 text-xs">
            <div className="mb-1 font-medium text-amber-300">Rotation invites (24h, shown once):</div>
            {switchInvites.map((i) => (
              <div key={i.username} className="mb-1">
                <span className="text-amber-200">{i.username}:</span>{' '}
                <code className="break-all text-amber-200">{`${window.location.origin}/admin/accept-invite?token=${i.token}`}</code>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}
      <ConfirmDialog
        open={!!pendingAct}
        title={pendingAct ? `${pendingAct.kind === 'remove' ? 'Remove' : 'Disable'} this admin?` : ''}
        message={pendingAct?.kind === 'remove' ? 'The admin will lose access immediately.' : 'The admin will be disabled and cannot sign in until re-enabled.'}
        confirmLabel={pendingAct?.kind === 'remove' ? 'Remove' : 'Disable'}
        tone="danger"
        onConfirm={doAct}
        onCancel={() => setPendingAct(null)}
      />
    </section>
  );
}
