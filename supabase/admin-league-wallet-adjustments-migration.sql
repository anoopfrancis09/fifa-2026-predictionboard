-- Admin-only league wallet adjustments.
-- Run this after supabase/league-wallet-only-balances-migration.sql.
--
-- These RPCs only read/update public.league_wallets. They do not modify
-- profile-level balances or any wallet rows in other leagues.

drop function if exists public.get_admin_league_wallets(uuid);
create or replace function public.get_admin_league_wallets(p_league_id uuid)
returns table (
  user_id uuid,
  username text,
  wallet_balance numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can view player league wallets.';
  end if;

  if p_league_id is null or not exists (select 1 from public.leagues where id = p_league_id) then
    raise exception 'Select a valid tournament.';
  end if;

  insert into public.league_wallets (league_id, user_id, balance)
  select lm.league_id, lm.user_id, 100.00
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  where lm.league_id = p_league_id
    and p.role = 'user'::public.profile_role
  on conflict on constraint league_wallets_pkey do nothing;

  return query
  select
    p.id as user_id,
    p.username,
    lw.balance as wallet_balance,
    lw.updated_at
  from public.league_members lm
  join public.profiles p on p.id = lm.user_id
  join public.league_wallets lw
    on lw.league_id = lm.league_id
   and lw.user_id = lm.user_id
  where lm.league_id = p_league_id
    and p.role = 'user'::public.profile_role
  order by lower(p.username) asc;
end;
$$;

drop function if exists public.admin_update_league_wallet_balance(uuid, uuid, numeric);
create or replace function public.admin_update_league_wallet_balance(
  p_league_id uuid,
  p_user_id uuid,
  p_balance numeric
)
returns table (
  user_id uuid,
  username text,
  wallet_balance numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be logged in.';
  end if;

  if not public.is_admin() then
    raise exception 'Only admins can update player league wallets.';
  end if;

  if p_balance is null or p_balance < 0 then
    raise exception 'Coins must be 0.00 or higher.';
  end if;

  p_balance := round(p_balance, 2);

  if not exists (
    select 1
    from public.league_members lm
    join public.profiles p on p.id = lm.user_id
    where lm.league_id = p_league_id
      and lm.user_id = p_user_id
      and p.role = 'user'::public.profile_role
  ) then
    raise exception 'Select a player from this tournament.';
  end if;

  perform public.ensure_league_wallet(p_league_id, p_user_id);

  update public.league_wallets lw
  set balance = p_balance
  where lw.league_id = p_league_id
    and lw.user_id = p_user_id;

  return query
  select
    p.id as user_id,
    p.username,
    lw.balance as wallet_balance,
    lw.updated_at
  from public.league_wallets lw
  join public.profiles p on p.id = lw.user_id
  where lw.league_id = p_league_id
    and lw.user_id = p_user_id;
end;
$$;

grant execute on function public.get_admin_league_wallets(uuid) to authenticated;
grant execute on function public.admin_update_league_wallet_balance(uuid, uuid, numeric) to authenticated;
