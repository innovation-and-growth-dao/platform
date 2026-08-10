'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_SUBCATEGORIES, ROUND_SETTING_DEFAULTS } from '@drep-dao/shared';
import {
  proposalsApi,
  roundsApi,
  submitterApi,
  type FeeVerification,
  type ProposalMilestoneInput,
  type ProposalSummary,
  type RoundDetail,
  type RoundSummary,
} from '@/lib/api';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';
import { useT } from '@/lib/prefs-context';
import { ProposalDetail } from './proposal-detail';
import { MarkdownEditor, MarkdownCollapseContext } from './markdown';
import { CopyButton } from './copy-button';

type Cat = { id: string; name: string; minAda: number | null; maxAda: number | null; conditions: string | null };

export function ProposalSubmit() {
  const tr = useT();
  const { cfg } = useExplorer();
  const { setParams } = useUrlNav();
  // §10 — "My proposals" is split by type: Funding vs the user's own Internal proposals.
  const [myTab, setMyTab] = useState<'FUNDING' | 'INTERNAL'>('FUNDING');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [editingFeedback, setEditingFeedback] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // When the user clicked "Edit" on a detail-edit row (not "Open"), open the
  // ProposalDetail with the inline EditSection already expanded — saves a click
  // and matches the intent: "Edit" means I want to edit, not just read.
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [mine, setMine] = useState<ProposalSummary[]>([]);
  const [roundId, setRoundId] = useState('');
  const [cats, setCats] = useState<Cat[]>([]);
  const [roundSettings, setRoundSettings] = useState<RoundDetail['settings'] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // No default — the team must enter the requested amount (0 fails the
  // "set a requested amount" check below, forcing them to fill it in).
  const [amount, setAmount] = useState(0);
  const [commercial, setCommercial] = useState(false);
  // §3 — "Expand all / Collapse all" toggle for the collapsible MarkdownEditor fields.
  const [expandSig, setExpandSig] = useState(0);
  const [collapseSig, setCollapseSig] = useState(0);
  const [allOpen, setAllOpen] = useState(true);
  // Milestone amounts start empty (0) — the team must enter them explicitly so
  // they don't drift with the requested amount. A subsequent change to
  // "Requested" won't quietly update the milestone budgets behind the team's back.
  const [ms, setMs] = useState<ProposalMilestoneInput[]>([{ title: '', description: '', acceptanceCriteria: '', amountAda: 0 }]);
  const [costBreakdown, setCostBreakdown] = useState('');
  const [teamInfo, setTeamInfo] = useState('');
  const [revenueSharing, setRevenueSharing] = useState('');
  // §3.4 — when checked, the proposal needs board verification post-approval
  // before milestone POAs unblock.
  const [revenueSharingRequired, setRevenueSharingRequired] = useState(false);
  // §3.4 — Expected ecosystem impact + Success metrics / KPIs.
  const [ecosystemImpact, setEcosystemImpact] = useState('');
  const [successMetrics, setSuccessMetrics] = useState('');
  const [payoutAddress, setPayoutAddress] = useState('');
  // §3 — live validation of the payout/refund address (valid Cardano addr on the right network,
  // and whether it's the submitter's own wallet vs. a foreign one). Debounced.
  const [addrCheck, setAddrCheck] = useState<{ valid: boolean; networkOk: boolean; mine: boolean; hasStakePart: boolean } | null>(null);
  const [subcatIds, setSubcatIds] = useState<string[]>([]);
  const [fee, setFee] = useState('');
  // §3 — optional refundable pledge. Off by default; the team opts in via a checkbox
  // that appears only when the round's `pledgeThresholdAda > 0`. Amount must be ≥
  // the threshold; the return-method description (collapsible MarkdownEditor) is
  // required when the pledge is on.
  const [pledgeEnabled, setPledgeEnabled] = useState(false);
  const [pledgeAmount, setPledgeAmount] = useState<number>(0);
  const [pledgeReturnMethod, setPledgeReturnMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // §3 — after a submit attempt, mandatory fields below the round's word minimum
  // are flagged red, force-expanded, and show how many words are still needed.
  const [triedSubmit, setTriedSubmit] = useState(false);
  const minWords = roundSettings?.mandatoryWords ?? ROUND_SETTING_DEFAULTS.mandatoryWords;
  const maxWords = roundSettings?.mandatoryWordsMax ?? ROUND_SETTING_DEFAULTS.mandatoryWordsMax;
  // §3 — the proposal title is measured in CHARACTERS; each milestone title in WORDS — separate
  // round settings from the generic mandatoryWords that governs the longer fields.
  const minTitleChars = roundSettings?.minimumTitleLen ?? ROUND_SETTING_DEFAULTS.minimumTitleLen;
  const minMsTitleWords = roundSettings?.minimumMilestoneTitleLen ?? ROUND_SETTING_DEFAULTS.minimumMilestoneTitleLen;
  const wc = (s: string) => (s.trim() ? s.trim().split(/\s+/).filter(Boolean).length : 0);
  // Inline red shortfall hints (shown once a submit was attempted): the proposal title by
  // characters, milestone titles by words.
  const titleCharHint = (text: string) => {
    if (!triedSubmit || minTitleChars <= 0) return null;
    const n = text.trim().length;
    if (n >= minTitleChars) return null;
    return <span className="ml-2 text-[11px] font-semibold text-red-600 dark:text-red-400">{tr('needs')} {minTitleChars - n} {minTitleChars - n === 1 ? tr('more character') : tr('more characters')}</span>;
  };
  const msTitleHint = (text: string) => {
    if (!triedSubmit || minMsTitleWords <= 0) return null;
    const n = wc(text);
    if (n >= minMsTitleWords) return null;
    return <span className="ml-2 text-[11px] font-semibold text-red-600 dark:text-red-400">{tr('needs')} {minMsTitleWords - n} {minMsTitleWords - n === 1 ? tr('more word') : tr('more words')}</span>;
  };
  // §3 — mandatory text fields governed by the word min/max (titles are checked separately:
  // proposal title by chars, milestone titles by minimumMilestoneTitleLen words).
  const mandatoryFields: [string, string][] = [
    [tr('Pitch / summary'), content],
    [tr('Expected ecosystem impact'), ecosystemImpact],
    [tr('Success metrics / KPIs'), successMetrics],
    [tr('Cost breakdown'), costBreakdown],
    [tr('Team info'), teamInfo],
    ...ms.flatMap((m, i): [string, string][] => [
      [`${tr('Milestone')} ${i + 1} ${tr('description')}`, m.description ?? ''],
      [`${tr('Milestone')} ${i + 1} ${tr('acceptance criteria')}`, m.acceptanceCriteria ?? ''],
    ]),
  ];
  const shortFields = minWords > 0 ? mandatoryFields.filter(([, t]) => wc(t) < minWords) : [];
  const overFields = maxWords > 0 ? mandatoryFields.filter(([, t]) => wc(t) > maxWords) : [];
  // §12 — on-chain submission-fee verification result. Set when the submitter
  // clicks Verify next to the fee tx input; cumulative across all saved hashes.
  const [verifying, setVerifying] = useState(false);
  const [feeVerification, setFeeVerification] = useState<FeeVerification | null>(null);

  const loadMine = () => proposalsApi.mine().then(setMine).catch(() => undefined);
  useEffect(() => {
    // §3/§19 — proposals can only be created while a round's Submission stage is open.
    roundsApi
      .list()
      .then((r) => {
        const open = r.filter((x) => x.status === 'SUBMISSION');
        setRounds(open);
        // If exactly one round is open for submission (the common case), preselect it.
        if (open.length === 1) setRoundId(open[0].id);
      })
      .catch(() => undefined);
    loadMine();
  }, []);

  // §3 — debounced payout-address check (valid + network + own-wallet).
  useEffect(() => {
    const a = payoutAddress.trim();
    if (!a) { setAddrCheck(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      submitterApi.checkPayoutAddress(a).then((r) => { if (alive) setAddrCheck(r); }).catch(() => { if (alive) setAddrCheck(null); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [payoutAddress]);

  useEffect(() => {
    if (!roundId) return;
    roundsApi.get(roundId).then((r) => {
      const cs = r.categories.map((c) => ({ id: c.id, name: c.name, minAda: c.minAda, maxAda: c.maxAda, conditions: c.conditions }));
      setCats(cs);
      setRoundSettings(r.settings);
      // Keep the currently-selected category if it belongs to this round (preserves the draft's
      // category when editing); otherwise default to the first.
      setCategoryId((cur) => (cs.some((c) => c.id === cur) ? cur : cs[0]?.id ?? ''));
    });
  }, [roundId]);

  // §10 — split "My proposals" by type. Default to Funding; auto-switch off an empty tab so the
  // user always lands on a non-empty list (and stays put when both have proposals).
  const fundingMine = mine.filter((p) => p.type !== 'INTERNAL');
  const internalMine = mine.filter((p) => p.type === 'INTERNAL');
  useEffect(() => {
    if (myTab === 'FUNDING' && fundingMine.length === 0 && internalMine.length > 0) setMyTab('INTERNAL');
    else if (myTab === 'INTERNAL' && internalMine.length === 0 && fundingMine.length > 0) setMyTab('FUNDING');
  }, [fundingMine.length, internalMine.length, myTab]);

  const selectedCat = cats.find((c) => c.id === categoryId);

  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

  // §5.2 — live readiness: what's still missing before this can be saved/submitted.
  const msSum = ms.reduce((a, m) => a + Number(m.amountAda || 0), 0);
  const milestonesMatch = msSum === Number(amount);
  const belowMin = selectedCat?.minAda != null && Number(amount) < selectedCat.minAda;
  const aboveMax = selectedCat?.maxAda != null && Number(amount) > selectedCat.maxAda;
  const draftMissing: string[] = [];
  if (!roundId) draftMissing.push(tr('select a round'));
  if (!categoryId) draftMissing.push(tr('select a category'));
  if (!title.trim()) draftMissing.push(tr('add a title'));
  if (!content.trim()) draftMissing.push(tr('write the pitch'));
  if (!(Number(amount) > 0)) draftMissing.push(tr('set a requested amount'));
  if (belowMin) draftMissing.push(`${tr('requested amount is below the category minimum')} (${selectedCat!.minAda!.toLocaleString()} ₳)`);
  if (aboveMax) draftMissing.push(`${tr('requested amount is above the category maximum')} (${selectedCat!.maxAda!.toLocaleString()} ₳)`);
  if (ms.some((m) => !(m.title ?? '').trim())) draftMissing.push(tr('give every milestone a title'));
  if (ms.some((m) => !m.description.trim())) draftMissing.push(tr('describe every milestone'));
  if (!milestonesMatch) draftMissing.push(`${tr('milestones must sum to the requested amount')} (${tr('now')} ${msSum.toLocaleString()} ${tr('of')} ${Number(amount).toLocaleString()} ₳)`);
  // §3 — when the team opts in to a pledge, the amount must clear the round's
  // threshold and a return-method description is required.
  if (pledgeEnabled) {
    const minPledge = roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda;
    if (!(pledgeAmount > 0)) draftMissing.push(tr('set the pledge amount'));
    else if (minPledge > 0 && pledgeAmount < minPledge) draftMissing.push(`${tr('pledge must be ≥')} ${minPledge.toLocaleString()} ₳ (${tr('round minimum')})`);
    if (!pledgeReturnMethod.trim()) draftMissing.push(tr('describe how the pledge will be returned'));
  }
  const draftReady = draftMissing.length === 0;

  const buildInput = () => ({
    roundId,
    categoryId,
    title: title.trim(),
    contentMd: content,
    isCommercial: commercial,
    requestedAmountAda: Number(amount),
    subcategoryIds: subcatIds.length ? subcatIds : undefined,
    costBreakdownMd: costBreakdown.trim() || undefined,
    teamInfoMd: teamInfo.trim() || undefined,
    revenueSharingMd: revenueSharingRequired ? (revenueSharing.trim() || undefined) : undefined,
    revenueSharingRequired,
    ecosystemImpactMd: ecosystemImpact.trim() || undefined,
    successMetricsMd: successMetrics.trim() || undefined,
    payoutAddress: payoutAddress.trim() || undefined,
    // Persist the fee tx hash with the draft so it survives a save (verified on-chain at submission).
    submissionFeeTxHash: fee.trim() || undefined,
    // §3 — pledge promise (0 / undefined means "no pledge").
    pledgeAmountAda: pledgeEnabled && pledgeAmount > 0 ? pledgeAmount : undefined,
    pledgeReturnMethod: pledgeEnabled ? (pledgeReturnMethod.trim() || undefined) : undefined,
    milestones: ms.map((m) => ({
      title: m.title?.trim() || undefined,
      description: m.description,
      acceptanceCriteria: m.acceptanceCriteria?.trim() || undefined,
      amountAda: Number(m.amountAda),
    })),
  });

  // PATCH payload: the round is immutable once the draft exists, so drop it (the API
  // rejects unknown fields); the category may still change within the same round.
  const updatePayload = () => {
    const { roundId: _omitRound, ...patch } = buildInput();
    return patch;
  };

  // §5.2 milestones must sum to the request, and the request must fit the category's ask range.
  const inputsOk = () => {
    const sum = ms.reduce((a, m) => a + Number(m.amountAda), 0);
    if (sum !== Number(amount)) {
      setError(`${tr('milestones')} (${sum}) ${tr('must sum to requested amount')} (${amount})`);
      return false;
    }
    if (selectedCat?.minAda != null && Number(amount) < selectedCat.minAda) {
      setError(`${tr('requested')} ${Number(amount).toLocaleString()} ₳ ${tr('is below')} "${selectedCat.name}" ${tr('minimum ask of')} ${selectedCat.minAda.toLocaleString()} ₳`);
      return false;
    }
    if (selectedCat?.maxAda != null && Number(amount) > selectedCat.maxAda) {
      setError(`${tr('requested')} ${Number(amount).toLocaleString()} ₳ ${tr('exceeds')} "${selectedCat.name}" ${tr('maximum ask of')} ${selectedCat.maxAda.toLocaleString()} ₳`);
      return false;
    }
    return true;
  };

  const reset = () => {
    setEditingId(null);
    setEditingStatus(null);
    setEditingFeedback(null);
    // Clear any prior "Submitted …" / "Saved" banner so it never lingers into a fresh form.
    setMsg(null);
    setError(null);
    setTitle('');
    setContent('');
    // Don't carry the previous proposal's amount / category / flags into a fresh form.
    setAmount(0);
    setCommercial(false);
    setCategoryId('');
    setRevenueSharingRequired(false);
    setFee('');
    // Clear the prior proposal's fee-verification + address check — otherwise a fresh proposal
    // wrongly shows the previous one's "fully paid" / submitted-hash list (it's per-proposal).
    setFeeVerification(null);
    setVerifying(false);
    setAddrCheck(null);
    setCostBreakdown('');
    setTeamInfo('');
    setRevenueSharing('');
    setEcosystemImpact('');
    setSuccessMetrics('');
    setPayoutAddress('');
    setSubcatIds([]);
    setPledgeEnabled(false);
    setPledgeAmount(0);
    setPledgeReturnMethod('');
    // Milestone amount stays empty after a reset too — don't pre-fill with the
    // (carried-over) requested amount; the team enters each milestone budget.
    setMs([{ title: '', description: '', acceptanceCriteria: '', amountAda: 0 }]);
  };

  // Load an existing DRAFT into the form for editing (all fields, incl. milestones).
  const startEdit = async (id: string) => {
    setError(null);
    setMsg(null);
    setOpenId(null);
    // Drop the previously-open proposal's fee verification; this draft re-verifies its own hash.
    setFeeVerification(null);
    setVerifying(false);
    try {
      const p = await proposalsApi.get(id);
      setEditingId(p.id);
      setEditingStatus(p.status);
      setEditingFeedback(p.feeReviewFeedback ?? null);
      setRoundId(p.roundId ?? '');
      setCategoryId(p.categoryId);
      setTitle(p.title);
      setContent(p.contentMd);
      setAmount(p.requestedAmountAda);
      setCommercial(!!p.isCommercial);
      setCostBreakdown(p.costBreakdownMd ?? '');
      setTeamInfo(p.teamInfoMd ?? '');
      setRevenueSharing(p.revenueSharingMd ?? '');
      setRevenueSharingRequired(p.revenueSharingRequired ?? false);
      setEcosystemImpact(p.ecosystemImpactMd ?? '');
      setSuccessMetrics(p.successMetricsMd ?? '');
      setPayoutAddress(p.payoutAddress ?? '');
      setSubcatIds(p.subcategoryIds ?? []);
      setMs(
        p.milestones.length
          ? p.milestones.map((m) => ({ title: m.title ?? '', description: m.description ?? '', acceptanceCriteria: m.acceptanceCriteria ?? '', amountAda: m.amountAda }))
          : [{ title: '', description: '', acceptanceCriteria: '', amountAda: p.requestedAmountAda }],
      );
      // Restore the fee tx hash saved with the draft (so it persists across edits).
      setFee(p.submissionFeeTxHash ?? '');
      // §3 — restore the pledge promise so it survives an edit.
      setPledgeEnabled((p.pledgeAmountAda ?? 0) > 0);
      setPledgeAmount(p.pledgeAmountAda ?? 0);
      setPledgeReturnMethod(p.pledgeReturnMethod ?? '');
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('could not load draft'));
    }
  };

  // §3 — save privately as a DRAFT (no fee needed); submit it later. Reuses the row when editing.
  const saveDraft = async () => {
    setError(null);
    setMsg(null);
    if (!inputsOk()) return;
    setBusy(true);
    try {
      const d = editingId ? await proposalsApi.update(editingId, updatePayload()) : await proposalsApi.create(buildInput());
      setMsg(
        editingStatus && editingStatus !== 'DRAFT'
          ? `${tr('Saved your changes to')} "${d.title}".`
          : `${tr('Saved draft')} "${d.title}" — ${tr('it stays private until you submit and a board member confirms your fee.')}`,
      );
      setOpen(false);
      reset();
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('save failed'));
    } finally {
      setBusy(false);
    }
  };

  // §3.3 — submit with the on-chain fee tx; goes to PENDING (still private) until the board confirms.
  const submitNow = async (e: React.FormEvent) => {
    e.preventDefault();
    // A PENDING proposal is already submitted — Enter just saves the edits, never re-submits.
    if (editingStatus === 'PENDING') return saveDraft();
    setError(null);
    setMsg(null);
    setTriedSubmit(true); // flag/expand any too-short mandatory fields
    if (!inputsOk()) return;
    // §3 — block here (not at the server) so the per-field flags + the live
    // word-count summary below the form drive the fix, updating as they edit.
    if (shortFields.length > 0 || overFields.length > 0) return;
    if (feeRequired && !fee.trim()) {
      setError(tr('Paste the submission-fee transaction hash to submit (or use Save Draft).'));
      return;
    }
    setBusy(true);
    try {
      const draft = editingId ? await proposalsApi.update(editingId, updatePayload()) : await proposalsApi.create(buildInput());
      const submitted = await proposalsApi.submit(draft.id, fee.trim());
      setMsg(
        feeRequired
          ? `${tr('Submitted')} "${submitted.title}" — ${tr('fee')} ${submitted.submissionFeeAda} ₳. ${tr('A board member verifies your payment on-chain; it becomes public once confirmed.')}`
          : `${tr('Submitted')} "${submitted.title}" — ${tr("no submission fee for this proposal type, so it's now live and public.")}`,
      );
      setOpen(false);
      reset();
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('submission failed'));
    } finally {
      setBusy(false);
    }
  };

  // §8 — open one of my proposals to read it, edit it (when the stage allows), and submit milestone POAs.
  if (openId) {
    const detailId = openId;
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <ProposalDetail
          id={detailId}
          initialEditing={openInEditMode}
          onBack={() => { setOpenId(null); setOpenInEditMode(false); loadMine(); }}
          onEditFull={() => { setOpenId(null); setOpenInEditMode(false); startEdit(detailId); }}
        />
      </section>
    );
  }

  // §12 — the fee for THIS proposal type comes from the round's settings (fall back to defaults).
  // If that fee is 0%, no payment is needed and the proposal goes live immediately on submit.
  const feePct = commercial
    ? roundSettings?.feeCommercialPct ?? ROUND_SETTING_DEFAULTS.feeCommercialPct
    : roundSettings?.feeOssPct ?? ROUND_SETTING_DEFAULTS.feeOssPct;
  const feeCap = commercial
    ? roundSettings?.feeCommercialCapAda ?? ROUND_SETTING_DEFAULTS.feeCommercialCapAda
    : roundSettings?.feeOssCapAda ?? ROUND_SETTING_DEFAULTS.feeOssCapAda;
  const feeRequired = feePct > 0;
  const feeEstimate = feeRequired ? Math.round(Math.min((amount * feePct) / 100, feeCap)) : 0;
  // §12 — once submitted (PENDING), the budget + commercial flag are locked (they set the fee);
  // a budget change then goes through the active proposal's "Request a budget change".
  const amountLocked = editingStatus === 'PENDING';

  // §3 — additional checks that block SUBMIT but not SAVE-AS-DRAFT: payout
  // address is mandatory to submit (refunds + budget payout go there); when the
  // round charges a fee, the on-chain check must have come back fully-paid.
  const submitMissing: string[] = [];
  if (!payoutAddress.trim()) submitMissing.push(tr('add a payout / refund address (Cardano)'));
  if (feeRequired && !feeVerification?.fullyPaid) {
    submitMissing.push(tr('verify the submission-fee payment on-chain (paste the tx hash, click Verify, and wait for the ✓)'));
  }
  const submitReady = draftReady && submitMissing.length === 0;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{tr('Funding proposals')}</h3>
        {/* §3/§19 — a NEW proposal can only be created while a round's Submission stage is open
            (`rounds` holds only SUBMISSION rounds). Once it closes the button is hidden — the
            backend rejects late creation too. The Cancel state stays available to close an open form. */}
        {rounds.length > 0 || open ? (
          <button
            onClick={() => { if (open) { setOpen(false); reset(); } else { reset(); setOpen(true); } }}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {open ? tr('Cancel') : tr('+ New proposal')}
          </button>
        ) : myTab === 'FUNDING' ? (
          // Funding-only note — internal proposals aren't tied to a round, so it'd be misleading on
          // the Internal tab (DReps can submit those any time from the Internal proposals tab).
          <span className="text-xs text-neutral-500">{tr('New proposals open during a round’s Submission stage.')}</span>
        ) : null}
      </div>

      {msg ? <div className="mt-2 text-sm text-emerald-600">{msg}</div> : null}
      {open && editingId && editingStatus === 'REJECTED' ? (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950/30">
          <div className="text-sm font-bold uppercase tracking-wide text-red-700 dark:text-red-400">{tr('Rejected')}</div>
          <div className="text-xs text-red-800 dark:text-red-300">
            {tr('Fix the proposal — including the fee tx — then')} <strong>{tr('Re-submit')}</strong> {tr('to send it back for review.')}
          </div>
          {editingFeedback ? (
            <div className="mt-1 border-t border-red-200 pt-1 dark:border-red-900">
              <span className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400">{tr('Feedback from the reviewer:')}</span>
              <div className="whitespace-pre-wrap text-xs text-red-800 dark:text-red-300">{editingFeedback}</div>
            </div>
          ) : null}
        </div>
      ) : open && editingId ? (
        <div className="mt-2 text-sm font-medium text-neutral-600 dark:text-neutral-400">
          {editingStatus === 'PENDING'
            ? tr('Editing a submitted proposal (awaiting fee confirmation) — change any field, then Save changes.')
            : tr('Editing your draft — save your changes below.')}
        </div>
      ) : null}

      {open && rounds.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          {tr('No round is currently open for submissions. Proposals can only be submitted while a board member has a round in the')} <strong>{tr('Submission')}</strong> {tr('stage.')}
        </p>
      ) : null}

      {open && rounds.length > 0 ? (
        <MarkdownCollapseContext.Provider value={{ expandSignal: expandSig, collapseSignal: collapseSig }}>
        <form onSubmit={submitNow} className="mt-3 space-y-2">
          {/* §3 — expand/collapse every shrinkable field at once. */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => { if (allOpen) { setCollapseSig((n) => n + 1); setAllOpen(false); } else { setExpandSig((n) => n + 1); setAllOpen(true); } }}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title={tr('Expand or collapse all the collapsible text fields below')}
            >
              {allOpen ? tr('▣ Collapse all fields') : tr('▾ Expand all fields')}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
              {tr('Round')}{editingId ? <span className="font-normal text-neutral-400"> {tr('(fixed once created)')}</span> : null}
              <select className={field} value={roundId} onChange={(e) => setRoundId(e.target.value)} required disabled={!!editingId}>
                <option value="">{tr('Select round…')}</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>#{r.number} {r.name ?? ''} ({r.status})</option>
                ))}
              </select>
            </label>
            {/* §5.2 — category picker appears only after a round is chosen (its categories are known then). */}
            {roundId ? (
              <label className="flex flex-col gap-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {tr('Category')}
                <select className={field} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                  <option value="">{tr('Select category…')}</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{tr('Title')}{titleCharHint(title)}</span>
            <input className={`${field} mt-0.5 w-full disabled:opacity-60 ${triedSubmit && title.trim().length < minTitleChars ? 'border-red-400 dark:border-red-700' : ''}`} placeholder={tr('Proposal title')} value={title} onChange={(e) => setTitle(e.target.value)} disabled={amountLocked} required />
            <span className="mt-0.5 block text-[11px] italic text-neutral-500 dark:text-neutral-400">
              {amountLocked ? tr('The title is locked — it cannot be changed once the proposal is submitted.') : tr('Title cannot be changed once the proposal is submitted.')}
            </span>
          </label>
          {/* Requested amount + commercial flag sit right under the title (they set the
              fee + cap the proposal's category fit) so the submitter sees the cost of
              the ask before writing the pitch. */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>{tr('Requested')} ₳ <input type="number" className={`${field} w-32 disabled:opacity-60`} value={amount} onChange={(e) => setAmount(Number(e.target.value))} disabled={amountLocked} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} disabled={amountLocked} /> {tr('Commercial / for profit')}</label>
            {/* §12 — live submission-fee preview: updates as the user toggles commercial or
                changes the requested amount, so the fee is never a surprise at submit time. */}
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${feeRequired
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}
              title={feeRequired
                ? `${feePct}% ${tr('of the requested amount (capped at')} ${feeCap.toLocaleString()} ₳).`
                : tr('No fee for this proposal type — it goes live immediately on submit.')}
            >
              {feeRequired
                ? `${tr('Submission fee:')} ${feeEstimate.toLocaleString()} ₳ (${feePct}%${amount * feePct / 100 > feeCap ? tr(', capped') : ''})`
                : tr('No submission fee')}
            </span>
          </div>
          {amountLocked ? (
            <div className="text-xs text-neutral-500">
              {tr('The requested amount + commercial flag are')} <strong>{tr('locked after submission')}</strong> {tr('(they set the fee). To change the budget, use')} <strong>{tr('Request a budget change')}</strong> {tr('on the proposal once it’s active.')}
            </div>
          ) : null}
          {/* §5.2 — the selected category's per-proposal ask range + conditions, right below the
              requested amount so the submitter sees the allowed bounds as they type the ask. */}
          {selectedCat && (selectedCat.minAda != null || selectedCat.maxAda != null || selectedCat.conditions) ? (
            <div className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
              {selectedCat.minAda != null || selectedCat.maxAda != null ? (
                <div className={(selectedCat.minAda != null && Number(amount) < selectedCat.minAda) || (selectedCat.maxAda != null && Number(amount) > selectedCat.maxAda) ? 'font-medium text-red-600' : 'text-neutral-600 dark:text-neutral-400'}>
                  {tr('Allowed ask for')} “{selectedCat.name}”: {selectedCat.minAda != null ? `${tr('min')} ${selectedCat.minAda.toLocaleString()} ₳` : tr('no min')} · {selectedCat.maxAda != null ? `${tr('max')} ${selectedCat.maxAda.toLocaleString()} ₳` : tr('no max')}
                </div>
              ) : null}
              {selectedCat.conditions ? <div className="mt-0.5 whitespace-pre-wrap text-neutral-500">{tr('Conditions:')} {selectedCat.conditions}</div> : null}
            </div>
          ) : null}
          <MarkdownEditor
            value={content}
            onChange={setContent}
            title={tr('Pitch / summary')}
            subtitle={tr('What are you proposing to build, and why? Who is it for, what does it solve, and what makes it the right project at the right time?')}
            placeholder={tr("What you'll build and why (markdown)")}
            minRows={5}
            required
            minWords={minWords}
            maxWords={maxWords}
            showShortfall={triedSubmit}
          />
          {/* §3.4 — additional optional context, collapsed by default to keep the form short. */}
          <MarkdownEditor
            value={ecosystemImpact}
            onChange={setEcosystemImpact}
            title={tr('Expected ecosystem impact')}
            subtitle={tr('What specific benefit will the project have for the ecosystem? Who will the result serve, what problem does it solve and why should it be funded from community funds?')}
            placeholder={tr('Who benefits, what changes — short-term and longer-term.')}
            minRows={3}
            defaultCollapsed={!ecosystemImpact.trim()}
            minWords={minWords}
            maxWords={maxWords}
            showShortfall={triedSubmit}
          />
          <MarkdownEditor
            value={successMetrics}
            onChange={setSuccessMetrics}
            title={tr('Success metrics / KPIs')}
            subtitle={tr('What measurable indicators will you use to evaluate the success of the project? Specify the target values, time frame and method of verification.')}
            placeholder={tr('e.g. number of users, txs, integrations, on-chain volume — with targets where you can.')}
            minRows={3}
            defaultCollapsed={!successMetrics.trim()}
            minWords={minWords}
            maxWords={maxWords}
            showShortfall={triedSubmit}
          />
          <div>
            <div className="text-sm font-medium">{tr('Milestones (budgets must sum to requested)')}</div>
            <div className="mt-1 space-y-2">
              {ms.map((m, i) => {
                const set = (patch: Partial<ProposalMilestoneInput>) =>
                  setMs((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-500">{tr('Milestone')} {i + 1}</span>
                      {ms.length > 1 ? (
                        <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setMs((p) => p.filter((_, j) => j !== i))}>{tr('remove')}</button>
                      ) : null}
                    </div>
                    {/* 1. Title · 2. Requested budget (right below the title) · 3. Description · 4. Acceptance criteria */}
                    <div className="mt-1 flex flex-wrap items-end gap-2">
                      <label className="flex-1">
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{tr('Title')}{msTitleHint(m.title ?? '')}</span>
                        <input className={`${field} mt-0.5 w-full ${triedSubmit && wc(m.title ?? '') < minMsTitleWords ? 'border-red-400 dark:border-red-700' : ''}`} placeholder={tr('Milestone title')} value={m.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
                      </label>
                      <label>
                        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{tr('Requested budget (₳)')}</span>
                        <input type="number" className={`${field} mt-0.5 w-32`} value={m.amountAda} onChange={(e) => set({ amountAda: Number(e.target.value) })} />
                      </label>
                    </div>
                    <div className="mt-2">
                      <MarkdownEditor value={m.description} onChange={(v) => set({ description: v })} title={tr('Description')} placeholder={tr('What is delivered in this milestone')} minRows={3} required minWords={minWords} maxWords={maxWords} showShortfall={triedSubmit} />
                    </div>
                    <div className="mt-2">
                      <MarkdownEditor value={m.acceptanceCriteria ?? ''} onChange={(v) => set({ acceptanceCriteria: v })} title={tr('Acceptance criteria')} hint={tr('how completion is judged')} placeholder={tr('How completion will be verified')} minRows={3} defaultCollapsed={!(m.acceptanceCriteria ?? '').trim()} minWords={minWords} maxWords={maxWords} showShortfall={triedSubmit} />
                    </div>
                  </div>
                );
              })}
            </div>
            <button type="button" className="mt-1 text-xs underline" onClick={() => setMs((p) => [...p, { title: '', description: '', acceptanceCriteria: '', amountAda: 0 }])}>{tr('+ add milestone')}</button>
            {/* Live milestone-budget check — must equal the requested amount. */}
            <div className={`mt-1 text-xs ${milestonesMatch ? 'text-emerald-600' : 'font-medium text-red-600'}`}>
              {milestonesMatch
                ? `✓ ${tr('Milestones sum to')} ${msSum.toLocaleString()} ${tr('₳ (matches requested).')}`
                : `⚠ ${tr('Milestones sum to')} ${msSum.toLocaleString()} ${tr('₳ but the requested amount is')} ${Number(amount).toLocaleString()} ${tr('₳ — they must be equal (off by')} ${Math.abs(msSum - Number(amount)).toLocaleString()} ₳).`}
            </div>
          </div>
          {/* §3.4 — funding-specific detail (all optional, collapsed by default to keep the form short). */}
          <MarkdownEditor value={costBreakdown} onChange={setCostBreakdown} title={tr('Cost breakdown')} hint={tr('how the budget is spent')} placeholder={tr('How the budget is spent')} minRows={3} defaultCollapsed={!costBreakdown.trim()} minWords={minWords} maxWords={maxWords} showShortfall={triedSubmit} />
          <MarkdownEditor value={teamInfo} onChange={setTeamInfo} title={tr('Team info')} hint={tr('who is delivering this')} placeholder={tr("Who is delivering this, and why you're best suited")} minRows={3} defaultCollapsed={!teamInfo.trim()} minWords={minWords} maxWords={maxWords} showShortfall={triedSubmit} />
          <RevenueSharingBlock
            required={revenueSharingRequired}
            onRequiredChange={setRevenueSharingRequired}
            text={revenueSharing}
            onTextChange={setRevenueSharing}
            pledgeAddress={cfg?.pledgeAddress ?? null}
          />
          {/* §3 — optional refundable pledge. Only shown when the round's threshold > 0.
              Team opts in; amount must be ≥ threshold; return-method description is required.
              The actual on-chain payment happens later in FUNDING (after approval). */}
          {(roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda) > 0 ? (
            <PledgeSection
              minAda={roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda}
              enabled={pledgeEnabled}
              amount={pledgeAmount}
              returnMethod={pledgeReturnMethod}
              onEnabled={(v) => {
                setPledgeEnabled(v);
                if (v && !pledgeAmount) setPledgeAmount(roundSettings?.pledgeThresholdAda ?? ROUND_SETTING_DEFAULTS.pledgeThresholdAda);
              }}
              onAmount={setPledgeAmount}
              onReturnMethod={setPledgeReturnMethod}
            />
          ) : null}
          {/* §5.3/§7.1 — expertise tags drive which DReps are drawn to filter this proposal. */}
          <div>
            <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{tr('Expertise areas (helps match filtering reviewers)')}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DEFAULT_SUBCATEGORIES.map((s) => {
                const on = subcatIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSubcatIds((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'border-neutral-300 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700'}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Cardano address the submitter receives funds at — fee refunds + the budget payout if funded. */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
            <label className="block">
              <span className="text-xs font-medium text-blue-900 dark:text-blue-200">{tr('Payout / refund address (Cardano)')}</span>
              <input className={`${field} mt-0.5 w-full font-mono text-xs`} placeholder={tr('addr_test1… — where the DAO sends refunds and the funded budget')} value={payoutAddress} onChange={(e) => setPayoutAddress(e.target.value)} />
            </label>
            {/* §3 — live validity + own-wallet check. A foreign address is allowed, just flagged. */}
            {payoutAddress.trim() && addrCheck ? (
              !addrCheck.valid ? (
                <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{tr('✗ Not a valid Cardano address.')}</p>
              ) : !addrCheck.networkOk ? (
                <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{tr('✗ Valid address, but on the wrong network for this platform.')}</p>
              ) : addrCheck.mine ? (
                <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{tr('✓ Valid · your own wallet (same stake key as your login).')}</p>
              ) : (
                <p className="mt-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">{tr('✓ Valid · a different wallet than your login')}{addrCheck.hasStakePart ? '' : tr(' (no stake part)')} {tr('— that’s allowed, just double-check it’s yours.')}</p>
              )
            ) : null}
          </div>
          {/* §12/§16 — the fee + tx field appear only when the round charges a fee for this
              proposal type. When it's 0% (e.g. open-source), no payment is needed at all. */}
          {feeRequired ? (
            <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <div className="text-xs text-blue-900 dark:text-blue-200">
                <div>
                  {tr('Submission fee:')} <strong>{feePct}% ({commercial ? tr('commercial') : tr('open-source')})</strong> {tr('of the requested amount ≈')} <strong>{feeEstimate.toLocaleString()} ₳</strong>. {tr('To')} <strong>{tr('submit')}</strong>, {tr('pay it to the address below and paste the transaction hash; the platform verifies it on-chain and a board member confirms.')}
                </div>
                {cfg?.submissionFeeAddress ? (
                  <div className="mt-1 flex items-start gap-2">
                    <div className="flex-1 break-all font-mono text-[11px] text-blue-700/80 dark:text-blue-300/80">{cfg.submissionFeeAddress}</div>
                    <CopyButton text={cfg.submissionFeeAddress} label={tr('Copy address')} />
                  </div>
                ) : null}
              </div>

              {/* §12 — every fee-payment tx already submitted, locked + with its on-chain amount.
                  A partial payment leaves the earlier hashes here and clears the input below for
                  the next tx, so several hashes accumulate. */}
              {feeVerification && feeVerification.txs.length > 0 ? <FeePaymentsList fv={feeVerification} /> : null}

              {/* TX hash input + Verify button. Cardano tx hashes are 32-byte
                  blake2b → 64 hex chars; we validate the format inline (whitespace
                  / wrong length / non-hex chars get a clear message) before the
                  button is enabled. Verify auto-saves the draft first if needed
                  (so the hash is persisted + added to the cumulative tally) and
                  re-fires automatically when the user pastes a fresh valid-looking
                  hash. Hidden once the on-chain total covers the fee. */}
              {!feeVerification?.fullyPaid ? (
                <FeeTxInput
                  fee={fee}
                  // Keep the prior result (and the submitted-hash list) visible while the next
                  // hash is being typed; Verify (manual or auto) refreshes it.
                  onChange={(v) => setFee(v)}
                  locked={false}
                  verifying={verifying}
                  hasResult={feeVerification !== null}
                  onVerify={async () => {
                    const trimmed = fee.trim();
                    if (!/^[0-9a-f]{64}$/i.test(trimmed)) return; // safety; button disabled anyway
                    setVerifying(true); setError(null);
                    try {
                      // Auto-save the draft if we don't have one yet — Verify is most
                      // useful BEFORE the team submits, so the cost of an extra
                      // create+update is fine for the UX win.
                      let id = editingId;
                      if (!id) {
                        if (!draftReady) {
                          setError(tr('Fill in the proposal fields above first — the hash is recorded with the saved draft.'));
                          return;
                        }
                        const created = await proposalsApi.create({ ...buildInput(), submissionFeeTxHash: trimmed });
                        id = created.id;
                        setEditingId(id);
                        setEditingStatus(created.status);
                      } else {
                        await proposalsApi.update(id, { submissionFeeTxHash: trimmed });
                      }
                      const v = await proposalsApi.verifyFee(id);
                      setFeeVerification(v);
                      // This hash was recorded + counted but the fee isn't covered yet → clear the
                      // box so the submitter pastes the NEXT tx's hash (the old one stays in the list).
                      const thisTx = v.txs.find((t) => t.hash.toLowerCase() === trimmed.toLowerCase());
                      if (!v.fullyPaid && thisTx?.found && thisTx.koiosAvailable && thisTx.paidAda > 0) {
                        setFee('');
                      }
                    } catch (e) {
                      setError(e instanceof Error ? e.message : tr('verification failed'));
                    } finally {
                      setVerifying(false);
                    }
                  }}
                />
              ) : null}
              {feeVerification ? (
                <div
                  className={`rounded border p-2 text-xs ${
                    feeVerification.fullyPaid
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : !feeVerification.koiosAvailable
                        ? 'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
                        : feeVerification.paidAda > 0
                          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                          : 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
                  }`}
                >
                  {feeVerification.fullyPaid ? (
                    <span>
                      <strong>{tr('✓ Fully paid')}</strong> — {feeVerification.paidAda.toLocaleString()} {tr('₳ received at the fee address (required')} {feeVerification.requiredAda.toLocaleString()} {tr('₳). You can now submit.')}
                    </span>
                  ) : !feeVerification.koiosAvailable ? (
                    <span>
                      <strong>{tr('⚠ Couldn’t reach the chain right now')}</strong> {tr('— Koios is throttling our requests. Your hash is saved; the platform will keep retrying every ~10 s and the answer will appear here as soon as it gets through. (This is an external service issue, not a problem with your tx.)')}
                    </span>
                  ) : feeVerification.paidAda > 0 ? (
                    <span>
                      <strong>{tr('Partial payment:')}</strong> {feeVerification.paidAda.toLocaleString()} {tr('₳ received,')}{' '}
                      <strong>{feeVerification.missingAda.toLocaleString()} {tr('₳ still missing')}</strong>{' '}
                      ({tr('required')} {feeVerification.requiredAda.toLocaleString()} ₳).{' '}
                      {tr('Send the rest in a new tx and paste the new hash in the box above — every tx is counted.')}
                    </span>
                  ) : feeVerification.txs.every((t) => t.koiosAvailable && !t.found) ? (
                    <span>{tr('✗ The tx hash wasn’t found on-chain yet. The platform re-checks every ~10 s — leave the form open and the answer will update as soon as the next block lands.')}</span>
                  ) : (
                    <span>{tr('✗ This tx didn’t pay the fee address. Did you send to the right address?')}</span>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              {tr('No submission fee for')} {commercial ? tr('commercial') : tr('open-source')} {tr('proposals in this round — your proposal goes')} <strong>{tr('live immediately')}</strong> {tr('when you submit (no payment, no board fee confirmation).')}
            </div>
          )}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {/* §3 — live word-count summary (recomputed each render, so it shrinks as
              the user fills fields). Shown only after a submit attempt. */}
          {triedSubmit && (shortFields.length > 0 || overFields.length > 0) ? (
            <div className="text-sm text-red-600">
              {shortFields.length > 0 ? (
                <div>{tr('Each mandatory field needs at least')} {minWords} {minWords === 1 ? tr('word') : tr('words')}. {tr('Still too short:')} {shortFields.map(([l, t]) => `${l} (${wc(t)}/${minWords})`).join(', ')}.</div>
              ) : null}
              {overFields.length > 0 ? (
                <div>{tr('Each mandatory field allows at most')} {maxWords} {tr('words. Too long:')} {overFields.map(([l, t]) => `${l} (${wc(t)}/${maxWords})`).join(', ')}.</div>
              ) : null}
            </div>
          ) : null}
          {/* What's still missing before this can be saved/submitted (so a disabled button is never a mystery). */}
          {!draftReady ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="font-medium">{tr('Still needed before you can save the draft (and submit):')}</div>
              <ul className="mt-0.5 list-disc pl-4">
                {draftMissing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : submitMissing.length > 0 ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="font-medium">{tr('Ready to save as a draft. Still needed before you can')} <strong>{tr('submit')}</strong>:</div>
              <ul className="mt-0.5 list-disc pl-4">
                {submitMissing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* §3 — privacy + the two ways out of the form. */}
          <p className="text-xs text-neutral-500">
            <strong>{tr('Drafts are private')}</strong> {tr('— visible only to you, not to DReps or the board. A proposal becomes public only after you submit and a board member confirms the fee.')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {editingStatus === 'PENDING' ? (
              // Already submitted — only save the edits (re-submitting isn't meaningful).
              <button type="button" onClick={saveDraft} disabled={busy || !draftReady} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? tr('Working…') : tr('Save changes')}
              </button>
            ) : (
              <>
                <button
                  type="submit"
                  disabled={busy || !submitReady}
                  title={submitMissing.length > 0 ? `${tr('Still needed:')} ${submitMissing.join(' · ')}` : undefined}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? tr('Working…') : editingStatus === 'REJECTED' ? tr('Re-submit') : feeRequired ? tr('Submit') : tr('Submit (no fee)')}
                </button>
                <button type="button" onClick={saveDraft} disabled={busy || !draftReady} className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800">
                  {editingStatus === 'REJECTED' ? tr('Save changes') : tr('Save Draft')}
                </button>
              </>
            )}
          </div>
        </form>
        </MarkdownCollapseContext.Provider>
      ) : null}

      {mine.length > 0 ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{tr('My proposals')}</div>
            {/* §10 — Funding vs Internal split (with counts). Only shown when the user actually has
                internal proposals; a submitter who isn't a DRep can only have funding ones, so they
                never see (or need) this filter. Empty tabs are disabled. */}
            {internalMine.length > 0 ? (
              <div className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700">
                {([['FUNDING', tr('Funding'), fundingMine.length], ['INTERNAL', tr('Internal'), internalMine.length]] as const).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setMyTab(key)}
                    disabled={count === 0}
                    className={`px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                      myTab === key
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-neutral-600 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {label} ({count})
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="text-xs text-neutral-500">
            {myTab === 'FUNDING'
              ? tr('Drafts are private. Open one to read/edit it; submit a draft when you’re ready (pay the fee + paste the tx).')
              : tr('Your DAO-governance internal proposals. Open one in the Internal proposals tab.')}
          </p>
          <ul className="mt-1 space-y-1 text-sm">
            {myTab === 'FUNDING'
              // Hide the proposal currently open in the editor above (avoids a confusing duplicate).
              ? fundingMine.filter((p) => p.id !== editingId).map((p) => (
                  <MineRow
                    key={p.id}
                    p={p}
                    feeAddress={cfg?.submissionFeeAddress ?? undefined}
                    onOpen={() => { setOpenInEditMode(false); setOpenId(p.id); }}
                    onEdit={() => startEdit(p.id)}
                    onDetailEdit={() => { setOpenInEditMode(true); setOpenId(p.id); }}
                    onSubmitted={loadMine}
                  />
                ))
              : internalMine.map((p) => (
                  <InternalMineRow key={p.id} p={p} onOpen={() => setParams({ tab: 'internal', ip: p.id })} />
                ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * §12 — every submission-fee tx already submitted, locked + with its on-chain amount, plus the
 * running total vs. the required fee. Shared by the create form and the inline submit panel.
 */
function FeePaymentsList({ fv }: { fv: FeeVerification }) {
  const tr = useT();
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300">{tr('Submitted fee payments')}</div>
      {fv.txs.map((t) => (
        <div key={t.hash} className="flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-white/70 px-2 py-1 text-[11px] dark:border-blue-900 dark:bg-neutral-900/50">
          <span className="flex-1 break-all font-mono text-neutral-600 dark:text-neutral-400">{t.hash}</span>
          <span className={t.paidAda > 0 ? 'whitespace-nowrap font-medium text-emerald-700 dark:text-emerald-400' : 'whitespace-nowrap text-neutral-500'}>
            {!t.koiosAvailable ? tr('chain check failed') : t.paidAda > 0 ? `${t.paidAda.toLocaleString()} ${tr('₳ paid')}` : t.found ? tr('0 ₳ to fee address') : tr('not found yet')}
          </span>
        </div>
      ))}
      <div className="text-[11px] text-blue-900 dark:text-blue-200">
        {tr('Total:')} <strong>{fv.paidAda.toLocaleString()} ₳</strong> {tr('of')} {fv.requiredAda.toLocaleString()} ₳
        {fv.fullyPaid ? tr(' — fully paid ✓') : ` · ${fv.missingAda.toLocaleString()} ${tr('₳ still missing')}`}
      </div>
    </div>
  );
}

/** A row in "My proposals" → Internal tab. Internal proposals aren't about a budget, so no ADA is
 *  shown — except an internal SPENDING proposal, whose treasury payout is meaningful. Opening one
 *  jumps to the Internal proposals tab, where its full detail + voting live. */
function InternalMineRow({ p, onOpen }: { p: ProposalSummary; onOpen: () => void }) {
  const amount = p.internalType === 'SPENDING' && p.spendingAmountAda != null ? p.spendingAmountAda : null;
  return (
    <li className="rounded border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button onClick={onOpen} className="flex-1 text-left hover:underline">
          <span>
            {p.title}
            {amount != null ? <span className="font-semibold text-blue-600 dark:text-blue-400"> · {amount.toLocaleString()} ₳</span> : null}
          </span>
        </button>
        <span className={`text-xs ${p.status === 'REJECTED' ? 'font-medium text-red-600' : p.status === 'APPROVED' ? 'text-emerald-600' : 'text-neutral-500'}`}>
          {p.status}
        </span>
      </div>
    </li>
  );
}

/** A row in "My proposals": open it, plus an inline Submit for DRAFTs (submit later). */
function MineRow({
  p,
  feeAddress,
  onOpen,
  onEdit,
  onDetailEdit,
  onSubmitted,
}: {
  p: ProposalSummary;
  feeAddress?: string;
  onOpen: () => void;
  // Pre-public proposals: jump straight into the full create-form for editing.
  onEdit: () => void;
  // Post-public proposals (FILTERING / DEBATE_VOTE): open ProposalDetail with the
  // inline EditSection already expanded — saves the user from clicking "Edit
  // proposal" a second time after the detail opens.
  onDetailEdit: () => void;
  onSubmitted: () => void;
}) {
  const tr = useT();
  const [submitting, setSubmitting] = useState(false);
  const [fee, setFee] = useState(p.submissionFeeTxHash ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // §3 — on-chain fee status for this draft (checked when the panel opens / on Verify).
  const [fv, setFv] = useState<FeeVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  const isDraft = p.status === 'DRAFT';
  const feeHexOk = /^[0-9a-f]{64}$/i.test(fee.trim());
  const feePaid = fv?.fullyPaid === true;
  const noFee = fv != null && fv.requiredAda === 0;

  // When the submit panel opens with a saved hash, auto-check the chain so the
  // user sees "already paid" instead of being asked to pay again.
  useEffect(() => {
    if (!submitting || !feeHexOk) { return; }
    let alive = true;
    setVerifying(true);
    proposalsApi.verifyFee(p.id).then((v) => {
      if (!alive) return;
      setFv(v);
      // The saved hash is already counted toward a partial total → empty the box: the user
      // must paste the NEXT tx's hash, not re-enter the one already recorded.
      if (!v.fullyPaid && v.paidAda > 0) setFee('');
    }).catch(() => {}).finally(() => { if (alive) setVerifying(false); });
    return () => { alive = false; };
    // Only on open (not on every keystroke); the Verify button re-checks after edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting]);

  const verify = async () => {
    const trimmed = fee.trim();
    if (!/^[0-9a-f]{64}$/i.test(trimmed)) return;
    setVerifying(true); setError(null);
    try {
      await proposalsApi.update(p.id, { submissionFeeTxHash: trimmed });
      const v = await proposalsApi.verifyFee(p.id);
      setFv(v);
      // §12 — this tx was recorded + counted but the fee isn't covered yet → clear the box so the
      // submitter pastes the NEXT tx's hash (the earlier ones stay in the list above).
      const thisTx = v.txs.find((t) => t.hash.toLowerCase() === trimmed.toLowerCase());
      if (!v.fullyPaid && thisTx?.found && thisTx.koiosAvailable && thisTx.paidAda > 0) setFee('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('verification failed'));
    } finally {
      setVerifying(false);
    }
  };
  // A fee/admission rejection (stage null, never finalised) is still editable + resubmittable. A
  // Debate & Vote rejection ALSO has stage null but has a finalised result — editing is closed for
  // it (Debate is the last editable stage), so `resultFinalizedAt` is the discriminator.
  const feeRejected = p.status === 'REJECTED' && !p.stage && !p.resultFinalizedAt;
  // Pre-public (DRAFT/PENDING/fee-rejected) → edit ALL fields in the full form.
  const fullFormEdit = isDraft || p.status === 'PENDING' || feeRejected;
  // §6/§8 — editing closes once the round reaches VOTE: Debate is the LAST editable stage. The
  // detail editor is offered only while the round is still in SUBMISSION (polish) or DEBATE
  // (revise), or in the post-filtering-rejection resubmit cycle — never in VOTE / FUNDING / CLOSED.
  // Mirrors the backend ownEditable gate, so the button never appears when a save would be rejected.
  const detailEdit = !fullFormEdit && (
    (p.roundStatus === 'SUBMISSION' && p.status === 'ACTIVE' && p.stage === 'FILTERING') ||
    (p.roundStatus === 'DEBATE' && p.status === 'ACTIVE' && p.stage === 'DEBATE_VOTE') ||
    (p.status === 'REJECTED' && p.stage === 'FILTERING' && p.roundStatus === 'FILTERING')
  );

  const submit = async () => {
    setError(null);
    // No client-side fee check: the backend requires a tx only when this proposal's fee > 0
    // (a 0% / open-source proposal submits with no tx and goes live immediately).
    setBusy(true);
    try {
      await proposalsApi.submit(p.id, fee.trim());
      setSubmitting(false);
      setFee('');
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('submit failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button onClick={onOpen} className="flex-1 text-left hover:underline">
          <span>{p.title} <span className="font-semibold text-blue-600 dark:text-blue-400">· {p.requestedAmountAda.toLocaleString()} ₳</span></span>
        </button>
        <span className="flex items-center gap-2">
          <span className={`text-xs ${p.status === 'REJECTED' ? 'font-medium text-red-600' : isDraft ? 'text-amber-600' : 'text-neutral-500'}`}>
            {p.status}{p.stage ? ` · ${p.stage}` : ''}{isDraft ? ` · ${tr('private')}` : ''}
          </span>
          {p.progress ? (
            <>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tinyToneCls(p.progress.tone)}`}
                title={p.progress.label}
              >
                {p.progress.label}
              </span>
              {p.progress.extra ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tinyToneCls(p.progress.extra.tone)}`}
                  title={p.progress.extra.label}
                >
                  {p.progress.extra.label}
                </span>
              ) : null}
            </>
          ) : null}
          {fullFormEdit ? (
            <>
              <button onClick={onEdit} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800">
                {tr('Edit')}
              </button>
              {isDraft ? (
                <button onClick={() => setSubmitting((v) => !v)} className="rounded border border-emerald-500 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950">
                  {submitting ? tr('Close') : tr('Submit')}
                </button>
              ) : null}
            </>
          ) : detailEdit ? (
            <button onClick={onDetailEdit} className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800">
              {tr('Edit')}
            </button>
          ) : null}
        </span>
      </div>
      {isDraft && submitting ? (
        <div className="space-y-1.5 border-t border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950/30">
          {feePaid || noFee ? (
            // §3 — fee already settled: confirm it (green) + show the payments, submit.
            <>
              <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {noFee ? (
                  <span><strong>{tr('✓ No submission fee')}</strong> {tr('for this proposal — you can submit it directly.')}</span>
                ) : (
                  <span><strong>{tr('✓ Submission fee paid')}</strong> — {fv!.paidAda.toLocaleString()} {tr('₳ received at the fee address (required')} {fv!.requiredAda.toLocaleString()} {tr('₳). You can submit.')}</span>
                )}
              </div>
              {!noFee && fv ? <FeePaymentsList fv={fv} /> : null}
              <button onClick={submit} disabled={busy} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy ? tr('Submitting…') : tr('Submit')}
              </button>
            </>
          ) : (
            // §3 — fee not paid yet: pay → paste hash → verify on-chain. A partial payment leaves
            // the earlier hashes in the list and clears the box for the next tx → repeat → submit.
            <>
              <div className="text-blue-900 dark:text-blue-200">
                {tr('Pay the submission fee on-chain to the address below, paste the transaction hash, and verify it. A board member then confirms.')}
              </div>
              {feeAddress ? (
                <div className="flex items-start gap-2">
                  <div className="flex-1 break-all font-mono text-[11px] text-blue-700/80 dark:text-blue-300/80">{feeAddress}</div>
                  <CopyButton text={feeAddress} label={tr('Copy address')} />
                </div>
              ) : null}
              {fv && fv.txs.length > 0 ? <FeePaymentsList fv={fv} /> : null}
              <label className="block">
                <span className="text-blue-900 dark:text-blue-200">{tr('Submission fee transaction hash')}{fv && fv.paidAda > 0 ? tr(' (next payment)') : ''}</span>
                <input className={`${field} mt-0.5 w-full`} placeholder={tr('64-character on-chain tx hash')} value={fee} onChange={(e) => setFee(e.target.value)} />
              </label>
              {/* Verify result (partial / not found / chain unreachable). */}
              {fv && !fv.fullyPaid ? (
                <div className={`rounded border p-1.5 ${!fv.koiosAvailable ? 'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300' : fv.paidAda > 0 ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'}`}>
                  {!fv.koiosAvailable ? tr('Couldn’t reach the chain — the platform keeps retrying; check back shortly.')
                    : fv.paidAda > 0 ? `${tr('Partial:')} ${fv.paidAda.toLocaleString()} ${tr('₳ received,')} ${fv.missingAda.toLocaleString()} ${tr('₳ still missing (required')} ${fv.requiredAda.toLocaleString()} ${tr('₳). Send the rest in a new tx and paste the new hash above.')}`
                      : tr('Not found / didn’t pay the fee address yet — re-checks every ~10 s.')}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={verify} disabled={verifying || !feeHexOk} className="rounded border border-emerald-500 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950">
                  {verifying ? tr('Verifying…') : tr('Verify on-chain')}
                </button>
                <button onClick={submit} disabled={busy} className="rounded bg-emerald-600 px-3 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busy ? tr('Submitting…') : tr('Submit')}
                </button>
              </div>
            </>
          )}
          {error ? <div className="text-red-600">{error}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * §3 — optional pledge UI: checkbox + amount + collapsible return-method markdown.
 * Off by default; only rendered when the round's `pledgeThresholdAda > 0`. When the
 * checkbox is on, the amount input is shown (with the round minimum as placeholder)
 * and a MarkdownEditor for "how will the pledge be returned" (per-milestone /
 * after final milestone / etc.) — collapsible to match the rest of the form.
 */
function PledgeSection({
  minAda,
  enabled,
  amount,
  returnMethod,
  onEnabled,
  onAmount,
  onReturnMethod,
}: {
  minAda: number;
  enabled: boolean;
  amount: number;
  returnMethod: string;
  onEnabled: (v: boolean) => void;
  onAmount: (v: number) => void;
  onReturnMethod: (v: string) => void;
}) {
  const t = useT();
  const field = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  return (
    <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => onEnabled(e.target.checked)} />
        <span className="font-medium">{t('Skin in the game (refundable pledge — optional)')}</span>
        <span className="text-xs text-neutral-500">— {t('minimum')} {minAda.toLocaleString()} ₳ ({t('round setting')})</span>
      </label>
      {enabled ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              {t('Pledge')} ₳
              <input
                type="number"
                className={`${field} w-32`}
                min={minAda}
                value={amount || ''}
                placeholder={String(minAda)}
                onChange={(e) => onAmount(Number(e.target.value))}
              />
            </label>
            {amount > 0 && amount < minAda ? (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                {t('Below round minimum')} ({minAda.toLocaleString()} ₳)
              </span>
            ) : amount >= minAda ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {t('Meets minimum')}
              </span>
            ) : null}
          </div>
          <MarkdownEditor
            value={returnMethod}
            onChange={onReturnMethod}
            title={t('Pledge return method')}
            subtitle={t('How and when will the pledge be returned? Common patterns: a slice with each milestone, or the full amount only after the final milestone. The team may propose another scheme — describe it here.')}
            placeholder={t('Example: 25% returned after milestone 1, 25% after milestone 2, the rest after the final milestone.')}
            minRows={3}
            defaultCollapsed={!returnMethod.trim()}
            required
          />
          <div className="text-[11px] text-neutral-500">
            {t('You commit here. The pledge is paid on-chain')} <strong>{t('after')}</strong> {t('the proposal is approved (FUNDING stage): the platform shows the pledge address + you paste the tx hash, a board member confirms it. While unpaid/unconfirmed the proposal stays')} <strong>PENDING</strong> {t('and milestone POAs are blocked.')}
          </div>
        </div>
      ) : (
        <div className="mt-1 text-xs text-neutral-500">
          {t('No pledge by default. If you opt in, you commit here and pay on-chain later in the FUNDING stage.')}
        </div>
      )}
    </div>
  );
}

/**
 * §12 — submission-fee tx-hash input with inline format validation + auto-verify.
 *
 * A Cardano tx hash is the 32-byte blake2b digest of the tx body, i.e. exactly
 * 64 hex characters. We surface the format issue inline so the user doesn't
 * click Verify and wait for a roundtrip just to learn they pasted whitespace:
 *   - empty            → neutral helper "paste your fee-payment tx hash"
 *   - whitespace       → "remove the leading/trailing whitespace"
 *   - wrong length     → "X chars (need 64)"
 *   - non-hex chars    → "contains non-hex characters"
 *   - 64 hex chars     → "✓ looks like a valid tx hash" + Verify enabled
 *
 * Once the format is valid AND the user pauses typing for ~700 ms, the
 * on-chain check fires automatically (the user said "even if user does not
 * click the button explicitly, the on-chain check could be automatic").
 * Clicking Verify still works to retry immediately.
 */
function FeeTxInput({
  fee,
  onChange,
  locked,
  verifying,
  hasResult,
  onVerify,
}: {
  fee: string;
  onChange: (v: string) => void;
  locked: boolean;
  verifying: boolean;
  /** True when feeVerification is set for the current hash — used to skip the
   *  first-paste 700 ms auto-verify and switch to the 10 s polling cadence. */
  hasResult: boolean;
  onVerify: () => Promise<void> | void;
}) {
  const tr = useT();
  const fld = 'rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';
  const trimmed = fee.trim();
  const validFormat = /^[0-9a-f]{64}$/i.test(trimmed);
  let hint: { text: string; tone: 'neutral' | 'red' | 'emerald' } | null = null;
  if (locked) {
    hint = { text: tr('✓ fully paid — locked'), tone: 'emerald' };
  } else if (verifying) {
    hint = { text: tr('verifying on-chain…'), tone: 'neutral' };
  } else if (fee.length === 0) {
    hint = { text: tr('Paste your fee-payment tx hash (64 hex characters).'), tone: 'neutral' };
  } else if (fee !== trimmed) {
    hint = { text: tr('Remove the leading/trailing whitespace.'), tone: 'red' };
  } else if (/\s/.test(fee)) {
    hint = { text: tr('Tx hashes don\'t contain spaces — paste a single hex string.'), tone: 'red' };
  } else if (!/^[0-9a-fA-F]*$/.test(fee)) {
    hint = { text: tr('Contains non-hex characters — a tx hash is hex only (0-9, a-f).'), tone: 'red' };
  } else if (fee.length !== 64) {
    hint = { text: `${fee.length} ${tr('characters (need 64). Did the paste cut something off?')}`, tone: 'red' };
  } else if (validFormat) {
    hint = { text: tr('✓ looks like a valid tx hash — checking on-chain…'), tone: 'emerald' };
  }

  // Auto-verify cadence:
  //   - first time the hash becomes a valid 64-hex string AND we have no result
  //     yet → fire after ~700 ms (debounced; cancels on every keystroke so
  //     rapid typing doesn't queue extra calls).
  //   - once a result is in but the tx wasn't found yet (or Koios was
  //     unavailable) → re-check every 10 s. The user said ~block time, and
  //     Preprod/Mainnet block intervals are ~20 s so 10 s is one re-try per
  //     block on average.
  //   - stop when locked (fully paid).
  // The previous version re-fired on every state change because `verifying`
  // flipping false re-triggered the effect → infinite loop / "blinking".
  useEffect(() => {
    if (!validFormat || verifying || locked) return;
    const delay = hasResult ? 10_000 : 700;
    const t = setTimeout(() => { void onVerify(); }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, validFormat, verifying, locked, hasResult]);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-stretch gap-2">
        <input
          className={`${fld} flex-1 disabled:bg-emerald-50 disabled:text-emerald-700 dark:disabled:bg-emerald-950/30 dark:disabled:text-emerald-300`}
          placeholder={tr('Submission fee TX hash (64 hex chars — paste, the platform verifies it on-chain)')}
          value={fee}
          onChange={(e) => onChange(e.target.value)}
          disabled={locked}
        />
        <button
          type="button"
          disabled={verifying || locked || !validFormat}
          onClick={() => { void onVerify(); }}
          className="rounded-md border border-emerald-500 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950"
          title={
            locked ? tr('Already fully paid — the field is locked.')
              : validFormat ? tr('Re-check on-chain now (auto-fires shortly after paste).')
              : tr('A Cardano tx hash is 64 hex characters — fix the format first.')
          }
        >
          {verifying ? tr('Verifying…') : tr('Verify on-chain')}
        </button>
      </div>
      {hint ? (
        <div className={`text-[11px] ${
          hint.tone === 'red'
            ? 'text-red-600 dark:text-red-400'
            : hint.tone === 'emerald'
              ? 'text-emerald-700 dark:text-emerald-400'
              : 'text-neutral-500'
        }`}>
          {hint.text}
        </div>
      ) : null}
    </div>
  );
}

function tinyToneCls(tone: 'amber' | 'emerald' | 'neutral' | 'red'): string {
  switch (tone) {
    case 'emerald': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
    case 'red':     return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
    case 'amber':   return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200';
    default:        return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';
  }
}

/**
 * §3.4 — revenue sharing as a checkbox + conditional text. Ticking the box
 * signals the team will perform a one-off action (e.g. send 10% of token
 * supply to the Treasury) that the board must verify before milestone work
 * can begin post-approval. Renders the submission-fee address with a copy
 * button as the canonical "send things to the platform" target.
 */
export function RevenueSharingBlock({
  required,
  onRequiredChange,
  text,
  onTextChange,
  pledgeAddress,
}: {
  required: boolean;
  onRequiredChange: (v: boolean) => void;
  text: string;
  onTextChange: (v: string) => void;
  pledgeAddress: string | null;
}) {
  const t = useT();
  return (
    <div className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={required} onChange={(e) => onRequiredChange(e.target.checked)} />
        <span className="font-medium">{t('Revenue sharing')}</span>
        <span className="text-xs text-neutral-500">
          {t('— check this if your proposal involves a token contribution or other one-off action the board needs to verify before funding starts')}
        </span>
      </label>
      {required ? (
        <div className="mt-2 space-y-2">
          <MarkdownEditor
            value={text}
            onChange={onTextChange}
            title={t('Conditions')}
            subtitle={t('What will the team do, and by when? Example: send 10% of token supply to the DAO Treasury within 14 days of approval.')}
            placeholder={t('Describe the action and any verification details (tx hash, on-chain address, etc.)')}
            minRows={3}
          />
          {pledgeAddress ? (
            <div className="rounded border border-amber-200 bg-amber-50/60 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/30">
              <div className="text-amber-800 dark:text-amber-200">
                <strong>{t('Do not send anything now.')}</strong> {t('If this proposal is')} <strong>{t('approved')}</strong> {t('and you committed to sharing tokens, the team will be asked —')} <strong>{t('only after approval')}</strong>{t(', before funding starts — to send the tokens to the platform’s')} <strong>{t('Pledge')}</strong> {t('address below. Sending earlier won’t count.')}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 break-all font-mono text-[11px] text-amber-700/90 dark:text-amber-300/90">{pledgeAddress}</div>
                <CopyButton text={pledgeAddress} label={t('Copy address')} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
