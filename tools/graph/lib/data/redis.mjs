// grimoire graph · data · a key-value cache's key space, against the model (spec D2's `inferred` kind,
// the least trusted; a literal FT.CREATE is a declaration code makes): the commands
// extractors/redis-commands.mjs read, per key space. Run by reconcile.mjs once the declarations are
// merged; nothing here changes a declared fact.
//
// One key space per instance the code reaches: a repository's commands go to the instance the infra or
// a Compose file wires to it (`instances`: what infra declares, each with the environment variables it
// sets and the repositories it sets them for, data/redis-infra.mjs), else to `<repo>:redis`, labelled
// inferred. Two repositories share a key space only when one instance is wired to both; never by a
// guess (two repositories each sending `user:{id}` keep two key spaces).
//
// A key space (Store + dialect 'redis', keyspace: { clients, files, commands, dyn, channels, notes,
// instance?, dbs }):
//   Entity keyPattern  a key template (`user:{user_id}:sessions`), compared without its placeholders'
//                      names; its type from the commands' families (`types`: each with its sources; two
//                      that TYPE answers apart are a conflict, the WRONGTYPE error before it happens),
//                      its fields (hash fields, JSON paths, a stream entry's fields: names code writes
//                      literally), its lifetime (`ttl`: the seconds each literal sets, how many code
//                      computes; null when none), `lead` when it is written and no lifetime is set
//                      anywhere ("no expiry found", never a verdict), the indexes covering it, the globs
//                      reading it (SCAN MATCH, KEYS), a stream's consumer groups and consumers, and its
//                      sites (readers and writers)
//   Entity index       a search index: ON, PREFIX (the templates it covers, matched on their literal
//                      start), its schema as fields (type TEXT, TAG …, `as`, `opts`), `assembled` when
//                      code builds part of it, its queries (FT.SEARCH, FT.AGGREGATE, FT.PROFILE, through an
//                      alias too) or a lead when nothing queries it; declared by code (kind code) when a
//                      literal FT.CREATE states it, else only queried (`created: null`)
//   keyspace.channels  [{ name, k, pattern, pub: [site], sub: [site], repos }]: pub/sub channels and
//                      patterns, each with its publishers and subscribers (a pattern subscriber listed on
//                      the channels its glob matches)
// model.redis { files, commands, sites: [Site], clients: [{ repo, source }] (no longer a gap), tests, dyn }
//   Site { repo, path, line, extractor, fn, fnLine, cmd, store, reads: [entity id], writes: [entity id],
//          batch?, via?, how }
import { globMatches, literalPrefix, TYPE_OF, segments } from './readers/redis-cmd.mjs'

export const MAX_SOURCES = 8, CAP = 25
export const NO_EXPIRY = 'no expiry found (lead): written, and no EXPIRE, SET … EX, SETEX or GETEX sets a lifetime on it anywhere in the indexed code; it may be set by code the extractor does not read, a script, or a server-wide policy'
export const NO_QUERY = 'no access found (lead): no FT.SEARCH, FT.AGGREGATE or FT.PROFILE names it (or an alias of it) in the indexed repositories; it may be queried through a name built elsewhere, another repository, or a tool'
export const UNKNOWN = 'deduced from the commands the code sends, not declared: key templates are what code writes literally (each part it fills in a placeholder); values, field names code builds, and keys code builds wholly are not read; a type is what the commands\' families say'
export const INFERRED_LABEL = 'inferred from the commands in code, not declared'
export const ASSEMBLED = 'assembled in code, not read: the fields code builds are left to the refine file'
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

export const redisId = (repo) => `${repo}:redis`

// the readers and writers of a template, as one site lists them
const src = (f, line) => ({ repo: f.repo, path: f.r.path, line, kind: 'inferred', extractor: f.extractor, confidence: 'seen' })
const cite = (el, s) => { if (!el.sources) el.sources = []; if (el.sources.length < MAX_SOURCES) { if (!el.sources.some((x) => x.repo === s.repo && x.path === s.path && x.line === s.line)) el.sources.push(s) } else el.more = (el.more || 0) + 1 }

