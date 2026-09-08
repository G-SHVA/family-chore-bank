import { useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { Modal } from '@/components/ui/Modal'
import { amountPaid, paidOffPct, type Loan } from '@/features/loans/loanService'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * "I OWE" — the child-facing half of a loan.
 *
 * LIVES INSIDE THE BALANCE CARD, on a hairline beneath the balance figure, and
 * that placement is the whole design. A loan is a CLAIM AGAINST THAT BALANCE,
 * so the two numbers have to be read in one glance. Given its own card it would
 * either shout or — on a column with 559px of usable height — sit below the
 * fold where the child never meets it.
 *
 * NOT RED. Red is the app's destructive/error colour and would read as an
 * alarm; the debt is not an error, it is a fact the child lives with. NOT GOLD
 * either — the child view spends its one primary-gold slot on the balance
 * figure and Mark Complete (DESIGN_SYSTEM.md §5), and a debt is neither an
 * action nor an achievement. Muted warm grey (--color-text-secondary) makes it
 * serious without making it frightening. The minus sign on a negative balance
 * is the only alarm the screen needs.
 *
 * NO "PAY NOW". Payments are automatic on the schedule the parent set when the
 * loan was created — the child knows exactly when and how much comes out, with
 * no discretion on either side. That is the book's model, and giving a child a
 * pay button would quietly hand them a choice the arrangement does not include.
 */
export function LoanLine({ loan, currency }: { loan: Loan; currency: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`I owe ${formatCurrency(loan.balance_remaining, currency)} — see loan details`}
        className="spine-top mt-3 flex min-h-touch w-full items-center gap-3 pt-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-antique"
      >
        <span className="label-caps text-[11px] text-text-muted">I owe</span>
        <span className="display flex-1 text-2xl tabular-nums text-text-muted">
          {formatCurrency(loan.balance_remaining, currency)}
        </span>
        <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-text-muted" />
      </button>

      <LoanDetailModal loan={loan} currency={currency} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/**
 * "LOAN REQUEST — PENDING" — the child's unanswered request.
 *
 * SAME SLOT AS LoanLine, and that is deliberate rather than convenient. A
 * request is a claim the child has ASKED to make against their balance, so it
 * belongs exactly where a real claim would appear, in the same muted warm grey.
 * Putting it anywhere else would make the answer arrive somewhere the child was
 * not already looking.
 *
 * The two can never appear together: a child holding an active loan is not
 * shown the request entry point, and idx_loans_one_requested_per_member caps
 * them at one outstanding request. Read-only on tap, for the same reason
 * LoanLine is -- there is nothing for the child to do but wait.
 */
export function LoanRequestLine({ loan, currency }: { loan: Loan; currency: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Loan request for ${formatCurrency(loan.principal, currency)} — pending. See what you asked for`}
        className="spine-top mt-3 flex min-h-touch w-full items-center gap-3 pt-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-antique"
      >
        <span className="label-caps text-[11px] text-text-muted">Loan request</span>
        <span className="flex-1 text-lg text-text-muted">Pending…</span>
        <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-text-muted" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="My loan request">
        <div className="flex flex-col gap-5">
          <div>
            <div className="label-caps text-[11px] text-text-muted">What it is for</div>
            <div className="display mt-1 text-2xl text-text">{loan.description}</div>
          </div>

          <dl className="flex flex-col gap-3 border-t border-line pt-4">
            <Row label="You asked for" value={formatCurrency(loan.principal, currency)} />
            <Row
              label="You offered to pay"
              value={`${formatCurrency(loan.monthly_payment, currency)} a month`}
            />
          </dl>

          <p className="text-base leading-snug text-text-muted">
            Your parent is reviewing this. They may change the amount you pay each month before
            they agree, so the final terms might not match what you asked for.
          </p>
        </div>
      </Modal>
    </>
  )
}

/** The full reading, one tap away. Read-only by design — see LoanLine. */
function LoanDetailModal({
  loan,
  currency,
  open,
  onClose,
}: {
  loan: Loan
  currency: string
  open: boolean
  onClose: () => void
}) {
  const pct = paidOffPct(loan)
  const paid = amountPaid(loan)

  return (
    <Modal open={open} onClose={onClose} title="My loan">
      <div className="flex flex-col gap-5">
        <div>
          <div className="label-caps text-[11px] text-text-muted">What it is for</div>
          <div className="display mt-1 text-2xl text-text">{loan.description}</div>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label-caps text-[11px] text-text-muted">Paid off</span>
            <span className="label-caps text-[11px] text-antique">{pct}%</span>
          </div>
          {/* Fills as the debt shrinks, so the bar measures progress rather
              than obligation. Antique, not green: paying a debt is not the same
              kind of event as earning money, and the two should not read alike. */}
          <div className="h-2 w-full overflow-hidden rounded-input bg-deep">
            <motion.div
              className="h-full bg-antique"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 60, damping: 18 }}
            />
          </div>
          <div className="mt-2 text-base text-text-muted">
            <span className="font-semibold text-text">{formatCurrency(paid, currency)}</span> of{' '}
            {formatCurrency(loan.principal, currency)} repaid
          </div>
        </div>

        <dl className="flex flex-col gap-3 border-t border-line pt-4">
          <Row label="Still to pay" value={formatCurrency(loan.balance_remaining, currency)} />
          <Row label="Original amount" value={formatCurrency(loan.principal, currency)} />
          <Row
            label="Comes out each month"
            value={formatCurrency(loan.monthly_payment, currency)}
          />
          <Row label="Payment day" value={ordinalDay(loan.payment_day)} />
        </dl>

        <p className="text-base leading-snug text-text-muted">
          This comes out of your balance automatically each month. Earning more does not change
          the payment — it means you finish sooner.
        </p>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="label-caps text-[10px] text-text-muted">{label}</dt>
      <dd className="text-lg tabular-nums text-text">{value}</dd>
    </div>
  )
}

/**
 * "<description> loan", without saying "loan" twice.
 *
 * The sentence is "Your <description> loan is paid off", which reads correctly
 * for a description like "Saxophone replacement" and badly for one like
 * "Test loan" — observed on 2026-09-03 as "Your Test loan loan is paid off."
 * Parents name loans however they like, so the copy has to cope rather than
 * assume.
 */
function loanPhrase(description: string): string {
  const trimmed = description.trim()
  return /\bloans?$/i.test(trimmed) ? trimmed : `${trimmed} loan`
}

function ordinalDay(day: number): string {
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
  return `${day}${suffix} of the month`
}

/**
 * The resolution moment — a loan paid off or forgiven within the last 48 hours.
 *
 * DERIVED, exactly like a character recognition: loans.paid_off_at carries the
 * timestamp, the window is computed at read time, and dismissal lives in
 * sessionStorage. No notifications table, no new column, zero new rows.
 *
 * Forgiveness gets its own wording rather than sharing "paid off". A parent
 * cancelling a debt is a deliberate act with weight, and a child who was never
 * told would simply notice their balance had stopped going down — which teaches
 * nothing about what actually happened.
 */
export function LoanResolvedBanner({
  loan,
  onDismiss,
}: {
  loan: Loan
  onDismiss: (id: string) => void
}) {
  const forgiven = loan.status === 'forgiven'
  const declined = loan.status === 'declined'
  // Antique on bg-wash for both of the parent-decision cases. NOT the danger
  // colour for a decline: a parent saying no is an answer, not an error, and
  // the same reasoning that keeps "I owe" out of red applies here. Green stays
  // reserved for the one case the child actually completed.
  const parentDecision = forgiven || declined
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      // shrink-0: flex child of the height-constrained Home column. Without it
      // the banner is compressed instead of pushing the column into scroll.
      className={cn(
        'relative flex shrink-0 items-start gap-3 overflow-hidden rounded-card border p-4',
        parentDecision ? 'border-antique/50 bg-wash' : 'border-green/40 bg-green/5'
      )}
    >
      <div className="min-w-0 flex-1">
        <h3 className={cn('text-xl leading-tight', parentDecision ? 'text-antique' : 'text-green')}>
          {declined
            ? 'Your loan request was declined.'
            : forgiven
              ? `Your ${loanPhrase(loan.description)} has been forgiven.`
              : `Your ${loanPhrase(loan.description)} is paid off.`}
        </h3>
        {/* THE NOTE IS THE POINT OF THE DECLINE BANNER. decline_note is
            required at the service layer, so this is never an empty block —
            and it is why the banner survives a re-request rather than being
            cleared by one: the reason is the most valuable thing the child
            gets out of being told no, and a child who immediately asks again
            has probably not read it yet. */}
        {declined && loan.decline_note && (
          <p className="mt-1 text-base leading-snug text-text-muted">{loan.decline_note}</p>
        )}
        {forgiven && (
          <p className="mt-1 text-base leading-snug text-text-muted">
            You keep everything you have already earned.
          </p>
        )}
      </div>
      <button
        onClick={() => onDismiss(loan.id)}
        aria-label="Dismiss"
        className="flex min-h-touch min-w-touch shrink-0 items-center justify-center rounded-input text-text-muted hover:bg-wash hover:text-antique"
      >
        <X className="h-5 w-5" />
      </button>
    </motion.div>
  )
}
