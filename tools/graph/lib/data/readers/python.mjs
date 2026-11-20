// grimoire graph · data · Python values as the pinned Python grammar reads them, for the extractors that
// read models declared in Python (extractors/django.mjs, extractors/sqlalchemy.mjs). Nothing is
// evaluated: a literal is its value, a name or an attribute its dotted text, anything else code.
//   value(node) → { k: str | int | float | true | false | none | list | dict | name | call | code, v?, items?, pairs?, fn?, node? }
//   callArgs(call) → { pos: [node], kw: Map(name → node) }
import { named, field } from './code.mjs'

const ESC = { n: ' ', t: ' ', r: ' ', '0': '' }
export function value(n, depth = 0) {
  if (!n || depth > 16) return { k: 'code' }
  switch (n.type) {
    case 'string': {
      let v = ''
      for (const c of named(n)) {
        if (c.type === 'string_start') { if (/[fF]/.test(c.text)) { if (named(n).some((x) => x.type === 'interpolation')) return { k: 'code' } } continue }
        if (c.type === 'string_end') continue
        if (c.type === 'string_content') v += c.text
        else if (c.type === 'escape_sequence') v += c.text.length === 2 ? (ESC[c.text[1]] ?? c.text[1]) : ''
        else return { k: 'code' } // an interpolation
      }
      return { k: 'str', v }
    }
    case 'concatenated_string': { let v = ''; for (const c of named(n)) { const x = value(c, depth + 1); if (x.k !== 'str') return { k: 'code' }; v += x.v } return { k: 'str', v } }
    case 'integer': return { k: 'int', v: n.text.replace(/_/g, '') }
    case 'float': return { k: 'float', v: n.text.replace(/_/g, '') }
    case 'true': return { k: 'true' }
    case 'false': return { k: 'false' }
    case 'none': return { k: 'none' }
    case 'unary_operator': { const x = value(named(n)[0], depth + 1); return (x.k === 'int' || x.k === 'float') && n.text.trim().startsWith('-') ? { k: x.k, v: `-${x.v}` } : { k: 'code' } }
    case 'list': case 'tuple': case 'set': return { k: 'list', items: named(n).filter((c) => c.type !== 'comment').map((c) => value(c, depth + 1)), nodes: named(n).filter((c) => c.type !== 'comment') }
    case 'parenthesized_expression': return value(named(n)[0], depth + 1)
    case 'dictionary': { const pairs = new Map(); for (const p of named(n)) if (p.type === 'pair') { const k = value(field(p, 'key')); if (k.k === 'str' && !pairs.has(k.v)) pairs.set(k.v, field(p, 'value')) } return { k: 'dict', pairs } }
    case 'identifier': return { k: 'name', v: n.text }
    case 'attribute': return { k: 'name', v: n.text.replace(/\s+/g, '') }
    case 'call': return { k: 'call', fn: field(n, 'function')?.text.replace(/\s+/g, '') || '', node: n }
    default: return { k: 'code' }
  }
}
export function callArgs(call) {
  const list = field(call, 'arguments')
  const items = list ? named(list).filter((c) => c.type !== 'comment') : []
  const kw = new Map()
  for (const c of items) if (c.type === 'keyword_argument') { const k = field(c, 'name')?.text; if (k && !kw.has(k)) kw.set(k, field(c, 'value')) }
  return { pos: items.filter((c) => c.type !== 'keyword_argument' && c.type !== 'list_splat' && c.type !== 'dictionary_splat'), kw, splat: items.some((c) => c.type === 'list_splat' || c.type === 'dictionary_splat') }
}
export const strOf = (n) => { const v = value(n); return v.k === 'str' ? v.v : null }
export const boolOf = (n) => { const v = value(n); return v.k === 'true' ? true : v.k === 'false' ? false : null }
export const intOf = (n) => { const v = value(n); return v.k === 'int' ? Number(v.v) : null }
// a list of strings (`["a", "b"]`, `("a",)`), else null
export function strsOf(n) {
  const v = value(n)
  if (v.k === 'str') return [v.v]
  if (v.k === 'list' && v.items.every((x) => x.k === 'str')) return v.items.map((x) => x.v)
  return null
}
// The last name of a dotted callee or base (`models.CharField` → CharField, `sa.Column` → Column)
export const lastName = (s) => String(s || '').split('.').pop()
// a module's imports: name bound → the dotted path it stands for (`from django.db import models` → models → django.db.models)
export function importsOf(root) {
  const out = new Map()
  for (const s of named(root)) {
    if (s.type === 'import_from_statement') {
      const mod = field(s, 'module_name')?.text || ''
      for (const c of named(s)) {
        if (c === field(s, 'module_name')) continue
        if (c.type === 'dotted_name') out.set(c.text, `${mod}.${c.text}`)
        else if (c.type === 'aliased_import') { const nm = field(c, 'name')?.text, al = field(c, 'alias')?.text; if (nm && al) out.set(al, `${mod}.${nm}`) }
      }
    } else if (s.type === 'import_statement') {
      for (const c of named(s)) {
        if (c.type === 'dotted_name') out.set(c.text.split('.')[0], c.text.split('.')[0])
        else if (c.type === 'aliased_import') { const nm = field(c, 'name')?.text, al = field(c, 'alias')?.text; if (nm && al) out.set(al, nm) }
      }
    }
  }
  return out
}
// a dotted name with its first part resolved through the imports (`models.CharField` → django.db.models.CharField)
export function qualify(text, imports) {
  const [head, ...rest] = String(text || '').split('.')
  const q = imports.get(head)
  return q ? [q, ...rest].join('.') : String(text || '')
}
