// grimoire graph · data · extractor: the commands a project's code sends a key-value cache (the protocol
// Redis, Valkey, KeyDB, Dragonfly, Upstash, ElastiCache and MemoryDB speak), read where it calls its
// client (spec D2's `inferred` kind, the least trusted; a literal FT.CREATE is a declaration code makes).
// Per file (.ts, .mts, .cts, .tsx; .js, .mjs, .cjs, .jsx; .py; .go; .rs; never a .d.ts), read only when
// its content names a client or a command (level bit 128), through the pinned tree-sitter grammars. It
// never runs the code and never evaluates what code fills in; readers/redis-cmd.mjs reads each command
// as the protocol's arguments, and keeps only names (key templates, fields, channels, indexes), never a
// value.
//
// The clients (CLIENTS, by import): TypeScript and JavaScript ioredis, redis / @redis/* (node-redis),
// @upstash/redis, iovalkey; Rust redis (and the deadpool-redis, bb8-redis pools), fred; Python redis,
// redis.asyncio, aioredis, valkey; Go github.com/redis/go-redis (and go-redis/redis), rueidis, redigo.
// What a call reaches is a client when its receiver, at the root of its method chain, is:
//   bound    a name bound in the file to a client's constructor (`new Redis(…)`, `createClient(…)`,
//            `redis::Client::open(…)`, `redis.NewClient(…)`, `redis.Redis(…)`), to a connection, a
//            pipeline or a transaction taken from one (`.get_multiplexed_async_connection()`, `.pipeline()`,
//            `.multi()`, `.Pipeline()`), or to a call of a function the file imports from a module whose
//            path names the store (`import { getRedis } from '../lib/redis'`);
//   typed    a parameter or a field whose type names a client (`Redis`, `RedisClientType`,
//            `MultiplexedConnection`, `ConnectionManager`, `*redis.Client`, `redis.Cmdable`, `redis.Redis`);
//   name     a name that names the store (`redis`, `this.redis`, `rdb`, `valkey`, `upstash`): a convention;
//   command  in a file that imports a client or binds one, any receiver of a command only this protocol
//            has (`.hset(`, `.zadd(`, `.xadd(`): never one other objects share (`.get(`, `.set(`, `.del(`,
//            `.keys(`, `.publish(`), which needs one of the above.
// The call forms: each client's typed methods (`.hset(`, `.hSet(`, `HSet(ctx, …)`, `.json_set(`,
// `.json.set(`, `.json().set(`, `.ft.create(`, `.ft("idx").search(`); raw commands (`redis::cmd("HSET")
// .arg(…)`, `.call('HSET', …)`, `.sendCommand([…])`, `.execute_command(…)`, `client.Do(ctx, "HSET", …)`,
// `conn.Do("HSET", …)`); pipelines and MULTI (`.pipeline()`, `.multi()`, `redis::pipe().atomic()`,
// `.Pipeline()`, `.TxPipeline()`), each command counted; scripts (`EVAL` with a literal body or a
// same-file constant, `redis::Script::new`, `defineCommand`, `register_script`, `NewScript`,
// `createScript`): the body read by readers/redis-cmd.mjs readLua, its KEYS[n] mapped to the call's
// keys where they are literal, else "keys unknown". A command assembled in steps (a `let mut cmd =
// redis::cmd(…)` given `.arg(…)` after; an array starting with a command's name given `.push(…)`, spread
// into a raw call; a same-file function returning the array or vec of its arguments) is read from its
// literal pushes, and what code builds is said "assembled in code".
// The arguments: a literal; a constant of the same file (what nothing can change, as sql-queries.mjs
// keeps them); a template literal, `format!`, `fmt.Sprintf`, an f-string, `%` and `.format`, a
// concatenation: each part code fills in a placeholder named after the variable that fills it. A Go
// duration (`60 * time.Second`, `time.Hour`) is its seconds.
// Also kept per file: the environment variables it reads (names only: what infra may wire to an
// instance), a literal connection URL's database index (never the rest of it), a client option's
// literal database index (`db: 2`, `DB: 2`, `database: 2`), and the clients it imports.
// Test code (the code graph's test paths, each language's own marks) is counted, not read. Bounded:
// MAX_SITES commands a file, one walk down the tree (a call's function, class and test status come down
// with it) within FILE_MS; the content filter linear in the text.
//
// Facts: { declarations: [], redis: { lang, path, clients: [{ source, line }], env: [{ name, line }],
//   dbs: [{ db, line, how }], sites: [Site], fns: [{ name, line, end }], notes, tests } }
//   Site { line, fn: index into fns (-1 at top level), how (bound | typed | name | command | builder),
//          batch?: pipeline | multi, via?: lua, …readers/redis-cmd.mjs Fact (cmd, family, base, rw,
//          creates, keys, dyn, fields, paths, ttl, glob, channel, stream, index, script, db, tx) }
// A base's file is read too, aside (readers/code-aside.mjs): graph_changes compares key templates and
// FT.CREATE declarations, never the access.
import { readCommand, readLua, mapKeys, urlDb, COMMANDS, lit, template, MAX_ARGS } from '../readers/redis-cmd.mjs'
import { named, field, lineOf, endOf, each } from '../readers/code.mjs'
import { SRC, treeLang } from './dynamo-access.mjs'
import { familyOf, FN, CLASS, TEST_ATTR, TEST_FILE, isTestName, fnName, unescape, FILE_MS } from './sql-queries.mjs'
import { importMatches } from '../../arch.mjs'
import { LANGS, TEST_PATH } from '../../langs.mjs'

const DTS = /\.d\.[cm]?ts$/i
export const MAX_SITES = 1000, MAX_ENV = 16, MAX_DBS = 8

