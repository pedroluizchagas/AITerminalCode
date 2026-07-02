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

/** Troca o modelo do processo VIVO (equivale ao /model do modo interativo). */
export interface OcSetModel {
  type: 'control_request'
  request_id: string
  request: { subtype: 'set_model'; model: string }
}

export type OcStdin = OcUserTurn | OcControlResponseSuccess | OcInterrupt | OcSetModel

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

/** `model` null volta ao padrão (alias 'default' do OpenClaude). */
export function buildSetModel(requestId: string, model: string | null): OcSetModel {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_model', model: model ?? 'default' },
  }
}

// ============================================================================
// Modelos — opções expostas no seletor do celular (equivalente ao /model)
// ============================================================================

export interface ModelOption {
  /** Alias aceito pelo OpenClaude (--model / set_model). null = padrão. */
  value: string | null
  label: string
  hint?: string
}

/**
 * Aliases (não IDs fixos): o OpenClaude resolve cada um para o modelo mais
 * novo daquela família, então a lista não envelhece a cada release da API.
 *
 * Exceção: Fable NÃO tem alias no clone (`--model fable` quebra o turno com
 * erro sintético) — entra por ID completo, verificado ao vivo no spawn e no
 * set_model. Quando sair um Fable novo, atualizar os IDs aqui.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { value: null, label: 'Padrão', hint: 'decisão do OpenClaude' },
  { value: 'claude-fable-5', label: 'Fable 5', hint: 'tier acima do Opus' },
  { value: 'claude-fable-5[1m]', label: 'Fable 5 1M', hint: 'contexto de 1 milhão de tokens' },
  { value: 'best', label: 'Best', hint: 'o mais capaz disponível' },
  { value: 'opus', label: 'Opus', hint: 'tarefas complexas' },
  { value: 'sonnet', label: 'Sonnet', hint: 'equilíbrio velocidade/capacidade' },
  { value: 'haiku', label: 'Haiku', hint: 'rápido e econômico' },
  { value: 'opusplan', label: 'OpusPlan', hint: 'Opus planeja, Sonnet executa' },
  { value: 'sonnet[1m]', label: 'Sonnet 1M', hint: 'contexto de 1 milhão de tokens' },
  { value: 'opus[1m]', label: 'Opus 1M', hint: 'contexto de 1 milhão de tokens' },
]

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
  /** Metadados dos arquivos enviados junto (o binário fica no Storage). */
  attachments?: AttachmentMeta[]
}

// ============================================================================
// 3b) Anexos — arquivos enviados pelo celular junto de um user_turn
// ============================================================================

/** Bucket privado no Supabase Storage onde a PWA sobe os anexos. */
export const ATTACHMENTS_BUCKET = 'attachments'

/** Limite por arquivo — espelha o file_size_limit do bucket (migration). */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * Metadados de UM anexo, gravados no payload do user_turn. O binário nunca
 * passa pela tabela `messages` (limite de payload do Realtime): a PWA sobe ao
 * Storage e o daemon baixa pelo storage_path — ambos na conta do dono, então
 * a mesma RLS cobre os dois lados.
 */
export interface AttachmentMeta {
  /** Caminho no bucket: <owner_id>/<session_id>/<uuid>/<nome-original>. */
  storage_path: string
  name: string
  mime: string
  size: number
}

/** Tipos de imagem que a Anthropic API aceita como bloco `image` base64. */
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has(mime)
}

export function isPdfMime(mime: string): boolean {
  return mime === 'application/pdf'
}

/**
 * Escopo da decisão de permissão:
 *  - 'once' (default): vale só para este pedido;
 *  - 'tool': "sempre permitir" — o daemon passa a auto-aprovar as próximas
 *    chamadas desta mesma ferramenta nesta sessão (em memória, dura o ciclo
 *    de vida da sessão; some quando a sessão é encerrada).
 */
export type PermissionScope = 'once' | 'tool'

export interface PermissionResPayload {
  request_id: string
  behavior: PermissionBehavior
  message?: string
  updatedInput?: Record<string, unknown>
  scope?: PermissionScope
  /** Nome da ferramenta — necessário p/ a allowlist da sessão quando scope='tool'. */
  tool_name?: string
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
