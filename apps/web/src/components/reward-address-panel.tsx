'use client';

import { useEffect, useState } from 'react';
import { rewardAddressApi } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

/**
 * §15.4 — DReps (and board members) provide a Cardano payment address to
 * receive their rewards. Editable; historical RewardEntry rows stamp the
 * address they were paid to so updates do not rewrite history. When empty,
 * shows an amber nag so the member knows they won't be paid until they fill
 * this in.
 */
export function RewardAddressPanel() {
  const t = useT();
  const [address, setAddress] = useState<string>('');
  const [original, setOriginal] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    rewardAddressApi
      .get()
      .then((r) => { setAddress(r.rewardPaymentAddress ?? ''); setOriginal(r.rewardPaymentAddress ?? ''); })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setError(null); setSaved(false); setBusy(true);
    try {
      const r = await rewardAddressApi.set(address.trim() || null);
      setOriginal(r.rewardPaymentAddress ?? '');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('save failed'));
    } finally { setBusy(false); }
  };

  const dirty = address.trim() !== (original ?? '');
  const missing = !original;

  return (
    <section className={`rounded-lg border p-4 ${missing
      ? 'border-amber-300 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30'
      : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'}`}>
      <h3 className="text-base font-semibold">{t('Reward payment address')}</h3>
      <p className="mt-1 text-sm text-neutral-500">
        {t('Cardano payment address')} (<code className="font-mono text-xs">addr…</code> / <code className="font-mono text-xs">addr_test…</code>)
        {' '}{t('where the platform sends your rewards. Editable; old payouts keep their then-current destination on the Treasury history.')}
      </p>
      {missing ? (
        <div className="mt-2 rounded border border-amber-300 bg-amber-100/60 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          {t('⚠ You haven\'t set a reward address yet — rewards owed to you will be queued but cannot be paid until you provide one.')}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={address}
          onChange={(e) => { setAddress(e.target.value); setSaved(false); }}
          placeholder={t('addr1… or addr_test1…')}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          disabled={busy || !dirty}
          onClick={save}
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
