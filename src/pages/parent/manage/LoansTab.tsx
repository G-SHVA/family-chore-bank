import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Landmark, PlayCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  getFamilyLoans,
  createLoan,
  forgiveLoan,
  getLoanRequests,
  RESOLVED_LOAN_STATUSES,
  runMonthlyDeductions,
  amountPaid,
  paidOffPct,
  type LoanWithMember,
  type DeductionSummary,
} from '@/features/loans/loanService'
import { isChild } from '@/features/family/familyService'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatCurrency } from '@/lib/utils'
import { formatDateInZone } from '@/lib/time'

/**
 * Manage -> Loans. A parent's complete control over a child's debt.
 *
 * THERE IS NO "APPLY PAYMENT" BUTTON, and its absence is the design. Payments
 * are automatic on the day the parent set when the loan was created — the
 * child knows exactly when and how much comes out, and no one gets discretion
 * over the timing. "Run Monthly Deductions" exists only because there is no
 * cron on the Supabase free tier; after the Pro upgrade the same Edge Function
 * runs on the 5th and this button becomes a manual override rather than the
 * mechanism.
 *
 * A parent's real levers are the ones that belong to them: setting the terms
 * at creation, and forgiving the debt outright.
 */
export default function LoansTab() {
  const { family, members, activeMember } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'
  const children = useMemo(() => members.filter(isChild), [members])

  const [loans, setLoans] = useState<LoanWithMember[]>([])
  // Requests are NOT loans and never render on this screen -- they are
  // answered in the approval queue. They are read here for one reason: to
  // keep a child with an unanswered request out of the New Loan selector.
  const [requests, setRequests] = useState<LoanWithMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [forgiving, setForgiving] = useState<LoanWithMember | null>(null)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<DeductionSummary | null>(null)

  const load = useCallback(async () => {
    if (!familyId) return
    try {
      setError(null)
      const [real, pending] = await Promise.all([
        getFamilyLoans(familyId),
        getLoanRequests(familyId),
      ])
      setLoans(real)
      setRequests(pending)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load loans.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  const active = loans.filter((l) => l.status === 'active')
  // EXPLICIT, not `!== 'active'`. The negation was correct only while three
  // statuses existed; with 'requested' and 'declined' in the constraint it
  // would sweep an unanswered request into Loan History and render it as a
  // completed loan. getFamilyLoans() already excludes requests at the query,
  // so this is the second of two layers -- and the one that keeps working if
  // that read is ever widened. Same doctrine as the chore_assignments rule:
  // state the statuses you want rather than trusting what you exclude.
  const resolved = loans.filter((l) => RESOLVED_LOAN_STATUSES.includes(l.status))
  // One active loan per child is enforced by a partial unique index; this only
  // decides whether to offer the button, and says why when it does not.
  //
  // A child with an UNANSWERED REQUEST is excluded too. Without this a parent
  // could create a loan directly while the child's own request still sat in
  // the queue -- the index would permit it (it is scoped to 'active', and the
  // request is 'requested'), leaving an orphaned request the child sees as
  // pending forever against a loan they never agreed to. The answer belongs in
  // the queue, where the terms can actually be discussed.
  const spokenFor = new Set([
    ...active.map((l) => l.member_id),
    ...requests.map((r) => r.member_id),
  ])
  const childrenWithoutLoan = children.filter((c) => !spokenFor.has(c.id))
  const canCreate = childrenWithoutLoan.length > 0
  const blockedByRequest =
    !canCreate && requests.length > 0 && active.length < children.length

  async function handleRun() {
    setRunning(true)
    setError(null)
    try {
      setSummary(await runMonthlyDeductions())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The deductions did not run.')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-antique" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Loans</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleRun} disabled={running}>
            {running ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <PlayCircle className="h-5 w-5" />
            )}
            {running ? 'Running…' : 'Run Monthly Deductions'}
          </Button>
          {/* The one primary-gold element on this screen (DESIGN_SYSTEM.md §5):
              a singular action, so `primary` rather than `primaryList`. */}
          <Button onClick={() => setCreating(true)} disabled={!canCreate}>
            <Plus className="h-5 w-5" /> New Loan
          </Button>
        </div>
      </div>
      <p className="-mt-2 text-sm text-text-muted">
        A loan records a debt — creating one does not give the child money. The monthly payment
        comes out of their balance automatically on the day you set.
        {!canCreate && children.length > 0 && (
          <>
            {' '}
            <span className="text-antique">
              {blockedByRequest
                ? 'A child has a loan request waiting — answer it on the Home screen, where you can set the terms.'
                : 'Every child already has an active loan; pay one off or forgive it to add another.'}
            </span>
          </>
        )}
      </p>

      {error && (
        <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {summary && (
        <DeductionSummaryCard
          summary={summary}
          currency={currency}
          onDismiss={() => setSummary(null)}
        />
      )}

      {active.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No active loans"
          subtitle="Create one when you front a child money they will pay back."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {active.map((loan) => (
            <ActiveLoanCard
              key={loan.id}
              loan={loan}
              currency={currency}
              onForgive={() => setForgiving(loan)}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <CollapsibleSection title="Loan History" meta={`${resolved.length}`} maxHeight={420}>
          <div className="flex flex-col gap-3 pb-1">
            {resolved.map((loan) => (
              <ResolvedLoanRow key={loan.id} loan={loan} currency={currency} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      <NewLoanModal
        open={creating}
        currency={currency}
        children={childrenWithoutLoan}
        onClose={() => setCreating(false)}
        onCreate={async (memberId, description, principal, monthlyPayment, paymentDay) => {
          if (!familyId) return
          await createLoan({
            familyId,
            memberId,
            description,
            principal,
            monthlyPayment,
            paymentDay,
            createdBy: activeMember?.id ?? null,
          })
          await load()
          setCreating(false)
        }}
      />

      <ForgiveModal
        loan={forgiving}
        currency={currency}
        onClose={() => setForgiving(null)}
        onConfirm={async () => {
          if (!forgiving) return
          await forgiveLoan(forgiving.id)
          await load()
          setForgiving(null)
        }}
      />
    </div>
  )
}

function ActiveLoanCard({
  loan,
  currency,
  onForgive,
}: {
  loan: LoanWithMember
  currency: string
  onForgive: () => void
}) {
  const pct = paidOffPct(loan)
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-caps text-[10px] text-text-muted">
            {loan.member?.display_name ?? 'Unknown'}
          </div>
          <div className="display mt-0.5 truncate text-xl text-text">{loan.description}</div>
        </div>
        <div className="text-right">
          {/* Balance remaining is the prominent figure — it is the number a
              parent is tracking. Antique, not primary gold: the gold slot on
              this screen belongs to New Loan. */}
          <div className="display text-3xl tabular-nums text-antique">
            {formatCurrency(loan.balance_remaining, currency)}
          </div>
          <div className="label-caps text-[10px] text-text-muted">Balance remaining</div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label-caps text-[10px] text-text-muted">
            {formatCurrency(amountPaid(loan), currency)} of{' '}
            {formatCurrency(loan.principal, currency)} repaid
          </span>
          <span className="label-caps text-[10px] text-antique">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-input bg-deep">
          <motion.div
            className="h-full bg-antique"
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ type: 'spring', stiffness: 60, damping: 18 }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="text-sm text-text-muted">
          <span className="font-semibold text-text">
            {formatCurrency(loan.monthly_payment, currency)}
          </span>{' '}
          on the {ordinal(loan.payment_day)} of each month
        </div>
        <Button variant="danger" onClick={onForgive}>
          Forgive
        </Button>
      </div>
    </Card>
  )
}

const RESOLVED_PILL = {
  forgiven: { label: 'Forgiven', cls: 'border-antique/40 text-antique' },
  declined: { label: 'Declined', cls: 'border-antique/40 text-antique' },
  paid_off: { label: 'Paid off', cls: 'border-green/40 text-green' },
} as const

function ResolvedLoanRow({ loan, currency }: { loan: LoanWithMember; currency: string }) {
  const forgiven = loan.status === 'forgiven'
  const declined = loan.status === 'declined'
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="label-caps text-[10px] text-text-muted">
          {loan.member?.display_name ?? 'Unknown'}
        </div>
        <div className="display truncate text-lg text-text">{loan.description}</div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-base tabular-nums text-text-muted">
            {formatCurrency(loan.principal, currency)}
          </div>
          <div className="label-caps text-[10px] text-text-muted">
            {loan.paid_off_at
              ? formatDateInZone(new Date(loan.paid_off_at), {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '—'}
          </div>
        </div>
        {/* A LOOKUP, not a chained ternary. cn() has no tailwind-merge, so
            exactly one colour class may be emitted -- chaining `?:` for a
            third state is how two end up in the class list with stylesheet
            order deciding. Same rule as Stat's `tone` on Family Week.

            Declined shares antique with forgiven because both are a parent's
            decision rather than something the child completed; green stays
            reserved for the one case the child actually finished. */}
        <span
          className={cn(
            'label-caps rounded-input border px-3 py-1 text-[10px]',
            RESOLVED_PILL[declined ? 'declined' : forgiven ? 'forgiven' : 'paid_off'].cls
          )}
        >
          {RESOLVED_PILL[declined ? 'declined' : forgiven ? 'forgiven' : 'paid_off'].label}
        </span>
      </div>
    </Card>
  )
}

function DeductionSummaryCard({
  summary,
  currency,
  onDismiss,
}: {
  summary: DeductionSummary
  currency: string
  onDismiss: () => void
}) {
  const nothing = summary.processed === 0
  return (
    <Card className={cn('flex flex-col gap-2', nothing ? 'border-line' : 'border-green/40')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label-caps text-[10px] text-text-muted">Monthly deductions</div>
          <div className="display mt-0.5 text-xl text-text">
            {nothing
              ? 'Nothing was due.'
              : `${summary.processed} payment${summary.processed === 1 ? '' : 's'} — ${formatCurrency(
                  summary.totalDeducted,
                  currency
                )}`}
          </div>
        </div>
        <Button variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {nothing ? (
        <p className="text-sm text-text-muted">
          No loan has reached its payment day this month, or every one has already been charged.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {summary.results.map((r) => (
            <li key={r.loan_id}>
              {r.member_name}: {formatCurrency(r.amount, currency)} toward {r.description}
              {r.paid_off && <span className="ml-2 text-green">Loan paid off!</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function NewLoanModal({
  open,
  currency,
  children,
  onClose,
  onCreate,
}: {
  open: boolean
  currency: string
  children: { id: string; display_name: string | null }[]
  onClose: () => void
  onCreate: (
    memberId: string,
    description: string,
    principal: number,
    monthlyPayment: number,
    paymentDay: number
  ) => Promise<void>
}) {
  const [memberId, setMemberId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [payment, setPayment] = useState('')
  // True once the parent edits the payment themselves, after which the
  // amount/4 default stops overwriting what they typed.
  const [paymentTouched, setPaymentTouched] = useState(false)
  const [paymentDay, setPaymentDay] = useState('5')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMemberId(children[0]?.id ?? '')
    setDescription('')
    setAmount('')
    setPayment('')
    setPaymentTouched(false)
    setPaymentDay('5')
    setError(null)
  }, [open, children])

  const principal = Number.parseFloat(amount)
  const principalValid = Number.isFinite(principal) && principal > 0

  // Four-month payoff by default, but editable — and once edited, left alone.
  const suggested = principalValid ? Math.round((principal / 4) * 100) / 100 : 0
  const effectivePayment = paymentTouched ? Number.parseFloat(payment) : suggested
  const paymentValid = Number.isFinite(effectivePayment) && effectivePayment > 0

  const day = Number.parseInt(paymentDay, 10)
  const dayValid = Number.isFinite(day) && day >= 1 && day <= 28

  const months = principalValid && paymentValid ? Math.ceil(principal / effectivePayment) : null

  const blockReason = !memberId
    ? 'Choose a child.'
    : !description.trim()
      ? 'Say what the loan is for.'
      : !principalValid
        ? 'Enter the amount.'
        : !paymentValid
          ? 'Enter a monthly payment.'
          : !dayValid
            ? 'Payment day must be between 1 and 28.'
            : null

  const fieldClass =
    'w-full min-h-touch rounded-input border border-line bg-deep p-3 text-base text-text focus:border-antique focus:outline-none'

  return (
    <Modal open={open} onClose={onClose} title="New loan">
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="loan-child" className="label-caps mb-2 block text-[11px] text-text-muted">
            Who is borrowing
          </label>
          <select
            id="loan-child"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className={fieldClass}
          >
            {children.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name ?? 'Unnamed'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="loan-desc" className="label-caps mb-2 block text-[11px] text-text-muted">
            What it is for
          </label>
          <input
            id="loan-desc"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Saxophone replacement"
            className={fieldClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="loan-amt" className="label-caps mb-2 block text-[11px] text-text-muted">
              Amount
            </label>
            <input
              id="loan-amt"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="loan-pay" className="label-caps mb-2 block text-[11px] text-text-muted">
              Monthly payment
            </label>
            <input
              id="loan-pay"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={paymentTouched ? payment : suggested ? String(suggested) : ''}
              onChange={(e) => {
                setPaymentTouched(true)
                setPayment(e.target.value)
              }}
              placeholder="0.00"
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="loan-day" className="label-caps mb-2 block text-[11px] text-text-muted">
            Payment day (1–28)
          </label>
          <input
            id="loan-day"
            type="number"
            inputMode="numeric"
            min="1"
            max="28"
            value={paymentDay}
            onChange={(e) => setPaymentDay(e.target.value)}
            className={fieldClass}
          />
          <p className="mt-1 text-xs text-text-muted">
            Capped at 28 so the payment never skips February.
          </p>
        </div>

        <div className="rounded-input border border-line bg-deep px-4 py-3 text-sm text-text-muted">
          {months !== null ? (
            <>
              Estimated payoff:{' '}
              <span className="font-semibold text-antique">
                {months} {months === 1 ? 'month' : 'months'}
              </span>{' '}
              at {formatCurrency(effectivePayment, currency)} a month.
            </>
          ) : (
            'Enter an amount to see the estimated payoff.'
          )}
          <div className="mt-1">
            This does <span className="text-text">not</span> credit the child — it records what
            they owe.
          </div>
        </div>

        {error && <div className="text-sm text-danger">{error}</div>}

        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            fullWidth
            disabled={busy || blockReason !== null}
            onClick={async () => {
              if (blockReason) return
              setBusy(true)
              setError(null)
              try {
                await onCreate(memberId, description, principal, effectivePayment, day)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not create the loan.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Creating…' : 'Create Loan'}
          </Button>
        </div>
        {blockReason && <p className="text-center text-xs text-text-muted">{blockReason}</p>}
      </div>
    </Modal>
  )
}

/**
 * Two-step confirm, mirroring goal abandonment.
 *
 * The wording is exact and deliberate: forgiveness cancels the remaining
 * balance and the child KEEPS what they have already earned — it does not hand
 * them the money back. A parent should not be able to misread which of those
 * two things is about to happen.
 */
function ForgiveModal({
  loan,
  currency,
  onClose,
  onConfirm,
}: {
  loan: LoanWithMember | null
  currency: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loan) return
    setConfirming(false)
    setError(null)
  }, [loan])

  if (!loan) return null
  const name = loan.member?.display_name ?? 'This child'

  return (
    <Modal open={!!loan} onClose={onClose} title="Forgive this loan?">
      <div className="flex flex-col gap-4">
        <p className="text-base leading-snug text-text">
          Forgiving this loan cancels the remaining{' '}
          <span className="font-semibold text-antique">
            {formatCurrency(loan.balance_remaining, currency)}
          </span>{' '}
          balance. {name} keeps any money already credited from this loan.
        </p>
        <p className="text-sm text-text-muted">
          {loan.description} · {formatCurrency(amountPaid(loan), currency)} of{' '}
          {formatCurrency(loan.principal, currency)} already repaid. This cannot be undone, and no
          money moves either way.
        </p>

        {error && <div className="text-sm text-danger">{error}</div>}

        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {!confirming ? (
            <Button variant="danger" fullWidth onClick={() => setConfirming(true)}>
              Forgive
            </Button>
          ) : (
            <Button
              variant="danger"
              fullWidth
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await onConfirm()
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not forgive the loan.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Forgiving…' : 'Yes, forgive it'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ordinal(day: number): string {
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? 'th'
      : day % 10 === 1
        ? 'st'
        : day % 10 === 2
          ? 'nd'
          : day % 10 === 3
            ? 'rd'
            : 'th'
  return `${day}${suffix}`
}
