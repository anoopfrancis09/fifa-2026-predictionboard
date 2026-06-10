-- Move active money handling from profile-level balances to league-level wallets.
-- Run this after the league migrations and supabase/borrow-owed-amount-migration.sql.
--
-- Each user gets an independent 100 coin wallet per league.
-- Predictions, payouts, borrowing, and repayments all use public.league_wallets.

create table if not exists public.league_wallets (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  balance numeric(12,2) not null default 100.00 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists league_wallets_user_id_idx
on public.league_wallets(user_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_league_wallets_updated_at'
      and tgrelid = 'public.league_wallets'::regclass
  ) then
    create trigger set_league_wallets_updated_at
    before update on public.league_wallets
    for each row execute function public.set_updated_at();
  end if;
end $$;

insert into public.league_wallets (league_id, user_id, balance)
select lm.league_id, lm.user_id, 100.00
from public.league_members lm
on conflict (league_id, user_id) do nothing;

alter table public.predictions
  add column if not exists league_id uuid references public.leagues(id) on delete cascade;

create index if not exists predictions_league_id_idx
on public.predictions(league_id);

alter table public.wallet_transactions
  add column if not exists league_id uuid references public.leagues(id) on delete set null;

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'predictions'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by cols.ordinality)
        from unnest(con.conkey) with ordinality as cols(attnum, ordinality)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = cols.attnum
      ) = array['match_id', 'user_id']::text[]
  loop
    execute format('alter table public.predictions drop constraint %I', v_constraint);
  end loop;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'predictions'
      and con.contype = 'u'
      and (
        select array_agg(att.attname::text order by cols.ordinality)
        from unnest(con.conkey) with ordinality as cols(attnum, ordinality)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = cols.attnum
      ) = array['league_id', 'match_id', 'user_id']::text[]
  ) then
    alter table public.predictions
      add constraint predictions_league_match_user_unique unique (league_id, match_id, user_id);
  end if;
end $$;

alter table public.league_wallets enable row level security;

drop policy if exists league_wallets_select_own_or_admin on public.league_wallets;
create policy league_wallets_select_own_or_admin
on public.league_wallets
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists league_wallets_admin_update on public.league_wallets;
create policy league_wallets_admin_update
on public.league_wallets
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop function if exists public.get_my_league_wallet_balance(uuid);
drop function if exists public.ensure_league_wallet(uuid, uuid);
create or replace function public.ensure_league_wallet(
  p_league_id uuid,
  p_user_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(12,2);
begin
  if p_league_id is null or p_user_id is null then
    raise exception 'League and user are required.';
  end if;

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = p_user_id
  ) then
    raise exception 'User is not a member of this league.';
  end if;

  insert into public.league_wallets (league_id, user_id, balance)
  values (p_league_id, p_user_id, 100.00)
  on conflict (league_id, user_id) do nothing;

  select lw.balance into v_balance
  from public.league_wallets lw
  where lw.league_id = p_league_id
    and lw.user_id = p_user_id;

  return coalesce(v_balance, 100.00);
end;
$$;

