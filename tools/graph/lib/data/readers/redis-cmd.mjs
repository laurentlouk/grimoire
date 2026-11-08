// grimoire graph · data · reader: a key-value cache's commands (the protocol Redis, Valkey, KeyDB,
// Dragonfly, Upstash, ElastiCache and MemoryDB speak), as code sends them. Never runs anything, never
// evaluates what code fills in, never keeps a value: from each command it keeps the command's name,
// the key templates it reaches, the field names and JSON paths it names literally, a lifetime in
// seconds when it is a literal number, the channels, streams, consumer groups and search indexes it
// names, and a search index's schema. extractors/redis-commands.mjs turns each client's call forms
// into the protocol's arguments; this reads them.
//
// An argument, as the extractor hands it:
//   { s: [part] }   a text: each part a literal string, or { h: name } a part code fills in (named after
//                   the variable that fills it, '' when nothing names it)
//   { n: number }   a number literal (a Go duration already in seconds: { n, dur: true })
//   { o: [[Arg, Arg]] }  an object, a map, a dict, a slice of pairs (each key and value)
//   { a: [Arg] }    an array or a list
//   { k: n }        a script's KEYS[n] (1-based), from the Lua reader
//   { x: name }     anything else (a variable, a call): unknown, named after its variable
//   { spread: name } arguments code spreads in: unknown, and how many
// readCommand({ name, args }) → Fact | null (not a command this reads)
//   Fact { cmd, family, base (what TYPE answers), rw: r | w, creates, keys: [Key], dyn (dynamic keys
//          counted), fields?: [name], paths?: [name], ttl?: { s } | { code: true } | { none: true },
//          glob?: [text], channel?: [{ t, k, pattern, role: pub | sub }], stream?: { group?, consumer?,
//          role }, index?: { name, role, def? }, script?: { … } }
//   Key  { t: the template as shown (`user:{user_id}:sessions`), k: as compared (`user:{}:sessions`),
//          role: r | w }
// A key a template cannot show (no letter in its literal parts: `{}`, `{}:{}`) is dynamic: counted in
// `dyn`, never named.

export const MAX_ARGS = 512, MAX_TEXT = 256, MAX_HOLES = 8, MAX_FIELDS = 64

