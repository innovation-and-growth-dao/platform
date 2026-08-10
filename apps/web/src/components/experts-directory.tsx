'use client';

import { useEffect, useState } from 'react';
import { daoApi, type DaoExpert } from '@/lib/api';
import { useT } from '@/lib/prefs-context';
import { SUBCAT_LABEL } from '@/lib/ui';
import { card } from '@/lib/ui';
import { FallbackAvatar } from './fallback-avatar';
import { CopyButton } from './copy-button';
import { useExplorer } from '@/lib/explorer';
import { useUrlNav } from '@/lib/use-url-nav';
import { ClampedMarkdown } from './clamped-markdown';

/**
 * §2 — public directory of approved Experts (mirrors the Submitters directory).
 * Click a row to open the full profile: experience, conflict-of-interest,
 * expertise areas, contact (email/Telegram), social links, and the on-chain
 * wallet identity (DRep ID if they're a DRep, else the stake address).
 */
export function ExpertsDirectory() {
  const t = useT();
  const { drepUrl } = useExplorer();
  const { get, setParams } = useUrlNav();
  const [rows, setRows] = useState<DaoExpert[] | null>(null);
  // Deep-link: ?expert=<id> opens that profile (e.g. from the DAO overview's
  // "View profile →" link). The chevron toggles it locally + in the URL.
  const openId = get('expert');
  const setOpenId = (id: string | null) => setParams({ expert: id });
  useEffect(() => {
    daoApi.experts().then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('Experts')}</h2>
        <p className="text-sm text-neutral-500">
          {t('Non-DRep ADA holders approved by the board to advise on proposals — feedback in the Filtering stage, advice in the Debate & Vote stage, and milestone reviews. Click a row for the full profile.')}
        </p>
      </div>
      {rows === null ? <p className="text-sm text-neutral-500">{t('Loading…')}</p> : null}
      {rows?.length === 0 ? <p className="text-sm text-neutral-500">{t('No approved experts yet.')}</p> : null}
      <div className="space-y-3">
        {rows?.map((x) => {
          const open = openId === x.id;
          return (
            <section key={x.id} className={card}>
              <button onClick={() => setOpenId(open ? null : x.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span className="flex items-center gap-2">
                  {x.logoDataUrl
                    ? <img src={x.logoDataUrl} alt="" className="h-9 w-9 rounded object-cover" />
                    : <FallbackAvatar name={x.displayName} className="h-9 w-9 rounded" />}
                  <span className="font-medium">{x.displayName}</span>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">{t('Expert')}</span>
                  {x.isSubmitter ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" title={t('Also an approved submitter — can submit funding proposals')}>
                      {t('also a submitter')}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-neutral-400">{open ? '▴' : '▾'}</span>
              </button>

              {open ? (
                <div className="mt-3 flex flex-wrap gap-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                  {x.logoDataUrl
                    ? <img src={x.logoDataUrl} alt="" className="h-24 w-24 rounded-lg object-cover" />
                    : <FallbackAvatar name={x.displayName} className="h-24 w-24 rounded-lg" />}
                  <div className="min-w-0 flex-1 space-y-2 text-sm">
                    {x.isSubmitter ? (
                      <div className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        {t('✓ Also a submitter — this expert can submit funding proposals.')}
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Experience / skills')}</div>
                      <ClampedMarkdown className="mt-0.5 text-neutral-700 dark:text-neutral-300" empty="—" maxLines={15}>{x.bio ?? ''}</ClampedMarkdown>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Motivation / area of help')}</div>
                      <ClampedMarkdown className="mt-0.5 text-neutral-700 dark:text-neutral-300" empty="—" maxLines={15}>{x.motivation ?? ''}</ClampedMarkdown>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Conflict of interest')}</div>
                      <ClampedMarkdown className="mt-0.5 text-neutral-700 dark:text-neutral-300" empty="—" maxLines={15}>{x.conflictOfInterest ?? ''}</ClampedMarkdown>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Expertise')}</div>
                      {x.subcategoryIds.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {x.subcategoryIds.map((id) => (
                            <span key={id} className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                              {SUBCAT_LABEL[id] ?? id}
                            </span>
                          ))}
                        </div>
                      ) : <p className="mt-0.5 text-xs text-neutral-400">{t('no expertise areas listed')}</p>}
                    </div>
                    <div className="text-xs">
                      <span className="font-medium">{t('Contact:')}</span>{' '}
                      {x.telegram ? <span className="font-mono">{x.telegram}</span> : '—'}
                      {' · '}
                      {x.email ? <a href={`mailto:${x.email}`} className="text-emerald-700 underline dark:text-emerald-400">{x.email}</a> : '—'}
                    </div>
                    {/* The platform knows the wallet — surface the on-chain identity. */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium">{t('Wallet (stake):')}</span>
                      <span className="break-all font-mono text-neutral-600 dark:text-neutral-300">{x.stakeAddress}</span>
                      <CopyButton text={x.stakeAddress} label={t('Copy')} />
                    </div>
                    {x.drepIdOnchain ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-medium">{t('DRep ID:')}</span>
                        <a href={drepUrl(x.drepIdOnchain)} target="_blank" rel="noreferrer" className="break-all font-mono text-emerald-700 underline dark:text-emerald-400">{x.drepIdOnchain}</a>
                        <CopyButton text={x.drepIdOnchain} label={t('Copy')} />
                      </div>
                    ) : null}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t('Social media')}</div>
                      <div className="mt-0.5 text-xs">
                        {x.socialLinks.length
                          ? x.socialLinks.map((l, i) => (
                              <a key={i} href={l} target="_blank" rel="noreferrer" className="mr-2 break-all text-emerald-700 underline dark:text-emerald-400">{l}</a>
                            ))
                          : <span className="text-neutral-400">{t('not provided')}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
