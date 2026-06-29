# Auto-Orquestração de Tarefas — Times Digitais sobre o OpenClaude

> Proposta de arquitetura para transformar o AITerminalControl de um "terminal remoto com
> pedidos" em um **workflow de desenvolvimento digital real**: um time de agentes que
> recebe uma documentação, decompõe o trabalho, delega ao papel certo, revisa, corrige e
> entrega — atravessando jornadas inteiras de trabalho sem morrer quando a janela de
> contexto enche, e com supervisão/intervenção humana opcional pelo celular.

**Status:** proposta (design). Nada aqui foi aplicado ao código ainda.
**Codinome do componente novo:** `Maestro` (o orquestrador).
**Data:** 2026-06-28.

---

## 0. TL;DR

O erro mental comum é imaginar **um agente gigante que trabalha para sempre**. Isso é
fisicamente impossível: toda janela de contexto é finita, e mesmo com auto-compactação a
fidelidade degrada. Projetos longos não cabem em uma sessão.

A solução que a indústria convergiu — e que o seu stack **já está pronto para suportar** —
é a inversão disso:

> **O cérebro do projeto é o banco de dados, não a janela de tokens.**
> O estado durável (plano, tarefas, artefatos, revisões) vive no Postgres. Cada unidade de
> trabalho é executada por uma **sessão OpenClaude nova, curta e de escopo mínimo**. O
> controle de fluxo é **código determinístico** (no daemon); o LLM é chamado em *rajadas
> limitadas* só para julgamento (planejar, implementar uma tarefa, revisar, sintetizar).

Com isso, "o limite de tokens por sessão" deixa de ser uma parede: o *projeto* dura dias;
cada *agente* dura minutos. Você ganha jornadas de trabalho contínuas, paralelismo,
verificação real (nada de "done" alucinado) e pontos de supervisão humana que não
interrompem o fluxo.

A boa notícia: **~70% das primitivas necessárias já existem**. Falta a camada de
orquestração durável (Maestro) e as tabelas que a sustentam.

---

## 1. Avaliação honesta da ideia

### O que é forte e viável
- A visão está **correta e alinhada com o estado da arte** (orchestrator-workers + durable
  execution). Não é fantasia.
- Seu stack é, por sorte ou bom projeto, **quase ideal** para isso:
  - OpenClaude expõe exatamente as alavancas de orquestração programática (headless
    stream-json, subagentes, papéis, output estruturado, limites de custo/turnos).
  - Supabase Postgres é um store durável transacional com Realtime e RLS — perfeito para
    ser o "cérebro" do projeto.
  - O daemon já é um executor de sessões OpenClaude com recuperação (`catchUp`) e
    roteamento multi-máquina (`sessions.daemon_id`).
  - O fluxo de `permission_requests` já é, na prática, um **mecanismo de Human-in-the-Loop
    pronto** — basta generalizá-lo para "checkpoints".

### Onde está a dificuldade real (e o que esta proposta resolve)
1. **Durabilidade através de jornadas longas.** Resolvido separando estado durável
   (Postgres) de execução efêmera (sessões curtas). Seção 2 e 3.
2. **Evitar "done" alucinado.** Um agente que diz "terminei" não basta. Resolvido com
   *gates* de Definition of Done verificáveis (testes passam, build verde, revisor aprova).
   Seção 6.
3. **Não compor erros.** Cada tarefa passa por um revisor adversarial antes de avançar.
   Seção 5 e 6.
4. **Custo e loops descontrolados.** Resolvido com tetos de orçamento/turnos por tarefa e
   por projeto, detecção de oscilação e watchdog. Seção 11.
5. **Autonomia vs. supervisão.** O usuário pediu "sem intervenção humana" **e** "com
   supervisão humana" — os dois. Resolvido com **níveis de autonomia configuráveis** e
   checkpoints que só bloqueiam quando a política exige. Seção 10.

### O que conscientemente **não** prometemos
- "Zero supervisão para sempre, em qualquer projeto." Isso é irresponsável. O sistema é
  projetado para rodar autônomo por longos trechos, mas **escala a supervisão ao risco**:
  ações destrutivas, deploys, gastos acima de um teto e falhas repetidas sempre podem
  pausar e pedir um humano. Você decide o quão solto deixar (Seção 10).

---

## 2. O reframe central: estado durável vs. janela de tokens

