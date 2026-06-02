-- Replace leaderboard RPC to include net owing and adjusted total balance.
-- Run this after supabase/borrow-coins-migration.sql.

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
      coalesce(sum(case when r.borrower_id = p.id then r.amount else 0 end), 0) as borrowed_amount,
      coalesce(sum(case when r.lender_id = p.id then r.amount else 0 end), 0) as lent_amount
    from public.coin_borrow_requests r
    where r.status = 'completed'
      and (r.borrower_id = p.id or r.lender_id = p.id)
  ) borrow_totals on true
  where p.role = 'user'::public.profile_role
  order by round(p.balance - (borrow_totals.borrowed_amount - borrow_totals.lent_amount), 2) desc, lower(p.username) asc;
end;
$$;

grant execute on function public.get_leaderboard() to authenticated;
