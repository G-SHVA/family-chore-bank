import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { PiggyBank, Loader2 } from 'lucide-react'
import type { Milestone } from '@/lib/supabase'
import {
  getActiveGoal,
  getWeeklySavingsRate,
  createGoal,
  updateGoal,
  abandonGoal,
  markGoalAchieved,
  withGoalProgress,
  weeksToGoal,
  type SavingsRate,
} from '@/features/goals/goalService'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * The child's savings goal — a permanent fixture on their dashboard, not
 * something buried behind a tab.
 *
 * Progress is the child's CURRENT BALANCE against the target, so spending moves
 * the ring backwards. That is the whole point: the ring is what makes "should I
 * save or spend?" a visible trade-off rather than an abstraction.
 *
 * Owns its own data (the goal + the earning rate) so the dashboard only has to
 * hand it a balance.
 */

const GOLD_ANTIQUE = '#E0BC84'
const GREEN = '#4A9B6F'
const TRACK = '#262628'

export function SavingsGoalSection({
  memberId,
  familyId,
  balance,
  currency,
}: {
  memberId: string
  familyId: string
  balance: number
  currency: string
}) {
  const [goal, setGoal] = useState<Milestone | null>(null)
  const [rate, setRate] = useState<SavingsRate>({ perWeek: null, weeksUsed: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  /**
   * Holds the goal through its completion moment. Without it, marking the goal
   * achieved makes getActiveGoal return null and the card snaps straight to the
   * empty state — the child would never see the thing they earned.
   */
  const [justAchieved, setJustAchieved] = useState<Milestone | null>(null)
  /** Synchronous guard: a re-render must not fire a second achieve write. */
  const completing = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      setError(null)
      const [g, r] = await Promise.all([getActiveGoal(memberId), getWeeklySavingsRate(memberId)])
      setGoal(g)
      setRate(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your goal.')
    } finally {
      setLoading(false)
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-complete the first time the balance crosses the target, on load.
  useEffect(() => {
    if (!goal || goal.target_amount <= 0 || balance < goal.target_amount) return
    if (completing.current.has(goal.id)) return
    completing.current.add(goal.id)
    const reached = goal
    void (async () => {
      try {
        await markGoalAchieved(reached.id)
        setJustAchieved(reached)
        setGoal(null)
      } catch (e) {
        // The ring stays where it is and the child can still finish it from the
        // edit modal. Say what happened rather than failing silently.
        completing.current.delete(reached.id)
        setError(e instanceof Error ? e.message : 'Could not complete your goal.')
      }
    })()
  }, [goal, balance])

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-3 py-8 text-text-muted">
        <Loader2 className="h-6 w-6 animate-spin text-antique" />
        <span className="text-base">Loading your goal…</span>
      </Card>
    )
  }

  const progress = goal ? withGoalProgress(goal, balance) : null
  const weeks = progress ? weeksToGoal(progress.remaining, rate.perWeek) : null

  return (
    <>
      {error && (
        <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-base text-danger">
          {error}
        </div>
      )}

      {justAchieved ? (
        <GoalAchievedCard
          goal={justAchieved}
          currency={currency}
          onDone={() => {
            setJustAchieved(null)
            void load()
          }}
        />
      ) : progress ? (
        // Always stacked. A `sm:flex-row` here would key off the VIEWPORT while
        // this card actually lives in a ~330px dashboard column, so on a wide
        // tablet it went side-by-side inside a narrow column and every line
        // wrapped. The column scrolls, so the extra height is free.
        <Card className="flex flex-col items-center gap-3">
          <GoalRing pct={progress.progressPct} size={120} />
          <div className="min-w-0 w-full text-center">
            <div className="label-caps text-[11px] text-text-muted">My savings goal</div>
            <div className="display mt-0.5 truncate text-2xl text-text">{goal!.title}</div>
            <div className="mt-1 text-lg text-text-muted">
              <span className="font-semibold text-antique">
                {formatCurrency(progress.savedAmount, currency)}
              </span>{' '}
              of {formatCurrency(goal!.target_amount, currency)} · {progress.progressPct}%
            </div>
            <div className="mt-1 text-lg font-semibold text-antique">
              You need {formatCurrency(progress.remaining, currency)} more
            </div>
            {weeks !== null && (
              <div className="mt-0.5 text-base text-text-muted">
                About {weeks} {weeks === 1 ? 'week' : 'weeks'} at your current rate
              </div>
            )}
            <button
              onClick={() => setEditing(true)}
              className="label-caps mt-2 min-h-touch text-[11px] text-text-muted underline underline-offset-4 hover:text-antique"
            >
              Edit goal
            </button>
          </div>
        </Card>
      ) : (
        <Card
          interactive
          onClick={() => setEditing(true)}
          className="flex items-center gap-4"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setEditing(true)
            }
          }}
        >
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-antique/40 bg-wash text-antique">
            <PiggyBank className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <div className="display text-2xl text-text">Set a savings goal</div>
            <div className="text-lg text-text-muted">What are you saving up for?</div>
          </div>
        </Card>
      )}

      {/* Each handler below reloads BEFORE closing. Closing first left the modal
          dismissable while the refetch was still in flight, so re-opening it in
          that window showed the previous goal's values — a child who abandoned a
          goal and immediately tapped "Set a savings goal" got the edit form for
          the goal they had just dropped. Staying open through the write also
          keeps the button's "Saving…" state honest. */}
      <GoalModal
        open={editing}
        goal={goal}
        rate={rate}
        balance={balance}
        currency={currency}
        onClose={() => setEditing(false)}
        onSave={async (title, target) => {
          if (goal) await updateGoal(goal.id, title, target)
          else await createGoal(familyId, memberId, title, target)
          await load()
          setEditing(false)
        }}
        onAbandon={async () => {
          if (!goal) return
          await abandonGoal(goal.id)
          await load()
          setEditing(false)
        }}
        onMarkAchieved={async () => {
          if (!goal) return
          const reached = goal
          completing.current.add(reached.id)
          await markGoalAchieved(reached.id)
          setJustAchieved(reached)
          setGoal(null)
          setEditing(false)
        }}
      />
    </>
  )
}

