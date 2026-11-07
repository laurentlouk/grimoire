// grimoire graph · data · access patterns against the model (research §5, "NoSQL is a four-part join":
// its fourth part, "which index each query uses, which attributes act as keys, which attributes each
// update writes"). Run by reconcile.mjs after the item binding, over every repository's facts at once:
// the calls extractors/dynamo-access.mjs read, resolved to the logical tables (binding.mjs) they reach.
// Inferred, the least trusted kind (spec D2): nothing here changes a declared fact; what it finds is a
// lead, or a conflict beside the declarations.
//
// A call's table, first found (binding.mjs's resolver: a name the table's name or template matches,
// an environment variable the infra sets, a constant of its file or another):
//   call      its own table argument names it (`.table_name(…)`, `TableName:`, the Table it is made on)
//   function  only its function does
//   file      only its file does
//   index     no code around it names a table, or what does declares no index of the name it queries:
//             the tables declaring an index of that name (exact, never fuzzy)
// Production code over test code at each step; several tables at once: ambiguous, each the others' rival.
// A call naming an index keeps, among the tables found, those declaring an index of that name.
//
// What it adds:
//   model.access { files, sites: [Site], placed, leads } (absent when no file holds a call)
//   Site  { repo, path, line, extractor, fn, fnLine, op, index, indexAt?, test, tables: [group id],
//           labels, pairing, ambiguous, testOnly, evidence, writes, open, item, key, projection,
//           mismatch?: its table declares no index of that name }
//   per kv entity (every member of a logical table): access { sites: [site index], indexes: [{ name,
//           sites: [site index], lead: text | null }], conflicts: [Conflict], note? }
//   Conflict  an attribute a call writes (an update's SET, REMOVE, ADD or DELETE path; a literal put
//             item's attribute) that neither the bound item shape nor the declarations state:
//             { label, attr: 'presence', path, values: [{ value: 'written (…)', sources: [inferred] },
//             { value: 'absent from the item (…)', sources: [the bound types, code] }] }; compared
//             only for a call reaching one table, on a table with an item type bound.
import { kvIndex } from './model.mjs'

// what "no access found" says it searched, and what it may have missed: a lead, never a verdict
export const NO_ACCESS = 'no access found (lead): no IndexName or index_name naming it in the indexed repositories; it may be reached through a constant built elsewhere, another repository, or a script'
export const READS = new Set(['query', 'scan', 'get', 'batch-get', 'transact-get', 'check'])
export const PAIRING_TEXT = { call: 'the table named at the call', function: 'the table named in its function', file: 'the table named in its file', index: 'no code around it names the table: the tables declaring an index of that name' }
const MAX_EVIDENCE = 3, MAX_SOURCES = 6
// An operation in words (graph_data and the page say the same); a call naming an index and nothing
// else reads it, by a query or a scan.
const OP_TEXT = { 'batch-get': 'batch get', 'batch-write': 'batch write', 'transact-write': 'transaction write', 'transact-get': 'transaction get', check: 'condition check' }
export const opText = (s) => (s.op ? OP_TEXT[s.op] || s.op : s.index ? 'query or scan' : 'call')
export const isRead = (s) => READS.has(s.op) || (!s.op && !!s.index)
// How a call reached its table, in words: its pairing, test code, the rivals of an ambiguous one.
export const siteHow = (s) => [PAIRING_TEXT[s.pairing] || 'no table found', s.testOnly ? 'named only in test code' : null, s.ambiguous ? `ambiguous: ${s.labels.join(' | ')}` : null, s.mismatch ? `its table declares no index ${s.index}` : null].filter(Boolean).join('; ')

// The functions holding a list of calls, one entry per function: `sym(site)` → the code graph's
// symbol around it, { key, name, line } (lib/query.mjs symbolAt), else the extractor's name for it.
//   → [{ key, name, repo, path, line, ops: [words], writes: [path], sites: [site], test, callers }]
export function byFunction(list, sym) {
  const out = new Map()
  for (const s of list) {
    const g = sym(s) || { key: `${s.repo}\0${s.path}\0${s.fn ?? s.line}`, name: s.fn || '(top level)', line: s.fnLine ?? s.line, callers: null }
    if (!out.has(g.key)) out.set(g.key, { key: g.key, name: g.name, repo: s.repo, path: s.path, line: g.line, ops: [], writes: [], sites: [], test: true, callers: g.callers })
    const f = out.get(g.key)
    if (!f.ops.includes(opText(s))) f.ops.push(opText(s))
    for (const w of [...s.writes.map((x) => x.path), ...(s.item || [])]) if (!f.writes.includes(w)) f.writes.push(w)
    f.sites.push(s)
    if (!s.test) f.test = false
  }
  return [...out.values()]
}

