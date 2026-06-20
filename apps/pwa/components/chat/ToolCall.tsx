'use client'

import { useState } from 'react'

/** Bloco colapsável que mostra uma chamada de ferramenta (tool_use) e seu input. */
export function ToolCall({
  name,
  input,
}: {
  name: string
  input: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const summary = summarizeInput(input)

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs text-[var(--color-faint)]" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="font-mono text-xs font-semibold text-[var(--color-info)]">
          {name}
        </span>
        {summary && !open && (
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-muted)]">
            {summary}
          </span>
        )}
      </button>
      {open && (
        <pre className="break-anywhere max-h-72 overflow-auto border-t border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-muted)]">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  )
}

function summarizeInput(input: Record<string, unknown>): string {
  // Heurística: campos mais úteis primeiro.
  for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query']) {
    const v = input[key]
    if (typeof v === 'string' && v) return v
  }
  const keys = Object.keys(input)
  return keys.length ? `{ ${keys.join(', ')} }` : ''
}
