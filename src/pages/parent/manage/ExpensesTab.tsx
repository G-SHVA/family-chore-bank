import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getFamilyExpenses,
  createExpense,
  applyExpense,
  getRecentExpenseApplications,
  type ExpenseInput,
  type RecentApplication,
} from '@/features/expenses/expenseService'
import { isChild } from '@/features/family/familyService'
import type { Expense } from '@/lib/supabase'
import { CHORE_CATEGORIES } from '@/lib/constants'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency, timeAgo } from '@/lib/utils'

export default function ExpensesTab() {
  const { family, members, refresh } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'
  const children = useMemo(() => members.filter(isChild), [members])

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [recent, setRecent] = useState<RecentApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId) return
    const [e, r] = await Promise.all([getFamilyExpenses(familyId), getRecentExpenseApplications(8)])
    setExpenses(e)
    setRecent(r)
    setLoading(false)
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleApply(expenseId: string, memberId: string, title: string) {
    if (!memberId) return
    setBusy(expenseId + memberId)
    try {
      await applyExpense(expenseId, memberId)
      const child = children.find((c) => c.id === memberId)
      setToast(`Applied "${title}" to ${child?.display_name}.`)
      await Promise.all([load(), refresh()])
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  const filtered = expenses.filter((e) => e.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col gap-6">
      {toast && (
        <div className="rounded-input bg-green/15 px-4 py-3 text-sm font-semibold text-green">
          {toast}
        </div>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">Recent</h2>
          <Card className="flex flex-col gap-2">
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="text-text">
                  {r.expense_title} → {r.member_name}
                </span>
                <span className="flex items-center gap-3 text-text-muted">
                  <span className="font-semibold text-danger">
                    −{formatCurrency(r.amount, currency)}
                  </span>
                  {timeAgo(r.applied_at)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Expense library</h2>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" /> Create Expense
          </Button>
        </div>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses…"
            className="w-full rounded-input border border-white/10 bg-card py-3 pl-11 pr-4 text-text focus:border-gold focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((e) => (
            <Card key={e.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{e.title}</div>
                  <div className="text-xs uppercase tracking-wide text-text-muted">{e.category}</div>
                </div>
                <span className="shrink-0 rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger">
                  {formatCurrency(e.amount, currency)}
                </span>
              </div>
              <select
                defaultValue=""
                disabled={busy?.startsWith(e.id)}
                onChange={(ev) => {
                  if (ev.target.value) handleApply(e.id, ev.target.value, e.title)
                  ev.target.value = ''
                }}
                className="min-h-touch rounded-input border border-white/10 bg-bg px-3 text-sm text-text focus:border-gold focus:outline-none"
              >
                <option value="">Apply to…</option>
                {children.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.display_name}
                  </option>
                ))}
              </select>
            </Card>
          ))}
        </div>
      </section>

      {creating && (
        <ExpenseFormModal
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            if (familyId) await createExpense(familyId, input)
            setCreating(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

function ExpenseFormModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (input: ExpenseInput) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('0.25')
  const [category, setCategory] = useState('personal')
  const [busy, setBusy] = useState(false)
  const inputClass =
    'w-full rounded-input border border-white/10 bg-card p-3 text-text focus:border-gold focus:outline-none'

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({ title: title.trim(), amount: parseFloat(amount) || 0, category })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Create expense">
      <div className="flex flex-col gap-3">
        <label className="text-sm text-text-muted">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-text-muted">Amount ($)</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-text-muted">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {CHORE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
