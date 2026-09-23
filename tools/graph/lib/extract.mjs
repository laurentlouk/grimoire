// grimoire graph · extraction. One parsed file → its symbols, call/inheritance refs and imports,
// still unresolved: resolve.mjs turns names into edges once every file of the repo is known.
import { LANGS, nameOf, calleeOf } from './langs.mjs'
import { bindingsOf, varName } from './bindings.mjs'

const CALLABLE = new Set(['function', 'method', 'constructor', 'macro'])
// A function declared directly in one of these is a method (modules and namespaces do not count).
const CLASSY = new Set(['class', 'struct', 'interface', 'trait', 'enum', 'protocol', 'object'])
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*[!?]?$/u
const signature = (n) => n.text.split('\n', 1)[0].replace(/\s*[{:=]\s*$/, '').trim().slice(0, 160)

export function extract(tree, lang, isTestFile) {
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

    const found = spec.imports[t] ? spec.imports[t](node).filter((i) => i && i.source) : []
    for (const i of found) imports.push({ ...i, names: (i.names || []).filter(Boolean), line })

    const call = !found.length && spec.calls[t] // `require('x')` is an import, not a call
    if (call) {
      const c = (spec.callee && spec.callee(node)) || calleeOf(call[0] ? node.childForFieldName(call[0]) : node)
      if (c && c.name && IDENT.test(c.name)) ref({ kind: call[1], name: c.name, qual: (c.qual || '').slice(0, 80), qtype: typed(c.qual, ctx), line, src: ctx.fn })
    }
    if (spec.tokenCalls && spec.tokenCalls[t]) for (const c of spec.tokenCalls[t](node)) if (IDENT.test(c.name)) ref({ kind: 'call', name: c.name, qual: c.qual, qtype: typed(c.qual, ctx), line, src: ctx.fn })

    const d = spec.defs[t]
    let kind = typeof d === 'function' ? d(node) : d || null
    const sc = spec.scopes && spec.scopes[t] ? spec.scopes[t](node) : null
    let next = ctx
    if (kind) {
      const name = (spec.name || nameOf)(node)
      if (name && (IDENT.test(name) || kind === 'namespace')) {
        const parentSym = ctx.parent >= 0 ? symbols[ctx.parent] : null
        const scopeType = (sc && sc.type) || (ctx.parent === ctx.scopeOwner ? ctx.scopeType : null)
        if (kind === 'function' && ((parentSym && CLASSY.has(parentSym.kind)) || scopeType)) kind = 'method'
        const container = scopeType || (parentSym && parentSym.kind !== 'namespace' ? parentSym.qualname : null)
        const idx = symbols.length
        symbols.push({
          kind, name, qualname: container ? `${container}.${name}` : name,
          parent: scopeType ? -1 : ctx.parent, container: scopeType || null,
          line, endLine: node.endPosition.row + 1, signature: signature(node),
          isTest: isTestFile || !!(spec.isTest && spec.isTest(node, name)),
        })
        for (const s of (spec.supers ? spec.supers(node) : [])) if (s.name && IDENT.test(s.name)) ref({ kind: s.kind, name: s.name, qual: '', line, src: idx })
        next = { parent: idx, fn: CALLABLE.has(kind) ? idx : ctx.fn >= 0 ? ctx.fn : idx, scopeType: null, scopeOwner: -2, types: CALLABLE.has(kind) ? new Map(ctx.types) : ctx.types }
      }
    } else if (sc && sc.type) {
      if (sc.super) ref({ kind: 'implements', name: sc.super, qual: '', line, src: -1, fromType: sc.type })
      next = { ...ctx, scopeType: sc.type, scopeOwner: ctx.parent }
    }
    for (let i = 0; i < node.namedChildCount; i++) walk(node.namedChild(i), next)
  }
  walk(tree.rootNode, { parent: -1, fn: -1, scopeType: null, scopeOwner: -2, types: new Map() })
  return { symbols, refs, imports }
}
