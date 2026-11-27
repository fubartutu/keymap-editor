/**
 * Oryx-style key "steps" for ZMK, extended with what ZMK can do beyond Oryx.
 *
 * Oryx (ZSA's configurator) models every key as up to four actions: tapped, held,
 * double-tapped and tapped-then-held, compiled into QMK mod-taps, layer-taps and tap
 * dances. This module does the same for ZMK, plus:
 *
 *   - any number of taps (triple tap, quadruple tap…), each with its own hold action
 *   - a "when a modifier is held" alternative (ZMK mod-morph), e.g. , → ; with Shift
 *
 * Compilation:
 *   tap                         → the tap binding itself        (&kp A)
 *   tap + hold                  → a hold-tap                     (&mt LSHFT A, &lt NAV SPC, &hml LALT A…)
 *   tap + hold + tap-then-hold  → a hold-tap with quick-tap-ms, when tap-then-hold repeats
 *                                 the tap (and any double tap is the tap again): no tap dance,
 *                                 so fast repeated taps all register
 *   2+ taps                     → a tap dance whose bindings are the above, one per tap count
 *   + "with modifier"           → a mod-morph wrapping all of that
 *
 * Existing behaviours are reused where they fit, so decomposing and recomposing a key that
 * was written by hand gives back the same binding.
 */
import { buildRegistry, type BehaviorDef, type BehaviorRegistry } from './behaviors.ts'
import { getRaw, parseCells, parseString, props, setProp, walkNodes, type DtsFile, type DtsNode } from './dts.ts'
import { createHoldTap, createTapDance, createModMorph, behaviorUsage, behaviorNode, overrideNode, BUILTIN_DEFAULTS } from './features.ts'
import { bindingEquals, formatBindingGroups, parseBindings, type Binding } from './keymap.ts'

/** What one tap count does: tapped, and optionally held. */
export interface TapStep {
  tap?: Binding
  hold?: Binding
  /** Hold-tap behaviour used when both are set. */
  holdTap?: string
}

export interface Morph {
  /** What the key does while one of `mods` is held. */
  binding: Binding
  /** MOD_LSFT, MOD_RSFT… */
  mods: string[]
  /** Trigger modifiers that stay applied to `binding`. */
  keepMods: string[]
}

export interface KeySteps {
  tap?: Binding
  hold?: Binding
  doubleTap?: Binding
  tapHold?: Binding
  /** Hold-tap behaviour used for tap+hold (e.g. `mt`, `lt`, `hml`). */
  holdTap?: string
  /** Hold-tap behaviour used for double-tap+tap-hold. */
  secondHoldTap?: string
  /** Third tap onwards (ZMK only; Oryx stops at two). */
  moreTaps?: TapStep[]
  /** Tap-dance behaviour, when there are two or more taps. */
  tapDance?: string
  /** "When a modifier is held" alternative (ZMK mod-morph). */
  morph?: Morph
  /** The mod-morph behaviour implementing `morph`. */
  modMorph?: string
}

export const GENERATED_MARK = 'keymap-editor: generated'
/** quick-tap-ms given to hold-taps the editor creates for "tap then hold repeats". */
export const REPEAT_QUICK_TAP_MS = 200
export const SHIFT_MODS = ['MOD_LSFT', 'MOD_RSFT']

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

function nodeBindings(file: DtsFile, label: string): Binding[] | undefined {
  const node = behaviorNode(file, label)
  return node ? parseBindings(getRaw(node, 'bindings')) : undefined
}

function modsOf(raw: string | null | undefined): string[] {
  return (parseCells(raw)[0] ?? '').replace(/[()]/g, '').split('|').map((x) => x.trim()).filter(Boolean)
}

function formatMods(mods: string[]): string {
  return mods.length === 1 ? `<${mods[0]}>` : `<(${mods.join('|')})>`
}

const isNone = (b: Binding | undefined) => b?.behavior === 'none'

