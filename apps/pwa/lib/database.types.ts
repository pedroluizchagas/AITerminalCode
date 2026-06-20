/**
 * Tipos do schema Postgres (espelham as migrations em supabase/migrations).
 * Escritos à mão (não gerados) para manter o app autocontido e fortemente tipado.
 * Se o schema mudar, atualize aqui — ou rode `supabase gen types typescript`.
 */

export type DaemonStatus = 'offline' | 'online' | 'working'
export type SessionStatus = 'active' | 'idle' | 'closed'
export type MessageSource = 'phone' | 'daemon'
export type MessageKind =
  | 'user_turn'
  | 'event'
  | 'permission_req'
  | 'permission_res'
  | 'interrupt'
  | 'status'
export type PermissionStatus = 'pending' | 'allowed' | 'denied' | 'expired'

export type ProfileRow = {
  id: string
  email: string | null
  created_at: string
}

export type DaemonRow = {
  id: string
  owner_id: string
  name: string
  status: DaemonStatus
  last_seen_at: string | null
  created_at: string
}

export type SessionRow = {
  id: string
  owner_id: string
  daemon_id: string | null
  oc_session_id: string | null
  project_path: string | null
  title: string | null
  status: SessionStatus
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  session_id: string
  owner_id: string
  source: MessageSource
  kind: MessageKind
  payload: Record<string, unknown>
  created_at: string
}

export type PermissionRequestRow = {
  id: string
  session_id: string
  owner_id: string
  request_id: string
  tool_name: string
  tool_use_id: string | null
  input: Record<string, unknown>
  status: PermissionStatus
  decision_message: string | null
  created_at: string
  decided_at: string | null
}

export type PushSubscriptionRow = {
  id: string
  owner_id: string
  endpoint: string
  keys: Record<string, unknown>
  created_at: string
}

/** Helper genérico para definir Row/Insert/Update de uma tabela. */
type TableDef<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

// NB: precisa ser `type` (não `interface`) — o postgrest-js exige index signature
// implícita; com `interface` o generic cai no default e os inserts viram `never`.
export type Database = {
  // Necessário no supabase-js novo para resolver Insert/Update (senão viram `never`).
  __InternalSupabase: { PostgrestVersion: '14.5' }
  public: {
    Tables: {
      profiles: TableDef<ProfileRow, Pick<ProfileRow, 'id'> & Partial<ProfileRow>>
      daemons: TableDef<
        DaemonRow,
        Omit<DaemonRow, 'id' | 'created_at' | 'status' | 'last_seen_at'> &
          Partial<Pick<DaemonRow, 'id' | 'status' | 'last_seen_at'>>
      >
      sessions: TableDef<
        SessionRow,
        Pick<SessionRow, 'owner_id'> & Partial<SessionRow>
      >
      messages: TableDef<
        MessageRow,
        Omit<MessageRow, 'id' | 'created_at'> & Partial<Pick<MessageRow, 'id'>>
      >
      permission_requests: TableDef<
        PermissionRequestRow,
        Omit<PermissionRequestRow, 'id' | 'created_at' | 'status' | 'decided_at' | 'decision_message'> &
          Partial<PermissionRequestRow>
      >
      push_subscriptions: TableDef<
        PushSubscriptionRow,
        Omit<PushSubscriptionRow, 'id' | 'created_at'> &
          Partial<Pick<PushSubscriptionRow, 'id'>>
      >
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
