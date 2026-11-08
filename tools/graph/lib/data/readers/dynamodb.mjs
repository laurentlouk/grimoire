// grimoire graph · data · a key-value table declared in the AWS shape: DynamoDB's CreateTable request
// (TableName, KeySchema, AttributeDefinitions, GlobalSecondaryIndexes, LocalSecondaryIndexes,
// TimeToLiveSpecification, StreamSpecification, BillingMode), whose members a CloudFormation table
// resource's Properties repeat, read into the model's entity (model.mjs):
//   fields   the attributes AttributeDefinitions types (S, N, B); not null when they key the table,
//            nullable when they only key an index (an item without them is not in that index)
//   keys     partition (the HASH attributes, in order) and sort (the RANGE ones): up to four each, as
//            a multi-attribute index key allows; ttl (TimeToLiveSpecification's attribute, enabled
//            true, false, or null when not said)
//   indexes  each GSI and LSI: { name, kind: gsi | lsi, partition, sort, projection: ALL | KEYS_ONLY |
//            INCLUDE, include: its NonKeyAttributes, columns: partition then sort }
//   billing  BillingMode, else PROVISIONED when ProvisionedThroughput is stated, else (a SAM
//            SimpleTable) PAY_PER_REQUEST, as SAM documents; null when nothing says
//   stream   StreamSpecification's view type, null when there is none (or StreamEnabled is false)
// Each element at the line that declares it.
//
// References are kept, never evaluated: an intrinsic function in the YAML short form (`!Ref X`,
// `!Sub '${AWS::StackName}-loans'`, `!GetAtt T.Arn`, `!If [...]`: any tag, readers/yaml.mjs) or the
// long form (`{ "Ref": "X" }`, `{ "Fn::Sub": … }`: an object of one member named Ref, Condition or
// Fn::…) stands in the model as its short-form text (`!Ref X`); a string holding `${…}` (a Sub
// template, a Serverless Framework variable) stays as written. Either is unresolved: isRef says so,
// and the declaration's notes say where. A part stated by a reference (`GlobalSecondaryIndexes:
// !If [...]`) cannot be read: the table is then not `whole`, so what it seems to lack is no
// disagreement with another declaration (reconcile.mjs).
//
// Found by content (registry.mjs inspect): tableLevel(text) is LEVEL.template when the text names a
// table resource type, LEVEL.schema when it holds a KeySchema and AttributeDefinitions (a CreateTable
// input), else 0.
import { tagOf } from './yaml.mjs'

export const TABLE_TYPES = ['AWS::DynamoDB::Table', 'AWS::DynamoDB::GlobalTable', 'AWS::Serverless::SimpleTable']
export const LEVEL = { schema: 2, template: 3 }
const TEMPLATE = /AWS::(?:DynamoDB::(?:Global)?Table|Serverless::SimpleTable)\b/
// (plus 8 when a template names a key-value cache's resource: extractors/redis-infra.mjs; the table
// extractors compare it modulo 8)
export const CACHE_TEMPLATE = /AWS::(?:ElastiCache::(?:ReplicationGroup|CacheCluster|ServerlessCache)|MemoryDB::Cluster)\b/
export const tableLevel = (text) => (TEMPLATE.test(text) ? LEVEL.template : /\bKeySchema\b/.test(text) && /\bAttributeDefinitions\b/.test(text) ? LEVEL.schema : 0) + (CACHE_TEMPLATE.test(text) ? 8 : 0)

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
// an intrinsic function's name (Ref, Sub, GetAtt, If…), or null
export function fnOf(v) {
  const t = tagOf(v)
  if (t) return t.replace(/^!/, '')
  if (!isObj(v)) return null
  const ks = Object.keys(v)
  return ks.length === 1 && (ks[0] === 'Ref' || ks[0] === 'Condition' || ks[0].startsWith('Fn::')) ? ks[0].replace(/^Fn::/, '') : null
}
const argOf = (v) => (tagOf(v) ? v.value : v[Object.keys(v)[0]])
// (a `${` with a `}` after it, found by two scans, never a regular expression that backtracks)
const holdsVar = (s) => { const i = s.indexOf('${'); return i >= 0 && s.indexOf('}', i + 2) >= 0 }
export const isRef = (v) => fnOf(v) !== null || (typeof v === 'string' && holdsVar(v))

