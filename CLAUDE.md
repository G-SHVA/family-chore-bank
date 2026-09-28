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

### SESSION CLOSE CHECK — REJECTION NOTE

Before every deploy, verify RejectModal in Dashboard.tsx:
1. Reject button does NOT have disabled={!note.trim()}
2. Label reads 'Add a note (optional)'
3. No nag block present

This has regressed twice (after Session A dashboard rewrite and again on
2026-09-28). It must be checked at session end the same way balances are
checked. If any of the three fail, fix before deploying.

DO NOT CONFUSE IT WITH ITS NEIGHBOURS. The same file holds two decline modals
that DO require a note, deliberately: DeclineRequestModal (chore requests) and
the loan-request decline. Both carry `disabled={!note.trim()}` and a nag line
by design — a child who asked for MORE work or for a loan is owed a reason.
Check the component NAMED RejectModal, not the first `disabled={!note.trim()}`
a grep finds. (Diagnosed 2026-09-28: RejectModal at HEAD already met all
three conditions; the required-note modals nearby are the likely source of
the report.)

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
   NARROWED 2026-09-10, STILL NOT FIXED. Two things changed, and the
   distinction between them matters. (a) The read is now DEFERRED: it fires
   only when a child expands Transaction History, so a normal My Bank load
   issues neither select -- verified live, chore_assignments does not appear in
   the load's requests at all. (b) The BALANCE CARD no longer rides on it. It
   used to read `getTransactionHistory()[0].runningBalance`, so the single
   largest figure on the screen was a client-side sum of a silently-capped
   read; it now reads family_members.balance via getMemberBalance(). The BOUND
   IS STILL ABSENT -- under "All" both selects are as unbounded as they ever
   were, and the running balance shown there is still a best effort over
   whatever PostgREST returns. What has gone is the blast radius: a truncated
   ledger is now a wrong LIST under one filter, not a wrong BALANCE on every
   load. Measured 2026-09-10: POCO's ledger is 127 rows, well inside the cap,
   and its running total agrees with his balance at $8.32.
   CLOSED 2026-09-21. Two-tier fetch with both selects ordered DESC under
   an explicit LEDGER_CAP (500), a horizon trim when either select fills
   its cap, and the running balance anchored to family_members.balance
   and walked BACKWARDS. See "SHIPPED 2026-09-21" below for the mechanism
   and why the anchor direction is the important part. All five instances
   of the class are now fixed or prevented.

TRUNCATION CLASS -- PREVENTED BY DESIGN (getApprovalQueue) [2026-09-07]:
The merged approval queue uses two independent reads (getPendingApprovals +
getChoreRequests) composed in memory, never one .in('status',[...]) query. A
single query would put money-bearing completed rows and non-money requested
rows under one row cap where a request backlog could silently evict completed
chores -- verbatim the getMemberInstances failure pattern. This is the fifth
instance of the truncation class, prevented by design rather than fixed after
the fact.

Two supporting notes. getPendingApprovals gained .limit(500) in the same pass;
it was the last unbounded read on the parent path, and while 'completed' is
transient by construction and 500 is nowhere near a realistic ceiling, the
standing rule admits no exceptions -- an invisible server-side cap is worse
than a stated one. And the merge is what makes the dashboard's count and list
the SAME array, which is a correctness property, not a layout one: the old
screen derived the headline figure from a stat card that counted requests and
the list from a read that did not, so with 25 requests outstanding it rendered
"PENDING APPROVALS 25" directly above "All caught up -- nothing to approve."
Measured live on 2026-09-07. Two sources of truth cannot be styled into
agreement; one array makes that state unrenderable.

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

## Weekly and monthly scheduling — generation logic

nextDueDate() in choreService decides WHEN a template's next instance falls due,
or returns null to skip this pass.

  once     -> end of today, generated exactly once ever
  daily    -> end of today
  weekly   + recurrence_dow  -> weeklyDueDate(): this week's occurrence of that
              weekday, at end of day; NULL once that day has passed
  monthly  + recurrence_week + recurrence_dow -> monthlyDueDate(): this month's
              Nth occurrence of that weekday, at end of day; NULL once passed
  anything unpinned -> end of its period (unchanged, pre-existing behaviour)

GENERATED ON ANY PASS IN THE PERIOD, DATED TO THE PINNED DAY. Deliberately NOT
"only generate if today IS the pinned day". Generation is PARENT-DASHBOARD ONLY
and rate-limited, so a day-gated rule would mean that if no parent opened the
dashboard on Wednesday, a Wednesday chore silently never generated that week —
no error, no row, nothing to notice. Generating on any pass during the period
means Monday, Tuesday or Wednesday all produce it, due end of Wednesday.

NULL WHEN PASSED, NEVER ROLLED FORWARD. Both pinned helpers return null rather
than next period's date. Rolling forward would leave a pending instance on the
child's dashboard for up to a full month showing a due date weeks away —
isActionable() treats a future-dated pending row as live. The opportunity window
closed; a new one opens next period, exactly as a missed weekly chore behaves.

nthWeekdayOfMonth() anchors at NOON before endOfDay() reads the civil date back
off it. A DST transition can move local midnight; noon is never within an hour
of one, so the date cannot slip a day. All date maths goes through lib/time and
resolves in the FAMILY's zone — no timezone literal is introduced.

DEDUP IS UNCHANGED AND NEEDED NO CHANGE. periodWindow(freq, due) returns the
calendar month containing a monthly chore's due date, so a 2nd-Wednesday chore
dedupes against the whole month exactly as an end-of-month chore always did.
idx_ca_daily_dedup buckets by the local day of due_date, and every instance of
one template in a period shares one due_date, so concurrent passes still
collide into one row. NOTE the division of labour: the index is scoped to
pending/in_progress, so once a chore is completed or approved the row LEAVES the
index — the client-side existence check, which reads with NO status filter, is
what stops mid-period regeneration. Both layers are load-bearing, in opposite
directions.

VERIFIED LIVE 2026-09-04 (a Friday): a weekly chore pinned to Wednesday produced
ZERO instances (Wed Sept 2 had passed), and a monthly chore pinned to the 2nd
Wednesday produced exactly ONE, due 2026-09-09 23:59:59.999 America/Chicago
(2026-09-10 04:59:59.999 UTC) — confirmed by Postgres to be a Wednesday.

### formatFrequency() — the single source of truth for frequency display

choreService exports formatFrequency(frequency, recurrence_dow, recurrence_week).
Every place the app prints a frequency goes through it: roster list, chore
library, claim library, child chore cards, the child Chores tab, Quick Add, and
the parent request pill. NO component formats a frequency itself — a grep for
`.frequency}` in src/ returns nothing, and that is the check to re-run.

  unpinned                    -> "Daily" / "Weekly" / "Monthly" / "Once"
  weekly + dow                -> "Weekly — Wed"
  monthly + week + dow        -> "Monthly — 2nd Wed"

An INSTANCE row carries no pin — only the template does — so child-facing chore
cards render the bare frequency. That is correct rather than a gap: the card
already shows a concrete due date, and reading the pin there would cost a join
on the most-opened screen in the app, which the child dashboard query budget
forbids.

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
- chore_assignments.recurrence_week — smallint 1..4, added 2026-09-04. Pins a
  MONTHLY chore to an Nth weekday, paired with recurrence_dow: week=2, dow=3 is
  the 2nd Wednesday. Null = unpinned (weekly chores, and monthly chores due end
  of month). Only meaningful on template rows.
  TWO EXPLICIT COLUMNS, NOT AN ENCODING. The alternative considered was packing
  both into recurrence_dow as (week * 10) + day. It was rejected because it is
  NOT schema-change-free as it first appears: the live
  chore_assignments_recurrence_dow_check caps that column at 6, so storing 23
  would have meant dropping a constraint and permanently losing its ability to
  validate a weekday — while also making the column's meaning conditional on
  chores.frequency, a column in a DIFFERENT table.
  THE 1-4 CAP IS ARITHMETIC, NOT CONVENTION. Every month has at least 28 days,
  and 1 + 6 + (4-1)*7 = 28, so the 4th occurrence of any weekday always exists.
  A 5th does not reliably exist — September 2026 has five Wednesdays
  (2, 9, 16, 23, 30) but most months do not — so allowing week=5 would silently
  skip generation in most months. The constraint prevents that class of silent
  omission. Do not widen it to 5 without adding a "last weekday" fallback.
  MIRRORED onto chore_assignments_archive and both column lists inside
  archive_old_assignments(), per the mirror invariant in the archive section.
- chore_assignments.plan_goal_id — uuid FK to milestones(id), added 2026-09-05.
  Links a roster entry to the savings goal a child built it to serve (Goal
  Plan). NULL = an ordinary roster entry. Only meaningful on template rows, and
  buildInstance() deliberately does NOT copy it onto instances. BOTH Phase 6
  choices clear it, so a row that still carries a link is by definition an
  unanswered plan — that is the entire signal retireLapsedPlanChores() uses.
  Mirrored onto chore_assignments_archive and both column lists inside
  archive_old_assignments(), per the mirror invariant. See "SCHEMA FACTS — GOAL
  PLAN" below for the full account.
- SCHEDULE PINS LIVE ON chore_assignments, NOT chores. The same library chore
  can be pinned to Wednesday on one child's roster and Saturday on another's.
  So the schedule picker appears in the chore CREATE modal (which creates the
  roster entries in the same action, so there is exactly one schedule being
  set) and on each ROSTER ROW — never in the library chore EDIT modal, where
  there is no single value to show and saving would overwrite one child's
  schedule with another's. Edit a schedule on the roster row.
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

### SCHEMA FACTS — CLAIM LIBRARY (added 2026-09-03)

Children browse a library and REQUEST chores; parents approve. Built because
Eve's 85-entry roster was a symptom of a missing workflow, not a judgement
error: the only way to make a chore AVAILABLE was to assign it permanently.

'requested' was added to the chore_assignments.status CHECK constraint on
2026-09-03 (migration 20260903203201). Seven values now.

NO INDEX CHANGE WAS NEEDED, and this was verified before the ALTER rather than
assumed. idx_ca_daily_dedup's WHERE clause already carries
`template_id IS NOT NULL`, and a Path 1 request has template_id NULL, so a
claim row never enters that index at either the 'requested' or the approved
'pending' stage. Adding 'requested' to the index predicate would have been dead
code. The coexistence this produces is INTENDED: a child may request a one-off
of a chore that is ALSO on their roster that day, and the two rows must not
collide.

TWO PATHS, ONE STATUS. is_template is the discriminator.

  PATH 1 — "Do this today"
    insert: is_template = false, template_id = NULL, status = 'requested',
            due_date = endOfDay(now) in the FAMILY's zone
    approve: status -> 'pending' AND due_date refreshed
    decline: status -> 'rejected', note required

  PATH 2 — "Add to my regular chores"
    insert: is_template = true, is_active = FALSE, status = 'requested',
            no due_date (templates have none)
    approve: status -> 'pending' AND is_active -> true, IN ONE UPDATE
    decline: status -> 'rejected', is_active STAYS false — the row is
             permanently inert: it can never generate, and getRoster()
             excludes it.

NO NEW TABLE, NO NEW COLUMN. An approved claim becomes an ordinary row, so it
costs exactly what a parent-assigned chore costs. Net new rows per claim beyond
what the system would generate anyway: zero.

#### The Path 2 generator hazard — BELT AND BRACES, both layers intentional

