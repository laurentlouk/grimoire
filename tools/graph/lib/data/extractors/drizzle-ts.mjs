// grimoire graph · data · extractor: Drizzle's TypeScript schema, a code model (kind code: the model
// drizzle-kit generates migrations and snapshots from, and the only one a push-only project has).
// Through the pinned TypeScript grammar (spec D9), never evaluated. Per unit: a drizzle.config.* and
// the schema files under it (re-run when any changes), or a folder of schema files no config is above.
//
// Found by content: a source file importing from `drizzle-orm/sqlite-core`, `pg-core` or `mysql-core`
// and calling a table builder (sqliteTable, pgTable, mysqlTable, a creator, pgSchema(…).table, pgEnum,
// a view). A file that only re-exports relative modules (a barrel) is read for its re-exports.
//
// The store is the folder drizzle-kit writes into: the config's `out` (default `drizzle`, beside the
// config), the folder the SQL replay and the snapshots read, so the schema, the newest snapshot and
// the migrations are declarations of one store. Where the schema disagrees with them, it was edited
// and no migration generated: a conflict, every side kept (spec D2). The config's `schema` (a file, a
// folder, a glob, or a list of them, and the files they re-export) says which files are its schema;
// other schema files under it, and those under no config, are a store of their own, their folder.
//
// What is read, in the terms drizzle-kit writes into its snapshot, so the two compare:
//   - a table: its name (a creator's literal prefix and suffix applied, `schema.table` for a pgSchema
//     other than public), the dialect from its builder; `.enableRLS()` ignored; a view by name;
//   - a column: the property key, or the name its builder is given (a config's `casing` applied to a
//     key); its type, the SQL type the builder declares (`text`, `integer`, `varchar(255)`,
//     `timestamp (3) with time zone`, an enum's name, `enum('a','b')` in MySQL, a customType's
//     dataType()); `notNull()`, `primaryKey()` (not null), `unique()` (an index `<table>_<col>_unique`
//     in SQLite, a unique key elsewhere, as drizzle-kit keeps them), `references(() => t.col,
//     { onDelete, onUpdate })`, `default(…)` (a literal as the snapshot writes it, `sql\`…\`` its text,
//     another expression kept as written and not compared), `defaultNow()`, `defaultRandom()`;
//     `$defaultFn` / `$default` / `$onUpdate` recorded as computed defaults (the client's, not the
//     database's), never evaluated; `generatedAlwaysAs`, identity, `.array()`;
//   - the third argument (an array or an object, from a callback): `index('n').on(t.a, t.b)`,
//     `uniqueIndex`, `.where(…)` partial, `primaryKey({ columns })`, `unique().on(…)`, `foreignKey({
//     columns, foreignColumns }).onDelete(…)`; checks and policies are not part of the model;
//   - columns spread from a shared object (`...timestamps`) and built by a helper (`id: id()`, a
//     const arrow returning a column) are read through them; one that cannot be read leaves its
//     table stated in part (`part`: its keys and indexes not compared for presence);
//   - `relations()` is the query API's, app-level only: noted, never a foreign key.
import path from 'node:path'
import { named, field, lineOf, cap } from '../readers/code.mjs'
import { strVal } from './ts-types.mjs'
import { normDialect } from '../model.mjs'

