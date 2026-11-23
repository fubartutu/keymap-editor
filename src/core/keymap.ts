import {
  getProp, getRaw, nodes, parseCells, parseString, quote, setProp, splitCellGroups, tokenizeCells, walkNodes,
  type DtsDirective, type DtsFile, type DtsItem, type DtsNode,
} from './dts.ts'
import { buildRegistry, type BehaviorRegistry, type ParamType } from './behaviors.ts'

export interface Binding {
  /** Behaviour label without `&`. */
  behavior: string
  /** Raw parameter tokens, e.g. `LC(Z)`, `SYM`, `0`. */
  params: string[]
}

export const TRANS: Binding = { behavior: 'trans', params: [] }
export const NONE: Binding = { behavior: 'none', params: [] }

export function bindingEquals(a: Binding, b: Binding): boolean {
  return a.behavior === b.behavior && a.params.length === b.params.length && a.params.every((p, i) => p === b.params[i])
}

/** Split a flat cell token list into bindings (each starts at an `&label` token). */
export function tokensToBindings(tokens: string[]): Binding[] {
  const out: Binding[] = []
  for (const t of tokens) {
    if (t.startsWith('&')) out.push({ behavior: t.slice(1), params: [] })
    else if (out.length) out[out.length - 1].params.push(t)
  }
  return out
}

/** Parse a `bindings` property value. `<&kp A &kp B>` and `<&kp A>, <&kp B>` both work. */
export function parseBindings(raw: string | null | undefined): Binding[] {
  if (raw == null) return []
  return tokensToBindings(splitCellGroups(raw).flatMap(tokenizeCells))
}

export function formatBinding(b: Binding): string {
  return ['&' + b.behavior, ...b.params].join(' ')
}

/** `<&a>, <&b>` style, used for hold-tap / tap-dance / mod-morph / macro bindings. */
export function formatBindingGroups(bs: Binding[]): string {
  return bs.map((b) => `<${formatBinding(b)}>`).join(', ')
}

// ---------------------------------------------------------------------------
// Grid formatting of layer bindings

export interface GridPos { row: number; col: number }

/**
 * Format layer bindings as an aligned grid, one physical row per line. Columns are
 * padded to the widest binding in that column across `allLayers`, so every layer in
 * the file lines up the same way.
 */
export function formatLayerBindings(bindings: Binding[], grid: GridPos[] | undefined, indent: string, _allLayers?: Binding[][]): string {
  // Style of hand-written ZMK keymaps: every cell padded to the widest binding in the layer,
  // an extra gap between the halves, closing ">" aligned with the rows.
  const strs = bindings.map(formatBinding)
  if (!grid || grid.length < bindings.length) return `<\n${indent}${strs.join(' ')}\n${indent}>`
  const width = Math.max(...strs.map((x) => x.length))
  const maxCol = Math.max(...grid.map((g) => g.col))
  const used = new Set(grid.map((g) => g.col))
  const rows = new Map<number, Map<number, string>>()
  strs.forEach((x, i) => {
    const g = grid[i]
    if (!rows.has(g.row)) rows.set(g.row, new Map())
    rows.get(g.row)!.set(g.col, x)
  })
  const lines: string[] = []
  for (const row of [...rows.keys()].sort((x, y) => x - y)) {
    const cells = rows.get(row)!
    let line = ''
    for (let c = 0; c <= maxCol; c++) {
      if (!used.has(c)) { line += '   '; continue }
      line += (cells.get(c) ?? '').padEnd(width) + ' '
    }
    lines.push(indent + line.trimEnd())
  }
  return `<\n${lines.join('\n')}\n${indent}>`
}

// ---------------------------------------------------------------------------
// Finding things in the tree

export function rootNodes(file: DtsFile): DtsNode[] {
  return nodes(file.items).filter((n) => n.name === '/')
}

