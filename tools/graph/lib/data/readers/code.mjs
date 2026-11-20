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

export const named = (n) => (n.namedChildren ? n.namedChildren.slice() : Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i))) // one call: namedChild(i) walks the children before i
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
    for (let cs = x.namedChildren, i = cs.length - 1; i >= 0; i--) stack.push(cs[i])
  }
}

// A file's facts, kept small: its functions only when one of them converts an item (a name or an
// environment read elsewhere pairs with nothing: the binding pairs within a file, and reaches other
// files through their constants alone); no code entry at all when nothing is left.
export function codeFacts(code) {
  const fns = code.fns.some((f) => f.converts.length) ? tableFns(code.fns) : []
  const consts = tableConsts(code.consts)
  return code.types.length || fns.length || consts.length ? { declarations: [], code: { ...code, consts, fns } } : { declarations: [] }
}

// ── the constants a table may be named by, and only those, reach the index ──
// An allow-list, never a deny-list of secret-sounding names (a settings file names its secrets any
// way it likes: `DB_PWD`, `CREDS`, `HMAC_SEED`, `LICENSE`). A constant is kept when it can plausibly
// name a table:
//   - its name says so: a word of it is TABLE, TBL, COLLECTION, INDEX, IDX, GSI, LSI, STREAM, QUEUE,
//     BUCKET, ENTITY, MODEL, KEYSPACE, DYNAMO or DDB (strong); or it ends in NAME, holds PREFIX or
//     SUFFIX, or starts with BY (an index named by its key: `BY_OWNER`, `ByStatus`) (weak);
//   - or its value holds a template hole (`{}`: `${…}`, `{}`, `%s`, what code fills in) (weak);
//   - or its value spells its name (`ORDERS = 'orders-v2'`: a value repeating its own name tells
//     nothing a reader of the name does not know) (weak);
// a weak reason never under a name that sounds like a secret. Its value, whatever the reason, is
// table-shaped (letters, numerals, `_ . - :`, `{}`, at most 255) and not a credential's: no known
// token prefix (`sk_live_`, `ghp_`, `xox…`, `AKIA`, `AIza`, `eyJ`…), and not a high-entropy text (20
// characters or more mixing upper case, lower case and numerals; 32 hex characters or more). In a
// container (a dict, an object, a struct literal), only a value under a table-like key (the words
// above, `name` among them) is kept, never a key itself. An environment variable a constant reads is
// a name, never a value: it is kept whatever the constant is called. The canary tests check every
// byte of the index.
const TABLE_TEXT = /^[A-Za-z0-9_.:{}-]{1,255}$/
const SECRET_NAME = /pass(word|wd|phrase)?|pwd|secret|token|api_?key|private|credential|creds|auth|salt|seed|cert|dsn|signing|access_?key|session_?key|licen[cs]e|^key$|_key$/i
const STRONG = new Set(['table', 'tables', 'tbl', 'tbls', 'collection', 'collections', 'index', 'indexes', 'indices', 'idx', 'gsi', 'lsi', 'stream', 'streams', 'queue', 'queues', 'bucket', 'buckets', 'entity', 'entities', 'model', 'models', 'keyspace', 'keyspaces', 'dynamo', 'dynamodb', 'ddb'])
const TOKEN_PREFIX = /^(?:[spr]k_(?:live|test)_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|glpat-|xox[abposr]-?|AKIA|ASIA|AIza|eyJ|npm_|shpat_|SG\.)/
// the words of a name: `ORDERS_TABLE`, `ordersTable`, `Repo.TABLE`, `by-owner` → [orders, table]…
export const wordsOf = (name) => String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const strong = (words) => words.some((w) => STRONG.has(w))
const weak = (words) => !!words.length && (words[words.length - 1] === 'name' || words.includes('prefix') || words.includes('suffix') || words[0] === 'by')
// a value a credential may be: a known token's prefix, or a long text of high entropy
export function secretValue(v) {
  const s = String(v ?? '')
  if (TOKEN_PREFIX.test(s)) return true
  if (s.length >= 20 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s)) return true
  return /[0-9a-f]{32,}/i.test(s.replace(/[-_]/g, ''))
}
export const tableText = (v) => typeof v === 'string' && TABLE_TEXT.test(v) && !secretValue(v)
// a value that spells its constant's name: every word of the name (two letters or more) in it
const spells = (words, v) => { const low = String(v).toLowerCase(), w = words.filter((x) => x.length >= 2 && !/^\d+$/.test(x)); return w.length > 0 && w.join('').length >= 3 && w.every((x) => low.includes(x)) }
const holed = (v) => String(v).includes('{')

// Where a scanned string sits in a container: the key of a pair (`{ 'PWD': … }`), or a value under
// one. The scanners note it by the string's node (keyed); tableConsts reads it, and nothing of it is
// ever stored (a WeakMap beside the name).
const PLACE = new WeakMap()
const PAIRS = { pair: 'key', keyed_element: null, field_initializer: 'field', keyword_argument: 'name' }
const STOP = /(?:statement|declaration|definition|_item|^function|^arrow_function|^lambda|^block|^module|^program|^source_file)$/
const keyText = (k) => String(k.text || '').replace(/^[rRuUbBfF]*(['"`])/, '').replace(/(['"`])$/, '')
export function keyed(entry, n) {
  let cur = n
  for (let i = 0; i < 24 && cur && cur.parent; i++) {
    const p = cur.parent
    if (STOP.test(p.type)) break
    if (p.type in PAIRS) {
      const f = PAIRS[p.type], k = f ? p.childForFieldName(f) : p.namedChild(0)
      if (k && k.startIndex === cur.startIndex && k.endIndex === cur.endIndex) PLACE.set(entry, { key: true })
      else if (k) PLACE.set(entry, { under: keyText(k) })
      break
    }
    cur = p
  }
  return entry
}
const nameOnly = (x) => ({ text: x.text, line: x.line })
// a function's names: what is table-shaped, never a credential's value
export const tableFns = (fns) => (fns || []).map((f) => ({ ...f, names: (f.names || []).filter((x) => tableText(String(x.text ?? ''))).map(nameOnly) }))
export function tableConsts(list) {
  const out = []
  for (const c of list || []) {
    const words = wordsOf(c.name), secretish = SECRET_NAME.test(String(c.name || ''))
    const byName = strong(words) || (weak(words) && !secretish)
    // a value kept for what its own text says: a template hole, or its constant's name spelled
    const byValue = (v) => !secretish && (holed(v) || spells(words, v))
    if ('value' in c) { if (tableText(c.value) && (byName || byValue(c.value))) out.push(c); continue } // a reader's own shape
    const names = []
    for (const x of c.names || []) {
      const t = String(x.text ?? ''), at = PLACE.get(x)
      if (!tableText(t) || at?.key) continue
      if (at?.under !== undefined) {
        // a container's value: under a table-like key only (`'NAME': 'app'`, `orders_table: …`), or
        // under any key that sounds like no secret when the constant itself names tables (`TABLES`)
        const kw = wordsOf(at.under)
        if (!SECRET_NAME.test(at.under) && (strong(kw) || weak(kw) || kw.includes('name') || (strong(words) && !secretish))) names.push(nameOnly(x))
        continue
      }
      if (byName || byValue(t)) names.push(nameOnly(x))
    }
    if (names.length || (c.env || []).length) out.push({ ...c, names })
  }
  return out
}
