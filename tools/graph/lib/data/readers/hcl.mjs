// grimoire graph · data · HCL read by hand (spec D9: no vendored grammar), for Terraform (.tf,
// .tfvars) and Terragrunt (.hcl): the declarative subset, into a small syntax tree an evaluator
// (readers/hcl-eval.mjs) walks. Nothing here evaluates anything.
//
//   parseHcl(text, { deadline }) → { body, text }
//   body   { t: 'body', items: [Attr | Block] }   in file order
//   Attr   { t: 'attr', name, expr, line, end }    `name = expr`
//   Block  { t: 'block', type, labels: [string], body, line, end }   `type "label" … { body }`
//   expressions, each { t, line, s, e } (s, e: its span in the text):
//     lit    { v }  a string with no interpolation, a number, true, false or null
//     tpl    { parts: [string | { t: 'interp', x } | { t: 'if', cond, then, else } |
//            { t: 'for', k, v, coll, body }], single }  a string or a heredoc with `${…}` or
//            `%{…}`; `single` when it is one interpolation alone (its value is the value, as is)
//     tuple  { items }           [a, b]
//     object { items: [{ key, value, line }] }   { a = 1, "b" = 2, (k) = 3 }; a bare name as a key is
//            that name as a string (a lit)
//     var    { name }            a name: var, local, each, include, dependency, an iterator…
//     get    { x, name }         x.name (and the legacy x.0, as an index)
//     index  { x, key }          x[key]
//     splat  { x, ops: [{ name } | { key }] }   x[*].a, x.*.a
//     call   { name, args, expand }   f(a, b…)
//     not, neg { x } · bin { op, l, r } · cond { c, a, b } · paren { x }
//     for    { kind: tuple | object, k, v, coll, key, value, group, cond }
//   comments (#, //, /* */) are blanks. Heredocs `<<EOF` and `<<-EOF` (indented: the common leading
//   blanks of its lines dropped), strings with their escapes (\n \t \" \\ \uXXXX \UXXXXXXXX, $${ and
//   %%{ for a literal ${ and %{), `~` strip markers.
//
// Bounded, as the other readers are: a text past HCL_MAX (1 MB) is refused before it is read; one
// pass, never a regular expression that backtracks; a nesting past MAX_DEPTH (blocks, brackets,
// interpolations, all counted) is refused, so a hostile file cannot exhaust the stack; reading stops
// past a deadline. Each is an HclError with the line where it stopped: the caller (the extractor)
// catches it and says which file did not parse, and goes on with the others.

export const HCL_MAX = 1 << 20
export const MAX_DEPTH = 64
export const READ_MS = 10_000

export class HclError extends Error {
  constructor(message, line = null) { super(line ? `${message} at line ${line}` : message); this.line = line }
}

const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
const isId = (c) => isIdStart(c) || (c >= '0' && c <= '9') || c === '-'
const isDigit = (c) => c >= '0' && c <= '9'
const BLANK = new Set([' ', '\t', '\r', '\f', '\v', ' ', '﻿'])

export function parseHcl(text, { deadline = Date.now() + READ_MS } = {}) {
  if (typeof text !== 'string') throw new HclError('not a text')
  if (text.length > HCL_MAX) throw new HclError(`the HCL is larger than ${HCL_MAX >> 10} KB: not read`)
  if (text.charCodeAt(0) === 0xfeff) text = ` ${text.slice(1)}` // a byte order mark: a blank (offsets and lines kept)
  const p = new Reader(text, deadline)
  const body = p.body(false)
  return { body, text }
}

// The line of each offset: one pass for the line starts, then a binary search.
function lineStarts(text) {
  const out = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1)
  return out
}

