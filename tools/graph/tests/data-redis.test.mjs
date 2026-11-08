// ════════════════════════════════════════════════════════════════════════════
//  Tests — the data model map: a key-value cache's key space, read from the commands in code
//  (tools/graph/lib/data: readers/redis-cmd.mjs, extractors/redis-commands.mjs, redis.mjs)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/data-redis.test.mjs
//
//  Part 1, the readers, on strings and hand-built arguments:
//   1. the command reader: each command family and what TYPE answers for it, key templates from every
//      string form, a dynamic key counted and never named, fields and JSON paths, lifetimes, pub/sub,
//      streams and consumer groups, SCAN MATCH globs against templates, Lua scripts (KEYS mapped,
//      never a literal kept), FT.CREATE and FT.ALTER, a connection URL's database index only;
//      hostile and timed: a script that never closes, whitespace runs, huge argument lists
//  2. the call sites, per language, through the pinned grammars (needs the parser runtime): typed
//      methods, raw commands, pipelines and MULTI, scripts, a schema assembled by functions, test code
//      counted; hostile and timed: huge files, deep nesting, 100 000 call sites; errors by position
//  3. the key space against the model (data/redis.mjs), on hand-built facts: one store per repository
//      unless an instance is wired to both, the type conflict, lifetimes and the no-expiry lead,
//      channels and streams across repositories, an index's coverage and queries or lead, the gap
//  4. the infrastructure: Terraform, Helm values, CloudFormation and Compose forms
//
//  Part 2, through call(), on an indexed project (fixtures/redis): a Rust service on the `redis` crate
//  and a TypeScript service on `ioredis` wired to one instance by Compose through REDIS_URL →
//  graph_data, the Data tab's key-space card (escaped), graph_changes; a secret planted at runtime in a
//  SET value, an HSET value, a PUBLISH payload, a Lua literal and a connection URL, found in no output.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
process.env.GRIMOIRE_GRAPH_FRESH_MS = '0'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }
// a password in a URL, built at runtime (no credential-shaped literal in the repository)
const PW = ['p', 'w'].join('')
const timed = (fn) => { const t0 = Date.now(); const r = fn(); return [r, Date.now() - t0] }

const R = await import('../lib/data/readers/redis-cmd.mjs')
const { readCommand, template, globMatches, readLua, mapKeys, urlDb, indexDef, segments, literalPrefix } = R
// arguments as the extractor hands them
const s = (...parts) => ({ s: parts.map((p) => (typeof p === 'string' ? p : { h: p.h })) })
const L = (t) => ({ s: [t] })
const h = (name) => ({ h: name })
const X = (name = '') => ({ x: name })
const cmd = (name, ...args) => readCommand({ name, args: args.map((a) => (typeof a === 'string' ? L(a) : typeof a === 'number' ? { n: a } : a)) })
const keys = (f) => f.keys.map((k) => `${k.t}:${k.role}`)

console.log('\n1 · the command reader (readers/redis-cmd.mjs): families, templates, fields, lifetimes, messaging, scripts, indexes')
{
  // every family, and what TYPE answers for its keys
  const fam = (c, ...a) => { const f = cmd(c, 'k:1', ...a); return `${f.family}/${f.base}/${f.rw}${f.creates ? '+' : ''}` }
  eq([fam('SET', 'v'), fam('GET'), fam('HSET', 'f', 'v'), fam('HGETALL'), fam('SADD', 'm'), fam('SMEMBERS'), fam('ZADD', 1, 'm'), fam('ZRANGE', 0, -1), fam('LPUSH', 'v'), fam('LRANGE', 0, 1), fam('XADD', '*', 'f', 'v'), fam('XLEN'), fam('JSON.SET', '$', '{}'), fam('JSON.GET', '$'), fam('GEOADD', 1, 2, 'm'), fam('PFADD', 'x'), fam('SETBIT', 1, 1), fam('DEL'), fam('EXPIRE', 10), fam('INCR'), fam('LTRIM', 0, 9)],
    ['string/string/w+', 'string/string/r', 'hash/hash/w+', 'hash/hash/r', 'set/set/w+', 'set/set/r', 'zset/zset/w+', 'zset/zset/r', 'list/list/w+', 'list/list/r', 'stream/stream/w+', 'stream/stream/r', 'json/ReJSON-RL/w+', 'json/ReJSON-RL/r', 'geo/zset/w+', 'hll/string/w+', 'bitmap/string/w+', 'key/null/w', 'key/null/w', 'string/string/w+', 'list/list/w'],
    'each family: what TYPE answers (geo a sorted set, HyperLogLog and bitmap strings), reads and writes, what can create a key (never a delete, a lifetime or a trim)')
  ok(readCommand({ name: 'NOTACOMMAND', args: [] }) === null && readCommand({ name: 'set', args: [L('a:b'), L('v')] }).cmd === 'SET', 'an unknown command is none; names fold to upper case')
  // key templates from every string form: a literal, parts code fills in, named after their variable
  eq([template(L('user:1')), template(s('user:', h('user_id'), ':sessions')), template(s('user:', h('id'), ':sessions')).k, template(s(h('a'), ':', h('b'))), template(s(h('k'))), template(X('key')), template({ n: 42 }), template(s('cart:', h('a'), h('b')))],
    [{ t: 'user:1', k: 'user:1', lit: true }, { t: 'user:{user_id}:sessions', k: 'user:{}:sessions' }, 'user:{}:sessions', null, null, null, { t: '42', k: '42', lit: true }, { t: 'cart:{a}', k: 'cart:{}' }],
    'templates: each part code fills in a placeholder named after its variable, compared without the name; a key with no literal letter (`{a}:{b}`, a parameter) is dynamic; two parts side by side one')
  eq([template(s('x:', h('not a name'), ':y')).t, template(s('p', h('a'), 'q', h('b'), 'r', h('c'), 's', h('d'), 't', h('e'), 'u', h('f'), 'v', h('g'), 'w', h('h'), 'x', h('i'))), template(L('k'.repeat(300)))],
    ['x:{}:y', null, null], '… a placeholder name only when it is a name; past eight parts or 256 characters: dynamic')
  const dyn = cmd('HSET', X('key'), 'f', 'v')
  eq([dyn.keys, dyn.dyn, dyn.fields], [[], 1, ['f']], 'a wholly dynamic key is counted, never named; its literal field still read')
  // multi-key commands, their roles
  eq([keys(cmd('MGET', 'a:1', 'b:1')), keys(cmd('MSET', 'a:1', 'v', 'b:1', 'v')), keys(cmd('DEL', 'a:1', s('b:', h('id')))), keys(cmd('BLPOP', 'q:a', 'q:b', 0)), keys(cmd('SINTERSTORE', 'dst:x', 'a:x', 'b:x')), keys(cmd('ZUNIONSTORE', 'dst:z', 2, 'a:z', 'b:z')), keys(cmd('LMOVE', 'src:l', 'dst:l', 'LEFT', 'RIGHT')), keys(cmd('XREAD', 'COUNT', 10, 'STREAMS', 'ev:a', 'ev:b', '$', '$')), keys(cmd('RENAME', 'old:k', 'new:k')), keys(cmd('COPY', 'a:c', 'b:c'))],
    [['a:1:r', 'b:1:r'], ['a:1:w', 'b:1:w'], ['a:1:w', 'b:{id}:w'], ['q:a:w', 'q:b:w'], ['dst:x:w', 'a:x:r', 'b:x:r'], ['dst:z:w', 'a:z:r', 'b:z:r'], ['src:l:w', 'dst:l:w'], ['ev:a:r', 'ev:b:r'], ['old:k:w', 'new:k:w'], ['a:c:r', 'b:c:w']],
    'keys in every position: all, pairs, all but the timeout, a destination then the keys it reads, a key count, after STREAMS (the first half)')
  // hash fields, JSON paths: names, never values
  const hs = cmd('HSET', 'user:1', 'name', 'VALUE-1', 'email', s('x', h('v')), s('dyn', h('f')), 'v')
  eq([hs.fields, hs.fieldsCode, cmd('HGET', 'user:1', 'name').fields, cmd('HMGET', 'user:1', 'a', 'b').fields, cmd('HINCRBY', 'user:1', 'visits', 1).fields, cmd('HDEL', 'user:1', 'a').fields, cmd('JSON.SET', 'doc:1', '$.title', '"v"').paths, cmd('JSON.GET', 'doc:1', '$.a', '$.b').paths, cmd('JSON.SET', 'doc:1', 'notapath', 'v').paths],
    [['name', 'email'], true, ['name'], ['a', 'b'], ['visits'], ['a'], ['$.title'], ['$.a', '$.b'], undefined],
    'hash fields and JSON paths: each literal name, a field code builds noted, never a value (VALUE-1 is nowhere)')
  ok(!JSON.stringify(hs).includes('VALUE-1') && !JSON.stringify(cmd('SET', 'k:1', 'VALUE-2', 'EX', 60)).includes('VALUE-2') && !JSON.stringify(cmd('PUBLISH', 'ch:1', 'VALUE-3')).includes('VALUE-3'), 'no value is ever kept: a SET value, an HSET value, a PUBLISH payload')
  // lifetimes
  const ttl = (...a) => JSON.stringify(cmd(...a).ttl)
  eq([ttl('EXPIRE', 'k:1', 60), ttl('EXPIRE', 'k:1', X('secs')), ttl('PEXPIRE', 'k:1', 1500), ttl('SET', 'k:1', 'v', 'EX', 30), ttl('SET', 'k:1', 'v', 'PX', 500), ttl('SET', 'k:1', 'v', 'EX', '90'), ttl('SET', 'k:1', 'v', 'KEEPTTL'), ttl('SETEX', 'k:1', 10, 'v'), ttl('PSETEX', 'k:1', 2000, 'v'), ttl('GETEX', 'k:1', 'EX', 5), ttl('EXPIREAT', 'k:1', 1700000000), ttl('PERSIST', 'k:1'), ttl('SET', 'k:1', 'v'), ttl('SET', 'k:1', 'v', 'NX', 'EX', 7)],
    ['{"s":60}', '{"code":true}', '{"s":1.5}', '{"s":30}', '{"s":0.5}', '{"s":90}', '{"keep":true}', '{"s":10}', '{"s":2}', '{"s":5}', '{"code":true,"at":true}', '{"none":true}', undefined, '{"s":7}'],
    'lifetimes: the seconds when a literal number, else set in code; EXAT a time; KEEPTTL; PERSIST none; a SET with no option none said')
  // pub/sub
  eq([cmd('PUBLISH', s('chat:', h('room')), 'msg').channel, cmd('SUBSCRIBE', 'chat:lobby', 'news').channel.map((c) => c.t), cmd('PSUBSCRIBE', 'chat:*').channel[0].pattern, cmd('PUBLISH', X('ch'), 'm').dyn, cmd('UNSUBSCRIBE', 'news').channel],
    [[{ t: 'chat:{room}', k: 'chat:{}', pattern: false, role: 'pub' }], ['chat:lobby', 'news'], true, 1, undefined], 'pub/sub: channels as templates, publishers and subscribers, a pattern subscription; a channel code builds counted')
  // streams and consumer groups
  const xa = cmd('XADD', 'events:orders', 'MAXLEN', '~', 1000, '*', 'kind', 'v', 'order_id', s('', h('id')))
  const xg = cmd('XGROUP', 'CREATE', 'events:orders', 'billing', '$', 'MKSTREAM')
  const xr = cmd('XREADGROUP', 'GROUP', 'billing', s('worker-', h('n')), 'COUNT', 10, 'BLOCK', 5000, 'STREAMS', 'events:orders', '>')
  const xk = cmd('XACK', 'events:orders', 'billing', X('id'))
  eq([xa.fields, xa.stream, keys(xg), xg.stream, xg.creates, keys(xr), xr.stream.group.t, xr.stream.consumer.t, xk.stream, cmd('XGROUP', 'HELP').keys],
    [['kind', 'order_id'], { role: 'add' }, ['events:orders:w'], { role: 'group', op: 'CREATE', group: { t: 'billing', k: 'billing', lit: true }, mkstream: true }, true, ['events:orders:r'], 'billing', 'worker-{n}', { role: 'ack', group: { t: 'billing', k: 'billing', lit: true } }, []],
    'streams: an entry\'s field names past MAXLEN, a consumer group created (MKSTREAM creates the key), read by a consumer, acknowledged')
  // SCAN MATCH globs against templates
  eq([cmd('SCAN', 0, 'MATCH', 'user:*:sessions', 'COUNT', 100).glob, cmd('KEYS', 'cache:*').glob, cmd('SCAN', 0).glob, cmd('SCAN', 0, 'MATCH', X('pat')).dyn],
    [['user:*:sessions'], ['cache:*'], undefined, 1], 'SCAN … MATCH and KEYS: the glob, a read; a glob code builds counted')
  eq([globMatches('user:*:sessions', 'user:{user_id}:sessions'), globMatches('user:*', 'user:{id}:sessions'), globMatches('user:42:*', 'user:{id}:sessions'), globMatches('user:*:carts', 'user:{id}:sessions'), globMatches('cache:?', 'cache:{k}'), globMatches('cache:[ab]*', 'cache:{k}'), globMatches('cache:[ab]*', 'cache:c{k}'), globMatches('*', 'x'), globMatches('session:*', 'user:{id}')],
    [true, true, true, false, true, true, false, true, false], 'a glob matches a template when one key can be spelt by both (a placeholder holds any text of one character or more)')
  const [long, tGlob] = timed(() => globMatches('*a'.repeat(120), `{x}${'a{y}'.repeat(60)}b`))
  ok(long === false && tGlob < 2000, `a glob of 120 stars against a template of 60 placeholders: bounded (${tGlob} ms)`)
  eq([segments('user:{user_id}:sessions'), segments('plain'), literalPrefix('user:{id}:x'), literalPrefix('cfg:global')], [['user:', '{user_id}:', 'sessions'], ['plain'], 'user:', 'cfg:global'], 'the prefix tree\'s path of a template, at each `:`; a template\'s literal start')
  // a connection URL: only its database index
  eq([urlDb(`redis://:${PW}@cache:6379/2`), urlDb(`rediss://user:${PW}@h:1/0`), urlDb('redis://h'), urlDb('unix:///tmp/r.sock?db=3'), urlDb('http://h/2'), urlDb('redis://h:6379/2?x=1')], [{ db: 2 }, { db: 0 }, { db: null }, { db: 3 }, null, { db: 2 }], 'a connection URL: its database index, nothing else (user, password, host dropped)')
  eq([cmd('SELECT', 3).db, cmd('SELECT', X('n')).db], [{ n: 3 }, { code: true }], 'SELECT n: a literal database index kept')
  // the review's false facts, at the reader
  eq([keys(cmd('BITOP', 'AND', 'dst:b', 'a:b', 'c:b')), keys(cmd('BZMPOP', 5, 1, 'z:a', 'MIN')), keys(cmd('BLMPOP', 5, 2, 'l:a', 'l:b', 'LEFT')), keys(cmd('SORT', 'l:src', 'BY', 'w:*', 'STORE', 'l:dst')), cmd('SORT', 'l:src').rw],
    [['dst:b:w', 'a:b:r', 'c:b:r'], ['z:a:w'], ['l:a:w', 'l:b:w'], ['l:src:r', 'l:dst:w'], 'r'], 'BITOP\'s operation is no key; BZMPOP and BLMPOP count their keys after the timeout; SORT … STORE writes its destination')
  const spread = { spread: 'base' }
  eq([cmd('HSET', 'h:1', spread, 'name', 'SPREAD-VALUE').fields, cmd('HSET', 'h:1', 'a', 'v', X('f'), 'w', 'b', 'SPREAD-VALUE').fields, keys(cmd('MSET', 'k:a', 'v', spread, 'k:b', 'SPREAD-VALUE')), cmd('XADD', 's:1', '*', spread, 'f', 'SPREAD-VALUE').fields],
    [undefined, ['a'], ['k:a:w'], undefined], 'pairs are never read shifted: after a spread or a field code names (its width unknown), none read; a value never becomes a field or a key')
  const tagged = template(s('{cart}:', h('id')))
  eq([tagged, R.formOf(tagged.t), literalPrefix(tagged.t), globMatches('\\{cart\\}:*', tagged.t), globMatches('cart:*', tagged.t), R.formOf('cart:{id}') === R.formOf(tagged.t)],
    [{ t: '\\{cart\\}:{id}', k: '\\{cart\\}:{}' }, '\\{cart\\}:{}', '\\{cart\\}:', true, false, false], 'a cluster hash tag\'s braces are literal (escaped), never a placeholder: `{cart}:{id}` is not `cart:{id}`')
}

