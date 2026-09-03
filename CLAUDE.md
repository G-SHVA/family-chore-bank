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
the Cloudflare build environment (that would bake the password into the public
bundle AND auto-login every device). Leave them local-only (.env.local). In
production every device — including the wall tablet — signs in once via the
Login screen; the persisted refresh token keeps it logged in after.

## Hosting — Cloudflare Workers Static Assets (migrated off Netlify 2026-08-30)

Deployed as an ASSETS-ONLY Worker. `wrangler.toml` has no `main`, so there is
no Worker script: Cloudflare serves `dist/` directly and requests bill as
static assets, not Worker invocations. Chose Workers over Pages because
Cloudflare's own best-practices doc now says to — Pages still works but new
features and optimizations go to Workers only.

TWO SEPARATE WORKERS IN THIS ACCOUNT. Do not confuse them:
- `familychorebank-site` — the public MARKETING site, familychorebank.com.
  NOT this repo. Never point wrangler.toml at that name; a deploy would
  overwrite it.
- `familychorebank-app` — THIS repo, the kiosk SPA, app.familychorebank.com.

`not_found_handling = "single-page-application"` replaces the old Netlify
`/* -> /index.html 200` rewrite. React Router owns every path, so an unmatched
request must return index.html with a 200, not a 404 — otherwise a hard
refresh on a deep route breaks the kiosk. This is the one setting that must
never be dropped.

`public/_headers` (Vite copies it into dist/, Workers parses it and never
serves it): `/assets/*` gets a one-year immutable cache because Vite
fingerprints those filenames; everything else keeps Cloudflare's default
`max-age=0, must-revalidate`, which the PWA update path depends on — sw.js and
index.html MUST stay revalidated or tablets pin to a stale build. Also sets
X-Robots-Tag: noindex, since this is a private family app.

### CREDENTIAL HAZARD THIS MIGRATION INTRODUCED — read before touching vite.config.ts

