// grimoire graph · data · extractor: Rust item shapes and the names code reaches a table by, through
// the pinned tree-sitter grammar (spec D9). Per file, kind code: no table of its own (readers/code.mjs
// says what it gives the binding, data/binding.mjs).
//
// Shapes, as serde stores them (typeshare's rules, core/src/parser.rs, read again here, not copied):
//   - a struct or an enum that derives Serialize or Deserialize (`serde: true`); others are kept only
//     when the code converts them, so a conversion of a type serde never sees still names it;
//   - `#[serde(rename = "…")]` (or its `serialize` half) on a field or a variant; `rename_all` on the
//     container, every case style serde knows (lowercase, UPPERCASE, PascalCase, camelCase,
//     snake_case, SCREAMING_SNAKE_CASE, kebab-case, SCREAMING-KEBAB-CASE: a field's rule applies to its
//     snake_case name, a variant's to its PascalCase one); `rename_all_fields` on an enum, and a
//     variant's own `rename_all`, for the fields of its struct variants; `r#type` is stored as `type`;
//   - `flatten`: the field's type's fields stored inline (data/binding.mjs resolves the type);
//   - `default` (bare, or the function it names; on the container, for every field);
//   - `skip` and `skip_serializing`: never stored, so not in the shape (listed in `skipped`);
//     `skip_deserializing`: stored, kept; `skip_serializing_if`: the field may be absent (nullable);
//   - `tag` (internally tagged: the tag stored beside the variant's fields), `tag` + `content`
//     (adjacently tagged), `untagged`; a struct's `tag` stores its own name in that field;
//   - Option<T> nullable; Vec, VecDeque, the sets, arrays and slices a list; HashMap, BTreeMap and
//     IndexMap a map; Box, Rc, Arc, Cow and references what they hold; a tuple struct of one field
//     (a newtype) stored as that field.
// Uses, per function (a method too; a closure belongs to its function; test code marked):
//   - conversions: a call whose name is an item conversion (`to_item`, `from_item`, `from_items`,
//     `to_dynamo_item`, `from_dynamo_item`, `…_item_parser`: to | into | from, then `item` as a word):
//     its type from the turbofish (`from_item::<_, Order>`), the path (`Order::from_item(…)`, `Self::…`),
//     the receiver or the first argument whose type the function states (a parameter, a typed let,
//     a struct literal, self in an impl), else the let it is assigned to or the function's return type;
//     and a type implementing one (`impl Order { fn to_item… }`, a From or TryFrom whose header names
//     AttributeValue) is marked `converts`;
//   - names: string literals and `format!` strings that could name a table (readers/names.mjs codeName:
//     each `{…}` a part filled in at run time);
//   - environment reads: std::env::var / var_os, dotenv(y)::var, env! and option_env!, with a literal name;
//   - constants read: identifiers in SCREAMING_CASE (a `const` or `static` of this file or another,
//     data/binding.mjs resolves them).
// Constants (`const`, `static`, an impl's associated const) holding a name or reading the environment
// are listed with what they hold. Nothing is evaluated: a name built some other way is not seen.
import { codeName } from '../readers/names.mjs'
import { MAX, named, field, lineOf, endOf, cap, push, CONST_NAME, each, codeFacts } from '../readers/code.mjs'

export const CONV = /^(?:try_)?(?:to|into|from)_(?:[a-z0-9]+_)*items?(?:_[a-z0-9]+)*$/
const RS = /\.rs$/i
// what a file holds that the binding reads (registry.mjs inspect): a serde derive, a conversion, an
// environment read, a string constant
const LEVEL_RE = /\b(?:Serialize|Deserialize)\b|\b(?:try_)?(?:to|into|from)_(?:[a-z0-9]+_)*items?\b|\benv::var\b|\b(?:option_)?env!|^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:const|static)[ \t]+[A-Z][A-Z0-9_]*[ \t]*:/m
export const rustLevel = (text) => (LEVEL_RE.test(text) ? 1 : 0)

