'use client';

const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1`;

export interface UserProfile {
  user: {
    id: string;
    stakeAddress: string;
    stakeKeyHash: string;
    displayName: string | null;
    createdAt: string;
  };
  /** §2 — the submitter profile's own name (may differ from the DAO-member name). */
  submitterName: string | null;
  roles: string[];
  /** On-chain DRep identity — source of truth for the DREP role (verified at login). */
  onchainDrep: { registered: boolean; drepId: string | null };
  /** DAO membership (admission) status — separate from on-chain registration. */
  daoMembership: { status: string; admittedAt: string | null } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include', // send/receive the session cookie
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      // Never hang forever (e.g. API unreachable) — fail fast so the UI can recover.
      signal: init?.signal ?? AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}. Is it running?`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.message ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  // 204, or any response with an empty body, yields undefined — calling res.json() on an
  // empty body throws "Unexpected end of JSON input", so parse only when there's a body.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const authApi = {
  nonce: (stakeAddress: string) =>
    request<{ message: string; expiresInSeconds: number }>('/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ stakeAddress }),
    }),

  verify: (body: { stakeAddress: string; signature: string; key: string; drepKeyHex?: string }) =>
    request<UserProfile>('/auth/verify', { method: 'POST', body: JSON.stringify(body) }),

  me: () => request<UserProfile>('/auth/me'),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
};

export interface DrepApplicationInput {
  // drep_id is NOT supplied by the client — the backend derives it from the
  // wallet's CIP-95 DRep key and verifies on-chain registration.
  displayName?: string;
  bio?: string;
  // Optional profile photo, sent as a data URL ("data:image/<png|jpeg|webp|gif>;base64,…").
  // Empty string clears the photo (falls back to the on-chain CIP-119 image).
  photo?: string;
  subcategoryIds?: string[];
  socials?: Record<string, string>;
  contact?: Record<string, string>;
  kycOptin?: boolean;
  conflictOfInterest?: string;
  noSelfVotePledge?: boolean;
  country?: string;
  callsOptin?: boolean;
  admissionCallOptin?: boolean;
  // §8.2 — board-only self-toggle for "I'll vote on funding proposals".
  votesOnFundingProposals?: boolean;
  // §2 — cross-wallet link: the submitter account id this DAO member declares as the same
  // entity (empty string clears the link).
  linkedSubmitterUserId?: string;
}

export interface MyDrep {
  id: string;
  status: string;
  drepIdOnchain: string;
  bio: string | null;
  photo: string | null; // self-uploaded profile photo (data URL); overrides the CIP-119 on-chain image
  socials: Record<string, string> | null;
  contact: Record<string, string> | null;
  subcategoryIds: string[];
  kycOptin: boolean;
  callsOptin: boolean;
  admissionCallOptin: boolean;
  // §8.2 — board-only toggle: when false, this board member doesn't count in
  // funding D&V tallies. Always true for non-board (they always vote).
  votesOnFundingProposals: boolean;
  // §2.1 — disclosure mirrored from the submitter profile.
  conflictOfInterest: string;
  noSelfVotePledge: boolean;
  country: string;
  // §2 — the submitter profile this member linked (own selection).
  linkedSubmitterUserId: string | null;
  yes: number;
  no: number;
  threshold: number;
  admissionVotesReceived: { choice: string; feedback: string | null; voterName: string }[];
  anchorTxHash: string | null; // on-chain anchor of the admission decision (§C)
}

export interface DaoMember {
  drepId: string;
  displayName: string;
  image: string | null; // CIP-119 on-chain DRep image, else null (generic avatar)
  isBoard: boolean;
  votingPowerAda: number; // on-chain DRep voting power (vote delegation), in ADA
  delegators: number; // accounts that delegated their vote to this DRep
  merit: number;
  basePower: number;
  meritMultiplier: number;
  adjustedPower: number; // log10(votingPowerAda) × (1 + merit/200)
  since: string | null; // board install date (board) or board-approval date (DAO member)
  meetsEntryRequirements: boolean; // §14.1 — still meets the power/delegator minimum (board always true)
  // §8.2 — only meaningful for board members. Funding-proposal totals subtract
  // board members whose flag is false; non-board are always voters.
  votesOnFundingProposals: boolean;  country: string;
}

export interface OnChainProof {
  id: string;
  title: string;
  detail: string;
  kind: string;
  label: number;
  hash: string;
  txHash: string | null;
  createdAt: string;
}

export interface DaoMemberDetail extends DaoMember {
  bio: string | null;
  socials: Record<string, string> | null;
  contact: Record<string, string> | null;
  subcategoryIds: string[];
  // Admission votes the member cast as a board reviewer (non-board members are 0).
  admissionVotesCast: { yes: number; no: number; total: number };
  // §13 — total governance participation across all rounds, with the choice split.
  votingActivity: {
    filtering: { total: number; yes: number; no: number };
    funding: { total: number; yes: number; no: number; abstain: number };
    milestone: { total: number; yes: number; no: number };
    internal: { total: number; yes: number; no: number; abstain: number };
  };
  conflictOfInterest: string;
  noSelfVotePledge: boolean;  country: string;
  /** §2 — this DAO member is also an approved submitter, + the submitter name if different. */
  isSubmitter: boolean;
  submitterName: string | null;
  /** §2 — the linked submitter profile id (for cross-linking) + the board-editable pointer. */
  submitterId: string | null;
  linkedSubmitterUserId: string | null;
}

export const daoApi = {
  members: () => request<DaoMember[]>('/dao/members'),
  member: (drepId: string) => request<DaoMemberDetail>(`/dao/members/${encodeURIComponent(drepId)}`),
  experts: () => request<DaoExpert[]>('/dao/experts'),
  proofs: () => request<OnChainProof[]>('/dao/proofs'),
  // §2 (board) — override a DAO member's cross-wallet link to a submitter (null clears it).
  setMemberLink: (drepId: string, linkedSubmitterUserId: string | null) =>
    request<DaoMemberDetail>(`/dao/members/${encodeURIComponent(drepId)}/link`, { method: 'PATCH', body: JSON.stringify({ linkedSubmitterUserId }) }),
};

// §12 — submitter's pending budget-change request (board approves or rejects).
export interface PendingBudgetChange {
  id: string;
  prevAmountAda: number;
  proposedAmountAda: number;
  proposedMilestones: { title: string | null; description: string; acceptanceCriteria: string | null; amountAda: number }[];
  reason: string | null;
  requester: string | null;
  createdAt: string;
}

// §18 — board force-submits anchors recorded but not yet posted on-chain.
export const boardProofsApi = {
  submit: (id: string) =>
    request<{ hash: string; txHash: string | null; submitted: boolean }>(`/admin/proofs/${id}/submit`, { method: 'POST' }),
  submitAll: () =>
    request<{ submitted: number; failed: number; total: number; reason?: string }>('/admin/proofs/submit-all', { method: 'POST' }),
};

export interface WalletStatus {
  hotWallet: { address: string | null; balanceAda: number; configured: boolean };
  treasury: { address: string | null; balanceAda: number; configured: boolean };
}

export interface TreasuryBucket {
  key: string;
  name: string;
  allocatedAda: number;
  spentAda: number;
  remainingAda: number;
  address: string | null;
}
export interface TreasuryOverview {
  treasury: { address: string | null; balanceAda: number; configured: boolean };
  hotWallet: { address: string | null; balanceAda: number; minAda: number };
  buckets: TreasuryBucket[];
  totalAllocatedAda: number; // treasury total — all ADA across every address (incl. hot wallet)
  totalSpentAda: number;
  spent: { funding: number; rewards: number; operations: number };
}
export interface BoardAction {
  id: string;
  kind: string;
  description: string | null;
  amountAda: number | null;
  status: string;
  txHash: string | null;
  approvals: number;
  /** §15 — 3-of-5 board signing. `threshold` is the M needed; `totalKeys`
   *  is N (the multisig size) so the UI can render "3-of-5". */
  threshold: number;
  totalKeys: number;
  /** §15 — 'AUTHORIZE' (collecting CIP-30 commits) vs 'SIGN' (M committed;
   *  collecting real tx witnesses). */
  phase: 'AUTHORIZE' | 'SIGN';
  /** Count of phase-1 commits. */
  commitments: number;
  /** Whether the viewer has already committed (phase 1). */
  mineCommitted: boolean;
  mineApproved: boolean;
  /** §15 — display names of who authorized (phase 1) and who has signed the tx (phase 2). */
  committedBy: string[];
  signedBy: string[];
  createdAt: string;
  // §11/§15 — payout-specific link + insufficiency hint. Null for non-payout
  // kinds (REWARD_PAYOUT / OPS / etc.); always set for PROJECT_FUNDING.
  proposalId: string | null;
  milestoneId: string | null;
  milestoneIdx: number | null;
  proposalTitle: string | null;
  destAddress: string | null;
  paidAt: string | null;
  recipients: { name: string; ada: number }[];
  insufficient: boolean;
}

export interface BoardActionsView {
  count: number;
  actions: BoardAction[];
  history: BoardAction[];
  treasury: { address: string | null; balanceAda: number } | null;
  /** §15/§20 — TX_SIGNING_PROCESS: 1_PHASE = single Sign click per member
   *  (requires Eternl); 2_PHASE = Authorize → Sign (any CIP-30 wallet). */
  signingMode: '1_PHASE' | '2_PHASE';
}
export interface HotWalletHistoryItem {
  id: string;
  direction: 'TOP_UP' | 'SWEEP';
  amountAda: number;
  txHash: string | null;
  at: string;
  description: string | null;
  initiatedBy: string | null;
  /** PENDING_SIGS / READY / BROADCASTED / CONFIRMED / FAILED (top-ups) or SWEPT. */
  status: string;
  approvals?: number;
  threshold?: number;
}

export interface TreasuryTx {
  hash: string;
  time: number; // unix seconds
  /** INTERNAL = between DAO wallets (multisig/buckets/hot wallet) — nothing left the DAO. */
  direction: 'IN' | 'OUT' | 'INTERNAL';
  /** Board members who signed the multisig tx (board actions only). */
  signers?: string[];
  /** Which treasury address the funds left (board actions; used by search). */
  sourceAddress?: string;
  amountAda: number;
  label: string;
  proposalId?: string;
  proposalPublicId?: string;
  proposalTitle?: string;
  submitter?: string;
  destAddress?: string;
  annotationTitle?: string; // board-provided title (overrides label)
  annotationNote?: string;
  annotatedBy?: string;
}

