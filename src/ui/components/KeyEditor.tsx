import { useEffect, useMemo, useState } from 'react'
import { compose, compatibleHoldTaps, decompose, type KeySteps } from '../../core/composer.ts'
import { describeSimple } from '../../core/describe.ts'
import { getRaw, parseString, setProp } from '../../core/dts.ts'
import { behaviorNode, behaviorUsage, createHoldTap } from '../../core/features.ts'
import { formatBinding, getLayers, setLayerBindings, type Binding } from '../../core/keymap.ts'
import { editKeymap, setKeyMeta, LAYER_COLORS, type Project } from '../../core/project.ts'
import type { Store } from '../store.ts'
import type { Ctx } from '../context.ts'
import { Picker } from './Picker.tsx'

/** Step ids: the four Oryx steps, `t3`/`h3`… for further taps, and `morph`. */
type Step = string
const ORYX_STEPS = ['tap', 'hold', 'doubleTap', 'tapHold']
const MOD_CHOICES: { label: string; mods: string[] }[] = [
  { label: 'Shift', mods: ['MOD_LSFT', 'MOD_RSFT'] },
  { label: 'Ctrl', mods: ['MOD_LCTL', 'MOD_RCTL'] },
  { label: 'Alt', mods: ['MOD_LALT', 'MOD_RALT'] },
  { label: 'Gui', mods: ['MOD_LGUI', 'MOD_RGUI'] },
]

function ordinal(n: number): string {
  return n === 2 ? 'twice' : `${n} times`
}

function morphName(steps: KeySteps): string {
  const mods = steps.morph?.mods ?? ['MOD_LSFT']
  const names = MOD_CHOICES.filter((c) => c.mods.some((m) => mods.includes(m))).map((c) => c.label)
  return names.join(' or ') || 'Shift'
}

function stepLabel(id: Step, steps: KeySteps | null): string {
  switch (id) {
    case 'tap': return 'When tapped'
    case 'hold': return 'When held'
    case 'doubleTap': return 'When double-tapped'
    case 'tapHold': return 'When tapped, then held'
    case 'morph': return `When ${steps ? morphName(steps) : 'Shift'} is held`
  }
  const n = Number(id.slice(1))
  return id[0] === 't' ? `When tapped ${ordinal(n)}` : `When tapped ${ordinal(n - 1)}, then held`
}

function getStep(steps: KeySteps, id: Step): Binding | undefined {
  if (id === 'morph') return steps.morph?.binding
  if (ORYX_STEPS.includes(id)) return steps[id as 'tap']
  const t = steps.moreTaps?.[Number(id.slice(1)) - 3]
  return id[0] === 't' ? t?.tap : t?.hold
}

function setStepValue(steps: KeySteps, id: Step, b: Binding | undefined): KeySteps {
  if (id === 'morph') return { ...steps, morph: b ? { binding: b, mods: steps.morph?.mods ?? ['MOD_LSFT', 'MOD_RSFT'], keepMods: steps.morph?.keepMods ?? [] } : undefined }
  if (ORYX_STEPS.includes(id)) return { ...steps, [id]: b }
  const i = Number(id.slice(1)) - 3
  const more = [...(steps.moreTaps ?? [])].map((t) => ({ ...t }))
  while (more.length <= i) more.push({})
  more[i] = id[0] === 't' ? { ...more[i], tap: b } : { ...more[i], hold: b }
  while (more.length && !more[more.length - 1].tap && !more[more.length - 1].hold) more.pop()
  return { ...steps, moreTaps: more }
}

