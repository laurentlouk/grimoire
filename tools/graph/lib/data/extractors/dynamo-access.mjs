// grimoire graph · data · extractor: access patterns, the key-value SDK calls code makes (spec D2's
// `inferred` kind, the least trusted: it never overrides a declared fact; research §5, "access patterns
// from the SDK calls"), through the pinned tree-sitter grammars. Per file (.rs; .ts, .mts, .cts, .tsx;
// .js, .mjs, .cjs, .jsx; .py; .go; never a .d.ts), read only when its content shows a call shape below.
// It declares no table: it says which code reaches a table, through which index, writing what.
//
// The call shapes, per language (an operation is query, scan, get, put, update, delete, batch-get,
// batch-write, transact-write, transact-get or check, a transaction's condition check):
//   Rust        an aws-sdk builder chain: the client's `query()`, `put_item()`… or a builder type's
//               `Update::builder()`…, then `.table_name(…)`, `.index_name(…)`,
//               `.key_condition_expression(…)`, `.update_expression(…)`, `.projection_expression(…)`,
//               `.expression_attribute_names(k, v)`, `.item(k, v)`, each also as its `set_…` form
//               (`Some(…)` unwrapped); a chain on any receiver that names an index, a key condition or
//               an update expression is one too (a builder of the project's own: `eb.set_index_name(…)`);
//   TS and JS   an object literal with `TableName`, `IndexName`, `KeyConditionExpression` or
//               `UpdateExpression`: the SDK v3 command it is given to (`new QueryCommand({…})`,
//               the lib-dynamodb ones), the DocumentClient method (`doc.query({…})`), a transaction
//               leg (`{ Update: {…} }`), the input type it is declared as (`QueryCommandInput`), the
//               call it is passed to by name, else what its keys say;
//   Python      boto3: a `query`, `scan`, `get_item`, `put_item`, `update_item`, `delete_item`, batch
//               or transaction call with keyword arguments, on a client (`TableName=`) or a Table
//               (`dynamodb.Table(name)`, directly or through what it was assigned to);
//   Go          an `aws-sdk-go(-v2)` input literal: `&dynamodb.QueryInput{…}`, `types.Update{…}`…, its
//               fields through `aws.String(…)`, `&x`.
// What each call says, as written: the table's name (what builds it, for the binding's name matching:
// readers/names.mjs, data/binding.mjs), the index, the key condition's attributes, the attributes an
// update writes (SET, REMOVE, ADD, DELETE paths, `#names` resolved through ExpressionAttributeNames
// when its map is literal), the attributes a literal put item holds, the projection. A value read from
// a constant of the same file is followed (`.index_name(BY_OWNER)`, `IndexName: Indexes.ByOwner`); one
// from elsewhere is kept by its name, for the binding's constant resolution: a name of the file (an
// import, a top-level name) or one in SCREAMING_CASE, a member only of a module imported whole, never
// a parameter or another object's member (`process.env.X`, `cfg.X`). Nothing is evaluated: a value
// built any other way is kept as unknown, never guessed.
// Never a call: what declares a table or an index (a CreateTable or UpdateTable input, a GSI's or an
// LSI's declaration in code: `GlobalSecondaryIndex::builder()`, `{ IndexName, KeySchema, Projection }`,
// `types.GlobalSecondaryIndex{…}`), the table's administration, an `UpdateExpression` key alone (an
// ESTree visitor's). Test code: the code graph's test paths (lib/langs.mjs TEST_PATH), and each
// language's own marks. Bounded: MAX_SITES calls per file, the walk stopping there; a variable's
// operation found in one pass over the file.
//
// Facts: { declarations: [], access: { lang, path, sites: [Site], fns: [Fn], consts: [Const], notes } };
// a file holding no call but string constants keeps only them (`sites: []`), for other files' calls.
//   Site   { line, fn: index into fns (-1 outside a function), op | null, test?, table: Sink | null
//            (what the call's table argument names), index | null, indexConst? (a constant of another
//            file), indexExpr? (a value not read), key: [attribute] | null, writes: [{ path, clause }],
//            open: count of written paths whose #name is not resolved, item: [attribute] | null,
//            projection: [path] | null }
//   Fn     { name, line, end, test?, names, env, uses }  (readers/code.mjs: what it names a table by)
//   Const  { name, line, names, env, test? }
// A base's file is not read (graph_changes does not compare access patterns; data/base.mjs).
import { codeName } from '../readers/names.mjs'
import { MAX, named, field, lineOf, endOf, cap, push, CONST_NAME, each } from '../readers/code.mjs'
import { readRust, scanUses as rsScan, strOf, isStr, attrOf, isTestAttr, formatParts } from './serde.mjs'
import { readTs, scanUses as tsScan, strVal, knownOf, decls } from './ts-types.mjs'
import { TEST_PATH } from '../../langs.mjs'

export const SRC = /\.(?:rs|ts|mts|cts|tsx|js|mjs|cjs|jsx|py|go)$/i
const DTS = /\.d\.[cm]?ts$/i
export const MAX_SITES = 400
const MAX_EXPR = 4096
export const ACCESS_LANGS = ['rust', 'typescript', 'tsx', 'javascript', 'python', 'go']
export const treeLang = (p) => (/\.rs$/i.test(p) ? 'rust' : /\.tsx$/i.test(p) ? 'tsx' : /\.[cm]?ts$/i.test(p) ? 'typescript' : /\.(?:[cm]?js|jsx)$/i.test(p) ? 'javascript' : /\.py$/i.test(p) ? 'python' : /\.go$/i.test(p) ? 'go' : null)
// the language its constants and functions are resolved in (data/binding.mjs): TypeScript's and
// JavaScript's together, as the item binding names them
const familyOf = (lang) => (lang === 'tsx' || lang === 'typescript' || lang === 'javascript' ? 'ts' : lang)

// What a file holds that this reads (registry.mjs inspect: bit 2): a call shape, or a string constant
// another file's call may name (an exported const, a module-level SCREAMING_CASE name, a Go const;
// Rust's are read for the item binding already, extractors/serde.mjs)
const LEVEL = {
  rust: /\.(?:set_)?(?:index_name|table_name|key_condition_expression|update_expression)\s*\(/,
  ts: /['"]?\b(?:IndexName|TableName|KeyConditionExpression|UpdateExpression)\b['"]?\s*:|^[ \t]*export[ \t]+const[ \t]+[A-Za-z_$][\w$]*[ \t]*(?::[^=\n]+)?=[ \t]*['"`]/m,
  python: /\b(?:IndexName|TableName|KeyConditionExpression|UpdateExpression)\s*=|\bTable\s*\(|^[A-Z][A-Z0-9_]{2,}[ \t]*(?::[^=\n]+)?=[ \t]*[rRuU]?['"]/m,
  go: /\b(?:IndexName|TableName|KeyConditionExpression|UpdateExpression)\s*:|^[ \t]*const[ \t]*(?:\(|\w+(?:[ \t]+\w+)?[ \t]*=[ \t]*["`])/m,
}
export const accessLevel = (p, text) => { const l = treeLang(p); return l && LEVEL[familyOf(l)].test(text) ? 2 : 0 }

