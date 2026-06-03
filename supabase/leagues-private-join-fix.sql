-- Follow-up fix for private league joins.
-- Run this only if you already ran supabase/leagues-migration.sql before the join policy fix.

create or replace function public.can_join_league(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and (
        l.is_private = false
        or l.created_by = auth.uid()
        or exists (
          select 1
          from public.league_private_users lpu
          where lpu.league_id = l.id
            and lpu.user_id = auth.uid()
        )
      )
  );
$$;

drop policy if exists league_members_insert_joinable on public.league_members;
create policy league_members_insert_joinable
on public.league_members
for insert
to authenticated
with check (user_id = auth.uid() and public.can_join_league(league_id));

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

  select * into v_league
  from public.leagues
  where id = p_league_id;

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
  select *
  from public.get_visible_leagues() visible
  where visible.id = p_league_id;
end;
$$;

grant select, insert on public.league_members to authenticated;
grant execute on function public.can_join_league(uuid) to authenticated;
grant execute on function public.join_league(uuid) to authenticated;
