import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import KioskSelect from '@/pages/KioskSelect'
import Login from '@/pages/Login'
import { ChildLayout } from '@/components/layout/ChildLayout'
import ChildDashboard from '@/pages/child/Dashboard'
import ChildChores from '@/pages/child/Chores'
import ChildBank from '@/pages/child/Bank'
import ChildAchievements from '@/pages/child/Achievements'
import { ParentLayout } from '@/components/layout/ParentLayout'
import ParentDashboard from '@/pages/parent/Dashboard'
import Management from '@/pages/parent/Management'
import Settings from '@/pages/parent/Settings'

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
        <Route path="dashboard" element={<ParentDashboard />} />
        <Route path="chores" element={<Management />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="/child/:memberId" element={<ChildLayout />}>
        <Route index element={<ChildDashboard />} />
        <Route path="chores" element={<ChildChores />} />
        <Route path="bank" element={<ChildBank />} />
        <Route path="achievements" element={<ChildAchievements />} />
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
