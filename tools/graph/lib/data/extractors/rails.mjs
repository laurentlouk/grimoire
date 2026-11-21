// grimoire graph · data · extractor: a Rails application's schema, `db/schema.rb` (what `rails
// db:schema:dump` writes from the database: a declaration of kind artifact, as a SQL dump is), and its
// Active Record models' associations (`app/models`: kind code). Through the pinned Ruby grammar, nothing
// evaluated. Per unit: one schema file, the models under the same application, and its
// `config/database.yml`; re-run when any of them changes.
//
// Found by content: a `.rb` file defining `ActiveRecord::Schema…define` (bit 256 of its level), a
// `.rb` file defining a class with a superclass and naming Active Record (`ApplicationRecord`,
// `ActiveRecord::Base`), an association macro, `self.table_name` or `self.abstract_class`, or a module
// defining `self.table_name_prefix` (bit 512).
// The application is the folder holding the schema's folder (`db/schema.rb` → `.`); its models are the
// model files under its `app/models/`.
//
// The store: the schema file's folder (`db`), as a `db/structure.sql` beside it states it; a second
// database's schema (`db/animals_schema.rb`) is a store of its own (`db/animals_schema`). Dialect: the
// `adapter` every entry of `config/database.yml` states, when it is a literal and all agree
// (`postgresql`, `mysql2`, `trilogy`, `sqlite3`); else what only one engine's schema says
// (`enable_extension`, `create_enum`, a Postgres-only column type: Postgres; a table's `charset`, an
// `unsigned` column: MySQL), sniffed; else unknown.
//
// What the schema states, each at its line:
//   - `create_table "t", id:, primary_key:, …` → a table: its primary key column (`id`, bigint unless
//     `id:` says another type; `primary_key: "x"` names it; `id: false` none; `primary_key: [a, b]` a
//     composite key of declared columns), and each `t.<type> "name", null:, default:, limit:,
//     precision:, scale:, array:` a column, typed as Rails writes it (`string`, `string(80)`,
//     `decimal(10,2)`, `integer[]`: Rails' types, not the engine's, so kept as written and never
//     compared, `unstated`); `t.virtual … as:, stored:` a generated column; `t.references` /
//     `t.belongs_to` its column (`<name>_id`, `<name>_type` too when polymorphic), its index and, with
//     `foreign_key:`, its foreign key; `t.timestamps`; `t.index` and `add_index` (`name:`, or the name
//     Rails gives, `index_<table>_on_<a>_and_<b>`; `unique:`; `where:` partial, its text not kept; an
//     expression kept with its literals blanked); `t.unique_constraint` a unique key;
//   - `add_foreign_key "from", "to", column:, primary_key:, on_delete:, on_update:` → a foreign key
//     (the column `<singular of to>_id` and the key `id` unless stated);
//   - `create_enum "name", [values]` → an enum, and the columns `t.enum … enum_type:` give it;
//   - a default: a number, a boolean or null as written; a function with no argument
//     (`-> { "now()" }`) by its name; any other (a string, an expression) is never kept, only that
//     there is one (`'…'`, `(expression)`), not compared;
//   - `enable_extension`, `create_schema`, `execute`, checks and every other statement are skipped and
//     counted. A `comment:` is never read.
//
// What the models state (kind code, a declaration of the same store): each class whose table the
// schema declares (Rails' own rule: `self.table_name` when a literal, a single-table-inheritance
// subclass its base class's, else the class's last name underscored and pluralized, after a module's
// literal `table_name_prefix`; an abstract class none), cited at the class's line beside the table
// (`class Blog::Post`); and each association the schema states no foreign key for, as a relation
// **declared by the ORM** (`enforced: 'client'`, model.mjs: no foreign key in the database, the
// models alone hold it; never a foreign key): `belongs_to` (its `foreign_key:`, `class_name:`,
// `primary_key:`), `has_many` and `has_one` (the key on the other table: `foreign_key:`, else the
// inverse belongs_to's key under `inverse_of:` (Rails 7.1 and later, the Gemfile.lock's version), else
// `<model>_id`; their `dependent:` as the action the client takes on delete), `has_and_belongs_to_many` (its join table's two columns). A
// `through:` association derives from two others; a polymorphic one (`polymorphic: true`, `as:`)
// names its target per row: neither is a relation. An association whose table, target or column the
// schema lacks is noted at its line, never a guess.
import path from 'node:path'
import { named, field, lineOf } from '../readers/code.mjs'
import { value, args, nameOf, namesOf, bool } from '../readers/ruby.mjs'
import { pluralize, singularize, underscore, camelize, demodulize, tableize } from '../readers/inflect.mjs'
import { normDialect } from '../model.mjs'

