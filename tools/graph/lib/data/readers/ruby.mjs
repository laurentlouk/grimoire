// grimoire graph · data · Ruby values as the pinned Ruby grammar reads them, for the extractors that read
// a schema or a model written in Ruby (extractors/rails.mjs). Nothing is evaluated: a literal is its
// value, anything else is code (`{ k: 'code' }`), never guessed.
//   value(node) → { k: str | sym | int | float | true | false | nil | array | hash | lambda | const | code, v?, items?, pairs? }
//   args(call) → { pos: [value node], opts: Map(key → value node) }   a call's positional arguments and its options
import { named, field } from './code.mjs'

export function value(n, depth = 0) {
  if (!n || depth > 16) return { k: 'code' }
  switch (n.type) {
    case 'string': case 'bare_string': {
      let v = ''
      for (const c of named(n)) {
        if (c.type === 'string_content') v += c.text
        else if (c.type === 'escape_sequence') v += unescape(c.text)
        else return { k: 'code' } // an interpolation: built by code
      }
      return { k: 'str', v }
    }
    case 'chained_string': { let v = ''; for (const c of named(n)) { const x = value(c, depth + 1); if (x.k !== 'str') return { k: 'code' }; v += x.v } return { k: 'str', v } }
    case 'simple_symbol': return { k: 'sym', v: n.text.replace(/^:/, '') }
    case 'hash_key_symbol': return { k: 'sym', v: n.text }
    case 'delimited_symbol': { const x = value({ type: 'string', namedChildCount: n.namedChildCount, namedChild: (i) => n.namedChild(i) }, depth + 1); return x.k === 'str' ? { k: 'sym', v: x.v } : x }
    case 'integer': return { k: 'int', v: n.text.replace(/_/g, '') }
    case 'float': return { k: 'float', v: n.text.replace(/_/g, '') }
    case 'true': case 'false': case 'nil': return { k: n.type }
    case 'array': case 'string_array': case 'symbol_array': return { k: 'array', items: named(n).map((c) => value(c, depth + 1)) }
    case 'hash': return { k: 'hash', pairs: pairsOf(named(n)) }
    case 'lambda': return { k: 'lambda', node: n }
    case 'constant': case 'scope_resolution': return { k: 'const', v: n.text }
    case 'parenthesized_statements': return named(n).length === 1 ? value(named(n)[0], depth + 1) : { k: 'code' }
    default: return { k: 'code' }
  }
}
const ESC = { n: ' ', t: ' ', r: ' ', s: ' ', '0': '' }
const unescape = (t) => (t.length === 2 ? (ESC[t[1]] ?? t[1]) : '')
// a pair's key as a name (`name:`, `:name =>`, `"name" =>`)
function keyOf(k) {
  const v = value(k)
  return v.k === 'sym' || v.k === 'str' ? v.v : null
}
export function pairsOf(list) {
  const out = new Map()
  for (const p of list) {
    if (p.type !== 'pair') continue
    const k = keyOf(field(p, 'key'))
    if (k !== null && !out.has(k)) out.set(k, field(p, 'value'))
  }
  return out
}
export function args(call) {
  const list = field(call, 'arguments')
  const items = list ? named(list) : []
  const pos = items.filter((c) => c.type !== 'pair' && c.type !== 'comment' && c.type !== 'block_argument' && c.type !== 'hash_splat_argument' && c.type !== 'splat_argument')
  const opts = pairsOf(items)
  // a trailing hash given in braces (`t.index :a, { unique: true }`) is options too
  const last = pos[pos.length - 1]
  if (last && last.type === 'hash' && pos.length > 1) { for (const [k, v] of pairsOf(named(last))) if (!opts.has(k)) opts.set(k, v); pos.pop() }
  return { pos, opts, splat: items.some((c) => c.type === 'hash_splat_argument' || c.type === 'splat_argument') }
}
// a name a value gives: a string or a symbol
export const nameOf = (n) => { const v = value(n); return v.k === 'str' || v.k === 'sym' ? v.v : null }
// a list of names: one, or an array of them
export function namesOf(n) {
  const v = value(n)
  if (v.k === 'str' || v.k === 'sym') return [v.v]
  if (v.k === 'array' && v.items.length && v.items.every((x) => x.k === 'str' || x.k === 'sym')) return v.items.map((x) => x.v)
  return null
}
export const bool = (n) => { const v = value(n); return v.k === 'true' ? true : v.k === 'false' ? false : null }
