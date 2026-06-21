'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VAPID_PUBLIC_KEY } from '@/lib/env'

type PushState = 'checking' | 'idle' | 'on' | 'busy' | 'denied' | 'unsupported'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Botão para ativar Web Push (avisa no celular quando o agente termina ou pede aprovação). */
export function EnablePush({ ownerId }: { ownerId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [state, setState] = useState<PushState>('checking')

  const supported = useCallback(
    () =>
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window,
    [],
  )

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY || !supported()) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'idle'))
      .catch(() => setState('idle'))
  }, [supported])

  const enable = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) return
    setState('busy')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'denied' : 'idle')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }))

      const json = sub.toJSON()
      const { error } = await supabase.from('push_subscriptions').upsert(
        {
          owner_id: ownerId,
          endpoint: sub.endpoint,
          keys: (json.keys ?? {}) as Record<string, string>,
        },
        { onConflict: 'endpoint' },
      )
      if (error) throw error
      setState('on')
    } catch (err) {
      console.warn('Falha ao ativar notificações:', err)
      setState('idle')
    }
  }, [supabase, ownerId])

  if (state === 'unsupported' || state === 'checking') return null

  if (state === 'on') {
    return <span className="text-xs text-[var(--color-faint)]">🔔 Notificações ativas</span>
  }
  if (state === 'denied') {
    return (
      <span className="text-xs text-[var(--color-faint)]">
        Notificações bloqueadas — libere nas configurações do navegador
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === 'busy'}
      className="text-xs text-[var(--color-muted)] underline underline-offset-2 transition active:opacity-60 disabled:opacity-50"
    >
      {state === 'busy' ? 'Ativando…' : '🔔 Ativar notificações'}
    </button>
  )
}
