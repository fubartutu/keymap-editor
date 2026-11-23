/**
 * A small, comment-preserving parser and printer for the devicetree subset used by
 * ZMK `.keymap` and `.overlay` files.
 *
 * Unlike the original keymap-editor (which only round-tripped a keymap.json through a
 * template), this reads real devicetree source. Property values are kept as raw text and
 * printed back verbatim unless they are edited, so anything the editor does not model
 * (custom properties, preprocessor expressions, macros it does not understand) survives.
 * Every item also records its source span so callers can patch a file in place
 * (see `spliceProperty`) instead of reprinting it.
 */

export interface Span { start: number; end: number }

export interface DtsDirective {
  kind: 'directive'
  text: string
  leading: string[]
  span?: Span
}

export interface DtsProperty {
  kind: 'prop'
  name: string
  /** Raw value text after `=` (without the trailing `;`), or null for a boolean property. */
  raw: string | null
  leading: string[]
  trailing?: string
  /** Span of the raw value in the source (for in-place patching). */
  valueSpan?: Span
  span?: Span
}

export interface DtsNode {
  kind: 'node'
  labels: string[]
  /** Node name: `/`, `&label` for reference overrides, or `name[@unit]`. */
  name: string
  children: DtsItem[]
  leading: string[]
  /** Comments between the last child and the closing brace. */
  tail: string[]
  trailing?: string
  /** True when the node was written on a single line in the source. */
  inline?: boolean
  /** Source text of an inline node, reprinted verbatim while its properties are unchanged. */
  origText?: string
  origSig?: string
  span?: Span
}

/** `/delete-node/ ...;` and similar statements we keep verbatim. */
export interface DtsStatement {
  kind: 'statement'
  text: string
  leading: string[]
  span?: Span
}

export type DtsItem = DtsDirective | DtsProperty | DtsNode | DtsStatement

export interface DtsFile {
  items: DtsItem[]
  /** Comments after the last item. */
  tail: string[]
}

export class DtsParseError extends Error {
  line: number
  col: number
  constructor(message: string, src: string, pos: number) {
    const before = src.slice(0, pos)
    const line = before.split('\n').length
    const col = pos - before.lastIndexOf('\n')
    super(`${message} (line ${line}, column ${col})`)
    this.line = line
    this.col = col
  }
}

function trimBlanks(l: string[]): string[] {
  let a = 0
  let b = l.length
  while (a < b && l[a] === '') a++
  while (b > a && l[b - 1] === '') b--
  return l.slice(a, b)
}

const DIRECTIVES = /^#\s*(include|define|undef|if|ifdef|ifndef|elif|else|endif|pragma|error|warning|line)\b/

