import { supabase } from '@/lib/supabase'
import type { Chore, ChoreAssignment, FamilyMember } from '@/lib/supabase'
import type { TablesInsert } from '@/types/database.types'

export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly'

/** A chore_assignment row with its joined chore. */
export interface AssignmentWithChore extends ChoreAssignment {
  chore: Chore | null
}

/* ------------------------------------------------------------------ *
 * Date/period helpers (local time). Weeks are Monday–Sunday.
 * ------------------------------------------------------------------ */
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
  const dow = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - dow)
  return x
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d)
  const e = new Date(s)
  e.setDate(s.getDate() + 6)
  return endOfDay(e)
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
}

/** The period window *containing* `ref` for a recurring frequency. */
function periodWindow(freq: Frequency, ref: Date): { start: Date; end: Date } {
  switch (freq) {
    case 'weekly':
      return { start: startOfWeek(ref), end: endOfWeek(ref) }
    case 'monthly':
      return { start: startOfMonth(ref), end: endOfMonth(ref) }
    case 'daily':
    default:
      return { start: startOfDay(ref), end: endOfDay(ref) }
  }
}

/** Day-of-week values as stored in chore_assignments.recurrence_dow. */
export const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export function dayLabel(dow: number | null | undefined): string | null {
  return dow === null || dow === undefined ? null : (DAY_LABELS[dow] ?? null)
}

/**
 * The due date for a weekly chore pinned to a day of week — this week's
 * occurrence of that day. Returns null when the day has already passed: the
 * chore simply doesn't run this week, and next Monday's pass generates it for
 * the coming week. (Rolling forward instead would drop a chore due six days
 * out onto the child's list immediately.)
 */
function weeklyDueDate(dow: number, now: Date): Date | null {
  const weekStart = startOfWeek(now) // Monday
  const target = new Date(weekStart)
  target.setDate(weekStart.getDate() + ((dow + 6) % 7)) // Monday = 0 … Sunday = 6
  const due = endOfDay(target)
  return due < now ? null : due
}

/** When the next instance of a template should fall due, or null to skip. */
function nextDueDate(freq: Frequency, dow: number | null, now: Date): Date | null {
  if (freq === 'once') return endOfDay(now)
  if (freq === 'weekly' && dow !== null) return weeklyDueDate(dow, now)
  return periodWindow(freq, now).end
}

/**
 * Marks lapsed instances expired: anything still untouched or in progress once
 * its due date has passed. Missed chores do NOT carry over — a fresh instance
 * is generated for the next period, and the expired row stays as history.
 * Idempotent; runs as the first step of every generation pass.
 */
export async function expireLapsedAssignments(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .update({ status: 'expired' })
    .eq('is_template', false)
    .in('status', ['pending', 'in_progress'])
    .lt('due_date', now.toISOString())
    .select('id')
  if (error) throw error
  return data?.length ?? 0
}

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

/* ------------------------------------------------------------------ *
 * Recurrence engine
 * ------------------------------------------------------------------ */

/**
 * Reads all roster templates (is_template = true), and for each one creates a
 * fresh instance row (is_template = false, linked via template_id) for the
 * current period if one doesn't already exist. `once` templates generate a
 * single instance and never regenerate. Returns the number of instances that
 * were ACTUALLY created.
 *
 * PARENT DASHBOARD ONLY. Children must never call this — see the note in the
 * child Dashboard loader.
 *
 * Idempotency is layered, and the layers are not interchangeable:
 *   1. `idx_ca_daily_dedup`, a partial unique index on
 *      (template_id, assigned_to, local day) for pending/in_progress rows.
 *      This is the ONLY layer that survives concurrency, and it is why the
 *      insert below is an ignore-duplicates upsert.
 *   2. The date-bounded existence check in runGeneration(), which avoids the
 *      write when there is nothing to do.
 *   3. The in-tab promise lock and burst window below.
 *
 * The lock was once believed sufficient. It is not: it coalesces calls within
 * ONE tab, so two tablets — or one tab across a reload — still ran concurrent
 * passes. Combined with an unbounded existence read that silently truncated at
 * 1000 rows, that produced 5330 instance rows where 1400 belonged.
 */
let generationLock: Promise<number> | null = null

/**
 * Rapid-fire suppression. The in-tab lock only coalesces calls that overlap;
 * five *sequential* passes still ran in 41 seconds when a child marked chores
 * complete one after another (each completion re-ran the page loader). This
 * collapses a burst without blocking a legitimate later pass — a parent who
 * adds a roster entry mid-day still sees it generate within the window.
 */
const GENERATION_MIN_INTERVAL_MS = 30_000
let lastGenerationAt = 0

