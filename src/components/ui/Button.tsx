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
type Size = 'md' | 'lg' | 'lgResponsive' | 'xl'

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

// Every size except lgResponsive meets the 64px kiosk touch-target minimum.
const sizeClasses: Record<Size, string> = {
  md: 'min-h-touch px-5 text-sm',
  lg: 'min-h-touch px-6 text-base',
  // 44px on a phone — the Apple/Google minimum — and the full 64px kiosk
  // target from md up. For a frequent PARENT action that repeats down a list:
  // three stacked 64px buttons per row cost a third of a phone screen, which
  // is how the approvals queue read on Eve's phone. The wall tablet is md and
  // above, so it is unaffected.
  //
  // This exists as a size rather than a className override because cn() is a
  // plain join with no tailwind-merge — passing `h-11` alongside `min-h-touch`
  // leaves both in the class list and the stylesheet order decides, not the
  // caller.
  lgResponsive: 'h-11 px-3 text-sm md:h-16 md:px-6 md:text-base',
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
