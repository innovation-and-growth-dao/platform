'use client';

import { useCallback, useEffect, useState } from 'react';
import { treasuryApi, matchesProposalSearch, type BoardAction } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';
import { ConfirmDialog } from './confirm-dialog';
import { notifyTreasuryChanged } from '@/lib/treasury-refresh';
import { notifyTodoChanged } from '@/lib/use-todo-counts';
import { useT } from '@/lib/prefs-context';

/** Human label for a prepared action. Only milestone payouts (PROJECT_FUNDING) carry the
 *  "Milestone #N payout" prefix; an internal-proposal spend (OPS with a proposal title) is
 *  labelled "INTERNAL PROPOSAL" so it isn't confused with funding-round milestones. */
function actionLabel(a: BoardAction): string {
  if (a.kind === 'PROJECT_FUNDING') return `Milestone #${(a.milestoneIdx ?? 0) + 1} payout — ${a.proposalTitle ?? ''}`;
  if (a.kind === 'OPS' && a.proposalTitle) return `INTERNAL PROPOSAL — ${a.proposalTitle}`;
  return a.proposalTitle ?? a.description ?? a.kind;
}

/** §15.3 — pending board/treasury actions the platform prepared, awaiting 3-of-5 approval.
 *  `refreshKey` is a parent-controlled counter — bumping it triggers an
 *  immediate refetch so newly-queued actions (top-ups, sweeps, transfers)
 *  appear without a page reload. */
