import { getRaw, parseCells, parseString, splitCellGroups, tokenizeCells, walkNodes, type DtsFile, type DtsNode } from './dts.ts'

/**
 * What kind of value a binding parameter holds. Drives which picker the UI shows.
 * `command` parameters choose from the behaviour's `commands` list; a command may
 * take further parameters (`BT_SEL 2`).
 */
export type ParamType =
  | 'keycode' | 'mod' | 'layer' | 'int' | 'command'
  | 'mouse-button' | 'mouse-move' | 'scroll' | 'any'

export interface Command {
  code: string
  label: string
  description?: string
  /** Extra parameters following the command token. */
  extra?: { name: string; type: ParamType; min?: number; max?: number }[]
}

export type BehaviorKind =
  | 'key' | 'hold-tap' | 'tap-dance' | 'mod-morph' | 'macro' | 'sticky' | 'layer' | 'command' | 'mouse'
  | 'special' | 'caps-word' | 'repeat' | 'other'

export interface BehaviorDef {
  /** Label without `&`, e.g. `kp`. */
  id: string
  name: string
  description: string
  kind: BehaviorKind
  category: BehaviorCategory
  params: { name: string; type: ParamType }[]
  commands?: Command[]
  /** Headers needed for the parameter constants this behaviour uses. */
  includes?: string[]
  builtin: boolean
  /** For hold-taps: the behaviour each parameter is passed to ([hold, tap]). */
  holdTapBindings?: [string, string]
  /** For custom behaviours: the DT node that defines it. */
  nodeName?: string
  compatible?: string
  /** #binding-cells declared by the node (custom behaviours). */
  bindingCells?: number
  /** Can a hold-tap or tap-dance pass parameters through to this? */
  docs?: string
}

export type BehaviorCategory =
  | 'Keys' | 'Layers' | 'Mouse' | 'Bluetooth & output' | 'Lighting & power' | 'Firmware' | 'Special'
  | 'Hold-taps' | 'Tap dances' | 'Mod-morphs' | 'Macros' | 'Other behaviours'

const DOCS = 'https://zmk.dev/docs/keymaps/behaviors/'

const BT_COMMANDS: Command[] = [
  { code: 'BT_SEL', label: 'Select profile', description: 'Switch to a Bluetooth profile (0-based).', extra: [{ name: 'profile', type: 'int', min: 0, max: 4 }] },
  { code: 'BT_NXT', label: 'Next profile' },
  { code: 'BT_PRV', label: 'Previous profile' },
  { code: 'BT_CLR', label: 'Clear profile', description: 'Forget the host paired to the current profile.' },
  { code: 'BT_CLR_ALL', label: 'Clear all profiles' },
  { code: 'BT_DISC', label: 'Disconnect profile', extra: [{ name: 'profile', type: 'int', min: 0, max: 4 }] },
]

const OUT_COMMANDS: Command[] = [
  { code: 'OUT_USB', label: 'USB', description: 'Send keys over USB.' },
  { code: 'OUT_BLE', label: 'Bluetooth', description: 'Send keys over Bluetooth.' },
  { code: 'OUT_TOG', label: 'Toggle USB/BLE' },
]

const RGB_COMMANDS: Command[] = [
  { code: 'RGB_TOG', label: 'Toggle' }, { code: 'RGB_ON', label: 'On' }, { code: 'RGB_OFF', label: 'Off' },
  { code: 'RGB_HUI', label: 'Hue +' }, { code: 'RGB_HUD', label: 'Hue −' },
  { code: 'RGB_SAI', label: 'Saturation +' }, { code: 'RGB_SAD', label: 'Saturation −' },
  { code: 'RGB_BRI', label: 'Brightness +' }, { code: 'RGB_BRD', label: 'Brightness −' },
  { code: 'RGB_SPI', label: 'Speed +' }, { code: 'RGB_SPD', label: 'Speed −' },
  { code: 'RGB_EFF', label: 'Next effect' }, { code: 'RGB_EFR', label: 'Previous effect' },
  { code: 'RGB_COLOR_HSB', label: 'Set colour', description: 'Set hue (0-359), saturation and brightness (0-100).', extra: [{ name: 'hue', type: 'int', min: 0, max: 359 }, { name: 'saturation', type: 'int', min: 0, max: 100 }, { name: 'brightness', type: 'int', min: 0, max: 100 }] },
]

