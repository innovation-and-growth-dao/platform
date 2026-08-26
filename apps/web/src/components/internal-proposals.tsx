'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { card } from '@/lib/ui';
import {
  internalProposalsApi,
  ruleDocumentsApi,
  decisionsApi,
  daoApi,
  configApi,
  treasuryBucketsApi,
  matchesProposalSearch,
  type RuleDocSummary,
  type DecisionSummary,
  type TreasuryBucket,
  type InternalProposalSummary,
  type InternalProposalDetail,
  type CreateInternalInput,
  type DaoMember,
  type PublicConfig,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';
import { ShareLinkButton } from './share-link-button';
import { BackButton, StatusBadge, PROPOSAL_STATUS_CLS, fmtDateTime, toLocalInput, DateField, RationaleText, useNow, fmtCountdown } from './round-ui';
import { Markdown, MarkdownEditor } from './markdown';


const field = 'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

const TYPE_LABEL: Record<string, string> = {
  INSTRUCTIVE: 'Instructive (names actors to act)',
  INFORMATIVE: 'Informative (yes / no decision)',
  POLL: 'Poll (choose option(s))',
  SPENDING: 'Spending (treasury payment on approval)',
  RULE_APPROVAL: 'Approval of a rule document',
  DECISION_APPROVAL: 'Approval of a decision',
};
const SCOPE_LABEL: Record<string, string> = {
  DREPS_ONLY: 'Non-board DReps only',
  BOARD_ONLY: 'Board members only',
  BOTH: 'All DReps (board + others)',
};
const VTYPE_LABEL: Record<string, string> = {
  ONE_PERSON_ONE_VOTE: '1 member = 1 vote',
  BALANCED: 'Adjusted voting power',
  ONCHAIN: 'On-chain (unadjusted) voting power',
};
// Choice → badge colour: YES green, NO red, ABSTAIN yellow; any poll option label falls back to blue.
const CHOICE_BADGE_CLS: Record<string, string> = {
  YES: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  NO: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  ABSTAIN: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};
const choiceBadgeCls = (choice: string) =>
  CHOICE_BADGE_CLS[choice] ?? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300';

/** §10 — Internal proposals: a unified queue, a submit form, and per-proposal voting. */
const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
] as const;
const LIST_PAGE_SIZE = 50;

