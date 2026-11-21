// grimoire graph · data · extractor: Alembic migrations (`versions/<rev>_<name>.py`: an `upgrade()` of
// `op.create_table`, `op.add_column`, …), kind migration, read in revision order. Through the pinned
// Python grammar, nothing run: each operation is written as the DDL Alembic would emit for it, at the
// operation's own lines (each column at its `sa.Column` line), and that SQL is replayed as a `.sql`
// folder is (SQLite into node:sqlite, Postgres and MySQL statement by statement, readers/ddl.mjs), so a
// table, a column, a key cites `versions/1a2b_add_users.py:14`.
//
// Found by content (bit 524288 of a Python file's level): a file defining `upgrade()` that calls
// `op.<operation>(` and assigns `revision` (bit 1048576: an Alembic environment, `env.py`, setting
// `target_metadata`, read by sqlalchemy.mjs). Per unit: a versions folder, and the alembic.ini or engine
// URL stating its dialect (else the revisions' own: below, dialectOf).
//
// Order: the revision graph, `revision` and `down_revision` (a tuple for a merge), from its root to its one
// head; two heads, a `down_revision` no file declares, or one not a literal: the order is unknown (listed,
// not replayed).
//
// Read, in `upgrade()` only (and `with op.batch_alter_table(t) as batch_op:` alike): `create_table`
// (`sa.Column(name, type, nullable, primary_key, server_default)`, a column's `sa.ForeignKey`,
// `PrimaryKeyConstraint`, `UniqueConstraint`, `ForeignKeyConstraint`; a check skipped), `drop_table`,
// `rename_table`, `add_column`, `drop_column`, `alter_column` (`nullable`, `new_column_name`, `type_`),
// `create_index` / `drop_index` (`op.f(name)` its name), `create_unique_constraint`,
// `create_foreign_key`, `create_primary_key`, `drop_constraint`, and `op.execute("…")` when the SQL is a
// literal. A type is written as SQLAlchemy's DDL compiler writes it for the dialect (`sa.String(length=80)`
// → `VARCHAR(80)`, `sa.DateTime(timezone=True)` → `TIMESTAMP WITH TIME ZONE` on Postgres…); a
// `server_default` kept when a number or `sa.text("now()")`-like function of no argument, else only that
// there is one (no literal string is kept). Any other operation (`bulk_insert`, a `RunPython`-like
// callable) is counted; one built by code is noted at its line and leaves the replay not complete.
import path from 'node:path'
import { named, field, lineOf } from '../readers/code.mjs'
import { value, callArgs, strOf, boolOf, strsOf, lastName } from '../readers/python.mjs'
import { layout } from './code-migrations.mjs'
import { ddlFacts } from './sql-migrations.mjs'
import { replay } from '../readers/sqlite-replay.mjs'
import { readDdl } from '../readers/ddl.mjs'
import { counted } from '../readers/orm.mjs'
import { normDialect } from '../model.mjs'