/** One tap count: a plain binding, or a hold-tap split into tap + hold. */
function decomposeTap(b: Binding, reg: BehaviorRegistry): TapStep | null {
  const def = reg.get(b.behavior)
  if (def?.kind === 'hold-tap' && def.holdTapBindings) {
    const { hold, tap } = splitHoldTap(b, def, reg)
    // A hold-tap that does nothing when tapped is a hold-only key (what clearing its tap makes).
    return { tap: isNone(tap) ? undefined : tap, hold, holdTap: def.id }
  }
  // Nested tap dances and mod-morphs can't be shown as steps.
  if (def && !def.builtin && (def.kind === 'tap-dance' || def.kind === 'mod-morph')) return null
  return { tap: b }
}

/** Break a binding into steps. Returns null when it cannot be shown as steps. */
export function decompose(b: Binding, file: DtsFile, reg = buildRegistry(file)): KeySteps | null {
  const def = reg.get(b.behavior)

  if (def?.kind === 'mod-morph' && !def.builtin) {
    const node = behaviorNode(file, def.id)!
    const inner = nodeBindings(file, def.id) ?? []
    if (inner.length !== 2) return null
    const base = decompose(inner[0], file, reg)
    const alt = decomposeTap(inner[1], reg)
    // The morphed binding must be a single action (not itself a hold-tap).
    if (!base || base.morph || !alt || alt.hold) return null
    // Inside a mod-morph, &none as the normal action means it has none (as compose writes it).
    if (isNone(base.tap) && !base.hold) delete base.tap
    return { ...base, morph: { binding: alt.tap!, mods: modsOf(getRaw(node, 'mods')), keepMods: modsOf(getRaw(node, 'keep-mods')) }, modMorph: def.id }
  }

  if (def?.kind === 'tap-dance' && !def.builtin) {
    const inner = nodeBindings(file, def.id) ?? []
    if (inner.length === 0) return null
    const taps = inner.map((x) => decomposeTap(x, reg))
    if (taps.some((t) => !t)) return null
    const [first, second, ...rest] = taps as TapStep[]
    // A single tap of &none means "nothing on one tap" (e.g. Miryoku's double-tap layer locks).
    const tap = isNone(first.tap) && !first.hold ? undefined : first.tap
    // compose fills an unset tap of a later tap count that has a hold with the single tap, so
    // report that tap as unset - otherwise clearing it changes nothing.
    const sameAsTap = (t: TapStep) => (t.hold && t.tap && tap && bindingEquals(t.tap, tap) ? { ...t, tap: undefined } : t)
    const steps: KeySteps = { tap, hold: first.hold, holdTap: first.holdTap, tapDance: def.id }
    if (second) {
      const s2 = sameAsTap(second)
      steps.doubleTap = s2.tap
      steps.tapHold = s2.hold
      steps.secondHoldTap = s2.holdTap
    }
    if (rest.length) steps.moreTaps = rest.map(sameAsTap)
    return steps
  }

  const t = decomposeTap(b, reg)
  if (!t) return null
  const steps: KeySteps = { tap: t.tap, hold: t.hold, holdTap: t.holdTap }
  // A hold-tap with quick-tap-ms repeats the tap when tapped then held.
  if (t.hold && t.holdTap && quickTapMs(file, t.holdTap) > 0) steps.tapHold = t.tap
  return steps
}

/** quick-tap-ms of a hold-tap: its own node, or the `&lt { }` style override of a built-in. */
export function quickTapMs(file: DtsFile, id: string): number {
  const node = behaviorNode(file, id) ?? overrideNode(file, id, false)
  const raw = node ? getRaw(node, 'quick-tap-ms') : undefined
  if (raw == null) return Number(BUILTIN_DEFAULTS[id]?.['quick-tap-ms'] ?? 0)
  return Number(parseCells(raw)[0]) || 0
}

