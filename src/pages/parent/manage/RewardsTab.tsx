import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Gift, Clock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getRewards,
  createReward,
  toggleRewardAvailability,
  getPendingRedemptions,
  approveRedemption,
  fulfillRedemption,
  rejectRedemption,
  type RewardInput,
  type RedemptionRequest,
} from '@/features/rewards/rewardService'
import type { Reward } from '@/lib/supabase'
import { REWARD_TEMPLATES } from '@/lib/constants'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/shared/EmptyState'
import { cn, formatCurrency, initials, timeAgo } from '@/lib/utils'

export default function RewardsTab() {
  const { family, activeMember, refresh } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'

  const [rewards, setRewards] = useState<Reward[]>([])
  const [redemptions, setRedemptions] = useState<RedemptionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId) return
    const [rw, rd] = await Promise.all([getRewards(familyId), getPendingRedemptions()])
    setRewards(rw)
    setRedemptions(rd)
    setLoading(false)
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleToggle(reward: Reward) {
    setBusy(reward.id)
    try {
      await toggleRewardAvailability(reward.id, !reward.is_available)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function handleRedemption(
    id: string,
    action: 'approve' | 'fulfill' | 'reject'
  ) {
    setBusy(id)
    try {
      if (action === 'approve') await approveRedemption(id, activeMember?.id ?? '')
      else if (action === 'fulfill') await fulfillRedemption(id)
      else await rejectRedemption(id)
      await Promise.all([load(), refresh()])
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

  return (
    <div className="flex flex-col gap-6">
      {/* Pending redemption requests (view only for now) */}
      <section>
        <h2 className="mb-3 text-xl font-bold">
          Redemption requests{' '}
          {redemptions.length > 0 && (
            <span className="ml-1 rounded-full bg-gold px-2 py-0.5 text-sm font-bold text-bg">
              {redemptions.length}
            </span>
          )}
        </h2>
        {redemptions.length === 0 ? (
          <Card className="py-8 text-center text-text-muted">No redemption requests.</Card>
        ) : (
          <div className="flex flex-col gap-3">
            {redemptions.map((r) => (
              <Card key={r.id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/20 font-bold text-gold">
                    {initials(r.member?.display_name)}
                  </div>
                  <div>
                    <div className="font-semibold">{r.reward?.title}</div>
                    <div className="text-sm text-text-muted">
                      {r.member?.display_name} ·{' '}
                      <span className="font-semibold text-gold">
                        {formatCurrency(r.reward?.cost ?? 0, currency)}
                      </span>{' '}
                      · <span className="capitalize">{r.status}</span>
                      <span className="ml-2 inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {timeAgo(r.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {r.status === 'pending' && (
                    <>
                      <Button size="md" onClick={() => handleRedemption(r.id, 'approve')} disabled={busy === r.id}>
                        Approve
                      </Button>
                      <Button
                        size="md"
                        variant="danger"
                        onClick={() => handleRedemption(r.id, 'reject')}
                        disabled={busy === r.id}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {r.status === 'approved' && (
                    <Button size="md" onClick={() => handleRedemption(r.id, 'fulfill')} disabled={busy === r.id}>
                      Mark fulfilled
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Rewards catalog */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">Rewards</h2>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" /> Create Reward
          </Button>
        </div>
        {rewards.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="No rewards yet"
            subtitle="Add rewards the kids can save up to redeem."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rewards.map((r) => (
              <Card key={r.id} className={cn(!r.is_available && 'opacity-60')}>
                <div className="flex items-center gap-2 font-bold">
                  <Gift className="h-5 w-5 text-gold" /> {r.title}
                </div>
                <div className="mt-1 text-2xl font-extrabold text-gold">
                  {formatCurrency(r.cost, currency)}
                </div>
                <button
                  onClick={() => handleToggle(r)}
                  disabled={busy === r.id}
                  className={cn(
                    'mt-3 min-h-touch w-full rounded-input text-sm font-semibold',
                    r.is_available
                      ? 'bg-green/15 text-green'
                      : 'bg-white/5 text-text-muted'
                  )}
                >
                  {r.is_available ? 'Available' : 'Hidden'}
                </button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {creating && (
        <RewardFormModal
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            if (familyId) await createReward(familyId, input)
            setCreating(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

function RewardFormModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (input: RewardInput) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [cost, setCost] = useState('1')
  const [busy, setBusy] = useState(false)
  const inputClass =
    'w-full rounded-input border border-white/10 bg-card p-3 text-text focus:border-gold focus:outline-none'

  async function submit() {
    if (!title.trim()) return
    setBusy(true)
    try {
      await onSave({ title: title.trim(), cost: parseFloat(cost) || 0 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Create reward">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {REWARD_TEMPLATES.map((t) => (
            <button
              key={t.title}
              onClick={() => {
                setTitle(t.title)
                setCost(String(t.cost))
              }}
              className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-gold"
            >
              {t.title}
            </button>
          ))}
        </div>
        <label className="text-sm text-text-muted">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        <label className="text-sm text-text-muted">Cost ($)</label>
        <input
          type="number"
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
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
