import { supabase } from '@/lib/supabase'
import type { Chore, ChoreAssignment, FamilyMember } from '@/lib/supabase'
import type { TablesInsert } from '@/types/database.types'
// The Half Credit penalty leg. expenseService imports nothing from here, so
// this edge introduces no cycle.
import { directChargeCustom, REMINDER_PENALTY_CATEGORY } from '@/features/expenses/expenseService'
import {
  addDays,
  dayKey,
  dayKeyWeekday,
  endOfDay,
  endOfMonth,
  endOfWeek,
  shiftDayKey,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '@/lib/time'

export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly'

/** A chore_assignment row with its joined chore. */
export interface AssignmentWithChore extends ChoreAssignment {
  chore: Chore | null
}

/* ------------------------------------------------------------------ *
 * Date/period helpers. Weeks are Monday–Sunday.
 *
 * These used to be local `setHours`/`setDate` helpers defined here. They now
 * come from lib/time and resolve in the FAMILY's timezone, so a chore's due
 * date and the dedup bucket the database puts it in agree for a family in any
 * zone — not only one sitting in Central. See lib/time for the mechanism.
 * ------------------------------------------------------------------ */

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
  // addDays steps CIVIL days, so a week containing a DST change still lands on
  // the right weekday rather than an hour either side of its midnight.
  const target = addDays(weekStart, (dow + 6) % 7) // Monday = 0 … Sunday = 6
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

/**
 * Whether an instance's due date has already passed.
 *
 * Compared against NOW, not the start of the day: a roster instance's due_date
 * is the end of its period, so "past" genuinely means the window closed. Never
 * offer Complete on one of these — the server would reject it (markChoreComplete
 * filters on pending/in_progress and the sweep expires them).
 *
 * Exported so ChoreCard and the child Home read share one definition of
 * "actionable". They had separate copies; the screen and the query disagreeing
 * about what counts as live is exactly how a chore becomes invisible.
 */
export function isLapsed(a: { due_date: string | null }): boolean {
  return !!a.due_date && new Date(a.due_date) < new Date()
}

/** Open, in period, and the child can act on it right now. */
export function isActionable(a: { due_date: string | null; status: string | null }): boolean {
  const status = a.status ?? 'pending'
  return (status === 'pending' || status === 'in_progress') && !isLapsed(a)
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
    // Claim-library roster requests (Path 2) are is_template = true and would
    // otherwise match both predicates above — so a child tapping "Add to my
    // regulars" would start generating daily instances on the NEXT parent
    // dashboard load, before the parent ever saw the request. The approval
    // step would be decorative.
    //
    // Belt and braces, deliberately. Path 2 rows are ALSO inserted with
    // is_active = false, which the filter above already excludes. Neither
    // layer is redundant: this one is explicit and survives someone flipping
    // is_active for an unrelated reason, and per CLAUDE.md every read of this
    // table states its status filter rather than relying on another column to
    // imply it. Approval flips status AND is_active in one update.
    .neq('status', 'requested')
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
 * Live, actionable instances for a member — NEWEST FIRST, with chore.
 *
 * THIRD FIX IN THE SAME TRUNCATION CLASS (2026-08-31). This was previously
 * getMemberInstances(), which fetched EVERY status for a member under one
 * limit(500). That made a capped read compete between two unrelated things:
 * a child's live chores, and their ever-growing history of approved/expired
 * rows. History always wins that race eventually, and when it does the child's
 * actual chores fall out of the window and the list goes blank.
 *
 * The fix is the explicit status filter, not the ordering. `approved` and
 * `expired` are the two statuses that grow without bound, and both are now
 * excluded here, so this fetch is bounded by CURRENT work — at most one
 * instance per active roster entry per period. The remaining statuses are
 * self-limiting: pending/in_progress are current-period only, and rejected is
 * pruned at 30 days by deleteExpiredAssignments().
 *
 * NOTE: dropping the limit entirely would NOT have fixed this. PostgREST
 * applies its own server-side max-rows to any unbounded read, so removing
 * .limit() just replaces a visible cap with an invisible one — which is the
 * precise mechanism behind the duplicate-generation bug fixed the same day.
 * Always bound a read yourself, by status or date, and order so the rows you
 * need are the ones that survive.
 *
 * Callers needing lifetime totals must NOT derive them here: use
 * getLifetimeCounts(), which aggregates server-side and is not capped.
 */
const ACTIVE_FETCH_LIMIT = 500

export async function getActiveInstances(memberId: string): Promise<AssignmentWithChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .in('status', ACTIVE_STATUSES)
    .order('due_date', { ascending: false })
    .limit(ACTIVE_FETCH_LIMIT)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}

/**
 * ONE SCREEN ONE JOB — the child Home read.
 *
 * Narrower than getActiveInstances on purpose. Home's job is "what can I do
 * right now", so it asks only for the three statuses a child can still act on
 * or is still waiting on:
 *
 *   pending / in_progress -> do it
 *   completed             -> waiting for a parent
 *
 * 'rejected' is deliberately absent. Measured on POCO 2026-09-03, Home was
 * rendering 90 cards of which 2 were actionable: 56 rejected and 32 lapsed
 * rows, 19,511px of scroll. The child's own failures were burying the work.
 * Rejections keep their parent's note and move to the Chores tab, grouped
 * under a collapsed "Recent misses" (see getRejectedSince).
 *
 * Bounded by status, not by a row cap: all three statuses here are
 * current-period only — at most one instance per active roster entry per
 * period — so this read cannot grow with history the way an 'approved' or
 * 'expired' read does. The limit is a backstop, and DESC ordering means the
 * rows that survive it are the newest, per the rule in CLAUDE.md.
 */
const HOME_STATUSES = ['pending', 'in_progress', 'completed']

export async function getHomeChores(memberId: string): Promise<AssignmentWithChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .in('status', HOME_STATUSES)
    .order('due_date', { ascending: false })
    .limit(ACTIVE_FETCH_LIMIT)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}

