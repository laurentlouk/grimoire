// grimoire graph · data · extractor: TypeScript item shapes and the names code reaches a table by,
// through the pinned tree-sitter grammars (spec D9). Per file (.ts, .mts, .cts, .tsx; never a .d.ts),
// kind code: no table of its own (readers/code.mjs says what it gives the binding, data/binding.mjs).
//
// Shapes: every interface and type alias of the file (the binding keeps only the ones code converts,
// and what they hold):
//   - a property's `?`, and `| null` / `| undefined`, nullable;
//   - a union of string literals an enum (its values); `T[]`, Array, ReadonlyArray and Set a list;
//     Record, Map and an index signature a map; an object type literal nested fields;
//   - `extends` (an interface) and `&` (an intersection) inline the named types' fields.
// Uses, per function (a declaration, a method, an arrow or function expression named by what holds
// it; a callback belongs to its function; a *.test.ts or *.spec.ts file is test code):
//   - conversions: `marshall(x)` (x's type), `unmarshall(item) as T`, a call named like an item
//     conversion (toItem, fromItem, toDynamoItem, fromDynamoItem, fromItems) with its type argument
//     (`fromItem<Order>(…)`), its receiver's or first argument's type, or the type its result is
//     given; an `Item: x` member (a put's input); `….Item as T`, `….Items as T[]`; a type is the one a
//     parameter, a typed const, an `as` or a `satisfies` states, else the function's return type;
//   - names: string literals, template literals (each `${…}` a part filled in at run time) and string
//     concatenations that could name a table (readers/names.mjs codeName);
//   - environment reads: process.env.X, process.env['X'];
//   - constants read: a file-level const, an imported name, or a SCREAMING_CASE identifier, and a
//     class's own field (`this.table`, set where it is declared or in the constructor).
// Constants (a file-level const, a class field) holding a name or reading the environment are listed
// with what they hold. Nothing is evaluated.
import { codeName } from '../readers/names.mjs'
import { MAX, named, field, lineOf, endOf, cap, push, CONST_NAME, each, codeFacts } from '../readers/code.mjs'

