-- Baseline migration: captures live DB state as of 2026-09-01 for objects that
-- were applied directly without repo files.
-- This is not a replay of history -- it is a snapshot of current live state.
-- Do not run this against a DB that already has these objects (it uses
-- CREATE OR REPLACE and IF NOT EXISTS where possible).
--
-- ---------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
-- The live project has 17 applied migrations; supabase/migrations/ held 5 of
-- them (7 after the 2026-09-01 backfill). Ten migrations were applied directly
-- against the database with no corresponding file. This file captures the
-- objects those ten created, read out of the live database on 2026-09-01:
-- function bodies via pg_get_functiondef, structure via information_schema and
-- pg_indexes. Nothing here was reconstructed from memory.
--
-- Four of those ten -- balance_rpcs_approve_chore_apply_expense,
-- harden_approve_chore_idempotent_credit, approve_chore_lock_then_check and
-- rpcs_defer_balance_to_existing_triggers -- were successive refinements of the
-- same two functions. Those intermediate states no longer exist anywhere and
-- are deliberately NOT reconstructed. Only the final state each converged on is
-- recorded, which is the only version that was ever correct.
--
-- approve_chore is NOT in this file. Its current live state is already captured
-- by 20260901213410_approve_chore_exclude_child_initiated_goals.sql, which runs
-- before this one. Duplicating it here would create two sources of truth for
-- the single most safety-critical function in the app.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES **NOT** FIX -- read before assuming the repo is complete
--
-- The core schema is still untracked. The earliest migration in the live
-- history (20260808214850) ALTERs `families`, which means every base table --
-- families, family_members, chores, chore_assignments, expenses,
-- expense_applications, milestones, milestone_progress, rewards,
-- reward_redemptions, subscriptions -- already existed before the migration
-- history begins. So do the three balance triggers and their functions
-- (update_balance_on_chore_approval / _expense_application / _reward_redemption),
-- and the RLS policies on every base table.
--
-- None of that has a migration file anywhere, and this baseline does not invent
-- one. A from-scratch rebuild from this repo will therefore still fail: these
-- statements ALTER and reference tables the repo never creates.
--
-- This file closes the gap it can close honestly. Making the repo genuinely
-- rebuildable needs a full schema dump (`supabase db dump`) taken against the
-- live project as migration 0. That is a separate, larger piece of work.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 1. families.member_pins        (from: add_member_pins_to_families)
-- ===========================================================================
-- 4-digit PINs, keyed by family_members.id, stored as bcrypt hashes (cost 10).
-- Read and written ONLY by the verify-pin / set-pin Edge Functions under the
-- service-role key. The column-level grant that hides this from authenticated
-- and anon is set by 20260828130000_pin_bcrypt_migration_and_lockdown.sql --
-- that lockdown is what makes this column safe, and it is NOT repeated here.
ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS member_pins jsonb NOT NULL DEFAULT '{}'::jsonb;


-- ===========================================================================
-- 2. chore_assignments roster columns
--    (from: add_template_fields_to_chore_assignments, chore_roster_lifecycle)
-- ===========================================================================
-- The roster model: a row with is_template = true is a recurring ASSIGNMENT of
-- a chore to a child. generateDailyAssignments() reads active templates and
-- inserts dated instance rows (is_template = false) that carry template_id back
-- to the row they came from.
--
-- template_id is load-bearing well beyond generation: every streak calculation
-- and the savings-goal earning rate use `template_id IS NOT NULL` to separate
-- roster work from Direct Awards, because an award is inserted standalone and
-- leaves it null. A parent must not be able to hand out a streak.
ALTER TABLE public.chore_assignments
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

ALTER TABLE public.chore_assignments
  ADD COLUMN IF NOT EXISTS template_id uuid;

-- Pause/resume a roster entry. The generator only reads active templates.
-- Pausing is the normal way to take a chore off a child; deleting the template
-- row is permanent and cannot be resumed.
ALTER TABLE public.chore_assignments
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 0=Sun .. 6=Sat, pins a weekly chore to a weekday. Null = due end of week.
-- Only meaningful on template rows.
ALTER TABLE public.chore_assignments
  ADD COLUMN IF NOT EXISTS recurrence_dow smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chore_assignments_template_id_fkey'
  ) THEN
    ALTER TABLE public.chore_assignments
      ADD CONSTRAINT chore_assignments_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.chore_assignments(id);
  END IF;
