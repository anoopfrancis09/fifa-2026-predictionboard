import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { choiceLabel, formatDateTime, resultTone, weightLabel } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import type { Match, MatchResultRow, Prediction } from '../types';

function formatCoins(value: number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} coins`;
}

function formatSignedCoins(value: number | null | undefined) {
  const numericValue = Number(value ?? 0);
  const sign = numericValue > 0 ? '+' : '';
  return `${sign}${numericValue.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} coins`;
}

export function ResultsPage() {
  const { profile } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [predictionByMatch, setPredictionByMatch] = useState<Record<string, Prediction>>({});
  const [rows, setRows] = useState<MatchResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId);
  const selectedPrediction = selectedMatch ? predictionByMatch[selectedMatch.id] : undefined;

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

    if (profile && finishedMatches.length > 0) {
      const { data: predictionData, error: predictionError } = await supabase
        .from('predictions')
        .select('*')
        .eq('user_id', profile.id)
        .in('match_id', finishedMatches.map((match) => match.id));

      if (predictionError) {
        setError(predictionError.message);
      } else {
        setPredictionByMatch(
          ((predictionData ?? []) as Prediction[]).reduce<Record<string, Prediction>>((acc, prediction) => {
            acc[prediction.match_id] = prediction;
            return acc;
          }, {})
        );
      }
    } else {
      setPredictionByMatch({});
    }

    if (!selectedMatchId && finishedMatches.length > 0) {
      setSelectedMatchId(finishedMatches[0].id);
    }
    setLoading(false);
  }, [profile, selectedMatchId]);

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
            {matches.map((match) => {
              const prediction = predictionByMatch[match.id];
              return (
                <button
                  key={match.id}
                  className={selectedMatchId === match.id ? 'active' : ''}
                  onClick={() => setSelectedMatchId(match.id)}
                >
                  <strong>{match.team_a} vs {match.team_b}</strong>
                  <span>{formatDateTime(match.match_time)}</span>
                  <span className="result-card-detail">Result: {match.result ? choiceLabel(match.result, match) : 'Unavailable'}</span>
                  {prediction ? (
                    <span className={prediction.net_amount >= 0 ? 'result-card-net positive' : 'result-card-net negative'}>
                      {prediction.net_amount >= 0 ? 'Earned' : 'Lost'} {formatSignedCoins(prediction.net_amount)}
                    </span>
                  ) : (
                    <span className="result-card-net neutral">No prediction placed</span>
                  )}
                </button>
              );
            })}
          </aside>

          <div className="panel-card wide">
            {error && <p className="error-text">{error}</p>}
            {selectedMatch && (
              <div className="result-summary-card">
                <div className="result-header">
                  <div>
                    <p className="eyebrow">Final result</p>
                    <h2>{selectedMatch.result && choiceLabel(selectedMatch.result, selectedMatch)}</h2>
                    <p className="muted-text">{selectedMatch.team_a} vs {selectedMatch.team_b} • {formatDateTime(selectedMatch.match_time)}</p>
                  </div>
                  <span className="status-pill finished">Finished</span>
                </div>

                {selectedPrediction ? (
                  <div className="user-result-grid">
                    <div>
                      <span>Your prediction</span>
                      <strong>{choiceLabel(selectedPrediction.choice, selectedMatch)}</strong>
                    </div>
                    <div>
                      <span>Stake</span>
                      <strong>{formatCoins(selectedPrediction.amount)}</strong>
                    </div>
                    <div>
                      <span>Payout</span>
                      <strong>{formatCoins(selectedPrediction.payout_amount)}</strong>
                    </div>
                    <div className={resultTone(selectedPrediction.net_amount)}>
                      <span>{selectedPrediction.net_amount >= 0 ? 'Earnings' : 'Loss'}</span>
                      <strong>{formatSignedCoins(selectedPrediction.net_amount)}</strong>
                    </div>
                  </div>
                ) : (
                  <p className="muted-text">You did not place a prediction for this match.</p>
                )}
              </div>
            )}

            <div className="privacy-note">
              This result grid only shows your own prediction and payout details.
            </div>

            {rows.length === 0 ? (
              <p className="muted-text">You did not place a prediction for this match.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Prediction</th>
                      <th>Weight</th>
                      <th>Stake</th>
                      <th>Payout</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.prediction_id} className="me-row">
                        <td>{row.username} (you)</td>
                        <td>{selectedMatch ? choiceLabel(row.choice, selectedMatch) : row.choice}</td>
                        <td>{weightLabel(row.choice_weight)}</td>
                        <td>{row.amount}</td>
                        <td>{row.payout_amount}</td>
                        <td className={resultTone(row.net_amount)}>{row.net_amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
