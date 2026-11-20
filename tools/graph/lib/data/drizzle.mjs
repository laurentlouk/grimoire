// grimoire graph · data · the Drizzle queries in code, against the model (spec D2's `inferred` kind, the
// least trusted): the calls extractors/drizzle-queries.mjs read, resolved to the tables the Drizzle
// schemas declare (extractors/drizzle-ts.mjs keeps each table's variable and each column's property
// key). Run by reconcile.mjs once the declarations are merged and the SQL the code sends is placed
// (queries.mjs); nothing here changes a declared fact.
//
// A table a call names, per repository, never across two (no evidence ties them):
//   an import     `import { notes } from '…'` (renamed or not), or a namespace's member (`schema.notes`):
//                 the schema table of that variable; when several schemas of the repository declare
//                 one, the one whose file the import's path names (a relative path resolved against the
//                 importing file, else its last folders: `@/db/schema`, `@acme/db/schema`), else none
//                 (ambiguous, counted)
//   the file's    a table the querying file declares itself
//   a key         the relational API's `db.query.<key>`: the table the schema exports as <key> (the
//                 schema object drizzle() is given is the schema module's exports)
//   `with`        a relational query's `with: { author: true }`: the relation of that name the schema's
//                 relations() declares on the table, read as the table it joins (nested alike)
// A name no schema table resolves is unresolved (counted, its first places kept: a table removed from
// the schema that code still names is one). A column is its property key, named as the schema names
// the column (its builder's name, else the key in the config's casing); a key the schema's table does
// not hold, on a table the schema states whole, is an `[inferred]` conflict (`named in code (inferred)`
// against `absent from the schema`, its code declarations cited), as the SQL the code sends adds one (queries.mjs).
//
// What it adds (the SQL's shapes, so graph_data and the page read both alike):
//   model.queries.sites   each call a Site { repo, path, line, extractor, fn, fnLine, call: 'drizzle',
//                         store, reads, writes, names: [entity id], kinds: [its operation], columns:
//                         [{ entity, name, how }], joins: [{ from, to, kind, on: [[a, b]] }], open? }
//                         (model.queries created when no SQL was read)
//   entity.queries        { sites, conflicts, more? }, as an attached SQL query's
//   store.drizzle         { files, calls, runtime: [{ path, line, call, source, fn }] }: the calls
//                         reaching it, and where a running app applies its migrations (`migrate`,
//                         `useMigrations` given the bundle or the folder this store replays)
//   model.drizzle         { files, calls, placed, unresolved, unresolvedAt, ambiguous, dynamic, tests,
//                         runtime: the migrators no store was found for }
import path from 'node:path'
import { MAX_SOURCES, CAP } from './queries.mjs'

const P = path.posix
const SRC_EXT = /\.(?:[cm]?[jt]sx?)$/i
const MAX_UNRESOLVED = 50
export const OP_WORD = { select: 'select', insert: 'insert', update: 'update', delete: 'delete', count: 'count', findMany: 'query.findMany', findFirst: 'query.findFirst' }

