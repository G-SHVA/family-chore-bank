import { DAY_LABELS_SHORT, WEEK_LABELS } from '@/features/chores/choreService'
import { cn } from '@/lib/utils'

/**
 * The ONE day/week picker in the app.
 *
 * There were two implementations of "which day is this weekly chore due" —
 * a native <select> in the chore form modal and a second, differently worded
 * <select> on each roster row. Both wrote the same column. This replaces both,
 * so a parent sees the same control wherever a schedule is set and there is
 * one place to change how it behaves.
 *
 * Squared corners are deliberate: the parent surface uses 0px radius, against
 * the rounded child surface. Gold marks the selection and nothing else here,
 * which keeps the modal to a single gold accent.
 */

interface PillRowProps {
  label: string
  options: readonly string[]
  /** Index into `options` that is currently selected, or null for none. */
  value: number | null
  onChange: (value: number | null) => void
  /** Tapping the selected pill clears it back to null (unpinned). */
  clearable?: boolean
  disabled?: boolean
  /** Grid columns — 7 for weekdays, 4 for weeks of the month. */
  columns: 4 | 7
  /** Index of the first meaningful option; WEEK_LABELS reserves index 0. */
  startIndex?: number
}

function PillRow({
  label,
  options,
  value,
  onChange,
  clearable = false,
  disabled = false,
  columns,
  startIndex = 0,
}: PillRowProps) {
  return (
    <div>
      <span className="label-caps text-[10px] text-text-muted">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn(
          'mt-1.5 grid gap-1',
          columns === 7 ? 'grid-cols-7' : 'grid-cols-4'
        )}
      >
        {options.map((text, index) => {
          if (index < startIndex) return null
          const selected = value === index
          return (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(selected && clearable ? null : index)}
              // h-11 on a phone (the 44px Apple/Google minimum), h-14 from
              // tablet up. A row of seven at 375px leaves ~43px per pill, so
              // these are sized by the row rather than by the kiosk's 64px —
              // the wall tablet gets the taller variant.
              className={cn(
                'flex h-11 items-center justify-center rounded-none border px-1 text-xs',
                'font-semibold transition-colors md:h-14 md:text-sm',
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-antique bg-antique text-deep'
                  : 'border-line text-text-muted hover:border-antique/40 hover:text-text'
              )}
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface SchedulePickerProps {
  frequency: string | null | undefined
  dow: number | null
  week: number | null
  onChange: (next: { dow: number | null; week: number | null }) => void
  /** Allow tapping a selected pill to unpin the entry. Roster rows only. */
  clearable?: boolean
  disabled?: boolean
  /** Shown under the rows — states the effective behaviour in words. */
  hint?: string
}

/**
 * Day-of-week for weekly chores, week + day for monthly. Daily and once
 * collapse to nothing: they have no schedule to pin.
 *
 * THE EXPANSION IS CSS, NOT JAVASCRIPT, AND THAT IS THE POINT. This was first
 * built with framer-motion animating height 0 -> auto. The control then
 * rendered at height 0 with its inline style still reading `height: 0px`,
 * because Chrome throttles requestAnimationFrame in a backgrounded tab and the
 * entry animation never advanced — leaving a REQUIRED form control invisible
 * with no error. Any JS animation whose resting state is "collapsed" has that
 * failure mode; the element is only correct if the animation actually runs.
 *
 * A grid-template-rows transition inverts it: 1fr is the plain CSS state, so
 * if the transition never runs the picker is simply open. The animation is
 * progressive enhancement over a correct layout rather than the thing that
 * produces one.
 *
 * shrink-0 stays regardless — both hosts are `flex flex-col` containers that
 * overflow, and a flex child is squashed before its container scrolls. See
 * CLAUDE.md's layout traps.
 */
export function SchedulePicker({
  frequency,
  dow,
  week,
  onChange,
  clearable = false,
  disabled = false,
  hint,
}: SchedulePickerProps) {
  const freq = frequency ?? 'daily'
  const open = freq === 'weekly' || freq === 'monthly'
  const needsWeek = freq === 'monthly'

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'grid shrink-0 transition-[grid-template-rows,opacity] duration-200 ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      )}
    >
      {/* The scroll container the collapse actually clips against. A grid row
          sized in fr only crops its child if that child hides its overflow. */}
      <div className="overflow-hidden">
        <div className="flex flex-col gap-3 pt-1">
          {needsWeek && (
            <PillRow
              label="Which week"
              options={WEEK_LABELS}
              startIndex={1}
              columns={4}
              value={week}
              onChange={(next) => onChange({ dow, week: next })}
              clearable={clearable}
              disabled={disabled || !open}
            />
          )}
          <PillRow
            label="Which day"
            options={DAY_LABELS_SHORT}
            columns={7}
            value={dow}
            // A collapsed picker is still in the DOM, so its buttons must not
            // be reachable by tab or click while it is closed.
            disabled={disabled || !open}
            onChange={(next) => onChange({ dow: next, week: needsWeek ? week : null })}
            clearable={clearable}
          />
          {hint && <p className="text-xs text-text-muted">{hint}</p>}
        </div>
      </div>
    </div>
  )
}
