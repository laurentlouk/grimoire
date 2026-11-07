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
//     templates match joins neither, and says so.
// Within one repository's store, one exact name is already one table (reconcile.mjs). Across
// repositories, a bare name is no evidence: two repositories that each declare a `sessions` table keep
// two tables, and each says the other exists. Nothing else groups: two exact names never do (`Orders`
// and `{env}-{project}-orders` stay apart: no letter-case folding, no plural, no edit distance).
// reconcile.mjs compares the declarations of a group as it compares one table's: their disagreements
// are its conflicts. A group is named by its template (else its name), and labelled by the first
// member's id when another group shares that name.
//
// Item types: the types code converts to or from an item (a conversion: readers/code.mjs), resolved by
// name among the types of the converting file's language (its own file's, else its repository's one,
// else the project's one; two of one name and none in the file: not resolved), and the types that
// implement a conversion. Each one's shape is its fields as stored, nested by dotted path: a struct
// field's own fields under `field.`, a list's elements' under `field[].`, a map's values' under
// `field{}.`; flatten inlines a type's fields; a newtype or an alias is what it holds; an enum of unit
// variants is an enum of its stored names; a data enum follows serde's tagging:
//   internally tagged  the tag, beside a struct variant's fields or a newtype variant's struct's (a
//                      newtype of anything else is one serde rejects: noted);
//   adjacently tagged  the tag, and the content key holding each variant's value (a struct's fields
//                      under it; a string or a number the value itself);
//   untagged           the struct and newtype variants' fields together;
//   externally tagged  one member per variant (its value under it), a unit variant none.
// TypeScript's `extends` and `&` inline. Bounded: up to DEPTH levels; a type already being followed
// (a struct, a newtype, an alias that holds itself, directly or not) is a leaf; each type's expansion
// at a depth is computed once and reused; an item keeps MAX_FIELDS fields and one reconcile builds
// WORK fields at most, the shape cut there and noted.
//
// Binding an item type to a logical table, in falling confidence, each way with its evidence:
//   mapper       a mapper declares it (no extractor gives one yet: the hook is `mappers` in a code
//                file's facts, [{ type, table, line }]): declared
//   env          the code reads an environment variable the infra sets to the table (a Terraform
//                function's `environment { variables }`, a template's `Environment.Variables`)
//   nameTemplate the code builds a name the table's name or template matches (readers/names.mjs); a
//                literal equal to an exact table name is evidence in its own repository only
// and how close the conversion and the name are (D2's call site, the research's co-occurrence):
//   function     both in one function (a constant the function reads counts as its own)
//   file         only in one file
// Confidence: mapper → declared; env in one function → convention; env in one file, or a name in one
// function or one file → name-match; several tables at the type's best rank → ambiguous, each. Ranks
// (best first): mapper, env in a function, env in a file, a name in a function, a name in a file;
// then the same again for a conversion in test code (a test's own item, built for another table's
// fixture, says less than the code it tests). A table only test code names (`testOnly`) ranks no
// higher than a name, and says so. Every other table the type pairs with is listed as a rival. A type
// no table pairs with is unbound. Pairing goes per type and table, never per conversion and name.
//
// What it adds to the model:
//   model.items     [{ id: '<repo>:<name>', repo, name, kind, path, line, lang, fields: [ItemField],
//                     bound: [table group ids], converts: [{ path, line, how }] (capped), notes }]
//   model.bindings  [{ item: id, type, repo, path, line, group, table: its label, entities: [entity
//                     ids], via, pairing, confidence, sites: the functions pairing them, testOnly,
//                     evidence: [Evidence], rivals: [{ group, table, via, pairing, confidence, testOnly }] }]
//   model.unresolved [{ repo, type, path, line }] (a converted name with no single definition)
//   per member entity: `bound` (its bindings, as above) and, from each binding not ambiguous, its item
//   type's fields in `fields` (a stored attribute AttributeDefinitions also types gains an `item` and
//   the code's source; one only the item states is a field of its own, source kind code), so the diff
//   and the delta address them as `<table>.<field.path>`.
//   ItemField { path, raw, kind: string | number | bool | any | list | map | object | enum | ref,
//               nullable, default, values?, line, file, repo }
//   Evidence  { what: converts | builds | reads | sets | const, repo, path, line, text, test? }
import { namesMatch, parseName } from './readers/names.mjs'
import { normType } from './model.mjs'

