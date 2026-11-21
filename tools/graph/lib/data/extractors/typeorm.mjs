// grimoire graph · data · extractor: TypeORM entities (`@Entity()` classes and their column and relation
// decorators), a code model (kind code: what `migration:generate` turns into migrations). Through the
// pinned TypeScript grammar, nothing evaluated. Per unit: the entity files of a repository and its data
// source files; re-run when any changes.
//
// Found by content (bit 65536 of a source file's level): a TypeScript or JavaScript file importing from
// `typeorm` that decorates a class with `@Entity(` or `@ViewEntity(` (or holds a column decorator: an
// abstract base class of entities). A data source (`new DataSource({ … })`, bit 2048, code-migrations.mjs)
// is read for where its migrations go.
//
// The store: the folder the data source's `migrations` glob names (a literal: `src/migration/*.ts`), so
// the entities and the SQL migrations TypeORM generated from them (code-migrations.mjs) are two
// declarations of one store, and where they disagree the entities were edited and no migration generated
// (a conflict, both sides kept; spec D2). Else the entities' own folder.
//
// What is read, by TypeORM's own naming rules (its DefaultNamingStrategy):
//   - `@Entity("name")` / `@Entity({ name, schema })`, else the class name in snake_case: the table; the
//     class cited at its line beside it (`class User`); a class it `extends` gives its columns first;
//     `@ViewEntity` a view;
//   - `@Column(type?, { type, name, length, precision, scale, nullable, unique, default, array })`: the
//     column (`name`, else the property), its type as written (`varchar(200)`, else the property's
//     TypeScript type: TypeORM's terms, not the engine's, so not compared), not null unless `nullable`;
//     `@PrimaryGeneratedColumn(strategy?)`, `@PrimaryColumn` the primary key; `@CreateDateColumn`,
//     `@UpdateDateColumn` (their default the database's, not compared), `@DeleteDateColumn` (nullable),
//     `@VersionColumn`; a `default` kept when a number, a boolean or null, else only that there is one;
//   - `@ManyToOne(() => T, …, { onDelete, onUpdate, nullable })` and an owning `@OneToOne` (with
//     `@JoinColumn`): the join column (`@JoinColumn({ name, referencedColumnName })`, else
//     `<property><ReferencedColumn>`: `authorId`), typed as the key it references, and its foreign key
//     (`createForeignKeyConstraints: false`: a relation declared by the ORM, `enforced: 'client'`); a
//     one-to-one's column a unique key; `@OneToMany` and an inverse side: no column;
//   - `@ManyToMany(() => T)` with `@JoinTable({ name, joinColumn, inverseJoinColumn })`: its junction table
//     (`<table>_<property>_<target table>`, columns `<table>Id`, `<target>Id`), its key, indexes and
//     foreign keys (cascading, as TypeORM creates them);
//   - `@Index(name?, columns?, { unique })` on a property or the class, `@Unique(name?, columns)`: named
//     as TypeORM names what it creates (`IDX_` / `UQ_` and a hash of the table and columns), so they
//     compare with the migrations.
// An embedded column (`@Column(() => T)`) and table inheritance (`@TableInheritance`, `@ChildEntity`) are
// noted and leave their table stated in part.
import path from 'node:path'
import { createHash } from 'node:crypto'
import { named, field, lineOf } from '../readers/code.mjs'
import { value, str, bool, strs, argsOf, classRef } from '../readers/ts-value.mjs'
import { common, counted, globDir } from '../readers/orm.mjs'

