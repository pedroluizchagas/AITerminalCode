'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import { createClient } from '@/lib/supabase/client'
import { IconChevronLeft, IconClipboard, IconTerminal } from '@/components/icons'
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
  const [recv, setRecv] = useState(0) // bytes recebidos do PTY (diagnóstico)
  const [conn, setConn] = useState('') // status do canal Realtime (diagnóstico)
  const [pasteOpen, setPasteOpen] = useState(false) // folha de colar (mobile)
  const [pasteText, setPasteText] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const termIdRef = useRef<string | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pasteRef = useRef<HTMLTextAreaElement>(null)

  const close = useCallback(async () => {
    const id = termIdRef.current
    cleanupRef.current?.()
    if (id) await supabase.from('terminals').update({ status: 'closed' }).eq('id', id)
  }, [supabase])

  // Envia bytes ao PTY (input do celular -> daemon).
  const sendInput = useCallback((d: string) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'i', payload: { d } })
  }, [])

  // Insere texto no terminal remoto (texto CRU, sem bracketed-paste — que aparece
  // literal fora de um prompt readline). Tira só a quebra FINAL pra não auto-rodar;
  // quebras internas são intencionais (colar um script roda linha a linha, como
  // num terminal de verdade). `run` acrescenta o Enter pra executar na hora.
  const insertText = useCallback(
    (text: string, run: boolean) => {
      const t = text.replace(/\r?\n$/, '')
      if (t) sendInput(t)
      if (run) sendInput('\r')
      termRef.current?.focus()
    },
    [sendInput],
  )

  // Folha de colar à prova de mobile. A Clipboard API é bloqueada na maioria dos
  // navegadores mobile e o window.prompt é NO-OP em PWA standalone no iOS — então
  // abrimos um <textarea> nosso, onde colar nativo (segurar → Colar) SEMPRE
  // funciona. Quando a Clipboard API responde, já pré-preenchemos por conveniência.
  const openPaste = useCallback(async () => {
    let pre = ''
    try {
      pre = await navigator.clipboard.readText()
    } catch {
      pre = ''
    }
    setPasteText(pre)
    setPasteOpen(true)
  }, [])

  // Desktop (Ctrl+Shift+V): cola direto se o clipboard permitir; senão cai na folha.
  const pasteDirect = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        insertText(text, false)
        return
      }
    } catch {
      /* sem permissão de clipboard — usa a folha */
    }
    void openPaste()
  }, [insertText, openPaste])

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

    // Atalhos do terminal no padrão Linux/Pop OS (GNOME):
    //   Ctrl+Shift+V → colar   ·   Ctrl+Shift+C → copiar a seleção
    // O xterm.js não faz isso sozinho; sem este handler, colar "não acontece".
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true
      const k = e.key.toLowerCase()
      if (k === 'v') {
        e.preventDefault()
        void pasteDirect()
        return false
      }
      if (k === 'c' && term.hasSelection()) {
        e.preventDefault()
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }
      return true
    })

    const channel = supabase.channel(id, {
      config: { private: true, broadcast: { self: false } },
    })
    channel.on('broadcast', { event: 'o' }, ({ payload }) => {
      // remove o enable/disable de bracketed-paste: assim nenhum colar injeta marcadores
      const d = ((payload as { d?: string }).d ?? '').replace(/\x1b\[\?2004[hl]/g, '')
      setRecv((n) => n + d.length)
      term.write(d)
    })
    channel.on('broadcast', { event: 'x' }, () => {
      setPhase('closed')
      setNote('Shell encerrado.')
    })
    // garante o token do Realtime para o canal privado (Broadcast)
    try {
      await supabase.realtime.setAuth()
    } catch {
      /* ignore */
    }
    channel.subscribe((status) => {
      setConn(status)
    })
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
  }, [supabase, ownerId, daemonId, pasteDirect])

  useEffect(() => () => cleanupRef.current?.(), [])

  // Ao abrir a folha de colar, foca o campo (no mobile o usuário toca pra colar).
  useEffect(() => {
    if (pasteOpen) pasteRef.current?.focus()
  }, [pasteOpen])

  const tapKey = (seq: string) => {
    sendInput(seq)
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
          <p className="truncate font-mono text-[11px] text-[var(--color-muted)]">
            {phase === 'active' || phase === 'arming'
              ? `${conn || 'conectando…'} · ${recv}B`
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
        {/* tocar a área do terminal sempre refoca (reabre o teclado virtual) */}
        <div
          ref={containerRef}
          onPointerDown={() => termRef.current?.focus()}
          className="absolute inset-0 px-1 py-1"
        />
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
          <button
            type="button"
            // preventDefault no pointerdown: NÃO tira o foco do terminal (o teclado
            // virtual continua aberto e a digitação não "morre" após tocar aqui).
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void openPaste()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-fg)] transition active:bg-[var(--color-surface-2)]"
          >
            <IconClipboard size={14} /> Colar
          </button>
          {KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => tapKey(k.seq)}
              className="min-w-11 shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs text-[var(--color-fg)] transition active:bg-[var(--color-surface-2)]"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {/* Folha de colar (mobile-proof) — substitui o window.prompt, que é no-op
          em PWA standalone no iOS. Colar nativo num <textarea> sempre funciona. */}
      {pasteOpen && (
        <div
          className="fixed inset-0 z-30 flex flex-col justify-end bg-black/50"
          onPointerDown={() => setPasteOpen(false)}
        >
          <div
            className="rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-bg)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <IconClipboard size={16} /> Colar no terminal
            </div>
            <p className="mb-2 text-xs text-[var(--color-muted)]">
              Cole (segure no campo → Colar) ou digite, depois escolha inserir.
            </p>
            <textarea
              ref={pasteRef}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={3}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Cole o comando aqui…"
              className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setPasteOpen(false)}
                className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-muted)] transition active:scale-[0.99]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  insertText(pasteText, false)
                  setPasteOpen(false)
                }}
                className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm font-medium text-[var(--color-fg)] transition active:scale-[0.99]"
              >
                Inserir
              </button>
              <button
                type="button"
                onClick={() => {
                  insertText(pasteText, true)
                  setPasteOpen(false)
                }}
                className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--color-accent-fg)] transition active:scale-[0.99]"
              >
                Inserir e rodar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
