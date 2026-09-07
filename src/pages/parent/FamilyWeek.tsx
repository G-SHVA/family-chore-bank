import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Flame, Loader2, PiggyBank, Sparkles, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getActiveMembers, isChild } from '@/features/family/familyService'
import { getFamilyWeek, type FamilyWeekData } from '@/features/familyweek/familyWeekService'
import {
  CHARACTER_MOMENT_CATEGORY,
  EARNER_OF_WEEK_CATEGORY,
  STRATEGIC_SAVER_CATEGORY,
  recognitionType,
  type RecognitionCategory,
} from '@/features/chores/choreService'
import { Card } from '@/components/ui/Card'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'
import AnalyticsPanel from './manage/AnalyticsTab'
import { cn, formatCurrency } from '@/lib/utils'

/**
 * Icon and label per recognition. The parent-facing counterpart to the child
 * banner's RECOGNITION_LOOK — same icons, so a child pointing at their Trophy
 * and a parent reading the meeting screen are looking at the same mark.
 */
const RECOGNITION_LOOK: Record<RecognitionCategory, { icon: LucideIcon; label: string }> = {
  [CHARACTER_MOMENT_CATEGORY]: { icon: Sparkles, label: 'Character Moment' },
  [EARNER_OF_WEEK_CATEGORY]: { icon: Trophy, label: 'Earner of the Week' },
  [STRATEGIC_SAVER_CATEGORY]: { icon: PiggyBank, label: 'Strategic Saver' },
}

/**
 * "Give Recognition" — the meeting's natural next step, not a call to action.
 *
 * RECOGNITION IS MANUAL BY DESIGN. Nothing in this app awards Earner of the
 * Week automatically, and it must not: the book's agenda has the family discuss
 * the week's earnings FIRST and the parent recognise someone AFTER that
 * conversation. An automatic award would skip the discussion, which is the
 * actual lesson. This link exists to make that sequence seamless — review,
 * discuss, tap once — rather than to prompt an award.
 *
 * Styled as a text link with an antique chevron, matching "Browse available
 * chores" on the child dashboard. Deliberately NOT a button: on a screen being
 * read aloud to children, a prominent control invites a tap from the wrong
 * person.
 */