/** The properties of hold-tap `id` (minus its bindings), for making a variant of it. */
function holdTapProps(file: DtsFile, id: string): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  const own = behaviorNode(file, id)
  if (own) {
    for (const p of props(own.children)) if (!['compatible', '#binding-cells', 'bindings'].includes(p.name)) out[p.name] = p.raw
    return out
  }
  for (const [k, v] of Object.entries(BUILTIN_DEFAULTS[id] ?? {})) out[k] = typeof v === 'string' ? `"${v}"` : `<${v}>`
  const ov = overrideNode(file, id, false)
  if (ov) for (const p of props(ov.children)) out[p.name] = p.raw
  return out
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
  if (b.params.length > 1) {
    throw new ComposeError(`"${def?.name ?? b.behavior} ${b.params.join(' ')}" needs ${b.params.length} parameters, but a hold-tap can only pass one to its ${role} action. Put it in a macro and use that instead.`)
  }
}

/**
 * `quick`: true needs a hold-tap with quick-tap-ms (tap then hold repeats the tap), false one
 * without, undefined either. When the preferred hold-tap doesn't fit, a variant of it is reused
 * or created with only quick-tap-ms changed, so its timing and flavour carry over.
 */
function makeHoldTap(file: DtsFile, hold: Binding, tap: Binding, preferred: string | undefined, quick?: boolean): Binding {
  const reg = buildRegistry(file)
  checkPassable(hold, 'hold', reg)
  checkPassable(tap, 'tap', reg)
  const fits = (id: string) => quick === undefined || (quickTapMs(file, id) > 0) === quick
  const candidates = holdTapCandidates(reg, hold.behavior, tap.behavior)
  const params = [hold.params[0] ?? '0', tap.params[0] ?? '0']
  let base = candidates.find((c) => c.id === preferred)?.id
  if (!base) {
    if (hold.behavior === 'kp' && tap.behavior === 'kp' && candidates.some((c) => c.id === 'mt')) base = 'mt'
    else if (hold.behavior === 'mo' && tap.behavior === 'kp') base = 'lt'
    else base = candidates[0]?.id
  }
  if (base && fits(base)) return { behavior: base, params }

  const wanted = base ? holdTapProps(file, base) : { flavor: tap.behavior === 'none' ? '"hold-preferred"' : '"tap-preferred"', 'tapping-term-ms': '<200>' }
  if (quick) wanted['quick-tap-ms'] = `<${REPEAT_QUICK_TAP_MS}>`
  else delete wanted['quick-tap-ms']
  const same = (id: string) => {
    if (!fits(id)) return false
    const have = holdTapProps(file, id)
    const norm = (r: Record<string, string | null>) => JSON.stringify(Object.entries(r).filter(([k]) => k !== 'quick-tap-ms').sort())
    return norm(have) === norm(wanted)
  }
  const reuse = candidates.find((c) => same(c.id))?.id
  if (reuse) return { behavior: reuse, params }

  const label = base ? `${base.replace(/_rep$/, '')}${quick ? '_rep' : ''}` : `ht_${hold.behavior}_${tap.behavior}`
  const why = quick ? 'tap then hold repeats the tap' : `hold ${hold.behavior}, tap ${tap.behavior}`
  return { behavior: createHoldTap(file, label, hold.behavior, tap.behavior, wanted, `${GENERATED_MARK}: ${why}`), params }
}

function composeTap(file: DtsFile, t: TapStep, fallbackTap?: Binding, quick?: boolean): Binding {
  const tap = t.tap ?? fallbackTap
  // Hold only: a hold-tap that does nothing when tapped. (A bare &kp LALT would still send
  // Alt on a tap, and would read back as "when tapped", so clearing the tap wouldn't stick.)
  if (t.hold) return makeHoldTap(file, t.hold, tap ?? { behavior: 'none', params: [] }, t.holdTap, quick)
  return tap ?? { behavior: 'none', params: [] }
}

/**
 * Tap then hold repeats the tap, and nothing else needs a second tap: ZMK does that with
 * quick-tap-ms on the hold-tap, without a tap dance (which would swallow fast repeated taps).
 */
function isRepeat(steps: KeySteps, more: TapStep[]): boolean {
  const tap = steps.tap
  return !!tap && !!steps.tapHold && bindingEquals(steps.tapHold, tap) && (!steps.doubleTap || bindingEquals(steps.doubleTap, tap)) && !more.length
}