// ── the clients ──
export const CLIENTS = {
  ts: ['ioredis', 'redis', '@redis/client', '@redis/json', '@redis/search', '@redis/time-series', '@upstash/redis', 'iovalkey', '@valkey/valkey-glide'],
  rust: ['redis', 'fred', 'deadpool_redis', 'bb8_redis', 'r2d2_redis', 'redis_pool'],
  python: ['redis', 'redis.asyncio', 'aioredis', 'valkey', 'coredis'],
  go: ['github.com/redis/go-redis', 'github.com/go-redis/redis', 'github.com/redis/rueidis', 'github.com/gomodule/redigo', 'github.com/valkey-io/valkey-go'],
}
export const ALL_CLIENTS = [...new Set(Object.values(CLIENTS).flat())]
const clientOf = (fam, source) => CLIENTS[fam].find((c) => importMatches(source, c)) || null
// a receiver named after the store; a module path naming it
const STORE_NAME = /redis|valkey|upstash|keydb|dragonfly|^rdb$/i
const STORE_PATH = /(?:^|[/._-])(?:redis|valkey|upstash|keydb|dragonfly|kv)(?:$|[/._-])|redis|valkey/i
// a type naming a client
const CLIENT_TYPE = {
  ts: /\b(?:Redis|IORedis|Cluster|RedisClientType|RedisClusterType|RedisClient|ChainableCommander|Pipeline|Multi|RedisMulti\w*|Valkey|GlideClient)\b/,
  rust: /\bredis::|\b(?:MultiplexedConnection|ConnectionManager|ClusterConnection|ConnectionLike|AsyncCommands|Commands|RedisClient|RedisPool|Pipeline|deadpool_redis|bb8_redis|bb8::Pool|fred::)/,
  go: /\b(?:redis|goredis|rueidis|valkey)\.(?:Client|ClusterClient|UniversalClient|Cmdable|Pipeliner|Conn|Ring|PubSub|Tx)\b|\bredis\.Pool\b/,
  python: /\b(?:redis\.)?(?:Redis|StrictRedis|RedisCluster|Pipeline|aioredis\.Redis)\b/,
}
// what makes a client, a connection, a pipeline or a transaction (on the value's text, its literals blank)
const MAKER = {
  ts: /^(?:await\s+)?(?:new\s+(?:Redis|IORedis|Cluster|Valkey)\b|(?:createClient|createCluster|createSentinel)\s*\(|Redis\.fromEnv\s*\()/,
  rust: /\b(?:Client::open|ClusterClient::(?:new|open)|ConnectionManager::new|RedisClient::new|RedisPool::new|Builder::from_config|create_pool)\b|\.get_(?:multiplexed_)?(?:async_|tokio_|sync_)?connection(?:_manager|_with_config)?\s*\(/,
  go: /^(?:&\s*)?(?:redis|goredis|rueidis|valkey)\.(?:New\w*|Dial\w*)\s*\(/,
  python: /^(?:await\s+)?(?:redis\.(?:asyncio\.)?|aioredis\.|valkey\.)?(?:Redis|StrictRedis|RedisCluster|from_url)\s*[.(]|^(?:await\s+)?(?:redis\.(?:asyncio\.)?|aioredis\.)?Redis\.from_url\s*\(/,
}
// methods on a client that return a client, a connection, a pipeline or a transaction
const MAKES = new Set(['pipeline', 'multi', 'duplicate', 'pubsub', 'connect', 'get_connection', 'get_async_connection', 'get_multiplexed_async_connection', 'get_multiplexed_tokio_connection', 'get_connection_manager', 'get_multiplexed_connection', 'Pipeline', 'TxPipeline', 'Conn', 'Subscribe', 'PSubscribe', 'clone', 'get', 'Get', 'acquire', 'client', 'isolated', 'executeIsolated'])
const PIPES = new Map([['pipeline', 'pipeline'], ['multi', 'multi'], ['Pipeline', 'pipeline'], ['TxPipeline', 'multi'], ['pipe', 'pipeline'], ['atomic', 'multi'], ['transaction', 'multi'], ['Pipelined', 'pipeline'], ['TxPipelined', 'multi']])
const RAW = new Set(['call', 'sendCommand', 'send_command', 'execute_command', 'Do', 'do', 'command', 'rawCommand', 'sendCommandAsync'])
const NAMESPACES = new Set(['json', 'ft', 'ts'])
// commands other objects share a method name with: only on a receiver known to be a client
const GENERIC = new Set('GET SET DEL EXISTS KEYS TYPE SCAN INCR DECR APPEND RENAME PUBLISH SUBSCRIBE UNSUBSCRIBE EVAL SORT COPY MOVE DUMP OBJECT TOUCH WATCH MULTI EXEC PING ECHO INFO CONFIG TIME WAIT SELECT QUIT AUTH CLIENT STRLEN UNLINK DISCARD HELLO FUNCTION SCRIPT LCS SUBSTR MGET MSET TTL PERSIST RESTORE EXPIRE INCRBY DECRBY GETRANGE SETRANGE GETSET FLUSHDB FLUSHALL DBSIZE'.split(' '))
// typed method names that are not the command's own (after `_` dropped and lower-cased)
const ALIAS = {
  setmultiple: 'MSET', hsetmultiple: 'HSET', hsetnx: 'HSETNX', zaddmultiple: 'ZADD', zremmultiple: 'ZREM', zincr: 'ZINCRBY', saddmultiple: 'SADD',
  xaddmap: 'XADD', xaddmaxlen: 'XADD', xaddmaxlenmap: 'XADD', xreadoptions: 'XREAD', xgroupcreatemkstream: 'XGROUP', xgroupcreate: 'XGROUP', xgroupcreateconsumer: 'XGROUP', xgroupdestroy: 'XGROUP', xgroupdelconsumer: 'XGROUP', xgroupsetid: 'XGROUP',
  setoptions: 'SET', setargs: 'SET', getex: 'GETEX', expireat: 'EXPIREAT', pexpireat: 'PEXPIREAT',
  scaniter: 'SCAN', scanstream: 'SCAN', scaniterator: 'SCAN', scanmatch: 'SCAN', hscaniter: 'HSCAN', hscanstream: 'HSCAN', hscaniterator: 'HSCAN', hscanmatch: 'HSCAN', sscaniter: 'SSCAN', sscanstream: 'SSCAN', sscaniterator: 'SSCAN', sscanmatch: 'SSCAN', zscaniter: 'ZSCAN', zscanstream: 'ZSCAN', zscaniterator: 'ZSCAN', zscanmatch: 'ZSCAN',
  incrfloat: 'INCRBYFLOAT', hincrbyfloat: 'HINCRBYFLOAT', hincr: 'HINCRBY', zincrby: 'ZINCRBY', zrangewithscores: 'ZRANGE', zrevrangewithscores: 'ZREVRANGE', zrangebyscorewithscores: 'ZRANGEBYSCORE',
  createindex: 'FT.CREATE', dropindex: 'FT.DROPINDEX', altersschemaadd: 'FT.ALTER', alterschemaadd: 'FT.ALTER',
}
// the command a typed method sends → { cmd, norm } | null
export function typedCommand(name, ns = null) {
  if (typeof name !== 'string' || name.length > 40) return null
  const norm = name.replace(/_/g, '').toLowerCase()
  if (ns) { const c = `${ns.toUpperCase()}.${norm.toUpperCase()}`; return COMMANDS.has(c) ? { cmd: c, norm } : ns === 'ft' && ALIAS[norm]?.startsWith('FT.') ? { cmd: ALIAS[norm], norm } : null }
  if (ALIAS[norm]) return { cmd: ALIAS[norm], norm }
  if (COMMANDS.has(norm.toUpperCase())) return { cmd: norm.toUpperCase(), norm }
  for (const p of ['json', 'ft', 'ts']) if (norm.startsWith(p) && COMMANDS.has(`${p.toUpperCase()}.${norm.slice(p.length).toUpperCase()}`)) return { cmd: `${p.toUpperCase()}.${norm.slice(p.length).toUpperCase()}`, norm }
  return null
}

// ── what a file holds that this reads (registry.mjs inspect: bit 128) ──
// Run on every source file at index time, so linear: alternations of literals, no two repetitions
// that can match the same characters.
const LEVEL = /\b(?:ioredis|iovalkey|aioredis|redis|valkey|upstash|fred|deadpool_redis|bb8_redis|rueidis|redigo|keydb|dragonfly)\b|redis::|\.(?:h(?:set|get|getall|mset|mget|del|incrby|exists|keys|vals|len|setnx|scan)|z(?:add|range|rangebyscore|revrange|incrby|score|rem|card|count|rank|popmin|popmax)|s(?:add|rem|members|ismember|card|pop|scan|inter|union|diff)|l(?:push|range|trim|len|pop|rem|index)|r(?:push|pop)|x(?:add|read|readgroup|ack|trim|len|range|group\w*|pending|claim|autoclaim)|expire|pexpire|setex|psetex|setnx|getex|pfadd|pfcount|geoadd|geosearch|setbit|getbit|psubscribe)\s*\(/i
export const redisLevel = (p, text) => (treeLang(p) && !DTS.test(p) && LEVEL.test(text) ? 128 : 0)

// ── per language: the node kinds this reads ──
const CALL = { ts: 'call_expression', rust: 'call_expression', go: 'call_expression', python: 'call' }
const unwrap = (n, fam) => {
  for (let i = 0; n && i < 16; i++) {
    const t = n.type
    if (t === 'parenthesized_expression' || t === 'await_expression' || t === 'await' || t === 'non_null_expression' || t === 'as_expression' || t === 'satisfies_expression' || t === 'try_expression' || (fam === 'rust' && t === 'reference_expression') || (fam === 'go' && t === 'unary_expression' && n.text.startsWith('&'))) { n = t === 'reference_expression' ? field(n, 'value') || n.namedChildren[0] : t === 'unary_expression' ? field(n, 'operand') || n.namedChildren[0] : n.namedChildren[0]; continue }
    break
  }
  return n
}
// a call's method and receiver, or a plain function call's name
function callee(n, fam) {
  let fn = field(n, 'function')
  if (!fn) return null
  if (fam === 'rust' && fn.type === 'generic_function') fn = field(fn, 'function') || fn
  if (fam === 'ts' && fn.type === 'member_expression') return { name: field(fn, 'property')?.text, recv: field(fn, 'object') }
  if (fam === 'rust' && fn.type === 'field_expression') return { name: field(fn, 'field')?.text, recv: field(fn, 'value') }
  if (fam === 'go' && fn.type === 'selector_expression') return { name: field(fn, 'field')?.text, recv: field(fn, 'operand') }
  if (fam === 'python' && fn.type === 'attribute') return { name: field(fn, 'attribute')?.text, recv: field(fn, 'object') }
  return { name: fn.text.length <= 120 ? fn.text : '', recv: null }
}
const MEMBER = { ts: ['member_expression', 'object', 'property'], rust: ['field_expression', 'value', 'field'], go: ['selector_expression', 'operand', 'field'], python: ['attribute', 'object', 'attribute'] }
const argNodes = (call, fam) => {
  const a = field(call, 'arguments')
  if (!a) return []
  if (fam === 'ts' && a.type === 'template_string') return [a]
  return a.namedChildren.filter((c) => c.type !== 'comment')
}
const lastName = (t) => { const m = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(String(t).slice(-80)); return m ? m[1] : '' }

// A method chain, from its outermost call: { root: { call?, node, name, args? }, links: [{ name, call?,
// args?, prop? }] } in order from the root outward. Bounded.
function chainOf(n, fam) {
  const links = []
  let cur = n
  for (let guard = 0; guard < 64; guard++) {
    cur = unwrap(cur, fam)
    if (!cur) break
    if (cur.type === CALL[fam]) {
      const c = callee(cur, fam)
      if (!c || !c.name) break
      if (c.recv) { links.push({ name: c.name, call: cur, args: argNodes(cur, fam) }); cur = c.recv; continue }
      return { root: { call: cur, node: cur, name: c.name, args: argNodes(cur, fam) }, links: links.reverse() }
    }
    const [t, o, p] = MEMBER[fam]
    if (cur.type === t) { links.push({ name: field(cur, p)?.text || '', prop: true }); cur = field(cur, o); continue }
    return { root: { node: cur, name: cur.text.length <= 120 ? cur.text : '' }, links: links.reverse() }
  }
  return { root: { node: cur, name: '' }, links: links.reverse() }
}

// ── arguments, as readers/redis-cmd.mjs takes them ──
// the name a part code fills in goes by: a variable's, a member's last, a call's receiver or argument
function holeName(n, fam, depth = 0) {
  if (!n || depth > 8) return ''
  n = unwrap(n, fam)
  if (!n) return ''
  const t = n.type
  if (t === 'identifier' || t === 'field_identifier' || t === 'property_identifier' || t === 'shorthand_property_identifier') return n.text.length <= 40 ? n.text : ''
  const [mt, , mp] = MEMBER[fam]
  if (t === mt) return field(n, mp)?.text || ''
  if (t === CALL[fam]) {
    const c = callee(n, fam)
    if (c?.recv) return holeName(c.recv, fam, depth + 1)
    const a = argNodes(n, fam)[0]
    return a ? holeName(a, fam, depth + 1) : lastName(c?.name || '')
  }
  if (t === 'reference_expression' || t === 'unary_expression' || t === 'type_cast_expression' || t === 'index_expression' || t === 'subscript' || t === 'subscript_expression') return holeName(n.namedChildren[0], fam, depth + 1)
  return ''
}
const H = (n, fam) => ({ h: holeName(n, fam) })
const S = (t) => ({ s: [t] })
// a part code fills in: a same-file constant's text (or a literal), else a placeholder named after it
function sub(n, F, depth) {
  const u = unwrap(n, F.fam)
  if (u && u.type === 'identifier' && F.bind && F.bind.has(u.text)) { const a = F.bind.get(u.text); return a.s ? a.s : a.n !== undefined ? [String(a.n)] : [{ h: a.x || u.text }] }
  if (u && (u.type === 'identifier' ? F.consts.has(u.text) || !!local(u.text, F) : /^(?:string|string_literal|raw_string_literal|interpreted_string_literal)$/.test(u.type) || (u.type === CALL[F.fam] && !!keyFnOf(u, F)))) { const a = argOf(u, F, depth + 1); if (a.s) return a.s }
  return [H(n, F.fam)]
}

// ── key functions: a same-file function or method whose body is one key form (`fn session_key(id:
// &str) -> String { format!("user:{}:session", id) }`, `const key = (id) => \`user:${id}\``), read
// through at its call with each parameter bound to the call's argument (a literal or a constant
// inlined, else a placeholder named after the caller's variable). Never across files; bounded depth.
const RECV_SELF = /^(?:self|this|Self|cls)$/
function keyFnOf(call, F) {
  if (!F.keyFns.size) return null
  const c = callee(call, F.fam)
  if (!c || !c.name) return null
  const name = c.recv ? (RECV_SELF.test(unwrap(c.recv, F.fam)?.text || '') ? c.name : null) : c.name.split(/::|\./).pop()
  if (!name) return null
  if (!c.recv && /::|\./.test(c.name) && !/^(?:Self|self|crate::.*)::/.test(c.name) && c.name.split(/::|\./).length > 2) return null
  return F.keyFns.get(name) || null
}
function keyCall(call, F, depth) {
  const k = keyFnOf(call, F)
  if (!k || depth > 12 || (F.keyDepth || 0) >= 4) return null
  const args = argNodes(call, F.fam).filter((a) => a.type !== 'keyword_argument')
  const bind = new Map()
  k.params.forEach((p, i) => { if (args[i]) { const a = argOf(args[i], F, depth + 1); bind.set(p, a.s || a.n !== undefined ? a : { x: holeName(args[i], F.fam) || p }) } else bind.set(p, { x: p }) })
  const saved = F.bind
  F.bind = bind; F.keyDepth = (F.keyDepth || 0) + 1
  try { const a = argOf(k.body, F, depth + 1); return a.s ? a : null } finally { F.bind = saved; F.keyDepth-- }
}
// a function's parameter names, in order (never Rust's self, Python's self or cls)
function paramsOf(n, fam) {
  const ps = field(n, 'parameters') || field(n, 'parameter')
  if (!ps) return []
  if (ps.type === 'identifier') return [ps.text]
  const out = []
  for (const p of ps.namedChildren) {
    if (fam === 'rust') { if (p.type === 'parameter') out.push(lastName(field(p, 'pattern')?.text || '')); continue }
    if (fam === 'go') { for (const x of p.namedChildren) if (x.type === 'identifier') out.push(x.text); continue }
    if (fam === 'python') { const nm = p.type === 'identifier' ? p.text : lastName((p.namedChildren[0] || p).text); if (nm !== 'self' && nm !== 'cls') out.push(nm); continue }
    out.push(lastName((field(p, 'pattern') || p).text))
  }
  return out.slice(0, 32)
}

// the key functions of a file: its top-level functions, an impl's or a class's methods (a module's too)
const KEY_BODY = /^(?:string|template_string|binary_expression|string_literal|raw_string_literal|macro_invocation|interpreted_string_literal|call_expression|call|concatenated_string|binary_operator)$/
function keyFns(root, F) {
  const fam = F.fam
  const stack = [root]
  for (let k = 0; stack.length && k < 20000 && F.keyFns.size < 2000; k++) {
    const n = stack.pop()
    const t = n.type
    let body = null, params = null, name = null
    if (fam === 'rust' && t === 'function_item') {
      const b = field(n, 'body'), kids = b ? b.namedChildren.filter((c) => c.type !== 'line_comment' && c.type !== 'block_comment') : []
      if (kids.length === 1 && !/statement|declaration/.test(kids[0].type)) body = kids[0]
      params = (field(n, 'parameters')?.namedChildren || []).filter((p) => p.type === 'parameter').map((p) => lastName(field(p, 'pattern')?.text || ''))
      name = field(n, 'name')?.text
    } else if (fam === 'ts' && (t === 'function_declaration' || t === 'method_definition' || (t === 'variable_declarator' && /^(?:arrow_function|function_expression)$/.test(field(n, 'value')?.type || '')))) {
      const fn = t === 'variable_declarator' ? field(n, 'value') : n
      const b = field(fn, 'body')
      if (b && b.type !== 'statement_block') body = b
      else if (b) { const kids = b.namedChildren.filter((c) => c.type !== 'comment'); if (kids.length === 1 && kids[0].type === 'return_statement') body = kids[0].namedChildren[0] || null }
      const ps = field(fn, 'parameters') || field(fn, 'parameter')
      params = ps ? (ps.type === 'identifier' ? [ps.text] : ps.namedChildren.map((p) => lastName((field(p, 'pattern') || p).text))) : []
      name = field(n, 'name')?.text
    } else if (fam === 'python' && t === 'function_definition') {
      const kids = (field(n, 'body')?.namedChildren || []).filter((c) => c.type !== 'comment' && !(c.type === 'expression_statement' && c.namedChildren[0]?.type === 'string'))
      if (kids.length === 1 && kids[0].type === 'return_statement') body = kids[0].namedChildren[0] || null
      params = (field(n, 'parameters')?.namedChildren || []).map((p) => (p.type === 'identifier' ? p.text : lastName((p.namedChildren[0] || p).text))).filter((p) => p !== 'self' && p !== 'cls')
      name = field(n, 'name')?.text
    } else if (fam === 'go' && (t === 'function_declaration' || t === 'method_declaration')) {
      const kids = (field(n, 'body')?.namedChildren || []).filter((c) => c.type !== 'comment')
      if (kids.length === 1 && kids[0].type === 'return_statement') { const l = kids[0].namedChildren[0]; body = l?.type === 'expression_list' ? l.namedChildren[0] : l }
      params = []
      for (const p of field(n, 'parameters')?.namedChildren || []) for (const x of p.namedChildren) if (x.type === 'identifier') params.push(x.text)
      name = field(n, 'name')?.text
    }
    if (name && F.fnNames.size < 4000) F.fnNames.add(name)
    if (name && body && KEY_BODY.test(body.type) && !F.keyFns.has(name)) F.keyFns.set(name, { params, body })
    else if (name && F.keyFns.has(name) && body) F.keyFns.get(name).twice = true
    // into the containers of functions, never into a function's body
    if (/^(?:program|source_file|module|export_statement|lexical_declaration|class_declaration|class_body|class|class_definition|block|impl_item|declaration_list|mod_item|decorated_definition)$/.test(t) && !(t === 'block' && fam !== 'python')) for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
    if (fam === 'python' && t === 'class_definition') { const b = field(n, 'body'); if (b) stack.push(b) }
  }
  for (const [k, v] of F.keyFns) if (v.twice) F.keyFns.delete(k)
}
const withNode = (a, n) => { if (a && n && !Object.prototype.hasOwnProperty.call(a, 'node')) Object.defineProperty(a, 'node', { value: n, enumerable: false }); return a }
// a format string's text with each field a part code fills in, named after its argument
function formatted(text, argNodesList, F, re) {
  const fam = F.fam
  const parts = []
  let last = 0, k = 0
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[0] === '{{' || m[0] === '%%') { parts.push(m[0][0]); continue }
    if (m[0] === '}}') { parts.push('}'); continue }
    const inner = m[1]
    if (inner && /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) { const b = F.bind?.get(inner); parts.push(...(b ? (b.s ? b.s : b.n !== undefined ? [String(b.n)] : [{ h: b.x || inner }]) : F.consts.has(inner) ? sub(F.consts.get(inner), F, 0) : [{ h: inner }])); continue }
    const at = inner && /^\d+$/.test(inner) ? Number(inner) : k++
    parts.push(...(argNodesList[at] ? sub(argNodesList[at], F, 0) : [{ h: '' }]))
  }
  if (last < text.length) parts.push(text.slice(last))
  return { s: parts }
}
const RS_FMT = /\{\{|\}\}|\{([A-Za-z_0-9]*)(?::[^{}]{0,16})?\}/g
const GO_FMT = /%%|%[-+# 0]{0,8}\d{0,8}(?:\.\d{0,8})?[a-zA-Z]/g
const PY_FMT = /\{\{|\}\}|\{([A-Za-z_0-9]*)(?:![rsa])?(?::[^{}]{0,16})?\}/g
const PY_PCT = /%%|%(?:\([A-Za-z_]+\))?[-+# 0]{0,8}\d{0,8}(?:\.\d{0,8})?[a-zA-Z]/g
// Rust: a token tree's comma-separated items
function ttItems(tt) {
  // the commas are anonymous: items split where the source between two named children holds one
  const items = [[]]
  const kids = tt.namedChildren
  for (let i = 0; i < kids.length && items.length <= MAX_ARGS; i++) {
    if (i > 0) { const between = tt.text.slice(kids[i - 1].endIndex - tt.startIndex, kids[i].startIndex - tt.startIndex); if (between.includes(',')) items.push([]) }
    items[items.length - 1].push(kids[i])
  }
  return items.filter((x) => x.length)
}
const GO_UNITS = { Nanosecond: 1e-9, Microsecond: 1e-6, Millisecond: 1e-3, Second: 1, Minute: 60, Hour: 3600 }

export function argOf(n, F, depth = 0) {
  const fam = F.fam
  if (!n || depth > 24) return { x: '' }
  n = unwrap(n, fam)
  if (!n) return { x: '' }
  const t = n.type
  const out = (a) => withNode(a, n)
  if (fam === 'ts') {
    switch (t) {
      case 'string': return out({ s: [n.namedChildren.map((c) => (c.type === 'escape_sequence' ? unescape(c.text) : c.text)).join('')] })
      case 'template_string': return out({ s: n.namedChildren.flatMap((c) => (c.type === 'template_substitution' ? sub(c.namedChildren[0], F, depth) : [c.type === 'escape_sequence' ? unescape(c.text) : c.text])) })
      case 'number': { const v = Number(n.text.replace(/_/g, '')); return out(Number.isFinite(v) ? { n: v } : { x: '' }) }
      case 'true': return out(S('true'))
      case 'false': case 'null': case 'undefined': return out({ b: false })
      case 'binary_expression': return field(n, 'operator')?.type === '+' ? out(concat(argOf(field(n, 'left'), F, depth + 1), argOf(field(n, 'right'), F, depth + 1), field(n, 'left'), field(n, 'right'), fam)) : out({ x: '' })
      case 'identifier': return ident(n, F, depth, out)
      case 'call_expression': { const k = keyCall(n, F, depth); return out(k || { x: holeName(n, fam) }) }
      case 'object': return out({ o: n.namedChildren.map((p) => p.type === 'pair' ? [keyArg(field(p, 'key'), F), argOf(field(p, 'value'), F, depth + 1)] : p.type === 'shorthand_property_identifier' ? [S(p.text), { x: p.text }] : p.type === 'spread_element' ? [{ spread: holeName(p.namedChildren[0], fam) }, null] : null).filter(Boolean) })
      case 'array': return out({ a: n.namedChildren.map((c) => (c.type === 'spread_element' ? spreadOf(c.namedChildren[0], F) : argOf(c, F, depth + 1))) })
      case 'arrow_function': case 'function_expression': case 'function': return out({ x: '', fn: true })
      case 'spread_element': return out(spreadOf(n.namedChildren[0], F))
      default: return out({ x: holeName(n, fam) })
    }
  }
  if (fam === 'rust') {
    switch (t) {
      case 'string_literal': return out(/^b/.test(n.text) ? { x: '' } : { s: [unescape(n.text.slice(1, -1))] })
      case 'raw_string_literal': { const m = /^r(#*)"([\s\S]*)"\1$/.exec(n.text); return out(m ? { s: [m[2]] } : { x: '' }) }
      case 'integer_literal': { const v = Number(n.text.replace(/_/g, '').replace(/[iu](?:8|16|32|64|128|size)$/, '')); return out(Number.isFinite(v) ? { n: v } : { x: '' }) }
      case 'boolean_literal': return out(n.text === 'true' ? S('true') : { b: false })
      case 'identifier': return ident(n, F, depth, out)
      case 'array_expression': case 'tuple_expression': return out({ a: n.namedChildren.filter((c) => c.type !== 'attribute_item').map((c) => argOf(c, F, depth + 1)) })
      case 'closure_expression': return out({ x: '', fn: true })
      case 'macro_invocation': {
        const name = (field(n, 'macro')?.text || '').split('::').pop()
        const tt = n.namedChildren.find((c) => c.type === 'token_tree')
        if (!tt) return out({ x: name })
        const items = ttItems(tt)
        if (name === 'vec') return out({ a: items.map((it) => (it.length === 1 ? argOf(it[0], F, depth + 1) : { x: lastName(it[it.length - 1].text) })) })
        if (name === 'format' || name === 'formatdoc') {
          const f = items[0]?.length === 1 ? argOf(items[0][0], F, depth + 1) : null
          const text = f ? lit(f) : null
          if (text === null) return out({ x: '' })
          return out(formatted(text, items.slice(1).map((it) => (it.length === 1 ? it[0] : it[it.length - 1])), F, RS_FMT))
        }
        if (name === 'concat') return out({ s: items.map((it) => lit(argOf(it[0], F, depth + 1)) ?? { h: '' }) })
        return out({ x: name })
      }
      case 'call_expression': {
        // Duration::from_secs(60) → 60 seconds; x.to_string() / x.as_str() → named after x
        const fnText = field(n, 'function')?.text || ''
        const a0 = argNodes(n, fam)[0]
        const unit = /Duration::from_(secs|millis|mins|hours)$/.exec(fnText)
        if (unit && a0?.type === 'integer_literal') { const v = Number(a0.text.replace(/_/g, '').replace(/[iu]\d+$/, '')); return out({ n: unit[1] === 'millis' ? v / 1000 : unit[1] === 'mins' ? v * 60 : unit[1] === 'hours' ? v * 3600 : v, dur: true }) }
        // x.to_string(), x.clone(), x.as_str(): x itself (a key form or a key function's call)
        const fe = field(n, 'function')
        if (fe?.type === 'field_expression' && /^(?:to_string|to_owned|clone|as_str|as_ref|into)$/.test(field(fe, 'field')?.text || '') && !argNodes(n, fam).length) { const inner = argOf(field(fe, 'value'), F, depth + 1); if (inner.s) return out(inner) }
        const k = keyCall(n, F, depth)
        return out(k || { x: holeName(n, fam) })
      }
      default: return out({ x: holeName(n, fam) })
    }
  }
  if (fam === 'go') {
    switch (t) {
      case 'interpreted_string_literal': return out({ s: [unescape(n.text.slice(1, -1))] })
      case 'raw_string_literal': return out({ s: [n.text.slice(1, -1)] })
      case 'int_literal': { const v = Number(n.text.replace(/_/g, '')); return out(Number.isFinite(v) ? { n: v } : { x: '' }) }
      case 'true': return out(S('true'))
      case 'false': case 'nil': return out({ b: false })
      case 'identifier': return ident(n, F, depth, out)
      case 'selector_expression': { const u = GO_UNITS[field(n, 'field')?.text]; if (u !== undefined && field(n, 'operand')?.text === 'time') return out({ n: u, dur: true }); return out({ x: field(n, 'field')?.text || '' }) }
      case 'binary_expression': {
        const op = field(n, 'operator')?.type
        const l = argOf(field(n, 'left'), F, depth + 1), r = argOf(field(n, 'right'), F, depth + 1)
        if (op === '*' && l.n !== undefined && r.n !== undefined) return out({ n: l.n * r.n, ...(l.dur || r.dur ? { dur: true } : {}) })
        if (op === '+') return out(concat(l, r, field(n, 'left'), field(n, 'right'), fam))
        return out({ x: '' })
      }
      case 'call_expression': {
        const fn = field(n, 'function')?.text || ''
        const args = argNodes(n, fam)
        if (/^fmt\.Sprintf$/.test(fn)) { const f = args[0] ? argOf(args[0], F, depth + 1) : null; const text = f ? lit(f) : null; return out(text === null ? { x: '' } : formatted(text, args.slice(1), F, GO_FMT)) }
        if (/^(?:strconv\.Itoa|fmt\.Sprint|string)$/.test(fn) && args[0]) return out({ s: [{ h: holeName(args[0], fam) }] })
        const k = keyCall(n, F, depth)
        return out(k || { x: holeName(n, fam) })
      }
      case 'composite_literal': {
        const body = field(n, 'body')
        if (!body) return out({ x: '' })
        const els = body.namedChildren.filter((c) => c.type === 'keyed_element' || c.type === 'literal_element')
        if (els.length && els.every((c) => c.type === 'keyed_element')) return out({ o: els.map((e) => { const [k, v] = e.namedChildren; const kk = k?.namedChildren?.[0] && k.type === 'literal_element' ? k.namedChildren[0] : k; return [kk && (kk.type === 'field_identifier' || kk.type === 'identifier') ? S(kk.text) : argOf(kk, F, depth + 1), argOf(v?.type === 'literal_element' ? v.namedChildren[0] : v, F, depth + 1)] }) })
        return out({ a: els.map((e) => argOf(e.type === 'literal_element' ? e.namedChildren[0] : e, F, depth + 1)) })
      }
      case 'func_literal': return out({ x: '', fn: true })
      case 'variadic_argument': return out(spreadOf(n.namedChildren[0], F))
      default: return out({ x: holeName(n, fam) })
    }
  }
  // python
  switch (t) {
    case 'string': {
      const start = n.namedChildren.find((c) => c.type === 'string_start')?.text || ''
      const prefix = start.replace(/['"]/g, '').toLowerCase()
      if (prefix.includes('b')) return out({ x: '' })
      const parts = []
      for (const c of n.namedChildren) {
        if (c.type === 'string_content') parts.push(prefix.includes('r') ? c.text : unescape(c.text))
        else if (c.type === 'escape_sequence') parts.push(unescape(c.text))
        else if (c.type === 'interpolation') parts.push(...sub(c.namedChildren[0], F, depth))
      }
      return out({ s: parts.length ? parts : [''] })
    }
    case 'concatenated_string': { const parts = []; for (const c of n.namedChildren) { const a = argOf(c, F, depth + 1); if (!a.s) return out({ x: '' }); parts.push(...a.s) } return out({ s: parts }) }
    case 'integer': { const v = Number(n.text.replace(/_/g, '')); return out(Number.isFinite(v) ? { n: v } : { x: '' }) }
    case 'true': return out(S('True'))
    case 'false': case 'none': return out({ b: false })
    case 'identifier': return ident(n, F, depth, out)
    case 'binary_operator': {
      const op = field(n, 'operator')?.type
      if (op === '%') { const l = argOf(field(n, 'left'), F, depth + 1); const text = lit(l); if (text === null) return out({ x: '' }); const r = unwrap(field(n, 'right'), fam); return out(formatted(text, r?.type === 'tuple' ? r.namedChildren : [r], F, PY_PCT)) }
      if (op === '+') return out(concat(argOf(field(n, 'left'), F, depth + 1), argOf(field(n, 'right'), F, depth + 1), field(n, 'left'), field(n, 'right'), fam))
      return out({ x: '' })
    }
    case 'call': {
      const fn = field(n, 'function')
      if (fn?.type === 'attribute' && field(fn, 'attribute')?.text === 'format') { const text = lit(argOf(field(fn, 'object'), F, depth + 1)); if (text !== null) return out(formatted(text, argNodes(n, fam).filter((a) => a.type !== 'keyword_argument'), F, PY_FMT)) }
      if (fn?.text === 'str' && argNodes(n, fam)[0]) return out({ s: [H(argNodes(n, fam)[0], fam)] })
      const k = keyCall(n, F, depth)
      return out(k || { x: holeName(n, fam) })
    }
    case 'dictionary': return out({ o: n.namedChildren.filter((c) => c.type === 'pair').map((p) => [argOf(field(p, 'key'), F, depth + 1), argOf(field(p, 'value'), F, depth + 1)]) })
    case 'list': case 'tuple': return out({ a: n.namedChildren.map((c) => (c.type === 'list_splat' ? spreadOf(c.namedChildren[0], F) : argOf(c, F, depth + 1))) })
    case 'keyword_argument': return out({ kw: field(n, 'name')?.text || '', v: argOf(field(n, 'value'), F, depth + 1) })
    case 'list_splat': return out(spreadOf(n.namedChildren[0], F))
    case 'lambda': return out({ x: '', fn: true })
    default: return out({ x: holeName(n, fam) })
  }
}
// A local a function binds once, before the call, to a key's form (a literal, a template, a format, a
// concatenation): its value; never one of another function, never one bound twice, never anything else
const KEY_FORMS = /^(?:string|template_string|binary_expression|string_literal|raw_string_literal|macro_invocation|interpreted_string_literal|call_expression|concatenated_string|binary_operator|call)$/
function local(name, F) {
  const l = F.locals?.get(name)
  if (!l || l.fn !== F.cur || l.twice || !KEY_FORMS.test(l.node.type)) return null
  if (l.node.type === 'macro_invocation' && !/^(?:format|formatdoc|concat)$/.test((field(l.node, 'macro')?.text || '').split('::').pop())) return null
  const isCall = l.node.type === 'call_expression' || l.node.type === 'call'
  if (isCall && !keyFnOf(l.node, F) && !(F.fam === 'go' && /^fmt\.Sprintf$/.test(field(l.node, 'function')?.text || '')) && !(F.fam === 'python' && /\.format$|^str$/.test(field(l.node, 'function')?.text || '')) && !(F.fam === 'rust' && /\.(?:to_string|to_owned|clone)$/.test(field(l.node, 'function')?.text || ''))) return null
  return l.node
}

// A name: a key function's bound parameter, a same-file constant, a local bound to a key form, else
// unknown; a parameter of the function around it says which (resolved once the file is read, when
// every call of that function in the file passes it one same template)
function ident(n, F, depth, out) {
  if (F.bind?.has(n.text)) return F.bind.get(n.text)
  if (F.consts.has(n.text)) return argOf(F.consts.get(n.text), F, depth + 1)
  const l = local(n.text, F)
  if (l) return argOf(l, F, depth + 1)
  const ps = F.cur?.params
  const lb = F.locals.get(n.text)
  if (ps && ps.includes(n.text) && !(lb && lb.fn === F.cur)) return out({ x: n.text, param: { fn: F.cur.short, i: ps.indexOf(n.text) } })
  return out({ x: n.text })
}

// an object's key: a name, a string, a computed key
function keyArg(k, F) {
  if (!k) return { x: '' }
  if (k.type === 'property_identifier' || k.type === 'identifier') return S(k.text)
  if (k.type === 'computed_property_name') return argOf(k.namedChildren[0], F)
  return argOf(k, F)
}
// a concatenation: both texts' parts, or a part code fills in for a side that is none
function concat(a, b, an, bn, fam) {
  if (!a.s && !b.s) return { x: '' }
  return { s: [...(a.s || [{ h: a.n !== undefined ? String(a.n) : holeName(an, fam) }]), ...(b.s || [{ h: b.n !== undefined ? String(b.n) : holeName(bn, fam) }])].map((p) => (typeof p === 'string' || !/^\d+$/.test(p.h) ? p : p.h)) }
}
// a spread: a same-file array (its elements, pushes included), a call of a same-file function returning
// one (resolved once the file is read), else unknown
function spreadOf(n, F) {
  n = unwrap(n, F.fam)
  if (!n) return { spread: '' }
  if (n.type === 'identifier' && (F.arrays.has(n.text) || F.builders.has(n.text))) return { ref: n.text }
  if (n.type === CALL[F.fam]) { const c = callee(n, F.fam); if (c && !c.recv && /^[A-Za-z_$][\w$]*$/.test(c.name)) return { call: c.name, spread: c.name } }
  return { spread: holeName(n, F.fam) }
}

// ── typed calls → the protocol's arguments ──
const isFn = (a) => a && a.fn
const kwOf = (args, k) => args.find((a) => a.kw === k)?.v
// expand: arrays to their elements (an array of pairs too), objects and maps to key value pairs (a
// false, null or nil value drops its pair, a true one keeps its key alone), Python keywords likewise
function expand(args, depth = 0) {
  const out = []
  for (const a of args) {
    if (!a || isFn(a)) continue
    if (a.kw !== undefined) {
      if (a.kw === 'mapping' || a.kw === 'items' || a.kw === 'fields') { out.push(...expand([a.v], depth + 1)); continue }
      if (a.v && a.v.b === false) continue
      out.push(S(a.kw))
      if (!(a.v && a.v.s && a.v.s.length === 1 && (a.v.s[0] === 'True' || a.v.s[0] === 'true'))) out.push(a.v)
      continue
    }
    if (a.a && depth < 2) { out.push(...expand(a.a, depth + 1)); continue }
    if (a.o && depth < 2) {
      for (const [k, v] of a.o) {
        if (!k) continue
        if (k.spread !== undefined) { out.push(k); continue }
        if (v && v.b === false) continue
        out.push(k)
        if (!(v && v.s && v.s.length === 1 && v.s[0] === 'true')) out.push(v)
      }
      continue
    }
    out.push(a)
  }
  return out
}
const textOf = (a) => (a?.node ? a.node.text.slice(0, 400) : '')
// the protocol's arguments of a typed call, per client form
function protocol(cmd, norm, args0, fam, ftIndex, F) {
  const follow = (a) => (a && a.x && F.vals.has(a.x) ? withNode({ x: a.x }, F.vals.get(a.x)) : a)
  let args = args0.filter((a) => !isFn(a))
  if (fam === 'go' && args.length && !(args[0].s && cmd === 'EVAL')) args = args.slice(1) // a context first
  if (ftIndex) args = [ftIndex, ...args]
  const kw = args.filter((a) => a.kw !== undefined), pos = args.filter((a) => a.kw === undefined)
  const ttlArg = (d) => (d && d.n !== undefined ? (d.n > 0 ? [S('EX'), { n: d.n }] : []) : d ? [S('EX'), d] : [])
  switch (cmd) {
    case 'SET':
      if (fam === 'go' && norm === 'set') return [pos[0], pos[1], ...ttlArg(pos[2])]
      if (fam === 'go' && norm === 'setnx') return [pos[0], pos[1], S('NX'), ...ttlArg(pos[2])]
      if (fam === 'go' && norm === 'setargs') { const o = pos[2]?.o || []; const ttl = o.find(([k]) => lit(k) === 'TTL'); return [pos[0], pos[1], ...ttlArg(ttl?.[1])] }
      if (fam === 'rust' && norm === 'setoptions') { const o = textOf(follow(pos[2])); const m = /\b(EX|PX)\s*\(\s*(\d+)/.exec(o); return [pos[0], pos[1], ...(m ? [S(m[1]), { n: Number(m[2]) }] : /\bKEEPTTL\b|keep_ttl/i.test(o) ? [S('KEEPTTL')] : [])] }
      break
    case 'SETNX': if (fam === 'go') return { cmd: 'SET', args: [pos[0], pos[1], S('NX'), ...ttlArg(pos[2])] }; break
    case 'SETEX': case 'PSETEX': if (fam === 'rust' || fam === 'go') return [pos[0], pos[2], pos[1]]; break
    case 'GETEX': {
      if (fam === 'go') return [pos[0], ...ttlArg(pos[1])]
      if (fam === 'rust') { const m = /\b(EX|PX)\s*\(\s*(\d+)/.exec(textOf(pos[1])); return [pos[0], ...(m ? [S(m[1]), { n: Number(m[2]) }] : pos[1] ? [S('EX'), { x: '' }] : [])] }
      break
    }
    case 'EXPIRE': case 'PEXPIRE': if (fam === 'go' && pos[1]?.dur) return cmd === 'PEXPIRE' ? [pos[0], { n: pos[1].n * 1000 }] : [pos[0], pos[1]]; break
    case 'XADD': {
      if (fam === 'go' && pos[0]?.o) { const o = new Map(pos[0].o.map(([k, v]) => [lit(k), v])); return [o.get('Stream') || { x: '' }, S('*'), ...expand([o.get('Values') || { x: '' }])] }
      if (fam === 'python') return [pos[0], S('*'), ...expand([pos[1] || kwOf(kw, 'fields') || { x: '' }])]
      if (fam === 'rust' && norm.startsWith('xaddmaxlen')) return [pos[0], pos[2], ...expand(pos.slice(3))]
      break
    }
    case 'XREAD': {
      const group = norm === 'xreadoptions' ? /\.group\s*\(/.exec(textOf(follow(pos[2]))) : null
      if (fam === 'rust') {
        const keys = expand([pos[0] || { x: '' }]), ids = expand([pos[1] || { x: '' }])
        if (group) { const g = groupArgs(follow(pos[2]), F); return { cmd: 'XREADGROUP', args: [S('GROUP'), g[0] || { x: '' }, g[1] || { x: '' }, S('STREAMS'), ...keys, ...ids] } }
        return [S('STREAMS'), ...keys, ...ids]
      }
      return streamsForm(cmd, pos, kw, fam) || undefined
    }
    case 'XREADGROUP': return streamsForm(cmd, pos, kw, fam) || undefined
    case 'XGROUP': {
      const sub = { xgroupcreate: 'CREATE', xgroupcreatemkstream: 'CREATE', xgroupcreateconsumer: 'CREATECONSUMER', xgroupdestroy: 'DESTROY', xgroupdelconsumer: 'DELCONSUMER', xgroupsetid: 'SETID' }[norm]
      if (!sub) break
      const mk = norm === 'xgroupcreatemkstream' || kw.some((a) => a.kw === 'mkstream' && lit(a.v) === 'True') || pos.slice(3).some((a) => a.o && a.o.some(([k, v]) => lit(k)?.toUpperCase() === 'MKSTREAM' && v?.b !== false))
      const p3 = pos.filter((a) => !a.o)
      if (sub === 'CREATE') return [S(sub), p3[0] || { x: '' }, p3[1] || { x: '' }, p3[2] || kwOf(kw, 'id') || S('$'), ...(mk ? [S('MKSTREAM')] : [])]
      return [S(sub), ...p3.slice(0, 3)]
    }
    case 'EVAL': case 'EVALSHA': case 'EVAL_RO': case 'EVALSHA_RO': {
      const [script, b, ...rest] = pos
      if (b?.a) return [script, { n: b.a.length }, ...b.a, ...expand(rest)] // (script, keys[], args[]) and Go's (script, []string{…}, args…)
      if (b?.o) { const k = b.o.find(([x]) => lit(x) === 'keys')?.[1]; return k?.a ? [script, { n: k.a.length }, ...k.a] : [script, { x: '' }] }
      break
    }
    case 'SCAN': case 'HSCAN': case 'SSCAN': case 'ZSCAN': {
      const keyed = cmd !== 'SCAN'
      if (fam === 'go' && norm === 'scan') return [pos[0], S('MATCH'), pos[1] || { x: '' }]
      if (fam === 'go') return [pos[0], pos[1], S('MATCH'), pos[2] || { x: '' }]
      if (fam === 'rust' && norm.endsWith('match')) return keyed ? [pos[0], { n: 0 }, S('MATCH'), pos[1]] : [{ n: 0 }, S('MATCH'), pos[0]]
      if (norm !== cmd.toLowerCase()) return keyed ? [pos[0], { n: 0 }, ...expand([...pos.slice(1), ...kw])] : [{ n: 0 }, ...expand([...pos, ...kw])]
      break
    }
    case 'FT.CREATE': return ftCreate(pos, kw, fam, F) || undefined
    default: break
  }
  return undefined
}
// XREAD / XREADGROUP in each client's form → the protocol's arguments (or a renamed command)
function streamsForm(cmd, pos, kw, fam) {
  if (fam === 'go' && pos[0]?.o) { const o = new Map(pos[0].o.map(([k, v]) => [lit(k), v])); const g = o.has('Group') ? [S('GROUP'), o.get('Group') || { x: '' }, o.get('Consumer') || { x: '' }] : []; const list = o.get('Streams')?.a || []; return { cmd: g.length ? 'XREADGROUP' : 'XREAD', args: [...g, S('STREAMS'), ...(list.length ? list : [{ spread: '' }])] } }
  if (lit(pos[0])?.toUpperCase() === 'GROUP' || lit(pos[0])?.toUpperCase() === 'STREAMS' || lit(pos[0])?.toUpperCase() === 'COUNT' || lit(pos[0])?.toUpperCase() === 'BLOCK') return null
  const group = cmd === 'XREADGROUP'
  const head = group ? [S('GROUP'), pos[0] || { x: '' }, pos[1] || { x: '' }] : []
  const rest = group ? pos.slice(2) : pos
  // a dict or an object of key → id (Python streams=, node-redis { key, id } or [{ key, id }])
  const streams = rest[0]?.o ? rest[0] : rest[0]?.a && rest[0].a.every((x) => x.o) ? rest[0] : kw.find((a) => a.kw === 'streams')?.v
  if (streams?.o) {
    const isKeyId = streams.o.some(([k]) => lit(k) === 'key')
    if (isKeyId) return [...head, S('STREAMS'), streams.o.find(([k]) => lit(k) === 'key')[1], streams.o.find(([k]) => lit(k) === 'id')?.[1] || { x: '' }]
    return [...head, S('STREAMS'), ...streams.o.map(([k]) => k), ...streams.o.map(([, v]) => v)]
  }
  if (streams?.a) { const ks = streams.a.map((o) => o.o.find(([k]) => lit(k) === 'key')?.[1] || { x: '' }); return [...head, S('STREAMS'), ...ks, ...ks.map(() => ({ x: '' }))] }
  if (group && rest.length >= 2 && !rest[0].o) return [...head, S('STREAMS'), rest[0], rest[1]] // upstash: (group, consumer, key, id)
  return [...head, S('STREAMS'), { spread: '' }]
}
// the group and consumer a Rust StreamReadOptions names (`.group("g", "c")`)
function groupArgs(opts, F) {
  const n = opts?.node
  if (!n) return []
  let found = null
  each(n, (x) => { if (found) return false; if (x.type === 'call_expression') { const fnn = field(x, 'function'); if (fnn?.type === 'field_expression' && field(fnn, 'field')?.text === 'group') { found = x; return false } } return true })
  return found ? argNodes(found, 'rust').map((a) => argOf(a, F)) : []
}
// FT.CREATE in each client's typed form → the protocol's arguments
const PY_FIELDS = { TextField: 'TEXT', TagField: 'TAG', NumericField: 'NUMERIC', GeoField: 'GEO', VectorField: 'VECTOR', GeoShapeField: 'GEOSHAPE' }
function ftCreate(pos, kw, fam, F) {
  const [name, schema, opts] = pos
  if (fam === 'ts' && schema?.o) {
    // node-redis: (name, { field: SchemaFieldTypes.TEXT | 'TEXT' | { type, AS, SORTABLE, SEPARATOR, WEIGHT } }, { ON, PREFIX })
    const out = [name, ...ftOpts(opts?.o || []), S('SCHEMA')]
    for (const [k, v] of schema.o) {
      if (!k || k.spread !== undefined) { out.push({ spread: '' }); continue }
      out.push(k)
      const typeOf = (a) => { const t = lit(a) ?? (a?.x && /^[A-Z]+$/.test(a.x) ? a.x : null); return t ? S(t.toUpperCase()) : { x: '' } }
      if (v?.o) {
        const m = new Map(v.o.map(([a, b]) => [lit(a)?.toUpperCase(), b]))
        if (m.has('AS')) out.push(S('AS'), m.get('AS'))
        out.push(typeOf(m.get('TYPE')))
        for (const [o, b] of m) if (['SORTABLE', 'NOSTEM', 'NOINDEX', 'CASESENSITIVE', 'WITHSUFFIXTRIE', 'UNF'].includes(o) && b?.b !== false) out.push(S(o)); else if (['SEPARATOR', 'WEIGHT', 'PHONETIC'].includes(o)) out.push(S(o), b)
      } else out.push(typeOf(v))
    }
    return out
  }
  if (fam === 'python') {
    // redis-py: ft(name).create_index([TextField('a', as_name=…, sortable=True), …], definition=IndexDefinition(prefix=[…], index_type=IndexType.HASH))
    const fields = schema || kwOf(kw, 'fields')
    const def = kwOf(kw, 'definition')
    const out = [name]
    const dn = def?.node
    if (dn) {
      const dt = dn.text.slice(0, 600)
      const on = /index_type\s*=\s*IndexType\.(HASH|JSON)/.exec(dt)
      if (on) out.push(S('ON'), S(on[1]))
      const pre = /prefix\s*=\s*\[([^\]]{0,400})\]/.exec(dt)
      if (pre) { const ps = [...pre[1].matchAll(/["']([^"'\n]{1,120})["']/g)].map((m) => m[1]); out.push(S('PREFIX'), { n: ps.length }, ...ps.map(S)) }
    }
    out.push(S('SCHEMA'))
    for (const f of fields?.a || [{ spread: '' }]) {
      const fnode = f?.node
      if (!fnode || fnode.type !== 'call') { out.push({ spread: '' }); continue }
      const cls = lastName(field(fnode, 'function')?.text || '')
      const fa = argNodes(fnode, 'python').map((a) => argOf(a, F))
      const fname = fa.find((a) => a.kw === undefined)
      const type = PY_FIELDS[cls]
      if (!type || !fname) { out.push({ spread: '' }); continue }
      out.push(fname)
      const as = fa.find((a) => a.kw === 'as_name')?.v
      if (as) out.push(S('AS'), as)
      out.push(S(type))
      for (const a of fa) if (a.kw === 'sortable' && lit(a.v) === 'True') out.push(S('SORTABLE')); else if (a.kw === 'no_stem' && lit(a.v) === 'True') out.push(S('NOSTEM')); else if (a.kw === 'separator') out.push(S('SEPARATOR'), a.v); else if (a.kw === 'weight') out.push(S('WEIGHT'), a.v)
    }
    return out
  }
  if (fam === 'go' && opts?.o) {
    // go-redis: FTCreate(ctx, name, &FTCreateOptions{OnHash|OnJSON, Prefix}, &FieldSchema{FieldName, FieldType, As, Sortable}…)
    const o = new Map(opts.o.map(([k, v]) => [lit(k), v]))
    const out = [name]
    if (o.has('OnHash')) out.push(S('ON'), S('HASH')); else if (o.has('OnJSON')) out.push(S('ON'), S('JSON'))
    const pre = o.get('Prefix')?.a
    if (pre) out.push(S('PREFIX'), { n: pre.length }, ...pre)
    out.push(S('SCHEMA'))
    for (const fs of pos.slice(3)) {
      const m = new Map((fs?.o || []).map(([k, v]) => [lit(k), v]))
      if (!m.has('FieldName')) { out.push({ spread: '' }); continue }
      out.push(m.get('FieldName'))
      if (m.has('As')) out.push(S('AS'), m.get('As'))
      const t = /SearchFieldType(\w+)/.exec(textOf(m.get('FieldType')))
      out.push(t ? S(t[1].toUpperCase()) : { x: '' })
      if (m.has('Sortable') && lit(m.get('Sortable')) === 'true') out.push(S('SORTABLE'))
    }
    return out
  }
  return null
}
function ftOpts(o) {
  const out = []
  const m = new Map(o.map(([a, b]) => [lit(a)?.toUpperCase(), b]))
  if (m.has('ON')) out.push(S('ON'), m.get('ON'))
  const p = m.get('PREFIX')
  if (p) { const list = p.a || [p]; out.push(S('PREFIX'), { n: list.length }, ...list) }
  return out
}

// ── constants, arrays and the functions returning one ──
function topDecls(root, F) {
  const fam = F.fam
  for (const top of root.namedChildren) {
    let decl = top
    if (decl.type === 'export_statement') decl = field(decl, 'declaration') || decl.namedChildren[0]
    if (!decl) continue
    if (fam === 'ts' && decl.type === 'lexical_declaration' && field(decl, 'kind')?.text === 'const') for (const v of decl.namedChildren) { if (v.type === 'variable_declarator' && field(v, 'name')?.type === 'identifier' && field(v, 'value')) { const val = unwrap(field(v, 'value'), fam); if (val?.type === 'string' || val?.type === 'template_string' || val?.type === 'binary_expression' || val?.type === 'number') F.consts.set(field(v, 'name').text, val) } }
    else if (fam === 'go' && decl.type === 'const_declaration') each(decl, (s) => { if (s.type !== 'const_spec') return true; const names = s.namedChildren.filter((x) => x.type === 'identifier'); const vals = field(s, 'value') ? field(s, 'value').namedChildren : []; names.forEach((nm, i) => { if (vals[i]) F.consts.set(nm.text, vals[i]) }); return false })
    else if (fam === 'python' && decl.type === 'expression_statement') { const a = decl.namedChildren[0]; if (a?.type === 'assignment' && field(a, 'left')?.type === 'identifier' && /^[A-Z][A-Z0-9_]*$/.test(field(a, 'left').text) && field(a, 'right')) { const nm = field(a, 'left').text; if (F.consts.has(nm)) F.twice.add(nm); F.consts.set(nm, field(a, 'right')) } }
    else if (fam === 'rust' && (decl.type === 'const_item' || (decl.type === 'static_item' && !decl.namedChildren.some((c) => c.type === 'mutable_specifier'))) && field(decl, 'name') && field(decl, 'value')) F.consts.set(field(decl, 'name').text, field(decl, 'value'))
  }
  for (const n of F.twice) F.consts.delete(n)
}

// ── one file ──
export function readRedisFile(tree, lang, file, { ms = FILE_MS } = {}) {
  const fam = familyOf(lang)
  const root = tree.rootNode
  const out = { lang: fam, path: file, clients: [], env: [], dbs: [], sites: [], fns: [], notes: [], tests: 0 }
  const note = (s) => { if (out.notes.length < 8 && !out.notes.includes(s)) out.notes.push(s) }
  const F = { fam, consts: new Map(), twice: new Set(), vals: new Map(), locals: new Map(), keyFns: new Map(), fnNames: new Set(), calls: new Map(), bind: null, cur: null, skip: new Set(), arrays: new Map(), known: new Map(), ctors: new Set(), mods: new Set(), scripts: new Map(), defined: new Map(), builders: new Map(), returns: new Map() }
  const fileTest = TEST_PATH.test(file) || TEST_FILE[fam].test(file)
  const deadline = Date.now() + ms
  let steps = 0, stopped = false
  const late = () => (++steps & 4095) === 0 && Date.now() > deadline
  const spec = LANGS[lang]?.spec
  // the imports: a client's (its names constructors), a module whose path names the store (its names handles)
  each(root, (n) => {
    if (stopped || (late() && (stopped = true))) return false
    const imp = spec?.imports?.[n.type]
    if (!imp) return n.type === 'program' || n.type === 'source_file' || n.type === 'module' || n.type === 'import_declaration' || n.type === 'import_spec_list'
    let list = []
    try { list = imp(n) || [] } catch {}
    for (const im of list) {
      if (!im || !im.source) continue
      const c = clientOf(fam, im.source)
      const names = [...(im.names || []).map((x) => String(x).split('=')[0]), ...(im.alias ? [im.alias] : [])]
      if (c) {
        if (!out.clients.some((x) => x.source === im.source) && out.clients.length < 8) out.clients.push({ source: im.source, client: c, line: lineOf(n) })
        for (const nm of names) F.ctors.add(nm)
        if (fam === 'go') F.ctors.add('redis')
      } else if (STORE_PATH.test(im.source) && !/^(?:node:|@types\/)/.test(im.source)) for (const nm of names) if (nm && nm.length <= 60) F.mods.add(nm)
    }
    return false
  })
  topDecls(root, F)
  keyFns(root, F)
  const evidence = () => out.clients.length > 0 || F.known.size > 0 || F.mods.size > 0
  let dyn = 0
  const pending = [] // commands read once the file is walked: [{ c: { name, args }, line, ctx, how, batch, via }]
  // a site
  const fnIdx = (ctx) => { if (!ctx.fn) return -1; if (ctx.fn.idx < 0) { ctx.fn.idx = out.fns.length; out.fns.push({ name: ctx.fn.name, line: ctx.fn.line, end: ctx.fn.end }) } return ctx.fn.idx }
  const emit = (c, line, ctx, how, extra = {}) => {
    if (fileTest || ctx.test) { out.tests++; return }
    if (pending.length >= MAX_SITES) { if (!out.capped) { out.capped = true; note(`more than ${MAX_SITES} commands: the first ${MAX_SITES} read`) } return }
    pending.push({ c, line, ctx, how, seq: pending.length, ...extra })
  }
  // whether a root or a link names a client: how it is known, or null
  const clientName = (nm) => (F.known.has(nm) ? F.known.get(nm) : nm && STORE_NAME.test(nm) && nm.length <= 40 ? 'name' : F.mods.has(nm) ? 'bound' : null)
  const isMaker = (n) => { const t = n.text.slice(0, 300); return MAKER[fam].test(t) || (fam === 'ts' && [...F.ctors].some((c) => new RegExp(`^(?:await\\s+)?(?:new\\s+)?${c.replace(/[$]/g, '\\$')}(?:\\.\\w+)?\\s*\\(`).test(t))) || (fam === 'python' && [...F.ctors].some((c) => new RegExp(`^(?:await\\s+)?${c.replace(/[$]/g, '\\$')}(?:\\.\\w+)*\\s*\\(`).test(t))) }
  // what a declaration's value makes: a client, a script, a command assembled in steps, an array
  const bindValue = (name, val, ctx, line) => {
    if (!name || !val) return
    const v = unwrap(val, fam)
    if (!v) return
    if (F.vals.size < 2000) F.vals.set(name, v)
    const itself = new RegExp(`^&?\\s*${name.replace(/[$]/g, '\\$')}(?:\\s*\\.\\s*(?:to_string|clone|to_owned|as_str|as_ref|into)\\s*\\(\\s*\\))?$`).test(v.text.slice(0, 200))
    if (ctx.fn && F.locals.size < 4000 && !itself) { const was = F.locals.get(name); F.locals.set(name, { node: v, fn: ctx.fn, twice: !!(was && was.fn === ctx.fn) }) }
    if (itself) return
    const skip = () => { let cur = v; for (let g = 0; g < 64 && cur; g++) { cur = unwrap(cur, fam); if (!cur || cur.type !== CALL[fam]) break; F.skip.add(cur.id); const c = callee(cur, fam); cur = c?.recv || null } }
    if (isMaker(v)) { F.known.set(name, 'bound'); return }
    // an array: a command's arguments when it starts with a command's name, else elements a spread inlines
    if ((fam === 'ts' && v.type === 'array') || (fam === 'python' && v.type === 'list') || (fam === 'rust' && v.type === 'macro_invocation' && /^vec$/.test(field(v, 'macro')?.text || '')) || (fam === 'go' && v.type === 'composite_literal' && /^\[\]/.test(field(v, 'type')?.text || ''))) {
      const a = argOf(v, F)
      const first = a.a?.[0] ? lit(a.a[0]) : null
      if (first && COMMANDS.has(first.toUpperCase()) && first.length > 2) F.builders.set(name, { name: first.toUpperCase(), args: a.a.slice(1), line, ctx, used: false, how: 'builder' })
      else F.arrays.set(name, { args: a.a || [], fn: ctx.fn?.name ?? null })
      return
    }
    if (v.type === CALL[fam] || (fam === 'ts' && v.type === 'new_expression')) {
      const ch = chainOf(v, fam)
      const r = ch.root
      // redis::cmd("X")…: a command assembled in steps; redis::Script::new / NewScript / register_script / createScript: a script
      if (fam === 'rust' && r.call && /(?:^|::)cmd$/.test(r.name)) { const b = rawChain(ch, F, true); if (b) { F.builders.set(name, { ...b, line, ctx, used: false, how: 'builder' }); skip() } return }
      // (the script itself, never what running it returns)
      const lastLink = ch.links[ch.links.length - 1]
      const scriptMaker = r.call && /(?:^|::)(?:Script::new|NewScript)$/.test(r.name) && !ch.links.length ? r.args[0] : lastLink?.call && /^(?:register_script|createScript|NewScript)$/.test(lastLink.name) ? lastLink.args?.[0] : null
      if (scriptMaker) { F.scripts.set(name, { body: scriptBody(scriptMaker, F), line }); skip(); return }
      // a client, a connection, a pipeline taken from a known client; a call of a handle the file imports
      const rootHow = (r.call ? (F.mods.has(r.name) || F.known.has(r.name) || STORE_NAME.test(lastName(r.name)) ? 'bound' : null) : clientName(lastName(r.name))) || (ch.links.some((l) => !l.call && clientName(l.name)) ? 'bound' : null)
      const last = ch.links[ch.links.length - 1]
      if (rootHow && (!last || MAKES.has(last.name) || last.name === 'await' || /^(?:unwrap|expect)$/.test(last.name))) F.known.set(name, 'bound')
      else if (rootHow && ch.links.some((l) => PIPES.has(l.name))) F.known.set(name, 'bound')
    }
  }
  // a script's body: a literal or a same-file constant → { text, line } | null
  const scriptBody = (n, Fx) => { if (!n) return null; const a = argOf(n, Fx); const t = lit(a); if (t === null) return null; const at = unwrap(a.node || n, fam); return { text: t, line: (at || n).startPosition.row + 1 } }
  // read a script's commands into sites, KEYS mapped to `keys` (null: unknown)
  const luaSites = (body, keys, line, ctx, how) => {
    if (!body) return
    const lua = readLua(body.text, body.line)
    for (const nn of lua.notes) note(`a script: ${nn}`)
    for (const c of lua.commands) emit({ name: c.name, args: mapKeys(c.args, keys) }, c.line, ctx, how, { via: 'lua', scriptAt: line })
  }
  // a raw command's chain (`redis::cmd("X").arg(…)…`) → { name, args } | null
  function rawChain(ch, Fx, asBuilder = false) {
    const nm = lit(argOf(ch.root.args?.[0], Fx))
    if (!nm || !COMMANDS.has(nm.toUpperCase())) return null
    const args = []
    for (const l of ch.links) {
      if (l.name === 'arg' || l.name === 'cursor_arg') { for (const a of l.args || []) args.push(...flatArg(argOf(a, Fx))); continue }
      if (asBuilder) break
      break
    }
    return { name: nm.toUpperCase(), args }
  }
  // Rust's .arg(&[…]) and .arg(vec![…]) send each element
  const flatArg = (a) => (a.a ? a.a : a.call ? [{ call: a.call }] : [a])
  // ── the chain of one outermost call ──
  const chainSites = (n, ctx) => {
    const ch = chainOf(n, fam)
    const r = ch.root
    let state = null, how = null, batch = null, ns = null, ftIndex = null, raw = null, script = null
    const flushRaw = () => { if (raw) { emit({ name: raw.name, args: raw.args }, raw.line, ctx, how || 'bound', batch ? { batch } : {}); raw = null } }
    // the root
    if (r.call) {
      if (fam === 'rust' && /(?:^|::)cmd$/.test(r.name)) { const nm = lit(argOf(r.args[0], F)); if (nm && COMMANDS.has(nm.toUpperCase())) { raw = { name: nm.toUpperCase(), args: [], line: lineOf(r.call) }; state = 'raw'; how = 'command' } }
      else if (fam === 'rust' && /(?:^|::)pipe$/.test(r.name)) { state = 'client'; how = 'bound'; batch = 'pipeline' }
      else if (/(?:^|::)(?:Script::new)$/.test(r.name)) { script = { body: scriptBody(r.args[0], F), keys: [], line: lineOf(r.call) }; state = 'script' }
      else if (F.mods.has(r.name) || F.known.has(r.name) || isMaker(r.call) || (STORE_NAME.test(lastName(r.name)) && lastName(r.name).length <= 40)) { state = 'client'; how = F.known.get(r.name) || (isMaker(r.call) ? 'bound' : F.mods.has(r.name) ? 'bound' : 'name') }
      else if (fam === 'python' && F.scripts.has(r.name)) {
        // a registered script called: s(keys=[…], args=[…])
        const s = F.scripts.get(r.name)
        const ks = r.args.map((a) => argOf(a, F)).find((a) => a.kw === 'keys')?.v
        emit({ name: 'EVAL', args: [S(''), ks?.a ? { n: ks.a.length } : { x: '' }, ...(ks?.a || [])] }, lineOf(r.call), ctx, 'bound', { scriptOf: true })
        luaSites(s.body, ks?.a || null, lineOf(r.call), ctx, 'bound')
        return
      }
    } else if (fam === 'ts' && r.node?.type === 'new_expression') { if (isMaker(r.node)) { state = 'client'; how = 'bound' } }
    else {
      const nm = lastName(r.name)
      if (F.builders.has(nm) && r.node?.type === 'identifier') { const b = F.builders.get(nm); for (const l of ch.links) { if (l.name === 'arg' || l.name === 'cursor_arg' || l.name === 'push' || l.name === 'extend') for (const a of l.args || []) b.args.push(...flatArg(argOf(a, F))); else if (/^(?:query|exec|execute|req_command)/.test(l.name)) b.sent = true } return }
      if (F.arrays.has(nm) && r.node?.type === 'identifier') { const arr = F.arrays.get(nm); for (const l of ch.links) if (l.name === 'push' || l.name === 'append' || l.name === 'extend') for (const a of l.args || []) arr.args.push(...(l.name === 'extend' ? flatArg(argOf(a, F)) : [argOf(a, F)])); return }
      if (F.scripts.has(nm) && r.node?.type === 'identifier') { const s = F.scripts.get(nm); script = { body: s.body, keys: [], line: null }; state = 'script' }
      else { const k = clientName(nm); if (k) { state = 'client'; how = k } }
    }
    // the links, from the root outward
    for (let i = 0; i < ch.links.length; i++) {
      const l = ch.links[i]
      if (state === 'raw') {
        if (l.name === 'arg' || l.name === 'cursor_arg') { for (const a of l.args || []) raw.args.push(...flatArg(argOf(a, F))); continue }
        flushRaw(); state = 'client'
      }
      if (state === 'script') {
        if (l.name === 'key') { for (const a of l.args || []) script.keys.push(...flatArg(argOf(a, F))); continue }
        if (l.name === 'arg') continue
        if (/^(?:invoke|invoke_async|prepare_invoke|Run|RunRO|Eval|EvalSha|EvalRO|exec|execRO|eval|evalsha)$/.test(l.name)) {
          // Go's script.Run(ctx, client, keys, args…), upstash's script.exec(keys, args)
          let keys = script.keys
          if (fam === 'go' && l.args?.length >= 3) { const k = argOf(l.args[2], F); keys = k.a || null }
          else if (fam === 'ts' && l.args?.length) { const k = argOf(l.args[0], F); keys = k.a || null }
          const line = lineOf(l.call)
          emit({ name: 'EVAL', args: [S(''), keys ? { n: keys.length } : { x: '' }, ...(keys || [])] }, line, ctx, 'bound', { scriptOf: true })
          luaSites(script.body, keys && keys.every((k) => k.spread === undefined) ? keys : null, line, ctx, 'bound')
          state = null
          continue
        }
        continue
      }
      if (!l.call) {
        // a property: a client's (`this.redis`), a namespace (`redis.json`, `client.ft`)
        if (state === 'client' && NAMESPACES.has(l.name)) { ns = l.name; continue }
        if (state === null) { const k = clientName(l.name); if (k) { state = 'client'; how = k } }
        continue
      }
      const args = (l.args || []).map((a) => argOf(a, F))
      if (state === 'client' || state === null) {
        if (state === 'client' && PIPES.has(l.name) && !args.some((a) => !isFn(a) && a.kw === undefined)) { batch = PIPES.get(l.name) === 'multi' || batch === 'multi' ? 'multi' : 'pipeline'; continue }
        if (state === 'client' && (l.name === 'json' || l.name === 'ft' || l.name === 'ts') && fam === 'python') { ns = l.name; ftIndex = l.name === 'ft' ? args[0] || S('idx') : null; continue }
        if (RAW.has(l.name) && (state === 'client' || evidence())) {
          // .call('HSET', …) · .sendCommand(['HSET', …]) · .Do(ctx, "HSET", …) · conn.Do("HSET", …)
          let list = args.filter((a) => !isFn(a))
          if (list.length === 1 && list[0].a) list = list[0].a
          while (list.length && lit(list[0]) === null && fam === 'go') list = list.slice(1)
          const nm = lit(list[0])
          if (nm && COMMANDS.has(nm.toUpperCase())) {
            const rest = []
            for (const a of list.slice(1)) { if (a.ref && F.builders.has(a.ref)) { const b = F.builders.get(a.ref); b.used = true; rest.push(...b.args) } else if (a.a) rest.push(...a.a); else rest.push(a) }
            emit({ name: nm.toUpperCase(), args: rest }, lineOf(l.call), ctx, state === 'client' ? how : 'command', batch ? { batch } : {})
            if (nm.toUpperCase() === 'EVAL' || nm.toUpperCase() === 'EVAL_RO') luaFromEval(rest, lineOf(l.call), ctx)
            state = state || 'client'; how = how || 'command'
            continue
          }
          // a spread of a command assembled in steps: .call(...args), .sendCommand(args)
          const only = list.length === 1 ? list[0] : null
          const bref = only && (only.ref || only.x) && F.builders.has(only.ref || only.x) ? F.builders.get(only.ref || only.x) : null
          if (bref) { bref.sent = true; continue } // read once the file is walked, where it names its command
          continue
        }
        if (fam === 'rust' && l.name === 'cmd' && state === 'client') { const nm = lit(args[0]); if (nm && COMMANDS.has(nm.toUpperCase())) { raw = { name: nm.toUpperCase(), args: [], line: lineOf(l.call) }; state = 'raw' } continue }
        if (l.name === 'defineCommand' && state === 'client') {
          // ioredis: defineCommand('name', { numberOfKeys, lua })
          const nm = lit(args[0]), o = new Map((args[1]?.o || []).map(([k, v]) => [lit(k), v]))
          const lua = o.get('lua')
          if (nm) F.defined.set(nm, { body: lua?.node ? scriptBody(lua.node, F) : null, n: o.get('numberOfKeys')?.n ?? null })
          continue
        }
        if (state === 'client' && F.defined.has(l.name)) {
          const d = F.defined.get(l.name)
          const keys = d.n !== null ? args.slice(0, d.n) : null
          emit({ name: 'EVAL', args: [S(''), d.n !== null ? { n: d.n } : { x: '' }, ...(keys || [])] }, lineOf(l.call), ctx, how, { scriptOf: true, ...(batch ? { batch } : {}) })
          luaSites(d.body, keys && keys.every((k) => k.s || k.n !== undefined || k.x !== undefined) ? keys : null, lineOf(l.call), ctx, how)
          continue
        }
        const tc = typedCommand(l.name, ns)
        if (!tc) { if (state === null) { const k = clientName(l.name); if (k && MAKES.has(l.name)) { state = 'client'; how = k } } continue }
        if (state === null && (GENERIC.has(tc.cmd) || !evidence())) continue
        const p = protocol(tc.cmd, tc.norm, args, fam, ns === 'ft' && ftIndex ? ftIndex : null, F)
        const name = p && !Array.isArray(p) ? p.cmd : tc.cmd
        const pargs = p === undefined || p === null ? expand(fam === 'go' && !(ns === 'ft' && ftIndex) ? args.filter((a) => !isFn(a)).slice(1) : ns === 'ft' && ftIndex ? [ftIndex, ...args] : args) : Array.isArray(p) ? p : p.args
        emit({ name, args: pargs }, lineOf(l.call), ctx, state === 'client' ? how : 'command', batch ? { batch } : {})
        if (name === 'EVAL' || name === 'EVAL_RO') luaFromEval(pargs, lineOf(l.call), ctx)
        if (state === null) { state = 'client'; how = 'command' }
        ns = null
      }
    }
    flushRaw()
  }
  // EVAL's literal body read, its KEYS mapped to the call's keys
  const luaFromEval = (args, line, ctx) => {
    const body = args[0]
    const t = lit(body)
    if (t === null) return
    const n = args[1]?.n ?? (lit(args[1]) !== null && /^\d+$/.test(lit(args[1])) ? Number(lit(args[1])) : null)
    const keys = n === null ? null : args.slice(2, 2 + n)
    const at = body.node ? unwrap(body.node, fam) : null
    luaSites({ text: t, line: at ? at.startPosition.row + 1 : line }, keys, line, ctx, 'bound')
  }
  // environment variables read (names only), connection URLs and client options (their database index only)
  const ENV = {
    ts: (n) => { if (n.type !== 'member_expression' && n.type !== 'subscript_expression') return null; const o = field(n, 'object')?.text; if (!/^(?:process\.env|Bun\.env|Deno\.env|import\.meta\.env)$/.test(o || '')) return null; const p = n.type === 'member_expression' ? field(n, 'property')?.text : lit(argOf(field(n, 'index'), F)); return p },
    rust: (n) => { if (n.type === 'call_expression' && /(?:^|::)(?:env::var|var|var_os|dotenv::var)$/.test(field(n, 'function')?.text || '') && /env|dotenv/.test(field(n, 'function')?.text || '')) return lit(argOf(argNodes(n, 'rust')[0], F)); if (n.type === 'macro_invocation' && /^(?:std::)?(?:env|option_env)$/.test(field(n, 'macro')?.text || '')) { const tt = n.namedChildren.find((c) => c.type === 'token_tree'); const s0 = tt?.namedChildren[0]; return s0 ? lit(argOf(s0, F)) : null } return null },
    go: (n) => (n.type === 'call_expression' && /^os\.(?:Getenv|LookupEnv)$/.test(field(n, 'function')?.text || '') ? lit(argOf(argNodes(n, 'go')[0], F)) : null),
    python: (n) => { if (n.type === 'call' && /^os\.(?:getenv|environ\.get)$/.test(field(n, 'function')?.text || '')) return lit(argOf(argNodes(n, 'python')[0], F)); if (n.type === 'subscript' && field(n, 'value')?.text === 'os.environ') return lit(argOf(field(n, 'subscript'), F)); return null },
  }
  const envAt = (n) => {
    let nm = null
    try { nm = ENV[fam](n) } catch { nm = null }
    if (nm && /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(nm) && !out.env.some((e) => e.name === nm) && out.env.length < MAX_ENV) out.env.push({ name: nm, line: lineOf(n) })
  }
  const STRINGS = { ts: /^(?:string|template_string)$/, rust: /^(?:string_literal|raw_string_literal)$/, go: /^(?:interpreted_string_literal|raw_string_literal)$/, python: /^string$/ }
  const urlAt = (n) => {
    const head = n.text.slice(0, 16)
    if (!/(?:redis|valkey|rediss|valkeys|unix):\/\//i.test(head)) return
    const t = lit(argOf(n, F))
    const d = t === null ? (/^.(?:redis|rediss|valkey|valkeys):\/\//i.test(n.text) ? { db: null } : null) : urlDb(t)
    if (d && out.dbs.length < MAX_DBS) out.dbs.push({ db: d.db, line: lineOf(n), how: 'url' })
  }
  const DB_KEYS = /^(?:db|DB|database|Database)$/
  const dbOption = (n) => {
    // { db: 2 } · Options{DB: 2} · Redis(db=2): a literal number beside a client's maker
    let k = null, v = null
    if (fam === 'ts' && n.type === 'pair') { k = field(n, 'key')?.text; v = field(n, 'value') }
    else if (fam === 'go' && n.type === 'keyed_element') { const [a, b] = n.namedChildren; k = (a?.namedChildren?.[0] || a)?.text; v = b?.namedChildren?.[0] || b }
    else if (fam === 'python' && n.type === 'keyword_argument') { k = field(n, 'name')?.text; v = field(n, 'value') }
    if (!k || !DB_KEYS.test(k) || !v) return
    const a = argOf(v, F)
    if (a.n !== undefined && out.dbs.length < MAX_DBS && (out.clients.length || F.known.size)) out.dbs.push({ db: a.n, line: lineOf(n), how: 'option' })
  }
  // the calls of the file's own functions, their arguments as the caller has them (a parameter's value)
  const recordCall = (n) => {
    const c = callee(n, fam)
    if (!c || !c.name) return
    const name = c.recv ? (RECV_SELF.test(unwrap(c.recv, fam)?.text || '') ? c.name : null) : c.name.split(/::|\./).pop()
    if (!name || !F.fnNames.has(name)) return
    const list = F.calls.get(name) || []
    if (list.length >= 16 || F.callCount >= 4000) { list.over = true; F.calls.set(name, list); return }
    F.callCount = (F.callCount || 0) + 1
    try { list.push(argNodes(n, fam).filter((a) => a.type !== 'keyword_argument').map((a) => argOf(a, F))) } catch { list.over = true }
    F.calls.set(name, list)
  }
  // ── the walk ──
  const handled = new Set()
  const top = { fn: null, cls: null, pyCls: null, impl: null, test: false }
  const stack = stopped ? [] : [[root, top, null]]
  while (stack.length) {
    if (late()) { stopped = true; break }
    const [n, ctx, parent] = stack.pop()
    const t = n.type
    F.cur = ctx.fn
    // declarations: what their value makes; parameters and fields: what their type names
    if (fam === 'ts' && t === 'variable_declarator' && field(n, 'name')?.type === 'identifier') bindValue(field(n, 'name').text, field(n, 'value'), ctx, lineOf(n))
    else if (fam === 'ts' && (t === 'required_parameter' || t === 'optional_parameter' || t === 'public_field_definition' || t === 'property_signature')) { const ty = field(n, 'type')?.text || ''; const nm = (field(n, 'pattern') || field(n, 'name'))?.text; if (nm && CLIENT_TYPE.ts.test(ty) && nm.length <= 40) F.known.set(lastName(nm), 'typed'); if (t === 'public_field_definition' && nm && field(n, 'value')) bindValue(lastName(nm), field(n, 'value'), ctx, lineOf(n)) }
    else if (fam === 'rust' && t === 'let_declaration' && field(n, 'pattern')) { const nm = lastName(field(n, 'pattern').text); const ty = field(n, 'type')?.text || ''; if (CLIENT_TYPE.rust.test(ty)) F.known.set(nm, 'typed'); else bindValue(nm, field(n, 'value'), ctx, lineOf(n)) }
    else if (fam === 'rust' && (t === 'parameter' || t === 'field_declaration')) { const ty = field(n, 'type')?.text || ''; const nm = (field(n, 'pattern') || field(n, 'name'))?.text; if (nm && CLIENT_TYPE.rust.test(ty)) F.known.set(lastName(nm), 'typed') }
    else if (fam === 'go' && (t === 'short_var_declaration' || t === 'assignment_statement')) { const l = field(n, 'left')?.namedChildren || [], r = field(n, 'right')?.namedChildren || []; l.forEach((x, i) => { if (r[i] || r.length === 1) bindValue(lastName(x.text), r[i] || r[0], ctx, lineOf(n)) }) }
    else if (fam === 'go' && t === 'var_spec') { const names = n.namedChildren.filter((x) => x.type === 'identifier'); const vals = field(n, 'value')?.namedChildren || []; const ty = field(n, 'type')?.text || ''; names.forEach((x, i) => { if (CLIENT_TYPE.go.test(ty)) F.known.set(x.text, 'typed'); else if (vals[i]) bindValue(x.text, vals[i], ctx, lineOf(n)) }) }
    else if (fam === 'go' && (t === 'parameter_declaration' || t === 'field_declaration')) { const ty = field(n, 'type')?.text || ''; if (CLIENT_TYPE.go.test(ty)) for (const x of n.namedChildren) if (x.type === 'identifier' || x.type === 'field_identifier') F.known.set(x.text, 'typed') }
    else if (fam === 'python' && t === 'assignment') { const l = field(n, 'left'); const ty = field(n, 'type')?.text || ''; if (l && CLIENT_TYPE.python.test(ty)) F.known.set(lastName(l.text), 'typed'); else if (l) bindValue(lastName(l.text), field(n, 'right'), ctx, lineOf(n)) }
    else if (fam === 'python' && t === 'typed_parameter') { const ty = field(n, 'type')?.text || ''; const nm = n.namedChildren.find((c) => c.type === 'identifier')?.text; if (nm && CLIENT_TYPE.python.test(ty)) F.known.set(nm, 'typed') }
    // a function returning an array or a vec (what a spread or an .arg of its call sends)
    if ((fam === 'ts' && t === 'return_statement') || (fam === 'python' && t === 'return_statement') || (fam === 'go' && t === 'return_statement')) { const v = unwrap(n.namedChildren[0], fam); if (ctx.fn && v) { const a = v.type === 'identifier' && F.arrays.has(v.text) ? { ref: v.text } : argOf(v, F); if (a.a || a.ref) F.returns.set(ctx.fn.name.split(/[.:]/).pop(), a) } }
    if (fam === 'rust' && t === 'block' && parent && parent.type === 'function_item' && ctx.fn) { const last = n.namedChildren[n.namedChildren.length - 1]; const v = last && (last.type === 'expression_statement' ? null : unwrap(last, fam)); if (v) { const a = v.type === 'identifier' && F.arrays.has(v.text) ? { ref: v.text } : argOf(v, F); if (a.a || a.ref) F.returns.set(ctx.fn.name.split(/[.:]/).pop(), a) } }
    // reads
    if ((evidence() || out.clients.length) && !handled.has(n.id)) envAt(n)
    if (STRINGS[fam].test(t)) urlAt(n)
    dbOption(n)
    if (t === CALL[fam] && F.fnNames.size) recordCall(n)
    if (t === CALL[fam] && !handled.has(n.id) && !F.skip.has(n.id)) {
      // every call of the chain is read with its outermost
      let cur = n
      for (let g = 0; g < 64 && cur; g++) { cur = unwrap(cur, fam); if (!cur || cur.type !== CALL[fam]) { const [mt, mo] = MEMBER[fam]; if (cur && cur.type === mt) { cur = field(cur, mo); continue } break } handled.add(cur.id); const c = callee(cur, fam); cur = c?.recv || null }
      try { chainSites(n, ctx) } catch (e) { note(`a call at line ${lineOf(n)} not read: ${String(e?.message || e).split('\n')[0].slice(0, 80)}`) }
    }
    // the context its children get
    let c = ctx
    if (FN[fam].test(t)) {
      const name = fnName(n, parent, fam, ctx)
      c = name !== null ? { ...ctx, fn: { name: name.slice(0, 120), short: name.split(/::|\./).pop(), params: paramsOf(n, fam), line: lineOf(n), end: endOf(n), idx: -1 }, test: ctx.test || isTestName(fam, name), pyCls: null } : { ...ctx, pyCls: fam === 'python' ? null : ctx.pyCls }
    } else if (CLASS[fam]?.test(t)) {
      const name = field(n, 'name')?.text || '(class)'
      c = fam === 'python' ? { ...ctx, pyCls: name, test: ctx.test || /^Test/.test(name) } : { ...ctx, cls: name }
    } else if (fam === 'rust' && t === 'impl_item') { const ty = field(n, 'type'); c = { ...ctx, impl: ty ? ty.text.replace(/<[\s\S]*$/, '') : null } }
    const kids = n.namedChildren
    let attrTest = false
    const pushes = []
    for (const k of kids) {
      if (fam === 'rust' && k.type === 'attribute_item') { if (TEST_ATTR.test(k.text)) attrTest = true; pushes.push([k, c, n]); continue }
      pushes.push([k, attrTest && (k.type === 'function_item' || k.type === 'mod_item') ? { ...c, test: true } : c, n])
      attrTest = false
    }
    for (let i = pushes.length - 1; i >= 0; i--) stack.push(pushes[i])
  }
  if (stopped) note(`the file took more than ${ms / 1000} s to read: the calls after that not read`)
  // commands assembled in steps no call was seen sending: read where they are made
  for (const b of F.builders.values()) if (!b.used) emit({ name: b.name, args: b.args }, b.line, b.ctx, 'builder')
  pending.sort((a, b) => a.line - b.line || a.seq - b.seq)
  // ── each command read, its spreads resolved ──
  // a parameter's value: what every call of its function in the file passes it, when they agree
  const paramValue = (p, depth) => {
    const list = F.calls.get(p.fn)
    if (!list || !list.length || list.over || depth > 3) return null
    let got = null
    for (const args of list) {
      let a = args[p.i]
      if (a && a.param) a = paramValue(a.param, depth + 1)
      const t = a && a.s ? template(a) : null
      if (!t) return null
      if (got && got.k !== t.k) return null
      got = got || { a, k: t.k }
    }
    return got ? got.a : null
  }
  const resolve = (args, depth = 0) => {
    const outA = []
    for (const a of args) {
      if (a && a.param) { const v = paramValue(a.param, 0); outA.push(v || a); continue }
      if (a && a.ref && depth < 4) { const arr = F.arrays.get(a.ref); if (arr) { outA.push(...resolve(arr.args, depth + 1)); continue } }
      if (a && a.call && depth < 4) { const r = F.returns.get(a.call); if (r) { outA.push(...resolve(r.ref ? [r] : r.a, depth + 1)); continue } outA.push({ spread: a.call }); continue }
      outA.push(a)
    }
    return outA
  }
  for (const p of pending) {
    const f = readCommand({ name: p.c.name, args: resolve(p.c.args || []) })
    if (!f || f.family === 'tx' || (f.family === 'server' && f.cmd !== 'SELECT')) continue // MULTI, EXEC, PING: no key
    dyn += f.dyn
    const s = { line: p.line, fn: fnIdx(p.ctx), how: p.how, ...(p.batch ? { batch: p.batch } : {}), ...(p.via ? { via: p.via, scriptAt: p.scriptAt } : {}), ...(p.scriptOf ? { scriptOf: true } : {}), ...f }
    out.sites.push(s)
  }
  out.dyn = dyn
  return out
}

export default {
  id: 'redis-commands',
  version: 1,
  kind: 'inferred',
  scope: 'file',
  tree: true,
  wants: (p) => SRC.test(p) && !DTS.test(p),
  level: redisLevel,
  discover: (info) => [...info].filter(([p, i]) => SRC.test(p) && !DTS.test(p) && (i.ddl & 128)).map(([p]) => ({ key: p, inputs: [p] })),
  // a base reads it too, aside (graph_changes compares key templates and FT.CREATE declarations)
  aside: true,
  extract(text, file, ctx) {
    if (ctx.aside) return ctx.aside('redis-commands', file, text)
    const lang = treeLang(file)
    const tree = ctx.tree(lang, text)
    try {
      const r = readRedisFile(tree, lang, file)
      return r.sites.length || r.clients.length || r.tests ? { declarations: [], redis: r } : { declarations: [] }
    } finally { tree.delete?.() }
  },
}
