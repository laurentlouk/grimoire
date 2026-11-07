// grimoire graph · data · a reader for Prisma's schema language (spec D9: a small hand reader, no
// grammar), the declarative subset a data model needs: one linear pass into tokens, one into blocks.
//
//   readPrisma(text) → { blocks: [Block], errors: [{ line, error }] }
//   Block  { kind: datasource | generator | model | view | enum | type, name, line, end, ... }
//     datasource, generator  entries: [{ key, value: Value, line }]
//     model, view, type      fields: [{ name, type, optional, list, unsupported?, attrs: [Attr], line }],
//                            attrs: [Attr] (the block's @@ attributes)
//     enum                   values: [{ name, attrs: [Attr], line }], attrs
//   Attr   { name: as written after @ or @@ (`id`, `db.VarChar`, `relation`), args: [Arg], line }
//   Arg    { name: a named argument's (`fields`, `onDelete`) or null, value: Value }
//   Value  { k: str, v } | { k: num, v: text } | { k: id, v } (an identifier, true and false among
//          them) | { k: call, name, args: [Arg] } | { k: list, items: [Value] }
// Comments (`//`, `///`, and a `/* … */` block, which the language does not have) are skipped. A
// newline ends a field, an entry or a value; inside parentheses and brackets it is a blank.
//
// Bounded, like the other readers: a text past MAX_TEXT is refused, a nesting past MAX_DEPTH stops
// its block, and the lists are capped (MAX). A block that does not parse is skipped to its closing
// brace, its error kept; the blocks around it are read. An error says where, never what: no text of
// the file is ever in it (a datasource may hold a connection string).
export const MAX_TEXT = 2 << 20
export const MAX_DEPTH = 32
export const MAX = { blocks: 4000, fields: 1000, attrs: 64, args: 256, errors: 20 }

const KEYWORDS = new Set(['datasource', 'generator', 'model', 'view', 'enum', 'type'])
const PUNCT = new Set(['{', '}', '(', ')', '[', ']', ',', ':', '=', '?', '.'])

