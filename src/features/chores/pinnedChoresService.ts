import { supabase } from '@/lib/supabase'

/**
 * A child's pinned favourites in the claim library.
 *
 * Stored in the database rather than the browser so a pin follows the child to
 * any device. One row per (member, chore). The cap lives HERE, not in a
 * constraint: a constraint would surface as a raw Postgres error, and a child
 * should read a sentence.
 *
 * RLS is family-scoped, not child-scoped — the kiosk runs one shared session,
 * so the database cannot tell which child is acting. The member_id filter on
 * every call below is the real boundary, the same arrangement as loans and
 * savings goals.
 *
 * Deleting a library chore removes its pins (ON DELETE CASCADE); archiving one
 * leaves the pin but the claim screen never lists archived chores, so it stays
 * hidden until the chore returns.
 */

export const PIN_CAP = 5

export const PIN_CAP_MESSAGE = `You can pin up to ${PIN_CAP} chores. Unpin one to add another.`

/** Pinned chore ids in the order they were pinned (oldest first). */
export async function getPinnedChoreIds(memberId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('pinned_claim_chores')
    .select('chore_id')
    .eq('family_member_id', memberId)
    .order('pinned_at', { ascending: true })
    .limit(PIN_CAP * 4)
  if (error) throw error
  return (data ?? []).map((r) => r.chore_id)
}

export async function pinChore(memberId: string, choreId: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from('pinned_claim_chores')
    .select('id', { count: 'exact', head: true })
    .eq('family_member_id', memberId)
  if (countError) throw countError
  if ((count ?? 0) >= PIN_CAP) throw new Error(PIN_CAP_MESSAGE)

  const { error } = await supabase
    .from('pinned_claim_chores')
    .insert({ family_member_id: memberId, chore_id: choreId })
  // 23505 = already pinned (double tap, or a second tablet). The end state is
  // exactly what was asked for, so it is not an error.
  if (error && error.code !== '23505') throw error
}

export async function unpinChore(memberId: string, choreId: string): Promise<void> {
  const { error } = await supabase
    .from('pinned_claim_chores')
    .delete()
    .eq('family_member_id', memberId)
    .eq('chore_id', choreId)
  if (error) throw error
}
