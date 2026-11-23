import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDts, printDts } from '../src/core/dts.ts'
import { formatBinding, getLayers, layerDefines, parseBindings } from '../src/core/keymap.ts'
import { collectGarbage, compose, decompose } from '../src/core/composer.ts'
import { getCombos, getMacros, macroBindingsRaw, textToMacroSteps } from '../src/core/features.ts'
import { editKeymap, loadProject, projectAddLayer, projectMoveLayer, projectRemoveLayer, serializeProject } from '../src/core/project.ts'
import { validateProject } from '../src/core/validate.ts'
import { findKconfig, setKconfig } from '../src/core/settings.ts'
import { findOverlayProp, getAutoMouse } from '../src/core/overlay.ts'
import { detectProject } from '../server/project.ts'

const REPO = process.env.ZMK_CONFIG ?? join(homedir(), 'Work/zmk-charybdis')
const has = existsSync(join(REPO, 'config'))

describe('dts', () => {
  it('round-trips a hand-written file', () => {
    const src = `#include <behaviors.dtsi>\n\n// comment\n&lt { tapping-term-ms = <200>; };\n\n/ {\n    combos {\n        compatible = "zmk,combos";\n        c1 { key-positions = <1 2>; bindings = <&kp A>; };\n    };\n\n    /* block */\n    keymap {\n        compatible = "zmk,keymap";\n        base {\n            bindings = <&kp A &kp B>; // trailing\n        };\n    };\n};\n`
    expect(printDts(parseDts(src))).toBe(src)
  })
  it('parses macro-generated keymaps without losing the macro call', () => {
    const src = `/ {\n    keymap {\n#define X(a) a\nMY_LAYER_LIST\n    };\n};\n`
    expect(printDts(parseDts(src))).toContain('MY_LAYER_LIST')
  })
})

