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

/** Family expense library (only family-scoped expenses are applicable under RLS). */
export async function getFamilyExpenses(familyId: string): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_template', false)
    // One-off Direct Charge rows are bookkeeping, not library expenses.
    .neq('category', DIRECT_CHARGE_CATEGORY)
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
  notes?: string | null
): Promise<void> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      family_id: familyId,
      title: title.trim(),
      amount,
      category: DIRECT_CHARGE_CATEGORY,
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
