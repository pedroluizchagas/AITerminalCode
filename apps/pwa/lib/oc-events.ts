/**
 * Interpretação dos payloads NDJSON nativos do OpenClaude que chegam nas linhas
 * de `messages` (kind:'event'). Mapeia o objeto cru para itens renderáveis.
 *
 * Os payloads são objetos opacos (`unknown`) vindos do banco; aqui fazemos o
 * narrowing defensivo. Nada explode se o formato vier ligeiramente diferente.
 */

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error: boolean
}

type Record_ = Record<string, unknown>

function asRecord(v: unknown): Record_ | null {
  return v && typeof v === 'object' ? (v as Record_) : null
}

function ocType(payload: unknown): string | null {
  const r = asRecord(payload)
  return r && typeof r.type === 'string' ? r.type : null
}

export function isAssistantEvent(payload: unknown): boolean {
  return ocType(payload) === 'assistant'
}
export function isUserEcho(payload: unknown): boolean {
  return ocType(payload) === 'user'
}
export function isResultEvent(payload: unknown): boolean {
  return ocType(payload) === 'result'
}
export function isSystemInit(payload: unknown): boolean {
  const r = asRecord(payload)
  return r?.type === 'system' && r?.subtype === 'init'
}

/** Blocos de conteúdo de uma mensagem do assistant (text + tool_use). */
export function assistantBlocks(payload: unknown): Array<TextBlock | ToolUseBlock> {
  const r = asRecord(payload)
  const msg = asRecord(r?.message)
  const content = msg?.content
  if (!Array.isArray(content)) {
    // Algumas variantes mandam string direta.
    if (typeof content === 'string' && content) return [{ type: 'text', text: content }]
    return []
  }
  const out: Array<TextBlock | ToolUseBlock> = []
  for (const raw of content) {
    const b = asRecord(raw)
    if (!b) continue
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text })
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      out.push({
        type: 'tool_use',
        id: typeof b.id === 'string' ? b.id : '',
        name: b.name,
        input: asRecord(b.input) ?? {},
      })
    }
  }
  return out
}

/** Blocos tool_result de um echo `user`. */
export function toolResults(payload: unknown): ToolResultBlock[] {
  const r = asRecord(payload)
  const msg = asRecord(r?.message)
  const content = msg?.content
  if (!Array.isArray(content)) return []
  const out: ToolResultBlock[] = []
  for (const raw of content) {
    const b = asRecord(raw)
    if (!b || b.type !== 'tool_result') continue
    out.push({
      type: 'tool_result',
      tool_use_id: typeof b.tool_use_id === 'string' ? b.tool_use_id : '',
      content: stringifyToolResultContent(b.content),
      is_error: b.is_error === true,
    })
  }
  return out
}

function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const r = asRecord(c)
        if (r && r.type === 'text' && typeof r.text === 'string') return r.text
        return typeof c === 'string' ? c : JSON.stringify(c)
      })
      .join('\n')
  }
  if (content == null) return ''
  return JSON.stringify(content, null, 2)
}

export interface ResultInfo {
  result: string
  isError: boolean
  totalCostUsd: number | null
  durationMs: number | null
  numTurns: number | null
}

export function resultInfo(payload: unknown): ResultInfo {
  const r = asRecord(payload) ?? {}
  return {
    result: typeof r.result === 'string' ? r.result : '',
    isError: r.is_error === true,
    totalCostUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null,
    durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : null,
    numTurns: typeof r.num_turns === 'number' ? r.num_turns : null,
  }
}

export interface SystemInitInfo {
  model: string | null
  cwd: string | null
  tools: string[]
}

export function systemInitInfo(payload: unknown): SystemInitInfo {
  const r = asRecord(payload) ?? {}
  return {
    model: typeof r.model === 'string' ? r.model : null,
    cwd: typeof r.cwd === 'string' ? r.cwd : null,
    tools: Array.isArray(r.tools) ? r.tools.filter((t): t is string => typeof t === 'string') : [],
  }
}

/** Texto da minha mensagem (user_turn) gravada pelo phone. */
export function userTurnText(payload: unknown): string {
  const r = asRecord(payload)
  const content = r?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const b = asRecord(c)
        return b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Stream deltas ao vivo (broadcast 'stream_event') -> texto incremental.
// O payload é { type:'stream_event', event: <raw Anthropic message stream delta> }.
// Extraímos só os deltas de texto para o efeito de "digitando".
// ---------------------------------------------------------------------------
export function streamTextDelta(payload: unknown): string | null {
  const r = asRecord(payload)
  const event = asRecord(r?.event) ?? r // tolera payload já desembrulhado
  if (!event) return null
  if (event.type === 'content_block_delta') {
    const delta = asRecord(event.delta)
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text
  }
  return null
}

/** Detecta fim de turno no stream para limpar o buffer ao vivo. */
export function isStreamTurnEnd(payload: unknown): boolean {
  const r = asRecord(payload)
  const event = asRecord(r?.event) ?? r
  return event?.type === 'message_stop'
}
