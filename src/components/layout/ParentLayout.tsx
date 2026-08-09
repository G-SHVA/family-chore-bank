import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, Settings, LogOut, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { isParent } from '@/features/family/familyService'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export function ParentLayout() {
  const navigate = useNavigate()
  const { activeMember, family, exitToPicker } = useAuth()

  // Parent PIN gate: must have selected a parent member.
  if (!activeMember || !isParent(activeMember)) {
    return <Navigate to="/" replace />
  }

  const items: NavItem[] = [
    { to: '/parent/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/parent/chores', label: 'Manage', icon: ClipboardList },
    { to: '/parent/settings', label: 'Settings', icon: Settings },
  ]

  function handleExit() {
    exitToPicker()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-surface p-4">
        <div className="mb-8 flex items-center gap-3 px-2 pt-2">
          <img src="/logo.png" alt="" className="h-10 w-10" />
          <span className="text-lg font-extrabold text-gold">{family?.name ?? 'Chore Bank'}</span>
        </div>

        <nav className="flex flex-1 flex-col gap-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-touch items-center gap-3 rounded-input px-4 text-lg font-semibold',
                  isActive ? 'bg-gold text-bg' : 'text-text-muted hover:bg-white/5 hover:text-text'
                )
              }
            >
              <item.icon className="h-6 w-6" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="px-2 pb-3 text-sm text-text-muted">
            Signed in as <span className="font-semibold text-text">{activeMember.display_name}</span>
          </div>
          <button
            onClick={handleExit}
            className="flex min-h-touch w-full items-center gap-3 rounded-input px-4 text-text-muted hover:bg-white/5 hover:text-text"
          >
            <LogOut className="h-6 w-6" />
            <span className="font-semibold">Switch user</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