create or replace function public.get_my_league_wallet_balance(p_league_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  return public.ensure_league_wallet(p_league_id, auth.uid());
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
  wallet_balance numeric,
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
    case
      when exists (
        select 1
        from public.league_members my_membership
        where my_membership.league_id = l.id
          and my_membership.user_id = auth.uid()
      ) then coalesce(my_wallet.balance, 100.00)
      else null
    end as wallet_balance,
    l.created_at
  from public.leagues l
  join public.profiles creator on creator.id = l.created_by
  left join public.league_members lm on lm.league_id = l.id
  left join public.league_wallets my_wallet
    on my_wallet.league_id = l.id
   and my_wallet.user_id = auth.uid()
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
  group by l.id, l.name, l.is_private, l.created_by, creator.username, l.created_at, my_wallet.balance
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
  wallet_balance numeric,
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

  perform public.ensure_league_wallet(v_league_id, v_user);

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
  wallet_balance numeric,
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

  perform public.ensure_league_wallet(p_league_id, v_user);

  return query
  select *
  from public.get_visible_leagues() visible
  where visible.id = p_league_id;
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
  wallet_balance numeric,
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
  select *
  from public.get_visible_leagues() visible
  where visible.id = p_league_id;
end;
$$;

drop function if exists public.get_league_borrow_users(uuid);
create or replace function public.get_league_borrow_users(p_league_id uuid)
returns table (
  user_id uuid,
  username text,
  wallet_balance numeric
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
    raise exception 'Join this league before borrowing coins from its users.';
  end if;

  return query
  select
    p.id as user_id,
    p.username,
    coalesce(lw.balance, 100.00) as wallet_balance
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  left join public.league_wallets lw
    on lw.league_id = lm.league_id
   and lw.user_id = lm.user_id
  where lm.league_id = p_league_id
    and p.role = 'user'::public.profile_role
    and p.id <> auth.uid()
  order by lower(p.username) asc;
end;
$$;

drop function if exists public.request_coin_borrow(uuid, numeric);
drop function if exists public.request_coin_borrow(uuid, numeric, numeric);
create or replace function public.request_coin_borrow(
  p_lender_id uuid,
  p_amount numeric,
  p_owed_amount numeric default null
)
returns public.coin_borrow_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Borrowing must be made inside a league.';
end;
$$;

drop function if exists public.request_coin_borrow_in_league(uuid, uuid, numeric);
drop function if exists public.request_coin_borrow_in_league(uuid, uuid, numeric, numeric);
create or replace function public.request_coin_borrow_in_league(
  p_league_id uuid,
  p_lender_id uuid,
  p_amount numeric,
  p_owed_amount numeric default null
)
returns public.coin_borrow_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrower uuid := auth.uid();
  v_request public.coin_borrow_requests%rowtype;
begin
  if v_borrower is null then
    raise exception 'You must be logged in to request coins.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Borrow amount must be greater than zero.';
  end if;

  p_amount := round(p_amount, 2);
  p_owed_amount := round(coalesce(p_owed_amount, p_amount * 1.5), 2);

  if p_owed_amount < p_amount then
    raise exception 'Amount to return cannot be less than the borrowed amount.';
  end if;

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = v_borrower
  ) then
    raise exception 'Join this league before borrowing coins from its users.';
  end if;

  if not exists (
    select 1
    from public.league_members lm
    join public.profiles p on p.id = lm.user_id
    where lm.league_id = p_league_id
      and lm.user_id = p_lender_id
      and p.role = 'user'::public.profile_role
  ) then
    raise exception 'Select a lender from this league.';
  end if;

  if p_lender_id = v_borrower then
    raise exception 'You cannot borrow coins from yourself.';
  end if;

  perform public.ensure_league_wallet(p_league_id, v_borrower);
  perform public.ensure_league_wallet(p_league_id, p_lender_id);

  insert into public.coin_borrow_requests (league_id, borrower_id, lender_id, amount, owed_amount)
  values (p_league_id, v_borrower, p_lender_id, p_amount, p_owed_amount)
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.approve_coin_borrow_request(p_request_id uuid)
returns public.coin_borrow_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lender uuid := auth.uid();
  v_request public.coin_borrow_requests%rowtype;
  v_lender_balance numeric(12,2);
begin
  if v_lender is null then
    raise exception 'You must be logged in to approve a request.';
  end if;

  select * into v_request
  from public.coin_borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Borrow request not found.';
  end if;

  if v_request.league_id is null then
    raise exception 'This borrow request is not attached to a league.';
  end if;

  if v_request.lender_id <> v_lender then
    raise exception 'Only the selected lender can approve this request.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  perform public.ensure_league_wallet(v_request.league_id, v_request.lender_id);
  perform public.ensure_league_wallet(v_request.league_id, v_request.borrower_id);

  select lw.balance into v_lender_balance
  from public.league_wallets lw
  where lw.league_id = v_request.league_id
    and lw.user_id = v_request.lender_id
  for update;

  if v_lender_balance < v_request.amount then
    raise exception 'You do not have enough league coins to approve this request.';
  end if;

  update public.league_wallets
  set balance = round(balance - v_request.amount, 2)
  where league_id = v_request.league_id
    and user_id = v_request.lender_id;

  update public.league_wallets
  set balance = round(balance + v_request.amount, 2)
  where league_id = v_request.league_id
    and user_id = v_request.borrower_id;

  update public.coin_borrow_requests
  set status = 'completed',
      responded_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.repay_coin_borrow_request(p_request_id uuid)
returns public.coin_borrow_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrower uuid := auth.uid();
  v_request public.coin_borrow_requests%rowtype;
  v_outstanding numeric(12,2);
  v_borrower_balance numeric(12,2);
begin
  if v_borrower is null then
    raise exception 'You must be logged in to return borrowed coins.';
  end if;

  select * into v_request
  from public.coin_borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Borrow request not found.';
  end if;

  if v_request.league_id is null then
    raise exception 'This borrow request is not attached to a league.';
  end if;

  if v_request.borrower_id <> v_borrower then
    raise exception 'Only the borrower can return these coins.';
  end if;

  if v_request.status <> 'completed' then
    raise exception 'Only approved borrowed coins can be returned.';
  end if;

  v_outstanding := round(v_request.owed_amount - v_request.repaid_amount, 2);

  if v_outstanding <= 0 then
    raise exception 'This borrowed amount has already been returned.';
  end if;

  perform public.ensure_league_wallet(v_request.league_id, v_request.borrower_id);
  perform public.ensure_league_wallet(v_request.league_id, v_request.lender_id);

  select lw.balance into v_borrower_balance
  from public.league_wallets lw
  where lw.league_id = v_request.league_id
    and lw.user_id = v_request.borrower_id
  for update;

  if v_borrower_balance < v_outstanding then
    raise exception 'You do not have enough league coins to return this borrowed amount.';
  end if;

  update public.league_wallets
  set balance = round(balance - v_outstanding, 2)
  where league_id = v_request.league_id
    and user_id = v_request.borrower_id;

  update public.league_wallets
  set balance = round(balance + v_outstanding, 2)
  where league_id = v_request.league_id
    and user_id = v_request.lender_id;

  update public.coin_borrow_requests
  set repaid_amount = owed_amount,
      repaid_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
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
    coalesce(lw.balance, 100.00) as balance,
    round((borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) as owing_amount,
    round(coalesce(lw.balance, 100.00) - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) as total_balance,
    (p.id = auth.uid()) as is_me
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  left join public.league_wallets lw
    on lw.league_id = lm.league_id
   and lw.user_id = lm.user_id
  left join lateral (
    select
      coalesce(sum(case when r.borrower_id = p.id then r.owed_amount - r.repaid_amount else 0 end), 0) as borrowed_amount,
      coalesce(sum(case when r.lender_id = p.id then r.owed_amount - r.repaid_amount else 0 end), 0) as lent_amount
    from public.coin_borrow_requests r
    where r.league_id = p_league_id
      and r.status = 'completed'
      and r.owed_amount > r.repaid_amount
      and (r.borrower_id = p.id or r.lender_id = p.id)
  ) borrow_totals on true
  where lm.league_id = p_league_id
    and p.role = 'user'::public.profile_role
  order by round(coalesce(lw.balance, 100.00) - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) desc, lower(p.username) asc;
end;
$$;

drop function if exists public.get_leaderboard();
create or replace function public.get_leaderboard()
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

  return query
  select
    p.id as user_id,
    p.username,
    coalesce(sum(lw.balance), 0) as balance,
    0::numeric as owing_amount,
    coalesce(sum(lw.balance), 0) as total_balance,
    (p.id = auth.uid()) as is_me
  from public.profiles p
  left join public.league_wallets lw on lw.user_id = p.id
  where p.role = 'user'::public.profile_role
  group by p.id, p.username
  order by coalesce(sum(lw.balance), 0) desc, lower(p.username) asc;
end;
$$;

drop function if exists public.place_prediction(uuid, uuid, public.prediction_choice, numeric);
create or replace function public.place_prediction(
  p_league_id uuid,
  p_match_id uuid,
  p_choice public.prediction_choice,
  p_amount numeric
)
returns public.predictions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match public.matches%rowtype;
  v_existing public.predictions%rowtype;
  v_delta numeric(12,2);
  v_balance numeric(12,2);
  v_result public.predictions%rowtype;
begin
  if v_user is null then
    raise exception 'You must be logged in to place a prediction.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be greater than zero.';
  end if;

  p_amount := round(p_amount, 2);

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = v_user
  ) then
    raise exception 'Join this league before placing predictions.';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match not found.';
  end if;

  if v_match.status <> 'upcoming'::public.match_status then
    raise exception 'This match is already finished.';
  end if;

  if now() >= v_match.match_time - interval '15 minutes' then
    raise exception 'Prediction board is closed for this match.';
  end if;

  perform public.ensure_league_wallet(p_league_id, v_user);

  select lw.balance into v_balance
  from public.league_wallets lw
  where lw.league_id = p_league_id
    and lw.user_id = v_user
  for update;

  select * into v_existing
  from public.predictions
  where league_id = p_league_id
    and match_id = p_match_id
    and user_id = v_user
  for update;

  if found then
    v_delta := p_amount - v_existing.amount;
  else
    v_delta := p_amount;
  end if;

  if v_delta > v_balance then
    raise exception 'Insufficient league balance. Available balance is %. ', v_balance;
  end if;

  update public.league_wallets
  set balance = round(balance - v_delta, 2)
  where league_id = p_league_id
    and user_id = v_user
  returning balance into v_balance;

  insert into public.predictions (league_id, match_id, user_id, choice, amount)
  values (p_league_id, p_match_id, v_user, p_choice, p_amount)
  on conflict (league_id, match_id, user_id)
  do update set
    choice = excluded.choice,
    amount = excluded.amount,
    updated_at = now()
  returning * into v_result;

  if v_delta <> 0 then
    insert into public.wallet_transactions (league_id, user_id, match_id, type, amount, balance_after, notes)
    values (
      p_league_id,
      v_user,
      p_match_id,
      case when v_delta > 0 then 'stake' else 'stake_refund' end,
      round(-v_delta, 2),
      v_balance,
      'League prediction placed or updated'
    );
  end if;

  return v_result;
end;
$$;

create or replace function public.finish_match(
  p_match_id uuid,
  p_result public.prediction_choice
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_winning_weight numeric(8,2);
  v_balance numeric(12,2);
  v_rec record;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can finish matches.';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match not found.';
  end if;

  if v_match.status = 'finished'::public.match_status then
    raise exception 'This match has already been finished.';
  end if;

  v_winning_weight := case p_result
    when 'team_a'::public.prediction_choice then v_match.team_a_weight
    when 'team_b'::public.prediction_choice then v_match.team_b_weight
    when 'draw'::public.prediction_choice then v_match.draw_weight
  end;

  update public.matches
  set status = 'finished'::public.match_status,
      result = p_result,
      finished_at = now()
  where id = p_match_id;

  update public.predictions
  set payout_amount = case
        when choice = p_result then round(amount * v_winning_weight, 2)
        else 0
      end,
      net_amount = case
        when choice = p_result then round((amount * v_winning_weight) - amount, 2)
        else round(-amount, 2)
      end,
      result_weight = case
        when choice = p_result then v_winning_weight
        else null
      end
  where match_id = p_match_id;

  for v_rec in
    select league_id, user_id, payout_amount
    from public.predictions
    where match_id = p_match_id
      and league_id is not null
      and choice = p_result
      and payout_amount > 0
  loop
    perform public.ensure_league_wallet(v_rec.league_id, v_rec.user_id);

    update public.league_wallets
    set balance = round(balance + v_rec.payout_amount, 2)
    where league_id = v_rec.league_id
      and user_id = v_rec.user_id
    returning balance into v_balance;

    insert into public.wallet_transactions (league_id, user_id, match_id, type, amount, balance_after, notes)
    values (v_rec.league_id, v_rec.user_id, p_match_id, 'payout', v_rec.payout_amount, v_balance, 'League payout using weight ' || v_winning_weight::text);
  end loop;

  for v_rec in
    select league_id, user_id, amount
    from public.predictions
    where match_id = p_match_id
      and league_id is not null
      and choice <> p_result
  loop
    select lw.balance into v_balance
    from public.league_wallets lw
    where lw.league_id = v_rec.league_id
      and lw.user_id = v_rec.user_id;

    insert into public.wallet_transactions (league_id, user_id, match_id, type, amount, balance_after, notes)
    values (v_rec.league_id, v_rec.user_id, p_match_id, 'loss', 0, v_balance, 'Lost league stake: ' || v_rec.amount::text);
  end loop;
end;
$$;

create or replace function public.admin_delete_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
  v_balance numeric(12,2);
  v_rec record;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can delete matches.';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match not found.';
  end if;

  if v_match.status <> 'upcoming'::public.match_status then
    raise exception 'Finished matches cannot be deleted because payouts may already be settled.';
  end if;

  for v_rec in
    select league_id, user_id, amount
    from public.predictions
    where match_id = p_match_id
      and league_id is not null
    for update
  loop
    perform public.ensure_league_wallet(v_rec.league_id, v_rec.user_id);

    update public.league_wallets
    set balance = round(balance + v_rec.amount, 2)
    where league_id = v_rec.league_id
      and user_id = v_rec.user_id
    returning balance into v_balance;

    insert into public.wallet_transactions (league_id, user_id, match_id, type, amount, balance_after, notes)
    values (v_rec.league_id, v_rec.user_id, p_match_id, 'stake_refund', v_rec.amount, v_balance, 'Match deleted by admin; league stake refunded');
  end loop;

  delete from public.matches
  where id = p_match_id;
end;
$$;

drop function if exists public.get_match_results(uuid);
drop function if exists public.get_match_results(uuid, uuid);
create or replace function public.get_match_results(
  p_match_id uuid,
  p_league_id uuid
)
returns table (
  prediction_id uuid,
  user_id uuid,
  username text,
  league_id uuid,
  choice public.prediction_choice,
  choice_weight numeric,
  amount numeric,
  payout_amount numeric,
  net_amount numeric,
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
    from public.matches m
    where m.id = p_match_id
      and m.status = 'finished'::public.match_status
  ) then
    raise exception 'Results are available only after the match is finished.';
  end if;

  return query
  select
    p.id as prediction_id,
    p.user_id,
    pr.username,
    p.league_id,
    p.choice,
    case p.choice
      when 'team_a'::public.prediction_choice then m.team_a_weight
      when 'team_b'::public.prediction_choice then m.team_b_weight
      when 'draw'::public.prediction_choice then m.draw_weight
    end as choice_weight,
    p.amount,
    p.payout_amount,
    p.net_amount,
    (p.user_id = auth.uid()) as is_me
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  join public.matches m on m.id = p.match_id
  where p.match_id = p_match_id
    and p.league_id = p_league_id
    and p.user_id = auth.uid()
  order by pr.username;
end;
$$;

drop function if exists public.get_locked_match_bid_list(uuid, uuid);
create or replace function public.get_locked_match_bid_list(
  p_league_id uuid,
  p_match_id uuid
)
returns table (
  prediction_id uuid,
  user_id uuid,
  username text,
  choice public.prediction_choice,
  amount numeric,
  created_at timestamptz,
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
    raise exception 'Join this league before viewing bids.';
  end if;

  return query
  select
    p.id as prediction_id,
    p.user_id,
    pr.username,
    p.choice,
    p.amount,
    p.created_at,
    (p.user_id = auth.uid()) as is_me
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  where p.league_id = p_league_id
    and p.match_id = p_match_id
  order by p.created_at asc, lower(pr.username) asc;
end;
$$;

drop function if exists public.get_borrow_users();
create or replace function public.get_borrow_users()
returns table (
  user_id uuid,
  username text,
  balance numeric
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
    coalesce(sum(lw.balance), 0) as balance
  from public.profiles p
  left join public.league_wallets lw on lw.user_id = p.id
  where p.role = 'user'::public.profile_role
    and p.id <> auth.uid()
  group by p.id, p.username
  order by lower(p.username) asc;
end;
$$;

grant select on public.league_wallets to authenticated;
grant execute on function public.ensure_league_wallet(uuid, uuid) to authenticated;
grant execute on function public.get_my_league_wallet_balance(uuid) to authenticated;
grant execute on function public.get_visible_leagues() to authenticated;
grant execute on function public.create_league(text, boolean, uuid[]) to authenticated;
grant execute on function public.join_league(uuid) to authenticated;
grant execute on function public.update_league_settings(uuid, text, boolean, uuid[]) to authenticated;
grant execute on function public.get_league_borrow_users(uuid) to authenticated;
grant execute on function public.request_coin_borrow(uuid, numeric, numeric) to authenticated;
grant execute on function public.request_coin_borrow_in_league(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.approve_coin_borrow_request(uuid) to authenticated;
grant execute on function public.repay_coin_borrow_request(uuid) to authenticated;
grant execute on function public.get_league_leaderboard(uuid) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
grant execute on function public.place_prediction(uuid, uuid, public.prediction_choice, numeric) to authenticated;
grant execute on function public.finish_match(uuid, public.prediction_choice) to authenticated;
grant execute on function public.admin_delete_match(uuid) to authenticated;
grant execute on function public.get_match_results(uuid, uuid) to authenticated;
grant execute on function public.get_locked_match_bid_list(uuid, uuid) to authenticated;
grant execute on function public.get_borrow_users() to authenticated;

-- The app no longer reads or writes these profile-level balances.
-- Dropping them last keeps the replacement RPCs installable before the old columns disappear.
alter table public.profiles
  drop column if exists balance,
  drop column if exists owing_balance;
