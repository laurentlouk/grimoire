// grimoire graph · data · extractor: Prisma schemas, a code model (kind code: what the code says the
// store is, which `prisma migrate` turns into migrations). Read by a hand reader (readers/prisma.mjs,
// spec D9). Per unit: a schema root and its files, re-run when any of them or its config changes.
//
// Found by content: any `.prisma` file holding a model, view or enum block (a single schema.prisma,
// or a folder of them, Prisma's multi-file schema). A file holding a datasource block is a root; every
// schema file belongs to the nearest root at or above its folder (a file under none is a root of its
// own, its dialect unknown). A prisma.config.* at or above a root, naming it or naming no schema,
// may state where its migrations go (`migrations: { path }`).
//
// The store is where the root's migrations go: the config's migrations path, else `<root>/migrations`
// (beside schema.prisma, as `prisma migrate` writes them) — the folder the SQL replay reads, so the
// schema and its migrations are two declarations of one store, and where they disagree the schema
// was edited and no migration generated (a conflict, both sides kept; spec D2). A schema with no
// migrations still names that store.
//
// What is read, in the store's own terms, so it compares with the migrations:
//   - datasource `provider` → the dialect; `relationMode = "prisma"` → no foreign keys in the
//     database (none modeled, noted); `@@schema` (multiSchema) → `schema.table` outside `public`.
//     Nothing else of a datasource is kept (its url may hold a secret).
//   - model → a table (`@@map` its physical name), view → a view (by name; its columns are not
//     compared, as the other readers draw a view), enum → an enum (`@@map`, `@map` per value),
//     composite `type` blocks → noted, not modeled.
//   - a field of a scalar or an enum type → a column (`@map` its name): its type as `prisma migrate`
//     writes it for the provider (String → TEXT on SQLite, a `@db.*` native type as written: VARCHAR(255)),
//     `?` nullable, a list `[]` (an array column) nullable; `@id` and `@@id` → the primary key;
//     `@unique`, `@@unique` → a unique index and `@@index` → an index, named as Prisma names them
//     (`<table>_<columns>_key` / `_idx`, or `map:`), since that is what its migrations create;
//     `@default` → the default the migration writes (`now()` → CURRENT_TIMESTAMP, a string quoted,
//     an enum value quoted, `dbgenerated("…")` its text); `autoincrement()` no default (SERIAL on
//     Postgres); `uuid()`, `cuid()`, `nanoid()`, `ulid()` and `@updatedAt` computed by the client,
//     recorded as computed defaults, never evaluated. A type or a default no rule maps is kept as
//     written and not compared (`unstated`).
//   - a relation field with `@relation(fields, references)` → a foreign key, its actions as written
//     or Prisma's defaults (on delete Restrict when the relation is required, SetNull when optional;
//     on update Cascade). An implicit many-to-many relation → its join table `_AToB` (or `_<name>`),
//     columns A and B and their foreign keys; its keys and indexes vary with the version, so the table
//     is stated in part (`part`).
// Comments are skipped. A block that does not parse is skipped and noted, and the declaration is then
// not complete (a model it lacks may be the one that did not parse).
import path from 'node:path'
import { readPrisma, prismaLevel } from '../readers/prisma.mjs'
import { normDialect } from '../model.mjs'

