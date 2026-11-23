import raw from './data/zmk-keycodes.json' with { type: 'json' }

/** One HID usage, with all its ZMK aliases. Data: ZMK documentation (MIT), via nickcoutsos/keymap-editor. */
export interface Keycode {
  /** Preferred (shortest) alias, used when the editor inserts the key. */
  code: string
  names: string[]
  description: string
  category: KeycodeCategory
  /** Short legend for the key cap. */
  label: string
  /** Legend of the shifted character, for keys like `1 and !`. */
  shifted?: string
  isModifier: boolean
}

export type KeycodeCategory =
  | 'Letters' | 'Numbers' | 'Symbols' | 'Modifiers' | 'Editing' | 'Navigation'
  | 'Function' | 'Numpad' | 'Media' | 'System' | 'Apps' | 'International'

export const KEYCODE_CATEGORIES: KeycodeCategory[] = [
  'Letters', 'Numbers', 'Symbols', 'Modifiers', 'Editing', 'Navigation', 'Function', 'Numpad', 'Media', 'System', 'Apps', 'International',
]

interface RawKeycode { names: string[]; description: string; context: string }

const LABELS: Record<string, string> = {
  ESC: 'Esc', RET: 'Enter', BSPC: '⌫', DEL: 'Del', TAB: 'Tab', SPACE: 'Space', CAPS: 'Caps', INS: 'Ins',
  HOME: 'Home', END: 'End', PG_UP: 'PgUp', PG_DN: 'PgDn', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→',
  PSCRN: 'PrtSc', SLCK: 'ScrLk', PAUSE_BREAK: 'Pause', K_APP: 'Menu',
  LCTRL: 'Ctrl', RCTRL: 'Ctrl', LSHFT: 'Shift', RSHFT: 'Shift', LALT: 'Alt', RALT: 'AltGr', LGUI: 'Gui', RGUI: 'Gui',
  K_MUTE: 'Mute', K_VOL_UP: 'Vol+', K_VOL_DN: 'Vol−', C_MUTE: 'Mute', C_VOL_UP: 'Vol+', C_VOL_DN: 'Vol−',
  C_PP: '⏯', C_NEXT: '⏭', C_PREV: '⏮', C_STOP: '⏹', C_PLAY: '▶', C_PAUSE: '⏸', C_FF: '⏩', C_RW: '⏪',
  C_BRI_UP: 'Bri+', C_BRI_DN: 'Bri−', K_PP: '⏯', K_NEXT: '⏭', K_PREV: '⏮',
  K_UNDO: 'Undo', K_CUT: 'Cut', K_COPY: 'Copy', K_PASTE: 'Paste', K_FIND: 'Find', K_AGAIN: 'Redo',
  KP_NUM: 'NumLk', KP_ENTER: 'Enter', KP_DOT: '.', KP_EQUAL: '=', KP_PLUS: '+', KP_MINUS: '−', KP_MULTIPLY: '×', KP_DIVIDE: '÷',
  NON_US_HASH: '#~', NON_US_BSLH: '\\|',
}

const NAV = new Set(['HOME', 'END', 'PG_UP', 'PG_DN', 'UP', 'DOWN', 'LEFT', 'RIGHT'])
const EDITING = new Set(['ESC', 'RET', 'BSPC', 'DEL', 'TAB', 'SPACE', 'CAPS', 'INS', 'PSCRN', 'SLCK', 'PAUSE_BREAK', 'K_APP',
  'K_UNDO', 'K_CUT', 'K_COPY', 'K_PASTE', 'K_FIND', 'K_AGAIN', 'K_EXEC', 'K_HELP', 'K_MENU', 'K_SELECT', 'K_STOP', 'K_CANCEL', 'CLEAR', 'K_CLEAR'])

function preferredName(names: string[]): string {
  return names.filter((n) => !n.includes('(')).reduce((a, b) => (b.length < a.length ? b : a))
}

