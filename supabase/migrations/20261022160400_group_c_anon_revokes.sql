-- Group C: stop anonymous callers executing the auth-helper SECURITY DEFINER functions.
-- authenticated keeps EXECUTE (RLS policies and the app call these as the signed-in kiosk user).
--
-- WHY THE POLICY STEP COMES FIRST. A policy that applies to role public/anon and calls one of these
-- functions would start raising "permission denied for function" for anonymous requests once anon
-- loses EXECUTE. The app only ever runs as `authenticated`, so those policies are re-pointed
-- `TO authenticated` (qualifiers unchanged). Known case: loans ("Parents can manage loans" and
-- "Family members can view loans" are created with no TO clause = public).
--
-- PREVIEW (read-only) - run this first and read the rows; these are exactly the policies step 1 changes:
--   select schemaname, tablename, policyname, roles, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and (roles @> array['public']::name[] or roles @> array['anon']::name[])
--     and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
--       '(is_app_admin|is_family_admin|is_family_parent|user_belongs_to_family|user_has_admin_role|user_has_role|can_manage_family_invitations|get_current_user_email|admin_get_user_emails|approve_chore)\(';

-- Step 1: re-point those policies at authenticated.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (roles @> array['public']::name[] OR roles @> array['anon']::name[])
      AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~
        '(is_app_admin|is_family_admin|is_family_parent|user_belongs_to_family|user_has_admin_role|user_has_role|can_manage_family_invitations|get_current_user_email|admin_get_user_emails|approve_chore)\('
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated', p.policyname, p.schemaname, p.tablename);
    RAISE NOTICE 'policy % on %.% -> authenticated', p.policyname, p.schemaname, p.tablename;
  END LOOP;
END $$;

-- Step 2: the revokes. is_plan_available is deliberately NOT touched (the pricing page may call it as
-- anon); it only reads plan_availability. Revisit with the signup work.
REVOKE EXECUTE ON FUNCTION
  public.admin_get_user_emails(uuid[]), public.approve_chore(uuid,uuid),
  public.can_manage_family_invitations(uuid), public.get_current_user_email(),
  public.is_app_admin(), public.is_family_admin(uuid), public.is_family_parent(uuid),
  public.user_belongs_to_family(uuid), public.user_has_admin_role(), public.user_has_role(uuid,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.admin_get_user_emails(uuid[]), public.approve_chore(uuid,uuid),
  public.can_manage_family_invitations(uuid), public.get_current_user_email(),
  public.is_app_admin(), public.is_family_admin(uuid), public.is_family_parent(uuid),
  public.user_belongs_to_family(uuid), public.user_has_admin_role(), public.user_has_role(uuid,text)
TO authenticated;

ALTER POLICY "Family members can view loans" ON public.loans TO authenticated;
