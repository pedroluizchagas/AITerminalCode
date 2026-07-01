import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { config } from './config.js'
import { log } from './log.js'

export interface OcChild {
  proc: ChildProcess
  /** Escreve uma mensagem stream-json no stdin do filho. */
  write: (obj: unknown) => void
  kill: () => void
}

/**
 * Argumentos do OpenClaude headless. O `--permission-prompt-tool stdio` é o que
 * faz o filho DELEGAR a permissão a este daemon (via can_use_tool sobre stdio)
 * em vez de resolvê-la localmente. Sem ele, em modo `--print` toda decisão
 * "ask" (Bash/Write/curl/…) vira um DENY local — e o celular recebe só o erro
 * ("This command requires approval", "…multiple operations", etc.), nunca o card
 * de aprovação. Mantido como const única para ficar auditável em um só lugar.
 */
export const OPENCLAUDE_ARGS = [
  '--print',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-prompt-tool',
  'stdio',
] as const

/**
 * Sobe um processo OpenClaude headless em modo Agent SDK (stdio):
 *   node <bin> --print --input-format stream-json --output-format stream-json --verbose
 * O stdin fica aberto para múltiplos turnos. Cada linha do stdout é um objeto
 * NDJSON entregue em onMessage.
 *
 * `model` (opcional) vira `--model <valor>` — a escolha feita no celular
 * (sessions.model). Ausente, vale o padrão do OpenClaude.
 */
export function spawnOpenClaude(
  cwd: string,
  model: string | null,
  onMessage: (msg: Record<string, unknown>) => void,
  onExit: (code: number | null) => void,
): OcChild {
  // Preflight: um OPENCLAUDE_BIN inexistente (ou build antigo, sem suporte a
  // `--permission-prompt-tool stdio`) é uma causa silenciosa de "não pede
  // aprovação". Falhar aqui com mensagem clara evita horas de depuração.
  if (!existsSync(config.openclaudeBin)) {
    log.error(
      `OPENCLAUDE_BIN não encontrado: ${config.openclaudeBin} — ` +
        `builde o OpenClaude (dist/cli.mjs) e confira daemon/.env`,
    )
  }

  const args = [config.openclaudeBin, ...OPENCLAUDE_ARGS]
  if (model) args.push('--model', model)
  // Deixa a delegação de permissão VISÍVEL no log — assim dá pra confirmar num
  // relance que este processo está rodando o código novo (stdio), não um
  // daemon "velho" ainda em memória (tsx `start` não faz hot-reload).
  log.info(
    `spawn openclaude — delegação de permissão: stdio (can_use_tool)` +
      (model ? `, model=${model}` : ''),
  )
  log.debug('argv:', process.execPath, args.join(' '))

  const proc = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buf = ''
  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    buf += chunk
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) {
        try {
          onMessage(JSON.parse(line) as Record<string, unknown>)
        } catch {
          log.warn('linha stdout não-JSON ignorada:', line.slice(0, 200))
        }
      }
      nl = buf.indexOf('\n')
    }
  })

  proc.stderr?.setEncoding('utf8')
  proc.stderr?.on('data', (d: string) => log.debug('[oc stderr]', d.trimEnd()))

  proc.on('exit', (code) => {
    log.info(`processo OpenClaude saiu (cwd=${cwd}, code=${code})`)
    onExit(code)
  })
  proc.on('error', (err) => {
    log.error('falha ao iniciar OpenClaude:', err.message)
    onExit(null) // limpa o child e reseta o status (spawn falhou, ex.: cwd inexistente)
  })

  return {
    proc,
    write(obj) {
      proc.stdin?.write(JSON.stringify(obj) + '\n')
    },
    kill() {
      proc.kill('SIGTERM')
    },
  }
}
