'use client';

import { useEffect, useState } from 'react';
import { meApi } from '@/lib/api';
import { invalidateConfig } from '@/lib/explorer';
import { useT } from '@/lib/prefs-context';

const OPTIONS = [
  { value: '', label: 'Platform default' },
  { value: 'cardanoscan', label: 'Cardanoscan' },
  { value: 'cexplorer', label: 'Cexplorer' },
  { value: 'adastat', label: 'AdaStat' },
];

/** §20 — personal preferences. Each member picks the block explorer used for their on-chain links. */
export function PreferencesPanel() {
  const t = useT();
  const [explorer, setExplorer] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    meApi.preferences().then((p) => setExplorer(p.explorer ?? '')).catch(() => undefined);
  }, []);

  const save = async () => {
    setError(null); setBusy(true); setSaved(false);
    try {
      await meApi.setPreferences({ explorer, explorerCustomTxUrl: '' });
      invalidateConfig(); // links re-resolve with the new choice
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('save failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h3 className="text-base font-semibold">{t('Preferences')}</h3>
      <p className="mb-2 text-sm text-neutral-500">{t('Choose the block explorer used for your on-chain links across the platform.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          {t('Block explorer')}{' '}
          <select
            value={explorer}
            onChange={(e) => { setExplorer(e.target.value); setSaved(false); }}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === '' ? t(o.label) : o.label}</option>)}
          </select>
        </label>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md border border-emerald-500 px-2.5 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          {busy ? t('Saving…') : t('Save')}
        </button>
        {saved ? <span className="text-xs text-emerald-600">{t('Saved ✓')}</span> : null}
      </div>
      {error ? <div className="mt-1 text-sm text-red-600">{error}</div> : null}
    </section>
  );
}