### Por que "um agente para sempre" falha
| Sintoma | Causa raiz |
|---|---|
| Esquece o começo do projeto | Janela finita; compactação perde fidelidade ("lost in the middle") |
| Perde tudo se cair | Sessão linear sem checkpoint transacional |
| Qualidade cai com o tempo | Mesmo contexto mistura planejar + codar + revisar |
| Não paraleliza | Uma sessão = uma linha de execução |
| "Terminei" sem ter terminado | Sem verificação externa, só auto-relato |

### O modelo robusto
```
                    O QUE É DURÁVEL                 O QUE É EFÊMERO
                ┌────────────────────────┐      ┌──────────────────────────┐
   Projeto  →   │ Postgres (Supabase)    │      │ Sessões OpenClaude        │
   (dias)       │  - plano / DAG tarefas │ ───▶ │  - 1 tarefa por sessão    │
                │  - artefatos / diffs   │      │  - contexto curado/mínimo │
                │  - revisões / veredito │ ◀─── │  - dura minutos           │
                │  - checkpoints (HITL)  │      │  - morre ao terminar      │
                │  - memória do projeto  │      │  (minutos)                │
                └────────────────────────┘      └──────────────────────────┘
                          ▲
                          │ controle determinístico (código no daemon)
                  ┌───────┴────────┐
                  │  MAESTRO loop  │  ← escolhe próxima tarefa, escala papel,
                  └────────────────┘    ingere resultado, avança a state machine
```

Três regras que fazem isso funcionar:

1. **Decompor antes de executar.** Um documento vira um plano (árvore/DAG de tarefas) com
   critérios de aceite. Nenhuma tarefa é grande demais para uma sessão curta.
2. **Contexto mínimo por tarefa.** A sessão que implementa a tarefa T recebe só: a spec de
   T, os critérios de aceite, os arquivos relevantes e as decisões de projeto pertinentes —
   **não** o histórico inteiro. Contexto pequeno = mais barato, mais rápido, mais correto.
3. **Controle em código, julgamento em LLM.** O loop que decide "qual tarefa agora, qual
   papel, passou no gate?" é código determinístico e testável. O LLM é invocado em chamadas
   limitadas (`--max-turns`, `--max-budget-usd`) para os passos que exigem inteligência.

> Resultado direto para o seu pedido: o sistema **não finaliza porque a janela encheu**.
> A janela de uma sessão encher só significa "esta tarefa precisa ser quebrada em duas". O
> projeto continua, porque o projeto vive no banco.

---

## 3. Arquitetura em camadas

```
┌─────────────┐   wss    ┌──────────────────────────┐   wss   ┌────────────────────────────────────┐
│  CELULAR    │ ───────▶ │  SUPABASE                │ ◀────── │  PC DE CASA (daemon)               │
│  PWA        │          │  Realtime + Auth + RLS   │         │                                    │
│  - Board    │ ◀─────── │                          │ ──────▶ │  ┌──────────────────────────────┐  │
│  - Tarefas  │          │  ESTADO DURÁVEL:         │         │  │ MAESTRO (orquestrador)       │  │
│  - Check-   │          │  projects, tasks,        │         │  │  loop de controle (código)   │  │
│    points   │          │  artifacts, agent_runs,  │         │  │  fila/DAG de tarefas         │  │
│  - Timeline │          │  reviews, checkpoints,   │         │  │  roteamento por papel        │  │
└─────────────┘          │  project_memory          │         │  │  gates / Definition of Done  │  │
                         │  (+ tabelas atuais)      │         │  └───────────┬──────────────────┘  │
                         └──────────────────────────┘         │              │ spawn (sessão curta) │
                                                              │              ▼                      │
                                                              │  ┌──────────────────────────────┐  │
                                                              │  │ OpenClaude (stream-json)     │  │
                                                              │  │  papéis: planner, arquiteto, │  │
                                                              │  │  impl, revisor, tester,      │  │
                                                              │  │  integrador, pesquisador     │  │
                                                              │  │  + subagentes nativos        │  │
                                                              │  └──────────────────────────────┘  │
                                                              └────────────────────────────────────┘
```

| Camada | Componente | Estado | O que existe hoje |
|---|---|---|---|
| 0 — Engine | OpenClaude | efêmero | ✅ existe (stream-json, subagentes, MCP, papéis) |
| 1 — Executor | daemon `oc-bridge` | efêmero | ✅ existe (spawn, catchUp, roteamento) — **estender** |
| 2 — Orquestrador | **Maestro** (novo, no daemon) | controla | ❌ **construir** |
| 3 — Estado durável | Supabase Postgres | durável | ✅ infra existe — **novas tabelas** |
| 4 — Supervisão | PWA | view + ações | ✅ infra existe — **novas telas** |