export const DEPTH = 6
export const MAX_FIELDS = 400
export const WORK = 200_000
const MAX_EVIDENCE = 4
const RANK = { mapper: 5, 'env|function': 4, 'env|file': 3, 'nameTemplate|function': 2, 'nameTemplate|file': 1 }
const TEST_RANK = 10
const CONF = (rank) => (rank >= 5 ? 'declared' : rank === 4 ? 'convention' : 'name-match')
export const CONFIDENCES = ['declared', 'convention', 'name-match', 'ambiguous']
// below convention: drawn dashed, its rivals listed (spec, Binding mistakes)
export const dashed = (confidence) => confidence === 'name-match' || confidence === 'ambiguous'
// how a binding was found, in words (graph_data and the page say the same)
const VIA_TEXT = { mapper: 'a mapper declares it', env: 'an environment variable the infra sets', nameTemplate: 'a name the table\'s name or template matches' }
export const bindingHow = (b) => (b.via === 'mapper' ? VIA_TEXT.mapper : `${VIA_TEXT[b.via]}, in one ${b.pairing}${b.testOnly ? ', named only in test code' : ''}`)
const hasWild = (name) => (parseName(name) || []).some((t) => t.wild)
const repoOf = (id) => id.slice(0, id.indexOf(':'))

// ── logical tables ──
// entities: [{ id, name }] → { groups: [{ id, name, label, members: [entity id], via }], notes: Map(entity id → note) }
export function logicalTables(entities) {
  const parent = new Map(entities.map((e) => [e.id, e.id]))
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
  const join = (a, b) => { const x = find(a), y = find(b); if (x !== y) parent.set(y, x) }
  const how = new Map() // root → how its members were joined
  const byName = new Map()
  for (const e of entities) { if (!byName.has(e.name)) byName.set(e.name, []); byName.get(e.name).push(e) }
  const notes = new Map()
  for (const [name, list] of byName) {
    if (!hasWild(name)) {
      // a bare name in two repositories: two tables (one store per repository holds one table per name)
      for (const e of list) { const others = list.filter((x) => x !== e).map((x) => x.id); if (others.length) notes.set(e.id, `${others.join(', ')} also name${others.length === 1 ? 's' : ''} a table ${name}: not grouped (the same name in two repositories is no evidence they are one table)`) }
      continue
    }
    for (const e of list.slice(1)) { join(list[0].id, e.id); how.set(find(list[0].id), 'the same name template') }
  }
  const templates = [...byName.keys()].filter(hasWild)
  for (const [name, list] of byName) {
    if (hasWild(name)) continue
    const hits = templates.filter((t) => namesMatch(name, t)).sort()
    if (hits.length === 1) { const t = byName.get(hits[0])[0]; for (const e of list) { join(t.id, e.id); how.set(find(t.id), 'an exact name its template matches') } continue }
    if (hits.length > 1) for (const e of list) notes.set(e.id, `its name matches ${hits.length} name templates (${hits.join(', ')}): grouped with none`)
  }
  const groups = new Map()
  for (const e of entities) { const r = find(e.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(e) }
  const out = []
  for (const [root, members] of groups) {
    const name = (members.find((e) => hasWild(e.name)) || members[0]).name
    out.push({ name, members: members.map((m) => m.id).sort(), via: members.length > 1 ? how.get(root) || 'the same name template' : null })
  }
  // a name two groups share (two repositories' tables of one name) is told apart by where it is declared
  const count = new Map()
  for (const g of out) count.set(g.name, (count.get(g.name) || 0) + 1)
  for (const g of out) { g.label = count.get(g.name) > 1 ? g.members[0] : g.name; g.id = `table:${g.label}` }
  return { groups: out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)), notes }
}

