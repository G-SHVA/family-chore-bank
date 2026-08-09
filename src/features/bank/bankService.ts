import { supabase } from '@/lib/supabase'

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
  net: number
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
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

export async function getMonthlyBankSummary(memberId: string): Promise<MonthlySummary> {
  const monthStart = startOfMonth(new Date())
  const txns = await getTransactionHistory(memberId)
  let earned = 0
  let spent = 0
  for (const t of txns) {
    if (new Date(t.date) < monthStart) continue
    if (t.type === 'income') earned += t.amount
    else spent += t.amount
  }
  return { earned, spent, net: earned - spent }
}
