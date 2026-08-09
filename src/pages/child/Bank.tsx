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
import { cn, formatCurrency } from '@/lib/utils'

export default function ChildBank() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const [txns, setTxns] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!memberId) return
    void (async () => {
      const [t, s] = await Promise.all([
        getTransactionHistory(memberId),
        getMonthlyBankSummary(memberId),
      ])
      setTxns(t)
      setSummary(s)
      setLoading(false)
    })()
  }, [memberId])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
      </div>
    )
  }

  const balance = txns[0]?.runningBalance ?? 0

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="mb-4 bg-gradient-to-br from-card to-surface">
        <div className="text-sm text-text-muted">Current balance</div>
        <BalanceDisplay
          amount={balance}
          currency={currency}
          className="mt-1 block text-[56px] font-extrabold leading-none text-green"
        />
        <div className="mt-4 flex gap-6 text-sm">
          <span className="text-text-muted">
            Earned this month:{' '}
            <span className="font-semibold text-green">
              {formatCurrency(summary?.earned ?? 0, currency)}
            </span>
          </span>
          <span className="text-text-muted">
            Spent:{' '}
            <span className="font-semibold text-danger">
              {formatCurrency(summary?.spent ?? 0, currency)}
            </span>
          </span>
        </div>
      </Card>

      <h2 className="mb-3 px-1 text-lg font-bold">Transaction history</h2>
      {txns.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No transactions yet"
          subtitle="Approved chores and expenses will appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-white/5">
          {txns.map((t, idx) => (
            <div
              key={t.id}
              className={cn(
                'flex items-center gap-4 bg-card px-4 py-4',
                idx > 0 && 'border-t border-white/5'
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
                <div className="truncate font-semibold text-text">{t.description}</div>
                <div className="text-xs text-text-muted">
                  {new Date(t.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div className="text-right">
                <div className={cn('font-bold', t.type === 'income' ? 'text-green' : 'text-danger')}>
                  {t.type === 'income' ? '+' : '−'}
                  {formatCurrency(t.amount, currency)}
                </div>
                <div className="text-xs text-text-muted">{formatCurrency(t.runningBalance, currency)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
