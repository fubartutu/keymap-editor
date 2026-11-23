/**
 * Local server for the ZMK keymap editor.
 *
 *   npm start -- --repo ~/Work/zmk-charybdis      (or set ZMK_CONFIG)
 *
 * Serves the web app on http://127.0.0.1:5185 and a small JSON API that reads and writes the
 * zmk-config repository, runs the firmware validator, talks to git and GitHub Actions (via
 * the `gh` CLI) and copies firmware onto a keyboard in bootloader mode.
 *
 * It only listens on 127.0.0.1 and rejects requests whose Host/Origin is not this server,
 * so other web pages can't use it.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, stat, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir, platform, tmpdir, userInfo } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { detectProject, isZmkConfig } from './project.ts'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const EDITOR_ROOT = resolve(HERE, '..')
const args = process.argv.slice(2)
const argValue = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const DEV = args.includes('--dev')
const PORT = Number(argValue('--port') ?? process.env.PORT ?? 5185)
const CACHE = process.env.ZMK_EDITOR_CACHE ?? join(homedir(), '.cache', 'zmk-keymap-editor')
const SETTINGS_FILE = join(homedir(), '.config', 'zmk-keymap-editor', 'settings.json')

function loadSettings(): { repo?: string } {
  try { return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) } catch { return {} }
}
function saveSettings(s: { repo?: string }) {
  mkdirSync(dirname(SETTINGS_FILE), { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2))
}

const expand = (p: string) => resolve(p.replace(/^~(?=$|[\\/])/, homedir()))
let repoRoot: string | undefined = [argValue('--repo'), process.env.ZMK_CONFIG, loadSettings().repo].filter(Boolean).map((p) => expand(p!)).find(isZmkConfig)

// ---------------------------------------------------------------------------
// helpers

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status } }

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

function requireRepo(): string {
  if (!repoRoot) throw new HttpError(409, 'No zmk-config repository selected')
  return repoRoot
}

/** Resolve a repo-relative path, refusing anything outside the repo. */
function inRepo(rel: string): string {
  const root = requireRepo()
  const abs = resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + sep)) throw new HttpError(400, `Path outside the repository: ${rel}`)
  return abs
}

async function git(argv: string[]) {
  return run('git', argv, { cwd: requireRepo(), maxBuffer: 20 * 1024 * 1024 })
}

/** `gh` picks the "upstream" remote of a fork by default; always target origin. */
function ghRepoArgs(): string[] {
  const gh = detectProject(requireRepo()).github
  return gh ? ['-R', gh] : []
}

async function hasCommand(cmd: string): Promise<boolean> {
  try { await run(platform() === 'win32' ? 'where' : 'which', [cmd]); return true } catch { return false }
}

function validatorReady(): boolean {
  return existsSync(join(CACHE, 'zmk', 'app', 'dts', 'behaviors.dtsi')) && existsSync(join(CACHE, 'zephyr', 'scripts', 'dts', 'python-devicetree'))
}

const PYTHON = platform() === 'win32' ? 'python' : 'python3'

// ---------------------------------------------------------------------------
// Bootloader drives (nice!nano shows up as a USB drive with INFO_UF2.TXT)

async function findDrives(): Promise<{ path: string; label: string; info: string }[]> {
  const candidates: string[] = []
  if (platform() === 'win32') {
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') candidates.push(`${l}:\\`)
  } else if (platform() === 'darwin') {
    for (const d of await readdir('/Volumes').catch(() => [])) candidates.push(join('/Volumes', d))
  } else {
    const user = userInfo().username
    for (const base of [`/run/media/${user}`, `/media/${user}`, '/media', '/mnt']) {
      for (const d of await readdir(base).catch(() => [] as string[])) candidates.push(join(base, d))
    }
  }
  const out = []
  for (const c of candidates) {
    try {
      const info = await readFile(join(c, 'INFO_UF2.TXT'), 'utf8')
      out.push({ path: c, label: basename(c) || c, info: info.split('\n').slice(0, 3).join(' · ') })
    } catch { /* not a UF2 drive */ }
  }
  return out
}

async function listFirmware(): Promise<{ path: string; name: string; size: number; mtime: number }[]> {
  const dir = inRepo('firmware')
  const out: { path: string; name: string; size: number; mtime: number }[] = []
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.uf2')) {
        const s = await stat(p)
        out.push({ path: p.slice(requireRepo().length + 1), name: e.name, size: s.size, mtime: s.mtimeMs })
      }
    }
  }
  await walk(dir)
  return out.sort((a, b) => b.mtime - a.mtime)
}

