// grimoire graph · data · extractor: the instances of a key-value cache the infrastructure declares
// (kind infra), and the environment variables it wires to them, for the key spaces code reaches
// (data/redis.mjs). Per unit, found by content:
//   Terraform  a module folder whose .tf declares `aws_elasticache_replication_group`,
//              `aws_elasticache_cluster`, `aws_elasticache_serverless_cache`, `aws_memorydb_cluster`,
//              `upstash_redis_database`, or a `helm_release` of a Redis-family chart (level bit 8 of a
//              .tf: terraform.mjs tfLevel), each instance of the module evaluated as terraform.mjs
//              evaluates one (its Terragrunt configurations' inputs, else its tfvars, else its
//              defaults: readers/hcl-eval.mjs);
//   Compose    a Compose file (`compose.yaml`, `docker-compose.yml`, `compose.*.yaml`) whose service's
//              image is Redis-family (redis, redis/redis-stack*, valkey/valkey, eqalpha/keydb, a
//              dragonfly image): readers/yaml.mjs.
// Read, only from what the files state (never a default the provider or the image applies):
//   engine and version   the resource's engine and engine_version, the image and its tag;
//   modules              `--loadmodule` / `loadmodule` lines (by their file's name), or the image's
//                        own (redis-stack, and Redis 8 and later: search, JSON, time series, bloom);
//   maxmemory-policy, persistence (appendonly, save, a snapshot retention), keyspace notifications
//   (notify-keyspace-events), databases: a parameter group's `parameter` blocks, the server's flags
//   (`command`, REDIS_ARGS), a chart's `set` blocks and values (`*.config.<directive>`, a
//   `customConfig` or `configuration` text, `extraFlags`), each a directive of redis.conf.
// A chart's `set` and values are read only under those names: no other value is evaluated (a
// `set_sensitive`, an auth password, a token never are). A values file is read only when its path is
// a literal in the repository. What the evaluator cannot know stays its expression, never guessed.
// Wiring: an environment variable a Compose service sets to a value naming the Redis service as its
// host (`REDIS_URL: redis://cache:6379/0`, `REDIS_HOST: cache`), with the service's build context
// (the repository it builds, by the context's last folder); a Terraform resource's environment
// (`environment { variables = { … } }`, a container's `env { name, value }`) whose value refers to the
// instance's resource. Only the variable's name and line are kept, never its value.
//
// Facts: { declarations: [], redisInfra: [Instance] }
//   Instance { name: 'redis:<label>', label, kind, engine, version, modules, eviction, persistence,
//              notifications, databases (each a value, null when not stated, or { expr } unknown),
//              path, line, env: [{ env, path, line, build }], notes }
import path from 'node:path'
import { parseHcl, refText, HCL_MAX } from '../readers/hcl.mjs'
import { Evaluator, BudgetError, Unknown, Partial, isUnk, readModule, moduleScope, instancesOf, attrOf, blocksOf, Terragrunt, moduleDir, isObj, memberAt, EVAL_MS } from '../readers/hcl-eval.mjs'
import { wantsTf, TF_LEVEL, REDIS_TF, varsOf } from './terraform.mjs'
import { DOC, documents } from '../readers/documents.mjs'