// ── shapes ──
// One shaper per reconcile: expansions memoised by (type, depth left), a work budget shared by every
// item. A shape field's path is relative to the type that states it; a use prefixes it.
const kindOf = (t) => (!t ? 'any' : t.k === 'obj' ? 'object' : t.k)
function shaper(find) {
  const memo = new Map() // def → Map(depth left → { fields, reached: Set(def) })
  const open = new Set() // the types being followed now: one met again is a leaf
  const notes = new Map() // def → Set(note)
  const budget = { left: WORK }
  const note = (def, text) => { if (!notes.has(def)) notes.set(def, new Set()); notes.get(def).add(text) }
  // a list being built: fields pushed while the item's cap and the budget allow
  const sink = () => { const list = []; list.cut = false; return list }
  const put = (list, x) => { if (list.length >= MAX_FIELDS || budget.left <= 0) { list.cut = true; return false } budget.left--; list.push(x); return true }
  const under = (list, pre, sub) => { for (const x of sub) if (!put(list, { ...x, path: pre + x.path })) break; if (sub.cut) list.cut = true }
  const merge = (into, set) => { for (const d of set) into.add(d) }

  // a type's fields, relative to it, at a depth left
  const expand = (v, left, reached) => {
    const def = v.def
    if (left < 0 || open.has(def)) return []
    const byDepth = memo.get(def)
    if (byDepth && byDepth.has(left)) { const m = byDepth.get(left); merge(reached, m.reached); return m.fields }
    open.add(def)
    const out = sink(), mine = new Set([def])
    try {
      const at = { repo: v.repo, path: v.path, lang: v.lang }
      // a field as stored; `fat` where it is declared (its file and line)
      const base = (path, f, kind, extra = {}, fat = at) => ({ path, raw: f.raw ?? '', kind, nullable: !!f.nullable, default: f.default ?? null, line: f.line ?? def.line, file: fat.path, repo: fat.repo, ...extra })
      // a type node at a path: the field itself, then what it holds. `ctx` resolves its names (a
      // newtype's or an alias's held type is read where that newtype is declared), `fat` is where the
      // field is declared.
      const typed = (path, f, t, l, ctx = at, fat = at) => {
        const list = sink()
        if (!t) { put(list, base(path, f, 'any', {}, fat)); return list }
        if (t.k === 'ref') {
          const inner = find(t.n, ctx)
          if (!inner) { put(list, base(path, f, 'ref', {}, fat)); return list }
          const x = inner.def
          if (x.kind === 'enum' && x.variants && x.variants.every((w) => w.unit) && !x.tag) { put(list, base(path, f, 'enum', { values: x.variants.map((w) => w.name) }, fat)); return list }
          if (x.values) { put(list, base(path, f, 'enum', { values: x.values }, fat)); return list }
          if (x.newtype || x.alias) {
            // a newtype or an alias is what it holds, followed under the same guard as a struct
            if (open.has(x) || l <= 0) { put(list, base(path, f, 'ref', {}, fat)); return list }
            open.add(x); mine.add(x)
            try { const held = x.newtype || x.alias; return typed(path, { ...f, nullable: !!f.nullable || !!held.nullable }, held, l - 1, { repo: inner.repo, path: inner.path, lang: inner.lang }, fat) } finally { open.delete(x) }
          }
          put(list, base(path, f, 'object', {}, fat))
          if (l > 0) under(list, `${path}.`, expand(inner, l - 1, mine))
          return list
        }
        if (t.k === 'list' || t.k === 'map') {
          put(list, base(path, f, t.k, {}, fat))
          const of = t.of
          if (of && (of.k === 'ref' || of.k === 'obj') && l > 0) under(list, '', typed(`${path}${t.k === 'list' ? '[]' : '{}'}`, { raw: '', line: f.line }, of, l - 1, ctx, fat).slice(1)) // the elements' fields, not the element
          return list
        }
        if (t.k === 'obj') {
          put(list, base(path, f, 'object', {}, fat))
          for (const e of t.ext || []) { const inner = find(e, ctx); if (inner && l > 0) under(list, `${path}.`, expand(inner, l - 1, mine)) }
          for (const g of t.fields || []) under(list, '', fieldOf(g, `${path}.`, l - 1, ctx))
          return list
        }
        if (t.k === 'enum') { put(list, base(path, f, 'enum', { values: t.values }, fat)); return list }
        put(list, base(path, f, t.k, {}, fat))
        return list
      }
      const fieldOf = (f, pre, l, ctx = at) => {
        if (f.flatten) {
          const inner = f.t && f.t.k === 'ref' ? find(f.t.n, ctx) : null
          if (inner && l >= 0) { const list = sink(); under(list, pre, expand(inner, l, mine)); return list }
          const list = sink(); put(list, base(`${pre}*`, { ...f, raw: `${f.raw} (flattened)` }, kindOf(f.t), {}, ctx)); return list
        }
        return typed(`${pre}${f.name}`, f, f.t, l, ctx, ctx)
      }
      const fieldsOf = (fields, pre, l) => { for (const f of fields || []) under(out, '', fieldOf(f, pre, l)) }
      // a variant's own fields as stored inline: a struct variant's, a newtype variant's struct's; null
      // when its value is no struct (a string, a number, a list)
      const inlineOf = (w, l) => {
        if (w.fields) { const list = sink(); for (const f of w.fields) under(list, '', fieldOf(f, '', l)); return list }
        let t = w.t, held = v
        for (let hop = 0; t && t.k === 'ref' && hop < DEPTH; hop++) {
          const inner = find(t.n, { repo: held.repo, path: held.path, lang: held.lang })
          if (!inner) return null
          const x = inner.def
          if (x.newtype || x.alias) { t = x.newtype || x.alias; held = inner; continue }
          if (x.kind === 'enum' && x.variants && x.variants.every((u) => u.unit) && !x.tag) return null
          if (x.values) return null
          return expand(inner, l, mine)
        }
        if (t && t.k === 'obj') { const list = sink(); for (const g of t.fields || []) under(list, '', fieldOf(g, '', l)); return list }
        return null
      }
      for (const e of def.extends || []) { const inner = find(e, at); if (inner) under(out, '', expand(inner, left - 1, mine)) }
      if (def.kind === 'enum') {
        const vs = def.variants || []
        const tagField = (name) => base(name, { raw: 'tag', line: def.line }, 'enum', { values: vs.map((w) => w.name) })
        const variantName = (w) => `${def.name}::${w.ident || w.name}`
        if (def.tag && def.content) {
          put(out, tagField(def.tag))
          const kinds = new Set(), inl = []
          for (const w of vs) {
            if (w.unit) continue
            const i = inlineOf(w, left - 1)
            if (i) { kinds.add('object'); inl.push(i) } else kinds.add(kindOf(w.t))
          }
          put(out, base(def.content, { raw: 'content', line: def.line }, kinds.size === 1 ? [...kinds][0] : kinds.size ? 'any' : 'object'))
          for (const i of inl) under(out, `${def.content}.`, i)
        } else if (def.tag) {
          put(out, tagField(def.tag))
          for (const w of vs) {
            if (w.unit) continue
            const i = inlineOf(w, left - 1)
            if (i) under(out, '', i)
            else note(def, `${variantName(w)}: a newtype variant of a ${kindOf(w.t)} cannot be internally tagged (serde rejects it at run time): its value is not in the shape`)
          }
        } else if (def.untagged) {
          for (const w of vs) { if (w.unit) continue; const i = inlineOf(w, left - 1); if (i) under(out, '', i) }
        } else {
          for (const w of vs) {
            if (w.fields) { put(out, base(w.name, { raw: 'variant', line: w.line, nullable: true }, 'object')); for (const f of w.fields) under(out, '', fieldOf(f, `${w.name}.`, left - 1)) }
            else if (w.t) { const sub = typed(w.name, { raw: 'variant', line: w.line, nullable: true }, w.t, left - 1); under(out, '', sub) }
          }
        }
      } else {
        if (def.tag) put(out, base(def.tag, { raw: 'tag', line: def.line }, 'enum', { values: [def.name] }))
        if (def.newtype) under(out, '', typed(def.name, { raw: '', line: def.line }, def.newtype, left - 1))
        else if (def.alias) under(out, '', typed(def.name, { raw: '', line: def.line }, def.alias, left - 1))
        else fieldsOf(def.fields, '', left - 1)
      }
    } finally { open.delete(def) }
    // one entry per path: a flattened type may repeat one the struct states
    const seen = new Set()
    const fields = out.filter((f) => (seen.has(f.path) ? false : seen.add(f.path)))
    fields.cut = out.cut
    if (!memo.has(def)) memo.set(def, new Map())
    memo.get(def).set(left, { fields, reached: mine })
    merge(reached, mine)
    return fields
  }
  // an item's shape and the notes of the types it reached
  return (v) => {
    const reached = new Set()
    const fields = expand(v, DEPTH, reached)
    const out = [...new Set([...reached].flatMap((d) => [...(notes.get(d) || [])]))]
    if (fields.cut || fields.length >= MAX_FIELDS) out.push(budget.left <= 0 ? `its shape is cut: the work for item shapes (${WORK} fields) ran out` : `its shape is cut at ${MAX_FIELDS} fields`)
    return { fields: fields.slice(0, MAX_FIELDS), notes: out }
  }
}

