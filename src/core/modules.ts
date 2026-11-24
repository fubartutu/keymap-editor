/**
 * ZMK modules (extra behaviours loaded through config/west.yml) the editor knows how to edit.
 *
 * west.yml is edited as text (line-based), so comments and formatting are kept.
 */

export interface KnownModule {
  id: string
  name: string
  description: string
  remote: string
  urlBase: string
  /** Behaviour compatible the module provides. */
  compatible: string
  docs: string
  /** Revision to use for a given ZMK revision (urob's modules track ZMK releases). */
  revisionFor: (zmkRevision: string | undefined) => string
}

const matchZmk = (zmk: string | undefined) => (zmk && /^v\d+\.\d+$/.test(zmk) ? zmk : 'main')

export const KNOWN_MODULES: KnownModule[] = [
  {
    id: 'zmk-leader-key', name: 'Leader key', remote: 'urob', urlBase: 'https://github.com/urob',
    compatible: 'zmk,behavior-leader-key', docs: 'https://github.com/urob/zmk-leader-key',
    description: 'Press the leader key, then type a short sequence (e.g. B O O T) to run a behaviour.',
    revisionFor: matchZmk,
  },
  {
    id: 'zmk-adaptive-key', name: 'Adaptive key', remote: 'urob', urlBase: 'https://github.com/urob',
    compatible: 'zmk,behavior-adaptive-key', docs: 'https://github.com/urob/zmk-adaptive-key',
    description: 'A key that sends something else depending on the key typed just before it.',
    revisionFor: matchZmk,
  },
]

export interface WestFile { path: string; text: string }

interface Entry { name: string; start: number; end: number; fields: Record<string, string> }

/** Parse the `remotes:` or `projects:` list of a west manifest into entries with line ranges. */
function entries(lines: string[], section: 'remotes' | 'projects'): { entries: Entry[]; header: number; indent: string } {
  const header = lines.findIndex((l) => new RegExp(`^\\s*${section}:\\s*$`).test(l))
  if (header < 0) return { entries: [], header: -1, indent: '    ' }
  const sectionIndent = lines[header].match(/^\s*/)![0].length
  const out: Entry[] = []
  let indent = ' '.repeat(sectionIndent + 2)
  for (let i = header + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim() || l.trim().startsWith('#')) continue
    const ind = l.match(/^\s*/)![0].length
    if (ind <= sectionIndent && !l.trim().startsWith('-')) break
    if (ind < sectionIndent) break
    const m = l.match(/^(\s*)-\s+(\w[\w-]*):\s*(.*?)\s*$/)
    if (m) {
      indent = m[1]
      out.push({ name: '', start: i, end: i, fields: { [m[2]]: m[3] } })
    } else if (out.length) {
      const f = l.match(/^\s+(\w[\w-]*):\s*(.*?)\s*(#.*)?$/)
      if (f) out[out.length - 1].fields[f[1]] = f[2]
    }
    if (out.length) out[out.length - 1].end = i
  }
  for (const e of out) e.name = e.fields.name ?? ''
  return { entries: out, header, indent }
}

export function westProjects(text: string): Record<string, string>[] {
  return entries(text.split('\n'), 'projects').entries.map((e) => e.fields)
}

export function zmkRevision(text: string): string | undefined {
  return westProjects(text).find((p) => p.name === 'zmk')?.revision
}

export function hasModule(text: string | undefined, id: string): boolean {
  return !!text && westProjects(text).some((p) => p.name === id)
}

/** Add a module (and its remote if needed). Returns the new west.yml text. */
export function addModule(text: string, mod: KnownModule): string {
  if (hasModule(text, mod.id)) return text
  let lines = text.split('\n')
  const remotes = entries(lines, 'remotes')
  if (!remotes.entries.some((e) => e.name === mod.remote)) {
    const at = remotes.entries.length ? remotes.entries[remotes.entries.length - 1].end + 1 : remotes.header + 1
    const ind = remotes.indent
    lines.splice(at, 0, `${ind}- name: ${mod.remote}`, `${ind}  url-base: ${mod.urlBase}`)
  }
  const projects = entries(lines, 'projects')
  if (projects.header < 0) throw new Error('west.yml has no projects: section')
  const at = projects.entries.length ? projects.entries[projects.entries.length - 1].end + 1 : projects.header + 1
  const ind = projects.indent
  lines.splice(at, 0, `${ind}- name: ${mod.id}`, `${ind}  remote: ${mod.remote}`, `${ind}  revision: ${mod.revisionFor(zmkRevision(text))}`)
  lines = lines.map((l) => l.replace(/\s+$/, ''))
  return lines.join('\n').replace(/\n*$/, '\n')
}
