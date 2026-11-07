// grimoire graph · data · YAML read through the pinned tree-sitter grammar (spec D9; lib/deps.mjs
// parserFor('yaml')): each document's value, and the line where each member starts, keyed as
// readers/json-lines.mjs keys a JSON text's (pathKey), so an extractor cites a YAML file as it
// cites a JSON one.
//
//   readYaml(parser, text) → [{ value, lines: Map(pathKey → line), line }]   one per document
//   lineAt(lines, path, fallback) → the line of `path`, else of its nearest ancestor that has one
//   tagOf(v) → '!Ref' for a value kept under a tag of its own, else null
// Throws when the text does not parse (with the line of its first error), on an alias to no anchor,
// and past MAX_NODES values (aliases and merges counted at their full size).
//
// Values, by the core schema: mappings → objects (keys as strings, a later duplicate wins; `<<`
// merges a mapping or a list of them, the mapping's own keys first), sequences → arrays, plain
// scalars typed as the grammar types them (null, true / false, integers, floats; the rest strings,
// a multi-line one folded), quoted scalars as strings (escapes and line folding applied), block
// scalars literal (`|`) or folded (`>`) with their chomping (`-` strip, `+` keep, else clip). The
// core tags convert (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`); any other tag (`!Ref X`,
// `!If [a, b, c]`, a verbatim `!<…>`) keeps its value as { [TAG]: '!Ref', value }, never
// interpreted: what it means is the format's business (readers/dynamodb.mjs). Everything is
// plain, JSON-safe data. An alias is the anchored value itself, not a copy, so reading stays linear
// in the text; what aliases and merges stand for is counted against MAX_NODES, so a document that
// expands without bound (a billion laughs) is refused rather than walked; the cap holds across the
// documents of a text, and a node's children are counted against it before they are listed. An
// alias's own members have no line of their own: lineAt gives the alias's.
//
// Bounded: a text past YAML_MAX (512 KB) is refused before it is parsed. CloudFormation takes a
// template body of 51 200 bytes inline and 1 MB from S3, and a YAML file holding table declarations
// is far smaller; at 512 KB the worst cases measured (a flow list of 100 000 numbers, 128 000 aliases)
// read in under a second and under 400 MB, where 8 MB took tens of seconds and gigabytes. Reading also
// stops past a deadline (opts.deadline, a Date.now() value; READ_MS from the call by default). Each is
// an error of its own: the index stores it with the file's hash, so the file is not read again until
// it changes.
// Every scan of a scalar is linear (no regular expression that backtracks on a long run of blanks).
import { pathKey } from './json-lines.mjs'

export const TAG = '\u0000tag'
export const MAX_NODES = 1_000_000
export const YAML_MAX = 512 << 10
export const READ_MS = 10_000
const MAX_DEPTH = 200
export const tagOf = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v[TAG] === 'string' ? v[TAG] : null)

export function lineAt(lines, path, fallback = null) {
  for (let k = path.length; k > 0; k--) { const l = lines.get(pathKey(...path.slice(0, k))); if (l !== undefined) return l }
  return fallback
}

export function readYaml(parser, text, { deadline = Date.now() + READ_MS } = {}) {
  if (text.length > YAML_MAX) throw new Error(`the YAML is larger than ${YAML_MAX >> 10} KB: not read`)
  const budget = { count: 0, ticks: 0, deadline }
  if (Date.now() > deadline) throw late()
  const tree = parser.parse(text)
  try {
    const bad = firstError(tree.rootNode)
    if (bad) throw new Error(`the YAML does not parse at line ${bad.startPosition.row + 1}`)
    const docs = []
    for (const d of kids(tree.rootNode, budget)) {
      if (d.type !== 'document') continue
      const body = kids(d, budget).find((c) => c.type === 'block_node' || c.type === 'flow_node') || null
      const r = new Reader(text, budget)
      docs.push({ value: r.node(body, [], 0), lines: r.lines, line: (body || d).startPosition.row + 1 })
    }
    return docs
  } finally { tree.delete() }
}
const late = () => new Error('the YAML took too long to read: not read')

// a node's named children, counted against the budget before they are listed (namedChildren lists
// them in one call: namedChild(i) in a loop costs a walk each)
function kids(n, budget) {
  const k = n.namedChildCount
  if (budget) { if (budget.count + k > MAX_NODES) throw new Error(`the YAML expands past ${MAX_NODES} values (aliases and merges counted): not read`); if (Date.now() > budget.deadline) throw late() }
  return k ? n.namedChildren : []
}
const lineOf = (n) => n.startPosition.row + 1

function firstError(root) {
  if (!root.hasError) return null
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'ERROR' || n.isMissing) return n
    const cs = n.children
    for (let i = cs.length - 1; i >= 0; i--) { const c = cs[i]; if (c.hasError || c.isMissing) stack.push(c) }
  }
  return root
}

// own enumerable members only, `__proto__` included as a plain key
const put = (o, k, v) => { if (k === '__proto__') Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); else o[k] = v }
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && tagOf(v) === null

