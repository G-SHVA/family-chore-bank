import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { FamilyMember } from '@/lib/supabase'
import {
  fetchKioskContext,
  fetchPinStatus,
  verifyMemberPin,
  createMemberPin,
  removeMemberPin,
  type KioskFamily,
  type PinStatus,
  type PinVerifyResult,
} from '@/features/family/familyService'

interface AuthContextValue {
  loading: boolean
  error: string | null
  /** True when there's no session and no auto-login — show the login screen. */
  needsLogin: boolean
  session: Session | null
  family: KioskFamily | null
  /** Selectable family members (excludes the kiosk operator account). */
  members: FamilyMember[]
  /** The member currently using the kiosk (null = at the picker). */
  activeMember: FamilyMember | null
  selectMember: (member: FamilyMember) => void
  exitToPicker: () => void
  hasPin: (memberId: string) => boolean
  /** Server-side verification. The browser never sees a PIN value or hash. */
  verifyPin: (memberId: string, pin: string) => Promise<PinVerifyResult>
  savePin: (memberId: string, pin: string) => Promise<void>
  clearPin: (memberId: string) => Promise<void>
  /** Manual sign-in from the login screen. Returns an error message or null. */
  signIn: (email: string, password: string) => Promise<string | null>
  /** Send a password-reset email. Returns an error message or null. */
  resetPassword: (email: string) => Promise<string | null>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [family, setFamily] = useState<KioskFamily | null>(null)
  const [allMembers, setAllMembers] = useState<FamilyMember[]>([])
  const [operatorMemberId, setOperatorMemberId] = useState<string | null>(null)
  const [pinStatus, setPinStatus] = useState<PinStatus>({})
  const [activeMember, setActiveMember] = useState<FamilyMember | null>(null)
  const didAutoLogin = useRef(false)

  const loadContext = useCallback(async (userId: string) => {
    const ctx = await fetchKioskContext(userId)
    setFamily(ctx.family)
    setAllMembers(ctx.members)
    setOperatorMemberId(ctx.currentUserMemberId)
    setPinStatus(ctx.pinStatus)
  }, [])

  // Boot: get/establish session, then load family context.
  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        setLoading(true)
        setError(null)

        let {
          data: { session: current },
        } = await supabase.auth.getSession()

        // Auto-login with the dedicated kiosk account if no session exists.
        if (!current && !didAutoLogin.current) {
          didAutoLogin.current = true
          const email = import.meta.env.VITE_KIOSK_LOGIN_EMAIL
          const password = import.meta.env.VITE_KIOSK_LOGIN_PASSWORD
          if (email && password) {
            const { data, error: signInErr } = await supabase.auth.signInWithPassword({
              email,
              password,
            })
            if (signInErr) throw signInErr
            current = data.session
          }
        }

        if (cancelled) return

        if (!current) {
          // No session and no auto-login creds → show the login screen.
          setNeedsLogin(true)
          setLoading(false)
          return
        }

        setSession(current)
        await loadContext(current.user.id)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to start kiosk.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void boot()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [loadContext])

  const members = useMemo(
    () => allMembers.filter((m) => m.id !== operatorMemberId),
    [allMembers, operatorMemberId]
  )

  const selectMember = useCallback((member: FamilyMember) => setActiveMember(member), [])
  const exitToPicker = useCallback(() => setActiveMember(null), [])

  const hasPin = useCallback((memberId: string) => Boolean(pinStatus[memberId]), [pinStatus])

  // No comparison happens here any more — the PIN goes to the verify-pin Edge
  // Function and only a verdict comes back.
  const verifyPin = useCallback(
    (memberId: string, pin: string) => verifyMemberPin(memberId, pin),
    []
  )

  const savePin = useCallback(async (memberId: string, pin: string) => {
    await createMemberPin(memberId, pin)
    setPinStatus((prev) => ({ ...prev, [memberId]: true }))
  }, [])

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { data, error: signErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signErr) return signErr.message
      if (!data.session) return 'Sign-in failed. Please try again.'
      setSession(data.session)
      try {
        await loadContext(data.session.user.id)
      } catch (e) {
        return e instanceof Error ? e.message : 'Failed to load family.'
      }
      setNeedsLogin(false)
      return null
    },
    [loadContext]
  )

  const clearPin = useCallback(async (memberId: string) => {
    await removeMemberPin(memberId)
    setPinStatus((prev) => ({ ...prev, [memberId]: false }))
  }, [])

  const resetPassword = useCallback(async (email: string): Promise<string | null> => {
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    return resetErr?.message ?? null
  }, [])

  const refresh = useCallback(async () => {
    if (session?.user) await loadContext(session.user.id)
    else setPinStatus(await fetchPinStatus())
  }, [session, loadContext])

  const value: AuthContextValue = {
    loading,
    error,
    needsLogin,
    session,
    family,
    members,
    activeMember,
    selectMember,
    exitToPicker,
    hasPin,
    verifyPin,
    savePin,
    clearPin,
    signIn,
    resetPassword,
    refresh,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