const P = path.posix
const RB = /\.rb$/i
const DBYML = /(^|\/)config\/database\.yml$/
const GEMLOCK = /(^|\/)Gemfile\.lock$/ // the Rails version the application locks (what its associations infer)
const SCHEMA_DEF = /\bActiveRecord::Schema(?:\[[\d.]{1,12}\])?\.define\b/
const MODEL_CLASS = /^[ \t]*class[ \t]+[\w:]+[ \t]*<[ \t]*[\w:]+/m
const MODEL_HINT = /\b(?:ApplicationRecord|ActiveRecord::Base)\b|^[ \t]*(?:belongs_to|has_many|has_one|has_and_belongs_to_many)\b|\bself\.(?:table_name|abstract_class)\b/m
const PREFIX_DEF = /\bdef[ \t]+self\.table_name_prefix\b/ // a module naming its models' tables
export const railsLevel = (text) => (SCHEMA_DEF.test(text) ? 256 : 0) | ((MODEL_CLASS.test(text) && MODEL_HINT.test(text)) || PREFIX_DEF.test(text) ? 512 : 0)
const ASSOC = new Set(['belongs_to', 'has_many', 'has_one', 'has_and_belongs_to_many'])
const BASES = new Set(['ApplicationRecord', 'ActiveRecord::Base', '::ActiveRecord::Base'])
const ADAPTERS = { postgresql: 'postgres', postgis: 'postgres', mysql2: 'mysql', trilogy: 'mysql', mysql: 'mysql', sqlite3: 'sqlite', sqlite: 'sqlite' }
const PG_TYPES = new Set(['jsonb', 'uuid', 'hstore', 'citext', 'inet', 'cidr', 'macaddr', 'tsvector', 'ltree', 'int4range', 'int8range', 'numrange', 'tsrange', 'tstzrange', 'daterange', 'interval', 'money', 'bit', 'bit_varying', 'xml', 'oid', 'point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle', 'enum'])
const TABLE_CALLS = new Set(['index', 'check_constraint', 'exclusion_constraint', 'unique_constraint', 'references', 'belongs_to', 'timestamps', 'column', 'virtual', 'remove', 'foreign_key'])
const ACTIONS = { cascade: 'cascade', nullify: 'set null', restrict: 'restrict', no_action: 'no action' }
const DEPENDENT = { destroy: 'cascade', delete_all: 'cascade', delete: 'cascade', destroy_async: 'cascade', nullify: 'set null', restrict_with_exception: 'restrict', restrict_with_error: 'restrict' }
const MAX = { tables: 2000, columns: 1000, classes: 2000, assocs: 200, notes: 12 }
const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// a default as kept: a number, a boolean, null, a function of no argument; else only that there is one
function defaultOf(n) {
  const v = value(n)
  if (v.k === 'int' || v.k === 'float') return { default: v.v }
  if (v.k === 'true' || v.k === 'false') return { default: v.k }
  if (v.k === 'nil') return { default: null }
  if (v.k === 'lambda') {
    const body = named(field(v.node, 'body') || v.node).flatMap((b) => named(b))
    const s = body.length === 1 ? value(body[0]) : null
    if (s?.k === 'str' && /^[A-Za-z_][\w.]{0,63}\(\s*\)$|^(?:CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|LOCALTIMESTAMP)$/i.test(s.v.trim())) return { default: s.v.trim() }
    return { default: '(expression)', unstated: true }
  }
  return { default: v.k === 'str' || v.k === 'sym' ? "'…'" : '(expression)', unstated: true }
}
// an expression index column: its text, every quoted literal blanked
const blankLiterals = (s) => s.replace(/'(?:[^']|'')*'/g, "'…'").slice(0, 200)