runGeneration() read templates with only `.eq('is_template',true)` and
`.eq('is_active',true)` — NO status filter. A Path 2 request matches both, so a
child tapping "Add to my regulars" would have started generating daily
instances on the NEXT parent-dashboard load, before the parent ever saw the
request. The approval step would have been decorative. getRoster() had the same
gap and would have rendered an unapproved request as a live roster entry with
working pause/delete controls.

TWO INDEPENDENT LAYERS now, and neither is redundant:
  1. is_active = false at insert (excluded by the existing is_active filter)
  2. explicit `.neq('status','requested')` on runGeneration()'s template read
     AND on getRoster()

Layer 2 is the load-bearing one per the rule in this file — every read of this
table states its status filter rather than trusting another column to imply it.
Layer 1 survives someone flipping is_active for an unrelated reason.

VERIFIED LIVE 2026-09-03: with an unapproved Path 2 row present, a parent
dashboard load ran generateDailyAssignments() and produced 0 instances for it.
This was the highest-value check in the session — the whole feature is
decorative if it fails.

#### getClaimableChores() — four doors, ALL per-child

Four reads in one Promise.all:

  Door 1  getFamilyChores() — excludes RESERVED_CHORE_CATEGORIES and archived.
          The single library door, so a new marker category added to that
          constant is excluded here automatically.
  Door 2  the child's ACTIVE roster (is_template = true, is_active = true).
          Paused entries deliberately NOT excluded — if Eve took a chore off a
          child, they may still ask to do it once, and that request is exactly
          the signal she needs.
  Door 3  the child's outstanding requests, either path (status = 'requested').
          Not windowed to today: 'requested' is transient, and matching on the
          status stops a child stacking a second request on one a parent has
          not answered.
  Door 4  the child's LIVE one-off claims (is_template = false,
          template_id IS NULL, status IN pending/in_progress/completed,
          due_date >= start of today). Stops a chore appearing as "available"
          while it sits on the child's own list.

`.is('template_id', null)`, NEVER `.eq('template_id', null)`. PostgREST reads
eq.null as an equality test against a value rather than a NULL test, so the eq
form matches nothing and door 4 silently stands open — a bug that looks exactly
like the filter having no effect.

Door 4's template_id predicate makes it Path-1-only. It matters in the PAUSED
roster case specifically: when a chore is paused, door 2 stops excluding it, and
the paused entry's leftover live instances must not block a fresh claim.

A CHILD CANNOT ONE-OFF CLAIM A CHORE ON THEIR OWN ACTIVE ROSTER — door 2
removes it from the library entirely. The roster instance is the correct vehicle
for that day's work. Paused roster chores DO appear, since door 4 tracks
one-offs separately.

TRUNCATION SAFETY. Neither chore_assignments read touches the growing part of
the table: door 2 is bounded by is_template (roster size), doors 3 and 4 by
transient statuses plus a date floor. Instance rows — the ~51/day behind all
four prior truncation bugs — cannot compete for either read's rows. The 500
limits are payload guards, not the correctness mechanism.

PER-CHILD ISOLATION — COVERAGE GAP, recorded honestly. The per-child isolation
of door 4 is verified BY CONSTRUCTION: the `.eq('assigned_to', memberId)`
filter is per-child by definition. Direct observation was not possible in the
2026-09-03 verification session because POCO's only live one-off (Clean TV Room)
was ALSO on Cuddles' active roster, so her view excluded it via door 2 rather
than door 4. The filtering logic is sound; that specific path is proven by code
inspection, not by data. Isolation itself WAS observed on another chore: POCO
held a rejected roster request on "Clean Personal Area at Table" and it appeared
freely claimable to Cuddles, with category counts diverging 32 vs 33.

#### Path 1 approval always refreshes due_date

approveChoreRequest() sets due_date = endOfDay(approvalDate) in the family's
timezone, unconditionally, on the Path 1 branch.

This is NOT cosmetic. createOneTimeRequest stamps the end of the day the child
asked. A 'requested' row survives the night safely — expireLapsedAssignments()
filters is_template = false AND status IN ('pending','in_progress'), so the
sweep cannot see it. But the moment approval sets status = 'pending' with
yesterday's timestamp still on it, isLapsed() is true, ChoreCard stops offering
Complete, and the next generation pass expires the row outright. The child would
watch an approved chore arrive dead.

UNVERIFIABLE ON SAME-DAY APPROVAL, since the refreshed value is identical to the
original. The refresh exists for overnight approvals — a child requests Tuesday
evening, a parent approves Wednesday morning, the chore is valid for Wednesday
not Tuesday. Verified by code inspection, not by data observation.

#### Requests never auto-expire

expireLapsedAssignments() filters is_template = false AND status IN
('pending','in_progress'), so a 'requested' row is invisible to the sweep. A
request made in good faith stays live until a parent actually answers it.

#### Approved claims are structurally identical to assigned chores

Once approved, a Path 1 claim IS an ordinary pending instance row. ChoreCard
renders it identically to any parent-assigned chore by design — the origin of
the assignment is irrelevant to the work and the reward. ChoreCard has no branch
on is_template or on who created the row, so this is structural rather than
styled. The book's system does not care whether a parent or a child initiated
the work.

The same applies to a DECLINED roster request in "Recent misses": it renders
with the same NOT APPROVED pill and note block as a rejected regular chore.

#### Declined roster requests need their own read

getRejectedSince() filters is_template = false and bounds on due_date. A
declined ROSTER request is a TEMPLATE row with NO due_date, so it matches
neither predicate. Without a second read the parent's note would exist in the
database and appear on NO child screen anywhere — the child asked to take on
more work, was turned down, and would never be told why.

getDeclinedRosterRequestsSince() covers it, bounded on created_at because a
template row has no due_date and this table has no updated_at column. created_at
is when the child ASKED, not when the parent answered, so a request left
unanswered longer than the 14-day window drops out of view even if declined
today. That is the honest limit of the available columns; closing it would mean
a schema change for a display detail.

The child Chores tab's inFilterWindow() additionally treats is_template rows as
always in-window. A template row has no due_date, so every date filter would
otherwise drop it and the decline would surface only under "All".

#### getChoreUsage() — known behaviour, not a bug

getChoreUsage() counts is_template rows with no status filter. A pending Path 2
roster request inflates the usage count and PREVENTS hard deletion of the source
library chore. This fails safe — a parent must decline the request before
deleting the chore. Unintentional, but correct.

## Dev-environment artifacts (not production bugs)

- HMR WEDGE ON "Switch user" (observed 2026-09-01). After editing a component,
  Vite's hot reload can leave the app in a state where the Switch user control
  stops responding and only a full page reload recovers it. Verified afterwards
  on clean loads: it works on one click from the parent layout (twice) and from
  a child session (POCO). ChildLayout and useAuth.exitToPicker were never
  touched by the goals work. Production has no HMR, so this cannot occur there.
  Do not go hunting for a Switch user regression on the strength of a dev
  session — reload first and re-test before investigating.

- SWITCH USER FIRST CLICK, occasionally (observed 2026-09-03). The Switch user
  control sometimes needs a second tap when the page is still settling after a
  navigation; the second always fires. DISTINCT from the modal backdrop bug,
  which is fixed — no modal was open on the occasions observed. Root cause
  unknown, possibly focus capture during a React re-render. Low priority and
  consistent with the dev-only HMR pattern above. Do not investigate on the
  strength of a dev session.

## Kiosk rules
- All touch targets minimum 64px, EXCEPT parent-facing actions that repeat down
  a list, which use Button `size="lgResponsive"` — `h-11` (44px, the
  Apple/Google minimum) on a phone and `h-16` (64px) from `md:` up. Applied
  2026-09-04 to the three approval buttons (Full Credit / Half / No Credit):
  three stacked 64px buttons per row cost a third of a phone screen, which is
  how the approvals queue read on Eve's phone. The wall tablet is md and above,
  so the kiosk is unaffected. Verified 44px at 375px, 64px at 1920px.
  It is a Button SIZE rather than a className override because cn() is a plain
  join with no tailwind-merge — passing `h-11` alongside `min-h-touch` leaves
  both in the class list and stylesheet order decides, not the caller.
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

## FIXED 2026-09-03 — modal backdrop swallowed the first click after close

The shared Modal ate the first tap on anything underneath it for ~150ms after
closing. Reproduced three times during the loan session (Run Monthly Deductions,
Forgive) and three more times on the claim screen, where it was far worse.

THE CULPRIT WAS NOT THE BACKDROP, despite the name this bug carried for a month.
`<div className="absolute inset-0 bg-deep/80" onClick={onClose} />` is the
obvious suspect because it holds the dismiss handler, but the element actually
swallowing taps is the ROOT `motion.div` — `fixed inset-0 z-50`. A full-screen
positioned div is a hit target whether or not it has an onClick, and
AnimatePresence keeps the entire subtree mounted for the whole exit animation.
Putting `pointer-events: none` on the backdrop alone would have changed nothing.

THE FIX, in src/components/ui/Modal.tsx:

    animate={{ opacity: 1, pointerEvents: 'auto' }}
    exit={{ opacity: 0, pointerEvents: 'none' }}

On the root, so the whole subtree inherits it and the dialog also stops taking
clicks while it leaves. `pointerEvents` is not an animatable value, so
framer-motion applies it at the INSTANT exit begins rather than easing it —
which is the semantics needed: dead the moment the close starts, not 150ms later.

WHY IT WAS PROMOTED OFF THE PRE-LAUNCH LIST. The claim library made it the
primary interaction loop rather than an occasional annoyance: browse -> tap
chore -> submit -> tap next chore hits the dead window on EVERY iteration. A
child who taps and sees nothing concludes the app is broken, on the one screen
whose entire purpose is inviting them to choose more work.

VERIFYING THIS CLASS OF BUG — the trap that cost a cycle here. An automated
click fired immediately after a submit lands while the request is still in
flight and the modal is therefore still OPEN, so it hits the dialog and proves
nothing. The valid sequence is: submit -> confirm the modal is GONE -> single
tap -> assert it registered. Test with a target OUTSIDE the dialog's footprint
(the bottom nav is ideal); a target underneath the dialog box cannot distinguish
"swallowed by the exit overlay" from "hit the still-open dialog".

## Known layout traps

### SHRINK-0 TRAP — any component in a `flex flex-col` overflow container

Any card or component placed in a `flex flex-col` container that overflows MUST
carry `shrink-0` on its ROOT element, or it is silently squashed toward zero
height. No error, no warning, no console message — it simply renders wrong, or
not at all.

TWO EVIDENCED INSTANCES:
1. Child dashboard left column cards (2026-09-02) — CharacterMomentBanner
   rendered as a ~30px sliver with its headline sliced through the middle.
2. SchedulePicker in the chore create modal (2026-09-04) — the modal body is
   `flex max-h-[70vh] flex-col overflow-y-auto`, and the picker's wrapper
   computed to height 0 while its inline style still read `height: auto`. The
   seven day pills existed at full size and were clipped to nothing, so a
   REQUIRED form control was invisible while its validation message and Save
   gating both worked correctly — the bug was undetectable from state alone.

RULE: when adding a new component to a `flex flex-col` scroll container, put
`shrink-0` on its root as the FIRST thing, not after discovering it is
invisible. It belongs on the component's own root when the component is the
flex child — putting it on an inner wrapper does nothing.

### HEIGHT ANIMATION TRAP — never let an animation own the resting state

