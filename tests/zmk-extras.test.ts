import { describe, expect, it } from 'vitest'
import { parseDts, printDts } from '../src/core/dts.ts'
import { collectGarbage, compose, decompose } from '../src/core/composer.ts'
import { formatBinding } from '../src/core/keymap.ts'
import { getConditionalLayers, saveConditionalLayers } from '../src/core/features.ts'

const kp = (k: string) => ({ behavior: 'kp', params: [k] })
const base = () => parseDts(`/ {\n    behaviors {\n    };\n    keymap {\n        compatible = "zmk,keymap";\n        l0 { bindings = <&kp A &kp B>; };\n        l1 { bindings = <&trans &trans>; };\n        l2 { bindings = <&trans &trans>; };\n        l3 { bindings = <&trans &trans>; };\n    };\n};\n`)

describe('tap dances beyond Oryx', () => {
  it('compiles three taps, each with its own hold, and reads them back', () => {
    const f = base()
    const b = compose({
      tap: kp('A'), hold: kp('LSHFT'),
      doubleTap: kp('B'),
      moreTaps: [{ tap: kp('C'), hold: { behavior: 'mo', params: ['1'] } }, { tap: kp('D') }],
    }, f)
    const text = printDts(f)
    expect(text).toContain('bindings = <&mt LSHFT A>, <&kp B>, <&lt 1 C>, <&kp D>')
    const steps = decompose(b, f)!
    expect(steps.moreTaps).toEqual([{ tap: kp('C'), hold: { behavior: 'mo', params: ['1'] }, holdTap: 'lt' }, { tap: kp('D') }])
    expect(formatBinding(compose(steps, structuredClone(f)))).toBe(formatBinding(b))
  })

  it('updates the key\'s own tap dance in place when a tap is removed', () => {
    const f = base()
    const b = compose({ tap: kp('A'), doubleTap: kp('B'), moreTaps: [{ tap: kp('C') }] }, f)
    // Simulate the binding being on a key, so the dance is "in use" once.
    const used = parseDts(printDts(f).replace('&kp A &kp B', `&${b.behavior} &kp B`))
    const steps = decompose(b, used)!
    const b2 = compose({ ...steps, moreTaps: [] }, used)
    expect(b2.behavior).toBe(b.behavior)
    expect(printDts(used)).toContain('bindings = <&kp A>, <&kp B>;')
  })
})

describe('mod-morph ("when Shift is held")', () => {
  it('wraps a plain key', () => {
    const f = base()
    const b = compose({ tap: kp('COMMA'), morph: { binding: kp('SEMI'), mods: [], keepMods: [] } }, f)
    expect(b.behavior).toMatch(/^mm_/)
    expect(printDts(f)).toMatch(/compatible = "zmk,behavior-mod-morph";[\s\S]*bindings = <&kp COMMA>, <&kp SEMI>;[\s\S]*mods = <\(MOD_LSFT\|MOD_RSFT\)>;/)
    expect(decompose(b, f)).toMatchObject({ tap: kp('COMMA'), morph: { binding: kp('SEMI'), mods: ['MOD_LSFT', 'MOD_RSFT'], keepMods: [] } })
  })

  it('wraps a hold-tap and a tap dance, keeping modifiers when asked', () => {
    const f = base()
    const b = compose({ tap: kp('BSPC'), hold: { behavior: 'mo', params: ['1'] }, doubleTap: kp('LC(BSPC)'), morph: { binding: kp('DEL'), mods: ['MOD_LSFT'], keepMods: ['MOD_LSFT'] } }, f)
    const steps = decompose(b, f)!
    expect(steps).toMatchObject({ tap: kp('BSPC'), hold: { behavior: 'mo', params: ['1'] }, doubleTap: kp('LC(BSPC)'), morph: { binding: kp('DEL'), mods: ['MOD_LSFT'], keepMods: ['MOD_LSFT'] } })
    expect(printDts(f)).toContain('keep-mods = <MOD_LSFT>;')
    // Removing the morph and garbage-collecting leaves nothing generated behind.
    const g = structuredClone(f)
    const plain = compose({ ...steps, morph: undefined, doubleTap: undefined, tapDance: undefined }, g)
    expect(formatBinding(plain)).toBe('&lt 1 BSPC')
    expect(collectGarbage(g).sort()).toEqual([b.behavior, steps.tapDance].sort())
  })

  it('reuses an identical mod-morph', () => {
    const f = base()
    const a = compose({ tap: kp('COMMA'), morph: { binding: kp('SEMI'), mods: [], keepMods: [] } }, f)
    const b = compose({ tap: kp('COMMA'), morph: { binding: kp('SEMI'), mods: [], keepMods: [] } }, f)
    expect(b.behavior).toBe(a.behavior)
  })
})

