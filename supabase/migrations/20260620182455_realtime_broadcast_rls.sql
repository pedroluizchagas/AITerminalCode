-- Realtime Broadcast (canais privados) — autorização por dono da sessão.
-- O stream token-a-token ao vivo trafega por Broadcast num canal cujo
-- topic = id da sessão. Só o dono daquela sessão pode ler/escrever no canal.
--
-- A tabela realtime.messages já tem RLS habilitada no Supabase hosted; aqui
-- adicionamos as policies que liberam o dono. realtime.topic() devolve o topic
-- do canal atual.

create policy "ati: read own session broadcast"
  on realtime.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      where s.id::text = (select realtime.topic())
        and s.owner_id = (select auth.uid())
    )
  );

create policy "ati: write own session broadcast"
  on realtime.messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.sessions s
      where s.id::text = (select realtime.topic())
        and s.owner_id = (select auth.uid())
    )
  );