---

## 4. A fronteira que destrava tudo: macro vs. micro orquestração

O OpenClaude **já tem** multi-agentes (`AgentTool`, `subagent_type`, teams, `isolation:
worktree`). Pergunta natural: por que não usar só isso?

Porque os subagentes nativos vivem **dentro de uma sessão / processo** — compartilham
contexto e morrem com ela. São ótimos para *fan-out efêmero dentro de uma tarefa*, mas
**não** resolvem durabilidade nem o limite de contexto através de um projeto de dias.

A fronteira limpa:

| | Macro-orquestração | Micro-orquestração |
|---|---|---|
| **Quem** | Maestro (daemon + Postgres) | OpenClaude `AgentTool` nativo |
| **Escopo** | o projeto inteiro, dias/semanas | uma tarefa, minutos |
| **Estado** | durável no banco | efêmero na sessão |
| **Exemplo** | "implementar feature X" → 12 tarefas, revisões, integração | dentro da tarefa "escrever endpoint", abrir 3 sub-buscas em paralelo |
| **Sobrevive a restart/limite de contexto?** | ✅ sim | ❌ não (nem precisa) |

> **Regra de ouro:** o Maestro orquestra o *macro plano durável* (entre sessões, entre
> dias). Dentro de uma única tarefa, o agente pode usar subagentes nativos para
> decomposição fina. Use a ferramenta certa em cada nível.

---

## 5. Os papéis — o "time digital"

Cada papel é um agente especializado definido em `.claude/agents/<papel>.md` (frontmatter
YAML já suportado: `description`, `tools`, `disallowedTools`, `prompt`, `model`, `effort`,
`permissionMode`, `maxTurns`, `mcpServers`, `hooks`). O Maestro escolhe o papel por tarefa.

| Papel | Responsabilidade | Tools típicas | Gate que produz |
|---|---|---|---|
| **Planner / Tech Lead** | Lê a doc → produz o plano (DAG de tarefas + critérios de aceite + dependências) | Read, Grep, Glob, WebFetch (output estruturado) | o plano em si |
| **Arquiteto** | Decisões de design, stack, contratos entre módulos; quebra épicos | Read, Grep, Glob | ADRs / decisões em `project_memory` |
| **Implementador** (backend / frontend / infra) | Escreve o código de **uma** tarefa, em worktree isolada | Read, Write, Edit, Bash, Glob, Grep | diff + auto-relato |
| **Revisor / Crítico** | Revisão **adversarial** (instruído a *refutar*): correção, segurança, simplicidade | Read, Grep, Glob (sem escrita) | veredito `approved` / `changes_requested` |
| **Tester / QA** | Escreve e roda testes; valida critérios de aceite contra a realidade | Read, Write, Bash | resultado de teste (verdadeiro, não auto-relato) |
| **Integrador** | Faz merge da worktree, resolve conflitos, roda build/testes completos | Read, Edit, Bash | build verde / falha |
| **Pesquisador** | Busca docs externas, APIs, exemplos | WebFetch, WebSearch, Read | relatório citado |
| **Escriba / Memória** | Mantém `project_memory`: decisões, convenções, glossário | Read, Write | atualizações de memória |

Princípios de design dos papéis:
- **Implementador nunca aprova o próprio trabalho.** Separação de poderes → revisor/tester
  independentes (contextos separados pegam o que a redundância não pega).
- **Revisor é adversarial.** Prompt padrão: "tente refutar que esta tarefa está correta;
  na dúvida, marque `changes_requested`." Isso mata o viés de complacência.
- **Papéis read-only** (revisor, pesquisador) recebem `disallowedTools` de escrita —
  garantia estrutural, não confiança.

---

## 6. Ciclo de vida da tarefa (state machine + gates)

```
                ┌──────────┐  deps satisfeitas   ┌────────┐
                │ backlog  │ ──────────────────▶ │ ready  │
                └──────────┘                     └───┬────┘
                                                     │ Maestro pega
                                                     ▼
                                              ┌─────────────┐
                            ┌───────────────▶ │ in_progress │ ◀───────────┐
                            │                 └──────┬──────┘             │
                            │ changes_requested      │ implementador      │
                            │                        │ termina            │
                     ┌──────┴───────┐                ▼                    │
                     │ in_review    │ ◀──── revisor + tester              │
                     └──────┬───────┘                                     │
            approved + gates│ passam      changes_requested ──────────────┘
                            ▼                  (até max_attempts)
                       ┌────────┐
                       │  done  │ → desbloqueia tarefas dependentes
                       └────────┘

   estados de escape:  blocked (precisa de humano/dep externa) · failed · cancelled
```

