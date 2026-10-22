-- approve_chore: validate p_approved_by (active parent/admin of the chore's family).
-- Everything else is byte-identical to 20260901213410. NEVER touches a balance: the
-- chore_approval_balance_update trigger credits it.

CREATE OR REPLACE FUNCTION public.approve_chore(p_assignment_id uuid, p_approved_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_member uuid;
  v_chore uuid;
  v_value numeric;
  v_family uuid;
  m RECORD;
BEGIN
  -- Serialize concurrent approvals of the same assignment.
  SELECT ca.status, ca.assigned_to, ca.chore_id
    INTO v_status, v_member, v_chore
  FROM chore_assignments ca
  WHERE ca.id = p_assignment_id AND ca.is_template = false
  FOR UPDATE;

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  SELECT fm.family_id INTO v_family FROM family_members fm WHERE fm.id = v_member;
  IF NOT public.is_family_parent(v_family) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- The approver is the ACTING parent chosen on the kiosk (one shared login, so
  -- auth.uid() cannot say which parent), so it is app-supplied. It must still be
  -- an active parent/admin in THIS chore's family: no spoofing a child, a
  -- deactivated member, or a member of another family.
  IF p_approved_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.family_members ap
    WHERE ap.id = p_approved_by
      AND ap.family_id = v_family
      AND ap.is_active = true
      AND (ap.role @> ARRAY['parent'] OR ap.role @> ARRAY['admin'])
  ) THEN
    RAISE EXCEPTION 'Invalid approver';
  END IF;

  -- Idempotent: only the completed->approved transition proceeds.
  IF v_status <> 'completed' THEN
    RETURN;
  END IF;

  SELECT c.value INTO v_value FROM chores c WHERE c.id = v_chore;

  -- Flip status. The chore_approval_balance_update trigger credits the balance.
  UPDATE chore_assignments
     SET status = 'approved', approved_at = now(), approved_by = p_approved_by
   WHERE id = p_assignment_id;

  -- Advance each of the child's not-yet-completed family milestones.
  --
  -- Child-initiated savings goals are EXCLUDED. They track the child's current
  -- balance, not accumulated earnings, and they belong to one child rather than
  -- the whole family -- so a milestone_progress row for a goal would be both
  -- wrong (ignores spending) and cross-contaminating (one child's approval
  -- would advance the other child's goal). Goal progress is computed from the
  -- balance at read time and never stored here.
  -- IS NOT TRUE, not = false: child_initiated is nullable.
  FOR m IN
    SELECT ms.id AS milestone_id, ms.target_amount,
           mp.id AS progress_id,
           COALESCE(mp.current_amount, 0) AS current_amount,
           mp.completed_at
    FROM milestones ms
    LEFT JOIN milestone_progress mp
      ON mp.milestone_id = ms.id AND mp.child_id = v_member
    WHERE ms.family_id = v_family
      AND mp.completed_at IS NULL
      AND ms.child_initiated IS NOT TRUE
  LOOP
    IF m.progress_id IS NULL THEN
      INSERT INTO milestone_progress (milestone_id, child_id, current_amount, completed_at)
      VALUES (m.milestone_id, v_member, v_value,
              CASE WHEN v_value >= m.target_amount THEN now() ELSE NULL END);
    ELSE
      UPDATE milestone_progress
         SET current_amount = m.current_amount + v_value,
             completed_at = CASE
               WHEN (m.current_amount + v_value) >= m.target_amount THEN now()
               ELSE m.completed_at END
       WHERE id = m.progress_id;
    END IF;
  END LOOP;
END;
$function$;