/** The steps to show: Oryx's four, then each extra tap, then the modifier alternative. */
function visibleSteps(steps: KeySteps, extra: number): Step[] {
  const ids = [...ORYX_STEPS]
  const n = Math.max(steps.moreTaps?.length ?? 0, extra)
  for (let i = 0; i < n; i++) ids.push(`t${i + 3}`, `h${i + 3}`)
  if (steps.morph) ids.push('morph')
  return ids
}

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
  const [extraTaps, setExtraTaps] = useState(0)
  const [pendingMorph, setPendingMorph] = useState(false)
  useEffect(() => { setStep('tap'); setExtraTaps(0); setPendingMorph(false) }, [layer, pos])

  if (!binding) return null
  const layerInfo = ctx.layers[layer]
  const meta = ctx.project.meta.keys[layerInfo.id]?.[pos]

  const update = (next: KeySteps, label: string) => {
    store.apply((p) => setBinding(p, layer, pos, (f) => compose(next, f)), label)
  }

  const setStepBinding = (s: Step, b: Binding | undefined) => {
    if (!steps) return
    if (s === 'morph') setPendingMorph(false)
    update(setStepValue(steps, s, b), `${stepLabel(s, steps)}: ${b ? formatBinding(b) : 'cleared'} (key ${pos})`)
  }

  const ids = steps ? visibleSteps(steps, extraTaps) : []
  if (steps && pendingMorph && !steps.morph) ids.push('morph')
  const stepValue = steps ? getStep(steps, step) : undefined
  const ht = steps?.holdTap ? ctx.reg.get(steps.holdTap) : undefined
  const candidates = steps?.tap && steps.hold ? compatibleHoldTaps(ctx.project.keymap, steps.hold, steps.tap) : []
  const lastTapCount = 2 + Math.max(steps?.moreTaps?.length ?? 0, extraTaps)
  const canAddTap = !!steps && !!(steps.doubleTap || steps.tapHold) && (lastTapCount === 2 || !!getStep(steps, `t${lastTapCount}`) || !!getStep(steps, `h${lastTapCount}`))
  const tdNode = steps?.tapDance ? behaviorNode(ctx.project.keymap, steps.tapDance) : undefined

  return (
    <div className="editor">
      <div className="steps">
        <div className="row small muted" style={{ marginBottom: 2 }}>
          <b style={{ color: 'var(--text)' }}>Key {pos}</b> on <b style={{ color: 'var(--text)' }}>{layerInfo.name}</b>
          <span className="grow" />
          <code title="ZMK binding">{formatBinding(binding)}</code>
        </div>
        {steps ? ids.map((s) => {
          const v = getStep(steps, s)
          const d = v ? describeSimple(v, ctx.describe) : undefined
          const removable = v && (s !== 'tap' || steps.hold || steps.doubleTap || steps.morph)
          const isExtra = !ORYX_STEPS.includes(s) && s !== 'morph'
          return (
            <div key={s} className={`step ${step === s ? 'active' : ''}`} onClick={() => setStep(s)} style={isExtra || s === 'morph' ? { borderStyle: 'dashed' } : undefined}>
              <div className="label">{stepLabel(s, steps)}
                {(isExtra || s === 'morph') && <span className="pill accent" style={{ marginLeft: 6, textTransform: 'none', letterSpacing: 0 }} title="A ZMK feature Oryx doesn't have">ZMK</span>}
                {removable && <button className="iconbtn x" title="Remove" onClick={(e) => { e.stopPropagation(); setStepBinding(s, undefined) }}>✕</button>}
              </div>
              <div className="value">{d ? <>{d.mods && <span className="muted small">{d.mods}</span>}{d.main || (v!.behavior === 'trans' ? 'Transparent' : v!.behavior === 'none' ? 'Nothing' : '')}<span className="faint small mono">{formatBinding(v!)}</span></> : <span className="none">+ add</span>}</div>
            </div>
          )
        }) : (
          <div className="banner warn">This key uses a behaviour the step editor can't show (for example a tap dance nested in another). Edit it as code on the right, or under Behaviours.</div>
        )}

        {steps && (
          <div className="row">
            <button className="btn small" disabled={!canAddTap} title={canAddTap ? 'ZMK tap dances can have any number of taps' : 'Set a double tap first'} onClick={() => { setExtraTaps(lastTapCount - 1); setStep(`t${lastTapCount + 1}`) }}>+ {lastTapCount + 1}{lastTapCount + 1 === 3 ? 'rd' : 'th'} tap</button>
            {!steps.morph && !pendingMorph && <button className="btn small" title="A different key while Shift (or another modifier) is held (ZMK mod-morph)" onClick={() => { setPendingMorph(true); setStep('morph') }}>+ When Shift is held</button>}
          </div>
        )}

        {tdNode && (
          <div className="card" style={{ padding: 10 }}>
            <label className="field"><span>Tap dance: time between taps (ms)</span>
              <input type="number" min={50} max={1000} step={10} placeholder="200 (default)" value={getRaw(tdNode, 'tapping-term-ms')?.replace(/[<>]/g, '') ?? ''} onChange={(e) => {
                const v = e.target.value
                store.apply((p) => editKeymap(p, (f) => { const n = behaviorNode(f, steps!.tapDance!); if (n) setProp(n, 'tapping-term-ms', v ? `<${Number(v)}>` : undefined) }), 'Tap dance timing')
              }} />
              <span className="small faint">&{steps!.tapDance}{behaviorUsage(ctx.project.keymap, steps!.tapDance!) > 1 ? ` · shared by ${behaviorUsage(ctx.project.keymap, steps!.tapDance!)} keys` : ''}</span>
            </label>
          </div>
        )}

        {steps?.tap && steps.hold && (
          <div className="card" style={{ padding: 10 }}>
            <div className="field">
              <span>Hold-tap behaviour</span>
              <select value={steps.holdTap ?? ''} onChange={(e) => update({ ...steps, holdTap: e.target.value }, `Use &${e.target.value} for key ${pos}`)}>
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
              <h3 style={{ margin: 0, fontSize: 15 }}>{stepLabel(step, steps)}</h3>
              <span className="grow" />
              {step === 'tap' && <>
                <button className="btn small" onClick={() => update({}, `Make key ${pos} transparent`)} title="Use the key from the layer below">Transparent</button>
                <button className="btn small" onClick={() => update({ tap: { behavior: 'none', params: [] } }, `Disable key ${pos}`)}>Nothing</button>
              </>}
            </div>
            {step === 'morph' && (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="small muted">While</span>
                <div className="modrow">
                  {MOD_CHOICES.map((c) => {
                    const cur = steps.morph?.mods ?? ['MOD_LSFT', 'MOD_RSFT']
                    const on = c.mods.some((m) => cur.includes(m))
                    return <button key={c.label} className={on ? 'on' : ''} onClick={() => {
                      if (!steps.morph) return
                      const next = on ? cur.filter((m) => !c.mods.includes(m)) : [...cur, ...c.mods]
                      if (next.length) update({ ...steps, morph: { ...steps.morph, mods: next } }, 'Mod-morph modifiers')
                    }}>{c.label}</button>
                  })}
                </div>
                <span className="small muted">is held</span>
                <label className="check small" title="Normally the modifier is removed before sending the alternative (so Shift+, sends a plain ;). Keep it to send e.g. Shift+Delete."><input type="checkbox" disabled={!steps.morph} checked={!!steps.morph?.keepMods.length} onChange={(e) => steps.morph && update({ ...steps, morph: { ...steps.morph, keepMods: e.target.checked ? steps.morph.mods : [] } }, 'Mod-morph keep modifiers')} /> keep the modifier held</label>
              </div>
            )}
            {step === 'tapHold' && <p className="small muted" style={{ marginTop: 0 }}>Set this to the tapped key to make tap-then-hold repeat it: that uses the hold-tap's quick tap (quick-tap-ms), not a tap dance, so fast repeated taps all register. Anything else needs a tap dance, which waits after each tap.</p>}
            {step.startsWith('t') && step !== 'tap' && step !== 'tapHold' && <p className="small muted" style={{ marginTop: 0 }}>Tap the key {ordinal(Number(step.slice(1)))} quickly. Each extra tap waits for the tap-dance timing before it sends, so keep many-tap keys off letters you type fast.</p>}
            <Picker
              key={`${layer}-${pos}-${step}`}
              ctx={ctx}
              value={stepValue}
              role={step === 'hold' || step === 'tapHold' || step.startsWith('h') ? 'hold' : 'tap'}
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
