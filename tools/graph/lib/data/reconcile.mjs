// grimoire graph · data · reconcile: the declarations extractors stored (per file, per unit) merged
// into one model, at query time. Declarations of one store (same repository, same folder) are
// merged element by element (model.mjs keyOf): every element keeps the source of each declaration
// that states it, most trusted first, and a conflict wherever they disagree:
//   - an attribute (a field's type, nullability, default; an index's columns; a foreign key's
//     actions) with two values: both are kept, each with its sources. Types compare lower-cased (and
//     a Postgres or MySQL type by the engine's name for it, model.mjs normType), defaults without one
//     outer pair of parentheses (model.mjs normDefault); in a MySQL store a unique index is the
//     unique key it is (uniqueKeys);
//   - presence: an element one complete declaration states and another, describing the same
//     entity, lacks (`absent` cites where that declaration describes the entity).
// Nothing is resolved by precedence: the disagreement is the finding. A replay that stopped early
// (`partial`) is listed with its sources but compared with nothing, since it describes the store as
// it was partway. Drizzle v1 snapshots form a DAG through prevIds: only its leaves declare a store.
//
// Then, over every store at once (items below, binding.mjs): the key-value tables declared in several
// places grouped into logical tables (their disagreements across declarations its conflicts), and the
// item types code converts bound to them, their fields on the tables; then the access patterns
// (access.mjs): the key-value calls code makes, resolved to those tables, each index with the calls
// that query it or a lead, and what a call writes that the bound item does not state.
//
//   reconcile([{ repo, extractor: 'id@version', facts }]) → { stores: [Store], logical, items,
//     bindings, unresolved, access?, accessError? }   (model.mjs, binding.mjs, access.mjs)
import { KINDS, keyOf, normType, normDefault, kvIndex, kvTable, projectionText, KV_DIALECTS, declKey } from './model.mjs'
import { logicalTables, bindItems, itemField, itemOf, tableResolver } from './binding.mjs'
import { resolveAccess } from './access.mjs'

// What is compared, per element: a key-value table's billing and stream, a TTL's enabled, a GSI's or
// an LSI's kind, key attributes and projection, beside what a SQL element says. A key-value
// attribute's type compares as written (S, N, B).
const ATTRS = {
  entity: (e) => ({ kind: e.kind, ...(kvTable(e) ? { billing: e.billing ?? null, stream: e.stream ?? null } : {}) }),
  // what a declaration cannot state in the store's terms (a code model's custom type, an expression
  // default: model.mjs `unstated`) is undefined, and compared with nothing
  field: (f, kv, dialect) => { const u = f.unstated || []; return { type: u.includes('type') ? undefined : kv ? String(f.type ?? '') : normType(f.type, dialect), nullable: u.includes('nullable') ? undefined : f.nullable, default: u.includes('default') ? undefined : normDefault(f.default, dialect), generated: f.generated ?? null } },
  key: (k) => (k.role === 'ttl' ? { enabled: k.enabled ?? null } : {}),
  index: (i) => (kvIndex(i) ? { kind: i.kind, partition: i.partition.join(', '), sort: i.sort.join(', '), projection: projectionText(i) } : { unique: !!i.unique, columns: i.columns.join(', '), partial: !!i.partial }),
  relation: (r) => ({ onDelete: r.onDelete, onUpdate: r.onUpdate }),
}
const SHAPE = {
  entity: (e) => ({ name: e.name, kind: e.kind, ...(kvTable(e) ? { billing: e.billing ?? null, stream: e.stream ?? null } : {}), ...(e.nameTemplate ? { nameTemplate: e.nameTemplate } : {}) }),
  field: (f, dialect) => ({ name: f.name, type: { raw: f.type, norm: normType(f.type, dialect) }, nullable: f.nullable, default: f.default ?? null, generated: f.generated ?? null, ...(f.unstated ? { unstated: f.unstated } : {}) }),
  key: (k) => ({ role: k.role, parts: k.parts, ...(k.role === 'ttl' ? { enabled: k.enabled ?? null } : {}) }),
  index: (i) => (kvIndex(i) ? { name: i.name, kind: i.kind, partition: i.partition, sort: i.sort, projection: i.projection ?? null, include: i.include || [], columns: i.columns, unique: false, partial: false } : { name: i.name, unique: !!i.unique, columns: i.columns, partial: !!i.partial }),
  relation: (r) => ({ kind: 'fk', columns: r.columns, to: r.to, toColumns: r.toColumns, onDelete: r.onDelete, onUpdate: r.onUpdate }),
}
const PARTS = [['field', 'fields'], ['key', 'keys'], ['index', 'indexes'], ['relation', 'relations']]