// ── expressions: an update's written paths, a key condition's attributes, a projection ──
// A path as the item shape writes it: `#a.b[0].#c` → `a.b[].c`, each #name through the map; null when
// a #name is not in it (the path is open: not compared).
export function normPath(raw, names) {
  const out = []
  for (const tok of String(raw).trim().split('.')) {
    const m = /^([^[\]]*)((?:\[\s*\d*\s*\])*)$/.exec(tok.trim())
    if (!m) return null
    let seg = m[1].trim()
    if (seg.startsWith('#')) { if (!names || typeof names[seg] !== 'string') return null; seg = names[seg] }
    if (!seg && !out.length) return null
    out.push(`${seg}${'[]'.repeat((m[2].match(/\[/g) || []).length)}`)
  }
  return out.length ? out.join('.').replace(/\.\[\]/g, '[]') : null
}
// The top-level pieces of a text, split on a character outside parentheses and brackets.
function splitTop(s, ch) {
  const out = []
  let depth = 0, from = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if ((c === ')' || c === ']') && depth > 0) depth--
    else if (c === ch && depth === 0) { out.push(s.slice(from, i)); from = i + 1 }
  }
  out.push(s.slice(from))
  return out.map((x) => x.trim()).filter(Boolean)
}
const CLAUSES = ['SET', 'REMOVE', 'ADD', 'DELETE']
// UpdateExpression → { writes: [{ path, clause }], open }: SET and REMOVE, ADD and DELETE, each action's path.
export function updatePaths(text, names) {
  const s = String(text ?? '').slice(0, MAX_EXPR)
  const marks = [] // [start of keyword, clause]
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') { depth++; continue }
    if ((c === ')' || c === ']') && depth > 0) { depth--; continue }
    if (depth || (i > 0 && /[\w#:.]/.test(s[i - 1]))) continue
    for (const k of CLAUSES) if (s.slice(i, i + k.length).toUpperCase() === k && !/[\w]/.test(s[i + k.length] || '')) { marks.push([i, k]); i += k.length - 1; break }
  }
  const writes = []
  let open = 0
  marks.forEach(([at, k], j) => {
    const body = s.slice(at + k.length, j + 1 < marks.length ? marks[j + 1][0] : s.length)
    for (const action of splitTop(body, ',')) {
      const raw = k === 'SET' ? splitTop(action, '=')[0] : k === 'REMOVE' ? action : action.split(/\s+/)[0]
      if (!raw || raw.startsWith(':')) continue
      const path = normPath(raw, names)
      if (path === null) { open++; continue }
      if (!writes.some((w) => w.path === path && w.clause === k)) push(writes, { path, clause: k })
    }
  })
  return { writes, open }
}
const WORDS = new Set(['AND', 'OR', 'NOT', 'BETWEEN', 'IN', 'begins_with', 'attribute_exists', 'attribute_not_exists', 'attribute_type', 'contains', 'size'])
// A key condition's (or a condition's) attributes, in order: #names through the map, bare names as written.
export function keyAttrs(text, names) {
  const out = []
  const s = String(text ?? '').slice(0, MAX_EXPR)
  for (const m of s.matchAll(/(^|[^\w:#])(#?[A-Za-z_][\w]*)/g)) {
    const t = m[2]
    if (WORDS.has(t) || WORDS.has(t.toUpperCase())) continue
    const a = t.startsWith('#') ? names?.[t] : t
    if (typeof a === 'string' && !out.includes(a)) push(out, a)
  }
  return out
}
export const projectionPaths = (text, names) => splitTop(String(text ?? '').slice(0, MAX_EXPR), ',').map((p) => normPath(p, names)).filter(Boolean)

// A site from what its call gives, as each language reads it: { op, table, index: Value, key: Value,
// update: Value, projection: Value, names: { map, open }, item: [attr] | null }, a Value being
// { lit, at? } | { const } | { expr } | null.
function site(raw, at, f, test) {
  const s = { line: at, fn: f, op: raw.op || null, ...(test ? { test: true } : {}), table: raw.table && (raw.table.names.length || raw.table.env.length || raw.table.uses.length) ? raw.table : null, index: null, key: null, writes: [], open: 0, item: raw.item || null, projection: null }
  const names = raw.names?.map || null
  if (raw.index) { if (raw.index.lit !== undefined) s.index = raw.index.lit; else if (raw.index.const) s.indexConst = raw.index.const; else if (raw.index.expr) s.indexExpr = cap(raw.index.expr, 80) }
  if (raw.key?.lit !== undefined) s.key = keyAttrs(raw.key.lit, names)
  if (raw.update?.lit !== undefined) { const u = updatePaths(raw.update.lit, names); s.writes = u.writes; s.open = u.open }
  else if (raw.update) s.updateFrom = cap(raw.update.const || raw.update.expr || '', 80)
  if (raw.projection?.lit !== undefined) s.projection = projectionPaths(raw.projection.lit, names)
  if (!s.op) s.op = raw.update ? 'update' : raw.key ? 'query' : raw.item ? 'put' : null
  return s
}
const emptySink = () => ({ names: [], env: [], uses: [] })
const sameNode = (a, b) => !!a && !!b && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type

// ── Rust ──
const RS_OPS = { query: 'query', scan: 'scan', get_item: 'get', put_item: 'put', update_item: 'update', delete_item: 'delete', batch_get_item: 'batch-get', batch_write_item: 'batch-write', transact_write_items: 'transact-write', transact_get_items: 'transact-get' }
const RS_BUILDERS = { Update: 'update', Put: 'put', Delete: 'delete', Get: 'get', ConditionCheck: 'check', PutRequest: 'put', DeleteRequest: 'delete', QueryInput: 'query', ScanInput: 'scan', GetItemInput: 'get', PutItemInput: 'put', UpdateItemInput: 'update', DeleteItemInput: 'delete' }
const RS_PART = { index_name: 'index', set_index_name: 'index', table_name: 'table', set_table_name: 'table', key_condition_expression: 'key', set_key_condition_expression: 'key', update_expression: 'update', set_update_expression: 'update', projection_expression: 'projection', set_projection_expression: 'projection', expression_attribute_names: 'names', set_expression_attribute_names: 'names', item: 'item' }
// What declares a table or an index rather than reaching one: the builder types and the methods of a
// create_table / update_table chain (a chain carrying one is never a call)
const RS_DECL_TYPES = /^(?:GlobalSecondaryIndex|LocalSecondaryIndex|GlobalSecondaryIndexUpdate|ReplicaGlobalSecondaryIndex\w*|\w*SecondaryIndexAction|KeySchemaElement|AttributeDefinition|Projection|ProvisionedThroughput|\w*Description)$/
const RS_DECL_PARTS = new Set(['key_schema', 'set_key_schema', 'projection', 'set_projection', 'attribute_definitions', 'set_attribute_definitions', 'provisioned_throughput', 'set_provisioned_throughput', 'global_secondary_indexes', 'set_global_secondary_indexes', 'local_secondary_indexes', 'set_local_secondary_indexes', 'global_secondary_index_updates', 'set_global_secondary_index_updates', 'billing_mode', 'stream_specification'])
const RS_THROUGH = new Set(['try_expression', 'await_expression', 'parenthesized_expression'])
const RS_UNWRAP = /^(?:to_string|to_owned|into|clone|as_str|as_ref|as_deref|borrow)$/
const argsOf = (call) => { const a = field(call, 'arguments'); return a ? named(a).filter((x) => x.type !== 'line_comment' && x.type !== 'block_comment' && x.type !== 'attribute_item') : [] }
const lastSeg = (n) => n.text.split('::').pop()
// a value as written: a literal, a constant (of this file: followed), else unknown
function rsValue(n, consts, depth = 0) {
  if (!n || depth > 8) return null
  if (isStr(n)) { const v = strOf(n); return v === null ? { expr: n.text } : { lit: v } }
  switch (n.type) {
    case 'reference_expression': return rsValue(field(n, 'value'), consts, depth + 1)
    case 'parenthesized_expression': return rsValue(named(n)[0], consts, depth + 1)
    case 'call_expression': {
      const fn = field(n, 'function'), args = argsOf(n)
      if (fn && fn.type === 'identifier' && fn.text === 'Some' && args.length === 1) return rsValue(args[0], consts, depth + 1)
      if (fn && fn.type === 'scoped_identifier' && /^(?:String::from|String::from_str|Cow::from)$/.test(fn.text.replace(/\s+/g, '')) && args.length === 1) return rsValue(args[0], consts, depth + 1)
      if (fn && fn.type === 'field_expression' && RS_UNWRAP.test(field(fn, 'field')?.text || '') && !args.length) return rsValue(field(fn, 'value'), consts, depth + 1)
      return { expr: n.text }
    }
    case 'identifier': case 'scoped_identifier': {
      const name = lastSeg(n), c = consts.get(name)
      if (c) return { lit: c.value, const: name, at: c.line }
      return CONST_NAME.test(name) ? { const: name } : { expr: n.text }
    }
    default: return { expr: n.text }
  }
}
// `HashMap::from([("#a", "attr"), …])`, `[("#a", "attr")].into_iter().collect()`: the pairs, when all are literal
function rsPairs(n, consts, depth = 0) {
  if (!n || depth > 6) return null
  if (n.type === 'reference_expression' || n.type === 'parenthesized_expression') return rsPairs(named(n)[0] && n.type === 'parenthesized_expression' ? named(n)[0] : field(n, 'value'), consts, depth + 1)
  if (n.type === 'call_expression') {
    const fn = field(n, 'function'), args = argsOf(n)
    if (fn?.type === 'identifier' && fn.text === 'Some' && args.length === 1) return rsPairs(args[0], consts, depth + 1)
    if (fn?.type === 'scoped_identifier' && /(?:^|::)(?:HashMap|BTreeMap)::from$/.test(fn.text.replace(/\s+/g, '')) && args.length === 1) return rsPairs(args[0], consts, depth + 1)
    if (fn?.type === 'field_expression' && /^(?:collect|into_iter|iter|into)$/.test(field(fn, 'field')?.text || '')) return rsPairs(field(fn, 'value'), consts, depth + 1)
    if (fn?.type === 'generic_function') { const g = field(fn, 'function'); if (g?.type === 'field_expression' && /^(?:collect|into)$/.test(field(g, 'field')?.text || '')) return rsPairs(field(g, 'value'), consts, depth + 1) }
    return null
  }
  if (n.type === 'array_expression') {
    const map = {}
    for (const t of named(n)) {
      if (t.type !== 'tuple_expression') return null
      const [k, v] = named(t), kv = rsValue(k, consts), vv = rsValue(v, consts)
      if (kv?.lit === undefined || vv?.lit === undefined) return null
      map[kv.lit] = vv.lit
    }
    return map
  }
  return null
}
// Is this call a receiver, in a chain whose outer call is another (`a().b()`: `a()` is)?
function rsReceiver(call) {
  let p = call.parent
  while (p && RS_THROUGH.has(p.type)) p = p.parent
  if (!p || p.type !== 'field_expression') return false
  let g = p.parent
  if (g && g.type === 'generic_function') g = g.parent
  return !!g && g.type === 'call_expression'
}
function rsChain(call, consts, impl) {
  const parts = []
  let n = call, root = null
  for (let k = 0; k < 96 && n; k++) {
    if (RS_THROUGH.has(n.type)) { n = named(n)[0]; continue }
    if (n.type !== 'call_expression') { root = n; break }
    let fn = field(n, 'function')
    if (fn && fn.type === 'generic_function') fn = field(fn, 'function')
    if (fn && fn.type === 'field_expression') { parts.push({ m: field(fn, 'field')?.text || '', args: argsOf(n) }); n = field(fn, 'value'); continue }
    root = n
    break
  }
  parts.reverse()
  let op = null
  if (root && root.type === 'call_expression') {
    const fn = field(root, 'function')
    if (fn && fn.type === 'scoped_identifier') {
      const type = lastSeg(field(fn, 'path') || fn)
      // a table's or an index's declaration in code (`GlobalSecondaryIndex::builder().index_name(…)`
      // inside `create_table()`): no call reaches the index through it
      if (RS_DECL_TYPES.test(type)) return null
      if (field(fn, 'name')?.text === 'builder') op = RS_BUILDERS[type] || null
    }
  }
  if (parts.some((p) => RS_DECL_PARTS.has(p.m))) return null
  for (const p of parts) if (!op && RS_OPS[p.m] && !p.args.length) op = RS_OPS[p.m]
  const raw = { op, table: null, index: null, key: null, update: null, projection: null, names: { map: {}, open: false }, item: null }
  let any = false, named0 = false
  for (const p of parts) {
    const part = RS_PART[p.m]
    if (!part || !p.args.length) continue
    any = true
    const a = p.args[0]
    if (part === 'table') { if (!raw.table) { raw.table = emptySink(); rsScan(a, { vars: new Map(), impl, ret: null }, raw.table) } }
    else if (part === 'index') { raw.index ||= rsValue(a, consts); named0 = true }
    else if (part === 'key') { raw.key ||= rsValue(a, consts); named0 = true }
    else if (part === 'update') { raw.update ||= rsValue(a, consts); named0 = true }
    else if (part === 'projection') raw.projection ||= rsValue(a, consts)
    else if (part === 'names') {
      if (p.args.length === 2) { const k = rsValue(p.args[0], consts), v = rsValue(p.args[1], consts); if (k?.lit !== undefined && v?.lit !== undefined) raw.names.map[k.lit] = v.lit; else raw.names.open = true }
      else { const m = rsPairs(a, consts); if (m) Object.assign(raw.names.map, m); else raw.names.open = true }
    } else if (part === 'item' && p.args.length === 2) { const k = rsValue(a, consts); if (k?.lit !== undefined) (raw.item ||= []).includes(k.lit) || push(raw.item, k.lit) }
  }
  if (!any || (!op && !named0)) return null
  return raw
}
function readRustAccess(tree, file) {
  const root = tree.rootNode
  const base = readRust(tree)
  const consts = new Map() // a string constant of this file → { value, line }
  each(root, (n) => {
    if ((n.type === 'const_item' || n.type === 'static_item') && field(n, 'name')) { const v = field(n, 'value'); if (v && isStr(v)) { const s = strOf(v); if (s !== null && !consts.has(field(n, 'name').text)) consts.set(field(n, 'name').text, { value: s, line: lineOf(n) }) } return false }
    return true
  })
  const fileTest = TEST_PATH.test(file)
  const fns = base.fns.map(({ name, line, end, test, names, env, uses }) => ({ name, line, end, ...(test || fileTest ? { test: true } : {}), names, env, uses }))
  const sites = []
  const fnIndex = fnIndexer(fns)
  const walk = (list, ctx) => {
    let pending = []
    for (const c of named(list)) {
      if (c.type === 'attribute_item') { pending.push(attrOf(c)); continue }
      const attrs = pending
      pending = []
      if (c.type === 'function_item') {
        const name = field(c, 'name')?.text, body = field(c, 'body')
        if (!name || !body) continue
        const test = ctx.test || isTestAttr(attrs), qual = ctx.impl ? `${ctx.impl}::${name}` : name
        let f = null
        each(body, (n) => {
          if (sites.length >= MAX_SITES) return false
          if (n.type === 'call_expression' && !rsReceiver(n)) {
            const raw = rsChain(n, consts, ctx.impl)
            if (raw) { if (f === null) f = fnIndex(qual, lineOf(c), endOf(c), test); push(sites, site(raw, lineOf(n), f, test), MAX_SITES) }
          }
          return true
        })
        continue
      }
      if (c.type === 'mod_item') { const b = field(c, 'body'); if (b) walk(b, { ...ctx, test: ctx.test || isTestAttr(attrs) }); continue }
      if (c.type === 'impl_item' || c.type === 'trait_item') { const b = field(c, 'body'), t = field(c, 'type') || field(c, 'name'); if (b) walk(b, { ...ctx, impl: t ? lastSeg(t.type === 'generic_type' ? field(t, 'type') || t : t) : ctx.impl }); continue }
    }
  }
  walk(root, { test: fileTest, impl: null })
  return { lang: 'rust', sites, fns, consts: base.consts, notes: base.notes }
}
// A function's index in a file's list, found by its name and line in constant time, added (with
// nothing it names) when the list does not hold it.
function fnIndexer(fns) {
  const at = new Map(fns.map((f, i) => [`${f.line}\0${f.name}`, i]))
  return (name, line, end, test) => {
    const k = `${line}\0${name}`
    if (at.has(k)) return at.get(k)
    if (fns.length >= MAX.fns) return -1
    fns.push({ name, line, end, ...(test ? { test: true } : {}), names: [], env: [], uses: [] })
    at.set(k, fns.length - 1)
    return fns.length - 1
  }
}

// ── TypeScript and JavaScript ──
const TS_OPS = { Query: 'query', Scan: 'scan', GetItem: 'get', Get: 'get', PutItem: 'put', Put: 'put', UpdateItem: 'update', Update: 'update', DeleteItem: 'delete', Delete: 'delete', BatchGetItem: 'batch-get', BatchGet: 'batch-get', BatchWriteItem: 'batch-write', BatchWrite: 'batch-write', TransactWriteItems: 'transact-write', TransactWrite: 'transact-write', TransactGetItems: 'transact-get', TransactGet: 'transact-get', ExecuteStatement: null }
const TS_METHODS = { query: 'query', scan: 'scan', get: 'get', getItem: 'get', put: 'put', putItem: 'put', update: 'update', updateItem: 'update', delete: 'delete', deleteItem: 'delete', batchGet: 'batch-get', batchGetItem: 'batch-get', batchWrite: 'batch-write', batchWriteItem: 'batch-write', transactWrite: 'transact-write', transactWriteItems: 'transact-write', transactGet: 'transact-get', transactGetItems: 'transact-get', paginateQuery: 'query', paginateScan: 'scan' }
const TS_LEGS = { Update: 'update', Put: 'put', Delete: 'delete', Get: 'get', ConditionCheck: 'check' }
const TS_SITE_KEYS = new Set(['TableName', 'IndexName', 'KeyConditionExpression', 'UpdateExpression'])
// What declares a table or an index rather than reaching one: an object holding one of these keys
// (a CreateTable or UpdateTable input, a GSI's or an LSI's declaration), or one these keys hold
const TS_DECL_KEYS = new Set(['KeySchema', 'AttributeDefinitions', 'Projection', 'ProvisionedThroughput', 'BillingMode', 'StreamSpecification', 'GlobalSecondaryIndexes', 'LocalSecondaryIndexes', 'GlobalSecondaryIndexUpdates', 'ReplicaUpdates', 'Replicas'])
const TS_DECL_UNDER = new Set(['GlobalSecondaryIndexes', 'LocalSecondaryIndexes', 'GlobalSecondaryIndexUpdates', 'ReplicaUpdates', 'Replicas', 'ReplicaGlobalSecondaryIndexUpdates'])
// a command or a method of the table's administration, never one reaching its items
const TS_ADMIN = /^(?:create|update|delete|describe)(?:Global)?Table$|TimeToLive|ContinuousBackups|Backup|Export|Import|ContributorInsights|KinesisStreamingDestination|TagResource/i
const FN_VALUE = /^(?:arrow_function|function_expression|function|generator_function|method_definition)$/
const TEST_TS = /\.(?:test|spec)\.[cm]?[jt]sx?$/i
const opOfCommand = (name) => { const m = /^(\w+?)Command$/.exec(name || ''); return m && m[1] in TS_OPS ? TS_OPS[m[1]] : null }
const opOfType = (name) => { const m = /^(\w+?)(?:Command)?Input$/.exec(name || ''); return m && m[1] in TS_OPS ? TS_OPS[m[1]] : null }
const tsKey = (n) => (!n ? null : n.type === 'string' ? strVal(n) : n.type === 'property_identifier' || n.type === 'identifier' ? n.text : null)
const typeNameOf = (n) => { let t = n; while (t && (t.type === 'type_annotation' || t.type === 'generic_type')) t = t.type === 'generic_type' ? field(t, 'name') || named(t)[0] : named(t)[0]; return t ? t.text.split('.').pop() : null }
const lastProp = (n) => (!n ? null : n.type === 'identifier' ? n.text : n.type === 'member_expression' ? field(n, 'property')?.text ?? null : null)
// a string a TS value holds as written: a literal, a template literal with nothing filled in
function tsLit(n) {
  if (!n) return null
  if (n.type === 'string') return strVal(n)
  if (n.type === 'template_string' && !named(n).some((x) => x.type === 'template_substitution')) return named(n).map((x) => x.text).join('')
  if (n.type === 'as_expression' || n.type === 'satisfies_expression' || n.type === 'parenthesized_expression') return tsLit(named(n)[0])
  return null
}
function tsValue(n, consts, depth = 0) {
  if (!n || depth > 8) return null
  const lit = tsLit(n)
  if (lit !== null) return { lit }
  if (n.type === 'as_expression' || n.type === 'satisfies_expression' || n.type === 'parenthesized_expression' || n.type === 'non_null_expression') return tsValue(named(n)[0], consts, depth + 1)
  if (n.type === 'identifier' || n.type === 'member_expression') {
    const key = n.text.replace(/\s+/g, '').replace(/^this\./, ''), c = consts.get(key)
    if (c) return { lit: c.value, const: key, at: c.line }
    // a name of the file (a constant, an import) or one in SCREAMING_CASE: resolved elsewhere by the
    // binding; a member only of a module imported whole (`import * as C`, `require`), never of another
    // object (`process.env.X`, `cfg.X`: unknown, never a constant of the same name elsewhere)
    if (n.type === 'identifier') return CONST_NAME.test(n.text) || consts.known?.has(n.text) ? { const: n.text } : { expr: n.text }
    const obj = field(n, 'object'), prop = field(n, 'property')?.text
    return obj?.type === 'identifier' && consts.modules?.has(obj.text) && prop ? { const: prop } : { expr: n.text }
  }
  return { expr: n.text }
}
const tsPairs = (o, consts) => {
  if (!o || o.type !== 'object') return null
  const map = {}
  for (const p of named(o)) {
    if (p.type !== 'pair') return null
    const k = tsKey(field(p, 'key')), v = tsValue(field(p, 'value'), consts)
    if (k === null || v?.lit === undefined) return null
    map[k] = v.lit
  }
  return map
}
function readTsAccess(tree, file, lang) {
  const root = tree.rootNode
  const base = readTs(tree, file)
  const test = TEST_TS.test(file) || TEST_PATH.test(file)
  const known = knownOf(root)
  for (const c of base.consts) known.add(c.name)
  // the file's string constants: `const X = 'x'`, an object's (`Obj.key`), an enum's (`E.Member`);
  // another name of the file (an import) is a constant to resolve elsewhere, a parameter is not; the
  // modules imported whole (`import * as C from …`, `const C = require(…)`), whose members may be
  const consts = new Map(), modules = new Set()
  consts.known = known
  consts.modules = modules
  for (const top of named(root)) {
    if (top.type === 'import_statement') each(top, (x) => { if (x.type === 'namespace_import') { const id = named(x).find((y) => y.type === 'identifier'); if (id) modules.add(id.text) } return true })
    const c = decls(top)
    if (!c) continue
    if (c.type === 'lexical_declaration' || c.type === 'variable_declaration') {
      for (const v of named(c)) {
        if (v.type !== 'variable_declarator' || field(v, 'name')?.type !== 'identifier') continue
        const name = field(v, 'name').text, val = field(v, 'value')
        if (val?.type === 'call_expression' && field(val, 'function')?.text === 'require') { modules.add(name); continue }
        const lit = tsLit(val)
        if (lit !== null) { consts.set(name, { value: lit, line: lineOf(v) }); continue }
        let o = val
        while (o && (o.type === 'as_expression' || o.type === 'satisfies_expression')) o = named(o)[0]
        if (o && o.type === 'object') for (const p of named(o)) { if (p.type !== 'pair') continue; const k = tsKey(field(p, 'key')), l = tsLit(field(p, 'value')); if (k !== null && l !== null) consts.set(`${name}.${k}`, { value: l, line: lineOf(p) }) }
      }
    } else if (c.type === 'enum_declaration') {
      const name = field(c, 'name')?.text, body = field(c, 'body')
      for (const m of body ? named(body) : []) if (m.type === 'enum_assignment') { const k = tsKey(field(m, 'name') || named(m)[0]), l = tsLit(field(m, 'value')); if (name && k !== null && l !== null) consts.set(`${name}.${k}`, { value: l, line: lineOf(m) }) }
    } else if (c.type === 'class_declaration' || c.type === 'abstract_class_declaration') {
      const cname = field(c, 'name')?.text, body = field(c, 'body')
      for (const m of body ? named(body) : []) if ((m.type === 'public_field_definition' || m.type === 'field_definition') && field(m, 'value')) { const k = tsKey(field(m, 'name') || field(m, 'property')), l = tsLit(field(m, 'value')); if (cname && k !== null && l !== null) { consts.set(`${cname}.${k}`, { value: l, line: lineOf(m) }); consts.set(k, consts.get(k) || { value: l, line: lineOf(m) }) } }
    }
  }
  const fns = base.fns.map(({ name, line, end, test: t, names, env, uses }) => ({ name, line, end, ...(t || test ? { test: true } : {}), names, env, uses }))
  const FN = /^(?:function_declaration|generator_function_declaration|method_definition|arrow_function|function_expression|function|generator_function)$/
  // the function holding a node, named as readTs names it (a method by its class, an arrow by what
  // holds it: a variable, a class field, the export default, what it is assigned to, `exports.h`)
  const enclosing = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (!FN.test(p.type)) continue
      let name = null
      if (p.type === 'function_declaration' || p.type === 'generator_function_declaration') name = field(p, 'name')?.text
      else if (p.type === 'method_definition') { const cls = classOf(p); name = `${cls}.${tsKey(field(p, 'name')) || '(method)'}` }
      else {
        const h = p.parent
        if (h?.type === 'variable_declarator') name = field(h, 'name')?.text
        else if (h && (h.type === 'public_field_definition' || h.type === 'field_definition')) name = `${classOf(h)}.${tsKey(field(h, 'name') || field(h, 'property'))}`
        else if (h?.type === 'export_statement') name = '(default)'
        else if (h?.type === 'assignment_expression') name = cap(field(h, 'left')?.text.replace(/\s+/g, '') || '', 80) || null
        else continue // a callback: it belongs to the function around it
      }
      return { node: p, name: name || '(function)' }
    }
    return null
  }
  const classOf = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'class_declaration' || p.type === 'abstract_class_declaration' || p.type === 'class') return field(p, 'name')?.text || '(class)'; return '(class)' }
  const indexOfFn = fnIndexer(fns)
  const fnIndex = (e) => (e ? indexOfFn(e.name, lineOf(e.node), endOf(e.node), test) : -1)
  // The operation a variable holding the input is given to (`doc.query(params)`, `new
  // QueryCommand(params)`): the first call after its declaration, within the block that declares it,
  // that takes it by name. One pass over the file, the first time it is asked: every call or `new`
  // taking an identifier, by name, in source order; then a binary search per variable.
  let given = null
  const givenTo = () => {
    if (given) return given
    given = new Map()
    each(root, (n) => {
      if (n.type !== 'new_expression' && n.type !== 'call_expression') return true
      const args = field(n, 'arguments')
      for (const a of args ? named(args) : []) {
        if (a.type !== 'identifier') continue
        if (!given.has(a.text)) given.set(a.text, [])
        given.get(a.text).push({ at: n.startIndex, op: n.type === 'new_expression' ? opOfCommand(lastProp(field(n, 'constructor'))) : TS_METHODS[lastProp(field(n, 'function'))] || null, admin: TS_ADMIN.test(lastProp(n.type === 'new_expression' ? field(n, 'constructor') : field(n, 'function')) || '') })
      }
      return true
    })
    return given
  }
  const BLOCK = /^(?:statement_block|program|arrow_function|function_expression|function|function_declaration|method_definition|class_body|switch_case)$/
  const passedTo = (decl, name) => {
    let scope = decl.parent
    while (scope && !BLOCK.test(scope.type)) scope = scope.parent
    const list = givenTo().get(name) || []
    let lo = 0, hi = list.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].at < decl.endIndex) lo = mid + 1; else hi = mid }
    const hit = list[lo]
    return hit && (!scope || hit.at < scope.endIndex) ? hit : null
  }
  // the operation an input object is given to, and whether it goes to the table's administration
  const opOf = (o) => {
    let p = o.parent
    while (p && (p.type === 'as_expression' || p.type === 'satisfies_expression' || p.type === 'parenthesized_expression')) {
      if (p.type !== 'parenthesized_expression') { const t = opOfType(typeNameOf(named(p)[1])); if (t) return { op: t } }
      p = p.parent
    }
    if (!p) return { op: null }
    if (p.type === 'arguments') {
      const call = p.parent, callee = call?.type === 'new_expression' ? lastProp(field(call, 'constructor')) : call?.type === 'call_expression' ? lastProp(field(call, 'function')) : null
      if (TS_ADMIN.test(callee || '')) return { admin: true }
      if (call?.type === 'new_expression') return { op: opOfCommand(callee), sdk: /Command$/.test(callee || '') }
      if (call?.type === 'call_expression') return { op: TS_METHODS[callee] || null, sdk: !!TS_METHODS[callee] }
    }
    if (p.type === 'pair') return { op: TS_LEGS[tsKey(field(p, 'key'))] || null, sdk: !!TS_LEGS[tsKey(field(p, 'key'))] }
    if (p.type === 'variable_declarator') {
      const t = opOfType(typeNameOf(field(p, 'type')))
      if (t) return { op: t, sdk: true }
      const name = field(p, 'name')
      const hit = name?.type === 'identifier' ? passedTo(p, name.text) : null
      if (hit?.admin) return { admin: true }
      if (hit) return { op: hit.op, sdk: !!hit.op }
    }
    return { op: null }
  }
  // inside a GSI's or an LSI's declaration, a CreateTable's or an UpdateTable's: no call
  const declared = (o) => {
    let n = o
    for (let k = 0; k < 8 && n.parent; k++) {
      const p = n.parent
      if (p.type === 'pair' && TS_DECL_UNDER.has(tsKey(field(p, 'key')))) return true
      if (!/^(?:object|array|pair|as_expression|satisfies_expression|parenthesized_expression)$/.test(p.type)) return false
      n = p
    }
    return false
  }
  const sites = []
  each(root, (o) => {
    if (sites.length >= MAX_SITES) return false
    if (o.type !== 'object') return true
    const pairs = new Map()
    for (const p of named(o)) if (p.type === 'pair') { const k = tsKey(field(p, 'key')); if (k !== null && !pairs.has(k)) pairs.set(k, field(p, 'value')) }
    if (![...pairs.keys()].some((k) => TS_SITE_KEYS.has(k))) return true
    if ([...pairs.keys()].some((k) => TS_DECL_KEYS.has(k)) || declared(o)) return true
    const how = opOf(o)
    if (how.admin) return true
    // an UpdateExpression alone (an ESTree visitor's key, say) is no call: it holds a text, beside the
    // item's Key or given to an SDK command or method
    if (!pairs.has('TableName') && !pairs.has('IndexName') && !pairs.has('KeyConditionExpression')) {
      const u = pairs.get('UpdateExpression')
      if (!u || FN_VALUE.test(u.type) || u.type === 'object' || !(pairs.has('Key') || how.sdk)) return true
    }
    const e = enclosing(o), f = fnIndex(e)
    const cls = e && e.name.includes('.') ? e.name.slice(0, e.name.indexOf('.')) : null
    const raw = { op: how.op, table: null, index: null, key: null, update: null, projection: null, names: { map: {}, open: false }, item: null }
    if (pairs.has('TableName')) { raw.table = emptySink(); tsScan(pairs.get('TableName'), { vars: new Map(), known, cls, ret: null }, raw.table) }
    if (pairs.has('IndexName')) raw.index = tsValue(pairs.get('IndexName'), consts)
    if (pairs.has('KeyConditionExpression')) raw.key = tsValue(pairs.get('KeyConditionExpression'), consts)
    if (pairs.has('UpdateExpression')) raw.update = tsValue(pairs.get('UpdateExpression'), consts)
    if (pairs.has('ProjectionExpression')) raw.projection = tsValue(pairs.get('ProjectionExpression'), consts)
    if (pairs.has('ExpressionAttributeNames')) { const v = pairs.get('ExpressionAttributeNames'), m = tsPairs(v, consts); if (m) raw.names.map = m; else raw.names.open = true }
    if (pairs.has('Item') && pairs.get('Item')?.type === 'object') raw.item = named(pairs.get('Item')).map((p) => (p.type === 'pair' ? tsKey(field(p, 'key')) : p.type === 'shorthand_property_identifier' ? p.text : null)).filter((k) => k !== null).slice(0, MAX.per)
    push(sites, site(raw, lineOf(o), f, test || !!(f >= 0 && fns[f].test)), MAX_SITES)
    return true
  })
  return { lang: 'ts', sites, fns, consts: base.consts, notes: base.notes }
}

