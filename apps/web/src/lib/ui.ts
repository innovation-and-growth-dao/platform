import { DEFAULT_SUBCATEGORIES } from '@drep-dao/shared';

/** Shared Tailwind class constants (were re-declared per component — D25). */
export const card = 'rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900';
export const inputCls = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900';

/** Subcategory id → human label lookup (single copy). */
export const SUBCAT_LABEL: Record<string, string> = Object.fromEntries(
  DEFAULT_SUBCATEGORIES.map((s) => [s.id, s.label]),
);

