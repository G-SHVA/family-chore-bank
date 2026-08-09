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
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="relative flex items-center justify-between px-6 py-4">
        <div>
          <div className="text-sm text-text-muted">{greeting()}</div>
          <div className="text-2xl font-bold text-text">{activeMember.display_name}</div>
        </div>
        <img
          src="/logo.png"
          alt="Family Chore Bank"
          className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2"
        />
        <button
          onClick={handleExit}
          className="flex min-h-touch items-center gap-2 rounded-input bg-card px-5 text-text-muted hover:text-text"
        >
          <LogOut className="h-5 w-5" />
          <span className="font-semibold">Switch user</span>
        </button>
      </header>

      <main className="flex-1 px-6 pb-28">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-surface/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch flex-col items-center justify-center gap-1 py-3 text-xs font-semibold',
                  isActive ? 'text-gold' : 'text-text-muted'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('h-7 w-7', isActive && 'text-gold')} />
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
