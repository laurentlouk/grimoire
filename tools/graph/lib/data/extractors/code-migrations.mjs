// grimoire graph · data · extractor: SQL migrations written as code, a TypeScript or JavaScript file per
// migration whose `up` sends DDL as raw SQL (`await queryRunner.query(\`CREATE TABLE …\`)`, TypeORM's
// generated migrations; `await knex.raw('…')` / `knex.schema.raw(…)`, Knex's), read as a `.sql`
// migration folder is (extractors/sql-migrations.mjs): kind migration, in migration order. Through the
// pinned TypeScript grammar, nothing run. Per unit: a folder of migration files, re-run when any of them,
// or a config stating its dialect, changes.
//
// Found by content (bit 1024 of a source file's level): a TypeScript or JavaScript file shaped as a
// migration (a `MigrationInterface`, an `up` it exports: `exports.up`, `export async function up`,
// `export const up`, `module.exports = { up }`: never app code creating a table at startup) that calls
// `.query(` or `.raw(` and holds a string
// starting with `CREATE` or `ALTER` a table, an index or a type. Its folder is a migration folder.
//
// What is read, per file: the `up` method or function alone (never `down`), each `.query(…)` /
// `.raw(…)` call in it, in source order, whose SQL is text the code states: a string or template
// literal, a concatenation of them, a `const` of the file holding one. Each statement keeps its file
// line: the SQL is laid out at the lines it is written on, every other line blank, so a table, a
// column, a key cites `CreateUser.ts:12` as a `.sql` file's would. SQL with a part code fills in
// (`${…}`, a variable) is not read (noted at its line, the replay then not complete); so is a schema
// builder's call (`knex.schema.createTable(…)`, TypeORM's `queryRunner.createTable(new Table(…))`),
// counted, never guessed.
//
// Order: the numeric or timestamp prefix of the file names (`1700000000000-CreateUser.ts`,
// `20240105090000_create_users.js`), number by number, as sql-migrations orders a folder; names without
// one, or two sharing a version, leave the order unknown (listed, not replayed).
//
// Dialect, first found: grimoire.config.json (graph.data.migrations); a Knex config (`knexfile.*`) whose
// every `client:` names one engine; a TypeORM data source (a file creating `new DataSource({ type })`, or
// `ormconfig.*`) whose every `type:` names one; else sniffed from the SQL (readers/sql-dialect.mjs:
// TypeORM writes `SERIAL`, backticks and `ENGINE=`, `AUTOINCREMENT` per engine); unknown is never
// guessed. SQLite is replayed (readers/sqlite-replay.mjs), Postgres and MySQL read statement by statement
// (readers/ddl.mjs), exactly as a `.sql` folder.
import path from 'node:path'
import { named, field, lineOf } from '../readers/code.mjs'
import { tsSegs, assemble } from './sql-queries.mjs'
import { PARAM } from '../readers/sql-query.mjs'
import { orderOf, ddlFacts } from './sql-migrations.mjs'
import { replay } from '../readers/sqlite-replay.mjs'
import { readDdl } from '../readers/ddl.mjs'
import { sniffDialect } from '../readers/sql-dialect.mjs'
import { normDialect } from '../model.mjs'

