'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/admin-auth-context';
import { adminApi, type AdminHealth, type AuditRow } from '@/lib/admin-api';
import { AdminGenesis } from '@/components/admin/admin-genesis';
import { AdminsPanel } from '@/components/admin/admins-panel';
import { WalletPanel } from '@/components/admin/wallet-panel';
import { ResetPanel } from '@/components/admin/reset-panel';
import { MaintenancePanel } from '@/components/admin/maintenance-panel';
import { fmtDateTime } from '@/components/round-ui';
import { StepUpProvider } from '@/components/admin/step-up-provider';
import { Enable2FA } from '@/components/admin/enable-2fa';

export default function AdminDashboard() {
  const { admin, loading, logout } = useAdminAuth();
  const router = useRouter();
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  // Bump after a destructive reset to force AdminGenesis + WalletPanel to
  // re-mount + re-fetch (otherwise they keep showing pre-reset state until
  // the user hard-refreshes the page).
  const [resetGen, setResetGen] = useState(0);
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loading && !admin) router.replace('/admin/login');
  }, [loading, admin, router]);

  const refreshOverview = useCallback(() => {
    adminApi.health().then(setHealth).catch(() => undefined);
    adminApi.auditLog().then(setAudit).catch(() => undefined);
    adminApi.me().then((m) => setTwoFaEnabled(!!m.twoFaEnabled)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!admin) return;
    refreshOverview();
  }, [admin, refreshOverview]);

  if (loading || !admin) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  const dot = (s: string) => (s === 'up' ? 'text-emerald-400' : 'text-red-400');

  return (
    <StepUpProvider>
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Admin dashboard</h1>
          <p className="text-sm text-slate-400">
            {admin.username} · {admin.email}
          </p>
        </div>
        <button
          onClick={() => logout().then(() => router.replace('/admin/login'))}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
        >
          Log out
        </button>
      </header>

      {twoFaEnabled === false ? <Enable2FA onEnabled={refreshOverview} /> : null}
      {twoFaEnabled === true ? <TwoFaEnabledPanel onDisabled={refreshOverview} /> : null}

      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Overview</h2>
        {health ? (
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Stat label="Database" value={health.database} cls={dot(health.database)} />
            <Stat label="Redis" value={health.redis} cls={dot(health.redis)} />
            <Stat label="Genesis" value={health.genesisApproved ? 'approved' : 'pending'} />
            <Stat label="Board" value={String(health.boardCount)} />
            <Stat label="Admins" value={String(health.adminCount)} />
            <Stat label="Maintenance" value={health.maintenanceMode ? 'on' : 'off'} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">…</p>
        )}
      </section>

      <MaintenancePanel />

      <AdminGenesis key={`genesis-${resetGen}`} onBoardChange={refreshOverview} />

      <WalletPanel key={`wallet-${resetGen}`} />

      <AdminsPanel currentAdminId={admin.adminId} />

      <ResetPanel onReset={() => { setResetGen((n) => n + 1); refreshOverview(); }} />

      <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Audit log</h2>
        <ul className="space-y-1 font-mono text-xs">
          {audit.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-2 text-slate-300">
              <span className="text-slate-500">{fmtDateTime(e.occurredAt)}</span>
              <span className="text-amber-400">{e.action}</span>
              {e.adminUsername ? <span>{e.adminUsername}</span> : null}
              {e.target ? <span className="text-slate-500">{e.target}</span> : null}
            </li>
          ))}
          {audit.length === 0 ? <li className="text-slate-500">no entries</li> : null}
        </ul>
      </section>
    </div>
    </StepUpProvider>
  );
}

function TwoFaEnabledPanel({ onDisabled }: { onDisabled: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const disable = async () => {
    setErr(null);
    setBusy(true);
    try {
      await adminApi.twoFa.disable(); // triggers the step-up prompt for a fresh code
      onDisabled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not disable 2FA.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="text-sm font-semibold text-slate-300">Two-factor authentication is enabled</h2>
      <p className="mt-1 text-sm text-slate-400">
        Disable it (needs a current code) to re-enroll — e.g. to get fresh recovery codes or move to a new device.
      </p>
      <button
        onClick={disable}
        disabled={busy}
        className="mt-3 rounded-md border border-rose-800 px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-950/40 disabled:opacity-50"
      >
        {busy ? 'Disabling…' : 'Disable 2FA'}
      </button>
      {err ? <p className="mt-2 text-sm text-rose-400">{err}</p> : null}
    </section>
  );
}


function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded border border-slate-800 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cls ?? 'text-slate-100'}>{value}</div>
    </div>
  );
}
