// grimoire graph · data · extractor: the queries a project's code makes through Drizzle's query builder
// and its relational API (spec D2's `inferred` kind, the least trusted: it never changes a declared
// fact). Per file (.ts, .mts, .cts, .tsx, .js, .mjs, .cjs, .jsx; never a .d.ts), read only when its
// content shows a query-builder shape beside an import a schema could come through, through the pinned
// TypeScript grammar. Nothing is run and nothing evaluated: a query is read from its call chain, and
// only identifiers are kept (a table's variable, a column's property key, a relation's name), never a
// value (a `where` compares with literals the code writes: none is kept).
//
// What a chain says, read from its receiver's first method (`db`, `tx`, `ctx.db`, `this.db`: whatever
// holds the client; inside `db.transaction(async (tx) => …)` alike):
//   db.select(…).from(t)        read t; `.innerJoin(u, eq(t.a, u.b))` (left, right, full, cross, the
//                               lateral forms) reads u, the join's column pairs kept; the select
//                               object's columns, `where`, `orderBy`, `groupBy`, `having` columns
//   db.insert(t).values({ … })  write t, the keys it writes (`values(input)`: which, unknown), an
//                               `onConflictDoUpdate({ target, set })`'s, `.returning(…)`'s
//   db.update(t).set({ … })     write t, the keys it sets (a spread: the rest unknown), `where`
//   db.delete(t)                write t, `where`
//   db.$count(t, …)             read t
//   db.query.<key>.findMany({ … }) / findFirst   read the table the schema exports as <key> (the
//                               relational API's key), its `columns`, `where` and `orderBy` (an object,
//                               a call, or a callback whose first parameter is the table), and `with`'s
//                               relation names, nested (data/drizzle.mjs joins them through the
//                               schema's relations())
//   sql`…`                      a template's `${t}` a table and `${t.c}` a column: within a chain,
//                               its own; alone (`db.run(sql\`…\`)`), a statement of its own, read or
//                               written by its first word (select; insert, update, delete), else
//                               naming them
// A table is an identifier the file binds: an import (`import { notes } from './schema'`, renamed or
// not), a namespace's member (`schema.notes`), a table the file declares itself, or an `alias(t, …)`
// of one; anything else (a parameter, a function's result) is dynamic, counted and never named.
// data/drizzle.mjs resolves each to the schema's table (extractors/drizzle-ts.mjs keeps their
// variables), never by a guess across repositories.
//
// The migrations a running app applies: `migrate(db, migrations)` and `useMigrations(db,
// migrations)` imported from `drizzle-orm/<driver>/migrator`, their migrations' import (an Expo
// bundle, `drizzle/migrations.js`) or `migrationsFolder`, at their line.
//
// The enclosing function comes down with the walk (sql-queries.mjs's naming), a callback named by the
// object member holding it (`postRouter.all`, `useNotes.queryFn`); test code (the code graph's test
// paths, a .test. or .spec. file) is not read for the model: its calls are counted.
//
// Facts: { declarations: [], drizzle: { lang, path, refs: [Ref], sites: [Site], fns: [{ name, line,
//   end }], migrators: [{ line, fn, call, source }], dynamic, tests, notes } }
//   Ref   { k: import | ns | local | key, source?, name }   (key: the relational API's db.query.<key>)
//   Site  { line, fn: index into fns (-1 at top level), op, tables: [{ ref, role: read | write, how,
//           line }], cols: [{ ref, key, how, line }], joins: [{ ref, kind, line, on: [[{ ref, key },
//           { ref, key }]] }], with?: [{ name, with? }], open?: 1 (a write whose keys code builds) }
// Bounded: MAX.sites calls, MAX.cols columns a call, MAX.refs bindings, MAX.nodes nodes scanned a
// call, within FILE_MS. A base's file is not read (graph_changes compares declarations).
import { named, field, lineOf, endOf } from '../readers/code.mjs'
import { strVal } from './ts-types.mjs'
import { FN, CLASS, fnName, TEST_FILE, FILE_MS } from './sql-queries.mjs'
import { TEST_PATH } from '../../langs.mjs'

