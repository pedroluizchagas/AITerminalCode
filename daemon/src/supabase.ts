import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { log } from './log.js'

export interface DaemonContext {
  supabase: SupabaseClient
  ownerId: string
  daemonId: string
}

/**
 * Retenta uma operação de rede com backoff exponencial. No boot (ex.: logo após
 * o PC ligar, ou numa queda de DNS momentânea) o `signInWithPassword` falha com
 * "fetch failed / ENOTFOUND"; sem retry o processo morre com exit 1 e entra em
 * crash-loop pelo systemd — perdendo o estado em memória a cada volta. Retentar
 * mantém o daemon de pé e o boot previsível.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === tries) break
      const waitMs = Math.min(1000 * 2 ** (attempt - 1), 15_000) // 1s,2s,4s,8s,15s
      log.warn(
        `${label} falhou (tentativa ${attempt}/${tries}): ` +
          `${(err as Error).message}. Retentando em ${waitMs}ms…`,
      )
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw new Error(
    `${label} falhou após ${tries} tentativas: ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

/** Loga o daemon na conta do dono e garante a autorização do Realtime. */
export async function initSupabase(): Promise<{ supabase: SupabaseClient; ownerId: string }> {
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  })

  const user = await withRetry('Login do daemon', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: config.ownerEmail,
      password: config.ownerPassword,
    })
    // Erro de rede vem em `error` (não como throw); levanto pra acionar o retry.
    if (error || !data.user) throw new Error(error?.message ?? 'sem usuário')
    return data.user
  })

  // autoriza canais privados do Realtime com o token da sessão
  await supabase.realtime.setAuth()

  log.info(`daemon autenticado como ${user.email} (${user.id})`)
  return { supabase, ownerId: user.id }
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
