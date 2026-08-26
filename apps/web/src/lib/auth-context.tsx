'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authApi, type UserProfile } from './api';
import {
  detectDRepId,
  getDRepKeyHex,
  getStakeAddress,
  listInjectedWallets,
  signMessageWithStakeKey,
  utf8ToHex,
  type Cip30Api,
  type Cip30WalletEntry,
} from './cip30';

interface AuthState {
  profile: UserProfile | null;
  loading: boolean; // restoring session on mount
  wallets: Cip30WalletEntry[];
  login: (entry: Cip30WalletEntry) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshWallets: () => void;
  /** Best-effort DRep ID from the connected wallet (CIP-95); null if unavailable. */
  detectDRepId: () => Promise<string | null>;
  /** Sign a message with the connected wallet's stake key (CIP-30 signData); null if unavailable. */
  signMessage: (message: string) => Promise<{ signature: string; key: string } | null>;
  /** Sign a Cardano transaction body via CIP-30 signTx (partialSign=true).
   *  Used for real multisig broadcast — the wallet returns its own
   *  TransactionWitnessSet which the platform combines with other board
   *  members' witnesses + the native script. Null if wallet unavailable. */
  signTx: (txBodyHex: string) => Promise<string | null>;
  /** SEC-01 — prove control of the wallet's CIP-95 DRep key. Resolves with the refreshed profile;
   *  throws on cancel; returns null if no DRep key/wallet. */
  proveDrepKey: () => Promise<UserProfile | null>;
}

// Remember WHICH wallet the user logged in with, so signing after a page reload
// re-acquires that same wallet (e.g. Eternl) instead of guessing the first injected one.
const WALLET_KEY_STORAGE = 'drepdao.walletKey';

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallets, setWallets] = useState<Cip30WalletEntry[]>([]);
  const walletApiRef = useRef<Cip30Api | null>(null);
  const walletKeyRef = useRef<string | null>(null);

  const refreshWallets = useCallback(() => setWallets(listInjectedWallets()), []);

  const refresh = useCallback(async () => {
    try {
      setProfile(await authApi.me());
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    // Restore which wallet was used, so signing works after a reload (session is cookie-based).
    if (typeof window !== 'undefined') walletKeyRef.current = window.localStorage.getItem(WALLET_KEY_STORAGE);
    void refresh().finally(() => setLoading(false));

    // Wallet extensions inject window.cardano.* ASYNCHRONOUSLY, often after the
    // first paint and at different speeds (Eternl is fast; Lace/VESPR lag). A
    // single scan at mount finds none, or only the fastest one. So poll for a
    // few seconds and ACCUMULATE — once a wallet has been seen it stays in the
    // list — and also react to the `cardano#initialized` event some wallets fire.
    if (typeof window === 'undefined') return;
    const seen = new Map<string, Cip30WalletEntry>();
    const scan = () => {
      let changed = false;
      for (const w of listInjectedWallets()) {
        if (!seen.has(w.key)) changed = true;
        seen.set(w.key, w); // always refresh the reference
      }
      if (changed) setWallets([...seen.values()]);
    };
    scan();
    let tries = 0;
    const id = window.setInterval(() => { scan(); if (++tries >= 20) window.clearInterval(id); }, 300); // ~6s
    window.addEventListener('cardano#initialized', scan);
    return () => { window.clearInterval(id); window.removeEventListener('cardano#initialized', scan); };
  }, [refresh]);

  const login = useCallback(async (entry: Cip30WalletEntry) => {
    const { api, stakeHex, stakeAddress } = await getStakeAddress(entry);
    walletApiRef.current = api; // keep for CIP-95 DRep detection
    walletKeyRef.current = entry.key; // remember which wallet, to re-acquire for signing
    if (typeof window !== 'undefined') window.localStorage.setItem(WALLET_KEY_STORAGE, entry.key);
    const { message } = await authApi.nonce(stakeAddress);
    const sig = await api.signData(stakeHex, utf8ToHex(message));
    const drepKeyHex = await getDRepKeyHex(api); // CIP-95 → board/DRep recognition
    setProfile(
      await authApi.verify({ stakeAddress, signature: sig.signature, key: sig.key, drepKeyHex }),
    );
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    walletApiRef.current = null;
    walletKeyRef.current = null;
    if (typeof window !== 'undefined') window.localStorage.removeItem(WALLET_KEY_STORAGE);
    setProfile(null);
  }, []);

  const detect = useCallback(async () => {
    if (!walletApiRef.current) return null;
    return detectDRepId(walletApiRef.current);
  }, []);

  // Sign a message with the wallet's stake key. Re-acquires the SAME wallet the user
  // logged in with (never a different injected wallet) if the api was lost on reload.
  // Returns null only when no such wallet is available; **throws if the user cancels /
  // rejects** so callers never record an unsigned action as "signed".
  const signMessage = useCallback(async (message: string) => {
    let api = walletApiRef.current;
    if (!api) {
      const key = walletKeyRef.current;
      const entry = key ? listInjectedWallets().find((w) => w.key === key) : null;
      if (!entry) return null; // can't tell which wallet → caller decides how to degrade
      api = (await getStakeAddress(entry)).api; // enable() may throw if the user rejects → propagate
      walletApiRef.current = api;
    }
    // signData throws if the user cancels in the wallet — let it propagate (do NOT swallow).
    return await signMessageWithStakeKey(api, message);
  }, []);

  const signTx = useCallback(async (txBodyHex: string) => {
    let api = walletApiRef.current;
    if (!api) {
      const key = walletKeyRef.current;
      const entry = key ? listInjectedWallets().find((w) => w.key === key) : null;
      if (!entry) return null;
      api = (await getStakeAddress(entry)).api;
      walletApiRef.current = api;
    }
    // partialSign=true → wallet signs the tx with whichever of its keys match
    // required_signers / inputs, instead of refusing because it doesn't own
    // every input (multisig: inputs are at the script address, not the wallet).
    return await api.signTx(txBodyHex, true);
  }, []);

  // SEC-01 — challenge/response proof of DRep-key ownership.
  const proveDrepKey = useCallback(async () => {
    let api = walletApiRef.current;
    if (!api) {
      const key = walletKeyRef.current;
      const entry = key ? listInjectedWallets().find((w) => w.key === key) : null;
      if (!entry) return null;
      api = (await getStakeAddress(entry)).api;
      walletApiRef.current = api;
    }
    const drepKeyHex = await getDRepKeyHex(api);
    if (!drepKeyHex) return null;
    const { challenge, addressHex } = await authApi.drepChallenge(drepKeyHex);
    const sig = await api.signData(addressHex, utf8ToHex(challenge));
    const res = await authApi.drepVerify({ drepKeyHex, signature: sig.signature, key: sig.key });
    setProfile(res.profile);
    return res.profile;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        profile,
        loading,
        wallets,
        login,
        logout,
        refresh,
        refreshWallets,
        detectDRepId: detect,
        signMessage,
        signTx,
        proveDrepKey,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