// ── what names a table: shared by the item binding and the access patterns (data/access.mjs) ──
// codeRows: [{ repo, code: { lang, path, consts } }] (more rows only add constants: one of a path
// and name already listed is not listed again); groups from logicalTables; entities: Map(id →
// entity); wiring: [{ name: the variable, entity: id, repo, path, line }] (what the infra sets).
//   groupOf(entity id) → its logical table
//   refsOf(sink { names, env }, at { repo, path }, test, via0?) → [{ group, via, test, evidence }]
//   constRefs(name, at { repo, path, lang }, test) → the refs of the constant `name` resolves to
//   findConst(name, at) → { c, path, repo } | null: its file's, else its repository's one, else the
//                          project's one, in its language
//   collapse(refs) → one ref per logical table (an environment read over a name, production code
//                    over a test)
const addTo = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v) }
export function tableResolver(codeRows, groups, entities, wiring) {
  const groupOf = new Map()
  for (const g of groups) for (const m of g.members) groupOf.set(m, g)
  const consts = new Map(), constsAll = new Map(), seen = new Set()
  for (const r of codeRows) {
    for (const c of r.code.consts || []) {
      const k = `${r.repo}\0${r.code.path}\0${c.name}`
      if (seen.has(k)) continue
      seen.add(k)
      const v = { c, path: r.code.path, repo: r.repo }
      addTo(consts, `${r.repo}\0${r.code.lang}\0${c.name}`, v); addTo(constsAll, `${r.code.lang}\0${c.name}`, v)
    }
  }
  const findConst = (name, at) => {
    const list = consts.get(`${at.repo}\0${at.lang}\0${name}`) || []
    const own = list.filter((v) => v.path === at.path)
    if (own.length) return own[0]
    if (list.length === 1) return list[0]
    if (list.length) return null
    const proj = constsAll.get(`${at.lang}\0${name}`) || []
    return proj.length === 1 ? proj[0] : null
  }
  const setBy = new Map() // variable → [wiring]
  for (const w of wiring) addTo(setBy, w.name, w)
  const tables = [...entities.values()]
  // the logical tables a built name matches, once per name and repository (code repeats its names): a
  // literal equal to an exact table name is evidence in its own repository only
  const matched = new Map()
  const matching = (text, repo) => {
    const k = `${repo}\0${text}`
    if (!matched.has(k)) {
      const hit = new Set(), bare = !text.includes('{')
      for (const e of tables) {
        const g = groupOf.get(e.id)
        if (!g || hit.has(g) || (bare && !hasWild(e.name) && repoOf(e.id) !== repo)) continue
        if (namesMatch(text, e.name)) hit.add(g)
      }
      matched.set(k, [...hit])
    }
    return matched.get(k)
  }

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
      for (const g of matching(n.text, at.repo)) out.push({ group: g, via: 'nameTemplate', test, evidence: [...(via0 ? [via0] : []), { what: 'builds', repo: at.repo, path: at.path, line: n.line, text: n.text, ...(test ? { test: true } : {}) }] })
    }
    return out
  }
  const constRefs = (name, at, test) => {
    const k = findConst(name, at)
    if (!k) return []
    return refsOf(k.c, { repo: k.repo, path: k.path }, test || !!k.c.test, { what: 'const', repo: k.repo, path: k.path, line: k.c.line, text: name })
  }
  // a function's refs, one per logical table: an environment read over a name, production code over a test
  const better = (x, y) => (x.via === 'env' && y.via !== 'env') || (x.via === y.via && !x.test && y.test)
  const collapse = (refs) => { const m = new Map(); for (const x of refs) { const cur = m.get(x.group.id); if (!cur || better(x, cur)) m.set(x.group.id, x) } return [...m.values()] }
  return { groupOf, refsOf, constRefs, findConst, collapse, tables }
}

