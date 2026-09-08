import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { LOAN_PAYMENT_CATEGORY } from '@/features/expenses/expenseService'

/**
 * Loans — a parent-tracked debt a child repays out of their balance.
 *
 * A loan RECORDS A DEBT; it never transfers money. Creating one credits the
 * child nothing — the parent already bought the saxophone, and this tracks the
 * repayment. The only thing that ever moves money is an expense_applications
 * insert, and only process_loan_payments() does that.
 *
 * CHILD ISOLATION IS ENFORCED HERE, NOT IN RLS. The kiosk runs one shared
 * Supabase session as the `Kiosk` parent row, so every policy sees a parent no
 * matter which child is on the tablet. The `.eq('member_id', memberId)` filter
 * in these reads is the actual boundary. Same situation as savings goals — see
 * the RLS comment in 20260903180404_create_loans_table.sql.
 */

export interface Loan {
  id: string
  family_id: string
  member_id: string
  description: string
  principal: number
  monthly_payment: number
  balance_remaining: number
  payment_day: number
  expense_id: string | null
  status: LoanStatus
  created_by: string | null
  created_at: string | null
  /** Doubles as resolved_at: forgiveness and decline both stamp it. */
  paid_off_at: string | null
  /** Parent's reason for a decline. NULL on every other status. */
  decline_note: string | null
}

/**
 * Five statuses since the child-request flow shipped.
 *
 *   requested -> the child asked; the parent has not answered
 *   active    -> a real debt, the only status process_loan_payments() charges
 *   paid_off  -> repaid in full
 *   forgiven  -> cancelled by a parent; balance_remaining deliberately NOT zeroed
 *   declined  -> the parent said no, with a reason in decline_note
 */
export type LoanStatus = 'active' | 'paid_off' | 'forgiven' | 'requested' | 'declined'

/**
 * What the parent's Loans tab shows: everything EXCEPT an unanswered request.
 *
 * Exists so that every read states what it wants POSITIVELY. Before the
 * request flow, two call sites classified loans by negation --
 * `l.status !== 'active'` meant "resolved" -- which was correct only because
 * no other status existed. Widening the constraint would have made a pending
 * request render inside Loan History, styled as a completed loan. Adding a
 * status must never silently reclassify a row, so the negations are gone.
 *
 * 'declined' IS INCLUDED, and the distinction is the point: 'requested' is an
 * OPEN QUESTION and belongs in the approval queue, where the terms can still
 * be set. 'declined' is a TERMINAL DECISION a parent already made -- it is
 * history, and hiding it would mean the only record of a refusal lived on the
 * child's dashboard for 48 hours and then nowhere at all.
 *
 * Excluding 'requested' is the load-bearing half. Keep it.
 */
export const LOANS_TAB_STATUSES: LoanStatus[] = [
  'active',
  'paid_off',
  'forgiven',
  'declined',
]

/** Ended, one way or another. A request that was declined counts. */
export const RESOLVED_LOAN_STATUSES: LoanStatus[] = ['paid_off', 'forgiven', 'declined']

/** Every column, explicitly. `select('*')` invites surprises as the table grows. */
const LOAN_COLUMNS =
  'id, family_id, member_id, description, principal, monthly_payment, balance_remaining, payment_day, expense_id, status, created_by, created_at, paid_off_at, decline_note'

/**
 * How long a resolved loan keeps being announced to the child. Matches the
 * character-recognition window, and for the same reason: a moment the child
 * should not be able to miss, that does not become furniture.
 */
export const RESOLUTION_WINDOW_HOURS = 48

/** How much of the debt has been repaid, as a percentage. Derived, never stored. */
export function paidOffPct(loan: Pick<Loan, 'principal' | 'balance_remaining'>): number {
  if (!(loan.principal > 0)) return 0
  const paid = loan.principal - loan.balance_remaining
  return Math.max(0, Math.min(100, Math.round((paid / loan.principal) * 100)))
}

/** Currency amount repaid so far. */
export function amountPaid(loan: Pick<Loan, 'principal' | 'balance_remaining'>): number {
  return Math.max(0, loan.principal - loan.balance_remaining)
}

/**
 * The child's one active loan, or null.
 *
 * maybeSingle, not single: no loan is the normal case and must not throw.
 * The one-active-loan-per-child invariant is held by
 * idx_loans_one_active_per_member, so this cannot silently pick between two.
 */
