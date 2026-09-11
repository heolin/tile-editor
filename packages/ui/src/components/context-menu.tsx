import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  hint?: string
}

/**
 * The canvas has no right-click on a tablet, so a long press opens this instead.
 * It is positioned at the touch point and flips when it would leave the screen.
 */
export function ContextMenu({ x, y, items, onClose }: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const overflowX = Math.max(0, rect.right - window.innerWidth + 8)
    const overflowY = Math.max(0, rect.bottom - window.innerHeight + 8)
    if (overflowX > 0) node.style.left = `${x - overflowX}px`
    if (overflowY > 0) node.style.top = `${y - rect.height}px`
  }, [x, y])

  useEffect(() => {
    // Any interaction outside dismisses it, including a scroll or a key. The
    // listener captures from the window, so a press on the menu itself reaches
    // it before React sees the click - without this guard the menu would
    // unmount first and no item would ever run.
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && ref.current?.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('pointerdown', close, { capture: true })
    window.addEventListener('keydown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true })
      window.removeEventListener('keydown', close)
      window.removeEventListener('blur', close)
    }
  }, [onClose])

  if (items.length === 0) return null

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[170px] overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-2xl"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          className={[
            'hit flex w-full items-center justify-between gap-3 px-3 text-left text-[13px]',
            item.danger ? 'text-danger hover:bg-danger-deep' : 'text-ink-dim hover:bg-hover hover:text-ink',
          ].join(' ')}
          // The menu renders inside the canvas, so a press that bubbles would
          // also land as a tool stroke on the map underneath.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
        >
          <span>{item.label}</span>
          {item.hint ? <span className="num text-[11px] text-ink-faint">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function MenuHost({ children }: { children: ReactNode }) {
  return <>{children}</>
}
