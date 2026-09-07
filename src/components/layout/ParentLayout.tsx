import { NavLink, Outlet, Navigate, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Settings,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
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

  /**
   * TWO TIERS, NOT FOUR PEERS.
   *
   * Four flat nav items all read as "you should visit this", which is most of
   * why the parent interface implied a much larger daily commitment than the
   * two-to-three minutes the book budgets. Home is where the app opens and
   * where the work is; everything else is occasional and is styled to say so.
   *
   * Home stays a NavLink rather than a static label because it still has to
   * work as the way BACK from the other three — it is the active location when
   * you are on it, and a destination only when you are not.
   */
  const home: NavItem = {
    to: '/parent/dashboard',
    label: 'Home',
    icon: LayoutDashboard,
    end: true,
  }
  const occasional: NavItem[] = [
    { to: '/parent/week', label: 'Family Week', icon: CalendarDays },
    // Route stays /parent/chores. "Setup" is the LABEL only — renaming the
    // path would break nothing visible but buys nothing either, and every
    // link in the app already points here.
    { to: '/parent/chores', label: 'Setup', icon: ClipboardList },
    { to: '/parent/settings', label: 'Settings', icon: Settings },
  ]

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'label-caps flex min-h-touch items-center justify-center gap-3 rounded-input border-l-2 text-xs sm:justify-start sm:px-4',
      isActive
        ? 'border-antique bg-wash text-antique'
        : 'border-transparent text-text-muted hover:bg-wash hover:text-text'
    )

  function handleExit() {
    exitToPicker()
    navigate('/')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar */}
      <aside className="flex w-16 shrink-0 flex-col border-r border-line bg-deep sm:w-64">
        <div className="spine flex items-center justify-center gap-3 px-2 py-5 sm:justify-start sm:px-5">
          <img src="/logo.png" alt="" className="h-10 w-10 shrink-0" />
          <span className="display hidden text-xl text-antique sm:inline">
            {family?.name ?? 'Chore Bank'}
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-2 sm:p-4">
          <NavLink to={home.to} end={home.end} title={home.label} className={linkClass}>
            <home.icon className="h-6 w-6 shrink-0" />
            <span className="hidden sm:inline">{home.label}</span>
          </NavLink>

          {/* The tier boundary. At 64px the label has nowhere to go, so the
              rule carries the whole message on a phone — which is enough:
              "these are not the same kind of thing as the one above". */}
          <div className="my-3 h-px shrink-0 bg-antique/20" aria-hidden="true" />
          <div className="label-caps hidden px-4 pb-2 text-[10px] tracking-[0.18em] text-text-muted sm:block">
            Occasional
          </div>

          {occasional.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={linkClass}
            >
              <item.icon className="h-6 w-6 shrink-0" />
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 border-t border-line p-2 sm:p-4">
          <div className="label-caps hidden px-2 pb-3 text-[10px] text-text-muted sm:block">
            Signed in as <span className="text-antique">{activeMember.display_name}</span>
          </div>
          <button
            onClick={handleExit}
            title="Switch user"
            className="label-caps flex min-h-touch w-full items-center justify-center gap-3 rounded-input text-xs text-text-muted hover:bg-wash hover:text-text sm:justify-start sm:px-4"
          >
            <LogOut className="h-6 w-6 shrink-0" />
            <span className="hidden sm:inline">Switch user</span>
          </button>
        </div>
      </aside>

      <main className="scroll-skin flex-1 overflow-y-auto p-4 sm:p-8">
        <Outlet />
      </main>
    </div>
  )
}
