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
import { detectBrowserTimeZone, setActiveTimeZone } from '@/lib/time'
import {
  fetchKioskContext,
  fetchPinStatus,
  updateFamilyTimezone,
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
  /**
   * The family's IANA timezone — the single source of truth for every date
   * boundary in the app. Falls back to the browser's zone until the family
   * record has loaded, and if the stored value is missing.
   *
   * Read it in components via `useFamilyTimezone()`. Service files, which
   * cannot use hooks, read the same value through `lib/time`'s module-level
   * active zone, which is kept in step with this one below.
   */
  timezone: string
  /** Persists a new family timezone and re-points every date calculation. */
  saveTimezone: (tz: string) => Promise<void>
  /** Selectable family members (excludes the kiosk operator account). */
  members: FamilyMember[]
  /**
   * The shared kiosk operator's family_members row id, or null.
   *
   * Exposed so a screen can tell "a real parent did this" from "the shared
   * operator account did this". Compared by ID rather than by display name on
   * purpose: the operator row is renameable in Settings like any other member,
   * so matching the literal string 'Kiosk' would silently stop working.
   */
  operatorMemberId: string | null
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
    // BEFORE any state that renders a screen: service files read the zone from
    // lib/time at call time, and the first data load fires as soon as a screen
    // mounts. Setting it here means no query is ever bounded by the wrong day.
    setActiveTimeZone(ctx.family.timezone)
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

  // `family.timezone` is the stored value; the browser's zone stands in until
  // it loads, so a screen rendered mid-boot uses the same rule lib/time does.
  const timezone = family?.timezone || detectBrowserTimeZone()

  const saveTimezone = useCallback(
    async (tz: string) => {
      if (!family) throw new Error('Family not loaded.')
      await updateFamilyTimezone(family.id, tz)
      // Both halves, in this order: the module zone is what services read, and
      // the state update is what re-renders the screens that then re-query.
      setActiveTimeZone(tz)
      setFamily((prev) => (prev ? { ...prev, timezone: tz } : prev))
    },
    [family]
  )

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
    timezone,
    saveTimezone,
    members,
    operatorMemberId,
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

/**
 * The family's timezone, for components that only need the zone.
 *
 * The single source of truth for date boundaries in the UI layer. Nothing in
 * this app should name a zone literally — a family in California and a family
 * in Texas must both be right with no code change.
 */
export function useFamilyTimezone(): string {
  return useAuth().timezone
}
