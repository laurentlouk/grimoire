// grimoire graph · data · the links between entities that no key states (spec 2026-11-09 D3, D4, D5,
// D8, and its 2026-11-20 amendment for SQL stores). One module, so the page and graph_data can never
// disagree about a line:
//
//   lead      an attribute, a column no foreign key covers, or a key template's placeholder whose name
//             ends in `id` (`orbit_id`, `orbitId`, `actor_user_id`), matched to the one table whose name
//             stem it names: in the same store, another store of the same repository, or the logical
//             table such a table belongs to; never in another repository. Stems are tried from the
//             longest suffix to the shortest (`actoruser`, then `user`); letter case, `_` and `-` are
//             ignored, and a table's name matches in its singular forms (`addresses`, `movies`,
//             `statuses`, `categories`, a schema's `auth.users`). Then a column named exactly like
//             another table's one-column id key (`issue_id` → the table keyed by `issue_id`). Two targets for one stem make
//             no lead: both are rivals. `id` alone is no candidate. A lead is a guess from a name, never
//             checked: read the code before relying on it.
//   refined   a `relations` claim of a refine file that holds (data/check.mjs). It replaces a lead on the
//             same entity and column, whatever the lead's target.
//   lineage   a `lineage` claim that holds: an entity mirroring another, across stores.
//
// A link whose two ends sit in two stores is a stub in each store's diagram (D5): the other store and
// entity, a line from the entity it concerns. Names only: no value is kept.
//
//   modelLinks(model, claims) → Map(store id → { leads, rivals, stubs, refined })
//     leads   [{ from, column, to, toColumn, sort, stem }] within the store (from, to: entity names);
//             sort: the key part the line does not reach ('sort' | 'partition'), null for a whole key
//     refined [{ from, columns, to, toColumns, why }] a refined relation stated on another declaration of
//             a logical table, drawn on this one (its store declares both ends)
//     rivals  [{ from, column, stem, targets: [entity ids] }]
//     stubs   [{ kind: lead | refined | lineage, dir: out | in, from: this store's entity, column,
//               store: the other store's id, entity: the other entity's name, toColumn, why, at }]
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
// a table name's singular forms, for matching: `addresses` → address, `movies` → movie and movy,
// `statuses` → status, `boxes` → box; the name itself first
export const forms = (w) => {
  const out = [w]
  if (w.length > 4 && w.endsWith('ies')) out.push(`${w.slice(0, -3)}y`, w.slice(0, -1))
  if (w.length > 3 && /(s|x|z|ch|sh)es$/.test(w)) out.push(w.slice(0, -2))
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1))
  return [...new Set(out)]
}

// The stems an id-like name points at, longest first: [] when it is not one (`id` alone, `name`).
// A name past MAX_NAME characters or MAX_WORDS words is none: the stems stay linear in the input.
const MAX_NAME = 128, MAX_WORDS = 8
export function idStems(name) {
  const n = String(name)
  if (n.length > MAX_NAME) return []
  const ws = words(n.split('.').pop().replace(/\[\]/g, ''))
  if (ws.length < 2 || ws.length > MAX_WORDS || ws[ws.length - 1] !== 'id') return []
  const before = ws.slice(0, -1)
  return before.map((_, k) => before.slice(k).join(''))
}
// A table's stem: its name after its last unknown part (`{env}-{project}-orbit` → orbit), null when no
// literal part follows it.
export function tableStem(name) {
  let n = String(name)
  if (n.length > MAX_NAME) return null
  const cut = n.lastIndexOf('}')
  if (cut >= 0) n = n.slice(cut + 1)
  else if (/^[\w$]+\.[\w$]+$/.test(n)) n = n.slice(n.indexOf('.') + 1) // a schema-qualified table: `auth.users`
  const ws = words(n)
  return ws.length ? ws.join('') : null
}
// A key template's placeholders, in order: `user:{user_id}:sessions` → ['user_id']
// A literal brace the reader escaped (`\{order_id\}`, a cluster hash tag) is none (readers/redis-cmd.mjs HOLE_RE).
export const placeholders = (name) => [...String(name).matchAll(/(?<!\\)\{([A-Za-z0-9_$]+)\}/g)].map((m) => m[1])

const keyOf = (e) => {
  const k = (e.keys || []).find((x) => x.role === 'partition') || (e.keys || []).find((x) => x.role === 'primary')
  if (k && k.parts.length) return k.parts[0]
  const id = (e.fields || []).find((f) => String(f.name).toLowerCase() === 'id')
  return id ? id.name : null
}
const hasSort = (e) => (e.keys || []).some((x) => x.role === 'sort')
// a lead ending at one part of a two-part key says which part it lacks: 'sort' when it ends at the
// partition key, 'partition' when at the sort key, null when the key is whole
const lacking = (e, part) => {
  if (!hasSort(e)) return null
  const role = (e.keys || []).find((k) => k.parts.some((p) => String(p).toLowerCase() === String(part).toLowerCase()))?.role
  return role === 'sort' ? 'partition' : 'sort'
}
const sameTable = (a, b) => a === b || (a.logical?.id != null && a.logical.id === b.logical?.id)
const idOf = (st, e) => e.id || `${st.id}/${e.name}`

