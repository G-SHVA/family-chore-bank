// verify-pin — server-side PIN verification.
//
// The client sends { member_id, pin } and gets back { valid: boolean }. The
// stored hash never leaves the database, and the submitted PIN is never logged
// or echoed. Failed attempts are counted per member_id in public.pin_attempts
// (service-role only, no RLS policies) and 5 failures locks that member out
// for 60 seconds with a 429.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  resolveCaller,
  memberInFamily,
  readPins,
  verifyAgainstStored,
  needsUpgrade,
  hashPin,
  PIN_PATTERN,
} from '../_shared/pin.ts'

const MAX_ATTEMPTS = 5
const LOCKOUT_SECONDS = 60

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    const memberId = body?.member_id
    const pin = body?.pin

    if (typeof memberId !== 'string' || typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      return json({ valid: false, error: 'bad_request' }, 400)
    }

    const admin = adminClient()

    const caller = await resolveCaller(req, admin)
    if (!caller) return json({ valid: false, error: 'unauthorized' }, 401)
    if (!(await memberInFamily(admin, memberId, caller.familyId))) {
      return json({ valid: false, error: 'forbidden' }, 403)
    }

    const now = new Date()

    // 1. Already locked out?
    const { data: attempt } = await admin
      .from('pin_attempts')
      .select('failed_count, window_started_at, locked_until')
      .eq('member_id', memberId)
      .maybeSingle()

    if (attempt?.locked_until && new Date(attempt.locked_until) > now) {
      return rateLimited(new Date(attempt.locked_until), now)
    }

    // 2. Verify against the stored value.
    const { data: family, error: famErr } = await admin
      .from('families')
      .select('id, member_pins')
      .eq('id', caller.familyId)
      .single()

    if (famErr || !family) return json({ valid: false, error: 'server_error' }, 500)

    const pins = readPins(family.member_pins)
    const stored = pins[memberId]

    // No PIN set for this member — the client should be in "create" mode.
    if (typeof stored !== 'string' || stored.length === 0) {
      return json({ valid: false, error: 'no_pin_set' }, 409)
    }

    const valid = verifyAgainstStored(pin, stored)

    if (valid) {
      // Clear the failure counter.
      await admin.from('pin_attempts').delete().eq('member_id', memberId)

      // Opportunistic upgrade: a correct PIN still stored in plaintext gets
      // hashed in place, so the migration is belt-and-braces rather than the
      // only path off plaintext.
      if (needsUpgrade(stored)) {
        const next = { ...pins, [memberId]: hashPin(pin) }
        await admin.from('families').update({ member_pins: next }).eq('id', caller.familyId)
      }
      return json({ valid: true })
    }

    // 3. Record the failure.
    const lockExpired = attempt?.locked_until && new Date(attempt.locked_until) <= now
    const failedCount = attempt && !lockExpired ? (attempt.failed_count ?? 0) + 1 : 1
    const windowStartedAt =
      attempt && !lockExpired ? (attempt.window_started_at ?? now.toISOString()) : now.toISOString()
    const lockedUntil =
      failedCount >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCKOUT_SECONDS * 1000) : null

    await admin.from('pin_attempts').upsert(
      {
        member_id: memberId,
        failed_count: failedCount,
        window_started_at: windowStartedAt,
        locked_until: lockedUntil?.toISOString() ?? null,
      },
      { onConflict: 'member_id' }
    )

    if (lockedUntil) return rateLimited(lockedUntil, now)
    return json({ valid: false, attempts_remaining: MAX_ATTEMPTS - failedCount })
  } catch {
    // Never leak internals — the client only needs to know it couldn't verify.
    return json({ valid: false, error: 'server_error' }, 500)
  }
})

function rateLimited(lockedUntil: Date, now: Date): Response {
  const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000))
  return json({ valid: false, error: 'rate_limited', retry_after: retryAfter }, 429, {
    'Retry-After': String(retryAfter),
  })
}
