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

const leagueChoiceTabs = new Set<Tab>(['matches', 'finished', 'leaderboard']);

export default function App() {
  const { session, profile, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('leagues');
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [confirmedLeagueByTab, setConfirmedLeagueByTab] = useState<Partial<Record<Tab, string>>>({});

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

  function confirmLeagueForTab(league: League, targetTab: Tab = tab) {
    setSelectedLeague(league);
    setConfirmedLeagueByTab((prev) => ({ ...prev, [targetTab]: league.id }));
  }

  function resetLeagueChoiceForTab(targetTab: Tab) {
    setConfirmedLeagueByTab((prev) => {
      const next = { ...prev };
      delete next[targetTab];
      return next;
    });
  }

  function changeTab(nextTab: Tab) {
    if (leagueChoiceTabs.has(nextTab)) {
      resetLeagueChoiceForTab(nextTab);
    }
    setTab(nextTab);
  }

  const selectedLeagueForLeagueChoiceTab = leagueChoiceTabs.has(tab)
    && confirmedLeagueByTab[tab] === selectedLeague?.id
    ? selectedLeague
    : null;

  const visibleSelectedLeague = leagueChoiceTabs.has(tab) ? selectedLeagueForLeagueChoiceTab : selectedLeague;

  return (
    <Layout activeTab={tab} selectedLeague={visibleSelectedLeague} onTabChange={changeTab}>
      {tab === 'leagues' && (
        <LeaguesPage
          selectedLeague={selectedLeague}
          onLeagueSelected={setSelectedLeague}
          onLeagueDeleted={(leagueId) => {
            if (selectedLeague?.id === leagueId) {
              setSelectedLeague(null);
              setConfirmedLeagueByTab((prev) => {
                const next = { ...prev };
                Object.entries(prev).forEach(([entryTab, confirmedLeagueId]) => {
                  if (confirmedLeagueId === leagueId) delete next[entryTab as Tab];
                });
                return next;
              });
            }
          }}
          onOpenLeague={(league) => {
            confirmLeagueForTab(league, 'matches');
            setTab('matches');
          }}
        />
      )}
      {tab === 'matches' && (
        <Dashboard
          selectedLeague={selectedLeagueForLeagueChoiceTab}
          matchStatus="upcoming"
          onLeagueSelected={(league) => confirmLeagueForTab(league, 'matches')}
          onChooseLeague={() => setTab('leagues')}
          onChangeLeague={() => resetLeagueChoiceForTab('matches')}
        />
      )}
      {tab === 'finished' && (
        <Dashboard
          selectedLeague={selectedLeagueForLeagueChoiceTab}
          matchStatus="finished"
          onLeagueSelected={(league) => confirmLeagueForTab(league, 'finished')}
          onChooseLeague={() => setTab('leagues')}
          onChangeLeague={() => resetLeagueChoiceForTab('finished')}
        />
      )}
      {tab === 'leaderboard' && (
        <LeaderboardPage
          selectedLeague={selectedLeagueForLeagueChoiceTab}
          onLeagueSelected={(league) => confirmLeagueForTab(league, 'leaderboard')}
          onChooseLeague={() => setTab('leagues')}
          onChangeLeague={() => resetLeagueChoiceForTab('leaderboard')}
        />
      )}
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
