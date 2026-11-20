// grimoire graph · API contracts: GraphQL schemas and operations, protobuf services and messages.
//
// The pinned parser runtime has no GraphQL or protobuf grammar, and both languages are small, so
// they are read here by hand: one linear tokenizer each, a recursive descent over the tokens, capped
// (MAX_SYMBOLS, MAX_SELECTS per file), never a backtracking regular expression.
//
//   GraphQL  type · input · union · scalar → `type`; interface → `interface`; enum → `enum`; a type's
//            fields (with `extend type`, attached to the type they extend) → `field`; a named
//            operation or a fragment (`query GetUser`, `fragment F on User`) → `operation`, whose
//            selections link to the fields they select (CALLS, `qualified`: the root type, then each
//            field's declared type, as the syntax states them)
//   protobuf message → `type` (nested ones inside it); enum → `enum`; a message's fields → `field`;
//            service → `interface`; rpc → `method`; `import "x.proto"` → an import
//
// Then the code that implements a contract, as leads (IMPLEMENTS edges from the code to the contract,
// linkContracts, run by resolve.mjs), from hints a lexical scan of the code leaves in its refs (kind
// `contract`, contractHints):
//   GraphQL  an Apollo-style resolver map (`resolvers = { Query: { user: … } }`: each key under a
//            type name), NestJS `@Query()` / `@Mutation()` / `@Subscription()` / `@ResolveField()`
//            methods (in a `@Resolver(() => T)` class) and `@ObjectType()` classes, strawberry
//            `@strawberry.field` methods and `@strawberry.type` classes, graphene `resolve_<field>`
//            methods and `<field> = SomeMutation.Field()` (a field named in snake case is its camel
//            case), graphene ObjectType subclasses by name. `contract` when the syntax names the type
//            (or the class is named like it); `contract-name` when only the field's name ties them
//            (a name guess, ≤ 3 candidates)
//   protobuf a class or struct named after its service by the generated code: a subclass of
//            `XServicer` (Python), `XImplBase` / `XCoroutineImplBase` (Java, Kotlin), `X.XBase` (C#),
//            a struct embedding `UnimplementedXServer` (Go), a class implementing `IXServer` or
//            extending `UnimplementedXService` (TypeScript), NestJS `@GrpcMethod('X', 'M')`: the class
//            implements the service (`contract`), and its methods named like an rpc (or its lower
//            camel case) implement that rpc
import { masked, lineAt, closing, objectEntries, camel } from './lex.mjs'

const MAX_SYMBOLS = 50_000
const MAX_SELECTS = 20_000
const ROOTS = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }

// ── tokens ──
// [{ t: 'name' | 'num' | 'str' | 'p' (punctuation), v, line }]
function tokens(src, lang) {
  const out = []
  const n = src.length
  let i = 0, line = 1
  const gql = lang === 'graphql'
  while (i < n) {
    const c = src[i]
    if (c === '\n') { line++; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === ',' && gql || c === '﻿') { i++; continue }
    if (gql && c === '#') { while (i < n && src[i] !== '\n') i++; continue }
    if (!gql && c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (!gql && c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++ } i += 2; continue }
    if (gql && c === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      const at = line
      i += 3
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) { if (src[i] === '\\') i++; else if (src[i] === '\n') line++; i++ }
      i += 3
      out.push({ t: 'str', v: '"…"', line: at }); continue
    }
    if (c === '"' || (!gql && c === "'")) {
      const at = line
      i++
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') i++; i++ }
      i++
      out.push({ t: 'str', v: `${c}…${c}`, line: at }); continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w]/.test(src[j]) || (!gql && src[j] === '.' && /[A-Za-z_]/.test(src[j + 1] || ''))) j++
      out.push({ t: 'name', v: src.slice(i, j), line }); i = j; continue
    }
    if (/[0-9-]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w.+-]/.test(src[j])) j++
      out.push({ t: 'num', v: src.slice(i, j).slice(0, 24), line }); i = j; continue
    }
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') { out.push({ t: 'p', v: '...', line }); i += 3; continue }
    out.push({ t: 'p', v: c, line }); i++
  }
  return out
}

