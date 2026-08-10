'use client';

import { useCallback, useEffect, useState } from 'react';
import { multisigApi, type MultisigStatus, type MultisigHistoryEntry, type MultisigActiveConfig } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { CopyButton } from './copy-button';

const MULTISIG_KEY_MESSAGE = (stakeAddress: string, paymentBech32: string, ts: string) =>
  ['drep-dao | multisig key attestation', `seat:${stakeAddress}`, `pay:${paymentBech32}`, `ts:${ts}`].join('\n');

/**
 * §15 — multisig setup + rotation panel.
 * Normal state: one active multisig (script address + balance) + the board roster + a key form.
 * During a board hand-over (rotationInProgress) it splits into TWO clearly-labelled panels —
 *   • NEW BOARD MULTISIG (top): the incoming board collecting keys (each member's known key is
 *     pre-filled, editable);
 *   • OLD BOARD MULTISIG (below): the current wallet that holds the funds until the new one
 *     assembles, after which the funds auto-migrate.
 * Old multisigs that still hold funds appear in the history with a "Migrate funds" CTA.
 */
export function MultisigSetup({ onAssembled }: { onAssembled?: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<MultisigStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    multisigApi.status().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  const reload = useCallback(() => {
    load();
    onAssembled?.();
  }, [load, onAssembled]);

  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const mySeat = status?.seats.find((s) => s.userId === profile?.user.id);

  const [showRoster, setShowRoster] = useState(true);
  const [showHistory, setShowHistory] = useState(true);
  const [changingKey, setChangingKey] = useState(false);

  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!status) return null;

  // Post-assembly migration in flight (active = NEW, a predecessor still holds funds).
  const migrating = status.history.some((h) => h.balanceAda > 0) || status.migrationsPending.length > 0;
  // Pre-assembly hand-over: a new board is collecting keys; the active config is still the OLD one.
  const rotating = status.rotationInProgress;

  // Board roster + per-seat key status (reused in both layouts).
  const roster = (
    <ul className="space-y-1 text-xs">
      {status.seats.map((s) => (
        <li key={s.seatId} className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-medium">{s.displayName}</span>
              <span className="ml-2 break-all font-mono text-[11px] text-neutral-500">{s.drepId}</span>
            </div>
            {s.hasKey ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                ✓ {t('key submitted')}{s.hardwareAttested ? ' · HW' : ''}
              </span>
            ) : (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                ⏳ {t('awaiting key')}
              </span>
            )}
          </div>
          {s.hasKey && s.paymentBech32 ? <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{s.paymentBech32}</div> : null}
          {s.hasKey && s.keyHash ? <div className="mt-0.5 text-[11px] text-neutral-500">{t('key hash:')} <span className="font-mono">{s.keyHash}</span></div> : null}
        </li>
      ))}
    </ul>
  );

  // Current board member's key block: the submit form (pre-filled with any known credential) or a
  // "submitted — change my key" note that reveals the pre-filled form.
  const myKeyBlock = isBoard && mySeat ? (
    !mySeat.hasKey || changingKey ? (
      <SubmitKeyForm
        initialAddress={mySeat.paymentBech32 ?? ''}
        onChange={() => { setChangingKey(false); reload(); }}
        onCancel={mySeat.hasKey ? () => setChangingKey(false) : undefined}
      />
    ) : (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
        <span>✓ {t('You\'ve submitted your multisig key.')}</span>
        <button type="button" onClick={() => setChangingKey(true)} className="rounded border border-neutral-400 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">
          {t('Change my key')}
        </button>
      </div>
    )
  ) : null;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{t('Treasury multisig — setup')}</h3>
        <span className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
          {t('Required:')} {status.threshold}-of-{status.total} · {t('Submitted:')} {status.submitted}/{status.total}
        </span>
      </div>

      {rotating ? (
        <>
          {/* ── NEW BOARD MULTISIG (top): the incoming board sets up its wallet ── */}
          <div className="mt-3 rounded-lg border-2 border-emerald-500 bg-emerald-50/50 p-3 dark:border-emerald-700 dark:bg-emerald-950/30">
            <div className="rounded-md bg-emerald-100 px-3 py-1.5 text-center text-sm font-extrabold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
              {t('NEW BOARD MULTISIG')}
            </div>
            <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
              <strong>{status.submitted}/{status.total} {t('keys collected')}.</strong>{' '}
              {t('Each new board member submits their hardware signing key; the platform assembles the new multisig once all keys are in, then moves the funds over.')}
            </p>
            <div className="mt-2">{roster}</div>
            {myKeyBlock}
          </div>

          {/* ── OLD BOARD MULTISIG (below): the current wallet, holds the funds ── */}
          {status.active ? (
            <div className="mt-3 rounded-lg border-2 border-amber-500 bg-amber-50/50 p-3 dark:border-amber-600 dark:bg-amber-950/30">
              <div className="rounded-md bg-amber-100 px-3 py-1.5 text-center text-sm font-extrabold uppercase tracking-wide text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                {t('OLD BOARD MULTISIG')}
              </div>
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
                {t('Current treasury — holds the funds. It stays active until the new multisig is assembled, then the funds migrate to it automatically.')}
              </p>
              <ConfigCard cfg={status.active} />
              {/* Old board roster — names + addresses of the signers on the current (old) multisig. */}
              {status.active.signers && status.active.signers.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs">
                  {status.active.signers.map((s) => (
                    <li key={s.keyHash} className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.displayName ?? '—'}</span>
                        {s.drepId ? <span className="break-all font-mono text-[11px] text-neutral-500">{s.drepId}</span> : null}
                      </div>
                      {s.paymentBech32 ? <div className="mt-1 break-all font-mono text-[11px] text-neutral-500">{s.paymentBech32}</div> : null}
                      <div className="mt-0.5 text-[11px] text-neutral-500">{t('key hash:')} <span className="font-mono">{s.keyHash}</span></div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* ── Normal (single multisig) ── */}
          {migrating && status.active ? (
            <div className="mt-3 rounded-md border-2 border-emerald-500 bg-emerald-100 px-3 py-1.5 text-center text-sm font-extrabold uppercase tracking-wide text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200">
              {t('NEW BOARD MULTISIG')}
            </div>
          ) : null}
          {status.active ? (
            <>
              <ConfigCard cfg={status.active} />
              {status.active.balanceAda === 0 ? (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <div className="font-semibold">{t('Bootstrap funds to start using this multisig')}</div>
                  <p className="mt-1">
                    {t('The multisig is assembled but on-chain balance is')} <strong>0 ₳</strong>. {t('Send some tADA to the script address above from any wallet that controls funds (e.g. the legacy treasury wallet, or any board member\'s personal wallet). Inbound flows (submission fees, pledges) already route here automatically — they\'ll pile up once proposals start.')}
                  </p>
                  <p className="mt-1 text-[11px]">
                    {t('Outbound payouts work via the standard board signing flow once')} {status.active.threshold}-of-{status.active.totalKeys}{' '}
                    {t('board members have signed via')} <strong>{t('Actions → Approve & sign')}</strong> {t('(each click signs the tx with their HW wallet; the platform combines witnesses + broadcasts on the 3rd signature).')}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-2 rounded border border-amber-300 bg-amber-100/50 p-2 text-xs dark:border-amber-900 dark:bg-amber-900/30">
              <strong>{t('Multisig not yet built.')}</strong> {t('Every board seat must submit a payment verification key before the platform can assemble the on-chain script.')}
            </div>
          )}

          {/* Per-seat roster (collapsible). */}
          <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setShowRoster((v) => !v)}
              className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              <span>{t('Board roster')} ({status.submitted}/{status.total} {t('keys submitted')})</span>
              <span>{showRoster ? `▾ ${t('hide')}` : `▸ ${t('show')}`}</span>
            </button>
            {showRoster ? <div className="px-2 pb-2">{roster}</div> : null}
          </div>

          {myKeyBlock}
        </>
      )}

      {/* §15.2 — previous multisigs (collapsible). Each entry shows live balance + a "Migrate
          funds" CTA (board members only) when funds remain at the old address. */}
      {status.history.length > 0 ? (
        <div className="mt-3 rounded border border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
          >
            <span>
              {t('Previous multisigs')} ({status.history.length})
              {status.history.some((h) => h.balanceAda > 0)
                ? <> · <span className="text-amber-700 dark:text-amber-300">⚠ {status.history.filter((h) => h.balanceAda > 0).length} {t('still hold funds — migration pending')}</span></>
                : null}
            </span>
            <span>{showHistory ? `▾ ${t('hide')}` : `▸ ${t('show')}`}</span>
          </button>
          {showHistory ? (
            <ul className="space-y-2 px-2 pb-2">
              {status.history.map((h) => (
                <HistoryRow
                  key={h.id}
                  h={h}
                  isBoard={isBoard}
                  pending={status.migrationsPending.find((m) => m.fromConfigId === h.id) ?? null}
                  onChange={reload}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The assembled multisig's on-chain details: threshold, balance, script address + hash. */
function ConfigCard({ cfg }: { cfg: MultisigActiveConfig }) {
  const t = useT();
  return (
    <div className="mt-2 rounded border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
      <div className="font-semibold text-emerald-800 dark:text-emerald-200">
        ✓ {t('Active multisig')} · {cfg.threshold}-of-{cfg.totalKeys} · {cfg.balanceAda.toLocaleString()} ₳ {t('on-chain')}
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">{t('Script address (on-chain home)')}</div>
      <div className="mt-0.5 flex items-start gap-2">
        <div className="flex-1 break-all font-mono text-[11px] text-neutral-700 dark:text-neutral-300">{cfg.bech32Address}</div>
        <CopyButton text={cfg.bech32Address} label={t('Copy')} />
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">{t('Script hash:')} <span className="font-mono">{cfg.scriptHash}</span></div>
    </div>
  );
}

function HistoryRow({ h, isBoard, pending, onChange }: { h: MultisigHistoryEntry; isBoard: boolean; pending: { id: string; status: string; approvals: number; threshold: number } | null; onChange: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prepare = async () => {
    setError(null); setBusy(true);
    try { await multisigApi.prepareMigration(h.id); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(false); }
  };
  const hasFunds = h.balanceAda > 0;
  return (
    <li className={`rounded border bg-white p-2 text-xs dark:bg-neutral-900 ${hasFunds ? 'border-2 border-amber-500 dark:border-amber-600' : 'border-neutral-200 dark:border-neutral-800'}`}>
      {/* §15.2 — big OLD BOARD MULTISIG banner while this predecessor still holds funds. */}
      {hasFunds ? (
        <div className="mb-2 rounded-md border-2 border-amber-500 bg-amber-100 px-3 py-1 text-center text-sm font-extrabold uppercase tracking-wide text-amber-800 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-200">
          {t('OLD BOARD MULTISIG')}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {h.threshold}-of-{h.totalKeys} {t('multisig')}
          <span className="ml-2 text-neutral-500">{t('created')} {new Date(h.assembledAt).toLocaleDateString()} · {t('replaced')} {new Date(h.replacedAt).toLocaleDateString()}</span>
          {h.terminatedAt && !hasFunds ? <span className="ml-2 text-neutral-500">· {t('terminated')} {new Date(h.terminatedAt).toLocaleDateString()}</span> : null}
        </span>
        <span className={`tabular-nums ${hasFunds ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'}`}>
          {h.balanceAda.toLocaleString()} ₳ {t('on-chain')}
        </span>
      </div>
      <div className="mt-1">
        <div className="text-[11px] text-neutral-500">{t('Script address')}</div>
        <div className="mt-0.5 flex items-start gap-2">
          <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{h.bech32Address}</div>
          <CopyButton text={h.bech32Address} label={t('Copy')} />
        </div>
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">
        {t('Signers:')} {h.keyHashes.length} {h.keyHashes.length === 1 ? t('key') : t('keys')} ({t('need')} {h.threshold} {t('to migrate')})
      </div>
      {pending ? (
        <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] dark:border-amber-900 dark:bg-amber-950/40">
          {t('Migration prepared')} · {pending.approvals}/{pending.threshold} {t('old-board signatures')} · {t('status:')} <span className="font-mono">{pending.status}</span>
        </div>
      ) : hasFunds && isBoard ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={prepare}
            disabled={busy}
            className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
          >
            {busy ? '…' : t('Prepare migration to active multisig')}
          </button>
          {error ? <span className="text-red-600">{error}</span> : null}
        </div>
      ) : !hasFunds ? (
        <div className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">✓ {t('Empty — no migration needed.')}</div>
      ) : null}
    </li>
  );
}

/** Board member's key-submission form: paste an HW-wallet payment address (pre-filled with any
 *  known signing key), attest HW, sign a CIP-30 challenge with that wallet, submit. */
function SubmitKeyForm({ onChange, initialAddress = '', onCancel }: { onChange: () => void; initialAddress?: string; onCancel?: () => void }) {
  const t = useT();
  const { profile, signMessage } = useAuth();
  const [paymentBech32, setPaymentBech32] = useState(initialAddress);
  const [hardware, setHardware] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!profile) { setError(t('Connect a wallet first.')); return; }
    const addr = paymentBech32.trim();
    if (!/^addr(_test)?[a-z0-9]+$/i.test(addr)) {
      setError(t('Paste a Cardano payment address (addr… / addr_test…) from your hardware wallet.'));
      return;
    }
    if (!hardware) { setError(t('Please confirm the key is on a hardware wallet.')); return; }
    setBusy(true);
    try {
      const ts = new Date().toISOString();
      const message = MULTISIG_KEY_MESSAGE(profile.user.stakeAddress, addr, ts);
      const sig = await signMessage(message);
      if (!sig) {
        setError(t('Could not reach a wallet to sign. Open the HW-wallet extension and try again.'));
        return;
      }
      await multisigApi.submitKey({ paymentBech32: addr, hardwareAttested: hardware, signature: sig.signature, key: sig.key, ts });
      setPaymentBech32('');
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded border border-emerald-300 bg-white p-3 text-sm dark:border-emerald-900 dark:bg-neutral-900">
      <div className="text-sm font-semibold">{t('Submit your multisig signing key')}</div>
      <p className="mt-1 text-xs text-neutral-500">
        {t('Paste a payment address from your')} <strong>{t('hardware wallet')}</strong> {t('(Ledger / Trezor / Keystone…). This can be a different wallet from the one you use for your DRep identity — that\'s fine. The platform extracts the payment key hash from this address and uses it in the native multisig script.')}
      </p>
      <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        ⚠ {t('Use only a hardware wallet. The platform cannot verify HW-vs-hot from the signature alone — you must attest below. Submitting a hot-wallet key weakens the entire multisig.')}
      </div>
      <label className="mt-2 block text-xs font-medium">
        {t('Payment address (HW wallet)')}
        <input
          value={paymentBech32}
          onChange={(e) => setPaymentBech32(e.target.value)}
          placeholder={t('addr_test1… (Preprod) or addr1… (Mainnet)')}
          className="mt-1 block w-full rounded border border-neutral-300 px-2 py-1 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>
      {initialAddress ? <p className="mt-1 text-[11px] text-neutral-500">{t('Pre-filled from your known signing key — change it if you want.')}</p> : null}
      <label className="mt-2 flex items-start gap-2 text-xs">
        <input type="checkbox" checked={hardware} onChange={(e) => setHardware(e.target.checked)} className="mt-0.5" />
        <span>{t('I attest this key is stored on a hardware wallet, not a hot/browser/file wallet.')}</span>
      </label>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          disabled={busy || !paymentBech32.trim() || !hardware}
          onClick={submit}
          className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? t('Verifying signature…') : t('Sign with HW wallet & submit')}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="rounded border border-neutral-400 px-2.5 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800">
            {t('Cancel')}
          </button>
        ) : null}
        <span className="text-[11px] text-neutral-500">{t('Your wallet will pop a sign-data request.')}</span>
      </div>
    </div>
  );
}
