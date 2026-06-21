'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { DaemonRow, DaemonStatus as DStatus } from '@/lib/database.types'
import { StatusDot } from './StatusDot'

// 3× o heartbeat do daemon (20s). Sem sinal por mais que isto => offline,
// mesmo que o campo `status` ainda diga 'online' (ex.: PC desligou de repente).
const STALE_MS = 60_000

function freshest(daemons: DaemonRow[]): { ts: number; status: DStatus } | null {
  let best: { ts: number; status: DStatus } | null = null
  for (const d of daemons) {
    const ts = d.last_seen_at ? Date.parse(d.last_seen_at) : 0
    if (!best || ts > best.ts) best = { ts, status: d.status }
  }
  return best
}

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 8) return 'ativo agora'
  if (s < 60) return `visto há ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `visto há ${m}min`
  return `visto há ${Math.floor(m / 60)}h`
}

/** Indicador de PC online/offline baseado na frescura do heartbeat + Realtime. */
export function DaemonStatus({ initial }: { initial: DaemonRow[] }) {
  const supabase = useMemo(() => createClient(), [])
  const [daemons, setDaemons] = useState<DaemonRow[]>(initial)
  const [now, setNow] = useState(() => Date.now())

  // tick para detectar quando o heartbeat PAROU (Realtime não avisa ausência)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  // Realtime: mantém os daemons atualizados (status + last_seen_at)
  useEffect(() => {
    const ch = supabase
      .channel('daemons-status')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'daemons' },
        (payload) => {
          setDaemons((prev) => {
            if (payload.eventType === 'DELETE') {
              const old = payload.old as Partial<DaemonRow>
              return prev.filter((d) => d.id !== old.id)
            }
            const row = payload.new as DaemonRow
            const idx = prev.findIndex((d) => d.id === row.id)
            if (idx === -1) return [...prev, row]
            const copy = prev.slice()
            copy[idx] = row
            return copy
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [supabase])

  const best = freshest(daemons)
  const online = best !== null && best.ts > 0 && now - best.ts <= STALE_MS
  const status: DStatus = !online ? 'offline' : best.status === 'working' ? 'working' : 'online'

  const detail =
    daemons.length === 0
      ? 'nenhum daemon'
      : !best || best.ts === 0
        ? 'aguardando daemon'
        : ago(best.ts, now)

  return (
    <div className="mt-0.5 flex items-center gap-2">
      <StatusDot status={status} />
      <span className="text-xs text-[var(--color-faint)]">· {detail}</span>
    </div>
  )
}