// ── serde's case rules (serde_derive's internals/case.rs, written again) ──
export const RULES = ['lowercase', 'UPPERCASE', 'PascalCase', 'camelCase', 'snake_case', 'SCREAMING_SNAKE_CASE', 'kebab-case', 'SCREAMING-KEBAB-CASE']
const up = (s) => s.replace(/[a-z]/g, (c) => c.toUpperCase())
const low = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase())
// a variant's name (PascalCase as written) under a rule
export function renameVariant(name, rule) {
  const snake = () => { let s = ''; for (let i = 0; i < name.length; i++) { const c = name[i]; if (i > 0 && c >= 'A' && c <= 'Z') s += '_'; s += low(c) } return s }
  switch (rule) {
    case 'lowercase': return low(name)
    case 'UPPERCASE': return up(name)
    case 'PascalCase': return name
    case 'camelCase': return low(name.slice(0, 1)) + name.slice(1)
    case 'snake_case': return snake()
    case 'SCREAMING_SNAKE_CASE': return up(snake())
    case 'kebab-case': return snake().replace(/_/g, '-')
    case 'SCREAMING-KEBAB-CASE': return up(snake()).replace(/_/g, '-')
    default: return name
  }
}
// a field's name (snake_case as written) under a rule
export function renameField(name, rule) {
  const pascal = () => { let s = '', cap1 = true; for (const c of name) { if (c === '_') cap1 = true; else if (cap1) { s += up(c); cap1 = false } else s += c } return s }
  switch (rule) {
    case 'lowercase': case 'snake_case': return name
    case 'UPPERCASE': case 'SCREAMING_SNAKE_CASE': return up(name)
    case 'PascalCase': return pascal()
    case 'camelCase': { const p = pascal(); return low(p.slice(0, 1)) + p.slice(1) }
    case 'kebab-case': return name.replace(/_/g, '-')
    case 'SCREAMING-KEBAB-CASE': return up(name).replace(/_/g, '-')
    default: return name
  }
}

// ── attributes ──
const strOf = (n) => {
  const t = n.text
  if (n.type === 'raw_string_literal') { const m = /^r(#*)"([\s\S]*)"\1$/.exec(t); return m ? m[2] : null }
  if (n.type !== 'string_literal') return null
  try { return JSON.parse(t.replace(/\\'/g, "'").replace(/\\0/g, '\\u0000').replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)).replace(/["\\]/g, '\\$&'))) } catch { return t.slice(1, -1) }
}
const isStr = (n) => n.type === 'string_literal' || n.type === 'raw_string_literal'
// a token tree's meta items: [{ key, value?: string, list?: [meta] }] (`a`, `a = "x"`, `a(…)`)
function metas(tt) {
  const out = []
  let cur = null, eq = false
  for (let i = 0; i < tt.childCount; i++) {
    const c = tt.child(i)
    if (i === 0 || i === tt.childCount - 1) { if (/^[([{)\]}]$/.test(c.type)) continue }
    // a name, or a keyword the grammar keeps as its own token in a token tree (`default`, `crate`, `type`)
    const word = c.type === 'identifier' || c.type === 'self' || c.type === 'crate' || (!c.isNamed && /^[a-z_]+$/.test(c.type) && c.type === c.text)
    if (word) { if (eq && cur) { cur.value = c.text; eq = false } else { cur = { key: c.text }; out.push(cur) } continue }
    if (c.type === '=') { eq = true; continue }
    if (c.type === ',') { cur = null; eq = false; continue }
    if (isStr(c)) { if (cur && eq) cur.value = strOf(c); eq = false; continue }
    if (c.type === 'boolean_literal') { if (cur && eq) cur.value = c.text; eq = false; continue }
    if (c.type === 'token_tree') { if (cur && !eq) cur.list = metas(c); eq = false; continue }
    if (c.type === '::') { if (cur) { const prev = cur; out.pop(); const nx = tt.child(i + 1); if (nx && nx.type === 'identifier') { cur = { key: `${prev.key}::${nx.text}` }; out.push(cur); i++ } } continue }
  }
  return out
}
// an attribute_item → { name, args: token_tree | null }
function attrOf(item) {
  const a = named(item)[0]
  if (!a || a.type !== 'attribute') return null
  const head = named(a)[0]
  return { name: head ? head.text : '', args: field(a, 'arguments') }
}
// the serde metas of a list of attributes: Map(key → meta), later ones winning
function serdeOf(attrs) {
  const out = new Map()
  for (const a of attrs) if (a && a.name === 'serde' && a.args) for (const m of metas(a.args)) out.set(m.key, m)
  return out
}
// a name meta's stored value: `rename = "x"`, or `rename(serialize = "x", deserialize = "y")`'s serialize
const said = (m) => (!m ? null : m.value !== undefined ? m.value : m.list ? (m.list.find((x) => x.key === 'serialize')?.value ?? null) : null)
const derivesSerde = (attrs) => attrs.some((a) => a && (a.name === 'derive' || a.name === 'cfg_attr') && a.args && /\b(?:Serialize|Deserialize)\b/.test(a.args.text))
const isTestAttr = (attrs) => attrs.some((a) => a && (/(^|::)test$/.test(a.name) || a.name === 'rstest' || (a.name === 'cfg' && a.args && /^\(\s*test\s*\)$/.test(a.args.text))))

