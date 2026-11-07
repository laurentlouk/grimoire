// grimoire graph · data · the SQL code sends, against the model (spec D2's `inferred` kind, the least
// trusted): the statements extractors/sql-queries.mjs read, per repository, either attached to the
// store that declares their tables or deduced into a store of their own. Run by reconcile.mjs once the
// declarations are merged; nothing here changes a declared fact.
//
// Which store a file's queries go to, per repository, never across two (no evidence ties them):
//   its dialect   the file's own SQL client import (`pg`, `mysql2`, `github.com/lib/pq`: data/extractors
//                 sql-queries.mjs CLIENTS), else a type naming the database (sqlx's PgPool), else the
//                 repository's clients when they speak one dialect, else what its SQL says (a cast
//                 `::`, ON DUPLICATE KEY: readers/sql-query.mjs, the DDL sniffer), else unknown;
//   attached      to a declared SQL store of the repository (migrations, a snapshot, a dump, a schema)
//                 only on evidence: the same client (a Prisma client's $queryRaw and the Prisma schema,
//                 drizzle-orm and the Drizzle schema), or the module they share (the deepest common
//                 folder, when one store's is deepest). The only declared store of its dialect, or of
//                 the repository, is evidence by elimination: it attaches only when the file names a
//                 table that store declares. A dialect that contradicts the store's never attaches. How
//                 they attach is said with how many of the tables they name it declares.
//                 Attached, the queries add only: an `[inferred]` conflict where the code names a table
//                 or a column the declaration lacks, and the code's access sites on the declared tables;
//   deduced       otherwise, a store of its own per dialect: `<repo>:sql (inferred, <dialect>)`, named by
//                 its clients, with why it is not attached when the repository declares SQL stores.
//                 A file whose dialect is unknown joins the repository's only deduced store, else one
//                 of unknown dialect.
//
// A deduced store (Store + inferred: { clients, files, statements, sites, why, notes, unknown }):
//   Entity    a table some statement names, kind table, `inferred: true`, its sources the statements
//             (path:line); lookups [{ columns: [c], how: [where | order], sources }] (a lead for an
//             index, never one); queries { sites } (readers and writers)
//   Field     a column a statement names: type { raw: the cast the code states, else null }, nullable
//             null (unknown), default null, unstated: [type, nullable, default] (never compared),
//             `inferred: true`, seen: [how], casts: [{ type, sources }], lookup: [how] | absent
//   Key       { role: unique, parts, from: 'ON CONFLICT' }: an ON CONFLICT target
//   Relation  { kind: join, columns, to, toColumns, onDelete: null, onUpdate: null, direction: id |
//             'as written' }: "inferred from a join", never a foreign key. Its direction: the side
//             whose column is `id`, or names the other table (`user_id` → users), is referenced; else
//             as written, left to right
//   every element's sources [{ repo, path, line, kind: inferred, extractor, confidence: 'seen' }], the
//   first MAX_SOURCES, and `more` past them; conflicts []
// model.queries { files, statements, sites: [Site], attached: [{ store, files, why }], clients: [{ repo,
//   source }] (no longer a gap: a client a file whose queries were read imports, or one of its repository
//   speaking the dialect of a store its queries were read into), tests }
//   Site { repo, path, line, extractor, fn, fnLine, call, store, reads: [entity id], writes: [entity id], kinds }
// A declared store with queries attached gains queries { files, statements, why, conflicts, more };
// its entities gain queries { sites, conflicts, more }.
import { KV_DIALECTS } from './model.mjs'
import { importMatches } from '../arch.mjs'

export const MAX_SOURCES = 8, CAP = 25
export const UNKNOWN = 'deduced from the SQL the code sends, not declared: types (but for the casts the code states), nullability, defaults and every other constraint are unknown; a relation is inferred from a join, never a foreign key; a lookup column is a lead for an index, never one'
export const INFERRED_LABEL = 'inferred from queries in code, not declared'
const lower = (s) => String(s).toLowerCase()
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

// the store a deduced model is named by
export const inferredId = (repo, dialect) => `${repo}:${inferredName(dialect)}`
export const inferredName = (dialect) => `sql (inferred, ${dialect || 'dialect unknown'})`

