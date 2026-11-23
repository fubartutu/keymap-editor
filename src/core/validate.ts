/**
 * Live checks run on every edit, like Oryx's conflict warnings. The server additionally runs
 * the C preprocessor and Zephyr's devicetree parser against the real ZMK headers on save.
 */
import { buildRegistry, expectedParamCount } from './behaviors.ts'
import { getRaw, parseCells, walkNodes } from './dts.ts'
import { getCombos } from './features.ts'
import { findKeycode, parseKeyExpr } from './keycodes.ts'
import { getDefines, getLayers, layerDefines, resolveLayer, type Binding } from './keymap.ts'
import type { Project } from './project.ts'

export interface Issue {
  severity: 'error' | 'warning' | 'info'
  message: string
  layer?: number
  key?: number
  combo?: string
  behavior?: string
}

const KNOWN_CONSTANTS = /^(MOVE_[XY]\(.*\)|SCRL_[XY]\(.*\)|MOVE_(UP|DOWN|LEFT|RIGHT)|SCRL_(UP|DOWN|LEFT|RIGHT)|MB\d|[LMR]CLK|BT_\w+|OUT_\w+|RGB_\w+(\(.*\))?|BL_\w+|EP_\w+|\d+|0x[0-9a-fA-F]+)$/

export function validateProject(p: Project): Issue[] {
  const issues: Issue[] = []
  const file = p.keymap
  const reg = buildRegistry(file)
  const layers = getLayers(file)
  const defines = layerDefines(file)
  const allDefines = new Set(getDefines(file).map((d) => d.name))
  const keyCount = p.files.layout.keys.length

  if (!layers.length) issues.push({ severity: 'error', message: 'No keymap node (compatible = "zmk,keymap") was found.' })

  const checkBinding = (b: Binding, where: Omit<Issue, 'severity' | 'message'>, label: string) => {
    const def = reg.get(b.behavior)
    if (!def) {
      issues.push({ severity: 'error', message: `${label}: unknown behaviour &${b.behavior}.`, ...where })
      return
    }
    const expected = expectedParamCount(def, b.params[0])
    if (expected !== undefined && b.params.length !== expected) {
      issues.push({ severity: 'error', message: `${label}: &${b.behavior} takes ${expected} parameter${expected === 1 ? '' : 's'}, found ${b.params.length} (${b.params.join(' ') || 'none'}).`, ...where })
    }
    def.params.forEach((param, i) => {
      const tok = b.params[i]
      if (tok === undefined) return
      if (param.type === 'layer') {
        const idx = resolveLayer(tok, defines)
        if (idx === undefined && !allDefines.has(tok)) issues.push({ severity: 'error', message: `${label}: "${tok}" is not a layer.`, ...where })
        else if (idx !== undefined && idx >= layers.length) issues.push({ severity: 'error', message: `${label}: layer ${idx} does not exist (there are ${layers.length}).`, ...where })
      } else if (param.type === 'keycode' || param.type === 'mod') {
        const { key } = parseKeyExpr(tok)
        if (!findKeycode(key) && !allDefines.has(key) && !KNOWN_CONSTANTS.test(key)) {
          issues.push({ severity: 'warning', message: `${label}: "${key}" is not a known keycode.`, ...where })
        }
      }
    })
  }

  layers.forEach((layer, li) => {
    if (layer.bindings.length !== keyCount) {
      issues.push({ severity: 'error', layer: li, message: `Layer "${layer.name}" has ${layer.bindings.length} bindings but the keyboard has ${keyCount} keys.` })
    }
    layer.bindings.forEach((b, ki) => checkBinding(b, { layer: li, key: ki }, `${layer.name}, key ${ki}`))
    if (li === 0 && layer.bindings.some((b) => b.behavior === 'trans')) {
      issues.push({ severity: 'info', layer: 0, message: 'The base layer has transparent keys; they do nothing (there is no layer below).' })
    }
  })

  // Layers you can never reach.
  const reachable = new Set<number>([0])
  const scan = (b: Binding) => {
    const def = reg.get(b.behavior)
    def?.params.forEach((pp, i) => {
      if (pp.type === 'layer' && b.params[i] !== undefined) {
        const idx = resolveLayer(b.params[i], defines)
        if (idx !== undefined) reachable.add(idx)
      }
    })
  }
  layers.forEach((l) => l.bindings.forEach(scan))
  walkNodes(file.items, (n) => {
    for (const c of n.children) if (c.kind === 'prop' && c.name === 'bindings' && c.raw) for (const m of c.raw.matchAll(/&(\w+)\s+([A-Za-z_0-9]+)/g)) scan({ behavior: m[1], params: [m[2]] })
    const then = getRaw(n, 'then-layer')
    if (then) parseCells(then).forEach((t) => { const i = resolveLayer(t, defines); if (i !== undefined) reachable.add(i) })
  })
  for (const raw of p.overlays.map((o) => o.text)) {
    for (const m of raw.matchAll(/input-processors\s*=\s*<&\w+\s+(\d+)/g)) reachable.add(Number(m[1]))
  }
  layers.forEach((l, i) => {
    if (!reachable.has(i)) issues.push({ severity: 'warning', layer: i, message: `Layer "${l.name}" can't be reached: no key, combo or auto-mouse switches to it.` })
  })

  // Combos
  const combos = getCombos(file)
  combos.forEach((c) => {
    if (c.positions.length < 2) issues.push({ severity: 'error', combo: c.id, message: `Combo ${c.id} needs at least two keys.` })
    for (const pos of c.positions) if (pos >= keyCount) issues.push({ severity: 'error', combo: c.id, message: `Combo ${c.id} uses key ${pos}, but the keyboard has ${keyCount} keys.` })
    checkBinding(c.binding, { combo: c.id }, `Combo ${c.id}`)
  })
  for (let i = 0; i < combos.length; i++) {
    for (let j = i + 1; j < combos.length; j++) {
      const a = combos[i], b = combos[j]
      const same = a.positions.length === b.positions.length && [...a.positions].sort().join() === [...b.positions].sort().join()
      const shareLayer = !a.layers.length || !b.layers.length || a.layers.some((l) => b.layers.includes(l))
      if (same && shareLayer) issues.push({ severity: 'error', combo: b.id, message: `Combos ${a.id} and ${b.id} use the same keys on the same layer.` })
    }
  }

  // Behaviour definitions
  walkNodes(file.items, (n) => {
    const label = n.labels[0]
    if (!label) return
    const positions = getRaw(n, 'hold-trigger-key-positions')
    if (positions) {
      const bad = parseCells(positions).filter((c) => /^\d+$/.test(c) && Number(c) >= keyCount)
      if (bad.length) issues.push({ severity: 'error', behavior: label, message: `&${label}: hold-trigger positions ${bad.join(', ')} don't exist.` })
    }
  })

  return issues
}
