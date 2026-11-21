// ════════════════════════════════════════════════════════════════════════════
//  Tests — the code graph (tools/graph)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/graph.test.mjs
//
//  1. extraction: one sample per language (fixtures/langs) → the definitions, calls, supertypes
//     and imports the syntax states, and the variable types bindings.mjs reads off it; one-line
//     definitions holding literals → signatures and receivers with no literal's value
//  2. a polyglot project (fixtures/poly: TypeScript, Rust, Python, Go repos in one config) →
//     the resolved edges and their confidence, through the same `call()` the MCP server uses;
//     2b: no literal's value in any answer, the page or the index's bytes
//  3. incremental refresh: an edit, a new file and a deletion show up in the next query
//  4. the MCP server over stdio: initialize, tools/list, tools/call, read-only SQL
//  5. worktrees, the lock, the hook's refresh, churn, and the page (data, CSP, its script run in a stub DOM)
//  6. beyond the edges (fixtures/edge): dispatch, unlinked call sites and mentions in graph_impact;
//     graph_diff (definitions against the base, contract changes still named, tests, co-change gaps,
//     risk); graph_overview; several-word search; no literal quoted in any of them
//  6b. the review's cases: CommonJS definitions, cross-repository calls, local bindings, namespaces,
//     keyword arguments, Ruby symbols, credential files, a huge line, JSX text, the diff's parsing
//  6c. dependency injection: fields typed by their declaration or their constructor (TypeScript, Java,
//     Python), no self-recursion from a call on a field, a Python bare call never the class's method
//  6d. fixtures/frame: members a framework declares (Ruby scopes, associations, delegate, accessors,
//     define_method), annotated fields (a plugin's hooks, a settings class), TypeScript class fields;
//     functions passed as values (a router's handlers, a queued task, a signal's receiver) as
//     REFERENCES, followed by impact, callers, test discovery, the diff and the overview
//  6f. fixtures/resolve: resolution's narrowing (call chains on self, the self-call guard, types from
//     dependencies, closures, locals, platform variants, Ruby callback symbols, JSX imports and aliases,
//     non-wrapper calls, router procedures, runtime globals, super) and typed unlinked sites in impact
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
  const r = extract(tree, lang, false, f)
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
  'a.tsx': { defs: ['function Text', 'function Fancy', 'function Box', 'function Themed', 'function useStore', 'function Card', 'function a'], calls: ['View', 'UI.Row', 'Label', 'Text', 'Card', 'format', 'count'], imports: ['react-native', './ui'] },
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
ok(!facts['a.tsx'].calls.includes('div'), 'JSX: a lowercase tag is the host\'s element, never a call')
ok(!facts['a.tsx'].defs.some((d) => /doubled|timer|onPress/.test(d)), `JSX: an array built by a callback, a timer, a hook inside a component are no definitions (${facts['a.tsx'].defs.join(', ')})`)
ok(facts['a.rs'].defs.includes('function test_run') && facts['a.rs'].defs.every((d) => !d.startsWith('method run')), 'Rust: free functions stay functions; impl members become methods of their type')
{ // A literal may hold a secret: a signature keeps the name, parameters and return type, up to the
  // body; each string, template, character or regex literal in it shows as `…` between its
  // delimiters, a comment is dropped, and a call's receiver text hides literals the same way.
  const one = {
    typescript: ["export function token(/* canary3 */ scope: string = 'canary1'): string { return db.query(`ALTER ROLE app PASSWORD 'canary2'`).then((r) => r.text()) }\ntype Verb = 'canary4' | 'b'\nclass K { m(x = /canary5/g) { return 'canary6'.length } }\nfunction pick(x: number) { return handlers['canary7'](x) }\n",
      { token: "function token(scope: string = '…'): string", Verb: "type Verb = '…' | '…'", K: 'class K', 'K.m': 'm(x = /…/)' }],
    python: ['def token(scope="canary1"): return requests.get(f"https://api.test/?key=canary2{scope}").json()  # canary3\nclass K:  # canary4\n  pass\n',
      { token: 'def token(scope="…")', K: 'class K' }],
    go: ['package p\n\nfunc Token() string { return fmt.Sprintf(`canary2`, "canary1", \'c\') } // canary3\n',
      { Token: 'func Token() string' }],
    rust: ['pub fn token() -> String { "canary1".to_string() + &format!("{}", r#"canary2"#.len()) } // canary3\n',
      { token: 'pub fn token() -> String' }],
    java: ['class A { @Query("SELECT u FROM User u WHERE u.key = \'canary1\'") public String token() { return "canary2".trim(); } }\n',
      { A: 'class A', 'A.token': '@Query("…") public String token()' }],
    kotlin: ['fun token(scope: String = "canary1"): String = "canary2".uppercase()\nclass K(val a: Int) { fun m() = "canary3" }\n',
      { token: 'fun token(scope: String = "…"): String', K: 'class K(val a: Int)', 'K.m': 'fun m()' }],
    c: ['const char *token(void) { return "canary1"; } /* canary2 */\n#define TOKEN(x) "canary3" x\nint pick(int x) { return m["canary4"](x); }\n', { token: 'const char *token(void)', TOKEN: '#define TOKEN(x)' }],
    cpp: ['std::string token() { return std::string(R"(canary1)").substr(1); }\n#define TOKEN(x) printf("canary2 %s", x)\n', { token: 'std::string token()', TOKEN: '#define TOKEN(x)' }],
    csharp: ['class A { public string Token(string s = @"canary1") => $"canary2".Trim(); }\n', { A: 'class A' }],
    ruby: ["def token(scope = 'canary1') = \"canary2\".upcase\nclass K; def m; %q(canary3).strip; end; end\n", {}],
    php: ["<?php function token($s = 'canary1') { return strtoupper(\"canary2\"); }\nfunction pick($x) { return $m[\"canary3\"]($x) . (new Foo)->{\"canary4\"}(); }\n", { token: "function token($s = '…')" }],
    swift: ['func token(scope: String = "canary1") -> String { return "canary2".uppercased() }\n', { token: 'func token(scope: String = "…") -> String' }],
  }
  for (const [lang, [src, want]] of Object.entries(one)) {
    const tree = (await rt.parserFor(lang)).parse(src)
    const r = extract(tree, lang, false)
    tree.delete()
    const sig = Object.fromEntries(r.symbols.map((s) => [s.qualname, s.signature]))
    const leaks = [...r.symbols.map((s) => s.signature), ...r.refs.map((x) => `${x.qual || ''} ${x.name}`)].filter((t) => /canary/.test(t))
    const wrong = Object.entries(want).filter(([q, s]) => sig[q] !== s).map(([q, s]) => `${q}: ${JSON.stringify(sig[q])}, not ${JSON.stringify(s)}`)
    ok(r.symbols.length && !leaks.length && !wrong.length, `${lang}: no literal's value in a one-line definition's signature, a macro's, a receiver or a name called by a string key${leaks.length ? `; leaks ${JSON.stringify(leaks)}` : ''}${wrong.length ? `; ${wrong.join(' · ')}` : ''}`)
  }
  const rs = extract((await rt.parserFor('rust')).parse(one.rust[0]), 'rust', false).refs.filter((x) => x.qual).map((x) => `${x.qual}.${x.name}`)
  ok(rs.includes('"…".to_string') && rs.includes('r#"…"#.len'), `a literal receiver keeps its delimiters, so a call on it still reads as one (${rs.join(', ')})`)
}

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
  // a fitted drawing's scale, as drawn (the system map's measurements from the review of #58: 340×310)
  const r2 = (x) => Math.round(x * 100) / 100
  ok(r2(R.fitOf(1374, 874, 340, 310, true)) === 2.74, `fitOf at full size: the height limits it, not the width (${r2(R.fitOf(1374, 874, 340, 310, true))})`)
  ok(r2(R.fitOf(1358, 600, 340, 310, false)) === 3.92 && r2(R.fitOf(500, 600, 340, 310, false)) === 2.12, 'fitOf in the page: the box width less its padding, never under the 720 px floor')
  ok(r2(R.fitOf(1374, 874, 1100, 1500, true)) === 0.57, 'fitOf at full size for a tall map')
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
has(st, 'name guesses: 14% of 7 call links (unique-name + ambiguous + import-guess)', 'status: the share of call links that are name guesses, per repo')

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
  const helpers = ['esc', 'cut', 'cutL', 'plural', 'parseHash', 'pairConf', 'heatOf', 'heatBands', 'squarify', 'lanePick', 'mdSlug', 'mdFront', 'mdToHtml', 'archClient', 'docsClient', 'stageClient']
  ok(helpers.every((n) => script.includes(`function ${n}(`)), `the page carries every helper its client calls (${helpers.filter((n) => !script.includes(`function ${n}(`)).join(', ') || 'all'})`)

  // Run the page's own script against a small stub DOM: every view renders, anchors open what they
  // name, and the test-code toggle changes what a neighbourhood hides.
  const vm = await import('node:vm')
  const run = (hash) => {
    const listeners = {}, frames = []
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
    vm.runInNewContext(script, { document: doc, window: win, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: (f) => { frames.push(f) }, getComputedStyle: () => ({ getPropertyValue: () => '' }) })
    const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
    const find = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = find(k, pred); if (f) return f } return null }
    const go = (h) => { loc.hash = h; listeners.hashchange() }
    // frames run only when a test flushes them (the file map draws in one)
    const flush = () => { for (let i = 0; i < 5 && frames.length; i++) frames.splice(0).forEach((f) => f()) }
    return { text: () => (doc.body.kids || []).map(dump).join(' '), go, find: (pred) => (doc.body.kids || []).map((k) => find(k, pred)).find(Boolean), hash: () => loc.hash, flush, win: (t, e) => listeners[t] && listeners[t](e) }
  }
  const blob = /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(pageP)[1]
  try {
  const views = {}
  const pg = run('#overview')
  views.overview = /production files/.test(pg.text())
  pg.go('#map'); views.map = /data-mod="/.test(pg.text()) && /class="mlink"/.test(pg.text())
  {
    const within = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = within(k, pred); if (f) return f } return null }
    const stageOf = (w) => pg.find((n) => n.attrs && n.attrs['data-stage'] === w)
    const ctlsIn = (w, list) => !!stageOf(w) && list.every((c) => within(stageOf(w), (n) => n.attrs && n.attrs['data-ctl'] === c))
    const press = (c) => (pg.find((n) => n.attrs && n.attrs['data-ctl'] === c).on.click || []).forEach((f) => f({}))
    ok(ctlsIn('sys', ['sys-fit', 'sys-out', 'sys-100', 'sys-in', 'sys-full']), 'the system map: Fit, −, 100%, + and full size inside the map')
    press('sys-in')
    ok(/"width":"\d+"/.test(stageOf('sys').kids[0].kids[0].firstChild ? JSON.stringify(stageOf('sys').kids[0].kids[0].firstChild.attrs) : '') && /\bzoomed\b/.test(stageOf('sys').kids[0].kids[0].attrs.class), 'zooming the system map sizes its drawing and lets the box scroll')
    press('sys-fit')
    ok(!/\bzoomed\b/.test(stageOf('sys').kids[0].kids[0].attrs.class), 'Fit gives the map back its box width')
    press('sys-full')
    ok(/\bstage full\b/.test(stageOf('sys').attrs.class), 'full size for the system map')
    ok(/\.stage\.full \.archbox svg\{[^}]*flex:none/.test(pageP), 'at full size the architecture svg keeps its zoomed width (a flex item that does not shrink to the box)')
    pg.go('#overview'); pg.go('#map')
    ok(!/\bfull\b/.test(stageOf('sys').attrs.class), 'leaving the tab leaves full size')
    press('mode-files')
    ok(ctlsIn('files', ['files-fit', 'files-out', 'files-100', 'files-in', 'files-full']) && within(stageOf('files'), (n) => n.attrs && n.attrs.id === 'map'), 'the file map: its canvas and the zoom and full-size controls in one stage')
    press('files-full')
    ok(/\bstage full\b/.test(stageOf('files').attrs.class), 'full size for the file map')
    press('files-full')
    ok(!/\bfull\b/.test(stageOf('files').attrs.class), 'the same button leaves full size')

    // the file map: a drag never selects the page and follows the pointer past the canvas; the
    // keys pan and zoom its view. Observed through what it draws: each file is a disc (an arc).
    {
      const { stageKit } = await import('./stage-kit.mjs')
      const canvas = within(stageOf('files'), (n) => n.tagName === 'CANVAS')
      const k = stageKit(canvas, { width: 800, height: 600 })
      const arcs = []
      const ctx2d = new Proxy({}, { get: (t, p) => (p === 'arc' ? (x, y) => arcs.push([x, y]) : p === 'measureText' ? () => ({ width: 10 }) : p in t ? t[p] : () => {}), set: (t, p, v) => { t[p] = v; return true } })
      Object.assign(canvas, { isConnected: true, getContext: () => ctx2d })
      pg.flush()
      const [x0, y0] = arcs[arcs.length - 1] || [NaN, NaN]
      let seen = [x0, y0]
      const last = () => { arcs.length = 0; pg.flush(); if (arcs.length) seen = arcs[arcs.length - 1]; return seen } // where the last file is drawn now
      const near = (a, b) => Math.abs(a - b) < 1e-6 // screen positions, in floating point
      const pct = () => pg.find((n) => n.attrs && n.attrs['data-ctl'] === 'files-100').textContent
      ok(canvas.attrs.tabindex === '0' && canvas.attrs.role === 'region' && /^File map: drag or use the arrow keys to pan \(Shift: a page\), \+ and − to zoom, 0 to fit$/.test(canvas.attrs['aria-label']) && Number.isFinite(x0),
        'the file map is focusable, its label names the keys')
      const sel = () => { const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; pg.win('selectstart', e); return e.defaultPrevented }
      const down = k.fire('pointerdown', { clientX: 400, clientY: 300 })
      ok(down.defaultPrevented && k.classes.has('panning') && sel() && k.focused && k.focused.preventScroll === true, 'the file map: a press is cancelled (no selection), the canvas takes the no-select class and the focus')
      // the canvas is the only way to pan the map: a capture it did not lose itself never ends a pan
      k.fire('lostpointercapture', { target: { tagName: 'DIV' } })
      ok(k.classes.has('panning'), 'the file map: a capture lost by another element does not end its pan')
      k.fire('pointermove', { clientX: 410, clientY: 305 })
      const [x1, y1] = last()
      k.fire('pointermove', { clientX: -2000, clientY: -3000 })
      const [x2, y2] = last()
      ok(k.captured.join() === '1' && near(x1, x0 + 10) && near(y1, y0 + 5) && near(x2, x0 - 2400) && near(y2, y0 - 3300), 'the file map: past 3 px the pointer is captured, and the view follows it out of the canvas')
      k.fire('pointerup', {})
      const swallowed = k.fire('click', { clientX: x2, clientY: y2 })
      ok(!k.classes.has('panning') && !sel() && swallowed.stopped && pg.hash() === '#map', 'the file map: released, the pan ends, and its click opens nothing')
      const [x3] = last()
      k.key('ArrowLeft'); const [x4] = last()
      k.key('ArrowRight'); k.key('ArrowRight'); const [x5] = last()
      k.key('ArrowDown', { shiftKey: true }); const [, y6] = last()
      k.key('ArrowUp'); const [, y7] = last()
      ok(near(x3, x2) && near(x4, x3 + 60) && near(x5, x3 - 60) && near(y6, y2 - 540) && near(y7, y6 + 60), 'the file map: the arrows pan its view by 60 px, Shift by most of the visible size')
      const ignored = [k.key('ArrowLeft', { ctrlKey: true }), k.key('ArrowLeft', { metaKey: true }), k.key('ArrowLeft', { target: pg.find((n) => n.attrs && n.attrs['data-ctl'] === 'search') })]
      ok(ignored.every((e) => !e.defaultPrevented) && near(last()[0], x5), 'the file map: Ctrl or ⌘ + an arrow, and an arrow typed in the search box, leave it alone')
      const zs = []
      for (const key of ['+', '-', '-', '=']) { k.key(key); zs.push(pct()) }
      k.fire('wheel', { deltaY: -1, clientX: 400, clientY: 300 }); zs.push(pct())
      const fit = k.key('0')
      const [x8, y8] = last()
      ok(zs.join(' ') === '125% 100% 80% 100% 118%' && fit.defaultPrevented && pct() === '100%' && near(x8, x0) && near(y8, y0), `the file map: + − = zoom by the buttons' step about the centre, the wheel still zooms, 0 fits (${zs.join(' ')})`)
      ok(!k.key('Escape').defaultPrevented && !k.key('Enter').defaultPrevented, 'the file map leaves Escape and Enter to the page')
      // a finger pans the map too: the canvas has no native scrolling to fall back on
      const finger = k.fire('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 400, clientY: 300 })
      k.fire('pointermove', { pointerType: 'touch', pointerId: 7, clientX: 380, clientY: 300 })
      const [xt] = last()
      k.fire('pointerup', { pointerType: 'touch', pointerId: 7 })
      k.key('0'); last()
      ok(finger.defaultPrevented && near(xt, x0 - 20) && k.captured.includes(7) && /#map canvas\{[^}]*touch-action:none/.test(pageP), 'the file map: a touch drag pans it (touch-action none, the pointer captured)')
      const visible = DP.map.files.filter((id) => !DP.files.find((f) => f[0] === id)[4])
      k.fire('pointerdown', { clientX: x0, clientY: y0 }); k.fire('pointerup', {})
      k.fire('click', { clientX: x0, clientY: y0 })
      ok(pg.hash() === `#file-${visible[visible.length - 1]}`, `the file map: a click on a file (3 px or less) still opens it (${pg.hash()})`)
      pg.go('#map')
    }
    press('mode-modules')
  }
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

{ // the architecture CLI on the polyglot project: draft, refuse to overwrite, check; serve's --port
  const cli = (...args) => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), ...args, '--root', PROJ], { encoding: 'utf8' })
  const out = path.join(PROJ, 'docs/architecture/poly.architecture.json')
  const d1 = cli('architecture', 'draft', '--out', out, '--title', 'Poly')
  const drafted = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null
  ok(d1.status === 0 && d1.stdout.includes(out) && drafted && drafted.draft === true && drafted.title === 'Poly' && drafted.components.length > 0, `architecture draft writes a draft and prints its path (${d1.stderr.trim().slice(0, 200)})`)
  const d2 = cli('architecture', 'draft', '--out', out)
  ok(d2.status === 1 && /exists/.test(d2.stderr), 'architecture draft never overwrites without --force')
  const ck = cli('architecture', 'check')
  ok(ck.status === 0 && /poly\.architecture\.json: passes/.test(ck.stdout), `architecture check finds the project's diagrams and passes a fresh draft (${ck.stdout.trim().slice(0, 200)})`)
  writeFileSync(path.join(PROJ, 'docs/architecture/bad.architecture.json'), '{ nope')
  const bad = cli('architecture', 'check')
  ok(bad.status === 1 && /bad\.architecture\.json: does not parse/.test(bad.stdout) && !/does not parse: does not parse/.test(bad.stdout), 'a diagram that does not parse fails the check, said once')
  rmSync(path.join(PROJ, 'docs'), { recursive: true, force: true })
  const sv = cli('serve', '--port', 'abc')
  ok(sv.status === 1 && /--port takes a number/.test(sv.stderr), 'serve refuses a port that is not a number')
}