### Definition of Done (DoD) — o gate que impede "done" alucinado
Uma tarefa **só** vai para `done` se **todos** os gates aplicáveis passarem (configurável
por tarefa/projeto):
- ✅ **Build/typecheck verde** (`tsc --noEmit`, etc. — o openclaude já tem `typecheck`).
- ✅ **Testes da tarefa passam** (executados pelo tester, resultado real capturado, não
  auto-relato).
- ✅ **Revisor aprovou** (`verdict = approved`).
- ✅ **Critérios de aceite** marcados e verificáveis.
- ✅ Sem gasto acima do teto da tarefa.

Se qualquer gate falha → `changes_requested` com as findings anexadas, e a tarefa volta a
`in_progress` (até `max_attempts`, depois `blocked` → checkpoint humano).

---

## 7. O loop do Maestro (controle determinístico)

Pseudocódigo do controlador. **Nota:** o fluxo é código; cada passo "agente faz X" é uma
sessão OpenClaude curta, headless, com schema de output estruturado.

```ts
// roda no daemon, em paralelo aos listeners atuais. Tudo idempotente e restart-safe:
// cada transição é um write transacional no Postgres.

async function maestroTick(project: Project) {
  // 0. Política de autonomia / pausa
  if (project.status === 'paused') return
  if (overBudget(project)) return openCheckpoint(project, 'budget')

  // 1. Projeto sem plano → planejar
  if (!project.has_plan) {
    const plan = await runAgent('planner', {
      input: project.spec,                  // a documentação que você jogou
      schema: PLAN_SCHEMA,                  // structured_output: tarefas + deps + aceite
      maxTurns: 30, maxBudgetUsd: project.plan_budget,
    })
    await persistPlan(project, plan)
    if (project.autonomy <= L2) return openCheckpoint(project, 'plan_approval', plan)
    return
  }

  // 2. Escolher a próxima tarefa pronta (deps satisfeitas), por prioridade
  const task = await nextReadyTask(project)
  if (!task) return maybeFinishProject(project)   // nada pronto → talvez acabou

  // 3. Executar conforme o estado
  switch (task.status) {
    case 'ready': {
      await setStatus(task, 'in_progress')
      const ctx = await curateContext(task)          // contexto MÍNIMO da tarefa
      const run = await runAgent(roleFor(task), {     // ex.: 'implementador'
        input: taskBrief(task, ctx),
        schema: WORK_SCHEMA,
        isolation: 'worktree',                        // implementadores isolados
        maxTurns: task.max_turns, maxBudgetUsd: task.budget,
      })
      await persistArtifacts(task, run.artifacts)     // diff, arquivos, notas
      await setStatus(task, 'in_review')
      break
    }
    case 'in_review': {
      const review  = await runAgent('revisor', { input: reviewBrief(task), schema: REVIEW_SCHEMA })
      const testing = await runAgent('tester',  { input: testBrief(task),   schema: TEST_SCHEMA })
      await persistReview(task, review, testing)
      if (gatesPass(task, review, testing)) {
        await setStatus(task, 'done')
        await unlockDependents(task)                  // libera o DAG
      } else if (task.attempts < task.max_attempts) {
        await setStatus(task, 'in_progress', { feedback: merge(review, testing) })
      } else {
        await setStatus(task, 'blocked')
        await openCheckpoint(project, 'task_stuck', task)   // chama o humano
      }
      break
    }
  }

  // 4. Quando todas as tarefas estão done → integrador roda o build completo
  // 5. Eventos de progresso são publicados via Realtime para o PWA o tempo todo
}
```

Pontos-chave de robustez embutidos:
- **Idempotência:** toda transição é um `UPDATE` transacional; reexecutar o tick não
  duplica trabalho.
- **Restart-safe:** estende o `catchUp()` atual — ao subir, o Maestro relê tarefas
  `in_progress` órfãs e decide retomar ou marcar para retry.
- **Sem trabalho perdido:** artefatos são persistidos *antes* de avançar de estado.

---

## 8. Modelo de dados (proposta de SQL)

Estende o schema atual (`profiles`, `daemons`, `sessions`, `messages`,
`permission_requests`, `terminals`) seguindo **as mesmas convenções**: `owner_id`, RLS
`owner_id = auth.uid()`, e publicação no `supabase_realtime`.

