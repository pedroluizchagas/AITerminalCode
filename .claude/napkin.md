# Napkin — AITerminalControl

## Arquitetura (ler antes de mexer)
- Fluxo: PWA (Vercel) → Supabase (`messages` + Realtime + Storage) → daemon (PC) → OpenClaude via stream-json no stdin.
- Daemon e celular logam na MESMA conta Supabase → uma política RLS cobre os dois lados (inclusive Storage).
- OpenClaude (clone headless do Claude Code): fonte em `/home/pedrochagas/Documentos/ClaudeClone/openclaude` (TS em `src/`, build em `dist/cli.mjs` — o dist pode divergir do src; conclusões tiradas do src DEVEM ser confirmadas ao vivo contra o dist). O stdin stream-json repassa blocos de conteúdo (image/document base64) direto à API, sem validação.
- Modelo: `--model <alias>` no spawn e, com o processo vivo, `{"type":"control_request","request_id":"<uuid>","request":{"subtype":"set_model","model":"sonnet|opus|haiku|best|opusplan|sonnet[1m]|opus[1m]|default"}}` (troca sem perder contexto; resposta `control_response subtype:success`). Aliases > IDs fixos (resolvem p/ o modelo mais novo). `/model` como texto NÃO funciona em --print.
- Sem `--resume`, um processo novo NÃO retoma a conversa (session_id no user turn é ignorado como input) — o reaping por ociosidade perde o contexto do modelo (gap conhecido; candidato: usar `--resume <oc_session_id>` no respawn).

## Operação
- Daemon roda como systemd user unit `oc-bridge.service` com tsx — SEM hot-reload: após mudar `daemon/src/`, rodar `systemctl --user restart oc-bridge.service` (checar antes se está ocioso: sem filhos `dist/cli.mjs --print`).
- Deploy da PWA: `vercel deploy --prod --yes` na raiz do repo (project aiterminalcode, rootDir=apps/pwa). Sem auto-deploy por git.
- Migrations: `supabase db push` (CLI já linkada ao projeto yuzpncdhpmevxanxhgst).

## Armadilhas
- Binário grande NUNCA vai em `messages.payload` (limite de payload do postgres_changes) — usar o bucket privado `attachments` e gravar só metadados `{storage_path,name,mime,size}`.
- Scripts .ts soltos rodados com tsx fora do repo caem em CJS (sem top-level await) e não resolvem deps do workspace — usar `.mts` DENTRO de um pacote do repo.
- `pgrep -f` casa com o próprio shell do comando quando o padrão aparece na linha de comando; e o tsx do daemon também roda um `…tsx/dist/cli.mjs`. P/ achar filhos OpenClaude de verdade: `ps -eo pid,cmd | grep 'openclaude/dist/cli.mjs' | grep -v grep` (ou filtrar `bash -c`).
