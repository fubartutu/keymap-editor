import { useEffect, useState } from 'react'
import { getRaw, parseCells, parseString, printDts, setProp, type DtsNode } from '../../core/dts.ts'
import {
  BEHAVIOR_SCHEMAS, BUILTIN_COMPATIBLES, BUILTIN_DEFAULTS, MOD_FLAGS, behaviorNode, behaviorUsage, cleanupEmptyOverride, createHoldTap, createModMorph,
  createTapDance, deleteBehaviorNode, overrideNode, readPropValue, renameBehaviorReferences, writePropValue, type PropSchema,
} from '../../core/features.ts'
import { formatBinding, formatBindingGroups, getDefines, parseBindings, NONE, type Binding } from '../../core/keymap.ts'
import { describe } from '../../core/describe.ts'
import { GENERATED_MARK } from '../../core/composer.ts'
import { editKeymap } from '../../core/project.ts'
import { Keyboard } from '../components/Keyboard.tsx'
import { Picker } from '../components/Picker.tsx'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

const OVERRIDABLE = ['mt', 'lt', 'sk', 'sl', 'caps_word', 'key_repeat']

export function BehaviorsView({ ctx, store, initial }: { ctx: Ctx; store: Store; initial?: string }) {
  const custom = ctx.reg.all.filter((d) => !d.builtin && d.kind !== 'macro')
  const [sel, setSel] = useState<string | undefined>(initial ?? custom[0]?.id)
  const [creating, setCreating] = useState(false)
  const groups: [string, typeof custom][] = [
    ['Hold-taps', custom.filter((d) => d.kind === 'hold-tap')],
    ['Tap dances', custom.filter((d) => d.kind === 'tap-dance')],
    ['Mod-morphs', custom.filter((d) => d.kind === 'mod-morph')],
    ['Other', custom.filter((d) => !['hold-tap', 'tap-dance', 'mod-morph'].includes(d.kind))],
  ]
  const isOverride = sel?.startsWith('&')
  return (
    <div className="page">
      <h1>Behaviours</h1>
      <p className="lead">Hold-taps decide what a key does when held versus tapped (your home-row mods live here). Tap dances do different things on repeated taps; mod-morphs change a key when a modifier is held.</p>
      <div className="split">
        <div className="card">
          <header><h2>Behaviours</h2><span className="grow" /><button className="btn small primary" onClick={() => setCreating(true)}>+ New</button></header>
          <div className="list">
            {groups.map(([g, list]) => list.length > 0 && (
              <div key={g}>
                <div className="small muted" style={{ padding: '8px 14px 2px', fontWeight: 600 }}>{g}</div>
                {list.map((d) => {
                  const node = behaviorNode(ctx.project.keymap, d.id)
                  const generated = node?.leading.some((c) => c.includes(GENERATED_MARK))
                  return (
                    <div key={d.id} className={`item ${sel === d.id ? 'active' : ''}`} onClick={() => setSel(d.id)}>
                      <div className="grow"><div style={{ fontWeight: 560 }} className="mono">&{d.id}</div><div className="small muted">{d.description}{generated ? ' · made by the editor' : ''}</div></div>
                      <span className="small faint">{behaviorUsage(ctx.project.keymap, d.id)}×</span>
                    </div>
                  )
                })}
              </div>
            ))}
            <div className="small muted" style={{ padding: '8px 14px 2px', fontWeight: 600 }}>Built-in defaults</div>
            {OVERRIDABLE.map((id) => {
              const has = !!overrideNode(ctx.project.keymap, id, false)
              return (
                <div key={id} className={`item ${sel === '&' + id ? 'active' : ''}`} onClick={() => setSel('&' + id)}>
                  <div className="grow"><div className="mono" style={{ fontWeight: 560 }}>&{id}</div><div className="small muted">{ctx.reg.get(id)?.name}</div></div>
                  {has && <span className="pill accent">customised</span>}
                </div>
              )
            })}
          </div>
        </div>
        {creating ? <CreateBehaviour ctx={ctx} store={store} onDone={(id) => { setCreating(false); if (id) setSel(id) }} />
          : isOverride ? <OverrideEditor key={sel} ctx={ctx} store={store} id={sel!.slice(1)} />
            : sel && behaviorNode(ctx.project.keymap, sel) ? <BehaviourEditor key={sel} ctx={ctx} store={store} id={sel} onRenamed={setSel} onDeleted={() => setSel(undefined)} />
              : <div className="card empty">Select a behaviour.</div>}
      </div>
    </div>
  )
}

