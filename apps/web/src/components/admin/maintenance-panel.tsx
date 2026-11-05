'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type MaintenanceState } from '@/lib/admin-api';
import { ConfirmDialog } from '../confirm-dialog';
import { fmtDateTime } from '../round-ui';

/**
 * §26 — sysadmin toggle for "Short maintenance mode". Flips the same flag the reverse proxy
 * checks and the deploy-guard script uses, so enabling it shows every visitor the maintenance
 * page. The admin panel + its API are exempt from the gate, so this button always stays usable.
 */
export function MaintenancePanel() {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await adminApi.maintenance.get());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read maintenance state');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (enable: boolean) => {
    setConfirming(false);
    setError(null);
    setBusy(true);
    try {
      setState(enable ? await adminApi.maintenance.enable() : await adminApi.maintenance.disable());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
    } finally {
      setBusy(false);
    }
  };

  const enabled = state?.enabled ?? false;

  return (
    <section className="rounded-lg border border-neutral-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-800 dark:text-slate-200">Maintenance mode</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            enabled ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          {state == null ? 'checking…' : enabled ? 'ON — visitors see maintenance' : 'OFF — platform live'}
        </span>
      </div>

      <p className="mt-2 text-xs text-neutral-700 dark:text-slate-300">
        Shows every visitor a &ldquo;Short maintenance mode&rdquo; page while you make changes. The admin panel
        keeps working, so you can switch it back off from here. {enabled && state?.since ? (
          <span className="text-neutral-500 dark:text-slate-400">Enabled {fmtDateTime(state.since)}.</span>
        ) : null}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {enabled ? (
          <button
            disabled={busy}
            onClick={() => void apply(false)}
            className="rounded border border-emerald-600 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-950 disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Turn maintenance OFF'}
          </button>
        ) : (
          <button
            disabled={busy || state == null}
            onClick={() => setConfirming(true)}
            className="rounded border border-amber-600 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-950 disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Turn maintenance ON'}
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => void load()}
          className="rounded border border-neutral-300 dark:border-slate-700 px-2.5 py-1 text-xs text-neutral-700 dark:text-slate-300 hover:bg-neutral-100 dark:hover:bg-slate-800 disabled:opacity-40"
        >
          Refresh
        </button>
        {error ? <span className="text-xs text-red-400">{error}</span> : null}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Turn on maintenance mode?"
        tone="danger"
        confirmLabel="Show maintenance page"
        message={
          <>
            Every visitor will see the &ldquo;Short maintenance mode&rdquo; page and won&rsquo;t be able to use the
            platform until you turn it back off.
            <br /><br />
            You&rsquo;ll still have access here to switch it off.
          </>
        }
        onConfirm={() => void apply(true)}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