const P = path.posix
const TF = /\.tf$/i, TFVARS = /\.tfvars(?:\.json)?$/i, HCL = /\.hcl$/i, YAMLF = /\.ya?ml$/i
const UNIT_FILE = /(?:^|\/)terragrunt\.hcl$/
const AUTO = /(?:^|\/)terraform\.tfvars(?:\.json)?$|\.auto\.tfvars(?:\.json)?$/i
export const COMPOSE = /(?:^|\/)(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/i
// a .tf declaring an instance: terraform.mjs tfLevel adds TF_LEVEL.redis (REDIS_TF, linear)
export { REDIS_TF }
const RESOURCES = { aws_elasticache_replication_group: 'ElastiCache replication group', aws_elasticache_cluster: 'ElastiCache cluster', aws_elasticache_serverless_cache: 'ElastiCache serverless cache', aws_memorydb_cluster: 'MemoryDB cluster', upstash_redis_database: 'Upstash database', helm_release: 'Helm release' }
const CHART = /redis|valkey|keydb|dragonfly/i
const msg = (e) => String(e?.message || e).split('\n')[0].slice(0, 200)

// ── an image, a module file, a configuration ──
const STACK = ['search', 'JSON', 'time series', 'bloom']
export function imageOf(ref) {
  const m = /(?:^|\/)(redis-stack-server|redis-stack|redis|valkey|keydb|dragonfly)(?::([A-Za-z0-9._-]{1,64}))?(?:@sha256:[0-9a-f]{8,64})?$/i.exec(String(ref ?? '').trim())
  if (!m) return null
  const name = m[1].toLowerCase(), tag = m[2] || null
  const engine = name.startsWith('redis-stack') ? 'Redis Stack' : name === 'redis' ? 'Redis' : name === 'valkey' ? 'Valkey' : name === 'keydb' ? 'KeyDB' : 'Dragonfly'
  const major = tag && /^\d+/.test(tag) ? Number(/^\d+/.exec(tag)[0]) : null
  return { engine, version: tag, modules: name.startsWith('redis-stack') || (name === 'redis' && major !== null && major >= 8) ? STACK : [], from: name.startsWith('redis-stack') ? 'the redis-stack image' : 'Redis 8 and later' }
}
const MODULE_FILES = [[/redisearch|search/i, 'search'], [/rejson|redisjson|json/i, 'JSON'], [/timeseries/i, 'time series'], [/bloom/i, 'bloom'], [/gears/i, 'gears'], [/graph/i, 'graph']]
const moduleName = (p) => { const base = String(p).split('/').pop().replace(/\.so$/i, ''); const hit = MODULE_FILES.find(([re]) => re.test(base)); return hit ? hit[1] : base.slice(0, 40) }
// redis.conf directives (a text, or the server's --flags): what the instance states, and what code
// or another file fills in (a part the evaluator did not know: `\u0001`) as unknown
const HOLE = '\u0001'
export function confOf(text, out = {}) {
  const t = String(text ?? '').slice(0, 64 << 10)
  const items = []
  if (/(?:^|\s)--[a-z]/.test(t)) { const w = t.trim().split(/\s+/); for (let i = 0; i < w.length; i++) if (w[i].startsWith('--')) { const vals = []; while (i + 1 < w.length && !w[i + 1].startsWith('--')) vals.push(w[++i]); items.push([w[i - vals.length].slice(2), vals.join(' ')]) } }
  else for (const line of t.split('\n')) { const l = line.trim(); if (!l || l.startsWith('#')) continue; const sp = l.search(/\s/); items.push(sp < 0 ? [l, ''] : [l.slice(0, sp), l.slice(sp + 1).trim()]) }
  for (const [k0, v0] of items) {
    const k = k0.toLowerCase(), v = v0.replace(/^"(.*)"$/, '$1')
    const val = v.includes(HOLE) || k.includes(HOLE) ? { expr: v.replace(new RegExp(HOLE, 'g'), '${…}').slice(0, 120) } : v
    if (k === 'maxmemory-policy') out.eviction = val
    else if (k === 'appendonly') out.aof = val
    else if (k === 'save') out.save = v === '' || v === '""' ? 'off' : 'on'
    else if (k === 'notify-keyspace-events') out.notifications = val === '' ? 'off' : val
    else if (k === 'databases') out.databases = typeof val === 'string' && /^\d+$/.test(val) ? Number(val) : val
    else if (k === 'loadmodule') { out.modules ||= []; const name = v.includes(HOLE) ? { expr: v.replace(new RegExp(HOLE, 'g'), '${…}').slice(0, 120) } : moduleName(v.split(/\s+/)[0]); if (out.modules.length < 16) out.modules.push(name) }
  }
  return out
}
// the instance's facts from what was read: an image, a configuration, the resource's own attributes
function settle(x, conf, img) {
  const modules = [...new Set([...(conf.modules || []).map((m) => (typeof m === 'string' ? m : `${m.expr} (unknown)`)), ...(img && !(conf.modules || []).length ? img.modules : [])])]
  const aof = conf.aof === 'yes' ? 'AOF' : conf.aof === 'no' ? null : conf.aof && conf.aof.expr ? `appendonly ${conf.aof.expr}` : null
  const persistence = [aof, conf.save === 'on' ? 'RDB snapshots' : null, x.persistence || null].filter(Boolean).join(' + ') || (conf.aof === 'no' && conf.save === 'off' ? 'none' : null)
  return { ...x, engine: x.engine ?? img?.engine ?? null, version: x.version ?? img?.version ?? null, modules, ...(img && !(conf.modules || []).length && img.modules.length ? { modulesFrom: img.from } : {}), eviction: conf.eviction ?? x.eviction ?? null, persistence: persistence || null, notifications: conf.notifications ?? x.notifications ?? null, databases: conf.databases ?? x.databases ?? null }
}

export default {
  id: 'redis-infra',
  version: 1,
  kind: 'infra',
  scope: 'unit',
  wants: (p) => wantsTf(p) || COMPOSE.test(p) || DOC.test(p),
  // a Compose file is kept whatever its content (registry.mjs keeps); a template only by its level
  config: (p) => COMPOSE.test(p),
  discover(info) {
    const all = [...info.keys()]
    const hcl = all.filter((p) => HCL.test(p) && wantsTf(p) && !(info.get(p).size > HCL_MAX)).sort()
    const dirs = [...new Set(all.filter((p) => TF.test(p) && (info.get(p).ddl & TF_LEVEL.redis)).map((p) => P.dirname(p)))].sort()
    const jobs = dirs.map((dir) => {
      const own = all.filter((p) => P.dirname(p) === dir && (TF.test(p) || TFVARS.test(p) || YAMLF.test(p))).sort()
      return { key: dir, inputs: [...own, ...hcl.filter((p) => !own.includes(p))], override: 'tf' }
    })
    for (const p of all.filter((x) => COMPOSE.test(x)).sort()) jobs.push({ key: p, inputs: [p], override: 'compose' })
    for (const p of all.filter((x) => DOC.test(x) && !COMPOSE.test(x) && info.get(x).ddl >= 8).sort()) jobs.push({ key: p, inputs: [p], override: 'cfn' })
    return jobs
  },
  extract({ key, files, override }, ctx) {
    if (override === 'compose') return { declarations: [], redisInfra: compose(files[0], ctx) }
    if (override === 'cfn') return { declarations: [], redisInfra: cloudformation(files[0], ctx) }
    return { declarations: [], redisInfra: terraform(key, files, ctx) }
  },
}

// ── Compose ──
function compose(file, ctx) {
  if (!ctx.yaml) return []
  const docs = ctx.yaml(file.text)
  const out = []
  for (const d of docs) {
    const services = d.value && typeof d.value === 'object' && d.value.services && typeof d.value.services === 'object' ? d.value.services : null
    if (!services) continue
    const at = (...p) => { let k = ['services', ...p]; for (; k.length; k = k.slice(0, -1)) { const l = d.lines.get(k.join('\u0000')); if (l) return l } return d.line || 1 }
    const redis = Object.entries(services).filter(([, s]) => s && typeof s === 'object' && typeof s.image === 'string' && imageOf(s.image))
    for (const [name, s] of redis.slice(0, 16)) {
      const img = imageOf(s.image)
      const env = envOf(s.environment)
      const flags = [Array.isArray(s.command) ? s.command.map(String).join(' ') : typeof s.command === 'string' ? s.command : '', typeof env.get('REDIS_ARGS') === 'string' ? env.get('REDIS_ARGS') : ''].join(' ')
      const conf = confOf(flags.replace(/^\s*(?:redis-server|valkey-server|keydb-server)\b/, ''))
      out.push({ ...settle({ name: `redis:${name}`, label: name, kind: 'Compose service', path: file.path, line: at(name), notes: [] }, conf, img), env: [] })
    }
    if (!redis.length) continue
    // the variables other services set to a Redis service: its name as the host of the value
    for (const [sname, s] of Object.entries(services)) {
      if (!s || typeof s !== 'object' || redis.some(([n]) => n === sname)) continue
      const build = typeof s.build === 'string' ? s.build : s.build && typeof s.build.context === 'string' ? s.build.context : null
      for (const [k, v] of envOf(s.environment)) {
        if (typeof v !== 'string') continue
        const hit = redis.find(([n]) => v === n || new RegExp(`^(?:[a-z]+://)?(?:[^@/\\s]*@)?${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?::\\d+)?(?:/\\d*)?$`).test(v.trim()))
        if (!hit) continue
        const inst = out.find((i) => i.label === hit[0] && i.path === file.path)
        if (inst && inst.env.length < 32) inst.env.push({ env: k, path: file.path, line: at(sname, 'environment', k) || at(sname, 'environment'), build: build && build.length <= 200 ? build : null, service: sname })
      }
    }
  }
  return out
}
// a service's environment: a map, or a list of KEY=value
function envOf(e) {
  const m = new Map()
  if (Array.isArray(e)) for (const x of e) { if (typeof x !== 'string') continue; const i = x.indexOf('='); if (i > 0) m.set(x.slice(0, i), x.slice(i + 1)); else m.set(x, null) }
  else if (e && typeof e === 'object') for (const [k, v] of Object.entries(e)) m.set(k, v === null ? null : String(v))
  return m
}

// ── CloudFormation: AWS::ElastiCache::ReplicationGroup, CacheCluster, ServerlessCache, AWS::MemoryDB::Cluster ──
// Engine, EngineVersion (MajorEngineVersion), a snapshot retention, and the parameter group it names by
// Ref (AWS::ElastiCache::ParameterGroup's Properties, AWS::MemoryDB::ParameterGroup's Parameters); a
// function's Environment.Variables naming the cluster (Ref, GetAtt, Sub) wire that variable to it
const CFN_KIND = { 'AWS::ElastiCache::ReplicationGroup': 'ElastiCache replication group', 'AWS::ElastiCache::CacheCluster': 'ElastiCache cluster', 'AWS::ElastiCache::ServerlessCache': 'ElastiCache serverless cache', 'AWS::MemoryDB::Cluster': 'MemoryDB cluster' }
function cloudformation(file, ctx) {
  const docs = documents(file.text, file.path, ctx)
  const out = []
  for (const d of docs) {
    const R = d.value && typeof d.value === 'object' && d.value.Resources && typeof d.value.Resources === 'object' ? d.value.Resources : null
    if (!R) continue
    const lineOf = (...p) => { for (let k = ['Resources', ...p]; k.length; k = k.slice(0, -1)) { const l = d.lines.get(k.join('\u0000')); if (l) return l } return 1 }
    const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : v === undefined || v === null ? null : { expr: JSON.stringify(v).slice(0, 80) })
    const refers = (v, id) => { const s = JSON.stringify(v ?? null).slice(0, 4000); return s.includes(`"${id}"`) || s.includes(`"${id}.`) || s.includes(`\${${id}.`) || s.includes(`\${${id}}`) }
    for (const [id, r] of Object.entries(R)) {
      if (!r || typeof r !== 'object' || !CFN_KIND[r.Type]) continue
      const p = r.Properties && typeof r.Properties === 'object' ? r.Properties : {}
      const x = { engine: typeof p.Engine === 'string' ? (/valkey/i.test(p.Engine) ? 'Valkey' : 'Redis') : str(p.Engine), version: str(p.EngineVersion ?? p.MajorEngineVersion), persistence: r.Type === 'AWS::MemoryDB::Cluster' ? 'durable (a multi-AZ transaction log)' : typeof p.SnapshotRetentionLimit === 'number' && p.SnapshotRetentionLimit > 0 ? 'RDB snapshots' : null }
      const conf = {}
      const pgRef = p.CacheParameterGroupName ?? p.ParameterGroupName
      const pgId = pgRef && typeof pgRef === 'object' ? (pgRef.Ref || (pgRef.value && typeof pgRef.value === 'string' ? pgRef.value : null)) : null
      const pg = pgId && R[pgId] && typeof R[pgId] === 'object' ? R[pgId].Properties || {} : null
      const params = pg ? pg.Properties || pg.Parameters || {} : {}
      if (params && typeof params === 'object') for (const k of ['maxmemory-policy', 'notify-keyspace-events', 'appendonly', 'databases']) if (typeof params[k] === 'string' || typeof params[k] === 'number') confOf(`${k} ${params[k]}`, conf)
      const env = []
      for (const [fid, f] of Object.entries(R)) {
        const vars = f && typeof f === 'object' && f.Properties && f.Properties.Environment && f.Properties.Environment.Variables
        if (!vars || typeof vars !== 'object') continue
        for (const [k, v] of Object.entries(vars)) if (refers(v, id) && env.length < 32) env.push({ env: k, path: file.path, line: lineOf(fid, 'Properties', 'Environment', 'Variables', k), build: null })
      }
      out.push({ ...settle(x, conf, null), name: `redis:${id}`, label: id, kind: CFN_KIND[r.Type], path: file.path, line: lineOf(id), env, notes: [] })
    }
  }
  return out
}

