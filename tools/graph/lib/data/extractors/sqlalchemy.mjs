// grimoire graph · data · extractor: SQLAlchemy declarative models (2.0's `Mapped[…] = mapped_column(…)`,
// 1.x's `Column(…)`, `Table(…)` on a metadata) and SQLModel's `table=True` classes, a code model (kind
// code: what `metadata.create_all` and Alembic's autogenerate read). Through the pinned Python grammar,
// nothing evaluated. Per unit: the folder holding the model files (their common folder), and the files
// stating the engine (an `alembic.ini`, a `create_engine("…")`); re-run when any changes.
//
// Found by content (bit 16384 of a Python file's level): a file importing `sqlalchemy`, `sqlmodel` or
// `flask_sqlalchemy` that names `__tablename__`, `table=True` or `Table(` (bit 32768: a `create_engine(`
// call, read for its URL's scheme alone).
//
// What is read:
//   - a mapped class: a class with `__tablename__` (a literal) whose bases reach a declarative base (a
//     `DeclarativeBase` subclass, `declarative_base()`, `db.Model`), or a `SQLModel` class with
//     `table=True` (its table the class name, lower case, unless `__tablename__` says); an
//     `__abstract__` class and a mixin give their columns to the classes inheriting them;
//     `__table_args__`: its `schema` (`schema.table`), `UniqueConstraint`, `Index`, `PrimaryKeyConstraint`,
//     `ForeignKeyConstraint`; a check counted;
//   - a column: `Column(…)` / `mapped_column(…)` (its name, a string first argument or `name=`, else
//     the attribute), a `Mapped[T]` annotation alone, SQLModel's `x: T = Field(…)` (or `sa_column=`):
//     its type as written (`String(120)`, `Numeric(10, 2)`, `DateTime(timezone=True)`, else the
//     annotation's Python type through SQLAlchemy's default map: `str` → `String`…; SQLAlchemy's types, not
//     the engine's, so not compared), nullable as SQLAlchemy decides (`nullable=` when stated; else not
//     null for a primary key; else `Mapped[Optional[T]]` / `T | None` nullable and `Mapped[T]` not, for
//     `mapped_column` and SQLModel; `Column` nullable), `primary_key` (several: one composite key),
//     `unique` a unique key, `index=True` an index named by SQLAlchemy's default convention (both
//     together: one unique index of that name, as SQLAlchemy creates it)
//     (`ix_<table>_<column>`; a project's own `naming_convention` noted, names then not compared),
//     `ForeignKey("t.c", ondelete=, onupdate=)` (or a class's attribute, `ForeignKey(User.id)`, SQLModel's
//     `foreign_key=`) a foreign key, `server_default` the database's default (a number, a boolean,
//     `func.now()` by its name, else only that there is one), `default` the client's (computed);
//   - `Table("name", metadata, Column(…), …)`: a table, read the same way (an association table);
//   - `relationship()` derives from the foreign keys: never a relation of its own.
// Dialect: the scheme of a literal URL (`sqlalchemy.url` in alembic.ini, `create_engine("postgresql+…://")`:
// nothing else of it is kept), all agreeing; else unknown.
import path from 'node:path'
import { named, field, lineOf } from '../readers/code.mjs'
import { common } from '../readers/orm.mjs'
import { value, callArgs, strOf, boolOf, strsOf, lastName, importsOf, qualify } from '../readers/python.mjs'
import { snake } from '../readers/inflect.mjs'