// ── Python (boto3) ──
const PY_OPS = { query: 'query', scan: 'scan', get_item: 'get', put_item: 'put', update_item: 'update', delete_item: 'delete', batch_get_item: 'batch-get', batch_write_item: 'batch-write', transact_write_items: 'transact-write', transact_get_items: 'transact-get' }
const PY_KW = new Set(['TableName', 'IndexName', 'KeyConditionExpression', 'UpdateExpression', 'ExpressionAttributeNames', 'ProjectionExpression', 'Item', 'Key'])
const TEST_PY = /(?:^|\/)(?:test_[^/]*|[^/]*_test|conftest)\.py$/i
const pyUnescape = (s) => s.replace(/\\(n|t|r|0|\\|'|")/g, (_, c) => ({ n: '\n', t: '\t', r: '\r', 0: '\0' })[c] ?? c)
// a string's parts: literal text, and null for each {…} an f-string fills in
function pyStrParts(n) {
  if (n.type === 'concatenated_string') { const out = []; for (const s of named(n)) { const p = pyStrParts(s); if (!p) return null; out.push(...p) } return out }
  if (n.type !== 'string') return null
  const start = named(n).find((x) => x.type === 'string_start')?.text || ''
  const f = /f/i.test(start.replace(/['"]/g, '')), raw = /r/i.test(start.replace(/['"]/g, '')), bytes = /b/i.test(start.replace(/['"]/g, ''))
  if (bytes) return null
  const out = []
  for (const c of named(n)) {
    if (c.type === 'string_content') out.push(raw ? c.text : pyUnescape(c.text))
    else if (c.type === 'escape_sequence') out.push(pyUnescape(c.text))
    else if (c.type === 'interpolation') { if (!f) return null; out.push(null) }
  }
  return out.length ? out : ['']
}
const pyLit = (n) => { if (!n) return null; const p = pyStrParts(n); return p && p.every((x) => x !== null) ? p.join('') : null }
// what builds a string: a literal, an f-string, `+`, `%` and `.format(…)` on a literal
function pyParts(n, depth = 0) {
  if (!n || depth > 16) return null
  if (n.type === 'string' || n.type === 'concatenated_string') return pyStrParts(n)
  if (n.type === 'parenthesized_expression') return pyParts(named(n)[0], depth + 1)
  if (n.type === 'binary_operator') {
    const op = field(n, 'operator')?.type, l = field(n, 'left'), r = field(n, 'right')
    if (op === '+') { const a = pyParts(l, depth + 1), b = pyParts(r, depth + 1); return a || b ? [...(a || [null]), ...(b || [null])] : null }
    if (op === '%') { const s = pyLit(l); return s === null ? null : s.split(/%[-#0 +]*\d*(?:\.\d+)?[sdirfx]/).flatMap((x, i) => (i ? [null, x] : [x])) }
    return null
  }
  if (n.type === 'call') {
    const fn = field(n, 'function')
    if (fn?.type === 'attribute' && field(fn, 'attribute')?.text === 'format') { const s = pyLit(field(fn, 'object')); return s === null ? null : formatParts(s) }
  }
  return null
}
const PY_ENV = /^(?:os\.)?(?:environ\.get|getenv)$/
function pyScan(root, ctx, sink) {
  each(root, (n) => {
    if (n.type === 'string' || n.type === 'concatenated_string' || (n.type === 'binary_operator' && /^[+%]$/.test(field(n, 'operator')?.type || '')) || (n.type === 'call' && field(field(n, 'function'), 'attribute')?.text === 'format')) {
      const parts = pyParts(n)
      if (parts && (n.type === 'string' || n.type === 'concatenated_string' || parts.some((p) => p !== null))) {
        const p = codeName(parts)
        if (p) push(sink.names, { text: p, line: lineOf(n) })
        each(n, (x) => (x === n ? true : x.type === 'string' ? (named(x).filter((i) => i.type === 'interpolation').forEach((i) => pyScan(i, ctx, sink)), false) : visitPy(x, ctx, sink) !== false))
        return false
      }
    }
    return visitPy(n, ctx, sink) !== false
  })
}
function visitPy(n, ctx, sink) {
  if (n.type === 'subscript' && /^(?:os\.)?environ$/.test(field(n, 'value')?.text || '')) { const s = pyLit(field(n, 'subscript')); if (s !== null) push(sink.env, { name: s, line: lineOf(n) }); return false }
  if (n.type === 'call' && PY_ENV.test((field(n, 'function')?.text || '').replace(/\s+/g, ''))) { const a = named(field(n, 'arguments') || n)[0], s = pyLit(a); if (s !== null) push(sink.env, { name: s, line: lineOf(n) }); return false }
  if (n.type === 'identifier' && (ctx.known.has(n.text) || CONST_NAME.test(n.text)) && !sink.uses.includes(n.text) && !(n.parent?.type === 'keyword_argument' && sameNode(field(n.parent, 'name'), n))) { push(sink.uses, n.text); return }
  if (n.type === 'attribute' && CONST_NAME.test(field(n, 'attribute')?.text || '')) { const a = field(n, 'attribute').text; if (!sink.uses.includes(a)) push(sink.uses, a); return false }
}
function pyValue(n, consts) {
  if (!n) return null
  const s = pyLit(n)
  if (s !== null) return { lit: s }
  if (n.type === 'identifier') {
    const c = consts.get(n.text)
    if (c) return { lit: c.value, const: n.text, at: c.line }
    return CONST_NAME.test(n.text) || consts.known?.has(n.text) ? { const: n.text } : { expr: n.text }
  }
  if (n.type === 'attribute') {
    // a class's own constant (`self.X`, `cls.X`, `Repo.X`), a module's imported whole (`consts.X`);
    // never another object's (`settings.X`, `os.environ`: unknown, never a constant of that name elsewhere)
    const obj = field(n, 'object'), name = field(n, 'attribute')?.text
    const owner = obj?.type === 'identifier' ? obj.text : null
    if (owner && name && (owner === 'self' || owner === 'cls' || consts.classes?.has(owner))) { const c = consts.get(name); if (c) return { lit: c.value, const: name, at: c.line } }
    if (owner && name && consts.modules?.has(owner)) return { const: name }
    return { expr: n.text }
  }
  return { expr: n.text }
}
const pyDict = (n) => {
  if (!n || n.type !== 'dictionary') return null
  const map = {}
  for (const p of named(n)) { if (p.type !== 'pair') return null; const k = pyLit(field(p, 'key')), v = pyLit(field(p, 'value')); if (k === null || v === null) return null; map[k] = v }
  return map
}
// `Key('a').eq(v) & Key('b').begins_with(p)` (boto3.dynamodb.conditions): its attributes
const pyKeyAttrs = (n) => { const out = []; each(n, (x) => { if (x.type === 'call' && /^(?:\w+\.)*Key$/.test(field(x, 'function')?.text || '')) { const s = pyLit(named(field(x, 'arguments') || x)[0]); if (s !== null && !out.includes(s)) push(out, s) } return true }); return out }
const isTableCall = (n) => n?.type === 'call' && /(?:^|\.)Table$/.test((field(n, 'function')?.text || '').replace(/\s+/g, ''))
function readPython(tree, file) {
  const root = tree.rootNode
  const fileTest = TEST_PY.test(file) || TEST_PATH.test(file)
  const known = new Set(), consts = new Map(), constList = []
  consts.known = known
  // the classes of the file, and the modules it imports whole (`import consts`, `from app import consts`)
  consts.classes = new Set()
  consts.modules = new Set()
  for (const st of named(root)) {
    if (st.type === 'import_statement') for (const x of named(st)) { const id = x.type === 'aliased_import' ? field(x, 'alias') : x.type === 'dotted_name' ? named(x)[0] : null; if (id) consts.modules.add(id.text) }
    if (st.type === 'import_from_statement') for (const x of named(st).slice(1)) { const id = x.type === 'aliased_import' ? field(x, 'alias') : x.type === 'dotted_name' && named(x).length === 1 && !CONST_NAME.test(x.text) ? named(x)[0] : null; if (id) consts.modules.add(id.text) }
  }
  each(root, (n) => { if (n.type === 'class_definition' && field(n, 'name')) consts.classes.add(field(n, 'name').text); return n.type !== 'function_definition' })
  // module-level and class-level assignments: constants by name, and what a Table is bound to
  const tables = new Map() // an assignment's target, as written (`table`, `self.table`) → the Table(…) argument
  const assigns = (scope, cls) => {
    for (const st of named(scope)) {
      const a = st.type === 'expression_statement' ? named(st)[0] : null
      if (!a || a.type !== 'assignment') continue
      const l = field(a, 'left'), r = field(a, 'right')
      if (l?.type !== 'identifier' || !r) continue
      known.add(l.text)
      const s = pyLit(r)
      if (s !== null && !consts.has(l.text)) consts.set(l.text, { value: s, line: lineOf(a) })
      if (!cls) { const sink = emptySink(); pyScan(r, { known: new Set() }, sink); if (sink.names.length || sink.env.length) push(constList, { name: l.text, line: lineOf(a), names: sink.names, env: sink.env, ...(fileTest ? { test: true } : {}) }, MAX.fns) }
    }
  }
  assigns(root, null)
  each(root, (n) => {
    if (n.type === 'class_definition') { const b = field(n, 'body'); if (b) assigns(b, field(n, 'name')?.text) }
    if (n.type === 'assignment' && isTableCall(field(n, 'right'))) { const l = field(n, 'left'); if (l && !tables.has(l.text)) tables.set(l.text.replace(/\s+/g, ''), named(field(field(n, 'right'), 'arguments'))[0] || null) }
    return true
  })
  const fns = [], sites = []
  const fnOf = (def, name, test) => {
    const body = field(def, 'body')
    const sink = emptySink()
    if (body) pyScan(body, { known }, sink)
    const i = fns.length
    push(fns, { name, line: lineOf(def), end: endOf(def), ...(test ? { test: true } : {}), ...sink }, MAX.fns)
    if (body) scan(body, i < MAX.fns ? i : -1, test)
  }
  const scan = (scope, f, test) => each(scope, (n) => {
    if (sites.length >= MAX_SITES) return false
    if (n.type === 'function_definition' && f >= 0) return true // a nested function belongs to its function
    if (n.type !== 'call') return true
    const fn = field(n, 'function')
    if (fn?.type !== 'attribute') return true
    const op = PY_OPS[field(fn, 'attribute')?.text]
    if (!op) return true
    const recv = field(fn, 'object'), kw = new Map()
    for (const a of named(field(n, 'arguments') || n)) if (a.type === 'keyword_argument') kw.set(field(a, 'name')?.text, field(a, 'value'))
    const tableArg = isTableCall(recv) ? named(field(recv, 'arguments'))[0] || null : recv ? tables.get(recv.text.replace(/\s+/g, '')) ?? null : null
    const onTable = isTableCall(recv) || (recv && tables.has(recv.text.replace(/\s+/g, '')))
    if (![...kw.keys()].some((k) => PY_KW.has(k)) && !onTable) return true
    const raw = { op, table: null, index: null, key: null, update: null, projection: null, names: { map: {}, open: false }, item: null }
    const tnode = kw.get('TableName') || tableArg
    if (tnode) { raw.table = emptySink(); pyScan(tnode, { known }, raw.table) }
    if (kw.has('IndexName')) raw.index = pyValue(kw.get('IndexName'), consts)
    if (kw.has('KeyConditionExpression')) { const v = kw.get('KeyConditionExpression'); raw.key = pyValue(v, consts); if (raw.key?.lit === undefined) raw.keyAttrs = pyKeyAttrs(v) }
    if (kw.has('UpdateExpression')) raw.update = pyValue(kw.get('UpdateExpression'), consts)
    if (kw.has('ProjectionExpression')) raw.projection = pyValue(kw.get('ProjectionExpression'), consts)
    if (kw.has('ExpressionAttributeNames')) { const m = pyDict(kw.get('ExpressionAttributeNames')); if (m) raw.names.map = m; else raw.names.open = true }
    if (kw.get('Item')?.type === 'dictionary') raw.item = named(kw.get('Item')).map((p) => (p.type === 'pair' ? pyLit(field(p, 'key')) : null)).filter((k) => k !== null).slice(0, MAX.per)
    const s = site(raw, lineOf(n), f, test)
    if (raw.keyAttrs?.length) s.key = raw.keyAttrs
    push(sites, s, MAX_SITES)
    return true
  })
  const walk = (scope, cls, test) => {
    for (const c of named(scope)) {
      const d = c.type === 'decorated_definition' ? field(c, 'definition') : c
      if (!d) continue
      if (d.type === 'function_definition') { const name = field(d, 'name')?.text || '(function)'; fnOf(d, cls ? `${cls}.${name}` : name, test || /^test/.test(name)); continue }
      if (d.type === 'class_definition') { const name = field(d, 'name')?.text || '(class)', b = field(d, 'body'); if (b) walk(b, name, test || /^Test/.test(name)); continue }
      scan(c, -1, test) // a statement at module level
    }
  }
  walk(root, null, fileTest)
  return { lang: 'python', sites, fns: reindex(fns, sites), consts: constList, notes: [] }
}

// ── Go (aws-sdk-go and aws-sdk-go-v2) ──
const GO_TYPES = { QueryInput: 'query', ScanInput: 'scan', GetItemInput: 'get', PutItemInput: 'put', UpdateItemInput: 'update', DeleteItemInput: 'delete', BatchGetItemInput: 'batch-get', BatchWriteItemInput: 'batch-write', TransactWriteItemsInput: 'transact-write', TransactGetItemsInput: 'transact-get' }
const GO_LEGS = { Update: 'update', Put: 'put', Delete: 'delete', Get: 'get', ConditionCheck: 'check' }
const GO_KEYS = new Set(['TableName', 'IndexName', 'KeyConditionExpression', 'UpdateExpression'])
const goLit = (n) => {
  if (!n) return null
  if (n.type === 'raw_string_literal') return n.text.slice(1, -1)
  if (n.type === 'interpreted_string_literal') { try { return JSON.parse(n.text) } catch { return n.text.slice(1, -1) } }
  return null
}
// `fmt.Sprintf("%s-shop-orders", env)`: its parts, each verb a part filled in
const goFormat = (s) => s.split(/%[-+# 0]*\d*(?:\.\d+)?[svdqx]/).flatMap((x, i) => (i ? [null, x] : [x]))
const goUnwrap = (n) => {
  for (let k = 0; n && k < 6; k++) {
    if (n.type === 'unary_expression' || n.type === 'parenthesized_expression') { n = field(n, 'operand') || named(n)[0]; continue }
    if (n.type === 'call_expression' && /^aws\.(?:String|StringValue)$/.test(field(n, 'function')?.text || '')) { n = named(field(n, 'arguments'))[0]; continue }
    break
  }
  return n
}
function goScan(root, ctx, sink) {
  each(root, (n) => {
    const s = goLit(n)
    if (s !== null) { const p = codeName([s]); if (p) push(sink.names, { text: p, line: lineOf(n) }); return false }
    if (n.type === 'call_expression') {
      const f = field(n, 'function')?.text || '', args = named(field(n, 'arguments') || n)
      if (/^fmt\.Sprintf?$/.test(f)) { const fs = goLit(args[0]); if (fs !== null) { const p = codeName(f === 'fmt.Sprintf' ? goFormat(fs) : [fs]); if (p) push(sink.names, { text: p, line: lineOf(n) }); for (const a of args.slice(1)) goScan(a, ctx, sink); return false } }
      if (/^os\.(?:Getenv|LookupEnv)$/.test(f)) { const e = goLit(args[0]); if (e !== null) push(sink.env, { name: e, line: lineOf(n) }); return false }
    }
    if (n.type === 'identifier' && ctx.known.has(n.text) && !sink.uses.includes(n.text)) push(sink.uses, n.text)
    return true
  })
}
const goValue = (n, consts) => {
  n = goUnwrap(n)
  if (!n) return null
  const s = goLit(n)
  if (s !== null) return { lit: s }
  if (n.type === 'identifier') { const c = consts.get(n.text); return c ? { lit: c.value, const: n.text, at: c.line } : consts.known?.has(n.text) || CONST_NAME.test(n.text) ? { const: n.text } : { expr: n.text } }
  return { expr: n.text }
}
// a literal_value's fields: Map(key → value node)
const goFields = (body) => {
  const m = new Map()
  for (const e of body ? named(body) : []) {
    if (e.type !== 'keyed_element') continue
    const [k, v] = named(e)
    const key = k ? (k.type === 'literal_element' ? named(k)[0] : k) : null
    const val = v ? (v.type === 'literal_element' ? named(v)[0] : v) : null
    if (key && (key.type === 'identifier' || key.type === 'field_identifier')) m.set(key.text, val)
    else if (key) { const s = goLit(key); if (s !== null) m.set(s, val) }
  }
  return m
}
function readGo(tree, file) {
  const root = tree.rootNode
  const fileTest = /_test\.go$/i.test(file) || TEST_PATH.test(file)
  const known = new Set(), consts = new Map(), constList = []
  consts.known = known
  for (const d of named(root)) {
    if (d.type !== 'const_declaration' && d.type !== 'var_declaration') continue
    each(d, (s) => {
      if (s.type !== 'const_spec' && s.type !== 'var_spec') return true
      const names = s.namedChildren ? named(s).filter((x) => x.type === 'identifier') : []
      const vals = field(s, 'value') ? named(field(s, 'value')) : []
      names.forEach((nm, i) => {
        known.add(nm.text)
        const v = vals[i]
        if (!v) return
        const lit = goLit(v)
        if (lit !== null && !consts.has(nm.text)) consts.set(nm.text, { value: lit, line: lineOf(s) })
        const sink = emptySink(); goScan(v, { known: new Set() }, sink)
        if (sink.names.length || sink.env.length) push(constList, { name: nm.text, line: lineOf(s), names: sink.names, env: sink.env, ...(fileTest ? { test: true } : {}) }, MAX.fns)
      })
      return false
    })
  }
  const fns = [], sites = []
  for (const d of named(root)) {
    if (d.type !== 'function_declaration' && d.type !== 'method_declaration') continue
    let name = field(d, 'name')?.text || '(func)'
    if (d.type === 'method_declaration') { let recv = null; each(field(d, 'receiver') || d, (x) => { if (!recv && x.type === 'type_identifier') recv = x.text; return !recv }); if (recv) name = `${recv}.${name}` }
    const test = fileTest || /^(?:Test|Benchmark|Example|Fuzz)/.test(field(d, 'name')?.text || '')
    const body = field(d, 'body')
    const sink = emptySink()
    if (body) goScan(body, { known }, sink)
    const f = fns.length < MAX.fns ? fns.length : -1
    push(fns, { name, line: lineOf(d), end: endOf(d), ...(test ? { test: true } : {}), ...sink }, MAX.fns)
    if (!body) continue
    each(body, (n) => {
      if (sites.length >= MAX_SITES) return false
      if (n.type !== 'composite_literal') return true
      const t = field(n, 'type')
      const tname = t ? (t.type === 'qualified_type' ? field(t, 'name')?.text : t.type === 'type_identifier' ? t.text : null) : null
      const pkg = t?.type === 'qualified_type' ? field(t, 'package')?.text : null
      const fields = goFields(field(n, 'body'))
      if (![...fields.keys()].some((k) => GO_KEYS.has(k))) return true
      const op = GO_TYPES[tname] || (GO_LEGS[tname] && (pkg === 'types' || pkg === 'dynamodb') ? GO_LEGS[tname] : null)
      // only an input reaching items: a CreateTableInput, an UpdateTableInput, a GSI's declaration are none
      if (!op) return true
      const raw = { op, table: null, index: null, key: null, update: null, projection: null, names: { map: {}, open: false }, item: null }
      if (fields.has('TableName')) { raw.table = emptySink(); goScan(goUnwrap(fields.get('TableName')) || fields.get('TableName'), { known }, raw.table) }
      if (fields.has('IndexName')) raw.index = goValue(fields.get('IndexName'), consts)
      if (fields.has('KeyConditionExpression')) raw.key = goValue(fields.get('KeyConditionExpression'), consts)
      if (fields.has('UpdateExpression')) raw.update = goValue(fields.get('UpdateExpression'), consts)
      if (fields.has('ProjectionExpression')) raw.projection = goValue(fields.get('ProjectionExpression'), consts)
      if (fields.has('ExpressionAttributeNames')) {
        const v = fields.get('ExpressionAttributeNames')
        const m = v?.type === 'composite_literal' ? goFields(field(v, 'body')) : null
        if (m && [...m.values()].every((x) => goLit(x) !== null)) raw.names.map = Object.fromEntries([...m].map(([k, x]) => [k, goLit(x)]))
        else raw.names.open = true
      }
      const item = fields.get('Item')
      if (item?.type === 'composite_literal') raw.item = [...goFields(field(item, 'body')).keys()].slice(0, MAX.per)
      push(sites, site(raw, lineOf(n), f, test), MAX_SITES)
      return true
    })
  }
  return { lang: 'go', sites, fns: reindex(fns, sites), consts: constList, notes: [] }
}
// Functions that name nothing and hold no site are dropped, the sites' indexes kept pointing right.
function reindex(fns, sites) {
  const keep = fns.map((f, i) => f.names.length || f.env.length || f.uses.length || sites.some((s) => s.fn === i))
  const at = []
  let k = 0
  keep.forEach((x, i) => { at[i] = x ? k++ : -1 })
  for (const s of sites) if (s.fn >= 0) s.fn = at[s.fn]
  return fns.filter((_, i) => keep[i])
}

// One file's access patterns, from its tree.
export function readAccess(tree, lang, file) {
  const fam = familyOf(lang)
  const a = fam === 'rust' ? readRustAccess(tree, file) : fam === 'ts' ? readTsAccess(tree, file, lang) : fam === 'python' ? readPython(tree, file) : readGo(tree, file)
  if (a.sites.length >= MAX_SITES) a.notes = [...(a.notes || []), `more than ${MAX_SITES} key-value calls: the first ${MAX_SITES} read`]
  return a
}

export default {
  id: 'dynamo-access',
  version: 2,
  kind: 'inferred',
  scope: 'file',
  tree: true,
  wants: (p) => SRC.test(p) && !DTS.test(p),
  level: accessLevel,
  discover: (info) => [...info].filter(([p, i]) => SRC.test(p) && !DTS.test(p) && (i.ddl & 2)).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    // a base's file is not read: graph_changes does not compare access patterns (data/base.mjs)
    if (ctx.aside) return { declarations: [] }
    const lang = treeLang(file)
    const tree = ctx.tree(lang, text)
    try {
      const a = readAccess(tree, lang, file)
      // a file with no call keeps its constants, for the calls of other files to name (not its functions)
      if (a.sites.length) return { declarations: [], access: { path: file, ...a } }
      return a.consts.length ? { declarations: [], access: { path: file, lang: a.lang, sites: [], fns: [], consts: a.consts, notes: [] } } : { declarations: [] }
    } finally { tree.delete?.() }
  },
}