// ── one schema file ──
function readSchema(root, file) {
  const out = { tables: [], fks: [], indexes: [], enums: [], skipped: {}, notes: [], markers: [], errors: [] }
  const skip = (k) => { out.skipped[k] = (out.skipped[k] || 0) + 1 }
  const mark = (dialect, marker, line) => { if (out.markers.length < 8) out.markers.push({ dialect, marker, line }) }
  const calls = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'ERROR' && out.errors.length < 4) out.errors.push(lineOf(n))
    if (n.type === 'call' && !field(n, 'receiver')) { calls.push(n); if (field(n, 'method')?.text === 'create_table') continue }
    for (let cs = n.namedChildren, i = cs.length - 1; i >= 0; i--) stack.push(cs[i])
  }
  for (const c of calls.sort((a, b) => a.startIndex - b.startIndex)) {
    const m = field(c, 'method')?.text
    const line = lineOf(c)
    const a = args(c)
    if (m === 'create_table') { if (out.tables.length < MAX.tables) out.tables.push(readTable(c, a, line, file, out, mark)); continue }
    if (m === 'add_index') {
      const t = nameOf(a.pos[0]), cols = namesOf(a.pos[1])
      if (t && cols) out.indexes.push({ table: t, ...indexOf(t, cols, a.opts, line, file) })
      else out.notes.push(`${file}:${line}: add_index not read (its table or columns are built by code)`)
      continue
    }
    if (m === 'add_foreign_key') {
      const from = nameOf(a.pos[0]), to = nameOf(a.pos[1])
      if (!from || !to) { out.notes.push(`${file}:${line}: add_foreign_key not read (a table built by code)`); continue }
      const cols = a.opts.has('column') ? namesOf(a.opts.get('column')) : [`${singularize(to.split('.').pop())}_id`]
      const pk = a.opts.has('primary_key') ? namesOf(a.opts.get('primary_key')) : ['id']
      if (!cols || !pk) { out.notes.push(`${file}:${line}: add_foreign_key's columns are built by code: not read`); continue }
      out.fks.push({ table: from, columns: cols, to, toColumns: pk, onDelete: action(a.opts.get('on_delete')), onUpdate: action(a.opts.get('on_update')), path: file, line })
      continue
    }
    if (m === 'create_enum') {
      const name = nameOf(a.pos[0]), vals = namesOf(a.pos[1])
      if (name && vals) out.enums.push({ name, values: vals, path: file, line })
      mark('postgres', 'create_enum', line)
      continue
    }
    if (m === 'enable_extension') { mark('postgres', 'enable_extension', line); skip('enable_extension'); continue }
    if (m === 'define') continue
    skip(m || 'call')
  }
  return out
}
const action = (n) => { const v = n ? nameOf(n) : null; return v ? ACTIONS[v] || v.replace(/_/g, ' ') : 'no action' }
function indexOf(table, cols, opts, line, file) {
  const expr = cols.length === 1 && /[()]/.test(cols[0])
  const columns = expr ? [blankLiterals(cols[0])] : cols
  const name = opts.has('name') ? nameOf(opts.get('name')) : null
  return { name: name || `index_${table}_on_${expr ? 'expression' : cols.join('_and_')}`, unique: bool(opts.get('unique')) === true, columns, partial: opts.has('where'), path: file, line }
}
function readTable(c, a, line, file, out, mark) {
  const name = nameOf(a.pos[0])
  const t = { name, line, fields: [], keys: [], indexes: [], fks: [], code: !name }
  if (!name) return t
  const o = a.opts
  if (o.has('charset')) mark('mysql', 'charset', line)
  if (o.has('options') && /ENGINE\s*=/i.test(value(o.get('options')).v || '')) mark('mysql', 'ENGINE=', line)
  // the primary key Rails creates
  const idOpt = o.has('id') ? value(o.get('id')) : null
  const pkOpt = o.has('primary_key') ? namesOf(o.get('primary_key')) : null
  const noId = idOpt?.k === 'false'
  const idType = idOpt && (idOpt.k === 'sym' || idOpt.k === 'str') ? (idOpt.v === 'primary_key' ? 'bigint' : idOpt.v === 'serial' ? 'integer' : idOpt.v === 'bigserial' ? 'bigint' : idOpt.v) : 'bigint'
  if (idType === 'uuid') mark('postgres', 'id: :uuid', line)
  let pkCol = null
  if (!noId && !(pkOpt && pkOpt.length > 1)) {
    pkCol = pkOpt ? pkOpt[0] : 'id'
    const d = o.has('default') ? defaultOf(o.get('default')) : { default: null }
    t.fields.push({ name: pkCol, type: idType, nullable: false, default: d.default, generated: null, path: file, line, unstated: ['type', ...(d.unstated ? ['default'] : [])] })
    t.keys.push({ role: 'primary', parts: [pkCol], path: file, line })
  } else if (pkOpt && pkOpt.length > 1) t.keys.push({ role: 'primary', parts: pkOpt, path: file, line })
  const block = field(c, 'block')
  const tVar = block && field(block, 'parameters') ? named(field(block, 'parameters'))[0]?.text : null
  const body = block ? field(block, 'body') : null
  for (const s of body ? named(body) : []) {
    if (s.type !== 'call' || !tVar || field(s, 'receiver')?.text !== tVar) continue
    const m = field(s, 'method')?.text, l = lineOf(s), sa = args(s)
    if (t.fields.length >= MAX.columns) break
    if (m === 'index') { const cols = namesOf(sa.pos[0]); if (cols) t.indexes.push(indexOf(name, cols, sa.opts, l, file)); continue }
    if (m === 'unique_constraint') { const cols = namesOf(sa.pos[0]); if (cols) t.keys.push({ role: 'unique', parts: cols, path: file, line: l }); continue }
    if (m === 'check_constraint' || m === 'exclusion_constraint') { out.skipped[m] = (out.skipped[m] || 0) + 1; continue }
    if (m === 'timestamps') { for (const n of ['created_at', 'updated_at']) t.fields.push(column(n, 'datetime', sa.opts, l, file, sa.opts.has('null') ? undefined : false)); continue }
    if (m === 'references' || m === 'belongs_to') {
      for (const ref of sa.pos.map(nameOf).filter(Boolean)) {
        const type = sa.opts.has('type') ? nameOf(sa.opts.get('type')) || 'bigint' : 'bigint'
        const poly = bool(sa.opts.get('polymorphic')) === true
        t.fields.push(column(`${ref}_id`, type, sa.opts, l, file))
        if (poly) t.fields.push(column(`${ref}_type`, 'string', sa.opts, l, file))
        const ix = sa.opts.has('index') ? value(sa.opts.get('index')) : { k: 'true' }
        if (ix.k !== 'false') {
          const opts = ix.k === 'hash' ? ix.pairs : new Map()
          t.indexes.push(indexOf(name, poly ? [`${ref}_type`, `${ref}_id`] : [`${ref}_id`], opts, l, file))
        }
        const fk = sa.opts.has('foreign_key') ? value(sa.opts.get('foreign_key')) : null
        if (fk && fk.k !== 'false' && fk.k !== 'nil' && !poly) {
          const fo = fk.k === 'hash' ? fk.pairs : new Map()
          const to = fo.has('to_table') ? nameOf(fo.get('to_table')) : pluralize(ref)
          if (to) t.fks.push({ table: name, columns: [`${ref}_id`], to, toColumns: fo.has('primary_key') ? namesOf(fo.get('primary_key')) || ['id'] : ['id'], onDelete: action(fo.get('on_delete')), onUpdate: action(fo.get('on_update')), path: file, line: l })
        }
      }
      continue
    }
    let type = m, colName = nameOf(sa.pos[0])
    if (m === 'column') type = nameOf(sa.pos[1]) || 'unknown'
    if (m === 'virtual') type = sa.opts.has('type') ? nameOf(sa.opts.get('type')) || 'virtual' : 'virtual'
    if (TABLE_CALLS.has(m) && m !== 'column' && m !== 'virtual') continue
    if (!colName) { out.notes.push(`${file}:${l}: a column of ${name} whose name is built by code: not read`); t.part = true; continue }
    if (PG_TYPES.has(type)) mark('postgres', `t.${type}`, l)
    if (bool(sa.opts.get('unsigned')) === true || /^unsigned_/.test(type)) mark('mysql', 'unsigned', l)
    const f = column(colName, type, sa.opts, l, file)
    if (m === 'virtual') f.generated = bool(sa.opts.get('stored')) === true ? 'stored' : 'virtual'
    if (type === 'enum' && sa.opts.has('enum_type')) { f.enumType = nameOf(sa.opts.get('enum_type')); if (f.enumType) f.type = f.type.replace(/^enum/, f.enumType) }
    if (colName === pkCol) { const i = t.fields.findIndex((x) => x.name === pkCol); t.fields[i] = { ...f, nullable: false }; continue }
    t.fields.push(f)
  }
  return t
}
function column(name, type, o, line, file, nullDefault) {
  let ty = type
  const num = (k) => { const v = o.has(k) ? value(o.get(k)) : null; return v?.k === 'int' ? v.v : null }
  const limit = num('limit'), precision = num('precision'), scale = num('scale')
  if (precision !== null) ty += `(${precision}${scale !== null ? `,${scale}` : ''})`
  else if (limit !== null) ty += `(${limit})`
  if (bool(o.get('array')) === true) ty += '[]'
  const nul = o.has('null') ? bool(o.get('null')) : null
  const d = o.has('default') ? defaultOf(o.get('default')) : { default: null }
  return { name, type: ty, nullable: nul === false ? false : nullDefault === false ? false : true, default: d.default, generated: null, path: file, line, unstated: ['type', ...(d.unstated ? ['default'] : [])] }
}

