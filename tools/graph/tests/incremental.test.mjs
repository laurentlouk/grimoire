// ════════════════════════════════════════════════════════════════════════════
//  Tests — an incremental index answers as a full one (tools/graph: lib/indexer.mjs, resolve_inputs)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/incremental.test.mjs
//
//  The files module resolution reads beside the code (package.json, tsconfig, workspace files, go.mod,
//  Cargo.toml) are parsed by no language: an edit to one alone must still re-resolve the repository.
//  Each case edits one such file, refreshes incrementally, then compares the index, row by row
//  (edges, imports, routes and their links), with a full index of the same tree; graph_status must
//  see the edit before the refresh.
//
//  Needs the parser runtime (npm ci --prefix tools/graph); skipped without it, except under CI.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.execArgv.includes('--liftoff-only')) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, GRIMOIRE_GRAPH_FRESH_MS: '0' } })
  process.exit(r.status ?? 1)
}
const { findDeps } = await import('../lib/deps.mjs')
if (!findDeps()) {
  if (process.env.CI) { console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)'); process.exit(1) }
  console.log('   - skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  process.exit(0)
}
const { call, staleness } = await import('../lib/commands.mjs')
const { openStore } = await import('../lib/store.mjs')
const { indexProject } = await import('../lib/indexer.mjs')
const { loadProject } = await import('../lib/project.mjs')
const { DatabaseSync } = await import('node:sqlite')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' })
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-incremental-')))
const put = (root, rel, text) => { mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); writeFileSync(path.join(root, rel), text) }

// The index as rows that do not depend on row ids: every edge, import, route and link by what it joins.
function canon(root) {
  const db = new DatabaseSync(path.join(root, '.grimoire/graph/graph.db'), { readOnly: true })
  try {
    const nk = new Map(db.prepare('SELECT n.id, f.path, n.kind, n.qualname, n.line FROM nodes n JOIN files f ON f.id = n.file_id').all().map((n) => [n.id, `${n.path}|${n.kind}|${n.qualname}|${n.line}`]))
    const rows = [
      ...db.prepare('SELECT src, dst, kind, confidence, line FROM edges').all().map((e) => `edge ${e.kind} ${nk.get(e.src)} -> ${nk.get(e.dst)} ${e.confidence} ${e.line}`),
      ...db.prepare('SELECT f.path, i.source, i.line, i.resolved FROM imports i JOIN files f ON f.id = i.file_id').all().map((i) => `import ${i.path}:${i.line} ${i.source} ${i.resolved}`),
      ...db.prepare('SELECT f.path, r.line, r.method, r.path AS p, r.full, r.handler_id FROM routes r JOIN files f ON f.id = r.file_id').all().map((r) => `route ${r.path}:${r.line} ${r.method} ${r.p} ${r.full} ${nk.get(r.handler_id)}`),
      ...db.prepare('SELECT f.path, x.line, l.how FROM route_links l JOIN route_refs x ON x.id = l.ref_id JOIN files f ON f.id = x.file_id').all().map((l) => `link ${l.path}:${l.line} ${l.how}`),
    ]
    return rows.sort()
  } finally { db.close() }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const delta = (a, b) => { const A = new Set(a), B = new Set(b); return [...a.filter((x) => !B.has(x)).map((x) => `- ${x}`), ...b.filter((x) => !A.has(x)).map((x) => `+ ${x}`)].slice(0, 12).join('\n         ') }

// one project per case, indexed, edited, refreshed; then the same tree indexed in full
async function trial(name, files, edit, check) {
  const root = path.join(SANDBOX, name)
  for (const [rel, text] of Object.entries(files)) put(root, rel, text)
  put(root, 'grimoire.config.json', JSON.stringify({ graph: { dir: '.grimoire/graph' } }))
  git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '-A'); git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  const q = (tool, args = {}) => call(`graph_${tool}`, args, { root })
  await q('index')
  const before = canon(root)
  edit(root)
  const project = loadProject(root)
  const probe = await openStore(project.dbPath, { readOnly: true })
  const stale = staleness(project, probe)
  probe.close()
  ok(Object.keys(stale).length > 0, `${name}: the freshness check (stat only) sees the edit to a file resolution reads`)
  await indexProject(project)
  const inc = canon(root)
  await q('index', { full: true })
  const full = canon(root)
  ok(same(inc, full), `${name}: the incremental index matches a full one${same(inc, full) ? '' : `\n         ${delta(inc, full)}`}`)
  check(before, inc)
}

