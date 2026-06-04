import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './context/AuthContext';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { BorrowCoinsPage } from './pages/BorrowCoinsPage';
import { Dashboard } from './pages/Dashboard';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LeaguesPage } from './pages/LeaguesPage';
import { ResultsPage } from './pages/ResultsPage';
import type { League } from './types';

export type Tab = 'leagues' | 'matches' | 'finished' | 'leaderboard' | 'borrow' | 'results' | 'admin';

export default function App() {
  const { session, profile, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('leagues');
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);

  useEffect(() => {
    if (tab === 'admin' && profile?.role !== 'admin') {
      setTab('leagues');
    }
  }, [tab, profile?.role]);

  if (loading) {
    return (
      <main className="loading-screen">
        <div className="spinner" />
        <p>Loading prediction board…</p>
      </main>
    );
  }

  if (!session || !profile) {
    return <AuthPage />;
  }

  return (
    <Layout activeTab={tab} selectedLeague={selectedLeague} onTabChange={setTab}>
      {tab === 'leagues' && (
        <LeaguesPage
          selectedLeague={selectedLeague}
          onLeagueSelected={setSelectedLeague}
          onLeagueDeleted={(leagueId) => {
            if (selectedLeague?.id === leagueId) setSelectedLeague(null);
          }}
          onOpenLeague={() => setTab('matches')}
        />
      )}
      {tab === 'matches' && (
        <Dashboard
          selectedLeague={selectedLeague}
          matchStatus="upcoming"
          onLeagueSelected={setSelectedLeague}
          onChooseLeague={() => setTab('leagues')}
        />
      )}
      {tab === 'finished' && (
        <Dashboard
          selectedLeague={selectedLeague}
          matchStatus="finished"
          onLeagueSelected={setSelectedLeague}
          onChooseLeague={() => setTab('leagues')}
        />
      )}
      {tab === 'leaderboard' && <LeaderboardPage selectedLeague={selectedLeague} onChooseLeague={() => setTab('leagues')} />}
      {tab === 'borrow' && (
        <BorrowCoinsPage
          selectedLeague={selectedLeague}
          onLeagueSelected={setSelectedLeague}
          onChooseLeague={() => setTab('leagues')}
        />
      )}
      {tab === 'results' && <ResultsPage selectedLeague={selectedLeague} onChooseLeague={() => setTab('leagues')} />}
      {tab === 'admin' && <AdminPage />}
    </Layout>
  );
}