export function findByCompatible(file: DtsFile, compatible: string): DtsNode[] {
  const out: DtsNode[] = []
  walkNodes(file.items, (n) => { if (parseString(getRaw(n, 'compatible')) === compatible) out.push(n) })
  return out
}

export function findByLabel(file: DtsFile, label: string): DtsNode | undefined {
  let found: DtsNode | undefined
  walkNodes(file.items, (n) => { if (!found && n.labels.includes(label)) found = n })
  return found
}

export function keymapNode(file: DtsFile): DtsNode | undefined {
  return findByCompatible(file, 'zmk,keymap')[0]
}

/** Get (or create under the first `/ {}`) a container node such as `behaviors`, `macros` or `combos`. */
export function ensureContainer(file: DtsFile, name: string, compatible?: string): DtsNode {
  for (const root of rootNodes(file)) {
    const existing = nodes(root.children).find((n) => n.name === name)
    if (existing) return existing
  }
  if (compatible) {
    const byCompat = findByCompatible(file, compatible)[0]
    if (byCompat) return byCompat
  }
  let root = rootNodes(file)[0]
  if (!root) {
    root = { kind: 'node', labels: [], name: '/', children: [], leading: [''], tail: [] }
    file.items.push(root)
  }
  const node: DtsNode = { kind: 'node', labels: [], name, children: [], leading: [''], tail: [] }
  if (compatible) setProp(node, 'compatible', quote(compatible))
  // Keep the keymap node last, like hand-written keymaps.
  const km = root.children.findIndex((c) => c.kind === 'node' && parseString(getRaw(c, 'compatible')) === 'zmk,keymap')
  if (km >= 0) root.children.splice(km, 0, node)
  else root.children.push(node)
  return node
}

// ---------------------------------------------------------------------------
// Layers

export interface LayerInfo {
  index: number
  /** DT node name, e.g. `layer_base`. Stable identifier. */
  id: string
  /** `display-name`, or the node name. */
  name: string
  bindings: Binding[]
  node: DtsNode
}

export function getLayers(file: DtsFile): LayerInfo[] {
  const km = keymapNode(file)
  if (!km) return []
  return nodes(km.children).map((node, index) => ({
    index,
    id: node.name,
    name: parseString(getRaw(node, 'display-name')) ?? node.name.replace(/^layer_/, ''),
    bindings: parseBindings(getRaw(node, 'bindings')),
    node,
  }))
}

// ---------------------------------------------------------------------------
// #define handling: layer index defines (`#define SYM 1`) and simple value defines.

export interface Define { name: string; value: string; item: DtsDirective }

