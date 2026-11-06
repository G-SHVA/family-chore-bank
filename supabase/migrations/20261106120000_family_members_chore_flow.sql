-- How a child likes to work through chores. NULL = not asked yet (behaves as 'plan', today's flow).
--   plan     : "Do this today" puts a chore on the child's list; they mark it complete from Chores.
--   checkoff : the same button reads "I did this" and submits the chore for approval in one tap.
-- Set once by the child's first-login question; after that only a parent changes it (Settings).
-- Additive and nullable: safe to apply before the app code ships. No new table, so no new grants.
alter table public.family_members
  add column if not exists chore_flow text
  check (chore_flow is null or chore_flow in ('plan', 'checkoff'));