// One file's dialect, and how it is known → { dialect, how: client | hint | repository | sniffed, … } | null
function dialectOf(q, repoClients) {
  const own = [...new Set(q.clients.map((c) => c.dialect).filter(Boolean))]
  if (own.length === 1) { const c = q.clients.find((x) => x.dialect === own[0]); return { dialect: own[0], how: 'client', source: c.source, path: q.path, line: c.line } }
  if (own.length > 1) return null // two clients of two dialects in one file: which statement goes where is unknown
  const hints = [...new Set(q.hints.map((h) => h.dialect))]
  if (hints.length === 1) { const h = q.hints[0]; return { dialect: h.dialect, how: 'hint', marker: h.why, path: q.path, line: h.line } }
  const repo = [...new Set(repoClients.map((c) => c.dialect).filter(Boolean))]
  if (repo.length === 1) { const c = repoClients.find((x) => x.dialect === repo[0]); return { dialect: repo[0], how: 'repository', source: c.source, path: c.path, line: c.line } }
  for (const weak of [false, true]) {
    const ms = q.markers.filter((m) => !!m.weak === weak)
    const ds = [...new Set(ms.map((m) => m.dialect))]
    if (ds.length === 1) return { dialect: ds[0], how: 'sniffed', marker: ms[0].marker, path: q.path, line: ms[0].line }
    if (ds.length > 1) return null
  }
  return null
}

