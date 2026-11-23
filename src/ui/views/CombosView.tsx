import { useEffect, useMemo, useState } from 'react'
import { describe } from '../../core/describe.ts'
import { deleteCombo, getCombos, saveCombo, type Combo } from '../../core/features.ts'
import { formatBinding, layerToken, resolveLayer, NONE } from '../../core/keymap.ts'
import { editKeymap, layerColor } from '../../core/project.ts'
import { Keyboard } from '../components/Keyboard.tsx'
import { Picker } from '../components/Picker.tsx'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

export function CombosView({ ctx, store, initial }: { ctx: Ctx; store: Store; initial?: string }) {
  const combos = getCombos(ctx.project.keymap)
  const [sel, setSel] = useState<string | undefined>(initial ?? combos[0]?.id)
  const combo = combos.find((c) => c.id === sel)
  const comboIssues = store.issues.filter((i) => i.combo)

  const save = (next: Combo, label: string) => {
    let newId = next.id
    store.apply((p) => editKeymap(p, (f) => { newId = saveCombo(f, next, combo?.id) }), label)
    setSel(newId)
  }

  const create = () => {
    const base = 'combo_new'
    let id = base
    for (let i = 2; combos.some((c) => c.id === id); i++) id = `${base}_${i}`
    const fresh: Combo = { id, positions: [], binding: { behavior: 'kp', params: ['ESC'] }, layers: [], timeoutMs: 50, requirePriorIdleMs: 150, slowRelease: false }
    store.apply((p) => editKeymap(p, (f) => { saveCombo(f, fresh) }), 'Add combo')
    setSel(id)
  }

  return (
    <div className="page">
      <h1>Combos</h1>
      <p className="lead">Press two or more keys together to do something else. Click keys on the keyboard to choose them.</p>
      <div className="split">
        <div className="card">
          <header><h2>{combos.length} combos</h2><span className="grow" /><button className="btn small primary" onClick={create}>+ New combo</button></header>
          <div className="list">
            {combos.map((c) => {
              const lg = describe(c.binding, ctx.describe)
              const bad = comboIssues.some((i) => i.combo === c.id && i.severity === 'error')
              return (
                <div key={c.id} className={`item ${c.id === sel ? 'active' : ''}`} onClick={() => setSel(c.id)}>
                  <div className="grow">
                    <div style={{ fontWeight: 560 }}>{c.id.replace(/^combo_/, '').replace(/_/g, ' ')}{bad && <span className="pill err" style={{ marginLeft: 6 }}>problem</span>}</div>
                    <div className="small muted">{c.positions.map((p) => describe(ctx.layers[0]?.bindings[p] ?? NONE, ctx.describe).main || p).join(' + ')} → <b>{(lg.mods ?? '') + lg.main}</b></div>
                  </div>
                  <span className="small faint">{c.layers.length ? c.layers.map((l) => ctx.layers[resolveLayer(l, ctx.defines) ?? -1]?.name ?? l).join(', ') : 'all layers'}</span>
                </div>
              )
            })}
            {!combos.length && <div className="empty">No combos yet.</div>}
          </div>
        </div>
        {combo ? <ComboEditor key={combo.id} ctx={ctx} combo={combo} all={combos} onSave={save} onDelete={() => { store.apply((p) => editKeymap(p, (f) => deleteCombo(f, combo.id)), `Delete ${combo.id}`); setSel(undefined) }} /> : <div className="card empty">Select or create a combo.</div>}
      </div>
    </div>
  )
}

function ComboEditor({ ctx, combo, all, onSave, onDelete }: { ctx: Ctx; combo: Combo; all: Combo[]; onSave: (c: Combo, label: string) => void; onDelete: () => void }) {
  const [name, setName] = useState(combo.id)
  useEffect(() => setName(combo.id), [combo.id])
  const shownLayer = useMemo(() => (combo.layers.length ? resolveLayer(combo.layers[0], ctx.defines) ?? 0 : 0), [combo, ctx.defines])
  const others = new Set(all.filter((c) => c.id !== combo.id).flatMap((c) => c.positions))
  const layer = ctx.layers[shownLayer]
  const toggle = (pos: number) => {
    const positions = combo.positions.includes(pos) ? combo.positions.filter((p) => p !== pos) : [...combo.positions, pos].sort((a, b) => a - b)
    onSave({ ...combo, positions }, `Combo keys: ${positions.join(' ')}`)
  }
  const num = (v: string) => (v === '' ? undefined : Number(v))

  return (
    <div className="card">
      <header>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== combo.id && name && onSave({ ...combo, id: name }, `Rename combo to ${name}`)} style={{ fontWeight: 600 }} />
        <span className="grow" />
        <button className="btn small danger" onClick={() => confirm(`Delete combo ${combo.id}?`) && onDelete()}>Delete</button>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Keys <b>{combo.positions.join(' + ') || 'none'}</b> (shown on the {layer?.name} layer; faint outline = used by another combo)</div>
          <div style={{ overflowX: 'auto' }}>
            <Keyboard layout={ctx.project.files.layout} unit={44} onKeyClick={(i) => toggle(i)} renderKey={(i) => {
              const lg = describe(layer?.bindings[i] ?? NONE, ctx.describe)
              return { className: `${combo.positions.includes(i) ? 'combo-on' : ''} ${others.has(i) ? 'combo-other' : ''}`, content: <span className="main">{lg.kind === 'trans' ? '▽' : lg.main}</span>, title: `Key ${i}` }
            }} />
          </div>
        </div>
        <div className="fields">
          <label className="field"><span>Timeout (ms)</span><input type="number" value={combo.timeoutMs ?? ''} placeholder="50" onChange={(e) => onSave({ ...combo, timeoutMs: num(e.target.value) }, 'Combo timeout')} /></label>
          <label className="field"><span>Require prior idle (ms)</span><input type="number" value={combo.requirePriorIdleMs ?? ''} placeholder="off" onChange={(e) => onSave({ ...combo, requirePriorIdleMs: num(e.target.value) }, 'Combo idle')} /></label>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={combo.slowRelease} onChange={(e) => onSave({ ...combo, slowRelease: e.target.checked }, 'Combo slow release')} /> Release when all keys are up</label>
        </div>
        <div className="field"><span>Active on layers</span>
          <div className="row">
            <label className="check"><input type="checkbox" checked={!combo.layers.length} onChange={(e) => onSave({ ...combo, layers: e.target.checked ? [] : [layerToken(0, ctx.defines)] }, 'Combo layers')} /> All</label>
            {ctx.layers.map((l, i) => {
              const tok = layerToken(i, ctx.defines)
              const on = combo.layers.some((x) => resolveLayer(x, ctx.defines) === i)
              return (
                <label key={l.id} className="check small" style={{ opacity: combo.layers.length ? 1 : 0.45 }}>
                  <input type="checkbox" checked={on} disabled={!combo.layers.length} onChange={() => onSave({ ...combo, layers: on ? combo.layers.filter((x) => resolveLayer(x, ctx.defines) !== i) : [...combo.layers, tok] }, 'Combo layers')} />
                  <span style={{ width: 8, height: 8, borderRadius: 8, background: layerColor(ctx.project, l.id, i) }} />{l.name}
                </label>
              )
            })}
          </div>
        </div>
        <div className="field"><span>Does <code>{formatBinding(combo.binding)}</code></span>
          <Picker ctx={ctx} value={combo.binding} role="tap" onChange={(b) => onSave({ ...combo, binding: b }, `Combo does ${formatBinding(b)}`)} />
        </div>
      </div>
    </div>
  )
}
