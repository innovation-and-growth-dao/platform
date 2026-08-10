import { useT } from '@/lib/prefs-context';

/** §4.1 — shows which voting system a context uses (must be visible to users). */
export function VotingStyleBadge({ style }: { style: '1P1V' | 'BAL' }) {
  const t = useT();
  const oneVote = style === '1P1V';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        oneVote
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300'
          : 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300'
      }`}
      title={
        oneVote
          ? t('One member, one vote (board admission, filtering jury, milestone review)')
          : t('Balanced voting power: log₁₀(stake) × (1 + merit/200)')
      }
    >
      {oneVote ? t('1 member · 1 vote') : t('Balanced voting power')}
    </span>
  );
}