export function generateDailyAssignments(
  now: Date = new Date(),
  { force = false }: { force?: boolean } = {}
): Promise<number> {
  if (generationLock) return generationLock
  if (!force && Date.now() - lastGenerationAt < GENERATION_MIN_INTERVAL_MS) {
    return Promise.resolve(0)
  }
  generationLock = runGeneration(now)
    .then((created) => {
      lastGenerationAt = Date.now()
      return created
    })
    .finally(() => {
      generationLock = null
    })
  return generationLock
}

/**
 * The widest period start the existence check might need to look back to. A
 * week can begin in the previous month, so take the earlier of the two.
 */
function existenceHorizon(now: Date): Date {
  return new Date(Math.min(startOfWeek(now).getTime(), startOfMonth(now).getTime()))
}

/**
 * Payload guard for the existence read — NOT the correctness mechanism.
 * Correctness comes from the date bound plus idx_ca_daily_dedup. One period
 * holds at most one instance per active template, so this is generous.
 */
const PERIOD_FETCH_LIMIT = 2000

async function runGeneration(now: Date): Promise<number> {
  // Retire anything that lapsed before generating this period's fresh set.
  await expireLapsedAssignments(now)

  const { data: templates, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('is_template', true)
    .eq('is_active', true)
  if (error) throw error
  if (!templates || templates.length === 0) return 0

  const templateIds = templates.map((t) => t.id)

  // BOUNDED ON PURPOSE. This query previously had no .order() and no .limit().
  // PostgREST caps an unbounded read at 1000 rows and, with no ORDER BY,
  // returns the OLDEST rows by physical order — so once this table passed 1000
  // instances the check saw only ancient history, concluded every template was
  // missing its current period, and re-inserted the whole active roster on
  // EVERY call. 1400 legitimate rows became 5330 in three days. Same failure
  // class as the getMemberInstances truncation documented in CLAUDE.md.
  //
  // The date bound means this window can only ever hold one period's worth of
  // rows, and the DESC ordering means the rows we actually need are the ones
  // that survive the cap.
  const { data: instances, error: instErr } = await supabase
    .from('chore_assignments')
    .select('id, template_id, due_date')
    .eq('is_template', false)
    .in('template_id', templateIds)
    .gte('due_date', existenceHorizon(now).toISOString())
    .order('due_date', { ascending: false })
    .limit(PERIOD_FETCH_LIMIT)
  if (instErr) throw instErr

  const existingByTemplate = new Map<string, { due_date: string | null }[]>()
  for (const inst of instances ?? []) {
    if (!inst.template_id) continue
    const list = existingByTemplate.get(inst.template_id) ?? []
    list.push(inst)
    existingByTemplate.set(inst.template_id, list)
  }

  // `once` templates need LIFETIME existence, not this period's. The date bound
  // above would hide an instance generated months ago and regenerate it, so
  // these are looked up separately and unbounded by date.
  const onceIds = templates
    .filter((t) => ((t as AssignmentWithChore).chore?.frequency ?? 'daily') === 'once')
    .map((t) => t.id)
  const onceSeen = new Set<string>()
  if (onceIds.length > 0) {
    const { data: onceRows, error: onceErr } = await supabase
      .from('chore_assignments')
      .select('template_id')
      .eq('is_template', false)
      .in('template_id', onceIds)
      .limit(PERIOD_FETCH_LIMIT)
    if (onceErr) throw onceErr
    for (const r of onceRows ?? []) if (r.template_id) onceSeen.add(r.template_id)
  }

  const toInsert: TablesInsert<'chore_assignments'>[] = []

  for (const t of templates) {
    const chore = (t as AssignmentWithChore).chore
    if (!chore) continue
    const freq = (chore.frequency ?? 'daily') as Frequency
    const existing = existingByTemplate.get(t.id) ?? []

    if (freq === 'once') {
      // Generate exactly one instance, ever — checked against the lifetime set,
      // not `existing`, which only covers the current period window.
      if (onceSeen.has(t.id)) continue
      toInsert.push(buildInstance(t, endOfDay(now)))
      continue
    }

    // Dedupe against the period that *contains the target due date*, so a
    // weekly chore pinned to a weekday that has already passed rolls to next
    // week without also generating a second instance when that week arrives.
    const due = nextDueDate(freq, t.recurrence_dow, now)
    if (!due) continue // pinned weekday already passed — resumes next week
    const win = periodWindow(freq, due)
    const hasThisPeriod = existing.some((i) => {
      if (!i.due_date) return false
      const d = new Date(i.due_date)
      return d >= win.start && d <= win.end
    })
    if (!hasThisPeriod) toInsert.push(buildInstance(t, due))
  }

  if (toInsert.length === 0) return 0

  // ignoreDuplicates => `Prefer: resolution=ignore-duplicates`, which PostgREST
  // emits as an UNTARGETED `ON CONFLICT DO NOTHING`. Untargeted matters: the
  // guard is idx_ca_daily_dedup, a PARTIAL EXPRESSION index that cannot be
  // named as a conflict target, and the untargeted form honours it anyway.
  //
  // This is what makes generation genuinely idempotent rather than
  // idempotent-if-you-squint: two tablets generating in the same instant now
  // collide inside Postgres and produce one row, and the loser's rows are
  // dropped silently instead of erroring. The client-side check above is now
  // only an optimisation to avoid the write, not the thing keeping us honest.
  //
  // With `ignoreDuplicates`, the representation returned contains ONLY rows
  // that were actually inserted — so this count is real, not optimistic.
  const { data: inserted, error: insErr } = await supabase
    .from('chore_assignments')
    .upsert(toInsert, { ignoreDuplicates: true })
    .select('id')
  if (insErr) throw insErr
  return inserted?.length ?? 0
}

function buildInstance(template: ChoreAssignment, due: Date): TablesInsert<'chore_assignments'> {
  return {
    chore_id: template.chore_id,
    assigned_to: template.assigned_to,
    assigned_by: template.assigned_by,
    status: 'pending' as const,
    is_template: false,
    template_id: template.id,
    due_date: due.toISOString(),
  }
}

/* ------------------------------------------------------------------ *
 * Child dashboard / chore reads
 * ------------------------------------------------------------------ */

const ACTIVE_STATUSES = ['pending', 'in_progress', 'completed', 'rejected']

/**
 * All instance rows (never templates) for a member, NEWEST FIRST, with chore.
 *
 * The ordering is load-bearing, not cosmetic. This is a capped fetch, so
 * whichever end of the range it sorts from is the end that survives the cap.
 * It previously sorted ascending (oldest first), which meant that once a
 * child accumulated more than INSTANCE_FETCH_LIMIT rows of history, the cap
 * silently ate the *newest* rows — every pending chore for today — and the
 * child saw an empty chore list while the roster generated normally.
 * Sorting descending keeps current chores in the window at any history size.
 *
 * Callers that need lifetime totals must NOT derive them from this list;
 * use getLifetimeCounts(), which aggregates server-side and is not capped.
 */
const INSTANCE_FETCH_LIMIT = 500

export async function getMemberInstances(memberId: string): Promise<AssignmentWithChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .order('due_date', { ascending: false })
    .limit(INSTANCE_FETCH_LIMIT)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}

