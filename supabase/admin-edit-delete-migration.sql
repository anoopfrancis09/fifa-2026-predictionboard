-- Add admin edit/delete RPCs for existing World Cup Prediction Board databases.
-- Run this in Supabase SQL Editor after the weights migration.

-- Admin can edit an upcoming match. Existing predictions remain linked to the match.
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

-- Admin can delete an upcoming match. Existing stakes are refunded before deletion.
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
    select user_id, amount
    from public.predictions
    where match_id = p_match_id
    for update
  loop
    update public.profiles
    set balance = round(balance + v_rec.amount, 2)
    where id = v_rec.user_id
    returning balance into v_balance;

    insert into public.wallet_transactions (user_id, match_id, type, amount, balance_after, notes)
    values (v_rec.user_id, p_match_id, 'stake_refund', v_rec.amount, v_balance, 'Match deleted by admin; stake refunded');
  end loop;

  delete from public.matches
  where id = p_match_id;
end;
$$;

grant execute on function public.admin_update_match(uuid, text, text, numeric, numeric, numeric, timestamptz) to authenticated;
grant execute on function public.admin_delete_match(uuid) to authenticated;
