import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { League, Match, MatchStatus, Prediction } from '../types';

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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile || !selectedLeague) return;
    setLoading(true);
    setError(null);

    try {
      const [{ data: matchesData, error: matchesError }, { data: predictionsData, error: predictionsError }] = await Promise.all([
        supabase
          .from('matches')
          .select('*')
          .eq('status', matchStatus)
          .order('match_time', { ascending: matchStatus === 'upcoming' }),
        supabase
          .from('predictions')
          .select('*')
          .eq('user_id', profile.id),
      ]);

      if (matchesError) throw matchesError;
      if (predictionsError) throw predictionsError;

      setMatches((matchesData ?? []) as Match[]);
      setPredictions((predictionsData ?? []) as Prediction[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load matches.');
    } finally {
      setLoading(false);
    }
  }, [profile, selectedLeague, matchStatus]);

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
              key={match.id}
              match={match}
              prediction={predictionByMatch[match.id]}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </section>
  );
}
