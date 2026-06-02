-- Add user-to-user coin borrow requests.
-- Run this in Supabase SQL Editor after the base schema.

alter table public.profiles
  add column if not exists owing_balance numeric(12,2) not null default 0 check (owing_balance >= 0);

create table if not exists public.coin_borrow_requests (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.profiles(id) on delete cascade,
  lender_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'completed', 'declined')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint borrower_and_lender_must_differ check (borrower_id <> lender_id)
);

create index if not exists coin_borrow_requests_borrower_idx
on public.coin_borrow_requests(borrower_id);

create index if not exists coin_borrow_requests_lender_idx
on public.coin_borrow_requests(lender_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_coin_borrow_requests_updated_at'
      and tgrelid = 'public.coin_borrow_requests'::regclass
  ) then
    create trigger set_coin_borrow_requests_updated_at
    before update on public.coin_borrow_requests
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.coin_borrow_requests enable row level security;

create policy coin_borrow_requests_select_participant_or_admin
on public.coin_borrow_requests
for select
to authenticated
using (borrower_id = auth.uid() or lender_id = auth.uid() or public.is_admin());

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
    p.balance
  from public.profiles p
  where p.role = 'user'::public.profile_role
    and p.id <> auth.uid()
  order by lower(p.username) asc;
end;
$$;

create or replace function public.get_coin_borrow_requests()
returns table (
  request_id uuid,
  borrower_id uuid,
  borrower_username text,
  lender_id uuid,
  lender_username text,
  amount numeric,
  status text,
  requested_at timestamptz,
  responded_at timestamptz,
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
    r.status,
    r.requested_at,
    r.responded_at,
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

create or replace function public.request_coin_borrow(
  p_lender_id uuid,
  p_amount numeric
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

  insert into public.coin_borrow_requests (borrower_id, lender_id, amount)
  values (v_borrower, p_lender_id, p_amount)
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
      owing_balance = round(owing_balance + v_request.amount, 2)
  where id = v_request.borrower_id;

  update public.coin_borrow_requests
  set status = 'completed',
      responded_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

create or replace function public.decline_coin_borrow_request(p_request_id uuid)
returns public.coin_borrow_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lender uuid := auth.uid();
  v_request public.coin_borrow_requests%rowtype;
begin
  if v_lender is null then
    raise exception 'You must be logged in to decline a request.';
  end if;

  select * into v_request
  from public.coin_borrow_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Borrow request not found.';
  end if;

  if v_request.lender_id <> v_lender then
    raise exception 'Only the selected lender can decline this request.';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  update public.coin_borrow_requests
  set status = 'declined',
      responded_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

grant select on public.coin_borrow_requests to authenticated;
grant execute on function public.get_borrow_users() to authenticated;
grant execute on function public.get_coin_borrow_requests() to authenticated;
grant execute on function public.request_coin_borrow(uuid, numeric) to authenticated;
grant execute on function public.approve_coin_borrow_request(uuid) to authenticated;
grant execute on function public.decline_coin_borrow_request(uuid) to authenticated;
