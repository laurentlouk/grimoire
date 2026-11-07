// grimoire graph · data · the model diff (spec D6, Liam's element-level approach): two reconciled
// models (reconcile.mjs), compared store by store and element by element (entities, then their
// fields, keys, indexes and foreign keys). Every element comes out added, removed or modified, the
// last with the before and after of each attribute that changed. The elements of an added or a
// removed entity are not listed one by one: the entity is the change.
//
// Compared through the same normalisation reconcile uses, so a change of formatting is no change:
//   - names in any letter case where the dialect's are (SQLite: tables, columns, indexes, a foreign
//     key's target);
//   - types lower-cased and blank-collapsed, a Postgres or MySQL type by the engine's name for it
//     (model.mjs normType), defaults without one outer pair of parentheses and in the dialect's
//     terms (normDefault);
//   - a key by its role and its columns, as a whole (a key whose columns change is another key).
// An element whose declarations disagree (a reconcile conflict) is compared by its merged value, the
// most trusted declaration's. In a key-value store (model.mjs KV_DIALECTS: its declarations are files
// of equal standing, a local-dev table file and a template) each declaration is compared on its own
// (`per`): an attribute is modified when any declaration that states the element on both sides
// says another value, one change when they all moved alike, else one per declaration, `in` naming
// its file; a declaration stating it on one side only changes where it is `declared in` (a file that
// left pairs with one that came, so a change made while the file moved is still seen: changedPer). A key-value
// element's identity is the SQL one: a table and a GSI or an LSI by name, a key by its role and its
// attributes (partition, sort, ttl), an attribute by name; a table's billing and stream, a TTL's
// enabled, an index's kind, keys and projection are its attributes.
//
// A key-value table's item fields (data/binding.mjs: the fields of the item types bound to it, at
// their dotted paths) are its fields like the attributes it declares: added, removed, and modified in
// `item`, what each bound type stores there (its type as written, nullable, default).
//
// Rename candidates: a removed and an added element of the same kind and the same shape are paired,
// never decided (drizzle-kit asks; this only flags). Shapes: a table or view, its columns (names and
// types, in order; one with no column is never a candidate); a column, its type and position; an
// index, its columns, uniqueness and partiality; a foreign key, its columns on both sides. Keys have
// no name to change. When several removed and several added elements share a shape, they are one
// candidate group listing them all (ambiguous), never a guess at which goes with which.
//
//   diffModels(before, after) → { stores: [StoreDiff], counts: { stores, added, removed, modified, renames } }
//   StoreDiff  { id, repo, name, dialect, change: added | removed | modified, attrs: [Attr],
//                before: Store | null, after: Store | null, changes: [Change], renames: [Rename] }
//              (only stores with a change are listed)
//   Change     { kind: entity | field | key | index | relation, change: added | removed | modified,
//                entity: the entity's name (as the branch names it, else the base), name: the
//                element's, key: its identity, pos: { before, after } (its index in its list on each
//                side, null where absent), owner: { before, after } (its entity's index in the
//                store's entities on each side; null for an entity), before: element | null,
//                after: element | null, attrs: [Attr], rename: index into renames | null }
//   Attr       { attr, before, after, in? }   (values as declared; in: the file of the one key-value
//              declaration that changed it)
//   Rename     { kind, entity: null for entities, shape: 'same columns' | 'same type and position',
//                from: [index into changes], to: [index into changes], ambiguous }
import { normType, normDefault, normColumn, kvIndex, kvTable, projectionText, declPath } from './model.mjs'

// Dialects whose identifiers compare in any letter case.
const CASELESS = new Set(['sqlite'])
// How a dialect's names compare: lower-cased where they are caseless, as written elsewhere.
export const foldOf = (dialect) => (CASELESS.has(dialect) ? (x) => String(x).toLowerCase() : (x) => String(x))
const LISTS = [['field', 'fields'], ['key', 'keys'], ['index', 'indexes'], ['relation', 'relations']]

