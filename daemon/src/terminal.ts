import * as pty from 'node-pty'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './log.js'

interface TermRow {
  id: string
  daemon_id: string
  cwd: string | null
  status: string
}

interface Pty {
  proc: pty.IPty
  channel: RealtimeChannel
  lastActivity: number
  /** Despacha imediatamente o que estiver no buffer de saída. */
  flush: () => void
  /** Cancela o timer de flush pendente (chamado no kill). */
  dispose: () => void
}

// Coalescing da saída do PTY. Comandos verbosos (git clone, npm install, builds)
// despejam a saída em centenas de pedaços minúsculos por segundo — sobretudo as
// barras de progresso, que se redesenham via '\r'. Um broadcast por pedaço
// estoura o limite de mensagens/segundo do Realtime (a saída "trava") e, no pior
// caso, vira uma tempestade de POSTs REST quando o socket reconecta. Em vez disso
// acumulamos os bytes e enviamos em lotes a cada FLUSH_MS.
const FLUSH_MS = 30 // latência máxima imperceptível, ~33 lotes/s no teto
const EARLY_FLUSH_BYTES = 16 * 1024 // dispara flush antes do timer se encher
const MAX_MSG_BYTES = 96 * 1024 // fatia por mensagem (teto de payload do Broadcast ~256KB)

/**
 * Gerencia terminais remotos (PTY) sob demanda. O celular cria uma linha em
 * `terminals` (status 'requested'); este daemon (roteado por daemon_id) abre o
 * PTY e troca bytes pelo Realtime Broadcast (canal = id do terminal):
 *   o  = output (daemon -> celular)
 *   i  = input  (celular -> daemon)
 *   rs = resize (celular -> daemon)
 *   x  = exit   (daemon -> celular)
 * Trava de segurança: encerra sozinho após `idleTermMs` sem atividade.
 */
export class TerminalManager {
  private ptys = new Map<string, Pty>()

  constructor(
    private supabase: SupabaseClient,
    private daemonId: string,
  ) {}

  start(): void {
    void this.closeStale()
    this.supabase
      .channel('terminals-inbound')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'terminals',
          filter: `daemon_id=eq.${this.daemonId}`,
        },
        (p) => void this.onRequest(p.new as TermRow),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'terminals',
          filter: `daemon_id=eq.${this.daemonId}`,
        },
        (p) => {
          const row = p.new as TermRow
          if (row.status === 'closed') this.kill(row.id, 'fechado pelo celular')
        },
      )
      .subscribe((s) => log.info('terminals channel:', s))

    setInterval(() => this.reapIdle(), 60_000)
  }

  /** Fecha terminais que ficaram 'active'/'requested' de antes do restart (PTYs mortos). */
  private async closeStale(): Promise<void> {
    await this.supabase
      .from('terminals')
      .update({ status: 'closed', closed_reason: 'daemon reiniciado' })
      .eq('daemon_id', this.daemonId)
      .in('status', ['requested', 'active'])
  }

  private async onRequest(row: TermRow): Promise<void> {
    if (row.status !== 'requested' || this.ptys.has(row.id)) return
    try {
      const proc = pty.spawn(config.shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: row.cwd || config.defaultCwd,
        env: process.env as Record<string, string>,
      })

      const channel = this.supabase.channel(row.id, {
        config: { private: true, broadcast: { self: false } },
      })
      channel.on('broadcast', { event: 'i' }, ({ payload }) => {
        this.touch(row.id)
        try {
          proc.write((payload as { d: string }).d)
        } catch {
          /* pty já morto */
        }
      })
      channel.on('broadcast', { event: 'rs' }, ({ payload }) => {
        const { c, r } = payload as { c: number; r: number }
        try {
          proc.resize(Math.max(1, c | 0), Math.max(1, r | 0))
        } catch {
          /* ignore */
        }
      })
      await channel.subscribe()

      // ----- saída do PTY com coalescing (ver constantes acima) -----
      let buf = ''
      let timer: ReturnType<typeof setTimeout> | null = null
      const flush = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (!buf) return
        const data = buf
        buf = ''
        // fatia para nunca exceder o teto de payload do Broadcast
        for (let i = 0; i < data.length; i += MAX_MSG_BYTES) {
          const d = data.slice(i, i + MAX_MSG_BYTES)
          void channel.send({ type: 'broadcast', event: 'o', payload: { d } })
        }
      }

      proc.onData((d) => {
        this.touch(row.id)
        buf += d
        if (buf.length >= EARLY_FLUSH_BYTES) flush()
        else if (!timer) timer = setTimeout(flush, FLUSH_MS)
      })
      proc.onExit(({ exitCode }) => {
        flush() // garante que a última saída chegue antes do 'x'
        void channel.send({ type: 'broadcast', event: 'x', payload: { code: exitCode } })
        this.kill(row.id, 'shell encerrado')
      })

      this.ptys.set(row.id, {
        proc,
        channel,
        lastActivity: Date.now(),
        flush,
        dispose: () => {
          if (timer) clearTimeout(timer)
        },
      })
      await this.supabase.from('terminals').update({ status: 'active' }).eq('id', row.id)
      log.info(`terminal aberto (${row.id.slice(0, 8)}, cwd=${row.cwd || config.defaultCwd})`)
    } catch (err) {
      log.error('falha ao abrir terminal:', (err as Error).message)
      await this.supabase
        .from('terminals')
        .update({ status: 'closed', closed_reason: 'erro ao abrir' })
        .eq('id', row.id)
    }
  }

  private touch(id: string): void {
    const t = this.ptys.get(id)
    if (t) t.lastActivity = Date.now()
  }

  private kill(id: string, reason: string): void {
    const t = this.ptys.get(id)
    if (!t) return
    this.ptys.delete(id)
    t.flush() // drena o que sobrou no buffer antes de fechar o canal
    t.dispose()
    try {
      t.proc.kill()
    } catch {
      /* ignore */
    }
    void this.supabase.removeChannel(t.channel)
    void this.supabase
      .from('terminals')
      .update({ status: 'closed', closed_reason: reason })
      .eq('id', id)
    log.info(`terminal encerrado (${id.slice(0, 8)}): ${reason}`)
  }

  private reapIdle(): void {
    const now = Date.now()
    for (const [id, t] of [...this.ptys]) {
      if (now - t.lastActivity > config.idleTermMs) this.kill(id, 'ocioso')
    }
  }

  shutdown(): void {
    for (const [id] of [...this.ptys]) this.kill(id, 'daemon encerrado')
  }
}
