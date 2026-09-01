-- Child-initiated savings goals, stored in the existing `milestones` table.
--
-- APPLIED to the live project on 2026-09-01 (remote migration version
-- 20260901213153). This file is the repo's record of that change; it was
-- backfilled in the same session, after the deploy, once it was noticed that
-- supabase/migrations/ did not capture it.
--
-- A goal is a milestone row with child_initiated = true. It shares the table
-- with parent-set family milestones and is otherwise nothing like one:
--
--   * It belongs to ONE child (created_by_member), not the whole family.
--   * Its progress is min(current balance, target), computed at READ TIME and
--     never stored. It therefore moves BACKWARDS when the child spends, which
--     is the entire point -- it makes "should I save or spend?" a visible
--     trade-off. Do not migrate this to a stored, earnings-accumulated column.
--   * It has a lifecycle: active -> achieved, or active -> abandoned.
--
-- Adding the columns alone is NOT sufficient and is in fact unsafe on its own:
-- approve_chore's milestone_progress loop is scoped only by family_id, so
-- without the companion migration (20260901213410) every child's chore
-- approval would enrol every other child's personal goal. Apply both.

-- Marks a goal apart from a parent-set milestone. Nullable with a default
-- rather than NOT NULL, so existing rows backfill to false without a rewrite.
-- Every consumer must test it with `IS NOT TRUE` / `IS DISTINCT FROM true`
-- rather than `= false`: in SQL, NULL = false is NULL, not true, so an `=
-- false` predicate silently drops NULL rows.
ALTER TABLE public.milestones
  ADD COLUMN child_initiated boolean DEFAULT false;

-- The child who set the goal.
--
-- NOTE milestones.created_by ALREADY EXISTS and references auth.users(id).
-- This is a DIFFERENT foreign key, to family_members(id). Do not mix them --
-- the same trap chores.created_by presents.
--
-- This is an APP-LEVEL RECORD OF AUTHORSHIP, NOT A SECURITY BOUNDARY. RLS
-- cannot enforce that a child created the row: the "Parents can manage
-- milestones" policy checks `'parent' = ANY(role)`, and the kiosk's shared
-- Supabase session is always the `Kiosk` parent member. Child identity is app
-- state (useAuth.activeMember), not a database identity.
ALTER TABLE public.milestones
  ADD COLUMN created_by_member uuid
  REFERENCES public.family_members(id);

-- Goal lifecycle. Existing parent milestones backfill to 'active'; nothing
-- reads status for them, so this is inert for that path.
--
-- 'abandoned' is a SOFT DELETE. A child giving up on a goal is still part of
-- their financial history and is shown, unceremoniously, on Achievements. The
-- row is never deleted.
ALTER TABLE public.milestones
  ADD COLUMN status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'achieved', 'abandoned'));

-- When the balance first crossed the target. Drives the Achievements record.
-- Writes are guarded app-side with `.eq('status','active')` so a double-tap, or
-- the child dashboard's auto-complete racing a parent's manual "Mark achieved",
-- cannot rewrite a date that is already set. First write wins.
ALTER TABLE public.milestones
  ADD COLUMN achieved_at timestamptz;

-- ONE ACTIVE GOAL AT A TIME PER CHILD.
--
-- This is the layer that survives concurrency -- two tablets, two taps -- and
-- app-side checking is not a substitute for it (the same lesson as
-- idx_ca_daily_dedup). Scoped to child-initiated ACTIVE rows only, so parent
-- milestones and a child's achieved/abandoned history are never constrained:
-- a child may accumulate any number of past goals.
--
-- goalService translates the resulting 23505 into a readable sentence rather
-- than surfacing a constraint name to a child.
CREATE UNIQUE INDEX IF NOT EXISTS idx_milestones_one_active_goal
  ON public.milestones (created_by_member)
  WHERE child_initiated = true AND status = 'active';
