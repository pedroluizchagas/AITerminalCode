import { spawn, type ChildProcess } from 'node:child_process'
import { config } from './config.js'
import { log } from './log.js'

export interface OcChild {
  proc: ChildProcess
  /** Escreve uma mensagem stream-json no stdin do filho. */
  write: (obj: unknown) => void
  kill: () => void
}

/**
 * Sobe um processo OpenClaude headless em modo Agent SDK (stdio):
 *   node <bin> --print --input-format stream-json --output-format stream-json --verbose
 * O stdin fica aberto para múltiplos turnos. Cada linha do stdout é um objeto
 * NDJSON entregue em onMessage.
 */
export function spawnOpenClaude(
  cwd: string,
  onMessage: (msg: Record<string, unknown>) => void,
  onExit: (code: number | null) => void,
): OcChild {
  const proc = spawn(
    process.execPath,
    [
      config.openclaudeBin,
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      // Delega os pedidos de permissão ao "host" (este daemon) pelo protocolo
      // can_use_tool sobre stdio. SEM isto, o OpenClaude resolve a permissão
      // localmente (hasPermissionsToUseTool) e NUNCA emite o control_request —
      // logo o card "Aprovar" nunca chega ao celular e Bash/Write/Edit são
      // bloqueados em silêncio. Com 'stdio', read-only é auto-permitido e o
      // resto vira can_use_tool, tratado em daemon.onPermissionRequest.
      '--permission-prompt-tool',
      'stdio',
    ],
    { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
  )

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
