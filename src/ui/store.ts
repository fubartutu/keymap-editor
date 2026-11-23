import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadProject, markSaved, serializeProject, type Project, type ProjectFiles } from '../core/project.ts'
import { validateProject, type Issue } from '../core/validate.ts'
import { printDts } from '../core/dts.ts'
import { api, type FirmwareCheck } from './api.ts'

export interface Store {
  project: Project
  apply: (fn: (p: Project) => Project, label?: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  lastAction?: string
  dirty: boolean
  pending: Record<string, string>
  notes: string[]
  issues: Issue[]
  save: () => Promise<void>
  saving: boolean
  saveError?: string
  firmwareCheck?: FirmwareCheck
  checkFirmware: () => Promise<FirmwareCheck>
  revert: () => void
  validator: boolean
  gh: boolean
  setValidator: (v: boolean) => void
}

const LIMIT = 200

export function useStore(files: ProjectFiles, validator: boolean, gh: boolean): Store {
  const [state, setState] = useState(() => ({ past: [] as { p: Project; label?: string }[], present: loadProject(files), future: [] as { p: Project; label?: string }[], label: undefined as string | undefined }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [firmwareCheck, setFirmwareCheck] = useState<FirmwareCheck>()
  const [validatorOn, setValidator] = useState(validator)

  const apply = useCallback((fn: (p: Project) => Project, label?: string) => {
    setState((s) => {
      let next: Project
      try {
        next = fn(s.present)
      } catch (e) {
        alertError(e)
        return s
      }
      if (next === s.present) return s
      return { past: [...s.past, { p: s.present, label }].slice(-LIMIT), present: next, future: [], label }
    })
  }, [])
  const undo = useCallback(() => setState((s) => {
    const prev = s.past[s.past.length - 1]
    if (!prev) return s
    return { past: s.past.slice(0, -1), present: prev.p, future: [{ p: s.present, label: prev.label }, ...s.future], label: prev.label && `Undid: ${prev.label}` }
  }), [])
  const redo = useCallback(() => setState((s) => {
    const next = s.future[0]
    if (!next) return s
    return { past: [...s.past, { p: s.present, label: next.label }], present: next.p, future: s.future.slice(1), label: next.label && `Redid: ${next.label}` }
  }), [])

  const { files: pending, notes } = useMemo(() => {
    try { return serializeProject(state.present) } catch (e) { return { files: {}, notes: [String(e)] } }
  }, [state.present])
  const issues = useMemo(() => validateProject(state.present), [state.present])
  const dirty = Object.keys(pending).length > 0

  const checkFirmware = useCallback(async () => {
    const keymapText = pending[state.present.files.keymapPath] ?? printDts(state.present.keymap)
    const r = await api.validate(keymapText, state.present.files.layout.keys.length)
    setFirmwareCheck(r)
    return r
  }, [pending, state.present])

  const presentRef = useRef(state.present)
  presentRef.current = state.present

  const save = useCallback(async () => {
    if (!dirty || saving) return
    setSaving(true)
    setSaveError(undefined)
    try {
      if (issues.some((i) => i.severity === 'error')) {
        if (!confirm('The keymap has errors that will stop the firmware from building. Save anyway?')) return
      }
      if (validatorOn) {
        const r = await checkFirmware()
        if (r.available && !r.ok && !confirm(`The firmware check found problems:\n\n${(r.errors ?? []).join('\n')}\n\nSave anyway?`)) return
      }
      await api.save(pending)
      const saved = pending
      setState((s) => ({ ...s, present: markSaved(s.present, saved), label: 'Saved' }))
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [dirty, saving, issues, validatorOn, checkFirmware, pending])

  const revert = useCallback(() => {
    setState((s) => ({ past: [...s.past, { p: s.present, label: 'Discard changes' }], present: loadProject(s.present.files), future: [], label: 'Discarded unsaved changes' }))
  }, [])

  // Warn before closing with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault() } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  return {
    project: state.present, apply, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0, lastAction: state.label,
    dirty, pending, notes, issues, save, saving, saveError, firmwareCheck, checkFirmware, revert, validator: validatorOn, gh, setValidator,
  }
}

function alertError(e: unknown) {
  // Composer errors (e.g. a 2-parameter behaviour as a hold action) are user-facing messages.
  setTimeout(() => alert(e instanceof Error ? e.message : String(e)), 0)
}
