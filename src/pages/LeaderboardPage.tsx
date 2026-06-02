import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { LeaderboardRow } from '../types';

function formatCoins(value: number) {
  return Number(value).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function owingTone(value: number) {
  if (value < 0) return 'positive';
  if (value > 0) return 'negative';
  return 'neutral';
}

export function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: leaderboardError } = await supabase.rpc('get_leaderboard');

    if (leaderboardError) {
      setError(leaderboardError.message);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as LeaderboardRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="page-message">Loading leaderboard…</p>;

  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Leaderboard</p>
          <h2>User balances</h2>
        </div>
        <button className="ghost-button dark" onClick={load}>Refresh</button>
      </div>

      <div className="panel-card wide">
        {error && <p className="error-text">{error}</p>}

        {rows.length === 0 ? (
          <p className="muted-text">No users found.</p>
        ) : (
          <div className="table-wrap leaderboard-table-wrap">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>User</th>
                  {/* <th>Remaining coins</th> */}
                  <th>Owing</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id} className={row.is_me ? 'me-row' : ''}>
                    <td>{row.username}{row.is_me ? ' (you)' : ''}</td>
                    {/* <td className="coin-balance">{formatCoins(row.balance)} coins</td> */}
                    <td className={owingTone(row.owing_amount)}>{formatCoins(row.owing_amount)}</td>
                    <td className="coin-balance">{formatCoins(row.total_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
