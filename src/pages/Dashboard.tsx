import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { choiceLabel, formatDateTime } from '../lib/format';
import type { League, Match, MatchBidRow, MatchStatus, Prediction } from '../types';

function MatchBidListPage({
  league,
  match,
  onBack,
}: {
  league: League;
  match: Match;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<MatchBidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: listError } = await supabase.rpc('get_locked_match_bid_list', {
      p_league_id: league.id,
      p_match_id: match.id,
    });

    if (listError) {
      setError(listError.message);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as MatchBidRow[]);
    setLoading(false);
  }, [league.id, match.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="bid-list-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Locked bid list</p>
          <h2>{match.team_a} vs {match.team_b}</h2>
          <p className="muted-text">{league.name} • {formatDateTime(match.match_time)}</p>
        </div>
        <button className="ghost-button dark" type="button" onClick={onBack}>Back</button>
      </div>

      {loading ? (
        <p className="page-message">Loading bids...</p>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <strong>No bids yet.</strong>
          <p>No users have placed a bid for this match in this league.</p>
        </div>
      ) : (
        <div className="bid-list-grid">
          {rows.map((row) => (
            <article key={row.prediction_id} className={`bid-list-row ${row.is_me ? 'is-me' : ''}`}>
              <div>
                <strong>{row.username}{row.is_me ? ' (you)' : ''}</strong>
                <span>{formatDateTime(row.created_at)}</span>
              </div>
              <div>
                <span>Prediction</span>
                <strong>{choiceLabel(row.choice, match)}</strong>
              </div>
              <div>
                <span>Bid amount</span>
                <strong>{Number(row.amount).toLocaleString('en-AU')} coins</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function Dashboard({
  selectedLeague,
  matchStatus,
  onLeagueSelected,
  onChooseLeague,
}: {
  selectedLeague: League | null;
  matchStatus: MatchStatus;
  onLeagueSelected: (league: League) => void;
  onChooseLeague: () => void;
}) {
  const { profile } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingLeagues, setCheckingLeagues] = useState(false);
  const [hasJoinedLeague, setHasJoinedLeague] = useState<boolean | null>(null);
  const [bidListMatch, setBidListMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile || !selectedLeague) return;
    setLoading(true);
    setError(null);

    try {
      const [
        { data: matchesData, error: matchesError },
        { data: predictionsData, error: predictionsError },
        { data: walletData, error: walletError },
      ] = await Promise.all([
        supabase
          .from('matches')
          .select('*')
          .eq('status', matchStatus)
          .order('match_time', { ascending: matchStatus === 'upcoming' }),
        supabase
          .from('predictions')
          .select('*')
          .eq('user_id', profile.id)
          .eq('league_id', selectedLeague.id),
        supabase.rpc('get_my_league_wallet_balance', {
          p_league_id: selectedLeague.id,
        }),
      ]);

      if (matchesError) throw matchesError;
      if (predictionsError) throw predictionsError;
      if (walletError) throw walletError;

      setMatches((matchesData ?? []) as Match[]);
      setPredictions((predictionsData ?? []) as Prediction[]);
      const nextWalletBalance = Number(walletData ?? selectedLeague.wallet_balance ?? 0);
      if (nextWalletBalance !== selectedLeague.wallet_balance) {
        onLeagueSelected({ ...selectedLeague, wallet_balance: nextWalletBalance });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load matches.');
    } finally {
      setLoading(false);
    }
  }, [profile, selectedLeague?.id, selectedLeague?.wallet_balance, matchStatus, onLeagueSelected]);

  useEffect(() => {
    if (!profile || selectedLeague) {
      setCheckingLeagues(false);
      setHasJoinedLeague(selectedLeague ? true : null);
      return;
    }

    let ignore = false;

    async function selectJoinedLeague() {
      setCheckingLeagues(true);
      setError(null);

      try {
        const { data, error: leaguesError } = await supabase.rpc('get_visible_leagues');
        if (leaguesError) throw leaguesError;

        if (ignore) return;

        const joinedLeague = ((data ?? []) as League[]).find((league) => league.is_member);
        if (joinedLeague) {
          setHasJoinedLeague(true);
          onLeagueSelected(joinedLeague);
        } else {
          setHasJoinedLeague(false);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Could not check your leagues.');
      } finally {
        if (!ignore) setCheckingLeagues(false);
      }
    }

    selectJoinedLeague();

    return () => {
      ignore = true;
    };
  }, [profile, selectedLeague, onLeagueSelected]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setBidListMatch(null);
  }, [selectedLeague?.id, matchStatus]);

  const predictionByMatch = useMemo(() => {
    return predictions.reduce<Record<string, Prediction>>((acc, prediction) => {
      acc[prediction.match_id] = prediction;
      return acc;
    }, {});
  }, [predictions]);

  if (!selectedLeague) {
    if (checkingLeagues || hasJoinedLeague === null) {
      return <p className="page-message">Checking your leagues…</p>;
    }

    return (
      <div className="empty-state">
        <strong>Join a league first.</strong>
        <p>You are not in any leagues yet. Join or create one, then come back here to place bids.</p>
        <button className="primary-button" onClick={onChooseLeague}>View leagues</button>
      </div>
    );
  }

  if (loading) return <p className="page-message">Loading matches…</p>;
  if (error) return <p className="error-text">{error}</p>;

  const isFinishedView = matchStatus === 'finished';

  if (bidListMatch) {
    return (
      <MatchBidListPage
        league={selectedLeague}
        match={bidListMatch}
        onBack={() => setBidListMatch(null)}
      />
    );
  }

  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{isFinishedView ? 'Settled matches' : 'Match predictions'}</p>
          <h2>{isFinishedView ? `Finished in ${selectedLeague.name}` : selectedLeague.name}</h2>
        </div>
        <button className="ghost-button dark" onClick={load}>Refresh</button>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <strong>{isFinishedView ? 'No finished matches yet.' : 'No upcoming matches yet.'}</strong>
          <p>{isFinishedView ? 'Finished matches will appear once the admin settles games.' : 'Ask the admin to add upcoming games.'}</p>
        </div>
      ) : (
        <div className="match-grid">
          {matches.map((match) => (
            <MatchCard
              key={`${selectedLeague.id}:${match.id}`}
              match={match}
              prediction={predictionByMatch[match.id]}
              leagueId={selectedLeague.id}
              leagueBalance={selectedLeague.wallet_balance ?? 0}
              onChanged={load}
              onViewBids={setBidListMatch}
            />
          ))}
        </div>
      )}
    </section>
  );
}