// ── the command table: family, what TYPE answers for its key, and how its keys sit in its arguments ──
// keys: 1 the first argument · all every argument · pairs every other one (MSET) · last1 all but the
// last (BLPOP) · two the first two · num after a key count (EVAL, ZUNION) · store1num a destination
// then a key count (ZUNIONSTORE) · streams after STREAMS, the first half (XREAD) · sub the second
// (XGROUP CREATE key) · none no key (PUBLISH, FT.*, SCAN)
const FAMILIES = {
  string: ['string', 'GET SET SETNX SETEX PSETEX GETSET GETDEL GETEX MGET:all MSET:pairs MSETNX:pairs INCR INCRBY INCRBYFLOAT DECR DECRBY APPEND STRLEN GETRANGE SETRANGE SUBSTR LCS:two'],
  hash: ['hash', 'HSET HSETNX HGET HGETALL HMGET HMSET HDEL HEXISTS HINCRBY HINCRBYFLOAT HKEYS HVALS HLEN HSCAN HSTRLEN HRANDFIELD HEXPIRE HPEXPIRE HTTL HPERSIST HGETDEL HGETEX HSETEX'],
  set: ['set', 'SADD SREM SMEMBERS SISMEMBER SMISMEMBER SCARD SPOP SRANDMEMBER SSCAN SINTER:all SUNION:all SDIFF:all SINTERSTORE:all SUNIONSTORE:all SDIFFSTORE:all SMOVE:two SINTERCARD:num'],
  zset: ['zset', 'ZADD ZREM ZRANGE ZRANGEBYSCORE ZRANGEBYLEX ZREVRANGE ZREVRANGEBYSCORE ZREVRANGEBYLEX ZINCRBY ZSCORE ZMSCORE ZCARD ZCOUNT ZRANK ZREVRANK ZPOPMIN ZPOPMAX BZPOPMIN:last1 BZPOPMAX:last1 ZREMRANGEBYSCORE ZREMRANGEBYRANK ZREMRANGEBYLEX ZSCAN ZRANDMEMBER ZLEXCOUNT ZRANGESTORE:two ZUNIONSTORE:store1num ZINTERSTORE:store1num ZDIFFSTORE:store1num ZUNION:num ZINTER:num ZDIFF:num ZINTERCARD:num ZMPOP:num BZMPOP:num'],
  list: ['list', 'LPUSH RPUSH LPUSHX RPUSHX LPOP RPOP LRANGE LTRIM LLEN LINDEX LSET LREM LINSERT LPOS BLPOP:last1 BRPOP:last1 LMOVE:two BLMOVE:two RPOPLPUSH:two BRPOPLPUSH:two LMPOP:num BLMPOP:num'],
  stream: ['stream', 'XADD XREAD:streams XREADGROUP:streams XACK XTRIM XLEN XRANGE XREVRANGE XDEL XGROUP:sub XCLAIM XAUTOCLAIM XPENDING XINFO:sub XSETID'],
  json: ['ReJSON-RL', 'JSON.SET JSON.GET JSON.DEL JSON.FORGET JSON.MGET:last1 JSON.NUMINCRBY JSON.NUMMULTBY JSON.ARRAPPEND JSON.ARRINSERT JSON.ARRINDEX JSON.ARRLEN JSON.ARRPOP JSON.ARRTRIM JSON.OBJKEYS JSON.OBJLEN JSON.STRLEN JSON.STRAPPEND JSON.TYPE JSON.TOGGLE JSON.CLEAR JSON.MERGE JSON.RESP JSON.DEBUG:sub'],
  geo: ['zset', 'GEOADD GEOPOS GEODIST GEORADIUS GEORADIUS_RO GEORADIUSBYMEMBER GEORADIUSBYMEMBER_RO GEOSEARCH GEOSEARCHSTORE:two GEOHASH'],
  hll: ['string', 'PFADD PFCOUNT:all PFMERGE:all'],
  bitmap: ['string', 'SETBIT GETBIT BITCOUNT BITPOS BITOP BITFIELD BITFIELD_RO'],
  timeseries: ['TSDB-TYPE', 'TS.CREATE TS.ADD TS.INCRBY TS.DECRBY TS.RANGE TS.REVRANGE TS.GET TS.ALTER TS.DEL TS.INFO'],
  key: [null, 'DEL:all UNLINK:all EXISTS:all TYPE TTL PTTL EXPIRE PEXPIRE EXPIREAT PEXPIREAT EXPIRETIME PEXPIRETIME PERSIST RENAME:two RENAMENX:two TOUCH:all DUMP RESTORE OBJECT:sub COPY:two MOVE SORT SORT_RO WATCH:all'],
  glob: [null, 'SCAN:none KEYS:none'],
  pubsub: [null, 'PUBLISH:none SPUBLISH:none SUBSCRIBE:none SSUBSCRIBE:none PSUBSCRIBE:none UNSUBSCRIBE:none SUNSUBSCRIBE:none PUNSUBSCRIBE:none'],
  script: [null, 'EVAL:num EVALSHA:num EVAL_RO:num EVALSHA_RO:num FCALL:num FCALL_RO:num SCRIPT:none FUNCTION:none'],
  search: [null, 'FT.CREATE:none FT.ALTER:none FT.SEARCH:none FT.AGGREGATE:none FT.DROPINDEX:none FT.DROP:none FT.INFO:none FT.EXPLAIN:none FT.EXPLAINCLI:none FT.PROFILE:none FT.ALIASADD:none FT.ALIASUPDATE:none FT.ALIASDEL:none FT.TAGVALS:none FT.SPELLCHECK:none FT.SYNUPDATE:none FT.CURSOR:none'],
  tx: [null, 'MULTI:none EXEC:none DISCARD:none UNWATCH:none'],
  server: [null, 'SELECT:none PING:none ECHO:none INFO:none CONFIG:none FLUSHDB:none FLUSHALL:none DBSIZE:none CLIENT:none AUTH:none HELLO:none QUIT:none TIME:none WAIT:none'],
}
export const COMMANDS = new Map()
for (const [family, [base, list]] of Object.entries(FAMILIES)) for (const w of list.split(' ')) { const [name, keys = '1'] = w.split(':'); COMMANDS.set(name, { family, base, keys }) }
// What reads, and what a write cannot create (it needs the key there: a delete, a lifetime, a pop).
const READS = new Set('GET MGET STRLEN GETRANGE SUBSTR LCS HGET HGETALL HMGET HEXISTS HKEYS HVALS HLEN HSCAN HSTRLEN HRANDFIELD HTTL SMEMBERS SISMEMBER SMISMEMBER SCARD SRANDMEMBER SSCAN SINTER SUNION SDIFF SINTERCARD ZRANGE ZRANGEBYSCORE ZRANGEBYLEX ZREVRANGE ZREVRANGEBYSCORE ZREVRANGEBYLEX ZSCORE ZMSCORE ZCARD ZCOUNT ZRANK ZREVRANK ZSCAN ZRANDMEMBER ZLEXCOUNT ZUNION ZINTER ZDIFF ZINTERCARD LRANGE LLEN LINDEX LPOS XREAD XREADGROUP XLEN XRANGE XREVRANGE XPENDING XINFO JSON.GET JSON.MGET JSON.ARRINDEX JSON.ARRLEN JSON.OBJKEYS JSON.OBJLEN JSON.STRLEN JSON.TYPE JSON.RESP JSON.DEBUG GEOPOS GEODIST GEORADIUS_RO GEORADIUSBYMEMBER_RO GEOSEARCH GEOHASH PFCOUNT GETBIT BITCOUNT BITPOS BITFIELD_RO TS.RANGE TS.REVRANGE TS.GET TS.INFO EXISTS TYPE TTL PTTL EXPIRETIME PEXPIRETIME DUMP OBJECT SORT_RO SCAN KEYS WATCH'.split(' '))
const NO_CREATE = new Set('DEL UNLINK EXPIRE PEXPIRE EXPIREAT PEXPIREAT PERSIST TOUCH HDEL HEXPIRE HPEXPIRE HPERSIST SREM SPOP ZREM ZPOPMIN ZPOPMAX BZPOPMIN BZPOPMAX ZREMRANGEBYSCORE ZREMRANGEBYRANK ZREMRANGEBYLEX ZMPOP BZMPOP LPOP RPOP BLPOP BRPOP LTRIM LREM LSET LPUSHX RPUSHX LMPOP BLMPOP XACK XTRIM XDEL XCLAIM XAUTOCLAIM XSETID JSON.DEL JSON.FORGET JSON.ARRPOP JSON.ARRTRIM JSON.CLEAR JSON.TOGGLE GETDEL HGETDEL TS.DEL TS.ALTER MOVE'.split(' '))
// the type a family's keys hold, as shown (geo, HyperLogLog and bitmap keys hold a sorted set and strings)
export const TYPE_OF = { string: 'string', hash: 'hash', set: 'set', zset: 'sorted set', list: 'list', stream: 'stream', json: 'JSON', geo: 'geo', hll: 'HyperLogLog', bitmap: 'bitmap', timeseries: 'time series' }
export const commandOf = (name) => COMMANDS.get(String(name).toUpperCase()) || null

