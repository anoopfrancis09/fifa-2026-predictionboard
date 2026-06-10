-- Add editable owed amounts for coin borrowing.
-- Run this after the existing borrow and league borrow migrations.
--
-- New behavior:
-- - Borrow requests store both the principal amount and the amount the borrower agrees to return.
-- - If omitted, owed_amount defaults to 1.5x the borrowed amount.
-- - Repayment, owing balance, and leaderboard net owing are calculated from owed_amount.

alter table public.coin_borrow_requests
  add column if not exists owed_amount numeric(12,2),
  add column if not exists repaid_amount numeric(12,2) not null default 0,
  add column if not exists repaid_at timestamptz,
  add column if not exists league_id uuid references public.leagues(id) on delete cascade;

create index if not exists coin_borrow_requests_league_id_idx
on public.coin_borrow_requests(league_id);

update public.coin_borrow_requests
set owed_amount = amount
where owed_amount is null;

alter table public.coin_borrow_requests
  alter column owed_amount set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'coin_borrow_requests_repaid_amount_max'
      and conrelid = 'public.coin_borrow_requests'::regclass
  ) then
    alter table public.coin_borrow_requests
      drop constraint coin_borrow_requests_repaid_amount_max;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coin_borrow_requests_repaid_amount_nonnegative'
      and conrelid = 'public.coin_borrow_requests'::regclass
  ) then
    alter table public.coin_borrow_requests
      add constraint coin_borrow_requests_repaid_amount_nonnegative check (repaid_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coin_borrow_requests_owed_amount_valid'
      and conrelid = 'public.coin_borrow_requests'::regclass
  ) then
    alter table public.coin_borrow_requests
      add constraint coin_borrow_requests_owed_amount_valid check (owed_amount >= amount and owed_amount > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'coin_borrow_requests_repaid_amount_max_owed'
      and conrelid = 'public.coin_borrow_requests'::regclass
  ) then
    alter table public.coin_borrow_requests
      add constraint coin_borrow_requests_repaid_amount_max_owed check (repaid_amount <= owed_amount);
  end if;
end $$;

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
declare
  v_borrower uuid := auth.uid();
  v_borrower_profile public.profiles%rowtype;
  v_lender_profile public.profiles%rowtype;
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

  select * into v_borrower_profile
  from public.profiles
  where id = v_borrower;

  if not found or v_borrower_profile.role <> 'user'::public.profile_role then
    raise exception 'Only regular users can request borrowed coins.';
  end if;

  select * into v_lender_profile
  from public.profiles
  where id = p_lender_id;

  if not found or v_lender_profile.role <> 'user'::public.profile_role then
    raise exception 'Select a regular user to borrow from.';
  end if;

  if p_lender_id = v_borrower then
    raise exception 'You cannot borrow coins from yourself.';
  end if;

  insert into public.coin_borrow_requests (borrower_id, lender_id, amount, owed_amount)
  values (v_borrower, p_lender_id, p_amount, p_owed_amount)
  returning * into v_request;

  return v_request;
end;
$$;

drop function if exists public.get_coin_borrow_requests();

