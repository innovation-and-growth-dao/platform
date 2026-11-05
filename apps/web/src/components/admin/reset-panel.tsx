'use client';

import { useState } from 'react';
import { adminApi } from '@/lib/admin-api';
import { ConfirmDialog } from '../confirm-dialog';

/**
 * §23 — destructive admin reset. Wipes DAO state (proposals / rounds / board /
 * multisig / votes / hot-wallet sweeps / etc.) so testnet rehearsals can
 * start from a clean slate. Keeps:
 *   • admin accounts + their audit log (you stay logged in),
 *   • the anchor hot-wallet seed (rotate that as a separate step),
 *   • platform_config overrides (governance parameters stay tuned).
 *
 * After running: re-upload founding-board JSON → board members provide their
 * multisig signing keys → platform assembles the multisig → fund it → test
 * the full round flow.
 */
export function ResetPanel({ onReset }: { onReset?: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doReset = async () => {
    setConfirming(false);
    setMsg(null); setError(null); setBusy(true);
    try {
      const r = await adminApi.resetDaoState();
      setMsg(`DAO state wiped (${r.wipedTables} tables truncated). You can now re-upload the founding-board JSON above.`);
      // Tell the parent so it can re-mount the Genesis + Wallet panels (they
      // cache their data on mount; without this they'd keep showing the
      // pre-reset board until the user hard-refreshes the page).
      onReset?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-red-700/60 bg-red-950/30 p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-red-300">Danger zone — reset DAO state</h2>
      <p className="text-xs text-neutral-700 dark:text-slate-300">
        Wipes proposals, rounds, board seats, the multisig config + collected keys, all votes, anchor history,
        rewards, and stop-funding records. <strong>Keeps</strong> admin accounts, the admin audit log, the anchor
        hot-wallet seed, and governance configuration. After this you can re-upload the founding-board file and
        run a fresh test round.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          disabled={busy}
          onClick={() => setConfirming(true)}
          className="rounded border border-red-600 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-40"
        >
          {busy ? 'Wiping…' : 'Reset DAO state'}
        </button>
        {msg ? <span className="text-xs text-emerald-400">{msg}</span> : null}
        {error ? <span className="text-xs text-red-400">{error}</span> : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Wipe DAO state?"
        tone="danger"
        confirmLabel="Wipe everything"
        message={
          <>
            This will <strong>permanently delete</strong> every proposal, round, board seat, multisig key, vote,
            anchor record, reward, and stop-funding row. Admin accounts and the anchor wallet stay.
            <br /><br />
            Use only on testnet, never on a live DAO.
          </>
        }
        onConfirm={doReset}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
