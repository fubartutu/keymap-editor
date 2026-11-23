import { useEffect, useMemo, useState } from 'react'
import { BUILTIN_BEHAVIORS, MOUSE_BUTTONS, MOUSE_MOVES, SCROLLS, type BehaviorDef } from '../../core/behaviors.ts'
import { formatKeyExpr, fuzzyScore, KEYCODE_CATEGORIES, KEYCODES, keyLabel, keycodeFromDomCode, MOD_FNS, MOD_NAMES, guiName, parseKeyExpr, type KeycodeCategory, type ModFn } from '../../core/keycodes.ts'
import { formatBinding, layerToken, tokensToBindings, type Binding } from '../../core/keymap.ts'
import { tokenizeCells } from '../../core/dts.ts'
import { getMacros } from '../../core/features.ts'
import { layerColor } from '../../core/project.ts'
import type { Ctx } from '../context.ts'

type Cat = KeycodeCategory | 'Layers' | 'Mouse' | 'Bluetooth' | 'Lighting' | 'Firmware' | 'Special' | 'Macros' | 'Behaviours'

const OTHER_CATS: Cat[] = ['Layers', 'Mouse', 'Bluetooth', 'Lighting', 'Firmware', 'Special', 'Macros', 'Behaviours']

interface Props {
  ctx: Ctx
  value?: Binding
  onChange: (b: Binding) => void
  role: 'tap' | 'hold' | 'any'
  /** Called when the user wants a new macro. */
  onNewMacro?: () => void
}

function isKeyBinding(b?: Binding) { return !!b && (b.behavior === 'kp' || b.behavior === 'sk' || b.behavior === 'kt') }

