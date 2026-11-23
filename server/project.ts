import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import type { ProjectFiles, Features } from '../src/core/project.ts'
import type { ConfFile, Scope } from '../src/core/settings.ts'
import { gridLayout, layoutFromDtsi, layoutFromFile, layoutFromInfoJson, type Layout, type LayoutFile } from '../src/core/layout.ts'
import { getLayers } from '../src/core/keymap.ts'
import { parseDts } from '../src/core/dts.ts'

const EDITOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(p: string): string | null {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

function ls(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function findShieldDir(root: string, name: string): string | undefined {
  for (const base of [join(root, 'config', 'boards', 'shields'), join(root, 'boards', 'shields')]) {
    if (existsSync(join(base, name))) return join(base, name)
    // Shield folder may be named differently from the keymap (e.g. corne → crkbd).
    for (const d of ls(base)) if (ls(join(base, d)).some((f) => f.startsWith(name))) return join(base, d)
  }
}

/** Built-in display layouts shipped with the editor (prettier than a shield's grid). */
function bundledLayout(name: string, keyCount: number): Layout | undefined {
  const dir = join(EDITOR_ROOT, 'keyboards')
  for (const f of ls(dir)) {
    if (!f.endsWith('.json')) continue
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as LayoutFile & { match?: string[] }
    if ((data.match ?? [basename(f, '.json')]).includes(name) && data.keys.length === keyCount) return layoutFromFile(data)
  }
}

export function detectProject(root: string): ProjectFiles {
  const configDir = join(root, 'config')
  const keymaps = ls(configDir).filter((f) => f.endsWith('.keymap'))
  if (!keymaps.length) throw new Error(`No .keymap file in ${configDir}. Point the editor at a zmk-config repository.`)
  const keymapFile = keymaps[0]
  const name = basename(keymapFile, '.keymap')
  const keymapPath = join(configDir, keymapFile)
  const keymap = readFileSync(keymapPath, 'utf8')
  const shieldDir = findShieldDir(root, name)

  // Which half is the central (connects to the computer)?
  let central: 'left' | 'right' | undefined
  const defconfig = shieldDir ? read(join(shieldDir, 'Kconfig.defconfig')) ?? '' : ''
  const m = defconfig.match(/if\s+SHIELD_\w+_(LEFT|RIGHT)\b[^]*?config\s+ZMK_SPLIT_ROLE_CENTRAL|if\s+SHIELD_\w+_(LEFT|RIGHT)\b[^]*?config\s+ZMK_SPLIT_BLE_ROLE_CENTRAL/)
  if (m) central = (m[1] ?? m[2]).toLowerCase() as 'left' | 'right'
  const split = shieldDir ? ls(shieldDir).some((f) => /_(left|right)\.(overlay|conf)$/.test(f)) : false
  if (split && !central) central = 'left'

  const confs: ConfFile[] = []
  const addConf = (path: string, scope: Scope) => {
    const text = read(path)
    if (text !== null) confs.push({ path: relative(root, path), scope, text })
  }
  if (shieldDir) {
    addConf(join(shieldDir, `${name}.conf`), 'both')
    for (const side of ['left', 'right'] as const) {
      const p = join(shieldDir, `${name}_${side}.conf`)
      if (existsSync(p)) addConf(p, side === central ? 'central' : 'peripheral')
    }
  }
  // User config applies to every half and wins over the shield's own .conf files.
  const userConf = join(configDir, `${name}.conf`)
  if (existsSync(userConf)) addConf(userConf, 'both')
  else confs.push({ path: relative(root, userConf), scope: 'both', text: '' })

  const overlays = [] as { path: string; text: string }[]
  const overlayPaths = [
    ...(shieldDir ? ls(shieldDir).filter((f) => f.endsWith('.overlay')).map((f) => join(shieldDir, f)) : []),
    ...ls(configDir).filter((f) => f.endsWith('.overlay')).map((f) => join(configDir, f)),
  ]
  for (const p of overlayPaths) overlays.push({ path: relative(root, p), text: readFileSync(p, 'utf8') })

  // Layout: bundled pretty layout, then the shield's physical layout, then info.json, then a grid.
  let keyCount = 0
  try { keyCount = getLayers(parseDts(keymap))[0]?.bindings.length ?? 0 } catch { /* reported by the editor */ }
  let layout = bundledLayout(name, keyCount)
  if (!layout && shieldDir) {
    for (const f of ls(shieldDir).filter((x) => x.endsWith('.dtsi') || x.endsWith('.overlay'))) {
      const l = layoutFromDtsi(readFileSync(join(shieldDir, f), 'utf8'), name)
      if (l && l.keys.length === keyCount) { layout = l; break }
    }
  }
  if (!layout) {
    const info = read(join(configDir, `${name}.json`)) ?? read(join(configDir, 'info.json'))
    if (info) {
      const l = layoutFromInfoJson(JSON.parse(info))
      if (l && l.keys.length === keyCount) layout = l
    }
  }
  layout ??= gridLayout(keyCount)

  const allConf = confs.map((c) => c.text).join('\n')
  const allOverlay = overlays.map((o) => o.text).join('\n')
  const features: Features = {
    split,
    central,
    pmw3610: /CONFIG_PMW3610=y/.test(allConf) || /pixart,pmw3610/.test(allOverlay),
    autoMouse: /zmk,input-processor-temp-layer/.test(allOverlay),
    underglow: /CONFIG_ZMK_RGB_UNDERGLOW=y/.test(allConf) || /zmk,underglow/.test(allOverlay + (shieldDir ? ls(shieldDir).map((f) => read(join(shieldDir, f)) ?? '').join('\n') : '')),
  }

  let github: string | undefined
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
    github = url.match(/github\.com[:/](.+?)(\.git)?$/)?.[1]
  } catch { /* not a git repo */ }

  const metaPath = join(configDir, 'keymap-editor.json')
  return {
    root, name,
    keymapPath: relative(root, keymapPath),
    keymap, confs, overlays,
    metaPath: relative(root, metaPath),
    meta: read(metaPath),
    layout, features, github,
  }
}

export function isZmkConfig(dir: string): boolean {
  try { return statSync(join(dir, 'config')).isDirectory() && ls(join(dir, 'config')).some((f) => f.endsWith('.keymap')) } catch { return false }
}