framer-motion `height: 0 -> auto` animations may never advance in a backgrounded
tab, because Chrome throttles requestAnimationFrame there. The element then
stays permanently collapsed with its inline style reading `height: 0px`, which
for a required control means it is simply missing.

Use a CSS `grid-template-rows: 0fr -> 1fr` transition instead. `1fr` is the
plain, cascade-applied resting state, so the control is OPEN even if the
transition never runs; the animation becomes progressive enhancement rather than
the thing that produces a correct layout. The collapsed child needs
`overflow-hidden` for the fr row to clip it, and its focusable elements must be
`disabled` while collapsed so they stay out of the tab order.

Applied 2026-09-04 in src/components/shared/SchedulePicker.tsx, which no longer
imports framer-motion at all.

RULE: any animation whose RESTING state is "hidden" or "collapsed" is only
correct when the animation actually runs. Invert it so the correct state is the
default.

### VERIFICATION — getComputedStyle lies in a backgrounded tab

In a backgrounded tab getComputedStyle() returns STALE values. During the
2026-09-04 session it reported a selected pill's background as transparent and
its text as muted grey, while a screenshot of the same element showed it
correctly filled antique gold with dark text — nearly costing a cycle chasing a
CSS specificity bug that did not exist.

SCREENSHOTS ARE THE RELIABLE SIGNAL for visual verification. Do not chase a CSS
bug on the strength of computed-style readings from a tab that has been in the
background. Check `document.hidden` before trusting any computed style. The same
caveat applies to elements captured into a variable across a React re-render —
a detached node returns default computed values.

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
  DONE 2026-09-21 — see BUNDLE CODE-SPLITTING below. Framer Motion could NOT
  be split out: PinPad renders inside Modal, which animates with it, so it is
  a first-screen dependency by construction.

- ROSTER SIZE: 85 active chores across two children producing 19-28% completion
  rates. Book recommends 3-5 chores per child to start. Review and pause
  non-essential roster entries before public launch or onboarding new families
  with default templates.
  Measured 2026-09-02 via the Family Week System Health section: 56 of 85 active
  roster entries had NO completion that week. The screen was built to surface
  exactly this, and the first thing it surfaced was that the roster is too large
  for the children's current stage -- the book's "Kitchen Sink" warning, live.
  UPDATE 2026-09-03: the claim library shipped, which is the MECHANISM that
  makes a small roster workable — but the roster itself is still 85 entries.
  Shipping the feature did not reduce it. See "ROSTER MANAGEMENT" below for the
  recommended reduction.
  DONE 2026-09-04: Eve performed the reduction. The roster is now 16 ACTIVE
  entries across both children (132 paused), down from 85. Pausing rather than
  deleting kept every generated instance and left the paused chores claimable,
  which is exactly the intended end state. This checklist item is CLOSED;
  re-read Family Week System Health to measure the effect.

- TRUNCATION CLASS INSTANCE 5 — getTransactionHistory (child My Bank ledger)
  still issues two UNBOUNDED selects and derives the running balance from the
  merged result. It needs the same treatment the other four instances got:
  server-side aggregates for any figure, and an explicit bound (date window or
  pagination) for the displayed list. Left alone on 2026-09-02 because it is
  display-only and the fix is a product decision about how much history a
  child's ledger should show, not a one-line bound. The MONTH FIGURES above it
  no longer depend on it. Fix before public launch.
  STILL OPEN after 2026-09-10, but smaller: the read is deferred to first
  expand and the balance card no longer derives from it (see the narrowed note
  under TRUNCATION CLASS INSTANCE 5 above). The unbounded selects themselves
  are untouched. The remaining decision is the same one: how much history a
  child's ledger should show. Note the date filter now shipped gives that
  decision a natural shape -- three of its four ranges are already windows, so
  bounding the read per range is a smaller change than it was.
  CLOSED 2026-09-21 — see the truncation-class note above and "SHIPPED
  2026-09-21". Removed from the pre-launch list.

- BUNDLE CODE-SPLITTING — DONE 2026-09-21. Route-level React.lazy for all
  nine pages behind the PIN plus stable vendor chunks. Initial load 1,150 kB
  -> 537 kB (321 -> 164 kB gzip). See "SHIPPED 2026-09-21". The first item
  in this list (bundle size) is CLOSED; the 500 kB Vite warning is gone.

- CHILD DASHBOARD QUERY BUDGET: 2 reads, as of the loan session. The completion
  rate read (getInstancesDueBetween) was REMOVED and the loan state read
  replaced it, so adding loans cost the most-opened screen in the app nothing.
  getChildLoanState() answers both "is there an active loan" and "was one
  resolved in the last 48h" in one OR-filtered query, each half bounded — one by
  status, one by date.
  RULE: any future addition to the child dashboard must either replace an
  existing read or justify the addition explicitly.

- PARENT DASHBOARD READ COUNT: 2 reads, as of the Session A redesign
  [2026-09-07]. It was 8 parallel reads after a serial
  generateDailyAssignments(); it is now getApprovalQueue(), which composes
  getPendingApprovals + getChoreRequests in memory (see the truncation-class
  note above for why that is two reads and not one).
  Quick Add's three reads — getFamilyChores, getFamilyExpenses, getRoster —
  are now DEFERRED until the parent taps +, so a parent who only ever approves
  chores never pays for them at all. getFamilyChildSummaries, getFamilyGoals
  and getRecentExpenseApplications were deleted outright along with the
  sections they fed (the Children cards, the goal progress bars, and the
  "Expenses applied" stat).
  RULE: any future addition to the parent dashboard must either replace an
  existing read or justify the addition explicitly — the same rule as the
  child dashboard above. The most-opened parent screen must not be the most
  expensive screen in the app.

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

- TIMEZONE RECONCILIATION — RESOLVED 2026-09-03 (Option A: dynamic, read from
  families.timezone). Left here rather than deleted because the failure mode it
  describes is the reason the current design looks the way it does.
  families.timezone was 'UTC' and read by nothing; it now holds
  'America/Chicago' for this family and is the SINGLE SOURCE OF TRUTH for every
  date boundary in the app. A family in California and a family in Texas both
  get correct boundaries with no code change.
  ALL FOUR AFFECTED LOCATIONS — three converted, one permanent exception:
   1. idx_ca_daily_dedup — NOT CONVERTED. See "The one permanent hardcode"
      below. This is deliberate and documented on the index itself.
   2. member_approved_day_counts() — CONVERTED. Joins family_members ->
      families for the zone. COALESCE to 'UTC' is a fail-safe, not the intent:
      AT TIME ZONE NULL returns NULL, which would collapse every approved chore
      into one NULL day row and silently zero a child's streak.
   3. process_loan_payments() — CONVERTED, and the zone is resolved PER LOAN
      inside the loop, not once per run. This function processes every family's
      active loans in one pass, so a single zone computed up front would charge
      a Pacific family on Central's calendar — near a month boundary that is a
      payment taken in the wrong month, which the duplicate check would then
      honour for the rest of that month. The loop's FOR UPDATE became
      FOR UPDATE OF l so the joined families row is not locked, which would
      otherwise block a parent saving a timezone in Settings.
   4. The CLIENT — CONVERTED to src/lib/time.ts. Every setHours(0,0,0,0),
      getDay() and new Date(y, m, d) in src/ is gone; a grep for them outside
      lib/time.ts returns nothing, and that is the check to re-run after any
      future date work.
  The measurement that motivated it, kept for the lesson: on 2026-09-03 a
  14-day rejected-chore window returned 24 rows from the app and 29 from a
  `current_date - interval '14 days'` query, because SQL resolved midnight in
  UTC and the client in Chicago. Five rows sat in the 5-hour gap. Neither was
  wrong — they answered different questions. ANY verification query must still
  match the family's zone before its result can be compared to a screen.

### src/lib/time.ts — how the client reads the zone

NO DATE LIBRARY. date-fns-tz would have been ~20 kB gzipped on a bundle already
over the Vite warning threshold, for eight functions. Everything is built on
Intl.DateTimeFormat with an explicit timeZone, which every browser this kiosk
runs on supports. Formatters are cached per zone because construction dominates
their cost and the streak paths call one per approved row.

THE MODULE-LEVEL ACTIVE ZONE is the part to understand before changing
anything. Service files are plain functions and cannot read React context, so
lib/time holds the zone in module state and AuthProvider calls
setActiveTimeZone(family.timezone) inside loadContext — BEFORE any state that
renders a screen, because services read the zone at call time and the first
query fires as soon as a screen mounts. Every helper still accepts an explicit
tz, so a caller or a test can override it. One family per kiosk session is what
makes module state the honest shape here; if the app ever serves two families
at once, this is the thing that has to change first.

The default before the family loads is the BROWSER's zone, not UTC. That is
deliberate: it is exactly what the app did before this change, so boot is
unchanged and a failed family fetch degrades to the old behaviour rather than
to a zone nobody lives in.

Components read useFamilyTimezone() (or timezone / saveTimezone off useAuth).
DO NOT name a timezone literally anywhere in src/ — the one legal literal in
the whole codebase is the US_TIMEZONES picker list.

DISPLAY MUST MATCH THE BOUNDARY. formatDateInZone / formatTimeInZone exist
because a boundary computed in the family's zone and printed with a bare
toLocaleDateString() renders in the TABLET's zone. Same instant, wrong day
name: a kiosk west of the family would title Family Week "Sun 31 – Sat 6" over
Monday-to-Sunday figures. Every date the app prints now goes through these.

STREAK DAYS ARE 'YYYY-MM-DD' STRINGS, not timestamps — Set<string>, not
Set<number>. This fixed a REAL LATENT BUG found during the conversion:
computeLongestStreak compared adjacency with days[i] - days[i-1] === DAY, i.e.
exactly 86,400,000 ms. A civil day is 23 or 25 hours across a DST transition,
so every streak spanning the March or November change was silently cut short.
addDays exists for the same reason and must be used instead of
`+ n * 86_400_000` anywhere a calendar day is meant. Verified with 31
assertions covering spring-forward (a 23h day), fall-back (25h), Arizona (no
DST), cross-zone day boundaries, and Monday week starts in all seven offered
zones.

member_approved_day_counts() returns 'YYYY-MM-DD' and the client now KEEPS that
string. It used to convert it back through new Date(y, m-1, d) — forcing a day
the server had already bucketed in the family's zone through the browser's.
Both sides speak civil days now, so no conversion happens at all.

### The one permanent hardcode — idx_ca_daily_dedup

The index keeps AT TIME ZONE 'America/Chicago'. It cannot be made dynamic: an
index expression must be IMMUTABLE, and a subquery against families is not.
Making it possible would mean denormalising the zone onto chore_assignments or
adding a generated local-day column, and that complexity is not worth the
benefit.

WHY IT IS ACCEPTABLE: the dedup index boundary shifts by at most one hour at
DST transitions and by the timezone offset for non-Central families. This
affects WHEN the daily dedup window resets, not WHETHER deduplication works.
Idempotency is preserved regardless of timezone offset — the expression is
still one fixed 24-hour bucket per (template_id, assigned_to), so two instances
of the same template for the same child on the same local day still collide at
any offset.

DO NOT attempt to replace it with a trigger or a computed column. The exception
is recorded three places so it cannot be mistaken for an oversight: this file,
the index's own migration file, and a COMMENT ON INDEX in the database.

### Family timezone in Settings

