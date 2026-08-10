import { useEffect } from 'react';

/** Fetch-on-mount + poll every `intervalMs`, cleaned up on unmount (shared pattern). */
export function usePolling(fn: () => void, intervalMs: number) {
  useEffect(() => {
    fn();
    const id = setInterval(fn, intervalMs);
    return () => clearInterval(id);
  }, [fn, intervalMs]);
}
