import { useEffect, useMemo, useState } from 'react'
import { compose, compatibleHoldTaps, decompose, type KeySteps } from '../../core/composer.ts'
import { describeSimple } from '../../core/describe.ts'
import { getRaw, parseString } from '../../core/dts.ts'
import { behaviorNode, createHoldTap } from '../../core/features.ts'
import { formatBinding, getLayers, setLayerBindings, type Binding } from '../../core/keymap.ts'
import { editKeymap, setKeyMeta, LAYER_COLORS, type Project } from '../../core/project.ts'
import type { Store } from '../store.ts'
import type { Ctx } from '../context.ts'
import { Picker } from './Picker.tsx'

type Step = 'tap' | 'hold' | 'doubleTap' | 'tapHold'
const STEP_LABEL: Record<Step, string> = { tap: 'When tapped', hold: 'When held', doubleTap: 'When double-tapped', tapHold: 'When tapped, then held' }

export function setBinding(p: Project, layer: number, pos: number, fn: (file: Project['keymap']) => Binding): Project {
  return editKeymap(p, (f) => {
    const l = getLayers(f)[layer]
    const b = fn(f)
    const next = l.bindings.map((x, i) => (i === pos ? b : x))
    setLayerBindings(f, layer, next, p.files.layout.grid)
  })
}

interface Props {
  ctx: Ctx
  store: Store
  layer: number
  pos: number
  onNewMacro: () => void
  onOpenBehaviour: (label: string) => void
}

export function KeyEditor({ ctx, store, layer, pos, onNewMacro, onOpenBehaviour }: Props) {
  const binding = ctx.layers[layer]?.bindings[pos]
  const steps = useMemo(() => (binding ? decompose(binding, ctx.project.keymap, ctx.reg) : null), [binding, ctx])
  const [step, setStep] = useState<Step>('tap')
  useEffect(() => { setStep('tap') }, [layer, pos])

  if (!binding) return null
  const layerInfo = ctx.layers[layer]
  const meta = ctx.project.meta.keys[layerInfo.id]?.[pos]

  const update = (next: KeySteps, label: string) => {
    store.apply((p) => setBinding(p, layer, pos, (f) => compose(next, f)), label)
  }

  const setStepBinding = (s: Step, b: Binding | undefined) => {
    if (!steps) return
    const next: KeySteps = { ...steps, [s]: b }
    update(next, `${STEP_LABEL[s]}: ${b ? formatBinding(b) : 'cleared'} (key ${pos})`)
  }

  const stepValue = steps?.[step]
  const ht = steps?.holdTap ? ctx.reg.get(steps.holdTap) : undefined
  const candidates = steps?.tap && steps.hold ? compatibleHoldTaps(ctx.project.keymap, steps.hold, steps.tap) : []

  return (
    <div className="editor">
      <div className="steps">
        <div className="row small muted" style={{ marginBottom: 2 }}>
          <b style={{ color: 'var(--text)' }}>Key {pos}</b> on <b style={{ color: 'var(--text)' }}>{layerInfo.name}</b>
          <span className="grow" />
          <code title="ZMK binding">{formatBinding(binding)}</code>
        </div>
        {steps ? (['tap', 'hold', 'doubleTap', 'tapHold'] as Step[]).map((s) => {
          const v = steps[s]
          const d = v ? describeSimple(v, ctx.describe) : undefined
          return (
            <div key={s} className={`step ${step === s ? 'active' : ''}`} onClick={() => setStep(s)}>
              <div className="label">{STEP_LABEL[s]}
                {v && s !== 'tap' && <button className="iconbtn x" title="Remove" onClick={(e) => { e.stopPropagation(); setStepBinding(s, undefined) }}>✕</button>}
                {v && s === 'tap' && (steps.hold || steps.doubleTap) && <button className="iconbtn x" title="Remove" onClick={(e) => { e.stopPropagation(); setStepBinding(s, undefined) }}>✕</button>}
              </div>
              <div className="value">{d ? <>{d.mods && <span className="muted small">{d.mods}</span>}{d.main || (v!.behavior === 'trans' ? 'Transparent' : v!.behavior === 'none' ? 'Nothing' : '')}<span className="faint small mono">{formatBinding(v!)}</span></> : <span className="none">+ add</span>}</div>
            </div>
          )
        }) : (
          <div className="banner warn">This key uses a behaviour with more steps than the tap / hold / double-tap editor can show. Edit it as code below, or under Behaviours.</div>
        )}

        {steps?.tap && steps.hold && (
          <div className="card" style={{ padding: 10 }}>
            <div className="field">
              <span>Hold-tap behaviour</span>
              <select value={steps.holdTap ?? ''} onChange={(e) => {
                if (e.target.value === '__new') return
                update({ ...steps, holdTap: e.target.value }, `Use &${e.target.value} for key ${pos}`)
              }}>
                {candidates.map((c) => <option key={c.id} value={c.id}>&{c.id}{c.name !== c.id.replace(/_/g, ' ') ? ` (${c.name})` : ''}{timing(ctx, c.id)}</option>)}
              </select>
            </div>
            {ht && !ht.builtin && <button className="btn small ghost" style={{ marginTop: 6 }} onClick={() => onOpenBehaviour(ht.id)}>Edit &{ht.id} timing…</button>}
            <OwnTiming ctx={ctx} store={store} steps={steps} layer={layer} pos={pos} />
          </div>
        )}

        <KeyMetaEditor key={`${layer}-${pos}`} value={meta} onChange={(m) => store.apply((p) => setKeyMeta(p, layerInfo.id, pos, m), `Label/colour for key ${pos}`)} />
      </div>

      <div className="card" style={{ padding: 14 }}>
        {steps ? (
          <>
            <div className="row" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{STEP_LABEL[step]}</h3>
              <span className="grow" />
              {step === 'tap' && <>
                <button className="btn small" onClick={() => update({}, `Make key ${pos} transparent`)} title="Use the key from the layer below">Transparent</button>
                <button className="btn small" onClick={() => update({ tap: { behavior: 'none', params: [] } }, `Disable key ${pos}`)}>Nothing</button>
              </>}
            </div>
            <Picker
              key={`${layer}-${pos}-${step}`}
              ctx={ctx}
              value={stepValue}
              role={step === 'hold' || step === 'tapHold' ? 'hold' : 'tap'}
              onChange={(b) => setStepBinding(step, b)}
              onNewMacro={onNewMacro}
            />
          </>
        ) : (
          <Picker ctx={ctx} value={binding} role="any" onChange={(b) => store.apply((p) => setBinding(p, layer, pos, () => b), `Key ${pos}: ${formatBinding(b)}`)} onNewMacro={onNewMacro} />
        )}
      </div>
    </div>
  )
}