// ── arguments ──
// a literal text (no part code fills in) → string | null
export function lit(a) {
  if (!a) return null
  if (a.n !== undefined) return String(a.n)
  if (!a.s) return null
  let t = ''
  for (const p of a.s) { if (typeof p !== 'string') return null; t += p }
  return t
}
const word = (a) => { const t = lit(a); return t === null ? null : t.toUpperCase() }
// a number an argument holds: a number literal, or a text of digits
function num(a) {
  if (!a) return null
  if (a.n !== undefined) return Number.isFinite(a.n) ? a.n : null
  const t = lit(a)
  return t !== null && /^-?\d{1,15}$/.test(t.trim()) ? Number(t.trim()) : null
}
const NAME = /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/
const holeName = (h) => (typeof h === 'string' && NAME.test(h) ? h : '')

// A key (or a channel, a stream, a group) as a template → { t, k } | null (dynamic: nothing literal
// with a letter in it, or past the bounds). Each part code fills in is `{name}` (as shown) and `{}` (as
// compared): `user:{user_id}:sessions` and `user:{id}:sessions` are one key space.
export function template(a) {
  if (!a) return null
  if (a.n !== undefined) return { t: String(a.n), k: String(a.n), lit: true }
  if (!a.s) return null
  let t = '', k = '', letters = false, holes = 0, last = null
  for (const p of a.s) {
    // a literal brace (a cluster hash tag, `{cart}:…`) is written `\{`, so a placeholder is never one
    if (typeof p === 'string') { if (!p) continue; const e = escapeLit(p); t += e; k += e; if (/[A-Za-z]/.test(p)) letters = true; last = 'lit'; continue }
    if (last === 'hole') continue // two parts filled in side by side are one
    holes++
    t += `{${holeName(p.h)}}`; k += '{}'; last = 'hole'
  }
  if (!letters || t.length > MAX_TEXT || holes > MAX_HOLES) return null
  return holes ? { t, k } : { t, k, lit: true }
}

// a literal part of a template: its braces and backslashes escaped (`{cart}` → `\{cart\}`)
export const escapeLit = (s) => String(s).replace(/[\\{}]/g, '\\$&')
// a placeholder in a template (never an escaped brace): `{name}` or `{}`
export const HOLE_RE = /(?<!\\)\{[A-Za-z0-9_$]*\}/g
// a template as compared: each placeholder `{}`, whatever it is named
export const formOf = (t) => String(t).replace(HOLE_RE, '{}')

// ── reading one command ──
export function readCommand(c) {
  if (!c || typeof c.name !== 'string') return null
  const name = c.name.toUpperCase()
  const def = COMMANDS.get(name)
  if (!def) return null
  const args = (c.args || []).slice(0, MAX_ARGS)
  const f = { cmd: name, family: def.family, base: def.base, rw: READS.has(name) ? 'r' : 'w', keys: [], dyn: 0 }
  f.creates = f.rw === 'w' && !NO_CREATE.has(name) && def.base !== null
  const key = (a, role = f.rw) => {
    if (a && a.spread !== undefined) { f.dyn++; f.spread = true; return }
    const t = template(a)
    if (!t) { f.dyn++; return }
    if (!f.keys.some((x) => x.k === t.k && x.role === role)) f.keys.push({ t: t.t, k: t.k, role })
  }
  const sub = word(args[0])
  // the keys
  switch (def.keys) {
    case '1': key(args[0]); break
    // a …STORE command's destination comes first, the keys it reads after
    case 'all': args.forEach((a, i) => key(a, /STORE$/.test(name) ? (i ? 'r' : 'w') : f.rw)); break
    // pairs: a spread's width is unknown, so the pairs after it are not read (never shifted)
    case 'pairs': for (let i = 0; i < args.length; i += 2) { if (spreadAt(args, i)) { f.dyn++; f.spread = true; break } key(args[i]) } break
    case 'last1': for (const a of args.slice(0, -1)) key(a); if (name === 'JSON.MGET') f.paths = pathsOf([args[args.length - 1]]); break
    case 'two': {
      const store = /STORE$/.test(name)
      key(args[0], store ? 'w' : name === 'LCS' || name === 'COPY' ? 'r' : f.rw)
      key(args[1], store || name === 'LCS' ? 'r' : 'w')
      break
    }
    // the key count: after the script (EVAL, FCALL), after the timeout (BZMPOP, BLMPOP), else first
    case 'num': { const at = name.startsWith('EVAL') || name.startsWith('FCALL') || name === 'BZMPOP' || name === 'BLMPOP' ? 1 : 0; const n = num(args[at]); if (n === null) { f.dyn++; f.keysUnknown = true } else for (const a of args.slice(at + 1, at + 1 + Math.min(n, 64))) { if (a && a.spread !== undefined) { f.dyn++; break } key(a) } break }
    case 'store1num': { key(args[0], 'w'); const n = num(args[1]); if (n === null) f.dyn++; else for (const a of args.slice(2, 2 + Math.min(n, 64))) key(a, 'r'); break }
    case 'streams': { const at = args.findIndex((a) => word(a) === 'STREAMS'); if (at < 0) { f.dyn++; break } const rest = args.slice(at + 1); for (const a of rest.slice(0, Math.floor(rest.length / 2))) key(a, 'r'); if (rest.some((a) => a.spread !== undefined)) f.dyn++; break }
    case 'sub': if (sub === 'HELP') break; key(args[1]); break
    default: break
  }
  // BITOP op dest key…: the operation is no key; SORT key … STORE dest writes dest
  if (name === 'BITOP') { f.keys = []; f.dyn = 0; key(args[1], 'w'); for (const a of args.slice(2)) key(a, 'r') }
  if (name === 'SORT' || name === 'SORT_RO') { const st = args.findIndex((a) => word(a) === 'STORE'); if (st > 0) { f.keys = f.keys.map((x) => ({ ...x, role: 'r' })); key(args[st + 1], 'w'); f.rw = 'w' } else f.rw = 'r' }
  // what each family names
  if (def.family === 'hash') hashFields(f, name, args)
  else if (def.family === 'json') { if (name !== 'JSON.MGET' && name !== 'JSON.DEBUG') f.paths = pathsOf(args.slice(1, name === 'JSON.GET' ? undefined : 2)) }
  else if (def.family === 'stream') streamOf(f, name, args, sub)
  else if (def.family === 'pubsub') channels(f, name, args)
  else if (def.family === 'glob') globOf(f, name, args)
  else if (def.family === 'search') searchOf(f, name, args)
  else if (def.family === 'script') f.script = { kind: name.startsWith('FCALL') ? 'function' : name.startsWith('EVALSHA') ? 'sha' : 'eval', keysKnown: !f.keysUnknown }
  lifetime(f, name, args)
  if (name === 'SELECT') { const n = num(args[0]); f.db = n === null ? { code: true } : { n } }
  if (def.family === 'tx') f.tx = name
  return f
}

