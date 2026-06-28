-- Allow deleting a league that has league-scoped matches.
-- Run this after match-league-scope-migration.sql if league deletion is blocked by matches_league_id_fkey.

alter table public.matches
  drop constraint if exists matches_league_id_fkey;

alter table public.matches
  add constraint matches_league_id_fkey
  foreign key (league_id)
  references public.leagues(id)
  on delete cascade;
