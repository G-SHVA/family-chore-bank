import type { FamilyMember, Milestone } from '@/lib/supabase'
import {
  getFamilyChildSummaries,
  getRoster,
  getPendingApprovals,
  CHARACTER_MOMENT_CATEGORY,
  RECOGNITION_TYPES,
  RESERVED_CHORE_CATEGORIES,
  type RecognitionCategory,
  type RosterEntry,
} from '@/features/chores/choreService'
import {
  resolveRange,
  toChildRefs,
  loadApprovedAssignments,
  loadResolvedAssignments,
  loadExpenseApplications,
  buildCompletion,
  buildEconomy,
  type AssignmentRow,
  type DateRange,
} from '@/features/analytics/analyticsService'
import { getFamilyGoals, withGoalProgress } from '@/features/goals/goalService'
import { endOfWeek } from '@/lib/time'

/**
 * The Friday-night family meeting screen.
 *
 * This file composes existing service functions and adds NO new queries of its
 * own. Every figure here already had a safe, bounded reader:
 *
 *   getFamilyChildSummaries — weekly earnings, streak, pending count. Its week
 *     is already Monday-based and its three reads are each purpose-built
 *     (date-bounded, DESC-ordered, or a server-side count).
 *   loadApproved/Resolved/ExpenseApplications — analyticsService's paged
 *     readers, which page until a short page proves the end rather than
 *     trusting one response.
 *   getFamilyGoals / getRoster / getPendingApprovals — existing doors.
 *
 * Writing fresh queries for a read-only summary screen would have meant five
 * more chances to reintroduce the truncation bug CLAUDE.md documents. Reuse is
 * the safety property, not just tidiness.
 *
 * TIMEZONE — RECONCILED 2026-09-03. Week boundaries come from the FAMILY's
 * timezone via lib/time, exactly as every other week in the app now does
 * (choreService.startOfWeek, analyticsService.startOfWeek). The earlier note
 * here argued that this screen must not pin a zone of its own while the rest of
 * the app stayed on the browser's, because the same child's "earned this week"
 * would then differ between the parent dashboard and the meeting screen. That
 * still holds — which is why all of them moved together rather than this one
 * alone. Reconcile all of them, or none.
 */

/** Monday 00:00 through Sunday 23:59:59 of the week containing `now`. */
export function resolveMeetingWeek(now: Date = new Date()): DateRange {
  // resolveRange('week') gives Monday -> end of TODAY. The meeting screen names
  // the whole week in its header, so the end is pushed out to Sunday. Nothing
  // can be approved in the future, so this changes the header, not the figures.
  const base = resolveRange('week', now)
  return { ...base, end: endOfWeek(base.start as Date) }
}

export interface ChildWeek {
  memberId: string
  name: string
  earned: number
  choresCompleted: number
  currentStreak: number
  /** Active savings goal, or null. Progress is balance-derived, never stored. */
  goal: { title: string; progressPct: number } | null
  /** Their single highest-value chore approved this week. */
  topChore: { title: string; value: number } | null
}

/**
 * One recognition given this week — the Chapter 8 awards, surfaced for the
 * Friday meeting.
 *
 * DERIVED, not queried. Every field comes off `approvedThisWeek`, which this
 * screen already has in hand, so the section costs ZERO additional reads —
 * the same property that makes the child-facing banner free.
 */
export interface WeekRecognition {
  id: string
  childName: string
  type: RecognitionCategory
  /** What the parent typed (a named award's own title, for the other two). */
  description: string
  note: string | null
  amount: number
  approvedAt: string
  /** Resolved against the member list; null when the awarder is unknown. */
  awardedBy: string | null
}

export interface WeekHealth {
  /** Mean hours from a child marking complete to a parent approving. */
  turnaroundHours: number | null
  turnaroundSample: number
  completionRates: { name: string; rate: number }[]
  /** Active roster entries with no approved instance this week. */
  idleChores: { title: string; childName: string }[]
}

