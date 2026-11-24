/** Human-readable legends for bindings, as shown on key caps and in lists. */
import { MOUSE_BUTTONS, MOUSE_MOVES, SCROLLS, type BehaviorRegistry } from './behaviors.ts'
import { decompose } from './composer.ts'
import type { DtsFile } from './dts.ts'
import { keyLabel, type OsFlavour } from './keycodes.ts'
import { resolveLayer, type Binding, type LayerInfo } from './keymap.ts'
import { getAdaptiveKeys, getMacros } from './features.ts'

export type LegendKind = 'key' | 'mod' | 'layer' | 'trans' | 'none' | 'mouse' | 'bt' | 'firmware' | 'light' | 'macro' | 'special' | 'unknown'

export interface Legend {
  main: string
  /** Modifiers applied to the tap (e.g. Ctrl+). */
  mods?: string
  /** What happens on hold. */
  hold?: string
  holdKind?: LegendKind
  /** Layer index the hold or tap activates (for colouring). */
  layer?: number
  holdLayer?: number
  doubleTap?: string
  tapHold?: string
  /** Number of taps in a tap dance (2 for a double tap…). */
  taps?: number
  /** What the key does with Shift (or other modifier) held: a mod-morph. */
  morph?: string
  morphMods?: string
  /** The key is an adaptive key (output depends on the previous key). */
  adaptive?: boolean
  kind: LegendKind
  /** Full description for tooltips. */
  title: string
}

export interface DescribeCtx {
  file: DtsFile
  reg: BehaviorRegistry
  layers: LayerInfo[]
  defines: Map<string, number>
  os: OsFlavour
}

const LAYER_VERB: Record<string, string> = { mo: '', to: '→', tog: '⇄', sl: '1×' }
const BT_SHORT: Record<string, string> = { BT_SEL: 'BT', BT_NXT: 'BT next', BT_PRV: 'BT prev', BT_CLR: 'BT clear', BT_CLR_ALL: 'BT clear all', BT_DISC: 'BT off' }

function layerName(ctx: DescribeCtx, tok: string): { name: string; index?: number } {
  const i = resolveLayer(tok, ctx.defines)
  if (i !== undefined && ctx.layers[i]) return { name: ctx.layers[i].name, index: i }
  return { name: tok, index: i }
}

