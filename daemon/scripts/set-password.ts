/*
 * Troca a senha da conta do dono e sincroniza com o daemon.
 * Rode NO SEU TERMINAL (a senha é digitada escondida, nunca aparece):
 *
 *   cd <repo> && pnpm --filter @ati/daemon run set-password
 *
 * Usa a senha ATUAL (de daemon/.env) para autenticar, define a nova senha na
 * conta Supabase e reescreve OWNER_PASSWORD em daemon/.env. Depois reinicie:
 *   systemctl --user restart oc-bridge
 */
import { config as loadEnv } from 'dotenv'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

// resolve a pasta do daemon a partir do próprio script (independe do cwd)
const daemonDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(daemonDir, '.env')
loadEnv({ path: envPath })

/** Lê uma linha do terminal sem ecoar o que é digitado (raw mode). */
function askHidden(query: string): Promise<string> {
  return new Promise((res, rej) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      rej(new Error('Precisa de um terminal interativo (TTY). Rode direto no seu terminal.'))
      return
    }
    process.stdout.write(query)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let input = ''
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0)
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false)
          stdin.pause()
          stdin.removeListener('data', onData)
          process.stdout.write('\n')
          res(input)
          return
        } else if (code === 3) {
          // Ctrl+C
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(1)
        } else if (code === 127 || code === 8) {
          // Backspace
          input = input.slice(0, -1)
        } else if (code >= 32) {
          input += ch
        }
      }
    }
    stdin.on('data', onData)
  })
}

const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const email = process.env.OWNER_EMAIL
const current = process.env.OWNER_PASSWORD

if (!url || !anon || !email || !current) {
  console.error(`Faltam variáveis em ${envPath} (SUPABASE_URL / SUPABASE_ANON_KEY / OWNER_EMAIL / OWNER_PASSWORD)`)
  process.exit(1)
}

console.log(`Conta: ${email}`)
const novo = await askHidden('Nova senha (mín. 6, não aparece ao digitar): ')
const conf = await askHidden('Confirme a nova senha: ')

if (novo.length < 6) {
  console.error('❌ Senha muito curta (mínimo 6 caracteres).')
  process.exit(1)
}
if (novo !== conf) {
  console.error('❌ As senhas não conferem.')
  process.exit(1)
}

const sb = createClient(url, anon, { auth: { persistSession: false } })

const { error: aerr } = await sb.auth.signInWithPassword({ email, password: current })
if (aerr) {
  console.error('❌ Não consegui autenticar com a senha atual de daemon/.env:', aerr.message)
  process.exit(1)
}

const { error: uerr } = await sb.auth.updateUser({ password: novo })
if (uerr) {
  console.error('❌ Falha ao trocar a senha na conta:', uerr.message)
  process.exit(1)
}

try {
  let content = readFileSync(envPath, 'utf8')
  content = /^OWNER_PASSWORD=.*$/m.test(content)
    ? content.replace(/^OWNER_PASSWORD=.*$/m, `OWNER_PASSWORD=${novo}`)
    : content + `\nOWNER_PASSWORD=${novo}\n`
  writeFileSync(envPath, content, { mode: 0o600 })
} catch (err) {
  console.error('⚠️ Senha trocada na conta, mas falhei ao atualizar daemon/.env:', (err as Error).message)
  console.error('   Edite OWNER_PASSWORD manualmente com a nova senha.')
  process.exit(1)
}

console.log('\n✅ Senha atualizada na conta e em daemon/.env.')
console.log('   Reinicie o daemon:  systemctl --user restart oc-bridge')
process.exit(0)
