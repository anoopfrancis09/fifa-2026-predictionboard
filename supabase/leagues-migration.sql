-- League support for the FIFA prediction board.
-- Run this in Supabase SQL Editor after the existing schema and borrow migrations.
-- Bets, payouts, and balances remain global; leagues only scope membership and leaderboards.

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 80),
  is_private boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.league_private_users (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists leagues_created_by_idx on public.leagues(created_by);
create index if not exists league_members_user_id_idx on public.league_members(user_id);
create index if not exists league_private_users_user_id_idx on public.league_private_users(user_id);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_leagues_updated_at'
  ) then
    create trigger set_leagues_updated_at
    before update on public.leagues
    for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.league_private_users enable row level security;

create or replace function public.owns_league(p_league_id uuid)
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
      and l.created_by = auth.uid()
  );
$$;

create or replace function public.can_view_league(p_league_id uuid)
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
          from public.league_members lm
          where lm.league_id = l.id
            and lm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.league_private_users lpu
          where lpu.league_id = l.id
            and lpu.user_id = auth.uid()
        )
      )
  );
$$;

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

drop policy if exists leagues_select_visible on public.leagues;
create policy leagues_select_visible
on public.leagues
for select
to authenticated
using (public.can_view_league(id));

drop policy if exists leagues_update_owner_only on public.leagues;
create policy leagues_update_owner_only
on public.leagues
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists leagues_delete_owner_only on public.leagues;
create policy leagues_delete_owner_only
on public.leagues
for delete
to authenticated
using (created_by = auth.uid());

drop policy if exists league_members_select_same_league on public.league_members;
create policy league_members_select_same_league
on public.league_members
for select
to authenticated
using (user_id = auth.uid() or public.can_view_league(league_id));

drop policy if exists league_members_insert_joinable on public.league_members;
create policy league_members_insert_joinable
on public.league_members
for insert
to authenticated
with check (user_id = auth.uid() and public.can_join_league(league_id));

drop policy if exists league_private_users_select_owner_or_self on public.league_private_users;
create policy league_private_users_select_owner_or_self
on public.league_private_users
for select
to authenticated
using (user_id = auth.uid() or public.owns_league(league_id));

drop function if exists public.get_league_user_options();
create or replace function public.get_league_user_options()
returns table (
  user_id uuid,
  username text,
  is_me boolean
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

  return query
  select
    p.id as user_id,
    p.username,
    (p.id = auth.uid()) as is_me
  from public.profiles p
  where p.role = 'user'::public.profile_role
  order by lower(p.username);
end;
$$;

drop function if exists public.get_visible_leagues();
create or replace function public.get_visible_leagues()
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
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  return query
  select
    l.id,
    l.name,
    l.is_private,
    l.created_by,
    creator.username as created_by_username,
    count(lm.user_id) as member_count,
    (l.created_by = auth.uid()) as is_owner,
    exists (
      select 1
      from public.league_members my_membership
      where my_membership.league_id = l.id
        and my_membership.user_id = auth.uid()
    ) as is_member,
    l.created_at
  from public.leagues l
  join public.profiles creator on creator.id = l.created_by
  left join public.league_members lm on lm.league_id = l.id
  where l.is_private = false
    or l.created_by = auth.uid()
    or exists (
      select 1
      from public.league_members existing_membership
      where existing_membership.league_id = l.id
        and existing_membership.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.league_private_users access
      where access.league_id = l.id
        and access.user_id = auth.uid()
    )
  group by l.id, l.name, l.is_private, l.created_by, creator.username, l.created_at
  order by
    exists (
      select 1
      from public.league_members my_membership
      where my_membership.league_id = l.id
        and my_membership.user_id = auth.uid()
    ) desc,
    lower(l.name) asc;
end;
$$;

drop function if exists public.create_league(text, boolean, uuid[]);
create or replace function public.create_league(
  p_name text,
  p_is_private boolean default false,
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
  v_league_id uuid;
begin
  if v_user is null then
    raise exception 'You must be logged in to create a league.';
  end if;

  if p_name is null or length(trim(p_name)) < 3 then
    raise exception 'League name must be at least 3 characters.';
  end if;

  if length(trim(p_name)) > 80 then
    raise exception 'League name must be 80 characters or fewer.';
  end if;

  insert into public.leagues (name, is_private, created_by)
  values (trim(p_name), coalesce(p_is_private, false), v_user)
  returning leagues.id into v_league_id;

  insert into public.league_members (league_id, user_id)
  values (v_league_id, v_user)
  on conflict do nothing;

  if coalesce(p_is_private, false) then
    insert into public.league_private_users (league_id, user_id, granted_by)
    select v_league_id, allowed.user_id, v_user
    from (
      select v_user as user_id
      union
      select unnest(coalesce(p_allowed_user_ids, '{}'::uuid[])) as user_id
    ) allowed
    join public.profiles p on p.id = allowed.user_id
    on conflict do nothing;
  end if;

  return query
  select *
  from public.get_visible_leagues() visible
  where visible.id = v_league_id;
end;
$$;

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

  if v_league.is_private
    and v_league.created_by <> v_user
    and not public.can_join_league(p_league_id)
  then
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

drop function if exists public.get_league_leaderboard(uuid);
create or replace function public.get_league_leaderboard(p_league_id uuid)
returns table (
  user_id uuid,
  username text,
  balance numeric,
  owing_amount numeric,
  total_balance numeric,
  is_me boolean
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

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = auth.uid()
  ) then
    raise exception 'Join this league before viewing its leaderboard.';
  end if;

  return query
  select
    p.id as user_id,
    p.username,
    p.balance,
    round((borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) as owing_amount,
    round(p.balance - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) as total_balance,
    (p.id = auth.uid()) as is_me
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  left join lateral (
    select
      coalesce(sum(case when r.borrower_id = p.id then r.amount - r.repaid_amount else 0 end), 0) as borrowed_amount,
      coalesce(sum(case when r.lender_id = p.id then r.amount - r.repaid_amount else 0 end), 0) as lent_amount
    from public.coin_borrow_requests r
    where r.status = 'completed'
      and r.amount > r.repaid_amount
      and (r.borrower_id = p.id or r.lender_id = p.id)
  ) borrow_totals on true
  where lm.league_id = p_league_id
    and p.role = 'user'::public.profile_role
  order by round(p.balance - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) desc, lower(p.username) asc;
end;
$$;

grant select, update, delete on public.leagues to authenticated;
grant select, insert on public.league_members to authenticated;
grant select on public.league_private_users to authenticated;
grant execute on function public.get_league_user_options() to authenticated;
grant execute on function public.get_visible_leagues() to authenticated;
grant execute on function public.create_league(text, boolean, uuid[]) to authenticated;
grant execute on function public.join_league(uuid) to authenticated;
grant execute on function public.get_league_leaderboard(uuid) to authenticated;
grant execute on function public.owns_league(uuid) to authenticated;
grant execute on function public.can_view_league(uuid) to authenticated;
grant execute on function public.can_join_league(uuid) to authenticated;
