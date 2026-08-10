import Link from 'next/link';
import { ConnectWallet } from '@/components/connect-wallet';
import { brand } from '@/lib/brand';

const ROLES = [
  ['ADA holder (Viewer)', 'any wallet — browse proposals, votes, members'],
  ['Submitter', 'any wallet — submit funding proposals'],
  ['DRep', 'an admitted DRep — review, vote, signal avoid'],
  ['Board member', 'a DRep on the board — configure rounds, admit DReps, sign treasury'],
];

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← {brand.name}
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Your role is determined by your wallet&apos;s on-chain identity:
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {ROLES.map(([r, d]) => (
          <li key={r}>
            <span className="font-medium">{r}</span>{' '}
            <span className="text-neutral-500">— {d}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <ConnectWallet />
      </div>
    </main>
  );
}
