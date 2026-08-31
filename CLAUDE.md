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

TRUNCATION CLASS -- THREE INSTANCES FIXED:
1. getMemberInstances (dashboard/chores) -- fixed with query split, DESC
   ordering
2. getFamilyChildSummaries (parent dashboard) -- fixed with date-bounded reads
3. getMemberInstances 500-row cap -- fixed [2026-08-31]
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

## Kiosk rules
- All touch targets minimum 64px
- Support both landscape and portrait
- Bottom nav on child views
- Large readable text — minimum 16px, balance at 48px+

## Supabase free tier
- Project PAUSES after 1 week of inactivity. Keep the family using it
  daily, or add a scheduled health-check ping. Revisit before beta.

## Pre-launch checklist

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
  NOTE if making the index read the column: an index expression must be
  IMMUTABLE, and a subquery against families is not. That route needs the
  timezone denormalised onto chore_assignments (or a generated local-day
  column) rather than a lookup inside the index.

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