describe.skipIf(!has)('Charybdis config (zmk-charybdis)', () => {
  const files = detectProject(REPO)
  const project = loadProject(files)

  it('detects the project', () => {
    expect(files.name).toBe('charybdis')
    expect(files.features).toMatchObject({ split: true, central: 'right', pmw3610: true, autoMouse: true })
    expect(files.layout.keys).toHaveLength(56)
    expect(files.confs.map((c) => [c.path, c.scope])).toContainEqual(['config/boards/shields/charybdis/charybdis_right.conf', 'central'])
  })

  it('keymap text round-trips with only cosmetic changes', () => {
    const out = printDts(parseDts(files.keymap))
    expect(printDts(parseDts(out))).toBe(out)
    const norm = (s: string) => s.replace(/\s+/g, ' ')
    expect(norm(out)).toBe(norm(files.keymap))
  })

  it('reads layers, defines, combos and macros', () => {
    const layers = getLayers(project.keymap)
    expect(layers.map((l) => l.name)).toEqual(['base', 'Sym+Num', 'window', 'window2', 'gaming', 'mode', 'nav', 'mouse', 'mouse lock', 'scroll', 'snipe'])
    for (const l of layers) expect(l.bindings).toHaveLength(56)
    expect([...layerDefines(project.keymap)]).toEqual([['BASE', 0], ['SYM', 1], ['WIN', 2], ['WIN2', 3], ['GAME', 4], ['MODE', 5], ['NAV', 6], ['MOUSE', 7], ['MLOCK', 8], ['SCROLL', 9], ['SNIPE', 10]])
    expect(getCombos(project.keymap).map((c) => c.id)).toEqual(['combo_undo', 'combo_cut', 'combo_copy', 'combo_paste', 'combo_tilde', 'combo_end_patient'])
    const m = getMacros(project.keymap)[0]
    expect(m.label).toBe('end_patient')
    expect(macroBindingsRaw(m.steps)).toBe('<&macro_tap &kp LC(F4)>, <&macro_wait_time 250>, <&macro_tap &kp LA(C)>')
  })

  it('has no validation errors', () => {
    const errors = validateProject(project).filter((i) => i.severity === 'error')
    expect(errors).toEqual([])
  })

  it('saving an unchanged project writes nothing', () => {
    expect(serializeProject(project).files).toEqual({})
  })

  it('decomposes and recomposes every key to the same binding', () => {
    for (const layer of getLayers(project.keymap)) {
      for (const b of layer.bindings) {
        const steps = decompose(b, project.keymap)
        expect(steps).not.toBeNull()
        const file = structuredClone(project.keymap)
        expect(formatBinding(compose(steps!, file))).toBe(formatBinding(b))
      }
    }
  })

  it('understands the custom hold-taps like Oryx steps', () => {
    const base = getLayers(project.keymap)[0].bindings
    expect(decompose(base[25], project.keymap)).toEqual({ tap: { behavior: 'kp', params: ['A'] }, hold: { behavior: 'kp', params: ['LALT'] }, holdTap: 'hml' })
    expect(decompose(base[49], project.keymap)).toEqual({ tap: { behavior: 'kp', params: ['BSPC'] }, hold: { behavior: 'mo', params: ['SYM'] }, holdTap: 'lt' })
    expect(decompose(base[11], project.keymap)).toEqual({ tap: { behavior: 'kp', params: ['MINUS'] }, hold: { behavior: 'to', params: ['MODE'] }, holdTap: 'ht_to' })
  })

  it('adds a tap dance for a double tap, and cleans it up when removed', () => {
    const file = structuredClone(project.keymap)
    const b = compose({ tap: { behavior: 'kp', params: ['Q'] }, doubleTap: { behavior: 'kp', params: ['ESC'] } }, file)
    expect(b.behavior).toMatch(/^td_/)
    const text = printDts(file)
    expect(text).toContain('compatible = "zmk,behavior-tap-dance"')
    expect(text).toContain('bindings = <&kp Q>, <&kp ESC>')
    expect(decompose(b, file)).toMatchObject({ tap: { params: ['Q'] }, doubleTap: { params: ['ESC'] } })
    // Not referenced from any layer, so garbage collection removes it.
    expect(collectGarbage(file)).toEqual([b.behavior])
  })

  it('creates a hold-tap when no existing one fits', () => {
    const file = structuredClone(project.keymap)
    const b = compose({ tap: { behavior: 'caps_word', params: [] }, hold: { behavior: 'kp', params: ['LSHFT'] } }, file)
    expect(b.behavior).toBe('ht_kp_caps_word')
    expect(b.params).toEqual(['LSHFT', '0'])
    expect(printDts(file)).toContain('bindings = <&kp>, <&caps_word>')
  })

  it('moving a layer keeps defines, combos and the trackball overlay in step', () => {
    // Move "gaming" (4) to the end.
    const moved = projectMoveLayer(project, 4, 10)
    const names = getLayers(moved.keymap).map((l) => l.name)
    expect(names[10]).toBe('gaming')
    const defs = layerDefines(moved.keymap)
    expect(defs.get('GAME')).toBe(10)
    expect(defs.get('MOUSE')).toBe(6)
    expect(defs.get('SCROLL')).toBe(8)
    // Bindings keep using the symbolic names.
    expect(formatBinding(getLayers(moved.keymap)[0].bindings[49])).toBe('&lt SYM BSPC')
    // Overlay numbers are remapped.
    expect(findOverlayProp(moved.overlays, 'trackball', 'scroll-layers')?.cells).toEqual(['8'])
    expect(findOverlayProp(moved.overlays, 'trackball', 'snipe-layers')?.cells).toEqual(['9'])
    expect(getAutoMouse(moved.overlays)?.layer).toBe(6)
    // And the result still validates.
    expect(validateProject(moved).filter((i) => i.severity === 'error')).toEqual([])
    // Moving back restores the original text.
    const back = projectMoveLayer(moved, 10, 4)
    expect(serializeProject(back).files).toEqual({})
  })

  it('adds and removes layers', () => {
    const added = projectAddLayer(project, 'Numpad')
    const layers = getLayers(added.keymap)
    expect(layers).toHaveLength(12)
    expect(layerDefines(added.keymap).get('NUMPAD')).toBe(11)
    expect(validateProject(added).filter((i) => i.severity === 'error')).toEqual([])
    const removed = projectRemoveLayer(added, 11)
    expect(serializeProject(removed).files).toEqual({})
  })

  it('removing a layer turns references into &none and shifts later layers', () => {
    const removed = projectRemoveLayer(project, 3) // window2, reached via &mo WIN2
    const win = getLayers(removed.keymap)[2]
    expect(win.bindings.some((b) => b.behavior === 'mo' && b.params[0] === 'WIN2')).toBe(false)
    expect(layerDefines(removed.keymap).get('MOUSE')).toBe(6)
    expect(getAutoMouse(removed.overlays)?.layer).toBe(6)
    expect(validateProject(removed).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('reads and writes Kconfig values in the right file', () => {
    expect(findKconfig(project.confs, 'PMW3610_CPI')?.value).toBe('400')
    const next = setKconfig(project.confs, 'PMW3610_CPI', '600', 'central')
    const right = next.find((c) => c.path.endsWith('charybdis_right.conf'))!
    expect(right.text).toContain('CONFIG_PMW3610_CPI=600')
    const added = setKconfig(project.confs, 'ZMK_SLEEP', 'y', 'both')
    expect(added.find((c) => c.path === 'config/charybdis.conf')!.text).toMatch(/CONFIG_ZMK_SLEEP=y\n$/)
  })

  it('keeps auto-mouse excluded positions in sync with the mouse layer', () => {
    const p = editKeymap(project, (f) => {
      const mouse = getLayers(f)[7]
      const bs = mouse.bindings.map((b) => ({ ...b }))
      bs[30] = { behavior: 'mkp', params: ['MB4'] }
      mouse.node.children.find((c) => c.kind === 'prop' && c.name === 'bindings')!
      const prop = mouse.node.children.find((c) => c.kind === 'prop' && c.name === 'bindings') as { raw: string }
      prop.raw = `<${bs.map(formatBinding).join(' ')}>`
    })
    const out = serializeProject(p).files
    const overlay = out['config/boards/shields/charybdis/charybdis_right.overlay']
    expect(overlay).toContain('excluded-positions = <5 15 16 17 27 28 29 30 49>;')
    // Everything else in the overlay is untouched.
    const orig = readFileSync(join(REPO, 'config/boards/shields/charybdis/charybdis_right.overlay'), 'utf8')
    expect(overlay.replace('29 30 49', '29 49')).toBe(orig)
  })
})

describe('macros', () => {
  it('turns text into key taps', () => {
    const { steps, unsupported } = textToMacroSteps('Hi, 2!')
    expect(unsupported).toEqual([])
    expect(steps.map((s) => (s.kind === 'binding' ? s.binding.params[0] : '?'))).toEqual(['LS(H)', 'I', 'COMMA', 'SPACE', 'N2', 'LS(N1)'])
  })
  it('groups steps by mode', () => {
    const raw = macroBindingsRaw([
      { kind: 'binding', mode: 'press', binding: { behavior: 'kp', params: ['LSHFT'] } },
      { kind: 'binding', mode: 'tap', binding: { behavior: 'kp', params: ['A'] } },
      { kind: 'binding', mode: 'tap', binding: { behavior: 'kp', params: ['B'] } },
      { kind: 'binding', mode: 'release', binding: { behavior: 'kp', params: ['LSHFT'] } },
    ])
    expect(raw).toContain('<&macro_tap &kp A &kp B>')
    expect(parseBindings(raw).map((b) => b.behavior)).toEqual(['macro_press', 'kp', 'macro_tap', 'kp', 'kp', 'macro_release', 'kp'])
  })
})

describe.skipIf(!has || !existsSync(join(REPO, 'tools/visualizer/server.py')))('compatibility with tools/visualizer', () => {
  it('the visualiser still parses keymaps the editor writes', async () => {
    const { execFileSync } = await import('node:child_process')
    const { mkdtempSync, writeFileSync, mkdirSync, cpSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    let p = loadProject(detectProject(REPO))
    p = projectAddLayer(p, 'Numpad')
    p = editKeymap(p, (f) => {
      const b = compose({ tap: { behavior: 'kp', params: ['Q'] }, doubleTap: { behavior: 'kp', params: ['ESC'] } }, f)
      const l = getLayers(f)[0]
      const bs = l.bindings.map((x, i) => (i === 13 ? b : x))
      ;(l.node.children.find((c) => c.kind === 'prop' && c.name === 'bindings') as { raw: string }).raw = `<${bs.map(formatBinding).join(' ')}>`
    })
    p = editKeymap(p, (f) => {
      const b = compose({ tap: { behavior: 'caps_word', params: [] }, hold: { behavior: 'kp', params: ['LSHFT'] } }, f)
      const l = getLayers(f)[0]
      const bs = l.bindings.map((x, i) => (i === 12 ? b : x))
      ;(l.node.children.find((c) => c.kind === 'prop' && c.name === 'bindings') as { raw: string }).raw = `<${bs.map(formatBinding).join(' ')}>`
    })
    const out = serializeProject(p).files['config/charybdis.keymap']
    const dir = mkdtempSync(join(tmpdir(), 'vis-'))
    mkdirSync(join(dir, 'config'))
    cpSync(join(REPO, 'config/boards'), join(dir, 'config/boards'), { recursive: true })
    writeFileSync(join(dir, 'config/charybdis.keymap'), out)
    const src = readFileSync(join(REPO, 'tools/visualizer/server.py'), 'utf8')
    const parsing = src.slice(0, src.indexOf('# --------------------------------------------------------------------------- hooks')).replace(/^import ctypes.*$/gm, '')
    const script = '__file__ = "x"\n' + parsing + '\nimport json,sys\nd = parse_keymap(sys.argv[1])\nprint(json.dumps({"layers": [[l["name"], len(l["bindings"])] for l in d["layers"]], "combos": len(d["combos"]), "holdTaps": sorted(d["holdTaps"]), "am": d["autoMouse"]}))\n'
    const res = JSON.parse(execFileSync('python3', ['-I', '-c', script, join(dir, 'config/charybdis.keymap')], { encoding: 'utf8' }))
    expect(res.layers).toHaveLength(12)
    for (const [, n] of res.layers) expect(n).toBe(56)
    expect(res.layers[11][0]).toBe('Numpad')
    expect(res.combos).toBe(6)
    expect(res.holdTaps).toEqual(expect.arrayContaining(['hml', 'hmr', 'ht', 'ht_to', 'ht_kp_caps_word']))
    expect(res.am.layer).toBe(7)
  })
})