END $$;

-- Indexes on chore_assignments, exactly as they exist live. idx_ca_daily_dedup
-- is deliberately absent -- it is owned by
-- 20260831090000_chore_assignment_daily_dedup_index.sql.
--
-- RULE (see CLAUDE.md): check pg_indexes before adding another one here. This
-- table grows ~51 rows/day and duplicate indexes are invisible in queries but
-- cost on every single write.
CREATE INDEX IF NOT EXISTS chore_assignments_template_active_idx
  ON public.chore_assignments USING btree (is_template, is_active)
  WHERE (is_template = true);

CREATE INDEX IF NOT EXISTS idx_ca_due_date
  ON public.chore_assignments USING btree (due_date DESC);

CREATE INDEX IF NOT EXISTS idx_chore_assignments_assigned_instances
  ON public.chore_assignments USING btree (assigned_to, due_date)
  WHERE (is_template = false);

CREATE INDEX IF NOT EXISTS idx_chore_assignments_assigned_to
  ON public.chore_assignments USING btree (assigned_to);

CREATE INDEX IF NOT EXISTS idx_chore_assignments_chore_id
  ON public.chore_assignments USING btree (chore_id);

CREATE INDEX IF NOT EXISTS idx_chore_assignments_status
  ON public.chore_assignments USING btree (status);

CREATE INDEX IF NOT EXISTS idx_chore_assignments_template_id
  ON public.chore_assignments USING btree (template_id);


-- ===========================================================================
-- 3. chore_assignments_archive
--    (from: create_chore_assignments_archive,
--           archive_foreign_keys_for_postgrest_embedding)
-- ===========================================================================
-- Cold storage for expired/rejected instance rows older than 90 days.
--
-- The column list mirrors chore_assignments EXACTLY -- all 15 columns, same
-- order, is_active and recurrence_dow INCLUDED. They are not optional:
-- archive_old_assignments() moves rows between the two tables with explicit
-- column lists, and a mismatch fails at runtime. If a column is ever added to
-- chore_assignments, add it here and inside that function.
CREATE TABLE IF NOT EXISTS public.chore_assignments_archive (
  id              uuid        NOT NULL,
  chore_id        uuid        NOT NULL,
  assigned_to     uuid        NOT NULL,
  assigned_by     uuid,
  status          text,
  due_date        timestamptz,
  completed_at    timestamptz,
  approved_at     timestamptz,
  approved_by     uuid,
  notes           text,
  created_at      timestamptz,
  is_template     boolean     NOT NULL DEFAULT false,
  template_id     uuid,
  is_active       boolean     NOT NULL DEFAULT true,
  recurrence_dow  smallint,
  CONSTRAINT chore_assignments_archive_pkey PRIMARY KEY (id)
);