function categorise(code: string, names: string[], k: RawKeycode, isModifier: boolean): KeycodeCategory {
  if (isModifier) return 'Modifiers'
  if (/^[A-Z]$/.test(code)) return 'Letters'
  if (/^N\d$/.test(code)) return 'Numbers'
  if (/^F\d+$/.test(code)) return 'Function'
  if (NAV.has(code)) return 'Navigation'
  if (EDITING.has(code)) return 'Editing'
  if (k.context === 'Keypad' || code.startsWith('KP_')) return 'Numpad'
  if (names.some((n) => /^(INT|LANG|INTERNATIONAL|LANGUAGE|NON_US)/.test(n))) return 'International'
  if (k.context === 'Consumer AL' || k.context === 'Consumer AC') return 'Apps'
  if (k.context.startsWith('Consumer')) {
    if (/VOL|MUTE|PLAY|PAUSE|NEXT|PREV|STOP|EJECT|FAST|REWIND|RECORD|SHUFFLE|REPEAT|BASS|MEDIA_STEP/.test(code + names.join())) return 'Media'
    return 'System'
  }
  if (/VOL|MUTE|K_PP|K_PLAY|K_NEXT|K_PREV|K_STOP2|K_EJECT/.test(code)) return 'Media'
  if (/^[^A-Z0-9]/.test(k.description) || /^(EXCL|AT|HASH|DLLR|PRCNT|CARET|AMPS|STAR|LPAR|RPAR|MINUS|UNDER|EQUAL|PLUS|LBKT|LBRC|RBKT|RBRC|BSLH|PIPE|TILDE|SEMI|COLON|SQT|DQT|GRAVE|COMMA|LT|DOT|GT|FSLH|QMARK)/.test(code)) return 'Symbols'
  return 'System'
}

function makeLabel(code: string, k: RawKeycode): { label: string; shifted?: string } {
  if (LABELS[code]) return { label: LABELS[code] }
  const d = k.description
  let m = d.match(/^([a-z]) and ([A-Z])$/)
  if (m) return { label: m[2] }
  m = d.match(/^(\S) (?:\[[^\]]*\] )?and (\S)/)
  if (m && !code.startsWith('KP_')) return { label: m[1], shifted: m[2] }
  m = d.match(/^(\S)(?: \[|$)/)
  if (m) return { label: m[1] }
  return { label: d.replace(/\s*\(.*\)$/, '').replace(/\s*\[.*\]$/, '') }
}

export const KEYCODES: Keycode[] = (raw as RawKeycode[]).map((k) => {
  const code = preferredName(k.names)
  const isModifier = k.names.some((n) => /^[LR][CSAG]\(code\)$/.test(n))
  const { label, shifted } = makeLabel(code, k)
  return { code, names: k.names.filter((n) => !n.includes('(')), description: k.description, category: categorise(code, k.names, k, isModifier), label, shifted, isModifier }
})

const BY_NAME = new Map<string, Keycode>()
for (const k of KEYCODES) for (const n of k.names) if (!BY_NAME.has(n)) BY_NAME.set(n, k)

export function findKeycode(name: string): Keycode | undefined {
  return BY_NAME.get(name)
}

// ---------------------------------------------------------------------------
// Modifier wrappers: LC(LS(A)) etc.

export type ModFn = 'LC' | 'LS' | 'LA' | 'LG' | 'RC' | 'RS' | 'RA' | 'RG'
export const MOD_FNS: ModFn[] = ['LC', 'LS', 'LA', 'LG', 'RC', 'RS', 'RA', 'RG']
export const MOD_FN_TO_KEY: Record<ModFn, string> = { LC: 'LCTRL', LS: 'LSHFT', LA: 'LALT', LG: 'LGUI', RC: 'RCTRL', RS: 'RSHFT', RA: 'RALT', RG: 'RGUI' }
export const MOD_KEY_TO_FN: Record<string, ModFn> = Object.fromEntries(
  Object.entries(MOD_FN_TO_KEY).flatMap(([fn, key]) => (findKeycode(key)?.names ?? [key]).map((n) => [n, fn as ModFn])),
)
export const MOD_NAMES: Record<ModFn, string> = { LC: 'Ctrl', LS: 'Shift', LA: 'Alt', LG: 'Gui', RC: 'Ctrl', RS: 'Shift', RA: 'AltGr', RG: 'Gui' }

export interface KeyExpr {
  mods: ModFn[]
  /** The innermost key, e.g. `A`. May be a raw expression we don't understand. */
  key: string
}

export function parseKeyExpr(expr: string): KeyExpr {
  const mods: ModFn[] = []
  let s = expr.trim()
  for (;;) {
    const m = s.match(/^([LR][CSAG])\((.*)\)$/)
    if (!m) break
    mods.push(m[1] as ModFn)
    s = m[2].trim()
  }
  return { mods, key: s }
}

