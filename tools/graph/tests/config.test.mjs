// ════════════════════════════════════════════════════════════════════════════
//  Tests — the code graph: configuration keys, API contracts, import guesses
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/config.test.mjs
//
//  1. the lexical readers alone (no parser runtime): comments masked, declaration files read for
//     their names only, which files may be read at all, GraphQL and protobuf parsed by hand
//  2. fixtures/config: graph_config (reads, declarations, mappings, the gaps), graph_impact on a key
//     and on a definition that reads one, the mentions the config index explains, a refresh
//  3. the canary: no value of an env template, a compose file, a workflow, app.json or a literal in
//     code reaches any answer, the page or a byte of the index; a .env is never read
//  4. fixtures/contracts: GraphQL and protobuf definitions as nodes, selections linked to fields,
//     resolvers and service implementations linked to what they implement, the larger cap for
//     contract files, an OpenAPI document as a file node, graph_diff over a schema change
//  5. import guesses: a method on a receiver of unknown type, picked by its imported file, is a name
//     guess (status, strict, overview's most used)
//
//  Needs the parser runtime (npm ci --prefix tools/graph) for 2 to 5; skipped without it, except
//  under CI, where a missing runtime fails.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync, realpathSync, mkdirSync, unlinkSync } from 'node:fs'
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

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const lacks = (hay, needle, m) => ok(!hay.includes(needle), `${m}${hay.includes(needle) ? `\n       did not expect: ${needle}` : ''}`)
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' })
const commit = (dir, m) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }

