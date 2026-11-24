/**
 * The editable project: one keymap plus the .conf and overlay files around it, and the
 * editor's own metadata (layer colours, key labels). All edits are pure functions that
 * return a new Project, which gives undo/redo for free.
 */
import { parseDts, printDts, type DtsFile } from './dts.ts'
import {
  addLayer, getDefines, getLayers, layerDefines, moveLayer, removeLayer, ensureIncludes, type Binding,
} from './keymap.ts'
import { buildRegistry } from './behaviors.ts'
import { collectGarbage } from './composer.ts'
import { getAutoMouse, remapOverlayLayers, setOverlayProp, type OverlayFile } from './overlay.ts'
import type { ConfFile } from './settings.ts'
import type { Layout } from './layout.ts'
import type { OsFlavour } from './keycodes.ts'

export interface ProjectFiles {
  root: string
  name: string
  keymapPath: string
  keymap: string
  confs: ConfFile[]
  overlays: OverlayFile[]
  metaPath: string
  meta: string | null
  layout: Layout
  features: Features
  /** Path of the GitHub remote, if any (owner/repo). */
  github?: string
  /** config/west.yml (modules). */
  west?: { path: string; text: string }
}

export interface Features {
  split: boolean
  central?: 'left' | 'right'
  pmw3610: boolean
  autoMouse: boolean
  underglow: boolean
}

export interface KeyMeta { label?: string; color?: string }

export interface EditorMeta {
  version: 1
  /** Keyed by layer node name, so reordering layers keeps colours. */
  layers: Record<string, { color?: string }>
  keys: Record<string, Record<number, KeyMeta>>
  os: OsFlavour
  /** Keep the auto-mouse excluded positions equal to the mouse layer's non-transparent keys. */
  syncAutoMouse: boolean
}

export const DEFAULT_META: EditorMeta = { version: 1, layers: {}, keys: {}, os: 'linux', syncAutoMouse: true }

export interface Project {
  files: ProjectFiles
  keymap: DtsFile
  confs: ConfFile[]
  overlays: OverlayFile[]
  meta: EditorMeta
  west?: { path: string; text: string }
}

export const LAYER_COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#eab308']

export function loadProject(files: ProjectFiles): Project {
  let meta: EditorMeta = { ...DEFAULT_META }
  if (files.meta) {
    try { meta = { ...DEFAULT_META, ...JSON.parse(files.meta) } } catch { /* ignore a broken sidecar */ }
  }
  return { files, keymap: parseDts(files.keymap), confs: files.confs.map((c) => ({ ...c })), overlays: files.overlays.map((o) => ({ ...o })), meta, west: files.west ? { ...files.west } : undefined }
}

/** Apply a mutation to a copy of the keymap tree. */
export function editKeymap(p: Project, fn: (file: DtsFile) => void): Project {
  const keymap = structuredClone(p.keymap)
  fn(keymap)
  return { ...p, keymap }
}

export function layerColor(p: Project, layerId: string, index: number): string {
  return p.meta.layers[layerId]?.color ?? LAYER_COLORS[index % LAYER_COLORS.length]
}

export function keyCount(p: Project): number {
  return p.files.layout.keys.length
}

// ---------------------------------------------------------------------------
// Layer operations that also keep overlays and metadata in step

export function projectAddLayer(p: Project, name: string, copyFrom?: number): Project {
  const src = copyFrom !== undefined ? getLayers(p.keymap)[copyFrom]?.bindings : undefined
  return editKeymap(p, (f) => { addLayer(f, name, keyCount(p), p.files.layout.grid, src) })
}

export function projectRemoveLayer(p: Project, index: number): Project {
  const layers = getLayers(p.keymap)
  const id = layers[index]?.id
  const next = editKeymap(p, (f) => removeLayer(f, index, p.files.layout.grid))
  const meta = structuredClone(p.meta)
  if (id) { delete meta.layers[id]; delete meta.keys[id] }
  return { ...next, meta, overlays: remapOverlayLayers(p.overlays, (old) => (old === index ? undefined : old > index ? old - 1 : old)) }
}

export function projectMoveLayer(p: Project, from: number, to: number): Project {
  const n = getLayers(p.keymap).length
  const order = Array.from({ length: n }, (_, i) => i)
  const [m] = order.splice(from, 1)
  order.splice(to, 0, m)
  const oldToNew = new Map(order.map((old, neu) => [old, neu]))
  const next = editKeymap(p, (f) => moveLayer(f, from, to, p.files.layout.grid))
  return { ...next, overlays: remapOverlayLayers(p.overlays, (old) => oldToNew.get(old)) }
}