```sql
-- Um projeto = uma "jornada de trabalho" durável.
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  daemon_id      uuid references public.daemons,
  title          text not null,
  spec           text,                       -- a documentação inicial (ou ref p/ storage)
  status         text default 'planning'
                 check (status in ('planning','running','paused','blocked','done','failed','cancelled')),
  autonomy_level smallint default 2,         -- 0..3 (ver Seção 10)
  budget_usd     numeric,                    -- teto total do projeto
  spent_usd      numeric default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- DAG de tarefas. parent_id p/ hierarquia, depends_on p/ dependências.
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects on delete cascade,
  owner_id      uuid not null,
  parent_id     uuid references public.tasks,
  title         text not null,
  spec          text,
  role          text,                        -- 'implementador' | 'revisor' | ...
  status        text default 'backlog'
                check (status in ('backlog','ready','in_progress','in_review',
                                  'changes_requested','blocked','done','failed','cancelled')),
  depends_on    uuid[] default '{}',         -- ids de tarefas que precisam estar 'done'
  acceptance    jsonb default '[]',          -- critérios de aceite verificáveis
  priority      int default 0,
  attempts      int default 0,
  max_attempts  int default 3,
  budget_usd    numeric,
  spent_usd     numeric default 0,
  blocked_reason text,
  oc_session_id text,                        -- liga ao transcript JSONL do openclaude
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index tasks_project_idx on public.tasks (project_id, status, priority desc);

-- O que cada tarefa produziu (durável, auditável).
create table public.artifacts (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  owner_id   uuid not null,
  type       text check (type in ('diff','file','report','decision','test_result','log')),
  title      text,
  content    text,                           -- inline, ou ref p/ Supabase Storage se grande
  meta       jsonb default '{}',
  created_at timestamptz default now()
);

-- Telemetria de cada sessão de agente (custo, tokens, veredito).
create table public.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid references public.tasks on delete cascade,
  project_id     uuid not null references public.projects on delete cascade,
  owner_id       uuid not null,
  role           text not null,
  oc_session_id  text,
  status         text check (status in ('running','success','error','timeout','killed')),
  result_subtype text,                       -- success | error_max_turns | error_max_budget_usd | ...
  num_turns      int,
  cost_usd       numeric,
  tokens         jsonb,                       -- {input, output, cache_read, cache_creation}
  started_at     timestamptz default now(),
  ended_at       timestamptz
);

-- Vereditos de revisão/teste (separados dos artefatos para o gate).
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks on delete cascade,
  owner_id    uuid not null,
  reviewer    text not null,                 -- 'revisor' | 'tester'
  verdict     text check (verdict in ('approved','changes_requested','rejected')),
  findings    jsonb default '[]',
  created_at  timestamptz default now()
);

-- Checkpoints = Human-in-the-Loop GENERALIZADO (mesmo padrão de permission_requests).
create table public.checkpoints (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects on delete cascade,
  task_id     uuid references public.tasks,
  owner_id    uuid not null,
  type        text check (type in ('plan_approval','gate','budget','risk','question','task_stuck')),
  title       text,
  payload     jsonb default '{}',            -- o que está sendo decidido
  status      text default 'pending'
              check (status in ('pending','approved','rejected','answered','expired')),
  response    jsonb,                          -- decisão/edição/resposta do humano
  created_at  timestamptz default now(),
  decided_at  timestamptz
);

-- Memória persistente do projeto (decisões, convenções, glossário) — anti-amnésia.
create table public.project_memory (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  owner_id   uuid not null,
  kind       text check (kind in ('decision','fact','convention','glossary','risk')),
  key        text,
  content    text not null,
  created_at timestamptz default now()
);

-- RLS uniforme (igual ao schema atual):
-- alter table ... enable row level security;
-- create policy "owner" on <t> using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- alter publication supabase_realtime add table projects, tasks, checkpoints, agent_runs, reviews;
```

Observações:
- **Reuso, não reinvenção:** `agent_runs.oc_session_id` aponta para o transcript JSONL que
  o openclaude já grava em `~/.claude/projects/<hash>/<id>.jsonl`. O histórico fino fica lá;
  o Postgres guarda o estado macro e os marcos.
- `checkpoints` é a generalização de `permission_requests` — mesmo ciclo
  `pending → decisão → retoma`, mesma entrega via web push.

---

## 9. Extensões de protocolo (Envelope) e reuso do fluxo de permissão

