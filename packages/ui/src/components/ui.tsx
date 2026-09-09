import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * The handful of primitives the editor needs, owned in-repo in the shadcn
 * spirit so touch targets and density can follow the pointer type rather than
 * whatever a component library decided (docs/PLAN.md section 3).
 */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'ghost' | 'solid' | 'outline' | 'danger'
  active?: boolean
  size?: 'sm' | 'md'
}

export function Button({ variant = 'ghost', active, size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'hit inline-flex items-center justify-center gap-2 rounded-md font-medium',
        'transition-colors select-none disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'px-2 text-[12px]' : 'px-3 text-[13px]',
        variant === 'ghost' && 'text-ink-dim hover:bg-hover hover:text-ink',
        variant === 'outline' && 'border border-line text-ink-dim hover:bg-hover hover:text-ink',
        variant === 'solid' && 'bg-accent text-ground hover:brightness-110',
        variant === 'danger' && 'text-danger hover:bg-danger-deep',
        active && variant !== 'solid' && 'bg-accent-deep text-accent-ink',
        className,
      )}
      {...rest}
    />
  )
}

export function Panel({ title, children, actions, className }: {
  title: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <section className={clsx('flex min-h-0 flex-col bg-surface', className)}>
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 className="panel-title">{title}</h2>
        {actions}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-[12px] text-ink-faint">{children}</p>
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 px-3 py-1.5">
      <span className="text-[11px] font-medium tracking-wide text-ink-faint">{label}</span>
      {children}
      {hint ? <span className="text-[10.5px] text-ink-faint">{hint}</span> : null}
    </label>
  )
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'hit w-full rounded-md border border-line bg-ground px-2 text-[13px] text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    />
  )
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        'hit w-full rounded-md border border-line bg-ground px-2 text-[13px] text-ink focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
}

/**
 * A drawer that comes up from the bottom on compact and medium widths. This is
 * where every panel lives on a phone, and where the tablet in portrait reaches
 * for anything not on screen.
 */
export function Sheet({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
      <button
        type="button"
        aria-label="Zamknij"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[70vh] min-h-[220px] flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <div className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" />
          <h2 className="panel-title pt-2">{title}</h2>
          <Button size="sm" onClick={onClose} className="pt-2">
            Zamknij
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  )
}

export function Toast({ text, tone }: { text: string; tone: 'ok' | 'error' }) {
  return (
    <div
      className={clsx(
        'pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md px-3 py-2 text-[13px] shadow-lg lg:bottom-8',
        tone === 'ok' ? 'bg-accent-deep text-accent-ink' : 'bg-danger-deep text-danger',
      )}
      role="status"
    >
      {text}
    </div>
  )
}

/** A centred modal. Used sparingly: only for actions that create a file. */
export function Dialog({ open, onClose, title, children, footer }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-6">
      <button type="button" aria-label="Zamknij" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface shadow-2xl md:rounded-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto py-2">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer> : null}
      </div>
    </div>
  )
}