console.log('\n1 · Lua scripts: the commands a literal body sends, KEYS mapped, never a literal kept')
{
  const body = [
    "local key = KEYS[1]",
    "local token = 'LUA-VALUE-1' -- a literal that is no key",
    "redis.call('HSET', key, 'state', ARGV[1])",
    "redis.call('EXPIRE', KEYS[1], 300)",
    "if redis.call('EXISTS', KEYS[2]) == 1 then redis.pcall(\"INCR\", KEYS[2] .. ':count') end",
    "redis.call('SET', 'global:' .. ARGV[2], 'LUA-VALUE-2')",
    "redis.call(cmd, KEYS[1])",
    "return redis.call('ZADD', 'board', 1, token)",
  ].join('\n')
  const lua = readLua(body, 10)
  eq(lua.commands.map((c) => `${c.name}@${c.line}`), ['HSET@12', 'EXPIRE@13', 'EXISTS@14', 'INCR@14', 'SET@15', 'ZADD@17'], 'each redis.call and redis.pcall at its line; one whose command code builds noted, not read')
  ok(lua.notes.some((n) => /line 16 whose command is not a literal/.test(n)), '… and noted by position')
  const mapped = lua.commands.map((c) => readCommand({ name: c.name, args: mapKeys(c.args, [s('job:', h('job_id')), L('stats:jobs')]) }))
  eq(mapped.map((f) => f.keys.map((k) => k.t).join(',') || `dyn ${f.dyn}`), ['job:{job_id}', 'job:{job_id}', 'stats:jobs', 'stats:jobs:count', 'global:{ARGV2}', 'board'], 'KEYS[n] mapped to the call\'s key arguments (a local of KEYS[1] too, a concatenation, a literal key)')
  eq([mapped[0].fields, mapped[1].ttl], [['state'], { s: 300 }], '… the field names and lifetimes the script sets')
  const unmapped = readCommand({ name: lua.commands[0].name, args: mapKeys(lua.commands[0].args, null) })
  eq([unmapped.keys, unmapped.dyn], [[], 1], 'keys unknown (the call\'s keys not literal): its keys counted, never named')
  ok(!JSON.stringify([mapped, lua.notes]).includes('LUA-VALUE'), 'no literal of the body is kept but command names, keys and fields')
  // hostile: a body that never closes, a long bracket that never closes, whitespace runs
  const [open, t1] = timed(() => readLua("redis.call('SET', KEYS[1], " + "'x', ".repeat(50000)))
  ok(open.commands.length === 0 && open.notes.some((n) => /never closes/.test(n)) && t1 < 2000, `a redis.call that never closes: not read, said (${t1} ms)`)
  const [bracket, t2] = timed(() => readLua("--[[ " + 'a\n'.repeat(100000) + "redis.call('GET', KEYS[1])"))
  ok(bracket.commands.length === 0 && t2 < 2000, `a long comment that never closes: the rest is comment (${t2} ms)`)
  const [blank, t3] = timed(() => readLua(' '.repeat(200000) + "redis.call('GET', KEYS[1])" + '\t'.repeat(200000)))
  ok(blank.commands.length === 1 && t3 < 2000, `whitespace runs of 200 000: linear (${t3} ms)`)
  const [many, t4] = timed(() => readLua("redis.call('INCR', KEYS[1])\n".repeat(5000)))
  ok(many.commands.length === R.MAX_LUA && t4 < 2000, `5 000 calls in a body: the first ${R.MAX_LUA} read (${t4} ms)`)
  const [huge, t5] = timed(() => readLua('x'.repeat(R.MAX_LUA_TEXT + 10) + "redis.call('GET', KEYS[1])"))
  ok(huge.commands.length === 0 && huge.notes.some((n) => /past 256 KB/.test(n)) && t5 < 2000, `a body past 256 KB: its end not read, said (${t5} ms)`)
  // the script call itself
  const ev = cmd('EVAL', L('return 1'), 2, s('job:', h('id')), 'stats:jobs', 'arg')
  eq([keys(ev), ev.script, cmd('EVALSHA', X('sha'), X('n'), 'a:b').keysUnknown], [['job:{id}:w', 'stats:jobs:w'], { kind: 'eval', keysKnown: true }, true], 'EVAL: its keys after the key count; a key count code computes leaves them unknown')
}

console.log('\n1 · search indexes: FT.CREATE and FT.ALTER read, FT.SEARCH and FT.AGGREGATE as queries')
{
  const create = cmd('FT.CREATE', 'idx:users', 'ON', 'HASH', 'PREFIX', 2, 'user:', 'admin:', 'FILTER', '@age > 18', 'LANGUAGE', 'english', 'SCHEMA', 'name', 'TEXT', 'WEIGHT', '2.0', 'SORTABLE', 'email', 'TAG', 'SEPARATOR', ',', 'CASESENSITIVE', 'age', 'NUMERIC', 'SORTABLE', 'UNF', 'loc', 'GEO', 'vec', 'VECTOR', 'HNSW', 6, 'TYPE', 'FLOAT32', 'DIM', 4, 'DISTANCE_METRIC', 'COSINE', 'NOINDEX')
  eq(create.index, { name: 'idx:users', k: 'idx:users', role: 'create', def: { on: 'HASH', prefixes: ['user:', 'admin:'], schema: [{ name: 'name', type: 'TEXT', opts: ['WEIGHT 2.0', 'SORTABLE'] }, { name: 'email', type: 'TAG', opts: ['SEPARATOR ,', 'CASESENSITIVE'] }, { name: 'age', type: 'NUMERIC', opts: ['SORTABLE', 'UNF'] }, { name: 'loc', type: 'GEO', opts: [] }, { name: 'vec', type: 'VECTOR', opts: ['HNSW', 'NOINDEX'] }], filter: true } },
    'FT.CREATE: the name, ON HASH, the PREFIX list, each schema field with its type and options (a VECTOR\'s attributes skipped); a FILTER said set, its expression never kept')
  ok(!JSON.stringify(create).includes('@age'), '… the FILTER\'s text kept nowhere')
  const json = cmd('FT.CREATE', 'idx:docs', 'ON', 'JSON', 'PREFIX', 1, 'doc:', 'SCHEMA', '$.title', 'AS', 'title', 'TEXT', '$.tags[*]', 'AS', 'tags', 'TAG')
  eq(json.index.def, { on: 'JSON', prefixes: ['doc:'], schema: [{ name: '$.title', type: 'TEXT', opts: [], as: 'title' }, { name: '$.tags[*]', type: 'TAG', opts: [], as: 'tags' }] }, 'ON JSON: each JSON path and its alias')
  const built = cmd('FT.CREATE', 'idx:built', 'ON', 'JSON', 'PREFIX', 1, 'b:', 'SCHEMA', '$.a', 'AS', 'a', 'TEXT', { spread: 'fields' })
  eq([built.index.def.schema.map((x) => x.name), built.index.def.assembled], [['$.a'], 'spread'], 'a schema assembled by code: the fields read from its literal pushes, the rest said assembled in code')
  const alter = cmd('FT.ALTER', 'idx:users', 'SKIPINITIALSCAN', 'SCHEMA', 'ADD', 'nick', 'TAG')
  eq([alter.index.role, alter.index.def.schema], ['alter', [{ name: 'nick', type: 'TAG', opts: [] }]], 'FT.ALTER … SCHEMA ADD: the fields added')
  eq([cmd('FT.SEARCH', 'idx:users', '@name:QUERY-VALUE').index, cmd('FT.AGGREGATE', 'idx:users', '*', 'GROUPBY', 1, '@age').index.role, cmd('FT.PROFILE', 'idx:users', 'AGGREGATE', 'QUERY', '*').index.as, cmd('FT.SEARCH', X('name'), 'q').dyn, cmd('FT.ALIASADD', 'users', 'idx:users').index.alias],
    [{ name: 'idx:users', k: 'idx:users', role: 'search' }, 'aggregate', 'aggregate', 1, 'users'], 'FT.SEARCH and FT.AGGREGATE: the index queried, the query never kept; an index code names counted; an alias')
  ok(!JSON.stringify(cmd('FT.SEARCH', 'idx:users', '@name:QUERY-VALUE')).includes('QUERY-VALUE'), '… no query text anywhere')
  const [wide, tw] = timed(() => indexDef([L('ON'), L('HASH'), L('SCHEMA'), ...Array.from({ length: 4000 }, (_, i) => [L(`f${i}`), L('TEXT')]).flat()]))
  ok(wide.schema.length === R.MAX_FIELDS && wide.past > 0 && tw < 1000, `a schema of 4 000 fields: the first ${R.MAX_FIELDS} kept, the rest counted (${tw} ms)`)
  const [junk, tj] = timed(() => indexDef(Array.from({ length: 100000 }, () => L('SORTABLE'))))
  ok(junk.noSchema === true && tj < 1000, `100 000 option words and no SCHEMA: bounded (${tj} ms)`)
}

