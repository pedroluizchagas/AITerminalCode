'use client'

import { useRef, useState } from 'react'
import { IconSend, IconStop } from '@/components/icons'

export function Composer({
  onSend,
  onInterrupt,
  working,
  disabled,
}: {
  onSend: (text: string) => Promise<void>
  onInterrupt: () => Promise<void>
  working: boolean
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)

  function autosize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function send() {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await onSend(t)
      setText('')
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = 'auto'
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {working && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
            Trabalhando…
          </span>
          <button
            type="button"
            onClick={onInterrupt}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-danger)]/50 px-3 py-1 text-xs font-medium text-[var(--color-danger)] transition active:scale-95"
          >
            <IconStop size={13} /> Interromper
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            autosize()
          }}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha. (Em telas de toque o teclado
            // costuma mandar newline; o botão Enviar cobre esse caso.)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          placeholder={disabled ? 'Sessão encerrada' : 'Mensagem para o OpenClaude…'}
          className="max-h-40 flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] disabled:opacity-60"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || disabled || !text.trim()}
          aria-label="Enviar"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition active:scale-95 disabled:opacity-40"
        >
          {sending ? (
            <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <IconSend size={18} />
          )}
        </button>
      </div>
    </div>
  )
}
