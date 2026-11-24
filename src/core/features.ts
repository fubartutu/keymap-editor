import { getRaw, nodes, parseCells, parseString, quote, setProp, walkNodes, type DtsFile, type DtsNode } from './dts.ts'
import { ensureContainer, findByCompatible, formatBinding, formatBindingGroups, parseBindings, type Binding } from './keymap.ts'
import { findKeycode, KEYCODES } from './keycodes.ts'

function nodeName(base: string, taken: Set<string>): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'item'
  let n = clean
  for (let i = 2; taken.has(n); i++) n = `${clean}_${i}`
  return n
}

function allLabels(file: DtsFile): Set<string> {
  const s = new Set<string>()
  walkNodes(file.items, (n) => { n.labels.forEach((l) => s.add(l)); s.add(n.name) })
  return s
}

const int = (raw: string | null | undefined) => {
  const c = parseCells(raw)[0]
  return c !== undefined && /^\d+$/.test(c) ? Number(c) : undefined
}

// ---------------------------------------------------------------------------
// Combos

export interface Combo {
  /** Node name (identifier). */
  id: string
  positions: number[]
  binding: Binding
  /** Raw layer tokens (numbers or layer defines). Empty means all layers. */
  layers: string[]
  timeoutMs?: number
  requirePriorIdleMs?: number
  slowRelease: boolean
}

export function getCombos(file: DtsFile): Combo[] {
  const out: Combo[] = []
  for (const container of findByCompatible(file, 'zmk,combos')) {
    for (const node of nodes(container.children)) {
      out.push({
        id: node.name,
        positions: parseCells(getRaw(node, 'key-positions')).map(Number).filter((n) => !Number.isNaN(n)),
        binding: parseBindings(getRaw(node, 'bindings'))[0] ?? { behavior: 'none', params: [] },
        layers: parseCells(getRaw(node, 'layers')),
        timeoutMs: int(getRaw(node, 'timeout-ms')),
        requirePriorIdleMs: int(getRaw(node, 'require-prior-idle-ms')),
        slowRelease: getRaw(node, 'slow-release') === null,
      })
    }
  }
  return out
}

function comboNode(file: DtsFile, id: string): DtsNode | undefined {
  for (const c of findByCompatible(file, 'zmk,combos')) {
    const n = nodes(c.children).find((x) => x.name === id)
    if (n) return n
  }
}

export function saveCombo(file: DtsFile, combo: Combo, previousId?: string): string {
  let node = comboNode(file, previousId ?? combo.id)
  if (!node) {
    const container = ensureContainer(file, 'combos', 'zmk,combos')
    const id = nodeName(combo.id.startsWith('combo_') ? combo.id : 'combo_' + combo.id, new Set(nodes(container.children).map((n) => n.name)))
    // Match the style of existing combos (one-liners in Sam's keymap).
    const inline = nodes(container.children).some((n) => n.inline)
    node = { kind: 'node', labels: [], name: id, children: [], leading: [], tail: [], inline }
    container.children.push(node)
  } else if (combo.id !== node.name) {
    node.name = nodeName(combo.id, new Set(getCombos(file).filter((c) => c.id !== previousId).map((c) => c.id)))
  }
  setProp(node, 'key-positions', `<${combo.positions.join(' ')}>`)
  setProp(node, 'bindings', `<${formatBinding(combo.binding)}>`)
  setProp(node, 'layers', combo.layers.length ? `<${combo.layers.join(' ')}>` : undefined)
  setProp(node, 'timeout-ms', combo.timeoutMs !== undefined ? `<${combo.timeoutMs}>` : undefined)
  setProp(node, 'require-prior-idle-ms', combo.requirePriorIdleMs !== undefined ? `<${combo.requirePriorIdleMs}>` : undefined)
  setProp(node, 'slow-release', combo.slowRelease ? null : undefined)
  return node.name
}

export function deleteCombo(file: DtsFile, id: string) {
  for (const c of findByCompatible(file, 'zmk,combos')) {
    const i = c.children.findIndex((x) => x.kind === 'node' && x.name === id)
    if (i >= 0) c.children.splice(i, 1)
  }
}

// ---------------------------------------------------------------------------
// Macros

export type MacroMode = 'tap' | 'press' | 'release'