// ── 1 · the lexical readers ──
console.log('\n1 · lexical readers: comments, declaration files, hand-parsed contracts')
{
  const { masked } = await import('../lib/lex.mjs')
  const { configOfDecl, configOfCode, declKind } = await import('../lib/config.mjs')
  const { parseContract } = await import('../lib/contracts.mjs')
  const m = masked('a = "http://x" // process.env.A\nb = `${process.env.B}` /* process.env.C */', 'js')
  ok(m.includes('"http://x"') && !m.includes('process.env.A') && m.includes('process.env.B') && !m.includes('process.env.C') && m.split('\n').length === 2, 'masked: comments blanked, strings and template code kept, lines kept')
  const py = masked('def f():\n    """os.environ["A"]"""\n    x = "#"  # os.environ["B"]\n', 'python')
  ok(!py.includes('"A"') && py.includes('"#"') && !py.includes('"B"'), 'masked (Python): a docstring and a comment are blanked, a string holding # is not')

  const envT = configOfDecl('env template', '# comment\nA_KEY=canary-unit-1\nexport B_KEY="canary-unit-2"\n  C_KEY = x\nnot a key\n')
  ok(envT.map((r) => `${r.key}:${r.line}`).join(' ') === 'A_KEY:2 B_KEY:3 C_KEY:4', `env template: the names before = and their lines (${envT.map((r) => r.key).join(' ')})`)
  ok(!JSON.stringify(envT).includes('canary-unit'), 'env template: no value kept')
  const compose = configOfDecl('compose', 'services:\n  a:\n    command: |\n      environment:\n        FAKE: x\n    environment:\n      - ONE=canary-unit-3\n      - "TWO"\n  b:\n    environment: [THREE, FOUR=x]\n  c:\n    environment:\n      FIVE: canary-unit-4\n')
  ok(compose.map((r) => r.key).join(' ') === 'ONE TWO THREE FOUR FIVE', `compose: list, inline and map forms; a block scalar's text is no key (${compose.map((r) => r.key).join(' ')})`)
  const wf = configOfDecl('workflow', 'env:\n  TOP: 1\njobs:\n  t:\n    env:\n      JOB_KEY: ${{ secrets.X }}\n    steps:\n      - run: |\n          env:\n            NOPE: 1\n')
  ok(wf.map((r) => r.key).join(' ') === 'TOP JOB_KEY', `workflow: env: names at any level, a run script's text is no key (${wf.map((r) => r.key).join(' ')})`)
  const app = configOfDecl('app.json', '{ "expo": { "extra": { "apiUrl": "canary-unit-5", "eas": { "projectId": "x" } } } }')
  ok(app.map((r) => r.key).join(' ') === 'extra.apiUrl extra.eas.projectId' && !JSON.stringify(app).includes('canary'), 'app.json: expo.extra keys by path, no value')
  const props = configOfDecl('application.properties', 'a.b.c=${DB_HOST:canary-unit-6}\n# x.y=1\nd.e=canary-unit-7\n')
  ok(props.filter((r) => r.role === 'declare').map((r) => r.key).join(' ') === 'a.b.c d.e' && props.some((r) => r.role === 'map' && r.key === 'a.b.c' && r.srcKey === 'DB_HOST') && !JSON.stringify(props).includes('canary'), 'application.properties: keys, a ${PLACEHOLDER} as a mapping, no value')
  const yml = configOfDecl('application.yml', 'spring:\n  datasource:\n    url: ${DATABASE_URL}\n    pool: 4\nserver:\n  port: 8080\n')
  ok(yml.filter((r) => r.role === 'declare').map((r) => r.key).join(' ') === 'spring.datasource.url spring.datasource.pool server.port' && yml.some((r) => r.role === 'map' && r.srcKey === 'DATABASE_URL'), 'application.yml: nested keys by dotted path, placeholders mapped')
  // a multi-line value's lines are its text, never keys: a properties continuation, a YAML quoted
  // scalar, an env template's quoted value (a PEM key)
  const keysOf = (rows) => rows.filter((r) => r.role === 'declare').map((r) => `${r.key}:${r.line}`).join(' ')
  const pc = configOfDecl('application.properties', 'jwt.key=MIIBIjANBgkqhkiG9w0BAQEFAAOC\\\n   canarysec18chunk==\nother.value=first\\\n  canarysec19: second\\\\\nnext.key=${NEXT:x}\\\n  ${CONT_VAR}\n# a comment\\\nafter.comment=1\nodd=a\\\\\\\r\n  canarysec20=x\nlast=1\n')
  ok(keysOf(pc) === 'jwt.key:1 other.value:3 next.key:5 after.comment:8 odd:9 last:11' && !/canary/.test(JSON.stringify(pc)) && pc.some((r) => r.role === 'map' && r.key === 'next.key' && r.srcKey === 'CONT_VAR'), `application.properties: a line ending in an odd number of backslashes goes on, its next lines no keys (an even number does not; a comment never does); a placeholder on them still maps the key (${keysOf(pc)})`)
  const yq = configOfDecl('application.yml', 'spring:\n  datasource:\n    multi: "first part\n      canarysec23: rest \\" still\n      canarysec24: x"\n    single: \'it\'\'s\n      canarysec25: y\'\n    plain: "closed" # c\n    after: 1\n  items:\n    - "an item\n      canarysec26: z"\n  tail: 2\n')
  ok(keysOf(yq) === 'spring.datasource.multi:3 spring.datasource.single:6 spring.datasource.plain:8 spring.datasource.after:9 spring.tail:13' && !/canary/.test(JSON.stringify(yq)), `application.yml: a quoted scalar's lines up to its closing quote are its text (an escaped \\" and a doubled '' inside), never keys (${keysOf(yq)})`)
  const cq = configOfDecl('compose', 'services:\n  a:\n    environment:\n      - "ONE=first\n        canarysec27: x"\n      - TWO\n  b:\n    environment:\n      THREE: "a\n        CANARY_SEC_28: b"\n      FOUR: 1\n')
  ok(cq.map((r) => r.key).join(' ') === 'ONE TWO THREE FOUR' && !/canary/i.test(JSON.stringify(cq)), `compose: the same, in a list and a map (${cq.map((r) => r.key).join(' ')})`)
  const et = configOfDecl('env template', 'EXAMPLE_KEY=canary-sec-2\nPRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nCanarySec3Base64ChunkNoSlashesHere=\nESC=\\"still inside\n-----END PRIVATE KEY-----"\nSINGLE=\'a\nCANARY_SEC_4=b\'\nAFTER=1\n')
  ok(et.map((r) => `${r.key}:${r.line}`).join(' ') === 'EXAMPLE_KEY:1 PRIVATE_KEY:2 SINGLE:6 AFTER:8' && !/canary/i.test(JSON.stringify(et)), `env template: a quoted value's lines up to its closing quote are its text (a PEM key), never names (${et.map((r) => r.key).join(' ')})`)
  // linear: openers left unclosed, or nested deep, cost the file's length once (lex.mjs matchTable)
  for (const [what, src, rel] of [['registerAs', "registerAs('a', () => {".repeat(21000), 'src/cfg.js'], ['a config factory', `process.env.A\n${'export default () => {'.repeat(22000)}`, 'src/config.js'], ['app.config extra', 'extra: {'.repeat(60000), 'app.config.js'],
    ['registerAs, closed', `${"registerAs('a', () => {".repeat(20000)}return { k: process.env.X }${'})'.repeat(20000)}`, 'src/cfg.js'], ['extra, closed', `${'extra: {'.repeat(50000)}a: process.env.Y${'}'.repeat(50000)}`, 'app.config.js']]) {
    const t1 = Date.now()
    const rows = configOfCode('javascript', 'js', rel, src, [])
    ok(Date.now() - t1 < 2000 && rows.length <= 5000, `configOfCode: ${what} × thousands (${src.length >> 10} KB) in ${Date.now() - t1} ms (< 2 s), ${rows.length} rows`)
  }
  const { matchTable, closing } = await import('../lib/lex.mjs')
  const lexSrc = 'a({ b: [1, "]", `}`], c: { d: (e) } }) ( [ } ] { x }'
  const mt = matchTable(lexSrc)
  ok([...lexSrc].every((c, i) => !'([{'.includes(c) || mt[i] === closing(lexSrc, i)), 'matchTable: every opener\'s match is what closing finds by scanning (strings skipped, a wrong closer leaving the brackets open before it unmatched)')
  // which files may be read: an env template, never a .env or another credential file
  const kinds = ['.env.example', 'web/.env.sample', '.env.template', '.env.local.example', 'env-example-relational', 'docker.env.example', '.env', '.env.local', '.env.production', '.env.example.local', 'prod.env', '.envrc', 'credentials.json', '.npmrc', 'docker-compose.yml', 'compose.prod.yaml', '.github/workflows/ci.yml', '.gitlab-ci.yml', 'app.json', 'src/application.properties', 'config/application-dev.yml']
  const got = kinds.map((k) => `${k}=${declKind(k) || '-'}`).join(' ')
  ok(got === '.env.example=env template web/.env.sample=env template .env.template=env template .env.local.example=env template env-example-relational=env template docker.env.example=env template .env=- .env.local=- .env.production=- .env.example.local=- prod.env=- .envrc=- credentials.json=- .npmrc=- docker-compose.yml=compose compose.prod.yaml=compose .github/workflows/ci.yml=workflow .gitlab-ci.yml=gitlab-ci app.json=app.json src/application.properties=application.properties config/application-dev.yml=application.yml', `declKind: env templates only among the env files (${got})`)
  // registerAs with a type argument and a block body: the object its last `return` gives
  const ra = configOfCode('typescript', 'js', 'src/auth/auth.config.ts', "export default registerAs<AuthConfig>('auth', () => {\n  validate(process.env)\n  return {\n    secret: process.env.AUTH_JWT_SECRET,\n    nested: { ttl: process.env.TTL as string },\n  }\n})\n", [])
  ok(ra.filter((r) => r.role === 'map').map((r) => `${r.key}<-${r.srcKey}`).join(' ') === 'auth.secret<-AUTH_JWT_SECRET auth.nested.ttl<-TTL', `registerAs<T>('ns', () => { …; return { … } }): its keys mapped from the env reads (${ra.filter((r) => r.role === 'map').map((r) => r.key).join(' ')})`)
  const fac = configOfCode('typescript', 'js', 'src/config/configuration.ts', 'export default () => ({\n  port: parseInt(process.env.PORT, 10),\n  database: { host: process.env.DATABASE_HOST },\n})\n', [])
  ok(fac.filter((r) => r.role === 'map').map((r) => `${r.key}<-${r.srcKey}`).join(' ') === 'port<-PORT database.host<-DATABASE_HOST', 'a Nest config factory: its keys by path, mapped from the env reads')
  ok(!configOfCode('tsx', 'js', 'src/App.tsx', 'export default () => ({ a: process.env.A })\n', []).some((r) => r.role === 'map'), '… only in a config file')
  // code reads, per language family
  const rd = (lang, fam, src) => configOfCode(lang, fam, 'x', src, []).filter((r) => r.role === 'read').map((r) => `${r.key}:${r.kind}`).join(' ')
  ok(rd('typescript', 'js', "const a = process.env.A_1; const b = process.env['B_2']; const { C_3, D_4: d = 'canary' } = process.env; import.meta.env.VITE_E; config.get<string>('auth.jwt'); this.configService.getOrThrow('F_6')") === 'A_1:env B_2:env VITE_E:env auth.jwt:config F_6:env C_3:env D_4:env', 'reads (JavaScript): process.env, a destructuring, import.meta.env, ConfigService.get')
  ok(rd('python', 'python', "os.environ['A']\nos.environ.get(\"B\", 'canary')\nos.getenv('C')\nif 'D' in os.environ: pass\n") === 'A:env B:env C:env D:env', 'reads (Python): os.environ, os.environ.get, os.getenv, `in os.environ`')
  ok(rd('go', 'go', 'x := os.Getenv("A")\ny, _ := os.LookupEnv("B")\nviper.GetString("c.d")\ntype T struct { P string `env:"E" envDefault:"canary"` }') === 'A:env B:env c.d:config E:env', 'reads (Go): os.Getenv, os.LookupEnv, viper, a struct tag')
  ok(rd('java', 'jvm', 'String a = System.getenv("A"); @Value("${b.c:canary}") String b; @Value("${D_E}") String d;') === 'A:env b.c:config D_E:env', 'reads (Java): System.getenv, @Value with a default left out')
  ok(rd('ruby', 'ruby', "ENV['A'] || ENV.fetch(\"B\")") === 'A:env B:env', 'reads (Ruby): ENV[], ENV.fetch')
  ok(rd('rust', 'rust', 'let a = std::env::var("A"); let b = env!("B"); #[arg(long, env = "C")] x: u8') === 'A:env B:env C:env', 'reads (Rust): std::env::var, env!, clap')
  ok(rd('php', 'php', "getenv('A'); $_ENV['B']; env('C'); config('d.e');") === 'A:env B:env C:env d.e:config', 'reads (PHP): getenv, $_ENV, env(), config()')
  ok(rd('typescript', 'js', 'const a = process.env\n  .LINE_BROKEN_A\nconst b = process.env?.OPTIONAL_B\nconst c = process.env?.[\'OPTIONAL_C\']\nconst d = process.env[\'PREFIX_\' + x]') === 'LINE_BROKEN_A:env OPTIONAL_B:env OPTIONAL_C:env', 'reads (JavaScript): a line break or ?. after process.env; a name the code completes is none')
  ok(rd('python', 'python', "request.environ['HTTP_X']\nenviron['NO_OS_IMPORT']\nos.environ.get('APP_FLAG_' + name)\nos.getenv(\"OK_ONE\")\n") === 'OK_ONE:env', 'reads (Python): `environ` only as os.environ; a name the code completes is none')
  ok(rd('python', 'python', "from os import environ, path\nenviron['FROM_OS']\nrequest.environ['HTTP_X']\n") === 'FROM_OS:env', 'reads (Python): a bare environ imported from os')
  ok(rd('go', 'go', '&cli.StringFlag{Name: "port", EnvVars: []string{"APP_PORT", "PORT"}}\ncli.StringFlag{EnvVar: "LEGACY_PORT"}') === 'LEGACY_PORT:env APP_PORT:env PORT:env', 'reads (Go): urfave/cli EnvVars and EnvVar')
  ok(declKind('prisma/schema.prisma') === 'prisma' && configOfDecl('prisma', 'datasource db {\n  // url = env("NOPE")\n  url = env("DATABASE_URL")\n}\n').map((r) => `${r.key}:${r.role}:${r.line}`).join() === 'DATABASE_URL:read:3', 'a Prisma schema: env("X") read, a comment not')
  ok(rd('csharp', 'csharp', 'Environment.GetEnvironmentVariable("A"); _configuration["Jwt:Key"]; c.GetValue<int>("Port")') === 'A:env Jwt:Key:config Port:config', 'reads (C#): GetEnvironmentVariable, IConfiguration')

  const g = parseContract('graphql', 'type Query { "d" user(id: ID!, name: String = "canary-unit-8"): User @deprecated(reason: "canary-unit-9") }\nextend type Query { me: User }\nquery Q { user(id: 1) { name } }\n')
  ok(g.symbols.map((s) => `${s.kind} ${s.qualname}`).join(', ') === 'type Query, field Query.user, field Query.me, operation Q', `GraphQL: types, fields (an extension's too), operations (${g.symbols.map((s) => s.qualname).join(', ')})`)
  ok(g.symbols.find((s) => s.name === 'me').container === 'Query' && g.symbols.find((s) => s.name === 'me').parent === -1, 'GraphQL: an extension\'s field attaches to the type it extends')
  ok(!JSON.stringify(g).includes('canary') && g.symbols[1].signature === 'user(id: ID!, name: String = "…"): User @deprecated(reason: "…")', `GraphQL: a signature with no literal's text (${g.symbols[1].signature})`)
  ok(g.refs.map((r) => `${r.qual}.${r.name}`).join(' ') === 'Query.user Query.user.name', 'GraphQL: an operation\'s selections, with their paths')
  const p = parseContract('proto', 'syntax = "proto3";\nimport "a/b.proto";\nservice S { rpc Get(Req) returns (Res); }\nmessage Req { string id = 1 [default = "canary-unit-10"]; message In { int32 x = 1; } }\nenum E { A = 0; }\n')
  ok(p.symbols.map((s) => `${s.kind} ${s.qualname}`).join(', ') === 'interface S, method S.Get, type Req, field Req.id, type Req.In, field Req.In.x, enum E', `protobuf: services, rpcs, messages (nested), fields, enums (${p.symbols.map((s) => `${s.kind} ${s.qualname}`).join(', ')})`)
  ok(p.imports.map((i) => i.source).join() === 'a/b.proto' && !JSON.stringify(p).includes('canary'), 'protobuf: imports kept, no literal\'s text')
  // a block string's only escape is \""": a lone backslash is literal, so a description never parses as fields
  const bs = parseContract('graphql', 'type Query {\n  """ path C:\\\\""" canarysec600: Int """\n  f: Int\n  """ a \\ b """ g: Int\n  """\n  x\\\n  y\n  """\n  h: Int\n}\n')
  ok(bs.symbols.map((s) => `${s.qualname}:${s.line}`).join(' ') === 'Query:1 Query.f:3 Query.g:4 Query.h:9' && !/canarysec/.test(JSON.stringify(bs)), `GraphQL: \\""" inside a block string escapes, any other backslash is literal; the lines after one are counted (${bs.symbols.map((s) => `${s.qualname}:${s.line}`).join(' ')})`)
  // linear and capped: a hostile file parses in its length
  const t0 = Date.now()
  parseContract('graphql', `type T { ${'a: [[[[[['.repeat(20000)} }`)
  parseContract('graphql', '{'.repeat(50000))
  parseContract('proto', `message M { ${'repeated string a = 1 ['.repeat(20000)} }`)
  ok(Date.now() - t0 < 3000, `hostile contracts parse in bounded time (${Date.now() - t0} ms)`)
}