const BL_COMMANDS: Command[] = [
  { code: 'BL_TOG', label: 'Toggle' }, { code: 'BL_ON', label: 'On' }, { code: 'BL_OFF', label: 'Off' },
  { code: 'BL_INC', label: 'Brighter' }, { code: 'BL_DEC', label: 'Dimmer' }, { code: 'BL_CYCLE', label: 'Cycle' },
  { code: 'BL_SET', label: 'Set brightness', extra: [{ name: 'brightness', type: 'int', min: 0, max: 100 }] },
]

const EP_COMMANDS: Command[] = [
  { code: 'EP_TOG', label: 'Toggle' }, { code: 'EP_ON', label: 'On' }, { code: 'EP_OFF', label: 'Off' },
]

const p = (name: string, type: ParamType) => ({ name, type })

export const BUILTIN_BEHAVIORS: BehaviorDef[] = [
  { id: 'kp', name: 'Key press', kind: 'key', category: 'Keys', description: 'Send a key, optionally with modifiers.', params: [p('key', 'keycode')], builtin: true, docs: DOCS + 'key-press' },
  { id: 'kt', name: 'Key toggle', kind: 'key', category: 'Keys', description: 'Press a key and keep it held until tapped again.', params: [p('key', 'keycode')], builtin: true, docs: DOCS + 'key-toggle' },
  { id: 'mt', name: 'Mod-tap', kind: 'hold-tap', category: 'Hold-taps', description: 'Modifier when held, key when tapped.', params: [p('hold', 'mod'), p('tap', 'keycode')], holdTapBindings: ['kp', 'kp'], builtin: true, docs: DOCS + 'mod-tap' },
  { id: 'lt', name: 'Layer-tap', kind: 'hold-tap', category: 'Hold-taps', description: 'Layer while held, key when tapped.', params: [p('layer', 'layer'), p('tap', 'keycode')], holdTapBindings: ['mo', 'kp'], builtin: true, docs: DOCS + 'layers#layer-tap' },
  { id: 'sk', name: 'Sticky key', kind: 'sticky', category: 'Keys', description: 'One-shot key: applies to the next key press only.', params: [p('key', 'keycode')], builtin: true, docs: DOCS + 'sticky-key' },
  { id: 'mo', name: 'Momentary layer', kind: 'layer', category: 'Layers', description: 'Layer is active while the key is held.', params: [p('layer', 'layer')], builtin: true, docs: DOCS + 'layers#momentary-layer' },
  { id: 'to', name: 'To layer', kind: 'layer', category: 'Layers', description: 'Switch to this layer and turn off the others (except base).', params: [p('layer', 'layer')], builtin: true, docs: DOCS + 'layers#to-layer' },
  { id: 'tog', name: 'Toggle layer', kind: 'layer', category: 'Layers', description: 'Turn the layer on or off.', params: [p('layer', 'layer')], builtin: true, docs: DOCS + 'layers#toggle-layer' },
  { id: 'sl', name: 'Sticky layer', kind: 'layer', category: 'Layers', description: 'Layer is active for the next key press only.', params: [p('layer', 'layer')], builtin: true, docs: DOCS + 'sticky-layer' },
  { id: 'trans', name: 'Transparent', kind: 'special', category: 'Special', description: 'Use the binding from the next active layer below.', params: [], builtin: true, docs: DOCS + 'misc#transparent' },
  { id: 'none', name: 'None', kind: 'special', category: 'Special', description: 'Do nothing (blocks lower layers).', params: [], builtin: true, docs: DOCS + 'misc#none' },
  { id: 'caps_word', name: 'Caps word', kind: 'caps-word', category: 'Special', description: 'Capitalise letters until a non-word key is pressed.', params: [], builtin: true, docs: DOCS + 'caps-word' },
  { id: 'key_repeat', name: 'Key repeat', kind: 'repeat', category: 'Special', description: 'Send the last key again.', params: [], builtin: true, docs: DOCS + 'key-repeat' },
  { id: 'gresc', name: 'Grave escape', kind: 'special', category: 'Special', description: 'Escape, or ` when Shift or Gui is held.', params: [], builtin: true, docs: DOCS + 'mod-morph#grave-escape' },
  { id: 'mkp', name: 'Mouse button', kind: 'mouse', category: 'Mouse', description: 'Click a mouse button.', params: [p('button', 'mouse-button')], includes: ['#include <dt-bindings/zmk/pointing.h>'], builtin: true, docs: DOCS + 'mouse-emulation' },
  { id: 'mmv', name: 'Mouse move', kind: 'mouse', category: 'Mouse', description: 'Move the pointer while held.', params: [p('direction', 'mouse-move')], includes: ['#include <dt-bindings/zmk/pointing.h>'], builtin: true, docs: DOCS + 'mouse-emulation' },
  { id: 'msc', name: 'Mouse scroll', kind: 'mouse', category: 'Mouse', description: 'Scroll while held.', params: [p('direction', 'scroll')], includes: ['#include <dt-bindings/zmk/pointing.h>'], builtin: true, docs: DOCS + 'mouse-emulation' },
  { id: 'bt', name: 'Bluetooth', kind: 'command', category: 'Bluetooth & output', description: 'Bluetooth profiles and pairing.', params: [p('command', 'command')], commands: BT_COMMANDS, includes: ['#include <dt-bindings/zmk/bt.h>'], builtin: true, docs: DOCS + 'bluetooth' },
  { id: 'out', name: 'Output', kind: 'command', category: 'Bluetooth & output', description: 'Choose USB or Bluetooth output.', params: [p('command', 'command')], commands: OUT_COMMANDS, includes: ['#include <dt-bindings/zmk/outputs.h>'], builtin: true, docs: DOCS + 'outputs' },
  { id: 'rgb_ug', name: 'RGB underglow', kind: 'command', category: 'Lighting & power', description: 'Control the underglow LEDs.', params: [p('command', 'command')], commands: RGB_COMMANDS, includes: ['#include <dt-bindings/zmk/rgb.h>'], builtin: true, docs: DOCS + 'underglow' },
  { id: 'bl', name: 'Backlight', kind: 'command', category: 'Lighting & power', description: 'Control the key backlight.', params: [p('command', 'command')], commands: BL_COMMANDS, includes: ['#include <dt-bindings/zmk/backlight.h>'], builtin: true, docs: DOCS + 'backlight' },
  { id: 'ext_power', name: 'External power', kind: 'command', category: 'Lighting & power', description: 'Switch power to LEDs and other peripherals.', params: [p('command', 'command')], commands: EP_COMMANDS, includes: ['#include <dt-bindings/zmk/ext_power.h>'], builtin: true, docs: DOCS + 'power' },
  { id: 'bootloader', name: 'Bootloader', kind: 'special', category: 'Firmware', description: 'Restart this half into the bootloader for flashing.', params: [], builtin: true, docs: DOCS + 'reset' },
  { id: 'sys_reset', name: 'Reset', kind: 'special', category: 'Firmware', description: 'Restart this half.', params: [], builtin: true, docs: DOCS + 'reset' },
  { id: 'soft_off', name: 'Soft off', kind: 'special', category: 'Firmware', description: 'Turn the keyboard off (needs a wake key configured).', params: [], builtin: true, docs: DOCS + 'soft-off' },
  { id: 'studio_unlock', name: 'Studio unlock', kind: 'special', category: 'Firmware', description: 'Unlock ZMK Studio editing.', params: [], builtin: true, docs: 'https://zmk.dev/docs/features/studio' },
]

