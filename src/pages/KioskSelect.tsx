import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { isParent } from '@/features/family/familyService'
import type { FamilyMember } from '@/lib/supabase'
import { PinPad } from '@/components/ui/PinPad'
import { cn, initials } from '@/lib/utils'

export default function KioskSelect() {
  const navigate = useNavigate()
  const { loading, error, family, members, hasPin, verifyPin, savePin, selectMember } = useAuth()
  const [selected, setSelected] = useState<FamilyMember | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30)
    return () => clearInterval(t)
  }, [])

  function goToDashboard(member: FamilyMember) {
    selectMember(member)
    if (isParent(member)) navigate('/parent/dashboard')
    else navigate(`/child/${member.id}`)
  }

  if (loading) {
    return (
      <CenterScreen>
        <Loader2 className="h-12 w-12 animate-spin text-gold" />
        <p className="text-text-muted">Starting kiosk…</p>
      </CenterScreen>
    )
  }

  if (error) {
    return (
      <CenterScreen>
        <AlertTriangle className="h-12 w-12 text-danger" />
        <h1 className="text-2xl font-bold">Kiosk couldn’t start</h1>
        <p className="max-w-md text-center text-text-muted">{error}</p>
      </CenterScreen>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg px-6 py-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-8 w-8" />
          <span className="text-xl font-extrabold tracking-tight text-gold">
            {family?.name ?? 'Family Chore Bank'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="text-sm text-text-muted">
            {now.toLocaleDateString([], {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </div>
      </header>

      {/* Picker */}
      <main className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
        <img src="/logo.png" alt="Family Chore Bank" className="h-[120px] w-[120px]" />
        <h1 className="text-3xl font-bold text-text">Who’s using the tablet?</h1>

        {members.length === 0 ? (
          <p className="text-text-muted">No family members yet. Add them in parent settings.</p>
        ) : (
          <div className="grid w-full max-w-3xl grid-cols-2 gap-6">
            {members.map((member) => (
              <MemberTile key={member.id} member={member} onSelect={() => setSelected(member)} />
            ))}
          </div>
        )}
      </main>

      {/* PIN entry / setup */}
      {selected && (
        <PinPad
          open={!!selected}
          onClose={() => setSelected(null)}
          memberName={selected.display_name ?? 'Member'}
          avatarUrl={selected.avatar_url}
          mode={hasPin(selected.id) ? 'verify' : 'create'}
          verify={(pin) => verifyPin(selected.id, pin)}
          onSuccess={() => goToDashboard(selected)}
          onCreate={async (pin) => {
            await savePin(selected.id, pin)
            goToDashboard(selected)
          }}
        />
      )}
    </div>
  )
}

function MemberTile({ member, onSelect }: { member: FamilyMember; onSelect: () => void }) {
  const parent = isParent(member)
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-card bg-card p-6',
        'border-2 border-transparent transition-[border-color,transform] duration-150',
        'hover:border-gold/70 active:scale-[0.98] focus-visible:outline-none focus-visible:border-gold'
      )}
    >
      {member.avatar_url ? (
        <img
          src={member.avatar_url}
          alt={member.display_name ?? ''}
          className="h-24 w-24 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gold/20 text-3xl font-bold text-gold">
          {initials(member.display_name)}
        </div>
      )}
      <div className="text-center">
        <div className="text-2xl font-bold text-text">{member.display_name}</div>
        <div className="text-sm uppercase tracking-wide text-text-muted">
          {parent ? 'Parent' : 'Child'}
        </div>
      </div>
    </button>
  )
}

function CenterScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-8">
      {children}
    </div>
  )
}
