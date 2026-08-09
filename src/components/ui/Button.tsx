import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg' | 'xl'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-gold text-bg hover:brightness-95 active:brightness-90',
  secondary: 'bg-card text-text border border-white/10 hover:border-white/20',
  ghost: 'bg-transparent text-text-muted hover:text-text hover:bg-white/5',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
}

// All sizes meet the 64px kiosk touch-target minimum.
const sizeClasses: Record<Size, string> = {
  md: 'min-h-touch px-5 text-base',
  lg: 'min-h-touch px-6 text-lg',
  xl: 'min-h-[72px] px-8 text-xl',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth, className, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-input font-semibold',
        'transition-[filter,background-color,border-color,transform] duration-150 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    />
  )
})