export const MOUSE_BUTTONS = [
  { code: 'LCLK', label: 'Left click' }, { code: 'RCLK', label: 'Right click' }, { code: 'MCLK', label: 'Middle click' },
  { code: 'MB4', label: 'Back (MB4)' }, { code: 'MB5', label: 'Forward (MB5)' },
]
export const MOUSE_MOVES = [
  { code: 'MOVE_UP', label: 'Up' }, { code: 'MOVE_DOWN', label: 'Down' }, { code: 'MOVE_LEFT', label: 'Left' }, { code: 'MOVE_RIGHT', label: 'Right' },
]
export const SCROLLS = [
  { code: 'SCRL_UP', label: 'Up' }, { code: 'SCRL_DOWN', label: 'Down' }, { code: 'SCRL_LEFT', label: 'Left' }, { code: 'SCRL_RIGHT', label: 'Right' },
]

/** Parameter types of a behaviour used inside a hold-tap's `bindings`. */
function firstParamType(def: BehaviorDef | undefined): ParamType {
  if (!def) return 'any'
  if (def.id === 'kp' || def.kind === 'key' || def.kind === 'sticky') return 'keycode'
  return def.params[0]?.type ?? 'any'
}

const KIND_BY_COMPATIBLE: Record<string, { kind: BehaviorKind; category: BehaviorCategory; name: string }> = {
  'zmk,behavior-hold-tap': { kind: 'hold-tap', category: 'Hold-taps', name: 'Hold-tap' },
  'zmk,behavior-tap-dance': { kind: 'tap-dance', category: 'Tap dances', name: 'Tap dance' },
  'zmk,behavior-mod-morph': { kind: 'mod-morph', category: 'Mod-morphs', name: 'Mod-morph' },
  'zmk,behavior-macro': { kind: 'macro', category: 'Macros', name: 'Macro' },
  'zmk,behavior-macro-one-param': { kind: 'macro', category: 'Macros', name: 'Macro (1 parameter)' },
  'zmk,behavior-macro-two-param': { kind: 'macro', category: 'Macros', name: 'Macro (2 parameters)' },
  'zmk,behavior-sticky-key': { kind: 'sticky', category: 'Keys', name: 'Sticky key' },
  'zmk,behavior-caps-word': { kind: 'caps-word', category: 'Special', name: 'Caps word' },
  'zmk,behavior-key-repeat': { kind: 'repeat', category: 'Special', name: 'Key repeat' },
}