export const treasuryApi = {
  overview: () => request<TreasuryOverview>('/dao/treasury'),
  transactions: (params?: { direction?: 'IN' | 'OUT' | 'INTERNAL'; q?: string; page?: number }) => {
    const sp = new URLSearchParams();
    if (params?.direction) sp.set('direction', params.direction);
    if (params?.q) sp.set('q', params.q);
    if (params?.page && params.page > 1) sp.set('page', String(params.page));
    const qs = sp.toString();
    return request<{ transactions: TreasuryTx[]; total: number; page: number; pageSize: number }>(
      `/dao/treasury/transactions${qs ? `?${qs}` : ''}`,
    );
  },
  annotateTx: (txHash: string, body: { title?: string; description?: string }) =>
    request<{ ok: boolean }>(`/admin/treasury/transactions/${encodeURIComponent(txHash)}/annotate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  boardActions: (history = false) =>
    request<BoardActionsView>(`/me/board-actions${history ? '?history=1' : ''}`),
  prepareTopUp: (amountAda: number, sourceBucketId?: string) =>
    request<{ id: string }>('/admin/treasury/prepare-topup', { method: 'POST', body: JSON.stringify({ amountAda, sourceBucketId }) }),
  /** §15.4 — board-initiated arbitrary outbound transfer; goes through the
   *  standard 3-of-N Approve & sign flow. Context is the audit description.
   *  sourceBucketId picks WHICH labeled bucket the funds come from
   *  (null/omitted = the primary/bare multisig bucket). */
  prepareTransfer: (body: { destAddress: string; amountAda: number; context: string; sourceBucketId?: string }) =>
    request<{ id: string; status: string; amountAda: number; destAddress: string }>(
      '/admin/treasury/prepare-transfer',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** §15.5 — internal transfer between two treasury buckets (no free-form address). */
  prepareInternalTransfer: (body: { sourceBucketId: string; destBucketId: string; amountAda: number }) =>
    request<{ id: string; status: string; amountAda: number; destAddress: string }>(
      '/admin/treasury/prepare-internal-transfer',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** §15.3 — sweep entire hot-wallet balance back into the multisig treasury. */
  sweepHotWallet: () =>
    request<{ txHash: string; to: string }>('/admin/treasury/sweep-hot-wallet', { method: 'POST' }),
  /** Per-platform hot-wallet policy (min / topup-cap). */
  hotWalletPolicy: () =>
    request<{ minAda: number; topUpMaxAda: number; autoTopUpAda: number }>('/dao/treasury/hot-wallet-policy'),
  /** §15.3 — merged TX history: top-ups (treasury→hot) + sweeps (hot→treasury). */
  hotWalletHistory: () =>
    request<{ hotWalletAddress: string | null; items: HotWalletHistoryItem[] }>('/dao/treasury/hot-wallet-history'),
  approveAction: (id: string, body: { signature?: string; signingKey?: string; ts?: string }) =>
    request<{ approvals: number; threshold: number; status: string }>(`/admin/board-actions/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** §15 — fetch the unsigned tx body the board member's wallet should sign
   *  via CIP-30 api.signTx(txBodyHex, partialSign=true). */
  txBody: (id: string) =>
    request<{ txBodyHex: string; sourceAddress: string; scriptHash: string }>(`/admin/board-actions/${id}/tx-body`),
  /** §15 phase-1 — board member commits to signing this action with a CIP-30
   *  data-signature. Once 3 commits are collected the action moves to phase
   *  2 (real tx signing by those 3 with their HW wallets). */
  commitToAction: (id: string, body: { signature: string; key: string; ts: string }) =>
    request<{ status: string; commitments: number; threshold: number; ready: boolean }>(
      `/admin/board-actions/${id}/commit`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** §15.4 — any single board member can cancel a pending multisig action.
   *  Reason becomes part of the audit history. */
  cancelAction: (id: string, reason: string) =>
    request<{ id: string; status: string }>(`/admin/board-actions/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  /** §15 — submit the wallet's TransactionWitnessSet CBOR; when the threshold
   *  is collected the backend combines + broadcasts the tx. */
  submitWitness: (id: string, witnessHex: string) =>
    request<{ status: string; approvals: number; threshold: number; txHash?: string | null; stored?: number }>(
      `/admin/board-actions/${id}/witness`,
      { method: 'POST', body: JSON.stringify({ witnessHex }) },
    ),
  /** §11/§15 — paste the on-chain broadcast tx hash; backend verifies via Koios. */
  submitPayoutTx: (id: string, txHash: string) =>
    request<{ status: string; txHash: string | null; paid?: boolean; found?: boolean; koiosAvailable?: boolean; paidLovelace?: string; paidAt?: string | null }>(
      `/admin/board-actions/${id}/payout-tx`,
      { method: 'POST', body: JSON.stringify({ txHash }) },
    ),
};

// §15 — multisig setup status + per-board key submission.
export interface MultisigSeatRow {
  seatId: string;
  drepId: string;
  drepKeyHash: string;
  displayName: string;
  userId: string | null;
  hasKey: boolean;
  keyHash: string | null;
  paymentBech32: string | null;
  hardwareAttested: boolean;
  submittedAt: string | null;
}
export interface MultisigSigner {
  keyHash: string;
  displayName: string | null;
  drepId: string | null;
  paymentBech32: string | null;
}
export interface MultisigActiveConfig {
  id: string;
  scriptHash: string;
  bech32Address: string;
  threshold: number;
  totalKeys: number;
  assembledAt: string;
  balanceAda: number;
  // The on-chain signers of this multisig (its board), resolved name + address. Present on the
  // active config (history entries expose keyHashes instead).
  signers?: MultisigSigner[];
}
export interface MultisigHistoryEntry extends MultisigActiveConfig {
  replacedAt: string;
  // Date the config's funds were emptied to its successor (migration tx paid), or when it was
  // replaced if it never held funds. Null while it still holds a balance (migration pending).
  terminatedAt: string | null;
  replacedByConfigId: string | null;
  keyHashes: string[];
}
export interface MultisigInactiveSigner {
  boardSeatId: string;
  userId: string;
  displayName: string;
  drepId: string;
  keyHash: string;
  paymentBech32: string | null;
}
export interface MultisigPendingMigration {
  id: string;
  fromConfigId: string | null;
  toConfigId: string | null;
  amountAda: number | null;
  status: string;
  approvals: number;
  threshold: number;
  txHash: string | null;
  createdAt: string;
}
export interface MultisigStatus {
  threshold: number;
  total: number;
  submitted: number;
  allSubmitted: boolean;
  rotationInProgress: boolean;
  active: MultisigActiveConfig | null;
  history: MultisigHistoryEntry[];
  seats: MultisigSeatRow[];
  inactiveSigners: MultisigInactiveSigner[];
  migrationsPending: MultisigPendingMigration[];
}
export const multisigApi = {
  status: () => request<MultisigStatus>('/dao/multisig/status'),
  submitKey: (body: { paymentBech32: string; hardwareAttested: boolean; signature: string; key: string; ts: string }) =>
    request<MultisigStatus>('/admin/multisig/key', { method: 'POST', body: JSON.stringify(body) }),
  /** §15.2 — board prepares a migration tx out of an old (replaced) multisig. */
  prepareMigration: (fromConfigId: string) =>
    request<{ id: string; status: string }>('/admin/multisig/prepare-migration', {
      method: 'POST',
      body: JSON.stringify({ fromConfigId }),
    }),
};

// §15.5 — labeled treasury buckets (sub-addresses of the same multisig).
export interface TreasuryBucket {
  id: string;
  label: string;          // "Primary" for the bare-multisig row, otherwise the user-chosen label
  bech32Address: string;
  isPrimary: boolean;
  /** §15.6 — per-operation default flags; the platform routes auto-generated
   *  actions of each kind to the bucket flagged for it. */
  isDefaultFunding: boolean;
  isDefaultRewards: boolean;
  isDefaultOperations: boolean;
  isDefaultSubmissionFees: boolean;
  isDefaultPledge: boolean;
  balanceAda: number;
  createdBy: string | null;
}
export const treasuryBucketsApi = {
  list: () => request<{ multisigConfigured: boolean; buckets: TreasuryBucket[] }>('/dao/treasury/buckets'),
  create: (label: string) =>
    request<{ id: string; label: string; bech32Address: string; scriptHash: string }>(
      '/admin/treasury/buckets',
      { method: 'POST', body: JSON.stringify({ label }) },
    ),
  /** Cosmetic rename — the on-chain address stays the same (the label hash
   *  is baked into the script bytes at creation). */
  rename: (id: string, label: string) =>
    request<{ id: string; label: string }>(`/admin/treasury/buckets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    }),
  /** Delete an EMPTY bucket (refused while funds remain at the address). */
  remove: (id: string) =>
    request<{ ok: boolean }>(`/admin/treasury/buckets/${id}`, { method: 'DELETE' }),
  /** §15.6 — set / clear a per-operation default flag (FUNDING/REWARDS/
   *  OPERATIONS). The platform routes auto-generated actions of each kind
   *  to the bucket flagged for it (fallback: primary). Toggling true on
   *  one bucket auto-clears the same flag on others. */
  setDefault: (id: string, operation: 'FUNDING' | 'REWARDS' | 'OPERATIONS' | 'SUBMISSION_FEES' | 'PLEDGE', value: boolean) =>
    request<{ ok: boolean }>(`/admin/treasury/buckets/${id}/default`, {
      method: 'POST',
      body: JSON.stringify({ operation, value }),
    }),
};

// §15.4 — user's payment address for rewards. Editable; historical RewardEntry
// rows stamp the address they were paid to so updating doesn't rewrite history.
export const rewardAddressApi = {
  get: () => request<{ rewardPaymentAddress: string | null }>('/me/reward-address'),
  set: (address: string | null) =>
    request<{ rewardPaymentAddress: string | null }>('/me/reward-address', {
      method: 'PATCH',
      body: JSON.stringify({ address }),
    }),
};

export interface GovParam {
  key: string;
  value: number | string | boolean;
  default: number | string | boolean;
  type: string;
  description: string;
}

export const governanceApi = {
  list: () => request<GovParam[]>('/admin/governance'),
  update: (key: string, value: number | string | boolean) =>
    request<{ key: string; value: number | string | boolean }>('/admin/governance', {
      method: 'PATCH',
      body: JSON.stringify({ key, value }),
    }),
  wallets: () => request<WalletStatus>('/admin/governance/wallets'),
};

// §22 — on-chain data source: ordered fallback list + credentials (Blockfrost key, db-sync URL).
export interface OnchainSourceConfig {
  order: string[];
  available: string[];
  network: string;
  koios: { tokenConfigured: boolean; hint: string | null };
  blockfrost: { configured: boolean; hint: string | null };
  dbsync: { configured: boolean; hint: string | null };
}
export const onchainSourceApi = {
  get: () => request<OnchainSourceConfig>('/admin/governance/onchain-source'),
  update: (dto: { order?: string[]; koiosApiToken?: string; blockfrostProjectId?: string; dbsyncUrl?: string }) =>
    request<OnchainSourceConfig>('/admin/governance/onchain-source', {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),
};

export interface PendingApplication {
  drepId: string;
  drepIdOnchain: string;
  displayName: string | null;
  stakeAddress: string;
  bio: string | null;
  subcategoryIds: string[];
  contact: Record<string, string> | null;
  kycOptin: boolean;
  callsOptin: boolean;
  admissionCallOptin: boolean;
  yes: number;
  no: number;
  threshold: number;
  status: string; // PENDING_ADMISSION | ADMITTED | REJECTED
  myVote: { choice: string; feedback: string | null } | null;
}

export interface RemovalVoteView {
  choice: string;
  rationale: string | null;
  voterName: string;
}
export interface MyRemoval {
  reason: string | null;
  proposedByName: string;
  yes: number;
  no: number;
  threshold: number;
  votes: RemovalVoteView[];
}
export interface ActiveRemoval extends MyRemoval {
  id: string;
  targetDrepId: string;
  targetName: string;
  status: string; // PENDING | APPROVED (removed) | REJECTED (kept)
  resolvedAt: string | null;
  myVote: string | null;
}
export interface RemovableMember {
  drepId: string;
  displayName: string;
  drepIdOnchain: string;
}

export interface EntryEligibility {
  gatingEnabled: boolean;
  // §14 — true while NO board is seated: a complete profile is admitted automatically.
  freePeriod?: boolean;
  eligible: boolean;
  requirements: { group: 'power' | 'activity'; label: string; met: boolean; detail: string }[];
}

export const drepApi = {
  mine: () => request<MyDrep | null>('/me/drep'),
  apply: (input: DrepApplicationInput) =>
    request<MyDrep>('/me/drep-application', { method: 'POST', body: JSON.stringify(input) }),
  update: (input: Partial<DrepApplicationInput>) =>
    request<MyDrep>('/me/drep', { method: 'PATCH', body: JSON.stringify(input) }),
  myRemoval: () => request<MyRemoval | null>('/me/removal'),
  leaveDao: () => request<{ status: string }>('/me/leave-dao', { method: 'POST' }),
  entryEligibility: () => request<EntryEligibility>('/me/entry-eligibility'),
};

export const removalApi = {
  list: (history = false) => request<ActiveRemoval[]>(`/admin/removals${history ? '?history=1' : ''}`),
  removableMembers: () => request<RemovableMember[]>('/admin/removals/removable-members'),
  propose: (targetDrepId: string, reason?: string) =>
    request<{ id: string }>('/admin/removals', {
      method: 'POST',
      body: JSON.stringify({ targetDrepId, reason }),
    }),
  vote: (id: string, choice: 'YES' | 'NO', rationale: string) =>
    request<{ status: string; yes: number; no: number; threshold: number }>(`/admin/removals/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
};

export const boardApi = {
  listApplications: (history = false) =>
    request<PendingApplication[]>(`/admin/drep-applications${history ? '?history=1' : ''}`),
  vote: (
    drepId: string,
    body: { choice: 'YES' | 'NO'; feedback: string; signature?: string; signingKey?: string; ts?: string },
  ) =>
    request<{ status: string; yes: number; no: number; threshold: number; anchorTxHash: string | null }>(
      `/admin/drep-applications/${drepId}/vote`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

export interface ExpertApplicationInput {
  displayName: string;
  bio?: string;
  conflictOfInterest?: string;
  motivation?: string;
  email?: string;
  telegram?: string;
  socialLinks?: string[];
  logoDataUrl?: string;
  subcategoryIds?: string[];
}
export interface MyExpert {
  id: string;
  displayName: string;
  bio: string | null;
  conflictOfInterest: string | null;
  motivation: string | null;
  email: string;
  telegram: string;
  socialLinks: string[];
  logoDataUrl: string | null;
  subcategoryIds: string[];
  approvedByBoard: boolean;
}
export interface ExpertApplication {
  id: string;
  displayName: string;
  bio: string | null;
  conflictOfInterest: string | null;
  motivation: string | null;
  email: string;
  telegram: string;
  socialLinks: string[];
  logoDataUrl: string | null;
  stakeAddress: string;
  drepIdOnchain: string | null;
  subcategoryIds: string[];
  approved: boolean;
}
export interface DaoExpert {
  id: string;
  displayName: string;
  bio: string | null;
  conflictOfInterest: string | null;
  motivation: string | null;
  email: string;
  telegram: string;
  socialLinks: string[];
  logoDataUrl: string | null;
  stakeAddress: string;
  drepIdOnchain: string | null;
  subcategoryIds: string[];
  /** §2.1 — this expert is also an approved submitter (can submit funding proposals). */
  isSubmitter: boolean;
}

export const expertApi = {
  mine: () => request<MyExpert | null>('/me/expert'),
  apply: (input: ExpertApplicationInput) =>
    request<MyExpert>('/me/expert-application', { method: 'POST', body: JSON.stringify(input) }),
  leave: () => request<{ ok: boolean }>('/me/expert/leave', { method: 'POST' }),
};

export const boardExpertsApi = {
  applications: (history = false) =>
    request<ExpertApplication[]>(`/admin/experts/applications${history ? '?history=1' : ''}`),
  approve: (id: string) => request<MyExpert>(`/admin/experts/${id}/approve`, { method: 'POST' }),
  reject: (id: string) => request<{ ok: boolean }>(`/admin/experts/${id}/reject`, { method: 'POST' }),
};

// §2.1 — submitter role: apply with a profile form; the board approves/rejects (with a reason).
export interface SubmitterApplicationInput {
  displayName: string;
  description: string;
  githubUrls?: string[];
  socialLinks?: string[];
  logoDataUrl?: string;
  country: string;
  conflictOfInterest: string;
  noSelfVotePledge?: boolean;
  telegram: string;
  email: string;
  previousFunding?: string;
  agreePersist?: boolean;
  // §2 — cross-wallet link to a DAO-member profile (DRep id; empty string clears it).
  linkedDrepIdOnchain?: string;
}
export interface SubmitterHistoryItem {
  displayName: string;
  description: string;
  githubUrls: string[];
  socialLinks: string[];
  logoDataUrl: string | null;
  country: string;
  conflictOfInterest: string;
  noSelfVotePledge: boolean;
  telegram: string;
  email: string;
  previousFunding: string;
  snapshotAt: string;
}
export interface MySubmitter {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'LEFT';
  displayName: string;
  description: string;
  githubUrls: string[];
  socialLinks: string[];
  logoDataUrl: string | null;
  country: string;
  conflictOfInterest: string;
  noSelfVotePledge: boolean;
  telegram: string;
  email: string;
  previousFunding: string;
  rejectionReason: string | null;
  leftAt: string | null;
  history: SubmitterHistoryItem[];
  // §2 — cross-wallet link: the DAO-member DRep id this submitter declared (own selection),
  // and the resolved linked DAO member (reflects a link set from either side).
  linkedDrepIdOnchain: string | null;
  linkedDaoMember: { drepIdOnchain: string; name: string; crossWallet: boolean } | null;
}
export interface SubmitterApplication extends MySubmitter {
  stakeAddress: string;
}
export interface ApprovedSubmitter {
  id: string;
  /** §2 — the submitter's account id (the value a DAO member selects to link to this profile). */
  userId: string;
  displayName: string;
  /** §2 — when this submitter is also a DAO member with a different name, that name. */
  daoMemberName: string | null;
  /** §2 — the linked DAO member's on-chain DRep id, for cross-linking to their profile. */
  daoMemberDrepId: string | null;
  description: string;
  country: string;
  githubUrls: string[];
  socialLinks: string[];
  logoDataUrl: string | null;
  noSelfVotePledge: boolean;
  conflictOfInterest: string;
  telegram: string;
  email: string;
  previousFunding: string;
  stakeAddress: string;
  drepIdOnchain: string | null;
  isDaoMember: boolean;
  status: 'APPROVED' | 'LEFT';
  leftAt: string | null;
  since: string | null;
}
export interface SubmitterProposalRow {
  id: string;
  publicId: string | null;
  title: string;
  status: string;
  stage: string | null;
  roundNumber: number | null;
  roundName: string | null;
  requestedAda: number;
  milestonesTotal: number;
  milestonesPaid: number;
  paidAda: number;
}
export interface SubmitterPortfolio {
  proposals: SubmitterProposalRow[];
  stats: {
    submitted: number;
    requestedAda: number;
    approvedAda: number;
    paidAda: number;
    completed: number;
    inProgress: number;
    rejected: number;
    missingMilestones: number;
  };
}
export const submitterApi = {
  mine: () => request<MySubmitter | null>('/me/submitter'),
  apply: (input: SubmitterApplicationInput) =>
    request<MySubmitter>('/me/submitter-application', { method: 'POST', body: JSON.stringify(input) }),
  // §2.1/§14 — how many submitter applications await board approval (+ whether a board exists).
  pendingCount: () => request<{ count: number; boardElected: boolean }>('/dao/submitters/pending-count'),
  directory: (includeLeft = false) => request<ApprovedSubmitter[]>(`/dao/submitters${includeLeft ? '?includeLeft=1' : ''}`),
  // §3 — validate a payout/refund address + whether it's the submitter's own wallet.
  checkPayoutAddress: (address: string) =>
    request<{ valid: boolean; networkOk: boolean; mine: boolean; hasStakePart: boolean }>(`/me/check-payout-address?address=${encodeURIComponent(address)}`),
  portfolio: (id: string) => request<SubmitterPortfolio>(`/dao/submitters/${id}/portfolio`),
  leave: () => request<{ ok: boolean }>('/me/submitter/leave', { method: 'POST' }),
};
export const boardSubmittersApi = {
  applications: (history = false) =>
    request<SubmitterApplication[]>(`/admin/submitters/applications${history ? '?history=1' : ''}`),
  approve: (id: string) => request<{ ok: boolean }>(`/admin/submitters/${id}/approve`, { method: 'POST' }),
  reject: (id: string, reason: string) =>
    request<{ ok: boolean }>(`/admin/submitters/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  // §2 (board) — override a submitter's cross-wallet link to a DAO member (null clears it).
  setLink: (id: string, linkedDrepIdOnchain: string | null) =>
    request<MySubmitter>(`/admin/submitters/${id}/link`, { method: 'PATCH', body: JSON.stringify({ linkedDrepIdOnchain }) }),
};

export interface RoundCategoryInput {
  id?: string; // present when editing an existing category (update in place)
  name: string;
  type?: string; // GRANT | RFP
  allocatedAda: number;
  minAda?: number; // min funding request per proposal (§5.2)
  maxAda?: number; // max funding request per proposal (§5.2)
  conditions?: string;
  description?: string;
}
export interface RoundScheduleInput {
  stageKey: string;
  startsAt: string;
  endsAt: string;
}
export interface RoundSettingsInput {
  filterReviewerCount?: number;
  filterApprovalVotes?: number;
  milestoneReviewerCount?: number;
  milestoneApprovalVotes?: number;
  dvApprovalThresholdPct?: number;
  rewardExpertSharePct?: number;
  rewardDvSharePct?: number;
  rewardFixedPct?: number;
  feeCommercialPct?: number;
  feeCommercialCapAda?: number;
  feeOssPct?: number;
  feeOssCapAda?: number;
  feeCapPerRoundAda?: number;
  quickPollParticipationPct?: number;
  quickPollDurationHours?: number;
  quickPollMaxExtensions?: number;
  milestoneNotificationDaysBeforeEnd?: number;
  milestoneAutoExtensionDays?: number;
  milestoneCheckPeriodDays?: number;
  milestoneBoardExtraExtensionDays?: number;
  boardPayoutDeadlineDays?: number;
  pledgeThresholdAda?: number;
  pledgeGraceDays?: number;
  filterResubmissionsAllowed?: number;
  filterBudgetChangesAllowed?: number;
  mandatoryWords?: number;
  mandatoryWordsMax?: number;
  minimumTitleLen?: number;
  minimumMilestoneTitleLen?: number;
  // §12 — budget-change policy (YES/NO as 1/0).
  ignoreBudgetChange?: number;
  requireFeeTopUp?: number;
  requireFeeReturn?: number;
}
export interface CreateRoundInput extends RoundSettingsInput {
  name?: string;
  budgetAda: number;
  rewardsPoolAda: number;
  categories: RoundCategoryInput[];
  schedule?: RoundScheduleInput[];
}
export interface RoundSummary {
  id: string;
  number: number;
  name: string | null;
  status: string;
  active: boolean;
  budgetAda: number;
  rewardsPoolAda: number;
  categoryCount: number;
  eligibleCount: number;
  proposalCount: number;
  proposalCounts: Record<string, number>;
  /** ACTIVE proposals broken down by stage (FILTERING / DEBATE_VOTE / FUNDING). */
  activeStageCounts?: Record<string, number>;
}
export interface RoundScheduleEntry {
  stageKey: string;
  startsAt: string;
  endsAt: string;
  autoStart: boolean;
  confirmedAt: string | null;
  prolongedFrom: string | null;
}
export interface RoundNextStage {
  status: string;
  stageKey: string | null;
  manualOnly: boolean;
  planned: { startsAt: string; endsAt: string } | null;
  autoStart: boolean;
  confirmed: boolean;
}
export interface RoundDetail extends RoundSummary {
  multisigAddress: string;
  categories: {
    id: string;
    name: string;
    type: string;
    allocatedAda: number;
    minAda: number | null;
    maxAda: number | null;
    conditions: string | null;
    description: string | null;
    // §6 — per-category proposal activity, by stage (submitted excludes private DRAFTs).
    stats: {
      submitted: number;
      totalRequestedAda: number;
      submitters: number;
      feesCollectedAda: number;
      pending: number;
      accepted: number;
      notAccepted: number;
      inFiltering: number;
      passedFiltering: number;
      rejectedFiltering: number;
      inVoting: number;
      approved: number;
      rejectedVote: number;
      fundedAllocatedAda: number;
      milestonesTotal: number;
      milestonesApproved: number;
      milestonesPaid: number;
    };
  }[];
  schedule: RoundScheduleEntry[];
  settings: { [K in keyof Required<RoundSettingsInput>]: number | null };
  nextStage: RoundNextStage | null;
}

export const roundsApi = {
  list: () => request<RoundSummary[]>('/rounds'),
  active: () => request<RoundDetail | null>('/rounds/active'),
  get: (id: string) => request<RoundDetail>(`/rounds/${id}`),
};

export interface ConfirmStageInput {
  autoStart: boolean;
  startsAt?: string;
  endsAt?: string;
}
export const boardRoundsApi = {
  create: (input: CreateRoundInput) =>
    request<RoundDetail>('/admin/rounds', { method: 'POST', body: JSON.stringify(input) }),
  /** §6/§8 — count of overdue stage starts (board badge). */
  overdueStages: () => request<{ count: number }>('/admin/rounds/overdue-stages'),
  update: (id: string, input: Partial<CreateRoundInput>) =>
    request<RoundDetail>(`/admin/rounds/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  startStage: (id: string, stage: string) =>
    request<RoundDetail>(`/admin/rounds/${id}/start-stage/${stage}`, { method: 'POST' }),
  confirmStage: (id: string, stageKey: string, input: ConfirmStageInput) =>
    request<RoundDetail>(`/admin/rounds/${id}/stages/${stageKey}/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  launchNext: (id: string) => request<RoundDetail>(`/admin/rounds/${id}/launch-next`, { method: 'POST' }),
  close: (id: string) => request<RoundDetail>(`/admin/rounds/${id}/close`, { method: 'POST' }),
  // §6 — shorten or extend the currently-running stage's end (start is frozen).
  updateCurrentStage: (id: string, endsAt: string) =>
    request<RoundDetail>(`/admin/rounds/${id}/current-stage`, { method: 'PATCH', body: JSON.stringify({ endsAt }) }),
  // §6 — update a FUTURE stage's planned dates without advancing the round.
  updatePlannedStage: (id: string, stageKey: string, input: ConfirmStageInput) =>
    request<RoundDetail>(`/admin/rounds/${id}/stages/${stageKey}/plan`, { method: 'PATCH', body: JSON.stringify(input) }),
};

export interface ProposalMilestoneInput {
  title?: string;
  description: string;
  acceptanceCriteria?: string;
  amountAda: number;
}
export interface CreateProposalInput {
  roundId: string;
  categoryId: string;
  title: string;
  contentMd: string;
  isCommercial: boolean;
  requestedAmountAda: number;
  subcategoryIds?: string[];
  costBreakdownMd?: string;
  teamInfoMd?: string;
  revenueSharingMd?: string;
  ecosystemImpactMd?: string;
  successMetricsMd?: string;
  payoutAddress?: string;
  submissionFeeTxHash?: string;
  pledgeAmountAda?: number;
  pledgeReturnMethod?: string;
  // §3.4 — revenue-sharing gate: when true, the board must verify the team's
  // promised action (e.g. token contribution to the Treasury) before milestone
  // POAs unblock post-approval.
  revenueSharingRequired?: boolean;
  milestones: ProposalMilestoneInput[];
}
export interface ProposalProgress {
  stage: string;
  label: string;
  tone: 'amber' | 'emerald' | 'neutral' | 'red';
  // §8/§9 — secondary chip rendered after the main label (e.g. live threshold
  // YES/NO status next to a "4/6 DReps voted" chip during the VOTE stage).
  extra?: { label: string; tone: 'amber' | 'emerald' | 'neutral' | 'red' };
}
export interface FeeVerification {
  requiredAda: number;
  paidAda: number;
  missingAda: number;
  fullyPaid: boolean;
  /** False when the on-chain check itself couldn't run (Koios down / throttling)
   *  — the UI should say "can't reach the chain right now", not "tx not found". */
  koiosAvailable: boolean;
  txs: { hash: string; found: boolean; paidAda: number; koiosAvailable: boolean }[];
}
// §3 — same shape as FeeVerification but with a single tx (the pledge is paid in one go).
export interface PledgeVerification {
  requiredAda: number;
  paidAda: number;
  missingAda: number;
  fullyPaid: boolean;
  koiosAvailable: boolean;
  tx: { hash: string; found: boolean; paidAda: number; koiosAvailable: boolean } | null;
}
export interface ProposalRejectionReason {
  stage: string;
  from: string | null;
  rationale: string;
}
// §UI — proposal search helper (Title / Proposer / public ID, multi-term). Lives in the
// shared package (so it can be unit-tested without a web runner); re-exported here so
// components keep importing it from '@/lib/api'.
export { matchesProposalSearch, matchesDvMode } from '@drep-dao/shared';

export interface ProposalSummary {
  id: string;
  publicId: string | null;
  type: string;
  status: string;
  stage: string | null;
  title: string;
  categoryName: string | null;
  roundId: string | null;
  isCommercial: boolean | null;
  requestedAmountAda: number;
  /** §10 — INTERNAL proposals only: INSTRUCTIVE | INFORMATIVE | POLL | SPENDING (null for funding). */
  internalType?: string | null;
  /** §10 — set only for an internal SPENDING proposal (ADA paid from the treasury on approval). */
  spendingAmountAda?: number | null;
  submissionFeeTxHash: string | null;
  submitter: string | null;
  /** §26.2 — "what's needed now" for ACTIVE rows (filtering reviewers, D&V, milestones). */
  progress?: ProposalProgress | null;
  /** §7/§8/§16 — DRep / board rationales that decided a REJECTED proposal. */
  rejectionReasons?: ProposalRejectionReason[] | null;
  /** §11 — FUNDING proposals: whether milestone reviewers have been assigned. */
  milestoneReviewers?: 'assigned' | 'not_assigned' | null;
  /** §11 — names of the assigned milestone reviewers (when assigned). */
  milestoneReviewerNames?: string[];
  /** §11 — milestone progress bar; present only once the proposal reached the
   *  FUNDING stage (then it persists into history). One entry per milestone. */
  milestoneBar?: MilestoneSegment[] | null;
  /** §12 — the submitter still owes a submission-fee top-up (budget increase). */
  feeTopUpDue?: boolean;
  /** §8 — the viewing DRep's own Debate & Vote choice on this proposal (null = not voted yet). */
  myDvVote?: string | null;
  /** §6 — the round's status, so lists can gate submitter editing (closes once VOTE starts). */
  roundStatus?: string | null;
  /** §8 — set when a Debate & Vote tally was published. Distinguishes a fee rejection (stage null,
   *  resultFinalizedAt null — still editable) from a D&V rejection (stage null, finalised — closed). */
  resultFinalizedAt?: string | null;
}
export interface MilestoneSegment {
  idx: number;
  title: string | null;
  amountAda: number;
  state: 'NOT_STARTED' | 'UNDER_REVIEW' | 'REJECTED' | 'PAYMENT_PENDING' | 'PAID' | 'LOST';
  poaAttempts: number;
  poaSubmittedAt: string | null;
  reviewYes: number;
  reviewThreshold: number;
  reviewers: string[];
  deadlineAt: string | null;
  paidInTx: string | null;
}
export interface ProposalDetail extends ProposalSummary {
  categoryId: string;
  contentMd: string;
  costBreakdownMd: string | null;
  teamInfoMd: string | null;
  revenueSharingMd: string | null;
  ecosystemImpactMd: string | null;
  successMetricsMd: string | null;
  subcategoryIds: string[];
  submissionFeeAda: number;
  submissionFeeTxHashes: string[];
  feeReviewFeedback: string | null;
  // §7.4 — resubmit budget after a filtering rejection.
  filterResubmissionsUsed: number;
  filterResubmissionsAllowed: number;
  // §12 — in-filter budget-change budget (separate counter from resubmissions).
  budgetChangesUsed: number;
  filterBudgetChangesAllowed: number;
  // §12 — a pending board-approval-needed budget change, if any. Hides the
  // "Request a budget change" button (one outstanding request at a time) and
  // surfaces a banner for both the submitter and the board.
  pendingBudgetChange: PendingBudgetChange | null;
  // The proposal's round status (PREPARATION / SUBMISSION / FILTERING / DV / FUNDING / CLOSED).
  // Used by edit gates: editing closes once the round moves past SUBMISSION (unless rejected).
  roundStatus: string | null;
  // §12 — YES → the budget is freely editable in the editor and there's no "Request a budget
  // change" button (the submission fee never changes).
  ignoreBudgetChange: boolean;
  submittedAt: string | null;
  // §9.3 — set when the D&V tally is published. Lets the rejection banner
  // distinguish a D&V rejection (stage=null + this set) from a fee rejection.
  resultFinalizedAt: string | null;
  payoutAddress: string | null;
  pledgeAmountAda: number;
  pledgeReturnMethod: string | null;
  pledgeTxHash: string | null;
  pledgeConfirmedAt: string | null;
  pledgeFeedback: string | null;
  // §3.4 — revenue-sharing gate. When required, the board must verify before
  // milestone POAs unblock; until then any POA submission is refused.
  revenueSharingRequired: boolean;
  revenueSharingVerifiedAt: string | null;
  categoryAsk: { minAda: number | null; maxAda: number | null; conditions: string | null };
  milestones: { id: string; idx: number; title: string | null; description: string; acceptanceCriteria: string | null; amountAda: number; status: string }[];
  // §8.1 — the post-debate content fingerprint: the exact canonical text that was
  // frozen when Debate ended, its hash, the hash function used, and the on-chain tx.
  // Null until the proposal is frozen (round reaches VOTE).
  contentFingerprint: { text: string; hash: string; hashAlgo: string; frozenAt: string; txHash: string | null } | null;
}

export const proposalsApi = {
  byRound: (roundId: string) => request<ProposalSummary[]>(`/rounds/${roundId}/proposals`),
  /** §26.2 — every proposal across ALL rounds (newest first, capped at 1000). */
  allRounds: () => request<ProposalSummary[]>('/proposals'),
  get: (id: string) => request<ProposalDetail>(`/proposals/${id}`),
  mine: () => request<ProposalSummary[]>('/me/proposals'),
  create: (input: CreateProposalInput) =>
    request<ProposalDetail>('/proposals', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<CreateProposalInput>) =>
    request<ProposalDetail>(`/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  budgetChange: (id: string, input: { requestedAmountAda: number; milestones: ProposalMilestoneInput[]; reason?: string }) =>
    request<{ id: string; status: string }>(`/proposals/${id}/budget-change`, { method: 'POST', body: JSON.stringify(input) }),
  // §3 — team pastes the on-chain pledge payment tx hash (FUNDING + promised pledge).
  pledgeTx: (id: string, txHash: string) =>
    request<ProposalDetail>(`/proposals/${id}/pledge-tx`, { method: 'POST', body: JSON.stringify({ txHash }) }),
  // §12 — submitter verifies the cumulative submission-fee payment on-chain.
  verifyFee: (id: string) => request<FeeVerification>(`/proposals/${id}/verify-fee`),
  // §3 — submitter verifies the on-chain pledge payment.
  verifyPledge: (id: string) => request<PledgeVerification>(`/proposals/${id}/verify-pledge`),
  submit: (id: string, submissionFeeTxHash: string) =>
    request<ProposalDetail>(`/proposals/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ submissionFeeTxHash }),
    }),
  // §7.4 — resubmit a proposal rejected at filtering; clears filtering votes.
  resubmit: (id: string) =>
    request<ProposalDetail>(`/proposals/${id}/resubmit`, { method: 'POST' }),
};

export interface FilterAssignment {
  proposalId: string;
  title: string;
  /** §UI — searchable metadata: public proposal id + proposer name. */
  publicId?: string | null;
  proposer?: string | null;
  myVote: string | null;
  proposalStatus?: string;
  proposalStage?: string | null;
  /** True = pre-assigned during SUBMISSION; voting opens when the round moves to FILTERING. */
  queued?: boolean;
}
/** A vote with its public rationale (filtering / D&V / milestone). */
export interface VoteRationale {
  drep: string | null;
  displayName: string | null;
  choice: string;
  rationale: string | null;
  weight?: number;
}
export interface FilterAssignee {
  drepId: string;
  drep: string | null;
  displayName: string | null;
  voted: boolean;
  choice: string | null;
  expertiseMatch: boolean;
}
export interface FilterCandidate {
  drepId: string;
  drepIdOnchain: string;
  displayName: string | null;
  subcategoryIds: string[];
  matchedSubcategoryIds: string[];
  expertiseMatch: boolean;
  loadInRound: number;
  alreadyAssigned: boolean;
  alreadyVoted: boolean;
  /** False = DRep is admitted but not yet in this round's eligibility list;
   *  picking them on assignment auto-adds them to the round. */
  inRound: boolean;
}
export interface FilterResult {
  reviewers: number;
  assigned: FilterAssignee[];
  yes: number;
  no: number;
  abstain: number;
  threshold: number;
  status: string;
  stage: string | null;
  votes: VoteRationale[];
  anchorTxHash: string | null;
  anchorHash: string | null;
}

export interface VotingTasksCount { filtering: number; dv: number; milestone: number; total: number }
/** §7 — review list view: actionable to-dos (default), all items in the active stage, or full history. */
export type ReviewMode = 'pending' | 'recent' | 'history';
export const filteringApi = {
  myAssignments: (mode: ReviewMode = 'pending') => request<FilterAssignment[]>(`/me/assignments/filter?mode=${mode}`),
  votingTasks: () => request<VotingTasksCount>('/me/voting-tasks'),
  result: (proposalId: string) => request<FilterResult>(`/proposals/${proposalId}/filter-result`),
  vote: (proposalId: string, choice: 'YES' | 'NO' | 'ABSTAIN', rationale?: string) =>
    request<FilterResult>(`/proposals/${proposalId}/filter-vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
};

// §11 — board to-do: proposals awaiting reviewer assignment (filtering + milestone).
export interface PendingReviewerAssignment {
  proposalId: string;
  publicId: string | null;
  title: string;
  kind: 'FILTERING' | 'MILESTONE';
  roundNumber: number | null;
  submitter: string | null;
  targetCount: number;
}

// Board: confirm fee / draw reviewers / open D&V voting / finalize.
export const boardProposalsApi = {
  reviewFee: (id: string, decision: 'APPROVE' | 'REJECT', feedback?: string) =>
    request<ProposalDetail>(`/admin/proposals/${id}/review-fee`, { method: 'POST', body: JSON.stringify({ decision, feedback }) }),
  drawReviewers: (id: string) =>
    request<FilterResult>(`/admin/proposals/${id}/draw-reviewers`, { method: 'POST' }),
  pendingReviewerAssignment: () =>
    request<PendingReviewerAssignment[]>('/admin/proposals/pending-reviewer-assignment'),
  // §7.1 — list candidate DReps for the board's "Change reviewer" picker.
  // `all=true` also includes admitted DReps outside this round's eligibility
  // list (each carries `inRound: false`); picking them auto-adds them to the
  // round on assignment.
  filterCandidates: (id: string, all = false) =>
    request<FilterCandidate[]>(`/admin/proposals/${id}/filter-candidates${all ? '?all=1' : ''}`),
  // §7.1 — swap one assigned filtering reviewer for another (blocked if the old
  // reviewer has already voted).
  replaceFilterReviewer: (id: string, oldDrepId: string, newDrepId: string) =>
    request<FilterResult>(`/admin/proposals/${id}/replace-reviewer`, {
      method: 'POST',
      body: JSON.stringify({ oldDrepId, newDrepId }),
    }),
  openDvVote: (id: string) =>
    request<DvResult>(`/admin/proposals/${id}/open-dv-vote`, { method: 'POST' }),
  finalizeDv: (id: string) =>
    request<DvResult>(`/admin/proposals/${id}/finalize-dv`, { method: 'POST' }),
  // §12 — pending budget-change requests awaiting board approval.
  pendingBudgetChanges: () =>
    request<PendingBudgetChangeRow[]>('/admin/proposals/pending-budget-changes'),
  approveBudgetChange: (requestId: string, feedback?: string) =>
    request<ProposalDetail>(`/admin/proposals/budget-changes/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ feedback }) }),
  rejectBudgetChange: (requestId: string, feedback: string) =>
    request<ProposalDetail>(`/admin/proposals/budget-changes/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ feedback }) }),
  // §3.4 — board verifies a proposal's revenue-sharing conditions (token
  // contribution, etc.) to unblock its milestone POAs post-approval.
  verifyRevenueSharing: (proposalId: string) =>
    request<ProposalDetail>(`/admin/proposals/${proposalId}/verify-revenue-sharing`, { method: 'POST' }),
};

export interface PendingBudgetChangeRow {
  id: string;
  proposalId: string;
  proposalTitle: string;
  proposalPublicId: string | null;
  requester: string | null;
  prevAmountAda: number;
  proposedAmountAda: number;
  proposedMilestones: { title: string | null; description: string; acceptanceCriteria: string | null; amountAda: number }[];
  reason: string | null;
  createdAt: string;
}

export interface DvResult {
  open: boolean;
  eligible?: number;
  cast?: number;
  yesPower?: number;
  abstainPower?: number;
  totalPower?: number;
  denominator?: number;
  ratioPct?: number;
  thresholdPct?: number;
  approved?: boolean;
  status?: string;
  stage?: string | null;
  myChoice?: 'YES' | 'NO' | 'ABSTAIN' | null; // the logged-in DRep's own vote (null = not voted)
  myRationale?: string | null; // the logged-in DRep's current rationale (pre-fills the box)
  myRationaleHistory?: { choice: string; rationale: string | null; castAt: string }[]; // superseded, newest first
  votes?: VoteRationale[];
  anchorTxHash?: string | null;
  anchorHash?: string | null;
}

export const dvApi = {
  result: (id: string) => request<DvResult>(`/proposals/${id}/dv-result`),
  vote: (id: string, choice: 'YES' | 'NO' | 'ABSTAIN', rationale: string) =>
    request<DvResult>(`/proposals/${id}/dv-vote`, {
      method: 'POST',
      body: JSON.stringify({ choice, rationale }),
    }),
  optIn: (id: string) => request<DvResult>(`/proposals/${id}/dv-opt-in`, { method: 'POST' }),
  votingResults: (roundId: string) => request<VotingResults>(`/rounds/${roundId}/voting-results`),
};

// §9 — per-category continuous Debate & Vote results for a round (the "Voting Result" tab).
export interface VotingResultProposal {
  id: string;
  publicId: string | null;
  title: string;
  requestedAmountAda: number;
  categoryId: string | null;
  categoryName: string | null;
  outcome: 'APPROVED' | 'PENDING' | 'REJECTED';
  // funded — won funding · cut — passed the vote but the budget ran out · tie — tied at the cliff
  // (quick poll decides) · votes — got decisive votes but below threshold · nopower — no voting
  // power (no eligible DRep cast a decisive vote).
  budgetOutcome: 'funded' | 'cut' | 'tie' | 'votes' | 'nopower';
  yesPower: number;
  noPower: number;
  abstainPower: number;
  totalPower: number;
  thresholdPct: number;
  ratioPct: number;
  cast: number;
  eligible: number;
  inQuickPoll: boolean;
  quickPollPower: number;
}
export interface VotingResults {
  categories: {
    id: string | null;
    name: string | null;
    allocatedAda: number;            // the category's total budget
    allocatedToApprovedAda: number;  // committed to funded proposals
    remainingAda: number;            // unallocated remainder
    proposals: VotingResultProposal[];
  }[];
}

// -------- Public platform config (explorer, network, fee address) --------
export interface PublicConfig {
  network: string;
  explorer: string;
  submissionFeeAddress: string | null;
  pledgeAddress: string | null;
  anchorMetadataLabel: number;
  internalThresholds: { default: number; important: number };
  /** §15.3 — true once the board has assembled the on-chain multisig. UI
   *  uses this to gate features that only make sense when the script
   *  address exists (e.g. queueing board-initiated transfers). */
  multisigConfigured: boolean;
}
export const configApi = { get: () => request<PublicConfig>('/config') };

// §2 — public, unauthenticated snapshot for the logged-out landing page.
export interface PublicOverview {
  network: string;
  admissionOpen: boolean;
  treasuryBalanceAda: number | null;
  members: { votingDReps: number; experts: number };
  board: { seats: number; elected: boolean };
  proposals: { approved: number; inReview: number; rejected: number; total: number };
  internalProposals: { active: number; passed: number; total: number };
  activeRound: {
    number: number;
    name: string;
    status: string;
    budgetAda: number;
    rewardsPoolAda: number;
    eligibleCount: number;
    proposalCount: number;
  } | null;
}
export const publicApi = { overview: () => request<PublicOverview>('/public/overview') };

// -------- Per-user preferences (§20): personal block explorer --------
export interface UserPreferences {
  explorer: string | null; // cardanoscan | cexplorer | adastat | custom | null (=platform default)
  explorerCustomTxUrl: string | null;
}
export const meApi = {
  preferences: () => request<UserPreferences>('/me/preferences'),
  setPreferences: (p: { explorer?: string; explorerCustomTxUrl?: string }) =>
    request<UserPreferences>('/me/preferences', { method: 'PATCH', body: JSON.stringify(p) }),
};

// -------- Proposal version history (diff view) --------
/** Full per-edit snapshot of every editable field — what the diff view compares. */
export interface ProposalSnapshot {
  title: string;
  contentMd: string;
  ecosystemImpactMd: string | null;
  successMetricsMd: string | null;
  costBreakdownMd: string | null;
  teamInfoMd: string | null;
  revenueSharingMd: string | null;
  payoutAddress: string | null;
  subcategoryIds: string[];
  requestedAmountAda: number;
  isCommercial: boolean;
  milestones: { idx: number; title: string | null; description: string; acceptanceCriteria: string | null; amountAda: number }[];
}
export interface ProposalVersionEntry {
  version: number;
  contentMd: string;
  // Pre-snapshot rows have snapshot=null; the diff view falls back to a
  // contentMd-only comparison for those.
  snapshot: ProposalSnapshot | null;
  editedAt: string;
  editor: string | null;
  current: boolean;
}
export const proposalVersionsApi = {
  list: (id: string) => request<ProposalVersionEntry[]>(`/proposals/${id}/versions`),
};
export const proposalEditApi = {
  update: (
    id: string,
    patch: {
      title?: string;
      contentMd?: string;
      requestedAmountAda?: number;
      isCommercial?: boolean;
      costBreakdownMd?: string;
      teamInfoMd?: string;
      revenueSharingMd?: string;
      ecosystemImpactMd?: string;
      successMetricsMd?: string;
      subcategoryIds?: string[];
      payoutAddress?: string;
      submissionFeeTxHash?: string;
      // §7.4 — milestones are editable during the resubmit cycle after a filtering
      // rejection (the resub clears the jury votes anyway); locked elsewhere.
      milestones?: ProposalMilestoneInput[];
      // §3 — skin-in-the-game pledge (amount + return method). Editable until
      // confirmed on-chain by the board. Set amount to 0 to remove the pledge.
      pledgeAmountAda?: number;
      pledgeReturnMethod?: string;
      // §3.4 — revenue-sharing gate.
      revenueSharingRequired?: boolean;
    },
  ) => request<ProposalDetail>(`/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

// -------- Comments (§20.1) --------
export interface CommentNode {
  id: string;
  parentId: string | null;
  author: { displayName: string | null; drepId: string | null; role: string | null };
  contentMd: string | null;
  deleted: boolean;
  createdAt: string;
  /** True when the comment was written by the proposal's submitter (team). */
  isSubmitter?: boolean;
  /** True when the signed-in viewer wrote this comment — drives Edit / Delete. */
  isMine?: boolean;
  /**
   * §8.1 — True when the author is a DRep in the round's voting eligibility
   * list (i.e. one of the people who will cast a ballot in the VOTE phase).
   * Comments from these authors render purple to make voter feedback obvious
   * during the DEBATE phase.
   */
  isVotingEligible?: boolean;
  replies?: CommentNode[];
}
export const commentsApi = {
  list: (proposalId: string) => request<CommentNode[]>(`/proposals/${proposalId}/comments`),
  create: (proposalId: string, contentMd: string, parentId?: string) =>
    request<{ id: string }>(`/proposals/${proposalId}/comments`, { method: 'POST', body: JSON.stringify({ contentMd, parentId }) }),
  edit: (id: string, contentMd: string) =>
    request<{ ok: boolean }>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ contentMd }) }),
  remove: (id: string) => request<{ ok: boolean }>(`/comments/${id}`, { method: 'DELETE' }),
};

