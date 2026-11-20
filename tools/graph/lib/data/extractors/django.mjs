// grimoire graph · data · extractor: Django models (`models.py`, or a `models/` package), a code model
// (kind code: what `makemigrations` turns into migrations). Through the pinned Python grammar, nothing
// evaluated. Per unit: a Django project (the folder of its `manage.py`, else the folder holding every
// model file), its model files, its settings and its apps' `apps.py`; re-run when any of them changes.
//
// Why the models and not the migrations: the models state the model as it is now, file by file, while
// the migrations state it as a history to replay, ordered by a dependency graph across apps, through
// operations some of which run code (`RunPython`, `RunSQL`, `SeparateDatabaseAndState`, squashed
// `replaces`): reading them right needs that whole interpreter, and a step it cannot follow loses every
// later one. What the models leave implicit is stated by Django's own documented rules (the auto `id`,
// the table and column names, the join table of a many-to-many), else marked not compared or in part.
//
// Found by content (bit 4096 of a Python file's level): a file importing `django.db` and defining a class;
// a settings module (bit 8192: `DATABASES`, `DEFAULT_AUTO_FIELD` or `AUTH_USER_MODEL` assigned).
//
// What is read, per model (a class whose bases reach `models.Model` through the project's classes):
//   - its table: `Meta.db_table`, else `<app label>_<class name, lower case>`; the app label is
//     `Meta.app_label`, else the label its `apps.py` states (`label = …`), else the app's folder name;
//     an abstract model has none (its fields go to each model inheriting it, its Meta too unless the
//     model states its own), a proxy model its parent's; a model inheriting a concrete one is a table of
//     its own, keyed by `<parent>_ptr_id`, a foreign key to the parent;
//   - its fields, `name = models.<Type>Field(…)`: the column (`db_column`, else the name, `<name>_id` for
//     a relation), its type as Django creates it for the engine (`CharField(max_length=80)` →
//     `varchar(80)`, `DateTimeField` → `timestamp with time zone` on Postgres, `datetime(6)` on MySQL…;
//     unknown engine or field class: the class as written, not compared), `null=True` nullable, else not
//     null; `primary_key=True` the key, else the implicit `id` (the app's `default_auto_field`, else
//     `DEFAULT_AUTO_FIELD`, else `AutoField`, as Django picks it); `unique=True` a unique key;
//     `db_index=True` and every foreign key an index, named as Django names it (`<table>_<column>_<hash>`);
//     `default=` is the client's (computed, never the database's: `default='…'`, no literal string kept),
//     `db_default=` the database's (a number, a boolean, else only that there is one); `auto_now` and
//     `auto_now_add` computed;
//   - `ForeignKey` and `OneToOneField` (a unique key too): a foreign key to the target's table and key
//     (`to_field`), the target named as Django resolves it (`'self'`, `'Model'` in the same app,
//     `'app.Model'`, a class, `settings.AUTH_USER_MODEL` from the settings, else `auth.User`), the
//     database's action `no action` (`on_delete` is emulated by Django, not set in the database);
//     `db_constraint=False` a relation declared by the ORM (`enforced: 'client'`);
//   - `ManyToManyField` with no `through`: its join table, `<table>_<field>`, its `id`, the two columns
//     `<model>_id` (`from_…`/`to_…` for a model to itself), their foreign keys and their unique key;
//   - `Meta.unique_together`, `Meta.constraints` (`UniqueConstraint`, a `condition` a partial unique
//     index), `Meta.indexes` (`models.Index`), `Meta.index_together`; checks counted, not modelled.
// A base class the project does not define and that is not Django's leaves the model in part (its fields
// unknown); every string option (`verbose_name`, `help_text`, `choices`) is never read.
import path from 'node:path'
import { createHash } from 'node:crypto'
import { named, field, lineOf } from '../readers/code.mjs'
import { common } from '../readers/orm.mjs'
import { value, callArgs, strOf, boolOf, intOf, strsOf, lastName, importsOf, qualify } from '../readers/python.mjs'