-- These four FKs are LOAD-BEARING, not decoration. PostgREST derives embedded
-- joins from foreign keys, so without chore_id -> chores(id) an All Time
-- analytics read of `chore:chores(title, value, category)` fails outright with
-- PGRST200 "Could not find a relationship". Verified against the live REST
-- endpoint. chore_id is ON DELETE RESTRICT, matching the live table: deleting a
-- library chore must never wipe a child's earned-chore history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'chore_assignments_archive_chore_id_fkey') THEN
    ALTER TABLE public.chore_assignments_archive
      ADD CONSTRAINT chore_assignments_archive_chore_id_fkey
      FOREIGN KEY (chore_id) REFERENCES public.chores(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'chore_assignments_archive_assigned_to_fkey') THEN
    ALTER TABLE public.chore_assignments_archive
      ADD CONSTRAINT chore_assignments_archive_assigned_to_fkey
      FOREIGN KEY (assigned_to) REFERENCES public.family_members(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'chore_assignments_archive_assigned_by_fkey') THEN
    ALTER TABLE public.chore_assignments_archive
      ADD CONSTRAINT chore_assignments_archive_assigned_by_fkey
      FOREIGN KEY (assigned_by) REFERENCES public.family_members(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'chore_assignments_archive_approved_by_fkey') THEN
    ALTER TABLE public.chore_assignments_archive
      ADD CONSTRAINT chore_assignments_archive_approved_by_fkey
      FOREIGN KEY (approved_by) REFERENCES public.family_members(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_caa_assigned_to
  ON public.chore_assignments_archive USING btree (assigned_to);

CREATE INDEX IF NOT EXISTS idx_caa_due_date
  ON public.chore_assignments_archive USING btree (due_date DESC);

CREATE INDEX IF NOT EXISTS idx_caa_status
  ON public.chore_assignments_archive USING btree (status);

ALTER TABLE public.chore_assignments_archive ENABLE ROW LEVEL SECURITY;

-- Family-scoped through chores.family_id, mirroring the live table's policy.
--
-- Do NOT rewrite this as a subquery over chore_assignments_archive itself:
-- Postgres re-applies the policy to that inner reference and aborts with
-- "infinite recursion detected in policy for relation". It would also match
-- nothing regardless, because this kiosk keeps a user_id on the operator member
-- row only, while assignments belong to children.
DROP POLICY IF EXISTS "Parents can read family archive" ON public.chore_assignments_archive;
CREATE POLICY "Parents can read family archive"
  ON public.chore_assignments_archive
  FOR SELECT TO authenticated
  USING (
    chore_id IN (
      SELECT c.id FROM public.chores c
      WHERE c.family_id IN (
        SELECT fm.family_id FROM public.family_members fm
        WHERE fm.user_id = auth.uid()
          AND 'parent' = ANY (fm.role)
          AND fm.is_active = true
      )
    )
  );

-- NOTE ON TABLE GRANTS: anon, authenticated and service_role all hold the
-- Supabase default full table grant here. That is the project-wide default for
-- a new table, not something the original migration chose, so it is not
-- re-issued. RLS above is what actually restricts access, and it is SELECT-only
-- for authenticated -- there is no INSERT/UPDATE/DELETE policy, so writes are
-- denied to every client role regardless of the grant.


-- ===========================================================================
-- 4. apply_expense
--    (from: balance_rpcs_..., harden_..., lock_then_check,
--           rpcs_defer_balance_to_existing_triggers)
-- ===========================================================================
-- Current live definition, read via pg_get_functiondef on 2026-09-01.
--
-- THE MONEY IS NOT TOUCHED HERE. expense_application_balance_update is an
-- AFTER INSERT trigger on expense_applications and it does the debit; this
-- function only resolves the amount, authorizes, and inserts. Never add a
-- balance write here -- it would double-count against the trigger. That is the
-- lesson the 'rpcs_defer_balance_to_existing_triggers' migration encoded.
--
-- Negative balances are allowed by design (the child "owes"), and Direct Charge
-- depends on that.
CREATE OR REPLACE FUNCTION public.apply_expense(p_expense_id uuid, p_member_id uuid)
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

  -- The expense_application_balance_update trigger deducts the balance on insert.
  INSERT INTO expense_applications (expense_id, family_member_id, amount)
  VALUES (p_expense_id, p_member_id, v_amount);
END;
$function$;


-- ===========================================================================
-- 5. archive_old_assignments      (from: create_archive_old_assignments)
-- ===========================================================================
-- Current live definition, read via pg_get_functiondef on 2026-09-01.
-- Run manually about monthly; nothing schedules it.
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
    is_active, recurrence_dow
  )
  SELECT
    id, chore_id, assigned_to, assigned_by, status, due_date, completed_at,
    approved_at, approved_by, notes, created_at, is_template, template_id,
    is_active, recurrence_dow
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

-- service_role ONLY. This function deletes rows, so the kiosk's shared
-- authenticated session must never be able to call it over REST. Verified live:
-- anon and authenticated both have EXECUTE = false.
REVOKE ALL ON FUNCTION public.archive_old_assignments() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_old_assignments() TO service_role;
