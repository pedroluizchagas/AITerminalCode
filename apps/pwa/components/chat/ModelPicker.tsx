'use client'

import { useState } from 'react'
import { MODEL_OPTIONS } from '@ati/protocol'
import { IconCheck, IconChevronDown } from '@/components/icons'

/**
 * Equivalente mobile do /model do terminal: mostra o modelo da sessão no
 * header e abre um bottom sheet para trocar. `value` é a escolha persistida
 * (sessions.model; null = padrão); `runningModel` é o que o processo reportou
 * no último system init (exibido quando não há escolha explícita).
 */
export function ModelPicker({
  value,
  runningModel,
  disabled,
  onChange,
}: {
  value: string | null
  runningModel: string | null
  disabled?: boolean
  onChange: (model: string | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Sem escolha explícita (null), o header mostra o modelo que o processo
  // reportou no init — mais informativo que um "Padrão" opaco.
  const current = value ? MODEL_OPTIONS.find((m) => m.value === value) : null
  const label = current?.label ?? value ?? runningModel ?? 'modelo padrão'

  async function pick(next: string | null) {
    if (next === value) {
      setOpen(false)
      return
    }
    setBusy(true)
    try {
      await onChange(next)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-0.5 truncate font-mono text-[11px] text-[var(--color-muted)] transition active:text-[var(--color-fg)] disabled:opacity-60"
      >
        <span className="truncate">{label}</span>
        <IconChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40" role="dialog" aria-label="Escolher modelo">
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-bg)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-[var(--color-border)]" />
            <p className="px-5 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-faint)]">
              Modelo da sessão
            </p>
            <ul>
              {MODEL_OPTIONS.map((m) => (
                <li key={m.value ?? 'default'}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void pick(m.value)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left transition active:bg-[var(--color-surface)] disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{m.label}</span>
                      {m.hint && (
                        <span className="block text-xs text-[var(--color-muted)]">{m.hint}</span>
                      )}
                    </span>
                    {value === m.value && (
                      <IconCheck size={16} className="shrink-0 text-[var(--color-accent)]" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
