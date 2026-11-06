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
//
//  Part 2 indexes a fixture project (fixtures/data) and asserts through the same `call()` the MCP
//  server and the CLI use. It needs the parser runtime (the fixture has TypeScript files): skipped
//  without it, except under CI, where a missing runtime fails.

const { split, hasDDL } = await import('../lib/data/readers/sql-split.mjs')
const { sniffDialect } = await import('../lib/data/readers/sql-dialect.mjs')
const { replay } = await import('../lib/data/readers/sqlite-replay.mjs')
const { driver } = await import('../lib/store.mjs')
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

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