describe('conditional layers', () => {
  it('saves and reads tri-layer rules', () => {
    const f = base()
    saveConditionalLayers(f, [{ id: 'tri_layer', ifLayers: ['1', '2'], thenLayer: '3' }])
    expect(printDts(f)).toMatch(/compatible = "zmk,conditional-layers";[\s\S]*if-layers = <1 2>;[\s\S]*then-layer = <3>;/)
    expect(getConditionalLayers(f)).toEqual([{ id: 'tri_layer', ifLayers: ['1', '2'], thenLayer: '3' }])
  })
})

describe('clearing a step (the ✕) sticks', () => {
  const none = { behavior: 'none', params: [] }
  const clear = (steps: object, step: string) => {
    const f = base()
    const b = compose(steps, f)
    const s = decompose(b, f)! as Record<string, unknown>
    const out = compose({ ...s, [step]: undefined }, f)
    return { f, out, back: decompose(out, f)! }
  }

  it('the tap of a hold-tap: the key keeps only its hold', () => {
    const { f, out, back } = clear({ tap: kp('A'), hold: kp('LALT') }, 'tap')
    expect(back.tap).toBeUndefined()
    expect(back.hold).toEqual(kp('LALT'))
    expect(formatBinding(out)).toBe('&ht_kp_none LALT 0')
    expect(printDts(f)).toContain('flavor = "hold-preferred"')
  })

  it('a double tap that falls back to the tap because a tap-then-hold is set', () => {
    // &td <&lt 1 BSPC>, <&mt BSPC BSPC> (older keymaps): the double tap reads as unset, so
    // there's nothing to clear - and saving the key turns it into a quick-tap hold-tap.
    const f = parseDts(`/ {\n    behaviors {\n        td_bspc: td_bspc {\n            compatible = "zmk,behavior-tap-dance";\n            #binding-cells = <0>;\n            bindings = <&lt 1 BSPC>, <&mt BSPC BSPC>;\n        };\n    };\n    keymap {\n        compatible = "zmk,keymap";\n        l0 { bindings = <&td_bspc &kp B>; };\n        l1 { bindings = <&trans &trans>; };\n    };\n};\n`)
    const steps = decompose({ behavior: 'td_bspc', params: [] }, f)!
    expect(steps).toMatchObject({ tap: kp('BSPC'), doubleTap: undefined, tapHold: kp('BSPC') })
    expect(formatBinding(compose(steps, f))).toBe('&lt_rep 1 BSPC')
  })

  it('the tap of a double-tap-only key keeps the double tap', () => {
    const { back } = clear({ tap: none, doubleTap: { behavior: 'to', params: ['1'] } }, 'tap')
    expect(back.tap).toBeUndefined()
    expect(back.doubleTap).toEqual({ behavior: 'to', params: ['1'] })
  })

  it('the normal action of a mod-morph', () => {
    const { back } = clear({ tap: { behavior: 'caps_word', params: [] }, morph: { binding: kp('CAPS'), mods: [], keepMods: [] } }, 'tap')
    expect(back.tap).toBeUndefined()
    expect(back.morph?.binding).toEqual(kp('CAPS'))
  })
})