/**
 * Rejected instances from the last N days, for the Chores tab's "Recent
 * misses" section.
 *
 * DATE-BOUNDED, not count-bounded, and that is the better of the two for the
 * same reason every other read in this file is: a count cap silently drops
 * rows once history outgrows it, while a date window drops exactly what it
 * says it drops. A rejection note older than two weeks has no actionable
 * lesson left in it anyway.
 *
 * The rows are not deleted and parents keep full visibility — only the
 * CHILD's read is windowed.
 */
const REJECTED_WINDOW_DAYS = 14

export async function getRejectedSince(
  memberId: string,
  days: number = REJECTED_WINDOW_DAYS
): Promise<AssignmentWithChore[]> {
  const since = addDays(startOfDay(new Date()), -days)
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .eq('status', 'rejected')
    .gte('due_date', since.toISOString())
    .order('due_date', { ascending: false })
    .limit(ACTIVE_FETCH_LIMIT)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}

/**
 * How far back the child dashboard reads approved history. Bounds both the
 * streak and the weekly money figures. A streak longer than this is reported
 * as this many days — a deliberate, documented ceiling, rather than the silent
 * and unpredictable one a row cap gives you.
 */
const RECENT_WINDOW_DAYS = 90
const RECENT_FETCH_LIMIT = 1000

/**
 * A row from getApprovedSince, which carries the awarding parent alongside the
 * chore. The embedded member is what lets the character-recognition banner say
 * WHO caught the child being great; every other consumer ignores it.
 */
export interface ApprovedWithAwarder extends AssignmentWithChore {
  awarded_by: { display_name: string | null } | null
}

/**
 * Approved rows since `since`, newest first. Date-bounded, never lifetime.
 *
 * The `awarded_by` embed is deliberately ON THIS EXISTING QUERY rather than in
 * a second round trip: the child dashboard already reads these rows for streaks
 * and weekly earnings, and the character-recognition banner is derived from the
 * same array (see getChildDashboard). One extra embedded column on a read that
 * was already happening beats a new query per dashboard load.
 */
async function getApprovedSince(memberId: string, since: Date): Promise<ApprovedWithAwarder[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select(
      '*, chore:chores(*), awarded_by:family_members!chore_assignments_assigned_by_fkey(display_name)'
    )
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .eq('status', 'approved')
    .gte('approved_at', since.toISOString())
    .order('approved_at', { ascending: false })
    .limit(RECENT_FETCH_LIMIT)
  if (error) throw error
  return (data ?? []) as unknown as ApprovedWithAwarder[]
}

/**
 * Recent approved rows for DISPLAY ONLY, newest first.
 *
 * Explicitly bounded and explicitly named that way. This used to be
 * getApprovedInstances() with .limit(5000), which read as "effectively all of
 * them" but was not: PostgREST clips any limit above its own server-side
 * max-rows, silently, so the 5000 was decorative. Worse, getAchievementsOverview
 * summed lifetime earnings off the resulting array — money derived from a capped
 * read, the fourth instance of the truncation class.
 *
 * Totals now come from member_earnings_summary(); this feeds the child's
 * "Completed" list, where showing the most recent N is the correct behaviour
 * anyway. NEVER sum money from this.
 */
const RECENT_APPROVED_LIMIT = 300

export async function getRecentApprovedInstances(
  memberId: string
): Promise<AssignmentWithChore[]> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(RECENT_APPROVED_LIMIT)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}

/**
 * Approved earnings summed IN POSTGRES. `since` omitted means lifetime.
 *
 * Approved rows are never archived (archive_old_assignments moves only expired
 * and rejected), so the live table is the complete history and this needs no
 * union against chore_assignments_archive.
 */
export async function getEarningsSummary(
  memberId: string,
  since?: Date
): Promise<{ totalEarned: number; approvedCount: number }> {
  const { data, error } = await supabase.rpc('member_earnings_summary', {
    p_member_id: memberId,
    p_since: since ? since.toISOString() : undefined,
  })
  if (error) throw error
  const row = data?.[0]
  return { totalEarned: Number(row?.total_earned ?? 0), approvedCount: Number(row?.approved_count ?? 0) }
}

/**
 * Approved activity collapsed to ONE ROW PER DAY, newest first.
 *
 * This is what lets the streaks read full history without a row cap: the result
 * grows with days elapsed (~365/year), not chores approved. Cuddles' 73 approved
 * rows collapse to 6 day rows, POCO's 67 to 8.
 *
 * `roster_count` excludes Direct Awards; `total_count` keeps them. Streaks use
 * the former, the activity chart the latter.
 */
interface ApprovedDay {
  /** 'YYYY-MM-DD' in the FAMILY's timezone, as bucketed by the RPC. */
  day: string
  totalCount: number
  rosterCount: number
}

