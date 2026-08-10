import type { Metadata } from 'next';
import { brand } from '@/lib/brand';

export const metadata: Metadata = { title: 'Tab icon options' };

/**
 * Dedicated preview URL (/icons) for choosing each deployment's browser-tab icon.
 * Every option is shown at the sizes a browser actually renders a favicon, so the
 * choice is made on how it reads at 16px — not how it looks blown up.
 */
const GROUPS: { brandName: string; note: string; items: { file: string; label: string }[] }[] = [
  {
    brandName: 'Innovation & Growth DAO',
    note: 'Green sprouting seed — growth from a funded idea.',
    items: [
      { file: '/icons/ig-sprout.svg', label: 'Sprouting seed — emerald tile' },
      { file: '/icons/ig-sprout-circle.svg', label: 'Sprouting seed — circle' },
      { file: '/icons/ig-sprout-light.svg', label: 'Sprouting seed — light tile' },
    ],
  },
  {
    brandName: 'DRep DAO',
    note: 'Globe — delegated representation across the network.',
    items: [
      { file: '/icons/drep-globe.svg', label: 'Globe — indigo tile' },
      { file: '/icons/drep-globe-grid.svg', label: 'Globe — circle, latitudes' },
      { file: '/icons/drep-ballot.svg', label: 'Ballot box' },
    ],
  },
];

const SIZES = [64, 32, 16];

export default function IconsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Tab icon options</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        This deployment is <strong>{brand.name}</strong>, currently using{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">{brand.icon}</code>.
        Each option below is rendered at 64 / 32 / 16 px — 16 px is the real tab size.
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        To switch, set the icon path for that brand in <code>apps/web/src/lib/brand.ts</code> and rebuild.
      </p>

      {GROUPS.map((g) => (
        <section key={g.brandName} className="mt-8">
          <h2 className="text-lg font-semibold">{g.brandName}</h2>
          <p className="text-xs text-neutral-500">{g.note}</p>
          <ul className="mt-3 space-y-2">
            {g.items.map((it) => {
              const active = it.file === brand.icon;
              return (
                <li
                  key={it.file}
                  className={`flex flex-wrap items-center gap-4 rounded-lg border p-3 ${
                    active
                      ? 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  <span className="flex items-end gap-3">
                    {SIZES.map((s) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={s} src={it.file} width={s} height={s} alt={`${it.label} at ${s}px`} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {it.label}
                      {active ? <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">● in use here</span> : null}
                    </span>
                    <code className="block text-xs text-neutral-500">{it.file}</code>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
