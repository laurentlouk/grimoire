// grimoire graph · language specs. One entry per tree-sitter grammar we extract relations from.
//
// A spec says, for its grammar, which node types are:
//   defs     definitions → a node in the graph. value: kind string, or (node) => kind | null
//            (null = not a definition here). The def's name comes from `name(node)` or the
//            generic nameOf().
//   scopes   blocks that attach their children to a type defined elsewhere (Rust `impl T`,
//            Swift `extension T`, Go method receivers, C++ `T::m`): (node) => { type, super? }
//   calls    call sites → a CALLS ref. value: [field holding the callee (null = the call node
//            itself carries name + receiver fields), ref kind]; `callee(node)` overrides both
//   imports  (node, file) => [{ source, names: [local names], alias? }]
//   supers   (defNode) => [{ name, kind: 'extends' | 'implements' }]
//   isTest   (defNode, name) => bool, on top of the file-path test heuristic
//   tokenCalls  node type → (node) => [{ name, qual }]: calls hidden in unparsed token trees
//   import names are local names, or `local=original` when aliased (`import { a as b }` → `b=a`).
// Anything a spec does not name is walked through, never extracted. Files in a language with no
// spec (or none of these) still become file nodes, so path search covers them.

const text = (n) => (n ? n.text : '')
const field = (n, f) => n.childForFieldName(f)
const named = (n) => { const out = []; for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i)); return out }
const kids = (n, ...types) => named(n).filter((c) => types.includes(c.type))
const deep = (n, types, out = []) => { for (const c of named(n)) { if (types.includes(c.type)) out.push(c); else deep(c, types, out) } return out }
const unquote = (s) => s.replace(/^[`'"<]+|[`'">]+$/g, '')
const hasKeyword = (n, kw) => { for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (!c.isNamed && c.type === kw) return true } return false }
const prevSibling = (n) => n.previousNamedSibling
const LEAF = /^(identifier|simple_identifier|type_identifier|field_identifier|property_identifier|constant|name|namespace_identifier|package_identifier|scoped_type_identifier|private_property_identifier)$/

// The identifier a definition is known by: its `name` field, else the first identifier-like child.
export function nameOf(n) {
  const f = field(n, 'name')
  if (f) return lastSegment(f)
  const c = named(n).find((c) => LEAF.test(c.type))
  return c ? lastSegment(c) : null
}

// Last identifier of a (possibly qualified) name node: `a::b::C` → C, `pkg.Mod` → Mod.
export function lastSegment(n) {
  if (!n) return null
  if (/^(generic_type|generic_name|parameterized_type|template_type)$/.test(n.type)) return lastSegment(field(n, 'type') || field(n, 'name') || n.namedChild(0)) // Foo<W> → Foo, not W
  if (n.namedChildCount === 0) return n.text.replace(/<.*$/, '').split(/::|\.|\\/).pop() || null
  const f = field(n, 'name') || field(n, 'field') || field(n, 'property')
  if (f) return lastSegment(f)
  const leaves = named(n).filter((c) => LEAF.test(c.type) || c.namedChildCount > 0)
  return leaves.length ? lastSegment(leaves[leaves.length - 1]) : n.text
}

// What a call site calls: { name, qual } where qual is the receiver / scope text ('' for a bare call).
const NAME_FIELDS = ['name', 'field', 'property', 'attribute', 'method', 'suffix']
const RECV_FIELDS = ['object', 'value', 'operand', 'receiver', 'scope', 'argument', 'path', 'expression', 'target']
export function calleeOf(n) {
  if (!n) return null
  if (n.namedChildCount === 0) return { name: n.text.split(/::|\.|\\|->/).pop(), qual: '' }
  if (/generic|template/.test(n.type)) return calleeOf(field(n, 'function') || field(n, 'name') || n.namedChild(0))
  for (const f of NAME_FIELDS) {
    const c = field(n, f)
    if (!c) continue
    const inner = calleeOf(c)
    if (!inner) return null
    const r = RECV_FIELDS.map((rf) => field(n, rf)).find(Boolean)
    return { name: inner.name, qual: r ? r.text : inner.qual }
  }
  const ch = named(n)
  if (ch.length === 0) return null
  const last = calleeOf(ch[ch.length - 1])
  if (!last) return null
  return { name: last.name, qual: ch.length > 1 ? ch.slice(0, -1).map(text).join('.') : last.qual }
}

// ───────────────────────── JavaScript / TypeScript / TSX ─────────────────────────
const fnValue = (n) => { const v = field(n, 'value'); return v && /^(arrow_function|function_expression|function|generator_function)$/.test(v.type) }
const jsImports = (n) => {
  const src = field(n, 'source')
  if (!src) return []
  const names = []
  for (const s of deep(n, ['import_specifier', 'export_specifier'])) names.push(field(s, 'alias') ? `${text(field(s, 'alias'))}=${text(field(s, 'name'))}` : text(field(s, 'name')))
  for (const c of deep(n, ['import_clause'])) for (const id of kids(c, 'identifier')) names.push(id.text)
  const ns = deep(n, ['namespace_import'])[0]
  return [{ source: unquote(src.text), names, alias: ns ? text(kids(ns, 'identifier')[0]) : null }]
}
const jsSupers = (n) => {
  const out = []
  for (const h of kids(n, 'class_heritage')) {
    for (const e of kids(h, 'extends_clause')) for (const v of named(e)) if (!/arguments/.test(v.type)) out.push({ name: lastSegment(v), kind: 'extends' })
    for (const i of kids(h, 'implements_clause')) for (const v of named(i)) out.push({ name: lastSegment(v), kind: 'implements' })
  }
  for (const e of kids(n, 'extends_type_clause', 'extends_clause')) for (const v of named(e)) out.push({ name: lastSegment(v), kind: 'extends' })
  return out
}
const js = {
  defs: {
    function_declaration: 'function', generator_function_declaration: 'function', function_signature: 'function',
    class_declaration: 'class', abstract_class_declaration: 'class', class: 'class',
    method_definition: 'method', method_signature: 'method', abstract_method_signature: 'method',
    interface_declaration: 'interface', type_alias_declaration: 'type', enum_declaration: 'enum',
    variable_declarator: (n) => (fnValue(n) ? 'function' : null),
    public_field_definition: (n) => (fnValue(n) ? 'method' : null),
    field_definition: (n) => (fnValue(n) ? 'method' : null),
  },
  name: (n) => (n.type === 'field_definition' ? lastSegment(field(n, 'property')) : nameOf(n)),
  calls: { call_expression: ['function', 'call'], new_expression: ['constructor', 'new'] },
  imports: {
    import_statement: jsImports,
    export_statement: jsImports,
    call_expression: (n) => {
      const f = field(n, 'function'), a = field(n, 'arguments')
      if (!f || !a || !/^(require|import)$/.test(f.text)) return []
      const s = named(a)[0]
      if (!s || !/string|template_string/.test(s.type)) return []
      const decl = n.parent && n.parent.type === 'variable_declarator' ? field(n.parent, 'name') : null
      return [{ source: unquote(s.text), names: decl && decl.type === 'object_pattern' ? deep(decl, ['shorthand_property_identifier_pattern', 'identifier']).map(text) : [], alias: decl && decl.type === 'identifier' ? decl.text : null }]
    },
  },
  supers: jsSupers,
}

// ───────────────────────── Python ─────────────────────────
const py = {
  defs: { function_definition: 'function', class_definition: 'class' },
  calls: { call: ['function', 'call'] },
  imports: {
    import_statement: (n) => named(n).map((c) => c.type === 'aliased_import'
      ? { source: text(field(c, 'name')), names: [], alias: text(field(c, 'alias')) }
      : { source: c.text, names: [], alias: c.text.split('.')[0] }),
    import_from_statement: (n) => {
      const mod = field(n, 'module_name')
      const names = []
      for (let i = 0; i < n.childCount; i++) {
        if (n.fieldNameForChild(i) !== 'name') continue
        const c = n.child(i)
        names.push(c.type === 'aliased_import' ? `${text(field(c, 'alias'))}=${lastSegment(field(c, 'name'))}` : lastSegment(c))
      }
      return [{ source: text(mod), names: names.filter(Boolean) }]
    },
  },
  supers: (n) => { const s = field(n, 'superclasses'); return s ? named(s).filter((c) => c.type !== 'keyword_argument').map((c) => ({ name: lastSegment(c), kind: 'extends' })) : [] },
  isTest: (n, name) => /^test_?/i.test(name) && n.type === 'function_definition',
}

// ───────────────────────── Rust ─────────────────────────
const rustUse = (n, prefix, out) => {
  if (!n) return
  switch (n.type) {
    case 'scoped_use_list': { const p = field(n, 'path'); const base = [prefix, text(p)].filter(Boolean).join('::'); for (const c of named(field(n, 'list') || n)) if (c !== p) rustUse(c, base, out); break }
    case 'use_list': for (const c of named(n)) rustUse(c, prefix, out); break
    case 'use_as_clause': { const p = text(field(n, 'path')); const full = [prefix, p].filter(Boolean).join('::'); const i = full.lastIndexOf('::'); out.push({ source: i < 0 ? full : full.slice(0, i), names: [`${text(field(n, 'alias'))}=${full.split('::').pop()}`] }); break }
    case 'use_wildcard': out.push({ source: [prefix, text(named(n)[0])].filter(Boolean).join('::'), names: [] }); break
    default: { const full = [prefix, n.text].filter(Boolean).join('::'); const i = full.lastIndexOf('::'); out.push(i < 0 ? { source: full, names: [], alias: full } : { source: full.slice(0, i), names: [full.slice(i + 2)] }) }
  }
}
const rust = {
  defs: {
    function_item: 'function', function_signature_item: 'function', struct_item: 'struct', enum_item: 'enum', union_item: 'struct',
    trait_item: 'trait', type_item: 'type', macro_definition: 'macro',
    mod_item: (n) => (field(n, 'body') ? 'module' : null),
  },
  scopes: { impl_item: (n) => ({ type: lastSegment(field(n, 'type')), super: field(n, 'trait') ? lastSegment(field(n, 'trait')) : null }) },
  calls: { call_expression: ['function', 'call'], macro_invocation: ['macro', 'macro'] },
  // Macro arguments are unparsed token trees: `assert!(run() > 0)` still calls run.
  tokenCalls: {
    token_tree: (n) => {
      const out = [], ch = named(n)
      for (let i = 0; i + 1 < ch.length; i++) {
        if (ch[i].type !== 'identifier' || ch[i + 1].type !== 'token_tree' || !ch[i + 1].text.startsWith('(')) continue
        const between = n.text.slice(ch[i].endIndex - n.startIndex, ch[i + 1].startIndex - n.startIndex)
        if (between.trim()) continue
        const before = i > 0 ? n.text.slice(ch[i - 1].endIndex - n.startIndex, ch[i].startIndex - n.startIndex).trim() : ''
        out.push({ name: ch[i].text, qual: before === '::' || before === '.' ? ch[i - 1].text : '' })
      }
      return out
    },
  },
  imports: {
    use_declaration: (n) => { const out = []; rustUse(field(n, 'argument'), '', out); return out },
    mod_item: (n) => (field(n, 'body') ? [] : [{ source: 'self::' + nameOf(n), names: [], alias: nameOf(n), mod: true }]),
  },
  supers: (n) => (n.type === 'trait_item' && field(n, 'bounds') ? named(field(n, 'bounds')).map((c) => ({ name: lastSegment(c), kind: 'extends' })) : []),
  isTest: (n) => { const p = prevSibling(n); return n.type === 'function_item' && !!p && p.type === 'attribute_item' && /\btest\b/.test(p.text) },
}

// ───────────────────────── Go ─────────────────────────
const goRecvType = (n) => { const r = field(n, 'receiver'); const t = r && deep(r, ['type_identifier'])[0]; return t ? t.text : null }
const go = {
  defs: {
    function_declaration: 'function', method_declaration: 'method', method_spec: 'method', method_elem: 'method',
    type_spec: (n) => { const t = field(n, 'type'); return t && t.type === 'struct_type' ? 'struct' : t && t.type === 'interface_type' ? 'interface' : 'type' },
    type_alias: 'type',
  },
  scopes: { method_declaration: (n) => ({ type: goRecvType(n), self: true }) },
  calls: { call_expression: ['function', 'call'], composite_literal: ['type', 'new'] },
  imports: { import_spec: (n) => { const p = unquote(text(field(n, 'path'))); const a = field(n, 'name'); return [{ source: p, names: [], alias: a ? a.text : p.split('/').pop() }] } },
  isTest: (n, name) => /^(Test|Benchmark|Fuzz|Example)/.test(name),
}

// ───────────────────────── Java / Kotlin / Scala-ish ─────────────────────────
const java = {
  defs: {
    class_declaration: 'class', record_declaration: 'class', interface_declaration: 'interface', annotation_type_declaration: 'interface',
    enum_declaration: 'enum', method_declaration: 'method', constructor_declaration: 'constructor',
  },
  calls: { method_invocation: [null, 'call'], object_creation_expression: ['type', 'new'] },
  imports: { import_declaration: (n) => { const s = named(n).find((c) => /identifier/.test(c.type)); if (!s) return []; const wild = named(n).some((c) => c.type === 'asterisk'); const full = s.text; return wild ? [{ source: full, names: [], wildcard: true }] : [{ source: full, names: [full.split('.').pop()] }] } },
  supers: (n) => {
    const out = []
    const sc = field(n, 'superclass'); if (sc) for (const t of named(sc)) out.push({ name: lastSegment(t), kind: 'extends' })
    const si = field(n, 'interfaces'); if (si) for (const t of deep(si, ['type_identifier', 'scoped_type_identifier', 'generic_type'])) out.push({ name: lastSegment(t), kind: 'implements' })
    for (const e of kids(n, 'extends_interfaces')) for (const t of deep(e, ['type_identifier', 'scoped_type_identifier'])) out.push({ name: lastSegment(t), kind: 'extends' })
    return out
  },
  isTest: (n) => /^@(Test|ParameterizedTest)\b/m.test(text(kids(n, 'modifiers')[0])),
}
const kotlin = {
  defs: {
    class_declaration: (n) => (hasKeyword(n, 'interface') ? 'interface' : hasKeyword(n, 'enum') ? 'enum' : 'class'),
    object_declaration: 'class', function_declaration: 'function', type_alias: 'type', secondary_constructor: 'constructor',
  },
  calls: { call_expression: [null, 'call'] },
  callee: (n) => calleeOf(n.namedChild(0)),
  imports: { import_header: (n) => { const id = kids(n, 'identifier')[0]; if (!id) return []; const wild = /\.\*\s*$/.test(n.text); const alias = kids(n, 'import_alias')[0]; return [{ source: id.text, names: wild ? [] : [alias ? `${lastSegment(alias)}=${id.text.split('.').pop()}` : id.text.split('.').pop()], wildcard: wild }] } },
  supers: (n) => deep(n, ['delegation_specifier']).map((d) => ({ name: lastSegment(deep(d, ['type_identifier'])[0] || d), kind: d.namedChild(0)?.type === 'constructor_invocation' ? 'extends' : 'implements' })),
  isTest: (n) => /^@Test\b/m.test(text(kids(n, 'modifiers')[0])),
}

// ───────────────────────── C / C++ ─────────────────────────
const cDeclName = (d) => { while (d && d.type !== 'identifier' && d.type !== 'field_identifier' && d.type !== 'qualified_identifier' && d.type !== 'destructor_name' && d.type !== 'operator_name') d = field(d, 'declarator') || d.namedChild(0); return d }
const cDefName = (n) => {
  if (n.type === 'function_definition') { const d = cDeclName(field(n, 'declarator')); return d ? lastSegment(field(d, 'name') || d) : null }
  if (n.type === 'type_definition') return lastSegment(field(n, 'declarator'))
  return nameOf(n)
}
const withBody = (kind) => (n) => (field(n, 'body') && field(n, 'name') ? kind : null)
const c = {
  defs: {
    function_definition: 'function', struct_specifier: withBody('struct'), union_specifier: withBody('struct'), enum_specifier: withBody('enum'), type_definition: 'type',
    preproc_function_def: 'macro',
  },
  name: cDefName,
  calls: { call_expression: ['function', 'call'] },
  imports: { preproc_include: (n) => { const p = field(n, 'path'); return p ? [{ source: unquote(p.text), names: [], system: p.type === 'system_lib_string' }] : [] } },
}
const cpp = {
  ...c,
  defs: { ...c.defs, class_specifier: withBody('class'), namespace_definition: (n) => (field(n, 'name') ? 'namespace' : null), concept_definition: 'type', alias_declaration: 'type' },
  scopes: {
    function_definition: (n) => { const d = cDeclName(field(n, 'declarator')); return d && d.type === 'qualified_identifier' ? { type: lastSegment(field(d, 'scope')) } : null },
  },
  calls: { call_expression: ['function', 'call'], new_expression: ['type', 'new'] },
  supers: (n) => kids(n, 'base_class_clause').flatMap((b) => named(b).filter((t) => /type_identifier|qualified_identifier|template_type/.test(t.type)).map((t) => ({ name: lastSegment(t), kind: 'extends' }))),
}

// ───────────────────────── C# ─────────────────────────
const csharp = {
  defs: {
    class_declaration: 'class', struct_declaration: 'struct', record_declaration: 'class', record_struct_declaration: 'struct', interface_declaration: 'interface', enum_declaration: 'enum',
    method_declaration: 'method', constructor_declaration: 'constructor', local_function_statement: 'function', delegate_declaration: 'type',
    namespace_declaration: 'namespace', file_scoped_namespace_declaration: 'namespace',
  },
  name: (n) => (/namespace/.test(n.type) ? text(field(n, 'name')) : nameOf(n)),
  calls: { invocation_expression: ['function', 'call'], object_creation_expression: ['type', 'new'] },
  imports: { using_directive: (n) => { const q = named(n).find((c) => /name|identifier/.test(c.type) && c !== field(n, 'alias')); return q ? [{ source: q.text, names: [], namespace: true }] : [] } },
  supers: (n) => { const b = field(n, 'bases') || kids(n, 'base_list')[0]; return b ? named(b).map((t) => ({ name: lastSegment(t), kind: /^I[A-Z]/.test(lastSegment(t) || '') ? 'implements' : 'extends' })) : [] },
  isTest: (n) => /\[(Test|Fact|Theory|TestMethod)\b/.test(text(kids(n, 'attribute_list')[0])),
}

// ───────────────────────── Ruby ─────────────────────────
const ruby = {
  defs: { method: 'function', singleton_method: 'method', class: 'class', module: 'module' },
  calls: { call: [null, 'call'] },
  imports: {
    call: (n) => {
      const m = text(field(n, 'method'))
      if (!/^(require|require_relative|load|autoload)$/.test(m)) return []
      const s = deep(n, ['string'])[0]
      return s ? [{ source: unquote(s.text), names: [], relative: m === 'require_relative' }] : []
    },
  },
  supers: (n) => {
    const out = []
    const s = field(n, 'superclass'); if (s) out.push({ name: lastSegment(named(s)[0] || s), kind: 'extends' })
    const body = field(n, 'body')
    if (body) for (const c of kids(body, 'call')) if (/^(include|extend|prepend)$/.test(text(field(c, 'method')))) for (const a of deep(c, ['constant', 'scope_resolution'])) { out.push({ name: lastSegment(a), kind: 'implements' }); break }
    return out
  },
  isTest: (n, name) => /^test_/.test(name),
}

// ───────────────────────── PHP ─────────────────────────
const php = {
  defs: {
    function_definition: 'function', method_declaration: 'method', class_declaration: 'class', interface_declaration: 'interface',
    trait_declaration: 'trait', enum_declaration: 'enum',
  },
  calls: {
    function_call_expression: ['function', 'call'], member_call_expression: [null, 'call'], nullsafe_member_call_expression: [null, 'call'],
    scoped_call_expression: [null, 'call'], object_creation_expression: [null, 'new'],
  },
  callee: (n) => (n.type === 'object_creation_expression' ? calleeOf(named(n).find((c) => /name/.test(c.type))) : null),
  imports: {
    namespace_use_clause: (n) => { const q = named(n).find((c) => /qualified_name|^name$/.test(c.type)); const alias = field(n, 'alias'); return q ? [{ source: q.text.replace(/^\\/, ''), names: [alias ? `${alias.text}=${q.text.split('\\').pop()}` : q.text.split('\\').pop()] }] : [] },
    require_expression: (n) => phpInclude(n), require_once_expression: (n) => phpInclude(n), include_expression: (n) => phpInclude(n), include_once_expression: (n) => phpInclude(n),
  },
  supers: (n) => [
    ...kids(n, 'base_clause').flatMap((b) => named(b).map((t) => ({ name: lastSegment(t), kind: 'extends' }))),
    ...kids(n, 'class_interface_clause').flatMap((b) => named(b).map((t) => ({ name: lastSegment(t), kind: 'implements' }))),
  ],
  isTest: (n, name) => /^test/.test(name) && n.type === 'method_declaration',
}
const phpInclude = (n) => { const s = deep(n, ['string', 'encapsed_string'])[0]; return s ? [{ source: unquote(s.text), names: [], relative: true }] : [] }

// ───────────────────────── Swift ─────────────────────────
const swiftKind = (n) => (hasKeyword(n, 'extension') ? null : hasKeyword(n, 'struct') ? 'struct' : hasKeyword(n, 'enum') ? 'enum' : hasKeyword(n, 'actor') ? 'class' : 'class')
const swift = {
  defs: {
    class_declaration: swiftKind, protocol_declaration: 'protocol', function_declaration: 'function', protocol_function_declaration: 'method',
    init_declaration: 'constructor', typealias_declaration: 'type',
  },
  name: (n) => (n.type === 'init_declaration' ? 'init' : lastSegment(field(n, 'name') || named(n).find((c) => LEAF.test(c.type)))),
  scopes: { class_declaration: (n) => (hasKeyword(n, 'extension') ? { type: lastSegment(field(n, 'name')) } : null) },
  calls: { call_expression: [null, 'call'] },
  callee: (n) => calleeOf(n.namedChild(0)),
  imports: { import_declaration: (n) => { const id = kids(n, 'identifier')[0]; return id ? [{ source: id.text, names: [], module: true }] : [] } },
  supers: (n) => kids(n, 'inheritance_specifier').map((s) => ({ name: lastSegment(field(s, 'inherits_from') || s), kind: 'extends' })),
  isTest: (n, name) => /^test/.test(name) && n.type === 'function_declaration',
}

// ───────────────────────── registry ─────────────────────────
// family: languages whose symbols can call each other (resolution never crosses families).
export const LANGS = {
  javascript: { wasm: 'javascript', family: 'js', exts: ['.js', '.jsx', '.mjs', '.cjs'], spec: js },
  typescript: { wasm: 'typescript', family: 'js', exts: ['.ts', '.mts', '.cts'], spec: js },
  tsx: { wasm: 'tsx', family: 'js', exts: ['.tsx'], spec: js },
  python: { wasm: 'python', family: 'python', exts: ['.py', '.pyi'], spec: py },
  rust: { wasm: 'rust', family: 'rust', exts: ['.rs'], spec: rust },
  go: { wasm: 'go', family: 'go', exts: ['.go'], spec: go },
  java: { wasm: 'java', family: 'jvm', exts: ['.java'], spec: java },
  kotlin: { wasm: 'kotlin', family: 'jvm', exts: ['.kt', '.kts'], spec: kotlin },
  c: { wasm: 'c', family: 'c', exts: ['.c', '.h'], spec: c },
  cpp: { wasm: 'cpp', family: 'c', exts: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.ipp'], spec: cpp },
  csharp: { wasm: 'c_sharp', family: 'csharp', exts: ['.cs'], spec: csharp },
  ruby: { wasm: 'ruby', family: 'ruby', exts: ['.rb', '.rake'], spec: ruby },
  php: { wasm: 'php', family: 'php', exts: ['.php'], spec: php },
  swift: { wasm: 'swift', family: 'swift', exts: ['.swift'], spec: swift },
}
// Indexed as file nodes only (searchable by path, reachable through imports), no symbols.
export const FILE_ONLY_EXTS = ['.vue', '.svelte', '.scala', '.dart', '.lua', '.ex', '.exs', '.zig', '.sol', '.ml', '.m', '.mm', '.sh', '.bash', '.sql', '.proto', '.graphql', '.gql']

const BY_EXT = new Map()
for (const [id, l] of Object.entries(LANGS)) for (const e of l.exts) BY_EXT.set(e, id)
export const langOf = (file) => { const m = /(\.[^./]+)$/.exec(file); return m ? BY_EXT.get(m[1].toLowerCase()) || (FILE_ONLY_EXTS.includes(m[1].toLowerCase()) ? 'other' : null) : null }
export const familyOf = (lang) => (LANGS[lang] ? LANGS[lang].family : lang)

// A file is a test file when its path says so, in any of the usual conventions.
export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testing)\/|[._-](test|spec)s?\.[^/]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb|exs?)$|Tests?\.(java|kt|cs|swift|php)$/
