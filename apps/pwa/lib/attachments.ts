/**
 * Preparo de anexos no lado do celular antes do upload ao Storage.
 *
 *  - Fotos de câmera chegam com 4–12MB; acima do limite útil da API (5MB por
 *    imagem) e caro em dados móveis. Redimensionamos no cliente via canvas.
 *  - Nomes de arquivo viram a última parte da chave no Storage; chaves só
 *    aceitam um subconjunto seguro de caracteres (estilo S3), então
 *    normalizamos aqui — o nome ORIGINAL segue intacto nos metadados.
 */

import { ATTACHMENTS_BUCKET, type AttachmentMeta } from '@ati/protocol'
import type { createClient } from '@/lib/supabase/client'

type Supabase = ReturnType<typeof createClient>

/** Lado maior máximo após o resize — suficiente para o modelo ler UI/fotos. */
const MAX_DIMENSION = 2048
/** Só recomprime se a imagem for maior que isto (evita reencodar à toa). */
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024
const JPEG_QUALITY = 0.85

/** Tipos que o canvas decodifica/reencoda com segurança. GIF fica de fora (perderia animação). */
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Reduz imagens grandes (dimensão e/ou peso). Qualquer falha (formato exótico,
 * HEIC sem suporte no browser, canvas bloqueado) devolve o arquivo original —
 * comprimir é otimização, nunca requisito.
 */
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!COMPRESSIBLE.has(file.type)) return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
    if (scale === 1 && file.size <= COMPRESS_THRESHOLD_BYTES) {
      bitmap.close()
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    // PNG preserva transparência (prints); o resto vira JPEG.
    const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outType, outType === 'image/jpeg' ? JPEG_QUALITY : undefined),
    )
    if (!blob || blob.size >= file.size) return file

    const newName =
      outType === 'image/jpeg' ? file.name.replace(/\.(webp|png|jpeg|jpg)$/i, '') + '.jpg' : file.name
    return new File([blob], newName, { type: outType })
  } catch {
    return file
  }
}

/** Normaliza o nome para servir de chave no Storage (o original fica nos metadados). */
export function sanitizeStorageName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : ''
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acentos (combining marks do NFD)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80)
  return `${base || 'arquivo'}${ext}`
}

/**
 * Sobe os arquivos para o bucket privado e devolve os metadados que vão no
 * payload do user_turn. Se qualquer upload falhar, remove os que já subiram
 * (sem órfãos no bucket) e relança o erro.
 */
export async function uploadAttachments(
  supabase: Supabase,
  ownerId: string,
  sessionId: string,
  files: File[],
): Promise<AttachmentMeta[]> {
  const metas: AttachmentMeta[] = []
  const uploadedPaths: string[] = []
  try {
    for (const original of files) {
      const file = await compressImageIfNeeded(original)
      const path = `${ownerId}/${sessionId}/${crypto.randomUUID()}/${sanitizeStorageName(file.name)}`
      const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      })
      if (error) throw new Error(`Upload de "${original.name}" falhou: ${error.message}`)
      uploadedPaths.push(path)
      metas.push({
        storage_path: path,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      })
    }
    return metas
  } catch (err) {
    if (uploadedPaths.length) {
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove(uploadedPaths)
    }
    throw err
  }
}