function useNode(ctx: Ctx, id: string): DtsNode | undefined {
  return behaviorNode(ctx.project.keymap, id)
}

function BehaviourEditor({ ctx, store, id, onRenamed, onDeleted }: { ctx: Ctx; store: Store; id: string; onRenamed: (id: string) => void; onDeleted: () => void }) {
  const node = useNode(ctx, id)!
  const def = ctx.reg.get(id)!
  const compatible = parseString(getRaw(node, 'compatible')) ?? ''
  const schema = BEHAVIOR_SCHEMAS[compatible] ?? []
  const [label, setLabel] = useState(id)
  useEffect(() => setLabel(id), [id])
  const edit = (fn: (n: DtsNode) => void, l: string) => store.apply((p) => editKeymap(p, (f) => { const n = behaviorNode(f, id); if (n) fn(n) }), l)
  const uses = behaviorUsage(ctx.project.keymap, id)

  return (
    <div className="card">
      <header>
        <span className="mono">&</span>
        <input type="text" className="mono" value={label} onChange={(e) => setLabel(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())} onBlur={() => {
          if (!label || label === id || ctx.reg.get(label)) { setLabel(id); return }
          store.apply((p) => editKeymap(p, (f) => { const n = behaviorNode(f, id)!; n.labels[0] = label; if (n.name === id) n.name = label; renameBehaviorReferences(f, id, label) }), `Rename &${id} to &${label}`)
          onRenamed(label)
        }} style={{ fontWeight: 600, width: 200 }} />
        <span className="pill">{def.description}</span>
        <span className="small muted">used {uses}×</span>
        <span className="grow" />
        <button className="btn small danger" onClick={() => {
          if (uses && !confirm(`&${id} is used ${uses} time(s); those keys will stop working. Delete anyway?`)) return
          store.apply((p) => editKeymap(p, (f) => deleteBehaviorNode(f, id)), `Delete &${id}`)
          onDeleted()
        }}>Delete</button>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {compatible === 'zmk,behavior-hold-tap' && <HoldTapBindings ctx={ctx} node={node} edit={edit} />}
        {(compatible === 'zmk,behavior-tap-dance' || compatible === 'zmk,behavior-mod-morph') && <BindingList ctx={ctx} node={node} edit={edit} fixed={compatible === 'zmk,behavior-mod-morph' ? ['Normally', 'With the modifiers held'] : undefined} />}
        <PropForm ctx={ctx} node={node} schema={schema} edit={edit} />
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>Devicetree source</summary>
          <pre className="code" style={{ marginTop: 8 }}>{printDts({ items: [node], tail: [] })}</pre>
        </details>
      </div>
    </div>
  )
}

const HOLD_TAP_INNER = ['kp', 'mo', 'to', 'tog', 'sl', 'sk', 'kt', 'caps_word', 'key_repeat', 'mkp']

function HoldTapBindings({ ctx, node, edit }: { ctx: Ctx; node: DtsNode; edit: (fn: (n: DtsNode) => void, l: string) => void }) {
  const inner = parseBindings(getRaw(node, 'bindings')).map((b) => b.behavior)
  const opts = [...new Set([...HOLD_TAP_INNER, ...ctx.reg.all.filter((d) => !d.builtin && d.kind === 'macro' && d.bindingCells === 1).map((d) => d.id), ...inner])]
  const set = (i: number, v: string) => {
    const next = [...inner]
    next[i] = v
    edit((n) => setProp(n, 'bindings', next.map((x) => `<&${x}>`).join(', ')), 'Hold-tap bindings')
  }
  return (
    <div className="fields">
      <label className="field"><span>When held, pass the 1st parameter to</span>
        <select value={inner[0]} onChange={(e) => set(0, e.target.value)}>{opts.map((o) => <option key={o} value={o}>&{o} — {ctx.reg.get(o)?.name ?? o}</option>)}</select>
      </label>
      <label className="field"><span>When tapped, pass the 2nd parameter to</span>
        <select value={inner[1]} onChange={(e) => set(1, e.target.value)}>{opts.map((o) => <option key={o} value={o}>&{o} — {ctx.reg.get(o)?.name ?? o}</option>)}</select>
      </label>
    </div>
  )
}

