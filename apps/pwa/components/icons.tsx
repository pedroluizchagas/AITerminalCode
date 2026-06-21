/**
 * Sistema de ícones — linha geométrica, traço 1.75, currentColor.
 * Precisos como um terminal (não emoji). viewBox 24, 20px por padrão.
 */
import type { SVGProps } from 'react'

type IconProps = { size?: number } & SVGProps<SVGSVGElement>

function Line({ size = 20, strokeWidth = 1.75, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconTerminal(p: IconProps) {
  return (
    <Line {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7 9l3 3-3 3" />
      <path d="M12.5 15H17" />
    </Line>
  )
}

export function IconBell(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Line>
  )
}

export function IconSend(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </Line>
  )
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M14.5 6l-6 6 6 6" />
    </Line>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Line>
  )
}

export function IconHost(p: IconProps) {
  // monitor = máquina; o chevron interno amarra ao motivo de terminal
  return (
    <Line {...p}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 20.5h8" />
      <path d="M12 17v3.5" />
    </Line>
  )
}

export function IconPencil(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0-2.83-2.83L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </Line>
  )
}

export function IconPower(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M12 4v8" />
      <path d="M7.6 7.2a7 7 0 1 0 8.8 0" />
    </Line>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <Line {...p}>
      <path d="M4 7h16" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18.5 7" />
    </Line>
  )
}

export function IconLock(p: IconProps) {
  return (
    <Line {...p}>
      <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Line>
  )
}

export function IconStop(p: IconProps) {
  return (
    <Line {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2.2" />
    </Line>
  )
}

export function IconClipboard(p: IconProps) {
  return (
    <Line {...p}>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4V3.4A1.4 1.4 0 0 1 10.4 2h3.2A1.4 1.4 0 0 1 15 3.4V4" />
    </Line>
  )
}

/** Reticências verticais (menu de item) — pontos preenchidos. */
export function IconEllipsis({ size = 20, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}