function GiveRecognitionLink() {
  return (
    <div className="mt-3 flex justify-end">
      <Link
        to="/parent/dashboard?quickAdd=character"
        className="label-caps flex min-h-touch shrink-0 items-center gap-2 text-[11px] text-antique hover:text-gold"
      >
        Give Recognition
        <ChevronRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

/**
 * Family Week — the screen a parent opens on Friday night and turns toward the
 * table. Chapter 8's weekly review, as a page.
 *
 * READ ONLY, by design. No approve, no assign, no edit. Every other parent
 * screen is a console; this one is a document being read aloud to children, and
 * an action button within reach of a child leaning over the tablet is a way to
 * lose money mid-conversation. Nothing here writes: the two links out (the
 * approval queue, and Give Recognition) both navigate to the parent dashboard,
 * where the actual money-moving controls live.
 *
 * Sized for arm's length in landscape: no displayed figure is below 18px, and
 * the conversation starters are deliberately the largest text on the page
 * because they are the part meant to be read across a dinner table.
 */
export default function FamilyWeek() {
  const { family } = useAuth()
  const currency = family?.currency ?? 'USD'
  const familyId = family?.id

  const [data, setData] = useState<FamilyWeekData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!familyId) return
    try {
      setError(null)
      const members = await getActiveMembers(familyId)
      // Full member list as well as the children: a recognition names the
      // parent who gave it, and resolving that here costs nothing because
      // these rows are already loaded.
      setData(await getFamilyWeek(familyId, members.filter(isChild), new Date(), members))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this week.')
    } finally {
      setLoading(false)
    }
  }, [familyId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 py-24">
        <Loader2 className="h-10 w-10 animate-spin text-antique" />
        <span className="text-text-muted">Loading this week…</span>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertTriangle className="h-10 w-10 text-danger" />
        <p className="max-w-md text-text-muted">{error ?? 'No data.'}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="spine pb-4">
        <h1 className="text-4xl">Family Week</h1>
        <p className="mt-1 text-lg text-text-muted">
          Week of {formatDay(data.weekStart)} — {formatDay(data.weekEnd)}
        </p>
      </header>

      {/* Section 1 — This Week's Earners */}
      <section>
        <h2 className="mb-4 text-2xl">This Week&rsquo;s Earners</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.children.map((c) => (
            <Card key={c.memberId} className="flex flex-col gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="display text-3xl text-text">{c.name}</span>
                <span className="display text-3xl text-green">
                  {formatCurrency(c.earned, currency)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-lg text-text-muted">
                <span>
                  <span className="font-semibold text-text">{c.choresCompleted}</span>{' '}
                  {c.choresCompleted === 1 ? 'chore' : 'chores'}
                </span>
                {c.currentStreak > 0 && (
                  <span className="flex items-center gap-1.5 text-antique">
                    <Flame className="h-5 w-5" />
                    {c.currentStreak} day streak
                  </span>
                )}
              </div>

              {c.goal && (
                <div className="border-t border-line pt-3">
                  <div className="flex items-baseline justify-between gap-3 text-lg">
                    {/* Wraps rather than truncates. At 768px the two columns
                        are ~211px wide and truncation reduced these to
                        "New headp…" — this screen is read at arm's length, so a
                        second line costs nothing and an ellipsis costs the
                        content. */}
                    <span className="min-w-0 break-words text-text">{c.goal.title}</span>
                    <span className="shrink-0 font-semibold text-antique">
                      {c.goal.progressPct}%
                    </span>
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden bg-deep">
                    <div
                      className="h-full bg-antique"
                      style={{ width: `${c.goal.progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="border-t border-line pt-3 text-lg">
                {c.topChore ? (
                  <>
                    <span className="label-caps text-[11px] text-text-muted">Biggest win</span>
                    <div className="mt-1 flex items-baseline justify-between gap-3">
                      <span className="min-w-0 break-words text-text">{c.topChore.title}</span>
                      <span className="shrink-0 font-semibold text-antique">
                        {formatCurrency(c.topChore.value, currency)}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-text-muted">No chores approved this week yet.</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Section 2 — Family Economy */}
      <section>
        <h2 className="mb-4 text-2xl">Family Economy This Week</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* FIRST, because it is the only one of the four that describes NOW.
              Earned and spent are the week's history; this is what the family
              actually holds. Antique gold, not primary — a reporting screen has
              no dominant action for primary gold to belong to. */}
          <Stat
            label="Family economy"
            value={formatCurrency(data.familyBalance, currency)}
            tone="antique"
          />
          <Stat label="Total family earned" value={formatCurrency(data.totalEarned, currency)} tone="green" />
          <Stat label="Total family spent" value={formatCurrency(data.totalSpent, currency)} tone="danger" />
          {/* The one link off this screen. A pending count with no way to act on
              it is a nag; a full approvals UI here would put money-moving
              buttons in front of the children the screen is aimed at. */}
          <Link to="/parent/dashboard" className="focus-visible:outline-none">
            <Card interactive className="h-full">
              <div className="display text-4xl text-antique">{data.pendingApprovals}</div>
              <div className="label-caps mt-2 text-[11px] text-text-muted">
                Pending approvals
                {data.pendingApprovals > 0 && ' — review'}
              </div>
            </Card>
          </Link>
        </div>
      </section>

      {/* Section 3 — This Week's Recognition. Hidden entirely when none were
          given, the same way Loan History is: an empty "no recognitions this
          week" card read aloud at the meeting is a reproach, not information.

          Placed BEFORE Conversation Starters deliberately — a recognition is
          the warmest thing on the page and belongs in the part being read to
          the children, not filed after the questions. */}
      {data.recognitions.length > 0 && (
        <section>
          <h2 className="mb-4 text-2xl">This Week&rsquo;s Recognition</h2>
          <Card className="flex flex-col divide-y divide-line">
            {data.recognitions.map((r) => {
              const look = RECOGNITION_LOOK[r.type] ?? RECOGNITION_LOOK[CHARACTER_MOMENT_CATEGORY]
              const Icon = look.icon
              return (
                <div key={r.id} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-input border border-antique/40 text-antique">
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="display text-2xl leading-tight text-text">
                      {r.childName} — <span className="text-antique">{look.label}</span>
                    </p>
                    {/* A named award's description is its own title, which the
                        line above just said. Only a parent's own words show. */}
                    {r.description !== recognitionType(r.type).defaultTitle && (
                      <p className="mt-1 text-lg leading-snug text-text">{r.description}</p>
                    )}
                    {r.note && (
                      <p className="mt-1 text-base italic text-text-muted">{r.note}</p>
                    )}
                    <p className="label-caps mt-2 text-[11px] text-text-muted">
                      {r.awardedBy ? `Given by ${r.awardedBy}` : 'Given by a parent'}
                    </p>
                  </div>

                  <div className="display shrink-0 text-2xl text-green">
                    {formatCurrency(r.amount, currency)}
                  </div>
                </div>
              )
            })}
          </Card>
          <GiveRecognitionLink />
        </section>
      )}

      {/* When no recognition has been given yet the section above is hidden, so
          the link still needs a home — the meeting is exactly when a parent
          decides to give the first one. It follows the earnings cards here,
          which is where the conversation that prompts it happens. */}
      {data.recognitions.length === 0 && <GiveRecognitionLink />}

      {/* Section 4 — Conversation Starters */}
      <section>
        <h2 className="mb-4 text-2xl">Conversation Starters</h2>
        <Card className="flex flex-col gap-5">
          {CONVERSATION_STARTERS.map((q) => (
            <p key={q} className="display text-2xl italic leading-snug text-text">
              {q}
            </p>
          ))}
        </Card>
      </section>

      {/* Section 5 — System Health, collapsed. Not meeting material: this is
          for the parent afterwards, and reading "completion rate 19%" aloud to
          a child turns a review into a performance appraisal. */}
      <CollapsibleSection title="System Health" maxHeight={420}>
        <Card className="flex flex-col gap-5">
          <div>
            <div className="label-caps text-[11px] text-text-muted">Average approval turnaround</div>
            <div className="mt-1 text-lg text-text">
              {data.health.turnaroundHours === null
                ? 'No approvals to measure this week.'
                : `${data.health.turnaroundHours.toFixed(1)} hours across ${data.health.turnaroundSample} ${
                    data.health.turnaroundSample === 1 ? 'chore' : 'chores'
                  }`}
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <div className="label-caps text-[11px] text-text-muted">Completion rate this week</div>
            <div className="mt-2 flex flex-wrap gap-x-8 gap-y-1 text-lg text-text">
              {data.health.completionRates.map((r) => (
                <span key={r.name}>
                  {r.name}: <span className="font-semibold text-antique">{r.rate}%</span>
                </span>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <div className="label-caps text-[11px] text-text-muted">
              No completions this week ({data.health.idleChores.length})
            </div>
            {data.health.idleChores.length === 0 ? (
              <p className="mt-2 text-lg text-text-muted">
                Every active chore was completed at least once.
              </p>
            ) : (
              <>
                {/* Capped. Live data returns 56 of 85 roster entries here, and
                    an un-capped list pushes the turnaround and completion-rate
                    figures — the two things a parent actually acts on — off the
                    top of a 420px pane. The count in the heading carries the
                    full total; this is a sample to talk about, not an audit. */}
                <ul className="mt-2 flex flex-col gap-1 text-lg text-text">
                  {data.health.idleChores.slice(0, IDLE_PREVIEW).map((c) => (
                    <li key={`${c.childName}-${c.title}`} className="flex justify-between gap-4">
                      <span className="min-w-0 truncate">{c.title}</span>
                      <span className="shrink-0 text-text-muted">{c.childName}</span>
                    </li>
                  ))}
                </ul>
                {data.health.idleChores.length > IDLE_PREVIEW && (
                  <p className="mt-2 text-lg text-text-muted">
                    and {data.health.idleChores.length - IDLE_PREVIEW} more — review them on the
                    Setup screen.
                  </p>
                )}
              </>
            )}
          </div>
        </Card>
      </CollapsibleSection>

      {/* Section 6 — Analytics, collapsed.
          It used to be the sixth tab on the Setup screen, which put a
          weekly-review surface inside a configuration area. This is the
          weekly-review screen, so it lives here now.

          COLLAPSED, AND THAT IS LOAD-BEARING TWICE OVER. CollapsibleSection
          keeps its body UNMOUNTED until first opened, so (1) none of
          Analytics' three queries fire unless a parent actually asks for them —
          preserving exactly the deferred loading the old conditional tab
          render gave it, and (2) Recharts never measures itself inside a
          zero-height box, which it does not recover from.

          maxHeight is generous because this is charts rather than a list: the
          section scrolls internally, so it cannot push Conversation Starters —
          the part read aloud at the table — off the end of a long page.

          Its date-range pills are AnalyticsPanel's own useState and are read by
          nothing outside it. Family Week's own sections come from one
          getFamilyWeek() call anchored on new Date() with no range parameter,
          so the range here cannot reach them. Scoping was free. */}
      <CollapsibleSection title="Analytics" maxHeight={720}>
        <AnalyticsPanel />
      </CollapsibleSection>
    </div>
  )
}

/**
 * Verbatim from the book's Chapter 8 meeting agenda. Static by intent — a
 * rotating or generated prompt would make the ritual feel like software output
 * rather than something the family does the same way every week.
 */
/** How many idle chores to actually list. See the note at the call site. */
const IDLE_PREVIEW = 8

import { formatDateInZone } from '@/lib/time'
const CONVERSATION_STARTERS = [
  'What was your biggest earning win this week?',
  'Is there anything you want to save for next week?',
  'Are there any chores that feel too easy or too hard?',
  'Is there anything we should change about how the system works?',
] as const

// The week header labels boundaries computed in the family's zone, so it
// must render them in that zone too — see formatDateInZone.
function formatDay(d: Date): string {
  return formatDateInZone(d, { month: 'short', day: 'numeric' })
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'green' | 'danger' | 'antique'
}) {
  // A lookup, not a nested ternary: cn() has no tailwind-merge, so exactly one
  // colour class must be emitted. Adding a third tone by chaining `?:` is how
  // two of them end up in the class list with stylesheet order deciding.
  const toneClass = { green: 'text-green', danger: 'text-danger', antique: 'text-antique' }[tone]
  return (
    <Card>
      <div className={cn('display text-4xl', toneClass)}>{value}</div>
      <div className="label-caps mt-2 text-[11px] text-text-muted">{label}</div>
    </Card>
  )
}
