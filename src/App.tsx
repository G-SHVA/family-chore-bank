import { lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import KioskSelect from '@/pages/KioskSelect'
import Login from '@/pages/Login'
import { ChildLayout } from '@/components/layout/ChildLayout'
import { ParentLayout } from '@/components/layout/ParentLayout'

// ROUTE-LEVEL CODE SPLITTING. Everything the kiosk needs before a member is
// picked stays in the entry chunk: KioskSelect, Login, PinPad (via Modal), the
// two layouts and useAuth. Every page BEHIND the PIN is a lazy chunk, fetched
// on first navigation and then held by the browser cache (one-year immutable
// on /assets/*) and by the PWA precache, so on the wall tablet a chunk is
// fetched once per deploy, not once per visit.
//
// KioskSelect and Login are deliberately NOT lazy: they are the first screen
// and the auth gate, and a Suspense fallback there would be a blank kiosk.
//
// Recharts is reached only from Achievements and AnalyticsTab (under
// FamilyWeek), so it lands in its own shared chunk and never loads for a
// parent who only approves chores. Framer Motion CANNOT leave the entry
// chunk: PinPad renders inside Modal, which animates with it, so it is a
// first-screen dependency — it is split into a stable vendor chunk instead
// (see manualChunks in vite.config.ts).
const ChildDashboard = lazy(() => import('@/pages/child/Dashboard'))
const ChildChores = lazy(() => import('@/pages/child/Chores'))
const ChildClaim = lazy(() => import('@/pages/child/Claim'))
const ChildBank = lazy(() => import('@/pages/child/Bank'))
const ChildAchievements = lazy(() => import('@/pages/child/Achievements'))
const ParentDashboard = lazy(() => import('@/pages/parent/Dashboard'))
const Management = lazy(() => import('@/pages/parent/Management'))
const FamilyWeek = lazy(() => import('@/pages/parent/FamilyWeek'))
const Settings = lazy(() => import('@/pages/parent/Settings'))

/**
 * Suspense boundary PER ROUTE ELEMENT, not around <Routes>. A boundary above
 * the layouts would unmount the sidebar / bottom nav while a page chunk loads,
 * so the chrome would flash on every first visit to a route. Wrapping only the
 * outlet content keeps the layout mounted and swaps the pane beneath it.
 *
 * The fallback is deliberately EMPTY — no spinner. It fills the pane with the
 * page background so nothing shifts when the chunk arrives, and a chunk that
 * is already cached resolves in a frame, where a spinner would only flicker.
 * `min-h-full` rather than `min-h-screen`: the layouts own the viewport.
 */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-full bg-bg" aria-hidden="true" />}>{children}</Suspense>
}

function AppGate() {
  const { loading, needsLogin } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="h-12 w-12 animate-spin text-antique" />
      </div>
    )
  }
  if (needsLogin) return <Login />
  return (
    <Routes>
      <Route path="/" element={<KioskSelect />} />

      <Route path="/parent" element={<ParentLayout />}>
        <Route path="dashboard" element={<Lazy><ParentDashboard /></Lazy>} />
        <Route path="chores" element={<Lazy><Management /></Lazy>} />
        <Route path="week" element={<Lazy><FamilyWeek /></Lazy>} />
        <Route path="settings" element={<Lazy><Settings /></Lazy>} />
      </Route>

      <Route path="/child/:memberId" element={<ChildLayout />}>
        <Route index element={<Lazy><ChildDashboard /></Lazy>} />
        <Route path="chores" element={<Lazy><ChildChores /></Lazy>} />
        <Route path="claim" element={<Lazy><ChildClaim /></Lazy>} />
        <Route path="bank" element={<Lazy><ChildBank /></Lazy>} />
        <Route path="achievements" element={<Lazy><ChildAchievements /></Lazy>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppGate />
    </AuthProvider>
  )
}
