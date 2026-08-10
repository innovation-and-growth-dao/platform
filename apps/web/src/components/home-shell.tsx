'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { usePrefs } from '@/lib/prefs-context';
import { useUrlNav } from '@/lib/use-url-nav';
import { brand } from '@/lib/brand';
import { NavIcon } from './nav-icons';
import { ConnectWallet } from './connect-wallet';
import { MemberArea } from './member-area';
import { RoundsSection } from './rounds-section';
import { DaoOverview } from './dao-overview';
import { DaoMembersDirectory } from './dao-members-directory';
import { GovernanceSetup } from './governance-setup';
import { OnChainProofs } from './on-chain-proofs';
import { TreasuryOverview } from './treasury-overview';
import { ActiveProposals } from './active-proposals';
import { InternalProposals } from './internal-proposals';
import { ProposalDetail } from './proposal-detail';
import { JoinDaoButton } from './join-dao-button';
import { NotificationBadge } from './notification-badge';
import { NotificationBell } from './notification-bell';
import { SubmittersDirectory } from './submitters-directory';
import { ExpertsDirectory } from './experts-directory';
import { WalletStatusBanner } from './wallet-status-banner';
import { useTodoCounts, todoTotal } from '@/lib/use-todo-counts';
import { HealthBadge } from '@/app/health-badge';

type View = 'overview' | 'members' | 'submitters' | 'experts' | 'me' | 'rounds' | 'proposals' | 'internal' | 'proofs' | 'treasury' | 'setup';
const NAV: { key: View; label: string; icon: string; boardOnly?: boolean }[] = [
  // §2 — "My area" first: it is the member's home (to-dos, profile, proposals).
  { key: 'me', label: 'My area', icon: 'user' },
  { key: 'overview', label: 'DAO Member overview', icon: 'dashboard' },
  { key: 'members', label: 'DAO members', icon: 'users' },
  { key: 'submitters', label: 'Submitters', icon: 'send' },
  { key: 'experts', label: 'Experts', icon: 'award' },
  { key: 'rounds', label: 'Rounds', icon: 'rounds' },
  { key: 'proposals', label: 'Funding proposals', icon: 'file-text' },
  { key: 'internal', label: 'Internal proposals', icon: 'clipboard' },
  { key: 'proofs', label: 'On-chain proofs', icon: 'shield' },
  { key: 'treasury', label: 'Treasury', icon: 'landmark' },
  { key: 'setup', label: 'Platform setup', icon: 'settings', boardOnly: true },
];