// The extractor families a declared store comes from, and the clients that are theirs
const FAMILY = [['prisma', ['@prisma/client'], /^prisma@/, ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']], ['drizzle', ['drizzle-orm'], /^drizzle-(?:ts|snapshot)@/, []]]
const commonDir = (a, b) => { const x = a.split('/').slice(0, -1), y = b === '.' ? [] : b.split('/'); let n = 0; while (n < x.length && n < y.length && x[n] === y[n]) n++; return n }

// Evidence, in order: the same client (a Prisma client's raw query and the Prisma schema, drizzle-orm
// and the Drizzle schema), the module they share (the deepest common folder, one store's alone). Being
// the only declared store of the dialect, or of the repository, is evidence by elimination: it attaches
// only when the file names a table that store declares (by its exact name, folded as the store folds
// names), else the queries are a store of their own, and say why.
function attachTo(q, d, declared) {
  if (!declared.length) return { store: null, why: null }
  for (const [name, imports, extractor, calls] of FAMILY) {
    const mine = q.clients.some((c) => imports.some((p) => importMatches(c.source, p))) || q.sites.some((s) => calls.includes(s.call))
    if (!mine) continue
    const by = declared.filter((s) => s.declarations.some((x) => extractor.test(x.extractor)) && (!d || !s.dialect || s.dialect === d.dialect))
    if (by.length === 1) return { store: by[0], why: `the same client (${name})` }
  }
  const fits = d ? declared.filter((s) => !s.dialect || s.dialect === d.dialect) : declared
  if (!fits.length) return { store: null, why: `not attached: its client speaks ${d.dialect}, the declared SQL store${declared.length === 1 ? '' : 's'} of the repository ${declared.map((s) => `${s.id} (${s.dialect || 'dialect unknown'})`).join(', ')}` }
  const depth = fits.map((s) => commonDir(q.path, s.name))
  const best = Math.max(...depth)
  const at = fits.filter((_, i) => depth[i] === best)
  if (best > 0 && at.length === 1) return { store: at[0], why: `the same module (${q.path.split('/').slice(0, best).join('/')}/)` }
  if (fits.length === 1) {
    const names = new Set(q.sites.flatMap((s) => s.statements.flatMap((x) => x.tables.map((t) => t.name))))
    if (![...names].some((n) => entityIn(fits[0], n))) return { store: null, why: `not attached: no table it names is declared in ${fits[0].id}` }
    return { store: fits[0], why: declared.length === 1 ? 'the only declared SQL store in the repository' : `the only declared ${d.dialect} store in the repository` }
  }
  return { store: null, why: `not attached: the repository declares ${plural(fits.length, 'SQL store')} (${fits.map((s) => s.id).join(', ')}) and nothing ties these queries to one` }
}

// a table's declared entity, by its name as the code writes it: exact, or folded as the store folds
// names (Postgres: an unquoted name to lower case; SQLite and MySQL: any case); never fuzzy, never
// across schemas
function entityIn(st, name) {
  const l = lower(name)
  return st.entities.find((e) => e.name === name) || (st.dialect === 'postgres' ? st.entities.find((e) => e.name === l) : st.entities.find((e) => lower(e.name) === l)) || null
}
// the referenced side of a join: the side whose column is `id`, or whose table the other's column names
function direction(j) {
  const [a, b] = [j.a, j.b]
  const named = (x, y) => y.columns.length === 1 && x.columns.length === 1 && lower(y.columns[0]) !== 'id' && new RegExp(`^${lower(x.table).replace(/^.*\./, '').replace(/s$/, '').replace(/[^a-z0-9_]/g, '')}s?_id$`).test(lower(y.columns[0]))
  const isId = (x) => x.columns.length && x.columns.every((c) => lower(c) === 'id')
  if (isId(b) && !isId(a)) return { from: a, to: b, how: 'id' }
  if (isId(a) && !isId(b)) return { from: b, to: a, how: 'id' }
  if (named(b, a)) return { from: a, to: b, how: 'id' }
  if (named(a, b)) return { from: b, to: a, how: 'id' }
  return { from: a, to: b, how: 'as written' }
}

export function resolveQueries(rows, model) {
  const files = rows.filter((r) => r.facts?.queries).map((r) => ({ repo: r.repo, extractor: r.extractor, q: r.facts.queries }))
  const out = { files: 0, statements: 0, sites: [], attached: [], clients: [], tests: 0, notes: [] }
  const added = [] // the deduced stores
  const declaredOf = new Map() // repo → its declared SQL stores with tables
  for (const s of model.stores) if (!KV_DIALECTS.has(s.dialect) && !s.inferred && s.entities.length) { if (!declaredOf.has(s.repo)) declaredOf.set(s.repo, []); declaredOf.get(s.repo).push(s) }
  for (const repo of [...new Set(files.map((f) => f.repo))].sort()) {
    const mine = files.filter((f) => f.repo === repo)
    const repoClients = mine.flatMap((f) => f.q.clients.map((c) => ({ ...c, path: f.q.path })))
    out.tests += mine.reduce((a, f) => a + (f.q.tests || 0), 0)
    const withSites = mine.filter((f) => f.q.sites.length)
    if (!withSites.length) continue
    const declared = declaredOf.get(repo) || []
    // each file: its dialect, then attached or deduced
    const groups = new Map() // dialect | '' → { files, d }
    const attached = new Map() // store id → { store, files, why }
    for (const f of withSites) {
      const d = dialectOf(f.q, repoClients)
      const a = attachTo(f.q, d, declared)
      if (a.store) {
        if (!attached.has(a.store.id)) attached.set(a.store.id, { store: a.store, files: [], why: a.why })
        attached.get(a.store.id).files.push(f)
        continue
      }
      const k = d ? d.dialect : ''
      if (!groups.has(k)) groups.set(k, { files: [], d, why: new Set() })
      groups.get(k).files.push(f)
      if (a.why) groups.get(k).why.add(a.why)
    }
    // a file of unknown dialect joins the repository's only deduced store
    if (groups.has('') && groups.size === 2) {
      const [k] = [...groups.keys()].filter((x) => x)
      const g = groups.get(k), u = groups.get('')
      g.files.push(...u.files)
      for (const w of u.why) g.why.add(w)
      g.joined = u.files.length
      groups.delete('')
    }
    for (const [k, g] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) added.push(deduce(repo, k || null, g, out, repoClients))
    for (const a of attached.values()) attach(a, out)
    // the clients that are no longer a gap: those of a file whose queries were read, and the
    // repository's speaking the dialect of a store its queries were read into (a driver imported
    // apart from the queries); never a client whose queries are not read (SQL built elsewhere)
    const read = new Set([...added.filter((s) => s.repo === repo).map((s) => s.dialect), ...[...attached.values()].map((a) => a.store.dialect)].filter(Boolean))
    for (const c of [...withSites.flatMap((f) => f.q.clients), ...repoClients.filter((c) => c.dialect && read.has(c.dialect))]) if (!out.clients.some((x) => x.repo === repo && x.source === c.source)) out.clients.push({ repo, source: c.source })
  }
  out.files = files.filter((f) => f.q.sites.length).length
  return { stores: added, queries: out }
}

// a source of a statement's fact: its file and line
const src = (f, line) => ({ repo: f.repo, path: f.q.path, line, kind: 'inferred', extractor: f.extractor, confidence: 'seen' })
const cite = (el, s) => { if (el.sources.length < MAX_SOURCES) { if (!el.sources.some((x) => x.path === s.path && x.line === s.line)) el.sources.push(s) } else el.more = (el.more || 0) + 1 }
// one site of a file, recorded once: { index into out.sites }
function siteOf(out, f, s, store) {
  const fn = s.fn >= 0 ? f.q.fns[s.fn] : null
  out.sites.push({ repo: f.repo, path: f.q.path, line: s.line, extractor: f.extractor, fn: fn?.name ?? null, fnLine: fn?.line ?? null, call: s.call, store, reads: [], writes: [], kinds: [...new Set(s.statements.map((x) => x.kind))] })
  return out.sites.length - 1
}

// A store of its own, from the statements of `g.files` (one repository, one dialect or none known),
// named by its clients: its files' own, and the repository's that speak its dialect (or any).
function deduce(repo, dialect, g, out, repoClients) {
  const id = inferredId(repo, dialect)
  const tables = new Map() // lower(name) → entity under construction
  const T = (name, s) => {
    const k = lower(name)
    if (!tables.has(k)) tables.set(k, { id: `${id}/${name}`, name, kind: 'table', inferred: true, sources: [], conflicts: [], fields: new Map(), keys: new Map(), relations: new Map(), lookups: new Map(), sites: new Set() })
    const e = tables.get(k)
    if (s) cite(e, s)
    return e
  }
  const F = (e, name, s) => {
    const k = lower(name)
    if (!e.fields.has(k)) e.fields.set(k, { name, type: { raw: null, norm: null }, nullable: null, default: null, generated: null, unstated: ['type', 'nullable', 'default'], inferred: true, seen: [], casts: [], sources: [], conflicts: [] })
    const x = e.fields.get(k)
    if (s) cite(x, s)
    return x
  }
  let statements = 0
  const clients = new Set(repoClients.filter((c) => c.dialect === dialect || !c.dialect).map((c) => c.source))
  for (const f of g.files) {
    for (const c of f.q.clients) clients.add(c.source)
    for (const s of f.q.sites) {
      const k = siteOf(out, f, s, id)
      const site = out.sites[k]
      for (const st of s.statements) {
        if (st.kind === 'other') continue
        statements++
        for (const t of st.tables) {
          const e = T(t.name, src(f, t.line))
          e.sites.add(k)
          const list = t.role === 'write' ? site.writes : site.reads
          if (!list.includes(e.id)) list.push(e.id)
        }
        for (const c of st.columns) { const x = F(T(c.table), c.name, src(f, c.line)); if (!x.seen.includes(c.how)) x.seen.push(c.how) }
        for (const c of st.casts) { const x = F(T(c.table), c.column); let y = x.casts.find((z) => z.type === c.type); if (!y) { y = { type: c.type, sources: [] }; if (x.casts.length < 4) x.casts.push(y) } cite(y, src(f, c.line)) }
        for (const l of st.lookups) {
          const e = T(l.table), x = F(e, l.column)
          ;(x.lookup ||= []).includes(l.how) || x.lookup.push(l.how)
          const k2 = lower(l.column)
          if (!e.lookups.has(k2)) e.lookups.set(k2, { columns: [x.name], how: [], sources: [] })
          const y = e.lookups.get(k2)
          if (!y.how.includes(l.how)) y.how.push(l.how)
          cite(y, src(f, l.line))
        }
        if (st.conflict) {
          const e = T(st.conflict.table)
          const k2 = st.conflict.columns.map(lower).join('\0')
          if (!e.keys.has(k2)) e.keys.set(k2, { role: 'unique', parts: st.conflict.columns, from: 'ON CONFLICT', sources: [], conflicts: [] })
          cite(e.keys.get(k2), src(f, st.conflict.line))
        }
        for (const j of st.joins) {
          const dr = direction(j)
          const e = T(dr.from.table)
          T(dr.to.table)
          const k2 = `${dr.from.columns.map(lower)}>${lower(dr.to.table)}(${dr.to.columns.map(lower)})`
          if (!e.relations.has(k2)) e.relations.set(k2, { kind: 'join', columns: dr.from.columns, to: tables.get(lower(dr.to.table)).name, toColumns: dr.to.columns, onDelete: null, onUpdate: null, direction: dr.how, sources: [], conflicts: [] })
          cite(e.relations.get(k2), src(f, j.line))
        }
      }
    }
  }
  out.statements += statements
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const entities = [...tables.values()].sort(byName).map((e) => ({
    id: e.id, name: e.name, kind: e.kind, inferred: true, sources: e.sources, ...(e.more ? { more: e.more } : {}), conflicts: [],
    fields: [...e.fields.values()],
    keys: [...e.keys.values()],
    indexes: [],
    relations: [...e.relations.values()],
    lookups: [...e.lookups.values()],
    queries: { sites: [...e.sites] },
  }))
  const d = g.d
  const notes = [...g.why]
  if (g.joined) notes.push(`${plural(g.joined, 'file')} with no client import and no dialect marker of its own read as the repository's only deduced store`)
  const n = g.files.length
  const decl = { extractor: g.files[0].extractor, kind: 'inferred', path: g.files[0].q.path, line: null, status: 'read', label: `deduced from ${plural(statements, 'statement')} in ${plural(n, 'file')}, not declared`, stopped: null, error: null, notes, files: n, implicitIndexes: 0, dialect, dialectFrom: d }
  return {
    id, repo, name: inferredName(dialect), dialect, dialectFrom: d,
    inferred: { clients: [...clients].sort(), files: n, statements, why: notes.find((x) => x.startsWith('not attached')) || null, notes, unknown: UNKNOWN },
    declarations: [decl],
    entities,
  }
}

// Queries attached to a declared store: an [inferred] conflict where the code names what the
// declarations lack, and the code's access sites on the declared tables. Nothing else.
function attach(a, out) {
  const st = a.store
  const conflicts = new Map() // a table the declarations lack → its conflict
  const entityConf = new Map() // entity → Map(column → conflict)
  const absentIn = st.declarations.slice(0, MAX_SOURCES).map((d) => ({ repo: st.repo, path: d.path, line: d.line ?? null, kind: d.kind, extractor: d.extractor, confidence: null }))
  let statements = 0
  for (const f of a.files) {
    for (const s of f.q.sites) {
      const k = siteOf(out, f, s, st.id)
      const site = out.sites[k]
      for (const x of s.statements) {
        if (x.kind === 'other') continue
        statements++
        for (const t of x.tables) {
          const e = entityIn(st, t.name)
          if (!e) {
            if (!conflicts.has(lower(t.name))) conflicts.set(lower(t.name), { label: t.name, attr: 'presence', inferred: true, values: [{ value: 'named in code (inferred)', sources: [] }, { value: 'absent from the declarations', sources: absentIn }] })
            cite(conflicts.get(lower(t.name)).values[0], src(f, t.line))
            continue
          }
          ;(e.queries ||= { sites: [], conflicts: [] }).sites.includes(k) || e.queries.sites.push(k)
          const list = t.role === 'write' ? site.writes : site.reads
          if (!list.includes(e.id)) list.push(e.id)
        }
        for (const c of x.columns) {
          const e = entityIn(st, c.table)
          if (!e || (e.kind === 'view' && !e.fields.length)) continue
          if (e.fields.some((y) => lower(y.name) === lower(c.name))) continue
          if (!entityConf.has(e)) entityConf.set(e, new Map())
          const m = entityConf.get(e)
          if (!m.has(lower(c.name))) m.set(lower(c.name), { label: `${e.name}.${c.name}`, attr: 'presence', path: c.name, inferred: true, values: [{ value: 'named in code (inferred)', sources: [] }, { value: 'absent from the declarations', sources: e.sources.slice(0, MAX_SOURCES) }] })
          cite(m.get(lower(c.name)).values[0], src(f, c.line))
        }
      }
    }
  }
  for (const [e, m] of entityConf) {
    e.queries ||= { sites: [], conflicts: [] }
    const list = [...m.values()]
    e.queries.conflicts = list.slice(0, CAP)
    if (list.length > CAP) e.queries.more = list.length - CAP
  }
  const list = [...conflicts.values()]
  // how many of the tables they name the store declares: said with why they attach
  const named = new Map()
  for (const f of a.files) for (const s of f.q.sites) for (const x of s.statements) for (const t of x.tables) if (!named.has(lower(t.name))) named.set(lower(t.name), !!entityIn(st, t.name))
  const k = [...named.values()].filter(Boolean).length, n = named.size
  const why = `${a.why}; ${k} of ${n} ${n === 1 ? 'table named is' : 'tables named are'} declared`
  st.queries = { files: a.files.length, statements, why, named: n, declared: k, conflicts: list.slice(0, CAP), ...(list.length > CAP ? { more: list.length - CAP } : {}) }
  out.statements += statements
  out.attached.push({ store: st.id, files: a.files.length, why })
}

// What a deduced store does not know, in one line (graph_data and the Data tab say the same)
export const NOT_DECLARED = 'not declared: deduced from the SQL the code sends; types (but for casts), nullability, defaults and other constraints unknown; relations inferred from joins, never foreign keys; lookup columns are leads for an index, never indexes'

// The functions holding a list of SQL calls, one entry per function: `sym(site)` → the code graph's
// symbol around it ({ key, name, line, callers }: lib/query.mjs symbolAt), else the extractor's name
// for it. With `entity`, whether each reads or writes that table, else any.
//   → [{ key, name, repo, path, line, reads, writes, kinds: [statement kinds], lines: [the calls'], callers }]
export function sqlFunctions(list, sym, entity = null) {
  const out = new Map()
  for (const s of list) {
    const g = sym(s) || { key: `${s.repo}\0${s.path}\0${s.fn ?? s.line}`, name: s.fn || '(top level)', line: s.fnLine ?? s.line, callers: null }
    if (!out.has(g.key)) out.set(g.key, { key: g.key, name: g.name, repo: s.repo, path: s.path, line: g.line, reads: false, writes: false, kinds: [], lines: [], callers: g.callers })
    const f = out.get(g.key)
    if (entity ? s.reads.includes(entity) : s.reads.length) f.reads = true
    if (entity ? s.writes.includes(entity) : s.writes.length) f.writes = true
    for (const k of s.kinds) if (!f.kinds.includes(k)) f.kinds.push(k)
    if (f.lines.length < 5 && !f.lines.includes(s.line)) f.lines.push(s.line)
  }
  return [...out.values()]
}

// A deduced store in one line (graph_data and the Data tab say the same).
export function inferredSummary(st) {
  const tables = st.entities.length
  const rels = st.entities.reduce((a, e) => a + e.relations.length, 0), keys = st.entities.reduce((a, e) => a + e.keys.length, 0)
  const look = st.entities.reduce((a, e) => a + e.lookups.length, 0)
  return [plural(tables, 'table'), `${plural(rels, 'relation')} from joins`, `${plural(keys, 'unique key')} from ON CONFLICT`, plural(look, 'lookup column'), `${INFERRED_LABEL} (${plural(st.inferred.statements, 'statement')})`].join(' · ')
}
// the conflicts queries add to a declared store: its own and its entities'
export const queryConflicts = (st) => (st.queries ? st.queries.conflicts.length + (st.queries.more || 0) : 0) + st.entities.reduce((a, e) => a + (e.queries?.conflicts?.length || 0) + (e.queries?.more || 0), 0)
