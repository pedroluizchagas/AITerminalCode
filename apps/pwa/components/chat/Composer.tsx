'use client'

import { useEffect, useRef, useState } from 'react'
import { MAX_ATTACHMENT_BYTES } from '@ati/protocol'
import { IconFile, IconPaperclip, IconSend, IconStop, IconX } from '@/components/icons'

/** Arquivo escolhido mas ainda não enviado (preview local). */
interface PendingFile {
  id: string
  file: File
  /** Object URL para thumbnail — só imagens; revogado ao remover/enviar. */
  previewUrl: string | null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Composer({
  onSend,
  onInterrupt,
  working,
  disabled,
}: {
  onSend: (text: string, files: File[]) => Promise<void>
  onInterrupt: () => Promise<void>
  working: boolean
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Revoga os object URLs pendentes se o componente desmontar no meio.
  useEffect(() => {
    return () => {
      for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function autosize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  function addFiles(list: FileList | File[]) {
    setError(null)
    const accepted: PendingFile[] = []
    for (const file of Array.from(list)) {
      if (file.size === 0) continue
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name}" passa do limite de ${formatSize(MAX_ATTACHMENT_BYTES)}.`)
        continue
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      })
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted])
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const gone = prev.find((f) => f.id === id)
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((f) => f.id !== id)
    })
  }

  async function send() {
    const t = text.trim()
    if ((!t && files.length === 0) || sending) return
    setSending(true)
    setError(null)
    try {
      await onSend(t, files.map((f) => f.file))
      for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
      setFiles([])
      setText('')
      requestAnimationFrame(() => {
        if (taRef.current) taRef.current.style.height = 'auto'
      })
    } catch (err) {
      // Mantém texto e anexos para tentar de novo.
      setError((err as Error).message || 'Falha ao enviar. Tente novamente.')
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

      {error && (
        <p className="mb-2 px-1 text-xs text-[var(--color-danger)]">{error}</p>
      )}

      {/* chips dos anexos pendentes */}
      {files.length > 0 && (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {files.map((f) =>
            f.previewUrl ? (
              <div key={f.id} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.previewUrl}
                  alt={f.file.name}
                  className="size-16 rounded-xl border border-[var(--color-border)] object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Remover ${f.file.name}`}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-[var(--color-fg)] text-[var(--color-bg)]"
                >
                  <IconX size={11} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div
                key={f.id}
                className="relative flex h-16 max-w-44 shrink-0 items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
              >
                <IconFile size={18} className="shrink-0 text-[var(--color-muted)]" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{f.file.name}</p>
                  <p className="text-[10px] text-[var(--color-faint)]">
                    {formatSize(f.file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  aria-label={`Remover ${f.file.name}`}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-[var(--color-fg)] text-[var(--color-bg)]"
                >
                  <IconX size={11} strokeWidth={2.5} />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* input de arquivo escondido — no celular abre câmera/galeria/arquivos */}
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = '' // permite escolher o mesmo arquivo de novo
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || sending}
          aria-label="Anexar arquivo"
          className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--color-border)] text-[var(--color-muted)] transition active:scale-95 disabled:opacity-40"
        >
          <IconPaperclip size={18} />
        </button>
        <textarea
          ref={taRef}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            autosize()
          }}
          onPaste={(e) => {
            // colar imagem/print direto no campo (desktop e alguns teclados mobile)
            if (e.clipboardData?.files?.length) {
              e.preventDefault()
              addFiles(e.clipboardData.files)
            }
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
          disabled={sending || disabled || (!text.trim() && files.length === 0)}
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
