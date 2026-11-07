// grimoire graph · data · extractor: folders of SQL migrations, whatever tool wrote them, and schema
// dumps. Per unit: one store (a folder of migrations, the dumps that state it), re-run when any of
// its files or the configs naming its dialect change.
//
// Found by content, not by name: a folder is a migration folder when one of its .sql files (beside
// each other, or one per versioned subfolder: <version>_<name>/migration.sql or up.sql) creates or
// alters a table or an index. Once found, every file of it holding a schema statement belongs to it, a
// DROP or a view alone included. Down migrations (down.sql, *.down.sql) and files with no schema
// statement (seeds, queries) are not part of it; a file's down section (`-- migrate:down`, `-- +goose
// Down`) is cut off before it is read, and so is what comes before its up section (`-- migrate:up`,
// `-- +goose Up`), its lines kept.
//
// Order, per tool: the tool's journal when there is one (meta/_journal.json: only the migrations it
// lists are ever applied); versioned files `V<version>__<name>.sql` by version, compared number by
// number (V1.2 before V1.10, V9 before V10), then the repeatable `R__<name>.sql` ones by name, the undo
// `U<version>__` ones never; else the numeric or timestamp prefix of the file or subfolder names,
// compared number by number (0001_, 20240105090000_, 2024-01-05-090000_). When the names do not all
// carry one prefix scheme, or two share a version, the order is unknown and the folder is not replayed.
//
// A schema dump (`structure.sql`, `schema.sql`, or a file whose header says a database dump tool wrote
// it, whatever its name, unless the name is versioned like a migration) states the store as the
// database has it: a declaration of kind artifact, listed before the replay and preferred where an
// element is shown, the replay kept beside it (spec D2: where the two disagree, a conflict, never
// resolved by precedence). Its store is the migration folder beside it (in its folder, or the one
// folder of migrations right under it: db/schema.sql states db/migrations), else its own folder.
//
// Dialect, first found: grimoire.config.json (graph.data.migrations), a drizzle.config.* whose `out`
// is this folder, the tool's journal, Prisma's migration_lock.toml or schema.prisma datasource
// `provider`, Supabase (Postgres), a dump's header; else sniffed from the SQL (readers/sql-dialect.mjs).
// Unknown is never guessed. SQLite is replayed (readers/sqlite-replay.mjs), Postgres and MySQL read
// statement by statement (readers/ddl.mjs).
import path from 'node:path'
import { replay } from '../readers/sqlite-replay.mjs'
import { readDdl } from '../readers/ddl.mjs'
import { sniffDialect } from '../readers/sql-dialect.mjs'
import { normDialect, lineOf } from '../model.mjs'
import { parseJson } from '../readers/json-lines.mjs'
import { dumpHeader, schemaLevel } from '../readers/sql-split.mjs'

const P = path.posix
const SQL = /\.sql$/i
const DOWN = /(^|[/._-])down\.sql$/i
const STEP = /^(?:migration|up)\.sql$/i
const VERSIONED = /^[A-Za-z]?\d/
const VERSION = /^([A-Za-z]*)(\d+(?:[._-]\d+)*)/
const FLYWAY = /^(?:([VU])(\d+(?:[._]\d+)*)|R)__(.+?)(?:\.sql)?$/
const DUMP_NAME = /(^|\/)(?:structure|schema)\.sql$/i
const DRIZZLE_CONFIG = /(^|\/)drizzle\.config\.(?:ts|js|mjs|cjs|mts|cts|json)$/
const CONFIG = /(^|\/)(?:drizzle\.config\.(?:ts|js|mjs|cjs|mts|cts|json)|schema\.prisma|migration_lock\.toml|meta\/_journal\.json)$/
const DOWN_SECTION = /^--\s*(?:migrate:down|\+goose\s+down)\b/im
const UP_SECTION = /^--\s*(?:migrate:up|\+goose\s+up)\b/im
const NOTES = 12 // files whose skipped statements are listed one by one
const counted = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

// A file's up migration: the text before a down section, if it has one.
export function upOnly(text) {
  const m = DOWN_SECTION.exec(text)
  return m ? text.slice(0, m.index) : text
}
// …and from its up section on, when it marks one (what comes before blanked, so lines stay).
export function upSection(text) {
  const t = upOnly(text)
  const m = UP_SECTION.exec(t)
  return m ? t.slice(0, m.index).replace(/[^\n]/g, ' ') + t.slice(m.index) : t
}

// A schema dump: by its name, or by its header when its name is not a migration's.
const isDump = (p, header) => DUMP_NAME.test(p) || (header && !VERSIONED.test(P.basename(p)) && !STEP.test(P.basename(p)))

