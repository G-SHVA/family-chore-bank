import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Flame, AlertTriangle } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  getChildDashboard,
  markChoreComplete,
  isActionable,
  type ChildDashboardData,
  type AssignmentWithChore,
} from '@/features/chores/choreService'
import { BalanceDisplay } from '@/components/shared/BalanceDisplay'
import { ChoreCard } from '@/components/shared/ChoreCard'
import { Card } from '@/components/ui/Card'
import { SavingsGoalSection } from '@/components/shared/SavingsGoal'
import { CharacterMomentBanner } from '@/components/shared/CharacterMomentBanner'
import { LoanLine, LoanResolvedBanner } from '@/components/shared/LoanLine'
import { getChildLoanState, type ChildLoanState } from '@/features/loans/loanService'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * ONE SCREEN ONE JOB — the child Home screen.
 *
 * Its job is: what am I worth, and what can I do right now. Two zones, one
 * dominant element each — the balance figure, and the actionable chore list.
 *
 * WHAT WAS REMOVED, 2026-09-03, and why (measured on POCO's live data):
 *
 *  - The four stat cards (completed this week / pending approval / due today /
 *    completion rate), 210px. Not relocated — Achievements ALREADY rendered
 *    the same figures, so Home was duplicating a reporting screen. "Pending
 *    approval" and "due today" restated the very list rendered beside them.
 *    Completion rate is gone from every child-facing surface: it measures
 *    roster size (85 active entries across two children), not the child's
 *    effort, and no child should be handed that number daily.
 *
 *  - The ALL / TO DO / PENDING chips. Home shows today's work; the Chores tab
 *    owns filtering and already has four filters.
 *
 *  - 88 of 90 chore cards, via getHomeChores rather than the render. Home was
 *    showing 90 cards — 56 rejected, 32 lapsed, 2 actionable — across 19,511px
 *    of scroll. Rejections and misses moved to the Chores tab, grouped under a
 *    collapsed "Recent misses" so the lesson stays reachable without being the
 *    first thing a child sees.
 *
 * The left column measured 1,010px against 559px of usable height at 1024x768,
 * so 45% of it — including the savings goal entirely — sat below the fold. It
 * now fits without scrolling in every state.
 */
export default function ChildDashboard() {
  const { memberId } = useParams()
  const { family, operatorMemberId } = useAuth()
  const currency = family?.currency ?? 'USD'
  const familyId = family?.id
  const [data, setData] = useState<ChildDashboardData | null>(null)
  const [loans, setLoans] = useState<ChildLoanState>({ active: null, resolved: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Dismissed one-off banners — character recognitions AND resolved loans.
  // One set serves both: the ids are row uuids from different tables, so they
  // cannot collide, and both are "a moment the child acknowledges once".
  // sessionStorage, NOT the database and NOT plain component state:
  //   - the database would mean a schema change for a banner;
  //   - plain state resets whenever this component unmounts, so a child who
  //     dismissed the banner and tapped through to Chores and back would be
  //     shown it again, which reads as the dismiss button being broken.
  // sessionStorage survives navigation inside the session and clears when the
  // tab closes — and seeing a recognition once more after a full restart is
  // harmless, so that expiry is a feature rather than a limitation.
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed(memberId))

  function dismissMoment(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(id)
      writeDismissed(memberId, next)
      return next
    })
  }

  const load = useCallback(async () => {
    if (!memberId) return
    try {
      setError(null)
      // NO generation here. Children must never trigger a generation pass:
      // this loader also runs after every completion, so a child working
      // through their list fired a full roster pass per chore (five in 41
      // seconds, observed). Generation belongs to the parent dashboard.
      // One extra round trip, and only one: getChildLoanState answers both
      // "do I owe anything" and "was a loan just resolved" in a single read.
      const [dash, loanState] = await Promise.all([
        getChildDashboard(memberId),
        getChildLoanState(memberId),
      ])
      setData(dash)
      setLoans(loanState)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.')
    } finally {
      setLoading(false)
    }
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleComplete(assignmentId: string) {
    // Optimistic: flip the card to "completed" immediately.
    setData((prev) =>
      prev
        ? {
            ...prev,
            activeChores: prev.activeChores.map((c) =>
              c.id === assignmentId ? { ...c, status: 'completed' } : c
            ),
          }
        : prev
    )
    try {
      await markChoreComplete(assignmentId)
    } finally {
      await load() // reconcile with server
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
        <p className="text-text-muted">Loading your bank…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-danger" />
        <p className="max-w-md text-text-muted">{error ?? 'No data.'}</p>
      </div>
    )
  }

  // Work first, then what is waiting on a parent. Within each group, soonest
  // first — the query orders DESC so the rows survive its cap, which is the
  // opposite of what a to-do list wants to read.
  const chores = sortForDisplay(data.activeChores)

  const moments = data.characterMoments
    .filter((m) => !dismissed.has(m.id))
    // Resolve the name a CHILD should read. A recognition submitted while the
    // tablet sat on the shared operator account would otherwise surface that
    // account's display name — an internal detail no child should be shown —
    // so it degrades to "Your parent". Matched on member id, not the string
    // 'Kiosk', because the operator row is renameable like any other member.
    .map((m) =>
      m.awardedByMemberId && m.awardedByMemberId === operatorMemberId
        ? { ...m, awardedBy: null }
        : m
    )

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-6 overflow-hidden lg:flex-row">
      {/* Zone 1 — where I stand. Every card here carries shrink-0: this is a
          height-constrained flex column, and a flex child without it is
          silently compressed instead of pushing the column into scroll. */}
      <div className="scroll-skin flex shrink-0 flex-col gap-4 lg:w-2/5 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
        {/* Above the balance, because being noticed is the headline — the money
            is the footnote. Renders nothing at all when there is no moment. */}
        <CharacterMomentBanner
          moments={moments}
          currency={currency}
          onDismiss={dismissMoment}
        />

        {/* Resolved within 48h, derived from loans.paid_off_at — no
            notifications table, no new rows. Sits where the recognition
            banner sits, because it is the same kind of moment. */}
        <AnimatePresence initial={false}>
          {loans.resolved && !dismissed.has(loans.resolved.id) && (
            <LoanResolvedBanner
              key={loans.resolved.id}
              loan={loans.resolved}
              onDismiss={dismissMoment}
            />
          )}
        </AnimatePresence>

        <Card className="shrink-0">
          <div className="label-caps text-[11px] text-text-muted">Current balance</div>
          <BalanceDisplay
            amount={data.balance}
            currency={currency}
            className={cn(
              'mt-2 block text-[56px] leading-none',
              // A negative balance is muted warm grey, never red and never
              // gold. It is a fact, not an emergency: the minus sign is the
              // whole message, and the "I owe" line below explains it. Gold is
              // reserved for money the child actually has.
              data.balance < 0 ? 'text-text-muted' : 'text-gold'
            )}
          />

          {/* Inside the balance card, on a hairline, because a loan is a claim
              against this exact number. Renders nothing when there is no
              active loan — no placeholder, no "$0.00 owed". */}
          {loans.active && <LoanLine loan={loans.active} currency={currency} />}

          {/* One compact line, not two stat cards. Earned-this-week and the
              streak are context for the figure above them, so they belong
              inside its card rather than competing with it from outside. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-text-muted">
              Earned this week:{' '}
              <span className="font-semibold text-text">
                {formatCurrency(data.weeklyEarnings, currency)}
              </span>
            </span>
            {data.currentStreak > 0 && (
              <span className="label-caps flex items-center gap-1 text-[11px] text-antique">
                <Flame className="h-4 w-4" /> {data.currentStreak} day streak
              </span>
            )}
          </div>
        </Card>

        {/* A permanent fixture, not a tab: the goal is what turns a balance into
            something the child is working toward. Compact here — the full
            reading and every action are one tap away in its modal. */}
        {memberId && familyId && (
          <SavingsGoalSection
            compact
            memberId={memberId}
            familyId={familyId}
            balance={data.balance}
            currency={currency}
          />
        )}
      </div>

      {/* Zone 2 — what I can do. Scrolls inside its own contained area. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:w-3/5">
        <h2 className="shrink-0 text-2xl text-text">My Chores</h2>

        {chores.length === 0 ? (
          <Card className="py-12 text-center text-text-muted">
            Nothing left to do right now. Nice work.
          </Card>
        ) : (
          <div className="scroll-panel flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-2">
            <AnimatePresence initial={false}>
              {chores.map((c) => (
                <ChoreCard
                  key={c.id}
                  assignment={c}
                  currency={currency}
                  onComplete={handleComplete}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Actionable chores first, then the ones waiting on a parent; soonest due
 * first inside each group.
 *
 * Sorted here rather than in the query on purpose. getHomeChores orders
 * due_date DESC so that the rows surviving its row cap are the newest — the
 * rule CLAUDE.md sets for every read of this table — and that is precisely the
 * wrong order to read a to-do list in. The cap is a safety net for the query;
 * the ordering a child sees is a display decision.
 */
function sortForDisplay(chores: AssignmentWithChore[]): AssignmentWithChore[] {
  const rank = (c: AssignmentWithChore) => (isActionable(c) ? 0 : 1)
  return [...chores].sort((a, b) => {
    const byGroup = rank(a) - rank(b)
    if (byGroup !== 0) return byGroup
    const da = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
    const db = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
    return da - db
  })
}

/**
 * Per-child dismissal keys, so one child dismissing their banner never hides
 * the other child's on a shared tablet.
 *
 * Every access is guarded: sessionStorage throws outright in some embedded and
 * privacy-restricted contexts, and a celebration banner must never be the
 * reason a child's dashboard fails to render. On any error we fall back to
 * "nothing dismissed", which shows the banner — the harmless direction.
 */
function dismissKey(memberId: string | undefined): string {
  return `fcb.characterMoments.dismissed.${memberId ?? 'unknown'}`
}

function readDismissed(memberId: string | undefined): Set<string> {
  try {
    const raw = sessionStorage.getItem(dismissKey(memberId))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

function writeDismissed(memberId: string | undefined, ids: Set<string>): void {
  try {
    sessionStorage.setItem(dismissKey(memberId), JSON.stringify([...ids]))
  } catch {
    // Dismissal degrades to this-mount-only. Not worth surfacing to a child.
  }
}
