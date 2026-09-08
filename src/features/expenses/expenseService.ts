import { supabase } from '@/lib/supabase'
import type { Expense } from '@/lib/supabase'

export interface ExpenseInput {
  title: string
  amount: number
  category: string
  icon?: string | null
}

/** Create a custom family expense (added to the family's own library). */
export async function createExpense(familyId: string, input: ExpenseInput): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      family_id: familyId,
      is_template: false,
      title: input.title,
      amount: input.amount,
      category: input.category,
      icon: input.icon ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Marker category for the throwaway `expenses` rows created by a Direct Charge.
 * The mirror of DIRECT_AWARD_CATEGORY in choreService.
 *
 * Note the asymmetry with chores: `chores` carries an is_archived flag that a
 * Direct Award's one-off row also sets, but `expenses` has no such column, so
 * this category filter is the ENTIRE mechanism keeping one-off charges out of
 * the library. It is applied in getFamilyExpenses, which is the single door
 * every library view goes through (Manage -> Expenses, and Quick Add's
 * Add Expense tab). Any future read of `expenses` for library purposes must
 * exclude this category too.
 */
export const DIRECT_CHARGE_CATEGORY = 'direct-charge'

/**
 * Marker category for the penalty rows created by a Half Credit approval.
 *
 * The second reserved expense category, and it exists for the same reason as
 * the first: a Half Credit approves the chore at FULL value through the normal
 * RPC and then claws the difference back as a one-off charge, so the charge
 * needs an `expenses` row to point at and that row must never reach the library.
 *
 * Same caveat as DIRECT_CHARGE_CATEGORY, and it is worth repeating because it
 * is easy to get wrong: `expenses` has no is_archived column, so the exclusion
 * in getFamilyExpenses is the ENTIRE mechanism. There is no second layer.
 */
export const REMINDER_PENALTY_CATEGORY = 'reminder-penalty'

/**
 * Every reserved category — the one-off bookkeeping rows that are written to
 * `expenses` purely so a balance trigger has an amount to read, and which no
 * library view may ever return. Add new ones HERE rather than at a call site:
 * getFamilyExpenses is the single door both consumers go through (Manage ->
 * Expenses, and Quick Add's Add Expense tab).
 */
/**
 * Marker category for the single `expenses` row that backs a LOAN.
 *
 * The third reserved category, and the one that behaves differently from the
 * other two: those write a throwaway row per EVENT, this writes one row per
 * LOAN. Every monthly deduction is an expense_applications row pointing back
 * at it, so a loan costs one row a month instead of two — and the row is what
 * process_loan_payments() uses to answer "has this loan already been charged
 * this calendar month?".
 *
 * Same caveat as the other two, and it never stops mattering: `expenses` has
 * no is_archived column, so the exclusion in getFamilyExpenses is the ENTIRE
 * mechanism keeping this out of the library. There is no second layer.
 */
export const LOAN_PAYMENT_CATEGORY = 'loan-payment'

/**
 * Marker category for a CHILD'S PURCHASE REQUEST.
 *
 * The fourth reserved category. Like loan-payment it is one row per THING
 * rather than one per event, but unlike every other reserved category the row
 * starts life NOT YET APPLIED: expenses.status is 'requested' and no
 * expense_applications row exists, so no balance has moved. Approval flips the
 * status and applies it; a decline leaves the row inert forever.
 *
 * THE CATEGORY AND THE STATUS DO DIFFERENT JOBS and neither is redundant:
 *   category -> keeps the row out of the expense LIBRARY, permanently, including
 *               after a decline. `expenses` has no is_archived column, so the
 *               exclusion in getFamilyExpenses is the ENTIRE mechanism.
 *   status   -> tracks the request LIFECYCLE and is what getPurchaseRequests
 *               binds the approval queue to.
 */
export const PURCHASE_REQUEST_CATEGORY = 'purchase-request'

export const RESERVED_EXPENSE_CATEGORIES = [
  DIRECT_CHARGE_CATEGORY,
  REMINDER_PENALTY_CATEGORY,
  LOAN_PAYMENT_CATEGORY,
  PURCHASE_REQUEST_CATEGORY,
] as const