// hash fields: HSET key f v f v · HMSET · HSETNX key f v · HGET key f · HMGET key f… · HDEL key f… ·
// HINCRBY key f n · HEXISTS key f · HSTRLEN key f · HEXPIRE key s FIELDS n f… — each literal name
// whether an argument at `i` (or one before it) has a width the reader cannot know: a spread
const spreadAt = (args, i) => args.slice(0, i + 1).some((a) => a && a.spread !== undefined)
// field value pairs from `from`: the field names, until a spread or a field code names (whose width,
// an object or an array the client expands, is unknown: the pairs after it are never read shifted)
function pairNames(args, from) {
  const out = []
  let stopped = false
  for (let i = from; i < args.length; i += 2) {
    const a = args[i]
    if (args.slice(from, i + 2).some((x) => x && x.spread !== undefined) || lit(a) === null) { stopped = true; break }
    out.push(a)
  }
  return { list: out, stopped }
}
function hashFields(f, name, args) {
  let list = []
  if (name === 'HSET' || name === 'HMSET' || name === 'HSETNX') { const p = pairNames(args, 1); list = p.list; if (p.stopped) f.fieldsCode = true }
  else if (name === 'HGET' || name === 'HINCRBY' || name === 'HINCRBYFLOAT' || name === 'HEXISTS' || name === 'HSTRLEN') list = [args[1]]
  else if (name === 'HMGET' || name === 'HDEL' || name === 'HGETDEL') list = args.slice(name === 'HGETDEL' ? 3 : 1).filter((a) => !a || a.spread === undefined)
  else if (name === 'HEXPIRE' || name === 'HPEXPIRE' || name === 'HPERSIST' || name === 'HTTL' || name === 'HGETEX' || name === 'HSETEX') { const at = args.findIndex((a) => word(a) === 'FIELDS'); if (at >= 0) list = args.slice(at + 2).filter((_, i) => name !== 'HSETEX' || i % 2 === 0) }
  const names = []
  for (const a of list) { const t = lit(a); if (t !== null && fieldName(t) && !names.includes(t) && names.length < MAX_FIELDS) names.push(t); else if (a && t === null) f.fieldsCode = true }
  if (names.length) f.fields = names
}
// a field or a path code names: a name, never a value (bounded, printable, one line)
const fieldName = (t) => t.length > 0 && t.length <= 120 && !/[\u0000-\u001f]/.test(t)
function pathsOf(list) {
  const out = []
  // a path below the root: the root itself (`$`, `.`) names no field
  for (const a of list) { const t = lit(a); if (t !== null && fieldName(t) && t !== '$' && t !== '.' && /^[$.]/.test(t) && !out.includes(t)) out.push(t) }
  return out.length ? out : undefined
}

// streams: XADD key [NOMKSTREAM] [MAXLEN|MINID [=|~] n [LIMIT c]] id f v… · XREADGROUP GROUP g c … ·
// XGROUP CREATE key g id [MKSTREAM] · XACK key g id… · XCLAIM / XAUTOCLAIM key g c … · XPENDING key g
function streamOf(f, name, args, sub) {
  const nameOf = (a) => template(a) || (a ? { t: `{${holeName(a.x || a.h || '')}}`, k: '{}', code: true } : null)
  if (name === 'XADD') {
    let i = 1
    for (let guard = 0; guard < 8 && i < args.length; guard++) {
      const w = word(args[i])
      if (w === 'NOMKSTREAM') { i++; continue }
      if (w === 'MAXLEN' || w === 'MINID') { i++; if (word(args[i]) === '=' || word(args[i]) === '~') i++; i++; if (word(args[i]) === 'LIMIT') i += 2; continue }
      break
    }
    const names = []
    for (const a of pairNames(args, i + 1).list) { const t = lit(a); if (t !== null && fieldName(t) && !names.includes(t) && names.length < MAX_FIELDS) names.push(t) }
    if (names.length) f.fields = names
    f.stream = { role: 'add' }
  } else if (name === 'XREADGROUP') {
    f.stream = { role: 'read', group: word(args[0]) === 'GROUP' ? nameOf(args[1]) : null, consumer: word(args[0]) === 'GROUP' ? nameOf(args[2]) : null }
  } else if (name === 'XREAD') f.stream = { role: 'read' }
  else if (name === 'XGROUP') {
    if (sub === 'CREATE' || sub === 'CREATECONSUMER' || sub === 'SETID' || sub === 'DESTROY' || sub === 'DELCONSUMER') {
      f.stream = { role: 'group', op: sub, group: nameOf(args[2]), ...(sub === 'CREATECONSUMER' || sub === 'DELCONSUMER' ? { consumer: nameOf(args[3]) } : {}), ...(sub === 'CREATE' && args.slice(4).some((a) => word(a) === 'MKSTREAM') ? { mkstream: true } : {}) }
      f.rw = sub === 'CREATE' || sub === 'CREATECONSUMER' ? 'w' : f.rw
      f.creates = sub === 'CREATE' && !!f.stream.mkstream
    } else { f.keys = []; f.dyn = 0 }
  } else if (name === 'XACK' || name === 'XPENDING') f.stream = { role: name === 'XACK' ? 'ack' : 'read', group: nameOf(args[1]) }
  else if (name === 'XCLAIM' || name === 'XAUTOCLAIM') f.stream = { role: 'claim', group: nameOf(args[1]), consumer: nameOf(args[2]) }
  else if (name === 'XINFO') { if (sub === 'CONSUMERS') f.stream = { role: 'read', group: nameOf(args[2]) }; else if (sub !== 'STREAM' && sub !== 'GROUPS') { f.keys = []; f.dyn = 0 } }
  if (f.stream) for (const k of ['group', 'consumer']) if (f.stream[k] === null) delete f.stream[k]
}

