import { useEffect, useMemo, useState } from 'react'
import { describe } from '../../core/describe.ts'
import { formatBinding, getLayers, renameLayer, setLayerBindings, TRANS, NONE, type Binding } from '../../core/keymap.ts'
import { editKeymap, layerColor, projectAddLayer, projectMoveLayer, projectRemoveLayer, LAYER_COLORS, type Project } from '../../core/project.ts'
import { Keyboard } from '../components/Keyboard.tsx'
import { KeyEditor } from '../components/KeyEditor.tsx'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'
import type { Live } from '../live.ts'

interface Props {
  ctx: Ctx
  store: Store
  layer: number
  setLayer: (i: number) => void
  selected: number[]
  setSelected: (s: number[]) => void
  goto: (view: string, arg?: string) => void
  live: Live
}

function setKeys(p: Project, layer: number, positions: number[], fn: (b: Binding, pos: number) => Binding): Project {
  return editKeymap(p, (f) => {
    const l = getLayers(f)[layer]
    setLayerBindings(f, layer, l.bindings.map((b, i) => (positions.includes(i) ? fn(b, i) : b)), p.files.layout.grid)
  })
}

export function LayoutView({ ctx, store, layer, setLayer, selected, setSelected, goto, live }: Props) {
  const { project } = ctx
  const layers = ctx.layers
  const current = layers[layer] ?? layers[0]
  const [showPos, setShowPos] = useState(false)
  const [clip, setClip] = useState<Binding | null>(null)
  const [menu, setMenu] = useState<number | null>(null)
  const [follow, setFollow] = useState(true)
  const [pressSelect, setPressSelect] = useState(true)
  // Live: follow the keyboard's active layer, and select keys by pressing them.
  useEffect(() => {
    if (live.connected && follow && live.topLayer < ctx.layers.length) setLayer(live.topLayer)
  }, [live.connected, live.topLayer, follow]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (live.connected && pressSelect && live.lastPress) setSelected([live.lastPress.pos])
  }, [live.lastPress]) // eslint-disable-line react-hooks/exhaustive-deps
  const [dragLayer, setDragLayer] = useState<number | null>(null)
  const [overLayer, setOverLayer] = useState<number | null>(null)
  const issuesByKey = useMemo(() => {
    const m = new Map<number, string[]>()
    for (const i of store.issues) if (i.layer === layer && i.key !== undefined && i.severity === 'error') m.set(i.key, [...(m.get(i.key) ?? []), i.message])
    return m
  }, [store.issues, layer])

  // Keyboard shortcuts for the selected keys.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if (!selected.length) return
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') setSelected([])
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
        e.preventDefault()
        store.apply((p) => setKeys(p, layer, selected, () => ({ ...TRANS })), `Clear ${selected.length} key(s)`)
      } else if (mod && e.key === 'c') {
        setClip(current.bindings[selected[0]])
      } else if (mod && e.key === 'v' && clip) {
        e.preventDefault()
        store.apply((p) => setKeys(p, layer, selected, () => ({ ...clip, params: [...clip.params] })), `Paste ${formatBinding(clip)}`)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selected, layer, clip, current, store, setSelected])

  if (!current) return <div className="page"><div className="banner err">This keymap has no layers.</div></div>

  const base = layers[0]
  const color = (i: number) => layerColor(project, layers[i]?.id ?? '', i)

  return (
    <div className="page">
      <div className="layerbar">
        <div className="layertabs">
          {layers.map((l, i) => (
            <div
              key={l.id}
              className={`layertab ${i === layer ? 'active' : ''} ${overLayer === i && dragLayer !== null && dragLayer !== i ? 'dragover' : ''}`}
              style={{ ['--layer' as string]: color(i) }}
              onClick={() => { setLayer(i); setSelected([]) }}
              onDoubleClick={() => setMenu(i)}
              draggable
              onDragStart={() => setDragLayer(i)}
              onDragEnd={() => { setDragLayer(null); setOverLayer(null) }}
              onDragOver={(e) => { if (dragLayer !== null) { e.preventDefault(); setOverLayer(i) } }}
              onDrop={() => {
                if (dragLayer !== null && dragLayer !== i) {
                  store.apply((p) => projectMoveLayer(p, dragLayer, i), `Move layer ${layers[dragLayer].name}`)
                  setLayer(i)
                }
                setDragLayer(null); setOverLayer(null)
              }}
              title="Double-click to rename, recolour or delete. Drag to reorder."
            >
              <span className="dot" style={{ background: color(i) }} />
              {l.name}<span className="idx">{i}</span>
              {live.connected && (live.layerMask & (1 << i)) !== 0 && <span className="pill ok" style={{ padding: '0 5px', fontSize: 10 }} title="Active on the keyboard now">on</span>}
            </div>
          ))}
          <div className="layertab add" onClick={() => {
            const name = prompt('Name for the new layer?', 'New layer')
            if (!name) return
            store.apply((p) => projectAddLayer(p, name), `Add layer ${name}`)
            setLayer(layers.length)
          }}>+ Layer</div>
        </div>
        <div className="tools">
          <button className="btn small ghost" onClick={() => setMenu(layer)}>Layer options</button>
          {live.connected && <>
            <label className="check small muted" title="Switch tabs when the keyboard changes layer"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow layer</label>
            <label className="check small muted" title="Pressing a key on the keyboard selects it here"><input type="checkbox" checked={pressSelect} onChange={(e) => setPressSelect(e.target.checked)} /> Press to select</label>
          </>}
          <label className="check small muted"><input type="checkbox" checked={showPos} onChange={(e) => setShowPos(e.target.checked)} /> Key numbers</label>
        </div>
      </div>

      <div className="board-wrap">
        <Keyboard
          layout={project.files.layout}
          unit={62}
          onSwap={(a, b) => store.apply((p) => setKeys(p, layer, [a, b], (_, pos) => current.bindings[pos === a ? b : a]), `Swap keys ${a} and ${b}`)}
          onKeyClick={(i, e) => {
            if (e.shiftKey || e.ctrlKey || e.metaKey) setSelected(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i])
            else setSelected(selected.length === 1 && selected[0] === i ? [] : [i])
          }}
          renderKey={(i) => {
            const b = current.bindings[i] ?? NONE
            const lg = describe(b, ctx.describe)
            const meta = project.meta.keys[current.id]?.[i]
            let main = meta?.label ?? lg.main
            let ghost = false
            if (lg.kind === 'trans' && layer > 0 && base) {
              const below = describe(base.bindings[i] ?? NONE, ctx.describe)
              main = meta?.label ?? below.main
              ghost = true
            }
            const kindLayer = lg.kind === 'layer' ? lg.layer : undefined
            const issue = issuesByKey.get(i)
            return {
              className: `k-${lg.kind} ${live.down.has(i) ? 'pressed' : ''} ${selected.includes(i) ? (selected.length > 1 ? 'selected multi' : 'selected') : ''} ${issue ? 'has-issue' : ''}`,
              title: (issue ? issue.join('\n') + '\n\n' : '') + `${lg.title}\n\n${formatBinding(b)}${lg.kind === 'trans' ? '\n(transparent: shows the base layer key)' : ''}`,
              style: {
                ...(kindLayer !== undefined ? { ['--layer-c' as string]: color(kindLayer) } : {}),
                ...(meta?.color ? { background: `color-mix(in srgb, var(--key) 70%, ${meta.color})` } : {}),
              },
              content: (
                <>
                  {showPos && <span className="pos">{i}</span>}
                  {lg.doubleTap && <span className="badge" title={`Double tap: ${lg.doubleTap}`}>2×</span>}
                  {lg.mods && !ghost && <span className="mods">{lg.mods.replace(/\+$/, '')}</span>}
                  <span className="main" style={{ opacity: ghost ? 0.5 : 1, fontSize: main.length > 9 ? 10 : main.length > 5 ? 11 : undefined }}>{main}</span>
                  {(lg.hold || lg.tapHold) && (
                    <span className="hold" style={lg.holdLayer !== undefined ? { color: color(lg.holdLayer) } : undefined}>
                      {lg.hold}{lg.tapHold ? ` · ${lg.tapHold}` : ''}
                    </span>
                  )}
                </>
              ),
            }
          }}
        />
        <div className="board-legend">
          <span style={{ ['--sw' as string]: 'color-mix(in srgb, var(--key) 88%, #2563eb)' }}>modifier</span>
          <span style={{ ['--sw' as string]: 'color-mix(in srgb, var(--key) 80%, #a855f7)' }}>layer</span>
          <span style={{ ['--sw' as string]: 'color-mix(in srgb, var(--key) 85%, #14b8a6)' }}>mouse</span>
          <span style={{ ['--sw' as string]: 'color-mix(in srgb, var(--key) 85%, #6366f1)' }}>bluetooth</span>
          <span style={{ ['--sw' as string]: 'color-mix(in srgb, var(--key) 85%, #eab308)' }}>macro</span>
          <span style={{ ['--sw' as string]: 'transparent' }}>transparent</span>
          <span className="faint">Click a key to edit · Shift-click to select several · drag to swap · Del clears · Ctrl+C / Ctrl+V</span>
        </div>
      </div>

      {selected.length > 1 && (
        <div className="row" style={{ marginTop: 12 }}>
          <b>{selected.length} keys selected</b>
          <button className="btn small" onClick={() => store.apply((p) => setKeys(p, layer, selected, () => ({ ...TRANS })), 'Make keys transparent')}>Transparent</button>
          <button className="btn small" onClick={() => store.apply((p) => setKeys(p, layer, selected, () => ({ ...NONE })), 'Disable keys')}>Nothing</button>
          {clip && <button className="btn small" onClick={() => store.apply((p) => setKeys(p, layer, selected, () => clip), 'Paste')}>Paste {formatBinding(clip)}</button>}
          <CopyFromLayer ctx={ctx} layer={layer} onCopy={(src) => store.apply((p) => setKeys(p, layer, selected, (_, pos) => getLayers(p.keymap)[src].bindings[pos]), `Copy keys from ${layers[src].name}`)} />
          <button className="btn small ghost" onClick={() => setSelected([])}>Deselect</button>
        </div>
      )}
      {selected.length === 1 && (
        <KeyEditor ctx={ctx} store={store} layer={layer} pos={selected[0]} onNewMacro={() => goto('macros', 'new')} onOpenBehaviour={(l) => goto('behaviours', l)} />
      )}
      {selected.length === 0 && (
        <p className="muted small" style={{ marginTop: 14 }}>Select a key to choose what it does when tapped, held, double-tapped or tapped-then-held.</p>
      )}

      {menu !== null && layers[menu] && (
        <LayerMenu ctx={ctx} index={menu} onClose={() => setMenu(null)} store={store} setLayer={setLayer} />
      )}
    </div>
  )
}

