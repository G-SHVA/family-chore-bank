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
    'w-full rounded-input border border-line bg-deep px-4 py-4 text-lg text-text placeholder:text-text-muted focus:border-antique focus:outline-none'

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        <div className="spine mb-8 flex flex-col items-center gap-3 pb-8 text-center">
          <img src="/logo.png" alt="Family Chore Bank" className="h-[100px] w-[100px]" />
          <h1 className="text-4xl text-antique">Family Chore Bank</h1>
          <p className="label-caps text-[11px] text-text-muted">Earn it. Save it. Own it.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card border border-line bg-card p-6">
          <div>
            <label className="label-caps mb-2 block text-[11px] text-text-muted">Email</label>
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
            <label className="label-caps mb-2 block text-[11px] text-text-muted">Password</label>
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
            <div className="rounded-input border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
          )}
          {notice && (
            <div className="rounded-input border border-green/30 bg-green/10 px-4 py-3 text-sm text-green">{notice}</div>
          )}

          <Button type="submit" size="xl" fullWidth disabled={busy || !email || !password}>
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Sign In'}
          </Button>

          <button
            type="button"
            onClick={handleForgot}
            disabled={resetting}
            className="label-caps mx-auto text-[11px] text-text-muted underline-offset-4 hover:text-antique hover:underline disabled:opacity-50"
          >
            {resetting ? 'Sending…' : 'Forgot password?'}
          </button>
        </form>

        <p className="label-caps mt-6 text-center text-[10px] text-text-muted">{APP_VERSION}</p>
      </div>
    </div>
  )
}
