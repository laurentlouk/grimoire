// grimoire graph · data · replaying a folder of SQLite migrations into an in-memory database
// (node:sqlite, no parser) and reading the result back with PRAGMA: exactly what a fresh database
// gets. Each table, column, key, index and foreign key is mapped to the migration file:line that
// created or last altered it.
//
//   replay([{ path, text }] in order, DatabaseSync) → { entities, implicit, statements, stopped, notes }
//     entities   the data model's declaration shape (model.mjs), sorted by name
//     implicit   how many indexes SQLite built itself for primary and unique keys (sqlite_autoindex_*):
//                the keys are the elements, this counts what PRAGMA index_list shows beside the
//                declared indexes
//     stopped    null, or { path, line, error }: the statement SQLite rejected. The replay stops
//                there and the entities are the state just before it.
//     notes      statements never run: ATTACH, DETACH and VACUUM reach files outside the replay
//
// The replay runs a repository's own SQL, so SQLite itself keeps it off the disk, not a textual
// filter alone: no database may be attached (`limits.attach = 0`, which also stops VACUUM INTO, as
// it attaches its target) and an authorizer denies ATTACH and DETACH, where this Node provides them.
// A probe ATTACH confirms the guard on every replay. On a Node with neither, a statement whose text
// names ATTACH, DETACH or VACUUM anywhere stops the replay (SQLite needs that keyword as an ASCII
// token, so a match on the raw text can only over-refuse, never miss), and each piece runs as one
// prepared statement, never through exec.
//
// How lines are found: sqlite_master is read before and after every statement. A new table name
// is created by that statement, or carried over from the table an `ALTER TABLE … RENAME TO` renamed
// (so a table rebuilt as `__new_t` and renamed keeps its columns' lines). A table whose definition
// changed was altered by it, when the statement names it (a rename elsewhere also rewrites the
// foreign keys pointing at it). A column is placed on its line of the CREATE TABLE that defined it,
// or on the statement that added or renamed it; keys and foreign keys on the line of that
// definition that states them.
import { split } from './sql-split.mjs'

const ID = '(?:"(?:[^"]|"")+"|`[^`]+`|\\[[^\\]]+\\]|[\\w$]+)'
const NAME = `(?:${ID}\\s*\\.\\s*)?(${ID})`
const CREATE_TABLE = new RegExp(`^CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?(?:VIRTUAL\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, 'i')
const ALTER_TABLE = new RegExp(`^ALTER\\s+TABLE\\s+${NAME}(?:\\s+RENAME\\s+TO\\s+${NAME})?`, 'i')
const OUTSIDE = /^(ATTACH|DETACH|VACUUM)\b/i
const NAMES_OUTSIDE = /\b(ATTACH|DETACH|VACUUM)\b/i
const SQLITE_ATTACH = 24, SQLITE_DETACH = 25, SQLITE_DENY = 1, SQLITE_OK = 0 // sqlite3.h authorizer codes
const GENERATED = { 2: 'virtual', 3: 'stored' }

const unquote = (s) => (/^["`[]/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s)
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const word = (s) => `[\`"\\[]?${esc(s)}[\`"\\]]?`

// The replay's database, with SQLite guarding the disk where this Node can: { db, guarded }.
export function openReplay(DatabaseSync) {
  const base = { enableForeignKeyConstraints: false } // SQLite's own default
  let db
  try { db = new DatabaseSync(':memory:', { ...base, limits: { attach: 0 } }) } catch { db = new DatabaseSync(':memory:', base) }
  if (typeof db.setAuthorizer === 'function') db.setAuthorizer((action) => (action === SQLITE_ATTACH || action === SQLITE_DETACH ? SQLITE_DENY : SQLITE_OK))
  let guarded = true
  try { db.exec("ATTACH ':memory:' AS grimoire_probe") } catch { return { db, guarded } }
  guarded = false
  db.exec('DETACH grimoire_probe')
  return { db, guarded }
}

export function replay(files, DatabaseSync) {
  const { db, guarded } = openReplay(DatabaseSync)
  const tables = new Map() // name → { loc, def: { text, path, line } | null, cols: Map(column → loc) }
  const objects = new Map() // index or view name → loc
  const notes = []
  let statements = 0, stopped = null
  try {
    let before = schema(db)
    run: for (const f of files) {
      for (const s of split(f.text)) {
        const outside = OUTSIDE.exec(s.text)
        if (outside) { notes.push(`skipped ${outside[1].toUpperCase()} at ${f.path}:${s.line} (never run: it reaches files outside the replay)`); continue }
        const named = !guarded && NAMES_OUTSIDE.exec(s.text)
        if (named) { stopped = { path: f.path, line: s.line, error: `refused: it names ${named[1].toUpperCase()}, and this Node cannot keep SQLite off the disk (no attach limit, no authorizer)` }; break run }
        try { if (guarded) db.exec(s.text); else db.prepare(s.text).run() } catch (e) { stopped = { path: f.path, line: s.line, error: e.message }; break run }
        statements++
        const after = schema(db)
        track(db, before, after, s.text, { path: f.path, line: s.line }, tables, objects)
        before = after
      }
    }
    return { ...read(db, tables, objects), statements, stopped, notes }
  } finally { db.close() }
}