export async function getActiveLoan(memberId: string): Promise<Loan | null> {
  const { data, error } = await supabase
    .from('loans')
    .select(LOAN_COLUMNS)
    .eq('member_id', memberId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return (data as Loan | null) ?? null
}

/**
 * A loan resolved within the last 48 hours — paid off or forgiven — so the
 * child's dashboard can acknowledge it once and then stop.
 *
 * DERIVED, NOT STORED. There is no notifications table and this does not add
 * one: the loan row already carries paid_off_at, which is all a 48-hour window
 * needs. Dismissal lives in sessionStorage on the client, exactly as character
 * recognitions do. Zero new rows.
 *
 * Ordered and limited even though a child will realistically have one: the rule
 * in CLAUDE.md is to bound every read yourself rather than trust the shape of
 * today's data.
 */
export async function getRecentlyResolvedLoan(memberId: string): Promise<Loan | null> {
  const since = new Date(Date.now() - RESOLUTION_WINDOW_HOURS * 60 * 60 * 1000)
  const { data, error } = await supabase
    .from('loans')
    .select(LOAN_COLUMNS)
    .eq('member_id', memberId)
    .in('status', ['paid_off', 'forgiven'])
    .gte('paid_off_at', since.toISOString())
    .order('paid_off_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as Loan | undefined) ?? null
}

/**
 * Everything the child Home screen needs to know about loans, in ONE read.
 *
 * getActiveLoan + getRecentlyResolvedLoan are two round trips for two rows on
 * the most frequently opened screen in the app. This asks once, with an OR:
 * the active loan, plus anything resolved inside the 48-hour window. Both are
 * bounded — one by status, one by date — so neither can grow with history.
 *
 * Kept alongside the single-purpose readers rather than replacing them: the
 * parent Loans tab wants a different shape, and a screen should not have to
 * take a payload built for another one.
 */
export interface ChildLoanState {
  active: Loan | null
  /** An unanswered request. At most one, held by idx_loans_one_requested_per_member. */
  requested: Loan | null
  /** Paid off, forgiven or DECLINED within RESOLUTION_WINDOW_HOURS. */
  resolved: Loan | null
}

/**
 * THREE-WAY, AND EVERY BRANCH MATCHES A STATUS BY NAME.
 *
 * This used to be two branches with the second written as `!== 'active'`. That
 * was correct only while three statuses existed. Adding 'requested' to the
 * constraint would have made an unanswered request satisfy the negation and
 * render as a RESOLVED loan -- the child would be told their request was paid
 * off. The fix is not a longer negation but no negation at all.
 *
 * Still ONE round trip, and every arm of the OR is bounded: 'active' and
 * 'requested' by status (both capped at one row per child by partial unique
 * indexes), the resolved arm by a 48-hour date floor. Nothing here grows with
 * history, so the child dashboard's 2-read budget is unchanged.
 */
export async function getChildLoanState(memberId: string): Promise<ChildLoanState> {
  const since = new Date(Date.now() - RESOLUTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('loans')
    .select(LOAN_COLUMNS)
    .eq('member_id', memberId)
    .or(
      `status.eq.active,status.eq.requested,` +
        `and(status.in.(${RESOLVED_LOAN_STATUSES.join(',')}),paid_off_at.gte.${since})`
    )
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  const rows = (data ?? []) as Loan[]
  return {
    active: rows.find((l) => l.status === 'active') ?? null,
    requested: rows.find((l) => l.status === 'requested') ?? null,
    // Newest first already; a child realistically has at most one.
    resolved: rows.find((l) => RESOLVED_LOAN_STATUSES.includes(l.status)) ?? null,
  }
}

/* ------------------------------------------------------------------ *
 * Parent side — Manage -> Loans
 * ------------------------------------------------------------------ */

export interface LoanWithMember extends Loan {
  // avatar_url is carried because the approval queue renders the same Avatar
  // component every other queue card uses. The parent Loans tab ignores it;
  // one shape for both consumers is cheaper than two near-identical types.
  member: { display_name: string | null; avatar_url: string | null } | null
}

/**
 * Every loan in the family, active first, newest first inside each group.
 *
 * Bounded by family and by a row limit that a family cannot realistically
 * approach (one active loan per child, plus history). Ordered so that if the
 * cap were ever reached, the rows that survive are the ones a parent needs.
 */
const FAMILY_LOAN_LIMIT = 200

export async function getFamilyLoans(familyId: string): Promise<LoanWithMember[]> {
  const { data, error } = await supabase
    .from('loans')
    .select(`${LOAN_COLUMNS}, member:family_members!loans_member_id_fkey(display_name,avatar_url)`)
    .eq('family_id', familyId)
    // EXPLICIT, and load-bearing. This read had no status filter at all, so
    // once 'requested' existed an UNANSWERED request would have appeared in
    // the parent's Loans tab -- and, because that screen split on
    // `!== 'active'`, inside Loan History styled as a completed loan. An open
    // question belongs in the approval queue. A declined one is history and
    // stays here; see LOANS_TAB_STATUSES.
    .in('status', LOANS_TAB_STATUSES)
    .order('created_at', { ascending: false })
    .limit(FAMILY_LOAN_LIMIT)
  if (error) throw error
  return (data ?? []) as unknown as LoanWithMember[]
}

/**
 * Supabase rejects with a PostgrestError — a plain object, NOT an Error — so a
 * caller's `e instanceof Error` check is false and the real reason is replaced
 * by a generic fallback. Mirrors chargeError()/awardError(); worth having on
 * anything that touches money or a unique constraint.
 */
function loanError(error: unknown, context: string): Error {
  if (error instanceof Error) return new Error(`${context}: ${error.message}`)
  const e = (error ?? {}) as { message?: string; details?: string; hint?: string; code?: string }
  // 23505 is the one-active-loan-per-child partial unique index. Translate it
  // into a sentence a parent can act on rather than a constraint name.
  if (e.code === '23505') {
    return new Error('That child already has an active loan. Pay it off or forgive it first.')
  }
  const detail = [e.message, e.details, e.hint].filter(Boolean).join(' — ')
  const code = e.code ? ` [${e.code}]` : ''
  return new Error(`${context}: ${detail || 'unknown database error'}${code}`)
}

export interface NewLoanInput {
  familyId: string
  memberId: string
  description: string
  principal: number
  monthlyPayment: number
  paymentDay?: number
  createdBy?: string | null
}

/**
 * Creates a loan and the ONE expenses row every future payment will point at.
 *
 * NO MONEY MOVES. A loan records a debt the parent has already paid for; it is
 * not a transfer, so nothing is credited and the balance trigger is never
 * touched. balance_remaining starts at the full principal.
 *
 * The expenses row carries the reserved 'loan-payment' category, which
 * getFamilyExpenses() excludes — that filter is the ENTIRE mechanism keeping
 * it out of the library, because `expenses` has no is_archived column. One row
 * per LOAN, not per payment: process_loan_payments() inserts only an
 * expense_applications row each month, pointing back here.
 *
 * Order matters. The expense is created FIRST so that loans.expense_id is
 * populated on insert — a loan row with a null expense_id is skipped by
 * process_loan_payments() and would silently never charge. If the loan insert
 * then fails (most likely the one-active-loan unique index), the orphan
 * expenses row is left in place rather than cleaned up: it is invisible to
 * every library view, and a compensating delete is a second write that can
 * fail on its own.
 */
export async function createLoan(input: NewLoanInput): Promise<Loan> {
  const description = input.description.trim()

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .insert({
      family_id: input.familyId,
      title: `${description} — loan payment`,
      amount: input.monthlyPayment,
      category: LOAN_PAYMENT_CATEGORY,
      is_template: false,
      // created_by omitted on purpose: it references auth.users(id), not
      // family_members(id). Same as createExpense and directChargeCustom.
    })
    .select('id')
    .single()
  if (expenseError) throw loanError(expenseError, 'Could not set up the loan payment')

  const { data, error } = await supabase
    .from('loans')
    .insert({
      family_id: input.familyId,
      member_id: input.memberId,
      description,
      principal: input.principal,
      monthly_payment: input.monthlyPayment,
      balance_remaining: input.principal,
      payment_day: input.paymentDay ?? 5,
      expense_id: expense.id,
      created_by: input.createdBy ?? null,
    })
    .select(LOAN_COLUMNS)
    .single()
  if (error) throw loanError(error, 'Could not create the loan')
  return data as Loan
}

/* ------------------------------------------------------------------ *
 * Child-initiated loan requests
 * ------------------------------------------------------------------ */

export interface LoanRequestInput {
  familyId: string
  memberId: string
  description: string
  principal: number
  monthlyPayment: number
}

/**
 * A child asks for a loan. NO EXPENSE ROW, NO MONEY, NO DEBT.
 *
 * The row is a REQUEST, not a loan: expense_id stays NULL, which is the second
 * independent reason process_loan_payments() can never charge it (the first is
 * its explicit `WHERE l.status = 'active'`, the third is that it CONTINUEs on a
 * null expense_id). The expenses row is created only when a parent approves,
 * by approveLoanRequest below -- so a request a parent ignores costs the
 * database exactly one row and never touches the money path.
 *
 * balance_remaining is seeded to the principal so the row satisfies the
 * table's own CHECK constraints while requested; approval recomputes it from
 * the parent's figure, which may differ from what the child asked for.
 *
 * created_by is the CHILD's member id. It references family_members(id) --
 * the app-level record of who authored the row, not a security boundary,
 * exactly as with milestones.created_by_member: the kiosk runs one shared
 * parent session and child identity is app state.
 */
export async function requestLoan(input: LoanRequestInput): Promise<Loan> {
  const { data, error } = await supabase
    .from('loans')
    .insert({
      family_id: input.familyId,
      member_id: input.memberId,
      description: input.description.trim(),
      principal: input.principal,
      monthly_payment: input.monthlyPayment,
      balance_remaining: input.principal,
      payment_day: 5,
      expense_id: null,
      status: 'requested',
      created_by: input.memberId,
    })
    .select(LOAN_COLUMNS)
    .single()
  if (error) throw loanError(error, 'Could not send the loan request')
  return data as Loan
}

/**
 * Every unanswered loan request in the family, for the parent approval queue.
 *
 * TRUNCATION SAFETY. Bounded by status alone, and 'requested' is transient by
 * construction: a parent either approves the row (it becomes 'active') or
 * declines it (it becomes 'declined'), and a partial unique index caps each
 * child at one outstanding request. This read therefore cannot grow with
 * history the way an instance-row read does -- its ceiling is the number of
 * children in the family. The limit is a payload guard, not the correctness
 * mechanism, exactly as with the claim library's four doors.
 */
const LOAN_REQUEST_LIMIT = 50

export async function getLoanRequests(familyId: string): Promise<LoanWithMember[]> {
  const { data, error } = await supabase
    .from('loans')
    .select(`${LOAN_COLUMNS}, member:family_members!loans_member_id_fkey(display_name,avatar_url)`)
    .eq('family_id', familyId)
    .eq('status', 'requested')
    .order('created_at', { ascending: true })
    .limit(LOAN_REQUEST_LIMIT)
  if (error) throw error
  return (data ?? []) as unknown as LoanWithMember[]
}

export interface ApproveLoanInput {
  loanId: string
  familyId: string
  description: string
  principal: number
  monthlyPayment: number
  paymentDay: number
}

/**
 * Approve a request ON THE PARENT'S TERMS, not the child's.
 *
 * The child's figures are a STARTING POINT the parent edits, so every value
 * here comes from the review modal rather than the stored row. This is the
 * negotiation the book describes; a one-tap approve of the child's own numbers
 * would remove the only moment in the flow where terms are actually discussed.
 *
 * ORDER MATTERS, and it mirrors createLoan for the same reason: the expenses
 * row is created FIRST so expense_id is populated in the same update that sets
 * status = 'active'. A loan that went active with a null expense_id would be
 * skipped by process_loan_payments() forever and silently never charge.
 *
 * The update is guarded with .eq('status','requested') so two parents on two
 * tablets cannot both approve the same request -- the second matches no row.
 * That guard, not the unique index, is what makes this safe: once the row is
 * 'active' it has left idx_loans_one_requested_per_member entirely.
 */
export async function approveLoanRequest(input: ApproveLoanInput): Promise<void> {
  const description = input.description.trim()

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .insert({
      family_id: input.familyId,
      title: `${description} — loan payment`,
      amount: input.monthlyPayment,
      category: LOAN_PAYMENT_CATEGORY,
      is_template: false,
    })
    .select('id')
    .single()
  if (expenseError) throw loanError(expenseError, 'Could not set up the loan payment')

  const { data, error } = await supabase
    .from('loans')
    .update({
      description,
      principal: input.principal,
      monthly_payment: input.monthlyPayment,
      balance_remaining: input.principal,
      payment_day: input.paymentDay,
      expense_id: expense.id,
      status: 'active',
    })
    .eq('id', input.loanId)
    .eq('status', 'requested')
    .select('id')
  if (error) throw loanError(error, 'Could not approve the loan')
  if (!data || data.length === 0) {
    throw new Error('That request was already answered. Refresh to see its current state.')
  }
}

/**
 * Decline a request, with the parent's reason.
 *
 * THE NOTE IS REQUIRED, unlike a chore rejection, and the asymmetry is
 * deliberate: a rejected chore is one missed credit the child can retry
 * tomorrow, while a declined loan is a financial answer they cannot act on
 * without knowing why. There is no notifications table, so decline_note IS the
 * message.
 *
 * paid_off_at is stamped because it doubles as resolved_at in this schema --
 * forgiveLoan has always set it for a loan that was never paid off. Reusing it
 * means the child's existing 48-hour derived notification window covers a
 * decline with no new column and no second code path.
 *
 * Guarded on 'requested' so a stale screen cannot overwrite an answer that has
 * already been given.
 */
export async function declineLoanRequest(loanId: string, note: string): Promise<void> {
  const trimmed = note.trim()
  if (!trimmed) throw new Error('A reason is required to decline a loan request.')
  const { data, error } = await supabase
    .from('loans')
    .update({ status: 'declined', decline_note: trimmed, paid_off_at: new Date().toISOString() })
    .eq('id', loanId)
    .eq('status', 'requested')
    .select('id')
  if (error) throw loanError(error, 'Could not decline the request')
  if (!data || data.length === 0) {
    throw new Error('That request was already answered. Refresh to see its current state.')
  }
}

/**
 * Whole months to clear a balance at a given monthly payment. Derived, never
 * stored -- the same doctrine as goal progress and the Goal Plan weekly total.
 */
export function estimatedPayoffMonths(principal: number, monthlyPayment: number): number | null {
  if (!(principal > 0) || !(monthlyPayment > 0)) return null
  return Math.ceil(principal / monthlyPayment)
}

/**
 * Forgive a loan. The debt disappears; the child is NOT credited.
 *
 * Forgiveness cancels what is owed — it does not hand over the money. Nothing
 * here touches family_members.balance, and that is the correct behaviour, not
 * an omission.
 *
 * Guarded with .eq('status','active') so a stale screen or a double-tap cannot
 * rewrite a paid_off_at that is already set, exactly like abandonGoal. Never a
 * row delete: the loan is financial history and stays readable in Loan History.
 */
export async function forgiveLoan(loanId: string): Promise<void> {
  const { error } = await supabase
    .from('loans')
    .update({ status: 'forgiven', paid_off_at: new Date().toISOString() })
    .eq('id', loanId)
    .eq('status', 'active')
  if (error) throw loanError(error, 'Could not forgive the loan')
}

export interface DeductionResult {
  loan_id: string
  member_name: string | null
  description: string | null
  amount: number
  paid_off: boolean
}

export interface DeductionSummary {
  processed: number
  totalDeducted: number
  paidOff: number
  results: DeductionResult[]
}

/**
 * Runs the monthly deductions via the process-loan-payments Edge Function.
 *
 * The RPC underneath is granted to service_role ONLY, so this cannot be called
 * straight from the browser — the function is the sole door, and it checks the
 * caller is a parent before opening it.
 *
 * fetch rather than functions.invoke() so the status code stays visible, the
 * same reason familyService calls PIN functions this way: a 403 (not a parent)
 * and a 500 (the deduction failed) need different words on screen.
 */
export async function runMonthlyDeductions(): Promise<DeductionSummary> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in.')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/process-loan-payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({}),
  })

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (!res.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : null
    if (res.status === 403) throw new Error('Only a parent can run the monthly deductions.')
    throw new Error(detail ?? 'The deductions did not run. No money moved.')
  }

  return {
    processed: Number(body.processed ?? 0),
    totalDeducted: Number(body.total_deducted ?? 0),
    paidOff: Number(body.paid_off ?? 0),
    results: (body.results ?? []) as DeductionResult[],
  }
}