export function parseDts(src: string): DtsFile {
  let pos = 0
  const n = src.length

  /** Comments and blank lines collected since the last item. */
  let pending: string[] = []
  /** End position of the last completed item, for same-line trailing comments. */
  let lastItemEnd = -1
  let lastItem: DtsItem | null = null

  const lineOf = (p: number) => {
    let c = 0
    for (let i = 0; i < p; i++) if (src.charCodeAt(i) === 10) c++
    return c
  }

  function sameLine(a: number, b: number): boolean {
    for (let i = a; i < b; i++) if (src.charCodeAt(i) === 10) return false
    return true
  }

  /** Skip whitespace and comments, collecting comments (and blank lines) into `pending`. */
  function skipTrivia() {
    while (pos < n) {
      const ch = src[pos]
      if (ch === '\n') {
        // A blank line (two newlines with only spaces between) is kept as a separator.
        let j = pos + 1
        while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++
        if (src[j] === '\n' && pending[pending.length - 1] !== '') pending.push('')
        pos++
      } else if (ch === ' ' || ch === '\t' || ch === '\r') {
        pos++
      } else if (src.startsWith('//', pos)) {
        const end = src.indexOf('\n', pos)
        const text = src.slice(pos, end === -1 ? n : end).trimEnd()
        attachComment(text, pos)
        pos = end === -1 ? n : end
      } else if (src.startsWith('/*', pos)) {
        const end = src.indexOf('*/', pos + 2)
        if (end === -1) throw new DtsParseError('Unterminated comment', src, pos)
        const text = src.slice(pos, end + 2)
        attachComment(text, pos)
        pos = end + 2
      } else if (ch === '\\' && src[pos + 1] === '\n') {
        pos += 2
      } else {
        break
      }
    }
  }

  function attachComment(text: string, at: number) {
    if (lastItem && lastItemEnd >= 0 && sameLine(lastItemEnd, at) && !text.includes('\n') && !('trailing' in lastItem && lastItem.trailing)) {
      ;(lastItem as DtsProperty | DtsNode).trailing = text
      return
    }
    pending.push(text)
  }

  function takeLeading(): string[] {
    const l = pending
    pending = []
    return l
  }

  function readWord(): string {
    const start = pos
    if (src[pos] === '&' && src[pos + 1] === '{') {
      const end = src.indexOf('}', pos)
      if (end === -1) throw new DtsParseError('Unterminated path reference', src, pos)
      pos = end + 1
      return src.slice(start, pos)
    }
    if (src[pos] === '&') pos++
    while (pos < n && /[A-Za-z0-9,._+\-#@?]/.test(src[pos])) pos++
    return src.slice(start, pos)
  }

  /** Read a raw property value up to the terminating `;` at depth 0. */
  function readValue(): { raw: string; span: Span } {
    const start = pos
    let depth = 0
    while (pos < n) {
      const ch = src[pos]
      if (ch === '"') {
        pos++
        while (pos < n && src[pos] !== '"') {
          if (src[pos] === '\\') pos++
          pos++
        }
        pos++
        continue
      }
      if (src.startsWith('//', pos)) {
        const end = src.indexOf('\n', pos)
        pos = end === -1 ? n : end
        continue
      }
      if (src.startsWith('/*', pos)) {
        const end = src.indexOf('*/', pos + 2)
        pos = end === -1 ? n : end + 2
        continue
      }
      if (ch === '<' || ch === '(' || ch === '[') depth++
      else if (ch === '>' || ch === ')' || ch === ']') depth--
      else if (ch === ';' && depth <= 0) break
      pos++
    }
    if (pos >= n) throw new DtsParseError('Missing ";" after property value', src, start)
    let end = pos
    let s = start
    while (s < end && /\s/.test(src[s])) s++
    while (end > s && /\s/.test(src[end - 1])) end--
    return { raw: src.slice(s, end), span: { start: s, end } }
  }

  function expect(ch: string) {
    skipTrivia()
    if (src[pos] !== ch) throw new DtsParseError(`Expected "${ch}" but found "${src[pos] ?? 'end of file'}"`, src, pos)
    pos++
  }

  function parseItems(inNode: boolean): { items: DtsItem[]; tail: string[] } {
    const items: DtsItem[] = []
    for (;;) {
      skipTrivia()
      if (pos >= n) {
        if (inNode) throw new DtsParseError('Unexpected end of file: missing "};"', src, pos)
        break
      }
      if (src[pos] === '}') {
        if (!inNode) throw new DtsParseError('Unexpected "}"', src, pos)
        break
      }
      const itemStart = pos
      const leading = takeLeading()

      // Preprocessor directive (only at the start of a line).
      const lineStart = src.lastIndexOf('\n', pos - 1) + 1
      if (src[pos] === '#' && /^\s*$/.test(src.slice(lineStart, pos)) && DIRECTIVES.test(src.slice(pos, pos + 20))) {
        let end = pos
        for (;;) {
          const nl = src.indexOf('\n', end)
          if (nl === -1) { end = n; break }
          const lineText = src.slice(end, nl).replace(/\r$/, '')
          if (lineText.endsWith('\\')) { end = nl + 1; continue }
          end = nl
          break
        }
        const item: DtsDirective = { kind: 'directive', text: src.slice(pos, end).replace(/\s+$/, ''), leading, span: { start: pos, end } }
        items.push(item)
        pos = end
        lastItem = null
        lastItemEnd = -1
        continue
      }

      if (src.startsWith('/delete-', pos) || src.startsWith('/omit-if-no-ref/', pos) || src.startsWith('/dts-v1/', pos) || src.startsWith('/plugin/', pos)) {
        const end = src.indexOf(';', pos)
        if (end === -1) throw new DtsParseError('Missing ";"', src, pos)
        const item: DtsStatement = { kind: 'statement', text: src.slice(pos, end + 1), leading, span: { start: pos, end: end + 1 } }
        items.push(item)
        pos = end + 1
        lastItem = item
        lastItemEnd = pos
        continue
      }

      // Labels, then a node or property name.
      const labels: string[] = []
      let name = ''
      for (;;) {
        skipTrivia()
        if (src[pos] === '/' && /[\s{]/.test(src[pos + 1] ?? '')) { name = '/'; pos++; break }
        const word = readWord()
        if (!word) throw new DtsParseError(`Unexpected character "${src[pos]}"`, src, pos)
        skipTrivia()
        if (src[pos] === ':' ) {
          labels.push(word)
          pos++
          continue
        }
        name = word
        break
      }
      skipTrivia()
      if (src[pos] === '{') {
        const openLine = lineOf(pos)
        pos++
        lastItem = null
        lastItemEnd = -1
        const body = parseItems(true)
        // Keep a blank line before the closing brace if there was one.
        const tailComments = takeLeading()
        expect('}')
        const closeLine = lineOf(pos)
        expect(';')
        const node: DtsNode = { kind: 'node', labels, name, children: body.items, leading, tail: tailComments, span: { start: itemStart, end: pos } }
        if (openLine === closeLine) {
          node.inline = true
          node.origText = src.slice(itemStart, pos)
          node.origSig = inlineSig(node)
        }
        items.push(node)
        lastItem = node
        lastItemEnd = pos
      } else if (src[pos] === '=') {
        pos++
        skipTrivia()
        const { raw, span } = readValue()
        pos++ // ;
        const prop: DtsProperty = { kind: 'prop', name, raw, leading, valueSpan: span, span: { start: itemStart, end: pos } }
        items.push(prop)
        lastItem = prop
        lastItemEnd = pos
      } else if (src[pos] === ';') {
        pos++
        const prop: DtsProperty = { kind: 'prop', name, raw: null, leading, span: { start: itemStart, end: pos } }
        items.push(prop)
        lastItem = prop
        lastItemEnd = pos
      } else if (labels.length === 0 && /^[A-Z_][A-Z0-9_]*$/.test(name)) {
        // A bare preprocessor macro invocation (e.g. Miryoku's MIRYOKU_LAYER_LIST), optionally
        // with arguments. We cannot model what it expands to, so keep it verbatim.
        let end = pos
        if (src[pos] === '(') {
          let depth = 0
          for (; end < n; end++) {
            if (src[end] === '(') depth++
            else if (src[end] === ')' && --depth === 0) { end++; break }
          }
        }
        if (src[end] === ';') end++
        const item: DtsStatement = { kind: 'statement', text: src.slice(itemStart, end).trim(), leading, span: { start: itemStart, end } }
        items.push(item)
        pos = end
        lastItem = item
        lastItemEnd = pos
      } else {
        throw new DtsParseError(`Expected "{", "=" or ";" after "${name}"`, src, pos)
      }
    }
    return { items, tail: [] }
  }

  const { items } = parseItems(false)
  const tail = trimBlanks(takeLeading())
  return { items, tail }
}

// ---------------------------------------------------------------------------
// Printing

const INDENT = '    '

function printComments(lines: string[], indent: string, out: string[]) {
  for (const c of lines) {
    if (c === '') { out.push(''); continue }
    // Re-indent multi-line block comments relative to their first line.
    const parts = c.split('\n')
    const firstIndent = parts.length > 1 ? Math.min(...parts.slice(1).filter((p) => p.trim()).map((p) => p.match(/^\s*/)![0].length)) : 0
    out.push(indent + parts[0])
    for (const p of parts.slice(1)) out.push(indent + (p.trim() ? ' ' + p.slice(Math.max(0, firstIndent - 1)).replace(/^\s?/, '') : ''))
  }
}

function printProp(p: DtsProperty, indent: string): string {
  const trailing = p.trailing ? ' ' + p.trailing : ''
  if (p.raw === null) return `${indent}${p.name};${trailing}`
  return `${indent}${p.name} = ${p.raw};${trailing}`
}

export function inlineSig(node: DtsNode): string {
  return node.labels.join(',') + '|' + node.name + '|' + node.children.map((c) => (c.kind === 'prop' ? `${c.name}=${c.raw}` : '?')).join(';')
}

function canInline(node: DtsNode): boolean {
  return !!node.inline && node.tail.length === 0 && node.children.every((c) => c.kind === 'prop' && c.leading.length === 0 && !c.trailing && !(c.raw ?? '').includes('\n'))
}

function printNode(node: DtsNode, depth: number, out: string[]) {
  const indent = INDENT.repeat(depth)
  printComments(node.leading, indent, out)
  const head = `${node.labels.map((l) => l + ': ').join('')}${node.name}`
  const trailing = node.trailing ? ' ' + node.trailing : ''
  if (canInline(node) && node.origText && node.origSig === inlineSig(node) && !node.leading.length) {
    out.push(`${indent}${node.origText}${trailing}`)
    return
  }
  if (canInline(node)) {
    const body = node.children.map((c) => printProp(c as DtsProperty, '')).join(' ')
    out.push(`${indent}${head} { ${body} };${trailing}`)
    return
  }
  out.push(`${indent}${head} {`)
  printItems(node.children, depth + 1, out)
  printComments(node.tail, indent + INDENT, out)
  out.push(`${indent}};${trailing}`)
}

function printItems(items: DtsItem[], depth: number, out: string[]) {
  const indent = INDENT.repeat(depth)
  for (const item of items) {
    switch (item.kind) {
      case 'directive':
        printComments(item.leading, indent, out)
        out.push(item.text)
        break
      case 'statement':
        printComments(item.leading, indent, out)
        out.push(indent + item.text)
        break
      case 'prop':
        printComments(item.leading, indent, out)
        out.push(printProp(item, indent))
        break
      case 'node':
        printNode(item, depth, out)
        break
    }
  }
}

export function printDts(file: DtsFile): string {
  const out: string[] = []
  printItems(file.items, 0, out)
  printComments(file.tail, '', out)
  // Collapse runs of blank lines.
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
  return text + '\n'
}

// ---------------------------------------------------------------------------
// Tree helpers

export function nodes(items: DtsItem[]): DtsNode[] {
  return items.filter((i): i is DtsNode => i.kind === 'node')
}

export function props(items: DtsItem[]): DtsProperty[] {
  return items.filter((i): i is DtsProperty => i.kind === 'prop')
}

export function getProp(node: DtsNode, name: string): DtsProperty | undefined {
  return props(node.children).find((p) => p.name === name)
}

export function getRaw(node: DtsNode, name: string): string | null | undefined {
  const p = getProp(node, name)
  return p ? p.raw : undefined
}

/** Set (or add) a property's raw value. `null` makes it a boolean property; `undefined` removes it. */
export function setProp(node: DtsNode, name: string, raw: string | null | undefined) {
  const idx = node.children.findIndex((c) => c.kind === 'prop' && c.name === name)
  if (raw === undefined) {
    if (idx >= 0) node.children.splice(idx, 1)
    return
  }
  if (idx >= 0) {
    const p = node.children[idx] as DtsProperty
    if (p.raw !== raw) {
      p.raw = raw
      delete p.valueSpan
    }
    return
  }
  // New properties go after the last existing property (before child nodes).
  let insertAt = 0
  node.children.forEach((c, i) => { if (c.kind === 'prop') insertAt = i + 1 })
  node.children.splice(insertAt, 0, { kind: 'prop', name, raw, leading: [] })
}

export function parseString(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined
  const m = raw.match(/^"((?:[^"\\]|\\.)*)"$/)
  return m ? m[1].replace(/\\(.)/g, '$1') : undefined
}

export function quote(s: string): string {
  return `"${s.replace(/["\\]/g, (c) => '\\' + c)}"`
}

/** Parse `<1 2 3>` into its cell tokens (parenthesised expressions kept whole). */
export function parseCells(raw: string | null | undefined): string[] {
  if (raw == null) return []
  const groups = splitCellGroups(raw)
  return groups.flatMap(tokenizeCells)
}

/** Split `<a b>, <c d>` into the inner text of each `<...>` group. Comments are dropped. */
export function splitCellGroups(raw: string): string[] {
  const text = stripComments(raw)
  const groups: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '<' && depth === 0 && start === -1) start = i + 1
    else if (ch === '>' && depth === 0 && start !== -1) {
      groups.push(text.slice(start, i))
      start = -1
    }
  }
  return groups
}

export function tokenizeCells(inner: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of inner) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) tokens.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur) tokens.push(cur)
  return tokens
}

export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

export function formatCells(cells: (string | number)[]): string {
  return `<${cells.join(' ')}>`
}

/** Depth-first walk over all nodes, with their ancestor chain. */
export function walkNodes(items: DtsItem[], fn: (node: DtsNode, parents: DtsNode[]) => void, parents: DtsNode[] = []) {
  for (const node of nodes(items)) {
    fn(node, parents)
    walkNodes(node.children, fn, [...parents, node])
  }
}

/**
 * Replace one property value in the original source text without reprinting the file.
 * Used for files the editor only touches lightly (board overlays, .conf files) so diffs stay minimal.
 */
export function spliceProperty(src: string, prop: DtsProperty, raw: string): string {
  if (!prop.valueSpan) throw new Error(`Property ${prop.name} has no source span`)
  return src.slice(0, prop.valueSpan.start) + raw + src.slice(prop.valueSpan.end)
}
