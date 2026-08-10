'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';

/**
 * §20 — warns the user when they're logged in but the wallet extension that
 * minted their session is no longer present in the browser (disabled,
 * uninstalled, different profile, restart…). Without this they only find
 * out when a sign-required action silently fails. Polls `window.cardano`
 * every 5 s while logged in so re-enabling the wallet clears the warning
 * automatically (no page reload needed).
 *
 * Self-hides when:
 *   • the user is not logged in (nothing to warn about);
 *   • or the logged-in wallet IS present (or any wallet is, when the key
 *     wasn't remembered — better to suggest re-connect than to nag).
 */
export function WalletStatusBanner() {
  const t = useT();
  const { profile, refreshWallets, wallets } = useAuth();
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [present, setPresent] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setStoredKey(window.localStorage.getItem('drepdao.walletKey'));
    const check = () => {
      refreshWallets();
      const list = (window as unknown as { cardano?: Record<string, unknown> }).cardano ?? {};
      const expected = window.localStorage.getItem('drepdao.walletKey');
      setStoredKey(expected);
      const ok = expected ? expected in list : Object.keys(list).length > 0;
      setPresent(!!ok);
    };
    check();
    const id = window.setInterval(check, 5000);
    return () => window.clearInterval(id);
  }, [refreshWallets]);

  if (!profile) return null;
  if (present) return null;
  return (
    <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100">
      <strong>{t('Wallet extension not available.')}</strong>{' '}
      {storedKey
        ? <>{t('You’re logged in but the')} &quot;{storedKey}&quot; {t('wallet isn’t injected right now (disabled, uninstalled, or a different browser profile). Any action that needs a signature — board approvals, votes, milestone POAs — will not work until you re-enable the extension.')}</>
        : <>{t('You’re logged in but no Cardano wallet is currently injected. Re-enable your wallet extension and refresh.')}</>}
      {' '}({wallets.length} {wallets.length === 1 ? t('wallet') : t('wallets')} {t('detected')})
    </div>
  );
}
