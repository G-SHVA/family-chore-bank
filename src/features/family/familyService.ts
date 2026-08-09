import { supabase } from '@/lib/supabase'
import type { Family, FamilyMember } from '@/lib/supabase'

export interface KioskContext {
  family: Family
  members: FamilyMember[]
  /** family_members.id of the signed-in (kiosk owner) user. */
  currentUserMemberId: string
}

/** Map of family_members.id -> 4-digit PIN string. */
export type MemberPins = Record<string, string>

export function getMemberPins(family: Family): MemberPins {
  const raw = family.member_pins
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as MemberPins
  }
  return {}
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

  // 2. Load the family (includes member_pins).
  const { data: family, error: famErr } = await supabase
    .from('families')
    .select('*')
    .eq('id', me.family_id)
    .single()

  if (famErr) throw famErr

  // 3. Load all active members, parents/admins first then children.
  const { data: members, error: memErr } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_id', me.family_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (memErr) throw memErr

  return {
    family,
    members: members ?? [],
    currentUserMemberId: me.id,
  }
}

/** Persist a single member's PIN into families.member_pins (merged). */
export async function setMemberPin(
  familyId: string,
  currentPins: MemberPins,
  memberId: string,
  pin: string
): Promise<MemberPins> {
  const next = { ...currentPins, [memberId]: pin }
  const { error } = await supabase
    .from('families')
    .update({ member_pins: next })
    .eq('id', familyId)
  if (error) throw error
  return next
}

/** Remove a member's PIN (e.g. when a member is deleted). */
export async function clearMemberPin(
  familyId: string,
  currentPins: MemberPins,
  memberId: string
): Promise<MemberPins> {
  const next = { ...currentPins }
  delete next[memberId]
  const { error } = await supabase
    .from('families')
    .update({ member_pins: next })
    .eq('id', familyId)
  if (error) throw error
  return next
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
