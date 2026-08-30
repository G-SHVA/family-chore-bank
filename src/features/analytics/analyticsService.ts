import { supabase } from '@/lib/supabase'
import type { FamilyMember } from '@/lib/supabase'
import {
  computeStreak,
  computeLongestStreak,
  type AssignmentWithChore,
} from '@/features/chores/choreService'

/* ------------------------------------------------------------------ *
 * Date ranges. Weeks are Monday–Sunday, matching choreService.
 * ------------------------------------------------------------------ */

export type RangeKey = 'week' | 'month' | 'last30' | 'last90' | 'all'

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'last90', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
]

export interface DateRange {
  key: RangeKey
  /** null for All Time — no lower bound. */
  start: Date | null
  end: Date
  /** Start of the equally-long window immediately before `start`, for growth. */
  priorStart: Date | null
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function startOfWeek(d: Date) {
  const x = startOfDay(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Monday = 0
  return x
}
function daysAgo(d: Date, n: number) {
  const x = startOfDay(d)
  x.setDate(x.getDate() - n)
  return x
}

export function resolveRange(key: RangeKey, now: Date = new Date()): DateRange {
  const end = endOfDay(now)
  const start =
    key === 'week'
      ? startOfWeek(now)
      : key === 'month'
        ? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
        : key === 'last30'
          ? daysAgo(now, 29)
          : key === 'last90'
            ? daysAgo(now, 89)
            : null

  // The prior window is the same length ending where this one begins, so
  // "this month vs last month" compares like with like.
  let priorStart: Date | null = null
  if (start) {
    const span = end.getTime() - start.getTime()
    priorStart = new Date(start.getTime() - span)
  }
  return { key, start, end, priorStart }
}

/* ------------------------------------------------------------------ *
 * Paged fetch
 * ------------------------------------------------------------------ */

const PAGE = 1000

/**
 * Reads every row a filtered query matches, one page at a time.
 *
 * This is not an optimisation — it is the correctness requirement called out in
 * CLAUDE.md. PostgREST caps a single response, so a bare `.select()` over
 * chore_assignments silently returns a prefix once the table is large enough,
 * and every total computed from it is quietly wrong. Analytics is *entirely*
 * totals, so it pages until a short page proves the end was reached rather
 * than trusting one response to be complete.
 */
async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

interface AssignmentRow {
  id: string
  assigned_to: string
  status: string
  due_date: string | null
  completed_at: string | null
  approved_at: string | null
  template_id: string | null
  chore: { title: string | null; value: number; category: string | null } | null
}

interface ExpenseRow {
  id: string
  family_member_id: string
  amount: number
  applied_at: string | null
  expense: { title: string | null; category: string | null } | null
}

const ASSIGNMENT_COLUMNS =
  'id, assigned_to, status, due_date, completed_at, approved_at, template_id, chore:chores(title, value, category)'

/**
 * Statuses that represent a *resolved* chore — one whose outcome is known.
 * Named explicitly (never implied by a row limit, per CLAUDE.md) and shared by
 * the completion queries so the rate's numerator and denominator can't drift.
 *
 * 'pending' / 'in_progress' / 'completed' are deliberately absent: they are
 * still live, and counting them as misses would punish a parent for having an
 * approval queue.
 */
const RESOLVED_STATUSES = ['approved', 'expired', 'rejected']

/**
 * Every resolved instance whose DUE DATE falls in the range — the completion
 * universe. Anchored on due_date rather than approved_at because this answers
 * "of the chores that came due this period, how many got done".
 *
 * Restricted to roster-generated rows (`template_id` not null). A Direct Award
 * is a parent crediting a child, not a chore the child was assigned and could
 * have missed, so counting one as a completion is a category error: it inflates
 * the numerator and puts a meaningless 100%-complete 'direct-award' bar at the
 * top of the by-category chart.
 *
 * The tradeoff: removeRosterEntry() nulls template_id on the instances a deleted
 * roster entry already produced, so that history drops out of completion stats
 * too. Live data has exactly one such row against 2,887 expired, and the
 * alternative — scoring 25 parent awards as chores the children completed — is
 * the worse error by a wide margin.
 */
async function fetchResolvedByDueDate(
  childIds: string[],
  range: DateRange
): Promise<AssignmentRow[]> {
  if (childIds.length === 0) return []
  return fetchAllPaged<AssignmentRow>((from, to) => {
    let q = supabase
      .from('chore_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .in('assigned_to', childIds)
      .eq('is_template', false)
      .in('status', RESOLVED_STATUSES)
      .not('template_id', 'is', null)
      .not('due_date', 'is', null)
      .lte('due_date', range.end.toISOString())
    if (range.start) q = q.gte('due_date', range.start.toISOString())
    return q.order('due_date', { ascending: false }).range(from, to) as unknown as PromiseLike<{
      data: AssignmentRow[] | null
      error: unknown
    }>
  })
}

/**
 * Approved instances by APPROVED_AT — the money. Fetched from `priorStart` so
 * the previous period is available for the growth-rate card without a second
 * round trip.
 */
async function fetchApprovedByApprovedAt(
  childIds: string[],
  range: DateRange
): Promise<AssignmentRow[]> {
  if (childIds.length === 0) return []
  const lower = range.priorStart ?? range.start
  return fetchAllPaged<AssignmentRow>((from, to) => {
    let q = supabase
      .from('chore_assignments')
      .select(ASSIGNMENT_COLUMNS)
      .in('assigned_to', childIds)
      .eq('is_template', false)
      .eq('status', 'approved')
      .not('approved_at', 'is', null)
      .lte('approved_at', range.end.toISOString())
    if (lower) q = q.gte('approved_at', lower.toISOString())
    return q.order('approved_at', { ascending: false }).range(from, to) as unknown as PromiseLike<{
      data: AssignmentRow[] | null
      error: unknown
    }>
  })
}

async function fetchExpenses(childIds: string[], range: DateRange): Promise<ExpenseRow[]> {
  if (childIds.length === 0) return []
  const lower = range.priorStart ?? range.start
  return fetchAllPaged<ExpenseRow>((from, to) => {
    let q = supabase
      .from('expense_applications')
      .select('id, family_member_id, amount, applied_at, expense:expenses(title, category)')
      .in('family_member_id', childIds)
      .not('applied_at', 'is', null)
      .lte('applied_at', range.end.toISOString())
    if (lower) q = q.gte('applied_at', lower.toISOString())
    return q.order('applied_at', { ascending: false }).range(from, to) as unknown as PromiseLike<{
      data: ExpenseRow[] | null
      error: unknown
    }>
  })
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function inRange(iso: string | null, start: Date | null, end: Date): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (t > end.getTime()) return false
  return start === null || t >= start.getTime()
}

/** Empty-string and null categories both mean "the parent never set one". */
function categoryLabel(raw: string | null | undefined): string {
  const c = (raw ?? '').trim()
  return c === '' ? 'Uncategorized' : c
}

/**
 * A direct award, as opposed to a chore the child actually did.
 *
 * Generated instances always carry the template_id they were built from
 * (see buildInstance); a Direct Award inserts a standalone row and leaves it
 * null. Verified against live data: of 123 approved rows, the 25 with a null
 * template_id are exactly the 25 approved within 5 seconds of being marked
 * complete — the signature of the insert-then-approve award path — so the two
 * independent signals agree completely.
 *
 * Caveat worth knowing: removeRosterEntry() nulls template_id on the instances
 * a deleted roster entry already produced, which would reclassify that history
 * as awarded. Pausing an entry (the documented way to take a chore off a child)
 * does not, so this stays accurate under normal use.
 */
function isDirectAward(r: AssignmentRow): boolean {
  return r.template_id === null
}

function topN(
  rows: AssignmentRow[],
  n: number
): { title: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const title = r.chore?.title ?? 'Untitled chore'
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    .slice(0, n)
}

export interface ChildRef {
  id: string
  name: string
}

export function toChildRefs(children: FamilyMember[]): ChildRef[] {
  return children.map((c) => ({ id: c.id, name: c.display_name ?? 'Child' }))
}

/* ------------------------------------------------------------------ *
 * Section 1 — Completion Performance
 * ------------------------------------------------------------------ */

export interface CompletionByChild {
  childId: string
  name: string
  approved: number
  missed: number
  /** approved / (approved + expired + rejected), as a whole percentage. */
  rate: number
}

export interface CompletionAnalytics {
  byChild: CompletionByChild[]
  streaks: { childId: string; name: string; current: number; longest: number }[]
  topCompleted: { childId: string; name: string; items: { title: string; count: number }[] }[]
  topMissed: { childId: string; name: string; items: { title: string; count: number }[] }[]
  byCategory: { category: string; rate: number; approved: number; total: number }[]
  isEmpty: boolean
}

export function buildCompletion(
  children: ChildRef[],
  rows: AssignmentRow[],
  now: Date = new Date()
): CompletionAnalytics {
  const byChild = children.map((c) => {
    const mine = rows.filter((r) => r.assigned_to === c.id)
    const approved = mine.filter((r) => r.status === 'approved').length
    const missed = mine.length - approved
    return {
      childId: c.id,
      name: c.name,
      approved,
      missed,
      rate: mine.length > 0 ? Math.round((approved / mine.length) * 100) : 0,
    }
  })

  const streaks = children.map((c) => {
    const mine = rows.filter(
      (r) => r.assigned_to === c.id && r.status === 'approved' && r.approved_at
    )
    // computeStreak/computeLongestStreak are choreService's, used unchanged.
    const asInstances = mine as unknown as AssignmentWithChore[]
    const days = new Set<number>()
    for (const r of mine) {
      if (r.approved_at) days.add(startOfDay(new Date(r.approved_at)).getTime())
    }
    return {
      childId: c.id,
      name: c.name,
      current: computeStreak(asInstances, now),
      longest: computeLongestStreak(days),
    }
  })

  const topCompleted = children.map((c) => ({
    childId: c.id,
    name: c.name,
    items: topN(
      rows.filter((r) => r.assigned_to === c.id && r.status === 'approved'),
      5
    ),
  }))

  const topMissed = children.map((c) => ({
    childId: c.id,
    name: c.name,
    items: topN(
      rows.filter((r) => r.assigned_to === c.id && r.status === 'expired'),
      5
    ),
  }))

  // Categories are generated from whatever actually appears in range, so a new
  // category shows up on its own and a retired one stops taking up an axis slot.
  const catTotals = new Map<string, { approved: number; total: number }>()
  for (const r of rows) {
    const key = categoryLabel(r.chore?.category)
    const acc = catTotals.get(key) ?? { approved: 0, total: 0 }
    acc.total++
    if (r.status === 'approved') acc.approved++
    catTotals.set(key, acc)
  }
  const byCategory = [...catTotals.entries()]
    .map(([category, v]) => ({
      category,
      approved: v.approved,
      total: v.total,
      rate: v.total > 0 ? Math.round((v.approved / v.total) * 100) : 0,
    }))
    .sort((a, b) => b.rate - a.rate || a.category.localeCompare(b.category))

  return {
    byChild,
    streaks,
    topCompleted,
    topMissed,
    byCategory,
    isEmpty: rows.length === 0,
  }
}

/* ------------------------------------------------------------------ *
 * Section 2 — Financial Ledger Summary
 * ------------------------------------------------------------------ */

export interface FinancialAnalytics {
  byChild: {
    childId: string
    name: string
    earned: number
    spent: number
    net: number
    fromChores: number
    fromAwards: number
  }[]
  trend: { label: string; [childName: string]: number | string }[]
  trendChildren: string[]
  expenseByCategory: { category: string; amount: number }[]
  isEmpty: boolean
}

export function buildFinancial(
  children: ChildRef[],
  approved: AssignmentRow[],
  expenses: ExpenseRow[],
  range: DateRange
): FinancialAnalytics {
  const inWindow = approved.filter((r) => inRange(r.approved_at, range.start, range.end))
  const expInWindow = expenses.filter((r) => inRange(r.applied_at, range.start, range.end))

  const byChild = children.map((c) => {
    const mine = inWindow.filter((r) => r.assigned_to === c.id)
    const earned = mine.reduce((s, r) => s + (r.chore?.value ?? 0), 0)
    const fromAwards = mine
      .filter(isDirectAward)
      .reduce((s, r) => s + (r.chore?.value ?? 0), 0)
    const spent = expInWindow
      .filter((r) => r.family_member_id === c.id)
      .reduce((s, r) => s + r.amount, 0)
    return {
      childId: c.id,
      name: c.name,
      earned,
      spent,
      net: earned - spent,
      fromChores: earned - fromAwards,
      fromAwards,
    }
  })

  // Week-over-week earnings, one series per child. Buckets run Monday-based and
  // are seeded from the range so a week with no earnings plots a real zero
  // rather than vanishing and making the line lie about continuity.
  const firstEarned = inWindow.reduce<number | null>((min, r) => {
    const t = new Date(r.approved_at as string).getTime()
    return min === null || t < min ? t : min
  }, null)
  const trendStart = range.start
    ? startOfWeek(range.start)
    : firstEarned !== null
      ? startOfWeek(new Date(firstEarned))
      : startOfWeek(range.end)

  const buckets: { start: number; end: number; label: string }[] = []
  for (
    let cursor = new Date(trendStart);
    cursor.getTime() <= range.end.getTime();
    cursor.setDate(cursor.getDate() + 7)
  ) {
    const s = new Date(cursor)
    const e = new Date(cursor)
    e.setDate(e.getDate() + 7)
    buckets.push({
      start: s.getTime(),
      end: e.getTime(),
      label: `${s.getMonth() + 1}/${s.getDate()}`,
    })
  }

  const trend = buckets.map((b) => {
    const row: { label: string; [k: string]: number | string } = { label: b.label }
    for (const c of children) {
      row[c.name] = inWindow
        .filter((r) => {
          if (r.assigned_to !== c.id) return false
          const t = new Date(r.approved_at as string).getTime()
          return t >= b.start && t < b.end
        })
        .reduce((s, r) => s + (r.chore?.value ?? 0), 0)
    }
    return row
  })

  const catTotals = new Map<string, number>()
  for (const r of expInWindow) {
    const key = categoryLabel(r.expense?.category)
    catTotals.set(key, (catTotals.get(key) ?? 0) + r.amount)
  }
  const expenseByCategory = [...catTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)

  return {
    byChild,
    trend,
    trendChildren: children.map((c) => c.name),
    expenseByCategory,
    isEmpty: inWindow.length === 0 && expInWindow.length === 0,
  }
}

/* ------------------------------------------------------------------ *
 * Section 3 — Family Economy Health
 * ------------------------------------------------------------------ */

export interface EconomyAnalytics {
  comparison: { name: string; completed: number; earned: number; rate: number }[]
  totalEconomy: number
  /** Mean hours between a child marking complete and a parent approving. */
  turnaroundHours: number | null
  turnaroundSample: number
  growthPercent: number | null
  priorEarned: number
  currentEarned: number
  topChore: { childName: string; title: string; value: number } | null
  isEmpty: boolean
}

export function buildEconomy(
  children: ChildRef[],
  resolved: AssignmentRow[],
  approved: AssignmentRow[],
  range: DateRange
): EconomyAnalytics {
  const inWindow = approved.filter((r) => inRange(r.approved_at, range.start, range.end))

  const comparison = children.map((c) => {
    const mineResolved = resolved.filter((r) => r.assigned_to === c.id)
    const mineApproved = mineResolved.filter((r) => r.status === 'approved')
    return {
      name: c.name,
      completed: mineApproved.length,
      earned: inWindow
        .filter((r) => r.assigned_to === c.id)
        .reduce((s, r) => s + (r.chore?.value ?? 0), 0),
      rate:
        mineResolved.length > 0
          ? Math.round((mineApproved.length / mineResolved.length) * 100)
          : 0,
    }
  })

  const currentEarned = inWindow.reduce((s, r) => s + (r.chore?.value ?? 0), 0)

  // Turnaround only means anything for chores a child actually marked complete.
  // Direct awards approve themselves within milliseconds and would drag the
  // average toward zero, hiding a genuine parent bottleneck.
  const turnaroundRows = inWindow.filter(
    (r) => !isDirectAward(r) && r.completed_at && r.approved_at
  )
  const turnaroundHours =
    turnaroundRows.length > 0
      ? turnaroundRows.reduce(
          (s, r) =>
            s +
            (new Date(r.approved_at as string).getTime() -
              new Date(r.completed_at as string).getTime()) /
              3_600_000,
          0
        ) / turnaroundRows.length
      : null

  const priorStart = range.priorStart
  const priorEnd = range.start ? new Date(range.start.getTime() - 1) : null
  const priorEarned =
    priorStart && priorEnd
      ? approved
          .filter((r) => inRange(r.approved_at, priorStart, priorEnd))
          .reduce((s, r) => s + (r.chore?.value ?? 0), 0)
      : 0
  const growthPercent =
    range.priorStart && priorEarned > 0
      ? Math.round(((currentEarned - priorEarned) / priorEarned) * 100)
      : null

  let topChore: EconomyAnalytics['topChore'] = null
  for (const r of inWindow) {
    const value = r.chore?.value ?? 0
    if (!topChore || value > topChore.value) {
      topChore = {
        childName: children.find((c) => c.id === r.assigned_to)?.name ?? 'Someone',
        title: r.chore?.title ?? 'Untitled chore',
        value,
      }
    }
  }

  return {
    comparison,
    totalEconomy: currentEarned,
    turnaroundHours,
    turnaroundSample: turnaroundRows.length,
    growthPercent,
    priorEarned,
    currentEarned,
    topChore,
    isEmpty: inWindow.length === 0 && resolved.length === 0,
  }
}

/* ------------------------------------------------------------------ *
 * Fetch entry points — one per dataset, so each section can render as
 * soon as the data it needs arrives.
 * ------------------------------------------------------------------ */

export async function loadResolvedAssignments(children: ChildRef[], range: DateRange) {
  return fetchResolvedByDueDate(children.map((c) => c.id), range)
}

export async function loadApprovedAssignments(children: ChildRef[], range: DateRange) {
  return fetchApprovedByApprovedAt(children.map((c) => c.id), range)
}

export async function loadExpenseApplications(children: ChildRef[], range: DateRange) {
  return fetchExpenses(children.map((c) => c.id), range)
}

export type { AssignmentRow, ExpenseRow }