function CopyFromLayer({ ctx, layer, onCopy }: { ctx: Ctx; layer: number; onCopy: (src: number) => void }) {
  return (
    <select value="" onChange={(e) => e.target.value !== '' && onCopy(Number(e.target.value))}>
      <option value="">Copy from layer…</option>
      {ctx.layers.map((l, i) => i !== layer && <option key={l.id} value={i}>{l.name}</option>)}
    </select>
  )
}

function LayerMenu({ ctx, index, onClose, store, setLayer }: { ctx: Ctx; index: number; onClose: () => void; store: Store; setLayer: (i: number) => void }) {
  const l = ctx.layers[index]
  const [name, setName] = useState(l.name)
  const col = layerColor(ctx.project, l.id, index)
  const n = ctx.layers.length
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>Layer {index}: {l.name}<span className="grow" /><button className="iconbtn" onClick={onClose}>✕</button></header>
        <div className="content">
          <label className="field"><span>Name</span>
            <div className="row">
              <input type="text" className="grow" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name && store.apply((p) => editKeymap(p, (f) => renameLayer(f, index, name)), `Rename layer to ${name}`)} />
              <button className="btn" disabled={!name || name === l.name} onClick={() => store.apply((p) => editKeymap(p, (f) => renameLayer(f, index, name)), `Rename layer to ${name}`)}>Rename</button>
            </div>
            <span className="small faint">The display name (shown in ZMK Studio). Node: <code>{l.id}</code>{[...ctx.defines].find(([, i]) => i === index) && <> · define <code>{[...ctx.defines].find(([, i]) => i === index)![0]}</code></>}</span>
          </label>
          <div className="field"><span>Colour (editor only)</span>
            <div className="swatches">{LAYER_COLORS.map((c) => <button key={c} style={{ background: c }} className={col === c ? 'on' : ''} onClick={() => store.apply((p) => ({ ...p, meta: { ...p.meta, layers: { ...p.meta.layers, [l.id]: { color: c } } } }), 'Layer colour')} />)}</div>
          </div>
          <div className="row">
            <button className="btn" disabled={index === 0} onClick={() => { store.apply((p) => projectMoveLayer(p, index, index - 1), 'Move layer left'); setLayer(index - 1); onClose() }}>← Move left</button>
            <button className="btn" disabled={index === n - 1} onClick={() => { store.apply((p) => projectMoveLayer(p, index, index + 1), 'Move layer right'); setLayer(index + 1); onClose() }}>Move right →</button>
            <button className="btn" onClick={() => { const nm = prompt('Name for the copy?', l.name + ' copy'); if (nm) { store.apply((p) => projectAddLayer(p, nm, index), `Duplicate ${l.name}`); setLayer(n); onClose() } }}>Duplicate</button>
            <button className="btn" onClick={() => confirm(`Make every key on ${l.name} transparent?`) && store.apply((p) => setKeys(p, index, l.bindings.map((_, i) => i), () => ({ ...TRANS })), `Clear layer ${l.name}`)}>Clear</button>
            <span className="grow" />
            <button className="btn danger" disabled={n <= 1} onClick={() => {
              if (!confirm(`Delete layer “${l.name}”? Keys that switch to it become “nothing”, and later layers move down by one (references are updated).`)) return
              store.apply((p) => projectRemoveLayer(p, index), `Delete layer ${l.name}`)
              setLayer(Math.max(0, index - 1)); onClose()
            }}>Delete layer</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Reordering and deleting layers updates every layer reference: keys, combos, conditional layers, <code>#define</code>s, and the trackball's scroll/snipe and auto-mouse layers in the overlay.</p>
        </div>
      </div>
    </div>
  )
}
