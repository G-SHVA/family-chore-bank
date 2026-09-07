import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Check, X, Clock, CheckCircle2, Percent, Sparkles, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import {
  generateDailyAssignments,
  getApprovalQueue,
  approveChore,
  approveChoreHalfCredit,
  splitHalfCredit,
  rejectChore,
  quickAssignChore,
  directAwardFromLibrary,
  directAwardCustom,
  CHARACTER_MOMENT_CATEGORY,
  RECOGNITION_TYPES,
  recognitionType,
  type RecognitionCategory,
  getFamilyChores,
  getRoster,
  dailyRosterTotal,
  approveChoreRequest,
  declineChoreRequest,
  formatFrequency,
  type ChoreRequest,
  type PendingApproval,
  type QueueItem,
  type RosterEntry,
} from '@/features/chores/choreService'
import {
  getFamilyExpenses,
  applyExpense,
  directChargeCustom,
} from '@/features/expenses/expenseService'
import { getActiveMembers, isChild } from '@/features/family/familyService'
import type { Chore, Expense, FamilyMember } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn, formatCurrency, initials, timeAgo } from '@/lib/utils'

export default function ParentDashboard() {
  const { activeMember, family, refresh } = useAuth()
  const currency = family?.currency ?? 'USD'
  const familyId = family?.id

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // THE queue. Completed chores and both claim-request paths in one ordered
  // array — the count in the status band and the list below it read this same
  // value, so they can never disagree. See getApprovalQueue.
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [children, setChildren] = useState<FamilyMember[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<PendingApproval | null>(null)
  const [decliningRequest, setDecliningRequest] = useState<ChoreRequest | null>(null)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  // Synchronous guard so a double-tap can't dispatch two approvals for one chore.
  const inFlight = useRef<Set<string>>(new Set())

  // Family Week's "Give Recognition" link lands here with ?quickAdd=character.
  const [searchParams] = useSearchParams()
  const quickAddTab = searchParams.get('quickAdd')

  /**
   * TWO READS. That is the whole dashboard load.
   *
   * It was eight, because the screen carried three reporting surfaces that
   * answered questions nobody asks daily. getFamilyChildSummaries, getFamilyGoals
   * and getRecentExpenseApplications were deleted outright along with the
   * sections they fed; Quick Add's three reads now happen inside the modal, when
   * a parent actually taps +. See the read-count rule in CLAUDE.md before adding
   * anything back here.
   *
   * `children` comes off the getActiveMembers call that already had to happen,
   * so the Quick Add child picker costs no read of its own.
   */
  const load = useCallback(async () => {
    if (!familyId) return
    try {
      setError(null)
      // Self-healing: expire lapsed chores and create this period's instances,
      // so the roster stays live even if no child has opened the app today.
      await generateDailyAssignments()
      const members = await getActiveMembers(familyId)
      setChildren(members.filter(isChild))
      setQueue(await getApprovalQueue())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  // Family Week deep-links with ?quickAdd=character so a parent can give a
  // recognition straight after the meeting. Open the modal on arrival.
  useEffect(() => {
    if (quickAddTab) setQuickAddOpen(true)
  }, [quickAddTab])

  async function handleApprove(a: PendingApproval) {
    if (!activeMember) return
    if (inFlight.current.has(a.id)) return // ignore duplicate taps
    inFlight.current.add(a.id)
    setBusyId(a.id)
    try {
      await approveChore(a.id, activeMember.id)
      await Promise.all([load(), refresh()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed.')
    } finally {
      inFlight.current.delete(a.id)
      setBusyId(null)
    }
  }

  /**
   * Approve at half value — the book's "second reminder: 50% off credit".
   *
   * Guarded by the same inFlight set as a full approval, and for a sharper
   * reason: this path issues TWO writes (approve, then penalise), so a double
   * tap could credit twice and charge twice.
   */
  async function handleHalfCredit(a: PendingApproval) {
    if (!activeMember || !familyId) return
    if (inFlight.current.has(a.id)) return
    inFlight.current.add(a.id)
    setBusyId(a.id)
    try {
      await approveChoreHalfCredit(
        a.id,
        a.assigned_to,
        activeMember.id,
        familyId,
        a.chore?.title,
        a.chore?.value
      )
      await Promise.all([load(), refresh()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Half credit failed.')
    } finally {
      inFlight.current.delete(a.id)
      setBusyId(null)
    }
  }

  async function handleReject(note: string) {
    if (!rejecting) return
    const a = rejecting
    setBusyId(a.id)
    setRejecting(null)
    try {
      await rejectChore(a.id, note)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed.')
    } finally {
      setBusyId(null)
    }
  }

  /**
   * Approve a claim request. isRoster picks the payload shape AND is checked
   * against the stored row server-side, so a mismatch fails loudly rather than
   * writing a template-shaped update onto an instance.
   *
   * No refresh() here, unlike the chore approvals above: approving a request
   * moves no money, so no balance anywhere on this screen changes.
   */
  async function handleApproveRequest(r: ChoreRequest, isRoster: boolean) {
    if (inFlight.current.has(r.id)) return
    inFlight.current.add(r.id)
    setBusyId(r.id)
    try {
      await approveChoreRequest(r.id, isRoster)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve that request.')
    } finally {
      inFlight.current.delete(r.id)
      setBusyId(null)
    }
  }

  async function handleDeclineRequest(note: string) {
    if (!decliningRequest) return
    const r = decliningRequest
    setBusyId(r.id)
    setDecliningRequest(null)
    try {
      await declineChoreRequest(r.id, note)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decline that request.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
        <span className="text-text-muted">Loading dashboard…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-hidden">
      <StatusBand count={queue.length} onQuickAdd={() => setQuickAddOpen(true)} />

      {error && (
        <div className="shrink-0 rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-danger">
          {error}
        </div>
      )}

      {queue.length === 0 ? (
        <EmptyQueue />
      ) : (
        /* THE ONLY SCROLLER ON THIS SCREEN, and that is the point. The old
           layout nested four — the two-column grid, the left section, the
           capped request pane and the right rail — so a parent scrolled a
           380px porthole holding 5,000px of content while three other
           scrollers hid a further 800px between them. */
        <div className="scroll-skin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {queue.map((entry) => (
              <motion.div
                key={entry.item.id}
                layout
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.2 }}
              >
                <QueueCard
                  entry={entry}
                  currency={currency}
                  busy={busyId === entry.item.id}
                  onFullCredit={handleApprove}
                  onHalfCredit={handleHalfCredit}
                  onNoCredit={setRejecting}
                  onApproveRequest={handleApproveRequest}
                  onDeclineRequest={setDecliningRequest}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <RejectModal
        approval={rejecting}
        onClose={() => setRejecting(null)}
        onSubmit={handleReject}
      />

      <DeclineRequestModal
        request={decliningRequest}
        onClose={() => setDecliningRequest(null)}
        onSubmit={handleDeclineRequest}
      />

      <QuickAddModal
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        familyChildren={children}
        currency={currency}
        familyId={familyId ?? ''}
        assignedBy={activeMember?.id ?? ''}
        initialTab={quickAddTab}
        onDone={() => Promise.all([load(), refresh()])}
      />
    </div>
  )
}

/**
 * The status band — the single source of truth for "is there work?".
 *
 * `count` is queue.length, and the list below renders that same array. The old
 * screen derived the headline figure from one place (a stat card that counted
 * approvals AND requests) and the list from another (approvals only), so with
 * 25 requests outstanding it displayed "PENDING APPROVALS 25" directly above
 * "All caught up — nothing to approve." A parent cannot trust a system that
 * contradicts itself on one screen, and no amount of styling fixes two sources
 * of truth. One array makes that state unrenderable.
 *
 * The + is `accent`, never `primary`. Gold discipline (DESIGN_SYSTEM.md)
 * allows one primary-gold element per screen, and on this screen the queue's
 * approve buttons own it. An authoring shortcut must not outrank the work.
 */
function StatusBand({ count, onQuickAdd }: { count: number; onQuickAdd: () => void }) {
  return (
    <div className="spine flex shrink-0 items-center justify-between gap-4 pb-4">
      {/* WRAPS, NEVER TRUNCATES. `truncate` here cut the done state to
          "You're all caught up ..." at 390px — measured on Eve's phone width,
          where the + leaves the headline 195px. An ellipsis on the one line
          that tells a parent they are finished is the worst possible place to
          lose words, and a second line costs nothing on a screen that is
          otherwise empty. */}
      <h1
        className={cn(
          'display min-w-0 text-3xl leading-tight sm:text-4xl',
          count > 0 ? 'text-antique' : 'text-green'
        )}
      >
        {count > 0
          ? `${count} need${count === 1 ? 's' : ''} your yes`
          : "You're all caught up"}
      </h1>
      <Button
        variant="accent"
        size="lgResponsive"
        onClick={onQuickAdd}
        aria-label="Quick Add"
        className="shrink-0"
      >
        <Plus className="h-5 w-5 shrink-0" />
        <span className="hidden sm:inline">Add</span>
      </Button>
    </div>
  )
}

/**
 * The done state. Deliberately empty of everything else.
 *
 * The screen's job when there is no work is to END the interaction, not extend
 * it — so there are no stats to read, no child cards to inspect and no open
 * form inviting a parent to find something to do. The book budgets three
 * minutes a day; this is what the end of those three minutes should look like.
 */
function EmptyQueue() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Card className="flex w-full max-w-md flex-col items-center gap-3 py-12 text-center">
        <CheckCircle2 className="h-10 w-10 text-green" />
        <div className="display text-2xl text-text">You&rsquo;re all caught up.</div>
        <p className="text-text-muted">Nothing needs your approval right now.</p>
      </Card>
    </div>
  )
}

/**
 * One card for all three things a parent can be asked to answer.
 *
 * The header (avatar, chore, child, value, how long they have waited) is
 * IDENTICAL across kinds — the origin of a job is irrelevant to the fact that
 * it needs an answer, the same reasoning that lets ChoreCard render an approved
 * claim exactly like an assigned chore. Only the action row branches.
 *
 * MIS-TAP PROTECTION IS THE VERB PLUS THE MONEY. Each kind has its own
 * distinct primary label, and a dollar figure appears ONLY on a button that
 * moves money — no request button ever carries one. So a parent working down a
 * mixed list can tell what a tap will do without reading the card above it.
 *
 * Requests stay `accent` while a finished chore gets `primaryList`, preserving
 * the existing intent that the dominant action on this screen is approving
 * completed work, not answering a request.
 */
function QueueCard({
  entry,
  currency,
  busy,
  onFullCredit,
  onHalfCredit,
  onNoCredit,
  onApproveRequest,
  onDeclineRequest,
}: {
  entry: QueueItem
  currency: string
  busy: boolean
  onFullCredit: (a: PendingApproval) => void
  onHalfCredit: (a: PendingApproval) => void
  onNoCredit: (a: PendingApproval) => void
  onApproveRequest: (r: ChoreRequest, isRoster: boolean) => void
  onDeclineRequest: (r: ChoreRequest) => void
}) {
  const { kind, item, waitingSince } = entry
  const isRoster = kind === 'request-roster'
  const blurb =
    kind === 'chore'
      ? null
      : isRoster
        ? 'wants to add this to their regular chores'
        : 'wants to do this today'

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar member={item.member} />
        <div className="min-w-0">
          <div className="display text-lg text-text">{item.chore?.title}</div>
          <div className="text-sm text-text-muted">
            {item.member?.display_name} ·{' '}
            <span className="font-semibold text-antique">
              {formatCurrency(item.chore?.value ?? 0, currency)}
            </span>
            {/* Only a roster request changes what a child is responsible for
                indefinitely, so only that kind needs the schedule spelled out. */}
            {isRoster && item.chore?.frequency && (
              <span className="label-caps ml-2 text-[10px]">
                {formatFrequency(item.chore.frequency, item.recurrence_dow, item.recurrence_week)}
              </span>
            )}
            <span className="ml-2 inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {timeAgo(waitingSince)}
            </span>
          </div>
          {blurb && <div className="mt-0.5 text-sm text-text-muted">{blurb}</div>}
        </div>
      </div>

      {kind === 'chore' ? (
        /* Three outcomes, all visible, never a dropdown — but no longer three
           equal stacked 64px blocks, which cost a third of Eve's phone screen
           per row. Full Credit takes the full width on a phone and the other
           two share a row beneath it; `sm:contents` dissolves that pairing
           wrapper from sm up so all three become direct children of the
           3-column grid. One markup, both layouts, no duplicated buttons. */
        <div className="grid shrink-0 gap-2 sm:grid-cols-3">
          <Button
            size="lgResponsive"
            variant="primaryList"
            onClick={() => onFullCredit(item as PendingApproval)}
            disabled={busy}
          >
            {/* The figure is on the button, not only in the meta line above,
                for the same reason Half carries its own: a parent must be able
                to read what they are authorising on the control they are about
                to tap. Both come from the chore's value via the same source the
                write uses, so they cannot drift. */}
            <Check className="h-5 w-5 shrink-0" /> Full Credit (
            {formatCurrency(item.chore?.value ?? 0, currency)})
          </Button>
          <div className="grid grid-cols-2 gap-2 sm:contents">
            <Button
              size="lgResponsive"
              variant="accent"
              onClick={() => onHalfCredit(item as PendingApproval)}
              disabled={busy}
              title="Completed after a second reminder"
            >
              <Percent className="h-5 w-5 shrink-0" />
              Half ({formatCurrency(halfCreditAmount(item as PendingApproval), currency)})
            </Button>
            <Button
              size="lgResponsive"
              variant="danger"
              onClick={() => onNoCredit(item as PendingApproval)}
              disabled={busy}
              title="Completed only after multiple reminders"
            >
              <X className="h-5 w-5 shrink-0" /> No Credit
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            size="lgResponsive"
            variant="accent"
            onClick={() => onApproveRequest(item as ChoreRequest, isRoster)}
            disabled={busy}
          >
            <Check className="h-5 w-5 shrink-0" /> {isRoster ? 'Add to roster' : 'Yes — go ahead'}
          </Button>
          <Button
            size="lgResponsive"
            variant="danger"
            onClick={() => onDeclineRequest(item as ChoreRequest)}
            disabled={busy}
          >
            <X className="h-5 w-5 shrink-0" /> {isRoster ? 'Decline' : 'Not today'}
          </Button>
        </div>
      )}
    </Card>
  )
}

/**
 * Quick Add, on demand.
 *
 * It used to be a permanently open five-tab form in the dashboard's right
 * column. Five labelled tabs on an always-visible form read as five jobs a
 * parent could be doing every time they open the app, which is the opposite of
 * what a three-minute daily screen should imply. Behind a +, the capability is
 * one tap away and the obligation is gone.
 *
 * THE THREE READS IT NEEDS HAPPEN HERE, not on dashboard load — that is most of
 * the 8 -> 2 reduction. They fire on open rather than on mount, so a parent who
 * only ever approves chores never pays for them at all.
 */
function QuickAddModal({
  open,
  onClose,
  familyChildren,
  currency,
  familyId,
  assignedBy,
  initialTab,
  onDone,
}: {
  open: boolean
  onClose: () => void
  /** NOT named `children`: React treats that prop specially on any component. */
  familyChildren: FamilyMember[]
  currency: string
  familyId: string
  assignedBy: string
  initialTab?: string | null
  onDone: () => Promise<unknown>
}) {
  const [chores, setChores] = useState<Chore[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !familyId) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [ch, ex, ros] = await Promise.all([
          getFamilyChores(familyId),
          getFamilyExpenses(familyId),
          // Powers the daily-total readout: what a child's day is already
          // worth before this assignment lands on it.
          getRoster(),
        ])
        if (cancelled) return
        setChores(ch)
        setExpenses(ex)
        setRoster(ros)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load Quick Add.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, familyId])

  return (
    <Modal open={open} onClose={onClose} title="Quick Add" size="wide">
      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-antique" />
          <span className="text-text-muted">Loading…</span>
        </div>
      ) : error ? (
        <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-danger">
          {error}
        </div>
      ) : (
        <QuickAdd
          children={familyChildren}
          chores={chores}
          expenses={expenses}
          roster={roster}
          currency={currency}
          familyId={familyId}
          assignedBy={assignedBy}
          initialTab={initialTab}
          onDone={onDone}
        />
      )}
    </Modal>
  )
}

/**
 * The book's own value for "Get Caught Serving the Family". A default, not a
 * fixed price — a parent can type any amount over it.
 */
const CHARACTER_MOMENT_DEFAULT = '0.25'

/** The pre-filled, editable reason on the No Credit path (the book's third reminder). */
const REMINDER_REJECT_NOTE = 'Task completed after multiple reminders'

/**
 * What a Half Credit will actually put in the child's account, in dollars.
 *
 * Derived from splitHalfCredit — the SAME function the write uses — so the
 * figure printed on the button and the figure credited can never drift. On a
 * chore too small to halve this is $0.00, and the button says so rather than
 * promising a credit the degenerate path will not issue.
 */
function halfCreditAmount(a: PendingApproval): number {
  return splitHalfCredit(a.chore?.value).creditCents / 100
}

function Avatar({ member }: { member: { display_name: string | null; avatar_url: string | null } | null }) {
  if (member?.avatar_url) {
    return <img src={member.avatar_url} alt="" className="h-11 w-11 rounded-full border border-antique/40 object-cover" />
  }
  return (
    <div className="display flex h-11 w-11 items-center justify-center rounded-full border border-antique/40 bg-wash text-antique">
      {initials(member?.display_name)}
    </div>
  )
}

function RejectModal({
  approval,
  onClose,
  onSubmit,
}: {
  approval: PendingApproval | null
  onClose: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState('')
  // Pre-populated with the reminder reason, because that is now the most common
  // path to this modal — but it is an ordinary editable field, so a parent
  // rejecting for quality just types over it. The generic rejection is not lost.
  useEffect(() => {
    if (approval) setNote(REMINDER_REJECT_NOTE)
  }, [approval])
  return (
    <Modal open={!!approval} onClose={onClose} title="No credit">
      <p className="mb-4 text-text-muted">
        “{approval?.chore?.title}” will be sent back to {approval?.member?.display_name} with no
        credit.
      </p>
      <label htmlFor="reject-note" className="label-caps mb-2 block text-[11px] text-text-muted">
        Reason (required)
      </label>
      <textarea
        id="reject-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Let them know why this wasn't approved..."
        className="w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {/* The note is now required: it arrives pre-filled, so an empty box means
            the parent deliberately cleared it. A child losing the credit is owed
            the reason — it is the only feedback channel they have (there is no
            notifications table; the note IS the message). */}
        <Button variant="danger" onClick={() => onSubmit(note.trim())} disabled={!note.trim()}>
          Reject — No Credit
        </Button>
      </div>
      {!note.trim() && (
        <p className="mt-2 text-right text-xs text-text-muted">
          Add a reason so they know what happened.
        </p>
      )}
    </Modal>
  )
}

function QuickAdd({
  children,
  chores,
  expenses,
  roster,
  currency,
  familyId,
  assignedBy,
  initialTab,
  onDone,
}: {
  children: FamilyMember[]
  chores: Chore[]
  expenses: Expense[]
  roster: RosterEntry[]
  currency: string
  familyId: string
  assignedBy: string
  /** Tab to open on, from the ?quickAdd= query param. */
  initialTab?: string | null
  onDone: () => Promise<unknown>
}) {
  const [mode, setMode] = useState<'chore' | 'expense' | 'award' | 'charge' | 'character'>(
    // Family Week links here with ?quickAdd=character so a parent can give a
    // recognition straight after the meeting conversation, without hunting for
    // the tab. Any other value falls through to the normal default.
    initialTab === 'character' ? 'character' : 'chore'
  )

  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (initialTab !== 'character') return
    // The vertical scrollIntoView that used to sit here is GONE. It existed
    // because this panel sat low in a scrolling right-hand column, so
    // pre-selecting a tab without scrolling looked like the link did nothing.
    // Inside a modal there is nothing to scroll to — the panel IS the view.
    //
    // The HORIZONTAL scroll still matters: the five tabs scroll sideways at
    // narrow widths and 'Caught Being Great' is the LAST of them, so without
    // this the strip reads "Assign Chore / Add Expense / Direct Award" while
    // the form below is already the recognition one. Correct content under a
    // tab bar showing a different tab reads as a bug.
    panelRef.current
      ?.querySelector('[data-tab="character"]')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [initialTab])
  const [childId, setChildId] = useState('')
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Direct Award state, kept separate from itemId so switching tabs never
  // carries a half-filled award over into an assignment.
  const [source, setSource] = useState<'library' | 'custom'>('library')
  const [awardChoreId, setAwardChoreId] = useState('')
  // Held as text, not a number: a number state can't represent "the field is
  // empty", so backspacing snapped straight back to 1 and the parent could
  // never clear it (they had to select-all and overtype).
  const [quantity, setQuantity] = useState('1')
  const [customTitle, setCustomTitle] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [note, setNote] = useState('')

  // Direct Charge state. Held separately from the award fields for the same
  // reason those are held separately from itemId: switching tabs must never
  // carry a half-filled charge into an award, or vice versa.
  const [chargeTitle, setChargeTitle] = useState('')
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeNote, setChargeNote] = useState('')

  // "Caught Being Great" state, held separately for the same reason every other
  // tab's is: switching tabs must never carry a half-filled recognition into an
  // award. The amount defaults to the book's own value for
  // "Get Caught Serving the Family" and stays editable.
  // Which of the three Chapter 8 recognitions is being given. Character Moment
  // is the default, so the existing flow is byte-for-byte what it was.
  const [recognition, setRecognition] = useState<RecognitionCategory>(CHARACTER_MOMENT_CATEGORY)
  const [characterTitle, setCharacterTitle] = useState('')
  const [characterAmount, setCharacterAmount] = useState(CHARACTER_MOMENT_DEFAULT)
  const [characterNote, setCharacterNote] = useState('')

  const recognitionCfg = recognitionType(recognition)

  /**
   * Switching type re-fills the description and amount from that recognition's
   * defaults — but only the fields the type OWNS. The note is the parent's own
   * writing and survives, the way it does when they retype a title.
   *
   * Both fields stay editable afterwards, which is the point: the defaults are
   * a starting position, not a price list.
   */
  function selectRecognition(category: RecognitionCategory) {
    const cfg = recognitionType(category)
    setRecognition(category)
    setCharacterTitle(cfg.defaultTitle)
    setCharacterAmount(cfg.defaultAmount)
    setDone(null)
    setError(null)
  }

  const awardChore = chores.find((c) => c.id === awardChoreId)
  const parsedAmount = Number.parseFloat(customAmount)
  const parsedQuantity = Number.parseInt(quantity, 10)
  const quantityValid = Number.isFinite(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10
  const customValid =
    customTitle.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0
  const awardTotal =
    source === 'library'
      ? (awardChore?.value ?? 0) * (quantityValid ? parsedQuantity : 0)
      : customValid
        ? parsedAmount
        : 0

  /**
   * The single unmet requirement blocking the Award button, or null when it is
   * ready. Drives BOTH the disabled state and the message under the button.
   *
   * This exists because a disabled button was the whole of the bug: the panel
   * would print "Total award: $5.55" next to a gold Award button that silently
   * did nothing, with no clue that the child dropdown up at the top of a
   * scrolled panel had never been set. Money buttons must say why they refuse.
   */
  const awardBlockReason: string | null = !childId
    ? 'Select a child to award to.'
    : source === 'library'
      ? !awardChoreId
        ? 'Select a chore from the library.'
        : quantity.trim() === '' || parsedQuantity === 0
          ? 'Enter a quantity to continue.'
          : !quantityValid
            ? 'Quantity must be between 1 and 10.'
            : null
      : !customTitle.trim()
        ? 'Add a description for this award.'
        : !(Number.isFinite(parsedAmount) && parsedAmount > 0)
          ? 'Enter an amount greater than zero.'
          : null
  const awardReady = awardBlockReason === null

  const parsedCharge = Number.parseFloat(chargeAmount)
  const chargeAmountValid = Number.isFinite(parsedCharge) && parsedCharge > 0

  /** Same contract as awardBlockReason - a money button must say why it refuses. */
  const chargeBlockReason: string | null = !childId
    ? 'Select a child to charge.'
    : !chargeTitle.trim()
      ? 'Add a description for this charge.'
      : !chargeAmountValid
        ? 'Enter an amount greater than zero.'
        : null
  const chargeReady = chargeBlockReason === null

  const parsedCharacter = Number.parseFloat(characterAmount)
  const characterAmountValid = Number.isFinite(parsedCharacter) && parsedCharacter > 0

  /** Same contract as awardBlockReason — a money button must say why it refuses. */
  const characterBlockReason: string | null = !childId
    ? 'Select a child to recognize.'
    : !characterTitle.trim()
      ? // Only reachable on a named award if the parent clears the prefill.
        recognition === CHARACTER_MOMENT_CATEGORY
        ? 'Describe what they did.'
        : 'Add a title for this recognition.'
      : !characterAmountValid
        ? 'Enter an amount greater than zero.'
        : null
  const characterReady = characterBlockReason === null

  /** Same contract for the Assign Chore / Add Expense tabs. */
  const simpleBlockReason: string | null = !childId
    ? 'Select a child first.'
    : !itemId
      ? mode === 'chore'
        ? 'Select a chore to assign.'
        : 'Select an expense to apply.'
      : null

  function resetAward() {
    setSource('library')
    setAwardChoreId('')
    setQuantity('1')
    setCustomTitle('')
    setCustomAmount('')
    setNote('')
  }

  function resetCharge() {
    setChargeTitle('')
    setChargeAmount('')
    setChargeNote('')
  }

  function resetCharacter() {
    // Back to Character Moment, not to whichever type was last used: this runs
    // on tab switch, and a parent returning to the tab should find it in the
    // same state it has always opened in.
    setRecognition(CHARACTER_MOMENT_CATEGORY)
    setCharacterTitle('')
    setCharacterAmount(CHARACTER_MOMENT_DEFAULT)
    setCharacterNote('')
  }

  async function submit() {
    setBusy(true)
    setDone(null)
    setError(null)
    try {
      if (mode === 'award') {
        const childName = children.find((c) => c.id === childId)?.display_name ?? 'them'
        const credited = formatCurrency(awardTotal, currency)
        if (source === 'library') {
          await directAwardFromLibrary(awardChoreId, childId, assignedBy, parsedQuantity, note)
        } else {
          await directAwardCustom(familyId, childId, assignedBy, customTitle, parsedAmount, note)
        }
        await onDone()
        setDone(`Awarded ${credited} to ${childName}.`)
        resetAward()
      } else if (mode === 'charge') {
        const childName = children.find((c) => c.id === childId)?.display_name ?? 'them'
        const debited = formatCurrency(parsedCharge, currency)
        await directChargeCustom(familyId, childId, chargeTitle, parsedCharge, chargeNote)
        await onDone()
        setDone(`Charged ${debited} to ${childName}.`)
        resetCharge()
      } else if (mode === 'character') {
        const childName = children.find((c) => c.id === childId)?.display_name ?? 'them'
        const credited = formatCurrency(parsedCharacter, currency)
        // The same insert-then-approve path as a custom Direct Award; only the
        // marker category differs, and that category is what raises the
        // celebration on the child's dashboard.
        await directAwardCustom(
          familyId,
          childId,
          assignedBy,
          characterTitle,
          parsedCharacter,
          characterNote,
          recognition
        )
        await onDone()
        setDone(`Recognized ${childName} — ${credited} credited.`)
        // Keeps the recognition TYPE and refills its defaults, rather than
        // snapping back to Character Moment: naming an Earner of the Week
        // usually means naming one per child, and re-picking the pill between
        // each is friction the parent gains nothing from. The tab-switch reset
        // is the one that returns the panel to its default state.
        selectRecognition(recognition)
        setCharacterNote('')
      } else if (mode === 'chore') {
        await quickAssignChore(itemId, childId, assignedBy)
        await onDone()
        setDone('Chore assigned to the roster.')
        setItemId('')
      } else {
        await applyExpense(itemId, childId)
        await onDone()
        setDone('Expense applied.')
        setItemId('')
      }
    } catch (e) {
      // Awards and charges move real money, so a failure has to be visible
      // rather than a silently rejected promise.
      setError(e instanceof Error ? e.message : 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  const fieldClass =
    'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'
  const labelClass = 'label-caps mb-2 block text-[11px] text-text-muted'

  /**
   * Item 3 — what this child's day is already worth, and what it becomes once
   * this chore lands. Only meaningful for a daily chore: a weekly or monthly one
   * doesn't move the daily figure, so it says so rather than printing a total
   * that silently didn't change.
   */
  const selectedChild = children.find((c) => c.id === childId)
  const selectedChore = chores.find((c) => c.id === itemId)
  const dailyReadout =
    mode === 'chore' && selectedChild && selectedChore ? (
      <div className="rounded-input border border-line bg-deep px-3 py-2 text-xs text-text-muted">
        <div>
          {selectedChild.display_name}'s current daily total:{' '}
          <span className="font-semibold text-antique">
            {formatCurrency(dailyRosterTotal(roster, selectedChild.id), currency)}
          </span>
        </div>
        {selectedChore.frequency === 'daily' ? (
          <div className="mt-0.5">
            After this assignment:{' '}
            <span className="font-semibold text-antique">
              {formatCurrency(
                dailyRosterTotal(roster, selectedChild.id) + selectedChore.value,
                currency
              )}
            </span>
          </div>
        ) : (
          <div className="mt-0.5">
            This is a {formatFrequency(selectedChore.frequency, null, null).toLowerCase()} chore.
          </div>
        )}
      </div>
    ) : null

  /**
   * The mirror of dailyReadout, for money leaving the account. Shows the child's
   * balance before and after, live as the amount is typed, and warns when the
   * charge would overdraft. The warning does NOT block: a parent may create a
   * negative balance deliberately, as a teaching moment.
   */
  const chargeAfter = (selectedChild?.balance ?? 0) - (chargeAmountValid ? parsedCharge : 0)
  const chargeReadout =
    mode === 'charge' && selectedChild ? (
      <div className="rounded-input border border-line bg-deep px-3 py-2 text-xs text-text-muted">
        <div>
          {selectedChild.display_name}'s current balance:{' '}
          <span className="font-semibold text-antique">
            {formatCurrency(selectedChild.balance ?? 0, currency)}
          </span>
        </div>
        <div className="mt-0.5">
          After this charge:{' '}
          <span className={cn('font-semibold', chargeAfter < 0 ? 'text-danger' : 'text-antique')}>
            {formatCurrency(chargeAfter, currency)}
          </span>
        </div>
        {chargeAmountValid && chargeAfter < 0 && (
          <div className="mt-1 text-danger">
            This charge would overdraft {selectedChild.display_name}'s account.
          </div>
        )}
      </div>
    ) : null

  const tabs = [
    { key: 'chore', label: 'Assign Chore' },
    { key: 'expense', label: 'Add Expense' },
    { key: 'award', label: 'Direct Award' },
    { key: 'charge', label: 'Direct Charge' },
    { key: 'character', label: 'Caught Being Great' },
  ] as const

  return (
    /* No heading and no Card of its own any more: this now renders INSIDE a
       Modal that already supplies the panel and the "Quick Add" title, and a
       second copy of either would read as a nested dialog. The body below is
       otherwise untouched. */
    <div ref={panelRef} className="flex flex-col gap-3">
        {/* Five tabs do not fit at 375px. They scroll horizontally instead of
            wrapping or squeezing: wrapping made the strip two rows tall and
            pushed the form off screen, and squeezing broke the 48px target.
            sm:flex-1 restores the even fill once there is room. */}
        <div className="scroll-panel flex gap-1 overflow-x-auto rounded-input border border-line bg-deep p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              data-tab={t.key}
              onClick={() => {
                setMode(t.key)
                setItemId('')
                setDone(null)
                setError(null)
                resetAward()
                resetCharge()
                resetCharacter()
              }}
              className={cn(
                'label-caps flex min-h-[48px] shrink-0 items-center justify-center',
                'whitespace-nowrap rounded-input px-3 text-[11px] sm:flex-1',
                mode === t.key ? 'bg-wash text-antique' : 'text-text-muted'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select value={childId} onChange={(e) => setChildId(e.target.value)} className={fieldClass}>
          <option value="">Select child…</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </select>

        {mode === 'award' ? (
          <>
            <div className="flex gap-1 rounded-input border border-line bg-deep p-1">
              {(['library', 'custom'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSource(s)
                    setDone(null)
                    setError(null)
                  }}
                  className={cn(
                    'label-caps flex-1 rounded-input py-2 text-[11px]',
                    source === s ? 'bg-wash text-antique' : 'text-text-muted'
                  )}
                >
                  {s === 'library' ? 'From Library' : 'Custom Amount'}
                </button>
              ))}
            </div>

            {source === 'library' ? (
              <>
                <select
                  value={awardChoreId}
                  onChange={(e) => setAwardChoreId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select chore…</option>
                  {chores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {formatCurrency(c.value, currency)}
                    </option>
                  ))}
                </select>

                <div>
                  <label htmlFor="award-qty" className={labelClass}>
                    How many?
                  </label>
                  {/* Deliberately a text input: type="number" bound to a
                      numeric state was clamped every keystroke, so backspace
                      could never empty the field. Digits-only is enforced in
                      onChange; the 1-10 range is enforced by awardBlockReason
                      rather than by rewriting what the parent is still typing. */}
                  <input
                    id="award-qty"
                    type="text"
                    inputMode="numeric"
                    aria-describedby={awardBlockReason ? 'award-block-reason' : undefined}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                    className={cn(fieldClass, 'min-h-touch')}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="award-desc" className={labelClass}>
                    Description
                  </label>
                  <input
                    id="award-desc"
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Received an A on assignment"
                    className={cn(fieldClass, 'min-h-touch')}
                  />
                </div>
                <div>
                  <label htmlFor="award-amount" className={labelClass}>
                    Amount
                  </label>
                  <input
                    id="award-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="0.00"
                    className={cn(fieldClass, 'min-h-touch')}
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="award-note" className={labelClass}>
                Add a note (optional)
              </label>
              <textarea
                id="award-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. Math test, received an A"
                className={fieldClass}
              />
            </div>

            <p className="text-center text-lg text-text">
              Total award:{' '}
              <span className="display font-semibold text-antique">
                {formatCurrency(awardTotal, currency)}
              </span>
            </p>

            <Button
              variant="accent"
              fullWidth
              size="lg"
              onClick={submit}
              disabled={!awardReady || busy}
            >
              {busy ? 'Working…' : 'Award'}
            </Button>

            {awardBlockReason && (
              <p id="award-block-reason" className="text-center text-xs text-text-muted">
                {awardBlockReason}
              </p>
            )}
          </>
        ) : mode === 'character' ? (
          <>
            {/* The three Chapter 8 recognitions. Pills rather than a <select>:
                there are exactly three, they are the first decision on the tab,
                and a dropdown would hide two of them behind a tap. Scrolls
                horizontally at 375px for the same reason the tab strip does —
                wrapping cost a second row, squeezing broke the touch target. */}
            <div
              role="radiogroup"
              aria-label="Recognition type"
              className="scroll-panel flex gap-1 overflow-x-auto rounded-input border border-line bg-deep p-1"
            >
              {RECOGNITION_TYPES.map((t) => (
                <button
                  key={t.category}
                  role="radio"
                  aria-checked={recognition === t.category}
                  onClick={() => selectRecognition(t.category)}
                  className={cn(
                    'min-h-touch shrink-0 whitespace-nowrap rounded-input px-4 text-sm sm:flex-1',
                    recognition === t.category
                      ? 'bg-antique font-medium text-deep'
                      : 'text-text-muted hover:text-text'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <p className="text-sm text-text-muted">{recognitionCfg.prompt}</p>

            <div>
              <label htmlFor="character-desc" className={labelClass}>
                {recognitionCfg.titleLabel}
              </label>
              <input
                id="character-desc"
                type="text"
                value={characterTitle}
                onChange={(e) => setCharacterTitle(e.target.value)}
                placeholder={recognitionCfg.titlePlaceholder}
                className={cn(fieldClass, 'min-h-touch')}
              />
            </div>

            <div>
              <label htmlFor="character-amount" className={labelClass}>
                Amount
              </label>
              <input
                id="character-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                aria-describedby={characterBlockReason ? 'character-block-reason' : undefined}
                value={characterAmount}
                onChange={(e) => setCharacterAmount(e.target.value)}
                placeholder={recognitionCfg.defaultAmount}
                className={cn(fieldClass, 'min-h-touch')}
              />
            </div>

            <div>
              <label htmlFor="character-note" className={labelClass}>
                Add a note (optional)
              </label>
              <textarea
                id="character-note"
                value={characterNote}
                onChange={(e) => setCharacterNote(e.target.value)}
                rows={2}
                placeholder={recognitionCfg.notePlaceholder}
                className={fieldClass}
              />
            </div>

            {/* Antique, not primary gold — matching every other Quick Add
                submit. DESIGN_SYSTEM.md §5 assigns this screen's single gold
                slot to Approve and records Quick Add submit as the action that
                stepped down. The spec asked for gold here; the design system
                wins, because a second gold element would break the budget the
                whole aesthetic rests on. */}
            <Button
              variant="accent"
              fullWidth
              size="lg"
              onClick={submit}
              disabled={!characterReady || busy}
            >
              <Sparkles className="h-5 w-5" /> {busy ? 'Working…' : 'Recognize'}
            </Button>

            {characterBlockReason && (
              <p id="character-block-reason" className="text-center text-xs text-text-muted">
                {characterBlockReason}
              </p>
            )}
          </>
        ) : mode === 'charge' ? (
          <>
            <div>
              <label htmlFor="charge-desc" className={labelClass}>
                Description
              </label>
              <input
                id="charge-desc"
                type="text"
                value={chargeTitle}
                onChange={(e) => setChargeTitle(e.target.value)}
                placeholder="Pokemon cards"
                className={cn(fieldClass, 'min-h-touch')}
              />
            </div>
            <div>
              <label htmlFor="charge-amount" className={labelClass}>
                Amount
              </label>
              <input
                id="charge-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                aria-describedby={chargeBlockReason ? 'charge-block-reason' : undefined}
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
                placeholder="0.00"
                className={cn(fieldClass, 'min-h-touch')}
              />
            </div>

            {chargeReadout}

            <div>
              <label htmlFor="charge-note" className={labelClass}>
                Add a note (optional)
              </label>
              <textarea
                id="charge-note"
                value={chargeNote}
                onChange={(e) => setChargeNote(e.target.value)}
                rows={2}
                placeholder="e.g. Pokemon cards at Target"
                className={fieldClass}
              />
            </div>

            <Button
              variant="accent"
              fullWidth
              size="lg"
              onClick={submit}
              disabled={!chargeReady || busy}
            >
              {busy ? 'Working…' : 'Charge'}
            </Button>

            {chargeBlockReason && (
              <p id="charge-block-reason" className="text-center text-xs text-text-muted">
                {chargeBlockReason}
              </p>
            )}
          </>
        ) : (
          <>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={fieldClass}>
              <option value="">{mode === 'chore' ? 'Select chore…' : 'Select expense…'}</option>
              {mode === 'chore'
                ? chores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {formatCurrency(c.value, currency)} ·{' '}
                      {formatFrequency(c.frequency, null, null)}
                    </option>
                  ))
                : expenses.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title} · {formatCurrency(e.amount, currency)}
                    </option>
                  ))}
            </select>

            {dailyReadout}

            <Button
              variant="accent"
              fullWidth
              size="lg"
              onClick={submit}
              disabled={!!simpleBlockReason || busy}
            >
              {busy ? 'Working…' : mode === 'chore' ? 'Assign Chore' : 'Apply Expense'}
            </Button>

            {simpleBlockReason && (
              <p className="text-center text-xs text-text-muted">{simpleBlockReason}</p>
            )}
          </>
        )}

      {done && <p className="text-center text-sm text-green">{done}</p>}
      {error && <p className="text-center text-sm text-danger">{error}</p>}
    </div>
  )
}

/**
 * Declining a request requires a note, for the same reason rejecting a chore
 * does: the note IS the message. There is no notifications table, so
 * chore_assignments.notes is the only channel a parent has to tell a child why
 * the answer was no — and a child who asked to do MORE work is owed one.
 *
 * Unlike RejectModal this arrives EMPTY. A rejected chore has a common default
 * reason ("completed after multiple reminders"); a declined request does not,
 * and a pre-filled excuse would be worse than none.
 */
function DeclineRequestModal({
  request,
  onClose,
  onSubmit,
}: {
  request: ChoreRequest | null
  onClose: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (request) setNote('')
  }, [request])

  const isRoster = !!request?.is_template

  return (
    <Modal open={!!request} onClose={onClose} title="Decline request">
      <p className="mb-4 text-text-muted">
        {request?.member?.display_name} asked to{' '}
        {isRoster ? 'add' : 'do'} “{request?.chore?.title}”
        {isRoster ? ' to their regular chores' : ' today'}.
      </p>
      <label htmlFor="decline-note" className="label-caps mb-2 block text-[11px] text-text-muted">
        Reason (required)
      </label>
      <textarea
        id="decline-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Let them know why — maybe not this week, or pick a different one..."
        className="w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={() => onSubmit(note.trim())} disabled={!note.trim()}>
          Decline
        </Button>
      </div>
      {!note.trim() && (
        <p className="mt-2 text-right text-xs text-text-muted">
          Add a reason so they know what happened.
        </p>
      )}
    </Modal>
  )
}