const P = path.posix
const SRC = /\.(?:ts|mts|cts|tsx|js|mjs|cjs)$/i
const DTS = /\.d\.[cm]?ts$/i
const CONFIG = /(^|\/)drizzle\.config\.(?:ts|js|mjs|cjs|mts|cts|json)$/
const CORE = /^drizzle-orm\/(sqlite|pg|mysql)-core$/
const CORE_DIALECT = { sqlite: 'sqlite', pg: 'postgres', mysql: 'mysql' }
const LEVEL_IMPORT = /\bfrom\s*['"]drizzle-orm\/(?:sqlite|pg|mysql)-core['"]/
const LEVEL_CALL = /\b(?:sqliteTable|pgTable|mysqlTable|sqliteTableCreator|pgTableCreator|mysqlTableCreator|pgSchema|mysqlSchema|pgEnum|sqliteView|pgView|pgMaterializedView|mysqlView)\s*[(<.]/
// (each attempt bounded: a brace never closed costs 2 000 characters, not the rest of the file)
const BARREL = /^[ \t]*export[ \t]+(?:\*(?:[ \t]+as[ \t]+[\w$]+)?|\{[^}]{0,2000}\})[ \t]*from[ \t]*['"](\.{1,2}\/[^'"\n]{1,400})['"]/gm
// A source file's level bits (registry.mjs): 4 it declares tables through the builders, 8 it re-exports
// relative modules (a barrel a config may name).
export function drizzleLevel(text) {
  BARREL.lastIndex = 0
  return (LEVEL_IMPORT.test(text) && LEVEL_CALL.test(text) ? 4 : 0) | (BARREL.test(text) ? 8 : 0)
}
const reexports = (text) => { BARREL.lastIndex = 0; return [...text.matchAll(BARREL)].map((m) => m[1]).slice(0, 200) }
const langOf = (p) => (/\.tsx$/i.test(p) ? 'tsx' : 'typescript')

const TABLES = { sqliteTable: 'sqlite', pgTable: 'postgres', mysqlTable: 'mysql' }
const CREATORS = { sqliteTableCreator: 'sqlite', pgTableCreator: 'postgres', mysqlTableCreator: 'mysql' }
const SCHEMAS = { pgSchema: 'postgres', mysqlSchema: 'mysql' }
const VIEWS = { sqliteView: 'sqlite', pgView: 'postgres', pgMaterializedView: 'postgres', mysqlView: 'mysql' }
const COLUMNS = new Set([
  'text', 'integer', 'int', 'real', 'blob', 'numeric', // sqlite
  'varchar', 'char', 'smallint', 'bigint', 'serial', 'smallserial', 'bigserial', 'boolean', 'doublePrecision', 'decimal', 'timestamp', 'time', 'date', 'interval', 'json', 'jsonb', 'uuid', 'inet', 'cidr', 'macaddr', 'macaddr8', 'point', 'line', 'vector', 'halfvec', 'sparsevec', 'bit', // pg
  'tinyint', 'mediumint', 'float', 'double', 'datetime', 'year', 'tinytext', 'mediumtext', 'longtext', 'binary', 'varbinary', 'mysqlEnum', // mysql
])
const KNOWN = new Set([...Object.keys(TABLES), ...Object.keys(CREATORS), ...Object.keys(SCHEMAS), ...Object.keys(VIEWS), 'pgEnum', 'customType', ...COLUMNS])
const EXTRAS = new Set(['index', 'uniqueIndex', 'primaryKey', 'unique', 'foreignKey', 'check'])
const SCHEMA_MEMBERS = new Set(['table', 'enum', 'view', 'materializedView'])
export const MAX = { tables: 400, columns: 400, extras: 200, notes: 8, text: 80 }

const text1 = (n) => cap(n.text.replace(/\s+/g, ' '), MAX.text)
// a node with its wrappers (`as`, `satisfies`, parentheses, `!`) removed
function bare(n) {
  for (let k = 0; n && k < 32; k++) {
    if (n.type === 'parenthesized_expression' || n.type === 'as_expression' || n.type === 'satisfies_expression' || n.type === 'non_null_expression') n = named(n)[0]
    else return n
  }
  return n
}
const argsOf = (call) => { const a = field(call, 'arguments'); return a && a.type === 'arguments' ? named(a).filter((x) => x.type !== 'comment') : [] }
// a string a literal or a template with no substitution holds, or null
function str(n) {
  n = bare(n)
  if (!n) return null
  if (n.type === 'string') return strVal(n)
  if (n.type === 'template_string' && !named(n).some((x) => x.type === 'template_substitution')) return named(n).filter((x) => x.type === 'string_fragment' || x.type === 'escape_sequence').map((x) => x.text).join('')
  return null
}
// a literal's value: string, number, boolean, a list of strings; else undefined
function literal(n) {
  n = bare(n)
  if (!n) return undefined
  const s = str(n)
  if (s !== null) return s
  if (n.type === 'number') return Number(n.text)
  if (n.type === 'unary_expression' && /^-\s*\d/.test(n.text)) return Number(n.text.replace(/\s+/g, ''))
  if (n.type === 'true') return true
  if (n.type === 'false') return false
  if (n.type === 'array') { const xs = named(n).map(str); return xs.every((x) => x !== null) ? xs : undefined }
  return undefined
}
// an object literal's literal members
function config(n) {
  n = bare(n)
  const out = {}
  if (!n || n.type !== 'object') return out
  for (const p of named(n)) {
    if (p.type !== 'pair') continue
    const k = field(p, 'key'), v = literal(field(p, 'value'))
    const key = k && (k.type === 'property_identifier' ? k.text : str(k))
    if (key && v !== undefined) out[key] = v
  }
  return out
}
// a function's body as an expression: `() => x`, `() => { return x }`, `function () { return x }`
function bodyOf(fn) {
  fn = bare(fn)
  if (!fn || !(fn.type === 'arrow_function' || fn.type === 'function_expression' || fn.type === 'function')) return null
  const b = field(fn, 'body')
  if (!b) return null
  if (b.type !== 'statement_block') return bare(b)
  const ret = named(b).find((x) => x.type === 'return_statement')
  return ret ? bare(named(ret)[0]) : null
}
const blankCol = (key, line) => ({ key, name: null, b: null, enumVar: null, customVar: null, factory: null, cfg: {}, values: null, notNull: false, pk: false, autoInc: false, unique: null, ref: null, dflt: null, computed: [], generated: null, identity: false, array: 0, line })
const paramOf = (fn) => { const ps = field(bare(fn), 'parameters'); const p = ps && named(ps)[0]; const id = p && (p.type === 'identifier' ? p : field(p, 'pattern')); return id && id.type === 'identifier' ? id.text : null }

// ── one file, through the grammar: what it declares, unresolved (the unit resolves names) ──
export function readSchemaFile(tree, file) {
  const root = tree.rootNode
  const out = { file, dialect: null, importLine: null, tables: [], enums: [], schemas: [], creators: [], objects: [], factories: [], customs: [], relations: [], notes: [], error: null }
  const note = (s) => { if (out.notes.length < MAX.notes) out.notes.push(s) }
  if (root.hasError) { let first = null; const stack = [root]; while (stack.length && first === null) { const x = stack.pop(); if (x.type === 'ERROR' || x.isMissing) first = lineOf(x); else for (let i = x.childCount - 1; i >= 0; i--) if (x.child(i).hasError || x.child(i).isMissing) stack.push(x.child(i)) } out.error = first ?? 1 }
  // imports: local → the builder it names; namespaces of a core module; drizzle-orm's relations and sql
  const imported = new Map(), spaces = new Set(), relationsLocal = new Set(), sqlLocal = new Set(['sql'])
  const tops = []
  for (const s of named(root)) {
    if (s.type === 'import_statement') {
      const src = str(field(s, 'source'))
      const core = src && CORE.exec(src)
      const clause = named(s).find((x) => x.type === 'import_clause')
      if (!clause || (!core && src !== 'drizzle-orm')) continue
      if (core && !out.dialect) { out.dialect = CORE_DIALECT[core[1]]; out.importLine = lineOf(s) }
      for (const c of named(clause)) {
        if (c.type === 'namespace_import') { const id = named(c)[0]; if (id && core) spaces.add(id.text) }
        if (c.type !== 'named_imports') continue
        for (const sp of named(c)) {
          if (sp.type !== 'import_specifier') continue
          const name = field(sp, 'name')?.text, alias = field(sp, 'alias')?.text || name
          if (!name) continue
          if (core) imported.set(alias, name)
          else if (name === 'relations') relationsLocal.add(alias)
          else if (name === 'sql') sqlLocal.add(alias)
        }
      }
      continue
    }
    const decl = s.type === 'export_statement' ? field(s, 'declaration') : s
    if (decl && (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration')) {
      for (const d of named(decl)) if (d.type === 'variable_declarator') tops.push(d)
    } else if (s.type === 'expression_statement') tops.push({ bareCall: bare(named(s)[0]) })
  }
  const schemaVars = new Map() // var → dialect
  const resolve = (n, param = null, depth = 0) => {
    // what a callee names (a builder's imported name, `schemaVar.table`), or null
    n = bare(n)
    if (!n || depth > 4) return null
    if (n.type === 'identifier') {
      if (imported.has(n.text)) return imported.get(n.text)
      if (KNOWN.has(n.text) && !relationsLocal.has(n.text)) return n.text
      return null
    }
    if (n.type === 'member_expression') {
      const o = bare(field(n, 'object')), p = field(n, 'property')?.text
      if (!o || !p) return null
      if (o.type === 'identifier' && (spaces.has(o.text) || (param && o.text === param))) return p
      // a pgSchema's own builders: declared in this file, or in another (the unit checks it is one)
      if (o.type === 'identifier' && (schemaVars.has(o.text) || (!param && SCHEMA_MEMBERS.has(p)))) return `${o.text}.${p}`
      const inner = resolve(o, param, depth + 1)
      if (inner && TABLES[inner] && p === 'withRLS') return inner
    }
    return null
  }
  // a call chain: its base call and the methods called on it, outermost last
  const chain = (node, param = null) => {
    let n = bare(node)
    const methods = []
    for (let k = 0; n && n.type === 'call_expression' && k < 64; k++) {
      const fn = bare(field(n, 'function'))
      if (fn?.type === 'member_expression' && !resolve(fn, param)) {
        methods.unshift({ name: field(fn, 'property')?.text || '', args: argsOf(n), line: lineOf(n) })
        n = bare(field(fn, 'object'))
        continue
      }
      break
    }
    return { base: n, methods }
  }

  // a column from its value: { col } | { factory } | null (not a column)
  const column = (key, valueNode, line, param) => {
    const { base, methods } = chain(valueNode, param)
    if (!base) return null
    const col = blankCol(key, line)
    if (base.type === 'call_expression') {
      const fn = bare(field(base, 'function'))
      const b = resolve(fn, param)
      const args = argsOf(base)
      if (b && COLUMNS.has(b)) col.b = b
      else if (fn?.type === 'identifier') col.factory = fn.text // an enum, a customType, a helper: the unit says which
      else return null
      for (const a of args) {
        const v = bare(a)
        if (col.name === null && str(v) !== null) col.name = str(v)
        else if (v?.type === 'object') Object.assign(col.cfg, config(v))
        else if (v?.type === 'array') col.values = literal(v) || null
      }
    } else if (base.type === 'identifier') col.factory = base.text
    else return null
    for (const m of methods) method(col, m)
    return col
  }
  const method = (col, m) => {
    const [a0, a1] = m.args
    switch (m.name) {
      case 'notNull': col.notNull = true; break
      case 'primaryKey': col.pk = true; if (config(a0).autoIncrement) col.autoInc = true; break
      case 'unique': col.unique = { name: a0 ? str(a0) : null }; break
      case 'references': {
        const target = bodyOf(a0)
        const t = target && bare(target)
        if (t?.type === 'member_expression' && bare(field(t, 'object'))?.type === 'identifier') col.ref = { var: bare(field(t, 'object')).text, key: field(t, 'property')?.text || null, ...actions(config(a1)) }
        else col.ref = { var: null, key: null, text: a0 ? text1(a0) : '', ...actions(config(a1)) }
        break
      }
      case 'default': col.dflt = dflt(a0); break
      case 'defaultNow': col.dflt = { k: 'now' }; break
      case 'defaultRandom': col.dflt = { k: 'random' }; break
      case '$defaultFn': case '$default': col.computed.push(`${m.name}(${a0 ? text1(a0) : ''})`); break
      case '$onUpdate': case '$onUpdateFn': col.computed.push(`${m.name}(${a0 ? text1(a0) : ''})`); break
      case 'generatedAlwaysAs': col.generated = config(a1).mode || 'default'; break
      case 'generatedAlwaysAsIdentity': case 'generatedByDefaultAsIdentity': col.identity = true; break
      case 'array': col.array++; break
      default: break // $type, autoincrement, onUpdateNow, …: not part of the model
    }
  }
  const actions = (c) => ({ onDelete: typeof c.onDelete === 'string' ? c.onDelete.toLowerCase() : null, onUpdate: typeof c.onUpdate === 'string' ? c.onUpdate.toLowerCase() : null })
  const dflt = (n) => {
    n = bare(n)
    if (!n) return null
    const v = literal(n)
    if (typeof v === 'string') return { k: 'str', v }
    if (typeof v === 'number') return { k: 'num', v: bare(n).text.replace(/\s+/g, '') }
    if (typeof v === 'boolean') return { k: 'bool', v: String(v) }
    if (n.type === 'call_expression') {
      const fn = bare(field(n, 'function'))
      const tpl = field(n, 'arguments')
      if (fn?.type === 'identifier' && sqlLocal.has(fn.text) && tpl?.type === 'template_string') {
        const s = str(tpl)
        return s !== null ? { k: 'sql', v: s } : { k: 'expr', v: text1(n) }
      }
    }
    return { k: 'expr', v: text1(n) }
  }
  // the columns of an object literal (a table's second argument, or an object spread into one)
  const columnsOf = (obj, param) => {
    const cols = [], spreads = []
    let opaque = 0
    for (const p of named(obj)) {
      if (cols.length >= MAX.columns) break
      if (p.type === 'spread_element') { const id = bare(named(p)[0]); if (id?.type === 'identifier') spreads.push({ var: id.text, at: cols.length, line: lineOf(p) }); else opaque++; continue }
      if (p.type === 'shorthand_property_identifier') { cols.push({ ...blankCol(p.text, lineOf(p)), factory: p.text }); continue }
      if (p.type !== 'pair') continue
      const k = field(p, 'key')
      const key = k && (k.type === 'property_identifier' ? k.text : str(k))
      if (!key) { opaque++; continue }
      const c = column(key, field(p, 'value'), lineOf(p), param)
      if (c) cols.push(c); else opaque++
    }
    return { cols, spreads, opaque }
  }
  // a table's third argument: its indexes, keys and foreign keys
  const extrasOf = (fn) => {
    const param = paramOf(fn)
    const body = bodyOf(fn)
    if (!body) return { extras: [], opaque: !!fn }
    const items = body.type === 'array' ? named(body) : body.type === 'object' ? named(body).filter((p) => p.type === 'pair').map((p) => field(p, 'value')) : null
    if (!items) return { extras: [], opaque: true }
    const keyOf = (n) => {
      // t.col, t.col.desc(), t['col'], sql`…` → the key, or null for an expression
      let x = bare(n)
      for (let k = 0; x && x.type === 'call_expression' && k < 8; k++) x = bare(field(bare(field(x, 'function')), 'object'))
      if (x?.type === 'member_expression' && bare(field(x, 'object'))?.text === param) return field(x, 'property')?.text ?? null
      if (x?.type === 'subscript_expression' && bare(field(x, 'object'))?.text === param) return str(field(x, 'index'))
      return null
    }
    const refOf = (n) => { const x = bare(n); return x?.type === 'member_expression' && bare(field(x, 'object'))?.type === 'identifier' ? { var: bare(field(x, 'object')).text, key: field(x, 'property')?.text } : null }
    const extras = []
    let opaque = false
    for (const it of items.slice(0, MAX.extras)) {
      const { base, methods } = chain(it)
      const b = base?.type === 'call_expression' ? resolve(bare(field(base, 'function'))) : null
      if (!b || !EXTRAS.has(b)) { opaque = true; continue }
      const args = argsOf(base)
      const x = { kind: b, name: null, cols: [], partial: false, foreign: null, onDelete: null, onUpdate: null, line: lineOf(it) }
      if (b === 'check') continue
      if (b === 'primaryKey' || b === 'foreignKey') {
        const obj = args.find((a) => bare(a)?.type === 'object')
        if (obj) {
          for (const p of named(bare(obj))) {
            if (p.type !== 'pair') continue
            const k = field(p, 'key')?.text, v = bare(field(p, 'value'))
            if (k === 'name') x.name = str(v)
            if (k === 'columns' && v?.type === 'array') x.cols = named(v).map(keyOf)
            if (k === 'foreignColumns' && v?.type === 'array') { const refs = named(v).map(refOf); x.foreign = refs.every(Boolean) && refs.length ? { var: refs[0].var, keys: refs.map((r) => r.key) } : null }
          }
        } else x.cols = args.map(keyOf) // primaryKey(t.a, t.b), the older form
      } else x.name = args[0] ? str(args[0]) : null
      for (const m of methods) {
        if (m.name === 'on' || m.name === 'using') x.cols = (m.name === 'using' ? m.args.slice(1) : m.args).map(keyOf)
        if (m.name === 'where') x.partial = true
        if (m.name === 'onDelete' || m.name === 'onUpdate') { const v = m.args[0] && str(m.args[0]); if (v) x[m.name] = v.toLowerCase() }
      }
      extras.push(x)
    }
    return { extras, opaque }
  }

  const relCalls = []
  for (const d of tops.slice(0, 4000)) {
    if (d.bareCall) { const c = d.bareCall; if (c?.type === 'call_expression' && relationsLocal.has(bare(field(c, 'function'))?.text)) relCalls.push(lineOf(c)); continue }
    const id = field(d, 'name')
    const value = bare(field(d, 'value'))
    if (!id || id.type !== 'identifier' || !value) continue
    const v = id.text
    const line = lineOf(value)
    // an object of columns, spread into tables
    if (value.type === 'object') { const c = columnsOf(value, null); if (c.cols.some((x) => x.b)) out.objects.push({ var: v, cols: c.cols, spreads: c.spreads, opaque: c.opaque, line }); continue }
    // a helper building a column: `const id = () => integer('id').primaryKey()`, or a column itself
    if (value.type === 'arrow_function' || value.type === 'function_expression') {
      const body = bodyOf(value)
      const c = body && body.type === 'call_expression' ? column(v, body, line, null) : null
      if (c && c.b) out.factories.push({ var: v, col: c, line })
      continue
    }
    const { base, methods } = chain(value)
    if (!base || base.type !== 'call_expression') continue
    const fn = bare(field(base, 'function'))
    const b = resolve(fn)
    const args = argsOf(base)
    if (fn?.type === 'identifier' && relationsLocal.has(fn.text)) { relCalls.push(line); continue }
    if (b && COLUMNS.has(b)) { const c = column(v, value, line, null); if (c) out.factories.push({ var: v, col: c, line }); continue }
    if (b === 'pgEnum' || (b && /\.enum$/.test(b) && str(args[0]) !== null && Array.isArray(literal(args[1])))) {
      out.enums.push({ var: v, name: str(args[0]), schemaVar: b.includes('.') ? b.split('.')[0] : null, values: literal(args[1]) || [], line })
      continue
    }
    if (b && SCHEMAS[b]) { schemaVars.set(v, SCHEMAS[b]); out.schemas.push({ var: v, name: str(args[0]), dialect: SCHEMAS[b], line }); continue }
    if (b && CREATORS[b]) {
      const body = bodyOf(args[0]), p = paramOf(args[0])
      const parts = body?.type === 'template_string' ? named(body) : null
      const subs = parts ? parts.filter((x) => x.type === 'template_substitution') : []
      if (parts && subs.length === 1 && bare(named(subs[0])[0])?.text === p) {
        const at = parts.indexOf(subs[0])
        const lit = (xs) => xs.filter((x) => x.type === 'string_fragment' || x.type === 'escape_sequence').map((x) => x.text).join('')
        out.creators.push({ var: v, dialect: CREATORS[b], prefix: lit(parts.slice(0, at)), suffix: lit(parts.slice(at + 1)), line })
      } else out.creators.push({ var: v, dialect: CREATORS[b], unknown: true, line })
      continue
    }
    if (b === 'customType') {
      const obj = bare(args[0])
      let type = null
      if (obj?.type === 'object') for (const m of named(obj)) {
        const name = field(m, 'name')?.text || field(m, 'key')?.text
        if (name !== 'dataType') continue
        const body = m.type === 'method_definition' ? field(m, 'body') : null
        const ret = body ? named(body).find((x) => x.type === 'return_statement') : null
        type = ret ? str(named(ret)[0]) : bodyOf(field(m, 'value')) ? str(bodyOf(field(m, 'value'))) : null
      }
      out.customs.push({ var: v, type, line })
      continue
    }
    const view = b && (VIEWS[b] || /\.(?:view|materializedView)$/.test(b))
    const table = b && (TABLES[b] || /\.table$/.test(b))
    const creator = !b && fn?.type === 'identifier' ? fn.text : null
    if (!view && !table && !creator) continue
    if (out.tables.length >= MAX.tables) { note(`more than ${MAX.tables} tables: the rest are not read`); break }
    const name = str(args[0])
    const t = { var: v, name, nameText: name === null && args[0] ? text1(args[0]) : null, builder: b, creatorVar: creator, schemaVar: b && b.includes('.') ? b.split('.')[0] : null, dialect: TABLES[b] || VIEWS[b] || (b && b.includes('.') ? schemaVars.get(b.split('.')[0]) : null), kind: view ? 'view' : 'table', line, cols: [], spreads: [], extras: [], opaque: 0 }
    if (!view) {
      let colsNode = bare(args[1]), param = null
      if (colsNode && (colsNode.type === 'arrow_function' || colsNode.type === 'function_expression')) { param = paramOf(colsNode); colsNode = bodyOf(colsNode) }
      if (colsNode?.type === 'object') { const c = columnsOf(colsNode, param); t.cols = c.cols; t.spreads = c.spreads; t.opaque = c.opaque } else t.opaque++
      // a creator's call, or a schema's declared in another file: only with a column built (else a call of something else)
      if ((creator || (t.schemaVar && !schemaVars.has(t.schemaVar))) && !t.cols.some((x) => x.b)) continue
      if (args[2]) { const x = extrasOf(args[2]); t.extras = x.extras; if (x.opaque) t.opaque++ }
    }
    out.tables.push(t)
    void methods // .enableRLS(), .as(…), .existing(): nothing the model keeps
  }
  if (relCalls.length) out.relations = relCalls.slice(0, 50)
  return out
}

// ── the unit: a config and its schema files, or a folder of them ──
export default {
  id: 'drizzle-ts',
  version: 1,
  kind: 'code',
  scope: 'unit',
  tree: true,
  wants: (p) => (SRC.test(p) && !DTS.test(p)) || CONFIG.test(p),
  level: (p, text) => (CONFIG.test(p) || !SRC.test(p) ? 0 : drizzleLevel(text)),
  // whether its extract parses this file through the grammar (a barrel is read for its re-exports alone)
  parses: (p, text) => !CONFIG.test(p) && (drizzleLevel(text) & 4) !== 0,
  config: (p) => CONFIG.test(p),
  discover(info) {
    const files = [...info].filter(([p, i]) => SRC.test(p) && !DTS.test(p) && !CONFIG.test(p) && (i.ddl & 12)).map(([p, i]) => [p, i.ddl])
    if (!files.some(([, d]) => d & 4)) return []
    const configs = [...info.keys()].filter((p) => CONFIG.test(p))
    const depth = (d) => (d === '.' ? 0 : d.split('/').length)
    const under = (d, p) => d === '.' || p.startsWith(`${d}/`)
    // each file to the configs of the nearest folder holding one
    const jobs = new Map(configs.map((c) => [c, []]))
    const loose = new Map()
    for (const [p, d] of files) {
      const near = configs.filter((c) => under(P.dirname(c), p))
      const best = Math.max(-1, ...near.map((c) => depth(P.dirname(c))))
      const mine = near.filter((c) => depth(P.dirname(c)) === best)
      if (mine.length) { for (const c of mine) jobs.get(c).push([p, d]); continue }
      if (!(d & 4)) continue // a barrel no config names
      const dir = P.dirname(p)
      if (!loose.has(dir)) loose.set(dir, [])
      loose.get(dir).push(p)
    }
    return [
      ...[...jobs].filter(([, fs]) => fs.some(([, d]) => d & 4)).map(([c, fs]) => ({ key: c, inputs: [c, ...fs.map(([p]) => p).sort()] })),
      ...[...loose].map(([dir, fs]) => ({ key: dir, inputs: fs.sort() })),
    ]
  },
  // one file through the grammar (what readers/code-aside.mjs runs for a base)
  parse(text, file, ctx) {
    const tree = ctx.tree(langOf(file), text)
    try { return readSchemaFile(tree, file) } finally { tree.delete?.() }
  },
  extract({ key, files }, ctx) {
    const cfgFile = files.find((f) => CONFIG.test(f.path)) || null
    const sources = files.filter((f) => !CONFIG.test(f.path))
    const byPath = new Map(sources.map((f) => [f.path, f]))
    const parsed = new Map()
    const read = (f) => {
      if (!parsed.has(f.path)) parsed.set(f.path, (drizzleLevel(f.text) & 4) ? (ctx.aside ? ctx.aside('drizzle-ts', f.path, f.text) : this.parse(f.text, f.path, ctx)) : null)
      return parsed.get(f.path)
    }
    const decls = []
    if (cfgFile) {
      const cfg = readConfig(cfgFile.text)
      const dir = P.dirname(cfgFile.path)
      const at = (rel) => P.normalize(P.join(dir, rel)).replace(/\/+$/, '') || '.'
      const named = new Set()
      if (cfg.schema) {
        const tests = cfg.schema.map((s) => matcher(at(s)))
        const queue = sources.filter((f) => tests.some((t) => t(f.path))).map((f) => f.path)
        // and what a named file re-exports, among the files under the config
        while (queue.length) {
          const p = queue.shift()
          if (named.has(p)) continue
          named.add(p)
          for (const spec of reexports(byPath.get(p).text)) { const q = resolveSpec(P.dirname(p), spec, byPath); if (q && !named.has(q)) queue.push(q) }
        }
      }
      const store = at(cfg.out || 'drizzle')
      const mine = sources.filter((f) => named.has(f.path))
      const d = declare(mine.map(read).filter(Boolean), store, cfg, cfgFile.path)
      if (d) decls.push(d)
      // the schema files under the config it does not name: a store of their own, their folder
      const rest = new Map()
      for (const f of sources) if (!named.has(f.path) && (drizzleLevel(f.text) & 4)) { const dd = P.dirname(f.path); if (!rest.has(dd)) rest.set(dd, []); rest.get(dd).push(f) }
      for (const [dd, fs] of rest) { const x = declare(fs.map(read).filter(Boolean), dd, {}, null); if (x) decls.push(x) }
    } else {
      const d = declare(sources.map(read).filter(Boolean), key, {}, null)
      if (d) decls.push(d)
    }
    return { declarations: decls }
  },
}

// A drizzle config's settings, read as text (it is code; nothing is run): { schema: [spec] | null,
// out, dialect, casing }. A `migrations: { … }` or `dbCredentials: { … }` member is set aside first
// (the migrations table's `schema` is not the schema files').
export function readConfig(text) {
  const t = String(text).replace(/\b(?:migrations|dbCredentials)["']?\s*:\s*\{[^}]{0,4000}\}/g, '')
  const key = (k) => new RegExp(`(?:^|[\\s{,])["']?${k}["']?\\s*:\\s*`, 'm')
  const at = (k) => { const m = key(k).exec(t); return m ? m.index + m[0].length : -1 }
  const strAt = (i) => { const m = /^(['"`])([^'"`\n]*)\1/.exec(t.slice(i)); return m ? m[2] : null }
  let schema = null
  const si = at('schema')
  if (si >= 0) {
    if (t[si] === '[') { const end = t.indexOf(']', si); schema = [...t.slice(si, end < 0 ? t.length : end).matchAll(/(['"`])([^'"`\n]*)\1/g)].map((m) => m[2]) }
    else { const s = strAt(si); schema = s !== null ? [s] : null }
  }
  const oi = at('out'), di = at('dialect'), ci = at('casing')
  const casing = ci >= 0 ? strAt(ci) : null
  return { schema, out: oi >= 0 ? strAt(oi) : null, dialect: di >= 0 ? strAt(di) : null, casing: casing === 'snake_case' || casing === 'camelCase' ? casing : null }
}

// A schema spec (resolved against the config's folder) as a test on a path: a glob, a file or a folder.
function matcher(spec) {
  if (!/[*?{]/.test(spec)) return (p) => p === spec || p.startsWith(`${spec}/`)
  let re = ''
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i]
    if (c === '*' && spec[i + 1] === '*') { re += spec[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += spec[i + 2] === '/' ? 2 : 1 }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{') { const end = spec.indexOf('}', i); if (end < 0) { re += '\\{'; continue } re += `(?:${spec.slice(i + 1, end).split(',').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`; i = end }
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  const rx = new RegExp(`^${re}$`)
  return (p) => rx.test(p)
}
// A relative module specifier, as a file among the unit's.
function resolveSpec(dir, spec, byPath) {
  const base = P.normalize(P.join(dir, spec))
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '')
  for (const c of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.js`, `${stem}.mjs`, `${base}/index.ts`, `${base}/index.js`]) if (byPath.has(c)) return c
  return null
}

// drizzle's own casing of a property key (its toSnakeCase, toCamelCase)
const words = (s) => s.replace(/['’]/g, '').match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) || []
const CASING = {
  snake_case: (s) => words(s).map((w) => w.toLowerCase()).join('_'),
  camelCase: (s) => words(s).reduce((a, w, i) => a + (i ? `${w[0].toUpperCase()}${w.slice(1)}` : w.toLowerCase()), ''),
}

// The SQL type a builder declares, as drizzle-kit writes it in its snapshot, or null.
function sqlType(dialect, b, c, values) {
  const len = c.length, p = c.precision, s = c.scale
  const num = (name) => (p !== undefined ? (s !== undefined ? `${name}(${p}, ${s})` : `${name}(${p})`) : name)
  if (dialect === 'sqlite') {
    if (b === 'text') return len ? `text(${len})` : 'text'
    if (b === 'integer' || b === 'int') return 'integer'
    return ['real', 'blob', 'numeric'].includes(b) ? b : null
  }
  if (dialect === 'postgres') {
    if (b === 'varchar' || b === 'char') return len ? `${b}(${len})` : b
    if (b === 'doublePrecision') return 'double precision'
    if (b === 'numeric' || b === 'decimal') return num('numeric')
    if (b === 'timestamp' || b === 'time') return `${b}${p !== undefined ? ` (${p})` : ''}${c.withTimezone ? ' with time zone' : ''}`
    if (b === 'interval') return `interval${c.fields ? ` ${c.fields}` : ''}${p !== undefined ? `(${p})` : ''}`
    if (['vector', 'halfvec', 'sparsevec', 'bit'].includes(b)) return c.dimensions !== undefined ? `${b}(${c.dimensions})` : b
    return ['text', 'integer', 'smallint', 'bigint', 'serial', 'smallserial', 'bigserial', 'boolean', 'real', 'date', 'json', 'jsonb', 'uuid', 'inet', 'cidr', 'macaddr', 'macaddr8', 'point', 'line'].includes(b) ? b : null
  }
  if (dialect === 'mysql') {
    if (['int', 'tinyint', 'smallint', 'mediumint', 'bigint'].includes(b)) return `${b}${c.unsigned ? ' unsigned' : ''}`
    if (['varchar', 'char', 'binary', 'varbinary'].includes(b)) return len !== undefined ? `${b}(${len})` : b
    if (['float', 'double', 'real', 'decimal'].includes(b)) return p !== undefined ? (s !== undefined ? `${b}(${p},${s})` : `${b}(${p})`) : b
    if (['datetime', 'timestamp', 'time'].includes(b)) return c.fsp ? `${b}(${c.fsp})` : b
    if (b === 'mysqlEnum') return values ? `enum(${values.map((v) => `'${v}'`).join(',')})` : null
    return ['serial', 'boolean', 'text', 'tinytext', 'mediumtext', 'longtext', 'json', 'date', 'year'].includes(b) ? b : null
  }
  return null
}
const SERIALS = new Set(['serial', 'smallserial', 'bigserial'])

// One store's declaration from the files read for it, names resolved across them, or null when they
// declare nothing.
function declare(files, store, cfg, configPath) {
  const tables = files.flatMap((f) => f.tables.map((t) => ({ ...t, file: f.file })))
  const schemaNames = new Set(files.flatMap((f) => f.schemas.map((s) => s.var)))
  const enums = files.flatMap((f) => f.enums.map((e) => ({ ...e, file: f.file }))).filter((e) => !e.schemaVar || schemaNames.has(e.schemaVar))
  if (!tables.length && !enums.length) return null
  const notes = []
  const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
  const index = (list) => { const m = new Map(); for (const x of list) { if (m.has(x.var)) { if (m.get(x.var)) note(`${x.var} is declared in ${m.get(x.var).file} and ${x.file}: not resolved`); m.set(x.var, null) } else m.set(x.var, x) } return m }
  const byVar = index(tables), enumVar = index(enums)
  const schemaVar = index(files.flatMap((f) => f.schemas.map((s) => ({ ...s, file: f.file }))))
  const creatorVar = index(files.flatMap((f) => f.creators.map((c) => ({ ...c, file: f.file }))))
  const objectVar = index(files.flatMap((f) => f.objects.map((o) => ({ ...o, file: f.file }))))
  const factoryVar = index(files.flatMap((f) => f.factories.map((x) => ({ ...x, file: f.file }))))
  const customVar = index(files.flatMap((f) => f.customs.map((x) => ({ ...x, file: f.file }))))
  const errors = files.filter((f) => f.error !== null)
  for (const f of errors) note(`${f.file}:${f.error}: the file does not parse cleanly; what parsed is kept, and the schema is not compared for what it lacks`)
  for (const f of files) for (const n of f.notes) note(`${f.file}: ${n}`)
  const rel = files.filter((f) => f.relations.length)
  if (rel.length) note(`relations() at ${rel.map((f) => `${f.file}:${f.relations[0]}`).join(', ')}: the query API's, app-level only, not foreign keys`)
  const dialects = [...new Set(tables.map((t) => t.dialect || files.find((f) => f.file === t.file)?.dialect).filter(Boolean))]
  const dialect = dialects[0] || files.find((f) => f.dialect)?.dialect || null
  if (dialects.length > 1) note(`tables of several dialects (${dialects.join(', ')}): each typed by its own`)
  const stated = cfg.dialect ? normDialect(cfg.dialect) : null
  if (stated && dialect && stated !== dialect) note(`${configPath} states the dialect ${cfg.dialect}, the table builders say ${dialect}`)
  const casing = CASING[cfg.casing] || ((k) => k)
  const qualified = (schema, name) => (schema && schema !== 'public' ? `${schema}.${name}` : name)
  let unknownNames = 0

  // the columns of each table, spreads and helpers resolved: [{ col (merged), line }]
  const resolveCol = (c, depth = 0) => {
    if (!c.factory || depth > 4) return c
    const f = factoryVar.get(c.factory)
    if (f) { const base = resolveCol(f.col, depth + 1); return mergeCol(base, c) }
    const e = enumVar.get(c.factory)
    if (e) return { ...c, factory: null, enumVar: c.factory }
    const t = customVar.get(c.factory)
    if (t) return { ...c, factory: null, customVar: c.factory }
    return c
  }
  const colsOf = (t) => {
    const out = []
    let opaque = t.opaque
    // the object's own columns in order, each spread where it stands
    const add = (cols, spreads, depth) => {
      for (let i = 0; i <= cols.length; i++) {
        for (const s of spreads.filter((x) => x.at === i)) {
          const o = objectVar.get(s.var)
          if (o && depth < 4) { opaque += o.opaque; add(o.cols, o.spreads, depth + 1) } else opaque++
        }
        if (i < cols.length) out.push(resolveCol(cols[i]))
      }
    }
    add(t.cols, t.spreads, 0)
    return { cols: out, opaque }
  }

  const resolved = new Map() // table var → { entity, keyToName }
  const entities = []
  const pending = [] // [entity, col or extra, the table's own key map]
  for (const t of tables) {
    if (t.schemaVar && !schemaVar.get(t.schemaVar)) continue // `x.table(…)` on something no schema file declares a schema
    const schema = t.schemaVar ? schemaVar.get(t.schemaVar).name ?? null : null
    let name = t.name
    if (t.creatorVar) {
      const c = creatorVar.get(t.creatorVar)
      if (!c) continue // a call of something no schema file declares as a creator
      if (c.unknown) { note(`${t.file}:${t.line}: the table name is built by ${t.creatorVar}, which no literal prefix and suffix state: kept as given`); unknownNames++ }
      else if (name !== null) name = `${c.prefix}${name}${c.suffix}`
    }
    if (name === null) { note(`${t.file}:${t.line}: a table name no literal states (${t.nameText}): not modeled`); unknownNames++; continue }
    const tdialect = t.dialect || (t.creatorVar ? creatorVar.get(t.creatorVar)?.dialect : null) || (t.schemaVar ? schemaVar.get(t.schemaVar)?.dialect : null) || dialect
    const ename = qualified(schema, name)
    const e = { name: ename, kind: t.kind, path: t.file, line: t.line, fields: [], keys: [], indexes: [], relations: [] }
    entities.push(e)
    if (t.kind === 'view') continue
    const { cols, opaque } = colsOf(t)
    if (opaque) { e.part = true; note(`${t.file}:${t.line}: ${opaque} column${opaque === 1 ? '' : 's'} or entr${opaque === 1 ? 'y' : 'ies'} of ${ename} not read (built by code the reader does not follow): its keys and indexes are not compared for what they lack`) }
    const names = new Map() // key → column name
    const at = (line) => ({ path: t.file, line })
    for (const c of cols) {
      const cname = c.name ?? casing(c.key)
      names.set(c.key, cname)
      const f = { name: cname, type: null, nullable: true, default: null, generated: null, ...at(c.line) }
      const unstated = []
      if (c.factory) { f.type = c.factory; unstated.push('type', 'nullable', 'default'); e.part = true }
      else if (c.enumVar) {
        const en = enumVar.get(c.enumVar)
        f.type = en.name ?? c.enumVar
        f.enum = { name: qualified(en.schemaVar ? schemaVar.get(en.schemaVar)?.name : null, en.name ?? c.enumVar), values: en.values }
      } else if (c.customVar) {
        const ct = customVar.get(c.customVar)
        if (ct.type) f.type = ct.type; else { f.type = c.customVar; unstated.push('type') }
      } else {
        const ty = sqlType(tdialect, c.b, c.cfg, c.values)
        if (ty) f.type = ty; else { f.type = c.b; unstated.push('type') }
        if (Array.isArray(c.cfg.enum)) f.enum = { name: null, values: c.cfg.enum }
        if (c.b === 'mysqlEnum' && c.values) f.enum = { name: null, values: c.values }
      }
      if (c.array) f.type = `${f.type}${'[]'.repeat(c.array)}`
      if (!c.factory) f.nullable = !(c.notNull || c.pk || c.identity || (tdialect === 'postgres' && SERIALS.has(c.b)) || (tdialect === 'mysql' && c.b === 'serial'))
      if (c.dflt) {
        const d = defaultText(c.dflt, tdialect)
        f.default = d.text
        if (d.unstated) unstated.push('default')
      }
      if (c.computed.length) f.computed = c.computed.join(' · ')
      if (c.generated) f.generated = c.generated === 'default' ? (tdialect === 'postgres' ? 'stored' : 'virtual') : c.generated
      if (unstated.length) f.unstated = [...new Set(unstated)]
      e.fields.push(f)
      if (c.pk) e.keys.push({ role: 'primary', parts: [cname], ...at(c.line) })
      if (c.unique) {
        if (tdialect === 'sqlite') e.indexes.push({ name: c.unique.name || `${name}_${cname}_unique`, unique: true, columns: [cname], partial: false, ...at(c.line) })
        else e.keys.push({ role: 'unique', parts: [cname], ...at(c.line) })
      }
      if (c.ref) pending.push([e, { kind: 'ref', cols: [cname], ref: c.ref, line: c.line, file: t.file }])
    }
    const nameOf = (k) => (k === null ? '(expression)' : names.get(k) ?? casing(k))
    for (const x of t.extras) {
      const columns = x.cols.map(nameOf)
      if (x.kind === 'index' || x.kind === 'uniqueIndex') e.indexes.push({ name: x.name || `${name}_${columns.join('_')}_index`, unique: x.kind === 'uniqueIndex', columns, partial: x.partial, ...at(x.line) })
      else if (x.kind === 'primaryKey') { e.keys = e.keys.filter((k) => k.role !== 'primary'); e.keys.push({ role: 'primary', parts: columns, ...at(x.line) }) }
      else if (x.kind === 'unique') e.keys.push({ role: 'unique', parts: columns, ...at(x.line) })
      else if (x.kind === 'foreignKey' && x.foreign) pending.push([e, { kind: 'fk', cols: columns, ref: { var: x.foreign.var, keys: x.foreign.keys, onDelete: x.onDelete, onUpdate: x.onUpdate }, line: x.line, file: t.file }])
    }
    if (byVar.get(t.var) === t) resolved.set(t.var, { entity: e, names }) // a name two files declare resolves to neither
  }
  // foreign keys, once every table's columns are known (a reference may name a table declared later,
  // or in another file of the schema)
  for (const [e, r] of pending) {
    const target = r.ref.var ? resolved.get(r.ref.var) : null
    if (!target) { note(`${r.file}:${r.line}: a reference to ${r.ref.var ? `${r.ref.var}.${r.ref.key ?? r.ref.keys?.join(', ')}` : r.ref.text || 'an expression'} that no table of the schema declares: not modeled`); continue }
    const keys = r.ref.keys || [r.ref.key]
    e.relations.push({ columns: r.cols, to: target.entity.name, toColumns: keys.map((k) => target.names.get(k) ?? casing(k ?? '')), onDelete: r.ref.onDelete || 'no action', onUpdate: r.ref.onUpdate || 'no action', path: r.file, line: r.line })
  }
  const enumOut = enums.filter((e) => e.name).map((e) => ({ name: qualified(e.schemaVar ? schemaVar.get(e.schemaVar)?.name : null, e.name), values: e.values, path: e.file, line: e.line }))
  const first = files.find((f) => f.tables.length) || files[0]
  const nT = entities.filter((e) => e.kind === 'table').length, nV = entities.length - nT
  const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  return {
    store, dialect,
    dialectFrom: dialect && first.importLine ? { how: 'stated', path: first.file, line: first.importLine } : null,
    source: { path: first.file, line: 1, kind: 'code', confidence: 'declared' },
    complete: !errors.length && !unknownNames, partial: false, status: 'read',
    label: `table builders, read ${counted(files.length, 'file')}: ${[counted(nT, 'table'), nV && counted(nV, 'view'), enumOut.length && counted(enumOut.length, 'enum')].filter(Boolean).join(', ')}`,
    notes: [...(configPath ? [`schema named by ${configPath}${cfg.casing ? ` (casing ${cfg.casing})` : ''}`] : []), ...notes].slice(0, MAX.notes),
    files: files.length,
    ...(enumOut.length ? { enums: enumOut } : {}),
    entities,
  }
}

// A helper's column with what the call site adds on top (its own methods).
function mergeCol(base, over) {
  return {
    ...base, key: over.key, line: over.line, name: over.name ?? base.name, factory: null,
    notNull: base.notNull || over.notNull, pk: base.pk || over.pk, unique: over.unique || base.unique, ref: over.ref || base.ref,
    dflt: over.dflt || base.dflt, computed: [...base.computed, ...over.computed], generated: over.generated || base.generated,
    identity: base.identity || over.identity, array: base.array + over.array,
  }
}

// A default as the snapshot writes it: { text, unstated? }.
function defaultText(d, dialect) {
  if (d.k === 'str') return { text: `'${d.v.replace(/'/g, "''")}'` }
  if (d.k === 'num' || d.k === 'bool' || d.k === 'sql') return { text: d.v }
  if (d.k === 'now' && dialect === 'postgres') return { text: 'now()' }
  if (d.k === 'now' && dialect === 'mysql') return { text: '(now())' }
  if (d.k === 'random' && dialect === 'postgres') return { text: 'gen_random_uuid()' }
  return { text: d.k === 'expr' ? d.v : d.k === 'now' ? 'defaultNow()' : d.k === 'random' ? 'defaultRandom()' : null, unstated: true }
}
