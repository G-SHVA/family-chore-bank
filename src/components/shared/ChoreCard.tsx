import { useState } from 'react'
import {
  GraduationCap,
  Home,
  User,
  PawPrint,
  ListChecks,
  Clock,
  CheckCircle2,
  XCircle,
  CalendarX,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'framer-motion'
import type { AssignmentWithChore } from '@/features/chores/choreService'
import { Button } from '@/components/ui/Button'
import { cn, formatCurrency } from '@/lib/utils'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  academic: GraduationCap,
  household: Home,
  personal: User,
  'pet-care': PawPrint,
}

export function categoryIcon(category: string | null | undefined): LucideIcon {
  return (category && CATEGORY_ICONS[category]) || ListChecks
}

interface ChoreCardProps {
  assignment: AssignmentWithChore
  currency?: string
  onComplete?: (assignmentId: string) => Promise<void> | void
}

export function ChoreCard({ assignment, currency = 'USD', onComplete }: ChoreCardProps) {
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const chore = assignment.chore
  const Icon = categoryIcon(chore?.category)
  const status = assignment.status ?? 'pending'
  // A chore whose due date has passed is missed, even if the expiry sweep
  // hasn't run yet — never offer Complete on one the server would reject.
  const lapsed = !!assignment.due_date && new Date(assignment.due_date) < new Date()
  const open = status === 'pending' || status === 'in_progress'
  const canComplete = open && !lapsed
  const missed = status === 'expired' || (open && lapsed)

  async function handleComplete() {
    if (!onComplete || busy) return
    setBusy(true)
    setFlash(true)
    try {
      await onComplete(assignment.id)
    } finally {
      setBusy(false)
      setTimeout(() => setFlash(false), 800)
    }
  }

  return (
    <motion.div
      layout
      className={cn(
        'rounded-card border border-line bg-card p-5',
        flash && 'animate-green-flash'
      )}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-input border border-line bg-deep text-antique">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-xl leading-tight text-text">{chore?.title}</h3>
            <span className="label-caps shrink-0 rounded-input border border-antique/40 px-3 py-1 text-sm text-antique">
              {formatCurrency(chore?.value ?? 0, currency)}
            </span>
          </div>
          <div className="label-caps mt-2 flex items-center gap-2 text-[11px] text-text-muted">
            <span>{chore?.category ?? 'chore'}</span>
            {chore?.frequency && <span>· {chore.frequency}</span>}
          </div>

          <div className="mt-4">
            {canComplete && (
              <Button fullWidth size="lg" variant="primaryList" onClick={handleComplete} disabled={busy}>
                {busy ? 'Saving…' : 'Mark Complete'}
              </Button>
            )}
            {status === 'completed' && (
              <StatusPill icon={Clock} className="text-antique">
                Waiting for parent approval
              </StatusPill>
            )}
            {status === 'approved' && (
              <StatusPill icon={CheckCircle2} className="text-green">
                Approved
              </StatusPill>
            )}
            {missed && (
              <StatusPill icon={CalendarX} className="text-text-muted">
                Missed — a new one comes next time
              </StatusPill>
            )}
            {status === 'rejected' && (
              <div>
                <StatusPill icon={XCircle} className="text-danger">
                  Not approved
                </StatusPill>
                {assignment.notes && (
                  <p className="mt-2 rounded-input border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {assignment.notes}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function StatusPill({
  icon: Icon,
  className,
  children,
}: {
  icon: LucideIcon
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'label-caps flex min-h-touch items-center justify-center gap-2 rounded-input border border-line bg-deep px-4 text-xs',
        className
      )}
    >
      <Icon className="h-5 w-5" />
      {children}
    </div>
  )
}
