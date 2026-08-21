'use client';

import { useEffect, useState } from 'react';
import { useSubcategories } from '@/lib/subcategories';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/prefs-context';
import { COUNTRIES } from '@/lib/countries';
import { drepApi, submitterApi, type DrepApplicationInput, type ApprovedSubmitter } from '@/lib/api';
import { MarkdownEditor } from './markdown';
import { PhotoUpload } from './photo-upload';

const field =
  'w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/**
 * §14.3 DRep form. `join` = a registered DRep requesting DAO membership (board
 * then votes 3-of-5). `profile` = an existing DAO member editing their details.
 */
export function DrepForm({ mode }: { mode: 'join' | 'profile' }) {
  const t = useT();
  const { profile, refresh } = useAuth();
  const drepId = profile?.onchainDrep.drepId ?? null;

  const [displayName, setDisplayName] = useState(profile?.user.displayName ?? '');
  const [bio, setBio] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [x, setX] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [github, setGithub] = useState('');
  const [telegram, setTelegram] = useState('');
  const [email, setEmail] = useState('');
  const [subs, setSubs] = useState<string[]>([]);
  const { subs: subcats } = useSubcategories(); // §5.3 board-configurable list
  const [kyc, setKyc] = useState(false);
  const [calls, setCalls] = useState(false);
  const [admissionCall, setAdmissionCall] = useState(false);
  const [votesOnFunding, setVotesOnFunding] = useState(true);
  // §2.1 — conflict-of-interest disclosure + informative no-self-vote pledge.
  const [conflict, setConflict] = useState('');
  const [country, setCountry] = useState('');
  const [noSelfVote, setNoSelfVote] = useState(false); // §8.2 board-only toggle (default on)
  // §2 — cross-wallet link to a submitter profile (the same entity on a different wallet).
  const [linkSubmitter, setLinkSubmitter] = useState(false);
  const [linkedSubmitterUserId, setLinkedSubmitterUserId] = useState('');
  const [submitters, setSubmitters] = useState<ApprovedSubmitter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [savedSig, setSavedSig] = useState<string | null>(null);

  const isBoard = profile?.roles.includes('BOARD') ?? false;

  // §2 — dirty-check: in profile mode, Save is enabled only when the form differs from the loaded
  // profile. The baseline (savedSig) is pinned once the profile loads and re-pinned after each save.
  const sig = (f: { displayName: string; bio: string; photo: string | null; x: string; linkedin: string; github: string; telegram: string; email: string; subs: string[]; conflict: string; country: string; noSelfVote: boolean; votesOnFunding: boolean; linkedSubmitterUserId: string }) =>
    JSON.stringify({ displayName: f.displayName.trim(), bio: f.bio, photo: f.photo, x: f.x.trim(), linkedin: f.linkedin.trim(), github: f.github.trim(), telegram: f.telegram.trim(), email: f.email.trim(), subs: [...f.subs].sort(), conflict: f.conflict, country: f.country, noSelfVote: f.noSelfVote, votesOnFunding: f.votesOnFunding, linkedSubmitterUserId: f.linkedSubmitterUserId });
  const formSig = sig({ displayName, bio, photo, x, linkedin, github, telegram, email, subs, conflict, country, noSelfVote, votesOnFunding, linkedSubmitterUserId: linkSubmitter ? linkedSubmitterUserId : '' });
  // Join is always a fresh application (no baseline); only profile edits are gated by a change.
  const dirty = mode === 'join' ? true : savedSig !== null && formSig !== savedSig;

  // Prefill from the existing profile (both modes — a re-applying DRep keeps prior data).
  useEffect(() => {
    void drepApi.mine().then((d) => {
      if (!d) return;
      setBio(d.bio ?? '');
      setPhoto(d.photo ?? null);
      setSubs(d.subcategoryIds ?? []);
      const s = d.socials ?? {};
      setX(s.x ?? '');
      setLinkedin(s.linkedin ?? '');
      setGithub(s.github ?? '');
      const c = d.contact ?? {};
      setTelegram(c.telegram ?? '');
      setEmail(c.email ?? '');
      setKyc(d.kycOptin);
      setCalls(d.callsOptin);
      setAdmissionCall(d.admissionCallOptin);
      setVotesOnFunding(d.votesOnFundingProposals);
      setConflict(d.conflictOfInterest ?? '');
      setCountry(d.country ?? '');
      setNoSelfVote(!!d.noSelfVotePledge);
      setLinkedSubmitterUserId(d.linkedSubmitterUserId ?? '');
      setLinkSubmitter(!!d.linkedSubmitterUserId);
      // Pin the dirty-check baseline to exactly what was loaded.
      setSavedSig(sig({
        displayName: profile?.user.displayName ?? '', bio: d.bio ?? '', photo: d.photo ?? null,
        x: s.x ?? '', linkedin: s.linkedin ?? '', github: s.github ?? '',
        telegram: c.telegram ?? '', email: c.email ?? '', subs: d.subcategoryIds ?? [],
        conflict: d.conflictOfInterest ?? '', country: d.country ?? '', noSelfVote: !!d.noSelfVotePledge,
        votesOnFunding: d.votesOnFundingProposals, linkedSubmitterUserId: d.linkedSubmitterUserId ?? '',
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // §2 — submitters to choose from when declaring "I'm also a submitter (different wallet)".
  useEffect(() => { submitterApi.directory().then(setSubmitters).catch(() => setSubmitters([])); }, []);

  const toggleSub = (id: string) =>
    setSubs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const bioWords = bio.trim().split(/\s+/).filter(Boolean).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    // §14.3 — the bio is mandatory: at least 100 words (also enforced server-side).
    if (bioWords < 100) { setError(`${t('The bio must be at least 100 words (currently')} ${bioWords}).`); return; }
    if (!country) { setError(t('Please select a country.')); return; }
    // §14.3 — Telegram + a valid email are mandatory contact details.
    if (!telegram.trim()) { setError(t('A Telegram handle is required.')); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError(t('A valid email is required.')); return; }
    setBusy(true);
    const input: DrepApplicationInput = {
      displayName: displayName.trim() || undefined,
      bio: bio.trim(),
      // Always send `photo` so an explicit clear (empty string) reaches the API.
      photo: photo ?? '',
      subcategoryIds: subs,
      socials: {
        ...(x.trim() ? { x: x.trim() } : {}),
        ...(linkedin.trim() ? { linkedin: linkedin.trim() } : {}),
        ...(github.trim() ? { github: github.trim() } : {}),
      },
      contact: {
        ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      },
      // Opt-ins are only captured on the JOIN request; profile edits leave them untouched.
      ...(mode === 'join'
        ? { kycOptin: kyc, callsOptin: calls, admissionCallOptin: admissionCall }
        : {}),
      // §8.2 — board members can toggle this in profile mode (non-board don't see it).
      ...(mode === 'profile' && isBoard ? { votesOnFundingProposals: votesOnFunding } : {}),
      // §2.1 — disclosure + pledge (same semantics as the submitter profile).
      conflictOfInterest: conflict.trim(),
      noSelfVotePledge: noSelfVote,
      country,
      // §2 — link to a submitter profile (empty string clears it).
      linkedSubmitterUserId: linkSubmitter ? linkedSubmitterUserId : '',
    };
    try {
      if (mode === 'join') await drepApi.apply(input);
      else await drepApi.update(input);
      setSaved(true);
      setSavedSig(formSig); // re-pin baseline → the button disables again until the next change
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="block space-y-1">
        <span className="text-sm font-medium">{t('Your DRep ID (verified on-chain)')}</span>
        <div className="break-all rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          {drepId ?? '—'}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t('Display name')}</span>
        <input className={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>

      <PhotoUpload
        photo={photo}
        onChange={(next, err) => { setPhoto(next); setPhotoError(err ?? null); }}
        error={photoError}
      />

      <MarkdownEditor
        value={bio}
        onChange={setBio}
        title={t('Bio — motivation / experience')}
        hint={`${t('min 100 words —')} ${bioWords}/100`}
        subtitle={t('Who you are, your experience, why you participate in the DAO. Supports bold, italics, headers, lists.')}
        placeholder={t('Who you are, your experience, why you participate in the DAO…')}
        minRows={6}
        required
      />
      {bioWords < 100 ? <p className="text-xs text-amber-600">{t('The bio must be at least 100 words (')}{bioWords}/100).</p> : null}

      <label className="block">
        <span className="text-sm font-medium">{t('Country')} <span className="text-red-500">*</span></span>
        <select className={field} value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">{t('— select a country —')}</option>
          {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      {/* §2.1 — same disclosure as the submitter profile. */}
      <MarkdownEditor
        value={conflict}
        onChange={setConflict}
        title={t('Conflict of interest')}
        subtitle={t('Disclose everything related to a conflict of interest around approving funding (write "none" if you have none). Supports bold, italics, headers, lists.')}
        placeholder={t('e.g. I am affiliated with project X which competes for the same category…')}
        minRows={3}
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={noSelfVote} onChange={(e) => setNoSelfVote(e.target.checked)} className="mt-0.5" />
        <span>{t('I will not vote for my own proposal')} <span className="text-xs text-neutral-500">{t('(informative — optional)')}</span></span>
      </label>

      {/* §2 — declare a submitter profile that is the SAME entity (possibly a different wallet). */}
      <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={linkSubmitter} onChange={(e) => setLinkSubmitter(e.target.checked)} className="mt-0.5" />
          <span>{t('I\'m also a')} <strong>{t('submitter')}</strong> <span className="text-xs text-neutral-500">{t('(link my submitter profile — it may be on a different wallet)')}</span></span>
        </label>
        {linkSubmitter ? (
          <select value={linkedSubmitterUserId} onChange={(e) => setLinkedSubmitterUserId(e.target.value)} className={`mt-2 ${field}`}>
            <option value="">{t('— select your submitter profile —')}</option>
            {submitters.map((s) => <option key={s.userId} value={s.userId}>{s.displayName}{s.country ? ` — ${s.country}` : ''}</option>)}
          </select>
        ) : null}
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">{t('Expertise (subcategories)')}</span>
        <div className="flex flex-wrap gap-1.5">
          {subcats.map((sc) => (
            <button
              type="button"
              key={sc.id}
              onClick={() => toggleSub(sc.id)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                subs.includes(sc.id)
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-neutral-300 dark:border-neutral-700'
              }`}
            >
              {sc.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">X / Twitter</span>
          <input className={field} value={x} onChange={(e) => setX(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">LinkedIn</span>
          <input className={field} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">GitHub</span>
          <input className={field} value={github} onChange={(e) => setGithub(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Telegram <span className="text-red-500">*</span></span>
          <input className={field} value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="@handle" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">{t('Email')} <span className="text-red-500">*</span></span>
          <input type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.org" />
        </label>
      </div>

      {/* Opt-ins are part of the JOIN request only — not the ongoing profile. */}
      {mode === 'join' ? (
        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={kyc} onChange={(e) => setKyc(e.target.checked)} /> {t('KYC opt-in')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={calls} onChange={(e) => setCalls(e.target.checked)} /> {t('Calls opt-in')}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={admissionCall} onChange={(e) => setAdmissionCall(e.target.checked)} />{' '}
            {t('Admission-call opt-in')}
          </label>
        </div>
      ) : null}

      {/* §8.2 — board-only profile switch. Off = opt out of D&V voting on
          funding proposals (existing votes become weight 0, future ballots
          refused). Default on for every board member. */}
      {mode === 'profile' && isBoard ? (
        <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={votesOnFunding}
              onChange={(e) => setVotesOnFunding(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{t('Vote on funding proposals')}</span>
              <span className="block text-xs text-neutral-500">
                {t('When on, your weighted voting power is counted in every funding-proposal Debate & Vote tally. Turn it off to opt out — any vote you already cast becomes effective abstain (your snapshot weight goes to 0).')}
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
      {saved && !dirty ? (
        <div className="text-sm text-emerald-600">
          {mode === 'join' ? t('Request submitted — awaiting board review.') : t('Profile saved.')}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy || !drepId || !!photoError || !dirty}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? t('Saving…') : mode === 'join' ? t('Submit request to join') : t('Save profile')}
      </button>
    </form>
  );
}
