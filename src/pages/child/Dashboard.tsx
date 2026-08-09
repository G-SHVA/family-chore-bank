import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Flame, AlertTriangle } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  generateDailyAssignments,
  getChildDashboard,
  markChoreComplete,
  type ChildDashboardData,
} from '@/features/chores/choreService'
import { BalanceDisplay } from '@/components/shared/BalanceDisplay'
import { ChoreCard } from '@/components/shared/ChoreCard'
import { Card } from '@/components/ui/Card'
import { cn, formatCurrency } from '@/lib/utils'

type Filter = 'all' | 'todo' | 'pending'

export default function ChildDashboard() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const [data, setData] = useState<ChildDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    if (!memberId) return
    try {
      setError(null)
      // Self-healing: create any missing instances for the current period.
      await generateDailyAssignments()
      const dash = await getChildDashboard(memberId)
      setData(dash)
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
            pendingApproval: prev.pendingApproval + 1,
            dueToday: Math.max(0, prev.dueToday - 1),
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
        <Loader2 className="h-10 w-10 animate-spin text-gold" />
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

  const chores = data.activeChores.filter((c) => {
    if (filter === 'todo') return c.status === 'pending' || c.status === 'in_progress'
    if (filter === 'pending') return c.status === 'completed'
    return true
  })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 lg:flex-row">
      {/* Left column: balance + stats */}
      <div className="flex flex-col gap-4 lg:w-2/5">
        <Card className="bg-gradient-to-br from-card to-surface">
          <div className="text-sm text-text-muted">Current balance</div>
          <BalanceDisplay
            amount={data.balance}
            currency={currency}
            className="mt-1 block text-[56px] font-extrabold leading-none text-green"
          />
          <div className="mt-4 flex items-center gap-4 text-sm">
            <span className="text-text-muted">
              Earned this week:{' '}
              <span className="font-semibold text-text">
                {formatCurrency(data.weeklyEarnings, currency)}
              </span>
            </span>
            {data.currentStreak > 0 && (
              <span className="flex items-center gap-1 font-semibold text-gold">
                <Flame className="h-4 w-4" /> {data.currentStreak} day streak
              </span>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <StatCard label="Completed this week" value={data.completedThisWeek} />
          <StatCard label="Pending approval" value={data.pendingApproval} accent="gold" />
          <StatCard label="Due today" value={data.dueToday} />
          <StatCard label="Completion rate" value={`${data.completionRate}%`} accent="green" />
        </div>
      </div>

      {/* Right column: chores */}
      <div className="flex flex-col gap-4 lg:w-3/5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text">My Chores</h2>
          <div className="flex gap-1 rounded-input bg-card p-1">
            {(['all', 'todo', 'pending'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-4 py-2 text-sm font-semibold capitalize',
                  filter === f ? 'bg-gold text-bg' : 'text-text-muted'
                )}
              >
                {f === 'todo' ? 'To Do' : f}
              </button>
            ))}
          </div>
        </div>

        {chores.length === 0 ? (
          <Card className="py-12 text-center text-text-muted">
            {filter === 'pending'
              ? 'Nothing waiting for approval.'
              : 'No chores here. Nice work! 🎉'}
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
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

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'gold' | 'green'
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span
        className={cn(
          'text-3xl font-extrabold',
          accent === 'gold' ? 'text-gold' : accent === 'green' ? 'text-green' : 'text-text'
        )}
      >
        {value}
      </span>
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
    </Card>
  )
}
