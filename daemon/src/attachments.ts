/**
 * Anexos: do Storage (Supabase) para o turno do OpenClaude.
 *
 * O celular sobe o binário ao bucket privado e grava só metadados no
 * user_turn. Aqui o daemon (logado na MESMA conta → mesma RLS):
 *  1. baixa cada anexo e salva uma cópia local (as ferramentas do agente
 *     — Read/Bash/Edit — enxergam o arquivo pelo caminho);
 *  2. monta o content do turno:
 *     - imagem  → bloco `image` base64 (o modelo vê de imediato);
 *     - PDF     → bloco `document` base64 (suporte nativo da API);
 *     - resto/grandes → só o caminho local + instrução de usar Read.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ATTACHMENTS_BUCKET,
  isImageMime,
  isPdfMime,
  type AttachmentMeta,
  type UserTurnPayload,
} from '@ati/protocol'
import { config } from './config.js'
import { log } from './log.js'

/** Limite da Anthropic API por imagem é 5MB; folga para não raspar o teto. */
const MAX_INLINE_IMAGE_BYTES = 4.5 * 1024 * 1024
/** PDFs inline: acima disso (ou >100 págs, que não dá pra saber aqui) fica só o caminho. */
const MAX_INLINE_PDF_BYTES = 8 * 1024 * 1024

interface Materialized {
  meta: AttachmentMeta
  localPath: string
  buffer: Buffer
}

interface Failed {
  meta: AttachmentMeta
  reason: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Diretório local dos anexos de uma sessão (limpo quando a sessão encerra). */
export function sessionAttachmentsDir(sessionId: string): string {
  return path.join(config.attachmentsDir, sessionId)
}

export async function cleanupSessionAttachments(sessionId: string): Promise<void> {
  try {
    await rm(sessionAttachmentsDir(sessionId), { recursive: true, force: true })
  } catch (err) {
    log.warn('limpeza de anexos falhou:', (err as Error).message)
  }
}

async function materialize(
  supabase: SupabaseClient,
  sessionId: string,
  metas: AttachmentMeta[],
): Promise<{ ok: Materialized[]; failed: Failed[] }> {
  const ok: Materialized[] = []
  const failed: Failed[] = []
  const dir = sessionAttachmentsDir(sessionId)
  await mkdir(dir, { recursive: true })

  for (const meta of metas) {
    try {
      const { data, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .download(meta.storage_path)
      if (error || !data) throw new Error(error?.message ?? 'download vazio')
      const buffer = Buffer.from(await data.arrayBuffer())

      // O storage_path termina em <uuid>/<nome>; o prefixo do uuid evita
      // colisão local entre anexos de mesmo nome na mesma sessão.
      const parts = meta.storage_path.split('/')
      const uid = (parts[parts.length - 2] ?? crypto.randomUUID()).slice(0, 8)
      const base = path.basename(parts[parts.length - 1] ?? meta.name)
      const localPath = path.join(dir, `${uid}-${base}`)
      await writeFile(localPath, buffer)

      ok.push({ meta, localPath, buffer })
      log.info(`anexo baixado: ${meta.name} (${formatSize(meta.size)}) → ${localPath}`)
    } catch (err) {
      const reason = (err as Error).message
      failed.push({ meta, reason })
      log.error(`anexo ${meta.name} falhou: ${reason}`)
    }
  }
  return { ok, failed }
}

/**
 * Resolve o content final do turno. Sem anexos, devolve o content original
 * intocado (caminho de sempre). Com anexos, devolve um array de blocos de
 * conteúdo (estilo Anthropic API) — o OpenClaude repassa como está.
 */
export async function prepareTurnContent(
  supabase: SupabaseClient,
  sessionId: string,
  payload: UserTurnPayload,
): Promise<string | unknown[]> {
  const metas = payload.attachments ?? []
  if (metas.length === 0) return payload.content

  const { ok, failed } = await materialize(supabase, sessionId, metas)

  const blocks: unknown[] = []
  const notes: string[] = []

  for (const { meta, localPath, buffer } of ok) {
    if (isImageMime(meta.mime) && buffer.length <= MAX_INLINE_IMAGE_BYTES) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: meta.mime, data: buffer.toString('base64') },
      })
      notes.push(`- ${meta.name} → ${localPath} (${meta.mime}) [imagem incluída neste turno]`)
    } else if (isPdfMime(meta.mime) && buffer.length <= MAX_INLINE_PDF_BYTES) {
      blocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
      })
      notes.push(`- ${meta.name} → ${localPath} (PDF) [documento incluído neste turno]`)
    } else {
      notes.push(
        `- ${meta.name} → ${localPath} (${meta.mime}, ${formatSize(buffer.length)}) ` +
          `[use a ferramenta Read para ler]`,
      )
    }
  }
  for (const { meta, reason } of failed) {
    notes.push(`- ${meta.name} — FALHOU ao baixar do Storage (${reason}); avise o usuário.`)
  }

  const userText = typeof payload.content === 'string' ? payload.content.trim() : ''
  const noteBlock = `[Anexos enviados pelo celular — cópias locais nesta máquina]\n${notes.join('\n')}`
  const text = userText ? `${userText}\n\n${noteBlock}` : noteBlock

  blocks.push({ type: 'text', text })
  return blocks
}