// tokens → a signature: no literal's text (`"…"`), at most 160 characters
function sigOf(toks) {
  // a description (a string no `:` or `=` introduces) is prose: left out
  return toks.filter((x, k) => x.t !== 'str' || (k > 0 && (toks[k - 1].v === ':' || toks[k - 1].v === '='))).map((x) => x.v).join(' ')
    .replace(/\s+([)\]!:,;>])/g, '$1').replace(/([([<])\s+/g, '$1').replace(/@\s+/g, '@').replace(/\s+\(/g, '(').replace(/:(?=\S)/g, ': ').replace(/\s*\.\.\.\s*/g, '...')
    .replace(/\s+/g, ' ').replace(/([\w!\]…"]) ([A-Za-z_]\w*: )/g, '$1, $2').trim().slice(0, 160)
}

// ── GraphQL ──
function graphql(src, isTest) {
  const T = tokens(src, 'graphql')
  const symbols = [], refs = []
  let i = 0
  const lastLine = (dflt = 1) => (T[Math.min(i, T.length) - 1] || { line: dflt }).line
  const peek = (k = 0) => T[i + k]
  const is = (v, k = 0) => T[i + k] && T[i + k].v === v
  const skipTo = (open, close) => { // from an opening token, past its closing one
    let d = 0
    for (; i < T.length; i++) { if (T[i].v === open) d++; else if (T[i].v === close && --d === 0) { i++; return } }
  }
  const sym = (s) => { if (symbols.length < MAX_SYMBOLS) symbols.push({ isTest, ...s }); return symbols.length - 1 }
  const skipDirectives = () => { while (is('@') && peek(1)) { i += 2; if (is('(')) skipTo('(', ')') } }
  // a type's fields: `[description] name [(args)] : Type [directives]`, to the closing brace
  const fields = (owner, typeName, extend) => {
    if (!is('{')) return
    i++
    while (i < T.length && !is('}')) {
      if (peek().t === 'str') { i++; continue }
      if (peek().t !== 'name') { i++; continue }
      const from = i, line = peek().line, name = peek().v
      i++
      const args = i
      if (is('(')) skipTo('(', ')')
      const typeAt = i
      if (is(':')) { i++; while (is('[')) i++; if (peek() && peek().t === 'name') i++; while (is(']') || is('!')) i++ }
      if (is('=')) { i++; if (is('[')) skipTo('[', ']'); else if (is('{')) skipTo('{', '}'); else i++ }
      skipDirectives()
      // `name(args): Type @directives`; past 160 characters the arguments are folded, so the
      // declared type (which a selection's path walks through) always stays
      let s = sigOf(T.slice(from, i))
      if (s.length >= 160 && typeAt > args) s = `${name}(…)${sigOf(T.slice(typeAt, i))}`.slice(0, 160)
      sym({ kind: 'field', name, qualname: `${typeName}.${name}`, parent: extend ? -1 : owner, container: extend ? typeName : null, line, endLine: lastLine(), signature: s })
    }
    i++
  }
  // a selection set: each field selected, with the path it is selected under
  let selects = 0
  const selection = (src, path) => {
    if (!is('{')) return
    i++
    while (i < T.length && !is('}')) {
      if (is('...')) {
        i++
        if (is('on')) { i++; const t = peek() && peek().v; i++; skipDirectives(); selection(src, t) }
        else if (is('{') || is('@')) { skipDirectives(); selection(src, path) }
        else i++ // a fragment spread
        continue
      }
      if (peek().t !== 'name') { i++; continue }
      let name = peek().v
      const line = peek().line
      i++
      if (is(':') && peek(1) && peek(1).t === 'name') { name = peek(1).v; i += 2 } // an alias
      if (is('(')) skipTo('(', ')')
      skipDirectives()
      if (path && name !== '__typename' && selects++ < MAX_SELECTS) refs.push({ kind: 'select', name, qual: path, line, src: src })
      if (is('{')) selection(src, path ? `${path}.${name}` : null)
    }
    i++
  }
  while (i < T.length) {
    const tk = peek()
    if (tk.t === 'str') { i++; continue }
    if (tk.t !== 'name' && !is('{')) { i++; continue }
    const start = i, line = tk.line
    if (is('{')) { selection(-1, 'Query'); continue } // an anonymous query
    const extend = tk.v === 'extend'
    if (extend) i++
    const kw = peek() && peek().v
    if (kw === 'schema') { i++; skipDirectives(); if (is('{')) skipTo('{', '}'); continue }
    if (kw === 'directive') { // directive @name(args) repeatable? on A | B
      i++; if (is('@')) i += 2; if (is('(')) skipTo('(', ')'); if (is('repeatable')) i++
      if (is('on')) { i++; if (is('|')) i++; if (peek() && peek().t === 'name') i++; while (is('|')) { i++; if (peek() && peek().t === 'name') i++ } }
      continue
    }
    if (/^(type|interface|input|enum|union|scalar)$/.test(kw || '')) {
      i++
      const name = peek() && peek().t === 'name' ? peek().v : null
      if (!name) continue
      i++
      const supers = []
      if (is('implements')) { i++; while (i < T.length && (T[i].t === 'name' || T[i].v === '&')) { if (T[i].t === 'name') supers.push(T[i].v); i++ } }
      skipDirectives()
      if (kw === 'union' && is('=')) { i++; if (is('|')) i++; if (peek() && peek().t === 'name') i++; while (is('|')) { i++; if (peek() && peek().t === 'name') i++ } }
      const kind = kw === 'interface' ? 'interface' : kw === 'enum' ? 'enum' : 'type'
      let idx = -1
      if (!extend) {
        idx = sym({ kind, name, qualname: name, parent: -1, container: null, line, endLine: line, signature: sigOf(T.slice(start, i)) })
        for (const s of supers) refs.push({ kind: 'implements', name: s, qual: '', line, src: idx })
      }
      if (is('{')) {
        if (kind === 'enum') skipTo('{', '}')
        else fields(idx, name, extend)
      }
      if (idx >= 0 && symbols[idx]) symbols[idx].endLine = lastLine(line)
      continue
    }
    if (/^(query|mutation|subscription|fragment)$/.test(kw || '') && !extend) {
      i++
      const name = peek() && peek().t === 'name' && peek().v !== 'on' ? peek().v : null
      if (name) i++
      let root = ROOTS[kw] || null
      if (kw === 'fragment' && is('on')) { i++; root = peek() && peek().v; i++ }
      if (is('(')) skipTo('(', ')')
      skipDirectives()
      const idx = name ? sym({ kind: 'operation', name, qualname: name, parent: -1, container: null, line, endLine: line, signature: sigOf(T.slice(start, Math.min(i, start + 40))) }) : -1
      selection(idx, root)
      if (idx >= 0 && symbols[idx]) symbols[idx].endLine = lastLine(line)
      continue
    }
    i++
  }
  return { symbols, refs, imports: [] }
}

// ── protobuf ──
function proto(src, isTest) {
  const T = tokens(src, 'proto')
  const symbols = [], refs = [], imports = []
  let i = 0
  const lastLine = (dflt = 1) => (T[Math.min(i, T.length) - 1] || { line: dflt }).line
  const is = (v) => T[i] && T[i].v === v
  const sym = (s) => { if (symbols.length < MAX_SYMBOLS) symbols.push({ isTest, ...s }); return symbols.length - 1 }
  const toSemi = () => { while (i < T.length && !is(';') && !is('{') && !is('}')) { if (is('[')) { let d = 0; for (; i < T.length; i++) { if (is('[')) d++; else if (is(']') && --d === 0) break } } i++ } if (is(';')) i++ }
  const skipBlock = () => { let d = 0; for (; i < T.length; i++) { if (is('{')) d++; else if (is('}') && --d === 0) { i++; return } } }
  const body = (owner, ownerName, extend) => { // a message's (or an extend's) body
    if (!is('{')) return
    i++
    while (i < T.length && !is('}')) {
      const tk = T[i]
      if (tk.t !== 'name') { i++; continue }
      if (tk.v === 'message' || tk.v === 'enum') { block(owner, ownerName); continue }
      if (tk.v === 'oneof') { i += 2; body(owner, ownerName, extend); continue } // its fields are the message's
      if (/^(option|reserved|extensions)$/.test(tk.v)) { toSemi(); continue }
      if (tk.v === 'extend') { i++; const t = T[i] && T[i].v; i++; body(-1, t, true); continue }
      // a field: [label] Type name = N [options];  ·  map<K, V> name = N;
      const from = i, line = tk.line
      let j = i
      while (j < T.length && !['=', ';', '{', '}'].includes(T[j].v)) j++
      const nameTok = T[j - 1]
      if (T[j] && T[j].v === '=' && nameTok && nameTok.t === 'name' && j - 1 > from) {
        i = j
        toSemi()
        sym({ kind: 'field', name: nameTok.v, qualname: `${ownerName}.${nameTok.v}`, parent: extend ? -1 : owner, container: extend ? ownerName : null, line, endLine: line, signature: sigOf(T.slice(from, Math.min(i, from + 30)).filter((x) => x.v !== ';')) })
      } else { i = j; toSemi() }
    }
    i++
  }
  const block = (parent, parentName) => {
    const kw = T[i].v, line = T[i].line, start = i
    i++
    const name = T[i] && T[i].t === 'name' ? T[i].v : null
    if (!name) { toSemi(); return }
    i++
    const qual = parentName ? `${parentName}.${name}` : name
    if (kw === 'enum') { const idx = sym({ kind: 'enum', name, qualname: qual, parent, container: null, line, endLine: line, signature: `enum ${name}` }); skipBlock(); if (symbols[idx]) symbols[idx].endLine = lastLine(); return }
    if (kw === 'message') { const idx = sym({ kind: 'type', name, qualname: qual, parent, container: null, line, endLine: line, signature: `message ${name}` }); body(idx, qual, false); if (symbols[idx]) symbols[idx].endLine = lastLine(); return }
    if (kw === 'service') {
      const idx = sym({ kind: 'interface', name, qualname: qual, parent, container: null, line, endLine: line, signature: sigOf(T.slice(start, i)) })
      if (!is('{')) return
      i++
      while (i < T.length && !is('}')) {
        if (is('rpc')) {
          const from = i, l = T[i].line
          i++
          const rpc = T[i] && T[i].t === 'name' ? T[i].v : null
          while (i < T.length && !is(';') && !is('{') && !is('}')) i++
          const sig = sigOf(T.slice(from, i))
          if (is('{')) skipBlock(); else if (is(';')) i++
          if (rpc) sym({ kind: 'method', name: rpc, qualname: `${qual}.${rpc}`, parent: idx, container: null, line: l, endLine: lastLine(), signature: sig })
        } else if (is('option')) toSemi()
        else i++
      }
      i++
      if (symbols[idx]) symbols[idx].endLine = lastLine()
      return
    }
    toSemi()
  }
  while (i < T.length) {
    const tk = T[i]
    if (tk.t !== 'name') { i++; continue }
    if (tk.v === 'import') { const line = tk.line; i++; while (is('public') || is('weak')) i++; const s = T[i]; if (s && s.t === 'str') { const raw = sourceOf(src, line); if (raw) imports.push({ source: raw, names: [], line }) } toSemi(); continue }
    if (tk.v === 'message' || tk.v === 'enum' || tk.v === 'service') { block(-1, null); continue }
    if (tk.v === 'extend') { i++; const t = T[i] && T[i].v; i++; body(-1, t, true); continue }
    toSemi()
  }
  return { symbols, refs, imports }
}
// an import's path, read from its line (a module path, not a value: resolution needs it). Only a
// plain relative path of file-name characters is kept.
function sourceOf(src, line) {
  let at = 0
  for (let l = 1; l < line && at >= 0; l++) at = src.indexOf('\n', at) + 1
  const text = src.slice(at, src.indexOf('\n', at) < 0 ? src.length : src.indexOf('\n', at))
  const m = /\bimport\s+(?:public\s+|weak\s+)?"([\w./-]{1,200}\.proto)"/.exec(text)
  return m ? m[1] : null
}

export const HAND_PARSED = { graphql, proto }
export function parseContract(lang, src, isTest = false) { return HAND_PARSED[lang](src, isTest) }

// ── hints: code that implements a contract (refs of kind `contract`) ──
// A hint: { kind: 'contract', name: the contract element (a field or a service), qual: its type, or
// an rpc's name for a service, qtype: how (`gql` a field, `gql-type` a type, `grpc` a service),
// fromType: the implementing definition's name when it is not the hint's own definition, line, src }.
const TRIGGER = /resolve_|graphene|strawberry|@Resolver|@Query|@Mutation|@ObjectType|@InputType|[Rr]esolvers|Servicer|Unimplemented|ImplBase|@GrpcMethod|Server\b|Base\b/
const SVC_SUPER = [/^(\w+)Servicer$/, /^(\w+?)(?:Coroutine)?ImplBase$/, /^Unimplemented(\w+?)(?:Server|Service)$/, /^I(\w+)Server$/]
export function contractHints(lang, family, src, symbols, refs) {
  if (!TRIGGER.test(src)) return []
  const out = []
  const m = masked(src, family)
  const at = lineAt(src)
  // the innermost definition holding a line (of these kinds), or -1
  const inner = (line, kinds = null) => { let best = -1; for (let k = 0; k < symbols.length; k++) { const s = symbols[k]; if (s.line <= line && s.endLine >= line && (!kinds || kinds.includes(s.kind)) && (best < 0 || s.endLine - s.line <= symbols[best].endLine - symbols[best].line)) best = k } return best }
  // the definition a decorator on `line` decorates: the first one starting within 6 lines after it
  const decorated = (line, kinds) => { let best = -1; for (let k = 0; k < symbols.length; k++) { const s = symbols[k]; if (s.line >= line && s.line <= line + 6 && kinds.includes(s.kind) && (best < 0 || s.line < symbols[best].line)) best = k } return best }
  const hint = (h) => out.push({ kind: 'contract', qual: '', qtype: 'gql', fromType: null, ...h })
  const ident = /^[A-Za-z_]\w{0,99}$/
  // generated base classes and embedded servers name the service (protobuf)
  for (const r of refs) {
    if (r.kind !== 'extends' && r.kind !== 'implements') continue
    for (const re of SVC_SUPER) { const x = re.exec(r.name); if (x && (re !== SVC_SUPER[3] || family === 'js')) { hint({ name: x[1], qtype: 'grpc', line: r.line, src: r.src }); break } }
    if (family === 'csharp') { const x = /^(\w+)Base$/.exec(r.name); if (x) hint({ name: x[1], qtype: 'grpc', line: r.line, src: r.src }) }
    if (family === 'python' && /ObjectType$/.test(r.name) && r.src >= 0 && symbols[r.src]) hint({ name: symbols[r.src].name, qtype: 'gql-type', line: r.line, src: r.src })
  }
  if (family === 'go') for (const x of m.matchAll(/\bUnimplemented(\w{1,100}?)Server\b/g)) { const line = at(x.index), k = inner(line, ['struct']); if (k >= 0) hint({ name: x[1], qtype: 'grpc', line, src: k }) }
  if (family === 'python') {
    const graphene = /\bgraphene\b/.test(src)
    for (let k = 0; k < symbols.length; k++) {
      const s = symbols[k]
      const parent = s.parent >= 0 ? symbols[s.parent] : null
      if (graphene && s.kind === 'method' && parent && parent.kind === 'class' && /^resolve_\w/.test(s.name)) hint({ name: camel(s.name.slice(8)), qual: parent.name, line: s.line, src: k })
    }
    if (graphene) for (const x of m.matchAll(/^[ \t]+([a-z_]\w{0,99})[ \t]*=[ \t]*([A-Z]\w{0,99})\.Field\(/gm)) { const line = at(x.index), k = inner(line, ['class']); if (k >= 0) hint({ name: camel(x[1]), qual: symbols[k].name, fromType: x[2], line, src: k }) }
    if (/\bstrawberry\b/.test(src)) {
      for (const x of m.matchAll(/@strawberry\.(field|mutation|subscription)\b/g)) { const line = at(x.index), k = decorated(line, ['method', 'function']); const p = k >= 0 && symbols[k].parent >= 0 ? symbols[symbols[k].parent] : null; if (k >= 0 && p) hint({ name: camel(symbols[k].name), qual: p.name, line: symbols[k].line, src: k }) }
      for (const x of m.matchAll(/@strawberry\.(type|input|interface)\b/g)) { const line = at(x.index), k = decorated(line, ['class']); if (k >= 0) hint({ name: symbols[k].name, qtype: 'gql-type', line: symbols[k].line, src: k }) }
    }
  }
  if (family === 'js') {
    // NestJS: the resolver class's type, its operations and fields; object types; gRPC methods
    const ofType = new Map() // class index → the type @Resolver names
    for (const x of m.matchAll(/@Resolver\(\s*(?:\(\s*\)\s*=>\s*|\w+\s*=>\s*)?\[?\s*(?:['"]([A-Za-z_]\w*)['"]|([A-Z]\w*))?/g)) { const k = decorated(at(x.index), ['class']); if (k >= 0) ofType.set(k, x[1] || x[2] || null) }
    for (const x of m.matchAll(/@(Query|Mutation|Subscription|ResolveField|ResolveProperty)\(/g)) {
      const line = at(x.index), k = decorated(line, ['method'])
      if (k < 0) continue
      const close = closing(m, x.index + x[0].length - 1, x.index + 600)
      const args = close > 0 ? m.slice(x.index, close) : ''
      const named = /\bname\s*:\s*['"]([A-Za-z_]\w*)['"]/.exec(args) || /^@\w+\(\s*['"]([A-Za-z_]\w*)['"]/.exec(args)
      const cls = symbols[k].parent
      const type = /^Resolve/.test(x[1]) ? (cls >= 0 ? ofType.get(cls) : null) : x[1]
      hint({ name: named ? named[1] : symbols[k].name, qual: type || '', line: symbols[k].line, src: k })
    }
    for (const x of m.matchAll(/@(ObjectType|InputType|InterfaceType)\(\s*(?:['"]([A-Za-z_]\w*)['"])?/g)) { const k = decorated(at(x.index), ['class']); if (k >= 0) hint({ name: x[2] || symbols[k].name, qtype: 'gql-type', line: symbols[k].line, src: k }) }
    for (const x of m.matchAll(/@GrpcMethod\(\s*['"]([A-Za-z_]\w*)['"](?:\s*,\s*['"]([A-Za-z_]\w*)['"])?/g)) { const k = decorated(at(x.index), ['method']); if (k >= 0) hint({ name: x[1], qual: x[2] || symbols[k].name.replace(/^./, (c) => c.toUpperCase()), qtype: 'grpc', line: symbols[k].line, src: k }) }
    // a resolver map: `const resolvers = { Query: { user: … } }`, `resolvers: { … }`
    for (const x of m.matchAll(/\b\w*[Rr]esolvers?\b[^=;\n{]{0,80}(?:=|:)\s*\{/g)) {
      const open = x.index + x[0].length - 1
      for (const t of objectEntries(m, open)) {
        if (t.kind !== 'pair' || !/^[A-Z]\w*$/.test(t.key) || m[t.from] !== '{') continue
        for (const f of objectEntries(m, t.from)) {
          const line = at(f.at)
          const value = f.kind === 'pair' ? m.slice(f.from, f.to).trim() : ''
          const fromType = f.kind === 'shorthand' ? f.key : ident.test(value) ? value : /^[A-Za-z_]\w*\.([A-Za-z_]\w*)$/.test(value) ? value.split('.').pop() : null
          hint({ name: f.key, qual: t.key, fromType, line, src: inner(line) })
        }
      }
    }
  }
  return out.slice(0, 5000)
}

// ── linking, at resolution time (resolve.mjs): hints → IMPLEMENTS edges, selections → CALLS edges ──
// ctx: { refs (this repository's, with file_id and src_id), nodes, nodeById, byName (family|name →
// defs), fileById, bindOf (file id → { files }), emit(src, dst, kind, conf, line), signatureOf(id) }
const CONTRACT_FAMILIES = ['graphql', 'proto']
export function linkContracts(ctx) {
  const { refs, nodes, nodeById, byName, fileById, bindOf, emit, signatureOf } = ctx
  const stats = { calls: 0, resolved: 0 } // the selections, counted with the call sites
  const contractNodes = nodes.filter((n) => CONTRACT_FAMILIES.includes(fileById.get(n.file_id).family))
  if (!contractNodes.length) return stats
  const named = (family, name, kinds) => (byName.get(`${family}|${name}`) || []).filter((n) => !kinds || kinds.includes(n.kind))
  const parentName = (n) => (n.parent_id && nodeById.get(n.parent_id) ? nodeById.get(n.parent_id).name : null)
  const fieldsOf = (type, name) => named('graphql', name, ['field']).filter((f) => parentName(f) === type)
  // a field's declared type: the last name in its signature (`user(id: ID!): User!` → User)
  const typeOf = (f) => { const s = signatureOf(f.id).replace(/^\w+\s*(\((?:[^()"]|"…")*\))?/, ''); const m = /^\s*:\s*\[*\s*([A-Za-z_]\w*)/.exec(s); return m ? m[1] : null }
  // the code definition a hint names (`me: meResolver`, `x = CreateX.Field()`): in its file, else in a
  // file it imports, else the only one of that name in its language family
  const implementer = (r, from) => {
    if (!r.from_type) return r.src_id
    const cands = named(from.family, r.from_type).filter((n) => n.kind !== 'file')
    const imported = bindOf(from.id)?.files || new Set()
    const pick = cands.filter((c) => c.file_id === from.id)
    const pick2 = pick.length ? pick : cands.filter((c) => imported.has(c.file_id))
    const one = pick2.length ? pick2 : cands.length === 1 ? cands : []
    return one.length === 1 ? one[0].id : null
  }
  for (const r of refs) {
    const from = fileById.get(r.file_id)
    if (r.kind === 'select' && from.family === 'graphql') {
      // `Query.user.posts`: walk the declared types from the root, then the field selected there
      const segs = r.qual.split('.')
      let type = segs[0]
      for (const s of segs.slice(1)) { const f = fieldsOf(type, s)[0]; type = f ? typeOf(f) : null; if (!type) break }
      const f = type ? fieldsOf(type, r.name) : []
      stats.calls++
      if (f.length) stats.resolved++
      if (f.length) for (const x of f.slice(0, 3)) emit(r.src_id, x.id, 'CALLS', 'qualified', r.line)
      continue
    }
    if (r.kind !== 'contract') continue
    const src = implementer(r, from)
    if (!src) continue
    if (r.qtype === 'grpc') {
      for (const svc of named('proto', r.name, ['interface'])) {
        const rpcs = nodes.filter((n) => n.parent_id === svc.id && n.kind === 'method')
        if (r.qual) { for (const rpc of rpcs.filter((x) => x.name === r.qual)) emit(src, rpc.id, 'IMPLEMENTS', 'contract', r.line); continue }
        emit(src, svc.id, 'IMPLEMENTS', 'contract', r.line)
        const members = nodes.filter((n) => n.parent_id === src && (n.kind === 'method' || n.kind === 'function'))
        for (const rpc of rpcs) for (const m of members) if (m.name === rpc.name || m.name === rpc.name.replace(/^./, (c) => c.toLowerCase())) emit(m.id, rpc.id, 'IMPLEMENTS', 'contract', r.line)
      }
      continue
    }
    if (r.qtype === 'gql-type') { for (const t of named('graphql', r.name, ['type', 'interface'])) emit(src, t.id, 'IMPLEMENTS', 'contract', r.line); continue }
    // a field: on the type the syntax names (or the class is named like), else by its name alone
    const onType = r.qual ? fieldsOf(r.qual, r.name) : []
    if (onType.length) { for (const f of onType) emit(src, f.id, 'IMPLEMENTS', 'contract', r.line); continue }
    // `ProductQueries`, `AccountMutations`: a class mixed into a root type, by the usual naming
    const root = /(Queries|Query)$/.test(r.qual) ? 'Query' : /Mutations?$/.test(r.qual) ? 'Mutation' : /Subscriptions?$/.test(r.qual) ? 'Subscription' : null
    const onRoot = root ? fieldsOf(root, r.name) : []
    if (onRoot.length) { for (const f of onRoot) emit(src, f.id, 'IMPLEMENTS', 'contract-name', r.line); continue }
    const any = named('graphql', r.name, ['field'])
    if (any.length && any.length <= 3) for (const f of any) emit(src, f.id, 'IMPLEMENTS', 'contract-name', r.line)
  }
  return stats
}
