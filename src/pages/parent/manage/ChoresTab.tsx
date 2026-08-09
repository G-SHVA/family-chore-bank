import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, Pencil, X, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getFamilyChores,
  getRoster,
  createChore,
  updateChore,
  deleteChore,
  quickAssignChore,
  removeRosterEntry,
  type ChoreInput,
  type RosterEntry,
} from '@/features/chores/choreService'
import { isChild } from '@/features/family/familyService'
import type { Chore } from '@/lib/supabase'
import { CHORE_CATEGORIES, FREQUENCIES } from '@/lib/constants'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn, formatCurrency } from '@/lib/utils'

const WEEKLY_MULTIPLIER: Record<string, number> = { daily: 7, weekly: 1, monthly: 0.25, once: 0 }

export default function ChoresTab() {
  const { family, members, activeMember } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'
  const children = useMemo(() => members.filter(isChild), [members])

  const [chores, setChores] = useState<Chore[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Chore | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId) return
    const [c, r] = await Promise.all([getFamilyChores(familyId), getRoster()])
    setChores(c)
    setRoster(r)
    setLoading(false)
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  const potentialWeekly = useMemo(
    () =>
      roster.reduce(
        (sum, r) => sum + (r.chore?.value ?? 0) * (WEEKLY_MULTIPLIER[r.chore?.frequency ?? 'once'] ?? 0),
        0
      ),
    [roster]
  )
  const assignedChoreIds = useMemo(() => new Set(roster.map((r) => r.chore_id)), [roster])

  async function handleAssign(choreId: string, memberId: string) {
    if (!activeMember || !memberId) return
    setBusy(choreId + memberId)
    try {
      await quickAssignChore(choreId, memberId, activeMember.id)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(templateId: string) {
    setBusy(templateId)
    try {
      await removeRosterEntry(templateId)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function handleDelete(choreId: string) {
    setBusy(choreId)
    try {
      await deleteChore(choreId)
      await load()
    } catch {
      alert('Cannot delete a chore that is still assigned. Remove it from rosters first.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  const filtered = chores.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col gap-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Library chores" value={chores.length} />
        <Stat label="Roster assignments" value={roster.length} />
        <Stat label="Potential weekly" value={formatCurrency(potentialWeekly, currency)} accent="green" />
        <Stat label="Unassigned" value={chores.length - assignedChoreIds.size} />
      </div>

      {/* Roster by child */}
      <section>
        <h2 className="mb-3 text-xl font-bold">Roster by child</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {children.map((child) => {
            const entries = roster.filter((r) => r.assigned_to === child.id)
            return (
              <Card key={child.id}>
                <div className="mb-3 font-bold">{child.display_name}</div>
                {entries.length === 0 ? (
                  <p className="text-sm text-text-muted">No chores assigned yet.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {entries.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between rounded-input bg-bg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{e.chore?.title}</div>
                          <div className="text-xs text-text-muted">
                            {formatCurrency(e.chore?.value ?? 0, currency)} · {e.chore?.frequency}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemove(e.id)}
                          disabled={busy === e.id}
                          className="ml-2 flex h-9 w-9 items-center justify-center rounded-full text-text-muted hover:bg-danger/10 hover:text-danger"
                          aria-label="Remove"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </section>

      {/* Library */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Chore library</h2>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" /> Create Chore
          </Button>
        </div>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chores…"
            className="w-full rounded-input border border-white/10 bg-card py-3 pl-11 pr-4 text-text focus:border-gold focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.title}</div>
                  <div className="text-xs uppercase tracking-wide text-text-muted">
                    {c.category} · {c.frequency}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-gold/15 px-3 py-1 text-sm font-bold text-gold">
                  {formatCurrency(c.value, currency)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) handleAssign(c.id, e.target.value)
                    e.target.value = ''
                  }}
                  className="min-h-touch flex-1 rounded-input border border-white/10 bg-bg px-3 text-sm text-text focus:border-gold focus:outline-none"
                >
                  <option value="">Assign to…</option>
                  {children.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.display_name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setEditing(c)}
                  className="flex h-11 w-11 items-center justify-center rounded-input text-text-muted hover:bg-white/5 hover:text-text"
                  aria-label="Edit"
                >
                  <Pencil className="h-5 w-5" />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  disabled={busy === c.id}
                  className="flex h-11 w-11 items-center justify-center rounded-input text-text-muted hover:bg-danger/10 hover:text-danger"
                  aria-label="Delete"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {(creating || editing) && (
        <ChoreFormModal
          chore={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSave={async (input) => {
            if (editing) await updateChore(editing.id, input)
            else if (familyId) await createChore(familyId, input)
            setCreating(false)
            setEditing(null)
            await load()
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
      <span className={cn('text-2xl font-extrabold', accent === 'green' ? 'text-green' : 'text-text')}>
        {value}
      </span>
      <span className="text-xs uppercase tracking-wide text-text-muted">{label}</span>
    </Card>
  )
}

function ChoreFormModal({
  chore,
  onClose,
  onSave,
}: {
  chore: Chore | null
  onClose: () => void
  onSave: (input: ChoreInput) => Promise<void>
}) {
  const [title, setTitle] = useState(chore?.title ?? '')
  const [value, setValue] = useState(String(chore?.value ?? '0.10'))
  const [frequency, setFrequency] = useState(chore?.frequency ?? 'daily')
  const [category, setCategory] = useState(chore?.category ?? 'household')
  const [busy, setBusy] = useState(false)

  const inputClass =
    'w-full rounded-input border border-white/10 bg-card p-3 text-text focus:border-gold focus:outline-none'

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({
        title: title.trim(),
        value: parseFloat(value) || 0,
        frequency: frequency as ChoreInput['frequency'],
        category,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={chore ? 'Edit chore' : 'Create chore'}>
      <div className="flex flex-col gap-3">
        <label className="text-sm text-text-muted">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-text-muted">Value ($)</label>
            <input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm text-text-muted">Frequency</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="text-sm text-text-muted">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
          {CHORE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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