// ── Terraform ──
const bounded = (e) => (e instanceof BudgetError ? e : e instanceof RangeError ? new BudgetError('a value too large or too deep for the evaluator') : null)
function terraform(dir, files, ctx) {
  const deadline = Date.now() + EVAL_MS
  const texts = new Map(files.map((f) => [f.path, f.text]))
  const parsed = new Map()
  const body = (p) => { if (!parsed.has(p)) { try { parsed.set(p, parseHcl(texts.get(p), { deadline }).body) } catch (e) { parsed.set(p, e) } } const b = parsed.get(p); if (b instanceof Error) throw b; return b }
  const fsx = { has: (p) => texts.has(p) && HCL.test(p), body }
  const own = files.map((f) => f.path).filter((p) => P.dirname(p) === dir)
  const modFiles = []
  const notes = []
  for (const p of own.filter((x) => TF.test(x))) { try { modFiles.push({ path: p, body: body(p) }) } catch (e) { notes.push(`${p} does not parse: ${msg(e)}`) } }
  const mod = readModule(modFiles)
  // a helm release of a Redis-family chart (its chart a literal naming one, or what the evaluation says)
  const chartLit = (r) => { const e = r.block.body.items.find((x) => x.t === 'attr' && x.name === 'chart')?.expr; return e && e.t === 'lit' && typeof e.v === 'string' ? e.v : null }
  const resources = mod.resources.filter((r) => r.type in RESOURCES && (r.type !== 'helm_release' || chartLit(r) === null || CHART.test(chartLit(r))))
  if (!resources.length) return []
  // the configurations that run this module, as terraform.mjs finds them
  const instances = []
  for (const u of files.map((f) => f.path).filter((p) => UNIT_FILE.test(p)).sort()) {
    const ev = new Evaluator({ deadline })
    try {
      const tg = new Terragrunt(u, fsx, ev)
      const src = tg.source()
      if (!src || typeof src.v !== 'string') continue
      if (moduleDir(src.v, P.dirname(u)).dir === dir) instances.push({ kind: 'terragrunt', path: u, tg, ev })
    } catch (e) { if (!bounded(e) && !(e instanceof Error)) throw e }
  }
  const varFiles = own.filter((p) => TFVARS.test(p))
  const auto = varFiles.filter((p) => AUTO.test(p)).sort()
  if (!instances.length) { const named = varFiles.filter((p) => !AUTO.test(p)).sort(); if (named.length) for (const p of named) instances.push({ kind: 'tfvars', path: p }); else instances.push({ kind: 'module', path: resources[0].path }) }
  const out = []
  for (const inst of instances.slice(0, 16)) {
    const ev = inst.ev || new Evaluator({ deadline })
    const values = new Map()
    const n2 = [...notes]
    try {
      if (inst.kind === 'terragrunt') { const { v } = inst.tg.inputs(); if (isObj(v)) for (const k of Object.keys(v)) values.set(k, { v: v[k], at: memberAt(v, k) }) }
      for (const p of [...auto, ...(inst.kind === 'tfvars' ? [inst.path] : [])]) { try { for (const [k, x] of varsOf(p, body, texts, ev)) values.set(k, x) } catch (e) { if (bounded(e)) throw e; n2.push(`${p} does not parse: ${msg(e)}`) } }
      const scope = moduleScope(mod, values, { dir }).scope
      const suffix = instances.length > 1 ? ` (${P.dirname(inst.path)})` : ''
      for (const res of resources) {
        const r = instancesOf(res, scope, ev)
        for (const one of (r.list || []).slice(0, 16)) {
          const key = one.key === null ? '' : `[${JSON.stringify(one.key)}]`
          const label = `${res.type}.${res.name}${key}${suffix}`
          const x = resource(res, one.scope, ev, mod, scope, texts, ctx, n2)
          if (!x) continue
          out.push({ ...x, name: `redis:${label}`, label, kind: RESOURCES[res.type], path: inst.kind === 'module' ? res.path : inst.path, line: inst.kind === 'module' ? res.block.line : 1, via: { path: res.path, line: res.block.line }, env: wiring(mod, res), notes: n2.slice(0, 8) })
        }
      }
    } catch (e) { if (!bounded(e)) throw e; n2.push(`the evaluation stopped: ${msg(bounded(e))}`) }
  }
  return out
}
// a value as the model keeps it: a string or a number, an unknown as its expression (a Partial's
// unknown parts as HOLE, for confOf), else null
function text(v, holes = false) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Partial && holes) return v.parts.map((p) => (typeof p === 'string' ? p : HOLE)).join('')
  if (v instanceof Unknown) return { expr: `\${${String(v.text).slice(0, 80)}}` }
  if (v instanceof Partial) return { expr: v.parts.map((p) => (typeof p === 'string' ? p : `\${${String(p.text).slice(0, 60)}}`)).join('').slice(0, 120) }
  return null
}
const val = (body, name, sc, ev, holes = false) => { const a = attrOf(body, name, sc, ev); return a.has ? text(a.v, holes) : null }
// what one resource states
function resource(res, sc, ev, mod, mscope, texts, ctx, notes) {
  const b = res.block.body
  const x = {}
  let conf = {}, img = null
  if (res.type === 'helm_release') {
    // only the set names this reads are evaluated: never a set_sensitive, never another value
    for (const s of blocksOf(b, 'set', sc, ev).list) {
      const nameV = attrOf(s.body, 'name', s.scope, ev).v
      if (typeof nameV !== 'string') continue
      const k = nameV.replace(/\\\./g, '.')
      if (/(?:^|\.)image\.(?:repository|tag)$/.test(k)) { const v = val(s.body, 'value', s.scope, ev); if (typeof v === 'string') x[/repository$/.test(k) ? 'repo' : 'tag'] = v; continue }
      if (/(?:customConfig|configuration)$/i.test(k)) { const v = val(s.body, 'value', s.scope, ev, true); if (typeof v === 'string') confOf(v, conf); continue }
      const d = /(?:^|\.)config\.([a-z-]+)$/.exec(k)
      if (d) { const v = val(s.body, 'value', s.scope, ev, true); if (typeof v === 'string') confOf(`${d[1]} ${v}`, conf); continue }
      if (/extraFlags(?:\[\d+\])?$/.test(k)) { const v = val(s.body, 'value', s.scope, ev, true); if (typeof v === 'string') confOf(v.startsWith('--') ? v : `--${v}`, conf) }
    }
    // values: a literal file of the repository, or yamlencode(...) objects
    const vexpr = b.items.find((i) => i.t === 'attr' && i.name === 'values')?.expr
    const files = vexpr ? fileArgs(vexpr).map((f) => P.normalize(P.join(P.dirname(res.path), f))) : []
    for (const f of files) { if (!texts.has(f) || !ctx.yaml) { notes.push(`${res.type}.${res.name}: a values file ${f} not in the repository: not read`); continue } try { for (const d of ctx.yaml(texts.get(f))) valuesOf(d.value, conf, x) } catch (e) { notes.push(`${f} does not parse: ${msg(e)}`) } }
    img = imageOf(x.repo ? `${x.repo}${x.tag ? `:${x.tag}` : ''}` : '')
    const chart = val(b, 'chart', sc, ev)
    if (typeof chart === 'string' && !CHART.test(chart)) return null
    if (!img && typeof chart === 'string') x.engine = /valkey/i.test(chart) ? 'Valkey' : /keydb/i.test(chart) ? 'KeyDB' : /dragonfly/i.test(chart) ? 'Dragonfly' : 'Redis'
    x.chart = typeof chart === 'string' ? chart : null
    delete x.repo; delete x.tag
  } else if (res.type === 'upstash_redis_database') {
    x.engine = 'Upstash Redis'
    const e = attrOf(b, 'eviction', sc, ev)
    x.eviction = e.has ? (e.v === true ? 'eviction on (the provider\'s policy)' : e.v === false ? 'noeviction' : text(e.v)) : null
  } else {
    const engine = val(b, 'engine', sc, ev)
    x.engine = typeof engine === 'string' ? (/valkey/i.test(engine) ? 'Valkey' : 'Redis') : engine
    x.version = val(b, 'engine_version', sc, ev) ?? val(b, 'major_engine_version', sc, ev)
    if (res.type === 'aws_memorydb_cluster') x.persistence = 'durable (a multi-AZ transaction log)'
    const snap = attrOf(b, 'snapshot_retention_limit', sc, ev)
    if (snap.has && typeof snap.v === 'number' && snap.v > 0) x.persistence = 'RDB snapshots'
    // a parameter group of the module, by its address
    const pg = b.items.find((i) => i.t === 'attr' && i.name === 'parameter_group_name')
    const m = pg ? /^(aws_(?:elasticache|memorydb)_parameter_group)\.([A-Za-z_][\w-]*)\.(?:name|id)$/.exec(refText(pg.expr, 200)) : null
    const group = m ? mod.resources.find((r) => r.type === m[1] && r.name === m[2]) : null
    if (group) for (const p of blocksOf(group.block.body, 'parameter', mscope, ev).list) { const n = attrOf(p.body, 'name', p.scope, ev).v; if (typeof n === 'string' && /^(?:maxmemory-policy|notify-keyspace-events|appendonly|databases)$/.test(n)) { const v = val(p.body, 'value', p.scope, ev, true); if (typeof v === 'string') confOf(`${n} ${v}`, conf) } }
  }
  return settle(x, conf, img)
}
// the literal paths a values list reads through file(): `file("${path.module}/values.yaml")`, `file("values.yaml")`
function fileArgs(expr, depth = 0, out = []) {
  if (!expr || depth > 8 || out.length >= 8) return out
  if (expr.t === 'call' && expr.name === 'file' && expr.args && expr.args[0]) {
    const a = expr.args[0]
    const parts = a.t === 'lit' && typeof a.v === 'string' ? [a.v] : a.t === 'tpl' ? a.parts : null
    if (!parts) return out
    let p = '', ok = true
    for (const x of parts) {
      if (typeof x === 'string') p += x
      else if (!p && x.t === 'interp' && x.x && x.x.t === 'get' && x.x.name === 'module' && x.x.x && x.x.x.name === 'path') continue
      else ok = false
    }
    if (ok && p) out.push(p.replace(/^\/+/, ''))
    return out
  }
  for (const x of expr.items || expr.args || []) fileArgs(x, depth + 1, out)
  return out
}
// a chart's values: image.repository / tag, *.config (directives), *.customConfig / configuration (a text), extraFlags
function valuesOf(v, conf, x, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 6) return
  for (const [k, w] of Object.entries(v)) {
    if (k === 'image' && w && typeof w === 'object') { if (typeof w.repository === 'string') x.repo = w.repository; if (typeof w.tag === 'string' || typeof w.tag === 'number') x.tag = String(w.tag); continue }
    if ((k === 'customConfig' || k === 'configuration' || k === 'commonConfiguration') && typeof w === 'string') { confOf(w, conf); continue }
    if (k === 'config' && w && typeof w === 'object' && !Array.isArray(w)) { for (const [d, dv] of Object.entries(w)) if (typeof dv === 'string' || typeof dv === 'number') confOf(`${d} ${dv}`, conf); continue }
    if (k === 'extraFlags' && Array.isArray(w)) { confOf(w.filter((f) => typeof f === 'string').join(' '), conf); continue }
    if (w && typeof w === 'object' && !Array.isArray(w)) valuesOf(w, conf, x, depth + 1)
  }
}
// the environment variables the module's resources set to this instance: a value referring to it
function wiring(mod, inst) {
  const out = []
  const addr = `${inst.type}.${inst.name}`
  const refers = (expr) => refText(expr, 400).includes(addr)
  for (const res of mod.resources) {
    const walk = (items, depth) => {
      if (depth > 6) return
      for (const b of items) {
        if (b.t !== 'block') continue
        if (b.type === 'environment') {
          const vars = b.body.items.find((x) => x.t === 'attr' && x.name === 'variables')
          if (vars && vars.expr.t === 'object') for (const it of vars.expr.items) { const key = it.key && it.key.t === 'lit' && typeof it.key.v === 'string' ? it.key.v : null; if (key && it.value && refers(it.value) && out.length < 32) out.push({ env: key, path: res.path, line: it.line ?? b.line, build: null }) }
        }
        if (b.type === 'env') {
          const n = b.body.items.find((x) => x.t === 'attr' && x.name === 'name'), v = b.body.items.find((x) => x.t === 'attr' && x.name === 'value')
          if (n && v && n.expr.t === 'lit' && typeof n.expr.v === 'string' && refers(v.expr) && out.length < 32) out.push({ env: n.expr.v, path: res.path, line: b.line, build: null })
        }
        walk(b.body.items, depth + 1)
      }
    }
    walk(res.block.body.items, 0)
  }
  return out
}
