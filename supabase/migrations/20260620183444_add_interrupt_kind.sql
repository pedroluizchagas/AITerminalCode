-- Inclui 'interrupt' nos kinds aceitos em messages (alinha banco <-> @ati/protocol
-- <-> daemon). O daemon escuta kind='interrupt' vindo do celular para Ctrl+C.
alter table public.messages drop constraint messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in (
    'user_turn', 'event', 'permission_req', 'permission_res', 'interrupt', 'status'
  ));
