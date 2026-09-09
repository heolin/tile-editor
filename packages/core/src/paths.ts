/**
 * Project-relative POSIX path helpers. Everything inside a project is
 * addressed by a forward-slash path relative to the project root, whatever
 * the host filesystem looks like.
 */
export function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

export function dirname(path: string): string {
  const norm = normalizePath(path)
  const idx = norm.lastIndexOf('/')
  return idx < 0 ? '' : norm.slice(0, idx)
}

export function basename(path: string): string {
  const norm = normalizePath(path)
  const idx = norm.lastIndexOf('/')
  return idx < 0 ? norm : norm.slice(idx + 1)
}

export function extname(path: string): string {
  const base = basename(path)
  const idx = base.lastIndexOf('.')
  return idx <= 0 ? '' : base.slice(idx)
}

/** Resolves `relative` against the directory holding `fromFile`. */
export function resolveFrom(fromFile: string, relative: string): string {
  if (relative.startsWith('/')) return normalizePath(relative)
  return normalizePath(dirname(fromFile) + '/' + relative)
}

/** Produces the relative path that gets you from `fromFile`'s folder to `target`. */
export function relativeFrom(fromFile: string, target: string): string {
  const from = dirname(fromFile).split('/').filter(Boolean)
  const to = normalizePath(target).split('/').filter(Boolean)
  let i = 0
  while (i < from.length && i < to.length && from[i] === to[i]) i++
  const up = new Array(from.length - i).fill('..')
  return [...up, ...to.slice(i)].join('/') || '.'
}