async function getApprovedDayCounts(memberId: string): Promise<ApprovedDay[]> {
  const { data, error } = await supabase.rpc('member_approved_day_counts', {
    p_member_id: memberId,
  })
  if (error) throw error
  return (data ?? []).map((r) => ({
    // Kept as the 'YYYY-MM-DD' string the RPC returns. It used to be converted
    // to a local-midnight timestamp with `new Date(y, m-1, d)`, which forced a
    // day the SERVER had already bucketed in the family's zone back through the
    // BROWSER's zone — two different answers for a kiosk used while travelling.
    // Both sides now speak civil days, so no conversion is needed at all.
    day: r.day,
    totalCount: Number(r.total_count ?? 0),
    rosterCount: Number(r.roster_count ?? 0),
  }))
}

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

/**
 * A "Caught Being Great" recognition recent enough to still celebrate.
 *
 * Derived, never stored. There is no notifications table in this schema and
 * this feature does not add one: the celebration is computed from approved
 * award rows the dashboard has ALREADY fetched, so it cannot drift out of sync
 * with the money the way a separate record could, and it costs no extra query.
 */
export interface CharacterMoment {
  id: string
  /** What the parent typed — the throwaway chore row's title. */
  description: string
  amount: number
  approvedAt: string
  /** The awarding parent's display name, or null if the join came back empty. */
  awardedBy: string | null
  /** Who awarded it, so the caller can recognise the shared operator account. */
  awardedByMemberId: string | null
  /** The parent's optional extra note. */
  note: string | null
}

/**
 * How long a character recognition keeps celebrating.
 *
 * 48 hours, not 24, and the reason is the hardware: the wall tablet is not
 * opened every day, so a child recognised yesterday evening would otherwise
 * never see their own banner. Dismissal is component state only — nothing is
 * written, and seeing it again after a full app restart is harmless.
 */
const CHARACTER_MOMENT_WINDOW_MS = 48 * 60 * 60 * 1000

/** Pull the celebrations out of rows the dashboard already has in hand. */
function deriveCharacterMoments(
  approved: ApprovedWithAwarder[],
  now: Date
): CharacterMoment[] {
  const cutoff = now.getTime() - CHARACTER_MOMENT_WINDOW_MS
  return approved
    .filter(
      (r) =>
        r.chore?.category === CHARACTER_MOMENT_CATEGORY &&
        r.approved_at !== null &&
        new Date(r.approved_at).getTime() >= cutoff
    )
    .map((r) => ({
      id: r.id,
      description: r.chore?.title ?? 'Something great',
      amount: r.chore?.value ?? 0,
      approvedAt: r.approved_at as string,
      awardedBy: r.awarded_by?.display_name ?? null,
      awardedByMemberId: r.assigned_by,
      note: r.notes,
    }))
}

/**
 * What the child Home screen needs — and nothing else.
 *
 * The four stat figures this used to carry (completedThisWeek, pendingApproval,
 * dueToday, completionRate) were removed on 2026-09-03 under ONE SCREEN ONE JOB.
 * They were not relocated: Achievements already rendered the same numbers, so
 * Home was duplicating a reporting screen. `pendingApproval` and `dueToday`
 * restated the chore list rendered beside them.
 *
 * completionRate is gone from every child-facing surface, Achievements
 * included. It measures ROSTER SIZE, not the child's effort — 85 active
 * entries across two children is what produces a 19% rate — and a child should
 * not be handed that number daily. Parents keep it in Analytics and Family Week.
 *
 * Dropping it also removed a whole read per dashboard load: the week-windowed
 * getInstancesDueBetween() existed only to compute that denominator.
 */
export interface ChildDashboardData {
  balance: number
  /** Actionable only — see getHomeChores. Rejected/lapsed live on Chores. */
  activeChores: AssignmentWithChore[]
  weeklyEarnings: number
  currentStreak: number
  /** Recognitions from the last 48h, newest first. Usually empty. */
  characterMoments: CharacterMoment[]
}

