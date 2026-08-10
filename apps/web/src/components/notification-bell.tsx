'use client';

import { useCallback, useEffect, useState } from 'react';
import { notificationsApi, type AppNotification } from '@/lib/api';
import { useUrlNav } from '@/lib/use-url-nav';
import { useT } from '@/lib/prefs-context';

/**
 * §20.3 — in-app notification feed (the §27 background jobs write here: payments seen
 * on-chain, pledge grace expiry, overdue stages, reconciliation alerts, deadline reminders).
 * Separate from the to-do badge, which counts actionable items computed live.
 */
export function NotificationBell() {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const { setParams } = useUrlNav();

  const load = useCallback(() => {
    notificationsApi.unreadCount().then((r) => setUnread(r.count)).catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      try { setItems(await notificationsApi.list()); } catch { setItems([]); }
    }
  };
  const openItem = async (n: AppNotification) => {
    if (!n.readAt) { await notificationsApi.markRead(n.id).catch(() => undefined); load(); }
    if (n.payload.proposalId) setParams({ proposal: n.payload.proposalId });
    setOpen(false);
  };

  return (
    <div className="relative">
      <button onClick={toggle} title={tr('Notifications')} className="relative rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800">
        🔔
        {unread > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white tabular-nums">{unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-medium text-neutral-500">{tr('Notifications')}</span>
            {unread > 0 ? (
              <button onClick={() => { void notificationsApi.markAllRead().then(load); setItems((arr) => arr.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))); }} className="text-xs text-emerald-700 hover:underline dark:text-emerald-400">
                {tr('Mark all read')}
              </button>
            ) : null}
          </div>
          {items.length === 0 ? <p className="px-1 py-2 text-xs text-neutral-400">{tr('No notifications.')}</p> : null}
          <ul className="space-y-1">
            {items.map((n) => (
              <li key={n.id}>
                <button onClick={() => void openItem(n)} className={`block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${n.readAt ? 'text-neutral-500' : 'font-medium'}`}>
                  <div>{String(n.payload.title ?? n.kind)}</div>
                  {n.payload.body ? <div className="mt-0.5 font-normal text-neutral-500">{String(n.payload.body)}</div> : null}
                  <div className="mt-0.5 font-normal text-[10px] text-neutral-400">{new Date(n.createdAt).toLocaleString()}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