// ── 2b · no literal's value in the index ──
console.log('\n2b · no literal value in the index')
{ // One-line functions holding SQL and keys: no answer, no page and no byte of the index holds them.
  const H = path.join(SANDBOX, 'hush')
  const put = (rel, s) => { mkdirSync(path.dirname(path.join(H, rel)), { recursive: true }); writeFileSync(path.join(H, rel), s) }
  put('grimoire.config.json', '{ "graph": {} }\n')
  put('web/token.ts', "export function token(role: string = 'canary-ts-1'): Promise<string> { return db.query(`ALTER ROLE app PASSWORD 'canary-ts-2'`).then((r) => r.text()) }\n")
  put('svc/token.py', 'def token(scope="canary-py-1"): return db.execute("SELECT * FROM users WHERE api_key = \'canary-py-2\'").fetchone()  # canary-py-3\n')
  put('shop/token.go', 'package shop\n\nfunc Token() string { return db.QueryRow(`SELECT id FROM keys WHERE secret = \'canary-go-1\'`).Scan() } // canary-go-2\n')
  put('core/token.rs', 'pub fn token() -> String { "canary-rs-1".to_string() + &format!("{}", r#"canary-rs-2"#) } // canary-rs-3\n')
  const hq = (tool, args = {}) => call(`graph_${tool}`, args, { root: H })
  const answers = [await hq('index'), await hq('search', { query: 'token' }), await hq('search', { query: 'Token' }), await hq('symbol', { symbol: 'token' }), await hq('symbol', { symbol: 'Token' }),
    ...await Promise.all(['web/token.ts', 'svc/token.py', 'shop/token.go', 'core/token.rs'].map((p) => hq('file', { path: p }))),
    await hq('callees', { symbol: 'token' }), await hq('sql', { sql: 'SELECT * FROM nodes' }), await hq('sql', { sql: 'SELECT * FROM refs' }), await hq('sql', { sql: 'SELECT * FROM imports' })]
  const { renderGraph } = await import('../lib/render.mjs')
  answers.push(await renderGraph({ dbPath: path.join(H, '.grimoire/graph/graph.db') }))
  const leaked = answers.flatMap((a) => a.match(/canary-[a-z]+-\d/g) || [])
  ok(!leaked.length, `no graph_* answer and no page shows a literal's value (${leaked.length ? [...new Set(leaked)].join(', ') : 'none'})`)
  const dir = path.join(H, '.grimoire/graph')
  const bytes = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name).flatMap((f) => (readFileSync(path.join(dir, f), 'latin1').match(/canary-[a-z]+-\d/g) || []).map((m) => `${f}: ${m}`))
  ok(!bytes.length, `no byte of the index holds a literal's value (${bytes.length ? [...new Set(bytes)].join(', ') : readdirSync(dir).join(', ')})`)
  const found = answers[1] + answers[2]
  const sigs = ["function token(role: string = '…'): Promise<string>", 'def token(scope="…")', 'func Token() string', 'pub fn token() -> String']
  ok(sigs.every((s) => found.includes(s)), `a signature still names the function, its parameters and its return type (${sigs.filter((s) => !found.includes(s)).join(' · ') || 'all four'})`)
  // An index from an older version, its pages full of literals: rebuilt, not one of them left in a byte.
  const { openStore } = await import('../lib/store.mjs')
  const old = await openStore(path.join(dir, 'graph.db'))
  const add = old.prepare("INSERT INTO nodes(kind, name, signature) VALUES('function', 'old', ?)")
  for (let i = 0; i < 3000; i++) add.run(`function old() { return 'canary-old-${i}' }`)
  old.prepare("UPDATE meta SET value = '2' WHERE key = 'schema'").run(); old.close()
  await hq('search', { query: 'token' })
  const kept = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()).flatMap((f) => (readFileSync(path.join(dir, f.name), 'latin1').match(/canary-old-\d+/g) || []).map(() => f.name))
  ok(!kept.length, `an older index is deleted, not emptied: no byte of the one it holds stays (${kept.length ? `${kept.length} in ${[...new Set(kept)].join(', ')}` : 'none'})`)
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
  const { openStore, SCHEMA_VERSION } = await import('../lib/store.mjs')
  const old = await openStore(path.join(PROJ, '.grimoire/graph/graph.db'))
  old.prepare("UPDATE meta SET value = '2' WHERE key = 'schema'").run(); old.close()
  await q('search', { query: 'Circle' })
  has(await q('sql', { sql: "SELECT value FROM meta WHERE key = 'schema'" }), `value\n${SCHEMA_VERSION}`, 'a query on an older schema rebuilds the index first')
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
git(MAIN, 'init', '-q', '-b', 'main'); git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
const refresh = (root) => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'graph.mjs'), 'refresh', '--root', root], { encoding: 'utf8' })
writeFileSync(path.join(MAIN, 'src/a.ts'), 'export function base(): number {\n  return 2\n}\n'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qam', 'two')
writeFileSync(path.join(MAIN, 'src/c.ts'), 'export const c = 1\n'); git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'three')
mkdirSync(path.join(MAIN, 'gen'))
for (let i = 0; i < 26; i++) writeFileSync(path.join(MAIN, `gen/g${i}.ts`), `export const g${i} = ${i}\n`)
git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'a sweep of 26 files')
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
    git(path.join(DR, r), 'init', '-q', '-b', 'main'); git(path.join(DR, r), 'add', '-A'); git(path.join(DR, r), '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'one')
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
{ // the base a worktree's index starts from, and re-basing onto it once the base moves
  const { baseOf } = await import('../lib/freshness.mjs')
  const { loadProject } = await import('../lib/project.mjs')
  const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }
  const DEV = path.join(SANDBOX, 'dev'), STACK = path.join(SANDBOX, 'stack')
  git(MAIN, 'worktree', 'add', '-q', '-b', 'dev', DEV)
  writeFileSync(path.join(DEV, 'src/d.ts'), 'export function onDev(): number {\n  return 4\n}\n'); commit(DEV, 'dev work')
  ok(baseOf(loadProject(DEV))?.branch === 'main', 'a branch off main is based on the checkout holding main')
  refresh(DEV)
  git(MAIN, 'worktree', 'add', '-q', '-b', 'stack', STACK, 'dev'); git(STACK, 'branch', '-q', '--set-upstream-to=dev')
  const sb = baseOf(loadProject(STACK))
  ok(sb?.branch === 'dev' && sb.root === DEV, `a branch whose upstream is dev is based on the dev checkout, not main (${JSON.stringify(sb)})`)
  has(await call('graph_search', { query: 'onDev' }, { root: STACK }), 'src/d.ts', "the stacked worktree is seeded from dev's index")
  writeFileSync(path.join(STACK, 'grimoire.config.json'), '{ "graph": {}, "baseBranch": "origin/main" }\n')
  ok(baseOf(loadProject(STACK))?.branch === 'main', 'baseBranch in the config comes first (origin/main → the main checkout)')
  rmSync(path.join(STACK, 'grimoire.config.json'))
  // main moves: 30 files merged into main and indexed there, then a feature worktree picks them up
  // (a project of its own, so the main checkout above keeps the files later checks count)
  const RM = path.join(SANDBOX, 'rb-main'), RW = path.join(SANDBOX, 'rb-feat')
  mkdirSync(path.join(RM, 'src'), { recursive: true })
  writeFileSync(path.join(RM, 'grimoire.config.json'), '{ "graph": {} }\n'); writeFileSync(path.join(RM, '.gitignore'), '.grimoire/\n')
  writeFileSync(path.join(RM, 'src/a.ts'), 'export function base(): number {\n  return 1\n}\n')
  git(RM, 'init', '-q', '-b', 'main'); commit(RM, 'init'); refresh(RM)
  git(RM, 'worktree', 'add', '-q', '-b', 'feat', RW)
  writeFileSync(path.join(RW, 'src/b.ts'), "import { base } from './a'\n\nexport function onBranch(): number {\n  return base()\n}\n")
  const first = refresh(RW)
  ok(/rb-main: 2 files, 1 parsed/.test(first.stderr), `a seeded worktree keeps the main checkout's repo name and parses only its own file (${first.stderr.trim().replace(/\n/g, ' | ')})`)
  mkdirSync(path.join(RM, 'merged'))
  for (let i = 0; i < 30; i++) writeFileSync(path.join(RM, `merged/m${i}.ts`), `export function merged${i}(): number {\n  return ${i}\n}\n`)
  commit(RM, 'a feature merged into main'); refresh(RM)
  git(RW, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'merge', '-q', '--no-edit', 'main')
  const rb = refresh(RW)
  ok(/re-based on main/.test(rb.stderr), `once main has the work, the worktree re-bases onto main's index instead of parsing it (${rb.stderr.trim().replace(/\n/g, ' | ')})`)
  has(await call('graph_search', { query: 'merged29' }, { root: RW }), 'merged/m29.ts', 'the re-based index has what main merged')
  has(await call('graph_callers', { symbol: 'base' }, { root: RW }), 'onBranch  function  src/b.ts:3', "and still the worktree's own uncommitted work")
  has(await call('graph_status', {}, { root: RW }), 'based on main', 'graph_status names the base')
  const again = refresh(RW)
  ok(!/re-based/.test(again.stderr), 'HEAD unchanged since: no re-base, the index stays incremental')
  writeFileSync(path.join(DEV, 'src/e.ts'), 'export const e = 5\n'); commit(DEV, 'one more')
  ok(!/re-based/.test(refresh(DEV).stderr), 'a small move is not worth a copy: the index stays incremental')
}
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
  git(MAIN, 'add', '-A'); git(MAIN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'four')
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

