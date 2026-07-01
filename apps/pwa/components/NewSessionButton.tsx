'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MODEL_OPTIONS } from '@ati/protocol'
import { IconPlus } from '@/components/icons'
import type { DaemonRow, SessionRow } from '@/lib/database.types'

export function NewSessionButton({
  ownerId,
  daemons,
}: {
  ownerId: string
  daemons: DaemonRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [daemonId, setDaemonId] = useState<string>(daemons[0]?.id ?? '')
  const [model, setModel] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    const path = projectPath.trim()
    if (path && !path.startsWith('/')) {
      setError('O caminho do projeto deve ser absoluto — começar com "/" (ex.: /home/voce/projeto).')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('sessions')
      .insert({
        owner_id: ownerId, // RLS with check exige owner_id = auth.uid()
        title: title.trim() || null,
        project_path: path || null,
        daemon_id: daemonId || null,
        model: model || null,
        status: 'active',
      })
      .select('id')
      .single<Pick<SessionRow, 'id'>>()

    if (err || !data) {
      setError(err?.message ?? 'Falha ao criar sessão.')
      setBusy(false)
      return
    }
    router.push(`/session/${data.id}`)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)] transition active:scale-[0.99]"
      >
        <IconPlus size={18} /> Nova sessão
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="space-y-3">
        <div>
          <label htmlFor="ns-title" className="text-xs text-[var(--color-muted)]">
            Título (opcional)
          </label>
          <input
            id="ns-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Ajustar o build"
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <div>
          <label htmlFor="ns-path" className="text-xs text-[var(--color-muted)]">
            Caminho do projeto (opcional)
          </label>
          <input
            id="ns-path"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="/home/voce/projeto"
            autoCapitalize="none"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        {daemons.length > 0 && (
          <div>
            <label htmlFor="ns-daemon" className="text-xs text-[var(--color-muted)]">
              Daemon
            </label>
            <select
              id="ns-daemon"
              value={daemonId}
              onChange={(e) => setDaemonId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">— nenhum (o daemon assume depois) —</option>
              {daemons.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.status})
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="ns-model" className="text-xs text-[var(--color-muted)]">
            Modelo
          </label>
          <select
            id="ns-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value ?? 'default'} value={m.value ?? ''}>
                {m.label}
                {m.hint ? ` — ${m.hint}` : ''}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="flex-1 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--color-accent-fg)] transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? 'Criando…' : 'Criar'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-muted)] transition active:scale-95"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
