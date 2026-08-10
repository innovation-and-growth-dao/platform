'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminWalletStatus } from '@/lib/admin-api';
import { ConfirmDialog } from '../confirm-dialog';

/**
 * §18/§23 — platform-admin management of the anchor hot wallet. The interlock: move
 * all funds to the multisig (treasury) FIRST, then the seed can be exchanged so
 * nothing is stranded on the old key. DReps/board never touch this.
 */
export function WalletPanel() {
  const [w, setW] = useState<AdminWalletStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSweep, setConfirmSweep] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const load = useCallback(() => {
    adminApi.wallet().then(setW).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const run = async (tag: string, fn: () => Promise<string>) => {
    setError(null);
    setMsg(null);
    setBusy(tag);
    try {
      setMsg(await fn());
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  const swept = (w?.hotWallet.balanceAda ?? 0) <= 2; // ~empty → safe to rotate

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Anchor hot wallet</h2>
      <p className="mb-3 text-xs text-slate-400">
        The hot wallet pays the small per-decision tx fees. Keep its balance minimal. To rotate the seed (e.g. on
        compromise), first move all funds to the treasury (multisig), then exchange the seed — the new address is
        funded afresh. The seed is never shown.
      </p>
      {error ? <div className="mb-2 text-sm text-red-400">{error}</div> : null}
      {msg ? <div className="mb-2 text-sm text-emerald-400">{msg}</div> : null}

      {!w ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <dl className="space-y-2 text-xs">
            <WalletRow label="Hot wallet" address={w.hotWallet.address} balanceAda={w.hotWallet.balanceAda} configured={w.hotWallet.configured} />
            <WalletRow
              label={w.activeMultisig ? 'Treasury (env legacy)' : 'Treasury (env)'}
              address={w.treasury.address}
              balanceAda={w.treasury.balanceAda}
              configured={w.treasury.configured}
            />
            {/* §15.3 — the assembled multisig is the platform's actual on-chain
                home once it exists. Inbound flows (fees, pledges) route here;
                payouts come from here. Null until board members submit their
                signing keys. */}
            {w.activeMultisig ? (
              <WalletRow
                label={`Active multisig (${w.activeMultisig.threshold}-of-${w.activeMultisig.totalKeys})`}
                address={w.activeMultisig.address}
                balanceAda={w.activeMultisig.balanceAda}
                configured={true}
              />
            ) : (
              <div className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-200">
                <strong>Active multisig: not yet assembled.</strong> The platform is using the env
                <code className="mx-1 font-mono">TREASURY_ADDRESS</code> above as a fallback. Once board members
                submit their signing keys (from <code className="font-mono">/</code> → Treasury), the platform will
                derive the multisig + start routing fees/pledges/payouts to it.
              </div>
            )}
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              disabled={busy !== null || swept || !w.treasury.configured}
              onClick={() => setConfirmSweep(true)}
              className="rounded-md border border-amber-600 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-950 disabled:opacity-40"
            >
              {busy === 'sweep' ? 'Sweeping…' : '1. Move everything to the multisig'}
            </button>
            <button
              disabled={busy !== null || !swept}
              title={swept ? '' : 'Sweep the hot wallet first'}
              onClick={() => setConfirmRotate(true)}
              className="rounded-md border border-red-600 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950 disabled:opacity-40"
            >
              {busy === 'rotate' ? 'Exchanging…' : '2. Exchange the seed'}
            </button>
            <span className="text-xs text-slate-500">{swept ? 'Hot wallet is empty — seed can be exchanged.' : 'Sweep before exchanging the seed.'}</span>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmSweep}
        title="Sweep hot wallet to treasury?"
        message="All hot-wallet funds will move to the treasury multisig immediately (minus the Cardano tx fee + minUTxO dust)."
        confirmLabel="Sweep"
        tone="danger"
        onConfirm={() => { setConfirmSweep(false); void run('sweep', async () => `Swept to treasury — tx ${(await adminApi.sweepWallet()).txHash}`); }}
        onCancel={() => setConfirmSweep(false)}
      />
      <ConfirmDialog
        open={confirmRotate}
        title="Exchange the hot-wallet seed?"
        message="The platform generates a new key; the old one is retired. Fund the new address from the treasury afterwards."
        confirmLabel="Exchange seed"
        tone="danger"
        onConfirm={() => { setConfirmRotate(false); void run('rotate', async () => `Seed exchanged. New hot-wallet address: ${(await adminApi.rotateSeed()).address ?? '(unset)'}`); }}
        onCancel={() => setConfirmRotate(false)}
      />
    </section>
  );
}

function WalletRow({ label, address, balanceAda, configured }: { label: string; address: string | null; balanceAda: number; configured: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-36 shrink-0 font-medium text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1">
        {address ? (
          <>
            <span className="break-all font-mono text-slate-300">{address}</span>
            <span className="ml-2 tabular-nums text-slate-400">· {balanceAda.toLocaleString()} ₳</span>
          </>
        ) : (
          <span className="text-amber-400">{configured ? 'not derivable' : 'not configured'}</span>
        )}
      </dd>
    </div>
  );
}
