/**
 * Oryx-style key "steps" for ZMK.
 *
 * Oryx (ZSA's configurator) models every key as up to four actions: what happens when it
 * is tapped, held, double-tapped, and tapped-then-held, and compiles that into QMK mod-taps,
 * layer-taps and tap dances. This module does the same for ZMK:
 *
 *   tap                      → the tap binding itself              (&kp A)
 *   tap + hold               → a hold-tap behaviour                (&mt LSHFT A, &lt NAV SPC, &hml LALT A…)
 *   + double tap / tap-hold  → a tap dance whose bindings are the above
 *
 * Existing behaviours are reused where they fit, so decomposing and recomposing a key that
 * was written by hand gives back the same binding.
 */
import { buildRegistry, type BehaviorDef, type BehaviorRegistry } from './behaviors.ts'
import { getRaw, parseString, setProp, walkNodes, type DtsFile, type DtsNode } from './dts.ts'
import { createHoldTap, createTapDance, behaviorUsage, behaviorNode } from './features.ts'
import { bindingEquals, formatBindingGroups, parseBindings, type Binding } from './keymap.ts'

export interface KeySteps {
  tap?: Binding
  hold?: Binding
  doubleTap?: Binding
  tapHold?: Binding
  /** Hold-tap behaviour used for tap+hold (e.g. `mt`, `lt`, `hml`). */
  holdTap?: string
  /** Hold-tap behaviour used for double-tap+tap-hold. */
  secondHoldTap?: string
  /** Tap-dance behaviour, when there is a double tap. */
  tapDance?: string
}

export const GENERATED_MARK = 'keymap-editor: generated'

export class ComposeError extends Error {}

function takesParam(def: BehaviorDef | undefined): number {
  if (!def) return 1
  if (def.builtin) return def.params.length
  return def.bindingCells ?? 0
}

function splitHoldTap(b: Binding, def: BehaviorDef, reg: BehaviorRegistry): { hold: Binding; tap: Binding } {
  const [h, t] = def.holdTapBindings!
  const hp = takesParam(reg.get(h))
  const tp = takesParam(reg.get(t))
  return {
    hold: { behavior: h, params: hp ? [b.params[0] ?? '0'] : [] },
    tap: { behavior: t, params: tp ? [b.params[1] ?? '0'] : [] },
  }
}

function tapDanceBindings(file: DtsFile, label: string): Binding[] | undefined {
  const node = behaviorNode(file, label)
  return node ? parseBindings(getRaw(node, 'bindings')) : undefined
}

/** Break a binding into steps. Returns null when it cannot be shown as steps (e.g. a 3-tap dance). */
export function decompose(b: Binding, file: DtsFile, reg = buildRegistry(file)): KeySteps | null {
  const def = reg.get(b.behavior)
  if (def?.kind === 'hold-tap' && def.holdTapBindings) {
    const { hold, tap } = splitHoldTap(b, def, reg)
    return { tap, hold, holdTap: def.id }
  }
  if (def?.kind === 'tap-dance' && !def.builtin) {
    const inner = tapDanceBindings(file, def.id) ?? []
    if (inner.length === 0 || inner.length > 2) return null
    const first = decompose(inner[0], file, reg)
    if (!first || first.tapDance) return null
    const steps: KeySteps = { tap: first.tap, hold: first.hold, holdTap: first.holdTap, tapDance: def.id }
    if (inner[1]) {
      const second = decompose(inner[1], file, reg)
      if (!second || second.tapDance) return null
      steps.doubleTap = second.tap
      steps.tapHold = second.hold
      steps.secondHoldTap = second.holdTap
    }
    return steps
  }
  return { tap: b }
}

function holdTapCandidates(reg: BehaviorRegistry, holdBeh: string, tapBeh: string): BehaviorDef[] {
  return reg.all.filter((d) => d.kind === 'hold-tap' && d.holdTapBindings?.[0] === holdBeh && d.holdTapBindings?.[1] === tapBeh)
}

/** Hold-tap behaviours that could implement this hold+tap pair (for the UI's "behaviour" dropdown). */
export function compatibleHoldTaps(file: DtsFile, hold: Binding, tap: Binding): BehaviorDef[] {
  const reg = buildRegistry(file)
  return holdTapCandidates(reg, hold.behavior, tap.behavior)
}

