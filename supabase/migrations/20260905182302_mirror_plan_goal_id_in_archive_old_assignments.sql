-- Adds plan_goal_id to BOTH explicit column lists in archive_old_assignments()
-- (16 -> 17), appended last to match the live table's ordinal position. The
-- body is otherwise byte-identical to the definition read from the live
-- database on 2026-09-05 via pg_get_functiondef.
--
-- Required by the mirror invariant: the function moves rows between
-- chore_assignments and chore_assignments_archive with explicit column lists,
-- so a count mismatch fails at runtime rather than at deploy.
CREATE OR REPLACE FUNCTION public.archive_old_assignments()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cutoff timestamptz := now() - interval '90 days';
  v_moved integer;
BEGIN
  -- Single statement: rows are deleted and archived in one pass, so the set
  -- archived and the set removed are identical by construction. Two separate
  -- statements could diverge if the predicate matched differently between them,
  -- and the divergence would be silent data loss from the money-adjacent table.
  --
  -- NEVER touches: approved rows (financial history behind every balance),
  -- template rows (deleting one takes the child off the chore), or
  -- pending/in_progress rows (still live).
  WITH moved AS (
    DELETE FROM public.chore_assignments
    WHERE status IN ('expired', 'rejected')
      AND is_template = false
      AND due_date < v_cutoff
    RETURNING *
  )
  INSERT INTO public.chore_assignments_archive (
    id, chore_id, assigned_to, assigned_by, status, due_date, completed_at,
    approved_at, approved_by, notes, created_at, is_template, template_id,
    is_active, recurrence_dow, recurrence_week, plan_goal_id
  )
  SELECT
    id, chore_id, assigned_to, assigned_by, status, due_date, completed_at,
    approved_at, approved_by, notes, created_at, is_template, template_id,
    is_active, recurrence_dow, recurrence_week, plan_goal_id
  FROM moved;

  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN jsonb_build_object(
    'archived', v_moved,
    'deleted', v_moved,
    'cutoff_date', v_cutoff,
    'run_at', now()
  );
END;
$function$;
