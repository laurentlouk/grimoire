// ════════════════════════════════════════════════════════════════════════════
//  Tests — the code graph (tools/graph)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/graph.test.mjs
//
//  1. extraction: one sample per language (fixtures/langs) → the definitions, calls, supertypes
//     and imports the syntax states, and the variable types bindings.mjs reads off it
//  2. a polyglot project (fixtures/poly: TypeScript, Rust, Python, Go repos in one config) →
//     the resolved edges and their confidence, through the same `call()` the MCP server uses
//  3. incremental refresh: an edit, a new file and a deletion show up in the next query
//  4. the MCP server over stdio: initialize, tools/list, tools/call, read-only SQL
//  5. worktrees, the lock, the hook's refresh, churn, and the page (data, CSP, its script run in a stub DOM)
//  1b-1d (between 1 and 2): which files count and as what, modules and the system map, the page's helpers
//
//  Needs the parser runtime (web-tree-sitter + grammars): `npm ci --prefix tools/graph`, or a
//  prior index that installed it into the user cache. Without it the file is skipped, except
//  under CI, where a missing runtime fails.
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync, realpathSync, mkdirSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

// Grammars run under V8's Liftoff-only wasm tier (see lib/indexer.mjs): re-exec with it.
if (!process.execArgv.includes('--liftoff-only')) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, GRIMOIRE_GRAPH_FRESH_MS: '0' } })
  process.exit(r.status ?? 1)
}

const { findDeps, loadRuntime } = await import('../lib/deps.mjs')
if (!findDeps()) {
  if (process.env.CI) { console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)'); process.exit(1) }
  console.log('   - skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  process.exit(0)
}
const { extract } = await import('../lib/extract.mjs')
const { langOf, LANGS } = await import('../lib/langs.mjs')
const { bindingsOf } = await import('../lib/bindings.mjs')
const { call } = await import('../lib/commands.mjs')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const lacks = (hay, needle, m) => ok(!hay.includes(needle), `${m}${hay.includes(needle) ? `\n       did not expect: ${needle}` : ''}`)

// ── 1 · extraction, per language ──
console.log('\n1 · extraction')
const rt = await loadRuntime({ install: false })
const facts = {}
for (const f of readdirSync(path.join(HERE, 'fixtures', 'langs')).sort()) {
  const lang = langOf(f)
  const parser = await rt.parserFor(lang)
  const src = readFileSync(path.join(HERE, 'fixtures', 'langs', f), 'utf8')
  const tree = parser.parse(src)
  const r = extract(tree, lang, false)
  const binds = []
  const walk = (n) => { for (const b of bindingsOf(n, LANGS[lang].spec)) binds.push(b.join(':')); for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i)) }
  walk(tree.rootNode)
  tree.delete()
  facts[f] = {
    defs: r.symbols.map((s) => `${s.kind} ${s.qualname}`),
    calls: r.refs.filter((x) => /call|new|macro/.test(x.kind)).map((x) => `${x.qual ? x.qual + '.' : ''}${x.name}`),
    supers: r.refs.filter((x) => /extends|implements/.test(x.kind)).map((x) => `${x.fromType || r.symbols[x.src]?.name} ${x.kind} ${x.name}`),
    imports: r.imports.map((i) => i.source),
    binds,
  }
}
const expect = {
  'a.ts': { defs: ['interface Shape', 'class Circle', 'method Circle.area', 'function run', 'function arrow', 'type Alias', 'enum Color'], calls: ['helper', 'Circle', 'c.area', 'fs.readFileSync'], supers: ['Circle extends Base', 'Circle implements Shape'], imports: ['./util', 'node:fs'], binds: ['a:Circle', 'y:Circle'] },
  'a.js': { defs: ['class Circle', 'method Circle.area', 'function run', 'function arrow'], calls: ['helper', 'c.area'], imports: ['./util', './lib'] },
  'a.py': { defs: ['class Circle', 'method Circle.area', 'method Circle.make', 'function run'], calls: ['helper', 'Circle', 'c.area'], supers: ['Circle extends Base', 'Circle extends Shape'], imports: ['os.path', '.util', 'pkg.mod'], binds: ['c:Circle'] },
  'a.rs': { defs: ['trait Shape', 'struct Circle', 'enum Color', 'method Circle.area', 'method Circle.new', 'function run', 'function test_run', 'type Alias'], calls: ['helper', 'Circle.new', 'c.area', 'fs.read', 'println', 'run'], supers: ['Circle implements Shape'], imports: ['crate::util', 'std', 'self::inner'], binds: ['c:Circle'] },
  'a.go': { defs: ['interface Shape', 'struct Circle', 'method Circle.Area', 'function Run'], calls: ['u.Helper', 'c.Area', 'fmt.Println', 'helper'], imports: ['fmt', 'github.com/acme/app/util'], binds: ['c:Circle'] },
  'A.java': { defs: ['class Circle', 'method Circle.area', 'constructor Circle.Circle', 'interface Shape', 'enum Color'], calls: ['Helper.help', 'Circle', 'c.area', 'helper'], supers: ['Circle extends Base', 'Circle implements Shape', 'Circle implements Other'], imports: ['com.acme.util.Helper', 'java.util'], binds: ['c:Circle'] },
  'A.kt': { defs: ['class Circle', 'method Circle.area', 'interface Shape', 'class Registry', 'function run'], calls: ['Helper.help', 'Circle', 'c.area', 'helper'], supers: ['Circle extends Base', 'Circle implements Shape'], imports: ['com.acme.util.Helper'], binds: ['c:Circle'] },
  'a.c': { defs: ['struct point', 'type point_t', 'function helper', 'function run'], calls: ['helper', 'printf'], imports: ['util.h', 'stdio.h'] },
  'a.cpp': { defs: ['namespace geo', 'class Circle', 'method Circle.area', 'method Circle.perimeter', 'function run'], calls: ['helper', 'util.twice', 'c.area', 'p.area', 'Circle'], supers: ['Circle extends Base', 'Circle extends Shape'], imports: ['util.hpp'], binds: ['c:Circle', 'p:Circle'] },
  'a.cs': { defs: ['namespace Acme.Geo', 'interface IShape', 'class Circle', 'method Circle.Area', 'method Circle.Run', 'enum Color'], calls: ['Helper.Help', 'Circle', 'c.Area', 'Log'], supers: ['Circle extends Base', 'Circle implements IShape'], imports: ['Acme.Util'], binds: ['c:Circle'] },
  'a.rb': { defs: ['module Geo', 'class Geo.Circle', 'method Geo.Circle.area', 'method Geo.Circle.make', 'function run'], calls: ['helper', 'Circle.new', 'c.area'], supers: ['Circle extends Base', 'Circle implements Shape'], imports: ['util', 'json'], binds: ['c:Circle'] },
  'a.php': { defs: ['interface Shape', 'class Circle', 'method Circle.area', 'method Circle.run', 'function run'], calls: ['Helper.help', 'Circle', '$c.area', 'helper'], supers: ['Circle extends Base', 'Circle implements Shape'], imports: ['Acme\\Util\\Helper'], binds: ['c:Circle'] },
  'a.swift': { defs: ['protocol Shape', 'class Circle', 'method Circle.area', 'struct Point', 'enum Color', 'method Circle.grow', 'function run'], calls: ['helper', 'self.area', 'Circle', 'c.area'], supers: ['Circle extends Base', 'Circle extends Shape'], imports: ['Foundation'], binds: ['c:Circle'] },
}
for (const [f, want] of Object.entries(expect)) {
  const got = facts[f]
  if (!got) { ok(false, `${f}: no fixture`); continue }
  const missing = Object.entries(want).flatMap(([k, xs]) => xs.filter((x) => !got[k].includes(x)).map((x) => `${k}: ${x}`))
  ok(!missing.length, `${f} (${langOf(f)})${missing.length ? `: missing ${missing.join(' · ')}\n       got ${JSON.stringify(got)}` : ''}`)
}
ok(!facts['a.js'].calls.includes('require'), 'a require() is an import, not a call')
ok(facts['a.rs'].defs.includes('function test_run') && facts['a.rs'].defs.every((d) => !d.startsWith('method run')), 'Rust: free functions stay functions; impl members become methods of their type')

