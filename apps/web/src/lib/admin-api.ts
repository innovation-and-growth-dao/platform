'use client';

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/sysadmin`;

export interface AdminMe {
  adminId: string;
  username: string;
  email: string;
  twoFaEnabled?: boolean;
}

export interface AdminHealth {
  database: string;
  redis: string;
  genesisApproved: boolean;
  maintenanceMode: boolean;
  paused: boolean;
  boardCount: number;
  adminCount: number;
  time: string;
}

export interface AdminRow {
  id: string;
  username: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  action: string;
  target: string | null;
  adminUsername: string | null;
  ip: string | null;
  occurredAt: string;
}

export interface MaintenanceState {
  enabled: boolean;
  since: string | null;
}

export interface AdminWalletStatus {
  hotWallet: { address: string | null; balanceAda: number; configured: boolean };
  /** Legacy env TREASURY_ADDRESS — only the platform's home while no
   *  multisig is assembled (fresh install / after reset). */
  treasury: { address: string | null; balanceAda: number; configured: boolean };
  /** §15.3 — the assembled native-script multisig. Null until board members
   *  have submitted their signing keys and the script is derived. Once set,
   *  this is the platform's actual on-chain treasury home. */
  activeMultisig: { address: string; balanceAda: number; threshold: number; totalKeys: number } | null;
  anchorSweepHours: number;
  pendingAnchors: number;
}

export interface GenesisState {
  boardCount: number;
  maxBoard: number;
  canAddMore: boolean;
  board: { displayName: string; drepId: string }[];
  genesisApprovedAt: string | null;
  maintenanceMode: boolean;
  paused: boolean;
  proposedBoard: { name: string; drep_id: string }[] | null;
}

export type LoginResult =
  | { status: 'ok'; admin: AdminMe }
  | { status: '2fa_required'; pendingToken: string };

export class StepUpEnrollError extends Error {}
type StepUpHandler = (retryMessage?: string) => Promise<string | null>;
let stepUpHandler: StepUpHandler | null = null;
export function setStepUpHandler(fn: StepUpHandler | null): void {
  stepUpHandler = fn;
}
const STEP_UP_ERRORS = new Set(['step_up_required', 'step_up_invalid', 'step_up_replay']);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let stepUpCode: string | undefined;
  let attempts = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
          ...(stepUpCode ? { 'x-stepup-totp': stepUpCode } : {}),
        },
        signal: init?.signal ?? AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error(`Cannot reach the admin API at ${API_BASE}.`);
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

    let body: { error?: string; message?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    const err = body?.error;
    if (err === 'step_up_2fa_not_enrolled') {
      throw new StepUpEnrollError(body?.message ?? 'Enable two-factor authentication to perform this action.');
    }
    if (err && STEP_UP_ERRORS.has(err) && stepUpHandler && attempts < 3) {
      attempts++;
      const code = await stepUpHandler(attempts > 1 ? (body?.message ?? 'Invalid code') : undefined);
      if (!code) throw new Error('Action cancelled.');
      stepUpCode = code;
      continue;
    }
    const detail = body?.message ?? res.statusText;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
}

export const adminApi = {
  login: (username: string, password: string) =>
    request<LoginResult>('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login2fa: (pendingToken: string, code: string) =>
    request<{ status: 'ok'; admin: AdminMe }>('/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    }),
  loginRecovery: (pendingToken: string, code: string) =>
    request<{ status: 'ok'; admin: AdminMe }>('/login/recovery', {
      method: 'POST',
      body: JSON.stringify({ pendingToken, code }),
    }),
  logout: () => request<{ ok: boolean }>('/logout', { method: 'POST' }),
  me: () => request<AdminMe>('/me'),
  // SEC-03 — self-service 2FA enrollment.
  twoFa: {
    setup: () =>
      request<{ totpUri: string; totpBase32: string; totpQrDataUrl: string; recoveryCodes: string[] }>('/2fa/setup', {
        method: 'POST',
      }),
    enable: (code: string) => request<{ enabled: true }>('/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
    disable: () => request<{ disabled: true }>('/2fa/disable', { method: 'POST' }),
  },
  health: () => request<AdminHealth>('/health'),
  admins: () => request<AdminRow[]>('/admins'),
  auditLog: () => request<AuditRow[]>('/audit-log'),
  // §26 — on-demand "Short maintenance mode" toggle (same flag the deploy-guard uses).
  maintenance: {
    get: () => request<MaintenanceState>('/maintenance'),
    enable: () => request<MaintenanceState>('/maintenance/enable', { method: 'POST' }),
    disable: () => request<MaintenanceState>('/maintenance/disable', { method: 'POST' }),
  },
  wallet: () => request<AdminWalletStatus>('/wallet'),
  setAnchorConfig: (sweepHours: number) =>
    request<{ sweepHours: number }>('/wallet/anchor-config', { method: 'PATCH', body: JSON.stringify({ sweepHours }) }),
  submitAnchors: () =>
    request<{ submitted: number; failed: number; total: number; reason?: string }>('/wallet/submit-anchors', { method: 'POST' }),
  sweepWallet: () => request<{ txHash: string; to: string }>('/wallet/sweep', { method: 'POST' }),
  rotateSeed: () => request<{ address: string | null }>('/wallet/rotate-seed', { method: 'POST' }),
  /** §23 — destructive wipe of DAO state (proposals/board/multisig/etc.).
   *  Keeps admin accounts, audit log, anchor secret, governance config. */
  resetDaoState: () =>
    request<{ ok: boolean; wipedTables: number }>('/reset', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'RESET DAO STATE' }),
    }),
  accounts: {
    invite: (username: string, email: string) =>
      request<{ token: string; expiresAt: string }>('/admins/invite', {
        method: 'POST',
        body: JSON.stringify({ username, email }),
      }),
    accept: (token: string, password: string) =>
      request<{
        adminId: string;
        totpUri: string;
        totpBase32: string;
        totpQrDataUrl: string;
        recoveryCodes: string[];
      }>('/admins/accept-invite', { method: 'POST', body: JSON.stringify({ token, password }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/admins/${id}/remove`, { method: 'POST' }),
    disable: (id: string) => request<{ ok: boolean }>(`/admins/${id}/disable`, { method: 'POST' }),
    // §18.8 — one-time password-reset token for another admin (1h TTL, shown once).
    passwordReset: (id: string) =>
      request<{ token: string; expiresAt: string; username: string }>(`/admins/${id}/password-reset`, { method: 'POST' }),
    resetPassword: (token: string, password: string) =>
      request<{ ok: boolean }>('/admins/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
    // §18.6 — switch the entire roster; old admins auto-disable when the last invite is accepted.
    switchAll: (admins: { username: string; email: string }[]) =>
      request<{ rotationId: string; invites: { username: string; token: string; expiresAt: string }[] }>('/admins/switch-all', { method: 'POST', body: JSON.stringify({ admins }) }),
  },
  genesis: {
    state: () => request<GenesisState>('/genesis'),
    upload: (genesis: unknown) =>
      request<{
        proposedBoard: { name: string; drep_id: string }[];
        invalid: { name: string; drep_id: string; reason: string }[];
      }>('/genesis/upload', {
        method: 'POST',
        body: JSON.stringify({ genesis }),
      }),
    approve: () =>
      request<{ seated: number; skippedFull: number; boardCount: number; maxBoard: number }>('/genesis/approve', {
        method: 'POST',
      }),
    reject: () => request<{ ok: boolean }>('/genesis/reject', { method: 'POST' }),
    addMember: (name: string, drepId: string) =>
      request<GenesisState>('/genesis/board', {
        method: 'POST',
        body: JSON.stringify({ name, drep_id: drepId }),
      }),
    removeMember: (drepId: string) =>
      request<GenesisState>('/genesis/board/remove', {
        method: 'POST',
        body: JSON.stringify({ drep_id: drepId }),
      }),
  },
};