Netlify built in CI, where .env.local does not exist, so VITE_KIOSK_LOGIN_*
was absent from production bundles by accident of environment. `wrangler
deploy` builds on the DEVELOPER'S MACHINE, where .env.local IS present.
Verified on 2026-08-30: a plain `npm run build` here inlined both the kiosk
email AND the kiosk password into dist/assets/*.js. Deploying that would have
published the shared kiosk password to the public internet.

vite.config.ts now force-defines both vars to "" whenever `command === 'build'`.
Dev (`npm run dev`, command === 'serve') is unaffected, so local auto-login
still works. useAuth guards with `if (email && password)`, and "" is falsy, so
a production build simply falls through to the Login screen — which is the
documented production boot flow anyway.

DO NOT remove that `define` block, and do not "fix" it by moving the vars to
Cloudflare's build env. There is no build-env setting that makes shipping
these safe: Vite inlines VITE_* into the public bundle by definition.
After any change to the build, re-check with:
  grep -rF "$(grep '^VITE_KIOSK_LOGIN_PASSWORD=' .env.local | cut -d= -f2-)" dist

Deploy with `npm run deploy` (builds, then `wrangler deploy`).

### Migration status — COMPLETE (2026-08-30)

Netlify is fully retired for this app. app.familychorebank.com now serves the
`familychorebank-app` Worker: DNS resolves to Cloudflare, `Server: cloudflare`
with a CF-RAY, no Netlify headers.

The cutover required deleting a leftover DNS-only CNAME
(`app` -> magenta-peony-c67c54.netlify.app) by hand first. Cloudflare refuses
to create a Custom Domain on a hostname that already has a CNAME, so
`wrangler deploy` cannot do this for you and will fail until the record is
gone. Note this if the domain is ever moved again.

Verified on the live domain: deep routes return the SPA shell with a 200,
assets serve with correct MIME types, cache headers are as configured, and
the production bundle contains neither kiosk credential.

`workers_dev = true` is deliberately still on —
familychorebank-app.gary-d84.workers.dev remains a working origin for testing
a build without touching the domain the family uses.

ROLLBACK (only if needed): re-comment the [[routes]] block, redeploy, then
recreate the DNS record `app CNAME magenta-peony-c67c54.netlify.app`, DNS-only
(grey cloud). The Netlify deployment itself was never deleted.

## Design tokens
Background: #181818 | Cards: #242424 | Gold: #E6B800
Green: #42B883 | Text: #FFFFFF | Muted: #A0A0A0
Border radius: 12px cards | Min touch target: 64px

## SESSION BALANCE PROTOCOL — MANDATORY

The children use this app daily. An unexplained balance change destroys trust
in the system. Every session must leave balances where they were unless real
family activity moved them.

AT THE START of every session, before writing any code:
 1. Read CLAUDE.md.
 2. Query and record current balances:
      SELECT display_name, balance FROM family_members
      WHERE role @> ARRAY['child']
        AND family_id = 'eaa7a6df-8ac6-40a5-8a5f-ced5dc745353';
 3. Record the snapshot in the session notes: POCO $X.XX, Cuddles $X.XX.

AT THE END of every session, before deploying:
 4. Compare final balances to the snapshot.
 5. If any balance changed because of TESTING rather than real family activity,
    reverse the test transactions through sanctioned paths before closing.
 6. Never leave test balance changes on live family accounts.
 7. Document intentional balance changes (real feature verification) separately
    from test artifacts.

WHY THIS EXISTS. On 2026-09-03 the loan feature was verified against POCO's and
Cuddles' real accounts. Three test deductions totalling $15.00 were taken from
POCO through the real money path, and an expense_applications row was deleted
mid-session, which desynced his balance from his own ledger by $2.50. Closing
that required a compensating Direct Charge plus the deletion of an approved
chore_assignment — see APPROVED EXCEPTION below. None of it would have been
necessary against a dedicated test family.

NOTE the trap that made it worse: the child's My Bank header does NOT read
family_members.balance. getTransactionHistory() sums the ledger forward from
zero and Bank.tsx takes the header from the newest row's runningBalance. So the
Bank screen and the dashboard can disagree, and any sanctioned write moves BOTH
sides equally — meaning a divergence between ledger and balance cannot be
closed by simply crediting or charging the child. Diagnose which of the two is
wrong before acting.

## Design Principles

### ONE SCREEN ONE JOB

Gary's design standard, informed by rejection of Salesforce and Zoho-style
interface bloat.

Every screen has exactly one primary job. Everything else is one tap away.
- Child dashboard job: show balance and today's actionable chores.
- Parent dashboard job: show what needs approval right now.

Before adding any element to a screen, remove or collapse something else first.
If primary content requires scrolling to reach, the screen has too much on it.
Stat reporting belongs on dedicated reporting screens, not on action screens.

Applied 2026-09-03 to the child dashboard: four stat cards removed (Achievements
already rendered the same figures), the ALL/TO DO/PENDING chips removed, the
savings goal collapsed from 387px to a 110px tap-to-expand row, and the chore
list narrowed from 90 cards to 2. Left column went from 1,010px against a 559px
fold to 428px. See getHomeChores() and the header comment in
src/pages/child/Dashboard.tsx.

### INTENTIONAL BEHAVIOR — the savings goal ring regresses

Goal progress = min(balance, target), computed at read time, so the ring moves
BACKWARDS when the balance falls: loan payments, expenses, Direct Charge. A
loan deduction and a purchase are identical to the ring.

This is the debt lesson the book describes, and it is the single most powerful
teaching moment in the app — a child watches their goal lose ground because of
a payment they agreed to. Observed live 2026-09-03: POCO's ring fell 36% -> 28%
on a $2.50 loan payment, then to 0% when a later payment took him negative.

DO NOT add special handling to protect goal progress from loan deductions.

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

## CRITICAL BUG FIXED Aug 2026 — chore_assignments queries

getMemberInstances was sorting ascending with limit(300), silently truncating
all live chores once a child exceeded 300 history rows. Both kids saw empty
chore lists while their rosters generated normally. Fixed by splitting into
purpose-built queries: the pending/active path now sorts DESCENDING under a
500-row cap so current chores always survive it, and the stats path uses
server-side counts (head:true) plus an approved-only fetch instead of
deriving totals from that capped list.

RULE: any future query against chore_assignments must specify status filters
explicitly and never rely on a row limit to implicitly exclude history. If a
query is capped, sort so the rows you actually need are the ones that survive
the cap — and never derive lifetime totals from a capped fetch.

UPDATE 2026-08-31: that 500 cap DID bite, exactly as predicted above.
getMemberInstances fetched every status under one limit(500), so a child's
live chores competed with their own growing history for the same 500 slots.
Measured on live data before the fix: POCO had 654 instance rows and was
silently losing 21 ACTIVE chores and 15 approved rows; Cuddles had 746 and was
losing 1 active and 5 approved. It is now split into getActiveInstances()
(explicit status filter — 'approved' and 'expired', the two unbounded statuses,
are excluded, so the read is bounded by current work) plus date-bounded
getApprovedSince() and getInstancesDueBetween() for the dashboard's history
figures.

Dropping the limit instead would NOT have fixed it. PostgREST applies its own
server-side max-rows to any unbounded read, so removing .limit() swaps a
visible cap for an invisible one — the precise mechanism behind the duplicate
generation bug. Bound every read yourself, by status or by date.

TRUNCATION CLASS -- FOUR INSTANCES FIXED:
1. getMemberInstances (dashboard/chores) -- fixed with query split, DESC
   ordering
2. getFamilyChildSummaries (parent dashboard) -- fixed with date-bounded reads
3. getMemberInstances 500-row cap -- fixed [2026-08-31]
4. getApprovedInstances .limit(5000) feeding lifetime earnings -- fixed
   [2026-08-31] with server-side aggregates. A limit ABOVE PostgREST's own
   max-rows is decorative: the server clips it silently, so 5000 read as "all
   of them" while returning a capped array that money was then summed from.
   Replaced by member_earnings_summary() (SUM in Postgres) and
   member_approved_day_counts() (one row per DAY, not per chore, so streak
   history grows ~365/year instead of with chores approved -- 73 approved rows
   collapse to 6 day rows). The remaining list read is renamed
   getRecentApprovedInstances() and is display-only: NEVER sum money from it.
5. getTransactionHistory (child My Bank ledger) -- STILL OUTSTANDING as of
   2026-09-02. It issues TWO unbounded selects (chore_assignments joined to
   chores, and expense_applications) and merges them client-side to build the
   running balance. Same class as 1-4: PostgREST caps each read silently, so
   once a child's history outgrows a page the ledger will start omitting old
   rows AND the running balance computed from them will be wrong.
   NOT fixed this session, deliberately: it is display-only and the fix is a
   pagination or windowing decision about what a child's ledger should show,
   not a one-line bound. getMonthlyBankSummary NO LONGER depends on it -- the
   month figures were moved onto member_earnings_summary() plus a date-bounded
   expense read on 2026-09-02, precisely so the money at the top of that screen
   does not ride on this. Fix before public launch.

Any new query against chore_assignments or chore_assignments_archive must:
- Never rely on a row limit to filter data
- Always specify status filters explicitly
- Always use DESC ordering on due_date
- Use server-side aggregates (head:true) for counts, never client-side
  array.length

## CRITICAL BUG FIXED Aug 31 2026 — duplicate chore generation

generateDailyAssignments() re-inserted the ENTIRE active roster on every call.
The table held 5,330 instance rows where 1,400 were legitimate; one chore had
180 copies for a single child on a single day.

ROOT CAUSE — the same failure class as the getMemberInstances truncation above.
The existence check ran with no .order() and no .limit():

    .select('id, template_id, due_date')
    .eq('is_template', false)
    .in('template_id', templateIds)

PostgREST caps an unbounded read at 1000 rows, and with no ORDER BY it returns
the OLDEST rows in physical order. Growth was a steady 68 rows/day from Aug 12
to Aug 28; the running total crossed 1,000 on Aug 27, and Aug 29 produced 1,995.
Once past the cap the check saw only ancient history — all 85 templates were
still *visible*, but only 7 had a CURRENT-PERIOD row in the window — so 78 of 85
looked unfulfilled and were re-created on every single pass. Self-amplifying:
each pass pushed the live rows further out of reach.

Timezone was NOT involved. All 236 duplicate groups had byte-identical due_date
values; nothing round-tripped wrong.

THREE-LAYER FIX. Do not remove any layer thinking another covers it:
1. `idx_ca_daily_dedup` — partial unique index on (template_id, assigned_to,
   date_trunc('day', due_date AT TIME ZONE 'America/Chicago')) WHERE
   is_template = false AND template_id IS NOT NULL AND status IN
   ('pending','in_progress'). This is the ONLY layer that survives concurrency.
   Scoped to the two statuses the generator inserts, so historical
   approved/completed/rejected rows are never constrained — they are the
   financial record and must stay writable.
   NOTE: that `AT TIME ZONE '<literal>'` form IS immutable and legal in an index;
   the one-arg date_trunc on a timestamptz is not (it reads session TimeZone).
2. The insert is `.upsert(rows, { ignoreDuplicates: true })`. Passing NO
   onConflict is deliberate — PostgREST then emits an UNTARGETED
   `ON CONFLICT DO NOTHING`, which honours a partial expression index. A named
   conflict target cannot reference one.
3. The existence check is now date-bounded, ordered DESC and explicitly limited.

Generation is PARENT-DASHBOARD ONLY. Children must never trigger it. The child
Dashboard loader also runs after every completion, so a child working down their
list fired one full roster pass per chore — five passes in 41 seconds, observed.
The old module-level `generationLock` only coalesced calls within one tab, so two
tablets still raced; `GENERATION_MIN_INTERVAL_MS` now collapses bursts, but the
unique index is what actually makes concurrent passes safe.

RULE: never issue an unbounded PostgREST read against a growing table. Bound it
by date, order so the rows you need survive the cap, and set the limit yourself.

### Known minor balance variance — $0.30, deliberately not corrected
The duplicate bug let a few chores be approved more than once before it was
caught: POCO over-credited $0.10, Cuddles $0.20. Decision (2026-08-31): do NOT
touch it. Balances are trigger-managed; a DELETE of an approved row does not
reverse its credit (the trigger is AFTER UPDATE), so reconciling would mean
writing family_members.balance directly — more risk than $0.30 warrants. The
duplicate approved rows were left in place so history still matches the balance.
The index prevents any recurrence. This is likely also the source of the
Achievements discrepancy noted below.

### SESSION RECONCILIATION — 2026-09-03, $2.50 direct award

POCO received a $2.50 direct award titled "Session reconciliation" to close a
$2.50 gap between his balance and his own transaction history.

ROOT CAUSE. During loan-feature verification an expense_applications row was
DELETED so a loan could be charged twice in the same calendar month (the
once-per-month guard keys on that row). The delete did not reverse the debit:
expense_application_balance_update is AFTER INSERT only — the same asymmetry
already documented above for the $0.30 chore variance. The balance stayed
$2.50 lower than the surviving ledger explained, which the child's My Bank
screen would have shown as a running total disagreeing with its own header.

LESSON, and it is the important part: NEVER DELETE expense_applications ROWS
ON LIVE DATA. Every balance trigger in this schema fires one way only, so any
DELETE against the money path silently desyncs the balance from the ledger.
Before running a destructive statement on family accounts, check the trigger
direction — INSERT-only and UPDATE-only triggers cannot be undone by removing
the row that fired them. Future verification sessions should use a dedicated
test family rather than POCO and Cuddles.

FULL SEQUENCE, for the record. The first correction attempt was WRONG and is
worth keeping visible: a $2.50 direct award was applied on the theory that the
ledger was authoritative and the balance was wrong. It was the other way round —
POCO had genuinely been charged $2.50 + $7.50 against a $10.00 loan, so the
balance was right and the ledger was missing a row. The award was reversed with
a matching Direct Charge, and the phantom award row deleted under the APPROVED
EXCEPTION below.

DIAGNOSE BEFORE CORRECTING. A credit or a charge moves the ledger AND the
balance by the same amount, so neither can ever close a gap between them. Work
out which side is wrong first.

FINAL STATE. POCO was restored to his session-start $12.47 with a $15.00 direct
award titled "Loan feature testing — account restored", matching the $15.00 of
test deductions ($2.50 + $7.50 + $5.00) taken during F verification. This
inflates his lifetime earnings from $27.80 to $42.80 — a known cosmetic
inaccuracy in Total Earned on Achievements. It does NOT affect streaks
(rosterInstancesOnly filters awards out) or balance accuracy, and the ledger
and balance agree at $12.47. Cuddles was never affected: $14.00 throughout,
because forgiveness moves no money. The SESSION BALANCE PROTOCOL above was
written this session specifically to prevent a recurrence.

The correction itself went through the sanctioned path (directAwardCustom ->
insert-as-completed -> approve_chore), so no code wrote family_members.balance.
Cost: POCO's lifetime earnings carry a $2.50 entry that was not a real chore.
That is visible and explainable; a silently wrong balance is neither.

### APPROVED EXCEPTION — deleting an approved chore_assignment row

Permitted ONLY when a Direct Charge of identical amount has been applied FIRST
as an explicit reversal, and both actions are recorded here with the session
date and reason.

This is not a general precedent. The PAIRING is what makes it safe — charge
first, delete second. chore_approval_balance_update is AFTER UPDATE and cannot
be un-fired, so the credit must already be offset before the row is removed.
Deleting first and charging afterwards leaves a window where the balance is
wrong, and forgetting the charge entirely produces exactly the class of silent
variance documented above.

USED ONCE, 2026-09-03: assignment 4245b366 ("Session reconciliation", $2.50,
POCO), deleted after a $2.50 Direct Charge titled "Reversal — session
reconciliation" had already been applied. Verified afterwards: ledger earned
$27.80, spent $30.33, running end -$2.53, family_members.balance -$2.53, agree.

### Known minor discrepancy — Achievements total earned (investigate later)
Achievements displayed $6.90 total earned where SQL computes $7.00 over the
same rows — a 10c gap, likely one approved chore_assignment whose joined
chore has a null or changed value. Low priority, unrelated to the truncation
bug. Do not chase without a reason.

## Known schema notes (verified against live DB)
- family_members has NO current_streak / longest_streak columns — streaks
  are derived from chore_assignments history, not stored.
- There is NO `notifications` table — rejection notes live on
  chore_assignments.notes for MVP.
- PINs live in families.member_pins (jsonb, keyed by family_members.id), stored
  as bcrypt hashes (cost 10). All members are PIN-gated.
  VERIFICATION IS SERVER-SIDE ONLY (changed 2026-08-28). Never reintroduce a
  client-side PIN comparison, and never select member_pins from the browser:
  * authenticated/anon have SELECT on the other 13 families columns only, so
    `select('*')` on families FAILS. Use the explicit FAMILY_COLUMNS list in
    familyService.
  * verify-pin / set-pin Edge Functions own all PIN reads and writes via the
    service-role key. They resolve the caller's family from the JWT and refuse
    any member_id outside it.
  * public.pin_attempts holds the rate-limit counters: 5 failures locks a member
    for 60s (429). RLS on, no policies, and no client grants — service-role only.
  * hasPin comes from the family_pin_status() RPC, which returns booleans only.
  * There is NO plaintext fallback. The legacy compare and the opportunistic
    re-hash were removed once the migration confirmed 0 plaintext PINs
    (2026-08-28). verify-pin now fails closed on any stored value that isn't a
    bcrypt hash, returning 409 pin_not_hashed; recovery is a parent clearing the
    PIN and the member setting a new one. Do not reintroduce a plaintext branch.
  * A 4-digit PIN is only 10k possibilities, so bcrypt alone is not the defence:
    the rate limit and the unreadable column are. Keep both.
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

### SCHEMA FACTS — MONEY PATH
- chore_approval_balance_update trigger is AFTER UPDATE only. Inserting a row
  with status='approved' credits nothing. Balance only moves on UPDATE from a
  non-approved status to approved. Always use the insert-as-completed +
  approve_chore RPC sequence for direct credits.
- chores.created_by references auth.users(id) NOT family_members(id).
  chore_assignments.assigned_by and approved_by reference family_members(id).
  Do not mix these FKs.
- 'direct-award' is a reserved category in the chores table. Rows with this
  category are one-off award receipts and are excluded from getFamilyChores()
  and all library views. Never use this category for real chores.
- 'direct-charge' is the mirror reserved category in the EXPENSES table (added
  2026-09-01). Rows with this category are one-off charge receipts created by
  Direct Charge and are excluded from getFamilyExpenses(). Never use it for a
  real expense.
  ASYMMETRY WITH CHORES, and it matters: `chores` has an is_archived column that
  a Direct Award's one-off row also sets, but `expenses` has NO is_archived
  column. The category filter in getFamilyExpenses() is therefore the ENTIRE
  mechanism keeping one-off charges out of the library — there is no second
  layer. getFamilyExpenses is the single door both consumers use (Manage ->
  Expenses, and Quick Add's Add Expense tab); any NEW read of `expenses` for
  library purposes must exclude this category itself.
  Direct Charge inserts the expenses row then calls the existing apply_expense
  RPC; expense_application_balance_update (AFTER INSERT on expense_applications)
  does the debit. No app code touches the balance. The optional note is stored
  on expenses.description — expense_applications has no notes column.
  Overdrafts are allowed by design: a parent may deliberately take a child
  negative as a teaching moment. The UI warns but never blocks.

### SCHEMA FACTS — CHILD SAVINGS GOALS (added 2026-09-01)

A savings goal is a row in `milestones` with child_initiated = true. It shares
that table with parent-set family milestones and is otherwise nothing like one.
Columns added: child_initiated, created_by_member, status, achieved_at.

- PROGRESS IS NEVER STORED. A goal's progress is min(current balance, target),
  computed at read time. It deliberately moves BACKWARDS when the child spends —
  that trade-off is the entire point of the feature. Never migrate it to a
  stored, earnings-accumulated figure; that would ignore spending.
- approve_chore EXCLUDES child_initiated goals from its milestone_progress loop
  (`AND ms.child_initiated IS NOT TRUE`). Without that predicate the loop, which
  is scoped only by family_id, would create milestone_progress rows for a goal
  against EVERY child in the family — so one child's chore approval would
  advance the other child's personal goal, accumulating lifetime earnings rather
  than tracking a balance. Do not remove it.
- `IS NOT TRUE`, never `= false`. child_initiated is nullable, and in SQL
  NULL = false is NULL, not true — so a NULL row would be silently skipped by an
  `= false` predicate and treated as a goal. The same reasoning drives the
  NOT_A_GOAL filter (`child_initiated.is.null,child_initiated.is.false`) in
  milestoneService, which keeps goals out of the parent Milestones tab and off
  the OTHER child's Achievements screen.
- created_by_member references family_members(id). NOTE milestones.created_by
  already exists and references auth.users(id) — two different FKs on one table.
  Do not mix them.
  created_by_member is an APP-LEVEL RECORD OF AUTHORSHIP, NOT A SECURITY
  BOUNDARY. RLS cannot enforce that a child created the goal: the "Parents can
  manage milestones" policy checks `'parent' = ANY(role)`, and the kiosk's
  shared session is always the `Kiosk` parent row. Child identity is app state.
- ONE ACTIVE GOAL PER CHILD, enforced by `idx_milestones_one_active_goal` —
  a partial unique index on (created_by_member) WHERE child_initiated = true AND
  status = 'active'. This is the layer that survives concurrency (two tablets,
  two taps); app-side checking is not sufficient. Abandoning or achieving a goal
  frees the slot. goalService translates the 23505 violation into a readable
  sentence rather than surfacing a constraint name.
- Abandon is a SOFT delete (status = 'abandoned'), never a row delete, so the
  child's financial history stays intact. Achieved goals are permanent and are
  not editable — updateGoal/abandonGoal/markGoalAchieved are all guarded with
  `.eq('status','active')` so a stale screen or a double-tap cannot rewrite an
  achieved_at that is already set.
- The weekly-rate estimate (getWeeklySavingsRate) EXCLUDES Direct Awards, via
  `.not('template_id','is',null)` — the same filter streaks use. A parent's gift
  is not the child's work, and inflating the rate with it breaks the effort ->
  progress link the goal exists to teach. Note this differs from every other
  money reading in the app, where an award IS real earnings. It divides by the
  history that actually exists (1-4 weeks), not a flat 4, so a child two weeks
  in does not read as earning half their true rate.

### SCHEMA FACTS — LOANS (added 2026-09-03)

A loan RECORDS A DEBT. It never transfers money. Creating one credits the child
nothing — the parent already bought the thing; this tracks repayment. Verified
live: POCO's balance was unchanged by loan creation.

- ONE `expenses` ROW PER LOAN, not one per payment (`loans.expense_id`). Every
  monthly deduction is a single expense_applications row pointing back at that
  one row, so a loan costs 1 row/month rather than 2 the way Direct Charge does.
  It also gives the "already charged this calendar month?" check a natural home
  with no new table and no new column on a shared one.
- `'loan-payment'` is the THIRD reserved expenses category. Same caveat as the
  other two and it never stops mattering: `expenses` has no is_archived column,
  so the exclusion in getFamilyExpenses() is the ENTIRE mechanism. Verified
  2026-09-03: 31 family expenses, 28 in the library.
  The row DOES appear in Recent expenses (the applications ledger) and that is
  correct — the library is for managing expense types, the ledger is the
  transaction record. reminder-penalty behaves the same way.
- PAYMENTS ARE AUTOMATIC. There is deliberately no "Apply Payment" button
  anywhere, and no "pay now" for the child. The parent sets the terms at
  creation; the system handles timing. A child gets no discretion and neither
  does a parent. "Run Monthly Deductions" exists only because the free tier has
  no cron; after the Pro upgrade the same Edge Function runs on the 5th and the
  button becomes a manual override.
- process_loan_payments() takes FOR UPDATE **before** the duplicate check. A
  read-then-write with no lock is the race that produced the duplicate chore
  generation bug; here it would double-charge a child.
- The final payment is LEAST(monthly_payment, balance_remaining), so a loan can
  never be overpaid. Verified live: a $15.00 monthly payment against a $7.50
  remaining balance charged exactly $7.50.
- It does NOT call apply_expense(), for two independent reasons. (1) apply_expense
  guards with is_family_parent(), which reads auth.uid(); under the service-role
  key that is NULL and it would raise 'Not authorized' on every run. (2) it
  deducts expenses.amount, a fixed value, which would overpay the final payment.
  EXECUTE is granted to service_role ONLY, so the kiosk's shared authenticated
  session cannot reach it over REST. The Edge Function is the sole door.
- ONE ACTIVE LOAN PER CHILD via `idx_loans_one_active_per_member`, a partial
  unique index. Verified 2026-09-03 by direct INSERT: the second active loan for
  a member fails with 23505, and setting the first to 'forgiven' frees the slot
  immediately. loanService translates 23505 into a readable sentence. The UI
  additionally excludes children who already hold a loan from the New Loan
  selector, so the constraint is a concurrency backstop, not the primary guard —
  exactly like idx_milestones_one_active_goal.
- FORGIVENESS DOES NOT CREDIT THE CHILD, and `balance_remaining` is NOT zeroed.
  The remaining balance is the historical record of what was forgiven; zeroing
  it would make the Loan History row read as though nothing was owed. `status`
  is what makes the loan inert, and nothing reads balance_remaining on a
  non-active loan. Forgive is guarded with .eq('status','active') so a stale
  screen cannot rewrite a paid_off_at that is already set.
- RLS IS FAMILY-SCOPED, NOT CHILD-SCOPED. There is deliberately no policy
  claiming a child sees only their own loans, because RLS cannot express one:
  the kiosk runs one shared session as the `Kiosk` parent row. The member_id
  filter in loanService is the actual boundary. Same situation as
  milestones.created_by_member.
- The child-facing "paid off" / "forgiven" banner is DERIVED from
  loans.paid_off_at inside a 48-hour window, with sessionStorage dismissal —
  the same pattern as character recognition. No notifications table, zero new
  rows. Forgiveness gets its own wording and its own colour (antique on bg-wash,
  vs green for paid off): a parent cancelling a debt is a different event from a
  child finishing one.
- A negative balance renders in --color-text-secondary, never red and never
  gold. The minus sign is the message and the "I owe" line explains it.
  Overdrafts are allowed by design, and a loan payment may deliberately create
  one. Verified live: POCO reached -$2.53 through the real money path.

## Dev-environment artifacts (not production bugs)

- HMR WEDGE ON "Switch user" (observed 2026-09-01). After editing a component,
  Vite's hot reload can leave the app in a state where the Switch user control
  stops responding and only a full page reload recovers it. Verified afterwards
  on clean loads: it works on one click from the parent layout (twice) and from
  a child session (POCO). ChildLayout and useAuth.exitToPicker were never
  touched by the goals work. Production has no HMR, so this cannot occur there.
  Do not go hunting for a Switch user regression on the strength of a dev
  session — reload first and re-test before investigating.

## Kiosk rules
- All touch targets minimum 64px
- Support both landscape and portrait
- Bottom nav on child views
- Large readable text — minimum 16px, balance at 48px+

## Family Week — "biggest win" tie-breaking (not a bug)

familyWeekService picks each child's highest-value approved chore of the week
with a plain max-by-value loop over rows ordered approved_at DESC, so the FIRST
row wins a tie and the displayed chore is the most recently approved of the
equal-valued ones. With a roster full of $0.25 chores, ties are the normal case,
not the exception -- two runs against the same data can legitimately name
different chores if new approvals land between them.

Deliberately left alone (2026-09-02). The figure shown is always correct; only
WHICH equal-valued chore gets named is unspecified. If deterministic display is
ever wanted, break the tie on a stable secondary key -- created_at ASC -- rather
than relying on the fetch order.

Do not "fix" this by chasing a mismatch against an ad-hoc SQL query: a
verification query using ORDER BY value DESC LIMIT 1 breaks ties arbitrarily
too, so the two disagreeing proves nothing.

## Known development traps

### REGEX TRAP — control characters written instead of escape sequences

A scripted edit intended to write `` into a regex instead wrote a literal
BACKSPACE byte (0x08), producing `/<BS>loans?$/i` — a pattern that matches
nothing. The fix appeared to apply, `sed` printed the line looking correct
(0x08 renders invisibly), and `tsc` passed, because it is a syntactically valid
regex. Only the behaviour was wrong.

RULE: after any scripted edit that writes a backslash escape into source, dump
the RAW line and check it — `python -c "print(repr(line))"`, not `sed` or
`grep`. tsc will not catch this class of error. The whole of src/ was swept for
control characters on 2026-09-03 and is clean.

### CHILD DASHBOARD LEFT COLUMN — 559px is the fold at 1024x768

Header (97px) + bottom nav (72px) + main's pb-28 (112px) = 281px of fixed
chrome, leaving 559px.

Measured states (2026-09-03, at the true 390px column width):
- balance + goal, no banner:                    280px
- + recognition banner:                         428px
- + active loan line (64px touch target):       504px
- + BOTH banners (recognition AND loan          618px  <- scrolls
  resolution) at once:

The last state scrolls, and that is accepted rather than fixed. It requires two
48-hour banners stacked simultaneously, which is an extreme edge case. Every
card carries shrink-0 deliberately: compression is worse than scrolling one
card's worth, and a flex child without it is silently squashed rather than
pushing the column into scroll.

## Known layout traps

### Child dashboard left column — every card needs `shrink-0`

The child Dashboard's left column is a height-constrained, independently
scrolling flex column:

    <div className="scroll-skin flex shrink-0 flex-col gap-4 lg:w-2/5
                    lg:min-h-0 lg:overflow-y-auto lg:pr-2">

A flex child SHRINKS before its container overflows. So a card added here
without `shrink-0` is silently compressed instead of pushing the column into
scroll — it does not error, it does not warn, it just renders wrong.

Observed 2026-09-02 while building the "Caught Being Great" banner: the banner
rendered as a ~30px sliver with its headline sliced through the middle. Adding
`shrink-0` to the banner's root fixed it completely.

RULE: any new card in that column carries `shrink-0` on its outermost element.
This applies to the component's own root when the component is the flex child
(as with CharacterMomentBanner) — putting it on an inner wrapper does nothing.

## Supabase free tier
- Project PAUSES after 1 week of inactivity. Keep the family using it
  daily, or add a scheduled health-check ping. Revisit before beta.

## Local credentials drift

.env.local holds VITE_KIOSK_LOGIN_EMAIL / VITE_KIOSK_LOGIN_PASSWORD for dev
auto-login only (vite.config.ts force-defines both to "" on build, so they
never reach a bundle -- see the credential hazard section above).

Those local values can DRIFT from the live kiosk account. If the kiosk password
is changed in Supabase and .env.local is not updated, dev auto-login fails
silently and drops to the Login screen, which looks like a broken boot flow
rather than a stale password. Confirmed stale on 2026-08-31: the stored password
returned invalid_credentials against the live project.

PROCESS: whenever the kiosk account password changes, update .env.local in the
same sitting. It is the only copy, it is gitignored by design, and nothing will
warn you it has gone stale.

## Pre-launch checklist

- Bundle size: 1,053 kB JS chunk (297 kB gzipped). Exceeds Vite 500 kB warning.
  Code-split before public launch. Primary candidates: Recharts (analytics),
  Framer Motion (animations), goalService/analyticsService are good lazy-load
  targets. Use dynamic import() on route level — each page loads only what it
  needs.

- ROSTER SIZE: 85 active chores across two children producing 19-28% completion
  rates. Book recommends 3-5 chores per child to start. Review and pause
  non-essential roster entries before public launch or onboarding new families
  with default templates.
  Measured 2026-09-02 via the Family Week System Health section: 56 of 85 active
  roster entries had NO completion that week. The screen was built to surface
  exactly this, and the first thing it surfaced was that the roster is too large
  for the children's current stage -- the book's "Kitchen Sink" warning, live.

- TRUNCATION CLASS INSTANCE 5 — getTransactionHistory (child My Bank ledger)
  still issues two UNBOUNDED selects and derives the running balance from the
  merged result. It needs the same treatment the other four instances got:
  server-side aggregates for any figure, and an explicit bound (date window or
  pagination) for the displayed list. Left alone on 2026-09-02 because it is
  display-only and the fix is a product decision about how much history a
  child's ledger should show, not a one-line bound. The MONTH FIGURES above it
  no longer depend on it. Fix before public launch.

- MODAL BACKDROP SWALLOWS CLICKS DURING EXIT. The shared Modal's backdrop stays
  clickable through its ~150ms exit animation, so the first click on any button
  sitting underneath a just-closed modal is eaten. Reproduced three times on
  2026-09-03 (Run Monthly Deductions and Forgive, both under a closing New Loan
  modal). Predates the loan work and affects every screen with a modal.
  FIX: `pointer-events: none` on the backdrop while exiting. Before public
  launch — a parent who taps once and sees nothing happen will tap again, and on
  a destructive control that is worse than cosmetic.

- CHILD DASHBOARD QUERY BUDGET: 2 reads, as of the loan session. The completion
  rate read (getInstancesDueBetween) was REMOVED and the loan state read
  replaced it, so adding loans cost the most-opened screen in the app nothing.
  getChildLoanState() answers both "is there an active loan" and "was one
  resolved in the last 48h" in one OR-filtered query, each half bounded — one by
  status, one by date.
  RULE: any future addition to the child dashboard must either replace an
  existing read or justify the addition explicitly.

- SCHEMA COMPLETENESS — supabase/migrations/ is not rebuildable from scratch.
  Base tables, triggers, and RLS policies predate migration history. Before a
  second developer joins or a staging environment is created, run
  supabase db dump against the live project and commit as
  migration_000_baseline_dump.sql. Verify a fresh Supabase project can be
  initialized from the repo alone.

- MIGRATION HISTORY — RESOLVED FOR APPLIED MIGRATIONS, 2026-09-01. The live
  project has 17 applied migrations. The repo captured 5 of them; the 2026-09-01
  backfill added the session's own two, and the baseline
  (20260901220000_baseline_live_schema.sql) captured the objects created by the
  remaining ten. approve_chore, apply_expense, chore_assignments_archive and
  archive_old_assignments are all now in the repo, read from the live database
  rather than reconstructed. See "Migration audit" below for the mapping.
  This does NOT make the repo rebuildable — see SCHEMA COMPLETENESS above; the
  baseline ALTERs tables the repo still never creates.
  One secondary note: the four pre-existing repo files are named with rounded
  timestamps that do NOT match their remote version numbers (e.g. local
  20260831090000 vs remote 20260831123242), so `supabase db push` would treat
  them as new and try to re-apply them. The two files added 2026-09-01 use the
  exact remote version as their prefix, which is the convention to follow.

- families.timezone column reads 'UTC' but client and the daily dedup index
  both use America/Chicago. Reconcile before multi-family launch — either
  populate timezone from family settings or make the index timezone-aware
  from the DB column.
  Context: the client computes due_date from the BROWSER's local zone, and
  idx_ca_daily_dedup buckets by a hardcoded 'America/Chicago' literal. Both
  are correct for this one family and nothing reads families.timezone today,
  so the mismatch is latent. It stops being latent the moment a second family
  sits in another zone: their day boundary would be bucketed against Chicago's,
  so a chore generated late evening local could land in the neighbouring
  bucket and either duplicate or be wrongly suppressed.
  ALL AFFECTED LOCATIONS — reconcile every one in a single pass:
   1. idx_ca_daily_dedup — buckets due_date by a hardcoded 'America/Chicago'
      literal.
   2. member_approved_day_counts() — buckets approved_at into local days for
      the streak, same hardcoded literal.
   3. process_loan_payments() — reads the local day-of-month for the payment_day
      comparison and the calendar-month start for the duplicate check, same
      hardcoded literal. [added 2026-09-03]
   4. The CLIENT computes date windows from the BROWSER's local zone. Measured
      2026-09-03: a 14-day rejected-chore window returned 24 rows from the app
      and 29 from a `current_date - interval '14 days'` query, because SQL
      resolved midnight in UTC and the client in Chicago. Five rows sat in that
      5-hour gap. Neither was wrong; they answered different questions. Any
      verification query MUST match the client's zone before its result can be
      compared to what a screen shows.
  NOTE if making the index read the column: an index expression must be
  IMMUTABLE, and a subquery against families is not. That route needs the
  timezone denormalised onto chore_assignments (or a generated local-day
  column) rather than a lookup inside the index.

## NEXT FEATURE — Available chores to claim

Do not start this without Gary asking; recorded here so the context survives
the session.

Eve over-assigned the roster (85 entries) because the kids had no way to
self-select chores and kept asking her to assign them manually. The roster size
is a symptom of a missing workflow, not a judgement error — and the Family Week
System Health screen already surfaced it (56 of 85 active entries had no
completion in a week).

SOLUTION: a small mandatory core roster (5-8 chores per child) plus a browsable
claim library.

TWO CLAIM PATHS, both requiring parent approval:
 1. "Do this once" — a one-time instance, status = 'requested'.
 2. "Add to my regular chores" — a roster addition request, approved as a new
    template entry.

SCHEMA: add 'requested' to the chore_assignments.status CHECK constraint. One
ALTER TABLE. No new table needed.

## V2 Architecture Notes

### CHORE GENERATION — SCALE CONSIDERATION
Current MVP uses pre-generation: generateDailyAssignments() creates
chore_assignment instance rows each day from roster templates. Works fine for
single family beta.

MEASURED FOOTPRINT (2026-08-22, after ~2 weeks of real family use):
- chore_assignments: 855 rows, 360 kB total (144 kB table + 176 kB indexes)
- entire public schema (ALL family data): 2.4 MB
- whole database: 14 MB
- growth rate: ~51 instance rows/day for 2 kids / 81 active templates,
  roughly 18,600 rows/year for this one family

The ~30 MB shown in the Supabase dashboard is PLATFORM BASELINE — system
catalogs, extensions, auth, realtime, storage. A brand-new empty project
weighs about that. It is NOT our data, and deleting chore rows will not
move that number. Do not treat dashboard size as a data-growth signal.

So on-demand generation is a V2 SaaS-scale priority, NOT a beta emergency.
At one family the row count is harmless; at N families it is the difference
between a small table and a very large one.

BUT pre-generation already bit us once, and not through disk: instance rows
accumulated past a capped read query and pushed every live chore out of the
fetch window, so both kids saw empty chore lists (fixed 2026-08-22 — see
getMemberInstances). Any capped query over a growing table has this failure
mode. Sort so the rows you need survive the cap, and derive lifetime totals
from server-side aggregates rather than a capped fetch.

For V2 SaaS launch, migrate to on-demand generation:
- Remove scheduled daily generation
- Query roster templates directly on child dashboard load
- Only create chore_assignment rows on completion (mark complete)
- Weekly/monthly chores can remain pre-generated (low volume)
- Parent dashboard shows roster schedule, not pending instances
- Result: zero DB writes for chores that are never touched

This change reduces DB row generation by ~90% at scale.

### STORAGE OPTIMIZATION — IMPLEMENTED (2026-08-30)

Phase 1 is live: indexes reviewed, archive table created, analytics union
queries implemented for All Time.

**Indexes on chore_assignments.** Only ONE was actually added —
`idx_ca_due_date (due_date DESC)`. The other three planned indexes already
existed under different names, and creating them would have added pure write
cost to a table growing ~51 rows/day:

- `idx_ca_due_date (due_date DESC)` — ADDED this session
- `idx_chore_assignments_assigned_to (assigned_to)` — already existed
- `idx_chore_assignments_status (status)` — already existed
- `chore_assignments_template_active_idx (is_template, is_active)
  WHERE is_template = true` — already existed, and supersedes a plain
  `(is_template) WHERE is_template = true`
- also present: `idx_chore_assignments_assigned_instances
  (assigned_to, due_date) WHERE is_template = false`,
  `idx_chore_assignments_chore_id`, `idx_chore_assignments_template_id`

RULE: check `pg_indexes` before adding an index here. Duplicate indexes are
invisible in queries and expensive on every write.

**chore_assignments_archive table.**

- Column list mirrors chore_assignments EXACTLY — all 15 columns, same order,
  `is_active` and `recurrence_dow` INCLUDED. They are not optional: the archive
  function moves rows between the tables, and a column-count mismatch fails at
  runtime. If a column is ever added to chore_assignments, add it here and to
  the explicit column lists inside archive_old_assignments().
- Carries the same four FKs as the live table. These are load-bearing, not
  decoration: PostgREST derives embedded joins from foreign keys, so without
  `chore_id -> chores(id)` an All Time analytics read of
  `chore:chores(title, value, category)` fails with PGRST200 "Could not find a
  relationship". Verified against the live REST endpoint.
- RLS enabled, family-scoped through `chores.family_id`, mirroring the live
  table's policy. Do NOT write the policy as a subquery over
  chore_assignments_archive itself — Postgres re-applies the policy to that
  inner reference and aborts with "infinite recursion detected in policy for
  relation". It would also match nothing regardless, because this kiosk keeps a
  user_id on the operator member row only while assignments belong to children.

**archive_old_assignments().**

- Moves expired/rejected instance rows older than 90 days into the archive.
- Single `WITH moved AS (DELETE ... RETURNING *) INSERT ...` statement, so the
  set archived and the set deleted are identical by construction. Two separate
  statements could diverge, and the divergence would be silent data loss next
  to the money path.
- SECURITY DEFINER with `SET search_path = public, pg_temp`, and EXECUTE
  granted to service_role only — it deletes rows, so the kiosk's shared
  authenticated session must not be able to call it over REST.
- NEVER archives: approved rows (the financial history behind every balance),
  template rows, or pending/in_progress rows.
- Run manually about monthly for now. As of 2026-08-30 it would move 0 rows —
  all data is younger than 90 days. Verified end to end by backdating one
  expired row, archiving it, and restoring it.

**Analytics union.** Implemented in `src/features/analytics/analyticsService.ts`
(NOT choreService.ts — analytics moved to its own service). `sourcesFor(range)`
returns both tables when `range.key === 'all'` and the live table alone
otherwise; the filters need no special-casing, because All Time has no lower
bound to apply. Expenses are never archived, so `fetchExpenses` reads one table
for every range.

**Storage projections.** Measured ~420 bytes/row all-in (144 kB table +
176 kB indexes across 855 rows), of which ~180 bytes is the row itself. At
18,600 rows/family/year and 100 families that is ~1.86M rows/year, ~781 MB/year
including indexes. Supabase Pro ($25/mo) includes 8 GB — several years of
headroom at that scale.

Phase 2 (public launch): upgrade to Supabase Pro.
Phase 3 (50+ families): schedule archive_old_assignments() via Supabase cron,
monthly.

### MONTHLY MAINTENANCE — deleteExpiredAssignments()
src/features/chores/choreService.ts exports deleteExpiredAssignments(days=30).
Run it manually about once a month; nothing schedules it.

It deletes ONLY instance rows (is_template = false) with status 'expired' or
'rejected' whose due_date is older than the cutoff. It never touches:
- 'approved' rows — the financial history behind every balance, and what the
  balance triggers operate on. Keep forever.
- 'rejected' rows inside the 30-day window — kids still need to read the
  parent's note on why a chore wasn't approved.
- template rows — deleting one takes the child off the chore entirely.

As of 2026-08-22 it would delete 0 rows (all data is younger than 30 days).
This is housekeeping, not a space fix — see the footprint numbers above.

## Never do
- rm -rf without confirmation
- Drop or truncate tables
- Commit .env.local
- Hardcode Supabase keys
- Use emoji as icons

## Migration audit — 2026-09-01

Compared `supabase/migrations/` against the live project's applied migration
history. 17 migrations are applied remotely; the repo captures 7.

CAPTURED IN THE REPO (7):
- 20260828212105 pin_server_side_verification_additive
- 20260828214445 pin_lockdown_revoke_member_pins_read          } both in the
- 20260828214551 pin_attempts_revoke_client_grants             } bcrypt file
- 20260831123242 chore_assignment_daily_dedup_index
- 20260831133207 member_earnings_and_approved_day_aggregates
- 20260901213153 add_child_savings_goals_to_milestones      (backfilled)
- 20260901213410 approve_chore_exclude_child_initiated_goals (backfilled)

LIVE BUT NOT IN THE REPO (10) — all predate 2026-09-01:
- 20260808214850 add_member_pins_to_families
- 20260808224423 add_template_fields_to_chore_assignments
- 20260808225955 balance_rpcs_approve_chore_apply_expense          <- RPC
- 20260808230648 harden_approve_chore_idempotent_credit            <- RPC
- 20260808231323 approve_chore_lock_then_check                     <- RPC
- 20260808231811 rpcs_defer_balance_to_existing_triggers           <- RPC
- 20260811235409 chore_roster_lifecycle
- 20260830213305 create_chore_assignments_archive
- 20260830213343 create_archive_old_assignments                    <- RPC
- 20260830213428 archive_foreign_keys_for_postgrest_embedding

WHAT THIS MEANS. Every RPC on the money path — approve_chore and apply_expense —
was created and hardened by migrations 3 through 6 above, none of which exist as
files. The 2026-09-01 file only carries CREATE OR REPLACE for approve_chore, so
it edits a function the repo never creates. Same for the archive feature: the
table, its FKs (load-bearing for PostgREST embedding) and archive_old_assignments
are live-only. `apply_expense` has no repo file at all.

DONE 2026-09-01 — 20260901220000_baseline_live_schema.sql now captures the
objects those ten migrations created: families.member_pins, the
chore_assignments roster columns + template FK + seven indexes,
chore_assignments_archive (table, four FKs, three indexes, RLS + policy),
apply_expense, and archive_old_assignments with its service_role-only EXECUTE
grant. Every definition was read from the live database — pg_get_functiondef
for bodies, information_schema / pg_indexes / pg_constraint / pg_policies for
structure — not reconstructed.

approve_chore is deliberately NOT in the baseline: 20260901213410 already holds
its current state and sorts earlier. Two files defining the app's most
safety-critical function would be two sources of truth.

No intermediate states were invented. 'harden', 'lock_then_check' and
'defer_balance_to_triggers' are refinements of the same two functions that no
longer exist anywhere; only the final converged version is recorded. That is
the honest limit of what a baseline can say.

STILL OUTSTANDING — the base schema. The earliest live migration
(20260808214850) ALTERs `families`, so every base table, the three balance
triggers with their update_balance_on_* functions, and all base RLS policies
predate the migration history and have no file anywhere. The baseline ALTERs
and references tables the repo never creates, so a from-scratch rebuild still
fails on the first statement. The live database therefore remains the only
complete source of schema truth. See SCHEMA COMPLETENESS in the pre-launch
checklist for the fix.
