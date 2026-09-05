import { ArrowRight } from 'lucide-react'
import type { Milestone } from '@/lib/supabase'
import {
  planProgressCopy,
  planWeeklyTotal,
  estimateWeeksToGoal,
  type PlanChore,
} from '@/features/goals/planService'
import type { SavingsRate } from '@/features/goals/goalService'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/lib/utils'

/**
 * "My Plan" — the second half of the goal modal.
 *
 * Two states and nothing in between: an invitation to build one, or the plan
 * itself. ONE bar, ONE sentence, ONE list, per the spec — no weekly charts, no
 * analytics. A five-year-old is reading this.
 *
 * The progress figure is a FRACTION, not a percentage. "$12.47 of $35.00" is a
 * quantity of money a child can picture; "36%" is an abstraction they have to
 * be taught. The ring above already carries the percentage for the parent
 * glancing at it.
 */
export function PlanSection({
  goal,
  planChores,
  balance,
  rate,
  currency,
  onBuild,
}: {
  goal: Milestone
  planChores: PlanChore[]
  balance: number
  rate: SavingsRate
  currency: string
  onBuild: () => void
}) {
  const hasPlan = planChores.length > 0

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="label-caps text-[11px] text-text-muted">My Plan</h3>

      {!hasPlan ? (
        <>
          <Button variant="accent" fullWidth size="lg" onClick={onBuild}>
            Build a plan to get there <ArrowRight className="h-5 w-5" />
          </Button>
          <p className="text-center text-base text-text-muted">
            Pick chores, see how fast you can reach your goal.
          </p>
        </>
      ) : (
        <PlanProgress
          goal={goal}
          planChores={planChores}
          balance={balance}
          rate={rate}
          currency={currency}
        />
      )}
    </div>
  )
}

function PlanProgress({
  goal,
  planChores,
  balance,
  rate,
  currency,
}: {
  goal: Milestone
  planChores: PlanChore[]
  balance: number
  rate: SavingsRate
  currency: string
}) {
  const target = goal.target_amount
  const saved = Math.max(0, Math.min(balance, target))
  const pct = target > 0 ? Math.max(0, Math.min(100, (balance / target) * 100)) : 0

  // Summed from the chores that ACTUALLY EXIST right now. If a parent pauses
  // one, getPlanChores stops returning it and this total falls to match — the
  // self-correction that made a stored weekly_target the wrong design.
  const weeklyTotal = planWeeklyTotal(planChores)

  /**
   * MEASURED RATE ALONE — deliberately NOT rate.perWeek + weeklyTotal.
   *
   * Once the plan is locked in its chores are roster instances, so
   * getWeeklySavingsRate() is already counting them (it filters on
   * template_id IS NOT NULL, which a plan template satisfies). Adding
   * weeklyTotal on top would count the same dollars twice, and the
   * overstatement GROWS as the plan succeeds — the child would repeatedly be
   * told the goal is nearer than it is.
   *
   * The plan BUILDER does add them, correctly, because there the chores do not
   * exist yet. See the RATE DISTINCTION note in goalService; do not "fix" these
   * two to agree.
   */
  const weeks = estimateWeeksToGoal(Math.max(0, target - balance), rate.perWeek, 0)

  return (
    <>
      {/* ONE bar. Antique gold on the dark track, full width. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-deep">
        <div
          className="h-full rounded-full bg-antique transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-lg text-text">
        <span className="font-semibold text-antique">{formatCurrency(saved, currency)}</span> of{' '}
        {formatCurrency(target, currency)}
      </div>

      {/* ONE sentence, in the display face. */}
      <p className="display text-xl italic leading-snug text-text-muted">
        {planProgressCopy(balance, target)}
      </p>

      {/* ONE list. Names left, values right, no cards. */}
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        {planChores.map((c) => (
          <div key={c.assignmentId} className="flex items-baseline justify-between gap-3 text-base">
            <span className="min-w-0 break-words text-text">{c.title}</span>
            <span className="shrink-0 font-semibold text-antique">
              {formatCurrency(c.value, currency)}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-base">
          <span className="text-text-muted">Weekly plan total</span>
          <span className="shrink-0 font-semibold text-text">
            {formatCurrency(weeklyTotal, currency)}
          </span>
        </div>
      </div>

      {weeks !== null && weeks > 0 && (
        <p className="text-base text-text-muted">
          About {weeks} {weeks === 1 ? 'week' : 'weeks'} to go at what you&rsquo;re earning now.
        </p>
      )}
    </>
  )
}
