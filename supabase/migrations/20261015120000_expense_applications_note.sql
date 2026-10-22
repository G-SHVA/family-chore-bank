-- Applied by hand in the SQL editor on 2026-10-15 (recorded here so the repo matches the live DB).
-- Per-charge detail, e.g. the chore a False Submission was charged for.
ALTER TABLE public.expense_applications ADD COLUMN IF NOT EXISTS note text;

DROP FUNCTION IF EXISTS public.apply_expense(uuid, uuid);

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
  INSERT INTO expense_applications (expense_id, family_member_id, amount, note)
  VALUES (p_expense_id, p_member_id, v_amount, NULLIF(btrim(p_note), ''));
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_expense(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_expense(uuid, uuid, text) TO authenticated, service_role;