function BindingList({ ctx, node, edit, fixed }: { ctx: Ctx; node: DtsNode; edit: (fn: (n: DtsNode) => void, l: string) => void; fixed?: string[] }) {
  const list = parseBindings(getRaw(node, 'bindings'))
  const [open, setOpen] = useState<number | null>(null)
  const write = (next: Binding[], l: string) => edit((n) => setProp(n, 'bindings', formatBindingGroups(next)), l)
  return (
    <div className="field"><span>Bindings</span>
      <div className="steps-list">
        {list.map((b, i) => (
          <div key={i}>
            <div className="mstep" onClick={() => setOpen(open === i ? null : i)} style={{ cursor: 'pointer' }}>
              <span className="small muted" style={{ width: 140 }}>{fixed?.[i] ?? `${i + 1} tap${i ? 's' : ''}`}</span>
              <b className="grow">{(() => { const d = describe(b, ctx.describe); return (d.mods ?? '') + d.main + (d.hold ? ` / hold ${d.hold}` : '') })()}</b>
              <code className="small">{formatBinding(b)}</code>
              {!fixed && list.length > 1 && <button className="iconbtn" onClick={(e) => { e.stopPropagation(); write(list.filter((_, j) => j !== i), 'Remove tap') }}>✕</button>}
            </div>
            {open === i && <div className="card" style={{ padding: 10, marginTop: 4 }}><Picker ctx={ctx} value={b} role="any" onChange={(nb) => write(list.map((x, j) => (j === i ? nb : x)), 'Edit binding')} /></div>}
          </div>
        ))}
      </div>
      {!fixed && <button className="btn small" style={{ alignSelf: 'start' }} onClick={() => write([...list, { behavior: 'kp', params: ['A'] }], 'Add tap')}>+ Another tap</button>}
    </div>
  )
}

function expandPositions(ctx: Ctx, tokens: string[]): number[] {
  const defs = new Map(getDefines(ctx.project.keymap).map((d) => [d.name, d.value]))
  const out: number[] = []
  const walk = (t: string, depth = 0) => {
    if (/^\d+$/.test(t)) out.push(Number(t))
    else if (defs.has(t) && depth < 5) defs.get(t)!.split(/\s+/).forEach((x) => walk(x, depth + 1))
  }
  tokens.forEach((t) => walk(t))
  return [...new Set(out)].sort((a, b) => a - b)
}

function PositionsEditor({ ctx, node, s, edit }: { ctx: Ctx; node: DtsNode; s: PropSchema; edit: (fn: (n: DtsNode) => void, l: string) => void }) {
  const raw = getRaw(node, s.name)
  const tokens = parseCells(raw)
  const positions = expandPositions(ctx, tokens)
  const usesDefines = tokens.some((t) => !/^\d+$/.test(t))
  const layout = ctx.project.files.layout
  const setPositions = (ps: number[] | undefined, l: string) => edit((n) => writePropValue(n, s, ps), l)
  const all = layout.keys.map((_, i) => i)
  const side = (h: 'L' | 'R', thumbs: boolean) => all.filter((i) => (layout.hands[i] === h && !layout.thumbs.includes(i)) || (thumbs && layout.thumbs.includes(i)))
  return (
    <div className="field">
      <span>{s.label} {raw === undefined ? <span className="pill">off: any key can trigger hold</span> : <span className="pill accent">{positions.length} keys</span>}{usesDefines && <span className="pill" title="Editing will write the positions as numbers">uses {tokens.join(' ')}</span>}</span>
      <p className="small muted" style={{ margin: 0 }}>{s.description}</p>
      <div className="row">
        <button className="btn small" onClick={() => setPositions(side('R', false), 'Right hand')}>Right hand</button>
        <button className="btn small" onClick={() => setPositions(side('R', true), 'Right hand + thumbs')}>Right hand + thumbs</button>
        <button className="btn small" onClick={() => setPositions(side('L', false), 'Left hand')}>Left hand</button>
        <button className="btn small" onClick={() => setPositions(side('L', true), 'Left hand + thumbs')}>Left hand + thumbs</button>
        <button className="btn small ghost" onClick={() => setPositions(undefined, 'Clear hold-trigger positions')}>Off</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <Keyboard layout={layout} unit={40} onKeyClick={(i) => {
          const next = positions.includes(i) ? positions.filter((p) => p !== i) : [...positions, i].sort((a, b) => a - b)
          setPositions(next, `Hold-trigger key ${i}`)
        }} renderKey={(i) => ({ className: positions.includes(i) ? 'combo-on' : raw === undefined ? '' : 'dim', content: <span className="main">{describe(ctx.layers[0]?.bindings[i] ?? NONE, ctx.describe).main}</span> })} />
      </div>
    </div>
  )
}

