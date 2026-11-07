// grimoire graph · data · reconcile: the declarations extractors stored (per file, per unit) merged
// into one model, at query time. Declarations of one store (same repository, same folder) are
// merged element by element (model.mjs keyOf): every element keeps the source of each declaration
// that states it, most trusted first, and a conflict wherever they disagree:
//   - an attribute (a field's type, nullability, default; an index's columns; a foreign key's
//     actions) with two values: both are kept, each with its sources. Types compare lower-cased,
//     defaults without one outer pair of parentheses (model.mjs normDefault);
//   - presence: an element one complete declaration states and another, describing the same
//     entity, lacks (`absent` cites where that declaration describes the entity).
// Nothing is resolved by precedence: the disagreement is the finding. A replay that stopped early
// (`partial`) is listed with its sources but compared with nothing, since it describes the store as
// it was partway. Drizzle v1 snapshots form a DAG through prevIds: only its leaves declare a store.
//
//   reconcile([{ repo, extractor: 'id@version', facts }]) → { stores: [Store] }   (model.mjs)
import { KINDS, keyOf, normType, normDefault, kvIndex, kvTable, projectionText, KV_DIALECTS, declKey } from './model.mjs'

// What is compared, per element: a key-value table's billing and stream, a TTL's enabled, a GSI's or
// an LSI's kind, key attributes and projection, beside what a SQL element says. A key-value
// attribute's type compares as written (S, N, B).
const ATTRS = {
  entity: (e) => ({ kind: e.kind, ...(kvTable(e) ? { billing: e.billing ?? null, stream: e.stream ?? null } : {}) }),
  field: (f, kv) => ({ type: kv ? String(f.type ?? '') : normType(f.type), nullable: f.nullable, default: normDefault(f.default), generated: f.generated ?? null }),
  key: (k) => (k.role === 'ttl' ? { enabled: k.enabled ?? null } : {}),
  index: (i) => (kvIndex(i) ? { kind: i.kind, partition: i.partition.join(', '), sort: i.sort.join(', '), projection: projectionText(i) } : { unique: !!i.unique, columns: i.columns.join(', '), partial: !!i.partial }),
  relation: (r) => ({ onDelete: r.onDelete, onUpdate: r.onUpdate }),
}
const SHAPE = {
  entity: (e) => ({ name: e.name, kind: e.kind, ...(kvTable(e) ? { billing: e.billing ?? null, stream: e.stream ?? null } : {}), ...(e.nameTemplate ? { nameTemplate: e.nameTemplate } : {}) }),
  field: (f) => ({ name: f.name, type: { raw: f.type, norm: normType(f.type) }, nullable: f.nullable, default: f.default ?? null, generated: f.generated ?? null }),
  key: (k) => ({ role: k.role, parts: k.parts, ...(k.role === 'ttl' ? { enabled: k.enabled ?? null } : {}) }),
  index: (i) => (kvIndex(i) ? { name: i.name, kind: i.kind, partition: i.partition, sort: i.sort, projection: i.projection ?? null, include: i.include || [], columns: i.columns, unique: false, partial: false } : { name: i.name, unique: !!i.unique, columns: i.columns, partial: !!i.partial }),
  relation: (r) => ({ kind: 'fk', columns: r.columns, to: r.to, toColumns: r.toColumns, onDelete: r.onDelete, onUpdate: r.onUpdate }),
}
const PARTS = [['field', 'fields'], ['key', 'keys'], ['index', 'indexes'], ['relation', 'relations']]
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

export function reconcile(rows) {
  const decls = leaves(rows.flatMap((r) => (r.facts?.declarations || []).map((d) => ({ ...d, repo: r.repo, extractor: r.extractor }))))
    .sort((a, b) => KINDS.indexOf(a.source.kind) - KINDS.indexOf(b.source.kind) || (a.source.path < b.source.path ? -1 : 1))
  const stores = new Map()
  for (const d of decls) { const id = `${d.repo}:${d.store}`; if (!stores.has(id)) stores.set(id, []); stores.get(id).push(d) }
  return { stores: [...stores].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, ds]) => merge(id, ds)) }
}

function leaves(decls) {
  const parents = new Set(decls.filter((d) => d.snapshot).flatMap((d) => d.snapshot.prevIds.map((p) => `${d.repo}:${d.store}:${p}`)))
  return decls.filter((d) => !d.snapshot || !parents.has(`${d.repo}:${d.store}:${d.snapshot.id}`))
}

