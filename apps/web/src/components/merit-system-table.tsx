'use client';

import { MERIT_DELTAS, type MeritReason } from '@drep-dao/shared';

import { useT } from '@/lib/prefs-context';

/**
 * §13 — human-readable explanation of the merit-based system, shown at the
 * bottom of the DAO Member overview. Point values come straight from the
 * shared MERIT_DELTAS table (the same one the backend awards from), so this
 * table can never drift from what the platform actually does.
 */
type Row = { reason: MeritReason; what: string };

const MEMBER_GAINS: Row[] = [
  { reason: 'FILTER_COMPLETE', what: 'Completed an assigned filtering review' },
  { reason: 'DV_VOTE', what: 'Voted in Debate & Vote on a funding proposal' },
  { reason: 'DV_VOTE_INTERNAL', what: 'Voted on an internal proposal' },
  { reason: 'QUICK_POLL_VOTE', what: 'Voted in a quick poll' },
  { reason: 'MILESTONE_CHECK', what: 'Completed an assigned milestone review' },
  { reason: 'INTERNAL_SUBMIT', what: 'Submitted an internal proposal' },
  { reason: 'RULE_DOC_SUBMIT', what: 'Submitted a new rule document' },
];
const MEMBER_LOSSES: Row[] = [
  { reason: 'MISSED_FILTER', what: 'Missed an assigned filtering review deadline' },
  { reason: 'MISSED_DV', what: 'Missed a Debate & Vote window' },
  { reason: 'MISSED_INTERNAL', what: 'Missed an internal-proposal vote' },
  { reason: 'MISSED_QUICK_POLL', what: 'Missed a quick poll' },
  { reason: 'MISSED_MILESTONE', what: 'Missed an assigned milestone review deadline' },
];
const BOARD_GAINS: Row[] = [
  { reason: 'APPLICATION_REVIEW', what: 'Decided (approved/rejected) a submitter application' },
  { reason: 'MULTISIG_KEY_PROVIDED', what: 'Provided their treasury multisig signing key' },
  { reason: 'MULTISIG_READY', what: 'Treasury multisig assembled (each contributing member)' },
  { reason: 'TX_INITIATED', what: 'Initiated a treasury action (e.g. hot-wallet top-up) that reached the network' },
  { reason: 'TX_SIGNED', what: 'Signed a multisig transaction that reached the network' },
  { reason: 'BOARD_PAYOUT_SIGNED', what: 'Signed a milestone payout that was paid on time' },
  { reason: 'BOARD_ROUND_CONFIGURE', what: 'Configured a funding round (whole board)' },
  { reason: 'BOARD_ROUND_START', what: 'Started a funding round on schedule (whole board)' },
  { reason: 'BOARD_ROUND_END', what: 'Closed a funding round (whole board)' },
  { reason: 'BOARD_REWARD_DISTRIBUTE', what: 'Distributed round rewards (whole board)' },
  { reason: 'BOARD_LEDGER_MONTHLY', what: 'Monthly treasury ledger published (whole board)' },
];
const BOARD_LOSSES: Row[] = [
  { reason: 'BOARD_REWARD_LATE', what: 'Reward distribution past the deadline (whole board)' },
  { reason: 'BOARD_PAYOUT_LATE', what: 'Milestone payout missed the deadline (whole board)' },
];

const fmt = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

function Group({ title, note, gains, losses }: { title: string; note: string; gains: Row[]; losses: Row[] }) {
  const t = useT();
  const renderRows = (rows: Row[], header: string) => (
    <>
      <tr className="border-t border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
        <td colSpan={2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{header}</td>
      </tr>
      {rows.map((r) => {
        const delta = MERIT_DELTAS[r.reason];
        return (
          <tr key={r.reason} className="border-t border-neutral-200 dark:border-neutral-800">
            <td className="px-3 py-1.5">{t(r.what)}</td>
            <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmt(delta)}
            </td>
          </tr>
        );
      })}
    </>
  );
  return (
    <div>
      <h4 className="text-sm font-semibold">{t(title)}</h4>
      <p className="text-xs text-neutral-500">{t(note)}</p>
      <div className="mt-1 overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
            <tr>
              <th className="px-3 py-2">{t('Operation')}</th>
              <th className="px-3 py-2 text-right">{t('Points')}</th>
            </tr>
          </thead>
          <tbody>
            {renderRows(gains, t('Earning points'))}
            {renderRows(losses, t('Losing points'))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MeritSystemTable() {
  const t = useT();
  return (
    <section className="space-y-3 pt-2">
      <div>
        <h3 className="text-base font-semibold">{t('How merit points work')}</h3>
        <p className="text-sm text-neutral-500">
          {t("Merit raises a member's adjusted voting power — the ×Mult column above is 1 + merit/MERIT_POINT_MAX (capped by that platform parameter). Points are earned when the operation happens; misses are deducted by the daily sweep unless an avoid period covers them.")}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Group
          title="All DAO members"
          note="Applies to every admitted DRep, including board members."
          gains={MEMBER_GAINS}
          losses={MEMBER_LOSSES}
        />
        <Group
          title="Board members"
          note="Board duties, on top of the DAO-member operations on the left. Rows marked “whole board” apply to every active board seat collectively."
          gains={BOARD_GAINS}
          losses={BOARD_LOSSES}
        />
      </div>
    </section>
  );
}