// -------- Milestones (§11) --------
export interface MilestoneReviewer { drepId: string | null; drepIdOnchain: string | null; displayName: string | null }
export interface MilestoneView {
  id: string;
  idx: number;
  title: string | null;
  description: string | null;
  acceptanceCriteria: string | null;
  amountAda: number;
  status: string;
  /** §11.4/§11.5 — payout + deadline tracking. */
  paidAt: string | null;
  paidInTx: string | null;
  deadlineAt: string | null;
  autoExtendedCount: number;
  boardExtensionDays: number | null;
  boardExtendedAt: string | null;
  reviewers: MilestoneReviewer[];
  latestPoa: { contentMd: string | null; submittedAt: string; attempt: number } | null;
  /** Earlier (superseded) POA attempts — every one was rejected (or it would
   *  have been the final, approved attempt). Shown in a collapsible history. */
  pastPoas: { attempt: number; contentMd: string | null; submittedAt: string }[];
  poaCount: number;
  yes: number;
  no: number;
  threshold: number;
  votes: VoteRationale[];
  anchorTxHash: string | null;
  /** §11/§15 — disbursement status for this milestone's PROJECT_FUNDING
   *  multisig action. null until the milestone is APPROVED + the action
   *  has been prepared. */
  payout: {
    status: string;        // PENDING_SIGS | READY | BROADCASTED | CONFIRMED
    approvals: number;
    threshold: number;
    txHash: string | null;
    paidAt: string | null;
  } | null;
}
export interface MilestoneAssignmentView {
  milestoneId: string;
  proposalId: string;
  proposalTitle: string;
  /** §UI — searchable metadata: public proposal id + proposer name. */
  proposalPublicId?: string | null;
  proposer?: string | null;
  milestoneIdx: number;
  myVote: string | null;
  milestoneStatus?: string;
}
export interface StopFundingView {
  id: string;
  proposerRole: 'REVIEWER' | 'BOARD' | string;
  proposerName: string | null;
  proposerDrep: string | null;
  reason: string;
  status: 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | string;
  createdAt: string;
  decidedAt: string | null;
  anchorTxHash: string | null;
  threshold: number;
  yes: number;
  no: number;
  votes: { drep: string | null; displayName: string | null; choice: string; rationale: string | null }[];
}
export interface ActiveStopFunding extends StopFundingView {
  proposalId: string;
  proposalTitle: string;
  proposalPublicId: string | null;
  roundLabel: string | null;
  myChoice: 'YES' | 'NO' | null;
}
export const milestonesApi = {
  forProposal: (proposalId: string) => request<MilestoneView[]>(`/proposals/${proposalId}/milestones`),
  myAssignments: (history = false) => request<MilestoneAssignmentView[]>(`/me/assignments/milestone${history ? '?history=1' : ''}`),
  submitPoa: (milestoneId: string, contentMd: string) =>
    request<unknown>(`/milestones/${milestoneId}/poa`, { method: 'POST', body: JSON.stringify({ contentMd }) }),
  vote: (milestoneId: string, choice: 'YES' | 'NO', rationale?: string) =>
    request<unknown>(`/milestones/${milestoneId}/vote`, { method: 'POST', body: JSON.stringify({ choice, rationale }) }),
  // §11 — stop funding (reviewer or board can propose; board votes 1p1v).
  stopFundings: (proposalId: string) => request<StopFundingView[]>(`/proposals/${proposalId}/stop-fundings`),
  proposeStop: (proposalId: string, reason: string) =>
    request<StopFundingView>(`/proposals/${proposalId}/stop-funding`, { method: 'POST', body: JSON.stringify({ reason }) }),
  withdrawStop: (stopId: string) =>
    request<StopFundingView>(`/stop-fundings/${stopId}/withdraw`, { method: 'POST' }),
  voteStop: (stopId: string, choice: 'YES' | 'NO', rationale?: string) =>
    request<StopFundingView>(`/stop-fundings/${stopId}/vote`, { method: 'POST', body: JSON.stringify({ choice, rationale }) }),
  pendingStopFunding: () => request<{ count: number }>('/me/pending-stop-funding'),
};

