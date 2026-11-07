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
//  10. proposals (data/delta.mjs): the delta file's validation, the hash of a change, the target
//      grammar against the diff's identity, each computed state on hand-built models, the unplanned
//      changes (the parts built on a planned table beyond what its `add` states among them),
//      acknowledgements edited into the file in place, the unplanned changes the loop's ship step
//      appends (appendChanges and the delta-append.mjs CLI: its lock, two writers at once)
//  11. the Data tab draws a delta over the model against a git base: each state's marks, the legend,
//      the lists and passports (why, slice, acknowledgement), the picker, escaping; read-only when
//      static, acknowledging through the server when served
//  18. key-value tables declared, in JSON: a CreateTable input and a CloudFormation template read into
//      the model (keys, multi-attribute keys, TTL, GSIs, projections, billing, stream, each at its
//      line; long-form intrinsics kept as references), found by content, two declarations of one
//      table and their conflicts, the diff by identity, the delta's targets, validation and states
//  19. YAML through the pinned grammar (needs the parser runtime): scalars, block scalars, anchors,
//      aliases and merges, tags kept, several documents, errors and the expansion cap; a SAM template
//      in YAML with short-form tags, Serverless resources and SimpleTables, CreateTable inputs in YAML;
//      hostile YAML in bounded time (long blanks, 20 000 documents, the size cap, aliases, a deadline,
//      a timeout parsed aside failing alone)
//  21. hostile JSON in bounded time (nesting past the cap refused, a wide file, a long "${" run), a
//      byte order mark; a declaration that moves to another file or splits: its changes still seen,
//      in the diff and the delta states
//  22. Terraform and Terragrunt: the HCL reader (blocks, literals, heredocs, templates, comments,
//      errors at their line; hostile text refused in bounded time), the evaluator (each construct,
//      unknowns propagated and never guessed; the budget, depth and size caps), the extractor on
//      fixtures/tf in memory (a table per for_each key, sources in the inputs and the module, an
//      unknown input, a name template, a tfvars secret kept out, a var-file per environment, a
//      module out of reach, files that do not parse), the levels and the candidates
//
//  Part 2 indexes a fixture project (fixtures/data) and asserts through the same `call()` the MCP
//  server and the CLI use. It needs the parser runtime (the fixture has TypeScript files): skipped
//  without it, except under CI, where a missing runtime fails.
//  12. four repositories: Drizzle with its snapshots, Prisma, a folder no tool named, Supabase, an
//      undeclared dialect and one stated in grimoire.config.json → graph_data and graph.mjs data
//  13. the Data tab of that project: its stores, ERD and links to the indexed migration files
//  14. incremental: a hand-edited migration (a conflict, badged in the Data tab), a rejected
//      statement, a deleted migration, a snapshot that no longer parses (reported by graph_status,
//      the index goes on)
//  15. a branch against its base (two commits): a column added, an index dropped, a table renamed →
//      graph_changes and graph.mjs changes; a ref that does not resolve; a base without the folder
//  16. that branch against a design's delta: graph_changes --delta (each change's state, the
//      unplanned, the summary), graph.mjs changes and render --delta
//  17. the architecture in graph_changes (the change view, slice 6): a worktree branch adds an import
//      between two components no line joins → a new link no line draws against the base checkout's
//      index, unplanned with the delta; appended by delta-append.mjs (to `architecture`), pending;
//      the diagram updated in the branch, planned and built
//  20. a key-value service (fixtures/kv): a SAM template and local-dev CreateTable files found by
//      content → graph_data (both declarations, the conflicts), the key cards (rows, sources,
//      search, escaping), a branch against its base compared declaration by declaration (the base's
//      YAML parsed aside), a delta's states against every declaration, both overlays on the cards; a
//      name holding a line break quoted in graph_data and graph_changes; a YAML template past the cap
//      failing its job once, not read again until it changes
//  23. Terraform and Terragrunt (fixtures/tf): a module run by a Terragrunt configuration that
//      includes a root and an exposed file → graph_data (the tables, GSIs and TTL at their inputs
//      lines, the module's beside; an input from dependency.*.outputs unknown; a table grouped with
//      the CreateTable file of its exact name, and their conflicts), secrets in neither graph.db nor
//      the page, the key cards (the unknown drawn), a name template, a branch against its base
//  25. item shapes and binding (fixtures/bind): Terraform tables named by a template in an infra
//      repository, a function given two of them in its environment; an api repository with serde
//      structs and conversions building `format!("{}-shop-…")` names, a TypeScript service reading
//      ORDERS_TABLE, a test naming a table, a type no table pairs with, and local-dev CreateTable
//      files (one named so its template matches, one not) → graph_data (the logical table and its
//      local-dev against prod conflicts, each binding's confidence, evidence and rivals, the item
//      tree, the unbound type), the key cards (item tree, bindings dashed below convention, rivals,
//      conflicts across declarations, the item types list), a branch adding an item field and
//      changing one (the base's code read aside), an item field addressed by a delta
//
//  (Part 1, continued) 24. item shapes and binding: names matched on a template's literal parts, no
//      fuzzy matching; serde's case rules; logical tables; each binding rule on hand-written facts
//      (env chain, name template in a function and in a file, a constant of another file, an exact
//      name, the mapper hook, ambiguous with rivals, unbound, unresolved); types that hold themselves
//      (newtypes, aliases), a wide graph of types and a file of many functions in bounded time, a
//      failure while binding leaving the stores answered; serde's tagging of newtype variants in
//      each mode; resolution within one language; two repositories' tables of one name kept apart;
//      a table named only in test code; then, with the parser
//      runtime, the serde and TypeScript extractors (every serde attribute, TypeScript's optional,
//      unions, extends and intersections, the uses per function) and the shapes as stored
import { spawnSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, realpathSync, utimesSync, readdirSync, mkdirSync, statSync, existsSync, symlinkSync } from 'node:fs'
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
  const loc = { hash, reload: () => { loc.reloads = (loc.reloads || 0) + 1 } }
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
    reloads: () => loc.reloads || 0,
    textOf: (n) => flat(n),
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
    ['a/0001_x.up.sql', 'db/0007_tests.sql', 'src/app.ts', 'drizzle/meta/0003_snapshot.json'], 'inputs: SQL but no down migration, nothing under test-support folders or dependencies (a migration named …_tests.sql is still one); a TypeScript source, for the item shapes')
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
const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m); return git(dir, 'rev-parse', 'HEAD').stdout.trim() }
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
const { parseDelta, parseTarget, targetOf, changeHash, deltaStates, findTarget, setAcks, appendChanges, changeText, STATE_TEXT } = await import('../lib/data/delta.mjs')
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
    ch('reviews', 'add', 'app:db/reviews', { after: { fields: [{ name: 'id', type: 'INTEGER', nullable: true }] } }),
    ch('reviews-stars', 'add', 'app:db/Reviews.stars', { after: { type: 'INTEGER', nullable: false } }),
    ch('stray', 'add', 'app:db/nowhere.x', { after: { type: 'TEXT', nullable: true } }),
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
    'reviews pending',
    'reviews-stars pending',
    'stray pending (the table nowhere is not in the model)',
  ], 'each change\'s state: built in the intended shape, pending, or built differently (planned → built); a change the branch has not touched is pending (now → planned), one it touched another way is built differently; a removal is built once its target is gone, a rename once only the new name is there; a target in another letter case resolves; the acknowledgement apart, stale once the change was edited; a column for a table the delta adds is pending, one for a table nowhere is flagged')
  eq(s.unplanned.map((u) => `${u.c.change} ${u.target}${u.on ? ` (on ${u.on})` : ''}`), ['removed app:db/books/key:unique(isbn)', 'removed app:db/books/index:books_title_idx', 'modified app:db/books/fk:(author_id)->authors(id)', 'added app:db/loans/key:primary(id) (on loans)', 'added app:db/loans/fk:(book_id)->books(id) (on loans)', 'added app:db/recent'],
    'unplanned: what the branch changed against its base that no change of the delta covers, each named as a target (a change built another way, a rename\'s two names count as covered); on a table the delta adds, the key and the foreign key its `add` does not state')
  eq(s.counts, { changes: 17, 'planned-built': 7, pending: 8, 'built-differently': 2, acked: 1, stale: 1, unacked: 15, unplanned: 6 }, '… counted')

  // a planned table built with more than its `add` states: the table is planned and built, every part
  // beyond it (a column, a key, an index, a cascading foreign key) is unplanned, as any change of the
  // branch outside the delta: reported, never a failure. A part another change of the delta adds is
  // covered by it.
  {
    const B0 = 'CREATE TABLE authors (id INTEGER PRIMARY KEY);'
    const B1 = `${B0}
CREATE TABLE loans (id INTEGER PRIMARY KEY, a_id INTEGER REFERENCES authors(id) ON DELETE CASCADE, due TEXT, note TEXT, shelf TEXT);
CREATE INDEX loans_due_idx ON loans (due);
CREATE INDEX loans_shelf_idx ON loans (shelf);`
    const b0 = modelOf(B0), b1 = modelOf(B1)
    const fields = [{ name: 'id', type: 'INTEGER', nullable: true }, { name: 'a_id', type: 'INTEGER', nullable: true }, { name: 'due', type: 'TEXT', nullable: true }]
    const shelf = ch('shelf-idx', 'add', 'app:db/loans/index:loans_shelf_idx', { after: { columns: ['shelf'] } })
    const only = { schema: 1, spec: 's', architecture: [], data: [ch('loans', 'add', 'app:db/loans', { after: { fields } }), ch('shelf', 'add', 'app:db/loans.shelf', { after: { type: 'TEXT', nullable: true } }), shelf] }
    const r = deltaStates(only, b1, { base: b0, diff: diffModels(b0, b1) })
    eq([r.changes.map(line), r.unplanned.map((u) => `${u.c.kind} ${u.target} on ${u.on}`)], [
      ['loans planned-built', 'shelf planned-built', 'shelf-idx planned-built'],
      ['field app:db/loans.note on loans', 'key app:db/loans/key:primary(id) on loans', 'index app:db/loans/index:loans_due_idx on loans', 'relation app:db/loans/fk:(a_id)->authors(id) on loans'],
    ], 'a table added with fields only, built with a key, an index, a cascading foreign key and one more column: the table is planned and built, and the four parts it does not state are unplanned, each named as a target (the column and the index other changes add are theirs)')
    const stated = { ...only, data: [ch('loans', 'add', 'app:db/loans', { after: { fields: [...fields, { name: 'note', type: 'TEXT', nullable: true }, { name: 'shelf', type: 'TEXT', nullable: true }], keys: [{ role: 'primary', parts: ['id'] }], indexes: [{ name: 'loans_due_idx', columns: ['due'] }, { name: 'loans_shelf_idx', columns: ['shelf'] }], relations: [{ columns: ['a_id'], to: 'authors', toColumns: ['id'], onDelete: 'restrict' }] } })] }
    const r2 = deltaStates(stated, b1, { base: b0, diff: diffModels(b0, b1) })
    eq([r2.changes.map(line), r2.unplanned.length], [['loans built-differently [foreign key (a_id) → authors on delete: restrict → cascade]'], 0],
      'the same table with its keys, indexes and foreign keys stated: nothing unplanned, and a foreign key built with another action is built differently (planned → built)')
    eq(deltaStates(only, b1).unplanned, [], 'with no base there is no branch to compare: the parts are not listed')
    const old = deltaStates(only, b1, { base: b1, diff: diffModels(b1, b1) })
    eq(old.unplanned, [], 'a table already at the base is not one the branch adds: its parts are not the branch\'s')
  }
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
  const SHARED = '{\n  "schema": 1, "spec": "docs/specs/x-design.md",\n  "data": [\n    {\n      "id": "one", "op": "remove",\n      "target": "app:db/old",\n      "why": "gone", "origin": "planned"\n    }\n  ],\n  "architecture": []\n}\n'
  const shared = setAcks(SHARED, new Map([[0, A]]))
  eq(shared.split('\n'), ['{', '  "schema": 1, "spec": "docs/specs/x-design.md",', '  "data": [', '    {', '      "id": "one", "op": "remove",', '      "target": "app:db/old",', '      "why": "gone", "origin": "planned",', '      "ack": {', '        "by": "Cy",', '        "at": "2026-11-06T12:00:00.000Z",', '        "hash": "abcdef0123456789"', '      }', '    }', '  ],', '  "architecture": []', '}', ''],
    'members sharing a line: the ack goes in at that line\'s indentation, every other line kept byte for byte')
  const long = parseDelta(JSON.stringify({ schema: 1, spec: 's', data: [{ id: 'a', op: `grow\n${'x'.repeat(500)}`, target: 'app:db/t', why: 'w', origin: 'planned' }], architecture: [] })).errors[0]
  ok(long.length < 200 && !long.includes('\n') && long.startsWith('data[0] (a): op "grow\\n'), `a value echoed in a problem is cut short and shown escaped (${long})`)

  // appending: the unplanned changes an implementer kept, written by the loop's ship step
  const kept = (id, target, after, extra = {}) => ({ id, op: 'add', target, after, why: `kept: ${id}`, origin: 'unplanned', slice: 2, ...extra })
  const sub = kept('unplanned-PROJ-1-1', 'app:db/books.subtitle', { type: 'TEXT', nullable: true })
  const ap = appendChanges(FILE, [sub, kept('one', 'app:db/books.isbn', { type: 'TEXT', nullable: true }), kept('bad', 'app:db/books.x', { type: 'TEXT' }), { ...kept('planned', 'app:db/books.y', { type: 'TEXT', nullable: true }), origin: 'planned' }, { ...kept('acked', 'app:db/books.z', { type: 'TEXT', nullable: true }), ack: A }])
  eq([ap.added, ap.already, ap.refused, ap.errors], [['unplanned-PROJ-1-1'], ['one'], [{ id: 'bad', errors: ['after: a column needs its nullable'] }, { id: 'planned', errors: ['origin "planned": only an unplanned change is appended'] }, { id: 'acked', errors: ['ack: an appended change is not acknowledged yet'] }], []],
    'appending: a new unplanned change goes in; an id the file holds is left out (a ship sent again); one that would not validate, one planned or one acknowledged is refused with why, and the others still go in')
  eq([JSON.parse(ap.text).data.map((c) => c.id), parseDelta(ap.text).errors], [['one', 'two', 'three', 'four', 'unplanned-PROJ-1-1'], []], '… after the last change, and the file still validates')
  ok(ap.text.startsWith(FILE.slice(0, FILE.indexOf('{"id": "four"'))) && ap.text.includes('{"id": "four", "op": "remove", "target": "app:db/older", "why": "gone too", "origin": "planned"},\n    { "id": "unplanned-PROJ-1-1", "op": "add", "target": "app:db/books.subtitle", "after": { "type": "TEXT", "nullable": true }, "why": "kept: unplanned-PROJ-1-1", "origin": "unplanned", "slice": 2 }\n  ],'),
    '… every byte before it kept; written on one line, as the change before it is, at its indentation')
  const spreadOut = appendChanges(FILE.replace('    {"id": "four", "op": "remove", "target": "app:db/older", "why": "gone too", "origin": "planned"}', '    {\n      "id": "four",\n      "op": "remove",\n      "target": "app:db/older",\n      "why": "gone too",\n      "origin": "planned"\n    }'), [sub]).text
  ok(spreadOut.includes('      "origin": "planned"\n    },\n    {\n      "id": "unplanned-PROJ-1-1",\n      "op": "add",\n      "target": "app:db/books.subtitle",\n      "after": {\n        "type": "TEXT",\n        "nullable": true\n      },'), 'after a change spread over lines, spread the same way')
  const empty = appendChanges('{\n  "schema": 1,\n  "spec": "s",\n  "data": [],\n  "architecture": []\n}\n', [sub]).text
  eq([empty.split('\n').slice(3, 6), JSON.parse(empty).data.length, empty.endsWith('  "architecture": []\n}\n')], [['  "data": [', '    {', '      "id": "unplanned-PROJ-1-1",'], 1, true], 'into an empty list: spread, in the file\'s indentation, the rest kept')
  eq([appendChanges(FILE, [kept('one', 'x', {})]).text === FILE, appendChanges('{"schema":1,"spec":"s","data":{},"architecture":[]}', [sub]).errors.length > 0, appendChanges('{"schema":1,"spec":"s","data":{},"architecture":[]}', [sub]).text],
    [true, true, null], 'nothing new: the text as it was; a delta that does not validate: its problems, nothing written')

  // the CLI the ship step runs: under a lock beside the file, through a temporary file renamed over it
  const DIR = mkdtempSync(path.join(tmpdir(), 'grim-delta-'))
  try {
    const dfile = path.join(DIR, 'x.delta.json'), cfile = (n, list) => { const f = path.join(DIR, `c${n}.json`); writeFileSync(f, JSON.stringify(list)); return f }
    const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'delta-append.mjs'), ...a], { encoding: 'utf8' })
    eq(cli(dfile, cfile(0, [sub])).stdout, 'DELTA none\n', 'no delta at that path: DELTA none, nothing written')
    writeFileSync(dfile, FILE)
    eq(cli(dfile, cfile(1, [sub, kept('bad', 'app:db/books.x', { type: 'TEXT' })])).stdout, 'DELTA ok added=1 already=0 refused=1\nDELTA refused bad: after: a column needs its nullable\n', 'DELTA ok with its counts, then each refusal')
    eq(cli(dfile, cfile(2, [sub])).stdout, 'DELTA ok added=0 already=1 refused=0\n', 'sent again: nothing written twice')
    eq(readdirSync(DIR).filter((f) => !/^c\d\.json$/.test(f)), ['x.delta.json'], 'no lock and no temporary file left behind')
    // two ships of two repositories at once: both changes written, neither lost
    const both = await Promise.all([3, 4].map((n) => new Promise((res) => { const p = spawn(process.execPath, [path.join(ROOT, 'delta-append.mjs'), dfile, cfile(n, [kept(`k${n}`, `app:db/books.k${n}`, { type: 'TEXT', nullable: true })])]); let o = ''; p.stdout.on('data', (x) => (o += x)); p.on('close', () => res(o)) })))
    eq([both, JSON.parse(readFileSync(dfile, 'utf8')).data.map((c) => c.id).slice(-3).sort()], [['DELTA ok added=1 already=0 refused=0\n', 'DELTA ok added=1 already=0 refused=0\n'], ['k3', 'k4', 'unplanned-PROJ-1-1']], 'two writers at once: one after the other under the lock, both changes in the file')
    // the lock `serve` takes to write an acknowledgement (lib/data/delta-lock.mjs): the append waits for it
    mkdirSync(`${dfile}.lock`)
    const t0 = Date.now()
    const waiting = new Promise((res) => { const p = spawn(process.execPath, [path.join(ROOT, 'delta-append.mjs'), dfile, cfile(6, [kept('k6', 'app:db/books.k6', { type: 'TEXT', nullable: true })])]); let o = ''; p.stdout.on('data', (x) => (o += x)); p.on('close', () => res(o)) })
    await new Promise((res) => setTimeout(res, 400))
    const untouched = !JSON.parse(readFileSync(dfile, 'utf8')).data.some((c) => c.id === 'k6')
    rmSync(`${dfile}.lock`, { recursive: true })
    eq([await waiting, untouched, Date.now() - t0 >= 400, JSON.parse(readFileSync(dfile, 'utf8')).data.some((c) => c.id === 'k6'), existsSync(`${dfile}.lock`)], ['DELTA ok added=1 already=0 refused=0\n', true, true, true, false], 'the lock an acknowledgement holds: the append waits for it, then writes, and leaves no lock')
    writeFileSync(dfile, '{"schema": 2}')
    ok(cli(dfile, cfile(5, [sub])).stdout.startsWith('DELTA bad the delta does not validate: '), 'a delta that does not validate: DELTA bad, the file left as it is')
    // a delta document as the changes (the loop merging a run branch whose delta changed on both sides,
    // #97): the other version's unplanned changes, appended without their acknowledgement; its planned
    // ones and those already there left out
    writeFileSync(dfile, FILE)
    const acked = kept('o1', 'app:db/books.o1', { type: 'TEXT', nullable: true }, { ack: { by: 't', at: '2026-11-07', hash: 'h' } })
    const theirs = path.join(DIR, 'theirs.delta.json')
    writeFileSync(theirs, JSON.stringify({ ...JSON.parse(FILE), data: [...JSON.parse(FILE).data, sub, acked], architecture: [kept('a1', 'connection:web->api', { label: 'calls' })] }))
    writeFileSync(dfile, appendChanges(FILE, [sub]).text)
    const after = () => JSON.parse(readFileSync(dfile, 'utf8'))
    eq([cli(dfile, theirs).stdout, after().data.slice(-1), after().architecture.map((c) => c.id)], ['DELTA ok added=2 already=1 refused=0\n', [{ id: 'o1', op: 'add', target: 'app:db/books.o1', after: { type: 'TEXT', nullable: true }, why: 'kept: o1', origin: 'unplanned', slice: 2 }], ['a1']],
      "a delta document: its unplanned changes from both lists, the acknowledged one without its acknowledgement, one already there skipped, its planned ones never")
  } finally { rmSync(DIR, { recursive: true, force: true }) }
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
    const said = sp.find((n) => n.attrs && n.attrs['data-status-for'] === 'delta-ack-sall')
    ok(calls[1].body.base === 'h2' && calls[1].body.ids.join(',') === 'isbn,loans,legacy,hostile' && !!said && sp.textOf(said).startsWith('Not saved: the delta changed on disk since this page was loaded') && !!sp.ctl('delta-reload') && !sp.all((n) => n.attrs && /callout/.test(n.attrs.class || '') && sp.textOf(n).includes('changed on disk')).length,
      'a refused write (the file changed since): said beside the control pressed, with a Reload, not as a banner over the tab; the store control sends every change not acknowledged')
    const store = new Map(), session = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
    const sr = await stubPage(served, '#data-0', { fetch, sessionStorage: session })
    sr.press('data-delta')
    answer = () => ({ status: 409, j: { error: 'changed on disk since it was loaded', text: '{}', hash: 'h3' } })
    await sr.pressed('delta-ack-l3')
    sr.press('delta-reload')
    const kept = store.get('grimoire-delta')
    ok(sr.reloads() === 1 && JSON.parse(kept).dataDelta === true && JSON.parse(kept).delta === 'docs/specs/2026-11-06-reading.delta.json' && JSON.parse(kept).store === 0, `Reload keeps the overlay, the delta and the store for the page it reloads (${kept})`)
    store.set('grimoire-delta', JSON.stringify({ dataDelta: true, deltaSel: 1, delta: 'docs/specs/2026-10-01-old.delta.json', store: 0 }))
    const again = await stubPage(served, '#data-0', { fetch, sessionStorage: session })
    ok(again.ctl('data-delta').attrs['aria-pressed'] === 'true' && again.ctl('data-delta-file').kids[1].attrs.selected === 'selected' && again.text().includes('docs/specs/2026-10-01-old.delta.json does not validate') && !store.has('grimoire-delta'),
      '… and the reloaded page opens with the Delta overlay on and the same delta chosen, once')
    const plain = await stubPage(served, '#data-0', { fetch, sessionStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() {} } })
    ok(plain.ctl('data-delta').attrs['aria-pressed'] === 'false', 'a session store that throws changes nothing')
    const scr = scriptOf(served)
    ok(!/<!--|<script/i.test(scr) && /connect-src 'self'/.test(served) && !/connect-src/.test(page), 'the page script stays clean; only the served page may connect back to its server')
  } catch (e) { ok(false, `the delta overlay renders (${e.stack})`) } finally { rmSync(DIR, { recursive: true, force: true }) }
}

