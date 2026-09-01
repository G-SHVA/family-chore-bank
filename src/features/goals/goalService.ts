import { supabase } from '@/lib/supabase'
import type { Milestone } from '@/lib/supabase'

/**
 * Child-initiated savings goals.
 *
 * A goal is a row in `milestones` with child_initiated = true. It shares that
 * table with parent-set family milestones but behaves nothing like one:
 *
 *  - It belongs to ONE child (created_by_member), not the whole family.
 *  - Its progress is the child's CURRENT BALANCE against the target, computed
 *    at read time. It is never stored, and it never touches milestone_progress
 *    — approve_chore explicitly skips child_initiated rows. A stored,
 *    earnings-accumulated figure would ignore spending, which is precisely the
 *    trade-off ("should I save or spend?") the goal exists to make visible.
 *  - It has a lifecycle: active -> achieved, or active -> abandoned.
 *
 * Because both kinds live in one table, EVERY read must say which it wants.
 * milestoneService owns the parent-milestone door and excludes goals; this file
 * is the goal door and requires them. Neither may be widened to return both.
 */

export type GoalStatus = 'active' | 'achieved' | 'abandoned'

export interface SavingsGoal extends Milestone {
  /** min(balance, target) — the money actually counted toward the goal. */
  savedAmount: number
  /** 0-100, capped. A balance above target does not read as 140%. */
  progressPct: number
  /** Shortfall, floored at 0. */
  remaining: number
  /** Balance has reached the target; the goal can be completed. */
  isReached: boolean
}

/** Shape a raw row plus a balance into the derived figures the UI renders. */
export function withGoalProgress(goal: Milestone, balance: number): SavingsGoal {
  const target = goal.target_amount
  return {
    ...goal,
    savedAmount: Math.max(0, Math.min(balance, target)),
    progressPct: target > 0 ? Math.min(100, Math.round((balance / target) * 100)) : 0,
    remaining: Math.max(0, target - balance),
    isReached: target > 0 && balance >= target,
  }
}

/**
 * Supabase rejects with a PostgrestError — a plain object, NOT an Error — so a
 * caller's `e instanceof Error` check is false and the real reason is replaced
 * by a generic fallback. Goals move no money, but a silent failure leaves a
 * child tapping Save on a modal that never closes, which is its own kind of bad.
 */
function goalError(error: unknown, context: string): Error {
  if (error instanceof Error) return new Error(`${context}: ${error.message}`)
  const e = (error ?? {}) as { message?: string; details?: string; hint?: string; code?: string }
  // 23505 is the unique violation from idx_milestones_one_active_goal. It is a
  // real, reachable state (two tablets, two taps), so it gets a human sentence
  // rather than a Postgres constraint name.
  if (e.code === '23505') {
    return new Error(
      'You already have an active goal. Finish or abandon it before setting a new one.'
    )
  }
  const detail = [e.message, e.details, e.hint].filter(Boolean).join(' — ')
  const code = e.code ? ` [${e.code}]` : ''
  return new Error(`${context}: ${detail || 'unknown database error'}${code}`)
}

/**
 * The child's one active goal, or null.
 *
 * maybeSingle(), not single(): "no goal yet" is the normal state for a child who
 * has not set one and must never surface as an error. At most one row can come
 * back — idx_milestones_one_active_goal enforces that in the database, where it
 * survives two tablets racing.
 */
export async function getActiveGoal(memberId: string): Promise<Milestone | null> {
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('created_by_member', memberId)
    .eq('child_initiated', true)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw goalError(error, 'Could not load your savings goal')
  return data
}

/** Every goal this child has ever set, newest first. Powers Achievements. */
export async function getGoalHistory(memberId: string): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('created_by_member', memberId)
    .eq('child_initiated', true)
    .order('created_at', { ascending: false })
  if (error) throw goalError(error, 'Could not load your goals')
  return data ?? []
}

/** Every child's goals for the family, newest first. Powers the Manage tab. */
export async function getFamilyGoals(familyId: string): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('family_id', familyId)
    .eq('child_initiated', true)
    .order('created_at', { ascending: false })
  if (error) throw goalError(error, 'Could not load savings goals')
  return data ?? []
}

export async function createGoal(
  familyId: string,
  memberId: string,
  title: string,
  targetAmount: number,
  description?: string | null
): Promise<Milestone> {
  const { data, error } = await supabase
    .from('milestones')
    .insert({
      family_id: familyId,
      created_by_member: memberId,
      child_initiated: true,
      status: 'active',
      title: title.trim(),
      target_amount: targetAmount,
      description: description?.trim() || null,
      badge_icon: 'target',
      // created_by is deliberately omitted: it references auth.users(id), NOT
      // family_members(id). created_by_member is the child. Do not mix them.
    })
    .select()
    .single()
  if (error) throw goalError(error, 'Could not save your goal')
  return data
}

