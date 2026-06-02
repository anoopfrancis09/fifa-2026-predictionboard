-- Add outcome weights / odds to an existing World Cup Prediction Board database.
-- Run this in Supabase SQL Editor if you already ran the original schema.sql before.

alter table public.matches
  add column if not exists team_a_weight numeric(8,2) not null default 1.00,
  add column if not exists draw_weight numeric(8,2) not null default 1.00,
  add column if not exists team_b_weight numeric(8,2) not null default 1.00;

alter table public.predictions
  add column if not exists result_weight numeric(8,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_team_a_weight_min'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_team_a_weight_min check (team_a_weight >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_draw_weight_min'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_draw_weight_min check (draw_weight >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'matches_team_b_weight_min'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_team_b_weight_min check (team_b_weight >= 1);
  end if;
end $$;

-- Replace settlement logic.
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

-- get_match_results return columns changed, so drop then recreate.
drop function if exists public.get_match_results(uuid);

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

grant execute on function public.get_match_results(uuid) to authenticated;