export interface FamilyWeekData {
  weekStart: Date
  weekEnd: Date
  children: ChildWeek[]
  totalEarned: number
  totalSpent: number
  /**
   * What the family holds RIGHT NOW — the sum of every child's current
   * balance. Not a weekly figure like the two above it, which is exactly why
   * it earns its place: earned and spent are history, this is state.
   *
   * DERIVED, NEVER READ. It sums the `children` rows this function is already
   * handed, so it costs ZERO additional queries. It moved here when the parent
   * dashboard's stat row was deleted in Session A and the figure had no home
   * left; a reporting screen is the right place for it, and a read of its own
   * would have been the wrong way to get it.
   */
  familyBalance: number
  pendingApprovals: number
  /** Empty when none were given — the section hides, like Loan History. */
  recognitions: WeekRecognition[]
  health: WeekHealth
}

export async function getFamilyWeek(
  familyId: string,
  children: FamilyMember[],
  now: Date = new Date(),
  /**
   * Every active member, so a recognition can name the parent who gave it.
   * Defaults to `children`, which simply leaves awardedBy null — the section
   * still renders rather than throwing on an older call site.
   */
  allMembers: FamilyMember[] = children
): Promise<FamilyWeekData> {
  const range = resolveMeetingWeek(now)
  const refs = toChildRefs(children)

  const [summaries, approved, resolved, expenses, goals, roster, pending] = await Promise.all([
    getFamilyChildSummaries(children),
    loadApprovedAssignments(refs, range),
    loadResolvedAssignments(refs, range),
    loadExpenseApplications(refs, range),
    getFamilyGoals(familyId),
    getRoster(),
    getPendingApprovals(),
  ])

  const completion = buildCompletion(refs, resolved, now)
  const economy = buildEconomy(refs, resolved, approved, range)

  // loadApprovedAssignments deliberately reaches back to priorStart so the
  // analytics growth card can compare periods. This screen only ever means THIS
  // week, so the window is applied here rather than inherited.
  const approvedThisWeek = approved.filter((r) => {
    if (!r.approved_at) return false
    const t = new Date(r.approved_at).getTime()
    return t >= (range.start as Date).getTime() && t <= range.end.getTime()
  })

  const goalByChild = new Map<string, Milestone>(
    goals
      .filter((g) => g.status === 'active' && g.created_by_member)
      .map((g) => [g.created_by_member as string, g])
  )

  const childWeeks: ChildWeek[] = children.map((child) => {
    const summary = summaries.find((s) => s.member.id === child.id)
    const mine = approvedThisWeek.filter((r) => r.assigned_to === child.id)

    let topChore: ChildWeek['topChore'] = null
    for (const r of mine) {
      // "Biggest win" must be a chore the child DID. A Direct Award or a
      // recognition is a parent crediting them, and both routinely outvalue a
      // $0.25 roster chore — an Earner of the Week award would otherwise become
      // the headline achievement of the week it celebrates. Same reasoning as
      // rosterInstancesOnly() on the streak path; this was the one money
      // reading on the screen that still counted them.
      if (RESERVED_CHORE_CATEGORIES.includes((r.chore?.category ?? '') as never)) continue
      const value = r.chore?.value ?? 0
      if (!topChore || value > topChore.value) {
        topChore = { title: r.chore?.title ?? 'Untitled chore', value }
      }
    }

    const goal = goalByChild.get(child.id)
    return {
      memberId: child.id,
      name: child.display_name ?? 'Child',
      // From getFamilyChildSummaries, whose week is already Monday-based —
      // rather than re-summing here and risking a second, divergent answer to
      // "what did they earn this week".
      earned: summary?.weeklyEarnings ?? 0,
      choresCompleted: mine.length,
      currentStreak: summary?.currentStreak ?? 0,
      goal: goal
        ? {
            title: goal.title,
            progressPct: withGoalProgress(goal, child.balance ?? 0).progressPct,
          }
        : null,
      topChore,
    }
  })

  const totalSpent = expenses
    .filter((r) => {
      if (!r.applied_at) return false
      const t = new Date(r.applied_at).getTime()
      return t >= (range.start as Date).getTime() && t <= range.end.getTime()
    })
    .reduce((sum, r) => sum + r.amount, 0)

  return {
    weekStart: range.start as Date,
    weekEnd: range.end,
    children: childWeeks,
    totalEarned: childWeeks.reduce((sum, c) => sum + c.earned, 0),
    totalSpent,
    // Summed off the `children` rows this function was handed. No query.
    familyBalance: children.reduce((sum, c) => sum + (c.balance ?? 0), 0),
    pendingApprovals: pending.length,
    recognitions: deriveWeekRecognitions(approvedThisWeek, children, allMembers),
    health: {
      turnaroundHours: economy.turnaroundHours,
      turnaroundSample: economy.turnaroundSample,
      completionRates: completion.byChild.map((c) => ({ name: c.name, rate: c.rate })),
      idleChores: idleRosterEntries(roster, approvedThisWeek, children),
    },
  }
}