// rows: [{ repo, extractor, facts: { redis } }]; model: the merged model; instances: [{ id, repo, name,
// … , wires: [{ env, repos: [repo] | null (any) }] }] (data/redis-infra.mjs) → { stores, redis }
export function resolveRedis(rows, model, instances = []) {
  const files = rows.filter((r) => r.facts?.redis).map((r) => ({ repo: r.repo, extractor: r.extractor, r: r.facts.redis }))
  const out = { files: 0, commands: 0, sites: [], clients: [], tests: 0, dyn: 0 }
  // each repository's key space: an instance wired to it (one, by an environment variable a file holding
  // its commands or its client reads), else its own
  const spaceOf = new Map() // repo → { id, instance, why }
  const repos = [...new Set(files.map((f) => f.repo))].sort()
  for (const repo of repos) {
    const env = new Set(files.filter((f) => f.repo === repo && (f.r.sites.length || f.r.clients.length)).flatMap((f) => f.r.env.map((e) => e.name)))
    const hits = instances.filter((i) => i.wires.some((w) => env.has(w.env) && (!w.repos || w.repos.includes(repo))))
    if (hits.length === 1) { const w = hits[0].wires.find((x) => env.has(x.env) && (!x.repos || x.repos.includes(repo))); spaceOf.set(repo, { id: hits[0].id, instance: hits[0], why: { env: w.env, at: w.at, repos: w.repos } }) }
    else spaceOf.set(repo, { id: redisId(repo), instance: null, why: hits.length > 1 ? { ambiguous: hits.map((i) => i.id) } : null })
  }
  const spaces = new Map() // id → { files, instance, repos, why }
  for (const f of files) {
    out.tests += f.r.tests || 0
    if (!f.r.sites.length) continue
    const sp = spaceOf.get(f.repo)
    if (!spaces.has(sp.id)) spaces.set(sp.id, { id: sp.id, instance: sp.instance, files: [], repos: new Set(), why: new Map() })
    const g = spaces.get(sp.id)
    g.files.push(f); g.repos.add(f.repo)
    g.all = files.filter((x) => g.repos.has(x.repo))
    if (sp.why) g.why.set(f.repo, sp.why)
  }
  const stores = [...spaces.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((g) => keySpace(g, out))
  // the instances no code reaches: still key spaces, declared by the infra, with nothing read
  for (const i of instances) if (!spaces.has(i.id)) stores.push(keySpace({ id: i.id, instance: i, files: [], repos: new Set(), why: new Map() }, out))
  // the clients no longer a gap: those of a repository whose commands are read
  for (const f of files) if (spaces.has(spaceOf.get(f.repo).id)) for (const c of f.r.clients) if (!out.clients.some((x) => x.repo === f.repo && x.source === c.source)) out.clients.push({ repo: f.repo, source: c.source })
  out.files = files.filter((f) => f.r.sites.length).length
  return { stores: stores.sort((a, b) => (a.id < b.id ? -1 : 1)), redis: out }
}

function keySpace(g, out) {
  const id = g.id
  const T = new Map() // k → template entity under construction
  const I = new Map() // index name → index entity under construction
  const C = new Map() // channel k → channel
  const aliases = new Map() // alias → index name
  const tmpl = (key) => {
    if (!T.has(key.k)) T.set(key.k, { id: `${id}/${key.t}`, name: key.t, k: key.k, kind: 'keyPattern', inferred: true, names: new Set([key.t]), types: new Map(), fields: new Map(), ttl: { s: [], code: 0, keep: 0, none: 0, sources: [] }, written: false, creates: false, sites: new Set(), globs: [], groups: new Map(), sources: [], conflicts: [] })
    const e = T.get(key.k)
    e.names.add(key.t)
    return e
  }
  const index = (name, k) => {
    if (!I.has(k)) I.set(k, { id: `${id}/index:${name}`, name, k, kind: 'index', created: null, defs: [], queries: new Set(), sources: [], conflicts: [], alterFields: [] })
    return I.get(k)
  }
  let commands = 0, dyn = 0
  const clients = new Set(), notes = [], dbs = []
  // the clients each repository of the key space imports (a module making the client holds no command)
  for (const f of g.all || g.files) for (const c of f.r.clients) clients.add(c.client || c.source)
  for (const f of g.files) {
    for (const n of f.r.notes) if (notes.length < 8 && !notes.includes(n)) notes.push(n)
    for (const d of f.r.dbs || []) if (dbs.length < 8) dbs.push({ db: d.db, how: d.how, repo: f.repo, path: f.r.path, line: d.line })
    dyn += f.r.dyn || 0
    for (const s of f.r.sites) {
      commands++
      const fn = s.fn >= 0 ? f.r.fns[s.fn] : null
      const k = out.sites.length
      const site = { repo: f.repo, path: f.r.path, line: s.line, extractor: f.extractor, fn: fn?.name ?? null, fnLine: fn?.line ?? null, cmd: s.cmd, store: id, reads: [], writes: [], how: s.how, ...(s.batch ? { batch: s.batch } : {}), ...(s.via ? { via: s.via } : {}) }
      out.sites.push(site)
      const at = src(f, s.line)
      if (s.cmd === 'SELECT' && s.db) dbs.push({ db: s.db.n ?? null, how: 'select', repo: f.repo, path: f.r.path, line: s.line })
      for (const key of s.keys) {
        const e = tmpl(key)
        cite(e, at)
        e.sites.add(k)
        const list = key.role === 'w' ? site.writes : site.reads
        if (!list.includes(e.id)) list.push(e.id)
        if (key.role === 'w') { e.written = true; if (s.creates) e.creates = true }
        // the type the command's family says (a key-family command says none)
        if (s.base) {
          const fam = s.family
          if (!e.types.has(fam)) e.types.set(fam, { type: TYPE_OF[fam] || fam, base: s.base, sources: [] })
          cite(e.types.get(fam), at)
        }
        for (const [list2, how] of [[s.fields, s.family === 'stream' ? 'stream' : 'field'], [s.paths, 'path']]) {
          for (const name of list2 || []) {
            const fk = `${how}\0${name}`
            if (!e.fields.has(fk)) { if (e.fields.size >= 200) continue; e.fields.set(fk, { name, how, sources: [], conflicts: [] }) }
            cite(e.fields.get(fk), at)
          }
        }
        if (s.ttl && key.role === 'w') {
          if (s.ttl.s !== undefined) { if (!e.ttl.s.includes(s.ttl.s) && e.ttl.s.length < 8) e.ttl.s.push(s.ttl.s) } else if (s.ttl.code) e.ttl.code++; else if (s.ttl.keep) e.ttl.keep++; else if (s.ttl.none) e.ttl.none++
          cite(e.ttl, at)
        }
        if (s.stream?.group && key.role !== undefined) {
          const gname = s.stream.group.t
          if (!e.groups.has(gname)) e.groups.set(gname, { name: gname, consumers: new Set(), sources: [], created: false })
          const gr = e.groups.get(gname)
          cite(gr, at)
          if (s.stream.op === 'CREATE') gr.created = true
          if (s.stream.consumer && gr.consumers.size < 16) gr.consumers.add(s.stream.consumer.t)
        }
      }
      if (s.glob) site.globs = s.glob
      for (const ch of s.channel || []) {
        if (!C.has(ch.k)) C.set(ch.k, { name: ch.t, k: ch.k, pattern: ch.pattern, pub: [], sub: [], repos: new Set(), sources: [] })
        const c = C.get(ch.k)
        ;(ch.role === 'pub' ? c.pub : c.sub).push(k)
        c.repos.add(f.repo)
        cite(c, at)
      }
      if (s.index && s.index.name) {
        if (s.index.role === 'alias' && s.index.alias) { aliases.set(s.index.alias, s.index.name); continue }
        const x = index(s.index.name, s.index.k)
        if (s.index.role === 'create' || s.index.role === 'alter') {
          const def = s.index.def || {}
          if (s.index.role === 'create') { x.created = x.created || at; x.defs.push({ def, source: { ...at, kind: 'code' } }) } else x.alterFields.push(...(def.schema || []).map((fl) => ({ ...fl, source: at })))
          cite(x, { ...at, kind: s.index.role === 'create' ? 'code' : 'inferred' })
          ;(s.index.role === 'create' ? site.writes : site.writes).push(x.id)
        } else if (s.index.role === 'search' || s.index.role === 'aggregate' || s.index.role === 'profile') { x.queries.add(k); site.reads.push(x.id) }
        else if (s.index.role === 'drop') { site.writes.push(x.id); cite(x, at) }
      }
    }
  }
  out.commands += commands
  out.dyn += dyn
  // an alias's queries go to its index
  for (const [alias, name] of aliases) {
    const a = [...I.values()].find((x) => x.name === alias), t = [...I.values()].find((x) => x.name === name)
    if (a && t && a !== t) { for (const q of a.queries) t.queries.add(q); t.aliases = [...(t.aliases || []), alias]; if (!a.created) I.delete(a.k) }
  }
  // globs: a SCAN MATCH or KEYS reads each template it matches
  for (const k of out.sites.keys()) {
    const site = out.sites[k]
    if (site.store !== id || !site.globs) continue
    for (const glob of site.globs) for (const e of T.values()) if (globMatches(glob, e.name)) { e.sites.add(k); if (!site.reads.includes(e.id)) site.reads.push(e.id); if (!e.globs.includes(glob) && e.globs.length < 8) e.globs.push(glob) }
  }
  // the entities
  const templates = [...T.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((e) => {
    const types = [...e.types.values()]
    const bases = new Map()
    for (const t of types) { if (!bases.has(t.base)) bases.set(t.base, []); bases.get(t.base).push(t) }
    const conflicts = bases.size > 1 ? [{ attr: 'type', inferred: true, values: [...bases.values()].map((ts) => ({ value: ts.map((t) => t.type).join(' / '), sources: ts.flatMap((t) => t.sources).slice(0, MAX_SOURCES) })) }] : []
    const ttl = e.ttl.s.length || e.ttl.code || e.ttl.keep ? { seconds: e.ttl.s.sort((a, b) => a - b), code: e.ttl.code, keep: e.ttl.keep, none: e.ttl.none, sources: e.ttl.sources } : null
    const fields = [...e.fields.values()].map((x) => ({ name: x.name, how: x.how, type: { raw: null, norm: null }, nullable: null, default: null, generated: null, unstated: ['type', 'nullable', 'default'], inferred: true, sources: x.sources, ...(x.more ? { more: x.more } : {}), conflicts: [] }))
    const groups = [...e.groups.values()].map((x) => ({ name: x.name, created: x.created, consumers: [...x.consumers], sources: x.sources }))
    const type = types.length === 1 ? types[0].type : types.length ? types.map((t) => t.type).join(' / ') : null
    return {
      id: e.id, name: e.name, k: e.k, kind: 'keyPattern', inferred: true, type, base: bases.size === 1 ? [...bases.keys()][0] : null,
      types: types.map((t) => ({ type: t.type, base: t.base, sources: t.sources })), names: [...e.names].slice(0, 4), path: segments(e.name),
      sources: e.sources, ...(e.more ? { more: e.more } : {}), conflicts,
      fields, keys: [], indexes: [], relations: [],
      ttl, ...(e.creates && !ttl ? { lead: NO_EXPIRY } : {}), written: e.written,
      ...(groups.length ? { groups } : {}), globs: e.globs, coveredBy: [],
      redis: { sites: [...e.sites] },
    }
  })
  const indexes = [...I.values()].sort((a, b) => (a.name < b.name ? -1 : 1)).map((x) => {
    const d = x.defs[0]?.def || null
    // two FT.CREATE of one name that disagree: each side kept
    const shape = (dd) => JSON.stringify({ on: dd.on ?? null, prefixes: dd.prefixes || [], schema: (dd.schema || []).map((f) => [f.name, f.as ?? null, f.type]) })
    const forms = new Map()
    for (const y of x.defs) { const k = shape(y.def); if (!forms.has(k)) forms.set(k, { value: k, sources: [] }); forms.get(k).sources.push(y.source) }
    const conflicts = forms.size > 1 ? [{ attr: 'definition', values: [...forms.values()].map((v) => ({ value: describeDef(JSON.parse(v.value)), sources: v.sources })) }] : []
    const schema = [...(d?.schema || []).map((f) => ({ ...f, source: x.defs[0].source })), ...x.alterFields]
    const fields = schema.map((f) => ({ name: f.name, type: { raw: f.type, norm: f.type ? f.type.toLowerCase() : null }, as: f.as ?? null, opts: f.opts || [], nullable: null, default: null, generated: null, sources: [f.source].filter(Boolean), conflicts: [] }))
    const prefixes = d?.prefixes || []
    const covers = templates.filter((e) => prefixes.length ? prefixes.some((p) => covered(p, e.name)) : !!d)
    for (const e of covers) e.coveredBy.push(x.name)
    return {
      id: x.id, name: x.name, kind: 'index', on: d ? d.on || 'HASH' : null, prefixes, ...(d?.filter ? { filter: true } : {}),
      created: x.created, declared: !!x.created, ...(d?.assembled ? { assembled: d.assembled } : {}), ...(d?.past ? { past: d.past } : {}),
      fields, keys: [], indexes: [], relations: [], covers: covers.map((e) => e.name), ...(x.aliases ? { aliases: x.aliases } : {}),
      queries: { sites: [...x.queries] }, ...(x.queries.size ? {} : { lead: NO_QUERY }),
      sources: x.sources, conflicts,
    }
  })
  // channels: a pattern subscription listed on each channel its glob matches
  const channels = [...C.values()].sort((a, b) => (a.name < b.name ? -1 : 1))
  for (const p of channels.filter((c) => c.pattern)) for (const c of channels) if (!c.pattern && globMatches(p.name, c.name)) { c.psub = [...(c.psub || []), p.name] }
  const repos = [...g.repos].sort()
  const n = g.files.length
  const decl = { extractor: g.files[0]?.extractor || 'redis-commands@1', kind: 'inferred', repo: g.files[0]?.repo, path: g.files[0]?.r.path || null, line: null, status: 'read', label: n ? `deduced from ${plural(commands, 'command')} in ${plural(n, 'file')}, not declared` : 'declared by the infrastructure; no command in the indexed code reaches it', stopped: null, error: null, notes, files: n, implicitIndexes: 0, dialect: 'redis', dialectFrom: null }
  const inst = g.instance
  // an allkeys-* eviction policy: what is written with no lifetime may be evicted (a lead)
  const noTtl = templates.filter((e) => e.written && !e.ttl && e.base && e.base !== 'stream')
  const evictionLead = inst && typeof inst.eviction === 'string' && /^allkeys-/.test(inst.eviction) && noTtl.length ? `eviction lead: ${inst.eviction} may evict any key; ${plural(noTtl.length, 'template')} written with no lifetime (${noTtl.slice(0, 5).map((e) => e.name).join(', ')}${noTtl.length > 5 ? ', …' : ''}) lose${noTtl.length === 1 ? 's its' : ' their'} data when evicted unless another store holds a copy: a lead, never a verdict` : null
  return {
    id, repo: inst ? inst.repo : repos[0], name: inst ? inst.name : 'redis', dialect: 'redis', dialectFrom: null,
    keyspace: {
      clients: [...clients].sort(), files: n, commands, dyn, notes, repos, unknown: UNKNOWN,
      channels: channels.map((c) => ({ name: c.name, k: c.k, pattern: c.pattern, pub: c.pub, sub: c.sub, ...(c.psub ? { psub: c.psub } : {}), repos: [...c.repos].sort(), sources: c.sources })),
      dbs, deduced: !inst, ...(inst ? { instance: inst, wired: [...g.why].map(([repo, w]) => ({ repo, ...w })), ...(evictionLead ? { evictionLead } : {}) } : {}),
      ...([...g.why.values()].some((w) => w.ambiguous) ? { ambiguous: [...g.why].filter(([, w]) => w.ambiguous).map(([repo, w]) => ({ repo, instances: w.ambiguous })) } : {}),
    },
    declarations: [decl, ...(inst ? inst.declarations || [] : [])],
    entities: [...templates, ...indexes],
  }
}

// whether an index's PREFIX covers a template: the template's literal start begins with the prefix, or
// is begun by it and a key of the template can carry the prefix
function covered(prefix, t) {
  const lp = literalPrefix(t)
  if (lp.startsWith(prefix)) return true
  // a prefix code builds part of (`{stage}:doc:`): compared as templates are, without the names
  const form = (x) => String(x).replace(/\{[A-Za-z0-9_$]*\}/g, '{}')
  if (prefix.includes('{') && form(t).startsWith(form(prefix))) return true
  return lp.length > 0 && prefix.startsWith(lp) && globMatches(prefix.replace(/[*?[\\]/g, '\\$&') + '*', t)
}
export function describeDef(d) {
  return [`ON ${d.on || 'HASH'}`, d.prefixes?.length ? `PREFIX ${d.prefixes.join(' ')}` : 'no PREFIX', `SCHEMA ${(d.schema || []).map(([n, as, t]) => `${n}${as ? ` AS ${as}` : ''} ${t || '?'}`).join(', ')}`].join(' ')
}

// ── for the tools and the page ──
export const isKeySpace = (st) => st.dialect === 'redis'
export const templatesOf = (st) => st.entities.filter((e) => e.kind === 'keyPattern')
export const indexesOf = (st) => st.entities.filter((e) => e.kind === 'index')
export const streamsOf = (st) => templatesOf(st).filter((e) => e.base === 'stream' || (e.types || []).some((t) => t.base === 'stream'))
export const redisConflicts = (st) => st.entities.reduce((a, e) => a + e.conflicts.length, 0)
// A key space in one line (graph_data and the Data tab say the same)
export function redisSummary(st) {
  const t = templatesOf(st), ix = indexesOf(st), ks = st.keyspace
  const cf = redisConflicts(st), leads = t.filter((e) => e.lead).length + ix.filter((e) => e.lead).length
  return [plural(t.length, 'key template'), plural(ix.length, 'search index', 'search indexes'), plural(ks.channels.length, 'channel'), plural(streamsOf(st).length, 'stream'), ks.commands ? `${INFERRED_LABEL} (${plural(ks.commands, 'command')})` : 'no command in code reaches it', cf ? plural(cf, 'conflict') : 'no conflicts', leads ? plural(leads, 'lead') : null].filter(Boolean).join(' · ')
}
// a lifetime in words
export function ttlText(ttl) {
  if (!ttl) return 'no lifetime set'
  const secs = (s) => (s % 86400 === 0 ? `${s / 86400} d` : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 && s >= 60 ? `${s / 60} min` : `${s} s`)
  return [...ttl.seconds.map(secs), ttl.code ? 'set in code' : null, ttl.keep ? 'kept (KEEPTTL)' : null].filter(Boolean).join(', ')
}
// The functions holding a list of commands, one entry per function (as queries.mjs sqlFunctions):
// `sym(site)` → the code graph's symbol around it; with `entity`, whether each reads or writes it.
export function redisFunctions(list, sym, entity = null) {
  const out = new Map()
  for (const s of list) {
    const g = sym(s) || { key: `${s.repo}\0${s.path}\0${s.fn ?? s.line}`, name: s.fn || '(top level)', line: s.fnLine ?? s.line, callers: null }
    if (!out.has(g.key)) out.set(g.key, { key: g.key, name: g.name, repo: s.repo, path: s.path, line: g.line, reads: false, writes: false, kinds: [], lines: [], callers: g.callers })
    const f = out.get(g.key)
    if (entity ? s.reads.includes(entity) : s.reads.length) f.reads = true
    if (entity ? s.writes.includes(entity) : s.writes.length) f.writes = true
    if (!f.kinds.includes(s.cmd) && f.kinds.length < 12) f.kinds.push(s.cmd)
    if (f.lines.length < 5 && !f.lines.includes(s.line)) f.lines.push(s.line)
  }
  return [...out.values()]
}
// the prefix tree of a key space's templates: [{ seg, depth, entity? }] in order (a segment shared by
// several templates once)
export function prefixTree(templates) {
  const root = { kids: new Map(), e: null }
  for (const e of templates) {
    let node = root
    for (const seg of e.path || segments(e.name)) { if (!node.kids.has(seg)) node.kids.set(seg, { kids: new Map(), e: null }); node = node.kids.get(seg) }
    node.e = e
  }
  const rows = []
  const walk = (node, depth) => { for (const [seg, kid] of [...node.kids].sort(([a], [b]) => (a < b ? -1 : 1))) { rows.push({ seg, depth, entity: kid.e }); walk(kid, depth + 1) } }
  walk(root, 0)
  return rows
}
