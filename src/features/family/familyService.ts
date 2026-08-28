import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import type { Family, FamilyMember } from '@/lib/supabase'

/**
 * The family as the kiosk sees it. member_pins is deliberately absent: PIN
 * material never reaches the browser, and the column is not even readable by
 * the authenticated role (see the pin lockdown migration).
 */
export type KioskFamily = Omit<Family, 'member_pins'>

/** Every families column EXCEPT member_pins. `select('*')` would now fail. */
const FAMILY_COLUMNS =
  'id, name, stripe_customer_id, subscription_tier, max_children, max_parents, ' +
  'currency, timezone, created_at, updated_at, share_progress, allow_notifications, data_collection'

export interface KioskContext {
  family: KioskFamily
  members: FamilyMember[]
  /** family_members.id of the signed-in (kiosk owner) user. */
  currentUserMemberId: string
  /** family_members.id -> whether a PIN is set. Booleans only, never values. */
  pinStatus: PinStatus
}

/** Map of family_members.id -> whether that member has a PIN set. */
export type PinStatus = Record<string, boolean>

export type PinVerifyResult =
  | { status: 'valid' }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfter: number }
  | { status: 'no_pin_set' }
  /** Function unreachable, timed out, or returned something unusable. */
  | { status: 'error' }

/** Seconds the tile stays locked when the server doesn't name a duration. */
const DEFAULT_LOCKOUT_SECONDS = 60

interface FunctionResponse {
  status: number
  body: Record<string, unknown>
}

/**
 * Calls an Edge Function with the kiosk session. Uses fetch rather than
 * supabase-js functions.invoke() so status codes stay visible — the 429 path
 * depends on telling "wrong PIN" apart from "rate limited".
 */
async function callFunction(name: string, payload: unknown): Promise<FunctionResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in.')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, body }
}

/**
 * Verifies a PIN server-side. The PIN is sent over TLS and compared against a
 * bcrypt hash in the Edge Function; nothing about the stored value comes back.
 */
export async function verifyMemberPin(memberId: string, pin: string): Promise<PinVerifyResult> {
  let res: FunctionResponse
  try {
    res = await callFunction('verify-pin', { member_id: memberId, pin })
  } catch {
    // Offline, DNS failure, CORS, function cold-start timeout — never treat any
    // of these as a pass.
    return { status: 'error' }
  }

  if (res.status === 429) {
    const retry = Number(res.body.retry_after)
    return {
      status: 'rate_limited',
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : DEFAULT_LOCKOUT_SECONDS,
    }
  }
  if (res.status === 409) return { status: 'no_pin_set' }
  if (res.status !== 200) return { status: 'error' }
  return res.body.valid === true ? { status: 'valid' } : { status: 'invalid' }
}

/** Creates a PIN. The Edge Function hashes it; the browser never hashes or stores it. */
export async function createMemberPin(memberId: string, pin: string): Promise<void> {
  const res = await callFunction('set-pin', { member_id: memberId, pin })
  if (res.status !== 200 || res.body.ok !== true) {
    throw new Error(
      res.body.error === 'pin_already_set'
        ? 'This member already has a PIN. A parent must reset it first.'
        : 'Could not save the PIN. Check your connection and try again.'
    )
  }
}

/** Removes a member's PIN (parents/admins only, enforced server-side). */
export async function removeMemberPin(memberId: string): Promise<void> {
  const res = await callFunction('set-pin', { member_id: memberId, action: 'clear' })
  if (res.status !== 200 || res.body.ok !== true) {
    throw new Error('Could not reset the PIN. Check your connection and try again.')
  }
}

/** has_pin booleans for the caller's family. Returns no PIN values or hashes. */
export async function fetchPinStatus(): Promise<PinStatus> {
  const { data, error } = await supabase.rpc('family_pin_status')
  if (error) throw error
  const status: PinStatus = {}
  for (const row of (data ?? []) as { member_id: string; has_pin: boolean }[]) {
    status[row.member_id] = row.has_pin
  }
  return status
}

/**
 * Loads the family + all members for the authenticated kiosk session.
 * The session is a parent/admin, so RLS allows reading every member row.
 */
export async function fetchKioskContext(userId: string): Promise<KioskContext> {
  // 1. Find this user's member row to resolve the family.
  const { data: me, error: meErr } = await supabase
    .from('family_members')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (meErr) throw meErr
  if (!me) {
    throw new Error(
      'Signed-in account has no family_members row. Use a parent/admin account that belongs to the family.'
    )
  }

  // 2. Load the family. Explicit column list — member_pins is not readable by
  //    the authenticated role, so `select('*')` would fail here.
  const { data: family, error: famErr } = await supabase
    .from('families')
    .select(FAMILY_COLUMNS)
    .eq('id', me.family_id)
    .single<KioskFamily>()

  if (famErr) throw famErr

  // 3. Load all active members, parents/admins first then children.
  const { data: members, error: memErr } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', me.family_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (memErr) throw memErr

  // 4. Which members have a PIN — booleans only.
  const pinStatus = await fetchPinStatus()

  return {
    family,
    members: members ?? [],
    currentUserMemberId: me.id,
    pinStatus,
  }
}

/** Fresh active members for a family (e.g. to reflect balances after approvals). */
export async function getActiveMembers(familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** All members (active + inactive) for the Settings screen. */
export async function getAllMembers(familyId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export interface MemberInput {
  display_name: string
  role: string[]
  avatar_url?: string | null
  user_id?: string | null
}

/**
 * Add a family member. For a child in the kiosk model, user_id can be null
 * (children don't log in). To let a member sign in on their own device, first
 * create the Supabase Auth user, then pass its user_id.
 */
export async function addMember(familyId: string, input: MemberInput): Promise<FamilyMember> {
  const { data, error } = await supabase
    .from('family_members')
    .insert({
      family_id: familyId,
      display_name: input.display_name,
      role: input.role,
      avatar_url: input.avatar_url ?? null,
      user_id: input.user_id ?? null,
      is_active: true,
      balance: 0,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMember(
  memberId: string,
  input: Partial<Pick<FamilyMember, 'display_name' | 'role' | 'avatar_url'>>
): Promise<void> {
  const { error } = await supabase.from('family_members').update(input).eq('id', memberId)
  if (error) throw error
}

export async function setMemberActive(memberId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('family_members')
    .update({ is_active: isActive })
    .eq('id', memberId)
  if (error) throw error
}

export function isParent(member: FamilyMember): boolean {
  return member.role.includes('parent') || member.role.includes('admin')
}

export function isChild(member: FamilyMember): boolean {
  return member.role.includes('child')
}