O `Envelope` atual (`{session_id, source, kind, payload}`) cobre uma sessão de chat. Para o
board de projeto, generalizamos com novos `kind`s — sem quebrar o que existe:

```ts
export type EnvelopeKind =
  // ...existentes: 'user_turn' | 'event' | 'permission_req' | 'permission_res'
  //                | 'interrupt' | 'status'
  | 'project_event'     // daemon → phone: progresso (tarefa mudou de estado, custo, etc.)
  | 'checkpoint_req'    // daemon → phone: precisa de decisão humana (generaliza permission_req)
  | 'checkpoint_res'    // phone → daemon: decisão/edição/resposta
  | 'intervention'      // phone → daemon: pausar, repriorizar, editar spec, injetar mensagem
```

> **Insight de implementação:** o `checkpoint_req`/`checkpoint_res` é **exatamente** o seu
> fluxo de `permission_req`/`permission_res`, só que com payloads mais ricos (aprovar plano,
> aprovar gate, responder pergunta). Você já tem o caminho ponta-a-ponta provado: persistir
> pendente → web push → card no celular → decisão → daemon retoma. Generalizar é baixo risco.

`intervention` é a alavanca de "supervisão sem interromper": o humano pode, a qualquer
momento, pausar o projeto, mudar a prioridade de uma tarefa, editar a spec de uma tarefa
ainda não iniciada, ou injetar uma instrução — sem matar o projeto.

---

## 10. Níveis de autonomia + Human-in-the-Loop

Você pediu dois opostos ("sem intervenção" **e** "com supervisão"). A resolução é um dial
por projeto (`projects.autonomy_level`):

| Nível | Nome | O que pede ao humano | Quando usar |
|---|---|---|---|
| **L0** | Manual | aprova cada tarefa antes e depois | depurando o sistema |
| **L1** | Supervisionado | aprova o plano + cada tarefa concluída | projetos sensíveis |
| **L2** | Com portões (default) | aprova o plano + gates de risco + gasto acima de teto; o resto roda sozinho | uso normal |
| **L3** | Autônomo | só bloqueia em paradas duras: orçamento estourado, falha repetida, ação destrutiva/deploy | jornadas longas confiáveis |

**Regras que valem em todos os níveis** (cinto de segurança, independente da autonomia):
- Ações **destrutivas / irreversíveis** (Bash com `rm -rf`, force-push, deploy, migração de
  banco, gastos externos) **sempre** abrem um checkpoint de `risk`.
- Estouro de orçamento **sempre** pausa.
- N falhas seguidas na mesma tarefa **sempre** escalam para humano.

Isso entrega o melhor dos dois mundos: trechos longos de trabalho autônomo, com o humano
no loop só onde o risco justifica — e nunca uma interrupção desnecessária.

---

## 11. Robustez — modos de falha e guardrails

O que separa esta proposta de um demo de hype é tratar os modos de falha de frente.

| Risco | Mitigação concreta | Alavanca existente |
|---|---|---|
| **Custo descontrolado** | teto por tarefa e por projeto; Maestro pausa e abre checkpoint `budget` ao atingir | `--max-budget-usd`; `result.total_cost_usd` |
| **Loop infinito / agente travado** | `--max-turns` por sessão + watchdog (dead-man timer) | `--max-turns`; `idleReapMs` do daemon já reapa sessões ociosas |
| **Oscilação** (vai-e-volta sem convergir) | `max_attempts` por tarefa → `blocked` → checkpoint humano | `tasks.attempts` |
| **"Done" alucinado** | gates de DoD verificáveis (build/test/revisor), revisor adversarial | `result.is_error`, testes reais |
| **Erro composto** | revisor independente + tester em contexto separado antes de avançar | papéis isolados |
| **Conflito entre implementadores paralelos** | cada implementador em git worktree; integrador faz merge depois | `isolation: 'worktree'` (nativo) |
| **Contexto envenenado / amnésia** | sessões curtas com contexto curado + `project_memory` reinjetada | sessões efêmeras |
| **Crash do daemon no meio** | toda transição é write transacional; `catchUp` estendido retoma | `catchUp()` já existe |
| **Segurança / vazamento** | RLS owner-only mantido; segredos nunca saem do daemon; tools de rede/deploy sempre em checkpoint | RLS atual; `permission_requests` |
| **Trabalho silenciosamente truncado** | se o Maestro corta escopo (top-N, sem retry), registra em `project_event` visível | observabilidade |

