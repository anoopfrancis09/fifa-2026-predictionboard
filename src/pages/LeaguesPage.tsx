import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDateTime } from '../lib/format';
import type { League, LeaguePrivateUser, LeagueUserOption } from '../types';

type LeaguesPageProps = {
  selectedLeague: League | null;
  onLeagueSelected: (league: League) => void;
  onLeagueDeleted: (leagueId: string) => void;
  onOpenLeague: () => void;
};

function firstLeague(value: unknown): League | null {
  if (Array.isArray(value)) return (value[0] as League | undefined) ?? null;
  return (value as League | null) ?? null;
}

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export function LeaguesPage({ selectedLeague, onLeagueSelected, onLeagueDeleted, onOpenLeague }: LeaguesPageProps) {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [users, setUsers] = useState<LeagueUserOption[]>([]);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  const [editingLeague, setEditingLeague] = useState<League | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsPrivate, setEditIsPrivate] = useState(false);
  const [editAllowedUserIds, setEditAllowedUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [{ data: leagueData, error: leagueError }, { data: userData, error: userError }] = await Promise.all([
      supabase.rpc('get_visible_leagues'),
      supabase.rpc('get_league_user_options'),
    ]);

    if (leagueError || userError) {
      setError(leagueError?.message ?? userError?.message ?? 'Could not load leagues.');
      setLoading(false);
      return;
    }

    const nextLeagues = (leagueData ?? []) as League[];
    setLeagues(nextLeagues);
    setUsers((userData ?? []) as LeagueUserOption[]);

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const joinedLeagues = useMemo(() => leagues.filter((league) => league.is_member), [leagues]);
  const joinableLeagues = useMemo(() => leagues.filter((league) => !league.is_member), [leagues]);

  function toggleAllowedUser(userId: string) {
    setAllowedUserIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  }

  function toggleEditAllowedUser(userId: string) {
    setEditAllowedUserIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  }

  async function openSettings(league: League) {
    setEditingLeague(league);
    setEditName(league.name);
    setEditIsPrivate(league.is_private);
    setEditAllowedUserIds([]);
    setSettingsLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data, error: accessError } = await supabase.rpc('get_league_private_users', {
        p_league_id: league.id,
      });

      if (accessError) throw accessError;
      setEditAllowedUserIds(((data ?? []) as LeaguePrivateUser[]).map((user) => user.user_id));
    } catch (err) {
      setError(errorMessage(err, 'Could not load league settings.'));
    } finally {
      setSettingsLoading(false);
    }
  }

  function closeSettings() {
    setEditingLeague(null);
    setEditName('');
    setEditIsPrivate(false);
    setEditAllowedUserIds([]);
  }

  async function createLeague(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (!name.trim()) throw new Error('Enter a league name.');

      const { data, error: createError } = await supabase.rpc('create_league', {
        p_name: name.trim(),
        p_is_private: isPrivate,
        p_allowed_user_ids: isPrivate ? allowedUserIds : [],
      });

      if (createError) throw createError;

      const createdLeague = firstLeague(data);
      setName('');
      setIsPrivate(false);
      setAllowedUserIds([]);
      setMessage('League created.');
      await load();
      if (createdLeague) onLeagueSelected(createdLeague);
    } catch (err) {
      setError(errorMessage(err, 'Could not create league.'));
    } finally {
      setSaving(false);
    }
  }

  async function joinLeague(league: League) {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const { data, error: joinError } = await supabase.rpc('join_league', {
        p_league_id: league.id,
      });

      if (joinError) throw joinError;

      const joinedLeague = firstLeague(data);
      setMessage(`Joined ${joinedLeague?.name ?? league.name}.`);
      await load();
      onLeagueSelected(joinedLeague ?? { ...league, is_member: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not join league.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateLeague(event: FormEvent) {
    event.preventDefault();
    if (!editingLeague) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (!editName.trim()) throw new Error('Enter a league name.');

      const { data, error: updateError } = await supabase.rpc('update_league_settings', {
        p_league_id: editingLeague.id,
        p_name: editName.trim(),
        p_is_private: editIsPrivate,
        p_allowed_user_ids: editIsPrivate ? editAllowedUserIds : [],
      });

      if (updateError) throw updateError;

      const updatedLeague = firstLeague(data);
      setMessage('League settings updated.');
      await load();
      if (updatedLeague) {
        setEditingLeague(updatedLeague);
        setEditName(updatedLeague.name);
        setEditIsPrivate(updatedLeague.is_private);
        onLeagueSelected(updatedLeague);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not update league settings.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteLeague() {
    if (!editingLeague) return;

    const confirmed = window.confirm(`Delete ${editingLeague.name}? League membership will be removed, but bets and balances stay unchanged.`);
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const deletedLeagueId = editingLeague.id;
      const { error: deleteError } = await supabase.rpc('delete_league', {
        p_league_id: deletedLeagueId,
      });

      if (deleteError) throw deleteError;

      closeSettings();
      onLeagueDeleted(deletedLeagueId);
      setMessage('League deleted.');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete league.'));
    } finally {
      setSaving(false);
    }
  }

  function openLeague(league: League) {
    onLeagueSelected(league);
    onOpenLeague();
  }

  if (loading) return <p className="page-message">Loading leagues...</p>;

  return (
    <section className="leagues-layout">
      <form className="panel-card" onSubmit={createLeague}>
        <p className="eyebrow">Leagues</p>
        <h2>Create a league</h2>

        <label className="field-label">
          League name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Friday office pool" />
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          <span>Private league</span>
        </label>

        {isPrivate && (
          <div className="private-user-picker">
            <strong>Allow these users to see and join this league</strong>
            {users.length === 0 ? (
              <p className="muted-text">No users available yet.</p>
            ) : (
              <div className="user-check-list">
                {users.map((user) => (
                  <label key={user.user_id} className="check-row">
                    <input
                      type="checkbox"
                      checked={user.is_me || allowedUserIds.includes(user.user_id)}
                      disabled={user.is_me}
                      onChange={() => toggleAllowedUser(user.user_id)}
                    />
                    <span>{user.username}{user.is_me ? ' (you)' : ''}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <button className="primary-button full-width" disabled={saving}>
          {saving ? 'Saving...' : 'Create league'}
        </button>
        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="league-list-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Available leagues</p>
            <h2>Choose where to play</h2>
          </div>
          <button className="ghost-button dark" onClick={load}>Refresh</button>
        </div>

        {joinedLeagues.length === 0 && (
          <div className="empty-state">
            <strong>You have not joined a league yet.</strong>
            <p>Join an available league below, or create one of your own.</p>
          </div>
        )}

        {joinedLeagues.length > 0 && (
          <div className="league-section">
            <h3>Your leagues</h3>
            <div className="league-grid">
              {joinedLeagues.map((league) => (
                <LeagueCard
                  key={league.id}
                  league={league}
                  selected={selectedLeague?.id === league.id}
                  actionLabel="Open"
                  onAction={() => openLeague(league)}
                  onSettings={league.is_owner ? () => openSettings(league) : undefined}
                />
              ))}
            </div>
          </div>
        )}

        <div className="league-section">
          <h3>Leagues you can join</h3>
          {joinableLeagues.length === 0 ? (
            <p className="muted-text">No more leagues are available right now.</p>
          ) : (
            <div className="league-grid">
              {joinableLeagues.map((league) => (
                <LeagueCard
                  key={league.id}
                  league={league}
                  selected={false}
                  actionLabel="Join"
                  onAction={() => joinLeague(league)}
                  disabled={saving}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editingLeague && (
        <div className="modal-layer" role="presentation" onClick={closeSettings}>
          <form className="settings-modal" onSubmit={updateLeague} onClick={(event) => event.stopPropagation()}>
            <div className="settings-modal-header">
              <div>
                <p className="eyebrow">League owner</p>
                <h2>League settings</h2>
              </div>
              <button className="menu-button close" type="button" onClick={closeSettings} aria-label="Close settings">×</button>
            </div>

            <label className="field-label">
              League name
              <input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </label>

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={editIsPrivate}
                onChange={(event) => setEditIsPrivate(event.target.checked)}
              />
              <span>Private league</span>
            </label>

            {editIsPrivate ? (
              <div className="private-user-picker">
                <strong>Users who can see and join this private league</strong>
                {settingsLoading ? (
                  <p className="muted-text">Loading users...</p>
                ) : users.length === 0 ? (
                  <p className="muted-text">No users available yet.</p>
                ) : (
                  <div className="user-check-list">
                    {users.map((user) => (
                      <label key={user.user_id} className="check-row">
                        <input
                          type="checkbox"
                          checked={user.is_me || editAllowedUserIds.includes(user.user_id)}
                          disabled={user.is_me}
                          onChange={() => toggleEditAllowedUser(user.user_id)}
                        />
                        <span>{user.username}{user.is_me ? ' (you)' : ''}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="privacy-note">Public leagues are visible to every user, and any user can join.</p>
            )}

            <div className="settings-actions">
              <button className="danger-button" type="button" onClick={deleteLeague} disabled={saving}>Delete league</button>
              <button className="ghost-button dark" type="button" onClick={closeSettings} disabled={saving}>Cancel</button>
              <button className="primary-button" disabled={saving || settingsLoading}>{saving ? 'Saving...' : 'Save settings'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function LeagueCard({
  league,
  selected,
  actionLabel,
  onAction,
  onSettings,
  disabled,
}: {
  league: League;
  selected: boolean;
  actionLabel: string;
  onAction: () => void;
  onSettings?: () => void;
  disabled?: boolean;
}) {
  return (
    <article className={`league-card ${selected ? 'selected' : ''}`}>
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
      <div className="league-card-actions">
        <button className={league.is_member ? 'primary-button' : 'ghost-button dark'} onClick={onAction} disabled={disabled}>
          {actionLabel}
        </button>
        {onSettings && (
          <button className="ghost-button dark" type="button" onClick={onSettings}>
            Settings
          </button>
        )}
      </div>
    </article>
  );
}
