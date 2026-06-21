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
}

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

      proc.onData((d) => {
        this.touch(row.id)
        void channel.send({ type: 'broadcast', event: 'o', payload: { d } })
      })
      proc.onExit(({ exitCode }) => {
        void channel.send({ type: 'broadcast', event: 'x', payload: { code: exitCode } })
        this.kill(row.id, 'shell encerrado')
      })

      this.ptys.set(row.id, { proc, channel, lastActivity: Date.now() })
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
