-- Goal Plan (budget planning tool), 2026-09-05.
--
-- ONE column, ZERO new tables. The proposed goal_plans table carried
-- weekly_target, target_weeks, status and completed_at; all four are either
-- derivable at read time or already stored on milestones:
--
--   weekly_target -> SUM of the plan chores' weekly value, computed at read time
--   target_weeks  -> ceil(needed / combined weekly rate), computed at read time
--   status        -> milestones.status; a plan's life IS its goal's life
--   completed_at  -> milestones.achieved_at
--
-- Storing the first two would have been actively wrong rather than merely
-- redundant: a parent may pause or delete a plan chore at any time, and a
-- stored weekly_target has no way to notice, so the child would read a total
-- that no longer matched the chores under it.
--
-- ONE ACTIVE PLAN PER CHILD comes free from idx_milestones_one_active_goal --
-- a plan hangs off a goal -- so no new partial unique index was needed here.
ALTER TABLE public.chore_assignments
  ADD COLUMN plan_goal_id uuid NULL
    REFERENCES public.milestones(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.chore_assignments.plan_goal_id IS
  'Goal Plan link: the savings goal (milestones.child_initiated=true) this roster entry was added to serve. NULL = an ordinary roster entry. Only meaningful on template rows. Weekly total, weeks-to-goal and plan status are DERIVED at read time from this link plus the goal - never stored, so pausing or deleting a plan chore cannot desync them. Clearing it to NULL converts a plan chore into a permanent roster entry ("Keep my plan chores"). One active plan per child is enforced for free by idx_milestones_one_active_goal, since a plan hangs off a goal.';

-- Partial: only template rows ever carry a link, so the index stays tiny.
CREATE INDEX idx_ca_plan_goal
  ON public.chore_assignments (plan_goal_id)
  WHERE plan_goal_id IS NOT NULL;

-- Mirror invariant (CLAUDE.md): the archive column list must match
-- chore_assignments exactly, or archive_old_assignments() fails at runtime on
-- a column-count mismatch.
ALTER TABLE public.chore_assignments_archive
  ADD COLUMN plan_goal_id uuid NULL;
