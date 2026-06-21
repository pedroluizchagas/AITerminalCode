'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { SessionRow } from '@/lib/database.types'

type SessionLite = Pick<SessionRow, 'id' | 'title' | 'status'>

/** Menu "⋯" por sessão: renomear, encerrar/reabrir, excluir. */
export function SessionActions({
  session,
  redirectOnDelete = false,
}: {
  session: SessionLite
  redirectOnDelete?: boolean
}) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function rename() {
    setOpen(false)
    const t = window.prompt('Renomear sessão', session.title ?? '')
    if (t === null) return
    setBusy(true)
    await supabase
      .from('sessions')
      .update({ title: t.trim() || null })
      .eq('id', session.id)
    setBusy(false)
    router.refresh()
  }

  async function toggleClose() {
    setOpen(false)
    const next = session.status === 'closed' ? 'active' : 'closed'
    setBusy(true)
    await supabase.from('sessions').update({ status: next }).eq('id', session.id)
    setBusy(false)
    router.refresh()
  }

  async function remove() {
    setOpen(false)
    if (!window.confirm('Excluir esta sessão e todo o histórico? Não dá pra desfazer.')) return
    setBusy(true)
    const { error } = await supabase.from('sessions').delete().eq('id', session.id)
    setBusy(false)
    if (error) {
      window.alert('Falha ao excluir: ' + error.message)
      return
    }
    if (redirectOnDelete) router.push('/')
    else router.refresh()
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Ações da sessão"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="grid size-9 place-items-center rounded-lg text-[var(--color-faint)] transition active:bg-[var(--color-surface-2)] disabled:opacity-50"
      >
        <span className="text-lg leading-none">⋯</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={(e) => {
              e.preventDefault()
              setOpen(false)
            }}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute right-1 top-9 z-30 w-40 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 shadow-xl">
            <MenuItem onClick={rename}>Renomear</MenuItem>
            <MenuItem onClick={toggleClose}>
              {session.status === 'closed' ? 'Reabrir' : 'Encerrar'}
            </MenuItem>
            <MenuItem onClick={remove} danger>
              Excluir
            </MenuItem>
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void onClick()
      }}
      className={`block w-full px-4 py-2.5 text-left text-sm transition active:bg-[var(--color-surface)] ${
        danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-fg)]'
      }`}
    >
      {children}
    </button>
  )
}
