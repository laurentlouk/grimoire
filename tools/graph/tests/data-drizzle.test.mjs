// ════════════════════════════════════════════════════════════════════════════
//  Tests — the Drizzle queries in code: readers and writers per table, tables as targets of
//  graph_impact and graph_search, the data model's changes in graph_diff, relations() kept as
//  relations the schema declares, a primary key's columns not null
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/data-drizzle.test.mjs
//
//  1. no parser runtime: an import's path naming a schema file (specFits), a migrator's migrations
//     naming a store's folder (folderFits), the content filter, and reconcile on hand-built facts (a
//     SQLite `text PRIMARY KEY` without NOT NULL and a schema's primaryKey(): no conflict)
//  2. fixtures/drizzle-app/pg (a Postgres app: a schema in three files and a barrel, its relations()
//     in a file of their own, a migration, the queries of src/users.ts, a test): graph_data's readers
//     and writers per table (operation, columns, joins, the enclosing function and its callers), the
//     relation relations() declares where no foreign key does, graph_impact on a table, a column and
//     a name a code definition shares, graph_search, the Data tab's passport, no literal anywhere
//  3. fixtures/drizzle-app/expo (an Expo app: expo-sqlite, drizzle-kit 1.0's migration folder, the
//     bundle drizzle/migrations.js and useMigrations, raw SQL through op-sqlite): no false nullability
//     conflict, the migrations applied at run time, the raw SQL attached beside the Drizzle calls
//  4. graph_diff on the pg app, the schema and a migration edited: the data model's changes, the code
//     still naming a removed column (risk high), the inserts a new not-null column breaks
//
//  Parts 2 to 4 need the parser runtime: without it, they are skipped.
import { mkdtempSync, cpSync, rmSync, realpathSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
process.env.GRIMOIRE_GRAPH_FRESH_MS = '0'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const lacks = (hay, needle, m) => ok(!hay.includes(needle), `${m}${hay.includes(needle) ? `\n       did not expect: ${needle}` : ''}`)
const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }

// ── 1 · no parser runtime ──
console.log('\n1 · import paths, migrators, the content filter, a primary key not null')
{
  const { specFits, folderFits } = await import('../lib/data/drizzle.mjs')
  eq([
    specFits('./db/schema', 'src/users.ts', 'src/db/schema/index.ts'), specFits('./db/schema', 'src/users.ts', 'src/db/schema/posts.ts'), specFits('../schema', 'src/db/q.ts', 'src/schema.ts'),
    specFits('./other', 'src/users.ts', 'src/db/schema.ts'), specFits('@/db/schema', 'hooks/a.ts', 'db/schema/index.ts'), specFits('@acme/db/schema', 'packages/api/x.ts', 'packages/db/src/schema.ts'),
    specFits('@acme/auth', 'packages/api/x.ts', 'packages/db/src/schema.ts'),
  ], [true, true, true, false, true, true, false], 'an import names a schema file: relative (the file, a folder\'s index, a barrel folder), else by its folders after an alias or a scope')
  eq([folderFits('../../drizzle/migrations', 'src/db/provider.tsx', 'drizzle'), folderFits('@/drizzle/migrations', 'app/_layout.tsx', 'drizzle'), folderFits('./drizzle', 'src/migrate.ts', 'drizzle'), folderFits('../migrations', 'src/a.ts', 'drizzle')],
    [true, true, true, false], 'a migrator\'s migrations (a bundle in the folder, an alias to it, a migrationsFolder) name the store\'s folder')
  const { drizzleQueryLevel } = await import('../lib/data/extractors/drizzle-queries.mjs')
  eq([drizzleQueryLevel("import { notes } from './db/schema'\ndb.insert(notes).values({})"), drizzleQueryLevel("import { x } from 'lodash'\nmap.delete(key)"), drizzleQueryLevel("import { db } from '@acme/db'\nctx.db.query.Post.findMany({})")],
    [16384, 0, 16384], 'the content filter: a query-builder shape beside an import a schema may come through; a Map\'s delete beside another import is none')
  const t0 = Date.now()
  drizzleQueryLevel(`import { a } from 'drizzle-orm'\n${'db.insert('.repeat(20000)}${' '.repeat(50000)}`)
  ok(Date.now() - t0 < 500, `the content filter stays linear on a hostile text (${Date.now() - t0} ms)`)
  const { reconcile } = await import('../lib/data/reconcile.mjs')
  const entity = (nullable, src) => ({ name: 'notes', kind: 'table', path: src, line: 1, fields: [{ name: 'id', type: 'text', nullable, default: null, generated: null, path: src, line: 2 }, { name: 'title', type: 'text', nullable: true, default: null, generated: null, path: src, line: 3 }], keys: [{ role: 'primary', parts: ['id'], path: src, line: 2 }], indexes: [], relations: [] })
  const decl = (kind, src, nullable) => ({ store: 'drizzle', dialect: 'sqlite', source: { path: src, line: 1, kind, confidence: 'declared' }, complete: true, status: 'read', label: kind, notes: [], entities: [entity(nullable, src)] })
  const m = reconcile([{ repo: 'app', extractor: 'sql-migrations@2', facts: { declarations: [decl('migration', 'drizzle/1/migration.sql', true)] } }, { repo: 'app', extractor: 'drizzle-ts@4', facts: { declarations: [decl('code', 'db/schema.ts', false)] } }])
  const id = m.stores[0].entities[0].fields.find((f) => f.name === 'id')
  eq([id.nullable, id.conflicts, m.stores[0].entities[0].fields.find((f) => f.name === 'title').nullable], [false, [], true], 'a primary key\'s column is not null wherever it is declared: a migration\'s `text PRIMARY KEY` without NOT NULL and the schema\'s primaryKey() agree; another column keeps what it says')
}

