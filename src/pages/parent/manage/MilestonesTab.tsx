import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Target } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getMilestones,
  createMilestone,
  getMilestoneProgress,
  type MilestoneInput,
} from '@/features/milestones/milestoneService'
import { isChild } from '@/features/family/familyService'
import type { Milestone, FamilyMember } from '@/lib/supabase'
import { MILESTONE_TEMPLATES } from '@/lib/constants'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatCurrency } from '@/lib/utils'

// milestoneId -> childId -> { current, pct }
type ProgressMap = Record<string, Record<string, { current: number; pct: number }>>

export default function MilestonesTab() {
  const { family, members } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'
  const children = useMemo(() => members.filter(isChild), [members])

  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [progress, setProgress] = useState<ProgressMap>({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!familyId) return
    const ms = await getMilestones(familyId)
    setMilestones(ms)
    const map: ProgressMap = {}
    for (const child of children) {
      const rows = await getMilestoneProgress(familyId, child.id)
      for (const r of rows) {
        map[r.id] = map[r.id] ?? {}
        map[r.id][child.id] = { current: r.currentAmount, pct: r.progressPct }
      }
    }
    setProgress(map)
    setLoading(false)
  }, [familyId, children])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-antique" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl">Milestones</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-5 w-5" /> Create Milestone
        </Button>
      </div>
      <p className="-mt-2 text-sm text-text-muted">
        Family savings goals — every child progresses toward each one as they earn.
      </p>

      {milestones.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No milestones yet"
          subtitle="Create a goal for the kids to save toward."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {milestones.map((m) => (
            <Card key={m.id}>
              <div className="flex items-center justify-between">
                <div className="display text-lg">{m.title}</div>
                <div className="text-sm font-semibold text-antique">
                  {formatCurrency(m.target_amount, currency)}
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {children.map((child) => {
                  const p = progress[m.id]?.[child.id] ?? { current: 0, pct: 0 }
                  return (
                    <ChildProgress
                      key={child.id}
                      child={child}
                      current={p.current}
                      target={m.target_amount}
                      pct={p.pct}
                      currency={currency}
                    />
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <MilestoneFormModal
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            if (familyId) await createMilestone(familyId, input)
            setCreating(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

function ChildProgress({
  child,
  current,
  target,
  pct,
  currency,
}: {
  child: FamilyMember
  current: number
  target: number
  pct: number
  currency: string
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-text">{child.display_name}</span>
        <span className="text-text-muted">
          {formatCurrency(current, currency)} / {formatCurrency(target, currency)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-bg">
        <div
          className={cn('h-full rounded-full', pct >= 100 ? 'bg-green' : 'bg-antique')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function MilestoneFormModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (input: MilestoneInput) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('10')
  const [badge, setBadge] = useState('star')
  const [busy, setBusy] = useState(false)
  const inputClass =
    'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({
        title: title.trim(),
        target_amount: parseFloat(target) || 0,
        badge_icon: badge,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Create milestone">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {MILESTONE_TEMPLATES.map((t) => (
            <button
              key={t.title}
              onClick={() => {
                setTitle(t.title)
                setTarget(String(t.target_amount))
                setBadge(t.badge_icon)
              }}
              className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-antique"
            >
              {t.title}
            </button>
          ))}
        </div>
        <label className="text-sm text-text-muted">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <label className="text-sm text-text-muted">Target amount ($)</label>
        <input
          type="number"
          step="0.01"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={inputClass}
        />
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
