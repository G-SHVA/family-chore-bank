-- Timezone reconciliation -- Option A: read the zone from families.timezone
-- rather than hardcoding 'America/Chicago'.
--
-- Goal: a family in California and a family in Texas both get correct date
-- boundaries with no code change.
--
-- CLAUDE.md tracked four affected locations. This migration covers the two
-- server-side ones (member_approved_day_counts, process_loan_payments). The
-- client side (location 4) moved to src/lib/time.ts in the same change, which
-- reads families.timezone through useAuth. Location 1, idx_ca_daily_dedup, is
-- the documented PERMANENT exception: an index expression must be IMMUTABLE and
-- cannot read another table, so it keeps its literal -- see the COMMENT at the
-- bottom of this file and the expanded note in the index's own migration.
--
-- families.timezone was 'UTC' for this family and consumed by nothing. It was
-- set to 'America/Chicago' in the same session, which is what the hardcoded
-- literals already assumed -- so this reconciliation is a NO-OP for existing
-- data. Verified: member_approved_day_counts returned 12 day rows with 0
-- mismatches against the previous explicit-Chicago bucketing.

CREATE OR REPLACE FUNCTION public.member_approved_day_counts(p_member_id uuid)
 RETURNS TABLE(day date, total_count integer, roster_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The member's family timezone, resolved once per call (Postgres evaluates
  -- this as an InitPlan, not per row). Was a hardcoded 'America/Chicago'.
  --
  -- COALESCE to 'UTC' is the fail-safe, not the intent: AT TIME ZONE NULL
  -- returns NULL, which would collapse every approved chore into one NULL day
  -- row and silently zero the child's streak.
  WITH tz AS (
    SELECT NULLIF(f.timezone, '') AS name
    FROM public.family_members fm
    JOIN public.families f ON f.id = fm.family_id
    WHERE fm.id = p_member_id
  )
  SELECT (ca.approved_at
            AT TIME ZONE COALESCE((SELECT name FROM tz), 'UTC'))::date  AS day,
         count(*)::int                                                  AS total_count,
         count(*) FILTER (WHERE ca.template_id IS NOT NULL)::int        AS roster_count
  FROM public.chore_assignments ca
  WHERE ca.assigned_to = p_member_id
    AND ca.is_template = false
    AND ca.status = 'approved'
    AND ca.approved_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.process_loan_payments()
 RETURNS TABLE(loan_id uuid, member_name text, description text, amount numeric, paid_off boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r             record;
  v_local_day   int;
  v_month_start timestamptz;
  v_amount      numeric;
  v_paid        boolean;
BEGIN
  -- TIMEZONE IS NOW PER-LOAN, not per-run. It used to be two DECLARE-time
  -- constants in a hardcoded 'America/Chicago'. This function processes EVERY
  -- family's active loans in one pass, so a single zone computed up front would
  -- charge a Pacific family on Central's calendar -- and near a month boundary
  -- that is a payment taken in the wrong month, which the duplicate check below
  -- would then honour for the rest of that month.
  --
  -- FOR UPDATE *before* the duplicate check, not after. A read-then-write with
  -- no lock is precisely the race that produced the duplicate chore generation
  -- bug; here it would double-charge a child. Two concurrent runs (the button
  -- and the cron, or two tablets) now serialize.
  FOR r IN
    SELECT l.id, l.member_id, l.expense_id, l.description,
           l.monthly_payment, l.balance_remaining, l.payment_day,
           COALESCE(NULLIF(f.timezone, ''), 'UTC') AS tz
    FROM public.loans l
    JOIN public.families f ON f.id = l.family_id
    WHERE l.status = 'active'
    ORDER BY l.created_at
    -- OF l: lock the loan rows only. A bare FOR UPDATE would also lock the
    -- joined families row, blocking a parent saving a timezone in Settings.
    FOR UPDATE OF l
  LOOP
    CONTINUE WHEN r.expense_id IS NULL;

    v_local_day   := EXTRACT(DAY FROM (now() AT TIME ZONE r.tz))::int;
    v_month_start := date_trunc('month', now() AT TIME ZONE r.tz) AT TIME ZONE r.tz;

    CONTINUE WHEN v_local_day < r.payment_day;

    -- Already deducted this calendar month for this loan?
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.expense_applications ea
      WHERE ea.expense_id = r.expense_id
        AND ea.applied_at >= v_month_start
    );

    -- Never overpay: the final payment is exactly what is left.
    v_amount := LEAST(r.monthly_payment, r.balance_remaining);
    CONTINUE WHEN v_amount <= 0;

    -- The trigger on this insert does the debit.
    INSERT INTO public.expense_applications (expense_id, family_member_id, amount)
    VALUES (r.expense_id, r.member_id, v_amount);

    v_paid := (r.balance_remaining - v_amount) <= 0;

    UPDATE public.loans
       SET balance_remaining = r.balance_remaining - v_amount,
           status      = CASE WHEN v_paid THEN 'paid_off' ELSE 'active' END,
           paid_off_at = CASE WHEN v_paid THEN now() ELSE NULL END
     WHERE id = r.id;

    loan_id     := r.id;
    description := r.description;
    amount      := v_amount;
    paid_off    := v_paid;
    SELECT fm.display_name INTO member_name
      FROM public.family_members fm WHERE fm.id = r.member_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- STEP 6 -- the index exception, recorded on the object itself so it is visible
-- to anyone inspecting the schema without reading CLAUDE.md.
COMMENT ON INDEX public.idx_ca_daily_dedup IS
  'PERMANENT TIMEZONE EXCEPTION. Buckets due_date by a hardcoded America/Chicago '
  'literal while every other timezone-sensitive object reads families.timezone. '
  'It cannot be made dynamic: an index expression must be IMMUTABLE, and a '
  'subquery against families is not. Accepted deliberately -- the boundary '
  'shifts by at most one hour at DST transitions and by the timezone offset for '
  'non-Central families. That affects WHEN the daily dedup window resets, not '
  'WHETHER deduplication works: the bucket is still a single fixed 24-hour '
  'window per (template_id, assigned_to), so idempotency is preserved for any '
  'offset. Do not replace this with a trigger or a computed column.';
