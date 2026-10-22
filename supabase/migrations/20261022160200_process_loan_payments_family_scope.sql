-- process_loan_payments(p_family_id): optional family scope.
-- Before: any parent's button press processed EVERY family's loans and returned other
-- families' children's names and amounts. The zero-argument call still works (default NULL
-- = all families, for the future cron), so deploy order SQL-vs-edge-function does not matter.
-- Body otherwise identical to 20260903201021. Service-role only, as before.

DROP FUNCTION IF EXISTS public.process_loan_payments();

CREATE OR REPLACE FUNCTION public.process_loan_payments(p_family_id uuid DEFAULT NULL)
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
      -- NULL = every family (the monthly cron). The edge function ALWAYS passes the
      -- caller's family, so a parent can only ever run their own.
      AND (p_family_id IS NULL OR l.family_id = p_family_id)
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

REVOKE ALL ON FUNCTION public.process_loan_payments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_loan_payments(uuid) TO service_role;
