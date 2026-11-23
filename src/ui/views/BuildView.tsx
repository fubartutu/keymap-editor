import { useCallback, useEffect, useState } from 'react'
import { api, type Drive, type Firmware, type GitStatus, type Run } from '../api.ts'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'
import { DiffView } from './CodeView.tsx'

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export function BuildView({ ctx, store }: { ctx: Ctx; store: Store }) {
  const [git, setGit] = useState<GitStatus>()
  const [diff, setDiff] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string>()
  const [out, setOut] = useState<{ ok: boolean; text: string }>()
  const [runs, setRuns] = useState<Run[]>([])
  const [runsErr, setRunsErr] = useState<string>()
  const [firmware, setFirmware] = useState<Firmware[]>([])
  const [drives, setDrives] = useState<Drive[]>([])
  const [pushedSha, setPushedSha] = useState<string>()

  const refreshGit = useCallback(() => {
    api.gitStatus().then(setGit).catch(() => setGit(undefined))
    api.gitDiff().then((d) => setDiff(d.diff)).catch(() => {})
  }, [])
  const refreshRuns = useCallback(() => {
    if (!store.gh) return
    api.builds().then((r) => { setRuns(r.runs); setRunsErr(r.error) }).catch((e) => setRunsErr(e.message))
  }, [store.gh])
  const refreshFirmware = useCallback(() => { api.firmware().then((f) => setFirmware(f.firmware)).catch(() => {}) }, [])

  useEffect(() => { refreshGit(); refreshRuns(); refreshFirmware() }, [refreshGit, refreshRuns, refreshFirmware, store.dirty])
  // Poll the build while one is running.
  const running = runs.some((r) => r.status !== 'completed')
  useEffect(() => {
    if (!running && !pushedSha) return
    const t = setInterval(refreshRuns, 8000)
    return () => clearInterval(t)
  }, [running, pushedSha, refreshRuns])
  // Watch for the bootloader drive.
  useEffect(() => {
    const poll = () => api.drives().then((d) => setDrives(d.drives)).catch(() => {})
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [])

  const commit = async (push: boolean) => {
    if (push && !confirm(`Commit and push to ${git?.remote ?? 'origin'} (${git?.branch})? GitHub Actions will build the firmware.`)) return
    setBusy(push ? 'push' : 'commit')
    setOut(undefined)
    try {
      const r = await api.commit(msg, push)
      setOut({ ok: true, text: `Committed ${r.hash.slice(0, 7)}${push ? ' and pushed' : ''}.\n${r.output}` })
      setMsg('')
      if (push) setPushedSha(r.hash)
      refreshGit()
      setTimeout(refreshRuns, 4000)
    } catch (e) {
      setOut({ ok: false, text: e instanceof Error ? e.message : String(e) })
      refreshGit()
    } finally {
      setBusy(undefined)
    }
  }

  const keymapFiles = git?.files ?? []
  const latestByName = new Map<string, Firmware>()
  for (const f of firmware) if (!latestByName.has(f.name)) latestByName.set(f.name, f)
  const central = ctx.project.files.features.central

  return (
    <div className="page">
      <h1>Build & flash</h1>
      <p className="lead">Save your changes, push them so GitHub Actions builds the firmware, then copy it onto each half.</p>

      <div style={{ display: 'grid', gap: 16 }}>
        <section className="card">
          <header><h2>1 · Save & check</h2><span className="grow" />
            {store.dirty ? <button className="btn primary small" onClick={store.save}>Save {Object.keys(store.pending).length} file(s)</button> : <span className="pill ok">saved</span>}
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row">
              <span className={`pill ${store.issues.some((i) => i.severity === 'error') ? 'err' : 'ok'}`}>{store.issues.filter((i) => i.severity === 'error').length} errors</span>
              <span className="pill">{store.issues.filter((i) => i.severity === 'warning').length} warnings</span>
              {store.validator ? (
                <button className="btn small" disabled={busy === 'check'} onClick={async () => { setBusy('check'); await store.checkFirmware().finally(() => setBusy(undefined)) }}>{busy === 'check' ? 'Checking…' : 'Run firmware check'}</button>
              ) : (
                <button className="btn small" disabled={busy === 'setup'} onClick={async () => { setBusy('setup'); try { const r = await api.setupValidator(); store.setValidator(r.ok) } catch (e) { alert(String(e)) } finally { setBusy(undefined) } }}>{busy === 'setup' ? 'Downloading ZMK headers…' : 'Set up firmware check (≈15 MB)'}</button>
              )}
              {store.firmwareCheck && (store.firmwareCheck.ok ? <span className="pill ok">firmware check passed: {Object.keys(store.firmwareCheck.layers ?? {}).length} layers × {ctx.project.files.layout.keys.length} keys</span> : <span className="pill err">firmware check failed</span>)}
            </div>
            {store.firmwareCheck && !store.firmwareCheck.ok && <pre className="code">{(store.firmwareCheck.errors ?? []).join('\n')}</pre>}
            <p className="small muted" style={{ margin: 0 }}>The firmware check runs the C preprocessor with ZMK's real headers and Zephyr's devicetree parser, and counts every layer's bindings the way the build does. It catches most build failures in a second, without waiting for GitHub.</p>
            {store.notes.length > 0 && <div className="banner">{store.notes.map((n) => <div key={n}>{n}</div>)}</div>}
          </div>
        </section>

        <section className="card">
          <header><h2>2 · Commit & push</h2>{git && <span className="small muted mono">{git.branch}{git.ahead ? ` · ${git.ahead} ahead` : ''}{git.behind ? ` · ${git.behind} behind` : ''}</span>}<span className="grow" /><button className="btn small ghost" onClick={refreshGit}>Refresh</button></header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!git ? <div className="muted">Not a git repository.</div> : keymapFiles.length === 0 ? <div className="muted small">No uncommitted changes.</div> : (
              <>
                <div className="small">{keymapFiles.map((f) => <div key={f.path} className="mono"><span className="faint">{f.status}</span> {f.path}</div>)}</div>
                {diff && <details><summary className="small muted" style={{ cursor: 'pointer' }}>Show diff</summary><DiffView diff={diff} /></details>}
                <div className="row">
                  <input type="text" className="grow" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What changed? e.g. Move Esc to a combo" />
                  <button className="btn" disabled={!msg || !!busy || store.dirty} onClick={() => commit(false)}>Commit</button>
                  <button className="btn primary" disabled={!msg || !!busy || store.dirty} onClick={() => commit(true)}>{busy === 'push' ? 'Pushing…' : 'Commit & push'}</button>
                </div>
                {store.dirty && <div className="small" style={{ color: 'var(--warn)' }}>Save first: unsaved changes aren't in the commit.</div>}
                <div className="small faint">Only the keymap, .conf, overlay and editor files are committed. Other changes in the repository are left alone.</div>
              </>
            )}
            {git?.ahead ? <div className="row"><span className="small muted">{git.ahead} commit(s) not pushed yet.</span></div> : null}
            {out && <pre className={`code`} style={{ color: out.ok ? 'var(--ok)' : 'var(--danger)' }}>{out.text}</pre>}
          </div>
        </section>

        <section className="card">
          <header><h2>3 · GitHub build</h2><span className="grow" />{store.gh && <button className="btn small ghost" onClick={refreshRuns}>Refresh</button>}</header>
          <div className="content">
            {!store.gh ? <div className="muted small">Install and log in to the GitHub CLI (<code>gh auth login</code>) to follow builds here. Otherwise use the Actions tab on GitHub.</div> : (
              <>
                {runsErr && <div className="banner err">{runsErr}</div>}
                <div className="list card" style={{ border: 0 }}>
                  {runs.slice(0, 6).map((r) => <RunRow key={r.databaseId} run={r} highlight={r.headSha === pushedSha} onDownloaded={refreshFirmware} />)}
                  {!runs.length && <div className="muted small">No builds yet.</div>}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card">
          <header><h2>4 · Flash</h2></header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>Plug one half in by USB and put it in bootloader mode: double-tap its reset button{ctx.reg.get('bootloader') && ' or press a Bootloader key (e.g. on your mode layer)'}.</li>
              <li>A drive (NICENANO / DXNICEBOOT) appears below. Click <b>Flash</b> on that half's file. The half restarts by itself.</li>
              <li>Repeat for the other half. Flash <b>both</b> halves after changing settings; keymap-only changes need just the {central ?? 'central'} half.</li>
            </ol>
            <div className="row">
              <b className="small">Bootloader drives:</b>
              {drives.length ? drives.map((d) => <span key={d.path} className="pill ok" title={d.info}>{d.label} <span className="mono">{d.path}</span></span>) : <span className="pill">none connected (checking every 2s)</span>}
            </div>
            <div className="list card" style={{ border: 0 }}>
              {[...latestByName.values()].map((f) => (
                <div key={f.path} className="item" style={{ cursor: 'default' }}>
                  <div className="grow">
                    <div style={{ fontWeight: 560 }}>{f.name.replace(/-nice_nano_v2-zmk\.uf2$/, '').replace(/_/g, ' ')}
                      {f.name.startsWith('settings_reset') && <span className="pill warn" style={{ marginLeft: 6 }}>wipes pairings</span>}
                      {central && f.name.includes(`_${central}`) && <span className="pill accent" style={{ marginLeft: 6 }}>central</span>}
                    </div>
                    <div className="small muted mono">{f.path} · {Math.round(f.size / 1024)} KB · {ago(new Date(f.mtime).toISOString())}</div>
                  </div>
                  {drives.map((d) => (
                    <button key={d.path} className="btn small primary" onClick={async () => {
                      if (f.name.startsWith('settings_reset') && !confirm('settings_reset erases all Bluetooth pairings and stored settings on this half. Continue?')) return
                      try { await api.flash(f.path, d.path); alert(`Copied ${f.name} to ${d.label}. The half restarts with the new firmware.`) } catch (e) { alert(String(e)) }
                    }}>Flash → {d.label}</button>
                  ))}
                </div>
              ))}
              {!firmware.length && <div className="muted small">No firmware downloaded yet. Download it from a finished build above.</div>}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function RunRow({ run, highlight, onDownloaded }: { run: Run; highlight: boolean; onDownloaded: () => void }) {
  const [busy, setBusy] = useState(false)
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof api.jobs>>['jobs']>()
  const state = run.status !== 'completed' ? 'running' : run.conclusion
  return (
    <div className="item" style={{ cursor: 'default', flexWrap: 'wrap', background: highlight ? 'var(--accent-soft)' : undefined }}>
      <span className={`pill ${state === 'success' ? 'ok' : state === 'running' ? 'warn' : 'err'}`}>{state === 'running' ? `● ${run.status}` : state}</span>
      <div className="grow">
        <div style={{ fontWeight: 560 }}>{run.displayTitle}</div>
        <div className="small muted"><span className="mono">{run.headBranch} · {run.headSha.slice(0, 7)}</span> · {ago(run.createdAt)} · <a href={run.url} target="_blank" rel="noreferrer">GitHub</a> · <a href="#" onClick={(e) => { e.preventDefault(); api.jobs(run.databaseId).then((j) => setJobs(j.jobs)) }}>details</a></div>
      </div>
      {run.conclusion === 'success' && <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); try { await api.download(run.databaseId); onDownloaded() } catch (e) { alert(String(e)) } finally { setBusy(false) } }}>{busy ? 'Downloading…' : 'Download firmware'}</button>}
      {jobs && <div style={{ width: '100%' }} className="small">{jobs.map((j) => <div key={j.name}><span className={j.conclusion === 'success' ? '' : 'faint'}>{j.conclusion === 'success' ? '✓' : j.conclusion === 'failure' ? '✗' : '…'}</span> {j.name}{j.conclusion === 'failure' && <> — {j.steps.filter((s) => s.conclusion === 'failure').map((s) => s.name).join(', ')}</>}</div>)}</div>}
    </div>
  )
}
