-- Idempotency guard for generateDailyAssignments().
--
-- Root cause it defends against: the client-side existence check read
-- chore_assignments with no .limit() and no .order(), so PostgREST capped it
-- at 1000 rows (oldest first, by physical order). Once the table passed 1000
-- rows the check could no longer see current-period instances and the whole
-- active roster was re-inserted on every call -- 5330 rows where 1400 belong.
--
-- Scoped to pending/in_progress deliberately. Those are the only statuses the
-- generator ever inserts, so this blocks every duplicate at the source while
-- leaving historical approved/completed/rejected rows unconstrained: they are
-- the financial record behind every balance and must never be constrained away.
--
-- The AT TIME ZONE '<literal>' form is IMMUTABLE (unlike the session-dependent
-- one-arg date_trunc on timestamptz), so it is legal in an index expression.
--
-- PERMANENT TIMEZONE EXCEPTION [2026-09-03]. Every other timezone-sensitive
-- object in this schema now reads families.timezone -- see
-- 20260903201021_timezone_reconciliation_dynamic_family_timezone.sql, which
-- converted member_approved_day_counts() and process_loan_payments(). THIS
-- INDEX KEEPS ITS LITERAL, and that is a decision rather than an oversight:
-- an index expression must be IMMUTABLE, and a subquery against families is
-- not. Denormalising the zone onto chore_assignments (or adding a generated
-- local-day column) would make it possible, and is deliberately not worth the
-- complexity.
--
-- WHY IT IS SAFE. The dedup boundary shifts by at most one hour at DST
-- transitions, and by the timezone offset for a non-Central family. That
-- affects WHEN the daily dedup window resets, not WHETHER deduplication works:
-- the expression is still a single fixed 24-hour bucket per
-- (template_id, assigned_to), so at any offset two instances of the same
-- template for the same child on the same local day still collide. Idempotency
-- is preserved regardless of timezone offset. Do NOT replace this with a
-- trigger or a computed-column approach.
--
-- Applied to the live project on 2026-08-31 after deleting 3930 duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_daily_dedup
ON public.chore_assignments (
  template_id,
  assigned_to,
  date_trunc('day', due_date AT TIME ZONE 'America/Chicago')
)
WHERE is_template = false
  AND template_id IS NOT NULL
  AND status IN ('pending', 'in_progress');
