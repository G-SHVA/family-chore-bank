import { createClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/types/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

// Exported for the Edge Function calls in familyService: PIN verification goes
// over plain fetch so the real HTTP status (401 / 409 / 429) is visible, which
// supabase-js' functions.invoke() buries inside an error object.
export const SUPABASE_URL = supabaseUrl
export const SUPABASE_ANON_KEY = supabaseAnonKey

// Single long-lived client for the kiosk. The device authenticates once as a
// parent/admin; the refresh token keeps the session alive across reloads and
// reboots. Child/parent "identity" within the kiosk is app state, not a new
// Supabase session (see useAuth).
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'fcb-kiosk-session',
  },
})

// Convenience row-type aliases used throughout the app.
export type FamilyMember = Tables<'family_members'>
export type Family = Tables<'families'>
export type Chore = Tables<'chores'>
export type ChoreAssignment = Tables<'chore_assignments'>
export type Expense = Tables<'expenses'>
export type ExpenseApplication = Tables<'expense_applications'>
export type Milestone = Tables<'milestones'>
export type MilestoneProgress = Tables<'milestone_progress'>
export type Reward = Tables<'rewards'>
export type RewardRedemption = Tables<'reward_redemptions'>
