import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DaemonStatus } from '@/components/DaemonStatus'
import { NewSessionButton } from '@/components/NewSessionButton'
import { SessionActions } from '@/components/SessionActions'
import { SignOutButton } from '@/components/SignOutButton'
import { EnablePush } from '@/components/EnablePush'
import { IconTerminal, IconHost } from '@/components/icons'
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
  const daemonName = new Map(daemonList.map((d) => [d.id, d.name]))

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 px-4 pb-3 pt-safe backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">Sessões</h1>
          <DaemonStatus initial={daemonList} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/terminal"
            aria-label="Terminal"
            className="grid size-7 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] transition active:scale-95 hover:text-[var(--color-fg)]"
          >
            <IconTerminal size={16} />
          </Link>
          <SignOutButton />
        </div>
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
          <li key={s.id} className="flex items-center pr-2">
            <Link
              href={`/session/${s.id}`}
              className="block min-w-0 flex-1 px-4 py-4 transition active:bg-[var(--color-surface)]"
            >
              <p className="truncate font-medium">
                {s.title?.trim() || 'Sessão sem título'}
              </p>
              {s.project_path && (
                <p className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]">
                  {s.project_path}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-faint)]">
                <span className="inline-flex items-center gap-1 rounded-md bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[var(--color-muted)]">
                  <IconHost size={12} />
                  {s.daemon_id ? (daemonName.get(s.daemon_id) ?? 'máquina removida') : 'sem máquina'}
                </span>
                <span>
                  {SESSION_STATUS_LABEL[s.status]} · {formatWhen(s.updated_at)}
                </span>
              </div>
            </Link>
            <SessionActions session={{ id: s.id, title: s.title, status: s.status }} />
          </li>
        ))}
      </ul>
    </main>
  )
}
