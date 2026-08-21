'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '@/lib/markdown';
import { useT } from '@/lib/prefs-context';

/**
 * Lets a parent expand/collapse ALL MarkdownEditors under it at once (e.g. an "Expand all /
 * Collapse all" toggle on a form). Bumping `expandSignal` opens every editor; bumping
 * `collapseSignal` shrinks them. Editors outside any provider just use their own controls.
 */
export const MarkdownCollapseContext = createContext<{ expandSignal: number; collapseSignal: number }>({
  expandSignal: 0,
  collapseSignal: 0,
});

/** Render a trusted-after-sanitization markdown string as formatted HTML. */
// Small inline control icons (replacing emoji glyphs that render as boxed characters in some
// browsers). Sized to sit next to button text; colour follows the button via currentColor.
const uiIcon = 'inline-block h-3 w-3 shrink-0 align-[-1px]';
/** Vertical resize — taller/shorter editing area. */
export function ResizeVIcon() {
  return <svg className={uiIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2.5v11M4.5 6 8 2.5 11.5 6M4.5 10 8 13.5 11.5 10" /></svg>;
}
/** Expand / open a collapsed field (chevron down). */
export function ExpandIcon() {
  return <svg className={uiIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>;
}
/** Shrink / collapse to just the name (chevron up). */
export function ShrinkIcon() {
  return <svg className={uiIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={`space-y-1 leading-relaxed [&_a]:break-words ${className ?? ''}`}
      // renderMarkdown HTML-escapes input first and only emits a safe tag subset.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(children) }}
    />
  );
}

type ToolButton = { label: string; title: string; run: (e: Editing) => void };

type Editing = {
  value: string;
  start: number;
  end: number;
  setValue: (v: string) => void;
  setSelection: (start: number, end: number) => void;
};

/** Wrap the selection with `before`/`after` (e.g. ** … **); if empty, drop the placeholder in. */
function surround(before: string, after: string, placeholder: string) {
  return (e: Editing) => {
    const sel = e.value.slice(e.start, e.end) || placeholder;
    const next = e.value.slice(0, e.start) + before + sel + after + e.value.slice(e.end);
    e.setValue(next);
    e.setSelection(e.start + before.length, e.start + before.length + sel.length);
  };
}

/** Prefix every line touched by the selection (headings, list items). */
function prefixLines(prefix: string | ((i: number) => string)) {
  return (e: Editing) => {
    const lineStart = e.value.lastIndexOf('\n', e.start - 1) + 1;
    const block = e.value.slice(lineStart, e.end) || e.value.slice(lineStart);
    const end = lineStart + block.length;
    const prefixed = block
      .split('\n')
      .map((ln, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + ln)
      .join('\n');
    const next = e.value.slice(0, lineStart) + prefixed + e.value.slice(end);
    e.setValue(next);
    e.setSelection(lineStart, lineStart + prefixed.length);
  };
}

const TOOLS: ToolButton[] = [
  { label: 'H', title: 'Heading', run: prefixLines('## ') },
  { label: 'B', title: 'Bold', run: surround('**', '**', 'bold text') },
  { label: 'I', title: 'Italic', run: surround('*', '*', 'italic text') },
  { label: '• List', title: 'Bullet list', run: prefixLines('- ') },
  { label: '1. List', title: 'Numbered list', run: prefixLines((i) => `${i + 1}. `) },
  { label: '🔗 Link', title: 'Link', run: surround('[', '](https://)', 'text') },
];

/**
 * A markdown text field with a labelled header, a formatting toolbar
 * (bold/italic/heading/lists/link), a Write/Preview toggle, and an Expand/Shrink
 * button. **Shrinking collapses the field to just its name** (the content is
 * hidden); expanding reveals the editor. The textarea is also drag-resizable for
 * fine sizing while open.
 */
export function MarkdownEditor({
  value,
  onChange,
  title,
  hint,
  subtitle,
  placeholder,
  minRows = 3,
  required,
  defaultCollapsed = false,
  minWords,
  maxWords,
  showShortfall = false,
}: {
  value: string;
  onChange: (v: string) => void;
  title?: string;
  hint?: string;
  /** Longer help text shown on its own line below the title — for fields that
   *  need explaining (e.g. KPIs, ecosystem impact). Use `hint` for a short
   *  inline suffix; use `subtitle` for one-or-two sentences of guidance. */
  subtitle?: string;
  placeholder?: string;
  minRows?: number;
  required?: boolean;
  defaultCollapsed?: boolean;
  /** §3 — round word-count rules. When set, a live count is shown and the field
   *  turns red (and force-expands once `showShortfall` is on) until it's met. */
  minWords?: number;
  maxWords?: number;
  showShortfall?: boolean;
}) {
  const tr = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(!defaultCollapsed);
  // §3 — respond to a parent "Expand all / Collapse all" toggle (skip the initial mount).
  const collapseCtx = useContext(MarkdownCollapseContext);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (collapseCtx.expandSignal) setOpen(true);
  }, [collapseCtx.expandSignal]);
  useEffect(() => {
    if (collapseCtx.collapseSignal) setOpen(false);
  }, [collapseCtx.collapseSignal]);
  const [tall, setTall] = useState(false);
  const [preview, setPreview] = useState(false);
  const filled = value.trim().length > 0;

  const words = value.trim() ? value.trim().split(/\s+/).filter(Boolean).length : 0;
  const short = !!minWords && minWords > 0 && words < minWords;
  const over = !!maxWords && maxWords > 0 && words > maxWords;
  // After a failed submit, a short/over field must be visible + flagged.
  const needsFix = showShortfall && (short || over);
  // Force-EXPAND such a field (once), but never auto-collapse it again — so the
  // textarea doesn't disappear (stealing focus to the next control) the instant
  // the user types enough to meet the minimum. They collapse it manually.
  useEffect(() => { if (needsFix) setOpen(true); }, [needsFix]);
  // Word-count badge: "needs N more words" / "N over the M-word max" / "X words".
  const wordBadge = minWords || maxWords ? (
    <span className={`text-[11px] ${short || over ? 'font-semibold text-red-600 dark:text-red-400' : 'text-neutral-400'}`}>
      {short ? `${tr('needs')} ${minWords! - words} ${minWords! - words === 1 ? tr('more word') : tr('more words')}`
        : over ? `${words - maxWords!} ${tr('over the')} ${maxWords}${tr('-word max')}`
          : `${words} ${words === 1 ? tr('word') : tr('words')}`}
    </span>
  ) : null;
  const borderCls = needsFix ? 'border-red-400 dark:border-red-700' : 'border-neutral-300 dark:border-neutral-700';

  // Collapsed: show only the field name (+ a "filled" hint) and an Expand button.
  if (!open) {
    return (
      <div className={`rounded-md border px-2 py-1.5 ${borderCls}`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex flex-1 items-center gap-1 text-left text-sm font-medium text-neutral-700 hover:text-neutral-900 dark:text-neutral-300"
          >
            <span className="text-neutral-400">▸</span>
            {title ?? tr('Field')}
            {hint ? <span className="font-normal text-neutral-400"> — {hint}</span> : null}
            {required && !filled ? <span className="text-red-500">*</span> : null}
          </button>
          {wordBadge}
          <span className="text-xs text-neutral-400">{filled ? `✓ ${tr('filled')}` : tr('empty')}</span>
          <button type="button" onClick={() => setOpen(true)} className="rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700">
            <ExpandIcon /> {tr('Expand')}
          </button>
        </div>
        {subtitle ? <p className="mt-0.5 pl-5 text-[11px] italic text-neutral-500 dark:text-neutral-400">{subtitle}</p> : null}
      </div>
    );
  }

  const apply = (tool: ToolButton) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    tool.run({
      value,
      start,
      end,
      setValue: onChange,
      setSelection: (s, e) => {
        // Re-focus + restore selection after React re-renders the controlled value.
        requestAnimationFrame(() => {
          if (!ref.current) return;
          ref.current.focus();
          ref.current.setSelectionRange(s, e);
        });
      },
    });
  };

  const btn =
    'rounded px-1.5 py-0.5 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700';

  return (
    <div className={`rounded-md border ${borderCls}`}>
      {/* Field name + optional subtitle + the collapse ("Shrink to name") control. */}
      {title ? (
        <div className="border-b border-neutral-200 px-2 py-1 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setOpen(false)} className="flex flex-1 items-center gap-1 text-left text-sm font-medium text-neutral-700 dark:text-neutral-300">
              <span className="text-neutral-400">▾</span>
              {title}
              {hint ? <span className="font-normal text-neutral-400"> — {hint}</span> : null}
              {required && !filled ? <span className="text-red-500">*</span> : null}
            </button>
            {wordBadge}
            <button type="button" onClick={() => setOpen(false)} className={btn} title={tr('Collapse to just the field name')}>
              <ShrinkIcon /> {tr('Shrink')}
            </button>
          </div>
          {subtitle ? <p className="mt-0.5 pl-5 text-[11px] italic text-neutral-500 dark:text-neutral-400">{subtitle}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-1 py-1 dark:border-neutral-700 dark:bg-neutral-800/60">
        {TOOLS.map((t) => (
          <button
            key={t.label}
            type="button"
            title={tr(t.title)}
            onMouseDown={(e) => e.preventDefault() /* keep textarea selection */}
            onClick={() => apply(t)}
            disabled={preview}
            className={`${btn} ${t.label === 'B' ? 'font-bold' : t.label === 'I' ? 'italic' : ''} disabled:opacity-40`}
          >
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-neutral-300 dark:bg-neutral-600" />
        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          title={tr('See exactly how your text will look once saved')}
          className={`${btn} ${preview ? 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600' : ''}`}
        >
          {preview ? `← ${tr('Back to editing')}` : `👁 ${tr('Preview')}`}
        </button>
        <button type="button" onClick={() => setTall((v) => !v)} className={`${btn} ml-auto`} title={tr('Taller / shorter editing area')}>
          <ResizeVIcon /> {tall ? tr('Shorter') : tr('Taller')}
        </button>
        {!title ? (
          <button type="button" onClick={() => setOpen(false)} className={btn} title={tr('Collapse')}><ShrinkIcon /> {tr('Shrink')}</button>
        ) : null}
      </div>
      {preview ? (
        <div className="min-h-[5rem] px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-300">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            👁 {tr('Preview — this is how it will appear once saved')}
          </div>
          {value.trim() ? <Markdown>{value}</Markdown> : <span className="text-neutral-400">{tr('Nothing to preview yet — switch back and write something.')}</span>}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-emerald-100 bg-emerald-50/60 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-400">
            ✎ {tr('You can use Markdown formatting here')}
          </div>
          <textarea
            ref={ref}
            className="w-full resize-y bg-transparent px-2 py-1.5 text-sm outline-none dark:bg-neutral-900"
            style={{ height: tall ? '22rem' : `${Math.max(minRows, 3) * 1.6 + 0.75}rem` }}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
          />
          {/* §UX — make the markup explicit: many users type e.g. "##Heading##" (wrapping, like
              **bold**) and are surprised it doesn't render. Show the real syntax + point at Preview. */}
          <div className="rounded-b-md border-t border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] leading-relaxed text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
            {tr('Markdown formatting')}: <code className="text-neutral-700 dark:text-neutral-300">**bold**</code> · <code className="text-neutral-700 dark:text-neutral-300">*italic*</code> · <code className="text-neutral-700 dark:text-neutral-300">## Heading</code> <span className="text-neutral-400">({tr('note the space, no closing #')})</span> · <code className="text-neutral-700 dark:text-neutral-300">- list</code> · <code className="text-neutral-700 dark:text-neutral-300">[text](https://…)</code> — {tr('hit')} <span className="font-medium">👁 {tr('Preview')}</span> {tr('to check it')}.
          </div>
        </>
      )}
    </div>
  );
}
