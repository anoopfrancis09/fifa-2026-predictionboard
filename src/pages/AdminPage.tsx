import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { choiceLabel, formatDateTime, weightLabel } from '../lib/format';
import type { Match, PredictionChoice } from '../types';

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function parseWeight(value: string, label: string) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight < 1) {
    throw new Error(`${label} must be 1.00 or higher.`);
  }
  return Number(weight.toFixed(2));
}

export function AdminPage() {
  const { profile } = useAuth();
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [teamAWeight, setTeamAWeight] = useState('2.00');
  const [drawWeight, setDrawWeight] = useState('2.00');
  const [teamBWeight, setTeamBWeight] = useState('2.00');
  const [matchTime, setMatchTime] = useState(toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [matches, setMatches] = useState<Match[]>([]);
  const [resultByMatch, setResultByMatch] = useState<Record<string, PredictionChoice>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: matchesError } = await supabase
      .from('matches')
      .select('*')
      .order('match_time', { ascending: true });

    if (matchesError) {
      setError(matchesError.message);
      return;
    }

    setMatches((data ?? []) as Match[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createMatch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (!profile || profile.role !== 'admin') throw new Error('Admin access required.');
      if (!teamA.trim() || !teamB.trim()) throw new Error('Enter both team names.');

      const parsedTeamAWeight = parseWeight(teamAWeight, `${teamA.trim()} win weight`);
      const parsedDrawWeight = parseWeight(drawWeight, 'Draw weight');
      const parsedTeamBWeight = parseWeight(teamBWeight, `${teamB.trim()} win weight`);

      const { error: insertError } = await supabase.from('matches').insert({
        team_a: teamA.trim(),
        team_b: teamB.trim(),
        team_a_weight: parsedTeamAWeight,
        draw_weight: parsedDrawWeight,
        team_b_weight: parsedTeamBWeight,
        match_time: new Date(matchTime).toISOString(),
        created_by: profile.id,
      });

      if (insertError) throw insertError;

      setTeamA('');
      setTeamB('');
      setTeamAWeight('2.00');
      setDrawWeight('2.00');
      setTeamBWeight('2.00');
      setMessage('Match added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add match.');
    } finally {
      setLoading(false);
    }
  }

  async function finishMatch(match: Match) {
    const result = resultByMatch[match.id];
    if (!result) {
      setError('Select the result first.');
      return;
    }

    const confirmed = window.confirm(`Finish ${match.team_a} vs ${match.team_b} as: ${choiceLabel(result, match)}? This will settle payouts using the configured weight and cannot be undone from the app.`);
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error: rpcError } = await supabase.rpc('finish_match', {
        p_match_id: match.id,
        p_result: result,
      });

      if (rpcError) throw rpcError;
      setMessage('Match finished and payouts settled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish match.');
    } finally {
      setLoading(false);
    }
  }

  if (profile?.role !== 'admin') {
    return <p className="warning-box">Admin access required.</p>;
  }

  const upcoming = matches.filter((match) => match.status === 'upcoming');
  const finished = matches.filter((match) => match.status === 'finished');

  return (
    <section className="admin-layout">
      <form className="panel-card" onSubmit={createMatch}>
        <p className="eyebrow">Admin</p>
        <h2>Add upcoming match</h2>

        <label className="field-label">
          Team A
          <input value={teamA} onChange={(event) => setTeamA(event.target.value)} placeholder="Argentina" />
        </label>

        <label className="field-label">
          Team B
          <input value={teamB} onChange={(event) => setTeamB(event.target.value)} placeholder="Brazil" />
        </label>

        <div className="weight-grid">
          {teamA !== '' && <label className="field-label">
            {`${teamA} win weight`}
            <input
              type="number"
              min="1"
              step="0.01"
              disabled={teamA == ''}
              value={teamAWeight}
              onChange={(event) => setTeamAWeight(event.target.value)}
              placeholder="2.80"
            />
          </label> }

          {teamB !== '' && <label className="field-label">
            {`${teamB} win weight`}
            <input
              type="number"
              min="1"
              step="0.01"
              disabled={teamB == ''}
              value={teamBWeight}
              onChange={(event) => setTeamBWeight(event.target.value)}
              placeholder="2.50"
            />
          </label>}

          {teamA !== '' && teamB !== '' && <label className="field-label">
            Draw weight
            <input
              type="number"
              min="1"
              step="0.01"
              value={drawWeight}
              onChange={(event) => setDrawWeight(event.target.value)}
              placeholder="3.00"
            />
          </label> }
        </div>

        <p className="muted-text small-note">Winning payout = bid amount × selected result weight. Losing users only lose their bid amount.</p>

        <label className="field-label">
          Match date and time
          <input type="datetime-local" value={matchTime} onChange={(event) => setMatchTime(event.target.value)} />
        </label>

        <button className="primary-button full-width" disabled={loading}>Add match</button>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="panel-card wide">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Settle games</p>
            <h2>Upcoming matches</h2>
          </div>
          <button className="ghost-button dark" onClick={load}>Refresh</button>
        </div>

        {upcoming.length === 0 ? (
          <p className="muted-text">No upcoming matches.</p>
        ) : (
          <div className="admin-match-list">
            {upcoming.map((match) => (
              <div className="admin-match-row" key={match.id}>
                <div>
                  <strong>{match.team_a} vs {match.team_b}</strong>
                  <span>{formatDateTime(match.match_time)}</span>
                  <span className="weight-line">
                    {match.team_a}: {weightLabel(match.team_a_weight)} · Draw: {weightLabel(match.draw_weight)} · {match.team_b}: {weightLabel(match.team_b_weight)}
                  </span>
                </div>
                <select
                  value={resultByMatch[match.id] ?? ''}
                  onChange={(event) => setResultByMatch((prev) => ({ ...prev, [match.id]: event.target.value as PredictionChoice }))}
                >
                  <option value="">Select result</option>
                  <option value="team_a">{match.team_a} win</option>
                  <option value="draw">Draw</option>
                  <option value="team_b">{match.team_b} win</option>
                </select>
                <button className="primary-button" onClick={() => finishMatch(match)} disabled={loading}>Mark finished</button>
              </div>
            ))}
          </div>
        )}

        {finished.length > 0 && (
          <div className="finished-summary">
            <h3>Finished</h3>
            {finished.map((match) => (
              <p key={match.id}>{match.team_a} vs {match.team_b}: <strong>{match.result && choiceLabel(match.result, match)}</strong></p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
