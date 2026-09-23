// grimoire graph · local type hints. Not type inference: just the two places where the syntax
// states a variable's type outright, so `x.area()` can be linked to Circle.area instead of to
// every `area` in the repository:
//   parameters  `a: Circle`, `Circle a`, `a *Circle`, `Circle $a`, Go receivers (`func (c *Cart)`)
//   locals      `let c: Circle`, `Circle c = …`, and a value built by a constructor:
//               `new Circle()`, `Circle()`, `Circle::new()`, `Circle.new`, `&Circle{}`
// Wrappers (`Box<T>`, `Option<T>`, `Arc<T>` …) are looked through; collections are not typed.
import { calleeOf, lastSegment } from './langs.mjs'

const field = (n, f) => n.childForFieldName(f)
const named = (n) => { const out = []; for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i)); return out }
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

// Bindings a node introduces into the current scope: [[varName, TypeName], …].
export function bindingsOf(n, spec) {
  const out = []
  const put = (name, type) => { if (name && type) out.push([varName(name), type]) }
  if (PARAMS.has(n.type)) {
    const names = []
    for (let i = 0; i < n.childCount; i++) if (n.fieldNameForChild(i) === 'name' && !TYPE_NODE.test(n.child(i).type)) names.push(bound(n.child(i)))
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
