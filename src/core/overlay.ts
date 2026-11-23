/**
 * Small, in-place edits to board overlay files (trackball and auto-mouse settings).
 * These files belong to the keyboard's hardware definition, so instead of reprinting them
 * we splice new values into the original text and leave everything else untouched.
 */
import { getProp, parseCells, parseDts, walkNodes, type DtsNode } from './dts.ts'

export interface OverlayFile { path: string; text: string }

function findLabelled(text: string, label: string): DtsNode | undefined {
  let found: DtsNode | undefined
  try {
    walkNodes(parseDts(text).items, (n) => { if (!found && (n.labels.includes(label) || n.name === '&' + label)) found = n })
  } catch {
    return undefined
  }
  return found
}

export function findOverlayProp(overlays: OverlayFile[], label: string, prop: string): { file: OverlayFile; cells: string[] } | undefined {
  for (const file of overlays) {
    const node = findLabelled(file.text, label)
    const p = node && getProp(node, prop)
    if (p) return { file, cells: parseCells(p.raw) }
  }
}

export function hasOverlayNode(overlays: OverlayFile[], label: string): boolean {
  return overlays.some((f) => !!findLabelled(f.text, label))
}

/** Replace a property's cells (or one cell of it). Adds the property when it is missing. */
export function setOverlayProp(overlays: OverlayFile[], label: string, prop: string, cells: string[] | undefined, cell?: number): OverlayFile[] {
  return overlays.map((file) => {
    const node = findLabelled(file.text, label)
    if (!node) return file
    const p = getProp(node, prop)
    if (p && p.valueSpan) {
      let next = cells
      if (cell !== undefined) {
        const cur = parseCells(p.raw)
        cur[cell] = cells?.[0] ?? cur[cell]
        next = cur
      }
      if (next === undefined || next.length === 0) {
        // Remove the whole line.
        const start = file.text.lastIndexOf('\n', p.span!.start) + 1
        const end = file.text.indexOf('\n', p.span!.end)
        return { ...file, text: file.text.slice(0, start) + file.text.slice(end + 1) }
      }
      const raw = `<${next.join(' ')}>`
      return { ...file, text: file.text.slice(0, p.valueSpan.start) + raw + file.text.slice(p.valueSpan.end) }
    }
    if (!cells || cells.length === 0 || cell !== undefined) return file
    // Insert before the node's closing brace, indented like its other properties.
    const close = file.text.lastIndexOf('}', node.span!.end)
    const sample = node.children.find((c) => c.kind === 'prop' && c.span)
    const indent = sample ? file.text.slice(file.text.lastIndexOf('\n', sample.span!.start) + 1, sample.span!.start) : '        '
    const lineStart = file.text.lastIndexOf('\n', close) + 1
    const insert = `${indent}${prop} = <${cells.join(' ')}>;\n`
    return { ...file, text: file.text.slice(0, lineStart) + insert + file.text.slice(lineStart) }
  })
}

/** Remap layer numbers used by the trackball and auto-mouse after layers move. */
export function remapOverlayLayers(overlays: OverlayFile[], map: (old: number) => number | undefined): OverlayFile[] {
  let out = overlays
  for (const [label, prop] of [['trackball', 'scroll-layers'], ['trackball', 'snipe-layers']] as const) {
    const hit = findOverlayProp(out, label, prop)
    if (!hit) continue
    const next = hit.cells.flatMap((c) => {
      if (!/^\d+$/.test(c)) return [c]
      const n = map(Number(c))
      return n === undefined ? [] : [String(n)]
    })
    if (next.join(' ') !== hit.cells.join(' ')) out = setOverlayProp(out, label, prop, next)
  }
  // Auto-mouse: input-processors = <&zip_auto_mouse LAYER TIMEOUT>
  for (const file of out) {
    let changed = file.text
    const listeners: DtsNode[] = []
    try {
      walkNodes(parseDts(file.text).items, (n) => { if (getProp(n, 'input-processors')) listeners.push(n) })
    } catch { continue }
    for (const l of listeners.reverse()) {
      const p = getProp(l, 'input-processors')!
      const cells = parseCells(p.raw)
      const i = cells.findIndex((c) => c === '&zip_auto_mouse' || c.includes('auto_mouse'))
      if (i < 0 || !/^\d+$/.test(cells[i + 1] ?? '')) continue
      const n = map(Number(cells[i + 1]))
      if (n === undefined || n === Number(cells[i + 1])) continue
      cells[i + 1] = String(n)
      changed = changed.slice(0, p.valueSpan!.start) + `<${cells.join(' ')}>` + changed.slice(p.valueSpan!.end)
    }
    if (changed !== file.text) out = out.map((f) => (f.path === file.path ? { ...f, text: changed } : f))
  }
  return out
}

export interface AutoMouse {
  layer?: number
  timeoutMs?: number
  excluded: number[]
  processorLabel: string
}

export function getAutoMouse(overlays: OverlayFile[]): AutoMouse | undefined {
  for (const file of overlays) {
    let am: AutoMouse | undefined
    try {
      const items = parseDts(file.text).items
      let label: string | undefined
      walkNodes(items, (n) => {
        if (/zmk,input-processor-temp-layer/.test(getProp(n, 'compatible')?.raw ?? '') && n.labels[0]) label = n.labels[0]
      })
      if (!label) continue
      walkNodes(items, (n) => {
        const p = getProp(n, 'input-processors')
        if (!p) return
        const cells = parseCells(p.raw)
        const i = cells.indexOf('&' + label)
        if (i >= 0) am = { processorLabel: label!, layer: Number(cells[i + 1]), timeoutMs: Number(cells[i + 2]), excluded: [] }
      })
      const ex = findOverlayProp([file], label, 'excluded-positions')
      if (am && ex) am.excluded = ex.cells.map(Number)
      else if (!am) am = { processorLabel: label, excluded: ex?.cells.map(Number) ?? [] }
    } catch { continue }
    if (am) return am
  }
}
