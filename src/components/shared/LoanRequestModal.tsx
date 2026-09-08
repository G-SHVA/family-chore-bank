import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { requestLoan } from '@/features/loans/loanService'
import { cn, formatCurrency } from '@/lib/utils'

const fieldClass =
  'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'
const labelClass = 'label-caps mb-2 block text-[11px] text-text-muted'

/** How long the confirmation holds before the modal closes itself. */
const SUCCESS_DISMISS_MS = 2000

/**
 * "Request a Loan" — the child's side of the negotiation the book describes.
 *
 * ALL THREE FIELDS ARE REQUIRED, including the child's own suggested monthly
 * payment. Asking a child what they think they can afford is the entire
 * teaching moment: it makes them do the arithmetic before a parent does it for
 * them. A prefilled or optional payment field would hand them the answer.
 *
 * The helper text under that field says the parent sets the final amount, so
 * the child is not misled into thinking their number is binding — the request
 * is an opening position, not an order form.
 */
export function LoanRequestModal({
  open,
  onClose,
  onSubmitted,
  familyId,
  memberId,
  currency,
}: {
  open: boolean
  onClose: () => void
  onSubmitted: () => void
  familyId: string
  memberId: string
  currency: string
}) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [payment, setPayment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Reset on every OPEN, not on close: resetting on close would blank the form
  // under the exit animation while the child is still looking at it.
  useEffect(() => {
    if (!open) return
    setDescription('')
    setAmount('')
    setPayment('')
    setError(null)
    setSent(false)
    setBusy(false)
  }, [open])

  // Auto-dismiss the confirmation. Cleared on unmount so a child who closes the
  // modal by hand does not get a stray onClose fired at them two seconds later.
  useEffect(() => {
    if (!sent) return
    const t = setTimeout(() => {
      onSubmitted()
      onClose()
    }, SUCCESS_DISMISS_MS)
    return () => clearTimeout(t)
  }, [sent, onSubmitted, onClose])

  const parsedAmount = Number.parseFloat(amount)
  const parsedPayment = Number.parseFloat(payment)
  const ready =
    description.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    Number.isFinite(parsedPayment) &&
    parsedPayment > 0

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await requestLoan({
        familyId,
        memberId,
        description: description.trim(),
        principal: parsedAmount,
        monthlyPayment: parsedPayment,
      })
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={sent ? undefined : 'Request a Loan'}>
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <h2 className="text-2xl text-antique">Your request has been sent.</h2>
          <p className="text-base text-text-muted">Your parent will review it soon.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="loan-req-what" className={labelClass}>
              What is the loan for?
            </label>
            <input
              id="loan-req-what"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. New basketball"
              className={cn(fieldClass, 'min-h-touch')}
            />
          </div>

          <div>
            <label htmlFor="loan-req-amount" className={labelClass}>
              How much do you need?
            </label>
            <input
              id="loan-req-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="$0.00"
              className={cn(fieldClass, 'min-h-touch')}
            />
          </div>

          <div>
            <label htmlFor="loan-req-payment" className={labelClass}>
              How much can you pay back each month?
            </label>
            <input
              id="loan-req-payment"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={payment}
              onChange={(e) => setPayment(e.target.value)}
              placeholder="$0.00"
              aria-describedby="loan-req-payment-help"
              className={cn(fieldClass, 'min-h-touch')}
            />
            <p id="loan-req-payment-help" className="mt-2 text-sm text-text-muted">
              This is your suggestion — your parent will set the final amount
            </p>
          </div>

          <p className="text-base leading-snug text-text-muted">
            Your parent will review your request and set the final repayment terms.
          </p>

          {error && <p className="text-base text-danger">{error}</p>}

          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!ready || busy}
            className="w-full"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send Request'}
          </Button>
          {!ready && !busy && (
            <p className="text-center text-sm text-text-muted">
              Fill in all three so your parent knows what you are asking for.
            </p>
          )}
          {ready && !busy && (
            <p className="text-center text-sm text-text-muted">
              You are asking for {formatCurrency(parsedAmount, currency)} and offering{' '}
              {formatCurrency(parsedPayment, currency)} a month.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
