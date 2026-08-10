'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi, type GenesisState } from '@/lib/admin-api';
import { parseGenesisFile } from '@/lib/parse-genesis';

const EXAMPLE = `[
  { "name": "Alice", "drep_id": "drep1y22…" },
  { "name": "Dave",  "drep_id": "drep1y26…" },
  { "name": "Erin",  "drep_id": "drep1ygn…" }
]`;

interface Confirm {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function AdminGenesis({ onBoardChange }: { onBoardChange?: () => void }) {
  const [state, setState] = useState<GenesisState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [addId, setAddId] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [invalid, setInvalid] = useState<{ name: string; drep_id: string; reason: string }[]>([]);

  const load = useCallback(() => {
    adminApi.genesis.state().then(setState).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const wrap = async (fn: () => Promise<void>) => {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File) =>
    wrap(async () => {
      const genesis = parseGenesisFile(await file.text());
      const res = await adminApi.genesis.upload(genesis);
      setInvalid(res.invalid);
      const ok = res.proposedBoard.length;
      const bad = res.invalid.length;
      setMsg(
        bad === 0
          ? `Verified ✓ — ${ok} member(s) ready to install.`
          : `Verified ${ok} member(s); skipped ${bad} invalid entr${bad === 1 ? 'y' : 'ies'} (listed below).`,
      );
      load();
    });

  const approve = () =>
    wrap(async () => {
      const res = await adminApi.genesis.approve();
      setInvalid([]);
      setMsg(
        `Installed ${res.seated} new member(s)${res.skippedFull ? `, skipped ${res.skippedFull} (board full)` : ''} — board now ${res.boardCount}/${res.maxBoard}.`,
      );
      load();
      onBoardChange?.();
    });

  const reject = () =>
    wrap(async () => {
      await adminApi.genesis.reject();
      setInvalid([]);
      load();
    });

  const addOne = () =>
    wrap(async () => {
      const next = await adminApi.genesis.addMember(addName.trim(), addId.trim());
      setState(next);
      setMsg(`Added ${addName.trim()} ✓ — board now ${next.boardCount}/${next.maxBoard}.`);
      setAddName('');
      setAddId('');
      onBoardChange?.();
    });

  // Remove a SEATED member (confirmed via the styled modal).
  const removeSeated = (drepId: string, name: string) =>
    setConfirm({
      title: 'Remove board member',
      body: `Remove ${name} from the founding board? They lose Board access on next sign-in. You can re-add them later via the form or a genesis file.`,
      confirmLabel: 'Remove',
      onConfirm: () =>
        wrap(async () => {
          const next = await adminApi.genesis.removeMember(drepId);
          setState(next);
          setMsg(`Removed ${name} — board now ${next.boardCount}/${next.maxBoard}.`);
          onBoardChange?.();
        }),
    });

  // Drop one entry from the staged (verified, not-yet-installed) list.
  const excludeStaged = (drepId: string) =>
    wrap(async () => {
      const remaining = (state?.proposedBoard ?? []).filter((m) => m.drep_id !== drepId);
      if (remaining.length === 0) {
        await adminApi.genesis.reject();
        setMsg('Cleared the staged list.');
      } else {
        await adminApi.genesis.upload(remaining);
        setMsg(`Staged list now has ${remaining.length} member(s).`);
      }
      load();
    });

  if (!state) return <Section title="Genesis">…</Section>;

  return (
    <Section title={`Genesis — founding board (${state.boardCount}/${state.maxBoard})`}>
      {/* Seated members — each removable. */}
      {state.board.length > 0 ? (
        <>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Current board ({state.board.length})
          </div>
          <ul className="mb-4 space-y-1 text-xs">
            {state.board.map((b) => (
              <li key={b.drepId} className="flex items-center justify-between gap-2 rounded border border-slate-700 p-2">
                <div className="min-w-0">
                  <span className="font-medium">{b.displayName}</span>
                  <span className="ml-2 break-all font-mono text-slate-400">{b.drepId}</span>
                </div>
                <button
                  onClick={() => removeSeated(b.drepId, b.displayName)}
                  disabled={busy}
                  className="shrink-0 rounded border border-red-800 px-2 py-1 text-red-300 hover:bg-red-950 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mb-4 text-sm text-slate-400">No board configured.</p>
      )}

      {/* Manual insert — one at a time. */}
      <div className="mb-4 rounded border border-slate-800 p-3">
        <div className="mb-2 text-sm font-medium">Add a board member</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Name (e.g. Alice)"
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm sm:w-40"
          />
          <input
            value={addId}
            onChange={(e) => setAddId(e.target.value)}
            placeholder="drep1…"
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs"
          />
          <button
            onClick={addOne}
            disabled={busy || !addName.trim() || !addId.trim() || !state.canAddMore}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Add'}
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Verified on-chain — only a registered, active DRep can be added.
        </p>
      </div>

      {/* File upload — bulk, incremental. */}
      {state.canAddMore ? (
        <>
          <p className="text-sm text-slate-400">
            Or upload a genesis file — a JSON array of <code>{'{ "name", "drep_id" }'}</code> objects (or a{' '}
            <code>{'{ "Name": "drep1…" }'}</code> map). Re-uploading is incremental: only new DReps are added,
            up to {state.maxBoard} total.
          </p>
          <pre className="my-2 overflow-x-auto rounded border border-slate-800 bg-slate-950 p-2 text-[11px] text-slate-400">{EXAMPLE}</pre>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ''; // reset so re-selecting the SAME file fires onChange again
              if (f) onFile(f);
            }}
            className="text-sm"
          />
          {state.proposedBoard ? (
            <div className="mt-3 space-y-1">
              <div className="text-sm font-medium">Verified — ready to install ({state.proposedBoard.length}):</div>
              <ul className="space-y-1 text-xs">
                {state.proposedBoard.map((m) => (
                  <li key={m.drep_id} className="flex items-center justify-between gap-2 rounded border border-slate-700 p-2">
                    <div className="min-w-0">
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 break-all font-mono text-slate-400">{m.drep_id}</span>
                    </div>
                    <button
                      onClick={() => excludeStaged(m.drep_id)}
                      disabled={busy}
                      title="Drop this entry before installing"
                      className="shrink-0 rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button onClick={approve} disabled={busy} className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                  {busy ? 'Installing…' : 'Approve & install'}
                </button>
                <button onClick={reject} disabled={busy} className="mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-50">
                  Discard all
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-emerald-400">✓ Board is full ({state.maxBoard}/{state.maxBoard}). Remove a member to add another.</p>
      )}

      {invalid.length > 0 ? (
        <div className="mt-3 rounded border border-amber-800 bg-amber-950/40 p-2">
          <div className="text-xs font-semibold text-amber-300">
            Skipped {invalid.length} invalid entr{invalid.length === 1 ? 'y' : 'ies'} (not added):
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {invalid.map((m, i) => (
              <li key={`${m.drep_id}-${i}`} className="text-amber-200/90">
                <span className="font-medium">{m.name}</span> — {m.reason}
                <span className="ml-1 break-all font-mono text-amber-200/60">{m.drep_id}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {msg ? <div className="mt-2 text-sm text-emerald-400">{msg}</div> : null}
      {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}

      {confirm ? (
        <ConfirmModal
          confirm={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </Section>
  );
}

function ConfirmModal({ confirm, busy, onClose }: { confirm: Confirm; busy: boolean; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-100">{confirm.title}</h3>
        <p className="mt-2 text-sm text-slate-400">{confirm.body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              confirm.onConfirm();
              onClose();
            }}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </section>
  );
}