export const TS_CONV = /^(?:to|into|from)(?:[A-Z][A-Za-z0-9]*)?Items?$/
const TS = /\.(?:ts|mts|cts|tsx)$/i
const DTS = /\.d\.[cm]?ts$/i
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$/i
const LEVEL_RE = /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:interface|type)[ \t]+[A-Za-z_$]|\bprocess\.env\b|\b(?:un)?marshall\(|\bItem:|\b(?:to|from)[A-Za-z]*Items?\b/m
export const tsLevel = (text) => (LEVEL_RE.test(text) ? 1 : 0)
const langOf = (p) => (/\.tsx$/i.test(p) ? 'tsx' : 'typescript')

// ── types ──
const strVal = (n) => named(n).filter((x) => x.type === 'string_fragment' || x.type === 'escape_sequence').map((x) => (x.type === 'escape_sequence' ? unescape1(x.text) : x.text)).join('')
const unescape1 = (s) => ({ '\\n': '\n', '\\t': '\t', '\\r': '\r', '\\0': '\0' })[s] ?? s.slice(1)
const LIST = new Set(['Array', 'ReadonlyArray', 'Set', 'ReadonlySet'])
const MAPS = new Set(['Record', 'Map', 'ReadonlyMap'])
const SAME = new Set(['Partial', 'Readonly', 'Required', 'NonNullable'])
const nullish = (n) => (n.type === 'predefined_type' && /^(?:null|undefined|void)$/.test(n.text)) || (n.type === 'literal_type' && /^(?:null|undefined)$/.test(n.text))
// a type node → { t, nullable }
function tstype(n, depth = 0) {
  if (!n || depth > 16) return { t: { k: 'any' }, nullable: false }
  if (n.type === 'type_annotation') return tstype(named(n)[0], depth + 1)
  switch (n.type) {
    case 'predefined_type': return { t: { k: n.text === 'string' ? 'string' : n.text === 'number' || n.text === 'bigint' ? 'number' : n.text === 'boolean' ? 'bool' : 'any' }, nullable: /^(?:null|undefined|void)$/.test(n.text) }
    case 'literal_type': {
      const c = named(n)[0]
      if (!c) return { t: { k: 'any' }, nullable: false }
      if (c.type === 'string') return { t: { k: 'enum', values: [strVal(c)] }, nullable: false }
      if (c.type === 'number') return { t: { k: 'number' }, nullable: false }
      if (c.type === 'true' || c.type === 'false') return { t: { k: 'bool' }, nullable: false }
      return { t: { k: 'any' }, nullable: c.type === 'null' || c.type === 'undefined' }
    }
    case 'union_type': {
      const members = []
      const flat = (u) => { for (const m of named(u)) { if (m.type === 'union_type') flat(m); else members.push(m) } }
      flat(n)
      const rest = members.filter((m) => !nullish(m))
      const nullable = rest.length < members.length
      if (rest.length && rest.every((m) => m.type === 'literal_type' && named(m)[0]?.type === 'string')) return { t: { k: 'enum', values: rest.map((m) => strVal(named(m)[0])) }, nullable }
      if (rest.length === 1) { const r = tstype(rest[0], depth + 1); return { t: r.t, nullable: nullable || r.nullable } }
      return { t: { k: 'any' }, nullable }
    }
    case 'parenthesized_type': return tstype(named(n)[0], depth + 1)
    case 'array_type': return { t: { k: 'list', of: tstype(named(n)[0], depth + 1).t }, nullable: false }
    case 'tuple_type': return { t: { k: 'list', of: { k: 'any' } }, nullable: false }
    case 'object_type': return { t: { k: 'obj', fields: membersOf(n, depth + 1) }, nullable: false }
    case 'intersection_type': {
      const fields = [], ext = []
      const flat = (u) => { for (const m of named(u)) { if (m.type === 'intersection_type') flat(m); else if (m.type === 'object_type') fields.push(...membersOf(m, depth + 1)); else { const r = refName(m); if (r) ext.push(r) } } }
      flat(n)
      return { t: { k: 'obj', fields, ...(ext.length ? { ext } : {}) }, nullable: false }
    }
    case 'generic_type': {
      const base = refName(field(n, 'name') || named(n)[0]), ta = field(n, 'type_arguments'), args = ta ? named(ta) : []
      if (LIST.has(base)) return { t: { k: 'list', of: tstype(args[0], depth + 1).t }, nullable: false }
      if (MAPS.has(base)) return { t: { k: 'map', of: tstype(args[1] || args[0], depth + 1).t }, nullable: false }
      if (SAME.has(base)) return tstype(args[0], depth + 1)
      return { t: { k: 'ref', n: base }, nullable: false }
    }
    case 'type_identifier': case 'nested_type_identifier': { const r = refName(n); return r === 'Date' ? { t: { k: 'string' }, nullable: false } : { t: { k: 'ref', n: r }, nullable: false } }
    default: return { t: { k: 'any' }, nullable: false }
  }
}
const refName = (n) => (!n ? null : n.type === 'type_identifier' ? n.text : n.type === 'nested_type_identifier' ? n.text.split('.').pop() : n.type === 'generic_type' ? refName(field(n, 'name') || named(n)[0]) : null)
const propName = (n) => (!n ? null : n.type === 'string' ? strVal(n) : n.type === 'property_identifier' || n.type === 'identifier' || n.type === 'number' ? n.text : null)
const optional = (n) => { for (let i = 0; i < n.childCount; i++) if (n.child(i).type === '?') return true; return false }
// an object type's or an interface body's data members
function membersOf(body, depth = 0) {
  const out = []
  for (const m of named(body)) {
    if (m.type === 'property_signature') {
      const name = propName(field(m, 'name'))
      if (name === null) continue
      const tn = field(m, 'type')
      const { t, nullable } = tstype(tn, depth)
      push(out, { name, raw: cap(tn ? named(tn)[0]?.text.replace(/\s+/g, ' ') ?? '' : ''), t, nullable: nullable || optional(m), default: null, line: lineOf(m) }, MAX.fields)
    } else if (m.type === 'index_signature') {
      const tn = field(m, 'type')
      push(out, { name: '*', raw: cap(m.text.replace(/\s+/g, ' ').replace(/;$/, '')), t: { k: 'map', of: tstype(tn, depth).t }, nullable: true, default: null, index: true, line: lineOf(m) }, MAX.fields)
    }
  }
  return out
}
function typeOf(node) {
  const name = field(node, 'name')?.text
  if (!name) return null
  const base = { name, line: lineOf(node), end: endOf(node), serde: true }
  if (node.type === 'interface_declaration') {
    const ext = []
    for (const c of named(node)) if (c.type === 'extends_type_clause') for (const x of named(c)) { const r = refName(x); if (r) ext.push(r) }
    const body = field(node, 'body')
    return { ...base, kind: 'interface', fields: body ? membersOf(body) : [], ...(ext.length ? { extends: ext } : {}) }
  }
  const v = field(node, 'value')
  const { t, nullable } = tstype(v)
  if (t.k === 'obj') return { ...base, kind: 'alias', fields: t.fields, ...(t.ext ? { extends: t.ext } : {}) }
  if (t.k === 'enum') return { ...base, kind: 'alias', fields: [], values: t.values }
  return { ...base, kind: 'alias', fields: [], alias: { ...t, ...(nullable ? { nullable: true } : {}) } }
}

// ── uses ──
const isEnvObj = (n) => n && n.type === 'member_expression' && n.text.replace(/\s+/g, '') === 'process.env'
// a string-building expression's parts: [string | null], or null when it builds no string
function partsOf(n, depth = 0) {
  if (!n || depth > 32) return null
  if (n.type === 'string') return [strVal(n)]
  if (n.type === 'template_string') return named(n).map((x) => (x.type === 'template_substitution' ? null : x.type === 'escape_sequence' ? unescape1(x.text) : x.text))
  if (n.type === 'parenthesized_expression') return partsOf(named(n)[0], depth + 1)
  if (n.type === 'binary_expression' && n.child(1)?.type === '+') {
    const l = partsOf(field(n, 'left'), depth + 1), r = partsOf(field(n, 'right'), depth + 1)
    if (!l && !r) return null
    return [...(l || [null]), ...(r || [null])]
  }
  return null
}
const typeName = (n, depth = 0) => {
  if (!n || depth > 8) return null
  if (n.type === 'type_annotation') return typeName(named(n)[0], depth + 1)
  if (n.type === 'type_identifier' || n.type === 'nested_type_identifier') return refName(n)
  if (n.type === 'array_type') return typeName(named(n)[0], depth + 1)
  if (n.type === 'generic_type') { const b = refName(n), ta = field(n, 'type_arguments'); return /^(?:Array|ReadonlyArray|Promise|Partial|Readonly|Required)$/.test(b) && ta ? typeName(named(ta)[0], depth + 1) : b }
  if (n.type === 'union_type') { const rest = named(n).filter((m) => !nullish(m)); return rest.length === 1 ? typeName(rest[0], depth + 1) : null }
  if (n.type === 'parenthesized_type') return typeName(named(n)[0], depth + 1)
  return null
}
const NOT_ITEM = new Set(['Record', 'Map', 'Set', 'Array', 'Promise', 'Date', 'Item', 'AttributeValue', 'Error'])
const userType = (t) => (t && /^[A-Z]/.test(t) && !NOT_ITEM.has(t) ? t : null)
function exprType(e, ctx, depth = 0) {
  if (!e || depth > 8) return null
  switch (e.type) {
    case 'identifier': return ctx.vars.get(e.text) ?? null
    case 'as_expression': case 'satisfies_expression': return typeName(named(e)[1])
    case 'parenthesized_expression': case 'non_null_expression': case 'await_expression': return exprType(named(e)[0], ctx, depth + 1)
    default: return null
  }
}
// the type a call's result is given: an `as`, the const it is assigned to, else the function's return type
function resultType(n, ctx) {
  let c = n
  for (let i = 0; i < 4 && c.parent; i++) {
    const p = c.parent
    if (p.type === 'as_expression' || p.type === 'satisfies_expression') return typeName(named(p)[1])
    if (p.type === 'variable_declarator') return typeName(field(p, 'type'))
    if (!/^(?:await_expression|parenthesized_expression|non_null_expression)$/.test(p.type)) break
    c = p
  }
  return ctx.ret
}
function calleeName(fn) {
  if (!fn) return [null, null]
  if (fn.type === 'identifier') return [fn.text, null]
  if (fn.type === 'member_expression') return [field(fn, 'property')?.text ?? null, field(fn, 'object')]
  return [null, null]
}

const isKey = (n) => n.parent && n.parent.type === 'pair' && field(n.parent, 'key')?.startIndex === n.startIndex
function scanUses(root, ctx, sink) {
  each(root, (n) => {
    if (n.type === 'literal_type' || n.type === 'type_annotation' || n.type === 'type_arguments') return false
    if (n.type === 'string' && isKey(n)) return false // a member's name, not a value
    if (n.type === 'string' || n.type === 'template_string' || (n.type === 'binary_expression' && n.child(1)?.type === '+')) {
      const parts = partsOf(n)
      if (parts && (n.type !== 'binary_expression' || parts.some((p) => p !== null))) {
        const p = codeName(parts)
        if (p) push(sink.names, { text: p, line: lineOf(n) })
        // what fills its parts in may read the environment: look inside, never at its strings again
        if (n.type === 'template_string') { for (const s of named(n)) if (s.type === 'template_substitution') scanUses(s, ctx, sink) }
        else if (n.type === 'binary_expression') each(n, (x) => (x === n ? true : x.type === 'string' || x.type === 'template_string' ? false : visitOne(x, ctx, sink) !== false))
        return false
      }
    }
    return visitOne(n, ctx, sink) !== false
  })
}
// one node's use; false when what it holds is read (an environment read's name is no table name)
function visitOne(n, ctx, sink) {
  if (n.type === 'member_expression' && isEnvObj(field(n, 'object'))) { const p = field(n, 'property'); if (p) push(sink.env, { name: p.text, line: lineOf(n) }); return false }
  if (n.type === 'subscript_expression' && isEnvObj(field(n, 'object'))) { const i = field(n, 'index'); if (i && i.type === 'string') push(sink.env, { name: strVal(i), line: lineOf(n) }); return false }
  if (n.type === 'identifier' && (ctx.known.has(n.text) || CONST_NAME.test(n.text)) && sink.uses.length < MAX.per && !sink.uses.includes(n.text)) { sink.uses.push(n.text); return }
  if (n.type === 'member_expression' && ctx.cls && field(n, 'object')?.type === 'this') { const k = `${ctx.cls}.${field(n, 'property')?.text}`; if (ctx.known.has(k) && !sink.uses.includes(k)) push(sink.uses, k); return }
  if (!sink.converts) return
  if (n.type === 'call_expression') {
    const [name, recv] = calleeName(field(n, 'function'))
    if (!name) return
    const args = field(n, 'arguments'), first = args ? named(args)[0] : null
    let type = null
    if (name === 'marshall') type = exprType(first, ctx)
    else if (name === 'unmarshall') type = resultType(n, ctx)
    else if (TS_CONV.test(name)) {
      const ta = field(n, 'type_arguments')
      if (ta && named(ta)[0]) type = typeName(named(ta)[0])
      else if (recv) type = exprType(recv, ctx)
      if (!type) type = /^(?:to|into)/.test(name) ? exprType(first, ctx) : resultType(n, ctx)
    } else return
    type = userType(type)
    if (type) push(sink.converts, { type, line: lineOf(n), how: name })
    return
  }
  if (n.type === 'pair') {
    const k = field(n, 'key')
    if (propName(k) !== 'Item') return
    const type = userType(exprType(field(n, 'value'), ctx))
    if (type) push(sink.converts, { type, line: lineOf(n), how: 'Item' })
    return
  }
  if (n.type === 'as_expression') {
    const e = named(n)[0]
    const what = e?.type === 'member_expression' ? field(e, 'property')?.text : e?.type === 'identifier' ? e.text : null
    if (what !== 'Item' && what !== 'Items') return
    const type = userType(typeName(named(n)[1]))
    if (type) push(sink.converts, { type, line: lineOf(n), how: `${what} as` })
  }
}

function varsOf(fn, cls) {
  const vars = new Map()
  const params = field(fn, 'parameters')
  for (const p of params ? named(params) : []) {
    if (p.type !== 'required_parameter' && p.type !== 'optional_parameter') continue
    const pat = field(p, 'pattern'), t = typeName(field(p, 'type'))
    if (pat && pat.type === 'identifier' && t) vars.set(pat.text, t)
  }
  if (fn.type === 'arrow_function' && field(fn, 'parameter')?.type === 'identifier') { /* untyped */ }
  const body = field(fn, 'body')
  if (body) each(body, (n) => {
    if (n.type === 'variable_declarator') {
      const name = field(n, 'name'), t = field(n, 'type'), v = field(n, 'value')
      if (name && name.type === 'identifier') { const ty = t ? typeName(t) : v && (v.type === 'as_expression' || v.type === 'satisfies_expression') ? typeName(named(v)[1]) : null; if (ty) vars.set(name.text, ty) }
    }
    return true
  })
  if (cls) vars.set('this', cls)
  return vars
}

export function readTs(tree, file) {
  const types = [], consts = [], fns = [], notes = []
  const test = TEST_FILE.test(file)
  const root = tree.rootNode
  // what a function may read by name: the file's constants and the names it imports
  const known = new Set()
  const decls = (n) => (n.type === 'export_statement' ? field(n, 'declaration') || named(n).find((x) => /declaration$/.test(x.type)) : n)
  for (const c of named(root)) {
    if (c.type === 'import_statement') each(c, (x) => { if (x.type === 'import_specifier') known.add((field(x, 'alias') || field(x, 'name'))?.text); else if (x.type === 'identifier' && x.parent?.type === 'import_clause') known.add(x.text); return true })
    const d = c && decls(c)
    if (d && (d.type === 'lexical_declaration' || d.type === 'variable_declaration')) for (const v of named(d)) if (v.type === 'variable_declarator' && field(v, 'name')?.type === 'identifier') known.add(field(v, 'name').text)
  }
  const fnOf = (node, name, cls) => {
    const sink = { names: [], env: [], uses: [], converts: [] }
    const body = field(node, 'body')
    if (body) scanUses(body, { vars: varsOf(node, cls), known, cls, ret: userType(typeName(field(node, 'return_type'))) }, sink)
    push(fns, { name, line: lineOf(node), end: endOf(node), ...(test ? { test: true } : {}), converts: sink.converts, names: sink.names, env: sink.env, uses: sink.uses }, MAX.fns)
  }
  const constOf = (name, value, line, cls = null) => {
    const sink = { names: [], env: [], uses: [] }
    scanUses(value, { vars: new Map(), known, cls, ret: null }, sink)
    if (sink.names.length || sink.env.length) { push(consts, { name, line, names: sink.names, env: sink.env, ...(test ? { test: true } : {}) }, MAX.fns); known.add(name) }
  }
  const FN = /^(?:arrow_function|function_expression|function|generator_function)$/
  const classOf = (c) => {
    const cname = field(c, 'name')?.text || '(class)'
    const body = field(c, 'body')
    for (const m of body ? named(body) : []) {
      if ((m.type === 'public_field_definition' || m.type === 'field_definition') && field(m, 'value')) {
        const pn = propName(field(m, 'name') || field(m, 'property')), v = field(m, 'value')
        if (pn && FN.test(v.type)) fnOf(v, `${cname}.${pn}`, cname)
        else if (pn) constOf(`${cname}.${pn}`, v, lineOf(m), cname)
      }
    }
    for (const m of body ? named(body) : []) {
      if (m.type !== 'method_definition') continue
      const mn = propName(field(m, 'name')) || '(method)'
      if (mn === 'constructor') {
        each(field(m, 'body') || m, (x) => {
          if (x.type === 'assignment_expression') { const l = field(x, 'left'); if (l && l.type === 'member_expression' && field(l, 'object')?.type === 'this') constOf(`${cname}.${field(l, 'property')?.text}`, field(x, 'right'), lineOf(x), cname) }
          return true
        })
      }
      fnOf(m, `${cname}.${mn}`, cname)
    }
  }
  for (const top of named(root)) {
    const c = decls(top)
    if (!c) continue
    if (c.type === 'interface_declaration' || c.type === 'type_alias_declaration') { const t = typeOf(c); if (t) push(types, t, MAX.types); continue }
    if (c.type === 'function_declaration' || c.type === 'generator_function_declaration') { fnOf(c, field(c, 'name')?.text || '(function)', null); continue }
    if (c.type === 'class_declaration' || c.type === 'abstract_class_declaration') { classOf(c); continue }
    if (c.type === 'lexical_declaration' || c.type === 'variable_declaration') {
      for (const v of named(c)) {
        if (v.type !== 'variable_declarator') continue
        const name = field(v, 'name'), val = field(v, 'value')
        if (!name || !val) continue
        if (FN.test(val.type)) fnOf(val, name.text, null)
        else if (name.type === 'identifier') constOf(name.text, val, lineOf(v))
      }
      continue
    }
    if (top.type === 'export_statement') { const v = field(top, 'value') || named(top).find((x) => FN.test(x.type)); if (v && FN.test(v.type)) fnOf(v, '(default)', null) }
  }
  return { lang: 'ts', types, consts, fns: fns.filter((f) => f.converts.length || f.names.length || f.env.length || f.uses.length), notes }
}

export default {
  id: 'ts-types',
  version: 1,
  kind: 'code',
  scope: 'file',
  wants: (p) => TS.test(p) && !DTS.test(p),
  level: (p, text) => tsLevel(text),
  discover: (info) => [...info].filter(([p, i]) => TS.test(p) && !DTS.test(p) && i.ddl === 1).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    if (ctx.aside) return ctx.aside('ts-types', file, text)
    const tree = ctx.tree(langOf(file), text)
    try { return codeFacts({ path: file, ...readTs(tree, file) }) } finally { tree.delete?.() }
  },
}
