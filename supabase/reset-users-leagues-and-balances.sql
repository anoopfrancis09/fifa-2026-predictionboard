-- Destructive reset: remove regular app users, their leagues, predictions, borrow records,
-- wallet transactions, and league balances/memberships.
--
-- Run this from the Supabase SQL editor only when you intentionally want to wipe user data.
-- This keeps admin profiles/auth users by default so you do not lock yourself out.
--
-- To delete admins too, change the target_user_ids query from:
--   where role = 'user'::public.profile_role
-- to:
--   where true

begin;

create temp table reset_target_user_ids (
  id uuid primary key
) on commit drop;

insert into reset_target_user_ids (id)
select id
from public.profiles
where role = 'user'::public.profile_role;

-- Delete leagues owned by target users. Related league members and private access rows
-- are removed by the league foreign keys.
delete from public.leagues l
using reset_target_user_ids target
where l.created_by = target.id;

-- Remove any remaining league rows that reference target users, including memberships
-- in leagues owned by preserved admins.
delete from public.league_private_users lpu
using reset_target_user_ids target
where lpu.user_id = target.id
   or lpu.granted_by = target.id;

delete from public.league_members lm
using reset_target_user_ids target
where lm.user_id = target.id;

-- Remove user prediction/balance history. These tables normally cascade from profiles,
-- but explicit deletes make the reset clear and resilient to partial schema changes.
delete from public.predictions p
using reset_target_user_ids target
where p.user_id = target.id;

delete from public.wallet_transactions wt
using reset_target_user_ids target
where wt.user_id = target.id;

-- Borrow table is created by a later migration, so guard it for older databases.
do $$
begin
  if to_regclass('public.coin_borrow_requests') is not null then
    delete from public.coin_borrow_requests cbr
    using reset_target_user_ids target
    where cbr.borrower_id = target.id
       or cbr.lender_id = target.id;
  end if;
end $$;

-- Remove app profile rows and their coin balances.
delete from public.profiles p
using reset_target_user_ids target
where p.id = target.id;

-- Remove the corresponding Supabase Auth users.
-- Requires running as a privileged SQL role, such as through Supabase SQL editor.
delete from auth.users au
using reset_target_user_ids target
where au.id = target.id;

commit;
