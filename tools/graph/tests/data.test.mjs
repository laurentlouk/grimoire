// ════════════════════════════════════════════════════════════════════════════
//  Tests — the data model map (tools/graph/lib/data)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/data.test.mjs
//
//  Part 1 needs no parser runtime: the readers and the model, run directly on strings (and git, for
//  the model at a ref).
//   1. splitting SQL into statements (Drizzle breakpoints, `;` outside quotes and comments, triggers)
//   2. sniffing a dialect from the SQL itself
//   3. replaying SQLite migrations into node:sqlite, each element mapped to the file:line behind it
//   4. reading Drizzle snapshots: the legacy `meta/NNNN_snapshot.json` (`tables{}`) and v1's `ddl[]`
//   5. reconciling the declarations of one store: merged sources, conflicts kept with both sides
//   6. finding migration folders by content, whatever tool wrote them, and ordering them
//   7. diffing two models (diff.mjs): added, removed, modified per element kind, rename candidates
//      (ambiguous ones listed, never guessed), formatting that is no change, stores added and removed
//   8. the model at a git ref (data/base.mjs): which base, a ref that does not resolve, the merge
//      base, the same model from git and from disk
//   9. the Data tab: the ERD layout (data/layout.mjs), then a page rendered from a hand-built index
//      and its own script run in a stub DOM (as graph.test.mjs §5 and arch-docs.test.mjs §5 do):
//      anchors, tables, columns, foreign key lines, a conflict badge, source links, the folders
//      found but not read, a 200-table store collapsed and searchable, the CSP; then the change
//      overlay against a git base: off by default, added / removed / modified / renamed, its legend,
//      absent without a base, escaping
//
//  Part 2 indexes a fixture project (fixtures/data) and asserts through the same `call()` the MCP
//  server and the CLI use. It needs the parser runtime (the fixture has TypeScript files): skipped
//  without it, except under CI, where a missing runtime fails.
//  10. four repositories: Drizzle with its snapshots, Prisma, a folder no tool named, Supabase, an
//      undeclared dialect and one stated in grimoire.config.json → graph_data and graph.mjs data
//  11. the Data tab of that project: its stores, ERD and links to the indexed migration files
//  12. incremental: a hand-edited migration (a conflict, badged in the Data tab), a rejected
//      statement, a deleted migration, a snapshot that no longer parses (reported by graph_status,
//      the index goes on)
//  13. a branch against its base (two commits): a column added, an index dropped, a table renamed →
//      graph_changes and graph.mjs changes; a ref that does not resolve; a base without the folder
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, realpathSync, utimesSync, readdirSync, mkdirSync, statSync, existsSync } from 'node:fs'
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
async function stubPage(page, hash, globals = {}) {
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
    focus(o) { this.focusedWith = o || {} } setSelectionRange() {}
    get offsetHeight() { return 0 }
  }
  const { ctlQuery } = await import('./stage-kit.mjs')
  const doc = { createElement: (t) => new El(t), getElementById: (id) => (id === 'graph-data' ? { textContent: blob } : null), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null }
  doc.querySelector = ctlQuery(() => ({ kids: doc.body.kids || [] }))
  const loc = { hash }
  vm.runInNewContext(scriptOf(page), { document: doc, window: { addEventListener: (t, f) => { const prev = listeners[t]; listeners[t] = prev ? (e) => { prev(e); f(e) } : f }, innerWidth: 1400, scrollTo() {} }, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), ...globals })
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
    pressed: (c) => Promise.all((pg.ctl(c).on.click || []).map((f) => f({}))), // and wait for what it started (a save)
    ctls: (re) => pg.all((n) => n.attrs && re.test(n.attrs['data-ctl'] || '')).map((n) => n.attrs['data-ctl']),
    search: (q) => pg.ctl('search').on.input[0]({ target: { value: q } }),
    erd: () => find(body(), (n) => n.attrs && n.attrs.id === 'data-box'), // the drawing: its svg markup is .html
    click: (i) => pg.erd().firstChild.on.click[0]({ target: { closest: (sel) => (/data-tbl/.test(sel) ? { dataset: { tbl: String(i) } } : null) } }),
    win: (t, e) => listeners[t] && listeners[t](e), // the window's own listeners
    active: (el) => { doc.activeElement = el }, // the element the document says has the focus
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

// ── 7 · the model diff ──
console.log('\n7 · diffing two models (diff.mjs)')
const { diffModels } = await import('../lib/data/diff.mjs')
// a store's model from SQL, as the index reconciles it
const modelOf = (text, { store = 'db', dialect = 'sqlite', path: p = `${store}/0001_init.sql` } = {}) => reconcile([{ repo: 'app', extractor: 'sql-migrations@1', facts: { declarations: [{ store, dialect, source: { path: p, line: 1, kind: 'migration', confidence: 'exact' }, complete: true, partial: false, status: 'read', notes: [], entities: replay([{ path: p, text }], DatabaseSync).entities }] } }])
// one line per change: + added, - removed, ~ modified (before → after), then the rename candidates
const changeLines = (d) => d.stores.flatMap((s) => [`${s.id} ${s.change}`,
  ...s.changes.map((c) => `  ${{ added: '+', removed: '-', modified: '~' }[c.change]} ${c.kind} ${c.kind === 'entity' ? c.name : `${c.entity} ${c.name}`}${c.attrs.length ? `  ${c.attrs.map((a) => `${a.attr}: ${a.before} → ${a.after}`).join('; ')}` : ''}`),
  ...s.renames.map((r) => `  rename? ${r.kind}${r.entity ? ` in ${r.entity}` : ''} ${r.from.map((i) => s.changes[i].name).join(', ')} → ${r.to.map((i) => s.changes[i].name).join(', ')} (${r.shape}${r.ambiguous ? ', ambiguous' : ''})`)])
{
  const BASE = `CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT);
CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT 'untitled', isbn TEXT, UNIQUE (isbn));
CREATE INDEX books_title_idx ON books (title);
CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, body TEXT);`
  const BRANCH = `CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', email TEXT);
CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE SET NULL, title TEXT NOT NULL DEFAULT 'draft', isbn TEXT, UNIQUE (isbn, title));
CREATE INDEX books_author_idx ON books (author_id);
CREATE TABLE loans (id INTEGER PRIMARY KEY, book_id INTEGER REFERENCES books(id));
CREATE VIEW recent AS SELECT id FROM books;`
  const d = diffModels(modelOf(BASE), modelOf(BRANCH))
  eq(changeLines(d), [
    'app:db modified',
    "  ~ field authors bio  nullable: true → false; default: null → ''",
    '  + field authors email',
    "  ~ field books title  default: 'untitled' → 'draft'",
    '  + key books unique (isbn, title)',
    '  - key books unique (isbn)',
    '  + index books books_author_idx',
    '  - index books books_title_idx',
    '  ~ relation books (author_id) → authors (id)  onDelete: cascade → set null',
    '  - entity legacy_notes',
    '  + entity loans',
    '  + entity recent',
  ], 'added, removed and modified, per element kind: a column, a key (by its columns, as a whole), an index, a foreign key, a table, a view; modified ones with before → after')
  eq(d.counts, { stores: 1, added: 5, removed: 3, modified: 3, renames: 0 }, '… counted; an added table counts once, not per column, and nothing is a rename when no shapes match')
  const dropped = d.stores[0].changes.find((c) => c.name === 'legacy_notes'), email = d.stores[0].changes.find((c) => c.name === 'email')
  eq([dropped.before.sources.map((s) => `${s.path}:${s.line}`), dropped.after, email.after.sources.map((s) => `${s.path}:${s.line}`), email.before], [['db/0001_init.sql:4'], null, ['db/0001_init.sql:1'], null], 'each side keeps its element, with its sources (path:line) on that side')
  eq(changeLines(diffModels(modelOf(BASE), modelOf(BASE))), [], 'a model against itself: no change')

  const TAGS = `CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE posts (id INTEGER PRIMARY KEY, tag_id INTEGER REFERENCES tags(id), body TEXT, due TEXT);
CREATE INDEX posts_body_idx ON posts (body);`
  const RENAMED = `CREATE TABLE labels (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE posts (id INTEGER PRIMARY KEY, tag_id INTEGER REFERENCES labels(id), body TEXT, due_on TEXT);
CREATE INDEX posts_body_index ON posts (body);`
  const r = diffModels(modelOf(TAGS), modelOf(RENAMED))
  eq(changeLines(r), [
    'app:db modified',
    '  + entity labels',
    '  + field posts due_on',
    '  - field posts due',
    '  + index posts posts_body_index',
    '  - index posts posts_body_idx',
    '  + relation posts (tag_id) → labels (id)',
    '  - relation posts (tag_id) → tags (id)',
    '  - entity tags',
    '  rename? entity tags → labels (same columns)',
    '  rename? field in posts due → due_on (same type and position)',
    '  rename? index in posts posts_body_idx → posts_body_index (same columns)',
    '  rename? relation in posts (tag_id) → tags (id) → (tag_id) → labels (id) (same columns)',
  ], 'a removed and an added element of the same kind and shape are a rename candidate: flagged, never decided (each stays added and removed)')
  eq(r.counts.renames, 4, '… and counted apart')

  // two declarations of one table, written differently: names in another case, types in capitals,
  // a default with its parentheses (as a snapshot writes it) or without (as SQLite reports it)
  const decl = (dialect, entities) => reconcile([{ repo: 'app', extractor: 'drizzle-snapshot@1', facts: { declarations: [{ store: 'db', dialect, source: { path: 'db/meta/0001_snapshot.json', line: 1, kind: 'artifact', confidence: 'declared' }, complete: true, partial: false, status: 'read', notes: [], entities }] } }])
  const books = (n, c) => [{ name: n('Books'), kind: 'table', line: 2, fields: [{ name: n('ID'), type: c('INTEGER'), nullable: false, default: null, line: 3 }, { name: n('Created'), type: c('integer'), nullable: false, default: n === String ? '(unixepoch())' : 'unixepoch()', line: 4 }, { name: n('Title'), type: c('TEXT'), nullable: true, default: "'x'", line: 5 }],
    keys: [{ role: 'primary', parts: [n('ID')], line: 3 }], indexes: [{ name: n('Books_Title_Idx'), unique: false, columns: [n('Title')], partial: false, line: 6 }], relations: [{ columns: [n('ID')], to: n('Shelves'), toColumns: [n('Book')], onDelete: 'cascade', onUpdate: 'no action', line: 7 }] }]
  const lowerAll = (s) => s.toLowerCase(), spaced = (t) => ` ${t.toLowerCase()}  `
  eq(diffModels(decl('sqlite', books(String, String)), decl('sqlite', books(lowerAll, spaced))).stores, [], 'formatting is no change: names in another case (SQLite), types in another case or spacing, a default with or without its outer parentheses')
  eq(changeLines(diffModels(decl('postgres', books(String, String)), decl('postgres', books(lowerAll, spaced)))).slice(0, 3), ['app:db modified', '  - entity Books', '  + entity books'], 'where the dialect\'s names are case-sensitive, another case is another table')

  const SAME = 'CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT);\nCREATE TABLE b (id INTEGER PRIMARY KEY, v TEXT);'
  const amb = diffModels(modelOf(SAME), modelOf(SAME.replace('TABLE a', 'TABLE c').replace('TABLE b', 'TABLE d')))
  eq(changeLines(amb), ['app:db modified', '  - entity a', '  - entity b', '  + entity c', '  + entity d', '  rename? entity a, b → c, d (same columns, ambiguous)'], 'two removed and two added of one shape: one candidate group naming all four, never a guess at which goes with which')

  eq(changeLines(diffModels({ stores: [] }, modelOf(TAGS))), ['app:db added', '  + entity posts', '  + entity tags'], 'a store absent from the base: the store and each of its tables added')
  eq(changeLines(diffModels(modelOf(TAGS), { stores: [] })), ['app:db removed', '  - entity posts', '  - entity tags'], 'a store absent from the branch: removed')
}

