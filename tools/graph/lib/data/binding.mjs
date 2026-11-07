// grimoire graph · data · item shapes bound to key-value tables (spec D2's Binding; research §5,
// "NoSQL is a four-part join": the key schema from infra, the item shape from code, the binding, the
// access patterns). Run by reconcile.mjs over every repository's facts at once: a table declared in
// one repository's infra and the code that writes it in another bind across them.
//
// Logical tables (logicalTables): the key-value tables of every store, grouped when they are one table
// declared twice, as two environments do (a local-dev CreateTable file and the prod Terraform):
//   - the same name template in two stores (`{env}-{project}-orders`);
//   - an exact name the template matches on its literal segments, each unknown part a wildcard
//     (readers/names.mjs: `local-shop-orders` with `{env}-{project}-orders`); an exact name two
//     templates match joins neither, and says so;
//   - the same exact name in two stores.
// Nothing else groups: two exact names never do (`Orders` and `{env}-{project}-orders` stay apart: no
// letter-case folding, no plural, no edit distance). reconcile.mjs compares the declarations of a
// group as it compares one table's: their disagreements are its conflicts.
//
// Item types: the types code converts to or from an item (a conversion: readers/code.mjs), resolved by
// name (the converting file's own type, else the one of that name in its repository, else in the
// project; two of one name and none in the file: not resolved), and the types that implement a
// conversion. Each one's shape is its fields as stored, nested by dotted path: a struct field's own
// fields under `field.`, a list's elements' under `field[].`, a map's values' under `field{}.`;
// flatten inlines a type's fields; an enum of unit variants is an enum of its stored names; a data
// enum follows serde's tagging (a tag beside the variant's fields, a tag and a content, untagged: the
// variants' fields together, external: one object per variant); TypeScript's `extends` and `&`
// inline. Up to DEPTH levels; a type that holds itself is not followed again.
//
// Binding an item type to a logical table, in falling confidence, each way with its evidence:
//   mapper       a mapper declares it (no extractor gives one yet: the hook is `mappers` in a code
//                file's facts, [{ type, table, line }]): declared
//   env          the code reads an environment variable the infra sets to the table (a Terraform
//                function's `environment { variables }`, a template's `Environment.Variables`)
//   nameTemplate the code builds a name the table's name or template matches (readers/names.mjs)
// and how close the conversion and the name are (D2's call site, the research's co-occurrence):
//   function     both in one function (a constant the function reads counts as its own)
//   file         only in one file
// Confidence: mapper → declared; env in one function → convention; env in one file, or a name in one
// function or one file → name-match; several tables at the type's best rank → ambiguous, each. Ranks
// (best first): mapper, env in a function, env in a file, a name in a function, a name in a file;
// then the same again for a conversion in test code (a test's own item, built for another table's
// fixture, says less than the code it tests). A name only a test builds still pairs at its rank.
// Every other table the type pairs with is listed as a rival. A type no table pairs with is unbound.
//
// What it adds to the model:
//   model.items     [{ id: '<repo>:<name>', repo, name, kind, path, line, lang, fields: [ItemField],
//                     bound: [table group ids], converts: [{ path, line, how }] (capped), notes }]
//   model.bindings  [{ item: id, type, repo, path, line, group, table: its name, entities: [entity
//                     ids], via, pairing, confidence, evidence: [Evidence], rivals: [{ group, table,
//                     via, pairing, confidence }] }]
//   model.unresolved [{ repo, type, path, line }] (a converted name with no single definition)
//   per member entity: `bound` (its bindings, as above) and, from each binding not ambiguous, its item
//   type's fields in `fields` (a stored attribute AttributeDefinitions also types gains an `item` and
//   the code's source; one only the item states is a field of its own, source kind code), so the diff
//   and the delta address them as `<table>.<field.path>`.
//   ItemField { path, raw, kind: string | number | bool | any | list | map | object | enum | ref,
//               nullable, default, values?, line, file, repo, type: the item type's name }
//   Evidence  { what: converts | builds | reads | sets | const, repo, path, line, text, test? }
import { namesMatch, parseName } from './readers/names.mjs'
import { normType } from './model.mjs'