export function formatKeyExpr(e: KeyExpr): string {
  return e.mods.reduceRight((inner, m) => `${m}(${inner})`, e.key)
}

export type OsFlavour = 'linux' | 'windows' | 'mac'

export function guiName(os: OsFlavour): string {
  return os === 'mac' ? '⌘' : os === 'windows' ? 'Win' : 'Super'
}

/** Short human legend for a keycode expression, e.g. `LC(LG(H))` → `Ctrl+Super+H`. */
export function keyLabel(expr: string, os: OsFlavour = 'linux'): { label: string; mods: string[]; known: boolean } {
  const { mods, key } = parseKeyExpr(expr)
  const k = findKeycode(key)
  const modNames = mods.map((m) => (m.endsWith('G') ? guiName(os) : MOD_NAMES[m]))
  let label = k ? k.label : key
  if (k?.isModifier && /GUI|WIN|CMD|META/.test(key)) label = guiName(os)
  // A shifted symbol reads better than "Shift+1".
  if (k?.shifted && mods.length === 1 && (mods[0] === 'LS' || mods[0] === 'RS')) return { label: k.shifted, mods: [], known: true }
  return { label, mods: modNames, known: !!k }
}

// ---------------------------------------------------------------------------
// Press-a-key: map KeyboardEvent.code to a ZMK keycode.

const DOM_CODE: Record<string, string> = {
  Escape: 'ESC', Enter: 'RET', Backspace: 'BSPC', Tab: 'TAB', Space: 'SPACE', Delete: 'DEL', Insert: 'INS',
  Home: 'HOME', End: 'END', PageUp: 'PG_UP', PageDown: 'PG_DN', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  CapsLock: 'CAPS', PrintScreen: 'PSCRN', ScrollLock: 'SLCK', Pause: 'PAUSE_BREAK', ContextMenu: 'K_APP',
  Minus: 'MINUS', Equal: 'EQUAL', BracketLeft: 'LBKT', BracketRight: 'RBKT', Backslash: 'BSLH', Semicolon: 'SEMI',
  Quote: 'SQT', Backquote: 'GRAVE', Comma: 'COMMA', Period: 'DOT', Slash: 'FSLH', IntlBackslash: 'NON_US_BSLH',
  ControlLeft: 'LCTRL', ControlRight: 'RCTRL', ShiftLeft: 'LSHFT', ShiftRight: 'RSHFT', AltLeft: 'LALT', AltRight: 'RALT',
  MetaLeft: 'LGUI', MetaRight: 'RGUI', OSLeft: 'LGUI', OSRight: 'RGUI',
  NumLock: 'KP_NUM', NumpadDivide: 'KP_DIVIDE', NumpadMultiply: 'KP_MULTIPLY', NumpadSubtract: 'KP_MINUS', NumpadAdd: 'KP_PLUS',
  NumpadEnter: 'KP_ENTER', NumpadDecimal: 'KP_DOT', NumpadEqual: 'KP_EQUAL',
  AudioVolumeMute: 'C_MUTE', AudioVolumeUp: 'C_VOL_UP', AudioVolumeDown: 'C_VOL_DN', MediaPlayPause: 'C_PP',
  MediaTrackNext: 'C_NEXT', MediaTrackPrevious: 'C_PREV', MediaStop: 'C_STOP',
}

export function keycodeFromDomCode(code: string): string | undefined {
  if (DOM_CODE[code]) return DOM_CODE[code]
  let m = code.match(/^Key([A-Z])$/)
  if (m) return m[1]
  m = code.match(/^Digit(\d)$/)
  if (m) return 'N' + m[1]
  m = code.match(/^Numpad(\d)$/)
  if (m) return 'KP_N' + m[1]
  m = code.match(/^F(\d+)$/)
  if (m) return 'F' + m[1]
  return undefined
}

/** Simple subsequence fuzzy score; higher is better, -1 means no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  if (t === q) return 1000
  if (t.startsWith(q)) return 500 - t.length
  const idx = t.indexOf(q)
  if (idx >= 0) return 300 - idx
  let ti = 0
  let score = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    score += found === ti ? 3 : 1
    ti = found + 1
  }
  return score
}