export function HomeShell() {
  const { profile, loading } = useAuth();
  const { t } = usePrefs();
  const { get, setParams } = useUrlNav();
  // The active menu view + an optionally-open proposal come from the URL, so every screen
  // (and any open proposal) has its own shareable link. Switching the menu clears submenu state.
  const view = (NAV.some((n) => n.key === get('view')) ? get('view') : 'overview') as View;
  const openProposal = get('proposal');
  // Switching the menu (or signing in as a different user) clears all sub-navigation —
  // tab inside My-area, opened round / funding proposal, opened internal proposal (`ip`).
  const [viewNonce, setViewNonce] = useState(0);
  const setView = (v: View) => {
    if (v === view) setViewNonce((n) => n + 1); // same item → reset to its overview
    setParams({ view: v, tab: null, round: null, proposal: null, ip: null, expert: null });
  };

  // Reset sub-navigation whenever the signed-in user changes (login / logout / switch wallet) so
  // a fresh login never inherits the previous user's open detail page (e.g. an ?ip= internal
  // proposal). Top-level view is kept — the user lands on the same menu item, just clean.
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = profile?.user?.id ?? null;
    if (prevUserIdRef.current !== id) {
      prevUserIdRef.current = id;
      setParams({ tab: null, round: null, proposal: null, ip: null });
    }
  }, [profile, setParams]);

  // §20 — left-nav My-area to-do badge. Computed for every render (even
  // logged-out / loading) so the hook ordering matches the post-login render
  // — Rules of Hooks forbid calling a hook only after an early return. The
  // hook itself returns 0 when there's no role/auth, so the badge is hidden.
  const isBoard = profile?.roles.includes('BOARD') ?? false;
  // Match member-area's definition (EXPERT handled inside the hook via the reward-address nag)
  // so the left-nav badge, the login-box badge, and the in-area tab badges all agree.
  const canVote = (profile?.roles.includes('DREP') || profile?.roles.includes('DAO_MEMBER') || profile?.roles.includes('BOARD')) ?? false;
  // Bumped by the login-box "refresh" button to force an immediate re-check of the to-dos.
  const [todoRefresh, setTodoRefresh] = useState(0);
  const todoCounts = useTodoCounts(isBoard, canVote, !!profile, todoRefresh);
  const myAreaTodo = todoTotal(todoCounts);

  // Logged out (or restoring): centered landing with the wallet login.
  if (loading || !profile) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">{brand.name}</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {t('Cardano governance platform (Preprod).')}
        </p>
        <div className="mt-6 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <ConnectWallet />
        </div>
        <div className="mt-8 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
          <HealthBadge />
        </div>
      </main>
    );
  }

  const nav = NAV.filter((n) => !n.boardOnly || isBoard);
  const canJoin =
    profile.onchainDrep.registered &&
    !isBoard &&
    !profile.roles.includes('DAO_MEMBER') &&
    profile.daoMembership?.status !== 'PENDING_ADMISSION';

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row">
      {/* Left: title + menu only. */}
      <aside className="lg:w-56 lg:shrink-0">
        <h1 className="mb-4 text-xl font-bold tracking-tight">{brand.name}</h1>
        <nav className="space-y-1">
          {nav.map((n) => {
            // §20 — mirror the in-area to-do count next to "My area" so users
            // see how much is awaiting them without opening the menu.
            const badge = n.key === 'me' && myAreaTodo > 0 ? myAreaTodo : 0;
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  view === n.key
                    ? 'bg-emerald-600 font-medium text-white'
                    : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}
              >
                <span className="flex items-center gap-2">
                  <NavIcon name={n.icon} className="h-4 w-4 opacity-80" />
                  {t(n.label)}
                </span>
                {badge ? (
                  <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-bold text-white tabular-nums">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-neutral-200 pt-3 text-xs text-neutral-400 dark:border-neutral-800">
          <HealthBadge />
        </div>
      </aside>

      {/* Center: content starts at the top. A ?proposal=<id> link shows that proposal on
          top of whatever view is selected, so proposal URLs are shareable from anywhere. */}
      <main key={`${view}-${viewNonce}`} className="order-last min-w-0 flex-1 lg:order-none">
        {openProposal ? (
          <section className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
            <ProposalDetail id={openProposal} onBack={() => setParams({ proposal: null })} />
          </section>
        ) : view === 'overview' ? (
          <DaoOverview />
        ) : view === 'submitters' ? (
          <SubmittersDirectory />
        ) : view === 'experts' ? (
          <ExpertsDirectory />
        ) : view === 'members' ? (
          <DaoMembersDirectory />
        ) : view === 'me' ? (
          <MemberArea />
        ) : view === 'rounds' ? (
          <RoundsSection />
        ) : view === 'proposals' ? (
          <ActiveProposals />
        ) : view === 'internal' ? (
          <InternalProposals />
        ) : view === 'proofs' ? (
          <OnChainProofs />
        ) : view === 'treasury' ? (
          <TreasuryOverview />
        ) : view === 'setup' && isBoard ? (
          <GovernanceSetup />
        ) : null}
      </main>

      {/* Right: login box (+ JOIN DAO). lg:pt-10 clears the fixed top-right language/theme switcher. */}
      <div className="space-y-2 lg:w-72 lg:shrink-0 lg:pt-10">
        <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <ConnectWallet />
          {/* Jump straight to My area → the tab that has work (Actions, then Applications, then Voting). */}
          <div className="flex items-center gap-2">
            <NotificationBadge counts={todoCounts} onNavigate={(tab) => setParams({ view: 'me', tab, round: null, proposal: null, ip: null })} />
            {/* §20.3 — the jobs feed (payments seen, grace expiry, overdue stages, reminders). */}
            <NotificationBell />
            {/* §20 — re-check the to-do counts now (e.g. right after clearing an action). */}
            <button
              type="button"
              onClick={() => setTodoRefresh((n) => n + 1)}
              title={t('Refresh notifications / to-do counts')}
              aria-label={t('Refresh notifications')}
              className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              ↻
            </button>
          </div>
          <button
            onClick={() => setView('me')}
            className="text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {t('View profile')} →
          </button>
        </div>
        {/* §20 — persistent warning when the user is logged in but the wallet
            extension is no longer injected (disabled / different browser
            profile / restart). Polls every 5s so re-enabling clears it. */}
        <WalletStatusBanner />
        {canJoin ? <JoinDaoButton onJoin={() => setView('me')} /> : null}
      </div>
    </div>
  );
}
