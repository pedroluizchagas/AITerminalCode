'use client'

import type { MessageRow } from '@/lib/database.types'
import {
  assistantBlocks,
  isAssistantEvent,
  isResultEvent,
  isSystemInit,
  isUserEcho,
  resultInfo,
  toolResults,
  userTurnText,
} from '@/lib/oc-events'
import { ToolCall } from './ToolCall'
import { ToolResult } from './ToolResult'

/**
 * Renderiza UMA linha de `messages` no seu formato visual conforme kind/payload.
 * Retorna null para coisas que não devem virar bolha (ex.: system init — vai pro header).
 */
export function MessageItem({ message }: { message: MessageRow }) {
  // Meu prompt
  if (message.kind === 'user_turn') {
    const text = userTurnText(message.payload)
    if (!text) return null
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-anywhere rounded-2xl rounded-br-md bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[var(--color-accent-fg)]">
          {text}
        </div>
      </div>
    )
  }

  if (message.kind === 'event') {
    const p = message.payload

    if (isSystemInit(p)) return null // mostrado no header

    if (isAssistantEvent(p)) {
      const blocks = assistantBlocks(p)
      if (blocks.length === 0) return null
      return (
        <div className="flex justify-start">
          <div className="max-w-[92%] space-y-1">
            {blocks.map((b, i) =>
              b.type === 'text' ? (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-anywhere rounded-2xl rounded-bl-md bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-fg)]"
                >
                  {b.text}
                </div>
              ) : (
                <ToolCall key={i} name={b.name} input={b.input} />
              ),
            )}
          </div>
        </div>
      )
    }

    if (isUserEcho(p)) {
      const results = toolResults(p)
      if (results.length === 0) return null
      return (
        <div className="flex justify-start">
          <div className="w-full max-w-[92%] space-y-1">
            {results.map((r, i) => (
              <ToolResult key={i} content={r.content} isError={r.is_error} />
            ))}
          </div>
        </div>
      )
    }

    if (isResultEvent(p)) {
      const info = resultInfo(p)
      return (
        <div className="flex justify-center">
          <div className="w-full max-w-[92%] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/50 px-4 py-2.5 text-xs">
            {info.result && (
              <p
                className={`whitespace-pre-wrap break-anywhere ${
                  info.isError ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]'
                }`}
              >
                {info.result}
              </p>
            )}
            <p className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-[var(--color-faint)]">
              {info.isError && <span className="text-[var(--color-danger)]">com erro</span>}
              {info.numTurns != null && <span>{info.numTurns} turno(s)</span>}
              {info.durationMs != null && <span>{(info.durationMs / 1000).toFixed(1)}s</span>}
              {info.totalCostUsd != null && (
                <span>${info.totalCostUsd.toFixed(4)}</span>
              )}
            </p>
          </div>
        </div>
      )
    }

    return null
  }

  if (message.kind === 'status') {
    const status =
      typeof message.payload === 'object' && message.payload && 'status' in message.payload
        ? String((message.payload as { status: unknown }).status)
        : ''
    if (!status) return null
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-[var(--color-surface)] px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
          {status}
        </span>
      </div>
    )
  }

  // permission_req / permission_res são tratados fora (PermissionCard / silêncio).
  return null
}
