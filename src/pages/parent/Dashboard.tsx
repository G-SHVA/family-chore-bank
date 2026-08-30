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
  directAwardFromLibrary,
  directAwardCustom,
  getFamilyChores,
  getFamilyChildSummaries,
  getRoster,
  dailyRosterTotal,
  type PendingApproval,
  type ChildSummary,
  type RosterEntry,
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
  const [roster, setRoster] = useState<RosterEntry[]>([])
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
      const [pa, sums, ch, ex, recent, ros] = await Promise.all([
        getPendingApprovals(),
        getFamilyChildSummaries(children),
        getFamilyChores(familyId),
        getFamilyExpenses(familyId),
        getRecentExpenseApplications(50),
        // Powers the Quick Add daily-total readout: what a child's day is
        // already worth before this assignment lands on it.
        getRoster(),
      ])
      setApprovals(pa)
      setSummaries(sums)
      setChores(ch)
      setExpenses(ex)
      setRecentExpenseCount(recent.length)
      setRoster(ros)
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
    <div className="flex h-full flex-col gap-6 overflow-hidden">
      <h1 className="spine shrink-0 pb-4 text-4xl">Parent Dashboard</h1>

      {error && (
        <div className="shrink-0 rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-danger">{error}</div>
      )}

      {/* Zone 1 — static header. Overview stats never scroll. */}
      <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3">
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

      <div className="scroll-skin grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto pr-2 lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:pr-0">
        {/* Zone 2 — approvals queue scrolls in its own contained area. */}
        <section className="flex flex-col lg:col-span-3 lg:min-h-0">
          <h2 className="mb-3 shrink-0 text-2xl">
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
            <div className="scroll-skin flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
              <AnimatePresence initial={false}>
                {approvals.map((a) => (
                  <motion.div
                    key={a.id}
                    layout
                    exit={{ opacity: 0, x: 40 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar member={a.member} />
                        <div className="min-w-0">
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
                      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
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
        <div className="scroll-skin flex flex-col gap-6 lg:col-span-2 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
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
            roster={roster}
            currency={currency}
            familyId={familyId ?? ''}
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
      <p className="mb-4 text-text-muted">
        “{approval?.chore?.title}” will be sent back to {approval?.member?.display_name}.
      </p>
      <label htmlFor="reject-note" className="label-caps mb-2 block text-[11px] text-text-muted">
        Add a note (optional)
      </label>
      <textarea
        id="reject-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Let them know what needs improvement..."
        className="w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {/* No note is a valid rejection — the button never blocks on one. */}
        <Button variant="danger" onClick={() => onSubmit(note.trim())}>
          {note.trim() ? 'Reject with note' : 'Reject'}
        </Button>
      </div>
    </Modal>
  )
}

function QuickAdd({
  children,
  chores,
  expenses,
  roster,
  currency,
  familyId,
  assignedBy,
  onDone,
}: {
  children: FamilyMember[]
  chores: Chore[]
  expenses: Expense[]
  roster: RosterEntry[]
  currency: string
  familyId: string
  assignedBy: string
  onDone: () => Promise<unknown>
}) {
  const [mode, setMode] = useState<'chore' | 'expense' | 'award'>('chore')
  const [childId, setChildId] = useState('')
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Direct Award state, kept separate from itemId so switching tabs never
  // carries a half-filled award over into an assignment.
  const [source, setSource] = useState<'library' | 'custom'>('library')
  const [awardChoreId, setAwardChoreId] = useState('')
  // Held as text, not a number: a number state can't represent "the field is
  // empty", so backspacing snapped straight back to 1 and the parent could
  // never clear it (they had to select-all and overtype).
  const [quantity, setQuantity] = useState('1')
  const [customTitle, setCustomTitle] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [note, setNote] = useState('')

  const awardChore = chores.find((c) => c.id === awardChoreId)
  const parsedAmount = Number.parseFloat(customAmount)
  const parsedQuantity = Number.parseInt(quantity, 10)
  const quantityValid = Number.isFinite(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10
  const customValid =
    customTitle.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0
  const awardTotal =
    source === 'library'
      ? (awardChore?.value ?? 0) * (quantityValid ? parsedQuantity : 0)
      : customValid
        ? parsedAmount
        : 0

  /**
   * The single unmet requirement blocking the Award button, or null when it is
   * ready. Drives BOTH the disabled state and the message under the button.
   *
   * This exists because a disabled button was the whole of the bug: the panel
   * would print "Total award: $5.55" next to a gold Award button that silently
   * did nothing, with no clue that the child dropdown up at the top of a
   * scrolled panel had never been set. Money buttons must say why they refuse.
   */
  const awardBlockReason: string | null = !childId
    ? 'Select a child to award to.'
    : source === 'library'
      ? !awardChoreId
        ? 'Select a chore from the library.'
        : quantity.trim() === '' || parsedQuantity === 0
          ? 'Enter a quantity to continue.'
          : !quantityValid
            ? 'Quantity must be between 1 and 10.'
            : null
      : !customTitle.trim()
        ? 'Add a description for this award.'
        : !(Number.isFinite(parsedAmount) && parsedAmount > 0)
          ? 'Enter an amount greater than zero.'
          : null
  const awardReady = awardBlockReason === null

  /** Same contract for the Assign Chore / Add Expense tabs. */
  const simpleBlockReason: string | null = !childId
    ? 'Select a child first.'
    : !itemId
      ? mode === 'chore'
        ? 'Select a chore to assign.'
        : 'Select an expense to apply.'
      : null

  function resetAward() {
    setSource('library')
    setAwardChoreId('')
    setQuantity('1')
    setCustomTitle('')
    setCustomAmount('')
    setNote('')
  }

  async function submit() {
    setBusy(true)
    setDone(null)
    setError(null)
    try {
      if (mode === 'award') {
        const childName = children.find((c) => c.id === childId)?.display_name ?? 'them'
        const credited = formatCurrency(awardTotal, currency)
        if (source === 'library') {
          await directAwardFromLibrary(awardChoreId, childId, assignedBy, parsedQuantity, note)
        } else {
          await directAwardCustom(familyId, childId, assignedBy, customTitle, parsedAmount, note)
        }
        await onDone()
        setDone(`Awarded ${credited} to ${childName}.`)
        resetAward()
      } else if (mode === 'chore') {
        await quickAssignChore(itemId, childId, assignedBy)
        await onDone()
        setDone('Chore assigned to the roster.')
        setItemId('')
      } else {
        await applyExpense(itemId, childId)
        await onDone()
        setDone('Expense applied.')
        setItemId('')
      }
    } catch (e) {
      // Awards move real money, so a failure has to be visible rather than a
      // silently rejected promise.
      setError(e instanceof Error ? e.message : 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  const fieldClass =
    'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'
  const labelClass = 'label-caps mb-2 block text-[11px] text-text-muted'

  /**
   * Item 3 — what this child's day is already worth, and what it becomes once
   * this chore lands. Only meaningful for a daily chore: a weekly or monthly one
   * doesn't move the daily figure, so it says so rather than printing a total
   * that silently didn't change.
   */
  const selectedChild = children.find((c) => c.id === childId)
  const selectedChore = chores.find((c) => c.id === itemId)
  const dailyReadout =
    mode === 'chore' && selectedChild && selectedChore ? (
      <div className="rounded-input border border-line bg-deep px-3 py-2 text-xs text-text-muted">
        <div>
          {selectedChild.display_name}'s current daily total:{' '}
          <span className="font-semibold text-antique">
            {formatCurrency(dailyRosterTotal(roster, selectedChild.id), currency)}
          </span>
        </div>
        {selectedChore.frequency === 'daily' ? (
          <div className="mt-0.5">
            After this assignment:{' '}
            <span className="font-semibold text-antique">
              {formatCurrency(
                dailyRosterTotal(roster, selectedChild.id) + selectedChore.value,
                currency
              )}
            </span>
          </div>
        ) : (
          <div className="mt-0.5">This is a {selectedChore.frequency} chore.</div>
        )}
      </div>
    ) : null

  const tabs = [
    { key: 'chore', label: 'Assign Chore' },
    { key: 'expense', label: 'Add Expense' },
    { key: 'award', label: 'Direct Award' },
  ] as const

  return (
    <section>
      <h2 className="mb-3 text-2xl">Quick Add</h2>
      <Card className="flex flex-col gap-3">
        <div className="flex gap-1 rounded-input border border-line bg-deep p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setMode(t.key)
                setItemId('')
                setDone(null)
                setError(null)
                resetAward()
              }}
              className={cn(
                'label-caps flex-1 rounded-input px-1 py-2 text-[11px]',
                mode === t.key ? 'bg-wash text-antique' : 'text-text-muted'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select value={childId} onChange={(e) => setChildId(e.target.value)} className={fieldClass}>
          <option value="">Select child…</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </select>

        {mode === 'award' ? (
          <>
            <div className="flex gap-1 rounded-input border border-line bg-deep p-1">
              {(['library', 'custom'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSource(s)
                    setDone(null)
                    setError(null)
                  }}
                  className={cn(
                    'label-caps flex-1 rounded-input py-2 text-[11px]',
                    source === s ? 'bg-wash text-antique' : 'text-text-muted'
                  )}
                >
                  {s === 'library' ? 'From Library' : 'Custom Amount'}
                </button>
              ))}
            </div>

            {source === 'library' ? (
              <>
                <select
                  value={awardChoreId}
                  onChange={(e) => setAwardChoreId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select chore…</option>
                  {chores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {formatCurrency(c.value, currency)}
                    </option>
                  ))}
                </select>

                <div>
                  <label htmlFor="award-qty" className={labelClass}>
                    How many?
                  </label>
                  {/* Deliberately a text input: type="number" bound to a
                      numeric state was clamped every keystroke, so backspace
                      could never empty the field. Digits-only is enforced in
                      onChange; the 1-10 range is enforced by awardBlockReason
                      rather than by rewriting what the parent is still typing. */}
                  <input
                    id="award-qty"
                    type="text"
                    inputMode="numeric"
                    aria-describedby={awardBlockReason ? 'award-block-reason' : undefined}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                    className={cn(fieldClass, 'min-h-touch')}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="award-desc" className={labelClass}>
                    Description
                  </label>
                  <input
                    id="award-desc"
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Received an A on assignment"
                    className={cn(fieldClass, 'min-h-touch')}
                  />
                </div>
                <div>
                  <label htmlFor="award-amount" className={labelClass}>
                    Amount
                  </label>
                  <input
                    id="award-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="0.00"
                    className={cn(fieldClass, 'min-h-touch')}
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="award-note" className={labelClass}>
                Add a note (optional)
              </label>
              <textarea
                id="award-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Math test, received an A"
                className={fieldClass}
              />
            </div>

            <p className="text-center text-lg text-text">
              Total award:{' '}
              <span className="display font-semibold text-antique">
                {formatCurrency(awardTotal, currency)}
              </span>
            </p>

            <Button
              variant="accent"
              fullWidth
              size="lg"
              onClick={submit}
              disabled={!awardReady || busy}
            >
              {busy ? 'Working…' : 'Award'}
            </Button>

            {awardBlockReason && (
              <p id="award-block-reason" className="text-center text-xs text-text-muted">
                {awardBlockReason}
              </p>
            )}
          </>
        ) : (
          <>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={fieldClass}>
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

            {dailyReadout}

            <Button
              variant="accent"
              fullWidth
              size="lg"
              onClick={submit}
              disabled={!!simpleBlockReason || busy}
            >
              {busy ? 'Working…' : mode === 'chore' ? 'Assign Chore' : 'Apply Expense'}
            </Button>

            {simpleBlockReason && (
              <p className="text-center text-xs text-text-muted">{simpleBlockReason}</p>
            )}
          </>
        )}

        {done && <p className="text-center text-sm text-green">{done}</p>}
        {error && <p className="text-center text-sm text-danger">{error}</p>}
      </Card>
    </section>
  )
}
