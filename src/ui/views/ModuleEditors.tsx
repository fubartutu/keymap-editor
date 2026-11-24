import { useState } from 'react'
import { describeSimple } from '../../core/describe.ts'
import {
  behaviorUsage, deleteBehaviorNode, getAdaptiveKeys, getLeaderKeys, saveAdaptiveKey, saveLeaderKey,
  type AdaptiveKey, type AdaptiveTrigger, type LeaderKey, type LeaderSequence,
} from '../../core/features.ts'
import { formatBinding, type Binding } from '../../core/keymap.ts'
import { addModule, hasModule, KNOWN_MODULES } from '../../core/modules.ts'
import { editKeymap, type Project } from '../../core/project.ts'
import type { DtsFile } from '../../core/dts.ts'
import { KeyList } from '../components/KeyList.tsx'
import { Picker } from '../components/Picker.tsx'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

const LETTERS = 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z'.split(' ')

/** Edit the keymap and make sure the module providing `compatible` is in west.yml. */
export function withModule(p: Project, compatible: string, fn: (f: DtsFile) => void): Project {
  const next = editKeymap(p, fn)
  const mod = KNOWN_MODULES.find((m) => m.compatible === compatible)
  if (mod && next.west && !hasModule(next.west.text, mod.id)) return { ...next, west: { ...next.west, text: addModule(next.west.text, mod) } }
  return next
}

export function ModuleBanner({ ctx, store, compatible }: { ctx: Ctx; store: Store; compatible: string }) {
  const mod = KNOWN_MODULES.find((m) => m.compatible === compatible)!
  const west = ctx.project.west
  if (!west) return <div className="banner warn">No config/west.yml found: add the <a href={mod.docs} target="_blank" rel="noreferrer">{mod.id}</a> module yourself.</div>
  if (hasModule(west.text, mod.id)) return <div className="small muted">Provided by the <a href={mod.docs} target="_blank" rel="noreferrer">{mod.id}</a> module ({west.path}). Not part of Oryx.</div>
  return (
    <div className="banner err">
      <span className="grow">This needs the <b>{mod.id}</b> module, which isn't in {west.path} yet. The firmware won't build without it.</span>
      <button className="btn small primary" onClick={() => store.apply((p) => ({ ...p, west: { ...p.west!, text: addModule(p.west!.text, mod) } }), `Add ${mod.id} to west.yml`)}>Add module</button>
    </div>
  )
}

