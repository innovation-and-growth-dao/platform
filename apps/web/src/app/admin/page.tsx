'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/admin-auth-context';
import { adminApi, type AdminHealth, type AuditRow } from '@/lib/admin-api';
import { AdminGenesis } from '@/components/admin/admin-genesis';
import { AdminsPanel } from '@/components/admin/admins-panel';
import { WalletPanel } from '@/components/admin/wallet-panel';
import { ResetPanel } from '@/components/admin/reset-panel';
import { fmtDateTime } from '@/components/round-ui';

export default function AdminDashboard() {
  const { admin, loading, logout } = useAdminAuth();
  const router = useRouter();
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  // Bump after a destructive reset to force AdminGenesis + WalletPanel to
  // re-mount + re-fetch (otherwise they keep showing pre-reset state until
  // the user hard-refreshes the page).
  const [resetGen, setResetGen] = useState(0);

  useEffect(() => {
    if (!loading && !admin) router.replace('/admin/login');
  }, [loading, admin, router]);

  const refreshOverview = useCallback(() => {
    adminApi.health().then(setHealth).catch(() => undefined);
    adminApi.auditLog().then(setAudit).catch(() => undefined);
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