// ── 1b · which files count, and as what ──
{
  const { TEST_PATH } = await import('../lib/langs.mjs')
  const { scanRepo } = await import('../lib/project.mjs')
  const support = ['internal/mock/client.go', 'test/fixture/user.json', 'src/components/Button.stories.tsx', '.storybook/preview.tsx', '.storybook/stories/atoms/Badge.stories.tsx', 'lib/src/mocks/mock_dynamodb.rs', 'src/__mocks__/api.ts', 'lib/src/fixtures/mod.rs', 'app/__fixtures__/user.ts']
  const prod = ['src/components/Button.tsx', 'src/mockup/view.ts', 'lib/src/fixture_loader.rs', 'src/stories.ts', 'lib/src/application/mod.rs']
  const wrong = [...support.filter((p) => !TEST_PATH.test(p)).map((p) => `${p} should be test code`), ...prod.filter((p) => TEST_PATH.test(p)).map((p) => `${p} should be production code`)]
  ok(!wrong.length, `stories, mocks and fixtures are test code; look-alike production paths are not${wrong.length ? ': ' + wrong.join(' · ') : ''}`)
  ok(['infra/prod/eks/terragrunt.hcl', 'modules/vpc/main.tf', 'env/prod.tfvars'].every((p) => langOf(p) === 'other'), 'Terraform and Terragrunt files are indexed by name')
  const TF = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-tf-')))
  for (const rel of ['main.tf', 'infra/prod/eks/terragrunt.hcl', 'env/prod.tfvars', '.terraform/modules/vpc/main.tf', 'infra/prod/eks/.terragrunt-cache/abc/main.tf', '.terraform.lock.hcl', 'infra/prod/eks/.terraform.lock.hcl']) { mkdirSync(path.dirname(path.join(TF, rel)), { recursive: true }); writeFileSync(path.join(TF, rel), 'locals {}\n') }
  spawnSync('git', ['-C', TF, 'init', '-q'])
  const scanned = scanRepo({ abs: TF }, { exclude: [], maxBytes: 1 << 20 }).map((f) => f.path).sort()
  ok(JSON.stringify(scanned) === JSON.stringify(['env/prod.tfvars', 'infra/prod/eks/terragrunt.hcl', 'main.tf']), `Terraform's and Terragrunt's caches and lock files are never indexed (${scanned.join(', ')})`)
  rmSync(TF, { recursive: true, force: true })
}

// ── 1c · modules: the system map's units ──
{
  const { moduleKeys, systemMap } = await import('../lib/modules.mjs')
  const F = (id, repo, path, test = 0) => ({ id, repo, path, is_test: test })
  const fs = [
    F(1, 'api', 'lib/src/cqrs/a.rs'), F(2, 'api', 'lib/src/cqrs/b.rs'), F(3, 'api', 'lib/src/db/c.rs'), F(4, 'api', 'lib/src/db/d.rs'),
    F(5, 'api', 'lib/src/infra/e.rs'), F(6, 'api', 'lib/build.rs'), F(7, 'api', 'gql/src/schema.rs'), F(8, 'api', 'main.rs'),
    F(9, 'app', 'components/Button.tsx'), F(10, 'app', 'hooks/useX.ts'), F(11, 'app', 'app/(tabs)/index.tsx'), F(12, 'app', 'app/_layout.tsx'),
    F(13, 'app', 'components/Button.test.tsx', 1),
  ]
  const keys = moduleKeys(fs)
  const got = fs.map((f) => `${f.id}:${keys.get(f.id) ?? '-'}`).join(' ')
  ok(got === '1:lib/src/cqrs 2:lib/src/cqrs 3:lib/src/db 4:lib/src/db 5:lib/src/infra 6:lib 7:gql 8:(root) 9:components 10:hooks 11:app 12:app 13:-',
    `modules: a folder holding most of its repo splits into its subfolders, files right in it stay at its level, test code belongs to none (${got})`)
  const nodes = fs.map((f) => ({ id: 100 + f.id, file_id: f.id }))
  const E = (a, b, kind, conf) => ({ src: 100 + a, dst: 100 + b, kind, confidence: conf })
  const edges = [
    E(1, 3, 'CALLS', 'import'), E(2, 3, 'CALLS', 'typed'), E(2, 4, 'CALLS', 'qualified'), E(1, 3, 'IMPORTS', 'path'), // cqrs → db: 3 file pairs
    E(1, 5, 'CALLS', 'ambiguous'), E(2, 5, 'CALLS', 'unique-name'), // name guesses: no link
    E(13, 9, 'CALLS', 'import'), // from test code: no link
    E(7, 1, 'CALLS', 'import'), E(9, 10, 'IMPORTS', 'path'), E(11, 9, 'IMPORTS', 'path'), E(12, 9, 'IMPORTS', 'path'), E(1, 2, 'CALLS', 'same-file'),
  ]
  const S = systemMap(fs, nodes, edges)
  const mods = S.modules.map((m) => `${m.repo}:${m.key}:${m.files}`).join(' ')
  const links = S.links.map(([a, b, n]) => `${S.modules[a].key}>${S.modules[b].key}:${n}`).sort().join(' ')
  ok(links === 'app>components:2 components>hooks:1 gql>lib/src/cqrs:1 lib/src/cqrs>lib/src/db:3',
    `system map: links count file pairs between modules, from links resolved by syntax only, never from test code (${links})`)
  ok(S.modules.filter((m) => m.repo === 'app').map((m) => m.key).join(' ') === 'app components hooks',
    `system map: a lane lists its modules in the order code flows, users above what they use (${mods})`)
  ok(JSON.stringify(systemMap(fs, nodes, edges)) === JSON.stringify(S), 'system map: deterministic')
  // as the page calls it: files carry their file node, nodes are definitions only, imports join file nodes
  const fsN = fs.map((f) => ({ ...f, node_id: 1000 + f.id }))
  const I = systemMap(fsN, [], [{ src: 1007, dst: 1001, kind: 'IMPORTS', confidence: 'path' }])
  const il = I.links.map(([a, b, n]) => `${I.modules[a].key}>${I.modules[b].key}:${n}`).join(' ')
  ok(il === 'gql>lib/src/cqrs:1', `system map: a module linked only by an import, through the files' own nodes (${il})`)
  const chain = systemMap([F(1, 'z', 'a/x.ts'), F(2, 'z', 'b/x.ts'), F(3, 'z', 'c/x.ts')], [{ id: 1, file_id: 1 }, { id: 2, file_id: 2 }, { id: 3, file_id: 3 }],
    [{ src: 1, dst: 2, kind: 'CALLS', confidence: 'import' }, { src: 2, dst: 3, kind: 'CALLS', confidence: 'import' }, { src: 1, dst: 3, kind: 'CALLS', confidence: 'import' }])
  const cr = chain.modules.map((m) => `${m.key}:${m.rank}`).join(' ')
  ok(cr === 'a:0 b:1 c:2', `system map: a module sits below its longest chain of users, not its nearest (${cr})`)
  const C = systemMap(fs, nodes, [...edges, E(10, 9, 'IMPORTS', 'path')]) // hooks → components closes a cycle
  const ranks = C.modules.filter((m) => m.repo === 'app').map((m) => `${m.key}:${m.rank}`).join(' ')
  ok(ranks === 'app:0 components:1 hooks:1', `system map: modules in a cycle share one rank, below their users (${ranks})`)
  const apiRanks = S.modules.filter((m) => m.repo === 'api').map((m) => `${m.key}:${m.rank}`).join(' ')
  ok(apiRanks === '(root):0 gql:0 lib:0 lib/src/infra:0 lib/src/cqrs:1 lib/src/db:2', `system map: gql uses cqrs uses db; a module reached only by name guesses stays on top (${apiRanks})`)
  const X = systemMap(fs, nodes, [...edges, E(10, 3, 'CALLS', 'import')]) // app's hooks → api's lib/src/db
  const xl = X.links.map(([a, b, n]) => `${X.modules[a].repo}:${X.modules[a].key}>${X.modules[b].repo}:${X.modules[b].key}:${n}`).filter((t) => t.includes('hooks>')).join(' ')
  const dbRank = X.modules.find((m) => m.key === 'lib/src/db').rank
  ok(xl === 'app:hooks>api:lib/src/db:1' && dbRank === 2, `system map: a link across repositories is drawn but never ranks a module (${xl}, db rank ${dbRank})`)
}

