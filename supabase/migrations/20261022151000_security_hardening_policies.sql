-- Applied by hand in the SQL editor on 2026-10-22.
-- 1. family_members: no self-insert / self-update (is_app_admin() is true for any row with role admin,
--    so an own-row update let a user make themselves admin). Parents keep parents_manage_family_members.
drop policy if exists users_insert_own_family_member_record on public.family_members;
drop policy if exists users_update_own_family_member_record on public.family_members;

-- 2. invitations: the "by token" policy never matched a token, so anon could list every pending invite.
--    The app does not read invitations yet; signup work should add a SECURITY DEFINER lookup by token.
drop policy if exists "Anyone can view invitation by token" on public.invitations;
drop policy if exists users_view_pending_invitation_placeholder on public.family_members;

-- 3. milestone_progress: replace ALL/true/public with a family-scoped read. Writes happen in approve_chore.
drop policy if exists "System can manage milestone progress" on public.milestone_progress;
create policy milestone_progress_family_read on public.milestone_progress
  for select to authenticated
  using (exists (
    select 1 from public.milestones m
    where m.id = milestone_progress.milestone_id
      and public.user_belongs_to_family(m.family_id)
  ));