export type MacroStep =
  | { kind: 'binding'; mode: MacroMode; binding: Binding }
  | { kind: 'wait'; ms: number }
  | { kind: 'tap-time'; ms: number }
  | { kind: 'pause-for-release' }
  | { kind: 'param'; code: string }

export interface Macro {
  label: string
  nodeName: string
  name: string
  bindingCells: number
  waitMs?: number
  tapMs?: number
  steps: MacroStep[]
}

const MODE_BEHAVIOR: Record<MacroMode, string> = { tap: 'macro_tap', press: 'macro_press', release: 'macro_release' }
const COMPAT_BY_CELLS = ['zmk,behavior-macro', 'zmk,behavior-macro-one-param', 'zmk,behavior-macro-two-param']

export function macroSteps(bindings: Binding[]): MacroStep[] {
  const steps: MacroStep[] = []
  let mode: MacroMode = 'tap'
  for (const b of bindings) {
    switch (b.behavior) {
      case 'macro_tap': mode = 'tap'; break
      case 'macro_press': mode = 'press'; break
      case 'macro_release': mode = 'release'; break
      case 'macro_wait_time': steps.push({ kind: 'wait', ms: Number(b.params[0] ?? 0) }); break
      case 'macro_tap_time': steps.push({ kind: 'tap-time', ms: Number(b.params[0] ?? 0) }); break
      case 'macro_pause_for_release': steps.push({ kind: 'pause-for-release' }); break
      default:
        if (b.behavior.startsWith('macro_param_')) steps.push({ kind: 'param', code: b.behavior })
        else steps.push({ kind: 'binding', mode, binding: b })
    }
  }
  return steps
}

/** Serialise steps back into ZMK macro bindings, switching modes only when needed. */
export function macroBindingsRaw(steps: MacroStep[]): string {
  const groups: string[][] = []
  let mode: MacroMode | null = null
  let current: string[] | null = null
  const flush = () => { if (current?.length) groups.push(current); current = null }
  for (const s of steps) {
    if (s.kind === 'binding') {
      if (s.mode !== mode || !current) {
        flush()
        current = ['&' + MODE_BEHAVIOR[s.mode]]
        mode = s.mode
      }
      current.push(formatBinding(s.binding))
    } else {
      flush()
      if (s.kind === 'wait') groups.push([`&macro_wait_time ${s.ms}`])
      else if (s.kind === 'tap-time') groups.push([`&macro_tap_time ${s.ms}`])
      else if (s.kind === 'pause-for-release') groups.push(['&macro_pause_for_release'])
      else groups.push(['&' + s.code])
      // A param step applies to the next binding, which keeps the current mode.
      if (s.kind !== 'param') mode = mode ?? null
    }
  }
  flush()
  if (groups.length <= 3) return groups.map((g) => `<${g.join(' ')}>`).join(', ')
  return groups.map((g) => `<${g.join(' ')}>`).join('\n                , ')
}

export function getMacros(file: DtsFile): Macro[] {
  const out: Macro[] = []
  walkNodes(file.items, (node) => {
    const compatible = parseString(getRaw(node, 'compatible'))
    if (!compatible || !COMPAT_BY_CELLS.includes(compatible) || !node.labels.length) return
    out.push({
      label: node.labels[0],
      nodeName: node.name,
      name: parseString(getRaw(node, 'display-name')) ?? parseString(getRaw(node, 'label')) ?? node.labels[0].replace(/_/g, ' '),
      bindingCells: COMPAT_BY_CELLS.indexOf(compatible),
      waitMs: int(getRaw(node, 'wait-ms')),
      tapMs: int(getRaw(node, 'tap-ms')),
      steps: macroSteps(parseBindings(getRaw(node, 'bindings'))),
    })
  })
  return out
}

