/**
 * Timezone-aware civil-date helpers.
 *
 * WHY THIS FILE EXISTS. Every date boundary in the app used to be computed in
 * the BROWSER's local zone (`setHours(0,0,0,0)`, `getDay()`, `new Date(y,m,d)`)
 * while the database bucketed days in a hardcoded 'America/Chicago'. Correct
 * for one family in Chicago; wrong the moment a second family sits anywhere
 * else, and wrong for anyone using the kiosk while travelling. Reconciled
 * 2026-09-03: the family's own timezone is now the single source of truth on
 * both sides.
 *
 * NO DEPENDENCY. date-fns-tz would have been ~20 kB gzipped on a bundle
 * already over the Vite warning threshold (see the pre-launch checklist) for
 * eight functions. `Intl.DateTimeFormat` ships in every browser this kiosk
 * runs on and does the same job.
 *
 * THE MODULE-LEVEL ZONE. Service files are plain functions, not React
 * components, so they cannot read context. Rather than thread a `tz` argument
 * through ~40 call sites — where one missed site is an invisible wrong answer —
 * the active zone is held here and set once by AuthProvider when the family
 * loads. Every helper still ACCEPTS an explicit zone, so a caller that knows
 * better (or a test) can override it. One family per kiosk session makes
 * module state the honest shape of this data.
 *
 * The default before the family loads is the BROWSER's zone, which is exactly
 * what the app did before this change — so boot behaviour is unchanged, and a
 * failed family fetch degrades to the old behaviour rather than to UTC.
 */

/** The browser's own zone. Also the onboarding default for a new family. */
export function detectBrowserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && isValidTimeZone(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when the runtime recognises `tz` as an IANA zone. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

let activeTimeZone: string = detectBrowserTimeZone()

/**
 * Points every helper below at the family's zone. Called by AuthProvider once
 * the family record loads, and again when a parent changes it in Settings.
 *
 * Ignores an unusable value rather than throwing: a malformed timezone string
 * in the database must not take the kiosk down. Note 'UTC' is perfectly valid
 * and IS accepted — this guard is for garbage, not for surprising-but-legal
 * values.
 */
export function setActiveTimeZone(tz: string | null | undefined): void {
  if (!tz || !isValidTimeZone(tz)) return
  activeTimeZone = tz
}

export function getActiveTimeZone(): string {
  return activeTimeZone
}

/* ------------------------------------------------------------------ *
 * Instant <-> civil time
 * ------------------------------------------------------------------ */

/**
 * Formatters are CACHED because construction dominates their cost and the
 * streak paths call this once per approved row.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      // hourCycle 'h23' rather than hour12:false — the latter yields hour "24"
      // for midnight in some engines, which would silently roll a day forward.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

/** Wall-clock fields of an instant, as read in `tz`. `month` is 1-12. */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday, matching Date.getDay(). */
  weekday: number
}

