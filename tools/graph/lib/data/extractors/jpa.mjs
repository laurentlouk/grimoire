// grimoire graph · data · extractor: JPA entities (`@Entity` Java classes, Jakarta or javax persistence),
// a code model (kind code: what Hibernate maps, and what its DDL would create). Through the pinned Java
// grammar, nothing compiled. Per unit: a module (the folder holding `src/main/java`), its entity files,
// its build file and Spring configuration; re-run when any changes.
//
// Found by content (bit 131072 of a Java file's level): a `.java` file importing `jakarta.persistence` or
// `javax.persistence` and annotated `@Entity`, `@MappedSuperclass` or `@Embeddable`.
//
// The store: Flyway's migrations, when the module has them where Flyway looks by default
// (`src/main/resources/db/migration`, or a literal `spring.flyway.locations=classpath:…`): the entities
// and the SQL migrations (sql-migrations.mjs) are two declarations of one store, each table cited at its
// entity class beside its migration; else the module's own folder.
//
// Names, as the module's naming strategy writes them: with Spring Boot (its build file names it) its
// default physical strategy, every name in snake_case, lower case (`orderNumber` → `order_number`, an
// explicit `@Column(name = "orderNo")` too), unless the configuration sets
// `PhysicalNamingStrategyStandardImpl`; else as written. What is read:
//   - `@Entity(name)` / `@Table(name, schema, uniqueConstraints, indexes)`: the table (the entity's
//     name, else the class's), the class cited beside it; a `@MappedSuperclass` it extends gives its
//     fields first; an `@Embedded` field's `@Embeddable` class its columns, inline;
//   - every field but `static`, `transient`, `@Transient` ones: a column (`@Column(name, nullable,
//     unique, length, precision, scale)`), typed by its Java type (`String(32)`, `BigDecimal(10,2)`: not
//     the engine's, so not compared); not null when `nullable = false`, `@NotNull`, `@Id`, or a primitive
//     type; nullable when `nullable = true`; else not said (JPA states nothing: Hibernate's DDL would
//     allow null), so never a conflict with the migrations;
//   - `@Id` the primary key (`@EmbeddedId`, `@IdClass` noted, the table then in part);
//   - `@ManyToOne` and an owning `@OneToOne` (no `mappedBy`): a join column (`@JoinColumn(name,
//     referencedColumnName, nullable)`, else `<field>_<referenced key>`) and its foreign key (`@OnDelete`
//     its action; `@ForeignKey(ConstraintMode.NO_CONSTRAINT)` a relation declared by the ORM); a
//     unidirectional `@OneToMany` with a `@JoinColumn`: the column on the target's table;
//   - `@ManyToMany` and `@JoinTable(name, joinColumns, inverseJoinColumns)` on the owning side: the join
//     table (by default `<owner table>_<field>` with Spring, `<Owner>_<Target>` without), its columns and
//     foreign keys;
//   - `@Table(uniqueConstraints = @UniqueConstraint(columnNames))` unique keys, `@Table(indexes =
//     @Index(name, columnList, unique))` indexes; a `@Column(unique = true)` a unique key.
// An `@Entity` extending another (single-table inheritance by default) adds its columns to the root's
// table, which is then stated in part; `@ElementCollection` is noted, not read.
import path from 'node:path'
import { named, field, lineOf } from '../readers/code.mjs'
import { counted } from '../readers/orm.mjs'

const P = path.posix
const JAVA = /\.java$/i
const IMPORT = /^[ \t]*import[ \t]+(?:jakarta|javax)\.persistence\b/m
const ANNOT = /@(?:Entity|MappedSuperclass|Embeddable)\b/
export const jpaLevel = (p, text) => (JAVA.test(p) && IMPORT.test(text) && ANNOT.test(text) ? 131072 : 0)
const BUILD = /(^|\/)(?:pom\.xml|build\.gradle(?:\.kts)?)$/
const SPRING_CONFIG = /(^|\/)src\/main\/resources\/application(?:-[\w-]+)?\.(?:properties|ya?ml)$/
const PRIMITIVES = new Set(['int', 'long', 'short', 'byte', 'boolean', 'double', 'float', 'char'])
const JDBC = { postgresql: 'postgres', mysql: 'mysql', mariadb: 'mysql', sqlite: 'sqlite' }
const MAX = { classes: 2000, fields: 1000, notes: 12 }