// pub/sub: PUBLISH ch msg · SUBSCRIBE ch… · PSUBSCRIBE pattern… (a glob) — channels named as keys are
function channels(f, name, args) {
  if (/UNSUBSCRIBE$/.test(name)) return
  const pub = name === 'PUBLISH' || name === 'SPUBLISH'
  const pattern = name === 'PSUBSCRIBE'
  f.rw = pub ? 'w' : 'r'
  f.channel = []
  for (const a of pub ? [args[0]] : args) {
    if (a && a.spread !== undefined) { f.dyn++; continue }
    const t = template(a)
    if (!t) { f.dyn++; continue }
    if (!f.channel.some((c) => c.k === t.k)) f.channel.push({ t: t.t, k: t.k, pattern, role: pub ? 'pub' : 'sub' })
  }
}

// key globs: SCAN cursor MATCH glob · KEYS glob — a read over the templates the glob matches
function globOf(f, name, args) {
  f.rw = 'r'
  const g = name === 'KEYS' ? args[0] : args[args.findIndex((a) => word(a) === 'MATCH') + 1]
  const t = name === 'KEYS' || args.some((a) => word(a) === 'MATCH') ? template(g) : null
  if (t) f.glob = [t.t]
  else if (g) f.dyn++
}

// lifetimes: EXPIRE key s · PEXPIRE key ms · EXPIREAT / PEXPIREAT (a time code computes) · SET … EX s |
// PX ms | EXAT | PXAT | KEEPTTL · SETEX key s v · PSETEX key ms v · GETEX key EX s | … | PERSIST ·
// PERSIST key (none) · RESTORE key ttl
function lifetime(f, name, args) {
  const secs = (a, ms = false) => { const n = num(a); return n === null ? { code: true } : n <= 0 && !ms ? { none: true } : { s: ms ? n / 1000 : n } }
  if (name === 'EXPIRE') f.ttl = secs(args[1])
  else if (name === 'PEXPIRE') f.ttl = secs(args[1], true)
  else if (name === 'EXPIREAT' || name === 'PEXPIREAT') f.ttl = { code: true, at: true }
  else if (name === 'SETEX') f.ttl = secs(args[1])
  else if (name === 'PSETEX') f.ttl = secs(args[1], true)
  else if (name === 'PERSIST') f.ttl = { none: true }
  else if (name === 'RESTORE') { const n = num(args[1]); f.ttl = n === 0 ? undefined : n === null ? { code: true } : { s: n / 1000 } }
  else if (name === 'SET' || name === 'GETEX') {
    for (let i = name === 'SET' ? 2 : 1; i < args.length; i++) {
      const w = word(args[i])
      if (w === 'EX') { f.ttl = secs(args[i + 1]); break }
      if (w === 'PX') { f.ttl = secs(args[i + 1], true); break }
      if (w === 'EXAT' || w === 'PXAT') { f.ttl = { code: true, at: true }; break }
      if (w === 'KEEPTTL') { f.ttl = { keep: true }; break }
      if (w === 'PERSIST') { f.ttl = { none: true }; break }
    }
  }
  if (f.ttl === undefined) delete f.ttl
}

// ── search indexes ──
// FT.CREATE idx [ON HASH|JSON] [PREFIX n p…] [FILTER e] [LANGUAGE l] … SCHEMA field [AS a] TYPE [opts] …
// FT.ALTER idx [SKIPINITIALSCAN] SCHEMA ADD field … · FT.SEARCH / FT.AGGREGATE / FT.EXPLAIN / FT.PROFILE
// idx … (a query, never kept) · FT.ALIASADD alias idx · FT.DROPINDEX / FT.INFO / FT.TAGVALS idx
export const FIELD_TYPES = new Set(['TEXT', 'TAG', 'NUMERIC', 'GEO', 'VECTOR', 'GEOSHAPE'])
const FIELD_OPTS = new Set(['SORTABLE', 'UNF', 'NOSTEM', 'NOINDEX', 'CASESENSITIVE', 'WITHSUFFIXTRIE', 'INDEXEMPTY', 'INDEXMISSING'])
const FIELD_OPT_ARG = new Set(['WEIGHT', 'SEPARATOR', 'PHONETIC'])
const CREATE_OPT_ARG = new Set(['FILTER', 'LANGUAGE', 'LANGUAGE_FIELD', 'SCORE', 'SCORE_FIELD', 'PAYLOAD_FIELD', 'TEMPORARY'])
const CREATE_FLAGS = new Set(['MAXTEXTFIELDS', 'NOOFFSETS', 'NOHL', 'NOFIELDS', 'NOFREQS', 'SKIPINITIALSCAN'])
function searchOf(f, name, args) {
  const idx = (a) => template(a)
  const at = name === 'FT.ALIASADD' || name === 'FT.ALIASUPDATE' ? 1 : 0
  const i0 = idx(args[at])
  f.rw = name === 'FT.CREATE' || name === 'FT.ALTER' || name === 'FT.DROPINDEX' || name === 'FT.DROP' || name.startsWith('FT.ALIAS') || name === 'FT.SYNUPDATE' ? 'w' : 'r'
  const role = { 'FT.CREATE': 'create', 'FT.ALTER': 'alter', 'FT.SEARCH': 'search', 'FT.AGGREGATE': 'aggregate', 'FT.PROFILE': 'profile', 'FT.DROPINDEX': 'drop', 'FT.DROP': 'drop' }[name] || (name.startsWith('FT.ALIAS') ? 'alias' : 'other')
  if (!i0) { f.dyn++; f.index = { name: null, role }; return }
  f.index = { name: i0.t, k: i0.k, role }
  if (role === 'profile') f.index.as = word(args[1]) === 'AGGREGATE' ? 'aggregate' : 'search'
  if (role === 'alias') { const a = idx(args[0]); if (a) f.index.alias = a.t }
  if (role === 'create' || role === 'alter') f.index.def = indexDef(args.slice(1), role)
}

