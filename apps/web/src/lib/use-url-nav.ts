'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Sync the single-page navigation state into the URL query string, so every menu /
 * submenu / open proposal has its own shareable URL (and the browser back button works).
 * `get(key)` reads the current value; `setParams({...})` updates several at once (null/'' deletes).
 */
export function useUrlNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = useCallback((key: string) => params.get(key), [params]);

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === '') next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  return { get, setParams };
}