Parent Settings has a "Family timezone" section: a seven-entry dropdown
(Eastern, Central, Mountain, Arizona (no DST), Pacific, Alaska, Hawaii), the
stored value pre-selected, Save shown only once the selection differs. Saving
writes families.timezone and re-points both halves of the source of truth — the
module zone services read, and the React state screens re-render from — so date
calculations update immediately with no reload.

US only, deliberately: the full IANA list is ~600 entries and a scrolling wall
on a tablet, and the V1 market is US families. Nothing downstream cares — every
consumer takes an arbitrary IANA string — so a family whose stored zone is not
in the list still works, and the picker adds that value rather than silently
re-selecting a neighbour. Arizona is listed separately because it does not
observe DST, the one case where "Mountain" is wrong half the year.

updateFamilyTimezone() validates against Intl before writing. An unrecognised
zone raises invalid_value inside process_loan_payments() mid-transaction, so
rejecting it at the door keeps that failure out of the money path.

### Onboarding — auto-detect (SIGNUP SPEC NOTE)

There is no signup flow yet. When one is built it MUST populate
families.timezone at family creation from
Intl.DateTimeFormat().resolvedOptions().timeZone — exported as
detectBrowserTimeZone() in lib/time and already used as the pre-load default.
Parents can change it in Settings afterwards; the detection is just a sensible
default so no family is silently created in the wrong zone. For families that
already exist, the Settings selector is the mechanism.

## SHIPPED 2026-09-03 — Available chores to claim

DONE. Both paths built, verified 27/27 against live family data, and deployed.
See "SCHEMA FACTS — CLAIM LIBRARY" above for the mechanism, the two-layer
generator guard, the four doors of getClaimableChores(), and the recorded
coverage gap.

The original motivation, kept because it is the lesson: Eve over-assigned the
roster (85 entries) because the kids had no way to self-select chores and kept
asking her to assign them manually. The roster size was a symptom of a MISSING
WORKFLOW, not a judgement error — and the Family Week System Health screen
surfaced it before anyone named it (56 of 85 active entries had no completion in
a week).

### ROSTER MANAGEMENT — the follow-up this feature enables

The claim library is live, but THE ROSTER HAS NOT BEEN REDUCED YET. Shipping the
mechanism does not by itself fix the 85 entries; that is a deliberate act
someone has to perform.

RECOMMENDED APPROACH: cut each child's roster to a mandatory core of 5-8 entries
— daily routine, hygiene, and the household chores actually assigned to them —
and move everything else into the library as claimable. Children browse and
request; parents approve. Eve is no longer the bottleneck between a motivated
child and a chore.

Pause roster entries rather than deleting them (setRosterEntryActive(false)):
pausing is reversible and keeps every instance already generated, while deleting
a template is permanent. Paused chores still appear in the claim library, which
is exactly the behaviour wanted here — a chore comes off the mandatory list and
becomes something a child can choose.

Re-read the Family Week System Health section afterwards; it is the instrument
that measures whether the reduction worked.

## SHIPPED 2026-09-04 — weekly and monthly day-of-week scheduling

Weekly day-of-week pinning already EXISTED in the generator (weeklyDueDate) but
was reachable only from a <select> on the roster row — never from the chore
create modal. Monthly had no pinning at all: nextDueDate had no monthly branch
and fell through to end-of-month, reading recurrence_dow but ignoring it.

Shipped: recurrence_week column, monthlyDueDate/nthWeekdayOfMonth, one shared
SchedulePicker replacing BOTH old <select> pickers, formatFrequency as the
single display source of truth, and responsive approval buttons. Verified 14/14
against live family data; both test chores removed afterwards and
chore_assignments returned to its exact pre-session count of 1,786 rows.

Migrations: 20260904123546_add_recurrence_week_to_chore_assignments,
20260904124019_mirror_recurrence_week_onto_assignments_archive.

## SHIPPED 2026-09-05 — Goal Plan, and three recognitions

Two features, 34/34 checks verified against live family data. Balances opened
and closed at POCO $11.92 / Cuddles $14.00 with $0.00 ledger variance on both.

### SCHEMA FACTS — GOAL PLAN (added 2026-09-05)

A Goal Plan is a set of roster entries a child chose in order to reach their
savings goal faster. THE WHOLE FEATURE IS ONE NULLABLE COLUMN:

    chore_assignments.plan_goal_id uuid REFERENCES milestones(id) ON DELETE SET NULL

NO goal_plans TABLE, AND THE REJECTION IS THE DESIGN. The proposed table carried
weekly_target, target_weeks, status and completed_at. Six of its eight columns
were either derivable from rows already read or a second copy of something
milestones already stores:

    weekly_target -> SUM of the plan chores' weekly value, computed at read time
    target_weeks  -> ceil(needed / rate), computed at read time
    status        -> milestones.status; a plan's life IS its goal's life
    completed_at  -> milestones.achieved_at
    member_id     -> chore_assignments.assigned_to
    family_id     -> derivable via the chore or the member

Storing the first two would have been ACTIVELY WRONG, not merely redundant. A
parent may pause or delete a plan chore at any time — the feature explicitly
permits it — and a stored weekly_target has no way to notice, so the child would
read a total that no longer matched the chores under it. Same doctrine as
"PROGRESS IS NEVER STORED" for goals.

ONE ACTIVE PLAN PER CHILD COMES FREE. idx_milestones_one_active_goal already
guarantees one active goal per child and a plan hangs off a goal, so there is no
new partial unique index and no 23505 to translate — unlike goalService and
loanService, which each needed both.

Migrations: 20260905182252_add_plan_goal_id_to_chore_assignments,
20260905182302_mirror_plan_goal_id_in_archive_old_assignments.
The archive mirror is not optional — archive_old_assignments() moves rows with
explicit column lists and fails at runtime on a count mismatch (16 -> 17).

#### THE SIGNAL: linked = unanswered, cleared = resolved

BOTH Phase 6 choices clear plan_goal_id. "Keep my plan chores" clears it and
leaves the rows ACTIVE (they become ordinary permanent roster entries); "I'm
done with these chores" clears it and sets is_active = false (a reused template
lands back exactly where the parent left it — paused).

THIS IS WHAT MAKES THE 7-DAY SWEEP WORK WITHOUT A NEW COLUMN. A row that STILL
CARRIES A LINK is, by definition, a plan nobody has answered yet.
retireLapsedPlanChores() needs no other signal to tell "the child chose" from
"the child has not chosen", and no boolean is stored anywhere to say so.

DO NOT "FIX" THIS BY RETAINING THE LINK FOR HISTORY. It was proposed twice
during the build and rejected both times. Retaining it would make the sweep
unable to distinguish the two states, and it would keep re-deactivating
already-retired rows.

#### retireLapsedPlanChores() — lives in choreService, runs in runGeneration

Called from runGeneration() immediately after expireLapsedAssignments() and
BEFORE the template read, so a pass cannot generate one more day of instances
for a plan that is already over. Handles two cases: a goal achieved more than
PLAN_CHOICE_GRACE_DAYS (7) ago, and any abandoned goal (a backstop — abandonGoal
retires the plan immediately, because abandonment is a deliberate act and not a
timeout).

KEYED ON milestones.achieved_at, NEVER on when the plan was built. Plan age
would fire the instant a goal built more than a week earlier was reached,
killing the chores before the child ever saw the celebration.

IT DOES NOT RUN ON THE CHILD DASHBOARD, deliberately. That screen has a
documented 2-read budget and detecting a lapsed plan needs a read getActiveGoal
does not make. Generation is what would otherwise keep creating these instances,
so standing them down is that pass's own business.

PLAN_CHOICE_GRACE_DAYS is declared in choreService and RE-EXPORTED by
planService. One declaration only — planService already imports weeklyValueOf
from choreService, so declaring it there instead would make a cycle.

#### lockInPlan() — three cases, and paused-template reuse is the dominant one

One bounded lookup for the whole selection (is_template + IN, so it reads roster
rows only and never competes with instance history), then:

    paused template exists -> REUSE it (is_active = true, plan_goal_id set)
    active template exists -> SKIP entirely
    nothing exists         -> INSERT a fresh template

REUSE IS THE NORMAL PATH FOR ANY FAMILY THAT HAS DONE A ROSTER REDUCTION, and
this one has. After Eve's 2026-09-04 reduction POCO held 67 paused templates
against 6 active, and getClaimableChores() does not exclude paused entries — so
the claim library the builder reads is mostly his own paused rows.

MEASURED LIVE 2026-09-05, locking in three chores:
  POCO templates      73 -> 73   (ZERO new rows)
  whole table       1802 -> 1802 (ZERO new rows)
  active templates     6 -> 9
The three template_ids after lock-in were byte-identical to the paused rows
recorded before it. A plan can cost nothing at all.

Inserting instead would leave TWO templates for one (chore, child). They carry
different template_ids, so idx_ca_daily_dedup cannot collide them, and the child
would silently receive the chore twice a day if a parent ever un-paused the
original.

THE SKIP CASE is only reachable as a race — door 2 of getClaimableChores
excludes active roster chores, so a parent would have to un-pause one between
the builder opening and the tap. Claiming it anyway would let a later "I'm done"
pause a chore the parent deliberately made mandatory, and it is already earning
toward the same goal.

REUSED ROWS KEEP THEIR ORIGINAL assigned_by. The spec called plan chores
self-initiated, but overwriting would erase the record that a parent first
assigned the chore, and plan_goal_id already marks the row as plan-driven.

NOT TRANSACTIONAL, deliberately: two statements, so a mid-write failure leaves a
PARTIAL plan. Safe here precisely because nothing is stored — the weekly total
is summed from the chores that actually exist, so a partial plan renders a
correct total for itself rather than a stale figure describing chores that were
never created.

INSTANCES DO NOT INHERIT plan_goal_id. buildInstance() copies chore_id,
assigned_to, assigned_by, status, is_template, template_id and due_date only.
The column is meaningful on template rows alone, so ANY verification query
against instances must join through template_id — filtering instances on
plan_goal_id returns zero rows whether or not generation worked.

#### THE RATE DISTINCTION — two rates, both correct, do not reconcile them

    Plan builder     -> (existingWeeklyRate + planWeeklyTotal)
    Progress tracker -> existingWeeklyRate ALONE

getWeeklySavingsRate() filters on `template_id IS NOT NULL`, and a locked-in
plan chore IS a roster template. Its instances therefore enter that average as
soon as they are approved, and nothing in the query distinguishes them from the
child's pre-existing chores — so the plan's contribution cannot be subtracted
back out. Adding planWeeklyTotal in the TRACKER double-counts it, and the
overstatement GROWS as the plan succeeds: the child would repeatedly be told the
goal is nearer than it is.

In the BUILDER the plan chores do not exist yet, so projection is the only
honest option and the existing roster is genuinely additional.

OBSERVED LIVE 2026-09-05, the same plan on two screens: builder "about 2 weeks"
(combined $17.29/wk), tracker "About 3 weeks to go at what you're earning now"
(measured $7.84/wk). Both correct for the question each is answering. The full
note is in goalService above getWeeklySavingsRate.

#### WEEKLY_MULTIPLIER — promoted, and it is load-bearing

A chore's `value` is PER OCCURRENCE, so a $0.25 daily chore is $1.75 a week.
60 of this family's 73 claimable chores are daily. Summing raw values would have
understated a plan by 7x and told a child their goal was 23 weeks away when it
was 3. WEEKLY_MULTIPLIER (daily 7, weekly 1, monthly 0.25, once 0) and
weeklyValueOf() now live in choreService; ChoresTab imports them instead of
keeping its own copy.

