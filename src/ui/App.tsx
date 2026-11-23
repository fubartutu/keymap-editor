import { useEffect, useState } from 'react'
import { api, type ProjectResponse } from './api.ts'
import { useStore } from './store.ts'
import { makeCtx } from './context.ts'
import type { ProjectFiles } from '../core/project.ts'
import { LayoutView } from './views/LayoutView.tsx'
import { CombosView } from './views/CombosView.tsx'
import { MacrosView } from './views/MacrosView.tsx'
import { BehaviorsView } from './views/BehaviorsView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import { BuildView } from './views/BuildView.tsx'
import { CodeView } from './views/CodeView.tsx'
import { IssuesView } from './views/IssuesView.tsx'
import { useLive, type Live } from './live.ts'
import { findKconfig, unquoteConf } from '../core/settings.ts'

export function App() {
  const [resp, setResp] = useState<ProjectResponse>()
  const [error, setError] = useState<string>()
  const load = () => api.project().then(setResp, (e) => setError(String(e.message ?? e)))
  useEffect(() => { load() }, [])

  if (error) return <div className="page"><div className="banner err">Could not reach the editor server: {error}</div></div>
  if (!resp) return <div className="empty">Loading…</div>
  if (resp.needsRepo || !resp.files) return <RepoPicker suggestions={resp.suggestions ?? []} onPicked={load} />
  return <Editor key={resp.files.root} files={resp.files} validator={!!resp.validator} gh={!!resp.gh} onReload={load} />
}

function RepoPicker({ suggestions, onPicked }: { suggestions: string[]; onPicked: () => void }) {
  const [path, setPath] = useState(suggestions[0] ?? '')
  const [err, setErr] = useState<string>()
  return (
    <div className="page" style={{ maxWidth: 620, marginTop: 80 }}>
      <h1>Open a zmk-config repository</h1>
      <p className="lead">The folder that contains <code>config/&lt;keyboard&gt;.keymap</code> and <code>build.yaml</code>, cloned from GitHub.</p>
      <div className="row">
        <input type="text" className="grow mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/zmk-config" />
        <button className="btn primary" onClick={() => api.setRepo(path).then(onPicked, (e) => setErr(e.message))}>Open</button>
      </div>
      {err && <div className="banner err" style={{ marginTop: 12 }}>{err}</div>}
    </div>
  )
}

const NAV = [
  { id: 'layout', label: 'Layout', icon: '⌨' },
  { id: 'combos', label: 'Combos', icon: '⊕' },
  { id: 'macros', label: 'Macros', icon: '⚡' },
  { id: 'behaviours', label: 'Behaviours', icon: '⚙' },
  { id: 'settings', label: 'Settings', icon: '☰' },
  { id: 'sep' },
  { id: 'build', label: 'Build & flash', icon: '⬆' },
  { id: 'code', label: 'Code & changes', icon: '</>' },
  { id: 'issues', label: 'Problems', icon: '⚠' },
] as const