/**
 * Every approved instance for a member, with its chore value. Approved rows
 * are the financial history: they are never expired or cleaned up, and they
 * grow far slower than expired/rejected churn, so this stays small enough to
 * fetch whole. Earnings and streaks are derived from this, not from the
 * capped recent-instances window.
 */
async function getApprovedInstances(memberId: string): Promise<AssignmentWithChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(5000)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}

/**
 * Exact lifetime row counts, aggregated by Postgres. `head: true` transfers
 * no rows at all, so these stay correct however large the history grows.
 */
async function getLifetimeCounts(memberId: string): Promise<{ total: number; done: number }> {
  const base = () =>
    supabase
      .from('chore_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_to', memberId)
      .eq('is_template', false)

  const [totalRes, doneRes] = await Promise.all([
    base(),
    base().in('status', ['approved', 'completed']),
  ])
  if (totalRes.error) throw totalRes.error
  if (doneRes.error) throw doneRes.error
  return { total: totalRes.count ?? 0, done: doneRes.count ?? 0 }
}

export interface ChildDashboardData {
  balance: number
  activeChores: AssignmentWithChore[]
  weeklyEarnings: number
  completedThisWeek: number
  pendingApproval: number
  dueToday: number
  completionRate: number
  currentStreak: number
}

export async function getChildDashboard(memberId: string): Promise<ChildDashboardData> {
  const now = new Date()

  const { data: member, error: memErr } = await supabase
    .from('family_members')
    .select('balance')
    .eq('id', memberId)
    .single()
  if (memErr) throw memErr

  const instances = await getMemberInstances(memberId)

  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const inThisWeek = (iso: string | null) => {
    if (!iso) return false
    const d = new Date(iso)
    return d >= weekStart && d <= weekEnd
  }

  const activeChores = instances.filter((i) => i.status && ACTIVE_STATUSES.includes(i.status))

  const pendingApproval = instances.filter((i) => i.status === 'completed').length

  const dueToday = instances.filter(
    (i) =>
      i.due_date &&
      isSameDay(new Date(i.due_date), now) &&
      (i.status === 'pending' || i.status === 'in_progress')
  ).length

  const approvedThisWeek = instances.filter(
    (i) => i.status === 'approved' && inThisWeek(i.approved_at)
  )
  const weeklyEarnings = approvedThisWeek.reduce((sum, i) => sum + (i.chore?.value ?? 0), 0)

  const completedThisWeek = instances.filter(
    (i) => (i.status === 'completed' || i.status === 'approved') && inThisWeek(i.completed_at)
  ).length

  // Completion rate over this week's instances (approved+completed / all due this week).
  const dueThisWeek = instances.filter((i) => inThisWeek(i.due_date))
  const doneThisWeek = dueThisWeek.filter(
    (i) => i.status === 'approved' || i.status === 'completed'
  ).length
  const completionRate =
    dueThisWeek.length > 0 ? Math.round((doneThisWeek / dueThisWeek.length) * 100) : 0

  const currentStreak = computeStreak(instances, now)

  return {
    balance: member.balance ?? 0,
    activeChores,
    weeklyEarnings,
    completedThisWeek,
    pendingApproval,
    dueToday,
    completionRate,
    currentStreak,
  }
}