function timing(ctx: Ctx, id: string): string {
  const node = behaviorNode(ctx.project.keymap, id) ?? ctx.project.keymap.items.find((i) => i.kind === 'node' && i.name === '&' + id) as never
  const defaults: Record<string, string> = { mt: 'hold-preferred, 200ms', lt: 'tap-preferred, 200ms' }
  if (!node) return defaults[id] ? ` — ${defaults[id]}` : ''
  const flavor = parseString(getRaw(node, 'flavor'))
  const term = getRaw(node, 'tapping-term-ms')?.replace(/[<>]/g, '')
  const bits = [flavor, term && term + 'ms', getRaw(node, 'hold-trigger-key-positions') && 'positional'].filter(Boolean)
  return bits.length ? ` — ${bits.join(', ')}` : ''
}

/** Oryx has per-key tapping terms; in ZMK that means a hold-tap of its own. */
function OwnTiming({ ctx, store, steps, layer, pos }: { ctx: Ctx; store: Store; steps: KeySteps; layer: number; pos: number }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState(200)
  const [flavor, setFlavor] = useState('balanced')
  if (!open) return <button className="btn small ghost" onClick={() => setOpen(true)}>Give this key its own timing…</button>
  return (
    <div className="field" style={{ marginTop: 8, gap: 8 }}>
      <span>New hold-tap for this key</span>
      <div className="row">
        <label className="small">Tapping term <input type="number" value={term} min={50} max={1000} step={10} onChange={(e) => setTerm(Number(e.target.value))} style={{ width: 72 }} /> ms</label>
      </div>
      <select value={flavor} onChange={(e) => setFlavor(e.target.value)}>
        {['hold-preferred', 'balanced', 'tap-preferred', 'tap-unless-interrupted'].map((f) => <option key={f}>{f}</option>)}
      </select>
      <div className="row">
        <button className="btn small primary" onClick={() => {
          store.apply((p) => setBinding(p, layer, pos, (f) => {
            const id = createHoldTap(f, `ht_${steps.hold!.behavior}_${steps.tap!.behavior}_${term}`, steps.hold!.behavior, steps.tap!.behavior,
              { flavor: `"${flavor}"`, 'tapping-term-ms': `<${term}>` }, `Hold-tap with its own timing (key ${pos}, ${ctx.layers[layer].name})`)
            return compose({ ...steps, holdTap: id }, f)
          }), `Own timing for key ${pos}`)
          setOpen(false)
        }}>Create</button>
        <button className="btn small ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

function KeyMetaEditor({ value, onChange }: { value?: { label?: string; color?: string }; onChange: (m: { label?: string; color?: string }) => void }) {
  const [label, setLabel] = useState(value?.label ?? '')
  return (
    <details className="card" style={{ padding: '8px 10px' }} open={!!value}>
      <summary className="small muted" style={{ cursor: 'pointer' }}>Custom label & colour (editor only)</summary>
      <div className="field" style={{ marginTop: 8 }}>
        <input type="text" placeholder="Label shown on this key" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== (value?.label ?? '') && onChange({ ...value, label: label || undefined })} />
        <div className="swatches">
          <button title="No colour" style={{ background: 'var(--key)' }} className={!value?.color ? 'on' : ''} onClick={() => onChange({ ...value, color: undefined })} />
          {LAYER_COLORS.map((c) => <button key={c} style={{ background: c }} className={value?.color === c ? 'on' : ''} onClick={() => onChange({ ...value, color: c })} />)}
        </div>
      </div>
    </details>
  )
}