const { findDeps } = await import('../lib/deps.mjs')
if (!findDeps()) {
  if (process.env.CI) { console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)'); process.exit(1) }
  console.log(`   - skipped the rest: parser runtime not installed (npm ci --prefix tools/graph)\n\n${PASS} passed, ${FAIL} failed`)
  process.exit(FAIL ? 1 : 0)
}
const { call } = await import('../lib/commands.mjs')
const { renderGraph } = await import('../lib/render.mjs')
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-config-')))

// ── 2 · fixtures/config ──
console.log('\n2 · configuration keys (fixtures/config)')
const C = path.join(SANDBOX, 'config')
cpSync(path.join(HERE, 'fixtures', 'config'), C, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
// credential files the index must never read: their names and values stay out of every answer
writeFileSync(path.join(C, '.env'), 'SECRET_ONLY_IN_DOTENV=canary-dotenv-1\n')
writeFileSync(path.join(C, '.env.local'), 'LOCAL_ONLY_KEY=canary-dotenv-2\n')
writeFileSync(path.join(C, 'credentials.yml'), 'environment:\n  CRED_ONLY_KEY: canary-dotenv-3\n')
git(C, 'init', '-q', '-b', 'main'); commit(C, 'init')
const cq = (tool, args = {}) => call(`graph_${tool}`, args, { root: C })
const answers = [await cq('index')]
const ask = async (tool, args = {}) => { const a = await cq(tool, args); answers.push(a); return a }
{
  const list = await ask('config')
  has(list, 'AUTH_JWT_SECRET  env  read 1 · declared 1 (env template) · sets auth.secret', 'list: an env var read, declared in the template, setting a config path')
  has(list, 'DATABASE_URL  env  read 1 · declared 2 (env template, compose)', 'list: declarations from the template and the compose file')
  has(list, 'auth.secret  config  read 1 · declared 1 (registerAs) · set from AUTH_JWT_SECRET', 'list: a registerAs key, read through ConfigService.get, set from the env var')
  has(list, 'extra.apiUrl  config  read 1 · declared 1 (app.json)', 'list: an Expo extra key read through Constants.expoConfig, declared in app.json')
  has(list, 'app.mail.host  config  read 1 · declared 1 (application.properties) · set from MAIL_HOST', 'list: a Spring key read by @Value (its default left out), declared and mapped in application.properties')
  has(list, 'Read but declared nowhere the index reads', 'list: the keys read but declared nowhere')
  has(list, '  MISSING_ONE  env  src/db.ts:5', '… a read the templates do not declare')
  has(list, 'Declared but read nowhere in the index', 'list: the keys declared but read nowhere')
  has(list, '  UNUSED_FLAG  env  .env.example:4  env template', '… a template name no code reads')
  has(list, '  QUEUE_NAME  env  docker-compose.yml:12  compose', '… a compose name no code reads')
  has(list, 'Declared only by a CI workflow (2): the workflow\'s steps read it\n  CI_TOKEN  env  .github/workflows/ci.yml:9  workflow\n  NODE_ENV  env  .github/workflows/ci.yml:4  workflow', '… a name only a workflow declares, listed apart: its steps read it')
  has(list, 'A framework\'s own settings (1): read by the framework, not the code\n  server.port  config  java/application.properties:3', '… a framework\'s own namespace (Spring\'s server.*), listed apart')
  lacks(list.split('Declared but read nowhere')[1].split('Declared only')[0], 'NODE_ENV', '… neither of them as read nowhere')
  has(list, 'PY_LOCAL_FLAG  env  py/envutil.py:8', 'a one-hop env helper (`def env_flag(name): … os.environ.get(name)`): its call with a literal name is a read')
  has(list, 'PY_FEATURE_FLAG  env  py/feature.py:3', '… called from a file importing it too')
  has(list, 'SHADOW_DATABASE_URL  env  prisma/schema.prisma:4', 'a Prisma schema\'s env("X") is a read')
  for (const k of ['PY_PREFIX_', 'HTTP_X_CANARY_HDR', 'IN_A_PRISMA_COMMENT', '@env_flag']) lacks(list, k, `list: no ${k} (a name the code completes, a request's WSGI environ, a comment, a helper's own row)`)
  const fx = await ask('config', { key: 'auth.expiresIn' })
  has(fx, 'src/auth/token.ts:5  in ttl  registerAs factory', 'a registerAs factory called and read (`(authConfig() as T).expiresIn`) reads auth.expiresIn')
  for (const k of ['APP_DB_URL  env  read 1', 'APP_DEBUG  env  read 1', 'LEGACY_TOKEN  env  read 1', 'GO_PORT  env  read 1', 'GO_HOST  env  read 1', 'JAVA_OPTS_X  env  read 1', 'RUBY_KEY  env  read 1', 'RUBY_FETCH  env  read 1', 'RUST_LOG_LEVEL  env  read 1', 'EXPO_PUBLIC_SENTRY_DSN  env  read 1', 'REDIS_URL  env  read 1', 'POOL_SIZE  env  read 1', 'AWS_REGION  env  read 1', 'PY_FALLBACK  env  read 1']) has(list, k, `list: ${k.split(' ')[0]}`)
  for (const k of ['IN_A_COMMENT', 'NOT_IN_A_DOCSTRING', 'IN_A_PY_COMMENT', 'NOT_A_KEY', 'SECRET_ONLY_IN_DOTENV', 'LOCAL_ONLY_KEY', 'CRED_ONLY_KEY', 'model_config', 'APP_MODEL_CONFIG']) lacks(list, k, `list: no ${k} (a comment, a docstring, a block scalar, a credential file, a settings class's config)`)
  const one = await ask('config', { key: 'AUTH_JWT_SECRET' })
  has(one, 'Read by (1):\n  src/config/auth.config.ts:4  in authConfig  process.env', 'one key: who reads it, path:line (inside the config factory registerAs wraps: a definition of its own)')
  has(one, 'auth.secret  config  src/config/auth.config.ts:4  registerAs: read by 1\n    src/auth/jwt.strategy.ts:7  in JwtStrategy.secretKey  ConfigService.get', 'one key: followed through registerAs to the definition that reads the config path')
  has(one, 'Declared in (1):\n  .env.example:2  env template', 'one key: where it is declared')
  const path_ = await ask('config', { key: 'auth.refresh.ttl' })
  has(path_, 'src/auth/jwt.strategy.ts:11  in JwtStrategy.refreshTtl  ConfigService.get', 'a nested registerAs key, read through getOrThrow')
  has(path_, 'REFRESH_TTL  env  src/config/auth.config.ts:6  registerAs', '… set from the env var its leaf reads')
  has(await ask('config', { key: 'APP_*' }), 'APP_DB_URL  env', 'a * pattern lists the matching keys')
  ok((await ask('config', { kind: 'config' })).split('\n').filter((l) => /^ {2}\S+ {2}env /.test(l)).length === 0, 'kind: config lists no env var')

  const imp = await ask('impact', { target: 'AUTH_JWT_SECRET' })
  has(imp, 'Impact of the configuration key AUTH_JWT_SECRET', 'impact on a key no definition holds: the config answer')
  has(imp, 'src/auth/jwt.strategy.ts:7  in JwtStrategy.secretKey  ConfigService.get', '… down to the code that reads the config path it sets')
  has(imp, 'guard:15  d1 [typed]', '… and what reaches that code')
  const d = await ask('impact', { target: 'JwtStrategy.secretKey' })
  has(d, 'Configuration it reads (1 key(s)', 'impact on a definition: the keys it reads')
  has(d, 'auth.secret  config  src/auth/jwt.strategy.ts:7  ConfigService.get', '… each with its path:line')
  const db = await ask('impact', { target: 'DATABASE_URL' })
  lacks(db, 'src/db.ts  :3', 'mentions: a line the config index explains is not repeated')
  lacks(db, 'docker-compose.yml  :', 'mentions: … nor a declaration it holds')
  // a refresh: a template edited, a compose file removed
  writeFileSync(path.join(C, '.env.example'), readFileSync(path.join(C, '.env.example'), 'utf8') + 'NEW_TEMPLATE_KEY=canary-cfg-value-12\n')
  unlinkSync(path.join(C, 'docker-compose.yml'))
  const after = await ask('config')
  has(after, 'NEW_TEMPLATE_KEY  env  read 0 · declared 1 (env template)', 'refresh: a name added to the template is picked up by the next query')
  lacks(after, 'QUEUE_NAME', 'refresh: a removed compose file takes its names with it')
  const st = await ask('status')
  has(st, 'configuration keys: ', 'status: the configuration keys counted')
}

// ── 3 · the canary ──
console.log('\n3 · no value reaches an answer, the page or the index')
{
  for (const a of [await cq('search', { query: 'connect' }), await cq('file', { path: 'src/config/auth.config.ts' }), await cq('sql', { sql: 'SELECT * FROM config' }), await cq('sql', { sql: 'SELECT * FROM config_inputs' }), await cq('sql', { sql: 'SELECT * FROM nodes' }), await cq('sql', { sql: 'SELECT * FROM refs' }), await cq('impact', { target: 'connect' }), await cq('impact', { target: 'NODE_ENV' }), await cq('config', { key: 'CI_TOKEN' }), await cq('overview')]) answers.push(a)
  answers.push(await renderGraph({ dbPath: path.join(C, '.grimoire/graph/graph.db') }))
  const leaked = answers.flatMap((a) => a.match(/canary-[a-z]+-[a-z]*-?\d+|CANARY_CFG_SECRET|SECRET_ONLY_IN_DOTENV|LOCAL_ONLY_KEY|CRED_ONLY_KEY/g) || [])
  ok(!leaked.length, `no answer and no page shows a value (an env template's, a compose file's, a workflow's, app.json's, a literal in code) or a credential file's name (${leaked.length ? [...new Set(leaked)].join(', ') : 'none'})`)
  const dir = path.join(C, '.grimoire/graph')
  const bytes = readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()).flatMap((f) => (readFileSync(path.join(dir, f.name), 'latin1').match(/canary-(cfg|dotenv)-[a-z]*-?\d+|CANARY_CFG_SECRET|SECRET_ONLY_IN_DOTENV|LOCAL_ONLY_KEY|CRED_ONLY_KEY/g) || []).map((m) => `${f.name}: ${m}`))
  ok(!bytes.length, `no byte of the index holds a value or a credential file's name (${bytes.length ? [...new Set(bytes)].join(', ') : 'none'})`)
}