const P = path.posix
const SRC = /\.(?:ts|mts|cts|js|mjs|cjs)$/i
const DTS = /\.d\.[cm]?ts$/i
const KNEXFILE = /(^|\/)knexfile\.(?:ts|js|mjs|cjs)$/
const ORMCONFIG = /(^|\/)ormconfig\.(?:json|ts|js|mjs|cjs)$/
const SHAPE = /\bMigrationInterface\b|\bexports\.up\b|\bexport[ \t]+(?:async[ \t]+)?function[ \t]+up\b|\bexport[ \t]+const[ \t]+up\b/
// `module.exports = { up(knex) { … } }` (or `up: async (knex) =>`): a CommonJS migration, an `up` member beside it
const CJS = /\bmodule\.exports[ \t]*=/
const UP_MEMBER = /(?:^|[\s,{])(?:async[ \t]+)?up[ \t]*(?::|\()/m
const RAW_CALL = /\.(?:query|raw)[ \t]*\(/
const DDL_TEXT = /[`'"][ \t\r\n]*(?:CREATE|ALTER)[ \t\r\n]+(?:TABLE|(?:UNIQUE[ \t\r\n]+)?INDEX|TYPE)\b/i
const DATA_SOURCE = /\bnew[ \t]+DataSource[ \t]*\(/
// bits of a source file's level (registry.mjs): 1024 a migration sending DDL as raw SQL, 2048 a TypeORM data source
export const migrationLevel = (p, text) => (!SRC.test(p) || DTS.test(p) ? 0 : ((SHAPE.test(text) || (CJS.test(text) && UP_MEMBER.test(text))) && RAW_CALL.test(text) && DDL_TEXT.test(text) ? 1024 : 0) | (DATA_SOURCE.test(text) ? 2048 : 0))
const ENGINES = { pg: 'postgres', postgres: 'postgres', postgresql: 'postgres', cockroachdb: 'postgres', mysql: 'mysql', mysql2: 'mysql', mariadb: 'mysql', sqlite: 'sqlite', sqlite3: 'sqlite', 'better-sqlite3': 'sqlite', sqljs: 'sqlite', capacitor: 'sqlite', expo: 'sqlite' }
const RAW = new Set(['query', 'raw'])
const BUILDERS = new Set(['createTable', 'alterTable', 'table', 'dropTable', 'dropTableIfExists', 'createTableIfNotExists', 'renameTable', 'addColumn', 'addColumns', 'dropColumn', 'changeColumn', 'createIndex', 'dropIndex', 'createForeignKey', 'createPrimaryKey', 'createUniqueConstraint'])
const MAX = { calls: 2000, notes: 12 }
const langOf = (p) => (/\.(?:ts|mts|cts)$/i.test(p) ? 'typescript' : 'javascript')

// The `up` of a migration file: a method `up` (a class's, an object's), a function or arrow named so,
// or assigned to `exports.up` / `module.exports.up`.
function ups(root) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    let fn = null
    if (n.type === 'method_definition' && field(n, 'name')?.text === 'up') fn = n
    else if (n.type === 'function_declaration' && field(n, 'name')?.text === 'up') fn = n
    else if (n.type === 'variable_declarator' && field(n, 'name')?.text === 'up') fn = field(n, 'value')
    else if (n.type === 'assignment_expression' && /^(?:module\.)?exports\.up$/.test(field(n, 'left')?.text || '')) fn = field(n, 'right')
    else if (n.type === 'pair' && /^['"]?up['"]?$/.test(field(n, 'key')?.text || '')) fn = field(n, 'value')
    if (fn && /function|arrow|method/.test(fn.type)) { out.push(fn); continue }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return out
}
// the file's constants: `const x = <literal>` anywhere (a migration's SQL kept in one), by name, the first
function constsOf(root) {
  const out = new Map()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'lexical_declaration' && /^const\b/.test(n.text)) for (const d of named(n)) if (d.type === 'variable_declarator' && field(d, 'name')?.type === 'identifier' && field(d, 'value') && !out.has(field(d, 'name').text)) out.set(field(d, 'name').text, field(d, 'value'))
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return out
}

// One migration file → { sql: [{ text, line }], notes, built, open }: its up's SQL as written, each at its
// line; the builder calls counted; the SQL code fills in, noted (open: the replay is then not complete).
export function readMigration(tree, file) {
  const root = tree.rootNode
  const consts = constsOf(root)
  const out = { sql: [], notes: [], built: 0, open: 0 }
  const fns = ups(root)
  if (!fns.length) { out.notes.push(`${file}: no up migration found: not read`); out.open++; return out }
  for (const fn of fns) {
    const calls = []
    const stack = [field(fn, 'body') || fn]
    while (stack.length) {
      const n = stack.pop()
      if (n.type === 'call_expression') calls.push(n)
      // a nested function (a callback) is code the migration runs too: read in place
      for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
    }
    for (const c of calls.sort((a, b) => a.startIndex - b.startIndex).slice(0, MAX.calls)) {
      const f = field(c, 'function')
      if (f?.type !== 'member_expression') continue
      const name = field(f, 'property')?.text
      if (BUILDERS.has(name)) { out.built++; continue }
      if (!RAW.has(name)) continue
      const arg = named(field(c, 'arguments') || c)[0]
      if (!arg) continue
      const segs = tsSegs(arg, consts)
      const sql = segs && assemble(segs)
      if (!sql) { if (arg.type === 'identifier' || arg.type === 'call_expression' || arg.type === 'member_expression') { out.notes.push(`${file}:${lineOf(c)}: SQL built by code: not read`); out.open++ } continue }
      if (sql.text.includes(PARAM)) { out.notes.push(`${file}:${sql.line}: SQL with a part code fills in: not read`); out.open++; continue }
      out.sql.push(sql)
    }
  }
  return out
}

// The SQL of a file laid out at its lines: each statement at the line it is written on, a `;` on the
// line after it (a `--` comment closing its text cannot swallow it), every other line blank.
export function layout(sql, lines) {
  const rows = Array.from({ length: Math.max(lines, 1) + 1 }, () => '')
  for (const s of sql) {
    const parts = s.text.split('\n')
    parts.forEach((p, k) => { const r = s.line - 1 + k; while (rows.length <= r + 1) rows.push(''); rows[r] += rows[r] ? ` ${p}` : p })
    const end = s.line - 1 + parts.length
    rows[end] = rows[end] ? `; ${rows[end]}` : ';'
  }
  return rows.join('\n')
}

// A config's engine: every `client:` (Knex) or `type:` (TypeORM) literal, all naming one. → { dialect, line } | null
function configDialect(text, key) {
  const re = new RegExp(`\\b${key}["']?[ \\t]*:[ \\t]*["'\`]([\\w-]{1,40})["'\`]`, 'g')
  const found = []
  let m
  while ((m = re.exec(text)) && found.length < 20) found.push({ d: ENGINES[m[1].toLowerCase()] || null, line: text.slice(0, m.index).split('\n').length })
  if (!found.length || found.some((f) => !f.d) || new Set(found.map((f) => f.d)).size > 1) return null
  return { dialect: found[0].d, line: found[0].line }
}

export default {
  id: 'code-migrations',
  version: 1,
  kind: 'migration',
  source: true, // it reads source files, inspected by level (registry.mjs SOURCE)
  aside: true, // a base reads its files aside too (readers/code-aside.mjs)
  scope: 'unit',
  tree: true,
  wants: (p) => (SRC.test(p) && !DTS.test(p)) || ORMCONFIG.test(p),
  level: (p, text) => migrationLevel(p, text),
  parses: (p, text) => (migrationLevel(p, text) & 1024) !== 0,
  config: (p) => KNEXFILE.test(p) || ORMCONFIG.test(p),
  discover(info, { overrides = [] } = {}) {
    const folders = new Map()
    for (const [p, i] of info) {
      if (!SRC.test(p) || !(i.ddl & 1024)) continue
      const d = P.dirname(p)
      if (!folders.has(d)) folders.set(d, [])
      folders.get(d).push(p)
    }
    if (!folders.size) return []
    // the configs that may state the dialect: Knex's, TypeORM's (a data source file, ormconfig)
    const configs = [...info].filter(([p, i]) => KNEXFILE.test(p) || ORMCONFIG.test(p) || (SRC.test(p) && i.ddl & 2048)).map(([p]) => p).sort()
    return [...folders].map(([folder, files]) => {
      const o = overrides.find((x) => x.path === folder)
      return { key: folder, inputs: [...files.sort(), ...configs], ...(o ? { override: o.dialect, salt: `dialect=${o.dialect}` } : {}) }
    })
  },
  parse(text, file, ctx) {
    const tree = ctx.tree(langOf(file), text)
    try { return readMigration(tree, file) } finally { tree.delete?.() }
  },
  extract({ key, files, override }, ctx) {
    const isConfig = (f) => KNEXFILE.test(f.path) || ORMCONFIG.test(f.path) || P.dirname(f.path) !== key || !(migrationLevel(f.path, f.text) & 1024)
    const configs = files.filter(isConfig)
    const members = files.filter((f) => !isConfig(f))
    const notes = []
    let open = 0, built = 0
    const laid = members.map((f) => {
      const r = ctx.aside ? ctx.aside('code-migrations', f.path, f.text) : this.parse(f.text, f.path, ctx)
      notes.push(...r.notes)
      open += r.open; built += r.built
      return { path: f.path, text: layout(r.sql, f.text.split('\n').length) }
    })
    const clients = [...new Set(members.map((f) => (/\bfrom[ \t]*['"]typeorm['"]|\bMigrationInterface\b/.test(f.text) ? 'typeorm' : /\bknex\b/.test(f.text) ? 'knex' : null)).filter(Boolean))]
    if (built) notes.push(`${built} schema builder call${built === 1 ? '' : 's'} (createTable, alterTable…): not read, only raw SQL is`)
    // the dialect
    let dialect = null, from = null, reason = null
    if (override) { dialect = normDialect(override); from = { how: 'override' } }
    for (const c of override ? [] : configs) {
      const d = KNEXFILE.test(c.path) ? configDialect(c.text, 'client') : configDialect(c.text, 'type')
      if (d) { dialect = d.dialect; from = { how: 'stated', path: c.path, line: d.line }; break }
    }
    if (!dialect) {
      const s = sniffDialect(laid)
      if (s.dialect) { dialect = s.dialect; from = { how: 'sniffed', marker: s.marker, path: s.path, line: s.line } } else reason = s.reason
    }
    const order = orderOf(key, laid, null)
    const base = {
      store: key, dialect, dialectFrom: from,
      source: { path: (order.files?.length ? order.files : laid)[0].path, line: 1, kind: 'migration', confidence: 'exact' },
      complete: false, partial: false, files: laid.length, entities: [], ...(clients.length ? { clients } : {}),
    }
    const what = `migrations as code, replayed ${laid.length} file${laid.length === 1 ? '' : 's'}`
    const capped = (xs) => xs.slice(0, MAX.notes)
    if (!dialect) return { declarations: [{ ...base, status: 'not-read', label: `dialect unknown (no config states it, and ${reason})`, notes: capped([...order.notes, ...notes]) }] }
    if (!['sqlite', 'postgres', 'mysql'].includes(dialect)) return { declarations: [{ ...base, status: 'not-read', label: `no reader for ${dialect} migrations`, notes: capped(notes) }] }
    if (order.error) return { declarations: [{ ...base, status: 'not-read', label: `order unknown (${order.error})`, notes: capped([...order.notes, ...notes]) }] }
    if (dialect === 'sqlite') {
      const r = replay(order.files, ctx.DatabaseSync)
      return { declarations: [{ ...base, entities: r.entities, implicitIndexes: r.implicit, notes: capped([...order.notes, ...notes, ...r.notes]), complete: !r.stopped && !open, partial: !!r.stopped, status: r.stopped ? 'partial' : 'read', label: r.stopped ? 'replayed to' : `${what}, ${r.statements} statement${r.statements === 1 ? '' : 's'}`, ...(r.stopped ? { stopped: { path: r.stopped.path, line: r.stopped.line }, error: r.stopped.error } : {}) }] }
    }
    const f = ddlFacts(readDdl(order.files, { dialect }), [...order.notes, ...notes], what)
    return { declarations: [{ ...base, ...f, notes: capped(f.notes), complete: f.complete && !open }] }
  },
}
