import { supabase } from '@/lib/supabase'
import { getEarningsSummary } from '@/features/chores/choreService'
// The month boundary must match the one member_earnings_summary() uses
// server-side; both now resolve in the family's timezone.
import { startOfMonth } from '@/lib/time'

export interface Transaction {
  id: string
  date: string // ISO
  description: string
  type: 'income' | 'expense'
  amount: number // always positive; sign implied by type
  runningBalance: number
}

export interface MonthlySummary {
  earned: number
  spent: number
  /** earned - spent. Negative when the child outspent what they brought in. */
  net: number
}

/**
 * The child's CURRENT BALANCE, read from the authoritative column.
 *
 * WHY THIS EXISTS AT ALL. My Bank used to take its headline figure from
 * `getTransactionHistory()[0].runningBalance` — a client-side sum of the ledger
 * walked forward from zero. CLAUDE.md documents the trap that creates: the Bank
 * screen and the child dashboard read two different sources for one number and
 * can therefore disagree, and any sanctioned write moves BOTH by the same
 * amount, so a divergence between them cannot be closed by crediting or
 * charging the child.
 *
 * It is also the figure most exposed to truncation-class instance 5.
 * getTransactionHistory issues two UNBOUNDED selects; the moment a child's
 * history outgrows a PostgREST page the ledger starts omitting old rows AND the
 * running balance summed from them is silently wrong — and it was wrong in the
 * largest text on the screen.
 *
 * This is one indexed single-row read of the same trigger-managed column
 * getChildDashboard() already uses, so the two screens now agree by
 * construction. It costs a query but REPLACES an unbounded one: deferring the
 * ledger to first expand is only possible because the balance no longer
 * depends on it.
 */
export async function getMemberBalance(memberId: string): Promise<number> {
  const { data, error } = await supabase
    .from('family_members')
    .select('balance')
    .eq('id', memberId)
    .single()
  if (error) throw error
  return data?.balance ?? 0
}

/**
 * Payload guard on EACH of the ledger's two selects. Not the correctness
 * mechanism: bounded ranges are bounded by `since`, and All is made honest by
 * the horizon trim below. This is the cap CLAUDE.md's standing rule requires
 * every read to state for itself — an invisible server-side max-rows is worse
 * than a visible one.
 */
export const LEDGER_CAP = 500

export interface LedgerPage {
  /** Newest first. Every row's runningBalance is exact — see the anchor note. */
  transactions: Transaction[]
  /** True when a select hit LEDGER_CAP and rows older than the safe horizon were dropped. */
  truncated: boolean
}

export interface LedgerOptions {
  /** Lower bound on the window, or null for "All" (capped, newest first). */
  since: Date | null
  /** family_members.balance — the anchor the running balance walks back from. */
  balance: number
}

type ChoreRow = { id: string; approved_at: string | null; chore: { title: string | null; value: number } | null }
type ExpRow = { id: string; applied_at: string | null; amount: number; expense: { title: string | null } | null }
type Unbalanced = Omit<Transaction, 'runningBalance'>

/**
 * Builds the child's ledger: approved chores (income) + applied expenses
 * (expense), newest first, with a running balance on every row.
 *
 * TRUNCATION-CLASS INSTANCE 5, CLOSED 2026-09-21. Both selects used to be
 * unbounded and the running balance was summed forward from $0 over whatever
 * PostgREST returned. Now:
 *
 * TWO TIERS, ONE FUNCTION. Bank.tsx calls this with `since` set to the start
 * of LAST month on first expand — one date-bounded read that covers This Week,
 * This Month and Last Month, so switching between those three still costs no
 * read. It calls again with `since: null` only when the child first taps All.
 *
 * ORDERED DESC AND CAPPED, so when the cap bites it is the OLDEST rows that
 * fall off, never the ones the child is looking for.
 *
 * THE HORIZON TRIM is what makes a capped result honest rather than merely
 * bounded. The two selects are capped independently: if income hit LEDGER_CAP
 * at some date H and expenses did not, rows older than H would show expenses
 * with their income neighbours missing, and a running balance walked across
 * them would be wrong. So when either select returns exactly LEDGER_CAP rows,
 * the merged list is cut to rows STRICTLY NEWER than the newest such horizon.
 * Strictly, because rows sharing the boundary timestamp may have been split by
 * the cap. What survives is complete by construction.
 *
 * THE RUNNING BALANCE IS ANCHORED TO family_members.balance AND WALKED
 * BACKWARDS, not summed forward from zero. The newest row reads the balance
 * card's figure exactly; each older row is the newer row's figure minus the
 * newer row's effect. This is what lets a capped window carry correct figures
 * on every row it shows: the anchor is known regardless of how much older
 * history was never fetched. The trade-off, accepted deliberately: should the
 * ledger and the balance ever diverge again (see the 2026-09-03 reconciliation
 * in CLAUDE.md), the gap surfaces as a non-zero implied OPENING balance at the
 * bottom of All, not as a mismatch at the top. The child's trust anchor is the
 * balance card; the top of the ledger must always agree with it.
 */
