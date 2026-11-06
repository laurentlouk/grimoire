// grimoire graph · data · the data model map's model (spec D2): what an extractor declares, and the
// keyed, sourced model reconcile.mjs merges the declarations into.
//
// An extractor's facts are { declarations: [Declaration] }, one per store it read:
//   Declaration { store: its folder, repo-relative ('.' at the root) · dialect · dialectFrom: where
//                 the dialect was stated or seen · source: { path, line, kind, confidence } ·
//                 complete: it describes the whole store (an element it lacks is a disagreement) ·
//                 partial: a replay stopped early · status: read | partial | not-read · label ·
//                 error · notes[] · files · snapshot?: { id, prevIds } (Drizzle v1) · entities[] }
//   Entity      { name, kind: table | view, path, line, fields[], keys[], indexes[], relations[] }
//   Field       { name (a dotted path when nested), type: as declared, nullable: true | false,
//                 default: as declared or null, generated: virtual | stored | null, path, line }
//   Key         { role: primary | unique, parts: [field] }   compared as a whole, never per column
//   Index       { name, unique, columns, partial }
//   Relation    { columns, to, toColumns, onDelete, onUpdate } (a foreign key)
// An element's path defaults to its declaration's source path.
//
// The merged model: Store { id: '<repo>:<folder>', repo, name, dialect, declarations, entities }, and
// every element { …its attributes, sources[], conflicts[] }, a source being { repo, path, line, kind:
// artifact | migration | infra | code | inferred, extractor: 'id@version', confidence }. Where the
// declarations of a store disagree, the element keeps a conflict { attr, values: [{ value, sources }] }
// with every side: never resolved by precedence (the disagreement is the finding).

// Trust, highest first: the order sources are listed in.
export const KINDS = ['artifact', 'migration', 'infra', 'code', 'inferred']

export const normType = (raw) => String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const DIALECTS = { sqlite: 'sqlite', turso: 'sqlite', libsql: 'sqlite', d1: 'sqlite', postgres: 'postgres', postgresql: 'postgres', pg: 'postgres', mysql: 'mysql', mysql2: 'mysql', mariadb: 'mysql' }
export const normDialect = (d) => (d ? DIALECTS[String(d).toLowerCase()] || String(d).toLowerCase() : null)

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
