import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Landmark, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getTransactionHistory,
  getMonthlyBankSummary,
  getMemberBalance,
  type LedgerPage,
  type MonthlySummary,
} from '@/features/bank/bankService'
import { BalanceDisplay } from '@/components/shared/BalanceDisplay'
import { Card } from '@/components/ui/Card'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { EmptyState } from '@/components/shared/EmptyState'
import { MonthlySummaryCard } from '@/components/shared/MonthlySummaryCard'
import { getActiveGoal } from '@/features/goals/goalService'
import { getChildLoanState, type ChildLoanState } from '@/features/loans/loanService'
import { LoanRequestModal } from '@/components/shared/LoanRequestModal'
import { PurchaseRequestModal } from '@/components/shared/PurchaseRequestModal'
import {
  getChildPurchaseRequests,
  parseMemberTag,
  type PurchaseRequest,
} from '@/features/expenses/expenseService'
import { cn, formatCurrency } from '@/lib/utils'
import {
  addDays,
  endOfMonth,
  formatDateInZone,
  startOfMonth,
  startOfWeek,
} from '@/lib/time'

export default function ChildBank() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  // The AUTHORITATIVE balance, not a sum of the ledger. See getMemberBalance.
  const [balance, setBalance] = useState(0)
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  // Only whether a goal exists — the "saved toward goal" figure is meaningless
  // without one, and the card needs no other detail about it.
  const [hasActiveGoal, setHasActiveGoal] = useState(false)
  const [loans, setLoans] = useState<ChildLoanState>({
    active: null,
    requested: null,
    resolved: null,
  })
  const [loanModalOpen, setLoanModalOpen] = useState(false)
  const [buyModalOpen, setBuyModalOpen] = useState(false)
  const [requests, setRequests] = useState<PurchaseRequest[]>([])
  const [loading, setLoading] = useState(true)

  const reloadLoans = useCallback(() => {
    if (!memberId) return
    void getChildLoanState(memberId).then(setLoans)
  }, [memberId])

  const reloadRequests = useCallback(() => {
    if (!memberId || !family?.id) return
    void getChildPurchaseRequests(family.id, memberId).then(setRequests)
  }, [memberId, family?.id])

  useEffect(() => {
    if (!memberId) return
    void (async () => {
      const [b, s, goal, loanState] = await Promise.all([
        // ONE INDEXED SINGLE-ROW READ, in place of getTransactionHistory's two
        // UNBOUNDED selects. The ledger is now fetched only if the child opens
        // Transaction History — see TransactionHistorySection below.
        getMemberBalance(memberId),
        getMonthlyBankSummary(memberId),
        getActiveGoal(memberId),
        // The same single bounded read the dashboard uses. It answers both
        // gating questions -- is there an active loan, is there an unanswered
        // request -- in one round trip, so the entry point below costs one
        // query rather than two. My Bank has no formal read budget the way the
        // dashboard does, but the rule it exists to serve still applies.
        getChildLoanState(memberId),
      ])
      if (family?.id) setRequests(await getChildPurchaseRequests(family.id, memberId))
      setBalance(b)
      setSummary(s)
      setHasActiveGoal(goal !== null)
      setLoans(loanState)
      setLoading(false)
    })()
  }, [memberId])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
      </div>
    )
  }

  const familyId = family?.id
  // Both halves of the one-at-a-time rule. The unique index is the layer
  // that survives two tablets; this is what stops the child meeting it.
  const canRequestLoan = !loans.active && !loans.requested

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="mb-4">
        <div className="label-caps text-[11px] text-text-muted">Current balance</div>
        {/* A NEGATIVE BALANCE IS MUTED WARM GREY, never red and never gold —
            the same rule the child dashboard applies. Overdrafts are allowed by
            design (a loan payment may deliberately create one), so the minus
            sign is the message and colouring it as alarm or as reward both
            misread it. This card only started needing the branch when it began
            showing the authoritative balance instead of a ledger sum. */}
        <BalanceDisplay
          amount={balance}
          currency={currency}
          className={cn(
            'mt-2 block text-[56px] leading-none',
            balance < 0 ? 'text-text-muted' : 'text-gold'
          )}
        />
      </Card>

      {/* The month's shape, directly under the balance and above the ledger.
          The earned/spent pair that used to sit inside the balance card lives
          here now — printing the same two figures twice, inches apart, made
          neither one authoritative. */}
      {summary && (
        <MonthlySummaryCard
          summary={summary}
          currency={currency}
          hasActiveGoal={hasActiveGoal}
        />
      )}

      {/* PENDING REQUESTS SIT ABOVE THE LEDGER, unlike the request links which
          sit below it. The ledger answers "where did my money go"; an
          outstanding request is money that has NOT gone anywhere yet, and an
          answered one carries the parent's reason. Both are news, and news
          belongs above the archive.

          Answered rows stay for 48 hours (see getChildPurchaseRequests) so a
          decline does not vanish before the child reads why. */}
      {requests.length > 0 && (
        <div className="mb-6">
          {/* HIDDEN WHEN EMPTY, same as Loan History — a section header
              announcing nothing is a screen telling a child to look at
              something that isn't there. Collapsed when present: an
              outstanding request is news the child already knows they made,
              so the count in the header is the whole message and the detail
              (the parent's decline note) is one tap away. */}
          <CollapsibleSection
            title="Pending requests"
            meta={`${requests.length}`}
            maxHeight={PENDING_MAX_HEIGHT}
            variant="label"
          >
            <div className="overflow-hidden rounded-card border border-line">
              {requests.map((r, idx) => {
                const { reason } = parseMemberTag(r.description)
                return (
                  <div
                    key={r.id}
                    className={cn('bg-card px-4 py-4', idx > 0 && 'border-t border-line')}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1 truncate font-medium text-text">{r.title}</div>
                      <div className="tabular-nums text-antique">
                        {formatCurrency(r.amount, currency)}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                      <span
                        className={cn(
                          'label-caps text-[10px]',
                          r.status === 'approved'
                            ? 'text-green'
                            : r.status === 'declined'
                              ? 'text-antique'
                              : 'text-text-muted'
                        )}
                      >
                        {r.status === 'approved'
                          ? 'Approved'
                          : r.status === 'declined'
                            ? 'Not this time'
                            : 'Waiting for your parent'}
                      </span>
                      {reason && <span className="text-sm text-text-muted">{reason}</span>}
                    </div>
                    {/* The parent's answer, which is the reason a declined row
                        stays visible at all. */}
                    {r.status === 'declined' && r.decline_note && (
                      <p className="mt-1 text-sm leading-snug text-text-muted">{r.decline_note}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {/* THE LEDGER IS COLLAPSED, AND THAT IS THE POINT OF THIS SCREEN.
          My Bank's one job is "what do I have"; a hundred rows of history led
          the screen and made it read as a ledger rather than a bank. The body
          stays UNMOUNTED until first open (CollapsibleSection.hasOpened), and
          TransactionHistorySection fetches in its own mount effect — so
          getTransactionHistory's two unbounded selects cost a normal load
          nothing at all. */}
      {/* `variant="label"` because every other label on this screen — CURRENT
          BALANCE, EARNED THIS MONTH, REQUEST A LOAN — is label-caps Inter
          muted. A 24px Cormorant heading was the only element here not in that
          voice, which made the section read as a different screen's furniture.
          It is a PROP and not a className: see the note in CollapsibleSection. */}
      <CollapsibleSection
        title="Transaction history"
        maxHeight={HISTORY_MAX_HEIGHT}
        variant="label"
      >
        {memberId && (
          <TransactionHistorySection memberId={memberId} currency={currency} balance={balance} />
        )}
      </CollapsibleSection>

      {/* REQUESTS LIVE BELOW THE LEDGER, not above it. My Bank's one job is
          "what do I have and where did it go"; asking for something is a
          different job that belongs after the answer, not in front of it.
          Understated text links rather than buttons for the same reason the
          claim library's entry point is one -- see "Browse available chores".

          The loan link is GATED, not disabled-and-shown. A child holding an
          active loan or an unanswered request has nothing to do here, and a
          greyed-out control invites tapping to find out why. */}
      {canRequestLoan && (
        <div className="mt-6 flex flex-col items-start gap-1 px-1">
          <button
            type="button"
            onClick={() => setLoanModalOpen(true)}
            className="label-caps flex min-h-touch items-center gap-2 text-[11px] text-antique hover:text-gold"
          >
            Request a loan
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* NO GATE ON THIS ONE, deliberately. A child may want several things at
          once and let a parent choose between them, which is a better
          conversation than forcing them to pick first. See the truncation note
          on getPurchaseRequests for what that costs. */}
      <div className={cn('flex flex-col items-start gap-1 px-1', canRequestLoan ? '' : 'mt-6')}>
        <button
          type="button"
          onClick={() => setBuyModalOpen(true)}
          className="label-caps flex min-h-touch items-center gap-2 text-[11px] text-antique hover:text-gold"
        >
          Request a purchase
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {familyId && memberId && (
        <LoanRequestModal
          open={loanModalOpen}
          onClose={() => setLoanModalOpen(false)}
          onSubmitted={reloadLoans}
          familyId={familyId}
          memberId={memberId}
          currency={currency}
        />
      )}

      {familyId && memberId && (
        <PurchaseRequestModal
          open={buyModalOpen}
          onClose={() => setBuyModalOpen(false)}
          onSubmitted={reloadRequests}
          familyId={familyId}
          memberId={memberId}
          currency={currency}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Transaction history — deferred read + range filter
 * ------------------------------------------------------------------ */

/** Height caps for the two collapsible bodies. */
const PENDING_MAX_HEIGHT = 320
const HISTORY_MAX_HEIGHT = 520

type LedgerRange = 'week' | 'month' | 'last' | 'all'

const LEDGER_RANGES: { key: LedgerRange; label: string }[] = [
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'last', label: 'Last Month' },
  { key: 'all', label: 'All' },
]

/**
 * The window a range covers, or null for "All" (no bounds at all).
 *
 * EVERY BOUNDARY RESOLVES IN THE FAMILY'S ZONE. startOfWeek / startOfMonth /
 * endOfMonth all default to lib/time's active zone, which AuthProvider points
 * at families.timezone before any screen mounts. No timezone literal appears
 * here, and none may — see the timezone reconciliation note in CLAUDE.md.
 *
 * Weeks start MONDAY, because startOfWeek does; that is the same boundary
 * Family Week and the streak paths use, so a child's "this week" is the same
 * week their parent sees.
 *
 * Last month is anchored by stepping ONE DAY BACK from the first of this month
 * rather than by subtracting from the month number, so it needs no wrap-around
 * arithmetic in January, and it goes through addDays, which is DST-safe.
 */
function ledgerBounds(key: LedgerRange): { from: Date; to: Date } | null {
  if (key === 'all') return null
  const now = new Date()
  if (key === 'week') return { from: startOfWeek(now), to: now }
  if (key === 'month') return { from: startOfMonth(now), to: now }
  return { from: ledgerFetchSince(now), to: endOfMonth(addDays(startOfMonth(now), -1)) }
}

/**
 * The lower bound of the ONE bounded fetch — the first of LAST month. Every
 * range except All is a subset of [here, now], which is what lets This Week,
 * This Month and Last Month share a single read and switch between each other
 * for free. Last Month's own `from` is derived from this same function so the
 * fetch window and the filter window cannot drift apart.
 */
function ledgerFetchSince(now: Date = new Date()): Date {
  return startOfMonth(addDays(startOfMonth(now), -1))
}

/**
 * The ledger, and the ONLY thing on this screen that reads it.
 *
 * THIS COMPONENT'S MOUNT *IS* THE FIRST EXPAND. It is passed as
 * CollapsibleSection's `children`, and that body stays unmounted until the
 * section is first opened — so the effect below runs once, on the child's first
 * tap, and never at all on a load where they only wanted their balance. React
 * creates the element on every Bank render, but creating an element does not
 * run a component. After the first open the section stays mounted, so
 * collapsing and re-expanding re-renders already-fetched rows rather than
 * re-reading them.
 *
 * TWO TIERS, TWO READS AT MOST. The mount effect fetches ONE date-bounded
 * window from the first of last month (ledgerFetchSince), which This Week,
 * This Month and Last Month all filter client-side — switching between those
 * three costs no read. All is fetched separately, capped and newest-first, on
 * the child's FIRST tap of that pill and then held. See getTransactionHistory
 * for the horizon trim and the balance anchor that make the capped read honest.
 */
function TransactionHistorySection({
  memberId,
  currency,
  balance,
}: {
  memberId: string
  currency: string
  balance: number
}) {
  const [recent, setRecent] = useState<LedgerPage | null>(null)
  const [all, setAll] = useState<LedgerPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  // This Month, not All. A child opening their history wants the period they
  // are living in; the full archive is one tap further and one read dearer.
  const [range, setRange] = useState<LedgerRange>('month')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const page = await getTransactionHistory(memberId, { since: ledgerFetchSince(), balance })
        if (alive) setRecent(page)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load your history.')
      }
    })()
    return () => {
      alive = false
    }
    // `balance` is read once at mount on purpose: the section mounts after the
    // screen has loaded it, and re-fetching the ledger because a prop ticked
    // would re-issue the read this whole design exists to avoid.
  }, [memberId])

  // The All tier, fetched once on first demand and never on load.
  useEffect(() => {
    if (range !== 'all' || all !== null) return
    let alive = true
    void (async () => {
      try {
        const page = await getTransactionHistory(memberId, { since: null, balance })
        if (alive) setAll(page)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load your history.')
      }
    })()
    return () => {
      alive = false
    }
  }, [range, all, memberId])

  const page = range === 'all' ? all : recent
  const loading = page === null && error === null
  const txns = page?.transactions ?? []
  const bounds = ledgerBounds(range)
  const visible = bounds
    ? txns.filter((t) => {
        const d = new Date(t.date)
        return d >= bounds.from && d <= bounds.to
      })
    : txns

  /* RUNNING BALANCE ONLY UNDER "All". Every row's runningBalance is its
     position in the FULL history, so against a filtered subset the column
     appears to jump by amounts no visible row explains. A child who cannot
     reconcile the numbers in front of them stops trusting the account, which
     is the one thing this screen exists to build. The correct figures are one
     tap away under All. */
  const showRunning = range === 'all'

  return (
    <div className="flex flex-col gap-3 pb-1">
      {/* STICKY INSIDE THE SCROLL PANE, so the range a child picked stays
          visible while they scroll the rows it produced. */}
      <div className="sticky top-0 z-10 bg-bg pb-1">
        {/* CAPPED AT max-w-md, STILL A 4-COLUMN GRID. Left to fill the
            container these stretched to ~185px each on a tablet, which is what
            made them read as four buttons rather than a filter. The grid (not
            content-width pills) is what guarantees ONE ROW at any width: at
            390px the four share 342px and shrink together instead of wrapping,
            which content-sized pills would do once the labels no longer fit. */}
        <div
          role="radiogroup"
          aria-label="Date range"
          className="grid max-w-md grid-cols-4 gap-1"
        >
          {LEDGER_RANGES.map((o) => {
            const selected = range === o.key
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setRange(o.key)}
                // A FLAT 44px, AND 44 IS THE FLOOR — not a preference.
                // SchedulePicker's day pills step up to h-14 (56px) from md,
                // which read as heavy here: these are a filter, not the
                // screen's work, and they sit directly under a 56px balance
                // figure that should out-weigh them. But they are CHILD-facing
                // touch targets, so they stop at the Apple/Google 44px minimum
                // the codebase already treats as the floor (Button
                // `lgResponsive`); anything smaller is a control a child
                // mis-taps. Do not shrink these further without shrinking the
                // hit area some other way.
                className={cn(
                  'flex h-11 items-center justify-center rounded-input border px-1 text-xs',
                  'font-semibold transition-colors',
                  selected
                    ? 'border-antique bg-antique text-deep'
                    : 'border-line text-text-muted hover:border-antique/40 hover:text-text'
                )}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-antique" />
        </div>
      ) : error ? (
        <p className="py-6 text-center text-sm text-danger">{error}</p>
      ) : txns.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No transactions yet"
          subtitle="Approved chores and expenses will appear here."
        />
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No transactions in this period.</p>
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          {visible.map((t, idx) => (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-4 bg-card px-4 py-4',
                idx > 0 && 'border-t border-line'
              )}
            >
              <div
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full',
                  t.type === 'income' ? 'bg-green/15 text-green' : 'bg-danger/15 text-danger'
                )}
              >
                {t.type === 'income' ? (
                  <ArrowUpRight className="h-5 w-5" />
                ) : (
                  <ArrowDownRight className="h-5 w-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">{t.description}</div>
                <div className="label-caps text-[10px] text-text-muted">
                  {formatDateInZone(new Date(t.date), { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div className="text-right">
                <div className={cn('font-bold', t.type === 'income' ? 'text-green' : 'text-danger')}>
                  {t.type === 'income' ? '+' : '−'}
                  {formatCurrency(t.amount, currency)}
                </div>
                {showRunning && (
                  <div className="text-xs tabular-nums text-text-muted">
                    {formatCurrency(t.runningBalance, currency)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Only when a select actually hit its cap. Says what IS shown rather than
          what is missing: the rows here are complete and every running figure
          on them is exact, which is the honest thing to tell a child. */}
      {page?.truncated && visible.length > 0 && (
        <p className="px-1 text-center text-xs text-text-muted">
          Showing your {visible.length} most recent transactions.
        </p>
      )}
    </div>
  )
}
