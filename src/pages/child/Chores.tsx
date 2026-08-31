import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, ListChecks } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  getActiveInstances,
  getApprovedInstances,
  markChoreComplete,
  type AssignmentWithChore,
} from '@/features/chores/choreService'
import { ChoreCard } from '@/components/shared/ChoreCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn } from '@/lib/utils'

type Filter = 'today' | 'week' | 'all' | 'completed'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
]

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfWeek(d: Date) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow + 6)
  x.setHours(23, 59, 59, 999)
  return x
}

export default function ChildChores() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const [instances, setInstances] = useState<AssignmentWithChore[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('today')

  const load = useCallback(async () => {
    if (!memberId) return
    // NO generation here — see the note in the child Dashboard loader.
    //
    // Two reads, not one. The "Completed" tab wants approved history while
    // every other tab wants live chores, and serving both from a single capped
    // fetch is what let history push the live rows out of the window (see
    // getActiveInstances). Each read is now bounded by its own status filter.
    const [active, approved] = await Promise.all([
      getActiveInstances(memberId),
      getApprovedInstances(memberId),
    ])
    setInstances([...active, ...approved])
    setLoading(false)
  }, [memberId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleComplete(id: string) {
    setInstances((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'completed' } : c))
    )
    try {
      await markChoreComplete(id)
    } finally {
      await load()
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
      </div>
    )
  }

  const now = new Date()
  const todayStart = startOfDay(now).getTime()
  const todayEnd = todayStart + 24 * 60 * 60 * 1000 - 1
  const weekEnd = endOfWeek(now).getTime()

  const filtered = instances.filter((i) => {
    const due = i.due_date ? new Date(i.due_date).getTime() : null
    if (filter === 'completed') return i.status === 'approved'
    if (i.status === 'approved') return false // active views hide fully-approved
    if (i.status === 'expired') return false // missed chores don't carry over
    if (filter === 'all') return true
    if (!due) return false
    if (filter === 'today') return due >= todayStart && due <= todayEnd
    if (filter === 'week') return due <= weekEnd
    return true
  })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-1 rounded-input border border-line bg-deep p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'label-caps flex-1 rounded-input px-4 py-3 text-[11px]',
              filter === f.key ? 'bg-wash text-antique' : 'text-text-muted'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={filter === 'completed' ? 'No completed chores yet' : 'No chores here'}
          subtitle={filter === 'completed' ? 'Approved chores will show up here.' : 'Nice work!'}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {filtered.map((c) => (
              <ChoreCard key={c.id} assignment={c} currency={currency} onComplete={handleComplete} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
