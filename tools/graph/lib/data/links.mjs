// grimoire graph · data · the links between entities that no key states (spec 2026-11-09 D3, D4, D5,
// D8, and its 2026-11-20 amendment for SQL stores). One module, so the page and graph_data can never
// disagree about a line:
//
//   lead      an attribute, a column no foreign key covers, or a key template's placeholder whose name
//             ends in `id` (`orbit_id`, `orbitId`, `actor_user_id`), matched to the one table whose name
//             stem it names: in the same store, another store of the same repository, or the logical
//             table such a table belongs to; never in another repository. Stems are tried from the
//             longest suffix to the shortest (`actoruser`, then `user`); letter case, `_` and `-` are
//             ignored and a trailing `s` or `ies` dropped on both sides. Two targets for one stem make
//             no lead: both are rivals. `id` alone is no candidate. A lead is a guess from a name, never
//             checked: read the code before relying on it.
//   refined   a `relations` claim of a refine file that holds (data/check.mjs). It replaces a lead on the
//             same entity and column, whatever the lead's target.
//   lineage   a `lineage` claim that holds: an entity mirroring another, across stores.
//
// A link whose two ends sit in two stores is a stub in each store's diagram (D5): the other store and
// entity, a line from the entity it concerns. Names only: no value is kept.
//
//   modelLinks(model, claims) → Map(store id → { leads, rivals, stubs })
//     leads   [{ from, column, to, toColumn, sort, stem }] within the store (from, to: entity names)
//     rivals  [{ from, column, stem, targets: [entity ids] }]
//     stubs   [{ kind: lead | refined | lineage, dir: out | in, from: this store's entity, column,
//               store: the other store's id, entity: the other entity's name, toColumn, why, at }]
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const sing = (w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

// The stems an id-like name points at, longest first: [] when it is not one (`id` alone, `name`).
export function idStems(name) {
  const ws = words(String(name).split('.').pop().replace(/\[\]/g, ''))
  if (ws.length < 2 || ws[ws.length - 1] !== 'id') return []
  const before = ws.slice(0, -1)
  return before.map((_, k) => sing(before.slice(k).join('')))
}
// A table's stem: its name after its last unknown part (`{env}-{project}-orbit` → orbit), null when no
// literal part follows it.
export function tableStem(name) {
  const n = String(name), cut = n.lastIndexOf('}')
  const ws = words(cut >= 0 ? n.slice(cut + 1) : n)
  return ws.length ? sing(ws.join('')) : null
}
// A key template's placeholders, in order: `user:{user_id}:sessions` → ['user_id']
export const placeholders = (name) => [...String(name).matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).filter(Boolean)

const keyOf = (e) => {
  const k = (e.keys || []).find((x) => x.role === 'partition') || (e.keys || []).find((x) => x.role === 'primary')
  if (k && k.parts.length) return k.parts[0]
  const id = (e.fields || []).find((f) => String(f.name).toLowerCase() === 'id')
  return id ? id.name : null
}
const hasSort = (e) => (e.keys || []).some((x) => x.role === 'sort')
const idOf = (st, e) => e.id || `${st.id}/${e.name}`

export function modelLinks(model, claims = []) {
  const stores = (model && model.stores) || []
  const out = new Map(stores.map((st) => [st.id, { leads: [], rivals: [], stubs: [] }]))
  const byId = new Map()
  for (const st of stores) for (const e of st.entities) byId.set(idOf(st, e), { st, e })
  // an entity id → [store, entity]: ids are `<store>/<name>`; a store id may hold `/` itself
  const resolve = (id) => {
    if (byId.has(id)) return byId.get(id)
    const low = String(id).toLowerCase()
    for (const [k, v] of byId) if (k.toLowerCase() === low) return v
    return null
  }
  // the targets of a repository by stem: tables and key-value tables, never a key template; the
  // declarations of one logical table count as one target
  const targets = new Map()
  for (const st of stores) {
    if (st.dialect === 'redis') continue
    for (const e of st.entities) {
      const stem = tableStem(e.name)
      if (!stem) continue
      const k = `${st.repo}\0${stem}`
      if (!targets.has(k)) targets.set(k, new Map())
      const group = e.logical?.id ?? idOf(st, e)
      const g = targets.get(k)
      if (!g.has(group)) g.set(group, [])
      g.get(group).push({ st, e })
    }
  }
  const refinedOn = new Set() // `<entity id>\0<column>`: a refined relation replaces the lead there
  const say = (st, x) => out.get(st.id) && out.get(st.id)[x.list].push(x.item)
  // a link from A's column to B's: within one store a lead (or a refined relation, which the store's
  // own tables carry already), across two a stub on each side
  const cross = (kind, A, column, B, toColumn, extra = {}) => {
    say(A.st, { list: 'stubs', item: { kind, dir: 'out', from: A.e.name, column, store: B.st.id, entity: B.e.name, toColumn, ...extra } })
    say(B.st, { list: 'stubs', item: { kind, dir: 'in', from: B.e.name, column: toColumn, store: A.st.id, entity: A.e.name, toColumn: column, ...extra } })
  }
  for (const c of claims || []) {
    if (!c.ok) continue
    if (c.kind === 'relation') {
      const A = resolve(c.from), B = resolve(c.to)
      if (!A || !B) continue
      refinedOn.add(`${idOf(A.st, A.e).toLowerCase()}\0${String(c.columns[0]).toLowerCase()}`)
      if (A.st.id !== B.st.id) cross('refined', A, c.columns[0] ?? null, B, c.toColumns[0] ?? null, { why: c.why || '' })
    } else if (c.kind === 'lineage') {
      const A = resolve(c.from), B = resolve(c.to)
      if (!A || !B || A.st.id === B.st.id) continue
      cross('lineage', A, c.fields && c.fields[0] ? c.fields[0].from : null, B, c.fields && c.fields[0] ? c.fields[0].to : null, { why: c.why || '' })
    }
  }
  for (const st of stores) {
    for (const e of st.entities) {
      const fk = new Set((e.relations || []).flatMap((r) => r.columns.map((x) => String(x).toLowerCase())))
      const cands = st.dialect === 'redis' ? placeholders(e.name) : (e.fields || []).map((f) => f.name)
      const seen = new Set()
      for (const column of cands) {
        const low = String(column).toLowerCase()
        if (seen.has(low) || fk.has(low) || refinedOn.has(`${idOf(st, e).toLowerCase()}\0${low}`)) continue
        seen.add(low)
        for (const stem of idStems(column)) {
          const g = targets.get(`${st.repo}\0${stem}`)
          if (!g) continue
          if (g.size > 1) { say(st, { list: 'rivals', item: { from: e.name, column, stem, targets: [...g.values()].map((m) => idOf(m[0].st, m[0].e)).sort() } }); break }
          const members = [...g.values()][0]
          const B = members.find((m) => m.st.id === st.id) || members.slice().sort((a, b) => (a.st.id < b.st.id ? -1 : 1))[0]
          // a table's own key named after it (`carts.cartId`) is no link
          if (B.e === e && (e.keys || []).some((k) => k.parts.some((p) => String(p).toLowerCase() === low))) break
          // the line ends at the target's key part of the same name (a sort key `cartId`), else at its partition or primary key
          const same = (B.e.keys || []).flatMap((k) => k.parts).find((p) => String(p).toLowerCase() === low)
          const toColumn = same ?? keyOf(B.e)
          if (B.st.id === st.id) say(st, { list: 'leads', item: { from: e.name, column, to: B.e.name, toColumn, sort: hasSort(B.e), stem } })
          else cross('lead', { st, e }, column, B, toColumn, { stem, sort: hasSort(B.e) })
          break
        }
      }
    }
  }
  for (const v of out.values()) {
    const by = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : String(a.column) < String(b.column) ? -1 : 1)
    v.leads.sort(by); v.rivals.sort(by)
    v.stubs.sort((a, b) => (a.store < b.store ? -1 : a.store > b.store ? 1 : a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : by(a, b)))
  }
  return out
}

export const LEAD_SAYS = 'a lead from the attribute\'s name, never checked: read the code before relying on it'
export const STUB_MAX = 12 // stubs drawn per diagram; past it, one per other store
