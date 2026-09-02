import type { FamilyMember, Milestone } from '@/lib/supabase'
import {
  getFamilyChildSummaries,
  getRoster,
  getPendingApprovals,
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
  type DateRange,
} from '@/features/analytics/analyticsService'
import { getFamilyGoals, withGoalProgress } from '@/features/goals/goalService'

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
 * TIMEZONE. Week boundaries come from the BROWSER's local zone, exactly as
 * every other week in the app does (choreService.startOfWeek, analyticsService
 * .startOfWeek). The spec asked for America/Chicago specifically, and this
 * family IS in Chicago, so the two agree today. They are deliberately NOT
 * hardcoded here: if this screen pinned Chicago while getFamilyChildSummaries
 * stayed local, the same child's "earned this week" could differ between the
 * parent dashboard and the meeting screen for a family in another zone — a
 * worse failure than the latent one CLAUDE.md already tracks under
 * families.timezone. Reconcile all of them together, or none.
 */

/** Monday 00:00 through Sunday 23:59:59 of the week containing `now`. */
export function resolveMeetingWeek(now: Date = new Date()): DateRange {
  // resolveRange('week') gives Monday -> end of TODAY. The meeting screen names
  // the whole week in its header, so the end is pushed out to Sunday. Nothing
  // can be approved in the future, so this changes the header, not the figures.
  const base = resolveRange('week', now)
  const end = new Date(base.start as Date)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { ...base, end }
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
  pendingApprovals: number
  health: WeekHealth
}

export async function getFamilyWeek(
  familyId: string,
  children: FamilyMember[],
  now: Date = new Date()
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
    pendingApprovals: pending.length,
    health: {
      turnaroundHours: economy.turnaroundHours,
      turnaroundSample: economy.turnaroundSample,
      completionRates: completion.byChild.map((c) => ({ name: c.name, rate: c.rate })),
      idleChores: idleRosterEntries(roster, approvedThisWeek, children),
    },
  }
}

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