class Reader {
  // budget: { count, ticks, deadline }, shared by the documents of one text
  constructor(src, budget) { this.src = src; this.lines = new Map(); this.anchors = new Map(); this.b = budget }
  get count() { return this.b.count }
  grow(n) {
    this.b.count += n
    if (this.b.count > MAX_NODES) throw new Error(`the YAML expands past ${MAX_NODES} values (aliases and merges counted): not read`)
    if ((++this.b.ticks & 1023) === 0 && Date.now() > this.b.deadline) throw late()
  }

  // a block_node or flow_node (or null: an empty value) → its value
  node(n, path, depth) {
    if (!n) return null
    if (depth > MAX_DEPTH) throw new Error(`the YAML nests deeper than ${MAX_DEPTH} levels at line ${lineOf(n)}: not read`)
    let tag = null, anchor = null, body = null
    for (const c of kids(n, this.b)) {
      if (c.type === 'tag') tag = c.text
      else if (c.type === 'anchor') anchor = (kids(c).find((x) => x.type === 'anchor_name') || c).text.replace(/^&/, '')
      else if (c.type !== 'comment') body = c
    }
    const before = this.count
    this.grow(1)
    let v
    if (!body) v = null
    else if (body.type === 'alias') {
      const name = (kids(body).find((x) => x.type === 'alias_name') || body).text.replace(/^\*/, '')
      if (!this.anchors.has(name)) throw new Error(`the YAML aliases *${name} at line ${lineOf(body)}, which no anchor before it names`)
      const a = this.anchors.get(name)
      this.grow(a.size)
      v = a.value
    } else v = this.body(body, path, depth, tag)
    if (tag && !tag.startsWith('!!')) v = { [TAG]: tag, value: v }
    else if (tag) v = core(tag, v, body)
    if (anchor !== null) this.anchors.set(anchor, { value: v, size: this.count - before })
    return v
  }

  body(b, path, depth, tag) {
    switch (b.type) {
      case 'block_mapping': case 'flow_mapping': return this.mapping(b, path, depth)
      case 'block_sequence': case 'flow_sequence': return this.sequence(b, path, depth)
      case 'plain_scalar': return tag === '!!str' ? fold(b.text) : plain(b)
      case 'double_quote_scalar': return doubleQuoted(b.text.slice(1, -1))
      case 'single_quote_scalar': return singleQuoted(b.text.slice(1, -1))
      case 'block_scalar': return blockScalar(b, this.src)
      default: return b.text
    }
  }

  mapping(m, path, depth) {
    const o = {}, merges = []
    for (const p of kids(m, this.b)) {
      if (p.type === 'comment') continue
      let k, v
      if (p.type === 'block_mapping_pair' || p.type === 'flow_pair') {
        k = p.childForFieldName('key'), v = p.childForFieldName('value')
      } else { k = p; v = null } // `{ a }`: a key alone
      const isMerge = k && k.type === 'flow_node' && kids(k).length === 1 && kids(k)[0].type === 'plain_scalar' && kids(k)[0].text === '<<'
      if (isMerge) { merges.push([this.node(v, path, depth + 1), lineOf(p)]); continue }
      const kv = this.node(k, [], depth + 1)
      const key = kv === null ? 'null' : typeof kv === 'object' ? JSON.stringify(kv) : String(kv)
      const at = [...path, key]
      this.lines.set(pathKey(...at), lineOf(k || p))
      put(o, key, this.node(v, at, depth + 1))
    }
    for (const [src, line] of merges) {
      for (const one of Array.isArray(src) ? src : [src]) {
        if (!isMap(one)) continue
        const ks = Object.keys(one)
        this.grow(ks.length)
        for (const key of ks) if (!Object.hasOwn(o, key)) { put(o, key, one[key]); this.lines.set(pathKey(...path, key), line) }
      }
    }
    return o
  }

  sequence(s, path, depth) {
    const out = []
    for (const it of kids(s, this.b)) {
      if (it.type === 'comment') continue
      const at = [...path, out.length]
      this.lines.set(pathKey(...at), lineOf(it))
      if (it.type === 'block_sequence_item') { const n = kids(it).find((c) => c.type === 'block_node' || c.type === 'flow_node') || null; out.push(this.node(n, at, depth + 1)) }
      else if (it.type === 'flow_pair') { const o = {}; const k = this.node(it.childForFieldName('key'), [], depth + 1); put(o, k === null ? 'null' : String(k), this.node(it.childForFieldName('value'), [...at, String(k)], depth + 1)); out.push(o) }
      else out.push(this.node(it, at, depth + 1))
    }
    return out
  }
}

// ── scalars ──
function plain(b) {
  const c = kids(b)[0], t = b.text
  switch (c?.type) {
    case 'null_scalar': return null
    case 'boolean_scalar': return /^t/i.test(t)
    case 'integer_scalar': { const s = t.replace(/^\+/, ''); const n = /^-?0o/i.test(s) ? parseInt(s.replace(/0o/i, ''), 8) : /^-?0x/i.test(s) ? parseInt(s, 16) : Number(s); return Number.isFinite(n) ? n : t }
    case 'float_scalar': { const s = t.toLowerCase(); return /\.inf$/.test(s) ? (s.startsWith('-') ? -Infinity : Infinity) : s === '.nan' ? NaN : Number(t) }
    default: return fold(t)
  }
}

