'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import { createClient } from '@/lib/supabase/client'
import { IconChevronLeft, IconTerminal } from '@/components/icons'
import type { DaemonRow } from '@/lib/database.types'

type XTerm = import('@xterm/xterm').Terminal
type Phase = 'idle' | 'arming' | 'active' | 'closed'

const KEYS: { label: string; seq: string }[] = [
  { label: 'Esc', seq: '\x1b' },
  { label: 'Tab', seq: '\t' },
  { label: '^C', seq: '\x03' },
  { label: '^D', seq: '\x04' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '←', seq: '\x1b[D' },
  { label: '→', seq: '\x1b[C' },
]

export function TerminalView({ ownerId, daemons }: { ownerId: string; daemons: DaemonRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [daemonId, setDaemonId] = useState(
    daemons.find((d) => d.status !== 'offline')?.id ?? daemons[0]?.id ?? '',
  )
  const [phase, setPhase] = useState<Phase>('idle')
  const [note, setNote] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const termIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  const close = useCallback(async () => {
    const id = termIdRef.current
    cleanupRef.current?.()
    if (id) await supabase.from('terminals').update({ status: 'closed' }).eq('id', id)
  }, [supabase])

  const arm = useCallback(async () => {
    if (!daemonId) {
      setNote('Nenhuma máquina disponível.')
      return
    }
    setPhase('arming')
    setNote('Abrindo terminal…')

    const { data, error } = await supabase
      .from('terminals')
      .insert({ owner_id: ownerId, daemon_id: daemonId, status: 'requested' })
      .select('id')
      .single()
    if (error || !data) {
      setPhase('idle')
      setNote('Falha ao abrir: ' + (error?.message ?? 'desconhecido'))
      return
    }
    const id = data.id
    termIdRef.current = id

    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ])
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#0a0a0b', foreground: '#e8e8ea', cursor: '#f5a623' },
      scrollback: 2000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    if (containerRef.current) term.open(containerRef.current)
    termRef.current = term

    const channel = supabase.channel(id, {
      config: { private: true, broadcast: { self: false } },
    })
    channel.on('broadcast', { event: 'o' }, ({ payload }) =>
      term.write((payload as { d?: string }).d ?? ''),
    )
    channel.on('broadcast', { event: 'x' }, () => {
      setPhase('closed')
      setNote('Shell encerrado.')
    })
    await channel.subscribe()
    channelRef.current = channel

    term.onData((d) => void channel.send({ type: 'broadcast', event: 'i', payload: { d } }))

    const sendResize = () => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
      void channel.send({
        type: 'broadcast',
        event: 'rs',
        payload: { c: term.cols, r: term.rows },
      })
    }
    const ro = new ResizeObserver(() => sendResize())
    if (containerRef.current) ro.observe(containerRef.current)

    const statusCh = supabase
      .channel('term-status-' + id)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'terminals', filter: `id=eq.${id}` },
        (p) => {
          const row = p.new as { status: string; closed_reason: string | null }
          if (row.status === 'active') {
            setPhase('active')
            setNote('')
            sendResize()
            term.focus()
          } else if (row.status === 'closed') {
            setPhase('closed')
            setNote('Encerrado' + (row.closed_reason ? ` (${row.closed_reason})` : ''))
          }
        },
      )
      .subscribe()

    cleanupRef.current = () => {
      ro.disconnect()
      void supabase.removeChannel(channel)
      void supabase.removeChannel(statusCh)
      try {
        term.dispose()
      } catch {
        /* ignore */
      }
      termRef.current = null
      channelRef.current = null
      termIdRef.current = null
    }

    window.setTimeout(sendResize, 400)
  }, [supabase, ownerId, daemonId])

  useEffect(() => () => cleanupRef.current?.(), [])

  const tapKey = (seq: string) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'i', payload: { d: seq } })
    termRef.current?.focus()
  }

  const live = phase === 'active' || phase === 'arming'

  return (
    <div className="flex h-[100dvh] flex-col bg-[var(--color-bg)]">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 px-3 pb-2.5 pt-safe backdrop-blur">
        <a
          href="/"
          aria-label="Voltar"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--color-muted)] transition active:bg-[var(--color-surface)]"
        >
          <IconChevronLeft size={22} />
        </a>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">Terminal</h1>
          <p className="truncate text-[11px] text-[var(--color-muted)]">
            {phase === 'active'
              ? 'conectado'
              : phase === 'arming'
                ? 'abrindo…'
                : phase === 'closed'
                  ? note || 'encerrado'
                  : 'desarmado'}
          </p>
        </div>
        {live ? (
          <button
            type="button"
            onClick={() => void close()}
            className="rounded-lg border border-[var(--color-danger)]/50 px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] transition active:scale-95"
          >
            Encerrar
          </button>
        ) : (
          <span className="text-[11px] text-[var(--color-faint)]">expira em 15 min ocioso</span>
        )}
      </header>

      {/* xterm (sempre montado para o ref existir) */}
      <div className={`relative flex-1 overflow-hidden ${live ? '' : 'hidden'}`}>
        <div ref={containerRef} className="absolute inset-0 px-1 py-1" />
      </div>

      {/* Tela de armar */}
      {(phase === 'idle' || phase === 'closed') && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="grid size-16 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)]">
            <IconTerminal size={30} />
          </div>
          <p className="max-w-xs text-sm text-[var(--color-muted)]">
            Abre um terminal real na máquina para você rodar o que o agente não pode (sudo,
            logins interativos…). Fica <strong className="text-[var(--color-fg)]">desarmado</strong>{' '}
            por padrão e expira sozinho.
          </p>
          {daemons.length > 1 && (
            <select
              value={daemonId}
              onChange={(e) => setDaemonId(e.target.value)}
              className="w-full max-w-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none"
            >
              {daemons.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.status})
                </option>
              ))}
            </select>
          )}
          {note && phase === 'idle' && (
            <p className="text-xs text-[var(--color-danger)]">{note}</p>
          )}
          <button
            type="button"
            onClick={() => void arm()}
            disabled={!daemonId}
            className="rounded-xl bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-[var(--color-accent-fg)] transition active:scale-[0.99] disabled:opacity-50"
          >
            {phase === 'closed' ? 'Abrir novo terminal' : 'Abrir terminal'}
          </button>
        </div>
      )}

      {/* Barra de teclas especiais (mobile) */}
      {phase === 'active' && (
        <div className="flex gap-1.5 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => tapKey(k.seq)}
              className="min-w-11 shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-fg)] transition active:bg-[var(--color-surface-2)]"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
