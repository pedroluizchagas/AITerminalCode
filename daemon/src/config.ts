import 'dotenv/config'
import os from 'node:os'

function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente faltando: ${name} (ver daemon/.env.example)`)
  return v
}

export const config = {
  supabaseUrl: req('SUPABASE_URL'),
  supabaseAnonKey: req('SUPABASE_ANON_KEY'),
  ownerEmail: req('OWNER_EMAIL'),
  ownerPassword: req('OWNER_PASSWORD'),
  openclaudeBin: req('OPENCLAUDE_BIN'),
  daemonName: process.env.DAEMON_NAME?.trim() || os.hostname(),
  defaultCwd: process.env.DEFAULT_CWD?.trim() || os.homedir(),
  autoApproveReadonly: (process.env.AUTO_APPROVE_READONLY ?? 'true') !== 'false',
  heartbeatMs: 20_000,
  // Encerra o processo OpenClaude de uma sessão após este tempo sem atividade.
  idleReapMs: Number(process.env.IDLE_REAP_MIN ?? '15') * 60_000,
  // Encerra um terminal (PTY) após este tempo sem atividade (trava de segurança).
  idleTermMs: Number(process.env.IDLE_TERM_MIN ?? '15') * 60_000,
  shell: process.env.SHELL?.trim() || 'bash',
}