export const DEPTH = 6
const MAX_EVIDENCE = 4
const RANK = { mapper: 5, 'env|function': 4, 'env|file': 3, 'nameTemplate|function': 2, 'nameTemplate|file': 1 }
const TEST_RANK = 10
const CONF = (rank) => (rank >= 5 ? 'declared' : rank === 4 ? 'convention' : 'name-match')
export const CONFIDENCES = ['declared', 'convention', 'name-match', 'ambiguous']
// below convention: drawn dashed, its rivals listed (spec, Binding mistakes)
export const dashed = (confidence) => confidence === 'name-match' || confidence === 'ambiguous'
// how a binding was found, in words (graph_data and the page say the same)
const VIA_TEXT = { mapper: 'a mapper declares it', env: 'an environment variable the infra sets', nameTemplate: 'a name the table\'s name or template matches' }
export const bindingHow = (b) => (b.via === 'mapper' ? VIA_TEXT.mapper : `${VIA_TEXT[b.via]}, in one ${b.pairing}`)
const hasWild = (name) => (parseName(name) || []).some((t) => t.wild)

// ── logical tables ──
// entities: [{ id, name, store }] → { groups: [{ id, name, members: [entity id], via }], notes: Map(entity id → note) }
export function logicalTables(entities) {
  const parent = new Map(entities.map((e) => [e.id, e.id]))
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x) }
  const how = new Map() // root → how its members were joined
  const byName = new Map()
  for (const e of entities) { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e) }
  for (const [name, list] of byName) for (const e of list.slice(1)) { join(list[0].id, e.id); how.set(find(list[0].id), hasWild(name) ? 'the same name template' : 'the same name') }
  const templates = [...byName.keys()].filter(hasWild)
  const notes = new Map()
  for (const [name, list] of byName) {
    if (hasWild(name)) continue
    const hits = templates.filter((t) => namesMatch(name, t)).sort()
    if (hits.length === 1) { const t = byName.get(hits[0])[0]; join(t.id, list[0].id); for (const e of list) how.set(find(t.id), 'an exact name its template matches'); continue }
    if (hits.length > 1) for (const e of list) notes.set(e.id, `its name matches ${hits.length} name templates (${hits.join(', ')}): grouped with none`)
  }
  const groups = new Map()
  for (const e of entities) { const r = find(e.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e) }
  const out = []
  for (const [root, members] of groups) {
    // named by its template when one has a wildcard (two exact names never share a group, so a name
    // names one group)
    const name = (members.find((e) => hasWild(e.name)) || members[0]).name
    out.push({ id: `table:${name}`, name, members: members.map((m) => m.id).sort(), via: members.length > 1 ? how.get(root) || 'the same name' : null })
  }
  return { groups: out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), notes }
}

