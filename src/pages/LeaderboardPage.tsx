import { useCallback, useEffect, useState } from 'react';
import { LeagueSelectionGate } from '../components/LeagueSelectionGate';
import { supabase } from '../lib/supabase';
import type { League, LeaderboardRow } from '../types';

function formatCoins(value: number) {
  return Number(value).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPoints(value: number) {
  return Number(value).toLocaleString('en-AU', {
    maximumFractionDigits: 0,
  });
}

function rankMedal(index: number) {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return index + 1;
}

export function LeaderboardPage({
  selectedLeague,
  onLeagueSelected,
  onChooseLeague,
  onChangeLeague,
}: {
  selectedLeague: League | null;
  onLeagueSelected: (league: League) => void;
  onChooseLeague: () => void;
  onChangeLeague: () => void;
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedLeague) return;
    setLoading(true);
    setError(null);

    const { data, error: leaderboardError } = await supabase.rpc('get_league_leaderboard', {
      p_league_id: selectedLeague.id,
    });

    if (leaderboardError) {
      setError(leaderboardError.message);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as LeaderboardRow[]);
    setLoading(false);
  }, [selectedLeague]);

  useEffect(() => {
    load();
  }, [load]);

  if (!selectedLeague) {
    return (
      <LeagueSelectionGate
        title="Select a league for the leaderboard"
        description="Leaderboard rankings are calculated inside the league you choose."
        actionLabel="View leaderboard"
        emptyTitle="Join a league first."
        emptyDescription="Join or create a league, then come back here to view its leaderboard."
        onLeagueSelected={onLeagueSelected}
        onChooseLeague={onChooseLeague}
      />
    );
  }

  if (loading) return <p className="page-message">Loading leaderboard…</p>;

  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Leaderboard</p>
          <h2>{selectedLeague.name}</h2>
        </div>
        <div className="section-actions">
          <button className="ghost-button dark" type="button" onClick={onChangeLeague}>Change league</button>
          <button className="ghost-button dark" type="button" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className="panel-card wide">
        {error && <p className="error-text">{error}</p>}

        {rows.length === 0 ? (
          <p className="muted-text">No users found.</p>
        ) : (
          <>
            <div className="mobile-leaderboard-list">
              {rows.map((row, index) => (
                <article key={row.user_id} className={`mobile-rank-card ${index < 3 ? 'top-rank' : ''} ${row.is_me ? 'me-rank' : ''}`}>
                  <div className="mobile-rank-medal">{rankMedal(index)}</div>
                  <div className="mobile-rank-info">
                    <strong>{row.username}{row.is_me ? ' (you)' : ''}</strong>
                    <span>League balance</span>
                  </div>
                  <strong className="mobile-rank-points">{formatPoints(row.total_balance)}</strong>
                </article>
              ))}
            </div>

            <div className="table-wrap leaderboard-table-wrap">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>League balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.user_id} className={row.is_me ? 'me-row' : ''}>
                      <td>{row.username}{row.is_me ? ' (you)' : ''}</td>
                      <td className="coin-balance">{formatCoins(row.total_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
