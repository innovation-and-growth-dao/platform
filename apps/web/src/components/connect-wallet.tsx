'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import type { Cip30WalletEntry } from '@/lib/cip30';

/** Reject after `ms` so a wallet popup that never appears (e.g. the user switched
 *  accounts mid-connect) can't leave the login stuck forever. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Your wallet didn't respond. Open the wallet extension (check it's on Preprod and the right account), then try again.")), ms),
    ),
  ]);
}

/** Primary login — Cardano wallet. Recognizes the wallet and shows the role. */
export function ConnectWallet() {
  const t = useT();
  const { profile, loading, wallets, login, logout, refreshWallets } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Each connect attempt gets a number; cancelling bumps it so a stale, still-
  // pending attempt that resolves late can't clobber the UI (or re-enable a
  // spinner the user already dismissed).
  const attemptRef = useRef(0);

  if (profile) {
    // §2 — combined status: the primary role, then every additional role the
    // account holds, joined with " | " (e.g. "Viewer | Expert | Submitter",
    // "DAO member | Submitter"). A registered on-chain DRep who hasn't joined the
    // DAO is a "Registered DRep" (eligible to request membership), distinct from
    // a plain ADA-holder Viewer.
    const base = profile.roles.includes('BOARD')
      ? t('Board member')
      : profile.roles.includes('DAO_MEMBER')
        ? t('DAO member')
        : profile.onchainDrep.registered
          ? t('Registered DRep')
          : t('Viewer');
    const status = [
      base,
      ...(profile.roles.includes('EXPERT') ? [t('Expert')] : []),
      ...(profile.roles.includes('SUBMITTER') ? [t('Submitter')] : []),
    ].join(' | ');
    return (
      <div className="space-y-1.5 text-sm">
        {/* §2 — name on top, role/status beneath. The DAO-member name leads; if
            the account is also a submitter with a DIFFERENT submitter name, it's
            shown in brackets (no single name is enforced across roles). */}
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 dark:text-emerald-400">●</span>
          <span className="font-medium">
            {profile.user.displayName ?? t('Signed in')}
            {(profile.roles.includes('DAO_MEMBER') || profile.roles.includes('BOARD')) &&
            profile.roles.includes('SUBMITTER') &&
            profile.submitterName &&
            profile.submitterName !== profile.user.displayName
              ? <span className="font-normal text-neutral-500"> ({profile.submitterName})</span>
              : null}
          </span>
        </div>
        <div className="text-xs text-neutral-500">{status}</div>
        {/* Show the DRep ID only when the wallet is actually a registered on-chain DRep. A
            derivable DRep key on an unregistered wallet (a plain ADA holder) is NOT a DRep
            identity — showing it here made Viewers look like DReps. */}
        {profile.onchainDrep.registered && profile.onchainDrep.drepId ? (
          <div className="break-all font-mono text-xs text-neutral-500">{profile.onchainDrep.drepId}</div>
        ) : null}
        <button
          onClick={() => logout()}
          className="mt-1 rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('Log out')}
        </button>
      </div>
    );
  }

  const handleLogin = async (entry: Cip30WalletEntry) => {
    const myAttempt = ++attemptRef.current;
    setError(null);
    setBusy(entry.key);
    try {
      await withTimeout(login(entry), 90_000);
    } catch (e) {
      if (myAttempt === attemptRef.current) setError(e instanceof Error ? e.message : t('Login failed'));
    } finally {
      // Ignore a stale attempt the user already cancelled (or superseded).
      if (myAttempt === attemptRef.current) setBusy(null);
    }
  };

  /** Abandon a stuck connect so the user can start over without reloading. The
   *  in-flight attempt is invalidated (its late result is ignored). */
  const cancelAttempt = () => {
    attemptRef.current++;
    setBusy(null);
    setError(null);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium">{t('Sign in with your Cardano wallet')}</div>
        <div className="text-xs text-neutral-500">
          {t('The platform reads your stake key and grants your role automatically.')}
          {loading ? ` ${t('Checking existing session…')}` : ''}
        </div>
      </div>

      {wallets.length === 0 ? (
        <div className="text-sm text-neutral-500">
          {t('No CIP-30 wallet detected.')}{' '}
          <button onClick={refreshWallets} className="underline">
            {t('Re-scan')}
          </button>{' '}
          {t('after installing/enabling Eternl, Lace, etc. (set the wallet to')} <strong>Preprod</strong>).
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {wallets.map((w) => (
              <button
                key={w.key}
                disabled={busy !== null}
                onClick={() => handleLogin(w)}
                className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {w.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.icon} alt="" width={18} height={18} />
                ) : null}
                {busy === w.key ? t('Check your wallet…') : `${t('Connect')} ${w.name}`}
              </button>
            ))}
          </div>
          {/* §22 — while connecting, give a way out: a wallet popup that never
              appears (e.g. the account was switched mid-connect) would otherwise
              leave every button disabled with no recovery. */}
          {busy !== null ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>{t('Approve the connection in your wallet popup.')}</span>
              <button onClick={cancelAttempt} className="rounded-md border border-neutral-300 px-2 py-1 font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                {t('Cancel & try again')}
              </button>
            </div>
          ) : (
            <button onClick={refreshWallets} className="text-xs text-neutral-400 underline hover:text-neutral-600">
              {t('Switched account or wallet? Re-scan wallets')}
            </button>
          )}
        </div>
      )}
      {error ? (
        <div className="space-y-1 text-sm text-red-600">
          <div>{error}</div>
          <button onClick={() => { setError(null); refreshWallets(); }} className="text-xs font-medium underline">
            {t('Try again')}
          </button>
        </div>
      ) : null}

      <div className="pt-1 text-xs text-neutral-400">
        {t('Platform operator?')}{' '}
        <Link href="/admin/login" className="underline hover:text-neutral-600">
          {t('Admin login')}
        </Link>
      </div>
    </div>
  );
}
