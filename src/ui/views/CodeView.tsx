import { useMemo, useState } from 'react'
import { printDts } from '../../core/dts.ts'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

/** Minimal line diff (LCS), plenty for keymap-sized files. */
export function lineDiff(a: string, b: string): { t: ' ' | '+' | '-'; s: string }[] {
  const x = a.split('\n'), y = b.split('\n')
  const n = x.length, m = y.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { t: ' ' | '+' | '-'; s: string }[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ t: ' ', s: x[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: x[i++] })
    else out.push({ t: '+', s: y[j++] })
  }
  while (i < n) out.push({ t: '-', s: x[i++] })
  while (j < m) out.push({ t: '+', s: y[j++] })
  return out
}

function compact(lines: { t: ' ' | '+' | '-'; s: string }[], context = 3) {
  const keep = new Set<number>()
  lines.forEach((l, i) => { if (l.t !== ' ') for (let k = i - context; k <= i + context; k++) keep.add(k) })
  const out: ({ t: ' ' | '+' | '-'; s: string } | { t: 'gap' })[] = []
  lines.forEach((l, i) => {
    if (keep.has(i)) out.push(l)
    else if (out.length && out[out.length - 1].t !== 'gap') out.push({ t: 'gap' })
  })
  return out
}

export function DiffView({ diff }: { diff: string }) {
  return (
    <div className="diff">
      {diff.split('\n').map((l, i) => <div key={i} className={l.startsWith('diff ') ? 'file' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : ''}>{l || ' '}</div>)}
    </div>
  )
}

export function CodeView({ ctx, store }: { ctx: Ctx; store: Store }) {
  const files = ctx.project.files
  const pending = store.pending
  const paths = [files.keymapPath, ...Object.keys(pending).filter((p) => p !== files.keymapPath)]
  const [sel, setSel] = useState(files.keymapPath)
  const [mode, setMode] = useState<'changes' | 'full'>(Object.keys(pending).length ? 'changes' : 'full')
  const original = sel === files.keymapPath ? files.keymap : files.overlays.find((o) => o.path === sel)?.text ?? files.confs.find((c) => c.path === sel)?.text ?? (sel === files.metaPath ? files.meta ?? '' : '')
  const current = pending[sel] ?? (sel === files.keymapPath ? printDts(ctx.project.keymap) : original)
  const diff = useMemo(() => compact(lineDiff(original, current)), [original, current])

  return (
    <div className="page">
      <h1>Code & changes</h1>
      <p className="lead">What will be written when you save. Edits you make here aren't possible: use the editor, or edit the files directly and press “Reload from disk”.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {paths.map((p) => <button key={p} className={`btn small ${sel === p ? 'primary' : ''}`} onClick={() => setSel(p)}>{p.split('/').pop()}{pending[p] !== undefined && ' •'}</button>)}
        <span className="grow" />
        <div className="segmented"><button className={mode === 'changes' ? 'active' : ''} onClick={() => setMode('changes')}>Changes</button><button className={mode === 'full' ? 'active' : ''} onClick={() => setMode('full')}>Whole file</button></div>
      </div>
      <div className="small muted mono" style={{ marginBottom: 6 }}>{sel}</div>
      {mode === 'full' ? <pre className="code">{current}</pre> : pending[sel] === undefined ? <div className="card empty">No changes to this file.</div> : (
        <div className="diff">
          {diff.map((l, i) => l.t === 'gap' ? <div key={i} className="hunk">⋯</div> : <div key={i} className={l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}>{l.t} {l.s}</div>)}
        </div>
      )}
    </div>
  )
}
