-- Anexos (imagens/PDFs/arquivos) enviados pelo celular junto com um user_turn.
-- O arquivo em si vai para o Storage (bucket privado); a linha de `messages`
-- carrega só metadados ({storage_path, name, mime, size}) no payload jsonb —
-- base64 dentro do Postgres/Realtime estouraria o limite de payload do
-- postgres_changes e incharia a tabela.
--
-- Convenção de caminho: <owner_id>/<session_id>/<uuid>/<nome-original>
-- O primeiro segmento ser o auth.uid() é o que as políticas abaixo verificam.

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20 * 1024 * 1024) -- 20MB por arquivo
on conflict (id) do nothing;

-- RLS em storage.objects: dono só enxerga/mexe na própria pasta.
-- (upload = insert pela PWA; download = select pelo daemon, logado na MESMA conta)
create policy "attachments: owner select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments: owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments: owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
