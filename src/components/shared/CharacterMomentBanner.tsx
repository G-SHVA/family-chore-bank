import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import type { CharacterMoment } from '@/features/chores/choreService'
import { formatCurrency } from '@/lib/utils'

/**
 * "Caught Being Great" — the child-facing half of a character recognition.
 *
 * Deliberately NOT the standard approval treatment. A chore approval is green
 * and transactional; this is antique gold and warm, because the point is that
 * someone noticed something the child was never asked to do. Primary gold is
 * not used: the child view spends its one primary-gold slot on the balance
 * figure and Mark Complete (DESIGN_SYSTEM.md §5), and a banner is neither.
 *
 * The motion is a slow, low-amplitude shimmer on three small sparkles, not the
 * badge-unlock burst. Understated but warm was the brief, and a burst would
 * also fire on a screen the child may be looking at for the first time that
 * morning, which reads as noise rather than recognition.
 *
 * Dismissal is the caller's component state. Nothing is persisted — there is no
 * notifications table, and seeing a recognition once more after an app restart
 * is a much smaller cost than a schema change.
 */
export function CharacterMomentBanner({
  moments,
  currency,
  onDismiss,
}: {
  moments: CharacterMoment[]
  currency: string
  onDismiss: (id: string) => void
}) {
  return (
    <AnimatePresence initial={false}>
      {moments.map((m) => (
        <motion.div
          key={m.id}
          layout
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          // shrink-0 is load-bearing: this renders as a flex item inside the
          // dashboard's height-constrained, scrolling left column, and a flex
          // child shrinks before its container overflows — without it the
          // banner is crushed to a ~30px sliver with the headline cut in half.
          className="relative shrink-0 overflow-hidden rounded-card border border-antique/50 bg-wash p-4"
        >
          {/* Sparkles sit behind the text and never intercept a tap. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {SPARKLES.map((s, i) => (
              <motion.div
                key={i}
                className="absolute text-antique"
                style={{ left: s.left, top: s.top }}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, s.peak, 0], scale: [0.6, 1, 0.6] }}
                transition={{
                  duration: 3.2,
                  times: [0, 0.5, 1],
                  repeat: Infinity,
                  delay: s.delay,
                  ease: 'easeInOut',
                }}
              >
                <Sparkles className={s.size} strokeWidth={1.5} />
              </motion.div>
            ))}
          </div>

          {/* Headline, one detail line, and the credited amount sitting on the
              dismiss row rather than on a line of its own. ~140px instead of
              207px: on the child Home column this is one of three cards inside
              559px, and a recognition that pushes the balance off the fold is
              not doing the child a favour. Every word is unchanged. */}
          <div className="relative flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input border border-antique/40 text-antique">
              <Sparkles className="h-5 w-5" strokeWidth={1.5} />
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="text-xl leading-tight text-antique">
                {/* Falls back rather than naming the shared operator account:
                    the child dashboard nulls awardedBy in that case. */}
                {m.awardedBy
                  ? `${m.awardedBy} caught you being great!`
                  : 'Your parent caught you being great!'}
              </h3>
              <p className="mt-1 line-clamp-2 text-base leading-snug text-text">{m.description}</p>
              {m.note && (
                <p className="mt-0.5 line-clamp-1 text-sm italic text-text-muted">{m.note}</p>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                onClick={() => onDismiss(m.id)}
                aria-label="Dismiss"
                className="flex min-h-touch min-w-touch items-center justify-center rounded-input text-text-muted hover:bg-wash hover:text-antique"
              >
                <X className="h-5 w-5" />
              </button>
              <span className="label-caps whitespace-nowrap text-[11px] text-text-muted">
                <span className="text-green">{formatCurrency(m.amount, currency)}</span> credited
              </span>
            </div>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  )
}

/** Fixed positions rather than random, so the shimmer is stable across renders. */
const SPARKLES = [
  { left: '18%', top: '14%', size: 'h-3 w-3', delay: 0, peak: 0.45 },
  { left: '62%', top: '62%', size: 'h-4 w-4', delay: 1.1, peak: 0.32 },
  { left: '86%', top: '22%', size: 'h-3 w-3', delay: 2.0, peak: 0.4 },
] as const
