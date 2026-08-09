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

/** Family expense library (only family-scoped expenses are applicable under RLS). */
export async function getFamilyExpenses(familyId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_template', false)
    .order('title')
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