// ── 1d · the page's pure helpers (injected into the page as they are) ──
{
  const R = await import('../lib/render.mjs')
  ok(R.esc('a"b>c<d&e') === 'a&quot;b&gt;c&lt;d&amp;e', `esc: quotes, angle brackets and ampersands (${R.esc('a"b>c<d&e')})`)
  ok(R.cut('abcdefgh', 5) === 'abcd…' && R.cutL('src/geo/circle.ts', 9) === '…ircle.ts' && R.cut('ab', 5) === 'ab', 'cut keeps the start of a name, cutL the end of a path')
  ok(R.plural(1, 'file') === '1 file' && R.plural(0, 'file') === '0 files' && R.plural(1500, 'link') === '1,500 links', 'plural')
  const tabs = ['overview', 'map', 'files', 'symbols', 'hotspots']
  ok(JSON.stringify([R.parseHash('#sym-12', tabs), R.parseHash('#file-3', tabs), R.parseHash('#mod-0', tabs), R.parseHash('#map', tabs), R.parseHash('#nope', tabs), R.parseHash('#sym-x', tabs), R.parseHash('', tabs), R.parseHash('#sym-12abc', tabs), R.parseHash('x#sym-12', tabs)])
    === '[{"kind":"sym","id":12},{"kind":"file","id":3},{"kind":"mod","id":0},{"kind":"tab","tab":"map"},null,null,null,null,null]', 'parseHash: plain anchors only, anything else ignored')
  ok(JSON.stringify([R.parseHash('#arch-1', tabs), R.parseHash('#doc-7', tabs), R.parseHash('#doc-x', tabs)]) === '[{"kind":"arch","id":1},{"kind":"doc","id":7},null]', 'parseHash: a diagram and a note have anchors too')
  ok([R.pairConf([3, 1, 2, 0]), R.pairConf([2, 0, 1, 1]), R.pairConf([2, 0, 0, 2])].join(' ') === 'resolved unique-name ambiguous', 'a file link is as sure as its surest edge')
  ok([0, 1, 2, 3, 7, 20, 400].map((c) => R.heatOf(c, 400)).join(' ') === '0 1 1 1 2 2 4' && R.heatOf(1, 1) === 4, 'heatOf: log-scale churn bands')
  ok(JSON.stringify(R.heatBands(400)) === '[[1,1,4],[2,5,20],[3,21,89],[4,90,400]]' && JSON.stringify(R.heatBands(1)) === '[[4,1,1]]' && JSON.stringify(R.heatBands(0)) === '[]', `heatBands: the legend's real ranges (${JSON.stringify(R.heatBands(400))})`)
  const sq = R.squarify([6, 6, 4, 3, 2, 2, 1], 0, 0, 6, 4)
  const area = sq.reduce((a, [, , w, h]) => a + w * h, 0)
  ok(sq.length === 7 && Math.abs(area - 24) < 1e-9 && sq.every(([x, y, w, h]) => x >= -1e-9 && y >= -1e-9 && x + w <= 6 + 1e-9 && y + h <= 4 + 1e-9) && Math.abs(sq[0][2] * sq[0][3] - 6) < 1e-9, 'squarify: every value gets an area in proportion, inside the rectangle')
  ok(JSON.stringify(R.squarify([], 0, 0, 10, 10)) === '[]' && JSON.stringify(R.squarify([0, 0], 0, 0, 10, 10)) === '[[0,0,0,0],[0,0,0,0]]', 'squarify: nothing to draw draws nothing')
  const mods = [{ i: 0, files: 5 }, { i: 1, files: 9 }, { i: 2, files: 1 }, { i: 3, files: 7 }]
  const lp = R.lanePick(mods, 3)
  ok(lp.shown.map((m) => m.i).join(' ') === '0 1 3' && lp.rest === 1 && R.lanePick(mods, 14).rest === 0, `lanePick: a lane keeps its largest modules, in flow order, and counts the rest (${lp.shown.map((m) => m.i)})`)
  ok(R.INITIAL.tests === false && R.INITIAL.guesses === false && R.INITIAL.tab === 'overview' && R.INITIAL.mapMode === 'modules' && R.LANE_MAX === 14 && R.MAXCOL === 12, 'the page opens on the overview, modules first, with test code and ambiguous links hidden')
  // the file map: a link whose every edge is ambiguous is flagged, and ranks no file
  const md = R.mapData([{ id: 1, repo: 'r', path: 'a.ts', is_test: 0, node_id: 11 }, { id: 2, repo: 'r', path: 'b.ts', is_test: 0, node_id: 12 }, { id: 3, repo: 'r', path: 'c.ts', is_test: 0, node_id: 13 }, { id: 4, repo: 'r', path: 'd.ts', is_test: 0, node_id: 14 }],
    [], [{ src: 11, dst: 12, kind: 'CALLS', confidence: 'ambiguous' }, { src: 11, dst: 13, kind: 'CALLS', confidence: 'import' }, { src: 11, dst: 13, kind: 'CALLS', confidence: 'ambiguous' }, { src: 11, dst: 14, kind: 'CALLS', confidence: 'unique-name' }])
  const byId = (id) => md.files.indexOf(id)
  const flags = md.links.map(([a, b, w, amb]) => `${md.files[a]}-${md.files[b]}:${w}:${amb}`).sort().join(' ')
  ok(flags === '1-2:1:1 1-3:2:0 1-4:1:0' && md.deg[byId(1)] === 1 && md.deg[byId(2)] === 0 && md.deg[byId(3)] === 1 && md.deg[byId(4)] === 0,
    `file map: ambiguous-only links are flagged to hide, and no name guess ranks a file (${flags}; deg ${md.deg})`)
}

