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

export const normType = (raw) => String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// A default as compared (shown as declared): SQLite reports `DEFAULT (unixepoch())` as
// `unixepoch()`, while a snapshot keeps the text as written, so one balanced outer pair of
// parentheses is set aside (`(1) + (2)` is no outer pair and stays whole).
export function normDefault(raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
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
