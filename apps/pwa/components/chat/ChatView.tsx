'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type {
  MessageRow,
  PermissionRequestRow,
  SessionRow,
} from '@/lib/database.types'
import {
  isResultEvent,
  isStreamTurnEnd,
  isSystemInit,
  streamTextDelta,
  systemInitInfo,
  type SystemInitInfo,
} from '@/lib/oc-events'
import { BROADCAST_STREAM_EVENT } from '@ati/protocol'
import { MessageItem } from './MessageItem'
import { PermissionCard, type PermissionDecision } from './PermissionCard'
import { Composer } from './Composer'

type AnyPayload = Record<string, unknown>

export function ChatView({
  ownerId,
  session,
  initialMessages,
  initialPending,
}: {
  ownerId: string
  session: SessionRow
  initialMessages: MessageRow[]
  initialPending: PermissionRequestRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const sessionId = session.id

  const [messages, setMessages] = useState<MessageRow[]>(initialMessages)
  const [pending, setPending] = useState<PermissionRequestRow[]>(initialPending)
  const [liveText, setLiveText] = useState('')
  const [working, setWorking] = useState(false)

  const seenMessageIds = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)))
  const scrollRef = useRef<HTMLDivElement>(null)

  // ---- header info (model/cwd) do último system init ----
  const initInfo: SystemInitInfo | null = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m && m.kind === 'event' && isSystemInit(m.payload)) {
        return systemInitInfo(m.payload)
      }
    }
    return null
  }, [messages])

  // ---- derivar "working" a partir do fluxo durável ----
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last) {
      setWorking(false)
      return
    }
    if (last.kind === 'user_turn') {
      setWorking(true)
    } else if (last.kind === 'event' && isResultEvent(last.payload)) {
      setWorking(false)
    }
  }, [messages])

  // ---- autoscroll para o fim quando chega conteúdo novo ----
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, pending, liveText, scrollToBottom])

  // ---- realtime: postgres_changes em messages + permission_requests ----
  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`db:session:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as MessageRow
          if (seenMessageIds.current.has(row.id)) return
          seenMessageIds.current.add(row.id)
          setMessages((prev) => [...prev, row])
          // chegou conteúdo durável do daemon -> limpa o buffer ao vivo
          if (row.source === 'daemon') setLiveText('')
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'permission_requests',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as PermissionRequestRow
          setPending((prev) => {
            const others = prev.filter((p) => p.id !== row.id)
            return row.status === 'pending' ? [...others, row] : others
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, sessionId])

  // ---- realtime: broadcast (stream ao vivo, cosmético) ----
  useEffect(() => {
    const channel = supabase.channel(sessionId, { config: { private: true } })
    channel
      .on('broadcast', { event: BROADCAST_STREAM_EVENT }, (msg) => {
        const payload = msg.payload as AnyPayload
        if (isStreamTurnEnd(payload)) {
          setLiveText('')
          return
        }
        const delta = streamTextDelta(payload)
        if (delta) {
          setWorking(true)
          setLiveText((prev) => prev + delta)
        }
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, sessionId])

  // ---- ações ----
  const sendPrompt = useCallback(
    async (text: string) => {
      setWorking(true)
      const { error } = await supabase.from('messages').insert({
        session_id: sessionId,
        owner_id: ownerId,
        source: 'phone',
        kind: 'user_turn',
        payload: { content: text },
      })
      if (error) {
        setWorking(false)
        console.error('Falha ao enviar prompt:', error.message)
        throw error
      }
    },
    [supabase, sessionId, ownerId],
  )

  const interrupt = useCallback(async () => {
    const { error } = await supabase.from('messages').insert({
      session_id: sessionId,
      owner_id: ownerId,
      source: 'phone',
      kind: 'interrupt',
      payload: {},
    })
    if (error) {
      console.error('Falha ao interromper:', error.message)
      return
    }
    setWorking(false)
  }, [supabase, sessionId, ownerId])

  const decide = useCallback(
    async (req: PermissionRequestRow, decision: PermissionDecision) => {
      // 1) responde no barramento de mensagens (o daemon reage a isto)
      const { error: msgErr } = await supabase.from('messages').insert({
        session_id: sessionId,
        owner_id: ownerId,
        source: 'phone',
        kind: 'permission_res',
        payload: {
          request_id: req.request_id,
          behavior: decision.behavior,
          ...(decision.message ? { message: decision.message } : {}),
          updatedInput: req.input,
        },
      })
      if (msgErr) {
        console.error('Falha ao responder permissão:', msgErr.message)
        throw msgErr
      }

      // 2) atualiza a linha de permission_requests (estado durável da UI)
      const { error: updErr } = await supabase
        .from('permission_requests')
        .update({
          status: decision.behavior === 'allow' ? 'allowed' : 'denied',
          decision_message: decision.message ?? null,
          decided_at: new Date().toISOString(),
        })
        .eq('id', req.id)
      if (updErr) console.error('Falha ao atualizar permission_request:', updErr.message)

      // otimista: some o card mesmo antes do realtime confirmar
      setPending((prev) => prev.filter((p) => p.id !== req.id))
    },
    [supabase, sessionId, ownerId],
  )

  const closed = session.status === 'closed'

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 px-3 py-2.5 backdrop-blur">
        <Link
          href="/"
          aria-label="Voltar"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--color-muted)] transition active:bg-[var(--color-surface)]"
        >
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {session.title?.trim() || 'Sessão'}
          </h1>
          <p className="truncate font-mono text-[11px] text-[var(--color-muted)]">
            {initInfo?.model ? `${initInfo.model} · ` : ''}
            {initInfo?.cwd || session.project_path || 'sem cwd'}
          </p>
        </div>
      </header>

      {/* Feed */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages.length === 0 && pending.length === 0 && (
          <div className="px-2 py-12 text-center text-sm text-[var(--color-muted)]">
            Envie uma mensagem para começar.
          </div>
        )}

        {messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}

        {/* stream ao vivo (cosmético) */}
        {liveText && (
          <div className="flex justify-start">
            <div className="ati-caret max-w-[92%] whitespace-pre-wrap break-anywhere rounded-2xl rounded-bl-md bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-fg)]">
              {liveText}
            </div>
          </div>
        )}

        {/* cards de permissão pendentes */}
        {pending.map((req) => (
          <PermissionCard key={req.id} request={req} onDecide={decide} />
        ))}
      </div>

      {/* Composer */}
      <Composer
        onSend={sendPrompt}
        onInterrupt={interrupt}
        working={working}
        disabled={closed}
      />
    </div>
  )
}
