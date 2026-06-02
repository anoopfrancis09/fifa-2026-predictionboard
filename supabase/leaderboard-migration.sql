-- Add a public leaderboard RPC for authenticated users.
-- Run this in Supabase SQL Editor after the base schema.

create or replace function public.get_leaderboard()
returns table (
  user_id uuid,
  username text,
  balance numeric,
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
    (p.id = auth.uid()) as is_me
  from public.profiles p
  where p.role = 'user'::public.profile_role
  order by p.balance asc, lower(p.username) asc;
end;
$$;

grant execute on function public.get_leaderboard() to authenticated;
