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
  isBcryptHash,
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

    // 1. Load the stored value. These checks cost the caller no attempt.

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

    // Fail closed on anything that isn't a bcrypt hash. The plaintext
    // comparison was removed once the migration completed, so a legacy or
    // corrupt value is treated as unusable rather than compared directly. The
    // client shows the same "ask a parent to set one up" prompt, and a parent
    // clearing + re-setting the PIN is the recovery path.
    if (!isBcryptHash(stored)) {
      return json({ valid: false, error: 'pin_not_hashed' }, 409)
    }

    // 2. Reserve an attempt BEFORE comparing, atomically in SQL (row-locked).
    // The old flow read the counter, compared, then wrote the failure back, so a
    // burst of parallel requests all read "0 failures" and each got a free
    // guess. Now at most MAX_ATTEMPTS comparisons can ever run per lock window,
    // and every further lock doubles (60s, 120s, 240s ... capped at 1h).
    const { data: begun, error: beginErr } = await admin.rpc('pin_attempt_begin', {
      p_member_id: memberId,
      p_max: MAX_ATTEMPTS,
      p_base_seconds: LOCKOUT_SECONDS,
    })
    const state = Array.isArray(begun) ? begun[0] : null
    if (beginErr || !state) return json({ valid: false, error: 'server_error' }, 500)

    if (state.is_locked) {
      return rateLimited(new Date(state.locked_until), new Date())
    }

    // 3. Compare.
    const valid = verifyAgainstStored(pin, stored)

    if (valid) {
      // Clear the counter.
      await admin.from('pin_attempts').delete().eq('member_id', memberId)
      return json({ valid: true })
    }

    // The failure was already counted by pin_attempt_begin. If that attempt
    // tripped the lock, say so now.
    if (state.locked_until) return rateLimited(new Date(state.locked_until), new Date())
    return json({
      valid: false,
      attempts_remaining: Math.max(0, MAX_ATTEMPTS - Number(state.attempts_used)),
    })
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
