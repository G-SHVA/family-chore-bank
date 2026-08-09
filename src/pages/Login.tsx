import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { APP_VERSION } from '@/lib/constants'

export default function Login() {
  const { signIn, resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password || busy) return
    setBusy(true)
    setError(null)
    const err = await signIn(email.trim(), password)
    if (err) {
      setError(err)
      setBusy(false)
    }
    // On success, AuthProvider flips needsLogin=false and the app re-renders.
  }

  async function handleForgot() {
    setError(null)
    setNotice(null)
    if (!email) {
      setError('Enter your email above first, then tap “Forgot password?”.')
      return
    }
    setResetting(true)
    const err = await resetPassword(email.trim())
    setResetting(false)
    if (err) setError(err)
    else setNotice(`Password reset email sent to ${email.trim()} — check your inbox.`)
  }

  const inputClass =
    'w-full rounded-input border border-white/10 bg-card px-4 py-4 text-lg text-text placeholder:text-text-muted focus:border-gold focus:outline-none'

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/logo.png" alt="Family Chore Bank" className="h-[100px] w-[100px]" />
          <h1 className="text-3xl font-extrabold text-gold">Family Chore Bank</h1>
          <p className="text-text-muted">Earn it. Save it. Own it.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card bg-surface p-6">
          <div>
            <label className="mb-1 block text-sm text-text-muted">Email</label>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-text-muted">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={inputClass}
            />
          </div>

          {error && (
            <div className="rounded-input bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
          )}
          {notice && (
            <div className="rounded-input bg-green/10 px-4 py-3 text-sm text-green">{notice}</div>
          )}

          <Button type="submit" size="xl" fullWidth disabled={busy || !email || !password}>
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Sign In'}
          </Button>

          <button
            type="button"
            onClick={handleForgot}
            disabled={resetting}
            className="mx-auto text-sm text-text-muted underline-offset-2 hover:text-text hover:underline disabled:opacity-50"
          >
            {resetting ? 'Sending…' : 'Forgot password?'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-muted">{APP_VERSION}</p>
      </div>
    </div>
  )
}
