import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { printDts } from '../src/core/dts.ts'
import { loadProject, serializeProject } from '../src/core/project.ts'
import { SETTINGS } from '../src/core/settings.ts'
import { readSetting, writeSetting } from '../src/core/settingsio.ts'
import { detectProject } from '../server/project.ts'

const REPO = process.env.ZMK_CONFIG ?? join(homedir(), 'Work/zmk-charybdis')
const get = (id: string) => SETTINGS.find((s) => s.id === id)!

describe.skipIf(!existsSync(join(REPO, 'config')))('settings on the Charybdis config', () => {
  const p = loadProject(detectProject(REPO))

  it('reads current values from all kinds of targets', () => {
    expect(readSetting(p, get('cpi')).value).toBe(400)
    expect(readSetting(p, get('cpi')).where).toBe('config/boards/shields/charybdis/charybdis_right.conf')
    expect(readSetting(p, get('orientation')).value).toBe('90')
    expect(readSetting(p, get('tx-power')).value).toBe('+8')
    expect(readSetting(p, get('phy-2m')).value).toBe(false)
    expect(readSetting(p, get('name')).value).toBe('XI-MK1_2')
    expect(readSetting(p, get('mt-flavor')).value).toBe('tap-preferred')
    expect(readSetting(p, get('msc-speed')).value).toBe(25)
    expect(readSetting(p, get('am-layer')).value).toBe(7)
    expect(readSetting(p, get('am-timeout')).value).toBe(700)
    expect(readSetting(p, get('scroll-layers')).value).toEqual([9])
    expect(readSetting(p, get('sleep')).value).toBeUndefined()
  })

  it('writes Kconfig, choices, overrides, defines and overlay values', () => {
    let q = writeSetting(p, get('cpi'), 800)
    q = writeSetting(q, get('orientation'), '180')
    q = writeSetting(q, get('sleep'), true)
    q = writeSetting(q, get('lt-term'), 250)
    q = writeSetting(q, get('mmv-speed'), 900)
    q = writeSetting(q, get('am-timeout'), 500)
    const files = serializeProject(q).files
    const right = files['config/boards/shields/charybdis/charybdis_right.conf']
    expect(right).toContain('CONFIG_PMW3610_CPI=800')
    expect(right).toContain('CONFIG_PMW3610_ORIENTATION_180=y')
    expect(right).not.toContain('ORIENTATION_90')
    expect(files['config/charybdis.conf']).toMatch(/CONFIG_ZMK_SLEEP=y\n$/)
    const km = files['config/charybdis.keymap']
    expect(km).toMatch(/&lt \{[^}]*tapping-term-ms = <250>;/)
    // A pointing default must be defined before pointing.h is included.
    expect(km.indexOf('#define ZMK_POINTING_DEFAULT_MOVE_VAL 900')).toBeLessThan(km.indexOf('#include <dt-bindings/zmk/pointing.h>'))
    expect(files['config/boards/shields/charybdis/charybdis_right.overlay']).toContain('input-processors = <&zip_auto_mouse 7 500>;')
  })

  it('resetting removes the line and empty overrides', () => {
    let q = writeSetting(p, get('sk-release'), 2000)
    expect(printDts(q.keymap)).toContain('&sk {')
    q = writeSetting(q, get('sk-release'), undefined)
    expect(printDts(q.keymap)).not.toContain('&sk {')
    expect(serializeProject(q).files).toEqual({})
  })
})