function checkPassable(b: Binding, role: string, reg: BehaviorRegistry) {
  const def = reg.get(b.behavior)
  if (b.params.length > 1 || (def?.commands && b.params.length > 1)) {
    throw new ComposeError(`"${def?.name ?? b.behavior} ${b.params.join(' ')}" needs ${b.params.length} parameters, but a hold-tap can only pass one to its ${role} action. Put it in a macro and use that instead.`)
  }
}

function makeHoldTap(file: DtsFile, hold: Binding, tap: Binding, preferred: string | undefined): Binding {
  const reg = buildRegistry(file)
  checkPassable(hold, 'hold', reg)
  checkPassable(tap, 'tap', reg)
  const candidates = holdTapCandidates(reg, hold.behavior, tap.behavior)
  let chosen = candidates.find((c) => c.id === preferred)?.id
  if (!chosen) {
    if (hold.behavior === 'kp' && tap.behavior === 'kp' && candidates.some((c) => c.id === 'mt')) chosen = 'mt'
    else if (hold.behavior === 'mo' && tap.behavior === 'kp') chosen = 'lt'
    else chosen = candidates[0]?.id
  }
  if (!chosen) {
    chosen = createHoldTap(file, `ht_${hold.behavior}_${tap.behavior}`, hold.behavior, tap.behavior,
      { flavor: '"tap-preferred"', 'tapping-term-ms': '<200>' }, `${GENERATED_MARK}: hold ${hold.behavior}, tap ${tap.behavior}`)
  }
  return { behavior: chosen, params: [hold.params[0] ?? '0', tap.params[0] ?? '0'] }
}

/**
 * Turn steps back into a binding, creating hold-tap and tap-dance behaviours in `file`
 * when needed. `file` is mutated.
 */
export function compose(steps: KeySteps, file: DtsFile): Binding {
  const tap = steps.tap
  if (!tap && !steps.hold) return { behavior: 'none', params: [] }
  // Hold only: the held behaviour itself (`&mo NAV`, `&kp LSHFT`) does exactly that.
  const first = tap && steps.hold ? makeHoldTap(file, steps.hold, tap, steps.holdTap) : (tap ?? steps.hold)!

  if (!steps.doubleTap && !steps.tapHold) return first

  const secondTap = steps.doubleTap ?? tap ?? { behavior: 'none', params: [] }
  const second = steps.tapHold ? makeHoldTap(file, steps.tapHold, secondTap, steps.secondHoldTap) : secondTap
  const bindings = [first, second]

  // Reuse an identical tap dance if one exists.
  const reg = buildRegistry(file)
  for (const d of reg.all) {
    if (d.kind !== 'tap-dance' || d.builtin) continue
    const inner = tapDanceBindings(file, d.id)
    if (inner && inner.length === 2 && bindingEquals(inner[0], bindings[0]) && bindingEquals(inner[1], bindings[1])) {
      return { behavior: d.id, params: [] }
    }
  }
  // Update the key's own tap dance in place when nothing else uses it.
  if (steps.tapDance && behaviorUsage(file, steps.tapDance) <= 1) {
    const node = behaviorNode(file, steps.tapDance)
    if (node) {
      setProp(node, 'bindings', formatBindingGroups(bindings))
      return { behavior: steps.tapDance, params: [] }
    }
  }
  const label = createTapDance(file, 'td_' + describeForLabel(tap ?? steps.hold!), bindings, undefined, GENERATED_MARK)
  return { behavior: label, params: [] }
}

function describeForLabel(b: Binding): string {
  return (b.params[b.params.length - 1] ?? b.behavior).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 16) || 'key'
}

/**
 * Remove generated tap dances and hold-taps nothing refers to any more. Hand-written
 * behaviours are never touched.
 */
export function collectGarbage(file: DtsFile): string[] {
  const removed: string[] = []
  for (let pass = 0; pass < 3; pass++) {
    const doomed: DtsNode[] = []
    walkNodes(file.items, (n) => {
      if (!n.labels.length) return
      if (!parseString(getRaw(n, 'compatible'))?.startsWith('zmk,behavior-')) return
      if (!n.leading.some((c) => c.includes(GENERATED_MARK))) return
      if (behaviorUsage(file, n.labels[0]) === 0) doomed.push(n)
    })
    if (!doomed.length) break
    const strip = (items: DtsFile['items']) => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]
        if (it.kind !== 'node') continue
        if (doomed.includes(it)) { items.splice(i, 1); removed.push(it.labels[0]) } else strip(it.children)
      }
    }
    strip(file.items)
  }
  return removed
}