/**
 * Antique-gold progress ring. The fill animates from wherever it was to the new
 * value, so a chore approval visibly advances it rather than cutting.
 */
export function GoalRing({
  pct,
  size = 132,
  stroke = 8,
  done,
}: {
  pct: number
  size?: number
  stroke?: number
  done?: boolean
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const half = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={half} cy={half} r={r} fill="none" stroke={TRACK} strokeWidth={stroke} />
      <motion.circle
        cx={half}
        cy={half}
        r={r}
        fill="none"
        stroke={done ? GREEN : GOLD_ANTIQUE}
        strokeWidth={stroke}
        strokeLinecap="butt"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c - (Math.min(100, pct) / 100) * c }}
        transition={{ type: 'spring', stiffness: 60, damping: 18 }}
        transform={`rotate(-90 ${half} ${half})`}
      />
      <text
        x={half}
        y={half + 7}
        textAnchor="middle"
        className={cn('display', done ? 'fill-green' : 'fill-antique')}
        style={{ fontSize: size * 0.24, fontWeight: 600 }}
      >
        {Math.min(100, pct)}%
      </text>
    </svg>
  )
}

/**
 * The completion moment. There was no existing badge-unlock burst in the app to
 * reuse — Achievements only prints a green "Unlocked!" label — so this is the
 * first one.
 */
function GoalAchievedCard({
  goal,
  currency,
  onDone,
}: {
  goal: Milestone
  currency: string
  onDone: () => void
}) {
  return (
    <Card className="flex flex-col items-center gap-3 py-6 text-center">
      <div className="relative flex items-center justify-center">
        <Burst />
        <GoalRing pct={100} size={132} done />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
      >
        <div className="label-caps text-[11px] text-green">Goal reached</div>
        <div className="display mt-1 text-3xl text-text">{goal.title}</div>
        <div className="mt-1 text-lg text-text-muted">
          You saved {formatCurrency(goal.target_amount, currency)}
        </div>
      </motion.div>
      <Button variant="accent" size="lg" onClick={onDone} className="mt-1">
        Set a new goal
      </Button>
    </Card>
  )
}

/** Twelve gold rays flung outward once. Purely decorative, so aria-hidden. */
function Burst() {
  const rays = Array.from({ length: 12 })
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {rays.map((_, i) => {
        const angle = (i / rays.length) * 2 * Math.PI
        return (
          <motion.span
            key={i}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: GOLD_ANTIQUE }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
            animate={{
              opacity: [0, 1, 0],
              x: Math.cos(angle) * 92,
              y: Math.sin(angle) * 92,
              scale: [0.4, 1.1, 0.5],
            }}
            transition={{ duration: 1, delay: 0.05 + i * 0.015, ease: 'easeOut' }}
          />
        )
      })}
    </div>
  )
}

