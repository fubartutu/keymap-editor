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
import { getAdaptiveKeys, getLeaderKeys } from './features.ts'
import { hasModule, KNOWN_MODULES } from './modules.ts'
import { findKconfig } from './settings.ts'
import { findByCompatible } from './keymap.ts'

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

  // Behaviours from modules
  for (const mod of KNOWN_MODULES) {
    const used = findByCompatible(file, mod.compatible)
    if (used.length && p.west && !hasModule(p.west.text, mod.id)) {
      issues.push({ severity: 'error', behavior: used[0].labels[0], message: `&${used[0].labels[0]} needs the ${mod.id} module, which isn't in ${p.west.path}. Add it under Behaviours.` })
    }
  }
  const kint = (sym: string, def: number) => Number(findKconfig(p.confs, sym)?.value ?? def)
  const maxKeys = kint('ZMK_LEADER_MAX_KEYS_PER_SEQUENCE', 5)
  const maxSeqs = kint('ZMK_LEADER_MAX_SEQUENCES', 32)
  for (const l of getLeaderKeys(file)) {
    if (l.sequences.length > maxSeqs) issues.push({ severity: 'error', behavior: l.label, message: `&${l.label} has ${l.sequences.length} sequences; the limit is ${maxSeqs} (raise CONFIG_ZMK_LEADER_MAX_SEQUENCES).` })
    const seen = new Map<string, string>()
    for (const s of l.sequences) {
      const where = `&${l.label} sequence ${s.keys.join(' ')}`
      if (!s.keys.length) issues.push({ severity: 'error', behavior: l.label, message: `&${l.label}: sequence ${s.id} is empty.` })
      if (s.keys.length > maxKeys) issues.push({ severity: 'error', behavior: l.label, message: `${where}: ${s.keys.length} keys; the limit is ${maxKeys} (raise CONFIG_ZMK_LEADER_MAX_KEYS_PER_SEQUENCE).` })
      if (!s.bindings.length) issues.push({ severity: 'error', behavior: l.label, message: `${where} does nothing.` })
      const k = s.keys.join(' ')
      if (seen.has(k)) issues.push({ severity: 'error', behavior: l.label, message: `&${l.label}: ${seen.get(k)} and ${s.id} have the same sequence ${k}.` })
      seen.set(k, s.id)
      for (const key of s.keys) if (!findKeycode(parseKeyExpr(key).key) && !allDefines.has(key)) issues.push({ severity: 'warning', behavior: l.label, message: `${where}: "${key}" is not a known keycode.` })
      s.bindings.forEach((b) => checkBinding(b, { behavior: l.label }, where))
    }
    for (const a of l.sequences) for (const b of l.sequences) {
      if (a !== b && b.keys.length > a.keys.length && a.keys.every((k, i) => b.keys[i] === k)) {
        issues.push({ severity: 'warning', behavior: l.label, message: `&${l.label}: ${a.keys.join(' ')} is the start of ${b.keys.join(' ')}, so ${b.keys.join(' ')} can never be typed (nested sequences aren't supported).` })
      }
    }
  }
  const maxTriggers = kint('ZMK_ADAPTIVE_KEY_MAX_TRIGGER_CONDITIONS', 32)
  const maxBindings = kint('ZMK_ADAPTIVE_KEY_MAX_BINDINGS', 4)
  for (const a of getAdaptiveKeys(file)) {
    if (a.triggers.length > maxTriggers) issues.push({ severity: 'error', behavior: a.label, message: `&${a.label} has ${a.triggers.length} rules; the limit is ${maxTriggers}.` })
    a.defaultBindings.forEach((b) => checkBinding(b, { behavior: a.label }, `&${a.label}`))
    for (const t of a.triggers) {
      const where = `&${a.label}, after ${t.triggerKeys.join('/')}`
      if (!t.triggerKeys.length) issues.push({ severity: 'error', behavior: a.label, message: `${where}: no trigger keys.` })
      if (t.bindings.length > maxBindings) issues.push({ severity: 'error', behavior: a.label, message: `${where}: ${t.bindings.length} behaviours; the limit is ${maxBindings} (raise CONFIG_ZMK_ADAPTIVE_KEY_MAX_BINDINGS, or use a macro).` })
      for (const key of [...t.triggerKeys, ...a.deadKeys]) if (!findKeycode(parseKeyExpr(key).key) && !allDefines.has(key)) issues.push({ severity: 'warning', behavior: a.label, message: `&${a.label}: "${key}" is not a known keycode.` })
      t.bindings.forEach((b) => checkBinding(b, { behavior: a.label }, where))
    }
  }

  return issues
}
