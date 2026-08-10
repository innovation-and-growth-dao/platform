'use client';

import { useEffect, useState } from 'react';
import { EXPLORERS } from '@drep-dao/shared';
import { configApi, meApi, type PublicConfig } from './api';

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig> | null = null;
// Subscribers (useExplorer instances) re-fetch when the config is invalidated, so
// changing the explorer applies live everywhere without a page refresh.
const listeners = new Set<() => void>();

/**
 * The effective config = the public platform config, with the logged-in member's
 * personal explorer preference (§20) layered on top when set. Cached for the session;
 * call invalidateConfig() after the user changes their preference.
 */
export function loadConfig(): Promise<PublicConfig> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      const base = await configApi.get();
      let merged = base;
      try {
        const pref = await meApi.preferences(); // 401 when logged out → keep platform default
        if (pref?.explorer) merged = { ...base, explorer: pref.explorer };
      } catch {
        /* not logged in / no preference → platform default */
      }
      cached = merged;
      return merged;
    })();
  }
  return inflight;
}

/** Drop the cache and notify every useExplorer so links re-resolve immediately. */
export function invalidateConfig() {
  cached = null;
  inflight = null;
  listeners.forEach((l) => l());
}

const fill = (tpl: string, hash: string, address = '') => tpl.replace('{hash}', hash).replace('{address}', address);

export function txUrl(cfg: PublicConfig, hash: string): string {
  const ex = EXPLORERS[cfg.explorer] ?? EXPLORERS.cardanoscan;
  return fill(ex.tx[cfg.network] ?? ex.tx.Preprod, hash);
}
export function addressUrl(cfg: PublicConfig, address: string): string {
  const ex = EXPLORERS[cfg.explorer] ?? EXPLORERS.cardanoscan;
  return fill(ex.address[cfg.network] ?? ex.address.Preprod, '', address);
}

/** React hook: the cached config + ready-made link builders (configurable explorer). */
export function useExplorer() {
  const [cfg, setCfg] = useState<PublicConfig | null>(cached);
  useEffect(() => {
    let alive = true;
    const reload = () => loadConfig().then((c) => alive && setCfg(c)).catch(() => undefined);
    reload();
    listeners.add(reload); // re-fetch when invalidateConfig() fires (explorer changed)
    return () => {
      alive = false;
      listeners.delete(reload);
    };
  }, []);
  return {
    cfg,
    txUrl: (hash: string) => (cfg ? txUrl(cfg, hash) : '#'),
    addressUrl: (address: string) => (cfg ? addressUrl(cfg, address) : '#'),
    // DRep pages live on cexplorer (cardanoscan has no stable DRep route).
    drepUrl: (drepId: string) => {
      const net = cfg?.network ?? 'Preprod';
      const sub = net === 'Mainnet' ? '' : net === 'Preview' ? 'preview.' : 'preprod.';
      return `https://${sub}cexplorer.io/drep/${drepId}`;
    },
  };
}