// MySQL keeps one object for a unique constraint and a unique index (a migration's `CONSTRAINT x
// UNIQUE`, a dump's `UNIQUE KEY`, a schema's unique index are the same thing), so in a MySQL store
// every unique index is compared, and shown, as the unique key it is.
function uniqueKeys(e) {
  const uniq = (e.indexes || []).filter((i) => i.unique && !i.partial && !kvIndex(i))
  if (!uniq.length) return e
  const keys = [...(e.keys || [])]
  for (const i of uniq) if (!keys.some((k) => k.role === 'unique' && k.parts.join('\0') === i.columns.join('\0'))) keys.push({ role: 'unique', parts: i.columns, path: i.path, line: i.line })
  return { ...e, keys, indexes: e.indexes.filter((i) => !uniq.includes(i)) }
}
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

export function reconcile(rows) {
  const decls = leaves(rows.flatMap((r) => (r.facts?.declarations || []).map((d) => ({ ...d, repo: r.repo, extractor: r.extractor }))))
    .sort((a, b) => KINDS.indexOf(a.source.kind) - KINDS.indexOf(b.source.kind) || (a.source.path < b.source.path ? -1 : 1))
  const stores = new Map()
  for (const d of decls) { const id = `${d.repo}:${d.store}`; if (!stores.has(id)) stores.set(id, []); stores.get(id).push(d) }
  const model = { stores: [...stores].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, ds]) => merge(id, ds)) }
  items(model, rows, decls)
  return model
}

