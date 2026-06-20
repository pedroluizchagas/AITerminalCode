'use client'

import { useState } from 'react'

const COLLAPSE_OVER = 600 // chars

/** Resultado de uma ferramenta (tool_result), colapsável se for grande. */
export function ToolResult({
  content,
  isError,
}: {
  content: string
  isError: boolean
}) {
  const long = content.length > COLLAPSE_OVER
  const [expanded, setExpanded] = useState(!long)
  const shown = expanded ? content : content.slice(0, COLLAPSE_OVER)

  return (
    <div
      className={`my-1 overflow-hidden rounded-lg border ${
        isError
          ? 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5'
          : 'border-[var(--color-border)] bg-[var(--color-bg)]'
      }`}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-faint)]">
          {isError ? 'erro' : 'resultado'}
        </span>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-[var(--color-accent)]"
          >
            {expanded ? 'recolher' : 'ver tudo'}
          </button>
        )}
      </div>
      <pre className="break-anywhere max-h-72 overflow-auto px-3 pb-2 font-mono text-xs text-[var(--color-muted)]">
        {shown}
        {!expanded && long ? '\n…' : ''}
      </pre>
    </div>
  )
}
