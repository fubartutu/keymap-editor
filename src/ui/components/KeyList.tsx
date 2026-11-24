import { useEffect, useState } from 'react'
import { findKeycode, formatKeyExpr, fuzzyScore, KEYCODES, keyLabel, keycodeFromDomCode, parseKeyExpr, type ModFn } from '../../core/keycodes.ts'

/**
 * An editable list of keycodes (leader sequences, adaptive-key triggers, dead keys).
 * Type to add, or press Record and type on the keyboard.
 */
export function KeyList({ value, onChange, placeholder, max }: { value: string[]; onChange: (keys: string[]) => void; placeholder?: string; max?: number }) {
  const [q, setQ] = useState('')
  const [recording, setRecording] = useState(false)
  const suggestions = q.trim()
    ? KEYCODES.map((k) => ({ k, s: Math.max(...k.names.map((n) => fuzzyScore(q, n)), k.label.length === 1 && k.label.toLowerCase() === q.toLowerCase() ? 900 : -1, fuzzyScore(q, k.description) - 50) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.k)
    : []
  const add = (code: string) => { if (!max || value.length < max) onChange([...value, code]); setQ('') }

  useEffect(() => {
    if (!recording) return
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { setRecording(false); return }
      const code = keycodeFromDomCode(e.code)
      if (!code || /^(Control|Shift|Alt|Meta|OS)/.test(e.code)) return
      e.preventDefault(); e.stopPropagation()
      const mods: ModFn[] = []
      if (e.shiftKey) mods.push('LS')
      if (e.ctrlKey) mods.push('LC')
      if (e.altKey) mods.push('LA')
      onChange([...value, formatKeyExpr({ mods, key: code })].slice(0, max ?? 99))
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [recording, value, onChange, max])

  return (
    <div className="keylist">
      <div className="row" style={{ gap: 4 }}>
        {value.map((k, i) => (
          <span key={i} className="chip" title={findKeycode(parseKeyExpr(k).key)?.description ?? k}>
            <b>{(() => { const l = keyLabel(k); return (l.mods.length ? l.mods.join('+') + '+' : '') + l.label })()}</b>
            <span className="mono faint">{k}</span>
            <button className="iconbtn" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
        {(!max || value.length < max) && (
          <span style={{ position: 'relative' }}>
            <input type="text" value={q} placeholder={placeholder ?? 'add key…'} style={{ width: 120 }} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions[0]) add(suggestions[0].code)
              if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1))
            }} />
            {suggestions.length > 0 && (
              <div className="suggest">
                {suggestions.map((k) => <button key={k.code} onMouseDown={(e) => { e.preventDefault(); add(k.code) }}><b>{k.label}</b> <span className="mono faint">{k.code}</span></button>)}
              </div>
            )}
          </span>
        )}
        <button className={`btn small ${recording ? 'primary' : ''}`} onClick={() => setRecording((r) => !r)} title="Type the keys on your keyboard; Esc stops">{recording ? '● Recording (Esc stops)' : '⌨ Record'}</button>
      </div>
    </div>
  )
}
