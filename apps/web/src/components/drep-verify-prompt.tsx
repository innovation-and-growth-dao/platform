'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { ConfirmDialog } from './confirm-dialog';

// SEC-01 — a one-time nudge, right after login, for wallets that hold a CIP-95 DRep key but haven't
// proven ownership yet. Board/DRep authority depends on that proof, and nobody discovers the button
// on their own — so we ask once. "Later" is remembered per stake key; the button in the account
// card stays available. Plain wallets (no DRep key) are never prompted.
const DISMISS_KEY = 'drepdao.drepVerifyPrompt.dismissed';

export function DrepVerifyPrompt() {
  const t = useT();
  const { profile, detectDRepRegistered, proveDrepKey } = useAuth();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checked = useRef(false);

  const stakeKey = profile?.user?.stakeKeyHash ?? null;
  const proven = profile?.onchainDrep.proven ?? false;
  const proofRequired = profile?.onchainDrep.proofRequired ?? false;

  useEffect(() => {
    // Only nudge when a proof is actually REQUIRED — in auto-detect mode the DRep is already recognised.
    if (checked.current || !profile || !proofRequired || proven || !stakeKey) return;
    checked.current = true;
    void (async () => {
      if (typeof window !== 'undefined' && window.localStorage.getItem(`${DISMISS_KEY}:${stakeKey}`)) return;
      // Only nudge REGISTERED DReps — CIP-95 wallets derive a DRep key for every account, so a plain
      // ADA holder (non-DRep) must not be asked to prove one.
      const registered = await detectDRepRegistered().catch(() => false);
      if (registered) setOpen(true);
    })();
  }, [profile, proven, proofRequired, stakeKey, detectDRepRegistered]);

  if (!open) return null;

  const remember = () => {
    if (stakeKey && typeof window !== 'undefined') window.localStorage.setItem(`${DISMISS_KEY}:${stakeKey}`, '1');
  };

  return (
    <ConfirmDialog
      open={open}
      title={t('Verify your DRep key')}
      message={
        <div className="space-y-2">
          <p>
            {t(
              'To act as a DRep or board member, confirm you control your DRep key. Your wallet will ask you to sign a short message — no transaction, no fee.',
            )}
          </p>
          <p className="text-xs text-neutral-500">
            {t('You can also do this anytime from the "Verify DRep key" button in your account card.')}
          </p>
          {err ? <p className="text-sm text-red-600">{err}</p> : null}
        </div>
      }
      confirmLabel={t('Verify now')}
      cancelLabel={t('Later')}
      onConfirm={async () => {
        setErr(null);
        try {
          const p = await proveDrepKey();
          if (!p) {
            setErr(t('No DRep key found in this wallet.'));
            return; // keep the dialog open to show the message
          }
          setOpen(false); // proven — profile refreshed by proveDrepKey()
        } catch (e) {
          setErr(e instanceof Error ? e.message : t('Verification failed.'));
        }
      }}
      onCancel={() => {
        remember();
        setOpen(false);
      }}
    />
  );
}