export async function getChildDashboard(memberId: string): Promise<ChildDashboardData> {
  const now = new Date()

  const { data: member, error: memErr } = await supabase
    .from('family_members')
    .select('balance')
    .eq('id', memberId)
    .single()
  if (memErr) throw memErr

  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const inThisWeek = (iso: string | null) => {
    if (!iso) return false
    const d = new Date(iso)
    return d >= weekStart && d <= weekEnd
  }

  // Three purpose-built reads instead of one capped all-status fetch. Each is
  // bounded by what it actually needs — status, or a date window — so a child's
  // growing history can never crowd their live chores out of the result. See
  // getActiveInstances() for the full account of the bug this replaces.
  const streakSince = addDays(startOfDay(now), -RECENT_WINDOW_DAYS)

  // Two reads, down from three. getHomeChores replaced getActiveInstances (it
  // drops 'rejected'), and the week-windowed read went with the completion rate.
  const [activeChores, approvedRecent] = await Promise.all([
    getHomeChores(memberId),
    getApprovedSince(memberId, streakSince),
  ])

  // The last cut: a pending row whose window has closed is a MISS, not work.
  // getHomeChores cannot express this as a query filter, because a 'completed'
  // row legitimately has a past due_date while it waits on a parent.
  const homeChores = activeChores.filter((i) => isActionable(i) || i.status === 'completed')

  const approvedThisWeek = approvedRecent.filter((i) => inThisWeek(i.approved_at))
  const weeklyEarnings = approvedThisWeek.reduce((sum, i) => sum + (i.chore?.value ?? 0), 0)

  // Direct Awards must not extend a chore streak — a parent handing out money
  // is not the child doing a chore. The parent dashboard and Achievements
  // already filtered here; the child dashboard was the last screen that did
  // not, so the same child could read a longer streak on their own Home tab
  // than a parent saw for them.
  const currentStreak = computeStreak(rosterInstancesOnly(approvedRecent), now)

  return {
    balance: member.balance ?? 0,
    activeChores: homeChores,
    weeklyEarnings,
    currentStreak,
    // Derived from approvedRecent — already fetched above for the streak and
    // the weekly total. No additional round trip.
    characterMoments: deriveCharacterMoments(approvedRecent, now),
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

/**
 * Days are 'YYYY-MM-DD' keys in the family's timezone, not timestamps.
 *
 * They used to be local-midnight `getTime()` values, walked backwards with
 * `setDate(getDate() - 1)`. Two problems that fix together: the midnights were
 * the BROWSER's, while member_approved_day_counts() bucketed the same rows in
 * the family's zone; and computeLongestStreak below compared adjacency with
 * `=== 86_400_000`, which is false across a DST change — a streak running
 * through the March or November transition was silently cut short. A civil-day
 * key has no offset and no variable-length day.
 */
export function computeStreakFromDays(approvedDays: Set<string>, now: Date): number {
  if (approvedDays.size === 0) return 0

  let streak = 0
  let cursor = dayKey(now)
  // Allow the streak to "end" today or yesterday.
  if (!approvedDays.has(cursor)) {
    cursor = shiftDayKey(cursor, -1)
    if (!approvedDays.has(cursor)) return 0
  }
  while (approvedDays.has(cursor)) {
    streak++
    cursor = shiftDayKey(cursor, -1)
  }
  return streak
}

export function computeStreak(instances: AssignmentWithChore[], now: Date): number {
  const approvedDays = new Set<string>()
  for (const i of instances) {
    if (i.status === 'approved' && i.approved_at) {
      approvedDays.add(dayKey(new Date(i.approved_at)))
    }
  }
  return computeStreakFromDays(approvedDays, now)
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

/**
 * How a Half Credit approval splits a chore's value, in whole cents.
 *
 * The CREDIT rounds DOWN and the penalty takes the remainder, so a value that
 * does not halve cleanly resolves in the parent's favour rather than handing
 * out a phantom cent: 25c splits 12c credited / 13c charged, not 13c/12c.
 *
 * Exported for the button label. The parent must be able to read the exact
 * figure they are authorising BEFORE they tap, so the UI and the write have to
 * derive it from one function rather than each doing its own arithmetic.
 */
export function splitHalfCredit(value: number | null | undefined): {
  valueCents: number
  creditCents: number
  penaltyCents: number
} {
  const valueCents = Math.max(0, Math.round((value ?? 0) * 100))
  const creditCents = Math.floor(valueCents / 2)
  return { valueCents, creditCents, penaltyCents: valueCents - creditCents }
}

/** The auto-note on the degenerate no-credit path. See approveChoreHalfCredit. */
export const HALF_CREDIT_TOO_SMALL_NOTE =
  'Chore value too small to split — no credit issued after reminders.'

/**
 * Approve a chore at HALF its value — the book's "second reminder for a task:
 * 50% off credit".
 *
 * TWO WRITES, AND NEITHER TOUCHES A BALANCE. There is no such thing as a
 * partial credit at the database level: update_balance_on_chore_approval reads
 * `(SELECT value FROM chores WHERE id = NEW.chore_id)`, and chore_assignments
 * has no amount column to override it with. So the chore is approved at FULL
 * value through the ordinary approve_chore RPC, and the difference is clawed
 * back as a one-off penalty through the ordinary apply_expense RPC. The two
 * existing triggers do the money, exactly as they do for every other
 * transaction in the app.
 *
 * The book itself lists reminders under EXPENSE templates, so the resulting
 * two-line ledger — the full credit, then what the reminder cost — is the
 * faithful reading rather than a compromise. A child sees what they earned and
 * what they lost, instead of one quietly reduced number.
 *
 * ORDER IS LOAD-BEARING. Approve first, penalise second. If the penalty leg
 * fails the child keeps the full credit and the thrown error says so, so a
 * parent can settle it with a Direct Charge. The reverse order would leave a
 * child DEBITED for a chore that was never CREDITED if the approval failed,
 * which is the one outcome this must never produce. Failure favours the child.
 */
export async function approveChoreHalfCredit(
  assignmentId: string,
  memberId: string,
  parentMemberId: string,
  familyId: string,
  choreTitle: string | null | undefined,
  choreValue: number | null | undefined
): Promise<void> {
  const { creditCents, penaltyCents } = splitHalfCredit(choreValue)

  // Degenerate case: a 1c chore halves to a 0c credit. Approving would write an
  // 'approved' row worth nothing and then charge the whole penny back — a
  // meaningless $0.00 credit dressed up as an approval. Record it as what it
  // actually is instead. Value 0 chores land here too, correctly.
  if (creditCents === 0) {
    await rejectChore(assignmentId, HALF_CREDIT_TOO_SMALL_NOTE)
    return
  }

  await approveChore(assignmentId, parentMemberId)

  if (penaltyCents === 0) return // an even value; nothing to claw back

  try {
    await directChargeCustom(
      familyId,
      memberId,
      // Labelled so the lesson is explicit in the child's ledger rather than a
      // cryptic deduction sitting under the credit it belongs to.
      `Reminder penalty — ${choreTitle ?? 'chore'}`,
      penaltyCents / 100,
      'Task completed after a second reminder',
      REMINDER_PENALTY_CATEGORY
    )
  } catch (e) {
    throw new Error(
      `The chore was approved at full credit, but the ${formatCents(penaltyCents)} reminder penalty was not applied — settle it with a Direct Charge. ${
        e instanceof Error ? e.message : 'Unknown error.'
      }`
    )
  }
}

/** Whole cents as a plain dollar string, for messages that must state an amount. */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
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
 * Marker category for a "Caught Being Great" character recognition.
 *
 * Mechanically a Direct Award — same insert-then-approve path, same throwaway
 * `chores` row — but kept as its OWN category rather than reusing
 * 'direct-award', because the child dashboard identifies a celebration by
 * exactly this value. Folding the two together would turn every ordinary
 * parent award into a "caught you being great" banner.
 *
 * The book's own chore "Get Caught Serving the Family" ($0.25) is the source of
 * the default amount; this is the spontaneous version of it, with no chore
 * required.
 */
export const CHARACTER_MOMENT_CATEGORY = 'character-moment'

/**
 * Categories that exist only so a balance trigger has a row to read a value
 * from. None of them is a library chore, and getFamilyChores — the single door
 * every library view goes through, archived views included — excludes all of
 * them. Add new markers HERE, never at a call site.
 */
export const RESERVED_CHORE_CATEGORIES = [
  DIRECT_AWARD_CATEGORY,
  CHARACTER_MOMENT_CATEGORY,
] as const

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
  notes?: string | null,
  // "Caught Being Great" rides this same path and differs only in the marker
  // category, which is what the child dashboard matches on to raise the
  // celebration. Every existing caller omits it and is unchanged.
  category: (typeof RESERVED_CHORE_CATEGORIES)[number] = DIRECT_AWARD_CATEGORY
): Promise<void> {
  const { data, error } = await supabase
    .from('chores')
    .insert({
      family_id: familyId,
      title: title.trim(),
      value: amount,
      frequency: 'once',
      category,
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
  // Must match the month boundary member_earnings_summary() uses server-side,
  // which now reads the family's timezone from families.
  const monthStart = startOfMonth(now)

  // Every figure here is now computed server-side. Money is summed in Postgres
  // and activity is returned pre-grouped by day, so nothing on this screen is
  // derived from a capped array — see getRecentApprovedInstances for the bug
  // this replaced.
  const [lifetime, month, days, counts] = await Promise.all([
    getEarningsSummary(memberId),
    getEarningsSummary(memberId, monthStart),
    getApprovedDayCounts(memberId),
    getLifetimeCounts(memberId),
  ])

  const totalEarned = lifetime.totalEarned
  const monthEarned = month.totalEarned
  const totalCompleted = counts.done

  const completionRate =
    counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0

  // Streaks: roster days only. totalEarned / monthEarned above intentionally
  // still include Direct Awards, because an award is real money the child
  // earned — it just is not a chore, so it cannot extend a streak.
  const rosterDays = new Set(days.filter((d) => d.rosterCount > 0).map((d) => d.day))
  const currentStreak = computeStreakFromDays(rosterDays, now)
  const longestStreak = computeLongestStreak(rosterDays)

  // Last 7 days (oldest -> newest) count of approved chores per day. The cursor
  // walks civil days in the family's zone, which is the same bucketing the RPC
  // used, so a key either matches or the day genuinely had no approvals.
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const countByDay = new Map(days.map((d) => [d.day, d.totalCount]))
  const today = dayKey(now)
  const sevenDay: { label: string; count: number }[] = []
  for (let d = 6; d >= 0; d--) {
    const key = shiftDayKey(today, -d)
    sevenDay.push({ label: dayLabels[dayKeyWeekday(key)], count: countByDay.get(key) ?? 0 })
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
export function computeLongestStreak(approvedDays: Set<string>): number {
  if (approvedDays.size === 0) return 0
  // 'YYYY-MM-DD' sorts lexicographically into chronological order, and
  // adjacency is now "the next civil day" rather than "exactly 86,400,000 ms
  // later" — the comparison that used to break every streak spanning a DST
  // transition, when a local day is 23 or 25 hours long.
  const days = [...approvedDays].sort()
  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    if (days[i] === shiftDayKey(days[i - 1], 1)) run++
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
  // One-off award rows are bookkeeping, not library chores. Filtered here so
  // every consumer — including ChoresTab's "show archived" view, which would
  // otherwise see them — stays clean without each one remembering to exclude.
  for (const category of RESERVED_CHORE_CATEGORIES) {
    query = query.neq('category', category)
  }
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
    // Excludes unapproved Path 2 claim requests. Without this a child's
    // request renders in Manage -> Chores as a live roster entry, with
    // working pause and delete controls, before the parent has approved it.
    // Roster requests belong in the dashboard's CHORE REQUESTS queue, which
    // reads them explicitly.
    .neq('status', 'requested')
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
  // addDays steps CIVIL days in the family's zone; `setDate` on a raw Date
  // steps them in the browser's and drifts an hour at each DST change.
  const since = addDays(new Date(), -sinceDays)
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
  const cutoff = addDays(new Date(), -olderThanDays)
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

/* ------------------------------------------------------------------ *
 * Claim library — children self-select chores
 *
 * WHY THIS EXISTS. Eve had 85 active roster entries because the only way to
 * make a chore AVAILABLE to a child was to assign it permanently. The kids
 * kept asking for chores; every ask became a roster row. The result was a
 * roster nobody could complete (19-28%) and a Home screen rendering 90 cards.
 *
 * The claim library separates "available" from "assigned". A small mandatory
 * core roster stays parent-assigned; everything else the child browses and
 * requests. Agency is the point — the book's own mechanic is children
 * self-selecting what to work on.
 *
 * TWO PATHS, ONE STATUS. Both produce a chore_assignments row with
 * status = 'requested'; is_template is what tells them apart:
 *
 *   Path 1  "Do this today"          is_template = false, template_id = NULL
 *   Path 2  "Add to my regulars"     is_template = true,  is_active   = false
 *
 * NO NEW TABLE AND NO NEW COLUMN. 'requested' rows become ordinary rows on
 * approval, so an approved claim costs exactly what a parent-assigned chore
 * costs. Net new rows per claim beyond what the system would generate anyway:
 * zero.
 *
 * Path 1 rows carry template_id = NULL, which keeps them outside
 * idx_ca_daily_dedup entirely (its WHERE clause requires template_id IS NOT
 * NULL) at both the 'requested' and the approved 'pending' stage. That is
 * deliberate: a child may request a one-off of a chore that is ALSO on their
 * roster today, and the two rows must not collide.
 *
 * Path 2 rows are kept away from the generator by TWO independent layers —
 * is_active = false here, and the explicit .neq('status','requested') in
 * runGeneration(). See the comment there.
 *
 * REQUESTS NEVER AUTO-EXPIRE. expireLapsedAssignments() filters
 * is_template = false AND status IN ('pending','in_progress'), so a
 * 'requested' row is invisible to the nightly sweep. A request made in good
 * faith stays live until a parent actually answers it — approving one the
 * morning after is valid, and the child does not lose it to a clock.
 * ------------------------------------------------------------------ */

/** The child-initiated claim status. One value, both paths. */
export const REQUESTED_STATUS = 'requested'

/**
 * Payload guard for the per-child claim reads. Both are naturally bounded —
 * one by roster size, one by the number of requests a parent has yet to answer
 * — but per CLAUDE.md every read of this table states its own bound rather
 * than trusting the shape of the data to stay small.
 */
const CLAIM_FETCH_LIMIT = 500

/** A category and the claimable chores inside it. */
export interface ClaimGroup {
  category: string
  chores: Chore[]
}

/**
 * The chores THIS child may claim, grouped by category.
 *
 * Reads the library through getFamilyChores(), which is the single door that
 * already excludes RESERVED_CHORE_CATEGORIES and archived rows — so a
 * 'direct-award' or 'character-moment' receipt can never surface here, and a
 * new marker category added to that constant is excluded automatically.
 *
 * Two per-child exclusions, and PER-CHILD is the whole point: POCO requesting
 * a chore must not remove it from Cuddles' library.
 *
 *   1. The child's ACTIVE roster. Paused entries are deliberately NOT
 *      excluded — if Eve took a chore off POCO, he may still ask to do it
 *      once, and that request is exactly the signal she needs.
 *   2. The child's outstanding requests, in EITHER path.
 *
 * Exclusion 2 is not windowed to today, though a request is created for
 * today. 'requested' is a transient status — a parent resolves it to
 * 'pending' or 'rejected' — so the set is self-limiting, and matching on the
 * status rather than on a date is what stops a child from stacking a second
 * request on a chore whose first request the parent has not answered yet.
 */
export async function getClaimableChores(
  memberId: string,
  familyId: string
): Promise<ClaimGroup[]> {
  const [library, rosterRes, requestedRes, liveOneOffsRes] = await Promise.all([
    getFamilyChores(familyId),
    supabase
      .from('chore_assignments')
      .select('chore_id')
      .eq('assigned_to', memberId)
      .eq('is_template', true)
      .eq('is_active', true)
      .neq('status', REQUESTED_STATUS)
      .limit(CLAIM_FETCH_LIMIT),
    supabase
      .from('chore_assignments')
      .select('chore_id')
      .eq('assigned_to', memberId)
      .eq('status', REQUESTED_STATUS)
      .limit(CLAIM_FETCH_LIMIT),
    // Door 4 — APPROVED one-off claims the child has not finished with yet.
    //
    // `.is('template_id', null)`, NEVER `.eq('template_id', null)`. PostgREST
    // reads eq.null as an equality test against a value rather than a NULL
    // test, so the eq form matches nothing and the door silently stands open —
    // a bug that looks exactly like the filter having no effect.
    //
    // template_id IS NULL is the discriminator that makes this read Path 1
    // ONLY. A roster-generated instance carries a template_id and must not
    // land here: it is different work. This matters in the PAUSED roster case
    // specifically — when Eve pauses a chore, door 2 (which requires
    // is_active) stops excluding it, and the paused entry's leftover live
    // instances must not block the child from claiming it fresh.
    //
    // The due_date floor keeps yesterday's finished one-offs out, so the read
    // cannot accumulate over time: it holds at most today's live claims.
    // startOfDay() resolves in the FAMILY's zone via the module-level active
    // timezone — no zone is named here.
    supabase
      .from('chore_assignments')
      .select('chore_id')
      .eq('assigned_to', memberId)
      .eq('is_template', false)
      .is('template_id', null)
      .in('status', ['pending', 'in_progress', 'completed'])
      .gte('due_date', startOfDay(new Date()).toISOString())
      .limit(CLAIM_FETCH_LIMIT),
  ])
  if (rosterRes.error) throw rosterRes.error
  if (requestedRes.error) throw requestedRes.error
  if (liveOneOffsRes.error) throw liveOneOffsRes.error

  const taken = new Set<string>()
  for (const r of rosterRes.data ?? []) if (r.chore_id) taken.add(r.chore_id)
  for (const r of requestedRes.data ?? []) if (r.chore_id) taken.add(r.chore_id)
  for (const r of liveOneOffsRes.data ?? []) if (r.chore_id) taken.add(r.chore_id)

  const groups = new Map<string, Chore[]>()
  for (const chore of library) {
    if (taken.has(chore.id)) continue
    const key = chore.category ?? 'other'
    const list = groups.get(key) ?? []
    list.push(chore)
    groups.set(key, list)
  }

  // getFamilyChores already ordered by title, and Map preserves insertion
  // order, so each group is alphabetical. Sort the groups themselves so the
  // category order is stable between loads rather than following whichever
  // category happened to hold the first chore.
  return [...groups.entries()]
    .map(([category, chores]) => ({ category, chores }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

/**
 * PATH 1 — "Do this today". A one-off instance the child asked for.
 *
 * assigned_by is the CHILD's own member id: this chore was self-selected, and
 * the row should say so. (assigned_by references family_members, unlike
 * chores.created_by which references auth.users — do not mix them.)
 *
 * due_date is the end of today IN THE FAMILY'S TIMEZONE via endOfDay(), not
 * the tablet's. A kiosk in a different zone would otherwise date the request
 * to the wrong civil day.
 */
export async function createOneTimeRequest(choreId: string, memberId: string): Promise<void> {
  const { error } = await supabase.from('chore_assignments').insert({
    chore_id: choreId,
    assigned_to: memberId,
    assigned_by: memberId,
    status: REQUESTED_STATUS,
    is_template: false,
    template_id: null,
    due_date: endOfDay(new Date()).toISOString(),
  })
  if (error) throw error
}

/**
 * PATH 2 — "Add to my regular chores". A roster addition the child asked for.
 *
 * is_active = false is load-bearing, not tidiness: it is one of the two layers
 * keeping an unapproved request away from generateDailyAssignments(). The
 * other is the explicit status filter in runGeneration(). Approval flips both
 * fields together.
 *
 * No due_date. A template row does not have one — the generator computes each
 * instance's due date from the chore's frequency when it creates it.
 */
export async function createRosterRequest(choreId: string, memberId: string): Promise<void> {
  const { error } = await supabase.from('chore_assignments').insert({
    chore_id: choreId,
    assigned_to: memberId,
    assigned_by: memberId,
    status: REQUESTED_STATUS,
    is_template: true,
    is_active: false,
    template_id: null,
  })
  if (error) throw error
}

export interface ChoreRequest extends AssignmentWithChore {
  member: PendingMember | null
}

/** Both paths of the parent's request queue, split by is_template. */
export interface ChoreRequestQueue {
  /** Path 1 — "wants to do this today". */
  oneTime: ChoreRequest[]
  /** Path 2 — "wants this added to their regular chores". */
  roster: ChoreRequest[]
}

/**
 * Every outstanding claim request across the family, oldest first.
 *
 * ONE query for both paths, split client-side on is_template. Bounded by
 * status: 'requested' is transient by construction, so this read cannot grow
 * with history the way an 'approved' or 'expired' read does.
 *
 * Oldest first matches the completed-chore queue above it — the child who has
 * been waiting longest is answered first.
 */
export async function getChoreRequests(): Promise<ChoreRequestQueue> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select(
      '*, chore:chores(*), member:family_members!chore_assignments_assigned_to_fkey(id,display_name,avatar_url)'
    )
    .eq('status', REQUESTED_STATUS)
    .order('created_at', { ascending: true })
    .limit(CLAIM_FETCH_LIMIT)
  if (error) throw error
  const rows = (data ?? []) as unknown as ChoreRequest[]
  return {
    oneTime: rows.filter((r) => !r.is_template),
    roster: rows.filter((r) => r.is_template),
  }
}

/**
 * Which library chores currently have an outstanding request, and from whom —
 * for the badge on the parent's Chore Library tiles.
 *
 * Gives Eve the signal without a trip to the approval queue: she can see what
 * the kids are asking for while she is already editing the library.
 *
 * Keyed by chore_id, with the child display names attached. A chore both
 * children have asked for lists both.
 */
export async function getRequestedChoreNames(): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('chore_id, member:family_members!chore_assignments_assigned_to_fkey(display_name)')
    .eq('status', REQUESTED_STATUS)
    .limit(CLAIM_FETCH_LIMIT)
  if (error) throw error
  const out = new Map<string, string[]>()
  for (const row of (data ?? []) as unknown as {
    chore_id: string | null
    member: { display_name: string | null } | null
  }[]) {
    if (!row.chore_id) continue
    const name = row.member?.display_name
    if (!name) continue
    const list = out.get(row.chore_id) ?? []
    if (!list.includes(name)) list.push(name)
    out.set(row.chore_id, list)
  }
  return out
}

/**
 * Decline a claim request, either path. The note is REQUIRED — a child who
 * asked to do more work deserves a reason, and this is the same note field
 * rejectChore writes, read by the same "Recent misses" section.
 *
 * Guarded with .eq('status', REQUESTED_STATUS) so a stale queue on a second
 * tablet cannot re-reject a request a parent already approved, which would
 * silently pull an approved chore back off the child's list.
 *
 * A declined Path 2 row keeps is_active = false and so is permanently inert:
 * it can never generate an instance, and getRoster() will not show it (that
 * read excludes 'requested', and a rejected template is not a roster entry any
 * screen offers controls for).
 */
export async function declineChoreRequest(assignmentId: string, note: string): Promise<void> {
  const trimmed = note.trim()
  if (!trimmed) throw new Error('A note is required when declining a request.')
  const { error } = await supabase
    .from('chore_assignments')
    .update({ status: 'rejected', notes: trimmed })
    .eq('id', assignmentId)
    .eq('status', REQUESTED_STATUS)
  if (error) throw error
}

/**
 * Approve a claim request. ONE function, TWO payload shapes — because the two
 * paths are different row shapes, not two flavours of the same write.
 *
 * PATH 1 (isRoster = false) — status, AND A REFRESHED due_date.
 *
 *   The due_date refresh is not tidiness, it is the difference between the
 *   approval working and doing nothing at all. createOneTimeRequest stamps
 *   due_date = end of the day the child asked. A 'requested' row survives the
 *   night safely (expireLapsedAssignments filters pending/in_progress, so the
 *   sweep cannot see it) — but the moment approval sets status = 'pending'
 *   with yesterday's timestamp still on it, isLapsed() is true, ChoreCard
 *   stops offering Complete, and the very next generation pass expires the
 *   row outright. The child would watch an approved chore arrive dead.
 *
 *   So approval re-dates the chore to the end of the APPROVAL day. A request
 *   made in good faith stays valid, and the child gets a full day to do it —
 *   which is what "still valid" has to mean mechanically rather than just
 *   philosophically.
 *
 *   is_active is deliberately untouched. Nothing reads it on an instance row
 *   (dailyRosterTotal is the only consumer and it filters is_template first),
 *   so writing it would be noise implying a meaning it does not have.
 *
 * PATH 2 (isRoster = true) — status AND is_active, together.
 *
 *   is_active = true is what actually releases the template to the generator;
 *   status = 'pending' is what clears the .neq('status','requested') filter in
 *   runGeneration(). BOTH layers have to lift or the roster entry is approved
 *   and still never generates. Flipping them in ONE update means there is no
 *   instant where a row is half-approved.
 *
 *   No due_date: a template row does not have one. The generator computes each
 *   instance's due date from the chore's frequency, so the entry starts
 *   producing instances on the next parent-dashboard pass — immediate and
 *   automatic, with no further parent action.
 *
 * TWO GUARDS ON BOTH PATHS.
 *
 *   .eq('status', REQUESTED_STATUS) — a stale queue on a second tablet cannot
 *   re-approve something already resolved, which on Path 1 would silently
 *   re-date a chore the child had already finished.
 *
 *   .eq('is_template', isRoster) — the shape guard. A caller passing the wrong
 *   flag matches ZERO rows and throws, instead of writing a template-shaped
 *   payload onto an instance row (or re-dating a template that should never
 *   carry a due_date). Failing loudly is the correct direction here: a silent
 *   wrong-shape write would be invisible until the generator misbehaved days
 *   later.
 *
 * endOfDay() resolves in the FAMILY's timezone — its tz parameter defaults to
 * the module-level active zone that AuthProvider points at families.timezone.
 * No zone is named here, and none should be.
 */
export async function approveChoreRequest(
  assignmentId: string,
  isRoster: boolean
): Promise<void> {
  const patch = isRoster
    ? { status: 'pending', is_active: true }
    : { status: 'pending', due_date: endOfDay(new Date()).toISOString() }

  const { data, error } = await supabase
    .from('chore_assignments')
    .update(patch)
    .eq('id', assignmentId)
    .eq('status', REQUESTED_STATUS)
    .eq('is_template', isRoster)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    // Zero rows means the guards rejected the write: either another tablet
    // already resolved this request, or the caller's isRoster flag disagrees
    // with the stored row. Both are worth surfacing rather than reporting a
    // success the database never performed.
    throw new Error('That request was already answered — refresh to see its current state.')
  }
}

/**
 * Declined ROSTER requests (Path 2) from the last N days, for the child's
 * "Recent misses" section.
 *
 * A SEPARATE READ FROM getRejectedSince, and it has to be. That function
 * filters is_template = false and bounds on due_date — and a declined roster
 * request is a TEMPLATE row with NO due_date at all, so it matches neither
 * predicate. Without this read a child who asked to take on a regular chore
 * and was turned down would simply never be told: the row exists, the parent's
 * note is on it, and nothing on any child screen would ever show it.
 *
 * BOUNDED ON created_at, because a template row has no due_date to bound on
 * and this table has no updated_at column. created_at is the moment the child
 * ASKED rather than the moment the parent answered, so a request that sat
 * unanswered for longer than the window drops out of view even if it was
 * declined today. That is the honest limit of the columns available; closing
 * it would mean a schema change for a display detail, which is not a trade
 * worth making. Requests are answered in a day or two in practice.
 *
 * Bounded by status AND date, per the rule in CLAUDE.md — 'rejected' templates
 * accumulate slowly (one per declined request, ever), so the date window is
 * what keeps this read from growing with the family's history.
 */
export async function getDeclinedRosterRequestsSince(
  memberId: string,
  days: number = REJECTED_WINDOW_DAYS
): Promise<AssignmentWithChore[]> {
  const since = addDays(startOfDay(new Date()), -days)
  const { data, error } = await supabase
    .from('chore_assignments')
    .select('*, chore:chores(*)')
    .eq('assigned_to', memberId)
    .eq('is_template', true)
    .eq('status', 'rejected')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(CLAIM_FETCH_LIMIT)
  if (error) throw error
  return (data ?? []) as AssignmentWithChore[]
}
