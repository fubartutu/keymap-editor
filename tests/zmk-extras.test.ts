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