class Reader {
  constructor(text, deadline) {
    this.t = text; this.n = text.length; this.i = 0
    this.depth = 0; this.ticks = 0; this.deadline = deadline
    this.starts = lineStarts(text)
    this.nls = [false] // does a new line end what is being read here (false), or is it a blank (true)?
  }
  line(i = this.i) {
    let lo = 0, hi = this.starts.length - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.starts[m] <= i) lo = m; else hi = m - 1 }
    return lo + 1
  }
  err(message, i = this.i) { throw new HclError(message, this.line(Math.min(i, this.n))) }
  tick() { if ((++this.ticks & 1023) === 0 && Date.now() > this.deadline) throw new HclError('the HCL took too long to read: not read') }
  enter(at = this.i) { if (++this.depth > MAX_DEPTH) this.err(`it nests deeper than ${MAX_DEPTH} levels`, at); this.tick() }
  leave() { this.depth-- }
  get nl() { return this.nls[this.nls.length - 1] }
  node(t, s, extra) { return { t, line: this.line(s), s, e: this.i, ...extra } }

  // blanks and comments; new lines too when nl
  ws(nl = this.nl) {
    const t = this.t
    while (this.i < this.n) {
      const c = t[this.i]
      if (BLANK.has(c)) { this.i++; continue }
      if (c === '\n') { if (!nl) return; this.i++; continue }
      if (c === '#' || (c === '/' && t[this.i + 1] === '/')) { const j = t.indexOf('\n', this.i); this.i = j < 0 ? this.n : j; continue }
      if (c === '/' && t[this.i + 1] === '*') {
        const j = t.indexOf('*/', this.i + 2)
        if (j < 0) this.err('an unterminated /* comment')
        this.i = j + 2
        continue
      }
      return
    }
  }
  peek() { return this.t[this.i] }
  eat(c) { if (this.t[this.i] !== c) this.err(`expected ${c}`); this.i++ }
  ident() {
    if (!isIdStart(this.t[this.i] || '')) return null
    const s = this.i
    while (this.i < this.n && isId(this.t[this.i])) this.i++
    return this.t.slice(s, this.i)
  }
  // a keyword here (`for`, `in`, `if`…): the word, then no identifier character
  word(w) {
    if (this.t.startsWith(w, this.i) && !isId(this.t[this.i + w.length] || '')) { this.i += w.length; return true }
    return false
  }

  // ── bodies: attributes and blocks, each ended by a new line ──
  body(inBlock) {
    const items = []
    for (;;) {
      this.ws(true)
      this.tick()
      if (this.i >= this.n) { if (inBlock) this.err('an unterminated block: no closing }'); break }
      const c = this.t[this.i]
      if (c === '}') { if (inBlock) break; this.err('an unexpected }') }
      const s = this.i, line = this.line()
      const name = this.ident()
      if (name === null) this.err('expected an attribute or a block')
      this.ws(false)
      if (this.t[this.i] === '=' && this.t[this.i + 1] !== '=') {
        this.i++
        this.ws(false)
        this.nls.push(false)
        const expr = this.expr()
        this.nls.pop()
        items.push({ t: 'attr', name, expr, line, end: this.line(this.i) })
      } else {
        const labels = []
        while (this.t[this.i] === '"' || isIdStart(this.t[this.i] || '')) {
          if (this.t[this.i] === '"') {
            const x = this.quoted()
            if (x.t !== 'lit') this.err('a block label is a plain string', x.s)
            labels.push(x.v)
          } else labels.push(this.ident())
          this.ws(false)
        }
        if (this.t[this.i] !== '{') this.err(`expected = or { after ${name}`)
        this.i++
        this.enter(s)
        this.nls.push(true)
        const b = this.body(true)
        this.nls.pop()
        this.leave()
        this.eat('}')
        items.push({ t: 'block', type: name, labels, body: b, line, end: this.line(this.i - 1) })
      }
      // an item ends at a new line (or the block's closing brace on the same line)
      this.ws(false)
      if (this.i < this.n && this.t[this.i] !== '\n' && !(inBlock && this.t[this.i] === '}')) this.err('expected a new line after an attribute or a block')
    }
    return { t: 'body', items }
  }

  // ── expressions ──
  expr() {
    this.enter()
    try { return this.cond() } finally { this.leave() }
  }
  cond() {
    const s = this.i
    const c = this.binary(0)
    this.ws()
    if (this.t[this.i] !== '?') return c
    this.i++; this.ws(true)
    const a = this.expr()
    this.ws(true); this.eat(':'); this.ws(true)
    const b = this.expr()
    return this.node('cond', s, { c, a, b })
  }
  binary(level) {
    if (level === OPS.length) return this.unary()
    const s = this.i
    let l = this.binary(level + 1)
    for (;;) {
      this.ws()
      const op = OPS[level].find((o) => this.t.startsWith(o, this.i))
      if (!op) return l
      this.i += op.length
      this.ws(true)
      this.enter()
      const r = this.binary(level + 1)
      this.leave()
      l = this.node('bin', s, { op, l, r })
    }
  }
  unary() {
    const s = this.i
    const c = this.t[this.i]
    if (c === '!' || c === '-') {
      this.i++; this.ws()
      this.enter()
      const x = this.unary()
      this.leave()
      return this.node(c === '!' ? 'not' : 'neg', s, { x })
    }
    return this.postfix()
  }
  postfix() {
    const s = this.i
    let x = this.primary()
    for (;;) {
      this.tick()
      const c = this.t[this.i]
      if (c === '.' && this.t[this.i + 1] === '*') { this.i += 2; x = this.node('splat', s, { x, ops: this.splatOps(false) }); continue }
      if (c === '[' && this.t.startsWith('[*]', this.i)) { this.i += 3; x = this.node('splat', s, { x, ops: this.splatOps(true) }); continue }
      if (c === '.' && isDigit(this.t[this.i + 1] || '')) { // the legacy index: x.0
        this.i++
        const ks = this.i
        while (isDigit(this.t[this.i] || '')) this.i++
        x = this.node('index', s, { x, key: { t: 'lit', v: Number(this.t.slice(ks, this.i)), line: this.line(ks), s: ks, e: this.i } })
        continue
      }
      if (c === '.' && isIdStart(this.t[this.i + 1] || '')) { this.i++; const name = this.ident(); x = this.node('get', s, { x, name }); continue }
      if (c === '[') {
        this.i++
        this.nls.push(true); this.ws()
        const key = this.expr()
        this.ws(); this.eat(']'); this.nls.pop()
        x = this.node('index', s, { x, key })
        continue
      }
      return x
    }
  }
  // what a splat applies to each element: .a.b and, for a full splat, [i] too
  splatOps(full) {
    const ops = []
    for (;;) {
      const c = this.t[this.i]
      if (c === '.' && isIdStart(this.t[this.i + 1] || '')) { this.i++; ops.push({ name: this.ident() }); continue }
      if (full && c === '[' && this.t[this.i + 1] !== '*') {
        this.i++; this.nls.push(true); this.ws()
        const key = this.expr()
        this.ws(); this.eat(']'); this.nls.pop()
        ops.push({ key })
        continue
      }
      return ops
    }
  }
  primary() {
    const s = this.i
    const c = this.t[this.i]
    if (c === undefined) this.err('an expression is missing')
    if (isDigit(c)) return this.number()
    if (c === '"') return this.quoted()
    if (c === '<' && this.t[this.i + 1] === '<') return this.heredoc()
    if (c === '(') {
      this.i++
      this.nls.push(true); this.ws()
      const x = this.expr()
      this.ws(); this.eat(')'); this.nls.pop()
      return this.node('paren', s, { x })
    }
    if (c === '[') {
      this.i++
      this.enter(s)
      this.nls.push(true); this.ws()
      let out
      if (this.isFor()) out = this.forExpr(s, ']')
      else {
        const items = []
        while (this.t[this.i] !== ']') {
          items.push(this.expr())
          this.ws()
          if (this.t[this.i] === ',') { this.i++; this.ws(); continue }
          if (this.t[this.i] !== ']') this.err('expected , or ] in a list')
        }
        this.i++
        out = this.node('tuple', s, { items })
      }
      this.nls.pop(); this.leave()
      return out
    }
    if (c === '{') {
      this.i++
      this.enter(s)
      this.nls.push(true); this.ws()
      let out
      if (this.isFor()) { out = this.forExpr(s, '}'); this.nls.pop() } else { this.nls.pop(); out = this.object(s) }
      this.leave()
      return out
    }
    if (isIdStart(c)) {
      let name = this.ident()
      while (this.t.startsWith('::', this.i) && isIdStart(this.t[this.i + 2] || '')) { this.i += 2; name += `::${this.ident()}` } // provider::ns::fn
      if (this.t[this.i] === '(') return this.call(s, name)
      if (name === 'true' || name === 'false') return this.node('lit', s, { v: name === 'true' })
      if (name === 'null') return this.node('lit', s, { v: null })
      return this.node('var', s, { name })
    }
    this.err(`an unexpected ${JSON.stringify(c)}`)
  }
  number() {
    const s = this.i, t = this.t
    while (isDigit(t[this.i] || '')) this.i++
    if (t[this.i] === '.' && isDigit(t[this.i + 1] || '')) { this.i++; while (isDigit(t[this.i] || '')) this.i++ }
    if (t[this.i] === 'e' || t[this.i] === 'E') {
      let j = this.i + 1
      if (t[j] === '+' || t[j] === '-') j++
      if (isDigit(t[j] || '')) { this.i = j; while (isDigit(t[this.i] || '')) this.i++ }
    }
    return this.node('lit', s, { v: Number(t.slice(s, this.i)) })
  }
  call(s, name) {
    this.i++ // (
    this.enter(s)
    this.nls.push(true); this.ws()
    const args = []
    let expand = false
    while (this.t[this.i] !== ')') {
      args.push(this.expr())
      this.ws()
      if (this.t.startsWith('...', this.i)) { this.i += 3; expand = true; this.ws() }
      if (this.t[this.i] === ',') { this.i++; this.ws(); continue }
      if (this.t[this.i] !== ')') this.err(`expected , or ) in the arguments of ${name}()`)
    }
    this.i++
    this.nls.pop(); this.leave()
    return this.node('call', s, { name, args, expand })
  }
  isFor() {
    if (!this.t.startsWith('for', this.i) || isId(this.t[this.i + 3] || '')) return false
    let j = this.i + 3
    while (j < this.n && (BLANK.has(this.t[j]) || this.t[j] === '\n')) j++
    return isIdStart(this.t[j] || '') // `for x in …`, not a key named for
  }
  forExpr(s, close) {
    this.word('for'); this.ws()
    let k = null, v = this.ident()
    if (v === null) this.err('expected a name after for')
    this.ws()
    if (this.t[this.i] === ',') { this.i++; this.ws(); k = v; v = this.ident(); if (v === null) this.err('expected a second name after for'); this.ws() }
    if (!this.word('in')) this.err('expected in')
    this.ws()
    const coll = this.expr()
    this.ws(); this.eat(':'); this.ws()
    let key = null, value, group = false, cond = null
    if (close === '}') {
      key = this.expr()
      this.ws()
      if (!this.t.startsWith('=>', this.i)) this.err('expected => in a for expression that builds an object')
      this.i += 2; this.ws()
    }
    value = this.expr()
    this.ws()
    if (close === '}' && this.t.startsWith('...', this.i)) { this.i += 3; group = true; this.ws() }
    if (this.word('if')) { this.ws(); cond = this.expr(); this.ws() }
    this.eat(close)
    return this.node('for', s, { kind: close === ']' ? 'tuple' : 'object', k, v, coll, key, value, group, cond })
  }
  // an object: items separated by commas or new lines, a key = (or :) its value
  object(s) {
    const items = []
    this.nls.push(false)
    for (;;) {
      this.ws(true)
      this.tick()
      if (this.t[this.i] === '}') { this.i++; break }
      if (this.i >= this.n) this.err('an unterminated object: no closing }', s)
      const ks = this.i, line = this.line()
      let key = null
      if (isIdStart(this.t[this.i])) {
        const name = this.ident()
        const save = this.i
        this.ws(false)
        const c = this.t[this.i]
        if ((c === '=' && this.t[this.i + 1] !== '=') || c === ':') key = { t: 'lit', v: name, line, s: ks, e: save }
        else this.i = ks
      }
      if (!key) { this.nls.push(true); key = this.binary(0); this.nls.pop() }
      this.ws(false)
      const c = this.t[this.i]
      if ((c === '=' && this.t[this.i + 1] !== '=') || c === ':') this.i++
      else this.err('expected = or : after an object key')
      this.ws(false)
      const value = this.expr()
      items.push({ key, value, line })
      this.ws(false)
      if (this.t[this.i] === ',') { this.i++; continue }
      if (this.t[this.i] === '\n' || this.t[this.i] === '}') continue
      this.err('expected , or a new line between the items of an object')
    }
    this.nls.pop()
    return this.node('object', s, { items })
  }

  // ── templates ──
  quoted() {
    const s = this.i
    this.i++ // "
    const parts = this.template({ quoted: true, end: this.n, start: s })
    return this.tplNode(s, parts)
  }
  heredoc() {
    const s = this.i
    this.i += 2
    const indent = this.t[this.i] === '-'
    if (indent) this.i++
    const delim = this.ident()
    if (delim === null) this.err('expected a heredoc delimiter after <<')
    let j = this.i
    while (j < this.n && (this.t[j] === ' ' || this.t[j] === '\t' || this.t[j] === '\r')) j++
    if (this.t[j] !== '\n') this.err('expected a new line after the heredoc delimiter')
    const start = j + 1
    // its end: the first line holding the delimiter alone (blanks around it allowed)
    let end = -1, after = -1
    for (let ls = start; ls <= this.n;) {
      this.tick()
      const nl = this.t.indexOf('\n', ls)
      const le = nl < 0 ? this.n : nl
      let a = ls, b = le
      while (a < b && (this.t[a] === ' ' || this.t[a] === '\t')) a++
      while (b > a && (this.t[b - 1] === ' ' || this.t[b - 1] === '\t' || this.t[b - 1] === '\r')) b--
      if (b - a === delim.length && this.t.startsWith(delim, a)) { end = ls; after = le; break }
      if (nl < 0) break
      ls = nl + 1
    }
    if (end < 0) this.err(`an unterminated heredoc: no line closes <<${indent ? '-' : ''}${delim}`, s)
    let dedent = 0
    if (indent) {
      dedent = Infinity
      for (let ls = start; ls < end;) {
        const nl = this.t.indexOf('\n', ls)
        const le = nl < 0 || nl > end ? end : nl
        let a = ls
        while (a < le && (this.t[a] === ' ' || this.t[a] === '\t')) a++
        if (a < le && this.t[a] !== '\r') dedent = Math.min(dedent, a - ls)
        ls = le + 1
      }
      if (dedent === Infinity) dedent = 0
    }
    this.i = start
    this.nls.push(true)
    const parts = this.template({ quoted: false, end, start, dedent })
    this.nls.pop()
    this.i = after
    return this.tplNode(s, parts, { heredoc: true })
  }
  tplNode(s, parts, extra = {}) {
    if (parts.length === 0) return this.node('lit', s, { v: '', ...extra })
    if (parts.length === 1 && typeof parts[0] === 'string') return this.node('lit', s, { v: parts[0], ...extra })
    return this.node('tpl', s, { parts, single: parts.length === 1 && parts[0].t === 'interp', ...extra })
  }
  // A template's parts up to its end (a closing quote, or the heredoc's end). Directives nest: a
  // frame per open %{ if } or %{ for }.
  template({ quoted, end, start, dedent = 0 }) {
    const t = this.t
    const root = { parts: [] }
    const frames = [root]
    let cur = root.parts
    let buf = '', strip = false, dedented = -1
    const push = (str) => {
      if (strip) { let k = 0; while (k < str.length && (str[k] === ' ' || str[k] === '\t' || str[k] === '\n' || str[k] === '\r')) k++; str = str.slice(k); if (str) strip = false }
      buf += str
    }
    const flush = () => { if (buf) { cur.push(buf); buf = '' } }
    const lstrip = () => { let k = buf.length; while (k > 0 && (buf[k - 1] === ' ' || buf[k - 1] === '\t' || buf[k - 1] === '\n' || buf[k - 1] === '\r')) k--; buf = buf.slice(0, k) }
    const open = () => {
      // after ${ or %{: an optional ~, blanks
      if (t[this.i] === '~') { this.i++; lstrip() }
      flush()
      this.ws(true)
    }
    const close = () => {
      this.ws(true)
      if (t[this.i] === '~') { this.i++; strip = true }
      this.eat('}')
    }
    for (;;) {
      this.tick()
      if (this.i >= end) {
        if (quoted) this.err('an unterminated string', start)
        break
      }
      // a heredoc's indented form: the common leading blanks of each line dropped
      if (dedent && this.i !== dedented && (this.i === start || t[this.i - 1] === '\n')) { dedented = this.i; let k = 0; while (k < dedent && (t[this.i] === ' ' || t[this.i] === '\t')) { this.i++; k++ } continue }
      const c = t[this.i]
      if (quoted && c === '"') { this.i++; break }
      if (quoted && c === '\n') this.err('an unterminated string: a quoted string ends on its own line', start)
      if (quoted && c === '\\') { push(this.escape()); continue }
      if ((c === '$' || c === '%') && t[this.i + 1] === c && t[this.i + 2] === '{') { push(`${c}{`); this.i += 3; continue }
      if (c === '$' && t[this.i + 1] === '{') {
        const s = this.i
        this.i += 2
        this.enter(s)
        open()
        this.nls.push(true)
        const x = this.expr()
        this.nls.pop()
        close()
        this.leave()
        cur.push({ t: 'interp', x, line: this.line(s) })
        continue
      }
      if (c === '%' && t[this.i + 1] === '{') {
        const s = this.i
        this.i += 2
        open()
        const kw = this.ident()
        this.ws(true)
        if (kw === 'if') {
          this.enter(s)
          this.nls.push(true); const cond = this.expr(); this.nls.pop()
          close()
          const d = { t: 'if', cond, then: [], else: null, line: this.line(s) }
          cur.push(d); frames.push({ d, kind: 'if' }); cur = d.then
        } else if (kw === 'else') {
          close()
          const f = frames[frames.length - 1]
          if (f.kind !== 'if' || f.d.else) this.err('an %{ else } with no %{ if }', s)
          flush(); f.d.else = []; cur = f.d.else
        } else if (kw === 'endif' || kw === 'endfor') {
          close()
          const f = frames[frames.length - 1]
          if (f.kind !== (kw === 'endif' ? 'if' : 'for')) this.err(`an %{ ${kw} } with nothing to close`, s)
          flush(); frames.pop(); this.leave()
          const top = frames[frames.length - 1]
          cur = top.kind === 'if' ? (top.d.else || top.d.then) : top.kind === 'for' ? top.d.body : root.parts
        } else if (kw === 'for') {
          this.enter(s)
          let k = null, v = this.ident()
          this.ws(true)
          if (t[this.i] === ',') { this.i++; this.ws(true); k = v; v = this.ident(); this.ws(true) }
          if (v === null || !this.word('in')) this.err('expected %{ for name in … }', s)
          this.ws(true)
          this.nls.push(true); const coll = this.expr(); this.nls.pop()
          close()
          const d = { t: 'for', k, v, coll, body: [], line: this.line(s) }
          cur.push(d); frames.push({ d, kind: 'for' }); cur = d.body
        } else this.err(`an unknown template directive %{ ${kw || ''} }`, s)
        continue
      }
      // a run of plain characters
      let j = this.i + 1
      while (j < end && t[j] !== '$' && t[j] !== '%' && t[j] !== '\n' && !(quoted && (t[j] === '"' || t[j] === '\\'))) j++
      if (t[j] === '\n' && !quoted) j++ // a heredoc keeps its new lines; the next line may dedent
      push(t.slice(this.i, j))
      this.i = j
    }
    if (frames.length > 1) this.err(`an unclosed %{ ${frames[frames.length - 1].kind} }`, start)
    flush()
    return root.parts
  }
  escape() {
    const t = this.t
    const c = t[this.i + 1]
    const simple = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }
    if (c in simple) { this.i += 2; return simple[c] }
    if (c === 'u' || c === 'U') {
      const n = c === 'u' ? 4 : 8
      const hex = t.slice(this.i + 2, this.i + 2 + n)
      if (hex.length !== n || !/^[0-9a-fA-F]+$/.test(hex)) this.err('a bad \\u escape')
      const cp = parseInt(hex, 16)
      if (cp > 0x10ffff) this.err('a \\U escape past the last code point')
      this.i += 2 + n
      return String.fromCodePoint(cp)
    }
    this.err(`an unknown escape \\${c ?? ''}`)
  }
}