/** Legend for a single "simple" binding (no hold-tap/tap-dance decomposition). */
export function describeSimple(b: Binding, ctx: DescribeCtx): Legend {
  const def = ctx.reg.get(b.behavior)
  const p0 = b.params[0]
  switch (b.behavior) {
    case 'kp': case 'kt': case 'sk': {
      const { label, mods } = keyLabel(p0 ?? '', ctx.os)
      const isMod = /^(L|R)(CTRL|SHFT|SHIFT|ALT|GUI|CTL|SFT|CMD|WIN|META)$|^(LEFT|RIGHT)_/.test(p0 ?? '')
      const prefix = b.behavior === 'sk' ? '1× ' : b.behavior === 'kt' ? '⇵ ' : ''
      return { main: prefix + label, mods: mods.length ? mods.join('+') + '+' : undefined, kind: isMod ? 'mod' : 'key', title: `${def?.name ?? b.behavior}: ${mods.length ? mods.join('+') + '+' : ''}${label}` }
    }
    case 'trans': return { main: '', kind: 'trans', title: 'Transparent: uses the key from the layer below' }
    case 'none': return { main: '', kind: 'none', title: 'Does nothing' }
    case 'mo': case 'to': case 'tog': case 'sl': {
      const l = layerName(ctx, p0 ?? '')
      const verb = LAYER_VERB[b.behavior]
      return { main: `${verb ? verb + ' ' : ''}${l.name}`, kind: 'layer', layer: l.index, title: `${def?.name}: ${l.name}` }
    }
    case 'bt': {
      const cmd = (p0 ?? '').replace(/\(.*$/, '')
      return { main: `${BT_SHORT[cmd] ?? cmd}${b.params[1] !== undefined ? ' ' + b.params[1] : ''}`, kind: 'bt', title: `Bluetooth: ${def?.commands?.find((c) => c.code === cmd)?.label ?? cmd} ${b.params[1] ?? ''}` }
    }
    case 'out': return { main: p0 === 'OUT_USB' ? 'USB' : p0 === 'OUT_BLE' ? 'BLE' : 'USB/BLE', kind: 'bt', title: `Output: ${p0}` }
    case 'rgb_ug': case 'bl': case 'ext_power': {
      const cmd = (p0 ?? '').replace(/\(.*$/, '')
      const label = def?.commands?.find((c) => c.code === cmd)?.label ?? cmd
      const prefix = b.behavior === 'rgb_ug' ? 'RGB' : b.behavior === 'bl' ? 'BL' : 'Power'
      return { main: `${prefix} ${label}`, kind: 'light', title: `${def?.name}: ${label}` }
    }
    case 'mkp': {
      const btn = MOUSE_BUTTONS.find((m) => m.code === p0)
      const short: Record<string, string> = { LCLK: 'L click', RCLK: 'R click', MCLK: 'M click', MB4: 'Back', MB5: 'Fwd' }
      return { main: short[p0 ?? ''] ?? p0 ?? '', kind: 'mouse', title: `Mouse: ${btn?.label ?? p0}` }
    }
    case 'mmv': return { main: '🖱 ' + (MOUSE_MOVES.find((m) => m.code === p0)?.label ?? p0), kind: 'mouse', title: `Move mouse ${p0}` }
    case 'msc': return { main: '⇳ ' + (SCROLLS.find((m) => m.code === p0)?.label ?? p0), kind: 'mouse', title: `Scroll ${p0}` }
    case 'caps_word': return { main: 'Caps word', kind: 'special', title: 'Caps word' }
    case 'key_repeat': return { main: 'Repeat', kind: 'special', title: 'Repeat last key' }
    case 'gresc': return { main: 'Esc/`', kind: 'key', title: 'Grave escape' }
    case 'bootloader': return { main: 'Boot', kind: 'firmware', title: 'Bootloader (for flashing)' }
    case 'sys_reset': return { main: 'Reset', kind: 'firmware', title: 'Reset' }
    case 'soft_off': return { main: 'Off', kind: 'firmware', title: 'Soft off' }
    case 'studio_unlock': return { main: 'Studio', kind: 'firmware', title: 'Unlock ZMK Studio' }
  }
  if (def?.kind === 'leader') return { main: '★ Leader', kind: 'special', title: `Leader key &${b.behavior}: type a sequence after it` }
  if (def?.kind === 'adaptive') {
    const ak = getAdaptiveKeys(ctx.file).find((x) => x.label === b.behavior)
    const d = ak?.defaultBindings[0] ? describeSimple(ak.defaultBindings[0], ctx) : undefined
    const rules = ak?.triggers.map((t) => `after ${t.triggerKeys.join('/')}: ${t.bindings.map((x) => describeSimple(x, ctx).main).join('')}`).join('\n') ?? ''
    return { main: (d ? (d.mods ?? '') + d.main : b.behavior), kind: d?.kind ?? 'special', adaptive: true, title: `Adaptive key &${b.behavior}\nNormally: ${d?.title ?? 'nothing'}\n${rules}` }
  }
  if (def?.kind === 'macro') {
    const m = getMacros(ctx.file).find((x) => x.label === b.behavior)
    return { main: '⚡ ' + (m?.name ?? b.behavior), kind: 'macro', title: `Macro: ${m?.name ?? b.behavior}` }
  }
  if (def) return { main: def.name, kind: 'special', title: `${def.name} ${b.params.join(' ')}`.trim() }
  return { main: `&${b.behavior}`, kind: 'unknown', title: `Unknown behaviour &${b.behavior} ${b.params.join(' ')}` }
}

export function describe(b: Binding, ctx: DescribeCtx): Legend {
  const steps = decompose(b, ctx.file, ctx.reg)
  if (!steps || (!steps.hold && !steps.doubleTap && !steps.tapHold && !steps.moreTaps && !steps.morph)) {
    const def = ctx.reg.get(b.behavior)
    if (!steps && def?.kind === 'tap-dance') return { main: '⋯ ' + def.name, kind: 'special', title: `Tap dance ${def.id}` }
    return describeSimple(b, ctx)
  }
  const tap = steps.tap ? describeSimple(steps.tap, ctx) : { main: '', kind: 'none' as LegendKind, title: '' }
  const legend: Legend = { ...tap, title: `Tap: ${tap.title}` }
  if (steps.hold) {
    const h = describeSimple(steps.hold, ctx)
    legend.hold = (h.mods ?? '') + h.main
    legend.holdKind = h.kind
    legend.holdLayer = h.layer
    legend.title += `\nHold: ${h.title}`
  }
  if (steps.doubleTap) {
    const d = describeSimple(steps.doubleTap, ctx)
    legend.doubleTap = (d.mods ?? '') + d.main
    legend.title += `\nDouble tap: ${d.title}`
  }
  if (steps.tapHold) {
    const t = describeSimple(steps.tapHold, ctx)
    legend.tapHold = (t.mods ?? '') + t.main
    legend.title += `\nTap then hold: ${t.title}`
  }
  steps.moreTaps?.forEach((t, i) => {
    const n = i + 3
    if (t.tap) legend.title += `\n${n} taps: ${describeSimple(t.tap, ctx).title}`
    if (t.hold) legend.title += `\n${n} taps then hold: ${describeSimple(t.hold, ctx).title}`
  })
  if (steps.doubleTap || steps.tapHold || steps.moreTaps?.length) legend.taps = 2 + (steps.moreTaps?.length ?? 0)
  if (steps.morph) {
    const m = describeSimple(steps.morph.binding, ctx)
    legend.morph = (m.mods ?? '') + m.main
    const names = [...new Set(steps.morph.mods.map((x) => x.replace(/^MOD_[LR]/, '').replace('SFT', 'Shift').replace('CTL', 'Ctrl').replace('ALT', 'Alt').replace('GUI', 'Gui')))]
    legend.morphMods = names.join('/')
    legend.title += `\nWith ${legend.morphMods}: ${m.title}`
  }
  if (steps.holdTap) legend.title += `\n(via &${steps.holdTap})`
  return legend
}