// ── types ──
const NUM = new Set(['i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'f32', 'f64', 'Decimal', 'BigDecimal', 'NonZeroU32', 'NonZeroU64', 'NonZeroUsize'])
const STR = new Set(['String', 'str', 'char', 'Uuid', 'Ulid'])
const ANY = new Set(['Value', 'JsonValue'])
const LIST = new Set(['Vec', 'VecDeque', 'HashSet', 'BTreeSet', 'IndexSet', 'LinkedList', 'BinaryHeap', 'SmallVec'])
const MAP = new Set(['HashMap', 'BTreeMap', 'IndexMap'])
const WRAP = new Set(['Box', 'Rc', 'Arc', 'Cow', 'RefCell', 'Cell', 'Mutex', 'RwLock'])
const lastSeg = (n) => (n.type === 'scoped_type_identifier' || n.type === 'scoped_identifier' ? (field(n, 'name')?.text ?? n.text.split('::').pop()) : n.text.split('::').pop())
const typeArgs = (g) => { const ta = field(g, 'type_arguments'); return ta ? named(ta).filter((x) => x.type !== 'lifetime') : [] }
// a type node → { t, nullable }
function rtype(n, depth = 0) {
  if (!n || depth > 16) return { t: { k: 'any' }, nullable: false }
  switch (n.type) {
    case 'primitive_type': return { t: { k: n.text === 'bool' ? 'bool' : NUM.has(n.text) ? 'number' : STR.has(n.text) ? 'string' : 'any' }, nullable: false }
    case 'reference_type': return rtype(field(n, 'type'), depth + 1)
    case 'array_type': return { t: { k: 'list', of: rtype(field(n, 'element'), depth + 1).t }, nullable: false }
    case 'tuple_type': return { t: { k: 'list', of: { k: 'any' } }, nullable: false }
    case 'type_identifier': case 'scoped_type_identifier': {
      const name = lastSeg(n)
      if (name === 'bool') return { t: { k: 'bool' }, nullable: false }
      if (NUM.has(name)) return { t: { k: 'number' }, nullable: false }
      if (STR.has(name)) return { t: { k: 'string' }, nullable: false }
      if (ANY.has(name)) return { t: { k: 'any' }, nullable: false }
      return { t: { k: 'ref', n: name }, nullable: false }
    }
    case 'generic_type': {
      const base = lastSeg(field(n, 'type')), args = typeArgs(n)
      if (base === 'Option') { const r = rtype(args[0], depth + 1); return { t: r.t, nullable: true } }
      if (LIST.has(base)) return { t: { k: 'list', of: rtype(args[0], depth + 1).t }, nullable: false }
      if (MAP.has(base)) return { t: { k: 'map', of: rtype(args[1] || args[0], depth + 1).t }, nullable: false }
      if (WRAP.has(base)) return rtype(args[args.length - 1], depth + 1)
      if (base === 'Box' && args[0]?.type === 'array_type') return rtype(args[0], depth + 1)
      return { t: { k: 'ref', n: base }, nullable: false }
    }
    default: return { t: { k: 'any' }, nullable: false }
  }
}
// the user type a type names, through references and wrappers (Option, Vec, Result's first…), or null
const HOLD = new Set(['Option', 'Result', ...LIST, ...WRAP])
function typeName(n, impl, depth = 0) {
  if (!n || depth > 12) return null
  if (n.type === 'reference_type' || n.type === 'array_type') return typeName(field(n, 'type') || field(n, 'element'), impl, depth + 1)
  if (n.type === 'generic_type') {
    const base = lastSeg(field(n, 'type'))
    if (HOLD.has(base)) { const a = typeArgs(n); return typeName(base === 'Cow' ? a[a.length - 1] : a[0], impl, depth + 1) }
    return base
  }
  if (n.type === 'type_identifier' || n.type === 'scoped_type_identifier') { const t = lastSeg(n); return t === 'Self' ? impl : t }
  return null
}
const NOT_ITEM = new Set(['Self', 'Value', 'HashMap', 'BTreeMap', 'String', 'Vec', 'Option', 'Item', 'AttributeValue', 'Result', 'Error', '_'])
const userType = (t) => (t && /^[A-Z]/.test(t) && !NOT_ITEM.has(t) ? t : null)

function fieldsOf(list, rule, containerDefault, skipped, notes) {
  const out = []
  let pending = []
  for (const c of named(list)) {
    if (c.type === 'attribute_item') { pending.push(attrOf(c)); continue }
    if (c.type !== 'field_declaration') { pending = []; continue }
    const s = serdeOf(pending)
    pending = []
    const ident = (field(c, 'name')?.text || '').replace(/^r#/, '')
    if (!ident) continue
    if (s.has('skip') || s.has('skip_serializing')) { push(skipped, { ident, why: s.has('skip') ? 'skip' : 'skip_serializing' }); continue }
    const tn = field(c, 'type')
    const { t, nullable } = rtype(tn)
    const rename = said(s.get('rename'))
    const name = rename ?? (rule ? renameField(ident, rule) : ident)
    const d = s.get('default')
    const def = d ? (d.value ?? 'Default::default()') : containerDefault ? 'Default::default()' : null
    if (s.has('serialize_with') || s.has('with')) push(notes, `${ident}: serialized by ${said(s.get('serialize_with')) ?? said(s.get('with'))}, its stored type not read`, MAX.notes)
    push(out, { name, ...(name !== ident ? { ident } : {}), raw: cap(tn ? tn.text.replace(/\s+/g, ' ') : ''), t, nullable: nullable || s.has('skip_serializing_if'), default: def, ...(s.has('flatten') ? { flatten: true } : {}), line: lineOf(c) }, MAX.fields)
  }
  return out
}

function structOf(node, attrs, notes) {
  const s = serdeOf(attrs)
  const name = field(node, 'name')?.text
  const body = field(node, 'body')
  const rule = said(s.get('rename_all'))
  const skipped = []
  const out = { name, kind: 'struct', line: lineOf(node), end: endOf(node), serde: derivesSerde(attrs), fields: [] }
  if (rule && !RULES.includes(rule)) push(notes, `${name}: rename_all "${cap(rule, 40)}" is no case style serde knows: names kept as written`, MAX.notes)
  const r = RULES.includes(rule) ? rule : null
  if (body && body.type === 'field_declaration_list') out.fields = fieldsOf(body, r, s.has('default'), skipped, notes)
  else if (body && body.type === 'ordered_field_declaration_list') {
    const ts = named(body).filter((x) => x.type !== 'attribute_item' && x.type !== 'visibility_modifier')
    if (ts.length === 1) { const { t, nullable } = rtype(ts[0]); out.newtype = { ...t, ...(nullable ? { nullable: true } : {}) } }
  }
  const tag = said(s.get('tag'))
  if (tag) out.tag = tag
  if (s.has('transparent') && out.fields.length === 1) { out.newtype = out.fields[0].t; out.fields = [] }
  if (skipped.length) out.skipped = skipped
  return out
}

function enumOf(node, attrs, notes) {
  const s = serdeOf(attrs)
  const name = field(node, 'name')?.text
  const rule0 = said(s.get('rename_all')), rule = RULES.includes(rule0) ? rule0 : null
  const fieldsRule0 = said(s.get('rename_all_fields')), fieldsRule = RULES.includes(fieldsRule0) ? fieldsRule0 : null
  const out = { name, kind: 'enum', line: lineOf(node), end: endOf(node), serde: derivesSerde(attrs), fields: [], variants: [] }
  const tag = said(s.get('tag')), content = said(s.get('content'))
  if (tag) out.tag = tag
  if (content) out.content = content
  if (s.has('untagged')) out.untagged = true
  const body = field(node, 'body')
  let pending = []
  const skipped = []
  for (const c of body ? named(body) : []) {
    if (c.type === 'attribute_item') { pending.push(attrOf(c)); continue }
    if (c.type !== 'enum_variant') { pending = []; continue }
    const vs = serdeOf(pending)
    pending = []
    const ident = field(c, 'name')?.text
    if (!ident) continue
    if (vs.has('skip') || vs.has('skip_serializing')) { push(skipped, { ident, why: vs.has('skip') ? 'skip' : 'skip_serializing' }); continue }
    const vname = said(vs.get('rename')) ?? (rule ? renameVariant(ident, rule) : ident)
    const vrule0 = said(vs.get('rename_all')), vrule = RULES.includes(vrule0) ? vrule0 : fieldsRule
    const v = { name: vname, ...(vname !== ident ? { ident } : {}), line: lineOf(c) }
    const vb = field(c, 'body')
    if (!vb) v.unit = true
    else if (vb.type === 'field_declaration_list') v.fields = fieldsOf(vb, vrule, false, [], notes)
    else if (vb.type === 'ordered_field_declaration_list') {
      const ts = named(vb).filter((x) => x.type !== 'attribute_item' && x.type !== 'visibility_modifier')
      v.t = ts.length === 1 ? rtype(ts[0]).t : { k: 'list', of: { k: 'any' } }
    }
    push(out.variants, v, MAX.fields)
  }
  if (skipped.length) out.skipped = skipped
  return out
}

// ── uses ──
const FORMAT = new Set(['format', 'format_args'])
// a format string's parts: literal text and null for each {…} the code fills in
function formatParts(s) {
  const parts = []
  let lit = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' && s[i + 1] === '{') { lit += '{'; i++; continue }
    if (s[i] === '}' && s[i + 1] === '}') { lit += '}'; i++; continue }
    if (s[i] === '{') { const j = s.indexOf('}', i); if (j < 0) { lit += s.slice(i); break } parts.push(lit, null); lit = ''; i = j; continue }
    lit += s[i]
  }
  parts.push(lit)
  return parts
}
const ENV_CALL = /(?:^|::)env::var(?:_os)?$|^(?:dotenvy?|dotenv)::var$/

function scanUses(root, ctx, sink) {
  // sink: { names, env, uses, converts?, vars? }
  const consumed = new Set()
  each(root, (n) => {
    if (n.type === 'function_item' && n !== root && ctx.nested) return false
    if (n.type === 'attribute_item') return false
    if (n.type === 'macro_invocation') {
      const m = field(n, 'macro')
      const mname = m ? m.text.split('::').pop() : ''
      const tt = named(n).find((x) => x.type === 'token_tree')
      if (tt && FORMAT.has(mname)) {
        const first = named(tt).find(isStr)
        if (first) { consumed.add(first.startIndex); const v = strOf(first); const p = v === null ? null : codeName(formatParts(v)); if (p) push(sink.names, { text: p, line: lineOf(first) }) }
      }
      if (tt && (mname === 'env' || mname === 'option_env')) { const first = named(tt).find(isStr); if (first) { consumed.add(first.startIndex); const v = strOf(first); if (v) push(sink.env, { name: v, line: lineOf(first) }) } }
      return true
    }
    if (isStr(n)) {
      if (consumed.has(n.startIndex)) return false
      const v = strOf(n)
      const p = v === null ? null : codeName([v])
      if (p) push(sink.names, { text: p, line: lineOf(n) })
      return false
    }
    if (n.type === 'call_expression') {
      const fn = field(n, 'function')
      if (fn && ENV_CALL.test(fn.text.replace(/\s+/g, ''))) {
        const a = field(n, 'arguments'), first = a ? named(a)[0] : null
        if (first && isStr(first)) { consumed.add(first.startIndex); const v = strOf(first); if (v) push(sink.env, { name: v, line: lineOf(first) }) }
      }
      if (sink.converts) conversion(n, ctx, sink)
      return true
    }
    if (n.type === 'identifier' && CONST_NAME.test(n.text) && sink.uses.length < MAX.per && !sink.uses.includes(n.text)) sink.uses.push(n.text)
    return true
  })
}

// the type an expression's value has, when the function states it
function exprType(e, ctx, depth = 0) {
  if (!e || depth > 8) return null
  switch (e.type) {
    case 'identifier': return ctx.vars.get(e.text) ?? null
    case 'self': return ctx.impl
    case 'reference_expression': return exprType(field(e, 'value'), ctx, depth + 1)
    case 'parenthesized_expression': case 'unary_expression': return exprType(named(e)[0], ctx, depth + 1)
    case 'struct_expression': { const n = field(e, 'name'); return n ? (lastSeg(n) === 'Self' ? ctx.impl : lastSeg(n)) : null }
    case 'call_expression': {
      const f = field(e, 'function')
      if (f && f.type === 'field_expression' && /^(?:clone|as_ref|to_owned|borrow|deref)$/.test(field(f, 'field')?.text || '')) return exprType(field(f, 'value'), ctx, depth + 1)
      return null
    }
    default: return null
  }
}
// the type a `from_…` call's result is given: the let it is assigned to (through `?`, `.await`, a
// method on it), else the function's return type
function resultType(call, ctx) {
  let n = call
  for (let i = 0; i < 6 && n.parent; i++) {
    const p = n.parent
    if (p.type === 'let_declaration') { const t = field(p, 'type'); return t ? typeName(t, ctx.impl) : null }
    if (!/^(?:try_expression|await_expression|parenthesized_expression|field_expression|call_expression)$/.test(p.type)) break
    if (p.type === 'call_expression' && field(p, 'function') !== n) break
    n = p
  }
  return ctx.ret
}
function conversion(c, ctx, sink) {
  let fn = field(c, 'function'), targs = null
  if (!fn) return
  if (fn.type === 'generic_function') { targs = field(fn, 'type_arguments'); fn = field(fn, 'function') }
  let name = null, path = null, recv = null
  if (fn.type === 'identifier') name = fn.text
  else if (fn.type === 'scoped_identifier') { name = field(fn, 'name')?.text; path = field(fn, 'path') }
  else if (fn.type === 'field_expression') { name = field(fn, 'field')?.text; recv = field(fn, 'value') }
  if (!name || !CONV.test(name)) return
  let type = null
  if (targs) { const ts = named(targs).filter((x) => x.text !== '_' && x.type !== 'lifetime'); type = ts.length ? typeName(ts[ts.length - 1], ctx.impl) : null }
  else if (path && /^[A-Z]/.test(lastSeg(path))) type = lastSeg(path) === 'Self' ? ctx.impl : lastSeg(path)
  else if (recv) type = exprType(recv, ctx)
  else if (/^(?:try_)?(?:to|into)_/.test(name)) { const a = field(c, 'arguments'); type = a ? exprType(named(a)[0], ctx) : null }
  else type = resultType(c, ctx)
  type = userType(type)
  if (type) push(sink.converts, { type, line: lineOf(c), how: name })
}

// the variables a function states the type of: its parameters, typed lets, struct literals, for loops
function varsOf(fnNode, impl) {
  const vars = new Map()
  const params = field(fnNode, 'parameters')
  for (const p of params ? named(params) : []) {
    if (p.type === 'self_parameter') { vars.set('self', impl); continue }
    if (p.type !== 'parameter') continue
    const pat = field(p, 'pattern'), t = typeName(field(p, 'type'), impl)
    if (pat && pat.type === 'identifier' && t) vars.set(pat.text, t)
  }
  const body = field(fnNode, 'body')
  if (body) each(body, (n) => {
    if (n.type === 'let_declaration') {
      const pat = field(n, 'pattern'), t = field(n, 'type'), v = field(n, 'value')
      if (pat && pat.type === 'identifier') {
        const ty = t ? typeName(t, impl) : v && v.type === 'struct_expression' && field(v, 'name') ? lastSeg(field(v, 'name')) : null
        if (ty) vars.set(pat.text, ty === 'Self' ? impl : ty)
      }
    } else if (n.type === 'for_expression') {
      const pat = field(n, 'pattern'), v = field(n, 'value')
      if (pat && pat.type === 'identifier' && v && v.type === 'identifier' && vars.has(v.text)) vars.set(pat.text, vars.get(v.text))
    } else if (n.type === 'closure_parameters') {
      for (const p of named(n)) if (p.type === 'parameter') { const pat = field(p, 'pattern'), t = typeName(field(p, 'type'), impl); if (pat && t) vars.set(pat.text, t) }
    }
    return true
  })
  return vars
}

export function readRust(tree) {
  const types = [], consts = [], fns = [], notes = []
  const convImpl = new Map() // type → the line of its conversion method
  const walk = (list, ctx) => {
    let pending = []
    for (const c of named(list)) {
      if (c.type === 'attribute_item') { pending.push(attrOf(c)); continue }
      const attrs = pending
      pending = []
      if (c.type === 'struct_item' && field(c, 'name')) { push(types, structOf(c, attrs, notes), MAX.types); continue }
      if (c.type === 'enum_item' && field(c, 'name')) { push(types, enumOf(c, attrs, notes), MAX.types); continue }
      if (c.type === 'function_item') { fnOf(c, attrs, ctx); continue }
      if (c.type === 'mod_item') { const b = field(c, 'body'); if (b) walk(b, { ...ctx, test: ctx.test || isTestAttr(attrs) }); continue }
      if (c.type === 'impl_item') {
        const ty = field(c, 'type'), tr = field(c, 'trait')
        const self = typeName(ty, null)
        if (tr && /^(?:Try)?From$/.test(lastSeg(tr.type === 'generic_type' ? field(tr, 'type') : tr)) && /\bAttributeValue\b/.test(c.text.slice(0, (field(c, 'body')?.startIndex ?? c.endIndex) - c.startIndex))) {
          const own = userType(self)
          const arg = tr.type === 'generic_type' ? userType(typeName(typeArgs(tr)[0], self)) : null
          const t = own && !/^HashMap$/.test(self) ? own : arg
          if (t && !convImpl.has(t)) convImpl.set(t, lineOf(c))
        }
        const b = field(c, 'body')
        if (b) {
          for (const m of named(b)) if (m.type === 'function_item' && CONV.test(field(m, 'name')?.text || '') && userType(self) && !convImpl.has(self)) convImpl.set(self, lineOf(m))
          walk(b, { ...ctx, impl: self })
        }
        continue
      }
      if ((c.type === 'const_item' || c.type === 'static_item') && field(c, 'name')) {
        const v = field(c, 'value')
        if (!v) continue
        const sink = { names: [], env: [], uses: [] }
        scanUses(v, { vars: new Map(), impl: ctx.impl, ret: null }, sink)
        if (sink.names.length || sink.env.length) push(consts, { name: field(c, 'name').text, line: lineOf(c), names: sink.names, env: sink.env, ...(ctx.test ? { test: true } : {}) }, MAX.fns)
        continue
      }
    }
  }
  const fnOf = (c, attrs, ctx) => {
    const name = field(c, 'name')?.text
    if (!name) return
    const vars = varsOf(c, ctx.impl)
    const ret = typeName(field(c, 'return_type'), ctx.impl)
    const sink = { names: [], env: [], uses: [], converts: [] }
    const body = field(c, 'body')
    if (body) scanUses(body, { vars, impl: ctx.impl, ret: userType(ret) }, sink)
    push(fns, { name: ctx.impl ? `${ctx.impl}::${name}` : name, line: lineOf(c), end: endOf(c), ...(ctx.test || isTestAttr(attrs) ? { test: true } : {}), converts: sink.converts, names: sink.names, env: sink.env, uses: sink.uses }, MAX.fns)
  }
  walk(tree.rootNode, { test: false, impl: null })
  for (const t of types) if (convImpl.has(t.name)) t.converts = convImpl.get(t.name)
  // a type no serde derive shapes and no code converts tells the binding nothing: left out
  const converted = new Set([...fns.flatMap((f) => f.converts.map((x) => x.type)), ...convImpl.keys()])
  return { lang: 'rust', types: types.filter((t) => t.serde || converted.has(t.name)), consts, fns: fns.filter((f) => f.converts.length || f.names.length || f.env.length || f.uses.length), notes }
}

export default {
  id: 'serde',
  version: 1,
  kind: 'code',
  scope: 'file',
  lang: 'rust',
  wants: (p) => RS.test(p),
  level: (p, text) => rustLevel(text),
  discover: (info) => [...info].filter(([p, i]) => RS.test(p) && i.ddl === 1).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    if (ctx.aside) return ctx.aside('serde', file, text)
    const tree = ctx.tree('rust', text)
    try { return codeFacts({ path: file, ...readRust(tree) }) } finally { tree.delete?.() }
  },
}
