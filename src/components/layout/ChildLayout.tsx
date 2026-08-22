import { NavLink, Outlet, useParams, Navigate, useNavigate } from 'react-router-dom'
import { Home, ListChecks, Landmark, Trophy, LogOut, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export function ChildLayout() {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const { activeMember, exitToPicker } = useAuth()

  // PIN gate: you can only be here if you selected this member (via PIN).
  if (!activeMember || activeMember.id !== memberId) {
    return <Navigate to="/" replace />
  }

  const base = `/child/${memberId}`
  const items: NavItem[] = [
    { to: base, label: 'Home', icon: Home, end: true },
    { to: `${base}/chores`, label: 'Chores', icon: ListChecks },
    { to: `${base}/bank`, label: 'My Bank', icon: Landmark },
    { to: `${base}/achievements`, label: 'Achievements', icon: Trophy },
  ]

  function handleExit() {
    exitToPicker()
    navigate('/')
  }

  return (
    <div data-surface="child" className="flex min-h-screen flex-col bg-bg">
      <header className="spine relative flex items-center justify-between px-6 py-4">
        <div>
          <div className="label-caps text-[11px] text-text-muted">{greeting()}</div>
          <div className="display text-3xl text-text">{activeMember.display_name}</div>
        </div>
        <img
          src="/logo.png"
          alt="Family Chore Bank"
          className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2"
        />
        <button
          onClick={handleExit}
          className="label-caps flex min-h-touch items-center gap-2 rounded-input border border-line bg-deep px-5 text-xs text-text-muted hover:border-antique/40 hover:text-antique"
        >
          <LogOut className="h-5 w-5" />
          <span>Switch user</span>
        </button>
      </header>

      <main className="flex-1 px-6 pb-28">
        <Outlet />
      </main>

      <nav className="spine-top fixed inset-x-0 bottom-0 bg-deep/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'label-caps flex min-h-touch flex-col items-center justify-center gap-1 py-3 text-[10px]',
                  isActive ? 'text-antique' : 'text-text-muted'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('h-7 w-7', isActive && 'text-antique')} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