function sameBindings(a: Binding[] | undefined, b: Binding[]): boolean {
  return !!a && a.length === b.length && a.every((x, i) => bindingEquals(x, b[i]))
}

/** Reuse an identical behaviour of `kind`, update the key's own one in place, or create one. */
function placeBehaviour(file: DtsFile, kind: 'tap-dance' | 'mod-morph', bindings: Binding[], own: string | undefined, match: (node: DtsNode) => boolean, create: () => string, update: (node: DtsNode) => void): string {
  const reg = buildRegistry(file)
  for (const d of reg.all) {
    if (d.kind !== kind || d.builtin) continue
    const node = behaviorNode(file, d.id)
    if (node && sameBindings(nodeBindings(file, d.id), bindings) && match(node)) return d.id
  }
  if (own && behaviorUsage(file, own) <= 1) {
    const node = behaviorNode(file, own)
    if (node && parseString(getRaw(node, 'compatible')) === `zmk,behavior-${kind}`) {
      setProp(node, 'bindings', formatBindingGroups(bindings))
      update(node)
      return own
    }
  }
  return create()
}

/**
 * Turn steps back into a binding, creating hold-tap, tap-dance and mod-morph behaviours in
 * `file` when needed. `file` is mutated.
 */
export function compose(steps: KeySteps, file: DtsFile): Binding {
  const more = (steps.moreTaps ?? []).filter((t) => t.tap || t.hold)
  if (!steps.tap && !steps.hold && !steps.morph && !steps.doubleTap && !steps.tapHold && !more.length) return { behavior: 'none', params: [] }
  const repeat = isRepeat(steps, more)
  const multiTap = !repeat && !!(steps.doubleTap || steps.tapHold || more.length)
  // Top level: quick-tap-ms exactly when tap-then-hold repeats. Inside a tap dance it doesn't matter.
  const first = composeTap(file, { tap: steps.tap, hold: steps.hold, holdTap: steps.holdTap }, undefined, multiTap ? undefined : repeat)

  let base: Binding = first
  if (multiTap) {
    const second = composeTap(file, { tap: steps.doubleTap, hold: steps.tapHold, holdTap: steps.secondHoldTap }, steps.tap)
    const bindings = [first, second, ...more.map((t) => composeTap(file, t, steps.tap))]
    const label = 'td_' + describeForLabel(steps.tap ?? steps.hold ?? first)
    const id = placeBehaviour(file, 'tap-dance', bindings, steps.tapDance, () => true,
      () => createTapDance(file, label, bindings, undefined, GENERATED_MARK), () => {})
    base = { behavior: id, params: [] }
  }

  if (!steps.morph) return base
  const morph = steps.morph
  const mods = morph.mods.length ? morph.mods : SHIFT_MODS
  const bindings = [base, morph.binding]
  const label = 'mm_' + describeForLabel(steps.tap ?? base)
  const id = placeBehaviour(file, 'mod-morph', bindings, steps.modMorph,
    (node) => modsOf(getRaw(node, 'mods')).sort().join() === [...mods].sort().join() && modsOf(getRaw(node, 'keep-mods')).sort().join() === [...morph.keepMods].sort().join(),
    () => {
      const created = createModMorph(file, label, base, morph.binding, mods, GENERATED_MARK)
      if (morph.keepMods.length) setProp(behaviorNode(file, created)!, 'keep-mods', formatMods(morph.keepMods))
      return created
    },
    (node) => {
      setProp(node, 'mods', formatMods(mods))
      setProp(node, 'keep-mods', morph.keepMods.length ? formatMods(morph.keepMods) : undefined)
    })
  return { behavior: id, params: [] }
}

function describeForLabel(b: Binding): string {
  return (b.params[b.params.length - 1] ?? b.behavior).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 16) || 'key'
}

/**
 * Remove generated tap dances, hold-taps and mod-morphs nothing refers to any more.
 * Hand-written behaviours are never touched.
 */
export function collectGarbage(file: DtsFile): string[] {
  const removed: string[] = []
  for (let pass = 0; pass < 4; pass++) {
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
