import { useEffect, useState } from 'react'
import { describeSimple } from '../../core/describe.ts'
import { behaviorUsage, deleteBehaviorNode, getMacros, saveMacro, textToMacroSteps, type Macro, type MacroMode, type MacroStep } from '../../core/features.ts'
import { formatBinding, type Binding } from '../../core/keymap.ts'
import { editKeymap } from '../../core/project.ts'
import { Picker } from '../components/Picker.tsx'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

export function MacrosView({ ctx, store, initial }: { ctx: Ctx; store: Store; initial?: string }) {
  const macros = getMacros(ctx.project.keymap)
  const [sel, setSel] = useState<string | undefined>(initial !== 'new' ? initial ?? macros[0]?.label : undefined)
  const macro = macros.find((m) => m.label === sel)

  const create = () => {
    let label = 'macro'
    for (let i = 2; macros.some((m) => m.label === label); i++) label = `macro_${i}`
    const m: Macro = { label, nodeName: label, name: 'New macro', bindingCells: 0, steps: [] }
    let saved = label
    store.apply((p) => editKeymap(p, (f) => { saved = saveMacro(f, m) }), 'New macro')
    setSel(saved)
  }
  useEffect(() => { if (initial === 'new') create() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = (m: Macro, label: string) => {
    let saved = m.label
    store.apply((p) => editKeymap(p, (f) => { saved = saveMacro(f, m, macro?.label) }), label)
    setSel(saved)
  }

  return (
    <div className="page">
      <h1>Macros</h1>
      <p className="lead">A sequence of key presses, waits and other behaviours sent by one key. Use them anywhere a key can go (the Macros category in the key picker).</p>
      <div className="split">
        <div className="card">
          <header><h2>{macros.length} macros</h2><span className="grow" /><button className="btn small primary" onClick={create}>+ New macro</button></header>
          <div className="list">
            {macros.map((m) => (
              <div key={m.label} className={`item ${m.label === sel ? 'active' : ''}`} onClick={() => setSel(m.label)}>
                <div className="grow">
                  <div style={{ fontWeight: 560 }}>⚡ {m.name}</div>
                  <div className="small muted mono">&{m.label} · {m.steps.length} steps</div>
                </div>
                <span className="small faint">used {behaviorUsage(ctx.project.keymap, m.label)}×</span>
              </div>
            ))}
            {!macros.length && <div className="empty">No macros yet.</div>}
          </div>
        </div>
        {macro ? <MacroEditor key={macro.label} ctx={ctx} macro={macro} onSave={save} onDelete={() => {
          const uses = behaviorUsage(ctx.project.keymap, macro.label)
          if (uses && !confirm(`&${macro.label} is used ${uses} time(s). Those keys will break. Delete anyway?`)) return
          store.apply((p) => editKeymap(p, (f) => deleteBehaviorNode(f, macro.label)), `Delete macro ${macro.name}`)
          setSel(undefined)
        }} /> : <div className="card empty">Select or create a macro.</div>}
      </div>
    </div>
  )
}

function stepText(s: MacroStep, ctx: Ctx): string {
  switch (s.kind) {
    case 'binding': { const d = describeSimple(s.binding, ctx.describe); return `${(d.mods ?? '') + d.main}` }
    case 'wait': return `Wait ${s.ms} ms`
    case 'tap-time': return `Hold each key ${s.ms} ms from here`
    case 'pause-for-release': return 'Pause until the macro key is released'
    case 'param': return `Use macro parameter (${s.code})`
  }
}

function MacroEditor({ ctx, macro, onSave, onDelete }: { ctx: Ctx; macro: Macro; onSave: (m: Macro, l: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(macro.name)
  const [label, setLabel] = useState(macro.label)
  const [text, setText] = useState('')
  const [picking, setPicking] = useState<{ index: number; mode: MacroMode } | null>(null)
  const setSteps = (steps: MacroStep[], l: string) => onSave({ ...macro, steps }, l)
  const move = (i: number, d: number) => {
    const s = [...macro.steps]
    const [x] = s.splice(i, 1)
    s.splice(i + d, 0, x)
    setSteps(s, 'Reorder macro')
  }
  const cur = picking && macro.steps[picking.index]?.kind === 'binding' ? (macro.steps[picking.index] as { binding: Binding }).binding : undefined

  return (
    <div className="card">
      <header>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== macro.name && onSave({ ...macro, name }, 'Rename macro')} style={{ fontWeight: 600 }} />
        <span className="mono small muted">&</span>
        <input type="text" className="mono" value={label} onChange={(e) => setLabel(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())} onBlur={() => label && label !== macro.label && onSave({ ...macro, label }, 'Rename macro label')} style={{ width: 150 }} title="The label used in the keymap. Renaming updates every key that uses it." />
        <span className="grow" />
        <button className="btn small danger" onClick={onDelete}>Delete</button>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="fields">
          <label className="field"><span>Wait between steps (ms)</span><input type="number" min={0} placeholder="15 (default)" value={macro.waitMs ?? ''} onChange={(e) => onSave({ ...macro, waitMs: e.target.value === '' ? undefined : Number(e.target.value) }, 'Macro wait')} /></label>
          <label className="field"><span>Key hold time (ms)</span><input type="number" min={0} placeholder="30 (default)" value={macro.tapMs ?? ''} onChange={(e) => onSave({ ...macro, tapMs: e.target.value === '' ? undefined : Number(e.target.value) }, 'Macro tap time')} /></label>
        </div>

        <div className="steps-list">
          {macro.steps.map((s, i) => (
            <div key={i} className="mstep">
              <span className="faint small" style={{ width: 18 }}>{i + 1}</span>
              {s.kind === 'binding' ? (
                <select value={s.mode} onChange={(e) => setSteps(macro.steps.map((x, j) => (j === i ? { ...s, mode: e.target.value as MacroMode } : x)), 'Macro step mode')}>
                  <option value="tap">Tap</option><option value="press">Press</option><option value="release">Release</option>
                </select>
              ) : <span className="pill">{s.kind}</span>}
              <span className="grow" style={{ cursor: s.kind === 'binding' ? 'pointer' : undefined }} onClick={() => s.kind === 'binding' && setPicking({ index: i, mode: s.mode })}>
                <b>{stepText(s, ctx)}</b> {s.kind === 'binding' && <span className="mono small faint">{formatBinding(s.binding)}</span>}
              </span>
              {s.kind === 'wait' && <input type="number" value={s.ms} style={{ width: 80 }} onChange={(e) => setSteps(macro.steps.map((x, j) => (j === i ? { kind: 'wait', ms: Number(e.target.value) } : x)), 'Macro wait')} />}
              <button className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button className="iconbtn" disabled={i === macro.steps.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button className="iconbtn" onClick={() => setSteps(macro.steps.filter((_, j) => j !== i), 'Remove macro step')}>✕</button>
            </div>
          ))}
          {!macro.steps.length && <div className="muted small">No steps yet.</div>}
        </div>
        <div className="row">
          <button className="btn small" onClick={() => { setSteps([...macro.steps, { kind: 'binding', mode: 'tap', binding: { behavior: 'kp', params: ['A'] } }], 'Add macro key'); setPicking({ index: macro.steps.length, mode: 'tap' }) }}>+ Key</button>
          <button className="btn small" onClick={() => setSteps([...macro.steps, { kind: 'wait', ms: 100 }], 'Add wait')}>+ Wait</button>
          <button className="btn small" onClick={() => setSteps([...macro.steps, { kind: 'pause-for-release' }], 'Add pause')} title="Steps after this run when the key is released (e.g. hold Alt while the key is held)">+ Pause until release</button>
        </div>
        <div className="field"><span>Type text</span>
          <div className="row">
            <input type="text" className="grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to type, e.g. Kind regards," />
            <button className="btn small" disabled={!text} onClick={() => {
              const { steps, unsupported } = textToMacroSteps(text)
              if (unsupported.length) alert(`These characters have no key on a US layout and were skipped: ${unsupported.join(' ')}`)
              setSteps([...macro.steps, ...steps], 'Add text to macro')
              setText('')
            }}>Add as key taps</button>
          </div>
          <span className="small faint">Assumes the computer uses a US/UK layout. For long text, a text expander on the computer is usually better.</span>
        </div>
        {picking && macro.steps[picking.index] && (
          <div className="card" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 8 }}><b>Step {picking.index + 1}</b><span className="grow" /><button className="btn small" onClick={() => setPicking(null)}>Done</button></div>
            <Picker ctx={ctx} value={cur} role="tap" onChange={(b) => setSteps(macro.steps.map((x, j) => (j === picking.index ? { kind: 'binding', mode: picking.mode, binding: b } : x)), `Macro step: ${formatBinding(b)}`)} />
          </div>
        )}
      </div>
    </div>
  )
}