// -------- Board: submission-fee confirmations (§16) + milestone admin --------
export interface PendingFee {
  id: string;
  title: string;
  roundNumber: number | null;
  categoryName: string | null;
  isCommercial: boolean | null;
  requestedAmountAda: number;
  submissionFeeAda: number;
  submissionFeeTxHash: string | null;
  // Every fee tx the submitter entered, each with its own on-chain verification.
  txs: { hash: string; found: boolean; paid: boolean; paidAda: number }[];
  submitter: string | null;
  submittedAt: string;
  // Summary on-chain verification (paid if ANY entered tx covered the fee).
  feeVerified: { found: boolean; paid: boolean; paidAda: number };
}
export interface FeeHistoryRow {
  id: string;
  publicId: string | null;
  title: string;
  roundNumber: number | null;
  categoryName: string | null;
  isCommercial: boolean | null;
  submitter: string | null;
  submittedAt: string | null;
  submissionFeeAda: number;
  submissionFeeTxHash: string | null;
  decision: 'APPROVED' | 'REJECTED';
  feedback: string | null;
  /** True = the round is still in SUBMISSION; the board may flip the decision. */
  canChange: boolean;
}
export interface FeeHistoryPage {
  total: number;
  limit: number;
  offset: number;
  rows: FeeHistoryRow[];
}
// §3.5 — board ↔ submitter messaging per proposal.
export interface MessageEntry {
  id: string;
  fromBoard: boolean;
  author: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
}
export interface MessageThread {
  id: string;
  proposalId: string;
  proposalTitle: string;
  proposalPublicId: string | null;
  status: 'OPEN' | 'DONE';
  createdAt: string;
  doneAt: string | null;
  lastFromBoard: boolean;
  entries: MessageEntry[];
}
export const messagesApi = {
  forProposal: (proposalId: string) => request<MessageThread[]>(`/proposals/${proposalId}/messages`),
  start: (proposalId: string, body: string) => request<MessageThread>(`/proposals/${proposalId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  reply: (threadId: string, body: string) => request<MessageThread>(`/messages/${threadId}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  markDone: (threadId: string) => request<MessageThread>(`/messages/${threadId}/done`, { method: 'POST', body: JSON.stringify({}) }),
  boardPending: () => request<MessageThread[]>('/messages/board-pending'),
  boardAll: () => request<MessageThread[]>('/messages/board-all'),
  mine: () => request<MessageThread[]>('/my/messages'),
};

export interface PendingRevenueSharing {
  id: string;
  publicId: string | null;
  title: string;
  roundNumber: number | null;
  categoryName: string | null;
  submitter: string | null;
  revenueSharingMd: string | null;
  hintAddress: string | null;
}
export const boardRevenueApi = {
  // §3.4 — funded proposals awaiting the board's revenue-sharing verification (gates milestone POAs).
  pending: () => request<PendingRevenueSharing[]>('/admin/proposals/pending-revenue-sharing'),
  verify: (id: string) => request<unknown>(`/admin/proposals/${id}/verify-revenue-sharing`, { method: 'POST', body: JSON.stringify({}) }),
};
export const boardFeeApi = {
  pending: () => request<PendingFee[]>('/admin/proposals/pending-fee'),
  // §16 — paginated history of decided fee reviews (approved + fee-rejected).
  history: (limit = 20, offset = 0) =>
    request<FeeHistoryPage>(`/admin/proposals/fee-history?limit=${limit}&offset=${offset}`),
};

// §3 — proposals awaiting board pledge confirmation (in FUNDING, paid on-chain).
export interface PendingPledge {
  id: string;
  publicId: string | null;
  title: string;
  roundNumber: number | null;
  categoryName: string | null;
  submitter: string | null;
  pledgeAmountAda: number;
  pledgeReturnMethod: string | null;
  pledgeTxHash: string | null;
  pledgeGraceEndsAt: string | null;
  pledgeAddress: string;
  verification: { found: boolean; paid: boolean; paidAda: number };
}
export const boardPledgeApi = {
  pending: () => request<PendingPledge[]>('/admin/proposals/pending-pledge'),
  review: (id: string, decision: 'APPROVE' | 'REJECT', feedback?: string) =>
    request<ProposalDetail>(`/admin/proposals/${id}/review-pledge`, {
      method: 'POST',
      body: JSON.stringify({ decision, feedback }),
    }),
};

// §12 — fee settlements from budget changes (board task: My Area → Payments).
export interface FeePayment {
  id: string;
  kind: 'TOPUP' | 'REFUND';
  status: string; // PENDING | SETTLED
  txHash: string | null;
  settledAt: string | null;
  amountAda: number;
  prevAmountAda: number;
  newAmountAda: number;
  prevFeeAda: number | null;
  newFeeAda: number | null;
  note: string | null;
  proposalId: string;
  proposalPublicId: string | null;
  proposalTitle: string | null;
  submitter: string | null;
  payoutAddress: string | null;
  createdAt: string;
}
export const boardPaymentsApi = {
  pending: (history = false) => request<FeePayment[]>(`/admin/proposals/payments${history ? '?history=1' : ''}`),
  // REFUND: pass the board's tx hash. TOPUP: confirm the submitter's payment (no hash needed).
  settle: (id: string, txHash?: string) =>
    request<{ status: string }>(`/admin/proposals/payments/${id}/settle`, { method: 'POST', body: JSON.stringify(txHash ? { txHash } : {}) }),
};

/** §12 — the outstanding submission-fee TOP-UP on the submitter's own proposal (after a budget
 *  increase in a round that requires it). Submitter pays on-chain + submits the tx; board confirms. */
export interface FeeTopUp {
  id: string;
  status: 'PENDING' | 'AWAITING_CONFIRM' | string;
  amountAda: number;
  txHash: string | null;
  newFeeAda: number | null;
}
export const feeTopUpApi = {
  get: (proposalId: string) => request<FeeTopUp | null>(`/proposals/${proposalId}/fee-topup`),
  pay: (proposalId: string, txHash: string) =>
    request<{ status: string }>(`/proposals/${proposalId}/fee-topup`, { method: 'POST', body: JSON.stringify({ txHash }) }),
};
export interface MilestoneCandidate {
  kind: 'DRep' | 'Expert';
  id: string;
  drepId: string | null;
  drepIdOnchain: string | null;
  displayName: string | null;
  subcategoryIds: string[];
  matchedSubcategoryIds: string[];
  expertiseMatch: boolean;
  loadInRound: number;
}
export const boardMilestoneApi = {
  /** Ranked candidate reviewers (DReps + experts) with expertise + per-round load. */
  candidates: (proposalId: string) =>
    request<MilestoneCandidate[]>(`/admin/proposals/${proposalId}/milestone-candidates`),
  /** §11 — one-click random reviewer draw (mirrors filtering's drawReviewers). */
  draw: (proposalId: string) =>
    request<MilestoneView[]>(`/admin/proposals/${proposalId}/draw-milestone-reviewers`, { method: 'POST' }),
  /** Board selects exactly `milestoneReviewerCount` reviewers (DReps and/or experts). */
  assign: (proposalId: string, drepIds: string[], expertIds: string[] = []) =>
    request<MilestoneView[]>(`/admin/proposals/${proposalId}/assign-milestone-reviewers`, {
      method: 'POST',
      body: JSON.stringify({ drepIds, expertIds }),
    }),
  /** Release the currently-assigned reviewers (only before any POA has been submitted). */
  release: (proposalId: string) =>
    request<{ released: boolean }>(`/admin/proposals/${proposalId}/release-milestone-reviewers`, { method: 'POST' }),
  /** §11.1 — swap a single assigned reviewer for another DRep (vacancy / illness / conflict). */
  replaceReviewer: (proposalId: string, oldDrepId: string, newDrepId: string) =>
    request<MilestoneView[]>(`/admin/proposals/${proposalId}/replace-milestone-reviewer`, {
      method: 'POST',
      body: JSON.stringify({ oldDrepId, newDrepId }),
    }),
  terminate: (proposalId: string) => request<{ status: string }>(`/admin/proposals/${proposalId}/terminate`, { method: 'POST' }),
  /** Board-wide list of every ACTIVE stop-funding awaiting board votes. */
  activeStopFundings: () => request<ActiveStopFunding[]>('/admin/stop-fundings/active'),
};

// -------- §10 Internal proposals --------
export type InternalTally =
  | {
      kind: 'THRESHOLD';
      eligible: number;
      cast: number;
      yesPower: number;
      abstainPower: number;
      totalPower: number;
      denominator: number;
      ratioPct: number;
      thresholdPct: number;
      approved: boolean;
    }
  | {
      kind: 'POLL';
      eligible: number;
      voted: number;
      abstain: { power: number; voters: number };
      options: { option: string; power: number; voters: number }[];
    };

export interface InternalProposalSummary {
  id: string;
  publicId: string | null;
  title: string;
  internalType: string; // INSTRUCTIVE | INFORMATIVE | POLL
  votersScope: string; // DREPS_ONLY | BOARD_ONLY | BOTH
  votingType: string; // ONE_PERSON_ONE_VOTE | BALANCED
  thresholdKind: string; // DEFAULT | IMPORTANT
  isPrivate: boolean;
  status: string; // ACTIVE | APPROVED | REJECTED
  submitter: string | null;
  votingEndAt: string | null;
  thresholdPct: number | null;
  tally: InternalTally;
  isMine: boolean;
  myVotes: string[];
  canVote: boolean;
  isBoardElection: boolean;
  boardInstalledAt: string | null;
  /** §10.5 — ADA a SPENDING proposal pays from the treasury on approval (null for other types). */
  spendingAmountAda?: number | null;
}
export interface BoardCandidate {
  drepId: string;
  drepKeyHash: string;
  drepIdOnchain: string;
  displayName: string;
}
export interface InternalProposalVoter {
  drep: string; // on-chain DRep id
  displayName: string | null;
  choice: string; // YES | NO | ABSTAIN | <poll option label>
  weight: number; // final voting power
  rationale: string | null;
  castAt: string; // when this vote was cast
  superseded: boolean; // true once the voter replaced it with a newer vote (kept as history)
}
export interface InternalProposalSpending {
  amountAda: number;
  destAddress: string | null;
  sourceBucketId: string | null;
  sourceBucketLabel: string | null;
  action: { id: string; status: string; txHash: string | null; paidAt: string | null } | null;
}
export interface InternalProposalDetail extends InternalProposalSummary {
  /** §10.5 — present for SPENDING proposals. */
  spending?: InternalProposalSpending | null;
  contentMd: string;
  submitterDrepId: string | null;
  actors: string[] | null;
  candidates: BoardCandidate[] | null; // §14 — set when isBoardElection
  deliveryDate: string | null;
  poll: { multiple: boolean; options: string[] } | null;
  votingStartAt: string | null;
  resultFinalizedAt: string | null;
  voters: InternalProposalVoter[]; // who voted how + their rationales
  anchorTxHash: string | null;
  anchorHash: string | null;
  /** Minimum rationale words required per choice (0 = not required). Internal proposals only. */
  rationaleMinWords: { YES: number; NO: number; ABSTAIN: number };
  /** The viewer's current (live) rationale, shown read-only in the locked vote card. */
  myRationale: string | null;
  /** §27 RULE_APPROVAL: the targeted rule document + the frozen content hash. */
  rule?: { documentId: string; title: string; documentStatus: string; deleteRequested: boolean; contentHash: string | null } | null;
}
export interface CreateInternalInput {
  /** §10.5 SPENDING: amount + destination (+ optional source bucket). */
  spendingAmountAda?: number;
  spendingSourceBucketId?: string;
  spendingDestAddress?: string;
  title: string;
  contentMd: string;
  internalType: string;
  votersScope: string;
  thresholdKind: string;
  votingType: string;
  votingEndAt?: string;
  votingPeriodDays?: number;
  isPrivate?: boolean;
  pollOptions?: string[];
  pollMultiple?: boolean;
  actors?: string[];
  deliveryDate?: string;
  // §14 board-member election: when true, candidates (5 admitted-DRep UUIDs) become the new
  // board on approval + deliveryDate. Voters scope / voting type / threshold are forced by
  // the server (BOTH / BALANCED / IMPORTANT).
  isBoardElection?: boolean;
  candidates?: string[];
  /** §27 RULE_APPROVAL: the published rule document to vote on; ruleDeleteRequested → a delete vote. */
  ruleDocumentId?: string;
  ruleDeleteRequested?: boolean;
  /** When submitting from a saved draft, the draft to remove once the live proposal is created. */
  draftId?: string;
}
/** §10 — a draft is the same shape as a create, but every field is optional (work-in-progress). */
export type DraftInput = Partial<CreateInternalInput>;
export interface VoteInternalInput {
  choice?: 'YES' | 'NO' | 'ABSTAIN';
  options?: string[];
  rationale?: string;
}
export const internalProposalsApi = {
  list: () => request<InternalProposalSummary[]>('/internal-proposals'),
  pendingCount: () => request<{ count: number }>('/internal-proposals/pending-count'),
  get: (id: string) => request<InternalProposalDetail>(`/internal-proposals/${id}`),
  submit: (input: CreateInternalInput) =>
    request<InternalProposalDetail>('/internal-proposals', { method: 'POST', body: JSON.stringify(input) }),
  saveDraft: (input: DraftInput) =>
    request<InternalProposalDetail>('/internal-proposals/drafts', { method: 'POST', body: JSON.stringify(input) }),
  updateDraft: (id: string, input: DraftInput) =>
    request<InternalProposalDetail>(`/internal-proposals/drafts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteDraft: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/internal-proposals/drafts/${id}`, { method: 'DELETE' }),
  vote: (id: string, input: VoteInternalInput) =>
    request<InternalProposalDetail>(`/internal-proposals/${id}/vote`, { method: 'POST', body: JSON.stringify(input) }),
  installBoard: (id: string) =>
    request<{ id: string; publicId: string | null; boardInstalledAt: string | null }>(
      `/internal-proposals/${id}/install-board`,
      { method: 'POST' },
    ),
};

// §13 — merit points + avoid-period ("vacancy") signalling.
export interface MeritInfo {
  points: number;
  ledger: { delta: number; reason: string; at: string }[];
}
export interface AvoidPeriod {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}
// §12 — reward calculation + distribution (board only).
export interface RewardEntryView {
  id: string;
  recipient: { type: 'DRep' | 'Expert'; name: string; address: string | null };
  units: number | null;
  power: number | null; // §12.5 — final voting power used in the D&V bonus weighting (null otherwise)
  amountAda: number;
  computedAda: number;
  overridden: boolean;
  paid: boolean;
  paidInTx: string | null;
}
export interface RewardCalcView {
  id: string;
  roundId: string | null;
  kind: string;
  periodKey: string | null;
  poolAda: number;
  payable: boolean;
  pending: number; // recipients owed + ready to pay (unpaid, unlinked, with a reward address)
  payout: { actionId: string; status: string; txHash: string | null; paidAt: string | null } | null;
  computedAt: string;
  entries: RewardEntryView[];
}
export interface ExpertRewardRow {
  expertId: string;
  name: string;
  filteringAda: number;
  dvAda: number;
  milestoneAda: number;
  milestoneLikeDrep: boolean;
}
export interface RewardSourceBucket {
  id: string;
  label: string;
  bech32Address: string;
  isPrimary: boolean;
  isDefaultRewards: boolean;
  isDefaultSubmissionFees: boolean;
  balanceAda: number;
}
export const rewardsApi = {
  overview: (roundId: string) => request<RewardCalcView[]>(`/admin/rewards/round/${roundId}`),
  // §12 — buckets a payout can be sourced from (default picked by stage; board may override).
  sourceBuckets: () => request<{ buckets: RewardSourceBucket[] }>('/dao/treasury/buckets'),
  computeFiltering: (roundId: string) => request<RewardCalcView>(`/admin/rewards/round/${roundId}/compute/filtering`, { method: 'POST' }),
  computeDv: (roundId: string) => request<{ fixed: RewardCalcView; bonus: RewardCalcView }>(`/admin/rewards/round/${roundId}/compute/dv`, { method: 'POST' }),
  computeMilestone: (roundId: string) => request<RewardCalcView>(`/admin/rewards/round/${roundId}/compute/milestone`, { method: 'POST' }),
  computeBoardMonthly: () => request<RewardCalcView>('/admin/rewards/board-monthly/compute', { method: 'POST', body: JSON.stringify({}) }),
  computeBoardMonths: (months: number) => request<RewardCalcView[]>('/admin/rewards/board-monthly/months', { method: 'POST', body: JSON.stringify({ months }) }),
  boardMonths: () => request<RewardCalcView[]>('/admin/rewards/board-monthly'),
  resetBoardMonths: () => request<RewardCalcView[]>('/admin/rewards/board-monthly/reset', { method: 'POST', body: JSON.stringify({}) }),
  setOverride: (entryId: string, ada: number | null) => request<{ ok: boolean }>(`/admin/rewards/entry/${entryId}`, { method: 'PATCH', body: JSON.stringify({ ada }) }),
  preparePayout: (calcId: string, sourceBucketId?: string) => request<{ actionId: string; recipients: number; totalAda: number; skipped: number }>(`/admin/rewards/calc/${calcId}/prepare-payout`, { method: 'POST', body: JSON.stringify({ sourceBucketId }) }),
  listExpertRewards: (roundId: string) => request<ExpertRewardRow[]>(`/admin/rewards/round/${roundId}/experts`),
  setExpertReward: (roundId: string, expertId: string, dto: Partial<Omit<ExpertRewardRow, 'expertId' | 'name'>>) =>
    request<{ ok: boolean }>(`/admin/rewards/round/${roundId}/expert/${expertId}`, { method: 'PUT', body: JSON.stringify(dto) }),
  getBoardYearly: () => request<{ yearlyAda: number }>('/admin/rewards/board-yearly'),
  setBoardYearly: (ada: number) => request<{ ok: boolean }>('/admin/rewards/board-yearly', { method: 'PUT', body: JSON.stringify({ ada }) }),
};

export const meritApi = {
  me: () => request<MeritInfo>('/me/merit'),
  avoidPeriods: () => request<AvoidPeriod[]>('/me/avoid-periods'),
  setAvoid: (startsAt: string, endsAt: string, reason?: string) =>
    request<AvoidPeriod>('/me/avoid-period', { method: 'POST', body: JSON.stringify({ startsAt, endsAt, reason }) }),
  removeAvoid: (id: string) => request<{ ok: boolean }>(`/me/avoid-period/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runSweep: () => request<{ ok: boolean }>('/admin/merit/sweep', { method: 'POST' }),
};

// §20.3 — in-app notification feed (written by the §27 background jobs).
export interface AppNotification {
  id: string;
  kind: string;
  payload: { refId?: string; title?: string; body?: string; proposalId?: string; roundId?: string } & Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
export const notificationsApi = {
  list: () => request<AppNotification[]>('/me/notifications'),
  unreadCount: () => request<{ count: number }>('/me/notifications/unread-count'),
  markRead: (id: string) => request<{ ok: boolean }>(`/me/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<{ ok: boolean }>('/me/notifications/read-all', { method: 'POST' }),
};

// §9.2 — quick polls (tie-break at the budget cliff).
export interface QuickPollView {
  id: string;
  categoryName: string | null;
  status: 'PENDING_BOARD' | 'ACTIVE' | 'RESOLVED' | 'FAILED';
  startsAt: string | null;
  endsAt: string | null;
  extensions: number;
  winnerId: string | null;
  eligibleCount: number;
  votedCount: number;
  iAmEligible: boolean;
  remainingAda: number; // category budget still unallocated — what the tied candidates compete for
  myRanking: string[] | null; // the caller's priority order (candidate ids), if they voted
  // Candidates in aggregate priority order, with the live projection (would-fund / tie at the cliff).
  candidates: { id: string; title: string; publicId: string | null; requestedAmountAda: number; score: number; projectedFunded: boolean; projectedTie: boolean }[];
}
export const quickPollApi = {
  forRound: (roundId: string) => request<QuickPollView[]>(`/rounds/${roundId}/quick-polls`),
  launch: (id: string) => request<QuickPollView>(`/admin/quick-polls/${id}/launch`, { method: 'POST' }),
  // §9.2 — board closes a poll early (end of Tally): finalises with the votes cast so far.
  resolve: (id: string) => request<{ status: string }>(`/admin/quick-polls/${id}/resolve`, { method: 'POST' }),
  // §9.2 — submit a full priority ranking of the candidates (highest first).
  vote: (id: string, ranking: string[]) => request<QuickPollView>(`/quick-polls/${id}/vote`, { method: 'POST', body: JSON.stringify({ ranking }) }),
  myPending: () => request<{ count: number }>('/me/pending-quick-polls'),
};

// §11.5 — board one-time milestone deadline extension; §16.4 — pledge grace extension.
export const boardDeadlinesApi = {
  extendMilestone: (proposalId: string, milestoneId: string, days: number) =>
    request<MilestoneView[]>(`/admin/proposals/${proposalId}/milestones/${milestoneId}/extend`, { method: 'POST', body: JSON.stringify({ days }) }),
  extendPledgeGrace: (proposalId: string, days: number) =>
    request<ProposalDetail>(`/admin/proposals/${proposalId}/extend-pledge-grace`, { method: 'POST', body: JSON.stringify({ days }) }),
};

// §27 — Rule Documents.
export interface RuleDocVote {
  proposalId: string;
  publicId: string | null;
  status: string; // ACTIVE (voting) | APPROVED | REJECTED
  deleteVote: boolean;
  votingEndAt: string | null;
  eligible: number;
  voted: number;
  ratioPct: number;
  thresholdPct: number;
  approved: boolean;
  contentHash: string | null;
  anchorTxHash: string | null;
}
export interface RuleDocSummary {
  id: string;
  title: string;
  status: string; // PRIVATE | DRAFT | ACTIVE | DELETED
  ownerName: string;
  publishedAt: string | null;
  updatedAt: string;
  approvedAt: string | null; // when it was approved into effect (ACTIVE docs); null otherwise
  lastVote: RuleDocVote | null;
  editable?: boolean; // present in `mine`
  deletable?: boolean; // present in `mine` — owner may delete before it is put to a vote
}
export interface RuleDocComment {
  id: string;
  authorName: string;
  authorRole: string | null;
  isMine: boolean;
  contentMd: string | null; // null when the comment is a tombstone (deleted)
  deleted: boolean;
  createdAt: string;
  replies?: RuleDocComment[]; // present on top-level comments (one level of threading)
}
export interface RuleDocDetail extends RuleDocSummary {
  contentMd: string;
  contentHash: string; // sha256(content), computed live — verify against this
  isOwner: boolean;
  editable: boolean;
  canPropose: boolean;
  canComment: boolean;
  canModerate: boolean; // viewer is a board member → may delete any comment
  comments: RuleDocComment[];
}
export const ruleDocumentsApi = {
  list: (filter?: string) => request<RuleDocSummary[]>(`/rule-documents${filter ? `?filter=${filter}` : ''}`),
  mine: () => request<RuleDocSummary[]>('/rule-documents/mine'),
  get: (id: string) => request<RuleDocDetail>(`/rule-documents/${id}`),
  create: (input: { title: string; contentMd: string }) =>
    request<RuleDocDetail>('/rule-documents', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: { title?: string; contentMd?: string }) =>
    request<RuleDocDetail>(`/rule-documents/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  publish: (id: string) => request<RuleDocDetail>(`/rule-documents/${id}/publish`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: boolean }>(`/rule-documents/${id}`, { method: 'DELETE' }),
  comment: (id: string, contentMd: string, parentId?: string) =>
    request<RuleDocDetail>(`/rule-documents/${id}/comments`, { method: 'POST', body: JSON.stringify({ contentMd, ...(parentId ? { parentId } : {}) }) }),
  deleteComment: (commentId: string) =>
    request<{ ok: boolean }>(`/rule-documents/comments/${commentId}`, { method: 'DELETE' }),
};

// §5.3 — board-configurable expertise subcategories.
export interface Subcategory { id: string; label: string; active?: boolean }
export const subcategoriesApi = {
  list: () => request<Subcategory[]>('/subcategories'),
  listAll: () => request<Subcategory[]>('/subcategories/all'),
  create: (label: string) => request<Subcategory[]>('/subcategories', { method: 'POST', body: JSON.stringify({ label }) }),
  setActive: (id: string, active: boolean) => request<Subcategory[]>(`/subcategories/${id}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  remove: (id: string) => request<Subcategory[]>(`/subcategories/${id}`, { method: 'DELETE' }),
};

// §26 — pre-maintenance warning: is an update about to start (set ~60s ahead by the deploy-guard)?
export const maintenanceApi = {
  status: () => request<{ pending: boolean; secondsLeft: number }>('/maintenance/status'),
};
