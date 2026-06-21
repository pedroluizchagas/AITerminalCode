-- Terminal remoto: cada linha é um pedido/sessão de PTY para um daemon.
-- O daemon (roteado por daemon_id) abre o PTY e troca bytes pelo Realtime Broadcast
-- (canal = id do terminal). Desarmado por padrão: o celular cria o pedido quando precisa.

create table public.terminals (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  daemon_id     uuid not null references public.daemons (id) on delete cascade,
  cwd           text,
  status        text not null default 'requested'
                  check (status in ('requested', 'active', 'closed')),
  closed_reason text,
  created_at    timestamptz not null default now()
);
create index terminals_owner_idx on public.terminals (owner_id, created_at desc);
create index terminals_daemon_idx on public.terminals (daemon_id);

alter table public.terminals enable row level security;

create policy "terminals: owner all" on public.terminals
  for all using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

alter publication supabase_realtime add table public.terminals;

-- Broadcast privado por terminal: só o dono daquele terminal lê/escreve no canal
-- (topic = id do terminal). Mesmo padrão usado para o stream das sessões.
create policy "ati: read own terminal broadcast"
  on realtime.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.terminals t
      where t.id::text = (select realtime.topic())
        and t.owner_id = (select auth.uid())
    )
  );

create policy "ati: write own terminal broadcast"
  on realtime.messages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.terminals t
      where t.id::text = (select realtime.topic())
        and t.owner_id = (select auth.uid())
    )
  );
