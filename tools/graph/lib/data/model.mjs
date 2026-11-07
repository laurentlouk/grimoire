// grimoire graph · data · the data model map's model (spec D2): what an extractor declares, and the
// keyed, sourced model reconcile.mjs merges the declarations into.
//
// An extractor's facts are { declarations: [Declaration] }, one per store it read:
//   Declaration { store: its folder, repo-relative ('.' at the root) · dialect · dialectFrom: how
//                 the dialect is known, { how: stated | sniffed | supabase | override, path?, line?,
//                 marker? } · source: { path, line, kind, confidence } · complete: it describes the
//                 whole store (an element it lacks is a disagreement) · partial: a replay stopped
//                 early · status: read | partial | not-read · label · stopped?: { path, line } ·
//                 error · notes[] · files · snapshot?: { id, prevIds } (Drizzle v1) · entities[] }
//   Entity      { name, kind: table | view, path, line, fields[], keys[], indexes[], relations[] }
//   Field       { name (a dotted path when nested), type: as declared, nullable: true | false,
//                 default: as declared or null, generated: virtual | stored | null, path, line }
//   Key         { role: primary | unique, parts: [field] }   compared as a whole, never per column
//   Index       { name, unique, columns, partial }
//   Relation    { columns, to, toColumns, onDelete, onUpdate } (a foreign key)
// An element's path defaults to its declaration's source path.
//
// A key-value table (DynamoDB: readers/dynamodb.mjs; the store `dynamodb`, dialect `dynamodb`) says
// more, in the same elements:
//   Entity      + billing: PAY_PER_REQUEST | PROVISIONED | null, stream: its view type or null,
//                 whole: the declaration states the table whole (no part of it is a reference, so a
//                 part it lacks is a disagreement), as?: how the declaration names it (a template's
//                 logical id and type, its name expression)
//   Field       an attribute AttributeDefinitions types (S, N, B), not null when it keys the table
//   Key         { role: partition | sort, parts: up to four attributes } · { role: ttl, parts: [attr],
//                 enabled: true | false | null (not said) }
//   Index       { name, kind: gsi | lsi, partition: [attr], sort: [attr], projection: ALL | KEYS_ONLY |
//                 INCLUDE | null, include: [attr] (INCLUDE's), columns: partition then sort, unique:
//                 false, partial: false }
// A declaration that describes no store whole (complete: false) still describes each table it
// states whole: its `whole` entities take part in presence conflicts.
// A Terraform table (extractors/terraform.mjs) says two things more: an element may carry `via`
// { path, line, as? }, a second place that declares it (the module's resource, beside the inputs
// line that sets it), cited as a second source; an entity whose name has an unknown part is named
// by its template and carries it, `nameTemplate` ({env}-{project}-orders: each {…} an unknown part,
// the literal parts as written), for binding to the names code builds (binding.mjs). A declaration may
// say which environment variables the infra sets to its tables, `env` [{ name, table, path, line }]
// (a Terraform function's environment, a template function's Environment.Variables). A code file's
// facts (readers/code.mjs) hold no declaration: { declarations: [], code }. A value the evaluator could
// not know stays as `${expression}`, and its table is not `whole`.
//
// The merged model: Store { id: '<repo>:<folder>', repo, name, dialect, declarations, entities }, and
// every element { …its attributes, sources[], conflicts[] }, a source being { repo, path, line, kind:
// artifact | migration | infra | code | inferred, extractor: 'id@version', confidence }. Where the
// declarations of a store disagree, the element keeps a conflict { attr, values: [{ value, sources }] }
// with every side: never resolved by precedence (the disagreement is the finding).

import { blank } from './readers/sql-split.mjs'

// Trust, highest first: the order sources are listed in.
export const KINDS = ['artifact', 'migration', 'infra', 'code', 'inferred']