export function saveMacro(file: DtsFile, macro: Macro, previousLabel?: string): string {
  let node: DtsNode | undefined
  walkNodes(file.items, (n) => { if (!node && n.labels.includes(previousLabel ?? macro.label)) node = n })
  if (!node) {
    const container = ensureContainer(file, 'macros')
    const label = nodeName(macro.label, allLabels(file))
    node = { kind: 'node', labels: [label], name: label, children: [], leading: [], tail: [] }
    container.children.push(node)
  } else if (macro.label !== node.labels[0]) {
    // Renaming the label means updating every reference to it.
    const old = node.labels[0]
    const label = nodeName(macro.label, allLabels(file))
    node.labels[0] = label
    renameBehaviorReferences(file, old, label)
  }
  setProp(node, 'compatible', quote(COMPAT_BY_CELLS[macro.bindingCells] ?? COMPAT_BY_CELLS[0]))
  setProp(node, '#binding-cells', `<${macro.bindingCells}>`)
  setProp(node, 'display-name', macro.name && macro.name !== node.labels[0].replace(/_/g, ' ') ? quote(macro.name) : undefined)
  setProp(node, 'wait-ms', macro.waitMs !== undefined ? `<${macro.waitMs}>` : undefined)
  setProp(node, 'tap-ms', macro.tapMs !== undefined ? `<${macro.tapMs}>` : undefined)
  setProp(node, 'bindings', macroBindingsRaw(macro.steps))
  // Keep compatible/#binding-cells first, bindings last, like the ZMK docs.
  const order = ['compatible', '#binding-cells', 'display-name', 'wait-ms', 'tap-ms', 'bindings']
  node.children.sort((a, b) => {
    const ia = a.kind === 'prop' ? order.indexOf(a.name) : 99
    const ib = b.kind === 'prop' ? order.indexOf(b.name) : 99
    return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib)
  })
  return node.labels[0]
}

/** Characters → `&kp` bindings, for "type this text" macros. */
export function textToMacroSteps(text: string): { steps: MacroStep[]; unsupported: string[] } {
  const steps: MacroStep[] = []
  const unsupported: string[] = []
  const byLabel = new Map<string, string>()
  const byShifted = new Map<string, string>()
  for (const k of KEYCODES) {
    if (k.category === 'Numpad') continue
    if (k.label.length === 1 && !byLabel.has(k.label)) byLabel.set(k.label, k.code)
    if (k.shifted && !byShifted.has(k.shifted)) byShifted.set(k.shifted, k.code)
  }
  for (const ch of text) {
    let key: string | undefined
    if (/[a-z]/.test(ch)) key = ch.toUpperCase()
    else if (/[A-Z]/.test(ch)) key = `LS(${ch})`
    else if (/[0-9]/.test(ch)) key = 'N' + ch
    else if (ch === ' ') key = 'SPACE'
    else if (ch === '\n') key = 'RET'
    else if (ch === '\t') key = 'TAB'
    else if (byShifted.has(ch) && findKeycode(byShifted.get(ch)!)?.shifted === ch) key = `LS(${byShifted.get(ch)})`
    else if (byLabel.has(ch)) key = byLabel.get(ch)
    if (key) steps.push({ kind: 'binding', mode: 'tap', binding: { behavior: 'kp', params: [key] } })
    else unsupported.push(ch)
  }
  return { steps, unsupported }
}

export function deleteBehaviorNode(file: DtsFile, label: string) {
  const strip = (items: DtsFile['items']) => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.kind !== 'node') continue
      if (it.labels.includes(label)) items.splice(i, 1)
      else strip(it.children)
    }
  }
  strip(file.items)
}

/** Rewrite `&old` to `&new` in every bindings-like property. */
export function renameBehaviorReferences(file: DtsFile, from: string, to: string) {
  const re = new RegExp(`&${from}(?![\\w-])`, 'g')
  walkNodes(file.items, (node) => {
    for (const c of node.children) {
      if (c.kind === 'prop' && c.raw && re.test(c.raw)) {
        c.raw = c.raw.replace(re, '&' + to)
        delete c.valueSpan
      }
      re.lastIndex = 0
    }
  })
}

/** How many times a behaviour is referenced (anywhere a `&label` appears). */
export function behaviorUsage(file: DtsFile, label: string): number {
  let count = 0
  const re = new RegExp(`&${label}(?![\\w-])`, 'g')
  walkNodes(file.items, (node) => {
    for (const c of node.children) if (c.kind === 'prop' && c.raw) count += (c.raw.match(re) ?? []).length
  })
  return count
}

// ---------------------------------------------------------------------------
// Behaviour property schemas (for the behaviour editor and global overrides)

export type PropType = 'int' | 'bool' | 'enum' | 'positions' | 'keycodes' | 'mods' | 'string' | 'behaviors' | 'bindings' | 'layers'

export interface PropSchema {
  name: string
  type: PropType
  label: string
  description: string
  unit?: string
  options?: string[]
  default?: string | number | boolean
  min?: number
  max?: number
}