// An index's definition from its arguments: { on, prefixes: [template], filter?: true, schema: [{
// name, as?, type, opts }], assembled?: what code builds (`spread`: arguments spread in; `code`: a part
// it fills in), past? } — a FILTER expression and every other value is never kept, only that it is set
export function indexDef(args, role = 'create') {
  const d = { on: null, prefixes: [], schema: [] }
  let i = 0
  const n = Math.min(args.length, MAX_ARGS * 8) // each step below moves past one argument at least
  const assembled = (why) => { d.assembled ||= why }
  const atSchema = () => word(args[i]) === 'SCHEMA'
  if (role === 'alter') { while (i < n && !atSchema()) i++; i++; if (word(args[i]) === 'ADD') i++ }
  else {
    while (i < n && !atSchema()) {
      const a = args[i]
      if (a && a.spread !== undefined) { assembled('spread'); i++; continue }
      const w = word(a)
      if (w === null) { assembled('code'); i++; continue }
      if (w === 'ON') { const on = word(args[i + 1]); d.on = on === 'HASH' || on === 'JSON' ? on : on === null ? { code: true } : on; i += 2; continue }
      if (w === 'PREFIX') {
        const c = num(args[i + 1])
        if (c === null) { assembled('code'); i += 2; continue }
        for (const p of args.slice(i + 2, i + 2 + Math.min(c, 64))) { const t = template(p); if (t) d.prefixes.push(t.t); else assembled(p && p.spread !== undefined ? 'spread' : 'code') }
        i += 2 + c; continue
      }
      if (w === 'FILTER') { d.filter = true; i += 2; continue }
      if (CREATE_OPT_ARG.has(w)) { i += 2; continue }
      if (w === 'STOPWORDS') { const c = num(args[i + 1]); i += 2 + (c ?? 0); continue }
      if (CREATE_FLAGS.has(w)) { i++; continue }
      i++ // an option this does not know: skipped
    }
    if (!atSchema()) { if (!d.assembled) d.noSchema = true; return d }
    i++
  }
  // the schema: field [AS alias] TYPE [options]…
  while (i < n) {
    const a = args[i]
    if (a && a.spread !== undefined) { assembled('spread'); i++; continue }
    const fname = lit(a)
    if (fname === null) {
      // a field code names: its type and options passed over, said assembled
      assembled('code'); i++
      if (word(args[i]) === 'AS') i += 2
      if (FIELD_TYPES.has(word(args[i]))) { i++; while (i < n && (FIELD_OPTS.has(word(args[i])) || FIELD_OPT_ARG.has(word(args[i])))) i += FIELD_OPTS.has(word(args[i])) ? 1 : 2 }
      continue
    }
    const x = { name: fname, type: null, opts: [] }
    i++
    if (word(args[i]) === 'AS') { const as = lit(args[i + 1]); if (as !== null) x.as = as; else assembled('code'); i += 2 }
    const t = word(args[i])
    if (t === null) { if (args[i]) assembled(args[i].spread !== undefined ? 'spread' : 'code'); i++; if (d.schema.length < MAX_FIELDS) d.schema.push(x); continue }
    if (!FIELD_TYPES.has(t)) { d.unread = (d.unread || 0) + 1; continue } // not a field: skipped, said
    x.type = t
    i++
    if (t === 'VECTOR') { const algo = word(args[i]); const c = num(args[i + 1]); if (algo) x.opts.push(algo); i += 2 + (c ?? 0) }
    for (let g2 = 0; i < n && g2 < 16; g2++) {
      const w = word(args[i])
      if (w !== null && FIELD_OPTS.has(w)) { x.opts.push(w); i++; continue }
      if (w !== null && FIELD_OPT_ARG.has(w)) { const v = lit(args[i + 1]); x.opts.push(w === 'SEPARATOR' && v !== null && v.length <= 2 ? `SEPARATOR ${v}` : w === 'WEIGHT' && v !== null && /^\d+(?:\.\d+)?$/.test(v) ? `WEIGHT ${v}` : w); i += 2; continue }
      break
    }
    if (d.schema.length < MAX_FIELDS) d.schema.push(x); else d.past = (d.past || 0) + 1
  }
  if (!d.prefixes.length) delete d.prefixes
  return d
}

