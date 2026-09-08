-- A declined loan request has to carry the parent's reason. There is no
-- notifications table, so -- exactly as with chore_assignments.notes -- the
-- column IS the message and the child's only feedback channel.
--
-- ONE COLUMN, not two. The decline TIMESTAMP reuses paid_off_at, which is
-- already de-facto "resolved_at" in this schema: forgiveLoan() has always
-- stamped it for a loan that was never paid off. Reusing it means the child's
-- 48-hour derived notification window works unchanged for a decline, with no
-- new timestamp column and no second code path.
ALTER TABLE public.loans ADD COLUMN decline_note text;

COMMENT ON COLUMN public.loans.decline_note IS
  'Parent reason for declining a loan request. Required on decline; NULL on every other status. Paired with paid_off_at, which doubles as resolved_at.';
