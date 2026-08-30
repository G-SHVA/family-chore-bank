import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Search,
  Pause,
  Play,
  Archive,
  ArchiveRestore,
  CalendarClock,
  AlertTriangle,
  UserPlus,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getFamilyChores,
  getRoster,
  getMissedInstances,
  getChoreUsage,
  createChore,
  updateChore,
  deleteChore,
  archiveChore,
  unarchiveChore,
  assignChoreToMembers,
  setRosterEntryActive,
  setRosterEntryDay,
  removeRosterEntry,
  dailyRosterTotal,
  dayLabel,
  DAY_LABELS,
  type ChoreInput,
  type ChoreUsage,
  type RosterEntry,
  type MissedInstance,
} from '@/features/chores/choreService'
import { isChild } from '@/features/family/familyService'
import type { Chore, FamilyMember } from '@/lib/supabase'
import { CHORE_CATEGORIES, FREQUENCIES } from '@/lib/constants'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import { cn, formatCurrency } from '@/lib/utils'

const WEEKLY_MULTIPLIER: Record<string, number> = { daily: 7, weekly: 1, monthly: 0.25, once: 0 }

const inputClass =
  'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'

export default function ChoresTab() {
  const { family, members, activeMember } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'
  const children = useMemo(() => members.filter(isChild), [members])

  const [chores, setChores] = useState<Chore[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [missed, setMissed] = useState<MissedInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Chore | null>(null)
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState<Chore | null>(null)
  const [deleting, setDeleting] = useState<{ chore: Chore; usage: ChoreUsage } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId) return
    try {
      setError(null)
      const [c, r, m] = await Promise.all([
        getFamilyChores(familyId, true),
        getRoster(),
        getMissedInstances(14),
      ])
      setChores(c)
      setRoster(r)
      setMissed(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load chores.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  /** Wraps a mutation with a busy key + error surface, then reloads. */
  async function run(key: string, fn: () => Promise<void>, failMessage: string) {
    setBusy(key)
    try {
      setError(null)
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : failMessage)
    } finally {
      setBusy(null)
    }
  }

  const activeRoster = useMemo(() => roster.filter((r) => r.is_active), [roster])
  const potentialWeekly = useMemo(
    () =>
      activeRoster.reduce(
        (sum, r) =>
          sum + (r.chore?.value ?? 0) * (WEEKLY_MULTIPLIER[r.chore?.frequency ?? 'once'] ?? 0),
        0
      ),
    [activeRoster]
  )

  async function handleDeleteRequest(chore: Chore) {
    setBusy(chore.id)
    try {
      setError(null)
      const usage = await getChoreUsage(chore.id)
      setDeleting({ chore, usage })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check where this chore is used.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-antique" />
      </div>
    )
  }

  const visibleChores = chores.filter((c) => showArchived || !c.is_archived)
  const filtered = visibleChores.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  )
  const archivedCount = chores.filter((c) => c.is_archived).length

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="flex items-start gap-3 rounded-card border border-danger/40 bg-danger/10 p-4 text-danger">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Library chores" value={visibleChores.length} />
        <Stat label="Active assignments" value={activeRoster.length} />
        <Stat label="Paused" value={roster.length - activeRoster.length} />
        <Stat
          label="Potential weekly"
          value={formatCurrency(potentialWeekly, currency)}
          accent="green"
        />
      </div>

      {/* Current roster */}
      <CollapsibleSection
        title="Current roster"
        maxHeight={320}
        defaultOpen
        meta={`${activeRoster.length} active`}
      >
        <div className="grid grid-cols-1 gap-4 pr-1 lg:grid-cols-2">
          {children.map((child) => (
            <RosterCard
              key={child.id}
              child={child}
              entries={roster.filter((r) => r.assigned_to === child.id)}
              currency={currency}
              busy={busy}
              onToggle={(entry) =>
                run(
                  entry.id,
                  () => setRosterEntryActive(entry.id, !entry.is_active),
                  'Could not update that roster entry.'
                )
              }
              onDay={(entry, dow) =>
                run(
                  entry.id,
                  () => setRosterEntryDay(entry.id, dow),
                  'Could not change the day for that chore.'
                )
              }
              onRemove={(entry) =>
                run(entry.id, () => removeRosterEntry(entry.id), 'Could not remove that entry.')
              }
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* Missed chores. Rendered even when empty: a section that vanishes when
          there is nothing to see makes the tab's shape change under the parent,
          and "no missed chores" is itself worth reading. */}
      <CollapsibleSection
        title="Missed chores (last 14 days)"
        maxHeight={240}
        meta={missed.length > 0 ? `${missed.length}` : undefined}
      >
        <Card className="flex flex-col gap-2">
          {missed.length === 0 ? (
            <p className="py-2 text-sm text-text-muted">
              Nothing missed in the last 14 days.
            </p>
          ) : (
            <>
              {missed.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-input bg-bg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{m.chore?.title}</div>
                    <div className="text-xs text-text-muted">
                      {m.member?.display_name} ·{' '}
                      {m.due_date ? new Date(m.due_date).toLocaleDateString() : 'no due date'}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-input border border-line px-3 py-1 label-caps text-[10px] text-text-muted">
                    Expired
                  </span>
                </div>
              ))}
            </>
          )}
        </Card>
      </CollapsibleSection>

      {/* Library */}
      <CollapsibleSection
        title="Chore library"
        maxHeight={400}
        meta={`${visibleChores.length}`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" /> Create Chore
          </Button>
        }
      >
        {/* Item 5 — what a day is currently worth for each child. Sits inside
            the scrolling body, directly above the tiles, so it reads as a
            property of the library rather than of the whole tab. */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          {children.map((child) => (
            <div key={child.id} className="border border-line bg-card px-3 py-2">
              <div className="truncate text-xs text-text-muted">{child.display_name}</div>
              <div className="mt-0.5 text-xs text-text-muted">
                Daily total:{' '}
                <span className="font-semibold text-antique">
                  {formatCurrency(dailyRosterTotal(roster, child.id), currency)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chores…"
              className="w-full rounded-input border border-line bg-deep py-3 pl-11 pr-4 text-text focus:border-antique focus:outline-none"
            />
          </div>
          {archivedCount > 0 && (
            <Button variant="secondary" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((c) => {
            const assignedTo = roster
              .filter((r) => r.chore_id === c.id && r.is_active)
              .map((r) => r.member?.display_name)
              .filter(Boolean)
            return (
              <div
                key={c.id}
                className={cn(
                  // Not <Card>: this tile needs 12px padding and Card is p-5.
                  // Overriding p-5 through className is a coin-toss on Tailwind
                  // class order, so the tile owns its own box instead.
                  'rounded-card border border-line bg-card p-3',
                  c.is_archived && 'opacity-60'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{c.title}</span>
                      {c.is_custom && (
                        <span className="label-caps rounded-input border border-antique/40 px-1.5 py-0.5 text-[9px] text-antique">
                          Custom
                        </span>
                      )}
                      {c.is_archived && (
                        <span className="rounded-input border border-line px-1.5 py-0.5 label-caps text-[9px] text-text-muted">
                          Archived
                        </span>
                      )}
                    </div>
                    {c.description && (
                      <p className="mt-1 line-clamp-1 text-xs text-text-muted">{c.description}</p>
                    )}
                    {assignedTo.length > 0 && (
                      <p className="mt-1 truncate text-[11px] text-green">
                        Assigned to {assignedTo.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setEditing(c)}
                      className="flex h-11 w-11 items-center justify-center rounded-input text-text-muted hover:bg-wash hover:text-text"
                      aria-label={`Edit ${c.title}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteRequest(c)}
                      disabled={busy === c.id}
                      className="flex h-11 w-11 items-center justify-center rounded-input text-text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Delete ${c.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Value, frequency and the action share one row — the Assign
                    button no longer gets a full-width row of its own. */}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="label-caps shrink-0 rounded-input border border-antique/40 px-2 py-0.5 text-xs text-antique">
                      {formatCurrency(c.value, currency)}
                    </span>
                    <span className="label-caps truncate text-[10px] text-text-muted">
                      {c.category} · {c.frequency}
                    </span>
                  </div>
                  {c.is_archived ? (
                    <button
                      disabled={busy === c.id}
                      onClick={() =>
                        run(c.id, () => unarchiveChore(c.id), 'Could not restore that chore.')
                      }
                      className="label-caps flex shrink-0 items-center gap-1.5 rounded-input border border-line px-3 py-1.5 text-[12px] text-text hover:border-antique/40 disabled:opacity-40"
                    >
                      <ArchiveRestore className="h-4 w-4" /> Restore
                    </button>
                  ) : (
                    <button
                      onClick={() => setAssigning(c)}
                      className="label-caps flex shrink-0 items-center gap-1.5 rounded-input border border-line px-3 py-1.5 text-[12px] text-text hover:border-antique/40"
                    >
                      <UserPlus className="h-4 w-4" /> Assign
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {filtered.length === 0 && (
          <p className="py-8 text-center text-text-muted">No chores match that search.</p>
        )}
      </CollapsibleSection>

      {(creating || editing) && (
        <ChoreFormModal
          chore={editing}
          kids={children}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSave={async (input, assignTo, dow) => {
            if (editing) {
              await updateChore(editing.id, input)
            } else if (familyId && activeMember) {
              const chore = await createChore(familyId, input)
              if (assignTo.length > 0) {
                await assignChoreToMembers(chore.id, assignTo, activeMember.id, dow)
              }
            }
            setCreating(false)
            setEditing(null)
            await load()
          }}
        />
      )}

      {assigning && activeMember && (
        <AssignModal
          chore={assigning}
          kids={children}
          currency={currency}
          alreadyAssigned={roster
            .filter((r) => r.chore_id === assigning.id)
            .map((r) => r.assigned_to)}
          onClose={() => setAssigning(null)}
          onAssign={async (memberIds, dow) => {
            await assignChoreToMembers(assigning.id, memberIds, activeMember.id, dow)
            setAssigning(null)
            await load()
          }}
        />
      )}

      {deleting && (
        <DeleteChoreModal
          chore={deleting.chore}
          usage={deleting.usage}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            const id = deleting.chore.id
            setDeleting(null)
            await run(id, () => deleteChore(id), 'Could not delete that chore.')
          }}
          onArchive={async () => {
            const id = deleting.chore.id
            setDeleting(null)
            await run(id, () => archiveChore(id), 'Could not archive that chore.')
          }}
        />
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string | number
  accent?: 'green'
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span
        className={cn('display text-2xl', accent === 'green' ? 'text-green' : 'text-text')}
      >
        {value}
      </span>
      <span className="label-caps text-[10px] text-text-muted">{label}</span>
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Roster
 * ------------------------------------------------------------------ */

function RosterCard({
  child,
  entries,
  currency,
  busy,
  onToggle,
  onDay,
  onRemove,
}: {
  child: FamilyMember
  entries: RosterEntry[]
  currency: string
  busy: string | null
  onToggle: (entry: RosterEntry) => void
  onDay: (entry: RosterEntry, dow: number | null) => void
  onRemove: (entry: RosterEntry) => void
}) {
  const [confirmRemove, setConfirmRemove] = useState<RosterEntry | null>(null)
  const active = entries.filter((e) => e.is_active)
  const sorted = [...entries].sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
    return (a.chore?.title ?? '').localeCompare(b.chore?.title ?? '')
  })

  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="display text-lg">{child.display_name}</span>
        <span className="label-caps text-[10px] text-text-muted">
          {active.length} active
          {entries.length > active.length && ` · ${entries.length - active.length} paused`}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">No chores assigned yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((e) => {
            const isWeekly = e.chore?.frequency === 'weekly'
            const day = dayLabel(e.recurrence_dow)
            return (
              <div
                key={e.id}
                className={cn(
                  'rounded-input bg-bg px-3 py-2',
                  !e.is_active && 'opacity-55'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{e.chore?.title}</span>
                      {e.chore?.is_custom && (
                        <span className="label-caps rounded-input border border-antique/40 px-2 py-0.5 text-[10px] text-antique">
                          Custom
                        </span>
                      )}
                      {!e.is_active && (
                        <span className="rounded-input border border-line px-2 py-0.5 label-caps text-[10px] text-text-muted">
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted">
                      {formatCurrency(e.chore?.value ?? 0, currency)} · {e.chore?.frequency}
                      {isWeekly && day && ` · ${day}s`}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => onToggle(e)}
                      disabled={busy === e.id}
                      className={cn(
                        'flex min-h-touch min-w-touch items-center justify-center rounded-input',
                        e.is_active
                          ? 'text-text-muted hover:bg-wash hover:text-text'
                          : 'text-green hover:bg-green/10'
                      )}
                      aria-label={
                        e.is_active
                          ? `Pause ${e.chore?.title} for ${child.display_name}`
                          : `Resume ${e.chore?.title} for ${child.display_name}`
                      }
                    >
                      {e.is_active ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                    </button>
                    <button
                      onClick={() => setConfirmRemove(e)}
                      disabled={busy === e.id}
                      className="flex min-h-touch min-w-touch items-center justify-center rounded-input text-text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Remove ${e.chore?.title} from ${child.display_name}`}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {isWeekly && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                    <CalendarClock className="h-4 w-4 shrink-0" />
                    <span className="shrink-0">Due on</span>
                    <select
                      value={e.recurrence_dow ?? ''}
                      disabled={busy === e.id}
                      onChange={(ev) =>
                        onDay(e, ev.target.value === '' ? null : Number(ev.target.value))
                      }
                      className="min-h-touch flex-1 rounded-input border border-line bg-deep px-2 text-sm text-text focus:border-antique focus:outline-none"
                    >
                      <option value="">End of week</option>
                      {DAY_LABELS.map((label, dow) => (
                        <option key={label} value={dow}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )
          })}
        </div>
      )}

      {confirmRemove && (
        <Modal open onClose={() => setConfirmRemove(null)} title="Remove from roster?">
          <div className="flex flex-col gap-4">
            <p className="text-text-muted">
              This permanently removes <span className="text-text">{confirmRemove.chore?.title}</span>{' '}
              from {child.display_name}'s roster. Completed history is kept, but the entry can't be
              resumed later.
            </p>
            <p className="text-sm text-text-muted">
              To stop it temporarily instead, use Pause — new chores stop generating and you can
              switch it back on any time.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  onRemove(confirmRemove)
                  setConfirmRemove(null)
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ *
 * Assign / create / delete modals
 * ------------------------------------------------------------------ */

function ChildPicker({
  kids,
  selected,
  disabledIds = [],
  onChange,
}: {
  kids: FamilyMember[]
  selected: string[]
  disabledIds?: string[]
  onChange: (ids: string[]) => void
}) {
  const selectable = kids.filter((c) => !disabledIds.includes(c.id))
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.includes(c.id))

  return (
    <div className="flex flex-col gap-2">
      {kids.map((c) => {
        const disabled = disabledIds.includes(c.id)
        const checked = selected.includes(c.id)
        return (
          <button
            key={c.id}
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange(checked ? selected.filter((id) => id !== c.id) : [...selected, c.id])
            }
            className={cn(
              'flex min-h-touch items-center justify-between rounded-input border px-4 text-left',
              checked ? 'border-antique bg-wash text-text' : 'border-line bg-deep text-text',
              disabled && 'cursor-not-allowed opacity-40'
            )}
          >
            <span className="font-semibold">{c.display_name}</span>
            <span className="label-caps text-[10px] text-text-muted">
              {disabled ? 'Already assigned' : checked ? 'Selected' : ''}
            </span>
          </button>
        )
      })}
      {selectable.length > 1 && (
        <button
          type="button"
          onClick={() => onChange(allSelected ? [] : selectable.map((c) => c.id))}
          className="min-h-touch rounded-input border border-line bg-card px-4 font-semibold text-antique"
        >
          {allSelected ? 'Clear all' : `Both (${selectable.map((c) => c.display_name).join(' + ')})`}
        </button>
      )}
    </div>
  )
}

function DayPicker({
  value,
  onChange,
}: {
  value: number | null
  onChange: (dow: number | null) => void
}) {
  return (
    <div>
      <label className="text-sm text-text-muted">Day of the week</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={cn(inputClass, 'min-h-touch')}
      >
        <option value="">Any day (due end of week)</option>
        {DAY_LABELS.map((label, dow) => (
          <option key={label} value={dow}>
            {label}
          </option>
        ))}
      </select>
    </div>
  )
}

function AssignModal({
  chore,
  kids,
  currency,
  alreadyAssigned,
  onClose,
  onAssign,
}: {
  chore: Chore
  kids: FamilyMember[]
  currency: string
  alreadyAssigned: string[]
  onClose: () => void
  onAssign: (memberIds: string[], dow: number | null) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [dow, setDow] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const isWeekly = chore.frequency === 'weekly'

  async function submit() {
    if (selected.length === 0) return
    setBusy(true)
    try {
      await onAssign(selected, isWeekly ? dow : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Assign "${chore.title}"`}>
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        <p className="text-sm text-text-muted">
          {chore.frequency} · {formatCurrency(chore.value, currency)} · each child selected gets their
          own roster entry.
        </p>
        <ChildPicker
          kids={kids}
          selected={selected}
          disabledIds={alreadyAssigned}
          onChange={setSelected}
        />
        {isWeekly && <DayPicker value={dow} onChange={setDow} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || selected.length === 0}>
            {busy
              ? 'Assigning…'
              : selected.length > 1
                ? `Assign to ${selected.length} children`
                : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DeleteChoreModal({
  chore,
  usage,
  onClose,
  onDelete,
  onArchive,
}: {
  chore: Chore
  usage: ChoreUsage
  onClose: () => void
  onDelete: () => void
  onArchive: () => void
}) {
  const inUse = usage.roster > 0 || usage.history > 0

  return (
    <Modal open onClose={onClose} title={inUse ? 'This chore has history' : 'Delete chore?'}>
      <div className="flex flex-col gap-4">
        {inUse ? (
          <>
            <p className="text-text-muted">
              <span className="text-text">{chore.title}</span> has {usage.roster} roster{' '}
              {usage.roster === 1 ? 'entry' : 'entries'} and {usage.history} recorded{' '}
              {usage.history === 1 ? 'chore' : 'chores'}. Deleting it would destroy that record, so
              it can't be deleted.
            </p>
            <p className="text-sm text-text-muted">
              Archive it instead: it disappears from the library, every roster entry using it is
              paused, and all earned history stays intact.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={onArchive}>
                <Archive className="h-5 w-5" /> Archive
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-text-muted">
              <span className="text-text">{chore.title}</span> has never been assigned, so deleting
              it removes nothing else.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" onClick={onDelete}>
                <Trash2 className="h-5 w-5" /> Delete
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function ChoreFormModal({
  chore,
  kids,
  onClose,
  onSave,
}: {
  chore: Chore | null
  kids: FamilyMember[]
  onClose: () => void
  onSave: (input: ChoreInput, assignTo: string[], dow: number | null) => Promise<void>
}) {
  const [title, setTitle] = useState(chore?.title ?? '')
  const [description, setDescription] = useState(chore?.description ?? '')
  const [value, setValue] = useState(String(chore?.value ?? '0.10'))
  const [frequency, setFrequency] = useState(chore?.frequency ?? 'daily')
  const [category, setCategory] = useState(chore?.category ?? 'household')
  const [assignTo, setAssignTo] = useState<string[]>([])
  const [dow, setDow] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const isNew = !chore

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave(
        {
          title: title.trim(),
          description: description.trim() || null,
          value: parseFloat(value) || 0,
          frequency: frequency as ChoreInput['frequency'],
          category,
        },
        isNew ? assignTo : [],
        frequency === 'weekly' ? dow : null
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={chore ? 'Edit chore' : 'Create custom chore'}>
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
        <div>
          <label className="text-sm text-text-muted">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-sm text-text-muted">Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-text-muted">Value ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-text-muted">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className={inputClass}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm text-text-muted">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            {CHORE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {isNew && (
          <>
            <div>
              <label className="text-sm text-text-muted">Assign to (optional)</label>
              <div className="mt-2">
                <ChildPicker kids={kids} selected={assignTo} onChange={setAssignTo} />
              </div>
            </div>
            {frequency === 'weekly' && assignTo.length > 0 && (
              <DayPicker value={dow} onChange={setDow} />
            )}
          </>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