// The tokens of a text: { t: id | str | num | nl | p (punctuation) | at | at2 | bad | end, v, line }.
// A character no token starts with, or a string left open at the end of its line, is a `bad` token
// carrying its error (where, never what): the block it is in fails there, the others are read.
function tokens(text) {
  const out = []
  const n = text.length
  let line = 1
  for (let i = 0; i < n;) {
    const c = text[i]
    if (c === '\n') { out.push({ t: 'nl', line }); line++; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      for (let j = i; j < stop; j++) if (text[j] === '\n') { out.push({ t: 'nl', line }); line++ }
      i = stop
      continue
    }
    if (c === '"') {
      let j = i + 1, v = '', open = false
      for (;;) {
        if (j >= n || text[j] === '\n') { open = true; break }
        const d = text[j]
        if (d === '"') break
        if (d === '\\') { const e = text[j + 1]; if (e === '\n' || e === undefined) { j++; continue } v += e === 'n' ? '\n' : e === 't' ? '\t' : e; j += 2; continue }
        v += d; j++
      }
      if (open) { out.push({ t: 'bad', v: 'a string left open', line }); i = j; continue }
      out.push({ t: 'str', v, line }); i = j + 1
      continue
    }
    if (c === '@') {
      if (text[i + 1] === '@') { out.push({ t: 'at2', line }); i += 2 } else { out.push({ t: 'at', line }); i++ }
      continue
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i + 1
      while (j < n && /[0-9.eE+_-]/.test(text[j])) j++
      out.push({ t: 'num', v: text.slice(i, j), line }); i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++
      out.push({ t: 'id', v: text.slice(i, j), line }); i = j
      continue
    }
    if (PUNCT.has(c)) { out.push({ t: 'p', v: c, line }); i++; continue }
    out.push({ t: 'bad', v: 'a character the schema language has no use for', line })
    i++
    while (i < n && !/[\s"@{}()[\],:=?.A-Za-z0-9_/-]/.test(text[i])) i++ // a run of them is one error
  }
  out.push({ t: 'end', line })
  return out
}

export function readPrisma(text) {
  if (text.length > MAX_TEXT) return { blocks: [], errors: [{ line: 1, error: `larger than ${MAX_TEXT >> 20} MB: not read` }] }
  const toks = tokens(text)
  const blocks = [], errors = []
  let i = 0
  const peek = () => toks[i]
  const is = (t, v) => toks[i].t === t && (v === undefined || toks[i].v === v)
  const fail = (error) => { throw { line: toks[i].line, error: toks[i].t === 'bad' ? toks[i].v : error } }
  const skipNl = () => { while (toks[i].t === 'nl') i++ }
  const want = (t, v, what) => { if (!is(t, v)) fail(`${what} expected`); return toks[i++] }

  // a value; inside brackets and parentheses newlines are blanks (depth > 0)
  function value(depth) {
    if (depth > MAX_DEPTH) fail(`nested deeper than ${MAX_DEPTH} levels`)
    const blank = () => { if (depth > 0) skipNl() }
    blank()
    const tk = peek()
    if (tk.t === 'str') { i++; return { k: 'str', v: tk.v } }
    if (tk.t === 'num') { i++; return { k: 'num', v: tk.v } }
    if (tk.t === 'p' && tk.v === '[') {
      i++
      const items = []
      for (;;) {
        skipNl()
        if (is('p', ']')) { i++; break }
        if (items.length >= MAX.args) fail('a list longer than the reader keeps')
        items.push(value(depth + 1))
        skipNl()
        if (is('p', ',')) { i++; continue }
        if (is('p', ']')) { i++; break }
        fail('a comma or a closing bracket expected')
      }
      return { k: 'list', items }
    }
    if (tk.t === 'id') {
      i++
      let name = tk.v
      while (is('p', '.') && toks[i + 1].t === 'id') { name += `.${toks[i + 1].v}`; i += 2 }
      if (is('p', '(')) return { k: 'call', name, args: args(depth + 1) }
      return { k: 'id', v: name }
    }
    fail('a value expected')
  }
  // ( [name:] value, … )
  function args(depth) {
    if (depth > MAX_DEPTH) fail(`nested deeper than ${MAX_DEPTH} levels`)
    want('p', '(', 'an opening parenthesis')
    const out = []
    for (;;) {
      skipNl()
      if (is('p', ')')) { i++; break }
      if (out.length >= MAX.args) fail('more arguments than the reader keeps')
      let name = null
      if (is('id') && toks[i + 1].t === 'p' && toks[i + 1].v === ':') { name = toks[i].v; i += 2 }
      out.push({ name, value: value(depth) })
      skipNl()
      if (is('p', ',')) { i++; continue }
      if (is('p', ')')) { i++; break }
      fail('a comma or a closing parenthesis expected')
    }
    return out
  }
  // @name(args) or @@name(args)
  function attr() {
    const line = peek().line
    i++ // at or at2
    let name = want('id', undefined, 'an attribute name').v
    while (is('p', '.') && toks[i + 1].t === 'id') { name += `.${toks[i + 1].v}`; i += 2 }
    return { name, args: is('p', '(') ? args(1) : [], line }
  }
  const endOfLine = () => { if (!is('nl') && !is('p', '}')) fail('the end of the line expected') }

  function block() {
    const kw = peek()
    if (kw.t !== 'id' || !KEYWORDS.has(kw.v)) fail('a block (model, enum, view, type, datasource or generator) expected')
    i++
    const name = want('id', undefined, 'a block name').v
    skipNl()
    want('p', '{', 'an opening brace')
    const b = { kind: kw.v, name, line: kw.line, end: kw.line }
    if (kw.v === 'datasource' || kw.v === 'generator') b.entries = []
    else if (kw.v === 'enum') { b.values = []; b.attrs = [] } else { b.fields = []; b.attrs = [] }
    for (;;) {
      skipNl()
      if (is('p', '}')) { b.end = peek().line; i++; break }
      if (is('end')) fail('a block left open')
      if (is('at2')) { if (b.attrs && b.attrs.length < MAX.attrs) b.attrs.push(attr()); else attr(); endOfLine(); continue }
      const line = peek().line
      const key = want('id', undefined, 'a field, a value or an entry').v
      if (b.entries) {
        want('p', '=', 'an equals sign')
        b.entries.push({ key, value: value(0), line })
        endOfLine()
        continue
      }
      if (b.values) {
        const attrs = []
        while (is('at')) { const a = attr(); if (attrs.length < MAX.attrs) attrs.push(a) }
        if (b.values.length < MAX.fields) b.values.push({ name: key, attrs, line })
        endOfLine()
        continue
      }
      // a field: name Type[?|[]] @attr…
      if (!is('id')) fail('a field type expected')
      let type = toks[i++].v
      while (is('p', '.') && toks[i + 1].t === 'id') { type += `.${toks[i + 1].v}`; i += 2 }
      const f = { name: key, type, optional: false, list: false, attrs: [], line }
      if (is('p', '(')) { // Unsupported("…")
        const a = args(1)
        f.unsupported = a[0]?.value.k === 'str' ? a[0].value.v : ''
      }
      if (is('p', '[')) { i++; want('p', ']', 'a closing bracket'); f.list = true }
      if (is('p', '?')) { i++; f.optional = true }
      while (is('at')) { const a = attr(); if (f.attrs.length < MAX.attrs) f.attrs.push(a) }
      if (b.fields.length < MAX.fields) b.fields.push(f)
      endOfLine()
    }
    return b
  }

  for (;;) {
    skipNl()
    if (is('end')) break
    const start = i
    try {
      const b = block()
      if (blocks.length < MAX.blocks) blocks.push(b)
    } catch (e) {
      if (!e || typeof e.line !== 'number') throw e
      if (errors.length < MAX.errors) errors.push(e)
      // skip to the brace that closes the block it broke in, or the next line that starts one
      let depth = 0
      i = start
      for (; !is('end'); i++) {
        const tk = toks[i]
        if (tk.t === 'p' && tk.v === '{') depth++
        else if (tk.t === 'p' && tk.v === '}') { if (--depth <= 0) { i++; break } }
        else if (depth <= 0 && i > start && tk.t === 'nl' && toks[i + 1].t === 'id' && KEYWORDS.has(toks[i + 1].v)) { i++; break }
      }
    }
  }
  return { blocks, errors }
}

// A text's level, for discovery by content: 32 when it holds a datasource block, 16 when it holds a
// model, view or enum block (bits of a source file's level, registry.mjs).
const DATASOURCE = /^[ \t]*datasource[ \t]+[A-Za-z_]\w*[ \t\r\n]*\{/m
const MODELS = /^[ \t]*(?:model|view|enum)[ \t]+[A-Za-z_]\w*[ \t\r\n]*\{/m
export const prismaLevel = (text) => (DATASOURCE.test(text) ? 32 : 0) | (MODELS.test(text) ? 16 : 0)