#### The celebration reuses GoalAchievedCard — intentional, and better

The spec asked for a full-screen takeover reading "You did it!" / "$35.00
reached". Shipped instead: the EXISTING inline card in the child's left column,
reading "GOAL REACHED" / "New headphones" / "You saved $35.00", with the two
plan buttons added beneath.

Deliberate on both counts. The left column is where the goal lives all the time,
so the celebration belongs there rather than in a takeover the child has to
dismiss. And "You saved $35.00" is concrete where "You did it!" is vague — for a
five-year-old the specific figure is the reward. The 12-ray Burst was already in
that component; no new animation was written.

The plan chores are fetched at the ACHIEVEMENT MOMENT and on modal open, never
on dashboard load, so the child dashboard's 2-read budget is untouched.

### SCHEMA FACTS — THE THREE RECOGNITIONS (added 2026-09-05)

Chapter 8 names three weekly recognitions. Character Champion already existed as
'character-moment'; 'earner-of-week' ($1.00 default) and 'strategic-saver'
($0.50 default) join it. Both are in RESERVED_CHORE_CATEGORIES, so getFamilyChores
excludes them from every library view automatically — verified 0 rows.

EACH IS ITS OWN MARKER CATEGORY, not a `kind` column on a shared one, for the
same reason 'character-moment' is separate from 'direct-award': the category IS
the discriminator the child dashboard matches on, and it already flows through
every read the feature needs. A column would have been a schema change to say
what the existing string already says.

RECOGNITION_TYPES in choreService is the single source of truth for categories,
default amounts, prompts and placeholders — the formatFrequency pattern. Icons
live in the components, because a service file must not import React.

The award path is directAwardCustom() UNCHANGED. No new backend code.

A named award's DESCRIPTION IS ITS OWN TITLE, which the banner headline already
says, so the child banner and Family Week both suppress it unless the parent
typed something of their own. Character Moment always carries a real description
and is unaffected.

#### The recognition TYPE persists after submit — intentional

Submitting keeps the selected pill and refills that type's defaults, clearing
only the note. Naming an Earner of the Week usually means naming one per child
at the Friday meeting, and re-picking the pill between each is friction with no
payoff. Switching TABS still resets to Character Moment, so a parent returning
to the tab finds it in the state it has always opened in.

#### RECOGNITION IS MANUAL, AND MUST STAY MANUAL

Nothing awards Earner of the Week automatically. The book's agenda has the
family discuss the week's earnings FIRST and the parent recognise someone AFTER
that conversation; an automatic award would skip the discussion, which is the
actual lesson. Family Week carries a "Give Recognition ->" text link (antique,
chevron, matching "Browse available chores") that deep-links to
/parent/dashboard?quickAdd=character with the tab pre-selected — to make that
sequence seamless, NOT to prompt an award. It is a link rather than a button
because a prominent control on a screen read aloud to children invites a tap
from the wrong person.

The Quick Add tab strip scrolls horizontally and Caught Being Great is the LAST
tab, so the deep link also scrolls the active tab into view. Correct content
under a tab bar showing a different tab reads as a bug.

Family Week is still READ ONLY — it now has TWO links out (the approval queue
and Give Recognition), both of which navigate to the parent dashboard where the
money-moving controls actually live. Nothing on that screen writes.

#### FIXED WHILE HERE — "Biggest win" counted awards

familyWeekService's topChore loop had no category filter, so a recognition or a
Direct Award could become a child's headline achievement of the week — an
Earner of the Week award winning the "Biggest win" slot in the very week it
celebrates. RESERVED_CHORE_CATEGORIES are now excluded, the same reasoning as
rosterInstancesOnly() on the streak path.

PROVEN, not merely present: on 2026-09-05 Cuddles' highest-value approved row of
the week was her $0.50 Strategic Saver and her top real chore was $0.25. Family
Week showed "Feed & Water Dog $0.25".

#### Family Week recognitions cost ZERO new reads

Derived from approvedThisWeek, already fetched. ASSIGNMENT_COLUMNS gained
`notes` and `assigned_by` as SCALARS — no embedded join for the awarding
parent's name, which is resolved against the member list the page already holds.
This query is paged and runs on every Analytics and Family Week load; a join
would have cost a lookup per row forever. Both columns exist on
chore_assignments_archive, so the All Time union still reads.

### FIXED 2026-09-05 — Modal size must be a PROP, never a className

PlanBuilder passed `className="max-w-2xl"` to widen the modal for its two-column
tile grid. MEASURED: the panel stayed 448px. cn() is a plain join with no
tailwind-merge, so `max-w-md` and `max-w-2xl` both sat in the class list and
stylesheet order decided. Modal now takes `size?: 'default' | 'wide'` and emits
exactly one max-w class — the same remedy already recorded for Button sizes.

Also caught in the same pass: `bg-panel` is NOT a token in tailwind.config.ts.
It emits nothing, which would have left the builder's sticky header and footer
transparent with tiles scrolling behind them. The Modal panel is `bg-card`.
RULE: before using a colour class, check it exists in the config — an invented
token fails silently and looks like a z-index bug.

### Verification note — a snapshot taken too late proves nothing

During check 27 the plan-instance count read 46 before AND after a parent
dashboard load, which looked like generation had failed. It had not: signing in
as the parent had ALREADY landed on the dashboard and run generation, and the
second load was correctly a no-op under GENERATION_MIN_INTERVAL_MS. What settled
it was the history — prior instances for those templates stopped at 2026-09-03
(expired, when the chores were paused), nothing on 09-04, then exactly three new
rows on 09-05 created at 14:08:36.

RULE: when a before/after count fails to move, check WHEN the rows were created
before concluding the write did not happen. Signing in as a parent is itself a
generation trigger.

## SHIPPED 2026-09-07 — parent dashboard Session A (merged approval queue)

Eve reported feeling overwhelmed by the parent interface. A measured audit found
the cause was not decoration but a CONTRADICTION: the stat card counted chore
requests and the queue below it did not, so with 25 requests outstanding the
screen rendered "PENDING APPROVALS 25" directly above "All caught up — nothing
to approve." See the truncation-class note for getApprovalQueue and the PARENT
DASHBOARD READ COUNT item for the two structural changes.

Measured before -> after (1024x768 and 390x844, live family data):
  chrome before first actionable pixel   244px -> 129px  /  ~517px -> 93px
  approval cards visible, no scrolling   1.9 -> 3.9      /  0 -> 2
  nested scroll containers               4 -> 1  (one pane hid 4,627 of 5,007px)
  card width on tablet                   413px -> 704px
  dashboard reads                        8 -> 2

Quick Add moved from an always-open five-tab form to a + in the status band.
Five labelled tabs on a permanent form read as five daily jobs, which is the
opposite of what a three-minute screen should imply.

DASHBOARD SESSION A — TWO FIXES FOUND IN VERIFICATION:

1. Full Credit button was missing the dollar amount. QueueCard now sources the
   amount from the same value the write uses — 'FULL CREDIT ($0.25)'. The
   display and the write cannot drift because they share one source.

2. Empty state 'You're all caught up' truncated with ellipsis at 390px.
   truncate removed — the most important message on the screen cannot lose
   words. Wraps to two lines at narrow width.

VERIFYING AN EMPTY STATE WITHOUT WRITING TO LIVE DATA. Emptying a 27-item queue
would have meant 27 writes on real family accounts. Instead window.fetch was
stubbed IN THE BROWSER for exactly two read-only selects (status=eq.completed
and status=eq.requested), returning []. Everything else — every read and write
generateDailyAssignments makes — went to the real network untouched, which was
confirmed from the intercept log before trusting the result. Scoping the stub
this narrowly is the whole point: a blanket fetch stub would have made the
generator see an empty table and insert a duplicate roster.

MODAL EXIT VERIFIED UNDER THE ADVERSE CASE. Closing the modal in a BACKGROUNDED
tab leaves it mounted at opacity 0.06 — framer-motion's exit never finishes,
because Chrome throttles rAF there. It is still harmless: pointer-events is
'none' on the root and the dialog, and elementFromPoint at the screen centre
returns the queue card underneath. That is the 2026-09-03 backdrop fix holding
in precisely the condition that would defeat an opacity-only approach. A
mounted dialog after close is NOT a regression — check pointer-events and
elementFromPoint before treating it as one.

STILL OPEN — Session B, deliberately not started: navigation hierarchy, Manage
-> Setup, Analytics onto Family Week, and the family balance total restored
there as "Family economy: $X.XX". Between the two deploys that figure is
visible NOWHERE in the app; accepted knowingly, since it is not actionable and
individual balances remain on each child's dashboard. Session A also leaves the
64px sidebar in place at 390px, so the phone gains the vertical reclaim only —
the horizontal 64px is Session B's.

## SHIPPED 2026-09-07 — parent dashboard Session B (navigation and structure)

The four changes Session A deferred. Nothing in Dashboard.tsx was touched.

### PARENT NAVIGATION IS TWO TIERS, NOT FOUR PEERS

ParentLayout renders Home alone at the top, then a 1px `bg-antique/20` rule,
then an "Occasional" label, then Family Week / Setup / Settings. Bottom stays
pinned: "Signed in as <name>" and Switch user.

Four flat items all read as "you should visit this", which was a large part of
why the parent interface implied a much bigger daily commitment than the book's
two-to-three minutes. Home is where the app opens and where the work is.

Home is still a NavLink, not a static label, because it is also the way BACK
from the other three — the active location when you are on it, a destination
only when you are not.

AT 390px THE RULE CARRIES THE WHOLE MESSAGE. The sidebar is 64px, so the
"Occasional" label is `hidden sm:block` and computes to display:none there;
verified 2026-09-07. The divider alone still says "these are not the same kind
of thing as the one above", which is enough. There is NO overflow/⋯ menu — the
bottom items stay pinned in the rail and render icon-only. Do not add one
without a deliberate decision; it was explicitly declined as unrequested scope.

### "SETUP" IS A LABEL. THE ROUTE IS STILL /parent/chores

Manage -> Setup everywhere it was user-visible: the nav item, the page h1, and
the "review them on the Setup screen" line in Family Week's System Health.

THERE IS NO /parent/manage ROUTE AND THERE NEVER WAS. Management.tsx has always
been mounted at `/parent/chores` (App.tsx). Renaming the path would buy nothing
and risks a dead link, so it was left alone. The component and file are still
called Management — internal only, not worth the churn.

Why the rename at all: "Manage" is a verb in the present continuous and reads
as an ongoing duty. "Setup" reads as something already done. Nothing on that
screen is daily work.

### ANALYTICS LIVES ON FAMILY WEEK NOW

Setup went 6 tabs -> 5. Analytics is a collapsed CollapsibleSection at the
bottom of Family Week, below System Health.

IT MOVED WITH ZERO PLUMBING. AnalyticsTab takes no props — it reads `family`
and `members` straight off useAuth and owns its own rangeKey state. Management
rendered it as a bare `{tab === 'analytics' && <AnalyticsTab />}`, so its
deferred loading came from CONDITIONAL MOUNTING, not from a shared loader.

CollapsibleSection keeps its body UNMOUNTED until first opened, so that
deferral is preserved exactly — and the same mechanism stops Recharts measuring
itself inside a zero-height box, which is why the property exists in the first
place. Verified 2026-09-07: no `.recharts-wrapper` in the DOM until the section
is opened.

