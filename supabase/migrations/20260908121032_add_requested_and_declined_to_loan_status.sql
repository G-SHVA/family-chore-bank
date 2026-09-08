-- Children can now submit a loan REQUEST that a parent reviews, adjusts the
-- terms of, and approves. Two new statuses carry that flow.
--
-- 'requested' is transient by construction: a parent either approves it (the
-- row becomes 'active') or declines it (the row becomes 'declined'). It never
-- accumulates, which is what lets getLoanRequests() be bounded by status alone.
--
-- 'declined' exists so a parent can formally answer rather than ignore. The
-- decline note is the child's only feedback channel -- there is no
-- notifications table -- so the row has to persist to carry it.
ALTER TABLE public.loans DROP CONSTRAINT loans_status_check;

ALTER TABLE public.loans
  ADD CONSTRAINT loans_status_check
  CHECK (status IN ('active', 'paid_off', 'forgiven', 'requested', 'declined'));

-- Mirrors idx_loans_one_active_per_member. A child may hold at most one
-- UNANSWERED request; this is the layer that survives concurrency (two
-- tablets, two taps), exactly as the active-loan index is.
--
-- Scoped to 'requested' ONLY, deliberately. A declined request frees the slot
-- immediately so the child can ask again with better terms. The decline
-- NOTIFICATION surviving that re-request is display state derived from
-- paid_off_at inside a 48-hour window -- never a database constraint.
CREATE UNIQUE INDEX idx_loans_one_requested_per_member
  ON public.loans (member_id)
  WHERE status = 'requested';

COMMENT ON INDEX public.idx_loans_one_requested_per_member IS
  'One unanswered loan request per child. Declined requests free the slot; the decline notice is derived display state, not a constraint.';
