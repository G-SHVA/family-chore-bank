import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  /** Hide the close button (e.g. forced PIN entry). */
  hideClose?: boolean
  className?: string
}

export function Modal({ open, onClose, children, title, hideClose, className }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, pointerEvents: 'auto' }}
          // pointerEvents IS the fix, and it belongs on THIS element rather
          // than on the backdrop below it. AnimatePresence keeps this whole
          // subtree mounted for the 150ms exit fade, and a bare `fixed inset-0
          // z-50` div is a hit target whether or not it has an onClick — so
          // for 150ms after every close, a full-screen invisible pane ate the
          // first tap on whatever sat underneath. Disabling only the backdrop
          // would not have helped; this element was the one swallowing.
          //
          // pointerEvents is not an animatable value, so framer-motion applies
          // it the instant the exit begins rather than easing it — which is
          // exactly the semantics needed. The whole subtree inherits it, so
          // the dialog stops accepting clicks while it is leaving too.
          //
          // Measured on the claim screen 2026-09-03: three swallowed taps in
          // one browse cycle before, zero after. That screen is why this got
          // fixed rather than deferred — chore -> sheet -> submit -> next
          // chore hits the dead window on EVERY iteration, and a child who
          // taps and sees nothing concludes the app is broken.
          exit={{ opacity: 0, pointerEvents: 'none' }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-deep/80 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative z-10 w-full max-w-md rounded-card border border-line bg-card p-6 shadow-2xl',
              className
            )}
            initial={{ scale: 0.94, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            {(title || !hideClose) && (
              <div
                className={cn(
                  'mb-5 flex items-center justify-between',
                  // The spine belongs under a real title. A close-only header
                  // would otherwise render as an empty banded row.
                  title ? 'spine pb-3' : 'pb-0'
                )}
              >
                {title ? (
                  <h2 className="text-2xl text-text">{title}</h2>
                ) : (
                  <span />
                )}
                {!hideClose && (
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    className="flex h-11 w-11 items-center justify-center rounded-input text-text-muted hover:bg-wash hover:text-antique"
                  >
                    <X className="h-6 w-6" />
                  </button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