/** Consecutive days (ending today or yesterday) with ≥1 approved chore. */
/**
 * Drops Direct Awards, keeping only roster-generated instances.
 *
 * A Direct Award is a parent crediting a child, not a chore the child did, so
 * it must never extend a streak — otherwise a parent can hand out a streak.
 * Roster instances always carry the template_id they were built from (see
 * buildInstance); an award is inserted standalone and leaves it null.
 *
 * Every streak reading in the app runs through this, so the parent dashboard,
 * the child's Achievements screen and the Analytics tab cannot drift apart.
 * analyticsService enforces the same rule at the query level, where it can.
 *
 * Money is deliberately NOT filtered this way: an award is real earnings and
 * still counts toward balances, weekly totals and lifetime earned.
 */
function rosterInstancesOnly<T extends { template_id: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.template_id !== null)
}

export function computeStreak(instances: AssignmentWithChore[], now: Date): number {
  const approvedDays = new Set<number>()
  for (const i of instances) {
    if (i.status === 'approved' && i.approved_at) {
      approvedDays.add(startOfDay(new Date(i.approved_at)).getTime())
    }
  }
  if (approvedDays.size === 0) return 0

  let streak = 0
  const cursor = startOfDay(now)
  // Allow the streak to "end" today or yesterday.
  if (!approvedDays.has(cursor.getTime())) {
    cursor.setDate(cursor.getDate() - 1)
    if (!approvedDays.has(cursor.getTime())) return 0
  }
  while (approvedDays.has(cursor.getTime())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/**
 * Child marks a chore instance complete. Sets status = 'completed' (awaiting
 * parent approval). NO balance change happens here — the balance is credited
 * only on parent approval via the approve_chore RPC (Step 5).
 *
 * Returns false when the row was no longer completable (already handed in, or
 * lapsed past its due date while the screen was open) so the caller can refresh.
 */
export async function markChoreComplete(assignmentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .eq('is_template', false)
    .in('status', ['pending', 'in_progress'])
    .gte('due_date', new Date().toISOString())
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/* ------------------------------------------------------------------ *
 * Parent: approvals & assignment
 * ------------------------------------------------------------------ */

export type PendingMember = Pick<FamilyMember, 'id' | 'display_name' | 'avatar_url'>

export interface PendingApproval extends AssignmentWithChore {
  member: PendingMember | null
}

/** All completed instances awaiting approval, oldest first, with chore + child. */
export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select(
      '*, chore:chores(*), member:family_members!chore_assignments_assigned_to_fkey(id,display_name,avatar_url)'
    )
    .eq('is_template', false)
    .eq('status', 'completed')
    .order('completed_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as PendingApproval[]
}

/** Approve a completed chore — atomic balance credit + milestone progress via RPC. */
export async function approveChore(assignmentId: string, parentMemberId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_chore', {
    p_assignment_id: assignmentId,
    p_approved_by: parentMemberId,
  })
  if (error) throw error
}

/** Reject a completed chore. The note is optional (no balance change). */
export async function rejectChore(assignmentId: string, notes?: string): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    // An omitted note is stored as null, not '', so the child's card shows the
    // plain "Not approved" pill with no empty note block under it.
    .update({ status: 'rejected', notes: notes?.trim() || null })
    .eq('id', assignmentId)
    .eq('is_template', false)
  if (error) throw error
}

/**
 * Assign a chore to a child — creates a ROSTER TEMPLATE row (is_template = true).
 * The generator turns it into per-period instances. (Per the data model, the
 * chores library is never copied; assignment lives in chore_assignments.)
 *
 * `recurrenceDow` (0 = Sunday … 6 = Saturday) pins a weekly chore to a day of
 * the week; null keeps the legacy "due by end of week" behaviour.
 */
export async function quickAssignChore(
  choreId: string,
  memberId: string,
  assignedBy: string,
  recurrenceDow: number | null = null
): Promise<void> {
  const { error } = await supabase.from('chore_assignments').insert({
    chore_id: choreId,
    assigned_to: memberId,
    assigned_by: assignedBy,
    status: 'pending',
    is_template: true,
    is_active: true,
    recurrence_dow: recurrenceDow,
  })
  if (error) throw error
}

