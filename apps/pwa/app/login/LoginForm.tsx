'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type State = 'idle' | 'sending' | 'sent' | 'error'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setState('sending')
    setError(null)

    const supabase = createClient()
    const emailRedirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined

    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo },
    })

    if (err) {
      setError(err.message)
      setState('error')
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <div className="mb-3 text-3xl">📬</div>
        <h2 className="font-medium">Verifique seu e-mail</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          Enviamos um link mágico para <span className="text-[var(--color-fg)]">{email}</span>.
          Toque nele neste celular para entrar.
        </p>
        <button
          type="button"
          onClick={() => {
            setState('idle')
            setError(null)
          }}
          className="mt-5 text-sm text-[var(--color-accent)] underline-offset-4 hover:underline"
        >
          Usar outro e-mail
        </button>
      </div>
    )
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

      {error && <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>}

      <button
        type="submit"
        disabled={state === 'sending'}
        className="mt-4 w-full rounded-xl bg-[var(--color-accent)] px-4 py-3 text-base font-semibold text-[var(--color-accent-fg)] transition active:scale-[0.99] disabled:opacity-60"
      >
        {state === 'sending' ? 'Enviando…' : 'Enviar link mágico'}
      </button>

      <p className="mt-4 text-center text-xs text-[var(--color-faint)]">
        Sem senha. Você recebe um link por e-mail para entrar.
      </p>
    </form>
  )
}
