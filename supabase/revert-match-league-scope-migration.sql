-- Roll back supabase/match-league-scope-migration.sql.
--
-- Run this only if you also roll the app code back to a version that does not
-- require matches.league_id or get_admin_match_leagues().

drop policy if exists matches_select_visible_league on public.matches;
drop policy if exists matches_select_authenticated on public.matches;
create policy matches_select_authenticated
on public.matches
for select
to authenticated
using (true);

drop function if exists public.get_admin_match_leagues();

drop function if exists public.admin_update_match(uuid, uuid, text, text, numeric, numeric, numeric, timestamptz);
drop function if exists public.admin_update_match(uuid, text, text, numeric, numeric, numeric, timestamptz);
create or replace function public.admin_update_match(
  p_match_id uuid,
  p_team_a text,
  p_team_b text,
  p_team_a_weight numeric,
  p_draw_weight numeric,
  p_team_b_weight numeric,
  p_match_time timestamptz
)
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.matches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can update matches.';
  end if;

  if p_team_a is null or length(trim(p_team_a)) = 0 then
    raise exception 'Team A is required.';
  end if;

  if p_team_b is null or length(trim(p_team_b)) = 0 then
    raise exception 'Team B is required.';
  end if;

  if lower(trim(p_team_a)) = lower(trim(p_team_b)) then
    raise exception 'Team names must be different.';
  end if;

  if p_team_a_weight is null or p_team_a_weight < 1 then
    raise exception 'Team A win weight must be 1.00 or higher.';
  end if;

  if p_draw_weight is null or p_draw_weight < 1 then
    raise exception 'Draw weight must be 1.00 or higher.';
  end if;

  if p_team_b_weight is null or p_team_b_weight < 1 then
    raise exception 'Team B win weight must be 1.00 or higher.';
  end if;

  if p_match_time is null then
    raise exception 'Match date and time is required.';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match not found.';
  end if;

  if v_match.status <> 'upcoming'::public.match_status then
    raise exception 'Finished matches cannot be edited.';
  end if;

  update public.matches
  set team_a = trim(p_team_a),
      team_b = trim(p_team_b),
      team_a_weight = round(p_team_a_weight, 2),
      draw_weight = round(p_draw_weight, 2),
      team_b_weight = round(p_team_b_weight, 2),
      match_time = p_match_time
  where id = p_match_id
  returning * into v_match;

  return v_match;
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

drop index if exists public.matches_league_status_time_idx;
drop index if exists public.matches_league_id_idx;

alter table public.matches
  drop constraint if exists matches_league_id_fkey;

alter table public.matches
  drop column if exists league_id;

grant execute on function public.admin_update_match(uuid, text, text, numeric, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.place_prediction(uuid, uuid, public.prediction_choice, numeric) to authenticated;
grant execute on function public.finish_match(uuid, public.prediction_choice) to authenticated;
grant execute on function public.admin_delete_match(uuid) to authenticated;
grant execute on function public.get_match_results(uuid, uuid) to authenticated;
grant execute on function public.get_locked_match_bid_list(uuid, uuid) to authenticated;
