import type { ReactNode } from 'react';
import { BalanceBadge } from './BalanceBadge';
import { useAuth } from '../context/AuthContext';

type Tab = 'matches' | 'results' | 'admin';

export function Layout({ activeTab, onTabChange, children }: { activeTab: Tab; onTabChange: (tab: Tab) => void; children: ReactNode }) {
  const { profile, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-bg-ball" aria-hidden="true">⚽</div>
        <nav className="topbar">
          <div className="brand">
            <span className="brand-mark">🏆</span>
            <div>
              <strong>World Cup 2026</strong>
              <small>Prediction Board</small>
            </div>
          </div>

          <div className="user-area">
            {profile && <BalanceBadge balance={profile.balance} />}
            <button className="ghost-button" onClick={signOut}>Logout</button>
          </div>
        </nav>

        <section className="hero-content">
          <p className="eyebrow">Friendly pool • $100 starting wallet • closes 15 minutes before kick-off</p>
          <h1>Predict the match, protect your balance, climb the table.</h1>
          <p className="hero-subtitle">
            Pick one outcome per game: team A win, draw, or team B win. Correct predictors share the losing pool.
          </p>
        </section>

        <div className="tabs" role="tablist" aria-label="Main navigation">
          <button className={activeTab === 'matches' ? 'active' : ''} onClick={() => onTabChange('matches')}>Matches</button>
          <button className={activeTab === 'results' ? 'active' : ''} onClick={() => onTabChange('results')}>Results</button>
          {profile?.role === 'admin' && (
            <button className={activeTab === 'admin' ? 'active' : ''} onClick={() => onTabChange('admin')}>Admin</button>
          )}
        </div>
      </header>

      <main className="page-content">{children}</main>
    </div>
  );
}
