import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDts, printDts } from '../src/core/dts.ts'
import { compose, decompose } from '../src/core/composer.ts'
import { getAdaptiveKeys, getLeaderKeys, saveAdaptiveKey, saveLeaderKey } from '../src/core/features.ts'
import { addModule, hasModule, KNOWN_MODULES } from '../src/core/modules.ts'
import { buildRegistry } from '../src/core/behaviors.ts'
import { describe as legend } from '../src/core/describe.ts'
import { getLayers, layerDefines } from '../src/core/keymap.ts'
import { editKeymap, loadProject } from '../src/core/project.ts'
import { validateProject } from '../src/core/validate.ts'
import { detectProject } from '../server/project.ts'

const REPO = process.env.ZMK_CONFIG ?? join(homedir(), 'Work/zmk-charybdis')
const has = existsSync(join(REPO, 'config'))
const kp = (k: string) => ({ behavior: 'kp', params: [k] })
const file = () => parseDts(`/ {\n    behaviors {\n    };\n    keymap {\n        compatible = "zmk,keymap";\n        l0 { bindings = <&kp A &kp B>; };\n    };\n};\n`)

describe('leader keys', () => {
  it('writes the module\'s syntax and reads it back', () => {
    const f = file()
    const label = saveLeaderKey(f, { label: 'leader', name: 'Leader', ignoreKeys: ['LSHFT'], sequences: [
      { id: 'boot', keys: ['B', 'O', 'O', 'T'], bindings: [{ behavior: 'bootloader', params: [] }] },
      { id: '', keys: ['E', 'P'], bindings: [{ behavior: 'kp', params: ['LC(F4)'] }] },
    ] })
    const text = printDts(f)
    expect(text).toContain('compatible = "zmk,behavior-leader-key";')
    expect(text).toContain('boot { sequence = <B O O T>; bindings = <&bootloader>; };')
    expect(text).toContain('e_p { sequence = <E P>; bindings = <&kp LC(F4)>; };')
    expect(text).toContain('ignore-keys = <LSHFT>;')
    const again = parseDts(text)
    expect(getLeaderKeys(again)[0]).toMatchObject({ label, ignoreKeys: ['LSHFT'], sequences: [{ id: 'boot', keys: ['B', 'O', 'O', 'T'] }, { id: 'e_p', keys: ['E', 'P'] }] })
    expect(buildRegistry(again).get('leader')?.kind).toBe('leader')
  })
})

describe('adaptive keys', () => {
  it('writes triggers with timing and flags, and reads them back', () => {
    const f = file()
    saveAdaptiveKey(f, { label: 'ak_space', name: 'x', defaultBindings: [kp('SPACE')], deadKeys: [], triggers: [
      { id: 'after_stop', triggerKeys: ['DOT', 'QMARK'], bindings: [kp('SPACE'), { behavior: 'sk', params: ['LSHFT'] }], maxPriorIdleMs: 1000, strictModifiers: false, deletePrior: false },
      { id: 'rep', triggerKeys: ['A'], bindings: [{ behavior: 'key_repeat', params: [] }], strictModifiers: true, deletePrior: true, minPriorIdleMs: 50 },
    ] })
    const text = printDts(f)
    expect(text).toContain('after_stop { trigger-keys = <DOT QMARK>; max-prior-idle-ms = <1000>; bindings = <&kp SPACE &sk LSHFT>; };')
    expect(text).toContain('rep { trigger-keys = <A>; min-prior-idle-ms = <50>; strict-modifiers; delete-prior; bindings = <&key_repeat>; };')
    const ak = getAdaptiveKeys(parseDts(text))[0]
    expect(ak.defaultBindings).toEqual([kp('SPACE')])
    expect(ak.triggers[1]).toMatchObject({ strictModifiers: true, deletePrior: true, minPriorIdleMs: 50 })
  })

  it('can be the tap of a layer-tap thumb key (hold for NAV, tap for adaptive space)', () => {
    const f = file()
    saveAdaptiveKey(f, { label: 'ak_space', name: 'x', defaultBindings: [kp('SPACE')], deadKeys: [], triggers: [] })
    const b = compose({ tap: { behavior: 'ak_space', params: [] }, hold: { behavior: 'mo', params: ['1'] } }, f)
    expect(b).toEqual({ behavior: 'ht_mo_ak_space', params: ['1', '0'] })
    expect(decompose(b, f)).toMatchObject({ tap: { behavior: 'ak_space' }, hold: { behavior: 'mo', params: ['1'] } })
  })
})

describe('west.yml', () => {
  const west = `manifest:\n  remotes:\n    - name: zmkfirmware\n      url-base: https://github.com/zmkfirmware\n  projects:\n    - name: zmk\n      remote: zmkfirmware\n      revision: v0.3\n      import: app/west.yml\n  self:\n    path: config\n`
  it('adds urob\'s modules pinned to the ZMK release, once', () => {
    let t = addModule(west, KNOWN_MODULES[0])
    t = addModule(t, KNOWN_MODULES[1])
    t = addModule(t, KNOWN_MODULES[0])
    expect(t).toBe(`manifest:\n  remotes:\n    - name: zmkfirmware\n      url-base: https://github.com/zmkfirmware\n    - name: urob\n      url-base: https://github.com/urob\n  projects:\n    - name: zmk\n      remote: zmkfirmware\n      revision: v0.3\n      import: app/west.yml\n    - name: zmk-leader-key\n      remote: urob\n      revision: v0.3\n    - name: zmk-adaptive-key\n      remote: urob\n      revision: v0.3\n  self:\n    path: config\n`)
    expect(hasModule(t, 'zmk-adaptive-key')).toBe(true)
  })
})

describe.skipIf(!has)('on the Charybdis config', () => {
  it('flags a leader key whose module is missing, and long sequences', () => {
    const p = loadProject(detectProject(REPO))
    const q = editKeymap(p, (f) => { saveLeaderKey(f, { label: 'leader', name: 'L', ignoreKeys: [], sequences: [{ id: 'x', keys: ['A', 'B', 'C', 'D', 'E', 'F'], bindings: [kp('X')] }, { id: 'y', keys: ['A', 'B'], bindings: [kp('Y')] }] }) })
    const msgs = validateProject(q).map((i) => i.message).join('\n')
    expect(msgs).toContain('needs the zmk-leader-key module')
    expect(msgs).toContain('the limit is 5')
    expect(msgs).toContain('A B is the start of A B C D E F')
    const fixed = { ...q, west: { ...q.west!, text: addModule(q.west!.text, KNOWN_MODULES[0]) } }
    expect(validateProject(fixed).map((i) => i.message).join('\n')).not.toContain('needs the zmk-leader-key module')
  })

  it('shows legends for module behaviours', () => {
    const p = loadProject(detectProject(REPO))
    const f = structuredClone(p.keymap)
    saveLeaderKey(f, { label: 'leader', name: 'L', ignoreKeys: [], sequences: [] })
    saveAdaptiveKey(f, { label: 'ak_comma', name: 'x', defaultBindings: [kp('COMMA')], deadKeys: [], triggers: [] })
    const reg = buildRegistry(f)
    const ctx = { file: f, reg, layers: getLayers(f), defines: layerDefines(f), os: 'linux' as const }
    expect(legend({ behavior: 'leader', params: [] }, ctx).main).toBe('★ Leader')
    expect(legend({ behavior: 'ak_comma', params: [] }, ctx)).toMatchObject({ main: ',', adaptive: true })
    expect(readFileSync(join(REPO, 'config/west.yml'), 'utf8')).not.toContain('zmk-leader-key')
  })
})