// ── one model file: its classes, their table settings and associations; a module's table_name_prefix ──
function readModels(root, file) {
  const classes = [], prefixes = {}, errors = []
  const visit = (n, scope, inClass) => {
    for (const c of named(n)) {
      if (c.type === 'ERROR' && errors.length < 4) errors.push(lineOf(c))
      if (c.type === 'module' || c.type === 'class') {
        const own = field(c, 'name')?.text
        if (!own) continue
        const full = own.startsWith('::') ? own.slice(2) : [...scope, own].join('::')
        const body = field(c, 'body')
        if (c.type === 'module') {
          for (const s of body ? named(body) : []) {
            if (s.type === 'singleton_method' && field(s, 'name')?.text === 'table_name_prefix') { const b = named(field(s, 'body') || s); const v = b.length === 1 ? value(b[0]) : null; if (v?.k === 'str') prefixes[full] = v.v }
          }
          if (body) visit(body, full.split('::'), null)
          continue
        }
        const sup = field(c, 'superclass') ? named(field(c, 'superclass'))[0]?.text || null : null
        const k = { name: full, line: lineOf(c), superclass: sup, scope: [...scope], abstract: false, tableName: null, tableCode: null, primaryKey: null, nestedIn: inClass, assocs: [] }
        if (classes.length < MAX.classes) classes.push(k)
        for (const s of body ? named(body) : []) {
          if (s.type === 'assignment') {
            const left = field(s, 'left')
            if (left?.type === 'call' && field(left, 'receiver')?.type === 'self') {
              const what = field(left, 'method')?.text, v = value(field(s, 'right'))
              if (what === 'abstract_class') k.abstract = v.k === 'true'
              if (what === 'table_name') { if (v.k === 'str' || v.k === 'sym') k.tableName = v.v; else k.tableCode = lineOf(s) }
              if (what === 'primary_key' && (v.k === 'str' || v.k === 'sym')) k.primaryKey = v.v
            }
            continue
          }
          if (s.type === 'call' && !field(s, 'receiver') && ASSOC.has(field(s, 'method')?.text) && k.assocs.length < MAX.assocs) {
            const a = args(s)
            const name = nameOf(a.pos[0])
            const opt = (key) => (a.opts.has(key) ? nameOf(a.opts.get(key)) : null)
            k.assocs.push({ macro: field(s, 'method').text, name, line: lineOf(s), class_name: opt('class_name'), foreign_key: a.opts.has('foreign_key') ? namesOf(a.opts.get('foreign_key')) : null, primary_key: opt('primary_key'), through: opt('through'), as: opt('as'), polymorphic: bool(a.opts.get('polymorphic')) === true, join_table: opt('join_table'), association_foreign_key: opt('association_foreign_key'), dependent: opt('dependent'), inverse_of: opt('inverse_of'), code: !name || a.splat })
          }
        }
        if (body) visit(body, full.split('::'), full)
      }
    }
  }
  visit(root, [], null)
  return { classes, prefixes, errors }
}

