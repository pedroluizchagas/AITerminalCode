import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { log } from './log.js'

const pub = process.env.VAPID_PUBLIC_KEY
const priv = process.env.VAPID_PRIVATE_KEY
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'

export const pushEnabled = Boolean(pub && priv)

if (pushEnabled) {
  webpush.setVapidDetails(subject, pub as string, priv as string)
  log.info('Web Push habilitado')
} else {
  log.warn('Web Push desativado (defina VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)')
}

export interface PushPayload {
  title: string
  body: string
  sessionId?: string
  tag?: string
}

interface SubRow {
  id: string
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Envia uma notificação Web Push para todos os dispositivos do dono. */
export async function sendPush(
  supabase: SupabaseClient,
  ownerId: string,
  payload: PushPayload,
): Promise<void> {
  if (!pushEnabled) return

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys')
    .eq('owner_id', ownerId)

  if (!subs?.length) return

  const body = JSON.stringify(payload)
  await Promise.all(
    (subs as SubRow[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: s.keys },
          body,
        )
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) {
          // inscrição morta — remove
          await supabase.from('push_subscriptions').delete().eq('id', s.id)
          log.debug('push: inscrição expirada removida')
        } else {
          log.warn('push falhou:', code ?? (err as Error).message)
        }
      }
    }),
  )
}