const deps = await import('../lib/deps.mjs')
if (!deps.findDeps()) {
  if (process.env.CI) ok(false, 'parser runtime missing (run npm ci --prefix tools/graph)')
  else console.log('   - parts 2 to 4 skipped: parser runtime not installed (npm ci --prefix tools/graph)')
} else {
  const { call } = await import('../lib/commands.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { loadProject } = await import('../lib/project.mjs')
  const { dataOf, stubPage } = await import('./data-kit.mjs')
  const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-drizzle-')))
  const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
  const commit = (dir, msg) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', msg) }
  const answers = []
  try {
    // ── 2 · the Postgres app ──
    console.log('\n2 · fixtures/drizzle-app/pg: readers and writers, relations(), impact, search, the page')
    const PG = path.join(SANDBOX, 'pg')
    cpSync(path.join(HERE, 'fixtures', 'drizzle-app', 'pg'), PG, { recursive: true, filter: (s) => !s.split(path.sep).includes('.grimoire') })
    git(PG, 'init', '-q'); commit(PG, 'init')
    const q = async (name, args = {}) => { const a = await call(name, args, { root: PG }); answers.push(a); return a }
    ok(!/fail/.test(await q('graph_index', {})), 'index: no extractor failure')
    const list = await q('graph_data')
    has(list, 'pg:drizzle  postgres  3 tables · 1 foreign key · 1 relation enforced by the client · 0 indexes · no conflicts', 'the store: the relation relations() declares where no foreign key does is counted apart; the migration states no foreign key for it, and that is no conflict')
    has(list, "    note: relations() at src/db/schema/relations.ts:5: the query API's, app-level, never foreign keys: 1 one() kept as a relation the schema declares (no foreign key states it), 1 the same as a foreign key, 2 without fields (a many(), or the other side's)", '… a file of relations alone is read with the schema it relates')
    has(list, '  inferred  Drizzle queries in code: 10 calls in 1 file read or write its tables', 'the calls reaching the store, said with it')
    has(list, 'Drizzle queries in code (inferred from the query builder\'s and the relational API\'s calls; leads, never verdicts): 10 calls in 1 file reaching 3 tables; 1 call in test code not read', '… and in one line: the test\'s call counted, not read')

    const posts = await q('graph_data', { entity: 'posts' })
    has(posts, 'Relations declared by the schema, enforced by the client: no foreign key in the database (1):\n  (author_id) → users(id)  no action stated (the query API\'s relation: the client joins through it, nothing enforces it)  — src/db/schema/relations.ts:10', 'one(users, { fields, references }) on a column no foreign key states: a relation of the client-enforced kind, at its line, no action stated')
    has(posts, 'Reads and writes, from the Drizzle queries in code (inferred; 6 functions: 4 reading, 2 writing):', 'posts: its readers and writers, from the Drizzle calls')
    has(posts, '  postsWithAuthors  reads (select)  src/users.ts:11  (the call at line 12) · 0 callers · columns author_id, created_at · joins users', '… a select with its join (the import renamed: `users as people`), the columns its join and its orderBy name')
    has(posts, '  createUserWithPost  writes (insert)  src/users.ts:19  (the call at line 22) · 0 callers · columns title, author_id', '… an insert inside db.transaction, on tx, the keys its values write as the schema names the columns')
    has(posts, '  feed  reads (query.findMany)  src/users.ts:26  (the call at line 27) · 0 callers · columns id, title, author_id · joins users, comments', '… the relational API: db.query.posts, its columns, a where callback\'s parameter, and the tables its `with` joins through relations()')
    has(posts, '  countPosts  reads (count)  src/users.ts:39  (the call at line 39) · 0 callers', '… db.$count')
    has(posts, '  editors  reads (select)  src/users.ts:42  (the call at line 42) · 0 callers · columns author_id · joins users', '… a join on an alias() of a table is a join on that table')
    const users = await q('graph_data', { entity: 'users' })
    has(users, '  findUser  reads (select)  src/users.ts:7  (the call at line 8) · 2 callers · columns id, name, email', 'users: a select\'s columns (its select object and where), its function\'s callers from the code graph')
    has(users, '  renameUser  writes (update)  src/users.ts:15  (the call at line 16) · 0 callers · columns name, id', '… an update through a namespace import (schema.users), its set and where')
    has(users, '  feed  reads (query.findMany)  src/users.ts:26  (the call at line 27) · 0 callers · joins posts', '… and the relational query that reaches it through `with: { author: true }`')
    const comments = await q('graph_data', { entity: 'comments' })
    has(comments, '  purge  writes (sql delete)  src/users.ts:34  (the call at line 36) · 0 callers · columns post_id', 'a sql`` statement alone: its first word says what it does, its ${table} and ${table.column} what it names')

    // graph_impact: a table, a column (by its name and by its key), a name a code definition shares
    const ip = await q('graph_impact', { target: 'posts' })
    has(ip, 'Impact of table pg:drizzle/posts  (postgres) — depth 3\n  declared at drizzle/0000_init.sql:8 [migration] · src/db/schema/posts.ts:4 [code]', 'graph_impact on a table: its declarations')
    has(ip, '  referenced by: comments (post_id) → (id)', '… the foreign keys to it')
    has(ip, '  references: (author_id) → users(id) [relation enforced by the client]', '… and its own relations')
    has(ip, 'Read and written by (inferred from the queries in code; 6 functions):', '… the functions reading and writing it')
    const ie = await q('graph_impact', { target: 'users.email' })
    has(ie, 'Impact of column pg:drizzle/users.email  (postgres; text, not null) — depth 3', 'graph_impact on a column')
    has(ie, '  findUser  reads (select) · names it in where  src/users.ts:7 · 2 callers', '… the queries naming it, and how')
    has(ie, 'What reaches those functions (calls, inheritance, imports; depth 3):\n  src/users.ts  (distance 1)\n    caller:44  d1 [same-file]', '… and what reaches them, from the code graph')
    has(ie, 'Tests on these paths (1):\n  src/users.test.ts', '… with the tests on those paths')
    has(await q('graph_impact', { target: 'posts.authorId' }), 'Impact of column pg:drizzle/posts.author_id', 'a column named by the key code names it by')
    has(await q('graph_impact', { target: 'pg:drizzle/posts' }), 'Impact of table pg:drizzle/posts', 'a table by its id')
    const both = await q('graph_impact', { target: 'Comments' })
    has(both, '"Comments" names a data entity and 1 code definition: the data model\'s impact first, then the code\'s (db:Comments names the data alone).', 'a name a table and a code definition share: both, said so')
    has(both, 'Impact of Comments  function  src/ui.ts:2', '… the code definition\'s impact after the table\'s')
    lacks(await q('graph_impact', { target: 'db:Comments' }), 'Impact of Comments  function', '`db:` names the data alone')
    has(await q('graph_impact', { target: 'db:nothing_here' }), 'No data entity matches "db:nothing_here"', '… and says when nothing matches')
    const sr = await q('graph_search', { query: 'author' })
    has(sr, 'Data model, named like it (graph_impact and graph_data take these):\n  column  pg:drizzle/posts.author_id (authorId in code)  integer  drizzle/0000_init.sql:12', 'graph_search lists the tables and columns named like it, by their name or the key code names them by')

    // the page: the passport lists them
    const page = await renderGraph(loadProject(PG))
    answers.push(page)
    const S = dataOf(page).data.stores[0]
    const pt = S.tables.find((t) => t.name === 'posts')
    eq([pt.sq.from, pt.sq.rw.length, pt.rels.filter((r) => r.cl).map((r) => r.columns[0])], ['the Drizzle queries in code', 6, ['author_id']], 'the page packs posts\' readers and writers, from the Drizzle calls, and the relation relations() declares as its own kind')
    const pg2 = await stubPage(page, '#data-0')
    pg2.click(S.tables.findIndex((t) => t.name === 'posts'))
    ok(pg2.lines('H2').includes('Reads and writes (6 functions, from the Drizzle queries in code: inferred)'), `the passport: its readers and writers (${pg2.lines('H2').join(' · ')})`)
    has(pg2.text(), 'columns author_id, created_at · joins users', '… each with the columns it names and the tables it joins')
    has(pg2.text(), 'no action stated', '… the relation relations() declares, no action stated')

    // ── 3 · the Expo app ──
    console.log('\n3 · fixtures/drizzle-app/expo: expo-sqlite, bundled migrations, op-sqlite')
    const EX = path.join(SANDBOX, 'expo')
    cpSync(path.join(HERE, 'fixtures', 'drizzle-app', 'expo'), EX, { recursive: true, filter: (s) => !s.split(path.sep).includes('.grimoire') })
    const x = async (name, args = {}) => { const a = await call(name, args, { root: EX }); answers.push(a); return a }
    ok(!/fail/.test(await x('graph_index', {})), 'index: no extractor failure')
    const el = await x('graph_data')
    has(el, 'expo:drizzle  sqlite  1 table · 0 foreign keys · 0 indexes (+1 implicit, for keys) · no conflicts', 'drizzle-kit 1.0\'s `text PRIMARY KEY` without NOT NULL and the schema\'s primaryKey(): no nullability conflict')
    has(el, '  migrations applied at run time: useMigrations at app/_layout.tsx:6 in RootLayout (given ../drizzle/migrations: the folder this store replays)', 'the bundle drizzle/migrations.js and useMigrations: the migrations the app applies are the folder the store replays')
    has(el, '  inferred  queries in code attached (the only declared SQL store in the repository; 1 of 1 table named is declared): 1 statement in 1 file', 'op-sqlite\'s executeAsync is a SQL call: its statement attaches to the store')
    const en = await x('graph_data', { entity: 'notes' })
    has(en, 'Reads and writes, from the SQL and the Drizzle queries in code (inferred; 4 functions: 3 reading, 1 writing):', 'notes: the raw SQL and the Drizzle calls, both')
    has(en, '  titles  reads (select)  lib/raw.ts:5', '… the raw SQL\'s function')
    has(en, '  useNotes  reads (select)  hooks/use-notes.ts:5  (the call at line 7) · 0 callers · columns created_at', '… a call in a callback, in the code graph\'s function around it')
    has(await x('graph_sql', { sql: "SELECT facts FROM data_facts WHERE extractor LIKE 'drizzle-queries@%' AND key = 'hooks/use-notes.ts'" }), '"name":"useNotes.queryFn"', '… which the extractor names by the member holding it (what is said where no code graph symbol holds it)')
    has(en, '  saveNote  writes (insert)  hooks/use-notes.ts:11  (the call at line 12) · 0 callers · columns id, title', '… an upsert: its values, its conflict target and its set')
    has(en, '  noteById  reads (query.findFirst)', '… the relational API')
    lacks(el, 'Gaps', 'expo-sqlite and op-sqlite reach a store that is read: no gap')

    // ── 4 · graph_diff ──
    console.log('\n4 · graph_diff on the pg app: the data model\'s changes and who still names them')
    const swap = (rel, a, b) => { const p = path.join(PG, rel); const t = readFileSync(p, 'utf8'); if (!t.includes(a)) throw new Error(`${rel}: no ${a}`); writeFileSync(p, t.replace(a, b)) }
    swap('src/db/schema/users.ts', "  name: text('name'),\n", '')
    swap('src/db/schema/posts.ts', "  body: text('body'),\n", "  body: text('body'),\n  pinned: boolean('pinned').notNull(),\n")
    swap('src/db/schema/posts.ts', 'import { integer, pgTable', 'import { boolean, integer, pgTable')
    writeFileSync(path.join(PG, 'drizzle/0001_change.sql'), 'ALTER TABLE "users" DROP COLUMN "name";\n--> statement-breakpoint\nALTER TABLE "posts" ADD COLUMN "pinned" boolean NOT NULL;\n')
    swap('drizzle/meta/_journal.json', '"breakpoints": true }\n', '"breakpoints": true },\n    { "idx": 1, "version": "7", "when": 1767312000000, "tag": "0001_change", "breakpoints": true }\n')
    const d = await q('graph_diff', { base: 'HEAD' })
    has(d, 'Data model changes (against the same base; graph_changes lists each in full): 1 store(s) changed · 1 added · 1 removed · 0 modified', 'graph_diff: the data model\'s changes against the same base')
    has(d, '    + posts.pinned  column boolean, not null  — drizzle/0001_change.sql:3 · src/db/schema/posts.ts:8', '… a column added, with its declarations')
    has(d, '      inserts that do not set it (a not-null column with no default): src/users.ts:22 (createUserWithPost)', '… and the inserts that do not set a not-null column added with no default')
    has(d, '    - users.name  column text, nullable  — was drizzle/0000_init.sql:4 · src/db/schema/users.ts:6', '… a column removed')
    has(d, '      still named: src/users.ts:8 [drizzle] · src/users.ts:16 [drizzle] · src/users.ts:21 [drizzle]', '… and the Drizzle calls still naming it, at their lines')
    has(d, 'Risk: high: 1 insert(s) into posts do not set the not-null column pinned added with no default; removed column users.name is still named outside the lines this diff changed (3 place(s))', '… so the risk is high, with its reasons')
    const ch = await q('graph_changes', { base: 'HEAD' })
    has(ch, '+ posts.pinned  column boolean, not null', 'graph_changes says the same addition')
    // the removed column's name, still named: an [inferred] conflict where the schema no longer has it
    has(await q('graph_data', { entity: 'users' }), '[inferred] users.name  presence: named in code (inferred) — src/users.ts:8 [inferred]', 'graph_data: a key the schema no longer holds, named in code, is an [inferred] conflict')
    // a clean tree: none
    commit(PG, 'change')
    has(await q('graph_diff', { base: 'HEAD' }), 'none (the working tree matches it)', 'a clean tree: nothing to say')

    // no literal the code compares with or writes reaches an answer, the page or the index
    const leaked = answers.flatMap((a) => a.match(/canary-dz-\d/g) || [])
    const GD = path.join(PG, '.grimoire/graph')
    const stored = readdirSync(GD).filter((f) => statSync(path.join(GD, f)).isFile()).flatMap((f) => readFileSync(path.join(GD, f)).toString('latin1').match(/canary-dz-\d/g) || [])
    eq([leaked, stored], [[], []], 'no literal of a query (a where\'s value, an insert\'s value, a test\'s) in any answer, the page or graph.db')
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
