'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/prefs-context';
import { Markdown } from './markdown';

/**
 * Renders markdown (bold/italic/headers/lists/links) but clamps tall content to
 * ~`maxLines` lines with a "Show more / Show less" toggle, so long bios and
 * disclosures don't dominate a profile. The toggle only appears when the content
 * actually overflows the clamp.
 */
export function ClampedMarkdown({
  children,
  className,
  maxLines = 15,
  empty = '—',
}: {
  children: string | null | undefined;
  className?: string;
  maxLines?: number;
  empty?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // ~1.5em line-height → maxLines * 1.5em is the collapsed cap.
  const maxEm = maxLines * 1.5;

  const text = (children ?? '').trim();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight - el.clientHeight > 2);
    check();
    // Re-measure on resize (re-wrapping changes the rendered height).
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, maxLines]);

  if (!text) return <p className={`text-neutral-400 italic ${className ?? ''}`}>{empty}</p>;

  return (
    <div>
      <div
        ref={ref}
        style={expanded ? undefined : { maxHeight: `${maxEm}em`, overflow: 'hidden' }}
        className="relative"
      >
        <Markdown className={className}>{text}</Markdown>
        {!expanded && overflows ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white to-transparent dark:from-neutral-900" />
        ) : null}
      </div>
      {overflows || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          {expanded ? t('Show less') : t('Show more')}
        </button>
      ) : null}
    </div>
  );
}
