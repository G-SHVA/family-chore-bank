import { useState } from 'react'
import { ClipboardList, CheckCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { updateMember } from '@/features/family/familyService'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

/**
 * One-time "how do you like to do chores?" question, shown to a child whose
 * chore_flow is still NULL. Two big tiles, no toggle: a choice made once reads as
 * "this is how I work", a switch reads as something to poke at. After this only
 * a parent can change it (Settings > Family members > Edit), so a kid cannot lose
 * track of which mode they are in.
 *
 * Not dismissible: the answer is the only way past it, and a null never has to
 * be handled further down the app. If saving fails the child sees a message and
 * can tap again.
 */
export function ChoreStylePrompt() {
  const { activeMember, patchActiveMember } = useAuth()
  const [saving, setSaving] = useState<'plan' | 'checkoff' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!activeMember || activeMember.chore_flow) return null
  const memberId = activeMember.id

  async function choose(flow: 'plan' | 'checkoff') {
    setSaving(flow)
    setError(null)
    try {
      await updateMember(memberId, { chore_flow: flow })
      patchActiveMember({ chore_flow: flow })
    } catch {
      setError('That did not save. Please tap again.')
      setSaving(null)
    }
  }

  const tile =
    'flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-card border border-line bg-card p-5 text-center transition-colors hover:border-antique/50 hover:bg-wash disabled:opacity-60'

  return (
    <Modal open onClose={() => {}} hideClose title="How do you like to do chores?" size="wide">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          Pick the one that sounds like you. To change it later, ask a parent.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" disabled={saving !== null} onClick={() => void choose('plan')} className={cn(tile)}>
            <ClipboardList className="h-10 w-10 text-antique" />
            <span className="display text-xl text-text">Make my to-do list first</span>
          </button>
          <button type="button" disabled={saving !== null} onClick={() => void choose('checkoff')} className={cn(tile)}>
            <CheckCheck className="h-10 w-10 text-antique" />
            <span className="display text-xl text-text">Do them, then check them off</span>
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