/** Assign one chore to several children at once (the "Both" option). */
export async function assignChoreToMembers(
  choreId: string,
  memberIds: string[],
  assignedBy: string,
  recurrenceDow: number | null = null
): Promise<void> {
  if (memberIds.length === 0) return
  const { error } = await supabase.from('chore_assignments').insert(
    memberIds.map((memberId) => ({
      chore_id: choreId,
      assigned_to: memberId,
      assigned_by: assignedBy,
      status: 'pending',
      is_template: true,
      is_active: true,
      recurrence_dow: recurrenceDow,
    }))
  )
  if (error) throw error
}

/**
 * Marker category for the throwaway `chores` rows created by a custom-amount
 * Direct Award. It is outside CHORE_CATEGORIES and has no CHECK constraint to
 * collide with, so it can never be a parent-authored chore. Excluded from
 * getFamilyChores, which is the single door every library view goes through.
 */
export const DIRECT_AWARD_CATEGORY = 'direct-award'

/**
 * Supabase rejects with a PostgrestError — a plain object, NOT an Error — so a
 * caller's `e instanceof Error` check is false and the real reason is replaced
 * by a generic fallback. That is tolerable on a read; on the award path it is
 * not, because the message is the only clue the parent (or a developer) gets
 * about why money did not move. A 409 here once turned out to be a foreign-key
 * violation and read only as "That did not go through".
 *
 * Scoped deliberately to Direct Award: the rest of the codebase keeps its
 * existing convention.
 */
function awardError(error: unknown, context: string): Error {
  if (error instanceof Error) return new Error(`${context}: ${error.message}`)
  const e = (error ?? {}) as { message?: string; details?: string; hint?: string; code?: string }
  const detail = [e.message, e.details, e.hint].filter(Boolean).join(' — ')
  const code = e.code ? ` [${e.code}]` : ''
  return new Error(`${context}: ${detail || 'unknown database error'}${code}`)
}

/**
 * Credits one award to a child and returns nothing.
 *
 * The money is NEVER touched here. chore_approval_balance_update is an
 * AFTER UPDATE trigger (`NEW.status = 'approved' AND OLD.status != 'approved'`),
 * so a row inserted already-approved would credit $0. The row is therefore
 * inserted as 'completed' and immediately flipped by the approve_chore RPC —
 * the same call the approval queue makes — which fires the trigger and
 * advances milestone_progress.
 *
 * If the RPC leg fails the row is left as a normal completed chore in the
 * parent's approval queue: visible and recoverable with one tap, not lost money.
 */
async function awardOnce(
  choreId: string,
  memberId: string,
  awardedBy: string,
  notes?: string | null
): Promise<void> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('chore_assignments')
    .insert({
      chore_id: choreId,
      assigned_to: memberId,
      assigned_by: awardedBy,
      status: 'completed',
      completed_at: now,
      // A real due_date matters: under `order('due_date', desc)` Postgres sorts
      // NULLS FIRST, so a null-dated award would squat at the top of the capped
      // instance window and push live chores out of it.
      due_date: now,
      is_template: false,
      is_active: true,
      notes: notes?.trim() || null,
    })
    .select('id')
    .single()
  if (error) throw awardError(error, 'Could not record the award')

  const { error: rpcError } = await supabase.rpc('approve_chore', {
    p_assignment_id: data.id,
    p_approved_by: awardedBy,
  })
  // The row exists but is unapproved — say so, because it is now sitting in the
  // approval queue and one tap finishes it.
  if (rpcError) {
    throw awardError(
      rpcError,
      'The award was recorded but crediting it failed; it is waiting in the approval queue'
    )
  }
}

/**
 * Direct Award, library path: credit an existing chore `quantity` times.
 * Each unit is its own assignment row and its own approve_chore call, so the
 * ledger reads "Received an A" three times rather than one entry worth 3x.
 */
export async function directAwardFromLibrary(
  choreId: string,
  memberId: string,
  awardedBy: string,
  quantity = 1,
  notes?: string | null
): Promise<void> {
  const units = Math.min(10, Math.max(1, Math.floor(quantity)))
  for (let i = 0; i < units; i++) {
    try {
      await awardOnce(choreId, memberId, awardedBy, notes)
    } catch (e) {
      // Partial success is worth reporting precisely — the units already
      // credited are real money and must not be retried blindly.
      if (i === 0) throw e
      throw new Error(
        `Awarded ${i} of ${units}. The rest failed: ${e instanceof Error ? e.message : 'unknown error'}`
      )
    }
  }
}

/**
 * Direct Award, custom path: a one-off amount with a parent-typed description.
 *
 * chore_assignments has no amount or title column — both the balance trigger
 * and the bank ledger read them off the joined `chores` row — so the award
 * needs a chore to point at. It gets an archived, marker-category row that no
 * library view returns and no roster can assign. Custom awards are one-time by
 * definition, so there is no quantity.
 */