/** A short list of bindings (sent in order), each editable with the picker. */
function BindingSeq({ ctx, value, onChange, max, single }: { ctx: Ctx; value: Binding[]; onChange: (b: Binding[]) => void; max?: number; single?: boolean }) {
  const [open, setOpen] = useState<number | null>(value.length ? null : 0)
  const list = value.length ? value : [{ behavior: 'none', params: [] }]
  return (
    <div className="steps-list">
      {list.map((b, i) => {
        const d = describeSimple(b, ctx.describe)
        return (
          <div key={i}>
            <div className="mstep" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === i ? null : i)}>
              {!single && <span className="faint small" style={{ width: 16 }}>{i + 1}</span>}
              <b className="grow">{(d.mods ?? '') + (d.main || (b.behavior === 'none' ? 'Nothing' : ''))}</b>
              <code className="small">{formatBinding(b)}</code>
              {!single && list.length > 1 && <button className="iconbtn" onClick={(e) => { e.stopPropagation(); onChange(list.filter((_, j) => j !== i)) }}>✕</button>}
            </div>
            {open === i && <div className="card" style={{ padding: 10, marginTop: 4 }}><Picker ctx={ctx} value={b} role="tap" onChange={(nb) => onChange(list.map((x, j) => (j === i ? nb : x)))} /></div>}
          </div>
        )
      })}
      {!single && (!max || list.length < max) && <button className="btn small" style={{ alignSelf: 'start' }} onClick={() => { onChange([...list, { behavior: 'kp', params: ['A'] }]); setOpen(list.length) }}>+ then another key</button>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Leader keys

export function LeaderEditor({ ctx, store, id, onDeleted, onRenamed }: { ctx: Ctx; store: Store; id: string; onDeleted: () => void; onRenamed: (id: string) => void }) {
  const leader = getLeaderKeys(ctx.project.keymap).find((l) => l.label === id)
  const [label, setLabel] = useState(id)
  const [open, setOpen] = useState<number | null>(null)
  if (!leader) return null
  const save = (l: LeaderKey, what: string) => {
    let saved = l.label
    store.apply((p) => withModule(p, 'zmk,behavior-leader-key', (f) => { saved = saveLeaderKey(f, l, id) }), what)
    if (saved !== id) onRenamed(saved)
  }
  const setSeq = (i: number, s: LeaderSequence, what: string) => save({ ...leader, sequences: leader.sequences.map((x, j) => (j === i ? s : x)) }, what)
  const uses = behaviorUsage(ctx.project.keymap, id)
  return (
    <div className="card">
      <header>
        <span className="mono">&</span>
        <input type="text" className="mono" value={label} style={{ fontWeight: 600, width: 180 }} onChange={(e) => setLabel(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())} onBlur={() => label && label !== id && !ctx.reg.get(label) ? save({ ...leader, label }, `Rename &${id}`) : setLabel(id)} />
        <span className="pill accent">Leader key</span>
        <span className="small muted">{uses ? `on ${uses} key${uses > 1 ? 's' : ''}` : 'not on any key yet'}</span>
        <span className="grow" />
        <button className="btn small danger" onClick={() => { if (!uses || confirm(`&${id} is on ${uses} key(s). Delete anyway?`)) { store.apply((p) => editKeymap(p, (f) => deleteBehaviorNode(f, id)), `Delete &${id}`); onDeleted() } }}>Delete</button>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ModuleBanner ctx={ctx} store={store} compatible="zmk,behavior-leader-key" />
        <p className="small muted" style={{ margin: 0 }}>Press the leader key, then type one of these sequences. Keys are matched by what they send, so a sequence works from any layer. A key that doesn't continue any sequence cancels the leader and types normally. Put the leader on a key with the picker (<b>Behaviours</b> category).</p>
        {!uses && <div className="banner warn">Not on any key yet: pick a key on the Layout page and choose <b>Behaviours → {leader.name}</b>. Putting it on both halves lets BOOT / RESET reach either half.</div>}
        <div className="steps-list">
          {leader.sequences.map((s, i) => {
            const d = s.bindings[0] ? describeSimple(s.bindings[0], ctx.describe) : undefined
            return (
              <div key={s.id + i} className="rule">
                <div className="head">
                  <span className="pill">★</span>
                  <KeyList value={s.keys} max={16} onChange={(keys) => setSeq(i, { ...s, keys }, `Leader sequence ${keys.join(' ')}`)} placeholder="sequence…" />
                  <span className="muted">→</span>
                  <button className="btn small" onClick={() => setOpen(open === i ? null : i)}>{d ? (d.mods ?? '') + d.main : 'choose…'}{s.bindings.length > 1 ? ` +${s.bindings.length - 1}` : ''}</button>
                  <span className="grow" />
                  <button className="iconbtn" title="Remove" onClick={() => save({ ...leader, sequences: leader.sequences.filter((_, j) => j !== i) }, 'Remove leader sequence')}>✕</button>
                </div>
                {open === i && <BindingSeq ctx={ctx} value={s.bindings} onChange={(b) => setSeq(i, { ...s, bindings: b }, 'Leader sequence action')} />}
              </div>
            )
          })}
        </div>
        <div className="row">
          <button className="btn small primary" onClick={() => { save({ ...leader, sequences: [...leader.sequences, { id: '', keys: [], bindings: [{ behavior: 'none', params: [] }] }] }, 'Add leader sequence'); setOpen(leader.sequences.length) }}>+ Sequence</button>
          <span className="small faint">Tip: sequences can run macros (e.g. typed phrases) and work on any computer, including over remote desktop.</span>
        </div>
        <div className="field"><span>Ignore these keys while typing a sequence</span>
          <KeyList value={leader.ignoreKeys} onChange={(k) => save({ ...leader, ignoreKeys: k }, 'Leader ignore keys')} placeholder="e.g. LSHFT" />
          <span className="small faint">Usually Shift, so you can hold it for capitals without cancelling the leader.</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Adaptive keys

export function AdaptiveEditor({ ctx, store, id, onDeleted, onRenamed }: { ctx: Ctx; store: Store; id: string; onDeleted: () => void; onRenamed: (id: string) => void }) {
  const ak = getAdaptiveKeys(ctx.project.keymap).find((a) => a.label === id)
  const [label, setLabel] = useState(id)
  if (!ak) return null
  const save = (a: AdaptiveKey, what: string) => {
    let saved = a.label
    store.apply((p) => withModule(p, 'zmk,behavior-adaptive-key', (f) => { saved = saveAdaptiveKey(f, a, id) }), what)
    if (saved !== id) onRenamed(saved)
  }
  const setRule = (i: number, t: AdaptiveTrigger, what: string) => save({ ...ak, triggers: ak.triggers.map((x, j) => (j === i ? t : x)) }, what)
  const uses = behaviorUsage(ctx.project.keymap, id)
  const num = (v: string) => (v === '' ? undefined : Number(v))
  return (
    <div className="card">
      <header>
        <span className="mono">&</span>
        <input type="text" className="mono" value={label} style={{ fontWeight: 600, width: 180 }} onChange={(e) => setLabel(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())} onBlur={() => label && label !== id && !ctx.reg.get(label) ? save({ ...ak, label }, `Rename &${id}`) : setLabel(id)} />
        <span className="pill accent">Adaptive key</span>
        <span className="small muted">{uses ? `on ${uses} key${uses > 1 ? 's' : ''}` : 'not on any key yet'}</span>
        <span className="grow" />
        <button className="btn small danger" onClick={() => { if (!uses || confirm(`&${id} is on ${uses} key(s). Delete anyway?`)) { store.apply((p) => editKeymap(p, (f) => deleteBehaviorNode(f, id)), `Delete &${id}`); onDeleted() } }}>Delete</button>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ModuleBanner ctx={ctx} store={store} compatible="zmk,behavior-adaptive-key" />
        <div className="field"><span>Normally sends</span>
          <BindingSeq ctx={ctx} single value={ak.defaultBindings} onChange={(b) => save({ ...ak, defaultBindings: b }, 'Adaptive key default')} />
        </div>
        <div className="field"><span>Unless the previous key was… (first matching rule wins)</span>
          <div className="steps-list">
            {ak.triggers.map((t, i) => (
              <div key={t.id + i} className="rule">
                <div className="head">
                  <span className="small muted">After</span>
                  <KeyList value={t.triggerKeys} onChange={(k) => setRule(i, { ...t, triggerKeys: k }, 'Adaptive trigger keys')} placeholder="previous key…" />
                  <button className="btn small ghost" title="All letters A–Z" onClick={() => setRule(i, { ...t, triggerKeys: LETTERS }, 'Adaptive trigger: letters')}>A–Z</button>
                  <span className="grow" />
                  <button className="iconbtn" disabled={i === 0} onClick={() => { const tr = [...ak.triggers]; [tr[i - 1], tr[i]] = [tr[i], tr[i - 1]]; save({ ...ak, triggers: tr }, 'Reorder rules') }}>↑</button>
                  <button className="iconbtn" onClick={() => save({ ...ak, triggers: ak.triggers.filter((_, j) => j !== i) }, 'Remove rule')}>✕</button>
                </div>
                <div className="row small">
                  <label>within <input type="number" min={0} step={25} value={t.maxPriorIdleMs ?? ''} placeholder="any" style={{ width: 70 }} onChange={(e) => setRule(i, { ...t, maxPriorIdleMs: num(e.target.value) }, 'Rule timing')} /> ms</label>
                  <label>at least <input type="number" min={0} step={25} value={t.minPriorIdleMs ?? ''} placeholder="0" style={{ width: 70 }} onChange={(e) => setRule(i, { ...t, minPriorIdleMs: num(e.target.value) }, 'Rule timing')} /> ms after it</label>
                  <label className="check" title="Shift+A then this key won't match a rule for plain A"><input type="checkbox" checked={t.strictModifiers} onChange={(e) => setRule(i, { ...t, strictModifiers: e.target.checked }, 'Strict modifiers')} /> exact modifiers</label>
                  <label className="check" title="Send Backspace first, replacing the previous character"><input type="checkbox" checked={t.deletePrior} onChange={(e) => setRule(i, { ...t, deletePrior: e.target.checked }, 'Delete prior')} /> replace the previous character</label>
                </div>
                <div className="field"><span>then send</span>
                  <BindingSeq ctx={ctx} max={Number(4)} value={t.bindings} onChange={(b) => setRule(i, { ...t, bindings: b }, 'Rule output')} />
                </div>
              </div>
            ))}
          </div>
          <button className="btn small primary" style={{ alignSelf: 'start' }} onClick={() => save({ ...ak, triggers: [...ak.triggers, { id: '', triggerKeys: [], bindings: [{ behavior: 'kp', params: ['A'] }], maxPriorIdleMs: 300, strictModifiers: false, deletePrior: false }] }, 'Add rule')}>+ Rule</button>
        </div>
        <div className="field"><span>Dead keys</span>
          <KeyList value={ak.deadKeys} onChange={(k) => save({ ...ak, deadKeys: k }, 'Dead keys')} placeholder="e.g. GRAVE" />
          <span className="small faint">Keys listed here send nothing on their own when typed before this key (they only change what this key sends); pressing them twice types them normally. Used for accents: ` then E → è.</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Templates

export const MODULE_TEMPLATES: { id: string; name: string; desc: string; compatible: string; make: (f: DtsFile) => string }[] = [
  {
    id: 'leader', name: 'Leader key', compatible: 'zmk,behavior-leader-key',
    desc: 'Leader, then a sequence. Starts with keyboard controls (B 0-4 Bluetooth profile, U S B / B L E output, B O O T, R E S E T) that you can change or add to.',
    make: (f) => saveLeaderKey(f, {
      label: 'leader', name: 'Leader', ignoreKeys: ['LSHFT', 'RSHFT'],
      sequences: [
        ...[0, 1, 2, 3, 4].map((n) => ({ id: `bt${n}`, keys: ['B', `N${n}`], bindings: [{ behavior: 'bt', params: ['BT_SEL', String(n)] }] })),
        { id: 'btclr', keys: ['B', 'C'], bindings: [{ behavior: 'bt', params: ['BT_CLR'] }] },
        { id: 'usb', keys: ['U', 'S', 'B'], bindings: [{ behavior: 'out', params: ['OUT_USB'] }] },
        { id: 'ble', keys: ['B', 'L', 'E'], bindings: [{ behavior: 'out', params: ['OUT_BLE'] }] },
        { id: 'boot', keys: ['B', 'O', 'O', 'T'], bindings: [{ behavior: 'bootloader', params: [] }] },
        { id: 'reset', keys: ['R', 'E', 'S', 'E', 'T'], bindings: [{ behavior: 'sys_reset', params: [] }] },
      ],
    }),
  },
  {
    id: 'shift-repeat', name: 'Shift / repeat (adaptive)', compatible: 'zmk,behavior-adaptive-key',
    desc: 'One-shot Shift normally, but straight after a letter it repeats that letter: "ll", "ss", "ee" without a same-finger double press (urob\'s example).',
    make: (f) => saveAdaptiveKey(f, {
      label: 'shift_repeat', name: 'Shift / repeat', defaultBindings: [{ behavior: 'sk', params: ['LSHFT'] }], deadKeys: [],
      triggers: [{ id: 'repeat', triggerKeys: LETTERS, bindings: [{ behavior: 'key_repeat', params: [] }], maxPriorIdleMs: 350, strictModifiers: true, deletePrior: false }],
    }),
  },
  {
    id: 'sentence-space', name: 'Space that capitalises sentences (adaptive)', compatible: 'zmk,behavior-adaptive-key',
    desc: 'Space, but after . ? or ! it also turns on Shift for the next letter, so sentences start with a capital.',
    make: (f) => saveAdaptiveKey(f, {
      label: 'ak_space', name: 'Sentence space', defaultBindings: [{ behavior: 'kp', params: ['SPACE'] }], deadKeys: [],
      triggers: [{ id: 'after_stop', triggerKeys: ['DOT', 'QMARK', 'EXCL'], bindings: [{ behavior: 'kp', params: ['SPACE'] }, { behavior: 'sk', params: ['LSHFT'] }], maxPriorIdleMs: 1000, strictModifiers: false, deletePrior: false }],
    }),
  },
  {
    id: 'adaptive', name: 'Adaptive key (blank)', compatible: 'zmk,behavior-adaptive-key',
    desc: 'A key that sends something else depending on the key typed just before it. Start empty and add rules.',
    make: (f) => saveAdaptiveKey(f, { label: 'ak', name: 'Adaptive key', defaultBindings: [{ behavior: 'kp', params: ['A'] }], deadKeys: [], triggers: [] }),
  },
]