function merge(id, ds) {
  const compared = new Set(ds.some((d) => !d.partial) ? ds.filter((d) => !d.partial) : ds)
  const complete = ds.filter((d) => d.complete)
  const source = (d, el) => ({ repo: d.repo, path: el?.path ?? d.source.path, line: el?.line ?? d.source.line, kind: d.source.kind, extractor: d.extractor, confidence: d.source.confidence, ...(el?.as ? { as: el.as } : {}) })
  const slot = (map, key, make) => { if (!map.has(key)) map.set(key, { ...make(), sources: [], by: new Map() }); return map.get(key) }
  // an element a declaration states in two places (a Terraform table: the inputs that set it, and
  // the module's resource, its `via`) cites both, the line that states it first
  const note = (el, d, attrs, src, x) => {
    el.sources.push(src)
    if (x?.via && !(x.via.path === src.path && x.via.line === src.line)) el.sources.push({ repo: d.repo, path: x.via.path, line: x.via.line, kind: d.source.kind, extractor: d.extractor, confidence: d.source.confidence, ...(x.via.as ? { as: x.via.as } : {}) })
    el.by.set(d, { attrs, src })
  }

  const store = ds.find((d) => d.dialect) || ds[0]
  const kv = KV_DIALECTS.has(store.dialect)
  const entities = new Map()
  for (const d of ds) {
    for (const e of d.entities || []) {
      const E = slot(entities, e.name, () => ({ ...SHAPE.entity(e), fields: new Map(), keys: new Map(), indexes: new Map(), relations: new Map(), at: new Map(), whole: new Set() }))
      note(E, d, ATTRS.entity(e), source(d, e), e)
      E.at.set(d, source(d, e))
      if (e.whole) E.whole.add(d)
      for (const [type, list] of PARTS) for (const x of e[list] || []) note(slot(E[list], keyOf[type](x), () => SHAPE[type](x)), d, ATTRS[type](x, kv), source(d, x), x)
    }
  }
  // a key-value element keeps what each declaration says of it: [[declKey, attrs]] (model.mjs)
  const per = (el) => (kv ? { per: [...el.by].map(([d, { attrs }]) => [declKey(d.extractor, d.source.path), attrs]) } : {})
  const done = (el, presence, absent) => { const { by, at, whole, ...rest } = el; return { ...rest, ...per(el), conflicts: conflicts(el, compared, presence, absent) } }
  return {
    id,
    repo: ds[0].repo,
    name: ds[0].store,
    dialect: store.dialect ?? null,
    dialectFrom: store.dialectFrom ?? null,
    declarations: ds.map((d) => ({ extractor: d.extractor, kind: d.source.kind, path: d.source.path, line: d.source.line, status: d.status, label: d.label, stopped: d.stopped ?? null, error: d.error ?? null, notes: d.notes || [], files: d.files ?? null, implicitIndexes: d.implicitIndexes ?? 0, dialect: d.dialect ?? null, dialectFrom: d.dialectFrom ?? null })),
    entities: [...entities.values()].sort(byName).map((E) => {
      // the declarations that describe this entity whole: a complete one, or one stating it whole
      const covering = ds.filter((d) => E.at.has(d) && (d.complete || E.whole.has(d)))
      const out = { id: `${id}/${E.name}`, ...done(E, complete, (d) => source(d, null)) }
      for (const [, list] of PARTS) out[list] = [...E[list].values()].map((x) => done(x, covering, (d) => E.at.get(d)))
      return out
    }),
  }
}

// An entity and each of its elements, labelled as a conflict line names them.
export const elementsOf = (e) => [[e.name, e], ...e.fields.map((f) => [`${e.name}.${f.name}`, f]), ...e.keys.map((k) => [`${e.name} ${k.role} (${k.parts.join(', ')})`, k]), ...e.indexes.map((i) => [`${e.name} index ${i.name}`, i]), ...e.relations.map((r) => [`${e.name} foreign key (${r.columns.join(', ')})`, r])]

// A merged store in one line: its counts, or how it was found when nothing was read
// (graph_data and the page's Data tab say the same).
export function storeSummary(st) {
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const tables = st.entities.filter((e) => e.kind === 'table'), views = st.entities.length - tables.length
  if (!st.entities.length) { const d = st.declarations.find((x) => x.status === 'not-read'); return d ? `found, not read (${n(d.files, 'file')})` : 'no tables' }
  const conflicts = st.entities.reduce((a, e) => a + elementsOf(e).reduce((b, [, x]) => b + x.conflicts.length, 0), 0)
  if (st.dialect === 'dynamodb') {
    const k = (kind) => tables.reduce((a, e) => a + e.indexes.filter((i) => i.kind === kind).length, 0)
    return [n(tables.length, 'table'), n(k('gsi'), 'GSI'), k('lsi') && n(k('lsi'), 'LSI'), conflicts ? n(conflicts, 'conflict') : 'no conflicts'].filter(Boolean).join(' · ')
  }
  const implicit = Math.max(0, ...st.declarations.map((d) => d.implicitIndexes)) // the indexes SQLite builds for keys, beside the declared ones
  return [n(tables.length, 'table'), views && n(views, 'view'), n(tables.reduce((a, e) => a + e.relations.length, 0), 'foreign key'), `${n(tables.reduce((a, e) => a + e.indexes.length, 0), 'index', 'indexes')}${implicit ? ` (+${implicit} implicit, for keys)` : ''}`, conflicts ? n(conflicts, 'conflict') : 'no conflicts'].filter(Boolean).join(' · ')
}

// An element's conflicts. presence: the complete declarations expected to state it; absent(d): what
// to cite for a declaration that does not.
function conflicts(el, compared, presence, absent) {
  const out = []
  const seen = [...el.by].filter(([d]) => compared.has(d))
  for (const attr of Object.keys(seen[0]?.[1].attrs || {})) {
    const groups = new Map()
    for (const [, { attrs, src }] of seen) {
      const k = JSON.stringify(attrs[attr])
      if (!groups.has(k)) groups.set(k, { value: attrs[attr], sources: [] })
      groups.get(k).sources.push(src)
    }
    if (groups.size > 1) out.push({ attr, values: [...groups.values()] })
  }
  const missing = presence.filter((d) => !el.by.has(d))
  if (missing.length && presence.some((d) => el.by.has(d))) out.push({ attr: 'presence', values: [{ value: 'declared', sources: el.sources }, { value: 'absent', sources: missing.map(absent) }] })
  return out
}
