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

const defaultMatchTime = () => toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000));

export function AdminPage() {
  const { profile } = useAuth();
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [teamAWeight, setTeamAWeight] = useState('2.00');
  const [drawWeight, setDrawWeight] = useState('2.00');
  const [teamBWeight, setTeamBWeight] = useState('2.00');
  const [matchTime, setMatchTime] = useState(defaultMatchTime());
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
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

  function resetForm() {
    setTeamA('');
    setTeamB('');
    setTeamAWeight('2.00');
    setDrawWeight('2.00');
    setTeamBWeight('2.00');
    setMatchTime(defaultMatchTime());
    setEditingMatchId(null);
  }

  function startEdit(match: Match) {
    setError(null);
    setMessage(null);
    setEditingMatchId(match.id);
    setTeamA(match.team_a);
    setTeamB(match.team_b);
    setTeamAWeight(Number(match.team_a_weight).toFixed(2));
    setDrawWeight(Number(match.draw_weight).toFixed(2));
    setTeamBWeight(Number(match.team_b_weight).toFixed(2));
    setMatchTime(toLocalInputValue(new Date(match.match_time)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveMatch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (!profile || profile.role !== 'admin') throw new Error('Admin access required.');
      if (!teamA.trim() || !teamB.trim()) throw new Error('Enter both team names.');
      if (teamA.trim().toLowerCase() === teamB.trim().toLowerCase()) throw new Error('Team names must be different.');

      const parsedTeamAWeight = parseWeight(teamAWeight, `${teamA.trim()} win weight`);
      const parsedDrawWeight = parseWeight(drawWeight, 'Draw weight');
      const parsedTeamBWeight = parseWeight(teamBWeight, `${teamB.trim()} win weight`);
      const parsedMatchTime = new Date(matchTime);

      if (Number.isNaN(parsedMatchTime.getTime())) throw new Error('Enter a valid match date and time.');

      if (editingMatchId) {
        const { error: updateError } = await supabase.rpc('admin_update_match', {
          p_match_id: editingMatchId,
          p_team_a: teamA.trim(),
          p_team_b: teamB.trim(),
          p_team_a_weight: parsedTeamAWeight,
          p_draw_weight: parsedDrawWeight,
          p_team_b_weight: parsedTeamBWeight,
          p_match_time: parsedMatchTime.toISOString(),
        });

        if (updateError) throw updateError;
        setMessage('Match updated. Existing predictions will now use the updated teams/weights.');
      } else {
        const { error: insertError } = await supabase.from('matches').insert({
          team_a: teamA.trim(),
          team_b: teamB.trim(),
          team_a_weight: parsedTeamAWeight,
          draw_weight: parsedDrawWeight,
          team_b_weight: parsedTeamBWeight,
          match_time: parsedMatchTime.toISOString(),
          created_by: profile.id,
        });

        if (insertError) throw insertError;
        setMessage('Match added.');
      }

      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save match.');
    } finally {
      setLoading(false);
    }
  }

  async function deleteMatch(match: Match) {
    const confirmed = window.confirm(
      `Delete ${match.team_a} vs ${match.team_b}? If users have already placed predictions, their stake will be refunded automatically.`
    );
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error: deleteError } = await supabase.rpc('admin_delete_match', {
        p_match_id: match.id,
      });

      if (deleteError) throw deleteError;

      if (editingMatchId === match.id) resetForm();
      setMessage('Match deleted. Any existing stakes for that match were refunded.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete match.');
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
      if (editingMatchId === match.id) resetForm();
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
      <form className="panel-card" onSubmit={saveMatch}>
        <p className="eyebrow">Admin</p>
        <h2>{editingMatchId ? 'Edit match' : 'Add upcoming match'}</h2>

        {editingMatchId && (
          <p className="warning-box compact-warning">
            You are editing an existing upcoming match. Existing user predictions will remain, but the updated team names, match time and weights will be used.
          </p>
        )}

        <label className="field-label">
          Team A
          <input value={teamA} onChange={(event) => setTeamA(event.target.value)} placeholder="Argentina" />
        </label>

        <label className="field-label">
          Team B
          <input value={teamB} onChange={(event) => setTeamB(event.target.value)} placeholder="Brazil" />
        </label>

        <div className="weight-grid">
          <label className="field-label">
            {`${teamA || 'Team A'} win weight`}
            <input
              type="number"
              min="1"
              step="0.01"
              value={teamAWeight}
              disabled={teamA === ''}
              onChange={(event) => setTeamAWeight(event.target.value)}
              placeholder="2.80"
            />
          </label>

          <label className="field-label">
            {`${teamB || 'Team B'} win weight`}
            <input
              type="number"
              min="1"
              step="0.01"
              value={teamBWeight}
              disabled={teamB === ''}
              onChange={(event) => setTeamBWeight(event.target.value)}
              placeholder="2.50"
            />
          </label>

          <label className="field-label">
            Draw weight
            <input
              type="number"
              min="1"
              step="0.01"
              disabled={teamA === '' || teamB == ''}
              value={drawWeight}
              onChange={(event) => setDrawWeight(event.target.value)}
              placeholder="3.00"
            />
          </label>
        </div>

        <p className="muted-text small-note">Winning payout = bid amount × selected result weight. Losing users only lose their bid amount.</p>

        <label className="field-label">
          Match date and time
          <input type="datetime-local" value={matchTime} onChange={(event) => setMatchTime(event.target.value)} />
        </label>

        <button className="primary-button full-width" disabled={loading}>{editingMatchId ? 'Update match' : 'Add match'}</button>
        {editingMatchId && (
          <button type="button" className="ghost-button dark full-width" disabled={loading} onClick={resetForm}>Cancel edit</button>
        )}
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="panel-card wide">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Manage games</p>
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
                <div className="admin-actions">
                  <button className="ghost-button dark" type="button" onClick={() => startEdit(match)} disabled={loading}>Edit</button>
                  <button className="danger-button" type="button" onClick={() => deleteMatch(match)} disabled={loading}>Delete</button>
                  <button className="primary-button" type="button" onClick={() => finishMatch(match)} disabled={loading}>Mark finished</button>
                </div>
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
