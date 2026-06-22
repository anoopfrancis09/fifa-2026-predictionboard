import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import type { League } from '../types';

type LeagueSelectionGateProps = {
  title: string;
  description: string;
  actionLabel: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onLeagueSelected: (league: League) => void;
  onChooseLeague: () => void;
};

export function LeagueSelectionGate({
  title,
  description,
  actionLabel,
  emptyTitle = 'Join a league first.',
  emptyDescription = 'Join or create a league, then come back here.',
  onLeagueSelected,
  onChooseLeague,
}: LeagueSelectionGateProps) {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const joinedLeagues = useMemo(() => leagues.filter((league) => league.is_member), [leagues]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: leaguesError } = await supabase.rpc('get_visible_leagues');

    if (leaguesError) {
      setError(leaguesError.message);
      setLoading(false);
      return;
    }

    setLeagues((data ?? []) as League[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="page-message">Loading leagues...</p>;

  if (error) {
    return (
      <div className="empty-state">
        <strong>Could not load leagues.</strong>
        <p>{error}</p>
        <button className="primary-button" type="button" onClick={load}>Try again</button>
      </div>
    );
  }

  if (joinedLeagues.length === 0) {
    return (
      <div className="empty-state">
        <strong>{emptyTitle}</strong>
        <p>{emptyDescription}</p>
        <button className="primary-button" type="button" onClick={onChooseLeague}>View leagues</button>
      </div>
    );
  }

  return (
    <section className="league-choice-panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Choose league</p>
          <h2>{title}</h2>
          <p className="muted-text">{description}</p>
        </div>
        <button className="ghost-button dark" type="button" onClick={load}>Refresh</button>
      </div>

      <div className="league-grid">
        {joinedLeagues.map((league) => (
          <article className="league-card league-choice-card" key={league.id}>
            <div className="league-card-topline">
              <span className={`status-pill ${league.is_private ? 'closed' : 'open'}`}>
                {league.is_private ? 'Private' : 'Public'}
              </span>
              {league.is_owner && <span className="bid-status-pill">Owner</span>}
            </div>
            <h4>{league.name}</h4>
            <p className="muted-text">
              Created by {league.created_by_username} on {formatDateTime(league.created_at)}
            </p>
            <p className="muted-text">{league.member_count} member{league.member_count === 1 ? '' : 's'}</p>
            <p className="muted-text">
              League balance: {Number(league.wallet_balance ?? 0).toLocaleString('en-AU')} coins
            </p>
            <div className="league-card-actions">
              <button className="primary-button" type="button" onClick={() => onLeagueSelected(league)}>
                {actionLabel}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