export function BoardActions({ onChange, history = false, refreshKey = 0, filter = 'all', query }: { onChange?: () => void; history?: boolean; refreshKey?: number; filter?: 'all' | 'rewards' | 'non-rewards'; query?: string }) {
  const t = useT();
  const { profile, signTx, signMessage } = useAuth();
  const { txUrl } = useExplorer();
  const [actions, setActions] = useState<BoardAction[]>([]);
  const [past, setPast] = useState<BoardAction[]>([]);
  const [treasury, setTreasury] = useState<{ address: string | null; balanceAda: number } | null>(null);
  // §15/§20 — TX_SIGNING_PROCESS. 1_PHASE (default): one Sign click per member (Eternl);
  // 2_PHASE (backup): Authorize → Sign ceremony. Server-decided; default to the stricter
  // 2-phase until the first load answers.
  const [mode, setMode] = useState<'1_PHASE' | '2_PHASE'>('2_PHASE');
  const [busy, setBusy] = useState<string | null>(null);
  // §15.3 — per-action error map so the message appears next to the button
  // the user clicked (the previous single-error state lived at the section
  // top, easy to miss when there are several actions and you've scrolled).
  const [errors, setErrors] = useState<Record<string, string>>({});
  // §15 — transient "tx submitted" banner shown to the LAST signer right after the broadcast,
  // while the just-signed action drops into history. Component-local, so it's gone on remount.
  const [submitted, setSubmitted] = useState<string | null>(null);
  // §15.4 — Cancel-action confirm-dialog state. `cancelTarget` is the action
  // being cancelled; `cancelReason` is the required short audit note.
  const [cancelTarget, setCancelTarget] = useState<BoardAction | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(() => {
    treasuryApi
      .boardActions(history)
      .then((r) => {
        // §12 — reward payouts are reviewed/signed under Actions; everything else under Treasury.
        const keep = (xs: BoardAction[]) =>
          filter === 'rewards' ? xs.filter((a) => a.kind === 'REWARD_PAYOUT')
            : filter === 'non-rewards' ? xs.filter((a) => a.kind !== 'REWARD_PAYOUT')
              : xs;
        setActions(keep(r.actions)); setPast(keep(r.history ?? [])); setTreasury(r.treasury);
        setMode(r.signingMode === '1_PHASE' ? '1_PHASE' : '2_PHASE');
      })
      // A transient hiccup (poll timeout / 500) must NOT blank the list — keep the last-known
      // actions so a pending payout doesn't flicker in and out. Real removals arrive via .then.
      .catch(() => { /* keep previous state */ });
  }, [history, filter]);
  // Load on mount + poll so a freshly-prepared action (or one that failed to load
  // on a transient hiccup) appears without a manual page refresh.
  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);
  // Refetch whenever the parent bumps refreshKey (e.g. SendFromTreasuryPanel
  // just queued a transfer). Without this the row only appears on F5.
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey, load]);

  const setErr = (id: string, msg: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });
  /** §15 phase 1 (2-phase backup) — Authorize: board member CIP-30 data-signs a cheap commit
   *  message so the platform knows they're committing to be one of the 3 signers. Once 3 commits
   *  are in, the action moves to phase 2 and those same 3 sign the real tx body with their HW wallets. */
  const COMMIT_MSG = (actionId: string, stake: string, ts: string) =>
    ['drep-dao | multisig commit', `action:${actionId}`, `signer:${stake}`, `ts:${ts}`].join('\n');

  const authorize = async (a: BoardAction) => {
    setErr(a.id, null); setBusy(a.id);
    try {
      if (!profile) { setErr(a.id, t('Connect your wallet to authorize.')); return; }
      const ts = new Date().toISOString();
      const msg = COMMIT_MSG(a.id, profile.user.stakeAddress, ts);
      const s = await signMessage(msg);
      if (!s) {
        setErr(a.id, t('Could not reach your wallet. Open the wallet extension and try again.'));
        return;
      }
      await treasuryApi.commitToAction(a.id, { signature: s.signature, key: s.key, ts });
      load();
      onChange?.();
      notifyTodoChanged();
    } catch (e) {
      setErr(a.id, e instanceof Error ? e.message : t('Authorization cancelled.'));
    } finally {
      setBusy(null);
    }
  };

  /** §15 — Sign: in 1-phase any board member signs the prepared tx directly; in the 2-phase backup
   *  only the 3 who authorized may sign (their keyhashes are baked into required_signers). The
   *  platform broadcasts on the Mth (3-of-5) witness. */
  const approve = async (a: BoardAction) => {
    setErr(a.id, null);
    setBusy(a.id);
    try {
      if (!profile) {
        setErr(a.id, t('Connect your wallet to sign this action.'));
        return;
      }
      const { txBodyHex } = await treasuryApi.txBody(a.id);
      const witnessHex = await signTx(txBodyHex);
      if (!witnessHex) {
        setErr(a.id, t('Could not reach the wallet you logged in with. Open the wallet extension (or re-connect from the login card on the right) and click Sign again.'));
        return;
      }
      const r = await treasuryApi.submitWitness(a.id, witnessHex);
      if (r.status === 'CONFIRMED' && r.txHash) {
        setErr(a.id, null);
        setSubmitted(r.txHash); // last signature → broadcast; show the transient submitted banner
        // Tell the treasury views (overview balances, transactions) to reload
        // now + re-check while db-sync indexes the new tx — no F5 needed.
        notifyTreasuryChanged();
      }
      load();
      onChange?.();
      notifyTodoChanged();
    } catch (e) {
      setErr(a.id, e instanceof Error ? e.message : t('Sign cancelled — nothing was recorded.'));
    } finally {
      setBusy(null);
    }
  };

  // Search filters by proposal title (PROJECT_FUNDING), the action description (OPS / top-ups),
  // and recipient names (reward payouts) — board actions carry no public id / single proposer.
  const matchAction = (a: BoardAction) =>
    matchesProposalSearch(query, { title: a.proposalTitle, extra: [a.description, ...a.recipients.map((r) => r.name)] });
  const shownActions = actions.filter(matchAction);
  const shownPast = past.filter(matchAction);

  // Keep rendering while a transient "submitted" banner is up, even if the signed action has
  // already dropped into history (so the last signer still sees the confirmation).
  if (shownActions.length === 0 && shownPast.length === 0 && !submitted) return null;

  return (
    <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      {submitted ? (
        <div className="flex items-center justify-between gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          <span>✓ {t('Transaction submitted on-chain —')} <a href={txUrl(submitted)} target="_blank" rel="noreferrer" className="underline">{submitted.slice(0, 12)}…</a>. {t('The signed action has moved to history.')}</span>
          <button onClick={() => setSubmitted(null)} className="shrink-0 font-medium hover:underline">{t('Dismiss')}</button>
        </div>
      ) : null}
      <h3 className="text-base font-semibold">{t('Actions to sign')}</h3>
      {mode === '1_PHASE' ? (
        <p className="text-xs text-neutral-500">
          {t('The platform prepared these treasury/hot-wallet actions.')} <strong>{t('1-Phase signing')}</strong> {t('is enabled (the default — requires the')} <strong>Eternl</strong> {t('wallet): each board member signs the transaction once — the platform broadcasts as soon as the first')} {actions[0]?.threshold ?? past[0]?.threshold ?? 3} {t('signatures are in.')}
          {' '}{t('Threshold:')} {actions[0]?.threshold ?? past[0]?.threshold ?? 3}-of-
          {actions[0]?.totalKeys ?? past[0]?.totalKeys ?? '?'}.
        </p>
      ) : (
        <p className="text-xs text-neutral-500">
          {t('The platform prepared these treasury/hot-wallet actions.')} <strong>{t('2-Phase signing')}</strong> {t('(the backup mode) is enabled — each one runs a two-phase ceremony:')}{' '}
          <strong>{t('Authorize')}</strong> {t('(cheap CIP-30 data-sig — once')} {actions[0]?.threshold ?? past[0]?.threshold ?? 3} {t('board members authorize, the platform picks them as signers) →')} <strong>{t('Sign')}</strong> {t('(those same')}{' '}
          {actions[0]?.threshold ?? past[0]?.threshold ?? 3} {t('sign the real tx with their HW wallets and the platform broadcasts on the 3rd witness).')} {t('Threshold:')} {actions[0]?.threshold ?? past[0]?.threshold ?? 3}-of-
          {actions[0]?.totalKeys ?? past[0]?.totalKeys ?? '?'}.
        </p>
      )}
      {/* §15 — treasury source-of-truth: address + live on-chain balance, so the
          board can see at a glance whether pending payouts can be covered. */}
      {treasury ? (
        <div className="rounded border border-neutral-200 bg-white p-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          <div className="font-semibold text-neutral-700 dark:text-neutral-300">
            {t('Treasury balance:')} <span className="tabular-nums">{treasury.balanceAda.toLocaleString()} ₳</span>
          </div>
          {treasury.address ? (
            <div className="mt-0.5 flex items-start gap-2">
              <div className="flex-1 break-all font-mono text-[11px] text-neutral-500">{treasury.address}</div>
              <CopyButton text={treasury.address} label={t('Copy')} />
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-red-600">{t('No TREASURY_ADDRESS configured.')}</div>
          )}
        </div>
      ) : null}
      {shownActions.length === 0 ? <div className="text-xs text-neutral-500">{t('Nothing awaiting signatures.')}</div> : null}
      <ul className="space-y-2">
        {shownActions.map((a) => (
          <li key={a.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {actionLabel(a)}
              </span>
              <span className="flex items-center gap-3">
                {/* When several similar actions queue up, the timestamp tells them apart. */}
                <span className="text-xs text-neutral-400" title={t('When this action was prepared')}>{t('prepared')} {new Date(a.createdAt).toLocaleString()}</span>
                {a.amountAda != null ? <span className="tabular-nums text-neutral-500">{a.amountAda.toLocaleString()} ₳</span> : null}
              </span>
            </div>
            {/* Full destination address (no truncation) + copy button. Label
                changes by action kind so it reads naturally:
                  • PROJECT_FUNDING → "Send to (team payout address)"
                  • OPS top-up      → "Send to (anchor hot wallet)"
                  • REWARD_PAYOUT   → "Send to (DRep reward address)"
                  • anything else   → "Send to (destination)" */}
            {a.destAddress ? (
              <div className="mt-1">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {a.kind === 'PROJECT_FUNDING' ? t('Send to (team payout address)')
                    : a.kind === 'OPS' ? t('Send to (anchor hot wallet)')
                    : a.kind === 'REWARD_PAYOUT' ? t('Send to (DRep reward address)')
                    : t('Send to (destination)')}
                </div>
                <div className="mt-0.5 flex items-start gap-2">
                  <div className="flex-1 break-all font-mono text-[11px] text-neutral-600 dark:text-neutral-400">{a.destAddress}</div>
                  <CopyButton text={a.destAddress} label={t('Copy')} />
                </div>
              </div>
            ) : null}
            {/* §12 — a reward payout pays many recipients in one tx; show the full list. */}
            {a.recipients.length > 0 ? (
              <div className="mt-1.5 rounded border border-neutral-200 p-2 dark:border-neutral-800">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t('Recipients')} ({a.recipients.length})</div>
                <ul className="space-y-0.5 text-xs">
                  {a.recipients.map((r, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{r.name}</span>
                      <span className="tabular-nums text-neutral-500">{r.ada.toLocaleString()} ₳</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {/* Insufficient-funds warning — server-computed against live balance. */}
            {a.insufficient && a.amountAda != null && treasury ? (
              <div className="mt-1 rounded border border-red-300 bg-red-50 p-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                ⚠ {t('Treasury currently holds')} {treasury.balanceAda.toLocaleString()} ₳ — {t('not enough to cover this')} {a.amountAda.toLocaleString()} ₳ {t('payout. Approval at threshold will be blocked until the treasury is topped up.')}
              </div>
            ) : null}
            {/* §15 — 3-of-5 progress. 1-phase: any 3 board members sign the tx directly.
                2-phase backup: phase 1 collects 3 cheap CIP-30 authorizations; phase 2 collects 3
                real tx witnesses from the same 3 members chosen at phase-1 close (their keyhashes
                are baked into required_signers). */}
            <div className="mt-1 text-xs text-neutral-500">
              {mode === '1_PHASE' ? (
                <>
                  {t('Signatures:')} {a.approvals} {t('of')} {a.threshold} {t('needed')} ({a.threshold}-of-{a.totalKeys} {t('multisig — any')} {a.threshold} {t('board members')})
                  {a.mineApproved ? ' · ' + t('you signed') + ' ✓' : ''}
                </>
              ) : a.phase === 'AUTHORIZE' ? (
                <>
                  {t('Phase 1 — authorizations:')} {a.commitments} {t('of')} {a.threshold} {t('needed')} ({a.threshold}-of-{a.totalKeys} {t('multisig')})
                  {a.mineCommitted ? ' · ' + t('you authorized') + ' ✓' : ''}
                </>
              ) : (
                <>
                  {t('Phase 2 — tx signatures:')} {a.approvals} {t('of')} {a.threshold} {t('needed')} ({a.threshold}-of-{a.totalKeys} {t('multisig')})
                  {a.mineApproved ? ' · ' + t('you signed') + ' ✓' : ''}
                </>
              )}
            </div>
            {/* §15 — who authorized (2-phase: the chosen signers) and who has
                actually signed the tx, by name. 1-phase has no Authorize step. */}
            {mode === '1_PHASE' ? (
              a.signedBy.length > 0 ? (
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  {t('Signed:')} <span className="text-emerald-700 dark:text-emerald-400">{a.signedBy.join(', ')}</span>
                </div>
              ) : null
            ) : a.committedBy.length > 0 ? (
              <div className="mt-0.5 text-[11px] text-neutral-500">
                {a.phase === 'AUTHORIZE' ? t('Authorized by') : t('Authorized signers')}: <span className="text-neutral-700 dark:text-neutral-300">{a.committedBy.join(', ')}</span>
                {a.phase === 'SIGN' ? (
                  <> · {t('Signed:')} <span className="text-emerald-700 dark:text-emerald-400">{a.signedBy.length > 0 ? a.signedBy.join(', ') : '—'}</span></>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {a.phase === 'AUTHORIZE' ? (
                <button
                  disabled={busy === a.id || a.mineCommitted}
                  onClick={() => authorize(a)}
                  className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  title={`${t('Authorize signing — cheap CIP-30 data-signature. Once')} ${a.threshold} ${t('board members authorize, the platform builds the real tx and asks those')} ${a.threshold} ${t('to sign it with their HW wallets.')}`}
                >
                  {a.mineCommitted ? t('Authorized') : busy === a.id ? t('Authorizing…') : t('Authorize')}
                </button>
              ) : mode === '1_PHASE' || a.mineCommitted ? (
                <button
                  disabled={busy === a.id || a.mineApproved}
                  onClick={() => approve(a)}
                  className="rounded border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
                  title={mode === '1_PHASE'
                    ? `${t('Sign the prepared tx with your wallet (1-Phase signing requires Eternl). The platform broadcasts once')} ${a.threshold} ${t('board members have signed.')}`
                    : `${t('Sign the prepared tx with your HW wallet. Only the')} ${a.threshold} ${t('board members who authorized in phase 1 can sign.')}`}
                >
                  {a.mineApproved ? t('Signed') : busy === a.id ? t('Signing…') : mode === '1_PHASE' ? t('Sign tx') : t('Sign tx with HW wallet')}
                </button>
              ) : (
                /* §15 — only the phase-1 signers sign the tx; everyone else just waits. */
                <span className="text-xs text-neutral-500">
                  {t('Only the')} {a.threshold} {t('who authorized sign this tx — waiting for')}{' '}
                  {a.committedBy.filter((n) => !a.signedBy.includes(n)).join(', ') || t('them')}.
                </span>
              )}
              {/* §15.4 — any single board member can cancel a pending action.
                  Marks it FAILED with the cancellation reason in the audit
                  trail. Hidden once the tx is on-chain (BROADCASTED/CONFIRMED). */}
              {a.status === 'PENDING_SIGS' || a.status === 'READY' ? (
                <button
                  disabled={busy === a.id}
                  onClick={() => setCancelTarget(a)}
                  className="rounded border border-neutral-400 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {t('Cancel')}
                </button>
              ) : null}
            </div>
            {errors[a.id] ? (
              <div className="mt-1 rounded border border-red-300 bg-red-50 p-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {errors[a.id]}
              </div>
            ) : null}
            {/* §11/§15 — once the threshold is reached, the board broadcasts the
                assembled tx from their wallet and pastes the on-chain hash here.
                Backend verifies via Koios and flips the action to CONFIRMED. */}
            {(a.status === 'READY' || a.status === 'BROADCASTED') && a.destAddress ? (
              <PayoutTxVerify action={a} onChange={() => { load(); onChange?.(); }} />
            ) : null}
            {a.status === 'CONFIRMED' && a.txHash ? (
              <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-1.5 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                ✓ {t('PAID on-chain —')} <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="font-mono underline">{a.txHash} ↗</a>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {/* History: past actions (executed / no longer awaiting signatures), read-only. */}
      {shownPast.length > 0 ? (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('History')}</div>
          <ul className="mt-1 space-y-1">
            {shownPast.map((a) => (
              <li key={a.id} className="rounded border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{actionLabel(a)}</span>
                  <span className="text-xs text-neutral-400">{t('prepared')} {new Date(a.createdAt).toLocaleString()}</span>
                  <span className="flex items-center gap-2 text-neutral-500">
                    {a.amountAda != null ? <span className="tabular-nums">{a.amountAda.toLocaleString()} ₳</span> : null}
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{a.status === 'CONFIRMED' ? t('PAID') : a.status}</span>
                  </span>
                </div>
                {/* Consistent metadata on EVERY item: when · who signed · on-chain tx. */}
                <div className="mt-1 text-[11px] text-neutral-500">
                  {new Date(a.createdAt).toLocaleString()}
                  {a.signedBy.length > 0
                    ? <> · {t('Signed by')} <span className="text-neutral-700 dark:text-neutral-300">{a.signedBy.join(', ')}</span></>
                    : a.committedBy.length > 0
                      ? <> · {t('Authorized by')} {a.committedBy.join(', ')}</>
                      : null}
                </div>
                <div className="mt-0.5 break-all text-[11px]">
                  {a.txHash ? (
                    <span className="font-mono text-neutral-500">{t('tx')} <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" className="underline">{a.txHash} ↗</a></span>
                  ) : (
                    <span className="text-neutral-400">{a.status === 'FAILED' ? t('cancelled — no on-chain tx') : t('no on-chain tx recorded')}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* §15.4 — cancel-action confirm dialog. Reason is required (≥5 chars)
          and lands in the audit history alongside the cancelled action. */}
      <ConfirmDialog
        open={!!cancelTarget}
        title={t('Cancel this action?')}
        tone="danger"
        confirmLabel={t('Cancel action')}
        cancelLabel={t('Keep it')}
        onCancel={() => { setCancelTarget(null); setCancelReason(''); }}
        onConfirm={async () => {
          if (!cancelTarget) return;
          const reason = cancelReason.trim();
          if (reason.length < 5) return;
          const id = cancelTarget.id;
          setCancelTarget(null);
          setCancelReason('');
          setBusy(id);
          try {
            await treasuryApi.cancelAction(id, reason);
            load();
            onChange?.();
            notifyTodoChanged();
          } catch (e) {
            setErr(id, e instanceof Error ? e.message : t('cancel failed'));
          } finally {
            setBusy(null);
          }
        }}
        message={
          <div className="space-y-2">
            <p>
              {t('This will mark the action as')} <strong>{t('cancelled')}</strong> {t('and move it to history. Any signatures already collected are discarded. Once on-chain (broadcast), an action cannot be cancelled — only pending ones.')}
            </p>
            {cancelTarget ? (
              <p className="text-xs text-neutral-500">
                <strong>{actionLabel(cancelTarget)}</strong>
                {cancelTarget.amountAda != null ? <> · {cancelTarget.amountAda.toLocaleString()} ₳</> : null}
              </p>
            ) : null}
            <label className="block text-xs">
              {t('Reason (audit trail) — required, min 5 chars')}
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t('Why is this being cancelled?')}
                rows={2}
                className="mt-1 block w-full resize-y rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
              <span className={`text-[11px] ${cancelReason.trim().length >= 5 ? 'text-emerald-600' : 'text-neutral-500'}`}>
                {cancelReason.trim().length}/5 {t('min')}
              </span>
            </label>
          </div>
        }
      />
    </section>
  );
}

/** Tx-hash input + auto-verify against the destination address. Mirrors the
 *  pledge/fee verify pattern: 700 ms debounce on a valid 64-hex paste, then a
 *  10 s poll until Koios returns paid=true and the backend flips CONFIRMED. */
function PayoutTxVerify({ action, onChange }: { action: BoardAction; onChange: () => void }) {
  const t = useT();
  const [tx, setTx] = useState(action.txHash ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; paid?: boolean; found?: boolean; koiosAvailable?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmed = tx.trim().toLowerCase();
  const valid = /^[0-9a-f]{64}$/.test(trimmed);

  const submit = useCallback(async () => {
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const r = await treasuryApi.submitPayoutTx(action.id, trimmed);
      setResult(r);
      if (r.status === 'CONFIRMED') { onChange(); notifyTreasuryChanged(); notifyTodoChanged(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(false);
    }
  }, [action.id, trimmed, valid, onChange]);

  // 700 ms debounce on a fresh valid paste, then 10 s polling until confirmed.
  useEffect(() => {
    if (!valid || busy) return;
    if (result?.status === 'CONFIRMED') return;
    const delay = result ? 10_000 : 700;
    const t = setTimeout(() => { void submit(); }, delay);
    return () => clearTimeout(t);
  }, [valid, busy, result, submit]);

  return (
    <div className="mt-2 rounded border border-neutral-300 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900">
      <div className="font-semibold text-neutral-700 dark:text-neutral-300">{t('Broadcast tx hash')}</div>
      <div className="text-[11px] text-neutral-500">
        {t('After your wallet broadcasts the assembled multisig tx, paste the on-chain hash here. The platform verifies the payment and flips this action to PAID.')}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          value={tx}
          onChange={(e) => { setTx(e.target.value); setResult(null); }}
          placeholder={t('64-hex tx hash')}
          className="flex-1 rounded border border-neutral-300 px-2 py-1 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button disabled={busy || !valid} onClick={submit} className="rounded border border-emerald-500 px-2 py-0.5 text-emerald-700 disabled:opacity-40 dark:text-emerald-300">
          {busy ? '…' : t('Verify on-chain')}
        </button>
      </div>
      {error ? <div className="mt-1 text-red-600">{error}</div> : null}
      {result ? (
        result.status === 'CONFIRMED' ? (
          <div className="mt-1 text-emerald-700 dark:text-emerald-300">✓ {t('Verified on-chain — milestone marked PAID.')}</div>
        ) : !result.koiosAvailable ? (
          <div className="mt-1 text-amber-700 dark:text-amber-300">⚠ {t('Couldn\'t reach Koios. Re-checking every ~10 s.')}</div>
        ) : !result.found ? (
          <div className="mt-1 text-amber-700 dark:text-amber-300">{t('Tx not on-chain yet — re-checking every ~10 s.')}</div>
        ) : (
          <div className="mt-1 text-red-600">{t('Tx didn\'t pay the destination address.')}</div>
        )
      ) : null}
    </div>
  );
}