// line folding (plain, quoted): a single break is a space, n breaks are n-1 newlines; the blanks
// around a break go
function fold(t) {
  if (!t.includes('\n')) return t
  const lines = t.split(/\r?\n/).map((l) => l.trim())
  let out = lines[0], empties = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '' && i < lines.length - 1) { empties++; continue }
    out += empties ? '\n'.repeat(empties) : ' '
    out += lines[i]
    empties = 0
  }
  return out
}

const ESC = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ' }
// (built as a list of pieces: a break drops the blanks before it from the list's end, each blank once)
function doubleQuoted(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      const e = s[i + 1]
      if (e === '\n' || e === '\r') { i += e === '\r' && s[i + 2] === '\n' ? 3 : 2; while (s[i] === ' ' || s[i] === '\t') i++; continue } // an escaped break joins the lines
      const hex = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0
      if (hex) { const cp = parseInt(s.slice(i + 2, i + 2 + hex), 16); if (Number.isFinite(cp)) out.push(String.fromCodePoint(cp)); i += 2 + hex; continue }
      out.push(ESC[e] ?? e ?? '')
      i += 2
      continue
    }
    if (c === '\n' || c === '\r') { i = breakAt(s, i, out); continue }
    out.push(c)
    i++
  }
  return out.join('')
}
function singleQuoted(s) {
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'" && s[i + 1] === "'") { out.push("'"); i += 2; continue }
    if (c === '\n' || c === '\r') { i = breakAt(s, i, out); continue }
    out.push(c)
    i++
  }
  return out.join('')
}
// an unescaped line break inside quotes, at s[i]: the blanks before it go, the lines after it that
// are blank count as newlines, the next line's indentation goes. → where reading goes on
function breakAt(s, i, out) {
  while (out.length && (out[out.length - 1] === ' ' || out[out.length - 1] === '\t')) out.pop()
  let breaks = 0
  for (;;) {
    if (s[i] === '\r') i++
    if (s[i] !== '\n') break
    breaks++
    i++
    while (s[i] === ' ' || s[i] === '\t') i++
  }
  out.push(breaks > 1 ? '\n'.repeat(breaks - 1) : ' ')
  return i
}

function blockScalar(b, src) {
  const text = b.text
  const nl = text.indexOf('\n')
  // the header, less a comment (a # after a blank), found by one scan
  const line = nl < 0 ? text : text.slice(0, nl)
  let cut = line.length
  for (let k = 1; k < line.length; k++) if (line[k] === '#' && (line[k - 1] === ' ' || line[k - 1] === '\t')) { cut = k; break }
  const head = line.slice(0, cut).trim()
  const folded = head[0] === '>'
  const chomp = head.includes('-') ? 'strip' : head.includes('+') ? 'keep' : 'clip'
  const digit = /[1-9]/.exec(head)
  const raw = nl < 0 ? [] : text.slice(nl + 1).split(/\r?\n/)
  // the node's own text ends with its last content line; the lines between are its content
  let indent = null
  if (digit) {
    // the line holding the header: its leading blanks are the parent's indentation
    const start = b.startIndex, lineStart = src.lastIndexOf('\n', start - 1) + 1
    indent = /^[ \t]*/.exec(src.slice(lineStart, start))[0].length + Number(digit[0])
  } else {
    const first = raw.find((l) => l.trim() !== '')
    indent = first ? /^ */.exec(first)[0].length : 0
  }
  const lines = raw.map((l) => (l.trim() === '' ? '' : l.slice(indent)))
  let trailing = 0
  while (lines.length && lines[lines.length - 1] === '') { lines.pop(); trailing++ }
  let body
  if (!folded) body = lines.join('\n')
  else {
    body = ''
    let prev = null
    for (const l of lines) {
      const kind = l === '' ? 'empty' : /^[ \t]/.test(l) ? 'more' : 'text'
      if (prev === null) body = l
      else if (kind === 'empty') body += '\n'
      else if (prev === 'text' && kind === 'text') body += ` ${l}`
      else if (prev === 'empty' && kind === 'text') body += l
      else body += `\n${l}`
      prev = kind === 'empty' && prev === 'text' ? 'empty' : kind
    }
  }
  if (!lines.length) return chomp === 'keep' ? '\n'.repeat(trailing) : ''
  return chomp === 'strip' ? body : chomp === 'keep' ? `${body}\n${'\n'.repeat(trailing)}` : `${body}\n`
}

// a core tag (`!!str` and the like) applied to the value it marks
function core(tag, v, body) {
  switch (tag) {
    case '!!str': return v === null ? '' : typeof v === 'object' ? v : String(v)
    case '!!int': case '!!float': { const n = Number(v); return Number.isNaN(n) && body ? body.text : n }
    case '!!bool': return typeof v === 'boolean' ? v : /^t/i.test(String(v))
    case '!!null': return null
    default: return v
  }
}
