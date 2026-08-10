'use client';

import { useEffect, useState } from 'react';
import { drepApi, type EntryEligibility } from '@/lib/api';
import { useT } from '@/lib/prefs-context';

/**
 * §14.1 — the "Join DAO" button, gated on the configurable on-chain entry
 * requirements. When the gate is disabled (testnet default) the button is active;
 * when enabled and unmet, it is disabled with a note listing what's missing.
 */
export function JoinDaoButton({ onJoin }: { onJoin: () => void }) {
  const t = useT();
  const [elig, setElig] = useState<EntryEligibility | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    drepApi
      .entryEligibility()
      .then(setElig)
      .catch(() => setElig(null))
      .finally(() => setLoading(false));
  }, []);

  const blocked = !!elig && elig.gatingEnabled && !elig.eligible;

  return (
    <div className="space-y-1">
      <button
        onClick={onJoin}
        disabled={loading || blocked}
        title={blocked ? t('You do not meet the minimum entry requirements') : undefined}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:opacity-70"
      >
        {loading ? t('Checking eligibility…') : t('JOIN DAO')}
      </button>
      {blocked ? <EntryRequirementsNotice requirements={elig!.requirements} /> : null}
      {/* §14 — open membership (or no board seated yet): a complete profile is admitted
          automatically, with no board vote. The board can switch approvals back on later. */}
      {!loading && !blocked && elig?.freePeriod ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-2 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {t('Open membership — complete your profile and you join the DAO automatically, without board approval. You can then vote on proposals.')}
        </div>
      ) : null}
    </div>
  );
}

/**
 * §14.1 — the amber notice listing which entry requirements a registered DRep does
 * not yet meet. Shared by the header JOIN DAO button and the My-area join form (which
 * shows it in place of the application form when the gate is enabled and unmet).
 */
export function EntryRequirementsNotice({ requirements }: { requirements: EntryEligibility['requirements'] }) {
  const t = useT();
  const unmet = requirements.filter((r) => !r.met);
  if (unmet.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/60 p-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <div className="font-medium">{t('You don’t meet the minimum entry requirements:')}</div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
        {unmet.map((r, i) => (
          <li key={i}>
            <span className="font-medium">{r.label}</span> — {r.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
