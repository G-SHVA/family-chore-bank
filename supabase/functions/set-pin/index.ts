// set-pin — server-side PIN creation and reset.
//
// The plaintext PIN is sent over TLS, hashed here with bcrypt (cost 10) and
// stored. It is never hashed on the client, so the browser bundle carries no
// bcrypt code and no PIN ever lands in local state.
//
//   { member_id, pin }                  -> create a PIN (only if none is set)
//   { member_id, action: 'clear' }      -> remove a PIN (parents/admins only)
//
// Creation is deliberately restricted to members with no PIN: that matches the
// kiosk's first-tap setup and stops one member from overwriting another's PIN.
// A parent resets first (clear), then the member sets a new one on next tap.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
import {
  adminClient,
  resolveCaller,
  memberInFamily,
  readPins,
  hashPin,
  PIN_PATTERN,
} from '../_shared/pin.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const body = await req.json().catch(() => null)
    const memberId = body?.member_id
    const action: string = body?.action ?? 'set'

    if (typeof memberId !== 'string' || (action !== 'set' && action !== 'clear')) {
      return json({ ok: false, error: 'bad_request' }, 400)
    }

    const admin = adminClient()

    const caller = await resolveCaller(req, admin)
    if (!caller) return json({ ok: false, error: 'unauthorized' }, 401)
    if (!(await memberInFamily(admin, memberId, caller.familyId))) {
      return json({ ok: false, error: 'forbidden' }, 403)
    }

    const { data: family, error: famErr } = await admin
      .from('families')
      .select('id, member_pins')
      .eq('id', caller.familyId)
      .single()

    if (famErr || !family) return json({ ok: false, error: 'server_error' }, 500)

    const pins = readPins(family.member_pins)

    if (action === 'clear') {
      if (!caller.isParent) return json({ ok: false, error: 'forbidden' }, 403)
      const next = { ...pins }
      delete next[memberId]
      const { error } = await admin
        .from('families')
        .update({ member_pins: next })
        .eq('id', caller.familyId)
      if (error) return json({ ok: false, error: 'server_error' }, 500)
      await admin.from('pin_attempts').delete().eq('member_id', memberId)
      return json({ ok: true })
    }

    // action === 'set'
    const pin = body?.pin
    if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
      return json({ ok: false, error: 'bad_request' }, 400)
    }

    const existing = pins[memberId]
    if (typeof existing === 'string' && existing.length > 0) {
      // A parent must clear it first; this endpoint never overwrites.
      return json({ ok: false, error: 'pin_already_set' }, 409)
    }

    const next = { ...pins, [memberId]: hashPin(pin) }
    const { error } = await admin
      .from('families')
      .update({ member_pins: next })
      .eq('id', caller.familyId)
    if (error) return json({ ok: false, error: 'server_error' }, 500)

    await admin.from('pin_attempts').delete().eq('member_id', memberId)
    return json({ ok: true })
  } catch {
    return json({ ok: false, error: 'server_error' }, 500)
  }
})