// an annotation: { name, args: Map(key → node), value: node (its single value) }
function annotations(mods) {
  const out = []
  for (const a of mods ? named(mods) : []) {
    if (a.type !== 'annotation' && a.type !== 'marker_annotation') continue
    const name = field(a, 'name')?.text.split('.').pop()
    const args = new Map()
    let single = null
    const list = field(a, 'arguments')
    for (const x of list ? named(list) : []) {
      if (x.type === 'element_value_pair') args.set(field(x, 'key')?.text, field(x, 'value'))
      else single = x
    }
    out.push({ name, args, value: single ?? args.get('value') ?? null, line: lineOf(a) })
  }
  return out
}
const jstr = (n) => { if (!n || n.type !== 'string_literal') return null; let v = ''; for (const c of named(n)) { if (c.type === 'string_fragment') v += c.text; else if (c.type === 'escape_sequence') v += c.text.length === 2 ? ' ' : '' } return v }
const jbool = (n) => (n?.type === 'true' ? true : n?.type === 'false' ? false : null)
const jint = (n) => (n && /integer_literal$/.test(n.type) ? n.text.replace(/_/g, '').replace(/[lL]$/, '') : null)
const jstrs = (n) => { if (!n) return null; if (n.type === 'string_literal') return [jstr(n)]; if (n.type === 'element_value_array_initializer') { const out = named(n).map(jstr); return out.every((x) => x !== null) ? out : null } return null }
const annsOf = (n) => (n?.type === 'annotation' || n?.type === 'marker_annotation' ? [n] : n?.type === 'element_value_array_initializer' ? named(n).filter((x) => x.type === 'annotation' || x.type === 'marker_annotation') : [])
const one = (n) => annotations({ namedChildCount: 1, namedChild: () => n })[0]

// ── one entity file ──
function readFile(root, file) {
  const out = { classes: [], errors: [] }
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'ERROR' && out.errors.length < 4) out.errors.push(lineOf(n))
    if (n.type === 'class_declaration' && out.classes.length < MAX.classes) out.classes.push(readClass(n))
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return out
}
function readClass(c) {
  const mods = named(c).find((x) => x.type === 'modifiers')
  const anns = annotations(mods)
  const has = (n) => anns.find((a) => a.name === n)
  const k = { name: field(c, 'name')?.text, line: lineOf(c), extends: field(c, 'superclass') ? named(field(c, 'superclass'))[0]?.text.replace(/<.*$/, '').split('.').pop() : null, kind: has('Entity') ? 'entity' : has('MappedSuperclass') ? 'mapped' : has('Embeddable') ? 'embeddable' : null, entityName: null, table: null, schema: null, uniques: [], indexes: [], inheritance: null, idClass: !!has('IdClass'), fields: [] }
  const ent = has('Entity')
  if (ent) k.entityName = jstr(ent.args.get('name') || ent.value)
  const t = has('Table')
  if (t) {
    k.table = jstr(t.args.get('name') || t.value); k.schema = jstr(t.args.get('schema'))
    for (const u of annsOf(t.args.get('uniqueConstraints'))) { const a = one(u); const cols = jstrs(a.args.get('columnNames')); if (cols) k.uniques.push({ columns: cols, line: a.line }) }
    for (const i of annsOf(t.args.get('indexes'))) { const a = one(i); const list = jstr(a.args.get('columnList')); if (list) k.indexes.push({ name: jstr(a.args.get('name')), columns: list.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean), unique: jbool(a.args.get('unique')) === true, line: a.line }) }
  }
  const inh = has('Inheritance')
  if (inh) k.inheritance = /JOINED/.test(inh.args.get('strategy')?.text || '') ? 'joined' : /TABLE_PER_CLASS/.test(inh.args.get('strategy')?.text || '') ? 'per-class' : 'single'
  for (const m of named(field(c, 'body') || c)) {
    if (m.type !== 'field_declaration' || k.fields.length >= MAX.fields) continue
    const fm = named(m).find((x) => x.type === 'modifiers')
    if (fm && /\b(?:static|transient)\b/.test(fm.text.replace(/@\w+(?:\([^)]*\))?/g, ''))) continue
    const fa = annotations(fm)
    if (fa.some((a) => a.name === 'Transient')) continue
    const typeNode = field(m, 'type')
    const type = typeNode?.text.replace(/\s+/g, '') || 'unknown'
    for (const d of named(m).filter((x) => x.type === 'variable_declarator')) {
      const f = { name: field(d, 'name')?.text, line: lineOf(m), type, anns: fa.map((a) => ({ name: a.name, line: a.line, o: opts(a) })) }
      k.fields.push(f)
    }
  }
  return k
}
// an annotation's arguments as data: strings, numbers, booleans, enum constants by name, nested join columns
function opts(a) {
  const o = {}
  for (const [key, n] of a.args) {
    if (!key) continue
    const s = jstr(n), i = jint(n), b = jbool(n)
    if (s !== null) o[key] = s
    else if (i !== null) o[key] = Number(i)
    else if (b !== null) o[key] = b
    else if (n.type === 'field_access' || n.type === 'identifier') o[key] = n.text.split('.').pop()
    else if (key === 'joinColumns' || key === 'inverseJoinColumns' || key === 'foreignKey') { const x = annsOf(n).map(one); o[key] = x.map((y) => opts(y)) }
    else if (n.type === 'class_literal') o[key] = n.text.replace(/\.class$/, '').split('.').pop()
  }
  if (a.value && !a.args.has('value')) { const s = jstr(a.value); if (s !== null) o.value = s; else if (a.value.type === 'field_access' || a.value.type === 'identifier') o.value = a.value.text.split('.').pop() }
  return o
}

