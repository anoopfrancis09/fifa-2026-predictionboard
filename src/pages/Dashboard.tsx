import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatchCard } from '../components/MatchCard';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { League, Match, Prediction } from '../types';

export function Dashboard({ selectedLeague, onChooseLeague }: { selectedLeague: League | null; onChooseLeague: () => void }) {
  const { profile } = useAuth();
  const [matches, setMatches] = useState<Match[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);

    try {
      const [{ data: matchesData, error: matchesError }, { data: predictionsData, error: predictionsError }] = await Promise.all([
        supabase
          .from('matches')
          .select('*')
          .order('match_time', { ascending: true }),
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
  }, [profile]);

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
    return (
      <div className="empty-state">
        <strong>Choose a league first.</strong>
        <p>Join or create a league, then come back here to place bids.</p>
        <button className="primary-button" onClick={onChooseLeague}>View leagues</button>
      </div>
    );
  }

  if (loading) return <p className="page-message">Loading matches…</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Match predictions</p>
          <h2>{selectedLeague.name}</h2>
        </div>
        <button className="ghost-button dark" onClick={load}>Refresh</button>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <strong>No matches yet.</strong>
          <p>Ask the admin to add upcoming games.</p>
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
