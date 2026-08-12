# Family Chore Bank — Claude Code Rules

## Project
React 18 + TypeScript + Vite + Supabase + Tailwind CSS.
Tablet kiosk app. Dark theme only. No SSR. No Next.js.

## This family's accounts
Real members in Supabase `family_members` (family id eaa7a6df-...):
- Gary Hughey: role [admin, parent]
- Eve Hughey: role [parent]
- "POCO": role [child]
- "Cuddles": role [child]
Members are managed in-app via parent Settings.

## Kiosk session model
The kiosk runs one shared Supabase session via a DEDICATED account
(info@shvaleadership.com, family_members "Kiosk", role [parent],
is_active true) — NOT a personal account. Credentials live in
.env.local (VITE_KIOSK_LOGIN_*).
Child/parent identity is app state (useAuth.activeMember), not a separate
Supabase session. The operator (kiosk) member row is excluded from the
picker. Every member — children included — is gated by a 4-digit PIN.

Boot flow: session exists -> KioskSelect; no session + VITE_KIOSK_LOGIN_*
present -> auto-login; no session + no creds -> Login screen (src/pages/Login.tsx).
DEPLOY NOTE: VITE_* are baked into the build. Do NOT set VITE_KIOSK_LOGIN_* in
Netlify (that would bake the password into the public bundle AND auto-login
every device). Leave them local-only (.env.local). In production every device —
including the wall tablet — signs in once via the Login screen; the persisted
refresh token keeps it logged in after.

## Design tokens
Background: #181818 | Cards: #242424 | Gold: #E6B800
Green: #42B883 | Text: #FFFFFF | Muted: #A0A0A0
Border radius: 12px cards | Min touch target: 64px

## Icons
Lucide React ONLY. Never emoji as icons.

## Architecture rules
- All Supabase queries go through service files in src/features/
- No direct supabase.from() calls in components
- All auth/session state from useAuth hook only
- Role stored as array in family_members.role — use .includes() not ===

## Data rules
- Never modify the Supabase schema without explicit approval
- BALANCE IS MANAGED BY DB TRIGGERS — never mutate family_members.balance in
  app code or RPCs (it double-counts). Triggers: chore_approval_balance_update,
  expense_application_balance_update, reward_redemption_balance_update.
  RPCs (approve_chore/apply_expense) only flip status / insert; the trigger does
  the money. approve_chore additionally handles milestone_progress + auth.
- Always handle loading, error, and empty states
- TypeScript strict — no `any` types

## Known schema notes (verified against live DB)
- family_members has NO current_streak / longest_streak columns — streaks
  are derived from chore_assignments history, not stored.
- There is NO `notifications` table — rejection notes live on
  chore_assignments.notes for MVP.
- PINs live in families.member_pins (jsonb, keyed by family_members.id).
  Column added via migration on approval. All members are PIN-gated.
- chores/expenses use is_template + null family_id for template rows.
- chore_assignments.is_active — pause/resume a roster entry. The generator only
  reads active templates. Pausing is the normal way to take a chore off a child;
  deleting the template row is permanent and can't be resumed.
- chore_assignments.recurrence_dow — smallint 0=Sun..6=Sat, pins a weekly chore
  to a weekday. Null = due end of week. Only meaningful on template rows.
- status allows 'expired'. Missed chores do NOT carry over: the sweep in
  expireLapsedAssignments() flips lapsed pending/in_progress instances to
  'expired' and a fresh instance generates next period. 'rejected' is left alone
  so the child still sees the parent's note.
- chores.is_custom — true means a parent authored it in-app; the 126 seeded rows
  are false. chores.is_archived — hidden from the library, roster entries paused.
- chore_assignments.chore_id FK is ON DELETE **RESTRICT**. Never widen it back to
  CASCADE: deleting a library chore would wipe the child's earned-chore history.
  Archive chores that have been used; hard delete only works when unused.

## Kiosk rules
- All touch targets minimum 64px
- Support both landscape and portrait
- Bottom nav on child views
- Large readable text — minimum 16px, balance at 48px+

## Supabase free tier
- Project PAUSES after 1 week of inactivity. Keep the family using it
  daily, or add a scheduled health-check ping. Revisit before beta.

## V2 Architecture Notes

### CHORE GENERATION — SCALE CONSIDERATION
Current MVP uses pre-generation: generateDailyAssignments() creates
chore_assignment instance rows each day from roster templates. Works fine for
single family beta.

For V2 SaaS launch, migrate to on-demand generation:
- Remove scheduled daily generation
- Query roster templates directly on child dashboard load
- Only create chore_assignment rows on completion (mark complete)
- Weekly/monthly chores can remain pre-generated (low volume)
- Parent dashboard shows roster schedule, not pending instances
- Result: zero DB writes for chores that are never touched

This change reduces DB row generation by ~90% at scale.

## Never do
- rm -rf without confirmation
- Drop or truncate tables
- Commit .env.local
- Hardcode Supabase keys
- Use emoji as icons