export default {
  id: 'sql-migrations',
  version: 2,
  kind: 'migration',
  scope: 'unit',
  wants: (p) => (SQL.test(p) && !DOWN.test(p)) || CONFIG.test(p),
  config: (p) => CONFIG.test(p),
  // info: Map(path → { ddl }) of the candidate files, ddl the file's schemaLevel (3: a dump's header,
  // 2: creates or alters a table or an index, 1: other schema statements only); overrides: [{ path,
  // dialect }] for this repository.
  discover(info, { overrides = [] } = {}) {
    const folders = new Map() // folder → { members, found }
    const dumps = []
    for (const [p, i] of info) {
      if (!SQL.test(p) || !i.ddl) continue
      if (i.ddl >= 2 && isDump(p, i.ddl === 3)) { dumps.push(p); continue }
      const dir = P.dirname(p)
      const folder = STEP.test(P.basename(p)) && dir !== '.' && VERSIONED.test(P.basename(dir)) ? P.dirname(dir) : dir
      if (!folders.has(folder)) folders.set(folder, { members: [], found: false })
      const f = folders.get(folder)
      f.members.push(p)
      f.found ||= i.ddl >= 2
    }
    const stores = new Map([...folders].filter(([, f]) => f.found).map(([folder, f]) => [folder, { members: f.members, dumps: [] }]))
    for (const d of dumps.sort()) {
      const dir = P.dirname(d)
      const under = [...stores.keys()].filter((f) => f !== dir && P.dirname(f) === dir)
      const store = stores.has(dir) ? dir : under.length === 1 ? under[0] : dir
      if (!stores.has(store)) stores.set(store, { members: [], dumps: [] })
      stores.get(store).dumps.push(d)
    }
    const configs = [...info.keys()].filter((p) => CONFIG.test(p))
    return [...stores].map(([folder, { members, dumps: ds }]) => {
      const inside = (rel) => (folder === '.' ? rel : `${folder}/${rel}`)
      const mine = configs.filter((c) => {
        const d = P.dirname(c)
        if (DRIZZLE_CONFIG.test(c)) return d === '.' || folder === d || folder.startsWith(`${d}/`)
        if (c.endsWith('schema.prisma')) return d === P.dirname(folder)
        return c === inside('migration_lock.toml') || c === inside('meta/_journal.json')
      })
      const o = overrides.find((x) => x.path === folder)
      return { key: folder, inputs: [...members.sort(), ...ds, ...mine.sort()], ...(o ? { override: o.dialect, salt: `dialect=${o.dialect}` } : {}) }
    })
  },
  extract({ key, files, override }, { DatabaseSync }) {
    const configs = new Map(files.filter((f) => CONFIG.test(f.path)).map((f) => [f.path, f.text]))
    const sql = files.filter((f) => !CONFIG.test(f.path))
    // (as discover found them: a dump states a table)
    const dumps = sql.filter((f) => isDump(f.path, !!dumpHeader(f.text)) && schemaLevel(upOnly(f.text)) >= 2)
    const members = sql.filter((f) => !dumps.includes(f)).map((f) => ({ path: f.path, text: upSection(f.text) }))
    const journal = readJournal(key, configs)
    const out = []
    if (members.length) out.push(replayed(key, members, configs, journal, override, DatabaseSync))
    for (const d of dumps) out.push(dumped(key, d, configs, journal, override, DatabaseSync))
    // the dump states the store as the database has it: listed first, the replay beside it
    if (members.length && dumps.length) {
      const rep = out[0]
      rep.notes = [`also stated by the schema dump ${dumps.map((d) => d.path).join(', ')}, listed first (where the two disagree, a conflict)`, ...rep.notes]
      for (const d of out.slice(1)) d.notes = [`a schema dump of ${key}, preferred over its replay where an element is shown (the replay kept beside it)`, ...d.notes]
    }
    return { declarations: out }
  },
}

// The folder's migrations, in their order, replayed.
function replayed(key, members, configs, journal, override, DatabaseSync) {
  const dialect = dialectOf(key, configs, members, override, journal)
  const order = orderOf(key, members, journal)
  const base = {
    store: key, dialect: dialect.dialect, dialectFrom: dialect.from ?? null,
    source: { path: (order.files?.length ? order.files : members)[0].path, line: 1, kind: 'migration', confidence: 'exact' },
    complete: false, partial: false, files: members.length, notes: order.notes, entities: [],
  }
  const found = (label) => ({ ...base, status: 'not-read', label })
  if (!dialect.dialect) return found(`dialect unknown (no config states it, and ${dialect.reason})`)
  if (!['sqlite', 'postgres', 'mysql'].includes(dialect.dialect)) return found(`no reader for ${dialect.dialect} migrations`)
  if (order.error) return found(`order unknown (${order.error})`)
  const files = counted(order.files.length, 'file')
  if (dialect.dialect === 'sqlite') {
    const r = replay(order.files, DatabaseSync)
    return {
      ...base,
      entities: r.entities,
      implicitIndexes: r.implicit,
      notes: [...order.notes, ...r.notes],
      complete: !r.stopped, partial: !!r.stopped,
      status: r.stopped ? 'partial' : 'read',
      label: r.stopped ? 'replayed to' : `replayed ${files}, ${counted(r.statements, 'statement')}`,
      ...(r.stopped ? { stopped: { path: r.stopped.path, line: r.stopped.line }, error: r.stopped.error } : {}),
    }
  }
  return { ...base, ...ddlFacts(readDdl(order.files, { dialect: dialect.dialect }), order.notes, `replayed ${files}`) }
}

