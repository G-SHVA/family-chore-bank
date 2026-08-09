import { useEffect } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface BalanceDisplayProps {
  amount: number
  currency?: string
  className?: string
  /** Animate from previous value on change. */
  animateFrom?: number
}

export function BalanceDisplay({
  amount,
  currency = 'USD',
  className,
  animateFrom = 0,
}: BalanceDisplayProps) {
  const count = useMotionValue(animateFrom)
  const text = useTransform(count, (v) => formatCurrency(v, currency))

  useEffect(() => {
    const controls = animate(count, amount, { duration: 0.8, ease: 'easeOut' })
    return controls.stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount])

  return (
    <motion.span className={cn('tabular-nums', className)} aria-label={formatCurrency(amount, currency)}>
      {text}
    </motion.span>
  )
}
