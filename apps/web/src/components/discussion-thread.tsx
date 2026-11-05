'use client';

import { useState } from 'react';
import { useT } from '@/lib/prefs-context';
import { Markdown, MarkdownEditor } from './markdown';

/**
 * One discussion/feedback thread, shared by Requests, Rule Documents and Decisions so all three
 * behave identically: recursive replies (reply-to-reply), blue author names, a rich Markdown editor
 * (toolbar + Write/Preview + resizable box) for every composer, and collapse/expand of replies
 * (per comment and all at once). Rule Docs / Decisions additionally wrap it in a collapsible
 * "Feedback (N)" section (`collapsibleSection`); Requests renders it inline.
 */
export interface DiscComment {
  id: string;
  authorName: string;
  authorRole: string | null;
  isMine: boolean;
  contentMd: string | null;
  deleted: boolean;
  createdAt: string;
  replies?: DiscComment[];
}

// Colour-code a commenter's role so a DRep, an OG member, an expert, the board and a plain viewer are
// distinguishable at a glance. Role strings come from the API (e.g. "Council member" = a DRep, "<group>
// member" = an OG member, null = a logged-in viewer with no special role). Order matters: "Council
// member" / "Board member" contain "member", so match those before the generic member case. Label is
// passed through t() by the caller.
function roleTone(role: string | null | undefined): { label: string; cls: string } {
  const grey = 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300';
  if (!role) return { label: 'Viewer', cls: grey };
  if (/board/i.test(role)) return { label: role, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' };
  if (/council/i.test(role)) return { label: role, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' };
  if (/expert/i.test(role)) return { label: role, cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300' };
  if (/submitter/i.test(role)) return { label: role, cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300' };
  if (/member/i.test(role)) return { label: role, cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300' };
  return { label: role, cls: grey };
}

function countAll(list: DiscComment[]): number {
  return list.reduce((n, c) => n + 1 + (c.replies ? countAll(c.replies) : 0), 0);
}
function idsWithReplies(list: DiscComment[], acc: string[] = []): string[] {
  for (const c of list) {
    if (c.replies && c.replies.length > 0) { acc.push(c.id); idsWithReplies(c.replies, acc); }
  }
  return acc;
}

function Card({
  c, canComment, canModerate, collapsed, onToggleCollapse, onPost, onDelete,
}: {
  c: DiscComment;
  canComment: boolean;
  canModerate: boolean;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onPost: (contentMd: string, parentId: string) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onPost(text.trim(), c.id); setText(''); setOpen(false); } finally { setBusy(false); }
  };
  const replyCount = c.replies ? countAll(c.replies) : 0;
  const isCollapsed = collapsed.has(c.id);
  return (
    <div>
      <div className="rounded border border-neutral-200 p-2 text-sm dark:border-neutral-800">
        <div className="mb-0.5 flex items-center justify-between text-xs text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="font-semibold text-blue-600 dark:text-blue-400">{c.authorName}</span>{(() => { const r = roleTone(c.authorRole); return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${r.cls}`}>{t(r.label)}</span>; })()}</span>
          <span className="flex items-center gap-2">
            <span>{new Date(c.createdAt).toLocaleString()}</span>
            {!c.deleted && (c.isMine || canModerate) ? <button onClick={() => onDelete(c.id)} className="text-rose-600 hover:underline">{t('Delete')}</button> : null}
          </span>
        </div>
        {c.deleted ? <p className="text-sm italic text-neutral-400">[deleted]</p> : <div className="prose prose-sm max-w-none text-sm dark:prose-invert"><Markdown>{c.contentMd ?? ''}</Markdown></div>}
        <div className="mt-1.5 flex items-center gap-2">
          {canComment && !c.deleted ? (
            <button onClick={() => setOpen((v) => !v)} className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30">{open ? t('Cancel') : t('Reply')}</button>
          ) : null}
          {replyCount > 0 ? (
            <button onClick={() => onToggleCollapse(c.id)} className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
              {isCollapsed ? `▸ ${t('Show')} ${replyCount} ${replyCount === 1 ? t('reply') : t('replies')}` : `▾ ${t('Hide')} ${replyCount} ${replyCount === 1 ? t('reply') : t('replies')}`}
            </button>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="ml-3 mt-1.5">
          <MarkdownEditor value={text} onChange={setText} title={t('Reply')} minRows={2} placeholder={t('Write a reply… (supports **bold**, *italics*, lists, [links](https://…))')} />
          <div className="mt-1 flex gap-2">
            <button disabled={busy || !text.trim()} onClick={submit} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? t('Posting…') : t('Reply')}</button>
            <button onClick={() => { setOpen(false); setText(''); }} className="rounded-md border border-neutral-300 px-3 py-1 text-xs dark:border-neutral-600">{t('Cancel')}</button>
          </div>
        </div>
      ) : null}
      {c.replies && c.replies.length > 0 && !isCollapsed ? (
        <div className="mt-2 space-y-2 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
          {c.replies.map((rep) => <Card key={rep.id} c={rep} canComment={canComment} canModerate={canModerate} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onPost={onPost} onDelete={onDelete} />)}
        </div>
      ) : null}
    </div>
  );
}

export function DiscussionThread({
  comments, canComment, canModerate, onPost, onDelete,
  label = 'Discussion', submitLabel = 'Comment',
  placeholder, emptyText,
  collapsibleSection = false, defaultSectionOpen = false,
}: {
  comments: DiscComment[];
  canComment: boolean;
  canModerate: boolean;
  onPost: (contentMd: string, parentId?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  label?: string;
  submitLabel?: string;
  placeholder?: string;
  emptyText?: string;
  collapsibleSection?: boolean;
  defaultSectionOpen?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sectionOpen, setSectionOpen] = useState(defaultSectionOpen);
  const count = countAll(comments);
  const parentIds = idsWithReplies(comments);
  const allCollapsed = parentIds.length > 0 && parentIds.every((id) => collapsed.has(id));
  const toggleCollapse = (id: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const collapseAll = () => setCollapsed(new Set(parentIds));
  const expandAll = () => setCollapsed(new Set());
  const post = async (contentMd: string, parentId?: string) => {
    if (!contentMd.trim()) return;
    setBusy(true);
    try { await onPost(contentMd.trim(), parentId); if (!parentId) setText(''); } finally { setBusy(false); }
  };
  const reply = (contentMd: string, parentId: string) => post(contentMd, parentId);

  const collapseAllBtn = parentIds.length > 0 ? (
    <button onClick={allCollapsed ? expandAll : collapseAll} className="rounded-md px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
      {allCollapsed ? `▾ ${t('Expand all replies')}` : `▸ ${t('Collapse all replies')}`}
    </button>
  ) : null;

  const list = (
    <div className="space-y-2">
      {comments.length === 0 ? <p className="text-xs text-neutral-400">{emptyText ?? t('No comments yet.')}</p> : null}
      {comments.map((c) => (
        <Card key={c.id} c={c} canComment={canComment} canModerate={canModerate} collapsed={collapsed} onToggleCollapse={toggleCollapse} onPost={reply} onDelete={onDelete} />
      ))}
    </div>
  );

  const composer = canComment ? (
    <div className="mt-3">
      <MarkdownEditor value={text} onChange={setText} title={t(label === 'Feedback' ? 'Add feedback' : 'Add a comment')} minRows={3} placeholder={placeholder ?? t('Write a comment… (supports **bold**, *italics*, ## headings, lists, [links](https://…))')} />
      <button disabled={busy || !text.trim()} onClick={() => post(text)} className="mt-1 rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">{busy ? t('Posting…') : t(submitLabel)}</button>
    </div>
  ) : null;

  // Rule Docs / Decisions: a collapsible "Feedback (N)" section (default collapsed).
  if (collapsibleSection) {
    return (
      <div className="mt-6">
        <button onClick={() => setSectionOpen((o) => !o)} className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100">
          <span className={`inline-block transition-transform ${sectionOpen ? 'rotate-90' : ''}`}>›</span>
          {t(label)} <span className="text-blue-600 dark:text-blue-400">({count})</span>
          <span className="text-xs font-normal text-neutral-400">{sectionOpen ? t('Hide') : t('Show')}</span>
        </button>
        {sectionOpen ? (
          <>
            {collapseAllBtn ? <div className="mb-2 flex justify-end">{collapseAllBtn}</div> : null}
            {list}
            {composer}
          </>
        ) : null}
      </div>
    );
  }

  // Requests: inline thread.
  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t(label)} <span className="text-blue-600 dark:text-blue-400">({count})</span></div>
        {collapseAllBtn}
      </div>
      {list}
      {composer}
    </div>
  );
}
