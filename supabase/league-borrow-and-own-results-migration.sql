-- Scope results and borrowing.
-- Run this after the league and borrow migrations.
-- Results now return only the logged-in user's prediction row.
-- Borrow lender options and new borrow requests are limited to members of the selected league.

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
    p.choice,
    case p.choice
      when 'team_a'::public.prediction_choice then m.team_a_weight
      when 'team_b'::public.prediction_choice then m.team_b_weight
      when 'draw'::public.prediction_choice then m.draw_weight
    end as choice_weight,
    p.amount,
    p.payout_amount,
    p.net_amount,
    true as is_me
  from public.predictions p
  join public.profiles pr on pr.id = p.user_id
  join public.matches m on m.id = p.match_id
  where p.match_id = p_match_id
    and p.user_id = auth.uid()
  order by pr.username;
end;
$$;

drop function if exists public.get_league_borrow_users(uuid);
create or replace function public.get_league_borrow_users(p_league_id uuid)
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
    p.balance
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  where lm.league_id = p_league_id
    and p.role = 'user'::public.profile_role
    and p.id <> auth.uid()
  order by lower(p.username) asc;
end;
$$;

drop function if exists public.request_coin_borrow_in_league(uuid, uuid, numeric);
create or replace function public.request_coin_borrow_in_league(
  p_league_id uuid,
  p_lender_id uuid,
  p_amount numeric
)
returns public.coin_borrow_requests
language plpgsql
security definer
set search_path = public
as $$
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

  return public.request_coin_borrow(p_lender_id, p_amount);
end;
$$;

grant execute on function public.get_match_results(uuid) to authenticated;
grant execute on function public.get_league_borrow_users(uuid) to authenticated;
grant execute on function public.request_coin_borrow_in_league(uuid, uuid, numeric) to authenticated;