const HOLD_TAP: PropSchema[] = [
  { name: 'flavor', type: 'enum', label: 'Flavour', options: ['hold-preferred', 'balanced', 'tap-preferred', 'tap-unless-interrupted'], default: 'hold-preferred',
    description: 'How the key decides between hold and tap when another key is pressed before the tapping term ends. "balanced" holds only if the other key is pressed and released while this one is held; "tap-preferred" only holds after the tapping term.' },
  { name: 'tapping-term-ms', type: 'int', label: 'Tapping term', unit: 'ms', min: 50, max: 1000, default: 200, description: 'How long the key must be held before it counts as held.' },
  { name: 'quick-tap-ms', type: 'int', label: 'Quick tap', unit: 'ms', min: 0, max: 1000, default: 0, description: 'If the key is tapped and then pressed again within this time, the second press repeats the tap (lets you hold a tapped key for key repeat).' },
  { name: 'require-prior-idle-ms', type: 'int', label: 'Require prior idle', unit: 'ms', min: 0, max: 1000, default: 0, description: 'If another key was pressed within this time before this one, it always taps. Stops accidental home-row mods while typing fast (Oryx: Tap flow).' },
  { name: 'hold-trigger-key-positions', type: 'positions', label: 'Hold-trigger positions', description: 'Only keys at these positions can make this key resolve as a hold before the tapping term ends. Set to the opposite hand (plus thumbs) for "positional" home-row mods (Oryx: Chordal hold).' },
  { name: 'hold-trigger-on-release', type: 'bool', label: 'Hold-trigger on release', default: false, description: 'Decide hold-trigger positions when the other key is released, not pressed. Lets you use same-hand mods with combos of keys.' },
  { name: 'retro-tap', type: 'bool', label: 'Retro tap', default: false, description: 'If the key is held past the tapping term and released with no other key pressed, send the tap anyway (Oryx: Retro tapping).' },
  { name: 'hold-while-undecided', type: 'bool', label: 'Hold while undecided', default: false, description: 'Press the hold behaviour immediately, release it if the key turns out to be a tap. Useful for mods with a mouse.' },
  { name: 'hold-while-undecided-linger', type: 'bool', label: 'Linger', default: false, description: 'With "hold while undecided", keep the hold pressed until after the tap is sent.' },
]

export const BEHAVIOR_SCHEMAS: Record<string, PropSchema[]> = {
  'zmk,behavior-hold-tap': HOLD_TAP,
  'zmk,behavior-tap-dance': [
    { name: 'tapping-term-ms', type: 'int', label: 'Tapping term', unit: 'ms', min: 50, max: 1000, default: 200, description: 'Time allowed between taps to count towards the dance.' },
  ],
  'zmk,behavior-mod-morph': [
    { name: 'mods', type: 'mods', label: 'Trigger modifiers', description: 'Holding any of these sends the second binding instead of the first.' },
    { name: 'keep-mods', type: 'mods', label: 'Keep modifiers', description: 'Trigger modifiers that stay applied to the morphed binding (by default they are removed).' },
  ],
  'zmk,behavior-sticky-key': [
    { name: 'release-after-ms', type: 'int', label: 'Release after', unit: 'ms', min: 100, max: 10000, default: 1000, description: 'Give up waiting for the next key after this long.' },
    { name: 'quick-release', type: 'bool', label: 'Quick release', default: false, description: 'Release as soon as the next key is pressed (instead of released).' },
    { name: 'lazy', type: 'bool', label: 'Lazy', default: false, description: 'Do not press the key until the next key is pressed.' },
    { name: 'ignore-modifiers', type: 'bool', label: 'Ignore modifiers', default: true, description: 'Pressing a modifier does not consume the sticky key, so sticky mods can be stacked.' },
  ],
  'zmk,behavior-caps-word': [
    { name: 'continue-list', type: 'keycodes', label: 'Continue list', description: 'Keys that keep caps word active (letters always do). Default: UNDERSCORE BACKSPACE DELETE.' },
    { name: 'mods', type: 'mods', label: 'Modifiers applied', description: 'Modifiers applied to letters (default Left Shift).' },
  ],
  'zmk,behavior-key-repeat': [
    { name: 'usage-pages', type: 'string', label: 'Usage pages', description: 'Which HID usage pages are repeated: <HID_USAGE_KEY> by default, add HID_USAGE_CONSUMER to repeat media keys.' },
  ],
  'zmk,behavior-input-two-axis': [
    { name: 'time-to-max-speed-ms', type: 'int', label: 'Time to max speed', unit: 'ms', min: 0, max: 5000, default: 300, description: 'How long movement takes to accelerate to full speed.' },
    { name: 'acceleration-exponent', type: 'int', label: 'Acceleration exponent', min: 0, max: 5, default: 1, description: '0 = constant speed, 1 = linear acceleration, 2 = quadratic...' },
    { name: 'delay-ms', type: 'int', label: 'Delay', unit: 'ms', min: 0, max: 1000, default: 0, description: 'Wait this long before moving.' },
  ],
}

