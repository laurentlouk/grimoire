// ════════════════════════════════════════════════════════════════════════════
//  Tests — the data model map (tools/graph/lib/data)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/data.test.mjs
//
//  Part 1 needs no parser runtime: the readers and the model, run directly on strings.
//   1. splitting SQL into statements (Drizzle breakpoints, `;` outside quotes and comments, triggers)
//   2. sniffing a dialect from the SQL itself
//   3. replaying SQLite migrations into node:sqlite, each element mapped to the file:line behind it
//   4. reading Drizzle snapshots: the legacy `meta/NNNN_snapshot.json` (`tables{}`) and v1's `ddl[]`
//   5. reconciling the declarations of one store: merged sources, conflicts kept with both sides
//   6. finding migration folders by content, whatever tool wrote them, and ordering them
//   7. the Data tab: the ERD layout (data/layout.mjs), then a page rendered from a hand-built index
//      and its own script run in a stub DOM (as graph.test.mjs §5 and arch-docs.test.mjs §5 do):
//      anchors, tables, columns, foreign key lines, a conflict badge, source links, the folders
//      found but not read, a 200-table store collapsed and searchable, the CSP
//
//  Part 2 indexes a fixture project (fixtures/data) and asserts through the same `call()` the MCP
//  server and the CLI use. It needs the parser runtime (the fixture has TypeScript files): skipped
//  without it, except under CI, where a missing runtime fails.
//   8. four repositories: Drizzle with its snapshots, Prisma, a folder no tool named, Supabase, an
//      undeclared dialect and one stated in grimoire.config.json → graph_data and graph.mjs data
//   9. the Data tab of that project: its stores, ERD and links to the indexed migration files
//  10. incremental: a hand-edited migration (a conflict, badged in the Data tab), a rejected
//      statement, a deleted migration, a snapshot that no longer parses (reported by graph_status,
//      the index goes on)
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, realpathSync, utimesSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
process.env.GRIMOIRE_GRAPH_FRESH_MS = '0' // every query checks freshness (commands.mjs reads it on load)

const { split, schemaLevel } = await import('../lib/data/readers/sql-split.mjs')
const { sniffDialect } = await import('../lib/data/readers/sql-dialect.mjs')
const { replay, openReplay } = await import('../lib/data/readers/sqlite-replay.mjs')
const { driver } = await import('../lib/store.mjs')
const { default: drizzleSnapshot } = await import('../lib/data/extractors/drizzle-snapshot.mjs')
const { reconcile } = await import('../lib/data/reconcile.mjs')
const { default: sqlMigrations } = await import('../lib/data/extractors/sql-migrations.mjs')
const { candidates } = await import('../lib/data/registry.mjs')
const { DatabaseSync } = await driver()

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }

