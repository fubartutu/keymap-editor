import type { GridPos } from './keymap.ts'

/** A key's position for drawing, in key units (1u = one key width). */
export interface PhysicalKey {
  x: number
  y: number
  w: number
  h: number
  /** Rotation in degrees around (rx, ry). */
  r: number
  rx: number
  ry: number
}

export interface Layout {
  name: string
  keys: PhysicalKey[]
  /** Row/column of each key in the .keymap text (for aligned formatting). */
  grid: GridPos[]
  /** Which half each key is on (for "opposite hand" hold-trigger positions). */
  hands: ('L' | 'R')[]
  /** Thumb-cluster keys. */
  thumbs: number[]
  /** Optional decorations (the trackball) drawn with the keys. */
  decorations?: { kind: 'trackball'; x: number; y: number; d: number }[]
}

/**
 * Parse ZMK physical layout attributes from a shield .dtsi:
 *   <&key_physical_attrs w h x y rot rx ry>   (100 = 1u, rotation in 1/100 °)
 */
export function layoutFromDtsi(text: string, name = 'default'): Layout | undefined {
  const re = /&key_physical_attrs\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+\(?(-?\d+)\)?\s+(-?\d+)\s+(-?\d+)/g
  const keys: PhysicalKey[] = []
  for (const m of text.matchAll(re)) {
    const [w, h, x, y, r, rx, ry] = m.slice(1).map(Number)
    keys.push({ w: w / 100, h: h / 100, x: x / 100, y: y / 100, r: r / 100, rx: rx / 100, ry: ry / 100 })
  }
  if (!keys.length) return undefined
  return fromKeys(name, keys)
}

function fromKeys(name: string, keys: PhysicalKey[]): Layout {
  const grid = keys.map((k) => ({ row: Math.round(k.y), col: Math.round(k.x) }))
  const mid = (Math.min(...keys.map((k) => k.x)) + Math.max(...keys.map((k) => k.x + k.w))) / 2
  const hands = keys.map((k) => (k.x + k.w / 2 < mid ? 'L' : 'R') as 'L' | 'R')
  const maxRow = Math.max(...grid.map((g) => g.row))
  const thumbs = grid.map((g, i) => (g.row === maxRow || g.row === maxRow - 1) && grid.filter((o) => o.row === g.row).length < 8 ? i : -1).filter((i) => i >= 0)
  return { name, keys, grid, hands, thumbs }
}

/** QMK/keymap-editor style info.json: { layouts: { NAME: { layout: [{x, y, w?, h?, r?, rx?, ry?, row?, col?}] } } } */
export function layoutFromInfoJson(json: unknown): Layout | undefined {
  const j = json as { layouts?: Record<string, { layout: Record<string, number>[] }> }
  const first = j?.layouts && Object.entries(j.layouts)[0]
  if (!first) return undefined
  const [name, { layout }] = first
  const keys = layout.map((k) => ({ x: k.x, y: k.y, w: k.w ?? 1, h: k.h ?? 1, r: k.r ?? 0, rx: k.rx ?? 0, ry: k.ry ?? 0 }))
  const l = fromKeys(name, keys)
  if (layout.every((k) => k.row !== undefined && k.col !== undefined)) l.grid = layout.map((k) => ({ row: k.row, col: k.col }))
  return l
}

/** Editor layout file (keyboards/*.json), which can also override grid/hands/thumbs. */
export interface LayoutFile {
  name: string
  keys: (Partial<PhysicalKey> & { x: number; y: number })[]
  grid?: GridPos[]
  hands?: ('L' | 'R')[]
  thumbs?: number[]
  decorations?: Layout['decorations']
}

export function layoutFromFile(f: LayoutFile): Layout {
  const keys = f.keys.map((k) => ({ w: 1, h: 1, r: 0, rx: k.x, ry: k.y, ...k }))
  const base = fromKeys(f.name, keys)
  return { ...base, grid: f.grid ?? base.grid, hands: f.hands ?? base.hands, thumbs: f.thumbs ?? base.thumbs, decorations: f.decorations }
}

/** A fallback grid layout when nothing better is known. */
export function gridLayout(count: number, perRow = 12): Layout {
  const keys = Array.from({ length: count }, (_, i) => ({ x: (i % perRow) + (i % perRow >= perRow / 2 ? 1 : 0), y: Math.floor(i / perRow), w: 1, h: 1, r: 0, rx: 0, ry: 0 }))
  return fromKeys('grid', keys)
}

/** Bounding box of a layout including rotation, in key units. */
export function layoutBounds(layout: Layout): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const k of layout.keys) {
    const rad = (k.r * Math.PI) / 180
    for (const [cx, cy] of [[k.x, k.y], [k.x + k.w, k.y], [k.x, k.y + k.h], [k.x + k.w, k.y + k.h]]) {
      const dx = cx - k.rx
      const dy = cy - k.ry
      const x = k.rx + dx * Math.cos(rad) - dy * Math.sin(rad)
      const y = k.ry + dx * Math.sin(rad) + dy * Math.cos(rad)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
  }
  for (const d of layout.decorations ?? []) {
    minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x + d.d); minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y + d.d)
  }
  return { minX, minY, maxX, maxY }
}