// ── 18 · key-value tables declared (JSON) ──
console.log('\n18 · key-value tables declared: CreateTable inputs and CloudFormation templates, JSON (readers/dynamodb.mjs)')
const { default: dynamodbTable } = await import('../lib/data/extractors/dynamodb-table.mjs')
const { default: cloudformation } = await import('../lib/data/extractors/cloudformation.mjs')
const { inspect, plan } = await import('../lib/data/registry.mjs')
const { storeSummary } = await import('../lib/data/reconcile.mjs')
// a local-dev table file in CreateTable's shape (aws dynamodb create-table --cli-input-json)
const KV_LOCAL = `{
  "TableName": "loans",
  "BillingMode": "PAY_PER_REQUEST",
  "AttributeDefinitions": [
    { "AttributeName": "memberId", "AttributeType": "S" },
    { "AttributeName": "loanId", "AttributeType": "S" },
    { "AttributeName": "bookId", "AttributeType": "S" },
    { "AttributeName": "dueAt", "AttributeType": "N" },
    { "AttributeName": "branchId", "AttributeType": "S" }
  ],
  "KeySchema": [
    { "AttributeName": "memberId", "KeyType": "HASH" },
    { "AttributeName": "loanId", "KeyType": "RANGE" }
  ],
  "GlobalSecondaryIndexes": [
    {
      "IndexName": "ByBook",
      "KeySchema": [{ "AttributeName": "bookId", "KeyType": "HASH" }, { "AttributeName": "dueAt", "KeyType": "RANGE" }],
      "Projection": { "ProjectionType": "ALL" }
    },
    {
      "IndexName": "ByBranch",
      "KeySchema": [{ "AttributeName": "branchId", "KeyType": "HASH" }],
      "Projection": { "ProjectionType": "KEYS_ONLY" }
    }
  ],
  "TimeToLiveSpecification": { "AttributeName": "expiresAt", "Enabled": false }
}`
// the same table in a CloudFormation template, beside a table named by a reference and a queue
const KV_TEMPLATE = `{
  "AWSTemplateFormatVersion": "2010-09-09",
  "Parameters": { "Stage": { "Type": "String" } },
  "Resources": {
    "LoanEvents": { "Type": "AWS::SQS::Queue", "Properties": { "QueueName": "loan-events" } },
    "LoansTable": {
      "Type": "AWS::DynamoDB::Table",
      "Properties": {
        "TableName": "loans",
        "BillingMode": "PAY_PER_REQUEST",
        "AttributeDefinitions": [
          { "AttributeName": "memberId", "AttributeType": "S" },
          { "AttributeName": "loanId", "AttributeType": "S" },
          { "AttributeName": "bookId", "AttributeType": "S" },
          { "AttributeName": "dueAt", "AttributeType": "N" }
        ],
        "KeySchema": [
          { "AttributeName": "memberId", "KeyType": "HASH" },
          { "AttributeName": "loanId", "KeyType": "RANGE" }
        ],
        "GlobalSecondaryIndexes": [
          {
            "IndexName": "ByBook",
            "KeySchema": [{ "AttributeName": "bookId", "KeyType": "HASH" }, { "AttributeName": "dueAt", "KeyType": "RANGE" }],
            "Projection": { "ProjectionType": "INCLUDE", "NonKeyAttributes": ["title", "dueAt"] }
          }
        ],
        "TimeToLiveSpecification": { "AttributeName": "expiresAt", "Enabled": true },
        "StreamSpecification": { "StreamViewType": "NEW_AND_OLD_IMAGES" }
      }
    },
    "HoldsTable": {
      "Type": "AWS::DynamoDB::Table",
      "Properties": {
        "TableName": { "Fn::Sub": "\${Stage}-holds" },
        "AttributeDefinitions": [{ "AttributeName": "bookId", "AttributeType": "S" }, { "AttributeName": "tenant", "AttributeType": "S" }, { "AttributeName": "region", "AttributeType": "S" }, { "AttributeName": "placedAt", "AttributeType": "N" }],
        "KeySchema": [{ "AttributeName": "bookId", "KeyType": "HASH" }],
        "ProvisionedThroughput": { "ReadCapacityUnits": 5, "WriteCapacityUnits": 5 },
        "GlobalSecondaryIndexes": [{ "IndexName": "ByTenantRegion", "KeySchema": [{ "AttributeName": "tenant", "KeyType": "HASH" }, { "AttributeName": "region", "KeyType": "HASH" }, { "AttributeName": "placedAt", "KeyType": "RANGE" }], "Projection": { "ProjectionType": "KEYS_ONLY" } }],
        "LocalSecondaryIndexes": { "Fn::If": ["IsProd", [], { "Ref": "AWS::NoValue" }] }
      }
    }
  }
}`
// a table as a line: its keys, attributes, indexes, billing, stream, each element at its line
const kvTable = (e) => [`${e.name}@${e.line} ${e.billing} stream=${e.stream} whole=${e.whole}${e.as ? ` as ${e.as}` : ''}`,
  ...e.keys.map((k) => `  ${k.role}(${k.parts.join(',')})${k.role === 'ttl' ? ` enabled=${k.enabled}` : ''} @${k.line}`),
  ...e.fields.map((f) => `  ${f.name} ${f.type} ${f.nullable ? 'nullable' : 'not null'} @${f.line}`),
  ...e.indexes.map((i) => `  ${i.kind} ${i.name} (${i.partition.join(',')})(${i.sort.join(',')}) ${i.projection}${i.include.length ? ` [${i.include.join(',')}]` : ''} @${i.line}`)]
{
  const local = dynamodbTable.extract(KV_LOCAL, 'seed/loans.json').declarations
  eq(local.map((d) => [d.store, d.dialect, d.label, d.source.kind, d.source.path, d.complete, d.notes]), [['dynamodb', 'dynamodb', 'CreateTable input', 'infra', 'seed/loans.json', false, []]],
    'a CreateTable input: one declaration of the repository\'s key-value store, describing that table and not the whole store')
  eq(kvTable(local[0].entities[0]), [
    'loans@2 PAY_PER_REQUEST stream=null whole=true',
    '  partition(memberId) @12', '  sort(loanId) @13', '  ttl(expiresAt) enabled=false @27',
    '  memberId S not null @5', '  loanId S not null @6', '  bookId S nullable @7', '  dueAt N nullable @8', '  branchId S nullable @9',
    '  gsi ByBook (bookId)(dueAt) ALL @16', '  gsi ByBranch (branchId)() KEYS_ONLY @21',
  ], 'its keys (HASH → partition, RANGE → sort), the TTL and whether it is on, the attributes typed S/N/B (not null when they key the table), each GSI with its keys and projection, billing and stream, each at its line')

  const tpl = cloudformation.extract(KV_TEMPLATE, 'infra/template.json').declarations
  eq(tpl.map((d) => [d.store, d.label, d.source.line]), [['dynamodb', 'CloudFormation template, 2 tables', 6]], 'a CloudFormation template: its table resources, every other resource (a queue) left alone')
  eq(tpl[0].entities.map(kvTable), [[
    'loans@6 PAY_PER_REQUEST stream=NEW_AND_OLD_IMAGES whole=true as LoansTable (AWS::DynamoDB::Table)',
    '  partition(memberId) @18', '  sort(loanId) @19', '  ttl(expiresAt) enabled=true @28',
    '  memberId S not null @12', '  loanId S not null @13', '  bookId S nullable @14', '  dueAt N nullable @15',
    '  gsi ByBook (bookId)(dueAt) INCLUDE [title,dueAt] @22',
  ], [
    'HoldsTable@32 PROVISIONED stream=null whole=false as HoldsTable (AWS::DynamoDB::Table), TableName !Sub ${Stage}-holds',
    '  partition(bookId) @37',
    '  bookId S not null @36', '  tenant S nullable @36', '  region S nullable @36', '  placedAt N nullable @36',
    '  gsi ByTenantRegion (tenant,region)(placedAt) KEYS_ONLY @39',
  ]], 'a table named by its literal TableName; one whose TableName is a reference named by its logical id, its name expression kept as written; a multi-attribute GSI key; billing implied by ProvisionedThroughput')
  eq(tpl[0].notes, [
    'HoldsTable: its TableName is !Sub ${Stage}-holds, a reference, not resolved: named by its logical id',
    'HoldsTable: LocalSecondaryIndexes is !If [IsProd, [], !Ref AWS::NoValue], a reference, not resolved',
  ], 'intrinsic functions (long form) are kept as references in short form and never evaluated; a part stated by one is not read, and the table is not whole')

  // found by content, not by name
  eq([inspect('infra/template.json', KV_TEMPLATE), inspect('seed/loans.json', KV_LOCAL), inspect('config/settings.json', '{ "name": "loans", "keys": [] }'), inspect('ci/build.yml', 'on: push'), inspect('db/0001.sql', 'CREATE TABLE t (id int);')], [3, 2, 0, 0, 2],
    'inspect: a JSON or YAML text naming a table resource type is a template (3), one with a KeySchema and AttributeDefinitions a CreateTable input (2), any other none (0); SQL keeps its schema level')
  const jobs = plan(new Map([['seed/loans.json', { ddl: 2 }], ['infra/template.json', { ddl: 3 }], ['config/settings.json', { ddl: 0 }], ['dynamodb/tables/notes.json', { ddl: 0 }], ['svc/stack.yaml', { ddl: 3 }], ['local/tables.yml', { ddl: 2 }]]))
  eq(jobs.map((j) => `${j.extractor.id} ${j.key}`), ['dynamodb-table seed/loans.json', 'dynamodb-table local/tables.yml', 'cloudformation infra/template.json', 'cloudformation svc/stack.yaml'],
    'discovery goes by what inspect found, whatever the file is called (a `dynamodb/tables/` file declaring no table is no job)')
  eq(candidates(['seed/loans.json', 'svc/template.yaml', 'svc/x.yml', 'cfn/stack.template', 'README.md', 'tests/fixtures/t.json', 'node_modules/p/t.json', 'package-lock.json'], { exclude: [] }), ['seed/loans.json', 'svc/template.yaml', 'svc/x.yml', 'cfn/stack.template'],
    'every JSON, YAML and .template file is a candidate, but for test folders, dependencies and lock files')
  eq(dynamodbTable.extract('[{ "TableName": "a", "KeySchema": [{ "AttributeName": "id", "KeyType": "HASH" }], "AttributeDefinitions": [{ "AttributeName": "id", "AttributeType": "S" }] }, { "KeySchema": [], "AttributeDefinitions": [] }]', 'x.json').declarations.map((d) => [d.label, d.entities.map((e) => e.name), d.notes]),
    [['CreateTable input', ['a'], ['a key schema with no TableName at line 1: not read']]], 'a list of CreateTable inputs: each table read; a key schema with no TableName noted, not read')
  eq(dynamodbTable.extract('{ "TableName": "c", "KeySchema": [{ "AttributeName": "id", "KeyType": "HASH" }], "AttributeDefinitions": [{ "AttributeName": "id", "AttributeType": "S" }, { "AttributeName": "created_at", "AttributeType": "S" }] }', 'c.json').declarations[0].notes,
    ['c: created_at is in AttributeDefinitions and keys neither the table nor an index'], 'an attribute defined that keys nothing is noted, a lead (CreateTable takes key attributes only)')
  eq(dynamodbTable.extract('{ "Table": { "TableName": "b", "KeySchema": [{ "AttributeName": "k", "KeyType": "HASH" }], "AttributeDefinitions": [{ "AttributeName": "k", "AttributeType": "N" }], "BillingModeSummary": { "BillingMode": "PROVISIONED" }, "StreamSpecification": { "StreamEnabled": false, "StreamViewType": "KEYS_ONLY" } } }', 'y.json').declarations[0].entities.map((e) => [e.name, e.billing, e.stream]),
    [['b', 'PROVISIONED', null]], 'describe-table\'s answer ({ Table }) reads the same; a stream not enabled is no stream')

  // two declarations of one table: both kept, their differences conflicts
  const rows = (...files) => files.map(([ex, text, file]) => ({ repo: 'app', extractor: `${ex.id}@1`, facts: ex.extract(text, file) }))
  const kv = reconcile(rows([dynamodbTable, KV_LOCAL, 'seed/loans.json'], [cloudformation, KV_TEMPLATE, 'infra/template.json']))
  const [kst] = kv.stores
  eq([kv.stores.length, kst.id, kst.dialect, kst.entities.map((e) => e.name), storeSummary(kst)], [1, 'app:dynamodb', 'dynamodb', ['HoldsTable', 'loans'], '2 tables · 3 GSIs · 5 conflicts'],
    'a CreateTable input and a template stating the same TableName are two declarations of one table, in one store per repository')
  const loans = kst.entities[1]
  eq(loans.sources.map((s) => `${s.path}:${s.line} ${s.kind} ${s.extractor}${s.as ? ` ${s.as}` : ''}`), ['infra/template.json:6 infra cloudformation@1 LoansTable (AWS::DynamoDB::Table)', 'seed/loans.json:2 infra dynamodb-table@1'],
    'the table cites both declarations, each labelled with its kind and how it names the table')
  eq(everyConflict(kst), [
    'loans stream: NEW_AND_OLD_IMAGES @ infra/template.json:6 | null @ seed/loans.json:2',
    'loans.branchId presence: declared @ seed/loans.json:9 | absent @ infra/template.json:6',
    'loans ttl (expiresAt) enabled: true @ infra/template.json:28 | false @ seed/loans.json:27',
    'loans index ByBook projection: INCLUDE (dueAt, title) @ infra/template.json:22 | ALL @ seed/loans.json:16',
    'loans index ByBranch presence: declared @ seed/loans.json:21 | absent @ infra/template.json:6',
  ], 'their differences are conflicts, every side kept with its source: a stream on one side only, a GSI in one and not the other, a different projection, TTL on and off')
  const unsure = KV_TEMPLATE.replace(/"GlobalSecondaryIndexes": \[\n {10}\{[\s\S]*?\n {8}\],\n {8}"TimeToLive/, '"GlobalSecondaryIndexes": { "Fn::If": ["IsProd", [], []] },\n        "TimeToLive')
  eq(everyConflict(reconcile(rows([dynamodbTable, KV_LOCAL, 'seed/loans.json'], [cloudformation, unsure, 'infra/template.json'])).stores[0]).filter((c) => /index/.test(c)), [],
    'a table whose GSIs are stated by a reference is not whole: the GSIs it seems to lack are no disagreement')

  // the diff: elements identified by name (a table, an index), a key by its role and attributes
  const base = reconcile(rows([cloudformation, KV_TEMPLATE, 'infra/template.json']))
  const BRANCH = KV_TEMPLATE.replace('"StreamViewType": "NEW_AND_OLD_IMAGES"', '"StreamViewType": "NEW_IMAGE"').replace(',\n        "TimeToLiveSpecification": { "AttributeName": "expiresAt", "Enabled": true }', '')
    .replace('"Projection": { "ProjectionType": "INCLUDE", "NonKeyAttributes": ["title", "dueAt"] }\n          }', '"Projection": { "ProjectionType": "ALL" }\n          },\n          { "IndexName": "ByBranch", "KeySchema": [{ "AttributeName": "branchId", "KeyType": "HASH" }], "Projection": { "ProjectionType": "KEYS_ONLY" } }')
    .replace('{ "AttributeName": "dueAt", "AttributeType": "N" }\n', '{ "AttributeName": "dueAt", "AttributeType": "N" },\n          { "AttributeName": "branchId", "AttributeType": "S" }\n')
  const branch = reconcile(rows([cloudformation, BRANCH, 'infra/template.json']))
  const kd = diffModels(base, branch)
  eq(changeLines(kd), [
    'app:dynamodb modified',
    '  ~ entity loans  stream: NEW_AND_OLD_IMAGES → NEW_IMAGE',
    '  + field loans branchId',
    '  - key loans ttl (expiresAt)',
    '  ~ index loans ByBook  projection: INCLUDE (dueAt, title) → ALL',
    '  + index loans ByBranch',
  ], 'graph_changes for a key-value table: its stream, an attribute, its TTL, a GSI\'s projection, a GSI added, each by its identity')

  // the delta: targets address them the way the diff identifies them
  eq(['app:dynamodb/loans/index:ByBook', 'app:dynamodb/HoldsTable/key:partition(bookId)', 'app:dynamodb/loans/key:ttl(expiresAt)', 'app:dynamodb/loans.branchId'].map((t) => { const p = parseTarget(t); return `${p.storeId} ${p.entity} ${p.kind} ${JSON.stringify(p.el)}` }),
    ['app:dynamodb loans index {"name":"ByBook"}', 'app:dynamodb HoldsTable key {"role":"partition","parts":["bookId"]}', 'app:dynamodb loans key {"role":"ttl","parts":["expiresAt"]}', 'app:dynamodb loans field {"name":"branchId"}'],
    'targets: a GSI or an LSI is index:<name>, a key key:partition(…), key:sort(…) or key:ttl(<attribute>), an attribute <table>.<attribute>')
  const all = kst.entities.flatMap((e) => [['entity', e, e], ...e.fields.map((x) => ['field', e, x]), ...e.keys.map((x) => ['key', e, x]), ...e.indexes.map((x) => ['index', e, x])])
  const round = all.map(([kind, e, x]) => { const t = targetOf(kst.id, e.name, kind, x); return findTarget(kv, parseTarget(t)).el === x ? 'ok' : `lost ${t}` })
  ok(round.length === 18 && round.every((r) => r === 'ok'), `every element of a key-value store named by targetOf resolves back to itself (${round.filter((r) => r !== 'ok').join(', ') || `${round.length} elements`})`)
  ok(!findTarget(kv, parseTarget('app:dynamodb/Loans')).el, 'a key-value table\'s name is case-sensitive')
  const ch = (id, op, target, extra = {}) => ({ id, op, target, why: `why ${id}`, origin: 'planned', ...extra })
  const errs = (data) => parseDelta(JSON.stringify({ schema: 1, spec: 'docs/specs/x-design.md', data, architecture: [] })).errors
  eq(errs([
    ch('gsi', 'add', 'app:dynamodb/loans/index:ByBranch', { after: { kind: 'gsi', partition: ['branchId'], projection: 'KEYS_ONLY' } }),
    ch('lsi', 'add', 'app:dynamodb/loans/index:ByDue', { after: { kind: 'lsi', partition: ['memberId'], sort: ['dueAt'], projection: 'INCLUDE', include: ['title'] } }),
    ch('proj', 'change', 'app:dynamodb/loans/index:ByBook', { after: { projection: 'ALL' } }),
    ch('stream', 'change', 'app:dynamodb/loans', { after: { stream: 'NEW_IMAGE', billing: 'PROVISIONED' } }),
    ch('ttl-on', 'change', 'app:dynamodb/loans/key:ttl(expiresAt)', { after: { enabled: true } }),
    ch('ttl-add', 'add', 'app:dynamodb/HoldsTable/key:ttl(releasedAt)', { after: { enabled: true } }),
    ch('table', 'add', 'app:dynamodb/fines', { after: { fields: [{ name: 'fineId', type: 'S', nullable: false }], keys: [{ role: 'partition', parts: ['fineId'] }], indexes: [{ name: 'ByMember', kind: 'gsi', partition: ['memberId'] }], billing: 'PAY_PER_REQUEST', stream: null } }),
  ]), [], 'a delta addresses key-value elements in their own words: a GSI or LSI with its keys and projection, a table\'s billing and stream, a TTL on or off')
  eq(errs([
    ch('a', 'add', 'app:dynamodb/loans/index:X', { after: { kind: 'gsi', projection: 'ALL' } }),
    ch('b', 'add', 'app:dynamodb/loans/index:Y', { after: { kind: 'lsi', partition: ['memberId'] } }),
    ch('c', 'change', 'app:dynamodb/loans/index:ByBook', { after: { projection: 'SOME' } }),
    ch('d', 'change', 'app:dynamodb/loans', { after: { billing: 'FREE' } }),
    ch('e', 'change', 'app:dynamodb/loans/key:ttl(expiresAt)', { after: {} }),
    ch('f', 'change', 'app:dynamodb/loans/key:partition(memberId)', { after: { enabled: true } }),
  ]), [
    'data[0] (a): after: a GSI needs its partition',
    'data[1] (b): after: an LSI needs its sort',
    'data[2] (c): after: an index\'s projection "SOME" is not valid',
    'data[3] (d): after: a table\'s billing "FREE" is not valid',
    'data[4] (e): after: a TTL changes whether it is enabled ({ enabled })',
    'data[5] (f): a key has nothing to change: its columns are what it is (remove it and add the new one)',
  ], 'and is refused when it says what the element has not, or leaves out what it needs')
  const s = deltaStates({ data: [
    ch('ttl-off', 'remove', 'app:dynamodb/loans/key:ttl(expiresAt)'),
    ch('by-branch', 'add', 'app:dynamodb/loans/index:ByBranch', { after: { kind: 'gsi', partition: ['branchId'], projection: 'KEYS_ONLY' } }),
    ch('by-book', 'change', 'app:dynamodb/loans/index:ByBook', { after: { projection: 'ALL' } }),
    ch('stream', 'change', 'app:dynamodb/loans', { after: { stream: 'NEW_IMAGE' } }),
    ch('holds-stream', 'change', 'app:dynamodb/HoldsTable', { after: { stream: 'KEYS_ONLY' } }),
    ch('by-tenant', 'change', 'app:dynamodb/HoldsTable/index:ByTenantRegion', { after: { projection: 'ALL' }, before: { projection: 'KEYS_ONLY' } }),
  ] }, branch, { base, diff: kd })
  eq(s.changes.map((r) => `${r.id} ${r.state}${r.diffs.length ? ` ${r.diffs.map((x) => x.text).join('; ')}` : ''}${r.proposed.length ? ` proposed ${r.proposed.map((x) => x.text).join('; ')}` : ''}`), [
    'ttl-off planned-built', 'by-branch planned-built', 'by-book planned-built', 'stream planned-built',
    'holds-stream pending proposed stream: none → KEYS_ONLY', 'by-tenant pending proposed projection: KEYS_ONLY → ALL',
  ], 'states against the branch: a TTL removed, a GSI added in its planned shape, a projection and a stream changed as planned; the others pending, with what they propose')
  eq(s.unplanned.map((u) => u.target), ['app:dynamodb/loans.branchId'], '… and the attribute the branch added that no change states is unplanned')
}

// ── 19 · YAML through the pinned grammar ──
console.log('\n19 · YAML read through the pinned tree-sitter grammar (readers/yaml.mjs), and templates in YAML')
{
  const deps = await import('../lib/deps.mjs')
  if (!deps.findDeps()) {
    if (process.env.CI) { FAIL++; console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)') } else console.log('   - skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  } else {
    const { readYaml, TAG } = await import('../lib/data/readers/yaml.mjs')
    const { pathKey } = await import('../lib/data/readers/json-lines.mjs')
    const yp = await (await deps.loadRuntime({ install: false })).parserFor('yaml')
    ok(!!yp, "the pinned YAML grammar loads (its C++ scanner's operator new and delete renamed to the runtime's malloc and free)")
    const ctx = { yaml: (t) => readYaml(yp, t) }
    const one = (t) => readYaml(yp, t)[0].value
    eq(one(`plain: hello world
int: 42
hex: 0x1F
float: 1.5
on: true
nothing: ~
empty:
quoted: "a\\tb \\u0041 \\"q\\""
single: 'it''s'
folded: >
  one
  two

  three
literal: |-
  x
    y
flow: [a, 'b', 1, { k: v }]
block:
  - a
  - b: 1
    c: [2]
multi: first
  second
`), { plain: 'hello world', int: 42, hex: 31, float: 1.5, on: true, nothing: null, empty: null, quoted: 'a\tb A "q"', single: "it's", folded: 'one two\nthree\n', literal: 'x\n  y', flow: ['a', 'b', 1, { k: 'v' }], block: ['a', { b: 1, c: [2] }], multi: 'first second' },
    'scalars by the core schema (null, booleans, integers, floats; quoted ones strings, escapes applied), block scalars literal and folded with their chomping, flow and block collections, a plain scalar folded across lines')
    const anchored = one(`defaults: &defaults
  BillingMode: PAY_PER_REQUEST
  Tags: &tags [lending]
table:
  <<: *defaults
  BillingMode: PROVISIONED
again: *tags
both:
  <<: [*defaults, { Extra: 1 }]
`)
    eq(anchored, { defaults: { BillingMode: 'PAY_PER_REQUEST', Tags: ['lending'] }, table: { BillingMode: 'PROVISIONED', Tags: ['lending'] }, again: ['lending'], both: { BillingMode: 'PAY_PER_REQUEST', Tags: ['lending'], Extra: 1 } },
      'anchors and aliases; `<<` merges a mapping or a list of them, the mapping\'s own keys first')
    ok(anchored.again === anchored.defaults.Tags, 'an alias is the anchored value itself, not a copy (reading stays linear)')
    eq(one('ref: !Ref LoansTable\nsub: !Sub "${AWS::StackName}-holds"\natt: !GetAtt LoansTable.Arn\ncond: !If [IsProd, !Ref A, { Ref: B }]\nstr: !!str 123\nnum: !!int "7"\n'), {
      ref: { [TAG]: '!Ref', value: 'LoansTable' }, sub: { [TAG]: '!Sub', value: '${AWS::StackName}-holds' }, att: { [TAG]: '!GetAtt', value: 'LoansTable.Arn' },
      cond: { [TAG]: '!If', value: ['IsProd', { [TAG]: '!Ref', value: 'A' }, { Ref: 'B' }] }, str: '123', num: 7,
    }, 'a tag of its own (!Ref, !Sub, !GetAtt, !If) keeps its value under the tag, never interpreted; the core tags convert')
    const docs = readYaml(yp, '# first\na:\n  b: [x, y]\n---\nc: 1\n...\n---\n- d\n')
    eq(docs.map((d) => [d.value, d.line, d.lines.get(pathKey('a', 'b', 1)) ?? null]), [[{ a: { b: ['x', 'y'] } }, 2, 3], [{ c: 1 }, 5, null], [['d'], 8, null]],
      'several documents, each with its own value and lines: a member at the line of its key, a list item where it starts')
    const fails = (t) => { try { readYaml(yp, t); return 'read' } catch (e) { return e.message } }
    const laughs = ['a: &a [x, x, x, x, x, x, x, x, x, x]', ...'bcdefgh'.split('').map((c, i) => `${c}: &${c} [${Array(10).fill(`*${'abcdefgh'[i]}`).join(', ')}]`)].join('\n')
    eq([fails('a: [1, 2\nb: {'), fails('x: *nowhere'), fails(laughs)], ['the YAML does not parse at line 1', 'the YAML aliases *nowhere at line 1, which no anchor before it names', 'the YAML expands past 1000000 values (aliases and merges counted): not read'],
      'a text that does not parse, an alias to no anchor, and one expanding past the cap (a billion laughs) are refused, each saying why')

    // a SAM template in YAML: short-form tags, anchors, the other resources ignored
    const SAM = readFileSync(path.join(HERE, 'fixtures', 'kv', 'lending', 'template.yaml'), 'utf8')
    eq(inspect('lending/template.yaml', SAM), 3, 'found by content: the template names a table resource type')
    const sam = cloudformation.extract(SAM, 'template.yaml', ctx).declarations[0]
    eq([sam.label, sam.notes, sam.entities.map(kvTable)], ['SAM template, 2 tables', ['HoldsTable: its TableName is !Sub ${AWS::StackName}-holds, a reference, not resolved: named by its logical id'], [[
      'loans@16 PAY_PER_REQUEST stream=NEW_AND_OLD_IMAGES whole=true as LoansTable (AWS::DynamoDB::Table)',
      '  partition(memberId) @30', '  sort(loanId) @32', '  ttl(expiresAt) enabled=true @42',
      '  memberId S not null @21', '  loanId S not null @23', '  bookId S nullable @25', '  dueAt N nullable @27',
      '  gsi ByBook (bookId)(dueAt) INCLUDE [title,dueAt] @35',
    ], [
      'HoldsTable@49 PAY_PER_REQUEST stream=null whole=true as HoldsTable (AWS::DynamoDB::Table), TableName !Sub ${AWS::StackName}-holds',
      '  partition(bookId) @60', '  sort(placedAt) @62',
      '  bookId S not null @55', '  placedAt N not null @57',
    ]]], 'its two tables at their lines, the function and outputs beside them ignored; the billing an alias reuses; a TableName given by !Sub kept as written, the table named by its logical id')
    const sls = cloudformation.extract(`service: lending
provider:
  name: aws
resources:
  Resources:
    UsersTable:
      Type: AWS::DynamoDB::Table
      Properties:
        TableName: \${self:service}-users-\${sls:stage}
        AttributeDefinitions: [{ AttributeName: userId, AttributeType: S }]
        KeySchema: [{ AttributeName: userId, KeyType: HASH }]
        BillingMode: PAY_PER_REQUEST
---
Resources:
  Members:
    Type: AWS::Serverless::SimpleTable
    Properties:
      PrimaryKey: { Name: memberId, Type: String }
  Branches:
    Type: AWS::Serverless::SimpleTable
`, 'serverless.yml', ctx).declarations[0]
    eq([sls.label, sls.entities.map((e) => `${e.name} ${e.as} ${e.billing} ${e.keys.map((k) => `${k.role}(${k.parts})`)} ${e.fields.map((f) => `${f.name}:${f.type}`)}`), sls.notes], ['Serverless Framework resources and SAM template, 3 tables', [
      'UsersTable UsersTable (AWS::DynamoDB::Table), TableName ${self:service}-users-${sls:stage} PAY_PER_REQUEST partition(userId) userId:S',
      'Members Members (AWS::Serverless::SimpleTable) PAY_PER_REQUEST partition(memberId) memberId:S',
      'Branches Branches (AWS::Serverless::SimpleTable) PAY_PER_REQUEST partition(id) id:S',
    ], [
      'UsersTable: its TableName is ${self:service}-users-${sls:stage}, a reference, not resolved: named by its logical id',
      'Members: no TableName (the table is named at deploy): named by its logical id',
      'Branches: no TableName (the table is named at deploy): named by its logical id',
      "Branches: no PrimaryKey, so SAM's default: id, a string",
    ]], 'the Serverless Framework\'s resources.Resources with a ${…} variable kept as written; a second document; SAM SimpleTables, their PrimaryKey and SAM\'s documented defaults')
    const local = dynamodbTable.extract('TableName: fines\nAttributeDefinitions:\n  - { AttributeName: memberId, AttributeType: S }\nKeySchema:\n  - { AttributeName: memberId, KeyType: HASH }\n---\nTableName: holds\nAttributeDefinitions: [{ AttributeName: bookId, AttributeType: S }]\nKeySchema: [{ AttributeName: bookId, KeyType: HASH }]\n', 'local/tables.yml', ctx).declarations[0]
    eq([inspect('local/tables.yml', 'TableName: x\nKeySchema: []\nAttributeDefinitions: []\n'), local.label, local.entities.map((e) => `${e.name}@${e.line}`)], [2, 'CreateTable input, 2 tables', ['fines@1', 'holds@7']], 'CreateTable inputs in YAML (--cli-input-yaml), one per document')
    eq((() => { try { dynamodbTable.extract('TableName: x\nKeySchema: []\n', 'x.yml', {}); return 'read' } catch (e) { return e.message } })(), 'no YAML reader: the pinned YAML grammar did not load', 'without the grammar, a YAML file fails its job with the reason (graph_status says it), never read by guess')

    // hostile YAML: bounded time and size, each failure an error of its own
    const timed = (f) => { const t0 = Date.now(); let err = null, v; try { v = f() } catch (e) { err = String(e.message) } return { ms: Date.now() - t0, err, v } }
    const SLOW = 4000
    const { YAML_MAX } = await import('../lib/data/readers/yaml.mjs')
    for (const [what, text] of [['a block scalar header followed by 500 000 blanks', `a: |${' '.repeat(500000)}\n  x\n`], ['a double-quoted scalar of 500 000 blanks, then a break', `a: "${' '.repeat(500000)}x\n  y"\n`], ['a single-quoted one', `a: '${' '.repeat(500000)}x\n  y'\n`]]) {
      const r = timed(() => readYaml(yp, text))
      ok(r.ms < SLOW && r.err === null, `${what}: read in linear time (${r.ms} ms)`)
    }
    const docs20k = Array.from({ length: 20000 }, (_, i) => `---\nk: ${i}`).join('\n') + '\n'
    const many = timed(() => readYaml(yp, docs20k))
    ok(many.ms < SLOW && many.v.length === 20000, `20 000 documents read in bounded time (${many.ms} ms)`)
    const big = `Resources: {}\n# ${'x'.repeat(YAML_MAX)}\n`
    const capped = timed(() => readYaml(yp, big))
    ok(capped.ms < SLOW && capped.err === `the YAML is larger than ${YAML_MAX >> 10} KB: not read`, `a YAML text past ${YAML_MAX >> 10} KB is refused before it is parsed (${capped.ms} ms)`)
    const wide = timed(() => readYaml(yp, `[${Array.from({ length: 110000 }, () => '*a').join(', ')}]`.replace('[', '[&a [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], ')))
    ok(wide.ms < SLOW && /expands past|nests|aliases/.test(wide.err || ''), `aliases past the cap are refused, counted before the nodes are walked (${wide.ms} ms: ${wide.err})`)
    eq(timed(() => readYaml(yp, 'a: 1\n', { deadline: Date.now() - 1 })).err, 'the YAML took too long to read: not read', 'reading past its deadline stops with an error of its own (the index stores it with the file\'s hash and skips the file until it changes)')
    const { parseAside } = await import('../lib/data/readers/yaml-aside.mjs')
    const good = 'Resources:\n  T:\n    Type: AWS::DynamoDB::Table\n'
    const aside = parseAside([docs20k, good, big], { timeout: (t) => (t === docs20k ? 1 : 30000) })
    eq([...aside.values()].map((v) => (v instanceof Error ? v.message : `${v.length} document`)), ['the YAML took longer than 1 ms to read: not read', '1 document', `the YAML is larger than ${YAML_MAX >> 10} KB: not read`],
      'parsed aside, one text per process: one that times out fails alone, the others still read, one past the cap is refused without a process')
  }
}

// ── 21 · hostile files, and declarations that move ──
console.log('\n21 · key-value declarations: hostile files read in bounded time, a declaration that moves or splits')
{
  const { jsonLines } = await import('../lib/data/readers/json-lines.mjs')
  const { isRef } = await import('../lib/data/readers/dynamodb.mjs')
  // the time a call takes, and what it threw (never a fatal error: each is caught, the process lives)
  const timed = (f) => { const t0 = Date.now(); let err = null; try { f() } catch (e) { err = String(e.message) } return { ms: Date.now() - t0, err } }
  const SLOW = 4000 // generous, for a loaded machine: the quadratic versions took tens of seconds or died
  const MARK = '"KeySchema":1,"AttributeDefinitions":2,'
  const deep = timed(() => dynamodbTable.extract(`{${MARK}"a":${'['.repeat(100000)}${']'.repeat(100000)}}`, 'deep.json'))
  ok(deep.ms < SLOW && deep.err === 'the JSON nests deeper than 200 levels at line 1: not read', `a JSON nested 100 000 deep is refused, an error of its own, in bounded time (${deep.ms} ms: ${deep.err})`)
  const shallow = timed(() => jsonLines(`{"a":${'['.repeat(150)}1${']'.repeat(150)}}`))
  ok(shallow.err === null, 'nesting within the cap reads as before')
  const wide = timed(() => dynamodbTable.extract(`{${MARK}${Array.from({ length: 300000 }, (_, i) => `"k${i}":{"v":[${i}]}`).join(',')}}`, 'wide.json'))
  ok(wide.ms < SLOW && wide.err === null, `a wide JSON of 300 000 members, each nested, reads in linear time (${wide.ms} ms)`)
  const dollars = '${'.repeat(500000)
  const ref = timed(() => isRef(dollars)), refT = timed(() => dynamodbTable.extract(JSON.stringify({ TableName: dollars, KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }] }), 'refs.json'))
  ok(ref.ms < SLOW && refT.ms < SLOW && refT.err === null, `a 1 MB run of "\${" with no "}" is no reference, found in linear time (${ref.ms} ms; the table read in ${refT.ms} ms)`)
  eq([isRef('${Stage}-x'), isRef('a${b'), isRef('}${'), isRef('x${y}'), isRef('plain')], [true, false, false, true, false], '… and isRef still tells a ${…} reference from a string')
  eq(dynamodbTable.extract(`﻿${JSON.stringify({ TableName: 'b', KeySchema: [{ AttributeName: 'k', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'k', AttributeType: 'S' }] }, null, 2)}`, 'bom.json').declarations[0].entities.map((e) => `${e.name}@${e.line}`), ['b@2'], 'a JSON file that starts with a byte order mark reads')

  // a declaration that moves (renamed), splits (one file per table): its changes are still seen
  const tbl = (name, billing, proj) => ({ TableName: name, BillingMode: billing, KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }, { AttributeName: 'g', AttributeType: 'S' }], GlobalSecondaryIndexes: [{ IndexName: 'gi', KeySchema: [{ AttributeName: 'g', KeyType: 'HASH' }], Projection: { ProjectionType: proj } }] })
  const model = (...files) => reconcile(files.map(([file, v]) => ({ repo: 'r', extractor: 'dynamodb-table@1', facts: dynamodbTable.extract(JSON.stringify(v, null, 2), file) })))
  const moved = diffModels(model(['seed/loans.json', tbl('loans', 'PAY_PER_REQUEST', 'ALL')]), model(['local/loans.json', tbl('loans', 'PROVISIONED', 'KEYS_ONLY')]))
  eq(changeLines(moved).filter((l) => /entity|index/.test(l)), [
    '  ~ entity loans  billing: PAY_PER_REQUEST → PROVISIONED; declared in: seed/loans.json → local/loans.json',
    '  ~ index loans gi  projection: ALL → KEYS_ONLY; declared in: seed/loans.json → local/loans.json',
  ], 'a declaration that moved to another file: what changed with the move is reported beside where it is declared now')
  const split = diffModels(model(['db/tables.json', [tbl('loans', 'PAY_PER_REQUEST', 'ALL'), tbl('holds', 'PAY_PER_REQUEST', 'ALL')]]), model(['db/loans.json', tbl('loans', 'PAY_PER_REQUEST', 'ALL')], ['db/holds.json', tbl('holds', 'PROVISIONED', 'ALL')]))
  eq(changeLines(split).filter((l) => /entity/.test(l)), [
    '  ~ entity holds  billing: PAY_PER_REQUEST → PROVISIONED; declared in: db/tables.json → db/holds.json',
    '  ~ entity loans  declared in: db/tables.json → db/loans.json',
  ], 'a file of several tables split into one per table: each table paired with its new file, its own changes reported')
  const many = diffModels(model(['a.json', tbl('t', 'PAY_PER_REQUEST', 'ALL')], ['b.json', tbl('t', 'PAY_PER_REQUEST', 'ALL')]), model(['c.json', tbl('t', 'PROVISIONED', 'ALL')], ['d.json', tbl('t', 'PROVISIONED', 'ALL')]))
  eq(changeLines(many).filter((l) => /entity/.test(l)), ['  ~ entity t  billing: PAY_PER_REQUEST → PROVISIONED; declared in: a.json,b.json → c.json,d.json'], 'declarations that do not pair one to one: their merged values are compared')
  const ds = deltaStates({ data: [
    { id: 'p', op: 'change', target: 'r:dynamodb/loans/index:gi', after: { projection: 'INCLUDE', include: ['x'] }, why: 'w', origin: 'planned' },
    { id: 'b', op: 'change', target: 'r:dynamodb/loans', after: { billing: 'PROVISIONED' }, why: 'w', origin: 'planned' },
  ] }, model(['local/loans.json', tbl('loans', 'PROVISIONED', 'KEYS_ONLY')]), { base: model(['seed/loans.json', tbl('loans', 'PAY_PER_REQUEST', 'ALL')]), diff: moved })
  eq(ds.changes.map((r) => `${r.id} ${r.state}${r.diffs.length ? ` ${r.diffs.map((x) => x.text).join('; ')}` : ''}`), ['p built-differently projection: INCLUDE (x) → KEYS_ONLY', 'b planned-built'], '… and a delta against it: what the move changed counts as touched (built differently), what it built as planned is built')
}

