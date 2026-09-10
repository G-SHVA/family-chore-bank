import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A Manage-screen section that collapses to its header and scrolls its body in
 * a capped, independently scrolling pane.
 *
 * Two details are load-bearing:
 *
 * 1. The open/closed animation is a `max-height` transition, not a JS height
 *    measurement. That is normally a compromise — you have to guess a max-height
 *    larger than the content, and the easing goes wrong when the guess is far
 *    off. Here it is exact, because every section is *already* capped at
 *    `maxHeight` by design, so the collapsed and expanded heights are both known
 *    numbers and the transition runs between them precisely.
 *
 * 2. The header lives outside the scrolling pane, so it cannot scroll away, and
 *    is additionally `sticky` so it survives the page scrolling behind it. Only
 *    the title and chevron are inside the toggle button — `actions` sits beside
 *    it, so a "Create Chore" button in the header doesn't also collapse the
 *    section that contains it.
 *
 * 3. `variant` is a PROP, NOT A className OVERRIDE, and that is not a style
 *    preference. cn() is a plain join with no tailwind-merge, so passing
 *    `titleClassName="text-[11px]"` alongside the built-in `text-2xl` would
 *    leave BOTH in the class list and let stylesheet order decide — the exact
 *    failure already recorded for Modal's max-w and Button's height in
 *    CLAUDE.md. Emitting exactly one title class per variant makes that
 *    unrepresentable.
 */

/**
 * 'display' — Cormorant 24px, the section heading used on every parent screen
 *             and on the child Chores/Claim screens. The default, so every
 *             existing caller is unchanged.
 * 'label'   — label-caps Inter 11px muted, matching the surrounding labels on
 *             the child's My Bank screen ("CURRENT BALANCE", "EARNED THIS
 *             MONTH", "REQUEST A LOAN"). A 24px serif heading was the only
 *             element on that screen not in that voice.
 */
export type CollapsibleVariant = 'display' | 'label'

const TITLE_CLASS: Record<CollapsibleVariant, string> = {
  display: 'text-2xl',
  label: 'label-caps text-[11px] text-text-muted',
}

const CHEVRON_CLASS: Record<CollapsibleVariant, string> = {
  display: 'h-5 w-5',
  label: 'h-4 w-4',
}
export function CollapsibleSection({
  title,
  maxHeight,
  defaultOpen = false,
  actions,
  meta,
  variant = 'display',
  children,
}: {
  title: string
  /** Height cap for the scrolling body, in px. */
  maxHeight: number
  defaultOpen?: boolean
  /** Header voice. See CollapsibleVariant — a prop, never a className. */
  variant?: CollapsibleVariant
  /** Rendered beside the title, outside the toggle — e.g. a Create button. */
  actions?: ReactNode
  /** Small muted text after the title, e.g. a count. */
  meta?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  // Body stays unmounted until the section is first opened, then stays mounted
  // so its state survives collapsing. A collapsed section is zero-height, and a
  // chart that measures itself while it is zero-height renders nothing and does
  // not recover — so a closed section must not have laid its contents out yet.
  const [hasOpened, setHasOpened] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <section className="flex flex-col">
      <div className="sticky top-0 z-10 mb-3 flex items-center justify-between gap-3 bg-bg">
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
            setHasOpened(true)
          }}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-h-touch flex-1 items-center gap-2 rounded-input text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-antique"
        >
          <ChevronDown
            className={cn(
              'shrink-0 text-antique transition-transform duration-300',
              CHEVRON_CLASS[variant],
              open && 'rotate-180'
            )}
          />
          <h2 className={TITLE_CLASS[variant]}>{title}</h2>
          {meta && <span className="label-caps text-[10px] text-text-muted">{meta}</span>}
        </button>
        {actions}
      </div>

      <div
        id={bodyId}
        className="scroll-panel overflow-y-auto transition-[max-height] duration-300 ease-out"
        style={{ maxHeight: open ? maxHeight : 0 }}
      >
        {hasOpened ? children : null}
      </div>
    </section>
  )
}