// ── 2 · a polyglot project ──
console.log('\n2 · polyglot project (TypeScript · Rust · Python · Go)')
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-graph-')))
const PROJ = path.join(SANDBOX, 'poly')
cpSync(path.join(HERE, 'fixtures', 'poly'), PROJ, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') }) // never a stray local index
const q = (tool, args = {}) => call(`graph_${tool}`, args, { root: PROJ })

has(await q('status'), 'not been built', 'before graph_index, queries point at it instead of indexing implicitly')
const idx = await q('index')
has(idx, 'web: 5 files, 5 parsed', 'index: every repository of grimoire.config.json is indexed')
has(idx, 'shop: 4 files, 4 parsed', 'index: the Go repo too')

const st = await q('status')
has(st, 'files: typescript 5', 'status: languages per repo')
has(st, 'EXTENDS 1, IMPLEMENTS 1', 'status: edge counts per kind')
// shop (Go): New → Cart (`&Cart{}`) [same-file], Cart.Total → pricing.Sum [import], TestTotal → New
// [same-package], NewBuilder → Builder (`&Builder{}`), Build → NewBuilder and Build → BuildThing
// (`NewBuilder().BuildThing()`) [same-file], and `c.Total()` on `c := New()`, whose type the syntax
// does not state: the one name guess of its 7 call links.
has(st, 'name guesses: 14% of 7 call links (ambiguous + unique-name)', 'status: the share of call links that are name guesses, per repo')

let r = await q('callers', { symbol: 'square', repo: 'web', depth: 3 })
has(r, 'Circle.area  method  web/src/geo/circle.ts:8  [import]', 'TS: a named import resolves the call to the imported file')
has(r, 'cube  function  web/src/util/math.ts:5  [same-file]', 'TS: a call inside the file resolves same-file')
has(r, 'main  function  web/src/app.ts:4  [import]', 'TS: `math.cube()` through `import * as math` resolves through the namespace alias')
has(r, 'Leads, not facts', 'every answer carries the verify-in-code footer')

r = await q('callers', { symbol: 'Base.save' })
has(r, 'create  function  svc/app/service.py:5  [typed]', 'Python: `u = User(); u.save()` resolves to the inherited Base.save through the type of u')
r = await q('callees', { symbol: 'Base.save' })
has(r, 'Base.validate  method  svc/app/models.py:5  [same-class]', 'Python: self.validate() resolves within the class')
r = await q('callers', { symbol: 'slug' })
has(r, 'create  function  svc/app/service.py:5  [import]', 'Python: `from app import util; util.slug()` resolves the submodule')
r = await q('callers', { symbol: 'create', depth: 1 })
has(r, 'test_create  function test  svc/tests/test_service.py:4  [import]', 'Python: tests are marked and linked through absolute imports')

r = await q('callees', { symbol: 'run', repo: 'core' })
has(r, 'Circle.new  method  core/src/geo.rs:12  [qualified]', 'Rust: `Circle::new()` resolves to the impl block member')
has(r, 'Circle.area  method  core/src/geo.rs:18  [typed]', 'Rust: `c.area()` resolves through `let c = Circle::new()`')
lacks(r, 'Shape.area', 'Rust: … and not to the trait signature of the same name')
has(r, 'double  function  core/src/util.rs:5  [import]', 'Rust: `util::double()` through `pub mod util;`')
r = await q('callers', { symbol: 'run', repo: 'core' })
has(r, 'tests.runs  function test  core/src/lib.rs:16', 'Rust: a call inside assert!(…) is still a call; #[test] marks the test')
r = await q('callers', { symbol: 'Registry.len' })
has(r, 'registry_size  function  core/src/lib.rs:24  [typed]', 'Rust: `r.len()` on a typed receiver still links to Registry::len')
lacks(r, 'name_count', 'Rust: `names.len()` on an untyped receiver is the standard library\'s len, not the only len the repo defines')
lacks(r, 'core/src/geo.rs:32  [', 'Rust: `self.items.len()` inside Registry::len is not a call to itself')
has(r, 'Registry.count  method  core/src/geo.rs', 'Rust: `self.len()` resolves a standard-library name within its own type')
has(r, 'path_len  function  core/src/lib.rs', 'Rust: `Registry::len(r)` resolves a standard-library name on a qualified path')
has(r, 'fresh_len  function  core/src/lib.rs', 'Rust: `Registry::new().len()` is the constructed type\'s len')
has(r, 'crate_fresh_len  function  core/src/lib.rs', 'Rust: `crate::geo::Registry::new().len()` too, through a crate path')
r = await q('callers', { symbol: 'Registry.refresh_all' })
has(r, 'refresh  function  core/src/lib.rs:35', 'Rust: a name the standard library does not use still resolves on an untyped receiver')
r = await q('callers', { symbol: 'Registry.version' })
has(r, 'local_version  function  core/src/lib.rs:49', 'Rust: a chain that starts in the repository (`util::lookup().version()`) still resolves')
lacks(r, 'clock_version', 'Rust: `Clock::now().version()` starts at a type the repository does not define: a dependency\'s method')
for (const fn of ['arg_chain', 'turbo_version', 'inline_version', 'package_version', 'new_version', 'lib_name_version', 'crate_new_version', 'builder_version', 'turbo_dep', 'path_dep_version']) has(r, `${fn}  function  core/src/lib.rs`, `Rust: \`${fn}\` starts in the repository (an argument's \`Mode::Fast\`, a turbofish, an inline \`mod\`, the crate's own package name, a repository type are not dependencies)`)
lacks(r, 'output_version', 'Rust: `Output::builder().version()` stays in the dependency even though the repository has a module named `builder`')
lacks(r, 'sdk_version', 'Rust: `aws_sdk::util::Output::builder()` is decided by its root crate, not by a later segment named like a repository module')
lacks(r, 'crate_version', 'Rust: `semver::parse(..).version()` starts at a crate the repository does not have: a dependency\'s method')
r = await q('callers', { symbol: 'Ledger.save_all' })
has(r, 'audit2  function  svc/app/service.py', 'Python: a SCREAMING_CASE head with a call (`DEFAULT.get_ledger().save_all()`) is a constant, not a dependency type')
has(r, 'audit  function  svc/app/service.py', 'Python: a SCREAMING_CASE constant head (`DEFAULT.entries.save_all()`) is the repository\'s own value, not a dependency type')
r = await q('callers', { symbol: 'Ledger.update' })
has(r, 'AuditLedger.update  method  svc/app/models.py', 'Python: `super().update()` reaches the parent even though `update` is a standard-library name')
lacks(r, 'refresh  function  svc/app/service.py', 'Python: `rows.update()` on an untyped receiver is a dict/set method, not Ledger.update')
has(r, 'touch  function  svc/app/service.py', 'Python: `Ledger().update()` is the constructed type\'s update')
r = await q('callers', { symbol: 'AuditLedger.update' })
has(r, 'AuditLedger.again  method  svc/app/models.py', 'Python: `self.__class__.update(self)` is the class\'s own update')
r = await q('callers', { symbol: 'Café.servir' })
has(r, 'commande  function  svc/app/service.py', 'Python: a non-ASCII class (`Café.fabrique().servir()`) is the repository\'s own')
r = await q('callers', { symbol: 'Base.describe', repo: 'web' })
has(r, 'main  function  web/src/app.ts:4', 'TS: `c.describe()` on a typed receiver still links to the inherited method')
has(r, 'geoUnit  function  web/src/app.ts', 'TS: `Geo.Circle.unit()` reaches a repository class further down the path')
lacks(r, 'formatAll', 'TS: `new Intl.NumberFormat(..).describe()` starts at a type the repository does not define')
r = await q('callers', { symbol: 'Order.total_order' })
has(r, 'order_total  function  svc/app/service.py', 'Python: `Order().total_order()` starts at the repository\'s own class')
r = await q('callers', { symbol: 'BuildThing' })
has(r, 'Build  function  shop/builder/builder.go', 'Go: `NewBuilder().BuildThing()` starts at the repository\'s own factory')
r = await q('callers', { symbol: 'Meters.double_it' })
has(r, 'meters  function  core/src/lib.rs', 'Rust: `Meters(5.0).double_it()` starts at the repository\'s own tuple struct')
r = await q('callers', { symbol: 'Circle.has', repo: 'web' })
lacks(r, 'total  function  web/src/app.ts', 'TS: `seen.has(2)` on an untyped receiver is a Set/Map method, not Circle.has')
has(r, 'hasRadius  function  web/src/app.ts', 'TS: `new Circle(3).has(1)` is the constructed type\'s has')
r = await q('hierarchy', { symbol: 'Shape', repo: 'core' })
has(r, 'Circle  struct  core/src/geo.rs:7', 'Rust: `impl Shape for Circle` is an IMPLEMENTS edge')

r = await q('callees', { symbol: 'Cart.Total' })
has(r, 'Sum  function  shop/pricing/pricing.go:3  [import]', 'Go: `pricing.Sum` resolves through go.mod\'s module path')
r = await q('callees', { symbol: 'TestTotal' })
has(r, 'New  function  shop/cart/cart.go:9  [same-package]', 'Go: a bare call resolves within the package directory')
has(r, 'Cart.Total  method  shop/cart/cart.go:13', 'Go: `c.Total()` resolves to the receiver method')

r = await q('hierarchy', { symbol: 'Circle', repo: 'web' })
has(r, 'Base  class  web/src/geo/shape.ts:5  [import]', 'hierarchy: extends')
has(r, 'Shape  interface  web/src/geo/shape.ts:1  [import]', 'hierarchy: implements')

r = await q('impact', { target: 'web/src/util/math.ts' })
has(r, 'web/src/app.ts  (distance 1)', 'impact of a file: importers and callers, grouped by file')
has(r, 'Circle.area:8  d1 [import]', 'impact: the symbols reached, with distance and confidence')
has(r, 'src/app.test.ts  file test  web/src/app.test.ts  d2', 'impact: the tests on those paths')

r = await q('path', { from: 'main', to: 'square' })
has(r, '2. square  function  web/src/util/math.ts:1', 'path: the shortest call chain')
r = await q('file', { path: 'svc/app/service.py' })
has(r, 'Imported by:\n  svc/tests/test_service.py', 'file: importers')
has(r, '  svc/app/util.py', 'file: resolved imports')
r = await q('search', { query: 'Circ*' })
has(r, 'Circle  struct  core/src/geo.rs:7', 'search: wildcards, across repositories')
r = await q('symbol', { symbol: 'square' })
has(r, 'matches 2 symbols', 'an ambiguous name answers for each match and says how to narrow')
r = await q('symbol', { symbol: 'web/src/util/math.ts:2' })
has(r, 'square  function  web/src/util/math.ts:1', 'path:line resolves to the innermost definition')
r = await q('sql', { sql: "SELECT count(*) AS n FROM edges WHERE kind = 'IMPORTS'" })
has(r, 'n\n13', 'sql: a read-only SELECT')
has(await q('sql', { sql: 'DELETE FROM nodes' }), 'Only a single SELECT', 'sql: anything but SELECT is refused')

{ // the page of the polyglot project: its exact modules and links, and which files belong to none
  const { renderGraph } = await import('../lib/render.mjs')
  const pageP = await renderGraph({ dbPath: path.join(PROJ, '.grimoire/graph/graph.db') })
  const DP = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pageP)[1].replace(/\\u003c/g, '<'))
  const mods = DP.system.modules.map((m) => `${m.repo}:${m.key}:${m.files}`).join(' ')
  const links = DP.system.links.map(([a, b, n]) => `${DP.system.modules[a].repo}:${DP.system.modules[a].key}>${DP.system.modules[b].key}:${n}`).join(' ')
  ok(mods === 'core:src:4 shop:builder:1 shop:cart:1 shop:pricing:1 svc:app:4 web:src:4' && links === 'shop:cart>pricing:1', `system map of the fixture: five modules, one link (${mods} | ${links})`)
  const modOf = (repo, p) => { const f = DP.files.find((x) => x[1] === repo && x[2] === p); return f ? f[8] : 'missing' }
  ok(modOf('shop', 'cart/cart.go') === 2 && modOf('shop', 'pricing/pricing.go') === 3 && modOf('shop', 'cart/cart_test.go') === -1 && modOf('web', 'src/app.test.ts') === -1,
    'each production file names its module; test files belong to none')
  const script = (/<script>([\s\S]*)<\/script>\s*<\/body>/.exec(pageP) || [])[1] || ''
  const csp = (/script-src '([^']+)'/.exec(pageP) || [])[1] || ''
  const { createHash } = await import('node:crypto')
  const scriptSrc = (/script-src ([^;"]+)/.exec(pageP) || [])[1] || ''
  ok(csp === `sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}` && !scriptSrc.includes('unsafe-inline'),
    'the CSP admits the page\'s own script by its hash, and no inline handler: an escaping slip cannot run code')
  const helpers = ['esc', 'cut', 'cutL', 'plural', 'parseHash', 'pairConf', 'heatOf', 'heatBands', 'squarify', 'lanePick', 'mdSlug', 'mdFront', 'mdToHtml', 'archClient', 'docsClient']
  ok(helpers.every((n) => script.includes(`function ${n}(`)), `the page carries every helper its client calls (${helpers.filter((n) => !script.includes(`function ${n}(`)).join(', ') || 'all'})`)

  // Run the page's own script against a small stub DOM: every view renders, anchors open what they
  // name, and the test-code toggle changes what a neighbourhood hides.
  const vm = await import('node:vm')
  const run = (hash) => {
    const listeners = {}
    class El {
      constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.html = ''; this.value = ''; this.checked = false; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} } }
      setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v); if (k === 'checked') this.checked = true }
      getAttribute(k) { return this.attrs[k] ?? null }
      append(...c) { this.kids.push(...c) }
      addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f) }
      set innerHTML(v) { this.html = v; this.firstChild = new El('svg') }
      get innerHTML() { return this.html }
      querySelectorAll() { return [] }
      focus() {} blur() {} setSelectionRange() {}
      get offsetHeight() { return 0 }
    }
    const doc = { createElement: (t) => new El(t), getElementById: () => ({ textContent: blob }), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null, querySelector: () => null }
    const loc = { hash }
    const win = { addEventListener: (t, f) => { listeners[t] = f }, innerWidth: 1400, scrollTo() {} }
    vm.runInNewContext(script, { document: doc, window: win, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }) })
    const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
    const find = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = find(k, pred); if (f) return f } return null }
    const go = (h) => { loc.hash = h; listeners.hashchange() }
    return { text: () => (doc.body.kids || []).map(dump).join(' '), go, find: (pred) => (doc.body.kids || []).map((k) => find(k, pred)).find(Boolean), hash: () => loc.hash }
  }
  const blob = /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pageP)[1]
  try {
  const views = {}
  const pg = run('#overview')
  views.overview = /production files/.test(pg.text())
  pg.go('#map'); views.map = /data-mod="/.test(pg.text()) && /class="mlink"/.test(pg.text())
  pg.go('#hotspots'); views.hotspots = /class="tile"/.test(pg.text())
  pg.go('#architecture'); views.architecture = /data-comp="/.test(pg.text()) && /Drafted from the graph on this render/.test(pg.text()) && pg.hash() === '#arch-0'
  pg.go('#docs'); views.docs = /No Markdown notes/.test(pg.text())
  pg.go('#files'); views.files = /#file-\d+/.test(pg.text())
  const cart = DP.system.modules.findIndex((m) => m.repo === 'shop' && m.key === 'cart')
  pg.go(`#mod-${cart}`); views.module = /Files of/.test(pg.text()) && pg.hash() === `#mod-${cart}`
  ok(Object.values(views).every(Boolean), `the page script renders every view and opens a module by its anchor (${JSON.stringify(views)})`)
  const total = DP.nodes.find((n) => n[3] === 'Cart.Total')
  pg.go(`#sym-${total[0]}`)
  const hidden = /1 in test code hidden/.test(pg.text()) && !/aria-label="TestTotal/.test(pg.text()) // the drawing hides it; the full list below keeps it
  const tog = pg.find((n) => n.dataset && n.dataset.ctl === 'tog-tests')
  tog.on.change[0]({ target: { checked: true } })
  const shown = !/in test code hidden/.test(pg.text()) && /data-sym="\d+"[^>]*aria-label="TestTotal/.test(pg.text())
  ok(hidden && shown && pg.hash() === `#sym-${total[0]}`, `a neighbourhood hides its test callers and says so until the toggle shows them (hidden ${hidden}, shown ${shown})`)
  } catch (e) { ok(false, `the page script runs (${e.message})`) }
}