// ── 8 · the model at a git ref ──
console.log('\n8 · the model at a git ref (data/base.mjs): read through git, nothing checked out')
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', m); return git(dir, 'rev-parse', 'HEAD').stdout.trim() }
{
  const { resolveBase, modelAt } = await import('../lib/data/base.mjs')
  const { extractAll } = await import('../lib/data/registry.mjs')
  const { loadProject, listPaths } = await import('../lib/project.mjs')
  const DIR = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-dataref-')))
  const put = (rel, text) => { mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); writeFileSync(path.join(DIR, rel), text) }
  try {
    put('grimoire.config.json', JSON.stringify({ repos: [{ name: 'app', path: '.' }] }))
    put('db/0001_init.sql', "CREATE TABLE authors (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL DEFAULT 'café'\n);\n")
    put('db/notes.txt', 'not a migration\n')
    git(DIR, 'init', '-q', '-b', 'main')
    const first = commit(DIR, 'base')
    git(DIR, 'switch', '-q', '-c', 'feat')
    put('db/0002_books.sql', 'CREATE TABLE books (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  author_id INTEGER REFERENCES authors(id)\n);\n')
    put('kv/0001_kv.sql', 'CREATE TABLE kv (k TEXT PRIMARY KEY, v BLOB);\n')
    const head = commit(DIR, 'branch')
    const project = loadProject(DIR)

    const b = resolveBase(project)
    eq([b.ref, b.from, b.repos.map((r) => [r.name, r.commit, r.at]), b.skipped], ['main', "the index's base branch", [['app', first, first]], []], 'no base named: the branch the index is based on (main), at its merge base with HEAD')
    eq([resolveBase({ ...project, baseBranch: 'main' }).from, resolveBase(project, { explicit: 'HEAD~1' }).repos[0].at], ['baseBranch in grimoire.config.json', first], 'baseBranch from grimoire.config.json comes first; a ref given comes before everything')
    eq(resolveBase(project, { explicit: 'no-such-branch' }), { error: 'the base "no-such-branch" does not resolve to a commit in app (give a branch, a tag or a commit)' }, 'a ref that does not resolve is a clear error')

    const at = await modelAt(project, b)
    eq([at.failed, at.model.stores.map((s) => `${s.id} ${s.entities.map((e) => `${e.name}@${e.sources.map((x) => `${x.path}:${x.line}`).join(',')}`).join(' ')}`)], [[], ['app:db authors@db/0001_init.sql:1']],
      "the base's model: only what that commit held (no kv store, no books), each element citing the base's path:line")
    eq(at.model.stores[0].entities[0].fields.map((f) => f.default), [null, "'café'"], 'blobs are read as bytes and decoded as the index decodes files (UTF-8)')

    // the same extractors on the same text, from either source, give the same model
    const fromTree = reconcile(extractAll({ paths: listPaths(DIR), size: (p) => statSync(path.join(DIR, p)).size, read: (p) => readFileSync(path.join(DIR, p), 'utf8') }, project, [], { DatabaseSync }).filter((r) => r.facts).map((r) => ({ repo: 'app', extractor: r.extractor, facts: r.facts })))
    const fromGit = (await modelAt(project, { repos: [{ name: 'app', abs: DIR, at: head }] })).model
    ok(JSON.stringify(fromGit) === JSON.stringify(fromTree) && fromGit.stores.length === 2, 'HEAD read through git and the working tree read from disk give the same model: one discovery, one set of extractors')

    // main moves on after the branch left it: those commits are not the branch's changes
    git(DIR, 'switch', '-q', 'main')
    put('db/0002_main_only.sql', 'CREATE TABLE audit (id INTEGER PRIMARY KEY);\n')
    commit(DIR, 'main moves on')
    git(DIR, 'switch', '-q', 'feat')
    const moved = resolveBase(project)
    eq([moved.repos[0].commit !== first, moved.repos[0].at, (await modelAt(project, moved)).model.stores[0].entities.map((e) => e.name)], [true, first, ['authors']], 'the base is read at its merge base with HEAD: a table main added since is not shown as one the branch removed')
    ok(!existsSync(path.join(DIR, '.grimoire')), 'nothing is written: no index, no cache on disk')

    const plain = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-nogit-')))
    try { eq(resolveBase({ root: plain, repos: [{ name: 'x', abs: plain }] }).error, 'x is not in a git repository: there is no base to compare against', 'outside git there is no base, and it says so') } finally { rmSync(plain, { recursive: true, force: true }) }
  } finally { rmSync(DIR, { recursive: true, force: true }) }
}

