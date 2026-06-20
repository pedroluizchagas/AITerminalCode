# AITerminalControl

Superfície mobile (PWA) para controlar o **OpenClaude** rodando no PC de casa, de
qualquer rede/cidade, via Supabase. Ver a conversa, tool calls e saídas em tempo
real, mandar prompts e aprovar/negar ações pelo celular.

> Plano completo e protocolo: ver `../../ClaudeClone/PLANO-MOBILE.md` e
> `../../ClaudeClone/FASE-0-PROTOCOLO.md`.

## Arquitetura

```
CELULAR (PWA/Vercel) ──wss──▶ SUPABASE (Realtime+Auth+Postgres) ──wss──▶ PC DE CASA (daemon + OpenClaude)
```

Tudo conecta para fora → funciona sem IP fixo nem port forwarding.

## Projeto Supabase

| Item | Valor |
|---|---|
| Nome | AITerminalControl |
| Ref | `yuzpncdhpmevxanxhgst` |
| URL | `https://yuzpncdhpmevxanxhgst.supabase.co` |
| Região | East US (North Virginia) |

A **anon key** é pública (protegida por RLS) e está em `.env.example`. As chaves
`service_role` / `sb_secret` **não** são usadas neste projeto e nunca devem ir
para o celular nem para o repositório.

## Estrutura

```
AITerminalControl/
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 20260620181429_init.sql   # schema + RLS + realtime
├── apps/pwa/        # Next.js (Vercel)        — Fase 1
├── daemon/          # oc-bridge (Bun)         — Fase 1
└── packages/protocol/  # tipos do Envelope    — Fase 1
```

## Setup do banco

```bash
# linkar ao projeto remoto (pede a senha do banco)
supabase link --project-ref yuzpncdhpmevxanxhgst

# aplicar as migrations
supabase db push
```

## Status

- [x] Projeto Supabase criado + CLI logado
- [x] `supabase init` + migrations (schema/RLS/realtime/broadcast/interrupt) aplicadas e verificadas
- [x] Conta do dono criada (daemon e celular usam a MESMA conta → RLS bate)
- [x] **Fase 1 — código completo**: `packages/protocol` + `daemon` (oc-bridge) + `apps/pwa`
      (Next.js). Typecheck e build da PWA passando.
- [ ] Runtime: instalar bun + buildar OpenClaude (`dist/cli.mjs`)
- [ ] Auth do OpenClaude: `node dist/cli.mjs setup-token` (login na assinatura Claude, 1x)
- [ ] Subir daemon (systemd) + deploy da PWA na Vercel + teste ponta-a-ponta

## Auth do OpenClaude (assinatura, não API key)
O daemon roda o OpenClaude em modo `--print`, que lê o OAuth da sua conta Claude.
Uma vez no PC de casa: `node <OPENCLAUDE_BIN> setup-token` → token de 1 ano em
`~/.claude/.credentials.json`. **Não** defina `ANTHROPIC_API_KEY` (senão usa API em
vez da assinatura).