THE DATE RANGE IS SCOPED FOR FREE. Family Week has no range filtering of its
own — it makes one getFamilyWeek() call anchored on new Date() with no range
parameter — so AnalyticsPanel's pills cannot reach it. Proven rather than
assumed on 2026-09-07: switching to All Time moved the analytics figures
(Cuddles' completion 6% -> 8%, longest streaks 5d -> 7d and 1d -> 3d) while the
week header, child cards and Family Economy section stayed BYTE-IDENTICAL to a
snapshot taken before the switch. A range test that changes nothing anywhere
proves nothing; check that the analytics numbers actually moved.

### FAMILY ECONOMY TOTAL — DERIVED, ZERO NEW READS

`FamilyWeekData.familyBalance` is the sum of every child's current balance,
rendered as the FIRST of four cards in Family Economy (antique gold — a
reporting screen has no dominant action for primary gold to belong to). It is
first because it is the only one of the four describing NOW; earned and spent
are the week's history.

It sums the `children` rows getFamilyWeek is ALREADY handed. No query, no await.
This is where the total went when Session A deleted the dashboard stat row.
Verified 2026-09-07: 12.42 + 19.25 = 31.67, screen read $31.67, and
family_members was fetched exactly twice on a Family Week load — one
getActiveMembers call under StrictMode's double-invoke, with no balance-shaped
query anywhere.

Stat's `tone` is a LOOKUP, not a chained ternary. cn() has no tailwind-merge, so
exactly one colour class may be emitted; adding a third tone by chaining `?:` is
how two end up in the class list with stylesheet order deciding.

### KNOWN INCONSISTENCY, NOT FIXED — two pending-approval counts

Family Week's "Pending approvals" card counts COMPLETED CHORES ONLY, while the
dashboard status band counts the merged queue (completed chores + both request
paths). Observed live 2026-09-07: Family Week said 1, the dashboard said 27.
Both are internally correct and neither is wrong about what it measures, but
they are the same words over two different numbers on two screens — the class of
contradiction Session A existed to remove.

NOT changed here because it is outside Session B's four agreed changes and the
fix is a product decision: either Family Week adopts getApprovalQueue().length,
or the card is relabelled to say what it actually counts. Decide before launch.

## SHIPPED 2026-09-08 — child loan requests and child purchase requests

Two features plus one regression fix. Children can now ASK -- for a loan, and
for a purchase -- and both land in the parent's single approval queue. Verified
against live family data; balances opened POCO $12.42 / Cuddles $19.50 and
closed POCO $12.17 / Cuddles $19.50. The $0.25 difference is REAL FAMILY
ACTIVITY that happened mid-session (a "Sit on Cushions" expense applied from
another device at 12:28 UTC), not a test artifact, and was deliberately not
reversed. See SESSION BALANCE PROTOCOL -- distinguishing those two is the whole
point of the snapshot.

### REGRESSION FIXED — the chore rejection note is OPTIONAL again

RejectModal had `disabled={!note.trim()}` on the Reject button, plus a nag line.
Both are gone; the label reads "Add a note (optional)".

THIS HAS NOW BEEN REVERSED TWICE. It was made required on the reasonable theory
that a child losing credit is owed a reason. Eve's objection is the one that
governs: the common rejection is a reminder the child already knows about, and
forcing a sentence turns a two-second tap into a writing task on the screen
that is meant to take three minutes. The field still arrives PRE-FILLED with
REMINDER_REJECT_NOTE, so the reason is there by default and clearing it is an
explicit choice. Do not make it required a third time.

No service change was needed: rejectChore already stores `notes?.trim() || null`
and ChoreCard only renders the note block when notes is truthy, so a no-note
rejection shows the plain "Not approved" pill with nothing under it.

### SCHEMA FACTS — CHILD LOAN REQUESTS (added 2026-09-08)

`loans.status` CHECK widened from three values to FIVE:
`active | paid_off | forgiven | requested | declined`.

- `loans.decline_note text` -- the parent's reason for declining a request.
  Required on decline (enforced in declineLoanRequest AND by a disabled
  button), NULL on every other status. There is no notifications table, so --
  exactly as with chore_assignments.notes -- THE COLUMN IS THE MESSAGE and the
  child's only feedback channel.
- `loans.paid_off_at` NOW FUNCTIONS AS resolved_at FOR ALL THREE TERMINAL
  STATES: paid_off, forgiven AND declined. This is not a new convention, it is
  naming the one that already existed -- forgiveLoan() has always stamped it
  for a loan that was never paid off. Reusing it means the child's existing
  48-hour derived notification window covers a decline with NO new timestamp
  column and NO second code path.
- `idx_loans_one_requested_per_member` -- partial unique index on (member_id)
  WHERE status = 'requested'. Mirrors idx_loans_one_active_per_member and is
  the layer that survives concurrency. VERIFIED by probe INSERT 2026-09-08: a
  second requested loan for one child raises unique_violation.
  SCOPED TO 'requested' ONLY, deliberately -- a declined request frees the slot
  immediately so the child can ask again with better terms. The decline
  NOTIFICATION surviving that re-request is DISPLAY STATE derived from
  paid_off_at, never a database constraint. Gary's reasoning, recorded because
  it is the right one: the decline reason is the most valuable thing the child
  gets out of being told no, and a child who immediately re-asks has probably
  not read it yet.

A REQUEST IS NOT A LOAN. requestLoan() writes expense_id = NULL and never
touches the money path. That gives process_loan_payments() THREE independent
reasons to skip it: its explicit `WHERE l.status = 'active'`, its
`CONTINUE WHEN r.expense_id IS NULL`, and the fact that no expenses row exists
yet. The expenses row is created only on approval, by approveLoanRequest.
Verified live: creating a request moved no balance.

APPROVAL IS ON THE PARENT'S TERMS, NOT THE CHILD'S. Every value written comes
from the review modal, not the stored row -- the child's figures are an opening
position. Verified live 2026-09-08: POCO asked for $25 at $5/mo, the parent set
$10/mo, and the row went active with monthly_payment = 10. There is deliberately
NO one-tap Approve on the queue card; the only primary action is
"Review & Set Terms", because a one-tap approve of the child's own numbers would
remove the negotiation that is the entire point of the feature.

Both approve and decline are guarded `.eq('status','requested')` so two tablets
cannot both answer the same request -- the second matches no row. That guard,
not the unique index, is what makes approval safe: once the row is 'active' it
has left idx_loans_one_requested_per_member entirely.

#### THE NEGATION TRAP THIS FEATURE EXPOSED -- read before adding a sixth status

Widening the status constraint was NOT additive, and the audit before the ALTER
is what caught it. TWO call sites classified loans by NEGATION:

    LoansTab.tsx      const resolved = loans.filter((l) => l.status !== 'active')
    loanService.ts    resolved: rows.find((l) => l.status !== 'active') ?? null

Both were correct only while three statuses existed. With 'requested' in the
constraint, an UNANSWERED REQUEST satisfies `!== 'active'` -- so it would have
rendered inside Loan History styled as a COMPLETED loan, and on the child's
dashboard as a RESOLVED one. getFamilyLoans() additionally had NO status filter
at all, so it was fetching every row in the family.

Fixed by removing the negations rather than lengthening them:
`LOANS_TAB_STATUSES` and `RESOLVED_LOAN_STATUSES` are explicit lists, and
getChildLoanState returns a three-way `{ active, requested, resolved }` whose
every arm matches a status BY NAME.

RULE, and it is the same one the chore_assignments truncation rules encode:
state the statuses you WANT, never the one you don't. Adding a status must
never silently reclassify an existing row.

#### 'declined' belongs in Loan History; 'requested' does not

LOANS_TAB_STATUSES is `active | paid_off | forgiven | declined` -- it excludes
ONLY 'requested'. The distinction is the point: 'requested' is an OPEN QUESTION
and belongs in the approval queue where terms can still be set, while 'declined'
is a TERMINAL DECISION a parent already made. Hiding the latter would mean the
only record of a refusal lived on the child's dashboard for 48 hours and then
nowhere at all.

CAUGHT IN CLEANUP, NOT IN DESIGN. The first implementation excluded 'declined'
from the query while LoansTab's resolved filter included it -- dead code, and
the declined loan appeared nowhere. Found by actually looking at Loan History
rather than trusting the filter. The Declined pill shares antique with Forgiven
(both are a parent's decision); green stays reserved for the one case the child
actually finished. The pill is a LOOKUP table, not a chained ternary -- cn() has
no tailwind-merge, so exactly one colour class may be emitted.

### SCHEMA FACTS — CHILD PURCHASE REQUESTS (added 2026-09-08)

`expenses.status text NOT NULL DEFAULT 'approved'`
CHECK (status IN ('approved','requested','declined')), plus
`expenses.decline_note text`.

DEFAULT 'approved' is what makes it additive: every pre-existing row is approved
by definition because it already exists and has already been applied. Counted
before the ALTER: **63 rows** (not the ~9,174 the spec assumed -- that figure is
closer to chore_assignments). All 63 defaulted correctly.

SAFE BECAUSE `expenses` HAS NO TRIGGERS AT ALL. Verified against pg_trigger
before any SQL: the ONLY trigger across expenses + expense_applications is
`expense_application_balance_update`, AFTER INSERT on expense_applications.
So a 'requested' expenses row CANNOT move a balance -- there is no code path
that would. Confirmed live afterwards: POCO's $29.99 request sat with
applications = 0 and his balance did not move until approval.

`expenses.decline_note` mirrors loans.decline_note and exists for the same
reason: expenses.description holds the CHILD'S stated reason for wanting the
thing, and overwriting it with the parent's answer would destroy the child's
own words. OPTIONAL here, unlike loans -- a declined purchase costs the child
nothing and they can ask again tomorrow, while a declined loan forecloses a
plan. Purchase decline follows the chore-rejection rule; loan decline does not.

'purchase-request' IS THE FOURTH RESERVED EXPENSES CATEGORY. Same caveat as the
other three and it never stops mattering: `expenses` has no is_archived column,
so the exclusion in getFamilyExpenses() is the ENTIRE mechanism. Verified
2026-09-08: 29 library-visible expenses in SQL, 30 options in the Add Expense
dropdown (29 + placeholder), and neither purchase-request row present.

THE CATEGORY AND THE STATUS DO DIFFERENT JOBS; neither is redundant.
  category -> keeps the row out of the LIBRARY permanently, including after a
              decline.
  status   -> tracks the request LIFECYCLE and is what getPurchaseRequests binds
              the approval queue to.

APPROVAL ORDER IS THE OPPOSITE OF THE LOAN PATH, deliberately. The status flip
is guarded `.eq('status','requested')` and happens FIRST, so it is the
concurrency gate: a second tablet's approve matches no row and returns BEFORE
any money moves. Applying first and flipping second would let both tablets
charge the child. Verified live: approving Minecraft set status = 'approved',
inserted one expense_applications row, and took POCO from $12.17 to -$17.82 --
an overdraft, allowed by design, warned about and never blocked.

#### WHERE THE REQUESTING CHILD IS RECORDED -- a description tag, not a column

`expenses` has no member_id: an expense is a TYPE of thing, and who it was
applied to lives on expense_applications. A purchase request has no application
row yet, so there is nowhere structural to put the child.

created_by is the WRONG field -- it references auth.users(id), NOT
family_members(id) (the same FK trap already recorded for chores.created_by),
and under the kiosk's shared session it would resolve to the operator account
for every child alike.

So the member id is encoded as a `[member:<uuid>]` prefix on description, read
back by parseMemberTag(). Deliberately cheap and deliberately reversible: it
adds no column to a shared table for a transient row, and is only ever parsed
on rows already filtered to category = 'purchase-request'. IF PURCHASE REQUESTS
EVER BECOME PERMANENT HISTORY, this is the first thing to migrate to a real
column.

### SCHEMA FACTS — THE APPROVAL QUEUE IS NOW FOUR READS AND FIVE KINDS

    getPendingApprovals()   chore_assignments status='completed'   cap 500
    getChoreRequests()      chore_assignments status='requested'   cap 500
    getLoanRequests()       loans             status='requested'   cap  50
    getPurchaseRequests()   expenses          status='requested'   cap 100

COMPOSED IN MEMORY, NEVER ONE `.in('status',[...])` QUERY. The reasoning is
unchanged from the two-read version and gets stronger with four: one query puts
money-bearing rows and non-money rows under ONE row cap where a backlog of the
second can silently evict the first -- verbatim the getMemberInstances failure.
Four reads means four caps, and no category can starve another.

BOUNDEDNESS IS NOT UNIFORM, and the distinction is recorded honestly rather than
claimed away:

  STRUCTURALLY BOUNDED -- getPendingApprovals, getChoreRequests, getLoanRequests.
  Each is bounded by a TRANSIENT status. getLoanRequests is the strongest of the
  four: idx_loans_one_requested_per_member caps each child at ONE outstanding
  request, so its true ceiling is the NUMBER OF CHILDREN IN THE FAMILY, not a
  growth curve. Cap 50 has ~3 orders of magnitude of headroom.

  BEHAVIOURALLY BOUNDED -- getPurchaseRequests. Also transient, but there is NO
  unique index, because the feature deliberately allows several pending purchase
  requests (a child may want three things and let a parent choose, which is a
  better conversation than forcing them to pick first). Its ceiling is therefore
  a CONVENTION -- how many things children ask for before a parent answers --
  not a constraint. 100 is beyond any real backlog; a parent facing 100
  unanswered purchase requests has a conversation problem, not a query problem.
  THIS IS THE ONE READ IN THE QUEUE WHOSE BOUND A USER COULD DEFEAT. If purchase
  requests ever need a per-child cap, a partial unique index is not the tool --
  the feature wants several -- so it would have to be a count check or a
  windowed read.

Neither new read touches chore_assignments, so neither can compete with instance
history for the same row cap -- the mechanism behind all five prior truncation
bugs.

#### QueueItem IS A DISCRIMINATED UNION, and it earned its keep immediately

    'chore' | 'request-onetime' | 'request-roster' | 'loan-request' | 'purchase-request'

It used to be one interface with `item: PendingApproval | ChoreRequest` -- which
cost nothing, because those two shapes are structurally identical (both extend
AssignmentWithChore). A loan request is a row from a DIFFERENT TABLE with no
chore, no value and no due date, and a purchase request from a third.

WIDENING `item` WOULD HAVE COMPILED AND RENDERED BLANK. `item.chore?.title` is
valid optional-chaining on a type that has no `chore` only if the union permits
it; the moment the union is discriminated, it is a type error instead.
MEASURED: converting to a discriminated union produced compile errors at THREE
call sites that would otherwise have rendered empty loan cards, and again at
three more when the purchase kind was added. Structural typing caught a silent
render bug twice in one session.

Narrowing on `kind` also makes the card renderer exhaustive: adding a sixth kind
without handling it is a type error rather than an empty card. The TYPE_LABEL
map is `Record<QueueKind, string>`, so a new kind fails to compile until it is
labelled.

THE label-caps TYPE LABEL IS THE PRIMARY DELINEATION SIGNAL. Five card types
share one queue; a parent must be able to tell what KIND of decision they are
making without reading the body, so the label is the first element in every
card: CHORE COMPLETION / CHORE REQUEST / ROSTER REQUEST / LOAN REQUEST /
PURCHASE REQUEST.

Loan and purchase requests RANK WITH THE MONEY in the sort (rank 0, alongside
completed chores), not with the chore requests. Approving a loan commits a child
to months of deductions and approving a purchase debits the balance
immediately; neither has a cheap "not today" that costs nothing to get wrong.

### VERIFIED 2026-09-08 — phone layout unchanged by two new card kinds

Measured at a TRUE 384px inner viewport. Note the method: `resize_window`
clamps at Chrome's ~500px minimum window width, so 390px was reached with a
same-origin iframe sized 390px inside a 1400px window. The iframe boots to
KioskSelect because useAuth.activeMember is plain useState with NO persistence
-- it needs its own PIN entry, and RELOADING it loses the session again.

  chrome before first actionable pixel   93px   (status band 16-91)
  approval cards fully visible           2 of 3 (263px each, 754px viewport)
  + button                               46x44, elementFromPoint confirms it
  horizontal overflow                    0
  Quick Add at 390px                     331px panel, 5 tabs, strip scrolls
                                         (scrollWidth 659 vs clientWidth 300)

Both headline figures match the Session A benchmark exactly, so adding two card
kinds cost the phone layout nothing.

QUICK ADD REGRESSION CHECK (all five tabs, after the Session A move behind +):
Assign Chore (74 chore options), Add Expense (29 + placeholder, applied $0.10
live), Direct Award (credited live), Direct Charge (charged live), Caught Being
Great (all three recognition pills). Nothing was lost in the move.

## SHIPPED 2026-09-10 — parent balance strip, My Bank collapse, ledger date filter

Three contained changes. Balances opened and closed at POCO $8.32 /
Cuddles $11.95, with $0.00 variance and no money moved at any point.

### The parent dashboard balance strip — DERIVED, ZERO NEW READS

One muted 13px line under the status band: `Cuddles $11.95 · POCO $8.32`.

IT COSTS NOTHING BECAUSE getActiveMembers() SELECTS `*`. The parent dashboard
already called it — `children` feeds Quick Add's child picker — so `balance`
was already in memory on every load and simply unused. No query changed, no
select changed. Verified live 2026-09-10: a dashboard load issues 5 logical
reads (getActiveMembers + getApprovalQueue's four), and NOT ONE of them selects
`balance`. The strip is a render, not a read.

This is NOT the Children section Session A deleted. That was a 330px card grid
with actions in it; this is 28px of text with none. Measured: 28px exactly from
the status band's bottom edge to the strip's, and left-aligned with the queue
column to the pixel (both at x=308 in a 1384px window).

MUTED, NEVER GOLD — not even antique. The status band owns the headline and the
queue's approve buttons own this screen's one primary gold; a balance readout
is supporting information and must not outrank either. Colour verified as
#8A8680 (--color-text-secondary).

SORTED BY display_name, because getActiveMembers orders by created_at. A figure
a parent glances at must not change position between loads. `display_name` is
nullable in the generated types, so it takes the codebase's existing
`?? 'Child'` fallback and the sort keys off the NAME, not the composed string —
sorting the joined string would order "Sam" against "Samantha" by the space
character rather than by the name.

At 390px the line needs 181px of the 262px available: one line, 81px spare.

### My Bank — the ledger is collapsed, and getTransactionHistory is DEFERRED

Both sections on the child's My Bank screen are now CollapsibleSections
(Pending requests, hidden when empty; Transaction history, collapsed). The
balance card and the month summary stay always-visible above them.

#### THE DEFERRAL FORCED A REAL FIX — read this before touching the balance card

`getTransactionHistory` could not simply be deferred, because line 87 read:

    const balance = txns[0]?.runningBalance ?? 0

The balance card — the screen's primary job — was derived from the ledger.
Deferring the read would have rendered $0.00 on load. This is the exact trap
already documented above ("the child's My Bank header does NOT read
family_members.balance"), and the deferral is what made it unavoidable.

getMemberBalance() now reads family_members.balance — one indexed single-row
read of the same trigger-managed column getChildDashboard() already uses. Two
consequences, both improvements:

  1. THE BANK SCREEN AND THE DASHBOARD NOW AGREE BY CONSTRUCTION. They read one
     source. The documented divergence class — where the two disagree and no
     credit or charge can close the gap, because both move equally — is gone
     from this screen.
  2. THE BALANCE IS OFF THE TRUNCATION PATH. It was the figure most exposed to
     instance 5: a client-side sum of two silently-capped reads, rendered at
     56px. It no longer depends on them at all.

NET READS: one UNBOUNDED read out, one single-row indexed read in. Verified
live 2026-09-10 — a My Bank load issues 6 logical reads (getMemberBalance,
getMonthlyBankSummary's two, getActiveGoal, getChildLoanState,
getChildPurchaseRequests) and `chore_assignments` DOES NOT APPEAR AT ALL.

#### The deferral mechanism: the component's MOUNT is the first expand

CollapsibleSection already keeps its body unmounted until first open
(`hasOpened`), for the Recharts zero-height reason. TransactionHistorySection
is passed as that body's children and fetches in its own mount effect, so no
`hasOpened` state was duplicated in Bank.tsx and CollapsibleSection needed no
callback prop. React creates the element on every Bank render, but creating an
element does not run a component.

Verified live: body childElementCount 0 before first expand; the two ledger
selects fire on expand; and COLLAPSE + RE-EXPAND ISSUES ZERO REQUESTS — the
section stays mounted, so the rows are re-rendered, not re-read.

### The ledger date filter — CLIENT-SIDE, family timezone, This Month default

Four pills inside the section: This Week / This Month / Last Month / All.

FILTERING COSTS NO READS. Every bounded range is a SUBSET of the one fetch, so
it is a client-side filter over rows already in memory. Verified: 0 REST calls
across all four range switches.

BOUNDARIES RESOLVE IN THE FAMILY'S ZONE, via lib/time's startOfWeek /
startOfMonth / endOfMonth. No timezone literal appears in the code. Last month
is anchored by stepping ONE DAY BACK from the first of this month rather than
by subtracting from the month number — no January wrap-around arithmetic, and
it goes through addDays, which is DST-safe.

VERIFIED AGAINST SQL IN THE SAME ZONE, which is the only comparison worth
making (see the timezone note above — a UTC-resolved verification query answers
a different question). All four counts matched exactly for POCO: 12 / 40 / 87 /
127, screen against Postgres.

#### RUNNING BALANCE IS HIDDEN UNDER EVERY RANGE BUT "All"

Each row's runningBalance is its position in the FULL history. Shown against a
filtered subset the column appears to jump by amounts no visible row explains.
A child who cannot reconcile the numbers in front of them stops trusting the
account, which is the one thing this screen exists to build. The correct
figures are one tap away under All — where, verified live, the ledger's own top
running total ($8.32) equals the balance card and family_members.balance.

#### VERIFYING THE EMPTY STATE WITHOUT WRITING TO LIVE ACCOUNTS

Neither child had an empty range in any of the four, so the
`visible.length === 0` branch was unreachable from real data. Following the
Session A precedent, window.fetch was stubbed IN THE BROWSER for exactly two
GET selects, returning one row dated last month — so This Week and This Month
rendered empty while Last Month and All rendered the row, exercising both
branches. Every other request went to the real network untouched, confirmed
from the intercept log before the result was trusted: zero non-read requests
during the stubbed window.

RECORDED HONESTLY: the chore_assignments matcher was broader than intended and
also caught the child dashboard's approved-rows read while passing through it.
Read-only, no writes, no effect beyond that screen's display during the test —
but a matcher for this purpose should key on something unique to the call
(the embedded `chore:chores(title, value)` select), not on status alone.

### CollapsibleSection gained a `variant`, and it is a PROP for a reason

`variant: 'display' | 'label'` emits exactly ONE title class.
'display' (Cormorant 24px) is the default, so all seven existing callers are
byte-identical. 'label' is label-caps Inter 11px muted.

A className override would have been the bug already recorded twice — Modal's
max-w and Button's height. cn() is a plain join with no tailwind-merge, so
passing `titleClassName="text-[11px]"` alongside the built-in `text-2xl` leaves
BOTH in the class list and stylesheet order decides. RULE, now three times
over: a component's SIZE or VOICE is a prop that emits one class, never a
className the caller passes in.

WHY MY BANK USES 'label'. Measured on that screen: CURRENT BALANCE, EARNED THIS
MONTH and REQUEST A LOAN are all label-caps Inter uppercase muted. A 24px
Cormorant heading was the ONLY element on it in a different voice. Verified
after the change: the section header's font, size, colour and text-transform
are now identical to CURRENT BALANCE's.

### The range pills stop at 44px, and 44 is a FLOOR

SchedulePicker's day pills step h-11 -> h-14 (56px) from md. Reused here they
read as four buttons rather than a filter, sitting directly under a 56px
balance figure that should out-weigh them. Now a flat h-11 at every width, and
the row is capped at max-w-md: 185x56 -> 109x44 on a tablet.

DO NOT SHRINK THEM FURTHER without shrinking the hit area some other way. These
are CHILD-facing touch targets and 44px is the Apple/Google minimum the
codebase already treats as its floor (Button `lgResponsive`). The kiosk's own
standard is 64px; 44 is already the exception, not the starting point.

THE GRID IS WHAT GUARANTEES ONE ROW, not the widths. Content-sized pills would
wrap at 390px once the labels no longer fit; `grid-cols-4` makes the four
shrink together instead. Verified at the child screen's true 342px content
width: four 80px pills, ONE row, no clipped text, zero horizontal overflow.

## SHIPPED 2026-09-21 — code splitting, and truncation instance 5 closed

Two changes, deployed separately. Balances opened at POCO $15.37 / Cuddles
$2.50 and closed at POCO $13.67 / Cuddles $5.35. The difference is REAL
FAMILY ACTIVITY, not a test artifact: 22 grade-related credits and penalties
("Receive 'A' on Assignment" x10, "'A' on Test", "'C'" / "Below 'C'"
penalties) were entered from a parent screen between 11:55 and 11:59 local
while the child side was being verified, all via approve_chore /
apply_expense. They reconcile exactly (Cuddles +2.85, POCO -1.70) and were
deliberately NOT reversed -- the 2026-09-08 precedent. No PIN was entered
by Claude and no row was written by any verification step; the ledger
checks below were all taken before 11:55, against $15.37.

### Route-based code splitting

App.tsx lazy-loads all nine pages behind the PIN. KioskSelect, Login, both
layouts, PinPad and useAuth stay in the entry chunk. vite.config.ts pins
react / supabase / framer-motion / lucide to named vendor chunks so their
hashes survive an app-only deploy and the one-year immutable cache on
/assets/* actually pays off.

  initial load     1,150 kB / 321 kB gz  ->  537 kB / 164 kB gz
  chunks           1                     ->  24
  Recharts         in the entry          ->  own 365 kB chunk, reached only
                                             from Achievements and Family Week

SUSPENSE IS PER ROUTE ELEMENT, NOT AROUND <Routes>. A boundary above the
layouts unmounts the sidebar / bottom nav while a chunk loads, so the chrome
would flash on every first visit to a route. The fallback is an EMPTY bg-bg
div — no spinner: a cached chunk resolves in a frame, and a spinner would only
flicker.

FRAMER MOTION STAYS IN THE INITIAL LOAD, and that is a fact about the app,
not an oversight: PinPad renders inside Modal, which animates with it. Moving
it out means changing Modal's animation. Recharts also loads when Family Week
OPENS (AnalyticsTab is a static import there), not when the Analytics section
expands; lazy-loading that one tab is the obvious follow-up if it ever
matters.

VERIFICATION NOTE. `vite preview` serves the built dist, so it lands on the
Login screen (credentials are force-defined to "" at build). Behind-the-PIN
routes need a real sign-in plus PIN, which Gary performed; the chunk log and
console were then read from that session. A deep route on a fresh load with
no session serves the SPA shell and boots to Login WITHOUT fetching any page
chunk, which is the AppGate ordering working as intended.

### getTransactionHistory — two tiers, capped, anchored to the balance

THE SIGNATURE CHANGED: `getTransactionHistory(memberId, { since, balance })`
returns `LedgerPage { transactions, truncated }`. Nothing else calls it.

TWO TIERS, ONE FUNCTION. On first expand Bank.tsx passes `since` = the first
of LAST month (ledgerFetchSince), one date-bounded read that This Week, This
Month and Last Month all filter client-side — so switching between those
three still costs ZERO reads, verified live. It calls again with
`since: null` only when the child first taps All, and holds the result.
Last Month's own `from` is derived from the same ledgerFetchSince() so the
fetch window and the filter window cannot drift apart.

BOTH SELECTS ARE ORDERED DESC UNDER LEDGER_CAP (500), so when the cap bites
it is the OLDEST rows that fall off. The cap is the payload guard the
standing rule requires; `since` is the bound for the ranges that have one.

THE HORIZON TRIM is what makes a capped All honest rather than merely
bounded. The two selects are capped INDEPENDENTLY: if income filled its cap
at date H and expenses did not, rows older than H would show expenses with
their income neighbours missing. So when either select returns exactly
LEDGER_CAP rows, the merged list is cut to rows STRICTLY newer than the
newest such horizon — strictly, because rows sharing the boundary timestamp
may have been split by the cap. What survives is complete by construction,
and the note reads "Showing your N most recent transactions." — what IS
shown, not what is missing. Verified with LEDGER_CAP temporarily 5: both
selects returned 5, the horizon was the expense boundary, exactly 4 rows
were strictly newer, the screen showed those 4 with the note, and Postgres
computed the same 4 from the same rule.

THE RUNNING BALANCE IS ANCHORED TO family_members.balance AND WALKED
BACKWARDS, not summed forward from zero. Newest row = the balance card's
figure exactly; each older row = the newer row's figure minus the newer
row's effect, rounded to the cent at each step. This is what lets a capped
window carry correct figures on every row it shows: the anchor is known
regardless of how much older history was never fetched. Verified on all
168 of POCO's rows: 0 chain breaks, top row $15.37 = family_members.balance,
and the oldest row bottoms out at an implied opening balance of $0.00.

THE TRADE-OFF, APPROVED BY GARY 2026-09-21: should the ledger and the balance
ever diverge again (the 2026-09-03 class), the gap now surfaces as a NON-ZERO
IMPLIED OPENING BALANCE at the bottom of All, not as a mismatch at the top.
The child's trust anchor is the balance card, and the top of the ledger must
always agree with it. A non-zero opening balance is the diagnostic: if the
oldest row's running figure minus its own amount is not $0.00, the ledger
and family_members.balance disagree by exactly that much. Diagnose before
correcting, as before.

`balance` IS READ ONCE, AT THE SECTION'S MOUNT. The section mounts after the
screen has loaded the balance, and re-fetching the ledger because a prop
ticked would re-issue the very read this design exists to avoid. On this
kiosk a balance cannot change under an open Bank screen without a
navigation.

VERIFYING WITHOUT THE EXTENSION'S NETWORK TAB. The Claude-in-Chrome network
capture did not see this tab's fetches. performance.getEntriesByType(
'resource') is the browser's own record and cannot miss one; counting
entries whose URL contains /rest/v1/ before and after each pill tap gave the
zero-read evidence for the range switches. Note dev StrictMode double-runs
mount effects, so the bounded pair appears TWICE in dev and once in
production.

## SHIPPED 2026-09-28 — searchable selectors, claim search

No schema change, no money moved. Balances opened and closed at POCO $21.82
/ Cuddles $10.40.

SearchableSelect (src/components/ui/SearchableSelect.tsx) replaces the four
Quick Add <select>s: child (all tabs), Direct Award library chore (73),
Assign Chore (73), Add Expense (~30). Prefix matches rank above substring
matches, so "mow" finds Mow Lawn before anything containing "mow". Only
`label` is searched; `detail` (price · frequency) is display-only so "daily"
does not match every daily chore. Every other parent <select> has 8 or fewer
options and was left native. There is NO `bg-card-hover` token; the active
option uses bg-wash. Selected option is antique, never primary gold.

Claim library search: an input above the categories. Empty = the collapsed
category view, unchanged. Non-empty = one flat list of the same tiles,
filtered in memory (zero reads, terms never logged). Results exclude chores
on the child's ACTIVE roster exactly as the categories do — "dog" shows 4 for
POCO against 5 in SQL because Pick Up Dog Poop is on his roster (door 2).

TEST ARTIFACT, deliberately left: assignment c343976b ("Get Caught Serving
the Family", POCO, 2026-09-28) was completed by Claude acting as POCO and
rejected by the parent with the note "TEST — verifying reject button...".
A rejection moves no money; it is recorded so the note is not mistaken for a
real one.

## NEXT FEATURE — none currently queued

Nothing is recorded here. The standing priorities are in the pre-launch
checklist above: SCHEMA COMPLETENESS (the from-scratch rebuild) and the two
pending-approval counts on Family Week vs the dashboard. Truncation instance
5, bundle code-splitting and the roster reduction are all closed.

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
history. As of 2026-09-08 28 migrations are applied remotely; the repo captures
18 (the three added on 2026-09-08 were applied via the Supabase MCP and use the
exact remote version as their filename prefix, which is the convention). (Was 21 / 11 on 2026-09-03, and 17 / 7 when this audit was written on
2026-09-01.) The ten LIVE-BUT-NOT-IN-REPO entries below are unchanged — every
migration added since 2026-09-01 uses the exact remote version as its filename
prefix, which is the convention to follow.

CAPTURED IN THE REPO (7):
- 20260828212105 pin_server_side_verification_additive
- 20260828214445 pin_lockdown_revoke_member_pins_read          } both in the
- 20260828214551 pin_attempts_revoke_client_grants             } bcrypt file
- 20260831123242 chore_assignment_daily_dedup_index
- 20260831133207 member_earnings_and_approved_day_aggregates
- 20260901213153 add_child_savings_goals_to_milestones      (backfilled)
- 20260901213410 approve_chore_exclude_child_initiated_goals (backfilled)
- 20260903180404 create_loans_table
- 20260903180429 create_process_loan_payments
- 20260903201021 timezone_reconciliation_dynamic_family_timezone
- 20260903203201 add_requested_to_chore_assignment_status
- 20260904123546 add_recurrence_week_to_chore_assignments
- 20260904124019 mirror_recurrence_week_onto_assignments_archive
- 20260905182252 add_plan_goal_id_to_chore_assignments
- 20260905182302 mirror_plan_goal_id_in_archive_old_assignments
- 20260908121032 add_requested_and_declined_to_loan_status
- 20260908121110 add_decline_note_to_loans
- 20260908123034 add_status_and_decline_note_to_expenses

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