function Editor({ files, validator, gh, onReload }: { files: ProjectFiles; validator: boolean; gh: boolean; onReload: () => void }) {
  const store = useStore(files, validator, gh)
  const ctx = makeCtx(store.project)
  const [view, setView] = useState(() => location.hash.slice(1).split('/')[0] || 'layout')
  const [viewArg, setViewArg] = useState<string | undefined>(() => location.hash.slice(1).split('/')[1])
  const [layer, setLayer] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const [toast, setToast] = useState<string>()
  const kbName = findKconfig(store.project.confs, 'ZMK_KEYBOARD_NAME')?.value
  const live = useLive(kbName ? unquoteConf(kbName) : undefined)

  const goto = (v: string, arg?: string) => { setView(v); setViewArg(arg); location.hash = arg ? `${v}/${arg}` : v }
  useEffect(() => { if (layer >= ctx.layers.length) setLayer(Math.max(0, ctx.layers.length - 1)) }, [ctx.layers.length, layer])

  useEffect(() => {
    if (!store.lastAction) return
    setToast(store.lastAction)
    const t = setTimeout(() => setToast(undefined), 1800)
    return () => clearTimeout(t)
  }, [store.lastAction, store.project])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const inField = (e.target as HTMLElement).closest('input, textarea, [contenteditable]')
      if (e.key === 's') { e.preventDefault(); store.save() }
      else if (!inField && e.key === 'z' && !e.shiftKey) { e.preventDefault(); store.undo() }
      else if (!inField && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z')) { e.preventDefault(); store.redo() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [store])

  const errors = store.issues.filter((i) => i.severity === 'error').length
  const warnings = store.issues.filter((i) => i.severity === 'warning').length
  const changed = Object.keys(store.pending)

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><img src="/favicon.svg" alt="" />ZMK Keymap Editor <small>· {files.name}{files.features.split ? ' (split)' : ''}</small></div>
        <span className="spacer" />
        <LiveChip live={live} />
        <span className={`status ${store.dirty ? 'dirty' : ''}`} title={changed.join('\n')}>
          {store.saving ? 'Saving…' : store.saveError ? `Save failed: ${store.saveError}` : store.dirty ? `Unsaved: ${changed.map((p) => p.split('/').pop()).join(', ')}` : 'All changes saved'}
        </span>
        <button className="btn ghost small" disabled={!store.canUndo} onClick={store.undo} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="btn ghost small" disabled={!store.canRedo} onClick={store.redo} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        {store.dirty && <button className="btn small" onClick={() => confirm('Discard all unsaved changes?') && store.revert()}>Discard</button>}
        <button className="btn primary small" disabled={!store.dirty || store.saving} onClick={store.save} title="Write the files to the repository (Ctrl+S)">Save</button>
      </div>
      <div className="body">
        <nav className="nav">
          {NAV.map((n) => n.id === 'sep' ? <div key="sep" className="sep" /> : (
            <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => goto(n.id)}>
              <span style={{ width: 18, textAlign: 'center' }}>{n.icon}</span>{n.label}
              {n.id === 'issues' && (errors || warnings) ? <span className={`count ${errors ? 'err' : ''}`}>{errors || warnings}</span> : null}
              {n.id === 'combos' && <span className="count">{countOf(ctx, 'combos')}</span>}
              {n.id === 'macros' && <span className="count">{countOf(ctx, 'macros')}</span>}
              {n.id === 'build' && changed.length > 0 && <span className="count">{changed.length}</span>}
            </button>
          ))}
          <div className="foot">
            <div>{ctx.layers.length} layers · {files.layout.keys.length} keys</div>
            <div className="mono" title={files.root} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{files.root.replace(/^\/home\/[^/]+/, '~')}</div>
            <button className="btn small ghost" style={{ marginTop: 6, padding: '2px 0' }} onClick={() => { if (!store.dirty || confirm('Reload from disk and lose unsaved changes?')) onReload() }}>Reload from disk</button>
          </div>
        </nav>
        <main className="main">
          {view === 'layout' && <LayoutView ctx={ctx} store={store} layer={layer} setLayer={setLayer} selected={selected} setSelected={setSelected} goto={goto} live={live} />}
          {view === 'combos' && <CombosView ctx={ctx} store={store} initial={viewArg} />}
          {view === 'macros' && <MacrosView ctx={ctx} store={store} initial={viewArg} />}
          {view === 'behaviours' && <BehaviorsView ctx={ctx} store={store} initial={viewArg} />}
          {view === 'settings' && <SettingsView ctx={ctx} store={store} />}
          {view === 'build' && <BuildView ctx={ctx} store={store} />}
          {view === 'code' && <CodeView ctx={ctx} store={store} />}
          {view === 'issues' && <IssuesView ctx={ctx} store={store} onOpen={(i) => {
            if (i.layer !== undefined) { setLayer(i.layer); setSelected(i.key !== undefined ? [i.key] : []); goto('layout') }
            else if (i.combo) goto('combos', i.combo)
            else if (i.behavior) goto('behaviours', i.behavior)
          }} />}
        </main>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

import { getCombos, getMacros } from '../core/features.ts'
import type { Ctx } from './context.ts'
function countOf(ctx: Ctx, what: 'combos' | 'macros'): number {
  return what === 'combos' ? getCombos(ctx.project.keymap).length : getMacros(ctx.project.keymap).length
}

function LiveChip({ live }: { live: Live }) {
  if (!live.supported) return <span className="pill" title="Live mode needs a Chromium-based browser (WebHID)">live: needs Chrome/Edge</span>
  if (!live.connected) return <button className="btn small" onClick={live.connect} title={live.error ?? 'Connect to the keyboard over Raw HID to see layers and key presses live'}>⚡ Connect keyboard{live.error ? ' (!)' : ''}</button>
  const s = live.status
  const batt = (side: string, pct: number | null) => <span className={`pill ${pct !== null && pct <= 20 ? 'err' : ''}`}>{side} {pct === null ? '–' : pct + '%'}</span>
  return (
    <span className="row" style={{ gap: 4 }} title={`Live: ${live.name}`}>
      <span className="pill ok">● live</span>
      {s && <>{batt('L', s.battery.peripheral)}{batt('R', s.battery.central)}
        {!s.halvesConnected && <span className="pill err">left half offline</span>}
        <span className={`pill ${s.output === 'Bluetooth' && !s.profileConnected ? 'warn' : ''}`}>{s.output === 'USB' ? 'USB' : `BT ${s.profile}${s.profileOpen ? ' unpaired' : s.profileConnected ? '' : ' not connected'}`}</span></>}
      <button className="iconbtn small" onClick={live.disconnect} title="Disconnect">✕</button>
    </span>
  )
}
