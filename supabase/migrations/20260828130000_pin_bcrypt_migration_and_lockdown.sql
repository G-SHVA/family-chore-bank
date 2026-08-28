-- APPLIED 2026-08-28, after the new client went live. Run ONLY after the new client + Edge Functions are live in production.
--
-- Why the ordering matters:
--   * The old client compares PINs in the browser against plaintext. Hashing
--     before it is replaced locks every member out.
--   * The old client does `select('*')` on families. Revoking a column makes
--     that query fail outright.
-- verify-pin accepts legacy plaintext and re-hashes on success, so the new
-- client runs happily against un-migrated data. That is what makes this safe
-- to defer rather than run in lockstep.
--
-- Rollback for the hashing step is a restore of the pre-migration jsonb
-- snapshot; bcrypt is one-way, so there is no in-place undo.

-- 1. Plaintext -> bcrypt (cost 10). pgcrypto lives in the `extensions` schema.
--    Idempotent: anything already hashed passes straight through, so a re-run
--    can never double-hash.
update public.families f
set member_pins = (
  select jsonb_object_agg(
           kv.key,
           case
             when kv.value #>> '{}' ~ '^\$2[aby]\$\d{2}\$' then kv.value
             else to_jsonb(extensions.crypt(kv.value #>> '{}', extensions.gen_salt('bf', 10)))
           end
         )
  from jsonb_each(f.member_pins) kv
)
where f.member_pins is not null
  and f.member_pins <> '{}'::jsonb;

-- 2. Stop shipping PIN material to the browser.
--    Both roles hold a TABLE-level SELECT grant, which implies every column, so
--    a bare `revoke select (member_pins)` would be a no-op. Revoke the table
--    grant, then re-grant the other 13 columns explicitly.
revoke select on public.families from authenticated, anon;

grant select (
  id, name, stripe_customer_id, subscription_tier, max_children, max_parents,
  currency, timezone, created_at, updated_at, share_progress,
  allow_notifications, data_collection
) on public.families to authenticated, anon;

-- 3. Applied as a follow-up. RLS already made pin_attempts rows invisible and
--    unwritable to clients (a client DELETE matched zero rows and the lockout
--    held), but PostgREST answered 204, which reads like success. Removing the
--    grants makes any client attempt an unambiguous 403. service_role bypasses
--    both grants and RLS, so the Edge Functions are unaffected.
revoke all on public.pin_attempts from authenticated, anon;
