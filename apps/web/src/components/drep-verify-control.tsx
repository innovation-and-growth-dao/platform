'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';

// SEC-01 — the permanent "prove your DRep key" control. Shows the verified state once proven, or a
// button that runs the CIP-95 signData challenge otherwise. Reused in the account card and My area
// so the action is always reachable, not just via the one-time login popup.
export function DrepVerifyControl({ className }: { className?: string }) {
  const t = useT();
  const { profile, proveDrepKey } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!profile) return null;

  if (profile.onchainDrep.proven) {
    return (
      <div className={`text-xs text-emerald-600 dark:text-emerald-400 ${className ?? ''}`}>
        {t('DRep key verified ✓')}
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <button
        disabled={busy}
        onClick={async () => {
          setMsg(null);
          setBusy(true);
          try {
            const p = await proveDrepKey();
            setMsg(p ? null : t('No DRep key found in this wallet.'));
          } catch (e) {
            setMsg(e instanceof Error ? e.message : t('DRep key verification failed.'));
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md border border-emerald-300 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
      >
        {busy ? t('Check your wallet…') : t('Verify DRep key')}
      </button>
      {msg ? <div className="text-xs text-red-600">{msg}</div> : null}
    </div>
  );
}
