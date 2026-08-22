import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Cards share the page background — the hairline border is what defines them,
 * not a fill contrast. No gold fills on cards (see DESIGN_SYSTEM.md).
 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-line bg-card p-5',
        interactive &&
          'cursor-pointer transition-[border-color,transform] duration-150 hover:border-antique active:scale-[0.99]',
        className
      )}
      {...props}
    />
  )
}