export interface PurchaseRequestInput {
  familyId: string
  memberId: string
  title: string
  amount: number
  reason?: string
}

export interface PurchaseRequest {
  id: string
  family_id: string | null
  title: string
  description: string | null
  amount: number
  status: string
  decline_note: string | null
  created_at: string | null
  /** The requesting child, resolved by the caller — expenses has no member FK. */
  member: { id: string; display_name: string | null; avatar_url: string | null } | null
}

/**
 * WHERE THE REQUESTING CHILD IS RECORDED, and why it is not a new column.
 *
 * `expenses` has no member_id -- an expense is a TYPE of thing, and who it was
 * applied to lives on expense_applications. A purchase request has no
 * application row yet, so there is nowhere structural to put the child.
 *
 * created_by is the wrong field: it references auth.users(id), NOT
 * family_members(id) -- the same FK trap CLAUDE.md records for chores.created_by
 * -- and under the kiosk's shared session it would resolve to the operator
 * account for every child alike.
 *
 * So the member id is encoded in the CATEGORY-SCOPED description prefix below.
 * That is deliberately cheap and deliberately reversible: it adds no column to
 * a shared table for a transient row, and it is only ever read back for rows
 * already filtered to category = 'purchase-request'. If purchase requests ever
 * become permanent history, this is the thing to migrate to a real column.
 */
const MEMBER_TAG = /^\[member:([0-9a-f-]{36})\]\n?/i

function tagDescription(memberId: string, reason?: string): string {
  return `[member:${memberId}]\n${(reason ?? '').trim()}`
}

export function parseMemberTag(description: string | null): {
  memberId: string | null
  reason: string | null
} {
  if (!description) return { memberId: null, reason: null }
  const m = description.match(MEMBER_TAG)
  if (!m) return { memberId: null, reason: description.trim() || null }
  const rest = description.replace(MEMBER_TAG, '').trim()
  return { memberId: m[1], reason: rest || null }
}

/**
 * A child asks to buy something. NO MONEY MOVES, and that is structural rather
 * than careful: `expenses` has NO TRIGGERS AT ALL (verified against pg_trigger),
 * so inserting here cannot touch a balance. The debit happens only when
 * approvePurchaseRequest inserts the expense_applications row.
 *
 * NO LIMIT ON PENDING REQUESTS, unlike loans. A child may want three things and
 * let a parent choose between them, which is a more useful conversation than
 * forcing them to pick first. The consequence is recorded honestly in
 * getPurchaseRequests: its bound is behavioural, not structural.
 */
export async function requestPurchase(input: PurchaseRequestInput): Promise<void> {
  const { error } = await supabase.from('expenses').insert({
    family_id: input.familyId,
    title: input.title.trim(),
    description: tagDescription(input.memberId, input.reason),
    amount: input.amount,
    category: PURCHASE_REQUEST_CATEGORY,
    is_template: false,
    status: 'requested',
  })
  if (error) throw chargeError(error, 'Could not send your request')
}

/**
 * Outstanding purchase requests for the approval queue.
 *
 * TRUNCATION NOTE, stated honestly because it differs from the other three
 * queue reads. This is bounded by a TRANSIENT status, so it does not grow with
 * history -- but unlike getLoanRequests there is NO unique index capping it per
 * child, because the feature deliberately allows several pending requests. Its
 * ceiling is therefore behavioural (how many things children ask for before a
 * parent answers) rather than structural.
 *
 * 100 is comfortably beyond any real backlog -- a parent facing 100 unanswered
 * purchase requests has a conversation problem, not a query problem -- and it
 * reads a DIFFERENT TABLE from chore_assignments, so it can never compete with
 * instance history for the same cap, which is the mechanism behind all five
 * prior truncation bugs.
 */
const PURCHASE_REQUEST_LIMIT = 100

export async function getPurchaseRequests(familyId: string): Promise<PurchaseRequest[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, family_id, title, description, amount, status, decline_note, created_at')
    .eq('family_id', familyId)
    .eq('status', 'requested')
    .eq('category', PURCHASE_REQUEST_CATEGORY)
    .order('created_at', { ascending: true })
    .limit(PURCHASE_REQUEST_LIMIT)
  if (error) throw error
  return (data ?? []).map((r) => ({ ...r, member: null })) as PurchaseRequest[]
}