export function setKeyMeta(p: Project, layerId: string, pos: number, km: KeyMeta | undefined): Project {
  const meta = structuredClone(p.meta)
  meta.keys[layerId] ??= {}
  if (!km || (!km.label && !km.color)) delete meta.keys[layerId][pos]
  else meta.keys[layerId][pos] = km
  if (!Object.keys(meta.keys[layerId]).length) delete meta.keys[layerId]
  return { ...p, meta }
}

// ---------------------------------------------------------------------------
// Saving

/** Bindings on the auto-mouse layer that do something (so moving the ball shouldn't cancel the layer when they're pressed). */
export function autoMouseExcluded(p: Project): number[] | undefined {
  const am = getAutoMouse(p.overlays)
  if (!am || am.layer === undefined) return undefined
  const layer = getLayers(p.keymap)[am.layer]
  if (!layer) return undefined
  return layer.bindings.map((b: Binding, i) => (b.behavior !== 'trans' ? i : -1)).filter((i) => i >= 0)
}

export interface SaveResult {
  files: Record<string, string>
  notes: string[]
}

const canonicalCache = new Map<string, string>()
function canonical(text: string): string {
  let c = canonicalCache.get(text)
  if (c === undefined) {
    try { c = printDts(parseDts(text)) } catch { c = text }
    if (canonicalCache.size > 20) canonicalCache.clear()
    canonicalCache.set(text, c)
  }
  return c
}

/** Produce the text of every file that differs from what was loaded. */
export function serializeProject(p: Project): SaveResult {
  const notes: string[] = []
  const keymap = structuredClone(p.keymap)
  const removed = collectGarbage(keymap)
  if (removed.length) notes.push(`Removed unused generated behaviours: ${removed.join(', ')}`)

  // Make sure headers for the parameter constants in use are included.
  const reg = buildRegistry(keymap)
  const used = new Set<string>()
  const text0 = printDts(keymap)
  for (const m of text0.matchAll(/&([A-Za-z_][\w]*)/g)) used.add(m[1])
  const includes = [...used].flatMap((u) => reg.get(u)?.includes ?? [])
  if (includes.length) ensureIncludes(keymap, [...new Set(includes)])

  const files: Record<string, string> = {}
  const keymapText = printDts(keymap)
  // Compare with the canonical print of what was loaded, so cosmetic differences in how we
  // print an untouched file (spacing) don't count as a change.
  if (keymapText !== p.files.keymap && keymapText !== canonical(p.files.keymap)) files[p.files.keymapPath] = keymapText

  let overlays = p.overlays
  if (p.meta.syncAutoMouse) {
    const excluded = autoMouseExcluded(p)
    const am = getAutoMouse(overlays)
    if (excluded && am && excluded.join(' ') !== am.excluded.join(' ')) {
      overlays = setOverlayProp(overlays, am.processorLabel, 'excluded-positions', excluded.map(String))
      notes.push(`Auto-mouse excluded positions updated to match the mouse layer: ${excluded.join(' ')}`)
    }
  }
  for (const o of overlays) {
    const orig = p.files.overlays.find((x) => x.path === o.path)
    if (orig && orig.text !== o.text) files[o.path] = o.text
  }
  for (const c of p.confs) {
    const orig = p.files.confs.find((x) => x.path === c.path)
    if (!orig || orig.text !== c.text) files[c.path] = c.text
  }
  if (p.west && p.files.west && p.west.text !== p.files.west.text) files[p.west.path] = p.west.text
  const metaText = JSON.stringify(p.meta, null, 2) + '\n'
  if (metaText !== (p.files.meta ?? '') && (p.files.meta !== null || JSON.stringify(p.meta) !== JSON.stringify(DEFAULT_META))) files[p.files.metaPath] = metaText
  return { files, notes }
}

/** After a successful save, the saved state becomes the new baseline. */
export function markSaved(p: Project, saved: Record<string, string>): Project {
  const files = structuredClone(p.files)
  if (saved[files.keymapPath] !== undefined) files.keymap = saved[files.keymapPath]
  files.overlays = files.overlays.map((o) => ({ ...o, text: saved[o.path] ?? o.text }))
  files.confs = files.confs.map((c) => ({ ...c, text: saved[c.path] ?? c.text }))
  if (saved[files.metaPath] !== undefined) files.meta = saved[files.metaPath]
  if (files.west && saved[files.west.path] !== undefined) files.west = { ...files.west, text: saved[files.west.path] }
  return {
    ...p,
    files,
    keymap: parseDts(files.keymap),
    overlays: files.overlays.map((o) => ({ ...o })),
    confs: files.confs.map((c) => ({ ...c })),
    west: files.west ? { ...files.west } : undefined,
  }
}

export function isDirty(p: Project): boolean {
  return Object.keys(serializeProject(p).files).length > 0
}

export { layerDefines, getDefines }