// ── 9 · the Data tab ──
console.log('\n9 · the Data tab: the ERD layout, and a page from a hand-built index')
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
  // the zoom toolbar sits 8 px from the drawing box's top, about 37 px tall, over a 6 px padding
  const TOOLBAR = 8 + 37 + 6
  ok(Math.min(...L.boxes.map((b) => b.y)) > TOOLBAR && Math.min(...layoutErd(shop, { collapsed: true }).boxes.map((b) => b.y)) > TOOLBAR, `no table starts under the zoom toolbar (top-most at y ${Math.min(...L.boxes.map((b) => b.y))})`)

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
    // foreign keys naming their target in another letter case, as SQLite accepts and keeps them
    const MIXED = 'CREATE TABLE authors(id INTEGER PRIMARY KEY); CREATE TABLE books(id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES Authors(id)); CREATE TABLE "Loans"(id INTEGER PRIMARY KEY); CREATE TABLE reviews(id INTEGER PRIMARY KEY, loan_id INTEGER REFERENCES loans(id));\nCREATE TABLE ratings(id INTEGER PRIMARY KEY, book_id INTEGER REFERENCES BOOKS(ID));\n'
    const mixed = replay([{ path: 'x/legacy/0001_init.sql', text: MIXED }], DatabaseSync)
    fact('x/legacy', 'sql-migrations@1', { declarations: [decl('x/legacy', { path: 'x/legacy/0001_init.sql', line: 1, kind: 'migration', confidence: 'exact' }, { label: 'replayed 1 file, 5 statements', files: 1, entities: mixed.entities })] })
    // every name and path a hostile repository could choose, holding markup
    const BAD = '"><img src=x onerror=alert(1)></title><script>x</script><!--', HOSTILE = `y/${BAD}.sql`
    const at1 = (line) => ({ path: HOSTILE, line })
    fact('y/hostile', 'sql-migrations@1', { declarations: [decl('y/hostile', { path: HOSTILE, line: 1, kind: 'migration', confidence: 'exact' }, { label: 'replayed 1 file, 1 statement', files: 1, entities: [{ name: `t${BAD}`, kind: 'table', ...at1(1),
      fields: [{ name: `c${BAD}`, type: `text${BAD}`, nullable: true, default: null, generated: null, ...at1(2) }], keys: [], indexes: [{ name: `i${BAD}`, unique: false, columns: [`c${BAD}`], partial: false, ...at1(3) }],
      relations: [{ columns: [`c${BAD}`], to: `r${BAD}`, toColumns: ['id'], onDelete: 'no action', onUpdate: 'no action', ...at1(4) }] }] })] })
    db.close()

    const t0 = Date.now()
    const page = await renderGraph({ dbPath })
    const D = dataOf(page)
    eq(D.data.stores.map((s) => `${s.id} ${s.dialect} ${s.tables.length}${s.collapsed ? ' collapsed' : ''} · ${s.summary}`), [
      'app:db sqlite 2 · 2 tables · 1 foreign key · 1 index (+2 implicit, for keys) · 1 conflict',
      'app:warehouse sqlite 200 collapsed · 200 tables · 152 foreign keys · 200 indexes · no conflicts',
      'app:x/legacy sqlite 5 · 5 tables · 3 foreign keys · 0 indexes · no conflicts',
      'app:y/hostile sqlite 1 · 1 table · 1 foreign key · 1 index · no conflicts',
    ],'one ERD per SQL store that has tables, in graph_data\'s order, with its counts; a store of more than 60 tables starts collapsed')
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

    // a foreign key naming its table or column in another case is drawn, linked and counted
    pg.go('#data-2')
    const ms2 = D.data.stores[2], mx = pg.erd().html
    eq([/aria-label="app:x\/legacy: 5 tables, 3 foreign key lines"/.test(mx), fksIn(mx)], [true, ['books (author_id) → authors (id)', 'ratings (book_id) → books (id)', 'reviews (loan_id) → Loans (id)']],
      'SQLite resolves table and column names in any case: every foreign key gets its line, to the table as it is named')
    const rowsAt = ms2.layout.links.map((l) => {
      const [, x1, y1, x2, y2] = /^M([\d.]+),([\d.]+) C.* ([\d.]+),([\d.]+)$/.exec(l.d).map(Number), A = ms2.layout.boxes[l.from], B = ms2.layout.boxes[l.to], T = ms2.tables[l.from], r = T.rels[l.k]
      const rowY = (t, b, col) => b.y + 30 + 20 * t.fields.findIndex((f) => f.name === col) + 10
      return `${T.name}.${r.columns[0]} ${x1 === A.x && y1 === rowY(T, A, r.columns[0]) ? 'from its row' : 'off'} ${x2 === B.x + B.w && y2 === rowY(ms2.tables[l.to], B, 'id') ? 'to the id row' : 'off'}`
    })
    eq(rowsAt, ['books.author_id from its row to the id row', 'ratings.book_id from its row to the id row', 'reviews.loan_id from its row to the id row'], '… from the referencing column\'s row to the referenced column\'s row (ID matches id), never the header')
    pg.click(ms2.tables.findIndex((t) => t.name === 'authors'))
    const refd = pg.text().includes('Referenced by (1)') && !!pg.find((n) => n.tagName === 'BUTTON' && n.kids[0] === 'books')
    pg.click(ms2.tables.findIndex((t) => t.name === 'reviews'))
    ok(refd && !!pg.find((n) => n.tagName === 'BUTTON' && n.kids[0] === 'Loans') && /class="tbl on"[^>]*aria-label="Loans,/.test(pg.erd().html),
      '… and the passports agree: authors is referenced by books, reviews links to Loans, which focus lights')

    // markup in any name, type, target or path is text, in the drawing and in the passport
    pg.go('#data-3')
    const escd = BAD.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), hx = pg.erd().html
    ok(!/<img|<script|<!--/i.test(hx) && [`t${escd}`, `c${escd}`, `text${escd}`, `r${escd}`, `app/y/${escd}.sql:3`].every((s) => hx.includes(s)),
      'the ERD escapes a table name, a column name, a type, a foreign key target and a source path holding markup')
    pg.click(0)
    const markup = pg.all((n) => typeof n.html === 'string' && /<img|<script/i.test(n.html)).length + pg.all((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT').length
    ok(markup === 0 && !!pg.find((n) => n.tagName === 'H3' && n.kids.includes(`t${BAD}`)) && !!pg.find((n) => n.tagName === 'CODE' && n.kids[0] === `app/y/${BAD}.sql:2`) && pg.text().includes(`r${BAD}`),
      '… and the passport carries them as text nodes, never as markup')
    const D2 = dataOf(await renderGraph({ dbPath }))
    ok(JSON.stringify(D2.data.stores.map((s) => s.layout)) === JSON.stringify(D.data.stores.map((s) => s.layout)), 'the layout is computed once, in Node: the same model renders the same coordinates')
    const script = scriptOf(page)
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page)[1]
    eq(csp, `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'; img-src 'none'; base-uri 'none'; form-action 'none'`, 'the CSP is unchanged: the page\'s own script by its hash, nothing else')
    ok(!/<!--|<script/i.test(script) && !/https?:\/\//.test(page) && ['dataClient', 'layoutErd', 'erdBox'].every((f) => script.includes(`function ${f}(`)), 'the page script carries the Data tab and its layout, opens no HTML comment or script element, and names no URL')
    const bare = await stubPage(page, '#data-0')
    ok(!bare.ctl('data-changes') && bare.text().includes('No change overlay: no repository to compare.'), 'with no base to compare against, the change overlay\'s toggle is absent and the tab says why')
    // the stage: a drag never selects the page and follows the pointer past the box; the keys pan and zoom
    const { scrollStageCases, inside } = await import('./stage-kit.mjs')
    const names = ['authors', 'books'], at = names.map((t) => String(D.data.stores[0].tables.findIndex((x) => x.name === t)))
    scrollStageCases(ok, {
      name: 'Data', page, active: bare.active, box: () => bare.erd(), zoom0: 1,
      items: at.map((tbl) => inside('[data-tbl]', { tbl })), opened: (i) => !!bare.find((n) => n.tagName === 'H3' && n.kids.includes(names[i])),
      fitted: () => bare.ctl('data-fit').attrs['aria-pressed'] === 'true', search: bare.ctl('search'),
      win: bare.win, full: () => bare.press('data-full'), isFull: () => /\bstage full\b/.test(bare.find((n) => n.attrs && n.attrs['data-stage'] === 'data').attrs.class),
    })
  } catch (e) { ok(false, `the Data tab renders (${e.stack})`) } finally { rmSync(DIR, { recursive: true, force: true }) }
}