export function Picker({ ctx, value, onChange, role, onNewMacro }: Props) {
  const initialCat: Cat = useMemo(() => {
    if (!value) return role === 'hold' ? 'Modifiers' : 'Letters'
    if (isKeyBinding(value)) {
      const k = KEYCODES.find((x) => x.names.includes(parseKeyExpr(value.params[0] ?? '').key))
      return k?.category ?? 'Letters'
    }
    const def = ctx.reg.get(value.behavior)
    if (!def) return 'Special'
    if (def.kind === 'layer') return 'Layers'
    if (def.kind === 'mouse') return 'Mouse'
    if (def.id === 'bt' || def.id === 'out') return 'Bluetooth'
    if (def.category === 'Lighting & power') return 'Lighting'
    if (def.category === 'Firmware') return 'Firmware'
    if (def.kind === 'macro') return 'Macros'
    if (!def.builtin) return 'Behaviours'
    return 'Special'
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [cat, setCat] = useState<Cat>(initialCat)
  const [query, setQuery] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [raw, setRaw] = useState(value ? formatBinding(value) : '')
  const [rawError, setRawError] = useState<string>()

  useEffect(() => { setRaw(value ? formatBinding(value) : ''); setRawError(undefined) }, [value])

  const expr = isKeyBinding(value) ? parseKeyExpr(value!.params[0] ?? '') : undefined
  const mods = expr?.mods ?? []
  const keyBehavior = isKeyBinding(value) ? value!.behavior : 'kp'

  const pickKey = (code: string) => {
    onChange({ behavior: keyBehavior, params: [formatKeyExpr({ mods, key: code })] })
  }
  const toggleMod = (m: ModFn) => {
    if (!expr) return
    const next = mods.includes(m) ? mods.filter((x) => x !== m) : [...mods, m].sort((a, b) => MOD_FNS.indexOf(a) - MOD_FNS.indexOf(b))
    onChange({ behavior: keyBehavior, params: [formatKeyExpr({ mods: next, key: expr.key })] })
  }

  // Press-a-key capture, like Oryx's search by key press.
  useEffect(() => {
    if (!capturing) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const code = keycodeFromDomCode(e.code)
      if (!code) return
      const isModKey = /^(Control|Shift|Alt|Meta|OS)/.test(e.code)
      const m: ModFn[] = []
      if (!isModKey) {
        if (e.ctrlKey) m.push('LC')
        if (e.shiftKey) m.push('LS')
        if (e.altKey) m.push('LA')
        if (e.metaKey) m.push('LG')
      }
      onChange({ behavior: 'kp', params: [formatKeyExpr({ mods: m, key: code })] })
      setCapturing(false)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [capturing, onChange])

  const macros = getMacros(ctx.project.keymap)
  const customs = ctx.reg.all.filter((d) => !d.builtin && d.kind !== 'macro' && d.kind !== 'hold-tap')

  const results = useMemo(() => {
    if (!query.trim()) return null
    const q = query.trim()
    type R = { binding: Binding; label: string; sub: string; score: number }
    const out: R[] = []
    for (const k of KEYCODES) {
      const score = Math.max(...k.names.map((n) => fuzzyScore(q, n)), fuzzyScore(q, k.description) - 50, k.label.length > 1 ? fuzzyScore(q, k.label) : k.label === q ? 1000 : -1)
      if (score > 0) out.push({ binding: { behavior: 'kp', params: [k.code] }, label: k.label, sub: k.code, score })
    }
    ctx.layers.forEach((l, i) => {
      const s = fuzzyScore(q, l.name)
      if (s > 0) for (const beh of ['mo', 'to', 'tog', 'sl']) out.push({ binding: { behavior: beh, params: [layerToken(i, ctx.defines)] }, label: l.name, sub: `&${beh}`, score: s - (beh === 'mo' ? 0 : 5) })
    })
    for (const d of [...BUILTIN_BEHAVIORS, ...customs]) {
      const s = Math.max(fuzzyScore(q, d.name), fuzzyScore(q, d.id))
      if (s > 0 && d.params.length === 0) out.push({ binding: { behavior: d.id, params: [] }, label: d.name, sub: '&' + d.id, score: s })
      for (const c of d.commands ?? []) {
        const cs = Math.max(fuzzyScore(q, c.label + ' ' + d.name), fuzzyScore(q, c.code))
        if (cs > 0) out.push({ binding: { behavior: d.id, params: [c.code, ...(c.extra?.map((e) => String(e.min ?? 0)) ?? [])].filter((x) => !(c.code === 'RGB_COLOR_HSB' && x !== c.code)) }, label: `${d.name}: ${c.label}`, sub: c.code, score: cs })
      }
    }
    for (const m of macros) {
      const s = Math.max(fuzzyScore(q, m.name), fuzzyScore(q, m.label))
      if (s > 0 && m.bindingCells === 0) out.push({ binding: { behavior: m.label, params: [] }, label: '⚡ ' + m.name, sub: '&' + m.label, score: s })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60)
  }, [query, ctx, macros, customs])

  const active = (b: Binding) => !!value && formatBinding(value) === formatBinding(b)
  const tile = (b: Binding, label: React.ReactNode, sub?: string, key?: string, style?: React.CSSProperties) => (
    <button key={key ?? formatBinding(b)} className={`tile ${active(b) ? 'active' : ''}`} style={style} title={formatBinding(b)} onClick={() => onChange(b)}>
      {label}{sub && <small>{sub}</small>}
    </button>
  )

  return (
    <div className="picker">
      <div className="row">
        <input type="search" className="grow" placeholder="Search keys, layers, behaviours… (e.g. “vol”, “enter”, “nav”)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className={`btn ${capturing ? 'primary' : ''}`} onClick={() => setCapturing((c) => !c)} title="Press a key on your keyboard to pick it">
          {capturing ? 'Press a key…' : '⌨ Press a key'}
        </button>
      </div>
      {capturing && <div className="capture">Press the key (with modifiers if you like) on the keyboard you're typing on. <span className="kbd">Esc</span> is assigned too — click the button again to cancel.</div>}

      {!results && (
        <div className="cats">
          {KEYCODE_CATEGORIES.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}
          <span style={{ width: 8 }} />
          {OTHER_CATS.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
      )}

      {(isKeyBinding(value) || (!results && KEYCODE_CATEGORIES.includes(cat as KeycodeCategory))) && (
        <div className="row">
          <div className="modrow">
            <span className="small muted">With</span>
            {MOD_FNS.map((m) => (
              <button key={m} className={mods.includes(m) ? 'on' : ''} disabled={!expr} onClick={() => toggleMod(m)} title={`${m}(…)`}>
                {m[0] === 'R' ? 'R ' : ''}{m.endsWith('G') ? guiName(ctx.project.meta.os) : MOD_NAMES[m].replace('AltGr', 'Alt')}
              </button>
            ))}
          </div>
          <span className="grow" />
          <div className="segmented" title="How the key is sent">
            {[['kp', 'Press'], ['sk', 'One-shot'], ['kt', 'Toggle']].map(([b, l]) => (
              <button key={b} className={keyBehavior === b ? 'active' : ''} disabled={!expr} onClick={() => value && onChange({ ...value, behavior: b })}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {results ? (
        <div className="grid wide">
          {results.length === 0 && <div className="muted small">Nothing matches “{query}”.</div>}
          {results.map((r, i) => tile(r.binding, r.label, r.sub, String(i)))}
        </div>
      ) : (
        <CategoryGrid cat={cat} ctx={ctx} tile={tile} pickKey={pickKey} value={value} onChange={onChange} macros={macros} customs={customs} onNewMacro={onNewMacro} activeKey={expr?.key} role={role} />
      )}

      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>Edit as ZMK code</summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input type="text" className="grow mono" value={raw} spellCheck={false} onChange={(e) => setRaw(e.target.value)} placeholder="&kp LC(A)" onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const bs = tokensToBindings(tokenizeCells(raw.trim()))
            if (bs.length !== 1) { setRawError('Enter exactly one binding, starting with &'); return }
            setRawError(undefined)
            onChange(bs[0])
          }} />
          <span className="small faint">Enter to apply</span>
        </div>
        {rawError && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{rawError}</div>}
      </details>
    </div>
  )
}

interface GridProps {
  cat: Cat
  ctx: Ctx
  tile: (b: Binding, label: React.ReactNode, sub?: string, key?: string, style?: React.CSSProperties) => React.ReactNode
  pickKey: (code: string) => void
  value?: Binding
  onChange: (b: Binding) => void
  macros: ReturnType<typeof getMacros>
  customs: BehaviorDef[]
  onNewMacro?: () => void
  activeKey?: string
  role: Props['role']
}

function CategoryGrid({ cat, ctx, tile, pickKey, value, onChange, macros, customs, onNewMacro, activeKey, role }: GridProps) {
  const [layerBeh, setLayerBeh] = useState(value && ['mo', 'to', 'tog', 'sl'].includes(value.behavior) ? value.behavior : 'mo')
  if (KEYCODE_CATEGORIES.includes(cat as KeycodeCategory)) {
    const keys = KEYCODES.filter((k) => k.category === cat)
    return (
      <div className="grid">
        {keys.map((k) => (
          <button key={k.code} className={`tile ${activeKey && k.names.includes(activeKey) ? 'active' : ''}`} title={`${k.code}: ${k.description}`} onClick={() => pickKey(k.code)}>
            {k.isModifier ? keyLabel(k.code, ctx.project.meta.os).label : k.label}
            {k.shifted ? <small>{k.shifted}</small> : k.isModifier ? <small>{k.code[0] === 'R' ? 'right' : 'left'}</small> : k.label.length > 3 || k.category === 'Apps' || k.category === 'System' ? null : <small>{k.code}</small>}
          </button>
        ))}
      </div>
    )
  }
  switch (cat) {
    case 'Layers':
      return (
        <>
          <div className="segmented">
            {[['mo', 'While held'], ['to', 'Switch to'], ['tog', 'Toggle'], ['sl', 'Next key only']].map(([b, l]) => (
              <button key={b} className={layerBeh === b ? 'active' : ''} onClick={() => {
                setLayerBeh(b)
                if (value && ['mo', 'to', 'tog', 'sl'].includes(value.behavior)) onChange({ ...value, behavior: b })
              }}>{l}</button>
            ))}
          </div>
          <div className="grid wide">
            {ctx.layers.map((l, i) => tile({ behavior: layerBeh, params: [layerToken(i, ctx.defines)] }, <span className="row" style={{ gap: 6 }}><span className="dot" style={{ width: 9, height: 9, borderRadius: 9, background: layerColor(ctx.project, l.id, i) }} />{l.name}</span>, `${i} · &${layerBeh}`, l.id))}
          </div>
          {role === 'hold' && <p className="small muted">For a hold action, “While held” is what you want almost always (it becomes a layer-tap, like Oryx's “hold for layer”).</p>}
        </>
      )
    case 'Mouse':
      return (
        <div className="grid wide">
          {MOUSE_BUTTONS.map((m) => tile({ behavior: 'mkp', params: [m.code] }, m.label, m.code))}
          {MOUSE_MOVES.map((m) => tile({ behavior: 'mmv', params: [m.code] }, `Move ${m.label.toLowerCase()}`, m.code))}
          {SCROLLS.map((m) => tile({ behavior: 'msc', params: [m.code] }, `Scroll ${m.label.toLowerCase()}`, m.code))}
        </div>
      )
    case 'Bluetooth':
      return (
        <div className="grid wide">
          {[0, 1, 2, 3, 4].map((n) => tile({ behavior: 'bt', params: ['BT_SEL', String(n)] }, `Profile ${n}`, `BT_SEL ${n}`))}
          {tile({ behavior: 'bt', params: ['BT_NXT'] }, 'Next profile', 'BT_NXT')}
          {tile({ behavior: 'bt', params: ['BT_PRV'] }, 'Previous profile', 'BT_PRV')}
          {tile({ behavior: 'bt', params: ['BT_CLR'] }, 'Clear current profile', 'BT_CLR')}
          {tile({ behavior: 'bt', params: ['BT_CLR_ALL'] }, 'Clear all profiles', 'BT_CLR_ALL')}
          {[0, 1, 2, 3, 4].map((n) => tile({ behavior: 'bt', params: ['BT_DISC', String(n)] }, `Disconnect ${n}`, `BT_DISC ${n}`))}
          {tile({ behavior: 'out', params: ['OUT_USB'] }, 'Output: USB', 'OUT_USB')}
          {tile({ behavior: 'out', params: ['OUT_BLE'] }, 'Output: Bluetooth', 'OUT_BLE')}
          {tile({ behavior: 'out', params: ['OUT_TOG'] }, 'Toggle USB/BLE', 'OUT_TOG')}
        </div>
      )
    case 'Lighting': {
      const rgb = BUILTIN_BEHAVIORS.find((b) => b.id === 'rgb_ug')!
      const bl = BUILTIN_BEHAVIORS.find((b) => b.id === 'bl')!
      const ep = BUILTIN_BEHAVIORS.find((b) => b.id === 'ext_power')!
      return (
        <>
          <div className="grid wide">
            {rgb.commands!.filter((c) => !c.extra).map((c) => tile({ behavior: 'rgb_ug', params: [c.code] }, `RGB ${c.label.toLowerCase()}`, c.code))}
            {ep.commands!.map((c) => tile({ behavior: 'ext_power', params: [c.code] }, `Power ${c.label.toLowerCase()}`, c.code))}
            {bl.commands!.filter((c) => !c.extra).map((c) => tile({ behavior: 'bl', params: [c.code] }, `Backlight ${c.label.toLowerCase()}`, c.code))}
          </div>
          <RgbColour value={value} onChange={onChange} />
        </>
      )
    }
    case 'Firmware':
      return <div className="grid wide">{BUILTIN_BEHAVIORS.filter((b) => b.category === 'Firmware').map((b) => tile({ behavior: b.id, params: [] }, b.name, b.description))}</div>
    case 'Special':
      return <div className="grid wide">{BUILTIN_BEHAVIORS.filter((b) => b.category === 'Special').map((b) => tile({ behavior: b.id, params: [] }, b.name, b.description))}</div>
    case 'Macros':
      return (
        <div className="grid wide">
          {macros.filter((m) => m.bindingCells === 0).map((m) => tile({ behavior: m.label, params: [] }, '⚡ ' + m.name, '&' + m.label))}
          {onNewMacro && <button className="tile" onClick={onNewMacro}>+ New macro<small>opens the macro editor</small></button>}
          {!macros.length && !onNewMacro && <div className="muted small">No macros yet.</div>}
        </div>
      )
    case 'Behaviours':
      return (
        <div className="grid wide">
          {customs.map((d) => d.params.length === 0
            ? tile({ behavior: d.id, params: [] }, d.name, `${d.description} · &${d.id}`)
            : tile({ behavior: d.id, params: d.params.map(() => '0') }, d.name, `&${d.id} (${d.params.length} params, edit as code)`))}
          {!customs.length && <div className="muted small">No custom behaviours. Hold-taps are set with the “Held” step; create mod-morphs and tap dances under Behaviours.</div>}
        </div>
      )
  }
  return null
}

function RgbColour({ value, onChange }: { value?: Binding; onChange: (b: Binding) => void }) {
  const m = value?.behavior === 'rgb_ug' ? value.params[0]?.match(/RGB_COLOR_HSB\((\d+),\s*(\d+),\s*(\d+)\)/) : null
  const [h, setH] = useState(m ? Number(m[1]) : 200)
  const [s, setS] = useState(m ? Number(m[2]) : 100)
  const [b, setB] = useState(m ? Number(m[3]) : 70)
  return (
    <div className="row small">
      <span className="muted">Set colour:</span>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: `hsl(${h} ${s}% ${Math.max(10, b / 2)}%)`, border: '1px solid var(--border-strong)' }} />
      <label>Hue <input type="number" min={0} max={359} value={h} onChange={(e) => setH(Number(e.target.value))} style={{ width: 64 }} /></label>
      <label>Sat <input type="number" min={0} max={100} value={s} onChange={(e) => setS(Number(e.target.value))} style={{ width: 58 }} /></label>
      <label>Bri <input type="number" min={0} max={100} value={b} onChange={(e) => setB(Number(e.target.value))} style={{ width: 58 }} /></label>
      <button className="btn small" onClick={() => onChange({ behavior: 'rgb_ug', params: [`RGB_COLOR_HSB(${h},${s},${b})`] })}>Use colour</button>
    </div>
  )
}
