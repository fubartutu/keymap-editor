import type { ProjectFiles } from '../core/project.ts'

async function call<T>(method: string, path: string, data?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: data !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`)
  return json as T
}

export interface ProjectResponse { files?: ProjectFiles; validator?: boolean; validatorSupport?: { supported: boolean; reason?: string }; gh?: boolean; needsRepo?: boolean; suggestions?: string[] }
export interface FirmwareCheck { available: boolean; ok?: boolean; errors?: string[]; layers?: Record<string, number>; stage?: string }
export interface GitStatus { branch: string; ahead: number; behind: number; remote?: string; files: { status: string; path: string }[] }
export interface Run { databaseId: number; status: string; conclusion: string; headSha: string; displayTitle: string; createdAt: string; updatedAt: string; url: string; headBranch: string; event: string }
export interface Firmware { path: string; name: string; size: number; mtime: number }
export interface Drive { path: string; label: string; info: string }

export const api = {
  project: () => call<ProjectResponse>('GET', '/api/project'),
  setRepo: (path: string) => call<{ ok: boolean }>('POST', '/api/repo', { path }),
  save: (files: Record<string, string>) => call<{ ok: boolean; written: string[] }>('POST', '/api/save', { files }),
  validate: (keymap: string, keyCount: number) => call<FirmwareCheck>('POST', '/api/validate', { keymap, keyCount }),
  setupValidator: () => call<{ ok: boolean }>('POST', '/api/validator/setup', {}),
  gitStatus: () => call<GitStatus>('GET', '/api/git/status'),
  gitDiff: () => call<{ diff: string }>('GET', '/api/git/diff'),
  gitLog: () => call<{ commits: { hash: string; when: string; subject: string }[] }>('GET', '/api/git/log'),
  commit: (message: string, push: boolean) => call<{ ok: boolean; hash: string; output: string }>('POST', '/api/git/commit', { message, push }),
  builds: () => call<{ available: boolean; runs: Run[]; error?: string }>('GET', '/api/builds'),
  jobs: (id: number) => call<{ jobs: { name: string; status: string; conclusion: string; steps: { name: string; status: string; conclusion: string }[] }[] }>('GET', `/api/builds/jobs?id=${id}`),
  download: (id: number) => call<{ ok: boolean; firmware: Firmware[] }>('POST', '/api/builds/download', { id }),
  firmware: () => call<{ firmware: Firmware[] }>('GET', '/api/firmware'),
  drives: () => call<{ drives: Drive[] }>('GET', '/api/drives'),
  flash: (file: string, drive: string) => call<{ ok: boolean }>('POST', '/api/flash', { file, drive }),
}