console.log('\n1 · a workspace package renamed in its package.json alone')
await trial('workspace', {
  'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - apps/*\n',
  'package.json': '{ "name": "root", "private": true }\n',
  'packages/db/package.json': '{ "name": "@acme/db", "main": "src/index.ts" }\n',
  'packages/db/src/index.ts': 'export function query() {\n  return 1\n}\n',
  'apps/web/package.json': '{ "name": "web" }\n',
  'apps/web/src/load.ts': "import { query } from '@acme/db'\n\nexport function load() {\n  return query()\n}\n",
}, (root) => put(root, 'packages/db/package.json', '{ "name": "@acme/database", "main": "src/index.ts" }\n'), (before, after) => {
  ok(before.some((r) => r.startsWith('edge IMPORTS apps/web/src/load.ts') && r.includes('packages/db/src/index.ts')), 'workspace: before, the import of @acme/db links its package')
  ok(!after.some((r) => r.startsWith('edge IMPORTS apps/web/src/load.ts') && r.includes('packages/db/src/index.ts')), 'workspace: after the rename, no stale IMPORTS edge to the package the name no longer names')
})

console.log('\n2 · a tsconfig path alias moved')
await trial('alias', {
  'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }\n',
  'src/lib/math.ts': 'export function add(a: number, b: number) {\n  return a + b\n}\n',
  'src/other/math.ts': 'export function add(a: number, b: number) {\n  return a - b\n}\n',
  'src/app.ts': "import { add } from '@lib/math'\n\nexport function main() {\n  return add(1, 2)\n}\n",
}, (root) => put(root, 'tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/other/*"] } } }\n'), (before, after) => {
  ok(before.some((r) => r.startsWith('edge IMPORTS src/app.ts') && r.includes('src/lib/math.ts')) && after.some((r) => r.startsWith('edge IMPORTS src/app.ts') && r.includes('src/other/math.ts')), 'alias: the import follows the alias to its new target')
})

console.log('\n2b · the alias moved in the tsconfig another one extends')
await trial('extends', {
  'tsconfig.base.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }\n',
  'tsconfig.json': '{ "extends": "./tsconfig.base.json" }\n',
  'src/lib/math.ts': 'export function add(a: number, b: number) {\n  return a + b\n}\n',
  'src/other/math.ts': 'export function add(a: number, b: number) {\n  return a - b\n}\n',
  'src/app.ts': "import { add } from '@lib/math'\n\nexport function main() {\n  return add(1, 2)\n}\n",
}, (root) => put(root, 'tsconfig.base.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/other/*"] } } }\n'), (before, after) => {
  ok(after.some((r) => r.startsWith('edge IMPORTS src/app.ts') && r.includes('src/other/math.ts')), 'extends: the import follows the base config\'s alias to its new target')
})

console.log('\n3 · a Go module renamed in go.mod')
await trial('gomod', {
  'go.mod': 'module example.com/shop\n\ngo 1.22\n',
  'pkg/price/price.go': 'package price\n\nfunc Total() int {\n\treturn 1\n}\n',
  'cmd/main.go': 'package main\n\nimport "example.com/shop/pkg/price"\n\nfunc main() {\n\tprice.Total()\n}\n',
}, (root) => put(root, 'go.mod', 'module example.com/store\n\ngo 1.22\n'), () => {})

