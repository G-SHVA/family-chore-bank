import { supabase } from '@/lib/supabase'
import { weeklyValueOf, PLAN_CHOICE_GRACE_DAYS } from '@/features/chores/choreService'

/**
 * Goal Plan — the child's budget planning tool.
 *
 * A plan is a set of roster entries a child chose in order to reach their
 * savings goal faster. It teaches the book's core lesson: "I can plan. I can
 * see how my choices today affect what I have tomorrow."
 *
 * NO goal_plans TABLE, AND THAT IS THE DESIGN. The proposed schema carried
 * weekly_target, target_weeks, status and completed_at. Every one of those is
 * either computable from rows we already read, or a second copy of something
 * `milestones` already stores:
 *
 *   weekly_target  -> SUM of the plan chores' weekly value, computed here
 *   target_weeks   -> ceil(needed / combined weekly rate), computed here
 *   status         -> milestones.status; a plan's life IS its goal's life
 *   completed_at   -> milestones.achieved_at
 *
 * Storing the first two would have been actively wrong, not merely redundant.
 * A parent may pause or delete a plan chore at any time — the feature
 * explicitly permits it — and a stored weekly_target has no way to notice. The
 * child would read a total that no longer matched the chores under it. This is
 * the same doctrine that keeps goal PROGRESS derived (see goalService): where a
 * figure can be recomputed, storing it only creates a second thing to be wrong.
 *
 * So the whole feature is ONE nullable column: chore_assignments.plan_goal_id.
 * "This roster entry exists to serve that goal."
 *
 * ONE ACTIVE PLAN PER CHILD comes free. idx_milestones_one_active_goal already
 * guarantees one active goal per child, and a plan hangs off a goal — so there
 * is no new partial index here and no 23505 to translate, unlike goalService
 * and loanService which each needed both.
 */

/** One chore in a plan, with its per-week contribution already worked out. */
export interface PlanChore {
  /** The chore_assignments template row — what gets paused or unlinked later. */
  assignmentId: string
  choreId: string
  title: string
  /** Per occurrence, which is what the child earns each time they do it. */
  value: number
  frequency: string
  /** value x how often it comes round in a week. */
  weeklyValue: number
}

/**
 * Every chore currently in a child's plan for one goal.
 *
 * ACTIVE ONLY. A paused plan chore is not generating anything, so it must not
 * count toward the weekly total or appear in the child's plan list — the number
 * has to describe the chores actually under it. This is exactly the
 * self-correction that made a stored weekly_target the wrong choice.
 *
 * TRUNCATION SAFETY: bounded by plan_goal_id and is_template, so it reads a
 * handful of roster rows and never competes with the instance history behind
 * all five truncation bugs in CLAUDE.md. The limit is a payload guard, not the
 * correctness mechanism.
 */
export async function getPlanChores(memberId: string, goalId: string): Promise<PlanChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('id, chore_id, chore:chores(title, value, frequency)')
    .eq('assigned_to', memberId)
    .eq('plan_goal_id', goalId)
    .eq('is_template', true)
    .eq('is_active', true)
    // Stated explicitly per the rule in CLAUDE.md, even though a plan row is
    // never created as 'requested': every read of this table names its statuses
    // rather than trusting another column to imply them.
    .neq('status', 'requested')
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) throw error

  return (data ?? []).map((r) => {
    const chore = (r as { chore: { title: string | null; value: number; frequency: string } | null })
      .chore
    return {
      assignmentId: r.id as string,
      choreId: r.chore_id as string,
      title: chore?.title ?? 'Untitled chore',
      value: chore?.value ?? 0,
      frequency: chore?.frequency ?? 'once',
      weeklyValue: weeklyValueOf(chore ?? {}),
    }
  })
}

/** What lockInPlan actually did, so the UI can report honestly on partial work. */
export interface LockInResult {
  /** Paused templates brought back to life and linked — the common case. */
  reused: number
  /** Chores the child had never had before, so a template was created. */
  created: number
  /** Already on the active roster; deliberately left alone. See below. */
  skipped: number
}