// An element's identity within its entity (an entity's within its store), names folded by `f`:
// what the diff matches on, and what a delta's target resolves to (delta.mjs).
export const KEY = {
  entity: (e, f) => f(e.name),
  field: (x, f) => f(x.name),
  key: (k, f) => `${k.role}(${k.parts.map(f).join(',')})`,
  index: (i, f) => f(i.name),
  relation: (r, f) => `(${r.columns.map(f).join(',')})->${f(r.to)}(${r.toColumns.map(f).join(',')})`,
}
export const NAME = {
  entity: (e) => e.name,
  field: (x) => x.name,
  key: (k) => `${k.role} (${k.parts.join(', ')})`,
  index: (i) => i.name,
  relation: (r) => `(${r.columns.join(', ')}) → ${r.to} (${r.toColumns.join(', ')})`,
}
// [compared, shown] per attribute
const typeOf = (x) => x.type?.raw ?? x.type
// (a key-value table's billing and stream, a TTL's enabled, a GSI's or an LSI's kind, key attributes
// and projection, as reconcile.mjs compares them)
const same = (v) => [v ?? null, v ?? null]
const ATTRS = {
  entity: (e) => ({ kind: [e.kind, e.kind], ...(kvTable(e) ? { billing: same(e.billing), stream: same(e.stream) } : {}) }),
  field: (x, f) => ({ type: [normType(typeOf(x), f?.dialect), typeOf(x)], nullable: [x.nullable, x.nullable], default: [normDefault(x.default, f?.dialect), x.default ?? null], generated: [x.generated ?? null, x.generated ?? null] }),
  key: (k) => (k.role === 'ttl' ? { enabled: same(k.enabled) } : {}),
  index: (i, f) => (kvIndex(i) ? { kind: same(i.kind), partition: [i.partition.join(','), i.partition.join(', ')], sort: [i.sort.join(','), i.sort.join(', ')], projection: same(projectionText(i)) }
    : { unique: [!!i.unique, !!i.unique], columns: [i.columns.map((c) => f(normColumn(c, f.dialect))).join(','), i.columns.join(', ')], partial: [!!i.partial, !!i.partial] }),
  relation: (r) => ({ onDelete: [r.onDelete, r.onDelete], onUpdate: [r.onUpdate, r.onUpdate] }),
}
const SHAPE = {
  entity: (e, f) => (e.fields?.length ? [`${e.kind}|${e.fields.map((x) => `${f(x.name)} ${normType(typeOf(x), f.dialect)}`).join(',')}`, 'same columns'] : null),
  field: (x, f, pos) => [`${normType(typeOf(x), f.dialect)}|${pos}`, 'same type and position'],
  key: () => null,
  index: (i, f) => (kvIndex(i) ? [`${i.kind}|${i.partition.join(',')}|${i.sort.join(',')}|${projectionText(i)}`, 'same keys and projection'] : [`${!!i.unique}|${i.columns.map((c) => f(normColumn(c, f.dialect))).join(',')}|${!!i.partial}`, 'same columns']),
  relation: (r, f) => [`${r.columns.map(f).join(',')}|${r.toColumns.map(f).join(',')}`, 'same columns'],
}

// A store deduced from the queries in code (queries.mjs, inferred) is never compared: a base reads no
// query (data/base.mjs), and the diff is between declarations.
export function diffModels(before, after) {
  const B = new Map((before?.stores || []).filter((s) => !s.inferred).map((s) => [s.id, s]))
  const A = new Map((after?.stores || []).filter((s) => !s.inferred).map((s) => [s.id, s]))
  const stores = [...new Set([...B.keys(), ...A.keys()])].sort().map((id) => diffStore(B.get(id) || null, A.get(id) || null)).filter(Boolean)
  const n = (c) => stores.reduce((a, s) => a + s.changes.filter((x) => x.change === c).length, 0)
  return { stores, counts: { stores: stores.length, added: n('added'), removed: n('removed'), modified: n('modified'), renames: stores.reduce((a, s) => a + s.renames.length, 0) } }
}

function diffStore(b, a) {
  const s = a || b
  const dialect = a?.dialect ?? b?.dialect ?? null
  const fold = Object.assign(foldOf(dialect), { dialect }) // names folded; types and defaults compared in the dialect's terms
  const out = { id: s.id, repo: s.repo, name: s.name, dialect, change: !b ? 'added' : !a ? 'removed' : null, attrs: [], before: b, after: a, changes: [], renames: [] }
  if (b && a && (b.dialect ?? null) !== (a.dialect ?? null)) out.attrs.push({ attr: 'dialect', before: b.dialect ?? null, after: a.dialect ?? null })
  const push = (kind, change, entity, x, y, pos, attrs = [], owner = null) => out.changes.push({ kind, change, entity, name: NAME[kind](y || x), key: KEY[kind](y || x, fold), pos, owner, before: x, after: y, attrs, rename: null })
  const byName = (p, q) => { const m = KEY.entity(p[0] || p[1], fold), n = KEY.entity(q[0] || q[1], fold); return m < n ? -1 : m > n ? 1 : 0 }
  for (const [x, y, px, py] of pairs(b?.entities || [], a?.entities || [], (e) => KEY.entity(e, fold)).sort(byName)) {
    const name = (y || x).name
    if (!x) { push('entity', 'added', name, null, y, { before: null, after: py }); continue }
    if (!y) { push('entity', 'removed', name, x, null, { before: px, after: null }); continue }
    const attrs = changed('entity', x, y, fold)
    if (attrs.length) push('entity', 'modified', name, x, y, { before: px, after: py }, attrs)
    const owner = { before: px, after: py }
    for (const [kind, list] of LISTS) {
      for (const [u, v, pu, pv] of pairs(x[list] || [], y[list] || [], (el) => KEY[kind](el, fold))) {
        if (!u) push(kind, 'added', name, null, v, { before: null, after: pv }, [], owner)
        else if (!v) push(kind, 'removed', name, u, null, { before: pu, after: null }, [], owner)
        else { const d = changed(kind, u, v, fold); if (d.length) push(kind, 'modified', name, u, v, { before: pu, after: pv }, d, owner) }
      }
    }
  }
  out.renames = renames(out.changes, fold)
  if (!out.change && (out.attrs.length || out.changes.length)) out.change = 'modified'
  return out.change ? out : null
}