const P = path.posix
const PRISMA = /\.prisma$/i
const CONFIG = /(^|\/)prisma\.config\.(?:ts|mts|cts|js|mjs|cjs)$/
const SCALARS = new Set(['String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes'])
// the column type `prisma migrate` writes for a scalar, per provider (Json on SQLite is not stated)
const TYPES = {
  sqlite: { String: 'TEXT', Boolean: 'BOOLEAN', Int: 'INTEGER', BigInt: 'BIGINT', Float: 'REAL', Decimal: 'DECIMAL', DateTime: 'DATETIME', Bytes: 'BLOB' },
  postgres: { String: 'TEXT', Boolean: 'BOOLEAN', Int: 'INTEGER', BigInt: 'BIGINT', Float: 'DOUBLE PRECISION', Decimal: 'DECIMAL(65,30)', DateTime: 'TIMESTAMP(3)', Json: 'JSONB', Bytes: 'BYTEA' },
  mysql: { String: 'VARCHAR(191)', Boolean: 'BOOLEAN', Int: 'INTEGER', BigInt: 'BIGINT', Float: 'DOUBLE', Decimal: 'DECIMAL(65,30)', DateTime: 'DATETIME(3)', Json: 'JSON', Bytes: 'LONGBLOB' },
}
const SERIAL = { INTEGER: 'SERIAL', BIGINT: 'BIGSERIAL', SMALLINT: 'SMALLSERIAL' }
const COMPUTED = new Set(['uuid', 'cuid', 'nanoid', 'ulid', 'auto'])
const ACTIONS = { Cascade: 'cascade', Restrict: 'restrict', NoAction: 'no action', SetNull: 'set null', SetDefault: 'set default' }
const MAX_NOTES = 8
const cap = (s, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export default {
  id: 'prisma',
  version: 1,
  kind: 'code',
  scope: 'unit',
  wants: (p) => PRISMA.test(p) || CONFIG.test(p),
  level: (p, text) => (PRISMA.test(p) ? prismaLevel(text) : 0),
  config: (p) => CONFIG.test(p),
  // info: Map(path → { ddl }), ddl a schema file's level (32: a datasource, 16: a model, view or enum)
  discover(info) {
    const files = [...info].filter(([p, i]) => PRISMA.test(p) && (i.ddl & 48)).map(([p, i]) => [p, i.ddl])
    const roots = new Set(files.filter(([, d]) => d & 32).map(([p]) => P.dirname(p)))
    const units = new Map()
    for (const [p] of files) {
      let d = P.dirname(p)
      while (!roots.has(d) && d !== '.') d = P.dirname(d)
      const root = roots.has(d) ? d : P.dirname(p)
      if (!units.has(root)) units.set(root, [])
      units.get(root).push(p)
    }
    const configs = [...info.keys()].filter((p) => CONFIG.test(p))
    const within = (dir, p) => dir === '.' || p === dir || p.startsWith(`${dir}/`)
    return [...units].map(([root, list]) => {
      // the nearest config at or above the root (its folder, or the folder holding it)
      const near = configs.filter((c) => within(P.dirname(c), root)).sort((a, b) => P.dirname(b).length - P.dirname(a).length)
      const top = near.length ? near.filter((c) => P.dirname(c) === P.dirname(near[0])) : []
      return { key: root, inputs: [...list.sort(), ...top.sort()] }
    })
  },
  extract({ key: root, files }) {
    const configs = files.filter((f) => CONFIG.test(f.path))
    const schemas = files.filter((f) => PRISMA.test(f.path))
    const notes = []
    const note = (s) => { if (notes.length < MAX_NOTES) notes.push(s) }
    // every block of every file, each knowing its file
    const blocks = []
    let errors = 0
    for (const f of schemas) {
      const r = readPrisma(f.text)
      for (const b of r.blocks) blocks.push({ ...b, path: f.path })
      for (const e of r.errors) { errors++; note(`${f.path}:${e.line}: ${e.error}; that block is skipped`) }
    }
    const sources = blocks.filter((b) => b.kind === 'datasource')
    const ds = sources[0] || null
    if (sources.length > 1) note(`${sources.length} datasource blocks: the first (${ds.path}:${ds.line}) is read`)
    const entry = (k) => ds?.entries.find((e) => e.key === k) || null
    const provider = entry('provider')
    const dialect = provider?.value.k === 'str' ? normDialect(provider.value.v) : null
    if (provider && !dialect) note(`the datasource provider at ${ds.path}:${provider.line} is not a literal: dialect unknown`)
    const rm = entry('relationMode')
    const noFks = rm?.value.k === 'str' && rm.value.v === 'prisma'
    if (noFks) note(`relationMode = "prisma" (${ds.path}:${rm.line}): relations are emulated by the client, no foreign key in the database`)
    const mongo = dialect === 'mongodb'
    const config = pickConfig(configs, root)
    const store = config?.migrations ? config.migrations : root === '.' ? 'migrations' : `${root}/migrations`

    const enums = new Map(), models = new Map(), types = new Set()
    for (const b of blocks) {
      if (b.kind === 'enum') enums.set(b.name, b)
      else if (b.kind === 'model' || b.kind === 'view') models.set(b.name, b)
      else if (b.kind === 'type') types.add(b.name)
    }
    if (types.size) note(`${types.size} composite type${types.size === 1 ? '' : 's'} (embedded documents): not modeled`)
    const mapOf = (attrs, name) => { const a = attrs.find((x) => x.name === name); const v = a?.args[0]?.value; return v?.k === 'str' ? v.v : null }
    const schemaOf = (b) => mapOf(b.attrs, 'schema')
    const qualified = (schema, name) => (schema && schema !== 'public' ? `${schema}.${name}` : name)
    const tableOf = (b) => mapOf(b.attrs, 'map') || b.name
    const enumOut = [...enums.values()].map((e) => ({ name: qualified(schemaOf(e), mapOf(e.attrs, 'map') || e.name), values: e.values.map((v) => mapOf(v.attrs, 'map') || v.name), path: e.path, line: e.line }))
    const enumValue = (e, v) => { const x = e.values.find((y) => y.name === v); return x ? mapOf(x.attrs, 'map') || x.name : v }
    const columnOf = (m, fieldName) => { const f = m.fields.find((x) => x.name === fieldName); return f ? mapOf(f.attrs, 'map') || f.name : fieldName }
    const isColumn = (f) => SCALARS.has(f.type) || enums.has(f.type) || f.unsupported !== undefined || (!models.has(f.type) && !types.has(f.type))
    const listArg = (a, named) => { const arg = a.args.find((x) => x.name === named) || (named === 'fields' ? a.args.find((x) => x.name === null && x.value.k === 'list') : null); return arg?.value.k === 'list' ? arg.value.items.map((v) => (v.k === 'call' ? v.name : v.k === 'id' ? v.v : null)).filter(Boolean) : null }
    const strArg = (a, named) => { const arg = a.args.find((x) => x.name === named); return arg?.value.k === 'str' ? arg.value.v : null }

    const entities = []
    const joins = new Map() // implicit many-to-many join tables, by name
    for (const m of models.values()) {
      const table = tableOf(m)
      const name = qualified(schemaOf(m), table)
      const e = { name, kind: m.kind === 'view' ? 'view' : mongo ? 'collection' : 'table', path: m.path, line: m.line, fields: [], keys: [], indexes: [], relations: [] }
      entities.push(e)
      if (m.kind === 'view') continue
      const at = (line) => ({ path: m.path, line })
      for (const f of m.fields) {
        if (!isColumn(f)) {
          // a relation field: the foreign key is on the side that names its fields
          const rel = f.attrs.find((a) => a.name === 'relation')
          const target = models.get(f.type)
          const fields = rel && listArg(rel, 'fields'), refs = rel && listArg(rel, 'references')
          if (fields && refs && target && !noFks && !mongo) {
            const del = rel.args.find((x) => x.name === 'onDelete')?.value, upd = rel.args.find((x) => x.name === 'onUpdate')?.value
            e.relations.push({ columns: fields.map((x) => columnOf(m, x)), to: qualified(schemaOf(target), tableOf(target)), toColumns: refs.map((x) => columnOf(target, x)), onDelete: (del?.k === 'id' && ACTIONS[del.v]) || (f.optional ? 'set null' : 'restrict'), onUpdate: (upd?.k === 'id' && ACTIONS[upd.v]) || 'cascade', ...at(f.line) })
          } else if (f.list && target && !noFks && !mongo && target.fields.some((x) => x.type === m.name && x.list && x !== f)) {
            // both sides a list and neither naming its fields: an implicit many-to-many relation
            implicitJoin(joins, m, f, rel, target, models, (model, id) => typeOf(id, dialect, enums))
          }
          continue
        }
        const column = mapOf(f.attrs, 'map') || f.name
        const field = { name: column, ...typeOf(f, dialect, enums), nullable: f.optional || f.list, default: null, generated: null, ...at(f.line) }
        const d = f.attrs.find((a) => a.name === 'default')
        if (d) Object.assign(field, defaultOf(d, f, dialect, enums, enumValue, field))
        if (f.attrs.some((a) => a.name === 'updatedAt')) field.computed = field.computed ? `${field.computed} · @updatedAt` : '@updatedAt'
        if (enums.has(f.type)) field.enum = { name: qualified(schemaOf(enums.get(f.type)), mapOf(enums.get(f.type).attrs, 'map') || f.type), values: enums.get(f.type).values.map((v) => mapOf(v.attrs, 'map') || v.name) }
        e.fields.push(field)
        if (f.attrs.some((a) => a.name === 'id')) e.keys.push({ role: 'primary', parts: [column], ...at(f.line) })
        const u = f.attrs.find((a) => a.name === 'unique')
        if (u) e.indexes.push({ name: strArg(u, 'map') || `${table}_${column}_key`, unique: true, columns: [column], partial: false, ...at(u.line) })
      }
      for (const a of m.attrs) {
        const cols = listArg(a, 'fields')
        if (!cols) continue
        const columns = cols.map((x) => columnOf(m, x))
        if (a.name === 'id') e.keys.push({ role: 'primary', parts: columns, ...at(a.line) })
        else if (a.name === 'unique') e.indexes.push({ name: strArg(a, 'map') || `${table}_${columns.join('_')}_key`, unique: true, columns, partial: false, ...at(a.line) })
        else if (a.name === 'index' || a.name === 'fulltext') e.indexes.push({ name: strArg(a, 'map') || strArg(a, 'name') || `${table}_${columns.join('_')}_idx`, unique: false, columns, partial: false, ...at(a.line) })
      }
    }
    for (const j of joins.values()) entities.push(j)
    if (!blocks.some((b) => b.kind === 'model' || b.kind === 'view' || b.kind === 'enum')) return { declarations: [] }
    const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
    const nModels = [...models.values()].filter((m) => m.kind === 'model').length
    const first = ds || blocks.find((b) => b.kind === 'model') || blocks[0]
    return { declarations: [{
      store, dialect,
      dialectFrom: dialect ? { how: 'stated', path: ds.path, line: provider.line } : null,
      source: { path: first.path, line: 1, kind: 'code', confidence: 'declared' },
      complete: !errors && !mongo, partial: false, status: 'read',
      label: `schema, read ${counted(schemas.length, 'file')}: ${[counted(nModels, 'model'), enums.size && counted(enums.size, 'enum'), models.size - nModels && counted(models.size - nModels, 'view')].filter(Boolean).join(', ')}`,
      notes: [...(errors ? ['a block that did not parse is skipped: the schema is compared on what it states, not for what it lacks'] : []), ...(config?.note ? [config.note] : []), ...notes].slice(0, MAX_NOTES),
      files: schemas.length,
      ...(enumOut.length ? { enums: enumOut } : {}),
      entities,
    }] }
  },
}

// The config that applies to a root: one naming no schema, or naming the root, a file in it, or a
// folder holding it. → { migrations: the store, note } | null
function pickConfig(configs, root) {
  for (const c of configs) {
    const dir = P.dirname(c.path)
    const at = (rel) => P.normalize(P.join(dir, rel)).replace(/\/+$/, '') || '.'
    const schema = /\bschema\s*:\s*(['"`])([^'"`\n]{1,400})\1/.exec(c.text)
    if (schema) {
      const s = at(schema[2])
      if (!(s === root || P.dirname(s) === root || root.startsWith(`${s}/`) || s === '.')) continue
    }
    // (each attempt bounded: a brace never closed costs 2 000 characters, not the rest of the file)
    const mig = /\bmigrations\s*:\s*\{[^}]{0,2000}?\bpath\s*:\s*(['"`])([^'"`\n]{1,400})\1/.exec(c.text)
    if (mig) return { migrations: at(mig[2]), note: `migrations path stated in ${c.path}` }
    return null
  }
  return null
}

// A column's type as the migration writes it: { type, unstated? }.
function typeOf(f, dialect, enums) {
  const native = f.attrs.find((a) => a.name.startsWith('db.'))
  if (native) {
    const n = native.name.slice(3)
    const u = /^Unsigned(\w+)$/.exec(n)
    const base = n === 'DoublePrecision' ? 'DOUBLE PRECISION' : u ? `${u[1] === 'Int' ? 'INTEGER' : u[1].toUpperCase()} UNSIGNED` : n === 'Int' && dialect === 'mysql' ? 'INTEGER' : n.toUpperCase()
    const args = native.args.map((a) => (a.value.k === 'num' || a.value.k === 'id' ? a.value.v : a.value.k === 'str' ? a.value.v : '')).filter((x) => x !== '')
    return { type: `${args.length ? `${base}(${args.join(',')})` : base}${f.list ? '[]' : ''}` }
  }
  if (f.unsupported !== undefined) return { type: cap(f.unsupported || 'Unsupported'), unstated: ['type'] }
  if (enums.has(f.type)) {
    const e = enums.get(f.type)
    const name = e.attrs.find((a) => a.name === 'map')?.args[0]?.value
    const physical = name?.k === 'str' ? name.v : f.type
    if (dialect === 'sqlite') return { type: 'TEXT' }
    if (dialect === 'postgres') return { type: `${physical}${f.list ? '[]' : ''}` }
    if (dialect === 'mysql') return { type: `ENUM(${e.values.map((v) => `'${(v.attrs.find((a) => a.name === 'map')?.args[0]?.value?.v ?? v.name).replace(/'/g, "''")}'`).join(',')})` }
    return { type: f.type, unstated: ['type'] }
  }
  const t = TYPES[dialect]?.[f.type]
  if (!t) return { type: `${f.type}${f.list ? '[]' : ''}`, unstated: ['type'] }
  const serial = dialect === 'postgres' && f.attrs.some((a) => a.name === 'default' && a.args[0]?.value.k === 'call' && a.args[0].value.name === 'autoincrement')
  return { type: `${serial && SERIAL[t] ? SERIAL[t] : t}${f.list ? '[]' : ''}` }
}

// What @default(…) says, in the migration's terms: { default } | { default: text, unstated } |
// { computed } (a value the client computes: no default in the database).
function defaultOf(attr, f, dialect, enums, enumValue, field) {
  const v = attr.args.find((a) => a.name === null || a.name === 'value')?.value
  if (!v) return {}
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
  const shown = cap(`@default(${valueText(v)})`)
  if (v.k === 'str') return { default: quote(v.v) }
  if (v.k === 'num') return { default: v.v }
  if (v.k === 'id' && (v.v === 'true' || v.v === 'false')) return { default: v.v }
  if (v.k === 'id' && enums.has(f.type)) return { default: quote(enumValue(enums.get(f.type), v.v)) }
  if (v.k === 'call') {
    if (v.name === 'now' && !v.args.length) return { default: dialect === 'mysql' ? 'CURRENT_TIMESTAMP(3)' : 'CURRENT_TIMESTAMP' }
    if (v.name === 'autoincrement') return { default: null }
    if (v.name === 'dbgenerated' && v.args[0]?.value.k === 'str') return { default: v.args[0].value.v }
    if (COMPUTED.has(v.name)) return { default: null, computed: shown }
  }
  return { default: shown, unstated: [...(field.unstated || []), 'default'] }
}

// A value as the schema writes it (for what is kept as text).
function valueText(v, depth = 0) {
  if (depth > 8) return '…'
  if (v.k === 'str') return JSON.stringify(v.v)
  if (v.k === 'num' || v.k === 'id') return v.v
  if (v.k === 'list') return `[${v.items.map((x) => valueText(x, depth + 1)).join(', ')}]`
  return `${v.name}(${v.args.map((a) => `${a.name ? `${a.name}: ` : ''}${valueText(a.value, depth + 1)}`).join(', ')})`
}

// An implicit many-to-many relation's join table: `_<A>To<B>` (the two models by name), or
// `_<relation name>`, columns A and B, each a foreign key to its model's id, cascading. Stated in
// part: its keys and indexes vary with the version.
function implicitJoin(joins, m, f, rel, target, models, typeOfId) {
  const relName = rel?.args.find((x) => x.name === null && x.value.k === 'str')?.value.v || rel?.args.find((x) => x.name === 'name' && x.value.k === 'str')?.value.v || null
  const [a, b] = [m.name, target.name].sort()
  const name = `_${relName || `${a}To${b}`}`
  if (joins.has(name)) return
  const idOf = (model) => models.get(model)?.fields.find((x) => x.attrs.some((y) => y.name === 'id')) || null
  const columnOf = (id) => { const map = id.attrs.find((y) => y.name === 'map')?.args[0]?.value; return map?.k === 'str' ? map.v : id.name }
  const tableName = (model) => { const mm = models.get(model); const map = mm?.attrs.find((y) => y.name === 'map')?.args[0]?.value; return map?.k === 'str' ? map.v : model }
  const ida = idOf(a), idb = idOf(b)
  if (!ida || !idb) return
  const at = { path: m.path, line: f.line }
  // the id's type, without what its own default makes of it (SERIAL is the id's, not the join's)
  const plain = (id) => { const t = typeOfId(null, { ...id, list: false, attrs: id.attrs.filter((x) => x.name !== 'default') }); return { type: t.type, ...(t.unstated ? { unstated: t.unstated } : {}) } }
  joins.set(name, {
    name, kind: 'table', part: true, ...at,
    fields: [{ name: 'A', ...plain(ida), nullable: false, default: null, generated: null, ...at }, { name: 'B', ...plain(idb), nullable: false, default: null, generated: null, ...at }],
    keys: [], indexes: [],
    relations: [
      { columns: ['A'], to: tableName(a), toColumns: [columnOf(ida)], onDelete: 'cascade', onUpdate: 'cascade', ...at },
      { columns: ['B'], to: tableName(b), toColumns: [columnOf(idb)], onDelete: 'cascade', onUpdate: 'cascade', ...at },
    ],
  })
}
