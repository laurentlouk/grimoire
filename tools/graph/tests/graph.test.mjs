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
//
//  Needs the parser runtime (web-tree-sitter + grammars): `npm ci --prefix tools/graph`, or a
//  prior index that installed it into the user cache. Without it the file is skipped, except
//  under CI, where a missing runtime fails.
import { spawnSync, spawn } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync, realpathSync } from 'node:fs'
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

// ── 2 · a polyglot project ──
console.log('\n2 · polyglot project (TypeScript · Rust · Python · Go)')
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-graph-')))
const PROJ = path.join(SANDBOX, 'poly')
cpSync(path.join(HERE, 'fixtures', 'poly'), PROJ, { recursive: true })
const q = (tool, args = {}) => call(`graph_${tool}`, args, { root: PROJ })

has(await q('status'), 'not been built', 'before graph_index, queries point at it instead of indexing implicitly')
const idx = await q('index')
has(idx, 'web: 5 files, 5 parsed', 'index: every repository of grimoire.config.json is indexed')
has(idx, 'shop: 3 files, 3 parsed', 'index: the Go repo too')

const st = await q('status')
has(st, 'files: typescript 5', 'status: languages per repo')
has(st, 'EXTENDS 1, IMPLEMENTS 1', 'status: edge counts per kind')

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

rmSync(SANDBOX, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
