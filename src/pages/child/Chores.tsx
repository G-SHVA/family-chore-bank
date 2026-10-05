import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Loader2, ListChecks, Pin } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  getActiveInstances,
  getRecentApprovedInstances,
  getRejectedSince,
  getDeclinedRosterRequestsSince,
  markChoreComplete,
  isActionable,
  isLapsed,
  type AssignmentWithChore,
} from '@/features/chores/choreService'
import { getPinnedChores, type PinnedChore } from '@/features/chores/pinnedChoresService'
import { ChoreCard } from '@/components/shared/ChoreCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { endOfDay, endOfWeek, startOfDay } from '@/lib/time'
import { cn } from '@/lib/utils'

type Filter = 'today' | 'week' | 'all' | 'completed'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
]


/**
 * The Chores tab — where every chore lives, including the ones Home no longer
 * shows.
 *
 * ORDERING IS THE FEATURE, 2026-09-03. Rejected and lapsed instances moved
 * here off the child Home screen, and dropping 88 cards into this list
 * unsorted would only relocate the problem. So the list is grouped by what the
 * child can do about each row:
 *
 *   1. Actionable (pending / in_progress, still in period) — full weight
 *   2. Waiting on a parent (completed)                     — slightly muted
 *   3. Recent misses (rejected / lapsed)                   — collapsed
 *
 * A child opening this tab to find their next chore sees work first. A child
 * who wants to read why something was rejected opens one section and finds it.
 * Nothing is hidden; it is ranked.
 */