// ── key globs against templates ──
// Whether a glob (`user:*:sessions`, `?`, `[abc]`) can match a key the template can name: each `{…}`
// of the template any text of one character or more, each `*` of the glob any text. Linear in the
// product of their lengths (both bounded).
export function globMatches(glob, tmpl) {
  const g = globTokens(String(glob).slice(0, MAX_TEXT)), t = tmplTokens(String(tmpl).slice(0, MAX_TEXT))
  const n = g.length, m = t.length
  const memo = new Uint8Array((n + 1) * (m + 1) * 2) // 0 unknown, 1 false (or being computed), 2 true
  // f(i, j, h): g[i:] and t[j:] can spell one key; h: the template's hole at j already took a character
  const one = (a, c) => a.any || (a.set !== undefined ? a.set.includes(c) !== a.neg : a.c === c)
  const f = (i, j, h) => {
    const k = (i * (m + 1) + j) * 2 + h
    if (memo[k]) return memo[k] === 2
    memo[k] = 1
    const a = i < n ? g[i] : null, b = j < m ? t[j] : null
    let r = false
    if (!a && !b) r = true
    else if (b && b.hole) {
      if (h && f(i, j + 1, 0)) r = true // the hole ends, having taken a character
      else if (a && a.star) r = f(i + 1, j, h) || f(i, j, 1) // the star ends, or both take a character
      else if (a) r = f(i + 1, j, 1) // the hole takes the glob's character
    } else if (a && a.star) r = f(i + 1, j, 0) || (!!b && f(i, j + 1, 0)) // the star ends, or takes a character
    else if (a && b) r = one(a, b.c) && f(i + 1, j + 1, 0)
    memo[k] = r ? 2 : 1
    return r
  }
  return f(0, 0, 0)
}
function globTokens(s) {
  const out = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '*') { if (!out.length || !out[out.length - 1].star) out.push({ star: true }); continue }
    if (c === '?') { out.push({ any: true }); continue }
    if (c === '\\' && i + 1 < s.length) { out.push({ c: s[++i] }); continue }
    if (c === '[') { const j = s.indexOf(']', i + 1); if (j > i) { let body = s.slice(i + 1, j); const neg = body[0] === '^'; if (neg) body = body.slice(1); out.push({ set: body, neg }); i = j; continue } }
    out.push({ c })
  }
  return out
}
function tmplTokens(s) {
  const out = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { out.push({ c: s[++i] }); continue } // an escaped literal
    if (s[i] === '{') { const j = s.indexOf('}', i + 1); if (j > i && /^[A-Za-z0-9_$]*$/.test(s.slice(i + 1, j))) { out.push({ hole: true }); i = j; continue } }
    out.push({ c: s[i] })
  }
  return out
}

// A template's literal start, before its first part code fills in (what an index's PREFIX matches)
export const literalPrefix = (t) => { const i = String(t).search(/(?<!\\)\{[A-Za-z0-9_$]*\}/); return i < 0 ? String(t) : String(t).slice(0, i) }
// The prefix tree's path of a template: its parts at each `:` (`user:{user_id}:sessions` → user:,
// {user_id}:, sessions)
export function segments(t) {
  const out = []
  let cur = ''
  for (const c of String(t)) { cur += c; if (c === ':') { out.push(cur); cur = '' } }
  if (cur) out.push(cur)
  return out
}