// A schema dump, read as its dialect's statements.
function dumped(key, d, configs, journal, override, DatabaseSync) {
  const h = dumpHeader(d.text)
  const folder = dialectOf(key, configs, [], override, journal, true)
  const sniffed = sniffDialect([d])
  const dialect = override ? folder
    : h ? { dialect: /^PostgreSQL/.test(h[1]) ? 'postgres' : 'mysql', from: { how: 'stated', path: d.path, line: lineOf(d.text, /^-- (?:PostgreSQL database dump|MySQL dump|MariaDB dump)/m) } }
    : folder.dialect ? folder
    : sniffed.dialect ? { dialect: sniffed.dialect, from: { how: 'sniffed', marker: sniffed.marker, path: sniffed.path, line: sniffed.line } }
    : { dialect: null, reason: sniffed.reason }
  const base = {
    store: key, dialect: dialect.dialect, dialectFrom: dialect.from ?? null,
    source: { path: d.path, line: 1, kind: 'artifact', confidence: 'declared' },
    complete: false, partial: false, files: 1, notes: [], entities: [],
  }
  if (!dialect.dialect) return { ...base, status: 'not-read', label: `schema dump, dialect unknown (${dialect.reason})` }
  if (dialect.dialect === 'sqlite') {
    const r = replay([d], DatabaseSync)
    return { ...base, entities: r.entities, implicitIndexes: r.implicit, notes: r.notes, complete: !r.stopped, partial: !!r.stopped, status: r.stopped ? 'partial' : 'read', label: r.stopped ? 'read to' : `schema dump, ${counted(r.statements, 'statement')}`, ...(r.stopped ? { stopped: { path: r.stopped.path, line: r.stopped.line }, error: r.stopped.error } : {}) }
  }
  if (!['postgres', 'mysql'].includes(dialect.dialect)) return { ...base, status: 'not-read', label: `no reader for ${dialect.dialect} dumps` }
  return { ...base, ...ddlFacts(readDdl([d], { dialect: dialect.dialect, dump: true }), [], 'schema dump') }
}

// What readers/ddl.mjs read, as a declaration's facts: what it skipped counted per file by kind.
function ddlFacts(r, notes, what) {
  const skipped = r.skipped.reduce((a, s) => a + s.n, 0)
  const per = r.skipped.slice(0, NOTES).map((s) => `skipped in ${s.path}: ${s.n} statement${s.n === 1 ? ' that does' : 's that do'} not shape the store (${Object.entries(s.kinds).map(([k, n]) => `${k} ${n}`).join(', ')})`)
  if (r.skipped.length > NOTES) per.push(`… and ${r.skipped.length - NOTES} more files with skipped statements`)
  return {
    entities: r.entities,
    ...(r.enums.length ? { enums: r.enums } : {}),
    notes: [...notes, ...per, ...r.notes],
    complete: r.complete, partial: !!r.stopped,
    status: r.stopped ? 'partial' : 'read',
    label: r.stopped ? 'replayed to' : `${what}, ${counted(r.statements, 'statement')}${skipped ? ` (${skipped} skipped)` : ''}`,
    skipped: r.skipped,
    ...(r.stopped ? { stopped: { path: r.stopped.path, line: r.stopped.line }, error: r.stopped.error } : {}),
  }
}

function readJournal(folder, configs) {
  const p = folder === '.' ? 'meta/_journal.json' : `${folder}/meta/_journal.json`
  if (!configs.has(p)) return null
  const text = configs.get(p)
  try {
    const j = parseJson(text)
    return { path: p, tags: [...(j.entries || [])].sort((a, b) => a.idx - b.idx).map((e) => e.tag), dialect: j.dialect, line: lineOf(text, /"dialect"/) }
  } catch (e) { return { path: p, error: e.message } }
}