/**
 * Set / edit a goal. Deliberately large and plain — this is a child-facing
 * form on a wall tablet, so every control clears the 64px touch target and no
 * text drops below 18px.
 */
function GoalModal({
  open,
  goal,
  rate,
  balance,
  currency,
  onClose,
  onSave,
  onAbandon,
  onMarkAchieved,
}: {
  open: boolean
  goal: Milestone | null
  rate: SavingsRate
  balance: number
  currency: string
  onClose: () => void
  onSave: (title: string, target: number) => Promise<void>
  onAbandon: () => Promise<void>
  onMarkAchieved: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false)

  // Reset each time the modal opens so a cancelled edit never leaks into the
  // next one.
  useEffect(() => {
    if (!open) return
    setTitle(goal?.title ?? '')
    setTarget(goal ? String(goal.target_amount) : '')
    setError(null)
    setConfirmAbandon(false)
  }, [open, goal])

  const parsedTarget = Number.parseFloat(target)
  const targetValid = Number.isFinite(parsedTarget) && parsedTarget > 0
  const blockReason: string | null = !title.trim()
    ? 'Give your goal a name.'
    : !targetValid
      ? 'Enter how much you need to save.'
      : null

  const remaining = targetValid ? Math.max(0, parsedTarget - balance) : 0
  const weeks = weeksToGoal(remaining, rate.perWeek)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const fieldClass =
    'w-full min-h-touch rounded-input border border-line bg-deep p-3 text-lg text-text focus:border-antique focus:outline-none'

  return (
    <Modal open={open} onClose={onClose} title={goal ? 'My savings goal' : undefined}>
      {!goal && (
        <h2 className="mb-5 text-3xl text-text">What are you saving for?</h2>
      )}

      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="goal-title" className="label-caps mb-2 block text-[11px] text-text-muted">
            Goal name
          </label>
          <input
            id="goal-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. New headphones"
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="goal-target" className="label-caps mb-2 block text-[11px] text-text-muted">
            How much does it cost?
          </label>
          <input
            id="goal-target"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="0.00"
            className={fieldClass}
          />
        </div>

        {/* How much do I need to save? Based on chores only — a Direct Award is
            a parent's gift, and counting it here would break the link between
            the work done and the goal getting closer. */}
        {targetValid && (
          <div className="rounded-input border border-line bg-deep px-4 py-3 text-base text-text-muted">
            <div>
              You have{' '}
              <span className="font-semibold text-antique">{formatCurrency(balance, currency)}</span>
              {remaining > 0 ? (
                <>
                  {' '}
                  — {formatCurrency(remaining, currency)} to go.
                </>
              ) : (
                <> — enough already!</>
              )}
            </div>
            {rate.perWeek === null ? (
              <div className="mt-1">Complete some chores to see your savings estimate.</div>
            ) : weeks !== null ? (
              <div className="mt-1">
                At your current rate of{' '}
                <span className="font-semibold text-antique">
                  {formatCurrency(rate.perWeek, currency)}
                </span>
                /week from chores, about{' '}
                <span className="font-semibold text-antique">
                  {weeks} {weeks === 1 ? 'week' : 'weeks'}
                </span>
                .
              </div>
            ) : null}
          </div>
        )}

        {error && <p className="text-base text-danger">{error}</p>}

        <Button
          variant="primary"
          fullWidth
          size="lg"
          disabled={!!blockReason || busy}
          onClick={() => run(() => onSave(title, parsedTarget))}
        >
          {busy ? 'Saving…' : goal ? 'Save changes' : 'Save goal'}
        </Button>
        {blockReason && <p className="text-center text-base text-text-muted">{blockReason}</p>}

        {goal && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <Button
              variant="accent"
              fullWidth
              size="lg"
              disabled={busy}
              onClick={() => run(onMarkAchieved)}
            >
              Mark as achieved
            </Button>
            {confirmAbandon ? (
              <div className="flex flex-col gap-2">
                <p className="text-center text-base text-text-muted">
                  Give up on “{goal.title}”? It stays in your history.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={() => setConfirmAbandon(false)}
                    disabled={busy}
                  >
                    Keep it
                  </Button>
                  <Button variant="danger" fullWidth disabled={busy} onClick={() => run(onAbandon)}>
                    Abandon goal
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                fullWidth
                disabled={busy}
                onClick={() => setConfirmAbandon(true)}
              >
                Abandon goal
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
