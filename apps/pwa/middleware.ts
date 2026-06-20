import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Roda em tudo menos:
     * - _next/static, _next/image (assets do Next)
     * - favicon / ícones / manifest / service worker
     * - arquivos com extensão (imagens etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
