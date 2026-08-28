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
  /** member id -> epoch ms until which that tile is locked after 5 bad PINs. */
  const [lockedUntil, setLockedUntil] = useState<Record<string, number>>({})
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000 * 30)
    return () => clearInterval(t)
  }, [])

  // Only run a 1s timer while something is actually locked, so the idle kiosk
  // isn't re-rendering every second.
  const hasLock = Object.values(lockedUntil).some((t) => t > nowMs)
  useEffect(() => {
    if (!hasLock) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [hasLock])

  function lockRemaining(memberId: string): number {
    const until = lockedUntil[memberId]
    if (!until) return 0
    return Math.max(0, Math.ceil((until - nowMs) / 1000))
  }

  function handleLockout(memberId: string, retryAfterSeconds: number) {
    setNowMs(Date.now())
    setLockedUntil((prev) => ({ ...prev, [memberId]: Date.now() + retryAfterSeconds * 1000 }))
    // Close the pad after a beat so the message is readable, then the tile
    // carries the countdown.
    setTimeout(() => setSelected(null), 1200)
  }

  function goToDashboard(member: FamilyMember) {
    selectMember(member)
    if (isParent(member)) navigate('/parent/dashboard')
    else navigate(`/child/${member.id}`)
  }

  if (loading) {
    return (
      <CenterScreen>
        <Loader2 className="h-12 w-12 animate-spin text-antique" />
        <p className="text-text-muted">Starting kiosk…</p>
      </CenterScreen>
    )
  }

  if (error) {
    return (
      <CenterScreen>
        <AlertTriangle className="h-12 w-12 text-danger" />
        <h1 className="text-3xl">Kiosk couldn’t start</h1>
        <p className="max-w-md text-center text-text-muted">{error}</p>
      </CenterScreen>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg px-6 py-8">
      {/* Header */}
      <header className="spine -mx-6 flex items-center justify-between px-6 pb-5">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-8 w-8" />
          <span className="display text-2xl text-antique">
            {family?.name ?? 'Family Chore Bank'}
          </span>
        </div>
        <div className="text-right">
          <div className="display text-3xl tabular-nums text-text">
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="label-caps text-[11px] text-text-muted">
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
        <h1 className="text-4xl text-text">Who’s using the tablet?</h1>

        {members.length === 0 ? (
          <p className="text-text-muted">No family members yet. Add them in parent settings.</p>
        ) : (
          <div className="grid w-full max-w-3xl grid-cols-2 gap-6">
            {members.map((member) => (
              <MemberTile
                key={member.id}
                member={member}
                lockedFor={lockRemaining(member.id)}
                onSelect={() => setSelected(member)}
              />
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
          onLockout={(retryAfter) => handleLockout(selected.id, retryAfter)}
          onCreate={async (pin) => {
            await savePin(selected.id, pin)
            goToDashboard(selected)
          }}
        />
      )}
    </div>
  )
}

function MemberTile({
  member,
  lockedFor,
  onSelect,
}: {
  member: FamilyMember
  /** Seconds remaining on a PIN lockout; 0 when unlocked. */
  lockedFor: number
  onSelect: () => void
}) {
  const parent = isParent(member)
  const locked = lockedFor > 0
  return (
    <button
      onClick={onSelect}
      disabled={locked}
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-[4px] bg-card p-6',
        'border-2 transition-[border-color,transform] duration-150',
        locked
          ? 'cursor-not-allowed border-danger/40 opacity-60'
          : 'border-antique/40 hover:border-antique active:scale-[0.98] focus-visible:outline-none focus-visible:border-antique'
      )}
    >
      {member.avatar_url ? (
        <img
          src={member.avatar_url}
          alt={member.display_name ?? ''}
          className="h-24 w-24 rounded-full border border-antique/40 object-cover"
        />
      ) : (
        <div className="display flex h-24 w-24 items-center justify-center rounded-full border border-antique/40 bg-wash text-4xl text-antique">
          {initials(member.display_name)}
        </div>
      )}
      <div className="text-center">
        <div className="display text-3xl text-text">{member.display_name}</div>
        {locked ? (
          <div className="label-caps text-[11px] text-danger">
            Locked — {lockedFor}s
          </div>
        ) : (
          <div className="label-caps text-[11px] text-text-muted">
            {parent ? 'Parent' : 'Child'}
          </div>
        )}
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
