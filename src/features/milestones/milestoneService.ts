import { supabase } from '@/lib/supabase'
import type { Milestone } from '@/lib/supabase'

/**
 * PARENT-SET FAMILY MILESTONES ONLY.
 *
 * The `milestones` table also holds child-initiated savings goals
 * (child_initiated = true) -- see features/goals/goalService. The two are
 * completely different objects that happen to share a table, so every read here
 * excludes goals explicitly. Without that filter a child's personal goal shows
 * up as a family milestone on the parent's Manage tab, and on the OTHER child's
 * Achievements screen.
 *
 * `IS NOT TRUE`, not `= false`: child_initiated is nullable, and in SQL a NULL
 * never equals false. Same predicate approve_chore uses, for the same reason.
 */
const NOT_A_GOAL = 'child_initiated.is.null,child_initiated.is.false'

export interface MilestoneInput {
  title: string
  target_amount: number
  icon?: string | null
  badge_icon?: string | null
}

/** Create a family milestone (a savings goal all children progress toward). */
export async function createMilestone(familyId: string, input: MilestoneInput): Promise<Milestone> {
  const { data, error } = await supabase
    .from('milestones')
    .insert({
      family_id: familyId,
      title: input.title,
      target_amount: input.target_amount,
      icon: input.icon ?? null,
      badge_icon: input.badge_icon ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getMilestones(familyId: string): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('family_id', familyId)
    .or(NOT_A_GOAL)
    .order('target_amount')
  if (error) throw error
  return data ?? []
}

export interface MilestoneWithProgress extends Milestone {
  currentAmount: number
  completedAt: string | null
  progressPct: number
}

/**
 * Family milestones with this child's progress. Milestones with no progress row
 * yet default to 0. Progress amount is maintained by approve_chore.
 */
export async function getMilestoneProgress(
  familyId: string,
  memberId: string
): Promise<MilestoneWithProgress[]> {
  const [msRes, mpRes] = await Promise.all([
    supabase
      .from('milestones')
      .select('*')
      .eq('family_id', familyId)
      .or(NOT_A_GOAL)
      .order('target_amount'),
    supabase
      .from('milestone_progress')
      .select('milestone_id, current_amount, completed_at')
      .eq('child_id', memberId),
  ])
  if (msRes.error) throw msRes.error
  if (mpRes.error) throw mpRes.error

  const progressByMilestone = new Map(
    (mpRes.data ?? []).map((p) => [p.milestone_id, p])
  )

  return (msRes.data ?? []).map((ms) => {
    const p = progressByMilestone.get(ms.id)
    const current = p?.current_amount ?? 0
    const pct = ms.target_amount > 0 ? Math.min(100, Math.round((current / ms.target_amount) * 100)) : 0
    return {
      ...ms,
      currentAmount: current,
      completedAt: p?.completed_at ?? null,
      progressPct: pct,
    }
  })
}
