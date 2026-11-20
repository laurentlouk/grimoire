// grimoire graph · extraction. One parsed file → its symbols, call/inheritance refs and imports,
// still unresolved: resolve.mjs turns names into edges once every file of the repo is known.
import { LANGS, nameOf, calleeOf, bare } from './langs.mjs'
import { bindingsOf, varName, fieldBindings, localsOf } from './bindings.mjs'

const CALLABLE = new Set(['function', 'method', 'constructor', 'macro'])
// A function declared directly in one of these is a method (modules and namespaces do not count).
const CLASSY = new Set(['class', 'struct', 'interface', 'trait', 'enum', 'protocol', 'object'])
const FIELDED = new Set(['class', 'struct', 'object'])
// what a framework's call in a body declares belongs to the type or module around it (langs.mjs members)
const MEMBER_OWNERS = new Set([...CLASSY, 'module'])
// languages where a method reads a field by its bare name (no `this.`)
const IMPLICIT_THIS = new Set(['java', 'kotlin', 'csharp', 'swift', 'cpp'])
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*[!?]?$/u
// A definition's signature: its first line up to its body (name, parameters, return type), with
// no literal's value and no comment in it (langs.mjs bare), at most 160 characters. The body is
// the `body` field, a C macro's `value` (unparsed text), or the last child in Kotlin, whose
// grammar names no field.
const KOTLIN_BODY = /^(function_body|class_body|enum_class_body)$/
// A field's body is its value (`TIMEOUT: int = 60` → `TIMEOUT: int`); a member a framework call
// declares ends before its block or lambda (`scope :active, -> {…}` → `scope :active`).
const named = (n) => { const out = []; for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i)); return out }
const bodyOf = (n, kind) => {
  if (kind === 'field') return n.childForFieldName('right') || n.childForFieldName('value')
  if (kind === 'member') { const a = n.childForFieldName('arguments'); return n.childForFieldName('block') || (a && named(a).find((c) => /^(lambda|block|do_block)$/.test(c.type))) || null }
  const last = n.lastNamedChild
  return n.childForFieldName('body') || (n.type.startsWith('preproc_') && n.childForFieldName('value')) || (last && KOTLIN_BODY.test(last.type) ? last : null)
}
const signature = (n, kind) => {
  const nl = n.text.indexOf('\n'), body = bodyOf(n, kind)
  let to = nl < 0 ? n.endIndex : n.startIndex + nl
  if (body && body.startIndex > n.startIndex) to = Math.min(to, body.startIndex)
  return bare(n, to).replace(/\s+/g, ' ').replace(kind === 'member' ? /\s*[,:]?\s*$/ : /\s*[{:=]\s*$/, '').trim().slice(0, 160)
}

// ── values: a function or method named where a value goes, not called ──
// The positions a value sits in: a call's arguments (a decorator's too), an assignment's or a
// declaration's right side, a return, a JSX attribute, a struct literal. Each is read through its
// containers (an array, an object or a dictionary, a pair's value, a keyword argument) down to a bare
// name or a plain dotted path; anything else (a call, a lambda, an operator) is not a value use here,
// and its own calls are walked as usual. resolve.mjs links a name only to a function or method it
// resolves by syntax (same class, typed, qualified, import, same file or package), never by name alone.
const VALUE_RIGHT = new Set(['assignment', 'assignment_expression', 'assignment_statement', 'short_var_declaration', 'augmented_assignment'])
const VALUE_FIELD = new Set(['variable_declarator', 'var_spec', 'let_declaration', 'init_declarator', 'public_field_definition', 'field_definition', 'const_spec'])
const VALUE_ALL = new Set(['return_statement', 'return_expression', 'jsx_expression'])
const CONTAINER = /^(array|list|tuple|set|object|dictionary|expression_list|literal_value|array_expression|tuple_expression|collection_literal|array_literal|initializer_list|parenthesized_expression)$/
const BARE = /^(identifier|simple_identifier|shorthand_property_identifier)$/
const MEMBER = /^(member_expression|attribute|selector_expression|field_expression|scoped_identifier|field_access|member_access_expression|navigation_expression|method_reference|callable_reference)$/
const PATH = /^[\p{L}_$][\p{L}\p{N}_$]*(\s*(\.|::|->|\?\.)\s*[\p{L}_$][\p{L}\p{N}_$]*)*$/u
const SELFISH = /^(self|this|Self|super|cls)$/
const FN_VALUE = /^(arrow_function|function_expression|function|generator_function)$/
function valueSlots(node, isCall) {
  const t = node.type
  if (isCall) {
    let args = node.childForFieldName('arguments')
    if (!args) { const suffix = named(node).find((c) => c.type === 'call_suffix'); args = suffix ? named(suffix).find((c) => c.type === 'value_arguments') : null } // Kotlin
    const out = args ? named(args) : []
    if (t === 'composite_literal' && node.childForFieldName('body')) out.push(node.childForFieldName('body')) // Go `Handler{Fn: list}`
    return out
  }
  if (VALUE_RIGHT.has(t)) {
    const l = node.childForFieldName('left'), r = node.childForFieldName('right')
    return r && !(l && /^(module\.exports|exports)\b/.test(l.text)) ? [r] : [] // a CommonJS export names its own functions, it does not use them
  }
  if (VALUE_FIELD.has(t)) { const v = node.childForFieldName('value'); return v && !FN_VALUE.test(v.type) ? [v] : [] }
  if (VALUE_ALL.has(t)) return named(node)
  return []
}
function valueNames(v, spec, out = [], d = 0) {
  if (!v || d > 4) return out
  const t = v.type
  if (BARE.test(t)) { if (spec.bareValues !== false) out.push({ name: v.text, qual: '' }); return out }
  if (MEMBER.test(t)) {
    const c = calleeOf(v)
    if (c && c.name && c.qual && PATH.test(c.qual)) out.push({ name: c.name, qual: c.qual.replace(/\s+/g, '') })
    else if (c && c.name && !c.qual && /^(method_reference|callable_reference)$/.test(t)) out.push({ name: c.name, qual: '' }) // Kotlin `::handle`
    return out
  }
  if (CONTAINER.test(t)) { for (const c of named(v)) valueNames(c, spec, out, d + 1); return out }
  if (t === 'pair' || t === 'keyword_argument' || t === 'field_initializer') return valueNames(v.childForFieldName('value'), spec, out, d + 1)
  if (t === 'keyed_element') { const ch = named(v); return ch.length > 1 ? valueNames(ch[ch.length - 1], spec, out, d + 1) : out } // Go: key, then value
  if (t === 'argument' || t === 'value_argument') return valueNames(v.lastNamedChild, spec, out, d + 1)
  if (t === 'literal_element' || t === 'shorthand_field_initializer' || t === 'jsx_expression') return valueNames(v.firstNamedChild, spec, out, d + 1)
  return out
}

// file: the file's repository path, which names a definition that has no name of its own (a default export).
export function extract(tree, lang, isTestFile, file = null) {
  const spec = LANGS[lang].spec
  const symbols = [], refs = [], imports = []
  const seen = new Set()
  const ref = (r) => { const k = `${r.src}|${r.kind}|${r.name}|${r.qual}|${r.fromType || ''}`; if (!seen.has(k)) { seen.add(k); refs.push(r) } }
  // A call on a variable whose type the syntax states carries that type (see bindings.mjs).
  const typed = (qual, ctx) => (qual && ctx.types.get(varName(qual))) || null

  // ctx: parent = enclosing symbol index (-1 = file), fn = enclosing callable (the caller of a
  // call found here), scopeType = the type an impl/extension block attaches its members to,
  // types = variable → type name, one map per callable scope.
  const walk = (node, ctx) => {
    const t = node.type
    const line = node.startPosition.row + 1
    for (const [v, ty] of bindingsOf(node, spec)) ctx.types.set(v, ty)
    // the names a callable binds (parameters, locals, loop variables): a value by that name is the local
    if (ctx.locals) for (const v of localsOf(node)) ctx.locals.add(varName(v))

    const found = spec.imports[t] ? spec.imports[t](node).filter((i) => i && i.source) : []
    for (const i of found) imports.push({ ...i, names: (i.names || []).filter(Boolean), line })

    const call = !found.length && spec.calls[t] // `require('x')` is an import, not a call
    const local = (name) => !!(ctx.locals && ctx.locals.has(varName(name)))
    // a function or method named as a value (resolve.mjs links it as REFERENCES)
    const value = (c) => {
      if (!c.name || !IDENT.test(c.name) || SELFISH.test(c.name)) return
      const head = c.qual ? c.qual.split(/\.|::|->|\?\./)[0] : null, qtype = c.qual ? typed(c.qual, ctx) : null
      // a local's own property, its type unknown (`row.id`), or a local named like a function
      if (c.qual ? !SELFISH.test(head) && local(head) && !qtype : local(c.name)) return
      ref({ kind: 'ref', name: c.name, qual: (c.qual || '').slice(0, 80), qtype, line, src: ctx.fn })
    }
    if (call) {
      const c = (spec.callee && spec.callee(node)) || calleeOf(call[0] ? node.childForFieldName(call[0]) : node)
      if (c && c.name && IDENT.test(c.name)) ref({ kind: call[1], name: c.name, qual: (c.qual || '').slice(0, 80), qtype: typed(c.qual, ctx), line, src: ctx.fn })
      // `send_welcome.delay(…)`, `handler.apply_async()`, `on_save.send()`: a call on a function is a use
      // of that function as a value (a task queued, a signal sent)
      if (c && c.qual && IDENT.test(c.qual) && !SELFISH.test(c.qual) && spec.bareValues !== false) value({ name: c.qual, qual: '' })
      // Ruby: a lowercase receiver that is no local is a call on self (`active.order(…)`, `user.name`)
      else if (c && c.qual && spec.bareValues === false && /^[\p{Ll}_][\p{L}\p{N}_]*[!?]?$/u.test(c.qual) && !SELFISH.test(c.qual) && !local(c.qual)) ref({ kind: 'call', name: c.qual, qual: '', qtype: null, line, src: ctx.fn })
    }
    if (!found.length) for (const v of valueSlots(node, !!call)) for (const c of valueNames(v, spec)) value(c)
    if (spec.tokenCalls && spec.tokenCalls[t]) for (const c of spec.tokenCalls[t](node)) if (IDENT.test(c.name)) ref({ kind: 'call', name: c.name, qual: c.qual, qtype: typed(c.qual, ctx), line, src: ctx.fn })

    const d = spec.defs[t]
    let kind = typeof d === 'function' ? d(node) : d || null
    const sc = spec.scopes && spec.scopes[t] ? spec.scopes[t](node) : null
    // a framework's declaration in a class or module body (langs.mjs members): a method of that type
    const ownerSym = ctx.parent >= 0 ? symbols[ctx.parent] : null
    const mem = !kind && spec.members && spec.members[t] && ownerSym && MEMBER_OWNERS.has(ownerSym.kind) ? spec.members[t](node) : null
    if (!mem && spec.valueRefs && spec.valueRefs[t]) for (const c of spec.valueRefs[t](node)) value(c)
    let next = ctx
    if (mem) {
      const names = [...new Set(mem.names)].filter((x) => IDENT.test(x))
      for (const name of names) {
        const idx = symbols.length
        symbols.push({
          kind: 'method', name, qualname: `${ownerSym.qualname}.${name}`, parent: ctx.parent, container: null,
          line, endLine: node.endPosition.row + 1, signature: signature(node, 'member'), isTest: isTestFile, via: 'framework',
        })
        // `scope :active, -> { where(…) }`, `define_method(:x) do … end`: the block is that method's body
        if (mem.owns && names.length === 1) next = { parent: idx, fn: idx, scopeType: null, scopeOwner: -2, types: new Map(ctx.types), locals: new Set() }
      }
    } else if (kind) {
      const name = (spec.name || nameOf)(node, file)
      if (name && (IDENT.test(name) || kind === 'namespace')) {
        const parentSym = ctx.parent >= 0 ? symbols[ctx.parent] : null
        const scopeType = (sc && sc.type) || (ctx.parent === ctx.scopeOwner ? ctx.scopeType : null) || (spec.container && spec.container(node)) || null
        if (kind === 'function' && ((parentSym && CLASSY.has(parentSym.kind)) || scopeType)) kind = 'method'
        const container = scopeType || (parentSym && parentSym.kind !== 'namespace' ? parentSym.qualname : null)
        const idx = symbols.length
        symbols.push({
          kind, name, qualname: container ? `${container}.${name}` : name,
          parent: scopeType ? -1 : ctx.parent, container: scopeType || null,
          line, endLine: node.endPosition.row + 1, signature: signature(node, kind),
          isTest: isTestFile || !!(spec.isTest && spec.isTest(node, name)),
        })
        for (const s of (spec.supers ? spec.supers(node) : [])) if (s.name && IDENT.test(s.name)) ref({ kind: s.kind, name: s.name, qual: '', line, src: idx })
        // a class's own scope: its fields' types (bindings.mjs fieldBindings), as `this.f` / `self.f`
        // (and the bare name where a language reads a field without `this`), seen by its methods
        let types = CALLABLE.has(kind) ? new Map(ctx.types) : ctx.types
        if (FIELDED.has(kind)) {
          types = new Map(ctx.types)
          for (const [f, t] of fieldBindings(node, spec)) { for (const pre of ['this.', 'self.', 'this->']) types.set(`${pre}${f}`, t); if (IMPLICIT_THIS.has(lang)) types.set(f, t) }
        }
        const locals = CALLABLE.has(kind) ? new Set(ctx.locals || []) : ctx.locals
        next = { parent: idx, fn: CALLABLE.has(kind) ? idx : ctx.fn >= 0 ? ctx.fn : idx, scopeType: null, scopeOwner: -2, types, locals }
      }
    } else if (sc && sc.type) {
      if (sc.super) ref({ kind: 'implements', name: sc.super, qual: '', line, src: -1, fromType: sc.type })
      next = { ...ctx, scopeType: sc.type, scopeOwner: ctx.parent }
    }
    for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), next)
  }
  walk(tree.rootNode, { parent: -1, fn: -1, scopeType: null, scopeOwner: -2, types: new Map(), locals: null })
  return { symbols, refs, imports }
}
