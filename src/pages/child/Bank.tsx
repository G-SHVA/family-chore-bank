import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Landmark, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getTransactionHistory,
  getMonthlyBankSummary,
  type Transaction,
  type MonthlySummary,
} from '@/features/bank/bankService'
import { BalanceDisplay } from '@/components/shared/BalanceDisplay'
import { Card } from '@/components/ui/Card'
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
import { formatDateInZone } from '@/lib/time'

export default function ChildBank() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const [txns, setTxns] = useState<Transaction[]>([])
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
      const [t, s, goal, loanState] = await Promise.all([
        getTransactionHistory(memberId),
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
      setTxns(t)
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

  const balance = txns[0]?.runningBalance ?? 0
  const familyId = family?.id
  // Both halves of the one-at-a-time rule. The unique index is the layer
  // that survives two tablets; this is what stops the child meeting it.
  const canRequestLoan = !loans.active && !loans.requested

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="mb-4">
        <div className="label-caps text-[11px] text-text-muted">Current balance</div>
        <BalanceDisplay
          amount={balance}
          currency={currency}
          className="mt-2 block text-[56px] leading-none text-gold"
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
        <section className="mb-6">
          <h2 className="mb-3 px-1 text-2xl">Pending requests</h2>
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
        </section>
      )}

      <h2 className="mb-3 px-1 text-2xl">Transaction history</h2>
      {txns.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No transactions yet"
          subtitle="Approved chores and expenses will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          {txns.map((t, idx) => (
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
                <div className="text-xs tabular-nums text-text-muted">{formatCurrency(t.runningBalance, currency)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

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
