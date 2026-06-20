/**
 * @ati/protocol — tipos e helpers compartilhados entre o daemon e a PWA.
 *
 * Duas camadas:
 *  1. Contrato do OpenClaude headless (Agent SDK por stdio) — ver
 *     ClaudeClone/FASE-0-PROTOCOLO.md. Prefixo `Oc`.
 *  2. Camada de transporte phone <-> daemon (via Supabase). `Envelope` +
 *     mapeamento direto para a tabela `messages`.
 */

// ============================================================================
// 1) OpenClaude — STDIN (daemon -> processo filho)
// ============================================================================

export interface OcUserTurn {
  type: 'user'
  message: { role: 'user'; content: string | unknown[] }
  parent_tool_use_id: null
  /** '' é aceito; o filho preenche o session_id real. */
  session_id: string
}

export type PermissionBehavior = 'allow' | 'deny'

export interface OcControlResponseSuccess {
  type: 'control_response'
  response: {
    subtype: 'success'
    request_id: string
    response:
      | { behavior: 'allow'; updatedInput: Record<string, unknown> }
      | { behavior: 'deny'; message: string }
  }
}

export interface OcInterrupt {
  type: 'control_request'
  request_id: string
  request: { subtype: 'interrupt' }
}

export type OcStdin = OcUserTurn | OcControlResponseSuccess | OcInterrupt

// ============================================================================
// 2) OpenClaude — STDOUT (processo filho -> daemon)
// ============================================================================

export interface OcCanUseToolRequest {
  type: 'control_request'
  request_id: string
  request: {
    subtype: 'can_use_tool'
    tool_name: string
    input: Record<string, unknown>
    tool_use_id: string
    title?: string
    display_name?: string
    description?: string
    permission_suggestions?: unknown[]
    blocked_path?: string
    decision_reason?: string
    agent_id?: string
  }
}

export interface OcAssistant {
  type: 'assistant'
  message: unknown
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
  error?: unknown
}

export interface OcUserEcho {
  type: 'user'
  message: unknown
  parent_tool_use_id?: string | null
  uuid?: string
  session_id: string
}

export interface OcStreamEvent {
  type: 'stream_event'
  event: unknown
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export interface OcSystemInit {
  type: 'system'
  subtype: 'init'
  model: string
  cwd: string
  tools: string[]
  skills?: string[]
  slash_commands?: string[]
  permissionMode: string
  session_id: string
  [k: string]: unknown
}

export interface OcResult {
  type: 'result'
  subtype: string
  result?: string
  is_error: boolean
  total_cost_usd: number
  duration_ms: number
  num_turns: number
  session_id: string
  [k: string]: unknown
}

export type OcStdout =
  | OcAssistant
  | OcUserEcho
  | OcStreamEvent
  | OcSystemInit
  | OcResult
  | OcCanUseToolRequest
  | { type: string; [k: string]: unknown }

// ----- type guards / filtros -----

export function isCanUseToolRequest(m: unknown): m is OcCanUseToolRequest {
  const x = m as Record<string, unknown> | null
  return (
    !!x &&
    x.type === 'control_request' &&
    typeof x.request === 'object' &&
    x.request !== null &&
    (x.request as Record<string, unknown>).subtype === 'can_use_tool'
  )
}

const IGNORED_STDOUT = new Set([
  'control_response',
  'control_cancel_request',
  'keep_alive',
  'streamlined_text',
  'streamlined_tool_use_summary',
])

/** Eventos de conteúdo que devem ser encaminhados ao celular (assistant/user/result/system). */
export function isForwardableEvent(m: unknown): boolean {
  const x = m as Record<string, unknown> | null
  if (!x || typeof x.type !== 'string') return false
  if (IGNORED_STDOUT.has(x.type)) return false
  if (x.type === 'system' && x.subtype === 'post_turn_summary') return false
  if (x.type === 'control_request') return false // permissão/interrupt tratados à parte
  return true
}

export function isStreamEvent(m: unknown): m is OcStreamEvent {
  return (m as Record<string, unknown>)?.type === 'stream_event'
}

// ----- builders de STDIN -----

export function buildUserTurn(content: string | unknown[], sessionId = ''): OcUserTurn {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: sessionId,
  }
}

export function buildAllow(
  requestId: string,
  updatedInput: Record<string, unknown>,
): OcControlResponseSuccess {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: { behavior: 'allow', updatedInput },
    },
  }
}

export function buildDeny(requestId: string, message: string): OcControlResponseSuccess {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: { behavior: 'deny', message },
    },
  }
}

export function buildInterrupt(requestId: string): OcInterrupt {
  return { type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } }
}

// ============================================================================
// 3) Envelope — camada de transporte phone <-> daemon (tabela `messages`)
// ============================================================================

export type EnvelopeSource = 'phone' | 'daemon'

export type EnvelopeKind =
  | 'user_turn' // phone -> daemon: novo prompt
  | 'event' // daemon -> phone: assistant/user/result/system
  | 'permission_req' // daemon -> phone: can_use_tool pendente
  | 'permission_res' // phone -> daemon: approve/deny
  | 'interrupt' // phone -> daemon: Ctrl+C
  | 'status' // daemon -> phone: online/idle/working

/** Espelha uma linha de `public.messages`. id/ts vêm do banco. */
export interface Envelope<P = unknown> {
  id?: string
  session_id: string
  source: EnvelopeSource
  kind: EnvelopeKind
  payload: P
  created_at?: string
}

export interface UserTurnPayload {
  content: string | unknown[]
}

export interface PermissionResPayload {
  request_id: string
  behavior: PermissionBehavior
  message?: string
  updatedInput?: Record<string, unknown>
}

// ============================================================================
// 4) Realtime — canais e política de permissão
// ============================================================================

/** Canal de Broadcast (privado) por sessão — usado só para o stream ao vivo. */
export function sessionChannel(sessionId: string): string {
  return sessionId // topic = id da sessão (RLS em realtime.messages valida o dono)
}

export const BROADCAST_STREAM_EVENT = 'stream_event'

/** Ferramentas read-only que o daemon pode auto-aprovar (configurável). */
export const READONLY_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'LS',
  'TodoWrite',
  'WebSearch',
  'NotebookRead',
])

/**
 * Política padrão: read-only auto-aprova; tudo o mais (Bash/Write/Edit e
 * ferramentas desconhecidas) exige toque em "Aprovar" no celular.
 */
export function toolNeedsApproval(toolName: string): boolean {
  return !READONLY_TOOLS.has(toolName)
}
