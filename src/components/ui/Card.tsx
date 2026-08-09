import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card bg-card p-5 shadow-sm',
        interactive &&
          'cursor-pointer transition-[border-color,transform] duration-150 hover:border-gold/60 active:scale-[0.99] border border-white/5',
        className
      )}
      {...props}
    />
  )
}