// ── 3 · incremental refresh ──
console.log('\n3 · incremental refresh')
const circle = path.join(PROJ, 'web/src/geo/circle.ts')
writeFileSync(circle, readFileSync(circle, 'utf8').replace('return Math.PI * square(this.r)', 'return Math.PI * square(this.r) + halve(this.r)') + '\nexport function halve(x: number): number {\n  return x / 2\n}\n')
writeFileSync(path.join(PROJ, 'web/src/report.ts'), "import { main } from './app'\n\nexport function report(): string {\n  return String(main())\n}\n")
rmSync(path.join(PROJ, 'svc/app/util.py'))
r = await q('callers', { symbol: 'halve' })
has(r, 'Circle.area  method  web/src/geo/circle.ts:8  [same-file]', 'an edited file is re-parsed before the next query')
r = await q('callers', { symbol: 'main', repo: 'web' })
has(r, 'report  function  web/src/report.ts:3  [import]', 'a new file is picked up')
has(await q('search', { query: 'slug' }), 'Nothing named like', 'a deleted file leaves the graph')
has(await q('status'), 'files: python 4', 'status counts follow')
{ // an index built by another grimoire version rebuilds on the next query, not only on the next write
  const { openStore } = await import('../lib/store.mjs')
  const old = await openStore(path.join(PROJ, '.grimoire/graph/graph.db'))
  old.prepare("UPDATE meta SET value = '2' WHERE key = 'schema'").run(); old.close()
  await q('search', { query: 'Circle' })
  has(await q('sql', { sql: "SELECT value FROM meta WHERE key = 'schema'" }), 'value\n3', 'a query on an older schema rebuilds the index first')
  has(await q('sql', { sql: 'SELECT count(*) AS n FROM churn' }), 'n\n0', 'the rebuilt index has the churn table (empty: the fixture is not a git repository)')
}

