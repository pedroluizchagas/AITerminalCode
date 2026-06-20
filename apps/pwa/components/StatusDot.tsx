import type { DaemonStatus } from '@/lib/database.types'

const LABEL: Record<DaemonStatus, string> = {
  online: 'Online',
  working: 'Trabalhando',
  offline: 'Offline',
}

const DOT: Record<DaemonStatus, string> = {
  online: 'bg-[var(--color-success)]',
  working: 'bg-[var(--color-accent)] animate-pulse',
  offline: 'bg-[var(--color-faint)]',
}

export function StatusDot({
  status,
  showLabel = true,
}: {
  status: DaemonStatus
  showLabel?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
      <span className={`size-2 rounded-full ${DOT[status]}`} aria-hidden />
      {showLabel && <span>{LABEL[status]}</span>}
    </span>
  )
}
