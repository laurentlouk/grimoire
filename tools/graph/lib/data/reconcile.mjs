// grimoire graph · data · reconcile: the declarations extractors stored (per file, per unit) merged
// into one model, at query time. Declarations of one store (same repository, same folder) are
// merged element by element (model.mjs keyOf): every element keeps the source of each declaration
// that states it, most trusted first, and a conflict wherever they disagree:
//   - an attribute (a field's type, nullability, default; an index's columns; a foreign key's
//     actions) with two values: both are kept, each with its sources;
//   - presence: an element one complete declaration states and another, describing the same
//     entity, lacks (`absent` cites where that declaration describes the entity).
// Nothing is resolved by precedence: the disagreement is the finding. A replay that stopped early
// (`partial`) is listed with its sources but compared with nothing, since it describes the store as
// it was partway. Drizzle v1 snapshots form a DAG through prevIds: only its leaves declare a store.
//
//   reconcile([{ repo, extractor: 'id@version', facts }]) → { stores: [Store] }   (model.mjs)
import { KINDS, keyOf, normType } from './model.mjs'

const ATTRS = {
  entity: (e) => ({ kind: e.kind }),
  field: (f) => ({ type: normType(f.type), nullable: f.nullable, default: f.default ?? null, generated: f.generated ?? null }),
  key: () => ({}),
  index: (i) => ({ unique: !!i.unique, columns: i.columns.join(', '), partial: !!i.partial }),
  relation: (r) => ({ onDelete: r.onDelete, onUpdate: r.onUpdate }),
}
const SHAPE = {
  field: (f) => ({ name: f.name, type: { raw: f.type, norm: normType(f.type) }, nullable: f.nullable, default: f.default ?? null, generated: f.generated ?? null }),
  key: (k) => ({ role: k.role, parts: k.parts }),
  index: (i) => ({ name: i.name, unique: !!i.unique, columns: i.columns, partial: !!i.partial }),
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
  const source = (d, el) => ({ repo: d.repo, path: el?.path ?? d.source.path, line: el?.line ?? d.source.line, kind: d.source.kind, extractor: d.extractor, confidence: d.source.confidence })
  const slot = (map, key, make) => { if (!map.has(key)) map.set(key, { ...make(), sources: [], by: new Map() }); return map.get(key) }
  const note = (el, d, attrs, src) => { el.sources.push(src); el.by.set(d, { attrs, src }) }

  const entities = new Map()
  for (const d of ds) {
    for (const e of d.entities || []) {
      const E = slot(entities, e.name, () => ({ name: e.name, kind: e.kind, fields: new Map(), keys: new Map(), indexes: new Map(), relations: new Map(), at: new Map() }))
      note(E, d, ATTRS.entity(e), source(d, e))
      E.at.set(d, source(d, e))
      for (const [type, list] of PARTS) for (const x of e[list] || []) note(slot(E[list], keyOf[type](x), () => SHAPE[type](x)), d, ATTRS[type](x), source(d, x))
    }
  }
  const done = (el, presence, absent) => { const { by, at, ...rest } = el; return { ...rest, conflicts: conflicts(el, compared, presence, absent) } }
  const store = ds.find((d) => d.dialect) || ds[0]
  return {
    id,
    repo: ds[0].repo,
    name: ds[0].store,
    dialect: store.dialect ?? null,
    dialectFrom: store.dialectFrom ?? null,
    declarations: ds.map((d) => ({ extractor: d.extractor, kind: d.source.kind, path: d.source.path, line: d.source.line, status: d.status, label: d.label, stopped: d.stopped ?? null, error: d.error ?? null, notes: d.notes || [], files: d.files ?? null, dialect: d.dialect ?? null, dialectFrom: d.dialectFrom ?? null })),
    entities: [...entities.values()].sort(byName).map((E) => {
      const covering = complete.filter((d) => E.at.has(d)) // complete declarations that describe this entity
      const out = { id: `${id}/${E.name}`, ...done(E, complete, (d) => source(d, null)) }
      for (const [, list] of PARTS) out[list] = [...E[list].values()].map((x) => done(x, covering, (d) => E.at.get(d)))
      return out
    }),
  }
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
