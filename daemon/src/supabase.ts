import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './log.js'

export interface DaemonContext {
  supabase: SupabaseClient
  ownerId: string
  daemonId: string
}

/** Loga o daemon na conta do dono e garante a autorização do Realtime. */
export async function initSupabase(): Promise<{ supabase: SupabaseClient; ownerId: string }> {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  })

  const { data, error } = await supabase.auth.signInWithPassword({
    email: config.ownerEmail,
    password: config.ownerPassword,
  })
  if (error || !data.user) {
    throw new Error(`Login do daemon falhou: ${error?.message ?? 'sem usuário'}`)
  }

  // autoriza canais privados do Realtime com o token da sessão
  await supabase.realtime.setAuth()

  log.info(`daemon autenticado como ${data.user.email} (${data.user.id})`)
  return { supabase, ownerId: data.user.id }
}

/** Registra/atualiza este daemon e devolve seu id. */
export async function registerDaemon(supabase: SupabaseClient, ownerId: string): Promise<string> {
  const { data: existing } = await supabase
    .from('daemons')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('name', config.daemonName)
    .maybeSingle()

  if (existing?.id) {
    await supabase
      .from('daemons')
      .update({ status: 'online', last_seen_at: new Date().toISOString() })
      .eq('id', existing.id)
    return existing.id as string
  }

  const { data, error } = await supabase
    .from('daemons')
    .insert({
      owner_id: ownerId,
      name: config.daemonName,
      status: 'online',
      last_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`Não consegui registrar o daemon: ${error?.message}`)
  return data.id as string
}
