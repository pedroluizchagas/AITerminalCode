'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MODEL_OPTIONS } from '@ati/protocol'
import { IconCheck, IconChevronDown } from '@/components/icons'

/**
 * Equivalente mobile do /model do terminal: mostra o modelo da sessão no
 * header e abre um seletor para trocar. `value` é a escolha persistida
 * (sessions.model; null = padrão); `runningModel` é o que o processo reportou
 * no último system init (exibido quando não há escolha explícita).
 *
 * O seletor é um bottom sheet no celular e um dialog centrado em telas ≥sm,
 * SEMPRE via portal no <body>: o header tem backdrop-blur, e backdrop-filter
 * cria containing block — um `fixed` renderizado ali dentro se posiciona
 * relativo ao header (e ainda seria clipado pelo truncate), não à viewport.
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
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sem escolha explícita (null), o header mostra o modelo que o processo
  // reportou no init — mais informativo que um "Padrão" opaco.
  const current = value ? MODEL_OPTIONS.find((m) => m.value === value) : null
  const label = current?.label ?? value ?? runningModel ?? 'modelo padrão'

  const finishClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
    setOpen(false)
    setClosing(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  /** Fecha COM a animação de saída; o unmount acontece no animationend. */
  const requestClose = useCallback(() => {
    setClosing(true)
    // rede de segurança caso animationend não dispare
    closeTimer.current = setTimeout(finishClose, 400)
  }, [finishClose])

  // Escape fecha; trava o scroll da página enquanto aberto.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    sheetRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, requestClose])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  async function pick(next: string | null) {
    if (next === value) {
      requestClose()
      return
    }
    setBusy(true)
    try {
      await onChange(next)
      requestClose()
    } finally {
      setBusy(false)
    }
  }

  // ---- arrastar para baixo dispensa (só no gesto, celular) ----
  const drag = useRef<{ startY: number; startT: number; dy: number } | null>(null)

  function onDragStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse') return // desktop usa Escape/click fora
    drag.current = { startY: e.clientY, startT: e.timeStamp, dy: 0 }
    sheetRef.current?.setAttribute('data-dragging', 'true')
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onDragMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const sheet = sheetRef.current
    if (!d || !sheet) return
    d.dy = Math.max(0, e.clientY - d.startY)
    sheet.style.transform = `translateY(${d.dy}px)`
  }
  function onDragEnd(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const sheet = sheetRef.current
    drag.current = null
    if (!d || !sheet) return
    sheet.removeAttribute('data-dragging')
    const velocity = d.dy / Math.max(1, e.timeStamp - d.startT) // px/ms
    if (d.dy > 90 || velocity > 0.5) {
      // segue do ponto onde o dedo soltou — sem pulo de volta ao topo
      sheet.style.transition = 'transform 200ms cubic-bezier(0.3, 0, 1, 1)'
      sheet.style.transform = 'translateY(100%)'
      setTimeout(finishClose, 200)
    } else {
      sheet.style.transition = 'transform 250ms cubic-bezier(0.2, 0, 0, 1)'
      sheet.style.transform = 'translateY(0)'
      setTimeout(() => {
        sheet.style.transition = ''
        sheet.style.transform = ''
      }, 260)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex max-w-full items-center gap-0.5 truncate font-mono text-[11px] text-[var(--color-muted)] transition active:text-[var(--color-fg)] disabled:opacity-60"
      >
        <span className="truncate">{label}</span>
        <IconChevronDown size={12} className="shrink-0" />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
            role="dialog"
            aria-modal="true"
            aria-label="Escolher modelo"
          >
            {/* backdrop — camada secundária */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              data-closing={closing || undefined}
              onClick={requestClose}
              className="ati-overlay absolute inset-0 cursor-default bg-black/60"
            />

            {/* sheet (celular) / dialog (≥sm) — camada primária */}
            <div
              ref={sheetRef}
              tabIndex={-1}
              data-closing={closing || undefined}
              onAnimationEnd={(e) => {
                if (closing && e.target === sheetRef.current) finishClose()
              }}
              className="ati-sheet relative w-full rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:w-auto sm:min-w-80 sm:max-w-sm sm:rounded-2xl sm:border sm:pb-2"
            >
              {/* zona de arrasto: alça + título */}
              <div
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className="touch-none select-none"
              >
                <div className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-[var(--color-border)] sm:hidden" />
                <div className="flex items-baseline justify-between px-5 pb-2 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-faint)]">
                    Modelo da sessão
                  </p>
                  {runningModel && (
                    <p className="truncate pl-3 font-mono text-[10px] text-[var(--color-faint)]">
                      {runningModel}
                    </p>
                  )}
                </div>
              </div>

              <ul className="max-h-[60dvh] overflow-y-auto overscroll-contain">
                {MODEL_OPTIONS.map((m, i) => {
                  const selected = value === m.value
                  return (
                    <li
                      key={m.value ?? 'default'}
                      className="ati-sheet-item"
                      style={{ animationDelay: `${i * 25}ms` }}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void pick(m.value)}
                        className={`flex w-full items-center gap-3 px-5 py-3 text-left transition active:bg-[var(--color-surface-2)] disabled:opacity-60 ${
                          selected ? 'bg-[var(--color-surface-2)]/60' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-sm font-medium ${
                              selected ? 'text-[var(--color-accent)]' : ''
                            }`}
                          >
                            {m.label}
                          </span>
                          {m.hint && (
                            <span className="block text-xs text-[var(--color-muted)]">
                              {m.hint}
                            </span>
                          )}
                        </span>
                        {selected && (
                          <IconCheck size={16} className="shrink-0 text-[var(--color-accent)]" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
