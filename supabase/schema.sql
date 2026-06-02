-- FIFA / World Cup Prediction Board schema for Supabase
-- Paste this into Supabase SQL Editor and run it once.

create extension if not exists pgcrypto;

-- 1) Domain enums
create type public.profile_role as enum ('user', 'admin');
create type public.match_status as enum ('upcoming', 'finished');
create type public.prediction_choice as enum ('team_a', 'draw', 'team_b');

-- 2) Tables
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  role public.profile_role not null default 'user',
  balance numeric(12,2) not null default 100.00 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  team_a text not null check (length(trim(team_a)) > 0),
  team_b text not null check (length(trim(team_b)) > 0),
  team_a_weight numeric(8,2) not null default 1.00 check (team_a_weight >= 1),
  draw_weight numeric(8,2) not null default 1.00 check (draw_weight >= 1),
  team_b_weight numeric(8,2) not null default 1.00 check (team_b_weight >= 1),
  match_time timestamptz not null,
  status public.match_status not null default 'upcoming',
  result public.prediction_choice,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint teams_must_be_different check (lower(trim(team_a)) <> lower(trim(team_b))),
  constraint result_required_when_finished check (
    (status = 'upcoming'::public.match_status and result is null and finished_at is null)
    or
    (status = 'finished'::public.match_status and result is not null and finished_at is not null)
  )
);

create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  choice public.prediction_choice not null,
  amount numeric(12,2) not null check (amount > 0),
  payout_amount numeric(12,2) not null default 0 check (payout_amount >= 0),
  net_amount numeric(12,2) not null default 0,
  result_weight numeric(8,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, user_id)
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_id uuid references public.matches(id) on delete set null,
  type text not null check (type in ('stake', 'stake_refund', 'payout', 'loss')),
  amount numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  notes text,
  created_at timestamptz not null default now()
);

create index predictions_match_id_idx on public.predictions(match_id);
create index predictions_user_id_idx on public.predictions(user_id);
create index matches_match_time_idx on public.matches(match_time);

-- 3) Utility triggers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

create trigger set_predictions_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

-- 4) Profile auto-create when a Supabase Auth user signs up.
-- The app signs users up with a generated private email and stores the real username in raw_user_meta_data.username.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
begin
  desired_username := coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1));

  insert into public.profiles (id, username)
  values (new.id, desired_username)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5) Admin helper used by policies and RPCs
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'::public.profile_role
  );
$$;

-- 6) Row Level Security
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.predictions enable row level security;
alter table public.wallet_transactions enable row level security;

-- Profiles: users can see their own balance/profile; admins can see all.
create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_update_admin_only
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Matches are visible to every logged-in user; only admins can modify them.
create policy matches_select_authenticated
on public.matches
for select
to authenticated
using (true);

create policy matches_insert_admin_only
on public.matches
for insert
to authenticated
with check (public.is_admin());

create policy matches_update_admin_only
on public.matches
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy matches_delete_admin_only
on public.matches
for delete
to authenticated
using (public.is_admin());

-- Predictions: users can see their own prediction; admins can see all.
-- Finished-match public result rows are exposed through get_match_results(), which masks other users' money.
create policy predictions_select_own_or_admin
on public.predictions
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

-- Wallet transactions are private to the user, with full admin visibility.
create policy wallet_transactions_select_own_or_admin
on public.wallet_transactions
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

