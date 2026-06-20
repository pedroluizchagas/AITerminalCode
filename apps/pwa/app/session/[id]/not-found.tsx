import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-medium">Sessão não encontrada</p>
      <p className="text-sm text-[var(--color-muted)]">
        Ela pode ter sido encerrada ou não pertence a você.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-accent-fg)]"
      >
        Voltar às sessões
      </Link>
    </main>
  )
}