const schema = (db) => new Map(db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map((r) => [r.name, r]))
const columnsOf = (db, table) => db.prepare('SELECT name FROM pragma_table_xinfo(?)').all(table).map((c) => c.name)

function track(db, before, after, text, loc, tables, objects) {
  const c = CREATE_TABLE.exec(text), a = ALTER_TABLE.exec(text)
  const created = c && unquote(c[1]), altered = a && unquote(a[1]), renamedTo = a && a[2] && unquote(a[2])
  for (const [name, row] of after) {
    const prev = before.get(name)
    if (prev && prev.sql === row.sql) continue
    if (row.type !== 'table') { if (row.sql) objects.set(name, loc); continue }
    let t = tables.get(name)
    if (!prev || !t) {
      const from = same(renamedTo, name) ? [...tables].find(([n]) => same(n, altered))?.[1] : null
      t = from ? { loc, def: from.def, cols: new Map(from.cols) } : { loc, def: same(created, name) ? { text, ...loc } : null, cols: new Map() }
      tables.set(name, t)
    } else if (same(altered, name) || same(created, name)) t.loc = loc
    const now = columnsOf(db, name)
    const fresh = t.def && t.def.text === text // defined by this very statement
    for (const col of now) if (!t.cols.has(col)) t.cols.set(col, (fresh && lineIn(t.def, new RegExp(`^\\s*(?:\\(\\s*)?${word(col)}(?=[\\s,)]|$)`, 'i'))) || loc)
    for (const col of t.cols.keys()) if (!now.includes(col)) t.cols.delete(col)
  }
  for (const name of before.keys()) if (!after.has(name)) { tables.delete(name); objects.delete(name) }
}

// The location of the first line of a definition matching one of the patterns, tried in order.
function lineIn(def, ...patterns) {
  if (!def) return null
  const lines = def.text.split('\n')
  for (const re of patterns) { const i = lines.findIndex((l) => re.test(l)); if (i >= 0) return { path: def.path, line: def.line + i } }
  return null
}

function read(db, tables, objects) {
  const all = (sql, ...a) => db.prepare(sql).all(...a)
  const at = (loc) => ({ path: loc?.path ?? null, line: loc?.line ?? null })
  const pkOf = (table) => all('SELECT name, pk FROM pragma_table_xinfo(?) WHERE pk > 0 ORDER BY pk', table).map((c) => c.name)
  const out = []
  let implicit = 0
  for (const { name, type } of all("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")) {
    if (type === 'view') { out.push({ name, kind: 'view', ...at(objects.get(name)), fields: [], keys: [], indexes: [], relations: [] }); continue }
    const t = tables.get(name) || { loc: null, def: null, cols: new Map() }
    const colAt = (col) => t.cols.get(col) || t.loc
    const fields = all('SELECT * FROM pragma_table_xinfo(?) ORDER BY cid', name).filter((c) => c.hidden !== 1)
      .map((c) => ({ name: c.name, type: c.type, nullable: !c.notnull, default: c.dflt_value ?? null, generated: GENERATED[c.hidden] ?? null, ...at(colAt(c.name)) }))
    const keys = []
    const pk = pkOf(name)
    if (pk.length) keys.push({ role: 'primary', parts: pk, ...at(lineIn(t.def, /\bPRIMARY\s+KEY\b/i) || colAt(pk[0])) })
    const indexes = []
    for (const ix of all('SELECT * FROM pragma_index_list(?) ORDER BY name', name)) {
      if (ix.origin !== 'c') implicit++
      if (ix.origin === 'pk') continue // the primary key's own index: the key is the element
      const columns = all('SELECT name FROM pragma_index_info(?) ORDER BY seqno', ix.name).map((c) => c.name ?? '(expression)')
      if (ix.origin === 'u') keys.push({ role: 'unique', parts: columns, ...at(lineIn(t.def, new RegExp(`\\bUNIQUE\\b.*${word(columns[0])}|${word(columns[0])}.*\\bUNIQUE\\b`, 'i'), /\bUNIQUE\b/i) || colAt(columns[0])) })
      else indexes.push({ name: ix.name, unique: !!ix.unique, columns, partial: !!ix.partial, ...at(objects.get(ix.name) || t.loc) })
    }
    const fks = new Map()
    for (const fk of all('SELECT * FROM pragma_foreign_key_list(?) ORDER BY id, seq', name)) {
      if (!fks.has(fk.id)) fks.set(fk.id, { columns: [], to: fk.table, toColumns: [], onDelete: fk.on_delete.toLowerCase(), onUpdate: fk.on_update.toLowerCase() })
      const r = fks.get(fk.id)
      r.columns.push(fk.from)
      if (fk.to !== null) r.toColumns.push(fk.to)
    }
    const relations = [...fks.values()].map((r) => {
      const refs = `\\bREFERENCES\\s+${word(r.to)}`
      const toColumns = r.toColumns.length ? r.toColumns : pkOf(r.to) // `REFERENCES t` names t's primary key
      return { ...r, toColumns, ...at(lineIn(t.def, new RegExp(`${word(r.columns[0])}.*${refs}`, 'i'), new RegExp(refs, 'i')) || colAt(r.columns[0])) }
    })
    out.push({ name, kind: 'table', ...at(t.loc), fields, keys, indexes, relations })
  }
  return { entities: out, implicit }
}