export async function directAwardCustom(
  familyId: string,
  memberId: string,
  awardedBy: string,
  title: string,
  amount: number,
  notes?: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from('chores')
    .insert({
      family_id: familyId,
      title: title.trim(),
      value: amount,
      frequency: 'once',
      category: DIRECT_AWARD_CATEGORY,
      is_template: false,
      is_custom: true,
      is_archived: true,
      // created_by is deliberately omitted: it references auth.users(id), not
      // family_members(id), and createChore leaves it null the same way.
    })
    .select('id')
    .single()
  if (error) throw awardError(error, 'Could not create the one-off award')
  await awardOnce(data.id, memberId, awardedBy, notes)
}

export interface ChildSummary {
  member: FamilyMember
  weeklyEarnings: number
  currentStreak: number
  pendingCount: number
}

/**
 * Per-child rollups (weekly earnings, streak, pending count) for the parent view.
 *
 * Three purpose-built reads rather than one broad fetch. The previous version
 * was a single `select('*, chore:chores(*)').limit(1000)` with no ordering and
 * no status filter — the truncation bug CLAUDE.md warns about, and it was live:
 * against 3,300+ instance rows Postgres returned an arbitrary 1,000, so the
 * dashboard showed Cuddles $3.75 for the week when the true figure was $9.15.
 * Wrong money on the parent's main screen, drifting between reloads.
 *
 * Each query below is safe by construction: bounded by date, aggregated
 * server-side, or sorted so the rows it actually needs survive the cap.
 */
export async function getFamilyChildSummaries(children: FamilyMember[]): Promise<ChildSummary[]> {
  if (children.length === 0) return []
  const now = new Date()
  const ids = children.map((c) => c.id)
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)

  const [weekRes, streakRes, pendingCounts] = await Promise.all([
    // Bounded by the week window, so it cannot outgrow a page.
    supabase
      .from('chore_assignments')
      .select('assigned_to, chore:chores(value)')
      .in('assigned_to', ids)
      .eq('is_template', false)
      .eq('status', 'approved')
      .gte('approved_at', weekStart.toISOString())
      .lte('approved_at', weekEnd.toISOString()),
    // A streak only ever walks backwards from today, so DESC ordering keeps the
    // rows it can use inside the cap. Direct Awards are excluded at the query
    // level — see rosterInstancesOnly for why a parent must not hand out a streak.
    supabase
      .from('chore_assignments')
      .select('assigned_to, status, approved_at, template_id')
      .in('assigned_to', ids)
      .eq('is_template', false)
      .eq('status', 'approved')
      .not('template_id', 'is', null)
      .not('approved_at', 'is', null)
      .order('approved_at', { ascending: false })
      .limit(1000),
    // Exact counts from Postgres; head:true transfers no rows at all.
    Promise.all(
      ids.map((id) =>
        supabase
          .from('chore_assignments')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', id)
          .eq('is_template', false)
          .eq('status', 'completed')
      )
    ),
  ])

  if (weekRes.error) throw weekRes.error
  if (streakRes.error) throw streakRes.error
  for (const r of pendingCounts) if (r.error) throw r.error

  type WeekRow = { assigned_to: string; chore: { value: number } | null }
  const weekRows = (weekRes.data ?? []) as unknown as WeekRow[]
  const streakRows = (streakRes.data ?? []) as unknown as AssignmentWithChore[]

  return children.map((member, idx) => ({
    member,
    weeklyEarnings: weekRows
      .filter((r) => r.assigned_to === member.id)
      .reduce((sum, r) => sum + (r.chore?.value ?? 0), 0),
    currentStreak: computeStreak(
      streakRows.filter((r) => r.assigned_to === member.id),
      now
    ),
    pendingCount: pendingCounts[idx].count ?? 0,
  }))
}

export interface AchievementsOverview {
  currentStreak: number
  longestStreak: number
  completionRate: number
  totalEarned: number
  totalCompleted: number
  monthEarned: number
  sevenDay: { label: string; count: number }[]
}