Observabilidade de primeira classe: `agent_runs` dá custo/tokens/turnos por sessão →
dashboards de gasto e tempo no PWA. Nada de "caixa-preta".

---

## 12. Superfície no PWA (supervisão pelo celular)

Tudo via Realtime, reaproveitando os padrões atuais (`postgres_changes` + broadcast +
web push).

- **Board do projeto** (kanban por `tasks.status`): backlog → ready → in_progress →
  in_review → done. Atualiza ao vivo.
- **Detalhe da tarefa**: spec, artefatos (diff renderizado), vereditos de revisão/teste,
  link para o transcript da sessão, custo.
- **Inbox de checkpoints**: aprovações/perguntas pendentes com push (reusa
  `push_subscriptions`). Aprovar plano, aprovar gate, responder pergunta, liberar tarefa.
- **Intervenções**: pausar projeto, repriorizar, editar spec de tarefa pendente, injetar
  mensagem num agente, forçar aprovar/rejeitar.
- **Timeline / feed**: stream de `project_event` — "o que o time está fazendo agora".
- **Painel de custo**: gasto por projeto/tarefa/papel (de `agent_runs`).

---

## 13. Exemplo ponta-a-ponta (um dia na vida)

```
1. Você joga no PWA: "Implementar autenticação por e-mail + recuperação de senha" + a doc.
   → cria projects(status='planning', autonomy=2)

2. Maestro: runAgent('planner') → plano com 8 tarefas + DAG + critérios de aceite.
   → persiste tasks; autonomy=L2 → abre checkpoint 'plan_approval'.
   → push no celular: "Plano pronto: 8 tarefas. Aprovar?"

3. Você aprova no celular (ou edita uma tarefa antes). → projects(status='running')

4. Maestro pega T1 "schema de usuários" (ready, sem deps):
   → implementador em worktree → diff → in_review
   → revisor (adversarial) + tester (roda migrations) → ambos approved → DONE
   → desbloqueia T2, T3.

5. T4 "endpoint de reset" falha no tester 2x (token não expira).
   → changes_requested com as findings → implementador corrige → 3ª tentativa passa → DONE.

6. T7 precisa enviar e-mail real (ação externa com custo) → checkpoint 'risk'.
   → push: "T7 quer configurar provedor de e-mail (custo). Aprovar?" → você aprova.

7. Todas as tarefas DONE → integrador roda build+testes completos → verde.
   → projects(status='done'). Push: "Feature de auth concluída. 8/8 tarefas, US$ X, Y min."

Em nenhum momento o sistema parou por "acabou a janela de tokens". Cada tarefa foi uma
sessão curta; o projeto inteiro viveu no Postgres.
```

---

## 14. Roadmap por fases (cada fase é entregável e testável)

### Fase 0 — Fundação do loop durável (prova de conceito)
- Migrations: `projects`, `tasks`, `artifacts`, `agent_runs`, `checkpoints` (+ RLS + Realtime).
- Maestro skeleton no daemon: loop, `nextReadyTask`, `runAgent` (wrapper sobre o spawn
  headless atual com schema de output), persistência de artefatos.
- **Sem planner ainda:** você cadiciona tarefas manualmente (lista no PWA). Um único papel
  (`implementador`) executa tarefas de escopo curto.
- Reuso do fluxo de permissão para um checkpoint simples.
- **Meta:** provar que o loop durável executa N tarefas em sessões curtas e sobrevive a
  restart do daemon.

### Fase 1 — Planejamento + papéis + gates
- `.claude/agents/`: planner, implementador, revisor, tester.
- `runAgent('planner')` decompõe a doc → DAG de tarefas com critérios de aceite (output
  estruturado).
- State machine completa com DoD gates (build/test/review).
- Board v1 no PWA (kanban ao vivo) + inbox de checkpoints.
- **Meta:** jogar uma doc pequena e ver o time entregar 1 feature ponta-a-ponta com revisão.

### Fase 2 — Autonomia, memória e guardrails
- `autonomy_level` (L0–L3) + regras de risco; `project_memory`.
- Tetos de orçamento/turnos, detecção de oscilação, watchdog.
- Worktree isolation para implementadores paralelos + papel `integrador`.
- Painel de custo (de `agent_runs`).
- **Meta:** rodar uma jornada de várias horas em L2/L3 com supervisão mínima.

### Fase 3 — Escala e polimento
- Escalonamento do DAG com paralelismo real entre tarefas independentes.
- Resumability hardening; retomada granular de sessões via `--resume`.
- MCP: expor o estado do projeto como servidor MCP (`claude mcp serve`) para os agentes
  consultarem o board nativamente.
