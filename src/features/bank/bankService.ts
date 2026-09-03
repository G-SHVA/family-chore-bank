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
 * Builds the child's ledger: approved chores (income) + applied expenses
 * (expense), sorted newest-first with a running balance.
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
