-- Children can now REQUEST a purchase; a parent approves or declines it.
--
-- DEFAULT 'approved' is what makes this additive: every pre-existing row is
-- approved by definition, because it already exists and has already been
-- applied. Verified before the ALTER -- 63 rows, none of which this touches.
--
-- SAFE BECAUSE `expenses` HAS NO TRIGGERS. Confirmed against pg_trigger: the
-- ONLY trigger across expenses/expense_applications is
-- expense_application_balance_update, AFTER INSERT on expense_applications.
-- So a 'requested' expenses row cannot move a balance -- there is no code path
-- that would. The debit happens only when approval inserts the application row.
ALTER TABLE public.expenses
  ADD COLUMN status text NOT NULL DEFAULT 'approved'
  CHECK (status IN ('approved', 'requested', 'declined'));

-- Mirrors loans.decline_note, for the same reason: expenses.description holds
-- the CHILD's stated reason for wanting the thing, and overwriting it with the
-- parent's answer would destroy the child's own words. One nullable column.
ALTER TABLE public.expenses ADD COLUMN decline_note text;

COMMENT ON COLUMN public.expenses.status IS
  'approved (default, every ordinary expense) | requested (child purchase request awaiting a parent) | declined. Only meaningful alongside category = purchase-request.';
COMMENT ON COLUMN public.expenses.decline_note IS
  'Parent reason for declining a purchase request. description holds the CHILD''s reason and is never overwritten.';