// ---------------------------------------------------------------------------
// API

type Handler = (req: IncomingMessage, url: URL) => Promise<unknown>
const routes: Record<string, Handler> = {
  'GET /api/project': async () => {
    if (!repoRoot) return { needsRepo: true, suggestions: [join(homedir(), 'Work', 'zmk-charybdis')].filter(isZmkConfig) }
    const files = detectProject(repoRoot)
    return { files, validator: validatorReady(), gh: await hasCommand('gh') }
  },

  'POST /api/repo': async (req) => {
    const { path } = await body(req)
    const abs = expand(String(path ?? ''))
    if (!isZmkConfig(abs)) throw new HttpError(400, `${abs} doesn't look like a zmk-config repository (no config/*.keymap)`)
    repoRoot = abs
    saveSettings({ ...loadSettings(), repo: abs })
    return { ok: true }
  },

  'POST /api/save': async (req) => {
    const { files } = await body(req) as { files: Record<string, string> }
    const root = requireRepo()
    const known = detectProject(root)
    const allowed = new Set([known.keymapPath, known.metaPath, ...known.confs.map((c) => c.path), ...known.overlays.map((o) => o.path)])
    for (const rel of Object.keys(files)) if (!allowed.has(rel)) throw new HttpError(400, `Refusing to write ${rel}`)
    for (const [rel, text] of Object.entries(files)) {
      const abs = inRepo(rel)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, text)
    }
    return { ok: true, written: Object.keys(files) }
  },

  'POST /api/validate': async (req) => {
    const { keymap, keyCount } = await body(req)
    if (!validatorReady()) return { available: false }
    const root = requireRepo()
    const project = detectProject(root)
    const dir = await mkdtemp(join(tmpdir(), 'zmk-validate-'))
    try {
      const file = join(dir, basename(project.keymapPath))
      await writeFile(file, keymap)
      const { stdout } = await run(PYTHON, ['-I', join(HERE, 'validate.py'), CACHE, file, String(keyCount), dirname(inRepo(project.keymapPath))], { maxBuffer: 10 * 1024 * 1024 })
      return { available: true, ...JSON.parse(stdout) }
    } catch (e: any) {
      return { available: true, ok: false, errors: [String(e.stderr || e.message).slice(-3000)] }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },

  'POST /api/validator/setup': async () => {
    await new Promise<void>((ok, fail) => {
      const p = spawn('bash', [join(HERE, 'setup-validator.sh')], { stdio: 'inherit' })
      p.on('exit', (code) => (code === 0 ? ok() : fail(new HttpError(500, 'Validator setup failed; run server/setup-validator.sh in a terminal to see why'))))
    })
    return { ok: validatorReady() }
  },

  'GET /api/git/status': async () => {
    const [{ stdout: branch }, { stdout: status }] = await Promise.all([git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['status', '--porcelain=v1', '-b'])])
    const lines = status.split('\n').filter(Boolean)
    const head = lines.shift() ?? ''
    const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0)
    const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0)
    let remote: string | undefined
    try { remote = (await git(['remote', 'get-url', 'origin'])).stdout.trim() } catch { /* no remote */ }
    return { branch: branch.trim(), ahead, behind, remote, files: lines.map((l) => ({ status: l.slice(0, 2), path: l.slice(3) })) }
  },

  'GET /api/git/diff': async () => {
    const { stdout } = await git(['diff', '--no-color'])
    return { diff: stdout }
  },

  'GET /api/git/log': async () => {
    const { stdout } = await git(['log', '-15', '--pretty=format:%h%x09%ar%x09%s'])
    return { commits: stdout.split('\n').filter(Boolean).map((l) => { const [hash, when, subject] = l.split('\t'); return { hash, when, subject } }) }
  },

  'POST /api/git/commit': async (req) => {
    const { message, push } = await body(req)
    if (!message || typeof message !== 'string') throw new HttpError(400, 'A commit message is needed')
    const root = requireRepo()
    const known = detectProject(root)
    const paths = [known.keymapPath, known.metaPath, ...known.confs.map((c) => c.path), ...known.overlays.map((o) => o.path)].filter((p) => existsSync(join(root, p)))
    await git(['add', '--', ...paths])
    const { stdout: staged } = await git(['diff', '--cached', '--name-only'])
    if (!staged.trim()) throw new HttpError(400, 'Nothing to commit: the keymap files have no changes')
    const out = [(await git(['commit', '-m', message])).stdout]
    if (push) {
      try {
        const r = await git(['push'])
        out.push(r.stdout, r.stderr)
      } catch (e: any) {
        throw new HttpError(500, `Committed, but the push failed:\n${e.stderr || e.message}`)
      }
    }
    const { stdout: hash } = await git(['rev-parse', 'HEAD'])
    return { ok: true, hash: hash.trim(), output: out.join('\n') }
  },

  'GET /api/builds': async () => {
    if (!(await hasCommand('gh'))) return { available: false, runs: [] }
    try {
      const { stdout } = await run('gh', ['run', 'list', ...ghRepoArgs(), '-L', '8', '--json', 'databaseId,status,conclusion,headSha,displayTitle,createdAt,updatedAt,url,headBranch,event'], { cwd: requireRepo() })
      return { available: true, runs: JSON.parse(stdout) }
    } catch (e: any) {
      return { available: true, runs: [], error: String(e.stderr || e.message) }
    }
  },

  'GET /api/builds/jobs': async (_req, url) => {
    const id = url.searchParams.get('id')
    if (!id || !/^\d+$/.test(id)) throw new HttpError(400, 'Bad run id')
    const { stdout } = await run('gh', ['run', 'view', id, ...ghRepoArgs(), '--json', 'jobs'], { cwd: requireRepo() })
    return JSON.parse(stdout)
  },

  'POST /api/builds/download': async (req) => {
    const { id } = await body(req)
    if (!/^\d+$/.test(String(id))) throw new HttpError(400, 'Bad run id')
    const dest = inRepo(join('firmware', `run-${id}`))
    await rm(dest, { recursive: true, force: true })
    await mkdir(dest, { recursive: true })
    await run('gh', ['run', 'download', String(id), ...ghRepoArgs(), '-D', dest], { cwd: requireRepo() })
    return { ok: true, firmware: (await listFirmware()).filter((f) => f.path.includes(`run-${id}`)) }
  },

  'GET /api/firmware': async () => ({ firmware: await listFirmware() }),

  'GET /api/drives': async () => ({ drives: await findDrives() }),

  'POST /api/flash': async (req) => {
    const { file, drive } = await body(req)
    const src = inRepo(String(file))
    if (extname(src) !== '.uf2') throw new HttpError(400, 'Only .uf2 files can be flashed')
    const drives = await findDrives()
    const target = drives.find((d) => d.path === drive)
    if (!target) throw new HttpError(400, 'That bootloader drive is no longer connected')
    try {
      await copyFile(src, join(target.path, basename(src)))
    } catch (e: any) {
      // The board reboots as soon as the image is complete, which can make the final write fail.
      if (!['EIO', 'ENOENT', 'ENODEV'].includes(e.code)) throw e
    }
    return { ok: true }
  },
}

