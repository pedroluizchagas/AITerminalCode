import {
  buildAllow,
  buildDeny,
  buildInterrupt,
  buildUserTurn,
  isCanUseToolRequest,
  isForwardableEvent,
  isStreamEvent,
  toolNeedsApproval,
  BROADCAST_STREAM_EVENT,
  type EnvelopeKind,
  type PermissionResPayload,
  type UserTurnPayload,
} from '@ati/protocol'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './log.js'
import { spawnOpenClaude, type OcChild } from './openclaude.js'

interface SessionRow {
  id: string
  project_path: string | null
}

interface PhoneRow {
  session_id: string
  kind: EnvelopeKind
  payload: unknown
}

export class Daemon {
  private children = new Map<string, OcChild>()
  private channels = new Map<string, RealtimeChannel>()
  private sessions = new Map<string, SessionRow>()

  constructor(
    private supabase: SupabaseClient,
    private ownerId: string,
    private daemonId: string,
  ) {}

  // --------------------------------------------------------------------------
  // Ciclo de vida
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    // mensagens vindas do celular (somente source=phone; RLS já restringe ao dono)
    this.supabase
      .channel('daemon-inbound')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'source=eq.phone' },
        (payload) => {
          void this.handlePhoneMessage(payload.new as PhoneRow)
        },
      )
      .subscribe((status) => log.info('inbound channel:', status))

    setInterval(() => void this.heartbeat(), config.heartbeatMs)
    log.info('daemon pronto — aguardando comandos do celular')
  }

  async shutdown(): Promise<void> {
    for (const child of this.children.values()) child.kill()
    await this.setDaemonStatus('offline')
  }

  private async heartbeat(): Promise<void> {
    await this.supabase
      .from('daemons')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', this.daemonId)
  }

  private async setDaemonStatus(status: 'online' | 'offline' | 'working'): Promise<void> {
    await this.supabase
      .from('daemons')
      .update({ status, last_seen_at: new Date().toISOString() })
      .eq('id', this.daemonId)
  }

  // --------------------------------------------------------------------------
  // Celular -> daemon
  // --------------------------------------------------------------------------

  private async handlePhoneMessage(row: PhoneRow): Promise<void> {
    try {
      if (row.kind === 'user_turn') {
        const { content } = row.payload as UserTurnPayload
        await this.setDaemonStatus('working')
        const child = await this.ensureChild(row.session_id)
        child.write(buildUserTurn(content))
        log.info(`turno recebido (session=${row.session_id.slice(0, 8)})`)
      } else if (row.kind === 'permission_res') {
        const p = row.payload as PermissionResPayload
        const child = this.children.get(row.session_id)
        if (!child) return log.warn('permission_res sem child ativo')
        if (p.behavior === 'allow') {
          child.write(buildAllow(p.request_id, p.updatedInput ?? {}))
        } else {
          child.write(buildDeny(p.request_id, p.message ?? 'Negado pelo usuário no celular'))
        }
        await this.supabase
          .from('permission_requests')
          .update({
            status: p.behavior === 'allow' ? 'allowed' : 'denied',
            decided_at: new Date().toISOString(),
            decision_message: p.message ?? null,
          })
          .eq('session_id', row.session_id)
          .eq('request_id', p.request_id)
        log.info(`permissão ${p.behavior} (req=${p.request_id.slice(0, 8)})`)
      } else if (row.kind === 'interrupt') {
        const child = this.children.get(row.session_id)
        child?.write(buildInterrupt(crypto.randomUUID()))
        log.info('interrupt enviado')
      }
    } catch (err) {
      log.error('handlePhoneMessage:', (err as Error).message)
    }
  }

  // --------------------------------------------------------------------------
  // daemon -> filho OpenClaude
  // --------------------------------------------------------------------------

  private async ensureChild(sessionId: string): Promise<OcChild> {
    const existing = this.children.get(sessionId)
    if (existing) return existing

    const session = await this.getSession(sessionId)
    const cwd = session.project_path || config.defaultCwd
    log.info(`spawn OpenClaude (session=${sessionId.slice(0, 8)}, cwd=${cwd})`)

    const child = spawnOpenClaude(
      cwd,
      (msg) => void this.onChildMessage(sessionId, msg),
      () => {
        this.children.delete(sessionId)
        void this.setDaemonStatus('online')
      },
    )
    this.children.set(sessionId, child)
    return child
  }

  private async onChildMessage(sessionId: string, msg: Record<string, unknown>): Promise<void> {
    try {
      if (isCanUseToolRequest(msg)) {
        await this.onPermissionRequest(sessionId, msg)
        return
      }
      if (isStreamEvent(msg)) {
        await this.broadcastStream(sessionId, msg)
        return
      }
      if (isForwardableEvent(msg)) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          await this.updateSessionMeta(sessionId, msg)
        }
        if (msg.type === 'result') {
          await this.setDaemonStatus('online')
        }
        await this.insertMessage(sessionId, 'event', msg)
      }
    } catch (err) {
      log.error('onChildMessage:', (err as Error).message)
    }
  }

  private async onPermissionRequest(
    sessionId: string,
    req: { request_id: string; request: { tool_name: string; input: Record<string, unknown>; tool_use_id: string } },
  ): Promise<void> {
    const tool = req.request.tool_name
    if (config.autoApproveReadonly && !toolNeedsApproval(tool)) {
      this.children.get(sessionId)?.write(buildAllow(req.request_id, req.request.input))
      log.info(`auto-aprovado ${tool}`)
      return
    }
    // persiste o pedido e avisa o celular
    await this.supabase.from('permission_requests').insert({
      session_id: sessionId,
      owner_id: this.ownerId,
      request_id: req.request_id,
      tool_name: tool,
      tool_use_id: req.request.tool_use_id,
      input: req.request.input,
      status: 'pending',
    })
    await this.insertMessage(sessionId, 'permission_req', req)
    log.info(`permissão pendente: ${tool} (aguardando celular)`)
  }

  // --------------------------------------------------------------------------
  // Persistência / realtime
  // --------------------------------------------------------------------------

  private insertMessage(sessionId: string, kind: EnvelopeKind, payload: unknown) {
    return this.supabase.from('messages').insert({
      session_id: sessionId,
      owner_id: this.ownerId,
      source: 'daemon',
      kind,
      payload,
    })
  }

  private async broadcastStream(sessionId: string, msg: unknown): Promise<void> {
    let channel = this.channels.get(sessionId)
    if (!channel) {
      channel = this.supabase.channel(sessionId, {
        config: { private: true, broadcast: { self: false } },
      })
      await channel.subscribe()
      this.channels.set(sessionId, channel)
    }
    await channel.send({ type: 'broadcast', event: BROADCAST_STREAM_EVENT, payload: msg })
  }

  private async updateSessionMeta(sessionId: string, init: Record<string, unknown>): Promise<void> {
    await this.supabase
      .from('sessions')
      .update({
        oc_session_id: (init.session_id as string) ?? null,
        daemon_id: this.daemonId,
      })
      .eq('id', sessionId)
  }

  private async getSession(sessionId: string): Promise<SessionRow> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached
    const { data, error } = await this.supabase
      .from('sessions')
      .select('id, project_path')
      .eq('id', sessionId)
      .single()
    if (error || !data) throw new Error(`sessão ${sessionId} não encontrada: ${error?.message}`)
    const row = data as SessionRow
    this.sessions.set(sessionId, row)
    return row
  }
}