export function InternalProposals() {
  const tr = useT();
  const { profile } = useAuth();
  // §10 — only admitted DReps (DAO members + board) may submit internal proposals. Mirrors the
  // server-side guard in InternalProposalsService.create/saveDraft (drep.status === ADMITTED);
  // hiding the button keeps viewers / registered-but-unadmitted DReps from hitting a 403.
  const canSubmit = !!profile && (profile.roles.includes('DAO_MEMBER') || profile.roles.includes('BOARD'));
  const [items, setItems] = useState<InternalProposalSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  // §10 — editing a saved draft (its id) vs creating a fresh proposal (null).
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  // §10 — status filter (default All), ID/title search, 50-per-page pager.
  const [statusTab, setStatusTab] = useState<'' | 'ACTIVE' | 'APPROVED' | 'REJECTED' | 'DRAFT'>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // §14 — sub-menu splits the regular DAO-governance proposals from board-member elections.
  const [subTab, setSubTab] = useState<'regular' | 'election'>('regular');
  const [error, setError] = useState<string | null>(null);
  // The opened proposal lives in the URL (?ip=<id>) so clicking the My-area "Internal proposals"
  // tab button (which clears `ip`) takes the user back to the list.
  const { get, setParams } = useUrlNav();
  const openId = get('ip');
  // §27 — deep-link from a rule document's "Start a vote" button: open the new-proposal form
  // pre-set to a rule-approval vote on that document.
  const newRule = get('newRule');
  useEffect(() => { if (newRule) setCreating(true); }, [newRule]);
  const newDecision = get('newDecision');
  useEffect(() => { if (newDecision) setCreating(true); }, [newDecision]);

  const load = useCallback(() => {
    internalProposalsApi.list().then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, []);
  useEffect(load, [load]);

  // If the Draft tab is selected but no drafts remain in this sub-tab (e.g. the last one was
  // submitted/deleted), the tab disappears — fall back to All so the list isn't stuck empty.
  useEffect(() => {
    if (statusTab !== 'DRAFT' || !items) return;
    const stillHasDrafts = items.some((p) => p.status === 'DRAFT' && (subTab === 'election' ? p.isBoardElection : !p.isBoardElection));
    if (!stillHasDrafts) setStatusTab('');
  }, [items, statusTab, subTab]);

  if (openId) {
    return <InternalDetail id={openId} onBack={() => { setParams({ ip: null }); load(); }} />;
  }

  const isElection = subTab === 'election';
  const closeEditor = () => { setCreating(false); setEditingDraftId(null); if (newRule) setParams({ newRule: null }); if (newDecision) setParams({ newDecision: null }); };
  // Dedicated full-page editor: clicking "New …" or a draft row shows only the form. Submitting
  // or cancelling returns to the default list + filter view.
  if (creating) {
    return (
      <div className="space-y-3">
        <button onClick={closeEditor} className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">← {tr('back to internal proposals')}</button>
        <section className={card}>
          <SubmitInternalForm
            election={isElection}
            draftId={editingDraftId}
            preselectRuleDoc={newRule}
            preselectDecision={newDecision}
            onCancel={closeEditor}
            onDone={() => { closeEditor(); load(); }}
          />
        </section>
      </div>
    );
  }

  const all = items ?? [];
  // Sub-tab filter (regular vs election) → status tab → ID/title/proposer search → pager.
  // Drafts are the viewer's own work-in-progress: they show ONLY under the Draft tab, never in
  // All/Active/Approved/Rejected. The Draft tab itself appears only when the viewer has a draft.
  const inTab = all.filter((p) => (isElection ? p.isBoardElection : !p.isBoardElection));
  const hasDrafts = inTab.some((p) => p.status === 'DRAFT');
  const statusTabs = hasDrafts ? [...STATUS_TABS, { key: 'DRAFT', label: 'Draft' } as const] : STATUS_TABS;
  const filtered = inTab
    .filter((p) => (statusTab === 'DRAFT' ? p.status === 'DRAFT' : statusTab ? p.status === statusTab : p.status !== 'DRAFT'))
    .filter((p) => matchesProposalSearch(search, { title: p.title, proposer: p.submitter, publicId: p.publicId }));
  const pages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);

  const subTabBtn = (key: 'regular' | 'election', label: string) => (
    <button
      onClick={() => { setSubTab(key); closeEditor(); setStatusTab(''); setPage(1); }}
      className={`rounded-md px-3 py-1.5 text-sm ${subTab === key ? 'bg-emerald-600 font-medium text-white' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* §14 — sub-menu inside the Internal proposals view. */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {subTabBtn('regular', tr('Internal proposals'))}
        {subTabBtn('election', tr('Board member election'))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{isElection ? tr('Board member election') : tr('Internal proposals')}</h2>
          <p className="text-sm text-neutral-500">
            {isElection
              ? tr('Propose a new 5-member board. Approval + the installation date trigger the platform to replace the board automatically.')
              : tr('DAO-governance decisions — process changes, parameter changes, polls. Not tied to a round; voting opens immediately.')}
          </p>
        </div>
        {canSubmit ? (
          <button onClick={() => { setEditingDraftId(null); setCreating(true); }} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
            {isElection ? tr('New election') : tr('New internal proposal')}
          </button>
        ) : (
          <span className="text-xs text-neutral-500">{tr('Only DReps can submit internal proposals.')}</span>
        )}
      </div>
      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {/* §10 — status filter (All shows decided history too) + ID/title search. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
          {statusTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setStatusTab(t.key as typeof statusTab); setPage(1); }}
              className={`px-2.5 py-1 text-xs font-medium ${
                statusTab === t.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
              }`}
            >
              {tr(t.label)}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder={tr('Search by proposal ID, title, or proposer…')}
          className="min-w-64 flex-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <span className="text-xs text-neutral-500">{filtered.length} {filtered.length === 1 ? tr('proposal') : tr('proposals')}</span>
      </div>

      {items === null ? (
        <p className="text-sm text-neutral-500">{tr('Loading…')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-neutral-500">{search.trim() || statusTab
          ? tr('No proposals match the filter.')
          : (isElection ? tr('No board-member elections yet.') : tr('No internal proposals yet.'))}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((p) => (
            <li key={p.id}>
              {/* A draft opens the editor to continue editing; a submitted proposal opens its detail. */}
              <button
                onClick={() => (p.status === 'DRAFT' ? (setEditingDraftId(p.id), setCreating(true)) : setParams({ ip: p.id }))}
                className={`${card} block w-full text-left hover:border-emerald-400`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.publicId ? <span className="mr-2 font-mono text-xs text-neutral-500">{p.publicId}</span> : null}
                    {p.title || <span className="italic text-neutral-400">{tr('(untitled draft)')}</span>}
                    {/* §10.5 — show the treasury payout amount for SPENDING proposals. */}
                    {p.internalType === 'SPENDING' && p.spendingAmountAda != null ? <span className="ml-1 font-semibold text-blue-600 dark:text-blue-400">· {p.spendingAmountAda.toLocaleString()} ₳</span> : null}
                    {p.isPrivate ? <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{tr('PRIVATE · board')}</span> : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <MyVoteBadge p={p} />
                    <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} />
                  </div>
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {tr(TYPE_LABEL[p.internalType] ?? p.internalType)} · {tr(SCOPE_LABEL[p.votersScope] ?? p.votersScope)} · {tr(VTYPE_LABEL[p.votingType] ?? p.votingType)}
                  {p.tally.kind === 'THRESHOLD' ? ` · ${tr('threshold')} ${p.thresholdPct ?? '?'}%` : ''}
                  {p.submitter ? ` · ${tr('by')} ${p.submitter}` : ''}
                  {p.status === 'ACTIVE' && p.votingEndAt ? ` · ${tr('ends')} ${fmtDateTime(p.votingEndAt)}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Pager — max 50 proposals per page. */}
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-1 text-xs">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            ← {tr('Previous')}
          </button>
          <span className="text-neutral-500">{tr('Page')} {safePage} {tr('of')} {pages}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={safePage >= pages}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {tr('Next')} →
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Right-side chip on each list row: how the current DRep voted (if at all). */
function MyVoteBadge({ p }: { p: InternalProposalSummary }) {
  const tr = useT();
  if (!p.myVotes || p.myVotes.length === 0) return null;
  const label = formatMyVote(p, tr);
  // Colour the chip by the choice (YES green, NO red, ABSTAIN yellow); a multi-option poll pick stays blue.
  const single = p.myVotes.length === 1 ? p.myVotes[0] : null;
  const cls = single ? choiceBadgeCls(single) : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      ✓ {label}
    </span>
  );
}

// YES/NO/Abstain are platform vote terms (translated); poll option labels are user content (kept as-is).
function formatMyVote(p: { internalType: string; myVotes: string[] }, tr: (k: string) => string): string {
  const v = p.myVotes;
  if (v.length === 1 && v[0] === 'ABSTAIN') return tr('you abstained');
  if (p.internalType === 'POLL') return `${tr('you chose')} ${v.join(', ')}`;
  return `${tr('you voted')} ${v[0] === 'ABSTAIN' ? tr('Abstain') : tr(v[0])}`;
}

function SubmitInternalForm({ onDone, onCancel, draftId = null, election = false, preselectRuleDoc = null, preselectDecision = null }: { onDone: () => void; onCancel: () => void; draftId?: string | null; election?: boolean; preselectRuleDoc?: string | null; preselectDecision?: string | null }) {
  const t = useT();
  const editingDraft = !!draftId;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [internalType, setInternalType] = useState(preselectRuleDoc ? 'RULE_APPROVAL' : preselectDecision ? 'DECISION_APPROVAL' : 'INFORMATIVE');
  // §27 — rule-document approval: the votable documents + the selection + delete-vote flag.
  const [ruleDocs, setRuleDocs] = useState<RuleDocSummary[]>([]);
  const [ruleDocumentId, setRuleDocumentId] = useState(preselectRuleDoc ?? '');
  const [ruleDeleteRequested, setRuleDeleteRequested] = useState(false);
  const [decisions, setDecisions] = useState<DecisionSummary[]>([]);
  const [decisionId, setDecisionId] = useState(preselectDecision ?? '');
  const [decisionDeleteRequested, setDecisionDeleteRequested] = useState(false);
  const [votersScope, setVotersScope] = useState('BOTH');
  const [thresholdKind, setThresholdKind] = useState('DEFAULT');
  const [votingType, setVotingType] = useState('BALANCED');
  const [votingEnd, setVotingEnd] = useState(() => {
    // Default to 7 days from now at midnight (local), so users only have to pick a date.
    const d = new Date(Date.now() + 7 * 86400_000);
    d.setHours(0, 0, 0, 0);
    return toLocalInput(d.toISOString());
  });
  const [isPrivate, setIsPrivate] = useState(false);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [actors, setActors] = useState<string[]>([]); // selected DRep display names
  const [candidates, setCandidates] = useState<string[]>([]); // §14 election: 5 DRep UUIDs
  const [installDate, setInstallDate] = useState(''); // §14 election: datetime-local
  const [deliveryDate, setDeliveryDate] = useState('');
  const [members, setMembers] = useState<DaoMember[]>([]);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  // §10.5 SPENDING: amount + source treasury bucket + destination.
  const [spendAmount, setSpendAmount] = useState('');
  const [spendBucket, setSpendBucket] = useState('');
  const [spendDest, setSpendDest] = useState('');
  const [buckets, setBuckets] = useState<TreasuryBucket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    daoApi.members().then(setMembers).catch(() => setMembers([]));
    configApi.get().then(setCfg).catch(() => setCfg(null));
    treasuryBucketsApi.list().then((r) => setBuckets(r.buckets)).catch(() => setBuckets([]));
  }, []);

  // Editing a saved draft → prefill every field from it.
  useEffect(() => {
    if (!draftId) return;
    internalProposalsApi.get(draftId).then((d) => {
      setTitle(d.title ?? '');
      setContent(d.contentMd ?? '');
      setInternalType(d.internalType ?? 'INFORMATIVE');
      setVotersScope(d.votersScope ?? 'BOTH');
      setThresholdKind(d.thresholdKind ?? 'DEFAULT');
      setVotingType(d.votingType ?? 'BALANCED');
      if (d.votingEndAt) setVotingEnd(toLocalInput(d.votingEndAt));
      setIsPrivate(!!d.isPrivate);
      if (d.poll) { setPollMultiple(d.poll.multiple); setPollOptions(d.poll.options.length ? d.poll.options : ['', '']); }
      if (d.actors?.length) setActors(d.actors);
      if (d.deliveryDate) setDeliveryDate(toLocalInput(d.deliveryDate));
      if (d.spending) {
        setSpendAmount(d.spending.amountAda ? String(d.spending.amountAda) : '');
        setSpendDest(d.spending.destAddress ?? '');
        setSpendBucket(d.spending.sourceBucketId ?? '');
      }
    }).catch((e) => setError(e instanceof Error ? e.message : 'failed to load draft'));
  }, [draftId]);

  const isPoll = internalType === 'POLL';
  const isInstructive = internalType === 'INSTRUCTIVE';
  const isSpending = internalType === 'SPENDING';
  const isRule = internalType === 'RULE_APPROVAL';
  // §27 — load the documents that can be voted on (published, not deleted) when the type is chosen.
  useEffect(() => {
    if (!isRule || ruleDocs.length) return;
    Promise.all([ruleDocumentsApi.list('draft'), ruleDocumentsApi.list('active')])
      .then(([a, b]) => setRuleDocs([...a, ...b]))
      .catch(() => undefined);
  }, [isRule, ruleDocs.length]);
  const isDecision = internalType === 'DECISION_APPROVAL';
  useEffect(() => {
    if (!isDecision || decisions.length) return;
    Promise.all([decisionsApi.list('draft'), decisionsApi.list('active')])
      .then(([a, b]) => setDecisions([...a, ...b]))
      .catch(() => undefined);
  }, [isDecision, decisions.length]);
  // Precise remaining duration from now to the chosen end (down to the minute), so a few-minute
  // window doesn't round up to "1 day".
  const msLeft = new Date(votingEnd).getTime() - Date.now();
  const votingDuration = (() => {
    const mins = Math.floor(msLeft / 60_000);
    if (mins < 1) return t('less than a minute');
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d} ${d === 1 ? t('day') : t('days')}`);
    if (h) parts.push(`${h} ${h === 1 ? t('hour') : t('hours')}`);
    if (m) parts.push(`${m} ${m === 1 ? t('minute') : t('minutes')}`);
    return parts.slice(0, 2).join(' ');
  })();
  const dThresh = cfg?.internalThresholds.default;
  const iThresh = cfg?.internalThresholds.important;

  // Shared form → payload mapping for regular (non-election) proposals; reused by submit + save-draft.
  const buildRegularInput = (): CreateInternalInput => {
    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    return {
      title: title.trim(),
      contentMd: content,
      internalType,
      votersScope: isPrivate ? 'BOARD_ONLY' : votersScope,
      thresholdKind,
      votingType,
      votingEndAt: votingEnd ? new Date(votingEnd).toISOString() : undefined,
      isPrivate,
      ...(isPoll ? { pollOptions: cleanOptions, pollMultiple } : {}),
      ...(isInstructive && actors.length ? { actors } : {}),
      ...(isInstructive && deliveryDate ? { deliveryDate: new Date(deliveryDate).toISOString() } : {}),
      ...(isSpending ? { spendingAmountAda: Number(spendAmount) || 0, spendingDestAddress: spendDest.trim(), ...(spendBucket ? { spendingSourceBucketId: spendBucket } : {}) } : {}),
      ...(isRule ? { ruleDocumentId, ruleDeleteRequested } : {}),
      ...(isDecision ? { decisionId, decisionDeleteRequested } : {}),
    };
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const end = new Date(votingEnd);
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) { setError(t('Pick a voting-end date in the future.')); return; }

    if (election) {
      if (candidates.length !== 5) { setError(t('Pick exactly 5 candidates.')); return; }
      const install = new Date(installDate);
      if (Number.isNaN(install.getTime()) || install.getTime() <= end.getTime()) {
        setError(t('The installation date must be later than the voting end.')); return;
      }
      const input: CreateInternalInput = {
        title: title.trim(),
        contentMd: content,
        internalType: 'INSTRUCTIVE',
        // Server forces these for elections — pass safe defaults anyway.
        votersScope: 'BOTH',
        thresholdKind: 'IMPORTANT',
        votingType: 'BALANCED',
        votingEndAt: end.toISOString(),
        isBoardElection: true,
        candidates,
        deliveryDate: install.toISOString(),
      };
      setBusy(true);
      try { await internalProposalsApi.submit(input); onDone(); }
      catch (err) { setError(err instanceof Error ? err.message : 'failed'); }
      finally { setBusy(false); }
      return;
    }

    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (isPoll && cleanOptions.length < 2) { setError(t('A poll needs at least two options.')); return; }
    // Submitting from a draft passes its id so the server removes the draft once the live proposal exists.
    const input: CreateInternalInput = { ...buildRegularInput(), votingEndAt: end.toISOString(), ...(draftId ? { draftId } : {}) };
    setBusy(true);
    try {
      await internalProposalsApi.submit(input);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  // §10 — save the current form as a draft (create or update). Lenient: only a title is required.
  const saveDraft = async () => {
    setError(null);
    if (!title.trim()) { setError(t('Add a title before saving a draft.')); return; }
    setBusy(true);
    try {
      const input = buildRegularInput();
      if (draftId) await internalProposalsApi.updateDraft(draftId, input);
      else await internalProposalsApi.saveDraft(input);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = async () => {
    if (!draftId) return;
    setError(null);
    setBusy(true);
    try { await internalProposalsApi.deleteDraft(draftId); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'failed'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className="text-base font-semibold">{editingDraft ? t('Edit draft') : election ? t('New board-member election') : t('New internal proposal')}</h3>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t('Title')}</span>
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>

      {/* Content is always present, even for polls. */}
      <MarkdownEditor value={content} onChange={setContent} title={t('Content')} placeholder={t('Describe the proposal (markdown)')} minRows={5} required />

      <div className="grid gap-3 sm:grid-cols-2">
        {election ? (
          // §14 — for an election the type is fixed (an INSTRUCTIVE proposal); show it as info.
          <div className="space-y-1">
            <span className="text-sm font-medium">{t('Type')}</span>
            <div className={`${field} bg-neutral-50 text-neutral-600 dark:bg-neutral-950 dark:text-neutral-400`}>{t('Instructive — board-member election')}</div>
          </div>
        ) : (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('Type')}</span>
            <select className={field} value={internalType} onChange={(e) => setInternalType(e.target.value)}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('Voting ends')}</span>
          <DateField value={votingEnd} onChange={setVotingEnd} min={toLocalInput(new Date().toISOString())} required />
          <span className="text-xs text-neutral-500">{msLeft > 0 ? `${t('voting will run for')} ${votingDuration}` : t('pick a future date')}</span>
        </label>
      </div>

      {!election && isSpending ? (
            <div className="space-y-2 rounded border border-emerald-200 p-2 dark:border-emerald-900">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('§10.5 — if approved, the platform prepares a treasury multisig transaction the board signs.')}</div>
              <label className="block text-sm">
                {t('Amount (₳)')} <span className="text-red-500">*</span>
                <input className={field} value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} placeholder="100" />
              </label>
              <label className="block text-sm">
                {t('From treasury address')}
                <select className={field} value={spendBucket} onChange={(e) => setSpendBucket(e.target.value)}>
                  <option value="">{t('Operations (default)')}</option>
                  {buckets.map((b) => (
                    <option key={b.id} value={b.id}>{b.label} · {b.balanceAda.toLocaleString()} ₳</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                {t('Destination address')} <span className="text-red-500">*</span>
                <input className={field} value={spendDest} onChange={(e) => setSpendDest(e.target.value)} placeholder="addr…" />
              </label>
            </div>
          ) : null}
          {!election && isRule ? (
            <div className="space-y-2 rounded border border-emerald-200 p-2 dark:border-emerald-900">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('§27 — vote to approve (or delete) a rule document. Submitting freezes its content and anchors the hash on-chain.')}</div>
              <label className="block text-sm">
                {t('Rule document')} <span className="text-red-500">*</span>
                <select className={field} value={ruleDocumentId} onChange={(e) => setRuleDocumentId(e.target.value)}>
                  <option value="">{t('— select a document —')}</option>
                  {ruleDocs.map((d) => (
                    <option key={d.id} value={d.id}>{d.title} · {d.status}</option>
                  ))}
                </select>
              </label>
              {ruleDocs.length === 0 ? (
                <div className="text-xs text-amber-600">{t('No published documents yet. Create one under “My Rule documents”, publish it (→ draft), then start the vote here.')}</div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ruleDeleteRequested} onChange={(e) => setRuleDeleteRequested(e.target.checked)} />
                {t('Delete the document (vote to remove it instead of approving)')}
              </label>
            </div>
          ) : null}
          {!election && isDecision ? (
            <div className="space-y-2 rounded border border-emerald-200 p-2 dark:border-emerald-900">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{t('§28 — vote to approve (or delete) a decision. Submitting freezes its content and anchors the hash on-chain.')}</div>
              <label className="block text-sm">
                {t('Decision')} <span className="text-red-500">*</span>
                <select className={field} value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
                  <option value="">{t('— select a decision —')}</option>
                  {decisions.map((d) => (
                    <option key={d.id} value={d.id}>{d.title} · {d.status}</option>
                  ))}
                </select>
              </label>
              {decisions.length === 0 ? (
                <div className="text-xs text-amber-600">{t('No published decisions yet. Create one under “My Decisions”, publish it (→ draft), then start the vote here.')}</div>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={decisionDeleteRequested} onChange={(e) => setDecisionDeleteRequested(e.target.checked)} />
                {t('Delete the decision (vote to remove it instead of approving)')}
              </label>
            </div>
          ) : null}
          {!election && isPoll ? (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="text-sm font-medium">{t('Poll options')}</div>
          {pollOptions.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={field} value={o} placeholder={`${t('Option')} ${i + 1}`} onChange={(e) => setPollOptions((opts) => opts.map((x, j) => (j === i ? e.target.value : x)))} />
              {pollOptions.length > 2 ? (
                <button type="button" onClick={() => setPollOptions((opts) => opts.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">{t('remove')}</button>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => setPollOptions((opts) => [...opts, ''])} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">{t('+ add option')}</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pollMultiple} onChange={(e) => setPollMultiple(e.target.checked)} />
            {t('Allow voters to choose more than one option')}
          </label>
        </div>
      ) : null}

      {!election && isInstructive ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-sm font-medium">{t('Actors')} <span className="font-normal text-neutral-400">{t('(optional — who must act if approved)')}</span></span>
            {/* Pick the DReps expected to act from the DAO member list. */}
            <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
              {members.length === 0 ? (
                <span className="text-xs text-neutral-400">{t('No DAO members to choose from.')}</span>
              ) : (
                members.map((m) => (
                  <label key={m.drepId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={actors.includes(m.displayName)}
                      onChange={() => setActors((s) => (s.includes(m.displayName) ? s.filter((x) => x !== m.displayName) : [...s, m.displayName]))}
                    />
                    {m.displayName}{m.isBoard ? <span className="text-[10px] text-neutral-400"> {t('(board)')}</span> : null}
                  </label>
                ))
              )}
            </div>
            {actors.length ? <span className="text-xs text-neutral-500">{actors.join(', ')}</span> : null}
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('Delivery date')} <span className="font-normal text-neutral-400">{t('(optional)')}</span></span>
            <DateField value={deliveryDate} onChange={setDeliveryDate} type="date" />
          </label>
        </div>
      ) : null}

      {election ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-sm font-medium">{t('Candidates (pick exactly 5 DReps)')}</span>
            {/* §14 — the 5 candidates who will become the new board on approval + installation date. */}
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
              {members.length === 0 ? (
                <span className="text-xs text-neutral-400">{t('No DAO members to choose from.')}</span>
              ) : (
                members.map((m) => {
                  const picked = candidates.includes(m.drepId);
                  return (
                    <label key={m.drepId} className={`flex items-center gap-2 text-sm ${!picked && candidates.length >= 5 ? 'opacity-50' : ''}`}>
                      <input
                        type="checkbox"
                        checked={picked}
                        disabled={!picked && candidates.length >= 5}
                        onChange={() => setCandidates((s) => (s.includes(m.drepId) ? s.filter((x) => x !== m.drepId) : [...s, m.drepId]))}
                      />
                      {m.displayName}{m.isBoard ? <span className="text-[10px] text-neutral-400"> {t('(board)')}</span> : null}
                    </label>
                  );
                })
              )}
            </div>
            <span className={`text-xs ${candidates.length === 5 ? 'text-emerald-600' : 'text-neutral-500'}`}>
              {candidates.length} {t('/ 5 selected')}
            </span>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('Installation date')} <span className="font-normal text-neutral-400">{t('(when the new board takes seats — must be after voting ends)')}</span></span>
            <DateField value={installDate} onChange={setInstallDate} min={votingEnd || toLocalInput(new Date().toISOString())} required />
            {installDate && votingEnd && new Date(installDate).getTime() <= new Date(votingEnd).getTime() ? (
              <span className="text-xs text-red-600">{t('⚠ the installation date must be later than the voting end')} ({fmtDateTime(votingEnd)})</span>
            ) : null}
          </label>
        </div>
      ) : null}

      {election ? (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          {t('Election defaults are fixed:')}
          <ul className="mt-1 list-disc pl-5">
            <li><span className="font-medium">{t('Who can vote:')}</span> {t('all DReps (board + others)')}</li>
            <li><span className="font-medium">{t('Voting type:')}</span> {t('adjusted voting power')}</li>
            <li><span className="font-medium">{t('Threshold:')}</span> IMPORTANT{iThresh != null ? ` (${iThresh}%)` : ''}</li>
            <li><span className="font-medium">{t('Visibility:')}</span> {t('public')}</li>
            <li>{t('When approved + the installation date hits, the platform replaces the board with the 5 elected candidates automatically. Any current board member can also install them earlier from the proposal page.')}</li>
          </ul>
        </div>
      ) : null}

      {!election ? (
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('Who can vote')}</span>
          <select className={field} value={isPrivate ? 'BOARD_ONLY' : votersScope} disabled={isPrivate} onChange={(e) => setVotersScope(e.target.value)}>
            {Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('Voting type')}</span>
          <select className={field} value={votingType} onChange={(e) => setVotingType(e.target.value)}>
            {Object.entries(VTYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t('Threshold')}</span>
          <select className={field} value={thresholdKind} onChange={(e) => setThresholdKind(e.target.value)}>
            <option value="DEFAULT">{t('Default')}{dThresh != null ? ` (${dThresh}%)` : ''}</option>
            <option value="IMPORTANT">{t('Important')}{iThresh != null ? ` (${iThresh}%)` : ''}</option>
          </select>
        </label>
      </div>
      ) : null}

      {!election ? (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        {t('Private — visible & votable to board members only')}
      </label>
      ) : null}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {(() => {
        // Tell the user exactly what's still missing — and disable the button until it's fixed.
        const missing: string[] = [];
        if (!title.trim()) missing.push(t('title'));
        if (!content.trim()) missing.push(t('content'));
        const endMs = new Date(votingEnd).getTime();
        if (!votingEnd || Number.isNaN(endMs) || endMs <= Date.now()) missing.push(t('voting end must be in the future'));
        if (election) {
          if (candidates.length !== 5) missing.push(`${t('pick exactly 5 candidates')} (${candidates.length} ${t('so far')})`);
          if (!installDate) missing.push(t('installation date'));
          else if (!Number.isNaN(new Date(installDate).getTime()) && !Number.isNaN(endMs) && new Date(installDate).getTime() <= endMs) {
            missing.push(t('installation date must be later than the voting end'));
          }
        } else if (isPoll) {
          const opts = pollOptions.map((o) => o.trim()).filter(Boolean);
          if (opts.length < 2) missing.push(t('at least two poll options'));
        } else if (isRule && !ruleDocumentId) {
          missing.push(t('rule document'));
        } else if (isDecision && !decisionId) {
          missing.push(t('decision'));
        }
        const ready = missing.length === 0;
        return (
          <div className="space-y-1">
            {!ready ? (
              <div className="text-xs text-neutral-500">
                {t('Still needed before submit:')} <span className="text-amber-600">{missing.join(' · ')}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={busy || !ready}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t('Submitting…') : t('Submit (opens voting now)')}
              </button>
              {/* §10 — drafts (regular internal proposals only; elections submit directly). */}
              {!election ? (
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={busy || !title.trim()}
                  className="rounded-md border border-emerald-500 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
                >
                  {editingDraft ? t('Save draft') : t('Save as draft')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t('Cancel')}
              </button>
              {editingDraft ? (
                <button
                  type="button"
                  onClick={removeDraft}
                  disabled={busy}
                  className="ml-auto rounded-md border border-red-400 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950"
                >
                  {t('Delete draft')}
                </button>
              ) : null}
            </div>
          </div>
        );
      })()}
    </form>
  );
}

function InternalDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const isBoard = !!profile?.roles.includes('BOARD');
  const { txUrl } = useExplorer();
  const { setParams } = useUrlNav();
  const [p, setP] = useState<InternalProposalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  // Once a DRep has voted the card locks to a read-only summary; "Change vote" reopens the form.
  const [changing, setChanging] = useState(false);

  const load = useCallback(() => {
    internalProposalsApi.get(id).then((d) => { setP(d); setPicked(d.myVotes); }).catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [id]);
  useEffect(load, [load]);

  // §10 — live countdown to the voting end. The backend finalizes an internal proposal on every
  // read, so when the end passes while the page is open we refetch once (status flips to
  // APPROVED/REJECTED immediately) and poll periodically as a safety net.
  const now = useNow(1000);
  const endMs = p?.votingEndAt ? new Date(p.votingEndAt).getTime() : null;
  const expired = endMs != null && now >= endMs;
  const expiryFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!p || p.status !== 'ACTIVE' || endMs == null || now < endMs) return;
    if (expiryFiredRef.current === id) return; // refetch only once per proposal when it expires
    expiryFiredRef.current = id;
    load();
  }, [now, p, endMs, id, load]);
  useEffect(() => {
    if (p?.status !== 'ACTIVE') return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [p?.status, load]);

  // Only a load failure (no proposal yet) replaces the page; a failed vote shows inline below
  // so the voter stays on the proposal page.
  if (!p) return <div className="space-y-3"><BackBtn onBack={onBack} />{error ? <div className="text-sm text-red-600">{error}</div> : <p className="text-sm text-neutral-500">{t('Loading…')}</p>}</div>;

  const isPoll = p.internalType === 'POLL';
  const hasVoted = p.myVotes.length > 0;
  // §10 — per-choice rationale word minimums (0 = not required). The matching vote button stays
  // disabled until the rationale meets the minimum. Polls only have an ABSTAIN minimum.
  const wordCount = rationale.trim().split(/\s+/).filter(Boolean).length;
  const minWords = p.rationaleMinWords;
  const meets = (choice: 'YES' | 'NO' | 'ABSTAIN') => wordCount >= (minWords[choice] ?? 0);
  const reqChoices: ('YES' | 'NO' | 'ABSTAIN')[] = isPoll ? ['ABSTAIN'] : ['YES', 'NO', 'ABSTAIN'];
  const reqParts = reqChoices.filter((c) => (minWords[c] ?? 0) > 0).map((c) => `${c} ${t('needs')} ${minWords[c]}`);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null); setBusy(true);
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : 'failed'); } finally { setBusy(false); }
  };
  // After a successful (re)vote, lock the card again and clear the editor.
  const afterVote = () => { setChanging(false); setRationale(''); };
  const voteThreshold = (choice: 'YES' | 'NO' | 'ABSTAIN') =>
    act(async () => { await internalProposalsApi.vote(id, { choice, rationale: rationale.trim() || undefined }); afterVote(); });
  const votePoll = () => {
    if (picked.length === 0) { setError(t('Select an option or Abstain.')); return; }
    // Abstain on a poll is its own choice — sent as { choice: 'ABSTAIN' }, never mixed with options.
    const body = picked.length === 1 && picked[0] === 'ABSTAIN'
      ? { choice: 'ABSTAIN' as const, rationale: rationale.trim() || undefined }
      : { options: picked, rationale: rationale.trim() || undefined };
    act(async () => { await internalProposalsApi.vote(id, body); afterVote(); });
  };
  // "Change vote": reopen an empty form. "Cancel": return to the locked summary unchanged.
  const startChange = () => { setError(null); setChanging(true); setRationale(''); setPicked([]); };
  const cancelChange = () => { setChanging(false); setRationale(''); setPicked(p.myVotes); };
  const togglePick = (o: string) => {
    // Abstain is exclusive — picking it clears options; picking an option clears Abstain.
    if (o === 'ABSTAIN') return setPicked(['ABSTAIN']);
    const withoutAbstain = (s: string[]) => s.filter((x) => x !== 'ABSTAIN');
    if (p.poll?.multiple) setPicked((s) => withoutAbstain(s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));
    else setPicked([o]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <BackBtn onBack={onBack} />
        <ShareLinkButton />
      </div>
      {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div> : null}
      {p.status === 'ACTIVE' && expired ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {t('⏱ Voting has ended — finalizing the result…')}
        </div>
      ) : null}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {p.title}
            {p.submitter ? <span className="ml-2 text-sm font-normal text-neutral-500">{t('by')} {p.submitter}</span> : null}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            {p.publicId ? <span>{t('ID:')} <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{p.publicId}</span></span> : null}
            {p.isPrivate ? <span className="rounded bg-neutral-200 px-1.5 py-0.5 font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{t('PRIVATE · board')}</span> : null}
            <span className="flex items-center gap-1">{t('Status:')} <StatusBadge status={p.status} cls={PROPOSAL_STATUS_CLS} /></span>
          </div>
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          {t(TYPE_LABEL[p.internalType] ?? p.internalType)} · {t(SCOPE_LABEL[p.votersScope] ?? p.votersScope)} · {t(VTYPE_LABEL[p.votingType] ?? p.votingType)}
          {p.tally.kind === 'THRESHOLD' ? ` · ${t('threshold')} ${p.thresholdPct ?? '?'}%` : ''}
          {' · '}{p.status === 'ACTIVE'
            ? (expired
                ? <span className="font-medium text-amber-600">{t('voting ended — finalizing…')}</span>
                : <>{t('voting ends in')} <span className={endMs != null && endMs - now <= 2 * 3600_000 ? 'font-semibold text-red-600' : 'font-medium text-neutral-700 dark:text-neutral-300'}>{fmtCountdown((endMs ?? now) - now)}</span></>)
            : `${t('voting')} ${fmtDateTime(p.votingStartAt)} → ${fmtDateTime(p.votingEndAt)}`}
        </div>

        <div className="mt-3">
          <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{p.contentMd}</Markdown>
        </div>

        {p.isBoardElection ? (
          <div className="mt-3 space-y-1 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
            <div><span className="font-medium">{t('Candidates (5):')}</span> {p.candidates?.map((c) => c.displayName).join(', ') ?? '—'}</div>
            <div><span className="font-medium">{t('Installation date:')}</span> {fmtDateTime(p.deliveryDate)}</div>
            {p.boardInstalledAt ? (
              <div className="text-emerald-700 dark:text-emerald-400">{t('✓ Board installed')} {fmtDateTime(p.boardInstalledAt)}</div>
            ) : null}
          </div>
        ) : p.internalType === 'INSTRUCTIVE' && (p.actors?.length || p.deliveryDate) ? (
          <div className="mt-3 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800">
            {p.actors?.length ? <div><span className="font-medium">{t('Actors:')}</span> {p.actors.join(', ')}</div> : null}
            {p.deliveryDate ? <div><span className="font-medium">{t('Delivery date:')}</span> {fmtDateTime(p.deliveryDate)}</div> : null}
          </div>
        ) : null}
        {/* §27 — rule-document approval: the target document + the frozen content hash voted on. */}
        {p.rule ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
            <div className="font-medium text-emerald-800 dark:text-emerald-200">{p.rule.deleteRequested ? t('Vote to DELETE a rule document') : t('Vote to APPROVE a rule document')}</div>
            <div className="mt-1">
              <span className="font-medium">{t('Document:')}</span>{' '}
              <button onClick={() => setParams({ view: 'rules', doc: p.rule!.documentId, ip: null })} className="text-emerald-700 underline dark:text-emerald-400">{p.rule.title}</button>
              {` · ${p.rule.documentStatus}`}
            </div>
            {p.rule.contentHash ? (
              <div className="mt-1 break-all font-mono text-[11px]"><span className="text-neutral-500">{t('Frozen content hash (SHA-256):')}</span> {p.rule.contentHash}</div>
            ) : null}
          </div>
        ) : null}
        {p.decision ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
            <div className="font-medium text-emerald-800 dark:text-emerald-200">{p.decision.deleteRequested ? t('Vote to DELETE a decision') : t('Vote to APPROVE a decision')}</div>
            <div className="mt-1">
              <span className="font-medium">{t('Decision:')}</span>{' '}
              <button onClick={() => setParams({ view: 'decisions', doc: p.decision!.decisionId, ip: null })} className="text-emerald-700 underline dark:text-emerald-400">{p.decision.title}</button>
              {` · ${p.decision.decisionStatus}`}
            </div>
            {p.decision.contentHash ? (
              <div className="mt-1 break-all font-mono text-[11px]"><span className="text-neutral-500">{t('Frozen content hash (SHA-256):')}</span> {p.decision.contentHash}</div>
            ) : null}
          </div>
        ) : null}
        {/* §10.5 — spending parameters + the multisig action's progress once approved. */}
        {p.spending ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
            <div className="font-medium text-emerald-800 dark:text-emerald-200">{t('Treasury spending (on approval)')}</div>
            <div className="mt-1"><span className="font-medium">{t('Amount:')}</span> {p.spending.amountAda.toLocaleString()} ₳</div>
            <div><span className="font-medium">{t('From:')}</span> {p.spending.sourceBucketLabel ?? t('Operations (default)')}</div>
            <div className="break-all"><span className="font-medium">{t('To:')}</span> <span className="font-mono">{p.spending.destAddress}</span></div>
            {p.spending.action ? (
              p.spending.action.status === 'CONFIRMED' ? (
                <div className="mt-1 text-emerald-700 dark:text-emerald-300">{t('✓ Executed on-chain')}{p.spending.action.txHash ? ` — ${p.spending.action.txHash.slice(0, 16)}…` : ''}{p.spending.action.paidAt ? ` (${new Date(p.spending.action.paidAt).toLocaleDateString()})` : ''}</div>
              ) : p.spending.action.status === 'FAILED' ? (
                <div className="mt-1 text-red-600">{t('✗ The prepared multisig action was cancelled — the board can review it under Treasury history.')}</div>
              ) : (
                <div className="mt-1 text-amber-600">{t('⏳ Multisig transaction prepared — awaiting board signatures (Treasury → Actions).')}</div>
              )
            ) : p.status === 'APPROVED' ? (
              <div className="mt-1 text-amber-600">{t('Preparing the multisig transaction…')}</div>
            ) : (
              <div className="mt-1 text-neutral-500">{t('If the vote passes, a multisig transaction is created for the board to sign.')}</div>
            )}
          </div>
        ) : null}
      </div>

      {/* Tally */}
      <div className={card}>
        <h3 className="text-base font-semibold">{t('Result')}</h3>
        {p.tally.kind === 'THRESHOLD' ? (
          <div className="mt-1 space-y-1 text-sm">
            <div className="text-neutral-600 dark:text-neutral-300">
              YES {p.tally.yesPower} / {p.tally.denominator} ({p.tally.ratioPct}%) · {t('threshold')} {p.tally.thresholdPct}% ·{' '}
              <span className={p.tally.approved ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>{p.tally.approved ? t('passing') : t('not passing')}</span>
            </div>
            <div className="text-xs text-neutral-500">{p.tally.cast} {t('of')} {p.tally.eligible} {t('eligible voted')} · {t('abstain')} {p.tally.abstainPower} · {t('total power')} {p.tally.totalPower}</div>
            {/* §4.4 — YES/NO/abstain over the full eligible voting power (0 → max), with the threshold marker. */}
            <ThresholdBar
              yes={p.tally.yesPower}
              abstain={p.tally.abstainPower}
              total={p.tally.totalPower}
              denominator={p.tally.denominator}
              thresholdPct={p.tally.thresholdPct}
            />
          </div>
        ) : (
          <div className="mt-1 space-y-1 text-sm">
            <div className="text-xs text-neutral-500">
              {p.tally.voted} {t('of')} {p.tally.eligible} {t('eligible voted')}{p.poll?.multiple ? ` · ${t('multiple choice')}` : ` · ${t('single choice')}`}
              {p.tally.abstain.voters > 0 ? ` · ${p.tally.abstain.voters} ${t('abstain')}` : ''}
            </div>
            <ul className="space-y-1">
              {p.tally.options.map((o) => {
                const max = Math.max(1, ...(p.tally.kind === 'POLL' ? p.tally.options.map((x) => x.power) : [1]));
                const pct = Math.round((o.power / max) * 100);
                return (
                  <li key={o.option} className="text-sm">
                    <div className="flex justify-between"><span>{o.option}</span><span className="text-neutral-500">{o.voters} {t('vote(s)')}{p.votingType !== 'ONE_PERSON_ONE_VOTE' ? ` · ${o.power} ${t('power')}` : ''}</span></div>
                    <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-800"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {p.anchorTxHash ? (
          <div className="mt-2 text-xs"><a href={txUrl(p.anchorTxHash)} target="_blank" rel="noreferrer" className="text-emerald-700 underline dark:text-emerald-400">{t('on-chain record ↗')}</a></div>
        ) : p.status !== 'ACTIVE' && p.anchorHash ? (
          <div className="mt-2 text-xs text-neutral-400">{t('on-chain anchor recorded (pending submission)')}</div>
        ) : null}
      </div>

      {/* Per-voter breakdown — who voted how + their rationale. */}
      {p.voters.length > 0 ? (
        <div className={card}>
          <h3 className="text-base font-semibold">{t('Votes')} ({p.voters.length})</h3>
          <p className="text-xs text-neutral-500">{t('Full history, newest first. A member\'s earlier votes are crossed out; only their latest counts.')}</p>
          <ul className="mt-2 space-y-2">
            {p.voters.map((v, i) => (
              <li key={`${v.drep}-${i}`} className={`rounded-md border p-2 text-sm ${v.superseded ? 'border-neutral-200/60 opacity-60 dark:border-neutral-800/60' : 'border-neutral-200 dark:border-neutral-800'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={v.superseded ? 'line-through' : ''}>
                    <span className="font-medium">{v.displayName ?? t('(unknown)')}</span>
                    <span className="ml-2 break-all font-mono text-[10px] text-neutral-400">{v.drep}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-400">{fmtDateTime(v.castAt)}</span>
                    {v.superseded ? <span className="text-[10px] font-medium text-neutral-400">{t('changed')}</span> : null}
                    {p.votingType !== 'ONE_PERSON_ONE_VOTE' ? <span className="text-[11px] text-neutral-500">{v.weight} {t('power')}</span> : null}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${choiceBadgeCls(v.choice)} ${v.superseded ? 'line-through' : ''}`}>{v.choice}</span>
                  </span>
                </div>
                <RationaleText text={v.rationale} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* §14 — election install: board members can trigger early; otherwise the platform auto-installs at the installation date. */}
      {p.isBoardElection && p.status === 'APPROVED' && !p.boardInstalledAt ? (
        <div className={card}>
          <h3 className="text-base font-semibold">{t('New board ready to install')}</h3>
          <p className="text-xs text-neutral-500">
            {t('Installation date:')} {fmtDateTime(p.deliveryDate)}. {t('The platform will install the new board automatically when that date arrives.')}
            {isBoard ? ` ${t('As a current board member, you can install them earlier:')}` : ''}
          </p>
          {isBoard ? (
            <button
              disabled={busy}
              onClick={() => act(() => internalProposalsApi.installBoard(id))}
              className="mt-2 rounded-md border border-emerald-500 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {busy ? t('Installing…') : t('Install new board members now')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Voting */}
      {p.status === 'ACTIVE' && p.canVote && !expired ? (
        <div className={card}>
          <h3 className="text-base font-semibold">{t('Cast your vote')}</h3>
          {hasVoted && !changing ? (
            // §10 — locked summary of the voter's current vote; the form is reopened via "Change vote".
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-neutral-500">{t('Your vote:')}</span>
                {p.myVotes.map((c) => (
                  <span key={c} className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${choiceBadgeCls(c)}`}>{c === 'ABSTAIN' ? t('Abstain') : c}</span>
                ))}
              </div>
              {p.myRationale ? (
                <div className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                  <Markdown className="text-sm text-neutral-700 dark:text-neutral-300">{p.myRationale}</Markdown>
                </div>
              ) : <p className="text-xs text-neutral-500">{t('No rationale provided.')}</p>}
              <button disabled={busy} onClick={startChange} className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Change vote')}</button>
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-500">{t('You can change your vote until voting ends.')}</p>
              {isPoll ? (
                <div className="mt-2 space-y-1.5">
                  {p.poll?.options.map((o) => (
                    <label key={o} className="flex items-center gap-2 text-sm">
                      <input type={p.poll?.multiple ? 'checkbox' : 'radio'} name="pollopt" checked={picked.includes(o)} onChange={() => togglePick(o)} />
                      {o}
                    </label>
                  ))}
                  {/* §10 — voters may also abstain on a poll (exclusive with the options). */}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="pollopt" checked={picked.length === 1 && picked[0] === 'ABSTAIN'} onChange={() => togglePick('ABSTAIN')} />
                    <span className="text-neutral-500">{t('Abstain')}</span>
                  </label>
                </div>
              ) : null}
              <div className="mt-2">
                <MarkdownEditor value={rationale} onChange={setRationale} title={t('Rationale')} hint={reqParts.length > 0 ? t('Markdown supported') : t('optional — Markdown supported')} placeholder={reqParts.length > 0 ? t('Why you voted this way') : t('Why you voted this way (optional)')} minRows={3} />
              </div>
              {reqParts.length > 0 ? (
                <p className="mt-1 text-xs text-neutral-500">
                  {t('Rationale:')} {wordCount} {t('word(s) · minimum required —')} {reqParts.join(' · ')}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {isPoll ? (
                  <button disabled={busy || (picked.length === 1 && picked[0] === 'ABSTAIN' && !meets('ABSTAIN'))} onClick={votePoll} className="rounded border border-emerald-500 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">{t('Submit vote')}</button>
                ) : (
                  <>
                    <button disabled={busy || !meets('YES')} onClick={() => voteThreshold('YES')} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${p.myVotes.includes('YES') ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-emerald-500 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950'}`}>{p.myVotes.includes('YES') ? '✓ YES' : 'YES'}</button>
                    <button disabled={busy || !meets('NO')} onClick={() => voteThreshold('NO')} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${p.myVotes.includes('NO') ? 'border-red-400 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200' : 'border-red-400 text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950'}`}>{p.myVotes.includes('NO') ? '✓ NO' : 'NO'}</button>
                    <button disabled={busy || !meets('ABSTAIN')} onClick={() => voteThreshold('ABSTAIN')} className={`rounded border px-3 py-1 text-sm disabled:opacity-40 ${p.myVotes.includes('ABSTAIN') ? 'border-neutral-400 bg-neutral-100 dark:bg-neutral-800' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>{p.myVotes.includes('ABSTAIN') ? `✓ ${t('Abstain')}` : t('Abstain')}</button>
                  </>
                )}
                {hasVoted ? <button disabled={busy} onClick={cancelChange} className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800">{t('Cancel')}</button> : null}
              </div>
            </>
          )}
        </div>
      ) : p.status === 'ACTIVE' && !expired ? (
        <div className={card}><p className="text-sm text-neutral-500">{t('You are not eligible to vote on this proposal')} ({t(SCOPE_LABEL[p.votersScope] ?? p.votersScope)}).</p></div>
      ) : null}

      {/* §10 — the voting end is fixed at submission; it can't be changed once voting is open. */}
    </div>
  );
}