export function modelLinks(model, claims = []) {
  const stores = (model && model.stores) || []
  const out = new Map(stores.map((st) => [st.id, { leads: [], rivals: [], stubs: [], refined: [] }]))
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
  const targets = new Map(), byKey = new Map()
  const add = (map, k, st, e) => {
    if (!map.has(k)) map.set(k, new Map())
    const group = e.logical?.id ?? idOf(st, e)
    const g = map.get(k)
    if (!g.has(group)) g.set(group, [])
    if (!g.get(group).some((m) => m.e === e)) g.get(group).push({ st, e })
  }
  for (const st of stores) {
    if (st.dialect === 'redis') continue
    for (const e of st.entities) {
      const stem = tableStem(e.name)
      if (stem) for (const f of forms(stem)) add(targets, `${st.repo}\0${f}`, st, e)
      // a whole one-column key named like an id (`issue_id`): a column of that very name elsewhere names
      // it. A key with a sort part is not one item's id (a table partitioned by `memberId` is not the members)
      const k = keyOf(e)
      if (k && idStems(k).length && !hasSort(e) && (e.keys || []).filter((x) => x.role === 'primary' || x.role === 'partition').every((x) => x.parts.length === 1)) add(byKey, `${st.repo}\0${String(k).toLowerCase()}`, st, e)
    }
  }
  // the declarations of a logical table, by any of their ids
  const decls = (x) => { if (x.e.logical?.id == null) return [x]; const all = []; for (const st of stores) for (const e of st.entities) if (e.logical?.id === x.e.logical.id) all.push({ st, e }); return all.length ? all : [x] }
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
      const A0 = resolve(c.from), B0 = resolve(c.to)
      if (!A0 || !B0) continue
      // on every declaration of the logical table: within a store that also declares the other end,
      // a refined line there (`refined`), else a stub to the end the claim names
      for (const A of decls(A0)) {
        for (const col of c.columns) refinedOn.add(`${idOf(A.st, A.e).toLowerCase()}\0${String(col).toLowerCase()}`)
        const B = decls(B0).find((x) => x.st.id === A.st.id) || B0
        if (B.st.id === A.st.id) { if (A !== A0 || B !== B0) say(A.st, { list: 'refined', item: { from: A.e.name, columns: c.columns, to: B.e.name, toColumns: c.toColumns, why: c.why || '' } }) }
        else c.columns.forEach((col, i) => cross('refined', A, col ?? null, B, c.toColumns[i] ?? null, { why: c.why || '' }))
      }
    } else if (c.kind === 'lineage') {
      const A0 = resolve(c.from), B0 = resolve(c.to)
      if (!A0 || !B0) continue
      for (const A of decls(A0)) {
        const B = B0.st.id !== A.st.id ? B0 : null
        if (B) cross('lineage', A, c.fields && c.fields[0] ? c.fields[0].from : null, B, c.fields && c.fields[0] ? c.fields[0].to : null, { why: c.why || '' })
      }
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
        // the repositories a name may be matched in: the store's; for a key template, the ones whose
        // code writes it (a key space several repositories share is no one repository's)
        const repos = st.dialect === 'redis' ? [...new Set((e.sources || []).map((x) => x.repo).filter(Boolean))].sort() : []
        if (!repos.length) repos.push(st.repo)
        const own = (e.keys || []).some((k) => k.parts.some((p) => String(p).toLowerCase() === low))
        // stems from the longest suffix, each in its forms; then a key column of that very name
        const tries = [...idStems(column).flatMap((stem) => repos.map((r) => [targets.get(`${r}\0${stem}`), stem])), ...(own ? [] : repos.map((r) => [byKey.get(`${r}\0${low}`), `key ${column}`]))]
        for (const [g0, stem] of tries) {
          if (!g0) continue
          // a table's own key named after it (`carts.cartId`), on any declaration of it, is no link
          const g = new Map([...g0].filter(([, m]) => !(own && m.some((x) => sameTable(x.e, e)))))
          if (!g.size) break
          if (g.size > 1) { say(st, { list: 'rivals', item: { from: e.name, column, stem, targets: [...g.values()].map((m) => idOf(m[0].st, m[0].e)).sort() } }); break }
          const members = [...g.values()][0]
          const B = members.find((m) => m.st.id === st.id) || members.slice().sort((a, b) => (a.st.id < b.st.id ? -1 : 1))[0]
          // the line ends at the target's key part of the same name (a sort key `cartId`), else at its partition or primary key
          const same = (B.e.keys || []).flatMap((k) => k.parts).find((p) => String(p).toLowerCase() === low)
          const toColumn = same ?? keyOf(B.e)
          const sort = lacking(B.e, toColumn)
          if (B.st.id === st.id) say(st, { list: 'leads', item: { from: e.name, column, to: B.e.name, toColumn, sort, stem } })
          else cross('lead', { st, e }, column, B, toColumn, { stem, sort })
          break
        }
      }
    }
  }
  for (const v of out.values()) {
    const by = (a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : String(a.column) < String(b.column) ? -1 : 1)
    v.leads.sort(by); v.rivals.sort(by); v.refined.sort(by)
    v.stubs.sort((a, b) => (a.store < b.store ? -1 : a.store > b.store ? 1 : a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : by(a, b)))
  }
  return out
}

export const lackText = (s) => (s === 'sort' ? 'partition key only: the item also needs its sort key' : s === 'partition' ? 'sort key only: the item also needs its partition key' : '')
export const LEAD_SAYS = 'a lead from the attribute\'s name, never checked: read the code before relying on it'
export const STUB_MAX = 12 // stubs drawn per diagram; past it, one per other store
