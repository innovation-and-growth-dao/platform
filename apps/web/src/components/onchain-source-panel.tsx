'use client';

import { useCallback, useEffect, useState } from 'react';
import { onchainSourceApi, type OnchainSourceConfig } from '@/lib/api';

const SOURCE_LABEL: Record<string, string> = {
  koios: 'Koios (public API)',
  blockfrost: 'Blockfrost (API key)',
  dbsync: 'cardano-db-sync (self-hosted)',
};
const SOURCE_HINT: Record<string, string> = {
  koios: 'Free public tier, no key. Works out of the box.',
  blockfrost: 'Needs a project id (below). Independent of Koios — a good fallback.',
  dbsync: 'Your own db-sync Postgres (no rate limit). Needs the connection URL (below).',
};

/**
 * §22 — On-chain data source. The board sets the ordered fallback list (each read tries the
 * sources first→last until one succeeds) and the credentials for Blockfrost / db-sync. Keys are
 * write-only: the server returns only a masked hint, never the raw value.
 */
export function OnchainSourcePanel() {
  const [cfg, setCfg] = useState<OnchainSourceConfig | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [koiosToken, setKoiosToken] = useState('');
  const [showKoiosToken, setShowKoiosToken] = useState(false);
  const [bfKey, setBfKey] = useState('');
  const [dbsUrl, setDbsUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    onchainSourceApi.get()
      .then((c) => { setCfg(c); setOrder(c.order); setShowKoiosToken(c.koios.tokenConfigured); })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed to load'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (tag: string, fn: () => Promise<OnchainSourceConfig>, okMsg: string) => {
    setBusy(tag); setError(null); setMsg(null);
    try { const c = await fn(); setCfg(c); setOrder(c.order); setMsg(okMsg); }
    catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setBusy(null); }
  };

  if (!cfg) {
    return <section className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">{error ?? 'Loading on-chain source…'}</section>;
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]]; setOrder(next);
  };
  const toggle = (s: string) => setOrder(order.includes(s) ? order.filter((x) => x !== s) : [...order, s]);
  const orderDirty = JSON.stringify(order) !== JSON.stringify(cfg.order);

  // Warn when a source is in the order but has no credentials — it will just be skipped.
  const missingCred = order.filter((s) => (s === 'blockfrost' && !cfg.blockfrost.configured) || (s === 'dbsync' && !cfg.dbsync.configured));
  const noFallback = order.length < 2 || order.every((s) => s === order[0]);

  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div>
        <h3 className="text-base font-semibold">On-chain data source</h3>
        <p className="text-xs text-neutral-500">
          Where the platform reads DRep registration, voting power and balances from ({cfg.network}).
          Each read tries the sources in order until one answers, so a second source is your uptime fallback.
        </p>
      </div>

      {error ? <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
      {msg ? <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">{msg}</div> : null}

      {/* Priority order */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Priority order</div>
        <ul className="mt-2 space-y-1">
          {order.map((s, i) => (
            <li key={s} className="flex items-center justify-between gap-2 rounded border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-800">
              <span>
                <span className="text-neutral-400">{i + 1}.</span>{' '}
                <span className="font-medium">{SOURCE_LABEL[s] ?? s}</span>
                {missingCred.includes(s) ? <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400">⚠ no credentials — will be skipped</span> : null}
              </span>
              <span className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded border border-neutral-300 px-1.5 leading-5 disabled:opacity-30 dark:border-neutral-700" title="Up">▲</button>
                <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="rounded border border-neutral-300 px-1.5 leading-5 disabled:opacity-30 dark:border-neutral-700" title="Down">▼</button>
                {order.length > 1 ? <button onClick={() => toggle(s)} className="ml-1 rounded border border-neutral-300 px-1.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700" title="Remove">✕</button> : null}
              </span>
            </li>
          ))}
        </ul>
        {/* Add sources not yet in the order */}
        {cfg.available.filter((s) => !order.includes(s)).length ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-neutral-500">Add:</span>
            {cfg.available.filter((s) => !order.includes(s)).map((s) => (
              <button key={s} onClick={() => toggle(s)} className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">+ {SOURCE_LABEL[s] ?? s}</button>
            ))}
          </div>
        ) : null}
        {noFallback ? <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">⚠ Only one source in use — no fallback. Add Blockfrost or db-sync so a Koios outage doesn’t take on-chain reads down.</p> : null}
        <button
          onClick={() => act('order', () => onchainSourceApi.update({ order }), 'Order saved')}
          disabled={busy !== null || !orderDirty}
          className="mt-2 rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy === 'order' ? 'Saving…' : orderDirty ? 'Save order' : 'Order saved'}
        </button>
      </div>

      {/* Koios token (optional) */}
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Koios API token <span className="text-xs font-normal text-neutral-500">(optional)</span></span>
          <span className="text-xs">{cfg.koios.tokenConfigured ? <span className="text-emerald-600 dark:text-emerald-400">✓ token set ({cfg.koios.hint})</span> : <span className="text-neutral-400">keyless (free tier)</span>}</span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          Without a token the <strong>free keyless Koios tier</strong> is used — that’s the default and it works.
          Adding a token authenticates Koios for <strong>higher rate limits</strong> (fewer 429s under load).
        </p>
        <label className="mt-2 flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
          <input type="checkbox" checked={showKoiosToken} onChange={(e) => setShowKoiosToken(e.target.checked)} />
          Provide an API token
        </label>
        {showKoiosToken ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="password" autoComplete="off" value={koiosToken} onChange={(e) => setKoiosToken(e.target.value)}
              placeholder={cfg.koios.tokenConfigured ? 'enter a new token to replace' : 'paste your Koios API token'}
              className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button onClick={() => act('kt', () => onchainSourceApi.update({ koiosApiToken: koiosToken }).then((c) => { setKoiosToken(''); return c; }), 'Koios token saved')} disabled={busy !== null || !koiosToken.trim()} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'kt' ? 'Saving…' : 'Save token'}</button>
            {cfg.koios.tokenConfigured ? <button onClick={() => act('ktclear', () => onchainSourceApi.update({ koiosApiToken: '' }), 'Koios token cleared')} disabled={busy !== null} className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">Clear</button> : null}
          </div>
        ) : null}
      </div>

      {/* Blockfrost key */}
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Blockfrost project id</span>
          <span className="text-xs">{cfg.blockfrost.configured ? <span className="text-emerald-600 dark:text-emerald-400">✓ set ({cfg.blockfrost.hint})</span> : <span className="text-neutral-400">not set</span>}</span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">{SOURCE_HINT.blockfrost} Get a free one at blockfrost.io ({cfg.network} project).</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password" autoComplete="off" value={bfKey} onChange={(e) => setBfKey(e.target.value)}
            placeholder={cfg.blockfrost.configured ? 'enter a new key to replace' : 'preprod… / mainnet…'}
            className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button onClick={() => act('bf', () => onchainSourceApi.update({ blockfrostProjectId: bfKey }).then((c) => { setBfKey(''); return c; }), 'Blockfrost key saved')} disabled={busy !== null || !bfKey.trim()} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'bf' ? 'Saving…' : 'Save key'}</button>
          {cfg.blockfrost.configured ? <button onClick={() => act('bfclear', () => onchainSourceApi.update({ blockfrostProjectId: '' }), 'Blockfrost key cleared')} disabled={busy !== null} className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">Clear</button> : null}
        </div>
      </div>

      {/* db-sync URL */}
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">cardano-db-sync URL</span>
          <span className="text-xs">{cfg.dbsync.configured ? <span className="text-emerald-600 dark:text-emerald-400">✓ set ({cfg.dbsync.hint})</span> : <span className="text-neutral-400">not set</span>}</span>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">{SOURCE_HINT.dbsync} e.g. <code>postgresql://user:pass@host:5433/cexplorer</code></p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password" autoComplete="off" value={dbsUrl} onChange={(e) => setDbsUrl(e.target.value)}
            placeholder={cfg.dbsync.configured ? 'enter a new URL to replace' : 'postgresql://…'}
            className="w-72 rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button onClick={() => act('dbs', () => onchainSourceApi.update({ dbsyncUrl: dbsUrl }).then((c) => { setDbsUrl(''); return c; }), 'db-sync URL saved')} disabled={busy !== null || !dbsUrl.trim()} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy === 'dbs' ? 'Saving…' : 'Save URL'}</button>
          {cfg.dbsync.configured ? <button onClick={() => act('dbsclear', () => onchainSourceApi.update({ dbsyncUrl: '' }), 'db-sync URL cleared')} disabled={busy !== null} className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700">Clear</button> : null}
        </div>
      </div>
    </section>
  );
}