function PropForm({ ctx, node, schema, edit, defaults }: { ctx: Ctx; node: DtsNode | undefined; schema: PropSchema[]; edit: (fn: (n: DtsNode) => void, l: string) => void; defaults?: Record<string, unknown> }) {
  const simple = schema.filter((s) => s.type !== 'positions')
  return (
    <>
      <div className="fields">
        {simple.map((s) => {
          const v = readPropValue(node, s)
          const def = defaults?.[s.name] ?? s.default
          return (
            <label key={s.name} className="field" title={s.description}>
              <span>{s.label}{s.unit ? ` (${s.unit})` : ''}{v !== undefined && <span className="pill accent" style={{ marginLeft: 6 }}>set</span>}</span>
              {s.type === 'bool' ? (
                <label className="check"><input type="checkbox" checked={!!v} onChange={(e) => edit((n) => writePropValue(n, s, e.target.checked), s.label)} /> {v ? 'on' : 'off'}{def !== undefined ? <span className="faint small">(default {def ? 'on' : 'off'})</span> : null}</label>
              ) : s.type === 'enum' ? (
                <select value={(v as string) ?? ''} onChange={(e) => edit((n) => writePropValue(n, s, e.target.value || undefined), s.label)}>
                  <option value="">default{def !== undefined ? ` (${def})` : ''}</option>
                  {s.options!.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : s.type === 'int' ? (
                <input type="number" min={s.min} max={s.max} value={(v as number) ?? ''} placeholder={def !== undefined ? `default ${def}` : ''} onChange={(e) => edit((n) => writePropValue(n, s, e.target.value === '' ? undefined : Number(e.target.value)), s.label)} />
              ) : s.type === 'mods' ? (
                <div className="modrow">{MOD_FLAGS.map((m) => {
                  const list = (v as string[]) ?? []
                  const on = list.includes(m)
                  return <button key={m} className={on ? 'on' : ''} onClick={(e) => { e.preventDefault(); edit((n) => writePropValue(n, s, on ? list.filter((x) => x !== m) : [...list, m]), s.label) }}>{m.replace('MOD_', '')}</button>
                })}</div>
              ) : (
                <input type="text" className="mono" value={Array.isArray(v) ? v.join(' ') : (v as string) ?? ''} placeholder="default" onChange={(e) => edit((n) => writePropValue(n, s, s.type === 'keycodes' ? e.target.value.split(/\s+/).filter(Boolean) : e.target.value), s.label)} />
              )}
              <span className="small faint">{s.description}</span>
            </label>
          )
        })}
      </div>
      {node && schema.filter((s) => s.type === 'positions').map((s) => <PositionsEditor key={s.name} ctx={ctx} node={node} s={s} edit={edit} />)}
    </>
  )
}

function OverrideEditor({ ctx, store, id }: { ctx: Ctx; store: Store; id: string }) {
  const node = overrideNode(ctx.project.keymap, id, false)
  const schema = BEHAVIOR_SCHEMAS[BUILTIN_COMPATIBLES[id]] ?? []
  const edit = (fn: (n: DtsNode) => void, l: string) => store.apply((p) => editKeymap(p, (f) => { fn(overrideNode(f, id, true)!); cleanupEmptyOverride(f, id) }), `&${id}: ${l}`)
  return (
    <div className="card">
      <header><h2 className="mono">&{id}</h2><span className="pill">{ctx.reg.get(id)?.name}</span><span className="grow" />
        {node && <button className="btn small" onClick={() => store.apply((p) => editKeymap(p, (f) => { const n = overrideNode(f, id, false); if (n) { n.children = []; cleanupEmptyOverride(f, id) } }), `Reset &${id}`)}>Reset to ZMK defaults</button>}
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p className="muted small" style={{ margin: 0 }}>Changes every use of the built-in <code>&{id}</code>. Written as a <code>&{id} {'{ … }'}</code> override at the top of the keymap.</p>
        <PropForm ctx={ctx} node={node} schema={schema.filter((s) => s.type !== 'positions' || id === 'mt' || id === 'lt')} edit={edit} defaults={BUILTIN_DEFAULTS[id]} />
      </div>
    </div>
  )
}

const TEMPLATES = [
  { id: 'hrm', name: 'Home-row mods (timeless)', desc: 'Positional hold-tap after urob: hold only resolves with keys on the other hand, never while typing fast. One for each hand.' },
  { id: 'holdtap', name: 'Hold-tap', desc: 'Something on hold, something else on tap. Pick what each parameter goes to afterwards.' },
  { id: 'tapdance', name: 'Tap dance', desc: 'Different bindings for 1, 2, 3… taps.' },
  { id: 'modmorph', name: 'Mod-morph', desc: 'A key that sends something else while Shift (or another modifier) is held, e.g. , and ;.' },
]

function CreateBehaviour({ ctx, store, onDone }: { ctx: Ctx; store: Store; onDone: (id?: string) => void }) {
  const layout = ctx.project.files.layout
  const side = (h: 'L' | 'R') => layout.keys.map((_, i) => i).filter((i) => layout.hands[i] === h || layout.thumbs.includes(i))
  const make = (t: string) => {
    let created: string | undefined
    store.apply((p) => editKeymap(p, (f) => {
      const common = { flavor: '"balanced"', 'tapping-term-ms': '<280>', 'quick-tap-ms': '<175>', 'require-prior-idle-ms': '<150>' }
      if (t === 'hrm') {
        created = createHoldTap(f, 'hml', 'kp', 'kp', { ...common, 'hold-trigger-key-positions': `<${side('R').join(' ')}>`, 'hold-trigger-on-release': null }, 'Home-row mods, left hand (timeless)')
        createHoldTap(f, 'hmr', 'kp', 'kp', { ...common, 'hold-trigger-key-positions': `<${side('L').join(' ')}>`, 'hold-trigger-on-release': null }, 'Home-row mods, right hand (timeless)')
      } else if (t === 'holdtap') created = createHoldTap(f, 'ht', 'kp', 'kp', { flavor: '"tap-preferred"', 'tapping-term-ms': '<200>' })
      else if (t === 'tapdance') created = createTapDance(f, 'td', [{ behavior: 'kp', params: ['A'] }, { behavior: 'kp', params: ['B'] }], 200)
      else if (t === 'modmorph') created = createModMorph(f, 'mm', { behavior: 'kp', params: ['COMMA'] }, { behavior: 'kp', params: ['SEMI'] }, ['MOD_LSFT', 'MOD_RSFT'])
    }), 'New behaviour')
    onDone(created)
  }
  return (
    <div className="card">
      <header><h2>New behaviour</h2><span className="grow" /><button className="btn small ghost" onClick={() => onDone()}>Cancel</button></header>
      <div className="list">
        {TEMPLATES.map((t) => (
          <div key={t.id} className="item" onClick={() => make(t.id)}>
            <div className="grow"><div style={{ fontWeight: 600 }}>{t.name}</div><div className="small muted">{t.desc}</div></div><span className="btn small">Create</span>
          </div>
        ))}
      </div>
      <div className="content small muted">Tip: you rarely need to create hold-taps or tap dances by hand. Setting “When held” or “When double-tapped” on a key does it for you.</div>
    </div>
  )
}