// The page: its data, and its own script run against a small stub DOM (graph.test.mjs §5's).
const blobOf = (page) => /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page)[1]
const dataOf = (page) => JSON.parse(blobOf(page).replace(/\\u003c/g, '<'))
const scriptOf = (page) => (/<script>([\s\S]*)<\/script>\s*<\/body>/.exec(page) || [])[1] || ''
async function stubPage(page, hash) {
  const vm = await import('node:vm')
  const blob = blobOf(page), listeners = {}
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.html = ''; this.value = ''; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} } }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v) }
    getAttribute(k) { return this.attrs[k] ?? null }
    append(...c) { this.kids.push(...c) }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f) }
    set innerHTML(v) { this.html = v; this.firstChild = new El('svg') }
    get innerHTML() { return this.html }
    querySelectorAll() { return [] }
    focus() {} setSelectionRange() {}
    get offsetHeight() { return 0 }
  }
  const doc = { createElement: (t) => new El(t), getElementById: (id) => (id === 'graph-data' ? { textContent: blob } : null), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null, querySelector: () => null }
  const loc = { hash }
  vm.runInNewContext(scriptOf(page), { document: doc, window: { addEventListener: (t, f) => { const prev = listeners[t]; listeners[t] = prev ? (e) => { prev(e); f(e) } : f }, innerWidth: 1400, scrollTo() {} }, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }) })
  const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
  const find = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = find(k, pred); if (f) return f } return null }
  const all = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); for (const k of n.kids || []) all(k, pred, out) } return out }
  const body = () => ({ kids: doc.body.kids || [] })
  const flat = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : (n.kids || []).map(flat).join(''))
  const pg = {
    text: () => dump(body()),
    lines: (tag) => all(body(), (n) => n.tagName === tag).map(flat), // each element's text as read, e.g. every LI
    hash: () => loc.hash,
    go: (h) => { loc.hash = h; listeners.hashchange() },
    find: (pred) => find(body(), pred),
    all: (pred) => all(body(), pred),
    ctl: (c) => find(body(), (n) => n.attrs && n.attrs['data-ctl'] === c),
    press: (c) => (pg.ctl(c).on.click || []).forEach((f) => f({})),
    search: (q) => pg.ctl('search').on.input[0]({ target: { value: q } }),
    erd: () => find(body(), (n) => n.attrs && n.attrs.id === 'data-box'), // the drawing: its svg markup is .html
    click: (i) => pg.erd().firstChild.on.click[0]({ target: { closest: (sel) => (/data-tbl/.test(sel) ? { dataset: { tbl: String(i) } } : null) } }),
  }
  return pg
}
// what an ERD draws: each table's columns in order, and each foreign key line's first title line
const tablesIn = (svg) => Object.fromEntries(svg.split('<g class="tbl').slice(1).map((seg) => [/aria-label="([^",]+),/.exec(seg)[1], [...seg.matchAll(/data-col="([^"]+)"/g)].map((m) => m[1])]))
const fksIn = (svg) => [...svg.matchAll(/<path class="fk[^"]*"[^>]*><title>([^\n<]*)/g)].map((m) => m[1]).sort()

// ── 1 · splitting SQL ──
console.log('\n1 · splitting SQL into statements')
{
  const drizzle = 'CREATE TABLE `a` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n--> statement-breakpoint\nCREATE INDEX `a_idx` ON `a` (`id`);--> statement-breakpoint\nDROP TABLE `b`;'
  eq(split(drizzle).map((s) => [s.line, s.text]), [[1, 'CREATE TABLE `a` (\n\t`id` text PRIMARY KEY NOT NULL\n)'], [5, 'CREATE INDEX `a_idx` ON `a` (`id`)'], [6, 'DROP TABLE `b`']], "Drizzle: one statement per breakpoint, each with the line it starts on")
  const plain = "-- CreateTable\nCREATE TABLE \"t\" (\n  \"motto\" TEXT DEFAULT 'read; then write -- always',\n  \"n\" INTEGER /* a ; in a comment */\n);\n\n/* block;\n comment */ INSERT INTO \"t\" VALUES ('it''s; fine', 1);\n-- trailing comment; only"
  eq(split(plain).map((s) => [s.line, s.text.split('\n')[0]]), [[2, 'CREATE TABLE "t" ('], [8, 'INSERT INTO "t" VALUES (\'it\'\'s; fine\', 1)']], 'plain `;`: never inside a string, an escaped quote or a comment; comment-only text is no statement')
  const trigger = 'CREATE TRIGGER t_upd AFTER UPDATE ON t BEGIN\n  UPDATE t SET b = CASE WHEN NEW.a > 1 THEN 1 ELSE 0 END;\n  UPDATE t SET "end" = 2 WHERE a = 1;\nEND;\nCREATE TABLE u (x)'
  eq(split(trigger).map((s) => s.line), [1, 5], "a trigger's BEGIN … END body keeps its `;`, and a CASE … END inside it does not close it")
  const noBody = `CREATE TRIGGER t_audit BEFORE UPDATE ON a FOR EACH ROW EXECUTE FUNCTION audit();\n${'INSERT INTO a VALUES (1);\n'.repeat(40000)}CREATE TABLE b (x);`
  eq(split(noBody).length, 40002, 'a trigger with no BEGIN (Postgres, MySQL) ends at its `;`: it swallows nothing after it')
  eq(schemaLevel('CREATE TRIGGER t BEFORE UPDATE ON a FOR EACH ROW EXECUTE FUNCTION f();\nCREATE TABLE b (x);\nALTER TABLE b ADD y TEXT;'), 2, '… so DDL after it is still seen')
  eq([schemaLevel('-- seed\nINSERT INTO t VALUES (1);'), schemaLevel('/* CREATE TABLE x */ INSERT INTO t VALUES (1);\nUPDATE t SET a = 2;\nDELETE FROM t;')], [0, 0], 'a seed (no schema statement, or one only in a comment) is not a migration')
  eq(['CREATE TABLE x (a)', 'alter table x add b', 'CREATE UNIQUE INDEX i ON x (a)', 'create index i on x (a)'].map(schemaLevel), [2, 2, 2, 2], 'CREATE TABLE, ALTER TABLE and CREATE [UNIQUE] INDEX create or alter a table or an index: they find a migration folder')
  eq(['DROP TABLE legacy;', 'DROP INDEX i;', 'CREATE VIEW v AS SELECT 1;', 'DROP VIEW v;', 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END;', 'DROP TRIGGER t;'].map(schemaLevel), [1, 1, 1, 1, 1, 1], 'DROP, views and triggers are schema statements too: a file holding only them belongs to the folder')
}

// ── 2 · sniffing the dialect ──
console.log('\n2 · sniffing the dialect')
{
  const f = (text, path = 'm/0001_a.sql') => ({ path, text })
  eq(sniffDialect([f('CREATE TABLE a (\n  id INTEGER PRIMARY KEY AUTOINCREMENT\n);')]), { dialect: 'sqlite', marker: 'AUTOINCREMENT', path: 'm/0001_a.sql', line: 2 }, 'SQLite: AUTOINCREMENT, with where it was seen')
  eq(sniffDialect([f('CREATE TABLE `a` (`id` text);'), f('CREATE TABLE b (x) WITHOUT ROWID;', 'm/0002_b.sql')]).dialect, 'sqlite', 'backtick identifiers (which SQLite accepts and Drizzle writes for it) give way to a SQLite marker')
  eq(sniffDialect([f('CREATE TABLE a (id BIGSERIAL PRIMARY KEY, body JSONB);')]).dialect, 'postgres', 'Postgres: SERIAL, JSONB')
  eq(sniffDialect([f('CREATE TABLE a (id INT UNSIGNED AUTO_INCREMENT) ENGINE=InnoDB;')]).dialect, 'mysql', 'MySQL: AUTO_INCREMENT, UNSIGNED, ENGINE=')
  eq(sniffDialect([f("CREATE TABLE a (note TEXT DEFAULT 'x::y'); -- JSONB later")]), { dialect: null, reason: 'no dialect marker in the SQL' }, 'markers inside strings and comments do not count; none at all is unknown')
  const mixed = sniffDialect([f('CREATE TABLE a (id INTEGER PRIMARY KEY AUTOINCREMENT);'), f('CREATE TABLE b (at TIMESTAMPTZ);', 'm/0002_b.sql')])
  eq(mixed, { dialect: null, reason: 'conflicting dialect markers: sqlite (AUTOINCREMENT at m/0001_a.sql:1), postgres (TIMESTAMPTZ at m/0002_b.sql:1)' }, 'conflicting markers are unknown, never a guess')
}

// ── 3 · replaying SQLite migrations ──
console.log('\n3 · replaying SQLite migrations')
// one line per element: what it is, then where it comes from
const at = (x) => `@${x.path}:${x.line}`
const brief = (e) => [
  `${e.name} ${e.kind} ${at(e)}`,
  ...e.fields.map((f) => `  ${f.name} ${f.type} ${f.nullable ? 'null' : 'not null'}${f.default !== null ? ` default ${f.default}` : ''} ${at(f)}`),
  ...e.keys.map((k) => `  ${k.role} (${k.parts.join(', ')}) ${at(k)}`),
  ...e.indexes.map((i) => `  index ${i.name}${i.unique ? ' unique' : ''} (${i.columns.join(', ')}) ${at(i)}`),
  ...e.relations.map((r) => `  fk (${r.columns.join(', ')}) -> ${r.to}(${r.toColumns.join(', ')}) delete ${r.onDelete} update ${r.onUpdate} ${at(r)}`),
]
{
  const init = { path: 'db/0001_init.sql', text: `CREATE TABLE authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  bio TEXT
);
CREATE TABLE books (
  id TEXT PRIMARY KEY NOT NULL,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'untitled',
  UNIQUE (title, author_id)
);
CREATE INDEX books_author_idx ON books (author_id);
` }
  const shelves = { path: 'db/0002_shelves.sql', text: `ALTER TABLE books ADD COLUMN isbn TEXT;
CREATE TABLE shelf_books (
  shelf_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  PRIMARY KEY (shelf_id, book_id),
  FOREIGN KEY (book_id) REFERENCES books(id)
);
PRAGMA foreign_keys=OFF;
CREATE TABLE __new_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  bio TEXT DEFAULT '' NOT NULL
);
INSERT INTO __new_authors SELECT id, name, coalesce(bio, '') FROM authors;
DROP TABLE authors;
ALTER TABLE __new_authors RENAME TO authors;
ALTER TABLE books RENAME COLUMN title TO heading;
` }
  const r = replay([init, shelves], DatabaseSync)
  eq(r.entities.map(brief), [
    ['authors table @db/0002_shelves.sql:16',
      '  id INTEGER not null @db/0002_shelves.sql:10', '  name TEXT not null @db/0002_shelves.sql:11', "  bio TEXT not null default '' @db/0002_shelves.sql:12",
      '  primary (id) @db/0002_shelves.sql:10'],
    ['books table @db/0002_shelves.sql:17',
      '  id TEXT not null @db/0001_init.sql:7', '  author_id INTEGER not null @db/0001_init.sql:8', "  heading TEXT not null default 'untitled' @db/0002_shelves.sql:17", '  isbn TEXT null @db/0002_shelves.sql:1',
      '  primary (id) @db/0001_init.sql:7', '  unique (heading, author_id) @db/0001_init.sql:10',
      '  index books_author_idx (author_id) @db/0001_init.sql:12',
      '  fk (author_id) -> authors(id) delete cascade update no action @db/0001_init.sql:8'],
    ['shelf_books table @db/0002_shelves.sql:2',
      '  shelf_id TEXT not null @db/0002_shelves.sql:3', '  book_id TEXT not null @db/0002_shelves.sql:4',
      '  primary (shelf_id, book_id) @db/0002_shelves.sql:5',
      '  fk (book_id) -> books(id) delete no action update no action @db/0002_shelves.sql:6'],
  ], 'every table, column, key, index and foreign key, each at the line that created or last altered it (a rebuilt table keeps its columns\' lines through the rename)')
  eq([r.statements, r.stopped, r.implicit], [11, null, 3], "every statement ran; SQLite built 3 indexes of its own for keys (books' and shelf_books' primary keys, books' unique pair)")

  const bad = { path: 'db/0003_more.sql', text: 'ALTER TABLE books ADD COLUMN pages INTEGER;\n\nALTER TABLE nope ADD COLUMN x TEXT;\nCREATE TABLE never (x);\n' }
  const p = replay([init, bad], DatabaseSync)
  eq(p.stopped, { path: 'db/0003_more.sql', line: 3, error: 'no such table: nope' }, 'a statement SQLite rejects stops the replay there, with the error')
  eq([p.entities.map((e) => e.name), p.entities[1].fields.map((f) => `${f.name}@${f.line}`)], [['authors', 'books'], ['id@7', 'author_id@8', 'title@9', 'pages@1']], 'the facts replayed so far are kept')
  const attach = replay([{ path: 'db/0001_x.sql', text: "ATTACH DATABASE 'elsewhere.db' AS other;\nCREATE TABLE t (x);\nVACUUM INTO 'copy.db';" }], DatabaseSync)
  eq([attach.statements, attach.notes], [1, ['skipped ATTACH at db/0001_x.sql:1 (never run: it reaches files outside the replay)', 'skipped VACUUM at db/0001_x.sql:3 (never run: it reaches files outside the replay)']], 'statements that write files are never run')

  // SQLite itself keeps the replay off the disk, whatever text reaches it (a piece the splitter
  // and SQLite's lexer read differently, a computed VACUUM INTO target)
  const disk = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-replay-')))
  try {
    const { db, guarded } = openReplay(DatabaseSync)
    if (!guarded) { db.close(); console.log(`   · this Node (${process.version}) has no attach limit and no authorizer: the engine checks are skipped, the text guard below still runs`) } else {
      const refused = []
      for (const q of [`CREATE TABLE a (x); ATTACH '${disk}/a.db' AS other`, `VACUUM INTO '${disk}/' || 'copy.db'`, 'DETACH main', `PRAGMA temp_store_directory = '${disk}'`, 'PRAGMA data_store_directory']) { try { db.exec(q) } catch (e) { refused.push(e.message) } }
      db.close()
      eq([refused.length, readdirSync(disk)], [5, []], `the engine refuses ATTACH, VACUUM INTO, DETACH and the directory PRAGMAs, and no file is written (${refused.join(' | ')})`)
      // A real splitter desync: SQLite reads `éCASE` as one identifier, the splitter as a CASE, so the
      // trigger's piece never closes and swallows the ATTACH after it (this wrote a file before 0.27.1)
      const desync = replay([{ path: 'db/0001_x.sql', text: `CREATE TABLE a (éCASE INTEGER);\nCREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET éCASE = 1; END;\nATTACH '${disk}/pwned.db' AS o;\nCREATE TABLE z (x);` }], DatabaseSync)
      eq([desync.stopped, readdirSync(disk)], [{ path: 'db/0001_x.sql', line: 2, error: 'refused: not authorized (it reaches files outside the replay)' }, []], 'a piece the splitter mis-cuts still cannot attach: SQLite refuses it, the replay stops there and says why')
      const keywords = replay([{ path: 'db/0001_t.sql', text: 'CREATE TABLE t (attach TEXT, vacuum INTEGER);' }], DatabaseSync)
      eq([keywords.stopped, keywords.entities[0].fields.map((f) => f.name)], [null, ['attach', 'vacuum']], 'with the engine guarding, columns named like those keywords replay')
    }
  } finally { rmSync(disk, { recursive: true, force: true }) }

  // A Node with neither guard (no attach limit, no authorizer): refused by text, one statement a piece
  class Unguarded {
    constructor(p, { limits, ...o } = {}) { this.d = new DatabaseSync(p, o) }
    exec(q) { return this.d.exec(q) }
    prepare(q) { return this.d.prepare(q) }
    close() { this.d.close() }
  }
  const open = openReplay(Unguarded)
  open.db.close()
  const old = replay([{ path: 'db/0001_t.sql', text: 'CREATE TABLE t (x);\nCREATE TABLE u (attach TEXT);' }], Unguarded)
  eq([open.guarded, old.entities.map((e) => e.name), old.stopped], [false, ['t'], { path: 'db/0001_t.sql', line: 2, error: 'refused: it names ATTACH, and this Node cannot keep SQLite off the disk (no attach limit, no authorizer)' }],
    'without an engine guard, a statement naming ATTACH stops the replay before it runs')
}

// ── 4 · Drizzle snapshots ──
console.log('\n4 · Drizzle snapshots')
const LEGACY = `{
  "version": "6",
  "dialect": "sqlite",
  "id": "00000000-0000-4000-8000-000000000002",
  "prevId": "00000000-0000-4000-8000-000000000001",
  "tables": {
    "books": {
      "name": "books",
      "columns": {
        "id": { "name": "id", "type": "text", "primaryKey": true, "notNull": true, "autoincrement": false },
        "author_id": { "name": "author_id", "type": "integer", "primaryKey": false, "notNull": true, "autoincrement": false },
        "title": { "name": "title", "type": "text", "primaryKey": false, "notNull": true, "autoincrement": false, "default": "'untitled'" }
      },
      "indexes": { "books_author_idx": { "name": "books_author_idx", "columns": ["author_id"], "isUnique": false } },
      "foreignKeys": { "books_author_id_authors_id_fk": { "name": "books_author_id_authors_id_fk", "tableFrom": "books", "tableTo": "authors", "columnsFrom": ["author_id"], "columnsTo": ["id"], "onDelete": "cascade", "onUpdate": "no action" } },
      "compositePrimaryKeys": {},
      "uniqueConstraints": { "books_title_author_id_unique": { "name": "books_title_author_id_unique", "columns": ["title", "author_id"] } },
      "checkConstraints": {}
    },
    "shelf_books": {
      "name": "shelf_books",
      "columns": {
        "shelf_id": { "name": "shelf_id", "type": "text", "primaryKey": false, "notNull": true, "autoincrement": false },
        "book_id": { "name": "book_id", "type": "text", "primaryKey": false, "notNull": true, "autoincrement": false }
      },
      "indexes": {},
      "foreignKeys": {},
      "compositePrimaryKeys": { "shelf_books_shelf_id_book_id_pk": { "columns": ["shelf_id", "book_id"], "name": "shelf_books_shelf_id_book_id_pk" } },
      "uniqueConstraints": {},
      "checkConstraints": {}
    }
  },
  "views": {},
  "enums": {},
  "_meta": { "schemas": {}, "tables": {}, "columns": {} },
  "internal": { "indexes": {} }
}
`
const V1 = `{
  "version": "7",
  "dialect": "sqlite",
  "id": "00000000-0000-4000-8000-000000000013",
  "prevIds": ["00000000-0000-4000-8000-000000000012"],
  "ddl": [
    { "entityType": "tables", "name": "books" },
    { "entityType": "columns", "table": "books", "name": "id", "type": "text", "notNull": true, "autoincrement": false, "default": null, "generated": null },
    { "entityType": "columns", "table": "books", "name": "title", "type": "text", "notNull": true, "autoincrement": false, "default": "'untitled'", "generated": null },
    { "entityType": "pks", "table": "books", "name": "books_pk", "columns": ["id"], "nameExplicit": false },
    { "entityType": "indexes", "table": "books", "name": "books_title_idx", "columns": [{ "value": "title", "isExpression": false }], "isUnique": true, "where": null, "origin": "manual" },
    { "entityType": "fks", "table": "books", "name": "books_shelf_fk", "columns": ["id"], "tableTo": "shelf_books", "columnsTo": ["book_id"], "onUpdate": "NO ACTION", "onDelete": "CASCADE", "nameExplicit": true },
    { "entityType": "uniques", "table": "books", "name": "books_title_unique", "columns": ["title"], "nameExplicit": false },
    { "entityType": "checks", "table": "books", "name": "books_title_check", "value": "length(title) > 0" }
  ],
  "renames": []
}
`
{
  const jobs = drizzleSnapshot.discover(new Map(['db/meta/0002_snapshot.json', 'db/meta/0010_snapshot.json', 'db/meta/0009_snapshot.json', 'db/meta/_journal.json', 'next/20240101000000_init/snapshot.json', 'next/20240101000000_init/migration.sql', 'other/snapshot.json'].map((p) => [p, {}])))
  eq(jobs.map((j) => j.key).sort(), ['db/meta/0010_snapshot.json', 'next/20240101000000_init/snapshot.json'], "the newest legacy snapshot of each meta/ folder (numerically), and every v1 snapshot beside its migration.sql")
  const [d] = drizzleSnapshot.extract(LEGACY, 'db/meta/0010_snapshot.json').declarations
  eq([d.store, d.dialect, d.dialectFrom, d.complete, d.source], ['db', 'sqlite', { how: 'stated', path: 'db/meta/0010_snapshot.json', line: 3 }, true, { path: 'db/meta/0010_snapshot.json', line: 1, kind: 'artifact', confidence: 'declared' }], 'legacy: the store is the folder holding meta/, its dialect where the snapshot states it')
  eq(d.entities.map(brief), [
    ['books table @db/meta/0010_snapshot.json:7',
      '  id text not null @db/meta/0010_snapshot.json:10', '  author_id integer not null @db/meta/0010_snapshot.json:11', "  title text not null default 'untitled' @db/meta/0010_snapshot.json:12",
      '  primary (id) @db/meta/0010_snapshot.json:10', '  unique (title, author_id) @db/meta/0010_snapshot.json:17',
      '  index books_author_idx (author_id) @db/meta/0010_snapshot.json:14',
      '  fk (author_id) -> authors(id) delete cascade update no action @db/meta/0010_snapshot.json:15'],
    ['shelf_books table @db/meta/0010_snapshot.json:20',
      '  shelf_id text not null @db/meta/0010_snapshot.json:23', '  book_id text not null @db/meta/0010_snapshot.json:24',
      '  primary (shelf_id, book_id) @db/meta/0010_snapshot.json:28'],
  ], 'legacy: tables, columns, the primary key (one column, or composite), unique constraints, indexes, foreign keys, each at its JSON line')
  const [v] = drizzleSnapshot.extract(V1, 'next/20240101000000_init/snapshot.json').declarations
  eq([v.store, v.snapshot], ['next', { id: '00000000-0000-4000-8000-000000000013', prevIds: ['00000000-0000-4000-8000-000000000012'] }], 'v1: the store is the folder of the migration folders; the snapshot keeps its place in the DAG')
  eq(v.entities.map(brief), [
    ['books table @next/20240101000000_init/snapshot.json:7',
      '  id text not null @next/20240101000000_init/snapshot.json:8', "  title text not null default 'untitled' @next/20240101000000_init/snapshot.json:9",
      '  primary (id) @next/20240101000000_init/snapshot.json:10', '  unique (title) @next/20240101000000_init/snapshot.json:13',
      '  index books_title_idx unique (title) @next/20240101000000_init/snapshot.json:11',
      '  fk (id) -> shelf_books(book_id) delete cascade update no action @next/20240101000000_init/snapshot.json:12'],
  ], 'v1: ddl[] entries by entityType (checks are not part of the model yet)')
  let threw = null
  try { drizzleSnapshot.extract('{"version": "6", "tables": ', 'db/meta/0011_snapshot.json') } catch (e) { threw = e.message }
  ok(!!threw, `a snapshot that does not parse throws (the index reports it): ${threw}`)
}

// ── 5 · reconciling declarations ──
console.log('\n5 · reconciling declarations')
const srcs = (x) => x.sources.map((s) => `${s.path}:${s.line} ${s.kind} ${s.extractor}`)
const confl = (x) => x.conflicts.map((c) => `${c.attr}: ${c.values.map((v) => `${v.value} @ ${v.sources.map((s) => `${s.path}:${s.line}`).join(' ')}`).join(' | ')}`)
const everyConflict = (store) => store.entities.flatMap((e) => [[e.name, e], ...e.fields.map((f) => [`${e.name}.${f.name}`, f]), ...e.keys.map((k) => [`${e.name} ${k.role} (${k.parts.join(', ')})`, k]), ...e.indexes.map((i) => [`${e.name} index ${i.name}`, i]), ...e.relations.map((r) => [`${e.name} fk (${r.columns.join(', ')})`, r])]
  .flatMap(([label, x]) => confl(x).map((c) => `${label} ${c}`)))
{
  const migration = (text, extra = {}) => ({ declarations: [{ store: 'db', dialect: 'sqlite', dialectFrom: { how: 'sniffed', marker: 'AUTOINCREMENT', path: 'db/0001_init.sql', line: 1 }, source: { path: 'db/0001_init.sql', line: 1, kind: 'migration', confidence: 'exact' }, complete: true, partial: false, status: 'read', label: 'replayed', notes: [], ...extra, entities: replay([{ path: 'db/0001_init.sql', text }], DatabaseSync).entities }] })
  const AGREES = `CREATE TABLE \`books\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`author_id\` integer NOT NULL,
\t\`title\` text DEFAULT 'untitled' NOT NULL,
\tFOREIGN KEY (\`author_id\`) REFERENCES \`authors\`(\`id\`) ON UPDATE no action ON DELETE cascade,
\tCONSTRAINT books_title_author_id_unique UNIQUE(\`title\`, \`author_id\`)
);
CREATE INDEX \`books_author_idx\` ON \`books\` (\`author_id\`);
CREATE TABLE \`shelf_books\` (
\t\`shelf_id\` text NOT NULL,
\t\`book_id\` text NOT NULL,
\tPRIMARY KEY(\`shelf_id\`, \`book_id\`)
);`
  const snapshot = { repo: 'app', extractor: 'drizzle-snapshot@1', facts: drizzleSnapshot.extract(LEGACY, 'db/meta/0010_snapshot.json') }
  const model = reconcile([{ repo: 'app', extractor: 'sql-migrations@1', facts: migration(AGREES) }, snapshot])
  const [st] = model.stores
  eq([model.stores.length, st.id, st.dialect, st.entities.map((e) => e.id)], [1, 'app:db', 'sqlite', ['app:db/books', 'app:db/shelf_books']], 'a replay and a snapshot of one folder are two declarations of one store')
  eq(everyConflict(st), [], 'replay and snapshot agree element for element: no conflict')
  const books = st.entities[0]
  eq(srcs(books.fields.find((f) => f.name === 'title')), ['db/meta/0010_snapshot.json:12 artifact drizzle-snapshot@1', 'db/0001_init.sql:4 migration sql-migrations@1'], 'each element keeps both sources, most trusted first')
  eq(st.entities[1].keys.map((k) => [k.role, k.parts, srcs(k)]), [['primary', ['shelf_id', 'book_id'], ['db/meta/0010_snapshot.json:28 artifact drizzle-snapshot@1', 'db/0001_init.sql:12 migration sql-migrations@1']]], "a composite primary key is compared as a key: the snapshot's compositePrimaryKeys and the columns PRAGMA marks are one element")

  const edited = AGREES.replace("\`title\` text DEFAULT 'untitled' NOT NULL", "\`title\` varchar(80) DEFAULT 'untitled' NOT NULL").replace('CREATE INDEX', 'ALTER TABLE \`books\` ADD \`isbn\` text;\nCREATE INDEX')
  const drift = reconcile([{ repo: 'app', extractor: 'sql-migrations@1', facts: migration(edited) }, snapshot]).stores[0]
  eq(everyConflict(drift), [
    'books.title type: text @ db/meta/0010_snapshot.json:12 | varchar(80) @ db/0001_init.sql:4',
    'books.isbn presence: declared @ db/0001_init.sql:8 | absent @ db/meta/0010_snapshot.json:7',
  ], 'a hand-edited migration disagreeing with the snapshot: each conflict carries both sources, none resolved')

  const partial = reconcile([{ repo: 'app', extractor: 'sql-migrations@1', facts: migration(edited, { complete: false, partial: true, status: 'partial' }) }, snapshot]).stores[0]
  eq([everyConflict(partial), srcs(partial.entities[0].fields.find((f) => f.name === 'isbn'))], [[], ['db/0001_init.sql:8 migration sql-migrations@1']], 'a replay that stopped early is shown, but compared with nothing')

  const declaring = (kind, path, entities) => ({ repo: 'app', extractor: `${kind}@1`, facts: { declarations: [{ store: 'db', dialect: 'sqlite', source: { path, line: 1, kind, confidence: 'declared' }, complete: true, partial: false, status: 'read', notes: [], entities }] } })
  const replayed = replay([{ path: 'db/0001_t.sql', text: 'CREATE TABLE t (\n  at integer DEFAULT (unixepoch()) NOT NULL,\n  total integer DEFAULT ((1) + (2))\n);' }], DatabaseSync).entities
  const written = [{ name: 't', kind: 'table', line: 2, fields: [{ name: 'at', type: 'integer', nullable: false, default: '(unixepoch())', line: 3 }, { name: 'total', type: 'integer', nullable: true, default: '((1) + (2))', line: 4 }], keys: [], indexes: [], relations: [] }]
  const defaults = reconcile([declaring('migration', 'db/0001_t.sql', replayed), declaring('artifact', 'db/meta/0001_snapshot.json', written)]).stores[0]
  eq([everyConflict(defaults), defaults.entities[0].fields.map((f) => f.default)], [[], ['(unixepoch())', '((1) + (2))']], 'an expression default: SQLite reports it without its outer parentheses, a snapshot as written; they compare without one balanced outer pair (never `1) + (2`), and show as declared')

  const v1 = (id, prevIds, text) => ({ repo: 'app', extractor: 'drizzle-snapshot@1', facts: drizzleSnapshot.extract(text.replace(/"id": "[^"]+"/, `"id": "${id}"`).replace(/"prevIds": \[[^\]]*\]/, `"prevIds": ${JSON.stringify(prevIds)}`), `next/${id.slice(-2)}_x/snapshot.json`) })
  const dag = reconcile([v1('00000000-0000-4000-8000-000000000012', [], V1.replace('"name": "title"', '"name": "subtitle"')), v1('00000000-0000-4000-8000-000000000013', ['00000000-0000-4000-8000-000000000012'], V1)]).stores[0]
  eq(dag.entities[0].fields.map((f) => [f.name, srcs(f)]), [['id', ['next/13_x/snapshot.json:8 artifact drizzle-snapshot@1']], ['title', ['next/13_x/snapshot.json:9 artifact drizzle-snapshot@1']]], 'Drizzle v1: only the leaves of the snapshot DAG declare the store')
}

// ── 6 · finding and ordering migration folders ──
console.log('\n6 · finding and ordering migration folders')
{
  eq(candidates(['a/down.sql', 'a/0001_x.down.sql', 'a/0001_x.up.sql', 'tests/fixtures/db/0001_a.sql', 'node_modules/pkg/0001_a.sql', 'db/0007_tests.sql', 'src/app.ts', 'drizzle/meta/0003_snapshot.json'], { exclude: [] }),
    ['a/0001_x.up.sql', 'db/0007_tests.sql', 'drizzle/meta/0003_snapshot.json'], 'inputs: SQL but no down migration, nothing under test-support folders or dependencies (a migration named …_tests.sql is still one)')
  const info = new Map(Object.entries({
    'drizzle.config.ts': {}, 'drizzle/0000_a.sql': { ddl: 2 }, 'drizzle/0001_b.sql': { ddl: 1 }, 'drizzle/meta/_journal.json': {},
    'prisma/schema.prisma': {}, 'prisma/migrations/migration_lock.toml': {}, 'prisma/migrations/20240105090000_init/migration.sql': { ddl: 2 },
    'storage/schema-changes/0001_visits.up.sql': { ddl: 2 }, 'storage/schema-changes/seed_visits.sql': { ddl: 0 },
    'queries/find_user.sql': { ddl: 0 }, 'views/report.sql': { ddl: 1 },
    'ledger/steps/001-init.sql': { ddl: 2 }, 'ledger/steps/002-drop.sql': { ddl: 1 }, 'ledger/steps/003-view.sql': { ddl: 1 },
  }))
  eq(sqlMigrations.discover(info, { overrides: [{ path: 'storage/schema-changes', dialect: 'sqlite' }] }).map((j) => [j.key, j.inputs, j.override ?? null]), [
    ['drizzle', ['drizzle/0000_a.sql', 'drizzle/0001_b.sql', 'drizzle.config.ts', 'drizzle/meta/_journal.json'], null],
    ['prisma/migrations', ['prisma/migrations/20240105090000_init/migration.sql', 'drizzle.config.ts', 'prisma/migrations/migration_lock.toml', 'prisma/schema.prisma'], null],
    ['storage/schema-changes', ['storage/schema-changes/0001_visits.up.sql', 'drizzle.config.ts'], 'sqlite'],
    ['ledger/steps', ['ledger/steps/001-init.sql', 'ledger/steps/002-drop.sql', 'ledger/steps/003-view.sql', 'drizzle.config.ts'], null],
  ], 'a folder is found by a file creating or altering a table or an index, whatever its name; once found, every file of it with a schema statement belongs to it (a DROP, a view); one migration per versioned subfolder counts for its parent; seeds and queries are not migrations; the configs that may state its dialect come along (a drizzle.config above it applies when its `out` names the folder)')
  const label = (key, files) => sqlMigrations.extract({ key, files: files.map(([path, text]) => ({ path, text })) }, { DatabaseSync }).declarations[0].label
  const pk = 'INTEGER PRIMARY KEY AUTOINCREMENT'
  eq(label('schema', [['schema/posts.sql', `CREATE TABLE posts (id ${pk});`], ['schema/users.sql', `CREATE TABLE users (id ${pk});`]]), 'order unknown (posts.sql has no numeric or timestamp prefix)', 'names without a version prefix: the order is unknown, nothing is replayed')
  eq(label('flyway', [['flyway/V10__c.sql', 'ALTER TABLE b ADD COLUMN c TEXT;'], ['flyway/V1__a.sql', `CREATE TABLE a (id ${pk});`], ['flyway/V2__b.sql', 'CREATE TABLE b (id INTEGER);']]), 'replayed 3 files, 3 statements', 'versions compare as numbers: V1, V2, V10')
  const dbmate = sqlMigrations.extract({ key: 'db', files: [{ path: 'db/20240101000000_t.sql', text: `-- migrate:up\nCREATE TABLE t (id ${pk});\n\n-- migrate:down\nDROP TABLE t;\n` }] }, { DatabaseSync }).declarations[0]
  eq(dbmate.entities.map((e) => e.name), ['t'], "a file's down section is never replayed")
}

// ── 7 · the Data tab ──
console.log('\n7 · the Data tab: the ERD layout, and a page from a hand-built index')
{
  const { layoutErd } = await import('../lib/data/layout.mjs')
  // tables in the page's packed shape (render.mjs dataData)
  const T = (name, cols, rels = []) => ({ name, kind: 'table', cf: [], keys: [], indexes: [], rels: rels.map(([col, to]) => ({ columns: [col], to, toColumns: ['id'], cf: [] })),
    fields: cols.map((c) => ({ name: c, type: c === 'id' ? 'integer' : 'text', nullable: false, pk: c === 'id' ? 1 : 0, fk: rels.some(([col]) => col === c) ? 1 : 0, cf: [] })) })
  const shop = [T('authors', ['id', 'name']), T('books', ['id', 'author_id', 'title'], [['author_id', 'authors']]), T('shelf_books', ['shelf_id', 'book_id'], [['shelf_id', 'shelves'], ['book_id', 'books']]), T('shelves', ['id', 'label']), T('streaks', ['day', 'pages'])]
  const L = layoutErd(shop)
  const box = Object.fromEntries(shop.map((t, i) => [t.name, L.boxes[i]]))
  const mid = (b) => b.x + b.w / 2
  ok(box.authors.x + box.authors.w < box.books.x && mid(box.books) === mid(box.shelves) && box.books.x + box.books.w < box.shelf_books.x && box.shelves.x + box.shelves.w < box.shelf_books.x,
    `a table sits left of the tables referencing it, and one only referenced (shelves) moves next to its referrer (${JSON.stringify(box)})`)
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  ok(L.boxes.every((a, i) => L.boxes.every((b, j) => i === j || !overlap(a, b))) && L.boxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= L.W && b.y + b.h <= L.H), 'no two tables overlap, and all of them fit the drawing')
  const ends = L.links.map((l) => { const [, x1, y1, x2, y2] = /^M([\d.]+),([\d.]+) C.* ([\d.]+),([\d.]+)$/.exec(l.d).map(Number); const A = L.boxes[l.from], B = L.boxes[l.to]; return `${shop[l.from].name}.${shop[l.from].rels[l.k].columns[0]}>${shop[l.to].name} ${x1 === A.x && y1 > A.y + 30 && y1 < A.y + A.h ? 'from its row' : 'off'} ${x2 === B.x + B.w && y2 > B.y + 30 && y2 < B.y + B.h ? 'to the id row' : 'off'}` })
  eq(ends, ['books.author_id>authors from its row to the id row', 'shelf_books.shelf_id>shelves from its row to the id row', 'shelf_books.book_id>books from its row to the id row'],
    'a foreign key line runs from the referencing column, on its table\'s left edge, to the referenced column on the right edge of its table')
  const again = layoutErd(shop), rev = layoutErd(shop.slice().reverse())
  ok(JSON.stringify(again) === JSON.stringify(L) && shop.every((t, i) => JSON.stringify(rev.boxes[shop.length - 1 - i]) === JSON.stringify(L.boxes[i])),
    'deterministic: the same tables give the same coordinates, in whatever order they come')

  // a hand-built index: one store whose snapshot and migration disagree on a column's type, a
  // Postgres folder found but not read, a store of 200 tables, a snapshot that failed to parse
  const { openStore } = await import('../lib/store.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const DIR = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-datapage-')))
  try {
    const dbPath = path.join(DIR, 'graph.db')
    const db = await openStore(dbPath)
    db.prepare('INSERT INTO repos(name, root, head, indexed_at) VALUES (?, ?, ?, ?)').run('app', 'app', '', '')
    db.prepare("INSERT INTO files(id, repo, path, lang, size, is_test, node_id) VALUES (7, 'app', 'db/0001_init.sql', 'sql', 400, 0, 70)").run()
    db.prepare("INSERT INTO nodes(id, file_id, kind, name, line, is_test) VALUES (70, 7, 'file', 'db/0001_init.sql', 1, 0)").run()
    const fact = (key, extractor, facts, error = null) => db.prepare('INSERT INTO data_facts(repo, scope, key, extractor, sig, facts, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run('app', 'unit', key, extractor, 'sig', facts ? JSON.stringify(facts) : null, error)
    const decl = (store, source, extra) => ({ store, dialect: 'sqlite', dialectFrom: { how: 'override' }, source, complete: true, partial: false, status: 'read', notes: [], ...extra })
    const INIT = `CREATE TABLE authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  bio TEXT
);
CREATE TABLE books (
  id TEXT PRIMARY KEY NOT NULL,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL,
  UNIQUE (title, author_id)
);
CREATE INDEX books_author_idx ON books (author_id);
`
    const replayed = replay([{ path: 'db/0001_init.sql', text: INIT }], DatabaseSync)
    fact('db', 'sql-migrations@1', { declarations: [decl('db', { path: 'db/0001_init.sql', line: 1, kind: 'migration', confidence: 'exact' }, { label: 'replayed 1 file, 3 statements', files: 1, implicitIndexes: replayed.implicit, entities: replayed.entities })] })
    let line = 100
    const SNAP = 'db/meta/0001_snapshot.json'
    const cite = (x) => ({ ...x, path: SNAP, line: line++ })
    const snapshot = replayed.entities.map((e) => ({ ...cite(e), fields: e.fields.map((f) => cite(e.name === 'books' && f.name === 'title' ? { ...f, type: 'text' } : f)), keys: e.keys.map(cite), indexes: e.indexes.map(cite), relations: e.relations.map(cite) }))
    fact(SNAP, 'drizzle-snapshot@1', { declarations: [decl('db', { path: SNAP, line: 1, kind: 'artifact', confidence: 'declared' }, { label: 'snapshot', entities: snapshot })] })
    fact('db/pg', 'sql-migrations@1', { declarations: [{ ...decl('db/pg', { path: 'db/pg/0001_a.sql', line: 1, kind: 'migration', confidence: 'exact' }, { status: 'not-read', complete: false, label: 'no reader for postgres migrations yet', files: 2, entities: [] }), dialect: 'postgres', dialectFrom: { how: 'supabase' } }] })
    const name = (i) => `t${String(i).padStart(3, '0')}`
    const wide = Array.from({ length: 200 }, (_, i) => {
      const cols = ['id', 'name', 'parent_id', 'created_at', ...(i % 50 ? [] : ['audit_note'])]
      return { name: name(i), kind: 'table', line: i + 1,
        fields: cols.map((c) => ({ name: c, type: c === 'name' || c === 'audit_note' ? 'text' : 'integer', nullable: c === 'parent_id' || c === 'audit_note', default: null, generated: null, line: i + 1 })),
        keys: [{ role: 'primary', parts: ['id'], line: i + 1 }], indexes: [{ name: `${name(i)}_name_idx`, unique: false, columns: ['name'], partial: false, line: i + 1 }],
        relations: i < 190 && i % 5 ? [{ columns: ['parent_id'], to: name(i - (i % 5)), toColumns: ['id'], onDelete: 'no action', onUpdate: 'no action', line: i + 1 }] : [] }
    })
    fact('warehouse', 'sql-migrations@1', { declarations: [decl('warehouse', { path: 'warehouse/0001_all.sql', line: 1, kind: 'migration', confidence: 'exact' }, { label: 'replayed 1 file, 400 statements', files: 1, entities: wide })] })
    fact('db/meta/0002_snapshot.json', 'drizzle-snapshot@1', null, 'Unexpected end of JSON input')
    db.close()

    const t0 = Date.now()
    const page = await renderGraph({ dbPath })
    const D = dataOf(page)
    eq(D.data.stores.map((s) => `${s.id} ${s.dialect} ${s.tables.length}${s.collapsed ? ' collapsed' : ''} · ${s.summary}`), [
      'app:db sqlite 2 · 2 tables · 1 foreign key · 1 index (+2 implicit, for keys) · 1 conflict',
      'app:warehouse sqlite 200 collapsed · 200 tables · 152 foreign keys · 200 indexes · no conflicts',
    ], 'one ERD per SQL store that has tables, in graph_data\'s order, with its counts; a store of more than 60 tables starts collapsed')
    const pg = await stubPage(page, '#data-0')
    eq(pg.find((n) => n.tagName === 'NAV').kids.map((b) => b.attrs['data-ctl']), ['tab-overview', 'tab-architecture', 'tab-data', 'tab-map', 'tab-files', 'tab-symbols', 'tab-hotspots', 'tab-docs'], 'the Data tab sits after Architecture')
    const svg = pg.erd().html
    eq([pg.hash(), tablesIn(svg), fksIn(svg)], ['#data-0', { authors: ['id', 'name', 'bio'], books: ['id', 'author_id', 'title'] }, ['books (author_id) → authors (id)']], '#data-0 opens the first store: its tables, their columns in order, its foreign key line')
    ok(/class="row" data-col="id"><title>id INTEGER · not null · primary key<\/title>/.test(svg) && /data-col="bio"><title>bio TEXT · nullable<\/title>/.test(svg) && /data-col="author_id"><title>author_id INTEGER · not null · foreign key → authors \(id\)<\/title>/.test(svg)
      && />PK<\/text>/.test(svg) && />FK<\/text>/.test(svg) && /<text class="xrow"[^>]*>unique \(title, author_id\)<\/text>/.test(svg) && /<text class="xrow"[^>]*>index books_author_idx \(author_id\)<\/text>/.test(svg),
    'each column with its type, nullability and keys (PK, FK); unique keys and declared indexes listed under the columns')
    const titleLine = snapshot[1].fields.find((f) => f.name === 'title').line
    ok(svg.includes(`<text class="cft" x="`) && new RegExp(`>text ≠ varchar\\(80\\)</text><title>type: text — app/db/meta/0001_snapshot\\.json:${titleLine} \\[artifact\\] \\| varchar\\(80\\) — app/db/0001_init\\.sql:9 \\[migration\\]</title>`).test(svg),
      'a conflict is badged on its column, the badge naming both values and the tooltip both sources')
    const text = pg.text()
    ok(text.includes('app:db/pg') && text.includes('no reader for postgres migrations yet') && text.includes('2 files') && text.includes('Found, not read (1)'), 'a folder found but not read is listed under the store picker, with its reason')
    ok(pg.lines('LI').includes('drizzle-snapshot@1 on app/db/meta/0002_snapshot.json: Unexpected end of JSON input'), 'an extractor failure is listed too: the map never pretends to be complete')
    pg.click(D.data.stores[0].tables.findIndex((t) => t.name === 'books'))
    const link = pg.find((n) => n.tagName === 'A' && n.attrs.href === '#file-7' && n.kids[0] === 'app/db/0001_init.sql:6')
    const plain = pg.find((n) => n.tagName === 'CODE' && n.kids[0] === `app/db/meta/0001_snapshot.json:${snapshot[1].line}`)
    ok(!!link && !!plain && /class="tbl sel"[^>]*aria-label="books,/.test(pg.erd().html) && /class="tbl on"[^>]*aria-label="authors,/.test(pg.erd().html),
      'focusing a table highlights it and its foreign key neighbours; its passport links each source to the indexed file (#file-<id>), and cites one not in the index as plain path:line')
    ok(pg.text().includes('Columns (3)') && pg.text().includes('Conflicts (1)'), 'the passport lists every column with its sources, and the conflicts')
    pg.go('#data-1')
    const big = pg.erd().html, drawn = tablesIn(big)
    ok(/class="erd collapsed/.test(big) && Object.keys(drawn).length === 200 && Object.values(drawn).every((c) => c.length === 0) && pg.text().includes('200 tables, drawn as names'), '#data-1: 200 tables start collapsed, names only')
    pg.search('audit')
    const hits = tablesIn(pg.erd().html)
    eq(hits, Object.fromEntries(['t000', 't050', 't100', 't150'].map((t) => [t, ['id', 'name', 'parent_id', 'created_at', 'audit_note']])), 'a search names tables or columns: the matching tables drawn with their columns')
    ok(/class="row hit" data-col="audit_note"/.test(pg.erd().html), '… the matching column marked')
    const ms = Date.now() - t0
    ok(ms < 1500, `a 200-table store renders, opens and answers a search within the page's render-time bound (${ms} ms)`)
    pg.search('')
    pg.click(137)
    eq([Object.keys(tablesIn(pg.erd().html)).sort(), fksIn(pg.erd().html)], [['t135', 't137'], ['t137 (parent_id) → t135 (id)']], 'focusing a table of a collapsed store draws it with its foreign key neighbours, columns and all')
    const D2 = dataOf(await renderGraph({ dbPath }))
    ok(JSON.stringify(D2.data.stores.map((s) => s.layout)) === JSON.stringify(D.data.stores.map((s) => s.layout)), 'the layout is computed once, in Node: the same model renders the same coordinates')
    const script = scriptOf(page)
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page)[1]
    eq(csp, `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'; img-src 'none'; base-uri 'none'; form-action 'none'`, 'the CSP is unchanged: the page\'s own script by its hash, nothing else')
    ok(!/<!--|<script/i.test(script) && !/https?:\/\//.test(page) && ['dataClient', 'layoutErd', 'erdBox'].every((f) => script.includes(`function ${f}(`)), 'the page script carries the Data tab and its layout, opens no HTML comment or script element, and names no URL')
  } catch (e) { ok(false, `the Data tab renders (${e.stack})`) } finally { rmSync(DIR, { recursive: true, force: true }) }
}

// ════ Part 2 · through call(), on an indexed project ════
const { findDeps } = await import('../lib/deps.mjs')
if (findDeps()) await indexed()
else if (process.env.CI) { FAIL++; console.log('\n   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)') }
else console.log('\n   - part 2 skipped: parser runtime not installed (npm ci --prefix tools/graph)')

async function indexed() {
  const { call } = await import('../lib/commands.mjs')
  const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-data-')))
  const PROJ = path.join(SANDBOX, 'data')
  cpSync(path.join(HERE, 'fixtures', 'data'), PROJ, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') }) // never a stray local index
  const q = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: PROJ })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
  let tick = 0
  const edit = (rel, fn) => { const f = path.join(PROJ, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); const t = new Date(Date.now() + ++tick * 2000); utimesSync(f, t, t) }
  const cli = (...a) => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), ...a, '--root', PROJ], { encoding: 'utf8' }).stdout
  try {
    // ── 8 · the stores ──
    console.log('\n8 · a project of four repositories (fixtures/data)')
    const idx = await q('index')
    ok(/mobile: 7 files/.test(idx) && !idx.includes('failure'), 'index: every repository, no extractor failure')
    const list = await q('data')
    eq(list.split('\n').filter((l) => /^\w+:/.test(l)), [
      'api:prisma/migrations  sqlite  3 tables · 1 foreign key · 2 indexes · no conflicts',
      'kiosk:storage/schema-changes  sqlite  2 tables · 1 view · 0 foreign keys · 0 indexes (+1 implicit, for keys) · no conflicts',
      'mobile:drizzle  sqlite  5 tables · 3 foreign keys · 2 indexes (+4 implicit, for keys) · no conflicts',
      'web:db/changes  dialect unknown  found, not read (2 files)',
      'web:db/legacy  sqlite  2 tables · 1 foreign key · 0 indexes (+2 implicit, for keys) · no conflicts',
      'web:supabase/migrations  postgres  found, not read (1 file)',
    ], 'graph_data: a store per migration folder, found by its DDL whatever its name; the Drizzle replay and snapshot agree')
    has(list, 'mobile:drizzle  sqlite  5 tables · 3 foreign keys · 2 indexes (+4 implicit, for keys) · no conflicts\n  artifact  drizzle-snapshot@1  snapshot  mobile/drizzle/meta/0005_snapshot.json\n  migration  sql-migrations@1  replayed 6 files, 16 statements  mobile/drizzle/0000_init.sql', "Drizzle: the newest snapshot (0005) and the replay in the journal's order, its DROP-only migration included, are two declarations of one store")
    has(list, '  migration  sql-migrations@1  replayed 3 files, 6 statements  api/prisma/migrations/20240105090000_init/migration.sql\n  dialect: stated at api/prisma/migrations/migration_lock.toml:3', 'Prisma: one migration per versioned subfolder, the dialect from its lock file')
    has(list, '  migration  sql-migrations@1  replayed 3 files, 5 statements  kiosk/storage/schema-changes/0001_visits.up.sql\n  dialect: sniffed: AUTOINCREMENT at kiosk/storage/schema-changes/0001_visits.up.sql:2', 'no tool named: the dialect sniffed; the down migrations and the seed left out, the migration holding only a DROP and a view kept')
    has(list, 'web:db/changes  dialect unknown  found, not read (2 files)\n  migration  sql-migrations@1  not read: dialect unknown (no config states it, and no dialect marker in the SQL)  web/db/changes/0001_events.sql', 'no dialect stated or seen: found, never replayed as SQLite by assumption')
    has(list, 'web:db/legacy  sqlite  2 tables · 1 foreign key · 0 indexes (+2 implicit, for keys) · no conflicts\n  migration  sql-migrations@1  replayed 2 files, 2 statements  web/db/legacy/0001_accounts.sql\n  dialect: set in grimoire.config.json (graph.data.migrations)', 'the same kind of SQL is read once grimoire.config.json states its dialect')
    has(list, '  migration  sql-migrations@1  not read: no reader for postgres migrations yet  web/supabase/migrations/20240110120000_profiles.sql\n  dialect: Supabase migrations are Postgres', 'Postgres: found, not yet read')
    eq(await q('data', { entity: 'books' }), [
      'mobile:drizzle/books  table  (sqlite)',
      '  declared at mobile/drizzle/meta/0005_snapshot.json:39 [artifact drizzle-snapshot@1] · mobile/drizzle/0002_book_isbn.sql:1 [migration sql-migrations@1]',
      'Fields (5):',
      '  id  text  not null  — mobile/drizzle/meta/0005_snapshot.json:42 · mobile/drizzle/0000_init.sql:8',
      '  title  text  not null  — mobile/drizzle/meta/0005_snapshot.json:49 · mobile/drizzle/0000_init.sql:9',
      '  author_id  integer  not null  — mobile/drizzle/meta/0005_snapshot.json:56 · mobile/drizzle/0000_init.sql:10',
      '  published_at  integer  null  — mobile/drizzle/meta/0005_snapshot.json:63 · mobile/drizzle/0000_init.sql:11',
      '  isbn  text  null  — mobile/drizzle/meta/0005_snapshot.json:70 · mobile/drizzle/0002_book_isbn.sql:1',
      'Keys (1):',
      '  primary (id)  — mobile/drizzle/meta/0005_snapshot.json:42 · mobile/drizzle/0000_init.sql:8',
      'Indexes (2):',
      '  books_isbn_unique unique (isbn)  — mobile/drizzle/meta/0005_snapshot.json:79 · mobile/drizzle/0002_book_isbn.sql:2',
      '  books_author_idx (author_id)  — mobile/drizzle/meta/0005_snapshot.json:86 · mobile/drizzle/0000_init.sql:15',
      'Foreign keys (1):',
      '  (author_id) → authors(id)  on delete cascade · on update no action  — mobile/drizzle/meta/0005_snapshot.json:95 · mobile/drizzle/0000_init.sql:12',
      'Conflicts: none',
    ].join('\n'), 'graph_data entity: every field, key, index and foreign key with both its sources, file:line')
    eq(await q('data', { store: 'mobile:drizzle' }), [
      'mobile:drizzle  sqlite  5 tables · 3 foreign keys · 2 indexes (+4 implicit, for keys) · no conflicts',
      '  authors  table  3 fields · primary (id)  mobile/drizzle/meta/0005_snapshot.json:7 · mobile/drizzle/0003_author_bio_required.sql:10',
      '  books  table  5 fields · primary (id) · 2 indexes · foreign keys → authors  mobile/drizzle/meta/0005_snapshot.json:39 · mobile/drizzle/0002_book_isbn.sql:1',
      '  shelf_books  table  3 fields · primary (shelf_id, book_id) · foreign keys → shelves, books  mobile/drizzle/meta/0005_snapshot.json:113 · mobile/drizzle/0001_shelves.sql:6',
      '  shelves  table  2 fields · primary (id)  mobile/drizzle/meta/0005_snapshot.json:180 · mobile/drizzle/0001_shelves.sql:1',
      '  streaks  table  3 fields · primary (day)  mobile/drizzle/meta/0005_snapshot.json:205 · mobile/drizzle/0004_streaks.sql:6',
    ].join('\n'), 'graph_data store: each table cites its snapshot entry and the migration line that created or last altered it (authors: rebuilt and renamed in 0003)')
    has(await q('data', { entity: 'shelf_books' }), 'Keys (1):\n  primary (shelf_id, book_id)  — mobile/drizzle/meta/0005_snapshot.json:169 · mobile/drizzle/0001_shelves.sql:10', 'a composite primary key: one key, both sources, no conflict')
    const streaks = await q('data', { entity: 'streaks' })
    ok(streaks.includes('  logged_at  integer  not null  default (unixepoch())  — mobile/drizzle/meta/0005_snapshot.json:223 · mobile/drizzle/0004_streaks.sql:9') && streaks.endsWith('Conflicts: none'), `Drizzle's timestamp idiom, DEFAULT (unixepoch()): replay and snapshot agree, the default shown as written${streaks.endsWith('Conflicts: none') ? '' : `\n${streaks}`}`)

    // ── 9 · the Data tab ──
    console.log('\n9 · the Data tab of that project')
    const { renderGraph } = await import('../lib/render.mjs')
    const { loadProject } = await import('../lib/project.mjs')
    const page = await renderGraph(loadProject(PROJ))
    const D = dataOf(page)
    eq(D.data.stores.map((s) => `${s.id}  ${s.dialect}  ${s.summary}`), list.split('\n').filter((l) => /^\w+:/.test(l) && !l.includes('found, not read')),
      'an ERD per SQL store read, in graph_data\'s order and with its counts')
    eq(D.data.unread.map((u) => `${u.store}  ${u.dialect || 'dialect unknown'}  ${u.reason}  ${u.at}`), [
      'web:db/changes  dialect unknown  dialect unknown (no config states it, and no dialect marker in the SQL)  web/db/changes/0001_events.sql',
      'web:supabase/migrations  postgres  no reader for postgres migrations yet  web/supabase/migrations/20240110120000_profiles.sql',
    ], 'the folders found but not read, each with its reason')
    const pg = await stubPage(page, '#data-0')
    ok(pg.hash() === '#data-0' && Object.keys(tablesIn(pg.erd().html)).join(' ') === 'Loan Member Tag', `#data-0 opens the first store (${Object.keys(tablesIn(pg.erd().html))})`)
    ok(pg.text().includes('Found, not read (2)') && pg.text().includes('no reader for postgres migrations yet'), '… with the folders found but not read under the store picker')
    pg.go('#data-2')
    const svg = pg.erd().html
    eq([tablesIn(svg), fksIn(svg)], [
      { authors: ['id', 'name', 'bio'], books: ['id', 'title', 'author_id', 'published_at', 'isbn'], shelf_books: ['shelf_id', 'book_id', 'position'], shelves: ['id', 'label'], streaks: ['day', 'pages', 'logged_at'] },
      ['books (author_id) → authors (id)', 'shelf_books (book_id) → books (id)', 'shelf_books (shelf_id) → shelves (id)'],
    ], "#data-2: the Drizzle store's tables, columns and foreign key lines, exactly")
    pg.click(D.data.stores[2].tables.findIndex((t) => t.name === 'books'))
    const init = D.files.find((f) => f[1] === 'mobile' && f[2] === 'drizzle/0000_init.sql')[0]
    ok(!!pg.find((n) => n.tagName === 'A' && n.attrs.href === `#file-${init}` && n.kids[0] === 'mobile/drizzle/0000_init.sql:8') && !!pg.find((n) => n.tagName === 'CODE' && n.kids[0] === 'mobile/drizzle/meta/0005_snapshot.json:42'),
      "a column's sources: the migration line links to its file in the Files tab, the snapshot (not an indexed file) is cited as path:line")

    // ── 10 · incremental ──
    console.log('\n10 · incremental refresh')
    edit('mobile/drizzle/0000_init.sql', (t) => t.replace('`published_at` integer,', '`published_at` text,'))
    await q('index')
    has(await q('data', { entity: 'books' }), 'Conflicts (1): the declarations disagree; each side is kept\n  books.published_at  type: integer — mobile/drizzle/meta/0005_snapshot.json:63 [artifact] | text — mobile/drizzle/0000_init.sql:11 [migration]', 'a hand-edited migration disagreeing with the snapshot: a conflict carrying both sources')
    const badged = (await stubPage(await renderGraph(loadProject(PROJ)), '#data-2')).erd().html
    ok(badged.includes('>integer ≠ text</text><title>type: integer — mobile/drizzle/meta/0005_snapshot.json:63 [artifact] | text — mobile/drizzle/0000_init.sql:11 [migration]</title>'), '… badged in the Data tab on its column, with both values and both sources')
    edit('mobile/drizzle/0002_book_isbn.sql', (t) => t.replace('ALTER TABLE `books`', 'ALTER TABLE `bookz`'))
    await q('index')
    has(await q('data'), 'mobile:drizzle  sqlite  5 tables · 3 foreign keys · 2 indexes (+3 implicit, for keys) · no conflicts\n  artifact  drizzle-snapshot@1  snapshot  mobile/drizzle/meta/0005_snapshot.json\n  migration  sql-migrations@1  replayed to mobile/drizzle/0002_book_isbn.sql:1: no such table: bookz  mobile/drizzle/0000_init.sql', 'a rejected statement stops the replay there: labelled, with the error')
    has(await q('data', { entity: 'books' }), '  published_at  integer  null  — mobile/drizzle/meta/0005_snapshot.json:63 · mobile/drizzle/0000_init.sql:11\n  isbn  text  null  — mobile/drizzle/meta/0005_snapshot.json:70\n', 'the facts replayed so far are kept (and compared with nothing: they describe the store partway)')
    has(await q('status'), 'data: 1 store(s) (graph_data), 1 replay(s) stopped early', 'graph_status counts the replays that stopped')
    edit('mobile/drizzle/0000_init.sql', (t) => t.replace('`published_at` text,', '`published_at` integer,'))
    edit('mobile/drizzle/0002_book_isbn.sql', (t) => t.replace('ALTER TABLE `bookz`', 'ALTER TABLE `books`'))
    rmSync(path.join(PROJ, 'api/prisma/migrations/20240301080000_tags'), { recursive: true })
    await q('index')
    has(await q('data'), 'mobile:drizzle  sqlite  5 tables · 3 foreign keys · 2 indexes (+4 implicit, for keys) · no conflicts', 'restored migrations replay in full again')
    has(await q('data', { store: 'api:prisma/migrations' }), 'api:prisma/migrations  sqlite  2 tables · 1 foreign key · 1 index · no conflicts', 'a deleted migration re-runs its folder')
    has(await q('data', { entity: 'Tag' }), 'No entity "Tag"', '… and what it created is gone')

    edit('mobile/drizzle/meta/0005_snapshot.json', (t) => t.slice(0, 200)) // read by the data model only: the query notices it
    has(await q('status'), 'data: 1 store(s) (graph_data); 1 extractor failure(s): drizzle-snapshot@1 on mobile/drizzle/meta/0005_snapshot.json: ', 'a snapshot that no longer parses: graph_status reports the extractor failure (after refreshing on its own)')
    const after = await q('data')
    has(after, 'mobile:drizzle  sqlite  5 tables · 3 foreign keys · 2 indexes (+4 implicit, for keys) · no conflicts\n  migration  sql-migrations@1  replayed 6 files, 16 statements  mobile/drizzle/0000_init.sql', '… its facts are lost, the replay still answers')
    has(after, 'Extractor failures (1), their facts are missing:\n  drizzle-snapshot@1 on mobile/drizzle/meta/0005_snapshot.json: ', '… and graph_data names the failure')

    has(cli('data', 'list'), 'kiosk:storage/schema-changes  sqlite  2 tables · 1 view · 0 foreign keys · 0 indexes (+1 implicit, for keys) · no conflicts', 'graph.mjs data list')
    has(cli('data', 'list', 'web:db/legacy'), '  sessions  table  3 fields · primary (id) · foreign keys → accounts  web/db/legacy/0002_sessions.sql:1', 'graph.mjs data list <store>')
    has(cli('data', 'show', 'Loan'), 'api:prisma/migrations/Loan  table  (sqlite)\n  declared at api/prisma/migrations/20240212143000_loan_notes/migration.sql:3 [migration sql-migrations@1]', 'graph.mjs data show <entity>')
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