const P = path.posix
const PY = /\.py$/i
const MANAGE = /(^|\/)manage\.py$/
const APPS = /(^|\/)apps\.py$/
const DJANGO_DB = /^[ \t]*(?:from[ \t]+django\.db(?:\.models)?[ \t]+import|import[ \t]+django\.db)\b/m
const CLASS = /^[ \t]*class[ \t]+\w+[ \t]*\(/m
const SETTINGS = /^(?:DATABASES|DEFAULT_AUTO_FIELD|AUTH_USER_MODEL)[ \t]*=/m
export const djangoLevel = (p, text) => (!PY.test(p) ? 0 : (DJANGO_DB.test(text) && CLASS.test(text) ? 4096 : 0) | (SETTINGS.test(text) ? 8192 : 0))
const ENGINES = { postgresql: 'postgres', postgresql_psycopg2: 'postgres', postgis: 'postgres', mysql: 'mysql', sqlite3: 'sqlite', spatialite: 'sqlite' }
const MAX = { models: 2000, fields: 1000, notes: 12 }
const RELATIONS = new Set(['ForeignKey', 'OneToOneField', 'ManyToManyField', 'ParentalKey'])

// the column types Django creates per engine (its backends' data_types), by field class
const T = (pg, my, lite) => ({ postgres: pg, mysql: my, sqlite: lite })
const TYPES = {
  AutoField: T('integer', 'integer', 'integer'), BigAutoField: T('bigint', 'bigint', 'integer'), SmallAutoField: T('smallint', 'smallint', 'integer'),
  BinaryField: T('bytea', 'longblob', 'BLOB'), BooleanField: T('boolean', 'bool', 'bool'), NullBooleanField: T('boolean', 'bool', 'bool'),
  CharField: T('varchar(%L)', 'varchar(%L)', 'varchar(%L)'), DateField: T('date', 'date', 'date'), DateTimeField: T('timestamp with time zone', 'datetime(6)', 'datetime'),
  DecimalField: T('numeric(%D, %P)', 'numeric(%D, %P)', 'decimal'), DurationField: T('interval', 'bigint', 'bigint'), FloatField: T('double precision', 'double precision', 'real'),
  IntegerField: T('integer', 'integer', 'integer'), BigIntegerField: T('bigint', 'bigint', 'bigint'), SmallIntegerField: T('smallint', 'smallint', 'smallint'),
  PositiveIntegerField: T('integer', 'integer UNSIGNED', 'integer unsigned'), PositiveSmallIntegerField: T('smallint', 'smallint UNSIGNED', 'smallint unsigned'), PositiveBigIntegerField: T('bigint', 'bigint UNSIGNED', 'bigint unsigned'),
  GenericIPAddressField: T('inet', 'char(39)', 'char(39)'), IPAddressField: T('inet', 'char(15)', 'char(15)'), JSONField: T('jsonb', 'json', 'text'),
  TextField: T('text', 'longtext', 'text'), TimeField: T('time', 'time(6)', 'time'), UUIDField: T('uuid', 'char(32)', 'char(32)'),
}
// fields that are a CharField or a FileField underneath, with their default max_length
const CHARS = { CharField: null, EmailField: 254, SlugField: 50, URLField: 200, FileField: 100, ImageField: 100, FilePathField: 100 }
const MAX_NAME = { postgres: 63, mysql: 64, sqlite: 200 }

// ── one model file: its classes and what each states ──
function readFile(root, file) {
  const imports = importsOf(root)
  const classes = [], errors = []
  for (const s of named(root)) {
    if (s.type === 'ERROR' && errors.length < 4) errors.push(lineOf(s))
    const c = s.type === 'decorated_definition' ? field(s, 'definition') : s
    if (c?.type !== 'class_definition') continue
    if (classes.length >= MAX.models) break
    const bases = field(c, 'superclasses') ? named(field(c, 'superclasses')).filter((b) => b.type !== 'keyword_argument' && b.type !== 'comment').map((b) => qualify(b.text.replace(/\s+/g, ''), imports)) : []
    const k = { name: field(c, 'name').text, line: lineOf(c), bases, fields: [], meta: null, file }
    for (const st of named(field(c, 'body') || c)) {
      const inner = st.type === 'decorated_definition' ? field(st, 'definition') : st
      if (inner?.type === 'class_definition' && field(inner, 'name')?.text === 'Meta') { k.meta = readMeta(inner, imports); continue }
      if (st.type !== 'expression_statement') continue
      const a = named(st)[0]
      if (a?.type !== 'assignment' || field(a, 'left')?.type !== 'identifier') continue
      const right = field(a, 'right')
      if (right?.type !== 'call' || k.fields.length >= MAX.fields) continue
      const fn = qualify(field(right, 'function')?.text.replace(/\s+/g, '') || '', imports)
      const cls = lastName(fn)
      if (!/Field$|^ForeignKey$|^ParentalKey$/.test(cls)) continue
      const args = callArgs(right)
      const f = { name: field(a, 'left').text, cls, django: /^django\./.test(fn), line: lineOf(st), opts: {} }
      const kw = args.kw
      for (const o of ['null', 'primary_key', 'unique', 'db_index', 'auto_now', 'auto_now_add', 'db_constraint']) if (kw.has(o)) f.opts[o] = boolOf(kw.get(o))
      for (const o of ['max_length', 'max_digits', 'decimal_places']) if (kw.has(o)) f.opts[o] = intOf(kw.get(o))
      for (const o of ['db_column', 'db_table', 'to_field', 'related_name']) if (kw.has(o)) f.opts[o] = strOf(kw.get(o))
      if (kw.has('default')) f.opts.default = shown(kw.get('default'))
      if (kw.has('db_default')) f.opts.db_default = dbDefault(kw.get('db_default'))
      if (RELATIONS.has(cls)) {
        const to = args.pos[0] || kw.get('to')
        const v = value(to)
        f.to = v.k === 'str' ? { s: v.v } : v.k === 'name' ? (/AUTH_USER_MODEL$/.test(v.v) ? { user: true } : { cls: v.v }) : null
        if (kw.has('through')) f.through = true
      }
      if (cls === 'CharField' && args.pos.length && f.opts.max_length === undefined) f.opts.max_length = null
      k.fields.push(f)
    }
    classes.push(k)
  }
  return { classes, errors }
}
// a value as kept: a number, a boolean, None as written, a name or a call by its name; a string never
function shown(n) {
  const v = value(n)
  if (v.k === 'int' || v.k === 'float') return v.v
  if (v.k === 'true') return 'True'
  if (v.k === 'false') return 'False'
  if (v.k === 'none') return 'None'
  if (v.k === 'name') return v.v
  if (v.k === 'call') return `${v.fn}(…)`
  return v.k === 'str' ? "'…'" : '…'
}
function dbDefault(n) {
  const v = value(n)
  if (v.k === 'int' || v.k === 'float') return { default: v.v }
  if (v.k === 'true' || v.k === 'false') return { default: v.k }
  return { default: v.k === 'str' ? "'…'" : '(expression)', unstated: true }
}
function readMeta(c, imports) {
  const m = { line: lineOf(c), bases: field(c, 'superclasses') ? named(field(c, 'superclasses')).map((b) => b.text) : [], indexes: [], uniques: [], checks: 0 }
  for (const st of named(field(c, 'body') || c)) {
    if (st.type !== 'expression_statement') continue
    const a = named(st)[0]
    if (a?.type !== 'assignment') continue
    const key = field(a, 'left')?.text, right = field(a, 'right'), line = lineOf(st)
    if (key === 'abstract' || key === 'proxy' || key === 'managed') m[key] = boolOf(right)
    else if (key === 'db_table' || key === 'app_label') m[key] = strOf(right)
    else if (key === 'unique_together' || key === 'index_together') {
      const v = value(right)
      const groups = v.k === 'list' && v.items.length && v.items.every((x) => x.k === 'str') ? [v.items.map((x) => x.v)] : v.k === 'list' ? v.nodes.map(strsOf).filter(Boolean) : []
      for (const g of groups) (key === 'unique_together' ? m.uniques : m.indexes).push({ fields: g, line, together: true })
    } else if (key === 'constraints' || key === 'indexes') {
      const v = value(right)
      for (const n of v.k === 'list' ? v.nodes : []) {
        if (n.type !== 'call') continue
        const cls = lastName(qualify(field(n, 'function')?.text || '', imports))
        const args = callArgs(n)
        const fields = args.kw.has('fields') ? strsOf(args.kw.get('fields')) : null
        const name = args.kw.has('name') ? strOf(args.kw.get('name')) : null
        if (cls === 'UniqueConstraint' && fields) m.uniques.push({ fields, name, partial: args.kw.has('condition'), line: lineOf(n) })
        else if (cls === 'Index' && fields) m.indexes.push({ fields, name, partial: args.kw.has('condition'), line: lineOf(n) })
        else m.checks++
      }
    }
  }
  return m
}

// Django's names for what it creates (django/db/backends/base/schema.py, models/indexes.py)
const digest = (args, n) => { const h = createHash('md5'); for (const a of args) h.update(a); return h.digest('hex').slice(0, n) }
function indexName(table, columns, suffix, max) {
  const hash = `${digest([table, ...columns], 8)}${suffix}`
  let name = `${table}_${columns.join('_')}_${hash}`
  if (name.length <= max) return name
  const other = Math.floor((max - hash.length) / 2) - 1
  name = `${table.slice(0, other)}_${columns.join('_').slice(0, other)}_${hash}`
  return name[0] === '_' || /\d/.test(name[0]) ? `D${name.slice(0, -1)}` : name
}
// an unnamed models.Index (Index.set_name_with_model)
function metaIndexName(table, fields, columns) {
  const ordered = fields.map((f, i) => (f.startsWith('-') ? `${columns[i]} DESC` : columns[i]))
  const name = `${table.slice(0, 11)}_${columns[0].slice(0, 7)}_${digest([table, ...ordered, 'idx'], 6)}_idx`
  return name[0] === '_' || /\d/.test(name[0]) ? `D${name.slice(1)}` : name
}

export default {
  id: 'django',
  version: 1,
  kind: 'code',
  scope: 'unit',
  tree: true,
  wants: (p) => PY.test(p),
  level: (p, text) => djangoLevel(p, text),
  parses: (p, text) => (djangoLevel(p, text) & 4096) !== 0,
  config: (p) => MANAGE.test(p) || APPS.test(p),
  discover(info) {
    const models = [...info].filter(([p, i]) => PY.test(p) && i.ddl & 4096 && !APPS.test(p) && !/(^|\/)migrations\//.test(p)).map(([p]) => p)
    if (!models.length) return []
    const manages = [...info.keys()].filter((p) => MANAGE.test(p)).map((p) => P.dirname(p))
    const under = (d, p) => d === '.' || p.startsWith(`${d}/`)
    const units = new Map()
    for (const m of models) {
      const root = manages.filter((d) => under(d, m)).sort((a, b) => b.length - a.length)[0] ?? null
      const key = root ?? '\0'
      if (!units.has(key)) units.set(key, [])
      units.get(key).push(m)
    }
    return [...units].map(([key, list]) => {
      const root = key === '\0' ? common(list) : key
      // its apps' apps.py; its settings (under manage.py's folder, else anywhere in the repository)
      const extra = [...info].filter(([p, i]) => (APPS.test(p) && under(root, p)) || (PY.test(p) && i.ddl & 8192 && !list.includes(p) && (key === '\0' || under(root, p)))).map(([p]) => p)
      return { key: root, inputs: [...list.sort(), ...extra.sort()] }
    })
  },
  parse(text, file, ctx) {
    const tree = ctx.tree('python', text)
    try { return readFile(tree.rootNode, file) } finally { tree.delete?.() }
  },
  extract({ key: root, files }, ctx) {
    const settings = files.filter((f) => (djangoLevel(f.path, f.text) & 8192) && !APPS.test(f.path))
    const apps = files.filter((f) => APPS.test(f.path))
    const sources = files.filter((f) => (djangoLevel(f.path, f.text) & 4096) && !APPS.test(f.path))
    const notes = []
    const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
    const S = readSettings(settings)
    for (const w of S.why) note(w)
    const dialect = S.dialect?.dialect ?? null
    const maxName = MAX_NAME[dialect] ?? 200
    // every class of every model file, its app label from its folder (a `models/` package: the folder above)
    const all = []
    for (const f of sources) {
      const r = ctx.aside ? ctx.aside('django', f.path, f.text) : this.parse(f.text, f.path, ctx)
      for (const l of r.errors) note(`${f.path}:${l}: does not parse here; what parsed is kept`)
      const dir = P.dirname(f.path)
      const appDir = P.basename(dir) === 'models' ? P.dirname(dir) : dir
      for (const c of r.classes) all.push({ ...c, appDir })
    }
    const labels = new Map(apps.map((f) => [P.dirname(f.path), appConfig(f.text)]))
    const appLabel = (c) => c.meta?.app_label || labels.get(c.appDir)?.label || P.basename(c.appDir === '.' ? root : c.appDir)
    const byName = new Map()
    for (const c of all) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c) }
    // a base or a target named by a class: the project's class of that name (its own app's first)
    const classOf = (name, from) => { const list = byName.get(lastName(name)) || []; return list.find((x) => x.appDir === from.appDir) || (list.length === 1 ? list[0] : null) }
    const isDjangoModel = (b) => /^django\.db\.models(?:\.base)?\.Model$/.test(b) || b === 'models.Model'
    // whether a class is a model: its bases reach models.Model through the project's classes
    const memo = new Map()
    const modelInfo = (c, seen = new Set()) => {
      if (memo.has(c)) return memo.get(c)
      if (seen.has(c)) return null
      seen.add(c)
      let model = false, unknown = []
      const parents = []
      for (const b of c.bases) {
        if (isDjangoModel(b)) { model = true; continue }
        // one of Django's own abstract models (AbstractUser, PermissionsMixin…): a model, its fields not read
        if (/^django\./.test(b)) { if (/(?:Model|User|Mixin)$/.test(lastName(b))) { model = true; unknown.push(lastName(b)) } continue }
        const p = classOf(b, c)
        const pi = p && modelInfo(p, seen)
        if (pi?.model) { model = true; parents.push(p); if (pi.unknown.length) unknown.push(...pi.unknown) } else if (!p) unknown.push(b)
      }
      const out = { model, unknown, parents }
      memo.set(c, out)
      return out
    }
    const tableOf = (c) => {
      if (c.meta?.abstract) return null
      if (c.meta?.proxy) { const p = modelInfo(c).parents[0]; return p ? tableOf(p) : null }
      return c.meta?.db_table || `${appLabel(c)}_${c.name.toLowerCase()}`
    }
    const autoField = (c) => labels.get(c.appDir)?.auto || S.auto || 'AutoField'
    const typeOf = (cls, opts) => {
      let base = cls, len = opts.max_length
      if (cls in CHARS) { base = 'CharField'; if (len === undefined) len = CHARS[cls] }
      const t = TYPES[base]?.[dialect]
      if (!t) return { type: cls === 'CharField' || cls in CHARS ? `${cls}(${len ?? ''})`.replace('()', '') : cls, unstated: ['type'] }
      if (t.includes('%L') && (len === null || len === undefined)) return { type: dialect === 'postgres' ? 'varchar' : t.replace('(%L)', ''), ...(dialect === 'postgres' ? {} : { unstated: ['type'] }) }
      return { type: t.replace('%L', len).replace('%D', opts.max_digits ?? '').replace('%P', opts.decimal_places ?? '') }
    }
    // the fields a model has: its abstract parents' first, then its own (multi-table parents are tables of their own)
    const fieldsOf = (c, seen = new Set()) => {
      if (seen.has(c)) return []
      seen.add(c)
      const inherited = modelInfo(c).parents.filter((p) => p.meta?.abstract).flatMap((p) => fieldsOf(p, seen))
      return [...inherited, ...c.fields.map((f) => ({ ...f, from: c }))]
    }
    const metaOf = (c) => {
      if (c.meta && !c.meta.bases.length) return c.meta
      const parent = modelInfo(c).parents.find((p) => p.meta?.abstract)
      const pm = parent ? metaOf(parent) : null
      if (!c.meta) return pm ? { ...pm, abstract: false, db_table: null, line: pm.line } : null
      return { ...c.meta, indexes: [...(pm?.indexes || []), ...c.meta.indexes], uniques: [...(pm?.uniques || []), ...c.meta.uniques] }
    }
    const models = all.filter((c) => modelInfo(c).model)
    const pkOf = (c, seen = new Set()) => {
      if (seen.has(c)) return null
      seen.add(c)
      const own = fieldsOf(c).find((f) => f.opts.primary_key)
      if (own) return { column: own.opts.db_column || own.name, cls: own.cls }
      const concrete = modelInfo(c).parents.find((p) => !p.meta?.abstract && !c.meta?.proxy)
      if (concrete) return { column: `${concrete.name.toLowerCase()}_ptr_id`, cls: 'OneToOneField', parent: concrete }
      return { column: 'id', cls: autoField(c) }
    }
    const pkType = (c) => { const pk = pkOf(c); if (!pk) return { type: 'integer' }; if (pk.parent) return pkType(pk.parent); const own = fieldsOf(c).find((f) => f.opts.primary_key); return typeOf(pk.cls === 'BigAutoField' ? 'BigIntegerField' : pk.cls === 'AutoField' ? 'IntegerField' : pk.cls === 'SmallAutoField' ? 'SmallIntegerField' : pk.cls, own?.opts || {}) }
    const target = (f, c) => {
      if (!f.to) return null
      if (f.to.user) return S.user ? byLabel(S.user, c) : { table: 'auth_user', column: 'id', type: { type: dialect === 'sqlite' || !dialect ? 'integer' : 'integer' }, external: true }
      if (f.to.s === 'self') return { model: c }
      if (f.to.s) return byLabel(f.to.s, c)
      const m = classOf(f.to.cls, c)
      return m ? { model: m } : null
    }
    const byLabel = (s, c) => {
      const [app, name] = s.includes('.') ? s.split('.') : [null, s]
      const list = (byName.get(name) || []).filter((x) => modelInfo(x).model)
      const m = app ? list.find((x) => appLabel(x).toLowerCase() === app.toLowerCase()) : list.find((x) => x.appDir === c.appDir) || (list.length === 1 ? list[0] : null)
      if (m) return { model: m }
      if (app === 'auth' && name === 'User') return { table: 'auth_user', column: 'id', type: { type: 'integer' }, external: true }
      return null
    }
    const colOf = (m, name) => { const f = fieldsOf(m).find((x) => x.name === name); return f ? f.opts.db_column || (RELATIONS.has(f.cls) ? `${f.name}_id` : f.name) : name }
    const entities = []
    let relations = 0
    for (const c of models) {
      const table = tableOf(c)
      if (!table) continue
      if (c.meta?.proxy) continue // a proxy model is its parent's table
      const info = modelInfo(c)
      const at = (line, file = c.file) => ({ path: file, line })
      const e = { name: table, kind: 'table', path: c.file, line: c.line, as: `class ${c.name}`, fields: [], keys: [], indexes: [], relations: [] }
      if (info.unknown.length) { e.part = true; note(`${c.file}:${c.line}: class ${c.name} inherits ${info.unknown.slice(0, 3).join(', ')}, which the project does not define (or Django's, not read): its fields are stated in part`) }
      if (c.meta?.managed === false) note(`${c.file}:${c.line}: class ${c.name} is not managed by Django (Meta.managed = False): its table is declared, not created by migrations`)
      const pk = pkOf(c)
      const cols = new Map() // field name → column
      if (!fieldsOf(c).some((f) => f.opts.primary_key)) {
        if (pk.parent) {
          const pt = tableOf(pk.parent), ppk = pkOf(pk.parent)
          e.fields.push({ name: pk.column, ...pkType(pk.parent), nullable: false, default: null, generated: null, ...at(c.line) })
          e.relations.push({ columns: [pk.column], to: pt, toColumns: [ppk.column], onDelete: 'no action', onUpdate: 'no action', ...at(c.line) })
        } else e.fields.push({ name: 'id', ...typeOf(pk.cls, {}), nullable: false, default: null, generated: null, ...at(c.line) })
        e.keys.push({ role: 'primary', parts: [pk.column], ...at(c.line) })
      }
      for (const f of fieldsOf(c)) {
        const where = at(f.line, f.from.file)
        if (f.cls === 'ManyToManyField') continue
        const rel = RELATIONS.has(f.cls)
        const column = f.opts.db_column || (rel ? `${f.name}_id` : f.name)
        cols.set(f.name, column)
        let type
        let t = null
        if (rel) {
          t = target(f, c)
          if (!t) { note(`${f.from.file}:${f.line}: ${c.name}.${f.name}'s target is not a model of the project: its foreign key is not stated`); type = { type: f.cls, unstated: ['type'] } }
          else type = t.model ? (f.opts.to_field ? { type: 'unknown', unstated: ['type'] } : pkType(t.model)) : t.type
        } else type = typeOf(f.cls, f.opts)
        if (!f.django && !rel) type = { type: f.cls, unstated: ['type'] }
        const field_ = { name: column, ...type, nullable: f.opts.null === true, default: null, generated: null, ...where }
        if (f.opts.db_default) { field_.default = f.opts.db_default.default; if (f.opts.db_default.unstated) field_.unstated = [...(field_.unstated || []), 'default'] }
        const computed = [f.opts.default !== undefined ? `default=${f.opts.default}` : null, f.opts.auto_now ? 'auto_now' : null, f.opts.auto_now_add ? 'auto_now_add' : null].filter(Boolean)
        if (computed.length) field_.computed = computed.join(' · ')
        if (f.opts.primary_key) { field_.nullable = false; e.keys.push({ role: 'primary', parts: [column], ...where }) }
        e.fields.push(field_)
        if (f.opts.unique || f.cls === 'OneToOneField' && !f.opts.primary_key) e.keys.push({ role: 'unique', parts: [column], ...where })
        if (rel && t) {
          const toTable = t.model ? tableOf(t.model) : t.table
          const toCol = f.opts.to_field ? (t.model ? colOf(t.model, f.opts.to_field) : f.opts.to_field) : t.model ? pkOf(t.model).column : t.column
          if (toTable) { e.relations.push({ columns: [column], to: toTable, toColumns: [toCol], onDelete: 'no action', onUpdate: 'no action', ...(f.opts.db_constraint === false ? { enforced: 'client' } : {}), ...where }); relations++ }
        }
        if ((f.opts.db_index || (rel && f.opts.db_index !== false)) && !f.opts.unique && !f.opts.primary_key && f.cls !== 'OneToOneField') e.indexes.push({ name: indexName(table, [column], '', maxName), unique: false, columns: [column], partial: false, ...where })
      }
      const meta = metaOf(c)
      const colFor = (name) => cols.get(name.replace(/^-/, '')) || colOf(c, name.replace(/^-/, ''))
      for (const u of meta?.uniques || []) {
        const columns = u.fields.map(colFor)
        if (u.partial) e.indexes.push({ name: u.name || indexName(table, columns, '_uniq', maxName), unique: true, columns, partial: true, ...at(u.line) })
        else e.keys.push({ role: 'unique', parts: columns, ...at(u.line) })
      }
      for (const i of meta?.indexes || []) {
        const columns = i.fields.map(colFor)
        e.indexes.push({ name: i.name ? i.name.replace(/%\(app_label\)s/g, appLabel(c)).replace(/%\(class\)s/g, c.name.toLowerCase()) : i.together ? indexName(table, columns, '_idx', maxName) : metaIndexName(table, i.fields, columns), unique: false, columns, partial: !!i.partial, ...at(i.line) })
      }
      if (meta?.checks) note(`${c.file}:${meta.line}: ${meta.checks} constraint${meta.checks === 1 ? '' : 's'} of ${c.name} not modelled (checks, exclusions)`)
      entities.push(e)
      // a many-to-many field's join table
      for (const f of fieldsOf(c).filter((x) => x.cls === 'ManyToManyField')) {
        if (f.through) continue
        const t = target(f, c)
        if (!t?.model && !t?.table) { note(`${f.from.file}:${f.line}: ${c.name}.${f.name}'s target is not a model of the project: its join table is not stated`); continue }
        const other = t.model ? tableOf(t.model) : t.table
        const self = t.model === c
        const name = f.opts.db_table || `${table}_${f.name}`.slice(0, maxName)
        const a = self ? `from_${c.name.toLowerCase()}_id` : `${c.name.toLowerCase()}_id`
        const b = self ? `to_${c.name.toLowerCase()}_id` : `${(t.model ? t.model.name : 'user').toLowerCase()}_id`
        const where = at(f.line, f.from.file)
        entities.push({
          name, kind: 'table', ...where, as: `${c.name}.${f.name} (many-to-many)`,
          fields: [{ name: 'id', ...typeOf(autoField(c), {}), nullable: false, default: null, generated: null, ...where }, { name: a, ...pkType(c), nullable: false, default: null, generated: null, ...where }, { name: b, ...(t.model ? pkType(t.model) : t.type), nullable: false, default: null, generated: null, ...where }],
          keys: [{ role: 'primary', parts: ['id'], ...where }, { role: 'unique', parts: [a, b], ...where }],
          indexes: [{ name: indexName(name, [a], '', maxName), unique: false, columns: [a], partial: false, ...where }, { name: indexName(name, [b], '', maxName), unique: false, columns: [b], partial: false, ...where }],
          relations: [{ columns: [a], to: table, toColumns: [pkOf(c).column], onDelete: 'no action', onUpdate: 'no action', ...where }, { columns: [b], to: other, toColumns: [t.model ? pkOf(t.model).column : t.column], onDelete: 'no action', onUpdate: 'no action', ...where }],
        })
        relations += 2
      }
    }
    if (!entities.length) return { declarations: [] }
    const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
    return { declarations: [{
      store: root, dialect, dialectFrom: S.dialect ? { how: 'stated', path: S.dialect.path, line: S.dialect.line } : null,
      source: { path: sources[0].path, line: 1, kind: 'code', confidence: 'declared' },
      complete: false, partial: false, status: 'read',
      label: `Django models, read ${counted(sources.length, 'file')}: ${counted(models.filter((c) => tableOf(c) && !c.meta?.proxy).length, 'model')}, ${counted(relations, 'relation')}`,
      notes, files: sources.length, clients: ['django.db'],
      entities,
    }] }
  },
}

