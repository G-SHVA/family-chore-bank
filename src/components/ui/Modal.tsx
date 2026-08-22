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
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
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
