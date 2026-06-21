import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TerminalView } from '@/components/TerminalView'
import type { DaemonRow } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Terminal — AITerminalControl',
}

export default async function TerminalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: daemons } = await supabase
    .from('daemons')
    .select('*')
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .returns<DaemonRow[]>()

  return <TerminalView ownerId={user.id} daemons={daemons ?? []} />
}
