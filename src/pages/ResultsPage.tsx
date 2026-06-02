import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { choiceLabel, formatDateTime, money, resultTone } from '../lib/format';
import type { Match, MatchResultRow } from '../types';

export function ResultsPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [rows, setRows] = useState<MatchResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: matchesError } = await supabase
      .from('matches')
      .select('*')
      .eq('status', 'finished')
      .order('match_time', { ascending: false });

    if (matchesError) {
      setError(matchesError.message);
      setLoading(false);
      return;
    }

    const finishedMatches = (data ?? []) as Match[];
    setMatches(finishedMatches);
    if (!selectedMatchId && finishedMatches.length > 0) {
      setSelectedMatchId(finishedMatches[0].id);
    }
    setLoading(false);
  }, [selectedMatchId]);

  const loadResults = useCallback(async (matchId: string) => {
    if (!matchId) return;
    setError(null);
    const { data, error: resultError } = await supabase.rpc('get_match_results', {
      p_match_id: matchId,
    });

    if (resultError) {
      setError(resultError.message);
      return;
    }

    setRows((data ?? []) as MatchResultRow[]);
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  useEffect(() => {
    loadResults(selectedMatchId);
  }, [selectedMatchId, loadResults]);

  if (loading) return <p className="page-message">Loading results…</p>;

  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settled matches</p>
          <h2>Results and payouts</h2>
        </div>
        <button className="ghost-button dark" onClick={loadMatches}>Refresh</button>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <strong>No finished matches yet.</strong>
          <p>Results will appear once the admin marks a game as finished.</p>
        </div>
      ) : (
        <div className="results-layout">
          <aside className="result-match-list">
            {matches.map((match) => (
              <button
                key={match.id}
                className={selectedMatchId === match.id ? 'active' : ''}
                onClick={() => setSelectedMatchId(match.id)}
              >
                <strong>{match.team_a} vs {match.team_b}</strong>
                <span>{formatDateTime(match.match_time)}</span>
              </button>
            ))}
          </aside>

          <div className="panel-card wide">
            {error && <p className="error-text">{error}</p>}
            {selectedMatch && (
              <div className="result-header">
                <div>
                  <p className="eyebrow">Final result</p>
                  <h2>{selectedMatch.result && choiceLabel(selectedMatch.result, selectedMatch)}</h2>
                </div>
                <span className="status-pill finished">Finished</span>
              </div>
            )}

            <div className="privacy-note">
              You can see who predicted what. Money columns are shown for your own row only; admins can see all stake and payout amounts.
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Prediction</th>
                    <th>Stake</th>
                    <th>Payout</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.prediction_id} className={row.is_me ? 'me-row' : ''}>
                      <td>{row.username}{row.is_me ? ' (you)' : ''}</td>
                      <td>{selectedMatch ? choiceLabel(row.choice, selectedMatch) : row.choice}</td>
                      <td>{money(row.amount)}</td>
                      <td>{money(row.payout_amount)}</td>
                      <td className={resultTone(row.net_amount)}>{money(row.net_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
