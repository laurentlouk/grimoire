// grimoire graph · local type hints. Not type inference: just the two places where the syntax
// states a variable's type outright, so `x.area()` can be linked to Circle.area instead of to
// every `area` in the repository:
//   parameters  `a: Circle`, `Circle a`, `a *Circle`, `Circle $a`, Go receivers (`func (c *Cart)`)
//   locals      `let c: Circle`, `Circle c = …`, and a value built by a constructor:
//               `new Circle()`, `Circle()`, `Circle::new()`, `Circle.new`, `&Circle{}`
// Wrappers (`Box<T>`, `Option<T>`, `Arc<T>` …) are looked through; collections are not typed.
//   fields      a class's fields where the syntax states their type (fieldBindings): a typed field
//               declaration, a constructor parameter property (`constructor(private svc: Svc)`), a
//               Kotlin `val` constructor parameter, a Python class-level annotation, and a field the
//               constructor sets from a typed parameter (`this.repo = repo`, `self.repo = repo`,
//               `_repo = repo`): how dependency injection hands a class its collaborators.
import { calleeOf, lastSegment } from './langs.mjs'

const field = (n, f) => n.childForFieldName(f)
const named = (n) => (n.namedChildren ? n.namedChildren.slice() : Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i))) // one call: namedChild(i) walks the children before i
const WRAPPERS = /^(Box|Rc|Arc|Pin|Cow|Option|Optional|Ref|RefMut|RefCell|Mutex|RwLock|Nullable|Readonly|Lazy|Weak)$/
const TYPE_NODE = /(^|_)type$|^(user_type|named_type|nullable_type|optional_type|type_annotation|type_identifier|scoped_type_identifier|qualified_type|reference_type|pointer_type)$/
const NOT_A_TYPE = /^(array_type|slice_type|map_type|tuple_type|function_type|union_type|dictionary_type|list_type|channel_type|predefined_type|primitive_type|void_type|implicit_type|placeholder_type_specifier)$/
const PARAMS = new Set(['parameter', 'required_parameter', 'optional_parameter', 'typed_parameter', 'typed_default_parameter', 'formal_parameter', 'parameter_declaration', 'simple_parameter', 'property_promotion_parameter'])
const ASSIGN = new Set(['variable_declarator', 'assignment', 'let_declaration', 'short_var_declaration', 'var_spec', 'property_declaration', 'assignment_expression', 'init_declarator', 'declaration', 'local_variable_declaration', 'variable_declaration'])
const CALLISH = /^(call_expression|call|invocation_expression|method_invocation|function_call_expression|scoped_call_expression|member_call_expression)$/
const INFERRED = /^(var|let|const|auto|val|dynamic|any|unknown|object|Object|Self)$/ // declared without a type
const IDENTISH = /^(identifier|simple_identifier|bound_identifier|variable_name|name|shorthand_property_identifier_pattern)$/

export const varName = (s) => (s || '').replace(/^[$@&*]+/, '')

// The type a type node names, looking through wrappers and qualifiers; null for anything else.
export function typeName(t) {
  if (!t || NOT_A_TYPE.test(t.type)) return null
  if (/^(type_annotation|type|nullable_type|optional_type|user_type|named_type|reference_type|pointer_type|type_arguments)$/.test(t.type)) {
    const inner = field(t, 'type') || named(t).find((c) => !/^(mutable_specifier|lifetime|type_qualifier)$/.test(c.type))
    if (!inner) return /^(named_type|user_type)$/.test(t.type) ? lastSegment(t) : null
    if (t.type === 'user_type' && named(t).length > 1) return typeName(named(t)[0]) // Kotlin Foo<Bar>
    return typeName(inner)
  }
  if (/^(generic_type|parameterized_type|generic_name|template_type)$/.test(t.type)) {
    const head = lastSegment(t)
    if (head && WRAPPERS.test(head)) { const args = field(t, 'type_arguments') || field(t, 'arguments') || named(t).find((c) => /argument/.test(c.type)); return args ? typeName(named(args)[0]) : null }
    return head
  }
  const n = lastSegment(t)
  return n && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(n) && !INFERRED.test(n) ? n : null
}

