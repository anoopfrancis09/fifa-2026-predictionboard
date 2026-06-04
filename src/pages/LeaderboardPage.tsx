import { useCallback, useEffect, useState } from 'react';
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

export function LeaderboardPage({ selectedLeague, onChooseLeague }: { selectedLeague: League | null; onChooseLeague: () => void }) {
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
      <div className="empty-state">
        <strong>Choose a league first.</strong>
        <p>Leaderboards are calculated from users inside a league.</p>
        <button className="primary-button" onClick={onChooseLeague}>View leagues</button>
      </div>
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
        <button className="ghost-button dark" onClick={load}>Refresh</button>
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