/** Compatibles of built-in behaviours, for editing global overrides like `&lt { ... }`. */
export const BUILTIN_COMPATIBLES: Record<string, string> = {
  lt: 'zmk,behavior-hold-tap', mt: 'zmk,behavior-hold-tap', sk: 'zmk,behavior-sticky-key', sl: 'zmk,behavior-sticky-key',
  caps_word: 'zmk,behavior-caps-word', key_repeat: 'zmk,behavior-key-repeat', mmv: 'zmk,behavior-input-two-axis', msc: 'zmk,behavior-input-two-axis',
  gresc: 'zmk,behavior-mod-morph',
}

/** Defaults ZMK uses for built-in behaviours (so the UI can show what an override changes). */
export const BUILTIN_DEFAULTS: Record<string, Record<string, string | number | boolean>> = {
  mt: { flavor: 'hold-preferred', 'tapping-term-ms': 200, 'quick-tap-ms': 0 },
  lt: { flavor: 'tap-preferred', 'tapping-term-ms': 200, 'quick-tap-ms': 0 },
  sk: { 'release-after-ms': 1000, 'ignore-modifiers': true },
  sl: { 'release-after-ms': 1000 },
  mmv: { 'time-to-max-speed-ms': 300, 'acceleration-exponent': 1 },
  msc: { 'time-to-max-speed-ms': 300, 'acceleration-exponent': 0 },
}

/** Get or create the `&label { ... }` override node for a built-in behaviour. */
export function overrideNode(file: DtsFile, label: string, create: boolean): DtsNode | undefined {
  const existing = nodes(file.items).find((n) => n.name === '&' + label)
  if (existing || !create) return existing
  const node: DtsNode = { kind: 'node', labels: [], name: '&' + label, children: [], leading: [''], tail: [] }
  // Overrides go before the first `/ { }` block.
  const firstRoot = file.items.findIndex((i) => i.kind === 'node')
  file.items.splice(firstRoot < 0 ? file.items.length : firstRoot, 0, node)
  return node
}

export function cleanupEmptyOverride(file: DtsFile, label: string) {
  const i = file.items.findIndex((n) => n.kind === 'node' && n.name === '&' + label && n.children.length === 0)
  if (i >= 0) file.items.splice(i, 1)
}

/** Read a property value in a form the UI can bind to. */
export function readPropValue(node: DtsNode | undefined, s: PropSchema): string | number | boolean | number[] | string[] | undefined {
  if (!node) return undefined
  const raw = getRaw(node, s.name)
  if (raw === undefined) return undefined
  switch (s.type) {
    case 'bool': return true
    case 'int': return int(raw)
    case 'enum':
    case 'string': return parseString(raw) ?? raw ?? undefined
    case 'positions': return parseCells(raw).map(Number)
    case 'keycodes': case 'layers': return parseCells(raw)
    case 'mods': return (parseCells(raw)[0] ?? '').replace(/[()]/g, '').split('|').map((x) => x.trim()).filter(Boolean)
    default: return raw ?? undefined
  }
}

export function writePropValue(node: DtsNode, s: PropSchema, value: unknown) {
  if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0 && s.type !== 'positions')) {
    setProp(node, s.name, undefined)
    return
  }
  switch (s.type) {
    case 'bool': setProp(node, s.name, value ? null : undefined); break
    case 'int': setProp(node, s.name, `<${Number(value)}>`); break
    case 'enum': setProp(node, s.name, quote(String(value))); break
    case 'string': setProp(node, s.name, String(value)); break
    case 'positions': case 'keycodes': case 'layers': setProp(node, s.name, `<${(value as unknown[]).join(' ')}>`); break
    case 'mods': {
      const mods = value as string[]
      setProp(node, s.name, mods.length === 1 ? `<${mods[0]}>` : `<(${mods.join('|')})>`)
      break
    }
    default: setProp(node, s.name, String(value))
  }
}

