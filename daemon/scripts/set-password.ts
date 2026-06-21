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
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import readline from 'node:readline'
import { createClient } from '@supabase/supabase-js'

function askHidden(query: string): Promise<string> {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    // suprime o eco do que é digitado
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {}
    process.stdout.write(query)
    rl.question('', (value) => {
      rl.close()
      process.stdout.write('\n')
      res(value)
    })
  })
}

const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const email = process.env.OWNER_EMAIL
const current = process.env.OWNER_PASSWORD

if (!url || !anon || !email || !current) {
  console.error('Faltam SUPABASE_URL / SUPABASE_ANON_KEY / OWNER_EMAIL / OWNER_PASSWORD em daemon/.env')
  process.exit(1)
}

const novo = await askHidden(`Nova senha para ${email} (mín. 6): `)
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

// reescreve OWNER_PASSWORD em daemon/.env (cwd = pasta do daemon)
try {
  const envPath = resolve(process.cwd(), '.env')
  let content = readFileSync(envPath, 'utf8')
  content = /^OWNER_PASSWORD=.*$/m.test(content)
    ? content.replace(/^OWNER_PASSWORD=.*$/m, `OWNER_PASSWORD=${novo}`)
    : content + `\nOWNER_PASSWORD=${novo}\n`
  writeFileSync(envPath, content, { mode: 0o600 })
} catch (err) {
  console.error(
    '⚠️ Senha trocada na conta, mas falhei ao atualizar daemon/.env:',
    (err as Error).message,
  )
  console.error('   Edite OWNER_PASSWORD manualmente com a nova senha.')
  process.exit(1)
}

console.log('\n✅ Senha atualizada na conta e em daemon/.env.')
console.log('   Reinicie o daemon:  systemctl --user restart oc-bridge')
process.exit(0)