// ════ 2 · the call sites, per language (the parser runtime) ════
const deps = await import('../lib/deps.mjs')
const RT = deps.findDeps() ? await deps.loadRuntime({ install: false }) : null
const PS = {}
if (RT) for (const l of ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust']) PS[l] = await RT.parserFor(l)
const CTX = { tree: (lang, t) => PS[lang].parse(t) }
const { default: redisEx, redisLevel, typedCommand } = await import('../lib/data/extractors/redis-commands.mjs')
const readFile = (file, lines) => redisEx.extract(lines.join('\n'), file, CTX).redis
// a site in brief: line, function, command, keys (role), how the receiver is known
const brief = (r) => r.sites.map((x) => `${x.line} ${r.fns[x.fn]?.name ?? '-'} ${x.cmd} ${x.keys.map((k) => `${k.t}:${k.role}`).join(',') || (x.dyn ? `dyn${x.dyn}` : '')} ${x.how}${x.batch ? ` ${x.batch}` : ''}${x.via ? ` ${x.via}` : ''}`.trim())
if (!RT) {
  if (process.env.CI) { FAIL++; console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)') } else console.log('\n   - section 2 skipped: parser runtime not installed (npm ci --prefix tools/graph)')
} else {
  console.log('\n2 · the call sites: TypeScript and JavaScript (ioredis, node-redis, @upstash/redis)')
  eq([typedCommand('hSet'), typedCommand('xGroupCreate'), typedCommand('json_set'), typedCommand('set', 'json'), typedCommand('JSONSet'), typedCommand('FTSearch'), typedCommand('scan_iter'), typedCommand('hset_multiple'), typedCommand('frobnicate')],
    [{ cmd: 'HSET', norm: 'hset' }, { cmd: 'XGROUP', norm: 'xgroupcreate' }, { cmd: 'JSON.SET', norm: 'jsonset' }, { cmd: 'JSON.SET', norm: 'set' }, { cmd: 'JSON.SET', norm: 'jsonset' }, { cmd: 'FT.SEARCH', norm: 'ftsearch' }, { cmd: 'SCAN', norm: 'scaniter' }, { cmd: 'HSET', norm: 'hsetmultiple' }, null],
    'a typed method\'s command: camelCase, snake_case and PascalCase alike, a namespace (json, ft), a prefix (json_, FT)')
  const ts = readFile('web/src/cache.ts', [
    "import Redis from 'ioredis'",
    "const PREFIX = 'user:'",
    "const redis = new Redis(process.env.REDIS_URL!)",
    'export async function saveSession(userId: string, sid: string, data: string) {',
    '  await redis.hset(`${PREFIX}${userId}:session`, { token: data, ip: data })',
    "  await redis.expire(`${PREFIX}${userId}:session`, 3600)",
    "  await redis.set('cache:' + sid, data, 'EX', 60)",
    "  await redis.sadd(`sessions:${userId}`, sid)",
    '}',
    'export async function readSession(userId: string) {',
    '  const m = new Map<string, string>(); m.get(userId); m.set(userId, "x")',
    '  return redis.hgetall(`user:${userId}:session`)',
    '}',
    'export const board = async (id: string) => {',
    "  await redis.pipeline().zadd('board:daily', 1, id).zincrby('board:daily', 1, id).expire('board:daily', 86400).exec()",
    "  await redis.multi().incr(`hits:${id}`).exec()",
    "  await redis.publish('chat:lobby', id)",
    "  await redis.call('JSON.SET', `doc:${id}`, '$.title', '\"t\"')",
    "  await redis.xadd('events:orders', '*', 'kind', 'created', 'id', id)",
    "  await redis.xgroup('CREATE', 'events:orders', 'billing', '$', 'MKSTREAM')",
    "  await redis.xreadgroup('GROUP', 'billing', 'worker-1', 'COUNT', 10, 'STREAMS', 'events:orders', '>')",
    "  await redis.get(key)",
    '}',
  ])
  eq(brief(ts), [
    '5 saveSession HSET user:{userId}:session:w bound', '6 saveSession EXPIRE user:{userId}:session:w bound', '7 saveSession SET cache:{sid}:w bound', '8 saveSession SADD sessions:{userId}:w bound',
    '12 readSession HGETALL user:{userId}:session:r bound',
    '15 board ZADD board:daily:w bound pipeline', '15 board ZINCRBY board:daily:w bound pipeline', '15 board EXPIRE board:daily:w bound pipeline', '16 board INCR hits:{id}:w bound multi',
    '17 board PUBLISH  bound', '18 board JSON.SET doc:{id}:w bound', '19 board XADD events:orders:w bound', '20 board XGROUP events:orders:w bound', '21 board XREADGROUP events:orders:r bound', '22 board GET dyn1 bound',
  ], 'ioredis: a client bound to its constructor, a same-file constant, template literals, a concatenation, a pipeline and MULTI (each command), a raw call, streams; a Map\'s get and set are none')
  eq([ts.sites[0].fields, ts.sites[1].ttl, ts.sites[2].ttl, ts.sites[9].channel, ts.sites[10].paths, ts.sites[11].fields, ts.sites[13].stream.group.t, ts.env, ts.clients], [['token', 'ip'], { s: 3600 }, { s: 60 }, [{ t: 'chat:lobby', k: 'chat:lobby', pattern: false, role: 'pub' }], ['$.title'], ['kind', 'id'], 'billing', [{ name: 'REDIS_URL', line: 3 }], [{ source: 'ioredis', client: 'ioredis', line: 1 }]],
    '… an object literal\'s keys as hash fields, lifetimes, a channel, a JSON path, a stream entry\'s fields, its consumer group, the environment variable it reads, its client')
  const nr = readFile('web/src/node.ts', [
    "import { createClient, SchemaFieldTypes } from 'redis'",
    `export const client = createClient({ url: 'redis://:${PW}@cache:6379/2', database: 2 })`,
    'export async function run(id: string, ch: string) {',
    "  await client.hSet(`item:${id}`, 'name', 'x')",
    "  await client.set(`lock:${id}`, '1', { EX: 30, NX: true })",
    "  await client.json.set(`doc:${id}`, '$', { a: 1 })",
    "  await client.ft.create('idx:items', { name: SchemaFieldTypes.TEXT, '$.tags': { type: SchemaFieldTypes.TAG, AS: 'tags' } }, { ON: 'JSON', PREFIX: 'item:' })",
    "  await client.ft.search('idx:items', '@name:x')",
    "  await client.xAdd('jobs', '*', { kind: 'k' })",
    "  await client.xGroupCreate('jobs', 'workers', '0', { MKSTREAM: true })",
    "  await client.xReadGroup('workers', 'w1', { key: 'jobs', id: '>' })",
    "  await client.subscribe('news', (m) => {})",
    "  await client.sendCommand(['HSET', `item:${id}`, 'price', '1'])",
    "  for await (const k of client.scanIterator({ MATCH: 'item:*', COUNT: 100 })) {}",
    '}',
  ])
  eq(brief(nr), ['4 run HSET item:{id}:w bound', '5 run SET lock:{id}:w bound', '6 run JSON.SET doc:{id}:w bound', '7 run FT.CREATE  bound', '8 run FT.SEARCH  bound', '9 run XADD jobs:w bound', '10 run XGROUP jobs:w bound', '11 run XREADGROUP jobs:r bound', '12 run SUBSCRIBE  bound', '13 run HSET item:{id}:w bound', '14 run SCAN  bound'],
    'node-redis: camelCase methods, the json and ft namespaces, sendCommand\'s array, scanIterator')
  eq([nr.sites[1].ttl, nr.sites[3].index.def, nr.sites[4].index, nr.sites[6].stream, nr.sites[7].stream, nr.sites[8].channel.map((c) => c.t), nr.sites[9].fields, nr.sites[10].glob, nr.dbs],
    [{ s: 30 }, { on: 'JSON', prefixes: ['item:'], schema: [{ name: 'name', type: 'TEXT', opts: [] }, { name: '$.tags', type: 'TAG', opts: [], as: 'tags' }] }, { name: 'idx:items', k: 'idx:items', role: 'search' }, { role: 'group', op: 'CREATE', group: { t: 'workers', k: 'workers', lit: true }, mkstream: true }, { role: 'read', group: { t: 'workers', k: 'workers', lit: true }, consumer: { t: 'w1', k: 'w1', lit: true } }, ['news'], ['price'], ['item:*'], [{ db: 2, line: 2, how: 'url' }, { db: 2, line: 2, how: 'option' }]],
    '… { EX } options, ft.create\'s schema object, xReadGroup\'s { key, id }, a subscriber\'s callback no channel, a connection URL\'s database index only (never its password), a database option')
  ok(!JSON.stringify(nr).includes(`:${PW}@`) && !JSON.stringify(nr).includes('@name:x'), '… no URL and no query text kept')
  const up = readFile('edge/kv.ts', [
    "import { Redis } from '@upstash/redis'",
    'const kv = Redis.fromEnv()',
    "export const hit = (ip: string) => kv.set(`rate:${ip}`, 1, { ex: 60 })",
    "export const save = (id: string) => kv.hset(`cart:${id}`, { items: '[]' })",
    "export const run = (id: string) => kv.eval(\"return redis.call('INCR', KEYS[1])\", [`count:${id}`], [])",
  ])
  eq(brief(up), ['3 hit SET rate:{ip}:w bound', '4 save HSET cart:{id}:w bound', '5 run EVAL count:{id}:w bound', '5 run INCR count:{id}:w bound lua'], '@upstash/redis: Redis.fromEnv(), { ex } options, eval with its keys array: the script\'s command on its mapped key')
  eq([up.sites[0].ttl, up.sites[1].fields], [{ s: 60 }, ['items']], '… its lifetime and fields')
  // a receiver known by its name, its type, an import from a module naming the store; never a Map
  const by = readFile('api/repo.ts', [
    "import { getRedis } from '../lib/redis'",
    "import type { Redis } from 'ioredis'",
    'export class Repo {',
    '  constructor(private readonly cache: Redis) {}',
    "  async a(id: string) { await this.cache.hget(`p:${id}`, 'name') }",
    "  async b(id: string) { const r = getRedis(); await r.get(`p:${id}:v`) }",
    "  async c(id: string) { await getRedis().del(`p:${id}`) }",
    "  async d(store: Map<string, string>, id: string) { store.get(id); store.set(id, 'x'); store.delete(id) }",
    '}',
  ])
  eq(brief(by), ['5 Repo.a HGET p:{id}:r typed', '6 Repo.b GET p:{id}:v:r bound', '7 Repo.c DEL p:{id}:w bound'], 'a receiver typed as a client, bound to a handle a module naming the store exports, its call; a Map is none')
  const loose = readFile('lib/other.ts', ["import Redis from 'ioredis'", 'export function f(x: any, k: string) { x.hset(`h:${k}`, "f", 1); x.get(k); x.publish("c", 1) }'])
  eq(brief(loose), ['2 f HSET h:{k}:w command'], 'in a file importing a client, a command only the protocol has on any receiver; never a shared name (get, publish) on an unknown one')
  eq(readFile('lib/none.ts', ['export function f(x: any) { x.hset("h:1", "f", 1) }']), undefined, 'no client, no binding, no module naming the store: nothing read')
  // a command assembled in steps; a schema assembled by functions
  const asm = readFile('web/src/search.ts', [
    "import Redis from 'ioredis'",
    'const redis = new Redis()',
    "const BASE = ['title', 'TEXT', 'SORTABLE']",
    'function extraFields(): string[] {',
    "  const f: string[] = ['tags', 'TAG']",
    "  f.push('price', 'NUMERIC')",
    '  return f',
    '}',
    'export async function createIndex(dynamicFields: string[]) {',
    "  const args = ['FT.CREATE', 'idx:products', 'ON', 'HASH', 'PREFIX', '1', 'product:', 'SCHEMA', ...BASE]",
    '  args.push(...extraFields())',
    '  args.push(...dynamicFields)',
    '  await redis.call(...args)',
    '}',
  ])
  eq([brief(asm), asm.sites[0].index.def], [['10 createIndex FT.CREATE  builder'], { on: 'HASH', prefixes: ['product:'], schema: [{ name: 'title', type: 'TEXT', opts: ['SORTABLE'] }, { name: 'tags', type: 'TAG', opts: [] }, { name: 'price', type: 'NUMERIC', opts: [] }], assembled: 'spread' }],
    'a command assembled in steps: an array starting with FT.CREATE, a same-file constant spread in, a function\'s literal pushes; what code builds said assembled')
  // test code counted, not read
  const tst = readFile('web/src/cache.test.ts', ["import Redis from 'ioredis'", 'const r = new Redis()', "test('x', async () => { await r.hset('t:1', 'a', 1) })"])
  eq([tst.sites.length, tst.tests], [0, 1], 'test code: counted, not read')

  console.log('\n2 · the call sites: Rust (redis, fred, the pools)')
  const rs = readFile('api/src/sessions.rs', [
    'use redis::AsyncCommands;',
    'const SESSIONS: &str = "sessions";',
    'pub struct Store { conn: redis::aio::ConnectionManager }',
    'impl Store {',
    '    pub async fn save(&mut self, user_id: &str, token: &str) -> redis::RedisResult<()> {',
    '        let key = format!("user:{}:session", user_id);',
    '        self.conn.hset::<_, _, _, ()>(format!("user:{}:session", user_id), "token", token).await?;',
    '        self.conn.expire::<_, ()>(format!("user:{user_id}:session"), 1800).await?;',
    '        self.conn.set_ex::<_, _, ()>(format!("otp:{}", user_id), token, 300).await?;',
    '        self.conn.sadd::<_, _, ()>(SESSIONS, user_id).await?;',
    '        let _: () = self.conn.hset(&key, "ip", token).await?;',
    '        Ok(())',
    '    }',
    '}',
    'pub async fn raw(client: &redis::Client, id: u64) -> redis::RedisResult<()> {',
    '    let mut con = client.get_multiplexed_async_connection().await?;',
    '    redis::cmd("HSET").arg(format!("order:{}", id)).arg("status").arg("new").query_async::<()>(&mut con).await?;',
    '    redis::pipe().atomic().cmd("ZADD").arg("orders:by_time").arg(1).arg(id).ignore().expire("orders:by_time", 60).ignore().query_async::<()>(&mut con).await?;',
    '    let v: Option<String> = con.get(format!("order:{}:cache", id)).await?;',
    '    let _: () = con.xadd("events:orders", "*", &[("kind", "created"), ("id", "1")]).await?;',
    '    let _: () = con.publish("chat:lobby", "hi").await?;',
    '    let map = std::collections::HashMap::<u8, u8>::new(); map.get(&1);',
    '    Ok(())',
    '}',
  ])
  eq(brief(rs), [
    '7 Store::save HSET user:{user_id}:session:w typed', '8 Store::save EXPIRE user:{user_id}:session:w typed', '9 Store::save SETEX otp:{user_id}:w typed', '10 Store::save SADD sessions:w typed', '11 Store::save HSET user:{user_id}:session:w typed',
    '17 raw HSET order:{id}:w command', '18 raw ZADD orders:by_time:w bound multi', '18 raw EXPIRE orders:by_time:w bound multi', '19 raw GET order:{id}:cache:r bound', '20 raw XADD events:orders:w bound', '21 raw PUBLISH  bound',
  ], 'redis-rs: a field typed as a connection, format! (positional and inline), a same-file constant, a local the function binds to format!, set_ex\'s order, redis::cmd(…).arg(…), redis::pipe().atomic() (MULTI), a connection taken from a client; a HashMap\'s get is none')
  eq([rs.sites[0].fields, rs.sites[1].ttl, rs.sites[2].ttl, rs.sites[5].fields, rs.sites[9].fields], [['token'], { s: 1800 }, { s: 300 }, ['status'], ['kind', 'id']], '… fields, lifetimes, a slice of pairs as a stream entry\'s fields')
  const rs2 = readFile('api/src/streams.rs', [
    'use redis::{AsyncCommands, streams::StreamReadOptions};',
    'const SCRIPT: &str = r#"',
    'local n = redis.call(\'INCR\', KEYS[1])',
    "redis.call('EXPIRE', KEYS[1], 60)",
    'return n',
    '"#;',
    'pub async fn consume(con: &mut redis::aio::MultiplexedConnection, worker: &str) -> redis::RedisResult<()> {',
    '    let _: () = con.xgroup_create_mkstream("events:orders", "billing", "$").await?;',
    '    let opts = StreamReadOptions::default().group("billing", worker).count(10);',
    '    let _: redis::streams::StreamReadReply = con.xread_options(&["events:orders"], &[">"], &opts).await?;',
    '    let _: () = con.xack("events:orders", "billing", &["1-0"]).await?;',
    '    let n: i64 = redis::Script::new(SCRIPT).key(format!("rate:{}", worker)).invoke_async(con).await?;',
    '    let mut cmd = redis::cmd("FT.CREATE");',
    '    cmd.arg("idx:orders").arg("ON").arg("JSON").arg("PREFIX").arg(1).arg("order:").arg("SCHEMA").arg("$.status").arg("AS").arg("status").arg("TAG");',
    '    for f in fields() { cmd.arg(f).arg("TEXT"); }',
    '    cmd.query_async::<()>(con).await?;',
    '    Ok(())',
    '}',
  ])
  eq(brief(rs2), ['3 consume INCR rate:{worker}:w bound lua', '4 consume EXPIRE rate:{worker}:w bound lua', '8 consume XGROUP events:orders:w typed', '10 consume XREADGROUP events:orders:r typed', '11 consume XACK events:orders:w typed', '12 consume EVAL rate:{worker}:w bound', '13 consume FT.CREATE  builder'],
    'redis-rs: a consumer group created with MKSTREAM, read with StreamReadOptions\'s group, acknowledged; a Script\'s keys mapped into its body (each redis.call at its line in the constant); a command assembled in steps')
  eq([rs2.sites[3].stream.group.t, rs2.sites[3].stream.consumer.t, rs2.sites[1].ttl, rs2.sites[6].index.def], ['billing', '{worker}', { s: 60 }, { on: 'JSON', prefixes: ['order:'], schema: [{ name: '$.status', type: 'TAG', opts: [], as: 'status' }], assembled: 'code' }],
    '… the group, the consumer code names, the script\'s lifetime, the index read from its literal pushes and said assembled in code')
  const fr = readFile('api/src/fred.rs', [
    'use fred::prelude::*;',
    'pub async fn f(client: &RedisClient, id: &str) -> Result<(), RedisError> {',
    '    client.hset::<(), _, _>(format!("item:{}", id), ("name", "x")).await?;',
    '    client.set::<(), _, _>(format!("lock:{}", id), "1", Some(Expiration::EX(30)), None, false).await?;',
    '    Ok(())',
    '}',
  ])
  eq(brief(fr), ['3 f HSET item:{id}:w typed', '4 f SET lock:{id}:w typed'], 'fred: a client typed as one, its typed methods')

  console.log('\n2 · the call sites: Python (redis-py, redis.asyncio) and Go (go-redis, redigo)')
  const py = readFile('worker/jobs.py', [
    'import os',
    'import redis',
    'from redis.commands.search.field import TextField, TagField',
    'from redis.commands.search.indexDefinition import IndexDefinition, IndexType',
    'r = redis.Redis.from_url(os.environ["REDIS_URL"])',
    'PREFIX = "job:"',
    'LUA = "return redis.call(\'HINCRBY\', KEYS[1], \'attempts\', 1)"',
    'bump = r.register_script(LUA)',
    'def enqueue(job_id, payload):',
    '    r.hset(f"{PREFIX}{job_id}", mapping={"state": "queued", "payload": payload})',
    '    r.set(f"lock:{job_id}", "1", ex=120, nx=True)',
    '    r.setex("job:%s:heartbeat" % job_id, 30, "1")',
    '    r.xadd("events:jobs", {"kind": "queued", "id": job_id})',
    '    r.xgroup_create("events:jobs", "runners", id="0", mkstream=True)',
    '    r.xreadgroup("runners", "runner-1", {"events:jobs": ">"}, count=10)',
    '    r.json().set("job:{}:doc".format(job_id), "$", {})',
    '    r.ft("idx:jobs").search("@state:queued")',
    '    r.ft("idx:jobs").create_index((TextField("state"), TagField("$.tags", as_name="tags")), definition=IndexDefinition(prefix=["job:"], index_type=IndexType.HASH))',
    '    bump(keys=[f"job:{job_id}"], args=[])',
    '    for k in r.scan_iter(match="job:*"):',
    '        pass',
    '    p = r.pubsub()',
    '    p.subscribe("jobs:done")',
    '    d = {}; d.get("x")',
  ])
  eq(brief(py), ['7 enqueue HINCRBY job:{job_id}:w bound lua', '10 enqueue HSET job:{job_id}:w bound', '11 enqueue SET lock:{job_id}:w bound', '12 enqueue SETEX job:{job_id}:heartbeat:w bound', '13 enqueue XADD events:jobs:w bound', '14 enqueue XGROUP events:jobs:w bound', '15 enqueue XREADGROUP events:jobs:r bound', '16 enqueue JSON.SET job:{job_id}:doc:w bound', '17 enqueue FT.SEARCH  bound', '18 enqueue FT.CREATE  bound', '19 enqueue EVAL job:{job_id}:w bound', '20 enqueue SCAN  bound', '23 enqueue SUBSCRIBE  bound'],
    'redis-py: a client from from_url, f-strings with a constant, % and .format, mapping=, ex=, xadd\'s dict, json(), ft("idx"), a registered script\'s keys mapped, scan_iter(match=), a pub/sub object; a dict\'s get is none')
  eq([py.sites[1].fields, py.sites[2].ttl, py.sites[3].ttl, py.sites[4].fields, py.sites[5].stream.mkstream, py.sites[6].stream.group.t, py.sites[9].index.def, py.sites[11].glob, py.env], [['state', 'payload'], { s: 120 }, { s: 30 }, ['kind', 'id'], true, 'runners', { on: 'HASH', prefixes: ['job:'], schema: [{ name: 'state', type: 'TEXT', opts: [] }, { name: '$.tags', type: 'TAG', opts: [], as: 'tags' }] }, ['job:*'], [{ name: 'REDIS_URL', line: 5 }]],
    '… mapping\'s keys, ex= and setex lifetimes, a stream\'s fields and group, create_index\'s fields and definition, the glob, the environment variable')
  const go = readFile('svc/cache.go', [
    'package svc',
    'import (',
    '  "context"',
    '  "fmt"',
    '  "os"',
    '  "time"',
    '  "github.com/redis/go-redis/v9"',
    ')',
    'const prefix = "user:"',
    'type Repo struct { rdb *redis.Client }',
    'func New() *Repo { return &Repo{rdb: redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_HOST"), DB: 3})} }',
    'func (r *Repo) Save(ctx context.Context, id string) error {',
    '  r.rdb.HSet(ctx, prefix+id, "name", "x", "email", "y")',
    '  r.rdb.Set(ctx, fmt.Sprintf("session:%s", id), "1", 30*time.Minute)',
    '  r.rdb.Set(ctx, "cfg:global", "1", 0)',
    '  r.rdb.Expire(ctx, prefix+id, time.Hour)',
    '  r.rdb.XAdd(ctx, &redis.XAddArgs{Stream: "events:users", Values: map[string]interface{}{"kind": "saved"}})',
    '  r.rdb.XGroupCreateMkStream(ctx, "events:users", "mailer", "$")',
    '  r.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{Group: "mailer", Consumer: "m1", Streams: []string{"events:users", ">"}})',
    '  r.rdb.Do(ctx, "FT.CREATE", "idx:users", "ON", "HASH", "PREFIX", 1, "user:", "SCHEMA", "name", "TEXT")',
    '  r.rdb.Publish(ctx, "users:saved", id)',
    '  pipe := r.rdb.TxPipeline()',
    '  pipe.Incr(ctx, "stats:saves")',
    '  pipe.Exec(ctx)',
    '  m := map[string]string{}; _ = m',
    '  return nil',
    '}',
  ])
  eq(brief(go), ['13 Repo.Save HSET user:{id}:w typed', '14 Repo.Save SET session:{id}:w typed', '15 Repo.Save SET cfg:global:w typed', '16 Repo.Save EXPIRE user:{id}:w typed', '17 Repo.Save XADD events:users:w typed', '18 Repo.Save XGROUP events:users:w typed', '19 Repo.Save XREADGROUP events:users:r typed', '20 Repo.Save FT.CREATE  typed', '21 Repo.Save PUBLISH  typed', '23 Repo.Save INCR stats:saves:w bound'],
    'go-redis: a struct field typed as a client, the context dropped, a concatenation with a constant, fmt.Sprintf, Do\'s raw command, XAddArgs and XReadGroupArgs, a transaction pipeline')
  eq([go.sites[0].fields, go.sites[1].ttl, go.sites[2].ttl, go.sites[3].ttl, go.sites[4].fields, go.sites[5].stream.mkstream, go.sites[6].stream.consumer.t, go.sites[7].index.def.prefixes, go.env, go.dbs], [['name', 'email'], { s: 1800 }, undefined, { s: 3600 }, ['kind'], true, 'm1', ['user:'], [{ name: 'REDIS_HOST', line: 11 }], [{ db: 3, line: 11, how: 'option' }]],
    '… its fields, a duration in seconds, a zero duration no lifetime, a stream\'s fields, group and consumer, the index\'s prefix, the environment variable, the DB option')
  const rg = readFile('svc/old.go', ['package svc', 'import "github.com/gomodule/redigo/redis"', 'func f(c redis.Conn, id string) { c.Do("HSET", "legacy:"+id, "a", 1); redis.String(c.Do("GET", "legacy:"+id)) }'])
  eq(brief(rg), ['3 f HSET legacy:{id}:w typed', '3 f GET legacy:{id}:r typed'], 'redigo: conn.Do("CMD", …) with no context')

  console.log('\n2 · keys and index names built by the file\'s own functions: a key function read through at its call, a parameter every call of its function binds alike')
  const kf = readFile('api/src/search.rs', [
    'use redis::aio::ConnectionManager;',
    'const INDEX: &str = "idx:docs";',
    'const SUFFIX: &str = "meta";',
    'pub struct Search { stage: String, conn: ConnectionManager }',
    'fn doc_key(id: &str) -> String { format!("doc:{}", id) }',
    'fn user_key(user_id: &str, suffix: &str) -> String { format!("user:{user_id}:{suffix}") }',
    'impl Search {',
    '    fn index_name(&self) -> String { format!("{}:{}", self.stage, INDEX) }',
    '    fn prefix(&self) -> String { format!("{}:doc:", self.stage) }',
    '    pub async fn ensure(&mut self) -> redis::RedisResult<()> {',
    '        let name = self.index_name();',
    '        self.create_once(&name).await',
    '    }',
    '    async fn create_once(&mut self, index_name: &str) -> redis::RedisResult<()> {',
    '        let index_name = index_name.to_string();',
    '        let prefix = self.prefix();',
    '        redis::cmd("FT.CREATE").arg(&index_name).arg("ON").arg("HASH").arg("PREFIX").arg(1).arg(&prefix).arg("SCHEMA").arg("title").arg("TEXT").query_async::<()>(&mut self.conn).await',
    '    }',
    '    pub async fn find(&mut self, q: &str) -> redis::RedisResult<()> {',
    '        let index_name = self.index_name();',
    '        redis::cmd("FT.SEARCH").arg(&index_name).arg(q).query_async::<()>(&mut self.conn).await',
    '    }',
    '    pub async fn save(&mut self, id: &str) -> redis::RedisResult<()> {',
    '        let key = doc_key(id);',
    '        redis::cmd("HSET").arg(&key).arg("title").arg("t").query_async::<()>(&mut self.conn).await?;',
    '        redis::cmd("HSET").arg(user_key(id, SUFFIX)).arg("seen").arg(1).query_async::<()>(&mut self.conn).await',
    '    }',
    '    pub async fn drop_one(&mut self, which: &str) -> redis::RedisResult<()> { redis::cmd("DEL").arg(which).query_async::<()>(&mut self.conn).await }',
    '    pub async fn a(&mut self) -> redis::RedisResult<()> { self.drop_one("tmp:a").await }',
    '    pub async fn b(&mut self) -> redis::RedisResult<()> { self.drop_one("tmp:b").await }',
    '}',
  ])
  eq(brief(kf), ['17 Search::create_once FT.CREATE  command', '21 Search::find FT.SEARCH  command', '25 Search::save HSET doc:{id}:w command', '26 Search::save HSET user:{id}:meta:w command', '28 Search::drop_one DEL dyn1 command'],
    'a key function read through (its parameters bound to the call\'s arguments, a constant inlined); a local bound to one; a parameter its two calls bind apart: dynamic')
  eq([kf.sites[0].index.name, kf.sites[0].index.def.prefixes, kf.sites[1].index.name], ['{stage}:idx:docs', ['{stage}:doc:'], '{stage}:idx:docs'],
    'an index name built by a method, passed as a parameter its one call binds, rebound to itself (`let x = x.to_string()`): one template at FT.CREATE and FT.SEARCH, its PREFIX too')
  const kts = readFile('web/src/keys.ts', [
    "import Redis from 'ioredis'",
    'const redis = new Redis()',
    'const sessionKey = (id: string) => `session:${id}`',
    'function cartKey(id: string) { return `cart:${id}:items` }',
    'export async function f(userId: string) { await redis.hset(sessionKey(userId), "ip", 1); await redis.sadd(cartKey(userId), "x"); const k = sessionKey(userId); await redis.expire(k, 60) }',
  ])
  eq(brief(kts), ['5 f HSET session:{userId}:w bound', '5 f SADD cart:{userId}:items:w bound', '5 f EXPIRE session:{userId}:w bound'], 'TypeScript: an arrow and a function returning a template literal, read through at their calls')
  const kpy = readFile('w/keys.py', ['import redis', 'r = redis.Redis()', 'def job_key(job_id):', '    return f"job:{job_id}"', 'def run(jid):', '    r.hset(job_key(jid), "state", "x")'])
  const kgo = readFile('w/keys.go', ['package w', 'import ("fmt"; "github.com/redis/go-redis/v9")', 'func lockKey(id string) string { return fmt.Sprintf("lock:%s", id) }', 'func run(rdb *redis.Client, ctx any, id string) { rdb.SetNX(ctx, lockKey(id), "1", 0) }'])
  eq([brief(kpy), brief(kgo)], [['6 run HSET job:{jid}:w bound'], ['4 run SET lock:{id}:w typed']], 'Python and Go: a key function read through')
  const { reconcile } = await import('../lib/data/reconcile.mjs')
  const covered = reconcile([{ repo: 'api', extractor: 'redis-commands@1', facts: { declarations: [], redis: kf } }])
  eq(covered.stores[0].entities.filter((e) => e.kind === 'index').map((e) => [e.label, e.declared, e.queries.sites.length, e.lead ?? null]), [['{stage}:idx:docs', true, 1, null]], '… the index declared and queried under one templated name: no lead')

  console.log('\n2 · no value read as a name: Python keywords, an object\'s spread; a client named or bound only where it is one')
  const V = ['KW', 'VAL', String(process.pid % 13)].join('')
  const kw = readFile('w/kw.py', [
    'import redis',
    'r = redis.Redis()',
    'def f(base):',
    `    r.hset(name="kwh:1", key="fld", value="${V}")`,
    `    r.hset("kwh:2", mapping={"g": "${V}", "h": "${V}"})`,
    `    r.hset(name="kwh:3", mapping={"m": "${V}"})`,
    `    r.set(name="kwh:4", value="${V}", ex=10, nx=True)`,
    `    r.publish(channel="ch:kw", message="${V}")`,
    `    r.hmset("kwh:5", {"n": "${V}"})`,
    `    r.xadd(name="kws:1", fields={"o": "${V}"})`,
    `    r.xgroup_create(name="kws:1", groupname="g1", mkstream=True)`,
    `    r.hset(key="fld", value="${V}")`,
    `    r.lindex(name="kwh:6", index=0)`,
  ])
  eq(kw.sites.map((x) => `${x.cmd} ${x.keys.map((k) => k.t).join(',') || '-'} ${(x.fields || []).join(',')}${x.ttl ? ` ttl ${x.ttl.s}` : ''}${x.channel ? ` ch ${x.channel.map((c) => c.t)}` : ''}${x.stream?.mkstream ? ' mkstream' : ''}`),
    ['HSET kwh:1 fld', 'HSET kwh:2 g,h', 'HSET kwh:3 m', 'SET kwh:4  ttl 10', 'PUBLISH -  ch ch:kw', 'HMSET kwh:5 n', 'XADD kws:1 o', 'XGROUP kws:1  mkstream', 'HSET - ', 'LINDEX - '],
    'redis-py\'s keywords mapped to the method\'s parameters (name, key, value, mapping, channel, fields, ex, nx, mkstream); a leading one missing: no key read')
  ok(!JSON.stringify(kw).includes(V) && !kw.sites.some((x) => x.keys.some((k) => /^(?:name|key|value|channel)$/.test(k.t))), '… never a value as a field, never a keyword\'s name as a key or a channel')
  const sp = readFile('web/src/spread.ts', [
    "import Redis from 'ioredis'",
    'const r = new Redis()',
    'export async function f(id: string, base: Record<string, string>) {',
    `  await r.hset(\`h:\${id}\`, { ...base, name: '${V}', active: true })`,
    `  await r.mset({ ...base, 'k:1': '${V}', 'k:2': '${V}' })`,
    `  await r.hmset('h:2', { ...base, g: '${V}' })`,
    `  await r.hset('h:3', ...[base], 'x', '${V}')`,
    '}',
  ])
  eq(sp.sites.map((x) => `${x.cmd} ${x.keys.map((k) => k.t).join(',')} ${(x.fields || []).join(',')}`), ['HSET h:{id} name,active', 'MSET k:1,k:2 ', 'HMSET h:2 g', 'HSET h:3 '], 'an object\'s spread contributes nothing: its own pairs stay pairs (a key, a field, never a value); after a spread among the arguments, no pair read')
  ok(!JSON.stringify(sp).includes(V), '… no value anywhere')
  // m1, m2: a receiver named after the store is the whole name or the store's word with a client's; a
  // client bound in one function is no client in another
  const scope = {
    'w/scope.py': ['import redis', 'import requests', 'def a():', '    client = redis.Redis()', '    client.hset("p:1", "f", 1)', 'def b():', '    client = requests.Session()', '    client.get("http://x/users")', 'def c(redis_config):', '    redis_config.get("host")'],
    'web/src/scope.ts': ["import Redis from 'ioredis'", 'export async function a() { const client = new Redis(); await client.hset("p:1", "f", 1) }', 'export async function b() { const client = new Map<string, string>(); client.get("http://x/users") }', 'export function c(redisConfig: Map<string, string>) { redisConfig.get("host") }'],
    'svc/scope.go': ['package svc', 'import ("net/http"; "github.com/redis/go-redis/v9")', 'func a(ctx any) { client := redis.NewClient(nil); client.HSet(ctx, "p:1", "f", 1) }', 'func b() { client := http.Client{}; client.Get("http://x/users") }'],
    'api/src/scope.rs': ['use redis::AsyncCommands;', 'async fn a(c: &redis::Client) { let mut client = c.get_multiplexed_async_connection().await.unwrap(); let _: () = client.hset("p:1", "f", 1).await.unwrap(); }', 'fn b() { let client = reqwest::Client::new(); client.get("http://x/users"); }'],
  }
  eq(Object.entries(scope).map(([f, lines]) => brief(readFile(f, lines))), [['5 a HSET p:1:w bound'], ['2 a HSET p:1:w bound'], ['3 a HSET p:1:w bound'], ['2 a HSET p:1:w bound']], 'a client bound in one function is no client in another (an HTTP client\'s get is no GET); `redis_config` is not named after the store')
  // M1: a chain of locals each holding several of the one before: linear, bounded
  const chainOf8 = (fam) => {
    const n = 12, parts = (i) => Array.from({ length: 8 }, () => i)
    if (fam === 'ts') return readFile('big/amp.ts', ["import Redis from 'ioredis'", 'const r = new Redis()', 'export async function f(k0: string) {', ...Array.from({ length: n }, (_, i) => `  const k${i + 1} = \`${parts(i).map((j) => `\${k${j}}`).join('')}\``), `  await r.set(\`a:\${k${n}}\`, 1)`, '}'])
    if (fam === 'py') return readFile('big/amp.py', ['import redis', 'r = redis.Redis()', 'def f(k0):', ...Array.from({ length: n }, (_, i) => `    k${i + 1} = f"${parts(i).map((j) => `{k${j}}`).join('')}"`), `    r.set(f"a:{k${n}}", 1)`])
    if (fam === 'go') return readFile('big/amp.go', ['package big', 'import ("fmt"; "github.com/redis/go-redis/v9")', 'func f(ctx any, r *redis.Client, k0 string) {', ...Array.from({ length: n }, (_, i) => `  k${i + 1} := fmt.Sprintf("${parts(i).map(() => '%s').join('')}", ${parts(i).map((j) => `k${j}`).join(', ')})`), `  r.Set(ctx, "a:"+k${n}, 1, 0)`, '}'])
    return readFile('big/amp.rs', ['use redis::AsyncCommands;', 'async fn f(c: &mut redis::aio::MultiplexedConnection, k0: &str) {', ...Array.from({ length: n }, (_, i) => `    let k${i + 1} = format!("${parts(i).map(() => '{}').join('')}", ${parts(i).map((j) => `k${j}`).join(', ')});`), `    let _: () = c.set(format!("a:{}", k${n}), 1).await.unwrap();`, '}'])
  }
  for (const fam of ['ts', 'py', 'go', 'rs']) { const [r, ms] = timed(() => chainOf8(fam)); ok(r.sites.length === 1 && r.sites[0].keys[0]?.t.startsWith('a:') && ms < 5000, `${fam}: 12 locals each holding 8 of the one before (8^12 parts unexpanded): read once each, its key ${r.sites[0]?.keys[0]?.t} (${ms} ms)`) }
  const [kfn, tk] = timed(() => readFile('big/amp-fn.ts', ["import Redis from 'ioredis'", 'const r = new Redis()', 'const k0 = (a: string) => `x:${a}`', ...Array.from({ length: 6 }, (_, i) => `const k${i + 1} = (a: string) => \`${Array.from({ length: 30 }, () => `\${k${i}(a)}`).join('')}\``), 'export const f = (id: string) => r.set(k6(id), 1)']))
  ok(kfn.sites.length === 1 && tk < 5000, `key functions each calling the one before 30 times, 6 deep: each read once per binding (${tk} ms)`)

  console.log('\n2 · the call sites: hostile and dynamic input, bounded and inert; errors by position only')
  const head = ["import Redis from 'ioredis'", 'const r = new Redis()']
  const [many, tMany] = timed(() => readFile('big/many.ts', [...head, 'export function f(id: string) {', ...Array.from({ length: 100000 }, (_, i) => `  r.hset(\`k${i % 7}:\${id}\`, 'f', 1)`), '}']))
  ok(many.sites.length === 1000 && many.notes.some((n) => /more than 1000 commands/.test(n)) && tMany < 60000, `100 000 call sites in one file: the first 1 000 read, said (${tMany} ms, parsing included)`)
  const [nest, tNest] = timed(() => readFile('big/deep.ts', [...head, 'export const f = (id: string) => ' + '['.repeat(20000) + 'r.hset(`n:${id}`, "f", 1)' + ']'.repeat(20000)]))
  ok(nest.sites.length === 1 && tNest < 30000, `a call nested 20 000 deep: found in one walk down the tree (${tNest} ms)`)
  const [chain, tChain] = timed(() => readFile('big/chain.ts', [...head, 'export const f = () => r.pipeline()' + '.hset("c:1", "f", 1)'.repeat(5000) + '.exec()']))
  ok(chain.sites.length > 0 && chain.sites.length <= 1000 && tChain < 30000, `a chain of 5 000 commands: bounded (${chain.sites.length} read, ${tChain} ms)`)
  const blanks = readFile('big/blank.ts', [...head, `export const f = (id: string) => r.hset(${' '.repeat(100000)}\`b:\${id}\`,${'\t'.repeat(100000)}'f', 1)`])
  eq(brief(blanks), ['3 f HSET b:{id}:w bound'], 'whitespace runs of 100 000 inside a call: read')
  const [lvl, tLvl] = timed(() => redisLevel('x.ts', ' '.repeat(500000) + '.' + ' '.repeat(500000) + 'hset' + ' '.repeat(500000)))
  ok(lvl === 0 && tLvl < 1000, `the content filter on 1.5 MB of blanks: linear (${tLvl} ms)`)
  const param = readFile('svc/param.ts', [...head, 'export async function f(key: string, k2: string) { await r.hset(key, "a", 1); await r.set(k2, "v"); await r.del(`${key}`) }'])
  eq([brief(param), param.dyn], [['3 f HSET dyn1 bound', '3 f SET dyn1 bound', '3 f DEL dyn1 bound'], 3], 'a key built from a parameter: dynamic, counted, never named')
  const broken = readFile('svc/broken.ts', [...head, 'export async function f(id: string) { await r.hset(`p:${id}`, "a", ', '}}}} ((( '])
  ok(broken === undefined || broken.notes.every((n) => !/hset|`p:/.test(n)), 'a file that does not parse: what reads is read, errors by position only, never its text')
}

// ════ 3 · the key space against the model (data/redis.mjs), on hand-built facts ════
console.log('\n3 · the key space (data/redis.mjs): templates, types and their conflict, lifetimes and the lead, channels, streams, indexes, readers and writers, the gap')
{
  const { reconcile } = await import('../lib/data/reconcile.mjs')
  const RM = await import('../lib/data/redis.mjs')
  const { gapsOf } = await import('../lib/data/check.mjs')
  // a file's facts: sites from protocol commands; fns by name
  const file = (path, fns, sites, extra = {}) => ({ declarations: [], redis: { lang: 'ts', path, clients: [{ source: 'ioredis', line: 1 }], env: [], dbs: [], fns: fns.map((name, i) => ({ name, line: 10 * (i + 1), end: 10 * (i + 1) + 9 })), notes: [], tests: 0, dyn: 0, ...extra, sites: sites.map(([line, fn, name, ...args]) => ({ line, fn, how: 'bound', ...readCommand({ name, args: args.map((a) => (typeof a === 'string' ? L(a) : typeof a === 'number' ? { n: a } : a)) }) })) } })
  const rows = [
    { repo: 'api', extractor: 'redis-commands@1', facts: file('api/src/sessions.rs', ['save', 'load', 'consume'], [
      [11, 0, 'HSET', s('user:', h('user_id'), ':session'), 'token', 'v', 'ip', 'v'],
      [12, 0, 'EXPIRE', s('user:', h('user_id'), ':session'), 1800],
      [13, 0, 'SET', s('otp:', h('id')), 'v'],
      [14, 0, 'PUBLISH', 'chat:lobby', 'm'],
      [15, 0, 'XADD', 'events:orders', '*', 'kind', 'v'],
      [16, 0, 'FT.CREATE', 'idx:users', 'ON', 'HASH', 'PREFIX', 1, 'user:', 'SCHEMA', 'name', 'TEXT', 'SORTABLE', 'email', 'TAG'],
      [17, 0, 'FT.CREATE', 'idx:orphan', 'ON', 'JSON', 'PREFIX', 1, 'doc:', 'SCHEMA', '$.t', 'AS', 't', 'TEXT'],
      [21, 1, 'HGETALL', s('user:', h('id'), ':session')],
      [22, 1, 'GET', s('cart:', h('id'))],
      [31, 2, 'XGROUP', 'CREATE', 'events:orders', 'billing', '$', 'MKSTREAM'],
      [32, 2, 'XREADGROUP', 'GROUP', 'billing', 'w1', 'STREAMS', 'events:orders', '>'],
      [33, 2, 'SCAN', 0, 'MATCH', 'user:*:session'],
    ]) },
    { repo: 'web', extractor: 'redis-commands@1', facts: file('web/src/cache.ts', ['view', 'listen'], [
      [11, 0, 'HSET', s('cart:', h('cartId')), 'items', 'v'],
      [12, 0, 'FT.SEARCH', 'idx:users', '@name:x'],
      [21, 1, 'SUBSCRIBE', 'chat:lobby'],
      [22, 1, 'PSUBSCRIBE', 'chat:*'],
    ]) },
  ]
  const m = reconcile(rows)
  eq(m.stores.map((st) => `${st.id} ${st.dialect} ${RM.redisSummary(st)}`), [
    'api:redis redis 4 key templates · 2 search indexes · 1 channel · 1 stream · inferred from the commands in code, not declared (12 commands) · no conflicts · 4 leads',
    'web:redis redis 1 key template · 1 search index · 2 channels · 0 streams · inferred from the commands in code, not declared (4 commands) · no conflicts · 1 lead',
  ], 'one key space per repository when no instance is wired to both: never grouped by a guess (both send cart:{…})')
  const api = m.stores[0]
  const T = (name) => api.entities.find((e) => e.name === name)
  eq(RM.templatesOf(api).map((e) => `${e.name} ${e.type ?? '-'} [${e.fields.map((f) => f.name)}] ${RM.ttlText(e.ttl)}${e.lead ? ' LEAD' : ''} ← ${e.sources.map((x) => x.line).join(',')}`), [
    'cart:{id} string [] no lifetime set ← 22', 'events:orders stream [kind] no lifetime set LEAD ← 15,31,32', 'otp:{id} string [] no lifetime set LEAD ← 13', 'user:{user_id}:session hash [token,ip] 30 min ← 11,12,21',
  ], 'templates compared without their placeholders\' names (user:{user_id} and user:{id} one), each with its type, fields, lifetime and every path:line; a written template with no lifetime anywhere a lead; a read-only one none')
  eq([T('user:{user_id}:session').names, T('user:{user_id}:session').path, T('user:{user_id}:session').coveredBy, T('user:{user_id}:session').globs, T('events:orders').groups.map((g) => [g.name, g.created, g.consumers])], [['user:{user_id}:session', 'user:{id}:session'], ['user:', '{user_id}:', 'session'], ['idx:users'], ['user:*:session'], [['billing', true, ['w1']]]],
    '… the names code gives its placeholders, its prefix-tree path, the index whose PREFIX covers it, the SCAN glob reading it, a stream\'s consumer group and consumer')
  const IX = (name, st = api) => st.entities.find((e) => e.kind === 'index' && e.label === name)
  eq([IX('idx:users').fields.map((f) => `${f.name}:${f.type.raw}${f.opts.length ? `(${f.opts})` : ''}`), IX('idx:users').on, IX('idx:users').prefixes, IX('idx:users').covers, IX('idx:users').declared, IX('idx:users').lead, IX('idx:orphan').lead === RM.NO_QUERY, IX('idx:orphan').covers],
    [['name:TEXT(SORTABLE)', 'email:TAG'], 'HASH', ['user:'], ['user:{user_id}:session'], true, RM.NO_QUERY, true, []],
    'a literal FT.CREATE: a declaration (its schema, ON, PREFIX and the templates it covers); queried only from another key space, it is unqueried in its own')
  const web = m.stores[1]
  eq([IX('idx:users', web).declared, IX('idx:users', web).queries.sites.length, web.keyspace.channels.map((c) => `${c.name} pub ${c.pub.length} sub ${c.sub.length}${c.psub ? ` psub ${c.psub}` : ''}`), api.keyspace.channels.map((c) => `${c.name} pub ${c.pub.length} sub ${c.sub.length}`)],
    [false, 1, ['chat:* pub 0 sub 1', 'chat:lobby pub 0 sub 1 psub chat:*'], ['chat:lobby pub 1 sub 0']], 'an index only queried (its creation not read); channels with their publishers and subscribers, a pattern subscription on the channels it matches; never joined across repositories without an instance')
  // readers and writers per function
  const sitesOf = (e) => e.redis.sites.map((k) => m.redis.sites[k])
  eq(RM.redisFunctions(sitesOf(T('user:{user_id}:session')), () => null, T('user:{user_id}:session').id).map((f) => `${f.name} ${f.reads ? 'r' : ''}${f.writes ? 'w' : ''} ${f.kinds} ${f.lines}`), ['save w HSET,EXPIRE 11,12', 'load r HGETALL 21', 'consume r SCAN 33'], 'readers and writers per function, a SCAN glob a reader of what it matches')
  // the type conflict
  const cf = reconcile([{ repo: 'api', extractor: 'redis-commands@1', facts: file('api/a.rs', ['a', 'b'], [[11, 0, 'SET', s('user:', h('id')), 'v'], [21, 1, 'HSET', s('user:', h('uid')), 'f', 'v'], [22, 1, 'SETBIT', s('user:', h('uid')), 1, 1], [23, 1, 'GEOADD', 'places', 1, 2, 'm'], [24, 1, 'ZADD', 'places', 1, 'm']]) }])
  const u = cf.stores[0].entities.find((e) => e.name === 'user:{id}')
  eq([u.type, u.conflicts.map((c) => [c.attr, c.values.map((v) => `${v.value}@${v.sources.map((x) => x.line)}`)]), cf.stores[0].entities.find((e) => e.name === 'places').conflicts, RM.redisSummary(cf.stores[0])],
    ['string / hash / bitmap', [['type', ['string / bitmap@11,22', 'hash@21']]], [], '2 key templates · 0 search indexes · 0 channels · 0 streams · inferred from the commands in code, not declared (5 commands) · 1 conflict · 2 leads'],
    'two families TYPE answers apart on one template: a conflict with both sides (WRONGTYPE before it happens); a bitmap on a string and geo on a sorted set are none')
  // the gap closes: a client whose commands are read
  const imports = [{ repo: 'api', path: 'api/src/sessions.rs', source: 'redis' }, { repo: 'web', path: 'web/src/cache.ts', source: 'ioredis' }, { repo: 'jobs', path: 'jobs/q.py', source: 'redis' }]
  eq(gapsOf({ ...m, redis: { ...m.redis, clients: [{ repo: 'api', source: 'redis' }, { repo: 'web', source: 'ioredis' }] } }, [], imports).map((g) => `${g.id} ${g.sources} ${g.files.map((f) => f.path)}`), ['redis redis jobs/q.py'], 'the gap closes for a client whose commands are read; one whose commands are not stays a gap')
  eq(m.redis.clients, [{ repo: 'api', source: 'ioredis' }, { repo: 'web', source: 'ioredis' }], '… the clients read, per repository')
  // no value anywhere
  ok(!JSON.stringify(m).includes('@name:x') && !JSON.stringify(m).includes('"v"'), 'no value and no query text in the model')
  // the review's false facts, in the model
  const envFile = (repo, path, env) => ({ repo, extractor: 'redis-commands@1', facts: file(path, ['f'], [[11, 0, 'SET', s(`${repo}:`, h('id')), 'v']], { env: env.map((name) => ({ name, line: 1 })) }) })
  const inst = (env, build = null) => ({ repo: 'ops', extractor: 'redis-infra@1', facts: { declarations: [], redisInfra: [{ name: 'redis:cache', label: 'cache', kind: 'Compose service', engine: 'Redis', version: null, modules: [], eviction: null, persistence: null, notifications: null, databases: null, path: 'compose.yaml', line: 2, env: [{ env, path: 'compose.yaml', line: 9, build }], notes: [] }] } })
  const ids = (rows2, opts) => reconcile(rows2, opts).stores.map((x) => `${x.id}${x.keyspace.wired?.length ? ` <${x.keyspace.wired.map((w) => w.repo)}>` : ''}${x.keyspace.shared ? ' shared' : ''}`)
  eq([ids([envFile('a', 'a.ts', ['REDIS_URL']), envFile('b', 'b.ts', ['REDIS_URL']), envFile('c', 'c.ts', ['REDIS_URL']), inst('REDIS_URL')]), ids([envFile('a', 'a.ts', ['REDIS_URL']), envFile('b', 'b.ts', ['OTHER']), inst('REDIS_URL')])],
    [['a:redis shared', 'b:redis shared', 'c:redis shared', 'ops:redis:cache'], ['b:redis', 'ops:redis:cache <a>']], 'a variable the infrastructure sets naming no repository: three repositories reading it are never grouped (said); one alone reading it is wired')
  const roots = [{ name: 'ops', rel: 'deploy/ops' }, { name: 'a', rel: 'services/a' }, { name: 'b', rel: 'services/b' }]
  eq([ids([envFile('a', 'a.ts', ['REDIS_URL']), envFile('b', 'b.ts', ['REDIS_URL']), inst('REDIS_URL', '../../services/a')], { roots }), ids([envFile('a', 'a.ts', ['REDIS_URL']), envFile('b', 'b.ts', ['REDIS_URL']), inst('REDIS_URL', '../../elsewhere/a')], { roots })],
    [['b:redis', 'ops:redis:cache <a>'], ['a:redis shared', 'b:redis shared', 'ops:redis:cache']], 'a Compose build context resolved against the repositories\' paths: the repository it builds, never a folder that merely shares its name')
  const typed = reconcile([{ repo: 'k', extractor: 'redis-commands@1', facts: file('k.ts', ['f'], [[1, 0, 'HSET', s('doc:', h('id')), 'f', 'v'], [2, 0, 'JSON.SET', s('doc:j:', h('id')), '$.a', '1'], [3, 0, 'FT.CREATE', 'idx:json', 'ON', 'JSON', 'PREFIX', 1, 'doc:', 'SCHEMA', '$.a', 'TEXT'], [4, 0, 'FT.CREATE', 'idx:hash', 'ON', 'HASH', 'PREFIX', 1, 'doc:', 'SCHEMA', 'f', 'TEXT']]) }]).stores[0]
  eq(typed.entities.filter((e) => e.kind === 'index').map((e) => `${e.label}: ${e.covers}`), ['idx:hash: doc:{id}', 'idx:json: doc:j:{id}'], 'an index covers the templates of its kind only: ON HASH a hash, ON JSON a JSON document')
  const only = reconcile([inst('REDIS_URL')]).stores[0]
  eq([only.declarations.map((d) => `${d.kind} ${d.path}`), RM.redisSummary(only)], [['infra compose.yaml'], '0 key templates · 0 search indexes · 0 channels · 0 streams · no command in code reaches it · no conflicts'], 'an instance no code reaches: its own declaration only, never one of commands with no file')
  const { diffModels } = await import('../lib/data/diff.mjs')
  const tag = (t) => reconcile([{ repo: 'k', extractor: 'redis-commands@1', facts: file('k.ts', ['f'], [[1, 0, 'SET', t, 'v']]) }])
  eq(diffModels(tag(s('cart:', h('id'))), tag(s('{cart}:', h('id')))).stores[0].changes.map((c) => `${c.change} ${c.name}`), ['added \\{cart\\}:{id}', 'removed cart:{id}'], 'graph_changes: a hash tag `{cart}:{id}` is another template than `cart:{id}`, never folded into it')

  // a refine file's claims, checked against what was read (data/check.mjs): a lineage across two key
  // spaces holds on the fields read; one naming a field the index's schema lacks drifts; a store the
  // file describes under a key space's id stays drift
  const { parseRefine, refineCheck } = await import('../lib/data/check.mjs')
  const RD = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-redis-refine-')))
  try {
    for (const [p, text] of [['api/src/sessions.rs', '// mirror\nlet token = 1;\n'], ['web/src/cache.ts', '// mirror\nconst items = 1\n']]) { const f = path.join(RD, p); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text) }
    const roots = [{ name: 'api', rel: 'api', abs: path.join(RD, 'api') }, { name: 'web', rel: 'web', abs: path.join(RD, 'web') }]
    const W = 'why it holds'
    const doc = (x) => [{ file: 'docs/architecture/kv.data.json', ...parseRefine(JSON.stringify({ schema: 1, ...x }, null, 2)) }]
    const run = (x) => refineCheck(rows, doc(x), { roots }).refine
    const held = run({ lineage: [{ from: 'api:redis/user:{user_id}:session', to: 'web:redis/cart:{cartId}', fields: [{ from: 'token', to: 'items' }], why: W, sources: ['api:src/sessions.rs:2', 'web:src/cache.ts:2'] }] })
    eq([held.claims.map((c) => [c.kind, c.ok]), held.drift], [[['lineage', true]], []], 'a lineage between two key spaces\' templates, on fields the commands name: it holds')
    const bad = run({ lineage: [{ from: 'api:redis/index:idx:users', to: 'web:redis/cart:{cartId}', fields: [{ from: 'nickname', to: 'items' }], why: W, sources: ['api:src/sessions.rs:2'] }] })
    ok(bad.drift.length === 1 && bad.drift[0].why.some((w) => /nickname/.test(w)), `a lineage naming a field the index's schema lacks: drift (${bad.drift.map((d) => d.why.join('; ')).join(' | ')})`)
    const dup = run({ stores: [{ repo: 'api', id: 'redis', kind: 'redis', imports: ['redis'], entities: [{ name: 'user', source: 'api:src/sessions.rs:2', fields: [{ name: 'token', source: 'api:src/sessions.rs:2' }] }] }] })
    ok(dup.drift.length >= 1 && dup.drift.some((d) => d.kind === 'store'), `a store described under a key space's id (api:redis) stays drift (${dup.drift.map((d) => d.why.join('; ')).join(' | ')})`)
  } finally { rmSync(RD, { recursive: true, force: true }) }
}

// ════ 4 · the infrastructure: Compose, Terraform (resources, a Helm release), CloudFormation ════
if (RT) {
  console.log('\n4 · the infrastructure (extractors/redis-infra.mjs): engine, modules, eviction, persistence, notifications, databases, the variables it wires')
  const { default: infra, confOf, imageOf } = await import('../lib/data/extractors/redis-infra.mjs')
  const { readYaml } = await import('../lib/data/readers/yaml.mjs')
  const yp = await RT.parserFor('yaml')
  const ictx = { yaml: (t) => readYaml(yp, t) }
  const brief = (list) => list.map((i) => `${i.label} ${i.kind}: ${[i.engine, i.version].filter(Boolean).map((v) => (typeof v === 'object' ? v.expr : v)).join(' ')} | ${i.modules.join(',') || '-'} | ${typeof i.eviction === 'object' && i.eviction ? i.eviction.expr : i.eviction} | ${i.persistence} | ${i.notifications} | ${i.databases} | ${i.env.map((e) => `${e.env}@${e.line}${e.build ? `>${e.build}` : ''}`).join(',')}`)
  eq([imageOf('redis:7.2-alpine'), imageOf('redis:8.0.2').modules, imageOf('valkey/valkey:8').engine, imageOf('docker.dragonflydb.io/dragonflydb/dragonfly').engine, imageOf('postgres:16')], [{ engine: 'Redis', version: '7.2-alpine', modules: [], from: 'Redis 8 and later' }, ['search', 'JSON', 'time series', 'bloom'], 'Valkey', 'Dragonfly', null], 'an image: its engine and version; the modules a stack image or Redis 8 carries')
  eq(confOf('--maxmemory-policy volatile-ttl --appendonly no --save "" --loadmodule /opt/lib/redisearch.so --databases 2'), { eviction: 'volatile-ttl', aof: 'no', save: 'off', modules: ['search'], databases: 2 }, 'a server\'s flags as redis.conf directives')
  const cmp = infra.extract({ key: 'stack/compose.yaml', override: 'compose', files: [{ path: 'stack/compose.yaml', text: [
    'services:',
    '  cache:',
    '    image: redis:7.2',
    '    command: ["redis-server", "--maxmemory-policy", "allkeys-lfu", "--notify-keyspace-events", "KEA"]',
    '  queue:',
    '    image: valkey/valkey:8',
    '    command: valkey-server --appendonly yes',
    '  api:',
    '    build: { context: ../api }',
    '    environment:',
    '      REDIS_URL: redis://cache:6379/1',
    '      QUEUE_HOST: queue',
    '      DB_URL: postgres://db/x',
    '  site:',
    '    build: ./site',
    `    environment: ["CACHE=redis://:${PW}@cache:6379", "OTHER=x"]`,
  ].join('\n') }] }, ictx).redisInfra
  eq(brief(cmp), ['cache Compose service: Redis 7.2 | - | allkeys-lfu | null | KEA | null | REDIS_URL@11>../api,CACHE@16>./site', 'queue Compose service: Valkey 8 | - | null | AOF | null | null | QUEUE_HOST@12>../api'],
    'Compose: each Redis-family service, its flags; the variables other services set to it (a URL or a host naming it), each with its build context as written (resolved against the repositories\' paths when the model is built)')
  ok(!JSON.stringify(cmp).includes('postgres') && !JSON.stringify(cmp).includes(`:${PW}@`) && !JSON.stringify(cmp).includes('redis://'), '… never a value: only the variables\' names')
  const tf = (files, key = 'mod') => infra.extract({ key, override: 'tf', files: files.map(([path, text]) => ({ path, text })) }, ictx).redisInfra
  const planted = ['tf', 'S3cret', String(process.pid % 7)].join('')
  const ec = tf([['mod/main.tf', [
    'variable "policy" { default = "allkeys-lru" }',
    'variable "auth" {}',
    'resource "aws_elasticache_parameter_group" "pg" {',
    '  family = "redis7"',
    '  parameter {',
    '    name  = "maxmemory-policy"',
    '    value = var.policy',
    '  }',
    '  parameter {',
    '    name  = "notify-keyspace-events"',
    '    value = "Ex"',
    '  }',
    '}',
    'resource "aws_elasticache_replication_group" "cache" {',
    '  engine               = "redis"',
    '  engine_version       = module.versions.redis',
    '  parameter_group_name = aws_elasticache_parameter_group.pg.name',
    '  auth_token           = var.auth',
    '  snapshot_retention_limit = 3',
    '}',
    'resource "aws_lambda_function" "api" {',
    '  environment {',
    '    variables = {',
    '      REDIS_HOST = aws_elasticache_replication_group.cache.primary_endpoint_address',
    '      OTHER      = "x"',
    '    }',
    '  }',
    '}',
  ].join('\n')], ['mod/terraform.tfvars', `auth = "${planted}"\npolicy = "volatile-lru"\n`]])
  eq(brief(ec), ['aws_elasticache_replication_group.cache ElastiCache replication group: Redis ${module.versions.redis} | - | volatile-lru | RDB snapshots | Ex | null | REDIS_HOST@24'],
    'Terraform: an ElastiCache replication group, its parameter group\'s directives (a tfvars value over the default), a version from a module output kept as its expression, the variable a function sets to it')
  ok(!JSON.stringify(ec).includes(planted), '… an auth token beside it never read')
  const helm = tf([['k8s/redis.tf', [
    'locals { mods = ["redisearch", "rejson"] }',
    'resource "helm_release" "cache" {',
    '  chart  = "redis-ha"',
    '  values = [file("${path.module}/values.yaml")]',
    '  set {',
    '    name  = "image.repository"',
    '    value = "redis/redis-stack-server"',
    '  }',
    '  set {',
    '    name  = "redis.config.maxmemory-policy"',
    '    value = var.eviction',
    '  }',
    '  set_sensitive {',
    '    name  = "auth.password"',
    `    value = "${planted}"`,
    '  }',
    '  set {',
    '    name  = "redis.customConfig"',
    '    value = join("\\n", [for m in local.mods : "loadmodule /opt/lib/${m}.so"])',
    '  }',
    '}',
    'variable "eviction" {}',
  ].join('\n')], ['k8s/values.yaml', 'image:\n  tag: "7.4.0-v8"\nredis:\n  config:\n    appendonly: "yes"\n    notify-keyspace-events: "Ex"\n'], ['live/k8s/terragrunt.hcl', 'terraform { source = "../../k8s" }\ninputs = { eviction = "allkeys-lru" }\n']], 'k8s')
  eq(brief(helm), ['helm_release.cache Helm release: Redis Stack 7.4.0-v8 | search,JSON | allkeys-lru | AOF | Ex | null | '], 'a Helm release of a Redis-family chart: its set blocks (an input from Terragrunt), a values file at a literal path, the modules its config loads (a for evaluated)')
  ok(!JSON.stringify(helm).includes(planted) && helm[0].path === 'live/k8s/terragrunt.hcl', '… a set_sensitive never read; cited at the configuration that runs it')
  const unk = tf([['u/main.tf', 'resource "upstash_redis_database" "db" {\n  database_name = "x"\n  eviction = true\n}\nresource "helm_release" "other" {\n  chart = "postgresql"\n}\n']], 'u')
  eq(brief(unk), ['upstash_redis_database.db Upstash database: Upstash Redis | - | eviction on (the provider\'s policy) | null | null | null | '], 'an Upstash database; a Helm release of another chart is none')
  const cfn = infra.extract({ key: 'cfn/template.yaml', override: 'cfn', files: [{ path: 'cfn/template.yaml', text: [
    'Resources:',
    '  Params:',
    '    Type: AWS::ElastiCache::ParameterGroup',
    '    Properties:',
    '      CacheParameterGroupFamily: redis7',
    '      Properties:',
    '        maxmemory-policy: noeviction',
    '  Cache:',
    '    Type: AWS::ElastiCache::ReplicationGroup',
    '    Properties:',
    '      Engine: valkey',
    '      EngineVersion: "8.0"',
    '      CacheParameterGroupName: !Ref Params',
    '  Fn:',
    '    Type: AWS::Serverless::Function',
    '    Properties:',
    '      Environment:',
    '        Variables:',
    '          CACHE_HOST: !GetAtt Cache.PrimaryEndPoint.Address',
  ].join('\n') }] }, ictx).redisInfra
  eq(brief(cfn), ['Cache ElastiCache replication group: Valkey 8.0 | - | noeviction | null | null | null | CACHE_HOST@19'], 'CloudFormation: a replication group, its parameter group by Ref, the variable a function sets to it by GetAtt')
  const { tfLevel } = await import('../lib/data/extractors/terraform.mjs')
  const { tableLevel } = await import('../lib/data/readers/dynamodb.mjs')
  eq([tfLevel('m/a.tf', 'resource "aws_elasticache_cluster" "c" {}'), tfLevel('m/a.tf', 'resource "aws_dynamodb_table" "t" {}\nresource "helm_release" "r" {\n  chart = "redis"\n}'), tableLevel('Resources:\n  C:\n    Type: AWS::MemoryDB::Cluster\n')], [9, 12, 8], 'found by content: a module\'s level and a template\'s carry bit 8, the table readers\' levels kept beside it')
  const [lv, tl] = timed(() => tfLevel('m/a.tf', ' '.repeat(300000) + 'chart' + ' '.repeat(300000) + '= "x'))
  ok(lv === 1 && tl < 1000, `the content filter on 600 KB of blanks: linear (${tl} ms)`)
}

// ════ Part 2 · through call(), on an indexed project (fixtures/redis) ════
const { dataOf, stubPage } = await import('./data-kit.mjs')
const strip = (t) => t.replace(/\n\nLeads, not facts:[^\n]*$/, '')
// every file under a folder, as bytes in latin1 (a SQLite file's pages included)
const allBytes = (dir) => { const out = []; for (const f of readdirSync(dir)) { const p = path.join(dir, f); out.push(statSync(p).isDirectory() ? allBytes(p) : readFileSync(p).toString('latin1')) } return out.join('\n') }
if (RT) {
  const { call } = await import('../lib/commands.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { loadProject } = await import('../lib/project.mjs')
  const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-redis-')))
  try {
    console.log('\n5 · two repositories, no instance wired: a key space each, never grouped by a guess (fixtures/redis, its infra left out)')
    const P1 = path.join(SANDBOX, 'apart')
    cpSync(path.join(HERE, 'fixtures', 'redis'), P1, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') && !src.split(path.sep).includes('infra') })
    writeFileSync(path.join(P1, 'grimoire.config.json'), JSON.stringify({ repos: [{ name: 'api', path: 'api' }, { name: 'web', path: 'web' }], graph: { dir: '.grimoire/graph' } }))
    const q1 = async (tool, args = {}) => strip(await call(`graph_${tool}`, args, { root: P1 }))
    const idx1 = await q1('index')
    ok(/api: 3 files/.test(idx1) && /web: 4 files/.test(idx1) && !idx1.includes('failure'), `index: both repositories, no extractor failure (${idx1.replace(/\n/g, ' | ')})`)
    const list1 = (await q1('data')).split('\n')
    eq(list1.filter((l) => /^\S+:redis /.test(l)), [
      'api:redis  redis  5 key templates · 1 search index · 1 channel · 1 stream · inferred from the commands in code, not declared (13 commands) · no conflicts · 4 leads',
      'web:redis  redis  3 key templates · 2 search indexes · 1 channel · 0 streams · inferred from the commands in code, not declared (6 commands) · no conflicts · 2 leads',
    ], 'graph_data: a key space per repository, labelled inferred (both send cart:{…} and idx:users: no instance ties them)')
    ok(list1.includes('  reached through: redis') && list1.includes('  reached through: ioredis') && list1.filter((l) => /instance: none wired to it/.test(l)).length === 2, '… each reached through its client, no instance wired')
    has(await q1('status'), '2 for the cache commands they send', 'graph_status counts the files whose commands were read')
    const api1 = await q1('data', { store: 'api:redis' })
    has(api1, 'Key templates (5), each part code fills in a placeholder:\n  cart:{cart_id}  hash · no expiry found (lead) · 1 function (0 reading, 1 writing)  api/src/sessions.rs:23', 'graph_data store: each template with its type, lifetime or lead, functions, path:line')
    has(api1, '  user:{user_id}:session  hash · fields: token, device · lifetime 30 min · indexed by idx:users · 1 function (0 reading, 1 writing)  api/src/sessions.rs:12 · api/src/sessions.rs:13', '… a local bound to format! in its function read as the key, its fields and lifetime')
    has(api1, '  rate:{ip}  string · lifetime 1 min · 2 functions (0 reading, 2 writing)  api/src/sessions.rs:5 · api/src/sessions.rs:6 · api/src/sessions.rs:28', '… a Lua script\'s KEYS[1] mapped to the call\'s key: the script\'s INCR and EXPIRE at their lines in the constant')
    has(api1, 'Search indexes (1):\n  idx:users  ON HASH PREFIX user: · 2 fields · covers user:{user_id}:profile, user:{user_id}:session · no access found (lead)', '… a literal FT.CREATE, its PREFIX covering two templates; unqueried in its own key space: a lead')
    has(api1, 'Streams (1):\n  stream:orders  groups: billing (consumers {worker})', '… a stream with its consumer group and the consumer code names')
    const ent1 = await q1('data', { entity: 'api:redis/stream:orders' })
    has(ent1, 'Fields (2), names the code writes literally:\n  kind  stream entry field  — api/src/orders.rs:6\n  order_id  stream entry field  — api/src/orders.rs:6', 'graph_data entity: a stream\'s entry fields')
    has(ent1, 'Consumer groups (1):\n  billing (created in code)  consumers: {worker}  — api/src/orders.rs:12 · api/src/orders.rs:14 · api/src/orders.rs:17', '… its consumer group, created, read and acknowledged')
    has(ent1, 'Reads and writes, from the commands the code sends (inferred; 2 functions: 1 reading, 2 writing):\n  publish_order  writes (XADD)  api/src/orders.rs:5  (the call at line 6) · 0 callers\n  consume  reads · writes (XGROUP, XREADGROUP, XACK)  api/src/orders.rs:11  (the calls at lines 12, 14, 17) · 1 caller', '… its readers and writers per function, a caller counted through the code graph')
    has(await q1('data', { entity: 'cart:{id}' }), '"cart:{id}" names 2 entities; give store/entity or repo:store/entity: api:redis/cart:{cart_id}, web:redis/cart:{cartId}', 'a template found by its form, whatever its placeholders are named; in two key spaces, both named')
    // the page: a key-space card per key space, everything escaped
    writeFileSync(path.join(P1, 'web/src/odd.ts'), "import { redis } from './lib/redis'\nexport const odd = (id: string) => redis.hset(`<img src=x onerror=alert(1)>:${id}`, '<b>f</b>', 1)\n")
    await q1('index')
    const page1 = await renderGraph(loadProject(P1))
    const D1 = dataOf(page1).data
    const W1 = D1.stores.find((x) => x.id === 'web:redis')
    eq([D1.stores.map((x) => x.id), W1.ks.tpl.map((t) => `${t.n}:${t.type}`), W1.ks.tree.map(([seg, d]) => `${'.'.repeat(d)}${seg}`), W1.ks.ix.map((x) => `${x.n} ${x.decl} ${x.lead}`), D1.redis],
      [['api:redis', 'web:redis'], ['<img src=x onerror=alert(1)>:{id}:hash', 'cart:{cartId}:string', 'product:{id}:JSON', 'user:{userId}:session:hash'], ['<img src=x onerror=alert(1)>:', '.{id}', 'cart:', '.{cartId}', 'product:', '.{id}', 'user:', '.{userId}:', '..session'], ['idx:products 1 1', 'idx:users 0 0'], { files: 6, commands: 20, spaces: 2, dyn: 0, tests: 0 }],
      'the page packs each key space: its templates and their types, the prefix tree, its indexes (declared, unqueried)')
    ok(!page1.includes('<img src=x') && !page1.includes('<b>f</b>') && page1.includes('\\u003cimg src=x'), 'names the code writes are escaped in the page\'s data, never markup')
    const pg1 = await stubPage(page1, `#data-${D1.stores.findIndex((x) => x.id === 'web:redis')}`)
    const txt1 = pg1.text()
    ok(txt1.includes('Read from the commands in code, not declared') && !!pg1.ctl('data-keyspace') && txt1.includes('inferred: no instance wired') && txt1.includes('Key templates (4), as a prefix tree'), 'the Data tab: the key-space card under its banner, no instance wired, its templates as a prefix tree')
    ok(txt1.includes('no expiry found (lead)') && txt1.includes('TTL 1 h') && txt1.includes('Search indexes (2)') && txt1.includes('idx:products') && txt1.includes('no access found (lead)') && txt1.includes('Channels (1)') && txt1.includes('listenOrders'), '… each template\'s lifetime or lead, the indexes with their lead, the channel and its subscriber')
    ok(pg1.lines('LI').some((l) => l.includes('<img src=x onerror=alert(1)>:')) && !pg1.all((n) => n.tagName === 'IMG').length, '… a name with markup drawn as text through h(), never an element')
    const tplRows = () => pg1.all((n) => n.attrs && n.attrs['data-tpl'] !== undefined).map((n) => web1Name(n.attrs['data-tpl']))
    const web1Name = (i) => W1.ks.tpl[Number(i)].n
    eq(tplRows().length, 4, '… a row per template')
    pg1.search('saveCart'); eq(tplRows(), ['cart:{cartId}'], 'search narrows the templates by a function writing them')
    pg1.search('session'); eq(tplRows(), ['user:{userId}:session'], '… or by a name')
    console.log('\n7 · one instance wired to both repositories by Compose through REDIS_URL (fixtures/redis): one key space, the issue\'s "done when"')
    const P2 = path.join(SANDBOX, 'wired')
    cpSync(path.join(HERE, 'fixtures', 'redis'), P2, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
    const q2 = async (tool, args = {}) => strip(await call(`graph_${tool}`, args, { root: P2 }))
    const idx2 = await q2('index')
    ok(!idx2.includes('failure'), `index: three repositories, no extractor failure (${idx2.replace(/\n/g, ' | ')})`)
    const list2 = (await q2('data')).split('\n')
    eq(list2.filter((l) => /^\S+:redis/.test(l)), ['infra:redis:cache  redis  6 key templates · 2 search indexes · 1 channel · 1 stream · inferred from the commands in code, not declared (19 commands) · 1 conflict · 4 leads'], 'one key space: the Compose service wired to both repositories (never one per repository once an instance ties them)')
    has(list2.join('\n'), '  instance: cache  Compose service  engine Redis Stack 7.4.0-v8 · modules search, JSON, time series, bloom (the redis-stack image) · maxmemory-policy allkeys-lru · persistence AOF · keyspace notifications Ex · databases 4  — infra/compose.yaml:2 [infra redis-infra@1]\n    wired to api through REDIS_URL (set at infra/compose.yaml:11)\n    wired to web through REDIS_URL (set at infra/compose.yaml:15)', 'the instance: engine, version, modules, eviction policy, persistence, notifications, databases; wired to each repository at the line that sets the variable')
    has(list2.join('\n'), '    eviction lead: allkeys-lru may evict any key; 2 templates written with no lifetime (product:{id}, user:{user_id}:profile) lose their data when evicted unless another store holds a copy: a lead, never a verdict', '… the eviction lead')
    const ks2 = await q2('data', { store: 'infra:redis:cache' })
    for (const [line, m] of [
      ['  cart:{cart_id}  hash / string · lifetime 1 h · 2 functions (0 reading, 2 writing)  api/src/sessions.rs:23 · web/src/cart.ts:6  [1 conflict]', 'a type conflict across the two repositories (HINCRBY in Rust, SET in TypeScript)'],
      ['  user:{user_id}:session  hash · fields: token, device · lifetime 30 min · indexed by idx:users · 2 functions (1 reading, 1 writing)  api/src/sessions.rs:12 · api/src/sessions.rs:13 · web/src/cart.ts:10', 'a template both repositories reach: its fields, lifetime, index, the reader in one and the writer in the other'],
      ['  user:{user_id}:profile  hash · fields: name · no expiry found (lead) · indexed by idx:users', 'the no-expiry lead'],
      ['  rate:{ip}  string · lifetime 1 min', 'a Lua script\'s keys mapped'],
      ['Search indexes (2):\n  idx:products  ON JSON PREFIX product: · 2 fields · covers product:{id} · no access found (lead)  web/src/search.ts:8\n  idx:users  ON HASH PREFIX user: · 2 fields · covers user:{user_id}:profile, user:{user_id}:session · 1 query  api/src/sessions.rs:33', 'an index created in Rust, queried in TypeScript, covering its PREFIX\'s templates; an unqueried index a lead'],
      ['Channels (1):\n  orders:events  1 publisher · 1 subscriber · across api, web  api/src/orders.rs:7 · web/src/events.ts:5', 'a channel published in one repository and subscribed in the other'],
      ['Streams (1):\n  stream:orders  groups: billing (consumers {worker})', 'a stream with its consumer group'],
    ]) has(ks2, line, m)
    const cart2 = await q2('data', { entity: 'cart:{id}' })
    has(cart2, 'Conflicts (1): the commands disagree on its type (WRONGTYPE at run time); each side is kept\n  type: hash — api/src/sessions.rs:23 | string — web/src/cart.ts:6', 'graph_data entity: the conflict with both sides, never resolved')
    has(cart2, '  add_to_cart  writes (HINCRBY)  api/src/sessions.rs:22  (the call at line 23) · 0 callers\n  saveCart  writes (SET)  web/src/cart.ts:5  (the call at line 6) · 0 callers', '… its writers in both repositories')
    has(await q2('data', { entity: 'infra:redis:cache/index:idx:users' }), 'Queries (1 function, from the commands the code sends: inferred):\n  searchUsers  queries (FT.SEARCH)  web/src/search.ts:3  (the call at line 4) · 0 callers', 'the index\'s query, in the other repository')
    const page2 = await renderGraph(loadProject(P2))
    const K2 = dataOf(page2).data.stores.find((x) => x.id === 'infra:redis:cache').ks
    eq([K2.inst.engine, K2.inst.modules, K2.inst.eviction, K2.wired.map((w) => `${w.repo} ${w.env}`), K2.tpl.find((t) => t.n === 'cart:{cart_id}').cf.map((c) => c.values.map((v) => v.value))], ['Redis Stack', ['search', 'JSON', 'time series', 'bloom'], 'allkeys-lru', ['api REDIS_URL', 'web REDIS_URL'], [['hash', 'string']]], 'the page: the key-space card\'s header from the instance, its wiring, the conflict badged')
    const pg2 = await stubPage(page2, `#data-${dataOf(page2).data.stores.findIndex((x) => x.id === 'infra:redis:cache')}`)
    ok(pg2.text().includes('maxmemory-policy') && pg2.text().includes('allkeys-lru') && pg2.text().includes('≠ hash ≠ string') && !pg2.ctl('data-keyspace'), '… drawn: the instance\'s header, the conflict, no "inferred" banner on an instance\'s key space')

    console.log('\n8 · a branch against its base (graph_changes: templates, fields, indexes, channels and the instance; never access), and a delta\'s targets')
    const git = (...a) => spawnSync('git', ['-C', P2, ...a], { encoding: 'utf8' })
    const commit = (m) => { git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', m) }
    git('init', '-q', '-b', 'main'); commit('the key space')
    git('switch', '-q', '-c', 'feat')
    const edit2 = (rel, fn) => { const f = path.join(P2, rel); writeFileSync(f, fn(readFileSync(f, 'utf8'))) }
    edit2('web/src/cart.ts', (t) => t.replace("await redis.set(`cart:${cartId}`, JSON.stringify(items), 'EX', CART_TTL)", "await redis.hset(`cart:${cartId}`, 'items', JSON.stringify(items))\n  await redis.lpush(`audit:${cartId}`, 'saved')\n  await redis.publish('cart:events', cartId)").replace("return redis.hgetall(`user:${userId}:session`)", "return redis.hgetall(`user:${userId}:session`) // read only"))
    edit2('api/src/sessions.rs', (t) => t.replace('.arg("email").arg("TAG")', '.arg("email").arg("TAG").arg("nick").arg("TAG")'))
    edit2('infra/compose.yaml', (t) => t.replace('--maxmemory-policy allkeys-lru', '--maxmemory-policy volatile-lru'))
    commit('a template, a field, an index field, a channel; the eviction policy')
    const ch = await q2('changes', { base: 'main' })
    for (const [line, m] of [
      ['infra:redis:cache  redis  modified', 'the key space changed'],
      ['maxmemory-policy: allkeys-lru → volatile-lru', 'the instance\'s eviction policy, as the infrastructure states it'],
      ['+ audit:{cartId}  key template, list', 'a template added'],
      ['+ channel:cart:events  channel', 'a channel added'],
      ['cart:{cart_id}', 'a template whose type changed (it was a conflict, now a hash on both sides)'],
      ['+ cart:{cart_id}.items  hash field', 'a field added'],
      ['+ index:idx:users.nick  TAG', 'an index\'s schema field added (FT.CREATE, a declaration)'],
    ]) has(ch, line, `graph_changes: ${m}`)
    ok(!/readSession|HGETALL|lifetime|function/.test(ch), '… never access: readers, writers and lifetimes are not compared')
    mkdirSync(path.join(P2, 'docs/specs'), { recursive: true })
    writeFileSync(path.join(P2, 'docs/specs/2026-11-08-cart.delta.json'), JSON.stringify({ schema: 1, spec: 'docs/specs/2026-11-08-cart.md', architecture: [], data: [
      { id: 'audit', op: 'add', target: 'infra:redis:cache/audit:{id}', after: { type: 'list' }, why: 'an audit trail', origin: 'planned' },
      { id: 'items', op: 'add', target: 'infra:redis:cache/cart:{id}.items', why: 'a cart as a hash', origin: 'planned' },
      { id: 'nick', op: 'add', target: 'infra:redis:cache/index:idx:users.nick', after: { type: 'TAG' }, why: 'search by nickname', origin: 'planned' },
      { id: 'chan', op: 'add', target: 'infra:redis:cache/channel:cart:events', why: 'cart events', origin: 'planned' },
      { id: 'stream', op: 'change', target: 'infra:redis:cache/stream:stream:orders', after: { type: 'stream' }, why: 'kept', origin: 'planned' },
      { id: 'later', op: 'add', target: 'infra:redis:cache/index:idx:carts', why: 'not built yet', origin: 'planned' },
      { id: 'gone', op: 'remove', target: 'infra:redis:cache/rate:{ip}', why: 'no rate limit', origin: 'planned' },
      { id: 'kept', op: 'add', target: 'infra:redis:cache/user:{id}:session', after: { type: 'hash' }, why: 'sessions', origin: 'planned' },
    ] }, null, 2))
    const dl2 = await q2('changes', { delta: 'docs/specs/2026-11-08-cart.delta.json', base: 'main' })
    for (const id of ['audit', 'items', 'nick', 'chan', 'stream']) has(dl2, `planned and built  ${id}  `, `the delta: ${id} planned and built (its target found: a template by its form and its type, a field, an index's field, a channel, a stream by its template)`)
    has(dl2, 'pending  later  add infra:redis:cache/index:idx:carts', '… an index not built yet: pending')
    has(dl2, 'Unplanned (1): in the branch, in no change of the delta\n  ~ infra:redis:cache/cart:{cart_id}  type: hash / string → hash', '… the type the branch changed, in no change of the delta: unplanned')
    // the page with that delta: never a crash; the key-space card lists its changes with their states
    let page3 = null
    try { page3 = await renderGraph(loadProject(P2)) } catch (e) { ok(false, `the page renders with a delta over a key space (${e.message})`) }
    if (page3) {
      const D3 = dataOf(page3).data
      const n3 = D3.stores.findIndex((x) => x.id === 'infra:redis:cache')
      eq([D3.deltas[0].errors, D3.deltas[0].stores[n3], D3.deltas[0].changes.filter((c) => c.store === n3).map((c) => `${c.id} ${c.state}`)], [[], null, ['audit planned-built', 'items planned-built', 'nick planned-built', 'chan planned-built', 'stream planned-built', 'later pending', 'gone pending', 'kept planned-built']],
        'the page renders a delta over a key space (an existing target, a pending add, a removal): no table overlay, each change with its state')
      const pg3 = await stubPage(page3, `#data-${n3}`)
      const list3 = pg3.ctl('data-ks-delta')
      ok(!!list3 && pg3.textOf(list3).includes('planned and built') && pg3.textOf(list3).includes('pending') && pg3.textOf(list3).includes('gone'), '… the key-space card lists them')
    }
    const { parseTarget } = await import('../lib/data/delta.mjs')
    eq([parseTarget('api:redis/index:idx:docs.$.title'), parseTarget('api:redis/user:{id}:session.token').entity, parseTarget('infra:redis:cache/channel:a:b').storeId], [{ repo: 'api', store: 'redis', storeId: 'api:redis', entity: 'index:idx:docs', kind: 'field', el: { name: '$.title' } }, 'user:{id}:session', 'infra:redis:cache'], 'the targets: a key space\'s index (a JSON path its field), a template\'s field, a channel, under an instance\'s store id')

    console.log('\n6 · a secret planted at runtime in a SET value, an HSET value, a PUBLISH payload, a Lua literal and a connection URL: found in no output')
    const SECRET = ['Pl4nt', 'ed', String(process.pid % 89), 'Zq'].join('')
    writeFileSync(path.join(P1, 'web/src/planted.ts'), [
      "import Redis from 'ioredis'",
      `const r = new Redis('redis://user:${SECRET}@cache.internal:6379/2')`,
      'export async function plant(id: string) {',
      `  await r.set(\`cfg:\${id}\`, '${SECRET}')`,
      `  await r.hset(\`cfg:\${id}:h\`, 'field', '${SECRET}')`,
      `  await r.publish('cfg:chan', '${SECRET}')`,
      `  await r.eval("local x = '${SECRET}' redis.call('SET', KEYS[1], '${SECRET}') return x", 1, \`cfg:\${id}:lua\`)`,
      `  await r.hset(\`cfg:\${id}:spread\`, { ...base, name: '${SECRET}' })`,
      `  await r.mset({ ...base, 'cfg:m1': '${SECRET}' })`,
      `  await r.hmset('cfg:hm', { ...base, g: '${SECRET}' })`,
      '}',
      'const base: Record<string, string> = {}',
    ].join('\n'))
    mkdirSync(path.join(P1, 'web/jobs'), { recursive: true })
    writeFileSync(path.join(P1, 'web/jobs/planted.py'), [
      'import redis',
      'r = redis.Redis()',
      'def plant(base):',
      `    r.hset(name="cfg:py", key="fld", value="${SECRET}")`,
      `    r.hset("cfg:py2", mapping={"g": "${SECRET}"})`,
      `    r.publish(channel="cfg:pych", message="${SECRET}")`,
      `    r.hmset("cfg:py3", {"h": "${SECRET}"})`,
      `    r.xadd(name="cfg:pys", fields={"o": "${SECRET}"})`,
      `    r.mset({"cfg:py4": "${SECRET}"})`,
    ].join('\n'))
    await q1('index')
    const outs = [await q1('data'), await q1('data', { store: 'web:redis' }), await q1('data', { entity: 'web:redis/cfg:{id}' }), await q1('data', { entity: 'web:redis/cfg:{id}:lua' }), await q1('status'), await renderGraph(loadProject(P1))]
    has(outs[1], 'cfg:{id}:lua', 'the planted file is read (its keys are there)')
    for (const k of ['cfg:{id}:spread  hash · fields: name', 'cfg:hm  hash · fields: g', 'cfg:m1  string', 'cfg:py  hash · fields: fld', 'cfg:py2  hash · fields: g', 'cfg:py3  hash · fields: h', 'cfg:pys  stream · fields: o', 'cfg:py4  string']) has(outs[1], k, `… ${k.split('  ')[0]}: its key and fields read, the planted value none of them`)
    has(outs[1], 'cfg:pych', '… a channel by its keyword')
    has(outs[0], '  database: 2 (a connection URL at web/src/planted.ts:2)', '… the URL\'s database index kept')
    ok(outs.every((o) => !o.includes(SECRET)), 'the secret is in no graph_data answer, no graph_status, not in the page')
    ok(!allBytes(path.join(P1, '.grimoire')).includes(SECRET), '… nor in any file under .grimoire/ (graph.db and its pages included)')
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

// ════ the end ════
console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
