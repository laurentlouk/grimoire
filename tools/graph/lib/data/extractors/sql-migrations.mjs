// grimoire graph · data · extractor: folders of SQL migrations, whatever tool wrote them. Per unit:
// one folder, re-run when any of its files or the configs naming its dialect change.
//
// Found by content, not by name: a folder is a migration folder when its .sql files (beside each
// other, or one per versioned subfolder: <version>_<name>/migration.sql or up.sql, as Prisma, Drizzle
// v1 and Diesel write them) create or alter tables or indexes. Down migrations (down.sql, *.down.sql)
// and files with no DDL (seeds, queries) are not part of it; a `-- migrate:down` or `-- +goose Down`
// section is cut off a file before it is read.
//
// Order: the tool's journal when there is one (Drizzle's meta/_journal.json: only the migrations it
// lists are ever applied), else the numeric or timestamp prefix of the file or subfolder names,
// compared number by number (0001_, 20240105090000_, V1.2__). When the names do not all carry one
// prefix scheme, or two share a version, the order is unknown and the folder is not replayed.
//
// Dialect, first found: grimoire.config.json (graph.data.migrations), a drizzle.config.* whose `out`
// is this folder, Drizzle's journal, Prisma's migration_lock.toml or schema.prisma datasource
// `provider`, Supabase (Postgres); else sniffed from the SQL (readers/sql-dialect.mjs). Unknown is
// never guessed. SQLite folders are replayed (readers/sqlite-replay.mjs); the others are recorded
// as found, not yet read.
import path from 'node:path'
import { replay } from '../readers/sqlite-replay.mjs'
import { sniffDialect } from '../readers/sql-dialect.mjs'
import { normDialect, lineOf } from '../model.mjs'

const P = path.posix
const SQL = /\.sql$/i
const DOWN = /(^|[/._-])down\.sql$/i
const STEP = /^(?:migration|up)\.sql$/i
const VERSIONED = /^[A-Za-z]?\d/
const VERSION = /^([A-Za-z]*)(\d+(?:[._-]\d+)*)/
const DRIZZLE_CONFIG = /(^|\/)drizzle\.config\.(?:ts|js|mjs|cjs|mts|cts|json)$/
const CONFIG = /(^|\/)(?:drizzle\.config\.(?:ts|js|mjs|cjs|mts|cts|json)|schema\.prisma|migration_lock\.toml|meta\/_journal\.json)$/
const DOWN_SECTION = /^--\s*(?:migrate:down|\+goose\s+down)\b/im

// A file's up migration: the text before a down section, if it has one.
export function upOnly(text) {
  const m = DOWN_SECTION.exec(text)
  return m ? text.slice(0, m.index) : text
}

export default {
  id: 'sql-migrations',
  version: 1,
  kind: 'migration',
  scope: 'unit',
  wants: (p) => (SQL.test(p) && !DOWN.test(p)) || CONFIG.test(p),
  // info: Map(path → { ddl }) of the candidate files; overrides: [{ path, dialect }] for this repository.
  discover(info, { overrides = [] } = {}) {
    const folders = new Map()
    for (const [p, i] of info) {
      if (!SQL.test(p) || !i.ddl) continue
      const dir = P.dirname(p)
      const folder = STEP.test(P.basename(p)) && dir !== '.' && VERSIONED.test(P.basename(dir)) ? P.dirname(dir) : dir
      if (!folders.has(folder)) folders.set(folder, [])
      folders.get(folder).push(p)
    }
    const configs = [...info.keys()].filter((p) => CONFIG.test(p))
    return [...folders].map(([folder, members]) => {
      const inside = (rel) => (folder === '.' ? rel : `${folder}/${rel}`)
      const mine = configs.filter((c) => {
        const d = P.dirname(c)
        if (DRIZZLE_CONFIG.test(c)) return d === '.' || folder === d || folder.startsWith(`${d}/`)
        if (c.endsWith('schema.prisma')) return d === P.dirname(folder)
        return c === inside('migration_lock.toml') || c === inside('meta/_journal.json')
      })
      const o = overrides.find((x) => x.path === folder)
      return { key: folder, inputs: [...members.sort(), ...mine.sort()], ...(o ? { override: o.dialect, salt: `dialect=${o.dialect}` } : {}) }
    })
  },
  extract({ key, files, override }, { DatabaseSync }) {
    const configs = new Map(files.filter((f) => CONFIG.test(f.path)).map((f) => [f.path, f.text]))
    const members = files.filter((f) => !CONFIG.test(f.path)).map((f) => ({ path: f.path, text: upOnly(f.text) }))
    const journal = readJournal(key, configs)
    const dialect = dialectOf(key, configs, members, override, journal)
    const order = orderOf(key, members, journal)
    const n = members.length
    const base = {
      store: key, dialect: dialect.dialect, dialectFrom: dialect.from ?? null,
      source: { path: (order.files?.length ? order.files : members)[0].path, line: 1, kind: 'migration', confidence: 'exact' },
      complete: false, partial: false, files: n, notes: order.notes, entities: [],
    }
    const found = (label) => ({ declarations: [{ ...base, status: 'not-read', label }] })
    if (!dialect.dialect) return found(`dialect unknown (no config states it, and ${dialect.reason})`)
    if (dialect.dialect !== 'sqlite') return found(`no reader for ${dialect.dialect} migrations yet`)
    if (order.error) return found(`order unknown (${order.error})`)
    const r = replay(order.files, DatabaseSync)
    return { declarations: [{
      ...base,
      entities: r.entities,
      implicitIndexes: r.implicit,
      notes: [...order.notes, ...r.notes],
      complete: !r.stopped, partial: !!r.stopped,
      status: r.stopped ? 'partial' : 'read',
      label: r.stopped ? 'replayed to' : `replayed ${order.files.length} file${order.files.length === 1 ? '' : 's'}, ${r.statements} statements`,
      ...(r.stopped ? { stopped: { path: r.stopped.path, line: r.stopped.line }, error: r.stopped.error } : {}),
    }] }
  },
}

function readJournal(folder, configs) {
  const p = folder === '.' ? 'meta/_journal.json' : `${folder}/meta/_journal.json`
  if (!configs.has(p)) return null
  const text = configs.get(p)
  try {
    const j = JSON.parse(text)
    return { path: p, tags: [...(j.entries || [])].sort((a, b) => a.idx - b.idx).map((e) => e.tag), dialect: j.dialect, line: lineOf(text, /"dialect"/) }
  } catch (e) { return { path: p, error: e.message } }
}

function dialectOf(folder, configs, members, override, journal) {
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
  if (members.length === 1) return { files: members, notes }
  const named = members.map((m) => ({ m, name: nameOf(m.path), v: VERSION.exec(nameOf(m.path)) }))
  const bare = named.find((x) => !x.v)
  if (bare) return { error: `${bare.name} has no numeric or timestamp prefix`, notes }
  const schemes = [...new Set(named.map((x) => x.v[1].toUpperCase()))]
  if (schemes.length > 1) return { error: `the names mix version prefixes (${schemes.map((s) => s || 'none').join(', ')})`, notes }
  const num = (x) => x.v[2].split(/[._-]/).map(Number)
  const cmp = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1); return 0 }
  named.sort(cmp)
  for (let i = 1; i < named.length; i++) if (cmp(named[i - 1], named[i]) === 0) return { error: `${named[i - 1].name} and ${named[i].name} share a version`, notes }
  return { files: named.map((x) => x.m), notes }
}
