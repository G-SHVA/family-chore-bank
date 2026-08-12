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
 * single instance and never regenerate. Idempotent — safe to call on every load.
 * Returns the number of new instances created.
 *
 * A module-level lock coalesces concurrent calls (e.g. React StrictMode's
 * double-invoked effects, or two components mounting at once) into a single
 * run so we never double-insert instances for the same period.
 */
let generationLock: Promise<number> | null = null
export function generateDailyAssignments(now: Date = new Date()): Promise<number> {
  if (generationLock) return generationLock
  generationLock = runGeneration(now).finally(() => {
    generationLock = null
  })
  return generationLock
}

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
  const { data: instances, error: instErr } = await supabase
    .from('chore_assignments')
    .select('id, template_id, due_date')
    .eq('is_template', false)
    .in('template_id', templateIds)
  if (instErr) throw instErr

  const existingByTemplate = new Map<string, { due_date: string | null }[]>()
  for (const inst of instances ?? []) {
    if (!inst.template_id) continue
    const list = existingByTemplate.get(inst.template_id) ?? []
    list.push(inst)
    existingByTemplate.set(inst.template_id, list)
  }

  const toInsert: TablesInsert<'chore_assignments'>[] = []

  for (const t of templates) {
    const chore = (t as AssignmentWithChore).chore
    if (!chore) continue
    const freq = (chore.frequency ?? 'daily') as Frequency
    const existing = existingByTemplate.get(t.id) ?? []

    if (freq === 'once') {
      // Generate exactly one instance, ever.
      if (existing.length > 0) continue
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

  const { error: insErr } = await supabase.from('chore_assignments').insert(toInsert)
  if (insErr) throw insErr
  return toInsert.length
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

/** All instance rows (never templates) for a member, newest first, with chore. */
export async function getMemberInstances(memberId: string): Promise<AssignmentWithChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .order('due_date', { ascending: true })
    .limit(300)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
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
function computeStreak(instances: AssignmentWithChore[], now: Date): number {
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

/** Reject a completed chore with a note (no balance change). */
export async function rejectChore(assignmentId: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from('chore_assignments')
    .update({ status: 'rejected', notes })
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

export interface ChildSummary {
  member: FamilyMember
  weeklyEarnings: number
  currentStreak: number
  pendingCount: number
}

/** Per-child rollups (weekly earnings, streak, pending count) for the parent view. */
export async function getFamilyChildSummaries(children: FamilyMember[]): Promise<ChildSummary[]> {
  if (children.length === 0) return []
  const now = new Date()
  const ids = children.map((c) => c.id)

  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .in('assigned_to', ids)
    .eq('is_template', false)
    .limit(1000)
  if (error) throw error
  const instances = (data ?? []) as AssignmentWithChore[]

  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)

  return children.map((member) => {
    const mine = instances.filter((i) => i.assigned_to === member.id)
    const weeklyEarnings = mine
      .filter((i) => {
        if (i.status !== 'approved' || !i.approved_at) return false
        const d = new Date(i.approved_at)
        return d >= weekStart && d <= weekEnd
      })
      .reduce((sum, i) => sum + (i.chore?.value ?? 0), 0)
    const pendingCount = mine.filter((i) => i.status === 'completed').length
    return {
      member,
      weeklyEarnings,
      currentStreak: computeStreak(mine, now),
      pendingCount,
    }
  })
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
  const instances = await getMemberInstances(memberId)
  const approved = instances.filter((i) => i.status === 'approved')

  const totalEarned = approved.reduce((s, i) => s + (i.chore?.value ?? 0), 0)
  const totalCompleted = instances.filter(
    (i) => i.status === 'approved' || i.status === 'completed'
  ).length

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEarned = approved
    .filter((i) => i.approved_at && new Date(i.approved_at) >= monthStart)
    .reduce((s, i) => s + (i.chore?.value ?? 0), 0)

  const doneCount = totalCompleted
  const completionRate = instances.length > 0 ? Math.round((doneCount / instances.length) * 100) : 0

  const approvedDays = new Set<number>()
  for (const i of approved) {
    if (i.approved_at) approvedDays.add(startOfDay(new Date(i.approved_at)).getTime())
  }
  const currentStreak = computeStreak(instances, now)
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

function computeLongestStreak(approvedDays: Set<number>): number {
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
