import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, Pin, Search, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getClaimableChores,
  claimChoreForToday,
  createRosterRequest,
  formatFrequency,
  type ClaimGroup,
} from '@/features/chores/choreService'
import {
  getPinnedChoreIds,
  pinChore,
  unpinChore,
  PIN_CAP,
  PIN_CAP_MESSAGE,
} from '@/features/chores/pinnedChoresService'
import { rankItems } from '@/lib/search'
import type { Chore } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * ONE SCREEN ONE JOB — the claim library.
 *
 * Its job is: what could I choose to do. Nothing else. No balance, no streak,
 * no stats — those all live one tap away on screens that own them, and this
 * screen exists precisely because the child dashboard must not grow.
 *
 * WHY IT IS NOT A NAV TAB. The bottom nav stays four items: Home, Chores,
 * Bank, Achievements. Claiming is an occasional act, not a daily destination,
 * and a fifth tab would tax every child on every screen forever to serve it.
 * It is reached by one understated text link on Home instead.
 *
 * EVERYTHING COLLAPSED BY DEFAULT. The library is ~126 chores. Rendering them
 * flat would recreate exactly the wall of cards this session removed from the
 * dashboard (90 cards, 19,511px of scroll). A child opens the one category
 * they are actually curious about, and the screen never exceeds a few taps of
 * content.
 *
 * NO PRIMARY GOLD ANYWHERE ON THIS SCREEN. Values and the main action are both
 * antique. Primary gold (#E6B800) is reserved for the single dominant action
 * on a screen, and browsing has no dominant action — every chore here is an
 * equal option. Making one of them shout would be a lie about the choice.
 */

/** Human labels for the four library categories. */
const CATEGORY_LABELS: Record<string, string> = {
  academic: 'Academic',
  household: 'Household',
  personal: 'Personal',
  'pet-care': 'Pet Care',
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ')
}

/**
 * A claimable chore is a LIBRARY row, so it carries no recurrence pin — those
 * live on the roster assignment. formatFrequency therefore renders the bare
 * frequency here, which is correct: the child is choosing a chore, not being
 * shown someone else's schedule for it.
 */

/**
 * A one-time chore cannot become a recurring roster entry — there is nothing
 * for the generator to repeat. Monthly is excluded too: the spec offers the
 * roster path for daily and weekly only, which are the frequencies a child
 * can meaningfully commit to.
 */
function canJoinRoster(chore: Chore): boolean {
  const freq = chore.frequency ?? 'daily'
  return freq === 'daily' || freq === 'weekly'
}

/** How tall a category's scrolling body may grow before it scrolls itself. */
const CATEGORY_MAX_HEIGHT = 420

export default function ChildClaim() {
  const { memberId } = useParams()
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const familyId = family?.id

  const [groups, setGroups] = useState<ClaimGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  /** The chore whose action sheet is open, if any. */
  const [selected, setSelected] = useState<Chore | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sheetError, setSheetError] = useState<string | null>(null)

  /**
   * Chore ids requested during THIS visit. The next load drops them from the
   * library entirely (getClaimableChores excludes them), but a child who has
   * just tapped needs to see that the tap landed without the tile vanishing
   * out from under their finger — so the tile stays put and reads "Requested".
   */
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set())
  /** The subset of justRequested that went straight onto today's list (no approval). */
  const [justClaimed, setJustClaimed] = useState<Set<string>>(new Set())
  const [claimNote, setClaimNote] = useState<string | null>(null)

  /**
   * Global search. Empty = the category view, exactly as before. Non-empty =
   * one flat list of matching tiles, no categories — a child who knows what
   * they want should not have to guess which category it lives in. Filtering
   * is over rows already in memory, so typing costs no reads. Search terms are
   * never logged or stored anywhere.
   */
  const [search, setSearch] = useState('')
  const searchResults = useMemo(() => {
    if (!search.trim()) return null
    return rankItems(
      groups.flatMap((g) => g.chores),
      search,
      (c) => c.title
    )
  }, [groups, search])

  /**
   * Pinned chore ids, oldest pin first. One extra read on this screen only
   * (the child dashboard's read budget is untouched). A failure here must not
   * take the library down with it, so it degrades to "nothing pinned".
   */
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [pinNote, setPinNote] = useState<string | null>(null)

  /**
   * The Pinned section lists only chores that are CLAIMABLE right now: a
   * pinned chore that has since landed on the child's roster, or has an open
   * request, is no longer in `groups`, so it drops out silently and returns on
   * its own if it becomes claimable again.
   */
  const pinnedChores = useMemo(() => {
    const byId = new Map(groups.flatMap((g) => g.chores).map((c) => [c.id, c]))
    return pinnedIds.flatMap((id) => {
      const chore = byId.get(id)
      return chore ? [chore] : []
    })
  }, [groups, pinnedIds])

  async function togglePin(chore: Chore) {
    if (!memberId) return
    const wasPinned = pinnedIds.includes(chore.id)
    setPinNote(null)
    if (!wasPinned && pinnedIds.length >= PIN_CAP) {
      setPinNote(PIN_CAP_MESSAGE)
      return
    }
    // Optimistic: the icon must answer the tap instantly. Reverted on failure.
    setPinnedIds((prev) => (wasPinned ? prev.filter((id) => id !== chore.id) : [...prev, chore.id]))
    try {
      if (wasPinned) await unpinChore(memberId, chore.id)
      else await pinChore(memberId, chore.id)
    } catch (e) {
      setPinnedIds((prev) => (wasPinned ? [...prev, chore.id] : prev.filter((id) => id !== chore.id)))
      setPinNote(e instanceof Error ? e.message : 'That pin did not save.')
    }
  }

  const load = useCallback(async () => {
    if (!memberId || !familyId) return
    setLoading(true)
    setError(null)
    try {
      const [claimable, pins] = await Promise.all([
        getClaimableChores(memberId, familyId),
        getPinnedChoreIds(memberId).catch(() => [] as string[]),
      ])
      setGroups(claimable)
      setPinnedIds(pins)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load available chores.')
    } finally {
      setLoading(false)
    }
  }, [memberId, familyId])

  useEffect(() => {
    void load()
  }, [load])

  // Arriving from a pinned chip on My Chores (?chore=<id>): open that chore's
  // action sheet once the library has loaded, then drop the param.
  useEffect(() => {
    const wanted = searchParams.get('chore')
    if (!wanted || loading) return
    const chore = groups.flatMap((g) => g.chores).find((c) => c.id === wanted)
    if (chore) setSelected(chore)
    setSearchParams({}, { replace: true })
  }, [searchParams, loading, groups, setSearchParams])

  async function submit(path: 'once' | 'roster') {
    if (!selected || !memberId) return
    setSubmitting(true)
    setSheetError(null)
    try {
      if (path === 'once') {
        await claimChoreForToday(selected.id, memberId)
      } else {
        await createRosterRequest(selected.id, memberId)
      }
      setJustRequested((prev) => new Set(prev).add(selected.id))
      if (path === 'once') {
        setJustClaimed((prev) => new Set(prev).add(selected.id))
        setClaimNote(
          `"${selected.title}" is on your list for today. Find it on My Chores and tap Mark Complete when you're done.`
        )
      } else {
        setClaimNote(null)
      }
      setSelected(null)
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : 'That request did not go through.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-danger/40 text-center text-danger">{error}</Card>
      </div>
    )
  }

  const total = groups.reduce((n, g) => n + g.chores.length, 0)

  /**
   * One tile, shared by the category view, the Pinned section and the flat
   * search results.
   *
   * The pin is a SIBLING of the tile button, not a child: a button inside a
   * button is invalid and the inner tap would also fire the outer. It is 44px,
   * the child-facing floor, and the tile reserves room for it on the right.
   */
  function renderTile(chore: Chore) {
    const requested = justRequested.has(chore.id)
    const pinned = pinnedIds.includes(chore.id)
    return (
      <div key={chore.id} className="relative">
        <button
          type="button"
          disabled={requested}
          onClick={() => {
            setSheetError(null)
            setSelected(chore)
          }}
          className={cn(
            'flex min-h-touch w-full items-center justify-between gap-4 rounded-card',
            'border border-line bg-card py-4 pl-5 pr-16 text-left',
            'transition-colors duration-150',
            requested ? 'cursor-default border-green/40' : 'hover:border-antique/40 hover:bg-wash'
          )}
        >
          <span className="min-w-0">
            <span className="block truncate text-base text-text">{chore.title}</span>
            <span className="label-caps mt-1 block text-[10px] text-text-muted">
              {formatFrequency(chore.frequency, null, null)}
            </span>
          </span>
          {requested ? (
            <span className="label-caps flex shrink-0 items-center gap-1.5 text-[11px] text-green">
              <Check className="h-4 w-4" />
              {justClaimed.has(chore.id) ? 'On your list' : 'Requested'}
            </span>
          ) : (
            <span className="shrink-0 text-lg text-antique">
              {formatCurrency(chore.value ?? 0, currency)}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => void togglePin(chore)}
          aria-label={pinned ? `Unpin ${chore.title}` : `Pin ${chore.title}`}
          aria-pressed={pinned}
          className={cn(
            'absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full',
            'transition-colors duration-150',
            pinned ? 'text-antique' : 'text-text-muted/50 hover:text-antique'
          )}
        >
          <Pin className={cn('h-5 w-5', pinned && 'fill-current')} />
        </button>
      </div>
    )
  }

  return (
    <div className="scroll-panel mx-auto h-full max-w-3xl overflow-y-auto pr-2">
      <header className="mb-8">
        <Link
          to={memberId ? `/child/${memberId}` : '/'}
          className="label-caps mb-5 inline-flex min-h-touch items-center gap-2 text-[11px] text-text-muted hover:text-antique"
        >
          <ArrowLeft className="h-4 w-4" />
          Home
        </Link>
        <h1 className="text-4xl text-text">Available Chores</h1>
        <p className="mt-2 text-text-muted">Choose something to work on.</p>
      </header>

      {total === 0 ? (
        <Card className="py-12 text-center text-text-muted">
          You have everything available already. Check back after your parent updates the chore
          library.
        </Card>
      ) : (
        <div className="flex flex-col gap-6 pb-4">
          {claimNote && (
            <Card role="status" className="shrink-0 border-green/40 text-sm text-text">
              {claimNote}{' '}
              <Link to={`/child/${memberId}/chores`} className="text-antique underline">
                Go to My Chores
              </Link>
            </Card>
          )}

          {pinNote && (
            <p role="status" className="shrink-0 text-center text-sm text-text-muted">
              {pinNote}
            </p>
          )}

          {/* Always open, and hidden while searching: a child hunting for one
              specific chore does not want the favourites in the way. */}
          {!searchResults && pinnedChores.length > 0 && (
            <section className="shrink-0" aria-label="Pinned chores">
              <h2 className="label-caps mb-3 text-[11px] text-text-muted">Pinned</h2>
              <div className="flex flex-col gap-2">{pinnedChores.map(renderTile)}</div>
            </section>
          )}

          {/* Search sits above the categories and never replaces the
              collapsed-by-default layout: younger children still browse. */}
          <div className="relative shrink-0">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chores..."
              aria-label="Search chores"
              autoComplete="off"
              spellCheck={false}
              className={cn(
                'h-11 w-full rounded-input border border-line bg-deep pl-11 pr-11 text-base text-text',
                'placeholder:text-text-muted focus:border-antique focus:outline-none'
              )}
            />
            {/* 44px hit area even though the glyph is small — a child-facing
                touch target never goes below the codebase's floor. */}
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-text-muted hover:text-antique"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {searchResults ? (
            searchResults.length === 0 ? (
              <p className="py-8 text-center text-text-muted">No chores match your search.</p>
            ) : (
              <div className="flex flex-col gap-2">{searchResults.map(renderTile)}</div>
            )
          ) : (
            groups.map((group) => (
              <CollapsibleSection
                key={group.category}
                title={categoryLabel(group.category)}
                meta={`${group.chores.length}`}
                maxHeight={CATEGORY_MAX_HEIGHT}
              >
                <div className="flex flex-col gap-2">{group.chores.map(renderTile)}</div>
              </CollapsibleSection>
            ))
          )}
        </div>
      )}

      {/* The action sheet. A modal on tablet, which is the only form factor
          this kiosk runs on — no separate mobile drawer to keep in sync. */}
      <Modal
        open={!!selected}
        onClose={() => {
          if (!submitting) setSelected(null)
        }}
        title={selected?.title ?? ''}
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="display text-4xl text-antique">
                {formatCurrency(selected.value ?? 0, currency)}
              </div>
              <div className="label-caps mt-1 text-[10px] text-text-muted">
                {formatFrequency(selected.frequency, null, null)}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                variant="accent"
                size="lg"
                fullWidth
                disabled={submitting}
                onClick={() => void submit('once')}
              >
                Do this today — earn {formatCurrency(selected.value ?? 0, currency)}
              </Button>

              {/* Only for chores that can actually recur. A 'once' chore has
                  nothing for the generator to repeat, so offering the option
                  would promise something the system cannot deliver. */}
              {canJoinRoster(selected) && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  disabled={submitting}
                  onClick={() => void submit('roster')}
                >
                  Add to my regular chores
                </Button>
              )}
            </div>

            {sheetError && <p className="text-sm text-danger">{sheetError}</p>}

            <p className="text-sm text-text-muted">
              "Do this today" goes straight onto your list. Adding a regular chore needs a
              parent's OK first.
            </p>

            {/* Pinning is NOT a request: no parent sees it, nothing to approve.
                Kept visually apart from the two request buttons above. */}
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => void togglePin(selected)}
              >
                <Pin
                  className={cn('h-5 w-5 shrink-0', pinnedIds.includes(selected.id) && 'fill-current')}
                />
                {pinnedIds.includes(selected.id) ? 'Unpin from my favorites' : 'Pin to my favorites'}
              </Button>
              <p className="text-sm text-text-muted">
                Pins are just for you — no need to ask a parent.
              </p>
              {pinNote && <p className="text-sm text-danger">{pinNote}</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