// Spring Boot's default physical naming (CamelCaseToUnderscoresNamingStrategy): `_` between a lower case
// letter and an upper case one followed by a lower case one, dots as `_`, then lower case
function springName(s) {
  const b = String(s).replace(/\./g, '_').split('')
  for (let i = 1; i < b.length - 1; i++) if (/[a-z]/.test(b[i - 1]) && /[A-Z]/.test(b[i]) && /[a-z]/.test(b[i + 1])) b.splice(i++, 0, '_')
  return b.join('').toLowerCase()
}

export default {
  id: 'jpa',
  version: 2,
  kind: 'code',
  scope: 'unit',
  tree: true,
  wants: (p) => JAVA.test(p) || BUILD.test(p) || SPRING_CONFIG.test(p),
  level: (p, text) => jpaLevel(p, text),
  parses: (p, text) => jpaLevel(p, text) > 0,
  config: (p) => BUILD.test(p) || SPRING_CONFIG.test(p),
  discover(info) {
    const files = [...info].filter(([p, i]) => JAVA.test(p) && i.ddl & 131072).map(([p]) => p).sort()
    const modules = new Map()
    for (const f of files) {
      const i = f.indexOf('src/main/java/')
      const mod = i < 0 ? P.dirname(f) : i === 0 ? '.' : f.slice(0, i - 1)
      if (!modules.has(mod)) modules.set(mod, [])
      modules.get(mod).push(f)
    }
    return [...modules].map(([mod, list]) => {
      const under = (rel) => (mod === '.' ? rel : `${mod}/${rel}`)
      const conf = [...info.keys()].filter((p) => (BUILD.test(p) && (P.dirname(p) === mod || (mod !== '.' && mod.startsWith(`${P.dirname(p)}/`)) || P.dirname(p) === '.')) || (SPRING_CONFIG.test(p) && p.startsWith(under('src/main/resources/')))).sort()
      // Flyway's default location, when it holds SQL migrations (sql-migrations.mjs reads them)
      const flyway = [...info].filter(([p, i]) => /\.sql$/i.test(p) && i.ddl >= 1 && p.startsWith(under('src/main/resources/'))).map(([p]) => p)
      return { key: mod, inputs: [...list, ...conf, ...flyway.sort()] }
    })
  },
  parse(text, file, ctx) {
    const tree = ctx.tree('java', text)
    try { return readFile(tree.rootNode, file) } finally { tree.delete?.() }
  },
  extract({ key: mod, files }, ctx) {
    const sources = files.filter((f) => jpaLevel(f.path, f.text))
    const sqlFolders = new Set(files.filter((f) => /\.sql$/i.test(f.path)).map((f) => P.dirname(f.path)))
    const builds = files.filter((f) => BUILD.test(f.path)), confs = files.filter((f) => SPRING_CONFIG.test(f.path))
    const notes = []
    const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
    const under = (rel) => (mod === '.' ? rel : `${mod}/${rel}`)
    // the naming strategy, the dialect (a JDBC URL's scheme alone), Flyway's locations
    const spring = builds.some((f) => /spring-boot/.test(f.text))
    const standard = confs.some((f) => /physical[-_.]?strategy[ \t]*[:=][ \t]*\S*PhysicalNamingStrategyStandardImpl/i.test(f.text))
    const snake = spring && !standard
    if (snake) note(`names in snake_case: Spring Boot's default physical naming strategy (${builds.find((f) => /spring-boot/.test(f.text)).path})`)
    const schemes = []
    for (const f of confs) { const re = /jdbc:([a-z]{2,20}):/g; let m; while ((m = re.exec(f.text)) && schemes.length < 20) schemes.push({ d: JDBC[m[1]] || m[1], path: f.path, line: f.text.slice(0, m.index).split('\n').length }) }
    const ds = new Set(schemes.map((s) => s.d))
    const dialect = ds.size === 1 ? schemes[0].d : null
    if (ds.size > 1) note(`the configuration's JDBC URLs name ${ds.size} engines: dialect unknown`)
    const loc = confs.map((f) => /flyway[.\w-]*locations[ \t]*[:=][ \t]*['"]?classpath:\/?([\w/.-]{1,200})/.exec(f.text)).find(Boolean)
    const flywayDir = under(`src/main/resources/${loc ? loc[1].replace(/\/+$/, '') : 'db/migration'}`)
    const store = sqlFolders.has(flywayDir) ? flywayDir : mod
    if (store === flywayDir) note(`the migrations in ${flywayDir}, where Flyway looks${loc ? ' (spring.flyway.locations)' : ' by default'}: the entities and those migrations are one store`)
    const N = (s) => (snake ? springName(s) : s)
    const classes = new Map()
    for (const f of sources) {
      const r = ctx.aside ? ctx.aside('jpa', f.path, f.text) : this.parse(f.text, f.path, ctx)
      for (const l of r.errors) note(`${f.path}:${l}: does not parse here; what parsed is kept`)
      for (const c of r.classes) if (c.name && !classes.has(c.name)) classes.set(c.name, { ...c, path: f.path })
    }
    const root = (c, seen = new Set()) => { const p = c.extends && classes.get(c.extends); return p?.kind === 'entity' && !seen.has(p.name) ? (seen.add(p.name), root(p, seen)) : c }
    const tableOf = (c) => { const r = c.kind === 'entity' && root(c) !== c && (root(c).inheritance || 'single') === 'single' ? root(c) : c; return qualified(r.schema, N(r.table || r.entityName || r.name)) }
    const qualified = (schema, name) => (schema && schema !== 'public' ? `${N(schema)}.${name}` : name)
    const fieldsOf = (c, seen = new Set()) => { if (!c || seen.has(c.name)) return []; seen.add(c.name); const p = c.extends && classes.get(c.extends); return [...(p?.kind === 'mapped' ? fieldsOf(p, seen) : []), ...c.fields.map((f) => ({ ...f, path: c.path }))] }
    const ann = (f, n) => f.anns.find((a) => a.name === n)
    const columnOf = (f) => N(ann(f, 'Column')?.o.name || ann(f, 'JoinColumn')?.o.name || f.name)
    const idOf = (c) => { const f = fieldsOf(c).find((x) => ann(x, 'Id')); return f ? { column: columnOf(f), type: typeText(f) } : null }
    const typeText = (f) => { const o = ann(f, 'Column')?.o || {}; let t = f.type.replace(/^java\.(?:lang|math|time|util)\./, ''); if (o.length !== undefined) t += `(${o.length})`; else if (o.precision !== undefined) t += `(${o.precision}${o.scale !== undefined ? `,${o.scale}` : ''})`; return t.slice(0, 80) }
    const target = (f, a) => classes.get(a.o.targetEntity || f.type.replace(/^.*<\s*|\s*>.*$/g, '').split('.').pop())
    const tables = new Map()
    const tableEntity = (name, c) => { if (!tables.has(name)) tables.set(name, { name, kind: 'table', path: c.path, line: c.line, as: `class ${c.name}`, fields: [], keys: [], indexes: [], relations: [] }); return tables.get(name) }
    let relations = 0
    for (const c of classes.values()) {
      if (c.kind !== 'entity') continue
      const table = tableOf(c)
      const e = tableEntity(table, c)
      const at = (line, file = c.path) => ({ path: file, line })
      if (root(c) !== c) { e.part = true; if (!e.as.includes(c.name)) e.as += `, ${c.name}`; note(`${c.path}:${c.line}: class ${c.name} extends the entity ${root(c).name}: its columns are stated in part`) }
      if (c.idClass) { e.part = true; note(`${c.path}:${c.line}: class ${c.name} has an @IdClass: its key is not read`) }
      const pk = []
      const sub = root(c) !== c // a subclass's columns in the root's table: nullable there, whatever they say
      const addFields = (list, prefix = '') => {
        for (const f of list) {
          const where = at(f.line, f.path)
          if (ann(f, 'OneToMany')) {
            const a = ann(f, 'OneToMany'), j = ann(f, 'JoinColumn'), t = target(f, a)
            if (j && t?.kind === 'entity' && !a.o.mappedBy) {
              const tid = idOf(c)
              const te = tableEntity(tableOf(t), t)
              const col = N(j.o.name)
              if (!te.fields.some((x) => x.name === col)) te.fields.push({ name: col, type: tid?.type || 'unknown', nullable: j.o.nullable === false ? false : true, default: null, generated: null, ...where, unstated: ['type', ...(j.o.nullable === undefined ? ['nullable'] : [])] })
              te.relations.push({ columns: [col], to: table, toColumns: [tid?.column || 'id'], onDelete: 'no action', onUpdate: 'no action', ...where }); relations++
            }
            continue
          }
          if (ann(f, 'ManyToMany')) {
            const a = ann(f, 'ManyToMany'), jt = ann(f, 'JoinTable'), t = target(f, a)
            if (a.o.mappedBy || !t || t.kind !== 'entity') continue
            const other = tableOf(t), mine = idOf(c), theirs = idOf(t)
            const name = jt?.o.name ? N(jt.o.name) : snake ? `${table}_${N(f.name)}` : `${c.entityName || c.name}_${t.entityName || t.name}`
            const ja = jt?.o.joinColumns?.[0]?.name, jb = jt?.o.inverseJoinColumns?.[0]?.name
            const colA = N(ja || `${snake ? table : c.entityName || c.name}_${mine?.column || 'id'}`), colB = N(jb || `${f.name}_${theirs?.column || 'id'}`)
            tables.set(name, { name, kind: 'table', ...where, as: `${c.name}.${f.name} (join table)`, fields: [{ name: colA, type: mine?.type || 'unknown', nullable: false, default: null, generated: null, ...where, unstated: ['type'] }, { name: colB, type: theirs?.type || 'unknown', nullable: false, default: null, generated: null, ...where, unstated: ['type'] }], keys: [], indexes: [], relations: [{ columns: [colA], to: table, toColumns: [mine?.column || 'id'], onDelete: 'no action', onUpdate: 'no action', ...where }, { columns: [colB], to: other, toColumns: [theirs?.column || 'id'], onDelete: 'no action', onUpdate: 'no action', ...where }], part: true })
            relations += 2
            continue
          }
          if (ann(f, 'ElementCollection')) { note(`${f.path}:${f.line}: ${c.name}.${f.name} is an @ElementCollection: its table is not read`); continue }
          if (ann(f, 'EmbeddedId')) { e.part = true; note(`${f.path}:${f.line}: ${c.name}.${f.name} is an @EmbeddedId: its key is not read`); continue }
          const emb = classes.get(f.type)
          if (ann(f, 'Embedded') || emb?.kind === 'embeddable') { if (emb?.kind === 'embeddable') addFields(fieldsOf(emb).map((x) => ({ ...x, line: f.line, path: f.path }))); else { e.part = true; note(`${f.path}:${f.line}: ${c.name}.${f.name} embeds a class no file read declares: its columns are not read`) } continue }
          const rel = ann(f, 'ManyToOne') || ann(f, 'OneToOne')
          if (rel) {
            if (rel.o.mappedBy) continue // the inverse side
            const t = target(f, rel)
            if (!t || t.kind !== 'entity') { e.part = true; note(`${f.path}:${f.line}: ${c.name}.${f.name}'s target ${f.type} is no entity read: its column is not stated`); continue }
            const j = ann(f, 'JoinColumn')?.o || {}
            const tid = idOf(t)
            const ref = j.referencedColumnName ? N(j.referencedColumnName) : tid?.column || 'id'
            const col = N(j.name || `${f.name}_${ref}`)
            const nn = j.nullable === false || rel.o.optional === false || !!ann(f, 'NotNull')
            e.fields.push({ name: col, ...(col !== f.name ? { attr: f.name } : {}), type: tid?.type || 'unknown', nullable: !nn, default: null, generated: null, ...where, unstated: ['type', ...(!nn && j.nullable === undefined ? ['nullable'] : [])] })
            if (rel.name === 'OneToOne') e.keys.push({ role: 'unique', parts: [col], ...where })
            const od = ann(f, 'OnDelete')?.o.action
            const noFk = (j.foreignKey || []).some((x) => x.value === 'NO_CONSTRAINT')
            e.relations.push({ columns: [col], to: tableOf(t), toColumns: [ref], onDelete: od === 'CASCADE' ? 'cascade' : od === 'SET_NULL' ? 'set null' : od === 'RESTRICT' ? 'restrict' : 'no action', onUpdate: 'no action', ...(noFk ? { enforced: 'client' } : {}), ...where })
            relations++
            continue
          }
          const o = ann(f, 'Column')?.o || {}
          const col = N(prefix + (o.name || f.name))
          const id = !!ann(f, 'Id')
          const nn = id || o.nullable === false || !!ann(f, 'NotNull') || !!ann(f, 'Version') && PRIMITIVES.has(f.type) || PRIMITIVES.has(f.type)
          const said = nn || o.nullable === true
          e.fields.push({ name: col, ...(col !== f.name ? { attr: f.name } : {}), type: typeText(f), nullable: sub || !nn, default: null, generated: null, ...where, unstated: ['type', ...(said && !sub ? [] : ['nullable'])] })
          if (id) pk.push(col)
          if (o.unique === true) e.keys.push({ role: 'unique', parts: [col], ...where })
        }
      }
      addFields(root(c) !== c ? c.fields.map((f) => ({ ...f, path: c.path })) : fieldsOf(c))
      if (pk.length) e.keys.unshift({ role: 'primary', parts: pk, ...at(c.line) })
      const colFor = (name) => { const f = fieldsOf(c).find((x) => x.name === name); return f ? columnOf(f) : N(name) }
      for (const u of c.uniques) e.keys.push({ role: 'unique', parts: u.columns.map(colFor), ...at(u.line) })
      for (const i of c.indexes) { if (!i.name) { note(`${c.path}:${i.line}: an @Index of ${c.name} with no name (Hibernate names it): not read`); continue } e.indexes.push({ name: N(i.name), unique: i.unique, columns: i.columns.map(colFor), partial: false, ...at(i.line) }) }
    }
    const entities = [...tables.values()]
    if (!entities.length) return { declarations: [] }
    return { declarations: [{
      store, dialect, dialectFrom: dialect ? { how: 'stated', path: schemes[0].path, line: schemes[0].line } : null,
      source: { path: sources[0].path, line: 1, kind: 'code', confidence: 'declared' },
      complete: false, partial: false, status: 'read',
      label: `JPA entities, read ${counted(sources.length, 'file')}: ${counted(entities.length, 'table')}, ${counted(relations, 'relation')}`,
      notes, files: sources.length, clients: ['jakarta.persistence', 'javax.persistence', 'org.hibernate'],
      entities,
    }] }
  },
}
