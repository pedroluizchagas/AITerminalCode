'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const mail = email.trim()
    if (!mail || !password) return
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithPassword({
      email: mail,
      password,
    })

    if (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : err.message,
      )
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
    >
      <label htmlFor="email" className="block text-sm font-medium">
        E-mail
      </label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="voce@exemplo.com"
        className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-base outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />

      <label htmlFor="password" className="mt-4 block text-sm font-medium">
        Senha
      </label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-base outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />

      {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="mt-5 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-base font-semibold text-[var(--color-accent-fg)] transition active:scale-[0.99] disabled:opacity-60"
      >
        {loading ? 'Entrando…' : 'Entrar'}
      </button>

      <p className="mt-4 text-center text-xs text-[var(--color-faint)]">
        Esqueceu a senha? Rode <code className="font-mono">set-password</code> no PC.
      </p>
    </form>
  )
}
