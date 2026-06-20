import { Daemon } from './daemon.js'
import { log } from './log.js'
import { initSupabase, registerDaemon } from './supabase.js'

async function main(): Promise<void> {
  log.info('iniciando oc-bridge…')
  const { supabase, ownerId } = await initSupabase()
  const daemonId = await registerDaemon(supabase, ownerId)
  const daemon = new Daemon(supabase, ownerId, daemonId)
  await daemon.start()

  const stop = async (sig: string) => {
    log.info(`recebido ${sig}, encerrando…`)
    await daemon.shutdown()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
