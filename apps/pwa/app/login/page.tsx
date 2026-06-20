import { LoginForm } from './LoginForm'

export const metadata = {
  title: 'Entrar — AITerminalControl',
}

export default function LoginPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-2xl">
            <span className="font-mono text-[var(--color-accent)]">{'>'}_</span>
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
