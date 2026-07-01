'use client'

import { useEffect, useMemo, useState } from 'react'
import { ATTACHMENTS_BUCKET, isImageMime, type AttachmentMeta } from '@ati/protocol'
import { createClient } from '@/lib/supabase/client'
import { IconFile } from '@/components/icons'

/** O bucket é privado — cada preview/abertura usa uma URL assinada curta. */
function useSignedUrl(path: string): string | null {
  const supabase = useMemo(() => createClient(), [])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (alive && data?.signedUrl) setUrl(data.signedUrl)
      })
    return () => {
      alive = false
    }
  }, [supabase, path])
  return url
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ImageAttachment({ att }: { att: AttachmentMeta }) {
  const url = useSignedUrl(att.storage_path)
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="block overflow-hidden rounded-xl border border-[var(--color-border)]"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={att.name} loading="lazy" className="max-h-48 w-auto max-w-full object-cover" />
      ) : (
        <div className="grid h-24 w-32 place-items-center bg-[var(--color-surface)] text-[10px] text-[var(--color-faint)]">
          carregando…
        </div>
      )}
    </a>
  )
}

function FileAttachment({ att }: { att: AttachmentMeta }) {
  const url = useSignedUrl(att.storage_path)
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
    >
      <IconFile size={16} className="shrink-0 text-[var(--color-muted)]" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-[var(--color-fg)]">{att.name}</span>
        <span className="block text-[10px] text-[var(--color-faint)]">
          {att.mime} · {formatSize(att.size)}
        </span>
      </span>
    </a>
  )
}

/** Anexos de um user_turn no histórico: imagem vira thumbnail, o resto vira chip. */
export function AttachmentList({ attachments }: { attachments: AttachmentMeta[] }) {
  if (attachments.length === 0) return null
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {attachments.map((att) =>
        isImageMime(att.mime) ? (
          <ImageAttachment key={att.storage_path} att={att} />
        ) : (
          <FileAttachment key={att.storage_path} att={att} />
        ),
      )}
    </div>
  )
}
