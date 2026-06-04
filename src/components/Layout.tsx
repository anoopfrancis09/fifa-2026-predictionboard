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

const menuIcon: Record<Tab, string> = {
  leagues: '👥',
  matches: '⚽',
  finished: '✅',
  leaderboard: '🏆',
  borrow: '🪙',
  results: '📊',
  admin: '⚙️',
};

const mobileScreenMeta: Record<Tab, { title: string; subtitle: string }> = {
  leagues: { title: '👥 Leagues', subtitle: 'Choose where to play' },
  matches: { title: '⚽ Upcoming Matches', subtitle: 'Place your predictions' },
  finished: { title: '✅ Finished Matches', subtitle: 'Review settled games' },
  leaderboard: { title: '🏆 Leaderboard', subtitle: 'Top predictors' },
  borrow: { title: '🪙 Borrow Coins', subtitle: 'Request and return coins' },
  results: { title: '📊 Match Results', subtitle: 'Your prediction history' },
  admin: { title: '⚙️ Admin Panel', subtitle: 'Manage platform' },
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
  const isLeagueBalance = Boolean(selectedLeague);
  const visibleBalance = isLeagueBalance ? selectedLeague?.wallet_balance ?? 0 : profile?.balance ?? 0;
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
          <h1>⚽ FIFA 2026 World Cup Prediction Site</h1>
          <p>{selectedLeague ? selectedLeague.name : 'Pick a league, predict matches, and climb the table'}</p>
        </header>

        <div className="screen-navigation" role="tablist" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <button
              key={item.tab}
              className={activeTab === item.tab ? 'nav-btn active' : 'nav-btn'}
              onClick={() => changeTab(item.tab)}
            >
              <span aria-hidden="true">{menuIcon[item.tab]}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="screen active">
          <header className="mobile-header">
            <div className="mobile-header-top">
              <div className="mobile-brand">
                <div className="mobile-brand-icon">{profile?.role === 'admin' && activeTab === 'admin' ? '⚙️' : '⚽'}</div>
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
                <div className="mobile-user-avatar">{profile?.role === 'admin' ? '⚙️' : initials}</div>
                <div>
                  <div className="mobile-user-name">{profile?.username}</div>
                  <div className="mobile-balance-label">{selectedLeague?.name ?? activeMeta.subtitle}</div>
                </div>
              </div>
              <BalanceBadge
                balance={visibleBalance}
                owingBalance={isLeagueBalance ? undefined : profile?.owing_balance ?? 0}
                label={isLeagueBalance ? 'League balance' : 'Balance'}
              />
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
                  <div className="mobile-brand-icon">{profile?.role === 'admin' ? '⚙️' : '⚽'}</div>
                  <span>{profile?.role === 'admin' ? 'Admin Panel' : 'FIFA 2026'}</span>
                </div>
                <button className="mobile-menu-close" type="button" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)}>
                  ×
                </button>
              </div>

              <div className="mobile-menu-user">
                <div className="mobile-user-avatar">{profile?.role === 'admin' ? '⚙️' : initials}</div>
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
                    <span className="mobile-menu-icon" aria-hidden="true">{menuIcon[item.tab]}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.tab === 'leagues' ? 'Manage active leagues' : item.tab === 'borrow' ? 'Request or return coins' : 'Open section'}</small>
                    </span>
                    <span className="mobile-menu-arrow">→</span>
                  </button>
                ))}
              </div>

              <p className="mobile-menu-kicker">Account</p>
              <button className="mobile-menu-item danger" type="button" onClick={signOut}>
                <span className="mobile-menu-icon" aria-hidden="true">🚪</span>
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
                <div className="user-avatar">{profile?.role === 'admin' ? '⚙️' : initials}</div>
                <div className="user-name">{profile?.username}</div>
                <BalanceBadge
                  balance={visibleBalance}
                  owingBalance={isLeagueBalance ? undefined : profile?.owing_balance ?? 0}
                  label={isLeagueBalance ? 'League balance' : 'Balance'}
                />
              </div>

              <ul className="sidebar-menu">
                {visibleItems.map((item) => (
                  <li key={item.tab}>
                    <button
                      className={activeTab === item.tab ? 'active' : ''}
                      onClick={() => changeTab(item.tab)}
                    >
                      <span aria-hidden="true">{menuIcon[item.tab]}</span>
                      {item.label}
                    </button>
                  </li>
                ))}
                <li>
                  <button onClick={signOut}>
                    <span aria-hidden="true">🚪</span>
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
