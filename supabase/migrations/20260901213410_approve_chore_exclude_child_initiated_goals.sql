-- approve_chore: exclude child-initiated savings goals from milestone_progress.
--
-- APPLIED to the live project on 2026-09-01 (remote migration version
-- 20260901213410). This file is the repo's record of that change, backfilled in
-- the same session after the deploy. It captures the FULL CURRENT LIVE STATE of
-- the function, verified by reading pg_get_functiondef back from the live DB --
-- not a reconstruction. Requires 20260901213153 (the milestones columns).
--
-- WHY THIS IS NOT OPTIONAL. The milestone loop below is scoped only by
-- `ms.family_id = v_family`. A savings goal lives in the same `milestones`
-- table as parent-set family milestones, so without the added predicate:
--
--   * Cuddles' next chore approval would INSERT a milestone_progress row
--     against POCO's personal goal, and vice versa -- one child's work
--     advancing the other child's goal.
--   * The stored figure accumulates LIFETIME EARNINGS, whereas a goal tracks
--     the child's CURRENT BALANCE. Those diverge the moment a child spends, so
--     the number would be wrong as well as cross-contaminated.
--
-- Goal progress is computed at read time (min(balance, target)) and is never
-- stored. Nothing should ever write milestone_progress for a goal.
--
-- `IS NOT TRUE`, deliberately NOT `= false`: child_initiated is nullable, and
-- in SQL `NULL = false` evaluates to NULL, not true -- so an `= false`
-- predicate would silently skip NULL rows, treating an ordinary milestone as a
-- goal and quietly stopping its progress. `IS NOT TRUE` matches both false and
-- NULL, which is the intended "everything that is not a goal".
--
-- DIFF FROM THE PREVIOUS LIVE VERSION: one predicate line plus comments.
-- Everything else is byte-identical -- the FOR UPDATE serialization, the
-- is_family_parent authorization check, the completed->approved idempotency
-- guard, and critically the fact that this function NEVER touches a balance
-- (chore_approval_balance_update, an AFTER UPDATE trigger, does that).

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
