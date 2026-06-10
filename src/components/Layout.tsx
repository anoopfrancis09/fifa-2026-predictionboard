import { useState, type ReactNode } from 'react';
import { BalanceBadge } from './BalanceBadge';
import { useAuth } from '../context/AuthContext';
import type { Tab } from '../App';
import type { League } from '../types';

const menuItems: Array<{ tab: Tab; label: string; adminOnly?: boolean }> = [
  { tab: 'leagues', label: 'Leagues' },
  { tab: 'matches', label: 'Upcoming Matches' },
  { tab: 'finished', label: 'Finished Matches' },
  { tab: 'leaderboard', label: 'Leaderboard' },
  { tab: 'borrow', label: 'Borrow Coins' },
  // Results view is kept in the app code, but hidden from navigation for now.
  // { tab: 'results', label: 'Results' },
  { tab: 'admin', label: 'Admin', adminOnly: true },
];

const mobileQuickTabs: Array<{ tab: Tab; label: string }> = [
  { tab: 'matches', label: 'Matches' },
  { tab: 'leaderboard', label: 'Leaderboard' },
  // Results view is kept in the app code, but hidden from mobile tabs for now.
  // { tab: 'results', label: 'Results' },
];

type IconName = Tab | 'brand' | 'logout';

function AppIcon({ name }: { name: IconName }) {
  const commonProps = {
    className: 'app-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'brand' || name === 'matches') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18" />
        <path d="M3.6 9h16.8" />
        <path d="M3.6 15h16.8" />
        <path d="M8.2 4.4c2.5 2 5.1 2 7.6 0" />
        <path d="M8.2 19.6c2.5-2 5.1-2 7.6 0" />
      </svg>
    );
  }

  if (name === 'leagues') {
    return (
      <svg {...commonProps}>
        <path d="M16 11a4 4 0 1 0-8 0" />
        <path d="M3.5 20a8.5 8.5 0 0 1 17 0" />
        <path d="M18 8.5a3 3 0 0 1 2 2.8" />
        <path d="M6 8.5a3 3 0 0 0-2 2.8" />
      </svg>
    );
  }

  if (name === 'finished') {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.6 2.6L16.5 9" />
      </svg>
    );
  }

  if (name === 'leaderboard') {
    return (
      <svg {...commonProps}>
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
        <path d="M17 6h3a3 3 0 0 1-3 3" />
        <path d="M7 6H4a3 3 0 0 0 3 3" />
      </svg>
    );
  }

  if (name === 'borrow') {
    return (
      <svg {...commonProps}>
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      </svg>
    );
  }

  if (name === 'results') {
    return (
      <svg {...commonProps}>
        <path d="M4 19V5" />
        <path d="M8 19v-7" />
        <path d="M12 19V8" />
        <path d="M16 19v-4" />
        <path d="M20 19V9" />
      </svg>
    );
  }

  if (name === 'logout') {
    return (
      <svg {...commonProps}>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M21 5v14" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="m4.9 4.9 2.1 2.1" />
      <path d="m17 17 2.1 2.1" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
      <path d="m4.9 19.1 2.1-2.1" />
      <path d="m17 7 2.1-2.1" />
    </svg>
  );
}

const mobileScreenMeta: Record<Tab, { title: string; subtitle: string }> = {
  leagues: { title: 'Leagues', subtitle: 'Choose where to play' },
  matches: { title: 'Upcoming Matches', subtitle: 'Place your predictions' },
  finished: { title: 'Finished Matches', subtitle: 'Review settled games' },
  leaderboard: { title: 'Leaderboard', subtitle: 'Top predictors' },
  borrow: { title: 'Borrow Coins', subtitle: 'Request and return coins' },
  results: { title: 'Match Results', subtitle: 'Your prediction history' },
  admin: { title: 'Admin Panel', subtitle: 'Manage platform' },
};