function dialectOf(folder, configs, members, override, journal, statedOnly = false) {
  if (override) return { dialect: normDialect(override), from: { how: 'override' } }
  for (const [p, text] of configs) {
    if (!DRIZZLE_CONFIG.test(p)) continue
    const d = /\bdialect\s*:\s*['"`](\w+)['"`]/.exec(text)
    const out = /\bout\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)
    if (d && P.normalize(P.join(P.dirname(p), out ? out[1] : 'drizzle')).replace(/\/+$/, '') === folder) return { dialect: normDialect(d[1]), from: { how: 'stated', path: p, line: lineOf(text, /\bdialect\s*:/) } }
  }
  if (journal?.dialect) return { dialect: normDialect(journal.dialect), from: { how: 'stated', path: journal.path, line: journal.line } }
  for (const [p, text] of configs) {
    const block = p.endsWith('schema.prisma') ? /datasource\s+\w+\s*\{[^}]*\}/.exec(text) : p.endsWith('migration_lock.toml') ? { 0: text, index: 0 } : null
    const m = block && /\bprovider\s*=\s*"(\w+)"/.exec(block[0])
    if (m) return { dialect: normDialect(m[1]), from: { how: 'stated', path: p, line: text.slice(0, block.index + m.index).split('\n').length } }
  }
  if (folder === 'supabase/migrations' || folder.endsWith('/supabase/migrations')) return { dialect: 'postgres', from: { how: 'supabase' } }
  if (statedOnly) return { dialect: null }
  const s = sniffDialect(members)
  return s.dialect ? { dialect: s.dialect, from: { how: 'sniffed', marker: s.marker, path: s.path, line: s.line } } : { dialect: null, reason: s.reason }
}

function orderOf(folder, members, journal) {
  const notes = []
  const nameOf = (p) => (folder === '.' ? p : p.slice(folder.length + 1)).split('/')[0] // the file, or its versioned subfolder
  if (journal?.tags) {
    const byTag = new Map(members.map((m) => [nameOf(m.path).replace(SQL, ''), m]))
    const files = []
    for (const t of journal.tags) {
      if (byTag.has(t)) { files.push(byTag.get(t)); byTag.delete(t) } else notes.push(`${journal.path} lists ${t}, which is not in the folder`)
    }
    for (const [, m] of byTag) notes.push(`${m.path} is not in ${journal.path}: never applied, not replayed`)
    return { files, notes }
  }
  if (journal?.error) notes.push(`${journal.path} does not parse (${journal.error}): ordered by file names`)
  const parts = (v) => v.split(/[._-]/).map(Number)
  const cmpParts = (x, y) => { for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1); return 0 }
  // a versioned-file tool: V<version>__ by version, R__ after them by name, U<version>__ (undo) never
  const fly = members.map((m) => ({ m, name: nameOf(m.path), f: FLYWAY.exec(nameOf(m.path)) }))
  if (fly.some((x) => x.f)) {
    const other = fly.find((x) => !x.f)
    if (other) return { error: `the names mix version prefixes (${other.name} beside V<version>__ names)`, notes }
    for (const x of fly.filter((y) => y.f[1] === 'U')) notes.push(`${x.m.path} is an undo migration: not replayed`)
    const versioned = fly.filter((x) => x.f[1] === 'V').map((x) => ({ ...x, v: parts(x.f[2]) })).sort((a, b) => cmpParts(a.v, b.v))
    for (let i = 1; i < versioned.length; i++) if (!cmpParts(versioned[i - 1].v, versioned[i].v)) return { error: `${versioned[i - 1].name} and ${versioned[i].name} share a version`, notes }
    const repeatable = fly.filter((x) => !x.f[1]).sort((a, b) => (a.f[3] < b.f[3] ? -1 : a.f[3] > b.f[3] ? 1 : 0))
    return { files: [...versioned, ...repeatable].map((x) => x.m), notes }
  }
  if (members.length === 1) return { files: members, notes }
  const named = members.map((m) => ({ m, name: nameOf(m.path), v: VERSION.exec(nameOf(m.path)) }))
  const bare = named.find((x) => !x.v)
  if (bare) return { error: `${bare.name} has no numeric or timestamp prefix`, notes }
  const schemes = [...new Set(named.map((x) => x.v[1].toUpperCase()))]
  if (schemes.length > 1) return { error: `the names mix version prefixes (${schemes.map((s) => s || 'none').join(', ')})`, notes }
  const cmp = (a, b) => cmpParts(parts(a.v[2]), parts(b.v[2]))
  named.sort(cmp)
  for (let i = 1; i < named.length; i++) if (cmp(named[i - 1], named[i]) === 0) return { error: `${named[i - 1].name} and ${named[i].name} share a version`, notes }
  return { files: named.map((x) => x.m), notes }
}
