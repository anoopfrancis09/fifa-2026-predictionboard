import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './context/AuthContext';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { Dashboard } from './pages/Dashboard';
import { ResultsPage } from './pages/ResultsPage';

type Tab = 'matches' | 'results' | 'admin';

export default function App() {
  const { session, profile, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('matches');

  useEffect(() => {
    if (tab === 'admin' && profile?.role !== 'admin') {
      setTab('matches');
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
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'matches' && <Dashboard />}
      {tab === 'results' && <ResultsPage />}
      {tab === 'admin' && <AdminPage />}
    </Layout>
  );
}