export function getDefines(file: DtsFile): Define[] {
  const out: Define[] = []
  for (const item of file.items) {
    if (item.kind !== 'directive') continue
    const m = item.text.match(/^#\s*define\s+([A-Za-z_]\w*)(?!\()\s*(.*)$/s)
    if (m) out.push({ name: m[1], value: m[2].replace(/\\\n/g, ' ').trim(), item })
  }
  return out
}

/**
 * Defines that name layers: integer-valued `#define`s whose values are exactly 0..n-1 for the
 * n layers of the keymap (or a prefix of that when layers were added since).
 */
export function layerDefines(file: DtsFile): Map<string, number> {
  const count = getLayers(file).length
  const ints = getDefines(file).filter((d) => /^\d+$/.test(d.value) && Number(d.value) < count)
  const byValue = new Map<number, string>()
  for (const d of ints) if (!byValue.has(Number(d.value))) byValue.set(Number(d.value), d.name)
  // Require a contiguous run from 0 so unrelated small constants aren't mistaken for layers.
  const out = new Map<string, number>()
  for (let i = 0; i < count && byValue.has(i); i++) out.set(byValue.get(i)!, i)
  return out.size >= 2 ? out : new Map()
}

export function resolveLayer(param: string, defines: Map<string, number>): number | undefined {
  if (/^\d+$/.test(param)) return Number(param)
  return defines.get(param)
}

/** The token to use when referencing a layer: its define name if there is one, else the number. */
export function layerToken(index: number, defines: Map<string, number>): string {
  for (const [name, i] of defines) if (i === index) return name
  return String(index)
}

function setDefineValue(file: DtsFile, name: string, value: string) {
  for (const item of file.items) {
    if (item.kind !== 'directive') continue
    const m = item.text.match(/^(#\s*define\s+)([A-Za-z_]\w*)(\s+)(.*)$/s)
    if (m && m[2] === name) item.text = `${m[1]}${m[2]}${m[3]}${value}`
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'layer'
}

// ---------------------------------------------------------------------------
// Visiting every binding in the file (for layer remapping and usage queries)

export interface BindingSite {
  binding: Binding
  /** Write the (possibly modified) bindings back. */
  commit: () => void
  where: { kind: 'layer' | 'combo' | 'behavior' | 'conditional'; node: DtsNode; index: number }
}

function bindingProps(node: DtsNode): string[] {
  const compatible = parseString(getRaw(node, 'compatible'))
  if (compatible === 'zmk,keymap') return []
  return ['bindings', 'sensor-bindings']
}

/** Calls `fn` for every binding in layers, combos and behaviour nodes. */
export function forEachBinding(file: DtsFile, fn: (b: Binding, where: BindingSite['where']) => Binding | void, grid?: GridPos[]) {
  const km = keymapNode(file)
  walkNodes(file.items, (node, parents) => {
    const isLayer = km != null && parents[parents.length - 1] === km
    const parentCompat = parents.length ? parseString(getRaw(parents[parents.length - 1], 'compatible')) : undefined
    const kind = isLayer ? 'layer' : parentCompat === 'zmk,combos' ? 'combo' : 'behavior'
    for (const propName of bindingProps(node)) {
      const prop = getProp(node, propName)
      if (!prop || prop.raw == null) continue
      // Hold-tap `bindings` are behaviour references without parameters; skip them.
      if (parseString(getRaw(node, 'compatible')) === 'zmk,behavior-hold-tap') continue
      const grouped = /^\s*<[^<>]*>\s*,/.test(prop.raw) || kind === 'behavior'
      const list = parseBindings(prop.raw)
      let changed = false
      const next = list.map((b, i) => {
        const r = fn(b, { kind, node, index: i })
        if (r && r !== b) { changed = true; return r }
        return b
      })
      if (changed) {
        if (kind === 'layer' && propName === 'bindings') prop.raw = formatLayerBindings(next, grid, '            ')
        else if (grouped && kind === 'behavior') prop.raw = formatBindingGroups(next)
        else prop.raw = `<${next.map(formatBinding).join(' ')}>`
        delete prop.valueSpan
      }
    }
  })
}

/** Which parameters of a binding refer to layers. */
export function layerParamIndexes(b: Binding, reg: BehaviorRegistry): number[] {
  const def = reg.get(b.behavior)
  if (!def) return []
  return def.params.map((p, i) => (p.type === 'layer' ? i : -1)).filter((i) => i >= 0)
}

export function paramTypes(b: Binding, reg: BehaviorRegistry): ParamType[] {
  return reg.get(b.behavior)?.params.map((p) => p.type) ?? []
}

/**
 * Remap every numeric layer reference in the keymap through `map` (old index → new
 * index, or undefined when the layer was deleted). References made through a
 * `#define` are fixed by updating the define's value instead.
 */
export function remapLayers(file: DtsFile, map: (old: number) => number | undefined, grid?: GridPos[], definesBefore?: Map<string, number>) {
  const reg = buildRegistry(file)
  const defines = definesBefore ?? layerDefines(file)

  forEachBinding(file, (b) => {
    const idxs = layerParamIndexes(b, reg)
    if (!idxs.length) return
    let changed = false
    const params = [...b.params]
    for (const i of idxs) {
      const tok = params[i]
      if (tok === undefined || !/^\d+$/.test(tok)) continue
      const next = map(Number(tok))
      if (next === undefined) return { ...NONE }
      if (next !== Number(tok)) { params[i] = String(next); changed = true }
    }
    return changed ? { ...b, params } : undefined
  }, grid)

  // Combo `layers` and conditional layers.
  const remapList = (raw: string | null | undefined): string | undefined => {
    if (raw == null) return undefined
    const cells = parseCells(raw)
    const out: string[] = []
    for (const c of cells) {
      if (!/^\d+$/.test(c)) { out.push(c); continue }
      const n = map(Number(c))
      if (n !== undefined) out.push(String(n))
    }
    return `<${out.join(' ')}>`
  }
  for (const combos of findByCompatible(file, 'zmk,combos')) {
    for (const combo of nodes(combos.children)) {
      const v = remapList(getRaw(combo, 'layers'))
      if (v !== undefined && v !== getRaw(combo, 'layers')) setProp(combo, 'layers', v)
    }
  }
  for (const cl of findByCompatible(file, 'zmk,conditional-layers')) {
    for (const c of nodes(cl.children)) {
      const ifl = remapList(getRaw(c, 'if-layers'))
      if (ifl !== undefined && ifl !== getRaw(c, 'if-layers')) setProp(c, 'if-layers', ifl)
      const then = remapList(getRaw(c, 'then-layer'))
      if (then !== undefined && then !== getRaw(c, 'then-layer')) setProp(c, 'then-layer', then === '<>' ? undefined : then)
    }
  }

  // Layer-name defines.
  for (const [name, old] of defines) {
    const next = map(old)
    if (next !== undefined && next !== old) setDefineValue(file, name, String(next))
  }
}

export function addLayer(file: DtsFile, name: string, keyCount: number, grid?: GridPos[], copyFrom?: Binding[]): number {
  const km = keymapNode(file)
  if (!km) throw new Error('This keymap has no keymap node')
  const existing = new Set(nodes(km.children).map((n) => n.name))
  let nodeName = 'layer_' + slug(name)
  for (let i = 2; existing.has(nodeName); i++) nodeName = `layer_${slug(name)}_${i}`
  const bindings = copyFrom ? copyFrom.map((b) => ({ ...b, params: [...b.params] })) : Array.from({ length: keyCount }, () => ({ ...TRANS }))
  const node: DtsNode = { kind: 'node', labels: [], name: nodeName, children: [], leading: [''], tail: [] }
  setProp(node, 'display-name', quote(name))
  setProp(node, 'bindings', formatLayerBindings(bindings, grid, '            '))
  km.children.push(node)
  const index = nodes(km.children).length - 1

  // Give the new layer a #define if the keymap names its layers that way.
  const defines = layerDefines(file)
  if (defines.size > 0) {
    let defName = slug(name).toUpperCase()
    const taken = new Set(getDefines(file).map((d) => d.name))
    for (let i = 2; taken.has(defName); i++) defName = `${slug(name).toUpperCase()}_${i}`
    const lastName = [...defines.keys()].pop()!
    const lastIdx = file.items.findIndex((it) => it.kind === 'directive' && new RegExp(`^#\\s*define\\s+${lastName}\\b`).test(it.text))
    const pad = Math.max(lastName.length, defName.length)
    const directive: DtsDirective = { kind: 'directive', text: `#define ${defName.padEnd(pad)} ${index}`, leading: [] }
    file.items.splice(lastIdx + 1, 0, directive)
  }
  return index
}

export function removeLayer(file: DtsFile, index: number, grid?: GridPos[]) {
  const km = keymapNode(file)
  if (!km) return
  const layerNodes = nodes(km.children)
  const target = layerNodes[index]
  if (!target) return
  const defines = layerDefines(file)
  const defName = [...defines].find(([, i]) => i === index)?.[0]
  const remaining = new Map([...defines].filter(([n]) => n !== defName))

  // References through the define become &none before the define disappears.
  if (defName) {
    const reg = buildRegistry(file)
    forEachBinding(file, (b) => {
      const idxs = layerParamIndexes(b, reg)
      return idxs.some((i) => b.params[i] === defName) ? { ...NONE } : undefined
    }, grid)
    file.items = file.items.filter((it) => !(it.kind === 'directive' && new RegExp(`^#\\s*define\\s+${defName}\\b`).test(it.text)))
    for (const combos of findByCompatible(file, 'zmk,combos')) {
      for (const combo of nodes(combos.children)) {
        const cells = parseCells(getRaw(combo, 'layers'))
        if (cells.includes(defName)) setProp(combo, 'layers', `<${cells.filter((c) => c !== defName).join(' ')}>`)
      }
    }
  }
  km.children.splice(km.children.indexOf(target), 1)
  remapLayers(file, (old) => (old === index ? undefined : old > index ? old - 1 : old), grid, remaining)
}

export function moveLayer(file: DtsFile, from: number, to: number, grid?: GridPos[]) {
  if (from === to) return
  const km = keymapNode(file)
  if (!km) return
  const layerNodes = nodes(km.children)
  const order = layerNodes.map((_, i) => i)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  // order[newIndex] = oldIndex
  const oldToNew = new Map(order.map((old, neu) => [old, neu]))
  const defines = layerDefines(file)
  const others = km.children.filter((c) => c.kind !== 'node')
  km.children = [...others, ...order.map((old) => layerNodes[old])]
  remapLayers(file, (old) => oldToNew.get(old), grid, defines)
  // Keep layer defines in index order in the file.
  sortLayerDefines(file)
}

function sortLayerDefines(file: DtsFile) {
  const defines = layerDefines(file)
  const idxs = file.items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.kind === 'directive' && [...defines.keys()].some((n) => new RegExp(`^#\\s*define\\s+${n}\\b`).test((it as DtsDirective).text)))
  if (idxs.length < 2) return
  const sorted = [...idxs].sort((a, b) => {
    const va = Number((a.it as DtsDirective).text.match(/(\d+)\s*$/)?.[1])
    const vb = Number((b.it as DtsDirective).text.match(/(\d+)\s*$/)?.[1])
    return va - vb
  })
  const leadings = idxs.map(({ it }) => it.leading)
  idxs.forEach(({ i }, k) => {
    file.items[i] = { ...(sorted[k].it as DtsDirective), leading: leadings[k] }
  })
}

export function renameLayer(file: DtsFile, index: number, name: string) {
  const layer = getLayers(file)[index]
  if (layer) setProp(layer.node, 'display-name', quote(name))
}

export function setLayerBindings(file: DtsFile, index: number, bindings: Binding[], grid?: GridPos[]) {
  const layers = getLayers(file)
  const layer = layers[index]
  if (!layer) return
  setProp(layer.node, 'bindings', formatLayerBindings(bindings, grid, '            '))
}

/** Re-format every layer so columns line up across the whole file. */
export function reformatLayers(file: DtsFile, grid?: GridPos[]) {
  const layers = getLayers(file)
  const all = layers.map((l) => l.bindings)
  for (const l of layers) setProp(l.node, 'bindings', formatLayerBindings(l.bindings, grid, '            ', all))
}

// ---------------------------------------------------------------------------
// Includes

export function ensureIncludes(file: DtsFile, includes: string[]) {
  const have = new Set(file.items.filter((i) => i.kind === 'directive').map((i) => (i as DtsDirective).text.replace(/\s+/g, ' ').trim()))
  const missing = includes.filter((inc) => !have.has(inc))
  if (!missing.length) return
  let last = -1
  file.items.forEach((it, i) => { if (it.kind === 'directive' && /^#\s*include/.test(it.text)) last = i })
  const items: DtsItem[] = missing.map((text) => ({ kind: 'directive', text, leading: [] }))
  file.items.splice(last + 1, 0, ...items)
}
