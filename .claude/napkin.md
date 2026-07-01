# Napkin — AITerminalControl

## Arquitetura (ler antes de mexer)
- Fluxo: PWA (Vercel) → Supabase (`messages` + Realtime + Storage) → daemon (PC) → OpenClaude via stream-json no stdin.
- Daemon e celular logam na MESMA conta Supabase → uma política RLS cobre os dois lados (inclusive Storage).
- OpenClaude (clone headless do Claude Code): fonte em `/home/pedrochagas/Documentos/ClaudeClone/openclaude` (TS em `src/`, build em `dist/cli.mjs`). O stdin stream-json repassa blocos de conteúdo (image/document base64) direto à API, sem validação.

## Operação
- Daemon roda como systemd user unit `oc-bridge.service` com tsx — SEM hot-reload: após mudar `daemon/src/`, rodar `systemctl --user restart oc-bridge.service` (checar antes se está ocioso: sem filhos `dist/cli.mjs --print`).
- Deploy da PWA: `vercel deploy --prod --yes` na raiz do repo (project aiterminalcode, rootDir=apps/pwa). Sem auto-deploy por git.
- Migrations: `supabase db push` (CLI já linkada ao projeto yuzpncdhpmevxanxhgst).

## Armadilhas
- Binário grande NUNCA vai em `messages.payload` (limite de payload do postgres_changes) — usar o bucket privado `attachments` e gravar só metadados `{storage_path,name,mime,size}`.
- Scripts .ts soltos rodados com tsx fora do repo caem em CJS (sem top-level await) e não resolvem deps do workspace — usar `.mts` DENTRO de um pacote do repo.
- `pgrep -f` casa com o próprio shell do comando quando o padrão aparece na linha de comando — conferir com `pgrep -a` antes de confiar na contagem.