// The first identifier a pattern or declarator binds.
function bound(n) {
  if (!n) return null
  if (IDENTISH.test(n.type) && n.namedChildCount === 0) return n.text
  if (n.type === 'variable_name') return n.text
  for (const f of ['name', 'declarator', 'pattern', 'bound_identifier']) { const c = field(n, f); if (c) return bound(c) }
  const c = named(n).find((c) => !TYPE_NODE.test(c.type))
  return c ? bound(c) : null
}

// The type of a value when a constructor call makes it plain.
function typeOfValue(v, spec) {
  if (!v) return null
  if (/^(unary_expression|await_expression|parenthesized_expression|expression_list|equals_value_clause|reference_expression)$/.test(v.type)) return typeOfValue(field(v, 'operand') || field(v, 'value') || named(v)[0], spec)
  // `new FileSystem.File(…)` (JavaScript): the type with the namespace it is read from, `FileSystem.File`,
  // so resolution can tell a dependency's namespace from the repository's
  if (v.type === 'new_expression') { const k = field(v, 'constructor'); if (k && k.type === 'member_expression' && field(k, 'object')?.type === 'identifier' && field(k, 'property')) return `${field(k, 'object').text}.${field(k, 'property').text}` }
  if (/^(new_expression|object_creation_expression|composite_literal|struct_expression)$/.test(v.type)) return typeName(field(v, 'constructor') || field(v, 'type') || field(v, 'name') || named(v).find((c) => /name|identifier|type/.test(c.type)))
  if (CALLISH.test(v.type)) {
    const call = spec.calls[v.type]
    const c = (spec.callee && spec.callee(v)) || calleeOf(call && call[0] ? field(v, call[0]) : v)
    if (!c) return null
    const qLast = (c.qual || '').split(/::|\.|->|\\/).pop()
    if (qLast && /^[A-Z]/.test(qLast) && /^[\p{L}_][\p{L}\p{N}_]*$/u.test(qLast)) return qLast // Circle::new(), Circle.new, Foo.create()
    if (!c.qual && /^[A-Z]/.test(c.name)) return c.name // Circle() in Python, Kotlin, Swift
  }
  return null
}

// Bindings a node introduces into the current scope: [[varName, TypeName], …]. Asked of every node
// the indexer walks: a node of no kind that binds answers at once (one shared empty list).
const NONE = Object.freeze([])
export function bindingsOf(n, spec) {
  const t = n.type
  if (!PARAMS.has(t) && !ASSIGN.has(t)) return NONE
  const out = []
  const put = (name, type) => { if (name && type) out.push([varName(name), type]) }
  if (PARAMS.has(n.type)) {
    const names = []
    for (const c of n.childrenForFieldName('name')) if (!TYPE_NODE.test(c.type)) names.push(bound(c))
    if (!names.length) names.push(bound(field(n, 'pattern') || field(n, 'declarator') || named(n).find((c) => IDENTISH.test(c.type)) || null))
    const type = typeName(field(n, 'type') || named(n).find((c) => TYPE_NODE.test(c.type) && !IDENTISH.test(c.type)))
    for (const nm of names) put(nm, type) // Go: `c, d Bar`
    return out
  }
  if (!ASSIGN.has(n.type)) return out
  if (n.type === 'local_variable_declaration' || (n.type === 'variable_declaration' && field(n, 'type'))) {
    const declared = typeName(field(n, 'type'))
    for (const d of named(n).filter((c) => c.type === 'variable_declarator')) put(bound(d), declared || typeOfValue(field(d, 'value') || named(d).find((c) => c.type === 'equals_value_clause'), spec))
    return out
  }
  if (n.type === 'declaration') { // C++: `Circle c;` / `Circle c(1);`
    const declared = typeName(field(n, 'type'))
    for (const d of named(n).filter((c) => /declarator|identifier/.test(c.type) && c !== field(n, 'type'))) put(bound(d), declared || typeOfValue(field(d, 'value'), spec))
    return out
  }
  const target = field(n, 'name') || field(n, 'pattern') || field(n, 'left') || field(n, 'declarator') || named(n).find((c) => c.type === 'variable_declaration')
  const declared = typeName(field(n, 'type') || (target && target.type === 'variable_declaration' ? named(target).find((c) => TYPE_NODE.test(c.type)) : null) || named(n).find((c) => c.type === 'type_annotation'))
  const value = field(n, 'value') || field(n, 'right') || named(n).find((c) => CALLISH.test(c.type) || /creation|new_expression/.test(c.type))
  put(bound(target), declared || typeOfValue(value, spec))
  return out
}

