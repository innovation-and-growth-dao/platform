'use client';

import { useEffect, useState } from 'react';
import { subcategoriesApi, type Subcategory } from './api';
import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';

// §5.3 — the active expertise subcategories, fetched once and shared. The shared DEFAULT list is the
// fallback so forms/profiles still render before the fetch resolves (or if the API is unreachable).
let cache: Subcategory[] | null = null;
const listeners = new Set<() => void>();

/** Call after the board adds/removes a subcategory so every open view reloads the list. */
export function invalidateSubcategories() {
  cache = null;
  listeners.forEach((l) => l());
}

export function useSubcategories() {
  const [subs, setSubs] = useState<Subcategory[]>(cache ?? DEFAULT_SUBCATEGORIES);
  useEffect(() => {
    let alive = true;
    const load = () =>
      subcategoriesApi
        .list()
        .then((r) => { cache = r; if (alive) setSubs(r); })
        .catch(() => undefined);
    const sync = () => { if (cache) setSubs(cache); else load(); };
    sync();
    listeners.add(sync);
    return () => { alive = false; listeners.delete(sync); };
  }, []);
  const labelOf = (id: string): string => subs.find((s) => s.id === id)?.label ?? id;
  return { subs, labelOf };
}