export default {
  id: 'rails',
  version: 2,
  kind: 'code', // (it reads source: a schema written in Ruby, the models; each declaration names its own kind)
  scope: 'unit',
  tree: true,
  wants: (p) => RB.test(p) || DBYML.test(p) || GEMLOCK.test(p),
  level: (p, text) => (RB.test(p) ? railsLevel(text) : 0),
  parses: (p, text) => RB.test(p) && railsLevel(text) > 0,
  config: (p) => DBYML.test(p) || GEMLOCK.test(p),
  discover(info) {
    const rb = [...info].filter(([p, i]) => RB.test(p) && i.ddl & 768)
    const schemas = rb.filter(([, i]) => i.ddl & 256).map(([p]) => p)
    const models = rb.filter(([, i]) => i.ddl & 512).map(([p]) => p)
    return schemas.map((s) => {
      const app = P.dirname(P.dirname(s))
      const under = (rel) => (app === '.' ? rel : `${app}/${rel}`)
      const mine = models.filter((m) => m.startsWith(under('app/models/')))
      const yml = info.has(under('config/database.yml')) ? [under('config/database.yml')] : []
      const lock = info.has(under('Gemfile.lock')) ? [under('Gemfile.lock')] : []
      return { key: s, inputs: [s, ...mine.sort(), ...yml, ...lock] }
    })
  },
  // one file through the grammar (what readers/code-aside.mjs runs for a base): a schema's statements, a
  // model file's classes
  parse(text, file, ctx) {
    const tree = ctx.tree('ruby', text)
    try {
      const lv = railsLevel(text)
      return { ...(lv & 256 ? { schema: readSchema(tree.rootNode, file) } : {}), ...(lv & 512 ? { models: readModels(tree.rootNode, file) } : {}) }
    } finally { tree.delete?.() }
  },
  extract({ key, files }, ctx) {
    const yml = files.find((f) => DBYML.test(f.path)) || null
    const lock = files.find((f) => GEMLOCK.test(f.path)) || null
    const rbs = files.filter((f) => RB.test(f.path))
    const read = (f) => (ctx.aside ? ctx.aside('rails', f.path, f.text) : this.parse(f.text, f.path, ctx))
    const schemaFile = rbs.find((f) => f.path === key)
    if (!schemaFile) return { declarations: [] }
    const S = read(schemaFile).schema
    if (!S) return { declarations: [] }
    const store = P.basename(key) === 'schema.rb' ? P.dirname(key) : key.replace(RB, '')
    const notes = []
    const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
    // the dialect
    let dialect = null, dialectFrom = null
    const stated = yml ? adapters(yml.text) : null
    if (stated?.dialect) { dialect = stated.dialect; dialectFrom = { how: 'stated', path: yml.path, line: stated.line } }
    else {
      const ds = new Set(S.markers.map((m) => m.dialect))
      if (ds.size === 1) { const m = S.markers[0]; dialect = m.dialect; dialectFrom = { how: 'sniffed', marker: m.marker, path: key, line: m.line } }
      if (stated?.why) note(`${yml.path}: ${stated.why}`)
    }
    // the tables, their foreign keys and indexes
    const tables = new Map()
    const fks = [...S.fks]
    for (const t of S.tables) {
      if (!t.name) { note(`${key}:${t.line}: a table whose name is built by code: not read`); continue }
      const e = { name: t.name, kind: 'table', path: key, line: t.line, fields: t.fields, keys: t.keys, indexes: t.indexes, relations: [], ...(t.part ? { part: true } : {}) }
      tables.set(t.name, e)
      fks.push(...t.fks)
    }
    for (const ix of S.indexes) { const e = tables.get(ix.table); if (e) e.indexes.push(ix); else note(`${key}:${ix.line}: add_index on ${ix.table}, a table the schema does not create`) }
    for (const fk of fks) {
      const e = tables.get(fk.table)
      if (!e) { note(`${key}:${fk.line}: add_foreign_key from ${fk.table}, a table the schema does not create`); continue }
      const { table, ...rel } = fk
      e.relations.push(rel)
    }
    const enums = S.enums
    for (const e of tables.values()) for (const f of e.fields) {
      if (f.enumType) { const en = enums.find((x) => x.name === f.enumType); if (en) f.enum = { name: en.name, values: en.values }; delete f.enumType }
    }
    const skipped = Object.entries(S.skipped)
    if (skipped.length) note(`skipped in ${key}: ${skipped.reduce((a, [, n]) => a + n, 0)} statements that do not shape the store (${skipped.map(([k, n]) => `${k} ${n}`).join(', ')})`)
    for (const l of S.errors) note(`${key}:${l}: does not parse here; what parsed is kept`)
    const decls = [{
      store, dialect, dialectFrom,
      source: { path: key, line: 1, kind: 'artifact', confidence: 'declared' },
      complete: !S.errors.length, partial: false, status: 'read',
      label: `schema.rb, ${counted(tables.size, 'table')}`,
      notes: [...notes, ...S.notes].slice(0, MAX.notes), files: 1,
      ...(enums.length ? { enums } : {}),
      entities: [...tables.values()],
    }]
    const modelFiles = rbs.filter((f) => f !== schemaFile)
    if (modelFiles.length) {
      const m = models(modelFiles.map((f) => ({ path: f.path, facts: read(f).models })).filter((x) => x.facts), tables, key, railsVersion(lock?.text))
      if (m) decls.push({ store, dialect, dialectFrom, source: { path: modelFiles[0].path, line: 1, kind: 'code', confidence: 'declared' }, complete: false, partial: false, status: 'read', label: m.label, notes: m.notes, files: modelFiles.length, entities: m.entities })
    }
    return { declarations: decls }
  },
}