// The names a node binds in the scope around it, typed or not: a parameter, a declared or assigned
// variable, a loop variable, a caught error, a `with … as` alias. A value by such a name is the local,
// never a function of the same name (extract.mjs). Over-approximate: a name counted local is only a
// reference not linked.
const PARAM_LISTS = new Set(['parameters', 'formal_parameters', 'method_parameters', 'lambda_parameters', 'block_parameters', 'parameter_list', 'function_value_parameters'])
const LOOPS = new Set(['for_statement', 'for_in_statement', 'range_clause', 'for_in_clause', 'catch_clause', 'as_pattern', 'for_expression', 'enhanced_for_statement'])
// a JavaScript destructuring pattern (`{ a, b: c, d = x, ...rest }`, `[a, b]`): the names it binds,
// never a default's value
const PATTERN = /^(object_pattern|array_pattern|assignment_pattern|object_assignment_pattern|rest_pattern|pair_pattern)$/
const patternNames = (n, out = [], d = 0) => {
  if (!n || d > 6) return out
  if (IDENTISH.test(n.type) && n.namedChildCount === 0) { out.push(n.text); return out }
  if (n.type === 'pair_pattern') return patternNames(field(n, 'value'), out, d + 1)
  if (n.type === 'assignment_pattern' || n.type === 'object_assignment_pattern') return patternNames(field(n, 'left'), out, d + 1)
  if (PATTERN.test(n.type)) for (const c of named(n)) patternNames(c, out, d + 1)
  return out
}
const idents = (n, out = [], d = 0) => { if (!n || d > 4) return out; if (IDENTISH.test(n.type) && n.namedChildCount === 0) out.push(n.text); else if (!TYPE_NODE.test(n.type)) for (const c of named(n)) idents(c, out, d + 1); return out }
export function localsOf(n) {
  const t = n.type
  if (!PARAMS.has(t) && !ASSIGN.has(t) && !PARAM_LISTS.has(t) && !LOOPS.has(t) && t !== 'default_parameter' && t !== 'typed_default_parameter') return NONE
  if (PARAMS.has(n.type) || n.type === 'default_parameter' || n.type === 'typed_default_parameter') {
    const pat = field(n, 'pattern')
    if (pat && PATTERN.test(pat.type)) return patternNames(pat) // `({ onPress, label }: Props) => …`
    const b = bound(field(n, 'name') || pat || n); return b ? [b] : []
  }
  if (PARAM_LISTS.has(n.type)) return named(n).flatMap((c) => (IDENTISH.test(c.type) ? [c.text] : PATTERN.test(c.type) ? patternNames(c) : []))
  if (ASSIGN.has(n.type)) {
    // `const onSave = () => …` is a nested function's definition, which a value may name
    if (n.type === 'variable_declarator' && field(n, 'value') && /^(arrow_function|function_expression|function|generator_function)$/.test(field(n, 'value').type)) return []
    const target = field(n, 'name') || field(n, 'pattern') || field(n, 'left') || field(n, 'declarator')
    if (!target) return []
    if (PATTERN.test(target.type)) return patternNames(target)
    if (/^(identifier|expression_list|pattern_list|tuple_pattern|list_pattern)$/.test(target.type)) return idents(target)
    const b = /member|attribute|selector|field|subscript|index/.test(target.type) ? null : bound(target)
    return b ? [b] : []
  }
  if (LOOPS.has(n.type)) return idents(field(n, 'left') || field(n, 'alias') || field(n, 'parameter') || field(n, 'name') || null)
  return []
}

