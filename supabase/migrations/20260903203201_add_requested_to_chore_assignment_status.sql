-- Adds 'requested' to the chore_assignments status CHECK constraint.
--
-- 'requested' is the child-initiated claim status, used by BOTH paths of the
-- claim library:
--   Path 1 "Do this once"        -> is_template = false, template_id = NULL
--   Path 2 "Add to my regulars"  -> is_template = true,  is_active   = false
--
-- idx_ca_daily_dedup DELIBERATELY NOT TOUCHED. Its WHERE clause already
-- carries `template_id IS NOT NULL`, and a Path 1 request has template_id
-- NULL, so a claim row never enters that index at either the 'requested' or
-- the approved 'pending' stage. Adding 'requested' to the index predicate
-- would be dead code. The coexistence this produces is intended: a child may
-- request a one-off of a chore that is ALSO on their roster that day, and the
-- two rows must not collide.
--
-- Path 2 rows are additionally kept out of the generator by an explicit
-- .neq('status','requested') on runGeneration()'s template read and by
-- is_active = false at insert. Two independent layers; see CLAUDE.md.

ALTER TABLE public.chore_assignments
  DROP CONSTRAINT chore_assignments_status_check;

ALTER TABLE public.chore_assignments
  ADD CONSTRAINT chore_assignments_status_check
  CHECK (status IN (
    'pending',
    'in_progress',
    'completed',
    'approved',
    'rejected',
    'expired',
    'requested'
  ));
