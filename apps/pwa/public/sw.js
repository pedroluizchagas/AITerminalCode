/*
 * Service worker da PWA.
 * - Garante "installability".
 * - Recebe Web Push (notificações de tarefa concluída / aprovação necessária).
 * Não faz cache de dados (app online-first; depende do Supabase Realtime).
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {})

// Web Push: mostra a notificação enviada pelo daemon.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'AITerminalControl', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'AITerminalControl'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { sessionId: data.sessionId || null },
    }),
  )
})

// Clique na notificação: foca/abre a sessão correspondente.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const sessionId = event.notification.data && event.notification.data.sessionId
  const url = sessionId ? `/session/${sessionId}` : '/'
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client) {
            try {
              await client.navigate(url)
            } catch {
              /* ignore */
            }
          }
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