// what an apps.py states: its AppConfig's label and default_auto_field, as text
function appConfig(text) {
  const label = /^[ \t]+label[ \t]*=[ \t]*['"](\w{1,100})['"]/m.exec(text)
  const auto = /^[ \t]+default_auto_field[ \t]*=[ \t]*['"][\w.]{0,100}?(\w+)['"]/m.exec(text)
  return { label: label ? label[1] : null, auto: auto ? auto[1] : null }
}
// what the settings state, as text: the database engine every DATABASES entry names (all one), the
// default auto field, the user model. Nothing else of them is kept (a password, a host).
function readSettings(files) {
  const why = [], engines = []
  let auto = null, user = null
  for (const f of files) {
    const re = /['"]ENGINE['"][ \t]*:[ \t]*(?:['"]([\w.]{1,100})['"]|(.{0,1}))/g
    let m
    while ((m = re.exec(f.text)) && engines.length < 20) engines.push({ v: m[1] ?? null, path: f.path, line: f.text.slice(0, m.index).split('\n').length })
    const a = /^DEFAULT_AUTO_FIELD[ \t]*=[ \t]*['"][\w.]{0,100}?(\w+)['"]/m.exec(f.text)
    if (a) auto = a[1]
    const u = /^AUTH_USER_MODEL[ \t]*=[ \t]*['"](\w{1,100}\.\w{1,100})['"]/m.exec(f.text)
    if (u) user = u[1]
  }
  let dialect = null
  if (engines.length) {
    const ds = engines.map((e) => (e.v ? ENGINES[e.v.split('.').pop()] || null : null))
    if (ds.some((d) => !d)) why.push(`a database ENGINE in ${engines[ds.findIndex((d) => !d)].path} is not a literal Django backend: dialect unknown`)
    else if (new Set(ds).size > 1) why.push(`the settings name ${new Set(ds).size} database engines: dialect unknown`)
    else dialect = { dialect: ds[0], path: engines[0].path, line: engines[0].line }
  }
  return { dialect, auto, user, why }
}