/** Behaviours defined in the keymap itself (`behaviors { ... }`, `macros { ... }`, anywhere with a label). */
export function customBehaviors(file: DtsFile, builtins: Map<string, BehaviorDef>): BehaviorDef[] {
  const out: BehaviorDef[] = []
  walkNodes(file.items, (node) => {
    const compatible = parseString(getRaw(node, 'compatible'))
    if (!compatible?.startsWith('zmk,behavior-') || node.labels.length === 0) return
    const id = node.labels[0]
    const info = KIND_BY_COMPATIBLE[compatible] ?? { kind: 'other' as BehaviorKind, category: 'Other behaviours' as BehaviorCategory, name: compatible.replace('zmk,behavior-', '') }
    const cells = Number(parseCells(getRaw(node, '#binding-cells'))[0] ?? 0)
    const def: BehaviorDef = {
      id, name: humanise(node, id), description: info.name, kind: info.kind, category: info.category,
      params: [], builtin: false, nodeName: node.name, compatible, bindingCells: cells,
    }
    if (info.kind === 'hold-tap') {
      const inner = splitCellGroups(getRaw(node, 'bindings') ?? '').map((g) => tokenizeCells(g)[0]?.replace(/^&/, '') ?? '')
      const hold = inner[0] ?? 'kp'
      const tap = inner[1] ?? 'kp'
      def.holdTapBindings = [hold, tap]
      const holdDef = builtins.get(hold)
      const holdType = hold === 'kp' ? 'mod' : firstParamType(holdDef)
      def.params = [p('hold', holdType === 'keycode' ? 'mod' : holdType), p('tap', firstParamType(builtins.get(tap)))]
      // `mod` for kp-holds is a hint only: any keycode is allowed.
      if (hold === 'kp') def.params[0].type = 'keycode'
      def.description = `Hold: ${hold}, tap: ${tap}`
    } else if (info.kind === 'sticky') {
      def.params = [p('key', 'keycode')]
    } else if (cells > 0) {
      def.params = Array.from({ length: cells }, (_, i) => p(`param ${i + 1}`, 'any'))
    }
    out.push(def)
  })
  return out
}

function humanise(node: DtsNode, id: string): string {
  const display = parseString(getRaw(node, 'display-name')) ?? parseString(getRaw(node, 'label'))
  if (display) return display
  return id.replace(/_/g, ' ')
}

export interface BehaviorRegistry {
  all: BehaviorDef[]
  get(id: string): BehaviorDef | undefined
}

export function buildRegistry(file: DtsFile): BehaviorRegistry {
  const builtins = new Map(BUILTIN_BEHAVIORS.map((b) => [b.id, b]))
  const custom = customBehaviors(file, builtins)
  const map = new Map<string, BehaviorDef>(builtins)
  for (const c of custom) map.set(c.id, c)
  const all = [...map.values()]
  return { all, get: (id) => map.get(id) }
}

/**
 * Number of source tokens a binding of `def` consumes. Command behaviours vary
 * (`&bt BT_CLR` vs `&bt BT_SEL 1`), so the command is consulted.
 */
export function expectedParamCount(def: BehaviorDef, firstParam?: string): number | undefined {
  if (def.commands) {
    if (!firstParam) return 1
    const name = firstParam.replace(/\(.*$/, '')
    const cmd = def.commands.find((c) => c.code === name)
    if (!cmd) return undefined
    // RGB_COLOR_HSB(h,s,b) carries its values inside the token.
    if (firstParam.includes('(')) return 1
    return 1 + (cmd.extra?.length ?? 0)
  }
  if (!def.builtin) return def.bindingCells
  return def.params.length
}