- Distribuição multi-máquina (você já tem `daemon_id` para isso).
- **Meta:** projetos de dias, múltiplas features, supervisão por exceção.

---

## 15. Decisões em aberto (com recomendação)

1. **Onde roda o "cérebro" do orquestrador?**
   → **Recomendado:** controle de fluxo em **código no daemon** (determinístico,
   testável); julgamento (planejar/rever/sintetizar) em **sessões OpenClaude com output
   estruturado**. Evita integrar um segundo SDK de LLM e reusa toda a engine.

2. **Granularidade das tarefas.**
   → Regra prática: uma tarefa deve caber confortavelmente numa sessão curta (alvo:
   < ~40 turnos, < um teto de custo). Se o agente bater no limite, isso é sinal de que o
   planner deve **quebrar a tarefa**, não de que o sistema falhou.

3. **Quanto delegar aos subagentes nativos vs. ao Maestro?**
   → Macro (entre tarefas, durável) = Maestro. Micro (dentro de uma tarefa) = subagentes
   nativos. Não duplique a durabilidade no nível micro.

4. **Storage de artefatos grandes (diffs enormes, logs).**
   → Inline no Postgres até um limite; acima disso, Supabase Storage com ref na coluna
   `content`. Decidir o limite na Fase 0.

5. **Modelo por papel.**
   → Papéis de julgamento pesado (planner, revisor) podem usar um modelo mais forte;
   implementação rotineira pode usar um mais barato/rápido. `model`/`effort` por agente já
   são suportados — calibrar com dados de `agent_runs`.

---

## 16. Por que isto é "realmente aplicável" e não teoria

Cada peça central mapeia para algo que **já existe** no seu código:

| Necessidade da orquestração | Já existe em |
|---|---|
| Rodar agente headless, multi-turno, com I/O estruturado | daemon spawna `--print --input-format stream-json --output-format stream-json` |
| Disparar/isolar subagentes | `AgentTool` (`subagent_type`, `isolation: worktree`) |
| Definir papéis especializados | `.claude/agents/*.md` (frontmatter já suportado) |
| Estado durável transacional + tempo real | Supabase Postgres + Realtime + RLS |
| Human-in-the-Loop com push | fluxo `permission_requests` + `push_subscriptions` |
| Limites de custo/turnos e custo por sessão | `--max-budget-usd`, `--max-turns`, `result.total_cost_usd` |
| Recuperação após queda | `catchUp()` + roteamento `daemon_id` |
| Histórico fino auditável | transcripts JSONL do openclaude |

O trabalho novo é, essencialmente, **uma camada de orquestração (Maestro) + as tabelas que
a sustentam + telas de board no PWA**. As primitivas difíceis (engine de agente, transporte,
auth, push, recuperação) você já construiu.

---

## Apêndice A — Schemas de output estruturado (esboço)

```ts
// O planner é forçado a devolver isto (via structured_output do openclaude):
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    tasks: { type: 'array', items: { type: 'object', properties: {
      ref:        { type: 'string' },            // id local p/ referenciar deps
      title:      { type: 'string' },
      role:       { type: 'string' },            // implementador | arquiteto | ...
      spec:       { type: 'string' },
      depends_on: { type: 'array', items: { type: 'string' } },
      acceptance: { type: 'array', items: { type: 'string' } },
      risk:       { type: 'string', enum: ['low','medium','high'] },
    }}},
    open_questions: { type: 'array', items: { type: 'string' } }, // viram checkpoints
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict:  { type: 'string', enum: ['approved','changes_requested','rejected'] },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker','major','minor','nit'] },
      file:     { type: 'string' },
      detail:   { type: 'string' },
    }}},
  },
}
```

## Apêndice B — Exemplo de papel: `.claude/agents/revisor.md`

```markdown
---
name: revisor
description: Revisão adversarial de uma tarefa concluída. Tenta refutar a correção.
tools: [Read, Grep, Glob]
disallowedTools: [Write, Edit, Bash]
model: inherit
permissionMode: plan
maxTurns: 20
---

Você é um revisor adversarial. Recebe o diff e os critérios de aceite de UMA tarefa.
Seu trabalho NÃO é elogiar — é tentar provar que está errado: bugs de correção, falhas de
segurança, casos de borda não tratados, complexidade desnecessária, critério de aceite não
cumprido. Na dúvida, marque `changes_requested`. Devolva o veredito no schema exigido.
```