// ── 4 · fixtures/contracts ──
console.log('\n4 · API contracts (fixtures/contracts)')
const K = path.join(SANDBOX, 'contracts')
cpSync(path.join(HERE, 'fixtures', 'contracts'), K, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
// a schema past maxFileKB (512 KB) and under maxContractKB (4 MB): indexed
const big = ['type BigQuery {']
for (let i = 0; big.join('\n').length < 600 * 1024; i++) big.push(`  "${'a long description of the field, repeated so the file is large. '.repeat(2)}"\n  bigField${i}(first: Int = 10): BigType${i % 50}`)
big.push('}')
for (let i = 0; i < 50; i++) big.push(`type BigType${i} { id: ID! }`)
writeFileSync(path.join(K, 'schema/big.graphql'), big.join('\n') + '\n')
git(K, 'init', '-q', '-b', 'main'); commit(K, 'init')
const kq = (tool, args = {}) => call(`graph_${tool}`, args, { root: K })
await kq('index')
{
  const st = await kq('status')
  has(st, 'API contracts: graphql ', 'status: the contract definitions and implementation links counted')
  const f = await kq('file', { path: 'schema/schema.graphql' })
  for (const x of ['Query  type  :10', 'user  field  :12', 'Node  interface  :6', 'Role  enum  :37', 'SearchResult  type  :39', 'UserFilter  type  :41', 'DateTime  type  :45']) has(f, x, `graph_file: ${x.split('  ')[0]} is a node of the schema`)
  has(await kq('search', { query: 'schema.graphql' }), 'schema/schema.graphql  file', 'search: a contract file by its name')
  has(await kq('search', { query: 'BigType7' }), 'BigType7  type', 'a schema past maxFileKB is indexed under maxContractKB')
  has(await kq('search', { query: 'openapi.yaml' }), 'openapi.yaml  file', 'an OpenAPI document is a file node')
  const sym = await kq('symbol', { symbol: 'Query.user' })
  has(sym, 'user(id: ID!, filter: String = "…"): User', 'a field\'s signature, its default value hidden')
  const cu = await kq('callers', { symbol: 'Query.user' })
  has(cu, 'GetUser  operation  client/queries.graphql:1  [qualified]', 'an operation selecting a root field calls it')
  has(await kq('callers', { symbol: 'Post.title' }), 'GetUser  operation  client/queries.graphql:1  [qualified]', '… and the nested field, through the declared type (Query.user: User, User.posts: [Post])')
  has(await kq('callers', { symbol: 'Post.author' }), 'AuthorBits  operation', 'a fragment selects on its type condition')
  has(await kq('callers', { symbol: 'Query.me' }), 'none found', 'an extension\'s field is a field of the type it extends')
  const iu = await kq('impact', { target: 'Query.user' })
  has(iu, 'findUser:1  d1 [contract]', 'Apollo: `user: findUser` under Query implements Query.user (the function, followed by import)')
  has(iu, 'GetUser:1  d1 [qualified]', '… and the client operation selecting it reaches it')
  lacks(iu, 'api/resolvers.ts  :9', 'mentions: the resolver map\'s key, explained by its edge, is not repeated')
  const sql = (q) => kq('sql', { sql: q })
  const impl = await sql("SELECT s.qualname || ' -> ' || d.qualname || ' [' || e.confidence || ']' AS x FROM edges e JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst WHERE e.kind = 'IMPLEMENTS' ORDER BY x")
  for (const x of ['viewer -> Query.viewer [contract]', 'api/resolvers.ts -> Query.users [contract]', 'api/resolvers.ts -> Mutation.createUser [contract]', 'UserResolver.current -> Query.me [contract]', 'UserResolver.posts -> User.posts [contract]', 'User -> User [contract]',
    'UserQueries.resolve_viewer -> Query.viewer [contract-name]', 'Post.resolve_title -> Post.title [contract]', 'CreatePost -> Mutation.createPost [contract-name]', 'Query.all_posts -> Query.allPosts [contract]', 'Query -> Query [contract]', 'Post -> Post [contract]',
    'UserService -> UserService [contract]', 'UserService.GetUser -> UserService.GetUser [contract]', 'UserServiceImpl -> UserService [contract]', 'UserServiceImpl.getUser -> UserService.GetUser [contract]', 'userServer -> UserService [contract]', 'userServer.ListUsers -> UserService.ListUsers [contract]', 'User -> Node [same-file]']) has(impl, x, `implements: ${x}`)
  lacks(impl, 'UserService.helper', 'a servicer\'s method named like no rpc implements none')
  has(impl, 'Users.ListUsers -> UserService.ListUsers [contract]', 'python: a subclass of a servicer\'s subclass implements the service\'s rpcs')
  has(impl, 'getUser -> UserService.GetUser [contract]', 'node: server.addService(pkg.X.service, { getUser }) implements the rpc (its lower camel case)')
  has(impl, 'Handlers.listAll -> UserService.ListUsers [contract]', '… a value naming the implementation (`Handlers.listAll.bind(null)`)')
  lacks(impl, 'main -> UserService', '… an inline function there links nothing')
  has(impl, 'AuthorBase.resolve_author -> Post.author [contract]', 'graphene: a mixin\'s resolve_<field> resolves the field of the type deriving from it')
  const h = await kq('hierarchy', { symbol: 'proto/user.proto:8' })
  has(h, 'UserServiceImpl  class  java/UserServiceImpl.java:1  [contract]', 'hierarchy: a service\'s implementations (Java)')
  has(h, 'userServer  struct  go/server.go:5  [contract]', '… (Go, an embedded UnimplementedXServer)')
  const ig = await kq('impact', { target: 'proto/user.proto:9' })
  has(ig, 'UserServiceImpl.getUser:2  d1 [contract]', 'impact on an rpc: the methods implementing it')
  has(await sql("SELECT s.path || ' -> ' || d.path AS x FROM edges e JOIN nodes sn ON sn.id = e.src JOIN files s ON s.id = sn.file_id JOIN nodes dn ON dn.id = e.dst JOIN files d ON d.id = dn.file_id WHERE e.kind = 'IMPORTS'"), 'proto/user.proto -> proto/common.proto', 'protobuf: an import resolved to its file')
  const iUser = await kq('impact', { target: 'schema/schema.graphql:23', depth: 1 })
  has(iUser, 'proto/user.proto  :9 reference in UserService.GetUser', 'mentions in a contract file: a type used, with the definition around it')
  lacks(iUser, 'schema/schema.graphql  :2 ', 'mentions: a description\'s line is prose, not a use')
  const leak = [st, f, sym, cu, iu, impl, h, ig, iUser, await sql('SELECT * FROM nodes'), await sql('SELECT * FROM refs'), await renderGraph({ dbPath: path.join(K, '.grimoire/graph/graph.db') })].flatMap((a) => a.match(/canary-(gql|proto)-[a-z]+/g) || [])
  ok(!leak.length, `no literal of a contract file in an answer or the page (${[...new Set(leak)].join(', ') || 'none'})`)
  // the cap is configurable: under it, a large contract file is not indexed
  writeFileSync(path.join(K, 'grimoire.config.json'), '{ "graph": { "maxContractKB": 256 } }\n')
  await kq('index', { full: true })
  has(await kq('search', { query: 'BigType7' }), 'Nothing named like', 'graph.maxContractKB: a contract file over it is not indexed')
  writeFileSync(path.join(K, 'grimoire.config.json'), '{ "graph": {} }\n')
  await kq('index', { full: true })
  // graph_diff over a schema change: a field removed, still named by its resolver map
  const schema = path.join(K, 'schema/schema.graphql')
  writeFileSync(schema, readFileSync(schema, 'utf8').replace('  users(first: Int = 10): [User!]!\n', ''))
  const df = await kq('diff', { base: 'HEAD' })
  has(df, 'Query.users', 'graph_diff: a removed GraphQL field is a definition change')
  has(df, 'api/resolvers.ts', '… its resolver map still names it')
}

// ── 5 · import guesses ──
console.log('\n5 · import guesses: a method on a receiver of unknown type')
{
  const G = path.join(SANDBOX, 'guess')
  const put = (rel, s) => { mkdirSync(path.dirname(path.join(G, rel)), { recursive: true }); writeFileSync(path.join(G, rel), s) }
  put('grimoire.config.json', '{ "graph": {} }\n')
  put('app/models.py', 'class Order:\n    def save(self):\n        return 1\n')
  put('app/views.py', 'from app.models import Order\n\ndef create(form):\n    form.save()\n\ndef typed(o: Order):\n    o.save()\n')
  git(G, 'init', '-q', '-b', 'main'); commit(G, 'init')
  const gq = (tool, args = {}) => call(`graph_${tool}`, args, { root: G })
  await gq('index')
  const c = await gq('callers', { symbol: 'Order.save' })
  has(c, 'create  function  app/views.py:3  [import-guess]', 'an untyped `form.save()` in a file importing Order is an import guess')
  has(c, 'typed  function  app/views.py:6  [typed]', 'a typed receiver stays resolved')
  lacks(await gq('callers', { symbol: 'Order.save', strict: true }), 'import-guess', 'strict drops import guesses')
  has(await gq('status'), 'name guesses: 50% of 2 call links (unique-name + ambiguous + import-guess)', 'status: import guesses are counted with the name guesses')
  has(await gq('overview'), 'Order.save  method  app/models.py:2  1 callers', 'overview: most used counts only the resolved caller')
}

rmSync(SANDBOX, { recursive: true, force: true })
console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
