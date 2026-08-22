import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/**
 * Gold discipline (see DESIGN_SYSTEM.md): `primary` is the ONLY primary-gold
 * element allowed on a screen — reserve it for the single dominant action
 * (Approve, Save, Assign, Create, Sign In, Mark Complete). Every other
 * affirmative action uses `accent`, which is antique gold.
 */
type Variant = 'primary' | 'primaryList' | 'accent' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg' | 'xl'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-gold text-bg hover:brightness-95 active:brightness-90',
  // Same primary gold, outlined instead of filled — for a primary action that
  // repeats down a list (Approve, Mark Complete), where N solid gold blocks
  // would swamp the screen.
  primaryList: 'bg-transparent text-gold border border-gold/60 hover:bg-gold/10 hover:border-gold',
  accent: 'bg-transparent text-antique border border-antique/50 hover:bg-wash hover:border-antique',
  secondary: 'bg-card text-text border border-line hover:border-antique/40',
  ghost: 'bg-transparent text-text-muted hover:text-text hover:bg-wash',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger/10',
}

// All sizes meet the 64px kiosk touch-target minimum.
const sizeClasses: Record<Size, string> = {
  md: 'min-h-touch px-5 text-sm',
  lg: 'min-h-touch px-6 text-base',
  xl: 'min-h-[72px] px-8 text-lg',
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
        'label-caps inline-flex select-none items-center justify-center gap-2 rounded-input',
        'transition-[filter,background-color,border-color,transform] duration-150 active:scale-[0.98]',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-antique',
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
