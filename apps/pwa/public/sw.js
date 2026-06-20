/*
 * Service worker minimalista — só garante "installability" da PWA.
 * NÃO faz cache (o app é online-first: depende de Supabase Realtime).
 * Cache offline e Web Push ficam para uma fase futura.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Passa direto para a rede; sem interceptação de cache por enquanto.
self.addEventListener('fetch', () => {})
