'use client';

import { todoTotal, firstTodoTab, type TodoCounts } from '@/lib/use-todo-counts';
import { useT } from '@/lib/prefs-context';

/**
 * §15.3 — notifications in the login rectangle. A red circle with the total number of to-dos
 * awaiting this member across ALL My-area tabs (Actions, Treasury, Applications, Round control,
 * Voting & reviews, Internal proposals, Messages, My proposals, Profile). Fed the shared to-do
 * counts (same source as the Actions/tab badges + the left-nav badge) so the three always agree.
 * Clicking lands on whichever tab has work. Self-hides when there is nothing to do.
 */
export function NotificationBadge({ counts, onNavigate }: { counts: TodoCounts; onNavigate: (tab: string) => void }) {
  const t = useT();
  const total = todoTotal(counts);
  const target = firstTodoTab(counts);
  if (total <= 0 || !target) return null;

  return (
    <button
      onClick={() => onNavigate(target.tab)}
      title={`${total} ${total === 1 ? t('item') : t('items')} ${t('to process — go to')} ${target.label}`}
      className="relative flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span aria-hidden>🔔</span>
      <span>{target.label}</span>
      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white tabular-nums">
        {total}
      </span>
    </button>
  );
}