// ── 22 · Terraform and Terragrunt: the HCL reader, the evaluator, the extractor ──
console.log('\n22 · Terraform and Terragrunt: the HCL reader (readers/hcl.mjs), the evaluator (readers/hcl-eval.mjs), the extractor (extractors/terraform.mjs)')
{
  const { parseHcl, refText, HCL_MAX } = await import('../lib/data/readers/hcl.mjs')
  const H = await import('../lib/data/readers/hcl-eval.mjs')
  const { default: terraform, tfLevel, TF_LEVEL } = await import('../lib/data/extractors/terraform.mjs')
  const { extractAll } = await import('../lib/data/registry.mjs')
  const { elementsOf } = await import('../lib/data/reconcile.mjs')
  const timed = (f) => { const t0 = Date.now(); let err = null, v; try { v = f() } catch (e) { err = String(e.message) } return { ms: Date.now() - t0, err, v } }
  const SLOW = 4000
  const attr = (text, name = 'x') => parseHcl(text).body.items.find((i) => i.t === 'attr' && i.name === name)
  // an expression evaluated in a module whose variables and locals `decl` declares, `values` set from outside
  const evalIn = (expr, decl = '', values = {}, opts = {}) => {
    const mod = H.readModule([{ path: 'm/main.tf', body: parseHcl(decl).body }])
    const vals = new Map(Object.entries(values).map(([k, v]) => [k, { v, at: { path: 'in.hcl', line: 1 } }]))
    const { scope } = H.moduleScope(mod, vals)
    const ev = new H.Evaluator(opts)
    return { v: ev.value(attr(`x = ${expr}\n`).expr, H.child(scope, {}, {}, 'm/main.tf')), ev }
  }
  const val = (expr, decl, values) => JSON.parse(JSON.stringify(evalIn(expr, decl, values).v))
  const tpl = (v) => (v instanceof H.Partial ? v.parts.map((p) => (typeof p === 'string' ? p : `{${p.label}}`)).join('') : v instanceof H.Unknown ? `{${v.label}}` : v)

  // the reader: blocks, attributes, literals, comments, heredocs, templates
  const doc = parseHcl(`# a comment
// another
/* a block
   comment */
resource "aws_dynamodb_table" "t" {
  name = "a\\n\\"b\\" \\u00e9 $\${x} %%{y}"   # trailing
  n    = 1.5e2
  ok   = true
  none = null
  list = [1, "two", [3],]
  obj  = { a = 1, "b" = 2
    c : 3
    (local.k) = 4 }
  nested { inner = -1 }
  doc = <<EOF
  kept \${var.x}
EOF
  dedent = <<-EOT
      one
        two
    EOT
}
`)
  const res = doc.body.items[0]
  eq([res.t, res.type, res.labels, res.line, res.end], ['block', 'resource', ['aws_dynamodb_table', 't'], 5, 22], 'a block: its type, labels, first and last line (comments of three kinds are blanks)')
  const A = new Map(res.body.items.filter((i) => i.t === 'attr').map((i) => [i.name, i]))
  eq(A.get('name').expr, { t: 'lit', line: 6, s: A.get('name').expr.s, e: A.get('name').expr.e, v: 'a\n"b" é ${x} %{y}' }, 'a quoted string: escapes (\\n \\" \\u), $${ and %%{ for a literal ${ and %{, a comment after it')
  eq([A.get('n').expr.v, A.get('ok').expr.v, A.get('none').expr.v], [150, true, null], 'a number with an exponent, a bool, null')
  eq(A.get('list').expr.items.map((x) => x.t), ['lit', 'lit', 'tuple'], 'a list, nested, with a trailing comma')
  eq(A.get('obj').expr.items.map((x) => [x.key.t === 'lit' ? x.key.v : x.key.t, x.value.v]), [['a', 1], ['b', 2], ['c', 3], ['paren', 4]], 'an object: items separated by commas or new lines, = or :, a bare name, a string or a parenthesised key')
  eq(res.body.items.find((i) => i.t === 'block').body.items[0].expr.t, 'neg', 'a one-line block, a negative number')
  eq(A.get('doc').expr.parts[0], '  kept ', 'a heredoc keeps its text as written, an interpolation in it')
  eq(A.get('dedent').expr.v, 'one\n  two\n', 'an indented heredoc (<<-) loses the common leading blanks of its lines')
  const t1 = attr('x = "${var.env}-${var.app}-orders"\n').expr
  eq([t1.t, t1.single, t1.parts.length, refText(t1.parts[0].x)], ['tpl', false, 4, 'var.env'], 'a template: its interpolations kept as expressions, its literal parts as strings')
  eq(attr('x = "${each.value}"\n').expr.single, true, 'a template of one interpolation alone is its value, unconverted')
  eq(attr('x = "%{ if a }yes%{ else }no%{ endif }"\n').expr.parts[0].t, 'if', 'a template directive: %{ if } … %{ else } … %{ endif }')
  const fe = attr('x = { for k, v in m : k => v.name... if v != null }\n').expr
  eq([fe.t, fe.kind, fe.k, fe.v, fe.group, fe.cond.t], ['for', 'object', 'k', 'v', true, 'bin'], 'a for expression: object form, two names, grouping, an if')
  eq([attr('x = a ? b : c\n').expr.t, attr('x = 1 + 2 * 3\n').expr.r.op, attr('x = merge(a, b...)\n').expr.expand], ['cond', '*', true], 'a conditional, the operators\' precedence, a list expanded into arguments')
  eq(refText(attr('x = get_env("TOKEN", "a-default")\n').expr), 'get_env(…)', 'refText names a function, never its arguments (a literal beside it may be a secret)')
  eq(refText(attr('x = dependency.db.outputs["name"].id\n').expr), 'dependency.db.outputs["name"].id', '… and writes a path with its keys')
  // errors carry their line; hostile text is refused in bounded time
  const bad = (text) => { try { parseHcl(text); return null } catch (e) { return e.message } }
  eq(bad('a = "open\nb = 1\n'), 'an unterminated string: a quoted string ends on its own line at line 1', 'an unterminated string, at its line')
  eq(bad('x = 1\ndoc = <<EOF\nnever closed\n'), 'an unterminated heredoc: no line closes <<EOF at line 2', 'an unterminated heredoc, at the line that opens it')
  eq(bad('a {\n  b = 1\n'), 'an unterminated block: no closing } at line 3', 'an unterminated block')
  eq(bad('a = 1 b = 2\n'), 'expected a new line after an attribute or a block at line 1', 'two attributes on one line')
  const deepList = timed(() => parseHcl(`x = ${'['.repeat(100000)}${']'.repeat(100000)}\n`))
  ok(deepList.ms < SLOW && deepList.err === 'it nests deeper than 64 levels at line 1', `a list nested 100 000 deep is refused in bounded time (${deepList.ms} ms: ${deepList.err})`)
  const deepBlock = timed(() => parseHcl(`${'a {\n'.repeat(5000)}${'}\n'.repeat(5000)}`))
  ok(deepBlock.err === 'it nests deeper than 64 levels at line 65', `blocks nested 5 000 deep are refused (${deepBlock.err})`)
  const deepTpl = timed(() => parseHcl(`x = ${'"${'.repeat(3000)}1${'}"'.repeat(3000)}\n`))
  ok(deepTpl.err === 'it nests deeper than 64 levels at line 1', `interpolations nested 3 000 deep are refused (${deepTpl.err})`)
  const deepNot = timed(() => parseHcl(`x = ${'!'.repeat(100000)}true\n`))
  ok(deepNot.err === 'it nests deeper than 64 levels at line 1', `100 000 operators in a row are refused (${deepNot.err})`)
  const huge = timed(() => parseHcl(`x = "${'y'.repeat(HCL_MAX)}"\n`))
  ok(huge.err === 'the HCL is larger than 1024 KB: not read' && huge.ms < SLOW, `a text past the cap is refused before it is read (${huge.err})`)
  const wide = timed(() => parseHcl(Array.from({ length: 40000 }, (_, i) => `a${i} = "v${i}" # c\n`).join('')))
  ok(wide.err === null && wide.ms < SLOW, `40 000 attributes with comments read in linear time (${wide.ms} ms)`)
  const blanks = timed(() => parseHcl(`x = 1${' '.repeat(500000)}\n${'\n'.repeat(400000)}y = 2\n`))
  ok(blanks.err === null && blanks.ms < SLOW, `long runs of blanks and new lines read in linear time (${blanks.ms} ms)`)
  const openHeredocs = timed(() => parseHcl(`${'d = <<EOF\n'.repeat(1)}${'line\n'.repeat(200000)}`))
  ok(openHeredocs.err === 'an unterminated heredoc: no line closes <<EOF at line 1' && openHeredocs.ms < SLOW, `an unterminated heredoc over 200 000 lines fails once, in linear time (${openHeredocs.ms} ms)`)

  // the evaluator: each construct
  const VARS = `variable "env" { type = string }
variable "app" {
  type    = string
  default = "shop"
}
variable "tables" {
  type = map(object({
    hash_key = string
    sort     = optional(string)
    ttl      = optional(bool, true)
    tags     = optional(list(string), [])
  }))
  default = {}
}
locals {
  prefix = "\${var.app}-\${var.env}"
  names  = [for k, t in var.tables : "\${local.prefix}-\${k}" if t.ttl]
  loop1  = local.loop2
  loop2  = local.loop1
}
`
  eq(val('var.app', VARS), 'shop', 'var.*: the default when nothing sets it')
  eq(val('var.app', VARS, { app: 'books' }), 'books', '… the value set from outside (an input, a tfvars) over it')
  eq(val('var.tables', VARS, { tables: { a: { hash_key: 'id', extra: 1 }, b: { hash_key: 'k', ttl: false, sort: 's' } } }), { a: { hash_key: 'id', sort: null, ttl: true, tags: [] }, b: { hash_key: 'k', sort: 's', ttl: false, tags: [] } },
    'a value conformed to its type: optional attributes filled with their default or null, an attribute the type does not declare dropped')
  eq(val('local.names', VARS, { env: 'prod', tables: { orders: { hash_key: 'id' }, carts: { hash_key: 'id', ttl: false } } }), ['shop-prod-orders'], 'locals reading locals and variables, a for expression with an if, string templates')
  eq(val('[for s in ["b", "a", "b"] : upper(s)]'), ['B', 'A', 'B'], 'a for expression over a list')
  eq(val('{ for k, v in { x = 1, y = 2 } : v => k }'), { 1: 'x', 2: 'y' }, 'a for expression building an object')
  eq(val('{ for s in ["a1", "a2", "b1"] : (s == "b1" ? "b" : "a") => s... }'), { a: ['a1', 'a2'], b: ['b1'] }, 'a for expression grouping (...)')
  eq(val('true && !false ? 1 + 2 * 3 : 0'), 7, 'a conditional and the operators, by precedence')
  eq(val('"%{ for n in ["a", "b"] }${n}.%{ endfor }%{ if 1 == 1 }yes%{ else }no%{ endif }"'), 'a.b.yes', 'template directives: %{ for } and %{ if }')
  eq([val('lookup({ a = 1 }, "a", 0)'), val('lookup({ a = 1 }, "z", 0)'), val('try(var.tables.nope.x, "fallback")', VARS), val('can(var.tables.nope)', VARS), val('can(var.app)', VARS)], [1, 0, 'fallback', false, true], 'lookup with its default, try() and can() catching an error')
  eq(val('merge({ a = 1, b = 1 }, null, { b = 2 })'), { a: 1, b: 2 }, 'merge: later maps win, null skipped')
  eq([val('coalesce(null, "", "x")'), val('compact(["a", "", null, "b"])'), val('flatten([["a"], [["b"]], "c"])'), val('toset(["b", "a", "b"])'), val('tolist(toset(["y", "x"]))')], ['x', ['a', 'b'], ['a', 'b', 'c'], ['a', 'b'], ['x', 'y']], 'coalesce, compact, flatten, toset (unique, in order), tolist')
  eq([val('concat(["a"], ["b", "c"])'), val('contains(["a", "b"], "b")'), val('length({ a = 1, b = 2 })'), val('keys({ b = 1, a = 2 })'), val('format("%s-%d-%%", "a", 3)'), val('join("-", ["a", "b"])')], [['a', 'b', 'c'], true, 2, ['a', 'b'], 'a-3-%', 'a-b'], 'concat, contains, length, keys, format, join')
  // unknowns: never guessed, propagated, kept in templates around the known parts
  const u1 = evalIn('"${var.env}-${var.app}-orders"', VARS).v
  eq([u1 instanceof H.Partial, tpl(u1)], [true, '{env}-shop-orders'], 'a variable with no value is unknown; a template keeps its known parts around it, the unknown labelled by its name')
  const u2 = evalIn('aws_kms_key.main.arn').v
  eq([u2 instanceof H.Unknown, u2.text, u2.label], [true, 'aws_kms_key.main.arn', 'arn'], 'another resource\'s attribute is unknown, with its text and its label')
  eq([tpl(evalIn('upper(var.env)', VARS).v), evalIn('var.env == "prod"', VARS).v instanceof H.Unknown, evalIn('try(var.env, "x")', VARS).v instanceof H.Unknown], ['{env}', true, true], 'an operation on an unknown is unknown (a function, a comparison; try() returns it, it is no error)')
  const u3 = evalIn('vault_secret("x")').v
  eq([u3 instanceof H.Unknown, u3.text, u3.why], [true, 'vault_secret(…)', 'vault_secret(): a function the evaluator does not run'], 'a function the evaluator does not run is unknown, never guessed')
  eq([evalIn('terraform.workspace').v.text, evalIn('data.aws_region.current.name').v.text, tpl(evalIn('"${path.module}/x"').v)], ['terraform.workspace', 'data.aws_region.current.name', '{module}/x'], 'terraform.workspace, data sources, path.*: unknown')
  eq(val('lookup(merge({ a = { b = "c" } }), "a").b'), 'c', 'traversals on values: an attribute of a function result')
  const cyc = H.attrOf(parseHcl('x = local.loop1\n').body, 'x', H.child(H.moduleScope(H.readModule([{ path: 'm/main.tf', body: parseHcl(VARS).body }]), new Map()).scope, {}, {}, 'm/main.tf'), new H.Evaluator())
  eq([cyc.v instanceof H.Unknown, cyc.v.why], [true, 'x: not evaluated (loop1 refers to itself)'], 'a cycle of locals is an error, kept as an unknown value saying why')
  // bounded: the budget of steps, the depth, the size of a string
  const chain = Array.from({ length: 30 }, (_, i) => `  l${i} = [local.l${i + 1}, local.l${i + 1}]`).join('\n')
  const blow = timed(() => evalIn('flatten(local.l0)', `locals {\n${chain}\n  l30 = ["x"]\n}\n`))
  ok(blow.err === 'the evaluation ran past its budget of steps' && blow.ms < SLOW * 2, `locals doubling 30 times, flattened: stopped by the budget (${blow.ms} ms: ${blow.err})`)
  const deepLocals = timed(() => evalIn('local.d0', `locals {\n${Array.from({ length: 400 }, (_, i) => `  d${i} = local.d${i + 1}`).join('\n')}\n  d400 = 1\n}\n`))
  ok(/^the evaluation nests deeper than 128 levels/.test(deepLocals.err || ''), `a chain of 400 locals stops at the depth cap (${deepLocals.err})`)
  const strs = timed(() => evalIn('local.s0', `locals {\n${Array.from({ length: 40 }, (_, i) => `  s${i} = "\${local.s${i + 1}}\${local.s${i + 1}}"`).join('\n')}\n  s40 = "ab"\n}\n`))
  ok(strs.err === 'a string past 1024 KB' && strs.ms < SLOW, `a string doubling 40 times stops at the size cap (${strs.ms} ms: ${strs.err})`)
  // resources: for_each over a map and a set, count; dynamic blocks with an iterator
  const RES = parseHcl(`resource "aws_dynamodb_table" "m" {
  for_each = { b = { k = "id" }, a = { k = "pk" } }
  name     = each.key
  dynamic "attribute" {
    for_each = [each.value.k, "sk"]
    iterator = at
    content {
      name = at.value
      type = at.key == 0 ? "S" : "N"
    }
  }
}
resource "aws_dynamodb_table" "s" {
  for_each = toset(["y", "x"])
  name     = "\${each.key}-\${each.value}"
}
resource "aws_dynamodb_table" "c" {
  count = 2
  name  = "c\${count.index}"
}
`).body
  const MOD = H.readModule([{ path: 'm/main.tf', body: RES }])
  const msc = H.moduleScope(MOD, new Map()).scope
  const ev = new H.Evaluator()
  const inst = MOD.resources.map((r) => H.instancesOf(r, msc, ev).list.map((i) => [i.key, H.attrOf(r.block.body, 'name', i.scope, ev).v]))
  eq(inst, [[['a', 'a'], ['b', 'b']], [['x', 'x-x'], ['y', 'y-y']], [[0, 'c0'], [1, 'c1']]], 'for_each over a map (keys in order) and over a set of strings (each.key is each.value), count.index')
  const mi = H.instancesOf(MOD.resources[0], msc, ev).list[0]
  eq(H.blocksOf(MOD.resources[0].block.body, 'attribute', mi.scope, ev).list.map((b) => [H.attrOf(b.body, 'name', b.scope, ev).v, H.attrOf(b.body, 'type', b.scope, ev).v]), [['pk', 'S'], ['sk', 'N']], 'a dynamic block: one block per element, its iterator renamed, key and value')

  // the extractor, on the fixture project's files (fixtures/tf), in memory
  const FIX = path.join(HERE, 'fixtures', 'tf', 'shop')
  const listFiles = (dir, rel = '') => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(dir, rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]))
  const tfRun = (edit = {}) => {
    const files = new Map(listFiles(FIX).map((p) => [p, readFileSync(path.join(FIX, p), 'utf8')]))
    for (const [p, t] of Object.entries(edit)) { if (t === null) files.delete(p); else files.set(p, t) }
    return extractAll({ paths: [...files.keys()], size: (p) => files.get(p).length, read: (p) => files.get(p) }, { exclude: [] }, [], {})
  }
  const rows = tfRun()
  eq(rows.map((r) => [r.extractor, r.key, r.error || null]), [['dynamodb-table@1', 'local/tables/orders.json', null], ['terraform@2', 'modules/kv-tables', null], ['terraform@2', 'live/prod/legacy/terragrunt.hcl', null]],
    'found by content: the module folder declaring a table resource is a job, the configuration whose module is out of reach another; the configuration of a remote module that is no table module, and the root and stage files, are none')
  const decl = rows[1].facts.declarations
  eq(decl.map((d) => [d.source.path, d.label, d.status]), [['live/prod/tables/terragrunt.hcl', 'Terraform module modules/kv-tables through Terragrunt, 3 tables', 'read']], 'one declaration per configuration that runs the module, at that configuration')
  const ent = Object.fromEntries(decl[0].entities.map((e) => [e.name, e]))
  eq(Object.keys(ent), ['prod-shop-audit', 'prod-shop-carts', 'prod-shop-orders'], 'one table per for_each key, named from the inputs merged through the includes (stage from an exposed include, app from the root\'s inputs)')
  const O = ent['prod-shop-orders']
  const at = (x) => `${x.path}:${x.line} (${x.via.path}:${x.via.line})`
  eq([at(O), O.as, O.billing, O.stream, O.whole], ['live/prod/tables/terragrunt.hcl:22 (modules/kv-tables/main.tf:2)', 'aws_dynamodb_table.table["orders"]', 'PAY_PER_REQUEST', 'NEW_AND_OLD_IMAGES', true], 'a table: at its entry in the inputs, the module\'s resource as its second source; billing, stream')
  eq(O.keys.map((k) => `${k.role} ${k.parts.join(',')}${k.role === 'ttl' ? ` ${k.enabled}` : ''} @ ${at(k)}`), ['partition customer_id @ live/prod/tables/terragrunt.hcl:23 (modules/kv-tables/main.tf:7)', 'sort order_id @ live/prod/tables/terragrunt.hcl:24 (modules/kv-tables/main.tf:8)', 'ttl expires_at true @ live/prod/tables/terragrunt.hcl:22 (modules/kv-tables/main.tf:45)'],
    'its keys at the input lines that state them; the TTL on by the type\'s default, at the table\'s entry (no line of the inputs says it)')
  eq(O.fields.map((f) => `${f.name} ${f.type} ${f.nullable ? 'null' : 'key'} @ ${at(f)}`), ['customer_id S key @ live/prod/tables/terragrunt.hcl:23 (modules/kv-tables/main.tf:10)', 'order_id S key @ live/prod/tables/terragrunt.hcl:24 (modules/kv-tables/main.tf:15)', 'placed_at N null @ live/prod/tables/terragrunt.hcl:31 (modules/kv-tables/main.tf:23)', 'status S null @ live/prod/tables/terragrunt.hcl:30 (modules/kv-tables/main.tf:23)'],
    'the attributes from three blocks, two of them dynamic (over a for expression flattened into a set, a type looked up): each at the input line that names it')
  eq(O.indexes.map((i) => `${i.name} ${i.kind} ${i.partition}/${i.sort} ${i.projection} @ ${at(i)}`), ['ByStatus gsi status/placed_at KEYS_ONLY @ live/prod/tables/terragrunt.hcl:28 (modules/kv-tables/main.tf:34)'], 'a GSI from a dynamic block, at its object in the inputs')
  const C = ent['prod-shop-carts']
  eq([C.keys.find((k) => k.role === 'ttl'), C.stream, C.indexes], [{ role: 'ttl', parts: [], enabled: false, path: 'live/prod/tables/terragrunt.hcl', line: 38, via: { path: 'modules/kv-tables/main.tf', line: 45 } }, null, []], 'a TTL switched off in the inputs: off, its attribute empty as the module says, at the line that switches it')
  const AU = ent['prod-shop-audit']
  eq([AU.whole, AU.keys.find((k) => k.role === 'sort').parts, AU.keys.find((k) => k.role === 'sort').line], [false, ['${dependency.search.outputs.sort_attr}'], 44], 'an input from dependency.*.outputs: unknown, kept as its expression, at its line; the table not whole')
  ok(decl[0].notes.includes('prod-shop-audit: range_key is unknown (dependency.search: another configuration\'s output, known only once it is applied)') && decl[0].notes.includes('prod-shop-audit: its attribute blocks are unknown (dependency.search: another configuration\'s output, known only once it is applied)'), `and noted, never guessed (${decl[0].notes.join(' | ')})`)
  eq(rows[2].facts.declarations.map((d) => [d.status, d.label, d.notes]), [['not-read', 'a module out of reach (tfr:///terraform-aws-modules/dynamodb-table/aws)', ['live/prod/legacy/terragrunt.hcl:2: its module tfr:///terraform-aws-modules/dynamodb-table/aws is not in this repository (a remote source): the key-value tables it declares, if any, are unknown']]], 'a configuration whose module is out of reach (a registry address naming a table module): found, not read, said so, its query dropped')
  // reconciled with the local CreateTable file stating one of the same tables by its exact name
  const km = reconcile(rows.filter((r) => r.facts).map((r) => ({ repo: 'shop', extractor: r.extractor, facts: r.facts })))
  const orders = km.stores[0].entities.find((e) => e.name === 'prod-shop-orders')
  eq([km.stores.map((s) => s.id), orders.sources.map((s) => `${s.path}:${s.line}`), elementsOf(orders).flatMap(([l, x]) => x.conflicts.map((c) => `${l} ${c.attr}`))],
    [['shop:dynamodb'], ['live/prod/tables/terragrunt.hcl:22', 'modules/kv-tables/main.tf:2', 'local/tables/orders.json:2'], ['prod-shop-orders.sku presence', 'prod-shop-orders index BySku presence']],
    'one store with the CreateTable file: the table they both name is one entity citing the inputs, the module and the file; what only the file declares is a conflict')
  // a name with an unknown part: its template
  const noStage = tfRun({ 'live/prod/stage.hcl': null })[1].facts.declarations[0]
  eq(noStage.entities.map((e) => [e.name, e.nameTemplate]), [['{stage}-shop-audit', '{stage}-shop-audit'], ['{stage}-shop-carts', '{stage}-shop-carts'], ['{stage}-shop-orders', '{stage}-shop-orders']], 'the include that sets the stage is missing: each name is its template, its literal parts kept')
  eq(noStage.notes[0], '3 tables: a part of each name is unknown (find_in_parent_folders("stage.hcl"): no such file above live/prod/tables among the repository\'s HCL files): each named by its template ({stage}-shop-audit, {stage}-shop-carts, {stage}-shop-orders)', 'and noted once per reason, with why')
  // secrets: a tfvars value no table uses never reaches the facts
  const SECRET = ['sk', 'live', Array.from({ length: 24 }, (_, i) => 'abcdef0123456789'[(i * 7) % 16]).join('')].join('_')
  const withSecret = tfRun({ 'modules/kv-tables/terraform.tfvars': `api_token = "${SECRET}"\napp = "store"\n` })
  const sfacts = JSON.stringify(withSecret)
  ok(!sfacts.includes(SECRET) && withSecret[1].facts.declarations[0].entities.map((e) => e.name).join() === 'prod-store-audit,prod-store-carts,prod-store-orders', 'a tfvars value: the module\'s terraform.tfvars over the Terragrunt inputs (app), and the secret beside it, used only in a tag, never in the facts')
  // a standalone module: a var-file per environment, literal tables, multi-attribute keys, an LSI
  const STANDALONE = {
    'svc/db/tables.tf': `variable "env" { default = "dev" }
resource "aws_dynamodb_table" "events" {
  name           = "\${var.env}-events"
  hash_key       = "tenant"
  range_key      = "at"
  read_capacity  = 5
  write_capacity = 5
  attribute {
    name = "tenant"
    type = "S"
  }
  attribute {
    name = "at"
    type = "N"
  }
  attribute {
    name = "kind"
    type = "S"
  }
  attribute {
    name = "region"
    type = "S"
  }
  global_secondary_index {
    name            = "ByKindRegion"
    projection_type = "INCLUDE"
    non_key_attributes = ["payload"]
    key_schema {
      attribute_name = "kind"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "region"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "at"
      key_type       = "RANGE"
    }
  }
  local_secondary_index {
    name            = "ByKind"
    range_key       = "kind"
    projection_type = "KEYS_ONLY"
  }
}
`,
    'svc/db/prod.tfvars': 'env = "prod"\n',
    'svc/db/staging.tfvars.json': '{\n  "env": "staging"\n}\n',
  }
  const sa = extractAll({ paths: Object.keys(STANDALONE), size: (p) => STANDALONE[p].length, read: (p) => STANDALONE[p] }, { exclude: [] }, [], {})
  const sd = sa[0].facts.declarations
  eq(sd.map((d) => [d.source.path, d.label, d.entities.map((e) => e.name).join()]), [['svc/db/prod.tfvars', 'Terraform module svc/db with prod.tfvars, 1 table', 'prod-events'], ['svc/db/staging.tfvars.json', 'Terraform module svc/db with staging.tfvars.json, 1 table', 'staging-events']], 'a module no Terragrunt configuration runs: one declaration per var-file beside it (HCL or JSON), each over the defaults')
  const ev1 = sd[0].entities[0]
  eq([ev1.billing, ev1.indexes.map((i) => `${i.name} ${i.kind} ${i.partition.join('+')}/${i.sort.join('+')} ${i.projection}(${i.include})`), ev1.fields.map((f) => `${f.name}:${f.type}:${f.nullable}`)],
    ['PROVISIONED', ['ByKindRegion gsi kind+region/at INCLUDE(payload)', 'ByKind lsi tenant/kind KEYS_ONLY()'], ['tenant:S:false', 'at:N:false', 'kind:S:true', 'region:S:true']],
    'literal blocks: billing PROVISIONED when not said (the provider\'s default), a GSI keyed by key_schema blocks (a multi-attribute partition key), an LSI on the table\'s partition key')
  eq([sd[0].entities[0].path, sd[0].entities[0].line], ['svc/db/tables.tf', 2], 'with no for_each, a table is at its resource\'s line')
  const saModel = reconcile(sa.map((r) => ({ repo: 'svc', extractor: r.extractor, facts: r.facts })))
  eq(saModel.stores[0].entities.find((e) => e.name === 'prod-events').sources.map((s) => `${s.path}:${s.line}`), ['svc/db/tables.tf:2'], '… cited once: its second source would be the same line')
  // never throws past the extractor: a file that does not parse is noted, the others read
  const broken = tfRun({ 'live/prod/other/terragrunt.hcl': 'terraform {\n  source = "../../../modules/kv-tables"\n', 'modules/kv-tables/extra.tf': 'resource "x" {\n' })
  ok(!broken[1].error && broken[1].facts.declarations[0].entities.length === 3 && broken[1].facts.declarations[0].notes.includes('modules/kv-tables/extra.tf does not parse: an unterminated block: no closing } at line 2') && broken[1].facts.declarations[0].notes.some((n) => n.startsWith('live/prod/other/terragrunt.hcl does not parse (an unterminated block')),
    `a module file and a configuration that do not parse: each noted, the tables still read (${broken[1].error || broken[1].facts.declarations[0].notes.slice(0, 3).join(' | ')})`)
  // ── the review's fix round: no repository text in a parse error, deep merges, values out of notes, hostile values ──
  // a secret-looking value next to a syntax error, built at run time (no token sits in the repository)
  const NEAR = ['sk', 'live', Array.from({ length: 22 }, (_, i) => 'mnopqrstuvwxyz234567'[(i * 7) % 20]).join('')].join('_')
  const { parseJson } = await import('../lib/data/readers/json-lines.mjs')
  const pj = (() => { try { parseJson(`{\n  "password": ${NEAR},\n  "env": "prod"\n}\n`); return null } catch (e) { return e.message } })()
  eq(pj, 'not valid JSON at line 2', 'a JSON text that does not parse: its line, and none of its text (the engine\'s message quotes the characters around the error)')
  eq((() => { try { parseJson(`[${'['.repeat(300)}1${']'.repeat(300)}]`); return null } catch (e) { return e.message } })(), 'the JSON nests deeper than 200 levels at line 1: not read', '… and one nested past the cap is refused before it is parsed')
  eq(parseJson('{ "a": [1, "two", { "b": null }] }'), { a: [1, 'two', { b: null }] }, '… a text that does parse is the value JSON.parse reads')
  const ctBad = timed(() => dynamodbTable.extract(`{\n  "TableName": "t",\n  "KeySchema": [], "AttributeDefinitions": [],\n  "Token": ${NEAR}\n}`, 'local/t.json'))
  ok(ctBad.err === 'not valid JSON at line 4' && !ctBad.err.includes(NEAR.slice(0, 8)), `a CreateTable file that does not parse: its job's error is its line alone (${ctBad.err})`)
  const tvBad = tfRun({ 'modules/kv-tables/terraform.tfvars.json': `{\n  "api_token": ${NEAR},\n  "app": "store"\n}\n` })
  ok(!JSON.stringify(tvBad).includes(NEAR.slice(0, 8)) && tvBad[1].facts.declarations[0].notes.includes('modules/kv-tables/terraform.tfvars.json does not parse: not valid JSON at line 2'), `a tfvars.json that does not parse: noted at its line, none of its text in the facts (${tvBad[1].facts.declarations[0].notes.find((n) => n.includes('tfvars.json')) || ''})`)
  const { default: drizzleSnap } = await import('../lib/data/extractors/drizzle-snapshot.mjs')
  const dzBad = timed(() => drizzleSnap.extract(`{ "version": "7", "secret": ${NEAR} }`, 'drizzle/meta/0001_snapshot.json'))
  ok(dzBad.err === 'not valid JSON at line 1', `a snapshot that does not parse: its line only (${dzBad.err})`)
  const sqlBad = replay([{ path: 'db/0001_x.sql', text: `CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES ('${NEAR});\n` }], DatabaseSync)
  ok(sqlBad.stopped && !sqlBad.stopped.error.includes(NEAR.slice(0, 8)), `a statement SQLite rejects inside a string literal: its error quotes no literal (${sqlBad.stopped?.error})`)
  const hclBad = (() => { try { parseHcl(`x = "value %{ ${NEAR} }"\n`); return null } catch (e) { return e.message } })()
  ok(hclBad === 'an unknown template directive at line 1', `HCL that does not parse: no text of it in the error (${hclBad})`)
  const hclChar = (() => { try { parseHcl('x = 1 + @\n'); return null } catch (e) { return e.message } })()
  eq(hclChar, 'an unexpected character at line 1', '… not even the character it stopped at')
  ok(!parseDelta(`{ "schema": 1, "secret": ${NEAR} }`).errors.some((e) => e.includes(NEAR.slice(0, 8))), 'a delta file that does not parse: no text of it in the error either')

  // values never in a note: a key that is not there, an include that is not found
  const SECRETVAL = NEAR.toUpperCase()
  const atNote = (src, values) => {
    const mod = H.readModule([{ path: 'm/main.tf', body: parseHcl('variable "m" {}\nvariable "k" {}\nvariable "f" {}\n').body }])
    const vals = new Map(Object.entries(values).map(([k, v]) => [k, { v, at: { path: 'in.hcl', line: 1 } }]))
    return H.attrOf(parseHcl(`x = ${src}\n`).body, 'x', H.child(H.moduleScope(mod, vals).scope, {}, {}, 'm/main.tf'), new H.Evaluator()).v
  }
  const missing = [atNote('lookup(var.m, var.k)', { m: { a: 1 }, k: SECRETVAL }), atNote('var.m[var.k]', { m: { a: 1 }, k: SECRETVAL })]
  eq(missing.map((u) => [u instanceof H.Unknown, u.why.includes(SECRETVAL)]), [[true, false], [true, false]], `a key that is not there: unknown, saying why without the key's value (${missing.map((u) => u.why).join(' | ')})`)
  eq(missing[1].why, 'x: not evaluated (no attribute [var.k])', '… naming the expression that holds it')

  // Terragrunt merges an include's inputs as it does (pkg/config/include.go): bottom-up, the child winning;
  // `deep` merges maps key by key and appends lists (mergo WithAppendSlice), `shallow` replaces top-level keys
  const tg = (files, child = 'live/app/terragrunt.hcl') => {
    const parsedTg = new Map(Object.entries(files).map(([p, t]) => [p, parseHcl(t).body]))
    return JSON.parse(JSON.stringify(new H.Terragrunt(child, { has: (p) => parsedTg.has(p), body: (p) => parsedTg.get(p) }, new H.Evaluator()).inputs().v))
  }
  const ROOT = 'inputs = {\n  tables = { orders = { hash = "id" } }\n  tags   = ["a"]\n  stage  = "dev"\n  cfg    = { a = { x = 1, y = 2 }, b = 3 }\n}\n'
  const CHILD = (strategy) => `include "root" {\n  path = find_in_parent_folders("root.hcl")\n${strategy ? `  merge_strategy = "${strategy}"\n` : ''}}\ninputs = {\n  tables = { audit = { hash = "k" } }\n  tags   = ["b"]\n  stage  = "prod"\n  cfg    = { a = { x = 9 } }\n}\n`
  eq(tg({ 'live/root.hcl': ROOT, 'live/app/terragrunt.hcl': CHILD('deep') }), { tables: { orders: { hash: 'id' }, audit: { hash: 'k' } }, tags: ['a', 'b'], stage: 'prod', cfg: { a: { x: 9, y: 2 }, b: 3 } },
    'merge_strategy = "deep": the child\'s map gains a key the include declares, a nested map merges key by key with the child winning, a list is the include\'s then the child\'s')
  eq(tg({ 'live/root.hcl': ROOT, 'live/app/terragrunt.hcl': CHILD(null) }), { tables: { audit: { hash: 'k' } }, tags: ['b'], stage: 'prod', cfg: { a: { x: 9 } } }, 'the default, shallow: each top-level input of the child replaces the include\'s')
  eq(tg({ 'live/root.hcl': ROOT, 'live/app/terragrunt.hcl': CHILD('no_merge') }), { tables: { audit: { hash: 'k' } }, tags: ['b'], stage: 'prod', cfg: { a: { x: 9 } } }, 'no_merge: the include\'s inputs are not merged at all')
  eq(tg({ 'live/root.hcl': 'inputs = { a = "root", b = "root" }\n', 'live/app/env.hcl': 'inputs = { a = "env", c = "env" }\n', 'live/app/terragrunt.hcl': 'include "root" {\n  path = find_in_parent_folders("root.hcl")\n}\ninclude "env" {\n  path = "env.hcl"\n}\ninputs = { c = "child" }\n' }), { a: 'env', b: 'root', c: 'child' }, 'two includes: the later one over the earlier, the child over both')
  const deepRows = tfRun({ 'live/root.hcl': readFileSync(path.join(FIX, 'live/root.hcl'), 'utf8').replace('  app = "shop"\n', '  app = "shop"\n  tables = {\n    legacy = { hash_key = "id", indexes = [] }\n  }\n'), 'live/prod/tables/terragrunt.hcl': readFileSync(path.join(FIX, 'live/prod/tables/terragrunt.hcl'), 'utf8').replace('include "root" {\n  path = find_in_parent_folders("root.hcl")\n}', 'include "root" {\n  path           = find_in_parent_folders("root.hcl")\n  merge_strategy = "deep"\n}') })
  eq(deepRows[1].facts.declarations[0].entities.map((e) => `${e.name} ${e.path}:${e.line}`), ['prod-shop-audit live/prod/tables/terragrunt.hcl:43', 'prod-shop-carts live/prod/tables/terragrunt.hcl:37', 'prod-shop-legacy live/root.hcl:17', 'prod-shop-orders live/prod/tables/terragrunt.hcl:23'], 'through the extractor: a table the root\'s inputs declare joins the child\'s under a deep merge, cited in the root (the child\'s lines one lower: its include gained a line)')

  // hostile values fail no job: a string that would explode, a value nested past any use
  const big = timed(() => evalIn('replace(var.big, "a", var.big)', 'variable "big" {}\n', { big: 'a'.repeat(400000) }))
  eq(big.err, 'a string past 1024 KB', 'replace() that would build a string past the cap stops on the cap, before the engine runs out of room')
  const deepJson = H.attrOf(parseHcl('x = jsondecode(var.j)\n').body, 'x', H.child(H.moduleScope(H.readModule([{ path: 'm/main.tf', body: parseHcl('variable "j" {}\n').body }]), new Map([['j', { v: `${'['.repeat(450000)}${']'.repeat(450000)}`, at: null }]])).scope, {}, {}, 'm/main.tf'), new H.Evaluator()).v
  eq([deepJson instanceof H.Unknown, deepJson.why], [true, 'x: not evaluated (jsondecode(): the JSON nests deeper than 200 levels)'], 'jsondecode() of a value nested 450 000 deep: refused (unknown), not a stack overflow')
  const nest = (n) => { let v = ['x']; for (let i = 0; i < n; i++) v = [v]; return v }
  eq([timed(() => evalIn('flatten(var.d)', 'variable "d" {}\n', { d: nest(20000) })).err, timed(() => evalIn('var.d == var.e', 'variable "d" {}\nvariable "e" {}\n', { d: nest(20000), e: nest(20000) })).err, timed(() => evalIn('compact(var.d)', 'variable "d" {}\n', { d: nest(20000) })).err],
    ['a value nests deeper than 256 levels', 'a value nests deeper than 256 levels', 'a value nests deeper than 256 levels'], 'flatten, a comparison and compact over a value nested 20 000 deep: stopped at the depth cap')
  const bigMod = tfRun({ 'modules/kv-tables/terraform.tfvars': `big = "${'a'.repeat(400000)}"\n`, 'modules/kv-tables/variables.tf': `${readFileSync(path.join(FIX, 'modules/kv-tables/variables.tf'), 'utf8')}\nvariable "big" {\n  default = ""\n}\n`, 'modules/kv-tables/main.tf': readFileSync(path.join(FIX, 'modules/kv-tables/main.tf'), 'utf8').replace('  name         = "${var.stage}-${var.app}-${each.key}"', '  name         = replace(var.big, "a", var.big)') })
  ok(!bigMod[1].error && bigMod[1].facts.declarations[0].notes.some((n) => n.startsWith('the evaluation stopped: a string past 1024 KB')), `through the extractor: the job is not failed, its declaration says where the evaluation stopped (${bigMod[1].error || bigMod[1].facts.declarations[0].notes.slice(-1)})`)

  // a remote address keeps no credentials: everything up to the last @ before the host's first /
  const PW = ['p', 'TOKENVALUE'].join('@')
  eq([H.safeAddress(`git::https://user:${PW}@example.com/org/m.git//kv?ref=v1`), H.safeAddress(`user:${['tok', 'en'].join('')}@example.com/org/m.git`), H.safeAddress('git@example.com:org/m.git'), H.safeAddress('tfr:///terraform-aws-modules/dynamodb-table/aws?version=4.0.0'), H.safeAddress(`https://example.com/m.zip#${['frag', 'value'].join('')}`)],
    ['git::https://example.com/org/m.git//kv', 'example.com/org/m.git', 'example.com:org/m.git', 'tfr:///terraform-aws-modules/dynamodb-table/aws', 'https://example.com/m.zip'], 'a password holding @, an address with no scheme, an scp-like one, a registry one, a fragment: no user, no password, no query, no fragment')
  // module addresses: a folder of the repository, or out of reach, shown without credentials or query
  const CRED = ['user', 'pw'].join(':')
  eq([H.moduleDir('../../modules//kv', 'live/prod/x'), H.moduleDir('/modules/kv', 'live/prod/x'), H.moduleDir('../../../../x', 'a/b'), H.moduleDir(`git::https://${CRED}@example.com/m.git//kv?ref=v1`, 'a'), H.repoPath('/.config/a.hcl')],
    [{ dir: 'live/modules/kv' }, { dir: 'modules/kv' }, { outside: true }, { remote: 'git::https://example.com/m.git//kv' }, '.config/a.hcl'], 'a module source: a local path (its `//` subfolder joined), rooted at the repository, outside it, or remote (credentials and query dropped)')
  // an HCL file past the reader's cap elsewhere in the repository is no input of the module's job
  const bigInfo = new Map([['m/main.tf', { size: 10, ddl: TF_LEVEL.module }], ['live/a/terragrunt.hcl', { size: 10, ddl: TF_LEVEL.unit }], ['gen/huge.hcl', { size: HCL_MAX + 1, ddl: 1 }]])
  eq(terraform.discover(bigInfo).map((j) => [j.key, j.inputs]), [['m', ['m/main.tf', 'live/a/terragrunt.hcl']]], 'an HCL file past the reader\'s cap is left out of a module\'s inputs, so it fails no job')
  // found by content: the levels
  eq([tfLevel('m/main.tf', 'resource "aws_dynamodb_table" "t" {}'), tfLevel('m/x.tf', '# resource "aws_dynamodb_table"\nvariable "a" {}'), tfLevel('a/terragrunt.hcl', 'include "root" {}'), tfLevel('a/root.hcl', 'inputs = {}'), tfLevel('a/terragrunt.hcl', 'terraform {\n  source = "git::https://example.com/m.git//dynamodb"\n}'), tfLevel('a/terragrunt.hcl', 'terraform {\n  source = "../modules/dynamodb"\n}'), tfLevel('m/c.tf', 'module "t" {\n  source = "terraform-aws-modules/dynamodb-table/aws"\n}')],
    [TF_LEVEL.module, 1, TF_LEVEL.unit, 1, TF_LEVEL.remote, TF_LEVEL.unit, TF_LEVEL.remote], 'tfLevel: a module declares a table resource (not in a comment); a terragrunt.hcl is a configuration Terragrunt runs; a remote source naming a table module is out of reach; a local one is no such thing')
  eq(candidates(['m/main.tf', 'm/terraform.tfvars', 'm/x.auto.tfvars.json', 'live/terragrunt.hcl', 'm/tests/plan.tftest.hcl', 'm/.terraform.lock.hcl', 'live/.terragrunt-cache/abc/main.tf', 'm/plan.tftest.hcl'], { exclude: [] }), ['m/main.tf', 'm/terraform.tfvars', 'm/x.auto.tfvars.json', 'live/terragrunt.hcl'], 'the candidates: .tf, .tfvars(.json), .hcl; never a test file, a lock file or Terragrunt\'s cache')
}