-- 7) Place or update a prediction. Runs atomically and enforces:
--    - logged-in user
--    - match still upcoming
--    - board closes 15 minutes before kick-off
--    - available balance is enough
--    - one prediction per user per match
create or replace function public.place_prediction(
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
  v_profile public.profiles%rowtype;
  v_existing public.predictions%rowtype;
  v_delta numeric(12,2);
  v_result public.predictions%rowtype;
begin
  if v_user is null then
    raise exception 'You must be logged in to place a prediction.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Bid amount must be greater than zero.';
  end if;

  p_amount := round(p_amount, 2);

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

  select * into v_profile
  from public.profiles
  where id = v_user
  for update;

  if not found then
    raise exception 'Profile not found.';
  end if;

  select * into v_existing
  from public.predictions
  where match_id = p_match_id
    and user_id = v_user
  for update;

  if found then
    v_delta := p_amount - v_existing.amount;
  else
    v_delta := p_amount;
  end if;

  if v_delta > v_profile.balance then
    raise exception 'Insufficient balance. Available balance is $%.', v_profile.balance;
  end if;

  update public.profiles
  set balance = round(balance - v_delta, 2)
  where id = v_user
  returning * into v_profile;

  insert into public.predictions (match_id, user_id, choice, amount)
  values (p_match_id, v_user, p_choice, p_amount)
  on conflict (match_id, user_id)
  do update set
    choice = excluded.choice,
    amount = excluded.amount,
    updated_at = now()
  returning * into v_result;

  if v_delta <> 0 then
    insert into public.wallet_transactions (user_id, match_id, type, amount, balance_after, notes)
    values (
      v_user,
      p_match_id,
      case when v_delta > 0 then 'stake' else 'stake_refund' end,
      round(-v_delta, 2),
      v_profile.balance,
      'Prediction placed or updated'
    );
  end if;

  return v_result;
end;
$$;

-- 8) Admin settles a match. Payout rule:
--    - stakes are deducted when predictions are placed
--    - winners receive amount × the configured weight for the winning result
--    - winner net profit is payout minus their original stake
--    - losers receive no payout and only lose their original stake
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
    select user_id, payout_amount
    from public.predictions
    where match_id = p_match_id
      and choice = p_result
      and payout_amount > 0
  loop
    update public.profiles
    set balance = round(balance + v_rec.payout_amount, 2)
    where id = v_rec.user_id
    returning balance into v_balance;

    insert into public.wallet_transactions (user_id, match_id, type, amount, balance_after, notes)
    values (v_rec.user_id, p_match_id, 'payout', v_rec.payout_amount, v_balance, 'Winning payout using weight ' || v_winning_weight::text);
  end loop;

  for v_rec in
    select user_id, amount
    from public.predictions
    where match_id = p_match_id
      and choice <> p_result
  loop
    select balance into v_balance
    from public.profiles
    where id = v_rec.user_id;

    insert into public.wallet_transactions (user_id, match_id, type, amount, balance_after, notes)
    values (v_rec.user_id, p_match_id, 'loss', 0, v_balance, 'Lost stake: $' || v_rec.amount::text);
  end loop;
end;
$$;

-- 9) Public finished-match results with money masked for other users.
create or replace function public.get_match_results(p_match_id uuid)
returns table (
  prediction_id uuid,
  user_id uuid,
  username text,
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
declare
  v_is_admin boolean := public.is_admin();
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not exists (
    select 1
    from public.matches
    where id = p_match_id
      and status = 'finished'::public.match_status
  ) and not v_is_admin then
    raise exception 'Results are available only after the match is finished.';
  end if;

  return query
  select
    p.id as prediction_id,
    p.user_id,
    pr.username,
    p.choice,
    case p.choice
      when 'team_a'::public.prediction_choice then m.team_a_weight
      when 'team_b'::public.prediction_choice then m.team_b_weight
      when 'draw'::public.prediction_choice then m.draw_weight
    end as choice_weight,
    case when p.user_id = auth.uid() or v_is_admin then p.amount else null end as amount,
    case when p.user_id = auth.uid() or v_is_admin then p.payout_amount else null end as payout_amount,
    case when p.user_id = auth.uid() or v_is_admin then p.net_amount else null end as net_amount,
    (p.user_id = auth.uid()) as is_me
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  join public.matches m on m.id = p.match_id
  where p.match_id = p_match_id
  order by pr.username;
end;
$$;

-- 10) Grants
-- Supabase normally manages grants, but these make the script explicit.
grant usage on schema public to authenticated;
grant usage on type public.profile_role to authenticated;
grant usage on type public.match_status to authenticated;
grant usage on type public.prediction_choice to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.matches to authenticated;
grant select on public.predictions to authenticated;
grant select on public.wallet_transactions to authenticated;
grant execute on function public.place_prediction(uuid, public.prediction_choice, numeric) to authenticated;
grant execute on function public.finish_match(uuid, public.prediction_choice) to authenticated;
grant execute on function public.get_match_results(uuid) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- 11) Make your first admin after signing up in the app:
-- update public.profiles set role = 'admin' where username = 'your_username';

-- Optional seed matches:
-- insert into public.matches (team_a, team_b, team_a_weight, draw_weight, team_b_weight, match_time)
-- values
-- ('Australia', 'New Zealand', 2.10, 3.00, 2.40, '2026-06-11 20:00:00+10'),
-- ('Brazil', 'France', 2.50, 3.20, 2.80, '2026-06-12 20:00:00+10');
