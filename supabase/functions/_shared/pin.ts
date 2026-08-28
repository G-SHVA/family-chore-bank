import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4'
import bcrypt from 'npm:bcryptjs@2.4.3'

export const BCRYPT_COST = 10
export const PIN_PATTERN = /^\d{4}$/

/** bcrypt output: $2a$ / $2b$ / $2y$ followed by the cost and salt. */
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$/

export function isBcryptHash(value: string): boolean {
  return BCRYPT_RE.test(value)
}

export function hashPin(pin: string): string {
  // Sync on purpose: bcryptjs' async API leans on setImmediate shims that are
  // flaky under the edge runtime, and one cost-10 hash is ~100ms.
  return bcrypt.hashSync(pin, BCRYPT_COST)
}

/**
 * Verifies a PIN against whatever is stored. Accepts a legacy plaintext value
 * so the function is safe to deploy BEFORE the migration runs — see
 * `needsUpgrade` for the opportunistic re-hash.
 */
export function verifyAgainstStored(pin: string, stored: string): boolean {
  if (isBcryptHash(stored)) return bcrypt.compareSync(pin, stored)
  return timingSafeEqual(pin, stored)
}

export function needsUpgrade(stored: string): boolean {
  return !isBcryptHash(stored)
}

/** Constant-time string compare — only used on the legacy plaintext path. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface Caller {
  userId: string
  familyId: string
  memberId: string
  isParent: boolean
}

/** Service-role client. Bypasses RLS so member_pins can stay unreadable by clients. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

/**
 * Resolves the caller from their JWT and pins them to a family. Everything
 * downstream is scoped to this family, so one kiosk session can never probe
 * another family's PINs.
 */
export async function resolveCaller(req: Request, admin: SupabaseClient): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null

  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  )

  const { data: userData, error: userErr } = await anon.auth.getUser()
  if (userErr || !userData?.user) return null

  const { data: me, error: meErr } = await admin
    .from('family_members')
    .select('id, family_id, role')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (meErr || !me) return null

  const role: string[] = Array.isArray(me.role) ? me.role : []
  return {
    userId: userData.user.id,
    familyId: me.family_id,
    memberId: me.id,
    isParent: role.includes('parent') || role.includes('admin'),
  }
}

/** Confirms the target member exists inside the caller's family. */
export async function memberInFamily(
  admin: SupabaseClient,
  memberId: string,
  familyId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('family_members')
    .select('id')
    .eq('id', memberId)
    .eq('family_id', familyId)
    .maybeSingle()
  return !error && !!data
}

export function readPins(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, string>
  }
  return {}
}
