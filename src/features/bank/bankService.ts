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
 * Builds the child's ledger: approved chores (income) + applied expenses
 * (expense), sorted newest-first with a running balance.
 *
 * DEFERRED, NOT CALLED ON LOAD. My Bank fetches this only when the child first
 * expands Transaction History — see TransactionHistorySection in Bank.tsx.
 * Nothing above that section depends on it any more.
 *
 * STILL truncation-class instance 5: both selects below are unbounded, so the
 * running balance is a best effort over whatever PostgREST returns. Deferring
 * the read removes its cost from every load; it does NOT fix the bound. The
 * balance card no longer rides on it, which is the part that mattered.
 */
export async function getTransactionHistory(memberId: string): Promise<Transaction[]> {
  const [choresRes, expensesRes] = await Promise.all([
    supabase
      .from('chore_assignments')
      .select('id, approved_at, chore:chores(title, value)')
      .eq('assigned_to', memberId)
      .eq('is_template', false)
      .eq('status', 'approved')
      .not('approved_at', 'is', null),
    supabase
      .from('expense_applications')
      .select('id, applied_at, amount, expense:expenses(title)')
      .eq('family_member_id', memberId),
  ])
  if (choresRes.error) throw choresRes.error
  if (expensesRes.error) throw expensesRes.error

  type ChoreRow = { id: string; approved_at: string | null; chore: { title: string | null; value: number } | null }
  type ExpRow = { id: string; applied_at: string | null; amount: number; expense: { title: string | null } | null }

  const income = ((choresRes.data ?? []) as unknown as ChoreRow[]).map((r) => ({
    id: `c_${r.id}`,
    date: r.approved_at as string,
    description: r.chore?.title ?? 'Chore',
    type: 'income' as const,
    amount: r.chore?.value ?? 0,
  }))
  const expenses = ((expensesRes.data ?? []) as unknown as ExpRow[]).map((r) => ({
    id: `e_${r.id}`,
    date: (r.applied_at ?? new Date(0).toISOString()) as string,
    description: r.expense?.title ?? 'Expense',
    type: 'expense' as const,
    amount: r.amount,
  }))

  // Oldest -> newest to compute running balance, then reverse for display.
  const merged = [...income, ...expenses].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )
  let running = 0
  const withRunning = merged.map((t) => {
    running += t.type === 'income' ? t.amount : -t.amount
    return { ...t, runningBalance: running }
  })
  return withRunning.reverse()
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