// A value as text: a reference in its short form, at most MAX characters (a reference may nest
// others, and aliases may make it large: the walk stops once the text is long enough).
const MAX = 160
export function textOf(v) {
  const out = []
  let n = 0
  const add = (s) => { out.push(s); n += s.length }
  const walk = (x) => {
    if (n >= MAX) return
    const fn = fnOf(x)
    if (fn) {
      add(`!${fn} `)
      const a = argOf(x)
      if (fn === 'GetAtt' && Array.isArray(a)) a.forEach((y, i) => { if (i) add('.'); walk(y) })
      else walk(a)
      return
    }
    if (Array.isArray(x)) { add('['); for (let i = 0; i < x.length && n < MAX; i++) { if (i) add(', '); walk(x[i]) } add(']'); return }
    if (isObj(x)) { add('{'); let i = 0; for (const k in x) { if (n >= MAX) break; add(`${i++ ? ', ' : ''}${k}: `); walk(x[k]) } add('}'); return }
    add(x === null || x === undefined ? 'null' : String(x))
  }
  walk(v)
  const s = out.join('')
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s
}

// One table's properties → { entity, notes }.
//   name   the entity's name; label: how a note names the table (its name by default)
//   at(…path) → { path, line } of a member of the properties (the table's own line for none)
//   simple a SAM SimpleTable: PrimaryKey { Name, Type: String | Number | Binary } (by default `id`, a
//          string, as SAM documents) and ProvisionedThroughput, nothing else
//   extra  members the entity carries as they are (its `as`)
export function readTable(p, { name, at, label = name, simple = false, extra = {} }) {
  const notes = [], unread = []
  const said = new Set()
  const say = (what, v) => { if (!said.has(what)) { said.add(what); notes.push(`${label}: ${what} is ${textOf(v)}, a reference, not resolved`) } }
  // a scalar as the model keeps it: a reference as its text (and said), else as it is
  const one = (v, what) => { if (v === undefined || v === null) return null; if (isRef(v)) { say(what, v); return textOf(v) } return typeof v === 'object' ? textOf(v) : v }
  const flag = (v, what) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : one(v, what))
  const list = (v, what) => {
    if (v === undefined || v === null) return []
    if (Array.isArray(v)) return v
    unread.push(what); say(what, v); return []
  }
  // a KeySchema: the HASH attributes are the partition key, the RANGE ones the sort key
  const keySchema = (v, what) => {
    const out = { partition: [], sort: [], first: {} }
    list(v, what).forEach((k, i) => {
      const w = `${what}[${i}]`
      if (!isObj(k) || fnOf(k)) { unread.push(w); say(w, k); return }
      const type = one(k.KeyType, `${w}.KeyType`), attr = one(k.AttributeName, `${w}.AttributeName`)
      const role = type === 'HASH' ? 'partition' : type === 'RANGE' ? 'sort' : null
      if (!role || attr === null) { unread.push(w); notes.push(`${label}: ${w} is no HASH or RANGE key of a named attribute`); return }
      if (!(role in out.first)) out.first[role] = i
      out[role].push(String(attr))
    })
    for (const role of ['partition', 'sort']) if (out[role].length > 4) notes.push(`${label}: ${what} has ${out[role].length} ${role} attributes, more than the four a key takes`)
    return out
  }

  const fields = [], defined = new Set()
  list(p.AttributeDefinitions, 'AttributeDefinitions').forEach((a, i) => {
    const w = `AttributeDefinitions[${i}]`
    if (!isObj(a) || fnOf(a)) { unread.push(w); say(w, a); return }
    const attr = one(a.AttributeName, `${w}.AttributeName`), type = one(a.AttributeType, `${w}.AttributeType`)
    if (attr === null) { notes.push(`${label}: ${w} names no attribute`); return }
    defined.add(String(attr))
    fields.push({ name: String(attr), type: type === null ? '' : String(type), nullable: true, default: null, generated: null, ...at('AttributeDefinitions', i) })
  })
  const keys = []
  if (simple) {
    const pk = p.PrimaryKey
    if (pk === undefined || pk === null) {
      fields.push({ name: 'id', type: 'S', nullable: false, default: null, generated: null, ...at() })
      keys.push({ role: 'partition', parts: ['id'], ...at() })
      notes.push(`${label}: no PrimaryKey, so SAM's default: id, a string`)
    } else if (isObj(pk) && !fnOf(pk)) {
      const attr = one(pk.Name, 'PrimaryKey.Name'), type = one(pk.Type, 'PrimaryKey.Type')
      const T = { String: 'S', Number: 'N', Binary: 'B' }[type] ?? (type === null ? '' : String(type))
      if (attr !== null) {
        fields.push({ name: String(attr), type: T, nullable: false, default: null, generated: null, ...at('PrimaryKey') })
        keys.push({ role: 'partition', parts: [String(attr)], ...at('PrimaryKey') })
      }
    } else { unread.push('PrimaryKey'); say('PrimaryKey', pk) }
  } else {
    const ks = keySchema(p.KeySchema, 'KeySchema')
    for (const role of ['partition', 'sort']) if (ks[role].length) keys.push({ role, parts: ks[role], ...at('KeySchema', ks.first[role]) })
    const keyed = new Set([...ks.partition, ...ks.sort])
    for (const f of fields) if (keyed.has(f.name)) f.nullable = false
    for (const a of keyed) if (!defined.has(a) && p.AttributeDefinitions !== undefined) notes.push(`${label}: the key ${a} is not in AttributeDefinitions`)
  }

  const ttl = p.TimeToLiveSpecification
  if (ttl !== undefined && ttl !== null) {
    if (!isObj(ttl) || fnOf(ttl)) { unread.push('TimeToLiveSpecification'); say('TimeToLiveSpecification', ttl) }
    else {
      const attr = one(ttl.AttributeName, 'TimeToLiveSpecification.AttributeName')
      const enabled = ttl.Enabled === undefined ? null : flag(ttl.Enabled, 'TimeToLiveSpecification.Enabled')
      if (attr !== null) keys.push({ role: 'ttl', parts: [String(attr)], enabled, ...at('TimeToLiveSpecification') })
      else notes.push(`${label}: TimeToLiveSpecification names no attribute`)
    }
  }

  const indexes = []
  for (const [member, kind] of [['GlobalSecondaryIndexes', 'gsi'], ['LocalSecondaryIndexes', 'lsi']]) {
    list(p[member], member).forEach((x, i) => {
      const w = `${member}[${i}]`
      if (!isObj(x) || fnOf(x)) { unread.push(w); say(w, x); return }
      const iname = one(x.IndexName, `${w}.IndexName`)
      const ks = keySchema(x.KeySchema, `${w}.KeySchema`)
      let projection = null, include = []
      const pr = x.Projection
      if (isObj(pr) && !fnOf(pr)) {
        projection = one(pr.ProjectionType, `${w}.Projection.ProjectionType`)
        if (Array.isArray(pr.NonKeyAttributes)) include = pr.NonKeyAttributes.map((a, j) => String(one(a, `${w}.Projection.NonKeyAttributes[${j}]`)))
        else if (pr.NonKeyAttributes !== undefined && pr.NonKeyAttributes !== null) { unread.push(w); include = [String(one(pr.NonKeyAttributes, `${w}.Projection.NonKeyAttributes`))] }
      } else if (pr !== undefined && pr !== null) { unread.push(w); projection = one(pr, `${w}.Projection`) }
      const nm = iname === null ? w : String(iname)
      if (iname === null) notes.push(`${label}: ${w} has no IndexName`)
      indexes.push({ name: nm, kind, partition: ks.partition, sort: ks.sort, projection: projection === null ? null : String(projection), include, columns: [...ks.partition, ...ks.sort], unique: false, partial: false, ...at(member, i) })
      for (const a of [...ks.partition, ...ks.sort]) if (!defined.has(a) && p.AttributeDefinitions !== undefined) notes.push(`${label}: the ${kind === 'gsi' ? 'global' : 'local'} index ${nm} keys on ${a}, which is not in AttributeDefinitions`)
    })
  }

  // an attribute AttributeDefinitions types and nothing keys (CreateTable takes only key attributes): a lead
  const keying = new Set([...keys.filter((k) => k.role !== 'ttl'), ...indexes].flatMap((x) => x.parts || x.columns))
  if (!unread.length) for (const f of fields) if (!keying.has(f.name)) notes.push(`${label}: ${f.name} is in AttributeDefinitions and keys neither the table nor an index`)

  const ss = p.StreamSpecification
  let stream = null
  if (ss !== undefined && ss !== null) {
    if (!isObj(ss) || fnOf(ss)) { unread.push('StreamSpecification'); stream = one(ss, 'StreamSpecification') }
    else stream = ss.StreamEnabled === false || ss.StreamEnabled === 'false' ? null : one(ss.StreamViewType, 'StreamSpecification.StreamViewType')
  }
  const bs = isObj(p.BillingModeSummary) ? p.BillingModeSummary.BillingMode : undefined
  const billing = p.BillingMode !== undefined && p.BillingMode !== null ? one(p.BillingMode, 'BillingMode')
    : bs !== undefined && bs !== null ? one(bs, 'BillingModeSummary.BillingMode')
      : p.ProvisionedThroughput !== undefined && p.ProvisionedThroughput !== null ? 'PROVISIONED' : simple ? 'PAY_PER_REQUEST' : null

  return {
    entity: { name: String(name), kind: 'table', billing: billing === null ? null : String(billing), stream: stream === null ? null : String(stream), whole: !unread.length, ...extra, ...at(), fields, keys, indexes, relations: [] },
    notes: capNotes(notes),
  }
}
// at most NOTES notes, then how many more: a file cannot flood graph_data with them
export const NOTES = 50
export const capNotes = (notes, max = NOTES) => (notes.length > max ? [...notes.slice(0, max), `… and ${notes.length - max} more notes`] : notes)
