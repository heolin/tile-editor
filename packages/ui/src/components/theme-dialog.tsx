import clsx from 'clsx'
import { Check, Moon, Sun } from 'lucide-react'
import { Dialog } from './ui'
import { THEMES, type ThemeOption } from '../theme'
import { useEditor } from '../state/store'

/**
 * The swatches carry no colours of their own: each preview element sets
 * `data-theme` and the stylesheet paints it. Adding a theme means adding one
 * block to styles.css and one entry to THEMES, and nothing else.
 */
function Swatch({ theme }: { theme: ThemeOption }) {
  return (
    <div
      data-theme={theme.id}
      aria-hidden
      className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-ground p-1.5"
    >
      <span className="h-5 w-5 rounded-sm bg-surface" />
      <span className="h-5 w-5 rounded-sm bg-accent" />
      <span className="h-5 w-3 rounded-sm bg-danger" />
      <span className="h-5 w-3 rounded-sm bg-warn" />
      <span className="h-5 w-3 rounded-sm bg-ok" />
    </div>
  )
}

export function ThemeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useEditor((s) => s.theme)
  const setTheme = useEditor((s) => s.setTheme)

  return (
    <Dialog open={open} onClose={onClose} title="Motyw">
      <ul className="flex flex-col p-2">
        {THEMES.map((theme) => (
          <li key={theme.id}>
            <button
              type="button"
              aria-pressed={current === theme.id}
              onClick={() => setTheme(theme.id)}
              className={clsx(
                'hit flex w-full items-center gap-3 rounded-lg px-2 text-left',
                current === theme.id ? 'bg-accent-deep' : 'hover:bg-hover',
              )}
            >
              <Swatch theme={theme} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] text-ink">
                  {theme.label}
                  {theme.kind === 'light' ? (
                    <Sun size={12} className="text-ink-faint" />
                  ) : (
                    <Moon size={12} className="text-ink-faint" />
                  )}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">{theme.note}</span>
              </span>
              {current === theme.id ? <Check size={16} className="shrink-0 text-accent" /> : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="px-4 pb-3 text-[11px] leading-relaxed text-ink-faint">
        Wybór zapamiętuje się w przeglądarce. Płótno czyta te same kolory co panele, więc
        zmienia się razem z nimi.
      </p>
    </Dialog>
  )
}
