-- apply_expense: the charged member must belong to the SAME family as the expense.
-- Before: any parent could debit a child in another family (the member id was never checked).
-- Body is otherwise identical to 20261015120000 (note parameter kept). No balance code here:
-- expense_application_balance_update (AFTER INSERT trigger) does the debit.
CREATE OR REPLACE FUNCTION public.apply_expense(p_expense_id uuid, p_member_id uuid, p_note text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_amount numeric;
  v_family uuid;
BEGIN
  SELECT amount, family_id INTO v_amount, v_family
  FROM expenses WHERE id = p_expense_id;
  IF v_amount IS NULL THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;
  IF NOT public.is_family_parent(v_family) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.family_members fm
    WHERE fm.id = p_member_id AND fm.family_id = v_family
  ) THEN
    RAISE EXCEPTION 'Member is not in this expense''s family';
  END IF;
  INSERT INTO expense_applications (expense_id, family_member_id, amount, note)
  VALUES (p_expense_id, p_member_id, v_amount, NULLIF(btrim(p_note), ''));
END;
$function$;