const SRC = /\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/i
const DTS = /\.d\.[cm]?ts$/i
export const MAX = { sites: 400, cols: 200, refs: 400, nodes: 20000, with: 64, notes: 8 }
// A source file's level bit (registry.mjs): a Drizzle query-builder shape beside an import a schema
// may come through. Linear whatever the text: no two repetitions match the same characters.
export const LEVEL = 16384
const SHAPE = /\.(?:insert|update|delete|from|innerJoin|leftJoin|\$count)\s*\(\s*[\w$]+(?:\.[\w$]+)?\s*[,)]|\.query\.[\w$]+\.find(?:Many|First)\s*\(|\b(?:useMigrations|migrate)\s*\(/
const SOURCE = /\bfrom\s*['"](?:drizzle-orm(?:\/[^'"\n]{0,200})?|[^'"\n]{0,200}(?:schema|db|database|drizzle|tables|models)[^'"\n]{0,200})['"]/i
export const drizzleQueryLevel = (text) => (SHAPE.test(text) && SOURCE.test(text) ? LEVEL : 0)
const langOf = (p) => (/\.tsx$/i.test(p) ? 'tsx' : /\.[cm]?ts$/i.test(p) ? 'typescript' : 'javascript')

const TABLE_BUILDERS = new Set(['sqliteTable', 'pgTable', 'mysqlTable'])
const SELECTS = new Set(['select', 'selectDistinct', 'selectDistinctOn'])
const WRITES = new Set(['insert', 'update', 'delete'])
const JOINS = { innerJoin: 'inner', leftJoin: 'left', rightJoin: 'right', fullJoin: 'full', crossJoin: 'cross', innerJoinLateral: 'inner lateral', leftJoinLateral: 'left lateral', crossJoinLateral: 'cross lateral' }
const HOW = { where: 'where', having: 'where', orderBy: 'order', groupBy: 'group', returning: 'returning', onConflictDoUpdate: 'conflict', onConflictDoNothing: 'conflict', select: 'select', selectDistinct: 'select', selectDistinctOn: 'select' }
const MIGRATORS = new Set(['migrate', 'useMigrations'])
const RELATIONAL = new Set(['findMany', 'findFirst'])
const FAM = 'ts'

function bare(n) {
  for (let k = 0; n && k < 32; k++) {
    if (n.type === 'parenthesized_expression' || n.type === 'as_expression' || n.type === 'satisfies_expression' || n.type === 'non_null_expression' || n.type === 'await_expression') n = named(n)[0]
    else return n
  }
  return n
}
const argsOf = (call) => { const a = field(call, 'arguments'); return a && a.type === 'arguments' ? named(a).filter((x) => x.type !== 'comment') : [] }
const str = (n) => { n = bare(n); return n?.type === 'string' ? strVal(n) : null }
const nodeKey = (n) => `${n.startIndex}:${n.endIndex}:${n.type}`
const keyText = (k) => (k ? (k.type === 'property_identifier' || k.type === 'identifier' ? k.text : str(k)) : null)
const pairs = (obj) => named(obj).filter((p) => p.type === 'pair' || p.type === 'shorthand_property_identifier' || p.type === 'spread_element' || p.type === 'method_definition')

export function readDrizzleFile(tree, file, { ms = FILE_MS } = {}) {
  const root = tree.rootNode
  const out = { lang: FAM, path: file, refs: [], sites: [], fns: [], migrators: [], dynamic: 0, tests: 0, notes: [] }
  const note = (s) => { if (out.notes.length < MAX.notes && !out.notes.includes(s)) out.notes.push(s) }
  const fileTest = TEST_PATH.test(file) || TEST_FILE.ts.test(file)
  const deadline = Date.now() + ms
  let steps = 0, stopped = false
  const late = () => (++steps & 4095) === 0 && Date.now() > deadline

  // ── what the file binds: imports, namespaces, its own tables, aliases ──
  const binds = new Map() // local → { k, source?, name } | { alias: identifier node }
  const spaces = new Map() // namespace local → source
  const migratorLocal = new Map() // local → migrate | useMigrations
  const defaults = new Map() // a default import's local → its source (the migrations a migrator is given)
  const sqlLocal = new Set()
  for (const s of named(root)) {
    if (s.type === 'import_statement') {
      if (/^import\s+type\b/.test(s.text)) continue
      const source = str(field(s, 'source'))
      const clause = named(s).find((x) => x.type === 'import_clause')
      if (!source || !clause) continue
      const migrator = /^drizzle-orm\/[^/]+(?:\/[^/]+)?\/migrator$/.test(source)
      for (const c of named(clause)) {
        if (c.type === 'identifier') defaults.set(c.text, source)
        if (c.type === 'namespace_import') { const id = named(c)[0]; if (id) spaces.set(id.text, source) }
        if (c.type !== 'named_imports') continue
        for (const sp of named(c)) {
          if (sp.type !== 'import_specifier' || /^type\s/.test(sp.text)) continue
          const name = field(sp, 'name')?.text, alias = field(sp, 'alias')?.text || name
          if (!name) continue
          if (migrator && MIGRATORS.has(name)) { migratorLocal.set(alias, name); continue }
          if (name === 'sql') { sqlLocal.add(alias); continue } // (drizzle-orm's, or a package re-exporting it)
          binds.set(alias, { k: 'import', source, name })
        }
      }
      continue
    }
    const decl = s.type === 'export_statement' ? field(s, 'declaration') : s
    if (!decl || (decl.type !== 'lexical_declaration' && decl.type !== 'variable_declaration')) continue
    for (const d of named(decl)) {
      if (d.type !== 'variable_declarator' || field(d, 'name')?.type !== 'identifier') continue
      const v = bare(field(d, 'value'))
      const fn = v?.type === 'call_expression' ? bare(field(v, 'function')) : null
      const callee = fn?.type === 'identifier' ? fn.text : fn?.type === 'member_expression' ? field(fn, 'property')?.text : null
      if (callee && (TABLE_BUILDERS.has(callee) || (fn.type === 'member_expression' && callee === 'table'))) binds.set(field(d, 'name').text, { k: 'local', name: field(d, 'name').text })
    }
  }
  if (!binds.has('sql')) sqlLocal.add('sql')
  // `const author = alias(users, 'author')`, anywhere in the file: the table it aliases
  const aliasOf = new Map()
  const refIndex = new Map()
  const intern = (b) => {
    const k = `${b.k}\0${b.source ?? ''}\0${b.name}`
    if (!refIndex.has(k)) { if (out.refs.length >= MAX.refs) return -1; refIndex.set(k, out.refs.length); out.refs.push(b.source !== undefined ? { k: b.k, source: b.source, name: b.name } : { k: b.k, name: b.name }) }
    return refIndex.get(k)
  }
  // the binding a table expression names, as a ref index, or -1
  const refOf = (n, params = null, depth = 0) => {
    n = bare(n)
    if (!n || depth > 4) return -1
    if (n.type === 'identifier') {
      if (params && params.has(n.text)) return params.get(n.text)
      if (aliasOf.has(n.text)) return refOf(aliasOf.get(n.text), params, depth + 1)
      const b = binds.get(n.text)
      return b ? intern(b) : -1
    }
    if (n.type === 'member_expression') {
      const o = bare(field(n, 'object')), p = field(n, 'property')?.text
      if (o?.type === 'identifier' && spaces.has(o.text) && p) return intern({ k: 'ns', source: spaces.get(o.text), name: p })
    }
    return -1
  }
  // a column: `t.key`, `schema.t.key`, `t['key']`, `param.key` → { ref, key } | null
  const colOf = (n, params) => {
    n = bare(n)
    if (n?.type !== 'member_expression' && n?.type !== 'subscript_expression') return null
    const o = field(n, 'object')
    const key = n.type === 'member_expression' ? field(n, 'property')?.text : str(field(n, 'index'))
    if (!key) return null
    const ref = refOf(o, params)
    return ref >= 0 ? { ref, key } : null
  }

  const consumed = new Set() // sql templates a chain read as its own
  const done = new Set() // the inner calls of a chain read whole
  // what a chain's arguments name: columns (and, in a sql template, tables), bounded
  const scan = (node, how, params, acc) => {
    if (!node) return
    const stack = [[node, params]]
    let k = 0
    while (stack.length && k++ < MAX.nodes) {
      const [x, ps] = stack.pop()
      if (x.type === 'member_expression' || x.type === 'subscript_expression') {
        const c = colOf(x, ps)
        if (c) { if (acc.cols.length < MAX.cols) acc.cols.push({ ...c, how, line: lineOf(x) }); continue }
      }
      if (x.type === 'call_expression') {
        const f = bare(field(x, 'function')), a = field(x, 'arguments')
        if (f?.type === 'identifier' && sqlLocal.has(f.text) && a?.type === 'template_string') { consumed.add(nodeKey(x)); template(a, how, ps, acc, 'read'); continue }
        // eq(t.a, u.b) and the like: a pair of columns a join compares (only where a join asks)
        if (acc.pairs && f?.type === 'identifier' && /^(?:eq|ne)$/.test(f.text)) { const [l, r] = argsOf(x).map((y) => colOf(y, ps)); if (l && r) acc.pairs.push([l, r]) }
      }
      // a callback's first parameter, where a relational query hands it the table
      let next = ps
      if (acc.param !== undefined && (x.type === 'arrow_function' || x.type === 'function_expression')) {
        const p = field(x, 'parameter') || named(field(x, 'parameters') || x).find((y) => /parameter$/.test(y.type) || y.type === 'identifier')
        const id = p ? (p.type === 'identifier' ? p : field(p, 'pattern')) : null
        if (id?.type === 'identifier') { next = new Map(ps || []); next.set(id.text, acc.param) }
      }
      for (let i = x.namedChildCount - 1; i >= 0; i--) stack.push([x.namedChild(i), next])
    }
  }
  // a sql template: `${t}` a table, `${t.c}` a column
  const template = (tpl, how, params, acc, role) => {
    for (const s of named(tpl)) {
      if (s.type !== 'template_substitution') continue
      const e = bare(named(s)[0])
      const c = colOf(e, params)
      if (c) { if (acc.cols.length < MAX.cols) acc.cols.push({ ...c, how, line: lineOf(e) }); continue }
      const r = refOf(e, params)
      if (r >= 0) acc.tables.push({ ref: r, role, how: 'sql', line: lineOf(e) })
      else scan(e, how, params, acc)
    }
  }
  // the keys an object literal writes; a spread or a computed key leaves the rest open
  const keysOf = (obj, acc, ref, how) => {
    const o = bare(obj)
    if (o?.type === 'array') { for (const x of named(o)) keysOf(x, acc, ref, how); return }
    if (o?.type !== 'object') { acc.open = 1; return }
    for (const p of pairs(o)) {
      if (p.type === 'spread_element') { acc.open = 1; continue }
      const key = p.type === 'shorthand_property_identifier' ? p.text : keyText(field(p, p.type === 'method_definition' ? 'name' : 'key'))
      if (!key) { acc.open = 1; continue }
      if (acc.cols.length < MAX.cols) acc.cols.push({ ref, key, how, line: lineOf(p) })
    }
  }
  const member = (obj, k) => { const o = bare(obj); return o?.type === 'object' ? named(o).find((p) => p.type === 'pair' && keyText(field(p, 'key')) === k) || null : null }
  // a relational query's `with`: relation names, nested, bounded
  const withOf = (obj, depth, budget) => {
    const o = bare(obj)
    if (o?.type !== 'object' || depth > 4) return []
    const list = []
    for (const p of named(o)) {
      if (budget.n-- <= 0) break
      const name = p.type === 'shorthand_property_identifier' ? p.text : p.type === 'pair' ? keyText(field(p, 'key')) : null
      if (!name) continue
      const v = p.type === 'pair' ? bare(field(p, 'value')) : null
      if (v?.type === 'false') continue
      const inner = v ? member(v, 'with') : null
      list.push(inner ? { name, with: withOf(field(inner, 'value'), depth + 1, budget) } : { name })
    }
    return list
  }

  // one chain, from its outermost call: { op, tables, cols, joins, with?, open? } | null
  const chainAt = (call) => {
    const stepsOf = []
    let n = call, base = null
    for (let k = 0; n && n.type === 'call_expression' && k < 64; k++) {
      const f = bare(field(n, 'function'))
      if (f?.type !== 'member_expression') { base = null; break }
      stepsOf.unshift({ name: field(f, 'property')?.text || '', args: argsOf(n), line: lineOf(n), node: n })
      const o = bare(field(f, 'object'))
      if (o?.type === 'call_expression') { n = o; continue }
      base = o
      break
    }
    if (!stepsOf.length || !base) return null
    const acc = { tables: [], cols: [], joins: [], open: 0 }
    const head = stepsOf.findIndex((s) => s.name !== 'with' && s.name !== '$with')
    const first = stepsOf[head]
    if (!first) return null
    // the relational API: db.query.<key>.findMany({ … })
    if (head === 0 && RELATIONAL.has(first.name) && base.type === 'member_expression' && field(bare(field(base, 'object')), 'property')?.text === 'query') {
      const key = field(base, 'property')?.text
      if (!key) return null
      const ref = intern({ k: 'key', name: key })
      if (ref < 0) return null
      acc.tables.push({ ref, role: 'read', how: first.name, line: first.line })
      const cfg = first.args[0]
      const cols = member(cfg, 'columns')
      if (cols) { const v = bare(field(cols, 'value')); if (v?.type === 'object') for (const p of named(v)) { const key2 = p.type === 'pair' && bare(field(p, 'value'))?.type !== 'false' ? keyText(field(p, 'key')) : p.type === 'shorthand_property_identifier' ? p.text : null; if (key2 && acc.cols.length < MAX.cols) acc.cols.push({ ref, key: key2, how: 'columns', line: lineOf(p) }) } }
      for (const [k, how] of [['where', 'where'], ['orderBy', 'order']]) {
        const m = member(cfg, k)
        if (!m) continue
        const v = bare(field(m, 'value'))
        // drizzle-orm 1.0's object filter: { id: …, title: { like: … } }
        if (k === 'where' && v?.type === 'object') { for (const p of named(v)) { const key2 = p.type === 'pair' ? keyText(field(p, 'key')) : p.type === 'shorthand_property_identifier' ? p.text : null; if (key2 && !/^(?:AND|OR|NOT|RAW)$/.test(key2) && acc.cols.length < MAX.cols) acc.cols.push({ ref, key: key2, how, line: lineOf(p) }) } continue }
        scan(v, how, null, Object.assign(acc, { param: ref }))
      }
      delete acc.param
      const w = member(cfg, 'with')
      if (w) { const list = withOf(field(w, 'value'), 0, { n: MAX.with }); if (list.length) acc.with = list }
      return { op: first.name, ...acc }
    }
    // the query builder: select … from, insert, update, delete, $count
    let op = null
    if (SELECTS.has(first.name)) {
      const from = stepsOf.find((s) => s.name === 'from')
      const ref = from ? refOf(from.args[0]) : -1
      if (!from) return null
      if (ref < 0) { out.dynamic++; return null }
      op = 'select'
      acc.tables.push({ ref, role: 'read', how: 'from', line: from.line })
    } else if (WRITES.has(first.name) && first.args.length === 1) {
      const ref = refOf(first.args[0])
      if (ref < 0) { if (stepsOf.length > 1 && bare(first.args[0])?.type === 'identifier') out.dynamic++; return null }
      op = first.name
      acc.tables.push({ ref, role: 'write', how: first.name, line: first.line })
    } else if (first.name === '$count' && first.args.length) {
      const ref = refOf(first.args[0])
      if (ref < 0) return null
      op = 'count'
      acc.tables.push({ ref, role: 'read', how: 'count', line: first.line })
      scan(first.args[1], 'where', null, acc)
      return { op, ...acc }
    } else return null
    const target = acc.tables[0].ref
    for (const s of stepsOf) {
      if (s === first && op !== 'select') continue
      if (s.name === 'from') continue
      if (JOINS[s.name]) {
        const ref = refOf(s.args[0])
        if (ref < 0) { out.dynamic++; continue }
        acc.tables.push({ ref, role: 'read', how: 'join', line: s.line })
        const j = { tables: [], cols: [], pairs: [] }
        scan(s.args[1], 'join', null, j)
        acc.cols.push(...j.cols.slice(0, Math.max(0, MAX.cols - acc.cols.length)))
        acc.joins.push({ ref, kind: JOINS[s.name], line: s.line, on: j.pairs.slice(0, 8) })
        continue
      }
      if (s.name === 'values') { for (const a of s.args.slice(0, 1)) keysOf(a, acc, target, 'values'); continue }
      if (s.name === 'set' && op === 'update') { keysOf(s.args[0], acc, target, 'set'); continue }
      if (s.name === 'onConflictDoUpdate' || s.name === 'onConflictDoNothing') {
        const t = member(s.args[0], 'target'), st = member(s.args[0], 'set')
        if (t) scan(field(t, 'value'), 'conflict', null, acc)
        if (st) keysOf(field(st, 'value'), acc, target, 'set')
        continue
      }
      if (s.name === 'returning' && !s.args.length) continue
      for (const a of s.args) scan(a, HOW[s.name] || 'other', null, acc)
    }
    return { op, ...acc }
  }

  // ── one walk down the tree: each node with its function, class, test status and the member holding it ──
  const top = { fn: null, cls: null, test: false, obj: null, pair: null }
  const stack = [[root, top, null]]
  while (stack.length) {
    if (late()) { stopped = true; break }
    const [n, ctx, parent] = stack.pop()
    if (n.type === 'variable_declarator') {
      const v = bare(field(n, 'value'))
      const fn = v?.type === 'call_expression' ? bare(field(v, 'function')) : null
      if (fn?.type === 'identifier' && fn.text === 'alias' && field(n, 'name')?.type === 'identifier') { const t = argsOf(v)[0]; if (t) aliasOf.set(field(n, 'name').text, t) }
    }
    if (n.type === 'call_expression' && !done.has(nodeKey(n)) && out.sites.length < MAX.sites) visit(n, ctx)
    let c = ctx
    if (FN[FAM].test(n.type)) {
      const own = parent?.type === 'pair' ? ctx.pair : fnName(n, parent, FAM, ctx)
      const name = own ?? (ctx.fn ? null : ctx.pair)
      if (name !== null) c = { ...ctx, fn: { name: name.slice(0, 120), line: lineOf(n), end: endOf(n), idx: -1 }, pair: null }
    } else if (CLASS[FAM].test(n.type)) c = { ...ctx, cls: field(n, 'name')?.text || '(class)' }
    else if (n.type === 'variable_declarator' && bare(field(n, 'value'))?.type === 'object' && field(n, 'name')?.type === 'identifier') c = { ...ctx, obj: ctx.fn ? null : field(n, 'name').text }
    else if (n.type === 'pair') { const k = keyText(field(n, 'key')); if (k) c = { ...ctx, pair: ctx.fn ? `${ctx.fn.name}.${k}` : ctx.obj ? `${ctx.obj}.${k}` : k } }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push([n.namedChild(i), c, n])
  }
  if (stopped) note(`the file took more than ${ms / 1000} s to read: the calls after that not read`)
  if (out.sites.length >= MAX.sites) note(`more than ${MAX.sites} query calls: the first ${MAX.sites} read`)
  return out

  function fnIndex(ctx) {
    if (!ctx.fn) return -1
    if (ctx.fn.idx < 0) { ctx.fn.idx = out.fns.length; out.fns.push({ name: ctx.fn.name, line: ctx.fn.line, end: ctx.fn.end }) }
    return ctx.fn.idx
  }
  function visit(n, ctx) {
    const f = bare(field(n, 'function'))
    // a migrator: migrate(db, migrations), useMigrations(db, migrations)
    if (f?.type === 'identifier' && migratorLocal.has(f.text)) {
      const a = bare(argsOf(n)[1])
      const folder = member(a, 'migrationsFolder')
      const source = a?.type === 'identifier' ? defaults.get(a.text) ?? binds.get(a.text)?.source ?? null : folder ? str(field(folder, 'value')) : null
      if (out.migrators.length < 16) out.migrators.push({ line: lineOf(n), fn: fnIndex(ctx), call: migratorLocal.get(f.text), source })
      return
    }
    // a sql template alone: a statement of its own
    if (f?.type === 'identifier' && sqlLocal.has(f.text) && field(n, 'arguments')?.type === 'template_string') {
      if (consumed.has(nodeKey(n))) return
      const tpl = field(n, 'arguments')
      const head = named(tpl)[0]
      const verb = head?.type === 'string_fragment' ? (/^\s*(select|with|insert|update|delete)\b/i.exec(head.text) || [])[1]?.toLowerCase() ?? null : null
      const acc = { tables: [], cols: [], joins: [] }
      template(tpl, 'sql', null, acc, verb === 'select' || verb === 'with' ? 'read' : verb ? 'write' : 'names')
      if (!acc.tables.length) return
      if (fileTest || ctx.test) { out.tests++; return }
      out.sites.push({ line: lineOf(n), fn: fnIndex(ctx), op: verb ? `sql ${verb}` : 'sql', tables: acc.tables, cols: acc.cols, joins: [] })
      return
    }
    if (f?.type !== 'member_expression') return
    // the chain this call is the outermost link of: its inner links are read with it
    for (let x = bare(field(f, 'object')), k = 0; x && x.type === 'call_expression' && k < 64; k++) {
      const g = bare(field(x, 'function'))
      if (g?.type !== 'member_expression') break // a call of its own (a migrator, a sql template): visited as such
      done.add(nodeKey(x))
      x = bare(field(g, 'object'))
    }
    const r = chainAt(n)
    if (!r || !r.tables.length) return
    if (fileTest || ctx.test) { out.tests++; return }
    const site = { line: r.tables[0].line, fn: fnIndex(ctx), op: r.op, tables: r.tables, cols: r.cols, joins: r.joins }
    if (r.with) site.with = r.with
    if (r.open) site.open = 1
    out.sites.push(site)
  }
}

export default {
  id: 'drizzle-queries',
  version: 1,
  kind: 'inferred',
  scope: 'file',
  tree: true,
  wants: (p) => SRC.test(p) && !DTS.test(p),
  level: (p, text) => (SRC.test(p) && !DTS.test(p) ? drizzleQueryLevel(text) : 0),
  discover: (info) => [...info].filter(([p, i]) => SRC.test(p) && !DTS.test(p) && (i.ddl & LEVEL)).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    // a base's file is not read: graph_changes compares declarations, never the inferred model (data/base.mjs)
    if (ctx.aside) return { declarations: [] }
    const tree = ctx.tree(langOf(file), text)
    try {
      const d = readDrizzleFile(tree, file)
      return d.sites.length || d.migrators.length || d.tests || d.dynamic ? { declarations: [], drizzle: d } : { declarations: [] }
    } finally { tree.delete?.() }
  },
}
