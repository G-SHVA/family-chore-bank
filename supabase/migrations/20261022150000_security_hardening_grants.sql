-- Applied by hand in the SQL editor on 2026-10-22 (recorded here so the repo matches the live DB).
-- Server-only functions: nothing in the app calls these; stripe-webhook uses service_role.
revoke execute on function public.complete_paid_subscription(uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.cleanup_expired_pending_subscriptions() from public, anon, authenticated;
grant  execute on function public.complete_paid_subscription(uuid,text,text,text) to service_role;
grant  execute on function public.cleanup_expired_pending_subscriptions() to service_role;

-- Trigger functions: triggers still fire after the revoke.
revoke execute on function
  public.activate_placeholder_member(),
  public.create_placeholder_family_member(),
  public.create_starter_subscription(),
  public.trigger_invitation_email(),
  public.update_balance_on_expense_application()
from public, anon, authenticated;

-- pin_attempts: RLS was on with no policies. Make the deny explicit (edge functions use service_role).
revoke all on public.pin_attempts from anon, authenticated;
create policy pin_attempts_deny_clients on public.pin_attempts
  as restrictive for all to anon, authenticated using (false) with check (false);
