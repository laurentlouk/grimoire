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
//
//  Part 2 indexes a fixture project (fixtures/data) and asserts through the same `call()` the MCP
//  server and the CLI use. It needs the parser runtime (the fixture has TypeScript files): skipped
//  without it, except under CI, where a missing runtime fails.

const { split, hasDDL } = await import('../lib/data/readers/sql-split.mjs')
const { sniffDialect } = await import('../lib/data/readers/sql-dialect.mjs')
const { replay } = await import('../lib/data/readers/sqlite-replay.mjs')
const { driver } = await import('../lib/store.mjs')
const { default: drizzleSnapshot } = await import('../lib/data/extractors/drizzle-snapshot.mjs')
const { reconcile } = await import('../lib/data/reconcile.mjs')
const { DatabaseSync } = await driver()

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }

// ── 1 · splitting SQL ──
console.log('\n1 · splitting SQL into statements')
{
  const drizzle = 'CREATE TABLE `a` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n--> statement-breakpoint\nCREATE INDEX `a_idx` ON `a` (`id`);--> statement-breakpoint\nDROP TABLE `b`;'
  eq(split(drizzle).map((s) => [s.line, s.text]), [[1, 'CREATE TABLE `a` (\n\t`id` text PRIMARY KEY NOT NULL\n)'], [5, 'CREATE INDEX `a_idx` ON `a` (`id`)'], [6, 'DROP TABLE `b`']], "Drizzle: one statement per breakpoint, each with the line it starts on")
  const plain = "-- CreateTable\nCREATE TABLE \"t\" (\n  \"motto\" TEXT DEFAULT 'read; then write -- always',\n  \"n\" INTEGER /* a ; in a comment */\n);\n\n/* block;\n comment */ INSERT INTO \"t\" VALUES ('it''s; fine', 1);\n-- trailing comment; only"
  eq(split(plain).map((s) => [s.line, s.text.split('\n')[0]]), [[2, 'CREATE TABLE "t" ('], [8, 'INSERT INTO "t" VALUES (\'it\'\'s; fine\', 1)']], 'plain `;`: never inside a string, an escaped quote or a comment; comment-only text is no statement')
  const trigger = 'CREATE TRIGGER t_upd AFTER UPDATE ON t BEGIN\n  UPDATE t SET n = 1;\n  UPDATE t SET n = 2;\nEND;\nCREATE TABLE u (x)'
  eq(split(trigger).map((s) => s.line), [1, 5], "a trigger's body keeps its `;` until END")
  ok(hasDDL('-- seed\nINSERT INTO t VALUES (1);') === false && hasDDL('/* CREATE TABLE x */ INSERT INTO t VALUES (1);') === false, 'a seed (no DDL, or DDL only in a comment) is not a migration')
  ok(['CREATE TABLE x (a)', 'alter table x add b', 'CREATE UNIQUE INDEX i ON x (a)', 'create index i on x (a)'].every(hasDDL), 'CREATE TABLE, ALTER TABLE and CREATE [UNIQUE] INDEX are DDL')
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
  eq([r.statements, r.stopped], [11, null], 'every statement ran')

  const bad = { path: 'db/0003_more.sql', text: 'ALTER TABLE books ADD COLUMN pages INTEGER;\n\nALTER TABLE nope ADD COLUMN x TEXT;\nCREATE TABLE never (x);\n' }
  const p = replay([init, bad], DatabaseSync)
  eq(p.stopped, { path: 'db/0003_more.sql', line: 3, error: 'no such table: nope' }, 'a statement SQLite rejects stops the replay there, with the error')
  eq([p.entities.map((e) => e.name), p.entities[1].fields.map((f) => `${f.name}@${f.line}`)], [['authors', 'books'], ['id@7', 'author_id@8', 'title@9', 'pages@1']], 'the facts replayed so far are kept')
  const attach = replay([{ path: 'db/0001_x.sql', text: "ATTACH DATABASE 'elsewhere.db' AS other;\nCREATE TABLE t (x);\nVACUUM INTO 'copy.db';" }], DatabaseSync)
  eq([attach.statements, attach.notes], [1, ['skipped ATTACH at db/0001_x.sql:1 (never run: it reaches files outside the replay)', 'skipped VACUUM at db/0001_x.sql:3 (never run: it reaches files outside the replay)']], 'statements that write files are never run')
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
  eq([d.store, d.dialect, d.dialectFrom, d.complete, d.source], ['db', 'sqlite', 'db/meta/0010_snapshot.json:3', true, { path: 'db/meta/0010_snapshot.json', line: 1, kind: 'artifact', confidence: 'declared' }], 'legacy: the store is the folder holding meta/, its dialect where the snapshot states it')
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
  const migration = (text, extra = {}) => ({ declarations: [{ store: 'db', dialect: 'sqlite', dialectFrom: 'db/0001_init.sql:1', source: { path: 'db/0001_init.sql', line: 1, kind: 'migration', confidence: 'exact' }, complete: true, partial: false, status: 'read', label: 'replayed', notes: [], ...extra, entities: replay([{ path: 'db/0001_init.sql', text }], DatabaseSync).entities }] })
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

  const v1 = (id, prevIds, text) => ({ repo: 'app', extractor: 'drizzle-snapshot@1', facts: drizzleSnapshot.extract(text.replace(/"id": "[^"]+"/, `"id": "${id}"`).replace(/"prevIds": \[[^\]]*\]/, `"prevIds": ${JSON.stringify(prevIds)}`), `next/${id.slice(-2)}_x/snapshot.json`) })
  const dag = reconcile([v1('00000000-0000-4000-8000-000000000012', [], V1.replace('"name": "title"', '"name": "subtitle"')), v1('00000000-0000-4000-8000-000000000013', ['00000000-0000-4000-8000-000000000012'], V1)]).stores[0]
  eq(dag.entities[0].fields.map((f) => [f.name, srcs(f)]), [['id', ['next/13_x/snapshot.json:8 artifact drizzle-snapshot@1']], ['title', ['next/13_x/snapshot.json:9 artifact drizzle-snapshot@1']]], 'Drizzle v1: only the leaves of the snapshot DAG declare the store')
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