// binary operators, loosest first
const OPS = [['||'], ['&&'], ['==', '!='], ['<=', '>=', '<', '>'], ['+', '-'], ['*', '/', '%']]

// An expression as safe text, for a note or an unknown value: names and attribute paths as written,
// a function by its name alone, never a literal value (a variable may hold a secret, and the literal
// beside it too): `dependency.tables.outputs.sort_key`, `get_env(…)`, `local.names["orders"]`.
export function refText(x, max = 80) {
  const out = []
  let n = 0
  const add = (s) => { out.push(s); n += s.length }
  const walk = (y) => {
    if (n > max || !y) return
    switch (y.t) {
      case 'var': return add(y.name)
      case 'get': walk(y.x); return add(`.${y.name}`)
      case 'index': walk(y.x); return add(y.key.t === 'lit' && (typeof y.key.v === 'number' || /^[\w.-]{1,40}$/.test(String(y.key.v))) ? `[${typeof y.key.v === 'number' ? y.key.v : JSON.stringify(y.key.v)}]` : '[…]')
      case 'splat': walk(y.x); return add(`[*]${y.ops.map((o) => (o.name ? `.${o.name}` : '[…]')).join('')}`)
      case 'call': return add(`${y.name}(…)`)
      case 'paren': return walk(y.x)
      default: return add('…')
    }
  }
  walk(x)
  const s = out.join('')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