function BackBtn({ onBack }: { onBack: () => void }) {
  const t = useT();
  return <BackButton onBack={onBack} label={t('back to internal proposals')} />;
}

/**
 * §4.4 result bar: YES / NO / abstain over the **full eligible voting power** (0 → total), with a
 * marker at the approval threshold (placed on the total-power scale, allowing for abstains).
 */
function ThresholdBar({ yes, abstain, total, denominator, thresholdPct }: { yes: number; abstain: number; total: number; denominator: number; thresholdPct: number }) {
  const t = useT();
  const no = Math.max(0, total - yes - abstain); // explicit + implicit NO
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  // Threshold is a % of the denominator (total − abstain); place it on the 0→total scale.
  const tpos = total > 0 ? Math.min(100, Math.max(0, (((thresholdPct / 100) * denominator) / total) * 100)) : 0;
  return (
    <div className="mt-5">
      <div className="relative h-5 w-full rounded bg-neutral-200 dark:bg-neutral-800">
        <div className="absolute inset-0 overflow-hidden rounded">
          <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(yes)}%` }} />
          <div className="absolute inset-y-0 bg-red-400" style={{ left: `${pct(yes)}%`, width: `${pct(no)}%` }} />
          <div className="absolute inset-y-0 bg-neutral-400" style={{ left: `${pct(yes + no)}%`, width: `${pct(abstain)}%` }} />
        </div>
        <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-neutral-700 dark:text-neutral-300" style={{ left: `${tpos}%` }}>
          {t('threshold')} {thresholdPct}%
        </div>
        <div className="absolute -top-1.5 bottom-0 w-0.5 bg-neutral-900 dark:bg-white" style={{ left: `${tpos}%` }} title={`${t('threshold')} ${thresholdPct}%`} />
      </div>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />YES {fmt(yes)}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />NO {fmt(no)}</span>
        {abstain > 0 ? <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-neutral-400" />{t('abstain')} {fmt(abstain)}</span> : null}
        <span className="tabular-nums">{t('max power')} {fmt(total)}</span>
      </div>
    </div>
  );
}
