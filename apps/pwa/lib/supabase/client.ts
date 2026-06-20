'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseEnv } from '@/lib/env'
import type { Database } from '@/lib/database.types'

/**
 * Cliente Supabase para uso no browser (componentes 'use client').
 * createBrowserClient é seguro de instanciar várias vezes (memoiza por env).
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient<Database>(url, anonKey)
}
