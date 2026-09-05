import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import type { Chore, Milestone } from '@/lib/supabase'
import { getClaimableChores, weeklyValueOf } from '@/features/chores/choreService'
import { lockInPlan, planEstimateCopy } from '@/features/goals/planService'
import type { SavingsRate } from '@/features/goals/goalService'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * The plan builder — a child picks chores and watches their week add up.
 *
 * AGES 5 AND UP is the whole brief. A tile carries a name and a dollar value
 * and NOTHING else: no category, no frequency, no description. The child is
 * answering one question — "do I want to do this?" — and every extra field is
 * something they have to read past to answer it. Two columns maximum, so a tile
 * is never narrow enough to wrap a chore name to three lines.
 *
 * The chores come from getClaimableChores() UNCHANGED — the same four doors the
 * claim library uses. Door 2 already excludes the child's ACTIVE roster, so
 * what remains is exactly "chores I could add". Chores already on the roster
 * are deliberately absent: they are generating income toward this goal already,
 * and offering them would let a child count the same work twice.
 */
export function PlanBuilder({
  open,
  goal,
  memberId,
  familyId,
  balance,
  rate,
  currency,
  onClose,
  onLocked,
}: {
  open: boolean
  goal: Milestone
  memberId: string
  familyId: string
  balance: number
  rate: SavingsRate
  currency: string
  onClose: () => void
  onLocked: () => Promise<void>
}) {
  const [chores, setChores] = useState<Chore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Shown for two seconds after a successful lock-in, then the modal closes. */
  const [succeeded, setSucceeded] = useState(false)

  /**
   * Chore ids the child has picked.
   *
   * A Set, and every update builds a NEW one. Mutating the existing Set in
   * place would keep the same reference, React would not re-render, and the
   * weekly total would silently freeze while the tiles appeared to toggle.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      setError(null)
      const groups = await getClaimableChores(memberId, familyId)
      // Flattened: the claim library groups by category because a child
      // BROWSING wants that structure. A child BUDGETING is comparing values
      // across the whole list, and category headings would break the scan into
      // sections that mean nothing to the question being asked.
      setChores(groups.flatMap((g) => g.chores))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load chores.')
    } finally {
      setLoading(false)
    }
  }, [memberId, familyId])

  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSucceeded(false)
    setLoading(true)
    void load()
  }, [open, load])

  function toggle(choreId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(choreId)) next.delete(choreId)
      else next.add(choreId)
      return next
    })
  }

  /**
   * DERIVED AT RENDER, never held in state.
   *
   * A `const [total, setTotal]` updated inside toggle() would be a second copy
   * of a fact the selection already determines — the same mistake as a stored
   * goal_plans.weekly_target, one layer up. Deriving it means deselect is
   * correct with no separate code path, and the total can never disagree with
   * the tiles that are lit.
   */
  const selectedChores = useMemo(
    () => chores.filter((c) => selected.has(c.id)),
    [chores, selected]
  )
  const planWeekly = useMemo(
    () => selectedChores.reduce((sum, c) => sum + weeklyValueOf(c), 0),
    [selectedChores]
  )

  const amountNeeded = Math.max(0, goal.target_amount - balance)
  // COMBINED rate here, and only here. Plan chores do not exist yet, so this is
  // a projection and the child's existing roster is genuinely additional to it.
  // The progress tracker deliberately does NOT do this — see the RATE
  // DISTINCTION note in goalService.
  const estimate = planEstimateCopy(amountNeeded, rate.perWeek, planWeekly, selected.size)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await lockInPlan(memberId, goal.id, [...selected])
      await onLocked()
      setSucceeded(true)
      // Two seconds is long enough to read six words and see the check land,
      // short enough that a child does not tap through it.
      setTimeout(onClose, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your plan.')
    } finally {
      setBusy(false)
    }
  }

  if (succeeded) {
    return (
      <Modal open={open} onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-green text-green"
          >
            <Check className="h-12 w-12" strokeWidth={2.5} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="display text-3xl text-text">Your plan is set!</div>
            <p className="mt-2 text-lg text-text-muted">These chores are now on your list.</p>
          </motion.div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Build my plan" size="wide">
      <div className="flex max-h-[75vh] flex-col">
        {/* HEADER — sticky, because the running total is the reason the screen
            exists and must never scroll out of reach of the tiles changing it. */}
        <div className="sticky top-0 z-10 shrink-0 border-b border-line bg-card pb-4">
          <div className="label-caps text-[11px] text-text-muted">Your weekly plan</div>
          {/* The screen's ONE primary-gold element. */}
          <div className="display text-5xl text-gold">
            {formatCurrency(planWeekly, currency)}
            <span className="ml-2 text-2xl text-text-muted">per week</span>
          </div>
          <p className="mt-2 text-base leading-snug text-text-muted">{estimate}</p>
        </div>

        {/* TILES */}
        <div className="scroll-skin min-h-0 flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-12 text-text-muted">
              <Loader2 className="h-6 w-6 animate-spin text-antique" />
              <span className="text-base">Loading chores…</span>
            </div>
          ) : chores.length === 0 ? (
            <p className="py-12 text-center text-lg text-text-muted">
              No chores to add right now. You&rsquo;re already doing them all!
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {chores.map((c) => {
                const on = selected.has(c.id)
                return (
                  <button
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    aria-pressed={on}
                    className={cn(
                      'relative flex min-h-[84px] flex-col justify-center gap-1 rounded-card border-2 p-4 text-left transition-colors',
                      on
                        ? 'border-antique bg-antique/10'
                        : 'border-line bg-deep hover:border-antique/40'
                    )}
                  >
                    {on && (
                      <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-antique text-deep">
                        <Check className="h-4 w-4" strokeWidth={3} />
                      </span>
                    )}
                    {/* Name and value ONLY. No category, no frequency. */}
                    <span className="pr-8 text-lg leading-tight text-text">{c.title}</span>
                    <span className="display text-2xl text-antique">
                      {formatCurrency(c.value, currency)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* FOOTER — sticky, so the commit is always one tap away. */}
        <div className="shrink-0 border-t border-line bg-card pt-4">
          {error && <p className="mb-3 text-base text-danger">{error}</p>}
          <Button
            variant="primary"
            fullWidth
            size="lg"
            disabled={selected.size === 0 || busy}
            onClick={submit}
          >
            {busy ? 'Saving…' : 'Lock In My Plan'}
          </Button>
          <p className="mt-2 text-center text-sm text-text-muted">
            {selected.size === 0
              ? 'Pick at least one chore to lock in your plan.'
              : 'These chores will be added to your list until you reach your goal.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
