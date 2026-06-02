-- Update-only migration for existing databases that already ran borrow-coins-migration.sql.
-- Do not rerun borrow-coins-migration.sql if coin_borrow_requests already exists.
-- This file adds return/repayment support and updates the leaderboard calculation.

alter table public.coin_borrow_requests
  add column if not exists repaid_amount numeric(12,2) not null default 0 check (repaid_amount >= 0),
  add column if not exists repaid_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'coin_borrow_requests_repaid_amount_max'
      and conrelid = 'public.coin_borrow_requests'::regclass
  ) then
    alter table public.coin_borrow_requests
      add constraint coin_borrow_requests_repaid_amount_max check (repaid_amount <= amount);
  end if;
end $$;

drop function if exists public.get_coin_borrow_requests();

create or replace function public.get_coin_borrow_requests()
returns table (
  request_id uuid,
  borrower_id uuid,
  borrower_username text,
  lender_id uuid,
  lender_username text,
  amount numeric,
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
    r.borrower_id,
    borrower.username as borrower_username,
    r.lender_id,
    lender.username as lender_username,
    r.amount,
    r.repaid_amount,
    round(r.amount - r.repaid_amount, 2) as outstanding_amount,
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

  v_outstanding := round(v_request.amount - v_request.repaid_amount, 2);

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
  set repaid_amount = amount,
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
      coalesce(sum(case when r.borrower_id = p.id then r.amount - r.repaid_amount else 0 end), 0) as borrowed_amount,
      coalesce(sum(case when r.lender_id = p.id then r.amount - r.repaid_amount else 0 end), 0) as lent_amount
    from public.coin_borrow_requests r
    where r.status = 'completed'
      and r.amount > r.repaid_amount
      and (r.borrower_id = p.id or r.lender_id = p.id)
  ) borrow_totals on true
  where p.role = 'user'::public.profile_role
  order by round(p.balance - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) desc, lower(p.username) asc;
end;
$$;

grant execute on function public.get_coin_borrow_requests() to authenticated;
grant execute on function public.repay_coin_borrow_request(uuid) to authenticated;
grant execute on function public.get_leaderboard() to authenticated;