// ── key-value tables across stores, and the item shapes bound to them (binding.mjs) ──
// model gains: logical (the groups of two declarations or more, each with its conflicts across them),
// items, bindings, unresolved; a member entity gains `logical` (its group, the conflicts across it),
// `bound` (its bindings) and its bound item types' fields (binding.mjs says how). Whatever a project's
// code holds, the stores are answered: the whole computation is planned first, without touching the
// model, and a failure in it leaves the model as merged, with `itemsError` saying why.
function items(model, rows, decls) {
  Object.assign(model, { logical: [], items: [], bindings: [], unresolved: [] })
  let p
  try { p = plan(model, rows, decls) } catch (e) { model.itemsError = `the item shapes were not bound: ${String(e?.message || e).split('\n')[0].slice(0, 200)}`; return }
  for (const [e, patch] of p.entities) Object.assign(e, patch)
  Object.assign(model, p.model)
}
function plan(model, rows, decls) {
  const kv = model.stores.filter((s) => KV_DIALECTS.has(s.dialect))
  const entities = new Map(kv.flatMap((s) => s.entities.map((e) => [e.id, e])))
  const patches = new Map() // entity → what it gains
  const patch = (e) => { if (!patches.has(e)) patches.set(e, {}); return patches.get(e) }
  const { groups, notes } = logicalTables([...entities.values()].map((e) => ({ id: e.id, name: e.name })))
  for (const [id, note] of notes) patch(entities.get(id)).logicalNote = note
  const out = { logical: [] }
  for (const g of groups.filter((x) => x.members.length > 1)) {
    const members = new Set(g.members)
    // every declaration stating a member, that member renamed to the group's name and marked, merged
    // as one table's declarations are: what they disagree on across members is the group's conflict
    const synth = decls.filter((d) => KV_DIALECTS.has(d.dialect)).flatMap((d) => {
      const es = (d.entities || []).filter((e) => members.has(`${d.repo}:${d.store}/${e.name}`))
      return es.map((e) => ({ ...d, member: `${d.repo}:${d.store}/${e.name}`, entities: [{ ...e, name: g.name }] }))
    })
    const merged = merge(g.id, synth).entities[0]
    const across = (c) => new Set(c.values.flatMap((v) => v.sources.map((s) => s.member))).size > 1
    const strip = (s) => { const { member, ...rest } = s; return rest }
    const conflicts = merged ? elementsOf(merged).flatMap(([label, x]) => x.conflicts.filter(across).map((c) => ({ label, attr: c.attr, values: c.values.map((v) => ({ value: v.value, sources: v.sources.map(strip) })) }))) : []
    const logical = { id: g.id, name: g.name, via: g.via, members: g.members, conflicts }
    out.logical.push(logical)
    for (const m of g.members) patch(entities.get(m)).logical = logical
  }
  // what the infra sets each environment variable to (a function's environment naming a table)
  const wiring = decls.flatMap((d) => (d.env || []).map((w) => ({ name: w.name, entity: `${d.repo}:${d.store}/${w.table}`, repo: d.repo, path: w.path, line: w.line }))).filter((w) => entities.has(w.entity))
  const code = rows.filter((r) => r.facts?.code).map((r) => ({ repo: r.repo, extractor: r.extractor, code: r.facts.code }))
  // the access patterns' files: those holding a call, and those holding only constants a call may name
  const access = rows.filter((r) => r.facts?.access).map((r) => ({ repo: r.repo, extractor: r.extractor, access: r.facts.access }))
  // one resolver for the binding and the access patterns: the constants of the files either reads
  const R = tableResolver([...code, ...access.map((r) => ({ repo: r.repo, code: { lang: r.access.lang, path: r.access.path, consts: r.access.consts } }))], groups, entities, wiring)
  const b = bindItems(code, groups, entities, wiring, R)
  Object.assign(out, { items: b.items, bindings: b.bindings, unresolved: b.unresolved })
  const byId = new Map(b.items.map((it) => [it.id, it]))
  const indexes = new Map() // entity → its fields by name
  for (const bd of b.bindings) {
    for (const id of bd.entities) {
      const e = entities.get(id), pe = patch(e)
      ;(pe.bound ||= []).push(bd)
      if (bd.confidence === 'ambiguous') continue
      // the item's fields on the table: one element per stored path, the attribute definition's when
      // the infra types it too (a copy: the model is touched only once all is planned)
      const fields = (pe.fields ||= e.fields.slice())
      const index = (indexes.has(e) ? indexes : indexes.set(e, new Map(fields.map((x, i) => [x.name, i])))).get(e)
      const it = byId.get(bd.item)
      for (const f of it.fields) {
        const at = index.has(f.path) ? index.get(f.path) : -1
        if (at < 0) { index.set(f.path, fields.length); fields.push(itemField(f, bd, it.extractor)); continue }
        const have = fields[at]
        if ((have.item || []).some((x) => x.type === bd.type)) continue
        fields[at] = { ...have, item: [...(have.item || []), itemOf(f, bd)], sources: [...have.sources, { repo: f.repo, path: f.file, line: f.line, kind: 'code', extractor: it.extractor, confidence: bd.confidence }] }
      }
    }
  }
  // the access patterns (access.mjs), against the tables and their item shapes as bound: a failure
  // there leaves the binding as it is, and says why
  if (access.some((r) => r.access.sites?.length)) {
    try {
      const a = resolveAccess(access, { groups, entities, R, fieldsOf: (e) => patches.get(e)?.fields || e.fields, boundOf: (e) => patches.get(e)?.bound || [], items: b.items })
      for (const [id, x] of a.entities) patch(entities.get(id)).access = x
      out.access = a.model
    } catch (e) { out.accessError = `the access patterns were not resolved: ${String(e?.message || e).split('\n')[0].slice(0, 200)}` }
  }
  return { entities: patches, model: out }
}

