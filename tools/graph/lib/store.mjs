// grimoire graph · storage. One SQLite file per project (node:sqlite, no dependency).
//
//   repos    name, root (project-relative), head (git HEAD at the last index), indexed_at
//   files    one row per indexed file; node_id = its `file` node
//   nodes    kind: file | function | method | constructor | class | struct | interface | trait |
//            protocol | enum | type | module | namespace | macro; qualname = Container.name;
//            parent_id = the enclosing type or module (NULL at top level); is_test
//   edges    src → dst, kind: CALLS | IMPORTS | EXTENDS | IMPLEMENTS; confidence: how the name
//            was resolved (same-class, qualified, import, same-file, same-package, unique-name,
//            ambiguous, path)
//   refs     unresolved names as extracted (call sites with the receiver's stated type when the
//            syntax gives it, supertypes); imports: import statements
//   cochange files that changed in the same commits (from git log), n = commits shared
//   churn    per file, n = recent commits that touched it (same window as cochange)
//   data_inputs  the files data extractors read (lib/data/registry.mjs): size, mtime, hash, and
//            ddl, what its content declares (registry.mjs inspect): for a .sql file its schema
//            statements (3 a schema dump's header over a table, 2 creates or alters a table or an
//            index, 1 other schema statements only, 0 none); for a JSON or YAML file its tables (3 a template's table resource, 2 a key
//            schema, a CreateTable input; 0 none); for a Terraform or Terragrunt file what it
//            declares (4 a module with a table resource, 5 a terragrunt.hcl Terragrunt runs, 6 a
//            module out of reach, 1 other); for a source file (.rs, .ts, .js, .py, .go, .prisma),
//            bits: 1 what the item binding reads (a serde derive or a type, a conversion, an
//            environment read, a string constant), 2 a key-value SDK call shape (the access
//            patterns), 4 a table-builder schema, 8 a barrel re-exporting relative modules, 16 a
//            schema-language file's models, 32 its datasource, 64 a query call beside SQL text or a
//            SQL client import (the queries the code sends); 0 none
//   data_facts   one row per extraction job: scope file | unit, key (the file, or the folder),
//            extractor 'id@version', sig (hash of its inputs), facts (JSON, lib/data/model.mjs),
//            or error when the extractor threw
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export const SCHEMA_VERSION = '12'

let sqlite = null
// node:sqlite, loaded once: the index's store, and the in-memory databases data/readers/sqlite-replay.mjs replays migrations into.
export async function driver() {
  if (sqlite) return sqlite
  const [maj, min] = process.versions.node.split('.').map(Number)
  if (maj < 22 || (maj === 22 && min < 5)) throw new Error(`the code graph needs Node ≥ 22.5 (node:sqlite); this is ${process.version}`)
  sqlite = await import('node:sqlite')
  return sqlite
}

// Every table of the index, in DDL order.
export const TABLES = ['meta', 'repos', 'files', 'nodes', 'refs', 'imports', 'edges', 'cochange', 'churn', 'data_inputs', 'data_facts']

const DDL = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS repos(name TEXT PRIMARY KEY, root TEXT, head TEXT, indexed_at TEXT, cochange_head TEXT);
CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, repo TEXT, path TEXT, lang TEXT, size INTEGER, mtime INTEGER, hash TEXT, is_test INTEGER, node_id INTEGER, UNIQUE(repo, path));
CREATE TABLE IF NOT EXISTS nodes(id INTEGER PRIMARY KEY, file_id INTEGER, kind TEXT, name TEXT, qualname TEXT, parent_id INTEGER, container TEXT, line INTEGER, end_line INTEGER, signature TEXT, is_test INTEGER);
CREATE INDEX IF NOT EXISTS nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS nodes_file ON nodes(file_id);
CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(parent_id);
CREATE TABLE IF NOT EXISTS refs(file_id INTEGER, src_id INTEGER, kind TEXT, name TEXT, qual TEXT, qtype TEXT, from_type TEXT, line INTEGER);
CREATE INDEX IF NOT EXISTS refs_file ON refs(file_id);
CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY, file_id INTEGER, source TEXT, names TEXT, alias TEXT, flags TEXT, line INTEGER, resolved INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS imports_file ON imports(file_id);
CREATE TABLE IF NOT EXISTS edges(src INTEGER, dst INTEGER, kind TEXT, confidence TEXT, line INTEGER);
CREATE INDEX IF NOT EXISTS edges_src ON edges(src, kind);
CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst, kind);
CREATE TABLE IF NOT EXISTS cochange(repo TEXT, a TEXT, b TEXT, n INTEGER);
CREATE INDEX IF NOT EXISTS cochange_a ON cochange(repo, a);
CREATE TABLE IF NOT EXISTS churn(repo TEXT, path TEXT, n INTEGER);
CREATE INDEX IF NOT EXISTS churn_repo ON churn(repo, path);
CREATE TABLE IF NOT EXISTS data_inputs(repo TEXT, path TEXT, size INTEGER, mtime INTEGER, hash TEXT, ddl INTEGER, PRIMARY KEY(repo, path));
CREATE TABLE IF NOT EXISTS data_facts(repo TEXT, scope TEXT, key TEXT, extractor TEXT, sig TEXT, facts TEXT, error TEXT, PRIMARY KEY(repo, extractor, key));
`

export async function openStore(dbPath, { readOnly = false } = {}) {
  const { DatabaseSync } = await driver()
  if (!readOnly) mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {})
  if (readOnly) return db
  db.exec('PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF;')
  const v = (() => { try { return db.prepare("SELECT value FROM meta WHERE key='schema'").get()?.value } catch { return null } })()
  if (v && v !== SCHEMA_VERSION) {
    for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`)
  }
  db.exec(DDL)
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema', ?)").run(SCHEMA_VERSION)
  return db
}

export function tx(db, fn) {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}
