import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DaemonStatus } from '@/components/DaemonStatus'
import { NewSessionButton } from '@/components/NewSessionButton'
import { SignOutButton } from '@/components/SignOutButton'
import { EnablePush } from '@/components/EnablePush'
import type { DaemonRow, SessionRow } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

const SESSION_STATUS_LABEL: Record<SessionRow['status'], string> = {
  active: 'Ativa',
  idle: 'Ociosa',
  closed: 'Encerrada',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: sessions }, { data: daemons }] = await Promise.all([
    supabase
      .from('sessions')
      .select('*')
      .order('updated_at', { ascending: false })
      .returns<SessionRow[]>(),
    supabase
      .from('daemons')
      .select('*')
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .returns<DaemonRow[]>(),
  ])

  const daemonList = daemons ?? []
  const sessionList = sessions ?? []

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 px-4 pb-3 pt-safe backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Sessões</h1>
          <DaemonStatus initial={daemonList} />
        </div>
        <SignOutButton />
      </header>

      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <NewSessionButton ownerId={user.id} daemons={daemonList} />
        <div className="mt-2">
          <EnablePush ownerId={user.id} />
        </div>
      </div>

      <ul className="flex-1 divide-y divide-[var(--color-border)]">
        {sessionList.length === 0 && (
          <li className="px-4 py-16 text-center text-sm text-[var(--color-muted)]">
            Nenhuma sessão ainda.
            <br />
            Crie uma com “Nova sessão” acima.
          </li>
        )}
        {sessionList.map((s) => (
          <li key={s.id}>
            <Link
              href={`/session/${s.id}`}
              className="flex items-center justify-between gap-3 px-4 py-4 transition active:bg-[var(--color-surface)]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {s.title?.trim() || 'Sessão sem título'}
                </p>
                {s.project_path && (
                  <p className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]">
                    {s.project_path}
                  </p>
                )}
                <p className="mt-1 text-xs text-[var(--color-faint)]">
                  {SESSION_STATUS_LABEL[s.status]} · {formatWhen(s.updated_at)}
                </p>
              </div>
              <span className="shrink-0 text-[var(--color-faint)]" aria-hidden>
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