// the change overlay: a branch against its base (git), over an index built from the working tree
console.log('\n9 · the Data tab\'s change overlay, against a git base')
{
  const { openStore } = await import('../lib/store.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { extractAll } = await import('../lib/data/registry.mjs')
  const { loadProject, listPaths } = await import('../lib/project.mjs')
  const DIR = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-overlay-')))
  const put = (rel, text) => { mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); writeFileSync(path.join(DIR, rel), text) }
  const BAD = '"><img src=x onerror=alert(1)></title><script>x</script><!--', quoted = (n) => `"${n.replace(/"/g, '""')}"`
  try {
    put('grimoire.config.json', JSON.stringify({ repos: [{ name: 'app', path: '.' }] }))
    put('db/0001_init.sql', ['CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bio TEXT);', 'CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id), title TEXT NOT NULL);',
      'CREATE INDEX books_title_idx ON books (title);', 'CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT NOT NULL);', `CREATE TABLE ${quoted(`h${BAD}`)} (id INTEGER PRIMARY KEY, ${quoted(`c${BAD}`)} TEXT);`, ''].join('\n'))
    git(DIR, 'init', '-q', '-b', 'main')
    commit(DIR, 'base')
    git(DIR, 'switch', '-q', '-c', 'feat')
    put('db/0002_branch.sql', ["CREATE TABLE __new_authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', email TEXT);", "INSERT INTO __new_authors SELECT id, name, coalesce(bio, ''), NULL FROM authors;", 'DROP TABLE authors;', 'ALTER TABLE __new_authors RENAME TO authors;',
      'DROP INDEX books_title_idx;', 'ALTER TABLE books RENAME COLUMN title TO heading;', 'ALTER TABLE tags RENAME TO labels;', `DROP TABLE ${quoted(`h${BAD}`)};`, `CREATE TABLE ${quoted(`n${BAD}`)} (${quoted(`c${BAD}`)} TEXT);`, ''].join('\n'))
    commit(DIR, 'branch')
    const project = loadProject(DIR)
    const db = await openStore(project.dbPath)
    db.prepare('INSERT INTO repos(name, root, head, indexed_at) VALUES (?, ?, ?, ?)').run('app', '.', '', '')
    for (const r of extractAll({ paths: listPaths(DIR), size: (p) => statSync(path.join(DIR, p)).size, read: (p) => readFileSync(path.join(DIR, p), 'utf8') }, project, [], { DatabaseSync }))
      db.prepare('INSERT INTO data_facts(repo, scope, key, extractor, sig, facts, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run('app', r.scope, r.key, r.extractor, 'sig', r.facts ? JSON.stringify(r.facts) : null, r.error || null)
    db.close()

    const page = await renderGraph(project)
    const D = dataOf(page), s = D.data.stores[0]
    eq([D.data.changes.base.ref, s.ch.n, s.ch.renames.map((r) => r.text)], ['main', { added: 4, removed: 4, modified: 1, renames: 2 }, ['possible rename, not decided: column title → heading in books (same type and position)', 'possible rename, not decided: table tags → labels (same columns)']],
      'packed in Node at render time, against the default base (main): the counts and the rename candidates in words')
    const pg = await stubPage(page, '#data-0')
    const tgl = pg.ctl('data-changes')
    ok(!!tgl && tgl.attrs['aria-pressed'] === 'false' && tgl.kids[0] === 'Changes vs main' && !/class="tbl[^"]* (add|del|mod)\b|class="ren/.test(pg.erd().html) && !pg.text().includes('Changes since main:'), 'the toggle "Changes vs main" is there, off by default: the ERD as the branch has it')
    pg.press('data-changes')
    const svg = pg.erd().html
    const tblClass = (name) => (new RegExp(`<g class="(tbl[^"]*)" data-tbl="\\d+" tabindex="0" role="button" aria-label="${name},`).exec(svg) || [])[1]
    const rowClass = (col) => (new RegExp(`<g class="(row[^"]*)" data-col="${col}"`).exec(svg) || [])[1]
    eq([pg.ctl('data-changes').attrs['aria-pressed'], tblClass('labels'), tblClass('tags'), tblClass('authors'), tblClass('books')], ['true', 'tbl add', 'tbl del ghost', 'tbl mod', 'tbl mod'], 'on: an added table green, a removed one drawn as a ghost where it stood, the modified ones amber')
    eq([rowClass('email'), rowClass('bio'), rowClass('heading'), rowClass('title')], ['row add', 'row mod', 'row add', 'row del'], '… and their columns: added, modified, removed')
    ok(svg.includes(">nullable: nullable → not null; default: none → ''</text><title>was: nullable: nullable → not null; default: none → '' (at the base: db/0001_init.sql:1)</title>"), 'a modified column says before → after on its row, and where it stood at the base')
    ok(/<g class="row del" data-col="title"><title>title TEXT · not null\nremoved since main \(at the base: db\/0001_init\.sql:2\)\n[^<]*<\/title>[^]*?<line class="strike"[^>]*\/><\/g>/.test(svg) && /<g class="xr del"><title>index books_title_idx \(title\) — not in the branch\nremoved since main \(at the base: db\/0001_init\.sql:3\)<\/title>[^]*?<line class="strike"/.test(svg), 'a removed column and a removed index are struck through, with where they were')
    ok(/<path class="ren tren" data-ren="1" d="M[^"]+"><title>possible rename, not decided: table tags → labels \(same columns\)<\/title><\/path>/.test(svg) && /<path class="ren" data-ren="0" d="M[^"]+"><title>possible rename, not decided: column title → heading in books \(same type and position\)<\/title><\/path>/.test(svg),
      'rename candidates are paired by a link: tables by a dashed line between their boxes, columns by a bracket beside their rows')
    const text = pg.text()
    ok(['Changes since main:', 'added', 'removed', 'modified: before → after', 'possible rename, linked, never decided'].every((w) => text.includes(w)) && text.includes('4 added · 4 removed · 1 modified · 2 possible renames, against main (the index\'s base branch) at ') && text.includes('+4 −4 ~1 · 2 possible renames'), 'a legend, the totals against the base, and the counts on the store picker')
    const escd = BAD.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    ok(!/<img|<script|<!--/i.test(svg) && svg.includes(`aria-label="h${escd}, table, 2 columns, removed since main: open its passport"`) && svg.includes(`aria-label="n${escd}, table, 1 column, added since main: open its passport"`) && svg.includes(`data-col="c${escd}"`), 'the overlay escapes a removed and an added table holding markup, and their columns')

    pg.click(s.ch.tables.findIndex((t) => typeof t === 'object' && t.name === 'authors'))
    ok(pg.text().includes('Changes since main (2)') && pg.lines('LI').includes("bio TEXT · not null · default ''modified since maindb/0002_branch.sql:1was: nullable: nullable → not null · default: none → '' — at the base: db/0001_init.sql:1") && !!pg.find((n) => n.tagName === 'CODE' && n.kids[0] === 'db/0001_init.sql:1' && /at the base/.test(n.attrs.title)),
      "the passport lists the table's changes, before → after, citing the base's line as text (it is the base's, not the working tree's)")
    pg.click(s.ch.tables.findIndex((t) => typeof t === 'object' && t.name === `h${BAD}`))
    const markup = pg.all((n) => typeof n.html === 'string' && /<img|<script/i.test(n.html)).length + pg.all((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT').length
    ok(markup === 0 && !!pg.find((n) => n.tagName === 'SPAN' && n.attrs.class === 'struck' && n.kids[0] === `h${BAD}`) && !!pg.find((n) => n.tagName === 'CODE' && n.kids[0] === 'db/0001_init.sql:5'), "a ghost's passport: its name struck, as text, never markup; declared at the base's line")
    pg.press('data-changes')
    ok(!/class="tbl[^"]* (add|del|mod)\b|class="ren/.test(pg.erd().html), 'off again: the ERD as the branch has it')
    ok(!/https?:\/\//.test(page) && !/<!--|<script/i.test(scriptOf(page)), 'the page stays static: no URL, nothing fetched')
  } catch (e) { ok(false, `the change overlay renders (${e.stack})`) } finally { rmSync(DIR, { recursive: true, force: true }) }
}

// ── 10 · proposals: the delta file and its states ──
console.log('\n10 · proposals: the delta file, its targets and its computed states (delta.mjs)')
const { parseDelta, parseTarget, targetOf, changeHash, deltaStates, findTarget, setAcks, changeText, STATE_TEXT } = await import('../lib/data/delta.mjs')
{
  const ch = (id, op, target, extra = {}) => ({ id, op, target, why: `why ${id}`, origin: 'planned', ...extra })
  const errs = (doc) => parseDelta(JSON.stringify(doc)).errors
  const ok1 = { schema: 1, spec: 'docs/specs/2026-11-06-x-design.md', data: [ch('a', 'add', 'app:db/books.isbn', { after: { type: 'TEXT', nullable: true } })], architecture: [] }
  eq(errs(ok1), [], 'a well-formed delta validates')
  eq(parseDelta('{ "schema": 1, ').errors.map((e) => e.slice(0, 9)), ['not JSON:'], 'a file that is not JSON says so')
  eq(errs({ schema: 2, data: {}, extra: 1 }), ['unknown key "extra" (a delta has schema, spec, data, architecture)', 'schema 2 is not one this grimoire reads (schema 1)', 'spec: the design this delta belongs to (docs/specs/<date>-<topic>-design.md)', 'data: an array of changes to the data model ([] when none)', 'architecture: an array of changes to the architecture ([] when none)'],
    'the file: its schema version, its spec, data and architecture as arrays, no unknown key')
  const bad = errs({ ...ok1, data: [
    ch('a', 'grow', 'app:db/books.isbn'),
    ch('b', 'add', 'books.isbn', { after: { type: 'TEXT', nullable: true } }),
    ch('c', 'add', 'app:db/books.isbn'),
    ch('a', 'remove', 'app:db/books'),
    { ...ch('d', 'add', 'app:db/books.isbn', { after: { type: 'TEXT' }, afer: 1 }), why: '' },
    ch('e', 'change', 'app:db/books/key:unique(isbn)', { after: {} }),
    ch('f', 'rename', 'app:db/books/fk:(author_id)->authors(id)', { after: { name: 'x' } }),
    ch('g', 'add', 'app:db/books/key:secondary(isbn)'),
    ch('h', 'remove', 'app:db/books', { origin: 'guessed', after: { kind: 'table' } }),
    ch('i', 'add', 'app:db/loans', { after: { fields: [{ name: 'id', type: 'INTEGER' }] } }),
  ] })
  eq(bad, [
    'data[0] (a): op "grow" is not one of add, change, remove, rename',
    'data[1] (b): target: "books.isbn" names no repository: <repo>:<store>/<entity>',
    'data[2] (c): an addition needs after: the column it adds',
    'data[3] (a): the id "a" is data[0]\'s too: ids are unique',
    'data[4] (d): unknown key "afer" (a change has id, op, target, before, after, why, slice, origin, ack)',
    'data[4] (d): why: say why it changes',
    'data[4] (d): after: a column needs its nullable',
    'data[5] (e): a key has nothing to change: its columns are what it is (remove it and add the new one)',
    'data[6] (f): a foreign key has no name to rename: remove it and add the new one',
    'data[7] (g): target: "app:db/books/key:secondary(isbn)": key:<role>(<col>,…), the role one of primary, unique, partition, sort, ttl',
    'data[8] (h): origin "guessed" is not one of planned, unplanned',
    'data[8] (h): a removal has no after',
    'data[9] (i): after: column id needs its nullable',
  ], 'each change: a known op, a target in the grammar, after where the op needs it and in the element\'s own attributes, a why, an origin, a unique id; every error at once, each naming its change')

  // the hash: canonical, so key order is no change; what changes or why is; ack and slice are not
  const c0 = ch('a', 'add', 'app:db/books.isbn', { after: { type: 'TEXT', nullable: true }, before: { x: { b: 1, a: 2 } } })
  const reordered = { before: { x: { a: 2, b: 1 } }, why: c0.why, after: { nullable: true, type: 'TEXT' }, origin: 'planned', target: c0.target, op: 'add', id: 'a' }
  eq([changeHash(c0) === changeHash(reordered), changeHash(c0) === changeHash({ ...c0, slice: 3, ack: { by: 'x', at: 'y', hash: 'z' } }), changeHash(c0) === changeHash({ ...c0, why: 'another reason' }), changeHash(c0) === changeHash({ ...c0, after: { type: 'TEXT', nullable: false } }), /^[0-9a-f]{16}$/.test(changeHash(c0))],
    [true, true, false, false, true], 'a change\'s hash: the same whatever the key order, and with or without its ack or slice; another when its why or its after is edited')

  // targets: the grammar, round-tripped through the model, resolving where the diff matches
  eq(['app:db/books', 'app:db/books.meta.isbn', 'app:prisma/migrations/Loan/index:Loan_due_idx', 'app:db/books/key:unique(isbn, title)', 'app:./books/fk:(author_id)->authors(id)'].map((t) => { const p = parseTarget(t); return `${p.storeId} ${p.entity} ${p.kind} ${JSON.stringify(p.el)}` }),
    ['app:db books entity {"name":"books"}', 'app:db books field {"name":"meta.isbn"}', 'app:prisma/migrations Loan index {"name":"Loan_due_idx"}', 'app:db books key {"role":"unique","parts":["isbn","title"]}', 'app:. books relation {"columns":["author_id"],"to":"authors","toColumns":["id"]}'],
    'the target grammar: a store id that may hold "/", a table, a column (dotted when nested), an index, a key by role and columns, a foreign key by its columns on both sides')
  const M = modelOf(`CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE, title TEXT NOT NULL, isbn TEXT, UNIQUE (isbn, title));
CREATE INDEX books_title_idx ON books (title);`)
  const st = M.stores[0], all = st.entities.flatMap((e) => [['entity', e, e], ...e.fields.map((x) => ['field', e, x]), ...e.keys.map((x) => ['key', e, x]), ...e.indexes.map((x) => ['index', e, x]), ...e.relations.map((x) => ['relation', e, x])])
  const round = all.map(([kind, e, x]) => { const t = targetOf(st.id, e.name, kind, x); return findTarget(M, parseTarget(t)).el === x ? 'ok' : `lost ${t}` })
  ok(round.length === 13 && round.every((r) => r === 'ok'), `every element of a model named by targetOf resolves back to itself through parseTarget (${round.filter((r) => r !== 'ok').join(', ') || `${round.length} elements`})`)
  eq(['app:db/Books.TITLE', 'app:db/BOOKS/key:UNIQUE(ISBN,Title)', 'app:db/books/fk:(Author_ID)->AUTHORS(ID)', 'app:db/books/index:BOOKS_TITLE_IDX'].map((t) => !!findTarget(M, parseTarget(t)).el), [true, false, true, true],
    'SQLite names resolve in any letter case, as the diff matches them (a key\'s role is part of the grammar, lower case)')
  const pgm = modelOf('CREATE TABLE books (id INTEGER PRIMARY KEY);', { dialect: 'postgres' })
  eq([!!findTarget(pgm, parseTarget('app:db/books')).el, !!findTarget(pgm, parseTarget('app:db/Books')).el], [true, false], 'where the dialect\'s names are case-sensitive, another case is another table')

  // the states, against a base and a branch
  const BASE = `CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT);
CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT 'untitled', isbn TEXT, UNIQUE (isbn));
CREATE INDEX books_title_idx ON books (title);
CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, body TEXT);
CREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT NOT NULL);`
  const BRANCH = `CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', email TEXT);
CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE SET NULL, title TEXT NOT NULL DEFAULT 'draft', isbn TEXT, UNIQUE (isbn, title));
CREATE INDEX books_author_idx ON books (author_id);
CREATE TABLE loans (id INTEGER PRIMARY KEY, book_id INTEGER REFERENCES books(id));
CREATE TABLE labels (id INTEGER PRIMARY KEY, label TEXT NOT NULL);
CREATE VIEW recent AS SELECT id FROM books;`
  const base = modelOf(BASE), branch = modelOf(BRANCH)
  const acked = ch('acked', 'add', 'app:db/authors.email', { after: { type: 'TEXT', nullable: true }, slice: 1 })
  acked.ack = { by: 'Ann', at: '2026-11-06T10:00:00.000Z', hash: changeHash(acked) }
  const edited = ch('stale', 'add', 'app:db/authors.phone', { after: { type: 'TEXT', nullable: true } })
  edited.ack = { by: 'Ann', at: '2026-11-06T10:00:00.000Z', hash: changeHash({ ...edited, why: 'the reason before the edit' }) }
  const delta = { schema: 1, spec: 'docs/specs/x-design.md', architecture: [], data: [
    acked, edited,
    ch('index', 'add', 'app:db/books/index:books_author_idx', { after: { columns: ['author_id'] } }),
    ch('loans', 'add', 'app:db/loans', { after: { fields: [{ name: 'id', type: 'INTEGER', nullable: true }, { name: 'book_id', type: 'TEXT', nullable: true }, { name: 'due_on', type: 'TEXT', nullable: false }] } }),
    ch('title-default', 'change', 'app:db/books.title', { after: { default: "'draft'" } }),
    ch('name-type', 'change', 'app:db/authors.name', { after: { type: 'VARCHAR(120)' } }),
    ch('bio-default', 'change', 'app:db/authors.bio', { after: { default: "'none'" } }),
    ch('drop-notes', 'remove', 'app:db/legacy_notes'),
    ch('drop-key', 'remove', 'app:db/books/key:unique(isbn,title)'),
    ch('tags', 'rename', 'app:db/tags', { after: { name: 'labels' } }),
    ch('writers', 'rename', 'app:db/authors', { after: { name: 'writers' } }),
    ch('case', 'add', 'app:db/Books.ISBN', { after: { type: 'text', nullable: true } }),
    ch('typo', 'remove', 'app:db/ghosts'),
    ch('elsewhere', 'add', 'app:cache/entries', { after: { fields: [{ name: 'k', type: 'TEXT', nullable: false }] } }),
  ] }
  eq(parseDelta(JSON.stringify(delta)).errors, [], 'the delta under test validates')
  const line = (r) => `${r.id} ${r.state}${r.ack ? ` ${r.ack}` : ''}${r.diffs.length ? ` [${r.diffs.map((x) => x.text).join('; ')}]` : ''}${r.proposed.length ? ` {${r.proposed.map((x) => x.text).join('; ')}}` : ''}${r.warn ? ` (${r.warn})` : ''}`
  const s = deltaStates(delta, branch, { base, diff: diffModels(base, branch) })
  eq(s.changes.map(line), [
    'acked planned-built acked',
    'stale pending stale',
    'index planned-built',
    'loans built-differently [column book_id type: TEXT → INTEGER; column due_on: TEXT, not null → absent]',
    'title-default planned-built',
    'name-type pending {type: TEXT → VARCHAR(120)}',
    "bio-default built-differently [default: 'none' → '']",
    'drop-notes planned-built',
    'drop-key pending',
    'tags planned-built',
    'writers pending {rename to writers}',
    'case planned-built',
    'typo planned-built (not in the model, nor at the base: check the target)',
    'elsewhere pending (the store is not in the model)',
  ], 'each change\'s state: built in the intended shape, pending, or built differently (planned → built); a change the branch has not touched is pending (now → planned), one it touched another way is built differently; a removal is built once its target is gone, a rename once only the new name is there; a target in another letter case resolves; the acknowledgement apart, stale once the change was edited')
  eq(s.unplanned.map((u) => `${u.c.change} ${u.target}`), ['removed app:db/books/key:unique(isbn)', 'removed app:db/books/index:books_title_idx', 'modified app:db/books/fk:(author_id)->authors(id)', 'added app:db/recent'],
    'unplanned: what the branch changed against its base that no change of the delta covers, each named as a target (a change built another way, a rename\'s two names and a table added whole count as covered)')
  eq(s.counts, { changes: 14, 'planned-built': 7, pending: 5, 'built-differently': 2, acked: 1, stale: 1, unacked: 12, unplanned: 4 }, '… counted')
  eq(deltaStates(delta, base, { base, diff: diffModels(base, base) }).changes.map(line).slice(2, 11),
    ['index pending', 'loans pending', 'title-default pending {default: \'untitled\' → \'draft\'}', 'name-type pending {type: TEXT → VARCHAR(120)}', 'bio-default pending {default: none → \'none\'}', 'drop-notes pending', 'drop-key planned-built (not in the model, nor at the base: check the target)', 'tags pending {rename to labels}', 'writers pending {rename to writers}'],
    'at design time (the branch is its base): every change not in the code yet is pending, with what it proposes; a removal whose target was never there reads as done, with a warning')
  const noBase = deltaStates({ ...delta, data: [ch('b', 'change', 'app:db/authors.bio', { after: { default: "'none'" }, before: { nullable: true } }), ch('n', 'change', 'app:db/authors.name', { after: { type: 'VARCHAR(120)' }, before: { type: 'TEXT' } })] }, branch)
  eq([noBase.changes.map(line), noBase.unplanned], [["b built-differently [default: 'none' → '']", 'n pending {type: TEXT → VARCHAR(120)}'], []], 'with no base, `before` tells a change not made yet from one made another way; nothing is unplanned (there is no branch to compare)')
  eq([changeText(delta.data[9]), STATE_TEXT['built-differently']], ['rename app:db/tags → labels', 'built differently'], 'a change and a state in words')

  // acknowledging: the file edited in place, every other byte kept
  const FILE = `{
  "schema": 1,
  "spec": "docs/specs/x-design.md",
  "data": [
    {
      "id": "one",
      "op": "add",
      "target": "app:db/books.isbn",
      "after": { "type": "TEXT", "nullable": true },
      "why": "search by isbn",
      "origin": "planned"
    },
    {
      "id": "two",
      "op": "remove",
      "target": "app:db/legacy",
      "why": "unused",
      "origin": "planned",
      "ack": {
        "by": "Ann",
        "at": "2026-11-05T09:00:00.000Z",
        "hash": "0000000000000000"
      }
    },
    { "id": "three", "op": "remove", "target": "app:db/old", "why": "gone", "origin": "planned", "ack": { "by": "Bo", "at": "x", "hash": "y" } },
    {"id": "four", "op": "remove", "target": "app:db/older", "why": "gone too", "origin": "planned"}
  ],
  "architecture": []
}
`
  const A = { by: 'Cy', at: '2026-11-06T12:00:00.000Z', hash: 'abcdef0123456789' }
  const edited2 = setAcks(FILE, new Map([[0, A], [1, A], [2, null], [3, A]]))
  const doc = JSON.parse(edited2)
  eq(doc.data.map((c) => c.ack || null), [A, A, null, A], 'acknowledgements set, replaced and removed')
  const lines = edited2.split('\n')
  eq(lines.slice(4, 18), ['    {', '      "id": "one",', '      "op": "add",', '      "target": "app:db/books.isbn",', '      "after": { "type": "TEXT", "nullable": true },', '      "why": "search by isbn",', '      "origin": "planned",', '      "ack": {', '        "by": "Cy",', '        "at": "2026-11-06T12:00:00.000Z",', '        "hash": "abcdef0123456789"', '      }', '    },', '    {'],
    'a new ack goes last in its change, in the file\'s 2-space style; the rest of the change keeps its own layout')
  ok(edited2.includes('    { "id": "three", "op": "remove", "target": "app:db/old", "why": "gone", "origin": "planned" },\n') && edited2.includes('{"id": "four", "op": "remove", "target": "app:db/older", "why": "gone too", "origin": "planned", "ack": { "by": "Cy", "at": "2026-11-06T12:00:00.000Z", "hash": "abcdef0123456789" }}') && edited2.endsWith('  "architecture": []\n}\n'),
    'a change written on one line stays on one line; removing an ack takes its comma with it; the final newline stays')
  const unchanged = setAcks(FILE, new Map([[1, null]]))
  eq(unchanged.split('\n').filter((l, k) => !FILE.split('\n').includes(l) || k > 30).length, 0, 'removing one ack changes only its lines: every other line of the file is kept as it was')
  const crlf = setAcks(FILE.replace(/\n/g, '\r\n'), new Map([[0, A]]))
  ok(!/[^\r]\n/.test(crlf) && JSON.parse(crlf).data[0].ack.by === 'Cy', 'CRLF line ends are kept')
  const odd = setAcks('{"schema":1,"spec":"s","data":[{"id":"a","op":"remove","target":"app:db/t","why":"w","origin":"planned","ack":{"by":"1","at":"1","hash":"1"},"ack":{"by":"2","at":"2","hash":"2"}}],"architecture":[]}', new Map([[0, null]]))
  ok(JSON.parse(odd).data[0].ack === undefined, 'a layout the in-place edit cannot handle (a duplicated key) is written whole, and still right')
}

// ── 11 · the Data tab draws a delta ──
console.log('\n11 · the Data tab draws a delta over the model, against a git base')
{
  const { openStore } = await import('../lib/store.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { extractAll } = await import('../lib/data/registry.mjs')
  const { loadProject, listPaths } = await import('../lib/project.mjs')
  const DIR = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-delta-page-')))
  const put = (rel, text) => { mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); writeFileSync(path.join(DIR, rel), text) }
  const BAD = '"><img src=x onerror=alert(1)></title><script>x</script><!--', NOSLASH = '"><img src=x onerror=alert(1)>'
  const escd = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const plan = (id, op, target, extra) => ({ id, op, target, why: `because ${id}`, origin: 'planned', ...extra })
  const withAck = (c, by, edit = {}) => ({ ...c, ...edit, ack: { by, at: '2026-11-06T10:00:00.000Z', hash: changeHash(c) } })
  try {
    put('grimoire.config.json', JSON.stringify({ repos: [{ name: 'app', path: '.' }] }))
    put('db/0001_init.sql', ['CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bio TEXT);', 'CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id), title TEXT NOT NULL);',
      'CREATE INDEX books_title_idx ON books (title);', 'CREATE TABLE legacy (id INTEGER PRIMARY KEY, body TEXT);', ''].join('\n'))
    git(DIR, 'init', '-q', '-b', 'main')
    commit(DIR, 'base')
    git(DIR, 'switch', '-q', '-c', 'feat')
    put('db/0002_branch.sql', ['ALTER TABLE authors ADD COLUMN email TEXT;', 'ALTER TABLE books ADD COLUMN isbn INTEGER;', 'DROP INDEX books_title_idx;', 'CREATE TABLE stats (day TEXT PRIMARY KEY, n INTEGER);', ''].join('\n'))
    commit(DIR, 'branch')
    const DELTA = { schema: 1, spec: 'docs/specs/2026-11-06-reading-design.md', data: [
      withAck(plan('email', 'add', 'app:db/authors.email', { after: { type: 'TEXT', nullable: true }, slice: 1 }), 'Ann'),
      plan('isbn', 'add', 'app:db/books.isbn', { after: { type: 'TEXT', nullable: true }, slice: 1 }),
      plan('loans', 'add', 'app:db/loans', { after: { fields: [{ name: 'id', type: 'INTEGER', nullable: false }, { name: 'book_id', type: 'INTEGER', nullable: true }], keys: [{ role: 'primary', parts: ['id'] }], relations: [{ columns: ['book_id'], to: 'Books', toColumns: ['id'] }] }, slice: 2 }),
      withAck(plan('due', 'add', 'app:db/books.due_on', { after: { type: 'TEXT', nullable: false }, slice: 2 }), 'Ann', { why: 'loans come back by a date, reworded after the acknowledgement' }),
      plan('legacy', 'remove', 'app:db/legacy'),
      { ...plan('hostile', 'add', `app:db/books.c${NOSLASH}`, { after: { type: `text${BAD}`, nullable: true } }), why: `w${BAD}` },
      plan('elsewhere', 'add', 'app:cache/entries', { after: { fields: [{ name: 'k', type: 'TEXT', nullable: false }] } }),
    ], architecture: [] }
    put('docs/specs/2026-11-06-reading.delta.json', JSON.stringify(DELTA, null, 2) + '\n')
    put('docs/specs/2026-10-01-old.delta.json', JSON.stringify({ schema: 1, spec: 'docs/specs/2026-10-01-old-design.md', data: [plan('bad', 'add', `app:t${NOSLASH}`, { after: { type: 'TEXT', nullable: true } })], architecture: [] }, null, 2) + '\n')
    const project = loadProject(DIR)
    const db = await openStore(project.dbPath)
    db.prepare('INSERT INTO repos(name, root, head, indexed_at) VALUES (?, ?, ?, ?)').run('app', '.', '', '')
    for (const r of extractAll({ paths: listPaths(DIR), size: (p) => statSync(path.join(DIR, p)).size, read: (p) => readFileSync(path.join(DIR, p), 'utf8') }, project, [], { DatabaseSync }))
      db.prepare('INSERT INTO data_facts(repo, scope, key, extractor, sig, facts, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run('app', r.scope, r.key, r.extractor, 'sig', r.facts ? JSON.stringify(r.facts) : null, r.error || null)
    db.close()

    const page = await renderGraph(project)
    const D = dataOf(page), dl = D.data.deltas
    eq([dl.map((d) => `${d.shown} ${d.repo}:${d.path} ${d.ackable} ${d.errors.length}`), D.data.delta], [['docs/specs/2026-11-06-reading.delta.json app:docs/specs/2026-11-06-reading.delta.json true 0', 'docs/specs/2026-10-01-old.delta.json app:docs/specs/2026-10-01-old.delta.json true 1'], 0],
      'every delta beside the specs is packed, newest first (the first shown), each saying where the server may write it')
    eq(dl[0].changes.map((c) => `${c.id} ${c.state}${c.ack ? ` ${c.ack}` : ''} store ${c.store} tbl ${c.tbl}`), ['email planned-built acked store 0 tbl 0', 'isbn built-differently store 0 tbl 1', 'loans pending store 0 tbl 4', 'due pending stale store 0 tbl 1', 'legacy pending store 0 tbl 2', 'hostile pending store 0 tbl 1', 'elsewhere pending store -1 tbl -1'],
      'each change\'s state and acknowledgement, computed in Node at render time, and the table it is drawn on (a proposed table after the store\'s own; one in a store not in the model, nowhere)')
    const pg = await stubPage(page, '#data-0')
    const btn = pg.ctl('data-delta'), pick = pg.ctl('data-delta-file')
    ok(!!btn && btn.attrs['aria-pressed'] === 'false' && !/ d-(prop|rm|pend|built|diff|unpl)\b/.test(pg.erd().html) && pick.kids.map((o) => o.kids[0]).join(' ') === 'docs/specs/2026-11-06-reading.delta.json docs/specs/2026-10-01-old.delta.json' && pick.kids[0].attrs.selected === 'selected',
      'a "Delta" toggle, off by default, beside "Changes vs main"; a picker naming every delta, the newest chosen')
    pg.press('data-delta')
    const svg = pg.erd().html
    const tbl = (name) => (new RegExp(`<g class="(tbl[^"]*)" data-tbl="\\d+" tabindex="0" role="button" aria-label="${name},`).exec(svg) || [])[1]
    const row = (col) => (new RegExp(`<g class="(row[^"]*)" data-col="${col}"`).exec(svg) || [])[1]
    eq([btn.attrs && pg.ctl('data-delta').attrs['aria-pressed'], pg.ctl('data-changes').attrs['aria-pressed'], tbl('loans'), tbl('legacy'), tbl('stats'), tbl('books'), row('email'), row('isbn'), row('due_on'), row('book_id')],
      ['true', 'false', 'tbl d-prop', 'tbl d-rm', 'tbl d-unpl', 'tbl', 'row d-built', 'row d-diff', 'row d-prop stale', 'row d-prop'],
      'on: a proposed table dashed among the others, a proposed removal, a table the branch added outside the plan, a column planned and built, one built differently, a proposed column (its acknowledgement stale)')
    ok(/<g class="xr d-unpl gone"><title>index books_title_idx \(title\) — not in the branch\nremoved, not in the plan\nat the base: db\/0001_init\.sql:3<\/title>[^]*?<line class="strike d-unpl"/.test(svg), 'an index the branch dropped outside the plan: struck in its own colour, cited at the base')
    ok(/<line class="strike d-rm" x1/.test(svg) && svg.includes('>planned → built: type: TEXT → INTEGER</text>') && /<path class="fk d-prop" data-fk="\d+:0" d="M[^"]+" marker-start="url\(#erd-many\)" marker-end="url\(#erd-one\)"><title>loans \(book_id\) → Books \(id\)/.test(svg) === false && /<path class="fk d-prop"[^>]*><title>loans \(book_id\) → books \(id\)/.test(svg),
      'a proposed removal struck in amber dashes; built differently says planned → built on its row; a proposed foreign key drawn dashed to the table as the store names it')
    eq((svg.match(/<g class="stalemk">/g) || []).length, 1, 'a stale acknowledgement is badged beside its row')
    const text = pg.text()
    ok(['Delta:', 'proposed (dashed)', 'proposed removal', 'proposed change: now → planned', 'planned and built', 'built differently: planned → built', 'not in the plan', 'acknowledgement stale'].every((w) => text.includes(w)), 'a legend for each state')
    const ps = pg.lines('P')
    ok(ps.includes('For docs/specs/2026-11-06-reading-design.md: 7 changes · 1 planned and built · 5 pending · 1 built differently · 2 not in the plan · 1 acknowledged · 1 stale') && ps.includes('Read-only snapshot. To acknowledge changes, serve the page: graph.mjs serve'), 'the delta named with its design and counts; a static page says it is read-only')
    const lis = pg.lines('LI')
    ok(lis.some((l) => l.startsWith('add app:db/authors.emailplanned and builtas: TEXT, nullablein the code: db/0002_branch.sql:1why: because emailslice 1 · acknowledged by Ann at 2026-11-06T10:00:00.000Z'))
      && lis.some((l) => l.startsWith('add app:db/books.due_onpendingstaleas: TEXT, not nullwhy: loans come back by a date, reworded after the acknowledgementslice 2 · stale: acknowledged by Ann at 2026-11-06T10:00:00.000Z, edited since'))
      && lis.some((l) => l === 'app:db/statsnot in the plantable stats added') && lis.some((l) => l.startsWith('add app:cache/entriespending') && l.includes('⚠ the store is not in the model')),
      'every change listed with its state, shape, where it is in the code, why, slice and acknowledgement (who, when; stale once edited); what is not in the plan; a change whose store is not in the model, apart')
    eq(pg.ctls(/^delta-ack-/), [], 'the static page offers no acknowledgement: it stays read-only')
    pg.click(dl[0].stores[0].tables.findIndex((t) => typeof t !== 'number' ? t.name === 'books' : D.data.stores[0].tables[t].name === 'books'))
    ok(pg.text().includes('Delta: 3 changes, 1 not in the plan') && pg.lines('LI').some((l) => l.includes('app:db/books.isbnbuilt differently') && l.includes('planned → built: type: TEXT → INTEGER')) && pg.lines('LI').some((l) => l === 'app:db/books/index:books_title_idxnot in the planindex books · books_title_idx removed'),
      "a table's passport lists the delta's changes to it, with what differs, and the branch's changes to it outside the plan")
    // markup in a delta's target, after and why is text, in the drawing and in the lists
    ok(!/<img|<script|<!--/i.test(svg) && svg.includes(`data-col="c${escd(NOSLASH)}"`) && svg.includes(escd(`text${BAD}`).slice(0, 20)) && svg.includes(escd(`why: w${BAD}`)), 'the ERD escapes a delta\'s target, after and why')
    const markup = pg.all((n) => typeof n.html === 'string' && /<img|<script/i.test(n.html)).length + pg.all((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT').length
    ok(markup === 0 && pg.lines('LI').some((l) => l.includes(`why: w${BAD}`)), '… and the lists carry them as text nodes, never markup')
    pick.on.change[0]({ target: { value: '1' } })
    const old = pg.text()
    ok(old.includes('docs/specs/2026-10-01-old.delta.json does not validate (1 problem): nothing drawn') && pg.lines('LI').includes(`data[0] (bad): target: ${JSON.stringify(`app:t${NOSLASH}`)} names no store and entity: <repo>:<store>/<entity>`) && !/ d-(prop|rm|built|diff|unpl)\b/.test(pg.erd().html) && !pg.all((n) => n.tagName === 'IMG' || n.tagName === 'SCRIPT').length,
      'the picker switches deltas; one that does not validate shows its problems (as text) and draws nothing')
    pick.on.change[0]({ target: { value: '0' } })
    pg.press('data-changes')
    ok(pg.ctl('data-delta').attrs['aria-pressed'] === 'false' && /class="tbl[^"]* add\b/.test(pg.erd().html) && !/ d-prop\b/.test(pg.erd().html), 'one overlay at a time: Changes turns the delta off')

    // served: each change can be acknowledged; the server answers with what it wrote
    const calls = []
    let answer = (body) => ({ status: 200, j: { hash: 'h2', changes: body.ids.map((id) => ({ id, ack: { by: 'Cy', at: '2026-11-07T08:00:00.000Z', hash: 'x' } })) } })
    const fetch = async (url, o) => { calls.push({ url, method: o.method, headers: o.headers, body: JSON.parse(o.body) }); const a = answer(JSON.parse(o.body)); return { ok: a.status < 300, status: a.status, json: async () => a.j } }
    const served = await renderGraph(project, { serve: { token: 'page-token' } })
    const sp = await stubPage(served, '#data-0', { fetch })
    sp.press('data-delta')
    const acks = sp.ctls(/^delta-ack-l/)
    ok(acks.join(' ') === 'delta-ack-l0 delta-ack-l1 delta-ack-l2 delta-ack-l3 delta-ack-l4 delta-ack-l5' && sp.ctl('delta-ack-l3').kids[0] === 'Acknowledge again' && sp.ctl('delta-ack-l0').kids[0] === 'Unacknowledge' && sp.ctl('delta-ack-sall').kids[0] === 'Acknowledge all 5 changes not acknowledged in this store',
      `served: each change has its control (Acknowledge, Acknowledge again when stale, Unacknowledge), and the store one for all not acknowledged (${acks})`)
    await sp.pressed('delta-ack-l3')
    eq(calls.map((c) => [c.url, c.method, c.headers['x-grimoire-token'], c.body]), [['/api/delta', 'PUT', 'page-token', { repo: 'app', path: 'docs/specs/2026-11-06-reading.delta.json', base: dl[0].hash, ids: ['due'], ack: true }]],
      'acknowledging sends the delta, the hash it was loaded with, the change\'s id and nothing else: who, when and the hash are the server\'s to write')
    ok(sp.lines('LI').some((l) => l.includes('app:db/books.due_on') && l.includes('acknowledged by Cy at 2026-11-07T08:00:00.000Z')) && !/stalemk/.test(sp.erd().html) && sp.text().includes('Acknowledged: 1 change, written to docs/specs/2026-11-06-reading.delta.json'),
      '… and the page shows what the server wrote: the stale badge is gone')
    answer = () => ({ status: 409, j: { error: 'changed on disk since it was loaded', text: '{}', hash: 'h3' } })
    await sp.pressed('delta-ack-sall')
    ok(calls[1].body.base === 'h2' && calls[1].body.ids.join(',') === 'isbn,loans,legacy,hostile' && sp.text().includes('The delta changed on disk since this page was loaded') && !!sp.ctl('delta-reload'), 'a refused write (the file changed since): the page says so and offers to reload; the store control sends every change not acknowledged')
    const scr = scriptOf(served)
    ok(!/<!--|<script/i.test(scr) && /connect-src 'self'/.test(served) && !/connect-src/.test(page), 'the page script stays clean; only the served page may connect back to its server')
  } catch (e) { ok(false, `the delta overlay renders (${e.stack})`) } finally { rmSync(DIR, { recursive: true, force: true }) }
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
    // ── 10 · the stores ──
    console.log('\n10 · a project of four repositories (fixtures/data)')
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

    // ── 11 · the Data tab ──
    console.log('\n11 · the Data tab of that project')
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

    // ── 12 · incremental ──
    console.log('\n12 · incremental refresh')
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

    // ── 13 · a branch against its base ──
    console.log('\n13 · a branch against its base (graph_changes), on a copy with two commits')
    const BR = path.join(SANDBOX, 'branch')
    const fixture = (keep) => cpSync(path.join(HERE, 'fixtures', 'data'), BR, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') && keep(path.relative(path.join(HERE, 'fixtures', 'data'), src)) })
    fixture((rel) => !rel.startsWith(path.join('kiosk', 'storage')))
    git(BR, 'init', '-q', '-b', 'main')
    const beforeKiosk = commit(BR, 'every store but the kiosk one')
    fixture(() => true)
    commit(BR, 'the kiosk store')
    git(BR, 'switch', '-q', '-c', 'feat')
    mkdirSync(path.join(BR, 'api/prisma/migrations/20240401090000_branch_changes'))
    writeFileSync(path.join(BR, 'api/prisma/migrations/20240401090000_branch_changes/migration.sql'), '-- AlterTable\nALTER TABLE "Loan" ADD COLUMN "returnedOn" DATETIME;\n\n-- DropIndex\nDROP INDEX "Member_email_key";\n\n-- RenameTable\nALTER TABLE "Tag" RENAME TO "Label";\n')
    commit(BR, 'add a column, drop an index, rename a table')
    const br = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: BR })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    await br('index')
    const facts = await br('sql', { sql: 'SELECT count(*) AS n FROM data_facts' })
    const changes = await br('changes')
    const [head] = changes.split('\n')
    ok(/^Data model against main \(the index's base branch\) at [0-9a-f]{10}: 1 store changed · 2 added · 2 removed · 0 modified · 1 possible rename$/.test(head), `graph_changes: one line to sum it up, against the branch the index is based on (${head})`)
    eq(changes.split('\n').slice(1), [
      'api:prisma/migrations  sqlite  modified',
      '  + Label  table, 2 columns  — api/prisma/migrations/20240401090000_branch_changes/migration.sql:8',
      '  + Loan.returnedOn  column DATETIME, nullable  — api/prisma/migrations/20240401090000_branch_changes/migration.sql:2',
      '  - Member index Member_email_key unique (email)  — was api/prisma/migrations/20240105090000_init/migration.sql:19',
      '  - Tag  table, 2 columns  — was api/prisma/migrations/20240301080000_tags/migration.sql:2',
      '  possible rename, not decided: table Tag → Label (same columns)',
    ], 'the column added, the index dropped, the table renamed (a candidate, never decided: Tag removed, Label added), each with path:line on its side')
    has(await call('graph_changes', {}, { root: BR }), '\n\nLeads, not facts: both sides are read from migrations and generated files', '… with the footer graph_data has')
    eq(await br('sql', { sql: 'SELECT count(*) AS n FROM data_facts' }), facts, "the base's facts never enter the index")
    const missing = await call('graph_changes', { base: 'no-such-branch' }, { root: BR }).then(() => 'answered', (e) => e.message)
    eq(missing, 'the base "no-such-branch" does not resolve to a commit in mobile, api, kiosk, web (give a branch, a tag or a commit)', 'a ref that does not resolve: a clear error')
    const older = await br('changes', { base: beforeKiosk })
    has(older, 'kiosk:storage/schema-changes  sqlite  added (absent at the base)\n  + badge_holders  view  — kiosk/storage/schema-changes/0003_tidy.up.sql:3\n  + badges  table, 2 columns  — kiosk/storage/schema-changes/0002_badges.up.sql:1\n  + visits  table, 3 columns  — kiosk/storage/schema-changes/0001_visits.up.sql:1', 'a base where the migrations folder did not exist: an added store and its tables, not an error')
    ok(older.startsWith(`Data model against ${beforeKiosk.slice(0, 10)} (given): 2 stores changed`), `… against the commit given, named once by its first 10 digits (${older.split('\n')[0]})`)
    has(await br('changes', { base: 'main', repo: 'mobile' }), 'Data model against main (given) at ', '`repo` limits the comparison to one repository')
    ok((await br('changes', { base: 'main', repo: 'mobile' })).endsWith(': no change.'), '… mobile did not change')

    const run = (...a) => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), ...a, '--root', BR], { encoding: 'utf8' })
    has(run('changes', '--base', 'main').stdout, '  possible rename, not decided: table Tag → Label (same columns)', 'graph.mjs changes --base <ref>')
    const bad = run('changes', '--base', 'no-such-branch')
    ok(bad.status === 1 && bad.stderr.includes('the base "no-such-branch" does not resolve'), `graph.mjs changes with a ref that does not resolve exits 1 and says why (${bad.stderr.trim()})`)
    const outFile = path.join(SANDBOX, 'branch.html')
    const rendered = run('render', '--base', 'main', '--out', outFile)
    const RD = rendered.status === 0 ? dataOf(readFileSync(outFile, 'utf8')).data : null
    eq(RD && [RD.changes.base.ref, RD.stores.filter((s) => s.ch).map((s) => `${s.id} +${s.ch.n.added} -${s.ch.n.removed} ~${s.ch.n.modified} ?${s.ch.n.renames}`)], ['main', ['api:prisma/migrations +2 -2 ~0 ?1']], `graph.mjs render --base <ref>: the page carries the overlay against it (${rendered.stderr.trim()})`)
    const badRender = run('render', '--base', 'no-such-branch', '--out', outFile)
    ok(badRender.status === 1 && badRender.stderr.includes('does not resolve'), 'graph.mjs render with a base that does not resolve exits 1 and says why')

    // ── the branch against a design's delta ──
    console.log('\n15 · the branch against a design\'s delta (graph_changes --delta)')
    const plan = (id, op, target, extra) => ({ id, op, target, why: `because ${id}`, origin: 'planned', ...extra })
    const acked = (c, edit = {}) => ({ ...c, ...edit, ack: { by: 'Ann', at: '2026-11-06T10:00:00.000Z', hash: changeHash(c) } })
    const DELTA = { schema: 1, spec: 'docs/specs/2026-11-06-loans-design.md', data: [
      plan('returned-on', 'add', 'api:prisma/migrations/Loan.returnedOn', { after: { type: 'DATETIME', nullable: false }, slice: 1 }),
      acked(plan('labels', 'rename', 'api:prisma/migrations/Tag', { after: { name: 'Label' }, slice: 1 })),
      acked(plan('returned-idx', 'add', 'api:prisma/migrations/Loan/index:Loan_returnedOn_idx', { after: { columns: ['returnedOn'] } }), { why: 'list the loans still out, edited after the acknowledgement' }),
      plan('bio', 'add', 'mobile:drizzle/authors.bio', { after: { type: 'text', nullable: false } }),
    ], architecture: [] }
    mkdirSync(path.join(BR, 'docs/specs'), { recursive: true })
    writeFileSync(path.join(BR, 'docs/specs/2026-11-06-loans.delta.json'), JSON.stringify(DELTA, null, 2) + '\n')
    const dl = await br('changes', { delta: 'docs/specs/2026-11-06-loans.delta.json' })
    const migration = 'api/prisma/migrations/20240401090000_branch_changes/migration.sql'
    ok(/^Delta docs\/specs\/2026-11-06-loans\.delta\.json \(the design: docs\/specs\/2026-11-06-loans-design\.md\), against the model and the branch against main \(the index's base branch\) at [0-9a-f]{10}: 4 data changes$/.test(dl.split('\n')[0]), `graph_changes --delta: which delta, for which design, against what (${dl.split('\n')[0]})`)
    eq(dl.split('\n').slice(1), [
      `  built differently  returned-on  add api:prisma/migrations/Loan.returnedOn  — ${migration}:2`,
      '    planned → built: nullable: not null → nullable',
      '    why: because returned-on · slice 1 · not acknowledged',
      `  planned and built  labels  rename api:prisma/migrations/Tag → Label  — ${migration}:8`,
      '    why: because labels · slice 1 · acknowledged by Ann at 2026-11-06T10:00:00.000Z',
      '  pending  returned-idx  add api:prisma/migrations/Loan/index:Loan_returnedOn_idx',
      '    why: list the loans still out, edited after the acknowledgement · stale: acknowledged by Ann at 2026-11-06T10:00:00.000Z, edited since',
      '  planned and built  bio  add mobile:drizzle/authors.bio  — mobile/drizzle/meta/0005_snapshot.json:24 · mobile/drizzle/0003_author_bio_required.sql:5',
      '    why: because bio · not acknowledged',
      'Unplanned (1): in the branch, in no change of the delta',
      '  - api:prisma/migrations/Member/index:Member_email_key  Member index Member_email_key unique (email)  — was api/prisma/migrations/20240105090000_init/migration.sql:19',
      'Summary: 2 planned and built · 1 pending · 1 built differently · 1 unplanned · 1 acknowledged · 1 stale · 2 not acknowledged',
    ], 'each change\'s state against the code: a column built in another shape (planned → built), a rename built, an index pending, a column that was there already; its why, slice and acknowledgement (stale once edited); then the branch\'s change no delta change covers, then the summary')
    has(await call('graph_changes', { delta: 'docs/specs/2026-11-06-loans.delta.json' }, { root: BR }), '\n\nLeads, not facts: the states are computed from migrations', '… with its own footer: states are computed, never written')
    has(run('changes', '--delta', 'docs/specs/2026-11-06-loans.delta.json').stdout, '  pending  returned-idx  add api:prisma/migrations/Loan/index:Loan_returnedOn_idx', 'graph.mjs changes --delta <file>')
    writeFileSync(path.join(BR, 'docs/specs/broken.delta.json'), JSON.stringify({ ...DELTA, data: [{ ...DELTA.data[0], op: 'grow' }] }))
    eq(await br('changes', { delta: 'docs/specs/broken.delta.json' }), 'Delta docs/specs/broken.delta.json does not validate (1 problem):\n  data[0] (returned-on): op "grow" is not one of add, change, remove, rename', 'a delta that does not validate: its problems, nothing computed')
    const gone = await call('graph_changes', { delta: 'docs/specs/none.delta.json' }, { root: BR }).then(() => 'answered', (e) => e.message)
    ok(/^the delta docs\/specs\/none\.delta\.json cannot be read \(ENOENT\)$/.test(gone), `a delta that is not there: a clear error (${gone})`)
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