const P = path.posix
const PY = /\.py$/i
const INI = /(^|\/)alembic\.ini$/
const UPGRADE = /^def[ \t]+upgrade[ \t]*\(/m
const OP = /\bop\.\w+[ \t]*\(/
const REVISION = /^revision[ \t]*(?::[^=\n]{0,80})?=/m
const ENV = /\btarget_metadata[ \t]*=/
const CONTEXT = /\bcontext\.configure[ \t]*\(/
export const alembicLevel = (p, text) => (!PY.test(p) ? 0 : (UPGRADE.test(text) && OP.test(text) && REVISION.test(text) ? 524288 : 0) | (ENV.test(text) && CONTEXT.test(text) ? 1048576 : 0))
const SCHEMES = { postgresql: 'postgres', postgres: 'postgres', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite' }
const ACTIONS = { CASCADE: 'CASCADE', 'SET NULL': 'SET NULL', RESTRICT: 'RESTRICT', 'NO ACTION': 'NO ACTION', 'SET DEFAULT': 'SET DEFAULT' }
const MAX = { ops: 2000, notes: 12 }

// SQLAlchemy's DDL for a type, per dialect (its type compiler), from the type as written
function sqlType(n, d) {
  if (!n) return null
  const name = n.type === 'call' ? lastName(field(n, 'function')?.text) : lastName(n.text)
  const a = n.type === 'call' ? callArgs(n) : { pos: [], kw: new Map() }
  const num = (i, k) => { const x = a.kw.has(k) ? value(a.kw.get(k)) : a.pos[i] ? value(a.pos[i]) : null; return x?.k === 'int' ? x.v : null }
  const tz = a.kw.has('timezone') && boolOf(a.kw.get('timezone')) === true
  const len = num(0, 'length')
  switch (name) {
    case 'Integer': case 'INTEGER': return 'INTEGER'
    case 'BigInteger': case 'BIGINT': return 'BIGINT'
    case 'SmallInteger': case 'SMALLINT': return 'SMALLINT'
    case 'String': case 'VARCHAR': case 'AutoString': case 'Unicode': return len ? `VARCHAR(${len})` : 'VARCHAR'
    case 'CHAR': return len ? `CHAR(${len})` : 'CHAR'
    case 'Text': case 'TEXT': case 'UnicodeText': return 'TEXT'
    case 'Boolean': case 'BOOLEAN': return 'BOOLEAN'
    case 'DateTime': case 'DATETIME': case 'TIMESTAMP': return d === 'postgres' ? (tz ? 'TIMESTAMP WITH TIME ZONE' : 'TIMESTAMP WITHOUT TIME ZONE') : 'DATETIME'
    case 'Date': case 'DATE': return 'DATE'
    case 'Time': case 'TIME': return d === 'postgres' ? (tz ? 'TIME WITH TIME ZONE' : 'TIME WITHOUT TIME ZONE') : 'TIME'
    case 'Float': case 'FLOAT': return 'FLOAT'
    case 'Numeric': case 'NUMERIC': case 'DECIMAL': { const p = num(0, 'precision'), s = num(1, 'scale'); return `NUMERIC${p ? `(${p}${s ? `, ${s}` : ''})` : ''}` }
    case 'LargeBinary': return d === 'postgres' ? 'BYTEA' : 'BLOB'
    case 'JSON': return 'JSON'
    case 'JSONB': return 'JSONB'
    case 'Uuid': case 'UUID': return d === 'postgres' ? 'UUID' : 'CHAR(32)'
    case 'Interval': return d === 'postgres' ? 'INTERVAL' : 'DATETIME'
    case 'Enum': { const nm = a.kw.has('name') ? strOf(a.kw.get('name')) : null; return d === 'postgres' && nm ? nm : 'VARCHAR' }
    default: return /^[A-Z][A-Z0-9_]*$/.test(name) ? name : null
  }
}
function defaultSql(n) {
  const v = value(n)
  if (v.k === 'int' || v.k === 'float') return v.v
  if (v.k === 'true' || v.k === 'false') return v.k.toUpperCase()
  if (v.k === 'call' && /(?:^|\.)text$/.test(v.fn)) { const s = strOf(callArgs(v.node).pos[0]); if (s && /^[A-Za-z_][\w.]{0,63}\(\s*\)$|^(?:CURRENT_TIMESTAMP|CURRENT_DATE|true|false|[0-9.]+)$/i.test(s.trim())) return s.trim() }
  if (v.k === 'call' && /(?:^|\.)func\.\w+$/.test(v.fn)) return `${lastName(v.fn)}()`
  return "'…'" // a string, an expression: only that there is one (no literal kept)
}

// ── one migration file: its revision, what it revises, its upgrade's operations as SQL at their lines ──
function readFile(root, file, d) {
  const out = { revision: null, down: null, downCode: false, sql: [], notes: [], open: 0, other: {} }
  const q = (s) => (d === 'mysql' ? `\`${s}\`` : `"${String(s).replace(/"/g, '""')}"`)
  const qt = (s) => String(s).split('.').map(q).join('.')
  let up = null
  for (const s of named(root)) {
    if (s.type === 'expression_statement') {
      const a = named(s)[0]
      if (a?.type !== 'assignment') continue
      const k = field(a, 'left')?.text, v = field(a, 'right')
      if (k === 'revision') out.revision = strOf(v)
      if (k === 'down_revision') { const x = value(v); out.down = x.k === 'none' ? [] : strsOf(v); if (!out.down) out.downCode = true }
    }
    const f = s.type === 'decorated_definition' ? field(s, 'definition') : s
    if (f?.type === 'function_definition' && field(f, 'name')?.text === 'upgrade') up = f
  }
  if (!up) return out
  const push = (text, line) => out.sql.push({ text, line })
  const rows = (n) => [n.startPosition.row, n.endPosition.row]
  // a column's definition, laid at its rows
  const column = (c) => {
    const a = callArgs(c)
    const name = strOf(a.pos[0])
    if (!name) return null
    let type = null, fk = null
    for (const x of a.pos.slice(1)) {
      if (x.type === 'call' && lastName(field(x, 'function')?.text) === 'ForeignKey') { const xa = callArgs(x); const t = strOf(xa.pos[0]); if (t && t.includes('.')) fk = { to: t.slice(0, t.lastIndexOf('.')), col: t.slice(t.lastIndexOf('.') + 1), del: xa.kw.has('ondelete') ? ACTIONS[String(strOf(xa.kw.get('ondelete'))).toUpperCase()] : null } }
      else if (!type) type = sqlType(x, d)
    }
    const nullable = a.kw.has('nullable') ? boolOf(a.kw.get('nullable')) : null
    const pk = a.kw.has('primary_key') && boolOf(a.kw.get('primary_key')) === true
    const def = a.kw.has('server_default') ? defaultSql(a.kw.get('server_default')) : null
    return { name, sql: `${q(name)} ${type || 'VARCHAR'}${nullable === false || (pk && nullable !== true) ? ' NOT NULL' : ''}${def !== null ? ` DEFAULT ${def}` : ''}`, pk, fk, row: c.startPosition.row }
  }
  const fkSql = (cols, to, toCols, del) => `FOREIGN KEY(${cols.map(q).join(', ')}) REFERENCES ${qt(to)} (${toCols.map(q).join(', ')})${del ? ` ON DELETE ${del}` : ''}`
  const nameArg = (n) => { if (!n) return null; const v = value(n); if (v.k === 'str') return v.v; if (v.k === 'call' && /(?:^|\.)f$/.test(v.fn)) return strOf(callArgs(v.node).pos[0]); return v.k === 'none' ? null : undefined }
  const op = (call, table0) => {
    const fn = field(call, 'function'), name = lastName(fn?.text)
    const a = callArgs(call)
    const line = lineOf(call)
    const args = table0 ? [null, ...a.pos] : a.pos // a batch operation's table is its context's
    const tableOf = () => (table0 ?? strOf(a.pos[0]))
    const T = () => { const t = tableOf(); const sc = a.kw.has('schema') ? strOf(a.kw.get('schema')) : null; return t ? (sc ? `${sc}.${t}` : t) : null }
    const built = () => { out.notes.push(`${file}:${line}: op.${name} with arguments built by code: not read`); out.open++ }
    switch (name) {
      case 'create_table': {
        const t = T()
        if (!t) return built()
        const [r0, r1] = rows(call)
        const items = []
        const pks = []
        for (const x of a.pos.slice(1)) {
          if (x.type !== 'call') { built(); continue }
          const k = lastName(field(x, 'function')?.text), xa = callArgs(x)
          if (k === 'Column') { const c = column(x); if (!c) { built(); continue } items.push({ sql: c.sql, row: c.row }); if (c.pk) pks.push(c.name); if (c.fk) items.push({ sql: fkSql([c.name], c.fk.to, [c.fk.col], c.fk.del), row: c.row }) }
          else if (k === 'PrimaryKeyConstraint') { const cols = xa.pos.map(strOf); if (cols.every(Boolean)) items.push({ sql: `PRIMARY KEY (${cols.map(q).join(', ')})`, row: x.startPosition.row, pk: true }) }
          else if (k === 'UniqueConstraint') { const cols = xa.pos.map(strOf); const nm = nameArg(xa.kw.get('name')); if (cols.every(Boolean)) items.push({ sql: `${nm ? `CONSTRAINT ${q(nm)} ` : ''}UNIQUE (${cols.map(q).join(', ')})`, row: x.startPosition.row }) }
          else if (k === 'ForeignKeyConstraint') { const lc = strsOf(xa.pos[0]), rc = strsOf(xa.pos[1]); if (lc && rc && rc.every((s) => s.includes('.'))) items.push({ sql: fkSql(lc, rc[0].slice(0, rc[0].lastIndexOf('.')), rc.map((s) => s.slice(s.lastIndexOf('.') + 1)), xa.kw.has('ondelete') ? ACTIONS[String(strOf(xa.kw.get('ondelete'))).toUpperCase()] : null), row: x.startPosition.row }) }
          else if (k === 'CheckConstraint') out.other.check = (out.other.check || 0) + 1
          else if (k === 'Index') out.other.index = (out.other.index || 0) + 1
        }
        if (pks.length && !items.some((i) => i.pk)) items.push({ sql: `PRIMARY KEY (${pks.map(q).join(', ')})`, row: r1 })
        // laid at their rows: the statement's head at the call's, each item at its own, its close at the last
        const lines = Array.from({ length: r1 - r0 + 1 }, () => '')
        lines[0] = `CREATE TABLE ${qt(t)} (`
        items.forEach((it, i) => { const r = Math.min(Math.max(it.row - r0, 0), lines.length - 1); lines[r] += `${lines[r] && !lines[r].endsWith('(') ? ' ' : ''}${it.sql}${i < items.length - 1 ? ',' : ''}` })
        lines[lines.length - 1] += ')'
        return push(lines.join('\n'), r0 + 1)
      }
      case 'drop_table': { const t = T(); return t ? push(`DROP TABLE ${qt(t)}`, line) : built() }
      case 'rename_table': { const t = strOf(a.pos[0]), n = strOf(a.pos[1]); return t && n ? push(`ALTER TABLE ${qt(t)} RENAME TO ${q(n)}`, line) : built() }
      case 'add_column': { const t = T(), c = args[1]?.type === 'call' ? column(args[1]) : null; if (!t || !c) return built(); push(`ALTER TABLE ${qt(t)} ADD COLUMN ${c.sql}`, line); if (c.fk) push(`ALTER TABLE ${qt(t)} ADD ${fkSql([c.name], c.fk.to, [c.fk.col], c.fk.del)}`, line); return }
      case 'drop_column': { const t = T(), c = strOf(args[1]); return t && c ? push(`ALTER TABLE ${qt(t)} DROP COLUMN ${q(c)}`, line) : built() }
      case 'alter_column': {
        const t = T(), c = strOf(args[1])
        if (!t || !c) return built()
        // (MySQL changes a column's nullability with its whole definition, MODIFY, which alter_column does not state)
        if (a.kw.has('nullable')) { const nn = boolOf(a.kw.get('nullable')); if (nn !== null && d !== 'mysql') push(`ALTER TABLE ${qt(t)} ALTER COLUMN ${q(c)} ${nn ? 'DROP' : 'SET'} NOT NULL`, line); else if (nn !== null) { out.notes.push(`${file}:${line}: alter_column's nullability on MySQL: not read`); out.open++ } }
        if (a.kw.has('type_')) { const ty = sqlType(a.kw.get('type_'), d); if (ty && d === 'postgres') push(`ALTER TABLE ${qt(t)} ALTER COLUMN ${q(c)} TYPE ${ty}`, line) }
        if (a.kw.has('new_column_name')) { const n = strOf(a.kw.get('new_column_name')); if (n) push(`ALTER TABLE ${qt(t)} RENAME COLUMN ${q(c)} TO ${q(n)}`, line) }
        return
      }
      case 'create_index': {
        const nm = nameArg(a.pos[0]), t = table0 ?? strOf(a.pos[1]), cols = strsOf(table0 ? a.pos[1] : a.pos[2])
        if (!nm || !t || !cols) return built()
        const where = [...a.kw.keys()].some((k) => /_where$/.test(k)) ? ' WHERE TRUE' : ''
        return push(`CREATE ${a.kw.has('unique') && boolOf(a.kw.get('unique')) ? 'UNIQUE ' : ''}INDEX ${q(nm)} ON ${qt(t)} (${cols.map((c) => (/[()]/.test(c) ? c : q(c))).join(', ')})${where}`, line)
      }
      case 'drop_index': { const nm = nameArg(a.pos[0]); const t = table0 ?? (a.kw.has('table_name') ? strOf(a.kw.get('table_name')) : null); return nm ? push(d === 'mysql' && t ? `DROP INDEX ${q(nm)} ON ${qt(t)}` : `DROP INDEX ${q(nm)}`, line) : built() }
      case 'create_unique_constraint': { const nm = nameArg(a.pos[0]), t = table0 ?? strOf(a.pos[1]), cols = strsOf(table0 ? a.pos[1] : a.pos[2]); return t && cols ? push(`ALTER TABLE ${qt(t)} ADD ${nm ? `CONSTRAINT ${q(nm)} ` : ''}UNIQUE (${cols.map(q).join(', ')})`, line) : built() }
      case 'create_primary_key': { const nm = nameArg(a.pos[0]), t = table0 ?? strOf(a.pos[1]), cols = strsOf(table0 ? a.pos[1] : a.pos[2]); return t && cols ? push(`ALTER TABLE ${qt(t)} ADD ${nm ? `CONSTRAINT ${q(nm)} ` : ''}PRIMARY KEY (${cols.map(q).join(', ')})`, line) : built() }
      case 'create_foreign_key': {
        const nm = nameArg(a.pos[0]), src = table0 ?? strOf(a.pos[1]), ref = strOf(table0 ? a.pos[1] : a.pos[2]), lc = strsOf(table0 ? a.pos[2] : a.pos[3]), rc = strsOf(table0 ? a.pos[3] : a.pos[4])
        if (!src || !ref || !lc || !rc) return built()
        return push(`ALTER TABLE ${qt(src)} ADD ${nm ? `CONSTRAINT ${q(nm)} ` : ''}${fkSql(lc, ref, rc, a.kw.has('ondelete') ? ACTIONS[String(strOf(a.kw.get('ondelete'))).toUpperCase()] : null)}`, line)
      }
      case 'drop_constraint': {
        const nm = nameArg(a.pos[0]), t = table0 ?? strOf(a.pos[1])
        if (!nm || !t) return built()
        const ty = a.kw.has('type_') ? strOf(a.kw.get('type_')) : null
        return push(d === 'mysql' && ty === 'foreignkey' ? `ALTER TABLE ${qt(t)} DROP FOREIGN KEY ${q(nm)}` : d === 'mysql' && ty === 'unique' ? `ALTER TABLE ${qt(t)} DROP INDEX ${q(nm)}` : `ALTER TABLE ${qt(t)} DROP CONSTRAINT ${q(nm)}`, line)
      }
      case 'execute': { const s = strOf(a.pos[0]); return s ? push(s, line) : built() }
      case 'f': return
      default: out.other[name] = (out.other[name] || 0) + 1
    }
  }
  // the operations, in source order: op.* calls, and batch_op.* inside `with op.batch_alter_table(t) as b:`
  const walk = (n, batch) => {
    for (const c of named(n)) {
      if (out.sql.length >= MAX.ops) return
      if (c.type === 'with_statement') {
        const item = named(named(c).find((x) => x.type === 'with_clause') || c).find((x) => x.type === 'with_item')
        const asp = item ? field(item, 'value') : null
        const call = asp?.type === 'as_pattern' ? named(asp)[0] : null
        const alias = asp?.type === 'as_pattern' ? field(asp, 'alias')?.text || named(asp)[1]?.text : null
        if (call?.type === 'call' && lastName(field(call, 'function')?.text) === 'batch_alter_table') { const t = strOf(callArgs(call).pos[0]); walk(field(c, 'body') || c, t && alias ? { alias: alias.replace(/^as\s+/, ''), table: t } : null); continue }
      }
      if (c.type === 'call') {
        const fn = field(c, 'function')
        const obj = fn?.type === 'attribute' ? field(fn, 'object')?.text : null
        if (obj === 'op') { op(c, null); continue }
        if (batch && obj === batch.alias) { op(c, batch.table); continue }
      }
      if (c.type === 'function_definition' || c.type === 'class_definition') continue
      walk(c, batch)
    }
  }
  walk(field(up, 'body') || up, null)
  return out
}

// The dialect, first found: graph.data.migrations (an override); alembic.ini's sqlalchemy.url scheme
// (nothing else of it kept), every one agreeing; a URL the environment (env.py) writes literally; else
// sniffed from the revisions: the one engine whose dialect module they import or name
// (`from sqlalchemy.dialects import postgresql`, `sa.dialects.postgresql.UUID`, `mysql.TINYINT`).
// → { dialect, from } | { dialect: null, why }
const URL_AT = /\b([a-z][a-z0-9]{1,20})(?:\+[a-z0-9_]{1,30})?:\/\//
const DIALECT_MODULE = /\bsqlalchemy\.dialects\.(postgresql|mysql|sqlite)\b|\bfrom[ \t]+sqlalchemy\.dialects[ \t]+import[ \t]+(postgresql|mysql|sqlite)\b|\b(?:sa|sqlalchemy)\.dialects\.(postgresql|mysql|sqlite)\b/
function dialectOf(override, inis, envs, members) {
  if (override) return { dialect: normDialect(override), from: { how: 'override' } }
  const lineAt = (text, i) => text.slice(0, i).split('\n').length
  const ds = []
  for (const f of inis) { const m = /^sqlalchemy\.url[ \t]*=[ \t]*([a-z][a-z0-9]{1,20})(?:\+[a-z0-9_]{1,30})?:\/\//m.exec(f.text); if (m && SCHEMES[m[1]]) ds.push({ d: SCHEMES[m[1]], path: f.path, line: lineAt(f.text, m.index) }) }
  if (ds.length) return new Set(ds.map((x) => x.d)).size === 1 ? { dialect: ds[0].d, from: { how: 'stated', path: ds[0].path, line: ds[0].line } } : { dialect: null, why: 'the engine URLs name several engines' }
  for (const f of envs) {
    for (const m of f.text.matchAll(new RegExp(`(['"])${URL_AT.source}`, 'g'))) if (SCHEMES[m[2]]) ds.push({ d: SCHEMES[m[2]], path: f.path, line: lineAt(f.text, m.index) })
  }
  if (ds.length) return new Set(ds.map((x) => x.d)).size === 1 ? { dialect: ds[0].d, from: { how: 'stated', path: ds[0].path, line: ds[0].line } } : { dialect: null, why: 'the engine URLs name several engines' }
  const seen = new Map()
  for (const f of members) {
    const re = new RegExp(DIALECT_MODULE.source, 'g')
    for (const m of f.text.matchAll(re)) { const d = SCHEMES[m[1] || m[2] || m[3]]; if (d && !seen.has(d)) seen.set(d, { marker: m[0].replace(/\s+/g, ' '), path: f.path, line: lineAt(f.text, m.index) }) }
  }
  if (seen.size === 1) { const [[d, at]] = seen; return { dialect: d, from: { how: 'sniffed', ...at } } }
  return { dialect: null, why: seen.size ? `the revisions name several engines' dialects (${[...seen.keys()].join(', ')})` : 'no alembic.ini or env.py states a literal engine URL, and no revision names a dialect' }
}

export default {
  id: 'alembic',
  version: 2,
  kind: 'migration',
  source: true,
  aside: true,
  scope: 'unit',
  tree: true,
  wants: (p) => PY.test(p) || INI.test(p),
  level: (p, text) => alembicLevel(p, text),
  parses: (p, text) => (alembicLevel(p, text) & 524288) !== 0,
  config: (p) => INI.test(p),
  // overrides: graph.data.migrations entries ({ path: the versions folder, dialect }), as for a .sql folder
  discover(info, { overrides = [] } = {}) {
    const folders = new Map()
    for (const [p, i] of info) if (PY.test(p) && i.ddl & 524288) { const d = P.dirname(p); if (!folders.has(d)) folders.set(d, []); folders.get(d).push(p) }
    const inis = [...info.keys()].filter((p) => INI.test(p)).sort()
    // the environment beside a versions folder (its env.py), read for an engine URL it states literally
    const envs = [...info].filter(([p, i]) => PY.test(p) && i.ddl & 1048576 && !(i.ddl & 524288)).map(([p]) => p)
    return [...folders].map(([d, list]) => {
      const o = overrides.find((x) => x.path === d)
      const env = envs.filter((p) => P.dirname(p) === P.dirname(d)).sort()
      return { key: d, inputs: [...list.sort(), ...inis, ...env], ...(o ? { override: o.dialect, salt: `dialect=${o.dialect}` } : {}) }
    })
  },
  // the dialect is a part of what a file reads as (the DDL written for it): parse takes it in ctx
  parse(text, file, ctx) {
    const tree = ctx.tree('python', text)
    try { return Object.fromEntries(['postgres', 'mysql', 'sqlite'].map((d) => [d, readFile(tree.rootNode, file, d)])) } finally { tree.delete?.() }
  },
  extract({ key, files, override }, ctx) {
    const inis = files.filter((f) => INI.test(f.path))
    const envs = files.filter((f) => !INI.test(f.path) && !(alembicLevel(f.path, f.text) & 524288))
    const members = files.filter((f) => !INI.test(f.path) && !envs.includes(f))
    const notes = []
    const d0 = dialectOf(override, inis, envs, members)
    const dialect = d0.dialect
    const base = { store: key, dialect, dialectFrom: d0.from, source: { path: members[0].path, line: 1, kind: 'migration', confidence: 'exact' }, complete: false, partial: false, files: members.length, entities: [], clients: ['alembic', 'sqlalchemy'] }
    if (!dialect) return { declarations: [{ ...base, status: 'not-read', label: `dialect unknown (${d0.why})`, notes: [] }] }
    const parsed = members.map((f) => ({ path: f.path, text: f.text, ...(ctx.aside ? ctx.aside('alembic', f.path, f.text) : this.parse(f.text, f.path, ctx))[dialect] }))
    // the revision graph, root to its one head
    const byRev = new Map(parsed.filter((p) => p.revision).map((p) => [p.revision, p]))
    const found = (why) => ({ declarations: [{ ...base, status: 'not-read', label: `order unknown (${why})`, notes: [] }] })
    const bad = parsed.find((p) => !p.revision || p.downCode)
    if (bad) return found(`${bad.path} has no literal revision or down_revision`)
    const missing = parsed.find((p) => p.down.some((x) => !byRev.has(x)))
    if (missing) return found(`${missing.path} revises ${missing.down.find((x) => !byRev.has(x))}, which no file declares`)
    const revised = new Set(parsed.flatMap((p) => p.down))
    const heads = parsed.filter((p) => !revised.has(p.revision))
    if (heads.length !== 1) return found(`${heads.length} heads: ${heads.map((h) => h.revision).join(', ')}`)
    const order = [], seen = new Set()
    const visit = (p, stack = new Set()) => { if (seen.has(p.revision)) return true; if (stack.has(p.revision)) return false; stack.add(p.revision); for (const d of p.down) if (!visit(byRev.get(d), stack)) return false; seen.add(p.revision); order.push(p); return true }
    if (!visit(heads[0])) return found('the revisions form a cycle')
    let open = 0
    const other = {}
    for (const p of order) { notes.push(...p.notes); open += p.open; for (const [k, n] of Object.entries(p.other)) other[k] = (other[k] || 0) + n }
    if (Object.keys(other).length) notes.push(`operations that do not shape the store, or are not read: ${Object.entries(other).map(([k, n]) => `${k} ${n}`).join(', ')}`)
    const laid = order.map((p) => ({ path: p.path, text: layout(p.sql, p.text.split('\n').length) }))
    const what = `Alembic revisions, replayed ${counted(laid.length, 'file')}`
    if (dialect === 'sqlite') {
      const r = replay(laid, ctx.DatabaseSync)
      return { declarations: [{ ...base, entities: r.entities, implicitIndexes: r.implicit, notes: [...notes, ...r.notes].slice(0, MAX.notes), complete: !r.stopped && !open, partial: !!r.stopped, status: r.stopped ? 'partial' : 'read', label: r.stopped ? 'replayed to' : `${what}, ${counted(r.statements, 'statement')}`, ...(r.stopped ? { stopped: { path: r.stopped.path, line: r.stopped.line }, error: r.stopped.error } : {}) }] }
    }
    const f = ddlFacts(readDdl(laid, { dialect }), notes, what)
    return { declarations: [{ ...base, ...f, notes: f.notes.slice(0, MAX.notes), complete: f.complete && !open }] }
  },
}