// ---------------------------------------------------------------------------

function allowed(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  const okHost = new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`).test(host)
  const origin = req.headers.origin
  const okOrigin = !origin || new RegExp(`^http://(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`).test(origin)
  return okHost && okOrigin
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' }

async function main() {
  let vite: any
  if (DEV) {
    const { createServer: createVite } = await import('vite')
    vite = await createVite({ configFile: join(EDITOR_ROOT, 'vite.config.ts'), server: { middlewareMode: true, hmr: { port: PORT + 1 } }, appType: 'spa' })
  }
  const dist = join(EDITOR_ROOT, 'dist')

  const server = createServer(async (req, res) => {
    if (!allowed(req)) { res.writeHead(403); res.end('Forbidden'); return }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (url.pathname.startsWith('/api/')) {
      const handler = routes[`${req.method} ${url.pathname}`]
      if (!handler) return send(res, 404, { error: 'Not found' })
      if (req.method !== 'GET' && req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'JSON only' })
      try {
        send(res, 200, await handler(req, url))
      } catch (e: any) {
        send(res, e.status ?? 500, { error: e.message ?? String(e) })
      }
      return
    }
    if (vite) return vite.middlewares(req, res)
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const file = resolve(dist, rel)
    const safe = file.startsWith(dist + sep) && existsSync(file) ? file : join(dist, 'index.html')
    try {
      const data = await readFile(safe)
      res.writeHead(200, { 'content-type': MIME[extname(safe)] ?? 'application/octet-stream' })
      res.end(data)
    } catch {
      res.writeHead(500); res.end('Run "npm run build" first, or use "npm run dev".')
    }
  })
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`ZMK keymap editor: http://127.0.0.1:${PORT}`)
    console.log(repoRoot ? `Repository: ${repoRoot}` : 'No repository selected yet; pick one in the browser.')
    if (!validatorReady()) console.log('Firmware validator not set up: run server/setup-validator.sh (optional).')
  })
}

main()
