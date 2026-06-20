import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { requireSupabaseEnv } from '@/lib/env'
import type { Database } from '@/lib/database.types'

/**
 * Cliente Supabase para Server Components / Route Handlers.
 * Lê/grava cookies via next/headers. Em Server Components a escrita de cookie
 * pode lançar (contexto somente-leitura); ignoramos pois o middleware já cuida
 * de renovar a sessão a cada request.
 */
export async function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Chamado de um Server Component: ignorável (middleware renova a sessão).
        }
      },
    },
  })
}
