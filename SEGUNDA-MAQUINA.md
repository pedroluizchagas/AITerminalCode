# Segunda máquina (ex.: desktop)

Cada máquina roda seu próprio daemon e **só cuida das sessões atribuídas a ela**
(roteamento por `daemon_id`, escolhido em "Nova sessão"). Os dois daemons logam na
**mesma conta** (RLS = você).

> ⚠️ As máquinas Pop!_OS têm o mesmo hostname `pop-os`. O daemon se identifica pelo
> **nome**; se duas usarem o mesmo nome, viram o mesmo daemon e o roteamento quebra.
> O notebook já está como `notebook`. **No desktop, use `DAEMON_NAME=desktop`.**

## Pré-requisitos no desktop
Node 22+, `pnpm`, `bun`, `git`.

## Passos (rodar NO DESKTOP)

**1. Clonar os repositórios**
```bash
git clone git@github.com:pedroluizchagas/AITerminalCode.git
git clone https://github.com/Gitlawb/openclaude.git
```

**2. Buildar o OpenClaude**
```bash
cd openclaude && bun install && bun run build   # gera dist/cli.mjs
```

**3. Logar na assinatura Claude (no desktop)**
```bash
node dist/cli.mjs setup-token                    # cria ~/.claude/.credentials.json
```

**4. Instalar deps do projeto**
```bash
cd ../AITerminalCode && pnpm install
# o terminal remoto usa node-pty (módulo nativo). No Linux ele COMPILA do fonte:
pnpm approve-builds          # aprove "node-pty" (e esbuild/sharp) quando perguntar
# se o daemon reclamar de "pty.node" ao subir, force o build:
( cd node_modules/.pnpm/node-pty@*/node_modules/node-pty && npx -y node-gyp rebuild )
```
> Requer `gcc`, `make`, `python3` (no Ubuntu/Pop!_OS: `sudo apt install build-essential python3`).

**5. Criar `daemon/.env`** (copie do notebook e ajuste, ou parta do `.env.example`):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — iguais ao notebook
- `OWNER_EMAIL`, `OWNER_PASSWORD` — iguais (a senha que você definiu)
- `DAEMON_NAME=desktop` — **obrigatório, distinto**
- `OPENCLAUDE_BIN=` caminho do `dist/cli.mjs` **no desktop**
- `DEFAULT_CWD=` onde ficam os projetos no desktop
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — iguais ao notebook (p/ push)
```bash
chmod 600 daemon/.env
```

**6. systemd (sempre-on)**
- Se os caminhos (home, node via nvm) diferirem do notebook, edite `daemon/oc-bridge.service`.
```bash
cp daemon/oc-bridge.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now oc-bridge
loginctl enable-linger $USER
journalctl --user -u oc-bridge -f      # deve logar "daemon autenticado" + "SUBSCRIBED"
```

## Usar
Em **Nova sessão**, escolha a máquina (`notebook` ou `desktop`) conforme onde está o
projeto. Cada máquina executa só as sessões dela. O indicador da home mostra o status
de cada daemon.

## Trocar a senha (com 2 máquinas)
O `set-password` só atualiza o `.env` **local**. Depois de trocar numa máquina, atualize
`OWNER_PASSWORD` no `daemon/.env` da **outra** (ou copie o `.env`) e reinicie o daemon dela.