// Both sides' elements matched by key: [before, after, before position, after position], the
// branch's in its order (added and kept), then the base's that are gone, in theirs.
function pairs(xs, ys, key) {
  const bx = new Map(xs.map((x, i) => [key(x), [x, i]]))
  const out = ys.map((y, j) => { const k = key(y), m = bx.get(k); bx.delete(k); return m ? [m[0], y, m[1], j] : [null, y, null, j] })
  for (const [, [x, i]] of bx) out.push([x, null, i, null])
  return out
}

function changed(kind, x, y, fold) {
  // a key-value table's item field (data/binding.mjs): what each bound type stores there
  const item = kind === 'field' && (x.item || y.item) ? (itemText(x) !== itemText(y) ? [{ attr: 'item', before: itemText(x), after: itemText(y) }] : []) : null
  if (x.per && y.per) return [...changedPer(x.per, y.per), ...(item || [])]
  if (item && !x.per && !y.per) return item // a field only an item states: its types are all it says
  const bx = ATTRS[kind](x, fold), by = ATTRS[kind](y, fold)
  return [...Object.keys(bx).filter((k) => JSON.stringify(bx[k][0]) !== JSON.stringify(by[k][0])).map((k) => ({ attr: k, before: bx[k][1], after: by[k][1] })), ...(item || [])]
}
// an item field as compared and shown: each bound type's stored type, nullable and default
export const itemText = (f) => (f.item && f.item.length ? f.item.map((i) => `${i.type}: ${i.raw || i.kind}${i.nullable ? ', nullable' : ''}${i.default ? `, default ${i.default}` : ''}`).join(' · ') : null)
// A key-value element, declaration by declaration (`per`, reconcile.mjs): an attribute changed when any
// declaration says another value than its counterpart on the other side. A declaration's counterpart
// is the same file; when a file left and another came (a declaration that moved to another file, or
// a file of several tables split into one per table), the one that left pairs with the one that came;
// when what is left on each side does not pair one to one and no file is on both sides, the merged
// values (each side's first declaration's) are compared. One change when every pair moved alike, else
// one per pair that moved, `in` naming its file (the branch's); a declaration that states the element
// on one side only changes where it is declared (`declared in`).
function changedPer(before, after) {
  const B = new Map(before), A = new Map(after)
  const pairs = [...B.keys()].filter((k) => A.has(k)).map((k) => [k, k])
  const gone = [...B.keys()].filter((k) => !A.has(k)), came = [...A.keys()].filter((k) => !B.has(k))
  if (gone.length === 1 && came.length === 1) pairs.push([gone[0], came[0]])
  else if (!pairs.length && B.size && A.size) pairs.push([[...B.keys()][0], [...A.keys()][0]])
  const out = []
  const attrs = new Set([...B.values(), ...A.values()].flatMap((a) => Object.keys(a)))
  const s = (v) => JSON.stringify(v ?? null)
  for (const attr of attrs) {
    const moved = pairs.filter(([b, a]) => s(B.get(b)[attr]) !== s(A.get(a)[attr]))
    if (!moved.length) continue
    const alike = moved.length === pairs.length && new Set(moved.map(([b]) => s(B.get(b)[attr]))).size === 1 && new Set(moved.map(([, a]) => s(A.get(a)[attr]))).size === 1
    if (alike) out.push({ attr, before: B.get(moved[0][0])[attr] ?? null, after: A.get(moved[0][1])[attr] ?? null })
    else for (const [b, a] of moved) out.push({ attr, before: B.get(b)[attr] ?? null, after: A.get(a)[attr] ?? null, in: declPath(a) })
  }
  if (gone.length || came.length) out.push({ attr: 'declared in', before: [...B.keys()].map(declPath), after: [...A.keys()].map(declPath) })
  return out
}

function renames(changes, fold) {
  const groups = new Map()
  changes.forEach((c, i) => {
    if (c.change === 'modified') return
    const el = c.before || c.after
    const shape = SHAPE[c.kind](el, fold, c.change === 'removed' ? c.pos.before : c.pos.after)
    if (!shape) return
    const k = `${c.kind}\0${c.kind === 'entity' ? '' : fold(c.entity)}\0${shape[0]}`
    if (!groups.has(k)) groups.set(k, { kind: c.kind, entity: c.kind === 'entity' ? null : c.entity, shape: shape[1], from: [], to: [] })
    groups.get(k)[c.change === 'removed' ? 'from' : 'to'].push(i)
  })
  const out = [...groups.values()].filter((g) => g.from.length && g.to.length).map((g) => ({ ...g, ambiguous: g.from.length > 1 || g.to.length > 1 }))
  out.forEach((g, r) => { for (const i of [...g.from, ...g.to]) changes[i].rename = r })
  return out
}