function leaves(decls) {
  const parents = new Set(decls.filter((d) => d.snapshot).flatMap((d) => d.snapshot.prevIds.map((p) => `${d.repo}:${d.store}:${p}`)))
  return decls.filter((d) => !d.snapshot || !parents.has(`${d.repo}:${d.store}:${d.snapshot.id}`))
}

function merge(id, ds) {
  const compared = new Set(ds.some((d) => !d.partial) ? ds.filter((d) => !d.partial) : ds)
  const complete = ds.filter((d) => d.complete)
  const source = (d, el) => ({ repo: d.repo, path: el?.path ?? d.source.path, line: el?.line ?? d.source.line, kind: d.source.kind, extractor: d.extractor, confidence: d.source.confidence, ...(el?.as ? { as: el.as } : {}), ...(d.member ? { member: d.member } : {}) })
  const slot = (map, key, make) => { if (!map.has(key)) map.set(key, { ...make(), sources: [], by: new Map() }); return map.get(key) }
  // an element a declaration states in two places (a Terraform table: the inputs that set it, and
  // the module's resource, its `via`) cites both, the line that states it first
  const note = (el, d, attrs, src, x) => {
    el.sources.push(src)
    if (x?.via && !(x.via.path === src.path && x.via.line === src.line)) el.sources.push({ repo: d.repo, path: x.via.path, line: x.via.line, kind: d.source.kind, extractor: d.extractor, confidence: d.source.confidence, ...(x.via.as ? { as: x.via.as } : {}), ...(d.member ? { member: d.member } : {}) })
    el.by.set(d, { attrs, src })
  }

  const store = ds.find((d) => d.dialect) || ds[0]
  const kv = KV_DIALECTS.has(store.dialect)
  const entities = new Map()
  for (const d of ds) {
    for (const e0 of d.entities || []) {
      const e = store.dialect === 'mysql' ? uniqueKeys(e0) : e0
      const E = slot(entities, e.name, () => ({ ...SHAPE.entity(e), fields: new Map(), keys: new Map(), indexes: new Map(), relations: new Map(), at: new Map(), whole: new Set(), part: new Set() }))
      note(E, d, ATTRS.entity(e), source(d, e), e)
      E.at.set(d, source(d, e))
      if (e.whole) E.whole.add(d)
      if (e.part) E.part.add(d) // it states the entity, not all of its parts
      for (const [type, list] of PARTS) {
        for (const x of e[list] || []) {
          const el = slot(E[list], keyOf[type](x), () => SHAPE[type](x, store.dialect))
          note(el, d, ATTRS[type](x, kv, store.dialect), source(d, x), x)
          // what a code model alone says of a column: the default its client computes, its enum
          if (type === 'field') { if (x.computed && !el.computed) el.computed = x.computed; if (x.enum && !el.enum) el.enum = x.enum }
        }
      }
    }
  }
  // the enums the declarations state (a code model's), by name, each with its sources
  const enums = new Map()
  for (const d of ds) {
    for (const x of d.enums || []) {
      if (!enums.has(x.name)) enums.set(x.name, { name: x.name, values: x.values, sources: [] })
      enums.get(x.name).sources.push(source(d, x))
    }
  }
  // a key-value element keeps what each declaration says of it: [[declKey, attrs]] (model.mjs)
  const per = (el) => (kv ? { per: [...el.by].map(([d, { attrs }]) => [declKey(d.extractor, d.source.path), attrs]) } : {})
  const done = (el, presence, absent) => { const { by, at, whole, part, ...rest } = el; return { ...rest, ...per(el), conflicts: conflicts(el, compared, presence, absent) } }
  return {
    id,
    repo: ds[0].repo,
    name: ds[0].store,
    dialect: store.dialect ?? null,
    dialectFrom: store.dialectFrom ?? null,
    declarations: ds.map((d) => ({ extractor: d.extractor, kind: d.source.kind, path: d.source.path, line: d.source.line, status: d.status, label: d.label, stopped: d.stopped ?? null, error: d.error ?? null, notes: d.notes || [], files: d.files ?? null, implicitIndexes: d.implicitIndexes ?? 0, dialect: d.dialect ?? null, dialectFrom: d.dialectFrom ?? null })),
    ...(enums.size ? { enums: [...enums.values()].sort(byName) } : {}),
    entities: [...entities.values()].sort(byName).map((E) => {
      // the declarations that describe this entity whole: a complete one, or one stating it whole,
      // unless it states the entity in part
      const covering = ds.filter((d) => E.at.has(d) && (d.complete || E.whole.has(d)) && !E.part.has(d))
      const out = { id: `${id}/${E.name}`, ...done(E, complete, (d) => source(d, null)) }
      for (const [, list] of PARTS) out[list] = [...E[list].values()].map((x) => done(x, covering, (d) => E.at.get(d)))
      return out
    }),
  }
}