export function Layout({
  activeTab,
  selectedLeague,
  onTabChange,
  children,
}: {
  activeTab: Tab;
  selectedLeague: League | null;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
}) {
  const { profile, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const visibleItems = menuItems.filter((item) => !item.adminOnly || profile?.role === 'admin');
  const visibleBalance = selectedLeague?.wallet_balance ?? 0;
  const initials = (profile?.username ?? 'User')
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const activeMeta = mobileScreenMeta[activeTab];

  function changeTab(tab: Tab) {
    onTabChange(tab);
    setMobileMenuOpen(false);
  }

  return (
    <div className="app-shell">
      <div className="container">
        <header className="design-header">
          <h1>FIFA 2026 World Cup Prediction Site</h1>
          <p>{selectedLeague ? selectedLeague.name : 'Pick a league, predict matches, and climb the table'}</p>
        </header>

        <div className="screen-navigation" role="tablist" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <button
              key={item.tab}
              className={activeTab === item.tab ? 'nav-btn active' : 'nav-btn'}
              onClick={() => changeTab(item.tab)}
            >
              <AppIcon name={item.tab} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="screen active">
          <header className="mobile-header">
            <div className="mobile-header-top">
              <div className="mobile-brand">
                <div className="mobile-brand-icon"><AppIcon name={profile?.role === 'admin' && activeTab === 'admin' ? 'admin' : 'brand'} /></div>
                <span>{profile?.role === 'admin' && activeTab === 'admin' ? 'Admin Panel' : 'FIFA 2026'}</span>
              </div>
              <button className="mobile-burger-button" type="button" aria-label="Open menu" onClick={() => setMobileMenuOpen(true)}>
                <span />
                <span />
                <span />
              </button>
            </div>

            <div className="mobile-balance-card">
              <div className="mobile-profile-summary">
                <div className="mobile-user-avatar"><AppIcon name={activeTab} /></div>
                <div>
                  <div className="mobile-user-name">{profile?.username}</div>
                  <div className="mobile-balance-label">{selectedLeague?.name ?? activeMeta.subtitle}</div>
                </div>
              </div>
              {selectedLeague && <BalanceBadge balance={visibleBalance} label="League balance" />}
            </div>

            <div className="mobile-nav-tabs" role="tablist" aria-label="Mobile quick navigation">
              {mobileQuickTabs.map((item) => (
                <button
                  key={item.tab}
                  className={activeTab === item.tab ? 'mobile-nav-tab active' : 'mobile-nav-tab'}
                  type="button"
                  onClick={() => changeTab(item.tab)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>

          <div className={mobileMenuOpen ? 'mobile-menu-layer open' : 'mobile-menu-layer'} aria-hidden={!mobileMenuOpen}>
            <div className="mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} />
            <aside className="mobile-menu-drawer" aria-label="Mobile navigation menu">
              <div className="mobile-menu-header">
                <div className="mobile-brand">
                  <div className="mobile-brand-icon"><AppIcon name={profile?.role === 'admin' ? 'admin' : 'brand'} /></div>
                  <span>{profile?.role === 'admin' ? 'Admin Panel' : 'FIFA 2026'}</span>
                </div>
                <button className="mobile-menu-close" type="button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}>
                  ×
                </button>
              </div>

              <div className="mobile-menu-user">
                <div className="mobile-user-avatar">{profile?.role === 'admin' ? 'AD' : initials}</div>
                <div>
                  <strong>{profile?.username}</strong>
                  <span>{selectedLeague?.name ?? 'Prediction Board'}</span>
                </div>
              </div>

              <p className="mobile-menu-kicker">Menu</p>
              <div className="mobile-menu-list">
                {visibleItems.map((item) => (
                  <button
                    key={item.tab}
                    className={activeTab === item.tab ? 'mobile-menu-item active' : 'mobile-menu-item'}
                    type="button"
                    onClick={() => changeTab(item.tab)}
                  >
                    <span className="mobile-menu-icon"><AppIcon name={item.tab} /></span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.tab === 'leagues' ? 'Manage active leagues' : item.tab === 'borrow' ? 'Request or return league coins' : 'Open section'}</small>
                    </span>
                    <span className="mobile-menu-arrow">→</span>
                  </button>
                ))}
              </div>

              <p className="mobile-menu-kicker">Account</p>
              <button className="mobile-menu-item danger" type="button" onClick={signOut}>
                <span className="mobile-menu-icon"><AppIcon name="logout" /></span>
                <span>
                  <strong>Logout</strong>
                  <small>Leave this session</small>
                </span>
                <span className="mobile-menu-arrow">→</span>
              </button>
            </aside>
          </div>

          <div className="dashboard">
            <aside className="sidebar">
              <div className="user-info">
                <div className="user-avatar">{profile?.role === 'admin' ? 'AD' : initials}</div>
                <div className="user-name">{profile?.username}</div>
                {selectedLeague && <BalanceBadge balance={visibleBalance} label="League balance" />}
              </div>

              <ul className="sidebar-menu">
                {visibleItems.map((item) => (
                  <li key={item.tab}>
                    <button
                      className={activeTab === item.tab ? 'active' : ''}
                      onClick={() => changeTab(item.tab)}
                    >
                      <AppIcon name={item.tab} />
                      {item.label}
                    </button>
                  </li>
                ))}
                <li>
                  <button onClick={signOut}>
                    <AppIcon name="logout" />
                    Logout
                  </button>
                </li>
              </ul>
            </aside>

            <main className="main-content">{children}</main>
          </div>
        </div>
      </div>
    </div>
  );
}