// ── shapes ──
const kindOf = (t) => (!t ? 'any' : t.k === 'obj' ? 'object' : t.k)
function shapeOf(def, find, at, prefix = '', depth = 0, chain = new Set()) {
  const out = []
  if (!def || depth > DEPTH || chain.has(def.name)) return out
  const seen = new Set([...chain, def.name])
  const add = (f) => { if (out.length < 400) out.push(f) }
  const base = (path, f, kind, extra = {}) => ({ path, raw: f.raw ?? '', kind, nullable: !!f.nullable, default: f.default ?? null, line: f.line ?? def.line, file: at.path, repo: at.repo, type: at.type, ...extra })
  const fieldsOf = (fields, pre, d) => { for (const f of fields || []) for (const x of fieldOf(f, pre, d)) add(x) }
  const fieldOf = (f, pre, d) => {
    if (f.flatten) {
      const inner = f.t && f.t.k === 'ref' ? find(f.t.n, at) : null
      if (inner) return shapeOf(inner.def, find, { ...at, path: inner.path, repo: inner.repo }, pre, d + 1, seen)
      return [base(`${pre}*`, { ...f, raw: `${f.raw} (flattened)` }, kindOf(f.t))]
    }
    return typed(`${pre}${f.name}`, f, f.t, d)
  }
  const typed = (path, f, t, d) => {
    const list = []
    if (!t) return [base(path, f, 'any')]
    if (t.k === 'ref') {
      const inner = find(t.n, at)
      if (!inner) return [base(path, f, 'ref')]
      const x = inner.def
      if (x.kind === 'enum' && x.variants && x.variants.every((v) => v.unit) && !x.tag) return [base(path, f, 'enum', { values: x.variants.map((v) => v.name) })]
      if (x.values) return [base(path, f, 'enum', { values: x.values })]
      if (x.newtype) return typed(path, f, x.newtype, d)
      if (x.alias) return typed(path, f, x.alias, d)
      list.push(base(path, f, 'object'))
      if (d < DEPTH && !seen.has(x.name)) list.push(...shapeOf(x, find, { ...at, path: inner.path, repo: inner.repo }, `${path}.`, d + 1, seen))
      return list
    }
    if (t.k === 'list' || t.k === 'map') {
      list.push(base(path, f, t.k))
      const of = t.of
      const pre = `${path}${t.k === 'list' ? '[]' : '{}'}`
      if (of && (of.k === 'ref' || of.k === 'obj') && d < DEPTH) {
        const sub = typed(pre, { raw: '', line: f.line }, of, d + 1).slice(1) // the elements' fields, not the element itself
        list.push(...sub)
      }
      return list
    }
    if (t.k === 'obj') {
      list.push(base(path, f, 'object'))
      for (const e of t.ext || []) { const inner = find(e, at); if (inner) list.push(...shapeOf(inner.def, find, { ...at, path: inner.path, repo: inner.repo }, `${path}.`, d + 1, seen)) }
      for (const g of t.fields || []) list.push(...fieldOf(g, `${path}.`, d + 1))
      return list
    }
    if (t.k === 'enum') return [base(path, f, 'enum', { values: t.values })]
    return [base(path, f, t.k)]
  }
  for (const e of def.extends || []) { const inner = find(e, at); if (inner) for (const x of shapeOf(inner.def, find, { ...at, path: inner.path, repo: inner.repo }, prefix, depth + 1, seen)) add(x) }
  if (def.kind === 'enum') {
    const vs = def.variants || []
    const tagField = (name) => ({ path: `${prefix}${name}`, raw: 'tag', kind: 'enum', nullable: false, default: null, values: vs.map((v) => v.name), line: def.line, file: at.path, repo: at.repo, type: at.type })
    const variantFields = (pre) => { for (const v of vs) { if (v.fields) fieldsOf(v.fields, pre, depth); else if (v.t) for (const x of typed(`${pre}${v.name}`, { raw: '', line: v.line }, v.t, depth)) add(x) } }
    if (def.tag && def.content) { add(tagField(def.tag)); add({ ...tagField(def.content), raw: 'content', kind: 'object', values: undefined }); variantFields(`${prefix}${def.content}.`) }
    else if (def.tag) { add(tagField(def.tag)); variantFields(prefix) }
    else if (def.untagged) variantFields(prefix)
    else {
      // externally tagged: one member per variant, present when the item is that variant (a unit
      // variant is stored as its name alone, no member)
      for (const v of vs) {
        if (v.fields) { add({ path: `${prefix}${v.name}`, raw: 'variant', kind: 'object', nullable: true, default: null, line: v.line, file: at.path, repo: at.repo, type: at.type }); fieldsOf(v.fields, `${prefix}${v.name}.`, depth) }
        else if (v.t) for (const [k, x] of typed(`${prefix}${v.name}`, { raw: 'variant', line: v.line, nullable: true }, v.t, depth).entries()) add(k ? x : { ...x, nullable: true })
      }
    }
    return out
  }
  if (def.tag) add({ path: `${prefix}${def.tag}`, raw: 'tag', kind: 'enum', nullable: false, default: null, values: [def.name], line: def.line, file: at.path, repo: at.repo, type: at.type })
  if (def.newtype) { for (const x of typed(prefix.replace(/\.$/, '') || def.name, { raw: '', line: def.line }, def.newtype, depth)) add(x); return out }
  fieldsOf(def.fields, prefix, depth)
  // one entry per path: a flattened type may repeat one the struct states
  const seenPath = new Set()
  return out.filter((f) => (seenPath.has(f.path) ? false : seenPath.add(f.path)))
}