export async function getAchievementsOverview(memberId: string): Promise<AchievementsOverview> {
  const now = new Date()
  // Lifetime figures come from the full approved set and server-side counts —
  // never from getMemberInstances(), which is deliberately capped.
  const [approved, counts] = await Promise.all([
    getApprovedInstances(memberId),
    getLifetimeCounts(memberId),
  ])

  const totalEarned = approved.reduce((s, i) => s + (i.chore?.value ?? 0), 0)
  const totalCompleted = counts.done

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEarned = approved
    .filter((i) => i.approved_at && new Date(i.approved_at) >= monthStart)
    .reduce((s, i) => s + (i.chore?.value ?? 0), 0)

  const completionRate =
    counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0

  // Streaks only: totalEarned / monthEarned above intentionally still include
  // Direct Awards, because an award is real money the child earned.
  const streakRows = rosterInstancesOnly(approved)
  const approvedDays = new Set<number>()
  for (const i of streakRows) {
    if (i.approved_at) approvedDays.add(startOfDay(new Date(i.approved_at)).getTime())
  }
  const currentStreak = computeStreak(streakRows, now)
  const longestStreak = computeLongestStreak(approvedDays)

  // Last 7 days (oldest -> newest) count of approved chores per day.
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const sevenDay: { label: string; count: number }[] = []
  for (let d = 6; d >= 0; d--) {
    const day = startOfDay(now)
    day.setDate(day.getDate() - d)
    const count = approved.filter(
      (i) => i.approved_at && startOfDay(new Date(i.approved_at)).getTime() === day.getTime()
    ).length
    sevenDay.push({ label: dayLabels[day.getDay()], count })
  }

  return {
    currentStreak,
    longestStreak,
    completionRate,
    totalEarned,
    totalCompleted,
    monthEarned,
    sevenDay,
  }
}

export function computeLongestStreak(approvedDays: Set<number>): number {
  if (approvedDays.size === 0) return 0
  const days = [...approvedDays].sort((a, b) => a - b)
  const DAY = 24 * 60 * 60 * 1000
  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] === DAY) run++
    else run = 1
    if (run > longest) longest = run
  }
  return longest
}

export interface FamilyProgress {
  children: ChildSummary[]
  familyTotalBalance: number
  familyWeeklyEarnings: number
}

export async function getFamilyProgress(children: FamilyMember[]): Promise<FamilyProgress> {
  const summaries = await getFamilyChildSummaries(children)
  return {
    children: summaries,
    familyTotalBalance: summaries.reduce((s, c) => s + (c.member.balance ?? 0), 0),
    familyWeeklyEarnings: summaries.reduce((s, c) => s + c.weeklyEarnings, 0),
  }
}

/**
 * Family chore library (only family-scoped chores are assignable under RLS).
 * Archived chores are hidden unless explicitly asked for.
 */
export async function getFamilyChores(
  familyId: string,
  includeArchived = false
): Promise<Chore[]> {
  let query = supabase
    .from('chores')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_template', false)
    // Direct Award's one-off rows are bookkeeping, not library chores. Filtered
    // here so every consumer — including ChoresTab's "show archived" view —
    // stays clean without each one remembering to exclude them.
    .neq('category', DIRECT_AWARD_CATEGORY)
  if (!includeArchived) query = query.eq('is_archived', false)
  const { data, error } = await query.order('title')
  if (error) throw error
  return data ?? []
}

export interface ChoreInput {
  title: string
  value: number
  frequency: Frequency
  category: string
  description?: string | null
  icon?: string | null
}

/**
 * Create a custom family chore (added to the family's own library).
 * is_custom marks it as parent-authored so the UI can distinguish it from the
 * seeded master library.
 */