const P = path.posix
const PY = /\.py$/i
const INI = /(^|\/)alembic\.ini$/
const IMPORT = /^[ \t]*(?:from[ \t]+(?:sqlalchemy|sqlmodel|flask_sqlalchemy)\b|import[ \t]+(?:sqlalchemy|sqlmodel)\b)/m
const MAPPED = /\b__tablename__\b|\btable[ \t]*=[ \t]*True\b|\bTable[ \t]*\(|\bdb\.Model\b/
const ENGINE = /\bcreate_(?:async_)?engine[ \t]*\(/
const ENV_FILE = /^target_metadata[ \t]*=/m
export const sqlalchemyLevel = (p, text) => (!PY.test(p) ? 0 : (IMPORT.test(text) && MAPPED.test(text) ? 16384 : 0) | (ENGINE.test(text) ? 32768 : 0))
const SCHEMES = { postgresql: 'postgres', postgres: 'postgres', cockroachdb: 'postgres', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite' }
// SQLAlchemy's default Python type → type map (sqlalchemy.orm.decl_api: the registry's type_annotation_map)
const PYTYPES = { int: 'Integer', str: 'String', bool: 'Boolean', float: 'Float', bytes: 'LargeBinary', datetime: 'DateTime', 'datetime.datetime': 'DateTime', date: 'Date', 'datetime.date': 'Date', time: 'Time', 'datetime.time': 'Time', timedelta: 'Interval', Decimal: 'Numeric', 'decimal.Decimal': 'Numeric', UUID: 'Uuid', 'uuid.UUID': 'Uuid' }
const ACTIONS = { CASCADE: 'cascade', 'SET NULL': 'set null', RESTRICT: 'restrict', 'NO ACTION': 'no action', 'SET DEFAULT': 'set default' }
const MAX = { classes: 2000, columns: 1000, notes: 12 }

// a type expression as written, its literal strings dropped (an Enum's values): `String(120)`, `Numeric(10, 2)`
function typeText(n, depth = 0) {
  if (!n || depth > 4) return null
  if (n.type === 'identifier' || n.type === 'attribute') return lastName(n.text)
  if (n.type === 'call') {
    const fn = lastName(field(n, 'function')?.text)
    const a = callArgs(n)
    const parts = []
    for (const x of a.pos) { const v = value(x); if (v.k === 'int' || v.k === 'float') parts.push(v.v); else if (x.type === 'call' || x.type === 'identifier' || x.type === 'attribute') { const t = typeText(x, depth + 1); if (t) parts.push(t) } }
    for (const [k, x] of a.kw) { const v = value(x); if (v.k === 'int') parts.push(`${k}=${v.v}`); else if (v.k === 'true' || v.k === 'false') parts.push(`${k}=${v.k === 'true' ? 'True' : 'False'}`) }
    return `${fn}${parts.length ? `(${parts.join(', ')})` : ''}`.slice(0, 120)
  }
  return null
}
const TYPE_NAME = /^(?:[A-Z][A-Za-z0-9]*|ARRAY|JSONB|UUID|INET|CITEXT|TSVECTOR)$/
const isType = (n) => (n.type === 'call' ? TYPE_NAME.test(lastName(field(n, 'function')?.text)) && !/^(?:ForeignKey|Sequence|Identity|Computed|FetchedValue)$/.test(lastName(field(n, 'function')?.text)) : (n.type === 'identifier' || n.type === 'attribute') && TYPE_NAME.test(lastName(n.text)))
// an annotation: its Python type and whether it allows None (`Optional[T]`, `T | None`, `Union[T, None]`)
function annotation(text) {
  let t = String(text || '').replace(/\s+/g, '')
  const m = /^(?:\w+\.)?Mapped\[(.*)\]$/.exec(t)
  if (m) t = m[1]
  let nullable = false
  const o = /^(?:typing\.)?Optional\[(.*)\]$/.exec(t)
  if (o) { t = o[1]; nullable = true }
  if (/(?:^|\|)None(?:\||$)/.test(t)) { t = t.split('|').filter((x) => x !== 'None').join('|'); nullable = true }
  const u = /^(?:typing\.)?Union\[(.*),None\]$/.exec(t)
  if (u) { t = u[1]; nullable = true }
  return { py: t.replace(/^["']|["']$/g, ''), nullable, mapped: !!m }
}
function serverDefault(n) {
  const v = value(n)
  if (v.k === 'int' || v.k === 'float') return { default: v.v }
  if (v.k === 'true' || v.k === 'false') return { default: v.k }
  if (v.k === 'call' && /^(?:func|sa\.func|sqlalchemy\.func)\.\w+$/.test(v.fn) && !callArgs(v.node).pos.length) return { default: `${lastName(v.fn)}()` }
  return { default: v.k === 'str' ? "'…'" : '(expression)', unstated: true }
}
const clientDefault = (n) => { const v = value(n); return v.k === 'int' || v.k === 'float' ? v.v : v.k === 'true' ? 'True' : v.k === 'false' ? 'False' : v.k === 'none' ? 'None' : v.k === 'name' ? v.v : v.k === 'call' ? `${v.fn}(…)` : v.k === 'str' ? "'…'" : '…' }

// A column call (Column, mapped_column, Field, sa_column): what it states
function readColumn(call, attr, ann, imports, line) {
  const fn = lastName(field(call, 'function')?.text)
  const a = callArgs(call)
  const c = { attr, name: attr, line, type: null, nullable: null, pk: false, unique: false, index: false, fks: [], default: null, computed: null, unstated: [] }
  let pos = a.pos
  if (fn !== 'Field' && pos[0] && value(pos[0]).k === 'str') { c.name = strOf(pos[0]); pos = pos.slice(1) }
  if (a.kw.has('name') && strOf(a.kw.get('name'))) c.name = strOf(a.kw.get('name'))
  for (const x of pos) {
    if (x.type === 'call' && lastName(field(x, 'function')?.text) === 'ForeignKey') c.fks.push(fkOf(x))
    else if (isType(x)) c.type = typeText(x)
  }
  if (a.kw.has('type_')) c.type = typeText(a.kw.get('type_'))
  if (a.kw.has('sa_type')) c.type = typeText(a.kw.get('sa_type'))
  const b = (k) => (a.kw.has(k) ? boolOf(a.kw.get(k)) : null)
  if (b('primary_key')) c.pk = true
  if (b('unique')) c.unique = true
  if (b('index')) c.index = true
  if (b('nullable') !== null) c.nullable = b('nullable')
  if (fn === 'Field' && a.kw.has('foreign_key')) { const s = strOf(a.kw.get('foreign_key')); if (s) c.fks.push({ target: s, onDelete: a.kw.has('ondelete') ? strOf(a.kw.get('ondelete')) : null }) }
  if (a.kw.has('server_default')) { const d = serverDefault(a.kw.get('server_default')); c.default = d.default; if (d.unstated) c.unstated.push('default') }
  if (a.kw.has('default') && !(fn === 'Field' && value(a.kw.get('default')).k === 'none')) c.computed = `default=${clientDefault(a.kw.get('default'))}`
  if (a.kw.has('default_factory')) c.computed = `default_factory=${clientDefault(a.kw.get('default_factory'))}`
  if (fn === 'Field' && a.kw.has('sa_column') && field(a.kw.get('sa_column'), 'function')) return readColumn(a.kw.get('sa_column'), attr, ann, imports, line)
  // nullability as SQLAlchemy decides it
  const an = ann ? annotation(ann) : null
  if (!c.type && an) c.type = PYTYPES[an.py] || an.py.slice(0, 80) || null
  if (c.nullable === null) c.nullable = c.pk ? false : fn === 'Column' ? true : an ? an.nullable : true
  if (c.pk) c.nullable = false
  return c
}
function fkOf(call) {
  const a = callArgs(call)
  const t = a.pos[0]
  const v = value(t)
  return { target: v.k === 'str' ? v.v : null, attr: v.k === 'name' ? v.v : null, onDelete: a.kw.has('ondelete') ? strOf(a.kw.get('ondelete')) : null, onUpdate: a.kw.has('onupdate') ? strOf(a.kw.get('onupdate')) : null }
}
function readArgs(n, out) {
  const v = value(n)
  const items = v.k === 'list' ? v.nodes : v.k === 'dict' ? [n] : []
  for (const x of items) {
    if (x.type === 'dictionary') { const d = value(x); if (d.pairs.has('schema')) out.schema = strOf(d.pairs.get('schema')); continue }
    if (x.type !== 'call') continue
    readConstraint(x, out)
  }
}
function readConstraint(x, out) {
  const fn = lastName(field(x, 'function')?.text)
  const a = callArgs(x)
  const line = lineOf(x)
  const cols = a.pos.map((p) => strOf(p) ?? (p.type === 'identifier' || p.type === 'attribute' ? lastName(p.text) : null))
  const name = a.kw.has('name') ? strOf(a.kw.get('name')) : null
  if (fn === 'UniqueConstraint' && cols.length && cols.every(Boolean)) out.constraints.push({ kind: 'unique', columns: cols, name, line })
  else if (fn === 'PrimaryKeyConstraint' && cols.length && cols.every(Boolean)) out.constraints.push({ kind: 'primary', columns: cols, line })
  else if (fn === 'Index') { const [n0, ...rest] = cols; if (n0 && rest.length && rest.every(Boolean)) out.constraints.push({ kind: 'index', name: n0, columns: rest, unique: a.kw.has('unique') && boolOf(a.kw.get('unique')) === true, partial: [...a.kw.keys()].some((k) => /_where$/.test(k)), line }) }
  else if (fn === 'ForeignKeyConstraint') { const from = strsOf(a.pos[0]), to = strsOf(a.pos[1]); if (from && to) out.constraints.push({ kind: 'fk', columns: from, targets: to, onDelete: a.kw.has('ondelete') ? strOf(a.kw.get('ondelete')) : null, onUpdate: a.kw.has('onupdate') ? strOf(a.kw.get('onupdate')) : null, line }) }
  else if (fn === 'CheckConstraint') out.checks++
}

// ── one model file: its classes and Table() calls ──
function readFile(root, file) {
  const imports = importsOf(root)
  const classes = [], tables = [], errors = [], bases = []
  const conventions = /naming_convention/.test(root.text.slice(0, 1 << 20))
  for (const s0 of named(root)) {
    if (s0.type === 'ERROR' && errors.length < 4) errors.push(lineOf(s0))
    const s = s0.type === 'decorated_definition' ? field(s0, 'definition') : s0
    // Base = declarative_base() / db = SQLAlchemy() (its .Model); t = Table("name", metadata, …)
    if (s.type === 'expression_statement') {
      const a = named(s)[0]
      if (a?.type !== 'assignment') continue
      const right = field(a, 'right')
      if (right?.type !== 'call') continue
      const fn = lastName(field(right, 'function')?.text)
      if (fn === 'declarative_base' || fn === 'generate_base') bases.push(field(a, 'left').text)
      else if (fn === 'SQLAlchemy') bases.push(`${field(a, 'left').text}.Model`)
      else if (fn === 'Table') {
        const args = callArgs(right)
        const name = strOf(args.pos[0])
        if (!name) continue
        const t = { name, line: lineOf(s), columns: [], constraints: [], checks: 0, schema: args.kw.has('schema') ? strOf(args.kw.get('schema')) : null }
        for (const x of args.pos.slice(2)) {
          if (x.type !== 'call') continue
          const f = lastName(field(x, 'function')?.text)
          if (f === 'Column') { const c = readColumn(x, null, null, imports, lineOf(x)); if (c.name) t.columns.push(c) } else readConstraint(x, t)
        }
        tables.push(t)
      }
      continue
    }
    if (s.type !== 'class_definition' || classes.length >= MAX.classes) continue
    const sup = field(s, 'superclasses')
    const k = { name: field(s, 'name').text, line: lineOf(s), bases: [], table: null, tableCode: false, tableTrue: false, abstract: false, columns: [], constraints: [], checks: 0, schema: null, relationships: 0 }
    for (const b of sup ? named(sup) : []) {
      if (b.type === 'keyword_argument') { if (field(b, 'name')?.text === 'table' && boolOf(field(b, 'value')) === true) k.tableTrue = true; continue }
      k.bases.push(qualify(b.text.replace(/\s+/g, ''), imports))
    }
    // a SQLModel class: its annotated attributes are columns
    k.sqlmodel = k.tableTrue || k.bases.some((b) => /(?:^|\.)SQLModel$/.test(b)) || k.bases.some((b) => classes.find((x) => x.name === lastName(b))?.sqlmodel)
    for (const st of named(field(s, 'body') || s)) {
      if (st.type !== 'expression_statement') continue
      const a = named(st)[0]
      if (a?.type !== 'assignment' || field(a, 'left')?.type !== 'identifier') continue
      const attr = field(a, 'left').text, right = field(a, 'right'), ann = field(a, 'type')?.text || null
      if (attr === '__tablename__') { const v = strOf(right); if (v) k.table = v; else k.tableCode = true; continue }
      if (attr === '__abstract__') { k.abstract = boolOf(right) === true; continue }
      if (attr === '__table_args__') { readArgs(right, k); continue }
      if (attr.startsWith('__') || k.columns.length >= MAX.columns) continue
      const fn = right?.type === 'call' ? lastName(field(right, 'function')?.text) : null
      if (fn === 'relationship' || fn === 'Relationship' || fn === 'association_proxy' || (ann && /^(?:\w+\.)?Mapped\[\s*(?:list|List|set|Set)\b/.test(ann) && !fn)) { k.relationships++; continue }
      if (fn === 'Column' || fn === 'mapped_column' || fn === 'Field') { k.columns.push(readColumn(right, attr, ann, imports, lineOf(st))); continue }
      if (!right && ann && (/^(?:\w+\.)?Mapped\[/.test(ann) || k.sqlmodel)) {
        if (/^(?:\w+\.)?(?:ClassVar|WriteOnlyMapped|DynamicMapped)\b/.test(ann)) continue
        const an = annotation(ann)
        if (/^["']?[A-Z]\w*["']?$/.test(an.py) && !PYTYPES[an.py]) { k.relationships++; continue } // Mapped["User"]: a relationship
        k.columns.push({ attr, name: attr, line: lineOf(st), type: PYTYPES[an.py] || an.py.slice(0, 80), nullable: an.nullable, pk: false, unique: false, index: false, fks: [], default: null, computed: null, unstated: [] })
        continue
      }
      if (right && k.sqlmodel && ann && !fn) { const an = annotation(ann); k.columns.push({ attr, name: attr, line: lineOf(st), type: PYTYPES[an.py] || an.py.slice(0, 80), nullable: an.nullable, pk: false, unique: false, index: false, fks: [], default: null, computed: `default=${clientDefault(right)}`, unstated: [] }) }
    }
    classes.push(k)
  }
  return { classes, tables, bases, errors, conventions }
}

export default {
  id: 'sqlalchemy',
  version: 2,
  kind: 'code',
  scope: 'unit',
  tree: true,
  wants: (p) => PY.test(p) || INI.test(p),
  level: (p, text) => sqlalchemyLevel(p, text),
  parses: (p, text) => (sqlalchemyLevel(p, text) & 16384) !== 0,
  config: (p) => INI.test(p),
  discover(info) {
    const models = [...info].filter(([p, i]) => PY.test(p) && i.ddl & 16384 && !/(^|\/)(?:alembic|migrations)\/versions\//.test(p)).map(([p]) => p).sort()
    if (!models.length) return []
    const root = common(models)
    const engines = [...info].filter(([p, i]) => (INI.test(p) || (PY.test(p) && i.ddl & 32768)) && !models.includes(p)).map(([p]) => p)
    // an Alembic environment (alembic.mjs: bit 1048576) whose versions folder holds revisions
    const envs = [...info].filter(([p, i]) => PY.test(p) && i.ddl & 1048576).map(([p]) => p).filter((e) => [...info].some(([q, j]) => PY.test(q) && j.ddl & 524288 && P.dirname(q) === (P.dirname(e) === '.' ? 'versions' : `${P.dirname(e)}/versions`)))
    return [{ key: root, inputs: [...models, ...new Set([...engines, ...envs].sort())] }]
  },
  parse(text, file, ctx) {
    const tree = ctx.tree('python', text)
    try { return readFile(tree.rootNode, file) } finally { tree.delete?.() }
  },
  extract({ key: root, files }, ctx) {
    const sources = files.filter((f) => sqlalchemyLevel(f.path, f.text) & 16384)
    // the store: the one Alembic environment's versions folder, when its env.py autogenerates from a
    // metadata (target_metadata, not None): the models and the revisions are then two declarations of one store
    const envs = files.filter((f) => ENV_FILE.test(f.text) && /\bcontext\.configure[ \t]*\(/.test(f.text))
    const meta = envs.length === 1 ? /^target_metadata[ \t]*=[ \t]*(.{1,200})$/m.exec(envs[0].text) : null
    const alembic = meta && !/^None\b/.test(meta[1].trim()) ? (P.dirname(envs[0].path) === '.' ? 'versions' : `${P.dirname(envs[0].path)}/versions`) : null
    const notes = []
    const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
    // the engine: a literal URL's scheme, every one agreeing (nothing else of a URL is kept)
    const schemes = []
    for (const f of files) {
      const re = /\b([a-z][a-z0-9]{1,20})(?:\+[a-z0-9_]{1,30})?:\/\//g
      const text = INI.test(f.path) ? (/^sqlalchemy\.url[ \t]*=.*$/m.exec(f.text) || [''])[0] : f.text.split('\n').filter((l) => ENGINE.test(l) || /_URL\b|_URI\b|url[ \t]*=/i.test(l)).join('\n')
      let m
      while ((m = re.exec(text)) && schemes.length < 20) if (SCHEMES[m[1]]) schemes.push({ d: SCHEMES[m[1]], path: f.path, line: f.text.slice(0, f.text.indexOf(m[0])).split('\n').length })
    }
    const ds = new Set(schemes.map((s) => s.d))
    const dialect = ds.size === 1 ? schemes[0].d : null
    if (ds.size > 1) note(`the engine URLs name ${ds.size} engines: dialect unknown`)
    const parsed = sources.map((f) => ({ path: f.path, ...(ctx.aside ? ctx.aside('sqlalchemy', f.path, f.text) : this.parse(f.text, f.path, ctx)) }))
    const classes = new Map(), bases = new Set(['DeclarativeBase', 'DeclarativeBaseNoMeta', 'SQLModel', 'Model'])
    for (const f of parsed) {
      for (const l of f.errors) note(`${f.path}:${l}: does not parse here; what parsed is kept`)
      for (const b of f.bases) bases.add(b)
      if (f.conventions) note(`${f.path}: a naming_convention is set: index names are SQLAlchemy's defaults, not compared`)
      for (const c of f.classes) if (!classes.has(c.name)) classes.set(c.name, { ...c, path: f.path })
    }
    const isBase = (b) => bases.has(b) || bases.has(lastName(b)) || /(?:^|\.)(?:DeclarativeBase|DeclarativeBaseNoMeta|SQLModel)$/.test(b) || /\.Model$/.test(b) && bases.has(b)
    // a class's own columns and its mixins' and abstract bases' (theirs first)
    const columnsOf = (c, seen = new Set()) => {
      if (seen.has(c.name)) return []
      seen.add(c.name)
      const inherited = c.bases.map((b) => classes.get(lastName(b))).filter((p) => p && (p.abstract || !p.table) && !p.tableTrue).flatMap((p) => columnsOf(p, seen))
      return [...inherited, ...c.columns.map((x) => ({ ...x, path: c.path }))]
    }
    const mapped = (c, seen = new Set()) => { if (seen.has(c.name)) return false; seen.add(c.name); return c.bases.some((b) => isBase(b) || (classes.get(lastName(b)) && mapped(classes.get(lastName(b)), seen))) }
    // Flask-SQLAlchemy names a table nothing names from its class, when the class has a primary key
    const flask = (c) => c.bases.some((b) => /\.Model$/.test(b) && bases.has(b)) && columnsOf(c).some((x) => x.pk)
    const tableName = (c) => (c.table ? c.table : c.tableTrue ? c.name.toLowerCase() : flask(c) ? snake(c.name) : null)
    const qualified = (schema, name) => (schema && schema !== 'public' ? `${schema}.${name}` : name)
    const entities = []
    const byClass = new Map()
    const tables = []
    for (const c of classes.values()) {
      if (c.abstract || c.tableCode || !tableName(c) || !mapped(c)) { if (c.tableCode) note(`${c.path}:${c.line}: class ${c.name} names its table in code: not read`); continue }
      tables.push({ name: qualified(c.schema, tableName(c)), path: c.path, line: c.line, as: `class ${c.name}`, columns: columnsOf(c), constraints: c.constraints, checks: c.checks, cls: c })
    }
    for (const f of parsed) for (const t of f.tables) tables.push({ name: qualified(t.schema, t.name), path: f.path, line: t.line, columns: t.columns.map((x) => ({ ...x, path: f.path })), constraints: t.constraints, checks: t.checks })
    for (const t of tables) if (t.cls) byClass.set(t.cls.name, t)
    let relations = 0
    for (const t of tables) {
      const at = (line, p = t.path) => ({ path: p, line })
      const e = { name: t.name, kind: 'table', path: t.path, line: t.line, ...(t.as ? { as: t.as } : {}), fields: [], keys: [], indexes: [], relations: [] }
      const bare = t.name.split('.').pop()
      const colOfAttr = new Map(t.columns.map((c) => [c.attr ?? c.name, c.name]))
      const pk = []
      for (const c of t.columns) {
        e.fields.push({ name: c.name, ...(c.attr && c.attr !== c.name ? { attr: c.attr } : {}), type: c.type || 'unknown', nullable: c.nullable, default: c.default, generated: null, ...at(c.line, c.path), unstated: ['type', ...c.unstated], ...(c.computed ? { computed: c.computed } : {}) })
        if (c.pk) pk.push(c)
        // `unique=True, index=True` together are one unique index (SQLAlchemy creates `ix_<table>_<col>`
        // UNIQUE, no constraint beside it); `unique=True` alone a unique key
        if (c.unique && !c.index) e.keys.push({ role: 'unique', parts: [c.name], ...at(c.line, c.path) })
        if (c.index) e.indexes.push({ name: `ix_${bare}_${c.name}`, unique: !!c.unique, columns: [c.name], partial: false, ...at(c.line, c.path) })
        for (const fk of c.fks) {
          let to = null, toCol = null
          if (fk.target) { const i = fk.target.lastIndexOf('.'); if (i > 0) { to = fk.target.slice(0, i); toCol = fk.target.slice(i + 1) } }
          else if (fk.attr) { const [cls, attr] = fk.attr.split('.').slice(-2); const tt = byClass.get(cls); if (tt) { to = tt.name; toCol = tt.columns.find((x) => x.attr === attr)?.name || attr } }
          if (!to) { note(`${c.path}:${c.line}: a foreign key of ${t.name}.${c.name} whose target is built by code: not read`); continue }
          e.relations.push({ columns: [c.name], to, toColumns: [toCol], onDelete: ACTIONS[String(fk.onDelete || '').toUpperCase()] || 'no action', onUpdate: ACTIONS[String(fk.onUpdate || '').toUpperCase()] || 'no action', ...at(c.line, c.path) })
          relations++
        }
      }
      if (pk.length) e.keys.unshift({ role: 'primary', parts: pk.map((c) => c.name), ...at(pk[0].line, pk[0].path) })
      const col = (x) => colOfAttr.get(x) || x
      for (const k of t.constraints) {
        if (k.kind === 'unique') e.keys.push({ role: 'unique', parts: k.columns.map(col), ...at(k.line) })
        else if (k.kind === 'primary' && !pk.length) e.keys.unshift({ role: 'primary', parts: k.columns.map(col), ...at(k.line) })
        else if (k.kind === 'index') e.indexes.push({ name: k.name, unique: k.unique, columns: k.columns.map(col), partial: k.partial, ...at(k.line) })
        else if (k.kind === 'fk') {
          const targets = k.targets.map((s) => { const i = s.lastIndexOf('.'); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : null })
          if (targets.every(Boolean) && new Set(targets.map((x) => x[0])).size === 1) { e.relations.push({ columns: k.columns.map(col), to: targets[0][0], toColumns: targets.map((x) => x[1]), onDelete: ACTIONS[String(k.onDelete || '').toUpperCase()] || 'no action', onUpdate: ACTIONS[String(k.onUpdate || '').toUpperCase()] || 'no action', ...at(k.line) }); relations++ }
        }
      }
      if (t.checks) note(`${t.path}:${t.line}: ${t.checks} check constraint${t.checks === 1 ? '' : 's'} of ${t.name}: not modelled`)
      for (const f of e.fields) for (const x of e.fields) if (x !== f && x.name === f.name && f.line < x.line) note(`${t.path}: ${t.name}.${f.name} is declared twice`)
      entities.push(e)
    }
    // a column typed by nothing but its foreign key: the type of the column it references, as SQLAlchemy takes it
    const byName = new Map(entities.map((e) => [e.name, e]))
    for (const e of entities) for (const r of e.relations) {
      if (r.columns.length !== 1) continue
      const f = e.fields.find((x) => x.name === r.columns[0])
      const t = byName.get(r.to)?.fields.find((x) => x.name === r.toColumns[0])
      if (f && f.type === 'unknown' && t && t.type !== 'unknown') f.type = t.type
    }
    if (!entities.length) return { declarations: [] }
    // beside Alembic's revisions, the models are the whole store (autogenerate drops a table no model maps):
    // each table stated whole, so what the revisions add or lack is a conflict, unless read in part
    if (alembic) { notes.unshift(`the revisions of ${envs[0].path} (target_metadata): the models and those revisions are one store`); for (const e of entities) e.whole = true }
    const complete = !!alembic && !notes.some((n) => /does not parse|built by code/.test(n))
    const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
    const nRel = [...classes.values()].reduce((a, c) => a + c.relationships, 0)
    return { declarations: [{
      store: alembic || root, dialect, dialectFrom: dialect ? { how: 'stated', path: schemes[0].path, line: schemes[0].line } : null,
      source: { path: sources[0].path, line: 1, kind: 'code', confidence: 'declared' },
      complete, partial: false, status: 'read',
      label: `SQLAlchemy models, read ${counted(sources.length, 'file')}: ${counted(entities.length, 'table')}, ${counted(relations, 'foreign key')}${nRel ? ` (${counted(nRel, 'relationship')}, derived from them)` : ''}`,
      notes, files: sources.length, clients: ['sqlalchemy', 'sqlmodel', 'flask_sqlalchemy'],
      entities,
    }] }
  },
}

