-- APPLIED 2026-08-28. Additive half of server-side PIN verification.
-- Safe against the running production client: nothing existing changes.

-- Rate-limit state for the verify-pin Edge Function. RLS is enabled with NO
-- policies on purpose, so no client role can read or write it; the function
-- reaches it with the service-role key, which bypasses RLS.
create table if not exists public.pin_attempts (
  member_id         uuid primary key references public.family_members(id) on delete cascade,
  failed_count      int         not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until      timestamptz
);

alter table public.pin_attempts enable row level security;

comment on table public.pin_attempts is
  'Failed PIN attempt counters for the verify-pin Edge Function. Service-role only: RLS is on with no policies by design.';

-- Lets the kiosk know WHICH members have a PIN (verify vs create mode) without
-- ever exposing a PIN or hash. Booleans only, scoped to the caller's family by
-- the same predicate the families table uses.
create or replace function public.family_pin_status()
returns table (member_id uuid, has_pin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.id,
         coalesce(f.member_pins ? m.id::text, false)
  from public.family_members m
  join public.families f on f.id = m.family_id
  where public.user_belongs_to_family(m.family_id)
$$;

revoke all on function public.family_pin_status() from public, anon;
grant execute on function public.family_pin_status() to authenticated;

comment on function public.family_pin_status() is
  'Per-member has_pin booleans for the caller''s family. Never returns PIN values or hashes.';