// A type as compared: lower-cased, blanks collapsed, none before a parenthesis or around a comma
// (`timestamp (3)` and `timestamp(3)`, `numeric(10, 2)` and `numeric(10,2)`: two versions of one tool
// write them so). In a Postgres or MySQL store, the names the engine holds for one type compare as
// one (a dump writes the engine's names, a migration or a schema the ones its author chose):
//   postgres  int, int4 → integer · int8 → bigint · int2 → smallint · serial4, serial8, serial2 →
//             serial, bigserial, smallserial · float8 → double precision · float4 → real · bool →
//             boolean · decimal → numeric, numeric(p) → numeric(p,0) · character varying → varchar ·
//             character, bpchar → char, char → char(1) ·
//             timestamptz(p) → timestamp(p) with time zone · timetz → time with time zone · `without
//             time zone` dropped · varbit → bit varying · `ARRAY` and `[n]` → `[]`
//   mysql     integer → int · bool, boolean → tinyint(1) · an integer's display width dropped (but
//             tinyint(1)) · dec, numeric, fixed → decimal, `decimal` → decimal(10,0) · double precision,
//             real → double · character varying → varchar · character → char · char, binary →
//             char(1), binary(1) · `signed` dropped
export function normType(raw, dialect = null) {
  const t = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/ ?\( ?/g, '(').replace(/ ?, ?/g, ',')
  return dialect === 'postgres' ? pgType(t) : dialect === 'mysql' ? myType(t) : t
}
const PG_TYPES = { int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint', serial4: 'serial', serial8: 'bigserial', serial2: 'smallserial', float8: 'double precision', float4: 'real', bool: 'boolean', decimal: 'numeric', 'character varying': 'varchar', 'char varying': 'varchar', character: 'char', bpchar: 'char', timestamptz: 'timestamp with time zone', timetz: 'time with time zone', varbit: 'bit varying' }
function pgType(t) {
  let dims = 0
  t = t.replace(/(?:\[\d*\])+$/, (m) => { dims = m.split('[').length - 1; return '' }).replace(/ array$/, () => { dims ||= 1; return '' })
  const m = /^([a-z_][a-z0-9_ ]*?)(\([0-9,]*\))?( with(?:out)? time zone)?$/.exec(t)
  if (m) {
    let [, name, args = '', tz = ''] = m
    name = PG_TYPES[name] ?? name
    if (/^time(?:stamp)? with time zone$/.test(name)) { tz = ' with time zone'; name = name.split(' ')[0] }
    if (name === 'numeric' && /^\(\d+\)$/.test(args)) args = args.replace(')', ',0)') // numeric(5) is numeric(5,0)
    if (name === 'char' && !args) args = '(1)' // char is char(1)
    t = `${name}${args}${tz === ' without time zone' ? '' : tz}`
  }
  return t + '[]'.repeat(dims)
}
const MY_TYPES = { integer: 'int', bool: 'tinyint(1)', boolean: 'tinyint(1)', dec: 'decimal', numeric: 'decimal', fixed: 'decimal', 'double precision': 'double', real: 'double', 'character varying': 'varchar', character: 'char' }
function myType(t) {
  const m = /^([a-z_][a-z0-9_ ]*?)(\([0-9,]*\))?((?: unsigned| signed| zerofill)*)$/.exec(t)
  if (!m) return t
  let [, name, args = '', mods] = m
  const alias = MY_TYPES[name]
  if (alias) { const a = /^(\w+)(\(.*\))?$/.exec(alias); name = a[1]; args ||= a[2] || '' }
  if (/^(?:tiny|small|medium|big)?int$/.test(name) && args && !(name === 'tinyint' && args === '(1)')) args = ''
  if (name === 'decimal') args = !args ? '(10,0)' : /^\(\d+\)$/.test(args) ? args.replace(')', ',0)') : args
  if ((name === 'char' || name === 'binary') && !args) args = '(1)'
  return `${name}${args}${mods.replace(/ signed/g, '')}`
}

// A default as compared (shown as declared): SQLite reports `DEFAULT (unixepoch())` as
// `unixepoch()`, while a snapshot keeps the text as written, so one balanced outer pair of
// parentheses is set aside (`(1) + (2)` is no outer pair and stays whole). In a Postgres or MySQL
// store, `NULL` is no default, a quoted number compares as the number (a dump quotes `'-1'`, `'0'`),
// a Postgres literal as itself without the casts the engine adds (`'member'::public.role`,
// `'{}'::integer[]`), and MySQL's true and false as 1 and 0.
export function normDefault(raw, dialect = null) {
  if (raw === null || raw === undefined) return null
  let s = outer(String(raw).trim())
  if (dialect !== 'postgres' && dialect !== 'mysql') return s
  if (/^null(?:::[^:']+)*$/i.test(s)) return null
  if (dialect === 'postgres') { const m = /^('(?:[^']|'')*')(?:::[^:']+)+$/.exec(s); if (m) s = m[1] }
  const n = /^'(-?\d+(?:\.\d+)?)'$/.exec(s)
  if (n) s = n[1]
  if (dialect === 'mysql') s = /^true$/i.test(s) ? '1' : /^false$/i.test(s) ? '0' : s
  return s
}
function outer(s) {
  if (s[0] !== '(' || s[s.length - 1] !== ')') return s
  const code = blank(s) // parentheses inside a string literal do not count
  for (let i = 0, depth = 0; i < code.length - 1; i++) {
    if (code[i] === '(') depth++
    else if (code[i] === ')' && --depth === 0) return s // the first pair closes before the end
  }
  return s.slice(1, -1).trim()
}

const DIALECTS = { sqlite: 'sqlite', turso: 'sqlite', libsql: 'sqlite', d1: 'sqlite', postgres: 'postgres', postgresql: 'postgres', pg: 'postgres', mysql: 'mysql', mysql2: 'mysql', mariadb: 'mysql' }
export const normDialect = (d) => (d ? DIALECTS[String(d).toLowerCase()] || String(d).toLowerCase() : null)

// A key-value index (a GSI or an LSI), and its projection as compared and shown: `INCLUDE (a, b)`
// names the attributes it includes, in order.
export const kvIndex = (i) => i.kind === 'gsi' || i.kind === 'lsi'
export const projectionText = (i) => (i.projection === 'INCLUDE' && i.include?.length ? `INCLUDE (${[...i.include].sort().join(', ')})` : i.projection ?? null)
// A key-value table: it states its billing and stream (each null or not).
export const kvTable = (e) => 'stream' in e
// Stores whose declarations are files of equal standing (a local-dev table file, a template): each
// element keeps what every declaration says of it (`per`, reconcile.mjs), and the diff and the delta
// states compare each declaration, not only the first (diff.mjs, delta.mjs).
export const KV_DIALECTS = new Set(['dynamodb'])
// A declaration as `per` names it: its extractor and its file (key-value extractors read one file each).
export const declKey = (extractor, path) => `${extractor}|${path}`
export const declPath = (key) => key.slice(key.indexOf('|') + 1)

// Element keys within their entity (and the ids the change view will address: <store>/<entity>.<field>).
export const keyOf = {
  field: (f) => f.name,
  key: (k) => `${k.role}(${k.parts.join(',')})`,
  index: (i) => i.name,
  relation: (r) => `(${r.columns.join(',')})->${r.to}(${r.toColumns.join(',')})`,
}

// The line of a regular expression's first match in a text, or null.
export function lineOf(text, re) {
  const m = re.exec(text)
  return m ? text.slice(0, m.index).split('\n').length : null
}
