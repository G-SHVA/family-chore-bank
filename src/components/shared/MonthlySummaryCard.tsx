import type { MonthlySummary } from '@/features/bank/bankService'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/lib/utils'

/**
 * The child's own month, in three numbers and one sentence.
 *
 * The book's central question is "should I save or spend?", and a child cannot
 * answer it without seeing their own pattern. The parent has the Analytics tab;
 * this is the child's version of it, deliberately reduced to what a young
 * reader can hold in their head at once.
 *
 * Tone is a bank statement, not a poster. No emoji, no exclamation marks, no
 * praise and no scolding — a month where they outspent what they earned states
 * that plainly and leaves the judgement to them. That restraint is the feature:
 * a line that congratulates saving would make overspending feel like a telling
 * off, and the child would stop reading it.
 */
export function MonthlySummaryCard({
  summary,
  currency,
  hasActiveGoal,
}: {
  summary: MonthlySummary
  currency: string
  /** The "saved toward goal" figure is meaningless without a goal to save for. */
  hasActiveGoal: boolean
}) {
  // What the month actually added to the balance. Floored at zero: a negative
  // "saved" figure is a contradiction, and the shortfall is already stated in
  // the sentence below.
  const savedTowardGoal = Math.max(0, summary.net)

  // Shown ONLY when there is something positive to report. A "$0.00 saved
  // toward goal" in antique gold teaches a child nothing — it reads either as a
  // bug or as a taunt, on a screen that already told them plainly that they
  // outspent what they earned. The dashboard's goal ring is where they see
  // where they stand overall; this line is for a month that moved them forward.
  const showSaved = hasActiveGoal && savedTowardGoal >= 0.01

  return (
    <Card className="mb-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Figure label="Earned this month" amount={summary.earned} currency={currency} tone="green" />
        <Figure label="Spent this month" amount={summary.spent} currency={currency} tone="danger" />
        {showSaved && (
          <Figure
            label="Saved toward goal"
            amount={savedTowardGoal}
            currency={currency}
            tone="antique"
          />
        )}
      </div>

      <p className="display mt-5 border-t border-line pt-4 text-lg italic text-text-muted">
        {insight(summary, currency)}
      </p>
    </Card>
  )
}

/**
 * One sentence describing the month.
 *
 * The equality case is compared with a ONE CENT tolerance rather than `===`:
 * these are floating-point sums of currency, so a month that genuinely broke
 * even can land at 0.000000001 and would otherwise print "you kept $0.00 more
 * than you spent" — technically true, and obviously wrong to a reader.
 */
function insight(summary: MonthlySummary, currency: string): string {
  const diff = summary.earned - summary.spent

  // A month with no activity at all is NOT the "broke even" case, even though
  // the arithmetic is identical. Telling a child who has not earned or spent a
  // cent that they "earned exactly what they spent" is technically true and
  // reads as nonsense — it describes a balanced month they never had. Early in
  // a month this is the ordinary state of the screen, not an edge case.
  if (summary.earned < 0.01 && summary.spent < 0.01) {
    return 'Nothing has moved in or out of your account this month.'
  }

  if (Math.abs(diff) < 0.01) return 'You earned exactly what you spent this month.'
  if (diff > 0) return `You kept ${formatCurrency(diff, currency)} more than you spent this month.`
  return `You spent ${formatCurrency(-diff, currency)} more than you earned this month.`
}

function Figure({
  label,
  amount,
  currency,
  tone,
}: {
  label: string
  amount: number
  currency: string
  tone: 'green' | 'danger' | 'antique'
}) {
  const toneClass =
    tone === 'green' ? 'text-green' : tone === 'danger' ? 'text-danger' : 'text-antique'
  return (
    <div>
      <div className={`display text-3xl leading-none ${toneClass}`}>
        {formatCurrency(amount, currency)}
      </div>
      <div className="label-caps mt-2 text-[10px] text-text-muted">{label}</div>
    </div>
  )
}
