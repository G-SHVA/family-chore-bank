import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Check, X, Clock, CheckCircle2, Flame } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  generateDailyAssignments,
  getPendingApprovals,
  approveChore,
  rejectChore,
  quickAssignChore,
  getFamilyChores,
  getFamilyChildSummaries,
  type PendingApproval,
  type ChildSummary,
} from '@/features/chores/choreService'
import {
  getFamilyExpenses,
  applyExpense,
  getRecentExpenseApplications,
} from '@/features/expenses/expenseService'
import { getActiveMembers, isChild } from '@/features/family/familyService'
import type { Chore, Expense, FamilyMember } from '@/lib/supabase'
import { BalanceDisplay } from '@/components/shared/BalanceDisplay'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn, formatCurrency, initials, timeAgo } from '@/lib/utils'

export default function ParentDashboard() {
  const { activeMember, family, refresh } = useAuth()
  const currency = family?.currency ?? 'USD'
  const familyId = family?.id

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [summaries, setSummaries] = useState<ChildSummary[]>([])
  const [chores, setChores] = useState<Chore[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [recentExpenseCount, setRecentExpenseCount] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null)
  // Synchronous guard so a double-tap can't dispatch two approvals for one chore.
  const inFlight = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!familyId) return
    try {
      setError(null)
      // Self-healing: expire lapsed chores and create this period's instances,
      // so the roster stays live even if no child has opened the app today.
      await generateDailyAssignments()
      const members = await getActiveMembers(familyId)
      const children = members.filter(isChild)
      const [pa, sums, ch, ex, recent] = await Promise.all([
        getPendingApprovals(),
        getFamilyChildSummaries(children),
        getFamilyChores(familyId),
        getFamilyExpenses(familyId),
        getRecentExpenseApplications(50),
      ])
      setApprovals(pa)
      setSummaries(sums)
      setChores(ch)
      setExpenses(ex)
      setRecentExpenseCount(recent.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  const totalBalance = useMemo(
    () => summaries.reduce((sum, s) => sum + (s.member.balance ?? 0), 0),
    [summaries]
  )

  async function handleApprove(a: PendingApproval) {
    if (!activeMember) return
    if (inFlight.current.has(a.id)) return // ignore duplicate taps
    inFlight.current.add(a.id)
    setBusyId(a.id)
    try {
      await approveChore(a.id, activeMember.id)
      await Promise.all([load(), refresh()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed.')
    } finally {
      inFlight.current.delete(a.id)
      setBusyId(null)
    }
  }

  async function handleReject(note: string) {
    if (!rejecting) return
    const a = rejecting
    setBusyId(a.id)
    setRejecting(null)
    try {
      await rejectChore(a.id, note)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
        <span className="text-text-muted">Loading dashboard…</span>
      </div>
    )
  }

  const children = summaries.map((s) => s.member)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="spine pb-4 text-4xl">Parent Dashboard</h1>

      {error && (
        <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-danger">{error}</div>
      )}

      {/* Overview stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <div className="label-caps text-[11px] text-text-muted">Total family balance</div>
          <BalanceDisplay
            amount={totalBalance}
            currency={currency}
            className="mt-2 block text-4xl text-green"
          />
        </Card>
        <Card>
          <div className="label-caps text-[11px] text-text-muted">Pending approvals</div>
          <div className="display mt-2 text-4xl text-antique">{approvals.length}</div>
        </Card>
        <Card>
          <div className="label-caps text-[11px] text-text-muted">Expenses applied</div>
          <div className="display mt-2 text-4xl text-text">{recentExpenseCount}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Approvals queue (prominent) */}
        <section className="lg:col-span-3">
          <h2 className="mb-3 text-2xl">
            Pending Approvals{' '}
            {approvals.length > 0 && (
              <span className="label-caps ml-1 rounded-input border border-antique/50 px-2 py-0.5 text-xs text-antique">
                {approvals.length}
              </span>
            )}
          </h2>
          {approvals.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-12 text-center text-text-muted">
              <CheckCircle2 className="h-10 w-10 text-green" />
              All caught up — nothing to approve.
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {approvals.map((a) => (
                  <motion.div
                    key={a.id}
                    layout
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar member={a.member} />
                        <div>
                          <div className="display text-lg text-text">{a.chore?.title}</div>
                          <div className="text-sm text-text-muted">
                            {a.member?.display_name} ·{' '}
                            <span className="font-semibold text-antique">
                              {formatCurrency(a.chore?.value ?? 0, currency)}
                            </span>
                            <span className="ml-2 inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" /> {timeAgo(a.completed_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="lg"
                          variant="primaryList"
                          onClick={() => handleApprove(a)}
                          disabled={busyId === a.id}
                        >
                          <Check className="h-5 w-5" /> Approve
                        </Button>
                        <Button
                          size="lg"
                          variant="danger"
                          onClick={() => setRejecting(a)}
                          disabled={busyId === a.id}
                        >
                          <X className="h-5 w-5" /> Reject
                        </Button>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Right column: child cards + quick add */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section>
            <h2 className="mb-3 text-2xl">Children</h2>
            <div className="flex flex-col gap-3">
              {summaries.map((s) => (
                <Card key={s.member.id}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar member={s.member} />
                      <div className="display text-lg text-text">{s.member.display_name}</div>
                    </div>
                    <BalanceDisplay
                      amount={s.member.balance ?? 0}
                      currency={currency}
                      className="text-2xl text-green"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-sm text-text-muted">
                    <span>
                      This week:{' '}
                      <span className="font-semibold text-text">
                        {formatCurrency(s.weeklyEarnings, currency)}
                      </span>
                    </span>
                    {s.currentStreak > 0 && (
                      <span className="flex items-center gap-1 text-antique">
                        <Flame className="h-4 w-4" /> {s.currentStreak}d
                      </span>
                    )}
                    {s.pendingCount > 0 && <span>{s.pendingCount} pending</span>}
                  </div>
                </Card>
              ))}
            </div>
          </section>

          <QuickAdd
            children={children}
            chores={chores}
            expenses={expenses}
            currency={currency}
            assignedBy={activeMember?.id ?? ''}
            onDone={() => Promise.all([load(), refresh()])}
          />
        </div>
      </div>

      {/* Reject modal */}
      <RejectModal
        approval={rejecting}
        onClose={() => setRejecting(null)}
        onSubmit={handleReject}
      />
    </div>
  )
}

function Avatar({ member }: { member: { display_name: string | null; avatar_url: string | null } | null }) {
  if (member?.avatar_url) {
    return <img src={member.avatar_url} alt="" className="h-11 w-11 rounded-full border border-antique/40 object-cover" />
  }
  return (
    <div className="display flex h-11 w-11 items-center justify-center rounded-full border border-antique/40 bg-wash text-antique">
      {initials(member?.display_name)}
    </div>
  )
}

function RejectModal({
  approval,
  onClose,
  onSubmit,
}: {
  approval: PendingApproval | null
  onClose: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (approval) setNote('')
  }, [approval])
  return (
    <Modal open={!!approval} onClose={onClose} title="Reject chore">
      <p className="mb-3 text-text-muted">
        Let {approval?.member?.display_name} know why “{approval?.chore?.title}” wasn’t approved.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="e.g. Please redo — the room still needs tidying."
        className="w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => onSubmit(note.trim())} disabled={!note.trim()}>
          Reject with note
        </Button>
      </div>
    </Modal>
  )
}

function QuickAdd({
  children,
  chores,
  expenses,
  currency,
  assignedBy,
  onDone,
}: {
  children: FamilyMember[]
  chores: Chore[]
  expenses: Expense[]
  currency: string
  assignedBy: string
  onDone: () => Promise<unknown>
}) {
  const [mode, setMode] = useState<'chore' | 'expense'>('chore')
  const [childId, setChildId] = useState('')
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  async function submit() {
    if (!childId || !itemId) return
    setBusy(true)
    setDone(null)
    try {
      if (mode === 'chore') await quickAssignChore(itemId, childId, assignedBy)
      else await applyExpense(itemId, childId)
      await onDone()
      setDone(mode === 'chore' ? 'Chore assigned to the roster.' : 'Expense applied.')
      setItemId('')
    } finally {
      setBusy(false)
    }
  }

  const selectClass =
    'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'

  return (
    <section>
      <h2 className="mb-3 text-2xl">Quick Add</h2>
      <Card className="flex flex-col gap-3">
        <div className="flex gap-1 rounded-input border border-line bg-deep p-1">
          {(['chore', 'expense'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setItemId('')
                setDone(null)
              }}
              className={cn(
                'label-caps flex-1 rounded-input py-2 text-[11px]',
                mode === m ? 'bg-wash text-antique' : 'text-text-muted'
              )}
            >
              {m === 'chore' ? 'Assign Chore' : 'Add Expense'}
            </button>
          ))}
        </div>

        <select value={childId} onChange={(e) => setChildId(e.target.value)} className={selectClass}>
          <option value="">Select child…</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </select>

        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={selectClass}>
          <option value="">{mode === 'chore' ? 'Select chore…' : 'Select expense…'}</option>
          {mode === 'chore'
            ? chores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {formatCurrency(c.value, currency)} · {c.frequency}
                </option>
              ))
            : expenses.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {formatCurrency(e.amount, currency)}
                </option>
              ))}
        </select>

        <Button variant="accent" fullWidth size="lg" onClick={submit} disabled={!childId || !itemId || busy}>
          {busy ? 'Working…' : mode === 'chore' ? 'Assign Chore' : 'Apply Expense'}
        </Button>
        {done && <p className="text-center text-sm text-green">{done}</p>}
      </Card>
    </section>
  )
}
