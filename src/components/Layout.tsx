import type { ReactNode } from 'react';
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
  { tab: 'results', label: 'Results' },
  { tab: 'admin', label: 'Admin', adminOnly: true },
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
  const visibleItems = menuItems.filter((item) => !item.adminOnly || profile?.role === 'admin');
  const initials = (profile?.username ?? 'User')
    .split(/[\s_-]+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

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
              onClick={() => onTabChange(item.tab)}
            >
              <span aria-hidden="true">{menuIcon[item.tab]}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div className="screen active">
          <header className="mobile-header">
            <button className="mobile-logout-button" type="button" onClick={signOut}>
              Logout
            </button>
            <h2>{mobileScreenMeta[activeTab].title}</h2>
            <p className="subtitle">{mobileScreenMeta[activeTab].subtitle}</p>
          </header>

          <div className="mobile-balance-card">
            <div className="mobile-balance-header">
              <div>
                <div className="mobile-user-name">{profile?.username}</div>
                <div className="mobile-balance-label">{selectedLeague?.name ?? 'Prediction Board'}</div>
              </div>
              <div className="mobile-user-icon">{profile?.role === 'admin' ? '⚙️' : '👤'}</div>
            </div>
            <BalanceBadge balance={profile?.balance ?? 0} owingBalance={profile?.owing_balance ?? 0} />
          </div>

          <div className="dashboard">
            <aside className="sidebar">
              <div className="user-info">
                <div className="user-avatar">{profile?.role === 'admin' ? '⚙️' : initials}</div>
                <div className="user-name">{profile?.username}</div>
                <BalanceBadge balance={profile?.balance ?? 0} owingBalance={profile?.owing_balance ?? 0} />
              </div>

              <ul className="sidebar-menu">
                {visibleItems.map((item) => (
                  <li key={item.tab}>
                    <button
                      className={activeTab === item.tab ? 'active' : ''}
                      onClick={() => onTabChange(item.tab)}
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
