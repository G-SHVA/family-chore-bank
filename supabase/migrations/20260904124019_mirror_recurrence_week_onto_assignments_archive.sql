-- CLAUDE.md invariant: chore_assignments_archive mirrors chore_assignments
-- column for column, and archive_old_assignments() carries explicit column
-- lists on BOTH sides of its move. Adding a column to the live table without
-- mirroring it here leaves the two out of step for whoever next reads the rule.
--
-- recurrence_week is only ever non-null on template rows, and the archive
-- never accepts templates (the function's predicate is is_template = false),
-- so in practice this column stays NULL. It is added to keep the mirror exact
-- rather than because the data needs it.
ALTER TABLE public.chore_assignments_archive
ADD COLUMN recurrence_week smallint;

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
    is_active, recurrence_dow, recurrence_week
  )
  SELECT
    id, chore_id, assigned_to, assigned_by, status, due_date, completed_at,
    approved_at, approved_by, notes, created_at, is_template, template_id,
    is_active, recurrence_dow, recurrence_week
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