console.log('\n4 · graph_diff reads the data model only when the diff can change it, and a base once per commit')
{
  const root = path.join(SANDBOX, 'model')
  put(root, 'db/migrations/0001_init.sql', 'CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);\n')
  put(root, 'src/note.ts', 'export interface Note {\n  id: number\n  title: string\n}\n\nexport function show(n: Note) {\n  return n.title\n}\n')
  put(root, 'grimoire.config.json', JSON.stringify({ graph: { dir: '.grimoire/graph' } }))
  git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '-A'); git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  const q = (tool, args = {}) => call(`graph_${tool}`, args, { root })
  await q('index')
  const NONE = 'Data model changes (against the same base): none'
  // a function body changed in a file of types: the binding's facts are the same, nothing to compare
  put(root, 'src/note.ts', readFileSync(path.join(root, 'src/note.ts'), 'utf8').replace('return n.title', 'return n.title.trim()'))
  const body = await q('diff', { base: 'HEAD' })
  ok(body.includes('~ show  function  src/note.ts:6  body') && !body.includes('Data model'), 'a body change in a file of types: the data model is not read (no line about it)')
  // lines moved above the types: their facts moved, nothing else did
  put(root, 'src/note.ts', `// notes\n\n${readFileSync(path.join(root, 'src/note.ts'), 'utf8')}`)
  ok(!(await q('diff', { base: 'HEAD' })).includes('Data model'), '… lines added above them: their facts moved, line numbers aside they are the same')
  // a field added to a type: its facts changed, the model is compared
  put(root, 'src/note.ts', readFileSync(path.join(root, 'src/note.ts'), 'utf8').replace('  title: string\n', '  title: string\n  body: string\n'))
  ok((await q('diff', { base: 'HEAD' })).includes(NONE), 'a field added to a type: the model is compared (no table bound to it: none)')
  // a migration added: compared, and the base read once per commit, from disk the second time
  put(root, 'db/migrations/0002_body.sql', 'ALTER TABLE notes ADD COLUMN body TEXT;\n')
  const m = await q('diff', { base: 'HEAD' })
  ok(m.includes('+ notes.body'), 'a migration added: its column, against the base')
  const cache = path.join(root, '.grimoire/graph/base')
  const files = () => { try { return readdirSync(cache).filter((f) => f.endsWith('.json')) } catch { return [] } }
  ok(files().length === 1, `the base's facts saved beside the index, one entry for one commit (${files().length})`)
  writeFileSync(path.join(cache, files()[0]), '{ not json')
  ok((await q('diff', { base: 'HEAD' })) === m, 'an entry that does not read is computed again: the same answer')
  git(root, 'add', '-A'); git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'body')
  put(root, 'db/migrations/0003_tags.sql', 'CREATE TABLE tags (id INTEGER PRIMARY KEY);\n')
  const t = await q('diff', { base: 'HEAD' })
  ok(t.includes('tags') && !t.includes('notes.body'), 'another commit as the base: its own answer')
  ok(files().length === 2, `… and its own entry (${files().length})`)
}

console.log('\n5 · a base reads what the index read of its unchanged files: the same model as reading them all')
{
  const { cpSync } = await import('node:fs')
  const { resolveBase, modelAt } = await import('../lib/data/base.mjs')
  const root = path.join(SANDBOX, 'orm')
  cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'orm'), root, { recursive: true })
  put(root, 'grimoire.config.json', JSON.stringify({ graph: { dir: '.grimoire/graph' } }))
  git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '-A'); git(root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  // the branch: one Django model and one TypeORM entity edited, the rest as at the base
  const f = path.join(root, 'django/orders/models.py'), e = path.join(root, 'typeorm/src/entity/Tag.ts')
  writeFileSync(f, `${readFileSync(f, 'utf8')}\n\nclass Refund(models.Model):\n    amount = models.IntegerField()\n`)
  writeFileSync(e, readFileSync(e, 'utf8').replace(/\}\s*$/, '  @Column()\n  color: string\n}\n'))
  await call('graph_index', {}, { root })
  const project = loadProject(root), base = resolveBase(project, { explicit: 'HEAD' })
  const canonModel = (at) => JSON.stringify([...at.rows].map((r) => JSON.stringify(r)).sort()) + JSON.stringify(at.failed.map((x) => JSON.stringify(x)).sort())
  const reused = await modelAt(project, base)
  // the same base read whole: no index to read from (another graph dir), the memo keyed apart
  const alone = await modelAt({ ...project, dbPath: path.join(SANDBOX, 'no-index', 'graph.db'), exclude: [/(^|\/)never-matches$/] }, base)
  ok(reused.rows.length > 3 && canonModel(reused) === canonModel(alone), `the base's facts, reusing the index for unchanged files, equal a full read of the base (${reused.rows.length} rows)`)
  ok(JSON.stringify(reused.model) === JSON.stringify(alone.model), '… and so does the model reconciled from them')
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
