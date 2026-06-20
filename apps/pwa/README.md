# @ati/pwa — AITerminalControl (PWA)

Superfície mobile (Next.js, App Router) para controlar o **OpenClaude** rodando
num daemon no PC de casa, via **Supabase** (Auth + Postgres + Realtime).

PWA ⇄ Supabase ⇄ daemon. Este pacote é **só o front**.

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript estrito
- `@supabase/ssr` + `@supabase/supabase-js` (auth, dados, realtime)
- Tailwind CSS v4 (via `@tailwindcss/postcss`)
- Tipos compartilhados de `@ati/protocol` (workspace)

## Como rodar

Não rode `pnpm install` aqui — o install é único, na raiz do monorepo.

```bash
# na RAIZ do repositório
pnpm install

# variáveis (já versionado o exemplo; .env.local é gitignored)
cp apps/pwa/.env.example apps/pwa/.env.local   # já preenchido com os valores públicos

# dev
pnpm pwa            # atalho da raiz (== pnpm --filter @ati/pwa dev)
# ou
pnpm --filter @ati/pwa dev

# build / start de produção
pnpm --filter @ati/pwa build
pnpm --filter @ati/pwa start
```

App em http://localhost:3000.

## Variáveis de ambiente

| Var | Descrição |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase (pública) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (pública; segurança vem da RLS) |

Ambas são `NEXT_PUBLIC_` — vão para o bundle do cliente. Isso é seguro porque
toda tabela tem RLS escopada a `owner_id = auth.uid()`.

## Estrutura

```
apps/pwa/
├─ app/
│  ├─ layout.tsx              # html/body, metadata, manifest, registra SW
│  ├─ globals.css             # Tailwind v4 + tokens (@theme), tema dark
│  ├─ manifest.ts             # Web App Manifest (/manifest.webmanifest)
│  ├─ page.tsx                # / — lista de sessões + status do daemon
│  ├─ login/
│  │  ├─ page.tsx             # /login (card centralizado)
│  │  └─ LoginForm.tsx        # magic link (signInWithOtp)
│  ├─ auth/
│  │  ├─ callback/route.ts    # troca o code do magic link por sessão
│  │  └─ signout/route.ts     # POST -> signOut -> /login
│  └─ session/[id]/
│     ├─ page.tsx             # carrega sessão + histórico (server)
│     └─ not-found.tsx
├─ components/
│  ├─ ServiceWorkerRegister.tsx
│  ├─ StatusDot.tsx
│  ├─ SignOutButton.tsx
│  ├─ NewSessionButton.tsx    # cria sessão (title/project_path/daemon)
│  └─ chat/
│     ├─ ChatView.tsx         # orquestra realtime + composer + permissões
│     ├─ MessageItem.tsx      # renderiza uma linha de `messages`
│     ├─ ToolCall.tsx         # tool_use colapsável
│     ├─ ToolResult.tsx       # tool_result colapsável
│     ├─ PermissionCard.tsx   # Aprovar / Negar
│     └─ Composer.tsx         # textarea + enviar + interromper
├─ lib/
│  ├─ env.ts                  # leitura/validação das envs
│  ├─ database.types.ts       # tipos do schema Postgres (manuais)
│  ├─ oc-events.ts            # parse dos payloads NDJSON do OpenClaude
│  └─ supabase/{client,server,middleware}.ts
├─ public/
│  ├─ icon.svg, icon-maskable.svg
│  └─ sw.js                   # service worker minimalista (só installability)
├─ middleware.ts              # renova sessão + protege rotas
├─ next.config.ts             # transpilePackages: ['@ati/protocol']
├─ postcss.config.mjs         # @tailwindcss/postcss
├─ tsconfig.json              # extends ../../tsconfig.base.json + plugin next
├─ .env.local / .env.example
└─ README.md
```

## Fluxo de dados (contrato com o daemon)

- **Eu envio** (`source:'phone'`) inserindo em `messages`:
  - prompt → `kind:'user_turn'`, `payload:{ content }`
  - resposta de permissão → `kind:'permission_res'`, `payload:{ request_id, behavior, message?, updatedInput? }`
  - interromper → ver nota abaixo
- **Daemon responde** (`source:'daemon'`):
  - `kind:'event'` → objeto NDJSON nativo (`assistant`/`user`/`result`/`system init`)
  - `kind:'permission_req'` + linha `permission_requests` (status `pending`)
  - `kind:'status'`
- **Stream ao vivo**: broadcast em canal **privado** com `topic = sessionId`,
  evento `stream_event`. É só cosmético (efeito de digitação); a verdade durável
  são as linhas de `messages` via `postgres_changes`. O app funciona sem ele.

### Realtime

- `postgres_changes` INSERT em `messages` (`session_id=eq.<id>`) → feed durável.
- `postgres_changes` `*` em `permission_requests` (`session_id=eq.<id>`) → cards.
- `broadcast` (`topic = sessionId`, `{ private: true }`) → deltas ao vivo.

## Decisões / suposições

- **Tipos do schema escritos à mão** (`lib/database.types.ts`) em vez de gerados,
  para o pacote ficar autocontido e não depender de rodar a CLI do Supabase.
- **Tailwind v4** (PostCSS plugin, sem `tailwind.config.js`) — tokens via `@theme`
  em `globals.css`.
- **Permissões dirigidas por `permission_requests`** (não por mensagens
  `permission_req`), conforme a opção sugerida no escopo. A aprovação faz as duas
  coisas: insere `permission_res` em `messages` E atualiza a linha para
  `allowed`/`denied`.
- **`working`** é derivado do fluxo durável (último `user_turn` → trabalhando;
  `result` → parou) e também ligado ao receber deltas do stream.
- **Ícones em SVG** (normal + maskable). Sem PNGs binários no repo; instalável
  no celular mesmo assim.

## ⚠️ Conflito documentado — interrupt

O escopo pede inserir o interrupt como `kind:'interrupt'`, mas a migration
`messages` tem `check (kind in ('user_turn','event','permission_req','permission_res','status'))`
— ou seja, **o banco rejeita `'interrupt'`**. Para não quebrar em runtime, o
PWA envia o interrupt como:

```jsonc
{ source: 'phone', kind: 'status', payload: { status: 'interrupt', interrupt: true } }
```

Follow-up necessário (um dos dois):
1. **(recomendado)** adicionar `'interrupt'` ao check da tabela `messages` e
   trocar o insert em `components/chat/ChatView.tsx` (`interrupt()`) para
   `kind:'interrupt'`, `payload:{}` — alinhando ao `@ati/protocol`; **ou**
2. garantir que o daemon reconheça `kind:'status'` com `payload.interrupt === true`.

## Stubs / follow-ups

- **Service worker** não faz cache (online-first). Web Push (`push_subscriptions`,
  VAPID) não está implementado — só a tabela existe.
- Sem geração/edição de daemons pela PWA (o pareamento é feito na Fase 1 pelo
  daemon). A lista de daemons é apenas leitura/seleção.
- Sem ação de "encerrar sessão" na UI (só leitura do status `closed`, que
  desabilita o composer).