// The adapter config/database.yml states, read as text (it is ERB-templated YAML: nothing is run): every
// `adapter:` entry, a literal, all naming one engine. → { dialect, line } | { why } | null
function adapters(text) {
  const found = []
  const re = /^[ \t]*adapter[ \t]*:[ \t]*(.{0,200})$/gm
  let m
  while ((m = re.exec(text)) && found.length < 50) found.push({ v: m[1].trim().replace(/^["']|["']$/g, ''), line: text.slice(0, m.index).split('\n').length })
  if (!found.length) return null
  if (found.some((f) => !/^\w+$/.test(f.v))) return { why: 'an adapter is not a literal: dialect unknown' }
  const ds = new Set(found.map((f) => ADAPTERS[f.v.toLowerCase()] || normDialect(f.v)))
  if (ds.size > 1) return { why: `its adapters name ${ds.size} engines: dialect unknown` }
  return { dialect: [...ds][0], line: found[0].line }
}

// The Rails version a Gemfile.lock locks (`    rails (7.1.3)`): [major, minor], or null (no lock read).
function railsVersion(text) {
  const m = text ? /^ {4}rails \((\d+)\.(\d+)/m.exec(text) : null
  return m ? [Number(m[1]), Number(m[2])] : null
}

// The models of an application against its schema: one entity per table a class of them maps to (at
// that class's line), and the associations no foreign key states, as relations declared by the ORM.
// A has_many or has_one with `inverse_of:` and no `foreign_key:` takes its key from the inverse
// belongs_to (its `foreign_key:`, else `<name>_id`), as Active Record infers it since 7.1 (a Gemfile.lock
// locking an older Rails keeps the owner's `<model>_id`); an inverse that is polymorphic makes the
// association polymorphic (`<name>_id` and `<name>_type`, its target named per row: no relation).
function models(list, tables, schemaPath, version = null) {
  const notes = []
  const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
  const classes = new Map(), prefixes = {}
  for (const { path: file, facts } of list) {
    for (const c of facts.classes) if (!classes.has(c.name)) classes.set(c.name, { ...c, path: file })
    Object.assign(prefixes, facts.prefixes)
    for (const l of facts.errors) note(`${file}:${l}: does not parse here; what parsed is kept`)
  }
  // a constant named in a class's scope, as Ruby looks it up: innermost namespace first
  const resolve = (name, scope) => {
    if (!name) return null
    if (name.startsWith('::')) return classes.get(name.slice(2)) || null
    for (let i = scope.length; i >= 0; i--) { const q = [...scope.slice(0, i), name].join('::'); if (classes.has(q)) return classes.get(q) }
    return null
  }
  // whether a class is an Active Record model (its chain reaches Active Record), and its table
  const isModel = (c, seen = new Set()) => {
    if (!c || seen.has(c.name)) return false
    seen.add(c.name)
    if (BASES.has(c.superclass)) return true
    const s = resolve(c.superclass, c.scope)
    return s ? isModel(s, seen) : false
  }
  const tableOf = (c, seen = new Set()) => {
    if (!c || c.abstract || seen.has(c.name)) return null
    seen.add(c.name)
    if (c.tableName) return { name: c.tableName, how: 'self.table_name' }
    if (c.tableCode) return { code: c.tableCode }
    const s = resolve(c.superclass, c.scope)
    if (s && !s.abstract && isModel(s)) { const t = tableOf(s, seen); return t && { ...t, sti: s.name } } // single-table inheritance
    // a class nested in a model: that model's table, singular, as a prefix
    const outer = c.nestedIn ? classes.get(c.nestedIn) : null
    const inModel = outer && !outer.abstract && isModel(outer) ? tableOf(outer, new Set(seen)) : null
    let prefix = ''
    const parents = c.name.split('::').slice(0, -1)
    for (let i = parents.length; i > 0; i--) { const q = parents.slice(0, i).join('::'); if (prefixes[q] !== undefined) { prefix = prefixes[q]; break } }
    return { name: `${prefix}${inModel?.name ? `${singularize(inModel.name)}_` : ''}${tableize(c.name)}`, how: 'convention' }
  }
  // a class's belongs_to of that name, its own or a base class's
  const assocOf = (c, name, seen = new Set()) => {
    if (!c || seen.has(c.name)) return null
    seen.add(c.name)
    return c.assocs.find((x) => x.macro === 'belongs_to' && x.name === name) || assocOf(resolve(c.superclass, c.scope), name, seen)
  }
  const pkOf = (c, table) => c?.primaryKey || (tables.get(table)?.keys.find((k) => k.role === 'primary' && k.parts.length === 1)?.parts[0]) || 'id'
  const entities = new Map()
  const placed = new Map() // class name → its table
  for (const c of classes.values()) {
    if (c.abstract || !isModel(c)) continue
    const t = tableOf(c)
    if (!t) continue
    if (t.code) { note(`${c.path}:${t.code}: class ${c.name} names its table in code: not mapped`); continue }
    if (!tables.has(t.name)) { note(`${c.path}:${c.line}: class ${c.name}'s table ${t.name} (${t.how}) is not in ${schemaPath}`); continue }
    placed.set(c.name, t.name)
    if (!entities.has(t.name)) entities.set(t.name, { name: t.name, kind: 'table', path: c.path, line: c.line, as: `class ${c.name}`, part: true, fields: [], keys: [], indexes: [], relations: [] })
    else { const e = entities.get(t.name); if (e.as.length < 200) e.as += `, ${c.name}` }
  }
  const has = (table, col) => tables.get(table)?.fields.some((f) => f.name === col)
  const fkOn = (table, cols) => tables.get(table)?.relations.some((r) => r.columns.join('\0') === cols.join('\0'))
  const counts = { relations: 0, stated: 0, skipped: 0 }
  const add = (from, rel, cite) => {
    const e = entities.get(from) || (() => { const x = { name: from, kind: 'table', path: cite.path, line: cite.line, part: true, fields: [], keys: [], indexes: [], relations: [] }; entities.set(from, x); return x })()
    const k = `${rel.columns.join(',')}->${rel.to}(${rel.toColumns.join(',')})`
    const have = e.relations.find((r) => `${r.columns.join(',')}->${r.to}(${r.toColumns.join(',')})` === k)
    if (have) { if (!have.via) have.via = cite; if (have.onDelete === 'no action' && rel.onDelete !== 'no action') have.onDelete = rel.onDelete; return }
    e.relations.push({ ...rel, onUpdate: 'no action', enforced: 'client', ...cite })
    counts.relations++
  }
  for (const c of classes.values()) {
    const own = placed.get(c.name)
    if (!own) continue
    for (const a of c.assocs) {
      const cite = { path: c.path, line: a.line }
      const where = `${c.path}:${a.line}: ${a.macro} :${a.name}`
      if (a.code) { note(`${where}: built by code, not read`); counts.skipped++; continue }
      if (a.through) { counts.skipped++; continue } // derived from two associations: no relation of its own
      if (a.polymorphic || a.as) { note(`${where}: polymorphic, its target named per row: no relation`); counts.skipped++; continue }
      const targetName = a.class_name || camelize(a.macro === 'belongs_to' ? a.name : singularize(a.name))
      const target = resolve(targetName, c.name.split('::')) // as Active Record looks it up: in the model's namespace, innermost first
      const toTable = target ? placed.get(target.name) : null
      if (!toTable) { note(`${where}: its class ${targetName} is no model mapped to a table of ${schemaPath}`); counts.skipped++; continue }
      let ownerFk = `${underscore(demodulize(c.name))}_id`
      // the inverse belongs_to names the key (Rails 7.1 and later)
      const inverse = (a.macro === 'has_many' || a.macro === 'has_one') && a.inverse_of && !a.foreign_key && !(version && (version[0] < 7 || version[0] === 7 && version[1] < 1)) ? assocOf(target, a.inverse_of) : null
      if (inverse?.polymorphic) { note(`${where}: polymorphic (its inverse ${target.name}.${inverse.name} is), its target named per row: no relation`); counts.skipped++; continue }
      if (inverse && !inverse.code) ownerFk = inverse.foreign_key?.[0] || `${inverse.name}_id`
      if (a.macro === 'belongs_to') {
        const cols = a.foreign_key || [`${a.name}_id`]
        if (!cols.every((x) => has(own, x))) { note(`${where}: ${own} has no column ${cols.join(', ')}`); counts.skipped++; continue }
        if (fkOn(own, cols)) { counts.stated++; continue }
        add(own, { columns: cols, to: toTable, toColumns: [a.primary_key || pkOf(target, toTable)], onDelete: 'no action' }, cite)
      } else if (a.macro === 'has_many' || a.macro === 'has_one') {
        const cols = a.foreign_key || [ownerFk]
        if (!cols.every((x) => has(toTable, x))) { note(`${where}: ${toTable} has no column ${cols.join(', ')}`); counts.skipped++; continue }
        if (fkOn(toTable, cols)) { counts.stated++; continue }
        add(toTable, { columns: cols, to: own, toColumns: [a.primary_key || pkOf(c, own)], onDelete: DEPENDENT[a.dependent] || 'no action' }, cite)
      } else {
        // has_and_belongs_to_many: a join table of the two tables' names in lexical order, a common prefix once
        const join = a.join_table || joinTable(own, toTable)
        if (!tables.has(join)) { note(`${where}: its join table ${join} is not in ${schemaPath}`); counts.skipped++; continue }
        const mineCol = a.foreign_key?.[0] || ownerFk, theirCol = a.association_foreign_key || `${underscore(demodulize(target.name))}_id`
        for (const [col, to, owner] of [[mineCol, own, c], [theirCol, toTable, target]]) {
          if (!has(join, col)) { note(`${where}: ${join} has no column ${col}`); continue }
          if (fkOn(join, [col])) { counts.stated++; continue }
          add(join, { columns: [col], to, toColumns: [pkOf(owner, to)], onDelete: 'no action' }, cite)
        }
      }
    }
  }
  if (!entities.size) return null
  const nClasses = placed.size
  return {
    entities: [...entities.values()],
    notes,
    label: `Active Record models, read ${counted(list.length, 'file')}: ${counted(nClasses, 'class', 'classes')} mapped, ${counted(counts.relations, 'association')} no foreign key states${counts.stated ? ` (${counts.stated} a foreign key states)` : ''}`,
  }
}
// Active Record's join table for two tables: lexical order, a common prefix written once
function joinTable(a, b) {
  const [x, y] = [a, b].sort()
  const m = /^(.*_)(.+)\0\1(.+)$/.exec(`${x}\0${y}`)
  return m ? `${m[1]}${m[2]}_${m[3]}` : `${x}_${y}`
}
