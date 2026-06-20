# oc-bridge (daemon)

Roda no PC de casa. Faz a ponte entre o OpenClaude headless (stdio, protocolo
Agent SDK) e o Supabase. Recebe comandos do celular e devolve os eventos.

## O que ele faz
- Loga no Supabase como o **dono** (mesma conta do celular → RLS bate).
- Registra-se em `daemons` e mantém heartbeat (status online/working/offline).
- Escuta `messages` com `source=phone` (postgres_changes): `user_turn`,
  `permission_res`, `interrupt`.
- Para cada sessão, sobe `node <OPENCLAUDE_BIN> --print --input-format stream-json
  --output-format stream-json --verbose` e mantém o stdin aberto.
- Encaminha a saída: eventos → `messages` (kind `event`); `can_use_tool` →
  `permission_requests` + `messages` (kind `permission_req`); `stream_event` →
  Realtime Broadcast (canal = id da sessão) para o "digitando" ao vivo.
- Política: read-only auto-aprova; Bash/Write/Edit e desconhecidas pedem no celular.

## Requisitos
- Node 22+ (testado em v24; usa `WebSocket`/`fetch` nativos).
- OpenClaude **buildado** (`dist/cli.mjs`) e um provider de LLM configurado.

## Configurar
```bash
cp daemon/.env.example daemon/.env   # já gerado com OWNER_* preenchidos
# edite daemon/.env e preencha o provider de LLM (OPENAI_*/ANTHROPIC_API_KEY)
```

## Rodar
```bash
pnpm install            # na raiz do monorepo
pnpm --filter @ati/daemon dev    # ou: cd daemon && pnpm start
```

## Sempre-on (systemd)
Ver `oc-bridge.service`.

## Segurança
- Nunca usa `service_role`. Autentica como usuário (RLS).
- Segredos de LLM ficam só aqui, nunca vão ao celular.
- `daemon/.env` é gitignored e está com `chmod 600`.