// ── Lua: the commands a script body sends ──
// redis.call('HSET', KEYS[1], 'f', ARGV[1]) and redis.pcall(…): each argument a string literal, KEYS[n],
// ARGV[n], a local assigned once from KEYS[n], a concatenation (`..`) of those; anything else unknown.
// Only the command's name, its keys and the field names it names are read; every other literal in the
// body is dropped. Linear: one pass over the text, a string or comment that never closes ends it,
// MAX_LUA calls at most. → { commands: [{ name, args, line }], notes }
export const MAX_LUA = 200, MAX_LUA_TEXT = 256 << 10
export function readLua(text, line0 = 1) {
  const s = String(text ?? '').slice(0, MAX_LUA_TEXT)
  const out = { commands: [], notes: [] }
  if (String(text ?? '').length > MAX_LUA_TEXT) out.notes.push(`a script past ${MAX_LUA_TEXT >> 10} KB: its end not read`)
  // tokens: strings (as their text), names (dotted), numbers, punctuation; comments dropped
  const tk = []
  let i = 0, line = line0
  const n = s.length
  while (i < n && tk.length < 200_000) {
    const c = s[i]
    if (c === '\n') { line++; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue }
    if (c === '-' && s[i + 1] === '-') {
      const lb = /^\[(=*)\[/.exec(s.slice(i + 2, i + 2 + 64))
      if (lb) { const close = `]${lb[1]}]`; const j = s.indexOf(close, i + 2 + lb[0].length); const end = j < 0 ? n : j + close.length; for (let k = i; k < end; k++) if (s[k] === '\n') line++; i = end; continue }
      const j = s.indexOf('\n', i); i = j < 0 ? n : j; continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = ''
      for (; j < n && s[j] !== c && s[j] !== '\n'; j++) { if (s[j] === '\\' && j + 1 < n) { v += s[j + 1] === 'n' ? '\n' : s[j + 1]; j++ } else v += s[j] }
      tk.push({ k: 's', v, line }); i = j + 1; continue
    }
    if (c === '[' && /^\[=*\[/.test(s.slice(i, i + 64))) {
      const lb = /^\[(=*)\[/.exec(s.slice(i, i + 64)); const close = `]${lb[1]}]`
      const j = s.indexOf(close, i + lb[0].length)
      const end = j < 0 ? n : j
      const v = s.slice(i + lb[0].length, end)
      tk.push({ k: 's', v, line })
      for (let k = i; k < end; k++) if (s[k] === '\n') line++
      i = j < 0 ? n : j + close.length; continue
    }
    if (/[A-Za-z_]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_]/.test(s[j])) j++; tk.push({ k: 'w', v: s.slice(i, j), line }); i = j; continue }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[0-9.xXa-fA-F]/.test(s[j])) j++; tk.push({ k: 'n', v: s.slice(i, j), line }); i = j; continue }
    if (c === '.' && s[i + 1] === '.') { tk.push({ k: 'o', v: '..', line }); i += 2; continue }
    tk.push({ k: 'o', v: c, line }); i++
  }
  // locals assigned once from KEYS[n] or ARGV[n] (a name assigned twice is unknown)
  const locals = new Map(), twice = new Set()
  for (let j = 0; j + 5 < tk.length; j++) {
    if (tk[j].k === 'w' && tk[j].v === 'local' && tk[j + 1].k === 'w' && tk[j + 2].v === '=' && tk[j + 3].k === 'w' && (tk[j + 3].v === 'KEYS' || tk[j + 3].v === 'ARGV') && tk[j + 4].v === '[' && tk[j + 5].k === 'n') {
      const nm = tk[j + 1].v
      if (locals.has(nm)) twice.add(nm)
      locals.set(nm, tk[j + 3].v === 'KEYS' ? { k: Number(tk[j + 5].v) } : { x: `ARGV${tk[j + 5].v}` })
    }
  }
  for (const nm of twice) locals.delete(nm)
  // one argument: the tokens between two commas at depth 0
  const argOf = (list) => {
    const parts = []
    let key = null
    for (let j = 0; j < list.length; j++) {
      const t = list[j]
      if (t.k === 'o' && t.v === '..') continue
      if (t.k === 's') { parts.push(t.v); continue }
      if (t.k === 'w' && (t.v === 'KEYS' || t.v === 'ARGV') && list[j + 1]?.v === '[' && list[j + 2]?.k === 'n' && list[j + 3]?.v === ']') {
        if (t.v === 'KEYS') { if (list.length === 4) return { k: Number(list[j + 2].v) }; key = Number(list[j + 2].v); parts.push({ h: `KEYS${list[j + 2].v}`, key }) } else parts.push({ h: `ARGV${list[j + 2].v}` })
        j += 3; continue
      }
      if (t.k === 'w' && locals.has(t.v) && (list[j + 1]?.v === '..' || j + 1 === list.length)) { const l = locals.get(t.v); if (l.k !== undefined) { if (list.length === 1) return { k: l.k }; parts.push({ h: t.v, key: l.k }) } else parts.push({ h: t.v }); continue }
      if (t.k === 'n' && list.length === 1) return { n: Number(t.v) }
      return { x: t.k === 'w' ? t.v : '' }
    }
    return parts.length ? { s: parts } : { x: '' }
  }
  for (let j = 0; j + 3 < tk.length && out.commands.length < MAX_LUA; j++) {
    if (!(tk[j].k === 'w' && tk[j].v === 'redis' && tk[j + 1].v === '.' && tk[j + 2].k === 'w' && (tk[j + 2].v === 'call' || tk[j + 2].v === 'pcall') && tk[j + 3].v === '(')) continue
    const args = []
    let cur = [], depth = 0, k = j + 4
    for (; k < tk.length; k++) {
      const t = tk[k]
      if (t.k === 'o' && (t.v === '(' || t.v === '{' || t.v === '[')) depth++
      if (t.k === 'o' && (t.v === ')' || t.v === '}' || t.v === ']')) { if (depth === 0) break; depth-- }
      if (t.k === 'o' && t.v === ',' && depth === 0) { if (args.length < MAX_ARGS) args.push(cur); cur = []; continue }
      if (cur.length < 64) cur.push(t)
    }
    if (k >= tk.length) { out.notes.push(`a redis.call at line ${tk[j].line} that never closes: not read`); break }
    if (cur.length) args.push(cur)
    const first = args[0]
    const cmd = first && first.length === 1 && first[0].k === 's' ? first[0].v : null
    if (cmd && COMMANDS.has(cmd.toUpperCase())) out.commands.push({ name: cmd.toUpperCase(), args: args.slice(1).map(argOf), line: tk[j].line })
    else out.notes.push(`a redis.call at line ${tk[j].line} whose command is not a literal: not read`)
    j = k
  }
  return out
}
// Lua arguments with KEYS[n] mapped to a call's key arguments (keys: [Arg] | null when unknown)
export function mapKeys(args, keys) {
  return args.map((a) => {
    if (a.k !== undefined) return keys && keys[a.k - 1] ? keys[a.k - 1] : { x: `KEYS${a.k}` }
    if (a.s && a.s.some((p) => typeof p !== 'string' && p.key !== undefined)) {
      const parts = []
      for (const p of a.s) {
        if (typeof p === 'string' || p.key === undefined) { parts.push(typeof p === 'string' ? p : { h: p.h }); continue }
        const k = keys && keys[p.key - 1]
        if (k && k.s) parts.push(...k.s)
        else parts.push({ h: k?.x || p.h })
      }
      return { s: parts }
    }
    return a
  })
}

// ── a connection URL: only its database index is ever kept ──
// redis://[user[:password]@]host[:port][/db] · rediss:// · unix://…?db=n → { db } | null
export function urlDb(text) {
  const m = /^(?:rediss?|valkeys?|unix):\/\//i.exec(String(text ?? ''))
  if (!m) return null
  const rest = String(text).slice(m[0].length, m[0].length + 512)
  const q = /[?&]db=(\d{1,3})(?:&|$)/.exec(rest)
  if (q) return { db: Number(q[1]) }
  const path = /^[^/?#]*\/(\d{1,3})(?:[?#]|$)/.exec(rest)
  return path ? { db: Number(path[1]) } : { db: null }
}