// A class's fields whose type the syntax states: [[fieldName, TypeName], …] (see the header).
const FIELD_DECL = new Set(['public_field_definition', 'field_definition', 'field_declaration', 'property_declaration'])
const SELFISH = /^(this|self)$/
const hasToken = (n, tok) => { for (const c of n.children) if (!c.isNamed && c.type === tok) return true; return false }
export function fieldBindings(cls, spec) {
  const out = []
  const put = (name, type) => { if (name && type && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) out.push([name, type]) }
  // Kotlin: `class C(private val repo: Repo)`
  for (const pc of named(cls).filter((c) => c.type === 'primary_constructor')) {
    for (const p of named(pc).filter((c) => c.type === 'class_parameter' && named(c).some((k) => k.type === 'binding_pattern_kind'))) put(named(p).find((c) => c.type === 'simple_identifier')?.text, typeName(named(p).find((c) => TYPE_NODE.test(c.type) && !IDENTISH.test(c.type))))
  }
  const body = field(cls, 'body') || named(cls).find((c) => /^(class_body|declaration_list|block|body)$/.test(c.type))
  if (!body) return out
  for (const m of named(body)) {
    if (FIELD_DECL.has(m.type)) {
      if (m.type === 'public_field_definition' || m.type === 'field_definition') put(lastSegment(field(m, 'name') || field(m, 'property')), typeName(field(m, 'type')) || typeOfValue(field(m, 'value'), spec))
      else if (m.type === 'field_declaration') {
        const vd = named(m).find((c) => c.type === 'variable_declaration')
        if (vd) for (const [n, t] of bindingsOf(vd, spec)) put(n, t) // C#
        else { const t = typeName(field(m, 'type')); for (const d of named(m).filter((c) => c.type === 'variable_declarator')) put(bound(d), t || typeOfValue(field(d, 'value'), spec)) } // Java
      } else for (const [n, t] of bindingsOf(m, spec)) put(n, t) // Kotlin, PHP properties
      continue
    }
    if (m.type === 'expression_statement') { for (const a of named(m)) if (a.type === 'assignment' && field(a, 'type')) for (const [n, t] of bindingsOf(a, spec)) put(n, t); continue } // Python `repo: Repo`
    const name = field(m, 'name')?.text
    const ctor = m.type === 'constructor_declaration' || (m.type === 'method_definition' && name === 'constructor') || (m.type === 'function_definition' && name === '__init__')
    if (!ctor) continue
    const params = new Map()
    const plist = field(m, 'parameters') || named(m).find((c) => /^(formal_parameters|parameters|parameter_list)$/.test(c.type))
    for (const p of plist ? named(plist) : []) for (const [n, t] of bindingsOf(p, spec)) {
      params.set(n, t)
      if (named(p).some((c) => c.type === 'accessibility_modifier') || hasToken(p, 'readonly')) put(n, t) // a TypeScript parameter property
    }
    // `this.repo = repo`, `self.repo = repo`, `_repo = repo`: a field set from a typed parameter
    const walk = (n, d) => {
      if (d > 6) return
      if (/^(assignment_expression|assignment)$/.test(n.type)) {
        const l = field(n, 'left'), r = field(n, 'right')
        if (l && r && IDENTISH.test(r.type) && params.has(r.text)) {
          const obj = field(l, 'object'), prop = field(l, 'field') || field(l, 'property') || field(l, 'attribute')
          if (obj && prop && SELFISH.test(obj.text)) put(prop.text, params.get(r.text))
          else if (IDENTISH.test(l.type) && l.text !== r.text) put(l.text, params.get(r.text))
        }
      }
      for (const c of named(n)) walk(c, d + 1)
    }
    const b = field(m, 'body') || named(m).find((c) => /body|block/.test(c.type))
    if (b) walk(b, 0)
  }
  return out
}
