import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Pencil, KeyRound, Info } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getAllMembers,
  addMember,
  updateMember,
  setMemberActive,
  isParent,
  type MemberInput,
} from '@/features/family/familyService'
import type { FamilyMember } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn, formatCurrency, initials } from '@/lib/utils'

export default function Settings() {
  const { family, session, hasPin, clearPin, refresh } = useAuth()
  const familyId = family?.id
  const currency = family?.currency ?? 'USD'
  const operatorUserId = session?.user.id

  const [members, setMembers] = useState<FamilyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<FamilyMember | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!familyId) return
    const all = await getAllMembers(familyId)
    // Hide the kiosk operator account (the signed-in service account).
    setMembers(all.filter((m) => m.user_id !== operatorUserId))
    setLoading(false)
  }, [familyId, operatorUserId])

  useEffect(() => {
    void load()
  }, [load])

  async function handleToggleActive(m: FamilyMember) {
    setBusy(m.id)
    try {
      await setMemberActive(m.id, !m.is_active)
      await Promise.all([load(), refresh()])
    } finally {
      setBusy(null)
    }
  }

  async function handleResetPin(m: FamilyMember) {
    setBusy(m.id)
    try {
      await clearPin(m.id)
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="spine flex items-center justify-between pb-4">
        <h1 className="text-4xl">Settings</h1>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-5 w-5" /> Add Member
        </Button>
      </div>

      <section>
        <h2 className="mb-3 text-2xl">Family members</h2>
        <div className="flex flex-col gap-3">
          {members.map((m) => (
            <Card key={m.id} className={cn(!m.is_active && 'opacity-60')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="display flex h-11 w-11 items-center justify-center rounded-full border border-antique/40 bg-wash text-antique">
                    {initials(m.display_name)}
                  </div>
                  <div>
                    <div className="display text-lg text-text">{m.display_name}</div>
                    <div className="label-caps text-[10px] text-text-muted">
                      {isParent(m) ? 'Parent' : 'Child'} · {formatCurrency(m.balance ?? 0, currency)}
                      {' · '}
                      {hasPin(m.id) ? 'PIN set' : 'No PIN'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleResetPin(m)}
                    disabled={busy === m.id || !hasPin(m.id)}
                    className="label-caps flex min-h-touch items-center gap-1 rounded-input px-3 text-[11px] text-text-muted hover:bg-wash hover:text-antique disabled:opacity-40"
                  >
                    <KeyRound className="h-4 w-4" /> Reset PIN
                  </button>
                  <button
                    onClick={() => setEditing(m)}
                    className="flex h-11 w-11 items-center justify-center rounded-input text-text-muted hover:bg-wash hover:text-antique"
                    aria-label="Edit"
                  >
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => handleToggleActive(m)}
                    disabled={busy === m.id}
                    className={cn(
                      'label-caps min-h-touch rounded-input px-3 text-[11px]',
                      m.is_active ? 'text-danger hover:bg-danger/10' : 'text-green hover:bg-green/10'
                    )}
                  >
                    {m.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {(adding || editing) && (
        <MemberFormModal
          member={editing}
          onClose={() => {
            setAdding(false)
            setEditing(null)
          }}
          onSave={async (input) => {
            if (editing) await updateMember(editing.id, input)
            else if (familyId) await addMember(familyId, input)
            setAdding(false)
            setEditing(null)
            await Promise.all([load(), refresh()])
          }}
        />
      )}
    </div>
  )
}

function MemberFormModal({
  member,
  onClose,
  onSave,
}: {
  member: FamilyMember | null
  onClose: () => void
  onSave: (input: MemberInput) => Promise<void>
}) {
  const [name, setName] = useState(member?.display_name ?? '')
  const [role, setRole] = useState<'child' | 'parent'>(
    member && isParent(member) ? 'parent' : 'child'
  )
  const [avatar, setAvatar] = useState(member?.avatar_url ?? '')
  const [busy, setBusy] = useState(false)
  const inputClass =
    'w-full rounded-input border border-line bg-deep p-3 text-text focus:border-antique focus:outline-none'

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSave({
        display_name: name.trim(),
        role: [role],
        avatar_url: avatar.trim() || null,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={member ? 'Edit member' : 'Add member'}>
      <div className="flex flex-col gap-3">
        {!member && (
          <div className="flex gap-2 rounded-input border border-line bg-wash p-3 text-sm text-text-muted">
            <Info className="h-5 w-5 shrink-0 text-antique" />
            <span>
              To let this person <strong>sign in on their own device</strong>, first create their
              Supabase Auth user in the dashboard, then add them here. Children who only use the
              wall tablet don’t need an auth account.
            </span>
          </div>
        )}
        <label className="label-caps text-[11px] text-text-muted">Display name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <label className="label-caps text-[11px] text-text-muted">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'child' | 'parent')}
          className={inputClass}
        >
          <option value="child">Child</option>
          <option value="parent">Parent</option>
        </select>
        <label className="label-caps text-[11px] text-text-muted">Avatar image URL (optional)</label>
        <input
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="https://…"
          className={inputClass}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
