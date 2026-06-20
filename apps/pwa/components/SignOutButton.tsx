export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-muted)] transition active:scale-95 hover:text-[var(--color-fg)]"
      >
        Sair
      </button>
    </form>
  )
}
