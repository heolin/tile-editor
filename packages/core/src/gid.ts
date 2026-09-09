/**
 * Global Tile IDs carry transform flags in their high bits. Identical in the
 * XML and JSON formats, so this lives outside the codecs.
 */
export const FLIP_H = 0x80000000
export const FLIP_V = 0x40000000
export const FLIP_D = 0x20000000
/** Hexagonal 120-degree rotation. Unused by the corpus but part of the spec. */
export const ROT_HEX_120 = 0x10000000
export const FLAG_MASK = FLIP_H | FLIP_V | FLIP_D | ROT_HEX_120
export const ID_MASK = ~FLAG_MASK >>> 0

export interface GidParts {
  id: number
  flipH: boolean
  flipV: boolean
  flipD: boolean
  rotHex120: boolean
}

export function parseGid(gid: number): GidParts {
  const g = gid >>> 0
  return {
    id: g & ID_MASK,
    flipH: (g & FLIP_H) !== 0,
    flipV: (g & FLIP_V) !== 0,
    flipD: (g & FLIP_D) !== 0,
    rotHex120: (g & ROT_HEX_120) !== 0,
  }
}

export function makeGid(p: GidParts): number {
  let g = p.id >>> 0
  if (p.flipH) g |= FLIP_H
  if (p.flipV) g |= FLIP_V
  if (p.flipD) g |= FLIP_D
  if (p.rotHex120) g |= ROT_HEX_120
  return g >>> 0
}

export const tileId = (gid: number) => (gid >>> 0) & ID_MASK
export const gidFlags = (gid: number) => (gid >>> 0) & FLAG_MASK
