import { useState } from 'react';
import type { ReactNode } from 'react';
import { BalanceBadge } from './BalanceBadge';
import { useAuth } from '../context/AuthContext';
import type { Tab } from '../App';
import type { League } from '../types';

const menuItems: Array<{ tab: Tab; label: string; adminOnly?: boolean }> = [
  { tab: 'leagues', label: 'Leagues' },
  { tab: 'matches', label: 'Matches' },
  { tab: 'leaderboard', label: 'Leaderboard' },
  { tab: 'borrow', label: 'Borrow' },
  { tab: 'results', label: 'Results' },
  { tab: 'admin', label: 'Admin', adminOnly: true },
];

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

  function changeTab(tab: Tab) {
    onTabChange(tab);
    setMobileMenuOpen(false);
  }

  const visibleItems = menuItems.filter((item) => !item.adminOnly || profile?.role === 'admin');

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-bg-ball" aria-hidden="true">⚽</div>
        <nav className="topbar">
          <div className="brand">
            <span className="brand-mark">🏆</span>
            <div>
              <strong>World Cup 2026</strong>
              <small>{selectedLeague ? selectedLeague.name : 'Prediction Board'}</small>
            </div>
          </div>

          <div className="user-area">
            {profile && <BalanceBadge balance={profile.balance} owingBalance={profile.owing_balance} />}
            {profile && <span className="username-pill">{profile.username}</span>}
            <button
              className="menu-button"
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
            >
              ☰
            </button>
            <button className="ghost-button" onClick={signOut}>Logout</button>
          </div>
        </nav>

        <section className="hero-content">
          <p className="eyebrow">Friendly pool • $100 starting wallet • closes 15 minutes before kick-off</p>
          <h1>Predict the match, protect your balance, climb the table.</h1>
        </section>

        <div className="tabs desktop-tabs" role="tablist" aria-label="Main navigation">
          {visibleItems.map((item) => (
            <button
              key={item.tab}
              className={activeTab === item.tab ? 'active' : ''}
              onClick={() => changeTab(item.tab)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="mobile-nav-layer" role="presentation" onClick={() => setMobileMenuOpen(false)}>
          <aside className="mobile-nav" aria-label="Mobile navigation" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-nav-header">
              <div>
                <strong>Menu</strong>
                <span>{selectedLeague?.name ?? 'No league selected'}</span>
              </div>
              <button className="menu-button close" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation">×</button>
            </div>
            <div className="mobile-nav-links">
              {visibleItems.map((item) => (
                <button
                  key={item.tab}
                  className={activeTab === item.tab ? 'active' : ''}
                  onClick={() => changeTab(item.tab)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}

      <main className="page-content">{children}</main>
    </div>
  );
}
