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
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-deep">
        <div className="spine flex items-center gap-3 px-5 py-5">
          <img src="/logo.png" alt="" className="h-10 w-10" />
          <span className="display text-xl text-antique">{family?.name ?? 'Chore Bank'}</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'label-caps flex min-h-touch items-center gap-3 rounded-input border-l-2 px-4 text-xs',
                  isActive
                    ? 'border-antique bg-wash text-antique'
                    : 'border-transparent text-text-muted hover:bg-wash hover:text-text'
                )
              }
            >
              <item.icon className="h-6 w-6" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 border-t border-line p-4">
          <div className="label-caps px-2 pb-3 text-[10px] text-text-muted">
            Signed in as <span className="text-antique">{activeMember.display_name}</span>
          </div>
          <button
            onClick={handleExit}
            className="label-caps flex min-h-touch w-full items-center gap-3 rounded-input px-4 text-xs text-text-muted hover:bg-wash hover:text-text"
          >
            <LogOut className="h-6 w-6" />
            <span>Switch user</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