export default function ChildChores() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const [instances, setInstances] = useState<AssignmentWithChore[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('today')
  const [pinned, setPinned] = useState<PinnedChore[]>([])

  const load = useCallback(async () => {
    if (!memberId) return
    // NO generation here — see the note in the child Dashboard loader.
    //
    // Three reads, not one. The "Completed" tab wants approved history, the
    // active views want live chores, and "Recent misses" wants rejections —
    // serving all of them from a single capped fetch is what let history push
    // the live rows out of the window (see getActiveInstances). Each read is
    // bounded by its own status filter, and the rejected one additionally by a
    // 14-day window.
    const [active, approved, rejected, declinedRoster, pins] = await Promise.all([
      getActiveInstances(memberId),
      getRecentApprovedInstances(memberId),
      getRejectedSince(memberId),
      // Declined ROSTER requests. A fourth read because these are template
      // rows with no due_date, so getRejectedSince — filtered on
      // is_template = false and bounded by due_date — cannot see them.
      // Without this the parent's note on a declined request would exist in
      // the database and appear on no child screen anywhere.
      getDeclinedRosterRequestsSince(memberId),
      // Pinned favourites from the claim library. Never blocks the tab.
      getPinnedChores(memberId).catch(() => [] as PinnedChore[]),
    ])
    setPinned(pins)
    // getActiveInstances still returns 'rejected' rows for other callers; the
    // date-bounded read is the one this screen shows, so drop the unbounded
    // duplicates rather than rendering a row twice.
    const live = active.filter((i) => i.status !== 'rejected')
    setInstances([...live, ...approved, ...rejected, ...declinedRoster])
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

  // "Today" and "this week" are the FAMILY's days, not the tablet's. A chore
  // whose due date the generator set to 23:59:59 local must fall inside the
  // Today filter, and endOfDay is the same boundary the generator used.
  const now = new Date()
  const todayStart = startOfDay(now).getTime()
  const todayEnd = endOfDay(now).getTime()
  const weekEnd = endOfWeek(now).getTime()

  const inFilterWindow = (i: AssignmentWithChore) => {
    if (filter === 'all') return true
    // A declined roster request is a TEMPLATE row: it has no due_date, because
    // it was never scheduled work — it was a request to take something on.
    // Date filters are meaningless for it, so it is always in window rather
    // than being silently dropped by every filter except All. Its own read is
    // already bounded to 14 days.
    if (i.is_template) return true
    const due = i.due_date ? new Date(i.due_date).getTime() : null
    if (due === null) return false
    if (filter === 'today') return due >= todayStart && due <= todayEnd
    return due <= weekEnd
  }

  // The Completed tab is its own view: approved history, nothing else.
  const approvedOnly = instances.filter((i) => i.status === 'approved')

  const scoped = instances.filter((i) => i.status !== 'approved' && inFilterWindow(i))
  const actionable = scoped.filter(isActionable).sort(bySoonestDue)
  const awaiting = scoped.filter((i) => i.status === 'completed').sort(bySoonestDue)
  // A lapsed pending row and a rejected row are the same thing to a child:
  // something that did not land. They read together.
  const misses = scoped
    .filter((i) => i.status === 'rejected' || i.status === 'expired' || isLapsedOpen(i))
    .sort(byLatestDue)

  if (filter === 'completed') {
    return (
      <div className="mx-auto max-w-3xl">
        <FilterBar filter={filter} setFilter={setFilter} />
        {approvedOnly.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No completed chores yet"
            subtitle="Approved chores will show up here."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {approvedOnly.map((c) => (
              <ChoreCard key={c.id} assignment={c} currency={currency} onComplete={handleComplete} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // A pinned chore already on the child's list is not a shortcut to anything.
  const onList = new Set(instances.filter((i) => i.status !== 'approved' && i.status !== 'rejected').map((i) => i.chore_id))
  const pinnedShortcuts = pinned.filter((p) => !onList.has(p.id))

  const nothingAtAll = actionable.length === 0 && awaiting.length === 0 && misses.length === 0

  return (
    <div className="mx-auto max-w-3xl">
      <FilterBar filter={filter} setFilter={setFilter} />

      {pinnedShortcuts.length > 0 && (
        <section aria-label="Pinned chores" className="mb-6 flex shrink-0 flex-col gap-2">
          <div className="label-caps px-1 text-[10px] text-text-muted">Pinned</div>
          <div className="flex flex-wrap gap-2">
            {pinnedShortcuts.map((p) => (
              <Link
                key={p.id}
                to={`/child/${memberId}/claim?chore=${p.id}`}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-input border border-antique/40 bg-wash px-4 text-sm text-text"
              >
                <Pin className="h-4 w-4 shrink-0 fill-current text-antique" />
                {p.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {nothingAtAll ? (
        <EmptyState icon={ListChecks} title="No chores here" subtitle="Nice work!" />
      ) : (
        <div className="flex flex-col gap-6">
          {actionable.length > 0 && (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {actionable.map((c) => (
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

          {awaiting.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="label-caps px-1 text-[10px] text-text-muted">
                Waiting for a parent
              </div>
              {/* Subordinate to actionable work, not hidden from it. Opacity
                  rather than a colour change: these rows are not a different
                  KIND of thing, they are the same thing one step further on. */}
              <div className="flex flex-col gap-3 opacity-70">
                {awaiting.map((c) => (
                  <ChoreCard key={c.id} assignment={c} currency={currency} />
                ))}
              </div>
            </div>
          )}

          {misses.length > 0 && (
            // Collapsed by default. The lesson stays reachable in one tap; it
            // just stops being the first thing a child reads on this screen.
            // Rejections are already windowed to 14 days by getRejectedSince.
            <CollapsibleSection
              title="Recent misses"
              meta={`${misses.length}`}
              maxHeight={520}
            >
              <div className="flex flex-col gap-3 pb-1 opacity-60">
                {misses.map((c) => (
                  <ChoreCard key={c.id} assignment={c} currency={currency} />
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  )
}

function FilterBar({
  filter,
  setFilter,
}: {
  filter: Filter
  setFilter: (f: Filter) => void
}) {
  return (
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
  )
}

/** An open chore whose window has closed — a miss the sweep has not flipped yet. */
function isLapsedOpen(i: AssignmentWithChore): boolean {
  const status = i.status ?? 'pending'
  return (status === 'pending' || status === 'in_progress') && isLapsed(i)
}

function dueTime(i: AssignmentWithChore): number {
  return i.due_date ? new Date(i.due_date).getTime() : Number.MAX_SAFE_INTEGER
}
/** Soonest first — the order a to-do list is read in. */
function bySoonestDue(a: AssignmentWithChore, b: AssignmentWithChore) {
  return dueTime(a) - dueTime(b)
}
/** Most recent first — the order history is read in. */
function byLatestDue(a: AssignmentWithChore, b: AssignmentWithChore) {
  return dueTime(b) - dueTime(a)
}
