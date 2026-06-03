-- Follow-up fix for "column reference id is ambiguous" during private league joins.
-- Run this only after the previous league migrations have already been run.

drop policy if exists leagues_select_visible on public.leagues;
create policy leagues_select_visible
on public.leagues
for select
to authenticated
using (public.can_view_league(leagues.id));

drop policy if exists league_members_select_same_league on public.league_members;
create policy league_members_select_same_league
on public.league_members
for select
to authenticated
using (
  league_members.user_id = auth.uid()
  or public.can_view_league(league_members.league_id)
);

drop policy if exists league_members_insert_joinable on public.league_members;
create policy league_members_insert_joinable
on public.league_members
for insert
to authenticated
with check (
  league_members.user_id = auth.uid()
  and public.can_join_league(league_members.league_id)
);

drop policy if exists league_private_users_select_owner_or_self on public.league_private_users;
create policy league_private_users_select_owner_or_self
on public.league_private_users
for select
to authenticated
using (
  league_private_users.user_id = auth.uid()
  or public.owns_league(league_private_users.league_id)
);

drop function if exists public.join_league(uuid);
create or replace function public.join_league(p_league_id uuid)
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
  v_league public.leagues%rowtype;
begin
  if v_user is null then
    raise exception 'You must be logged in to join a league.';
  end if;

  select l.* into v_league
  from public.leagues l
  where l.id = p_league_id;

  if not found then
    raise exception 'League not found.';
  end if;

  if not public.can_join_league(p_league_id) then
    raise exception 'You do not have access to this private league.';
  end if;

  insert into public.league_members (league_id, user_id)
  values (p_league_id, v_user)
  on conflict do nothing;

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

grant execute on function public.join_league(uuid) to authenticated;
