// process-loan-payments — the monthly loan auto-deduction.
//
// A THIN AUTH WRAPPER, deliberately. Every piece of money logic — the due-date
// check, the once-per-calendar-month guard, the row lock, the exact final
// payment, the paid-off flip — lives in the public.process_loan_payments()
// SQL function. This function only proves the caller is a parent in this
// family and then calls it with the service-role key.
//
// That split is the point: the beta "Run Monthly Deductions" button and the
// cron job planned for the 5th of each month after the Supabase Pro upgrade
// both execute byte-identical logic. Moving to cron changes the trigger, not
// the code.
//
// The RPC is granted to service_role ONLY (see the migration), so it cannot be
// reached over REST by the kiosk's shared authenticated session. This function
// is the sole door.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { corsHeaders, json } from '../_shared/cors.ts'
// adminClient/resolveCaller are generic auth helpers that happen to live in
// pin.ts. Imported from there rather than split into a new module: pin.ts is
// on the PIN security path, and a mechanical move would mean redeploying
// set-pin and verify-pin to keep the repo and the deployed bundles in step.
// The only cost of reusing it is that bcryptjs rides along into a function
// that runs once a month.
import { adminClient, resolveCaller } from '../_shared/pin.ts'

interface PaymentRow {
  loan_id: string
  member_name: string | null
  description: string | null
  amount: number
  paid_off: boolean
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const admin = adminClient()

    const caller = await resolveCaller(req, admin)
    if (!caller) return json({ error: 'unauthorized' }, 401)
    // Children must never be able to trigger a deduction against themselves or
    // a sibling. Payments are a parental act on a parental schedule.
    if (!caller.isParent) return json({ error: 'forbidden' }, 403)

    const { data, error } = await admin.rpc('process_loan_payments')

    if (error) {
      // Surface the real reason. This is a money path, and a generic failure
      // message would leave a parent unable to tell "nothing was due" from
      // "the deduction failed".
      return json(
        { error: 'processing_failed', detail: error.message ?? 'unknown database error' },
        500
      )
    }

    const rows = (data ?? []) as PaymentRow[]
    const totalDeducted = rows.reduce((sum, r) => sum + Number(r.amount), 0)

    return json({
      processed: rows.length,
      total_deducted: Number(totalDeducted.toFixed(2)),
      paid_off: rows.filter((r) => r.paid_off).length,
      results: rows,
      errors: [],
    })
  } catch (e) {
    return json(
      { error: 'server_error', detail: e instanceof Error ? e.message : 'unexpected failure' },
      500
    )
  }
})
