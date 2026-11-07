// grimoire graph · data · extractor: Drizzle's schema snapshots, the model drizzle-kit wrote after
// each migration it generated (an artifact: the tool's own statement of the store). Per file.
//
//   legacy  <out>/meta/NNNN_snapshot.json: { version, dialect, tables{<t>: { name, columns{…},
//           indexes{…}, foreignKeys{…}, compositePrimaryKeys{…}, uniqueConstraints{…} }}, views }.
//           Only the newest of a meta/ folder is read (the highest NNNN: drizzle-kit numbers them
//           by journal index); older ones describe stores that no longer exist.
//   v1      <out>/<timestamp>_<name>/snapshot.json beside its migration.sql: { version, dialect,
//           id, prevIds[], ddl: [{ entityType: tables | columns | pks | uniques | indexes | fks |
//           checks | views, … }] } (drizzle-kit's beta v1: dialects/*/snapshot.ts, ddl.ts). Every
//           one is read; the snapshots form a DAG through prevIds, and reconcile.mjs keeps its leaves.
// The store is the folder drizzle-kit writes into (`out`), the same one the SQL replay reads.
// Check constraints are not part of the model yet.
import path from 'node:path'
import { jsonLines, pathKey, parseJson } from '../readers/json-lines.mjs'
import { normDialect } from '../model.mjs'

const LEGACY = /(^|\/)meta\/(\d+)_snapshot\.json$/
const V1 = /(^|\/)[^/]+\/snapshot\.json$/
const action = (a) => String(a || 'no action').toLowerCase()
const column = (c) => (typeof c === 'string' ? c : c.value ?? c.expression ?? '(expression)')
const value = (d) => (d === undefined || d === null ? null : typeof d === 'object' ? String(d.value ?? JSON.stringify(d)) : String(d))
const qualified = (schema, name) => (schema && schema !== 'public' ? `${schema}.${name}` : name)

export default {
  id: 'drizzle-snapshot',
  version: 1,
  kind: 'artifact',
  scope: 'file',
  wants: (p) => LEGACY.test(p) || V1.test(p),
  discover(info) {
    const newest = new Map() // meta/ folder → [number, path]
    const jobs = []
    for (const p of info.keys()) {
      const m = LEGACY.exec(p)
      if (m) { const dir = path.posix.dirname(p), n = Number(m[2]); if (!newest.has(dir) || newest.get(dir)[0] < n) newest.set(dir, [n, p]); continue }
      if (V1.test(p) && info.has(`${path.posix.dirname(p)}/migration.sql`)) jobs.push({ key: p, inputs: [p] })
    }
    for (const [, [, p]] of newest) jobs.push({ key: p, inputs: [p] })
    return jobs
  },
  extract(text, file) {
    const j = parseJson(text)
    if (!j || (typeof j.tables !== 'object' && !Array.isArray(j.ddl))) throw new Error('not a Drizzle snapshot: neither tables{} nor ddl[]')
    const lines = jsonLines(text)
    const at = (...k) => ({ path: file, line: lines.get(pathKey(...k)) ?? 1 })
    const entities = Array.isArray(j.ddl) ? fromDDL(j.ddl, at) : fromTables(j, at)
    return { declarations: [{
      store: path.posix.dirname(path.posix.dirname(file)),
      dialect: normDialect(j.dialect),
      dialectFrom: { how: 'stated', path: file, line: lines.get(pathKey('dialect')) ?? 1 },
      source: { path: file, line: 1, kind: 'artifact', confidence: 'declared' },
      complete: true, partial: false, status: 'read', label: 'snapshot', notes: [],
      ...(Array.isArray(j.ddl) ? { snapshot: { id: j.id, prevIds: j.prevIds || [] } } : {}),
      entities,
    }] }
  },
}

const entity = (name, kind, loc) => ({ name, kind, ...loc, fields: [], keys: [], indexes: [], relations: [] })

function fromTables(j, at) {
  const out = []
  for (const [tk, t] of Object.entries(j.tables || {})) {
    const e = entity(qualified(t.schema, t.name), 'table', at('tables', tk))
    const cols = Object.entries(t.columns || {})
    for (const [ck, c] of cols) e.fields.push({ name: c.name, type: c.type, nullable: !c.notNull, default: value(c.default), generated: c.generated?.type ?? null, ...at('tables', tk, 'columns', ck) })
    const composite = Object.entries(t.compositePrimaryKeys || {})
    for (const [k, pk] of composite) e.keys.push({ role: 'primary', parts: typeof pk === 'string' ? pk.split(',') : pk.columns, ...at('tables', tk, 'compositePrimaryKeys', k) })
    const single = cols.filter(([, c]) => c.primaryKey)
    if (!composite.length && single.length) e.keys.push({ role: 'primary', parts: single.map(([, c]) => c.name), ...at('tables', tk, 'columns', single[0][0]) })
    for (const [k, u] of Object.entries(t.uniqueConstraints || {})) e.keys.push({ role: 'unique', parts: u.columns, ...at('tables', tk, 'uniqueConstraints', k) })
    for (const [k, ix] of Object.entries(t.indexes || {})) e.indexes.push({ name: ix.name, unique: !!ix.isUnique, columns: ix.columns.map(column), partial: !!ix.where, ...at('tables', tk, 'indexes', k) })
    for (const [k, fk] of Object.entries(t.foreignKeys || {})) e.relations.push({ columns: fk.columnsFrom, to: qualified(fk.schemaTo, fk.tableTo), toColumns: fk.columnsTo, onDelete: action(fk.onDelete), onUpdate: action(fk.onUpdate), ...at('tables', tk, 'foreignKeys', k) })
    out.push(e)
  }
  for (const [k, v] of Object.entries(j.views || {})) out.push(entity(qualified(v.schema, v.name), 'view', at('views', k)))
  return out
}

function fromDDL(ddl, at) {
  const tables = new Map()
  const of = (type) => ddl.map((e, i) => [e, i]).filter(([e]) => e.entityType === type)
  const owner = (e) => tables.get(qualified(e.schema, e.table))
  for (const [e, i] of of('tables')) tables.set(qualified(e.schema, e.name), entity(qualified(e.schema, e.name), 'table', at('ddl', i)))
  for (const [e, i] of of('columns')) owner(e)?.fields.push({ name: e.name, type: e.type, nullable: !e.notNull, default: value(e.default), generated: e.generated?.type ?? null, ...at('ddl', i) })
  for (const [e, i] of of('pks')) owner(e)?.keys.push({ role: 'primary', parts: e.columns, ...at('ddl', i) })
  for (const [e, i] of of('uniques')) owner(e)?.keys.push({ role: 'unique', parts: e.columns, ...at('ddl', i) })
  for (const [e, i] of of('indexes')) {
    const columns = e.columns.map(column)
    // origin 'auto': the index SQLite builds for a UNIQUE constraint, i.e. a unique key
    if (e.origin === 'auto') owner(e)?.keys.push({ role: 'unique', parts: columns, ...at('ddl', i) })
    else owner(e)?.indexes.push({ name: e.name, unique: !!e.isUnique, columns, partial: !!e.where, ...at('ddl', i) })
  }
  for (const [e, i] of of('fks')) owner(e)?.relations.push({ columns: e.columns, to: qualified(e.schemaTo, e.tableTo), toColumns: e.columnsTo, onDelete: action(e.onDelete), onUpdate: action(e.onUpdate), ...at('ddl', i) })
  const views = of('views').map(([e, i]) => entity(qualified(e.schema, e.name), 'view', at('ddl', i)))
  return [...tables.values(), ...views]
}