// ── 6 · beyond the edges: impact, diff, overview, search ──
console.log('\n6 · beyond the edges (fixtures/edge): dispatch, unlinked calls, mentions, the diff, the overview')
{
  const E = path.join(SANDBOX, 'edge')
  cpSync(path.join(HERE, 'fixtures', 'edge'), E, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
  // a string holding the name and a secret: a mention names its line and kind, never its text
  writeFileSync(path.join(E, 'src/jobs/secret.ts'), "export const boot = { createSession: 'canary-edge-1' }\nexport const note = 'createSession canary-edge-2'\n")
  const commit = (m) => { git(E, 'add', '-A'); git(E, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }
  git(E, 'init', '-q', '-b', 'main'); commit('init')
  const eq = (tool, args = {}) => call(`graph_${tool}`, args, { root: E })
  await eq('index')
  const answers = []
  const imp = (target, extra = {}) => eq('impact', { target, ...extra }).then((a) => { answers.push(a); return a })

  const cs = await imp('createSession')
  has(cs, 'login:3  d1 [import]', 'impact: a linked caller is listed as before')
  has(cs, 'testCreate  function test  test/session.test.ts:3', 'impact: the test on the path')
  has(cs, 'register:3  d1 [import] by reference', 'impact: a function passed as a value (a callback) is linked by reference')
  lacks(cs, 'src/api/routes.ts  :4', '… and so no longer a mention the edges miss')
  // a function passed as a route's handler (a callback): listed with its route (routes.test.mjs), its line explained by it
  has(cs, 'POST {…}/login  (http, node)  declared src/api/routes.ts:4', 'impact: a function passed as a value to a router is listed with the route it handles')
  has(cs, 'src/jobs/runner.ts  :5 string in run', 'impact: a string key naming it is a mention')
  has(cs, 'config/jobs.yaml  :3 config', 'impact: config naming it is a mention')
  has(cs, 'docs/auth.md  :3 docs', 'impact: docs naming it are a mention')
  has(cs, 'src/jobs/secret.ts  :1 key', 'impact: an object key named like it is a mention (a dispatch table)')
  lacks(cs, 'src/api/login.ts  :', 'impact: a line an edge explains is not repeated as a mention')
  lacks(cs, 'test/session.test.ts  :', 'impact: an import or a linked call is not a mention')
  const quiet = await imp('createSession', { mentions: false })
  lacks(quiet, 'Mentions', 'impact: mentions: false leaves the text search out')

  const rf = await imp('Session.refresh')
  has(rf, 'src/api/admin.ts:2  in rotate  s.refresh', 'impact: a call on a receiver of unknown type is a possible caller, not dropped')
  lacks(rf, 'src/misc/caches.ts', 'impact: another class\'s same-named method is not a mention (its own definition)')

  const ml = await imp('MemoryStore.load')
  has(ml, 'handle:3  d1 [typed]', 'impact: a caller through the interface the method implements (dispatch)')
  has(ml, 'Store.load  method  src/auth/session.ts:2  (interface Store)', 'impact: the interface declaration it may be called through')
  has(ml, 'CachedStore.load  method  src/auth/store.ts:10  (class CachedStore)', 'impact: the override in a subclass')
  const sl = await imp('Store.load')
  has(sl, 'Implementations of Store.load', 'impact: an interface method lists its implementations')
  has(sl, 'MemoryStore.load  method  src/auth/store.ts:4', 'impact: … each of them')

  // the diff: a new signature, a removed function still called, a moved one, a body change, an added file
  writeFileSync(path.join(E, 'src/api/legacy.ts'), 'export function legacy() {\n  return newId()\n}\n')
  commit('legacy')
  const edit = (rel, a, b) => { const f = path.join(E, rel); const t = readFileSync(f, 'utf8'); ok(t.includes(a), `fixture edit applies to ${rel}`); writeFileSync(f, t.replace(a, b)) }
  edit('src/auth/session.ts', 'refresh(ttl: number): Session {', 'refresh(ttl: number, force: boolean): Session {')
  edit('src/auth/session.ts', 'function newId(): string {\n  return Math.random().toString(36)\n}\n', '')
  edit('src/auth/session.ts', 'new Session(newId(), user)', 'new Session(makeId(), user)')
  edit('src/auth/store.ts', '    return null\n  }\n}\n\nexport class Cached', '    return id ? null : null\n  }\n}\n\nexport class Cached')
  writeFileSync(path.join(E, 'src/auth/ids.ts'), 'export function makeId(): string {\n  return Date.now().toString(36)\n}\n')
  rmSync(path.join(E, 'src/misc/caches.ts')); writeFileSync(path.join(E, 'src/misc/pools.ts'), 'export class Cache { refresh(): void {} }\nexport class Token { refresh(): void {} }\nexport class Feed { refresh(): void {} }\nexport class Pool { refresh(): void {} }\n')
  const d = await eq('diff', { base: 'HEAD' }); answers.push(d)
  has(d, 'Changes against HEAD', 'diff: against the base given')
  has(d, '~ Session.refresh  method  src/auth/session.ts:7  signature changed', 'diff: a changed signature')
  has(d, 'was: refresh(ttl: number): Session', 'diff: … with the signature it had')
  has(d, 'now: refresh(ttl: number, force: boolean): Session', 'diff: … and the one it has')
  has(d, '- newId  function  (was src/auth/session.ts:16)', 'diff: a removed definition, read from the base')
  has(d, 'call    src/api/legacy.ts:2  in legacy  newId', 'diff: a removed function still called outside the diff (the break a diff hides)')
  has(d, 'call    src/api/admin.ts:2  in rotate  s.refresh', 'diff: an unlinked call site of a changed signature')
  has(d, '~ createSession  function  src/auth/session.ts:12  body', 'diff: a body change')
  has(d, '+ makeId  function  src/auth/ids.ts:1', 'diff: an untracked file\'s definitions are added')
  has(d, '> Cache  class  moved: src/misc/caches.ts:1 → src/misc/pools.ts:1', 'diff: a definition removed here and added there is moved')
  has(d, 'src/api/login.ts  (distance 1)', 'diff: a caller outside the diff is in the impact')
  has(d, 'dispatch: MemoryStore.load is declared on interface Store', 'diff: dispatch through the interface')
  has(d, 'override not changed here: CachedStore.load', 'diff: an override the diff leaves alone')
  has(d, 'test/session.test.ts  (distance 1)', 'diff: the tests to run')
  has(d, 'Changed code no test reaches', 'diff: the changed code no test reaches')
  has(d, 'Risk: high', 'diff: a removed function still called is high risk')
  has(d, 'removed newId is still named outside the lines this diff changed', 'diff: … with the reason')
  const all = await eq('diff', { base: 'HEAD~1' }); answers.push(all)
  has(all, 'call    src/api/legacy.ts:2  in legacy  newId  (changed in this diff)', 'diff: against an older base, a caller the diff adds is marked changed by it')
  commit('all'); has(await eq('diff', { base: 'HEAD' }), 'none (the working tree matches it)', 'diff: nothing to say on a clean tree')

  // co-change: a file that changed with session.ts in every commit is missed by a diff leaving it out
  for (let i = 0; i < 3; i++) { writeFileSync(path.join(E, 'src/auth/session.ts'), readFileSync(path.join(E, 'src/auth/session.ts'), 'utf8') + `// ${i}\n`); writeFileSync(path.join(E, 'docs/auth.md'), readFileSync(path.join(E, 'docs/auth.md'), 'utf8') + `${i}\n`); writeFileSync(path.join(E, 'src/auth/store.ts'), readFileSync(path.join(E, 'src/auth/store.ts'), 'utf8') + `// ${i}\n`); commit(`pair ${i}`) }
  await eq('index')
  edit('src/auth/session.ts', 'return new Session(this.id, this.user)', 'return new Session(this.id, this.user + "")')
  const gap = await eq('diff', { base: 'HEAD' }); answers.push(gap)
  has(gap, 'src/auth/store.ts  with src/auth/session.ts: 5/5', 'diff: a file that usually changes with a changed one, missing from the diff')

  // a renamed file: the imports that still name its old path no longer resolve
  git(E, 'checkout', '-q', '--', '.'); git(E, 'mv', 'src/auth/session.ts', 'src/auth/sessions.ts')
  const mv = await eq('diff', { base: 'HEAD' }); answers.push(mv)
  has(mv, 'renamed src/auth/session.ts → src/auth/sessions.ts: 5 unresolved import(s) still name it (5 outside this diff)', 'diff: a renamed file still imported by its old path')
  has(mv, 'import  src/api/handler.ts:1', 'diff: … each import, at its line')
  has(mv, 'is still imported outside this diff', 'diff: … and the risk says so')
  git(E, 'mv', 'src/auth/sessions.ts', 'src/auth/session.ts')

  const ov = await eq('overview'); answers.push(ov)
  has(ov, 'Modules (', 'overview: the modules')
  has(ov, 'tests reach', 'overview: test reach per module')
  has(ov, 'Entry points', 'overview: entry points')
  has(ov, 'Most used', 'overview: most used definitions')
  const sw = await eq('search', { query: 'session create' }); answers.push(sw)
  ok(sw.split('\n')[0].includes('createSession'), `search: several words, every one in the name or path, best first (${sw.split('\n')[0]})`)
  has(await eq('search', { query: 'nothing here' }), 'Nothing holds all of', 'search: several words, none found')

  const leaked = answers.flatMap((a) => a.match(/canary-edge-\d/g) || [])
  ok(!leaked.length, `no impact, diff or overview answer quotes a literal (${leaked.length ? [...new Set(leaked)].join(', ') : 'none'})`)
}

// ── 6b · the review's cases: each one a use the first version missed, a crash or a leak ──
console.log('\n6b · beyond the edges: the review\'s cases')
{
  const R = path.join(SANDBOX, 'rev')
  const put = (rel, txt) => { mkdirSync(path.dirname(path.join(R, rel)), { recursive: true }); writeFileSync(path.join(R, rel), txt) }
  put('grimoire.config.json', JSON.stringify({ repos: [{ name: 'a', path: 'a' }, { name: 'b', path: 'b' }], graph: {} }) + '\n')
  // CommonJS: functions defined by assignment (exports.x, obj.x, X.prototype.y)
  put('a/lib/utils.js', "exports.normalizeType = function (type) {\n  return type\n}\nexports.normalizeTypes = function (types) {\n  return types.map(exports.normalizeType)\n}\n")
  put('a/lib/response.js', "const { normalizeType } = require('./utils')\nconst res = {}\nres.sendStatus = function sendStatus(code) {\n  return normalizeType(code)\n}\nres.json = function (x) {\n  return this.sendStatus(200)\n}\nmodule.exports = res\n")
  put('a/lib/app.js', "function View(name) { this.name = name }\nView.prototype.render = function () {\n  return 1\n}\nconst app = { set() {} }\napp.set('view', View)\nnew View('x')\n")
  // a typed call to another `get` beside an untyped one; a method bound to a local of its name
  put('a/src/store.ts', "export class Store {\n  get(k: string) { return k }\n  load(k: string) { return k }\n}\nexport class Cache {\n  get(k: string) { return k }\n}\nexport class Q1 { get() {} }\nexport class Q2 { get() {} }\nexport class Q3 { get() {} }\n")
  put('a/src/use.ts', "import { Cache, Store } from './store'\nimport * as ns from './fns'\nexport function viaAny(y: any) {\n  const c = new Cache()\n  c.get('a')\n  y.get('b')\n}\nexport function bind(store: Store) {\n  const load = store.load\n  return load\n}\nexport function each(xs: string[]) {\n  return xs.map(ns.slugify)\n}\n")
  put('a/src/fns.ts', "export function slugify(s: string) { return s }\n")
  // JSX text is a literal: never in an answer
  put('a/src/view.tsx', "export function View2() {\n  return (<b>canary-rev-1</b>).refreshToken()\n}\nexport function withJsx(a = <i>canary-rev-2</i>) { return a }\n")
  // Python: a keyword argument naming a method; Ruby: a method passed as a symbol
  put('a/py/app.py', "class Flask:\n    def url_for(self, e):\n        return e\n\n    def setup(self, env):\n        env.update(url_for=self.url_for)\n")
  put('a/rb/user.rb', "class User\n  def valid?\n    true\n  end\nend\n\ndef check(us)\n  us.select(&:valid?)\nend\n")
  // credential files and a huge one-line data file naming a target: never searched / not quadratic
  put('a/secrets.env', 'slugify=canary-rev-3\n'); put('a/.git-credentials', 'slugify canary-rev-4\n')
  put('a/data.json', '[' + Array(20000).fill('"slugify"').join(',') + ']\n')
  // another repository calling into a
  put('b/src/client.ts', "export function go(api: any) {\n  return api.fetchUser('1')\n}\nexport function slugOf(s: string) {\n  return makeSlug(s)\n}\n")
  put('a/src/api.ts', "export class Api {\n  fetchUser(id: string) { return id }\n}\nexport function makeSlug(s: string) { return s }\n")
  const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }
  for (const r of ['a', 'b']) { git(path.join(R, r), 'init', '-q', '-b', 'main'); commit(path.join(R, r), 'init') }
  const rq = (tool, args = {}) => call(`graph_${tool}`, args, { root: R })
  await rq('index')
  const answers = []
  const rimp = async (target, extra = {}) => { const a = await rq('impact', { target, ...extra }); answers.push(a); return a }

  const nt = await rimp('normalizeType')
  has(nt, 'normalizeType  function  a/lib/utils.js:1', 'review: `exports.x = function` is a definition')
  has(nt, 'a/lib/response.js  (distance 1)', 'review: … and its caller is linked')
  ok(/a\/lib\/utils\.js  .*:5 reference in normalizeTypes/.test(nt), 'review: `exports.x` passed as a value is a use of the module\'s own export')
  const ss = await rimp('sendStatus')
  has(ss, 'res.sendStatus  method  a/lib/response.js:3', 'review: `obj.x = function` is a method of obj')
  has(await rimp('View.render'), 'View.render  method  a/lib/app.js:2', 'review: `X.prototype.y = function` is a method of X')
  const vw = await rimp('View', { repo: 'a' })
  has(vw, 'top level:6  d1 [same-file] by reference', 'review: a file-level value use (`app.set(\'view\', View)`) is linked by reference, whatever else the top level calls')
  const nf = await rimp('compileETag')
  has(nf, 'No symbol or file matches', 'review: a name the index does not hold is said so')
  has(nf, 'Its name as text', 'review: … and its mentions are still searched')
  const gt = await rimp('Store.get')
  has(gt, 'a/src/use.ts:6  in viaAny  y.get', 'review: an untyped call beside a typed call to another same-named method is still a possible caller')
  const ld = await rimp('Store.load')
  has(ld, 'bind:8  d1 [typed] by reference', 'review: `const load = store.load` on a typed receiver is a reference to the method')
  const sl = await rimp('slugify')
  has(sl, 'each:12  d1 [import] by reference', 'review: `ns.slugify` qualified by an imported namespace is a reference, not a property')
  lacks(sl, 'secrets.env', 'review: a credential file is never searched')
  lacks(sl, '.git-credentials', 'review: … nor .git-credentials')
  has(sl, 'a/data.json  :1 config', 'review: a huge one-line data file is listed by its file, its line not read')
  const uf = await rimp('Flask.url_for')
  has(uf, 'Flask.setup:5  d1 [same-class] by reference', 'review: a keyword argument passing a method (`url_for=self.url_for`) is a reference, not a local binding')
  const rb = await rimp('User.valid?')
  has(rb, 'a/rb/user.rb  :8 reference in check', 'review: a Ruby symbol naming a method (`&:valid?`) is a use')
  const fu = await rimp('Api.fetchUser')
  has(fu, 'b/src/client.ts:2  in go  api.fetchUser', 'review: a call from another repository is a possible caller')
  const ms = await rimp('makeSlug')
  has(ms, 'b/src/client.ts:5  in slugOf  makeSlug', 'review: … for a function too')
  answers.push(await rq('search', { query: 'refreshToken' }), await rq('symbol', { symbol: 'withJsx' }))

  // the diff's parsing: a path with a space, a removed SQL comment line, a binary, a double move,
  // a nested function, a rename into a skipped folder, overloads
  put('a/src/my dir/b é.ts', "export function gamma(y: string) { return y }\n")
  put('a/db/schema.sql', '-- create users\nCREATE TABLE users (id INTEGER);\n')
  writeFileSync(path.join(R, 'a/img.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
  put('a/src/s1.ts', 'export function shared() { return 1 }\n'); put('a/src/s2.ts', 'export function shared() { return 2 }\n')
  put('a/src/outer.ts', "export function outer() {\n  function inner() {\n    return 1\n  }\n  return inner()\n}\n"); put('a/src/useouter.ts', "import { outer } from './outer'\nexport function u() { return outer() }\n")
  put('a/src/lib1.ts', 'export function lib1() { return 1 }\n'); put('a/src/k.ts', "import { lib1 } from './lib1'\nexport function k() { return lib1() }\n")
  put('a/py/m.py', 'def f(a):\n    return a\n\n\ndef f(a, b):\n    return b\n')
  commit(path.join(R, 'a'), 'more'); await rq('index')
  put('a/src/my dir/b é.ts', "export function gamma(y: string, z = 1) { return y }\n")
  git(path.join(R, 'a'), 'rm', '-q', 'db/schema.sql')
  writeFileSync(path.join(R, 'a/img.bin'), Buffer.from([0, 9, 9, 9, 0, 255]))
  rmSync(path.join(R, 'a/src/s1.ts')); rmSync(path.join(R, 'a/src/s2.ts')); put('a/src/s3.ts', 'export function shared(x: number) { return x }\n')
  put('a/src/outer.ts', "export function outer() {\n  function inner() {\n    return 2\n  }\n  return inner()\n}\n")
  mkdirSync(path.join(R, 'a/third_party'), { recursive: true }); git(path.join(R, 'a'), 'mv', 'src/lib1.ts', 'third_party/lib1.ts')
  put('a/py/m.py', 'def f():\n    return 0\n\n\ndef f(a):\n    return a\n\n\ndef f(a, b):\n    return b\n')
  const d = await rq('diff', { base: 'HEAD', repo: 'a' }); answers.push(d)
  has(d, '~ gamma  function  a/src/my dir/b é.ts:1  signature changed', 'review: a path with a space and a non-ASCII letter is code, compared')
  has(d, 'a/db/schema.sql (removed script)', 'review: a removed SQL file is named by its path, its `-- ` lines never read as a header')
  has(d, 'a/img.bin', 'review: a binary change is listed')
  ok((d.match(/> shared  function  moved/g) || []).length === 1, `review: two removals and one addition of a name make one move (${(d.match(/> shared  function  moved/g) || []).length})`)
  has(d, '- shared  function', 'review: … and the other removal stays a removal')
  has(d, 'outer  function  a/src/outer.ts:1  (through outer.inner)', 'review: a change in a nested function is the outer one\'s, untested')
  has(d, '- lib1  function  (was a/src/lib1.ts:1)', 'review: a file renamed into a skipped folder is a removal')
  has(d, 'import  a/src/k.ts:1', 'review: … and its importer is a break')
  has(d, '+ f  function  a/py/m.py:1', 'review: an overload added above the others is one addition')
  lacks(d, '~ f  function', 'review: … the overloads it pushed down are not changed')

  const leaked = answers.flatMap((a) => a.match(/canary-rev-\d/g) || [])
  ok(!leaked.length, `review: no answer quotes JSX text or a credential file (${leaked.length ? [...new Set(leaked)].join(', ') : 'none'})`)
  const dir = path.join(R, '.grimoire/graph')
  const bytes = readdirSync(dir).filter((f) => f.startsWith('graph.db')).flatMap((f) => (readFileSync(path.join(dir, f), 'latin1').match(/canary-rev-[12]/g) || []))
  ok(!bytes.length, `review: JSX text is not kept in the index (${bytes.length})`)
}

// ── 6c · injected collaborators: a field's type from its declaration or its constructor ──
console.log('\n6c · dependency injection: calls on a field typed by its declaration or its constructor')
{
  const DI = path.join(SANDBOX, 'di')
  const put = (rel, txt) => { mkdirSync(path.dirname(path.join(DI, rel)), { recursive: true }); writeFileSync(path.join(DI, rel), txt) }
  put('grimoire.config.json', '{ "graph": {} }\n')
  // a NestJS-shaped controller and service: the controller's findAll delegates to the service's
  put('src/article.service.ts', "export class ArticleService {\n  findAll() { return [] }\n}\n")
  put('src/article.controller.ts', "import { ArticleService } from './article.service'\nimport { Repo } from './repo'\nexport class ArticleController {\n  private repo: Repo\n  constructor(private readonly articleService: ArticleService) {}\n  findAll() {\n    return this.articleService.findAll()\n  }\n  save() {\n    return this.repo.save()\n  }\n}\n")
  put('src/repo.ts', "export class Repo {\n  save() { return 1 }\n}\n")
  // Spring: a field-injected repository, read with and without `this`
  put('java/OwnerController.java', "class OwnerController {\n  @Autowired private OwnerRepository owners;\n  private final VetRepository vets;\n  OwnerController(VetRepository v) { this.vets = v; }\n  void list() { owners.findAll(); this.vets.findAll(); }\n}\n")
  put('java/OwnerRepository.java', "interface OwnerRepository {\n  void findAll();\n}\n")
  put('java/VetRepository.java', "class VetRepository {\n  void findAll() {}\n}\n")
  // Python: a field set from a typed constructor parameter; a bare call in a method is a module function
  put('py/svc.py', "from py.repo import Repo, get_domain\n\nclass Service:\n    def __init__(self, repo: Repo):\n        self.repo = repo\n\n    def save(self):\n        return self.repo.save()\n\n    def get_domain(self):\n        return get_domain()\n")
  put('py/repo.py', "class Repo:\n    def save(self):\n        return 1\n\ndef get_domain():\n    return 'x'\n")
  const dq = (tool, args = {}) => call(`graph_${tool}`, args, { root: DI })
  await dq('index')
  const c1 = await dq('callers', { symbol: 'ArticleService.findAll' })
  has(c1, 'ArticleController.findAll  method  src/article.controller.ts:6  [typed]', 'TypeScript: a constructor parameter property types the field; the call reaches the injected service')
  const loops = await dq('sql', { sql: "SELECT count(*) AS n FROM edges WHERE kind = 'CALLS' AND src = dst" })
  ok(/\n0\b/.test(loops), `no call on a field links a method to itself (self-loops: ${loops.split('\n').pop()})`)
  has(await dq('callers', { symbol: 'Repo.save', repo: undefined }), 'ArticleController.save  method  src/article.controller.ts:9  [typed]', 'TypeScript: a typed field declaration types `this.repo`')
  const c2 = await dq('callers', { symbol: 'OwnerRepository.findAll' })
  has(c2, 'OwnerController.list', 'Java: an annotated field types a bare `owners.findAll()`')
  has(await dq('callers', { symbol: 'VetRepository.findAll' }), 'OwnerController.list', 'Java: a field the constructor sets from a typed parameter types `this.vets`')
  has(await dq('callers', { symbol: 'Repo.save', depth: 1 }), 'Service.save  method  py/svc.py:7  [typed]', 'Python: `self.repo = repo` from a typed parameter types `self.repo`')
  const gd = await dq('callers', { symbol: 'get_domain' })
  has(gd, 'Service.get_domain  method  py/svc.py:10  [import]', 'Python: a bare call in a method is the imported module function')
  lacks(gd, '[same-class]', '… never the method itself (no self-recursion)')
}

// ── 6d · what a framework declares, and functions passed as values ──
console.log('\n6d · framework members (scopes, associations, annotated fields) and functions passed as values (REFERENCES)')
{
  const FR = path.join(SANDBOX, 'frame')
  cpSync(path.join(HERE, 'fixtures', 'frame'), FR, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
  const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }
  for (const r of ['rails', 'py', 'gin', 'web']) { git(path.join(FR, r), 'init', '-q', '-b', 'main'); commit(path.join(FR, r), 'init') }
  const fq = (tool, args = {}) => call(`graph_${tool}`, args, { root: FR })
  await fq('index')
  const answers = []
  const ask = async (tool, args) => { const a = await fq(tool, args); answers.push(a); return a }

  // Rails: scopes, associations, delegate, accessors and define_method are methods of their class
  const sa = await ask('symbol', { symbol: 'Story.active' })
  has(sa, 'Story.active  method  rails/app/models/story.rb:4', 'Ruby: `scope :active, -> {…}` is a method of its class')
  has(sa, '  scope :active\n', '… its signature ends before the lambda')
  const ca = await ask('callers', { symbol: 'Story.active' })
  has(ca, 'HomeController.active  method  rails/app/controllers/home_controller.rb:2  [qualified]', 'Ruby: `Story.active` resolves to the scope, qualified')
  has(ca, 'Story.recent  method  rails/app/models/story.rb:5  [same-class]', 'Ruby: a bare receiver in a scope\'s lambda (`active.order`) is a call on self')
  lacks(ca, 'HatsController', 'Ruby: `Hat.active` is not a caller of another class\'s scope')
  has(await ask('callers', { symbol: 'HomeController.active' }), 'none found', 'Ruby: `Story.active` no longer resolves to a controller\'s action of that name')
  const hw = await ask('sql', { sql: "SELECT count(*) AS n FROM edges e JOIN nodes s ON s.id = e.src WHERE s.qualname = 'HatsController.index' AND e.kind = 'CALLS'" })
  ok(/\n0\b/.test(hw), `Ruby: a call qualified by a repository type that declares no such member (\`Hat.active\`, \`Hat.where\`) links to nothing (${hw.split('\n').pop()})`)
  const ia = await ask('impact', { target: 'Story.active' })
  has(ia, 'StoryTest.test_hottest  method test  rails/test/models/story_test.rb:2  d2', 'Ruby: the test reaching a scope through a class method')
  has(ia, 'rails/app/controllers/hats_controller.rb:3  in HatsController.index  Hat.active', '… and `Hat.active` stays a possible caller, never a link')
  has(await ask('callers', { symbol: 'Story.user' }), 'HomeController.show  method  rails/app/controllers/home_controller.rb:6  [typed]', 'Ruby: `belongs_to :user` is the accessor `story.user` reaches (typed by `Story.find`)')
  has(await ask('callers', { symbol: 'Story.user_email' }), 'HomeController.show', 'Ruby: `delegate :email, to: :user, prefix: true` defines `user_email`')
  const rs = await ask('search', { query: 'title_slug' })
  has(rs, 'Story.title_slug  method  rails/app/models/story.rb:9', 'Ruby: `define_method(:title_slug)` with a literal symbol is a definition')
  has(await ask('symbol', { symbol: 'User.token' }), 'attr_reader :token', 'Ruby: `attr_reader :token` is a method')
  has(await ask('symbol', { symbol: 'Story.username' }), 'delegate :username, to: :user', 'Ruby: `delegate :username, to: :user` is a method')
  const nt = await ask('callers', { symbol: 'Story.normalize_title' })
  has(nt, 'Passed or stored as a value by', 'Ruby: a callback named by a symbol (`before_save :normalize_title`) is a reference')
  has(nt, 'Story  class  rails/app/models/story.rb:1  [same-class]', '… from the class body declaring it')
  has(await ask('status', {}), 'name guesses: 0% of 6 call links', 'Ruby: every call link in the app is resolved by syntax')

  // Python: annotated class attributes are fields; a typed or self call reaches them; overrides dispatch
  const pf = await ask('symbol', { symbol: 'BasePlugin.order_created' })
  has(pf, 'BasePlugin.order_created  field  py/shop/plugins/base_plugin.py:5', 'Python: an annotated hook `order_created: Callable[…]` is a field of its class')
  has(pf, 'order_created: Callable[["…", None], None]', '… its signature literal-free')
  const po = await ask('callers', { symbol: 'BasePlugin.order_created' })
  has(po, 'PluginsManager.order_created  method  py/shop/plugins/manager.py:5  [typed]', 'Python: a call on a typed receiver reaches the annotated field')
  has(po, 'BasePlugin.notify  method  py/shop/plugins/base_plugin.py:8  [same-class]', 'Python: `self.order_created()` reaches it')
  has(await ask('impact', { target: 'BasePlugin.order_created' }), 'WebhookPlugin.order_created  method  py/shop/plugins/webhook/plugin.py:5  (class WebhookPlugin)', 'Python: a subclass\'s method overriding the hook is listed as an override')
  const wo = await ask('impact', { target: 'WebhookPlugin.order_created' })
  has(wo, 'BasePlugin.order_created  field  py/shop/plugins/base_plugin.py:5  (class BasePlugin)', 'Python: … and the hook is the declaration calls may dispatch through')
  has(wo, 'PluginsManager.order_created:5  d1 [typed]', '… whose callers join the impact')
  const st = await ask('symbol', { symbol: 'ACCESS_TOKEN_EXPIRE_MINUTES' })
  has(st, 'Settings.ACCESS_TOKEN_EXPIRE_MINUTES  field  py/app/settings.py:5', 'Python: a settings field `ACCESS_TOKEN_EXPIRE_MINUTES: int = 60` is a symbol')
  has(st, '  ACCESS_TOKEN_EXPIRE_MINUTES: int\n', '… its signature stops before its value')
  has(await ask('search', { query: 'ACCESS_TOKEN' }), 'Settings.ACCESS_TOKEN_EXPIRE_MINUTES  field', 'Python: graph_search finds a settings field')
  has(await ask('symbol', { symbol: 'Settings.SECRET_KEY' }), '  SECRET_KEY: str\n', 'Python: a string default is not in the signature')
  has(await ask('impact', { target: 'Settings.ACCESS_TOKEN_EXPIRE_MINUTES' }), 'py/app/security.py  :5 reference in expiry', 'Python: a field read through a receiver is a mention, a reference (not prose)')

  // functions passed as values: a route's handler, a queued task, a signal's receiver
  const fc = await ask('callers', { symbol: 'send_welcome' })
  has(fc, 'on_user_saved  function  py/app/tasks.py:9  [same-file]', 'Python: `task.delay(…)` is a reference to the task')
  has(fc, 'queue  function  py/app/signals.py:7  [import]', 'Python: `task.apply_async(…)` on an imported task too')
  lacks(fc, 'shadow', 'Python: a parameter named like the function is the parameter, never a reference')
  lacks(fc, 'by_name', 'Python: a string naming it is never a reference')
  has(await ask('symbol', { symbol: 'send_welcome' }), 'referenced as a value by 2 · tests reaching it 1', 'Python: the test reaching the task through the code queueing it')
  const fi = await ask('impact', { target: 'send_welcome' })
  has(fi, 'queue:7  d1 [import] by reference', 'impact: a reference is walked, labelled by reference')
  has(fi, 'test_queue  function test  py/tests/test_signals.py:4  d2', 'impact: … and the tests on that path')
  lacks(fi, 'py/app/signals.py  :8', 'mentions: a line a reference explains is not a mention')
  has(await ask('callers', { symbol: 'on_user_saved' }), 'app/signals.py  file  py/app/signals.py  [import]', 'Python: `signal.connect(handler)` at top level references the handler')

  const al = await ask('symbol', { symbol: 'ArticleList' })
  has(al, 'referenced as a value by 1 · tests reaching it 1', 'Go: a handler passed to `router.GET` is reached by the test calling the registrar')
  const ai = await ask('impact', { target: 'ArticleList' })
  has(ai, 'RegisterArticleRoutes:5  d1 [same-file] by reference', 'Go: the registrar passing it as a value is in the impact')
  has(ai, 'TestArticles  function test  gin/articles/unit_test.go:5  d2', 'Go: … and so is the test hitting the registrar')
  has(await ask('callees', { symbol: 'RegisterArticleRoutes' }), 'Functions it passes or stores as a value (by reference):\n  ArticleList', 'callees: the values a function passes are listed apart from its calls')
  has(await ask('overview', { repo: 'gin' }), 'tests reach 75% of 4 functions', 'overview: test reach follows references (the handlers registered, not the one never registered)')

  // TypeScript: class fields are definitions (fields), literal-free
  const bx = await ask('symbol', { symbol: 'Box' })
  has(bx, 'members: size:2, label:3, area:4', 'TypeScript: class fields are members of their class')
  has(await ask('symbol', { symbol: 'Box.label' }), 'Box.label  field  web/src/box.ts:3\n  label\n', 'TypeScript: a field\'s signature stops before its value')

  // the diff: a changed handler is tested through its registrar; a removed one still registered is a break
  const edit = (rel, a, b) => { const f = path.join(FR, rel); const t = readFileSync(f, 'utf8'); ok(t.includes(a), `fixture edit applies to ${rel}`); writeFileSync(f, t.replace(a, b)) }
  edit('gin/articles/routers.go', 'func ArticleList(c *gin.Context) {\n\tc.JSON(200, nil)', 'func ArticleList(c *gin.Context) {\n\tc.JSON(201, nil)')
  edit('py/app/tasks.py', '@app.task\ndef send_welcome(user_id):\n    return user_id\n', '')
  const d = await ask('diff', { base: 'HEAD' })
  has(d, '~ ArticleList  function  gin/articles/routers.go:10  body', 'diff: a handler\'s body change')
  has(d, 'gin/articles/unit_test.go  (distance 2)', 'diff: the test reaching it through its registrar is a test to run')
  lacks(d, 'Changed code no test reaches (1', 'diff: … so the handler is not untested')
  has(d, 'removed send_welcome', 'diff: a removed task')
  has(d, '- send_welcome  function  (was py/app/tasks.py:5)', 'diff: … read from the base')
  has(d, 'Risk: high', 'diff: a removed function still queued elsewhere is high risk')

  const leaked = answers.flatMap((a) => a.match(/canary-frame-\d/g) || [])
  ok(!leaked.length, `6d: no answer quotes a field's or a member's literal (${leaked.length ? [...new Set(leaked)].join(', ') : 'none'})`)
  const dir = path.join(FR, '.grimoire/graph')
  const bytes = readdirSync(dir).filter((f) => f.startsWith('graph.db')).flatMap((f) => (readFileSync(path.join(dir, f), 'latin1').match(/canary-frame-\d/g) || []))
  ok(!bytes.length, `6d: no field default is kept in the index (${bytes.length})`)
}

// ── 6e · a React Native workspace: JSX, wrapped components, aliases, workspace packages, platform files ──
console.log('\n6e · a React Native workspace (fixtures/rn): JSX renders, aliases, workspace packages, platform files, files outside the index')
{
  const RN = path.join(SANDBOX, 'rn')
  cpSync(path.join(HERE, 'fixtures', 'rn'), RN, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
  const commit = (m) => { git(RN, 'add', '-A'); git(RN, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }
  git(RN, 'init', '-q', '-b', 'main'); commit('init')
  const nq = (tool, args = {}) => call(`graph_${tool}`, args, { root: RN })
  const sql = async (s) => (await nq('sql', { sql: s })).split('\n').slice(1).filter((l) => l && !l.startsWith('Leads')).map((l) => l.trim())
  await nq('index')

  const home = await nq('file', { path: 'apps/mobile/src/screens/Home.tsx' })
  has(home, 'Home  function  :13', '`export default () => …` is a definition named after its file')
  has(home, '  apps/mobile/src/ui.ts', 'relative: `../ui` resolves as before')
  has(home, '  apps/mobile/src/components/Card.tsx', 'babel module-resolver: `@components/Card` (no slash after the prefix) resolves through the literal alias')
  has(home, '  apps/mobile/src/alf/index.tsx', 'an alias no config maps (`~/alf`) reaches a folder\'s index file below the repository root')
  has(home, '  packages/db/src/schema.ts', 'workspace: `@acme/db/schema` resolves through the package\'s conditional exports, a dist target mapped to its source')
  has(home, '  packages/db/src/index.ts', 'workspace: `@acme/db` resolves through the package\'s `.` export')
  has(home, '  packages/ui/src/button.tsx', 'workspace: `@acme/ui/button` resolves through a subpath pattern (`./*`)')
  has(home, '  packages/api/src/root.ts', 'workspace: `@acme/api` resolves through `main`')
  has(home, '  apps/mobile/src/sql/posts.sql', 'a relative import of a non-code file the index holds (`.sql`) is an IMPORTS edge to it')
  has(home, 'files outside the index: @assets/logo.png, ../data.json', 'an image through a tsconfig alias (`@assets/*`) and a JSON file are files outside the index, not external')
  lacks(home, 'external: ', '… so nothing in that file is called external')
  const card = await nq('file', { path: 'apps/mobile/src/components/Card.tsx' })
  for (const p of ['ios', 'android', 'web', 'mobile']) has(card, `apps/mobile/src/components/Button.${p}.tsx`, `platform files: \`./Button\` resolves to Button.${p}.tsx${p === 'mobile' ? ' (a suffix the tsconfig\'s moduleSuffixes adds, through extends)' : ''}`)
  has(await nq('file', { path: 'packages/db/src/config.ts' }), '  packages/db/src/config.base.ts', 'a dotted file name (`./config.base`) keeps its dots')
  has(await nq('callers', { symbol: 'baseConfig' }), 'config  function  packages/db/src/config.ts:3  [import]', '… and its function is called through the import')

  // JSX renders are calls; a test rendering a component is its test
  const cc = await nq('callers', { symbol: 'Card' })
  has(cc, 'Home  function  apps/mobile/src/screens/Home.tsx:13  [import]', 'JSX: `<Card />` calls Card, through its default import')
  has(await nq('callers', { symbol: 'Row' }), 'Home  function  apps/mobile/src/screens/Home.tsx:13  [import]', 'JSX: `<UI.Row>` calls Row through the namespace import')
  has(await nq('callers', { symbol: 'Button', repo: 'rn' }), 'Home  function  apps/mobile/src/screens/Home.tsx:13  [import]', 'JSX: an aliased import (`Button as UIButton`) renders the workspace package\'s forwardRef component')
  has(await nq('callers', { symbol: 'postTable' }), 'postRouter.all  method  packages/api/src/router/post.ts:4  [import]', 'tRPC: a procedure of a `satisfies TRPCRouterRecord` object is a member, and calls through a workspace package')
  has(await nq('callers', { symbol: 'ping' }), 'appRouter.health  method  packages/api/src/root.ts:5  [same-file]', 'tRPC: a procedure of `createTRPCRouter({…})` is a member of the router')
  has(await nq('callers', { symbol: 'count' }), 'useStore  function  apps/mobile/src/store.ts:1  [same-file]', 'a store made by `create<State>()((set) => …)` is a definition: its calls are its own')
  const variants = await sql("SELECT count(*) AS n FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst JOIN files f ON f.id = d.file_id WHERE e.kind = 'CALLS' AND s.name = 'Card' AND d.name = 'Button' AND e.confidence = 'import' AND f.path LIKE 'apps/%'")
  ok(variants[0] === '4', `platform files: Card's \`<Button>\` links each of the 4 variants, by import, not as an ambiguity (${variants.join(',')})`)
  const shared = await sql("SELECT f.path, e.confidence FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst JOIN files f ON f.id = d.file_id WHERE e.kind = 'CALLS' AND s.name = 'Card' AND f.path LIKE 'packages/%'")
  ok(shared.length === 1 && /^packages\/ui\/src\/button\.tsx\s+import$/.test(shared[0]), `a barrel's re-export (\`export { Button } from './button'\`) is followed to the definition (${shared.join(' · ')})`)
  const span = await sql("SELECT count(*) AS n FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.kind = 'CALLS' AND d.name = 'Span'")
  ok(span[0] === '0', `a barrel passing on a dependency's component (\`export { Text as Span } from 'react-native'\`) links nothing, never the repository's \`type Span\` (${span.join(',')})`)
  has(await nq('callers', { symbol: 'Home' }), 'Framed  function test', 'a component wrapped by `memo(…)` inside a test is a definition: it renders Home')
  const intrinsic = await sql("SELECT count(*) AS n FROM refs WHERE name IN ('div', 'button')")
  ok(intrinsic[0] === '0', `JSX: a lowercase tag is never a call (${intrinsic.join(',')})`)
  const ih = await nq('impact', { target: 'Home', mentions: false })
  has(ih, 'apps/mobile/src/screens/Home.test.tsx  file test', 'impact: a test rendering `<Home />` is a test of Home')
  const ov = await nq('overview')
  const entries = ov.slice(ov.indexOf('Entry points'), ov.indexOf('Most used'))
  lacks(entries, 'Card  function', 'overview: a component something renders is no entry point')
  writeFileSync(path.join(RN, 'apps/mobile/src/screens/Home.tsx'), readFileSync(path.join(RN, 'apps/mobile/src/screens/Home.tsx'), 'utf8').replace('<Card />', '<Card />\n    <Card />'))
  const d = await nq('diff', { base: 'HEAD' })
  has(d, '~ Home  function  apps/mobile/src/screens/Home.tsx:13  body', 'diff: the default export, named after its file, is the changed definition')
  has(d, 'apps/mobile/src/screens/Home.test.tsx', 'diff: … and the test rendering it is the test to run')
  lacks(d, 'Changed code no test reaches', 'diff: … so the change is not untested')
}

console.log('\n6f · module resolution reads the configs a repository states guarded: no credential file, no link out of it, no device, a size cap')
{
  const H = path.join(SANDBOX, 'hostile-js'), OUT = path.join(SANDBOX, 'hostile-js-outside')
  const put = (rel, txt) => { mkdirSync(path.dirname(path.join(H, rel)), { recursive: true }); writeFileSync(path.join(H, rel), txt) }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: '@leak/outside', main: 'index.ts', note: 'canary-js-1' }))
  put('grimoire.config.json', '{ "graph": {} }\n')
  // a tsconfig extending credential files (paths only they map) beside a config of the repository
  put('tsconfig.json', '{ "extends": ["./.env", "./credentials.json", "./tsconfig.base.json"] }\n')
  put('.env', '{ "compilerOptions": { "paths": { "@env/*": ["./src/*"] } }, "x": "canary-js-2" }\n')
  put('credentials.json', '{ "compilerOptions": { "paths": { "@cred/*": ["./src/*"] } }, "token": "canary-js-3" }\n')
  put('tsconfig.base.json', '{ "compilerOptions": { "paths": { "@ok/*": ["./src/*"] } } }\n')
  put('package.json', JSON.stringify({ name: 'root', workspaces: ['pkgs/*'] }))
  put('src/b.ts', 'export const b = 1\n')
  put('src/a.ts', "import { b } from '@ok/b'\nimport { e } from '@env/b'\nimport { c } from '@cred/b'\nimport { o } from '@leak/outside'\nimport { i } from '@in/pkg'\nexport const a = () => b + e + c + o + i\n")
  put('real/pkg/package.json', JSON.stringify({ name: '@in/pkg', main: 'index.ts' }))
  put('real/pkg/index.ts', 'export const i = 1\n')
  mkdirSync(path.join(H, 'pkgs'), { recursive: true })
  const { symlinkSync } = await import('node:fs')
  // a package.json that is a device (unbounded), one linked out of the repository, one linked inside it
  mkdirSync(path.join(H, 'pkgs/zero')); symlinkSync('/dev/zero', path.join(H, 'pkgs/zero/package.json'))
  mkdirSync(path.join(H, 'pkgs/out')); symlinkSync(path.join(OUT, 'package.json'), path.join(H, 'pkgs/out/package.json')); writeFileSync(path.join(H, 'pkgs/out/index.ts'), 'export const o = 1\n')
  mkdirSync(path.join(H, 'pkgs/in')); symlinkSync('../../real/pkg/package.json', path.join(H, 'pkgs/in/package.json')); symlinkSync('../../real/pkg/index.ts', path.join(H, 'pkgs/in/index.ts'))
  for (const f of ['babel.config.js', 'lerna.json', 'pnpm-workspace.yaml']) symlinkSync('/dev/zero', path.join(H, f))
  put('svc/main.go', 'package main\n\nfunc main() {}\n'); symlinkSync('/dev/zero', path.join(H, 'svc/go.mod'))
  git(H, 'init', '-q', '-b', 'main'); git(H, 'add', '-A'); git(H, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
  const t0 = Date.now()
  const idx = await call('graph_index', {}, { root: H })
  ok(/Indexed in/.test(idx) && Date.now() - t0 < 60000, `the index completes: a config linked to /dev/zero is never read (${idx.split('\n')[0]}, ${Date.now() - t0} ms)`)
  const fa = await call('graph_file', { path: 'src/a.ts' }, { root: H })
  has(fa, '  src/b.ts', 'a tsconfig\'s relative `extends` of the repository is still followed (`@ok/b`)')
  ok((fa.match(/ {2}src\/b\.ts/g) || []).length === 1, 'an `extends` naming `.env` or `credentials.json` is never opened: the paths only they map resolve to nothing')
  lacks(fa, 'pkgs/out/index.ts', 'a workspace package.json linked out of the repository is never read: its name maps nothing')
  has(fa, 'pkgs/in/index.ts', 'a package.json linked inside the repository is read as before')
  const dir = path.join(H, '.grimoire/graph')
  const bytes = readdirSync(dir).filter((f) => f.startsWith('graph.db')).flatMap((f) => readFileSync(path.join(dir, f), 'latin1').match(/canary-js-\d/g) || [])
  ok(!bytes.length && !/canary-js/.test(fa), `nothing of those files reaches an answer or the index (${bytes.length ? [...new Set(bytes)].join(', ') : 'none'})`)
  const { readRepoText } = await import('../lib/project.mjs')
  ok(readRepoText(H, 'pkgs/zero/package.json') === null && readRepoText(H, '.env') === null && readRepoText(H, 'pkgs/out/package.json') === null && readRepoText(H, '../hostile-js-outside/package.json') === null && readRepoText(H, 'tsconfig.base.json') !== null,
    'readRepoText: a device, a credential file, a link out of the repository, a path out of it: null; a config of the repository: read')
  writeFileSync(path.join(H, 'big.json'), `{"x":"${'a'.repeat(1 << 20)}"}`)
  ok(readRepoText(H, 'big.json') === null && readRepoText(H, 'big.json', { max: 2 << 20 }) !== null, 'readRepoText: a file past its cap (1 MB by default) is not read at all')
}

console.log('\n6g · a wide syntax tree is walked in its size: each node\'s children listed in one call')
{
  const W = path.join(SANDBOX, 'wide')
  mkdirSync(path.join(W, 'src'), { recursive: true }); mkdirSync(path.join(W, 'py'), { recursive: true })
  writeFileSync(path.join(W, 'grimoire.config.json'), '{ "graph": {} }\n')
  // 440 KB of an unclosed factory (the error recovery leaves one node of 20000 children), a wide
  // array, a Python import of 20000 names
  writeFileSync(path.join(W, 'src/config.js'), 'export default () => {'.repeat(20000))
  writeFileSync(path.join(W, 'src/list.js'), `export const xs = [${'f(),'.repeat(40000)}]\n`)
  writeFileSync(path.join(W, 'py/imp.py'), `from m import ${Array.from({ length: 20000 }, (_, i) => `n${i}`).join(', ')}\n`)
  git(W, 'init', '-q', '-b', 'main')
  const t0 = Date.now()
  const idx = await call('graph_index', {}, { root: W })
  const ms = Date.now() - t0
  ok(/Indexed in/.test(idx) && ms < 8000, `indexed in ${ms} ms (< 8 s; a child listed by its index walked the children before it: 17 s for the factory alone)`)
}

// ── 6h · resolution's narrowing, measured on real projects: each a wrong link no longer made, or a right one kept ──
console.log('\n6h · resolution (fixtures/resolve): call chains, the self-call guard, dependency types, closures, locals, variants, Ruby symbols, JSX imports, wrappers, routers, globals, super, typed sites')
{
  const RS = path.join(SANDBOX, 'resolve')
  cpSync(path.join(HERE, 'fixtures', 'resolve'), RS, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
  const rq = (tool, args = {}) => call(`graph_${tool}`, args, { root: RS })
  const rows = async (s) => (await rq('sql', { sql: s })).split('\n').slice(1).filter((l) => l && !l.startsWith('Leads')).map((l) => l.trim().replace(/\s+/g, ' '))
  // the edges of `kind` from the definition (or file) `src` names, as `confidence dst-path:dst-qualname`
  const edgesFrom = (src, kind = 'CALLS') => rows(`SELECT e.confidence || ' ' || fd.path || ':' || d.qualname AS e FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst JOIN files fd ON fd.id = d.file_id WHERE e.kind = '${kind}' AND (s.qualname = '${src}') ORDER BY 1`)
  await rq('index')

  // 1 · a call chain rooted at self is the object's own method, not a field holding another object
  ok((await edgesFrom('ProductsQueryset.annotate_publication_info')).includes('same-file shop/managers.py:ProductsQueryset.annotate_published_at'), `Python: \`self.annotate_is_published(c).annotate_published_at(c)\` reaches the class's own method (${(await edgesFrom('ProductsQueryset.annotate_publication_info')).join(' · ')})`)
  ok(!(await edgesFrom('Delegating.annotate_published_at')).length, `Python: \`self.repo.annotate_published_at()\` is never the caller itself nor another class's method by name (${(await edgesFrom('Delegating.annotate_published_at')).join(' · ')})`)
  // 2 · where the guard removed the caller or its class's method, the name decides nothing
  ok(!(await edgesFrom('SharedPrefs.getString')).length, `Kotlin: \`safeInstance.getString()\` in SharedPrefs.getString is not a unique-name link to NotificationPrefs.getString (${(await edgesFrom('SharedPrefs.getString')).join(' · ')})`)
  ok(!(await edgesFrom('GifView.playAsync')).length, `TypeScript: \`this.nativeRef.current.playAsync()\` is not linked to the other platform variant's method (${(await edgesFrom('GifView.playAsync')).join(' · ')})`)
  ok((await edgesFrom('GifView.render')).some((e) => /^same-file src\/GifView\.tsx:GifView\.playAsync$/.test(e)), `TypeScript: \`this.chain().playAsync()\` (a chain, not a field) stays the class's own (${(await edgesFrom('GifView.render')).join(' · ')})`)
  // 3 · a type imported from a dependency is not the repository's class of that name; a mock is no production callee
  ok(!(await edgesFrom('logWith')).length, `TypeScript: \`l.info()\` on a \`Logger\` imported from a dependency links nothing (${(await edgesFrom('logWith')).join(' · ')})`)
  ok((await edgesFrom('logOwn')).includes('typed src/logger.ts:Logger.info'), '… a `Logger` imported (renamed) from the repository is typed to it')
  ok(!(await edgesFrom('link.ts', 'REFERENCES')).length && !(await rows("SELECT 1 FROM edges e JOIN nodes s ON s.id = e.src JOIN files f ON f.id = s.file_id WHERE f.path = 'src/link.ts' AND e.kind = 'REFERENCES'")).length, 'TypeScript: `redirectLogger.info` passed on (a dependency\'s `Logger`) references nothing')
  ok(!(await edgesFrom('save')).length, `TypeScript: \`new File()\` / \`new FS.File()\` from a dependency, \`f.write()\`: never the jest setup's mock field (${(await edgesFrom('save')).join(' · ')})`)
  has(await rq('symbol', { symbol: 'File' }), 'class test', 'a test runner\'s setup (`jest/setup.js`) is test-support code')
  // 4 · a bare call reaches a closure of an enclosing definition, a wrapped component's too
  has(await rq('callers', { symbol: 'selectItem' }), 'MentionList.enterHandler  function  web/src/Autocomplete.tsx:5  [same-file]', 'JSX: a bare call inside `forwardRef(function …)` reaches the closure it names')
  has(await rq('callers', { symbol: 'Row' }), 'MentionList  function  web/src/Autocomplete.tsx:3  [same-file]', 'JSX: a component defined as a closure is rendered from its enclosing definition')
  // 5 · locals are no references: an arrow's lone parameter, a destructured one, a callback's locals; nor a name the file never imports
  const listRefs = await edgesFrom('List', 'REFERENCES')
  ok(!listRefs.length, `TypeScript: \`profile => <Item profile={profile} />\` and a destructured \`{ clearTranslation }\` are parameters, not the imported functions (${listRefs.join(' · ')})`)
  const fileRefs = await rows("SELECT d.qualname FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst WHERE e.kind = 'REFERENCES' AND s.qualname = 'src/List.tsx'")
  ok(fileRefs.join(',') === 'profile', `TypeScript: \`{ onGet: get }\` names nothing the file imports (no link to a module's \`get\`); \`onProfile: profile\` is the import (${fileRefs.join(',')})`)
  const testRefs = await rows("SELECT d.qualname FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst WHERE e.kind = 'REFERENCES' AND s.qualname = 'src/merge.test.ts'")
  ok(!testRefs.length, `a local of an anonymous callback (\`it('…', () => { const get = …; get.mockRestore() })\`) is that local, not the import it shadows (${testRefs.join(',')})`)
  const badge = await edgesFrom('Badge', 'REFERENCES')
  ok(!badge.some((e) => /Button\.tsx:Button$/.test(e)), `JSX: \`<Button.Button>\` names a namespace, no value of the function \`Button\` (${badge.join(' · ')})`)
  has(await rq('callers', { symbol: 'Button' }), 'Badge  function  web/src/Settings.tsx:4  [import]', '… while the render still calls it through the namespace')
  // 6 · a value naming a function in its platform variants links each variant, not as an ambiguity
  ok(badge.filter((e) => /^import src\/share\.(ios|android)\.ts:onShare$/.test(e)).length === 2, `REFERENCES: \`onPress={onShare}\` links share.ios.ts and share.android.ts by import (${badge.join(' · ')})`)
  // 7 · Ruby: only a callback-style macro's symbols name methods
  const story = await edgesFrom('Story', 'REFERENCES')
  ok(story.join(',') === 'same-class app/models/story.rb:Story.normalize_title,same-class app/models/story.rb:Story.published?', `Ruby: \`before_save :normalize_title, if: :published?\` name the class's methods, and nothing else in its body does (${story.join(' · ')})`)
  ok((await edgesFrom('Story.normalize_title', 'REFERENCES')).includes('same-class app/models/story.rb:Story.published?'), 'Ruby: `respond_to?(:published?)` names the method')
  const scoped = [...await edgesFrom('Story.by_title', 'REFERENCES'), ...await edgesFrom('Story.preloaded', 'REFERENCES')]
  ok(!scoped.length, `Ruby: \`group(:title)\` names a column, \`preload(:votes, hidings: :user)\` associations to load (another model's \`user\` among them): no method used as a value (${scoped.join(' · ')})`)
  const ctl = await edgesFrom('StoriesController', 'REFERENCES')
  ok(ctl.join(',') === 'same-class app/controllers/stories_controller.rb:StoriesController.find_story,same-class app/controllers/stories_controller.rb:StoriesController.show', `Ruby: \`before_action :find_story, only: [:show]\` names both (${ctl.join(' · ')})`)
  ok(!(await edgesFrom('StoriesController.create', 'REFERENCES')).length, 'Ruby: `render action: :new` names an action to render, no method used as a value')
  // 8 · a JSX name whose import resolved stays that file's: an alias followed, never a guess elsewhere
  const dialog = await edgesFrom('Dialog')
  ok(!dialog.some((e) => e.includes('embed/')), `JSX: \`<Check>\` imported from a file re-exporting a non-function is never a unique-name link to another \`Check\` (${dialog.join(' · ')})`)
  ok(dialog.includes('import src/icons/brands/Star.tsx:Star'), '… and `export const Star = CanonicalStar` is followed to the definition it names')
  const card = await rows("SELECT d.name FROM edges e JOIN nodes s ON s.id = e.src JOIN files f ON f.id = s.file_id JOIN nodes d ON d.id = e.dst WHERE f.path = 'src/__tests__/Card.test.tsx' AND e.kind = 'CALLS'")
  ok(!card.length, `JSX: a name destructured from \`jest.requireActual('react-native')\`, also through \`jest.requireActual<typeof import('react-native')>(…)\` or \`require('react-native') as typeof import(…)\`, is the dependency's (${card.join(',')})`)
  const header = await edgesFrom('Header')
  ok(header.join(',') === 'import src/Layout.tsx:Slot', `JSX: \`export const Slot = Layout.Slot\` then \`<Slot />\` is the namespace's member; \`throw Error(…)\` the runtime's, never a component named \`Error\` (${header.join(' · ')})`)
  // 9 · a value built with a callback is no function unless the callee wraps one
  const fns = await rows("SELECT n.name FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.path = 'src/schema.ts' AND n.kind = 'function' ORDER BY n.name")
  ok(fns.join(',') === 'debounced,wire', `\`pgTable(…, cb)\`, \`z.object().refine(cb)\`, \`createContext(() => {})\`, \`t.procedure.use(cb)\` are no functions; \`debounce(() => …)\` is (${fns.join(',')})`)
  // 10 · a router's procedure is reached only by syntax
  ok(!(await edgesFrom('getSession')).length, `tRPC: \`auth.api.getSession()\` is no name guess at a router's procedure (${(await edgesFrom('getSession')).join(' · ')})`)
  ok((await edgesFrom('viaRouter')).includes('qualified src/router.ts:authRouter.getSession'), '… `authRouter.getSession()` still reaches it')
  // 11 · the runtime's objects are a dependency
  ok(!(await edgesFrom('report')).length, `\`console.error()\`, \`window.open()\` never guess at the repository's \`Logger.error\` or a mock's \`open\` (${(await edgesFrom('report')).join(' · ')})`)
  // 12 · super: the supertypes' member, or none
  ok((await edgesFrom('AddressForm.clean')).join(',') === 'same-class shop/forms.py:BaseForm.clean', `Python: \`super().clean()\` is the base class's (${(await edgesFrom('AddressForm.clean')).join(' · ')})`)
  ok(!(await edgesFrom('Order.save')).length, `Python: \`super().save()\` up a framework's class links nothing, never another class's \`save\` (${(await edgesFrom('Order.save')).join(' · ')})`)
  ok((await edgesFrom('Child.save')).join(',') === 'same-class src/user.service.ts:Base.save', `TypeScript: \`super.save()\` is the parent's, never the method itself (${(await edgesFrom('Child.save')).join(' · ')})`)
  // 13 · an unlinked site typed to an unrelated type is no possible caller
  const imp = await rq('impact', { target: 'UserService.findOne', mentions: false })
  lacks(imp, 'this.userRepository.findOne', 'impact: `this.userRepository.findOne()` on a `Repository<…>` is not listed as a possible caller of UserService.findOne')
}

rmSync(SANDBOX, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
