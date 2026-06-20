-- AITerminalControl — schema inicial
-- Superfície mobile para controlar o OpenClaude (daemon no PC de casa) via Supabase.
-- Tudo protegido por RLS: cada linha pertence a um owner_id = auth.uid().

-- ============================================================================
-- profiles — espelho de auth.users
-- ============================================================================
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- cria profile automaticamente quando um usuário se registra
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- daemons — uma máquina (PC de casa) por linha
-- ============================================================================
create table public.daemons (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  status       text not null default 'offline'
                 check (status in ('offline', 'online', 'working')),
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);
create index daemons_owner_idx on public.daemons (owner_id);

-- ============================================================================
-- sessions — uma sessão de conversa/projeto do OpenClaude
-- ============================================================================
create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  daemon_id     uuid references public.daemons (id) on delete set null,
  oc_session_id text,                       -- session_id reportado pelo OpenClaude
  project_path  text,                       -- cwd do projeto no PC de casa
  title         text,
  status        text not null default 'active'
                  check (status in ('active', 'idle', 'closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index sessions_owner_idx on public.sessions (owner_id, updated_at desc);

-- ============================================================================
-- messages — histórico durável (marcos: turno, resposta, tool result, system)
-- O stream token-a-token NÃO vira linha aqui (vai por Realtime Broadcast).
-- payload = objeto NDJSON nativo do OpenClaude, sem reembrulhar.
-- ============================================================================
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  source     text not null check (source in ('phone', 'daemon')),
  kind       text not null check (kind in (
               'user_turn', 'event', 'permission_req', 'permission_res', 'status'
             )),
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index messages_session_idx on public.messages (session_id, created_at);

-- ============================================================================
-- permission_requests — pedidos can_use_tool aguardando decisão no celular
-- ============================================================================
create table public.permission_requests (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.sessions (id) on delete cascade,
  owner_id         uuid not null references auth.users (id) on delete cascade,
  request_id       text not null,           -- request_id do control_request
  tool_name        text not null,
  tool_use_id      text,
  input            jsonb not null default '{}'::jsonb,
  status           text not null default 'pending'
                     check (status in ('pending', 'allowed', 'denied', 'expired')),
  decision_message text,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create index permreq_session_idx on public.permission_requests (session_id, created_at);
create index permreq_pending_idx on public.permission_requests (owner_id)
  where status = 'pending';

-- ============================================================================
-- push_subscriptions — Web Push (PWA instalada)
-- ============================================================================
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);
create index push_owner_idx on public.push_subscriptions (owner_id);

-- ============================================================================
-- updated_at automático em sessions
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sessions_touch_updated_at
  before update on public.sessions
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS — dono só enxerga/mexe no que é dele
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.daemons             enable row level security;
alter table public.sessions            enable row level security;
alter table public.messages            enable row level security;
alter table public.permission_requests enable row level security;
alter table public.push_subscriptions  enable row level security;

-- profiles: o próprio usuário
create policy "profiles: self select" on public.profiles
  for select using (id = (select auth.uid()));
create policy "profiles: self update" on public.profiles
  for update using (id = (select auth.uid()));

-- tabelas com owner_id: política única por ação (all = select/insert/update/delete)
create policy "daemons: owner all" on public.daemons
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "sessions: owner all" on public.sessions
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "messages: owner all" on public.messages
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "permission_requests: owner all" on public.permission_requests
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "push_subscriptions: owner all" on public.push_subscriptions
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ============================================================================
-- Realtime — postgres_changes para marcos (mensagens, permissões, status)
-- O stream ao vivo token-a-token usa Broadcast (configurado no app, Fase 1).
-- ============================================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.permission_requests;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.daemons;
