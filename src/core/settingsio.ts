import { getRaw, parseCells, parseString, quote, setProp, type DtsDirective } from './dts.ts'
import { cleanupEmptyOverride, overrideNode } from './features.ts'
import { getDefines, layerDefines, resolveLayer } from './keymap.ts'
import { findOverlayProp, setOverlayProp } from './overlay.ts'
import { editKeymap, type Project } from './project.ts'
import { findKconfig, setKconfig, unquoteConf, type Setting } from './settings.ts'

export interface SettingState {
  /** Current value, or undefined when not set (ZMK's default applies). */
  value: string | number | boolean | number[] | undefined
  /** File the value comes from (or would be written to). */
  where?: string
  available: boolean
}

function scopeFile(p: Project, scope: string): string | undefined {
  return [...p.confs].reverse().find((c) => c.scope === scope)?.path ?? [...p.confs].reverse().find((c) => c.scope === 'both')?.path
}

export function readSetting(p: Project, s: Setting): SettingState {
  const t = s.target
  switch (t.kind) {
    case 'kconfig': {
      const hit = findKconfig(p.confs, t.symbol)
      const where = hit?.file.path ?? scopeFile(p, t.scope)
      if (!hit) return { value: undefined, where, available: true }
      if (s.type === 'toggle') return { value: hit.value === 'y', where, available: true }
      if (s.type === 'number') return { value: Number(hit.value), where, available: true }
      return { value: unquoteConf(hit.value), where, available: true }
    }
    case 'kconfig-choice': {
      for (const o of t.options) {
        const hit = findKconfig(p.confs, o.symbol)
        if (hit?.value === 'y') return { value: o.value, where: hit.file.path, available: true }
      }
      return { value: undefined, where: scopeFile(p, t.scope), available: true }
    }
    case 'override': {
      const node = overrideNode(p.keymap, t.behavior, false)
      const raw = node ? getRaw(node, t.prop) : undefined
      const where = p.files.keymapPath
      if (raw === undefined) return { value: undefined, where, available: true }
      if (raw === null) return { value: true, where, available: true }
      const str = parseString(raw)
      if (str !== undefined) return { value: str, where, available: true }
      return { value: Number(parseCells(raw)[0]), where, available: true }
    }
    case 'define': {
      const d = getDefines(p.keymap).find((x) => x.name === t.name)
      return { value: d ? Number(d.value) : undefined, where: p.files.keymapPath, available: true }
    }
    case 'overlay': {
      const hit = findOverlayProp(p.overlays, t.label, t.prop)
      if (!hit) return { value: undefined, available: false }
      const defines = layerDefines(p.keymap)
      if (t.cell !== undefined) {
        const c = hit.cells[t.cell]
        return { value: c === undefined ? undefined : Number(resolveLayer(c, defines) ?? c), where: hit.file.path, available: true }
      }
      return { value: hit.cells.map((c) => resolveLayer(c, defines) ?? Number(c)), where: hit.file.path, available: true }
    }
  }
}

function confValue(s: Setting, v: unknown): string {
  if (s.type === 'toggle') return v ? 'y' : 'n'
  if (s.type === 'text') return `"${String(v).replace(/"/g, '')}"`
  return String(v)
}

/** Write a setting. `undefined` resets it (removes the line / property so ZMK's default applies). */
export function writeSetting(p: Project, s: Setting, v: unknown): Project {
  const t = s.target
  switch (t.kind) {
    case 'kconfig':
      return { ...p, confs: setKconfig(p.confs, t.symbol, v === undefined ? undefined : confValue(s, v), t.scope) }
    case 'kconfig-choice': {
      let confs = p.confs
      for (const o of t.options) confs = setKconfig(confs, o.symbol, undefined, t.scope)
      const chosen = t.options.find((o) => o.value === v)
      if (chosen) confs = setKconfig(confs, chosen.symbol, 'y', t.scope)
      return { ...p, confs }
    }
    case 'override':
      return editKeymap(p, (f) => {
        const node = overrideNode(f, t.behavior, v !== undefined)
        if (!node) return
        if (v === undefined) setProp(node, t.prop, undefined)
        else if (typeof v === 'boolean') setProp(node, t.prop, v ? null : undefined)
        else if (s.type === 'select') setProp(node, t.prop, quote(String(v)))
        else setProp(node, t.prop, `<${Number(v)}>`)
        cleanupEmptyOverride(f, t.behavior)
      })
    case 'define':
      return editKeymap(p, (f) => {
        const idx = f.items.findIndex((i) => i.kind === 'directive' && new RegExp(`^#\\s*define\\s+${t.name}\\b`).test(i.text))
        if (v === undefined) { if (idx >= 0) f.items.splice(idx, 1); return }
        const text = `#define ${t.name} ${Number(v)}`
        if (idx >= 0) { (f.items[idx] as DtsDirective).text = text; return }
        // Must come before the header that provides the default.
        const inc = f.items.findIndex((i) => i.kind === 'directive' && /^#\s*include\s*<dt-bindings\/zmk\/pointing\.h>/.test(i.text))
        const first = f.items.findIndex((i) => i.kind === 'directive' && /^#\s*include/.test(i.text))
        f.items.splice(inc >= 0 ? Math.min(inc, first) : 0, 0, { kind: 'directive', text, leading: [] })
      })
    case 'overlay': {
      const cells = v === undefined ? undefined : Array.isArray(v) ? v.map(String) : [String(v)]
      return { ...p, overlays: setOverlayProp(p.overlays, t.label, t.prop, cells, t.cell) }
    }
  }
}
