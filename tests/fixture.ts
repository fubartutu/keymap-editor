// The Charybdis tests check specific keys, layers and settings, so they run against a
// pinned snapshot of zmk-charybdis instead of the live working copy (which changes every
// time the keymap is edited). The snapshot is extracted from the local clone with
// `git archive`; it needs ~/Work/zmk-charybdis (or $ZMK_CONFIG_GIT) to have the commit.
// Set $ZMK_CONFIG to a directory to test against that instead (assertions may not match).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** zmk-charybdis main after switching to Miryoku (layers flip), 2026-11-25. */
export const FIXTURE_REV = '091f7cb'

function snapshot(): string {
  if (process.env.ZMK_CONFIG) return process.env.ZMK_CONFIG
  const clone = process.env.ZMK_CONFIG_GIT ?? join(homedir(), 'Work/zmk-charybdis')
  const missing = join(tmpdir(), 'zmk-charybdis-fixture-missing')
  if (!existsSync(join(clone, '.git'))) return missing
  const dir = join(tmpdir(), `zmk-charybdis-${FIXTURE_REV}`)
  if (existsSync(join(dir, 'config'))) return dir
  try {
    const tmp = mkdtempSync(join(tmpdir(), 'zmk-charybdis-'))
    const tar = execFileSync('git', ['-C', clone, 'archive', '--format=tar', FIXTURE_REV], { maxBuffer: 64 * 1024 * 1024 })
    execFileSync('tar', ['-x', '-C', tmp], { input: tar })
    // A bare repo so code that asks git about the project doesn't print errors.
    execFileSync('git', ['init', '-q', tmp])
    // Test files run in parallel: extract privately, then rename into place atomically.
    try {
      renameSync(tmp, dir)
    } catch {
      rmSync(tmp, { recursive: true, force: true })
    }
    return dir
  } catch {
    return missing
  }
}

export const REPO = snapshot()
