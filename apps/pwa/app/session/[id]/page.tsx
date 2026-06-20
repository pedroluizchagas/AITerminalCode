import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ChatView } from '@/components/chat/ChatView'
import type {
  MessageRow,
  PermissionRequestRow,
  SessionRow,
} from '@/lib/database.types'

export const dynamic = 'force-dynamic'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle<SessionRow>()

  if (!session) notFound()

  const [{ data: messages }, { data: pending }] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('session_id', id)
      .order('created_at', { ascending: true })
      .returns<MessageRow[]>(),
    supabase
      .from('permission_requests')
      .select('*')
      .eq('session_id', id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .returns<PermissionRequestRow[]>(),
  ])

  return (
    <ChatView
      ownerId={user.id}
      session={session}
      initialMessages={messages ?? []}
      initialPending={pending ?? []}
    />
  )
}
