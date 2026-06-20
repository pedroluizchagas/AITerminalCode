'use client'

import { useState } from 'react'
import type { PermissionRequestRow } from '@/lib/database.types'

export interface PermissionDecision {
  behavior: 'allow' | 'deny'
  message?: string
}

/**
 * Card de pedido de permissão (can_use_tool). Mostra ferramenta + input e
 * os botões Aprovar / Negar. A ação real (insert permission_res + update da
 * linha) fica no ChatView, que passa onDecide.
 */
export function PermissionCard({
  request,
  onDecide,
}: {
  request: PermissionRequestRow
  onDecide: (req: PermissionRequestRow, decision: PermissionDecision) => Promise<void>
}) {
  const [busy, setBusy] = useState<null | 'allow' | 'deny'>(null)
  const inputStr = JSON.stringify(request.input, null, 2)

  async function decide(behavior: 'allow' | 'deny') {
    setBusy(behavior)
    try {
      await onDecide(request, {
        behavior,
        message: behavior === 'deny' ? 'Negado pelo usuário.' : undefined,
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[92%] rounded-2xl border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/[0.06] p-4">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden>
            🔐
          </span>
          <p className="text-sm font-semibold">
            Permitir{' '}
            <span className="font-mono text-[var(--color-accent)]">{request.tool_name}</span>?
          </p>
        </div>

        <pre className="break-anywhere mt-3 max-h-56 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs text-[var(--color-muted)]">
          {inputStr}
        </pre>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => decide('allow')}
            disabled={busy !== null}
            className="flex-1 rounded-xl bg-[var(--color-success)] px-4 py-3 text-sm font-semibold text-black transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy === 'allow' ? 'Aprovando…' : 'Aprovar'}
          </button>
          <button
            type="button"
            onClick={() => decide('deny')}
            disabled={busy !== null}
            className="flex-1 rounded-xl bg-[var(--color-danger)] px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy === 'deny' ? 'Negando…' : 'Negar'}
          </button>
        </div>
      </div>
    </div>
  )
}
