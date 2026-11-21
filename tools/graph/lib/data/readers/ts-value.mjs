// grimoire graph · data · TypeScript and JavaScript values as the pinned grammar reads them, for the
// extractors that read decorators and schema objects (extractors/typeorm.mjs, extractors/mongoose.mjs).
// Nothing is evaluated: a literal is its value, a name or a member its text, anything else code.
//   value(node) → { k: str | num | true | false | null | obj | arr | arrow | name | call | code, v?, pairs?, items?, node? }
import { named, field } from './code.mjs'

const ESC = { n: ' ', t: ' ', r: ' ', '0': '' }
export function value(n, depth = 0) {
  if (!n || depth > 16) return { k: 'code' }
  switch (n.type) {
    case 'string': { let v = ''; for (const c of named(n)) v += c.type === 'escape_sequence' ? (c.text.length === 2 ? ESC[c.text[1]] ?? c.text[1] : '') : c.text; return { k: 'str', v } }
    case 'template_string': { let v = ''; for (const c of named(n)) { if (c.type === 'template_substitution') return { k: 'code' }; v += c.type === 'escape_sequence' ? (c.text.length === 2 ? ESC[c.text[1]] ?? c.text[1] : '') : c.text } return { k: 'str', v } }
    case 'number': return { k: 'num', v: n.text.replace(/_/g, '') }
    case 'true': case 'false': case 'null': return { k: n.type }
    case 'undefined': return { k: 'null' }
    case 'unary_expression': { const x = value(named(n)[0], depth + 1); return x.k === 'num' && n.text.trim().startsWith('-') ? { k: 'num', v: `-${x.v}` } : { k: 'code' } }
    case 'object': {
      const pairs = new Map()
      for (const p of named(n)) {
        if (p.type === 'pair') { const k = keyText(field(p, 'key')); if (k !== null && !pairs.has(k)) pairs.set(k, field(p, 'value')) }
        else if (p.type === 'shorthand_property_identifier') pairs.set(p.text, p)
      }
      return { k: 'obj', pairs, spread: named(n).some((p) => p.type === 'spread_element') }
    }
    case 'array': return { k: 'arr', items: named(n).filter((c) => c.type !== 'comment') }
    case 'arrow_function': return { k: 'arrow', node: n, body: field(n, 'body') }
    case 'identifier': case 'property_identifier': case 'type_identifier': return { k: 'name', v: n.text }
    case 'member_expression': return { k: 'name', v: n.text.replace(/\s+/g, '') }
    case 'call_expression': case 'new_expression': return { k: 'call', fn: (field(n, 'function') || field(n, 'constructor'))?.text.replace(/\s+/g, '') || '', node: n }
    case 'parenthesized_expression': case 'as_expression': case 'satisfies_expression': case 'non_null_expression': return value(named(n)[0], depth + 1)
    default: return { k: 'code' }
  }
}
export function keyText(k) {
  if (!k) return null
  if (k.type === 'property_identifier' || k.type === 'identifier') return k.text
  if (k.type === 'string') { const v = value(k); return v.k === 'str' ? v.v : null }
  if (k.type === 'number') return k.text
  return null
}
export const str = (n) => { const v = value(n); return v.k === 'str' ? v.v : null }
export const bool = (n) => { const v = value(n); return v.k === 'true' ? true : v.k === 'false' ? false : null }
export const num = (n) => { const v = value(n); return v.k === 'num' ? v.v : null }
export const strs = (n) => { const v = value(n); if (v.k === 'str') return [v.v]; if (v.k === 'arr') { const out = v.items.map(str); return out.every((x) => x !== null) ? out : null } return null }
// a call's arguments
export const argsOf = (call) => named(field(call, 'arguments') || call).filter((c) => c.type !== 'comment')
// the class an arrow names (`() => User`, `(type) => User`) or a string names (`'User'`)
export function classRef(n) {
  const v = value(n)
  if (v.k === 'arrow') { const b = value(v.body); return b.k === 'name' ? b.v.split('.').pop() : null }
  if (v.k === 'str') return v.v
  if (v.k === 'name') return v.v.split('.').pop()
  return null
}