// ── 24 · item shapes and binding ──
console.log('\n24 · item shapes and binding: names matched on a template\'s literal parts (readers/names.mjs), serde\'s case rules, logical tables, bindings with their confidence and rivals (data/binding.mjs)')
{
  const { namesMatch, codeName, lastWord } = await import('../lib/data/readers/names.mjs')
  const { renameField, renameVariant, RULES } = await import('../lib/data/extractors/serde.mjs')
  const { logicalTables, bindItems, dashed, bindingHow } = await import('../lib/data/binding.mjs')
  const T = '{env}-{project}-orders'
  // the template's literal parts, its unknown parts wildcards; the code's {} anything it fills in
  eq([['{}-shop-orders', T], ['test-shop-orders', T], ['{}-orders', T], ['{}-{}-orders', '{env}-shop-orders'], ['{}-shop-orders', 'local-shop-orders'], ['Orders', 'Orders']].map(([c, t]) => namesMatch(c, t)), [true, true, true, true, true, true],
    'a name the code builds matches a template on its literal parts (a format! string, a literal, a wildcard holding several parts), and an exact name')
  eq([['{}-{}', T], ['{}', T], ['orders', T], ['{}-shop-orders-archive', T], ['{}-shop-orders', '{env}-{project}-archived_orders'], ['test-shop-cart', '{env}-{project}-cart_items'], ['test-shop-cart_items', '{env}-{project}-cart'], ['{}', '{name}']].map(([c, t]) => namesMatch(c, t)), [false, false, false, false, false, false, false, false],
    'the table\'s last word must be spelt by the code\'s literal characters, the whole name matched: no wildcard alone, no prefix or suffix of another name, a name wholly unknown matches nothing')
  eq([['orders', 'Orders'], ['Order', 'Orders'], ['{}-shop-order', T], ['{}-Shop-Orders', '{env}-shop-orders'], ['{}-shop_orders', T]].map(([c, t]) => namesMatch(c, t)), [false, false, false, false, false],
    'no fuzzy matching: no letter case folded, no plural, no separator swapped')
  eq([codeName([null, '-shop-orders']), codeName(['test-shop-orders']), codeName(['id']), codeName(['a b']), codeName([null]), codeName(['123']), codeName([null, '-', null, '-', null, '-', null, '-', null, '-x'])], ['{}-shop-orders', 'test-shop-orders', null, null, null, null, null],
    'codeName: what could name a table (DynamoDB\'s characters, 3 literal characters and a letter at least, few parts filled in)')
  eq([lastWord(T), lastWord('Orders'), lastWord('{env}-cart_items'), lastWord('{name}')], ['orders', 'Orders', 'items', null], 'the distinctive part: the last word of the literal text')
  // serde's case rules: a field's from snake_case, a variant's from PascalCase
  eq(RULES.map((r) => renameField('created_at_utc', r)), ['created_at_utc', 'CREATED_AT_UTC', 'CreatedAtUtc', 'createdAtUtc', 'created_at_utc', 'CREATED_AT_UTC', 'created-at-utc', 'CREATED-AT-UTC'], 'rename_all on a field: every case style serde knows')
  eq(RULES.map((r) => renameVariant('OnHold', r)), ['onhold', 'ONHOLD', 'OnHold', 'onHold', 'on_hold', 'ON_HOLD', 'on-hold', 'ON-HOLD'], 'rename_all on a variant: every case style serde knows')

  // logical tables: one table declared in several places, grouped by its template, never by a guess
  const ents = [['infra:dynamodb/{env}-{project}-orders', T], ['web:dynamodb/{env}-{project}-orders', T], ['api:dynamodb/local-shop-orders', 'local-shop-orders'], ['api:dynamodb/Orders', 'Orders'], ['api:dynamodb/orders', 'orders'],
    ['infra:dynamodb/{env}-{project}-carts', '{env}-{project}-carts'], ['infra:dynamodb/{env}-carts', '{env}-carts'], ['api:dynamodb/dev-shop-carts', 'dev-shop-carts'], ['a:dynamodb/Reviews', 'Reviews'], ['b:dynamodb/Reviews', 'Reviews']].map(([id, name]) => ({ id, name }))
  const lt = logicalTables(ents)
  eq(lt.groups.filter((g) => g.members.length > 1).map((g) => [g.name, g.members, g.via]), [
    [T, ['api:dynamodb/local-shop-orders', 'infra:dynamodb/{env}-{project}-orders', 'web:dynamodb/{env}-{project}-orders'], 'an exact name its template matches'],
  ], 'grouped: one template in two stores, an exact name it matches; Orders and orders stay apart (no case folding), and so do two repositories\' Reviews (a bare name is no evidence across repositories)')
  eq([...lt.notes].sort(), [['a:dynamodb/Reviews', 'b:dynamodb/Reviews also names a table Reviews: not grouped (the same name in two repositories is no evidence they are one table)'], ['api:dynamodb/dev-shop-carts', 'its name matches 2 name templates ({env}-carts, {env}-{project}-carts): grouped with none'], ['b:dynamodb/Reviews', 'a:dynamodb/Reviews also names a table Reviews: not grouped (the same name in two repositories is no evidence they are one table)']],
    'an exact name two templates match joins neither, and two repositories\' tables of one name stay apart: each says why')
  eq(lt.groups.filter((g) => g.name === 'Reviews').map((g) => [g.id, g.label]), [['table:a:dynamodb/Reviews', 'a:dynamodb/Reviews'], ['table:b:dynamodb/Reviews', 'b:dynamodb/Reviews']], 'two logical tables of one name are told apart by where they are declared')

  // bindings, from hand-written code facts: each rule with its evidence, its confidence and its rivals
  const groups = logicalTables([...[T, '{env}-{project}-customers', '{env}-{project}-carts', '{env}-{project}-saved_carts', '{env}-{project}-reviews'].map((n) => ({ id: `infra:dynamodb/${n}`, name: n })), { id: 'api:dynamodb/Orders', name: 'Orders' }]).groups
  const entities = new Map(groups.flatMap((g) => g.members).map((id) => [id, { id, name: id.slice(id.indexOf('/') + 1) }]))
  const wiring = [{ name: 'CUSTOMERS_TABLE', entity: 'infra:dynamodb/{env}-{project}-customers', repo: 'infra', path: 'main.tf', line: 30 }, { name: 'ORDERS_TABLE', entity: `infra:dynamodb/${T}`, repo: 'infra', path: 'main.tf', line: 31 }]
  const ty = (name, line, extra = {}) => ({ name, kind: 'struct', line, end: line + 2, serde: true, fields: [{ name: 'id', raw: 'String', t: { k: 'string' }, nullable: false, default: null, line: line + 1 }], ...extra })
  const fn = (name, line, x = {}) => ({ name, line, end: line + 5, converts: [], names: [], env: [], uses: [], ...x })
  const row = (path, code) => ({ repo: 'api', extractor: 'serde@1', code: { path, lang: 'rust', types: [], consts: [], fns: [], notes: [], ...code } })
  const code = [
    row('src/model.rs', { types: [ty('Order', 1), ty('Customer', 5), ty('Cart', 9), ty('Review', 13), ty('Coupon', 17, { converts: 20 }), ty('Promo', 21), ty('Thing', 25), ty('Ledger', 29)] }),
    row('src/orders.rs', { fns: [fn('put_order', 3, { converts: [{ type: 'Order', line: 4, how: 'to_item' }], names: [{ text: '{}-shop-orders', line: 5 }] })] }),
    row('src/customers.rs', { fns: [fn('load', 3, { converts: [{ type: 'Customer', line: 6, how: 'from_item' }], env: [{ name: 'CUSTOMERS_TABLE', line: 4 }] }), fn('old', 10, { names: [{ text: '{}-shop-orders', line: 11 }] })] }),
    row('src/carts.rs', { fns: [fn('save_for_later', 3, { converts: [{ type: 'Cart', line: 4, how: 'to_item' }], names: [{ text: '{}-shop-saved_carts', line: 5 }, { text: '{}-shop-carts', line: 6 }] })] }),
    row('src/reviews.rs', { fns: [fn('put', 3, { converts: [{ type: 'Review', line: 4, how: 'to_item' }] }), fn('tests::names_its_table', 20, { test: true, names: [{ text: 'test-shop-reviews', line: 21 }] })] }),
    row('src/config.rs', { consts: [{ name: 'ORDERS', line: 2, names: [], env: [{ name: 'ORDERS_TABLE', line: 2 }] }] }),
    row('src/admin.rs', { types: [ty('Export', 1), ty('Thing', 4)], fns: [fn('export', 5, { converts: [{ type: 'Export', line: 6, how: 'to_item' }], uses: ['ORDERS'] })] }),
    row('src/local.rs', { fns: [fn('seed', 12, { converts: [{ type: 'Promo', line: 13, how: 'to_item' }], names: [{ text: 'Orders', line: 14 }] })] }),
    row('src/other.rs', { fns: [fn('x', 1, { converts: [{ type: 'Thing', line: 2, how: 'from_item' }] })] }),
    row('src/ledger.rs', { fns: [fn('put', 3, { converts: [{ type: 'Ledger', line: 4, how: 'to_item' }], names: [{ text: '{}-shop-reviews', line: 5 }] }), fn('tests::seeds_carts', 20, { test: true, converts: [{ type: 'Ledger', line: 21, how: 'to_item' }], names: [{ text: '{}-shop-carts', line: 22 }] })] }),
  ]
  code.push({ repo: 'api', extractor: 'serde@1', code: { path: 'src/mapped.rs', lang: 'rust', types: [ty('Sku', 1)], consts: [], fns: [], notes: [], mappers: [{ type: 'Sku', table: '{env}-{project}-reviews', line: 1 }] } })
  const B = bindItems(code, groups, entities, wiring)
  const by = (item) => B.bindings.filter((b) => b.item === item).map((b) => [b.table, b.confidence, b.via, b.pairing, b.rivals.map((r) => `${r.table} ${r.confidence}`)])
  eq(by('api:Customer'), [['{env}-{project}-customers', 'convention', 'env', 'function', [`${T} name-match`]]], 'env chain: the function reads the variable the infra sets to the table: convention; a name built in another function of the file is a weaker rival')
  eq(B.bindings.find((b) => b.item === 'api:Customer').evidence.map((x) => [x.what, x.text, `${x.path}:${x.line}`]), [['converts', 'Customer (from_item) in load', 'src/customers.rs:6'], ['reads', 'CUSTOMERS_TABLE', 'src/customers.rs:4'], ['sets', `CUSTOMERS_TABLE = {env}-{project}-customers`, 'main.tf:30']], '… with its evidence: the conversion, the read, the infra line that sets it')
  eq(by('api:Order'), [[T, 'name-match', 'nameTemplate', 'function', []]], 'name template: a format string its template matches, in the function that converts it: name-match')
  eq(by('api:Cart'), [['{env}-{project}-carts', 'ambiguous', 'nameTemplate', 'function', ['{env}-{project}-saved_carts ambiguous']], ['{env}-{project}-saved_carts', 'ambiguous', 'nameTemplate', 'function', ['{env}-{project}-carts ambiguous']]], 'two tables at the best rank: each ambiguous, the other its rival')
  ok(dashed('ambiguous') && dashed('name-match') && !dashed('convention') && !dashed('declared'), 'below convention a binding is drawn dashed')
  eq([by('api:Review'), B.bindings.find((b) => b.item === 'api:Review').evidence.map((x) => [x.what, x.test || false])], [[['{env}-{project}-reviews', 'name-match', 'nameTemplate', 'file', []]], [['converts', false], ['builds', true]]], 'co-occurrence in one file only (a test names the table): name-match, the test code said')
  eq(B.bindings.filter((b) => b.item === 'api:Export').map((b) => [b.table, b.via, b.pairing, b.confidence, b.evidence.map((x) => `${x.what} ${x.path}:${x.line}`)]), [[T, 'env', 'function', 'convention', ['converts src/admin.rs:6', 'const src/config.rs:2', 'reads src/config.rs:2', 'sets main.tf:31']]],
    'a constant of another file the function reads counts as its own: the env chain through it, in one function')
  eq(by('api:Promo'), [['Orders', 'name-match', 'nameTemplate', 'function', []]], 'an exact name the code spells binds the table of that name, and only it (Orders, never {env}-{project}-orders)')
  eq(by('api:Sku'), [['{env}-{project}-reviews', 'declared', 'mapper', 'mapper', []]], 'the mapper hook: a binding a mapper declares is declared')
  eq(by('api:Ledger'), [['{env}-{project}-reviews', 'name-match', 'nameTemplate', 'function', ['{env}-{project}-carts name-match']]], 'a conversion in test code ranks below the code it tests: the test that builds a ledger item for the carts fixture is a rival, not a tie')
  eq(B.items.filter((it) => !it.bound.length).map((it) => [it.id, it.converts.map((c) => c.how)]), [['api:Coupon', ['implements a conversion']]], 'a type implementing a conversion that no table name pairs with is unbound')
  eq(B.unresolved.map((u) => [u.type, u.path]), [['Thing', 'src/other.rs']], 'a conversion of a name with two definitions and none in its file is not resolved, and said')

  // ── the review's round: cycles, work bounds, serde tagging of newtype variants, languages, repositories ──
  const types1 = (lang, path, types) => ({ repo: 'r', extractor: lang === 'rust' ? 'serde@1' : 'ts-types@1', code: { path, lang, types, consts: [], fns: [], notes: [] } })
  const st = (name, fields, extra = {}) => ({ name, kind: 'struct', line: 1, end: 2, serde: true, fields, ...extra })
  const fl = (name, t, extra = {}) => ({ name, raw: name, t, nullable: false, default: null, line: 1, ...extra })
  const R = (n) => ({ k: 'ref', n })
  const shapeOf = (rows, name) => { const it = bindItems(rows, [], new Map(), []).items.find((x) => x.name === name); return it ? it.fields.map((f) => `${f.path} ${f.kind}${f.nullable ? '?' : ''}${f.values ? ` [${f.values.join(',')}]` : ''}`) : null }
  const cycles = [
    ['a Rust newtype holding itself', 'rust', [st('Node', [], { newtype: { k: 'ref', n: 'Node', nullable: true } }), st('Z', [fl('n', R('Node'))], { converts: 9 })]],
    ['two Rust newtypes holding each other', 'rust', [st('A', [], { newtype: R('B') }), st('B', [], { newtype: R('A') }), st('Z', [fl('n', R('A'))], { converts: 9 })]],
    ['a Rust newtype of a list of itself', 'rust', [st('L', [], { newtype: { k: 'list', of: R('L') } }), st('Z', [fl('n', R('L'))], { converts: 9 })]],
    ['a TypeScript alias of itself', 'ts', [{ name: 'A', kind: 'alias', line: 1, end: 1, serde: true, fields: [], alias: R('A') }, { name: 'Z', kind: 'interface', line: 2, end: 2, serde: true, fields: [fl('f', R('A'))], converts: 9 }]],
    ['two TypeScript aliases of each other', 'ts', [{ name: 'A', kind: 'alias', line: 1, end: 1, serde: true, fields: [], alias: R('B') }, { name: 'B', kind: 'alias', line: 2, end: 2, serde: true, fields: [], alias: R('A') }, { name: 'Z', kind: 'interface', line: 3, end: 3, serde: true, fields: [fl('f', R('A'))], converts: 9 }]],
  ]
  for (const [what, lang, ts] of cycles) {
    let got
    try { got = shapeOf([types1(lang, lang === 'rust' ? 'a.rs' : 'a.ts', ts)], 'Z') } catch (e) { got = `throws ${e.constructor.name}: ${String(e.message).slice(0, 60)}` }
    ok(Array.isArray(got) && got.length >= 1 && got.length <= 2 && /^[nf] /.test(got[0]), `${what}: the shape stops at the type already followed, a leaf (${JSON.stringify(got)})`)
  }
  // whatever a project's code says, reconcile answers: an unexpected failure of the binding is a note
  const broken = reconcile([{ repo: 'app', extractor: 'dynamodb-table@1', facts: dynamodbTable.extract('{ "TableName": "a", "KeySchema": [{ "AttributeName": "id", "KeyType": "HASH" }], "AttributeDefinitions": [{ "AttributeName": "id", "AttributeType": "S" }] }', 'a.json') }, { repo: 'app', extractor: 'serde@1', facts: { declarations: [], code: { path: 'x.rs', lang: 'rust', types: 7, consts: [], fns: [] } } }])
  eq([broken.stores.map((s) => s.entities.map((e) => e.name)), broken.items, broken.bindings, /^the item shapes were not bound: /.test(broken.itemsError || '')], [[['a']], [], [], true], 'a failure while binding item shapes leaves the stores answered, and says so')

  // work bounds: a wide graph of types, and a file of many functions, each in bounded time
  const dag = Array.from({ length: 10 }, (_, i) => st(`T${i}`, Array.from({ length: 12 }, (_, k) => fl(`f${k}`, R(`T${i + 1}`))), i === 0 ? { converts: 9 } : {})).concat([st('T10', [fl('leaf', { k: 'number' })])])
  let t0 = Date.now()
  const wide = bindItems([types1('rust', 'dag.rs', dag)], [], new Map(), []).items.find((x) => x.name === 'T0')
  const wideMs = Date.now() - t0
  ok(wideMs < 3000 && wide.fields.length === 400 && wide.notes.some((n) => /cut at 400 fields/.test(n)), `ten types of twelve fields each holding the next: expanded once per type, cut at 400 fields and said so (${wideMs} ms, ${wide.fields.length} fields, ${JSON.stringify(wide.notes)})`)
  const many = { repo: 'r', extractor: 'serde@1', code: { path: 'many.rs', lang: 'rust', types: Array.from({ length: 40 }, (_, k) => st(`C${k}`, [fl('id', { k: 'string' })])), consts: [], notes: [],
    fns: Array.from({ length: 300 }, (_, i) => fn(`f${i}`, i * 10, { converts: Array.from({ length: 40 }, (_, k) => ({ type: `C${k}`, line: i * 10 + 1, how: 'to_item' })), names: Array.from({ length: 40 }, (_, k) => ({ text: `{}-shop-t${k}`, line: i * 10 + 2 })) })) } }
  const tgroups = logicalTables(Array.from({ length: 40 }, (_, k) => ({ id: `infra:dynamodb/{env}-{project}-t${k}`, name: `{env}-{project}-t${k}` }))).groups
  t0 = Date.now()
  const mb = bindItems([many], tgroups, new Map(tgroups.flatMap((g) => g.members).map((id) => [id, { id, name: id.slice(id.indexOf('/') + 1) }])), [])
  const manyMs = Date.now() - t0
  ok(manyMs < 3000 && mb.bindings.length === 40 * 40 && mb.bindings.every((b) => b.confidence === 'ambiguous' && b.sites === 300), `300 functions each converting 40 types and naming 40 tables: paired per type and table, not per conversion and name (${manyMs} ms, ${mb.bindings.length} bindings)`)

  // serde's tagging of newtype variants (internally tagged: the variant's struct beside the tag;
  // adjacently tagged: the variant's type at the content key; untagged: inline; externally: under its name)
  const ev = (name, variants, extra) => ({ name, kind: 'enum', line: 3, end: 4, serde: true, fields: [], variants, converts: 9, ...extra })
  const V = (name, x = {}) => ({ name, line: 3, ...x })
  const tagRows = [types1('rust', 'ev.rs', [st('Created', [fl('id', { k: 'string' }), fl('at', { k: 'number' })]), st('Deleted', [fl('id', { k: 'string' })]),
    ev('Internal', [V('Created', { t: R('Created') }), V('Deleted', { t: R('Deleted') }), V('Bare', { t: { k: 'string' } }), V('Gone', { unit: true })], { tag: 'type' }),
    ev('Adjacent', [V('Created', { t: R('Created') }), V('Note', { t: { k: 'string' } }), V('Moved', { fields: [fl('to', { k: 'string' })] })], { tag: 'kind', content: 'payload' }),
    ev('Untagged', [V('Created', { t: R('Created') }), V('Deleted', { t: R('Deleted') })], { untagged: true }),
    ev('External', [V('Made', { t: R('Created') }), V('Count', { t: { k: 'number' } }), V('Off', { unit: true }), V('Moved', { fields: [fl('to', { k: 'string' })] })]),
  ])]
  eq(shapeOf(tagRows, 'Internal'), ['type enum [Created,Deleted,Bare,Gone]', 'id string', 'at number'], 'internally tagged: a newtype variant\'s struct stored beside the tag')
  ok(bindItems(tagRows, [], new Map(), []).items.find((x) => x.name === 'Internal').notes.some((n) => n.includes('Internal::Bare') && n.includes('serde rejects')), 'internally tagged, a newtype of a string: serde rejects it, and the shape says so')
  eq(shapeOf(tagRows, 'Adjacent'), ['kind enum [Created,Note,Moved]', 'payload any', 'payload.id string', 'payload.at number', 'payload.to string'], 'adjacently tagged: each variant\'s value at the content key (a struct\'s fields under it, a string the value itself, so its kind is any)')
  eq(shapeOf(tagRows, 'Untagged'), ['id string', 'at number'], 'untagged: the newtype variants\' structs inline')
  eq(shapeOf(tagRows, 'External'), ['Made object?', 'Made.id string', 'Made.at number', 'Count number?', 'Moved object?', 'Moved.to string'], 'externally tagged: one member per variant (a unit variant none)')

  // languages: a name resolves among the types of its own language
  const homRows = [types1('rust', 'src/model.rs', [st('Order', [fl('id', { k: 'string' })]), st('Wrapper', [fl('status', R('Status')), fl('id', { k: 'string' })], { converts: 9 })]),
    { repo: 'r', extractor: 'serde@1', code: { path: 'src/puts.rs', lang: 'rust', types: [], consts: [], notes: [], fns: [fn('put', 1, { converts: [{ type: 'Order', line: 2, how: 'to_item' }] })] } },
    types1('ts', 'web/order.ts', [{ name: 'Order', kind: 'interface', line: 1, end: 1, serde: true, fields: [fl('orderId', { k: 'string' })] }, { name: 'Status', kind: 'alias', line: 2, end: 2, serde: true, fields: [], values: ['draft', 'sent'] }])]
  const hom = bindItems(homRows, [], new Map(), [])
  eq([hom.unresolved, hom.items.map((it) => [it.id, it.lang, it.path])], [[], [['r:Order', 'rust', 'src/model.rs'], ['r:Wrapper', 'rust', 'src/model.rs']]], 'a Rust conversion of Order resolves to the Rust Order, never the TypeScript one of the same repository')
  eq(shapeOf(homRows, 'Wrapper'), ['status ref', 'id string'], 'a Rust field typed by a type serde does not shape stays its name: never the TypeScript type of that name')

  // repositories: a bare name is no evidence across them (two repositories' own sessions tables)
  const sess = (repo) => ({ repo, extractor: 'dynamodb-table@1', facts: dynamodbTable.extract(`{ "TableName": "sessions", "KeySchema": [{ "AttributeName": "${repo === 'api' ? 'sid' : 'invoice'}", "KeyType": "HASH" }], "AttributeDefinitions": [{ "AttributeName": "${repo === 'api' ? 'sid' : 'invoice'}", "AttributeType": "S" }] }`, 'tables/sessions.json') })
  const two = reconcile([sess('api'), sess('billing'), { repo: 'api', extractor: 'serde@1', facts: { declarations: [], code: { path: 'src/sess.rs', lang: 'rust', notes: [], consts: [], types: [st('LoginSession', [fl('sid', { k: 'string' }), fl('user', { k: 'string' })])], fns: [fn('save', 3, { converts: [{ type: 'LoginSession', line: 4, how: 'to_item' }], names: [{ text: 'sessions', line: 5 }] })] } } }])
  const sOf = (id) => two.stores.flatMap((s) => s.entities).find((e) => e.id === id)
  eq([two.logical, two.bindings.map((b) => [b.type, b.table, b.confidence, b.entities]), sOf('billing:dynamodb/sessions').fields.map((f) => f.name), (sOf('billing:dynamodb/sessions').bound || []).length, sOf('api:dynamodb/sessions').fields.map((f) => f.name)],
    [[], [['LoginSession', 'api:dynamodb/sessions', 'name-match', ['api:dynamodb/sessions']]], ['invoice'], 0, ['sid', 'user']],
    'two repositories each with their own sessions table: not one table, no conflict between them; the api code\'s literal binds its own repository\'s table only, and its fields stay off the other')

  // a table named only in test code says so, and ranks no higher than a name-match
  const tq = bindItems([types1('rust', 'src/probe.rs', [st('Probe', [fl('id', { k: 'string' })])]), { repo: 'r', extractor: 'serde@1', code: { path: 'src/probe_repo.rs', lang: 'rust', types: [], consts: [], notes: [], fns: [fn('put', 1, { converts: [{ type: 'Probe', line: 2, how: 'to_item' }] }), fn('tests::reads_the_table', 9, { test: true, env: [{ name: 'CUSTOMERS_TABLE', line: 10 }] })] } }], groups, entities, wiring)
  eq(tq.bindings.map((b) => [b.table, b.confidence, b.via, b.pairing, b.testOnly, bindingHow(b)]), [['{env}-{project}-customers', 'name-match', 'env', 'file', true, 'an environment variable the infra sets, in one file, named only in test code']], 'the variable is read only in a test: name-match, said to be named only in test code')

  // the extractors, through the pinned grammars
  const deps = await import('../lib/deps.mjs')
  if (!deps.findDeps()) {
    if (process.env.CI) { FAIL++; console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)') } else console.log('   - extractors skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  } else {
    const rt = await deps.loadRuntime({ install: false })
    const ps = { rust: await rt.parserFor('rust'), typescript: await rt.parserFor('typescript'), tsx: await rt.parserFor('tsx') }
    const ctx = { tree: (lang, t) => ps[lang].parse(t) }
    const { default: serde } = await import('../lib/data/extractors/serde.mjs')
    const { default: tsTypes } = await import('../lib/data/extractors/ts-types.mjs')
    const RS = [
      'use serde::{Deserialize, Serialize};',
      '#[derive(Debug, Serialize, Deserialize)]',
      '#[serde(rename_all = "camelCase")]',
      'pub struct Order {',
      '    pub order_id: String,',
      '    #[serde(rename = "pk")]',
      '    pub key: String,',
      '    pub r#type: Kind,',
      '    pub note: Option<String>,',
      '    #[serde(skip_serializing_if = "Vec::is_empty")]',
      '    pub tags: Vec<String>,',
      '    #[serde(default)]',
      '    pub gift: bool,',
      '    #[serde(default = "zero")]',
      '    pub retries: u32,',
      '    #[serde(skip)]',
      '    pub cache: Option<u64>,',
      '    #[serde(skip_serializing)]',
      '    pub digest: String,',
      '    #[serde(skip_deserializing)]',
      '    pub computed: u32,',
      '    #[serde(flatten)]',
      '    pub audit: Audit,',
      '    pub lines: Vec<Line>,',
      '    pub prices: HashMap<String, Price>,',
      '    pub shipping: Box<Address>,',
      '    #[serde(rename(serialize = "st", deserialize = "state"))]',
      '    pub status: Status,',
      '    pub pay: Payment,',
      '    pub legacy: Legacy,',
      '    pub ext: External,',
      '}',
      '#[derive(Serialize, Deserialize)]',
      '#[serde(default)]',
      'pub struct Audit { pub created_at: String, pub by: Option<UserId> }',
      '#[derive(Serialize, Deserialize)]',
      'pub struct UserId(String);',
      '#[derive(Serialize, Deserialize)]',
      'pub struct Line { pub sku: String }',
      '#[derive(Serialize, Deserialize)]',
      'pub struct Price { pub cents: i64 }',
      '#[derive(Serialize, Deserialize)]',
      '#[serde(transparent)]',
      'pub struct Address { pub text: String }',
      '#[derive(Serialize, Deserialize)]',
      '#[serde(rename_all = "snake_case")]',
      'pub enum Status { Open, OnHold }',
      '#[derive(Serialize, Deserialize)]',
      '#[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]',
      'pub enum Payment { Card { last_four: String }, #[serde(rename = "wire")] Bank { iban_hash: String }, Cash }',
      '#[derive(Serialize, Deserialize)]',
      '#[serde(untagged)]',
      'pub enum Legacy { V1 { old: String }, V2 { new_name: String } }',
      '#[derive(Serialize, Deserialize)]',
      'pub enum External { A { x: u8 }, B(u8), C }',
      '#[derive(Serialize, Deserialize)]',
      '#[serde(tag = "kind")]',
      'pub struct Event { pub id: String }',
      'pub struct Plain { pub a: u8 }',
      'const ORDERS: &str = "orders-v2";',
      'static TABLE: Lazy<String> = Lazy::new(|| std::env::var("ORDERS_TABLE").unwrap());',
      'impl Event { pub fn to_dynamo_item(&self) -> Item { serde_dynamo::to_item(self).unwrap() } }',
      'pub async fn put(client: &Client, stage: &str, order: &Order) -> Result<Option<Line>, Error> {',
      '    let item = serde_dynamo::to_item(order)?;',
      '    client.put_item().table_name(format!("{}-shop-orders", stage)).table_name(ORDERS).send().await?;',
      '    let e: Event = serde_dynamo::from_item(item.clone())?;',
      '    let ps = serde_dynamo::from_items::<_, Price>(items)?;',
      '    let a = Audit::from_dynamo_item(item.clone());',
      '    let t = std::env::var("PRICES_TABLE")?;',
      '    Ok(out.item.map(|i| serde_dynamo::from_item(i)).transpose()?)',
      '}',
      '#[cfg(test)]',
      'mod tests { #[test] fn t() { let x = "test-shop-orders"; } }',
    ].join('\n')
    const rc = serde.extract(RS, 'src/model.rs', ctx).code
    const order = rc.types.find((t) => t.name === 'Order')
    eq(order.fields.map((f) => [f.name, f.ident ?? null, f.nullable, f.default, !!f.flatten]), [
      ['orderId', 'order_id', false, null, false], ['pk', 'key', false, null, false], ['type', null, false, null, false], ['note', null, true, null, false], ['tags', null, true, null, false],
      ['gift', null, false, 'Default::default()', false], ['retries', null, false, 'zero', false], ['computed', null, false, null, false], ['audit', null, false, null, true], ['lines', null, false, null, false],
      ['prices', null, false, null, false], ['shipping', null, false, null, false], ['st', 'status', false, null, false], ['pay', null, false, null, false], ['legacy', null, false, null, false], ['ext', null, false, null, false],
    ], 'serde: rename_all camelCase, rename (and its serialize half), r#type stored as type, Option and skip_serializing_if nullable, default bare and with its function, skip_deserializing kept, flatten marked')
    eq(order.skipped, [{ ident: 'cache', why: 'skip' }, { ident: 'digest', why: 'skip_serializing' }], 'skip and skip_serializing: never stored, so not in the shape (listed)')
    eq(rc.types.map((t) => t.name), ['Order', 'Audit', 'UserId', 'Line', 'Price', 'Address', 'Status', 'Payment', 'Legacy', 'External', 'Event'], 'the types serde shapes (a struct with no derive is left out)')
    eq([rc.types.find((t) => t.name === 'Payment').variants.map((v) => [v.name, v.ident ?? null, (v.fields || []).map((f) => f.name)]), rc.types.find((t) => t.name === 'Status').variants.map((v) => v.name)],
      [[['card', 'Card', ['lastFour']], ['wire', 'Bank', ['ibanHash']], ['cash', 'Cash', []]], ['open', 'on_hold']], 'an enum: rename_all on its variants, a variant\'s rename, rename_all_fields on its struct variants\' fields')
    eq(rc.fns.map((f) => [f.name, f.converts.map((c) => `${c.type} ${c.how}`), f.names.map((n) => n.text), f.env.map((e) => e.name), f.uses, !!f.test]), [
      ['Event::to_dynamo_item', ['Event to_item'], [], [], [], false],
      ['put', ['Order to_item', 'Event from_item', 'Price from_items', 'Audit from_dynamo_item', 'Line from_item'], ['{}-shop-orders'], ['PRICES_TABLE'], ['ORDERS'], false],
      ['t', [], ['test-shop-orders'], [], [], true],
    ], 'uses per function (a method named by its type): each conversion\'s type (self in its impl, an argument\'s, a typed let, the turbofish, the path, the return type), the format! name, the environment read, the constant read; test code marked')
    eq([rc.consts.map((c) => [c.name, c.names.map((n) => n.text), c.env.map((e) => e.name)]), rc.types.find((t) => t.name === 'Event').converts], [[['ORDERS', ['orders-v2'], []], ['TABLE', [], ['ORDERS_TABLE']]], 62], 'constants holding a name or reading the environment; a type implementing a conversion')
    // the shape as stored, nested by path (data/binding.mjs)
    const shape = (rows, item) => bindItems(rows, [], new Map(), []).items.find((it) => it.name === item).fields.map((f) => `${f.path} ${f.kind}${f.nullable ? '?' : ''}${f.values ? ` [${f.values.join(',')}]` : ''}`)
    const rsRows = [{ repo: 'api', extractor: 'serde@1', code: rc }]
    eq(shape(rsRows, 'Order'), ['orderId string', 'pk string', 'type ref', 'note string?', 'tags list?', 'gift bool', 'retries number', 'computed number', 'created_at string', 'by string?', 'lines list', 'lines[].sku string', 'prices map', 'prices{}.cents number',
      'shipping string', 'st enum [open,on_hold]', 'pay object', 'pay.type enum [card,wire,cash]', 'pay.lastFour string', 'pay.ibanHash string', 'legacy object', 'legacy.old string', 'legacy.new_name string', 'ext object', 'ext.A object?', 'ext.A.x number', 'ext.B number?'],
      'the item as stored: flatten inlines (the flattened type\'s own rules), a newtype and a transparent struct are what they hold, a unit enum its stored names, a list\'s elements under [], a map\'s values under {}, internal tagging (the tag beside the fields), untagged, external (one member per variant, a unit variant none); a type no file defines kept as its name')
    eq([shape(rsRows, 'Event'), rc.types.find((t) => t.name === 'Event').tag], [['kind enum [Event]', 'id string'], 'kind'], 'a struct\'s tag stores its own name beside its fields')

    const TSX = [
      'export interface Base { id: string; createdAt: string }',
      'export interface Order extends Base {',
      "  status: 'open' | 'paid'",
      '  note?: string',
      '  total: number | null',
      '  lines: Line[]',
      '  tags: Array<string>',
      '  prices: Record<string, Price>',
      '  shipping: { city: string; zip?: string }',
      '  at: Date',
      '}',
      'export interface Line { sku: string; qty: number }',
      'export type Price = { cents: number }',
      "export type Status = 'a' | 'b'",
      'export type Named = Base & { name: string; status: Status }',
      'const TABLE = process.env.ORDERS_TABLE',
      'export async function save(o: Order) { await doc.send(new PutCommand({ TableName: TABLE, Item: o })) }',
      'export const load = async (): Promise<Named> => { const r = await doc.send(new GetCommand({ TableName: `${process.env.STAGE}-shop-named`, Key: {} })); return r.Item as Named }',
      "export function convert(item: Record<string, unknown>) { const l = unmarshall(item) as Line; return 'line-' + l.sku }",
      'class Repo { private table = process.env.REPO_TABLE; async put(x: Price) { return this.client.send(new PutCommand({ TableName: this.table, Item: marshall(x) })) } }',
    ].join('\n')
    const tc = tsTypes.extract(TSX, 'src/orders.ts', ctx).code
    eq(tc.types.map((t) => [t.name, t.kind, t.fields.map((f) => `${f.name}${f.nullable ? '?' : ''}`), t.extends ?? null, t.values ?? null]), [
      ['Base', 'interface', ['id', 'createdAt'], null, null], ['Order', 'interface', ['status', 'note?', 'total?', 'lines', 'tags', 'prices', 'shipping', 'at'], ['Base'], null], ['Line', 'interface', ['sku', 'qty'], null, null],
      ['Price', 'alias', ['cents'], null, null], ['Status', 'alias', [], null, ['a', 'b']], ['Named', 'alias', ['name', 'status'], ['Base'], null],
    ], 'TypeScript: interfaces and type aliases, `?` and `| null` nullable, extends and & kept, a union of string literals an enum')
    eq(tc.fns.map((f) => [f.name, f.converts.map((c) => `${c.type} ${c.how}`), f.names.map((n) => n.text), f.env.map((e) => e.name), f.uses]), [
      ['save', ['Order Item'], [], [], ['TABLE']], ['load', ['Named Item as'], ['{}-shop-named'], ['STAGE'], []], ['convert', ['Line unmarshall'], ['line-{}'], [], []], ['Repo.put', ['Price marshall'], [], [], ['Repo.table']],
    ], 'uses per function: an Item member, `.Item as T`, unmarshall(…) as T, marshall(x) of a typed parameter; a template literal\'s name and the environment it reads, a concatenation\'s name; a file constant and a class\'s own field read')
    eq(tc.consts.map((c) => [c.name, c.env.map((e) => e.name)]), [['TABLE', ['ORDERS_TABLE']], ['Repo.table', ['REPO_TABLE']]], 'constants: a file-level const, a class field')
    const tsRows = [{ repo: 'web', extractor: 'ts-types@1', code: tc }]
    eq(shape(tsRows, 'Order'), ['id string', 'createdAt string', 'status enum [open,paid]', 'note string?', 'total number?', 'lines list', 'lines[].sku string', 'lines[].qty number', 'tags list', 'prices map', 'prices{}.cents number', 'shipping object', 'shipping.city string', 'shipping.zip string?', 'at string'],
      'the TypeScript item as stored: what it extends first, nested object types, list elements and map values by path')
    eq(shape(tsRows, 'Named'), ['id string', 'createdAt string', 'name string', 'status enum [a,b]'], 'an intersection inlines the type it names; a field typed by an alias of literals is an enum')
    // a base's code is read aside in batches; a file that kills the reader fails alone
    const { extractAside } = await import('../lib/data/readers/code-aside.mjs')
    process.env.GRIMOIRE_TEST_ASIDE_CRASH = 'src/b.rs'
    let aside
    try { aside = extractAside([{ id: 'serde', path: 'src/a.rs', text: RS }, { id: 'serde', path: 'src/b.rs', text: RS }, { id: 'ts-types', path: 'src/c.ts', text: TSX }]) } finally { delete process.env.GRIMOIRE_TEST_ASIDE_CRASH }
    eq([aside.get('src/a.rs')?.code?.types?.length, aside.get('src/b.rs') instanceof Error ? aside.get('src/b.rs').message : null, aside.get('src/c.ts')?.code?.types?.length], [rc.types.length, 'the code reader stopped (70): not read', tc.types.length],
      'a batch the reader dies on is read again file by file: the file that killed it fails alone, the others are read')
  }
}