/**
 * "Lock In My Plan" — turn the child's selection into roster entries.
 *
 * THREE CASES, decided by ONE bounded lookup rather than a query per chore:
 *
 *   paused template exists -> REUSE it (activate + link). Zero new rows, and
 *     this is the dominant path: after the 2026-09-04 roster reduction POCO had
 *     67 paused templates against 6 active, and the claim library the builder
 *     reads is mostly those. Inserting instead would leave TWO templates for one
 *     (chore, child) — different template_ids, so idx_ca_daily_dedup cannot
 *     collide them, and the child would silently get the chore twice a day if a
 *     parent ever un-paused the original.
 *
 *   active template exists -> SKIP. Only reachable as a race (a parent
 *     un-pausing between the builder opening and this call), because door 2 of
 *     getClaimableChores excludes active roster chores. Claiming it would let a
 *     later "I'm done" pause a chore the parent deliberately made mandatory —
 *     and it is already generating income toward the same goal, which is the
 *     very reason roster chores are kept out of the builder.
 *
 *   nothing exists -> INSERT a fresh template.
 *
 * NOT TRANSACTIONAL, deliberately. Two statements, so a failure between them
 * leaves a PARTIAL plan. That is safe here precisely because nothing is stored:
 * the weekly total is summed from the chores that actually exist, so a partial
 * plan renders a correct total for itself rather than a stale figure describing
 * chores that were never created. An RPC would buy atomicity on a path that
 * moves no money, at the cost of another database function.
 *
 * Reuse runs BEFORE insert so the cheaper, more common half lands first.
 */
export async function lockInPlan(
  memberId: string,
  goalId: string,
  choreIds: string[]
): Promise<LockInResult> {
  const unique = [...new Set(choreIds)]
  if (unique.length === 0) return { reused: 0, created: 0, skipped: 0 }

  // ONE lookup for the whole selection. Bounded by is_template and the IN list,
  // so it reads roster rows only — it can never compete with the instance
  // history behind the truncation bugs in CLAUDE.md.
  const { data: existing, error: lookupError } = await supabase
    .from('chore_assignments')
    .select('id, chore_id, is_active')
    .eq('assigned_to', memberId)
    .eq('is_template', true)
    .in('chore_id', unique)
    // Stated explicitly per the rule: an unapproved Path 2 claim request is
    // is_template = true and must never be mistaken for a live roster entry.
    .neq('status', 'requested')
    .limit(500)
  if (lookupError) throw lookupError

  const byChore = new Map<string, { id: string; is_active: boolean }>()
  for (const row of existing ?? []) {
    // First row wins if a chore somehow has two templates; prefer an active one
    // so the skip rule below sees the state that actually matters.
    const prev = byChore.get(row.chore_id as string)
    if (!prev || (row.is_active && !prev.is_active)) {
      byChore.set(row.chore_id as string, { id: row.id as string, is_active: row.is_active })
    }
  }

  const reuseIds: string[] = []
  const freshChoreIds: string[] = []
  let skipped = 0
  for (const choreId of unique) {
    const row = byChore.get(choreId)
    if (!row) freshChoreIds.push(choreId)
    else if (row.is_active) skipped++
    else reuseIds.push(row.id)
  }

  if (reuseIds.length > 0) {
    const { error } = await supabase
      .from('chore_assignments')
      .update({ is_active: true, plan_goal_id: goalId })
      .in('id', reuseIds)
    if (error) throw error
  }

  if (freshChoreIds.length > 0) {
    const { error } = await supabase.from('chore_assignments').insert(
      freshChoreIds.map((choreId) => ({
        chore_id: choreId,
        assigned_to: memberId,
        // Self-initiated: the child built this plan. assigned_by references
        // family_members(id), which a child row satisfies.
        assigned_by: memberId,
        is_template: true,
        is_active: true,
        status: 'pending',
        plan_goal_id: goalId,
        // No due_date — templates have none; the generator dates each instance.
        // No frequency — chore_assignments has no such column, the generator
        // reads it through the join to chores.
        // recurrence_dow / recurrence_week stay null: we only insert when this
        // child has NO template for the chore, so there is no schedule of
        // theirs to copy, and pins are per-child (CLAUDE.md) so another child's
        // must never be borrowed. Unpinned is right for a chore freely chosen.
      }))
    )
    if (error) throw error
  }

  return { reused: reuseIds.length, created: freshChoreIds.length, skipped }
}

/** What a set of selected chores adds to the child's week. Pure. */
export function planWeeklyTotal(chores: { weeklyValue: number }[]): number {
  return chores.reduce((sum, c) => sum + c.weeklyValue, 0)
}

/**
 * Weeks until the goal is reached, at the child's COMBINED earning rate.
 *
 * The plan total alone would be the wrong denominator. A child's existing
 * roster is already earning toward the same goal, so leaving it out would tell
 * a child earning $5/week who adds an $8/week plan that they are on $8 — and
 * the estimate is the whole point of the screen. `existingWeekly` comes from
 * getWeeklySavingsRate(), which excludes Direct Awards: a parent's gift is not
 * the child's work, and counting it would break the effort -> progress link the
 * goal exists to teach.
 *
 * Returns null when no estimate is honest — nothing selected and nothing being
 * earned — rather than Infinity or a shrug of a number.
 */