export async function getTransactionHistory(
  memberId: string,
  opts: LedgerOptions
): Promise<LedgerPage> {
  let choresQ = supabase
    .from('chore_assignments')
    .select('id, approved_at, chore:chores(title, value)')
    .eq('assigned_to', memberId)
    .eq('is_template', false)
    .eq('status', 'approved')
    .not('approved_at', 'is', null)
    .order('approved_at', { ascending: false })
    .limit(LEDGER_CAP)
  let expensesQ = supabase
    .from('expense_applications')
    .select('id, applied_at, amount, expense:expenses(title)')
    .eq('family_member_id', memberId)
    .not('applied_at', 'is', null)
    .order('applied_at', { ascending: false })
    .limit(LEDGER_CAP)
  if (opts.since) {
    const iso = opts.since.toISOString()
    choresQ = choresQ.gte('approved_at', iso)
    expensesQ = expensesQ.gte('applied_at', iso)
  }

  const [choresRes, expensesRes] = await Promise.all([choresQ, expensesQ])
  if (choresRes.error) throw choresRes.error
  if (expensesRes.error) throw expensesRes.error

  const income: Unbalanced[] = ((choresRes.data ?? []) as unknown as ChoreRow[]).map((r) => ({
    id: `c_${r.id}`,
    date: r.approved_at as string,
    description: r.chore?.title ?? 'Chore',
    type: 'income' as const,
    amount: r.chore?.value ?? 0,
  }))
  const expenses: Unbalanced[] = ((expensesRes.data ?? []) as unknown as ExpRow[]).map((r) => ({
    id: `e_${r.id}`,
    date: r.applied_at as string,
    description: r.expense?.title ?? 'Expense',
    type: 'expense' as const,
    amount: r.amount,
  }))

  // Each select is ordered DESC, so its LAST row is the oldest it returned.
  // A select that filled its cap is complete only for rows newer than that.
  const horizons: number[] = []
  if (income.length === LEDGER_CAP) horizons.push(new Date(income[income.length - 1].date).getTime())
  if (expenses.length === LEDGER_CAP) horizons.push(new Date(expenses[expenses.length - 1].date).getTime())
  const horizon = horizons.length ? Math.max(...horizons) : null

  const merged = [...income, ...expenses]
    .filter((t) => horizon === null || new Date(t.date).getTime() > horizon)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Newest -> oldest, starting from the authoritative balance. Rounded to the
  // cent at each step so 168 float subtractions cannot drift a displayed figure.
  let running = opts.balance
  const transactions: Transaction[] = merged.map((t) => {
    const row = { ...t, runningBalance: running }
    running = Math.round((running - (t.type === 'income' ? t.amount : -t.amount)) * 100) / 100
    return row
  })

  return { transactions, truncated: horizon !== null }
}

/**
 * Money in and money out for the CURRENT CALENDAR MONTH.
 *
 * Both figures are bounded reads, and that is not incidental. The previous
 * implementation derived them by walking getTransactionHistory() — two
 * UNBOUNDED selects — and filtering client-side. That is exactly the failure
 * CLAUDE.md documents: PostgREST silently caps an unbounded read, so once a
 * child accumulates enough history the month totals quietly start reporting a
 * prefix of the truth. Wrong money, drifting between reloads, with no error.
 *
 * Now:
 *   earned — member_earnings_summary(), a SUM computed in Postgres. No rows
 *            cross the wire at all, so there is nothing to truncate.
 *   spent  — expense_applications bounded to the month window. One month of one
 *            child's expenses cannot approach a page, and the bound is explicit
 *            rather than implied by a limit.
 */
export async function getMonthlyBankSummary(memberId: string): Promise<MonthlySummary> {
  const monthStart = startOfMonth(new Date())

  const [earnings, expensesRes] = await Promise.all([
    getEarningsSummary(memberId, monthStart),
    supabase
      .from('expense_applications')
      .select('amount')
      .eq('family_member_id', memberId)
      .gte('applied_at', monthStart.toISOString())
      .not('applied_at', 'is', null),
  ])
  if (expensesRes.error) throw expensesRes.error

  const earned = earnings.totalEarned
  const spent = ((expensesRes.data ?? []) as { amount: number }[]).reduce(
    (sum, r) => sum + r.amount,
    0
  )
  return { earned, spent, net: earned - spent }
}
