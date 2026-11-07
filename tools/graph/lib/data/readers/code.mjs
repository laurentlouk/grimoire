// grimoire graph · data · what the code extractors share (extractors/serde.mjs for Rust,
// extractors/ts-types.mjs for TypeScript): the facts a source file gives the item-shape binding
// (data/binding.mjs), and the tree-sitter helpers they walk with.
//
// A code file's facts: { declarations: [], code: Code } (no store of its own: a code file declares no
// table, it gives the shape of the items one holds and the names it reaches them by).
//   Code   { lang: rust | ts, types: [Type], consts: [Const], fns: [Fn], notes: [string] }
//   Type   { name, kind: struct | enum | interface | alias, line, end, serde: it derives Serialize or
//            Deserialize (Rust; always true for TypeScript), fields: [Field], variants?: [Variant],
//            tag?, content?, untagged?, newtype?: T (a tuple struct of one field: serialized as it),
//            extends?: [name] (TypeScript), converts?: line (it implements an item conversion: a
//            `to_item` / `from_item` method, a From or TryFrom with an attribute map), skipped?:
//            [{ ident, why }] (fields serde never stores: skip, skip_serializing) }
//   Field  { name: as stored (after rename and rename_all), ident?: as the code writes it (when not
//            the stored name), raw: the type as written (capped), t: T, nullable: Option, `?`, `| null`,
//            skip_serializing_if, default: null | 'Default::default()' | the function serde calls, flatten?: true
//            (its type's fields inline), line }
//   Variant { name: as stored, ident?, line, unit?: true, fields?: [Field], t?: T (a tuple variant of one) }
//   T      { k: string | number | bool | any | ref | list | map | obj | enum, n?: a type's name (ref),
//            of?: T (list, map), fields?: [Field] (obj), values?: [string] (enum) }
//   Const  { name, line, names: [Name], env: [Env] }  a constant the code names a table by
//   Fn     { name, line, end, test?: true (test code), converts: [Conversion], names: [Name], env: [Env],
//            uses: [name] (constants it reads) }
//   Conversion { type, line, how }  a type turned into an item or read from one, here
//   Name   { text: a pattern (readers/names.mjs: `{}` what the code fills in), line }
//   Env    { name, line }   an environment variable read
// Every list is capped (MAX), so a hostile or generated file stays small in the index.
export const MAX = { types: 400, fields: 200, fns: 600, per: 40, notes: 8, raw: 120 }

export const named = (n) => { const out = []; for (let i = 0; i < n.namedChildCount; i++) out.push(n.namedChild(i)); return out }
export const field = (n, f) => (n ? n.childForFieldName(f) : null)
export const lineOf = (n) => n.startPosition.row + 1
export const endOf = (n) => n.endPosition.row + 1
export const cap = (s, n = MAX.raw) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
export const push = (list, x, n = MAX.per) => { if (list.length < n) list.push(x) }
// a constant's name, as code conventionally writes one
export const CONST_NAME = /^[A-Z][A-Z0-9_]{2,}$/

// Every node of a subtree, in source order, without recursion (a deep file cannot exhaust the stack):
// visit(node) returning false skips that node's children.
export function each(n, visit) {
  const stack = [n]
  while (stack.length) {
    const x = stack.pop()
    if (visit(x) === false) continue
    for (let i = x.namedChildCount - 1; i >= 0; i--) stack.push(x.namedChild(i))
  }
}

// A file's facts, kept small: its functions only when one of them converts an item (a name or an
// environment read elsewhere pairs with nothing: the binding pairs within a file, and reaches other
// files through their constants alone); no code entry at all when nothing is left.
export function codeFacts(code) {
  const fns = code.fns.some((f) => f.converts.length) ? code.fns : []
  return code.types.length || fns.length || code.consts.length ? { declarations: [], code: { ...code, fns } } : { declarations: [] }
}
