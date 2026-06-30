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
import { existsSync, statSync } from 'node:fs'
import { config } from './config.js'
import { log } from './log.js'
import { spawnOpenClaude, type OcChild } from './openclaude.js'
import { sendPush } from './push.js'
import { TerminalManager } from './terminal.js'

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
  private lastActivity = new Map<string, number>()
  /** "Sempre permitir": ferramentas auto-aprovadas por sessão (some ao encerrar). */
  private sessionAllow = new Map<string, Set<string>>()
  private terminals: TerminalManager

  constructor(
    private supabase: SupabaseClient,
    private ownerId: string,
    private daemonId: string,
  ) {
    this.terminals = new TerminalManager(supabase, daemonId)
  }

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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions' },
        (payload) => {
          const row = payload.new as { id: string; status: string }
          if (row.status === 'closed') {
            this.killChild(row.id, 'sessão encerrada')
            this.sessionAllow.delete(row.id) // "sempre permitir" não sobrevive ao fim da sessão
          }
        },
      )
      .subscribe((status) => log.info('inbound channel:', status))

    setInterval(() => void this.heartbeat(), config.heartbeatMs)
    setInterval(() => this.reapIdle(), 60_000)
    this.terminals.start()
    log.info('daemon pronto — aguardando comandos do celular')
    await this.catchUp()
  }

  /** Mata o processo OpenClaude de uma sessão (encerrada ou ociosa). */
  private killChild(sessionId: string, reason: string): void {
    const child = this.children.get(sessionId)
    if (!child) return
    log.info(`encerrando processo (session=${sessionId.slice(0, 8)}): ${reason}`)
    child.kill()
    this.children.delete(sessionId)
    this.lastActivity.delete(sessionId)
    // NB: a allowlist de "sempre permitir" NÃO é limpa aqui de propósito — ela
    // sobrevive ao reaping por ociosidade (o processo reinicia, a sessão segue).
    // Só é descartada quando a sessão é encerrada (handler de status='closed').
  }

  /** Marca uma ferramenta como "sempre permitir" nesta sessão (auto-aprova as próximas). */
  private allowToolForSession(sessionId: string, tool: string): void {
    let set = this.sessionAllow.get(sessionId)
    if (!set) {
      set = new Set()
      this.sessionAllow.set(sessionId, set)
    }
    set.add(tool)
  }

  /** Varre e encerra processos ociosos (libera memória). */
  private reapIdle(): void {
    const now = Date.now()
    const stale = [...this.lastActivity.entries()]
      .filter(([, ts]) => now - ts > config.idleReapMs)
      .map(([sid]) => sid)
    for (const sid of stale) this.killChild(sid, 'ocioso')
  }

  /**
   * Ao subir, recupera o que ficou pendente enquanto o daemon esteve fora:
   *  - expira permissões órfãs (o processo que pediu morreu no restart);
   *  - reprocessa o último user_turn ainda não respondido de cada sessão ativa
   *    (ex.: você mandou um prompt com o PC desligado).
   */
  private async catchUp(): Promise<void> {
    try {
      const { data: expired } = await this.supabase
        .from('permission_requests')
        .update({ status: 'expired', decided_at: new Date().toISOString() })
        .eq('owner_id', this.ownerId)
        .eq('status', 'pending')
        .select('id')
      if (expired?.length) log.info(`catch-up: ${expired.length} permissão(ões) órfã(s) expirada(s)`)

      const { data: sessions } = await this.supabase
        .from('sessions')
        .select('id')
        .eq('owner_id', this.ownerId)
        .eq('status', 'active')

      for (const s of sessions ?? []) {
        if (!(await this.routeToMe(s.id))) continue // só minhas sessões
        const { data: last } = await this.supabase
          .from('messages')
          .select('source, kind, payload, created_at')
          .eq('session_id', s.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!last || last.source !== 'phone' || last.kind !== 'user_turn') continue
        // turnos recém-chegados são tratados pela subscription ao vivo
        if (Date.now() - Date.parse(last.created_at as string) < 10_000) continue

        const content = (last.payload as UserTurnPayload).content
        log.info(`catch-up: turno pendente reprocessado (session=${s.id.slice(0, 8)})`)
        await this.setDaemonStatus('working')
        const child = await this.ensureChild(s.id)
        child.write(buildUserTurn(content))
      }
    } catch (err) {
      log.warn('catch-up falhou:', (err as Error).message)
    }
  }

  /**
   * Roteamento multi-máquina: este daemon só cuida das sessões atribuídas a ele.
   *  - daemon_id === eu  → cuido;
   *  - daemon_id de outro → ignoro;
   *  - sem dono (null)   → reivindico atomicamente (só um daemon vence).
   */
  private async routeToMe(sessionId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('sessions')
      .select('daemon_id')
      .eq('id', sessionId)
      .maybeSingle()
    const did = (data as { daemon_id: string | null } | null)?.daemon_id ?? null
    if (did === this.daemonId) return true
    if (did) return false
    const { data: claimed } = await this.supabase
      .from('sessions')
      .update({ daemon_id: this.daemonId })
      .eq('id', sessionId)
      .is('daemon_id', null)
      .select('id')
    return (claimed?.length ?? 0) > 0
  }

  async shutdown(): Promise<void> {
    this.terminals.shutdown()
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
      if (!(await this.routeToMe(row.session_id))) return // sessão de outra máquina
      if (row.kind === 'user_turn') {
        const { content } = row.payload as UserTurnPayload
        await this.setDaemonStatus('working')
        const child = await this.ensureChild(row.session_id)
        this.lastActivity.set(row.session_id, Date.now())
        child.write(buildUserTurn(content))
        log.info(`turno recebido (session=${row.session_id.slice(0, 8)})`)
      } else if (row.kind === 'permission_res') {
        const p = row.payload as PermissionResPayload
        const child = this.children.get(row.session_id)
        if (!child) return log.warn('permission_res sem child ativo')
        if (p.behavior === 'allow') {
          if (p.scope === 'tool' && p.tool_name) {
            this.allowToolForSession(row.session_id, p.tool_name)
            log.info(`"sempre permitir" ${p.tool_name} (session=${row.session_id.slice(0, 8)})`)
          }
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
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      await this.reportError(
        sessionId,
        `Não consegui abrir o projeto: este caminho não existe nesta máquina.\n\n` +
          `"${cwd}"\n\n` +
          `Use um caminho absoluto válido (começando com "/"), ex.: ` +
          `/home/pedrochagas/Documentos/Projetos/SeuProjeto`,
      )
      throw new Error(`cwd inválido: ${cwd}`)
    }
    log.info(`spawn OpenClaude (session=${sessionId.slice(0, 8)}, cwd=${cwd})`)

    const child = spawnOpenClaude(
      cwd,
      (msg) => void this.onChildMessage(sessionId, msg),
      () => {
        this.children.delete(sessionId)
        this.lastActivity.delete(sessionId)
        void this.setDaemonStatus('online')
      },
    )
    this.children.set(sessionId, child)
    this.lastActivity.set(sessionId, Date.now())
    return child
  }

  private async onChildMessage(sessionId: string, msg: Record<string, unknown>): Promise<void> {
    this.lastActivity.set(sessionId, Date.now())
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
          const ok = msg.subtype === 'success'
          const snippet =
            ok && typeof msg.result === 'string'
              ? msg.result.slice(0, 120)
              : 'Erro na execução'
          void sendPush(this.supabase, this.ownerId, {
            title: ok ? 'Tarefa concluída ✅' : 'Tarefa falhou ⚠️',
            body: snippet,
            sessionId,
            tag: 'result',
          })
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
    if (this.sessionAllow.get(sessionId)?.has(tool)) {
      this.children.get(sessionId)?.write(buildAllow(req.request_id, req.request.input))
      log.info(`auto-aprovado (sempre permitir) ${tool}`)
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
    void sendPush(this.supabase, this.ownerId, {
      title: 'Aprovação necessária 🔐',
      body: `O agente quer usar: ${tool}`,
      sessionId,
      tag: `perm-${req.request_id}`,
    })
    log.info(`permissão pendente: ${tool} (aguardando celular)`)
  }

  // --------------------------------------------------------------------------
  // Persistência / realtime
  // --------------------------------------------------------------------------

  /** Mostra um erro como evento no chat e libera o status (não fica "trabalhando"). */
  private async reportError(sessionId: string, message: string): Promise<void> {
    await this.setDaemonStatus('online')
    await this.insertMessage(sessionId, 'event', {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      result: message,
      total_cost_usd: 0,
      duration_ms: 0,
      num_turns: 0,
      session_id: '',
    })
  }

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