export function resolveAccess(rows, { groups, entities, R, fieldsOf, boundOf, items }) {
  // the logical tables declaring each index name
  const declaring = new Map()
  for (const g of groups) for (const m of g.members) for (const i of entities.get(m)?.indexes || []) {
    if (!kvIndex(i)) continue
    if (!declaring.has(i.name)) declaring.set(i.name, new Set())
    declaring.get(i.name).add(g)
  }
  const sites = []
  const byGroup = new Map() // group id → [site index]
  const named = new Map() // index name → [site index] (every call naming it, wherever it resolved)
  for (const r of rows) {
    const a = r.access
    const at = { repo: r.repo, path: a.path, lang: a.lang }
    const refsAt = (sink, test) => R.collapse([...R.refsOf(sink, at, test), ...(sink.uses || []).flatMap((u) => R.constRefs(u, at, test))])
    const fnRefs = new Map()
    const fnTier = (i) => { if (!fnRefs.has(i)) fnRefs.set(i, refsAt(a.fns[i], !!a.fns[i].test)); return fnRefs.get(i) }
    let fileTier = null
    const fileRefs = () => (fileTier ||= R.collapse([...a.fns.flatMap((_, i) => fnTier(i)), ...(a.consts || []).flatMap((c) => R.refsOf(c, at, !!c.test, { what: 'const', repo: r.repo, path: a.path, line: c.line, text: c.name }))]))
    const prod = (refs) => { const p = refs.filter((x) => !x.test); return p.length ? p : refs }
    for (const s of a.sites || []) {
      const fn = s.fn >= 0 ? a.fns[s.fn] : null
      const test = !!(s.test || fn?.test)
      let index = s.index ?? null, indexAt = null
      if (index === null && s.indexConst) {
        // a constant of another file (the binding's resolution): its one literal name
        const k = R.findConst(s.indexConst, at)
        const lits = (k?.c.names || []).filter((n) => !n.text.includes('{'))
        if (k && lits.length === 1 && !(k.c.env || []).length) { index = lits[0].text; indexAt = { repo: k.repo, path: k.path, line: k.c.line, text: s.indexConst } }
      }
      const tiers = [['call', s.table ? refsAt(s.table, test) : []], ['function', fn ? fnTier(s.fn) : []], ['file', null]]
      let pairing = null, cands = []
      for (const [p, list] of tiers) { const refs = list ?? fileRefs(); if (refs.length) { pairing = p; cands = prod(refs); break } }
      let mismatch = false
      if (index !== null) {
        const D = declaring.get(index) || new Set()
        const narrowed = cands.filter((x) => D.has(x.group))
        if (narrowed.length) cands = narrowed
        else if (D.size && (!cands.length || pairing === 'file')) { cands = [...D].map((g) => ({ group: g, via: 'index', test, evidence: [] })); pairing = 'index' }
        else if (cands.length) mismatch = true
      }
      const k = sites.length
      const rec = {
        repo: r.repo, path: a.path, line: s.line, extractor: r.extractor, fn: fn?.name ?? null, fnLine: fn?.line ?? null, op: s.op, index, ...(indexAt ? { indexAt } : {}), test,
        tables: cands.map((x) => x.group.id), labels: cands.map((x) => x.group.label), pairing: cands.length ? pairing : null, ambiguous: cands.length > 1, testOnly: cands.length > 0 && cands.every((x) => x.test),
        evidence: (cands[0]?.evidence || []).slice(0, MAX_EVIDENCE), writes: s.writes || [], open: s.open || 0, item: s.item || null, key: s.key || null, projection: s.projection || null,
        ...(s.indexExpr ? { indexExpr: s.indexExpr } : {}), ...(s.indexConst && index === null ? { indexConst: s.indexConst } : {}), ...(s.updateFrom ? { updateFrom: s.updateFrom } : {}), ...(mismatch ? { mismatch: true } : {}),
      }
      sites.push(rec)
      for (const g of rec.tables) { if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(k) }
      if (index !== null) { if (!named.has(index)) named.set(index, []); named.get(index).push(k) }
    }
  }

  const out = new Map() // entity id → its access
  const itemExtractor = new Map((items || []).map((it) => [it.id, it.extractor]))
  const leads = new Set() // `<group>|<index>`: one lead per logical table and index, however many declare it
  for (const g of groups) {
    const mine = byGroup.get(g.id) || []
    const members = g.members.map((m) => entities.get(m)).filter(Boolean)
    // the shape a write is compared with: every member's fields (the bound item types' and the
    // declarations'), its keys, its indexes' keys, its TTL attribute
    const known = new Map(), parents = new Set()
    let itemBound = false
    const know = (p, kinds) => { if (!known.has(p)) known.set(p, new Set()); for (const k of kinds) known.get(p).add(k); for (let i = p.indexOf('.'); i > 0; i = p.indexOf('.', i + 1)) parents.add(p.slice(0, i)) }
    for (const e of members) {
      for (const f of fieldsOf(e)) { if (f.item) itemBound = true; know(f.name, f.item ? f.item.map((i) => i.kind) : ['any']) }
      for (const x of [...e.keys.flatMap((k) => k.parts), ...e.indexes.flatMap((i) => i.columns || [])]) know(x, ['any'])
    }
    const conflicts = new Map() // path → { clauses, sites }
    if (itemBound) {
      for (const k of mine) {
        const s = sites[k]
        if (s.ambiguous || s.mismatch) continue
        for (const w of [...s.writes, ...(s.item || []).map((p) => ({ path: p, clause: 'PUT' }))]) {
          if (covered(w.path, known, parents)) continue
          if (!conflicts.has(w.path)) conflicts.set(w.path, { clauses: new Set(), sites: [] })
          const c = conflicts.get(w.path)
          c.clauses.add(w.clause)
          if (!c.sites.includes(k)) c.sites.push(k)
        }
      }
    }
    for (const e of members) {
      const bound = boundOf(e).filter((b) => b.confidence !== 'ambiguous')
      const indexes = e.indexes.filter(kvIndex).map((i) => {
        const hits = mine.filter((k) => sites[k].index === i.name && !sites[k].mismatch)
        let lead = null
        const prodHits = hits.filter((k) => !sites[k].test)
        if (!hits.length) {
          const elsewhere = (named.get(i.name) || []).filter((k) => !sites[k].tables.includes(g.id))
          lead = elsewhere.length ? `no access found on this table (lead): ${elsewhere.length} call${elsewhere.length === 1 ? '' : 's'} name${elsewhere.length === 1 ? 's' : ''} an index ${i.name} of another table (${[...new Set(elsewhere.flatMap((k) => sites[k].labels))].join(', ') || 'none found'}); it may be reached through a constant built elsewhere, another repository, or a script` : NO_ACCESS
        } else if (!prodHits.length) lead = 'no access found outside test code (lead): only tests name it; it may be reached through a constant built elsewhere, another repository, or a script'
        if (lead) leads.add(`${g.id}|${i.name}`)
        return { name: i.name, sites: hits, lead }
      })
      const types = [...new Set(bound.map((b) => b.type))].join(', ')
      const cf = [...conflicts].map(([path, c]) => ({
        label: `${e.name}.${path}`, attr: 'presence', path, inferred: true,
        values: [
          { value: `written (${[...c.clauses].join(', ')})`, sources: c.sites.slice(0, MAX_SOURCES).map((k) => ({ repo: sites[k].repo, path: sites[k].path, line: sites[k].line, kind: 'inferred', extractor: sites[k].extractor, confidence: sites[k].pairing })) },
          { value: `absent from the item${types ? ` (${types})` : ''}`, sources: bound.slice(0, MAX_SOURCES).map((b) => ({ repo: b.repo, path: b.path, line: b.line, kind: 'code', extractor: itemExtractor.get(b.item) ?? null, confidence: b.confidence })) },
        ],
      }))
      out.set(e.id, { sites: mine, indexes, conflicts: cf, ...(mine.some((k) => sites[k].writes.length || sites[k].item) && !itemBound ? { note: 'written attributes not compared: no item type is bound to this table' } : {}) })
    }
  }
  return { model: { files: rows.length, sites, placed: sites.filter((s) => s.tables.length).length, leads: leads.size }, entities: out }
}

// Is a written path one the shape states? Not when its top-level attribute is absent, or when it goes
// into a struct whose fields the shape states and names none of them; into a map, a list's elements
// (`a[]`), a type the shape does not expand or an attribute only the declarations type, it is not
// compared (true).
export function covered(path, known, parents) {
  const segs = String(path).split('.')
  let at = ''
  for (const seg of segs) {
    const m = /^(.*?)((?:\[\])*)$/.exec(seg)
    const next = at ? `${at}.${m[1]}` : m[1]
    if (!known.has(next)) return at ? !parents.has(at) : false
    at = next
    const kinds = known.get(at)
    if (kinds.has('any') || kinds.has('ref') || kinds.has('map')) return true
    for (let k = 0; k < m[2].length / 2; k++) { if (!kinds.has('list')) return true; at = `${at}[]` }
  }
  return true
}