// Does a module specifier name this schema file? A relative one resolved against the importing file
// (the file, its folder's index, or a folder holding it: a barrel); another by its folders, in order,
// after an alias or a package scope (`@/`, `~/`, `#`, `@acme/`).
export function specFits(source, file, schemaPath) {
  const stem = schemaPath.replace(SRC_EXT, '')
  if (source.startsWith('.')) {
    const b = P.normalize(P.join(P.dirname(file), source)).replace(SRC_EXT, '').replace(/\/+$/, '')
    return stem === b || stem === `${b}/index` || stem.startsWith(`${b}/`)
  }
  const segs = source.split('/').filter(Boolean)
  if (segs.length && /^[@~#]/.test(segs[0])) segs.shift()
  if (!segs.length) return false
  const parts = stem.split('/').filter((x) => x !== 'index')
  let i = 0
  for (const p of parts) if (i < segs.length && p === segs[i]) i++
  return i === segs.length
}

export function resolveDrizzle(rows, model) {
  const files = rows.filter((r) => r.facts?.drizzle).map((r) => ({ repo: r.repo, extractor: r.extractor, d: r.facts.drizzle }))
  if (!files.length) return
  const storeOf = new Map(model.stores.map((s) => [s.id, s]))
  const entityOf = new Map(model.stores.flatMap((s) => s.entities.map((e) => [e.id, e])))
  // the schema tables per repository, by variable: what the code names them by
  const byVar = new Map() // repo → Map(var → [T])
  const rels = new Map() // entity id → Map(relation name → entity id)
  for (const r of rows) {
    if (!/^drizzle-ts@/.test(r.extractor)) continue
    for (const d of r.facts?.declarations || []) {
      const sid = `${r.repo}:${d.store}`
      if (!storeOf.has(sid)) continue
      for (const e of d.entities || []) {
        if (!e.var) continue
        const id = `${sid}/${e.name}`
        if (!entityOf.has(id)) continue
        const t = { id, store: sid, var: e.var, path: e.path, keys: new Map((e.fields || []).filter((f) => f.key).map((f) => [f.key, f.name])), whole: !!d.complete && !e.part }
        if (!byVar.has(r.repo)) byVar.set(r.repo, new Map())
        const m = byVar.get(r.repo)
        if (!m.has(e.var)) m.set(e.var, [])
        if (!m.get(e.var).some((x) => x.id === id)) m.get(e.var).push(t)
      }
      for (const q of d.queryRelations || []) {
        const from = `${sid}/${q.from}`, to = `${sid}/${q.to}`
        if (!rels.has(from)) rels.set(from, new Map())
        if (!rels.get(from).has(q.name)) rels.get(from).set(q.name, to)
      }
    }
  }
  model.queries ||= { files: 0, statements: 0, sites: [], attached: [], clients: [], tests: 0, notes: [] }
  const out = { files: 0, calls: 0, placed: 0, unresolved: 0, unresolvedAt: [], ambiguous: 0, dynamic: 0, tests: 0, runtime: [] }
  const per = new Map() // store id → { files: Set, calls }
  const conflicts = new Map() // entity id → Map(key → conflict)
  for (const f of files) {
    const { d, repo } = f
    out.tests += d.tests || 0
    out.dynamic += d.dynamic || 0
    if (d.sites.length) out.files++
    const vars = byVar.get(repo) || new Map()
    const memo = new Map()
    // a ref → { t } | { ambiguous } | { none }
    const resolve = (i) => {
      if (memo.has(i)) return memo.get(i)
      const ref = d.refs[i]
      let r = { none: true }
      const cands = ref ? vars.get(ref.name) || [] : []
      if (ref?.k === 'local') { const x = cands.filter((t) => t.path === d.path); r = x.length === 1 ? { t: x[0] } : { none: true } }
      else if (cands.length === 1) r = { t: cands[0] }
      else if (cands.length > 1) { const x = ref.source ? cands.filter((t) => specFits(ref.source, d.path, t.path)) : []; r = x.length === 1 ? { t: x[0] } : { ambiguous: cands } }
      memo.set(i, r)
      return r
    }
    for (const s of d.sites) {
      out.calls++
      const fn = s.fn >= 0 ? d.fns[s.fn] : null
      const site = { repo, path: d.path, line: s.line, extractor: f.extractor, fn: fn?.name ?? null, fnLine: fn?.line ?? null, call: 'drizzle', store: null, reads: [], writes: [], names: [], kinds: [OP_WORD[s.op] || s.op], columns: [], joins: [], ...(s.open ? { open: 1 } : {}) }
      const mine = new Map() // ref index → entity id, for the site's own tables
      for (const t of s.tables) {
        const r = resolve(t.ref)
        if (!r.t) {
          if (r.ambiguous) out.ambiguous++
          else { out.unresolved++; if (out.unresolvedAt.length < MAX_UNRESOLVED) out.unresolvedAt.push({ repo, path: d.path, line: t.line, name: d.refs[t.ref]?.name ?? null, fn: site.fn }) }
          continue
        }
        mine.set(t.ref, r.t.id)
        const list = t.role === 'write' ? site.writes : t.role === 'read' ? site.reads : site.names
        if (!list.includes(r.t.id)) list.push(r.t.id)
        site.store ||= r.t.store
      }
      // a relational query's `with`: the tables its relations join, nested
      const follow = (from, list, depth) => {
        for (const w of list || []) {
          const to = rels.get(from)?.get(w.name)
          if (!to) continue
          if (!site.reads.includes(to) && !site.writes.includes(to)) site.reads.push(to)
          if (site.joins.length < 16) site.joins.push({ from, to, kind: `with ${w.name}`, on: [] })
          if (depth < 4) follow(to, w.with, depth + 1)
        }
      }
      if (s.with && s.tables[0] && mine.has(s.tables[0].ref)) follow(mine.get(s.tables[0].ref), s.with, 0)
      if (!site.reads.length && !site.writes.length && !site.names.length) continue // (each table it names counted above)
      // the columns named: a key of one of the site's own tables, as the schema names the column
      const col = (ref, key) => {
        const r = resolve(ref)
        if (!r.t || ![...mine.values()].includes(r.t.id)) return null
        return { t: r.t, name: r.t.keys.get(key) ?? null }
      }
      for (const c of s.cols) {
        const x = col(c.ref, c.key)
        if (!x) continue
        if (x.name === null) {
          // a key the schema's table does not hold: an [inferred] conflict, when the schema states it whole
          if (!x.t.whole) continue
          if (!conflicts.has(x.t.id)) conflicts.set(x.t.id, new Map())
          const m = conflicts.get(x.t.id)
          const e = entityOf.get(x.t.id)
          if (!m.has(c.key)) m.set(c.key, { label: `${e.name}.${c.key}`, attr: 'presence', path: c.key, inferred: true, values: [{ value: 'named in code (inferred)', sources: [] }, { value: 'absent from the schema', sources: (e.sources || []).filter((y) => y.kind === 'code').slice(0, MAX_SOURCES) }] })
          const v = m.get(c.key).values[0]
          const src = { repo, path: d.path, line: c.line, kind: 'inferred', extractor: f.extractor, confidence: 'seen' }
          if (v.sources.length < MAX_SOURCES) { if (!v.sources.some((y) => y.path === src.path && y.line === src.line)) v.sources.push(src) } else v.more = (v.more || 0) + 1
          continue
        }
        if (site.columns.length < 64 && !site.columns.some((y) => y.entity === x.t.id && y.name === x.name && y.how === c.how)) site.columns.push({ entity: x.t.id, name: x.name, how: c.how })
      }
      for (const j of s.joins) {
        const to = mine.get(j.ref)
        if (!to) continue
        const from = mine.get(s.tables[0].ref) || null
        const on = (j.on || []).map((pair) => pair.map((y) => { const x = col(y.ref, y.key); return x && x.name ? `${entityOf.get(x.t.id).name}.${x.name}` : null })).filter((pair) => pair.every(Boolean))
        site.joins.push({ from, to, kind: j.kind, on })
      }
      // every line the call names its tables and columns on (graph_impact leaves them out of the mentions)
      site.lines = [...new Set([...s.tables, ...s.cols].map((x) => x.line))].slice(0, 32)
      const k = model.queries.sites.length
      model.queries.sites.push(site)
      out.placed++
      for (const id of new Set([...site.reads, ...site.writes, ...site.names])) {
        const e = entityOf.get(id)
        if (!e) continue
        e.queries ||= { sites: [], conflicts: [] }
        if (!e.queries.sites.includes(k)) e.queries.sites.push(k)
        const sid = id.slice(0, id.lastIndexOf('/'))
        if (!per.has(sid)) per.set(sid, { files: new Set(), calls: new Set() })
        per.get(sid).files.add(d.path)
        per.get(sid).calls.add(k)
      }
    }
    // the migrations a running app applies: the store whose folder its migrations' import (or
    // migrationsFolder) names
    for (const m of d.migrators || []) {
      const fn = m.fn >= 0 ? d.fns[m.fn] : null
      const at = { repo, path: d.path, line: m.line, call: m.call, source: m.source, fn: fn?.name ?? null }
      const st = m.source ? model.stores.filter((s) => s.repo === repo && !s.inferred && s.declarations.some((x) => x.kind === 'migration' || x.kind === 'artifact') && folderFits(m.source, d.path, s.name)) : []
      if (st.length === 1) {
        if (!per.has(st[0].id)) per.set(st[0].id, { files: new Set(), calls: new Set() })
        ;(per.get(st[0].id).runtime ||= []).push(at)
      } else out.runtime.push(at)
    }
  }
  for (const [id, m] of conflicts) {
    const e = entityOf.get(id)
    e.queries ||= { sites: [], conflicts: [] }
    const list = [...(e.queries.conflicts || []), ...m.values()]
    e.queries.conflicts = list.slice(0, CAP)
    if (list.length > CAP) e.queries.more = (e.queries.more || 0) + list.length - CAP
  }
  for (const [sid, x] of per) { const st = storeOf.get(sid); if (st) st.drizzle = { files: x.files.size, calls: x.calls.size, ...(x.runtime ? { runtime: x.runtime } : {}) } }
  model.drizzle = out
}

// Does a migrator's migrations import (a bundle in the folder: `../../drizzle/migrations`,
// `@/drizzle/migrations`), or a `migrationsFolder`, name this store's folder?
export function folderFits(source, file, folder) {
  const norm = (p) => P.normalize(p).replace(/\/+$/, '').replace(/^\.\//, '')
  if (source.startsWith('.')) {
    const b = norm(P.join(P.dirname(file), source)).replace(SRC_EXT, '')
    if (b === folder || P.dirname(b) === folder) return true
    // a migrationsFolder is relative to where the app runs, often the repository root
    const r = norm(source)
    return r === folder || P.dirname(r) === folder
  }
  const segs = source.split('/').filter(Boolean)
  if (segs.length && /^[@~#]/.test(segs[0])) segs.shift()
  const tail = (list) => list.join('/')
  return [segs, segs.slice(0, -1)].some((s) => s.length && (folder === tail(s) || folder.endsWith(`/${tail(s)}`)))
}
