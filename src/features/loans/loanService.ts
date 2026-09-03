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
  status: 'active' | 'paid_off' | 'forgiven'
  created_by: string | null
  created_at: string | null
  paid_off_at: string | null
}

/** Every column, explicitly. `select('*')` invites surprises as the table grows. */
const LOAN_COLUMNS =
  'id, family_id, member_id, description, principal, monthly_payment, balance_remaining, payment_day, expense_id, status, created_by, created_at, paid_off_at'

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
  /** Paid off or forgiven within RESOLUTION_WINDOW_HOURS. */
  resolved: Loan | null
}

export async function getChildLoanState(memberId: string): Promise<ChildLoanState> {
  const since = new Date(Date.now() - RESOLUTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('loans')
    .select(LOAN_COLUMNS)
    .eq('member_id', memberId)
    .or(`status.eq.active,and(status.in.(paid_off,forgiven),paid_off_at.gte.${since})`)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  const rows = (data ?? []) as Loan[]
  return {
    active: rows.find((l) => l.status === 'active') ?? null,
    // Newest first already; a child realistically has at most one.
    resolved: rows.find((l) => l.status !== 'active') ?? null,
  }
}

/* ------------------------------------------------------------------ *
 * Parent side — Manage -> Loans
 * ------------------------------------------------------------------ */

export interface LoanWithMember extends Loan {
  member: { display_name: string | null } | null
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
    .select(`${LOAN_COLUMNS}, member:family_members!loans_member_id_fkey(display_name)`)
    .eq('family_id', familyId)
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