create or replace function public.get_coin_borrow_requests()
returns table (
  request_id uuid,
  league_id uuid,
  borrower_id uuid,
  borrower_username text,
  lender_id uuid,
  lender_username text,
  amount numeric,
  owed_amount numeric,
  repaid_amount numeric,
  outstanding_amount numeric,
  status text,
  requested_at timestamptz,
  responded_at timestamptz,
  repaid_at timestamptz,
  is_incoming boolean,
  is_outgoing boolean
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
    r.id as request_id,
    r.league_id,
    r.borrower_id,
    borrower.username as borrower_username,
    r.lender_id,
    lender.username as lender_username,
    r.amount,
    r.owed_amount,
    r.repaid_amount,
    round(r.owed_amount - r.repaid_amount, 2) as outstanding_amount,
    r.status,
    r.requested_at,
    r.responded_at,
    r.repaid_at,
    (r.lender_id = auth.uid()) as is_incoming,
    (r.borrower_id = auth.uid()) as is_outgoing
  from public.coin_borrow_requests r
  join public.profiles borrower on borrower.id = r.borrower_id
  join public.profiles lender on lender.id = r.lender_id
  where r.borrower_id = auth.uid()
     or r.lender_id = auth.uid()
     or public.is_admin()
  order by r.requested_at desc;
end;
$$;

drop function if exists public.get_coin_borrow_requests_in_league(uuid);

create or replace function public.get_coin_borrow_requests_in_league(p_league_id uuid)
returns table (
  request_id uuid,
  league_id uuid,
  borrower_id uuid,
  borrower_username text,
  lender_id uuid,
  lender_username text,
  amount numeric,
  owed_amount numeric,
  repaid_amount numeric,
  outstanding_amount numeric,
  status text,
  requested_at timestamptz,
  responded_at timestamptz,
  repaid_at timestamptz,
  is_incoming boolean,
  is_outgoing boolean
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
  ) and not public.is_admin() then
    raise exception 'Join this league before viewing borrow requests.';
  end if;

  return query
  select
    r.id as request_id,
    r.league_id,
    r.borrower_id,
    borrower.username as borrower_username,
    r.lender_id,
    lender.username as lender_username,
    r.amount,
    r.owed_amount,
    r.repaid_amount,
    round(r.owed_amount - r.repaid_amount, 2) as outstanding_amount,
    r.status,
    r.requested_at,
    r.responded_at,
    r.repaid_at,
    (r.lender_id = auth.uid()) as is_incoming,
    (r.borrower_id = auth.uid()) as is_outgoing
  from public.coin_borrow_requests r
  join public.profiles borrower on borrower.id = r.borrower_id
  join public.profiles lender on lender.id = r.lender_id
  where r.league_id = p_league_id
    and (
      r.borrower_id = auth.uid()
      or r.lender_id = auth.uid()
      or public.is_admin()
    )
  order by r.requested_at desc;
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
  v_lender_profile public.profiles%rowtype;
  v_borrower_profile public.profiles%rowtype;
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

  if v_request.lender_id <> v_lender then
    raise exception 'Only the selected lender can approve this request.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  select * into v_lender_profile
  from public.profiles
  where id = v_request.lender_id
  for update;

  select * into v_borrower_profile
  from public.profiles
  where id = v_request.borrower_id
  for update;

  if v_lender_profile.balance < v_request.amount then
    raise exception 'You do not have enough coins to approve this request.';
  end if;

  update public.profiles
  set balance = round(balance - v_request.amount, 2)
  where id = v_request.lender_id;

  update public.profiles
  set balance = round(balance + v_request.amount, 2),
      owing_balance = round(owing_balance + v_request.owed_amount, 2)
  where id = v_request.borrower_id;

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
  v_borrower_profile public.profiles%rowtype;
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

  select * into v_borrower_profile
  from public.profiles
  where id = v_request.borrower_id
  for update;

  if v_borrower_profile.balance < v_outstanding then
    raise exception 'You do not have enough coins to return this borrowed amount.';
  end if;

  update public.profiles
  set balance = round(balance - v_outstanding, 2),
      owing_balance = greatest(0, round(owing_balance - v_outstanding, 2))
  where id = v_request.borrower_id;

  update public.profiles
  set balance = round(balance + v_outstanding, 2)
  where id = v_request.lender_id;

  update public.coin_borrow_requests
  set repaid_amount = owed_amount,
      repaid_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
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
    p.balance,
    round((borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) as owing_amount,
    round(p.balance - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) as total_balance,
    (p.id = auth.uid()) as is_me
  from public.profiles p
  left join lateral (
    select
      coalesce(sum(case when r.borrower_id = p.id then r.owed_amount - r.repaid_amount else 0 end), 0) as borrowed_amount,
      coalesce(sum(case when r.lender_id = p.id then r.owed_amount - r.repaid_amount else 0 end), 0) as lent_amount
    from public.coin_borrow_requests r
    where r.status = 'completed'
      and r.owed_amount > r.repaid_amount
      and (r.borrower_id = p.id or r.lender_id = p.id)
  ) borrow_totals on true
  where p.role = 'user'::public.profile_role
  order by round(p.balance - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) desc, lower(p.username) asc;
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
  v_request public.coin_borrow_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in to request coins.';
  end if;

  if not exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = auth.uid()
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

  v_request := public.request_coin_borrow(p_lender_id, p_amount, p_owed_amount);

  update public.coin_borrow_requests
  set league_id = p_league_id
  where id = v_request.id
  returning * into v_request;

  return v_request;
end;
$$;

grant execute on function public.request_coin_borrow(uuid, numeric, numeric) to authenticated;
grant execute on function public.get_coin_borrow_requests() to authenticated;
grant execute on function public.get_coin_borrow_requests_in_league(uuid) to authenticated;
grant execute on function public.approve_coin_borrow_request(uuid) to authenticated;
grant execute on function public.repay_coin_borrow_request(uuid) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
grant execute on function public.request_coin_borrow_in_league(uuid, uuid, numeric, numeric) to authenticated;