// ── 4 · MCP over stdio ──
console.log('\n4 · MCP server')
const mcp = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'mcp.mjs')], { env: { ...process.env, GRIMOIRE_PROJECT_DIR: PROJ }, stdio: ['pipe', 'pipe', 'inherit'] })
const replies = new Map()
let buf = ''
mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m) } })
const rpc = (id, method, params) => { mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return new Promise((res) => { const t = setInterval(() => { if (replies.has(id)) { clearInterval(t); res(replies.get(id)) } }, 10) }) }
const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
ok(init.result?.serverInfo?.name === 'grimoire-graph' && /RESEARCH/.test(init.result.instructions), 'initialize: server info and research-only instructions')
mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
const list = await rpc(2, 'tools/list', {})
const names = (list.result?.tools || []).map((t) => t.name)
ok(['graph_status', 'graph_index', 'graph_search', 'graph_symbol', 'graph_callers', 'graph_callees', 'graph_impact', 'graph_file', 'graph_hierarchy', 'graph_path', 'graph_sql'].every((n) => names.includes(n)), `tools/list: the 11 tools (${names.length})`)
ok(list.result.tools.every((t) => t.inputSchema?.type === 'object'), 'tools/list: every tool has an object input schema')
const res = await rpc(3, 'tools/call', { name: 'graph_callers', arguments: { symbol: 'Cart.Total' } })
has(res.result?.content?.[0]?.text || '', 'TestTotal  function test  shop/cart/cart_test.go:5', 'tools/call: answers as text content')
const bad = await rpc(4, 'tools/call', { name: 'graph_nope', arguments: {} })
ok(bad.result?.isError === true, 'tools/call: an unknown tool is an error result, not a crash')
const unknown = await rpc(5, 'no/such/method', {})
ok(unknown.error?.code === -32601, 'unknown methods get JSON-RPC -32601')
mcp.kill()
const calls = readFileSync(path.join(PROJ, '.grimoire/graph/calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
ok(calls.some((c) => c.tool === 'graph_callers' && c.ok === true && typeof c.ms === 'number') && calls.some((c) => c.tool === 'graph_nope' && c.ok === false), 'audit log: one line per tools/call, success and failure')
ok(calls.every((c) => !('arguments' in c)), 'audit log: arguments are not logged')

// ── 5 · worktrees, the lock, the hook's refresh ──
console.log('\n5 · worktrees and refresh')
const { withLock, mainCheckout } = await import('../lib/freshness.mjs')
const MAIN = path.join(SANDBOX, 'main')
mkdirSync(path.join(MAIN, 'src'), { recursive: true })
writeFileSync(path.join(MAIN, 'grimoire.config.json'), '{ "graph": {} }\n')
writeFileSync(path.join(MAIN, '.gitignore'), '.grimoire/\n')
writeFileSync(path.join(MAIN, 'src/a.ts'), 'export function base(): number {\n  return 1\n}\n')
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
git(MAIN, 'init', '-q', '-b', 'main'); git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init')
const refresh = (root) => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), 'refresh', '--root', root], { encoding: 'utf8' })
writeFileSync(path.join(MAIN, 'src/a.ts'), 'export function base(): number {\n  return 2\n}\n'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'two')
writeFileSync(path.join(MAIN, 'src/c.ts'), 'export const c = 1\n'); git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'three')
mkdirSync(path.join(MAIN, 'gen'))
for (let i = 0; i < 26; i++) writeFileSync(path.join(MAIN, `gen/g${i}.ts`), `export const g${i} = ${i}\n`)
git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a sweep of 26 files')
let rf = refresh(MAIN)
ok(rf.status === 0 && existsSync(path.join(MAIN, '.grimoire/graph/graph.db')), `refresh builds the first index when grimoire.config.json has a graph block (${rf.stdout.trim() || rf.stderr.trim()})`)
const BARE = path.join(SANDBOX, 'bare'); mkdirSync(BARE)
rf = refresh(BARE)
ok(rf.status === 0 && !existsSync(path.join(BARE, '.grimoire')), 'refresh is a silent no-op in a project that never set the graph up')
const WT = path.join(SANDBOX, 'wt')
git(MAIN, 'worktree', 'add', '-q', '-b', 'feat', WT)
{ // churn: how many recent commits touched each file, for the hotspot treemap
  const churn = await call('graph_sql', { sql: 'SELECT path, n FROM churn ORDER BY path' }, { root: MAIN })
  ok(churn.trim() === 'path\tn\nsrc/a.ts\t2\nsrc/c.ts\t1', `churn: commits per file (a.ts in 2, c.ts in 1); a sweep of more than 25 files counts for none of them (${JSON.stringify(churn.slice(0, 60))})`)
}
{ // a repository dropped from the config leaves nothing behind, its churn included
  const DR = path.join(SANDBOX, 'drop')
  for (const r of ['keep', 'gone']) {
    mkdirSync(path.join(DR, r), { recursive: true }); writeFileSync(path.join(DR, r, 'x.ts'), 'export const x = 1\n')
    git(path.join(DR, r), 'init', '-q', '-b', 'main'); git(path.join(DR, r), 'add', '-A'); git(path.join(DR, r), '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one')
  }
  const cfg = (names) => writeFileSync(path.join(DR, 'grimoire.config.json'), JSON.stringify({ repos: names.map((n) => ({ name: n, path: n })), graph: {} }))
  cfg(['keep', 'gone']); await call('graph_index', {}, { root: DR })
  cfg(['keep']); await call('graph_index', {}, { root: DR })
  const left = await call('graph_sql', { sql: 'SELECT repo, path, n FROM churn ORDER BY repo' }, { root: DR })
  ok(left.trim() === 'repo\tpath\tn\nkeep\tx.ts\t1', `dropping a repository drops its churn too (${JSON.stringify(left.trim())})`)
}
ok(mainCheckout(WT) === MAIN && mainCheckout(MAIN) === null, 'a linked worktree finds its main checkout; the main checkout has none')
writeFileSync(path.join(WT, 'src/b.ts'), "import { base } from './a'\n\nexport function onBranch(): number {\n  return base()\n}\n")
r = await call('graph_callers', { symbol: 'base' }, { root: WT })
has(r, 'onBranch  function  src/b.ts:3', 'a worktree with no index is seeded from the main checkout and sees its own branch')
lacks(await call('graph_search', { query: 'onBranch' }, { root: MAIN }), 'src/b.ts', 'the main checkout index is untouched by the worktree')
const rd = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), 'render', '--root', WT], { encoding: 'utf8' })
const page = rd.status === 0 ? readFileSync(rd.stdout.trim(), 'utf8') : ''
ok(rd.stdout.trim() === path.join(WT, '.grimoire/graph/graph.html') && page.startsWith('<!doctype html>'), `render writes the page next to the index and prints its path (${rd.stderr.trim().slice(0, 200)})`)
const blob = JSON.parse((/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page) || [])[1] || 'null')
ok(blob && blob.files.some((f) => f[2] === 'src/b.ts') && blob.nodes.some((n) => n[3] === 'onBranch') && blob.edges.length > 0, 'the page carries every file, symbol and edge of the index')
ok(/default-src 'none'/.test(page) && !/<script[^>]+src=/.test(page) && !/https?:\/\//.test(page.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '')), 'the page is self-contained: a CSP, no external script, no URL outside the data')
{ // what the page carries beyond the index rows: churn, modules, and a client that compiles
  const rm = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), 'render', '--root', MAIN], { encoding: 'utf8' })
  const pageM = rm.status === 0 ? readFileSync(rm.stdout.trim(), 'utf8') : ''
  const DM = JSON.parse(((/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pageM) || [])[1] || 'null').replace(/\\u003c/g, '<'))
  const row = (p) => DM && DM.files.find((f) => f[2] === p)
  ok(!!row('src/a.ts') && !!row('src/c.ts') && row('src/a.ts')[7] === 2 && row('src/c.ts')[7] === 1, `files carry their churn for the hotspot map (${JSON.stringify(row('src/a.ts'))})`)
  // a later commit recounts: each file one row, never a stale or a doubled one; a non-ASCII path counts too
  writeFileSync(path.join(MAIN, 'src/a.ts'), 'export function base(): number {\n  return 3\n}\n'); writeFileSync(path.join(MAIN, 'src/café.ts'), 'export const c = 2\n')
  git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'four')
  refresh(MAIN)
  const again = (await call('graph_sql', { sql: "SELECT path, n FROM churn WHERE path LIKE 'src/%' ORDER BY path" }, { root: MAIN })).trim()
  ok(again === 'path\tn\nsrc/a.ts\t3\nsrc/c.ts\t1\nsrc/café.ts\t1', `churn after a new commit: recounted, one row a file, non-ASCII paths included (${JSON.stringify(again)})`)
  ok(DM && DM.system && DM.system.modules.map((m) => `${m.repo}:${m.key}:${m.files}`).join(' ') === 'main:gen:26 main:src:2', `the page carries the system map's modules (${JSON.stringify(DM && DM.system)})`)
  const script = (/<script>([\s\S]*)<\/script>\s*<\/body>/.exec(pageM) || [])[1] || ''
  let compiles = false
  try { new (await import('node:vm')).Script(script); compiles = script.length > 1000 } catch (e) { console.log('       ' + e.message) }
  ok(compiles, 'the page script compiles')
}
mkdirSync(path.join(WT, 'src/<b>'), { recursive: true })
writeFileSync(path.join(WT, 'src/<b>/x.ts'), 'export function tagged(): number {\n  return 1\n}\n')
const rd2 = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), 'render', '--root', WT], { encoding: 'utf8' })
const data2 = rd2.status === 0 ? (/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(readFileSync(rd2.stdout.trim(), 'utf8')) || [])[1] || '' : ''
ok(data2.includes('src/\\u003cb>/x.ts') && !data2.includes('<'), 'a path holding "<" is escaped: data can never close the script element')
const { layoutMap } = await import('../lib/layout.mjs')
{ // the map's file cap is shared per repository
  const { openStore } = await import('../lib/store.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const CAP = path.join(SANDBOX, 'cap'); mkdirSync(path.join(CAP, '.grimoire/graph'), { recursive: true })
  const db = await openStore(path.join(CAP, '.grimoire/graph/graph.db'))
  db.exec("INSERT INTO repos(name, root) VALUES('big', 'big'), ('small', 'small')")
  const ins = db.prepare('INSERT INTO files(id, repo, path, lang, is_test, node_id) VALUES(?, ?, ?, ?, 0, ?)')
  const edge = db.prepare("INSERT INTO edges(src, dst, kind) VALUES(?, ?, 'IMPORTS')")
  for (let i = 1; i <= 1900; i++) ins.run(i, 'big', `src/f${i}.ts`, 'typescript', 100000 + i)
  for (let i = 1901; i <= 2000; i++) ins.run(i, 'small', `lib/g${i}.ts`, 'typescript', 100000 + i)
  for (let i = 1; i < 1900; i++) edge.run(100000 + i, 100000 + i + 1) // big is densely linked, small not at all
  const insT = db.prepare('INSERT INTO files(id, repo, path, lang, is_test, node_id) VALUES(?, ?, ?, ?, 1, ?)')
  for (let i = 2001; i <= 2050; i++) { insT.run(i, 'big', `tests/t${i}.ts`, 'typescript', 100000 + i); for (let j = 1; j <= 40; j++) edge.run(100000 + i, 100000 + j) } // tests: the most linked of all
  db.close()
  const pageCap = await renderGraph({ dbPath: path.join(CAP, '.grimoire/graph/graph.db') })
  const Dc = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pageCap)[1].replace(/\\u003c/g, '<'))
  const smallShown = Dc.map.files.filter((id) => id > 1900).length
  ok(Dc.map.files.length === 1500 && smallShown >= 70, `the 1500-file map cap is shared per repo: the unlinked small repo keeps ${smallShown} of its 100`)
  ok(Dc.map.files.every((id) => id <= 2000), `the map's cap goes to production code first: test files, however linked, only fill free slots (${Dc.map.files.filter((id) => id > 2000).length} test files kept)`)
  ok(Dc.map.totals.small === 100 && Dc.map.totals.big === 1900, 'per-repo totals reach the page for the note')
}
{ // change together: each repository keeps its own strongest pairs, each pair once
  const { openStore } = await import('../lib/store.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const CO = path.join(SANDBOX, 'co'); mkdirSync(path.join(CO, '.grimoire/graph'), { recursive: true })
  const db = await openStore(path.join(CO, '.grimoire/graph/graph.db'))
  db.exec("INSERT INTO repos(name, root) VALUES('busy', 'busy'), ('quiet', 'quiet')")
  const ins = db.prepare('INSERT INTO cochange(repo, a, b, n) VALUES(?, ?, ?, ?)')
  for (let i = 0; i < 150; i++) { ins.run('busy', `a${i}.ts`, `b${i}.ts`, 9 + (i % 5)); ins.run('busy', `b${i}.ts`, `a${i}.ts`, 9 + (i % 5)) } // stored both ways, as cochange.mjs does
  ins.run('quiet', 'x.ts', 'y.ts', 3); ins.run('quiet', 'y.ts', 'x.ts', 3)
  // a hub: cochange.mjs keeps each file's 12 strongest partners, so a hub's later pairs are stored one way only
  for (let i = 0; i < 20; i++) { ins.run('hub', 'aaa.ts', `p${String(i).padStart(2, '0')}.ts`, 2); if (i < 12) ins.run('hub', `p${String(i).padStart(2, '0')}.ts`, 'aaa.ts', 2) }
  for (let i = 0; i < 20; i++) ins.run('hub', `zz${i}.ts`, 'aab.ts', 2) // stored one way, with the later name first
  db.close()
  const pageCo = await renderGraph({ dbPath: path.join(CO, '.grimoire/graph/graph.db') })
  const Dco = JSON.parse(/<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pageCo)[1].replace(/\\u003c/g, '<'))
  const quiet = Dco.cochange.filter(([r]) => r === 'quiet'), busy = Dco.cochange.filter(([r]) => r === 'busy')
  const hub = Dco.cochange.filter(([r]) => r === 'hub')
  ok(hub.length === 25 && new Set(hub.map(([, a, b]) => [a, b].sort().join(' '))).size === 25 && hub.some(([, a, b]) => a.startsWith('zz') || b.startsWith('zz')),
    `change together: a pair stored one way only still counts, once (${hub.length} hub pairs)`)
  ok(JSON.stringify(quiet) === '[["quiet","x.ts","y.ts",3]]' && busy.length === 25 && busy.every(([, a, b]) => a < b),
    `change together: a quiet repository keeps its pair beside a busy one, 25 per repository, each pair once (${quiet.length} quiet, ${busy.length} busy)`)
}
const lf = [...Array(60)].map((_, i) => ({ id: i, repo: i < 40 ? 'a' : 'b', path: `${i % 3 ? 'src' : 'lib'}/f${i}.ts`, deg: i % 9 }))
const ll = [...Array(120)].map((_, i) => [i % 60, (i * 7 + 3) % 60, 1 + (i % 3)]).filter(([x, y]) => x !== y)
const L1 = layoutMap(lf, ll), L2 = layoutMap(lf, ll)
ok(JSON.stringify(L1) === JSON.stringify(L2), 'map layout is deterministic: same index, same picture')
ok(L1.pos.every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000) && L1.groups.length === 4, 'every file is on the page; one group per repo directory')
ok(L1.groups.every((g, i) => L1.groups.every((o, j) => i === j || (g.x - o.x) ** 2 + (g.y - o.y) ** 2 >= (g.r + o.r) ** 2)), 'directory clusters never overlap')
const LOCKDIR = path.join(SANDBOX, 'lock')
let runs = 0, inner
const outer = await withLock(LOCKDIR, async () => { runs++; if (runs === 1) inner = await withLock(LOCKDIR, async () => 'never'); return 'done' })
ok(inner?.busy === true, 'a second indexer does not overlap: it gets busy and marks the index pending')
ok(outer === 'done' && runs === 2 && !existsSync(path.join(LOCKDIR, 'index.lock')), 'the holder re-runs for the pending change, then releases the lock')
writeFileSync(path.join(LOCKDIR, 'index.lock'), '999999999')
ok(await withLock(LOCKDIR, async () => 'taken') === 'taken', 'a lock left by a dead process is taken over')
writeFileSync(path.join(LOCKDIR, 'index.lock'), String(process.pid))
ok((await withLock(LOCKDIR, async () => 'stolen'))?.busy === true, 'a fresh lock held by a live pid is respected')
const old = new Date(Date.now() - 26 * 60_000); utimesSync(path.join(LOCKDIR, 'index.lock'), old, old)
ok(await withLock(LOCKDIR, async () => 'taken') === 'taken', 'a lock older than any index run is taken over even when its pid was reused')
ok(!readdirSync(LOCKDIR).some((f) => f.startsWith('index.lock.')), 'no temp files left behind')
const contenders = await Promise.all([0, 1, 2, 3].map(() => new Promise((res) => {
  const c = spawn(process.execPath, ['--input-type=module', '-e', `import { withLock } from ${JSON.stringify(path.join(ROOT, 'lib/freshness.mjs'))}; const r = await withLock(${JSON.stringify(path.join(SANDBOX, 'race'))}, async () => { await new Promise((z) => setTimeout(z, 300)); return 'ran' }); console.log(JSON.stringify(r))`], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''; c.stdout.on('data', (d) => { out += d }); c.on('close', () => res(out.trim()))
})))
ok(contenders.filter((r) => r === '"ran"').length >= 1 && contenders.every((r) => r === '"ran"' || r === '{"busy":true}'), `four racing processes: never an error, busy ones hand over (${contenders.join(' ')})`)
const RACE2 = path.join(SANDBOX, 'race2'); mkdirSync(RACE2)
const MARK = path.join(SANDBOX, 'race2.inside')
writeFileSync(path.join(RACE2, 'index.lock'), '999999999') // a dead holder everyone recovers from at once
const recover = await Promise.all([...Array(6)].map(() => new Promise((res) => {
  const c = spawn(process.execPath, ['--input-type=module', '-e', `import { withLock } from ${JSON.stringify(path.join(ROOT, 'lib/freshness.mjs'))}; import { appendFileSync, readFileSync } from 'node:fs'; const r = await withLock(${JSON.stringify(RACE2)}, async () => { appendFileSync(${JSON.stringify(MARK)}, '+'); const n = readFileSync(${JSON.stringify(MARK)}, 'utf8'); await new Promise((z) => setTimeout(z, 250)); appendFileSync(${JSON.stringify(MARK)}, '-'); return n }); console.log(JSON.stringify(r))`], { stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''; c.stdout.on('data', (d) => { out += d }); c.on('close', () => res(out.trim()))
})))
const trace = existsSync(MARK) ? readFileSync(MARK, 'utf8') : ''
ok(/^(\+-)+$/.test(trace) && recover.every((r) => r !== ''), `six processes recovering one dead lock: never two inside at once (${trace}; ${recover.join(' ')})`)

rmSync(SANDBOX, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