const P = path.posix
const SRC = /\.(?:ts|mts|cts|tsx|js|mjs|cjs)$/i
const DTS = /\.d\.[cm]?ts$/i
const IMPORT = /\bfrom[ \t]*['"]typeorm['"]|\brequire\([ \t]*['"]typeorm['"][ \t]*\)/
const DECOR = /@(?:Entity|ViewEntity|Column|PrimaryGeneratedColumn|PrimaryColumn)[ \t]*\(/
export const typeormLevel = (p, text) => (SRC.test(p) && !DTS.test(p) && IMPORT.test(text) && DECOR.test(text) ? 65536 : 0)
const DATA_SOURCE = /\bnew[ \t]+DataSource[ \t]*\(/
const COLUMNS = new Set(['Column', 'PrimaryColumn', 'PrimaryGeneratedColumn', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn', 'ObjectIdColumn'])
const ACTIONS = { CASCADE: 'cascade', 'SET NULL': 'set null', RESTRICT: 'restrict', 'NO ACTION': 'no action', 'SET DEFAULT': 'set default' }
const MAX = { classes: 2000, columns: 1000, notes: 12 }
const langOf = (p) => (/\.tsx$/i.test(p) ? 'tsx' : /\.(?:ts|mts|cts)$/i.test(p) ? 'typescript' : 'javascript')

// TypeORM's DefaultNamingStrategy and StringUtils
const snakeCase = (s) => String(s).replace(/(?:([a-z])([A-Z]))|(?:((?!^)[A-Z])([a-z]))/g, '$1_$3$2$4').toLowerCase()
const camelCase = (s) => String(s).replace(/^([A-Z])|[\s-_](\w)/g, (m, p1, p2) => (p2 ? p2.toUpperCase() : p1.toLowerCase()))
const sha1 = (s) => createHash('sha1').update(s).digest('hex')
const keyOf = (table, cols) => `${table.replace('.', '_')}_${[...cols].sort().join('_')}`
export const tname = { index: (t, c) => `IDX_${sha1(keyOf(t, c)).slice(0, 26)}`, unique: (t, c) => `UQ_${sha1(keyOf(t, c)).slice(0, 27)}`, primary: (t, c) => `PK_${sha1(keyOf(t, c)).slice(0, 27)}` }

// A data source's `migrations` glob, its first entry: a literal (`'src/migration/*.ts'`), or one built from
// the data source's own folder (`__dirname + '/migrations/**/*{.ts,.js}'`, `${__dirname}/migrations/*.ts`
// in a template, `path.join(__dirname, 'migrations', '*.ts')`, `path.resolve(__dirname, …)`); anything
// else code builds is not read. → { glob, dirname: built from __dirname, shown: as written } | null
const LIT = String.raw`(['"` + '`' + String.raw`])([^'"` + '`' + String.raw`\n$]{1,300})\1`
const AT = String.raw`\bmigrations[ \t]*:[ \t]*\[\s*`
const GLOBS = [
  [new RegExp(String.raw`${AT}__dirname\s*\+\s*${LIT}`), (m) => ({ glob: m[2], dirname: true })],
  [new RegExp(AT + '`' + String.raw`\$\{__dirname\}([^` + '`' + String.raw`$\n]{1,300})` + '`'), (m) => ({ glob: m[1], dirname: true })],
  [new RegExp(String.raw`${AT}(?:path\s*\.\s*)?(?:join|resolve)\(\s*__dirname\s*((?:,\s*['"` + '`' + String.raw`][^'"` + '`' + String.raw`\n$]{1,200}['"` + '`' + String.raw`]\s*){1,8})\)`), (m) => ({ glob: [...m[1].matchAll(/['"`]([^'"`\n]*)['"`]/g)].map((x) => x[1]).join('/'), dirname: true })],
  [new RegExp(AT + LIT), (m) => ({ glob: m[2], dirname: false })],
]
export function migrationsGlob(text) {
  for (const [re, read] of GLOBS) {
    const m = re.exec(text)
    if (!m) continue
    const g = read(m)
    return { glob: g.dirname ? g.glob.replace(/^\/+/, '').replace(/\/{2,}/g, '/') : g.glob, dirname: g.dirname, shown: g.dirname ? m[0].replace(/^[^[]*\[\s*/, '').replace(/\s+/g, ' ').slice(0, 120) : g.glob }
  }
  return null
}

const decoratorsOf = (n) => named(n).filter((c) => c.type === 'decorator')
function decorator(d) {
  const x = named(d)[0]
  if (x?.type === 'call_expression') return { name: field(x, 'function')?.text.split('.').pop(), args: argsOf(x), line: lineOf(d) }
  if (x?.type === 'identifier' || x?.type === 'member_expression') return { name: x.text.split('.').pop(), args: [], line: lineOf(d) }
  return null
}
const optsOf = (args) => { for (const a of args) { const v = value(a); if (v.k === 'obj') return v.pairs } return new Map() }
// a default as kept: a number, a boolean, null; else only that there is one
function defaultOf(n) {
  const v = value(n)
  if (v.k === 'num') return { default: v.v }
  if (v.k === 'true' || v.k === 'false' || v.k === 'null') return { default: v.k }
  return { default: v.k === 'str' ? "'…'" : '(expression)', unstated: true }
}

// ── one entity file ──
function readFile(root, file) {
  const out = { classes: [], errors: [] }
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'ERROR' && out.errors.length < 4) out.errors.push(lineOf(n))
    if (n.type === 'class_declaration' || n.type === 'abstract_class_declaration' || n.type === 'class') { if (out.classes.length < MAX.classes) out.classes.push(readClass(n, file)); continue }
    for (let cs = n.namedChildren, i = cs.length - 1; i >= 0; i--) stack.push(cs[i])
  }
  return out
}
function readClass(c, file) {
  const parent = c.parent?.type === 'export_statement' ? c.parent : null
  const decos = [...(parent ? decoratorsOf(parent) : []), ...decoratorsOf(c)].map(decorator).filter(Boolean)
  const heritage = named(c).find((x) => x.type === 'class_heritage')
  const ext = heritage ? named(heritage).find((x) => x.type === 'extends_clause') : null
  const k = { name: field(c, 'name')?.text || null, line: lineOf(c), extends: ext ? named(ext)[0]?.text.split('.').pop() || null : null, entity: null, view: false, indexes: [], uniques: [], props: [], notes: [] }
  for (const d of decos) {
    if (d.name === 'Entity' || d.name === 'ViewEntity') {
      const a0 = d.args[0], o = optsOf(d.args)
      k.entity = { name: str(a0) ?? (o.has('name') ? str(o.get('name')) : null), schema: o.has('schema') ? str(o.get('schema')) : null, line: d.line }
      k.view = d.name === 'ViewEntity'
      if (o.has('synchronize') && bool(o.get('synchronize')) === false) k.notes.push('synchronize: false')
    } else if (d.name === 'Index' || d.name === 'Unique') {
      const name = value(d.args[0]).k === 'str' ? str(d.args[0]) : null
      const cols = d.args.map((a) => (value(a).k === 'arr' ? strs(a) : null)).find(Boolean) || null
      const o = optsOf(d.args)
      const x = { name, columns: cols, unique: d.name === 'Unique' || bool(o.get('unique')) === true, partial: o.has('where'), line: d.line, code: !cols }
      ;(d.name === 'Unique' ? k.uniques : k.indexes).push(x)
    } else if (d.name === 'TableInheritance' || d.name === 'ChildEntity') k.notes.push(`@${d.name}`)
  }
  for (const m of named(field(c, 'body') || c)) {
    if (m.type !== 'public_field_definition' && m.type !== 'field_definition' && m.type !== 'property_signature') continue
    if (k.props.length >= MAX.columns) break
    const ds = decoratorsOf(m).map(decorator).filter(Boolean)
    if (!ds.length) continue
    const name = field(m, 'name')?.text || field(m, 'property')?.text
    const tsType = field(m, 'type') ? named(field(m, 'type'))[0]?.text.replace(/\s+/g, ' ') : null
    k.props.push({ name, line: lineOf(m), ts: tsType, decos: ds.map((d) => ({ name: d.name, line: d.line, args: readArgs(d.args) })) })
  }
  return k
}
// a decorator's arguments, as data: strings, numbers, booleans, a class an arrow names, an object's literal options
function readArgs(args) {
  return args.map((a) => {
    const v = value(a)
    if (v.k === 'str') return { s: v.v }
    if (v.k === 'num') return { n: v.v }
    if (v.k === 'arrow') { const ref = classRef(a); const b = value(v.body); return ref && b.k === 'name' && !b.v.includes('.') ? { cls: ref } : { fn: true } }
    if (v.k === 'arr') return { list: strs(a) }
    if (v.k === 'obj') {
      const o = {}
      for (const [key, x] of v.pairs) {
        const xv = value(x)
        if (key === 'default') { o.default = defaultOf(x); continue }
        if (xv.k === 'str') o[key] = xv.v
        else if (xv.k === 'num') o[key] = Number(xv.v)
        else if (xv.k === 'true' || xv.k === 'false') o[key] = xv.k === 'true'
        else if (xv.k === 'arr') o[key] = strs(x)
        else if (xv.k === 'obj') { const sub = {}; for (const [kk, y] of xv.pairs) { const yv = value(y); if (yv.k === 'str') sub[kk] = yv.v } o[key] = sub }
        else if (key === 'type' && xv.k === 'name') o.type = xv.v.split('.').pop()
        else if (key === 'enum') o.enum = true
      }
      return { o }
    }
    if (v.k === 'name') return { name: v.v }
    return { code: true }
  })
}

export default {
  id: 'typeorm',
  version: 2,
  kind: 'code',
  scope: 'unit',
  tree: true,
  wants: (p) => SRC.test(p) && !DTS.test(p),
  level: (p, text) => typeormLevel(p, text),
  parses: (p, text) => typeormLevel(p, text) > 0,
  discover(info) {
    const files = [...info].filter(([p, i]) => SRC.test(p) && i.ddl & 65536).map(([p]) => p).sort()
    if (!files.length) return []
    const sources = [...info].filter(([p, i]) => SRC.test(p) && i.ddl & 2048 && !files.includes(p)).map(([p]) => p).sort()
    // the migrations a data source may name (code-migrations.mjs finds them by content): their folders
    const migrations = sources.length ? [...info].filter(([p, i]) => SRC.test(p) && i.ddl & 1024 && !files.includes(p)).map(([p]) => p).sort() : []
    return [{ key: common(files), inputs: [...files, ...sources, ...migrations] }]
  },
  parse(text, file, ctx) {
    const tree = ctx.tree(langOf(file), text)
    try { return readFile(tree.rootNode, file) } finally { tree.delete?.() }
  },
  extract({ key, files }, ctx) {
    const entityFiles = files.filter((f) => typeormLevel(f.path, f.text))
    const sources = files.filter((f) => !typeormLevel(f.path, f.text) && DATA_SOURCE.test(f.text))
    const folders = new Set(files.filter((f) => !typeormLevel(f.path, f.text) && !DATA_SOURCE.test(f.text)).map((f) => P.dirname(f.path)))
    const notes = []
    const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
    const classes = new Map()
    for (const f of entityFiles) {
      const r = ctx.aside ? ctx.aside('typeorm', f.path, f.text) : this.parse(f.text, f.path, ctx)
      for (const l of r.errors) note(`${f.path}:${l}: does not parse here; what parsed is kept`)
      for (const c of r.classes) if (c.name && !classes.has(c.name)) classes.set(c.name, { ...c, path: f.path })
    }
    // the store: the folder the data source's migrations glob names, when it is a literal
    let store = key, storeNote = null, dialect = null, dialectFrom = null, uuidFn = 'uuid_generate_v4()'
    for (const s of sources) {
      const m = migrationsGlob(s.text)
      if (m && store === key) {
        // a glob built from __dirname is under the data source's folder; a literal is read from where the
        // app runs (the repository's root), else from the data source's folder
        const here = (g) => P.join(P.dirname(s.path), g)
        const dir = (m.dirname ? [globDir(here(m.glob))] : [globDir(m.glob), globDir(here(m.glob))]).find((d) => folders.has(d))
        if (dir) { store = dir; storeNote = `the migrations of ${s.path} (${m.shown}): the entities and those migrations are one store` }
      }
      const t = /\btype[ \t]*:[ \t]*['"`](postgres|mysql|mariadb|sqlite|better-sqlite3|cockroachdb)['"`]/.exec(s.text)
      if (t && !dialect) { dialect = { postgres: 'postgres', cockroachdb: 'postgres', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite', 'better-sqlite3': 'sqlite' }[t[1]]; dialectFrom = { how: 'stated', path: s.path, line: s.text.slice(0, t.index).split('\n').length }; uuidFn = t[1] === 'cockroachdb' || /\buuidExtension[ \t]*:[ \t]*['"`]pgcrypto['"`]/.test(s.text) ? 'gen_random_uuid()' : 'uuid_generate_v4()' }
    }
    if (storeNote) note(storeNote)
    const entities = []
    const tableOf = (c) => (c?.entity ? qualified(c.entity.schema, c.entity.name || snakeCase(c.name)) : null)
    const qualified = (schema, name) => (schema && schema !== 'public' ? `${schema}.${name}` : name)
    // a class's properties, its base classes' first (an abstract base of entities)
    const propsOf = (c, seen = new Set()) => { if (!c || seen.has(c.name)) return []; seen.add(c.name); return [...propsOf(c.extends ? classes.get(c.extends) : null, seen), ...c.props.map((p) => ({ ...p, path: c.path }))] }
    // a property's column: a column decorator's name, else a relation's join column (`@JoinColumn({ name })`,
    // else `<property><ReferencedColumn>`: what an `@Index()` on the relation indexes), else the property
    const columnName = (p) => {
      const d = p.decos.find((x) => COLUMNS.has(x.name))
      if (d) return (d.args.find((a) => a.o)?.o || {}).name || p.name
      const r = p.decos.find((x) => x.name === 'ManyToOne' || x.name === 'OneToOne' && p.decos.some((y) => y.name === 'JoinColumn'))
      return r ? joinOf(p, r)?.column ?? p.name : p.name
    }
    function joinOf(p, d) {
      const target = classes.get(d.args.find((a) => a.cls)?.cls || d.args.find((a) => a.s)?.s)
      if (!target?.entity) return null
      const jo = p.decos.find((x) => x.name === 'JoinColumn')?.args.find((a) => a.o)?.o || {}
      const tpk = pkOf(target)
      const refCol = jo.referencedColumnName || tpk?.column || 'id'
      return { target, jo, tpk, refCol, column: jo.name || camelCase(`${p.name}_${refCol}`) }
    }
    const pkOf = (c) => { const p = propsOf(c).find((x) => x.decos.some((d) => d.name === 'PrimaryColumn' || d.name === 'PrimaryGeneratedColumn')); return p ? { prop: p.name, column: columnName(p), type: columnType(p) } : null }
    function columnType(p) {
      const d = p.decos.find((x) => COLUMNS.has(x.name) || x.name === 'PrimaryGeneratedColumn')
      if (!d) return 'unknown'
      const o = d.args.find((a) => a.o)?.o || {}
      if (d.name === 'PrimaryGeneratedColumn') { const s = d.args.find((a) => a.s)?.s || o.strategy || 'increment'; return s === 'uuid' ? 'uuid' : s === 'rowid' ? 'rowid' : 'int' }
      let t = d.args.find((a) => a.s)?.s || o.type || null
      if (!t) t = d.name.endsWith('DateColumn') ? 'timestamp' : d.name === 'VersionColumn' ? 'int' : (p.ts || 'unknown').replace(/\s*\|\s*(?:null|undefined)/g, '')
      if (o.length !== undefined) t += `(${o.length})`
      else if (o.precision !== undefined) t += `(${o.precision}${o.scale !== undefined ? `,${o.scale}` : ''})`
      if (o.array) t += '[]'
      return String(t).slice(0, 80)
    }
    let relations = 0
    for (const c of classes.values()) {
      if (!c.entity) continue
      const table = tableOf(c)
      const at = (line, file = c.path) => ({ path: file, line })
      const e = { name: table, kind: c.view ? 'view' : 'table', path: c.path, line: c.line, as: `class ${c.name}`, fields: [], keys: [], indexes: [], relations: [] }
      for (const n of c.notes) { if (/@/.test(n)) { e.part = true; note(`${c.path}:${c.line}: class ${c.name} uses ${n}: its table is stated in part`) } }
      entities.push(e)
      if (c.view) continue
      e.whole = true // an entity states its table whole: what the migrations add to it, or lack, is a conflict (unless in part)
      const pk = []
      for (const p of propsOf(c)) {
        const where = at(p.line, p.path)
        for (const d of p.decos) {
          const o = d.args.find((a) => a.o)?.o || {}
          if (COLUMNS.has(d.name)) {
            if (d.args.some((a) => a.cls || a.fn)) { e.part = true; note(`${p.path}:${p.line}: ${c.name}.${p.name} is an embedded column: its columns are not read`); continue }
            const column = o.name || p.name
            const f = { name: column, ...(column !== p.name ? { attr: p.name } : {}), type: columnType(p), nullable: d.name === 'DeleteDateColumn' ? true : o.nullable === true, default: null, generated: null, ...where, unstated: ['type'] }
            if (o.default) { f.default = o.default.default; if (o.default.unstated) f.unstated.push('default') }
            if (d.name === 'CreateDateColumn' || d.name === 'UpdateDateColumn') { f.default = 'now()'; f.unstated.push('default') }
            if (d.name === 'PrimaryColumn' || d.name === 'PrimaryGeneratedColumn') { f.nullable = false; pk.push(column) }
            // the uuid strategy: on Postgres the database's uuid_generate_v4() (gen_random_uuid() under the
            // pgcrypto extension, and on CockroachDB), on another engine a value the client computes; an
            // engine the data source does not state leaves the default not compared
            if (d.name === 'PrimaryGeneratedColumn' && f.type === 'uuid') { if (dialect === 'postgres') f.default = uuidFn; else { f.unstated.push('default'); if (dialect) f.computed = 'uuid' } }
            if (o.unique) e.keys.push({ role: 'unique', parts: [column], ...where })
            e.fields.push(f)
          } else if (d.name === 'Index') {
            const ao = d.args.find((a) => a.o)?.o || {}
            const name = d.args.find((a) => a.s)?.s || null
            const col = columnName(p)
            e.indexes.push({ name: name || tname.index(table, [col]), unique: ao.unique === true, columns: [col], partial: !!ao.where, ...where })
          } else if (d.name === 'ManyToOne' || d.name === 'OneToOne') {
            const join = p.decos.find((x) => x.name === 'JoinColumn')
            if (d.name === 'OneToOne' && !join) continue // the inverse side: no column
            const targetName = d.args.find((a) => a.cls)?.cls || d.args.find((a) => a.s)?.s
            const j = joinOf(p, d)
            if (!j) { note(`${p.path}:${p.line}: ${c.name}.${p.name}'s target ${targetName || '(built by code)'} is no entity read: its column is not stated`); e.part = true; continue }
            const { target, tpk, refCol, column } = j, jo = j.jo
            const refType = jo.referencedColumnName ? (propsOf(target).find((x) => columnName(x) === refCol) ? columnType(propsOf(target).find((x) => columnName(x) === refCol)) : 'unknown') : tpk?.type || 'unknown'
            e.fields.push({ name: column, attr: p.name, type: refType, nullable: o.nullable !== false, default: null, generated: null, ...where, unstated: ['type'] })
            if (d.name === 'OneToOne') e.keys.push({ role: 'unique', parts: [column], ...where })
            e.relations.push({ columns: [column], to: tableOf(target), toColumns: [refCol], onDelete: ACTIONS[String(o.onDelete || 'NO ACTION').toUpperCase()] || 'no action', onUpdate: ACTIONS[String(o.onUpdate || 'NO ACTION').toUpperCase()] || 'no action', ...(o.createForeignKeyConstraints === false ? { enforced: 'client' } : {}), ...where })
            relations++
          } else if (d.name === 'ManyToMany') {
            const jt = p.decos.find((x) => x.name === 'JoinTable')
            if (!jt) continue // the inverse side
            const target = classes.get(d.args.find((a) => a.cls)?.cls || d.args.find((a) => a.s)?.s)
            if (!target?.entity) { note(`${p.path}:${p.line}: ${c.name}.${p.name}'s target is no entity read: its junction table is not stated`); continue }
            const jo = jt.args.find((a) => a.o)?.o || {}
            const other = tableOf(target)
            const name = jo.name || snakeCase(`${table}_${p.name.replace(/\./g, '_')}_${other}`)
            const mine = pkOf(c), theirs = pkOf(target)
            const a = jo.joinColumn?.name || camelCase(`${table}_${jo.joinColumn?.referencedColumnName || mine?.column || 'id'}`)
            const b = jo.inverseJoinColumn?.name || camelCase(`${other}_${jo.inverseJoinColumn?.referencedColumnName || theirs?.column || 'id'}`)
            entities.push({
              name, kind: 'table', ...where, as: `${c.name}.${p.name} (junction)`, whole: true,
              fields: [{ name: a, type: mine?.type || 'unknown', nullable: false, default: null, generated: null, ...where, unstated: ['type'] }, { name: b, type: theirs?.type || 'unknown', nullable: false, default: null, generated: null, ...where, unstated: ['type'] }],
              keys: [{ role: 'primary', parts: [a, b], ...where }],
              indexes: [{ name: tname.index(name, [a]), unique: false, columns: [a], partial: false, ...where }, { name: tname.index(name, [b]), unique: false, columns: [b], partial: false, ...where }],
              relations: [{ columns: [a], to: table, toColumns: [mine?.column || 'id'], onDelete: 'cascade', onUpdate: 'cascade', ...where }, { columns: [b], to: other, toColumns: [theirs?.column || 'id'], onDelete: 'cascade', onUpdate: 'cascade', ...where }],
            })
            relations += 2
          }
        }
      }
      if (pk.length) e.keys.unshift({ role: 'primary', parts: pk, ...at(c.line) })
      const colOf = (prop) => { const p = propsOf(c).find((x) => x.name === prop); return p ? columnName(p) : prop }
      for (const x of c.indexes) { if (x.code) { note(`${c.path}:${x.line}: an index of ${c.name} whose columns are built by code: not read`); continue } const cols = x.columns.map(colOf); e.indexes.push({ name: x.name || tname.index(table, cols), unique: x.unique, columns: cols, partial: x.partial, ...at(x.line) }) }
      for (const x of c.uniques) { if (x.code) continue; e.keys.push({ role: 'unique', parts: x.columns.map(colOf), ...at(x.line) }) }
    }
    for (const e of entities) if (e.part) delete e.whole
    if (!entities.length) return { declarations: [] }
    // the entities are the whole store (TypeORM's generated migrations drop a table no entity maps), unless
    // one is read in part or a file did not parse: then a table they lack is no conflict
    const complete = entities.every((e) => !e.part) && !notes.some((n) => /does not parse/.test(n))
    return { declarations: [{
      store, dialect, dialectFrom,
      source: { path: entityFiles[0].path, line: 1, kind: 'code', confidence: 'declared' },
      complete, partial: false, status: 'read',
      label: `TypeORM entities, read ${counted(entityFiles.length, 'file')}: ${counted(entities.length, 'table')}, ${counted(relations, 'relation')}`,
      notes, files: entityFiles.length, clients: ['typeorm'],
      entities,
    }] }
  },
}