/**
 * Pull this week's recognitions out of rows the screen already fetched.
 *
 * Newest first, and every child in the family — the Friday meeting is where
 * they are read out, so ordering by when they were given is the order they
 * happened in.
 */
function deriveWeekRecognitions(
  approvedThisWeek: AssignmentRow[],
  children: FamilyMember[],
  allMembers: FamilyMember[]
): WeekRecognition[] {
  const childName = new Map(children.map((c) => [c.id, c.display_name ?? 'Child']))
  const memberName = new Map(allMembers.map((m) => [m.id, m.display_name]))
  return approvedThisWeek
    .filter((r) => RECOGNITION_CATEGORIES.includes(r.chore?.category ?? ''))
    .map((r) => ({
      id: r.id,
      childName: childName.get(r.assigned_to) ?? 'Child',
      type: (r.chore?.category ?? CHARACTER_MOMENT_CATEGORY) as RecognitionCategory,
      description: r.chore?.title ?? 'Something great',
      note: r.notes,
      amount: r.chore?.value ?? 0,
      approvedAt: r.approved_at as string,
      awardedBy: (r.assigned_by ? memberName.get(r.assigned_by) : null) ?? null,
    }))
    .sort((a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime())
}

/** The three markers, as strings, for a membership test over a nullable column. */
const RECOGNITION_CATEGORIES: readonly string[] = RECOGNITION_TYPES.map((t) => t.category)

/**
 * Active roster entries that produced no approved chore this week — the
 * "candidates to pause or adjust" a parent might raise at the meeting.
 *
 * Matched on (chore_id, assigned_to) rather than template_id, because an
 * instance's template_id is nulled when a roster entry is removed, and a paused
 * entry is excluded up front: a chore deliberately taken off a child is not a
 * chore they failed to do.
 */
function idleRosterEntries(
  roster: RosterEntry[],
  approvedThisWeek: { assigned_to: string; chore: { title: string | null } | null }[],
  children: FamilyMember[]
): { title: string; childName: string }[] {
  const childIds = new Set(children.map((c) => c.id))
  const done = new Set(
    approvedThisWeek.map((r) => `${r.assigned_to}::${r.chore?.title ?? ''}`)
  )
  const out: { title: string; childName: string }[] = []
  const seen = new Set<string>()

  for (const entry of roster) {
    if (entry.is_active === false) continue
    if (!childIds.has(entry.assigned_to)) continue
    const title = entry.chore?.title ?? 'Untitled chore'
    const key = `${entry.assigned_to}::${title}`
    if (done.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ title, childName: entry.member?.display_name ?? 'Child' })
  }
  return out.sort((a, b) => a.childName.localeCompare(b.childName) || a.title.localeCompare(b.title))
}
