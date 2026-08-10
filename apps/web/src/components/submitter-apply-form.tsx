'use client';

import { useEffect, useState } from 'react';
import { submitterApi, daoApi, type MySubmitter, type DaoMember } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { COUNTRIES } from '@/lib/countries';
import { ConfirmDialog } from './confirm-dialog';
import { MarkdownEditor } from './markdown';
import { resizeImageFile } from './photo-upload';

const MIN_WORDS = 100;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const inputCls = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** §2.1 — apply for the submitter role. The board approves/rejects; only then can you submit. */
export function SubmitterApplyForm({ onChange }: { onChange?: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  // §2 — the submitter profile is INDEPENDENT of the DAO-member / expert profile: it has its
  // own name, photo, country, etc. The member's display name is only used to PRE-FILL a brand-new
  // application as a convenience; it stays fully editable so a submitter can use a different name.
  const [mine, setMine] = useState<MySubmitter | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [githubs, setGithubs] = useState<string[]>([]);
  const [socials, setSocials] = useState<string[]>([]);
  // §2.1 — disclosure + contact.
  const [conflict, setConflict] = useState('');
  const [noSelfVote, setNoSelfVote] = useState(false);
  const [telegram, setTelegram] = useState('');
  const [prevFunding, setPrevFunding] = useState('');
  const [email, setEmail] = useState('');
  const [logo, setLogo] = useState('');
  const [country, setCountry] = useState('');
  // §2 — cross-wallet link to a DAO-member profile (the same entity on a different wallet).
  const [linkMember, setLinkMember] = useState(false);
  const [linkedDrepId, setLinkedDrepId] = useState('');
  const [daoMembers, setDaoMembers] = useState<DaoMember[]>([]);
  const [linkedDaoMember, setLinkedDaoMember] = useState<MySubmitter['linkedDaoMember']>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  // §2.1 — persistence consent (required to apply) + leave flow.
  const [agreePersist, setAgreePersist] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // §2 — dirty-check: when editing an existing record, Save is enabled only when something changed.
  // The baseline (savedSig) is pinned each time the record is (re)loaded; consent isn't a profile field.
  const sig = (f: { name: string; desc: string; githubs: string[]; socials: string[]; conflict: string; noSelfVote: boolean; telegram: string; prevFunding: string; email: string; logo: string; country: string; linkedDrepId: string }) =>
    JSON.stringify({ name: f.name.trim(), desc: f.desc.trim(), githubs: f.githubs.map((s) => s.trim()).filter(Boolean), socials: f.socials.map((s) => s.trim()).filter(Boolean), conflict: f.conflict.trim(), noSelfVote: f.noSelfVote, telegram: f.telegram.trim(), prevFunding: f.prevFunding.trim(), email: f.email.trim(), logo: f.logo, country: f.country, linkedDrepId: f.linkedDrepId });

  const load = () =>
    submitterApi.mine().then((m) => {
      setMine(m); setLoaded(true);
      if (m) {
        setName(m.displayName); setDesc(m.description); setGithubs(m.githubUrls ?? []);
        setSocials(m.socialLinks ?? []); setLogo(m.logoDataUrl ?? ''); setCountry(m.country);
        setConflict(m.conflictOfInterest ?? ''); setNoSelfVote(!!m.noSelfVotePledge);
        setTelegram(m.telegram ?? ''); setEmail(m.email ?? '');
        setPrevFunding(m.previousFunding ?? '');
        setLinkedDrepId(m.linkedDrepIdOnchain ?? '');
        setLinkMember(!!m.linkedDrepIdOnchain);
        setLinkedDaoMember(m.linkedDaoMember ?? null);
        setSavedSig(sig({ name: m.displayName, desc: m.description, githubs: m.githubUrls ?? [], socials: m.socialLinks ?? [], conflict: m.conflictOfInterest ?? '', noSelfVote: !!m.noSelfVotePledge, telegram: m.telegram ?? '', prevFunding: m.previousFunding ?? '', email: m.email ?? '', logo: m.logoDataUrl ?? '', country: m.country, linkedDrepId: m.linkedDrepIdOnchain ?? '' }));
      } else if (profile?.user.displayName) {
        // Convenience prefill for a NEW application — editable, fully independent.
        setName(profile.user.displayName);
      }
    }).catch(() => setLoaded(true));
  useEffect(() => { load(); }, []);
  // §2 — DAO members to choose from when declaring "I'm also a DAO member (different wallet)".
  useEffect(() => { daoApi.members().then(setDaoMembers).catch(() => setDaoMembers([])); }, []);

  const onFile = async (file: File) => {
    try {
      setLogo(await resizeImageFile(file));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not process the image.'));
    }
  };

  const words = wordCount(desc);
  // §2.1 — the 100-word minimum gates a NEW application the board reviews; an already-approved
  // member can update their profile with any non-empty description.
  const needsFullDesc = mine?.status !== 'APPROVED';
  const trimmedName = name.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const needsConsent = mine?.status !== 'APPROVED';
  const canSubmit = !!trimmedName && !!country && !!desc.trim() && !!conflict.trim() && !!telegram.trim() && emailOk && (!needsConsent || agreePersist) && (!needsFullDesc || words >= MIN_WORDS);
  // A new application (no saved baseline) always submits; an edit requires an actual change.
  const formSig = sig({ name, desc, githubs, socials, conflict, noSelfVote, telegram, prevFunding, email, logo, country, linkedDrepId: linkMember ? linkedDrepId : '' });
  const dirty = savedSig === null || formSig !== savedSig;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(null);
    if (!canSubmit) { setError(needsFullDesc ? t('Fill the required fields — the description needs at least 100 words.') : t('Fill the required fields.')); return; }
    const wasApproved = mine?.status === 'APPROVED';
    const wasExisting = !!mine;
    setBusy(true);
    try {
      await submitterApi.apply({
        displayName: trimmedName,
        description: desc.trim(),
        githubUrls: githubs.map((s) => s.trim()).filter(Boolean),
        socialLinks: socials.map((s) => s.trim()).filter(Boolean),
        conflictOfInterest: conflict.trim(),
        noSelfVotePledge: noSelfVote,
        telegram: telegram.trim(),
        email: email.trim(),
        previousFunding: prevFunding.trim(),
        logoDataUrl: logo || undefined,
        country,
        agreePersist,
        // §2 — link to a DAO-member profile (empty string clears it).
        linkedDrepIdOnchain: linkMember ? linkedDrepId : '',
      });
      await load();
      onChange?.();
      setSaved(wasApproved ? t('Profile updated.') : wasExisting ? t('Application updated — sent to the board for review.') : t('Application sent to the board for review.'));
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'failed'); } finally { setBusy(false); }
  };

  if (!loaded) return null;
  const approved = mine?.status === 'APPROVED';

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold">{mine ? t('Submitter profile') : t('Become a submitter')}</h3>
        {approved ? (
          <p className="text-sm text-emerald-600">{t('You are an approved submitter ✅ — submit proposals under')} <strong>{t('My proposals')}</strong>. {t('You can still update your profile below.')}</p>
        ) : mine?.status === 'PENDING' ? (
          <p className="text-sm text-amber-600">{t('Your application is under board review. You can update it below.')}</p>
        ) : mine?.status === 'LEFT' ? (
          <p className="text-sm text-neutral-500">{t('You left the platform')}{mine.leftAt ? ` ${t('on')} ${new Date(mine.leftAt).toLocaleDateString()}` : ''} {t('— your profile is kept in the history. You can re-apply below.')}</p>
        ) : mine?.status === 'REJECTED' ? (
          <div className="rounded border border-red-200 bg-red-50 p-2 text-sm dark:border-red-900 dark:bg-red-950/30">
            <div className="font-medium text-red-800 dark:text-red-200">{t('Application rejected')}</div>
            {mine.rejectionReason ? <div className="mt-1 whitespace-pre-wrap text-red-700 dark:text-red-300">{mine.rejectionReason}</div> : null}
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">{t('Edit the form below and re-apply.')}</div>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('Apply for the submitter role. Once a board member approves, you can submit proposals.')}</p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">{t('Display name')} <span className="text-red-500">*</span></span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className={`mt-1 ${inputCls}`} placeholder={t('Your name or project name')} />
          <p className="mt-1 text-[11px] text-neutral-500">{t('Independent from your DAO-member / expert profile — set whatever name you want shown as a submitter.')}</p>
        </label>

        <MarkdownEditor
          value={desc}
          onChange={setDesc}
          title={t('Description')}
          hint={needsFullDesc ? `${t('min 100 words —')} ${words}/100` : `${words} ${t('words')}`}
          subtitle={t('Who you are, what you build, your track record. Supports bold, italics, headers, lists.')}
          placeholder={t('Who you are, what you build, your track record…')}
          minRows={6}
          required
        />

        <label className="block">
          <span className="text-sm font-medium">{t('Country')} <span className="text-red-500">*</span></span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={`mt-1 ${inputCls}`}>
            <option value="">{t('— select a country —')}</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        {/* §2 — declare a DAO-member profile that is the SAME entity (possibly a different wallet). */}
        <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={linkMember} onChange={(e) => setLinkMember(e.target.checked)} className="mt-0.5" />
            <span>{t('I’m also a')} <strong>DAO member</strong> <span className="text-xs text-neutral-500">{t('(link my DAO-member profile — it may be on a different wallet)')}</span></span>
          </label>
          {linkMember ? (
            <select value={linkedDrepId} onChange={(e) => setLinkedDrepId(e.target.value)} className={`mt-2 ${inputCls}`}>
              <option value="">{t('— select your DAO-member profile —')}</option>
              {daoMembers.map((m) => <option key={m.drepId} value={m.drepId}>{m.displayName} — {m.drepId.slice(0, 16)}…</option>)}
            </select>
          ) : null}
          {linkedDaoMember ? (
            <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">{t('✓ Linked to DAO member')} <strong>{linkedDaoMember.name}</strong>{linkedDaoMember.crossWallet ? ` ${t('(different wallet)')}` : ''}.</p>
          ) : null}
        </div>

        <div>
          <span className="text-sm font-medium">{t('GitHub links')} <span className="text-xs font-normal text-neutral-500">{t('(optional)')}</span></span>
          <div className="mt-1 space-y-1">
            {githubs.map((g, i) => (
              <div key={i} className="flex gap-2">
                <input value={g} onChange={(e) => setGithubs((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))} maxLength={500} className={inputCls} placeholder="https://github.com/…" />
                <button type="button" onClick={() => setGithubs((arr) => arr.filter((_, idx) => idx !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setGithubs((arr) => [...arr, ''])} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">
              + {t('Add')} {githubs.length === 0 ? t('a GitHub link') : t('another link')}
            </button>
          </div>
        </div>

        {/* §2.1 — disclosure + contact (board may need to reach the team). */}
        <MarkdownEditor
          value={conflict}
          onChange={setConflict}
          title={t('Conflict of interest')}
          subtitle={t('Disclose everything related to a conflict of interest around approving funding (write "none" if you have none). Supports bold, italics, headers, lists.')}
          placeholder={t('e.g. I am affiliated with project X which competes for the same category…')}
          minRows={3}
          required
        />

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={noSelfVote} onChange={(e) => setNoSelfVote(e.target.checked)} className="mt-0.5" />
          <span>{t('I will not vote for my own proposal')} <span className="text-xs text-neutral-500">{t('(informative — optional)')}</span></span>
        </label>

        <MarkdownEditor
          value={prevFunding}
          onChange={setPrevFunding}
          title={t('Previous funding')}
          hint={t('optional — please keep it updated')}
          subtitle={t('List ALL previous funding you received in the Cardano ecosystem — Catalyst, Treasury Withdrawals, Builder DAO, or other funding vehicles. Update this regularly. Supports bold, italics, headers, lists.')}
          placeholder={t('e.g. Catalyst F11 — Project X, 50k ₳ (2024); Builder DAO grant — 10k ₳ (2025)…')}
          minRows={3}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">{t('Telegram')} <span className="text-red-500">*</span></span>
            <input value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={200} className={`mt-1 ${inputCls}`} placeholder="@handle" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('Email')} <span className="text-red-500">*</span></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} className={`mt-1 ${inputCls}`} placeholder="team@example.org" />
          </label>
        </div>

        <div>
          <span className="text-sm font-medium">{t('Social links')} <span className="text-xs font-normal text-neutral-500">{t('(optional)')}</span></span>
          <div className="mt-1 space-y-1">
            {socials.map((s, i) => (
              <div key={i} className="flex gap-2">
                <input value={s} onChange={(e) => setSocials((arr) => arr.map((v, idx) => (idx === i ? e.target.value : v)))} maxLength={500} className={inputCls} placeholder="https://…" />
                <button type="button" onClick={() => setSocials((arr) => arr.filter((_, idx) => idx !== i))} className="rounded border border-neutral-300 px-2 text-sm dark:border-neutral-700">✕</button>
              </div>
            ))}
            {/* Show "add" once there's a first link (or to add the first). After the first, more can be added. */}
            <button type="button" onClick={() => setSocials((arr) => [...arr, ''])} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700">
              + {t('Add')} {socials.length === 0 ? t('a social link') : t('another link')}
            </button>
          </div>
        </div>

        <div>
          <span className="text-sm font-medium">{t('Photo / project logo')} <span className="text-xs font-normal text-neutral-500">{t('(optional · up to 12 MB, resized to 640px)')}</span></span>
          <div className="mt-1 flex items-center gap-3">
            {logo ? <img src={logo} alt="logo" className="h-12 w-12 rounded object-cover" /> : null}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} className="text-xs" />
            {logo ? <button type="button" onClick={() => setLogo('')} className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">{t('Remove')}</button> : null}
          </div>
        </div>

        {error ? <div className="text-xs text-red-600">{error}</div> : null}
        {!canSubmit ? <div className="text-xs text-amber-600">{!trimmedName ? t('Display name is required. ') : ''}{!country ? t('Country is required. ') : ''}{!conflict.trim() ? t('Conflict-of-interest disclosure is required. ') : ''}{!telegram.trim() ? t('Telegram is required. ') : ''}{!emailOk ? t('A valid email is required. ') : ''}{needsConsent && !agreePersist ? t('You must agree to profile persistence. ') : ''}{!desc.trim() ? t('Description is required. ') : needsFullDesc && words < MIN_WORDS ? `${t('Description needs at least')} ${MIN_WORDS} ${t('words')} (${words}/${MIN_WORDS}).` : ''}</div> : null}
        {needsConsent ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agreePersist} onChange={(e) => setAgreePersist(e.target.checked)} className="mt-0.5" />
            <span>{t('I agree that the profile will be persisted by the platform')} <span className="text-red-500">*</span> <span className="text-xs text-neutral-500">{t('(it stays in the history even after leaving)')}</span></span>
          </label>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !dirty} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy ? t('Submitting…') : mine && mine.status !== 'REJECTED' ? t('Update application') : mine?.status === 'REJECTED' ? t('Re-apply') : t('Apply')}
          </button>
          {saved && !dirty ? <span className="text-xs font-medium text-emerald-600">✓ {saved}</span> : null}
        </div>
      </form>

      {approved ? (
        <div className="rounded border border-red-200 p-3 dark:border-red-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-neutral-500">{t('Deregister as a submitter. Your profile stays in the platform’s history.')}</p>
            <button onClick={() => { setLeaveError(null); setConfirmLeave(true); }} className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
              {t('Leave DAO')}
            </button>
          </div>
          {leaveError ? <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">⚠ {leaveError}</div> : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmLeave}
        title={t('Leave as a submitter?')}
        message={t("You will lose the submitter role and won't be able to submit proposals. Your profile is kept in the platform's history (visible under Submitters → show deleted accounts). You can re-apply later. Are you sure?")}
        confirmLabel={t('Leave DAO')}
        cancelLabel={t('Stay')}
        tone="danger"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          void submitterApi.leave()
            .then(async () => { await load(); onChange?.(); })
            .catch((e) => setLeaveError(e instanceof Error ? e.message : 'failed'));
        }}
      />

      {mine && mine.history.length > 0 ? (
        <details className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
          <summary className="cursor-pointer text-neutral-500">{t('Change history')} ({mine.history.length})</summary>
          <ul className="mt-2 space-y-2">
            {mine.history.map((h, i) => (
              <li key={i} className="rounded border border-neutral-200 p-2 text-xs dark:border-neutral-800">
                <div className="text-neutral-400">{t('Replaced')} {new Date(h.snapshotAt).toLocaleString()}</div>
                <div className="mt-1 flex items-center gap-2">
                  {h.logoDataUrl ? <img src={h.logoDataUrl} alt="" className="h-6 w-6 rounded object-cover" /> : null}
                  <span className="font-medium">{h.displayName}</span> · {h.country}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{h.description}</div>
                {h.conflictOfInterest ? <div className="mt-1"><span className="font-medium">{t('Conflict of interest:')}</span> <span className="whitespace-pre-wrap">{h.conflictOfInterest}</span></div> : null}
                <div className="mt-1 text-neutral-500">
                  {h.noSelfVotePledge ? t('✓ no-self-vote pledge') : t('no self-vote pledge')}
                  {h.telegram ? <> · {t('Telegram:')} <span className="font-mono">{h.telegram}</span></> : null}
                  {h.email ? <> · {t('Email:')} {h.email}</> : null}
                </div>
                {(h.githubUrls?.length || h.socialLinks?.length) ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {[...(h.githubUrls ?? []), ...(h.socialLinks ?? [])].map((l, j) => <span key={j} className="break-all text-neutral-500">{l}</span>)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
