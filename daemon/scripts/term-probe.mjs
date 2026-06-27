// Sonda do terminal remoto: reproduz o fluxo do celular (PWA) ponta a ponta.
// Insere uma linha em `terminals`, assina o canal privado de Broadcast, manda
// input e imprime a saída com timestamps — pra ver exatamente onde trava.
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY
const email = process.env.OWNER_EMAIL
const password = process.env.OWNER_PASSWORD
const daemonName = process.env.DAEMON_NAME?.trim()

const t0 = Date.now()
const ts = () => `+${String(Date.now() - t0).padStart(5)}ms`
const logLine = (...a) => console.log(ts(), ...a)

const sb = createClient(url, anon, { auth: { persistSession: false } })

const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password })
if (authErr) throw authErr
logLine('login OK', auth.user.email)
await sb.realtime.setAuth()

const { data: daemon } = await sb
  .from('daemons')
  .select('id,name,status')
  .eq('owner_id', auth.user.id)
  .eq('name', daemonName)
  .maybeSingle()
logLine('daemon:', daemon)

const { data: term, error: insErr } = await sb
  .from('terminals')
  .insert({ owner_id: auth.user.id, daemon_id: daemon.id, status: 'requested' })
  .select('id')
  .single()
if (insErr) throw insErr
const id = term.id
logLine('terminal solicitado:', id)

let bytes = 0
let outBuf = ''
const ch = sb.channel(id, { config: { private: true, broadcast: { self: false } } })
ch.on('broadcast', { event: 'o' }, ({ payload }) => {
  const d = payload?.d ?? ''
  bytes += d.length
  outBuf += d
  // mostra só uma amostra legível pra não poluir
  const sample = d.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\r\n]+/g, '⏎').slice(0, 80)
  logLine(`o (${d.length}B, total ${bytes}B): ${sample}`)
})
ch.on('broadcast', { event: 'x' }, ({ payload }) => logLine('EXIT', payload))
ch.subscribe((s) => logLine('canal:', s))

// acompanha o status (requested -> active/closed) via postgres_changes
sb.channel('probe-status-' + id)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'terminals', filter: `id=eq.${id}` },
    (p) => logLine('status ->', p.new.status, p.new.closed_reason ?? ''))
  .subscribe()

const send = (event, payload) => ch.send({ type: 'broadcast', event, payload })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// espera ficar 'active'
for (let i = 0; i < 60; i++) {
  const { data } = await sb.from('terminals').select('status').eq('id', id).maybeSingle()
  if (data?.status === 'active') break
  await sleep(250)
}
logLine('=== terminal ativo, mandando comandos ===')
await send('rs', { c: 80, r: 24 })
await sleep(300)

logLine('--- teste 1: echo (input simples) ---')
await send('i', { d: 'echo OLA_DA_SONDA\n' })
await sleep(1500)

logLine('--- teste 2: paste estilo PWA (texto cru, SEM \\n) ---')
await send('i', { d: 'echo COLADO_SEM_ENTER' })
await sleep(1200)
logLine('--- agora mando o Enter separado ---')
await send('i', { d: '\r' })
await sleep(1200)

logLine('--- teste 3: git clone (o caso que trava) ---')
const before = bytes
await send('i', { d: 'rm -rf /tmp/__probe_clone && git clone https://github.com/pedroluizchagas/AITerminalCode.git /tmp/__probe_clone\n' })
await sleep(15000)
logLine(`git clone: recebidos ${bytes - before}B em 15s`)

logLine('=== encerrando ===')
await sb.from('terminals').update({ status: 'closed' }).eq('id', id)
await sleep(500)
console.log('\n================ DUMP DA SAÍDA BRUTA ================')
process.stdout.write(outBuf.slice(-4000))
console.log('\n====================================================')
process.exit(0)