// ── binding ──
// codeRows: [{ repo, extractor, code }]; groups, entities and wiring as tableResolver takes them; R:
// the resolver, when one is shared (its rows may hold more constants than codeRows)
export function bindItems(codeRows, groups, entities, wiring, R = tableResolver(codeRows, groups, entities, wiring)) {
  const { groupOf, refsOf, constRefs, collapse, tables } = R
  // types by name, per language: (repo, language, name) and (language, name)
  const defs = new Map(), all = new Map()
  for (const r of codeRows) for (const t of r.code.types || []) { const v = { def: t, path: r.code.path, repo: r.repo, lang: r.code.lang, extractor: r.extractor }; addTo(defs, `${r.repo}\0${r.code.lang}\0${t.name}`, v); addTo(all, `${r.code.lang}\0${t.name}`, v) }
  // a name from a file: its own, else its repository's one, else the project's one, in its language
  const find = (name, at) => {
    const list = defs.get(`${at.repo}\0${at.lang}\0${name}`) || []
    const own = list.filter((v) => v.path === at.path)
    if (own.length) return own[0]
    if (list.length === 1) return list[0]
    if (list.length) return null
    const proj = all.get(`${at.lang}\0${name}`) || []
    return proj.length === 1 ? proj[0] : null
  }

  // item types and their conversions
  const items = new Map() // def → item
  const located = new Map() // item → its definition { def, path, repo, lang }
  const unresolved = []
  const itemOf = (v) => {
    if (!items.has(v.def)) { const it = { id: `${v.repo}:${v.def.name}`, repo: v.repo, name: v.def.name, kind: v.def.kind, path: v.path, line: v.def.line, lang: v.lang, extractor: v.extractor, fields: null, bound: [], converts: [], notes: [] }; items.set(v.def, it); located.set(it, v) }
    return items.get(v.def)
  }
  for (const r of codeRows) for (const t of r.code.types || []) if (t.converts) { const it = itemOf({ def: t, path: r.code.path, repo: r.repo, lang: r.code.lang, extractor: r.extractor }); it.converts.push({ path: r.code.path, line: t.converts, how: 'implements a conversion' }) }

  // candidates: item → group id → { rank, base, via, pairing, evidence, group, sites, testOnly }
  const cand = new Map()
  // a conversion in test code ranks below every conversion of the code it tests: a test that builds
  // an item for another table's fixture says less than the code that writes it; a table only test
  // code names ranks no higher than a name (and says so)
  const offer = (it, ref, pairing, conv) => {
    let base = RANK[ref.via === 'mapper' ? 'mapper' : `${ref.via}|${pairing}`]
    if (ref.test && ref.via !== 'mapper') base = Math.min(base, RANK[`nameTemplate|${pairing}`])
    const rank = base - (conv.test ? TEST_RANK : 0)
    if (!cand.has(it)) cand.set(it, new Map())
    const m = cand.get(it), cur = m.get(ref.group.id)
    if (cur && cur.rank > rank) return
    const evidence = () => [conv, ...ref.evidence].slice(0, MAX_EVIDENCE)
    if (cur && cur.rank === rank) {
      cur.sites++
      if (cur.testOnly && !ref.test) Object.assign(cur, { testOnly: false, via: ref.via, evidence: evidence() }) // production evidence first
      return
    }
    m.set(ref.group.id, { rank, base, via: ref.via, pairing, group: ref.group, sites: 1, testOnly: !!ref.test && ref.via !== 'mapper', evidence: evidence() })
  }
  for (const r of codeRows) {
    const at = { repo: r.repo, path: r.code.path, lang: r.code.lang }
    const fns = r.code.fns || []
    // each function's refs, with the constants it reads, one per table; the file's constants on their own
    const fnRefs = fns.map((f) => collapse([...refsOf(f, at, !!f.test), ...(f.uses || []).flatMap((u) => constRefs(u, at, !!f.test))]))
    const fileConsts = collapse((r.code.consts || []).flatMap((c) => refsOf(c, at, !!c.test, { what: 'const', repo: r.repo, path: at.path, line: c.line, text: c.name })))
    // the file's conversions per item type: the functions converting it, with the first conversion of each
    const conv = new Map() // item → { fns: Map(fn index → evidence), first, prod }
    fns.forEach((f, i) => {
      for (const cv of f.converts || []) {
        const v = find(cv.type, at)
        if (!v) { if (unresolved.length < 200) unresolved.push({ repo: r.repo, type: cv.type, path: at.path, line: cv.line }); continue }
        const it = itemOf(v)
        if (it.converts.length < 20) it.converts.push({ path: at.path, repo: r.repo, line: cv.line, how: cv.how })
        const e = { what: 'converts', repo: r.repo, path: at.path, line: cv.line, text: `${cv.type} (${cv.how}) in ${f.name}`, ...(f.test ? { test: true } : {}) }
        if (!conv.has(it)) conv.set(it, { fns: new Map(), first: e, prod: null })
        const c = conv.get(it)
        if (!c.fns.has(i)) c.fns.set(i, e)
        if (!c.prod && !f.test) c.prod = e
      }
    })
    // paired per type and table: each converting function with its own refs; every other function's
    // refs and the file's constants with the file's first conversion (production code's when there is one)
    for (const [it, c] of conv) {
      for (const [i, e] of c.fns) for (const ref of fnRefs[i]) offer(it, ref, 'function', e)
      const e = c.prod || c.first
      fnRefs.forEach((refs, j) => { if (!c.fns.has(j)) for (const ref of refs) offer(it, ref, 'file', e) })
      for (const ref of fileConsts) offer(it, ref, 'file', e)
    }
    // the mapper hook: a code file's facts may declare its bindings (no extractor gives them yet)
    for (const m of r.code.mappers || []) {
      const v = find(m.type, at), e = tables.find((x) => x.name === m.table)
      if (!v || !e || !groupOf.get(e.id)) continue
      offer(itemOf(v), { group: groupOf.get(e.id), via: 'mapper', evidence: [{ what: 'declares', repo: r.repo, path: at.path, line: m.line, text: `${m.type} → ${m.table}` }] }, 'mapper', { what: 'converts', repo: r.repo, path: at.path, line: m.line, text: m.type })
    }
  }

  const shape = shaper(find)
  const bindings = []
  for (const it of items.values()) {
    const s = shape(located.get(it))
    it.fields = s.fields
    it.notes.push(...s.notes)
    const cs = [...(cand.get(it)?.values() || [])].sort((a, b) => b.rank - a.rank || (a.group.label < b.group.label ? -1 : 1))
    if (!cs.length) continue
    const best = cs[0].rank, top = cs.filter((c) => c.rank === best)
    const conf = (c) => (c.rank === best && top.length > 1 ? 'ambiguous' : CONF(c.base))
    for (const c of top) {
      bindings.push({
        item: it.id, type: it.name, repo: it.repo, path: it.path, line: it.line, group: c.group.id, table: c.group.label, entities: c.group.members,
        via: c.via, pairing: c.pairing, confidence: conf(c), sites: c.sites, testOnly: c.testOnly, evidence: c.evidence,
        rivals: cs.filter((x) => x !== c).map((x) => ({ group: x.group.id, table: x.group.label, via: x.via, pairing: x.pairing, confidence: conf(x), testOnly: x.testOnly })),
      })
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
