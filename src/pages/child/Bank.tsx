import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Landmark, ArrowUpRight, ArrowDownRight } from 'lucide-react'
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
import { cn, formatCurrency } from '@/lib/utils'

export default function ChildBank() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const [txns, setTxns] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  // Only whether a goal exists — the "saved toward goal" figure is meaningless
  // without one, and the card needs no other detail about it.
  const [hasActiveGoal, setHasActiveGoal] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!memberId) return
    void (async () => {
      const [t, s, goal] = await Promise.all([
        getTransactionHistory(memberId),
        getMonthlyBankSummary(memberId),
        getActiveGoal(memberId),
      ])
      setTxns(t)
      setSummary(s)
      setHasActiveGoal(goal !== null)
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
                  {new Date(t.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
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
    </div>
  )
}