// A conflict setting a code model (a TypeScript schema, a schema-language file) against the migrations
// or a snapshot of its store: the schema was edited and no migration generated (or a migration was
// edited by hand). The conflict is the finding; this only names it.
const GENERATED = new Set(['migration', 'artifact'])
export const schemaDrift = (c) => c.values.some((v) => v.sources.length && v.sources.every((s) => s.kind === 'code')) && c.values.some((v) => v.sources.some((s) => GENERATED.has(s.kind)))
export const SCHEMA_DRIFT = 'the code model and the migrations or snapshot disagree: a schema edited and no migration generated, or a migration edited by hand'

// An entity and each of its elements, labelled as a conflict line names them.
export const elementsOf = (e) => [[e.name, e], ...e.fields.map((f) => [`${e.name}.${f.name}`, f]), ...e.keys.map((k) => [`${e.name} ${k.role} (${k.parts.join(', ')})`, k]), ...e.indexes.map((i) => [`${e.name} index ${i.name}`, i]), ...e.relations.map((r) => [`${e.name} foreign key (${r.columns.join(', ')})`, r])]

// A merged store in one line: its counts, or how it was found when nothing was read
// (graph_data and the page's Data tab say the same).
export function storeSummary(st) {
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const tables = st.entities.filter((e) => e.kind === 'table'), views = st.entities.length - tables.length
  if (!st.entities.length) { const d = st.declarations.find((x) => x.status === 'not-read'); return d ? `found, not read (${n(d.files, 'file')})` : 'no tables' }
  // the conflicts of its elements, and those across the declarations of a logical table it holds a
  // member of (binding.mjs), counted once
  const groups = new Map(st.entities.filter((e) => e.logical).map((e) => [e.logical.id, e.logical]))
  // and what a call writes that the item bound to its table does not state (access.mjs: inferred)
  const conflicts = st.entities.reduce((a, e) => a + elementsOf(e).reduce((b, [, x]) => b + x.conflicts.length, 0) + (e.access ? e.access.conflicts.length + (e.access.moreConflicts || 0) : 0), 0) + [...groups.values()].reduce((a, g) => a + g.conflicts.length, 0)
  if (st.dialect === 'dynamodb') {
    const k = (kind) => tables.reduce((a, e) => a + e.indexes.filter((i) => i.kind === kind).length, 0)
    const items = new Set(tables.flatMap((e) => (e.bound || []).map((b) => b.item))).size
    return [n(tables.length, 'table'), n(k('gsi'), 'GSI'), k('lsi') && n(k('lsi'), 'LSI'), items && `${n(items, 'item type')} bound`, conflicts ? n(conflicts, 'conflict') : 'no conflicts'].filter(Boolean).join(' · ')
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
      if (attrs[attr] === undefined) continue // a declaration that does not state it
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