/**
 * One child's purchase requests, for the "Pending requests" section on My Bank.
 *
 * Includes ANSWERED rows inside a 48-hour window so the child actually sees the
 * outcome -- a declined request that vanished on the next load would take the
 * parent's reason with it, which is the whole point of asking. Same derived
 * window as every other notification in this app; no notifications table.
 *
 * Filtered per child in memory rather than in the query, because the member id
 * lives in the description tag (see parseMemberTag). The read is already bounded
 * to one family's transient purchase-request rows, so the set being filtered is
 * tiny by construction.
 */
const REQUEST_VISIBILITY_HOURS = 48

export async function getChildPurchaseRequests(
  familyId: string,
  memberId: string
): Promise<PurchaseRequest[]> {
  const since = new Date(Date.now() - REQUEST_VISIBILITY_HOURS * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('expenses')
    .select('id, family_id, title, description, amount, status, decline_note, created_at')
    .eq('family_id', familyId)
    .eq('category', PURCHASE_REQUEST_CATEGORY)
    .or(`status.eq.requested,created_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(PURCHASE_REQUEST_LIMIT)
  if (error) throw error
  return ((data ?? []) as PurchaseRequest[]).filter(
    (r) => parseMemberTag(r.description).memberId === memberId
  )
}

/**
 * Approve a purchase: flip the status, then apply it.
 *
 * ORDER MATTERS AND IS THE OPPOSITE OF THE LOAN PATH. The status flip is
 * guarded with .eq('status','requested'), so it is the CONCURRENCY GATE: two
 * parents on two tablets cannot both approve, because the second update matches
 * no row and returns before any money moves. Applying first and flipping second
 * would let both tablets charge the child.
 *
 * apply_expense inserts the expense_applications row; its AFTER INSERT trigger
 * does the debit. No app code touches family_members.balance.
 *
 * OVERDRAFTS ARE ALLOWED BY DESIGN. A parent may knowingly take a child
 * negative -- the UI warns, it never blocks. Same rule as Direct Charge.
 */
export async function approvePurchaseRequest(
  expenseId: string,
  memberId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('expenses')
    .update({ status: 'approved' })
    .eq('id', expenseId)
    .eq('status', 'requested')
    .select('id')
  if (error) throw chargeError(error, 'Could not approve the purchase')
  if (!data || data.length === 0) {
    throw new Error('That request was already answered. Refresh to see its current state.')
  }
  await applyExpense(expenseId, memberId)
}

/**
 * Decline a purchase. The note is OPTIONAL, unlike a loan decline.
 *
 * A purchase decline is lighter weight: the child keeps their money and can ask
 * again tomorrow. A loan decline commits nothing but forecloses a plan, so it
 * earns the required sentence. Matching the chore-rejection rule rather than
 * the loan one is the deliberate choice here.
 */
export async function declinePurchaseRequest(expenseId: string, note?: string): Promise<void> {
  const { data, error } = await supabase
    .from('expenses')
    .update({ status: 'declined', decline_note: note?.trim() || null })
    .eq('id', expenseId)
    .eq('status', 'requested')
    .select('id')
  if (error) throw chargeError(error, 'Could not decline the request')
  if (!data || data.length === 0) {
    throw new Error('That request was already answered. Refresh to see its current state.')
  }
}

/** Family expense library (only family-scoped expenses are applicable under RLS). */
export async function getFamilyExpenses(familyId: string): Promise<Expense[]> {
  let query = supabase
    .from('expenses')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_template', false)
  // One-off bookkeeping rows are not library expenses. Chained .neq() rather
  // than a single `not in` list: it is the same AND, with no PostgREST list
  // quoting to get wrong on a category containing a hyphen.
  for (const category of RESERVED_EXPENSE_CATEGORIES) {
    query = query.neq('category', category)
  }
  const { data, error } = await query.order('title')
  if (error) throw error
  return data ?? []
}

/**
 * Apply an expense to a child — atomic balance deduction via RPC.
 * Negative balances are allowed (the child "owes").
 */
export async function applyExpense(expenseId: string, memberId: string): Promise<void> {
  const { error } = await supabase.rpc('apply_expense', {
    p_expense_id: expenseId,
    p_member_id: memberId,
  })
  if (error) throw error
}

export interface RecentApplication {
  id: string
  amount: number
  applied_at: string | null
  member_name: string | null
  expense_title: string | null
}

/** Recent expense applications across the family (for the parent overview). */
export async function getRecentExpenseApplications(limit = 10): Promise<RecentApplication[]> {
  const { data, error } = await supabase
    .from('expense_applications')
    .select(
      'id, amount, applied_at, expense:expenses(title), member:family_members!expense_applications_family_member_id_fkey(display_name)'
    )
    .order('applied_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  type Row = {
    id: string
    amount: number
    applied_at: string | null
    expense: { title: string | null } | null
    member: { display_name: string | null } | null
  }
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    amount: r.amount,
    applied_at: r.applied_at,
    member_name: r.member?.display_name ?? null,
    expense_title: r.expense?.title ?? null,
  }))
}

/**
 * Supabase rejects with a PostgrestError - a plain object, NOT an Error - so a
 * caller's `e instanceof Error` check is false and the real reason is replaced
 * by a generic fallback. Tolerable on a read; not on a money path, where the
 * message is the only clue the parent gets about why the balance did not move.
 *
 * Mirrors awardError() in choreService, and is scoped the same way: Direct
 * Charge only. The rest of this file keeps the existing convention.
 */
function chargeError(error: unknown, context: string): Error {
  if (error instanceof Error) return new Error(`${context}: ${error.message}`)
  const e = (error ?? {}) as { message?: string; details?: string; hint?: string; code?: string }
  const detail = [e.message, e.details, e.hint].filter(Boolean).join(' — ')
  const code = e.code ? ` [${e.code}]` : ''
  return new Error(`${context}: ${detail || 'unknown database error'}${code}`)
}

/**
 * Direct Charge: debit a child for a one-off purchase with no library entry.
 *
 * The exact mirror of directAwardCustom. expense_applications.expense_id is NOT
 * NULL and both the balance trigger and the bank ledger read the title and
 * amount off the joined `expenses` row, so the charge needs an expense to point
 * at. It gets a marker-category row that getFamilyExpenses never returns.
 *
 * The money is NEVER touched here. expense_application_balance_update is an
 * AFTER INSERT trigger on expense_applications; the apply_expense RPC - the
 * same call the Add Expense tab makes - does the insert, and the trigger does
 * the debit. Negative balances are allowed by design: a parent may deliberately
 * overdraft a child as a teaching moment.
 *
 * The optional note is stored on expenses.description. expense_applications has
 * no notes column, and adding one would be a schema change; the description
 * rides along on the row the ledger already joins.
 *
 * If the RPC leg fails the orphan expenses row is left in place rather than
 * cleaned up: it is invisible to every library view (marker category) and
 * deleting it would be a second write that can fail in its own right. The
 * thrown error says plainly that no money moved.
 */
export async function directChargeCustom(
  familyId: string,
  memberId: string,
  title: string,
  amount: number,
  notes?: string | null,
  // The Half Credit penalty rides this same path and differs only in which
  // reserved category the one-off row carries, so it passes its own rather
  // than duplicating the insert-then-apply sequence. Every existing caller
  // omits it and behaves exactly as before.
  category: (typeof RESERVED_EXPENSE_CATEGORIES)[number] = DIRECT_CHARGE_CATEGORY
): Promise<void> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      family_id: familyId,
      title: title.trim(),
      amount,
      category,
      description: notes?.trim() || null,
      is_template: false,
      // created_by is deliberately omitted: it references auth.users(id), not
      // family_members(id), and createExpense leaves it null the same way.
    })
    .select('id')
    .single()
  if (error) throw chargeError(error, 'Could not create the one-off charge')

  const { error: rpcError } = await supabase.rpc('apply_expense', {
    p_expense_id: data.id,
    p_member_id: memberId,
  })
  if (rpcError) throw chargeError(rpcError, 'The charge was not applied and no money moved')
}