/** Title and target only — the two things a child may change on a live goal. */
export async function updateGoal(
  goalId: string,
  title: string,
  targetAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('milestones')
    .update({ title: title.trim(), target_amount: targetAmount })
    .eq('id', goalId)
    // Guarded: an achieved goal is a permanent record and is never editable,
    // even if a stale screen still shows the edit affordance.
    .eq('status', 'active')
  if (error) throw goalError(error, 'Could not update your goal')
}

/**
 * Mark a goal achieved.
 *
 * Guarded on status = 'active' so a double-tap — or the child dashboard's
 * auto-complete racing a parent marking it from the Manage screen — cannot
 * rewrite an achieved_at that is already set. The first write wins and the
 * recorded date stays true.
 */
export async function markGoalAchieved(goalId: string): Promise<void> {
  const { error } = await supabase
    .from('milestones')
    .update({ status: 'achieved', achieved_at: new Date().toISOString() })
    .eq('id', goalId)
    .eq('status', 'active')
  if (error) throw goalError(error, 'Could not mark the goal achieved')
}

/**
 * Soft delete. The row stays, so the child's financial history is intact and
 * Achievements can show it — unceremoniously — as something they started and
 * stopped. Frees the one-active-goal slot immediately.
 */
export async function abandonGoal(goalId: string): Promise<void> {
  const { error } = await supabase
    .from('milestones')
    .update({ status: 'abandoned' })
    .eq('id', goalId)
    .eq('status', 'active')
  if (error) throw goalError(error, 'Could not abandon the goal')
}

export interface SavingsRate {
  /** Average earned per week over the window; null when there is no history. */
  perWeek: number | null
  /** Whole weeks of history actually used as the divisor (1-4). */
  weeksUsed: number
}

const RATE_WINDOW_WEEKS = 4
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/**
 * What this child earns per week THROUGH THEIR OWN WORK, over the last four
 * weeks. Feeds the "you'll reach this in about X weeks" estimate.
 *
 * Direct Awards are excluded. A parent handing out money is not the child
 * earning it, and an estimate inflated by gifts would break the effort ->
 * progress connection the goal exists to teach. They are filtered exactly the
 * way streaks filter them: a roster instance carries the template_id it was
 * generated from, while an award is inserted standalone and leaves it null.
 *
 * Note this deliberately differs from how money is treated elsewhere — an award
 * IS real earnings for balances, weekly totals and lifetime earned. It is only
 * the RATE that must reflect work.
 *
 * The read is date-bounded and status-filtered per the rules in CLAUDE.md, so
 * it cannot outgrow a page cap as history accumulates.
 */
export async function getWeeklySavingsRate(memberId: string): Promise<SavingsRate> {
  const since = new Date(Date.now() - RATE_WINDOW_WEEKS * MS_PER_WEEK)
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('approved_at, chore:chores(value)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .eq('status', 'approved')
    .not('template_id', 'is', null)
    .gte('approved_at', since.toISOString())
    .order('approved_at', { ascending: false })
  if (error) throw goalError(error, 'Could not read your earning history')

  type Row = { approved_at: string | null; chore: { value: number } | null }
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => r.approved_at)
  if (rows.length === 0) return { perWeek: null, weeksUsed: 0 }

  const total = rows.reduce((sum, r) => sum + (r.chore?.value ?? 0), 0)

  // Divide by the history that actually exists, not a flat 4. A child two weeks
  // in would otherwise read as earning half their real rate, and the estimate
  // would tell them the goal takes twice as long as it really will.
  const oldest = rows.reduce(
    (min, r) => Math.min(min, new Date(r.approved_at as string).getTime()),
    Date.now()
  )
  const elapsedWeeks = (Date.now() - oldest) / MS_PER_WEEK
  const weeksUsed = Math.min(RATE_WINDOW_WEEKS, Math.max(1, elapsedWeeks))

  return { perWeek: total / weeksUsed, weeksUsed: Math.round(weeksUsed) }
}

/**
 * Weeks to reach `remaining` at `perWeek`, or null when it cannot be estimated.
 * Always at least 1, so a nearly-finished goal reads "about 1 week" rather than
 * "about 0 weeks".
 */
export function weeksToGoal(remaining: number, perWeek: number | null): number | null {
  if (!perWeek || perWeek <= 0 || remaining <= 0) return null
  return Math.max(1, Math.ceil(remaining / perWeek))
}
