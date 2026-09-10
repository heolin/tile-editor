/**
 * The canvas draws in WebGL and cannot use CSS, but the palette must not be
 * written down twice: a second copy is a second thing to forget. These helpers
 * read the same custom properties the stylesheet defines and hand them to Pixi
 * as numbers.
 *
 * Values are cached after the first read. Call `forgetTheme()` if the tokens
 * ever change at runtime, which they do not today.
 */
const cache = new Map<string, number>()

function parse(value: string): number | undefined {
  const text = value.trim()
  if (text.startsWith('#')) {
    const hex = text.slice(1)
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex
    const parsed = Number.parseInt(full.slice(0, 6), 16)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  // Browsers may hand back a resolved rgb() instead of the authored hex.
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(text)
  if (!rgb) return undefined
  const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((n) => Math.round(Number(n)))
  return ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0)
}

/** One palette entry, by the name it has in the stylesheet without the prefix. */
export function themeColor(token: string, fallback: number): number {
  const cached = cache.get(token)
  if (cached !== undefined) return cached
  const raw =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue(`--color-${token}`)
  const value = parse(raw) ?? fallback
  cache.set(token, value)
  return value
}

export function forgetTheme(): void {
  cache.clear()
}

/**
 * Fallbacks matter only before the stylesheet has applied, and in tests that
 * render without a document. They mirror the tokens in styles.css.
 */
export const canvasTheme = {
  get ground(): number {
    return themeColor('ground', 0x19181a)
  },
  get accent(): number {
    return themeColor('accent', 0x78dce8)
  },
  get ink(): number {
    return themeColor('ink', 0xfcfcfa)
  },
  get shape(): number {
    return themeColor('shape', 0xab9df2)
  },
}