describe('tap then hold repeats the tap (quick-tap-ms, not a tap dance)', () => {
  const mo1 = { behavior: 'mo', params: ['1'] }
  const withULt = (extra = '') => parseDts(`/ {\n    behaviors {\n        u_lt: u_lt {\n            compatible = "zmk,behavior-hold-tap";\n            #binding-cells = <2>;\n            bindings = <&mo>, <&kp>;\n            flavor = "tap-preferred";\n            tapping-term-ms = <180>;\n        };\n${extra}    };\n    keymap {\n        compatible = "zmk,keymap";\n        l0 { bindings = <&u_lt 1 BSPC &kp B>; };\n        l1 { bindings = <&trans &trans>; };\n    };\n};\n`)

  it('gives the key a quick-tap variant of its own hold-tap, with the same timing', () => {
    const f = withULt()
    const b = compose({ tap: kp('BSPC'), hold: mo1, holdTap: 'u_lt', tapHold: kp('BSPC') }, f)
    expect(formatBinding(b)).toBe('&u_lt_rep 1 BSPC')
    const text = printDts(f)
    expect(text).not.toContain('zmk,behavior-tap-dance')
    expect(text).toMatch(/u_lt_rep: u_lt_rep \{[^}]*flavor = "tap-preferred";[^}]*tapping-term-ms = <180>;[^}]*quick-tap-ms = <200>;/)
    expect(decompose(b, f)).toEqual({ tap: kp('BSPC'), hold: mo1, holdTap: 'u_lt_rep', tapHold: kp('BSPC') })
    expect(formatBinding(compose(decompose(b, f)!, structuredClone(f)))).toBe('&u_lt_rep 1 BSPC')
  })

  it('treats a double tap that is just the tap again the same way (it used to drop presses)', () => {
    const f = withULt()
    const b = compose({ tap: kp('BSPC'), hold: mo1, holdTap: 'u_lt', doubleTap: kp('BSPC'), tapHold: kp('BSPC'), secondHoldTap: 'mt' }, f)
    expect(formatBinding(b)).toBe('&u_lt_rep 1 BSPC')
    expect(printDts(f)).not.toContain('zmk,behavior-tap-dance')
  })

  it('reuses an existing quick-tap hold-tap, and goes back to the plain one when the step is removed', () => {
    const f = withULt()
    const one = compose({ tap: kp('BSPC'), hold: mo1, holdTap: 'u_lt', tapHold: kp('BSPC') }, f)
    const two = compose({ tap: kp('SPACE'), hold: mo1, holdTap: 'u_lt', tapHold: kp('SPACE') }, f)
    expect([one.behavior, two.behavior]).toEqual(['u_lt_rep', 'u_lt_rep'])
    expect(printDts(f).match(/quick-tap-ms/g)).toHaveLength(1)
    const back = compose({ ...decompose(one, f)!, tapHold: undefined }, f)
    expect(formatBinding(back)).toBe('&u_lt 1 BSPC')
  })

  it('makes one from the built-in layer-tap when there is no custom hold-tap', () => {
    const f = base()
    const b = compose({ tap: kp('SPACE'), hold: mo1, tapHold: kp('SPACE') }, f)
    expect(formatBinding(b)).toBe('&lt_rep 1 SPACE')
    expect(printDts(f)).toMatch(/lt_rep: lt_rep \{[^}]*bindings = <&mo>, <&kp>;[^}]*flavor = "tap-preferred";[^}]*tapping-term-ms = <200>;[^}]*quick-tap-ms = <200>;/)
  })

  it('keeps a hand-written quick-tap hold-tap as it is', () => {
    const f = withULt(`        hml: hml {\n            compatible = "zmk,behavior-hold-tap";\n            #binding-cells = <2>;\n            bindings = <&kp>, <&kp>;\n            flavor = "balanced";\n            tapping-term-ms = <280>;\n            quick-tap-ms = <175>;\n        };\n`)
    const b = { behavior: 'hml', params: ['LALT', 'A'] }
    const steps = decompose(b, f)!
    expect(steps.tapHold).toEqual(kp('A'))
    const g = structuredClone(f)
    expect(formatBinding(compose(steps, g))).toBe('&hml LALT A')
    expect(printDts(g)).toBe(printDts(f))
  })

  it('still uses a tap dance when tap then hold does something else', () => {
    const f = withULt()
    const b = compose({ tap: kp('BSPC'), hold: mo1, holdTap: 'u_lt', tapHold: kp('DEL') }, f)
    expect(b.behavior).toMatch(/^td_/)
  })
})
