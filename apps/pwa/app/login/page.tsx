import { LoginForm } from './LoginForm'

export const metadata = {
  title: 'Entrar — AITerminalControl',
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 7l5 5-5 5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect x="13" y="8.5" width="6" height="7" rx="1.6" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold">AITerminalControl</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Controle o OpenClaude do seu PC, do celular.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
