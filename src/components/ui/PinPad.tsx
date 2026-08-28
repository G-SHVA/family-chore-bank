import { useEffect, useState } from 'react'
import { Delete } from 'lucide-react'
import { Modal } from './Modal'
import type { PinVerifyResult } from '@/features/family/familyService'
import { cn, initials } from '@/lib/utils'

type Mode = 'verify' | 'create'

interface PinPadProps {
  open: boolean
  onClose: () => void
  /** Whose PIN we're entering — shown in the header. */
  memberName: string
  avatarUrl?: string | null
  mode?: Mode
  /**
   * verify mode: server-side check. Resolves to a verdict — this component
   * never compares PINs itself.
   */
  verify?: (pin: string) => Promise<PinVerifyResult>
  /** verify mode: called after a correct PIN. */
  onSuccess?: () => void
  /** verify mode: too many failed attempts; argument is the lockout in seconds. */
  onLockout?: (retryAfterSeconds: number) => void
  /** create mode: called with the confirmed new PIN. May be async. */
  onCreate?: (pin: string) => void | Promise<void>
}

const PIN_LENGTH = 4
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinPad({
  open,
  onClose,
  memberName,
  avatarUrl,
  mode = 'verify',
  verify,
  onSuccess,
  onLockout,
  onCreate,
}: PinPadProps) {
  const [pin, setPin] = useState('')
  const [firstPin, setFirstPin] = useState<string | null>(null) // create mode step 1
  const [shake, setShake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset all state whenever the pad opens or closes.
  useEffect(() => {
    setPin('')
    setFirstPin(null)
    setShake(false)
    setBusy(false)
    setError(null)
  }, [open])

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || busy) return
    let cancelled = false

    async function handleComplete() {
      setBusy(true)
      if (mode === 'create') {
        if (firstPin === null) {
          // Step 1 done — ask for confirmation.
          setFirstPin(pin)
          setPin('')
          setBusy(false)
          return
        }
        // Step 2 — confirm match.
        if (pin === firstPin) {
          try {
            await onCreate?.(pin)
            // Parent will typically close/navigate; leave busy to avoid re-fire.
          } catch (e) {
            if (cancelled) return
            fail(e instanceof Error ? e.message : 'Could not save the PIN.')
            setFirstPin(null)
          }
        } else {
          fail('PINs did not match. Try again.')
          setFirstPin(null)
        }
        return
      }

      // verify mode — the verdict comes from the server.
      const result: PinVerifyResult = verify
        ? await verify(pin)
        : { status: 'error' }
      if (cancelled) return

      switch (result.status) {
        case 'valid':
          onSuccess?.()
          return
        case 'rate_limited':
          // Freeze the pad and hand the lockout to the caller, which parks the
          // countdown on the member's tile.
          setShake(true)
          setPin('')
          setError('Too many attempts, try again in a moment')
          onLockout?.(result.retryAfter)
          return
        case 'error':
          fail('Unable to verify PIN — check your connection')
          return
        case 'no_pin_set':
          fail('No PIN set for this member. Ask a parent to set one up.')
          return
        default:
          fail('Wrong PIN. Try again.')
      }
    }

    function fail(msg: string) {
      setShake(true)
      setPin('')
      setBusy(false)
      setError(msg)
    }

    void handleComplete()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  function press(key: string) {
    if (busy) return
    setError(null)
    setPin((prev) => (prev.length < PIN_LENGTH ? prev + key : prev))
  }

  function backspace() {
    if (busy) return
    setPin((prev) => prev.slice(0, -1))
  }

  const subtitle =
    mode === 'create'
      ? firstPin === null
        ? 'Create a 4-digit PIN'
        : 'Re-enter to confirm'
      : 'Enter your 4-digit PIN'

  return (
    <Modal open={open} onClose={onClose} className="max-w-sm">
      <div className="flex flex-col items-center gap-5">
        <div className="flex flex-col items-center gap-3">
          {avatarUrl ? (
            <img src={avatarUrl} alt={memberName} className="h-20 w-20 rounded-full border border-antique/40 object-cover" />
          ) : (
            <div className="display flex h-20 w-20 items-center justify-center rounded-full border border-antique/40 bg-wash text-3xl text-antique">
              {initials(memberName)}
            </div>
          )}
          <div className="text-center">
            <h2 className="text-2xl text-text">{memberName}</h2>
            <p className={cn('label-caps text-[11px]', error ? 'text-danger' : 'text-text-muted')}>
              {error ?? subtitle}
            </p>
          </div>
        </div>

        <div
          className={cn('flex gap-4', shake && 'animate-shake')}
          onAnimationEnd={() => setShake(false)}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-4 w-4 rounded-full border-2 transition-colors',
                i < pin.length ? 'border-antique bg-antique' : 'border-antique/30 bg-transparent'
              )}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key) => (
            <PadButton key={key} onClick={() => press(key)}>
              {key}
            </PadButton>
          ))}
          <div />
          <PadButton onClick={() => press('0')}>0</PadButton>
          <PadButton onClick={backspace} aria-label="Delete">
            <Delete className="h-7 w-7" />
          </PadButton>
        </div>
      </div>
    </Modal>
  )
}

function PadButton({
  children,
  onClick,
  ...props
}: {
  children: React.ReactNode
  onClick: () => void
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-16 w-16 items-center justify-center rounded-input border border-line bg-deep text-2xl font-medium text-text',
        'transition-[transform,background-color,border-color] duration-100 active:scale-95 active:border-antique active:bg-wash',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-antique'
      )}
      {...props}
    >
      {children}
    </button>
  )
}
