-- process_loan_payments() — the monthly auto-deduction.
--
-- All of the money logic lives HERE rather than in the Edge Function, so the
-- beta "Run Monthly Deductions" button and the future cron on the 5th execute
-- byte-identical code, and so the check and the write cannot be separated by a
-- network round trip.
--
-- WHY NOT apply_expense(). Two independent disqualifications:
--   1. apply_expense guards with is_family_parent(), which reads auth.uid().
--      Under the service-role key auth.uid() is NULL, so it would raise
--      'Not authorized' on every single run.
--   2. apply_expense deducts expenses.amount — a fixed value. The final
--      payment against a $1.00 remaining balance would charge the full
--      monthly $2.50 and overpay the loan.
--
-- NO CODE HERE TOUCHES family_members.balance. The INSERT into
-- expense_applications fires expense_application_balance_update (AFTER INSERT),
-- which does the debit. Overdrafts are allowed by design: a loan payment may
-- deliberately take a child negative.
CREATE OR REPLACE FUNCTION public.process_loan_payments()
RETURNS TABLE (
  loan_id     uuid,
  member_name text,
  description text,
  amount      numeric,
  paid_off    boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- America/Chicago, matching idx_ca_daily_dedup and
  -- member_approved_day_counts(). families.timezone still reads 'UTC' and is
  -- read by nothing; see the timezone reconciliation item in CLAUDE.md.
  v_local_day  int := EXTRACT(DAY FROM (now() AT TIME ZONE 'America/Chicago'))::int;
  v_month_start timestamptz :=
    date_trunc('month', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
  r        record;
  v_amount numeric;
  v_paid   boolean;
BEGIN
  -- FOR UPDATE *before* the duplicate check, not after. A read-then-write with
  -- no lock is precisely the race that produced the duplicate chore generation
  -- bug; here it would double-charge a child. Two concurrent runs (the button
  -- and the cron, or two tablets) now serialize.
  FOR r IN
    SELECT l.id, l.member_id, l.expense_id, l.description,
           l.monthly_payment, l.balance_remaining, l.payment_day
    FROM public.loans l
    WHERE l.status = 'active'
    ORDER BY l.created_at
    FOR UPDATE
  LOOP
    CONTINUE WHEN r.expense_id IS NULL;
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
$$;

-- It moves money. The kiosk's shared authenticated session must never be able
-- to call it over REST. Same posture as archive_old_assignments().
REVOKE ALL ON FUNCTION public.process_loan_payments() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_loan_payments() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_loan_payments() TO service_role;