export function estimateWeeksToGoal(
  amountNeeded: number,
  existingWeekly: number | null,
  planWeekly: number
): number | null {
  if (amountNeeded <= 0) return 0
  const combined = (existingWeekly ?? 0) + planWeekly
  if (combined <= 0) return null
  return Math.ceil(amountNeeded / combined)
}

/**
 * The one sentence under the weekly total in the plan builder.
 *
 * Ages 5 and up: one short sentence, no arithmetic shown, no percentages.
 * Kept here rather than in the component so the builder and the goal modal
 * cannot drift into describing the same plan two different ways.
 */
export function planEstimateCopy(
  amountNeeded: number,
  existingWeekly: number | null,
  planWeekly: number,
  selectedCount: number
): string {
  if (selectedCount === 0) return 'Select chores below to build your plan.'
  const weeks = estimateWeeksToGoal(amountNeeded, existingWeekly, planWeekly)
  if (weeks === null) return 'Pick a few more chores to see how fast you can get there.'
  if (weeks === 0) return "You've already reached your goal!"
  const unit = weeks === 1 ? 'week' : 'weeks'
  // "Exceeds the goal amount" = one week of plan chores covers everything still
  // needed. Worth its own wording: the child has built something genuinely
  // strong and should be told so.
  if (planWeekly >= amountNeeded) {
    return `You could reach your goal in ${weeks} ${unit} — great plan!`
  }
  return `At this rate, you'll reach your goal in about ${weeks} ${unit}.`
}

/**
 * The one line of contextual copy on the plan progress tracker.
 *
 * Cormorant Garamond italic in the UI. Bands come straight from the spec; the
 * 100% case is handled by the caller, which raises the celebration instead.
 */
export function planProgressCopy(balance: number, target: number): string {
  const pct = target > 0 ? (balance / target) * 100 : 0
  if (pct < 25) return "You're getting started. Keep going!"
  if (pct < 50) return "You're making real progress."
  if (pct < 75) return "More than halfway there. Don't stop now."
  return 'Almost there. Just a little more.'
}

/**
 * "Keep my plan chores" — the plan's chores become ordinary permanent roster
 * entries by dropping the link. They stay active and keep every instance they
 * have already generated.
 *
 * Scoped to the goal AND the member. plan_goal_id alone would be enough today,
 * but a goal belongs to one child and stating it costs nothing.
 */
export async function keepPlanChores(memberId: string, goalId: string): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    .update({ plan_goal_id: null })
    .eq('assigned_to', memberId)
    .eq('plan_goal_id', goalId)
    .eq('is_template', true)
  if (error) throw error
}

/**
 * "I'm done with these chores" — and the same call the 7-day fallback and goal
 * abandonment both make.
 *
 * PAUSE, NEVER DELETE. Two reasons, and the second is the load-bearing one:
 *
 *  1. Most plan chores are REUSED templates a parent had already paused. Pausing
 *     returns them to exactly the state the parent left them in.
 *  2. A deleted template takes the child's generated instances with it —
 *     chore_assignments.template_id points at this row, and approved instances
 *     are the financial history behind the balance. CLAUDE.md is explicit that
 *     archiving or pausing is the reversible act and deleting is not.
 *
 * plan_goal_id IS CLEARED, and that is what makes the 7-day sweep unambiguous.
 * Both choices drop the link — Keep leaves the chores active, Done pauses them
 * — so a row that STILL carries a link is, by definition, a plan nobody has
 * answered yet. retireLapsedPlanChores() needs no other signal to tell the two
 * apart, and no second column to track whether the child has chosen.
 *
 * A reused template therefore lands back exactly where the parent left it:
 * paused, unlinked, indistinguishable from any other paused roster entry.
 */
export async function retirePlanChores(memberId: string, goalId: string): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    .update({ is_active: false, plan_goal_id: null })
    .eq('assigned_to', memberId)
    .eq('plan_goal_id', goalId)
    .eq('is_template', true)
  if (error) throw error
}

/**
 * How long an achieved goal waits for the child to choose Keep or Done before
 * the plan chores stand down on their own.
 *
 * Keyed on the goal's achieved_at, NOT on when the plan was built. Keying on
 * plan age would fire the instant a goal built more than a week ago was
 * reached — deactivating the chores before the child ever saw the celebration.
 *
 * Defined in choreService, which owns the sweep that enforces it, and
 * re-exported here so plan callers have one obvious place to read it. Only ONE
 * declaration exists.
 */
export { PLAN_CHOICE_GRACE_DAYS }

/** True once an achieved goal's plan has gone unanswered past the grace window. */
export function planChoiceLapsed(achievedAt: string | null, now: Date = new Date()): boolean {
  if (!achievedAt) return false
  const elapsed = now.getTime() - new Date(achievedAt).getTime()
  return elapsed > PLAN_CHOICE_GRACE_DAYS * 24 * 60 * 60 * 1000
}