export async function createChore(familyId: string, input: ChoreInput): Promise<Chore> {
  const { data, error } = await supabase
    .from('chores')
    .insert({
      family_id: familyId,
      is_template: false,
      is_custom: true,
      title: input.title,
      value: input.value,
      frequency: input.frequency,
      category: input.category,
      description: input.description ?? null,
      icon: input.icon ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateChore(choreId: string, input: Partial<ChoreInput>): Promise<void> {
  const { error } = await supabase.from('chores').update(input).eq('id', choreId)
  if (error) throw error
}

export interface ChoreUsage {
  /** Active + paused roster entries pointing at this chore. */
  roster: number
  /** Generated instances — the child's earned/missed history. */
  history: number
}

/** How much a chore is referenced. Both counts must be 0 for a hard delete. */
export async function getChoreUsage(choreId: string): Promise<ChoreUsage> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('id, is_template')
    .eq('chore_id', choreId)
  if (error) throw error
  const rows = data ?? []
  return {
    roster: rows.filter((r) => r.is_template).length,
    history: rows.filter((r) => !r.is_template).length,
  }
}

/**
 * Hard-delete a family chore. The chore_id FK is ON DELETE RESTRICT, so this
 * fails rather than cascading away a child's earned-chore history — archive
 * instead when a chore has been used.
 */
export async function deleteChore(choreId: string): Promise<void> {
  const { error } = await supabase.from('chores').delete().eq('id', choreId)
  if (error) throw error
}

/**
 * Archive a chore: hide it from the library and deactivate every roster entry
 * that uses it, so no new instances generate. All history stays intact.
 */
export async function archiveChore(choreId: string): Promise<void> {
  const { error: rosterErr } = await supabase
    .from('chore_assignments')
    .update({ is_active: false })
    .eq('chore_id', choreId)
    .eq('is_template', true)
  if (rosterErr) throw rosterErr

  const { error } = await supabase.from('chores').update({ is_archived: true }).eq('id', choreId)
  if (error) throw error
}

/** Restore an archived chore to the library. Roster entries stay paused. */
export async function unarchiveChore(choreId: string): Promise<void> {
  const { error } = await supabase.from('chores').update({ is_archived: false }).eq('id', choreId)
  if (error) throw error
}

export interface RosterEntry extends ChoreAssignment {
  chore: Chore | null
  member: PendingMember | null
}

/** All roster templates (is_template=true) across the family, with chore + child. */
export async function getRoster(): Promise<RosterEntry[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select(
      '*, chore:chores(*), member:family_members!chore_assignments_assigned_to_fkey(id,display_name,avatar_url)'
    )
    .eq('is_template', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as RosterEntry[]
}

/**
 * Sum of the *daily* chore values on one child's live roster — what they can
 * earn in a single day if every daily chore gets done.
 *
 * Weekly/monthly/once entries are deliberately excluded: this answers "how much
 * is a day worth", which is the number a parent needs when deciding whether to
 * add one more chore. ChoresTab's "Potential weekly" stat is the other question
 * and keeps its own WEEKLY_MULTIPLIER.
 *
 * Pure over rows already fetched by getRoster(), so it issues no query and can
 * be recomputed freely as the roster changes.
 */
export function dailyRosterTotal(roster: RosterEntry[], memberId: string): number {
  return roster
    .filter(
      (r) =>
        r.assigned_to === memberId &&
        r.is_template &&
        r.is_active &&
        r.chore?.frequency === 'daily'
    )
    .reduce((sum, r) => sum + (r.chore?.value ?? 0), 0)
}

/**
 * Pause or resume a roster entry. Paused entries stop generating new instances
 * but keep every instance they already produced — this is the normal way to
 * take a chore off a child's list.
 */
export async function setRosterEntryActive(templateId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    .update({ is_active: isActive })
    .eq('id', templateId)
    .eq('is_template', true)
  if (error) throw error
}

/** Change which day of the week a weekly roster entry falls due. */
export async function setRosterEntryDay(templateId: string, dow: number | null): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    .update({ recurrence_dow: dow })
    .eq('id', templateId)
    .eq('is_template', true)
  if (error) throw error
}

/**
 * Permanently remove a roster template. Generated instances survive with
 * template_id set to null (the self-FK is ON DELETE SET NULL), so history is
 * kept — but the entry can't be resumed. Prefer setRosterEntryActive(false).
 */
export async function removeRosterEntry(templateId: string): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    .delete()
    .eq('id', templateId)
    .eq('is_template', true)
  if (error) throw error
}

export interface MissedInstance extends AssignmentWithChore {
  member: PendingMember | null
}

/** Expired (missed) instances across the family, most recent first. */
export async function getMissedInstances(sinceDays = 14): Promise<MissedInstance[]> {
  const since = new Date()
  since.setDate(since.getDate() - sinceDays)
  const { data, error } = await supabase
    .from('chore_assignments')
    .select(
      '*, chore:chores(*), member:family_members!chore_assignments_assigned_to_fkey(id,display_name,avatar_url)'
    )
    .eq('is_template', false)
    .eq('status', 'expired')
    .gte('due_date', since.toISOString())
    .order('due_date', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []) as unknown as MissedInstance[]
}

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */

/** What a cleanup pass removed. */
export interface CleanupResult {
  deleted: number
  cutoff: string
}

/**
 * Deletes stale chore_assignment INSTANCE rows to keep the table from growing
 * without bound. Intended to be run manually about once a month — there is no
 * scheduler wired up.
 *
 * Deletes only rows that are all of:
 *   - is_template = false   (roster templates are never touched)
 *   - status in ('expired', 'rejected')
 *   - due_date older than `olderThanDays` (default 30)
 *
 * Deliberately NOT deleted:
 *   - 'approved' rows, ever. They are the financial history behind every
 *     balance and every earnings figure, and balances are maintained by DB
 *     triggers against these rows.
 *   - 'rejected' rows inside the window, so a child can still read the
 *     parent's note explaining why something wasn't approved.
 *   - 'pending' / 'in_progress' / 'completed' rows, which are all live.
 *   - Template rows, which would take the child off the chore entirely.
 *
 * Note this is a housekeeping measure, not a space fix: the whole public
 * schema is a couple of megabytes. See the V2 note in CLAUDE.md — the real
 * scale answer is on-demand generation, not deleting rows after the fact.
 */
export async function deleteExpiredAssignments(olderThanDays = 30): Promise<CleanupResult> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - olderThanDays)
  const cutoffIso = cutoff.toISOString()

  const { data, error } = await supabase
    .from('chore_assignments')
    .delete()
    .eq('is_template', false)
    .in('status', ['expired', 'rejected'])
    .lt('due_date', cutoffIso)
    .select('id')
  if (error) throw error

  return { deleted: data?.length ?? 0, cutoff: cutoffIso }
}