export function getZonedParts(date: Date, tz: string = activeTimeZone): ZonedParts {
  const map: Record<string, number> = {}
  for (const p of formatterFor(tz).formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  const year = map.year
  const month = map.month
  const day = map.day
  // Weekday is derived rather than formatted: a civil date has exactly one
  // weekday, and this avoids parsing a localised day name back into a number.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return { year, month, day, hour: map.hour, minute: map.minute, second: map.second, weekday }
}

/** Milliseconds `tz` is ahead of UTC at the given instant. */
function offsetMsAt(utcMs: number, tz: string): number {
  const p = getZonedParts(new Date(utcMs), tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // formatToParts has no millisecond field, so this compares against a
  // second-floored instant; otherwise every offset carries a sub-second
  // remainder and the DST comparison below never matches.
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/**
 * The instant at which the clock in `tz` reads the given wall-clock time.
 *
 * TWO PASSES. The first guess uses the offset in force at the WRONG instant
 * (the wall clock reinterpreted as UTC); if that lands on the far side of a
 * DST transition the offset differs, so it is recomputed at the corrected
 * instant and applied again. A third pass cannot change the answer — an offset
 * shifts at most once per transition.
 *
 * Field values outside their normal range are fine and normalise the way
 * Date.UTC does: day 0 is the last day of the previous month, day 32 rolls
 * forward, month 13 is next January. startOfMonth, endOfMonth and addDays
 * below all depend on that.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
  tz: string = activeTimeZone
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms)
  const firstPass = guess - offsetMsAt(guess, tz)
  return new Date(guess - offsetMsAt(firstPass, tz))
}

/* ------------------------------------------------------------------ *
 * Boundaries. Weeks are Monday–Sunday throughout the app.
 * ------------------------------------------------------------------ */

export function startOfDay(d: Date = new Date(), tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, 0, tz)
}

export function endOfDay(d: Date = new Date(), tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  return zonedTimeToUtc(p.year, p.month, p.day, 23, 59, 59, 999, tz)
}

/**
 * Adds whole CIVIL days, preserving the wall-clock time of day.
 *
 * Deliberately not `+ n * 86_400_000`: across a DST transition a civil day is
 * 23 or 25 hours, so millisecond arithmetic drifts an hour and can land a
 * "midnight" on 23:00 the day before.
 */
export function addDays(d: Date, n: number, tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  return zonedTimeToUtc(
    p.year,
    p.month,
    p.day + n,
    p.hour,
    p.minute,
    p.second,
    d.getMilliseconds(),
    tz
  )
}

export function startOfWeek(d: Date = new Date(), tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  const dow = (p.weekday + 6) % 7 // 0 = Monday
  return zonedTimeToUtc(p.year, p.month, p.day - dow, 0, 0, 0, 0, tz)
}

export function endOfWeek(d: Date = new Date(), tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  const dow = (p.weekday + 6) % 7
  return zonedTimeToUtc(p.year, p.month, p.day - dow + 6, 23, 59, 59, 999, tz)
}

export function startOfMonth(d: Date = new Date(), tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0, 0, 0, tz)
}

export function endOfMonth(d: Date = new Date(), tz: string = activeTimeZone): Date {
  const p = getZonedParts(d, tz)
  // Day 0 of the following month is the last day of this one.
  return zonedTimeToUtc(p.year, p.month + 1, 0, 23, 59, 59, 999, tz)
}

/* ------------------------------------------------------------------ *
 * Selectable zones
 * ------------------------------------------------------------------ */

/**
 * The zones a parent can pick in Settings.
 *
 * US only, deliberately. The full IANA list is ~600 entries and would be a
 * scrolling wall on a tablet; the V1 market is US families. International
 * support is a later change to this list, not to anything that reads it —
 * every consumer takes an arbitrary IANA string already, so a family whose
 * `timezone` column holds something outside this list still works correctly
 * (see currentZoneLabel, which names it rather than silently re-selecting).
 *
 * America/Phoenix is listed separately because Arizona does not observe DST —
 * the one case where "Mountain" is the wrong answer half the year.
 */
export const US_TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

/**
 * A readable name for a zone, whether or not it is in the list above.
 *
 * A family whose stored zone is not offered in the picker (an international
 * family, or one auto-detected at signup) must not have that value quietly
 * misrepresented as one of the seven — so it is shown by its IANA name.
 */
export function zoneLabel(tz: string): string {
  return US_TIMEZONES.find((z) => z.value === tz)?.label ?? tz
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/**
 * Formats a date in the family's zone.
 *
 * Boundaries and their LABELS have to agree. Family Week computes Monday
 * 00:00 in the family's zone and prints it in the header; formatting that
 * instant with a bare `toLocaleDateString()` renders it in the tablet's zone,
 * so a kiosk used a zone west of the family would title the week "Sun 31 –
 * Sat 6" over Monday-to-Sunday figures. Same instant, wrong day name.
 */
export function formatDateInZone(
  d: Date,
  opts: Intl.DateTimeFormatOptions,
  tz: string = activeTimeZone
): string {
  return d.toLocaleDateString(undefined, { ...opts, timeZone: tz })
}

/** As formatDateInZone, for a clock reading. */
export function formatTimeInZone(
  d: Date,
  opts: Intl.DateTimeFormatOptions,
  tz: string = activeTimeZone
): string {
  return d.toLocaleTimeString(undefined, { ...opts, timeZone: tz })
}

/* ------------------------------------------------------------------ *
 * Civil days as keys
 * ------------------------------------------------------------------ */

/**
 * 'YYYY-MM-DD' for the civil day an instant falls on in `tz`.
 *
 * Streak sets key on this rather than on a midnight timestamp. The old
 * `Set<number>` of local midnights tested adjacency with `=== 86_400_000`,
 * which is FALSE across a DST transition — so a streak spanning the March or
 * November change was silently cut short. A civil-day string has no such gap.
 */
export function dayKey(d: Date, tz: string = activeTimeZone): string {
  const p = getZonedParts(d, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' shifted by `n` civil days. Pure string maths, zone-free. */
export function shiftDayKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(
    t.getUTCDate()
  ).padStart(2, '0')}`
}

/** 0 = Sunday … 6 = Saturday for a 'YYYY-MM-DD' key. */
export function dayKeyWeekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
