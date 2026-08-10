'use client';

import { useEffect, useState } from 'react';
import { governanceApi, type GovParam } from '@/lib/api';
import { invalidateConfig } from '@/lib/explorer';
import { useT } from '@/lib/prefs-context';

const EXPLORER_OPTIONS = ['cardanoscan', 'cexplorer', 'adastat'];

// §15/§20 — multisig signing ceremony. 1-Phase (default) needs a wallet that signs
// native-script txs without being named in the body (Eternl); 2-Phase is the
// universal CIP-30 backup.
const SIGNING_PROCESS_OPTIONS = [
  { value: '1_PHASE', label: '1-Phase (default — requires Eternl wallet)' },
  { value: '2_PHASE', label: '2-Phase (backup — any CIP-30 wallet)' },
];

// Params that are stored + editable but not yet read by any feature (the feature
// itself isn't built). Shown with a "not yet wired" note so the board isn't misled.
const NOT_YET_WIRED: Record<string, string> = {};

// §14.1 — each entry-gate param is governed by a switch; when the switch is off the
// param is shadowed/disabled (not applied), so it's clear which switch controls what.
const CONTROLLED_BY: Record<string, string> = {
  MIN_OWN_VOTING_POWER_ADA: 'ENTRY_REQUIRE_VOTING_POWER',
  MIN_DELEGATORS: 'ENTRY_REQUIRE_VOTING_POWER',
  MIN_DELEGATOR_STAKE_ADA: 'ENTRY_REQUIRE_VOTING_POWER',
  MINIMUM_VOTES_CASTED: 'ENTRY_REQUIRE_ACTIVITY',
  MINIMUM_DREP_ACTIVITY: 'ENTRY_REQUIRE_ACTIVITY',
  ONLY_VOTES_WITH_RATIONALE: 'ENTRY_REQUIRE_ACTIVITY',
};

/** §6/§28 — board edits platform governance parameters. */
export function GovernanceSetup() {
  const t = useT();
  const [params, setParams] = useState<GovParam[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    governanceApi
      .list()
      .then((p) => {
        setParams(p);
        setEdits(Object.fromEntries(p.map((x) => [x.key, String(x.value)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('failed')));
  useEffect(() => {
    load();
  }, []);

  const save = async (p: GovParam) => {
    setError(null);
    setMsg(null);
    setBusy(p.key);
    try {
      const raw = edits[p.key];
      const value = p.type === 'boolean' ? raw === 'true' : p.type === 'number' ? Number(raw) : raw;
      await governanceApi.update(p.key, value);
      setMsg(`${t('Saved')} ${p.key}.`);
      // Explorer change → re-resolve all on-chain links live (no refresh needed).
      if (p.key.startsWith('CARDANO_EXPLORER')) invalidateConfig();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{t('Platform setup')}</h2>
        <p className="text-sm text-neutral-500">
          {t('Governance parameters (§6/§28). Changes apply to subsequent actions; defaults shown for reference.')}
        </p>
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {msg ? <div className="text-sm text-emerald-600">{msg}</div> : null}

      {/* §18 — the anchor hot wallet is managed by platform admins in the admin area, not here. */}
      <p className="text-xs text-neutral-500">
        {t('Platform wallets (the anchor hot wallet + treasury) are managed by platform administrators in the admin area — DReps and the board don’t handle the hot-wallet key.')}
      </p>
      {!params ? (
        <p className="text-sm text-neutral-500">{t('Loading…')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2">{t('Parameter')}</th>
                <th className="px-3 py-2">{t('New value')}</th>
                <th className="px-3 py-2">{t('Saved')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => {
                const dirty = edits[p.key] !== String(p.value);
                const ctrlKey = CONTROLLED_BY[p.key];
                // A controlled param is shadowed when its switch is currently off (live, from edits).
                const gatedOff = !!ctrlKey && edits[ctrlKey] !== 'true';
                const isSwitch = p.key.startsWith('ENTRY_REQUIRE_');
                const inputCls = 'w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-100 disabled:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900 dark:disabled:bg-neutral-800';
                return (
                  <tr
                    key={p.key}
                    className={`border-t border-neutral-200 align-top dark:border-neutral-800 ${
                      ctrlKey ? 'border-l-2 border-l-emerald-300 dark:border-l-emerald-800' : ''
                    } ${gatedOff ? 'opacity-40' : ''} ${isSwitch ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''}`}
                  >
                    <td className="px-3 py-1.5">
                      <div className="font-mono text-xs">{ctrlKey ? '↳ ' : ''}{p.key}{isSwitch ? ' (switch)' : ''}</div>
                      {p.description ? (
                        <div className="mt-0.5 max-w-xs text-xs font-normal text-neutral-500">{p.description}</div>
                      ) : null}
                      {ctrlKey ? (
                        <div className="mt-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          {gatedOff ? `${t('not applied — enable')} ${ctrlKey}` : `${t('applied')} (${ctrlKey} ${t('on')})`}
                        </div>
                      ) : null}
                      {NOT_YET_WIRED[p.key] ? (
                        <div className="mt-0.5 text-[10px] font-medium text-amber-600" title={t('Saved, but no feature reads this value yet.')}>
                          ⏳ {t('not yet wired —')} {NOT_YET_WIRED[p.key]}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      {p.type === 'boolean' ? (
                        <select
                          value={edits[p.key] ?? 'false'}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                          disabled={gatedOff}
                          className={inputCls}
                        >
                          <option value="true">{t('Enabled')}</option>
                          <option value="false">{t('Disabled')}</option>
                        </select>
                      ) : p.key === 'TX_SIGNING_PROCESS' ? (
                        <div>
                          <select
                            value={edits[p.key] ?? '1_PHASE'}
                            onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                            className={inputCls + ' w-auto'}
                          >
                            {SIGNING_PROCESS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{t(o.label)}</option>
                            ))}
                          </select>
                          <div className="mt-0.5 max-w-xs text-[10px] text-neutral-500">
                            {t('1-Phase (default): every board member signs once — requires the')} <strong>Eternl</strong> {t('wallet.')}
                            {' '}{t('If a member’s wallet can’t sign, switch to 2-Phase (the backup — works with any CIP-30 wallet).')}
                          </div>
                        </div>
                      ) : p.key === 'CARDANO_EXPLORER' ? (
                        <select
                          value={edits[p.key] ?? ''}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                          className={inputCls}
                        >
                          {EXPLORER_OPTIONS.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={edits[p.key] ?? ''}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                          inputMode={p.type === 'number' ? 'decimal' : 'text'}
                          disabled={gatedOff}
                          className={inputCls}
                        />
                      )}
                    </td>
                    {/* Current SAVED value (updates after Save), with the default as a hint. */}
                    <td className="px-3 py-1.5 text-xs">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        {p.type === 'boolean' ? (p.value ? t('Enabled') : t('Disabled')) : String(p.value)}
                      </span>
                      <span className="ml-1 text-neutral-400">
                        ({t('default')} {p.type === 'boolean' ? (p.default ? t('Enabled') : t('Disabled')) : String(p.default)})
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => save(p)}
                        disabled={busy === p.key || !dirty || gatedOff}
                        className="rounded-md border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      >
                        {busy === p.key ? t('Saving…') : t('Save')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
