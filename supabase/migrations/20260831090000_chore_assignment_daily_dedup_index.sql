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
-- America/Chicago is the family's real local zone -- note families.timezone
-- currently reads 'UTC', which nothing consumes yet but should be reconciled.
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
