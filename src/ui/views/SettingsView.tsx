import { useState } from 'react'
import { SECTIONS, SETTINGS, type Setting } from '../../core/settings.ts'
import { readSetting, writeSetting } from '../../core/settingsio.ts'
import { autoMouseExcluded } from '../../core/project.ts'
import { getAutoMouse } from '../../core/overlay.ts'
import type { Ctx } from '../context.ts'
import type { Store } from '../store.ts'

export function SettingsView({ ctx, store }: { ctx: Ctx; store: Store }) {
  const p = ctx.project
  const f = p.files.features
  const [filter, setFilter] = useState('')
  const usesModule = (c: string) => ctx.reg.all.some((d) => d.compatible === c)
  const applies = (s: Setting) => !s.requires || (s.requires === 'pmw3610' ? f.pmw3610 : s.requires === 'auto-mouse' ? f.autoMouse : s.requires === 'underglow' ? f.underglow
    : s.requires === 'leader' ? usesModule('zmk,behavior-leader-key') : s.requires === 'adaptive' ? usesModule('zmk,behavior-adaptive-key') : f.split)
  const values = new Map(SETTINGS.map((s) => [s.id, readSetting(p, s)]))
  const visible = (s: Setting) => {
    if (!applies(s) || !values.get(s.id)!.available) return false
    if (s.dependsOn) {
      const dep = SETTINGS.find((x) => x.id === s.dependsOn!.id)!
      const v = values.get(dep.id)!.value ?? dep.default
      if (v !== s.dependsOn.value) return false
    }
    if (filter) {
      const q = filter.toLowerCase()
      return [s.title, s.description, s.oryx ?? '', JSON.stringify(s.target)].some((t) => t.toLowerCase().includes(q))
    }
    return true
  }
  const sections = SECTIONS.filter((sec) => SETTINGS.some((s) => s.section === sec.id && visible(s)))

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lead">Firmware options for {p.files.name}. Each one is written to the file shown under it. Options you haven't set aren't written; ↺ removes a line so the default applies. Names in <i>italics</i> are the Oryx equivalent.</p>
      <div className="settings">
        <nav>
          <input type="search" placeholder="Filter settings" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 8 }} />
          {sections.map((s) => <a key={s.id} href={`#settings-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`settings-${s.id}`)?.scrollIntoView({ behavior: 'smooth' }) }}>{s.title}</a>)}
        </nav>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sections.map((sec) => (
            <section key={sec.id} id={`settings-${sec.id}`} className="card">
              <header><h2>{sec.title}</h2></header>
              <div className="content small muted" style={{ paddingBottom: 0 }}>{sec.description}</div>
              {SETTINGS.filter((s) => s.section === sec.id && visible(s)).map((s) => (
                <SettingRow key={s.id} ctx={ctx} s={s} state={values.get(s.id)!} onChange={(v) => store.apply((pp) => writeSetting(pp, s, v), `${s.title}: ${v === undefined ? 'default' : String(v)}`)} />
              ))}
              {sec.id === 'automouse' && <AutoMouseSync ctx={ctx} store={store} />}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function SettingRow({ ctx, s, state, onChange }: { ctx: Ctx; s: Setting; state: ReturnType<typeof readSetting>; onChange: (v: unknown) => void }) {
  const v = state.value
  const effective = v ?? s.default
  const changed = v !== undefined && v !== s.default
  const explicit = v !== undefined
  const [draft, setDraft] = useState<string>()
  const commitNumber = (raw: string) => {
    setDraft(undefined)
    if (raw === '') return onChange(undefined)
    let n = Number(raw)
    if (Number.isNaN(n)) return
    if (s.min !== undefined) n = Math.max(s.min, n)
    if (s.max !== undefined) n = Math.min(s.max, n)
    onChange(n)
  }
  return (
    <div className={`setting ${changed ? 'changed' : ''}`}>
      <div>
        <h3>{s.title}{s.oryx && <i className="small faint" style={{ fontWeight: 400 }}>{s.oryx}</i>}</h3>
        <p>{s.description}{s.default !== undefined && <> Default: <b>{s.type === 'toggle' ? (s.default ? 'on' : 'off') : s.options?.find((o) => o.value === String(s.default))?.label ?? String(s.default)}{s.unit && s.type === 'number' ? ' ' + s.unit : ''}</b>.</>}</p>
        <div className="where">{s.target.kind === 'kconfig' ? `CONFIG_${s.target.symbol}` : s.target.kind === 'kconfig-choice' ? s.target.options.map((o) => 'CONFIG_' + o.symbol).join(' / ') : s.target.kind === 'override' ? `&${s.target.behavior} { ${s.target.prop} }` : s.target.kind === 'define' ? `#define ${s.target.name}` : `&${s.target.label} ${s.target.prop}`} → {state.where ?? '—'}</div>
      </div>
      <div className="ctl">
        {s.type === 'toggle' && <label className="toggle"><input type="checkbox" checked={!!effective} onChange={(e) => onChange(e.target.checked)} /><span /></label>}
        {s.type === 'number' && <>
          {s.min !== undefined && s.max !== undefined && s.max - s.min <= 5000 && <input type="range" min={s.min} max={s.max} step={s.step ?? 1} value={Number(draft ?? effective ?? s.min)} onChange={(e) => setDraft(e.target.value)} onMouseUp={(e) => commitNumber((e.target as HTMLInputElement).value)} onKeyUp={(e) => commitNumber((e.target as HTMLInputElement).value)} />}
          <input type="number" min={s.min} max={s.max} step={s.step ?? 1} value={draft ?? (effective as number | undefined) ?? ''} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commitNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commitNumber((e.target as HTMLInputElement).value)} />
          {s.unit && <span className="small faint">{s.unit === 'milliseconds' ? 'ms' : s.unit}</span>}
        </>}
        {s.type === 'select' && <select value={String(effective ?? '')} onChange={(e) => onChange(e.target.value)}>
          {s.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>}
        {s.type === 'text' && <input type="text" maxLength={16} defaultValue={String(v ?? '')} onBlur={(e) => e.target.value !== (v ?? '') && onChange(e.target.value || undefined)} />}
        {s.type === 'layer' && <select value={String(v ?? '')} onChange={(e) => onChange(Number(e.target.value))}>
          {ctx.layers.map((l, i) => <option key={l.id} value={i}>{i}: {l.name}</option>)}
        </select>}
        {s.type === 'layers' && <div className="modrow" style={{ justifyContent: 'flex-end' }}>
          {ctx.layers.map((l, i) => {
            const list = (v as number[] | undefined) ?? []
            const on = list.includes(i)
            return <button key={l.id} className={on ? 'on' : ''} onClick={() => onChange(on ? list.filter((x) => x !== i) : [...list, i].sort((a, b) => a - b))}>{l.name}</button>
          })}
        </div>}
        {explicit && s.type !== 'layer' && s.type !== 'layers' && s.target.kind !== 'overlay' && <button className="iconbtn small" title="Remove this line so the default applies (the shield may set its own default)" onClick={() => onChange(undefined)}>↺</button>}
      </div>
    </div>
  )
}

function AutoMouseSync({ ctx, store }: { ctx: Ctx; store: Store }) {
  const am = getAutoMouse(ctx.project.overlays)
  const wanted = autoMouseExcluded(ctx.project)
  if (!am) return null
  const inSync = wanted && wanted.join(' ') === am.excluded.join(' ')
  return (
    <div className="setting">
      <div>
        <h3>Keep mouse-layer keys working</h3>
        <p>Pressing a key that isn't on the mouse layer turns auto-mouse off. The keys that <i>are</i> on it (<code>excluded-positions</code>) are kept in step with the mouse layer automatically when you save, so you no longer have to edit the overlay by hand.</p>
        <div className="where">excluded-positions = &lt;{am.excluded.join(' ')}&gt;{!inSync && wanted && <> → &lt;{wanted.join(' ')}&gt; on save</>}</div>
      </div>
      <div className="ctl"><label className="toggle"><input type="checkbox" checked={ctx.project.meta.syncAutoMouse} onChange={(e) => store.apply((p) => ({ ...p, meta: { ...p.meta, syncAutoMouse: e.target.checked } }), 'Auto-mouse sync')} /><span /></label></div>
    </div>
  )
}