// ── binding ──
// codeRows: [{ repo, extractor, code }]; groups from logicalTables; entities: Map(id → entity);
// wiring: [{ name: the variable, entity: id, repo, path, line }] (what the infra sets)
export function bindItems(codeRows, groups, entities, wiring) {
  const groupOf = new Map()
  for (const g of groups) for (const m of g.members) groupOf.set(m, g)
  // types by name: repo → name → [{ def, path, repo }]
  const defs = new Map(), all = new Map()
  const addDef = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
  for (const r of codeRows) for (const t of r.code.types || []) { const v = { def: t, path: r.code.path, repo: r.repo, lang: r.code.lang, extractor: r.extractor }; addDef(defs, `${r.repo}\0${t.name}`, v); addDef(all, t.name, v) }
  // a name from a file: its own, else its repository's one, else the project's one
  const find = (name, at) => {
    const own = (defs.get(`${at.repo}\0${name}`) || []).filter((v) => v.path === at.path)
    if (own.length) return own[0]
    const repo = defs.get(`${at.repo}\0${name}`) || []
    if (repo.length === 1) return repo[0]
    if (repo.length) return null
    const proj = all.get(name) || []
    return proj.length === 1 ? proj[0] : null
  }
  // constants by name, as types are
  const consts = new Map(), constsAll = new Map()
  for (const r of codeRows) for (const c of r.code.consts || []) { const v = { c, path: r.code.path, repo: r.repo }; addDef(consts, `${r.repo}\0${c.name}`, v); addDef(constsAll, c.name, v) }
  const findConst = (name, at) => {
    const list = consts.get(`${at.repo}\0${name}`) || []
    const own = list.filter((v) => v.path === at.path)
    if (own.length) return own[0]
    if (list.length === 1) return list[0]
    if (list.length) return null
    const proj = constsAll.get(name) || []
    return proj.length === 1 ? proj[0] : null
  }
  const setBy = new Map() // variable → [wiring]
  for (const w of wiring) addDef(setBy, w.name, w)
  const tables = [...entities.values()]

  // what names a table, as refs: [{ group, via, evidence: [Evidence], test }]
  const refsOf = (sink, at, test, via0 = null) => {
    const out = []
    for (const e of sink.env || []) {
      for (const w of setBy.get(e.name) || []) {
        const g = groupOf.get(w.entity)
        if (g) out.push({ group: g, via: 'env', test, evidence: [...(via0 ? [via0] : []), { what: 'reads', repo: at.repo, path: at.path, line: e.line, text: e.name, ...(test ? { test: true } : {}) }, { what: 'sets', repo: w.repo, path: w.path, line: w.line, text: `${w.name} = ${entities.get(w.entity)?.name}` }] })
      }
    }
    for (const n of sink.names || []) {
      const hit = new Set()
      for (const e of tables) if (!hit.has(groupOf.get(e.id)) && namesMatch(n.text, e.name)) hit.add(groupOf.get(e.id))
      for (const g of hit) if (g) out.push({ group: g, via: 'nameTemplate', test, evidence: [...(via0 ? [via0] : []), { what: 'builds', repo: at.repo, path: at.path, line: n.line, text: n.text, ...(test ? { test: true } : {}) }] })
    }
    return out
  }
  const constRefs = (name, at, test) => {
    const k = findConst(name, at)
    if (!k) return []
    return refsOf(k.c, { repo: k.repo, path: k.path }, test || !!k.c.test, { what: 'const', repo: k.repo, path: k.path, line: k.c.line, text: name })
  }

  // item types and their conversions
  const items = new Map() // def → item
  const unresolved = []
  const itemOf = (v) => {
    if (!items.has(v.def)) items.set(v.def, { id: `${v.repo}:${v.def.name}`, repo: v.repo, name: v.def.name, kind: v.def.kind, path: v.path, line: v.def.line, lang: v.lang, extractor: v.extractor, fields: null, bound: [], converts: [], notes: [] })
    return items.get(v.def)
  }
  for (const r of codeRows) for (const t of r.code.types || []) if (t.converts) { const it = itemOf({ def: t, path: r.code.path, repo: r.repo, lang: r.code.lang, extractor: r.extractor }); it.converts.push({ path: r.code.path, line: t.converts, how: 'implements a conversion' }) }

  // candidates: item → group id → { rank, via, pairing, evidence, group }
  const cand = new Map()
  // a conversion in test code ranks below every conversion of the code it tests: a test that builds
  // an item for another table's fixture says less than the code that writes it (its confidence is
  // still its way's)
  const offer = (it, ref, pairing, conv) => {
    const base = RANK[ref.via === 'mapper' ? 'mapper' : `${ref.via}|${pairing}`]
    const rank = base - (conv.test ? TEST_RANK : 0)
    if (!cand.has(it)) cand.set(it, new Map())
    const m = cand.get(it), cur = m.get(ref.group.id)
    if (cur && cur.rank > rank) return
    if (cur && cur.rank === rank) { cur.sites++; return }
    m.set(ref.group.id, { rank, base, via: ref.via, pairing, group: ref.group, sites: 1, evidence: [conv, ...ref.evidence].slice(0, MAX_EVIDENCE) })
  }
  for (const r of codeRows) {
    const at = { repo: r.repo, path: r.code.path }
    const fns = r.code.fns || []
    // each function's refs, with the constants it reads; the file's constants on their own
    const fnRefs = fns.map((f) => [...refsOf(f, at, !!f.test), ...f.uses.flatMap((u) => constRefs(u, at, !!f.test))])
    const fileConsts = (r.code.consts || []).flatMap((c) => refsOf(c, at, !!c.test, { what: 'const', repo: r.repo, path: at.path, line: c.line, text: c.name }))
    for (let i = 0; i < fns.length; i++) {
      const f = fns[i]
      for (const cv of f.converts) {
        const v = find(cv.type, at)
        if (!v) { if (unresolved.length < 200) unresolved.push({ repo: r.repo, type: cv.type, path: at.path, line: cv.line }); continue }
        const it = itemOf(v)
        if (it.converts.length < 20) it.converts.push({ path: at.path, repo: r.repo, line: cv.line, how: cv.how })
        const conv = { what: 'converts', repo: r.repo, path: at.path, line: cv.line, text: `${cv.type} (${cv.how}) in ${f.name}`, ...(f.test ? { test: true } : {}) }
        for (const ref of fnRefs[i]) offer(it, ref, 'function', conv)
        for (let j = 0; j < fns.length; j++) if (j !== i) for (const ref of fnRefs[j]) offer(it, ref, 'file', conv)
        for (const ref of fileConsts) offer(it, ref, 'file', conv)
      }
    }
    // the mapper hook: a code file's facts may declare its bindings (no extractor gives them yet)
    for (const m of r.code.mappers || []) {
      const v = find(m.type, at), e = [...entities.values()].find((x) => x.name === m.table)
      if (!v || !e) continue
      offer(itemOf(v), { group: groupOf.get(e.id), via: 'mapper', evidence: [{ what: 'declares', repo: r.repo, path: at.path, line: m.line, text: `${m.type} → ${m.table}` }] }, 'mapper', { what: 'converts', repo: r.repo, path: at.path, line: m.line, text: m.type })
    }
  }

  const bindings = []
  for (const [def, it] of items) {
    it.fields = shapeOf(def, find, { repo: it.repo, path: it.path, type: it.name })
    const cs = [...(cand.get(it)?.values() || [])].sort((a, b) => b.rank - a.rank || (a.group.name < b.group.name ? -1 : 1))
    if (!cs.length) continue
    const best = cs[0].rank, top = cs.filter((c) => c.rank === best)
    const conf = (c) => (c.rank === best && top.length > 1 ? 'ambiguous' : CONF(c.base))
    for (const c of top) {
      const b = {
        item: it.id, type: it.name, repo: it.repo, path: it.path, line: it.line, group: c.group.id, table: c.group.name, entities: c.group.members,
        via: c.via, pairing: c.pairing, confidence: conf(c), sites: c.sites, evidence: c.evidence,
        rivals: cs.filter((x) => x !== c).map((x) => ({ group: x.group.id, table: x.group.name, via: x.via, pairing: x.pairing, confidence: conf(x) })),
      }
      bindings.push(b)
      it.bound.push(c.group.id)
    }
  }
  const list = [...items.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { items: list, bindings: bindings.sort((a, b) => (a.item < b.item ? -1 : a.item > b.item ? 1 : a.table < b.table ? -1 : 1)), unresolved }
}

// An item field as a model field of the table (reconcile's shape: type { raw, norm }, sources).
export function itemField(f, b, extractor) {
  return {
    name: f.path, type: { raw: f.raw || f.kind, norm: normType(f.raw || f.kind) }, nullable: f.nullable, default: f.default ?? null, generated: null,
    sources: [{ repo: f.repo, path: f.file, line: f.line, kind: 'code', extractor, confidence: b.confidence }], conflicts: [],
    item: [itemOf(f, b)],
  }
}
export const itemOf = (f, b) => ({ type: b.type, kind: f.kind, raw: f.raw, nullable: f.nullable, ...(f.default ? { default: f.default } : {}), ...(f.values ? { values: f.values } : {}), repo: f.repo, path: f.file, line: f.line, confidence: b.confidence })
