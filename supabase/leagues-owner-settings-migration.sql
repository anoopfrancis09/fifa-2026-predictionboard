-- Owner controls for league settings.
-- Run this after the previous league migrations.
-- Deleting a league removes league membership/access only; predictions, bets, and balances stay unchanged.

drop function if exists public.get_league_private_users(uuid);
create or replace function public.get_league_private_users(p_league_id uuid)
returns table (
  user_id uuid,
  username text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.owns_league(p_league_id) then
    raise exception 'Only the league owner can view private access settings.';
  end if;

  return query
  select
    p.id as user_id,
    p.username
  from public.league_private_users lpu
  join public.profiles p on p.id = lpu.user_id
  where lpu.league_id = p_league_id
  order by lower(p.username);
end;
$$;

drop function if exists public.update_league_settings(uuid, text, boolean, uuid[]);
create or replace function public.update_league_settings(
  p_league_id uuid,
  p_name text,
  p_is_private boolean,
  p_allowed_user_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  name text,
  is_private boolean,
  created_by uuid,
  created_by_username text,
  member_count bigint,
  is_owner boolean,
  is_member boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_is_private boolean := coalesce(p_is_private, false);
begin
  if v_user is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.owns_league(p_league_id) then
    raise exception 'Only the league owner can update this league.';
  end if;

  if p_name is null or length(trim(p_name)) < 3 then
    raise exception 'League name must be at least 3 characters.';
  end if;

  if length(trim(p_name)) > 80 then
    raise exception 'League name must be 80 characters or fewer.';
  end if;

  update public.leagues l
  set name = trim(p_name),
      is_private = v_is_private
  where l.id = p_league_id;

  delete from public.league_private_users lpu
  where lpu.league_id = p_league_id;

  if v_is_private then
    insert into public.league_private_users (league_id, user_id, granted_by)
    select p_league_id, allowed.user_id, v_user
    from (
      select v_user as user_id
      union
      select unnest(coalesce(p_allowed_user_ids, '{}'::uuid[])) as user_id
    ) allowed
    join public.profiles p on p.id = allowed.user_id
    on conflict do nothing;
  end if;

  return query
  select
    visible.id,
    visible.name,
    visible.is_private,
    visible.created_by,
    visible.created_by_username,
    visible.member_count,
    visible.is_owner,
    visible.is_member,
    visible.created_at
  from public.get_visible_leagues() visible
  where visible.id = p_league_id;
end;
$$;

drop function if exists public.delete_league(uuid);
create or replace function public.delete_league(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.owns_league(p_league_id) then
    raise exception 'Only the league owner can delete this league.';
  end if;

  delete from public.leagues l
  where l.id = p_league_id;
end;
$$;

grant execute on function public.get_league_private_users(uuid) to authenticated;
grant execute on function public.update_league_settings(uuid, text, boolean, uuid[]) to authenticated;
grant execute on function public.delete_league(uuid) to authenticated;
