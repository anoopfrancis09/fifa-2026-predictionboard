import { FormEvent, useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { choiceLabel, formatDateTime, weightLabel } from '../lib/format';
import type { AdminLeagueWalletRow, BorrowRequestRow, League, Match, PredictionChoice } from '../types';

type AdminLeagueOption = Pick<League, 'id' | 'name' | 'is_private'>;

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

function formatCoins(value: number) {
  return Number(value).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const [selectedLeagueId, setSelectedLeagueId] = useState('');
  const [selectedWalletLeagueId, setSelectedWalletLeagueId] = useState('');
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [leagues, setLeagues] = useState<AdminLeagueOption[]>([]);
  const [leagueWallets, setLeagueWallets] = useState<AdminLeagueWalletRow[]>([]);
  const [walletBalanceByUserId, setWalletBalanceByUserId] = useState<Record<string, string>>({});
  const [borrowRequests, setBorrowRequests] = useState<BorrowRequestRow[]>([]);
  const [resultByMatch, setResultByMatch] = useState<Record<string, PredictionChoice>>({});
  const [loading, setLoading] = useState(false);
  const [savingWalletUserId, setSavingWalletUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [
      { data: matchesData, error: matchesError },
      { data: borrowData, error: borrowError },
      { data: leaguesData, error: leaguesError },
    ] = await Promise.all([
      supabase
        .from('matches')
        .select('*')
        .order('match_time', { ascending: true }),
      supabase.rpc('get_coin_borrow_requests'),
      supabase.rpc('get_admin_match_leagues'),
    ]);

    if (matchesError || borrowError || leaguesError) {
      setError(matchesError?.message ?? borrowError?.message ?? leaguesError?.message ?? 'Could not load admin data.');
      return;
    }

    const nextLeagues = (leaguesData ?? []) as AdminLeagueOption[];
    setMatches((matchesData ?? []) as Match[]);
    setBorrowRequests((borrowData ?? []) as BorrowRequestRow[]);
    setLeagues(nextLeagues);
    setSelectedLeagueId((currentLeagueId) => (
      nextLeagues.some((league) => league.id === currentLeagueId) ? currentLeagueId : nextLeagues[0]?.id || ''
    ));
    setSelectedWalletLeagueId((currentLeagueId) => (
      nextLeagues.some((league) => league.id === currentLeagueId) ? currentLeagueId : nextLeagues[0]?.id || ''
    ));
  }, []);

  const loadLeagueWallets = useCallback(async (leagueId: string) => {
    if (!leagueId) {
      setLeagueWallets([]);
      setWalletBalanceByUserId({});
      return;
    }

    setWalletError(null);

    const { data, error: walletsError } = await supabase.rpc('get_admin_league_wallets', {
      p_league_id: leagueId,
    });

    if (walletsError) {
      setWalletError(walletsError.message);
      setLeagueWallets([]);
      setWalletBalanceByUserId({});
      return;
    }

    const rows = (data ?? []) as AdminLeagueWalletRow[];
    setLeagueWallets(rows);
    setWalletBalanceByUserId(rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.user_id] = Number(row.wallet_balance).toFixed(2);
      return acc;
    }, {}));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (profile?.role === 'admin') {
      loadLeagueWallets(selectedWalletLeagueId);
    }
  }, [loadLeagueWallets, profile?.role, selectedWalletLeagueId]);

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
    setSelectedLeagueId(match.league_id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveMatch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (!profile || profile.role !== 'admin') throw new Error('Admin access required.');
      if (!selectedLeagueId) throw new Error('Select a league for this match.');
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
          p_league_id: selectedLeagueId,
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
          league_id: selectedLeagueId,
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

  async function updateLeagueWallet(user: AdminLeagueWalletRow) {
    if (!selectedWalletLeagueId) {
      setWalletError('Select a tournament first.');
      return;
    }

    const nextBalance = Number(walletBalanceByUserId[user.user_id]);
    if (!Number.isFinite(nextBalance) || nextBalance < 0) {
      setWalletError('Coins must be 0.00 or higher.');
      return;
    }

    setSavingWalletUserId(user.user_id);
    setWalletError(null);
    setWalletMessage(null);

    try {
      if (!profile || profile.role !== 'admin') throw new Error('Admin access required.');

      const { error: walletUpdateError } = await supabase.rpc('admin_update_league_wallet_balance', {
        p_league_id: selectedWalletLeagueId,
        p_user_id: user.user_id,
        p_balance: Number(nextBalance.toFixed(2)),
      });

      if (walletUpdateError) throw walletUpdateError;

      setWalletMessage(`${user.username}'s league coins were updated.`);
      await loadLeagueWallets(selectedWalletLeagueId);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Could not update league coins.');
    } finally {
      setSavingWalletUserId(null);
    }
  }

  if (profile?.role !== 'admin') {
    return <p className="warning-box">Admin access required.</p>;
  }

  const upcoming = matches.filter((match) => match.status === 'upcoming');
  const finished = matches.filter((match) => match.status === 'finished');
  const leagueNameById = leagues.reduce<Record<string, string>>((acc, league) => {
    acc[league.id] = league.name;
    return acc;
  }, {});
  const selectedWalletLeagueName = leagueNameById[selectedWalletLeagueId] ?? 'selected tournament';

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
          League
          <select value={selectedLeagueId} onChange={(event) => setSelectedLeagueId(event.target.value)}>
            <option value="">Select league</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}{league.is_private ? ' (Private)' : ''}
              </option>
            ))}
          </select>
        </label>

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
            <p className="eyebrow">League coins</p>
            <h2>Adjust player wallets</h2>
          </div>
          <button className="ghost-button dark" type="button" onClick={() => loadLeagueWallets(selectedWalletLeagueId)}>Refresh</button>
        </div>

        <label className="field-label admin-wallet-selector">
          Tournament
          <select
            value={selectedWalletLeagueId}
            onChange={(event) => {
              setSelectedWalletLeagueId(event.target.value);
              setWalletMessage(null);
              setWalletError(null);
            }}
          >
            <option value="">Select tournament</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name}{league.is_private ? ' (Private)' : ''}
              </option>
            ))}
          </select>
        </label>

        <p className="muted-text small-note">
          Changes here update only the league coins wallet for {selectedWalletLeagueName}.
        </p>

        {walletMessage && <p className="success-text">{walletMessage}</p>}
        {walletError && <p className="error-text">{walletError}</p>}

        {!selectedWalletLeagueId ? (
          <p className="muted-text">Select a tournament to edit player coins.</p>
        ) : leagueWallets.length === 0 ? (
          <p className="muted-text">No players are in this tournament yet.</p>
        ) : (
          <div className="table-wrap admin-wallet-table">
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>League coins</th>
                  <th>Last updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {leagueWallets.map((user) => {
                  const balanceValue = walletBalanceByUserId[user.user_id] ?? '';
                  const parsedBalance = Number(balanceValue);
                  const unchanged = Number.isFinite(parsedBalance) && Number(parsedBalance.toFixed(2)) === Number(user.wallet_balance);
                  return (
                    <tr key={user.user_id}>
                      <td>{user.username}</td>
                      <td>
                        <input
                          aria-label={`${user.username} league coins`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={balanceValue}
                          onChange={(event) => setWalletBalanceByUserId((prev) => ({
                            ...prev,
                            [user.user_id]: event.target.value,
                          }))}
                        />
                      </td>
                      <td>{formatDateTime(user.updated_at)}</td>
                      <td>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={savingWalletUserId === user.user_id || unchanged}
                          onClick={() => updateLeagueWallet(user)}
                        >
                          Update
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="finished-summary">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Manage games</p>
              <h2>Upcoming matches</h2>
            </div>
            <button className="ghost-button dark" type="button" onClick={load}>Refresh</button>
          </div>

          {upcoming.length === 0 ? (
            <p className="muted-text">No upcoming matches.</p>
          ) : (
            <div className="admin-match-list">
              {upcoming.map((match) => (
                <div className="admin-match-row" key={match.id}>
                  <div>
                    <strong>{match.team_a} vs {match.team_b}</strong>
                    <span>League: {leagueNameById[match.league_id] ?? 'Unknown league'}</span>
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
        </div>

        {finished.length > 0 && (
          <div className="finished-summary">
            <h3>Finished</h3>
            {finished.map((match) => (
              <p key={match.id}>
                {match.team_a} vs {match.team_b}
                {' '}({leagueNameById[match.league_id] ?? 'Unknown league'}):{' '}
                <strong>{match.result && choiceLabel(match.result, match)}</strong>
              </p>
            ))}
          </div>
        )}

        <div className="finished-summary">
          <h3>Borrowing history</h3>
          {borrowRequests.length === 0 ? (
            <p className="muted-text">No borrow requests yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Lender</th>
                    <th>Amount</th>
                    <th>Owed</th>
                    <th>Outstanding</th>
                    <th>Status</th>
                    <th>Requested</th>
                    <th>Returned</th>
                  </tr>
                </thead>
                <tbody>
                  {borrowRequests.map((request) => (
                    <tr key={request.request_id}>
                      <td>{request.borrower_username}</td>
                      <td>{request.lender_username}</td>
                      <td className="coin-balance">{formatCoins(request.amount)} coins</td>
                      <td className="coin-balance">{formatCoins(request.owed_amount)} coins</td>
                      <td className={request.outstanding_amount > 0 ? 'negative' : 'neutral'}>{formatCoins(request.outstanding_amount)} coins</td>
                      <td><span className={`borrow-status ${request.status}`}>{request.status}</span></td>
                      <td>{formatDateTime(request.requested_at)}</td>
                      <td>{request.repaid_at ? formatDateTime(request.repaid_at) : 'Not returned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
