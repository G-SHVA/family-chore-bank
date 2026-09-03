import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getClaimableChores,
  createOneTimeRequest,
  createRosterRequest,
  type ClaimGroup,
} from '@/features/chores/choreService'
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

const FREQUENCY_LABELS: Record<string, string> = {
  once: 'Once',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

function frequencyLabel(frequency: string | null | undefined): string {
  return FREQUENCY_LABELS[frequency ?? 'daily'] ?? 'Daily'
}

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

  const load = useCallback(async () => {
    if (!memberId || !familyId) return
    setLoading(true)
    setError(null)
    try {
      setGroups(await getClaimableChores(memberId, familyId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load available chores.')
    } finally {
      setLoading(false)
    }
  }, [memberId, familyId])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(path: 'once' | 'roster') {
    if (!selected || !memberId) return
    setSubmitting(true)
    setSheetError(null)
    try {
      if (path === 'once') {
        await createOneTimeRequest(selected.id, memberId)
      } else {
        await createRosterRequest(selected.id, memberId)
      }
      setJustRequested((prev) => new Set(prev).add(selected.id))
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
          {groups.map((group) => (
            <CollapsibleSection
              key={group.category}
              title={categoryLabel(group.category)}
              meta={`${group.chores.length}`}
              maxHeight={CATEGORY_MAX_HEIGHT}
            >
              <div className="flex flex-col gap-2">
                {group.chores.map((chore) => {
                  const requested = justRequested.has(chore.id)
                  return (
                    <button
                      key={chore.id}
                      type="button"
                      disabled={requested}
                      onClick={() => {
                        setSheetError(null)
                        setSelected(chore)
                      }}
                      className={cn(
                        'flex min-h-touch w-full items-center justify-between gap-4 rounded-card',
                        'border border-line bg-card px-5 py-4 text-left',
                        'transition-colors duration-150',
                        requested
                          ? 'cursor-default border-green/40'
                          : 'hover:border-antique/40 hover:bg-wash'
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base text-text">{chore.title}</span>
                        <span className="label-caps mt-1 block text-[10px] text-text-muted">
                          {frequencyLabel(chore.frequency)}
                        </span>
                      </span>
                      {requested ? (
                        <span className="label-caps flex shrink-0 items-center gap-1.5 text-[11px] text-green">
                          <Check className="h-4 w-4" />
                          Requested
                        </span>
                      ) : (
                        <span className="shrink-0 text-lg text-antique">
                          {formatCurrency(chore.value ?? 0, currency)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </CollapsibleSection>
          ))}
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
                {frequencyLabel(selected.frequency)}
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
              Your parent will need to approve before it appears in your chore list.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