export const MOD_FLAGS = ['MOD_LCTL', 'MOD_LSFT', 'MOD_LALT', 'MOD_LGUI', 'MOD_RCTL', 'MOD_RSFT', 'MOD_RALT', 'MOD_RGUI']

// ---------------------------------------------------------------------------
// Creating behaviours

export function createHoldTap(file: DtsFile, label: string, holdBehavior: string, tapBehavior: string, props: Record<string, string | null>, comment?: string): string {
  const container = ensureContainer(file, 'behaviors')
  const id = nodeName(label, allLabels(file))
  const node: DtsNode = { kind: 'node', labels: [id], name: id, children: [], leading: comment ? [`// ${comment}`] : [], tail: [] }
  setProp(node, 'compatible', quote('zmk,behavior-hold-tap'))
  setProp(node, '#binding-cells', '<2>')
  setProp(node, 'bindings', `<&${holdBehavior}>, <&${tapBehavior}>`)
  for (const [k, v] of Object.entries(props)) setProp(node, k, v)
  container.children.push(node)
  return id
}

export function createTapDance(file: DtsFile, label: string, bindings: Binding[], tappingTerm?: number, comment?: string): string {
  const container = ensureContainer(file, 'behaviors')
  const id = nodeName(label, allLabels(file))
  const node: DtsNode = { kind: 'node', labels: [id], name: id, children: [], leading: comment ? [`// ${comment}`] : [], tail: [] }
  setProp(node, 'compatible', quote('zmk,behavior-tap-dance'))
  setProp(node, '#binding-cells', '<0>')
  if (tappingTerm) setProp(node, 'tapping-term-ms', `<${tappingTerm}>`)
  setProp(node, 'bindings', formatBindingGroups(bindings))
  container.children.push(node)
  return id
}

export function createModMorph(file: DtsFile, label: string, normal: Binding, morphed: Binding, mods: string[], comment?: string): string {
  const container = ensureContainer(file, 'behaviors')
  const id = nodeName(label, allLabels(file))
  const node: DtsNode = { kind: 'node', labels: [id], name: id, children: [], leading: comment ? [`// ${comment}`] : [], tail: [] }
  setProp(node, 'compatible', quote('zmk,behavior-mod-morph'))
  setProp(node, '#binding-cells', '<0>')
  setProp(node, 'bindings', formatBindingGroups([normal, morphed]))
  setProp(node, 'mods', mods.length === 1 ? `<${mods[0]}>` : `<(${mods.join('|')})>`)
  container.children.push(node)
  return id
}

export function behaviorNode(file: DtsFile, label: string): DtsNode | undefined {
  let found: DtsNode | undefined
  walkNodes(file.items, (n) => { if (!found && n.labels.includes(label) && parseString(getRaw(n, 'compatible'))?.startsWith('zmk,behavior-')) found = n })
  return found
}

// ---------------------------------------------------------------------------
// Conditional layers (tri-layer)

export interface ConditionalLayer { id: string; ifLayers: string[]; thenLayer: string }

export function getConditionalLayers(file: DtsFile): ConditionalLayer[] {
  return findByCompatible(file, 'zmk,conditional-layers').flatMap((c) => nodes(c.children).map((n) => ({
    id: n.name,
    ifLayers: parseCells(getRaw(n, 'if-layers')),
    thenLayer: parseCells(getRaw(n, 'then-layer'))[0] ?? '',
  })))
}

export function saveConditionalLayers(file: DtsFile, list: ConditionalLayer[]) {
  let container = findByCompatible(file, 'zmk,conditional-layers')[0]
  if (!container && list.length === 0) return
  if (!container) container = ensureContainer(file, 'conditional_layers', 'zmk,conditional-layers')
  container.children = container.children.filter((c) => c.kind !== 'node')
  const taken = new Set<string>()
  for (const c of list) {
    const id = nodeName(c.id || 'tri_layer', taken)
    taken.add(id)
    const node: DtsNode = { kind: 'node', labels: [], name: id, children: [], leading: [], tail: [] }
    setProp(node, 'if-layers', `<${c.ifLayers.join(' ')}>`)
    setProp(node, 'then-layer', `<${c.thenLayer}>`)
    container.children.push(node)
  }
}
