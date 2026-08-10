'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { adminApi, type AdminMe, type LoginResult } from './admin-api';

interface AdminAuthState {
  admin: AdminMe | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  login2fa: (pendingToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthState | null>(null);

export function AdminAuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .me()
      .then(setAdmin)
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await adminApi.login(username, password);
    if (res.status === 'ok') setAdmin(res.admin);
    return res;
  }, []);

  const login2fa = useCallback(async (pendingToken: string, code: string) => {
    const res = await adminApi.login2fa(pendingToken, code);
    setAdmin(res.admin);
  }, []);

  const logout = useCallback(async () => {
    await adminApi.logout().catch(() => undefined);
    setAdmin(null);
  }, []);

  return (
    <AdminAuthContext.Provider value={{ admin, loading, login, login2fa, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within <AdminAuthProvider>');
  return ctx;
}