console.log('\n26 · access patterns: key-value SDK calls read per language (extractors/dynamo-access.mjs), resolved to the tables they reach, each index with its queries or a lead, writes the item does not state (data/access.mjs)')
{
  const { updatePaths, keyAttrs, projectionPaths, normPath, accessLevel } = await import('../lib/data/extractors/dynamo-access.mjs')
  const { covered, NO_ACCESS } = await import('../lib/data/access.mjs')
  // the expressions: what an update writes, a key condition's attributes, a projection
  const N = { '#s': 'status', '#a': 'audit', '#t': 'tags' }
  eq(updatePaths('SET #s = :s, lastSeen = if_not_exists(lastSeen, :now), #a.updatedBy = :u, #t = list_append(#t, :t) REMOVE draft, lines[2].note ADD visits :one DELETE labels :l', N),
    { writes: [{ path: 'status', clause: 'SET' }, { path: 'lastSeen', clause: 'SET' }, { path: 'audit.updatedBy', clause: 'SET' }, { path: 'tags', clause: 'SET' }, { path: 'draft', clause: 'REMOVE' }, { path: 'lines[].note', clause: 'REMOVE' }, { path: 'visits', clause: 'ADD' }, { path: 'labels', clause: 'DELETE' }], open: 0 },
    'an update: every SET, REMOVE, ADD and DELETE path, #names through the map, a list index as [], functions and their commas in values skipped')
  eq([updatePaths('set #x = :x, y = :y', {}), updatePaths('SET a=:a,b=:b', null).writes.map((w) => w.path), updatePaths('', {}).writes], [{ writes: [{ path: 'y', clause: 'SET' }], open: 1 }, ['a', 'b'], []], 'a #name the map lacks leaves its path open (not compared, counted); keywords in any case; no blank needed')
  eq([keyAttrs('#o = :o AND begins_with(placedAt, :p)', { '#o': 'ownerId' }), keyAttrs('pk = :pk AND sk BETWEEN :a AND :b', {}), projectionPaths('id, #o, lines[0].sku', { '#o': 'ownerId' }), normPath('#a.b[1][2].c', { '#a': 'x' })],
    [['ownerId', 'placedAt'], ['pk', 'sk'], ['id', 'ownerId', 'lines[].sku'], 'x.b[][].c'], 'a key condition\'s attributes (functions, keywords and :values left out), a projection\'s paths')
  // a written path against a shape: absent at the top, absent inside a struct whose fields are known; a map, an unexpanded type or a declared attribute not compared
  const shape = new Map([['id', new Set(['string'])], ['audit', new Set(['object'])], ['audit.by', new Set(['string'])], ['lines', new Set(['list'])], ['lines[].sku', new Set(['string'])], ['prices', new Set(['map'])], ['pay', new Set(['ref'])], ['gsiKey', new Set(['any'])]])
  const parents = new Set(['audit', 'lines[]'])
  eq(['id', 'nope', 'audit.by', 'audit.when', 'lines[].sku', 'lines[].qty', 'lines[]', 'prices.k.cents', 'pay.whatever', 'gsiKey.x', 'audit.by.deep'].map((p) => covered(p, shape, parents)),
    [true, false, true, false, true, false, true, true, true, true, true], 'a written path: absent at the top or inside a struct whose fields are known; a map\'s keys, a type not expanded and an attribute only the declarations type are not compared')
  eq(['src/a.rs', 'web/a.ts', 'web/a.mjs', 'jobs/a.py', 'svc/a.go', 'svc/b.go'].map((p, i) => accessLevel(p, ['x.index_name("I")', 'const p = { TableName: T }', "f({ 'IndexName': 'I' })", 'table = res.Table(name)', 'q := dynamodb.QueryInput{TableName: aws.String(t)}', 'func main() {}'][i])), [2, 2, 2, 2, 2, 0], 'found by content, per language (bit 2 of a source file\'s level)')

  // resolved on hand-written facts: a CreateTable table with four GSIs, an item type bound to it, the calls of two files
  const tableJson = JSON.stringify({ TableName: 'local-shop-orders', KeySchema: [{ AttributeName: 'customerId', KeyType: 'HASH' }, { AttributeName: 'orderId', KeyType: 'RANGE' }], AttributeDefinitions: ['customerId', 'orderId', 'status', 'sku', 'region', 'owner'].map((a) => ({ AttributeName: a, AttributeType: 'S' })),
    GlobalSecondaryIndexes: [['ByStatus', 'status'], ['BySku', 'sku'], ['ByRegion', 'region'], ['ByOwner', 'owner']].map(([n, a]) => ({ IndexName: n, KeySchema: [{ AttributeName: a, KeyType: 'HASH' }], Projection: { ProjectionType: 'KEYS_ONLY' } })) }, null, 1)
  const other = JSON.stringify({ TableName: 'local-shop-carts', KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }, { AttributeName: 'owner', AttributeType: 'S' }], GlobalSecondaryIndexes: [{ IndexName: 'ByOwner', KeySchema: [{ AttributeName: 'owner', KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } }] })
  const sink = (names = [], env = [], uses = []) => ({ names: names.map((text) => ({ text, line: 1 })), env, uses })
  const s0 = (line, x) => ({ line, fn: 0, op: 'query', table: null, index: null, key: null, writes: [], open: 0, item: null, projection: null, ...x })
  const rows = [
    { repo: 'api', extractor: 'dynamodb-table@1', facts: dynamodbTable.extract(tableJson, 'tables/orders.json') },
    { repo: 'api', extractor: 'dynamodb-table@1', facts: dynamodbTable.extract(other, 'tables/carts.json') },
    { repo: 'api', extractor: 'serde@1', facts: { declarations: [], code: { path: 'src/model.rs', lang: 'rust', notes: [], consts: [{ name: 'BY_SKU', line: 2, names: [{ text: 'BySku', line: 2 }], env: [] }],
      types: [{ name: 'Order', kind: 'struct', line: 4, end: 9, serde: true, fields: ['customerId', 'orderId', 'status', 'sku'].map((n, i) => ({ name: n, raw: 'String', t: { k: 'string' }, nullable: false, default: null, line: 5 + i })) }],
      fns: [{ name: 'save', line: 12, end: 16, converts: [{ type: 'Order', line: 13, how: 'to_item' }], names: [{ text: '{}-shop-orders', line: 14 }], env: [], uses: [] }] } } },
    { repo: 'api', extractor: 'dynamo-access@1', facts: { declarations: [], access: { lang: 'rust', path: 'src/orders.rs', notes: [], consts: [],
      fns: [{ name: 'by_status', line: 1, end: 5, ...sink(['{}-shop-orders']) }, { name: 'by_sku', line: 6, end: 9, ...sink([], [], ['BY_SKU']) }, { name: 'touch', line: 10, end: 14, ...sink() }, { name: 'tests::t', line: 20, end: 25, test: true, ...sink(['{}-shop-orders']) }],
      sites: [s0(2, { table: sink(['{}-shop-orders']), index: 'ByStatus', key: ['status'] }), s0(7, { fn: 1, table: sink(['{}-shop-orders']), indexConst: 'BY_SKU' }), s0(11, { fn: 2, op: 'update', table: sink(['{}-shop-orders']), writes: [{ path: 'status', clause: 'SET' }, { path: 'flagged', clause: 'SET' }] }),
        s0(21, { fn: 3, test: true, table: sink(['{}-shop-orders']), index: 'ByRegion' })] } } },
    { repo: 'api', extractor: 'dynamo-access@1', facts: { declarations: [], access: { lang: 'rust', path: 'src/owners.rs', notes: [], consts: [], fns: [{ name: 'any_owner', line: 1, end: 4, ...sink() }], sites: [s0(2, { index: 'ByOwner' })] } } },
  ]
  const M = reconcile(rows)
  const ord = M.stores[0].entities.find((e) => e.name === 'local-shop-orders'), cart = M.stores[0].entities.find((e) => e.name === 'local-shop-carts')
  const S = M.access.sites
  eq(S.map((s) => [s.fn, s.op, s.index, s.labels, s.pairing, s.ambiguous, s.test]), [['by_status', 'query', 'ByStatus', ['local-shop-orders'], 'call', false, false], ['by_sku', 'query', 'BySku', ['local-shop-orders'], 'call', false, false], ['touch', 'update', null, ['local-shop-orders'], 'call', false, false], ['tests::t', 'query', 'ByRegion', ['local-shop-orders'], 'call', false, true], ['any_owner', 'query', 'ByOwner', ['local-shop-carts', 'local-shop-orders'], 'index', true, false]],
    'each call\'s table: the name at the call matched on the table\'s literal parts; an index from a constant of another file (the binding\'s resolution); a call naming no table found by its index alone, the tables declaring it, ambiguous')
  eq(S[1].indexAt, { repo: 'api', path: 'src/model.rs', line: 2, text: 'BY_SKU' }, 'the constant the index name came from, at its line')
  eq(ord.access.indexes.map((i) => [i.name, i.sites.length, i.lead]), [['ByStatus', 1, null], ['BySku', 1, null], ['ByRegion', 1, 'no access found outside test code (lead): only tests name it; it may be reached through a constant built elsewhere, another repository, or a script'], ['ByOwner', 1, null]],
    'each index with the calls that query it; one only a test queries is a lead')
  eq(NO_ACCESS, 'no access found (lead): no IndexName or index_name naming it in the indexed repositories; it may be reached through a constant built elsewhere, another repository, or a script', 'the lead says what was searched and what it may have missed: never a verdict')
  const M2 = reconcile(rows.slice(0, 4).map((r) => (r.facts.access ? { ...r, facts: { ...r.facts, access: { ...r.facts.access, sites: r.facts.access.sites.slice(0, 3) } } } : r)))
  const ord2 = M2.stores[0].entities.find((e) => e.name === 'local-shop-orders')
  eq([ord2.access.indexes.map((i) => [i.name, i.lead === NO_ACCESS]), M2.access.leads], [[['ByStatus', false], ['BySku', false], ['ByRegion', true], ['ByOwner', true]], 3], 'an index no call names: "no access found", labelled a lead; counted once per table and index')
  eq([ord.access.conflicts.map((c) => [c.label, c.values.map((v) => [v.value, v.sources.map((s) => `${s.path}:${s.line} ${s.kind}`)])]), cart.access.conflicts],
    [[['local-shop-orders.flagged', [['written (SET)', ['src/orders.rs:11 inferred']], ['absent from the item (Order)', ['src/model.rs:4 code']]]]], []],
    'an attribute an update writes that the bound item does not state: a conflict, inferred against code, both sides cited; one the item states (status) is none')
  ok(ord.fields.every((f) => f.name !== 'flagged') && M.stores[0].entities.every((e) => e.fields.every((f) => f.sources.every((s) => s.kind !== 'inferred'))), 'the inferred write never becomes a field: the declared shape is never overridden')
  eq(storeSummary(M.stores[0]), '2 tables · 5 GSIs · 1 item type bound · 1 conflict', 'the store counts it with its conflicts')
  // an index declared on two tables, the call's own table naming one: narrowed to it, the other's lead says where it was named
  const M3 = reconcile([...rows.slice(0, 3), { repo: 'api', extractor: 'dynamo-access@1', facts: { declarations: [], access: { lang: 'rust', path: 'src/carts.rs', notes: [], consts: [], fns: [{ name: 'mine', line: 1, end: 4, ...sink() }], sites: [s0(2, { table: sink(['{}-shop-carts']), index: 'ByOwner' })] } } }])
  eq([M3.access.sites[0].labels, M3.stores[0].entities.find((e) => e.name === 'local-shop-orders').access.indexes.find((i) => i.name === 'ByOwner').lead], [['local-shop-carts'], 'no access found on this table (lead): 1 call names an index ByOwner of another table (local-shop-carts); it may be reached through a constant built elsewhere, another repository, or a script'],
    'a call naming its table and an index both tables declare: that table only; the other\'s index is a lead saying the name was queried elsewhere')
  // a failure while resolving leaves the binding answered
  const broken = reconcile([...rows.slice(0, 3), { repo: 'api', extractor: 'dynamo-access@1', facts: { declarations: [], access: { lang: 'rust', path: 'src/x.rs', notes: [], consts: [], fns: null, sites: [s0(1, { fn: 0 })] } } }])
  ok(/^the access patterns were not resolved: /.test(broken.accessError) && broken.bindings.length === 1 && !broken.access, `a failure while resolving: said, and the binding stands (${broken.accessError})`)

  // the readers, through the pinned grammars
  const deps = await import('../lib/deps.mjs')
  if (!deps.findDeps()) {
    if (process.env.CI) { FAIL++; console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)') } else console.log('   - readers skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  } else {
    const rt = await deps.loadRuntime({ install: false })
    const { default: access, ACCESS_LANGS } = await import('../lib/data/extractors/dynamo-access.mjs')
    const ps = {}
    for (const l of ACCESS_LANGS) ps[l] = await rt.parserFor(l)
    const ctx = { tree: (lang, t) => ps[lang].parse(t) }
    const read = (file, lines) => access.extract(lines.join('\n'), file, ctx).access
    const brief = (a) => a.sites.map((s) => [a.fns[s.fn]?.name ?? null, s.op, s.index ?? s.indexConst ?? s.indexExpr ?? null, s.table ? [...s.table.names.map((n) => n.text), ...s.table.env.map((e) => `$${e.name}`), ...s.table.uses] : null, s.key, s.writes.map((w) => `${w.clause} ${w.path}`), s.item, !!s.test])
    const rs = read('src/orders.rs', [
      'const BY_OWNER: &str = "ByOwner";',
      'impl Repo {',
      '    pub async fn list(&self, stage: &str) -> Result<(), Error> {',
      '        self.client.query().table_name(format!("{}-shop-orders", stage)).index_name(BY_OWNER)',
      '            .key_condition_expression("#o = :o").expression_attribute_names("#o", "ownerId").send().await?;',
      '        Ok(())',
      '    }',
      '    pub async fn touch(&self) {',
      '        self.client.update_item().table_name(&self.table).update_expression("SET #n = :n REMOVE old")',
      '            .set_expression_attribute_names(Some(HashMap::from([("#n".to_string(), "note".to_string())]))).send().await;',
      '        let leg = Update::builder().table_name(TABLE).update_expression(OTHER).build();',
      '        self.client.put_item().table_name(&self.table).item("id", a).item("kind", b).send().await;',
      '        eb.set_index_name(SHARED_INDEX).set_key_condition_expression("pk = :p");',
      '        let n = update.update_expression();',
      '        let d = client.describe_table().table_name(TABLE).send().await;',
      '    }',
      '}',
      '#[cfg(test)]',
      'mod tests { #[test] fn t() { client.query().table_name("test-shop-orders").index_name("ByStatus").send(); } }',
    ])
    eq(brief(rs), [
      ['Repo::list', 'query', 'ByOwner', ['{}-shop-orders'], ['ownerId'], [], null, false],
      ['Repo::touch', 'update', null, null, null, ['SET note', 'REMOVE old'], null, false],
      ['Repo::touch', 'update', null, ['TABLE'], null, [], null, false],
      ['Repo::touch', 'put', null, null, null, [], ['id', 'kind'], false],
      ['Repo::touch', 'query', 'SHARED_INDEX', null, ['pk'], [], null, false],
      ['t', 'query', 'ByStatus', ['test-shop-orders'], null, [], null, true],
    ], 'Rust: builder chains from the client or a builder type, their set_ forms, Some(…) unwrapped, a HashMap::from of names; an index through a constant of the file followed, one of another kept by name; a chain of the project\'s own naming an index; an accessor, and a chain on another operation, are no calls; test code marked')
    eq([rs.sites[0].table.names[0].line, rs.sites[4].indexConst, rs.sites[2].updateFrom], [4, 'SHARED_INDEX', 'OTHER'], 'each at its line; an expression from a constant of another file named, not read')
    const ts = read('src/orders.ts', [
      "import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'",
      'const TABLE = process.env.ORDERS_TABLE',
      "const BY_OWNER = 'ByOwner'",
      "const Indexes = { ByStatus: 'ByStatus' } as const",
      "enum Idx { Sku = 'BySku' }",
      "export async function list(doc: Doc) { return doc.send(new QueryCommand({ TableName: TABLE, IndexName: BY_OWNER, KeyConditionExpression: '#o = :o', ExpressionAttributeNames: { '#o': 'ownerId' }, ProjectionExpression: 'id, #o' })) }",
      'export class Repo {',
      '  private table = `${process.env.STAGE}-shop-orders`',
      "  async byStatus() { const params: QueryCommandInput = { TableName: this.table, IndexName: Indexes.ByStatus, KeyConditionExpression: 'status = :s' }; return this.doc.send(new QueryCommand(params)) }",
      '  async bySku() { const p = { TableName: this.table, IndexName: Idx.Sku }; return this.doc.query(p).promise() }',
      "  async tx() { return this.doc.send(new TransactWriteCommand({ TransactItems: [{ Update: { TableName: TABLE, Key: { id: 1 }, UpdateExpression: 'SET #s = :s, extra = :e', ExpressionAttributeNames: { '#s': 'status' } } }, { Put: { TableName: TABLE, Item: { id: 2, kind: 'x', note } } }] })) }",
      '}',
    ])
    eq(brief(ts), [
      ['list', 'query', 'ByOwner', ['TABLE'], ['ownerId'], [], null, false],
      ['Repo.byStatus', 'query', 'ByStatus', ['Repo.table'], ['status'], [], null, false],
      ['Repo.bySku', 'query', 'BySku', ['Repo.table'], null, [], null, false],
      ['Repo.tx', 'update', null, ['TABLE'], null, ['SET status', 'SET extra'], null, false],
      ['Repo.tx', 'put', null, ['TABLE'], null, [], ['id', 'kind', 'note'], false],
    ], 'TypeScript: a v3 command\'s input, one declared with its input type, one given to a DocumentClient method by name, a transaction\'s legs; constants, an object\'s and an enum\'s members followed; a class field naming the table kept for the binding')
    const js = read('lambda/handler.mjs', ["const docClient = new AWS.DynamoDB.DocumentClient()", "export const handler = async (e) => docClient.query({ TableName: process.env.EVENTS_TABLE, IndexName: 'ByDay', KeyConditionExpression: 'day = :d' }).promise()"])
    eq(brief(js), [['handler', 'query', 'ByDay', ['$EVENTS_TABLE'], ['day'], [], null, false]], 'JavaScript: the DocumentClient (SDK v2), its table from the environment')
    const py = read('reports/orders.py', [
      'import os',
      'import boto3',
      'from boto3.dynamodb.conditions import Key',
      'BY_OWNER = "ByOwner"',
      'dynamodb = boto3.resource("dynamodb")',
      'orders = dynamodb.Table(f"{os.environ[\'STAGE\']}-shop-orders")',
      'class Orders:',
      '    INDEX = "ByStatus"',
      '    def __init__(self):',
      '        self.table = dynamodb.Table(os.environ["ORDERS_TABLE"])',
      '    def by_owner(self, owner):',
      '        return orders.query(IndexName=BY_OWNER, KeyConditionExpression=Key("ownerId").eq(owner) & Key("placedAt").gt(0))',
      '    def by_status(self, s):',
      '        return self.table.query(IndexName=self.INDEX, KeyConditionExpression="#s = :s", ExpressionAttributeNames={"#s": "status"})',
      '    def touch(self, oid):',
      '        self.table.update_item(Key={"id": oid}, UpdateExpression="SET #n = :n, flagged = :t", ExpressionAttributeNames={"#n": "note"})',
      '        self.table.put_item(Item={"id": oid, "kind": "x"})',
      'def raw(client):',
      '    return client.query(TableName="prod-shop-orders", IndexName=SHARED, KeyConditionExpression="a = :a")',
      'def listing(session):',
      '    return session.query(User).all()',
      'def test_it():',
      '    orders.get_item(Key={"id": "1"})',
    ])
    eq(brief(py), [
      ['Orders.by_owner', 'query', 'ByOwner', ['{}-shop-orders', '$STAGE'], ['ownerId', 'placedAt'], [], null, false],
      ['Orders.by_status', 'query', 'ByStatus', ['$ORDERS_TABLE'], ['status'], [], null, false],
      ['Orders.touch', 'update', null, ['$ORDERS_TABLE'], null, ['SET note', 'SET flagged'], null, false],
      ['Orders.touch', 'put', null, ['$ORDERS_TABLE'], null, [], ['id', 'kind'], false],
      ['raw', 'query', 'SHARED', ['prod-shop-orders'], ['a'], [], null, false],
      ['test_it', 'get', null, ['{}-shop-orders', '$STAGE'], null, [], null, true],
    ], 'Python: boto3 on a Table (made in place, or through what it was assigned to, a module name or self.table; an f-string\'s name and the environment it reads) and on a client (TableName=); Key(…) conditions; module and class constants followed; a query with no key-value argument (an ORM\'s) is none; a test marked')
    eq(py.fns.map((f) => f.name), ['Orders.__init__', 'Orders.by_owner', 'Orders.by_status', 'Orders.touch', 'raw', 'test_it'], 'a function naming nothing and holding no call is left out, the calls still pointing at theirs')
    const go = read('store/orders.go', [
      'package store',
      'const byOwner = "ByOwner"',
      'var table = fmt.Sprintf("%s-shop-orders", os.Getenv("STAGE"))',
      'func (r *Repo) List(ctx context.Context) error {',
      '\t_, err := r.client.Query(ctx, &dynamodb.QueryInput{',
      '\t\tTableName: aws.String(table), IndexName: aws.String(byOwner), KeyConditionExpression: aws.String("#o = :o"),',
      '\t\tExpressionAttributeNames: map[string]string{"#o": "ownerId"},',
      '\t})',
      '\treturn err',
      '}',
      'func (r *Repo) Touch(ctx context.Context) {',
      '\tr.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: []types.TransactWriteItem{{Update: &types.Update{TableName: &table, UpdateExpression: aws.String("SET seen = :s REMOVE draft")}}}})',
      '\tr.client.PutItem(ctx, &dynamodb.PutItemInput{TableName: aws.String(table), Item: map[string]types.AttributeValue{"id": v, "kind": w}})',
      '}',
    ])
    eq(brief(go), [
      ['Repo.List', 'query', 'ByOwner', ['table'], ['ownerId'], [], null, false],
      ['Repo.Touch', 'update', null, ['table'], null, ['SET seen', 'REMOVE draft'], null, false],
      ['Repo.Touch', 'put', null, ['table'], null, [], ['id', 'kind'], false],
    ], 'Go: an input literal through aws.String and &, a transaction\'s types.Update leg, a literal item\'s keys; a package constant followed')
    eq([go.consts.map((c) => [c.name, c.names.map((n) => n.text), c.env.map((e) => e.name)])], [[['byOwner', ['ByOwner'], []], ['table', ['{}-shop-orders'], ['STAGE']]]], 'Go constants and variables naming a table: Sprintf\'s verbs as parts filled in, the environment it reads')
    const { inspect } = await import('../lib/data/registry.mjs')
    eq([inspect('src/a.rs', 'const X: &str = "x";\nfn f() { c.query().index_name("I"); }'), inspect('src/b.rs', 'fn f() { c.query().index_name("I"); }'), inspect('src/c.rs', '#[derive(Serialize)] struct A {}'), inspect('jobs/a.py', 'x = 1'), inspect('jobs/b.py', 't.query(IndexName="I")')], [3, 2, 1, 0, 2], 'a source file\'s level: 1 for the binding, 2 for the access patterns, both at once')
  }
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
    // ── 12 · the stores ──
    console.log('\n12 · a project of four repositories (fixtures/data)')
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

    // ── 13 · the Data tab ──
    console.log('\n13 · the Data tab of that project')
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

    // ── 14 · incremental ──
    console.log('\n14 · incremental refresh')
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

    // ── 15 · a branch against its base ──
    console.log('\n15 · a branch against its base (graph_changes), on a copy with two commits')
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

    // ── 16 · the branch against a design's delta ──
    console.log('\n16 · the branch against a design\'s delta (graph_changes --delta, render --delta)')
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
    // the page: the newest delta beside the specs first, or the one --delta names, read wherever it is
    const pageWith = (...a) => { const x = run('render', ...a, '--out', outFile); return x.status === 0 ? dataOf(readFileSync(outFile, 'utf8')).data : x.stderr.trim() }
    const P1 = pageWith()
    eq([P1.deltas.map((d) => d.shown), P1.delta, P1.deltas[1].changes.map((c) => `${c.id} ${c.state}`), P1.deltas[1].unplanned.map((u) => u.target)], [['docs/specs/broken.delta.json', 'docs/specs/2026-11-06-loans.delta.json'], 0, ['returned-on built-differently', 'labels planned-built', 'returned-idx pending', 'bio planned-built'], ['api:prisma/migrations/Member/index:Member_email_key']],
      'graph.mjs render: every delta beside the specs, the newest by name first; each change in the same state graph_changes gives, and the same unplanned change')
    writeFileSync(path.join(SANDBOX, 'elsewhere.delta.json'), JSON.stringify(DELTA))
    const P2 = pageWith('--delta', 'docs/specs/2026-11-06-loans.delta.json'), P3 = pageWith('--delta', path.join(SANDBOX, 'elsewhere.delta.json'))
    eq([P2.delta, P2.deltas[P2.delta].shown, P3.delta, P3.deltas.length, P3.deltas[0].shown === path.join(SANDBOX, 'elsewhere.delta.json'), P3.deltas[0].ackable, P3.deltas[1].ackable], [1, 'docs/specs/2026-11-06-loans.delta.json', 0, 3, true, false, true],
      'graph.mjs render --delta <file>: that delta shown first; one outside the specs is drawn too, never written (not ackable)')
    ok(/graph render: the delta nowhere\.delta\.json cannot be read \(ENOENT\)/.test(pageWith('--delta', 'nowhere.delta.json')), 'graph.mjs render --delta with a file that cannot be read exits 1 and says why')
    // graph_changes reads only a delta beside the specs of a project root: a model-chosen path is
    // never a way to read another file, nor to learn whether one exists
    const REFUSAL = 'delta: give a docs/specs/<name>.delta.json path inside the project, relative to its root'
    writeFileSync(path.join(SANDBOX, 'x.delta.json'), 'SECRET_VALUE=not-a-real-one\n')
    writeFileSync(path.join(SANDBOX, 'dotenv'), 'SECRET_VALUE=not-a-real-one\n')
    symlinkSync(path.join(SANDBOX, 'x.delta.json'), path.join(BR, 'docs/specs/linked.delta.json'))
    writeFileSync(path.join(BR, 'docs/specs/x.json'), JSON.stringify(DELTA))
    writeFileSync(path.join(BR, 'docs/specs/huge.delta.json'), JSON.stringify({ ...DELTA, spec: 'x'.repeat(600 * 1024) }))
    const probes = ['/etc/hosts', '../x.delta.json', '../dotenv', path.join(SANDBOX, 'x.delta.json'), 'docs/specs/linked.delta.json', 'docs/specs/x.json', 'docs/specs/nope.delta.json', 'docs/specs/../../x.delta.json', './docs/specs/2026-11-06-loans.delta.json', 'docs/specs/huge.delta.json', 'docs\\specs\\2026-11-06-loans.delta.json']
    const answers = []
    for (const delta of probes) answers.push(await call('graph_changes', { delta }, { root: BR }).then((x) => `answered: ${x.slice(0, 60)}`, (e) => e.message))
    ok(answers.every((a) => a === REFUSAL), `graph_changes refuses, in one message that says nothing of the file, an absolute path, a path out of the project, a symlink out, another extension, a missing delta, a path not plain, one past the size limit (${[...new Set(answers)].join(' | ')})`)
    ok((await br('changes', { delta: 'docs/specs/2026-11-06-loans.delta.json' })).includes('  pending  returned-idx'), '… and a delta beside the specs still answers')
    eq(run('changes', '--delta', '../dotenv').stderr.trim(), `graph: ${REFUSAL}`, 'graph.mjs changes --delta is the same tool, under the same rule')

    // ── 17 · the architecture: a worktree branch against its base checkout ──
    console.log('\n17 · the architecture in graph_changes: a branch adds an import no line draws (a worktree against its base checkout)')
    const MAIN = path.join(SANDBOX, 'arch-main'), FEAT = path.join(SANDBOX, 'arch-feat')
    const put = (dir, rel, text) => { mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); writeFileSync(path.join(dir, rel), text) }
    const DIAGRAM = 'docs/architecture/shop.architecture.json'
    const shop = { schema: 1, title: 'Shop', components: [{ id: 'web', label: 'Web', type: 'frontend', paths: ['src/web'] }, { id: 'api', label: 'API', type: 'backend', paths: ['src/api'] }, { id: 'store', label: 'Store', type: 'database', paths: ['src/store'] }],
      connections: [{ from: 'web', to: 'api', label: 'calls' }, { from: 'api', to: 'store', label: 'queries' }] }
    put(MAIN, 'grimoire.config.json', JSON.stringify({ repos: [{ name: 'shop', path: '.' }] }))
    put(MAIN, '.gitignore', '.grimoire/\n')
    put(MAIN, 'src/web/page.js', "import { listOrders } from '../api/orders.js'\nexport function render() { return listOrders() }\n")
    put(MAIN, 'src/api/orders.js', "import { query } from '../store/db.js'\nexport function listOrders() { return query('orders') }\n")
    put(MAIN, 'src/store/db.js', 'export function query(t) { return [t] }\n')
    put(MAIN, DIAGRAM, JSON.stringify(shop, null, 2) + '\n')
    put(MAIN, 'docs/specs/2026-11-07-stock.delta.json', JSON.stringify({ schema: 1, spec: 'docs/specs/2026-11-07-stock-design.md', data: [], architecture: [] }, null, 2) + '\n')
    git(MAIN, 'init', '-q', '-b', 'main')
    commit(MAIN, 'the shop')
    const inMain = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: MAIN })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    await inMain('index')
    git(MAIN, 'worktree', 'add', '-q', '-b', 'feat', FEAT)
    // the branch: the page reads the stock straight from the store, and no line of the diagram says so
    put(FEAT, 'src/web/page.js', "import { listOrders } from '../api/orders.js'\nimport { query } from '../store/db.js'\nexport function render() { return [listOrders(), query('stock')] }\n")
    const ft = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: FEAT })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    const plain = await ft('changes')
    const archPart = plain.slice(plain.indexOf('\n\nArchitecture') + 2).split('\n')
    ok(/^Architecture against main \(the index's base branch\) at [0-9a-f]{10}: no diagram file changed; in the code: 1 finding on the branch's index and not on the base checkout's \(main, .+arch-main\)$/.test(archPart[0]), `graph_changes covers the architecture: the diagrams against the base, then the code against the base checkout's index (${archPart[0]})`)
    eq(archPart.slice(1), ['In the code (the check, against the base checkout\'s index):', `  + web uses store (1 file pair in the graph), but no line is drawn between them  — ${DIAGRAM}  → connection:web->store`], 'the import the branch adds between two components no line joins: a new link no line draws')
    const DREL = 'docs/specs/2026-11-07-stock.delta.json'
    const archOf = async () => { const x = await ft('changes', { delta: DREL }); return x.slice(x.indexOf('\nArchitecture:') + 1).split('\n') }
    eq((await archOf()).slice(1), ['Unplanned (1): in the branch, in no change of the delta', `  + connection:web->store  web uses store (1 file pair in the graph), but no line is drawn between them  — ${DIAGRAM} (in the code, not drawn: update the diagram)`, 'Summary: 0 planned and built · 0 pending · 0 built differently · 1 unplanned · 0 acknowledged · 0 stale · 0 not acknowledged'],
      'with the delta: an unplanned architectural change')
    // the implementer keeps it: the ship appends it (origin unplanned), then the diagram is updated in the branch
    const r = spawnSync(process.execPath, [path.join(ROOT, 'delta-append.mjs'), path.join(FEAT, DREL), (() => { const f = path.join(SANDBOX, 'kept.json'); writeFileSync(f, JSON.stringify([{ id: 'unplanned-PROJ-1-stock', op: 'add', target: 'connection:web->store', after: { label: 'reads stock' }, why: 'the page shows the stock as it is', slice: 1, origin: 'unplanned' }])); return f })()], { encoding: 'utf8' })
    eq([r.stdout.trim(), JSON.parse(readFileSync(path.join(FEAT, DREL), 'utf8')).architecture.map((c) => c.target)], ['DELTA ok added=1 already=0 refused=0', ['connection:web->store']], 'delta-append.mjs routes the kept architectural change to the delta\'s architecture list')
    eq((await archOf()).slice(0, 4), ['Architecture: 1 change in the delta, against the saved diagrams and the branch against main (the index\'s base branch) at ' + archPart[0].split(' at ')[1].slice(0, 10), '  pending  unplanned-PROJ-1-stock  add connection:web->store', '    why: the page shows the stock as it is · slice 1 · unplanned, kept by the implementer · not acknowledged', 'Unplanned: none, every architectural change of the branch is in the delta'],
      'appended, it is planned: pending, not drawn yet, and nothing is unplanned')
    put(FEAT, DIAGRAM, JSON.stringify({ ...shop, connections: [...shop.connections, { from: 'web', to: 'store', label: 'reads stock' }] }, null, 2) + '\n')
    const built = await archOf()
    eq(built.slice(1, 3), [`  planned and built  unplanned-PROJ-1-stock  add connection:web->store  — ${DIAGRAM}`, '    why: the page shows the stock as it is · slice 1 · unplanned, kept by the implementer · not acknowledged'], 'the diagram updated in the branch draws it: planned and built')
    ok(built.includes('Unplanned: none, every architectural change of the branch is in the delta'), '… and the line the diagram gained is that change, not an unplanned one')
    has((await ft('changes')).split('\n\nArchitecture')[1] || '', `${DIAGRAM}  modified\n  + connection web → store  "reads stock"`, 'without the delta: the diagram\'s new line, against the base')
    has(spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), 'changes', '--delta', DREL, '--root', FEAT], { encoding: 'utf8' }).stdout, '  planned and built  unplanned-PROJ-1-stock  add connection:web->store', 'graph.mjs changes --delta prints the same')
    ok(!(await ft('changes', { repo: 'shop' })).includes('Architecture'), '`repo` leaves the architecture out')
    // the base checkout's index not at the fork point: main gains a module (its index not refreshed),
    // the branch merges main and changes nothing more. Its code is not compared, and graph_changes says
    // why, naming the checkout to refresh: what main did is never reported as the branch's impact
    const staleAt = git(MAIN, 'rev-parse', 'HEAD').stdout.trim()
    put(MAIN, 'src/extra/z.js', 'export const z = 3\n')
    const forkAt = commit(MAIN, 'a module on main')
    ok(git(FEAT, 'merge', '-q', '--ff-only', 'main').status === 0, 'the branch merges main')
    const staleOut = await ft('changes')
    const staleLine = staleOut.slice(staleOut.indexOf('\n\nArchitecture') + 2).split('\n')[0]
    eq(staleLine.split('; in the code: ')[1], `diagram files only, the code not compared (base index not at the fork point): the base checkout's index is at ${staleAt.slice(0, 7)}, the branch forked from ${forkAt.slice(0, 7)}: refresh it (\`graph.mjs index\` in ${realpathSync(MAIN)}) to compare what the code did`,
      'a base index not at the fork point: the code is not compared, the reason said with the checkout to refresh')
    ok(!staleOut.includes('src/extra') && !staleOut.includes('is in no component'), "main's new module is not reported as the branch's impact")
    const staleDelta = await archOf()
    ok(staleDelta.some((l) => l.startsWith('Unplanned: none in what was compared (diagram files only, the code not compared (base index not at the fork point): ')), `with the delta too: nothing unplanned is claimed from the code (${staleDelta.find((l) => l.startsWith('Unplanned'))})`)
    // a data-only project pays for no architecture and reads as on main: the data footer, untouched
    ok((await call('graph_changes', {}, { root: BR })).endsWith('\n\nLeads, not facts: both sides are read from migrations and generated files (the base through git at its commit, nothing checked out), never from a database, and a rename is only ever a candidate. Open path:line before relying on any of it.'), 'a project with no diagram: no architecture part, and the footer as before')

    // ── 20 · a key-value service: a SAM template and the local-dev table files ──
    console.log('\n20 · key-value tables through call(): a SAM template and local-dev CreateTable files (fixtures/kv), the key cards, a branch, a delta')
    const KV = path.join(SANDBOX, 'kv')
    cpSync(path.join(HERE, 'fixtures', 'kv'), KV, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
    const kq = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: KV })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    const kidx = await kq('index')
    ok(/lending: /.test(kidx) && !kidx.includes('failure'), `index: the YAML template and the JSON tables read, no extractor failure (${kidx.split('\n').find((l) => l.startsWith('lending')) || kidx})`)
    eq(await kq('sql', { sql: 'SELECT key, extractor FROM data_facts ORDER BY key' }), 'key\textractor\nlocal/tables/fines.json\tdynamodb-table@1\nlocal/tables/loans.json\tdynamodb-table@1\nsrc/handler.ts\tts-types@1\ntemplate.yaml\tcloudformation@2',
      'found by content: the template and the two CreateTable files are jobs, and the handler for its item shapes; the CI workflow and the settings file (JSON and YAML declaring no table) are not')
    const klist = await kq('data')
    eq(klist.split('\n').slice(1), [
      'lending:dynamodb  dynamodb  3 tables · 2 GSIs · 1 LSI · 4 conflicts',
      '  infra  dynamodb-table@1  CreateTable input  lending/local/tables/fines.json',
      '  infra  dynamodb-table@1  CreateTable input  lending/local/tables/loans.json',
      '  infra  cloudformation@2  SAM template, 2 tables  lending/template.yaml',
      '    note: HoldsTable: its TableName is !Sub ${AWS::StackName}-holds, a reference, not resolved: named by its logical id',
    ], 'graph_data: the repository\'s key-value store, every declaration labelled with its kind and format, the reference noted as unresolved')
    eq(await kq('data', { store: 'lending:dynamodb' }), [
      'lending:dynamodb  dynamodb  3 tables · 2 GSIs · 1 LSI · 4 conflicts',
      '  HoldsTable  table  2 attributes · partition (bookId) · sort (placedAt) · PAY_PER_REQUEST · no stream  lending/template.yaml:49',
      '  fines  table  3 attributes · partition (memberId) · sort (fineId) · 1 LSI · PROVISIONED · no stream  lending/local/tables/fines.json:2',
      '  loans  table  5 attributes · partition (memberId) · sort (loanId) · TTL (expiresAt) off · 2 GSIs · PAY_PER_REQUEST · no stream  lending/local/tables/loans.json:2 · lending/template.yaml:16  [4 conflicts]',
    ].join('\n'), 'graph_data store: each table with its keys, indexes, TTL, billing and stream (where two declarations disagree, the first\'s, by kind then path, as for SQL; the conflicts say the rest), citing every declaration')
    eq(await kq('data', { entity: 'loans' }), [
      'lending:dynamodb/loans  table  (dynamodb)',
      '  declared at lending/local/tables/loans.json:2 [infra dynamodb-table@1] · lending/template.yaml:16 [infra cloudformation@2, LoansTable (AWS::DynamoDB::Table)]',
      '  PAY_PER_REQUEST · no stream',
      'Attributes (5):',
      '  memberId  S  a key of the table  — lending/local/tables/loans.json:4 · lending/template.yaml:21',
      '  loanId  S  a key of the table  — lending/local/tables/loans.json:5 · lending/template.yaml:23',
      '  bookId  S  — lending/local/tables/loans.json:6 · lending/template.yaml:25',
      '  dueAt  N  — lending/local/tables/loans.json:7 · lending/template.yaml:27',
      '  branchId  S  — lending/local/tables/loans.json:8',
      'Keys (3):',
      '  partition (memberId)  — lending/local/tables/loans.json:11 · lending/template.yaml:30',
      '  sort (loanId)  — lending/local/tables/loans.json:12 · lending/template.yaml:32',
      '  TTL (expiresAt) off  — lending/local/tables/loans.json:29 · lending/template.yaml:42',
      'Indexes (2):',
      '  ByBook  global · partition (bookId) · sort (dueAt) · INCLUDE (dueAt, title)  — lending/local/tables/loans.json:15 · lending/template.yaml:35',
      '  ByBranch  global · partition (branchId) · KEYS_ONLY  — lending/local/tables/loans.json:23',
      'Conflicts (4): the declarations disagree; each side is kept',
      '  loans  stream: none — lending/local/tables/loans.json:2 [infra] | NEW_AND_OLD_IMAGES — lending/template.yaml:16 [infra]',
      '  loans.branchId  presence: declared — lending/local/tables/loans.json:8 [infra] | absent — lending/template.yaml:16 [infra]',
      '  loans ttl (expiresAt)  enabled: off — lending/local/tables/loans.json:29 [infra] | on — lending/template.yaml:42 [infra]',
      '  loans index ByBranch  presence: declared — lending/local/tables/loans.json:23 [infra] | absent — lending/template.yaml:16 [infra]',
    ].join('\n'), 'graph_data entity: both declarations kept and labelled; the differences (an extra GSI and its attribute, TTL off, no stream) are conflicts with each side\'s path:line')

    // the page: a key card per table, not an ERD
    const { renderGraph: renderKv } = await import('../lib/render.mjs')
    const { loadProject: loadKv } = await import('../lib/project.mjs')
    const kpage = await renderKv(loadKv(KV))
    const KD = dataOf(kpage).data
    eq(KD.stores.map((s) => [s.id, s.cards, s.layout, s.summary]), [['lending:dynamodb', true, null, '3 tables · 2 GSIs · 1 LSI · 4 conflicts']], 'the Data tab packs the store as key cards (no ERD layout), in graph_data\'s words')
    const kpg = await stubPage(kpage, '#data-0')
    const cards = kpg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || ''))
    const loansCard = cards.find((c) => kpg.textOf(c).startsWith('loans'))
    eq([cards.length, !kpg.erd(), cards.map((c) => kpg.textOf(c.kids[0]))], [3, true, ['HoldsTablePAY_PER_REQUESTno stream', 'finesPROVISIONEDno stream', 'loansPAY_PER_REQUESTno stream≠4']],
      '#data-0: a key card per table (no ERD), its header naming the table, its billing, its stream and its conflicts')
    const under = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); for (const k of n.kids || []) under(k, pred, out) } return out }
    const krows = (pg, card) => under(card, (n) => n.tagName === 'LI' && /\bkrow\b/.test(n.attrs.class || ''))
    eq(cards.map((c) => krows(kpg, c).map((r) => kpg.textOf(r)).filter((t) => !t.startsWith('A'))), [
      ['PKbookId S', 'SKplacedAt N'],
      ['PKmemberId S', 'SKfineId S', 'LSIByIssued · PK memberId S · SK issuedAt N · KEYS_ONLY'],
      ['PKmemberId S', 'SKloanId S', 'TTLexpiresAt · off≠ enabled', 'GSIByBook · PK bookId S · SK dueAt N · INCLUDE (title, dueAt)', 'GSIByBranch · PK branchId S · KEYS_ONLY≠ presence'],
    ], 'the rows: partition and sort keys with their attribute types, the TTL on or off, each GSI and LSI with its keys and projection; a row whose declarations disagree is badged')
    eq(krows(kpg, loansCard).filter((r) => kpg.textOf(r).startsWith('A')).map((r) => [kpg.textOf(r), r.attrs.title]), [['AmemberId S', 'lending/local/tables/loans.json:4 · lending/template.yaml:21'], ['AloanId S', 'lending/local/tables/loans.json:5 · lending/template.yaml:23'], ['AbookId S', 'lending/local/tables/loans.json:6 · lending/template.yaml:25'], ['AdueAt N', 'lending/local/tables/loans.json:7 · lending/template.yaml:27'], ['AbranchId S≠ presence', 'lending/local/tables/loans.json:8']],
      'the attributes with their types, each row citing the path:line of every declaration on hover')
    const kt = kpg.textOf(loansCard)
    ok(kt.includes('lending/template.yaml:16 LoansTable (AWS::DynamoDB::Table)') && kt.includes('lending/local/tables/loans.json:2') && kt.includes('Conflicts (4): each side kept, none resolved'), `the card cites both declarations, the template's labelled with its logical id and type, and lists its conflicts (${kt.slice(0, 400)})`)
    const holds = kpg.textOf(cards.find((c) => kpg.textOf(c).startsWith('HoldsTable')))
    ok(holds.includes('HoldsTable (AWS::DynamoDB::Table), TableName !Sub ${AWS::StackName}-holds'), 'a table named by its logical id shows its TableName expression as written, unresolved')
    kpg.search('branch')
    eq(kpg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || '')).map((c) => kpg.textOf(c.kids[0]).split('PAY')[0]), ['loans'], 'search narrows the cards to the tables whose name, attributes or indexes match')

    // escaping: a name from the file is text, never markup
    writeFileSync(path.join(KV, 'lending/local/tables/odd.json'), JSON.stringify({ TableName: 'odd</script><img src=x onerror=alert(1)>', AttributeDefinitions: [{ AttributeName: 'a"b<i>', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'a"b<i>', KeyType: 'HASH' }] }))
    await kq('index')
    const opage = await renderKv(loadKv(KV))
    ok(!/<\/script><img/.test(opage) && opage.includes('odd\\u003c/script>\\u003cimg'), 'the page blob escapes a table name holding markup')
    const opg = await stubPage(opage, '#data-0')
    const oddCard = opg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || '')).find((c) => opg.textOf(c).startsWith('odd'))
    ok(!!oddCard && oddCard.kids[0].kids.some((k) => k.tagName === 'B' && k.kids[0] === 'odd</script><img src=x onerror=alert(1)>') && !opg.all((n) => /<img|<script/i.test(n.html || '')).length, 'the card shows it as text: no element of the cards holds it as markup')
    rmSync(path.join(KV, 'lending/local/tables/odd.json'))
    // in the text answers, a name holding a line break cannot forge a line: it is quoted
    const FORGED = 'forged\n  + forged line'
    const forgedTable = (extra = {}) => JSON.stringify({ TableName: FORGED, KeySchema: [{ AttributeName: 'k\tey', KeyType: 'HASH' }], AttributeDefinitions: [{ AttributeName: 'k\tey', AttributeType: 'S' }], ...extra })
    writeFileSync(path.join(KV, 'lending/local/tables/forged.json'), forgedTable())
    await kq('index')
    const fstore = await kq('data', { store: 'lending:dynamodb' })
    ok(fstore.includes('  "forged\\n  + forged line"  table  1 attribute · partition ("k\\tey")') && !fstore.split('\n').includes('  + forged line'), `graph_data quotes a name holding a control character, as JSON, on its line (${fstore.split('\n').find((l) => l.includes('forged')) || fstore})`)
    rmSync(path.join(KV, 'lending/local/tables/forged.json'))
    // a YAML file past the cap fails its job, and is not read again until it changes
    const HUGE = path.join(KV, 'lending/infra/huge.yaml')
    mkdirSync(path.dirname(HUGE), { recursive: true })
    writeFileSync(HUGE, `Resources:\n  T:\n    Type: AWS::DynamoDB::Table\n# ${'x'.repeat(2 << 20)}\n`)
    const hidx = await kq('index')
    ok(hidx.includes('infra/huge.yaml (cloudformation@2): the YAML is larger than 512 KB: not read') && (await kq('status')).includes('extractor failure(s): cloudformation@2 on lending/infra/huge.yaml: the YAML is larger than 512 KB: not read'), `a YAML template past the cap: its job fails with the reason, graph_status says it (${hidx.split('\n').find((l) => l.includes('lending')) || hidx})`)
    utimesSync(HUGE, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
    const again = await kq('index')
    ok(!/huge\.yaml|data job\(s\) run|failure/.test(again) && (await kq('status')).includes('lending/infra/huge.yaml: the YAML is larger than 512 KB'), `indexed again, unchanged (its mtime moved, its content did not): its failure stands with its hash, the job is not run again (${again.split('\n').find((l) => l.includes('lending'))})`)
    rmSync(path.join(KV, 'lending/infra'), { recursive: true, force: true })
    await kq('index')

    // a branch against its base: the template's tables changed (graph_changes), the base's YAML read aside
    git(KV, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(KV, '.gitignore'), '.grimoire/\n')
    commit(KV, 'the lending service')
    git(KV, 'switch', '-q', '-c', 'feat')
    const T = path.join(KV, 'lending/template.yaml')
    writeFileSync(T, readFileSync(T, 'utf8').replace('            ProjectionType: INCLUDE\n            NonKeyAttributes: [title, dueAt]', '            ProjectionType: ALL\n        - IndexName: ByBranch\n          KeySchema:\n            - { AttributeName: branchId, KeyType: HASH }\n          Projection: { ProjectionType: KEYS_ONLY }')
      .replace('        - AttributeName: dueAt\n          AttributeType: N\n', '        - AttributeName: dueAt\n          AttributeType: N\n        - AttributeName: branchId\n          AttributeType: S\n').replace('        Enabled: true', '        Enabled: false').replace('      StreamSpecification:\n        StreamViewType: NEW_AND_OLD_IMAGES\n', ''))
    commit(KV, 'lending: a GSI per branch, the book GSI projects all, TTL off, no stream')
    await kq('index')
    const kch = await kq('changes')
    ok(/^Data model against main \(the index's base branch\) at [0-9a-f]{10}: 1 store changed · 0 added · 0 removed · 5 modified · 0 possible renames$/.test(kch.split('\n')[0]), `graph_changes: one line to sum it up (${kch.split('\n')[0]})`)
    const LJ = 'lending/local/tables/loans.json', TY = 'lending/template.yaml'
    eq(kch.split('\n').slice(1), [
      'lending:dynamodb  dynamodb  modified',
      `  ~ loans  table, 5 attributes, PAY_PER_REQUEST · no stream  stream in ${TY}: NEW_AND_OLD_IMAGES → none  — was ${LJ}:2 · ${TY}:16; now ${LJ}:2 · ${TY}:16`,
      `  ~ loans.branchId  attribute S  declared in: ${LJ} → ${LJ}, ${TY}  — was ${LJ}:8; now ${LJ}:8 · ${TY}:29`,
      `  ~ loans TTL (expiresAt) off  enabled in ${TY}: on → off  — was ${LJ}:29 · ${TY}:42; now ${LJ}:29 · ${TY}:47`,
      `  ~ loans index ByBook global · partition (bookId) · sort (dueAt) · INCLUDE (dueAt, title)  projection in ${TY}: INCLUDE (dueAt, title) → ALL  — was ${LJ}:15 · ${TY}:35; now ${LJ}:15 · ${TY}:37`,
      `  ~ loans index ByBranch global · partition (branchId) · KEYS_ONLY  declared in: ${LJ} → ${LJ}, ${TY}  — was ${LJ}:23; now ${LJ}:23 · ${TY}:43`,
    ], 'the branch against its base, compared declaration by declaration: what only the template changed is named with its file (the local file still says the old value), what the template now declares too is a change of where it is declared; the base\'s template read through git and parsed aside')

    // the branch against a design's delta: targets address the key-value elements
    const kplan = (id, op, target, extra) => ({ id, op, target, why: `because ${id}`, origin: 'planned', ...extra })
    const KDELTA = { schema: 1, spec: 'docs/specs/2026-11-07-lending-design.md', data: [
      kplan('ttl-off', 'change', 'lending:dynamodb/loans/key:ttl(expiresAt)', { after: { enabled: false }, slice: 1 }),
      kplan('by-branch', 'add', 'lending:dynamodb/loans/index:ByBranch', { after: { kind: 'gsi', partition: ['branchId'], projection: 'KEYS_ONLY' }, slice: 1 }),
      kplan('branch-attr', 'add', 'lending:dynamodb/loans.branchId', { after: { type: 'S', nullable: true }, slice: 1 }),
      kplan('holds-ttl', 'add', 'lending:dynamodb/HoldsTable/key:ttl(releasedAt)', { after: { enabled: true }, slice: 2 }),
    ], architecture: [] }
    mkdirSync(path.join(KV, 'docs/specs'), { recursive: true })
    writeFileSync(path.join(KV, 'docs/specs/2026-11-07-lending.delta.json'), JSON.stringify(KDELTA, null, 2) + '\n')
    const kdl = await kq('changes', { delta: 'docs/specs/2026-11-07-lending.delta.json' })
    eq(kdl.split('\n').slice(1), [
      `  planned and built  ttl-off  change lending:dynamodb/loans/key:ttl(expiresAt)  — ${LJ}:29 · ${TY}:47`,
      '    why: because ttl-off · slice 1 · not acknowledged',
      `  planned and built  by-branch  add lending:dynamodb/loans/index:ByBranch  — ${LJ}:23 · ${TY}:43`,
      '    why: because by-branch · slice 1 · not acknowledged',
      `  planned and built  branch-attr  add lending:dynamodb/loans.branchId  — ${LJ}:8 · ${TY}:29`,
      '    why: because branch-attr · slice 1 · not acknowledged',
      '  pending  holds-ttl  add lending:dynamodb/HoldsTable/key:ttl(releasedAt)',
      '    why: because holds-ttl · slice 2 · not acknowledged',
      'Unplanned (2): in the branch, in no change of the delta',
      `  ~ lending:dynamodb/loans  stream in ${TY}: NEW_AND_OLD_IMAGES → none  — was ${LJ}:2 · ${TY}:16; now ${LJ}:2 · ${TY}:16`,
      `  ~ lending:dynamodb/loans/index:ByBook  projection in ${TY}: INCLUDE (dueAt, title) → ALL  — was ${LJ}:15 · ${TY}:35; now ${LJ}:15 · ${TY}:37`,
      'Summary: 3 planned and built · 1 pending · 0 built differently · 2 unplanned · 0 acknowledged · 0 stale · 4 not acknowledged',
    ], 'graph_changes --delta: each key-value change\'s state against every declaration (a TTL off in both, a GSI and its attribute in both, a TTL pending), then the branch\'s changes no change covers, each named as a target')
    // a planned change one declaration has and the other not is not built
    const half = { ...KDELTA, data: [kplan('book-all', 'change', 'lending:dynamodb/loans/index:ByBook', { after: { projection: 'ALL' } })] }
    writeFileSync(path.join(KV, 'docs/specs/2026-11-07-half.delta.json'), JSON.stringify(half, null, 2) + '\n')
    eq((await kq('changes', { delta: 'docs/specs/2026-11-07-half.delta.json' })).split('\n').slice(1, 3), ['  built differently  book-all  change lending:dynamodb/loans/index:ByBook  — ' + `${LJ}:15 · ${TY}:37`, `    planned → built: projection: ALL → INCLUDE (dueAt, title) in ${LJ}`],
      'a change built in the template and not in the local file is built differently, the declaration that differs named')
    rmSync(path.join(KV, 'docs/specs/2026-11-07-half.delta.json'))

    // the page's overlays on the key cards
    const vpage = await renderKv(loadKv(KV))
    const vpg = await stubPage(vpage, '#data-0')
    const cardOf = (pg, name) => pg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || '')).find((c) => pg.textOf(c.kids[0]).startsWith(name))
    // a card's marked rows: { its marker and first words: its classes }
    const rowCls = (pg, card) => Object.fromEntries(under(card, (n) => n.tagName === 'LI' && /\bkrow /.test(n.attrs.class || '')).map((n) => [n.kids.slice(0, 2).map((k) => pg.textOf(k).split(' · ')[0]).join(''), n.attrs.class.replace('krow ', '')]))
    vpg.press('data-changes')
    const chLoans = cardOf(vpg, 'loans')
    eq([chLoans.attrs.class, rowCls(vpg, chLoans)], ['kcard ch-mod', { 'TTLexpiresAt': 'ch-mod', 'GSIByBook': 'ch-mod', 'GSIByBranch': 'ch-mod', 'AbranchId S': 'ch-mod' }],
      'Changes vs main: the card modified (amber), and every row the branch changed in one of its declarations')
    ok(vpg.textOf(chLoans).includes(`was: stream in ${TY}: NEW_AND_OLD_IMAGES → none`) && vpg.textOf(chLoans).includes(`was: projection in ${TY}: INCLUDE (dueAt, title) → ALL`) && vpg.textOf(chLoans).includes(`was: declared in: ${LJ} → ${LJ}, ${TY}`), 'each modified element says before → after, and in which declaration')
    vpg.press('data-delta')
    const dLoans = cardOf(vpg, 'loans'), dHolds = cardOf(vpg, 'HoldsTable')
    eq([rowCls(vpg, dLoans), rowCls(vpg, dHolds)], [{ 'TTLexpiresAt': 'dl-built', 'GSIByBook': 'dl-unpl', 'GSIByBranch': 'dl-built', 'AbranchId S': 'dl-built' }, { 'TTLreleasedAt': 'dl-prop' }],
      'Delta: what is planned and built green, the change no delta change covers in its own colour, the TTL the delta proposes for holds as a dashed row')
    ok(vpg.textOf(dLoans).includes('Delta: 3 changes, 2 not in the plan') && vpg.textOf(dHolds).includes('add lending:dynamodb/HoldsTable/key:ttl(releasedAt)'), 'each card lists the delta changes it carries, with their why and acknowledgement')
    // graph_changes quotes such a name too: an added table holding a line break forges no line
    writeFileSync(path.join(KV, 'lending/local/tables/forged.json'), forgedTable())
    await kq('index')
    const fch = await kq('changes')
    ok(fch.includes('  + "forged\\n  + forged line"  table, 1 attribute, billing not said · no stream  — lending/local/tables/forged.json:1') && !fch.split('\n').includes('  + forged line"  table, 1 attribute') && fch.split('\n').filter((l) => l.startsWith('  + forged line')).length === 0, `graph_changes quotes it on its line (${fch.split('\n').find((l) => l.includes('forged')) || fch})`)
    rmSync(path.join(KV, 'lending/local/tables/forged.json'))

    // ── 23 · Terraform and Terragrunt: a module run by a Terragrunt configuration ──
    console.log('\n23 · Terraform and Terragrunt through call(): a module run by a configuration that includes its root and an exposed file (fixtures/tf), an input from another configuration, secrets beside, a CreateTable file naming one of the tables')
    const TFP = path.join(SANDBOX, 'tf')
    cpSync(path.join(HERE, 'fixtures', 'tf'), TFP, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
    // secret-looking values, built at run time (no token sits in the repository): one in the module's
    // terraform.tfvars, one in the locals of the file the configuration includes
    const fake = (tag) => [tag, Array.from({ length: 28 }, (_, i) => 'qrstuvwxyz0123456789ABCDEF'[(i * 11 + tag.length) % 26]).join('')].join('_')
    const TFSECRET = fake('tfvar'), HCLSECRET = fake('local')
    writeFileSync(path.join(TFP, 'shop/modules/kv-tables/terraform.tfvars'), `api_token = "${TFSECRET}"\n`)
    const STAGE = path.join(TFP, 'shop/live/prod/stage.hcl')
    writeFileSync(STAGE, readFileSync(STAGE, 'utf8').replace('  stage = "prod"\n', `  stage       = "prod"\n  db_password = "${HCLSECRET}"\n`))
    const tq = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: TFP })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    const tidx = await tq('index')
    ok(/shop: /.test(tidx) && !tidx.includes('failure'), `index: the module, its configurations and the CreateTable file read, no extractor failure (${tidx.split('\n').find((l) => l.includes('shop')) || tidx})`)
    eq(await tq('sql', { sql: 'SELECT key, extractor FROM data_facts ORDER BY key' }), 'key\textractor\nlive/prod/legacy/terragrunt.hcl\tterraform@2\nlocal/tables/orders.json\tdynamodb-table@1\nmodules/kv-tables\tterraform@2',
      'found by content: the module folder (its job reads every HCL file), the configuration whose module is out of reach, the CreateTable file; the root, the stage file and the other configurations are inputs, no jobs')
    const SH = 'shop/live/prod/tables/terragrunt.hcl', MT = 'shop/modules/kv-tables/main.tf', OJ = 'shop/local/tables/orders.json'
    eq((await tq('data')).split('\n').slice(1), [
      'shop:dynamodb  dynamodb  3 tables · 3 GSIs · 2 conflicts',
      '  infra  terraform@2  not read: a module out of reach (tfr:///terraform-aws-modules/dynamodb-table/aws)  shop/live/prod/legacy/terragrunt.hcl',
      '    note: live/prod/legacy/terragrunt.hcl:2: its module tfr:///terraform-aws-modules/dynamodb-table/aws is not in this repository (a remote source): the key-value tables it declares, if any, are unknown',
      `  infra  terraform@2  Terraform module modules/kv-tables through Terragrunt, 3 tables  ${SH}`,
      '    note: prod-shop-audit: range_key is unknown (dependency.search: another configuration\'s output, known only once it is applied)',
      '    note: prod-shop-audit: its attribute blocks are unknown (dependency.search: another configuration\'s output, known only once it is applied)',
      `  infra  dynamodb-table@1  CreateTable input  ${OJ}`,
    ], 'graph_data: one key-value store for the repository, the Terraform module\'s instance beside the CreateTable file; the remote module found, not read; the unknown input noted')
    eq(await tq('data', { store: 'shop:dynamodb' }), [
      'shop:dynamodb  dynamodb  3 tables · 3 GSIs · 2 conflicts',
      `  prod-shop-audit  table  2 attributes · partition (id) · sort (\${dependency.search.outputs.sort_attr}) · TTL (expires_at) on · 1 GSI · PAY_PER_REQUEST · no stream  ${SH}:42 · ${MT}:2`,
      `  prod-shop-carts  table  1 attribute · partition (id) · TTL (no attribute) off · PAY_PER_REQUEST · no stream  ${SH}:36 · ${MT}:2`,
      `  prod-shop-orders  table  5 attributes · partition (customer_id) · sort (order_id) · TTL (expires_at) on · 2 GSIs · PAY_PER_REQUEST · stream NEW_AND_OLD_IMAGES  ${SH}:22 · ${MT}:2 · ${OJ}:2  [2 conflicts]`,
    ].join('\n'), 'graph_data store: a table per for_each key, named from the inputs merged through the includes, each citing its entry in the inputs and the module\'s resource')
    eq(await tq('data', { entity: 'prod-shop-orders' }), [
      'shop:dynamodb/prod-shop-orders  table  (dynamodb)',
      `  declared at ${SH}:22 [infra terraform@2, aws_dynamodb_table.table["orders"]] · ${MT}:2 [infra terraform@2, the resource in modules/kv-tables] · ${OJ}:2 [infra dynamodb-table@1]`,
      '  PAY_PER_REQUEST · stream NEW_AND_OLD_IMAGES',
      'Attributes (5):',
      `  customer_id  S  a key of the table  — ${SH}:23 · ${MT}:10 · ${OJ}:5`,
      `  order_id  S  a key of the table  — ${SH}:24 · ${MT}:15 · ${OJ}:6`,
      `  placed_at  N  — ${SH}:31 · ${MT}:23 · ${OJ}:8`,
      `  status  S  — ${SH}:30 · ${MT}:23 · ${OJ}:7`,
      `  sku  S  — ${OJ}:9`,
      'Keys (3):',
      `  partition (customer_id)  — ${SH}:23 · ${MT}:7 · ${OJ}:12`,
      `  sort (order_id)  — ${SH}:24 · ${MT}:8 · ${OJ}:13`,
      `  TTL (expires_at) on  — ${SH}:22 · ${MT}:45 · ${OJ}:28`,
      'Indexes (2):',
      `  ByStatus  global · partition (status) · sort (placed_at) · KEYS_ONLY  — ${SH}:28 · ${MT}:34 · ${OJ}:16`,
      `  BySku  global · partition (sku) · ALL  — ${OJ}:21`,
      'Conflicts (2): the declarations disagree; each side is kept',
      `  prod-shop-orders.sku  presence: declared — ${OJ}:9 [infra] | absent — ${SH}:22 [infra]`,
      `  prod-shop-orders index BySku  presence: declared — ${OJ}:21 [infra] | absent — ${SH}:22 [infra]`,
    ].join('\n'), 'graph_data entity: the Terraform table and the CreateTable file name it alike, so it is one table: keys, GSI and TTL at the inputs lines that state them, the module\'s lines beside; what only the file declares is a conflict with both sides')
    eq((await tq('data', { entity: 'prod-shop-audit' })).split('\n').filter((l) => /sort|Conflicts/.test(l)), [`  sort (\${dependency.search.outputs.sort_attr})  — ${SH}:44 · ${MT}:8`, 'Conflicts: none'], 'an input from dependency.*.outputs: unknown, shown as its expression at its line, never guessed')
    // secrets: what the evaluator read and no table uses reaches neither graph.db nor the page
    const GD = path.join(TFP, '.grimoire/graph')
    const stored = readdirSync(GD).filter((f) => statSync(path.join(GD, f)).isFile()).map((f) => [f, readFileSync(path.join(GD, f)).toString('latin1')])
    ok(stored.some(([f]) => f === 'graph.db') && stored.every(([, t]) => !t.includes(TFSECRET) && !t.includes(HCLSECRET)), `neither the tfvars value nor the included file's local is in the index (${stored.map(([f]) => f).join(', ')})`)
    const { renderGraph: renderTf } = await import('../lib/render.mjs')
    const { loadProject: loadTf } = await import('../lib/project.mjs')
    const tpage = await renderTf(loadTf(TFP))
    ok(!tpage.includes(TFSECRET) && !tpage.includes(HCLSECRET), 'nor in the page')
    // the page: a key card per table, the unknown drawn as such
    const tpg = await stubPage(tpage, '#data-0')
    const tcards = tpg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || ''))
    const tcard = (name) => tcards.find((c) => tpg.textOf(c.kids[0]).startsWith(name))
    const under2 = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); for (const k of n.kids || []) under2(k, pred, out) } return out }
    const audit = tcard('prod-shop-audit')
    const sk = under2(audit, (n) => n.tagName === 'LI' && /\bkrow\b/.test(n.attrs.class || '')).find((r) => tpg.textOf(r).startsWith('SK'))
    eq([tcards.length, tpg.textOf(sk), under2(sk, (n) => /\bunk\b/.test(n.attrs?.class || '')).length, sk.attrs.title], [3, 'SK${dependency.search.outputs.sort_attr} ?', 1, `${SH}:44 · ${MT}:8`], 'the card draws the unknown sort key as unknown (its expression, marked), citing the inputs line and the module\'s')
    ok(tpg.textOf(tcard('prod-shop-orders')).includes(`${SH}:22 aws_dynamodb_table.table["orders"]`) && tpg.textOf(tcard('prod-shop-orders')).includes(`${MT}:2 the resource in modules/kv-tables`), 'the orders card cites the inputs entry and the module\'s resource, each named')
    // a file that does not parse keeps its text out: a tfvars.json and a CreateTable file broken next to a
    // secret; and a symbolic link to a file out of the repository is not followed (an outside file's
    // values would land in the model as an in-repository auto.tfvars; the directory walk lists no link,
    // git does: below, once the project is a repository)
    const BROKEN = fake('broken'), OUTSECRET = fake('outside')
    writeFileSync(path.join(TFP, 'shop/modules/kv-tables/terraform.tfvars.json'), `{\n  "api_token": ${BROKEN},\n  "app": "shop"\n}\n`)
    writeFileSync(path.join(TFP, 'shop/local/tables/broken.json'), `{\n  "TableName": "x",\n  "KeySchema": [], "AttributeDefinitions": [],\n  "Token": ${BROKEN}\n}\n`)
    const OUTSIDE = path.join(SANDBOX, 'outside.tfvars')
    writeFileSync(OUTSIDE, `app = "leaked"\napi_token = "${OUTSECRET}"\n`)
    symlinkSync(OUTSIDE, path.join(TFP, 'shop/modules/kv-tables/zz.auto.tfvars'))
    const bidx = await tq('index')
    const blist = await tq('data')
    ok(blist.includes('    note: modules/kv-tables/terraform.tfvars.json does not parse: not valid JSON at line 2') && blist.includes('  dynamodb-table@1 on shop/local/tables/broken.json: not valid JSON at line 4'),
      `graph_data: the broken files at their line, none of their text (${blist.split('\n').filter((l) => /broken|tfvars|link/.test(l)).join(' | ')}; index: ${bidx.split('\n').find((l) => l.includes('shop'))})`)
    ok(!blist.includes('leaked') && (await tq('data', { store: 'shop:dynamodb' })).includes('  prod-shop-orders  table'), 'the link not followed: what the outside file says sets nothing')
    const stored2 = readdirSync(GD).filter((f) => statSync(path.join(GD, f)).isFile()).map((f) => readFileSync(path.join(GD, f)).toString('latin1'))
    const bpage = await renderTf(loadTf(TFP))
    ok(stored2.every((t) => !t.includes(BROKEN) && !t.includes(OUTSECRET)) && !bpage.includes(BROKEN) && !bpage.includes(OUTSECRET) && !blist.includes(BROKEN) && !(await tq('status')).includes(BROKEN), 'neither the broken files\' secret nor the outside file\'s is in graph.db, graph_data, graph_status or the page')
    for (const f of ['shop/modules/kv-tables/terraform.tfvars.json', 'shop/local/tables/broken.json', 'shop/modules/kv-tables/zz.auto.tfvars']) rmSync(path.join(TFP, f))
    await tq('index')
    // a name with an unknown part: its template (the stage file gone)
    rmSync(STAGE)
    await tq('index')
    eq((await tq('data', { store: 'shop:dynamodb' })).split('\n').slice(1).map((l) => l.trim().split('  ')[0]), ['prod-shop-orders', '{stage}-shop-audit', '{stage}-shop-carts', '{stage}-shop-orders'],
      'the file that set the stage is gone: each Terraform table is named by its template, and no longer meets the CreateTable file\'s exact name')
    const tmpl = await tq('data', { entity: '{stage}-shop-orders' })
    ok(tmpl.includes('  name template {stage}-shop-orders: a part of the name is unknown (each {…}), never guessed'), `graph_data entity says it is a template (${tmpl.split('\n').slice(0, 4).join(' | ')})`)
    const npg = await stubPage(await renderTf(loadTf(TFP)), '#data-0')
    const ncard = npg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || '')).find((c) => npg.textOf(c.kids[0]).startsWith('{stage}-shop-orders'))
    ok(!!ncard && npg.textOf(ncard.kids[0]).includes('name template'), 'its card says so, a pill beside the name')
    // a branch against its base: the inputs gain a GSI and lose a stream (the base's HCL read through git)
    writeFileSync(STAGE, 'locals {\n  stage = "prod"\n}\n')
    rmSync(path.join(TFP, 'shop/modules/kv-tables/terraform.tfvars'))
    git(TFP, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(TFP, '.gitignore'), '.grimoire/\n')
    commit(TFP, 'the shop')
    git(TFP, 'switch', '-q', '-c', 'feat')
    const TG = path.join(TFP, SH)
    writeFileSync(TG, readFileSync(TG, 'utf8').replace('      ttl      = false\n      indexes  = []', '      ttl      = false\n      indexes  = [{ name = "ByOwner", hash_key = "owner", projection = "ALL" }]').replace('      stream    = true\n', ''))
    commit(TFP, 'carts by owner, no stream on orders')
    await tq('index')
    eq((await tq('changes')).split('\n').slice(1), [
      'shop:dynamodb  dynamodb  modified',
      `  + prod-shop-carts.owner  attribute S  — ${SH}:38 · ${MT}:23`,
      `  + prod-shop-carts index ByOwner global · partition (owner) · ALL  — ${SH}:38 · ${MT}:34`,
      `  ~ prod-shop-orders  table, 5 attributes, PAY_PER_REQUEST · no stream  stream in ${SH}: NEW_AND_OLD_IMAGES → none  — was ${SH}:22 · ${MT}:2 · ${OJ}:2; now ${SH}:22 · ${MT}:2 · ${OJ}:2`,
    ], 'graph_changes: what the branch changed in the Terragrunt inputs, element by element, the change in one declaration named with its file (the CreateTable file still says the old value)')
    // in a repository, git lists the link: found, not read, and nothing of the outside file in the model
    const LINK = path.join(TFP, 'shop/modules/kv-tables/zz.auto.tfvars')
    symlinkSync(OUTSIDE, LINK)
    const lidx = await tq('index')
    const llist = await tq('data')
    ok(lidx.includes('modules/kv-tables/zz.auto.tfvars: a symbolic link to a file out of the repository: not read') && llist.includes('  data-inputs on shop/modules/kv-tables/zz.auto.tfvars: a symbolic link to a file out of the repository: not read') && (await tq('status')).includes('zz.auto.tfvars: a symbolic link to a file out of the repository: not read'),
      `a symbolic link to a file out of the repository: found, not read, said by the index, graph_data and graph_status (${llist.split('\n').find((l) => l.includes('zz.auto')) || lidx})`)
    const lstored = readdirSync(GD).filter((f) => statSync(path.join(GD, f)).isFile()).map((f) => readFileSync(path.join(GD, f)).toString('latin1'))
    ok(!llist.includes('leaked') && (await tq('data', { store: 'shop:dynamodb' })).includes('  prod-shop-orders  table') && lstored.every((t) => !t.includes(OUTSECRET)) && !(await renderTf(loadTf(TFP))).includes(OUTSECRET), 'not followed: the outside file sets no name, and its secret is in neither graph.db nor the page')
    rmSync(LINK)

    // ── 25 · item shapes bound to tables, across two repositories ──
    console.log('\n25 · item shapes and binding through call(): Terraform tables in one repository, a Rust and a TypeScript service and a local-dev CreateTable file in another (fixtures/bind)')
    const BP = path.join(SANDBOX, 'bind')
    cpSync(path.join(HERE, 'fixtures', 'bind'), BP, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
    const bq = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: BP })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    const bidx2 = await bq('index')
    ok(/infra: 3 files/.test(bidx2) && /api: 7 files/.test(bidx2) && !bidx2.includes('failure'), `index: both repositories, no extractor failure (${bidx2.replace(/\n/g, ' | ')})`)
    eq(await bq('sql', { sql: "SELECT repo, key, extractor FROM data_facts WHERE extractor LIKE 'serde%' OR extractor LIKE 'ts-types%' ORDER BY repo, key" }),
      'repo\tkey\textractor\napi\tnode/src/orders.ts\tts-types@1\napi\tnode/src/types.ts\tts-types@1\napi\tsrc/carts.rs\tserde@1\napi\tsrc/customers.rs\tserde@1\napi\tsrc/model.rs\tserde@1\napi\tsrc/orders.rs\tserde@1\napi\tsrc/reviews.rs\tserde@1',
      'found by content: each Rust and TypeScript file with a serde derive, a type, a conversion or an environment read is a job of its own')
    const ORD = '{env}-{project}-orders', TFMAIN = 'infra/modules/shop-tables/main.tf'
    eq((await bq('data')).split('\n').filter((l) => !/^ {2}(infra|  note)/.test(l)), [
      'Data stores (2), read from migrations, snapshots and table declarations:',
      'api:dynamodb  dynamodb  2 tables · 1 GSI · 2 item types bound · 2 conflicts',
      'infra:dynamodb  dynamodb  5 tables · 0 GSIs · 5 item types bound · 2 conflicts',
      'Logical tables (1), one table declared in several places (the same name template, or an exact name a template matches on its literal parts; never by a guess, never by a bare name across repositories):',
      `  ${ORD}  api:dynamodb/local-shop-orders + infra:dynamodb/${ORD}  (an exact name its template matches)  [2 conflicts across them]`,
      'Item types (6), the types code converts to or from an item: 5 bound to a table, 1 unbound',
      '  api:Cart  ambiguous: {env}-{project}-carts | {env}-{project}-saved_carts (a name the table\'s name or template matches, in one function)  api/src/model.rs:63',
      '  api:Coupon  unbound: no table name or environment variable pairs with its conversions  api/src/model.rs:77',
      '  api:Customer  → {env}-{project}-customers  convention (an environment variable the infra sets, in one function)  api/src/model.rs:55',
      `  api:Order  → ${ORD}  name-match (a name the table's name or template matches, in one function)  api/src/model.rs:7`,
      `  api:OrderView  → ${ORD}  convention (an environment variable the infra sets, in one function)  api/node/src/types.ts:2`,
      '  api:Review  → {env}-{project}-reviews  name-match (a name the table\'s name or template matches, in one file, named only in test code)  api/src/model.rs:69',
      'Access patterns (inferred from key-value SDK calls; leads, never verdicts): 7 calls in 5 files, 7 reaching a table; 1 index with no access found (graph_data with a table lists them)',
    ], 'graph_data: the infra repository\'s tables bound to the api repository\'s types; the local-dev file\'s orders and the prod template one logical table, the local-dev Customers apart; each item type with its table and confidence, the ambiguous one with both tables, the unbound one listed; the access patterns in one line')
    const oe = await bq('data', { entity: `infra:dynamodb/${ORD}` })
    const sect = (text, head) => { const ls = text.split('\n'), i = ls.findIndex((l) => l.startsWith(head)); if (i < 0) return []; const out = [ls[i]]; for (const l of ls.slice(i + 1)) { if (!l.startsWith(' ')) break; out.push(l) } return out }
    eq(sect(oe, 'Item ('), [
      'Item (17 fields, as Order and OrderView store them; nested by dotted path):',
      '  customerId  Order: String · OrderView: string  [partition key]  — api/src/model.rs:8 · api/node/src/types.ts:3',
      '  orderId  Order: String · OrderView: string  [sort key]  — api/src/model.rs:9 · api/node/src/types.ts:4',
      "  status  Order: OrderStatus (OPEN | PAID | ON_HOLD) · OrderView: 'OPEN' | 'PAID' | 'ON_HOLD'  — api/src/model.rs:10 · api/node/src/types.ts:5",
      '  total  Order: u64 · OrderView: number  — api/src/model.rs:12 · api/node/src/types.ts:6',
      '  note  Order: Option<String>, nullable · OrderView: string | null, nullable  — api/src/model.rs:13 · api/node/src/types.ts:7',
      '  lines  Order: Vec<LineItem> · OrderView: { sku: string; qty: number }[]  — api/src/model.rs:14 · api/node/src/types.ts:8',
      '    lines[].sku  Order: String · OrderView: string  — api/src/model.rs:35 · api/node/src/types.ts:8',
      '    lines[].qty  Order: u32 · OrderView: number  — api/src/model.rs:36 · api/node/src/types.ts:8',
      '  coupons  HashMap<String, u32>  — api/src/model.rs:15',
      '  created_at  String  — api/src/model.rs:41',
      '  updated_at  Option<String>, nullable  — api/src/model.rs:43',
      '  gift  bool, default Default::default()  — api/src/model.rs:19',
      '  payment  Payment  — api/src/model.rs:22',
      '    payment.method  tag (card | gift-card | invoice)  — api/src/model.rs:48',
      '    payment.details  content  — api/src/model.rs:48',
      '      payment.details.last4  String  — api/src/model.rs:49',
      '      payment.details.code  String  — api/src/model.rs:50',
    ], 'graph_data entity: the item tree, as both bound types store it (serde\'s rename_all, rename, flatten with the flattened type\'s own names, default, skip; TypeScript\'s `?` and literal union), the keys marked, each field at its code line in the other repository')
    eq(sect(oe, 'Bound item types'), [
      'Bound item types (2): how code pairs each with this table (below convention, a lead: its rivals listed)',
      '  Order  name-match  a name the table\'s name or template matches, in one function, 2 sites  api/src/model.rs:7',
      '    converts  Order (to_item) in put_order  api/src/orders.rs:5',
      '    builds  {}-shop-orders  api/src/orders.rs:8',
      '  OrderView  convention  an environment variable the infra sets, in one function  api/node/src/types.ts:2',
      '    converts  OrderView (Item) in saveOrder  api/node/src/orders.ts:7',
      '    const  TABLE  api/node/src/orders.ts:4',
      '    reads  ORDERS_TABLE  api/node/src/orders.ts:4',
      `    sets  ORDERS_TABLE = ${ORD}  ${TFMAIN}:31`,
    ], 'each binding with its confidence and evidence: the Rust conversion beside the format! name its template matches; the TypeScript one through a constant reading the variable the Terraform function sets to the table')
    eq(sect(oe, 'Conflicts across them'), [
      'Conflicts across them (2): each declaration kept',
      `  ${ORD}.status  presence: declared — api/dynamodb/tables/orders.json:10 [infra] | absent — infra/live/prod/terragrunt.hcl:8 [infra]`,
      `  ${ORD} index ByStatus  presence: declared — api/dynamodb/tables/orders.json:13 [infra] | absent — infra/live/prod/terragrunt.hcl:8 [infra]`,
    ], 'local-dev against prod: the CreateTable file\'s GSI and its attribute, absent from the Terraform table its template matches, are conflicts with both sides')
    ok(oe.includes(`One logical table: api:dynamodb/local-shop-orders + infra:dynamodb/${ORD} (an exact name its template matches); their differences are conflicts`) && oe.includes('Conflicts: none'), 'the table says which declarations are one, and keeps its own conflicts apart')
    eq(sect(await bq('data', { entity: '{env}-{project}-carts' }), 'Bound item types'), [
      'Bound item types (1): how code pairs each with this table (below convention, a lead: its rivals listed)',
      '  Cart  ambiguous  a name the table\'s name or template matches, in one function  api/src/model.rs:63',
      '    converts  Cart (to_item) in save_for_later  api/src/carts.rs:5',
      '    builds  {}-shop-carts  api/src/carts.rs:7',
      '    rivals: {env}-{project}-saved_carts (ambiguous, a name the table\'s name or template matches, in one function)',
    ], 'the ambiguous case: one function names two tables, each binding lists the other as its rival')
    const rv = await bq('data', { entity: '{env}-{project}-reviews' })
    ok(rv.includes('  Review  name-match  a name the table\'s name or template matches, in one file, named only in test code  api/src/model.rs:69') && rv.includes('    builds  test-shop-reviews  api/src/reviews.rs:27  (test code)'), 'co-occurrence in one file: the conversion, and the name its test builds (said to be test code)')
    const cu = await bq('data', { entity: 'Customers' })
    ok(cu.includes('Bound item types: none') && !cu.includes('logical') && (await bq('data', { entity: '{env}-{project}-customers' })).includes('  Customer  convention  an environment variable the infra sets, in one function'),
      'the local-dev Customers (another naming) binds to nothing and joins no logical table: no rule states it; the prod table takes the type through its variable')
    eq((await bq('data', { store: 'api:dynamodb' })).split('\n')[2], '  local-shop-orders  table  3 attributes · 14 item fields · partition (customerId) · sort (orderId) · 1 GSI · PAY_PER_REQUEST · no stream  api/dynamodb/tables/orders.json:2  items: Order (name-match), OrderView (convention)  [one table with infra:dynamodb/{env}-{project}-orders]',
      'graph_data store: the local-dev table carries the item of the logical table it is one declaration of')

    // the page: the item tree on each card, the bindings (dashed below convention), the rivals, the conflicts across declarations, the unbound type
    const { renderGraph: renderBind } = await import('../lib/render.mjs')
    const { loadProject: loadBind } = await import('../lib/project.mjs')
    const bpage2 = await renderBind(loadBind(BP))
    const bdata = dataOf(bpage2).data
    const infraAt = bdata.stores.findIndex((s) => s.id === 'infra:dynamodb'), apiAt = bdata.stores.findIndex((s) => s.id === 'api:dynamodb')
    eq(bdata.items.map((it) => [it.id, it.bound.map((b) => `${b.table} ${b.conf}`)]), [['api:Cart', ['{env}-{project}-carts ambiguous', '{env}-{project}-saved_carts ambiguous']], ['api:Coupon', []], ['api:Customer', ['{env}-{project}-customers convention']], ['api:Order', [`${ORD} name-match`]], ['api:OrderView', [`${ORD} convention`]], ['api:Review', ['{env}-{project}-reviews name-match']]],
      'the page packs the item types with their tables, in graph_data\'s words')
    const bpg = await stubPage(bpage2, `#data-${infraAt}`)
    const kcards = bpg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || ''))
    const kcard = (name) => kcards.find((c) => bpg.textOf(c.kids[0]).startsWith(name))
    const ocard = kcard(ORD)
    const rowsOf = (card, cls) => bpg.all((n) => n.tagName === 'UL' && (n.attrs.class || '').includes(cls)).filter((u) => within(card, u)).flatMap((u) => u.kids.filter((k) => k && k.tagName === 'LI').map((k) => bpg.textOf(k)))
    const within = (root, target) => { if (root === target) return true; for (const k of root.kids || []) if (k && typeof k === 'object' && within(k, target)) return true; return false }
    eq(rowsOf(ocard, 'kitem').slice(0, 3), ['PKcustomerId Order: String · OrderView: string', 'SKorderId Order: String · OrderView: string', "Estatus Order: OrderStatus (OPEN | PAID | ON_HOLD) · OrderView: 'OPEN' | 'PAID' | 'ON_HOLD'"], 'the card\'s item tree: each field as each bound type stores it, the keys marked')
    ok(rowsOf(ocard, 'kitem').length === 17 && bpg.all((n) => n.tagName === 'LI' && /\bd2\b/.test(n.attrs.class || '') && within(ocard, n)).length === 2, 'nested fields indented by depth (payment.details.last4 and .code two levels down)')
    const binds = bpg.all((n) => n.tagName === 'DIV' && /\bkbind\b/.test(n.attrs.class || '') && within(ocard, n))
    eq(binds.map((b) => [b.attrs['data-conf'], /\bdash\b/.test(b.attrs.class)]), [['name-match', true], ['convention', false]], 'the bindings: below convention dashed, a convention solid')
    const ccard = kcard('{env}-{project}-carts')
    ok(bpg.textOf(ccard).includes('rivals: {env}-{project}-saved_carts (ambiguous'), 'the ambiguous binding lists its rival on the card')
    ok(bpg.textOf(ocard).includes('One logical table: 2 declarations, 2 conflicts across them') && bpg.textOf(ocard).includes('index ByStatus'), 'the card says it is one table with the local-dev declaration, and lists the conflicts across them')
    const items = bpg.ctl('data-items')
    ok(!!items && bpg.textOf(items).includes('Item types (6), from code: 5 bound to a table, 1 unbound') && bpg.textOf(items).includes('api:Coupon unbound'), 'the Data tab lists the item types, the unbound one badged')
    const apg = await stubPage(bpage2, `#data-${apiAt}`)
    const acards = apg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || ''))
    ok(apg.textOf(acards.find((c) => apg.textOf(c.kids[0]).startsWith('local-shop-orders'))).includes('≡ 2 declarations') && !apg.textOf(acards.find((c) => apg.textOf(c.kids[0]).startsWith('Customers'))).includes('≡'), 'the local-dev card: one of two declarations; Customers, one alone')

    // a branch against its base: the item gains a field and one changes (the base's code read aside)
    git(BP, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(BP, '.gitignore'), '.grimoire/\n')
    commit(BP, 'the shop')
    git(BP, 'switch', '-q', '-c', 'feat')
    const MR = path.join(BP, 'api/src/model.rs')
    writeFileSync(MR, readFileSync(MR, 'utf8').replace('    pub gift: bool,\n', '    pub gift: bool,\n    pub currency: String,\n').replace('    pub qty: u32,', '    pub qty: Option<u32>,'))
    commit(BP, 'orders: a currency; a quantity may be absent')
    await bq('index')
    const bch = (await bq('changes')).split('\n')
    ok(bch.includes(`  + ${ORD}.currency  item field, Order: String  — api/src/model.rs:20`) && bch.some((l) => l.startsWith(`  ~ ${ORD}.lines[].qty  item field, Order: Option<u32>, nullable · OrderView: number  item: Order: u32 · OrderView: number → Order: Option<u32>, nullable · OrderView: number`)),
      `graph_changes: the item field added and the one changed, addressed <table>.<field path> (${bch.filter((l) => /currency|qty/.test(l)).join(' | ')})`)
    ok(bch.includes('  + local-shop-orders.currency  item field, Order: String  — api/src/model.rs:20'), 'the local-dev declaration of the same table, bound the same way, changes alike')
    const { parseTarget: pt, findTarget: findT } = await import('../lib/data/delta.mjs')
    const { reconcile: rec } = await import('../lib/data/reconcile.mjs')
    const { openStore } = await import('../lib/store.mjs')
    const bdb = await openStore(path.join(BP, '.grimoire/graph/graph.db'))
    const bmodel = rec(bdb.prepare('SELECT repo, extractor, facts FROM data_facts WHERE facts IS NOT NULL ORDER BY repo, key, extractor').all().map((r) => ({ repo: r.repo, extractor: r.extractor, facts: JSON.parse(r.facts) })))
    bdb.close()
    const tgt = pt(`infra:dynamodb/${ORD}.lines[].qty`)
    eq([tgt.entity, tgt.kind, tgt.el.name, findT(bmodel, tgt).el?.name], [ORD, 'field', 'lines[].qty', 'lines[].qty'], 'a delta addresses an item field as <table>.<field path>: it resolves')
    // a type that holds itself, in Rust and in TypeScript: every data tool still answers
    writeFileSync(path.join(BP, 'api/src/tree.rs'), ['use serde::{Deserialize, Serialize};', '#[derive(Serialize, Deserialize)]', 'pub struct Node(Option<Box<Node>>);', '#[derive(Serialize, Deserialize)]', 'pub struct Tree { pub root: Node }', 'impl Tree { pub fn to_item(&self) -> Item { serde_dynamo::to_item(self).unwrap() } }', ''].join('\n'))
    writeFileSync(path.join(BP, 'api/node/src/loop.ts'), 'export type A = B\nexport type B = Partial<A>\nexport interface Looped { f: A }\nexport function put(x: Looped) { return marshall(x) }\n')
    await bq('index')
    const cyc = await bq('data')
    const cent = await bq('data', { entity: `infra:dynamodb/${ORD}` }), cch = await bq('changes'), cpage = dataOf(await renderBind(loadBind(BP))).data
    ok(cyc.includes('  api:Tree  unbound') && cyc.includes('  api:Looped  unbound'), `a newtype holding itself and two aliases holding each other: graph_data answers (${cyc.split('\n').filter((l) => /Tree|Looped/.test(l)).join(' | ')})`)
    ok(cent.includes('Item (18 fields') && cch.includes('currency') && cpage.items.some((it) => it.id === 'api:Tree'), `… and so do graph_data entity, graph_changes and the page (${cent.split('\n').find((l) => l.startsWith('Item')) || cent.slice(0, 200)})`)

    console.log('\n27 · access patterns through call(): a Rust service and a Python job reaching one table (fixtures/access): each index with the functions querying it or a lead, a write the item does not state, the readers and writers')
    const AP = path.join(SANDBOX, 'access')
    cpSync(path.join(HERE, 'fixtures', 'access'), AP, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
    const aq = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: AP })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    const aidx = await aq('index')
    ok(/catalog: 3 files/.test(aidx) && /reports: 1 files/.test(aidx) && !aidx.includes('failure'), `index: both repositories, no extractor failure (${aidx.replace(/\n/g, ' | ')})`)
    eq(await aq('sql', { sql: "SELECT repo, key, extractor FROM data_facts WHERE extractor LIKE 'dynamo-access%' ORDER BY repo, key" }), 'repo\tkey\textractor\ncatalog\tsrc/books.rs\tdynamo-access@1\nreports\treports/genres.py\tdynamo-access@1',
      'found by content: the Rust and the Python file making key-value calls (the model and the index names hold none)')
    const alist = (await aq('data')).split('\n')
    eq([alist[1], alist[alist.length - 1]], ['catalog:dynamodb  dynamodb  1 table · 4 GSIs · 1 item type bound · 1 conflict', 'Access patterns (inferred from key-value SDK calls; leads, never verdicts): 7 calls in 2 files, 7 reaching a table; 1 index with no access found (graph_data with a table lists them)'],
      'graph_data: the store counts the inferred conflict with its own; the access patterns in one line')
    const BK = 'catalog/src/books.rs', GP = 'reports/reports/genres.py'
    const ae = await aq('data', { entity: 'local-catalog-books' })
    eq(sect(ae, 'Access ('), [
      'Access (inferred from the key-value SDK calls of the indexed repositories; leads, never verdicts):',
      '  index ByAuthor  queried by 1 function:',
      `    by_author  query  ${BK}:16  (the call at line 17; the table named at the call) · 0 callers`,
      '  index ByIsbn  queried by 1 function:',
      `    by_isbn  query  ${BK}:28  (the call at line 29; the table named at the call) · 0 callers; its name from BY_ISBN at catalog/src/indexes.rs:2`,
      '  index ByGenre  queried by 1 function:',
      `    by_genre  query  ${GP}:11  (the call at line 12; the table named at the call) · 0 callers`,
      '  index ByStatus  no access found (lead): no IndexName or index_name naming it in the indexed repositories; it may be reached through a constant built elsewhere, another repository, or a script',
    ], 'graph_data entity: each GSI with the function that queries it (directly; through a constant of another file, the slice-9 resolution; through a module constant in another language and repository), and the one no call names as a lead saying what was searched')
    eq(sect(ae, 'Reads and writes'), [
      'Reads and writes (7 functions: 4 reading, 3 writing), each with what its calls do:',
      `  save  put  ${BK}:5  (the call at line 7; the table named at the call) · 0 callers`,
      `  by_author  query  ${BK}:16  (the call at line 17; the table named at the call) · 0 callers`,
      `  by_isbn  query  ${BK}:28  (the call at line 29; the table named at the call) · 0 callers`,
      `  shelve  update (writes status, shelvedAt)  ${BK}:39  (the call at line 40; the table named at the call) · 0 callers`,
      `  remove  delete  ${BK}:51  (the call at line 52; the table named at the call) · 0 callers`,
      `  by_genre  query  ${GP}:11  (the call at line 12; the table named at the call) · 0 callers`,
      `  count_copies  query  ${GP}:15  (the call at line 16; the table named at the call) · 0 callers`,
    ], 'graph_data entity: the functions that read and write the table, each with its kind, through the code graph\'s symbols, across both repositories')
    eq(sect(ae, 'Conflicts'), [
      'Conflicts (1): the declarations disagree, or a call writes an attribute the bound item does not state (inferred, never overriding it); each side is kept',
      `  local-catalog-books.shelvedAt  presence: written (SET) — ${BK}:40 [inferred] | absent from the item (Book) — catalog/src/model.rs:6 [code]`,
    ], 'an update writing an attribute the bound item type does not state: a conflict, inferred against code; the attribute it writes through #s (status) is stated, and none')
    ok(!sect(ae, 'Item (').some((l) => l.includes('shelvedAt')) && sect(ae, 'Attributes (').length === 7, 'never overriding: the item and the attributes stay as declared')
    ok((await aq('symbol', { symbol: 'by_genre' })).includes(`${GP}:11`) && (await aq('callers', { symbol: 'shelve' })).includes('none found'), 'the functions are the code graph\'s symbols, at the lines graph_symbol gives')
    has(await aq('status'), '1 for access patterns', 'graph_status counts the files read for access patterns')

    // the page: each index's queries or its lead on the key card, the readers and writers, the inferred conflict
    const { renderGraph: renderAcc } = await import('../lib/render.mjs')
    const { loadProject: loadAcc } = await import('../lib/project.mjs')
    const apage = await renderAcc(loadAcc(AP))
    const adata = dataOf(apage).data
    eq([adata.access, adata.stores[0].tables[0].acc.ix.map((i) => [i.n, i.q.map((f) => f.n), !!i.lead])], [{ files: 2, calls: 7, placed: 7, leads: 1 }, [['ByAuthor', ['by_author'], false], ['ByIsbn', ['by_isbn'], false], ['ByGenre', ['by_genre'], false], ['ByStatus', [], true]]], 'the page packs the access patterns per table, in graph_data\'s words')
    const accPg = await stubPage(apage, '#data-0')
    const acard = accPg.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || ''))[0]
    const atext = accPg.textOf(acard)
    ok(atext.includes('queried by by_author query') && atext.includes('queried by by_genre query') && atext.includes('no access found (lead)'), `the key card: each index with the function querying it, the unqueried one with its lead (${atext.slice(0, 600)})`)
    const arows = accPg.all((n) => n.tagName === 'UL' && /\bkaccess\b/.test(n.attrs.class || '')).flatMap((u) => u.kids.filter((k) => k && k.tagName === 'LI').map((k) => accPg.textOf(k)))
    eq(arows.map((r) => r.split(' ')[0]), ['Wsave', 'Rby_author', 'Rby_isbn', 'Wshelve', 'Wremove', 'Rby_genre', 'Rcount_copies'], 'the key card lists the functions reading and writing the table, each marked')
    ok(atext.includes('written shelvedAt (inferred)') && atext.includes('absent from the item (Book)') && !!accPg.ctl('data-access'), 'the inferred conflict on the card, both sides; the tab says what the access patterns are')
    const lead = accPg.find((n) => n.tagName === 'SPAN' && /\bpill\b/.test(n.attrs.class || '') && (n.attrs.title || '').startsWith('no access found (lead): no IndexName'))
    ok(!!lead, 'the lead pill carries what was searched')

    // incremental: the job starts querying the index the lead was about, and the service stops writing the stray attribute
    const aedit = (rel, fn) => { const f = path.join(AP, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))); const t = new Date(Date.now() + 60_000); utimesSync(f, t, t) }
    aedit('reports/reports/genres.py', (t) => `${t}\n\ndef shelved(status):\n    return books.query(IndexName="ByStatus", KeyConditionExpression=Key("status").eq(status))["Items"]\n`)
    aedit('catalog/src/books.rs', (t) => t.replace('SET #s = :s, shelvedAt = :t', 'SET #s = :s'))
    await aq('index')
    const ae2 = await aq('data', { entity: 'local-catalog-books' })
    ok(sect(ae2, 'Access (').includes(`    shelved  query  ${GP}:20  (the call at line 21; the table named at the call) · 0 callers`) && !ae2.includes('no access found') && ae2.includes('Conflicts: none'),
      `re-indexed: the index is queried now, its lead gone; the write the item lacked is gone, and its conflict (${sect(ae2, 'Access (').slice(-2).join(' | ')})`)
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
