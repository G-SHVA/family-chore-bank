import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { requestPurchase } from '@/features/expenses/expenseService'
import { cn, formatCurrency } from '@/lib/utils'

const fieldClass =
  'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'
const labelClass = 'label-caps mb-2 block text-[11px] text-text-muted'

const SUCCESS_DISMISS_MS = 2000

/**
 * "I Want to Buy Something" — the child asks, the parent decides.
 *
 * THE LIVE CONSEQUENCE LINE IS THE TEACHING MOMENT. As the child types an
 * amount, the sentence underneath names the exact figure that would leave their
 * balance. The book's "is this worth it?" question only lands if the cost is
 * concrete at the moment of asking, not discovered afterwards in the ledger.
 *
 * The reason field is OPTIONAL. Requiring an argument for every purchase would
 * turn a small ask into an essay and teach children to perform justification
 * rather than think about value — but the field is there, because a child who
 * wants to make their case should be able to.
 */
export function PurchaseRequestModal({
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
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setAmount('')
    setReason('')
    setError(null)
    setSent(false)
    setBusy(false)
  }, [open])

  useEffect(() => {
    if (!sent) return
    const t = setTimeout(() => {
      onSubmitted()
      onClose()
    }, SUCCESS_DISMISS_MS)
    return () => clearTimeout(t)
  }, [sent, onSubmitted, onClose])

  const parsed = Number.parseFloat(amount)
  const hasAmount = Number.isFinite(parsed) && parsed > 0
  const ready = title.trim().length > 0 && hasAmount

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await requestPurchase({
        familyId,
        memberId,
        title: title.trim(),
        amount: parsed,
        reason: reason.trim() || undefined,
      })
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your request. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={sent ? undefined : 'I Want to Buy Something'}>
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <h2 className="text-2xl text-antique">Your request has been sent!</h2>
          <p className="text-base text-text-muted">Your parent will review it soon.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="buy-req-what" className={labelClass}>
              What do you want to buy?
            </label>
            <input
              id="buy-req-what"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Minecraft"
              className={cn(fieldClass, 'min-h-touch')}
            />
          </div>

          <div>
            <label htmlFor="buy-req-amount" className={labelClass}>
              How much does it cost?
            </label>
            <input
              id="buy-req-amount"
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
            <label htmlFor="buy-req-why" className={labelClass}>
              Why do you want it?
            </label>
            <textarea
              id="buy-req-why"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Tell your parent why this matters to you..."
              className={fieldClass}
            />
          </div>

          {/* Names the exact figure, live. See the header note — this is the
              "is this worth it?" moment, and it only works with a real number. */}
          <p className="text-base leading-snug text-text-muted">
            Your parent will review your request. If approved,{' '}
            <span className="font-semibold text-text">
              {hasAmount ? formatCurrency(parsed, currency) : formatCurrency(0, currency)}
            </span>{' '}
            will come out of your balance.
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
        </div>
      )}
    </Modal>
  )
}
