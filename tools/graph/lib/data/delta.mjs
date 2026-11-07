// grimoire graph · data · proposals (spec D5): the delta a design writes beside its spec, what the
// design changes in the data model, and the state of each change against the code. States are
// computed on every read, from the model the index holds (and the branch's base when one resolves),
// never written into the file. The only thing ever written back is an acknowledgement (serve.mjs).
//
// The file: docs/specs/<date>-<topic>.delta.json, 2-space JSON
//   { schema: 1, spec: 'docs/specs/<date>-<topic>-design.md', data: [Change], architecture: [Change] }
//   Change { id, op: add | change | remove | rename, target, before?, after?, why, slice?,
//            origin: planned | unplanned, ack?: { by, at, hash } }
//   `architecture` holds the architecture's changes, in the same shape, its targets naming the
//   elements of the saved diagrams (docs/architecture/*.architecture.json, lib/arch.mjs):
//     component:<id>                      a component            component:search
//     connection:<from>-><to>             a line, by its ends    connection:web->api
//     connection:<from>-><to>#<label>     one of several lines joining the same two components,
//                                         by its label           connection:web->api#HTTPS
//     boundary:<label>                    a boundary             boundary:Backend (deploy)
//   An id holds no `>` and no `#` (arch.mjs ID), so a connection's ends split at its one `>`, and
//   the first `#` after them starts its label. Their `after`, in the diagram's own words: a component
//   { label, type, sublabel?, paths?, imports?, sources?, note?, tag?, repo? } (add: label and
//   type), a connection { label?, variant?, via?, note? }, a boundary { kind?, wraps } (add: wraps);
//   a rename: a component's { id }, a boundary's { label } (a connection has no name: remove it and
//   add the new one). Their states are computed by lib/arch-change.mjs, against the diagrams.
//   Ids are unique across both lists: an acknowledgement names a change by its id alone.
//
// Targets address an element the way diff.mjs identifies it (KEY), so a target resolves exactly
// where the diff matches: names in any letter case where the dialect's are (SQLite), a key by its
// role and columns as a whole, a foreign key by its columns on both sides.
//   <repo>:<store>/<entity>                               a table or view   mobile:drizzle/books
//   <repo>:<store>/<entity>.<field>                       a column (a dotted path when nested)
//   <repo>:<store>/<entity>/index:<name>                  an index
//   <repo>:<store>/<entity>/key:<role>(<col>,…)           a key: primary(id), unique(isbn,title)
//   <repo>:<store>/<entity>/fk:(<col>,…)-><table>(<col>,…)   a foreign key: fk:(author_id)->authors(id)
// <repo>:<store> is the store's id as graph_data names it (its folder in its repository, `.` at the
// root, which may hold `/`); the entity is the segment after the store's last `/`, cut at its first
// `.` for a column. A table whose name holds `/` or `.` cannot be addressed.
// A key-value store's (the repository's `dynamodb`) elements take the same grammar: a table
// `api:dynamodb/loans`, an attribute `…/loans.memberId`, a GSI or an LSI `…/loans/index:ByBook`, a key
// `…/key:partition(memberId)`, `…/key:sort(loanId)` (several attributes: a multi-attribute key) and the
// TTL `…/key:ttl(expiresAt)`; a table's billing and stream are changed on the table itself.
//
// `after` is the intended element in the model's own words:
//   a column      { type, nullable, default?, generated? }      (add: type and nullable)
//   a table       { kind?: table | view, fields: [{ name, type, nullable, default?, generated? }],
//                   keys?: [{ role, parts }], indexes?: [{ name, columns, unique?, partial? }],
//                   relations?: [{ columns, to, toColumns, onDelete?, onUpdate? }],
//                   billing?, stream? (a key-value table's) }
//   an index      { columns, unique?, partial? }                (add: columns)
//                 a GSI or an LSI: { kind: gsi | lsi, partition?, sort?, projection?: ALL | KEYS_ONLY |
//                 INCLUDE, include? }  (add: kind, and a GSI's partition, an LSI's sort)
//   a foreign key { onDelete?, onUpdate? }                      a key: nothing (its target is its shape)
//   a TTL         { enabled }                                   (change: enabled; add: optional)
//   a table's own { kind } | { billing: PAY_PER_REQUEST | PROVISIONED, stream: a view type | null }
//                 (a change)
//   a rename      { name }: the new name (a table, a column or an index; a key has none)
// A key-value element several declarations state (reconcile.mjs `per`) is planned and built only
// when every one of them has it as planned; a difference that only some have names their file.
// `add` describes the whole element: what it states is compared (an index's unique and partial are
// false unless stated; a table's columns, keys, indexes and foreign keys each as a set: one planned
// and not built, or built in another shape, is a difference). What the branch builds on a table it
// adds and the change does not state (a column beyond `fields`, a key, an index, a foreign key) is
// unplanned, a change of its own like the branch's others outside the delta (spec D4: never a
// failure, always reported), unless another change of the delta covers it. `change` states only
// what changes: a column's or an index's attributes, a table's kind, a foreign key's actions.
// `remove` has no `after`. `before` is optional: the element as the design saw it, which decides
// pending from built differently when no base resolves.
//
// The hash of a change: the first 16 hex digits of the SHA-256 of its canonical JSON (object keys
// sorted at every level), without `ack` and without `slice`: editing what changes or why invalidates
// an acknowledgement; reordering keys does not, and neither does to-plan giving the change its slice.
//
// States (deltaStates), per data change:
//   planned-built      the model has the target in the intended shape (a removal: it is gone; a
//                      rename: the new name is there and the old one is not)
//   pending            not in the code yet (a change or a rename the branch has not touched)
//   built-differently  the target is there in another shape (`diffs`, planned → built), or the branch
//                      touched it another way (a change whose target it removed)
//   the acknowledgement, apart: acked (its hash is the change's), stale (edited since), or none
//   unplanned          a change of the branch against its base (diff.mjs) that no change covers,
//                      and what the branch built on a table the delta adds beyond what its `add`
//                      states (a table added whole is one change in the diff: its parts are listed
//                      here one by one, as the diff lists the parts of a table it modifies)
//
// The loop's ship step appends the unplanned changes implementers kept (appendChanges), with
// origin `unplanned` and the implementer's reason as `why`, never acknowledged: the user does that.
import { createHash } from 'node:crypto'
import { normType, normDefault, kvIndex, projectionText, declPath } from './model.mjs'
import { KEY, NAME, foldOf } from './diff.mjs'
import { parseJson } from './readers/json-lines.mjs'
import { TYPES, VARIANTS, BOUNDARY_KINDS, ID } from '../arch.mjs'

export const OPS = ['add', 'change', 'remove', 'rename']
export const ORIGINS = ['planned', 'unplanned']
export const STATE_TEXT = { 'planned-built': 'planned and built', pending: 'pending', 'built-differently': 'built differently' }
export const KIND_WORD = { entity: 'table', field: 'column', key: 'key', index: 'index', relation: 'foreign key' }
const LIST = { field: 'fields', key: 'keys', index: 'indexes', relation: 'relations' }
const ROLES = ['primary', 'unique', 'partition', 'sort', 'ttl']
const KEYS = ['id', 'op', 'target', 'before', 'after', 'why', 'slice', 'origin', 'ack']
const TOP = ['schema', 'spec', 'data', 'architecture']

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const str = (x) => typeof x === 'string' && x.trim() !== ''
const q = (x) => { const s = JSON.stringify(x) ?? String(x); return s.length > 80 ? `${s.slice(0, 79)}…` : s } // a value echoed in a problem: escaped, cut short

// ── the hash ──
export function canonical(x) {
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`
  if (isObj(x)) return `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`
  return JSON.stringify(x)
}
export function changeHash(c) {
  const { ack, slice, ...rest } = c
  return createHash('sha256').update(canonical(rest), 'utf8').digest('hex').slice(0, 16)
}

// ── targets ──
const cols = (s) => s.split(',').map((x) => x.trim())
// → { repo, store, storeId, entity, kind, el } (el: the element's identity, as KEY reads it) | { error }
export function parseTarget(t) {
  if (typeof t !== 'string' || !t.trim()) return { error: 'a target is a non-empty string' }
  const colon = t.indexOf(':')
  if (colon <= 0) return { error: `${q(t)} names no repository: <repo>:<store>/<entity>` }
  const repo = t.slice(0, colon), rest = t.slice(colon + 1)
  const m = /\/(index|key|fk):/.exec(rest)
  const head = m ? rest.slice(0, m.index) : rest, spec = m ? rest.slice(m.index + m[0].length) : null
  const slash = head.lastIndexOf('/')
  if (slash <= 0 || slash === head.length - 1) return { error: `${q(t)} names no store and entity: <repo>:<store>/<entity>` }
  const store = head.slice(0, slash), tail = head.slice(slash + 1)
  const base = { repo, store, storeId: `${repo}:${store}` }
  if (!m) {
    const dot = tail.indexOf('.')
    if (dot < 0) return { ...base, entity: tail, kind: 'entity', el: { name: tail } }
    const entity = tail.slice(0, dot), name = tail.slice(dot + 1)
    if (!entity || !name || name.endsWith('.')) return { error: `${q(t)}: a column is <entity>.<column>` }
    return { ...base, entity, kind: 'field', el: { name } }
  }
  if (tail.includes('.')) return { error: `${q(t)}: an ${m[1]} belongs to a table, not a column (<store>/<entity>/${m[1]}:…)` }
  const entity = tail
  if (m[1] === 'index') return spec.trim() ? { ...base, entity, kind: 'index', el: { name: spec } } : { error: `${q(t)}: index:<name>` }
  if (m[1] === 'key') {
    const k = /^([a-z]+)\(([^()]+)\)$/.exec(spec)
    if (!k || !ROLES.includes(k[1])) return { error: `${q(t)}: key:<role>(<col>,…), the role one of ${ROLES.join(', ')}` }
    return { ...base, entity, kind: 'key', el: { role: k[1], parts: cols(k[2]) } }
  }
  const f = /^\(([^()]+)\)->([^()]+)\(([^()]+)\)$/.exec(spec)
  if (!f) return { error: `${q(t)}: fk:(<col>,…)-><table>(<col>,…)` }
  return { ...base, entity, kind: 'relation', el: { columns: cols(f[1]), to: f[2].trim(), toColumns: cols(f[3]) } }
}
// The target naming a model element (the inverse of parseTarget).
export function targetOf(storeId, entity, kind, el) {
  const at = `${storeId}/${entity}`
  if (kind === 'entity') return at
  if (kind === 'field') return `${at}.${el.name}`
  if (kind === 'index') return `${at}/index:${el.name}`
  if (kind === 'key') return `${at}/key:${el.role}(${el.parts.join(',')})`
  return `${at}/fk:(${el.columns.join(',')})->${el.to}(${el.toColumns.join(',')})`
}
// A target with the element renamed (a rename's new name).
const renamed = (t, name) => (t.kind === 'entity' ? { ...t, entity: name, el: { name } } : { ...t, el: { ...t.el, name } })

// ── architecture targets (the header above) ──
export const ARCH_KINDS = ['component', 'connection', 'boundary']
// A target the architecture's: what the loop's ship step routes to `architecture` (appendChanges).
export const isArchTarget = (t) => typeof t === 'string' && /^(component|connection|boundary):/.test(t)
// → { kind: 'component', id } | { kind: 'connection', from, to, label: string | null } |
//   { kind: 'boundary', label } | { error }
export function parseArchTarget(t) {
  if (typeof t !== 'string' || !t.trim()) return { error: 'a target is a non-empty string' }
  const m = /^(component|connection|boundary):(.*)$/s.exec(t)
  if (!m) return { error: `${q(t)} is no architecture target: component:<id>, connection:<from>-><to> or boundary:<label>` }
  const [, kind, rest] = m
  if (kind === 'component') return ID.test(rest) ? { kind, id: rest } : { error: `${q(t)}: a component's id is lower case, digits, . _ - (64 at most)` }
  if (kind === 'boundary') return rest.trim() ? { kind, label: rest } : { error: `${q(t)}: boundary:<label>` }
  const hash = rest.indexOf('#'), ends = hash < 0 ? rest : rest.slice(0, hash), label = hash < 0 ? null : rest.slice(hash + 1)
  const gt = ends.indexOf('>')
  const from = gt > 0 && ends[gt - 1] === '-' ? ends.slice(0, gt - 1) : null, to = gt > 0 ? ends.slice(gt + 1) : null
  if (!from || !to || !ID.test(from) || !ID.test(to)) return { error: `${q(t)}: connection:<from>-><to>, each a component's id (#<label> after them for one of several lines)` }
  if (from === to) return { error: `${q(t)}: a component does not connect to itself` }
  if (label !== null && !label.trim()) return { error: `${q(t)}: #<label> names the line's label` }
  return { kind, from, to, label }
}
// The target naming an element of a diagram (the inverse of parseArchTarget).
export function archTargetOf(kind, el, label = null) {
  if (kind === 'component') return `component:${el.id}`
  if (kind === 'boundary') return `boundary:${el.label}`
  return `connection:${el.from}->${el.to}${label !== null && label !== undefined ? `#${label}` : ''}`
}

// ── validation ──
// → { delta, errors: [string] }: the JSON parsed and checked
export function parseDelta(text) {
  let doc
  try { doc = parseJson(text) } catch (e) { return { delta: null, errors: [`not JSON: ${e.message.replace(/^not valid JSON ?/, '').replace(/^at /, 'it breaks at ') || 'it does not parse'}`] } }
  const errors = validateDelta(doc)
  return { delta: errors.length ? null : doc, errors }
}
export function validateDelta(doc) {
  if (!isObj(doc)) return ['a delta is a JSON object: { "schema": 1, "spec": …, "data": [], "architecture": [] }']
  const errors = []
  for (const k of Object.keys(doc)) if (!TOP.includes(k)) errors.push(`unknown key ${q(k)} (a delta has ${TOP.join(', ')})`)
  if (doc.schema !== 1) errors.push(`schema ${q(doc.schema)} is not one this grimoire reads (schema 1)`)
  if (!str(doc.spec)) errors.push('spec: the design this delta belongs to (docs/specs/<date>-<topic>-design.md)')
  if (!Array.isArray(doc.data)) errors.push('data: an array of changes to the data model ([] when none)')
  if (!Array.isArray(doc.architecture)) errors.push('architecture: an array of changes to the architecture ([] when none)')
  const seen = new Map()
  for (const list of ['data', 'architecture']) {
    ;(Array.isArray(doc[list]) ? doc[list] : []).forEach((c, i) => {
      const at = `${list}[${i}]${isObj(c) && str(c.id) ? ` (${c.id})` : ''}`
      for (const e of (list === 'data' ? changeErrors : archChangeErrors)(c)) errors.push(`${at}: ${e}`)
      if (isObj(c) && str(c.id)) { if (seen.has(c.id)) errors.push(`${at}: the id ${q(c.id)} is ${seen.get(c.id)}'s too: ids are unique`); else seen.set(c.id, `${list}[${i}]`) }
    })
  }
  return errors
}
// What every change states, whatever it targets: [errors] (the target and `after` apart).
function commonErrors(c) {
  const out = []
  for (const k of Object.keys(c)) if (!KEYS.includes(k)) out.push(`unknown key ${q(k)} (a change has ${KEYS.join(', ')})`)
  if (!str(c.id)) out.push('id: a non-empty string, unique in the file')
  if (!OPS.includes(c.op)) out.push(`op ${q(c.op)} is not one of ${OPS.join(', ')}`)
  return out
}
function tailErrors(c) {
  const out = []
  if (!str(c.why)) out.push('why: say why it changes')
  if (!ORIGINS.includes(c.origin)) out.push(`origin ${q(c.origin)} is not one of ${ORIGINS.join(', ')}`)
  if (c.slice !== undefined && !(Number.isInteger(c.slice) && c.slice > 0) && !str(c.slice)) out.push('slice: the plan slice that builds it, a number or a name')
  if (c.before !== undefined && !isObj(c.before)) out.push('before: an object, the element as the design saw it')
  if (c.ack !== undefined && !(isObj(c.ack) && str(c.ack.by) && str(c.ack.at) && str(c.ack.hash) && Object.keys(c.ack).every((k) => ['by', 'at', 'hash'].includes(k)))) out.push('ack: { by, at, hash }, written when the change is acknowledged')
  return out
}
function changeErrors(c) {
  if (!isObj(c)) return ['a change is an object { id, op, target, why, origin, … }']
  const out = commonErrors(c)
  const t = parseTarget(c.target)
  if (t.error) out.push(`target: ${t.error}`)
  out.push(...tailErrors(c))
  if (!t.error && OPS.includes(c.op)) out.push(...afterErrors(t, c.op, c.after))
  return out
}
export function archChangeErrors(c) {
  if (!isObj(c)) return ['a change is an object { id, op, target, why, origin, … }']
  const out = commonErrors(c)
  const t = parseArchTarget(c.target)
  if (t.error) out.push(`target: ${t.error}`)
  out.push(...tailErrors(c))
  if (!t.error && OPS.includes(c.op)) out.push(...archAfterErrors(t.kind, c.op, c.after))
  return out
}
// an architecture change's `after`, in the diagram's words (arch.mjs validate)
const strs = (v) => Array.isArray(v) && v.every(str)
const COMPONENT = { label: str, sublabel: (v) => typeof v === 'string', type: (v) => TYPES.includes(v), paths: strs, imports: strs, sources: strs, note: (v) => typeof v === 'string', tag: (v) => typeof v === 'string', repo: str }
const CONNECTION = { label: (v) => typeof v === 'string', variant: (v) => VARIANTS.includes(v), via: (v) => typeof v === 'string', note: (v) => typeof v === 'string' }
const BOUNDARY = { kind: (v) => BOUNDARY_KINDS.includes(v), wraps: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && ID.test(x)) }
function archAfterErrors(kind, op, after) {
  if (op === 'remove') return after === undefined ? [] : ['a removal has no after']
  if (op === 'rename') {
    if (kind === 'connection') return ['a connection has no name to rename: remove it and add the new one']
    const key = kind === 'component' ? 'id' : 'label'
    const okName = kind === 'component' ? (v) => typeof v === 'string' && ID.test(v) : str
    return isObj(after) && okName(after[key]) && Object.keys(after).length === 1 ? [] : [`after: { ${key} }, the new ${key === 'id' ? 'id' : 'label'}`]
  }
  const [what, allowed, need] = kind === 'component' ? ['a component', COMPONENT, ['label', 'type']] : kind === 'connection' ? ['a connection', CONNECTION, []] : ['a boundary', BOUNDARY, ['wraps']]
  if (kind === 'connection' && op === 'add' && after === undefined) return []
  if (after === undefined) return [`${op === 'add' ? 'an addition' : 'a change'} needs after: the ${kind} ${op === 'add' ? 'it adds' : 'as it becomes'}`]
  if (op === 'change' && isObj(after) && !Object.keys(after).length) return [`after: what changes (${Object.keys(allowed).join(', ')})`]
  return attrs(what, after, allowed, op === 'add' ? need : [])
}
const FIELD = { type: (v) => str(v), nullable: (v) => typeof v === 'boolean', default: (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v), generated: (v) => v === null || v === 'virtual' || v === 'stored' }
const attrList = (v) => Array.isArray(v) && v.length > 0 && v.every(str)
// an index: a SQL one's columns, or a key-value one's (a GSI's or an LSI's) keys and projection
const INDEX = { columns: attrList, unique: (v) => typeof v === 'boolean', partial: (v) => typeof v === 'boolean',
  kind: (v) => v === 'gsi' || v === 'lsi', partition: (v) => attrList(v) && v.length <= 4, sort: (v) => Array.isArray(v) && v.length <= 4 && v.every(str), projection: (v) => PROJECTIONS.includes(v), include: (v) => Array.isArray(v) && v.every(str) }
export const PROJECTIONS = ['ALL', 'KEYS_ONLY', 'INCLUDE']
export const BILLING = ['PAY_PER_REQUEST', 'PROVISIONED']
export const STREAMS = ['NEW_IMAGE', 'OLD_IMAGE', 'NEW_AND_OLD_IMAGES', 'KEYS_ONLY']
const KV_INDEX = ['kind', 'partition', 'sort', 'projection', 'include']
const kvAfter = (a) => isObj(a) && KV_INDEX.some((k) => k in a)
const indexWord = (a) => (a?.kind === 'gsi' ? 'a GSI' : a?.kind === 'lsi' ? 'an LSI' : 'an index')
// what an index's addition must state: its columns, or a key-value index's kind and its key (a GSI's
// partition, an LSI's sort: the table's partition is its own)
const indexNeed = (a) => (kvAfter(a) ? ['kind', a.kind === 'lsi' ? 'sort' : 'partition'] : ['columns'])
// a table's own attributes: its kind; a key-value table's billing and stream (null: none)
const TABLE_OWN = { kind: (v) => v === 'table' || v === 'view', billing: (v) => BILLING.includes(v), stream: (v) => v === null || STREAMS.includes(v) }
const TTL = { enabled: (v) => typeof v === 'boolean' }
const ACTIONS = { onDelete: (v) => str(v), onUpdate: (v) => str(v) }
// the attributes an object states, each checked: [errors]
function attrs(what, o, allowed, need = []) {
  if (!isObj(o)) return [`after: ${what}, an object { ${Object.keys(allowed).join(', ')} }`]
  const out = []
  for (const k of Object.keys(o)) if (!allowed[k]) out.push(`after: ${q(k)} is not an attribute of ${what} (${Object.keys(allowed).join(', ')})`)
    else if (!allowed[k](o[k])) out.push(`after: ${what}'s ${k} ${q(o[k])} is not valid`)
  for (const k of need) if (!(k in o)) out.push(`after: ${what} needs its ${k}`)
  return out
}
function afterErrors(t, op, after) {
  const kind = t.kind, word = KIND_WORD[kind]
  if (op === 'remove') return after === undefined ? [] : ['a removal has no after']
  if (op === 'rename') {
    if (kind === 'key' || kind === 'relation') return [`a ${word} has no name to rename: remove it and add the new one`]
    return isObj(after) && str(after.name) && Object.keys(after).length === 1 ? [] : ['after: { name }, the new name']
  }
  // a TTL is a key with one thing to say: whether it is enabled
  if (kind === 'key' && t.el.role === 'ttl') return op === 'change' ? (isObj(after) && Object.keys(after).length ? attrs('a TTL', after, TTL) : ['after: a TTL changes whether it is enabled ({ enabled })']) : after === undefined ? [] : attrs('a TTL', after, TTL)
  if (kind === 'key') return op === 'change' ? ['a key has nothing to change: its columns are what it is (remove it and add the new one)'] : after === undefined || (isObj(after) && !Object.keys(after).length) ? [] : ['after: a key states nothing (its target is its shape)']
  if (kind === 'relation') return after === undefined && op === 'add' ? [] : op === 'change' && isObj(after) && !Object.keys(after).length ? ['after: what changes (onDelete, onUpdate)'] : attrs('a foreign key', after, ACTIONS)
  if (after === undefined) return [`${op === 'add' ? 'an addition' : 'a change'} needs after: the ${word} ${op === 'add' ? 'it adds' : 'as it becomes'}`]
  if (kind === 'field') return op === 'add' ? attrs('a column', after, FIELD, ['type', 'nullable']) : isObj(after) && !Object.keys(after).length ? ['after: what changes (type, nullable, default, generated)'] : attrs('a column', after, FIELD)
  if (kind === 'index') return op === 'add' ? attrs(indexWord(after), after, INDEX, indexNeed(after)) : isObj(after) && !Object.keys(after).length ? ['after: what changes (columns, unique, partial; a GSI\'s or an LSI\'s partition, sort, projection, include)'] : attrs(indexWord(after), after, INDEX)
  // a table
  if (op === 'change') return isObj(after) && Object.keys(after).length ? attrs('a table', after, TABLE_OWN).map((e) => (/is not an attribute/.test(e) ? `${e}: its columns, keys and indexes are changed through their own targets` : e)) : ['after: a table changes its kind ({ kind: table | view }), a key-value table its billing or stream, here; its columns, keys and indexes are changed through their own targets']
  const TABLE = { ...TABLE_OWN, fields: (v) => Array.isArray(v) && v.length > 0, keys: Array.isArray, indexes: Array.isArray, relations: Array.isArray }
  const out = attrs('a table', after, TABLE, ['fields'])
  if (out.length) return out
  after.fields.forEach((f, i) => { const e = isObj(f) && str(f.name) ? attrs(`column ${f.name}`, (({ name, ...x }) => x)(f), FIELD, ['type', 'nullable']) : [`after: fields[${i}] needs its name`]; out.push(...e) })
  ;(after.keys || []).forEach((k, i) => { if (!(isObj(k) && ROLES.includes(k.role) && Array.isArray(k.parts) && k.parts.length && k.parts.every(str) && Object.keys(k).every((x) => x === 'role' || x === 'parts' || (x === 'enabled' && k.role === 'ttl' && TTL.enabled(k.enabled))))) out.push(`after: keys[${i}] is { role, parts } (a TTL's enabled beside them)`) })
  ;(after.indexes || []).forEach((x, i) => { out.push(...(isObj(x) && str(x.name) ? (({ name, ...y }) => attrs(`index ${x.name}`, y, INDEX, indexNeed(y)))(x) : [`after: indexes[${i}] needs its name`])) })
  ;(after.relations || []).forEach((r, i) => { if (!(isObj(r) && INDEX.columns(r.columns) && str(r.to) && INDEX.columns(r.toColumns))) out.push(`after: relations[${i}] is { columns, to, toColumns, onDelete?, onUpdate? }`) })
  return out
}

// ── against the model ──
// A target in a reconciled model: { st, e, el, fold }, each null where it is missing.
export function findTarget(model, t) {
  const stores = t.error ? [] : model?.stores || []
  const st = stores.find((s) => s.id === t.storeId) || stores.find((s) => s.id.toLowerCase() === t.storeId.toLowerCase()) || null
  if (!st) return { st: null, e: null, el: null, fold: foldOf(null) }
  const fold = foldOf(st.dialect)
  const e = st.entities.find((x) => fold(x.name) === fold(t.entity)) || null
  if (!e || t.kind === 'entity') return { st, e, el: e, fold }
  const k = KEY[t.kind](t.el, fold)
  return { st, e, el: e[LIST[t.kind]].find((x) => KEY[t.kind](x, fold) === k) || null, fold }
}

// How a value reads (as graph_changes and the page say it).
export const say = (attr, v) => (attr.endsWith('nullable') ? (v ? 'nullable' : 'not null') : attr.endsWith('unique') ? (v ? 'unique' : 'not unique') : attr.endsWith('partial') ? (v ? 'partial' : 'whole') : attr.endsWith('enabled') ? (v === true ? 'on' : v === false ? 'off' : 'not said') : v === null || v === undefined || v === '' ? 'none' : String(v))
const d = (attr, planned, built) => ({ attr, planned, built, text: `${attr}: ${say(attr, planned)} → ${say(attr, built)}` })
const typeOf = (x) => x.type?.raw ?? x.type
const fieldText = (f) => `${typeOf(f)}, ${f.nullable ? 'nullable' : 'not null'}${f.default !== null && f.default !== undefined ? `, default ${f.default}` : ''}`
const lower = (v) => (v === null || v === undefined ? v : String(v).trim().toLowerCase())

// What differs between what `after` states and an element of the model: [{ attr, planned, built, text }].
// `whole`: an addition (the whole element), else a change (only what it states). A table's parts
// built and not stated are not differences: they are unplanned (extrasOf).
function shapeDiffs(kind, after, el, fold, whole, pre = '') {
  const out = []
  if (kind === 'field') {
    if ('type' in after && normType(after.type) !== normType(typeOf(el))) out.push(d(`${pre}type`, after.type, typeOf(el)))
    if ('nullable' in after && after.nullable !== el.nullable) out.push(d(`${pre}nullable`, after.nullable, el.nullable))
    if ('default' in after && normDefault(after.default === null ? null : String(after.default)) !== normDefault(el.default)) out.push(d(`${pre}default`, after.default, el.default ?? null))
    if ('generated' in after && (after.generated ?? null) !== (el.generated ?? null)) out.push(d(`${pre}generated`, after.generated, el.generated ?? null))
  } else if (kind === 'index' && (kvIndex(el) || kvAfter(after))) {
    // a GSI or an LSI: what it states of its kind, keys and projection (no sort key unless stated)
    if ('kind' in after && after.kind !== el.kind) out.push(d(`${pre}kind`, after.kind, el.kind ?? null))
    for (const a of ['partition', 'sort']) if ((a in after || (whole && a === 'sort')) && (after[a] || []).join(',') !== (el[a] || []).join(',')) out.push(d(`${pre}${a}`, (after[a] || []).join(', '), (el[a] || []).join(', ')))
    if ('columns' in after && after.columns.join(',') !== el.columns.join(',')) out.push(d(`${pre}columns`, after.columns.join(', '), el.columns.join(', ')))
    if ('projection' in after || 'include' in after) {
      const planned = projectionText({ projection: after.projection ?? el.projection, include: after.include ?? el.include }), built = projectionText(el)
      if (planned !== built) out.push(d(`${pre}projection`, planned, built))
    }
  } else if (kind === 'index') {
    if ('columns' in after && after.columns.map(fold).join(',') !== el.columns.map(fold).join(',')) out.push(d(`${pre}columns`, after.columns.join(', '), el.columns.join(', ')))
    for (const a of ['unique', 'partial']) if ((a in after || whole) && !!after[a] !== !!el[a]) out.push(d(`${pre}${a}`, !!after[a], !!el[a]))
  } else if (kind === 'key') {
    if ('enabled' in after && (after.enabled ?? null) !== (el.enabled ?? null)) out.push(d(`${pre}enabled`, after.enabled, el.enabled ?? null))
  } else if (kind === 'relation') {
    for (const [a, w] of [['onDelete', 'on delete'], ['onUpdate', 'on update']]) if (a in after && lower(after[a]) !== lower(el[a])) out.push(d(`${pre}${w}`, after[a], el[a]))
  } else if (kind === 'entity') {
    if (('kind' in after || whole) && (after.kind || 'table') !== el.kind) out.push(d('kind', after.kind || 'table', el.kind))
    for (const a of ['billing', 'stream']) if (a in after && (after[a] ?? null) !== (el[a] ?? null)) out.push(d(a, after[a], el[a] ?? null))
    for (const f of after.fields || []) {
      const b = el.fields.find((x) => fold(x.name) === fold(f.name))
      if (!b) out.push(d(`column ${f.name}`, fieldText(f), 'absent'))
      else out.push(...shapeDiffs('field', f, b, fold, true, `column ${f.name} `))
    }
    for (const [k, list, label] of [['key', 'keys', (x) => `${x.role} key (${x.parts.join(', ')})`], ['index', 'indexes', (x) => `index ${x.name}`], ['relation', 'relations', (x) => `foreign key (${x.columns.join(', ')}) → ${x.to}`]]) {
      const id = (x) => KEY[k](x, fold), built = new Map(el[list].map((x) => [id(x), x]))
      for (const p of after[list] || []) {
        const b = built.get(id(p))
        if (!b) out.push(d(label(p), 'planned', 'absent'))
        else out.push(...shapeDiffs(k, (({ name, columns, to, toColumns, role, parts, ...x }) => (k === 'index' && columns !== undefined ? { columns, ...x } : x))(p), b, fold, true, `${label(p)} `))
      }
    }
  }
  return out
}
// A key-value element as each of its declarations states it (reconcile.mjs `per`): [[file, element]],
// or null when one declaration states it (the element is then as it is).
function views(kind, el) {
  if (!el || !el.per || el.per.length < 2) return null
  const of = (a) => {
    if (kind === 'entity') return { ...el, kind: a.kind ?? el.kind, billing: a.billing ?? null, stream: a.stream ?? null }
    if (kind === 'key') return 'enabled' in a ? { ...el, enabled: a.enabled } : el
    if (kind === 'field') return { ...el, type: a.type, nullable: a.nullable }
    if (kind === 'index' && kvIndex(el)) {
      const m = /^INCLUDE \((.*)\)$/.exec(a.projection || '')
      return { ...el, kind: a.kind, partition: a.partition ? a.partition.split(', ') : [], sort: a.sort ? a.sort.split(', ') : [], projection: m ? 'INCLUDE' : a.projection ?? null, include: m ? m[1].split(', ') : [] }
    }
    return el
  }
  return el.per.map(([k, a]) => [declPath(k), of(a)])
}
// A difference in words, naming the declaration it is in when there is one (`at` shows a file as
// its caller cites paths: graph_changes and the page prefix the repository's folder).
export const diffText = (x, at = (p) => p) => (x.in ? `${x.text} in ${at(x.in)}` : x.text)
// shapeDiffs against every declaration of a key-value element: built only when each has it; where
// they differ among themselves, each difference names its declaration's file (`in`).
function diffsPer(kind, after, el, fold, whole) {
  const vs = views(kind, el)
  if (!vs) return shapeDiffs(kind, after, el, fold, whole)
  const each = vs.map(([p, v]) => [p, shapeDiffs(kind, after, v, fold, whole)])
  if (new Set(each.map(([, ds]) => JSON.stringify(ds.map((x) => x.text)))).size === 1) return each[0][1]
  return each.flatMap(([p, ds]) => ds.map((x) => ({ ...x, in: p })))
}
// The parts of a built table its `add` does not state: [{ kind, el, pos }] (pos: its index in its list).
export function extrasOf(after, el, fold) {
  const out = []
  for (const [kind, list] of Object.entries(LIST)) {
    const stated = new Set((after?.[list] || []).map((x) => KEY[kind](x, fold)))
    el[list].forEach((x, pos) => { if (!stated.has(KEY[kind](x, fold))) out.push({ kind, el: x, pos }) })
  }
  return out
}

// Each data change's state against the current model, and the branch's changes no change covers.
//   deltaStates(delta, model, { base, diff }) → { changes: [Result], unplanned: [Unplanned], counts }
//   base: the base's model, diff: diffModels(base, model), both null when no base resolved
//   Result     { i, change, id, hash, t (the target parsed), state, ack: acked | stale | null, diffs:
//                [{ attr, planned, built, text }] (built differently: planned → built), proposed: same
//                shape (pending: now → planned), warn, st, e, el: the store, entity and element as
//                drawn (a rename's new one once built), touched: the branch changed it }
//   Unplanned  { st: the diff's store, c: its change, target, on?: the id of the change that adds its
//                table, when it is a part built on that table beyond what the change states }
export function deltaStates(delta, model, { base = null, diff = null } = {}) {
  const touched = new Set()
  const key = (storeId, kind, entity, k, fold) => `${storeId}\0${kind}\0${fold(entity)}\0${k}`
  for (const sd of diff?.stores || []) { const fold = foldOf(sd.dialect); for (const c of sd.changes) touched.add(key(sd.id, c.kind, c.entity, c.key, fold)) }
  const keyOfT = (r, t) => { const fold = r.st ? foldOf(r.st.dialect) : foldOf(null); return key(r.st ? r.st.id : t.storeId, t.kind, t.entity, KEY[t.kind](t.el, fold), fold) }
  // the tables the delta itself adds: a column or an index for one of them is no stray target
  const adds = new Set((delta.data || []).filter((c) => c.op === 'add').map((c) => parseTarget(c.target)).filter((t) => t.kind === 'entity').map((t) => `${t.storeId}\0${t.entity.toLowerCase()}`))
  const changes = (delta.data || []).map((c, i) => {
    const hash = changeHash(c)
    const t = parseTarget(c.target)
    const cur = findTarget(model, t), was = base ? findTarget(base, t) : null
    const out = { i, change: c, id: c.id, hash, t, state: 'pending', ack: c.ack ? (c.ack.hash === hash ? 'acked' : 'stale') : null, diffs: [], proposed: [], warn: null, st: cur.st, e: cur.e, el: cur.el, touched: false, keys: [keyOfT(cur, t)] }
    const branchTouched = (k) => touched.has(k)
    if (!cur.st && !(was && was.st)) out.warn = 'the store is not in the model'
    else if (t.kind !== 'entity' && !cur.e && !(c.op === 'remove' && was && was.e) && !(c.op === 'add' && adds.has(`${t.storeId}\0${t.entity.toLowerCase()}`))) out.warn = `the table ${t.entity} is not in the model`
    if (c.op === 'add') {
      if (cur.el) { out.diffs = diffsPer(t.kind, c.after || {}, cur.el, cur.fold, true); out.state = out.diffs.length ? 'built-differently' : 'planned-built' }
    } else if (c.op === 'remove') {
      if (!cur.el) { out.state = 'planned-built'; if (!out.warn && !(was && was.el) && base) out.warn = 'not in the model, nor at the base: check the target' }
    } else if (c.op === 'change') {
      if (!cur.el) {
        if (was && was.el) { out.state = 'built-differently'; out.diffs = [d(KIND_WORD[t.kind], 'changed', 'absent')] } else if (!out.warn) out.warn = 'not in the model: check the target'
      } else {
        const diffs = diffsPer(t.kind, c.after, cur.el, cur.fold, false)
        out.touched = branchTouched(out.keys[0])
        if (!diffs.length) out.state = 'planned-built'
        else if (diff ? out.touched : c.before ? diffsPer(t.kind, c.before, cur.el, cur.fold, false).length > 0 : false) { out.state = 'built-differently'; out.diffs = diffs }
        else out.proposed = diffs.map((x) => ({ ...x, text: `${x.attr}: ${say(x.attr, x.built)} → ${say(x.attr, x.planned)}` }))
      }
    } else {
      const nt = renamed(t, c.after.name), now = findTarget(model, nt)
      out.keys.push(keyOfT(now, nt))
      const old = `${KIND_WORD[t.kind]} ${t.kind === 'entity' ? t.entity : t.el.name}`, neu = c.after.name
      if (now.el && !cur.el) Object.assign(out, { state: 'planned-built', el: now.el, e: now.e, st: now.st })
      else if (cur.el && now.el) { out.state = 'built-differently'; out.diffs = [{ attr: 'rename', planned: neu, built: 'both', text: `both ${old} and ${neu} are in the model` }] }
      else if (!cur.el && !now.el) {
        if (was && was.el) { out.state = 'built-differently'; out.diffs = [{ attr: 'rename', planned: neu, built: 'absent', text: `${old} is gone, and ${neu} is not in the model` }] } else if (!out.warn) out.warn = 'neither name is in the model: check the target'
      } else out.proposed = [{ attr: 'rename', planned: neu, built: null, text: `rename to ${neu}` }]
    }
    return out
  })
  const covered = new Set(changes.flatMap((r) => r.keys))
  const unplanned = []
  for (const sd of diff?.stores || []) {
    const fold = foldOf(sd.dialect)
    for (const c of sd.changes) {
      if (!covered.has(key(sd.id, c.kind, c.entity, c.key, fold))) { unplanned.push({ st: sd, c, target: targetOf(sd.id, c.entity, c.kind, c.after || c.before) }); continue }
      // a table the branch adds and a change of the delta adds: what it built there beyond that change
      const r = c.kind === 'entity' && c.change === 'added' ? changes.find((x) => x.change.op === 'add' && x.t.kind === 'entity' && x.el && x.st?.id === sd.id && fold(x.el.name) === fold(c.after.name)) : null
      if (!r) continue
      for (const x of extrasOf(r.change.after, c.after, fold)) {
        const k = KEY[x.kind](x.el, fold)
        if (covered.has(key(sd.id, x.kind, c.entity, k, fold))) continue
        const part = { kind: x.kind, change: 'added', entity: c.entity, name: NAME[x.kind](x.el), key: k, pos: { before: null, after: x.pos }, owner: { before: null, after: c.pos.after }, before: null, after: x.el, attrs: [], rename: null }
        unplanned.push({ st: sd, c: part, target: targetOf(sd.id, c.entity, x.kind, x.el), on: r.id })
      }
    }
  }
  const n = (f) => changes.filter(f).length
  return { changes, unplanned, counts: { changes: changes.length, 'planned-built': n((r) => r.state === 'planned-built'), pending: n((r) => r.state === 'pending'), 'built-differently': n((r) => r.state === 'built-differently'), acked: n((r) => r.ack === 'acked'), stale: n((r) => r.ack === 'stale'), unacked: n((r) => !r.ack), unplanned: unplanned.length } }
}
// A change in words: `add mobile:drizzle/books.isbn`, `rename mobile:drizzle/tags → labels`.
export const changeText = (c) => `${c.op} ${c.target}${c.op === 'rename' && c.after ? ` → ${c.after.name}` : ''}`

// ── acknowledging: the file edited in place ──
// The acknowledgements set (an object) or removed (null) by change index in `list` (`data`, or
// `architecture`), written into the text itself: only the edited `ack` members move, every other
// byte stays as it was (the file's indentation, line ends, final newline, key order and the other
// changes). Checked by parsing the result; a file whose layout defeats the edit (a key written twice)
// is written whole instead, after the same check, in its own indentation unit (2 spaces when it has
// none). Acknowledgements in both lists: one call per list, the second on the first's text.
export function setAcks(text, edits, list = 'data') {
  const doc = JSON.parse(text)
  for (const [i, ack] of edits) { if (ack) doc[list][i].ack = ack; else delete doc[list][i].ack }
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const unit = (/\n([ \t]+)"/.exec(text) || [, '  '])[1]
  const want = JSON.stringify(doc)
  try {
    const root = spans(text)
    const data = [...root.members].reverse().find((m) => m.key === list).node
    const ops = []
    for (const [i, ack] of edits) {
      const obj = data.items[i]
      const multi = text.slice(obj.start, obj.end).includes('\n')
      const at = [...obj.members].reverse().find((m) => m.key === 'ack') || null
      const last = obj.members[obj.members.length - 1]
      const indent = (m) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', m.kstart) + 1, m.kstart))[0] // its line's leading blanks, whatever shares the line
      const fmt = (ind) => (multi ? JSON.stringify(ack, null, unit).split('\n').join(nl + ind) : JSON.stringify(ack, null, 1).replace(/\n\s*/g, ' '))
      if (ack && at) ops.push({ from: at.node.start, to: at.node.end, put: fmt(indent(at)) })
      else if (ack) ops.push({ from: last.node.end, to: last.node.end, put: multi ? `,${nl}${indent(last)}"ack": ${fmt(indent(last))}` : `, "ack": ${fmt('')}` })
      else if (at) {
        const k = obj.members.indexOf(at)
        if (k > 0) ops.push({ from: obj.members[k - 1].node.end, to: at.node.end, put: '' })
        else ops.push({ from: at.kstart, to: obj.members[1].kstart, put: '' })
      }
    }
    let out = text
    for (const o of ops.sort((a, b) => b.from - a.from)) out = out.slice(0, o.from) + o.put + out.slice(o.to)
    if (JSON.stringify(JSON.parse(out)) === want) return out
  } catch {}
  return (JSON.stringify(doc, null, unit) + (/\r?\n$/.test(text) ? '\n' : '')).split('\n').join(nl)
}

// ── appending: the unplanned changes an implementer kept (the loop's ship step, spec D4) ──
// appendChanges(text, entries) → { text, added: [id], already: [id], refused: [{ id, errors }], errors }
//   entries: changes { id, op, target, before?, after?, why, slice?, origin: 'unplanned' }, never
//   acknowledged (the user does that). One whose id the file holds already is left out (a ship sent
//   again writes nothing twice); one that would not validate is refused with its problems, and the
//   others still go in. `errors`: the file itself does not validate (nothing is written, text null).
//   An entry whose target is the architecture's (component:, connection:, boundary:, isArchTarget)
//   goes to `architecture`, checked as one; the others to `data`. A repository named component,
//   connection or boundary is therefore never the target of an appended data change.
//   `text` is the file with the added changes after the last one of their list, every other byte
//   kept: one per line when its changes are written on one line each, else spread in its own
//   indentation. A layout the edit cannot handle is written whole, after the same check (setAcks'
//   fallback).
export function appendChanges(text, entries) {
  const { errors } = parseDelta(text)
  if (errors.length) return { text: null, added: [], already: [], refused: [], errors }
  const doc = JSON.parse(text)
  const have = new Set([...doc.data, ...doc.architecture].map((c) => c.id))
  const added = [], already = [], refused = []
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isObj(e) || !str(e.id)) { refused.push({ id: isObj(e) && typeof e.id === 'string' ? e.id : null, errors: ['id: a non-empty string, unique in the file'] }); continue }
    if (have.has(e.id)) { already.push(e.id); continue }
    const errs = e.origin !== 'unplanned' ? [`origin ${q(e.origin)}: only an unplanned change is appended`] : e.ack !== undefined ? ['ack: an appended change is not acknowledged yet'] : (isArchTarget(e.target) ? archChangeErrors : changeErrors)(e)
    if (errs.length) { refused.push({ id: e.id, errors: errs }); continue }
    have.add(e.id)
    added.push(e)
  }
  if (!added.length) return { text, added: [], already, refused, errors: [] }
  const byList = { data: added.filter((x) => !isArchTarget(x.target)), architecture: added.filter((x) => isArchTarget(x.target)) }
  const want = { ...doc, data: [...doc.data, ...byList.data], architecture: [...doc.architecture, ...byList.architecture] }
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const unit = (/\n([ \t]+)"/.exec(text) || [, '  '])[1]
  const ids = added.map((x) => x.id)
  try {
    let out = text
    for (const list of ['data', 'architecture']) if (byList[list].length) out = appendTo(out, list, byList[list], nl, unit)
    if (JSON.stringify(JSON.parse(out)) === JSON.stringify(want)) return { text: out, added: ids, already, refused, errors: [] }
  } catch {}
  const whole = (JSON.stringify(want, null, unit) + (/\r?\n$/.test(text) ? '\n' : '')).split('\n').join(nl)
  return { text: whole, added: ids, already, refused, errors: [] }
}
// The changes written after the last one of `list` in the text, in its layout (appendChanges).
function appendTo(text, list, added, nl, unit) {
  const lineInd = (at) => /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', at - 1) + 1, at))[0]
  const spread = (x, ind) => JSON.stringify(x, null, unit).split('\n').join(nl + ind)
  const flat = (x) => JSON.stringify(x, null, 1).replace(/\n\s*/g, ' ')
  const root = spans(text)
  const member = [...root.members].reverse().find((m) => m.key === list)
  const node = member.node, items = node.items
  if (items.length) {
    const last = items[items.length - 1]
    const own = /^[ \t]*$/.test(text.slice(text.lastIndexOf('\n', last.start - 1) + 1, last.start)) // the last change starts its line
    const multi = text.slice(node.start, node.end).includes('\n') && own
    const ind = multi ? lineInd(last.start) : ''
    const one = !text.slice(last.start, last.end).includes('\n')
    const put = added.map((x) => (multi ? `,${nl}${ind}${one ? flat(x) : spread(x, ind)}` : `, ${flat(x)}`)).join('')
    return text.slice(0, last.end) + put + text.slice(last.end)
  }
  const ind = lineInd(member.kstart)
  return `${text.slice(0, node.start)}[${nl}${added.map((x) => `${ind}${unit}${spread(x, ind + unit)}`).join(`,${nl}`)}${nl}${ind}]${text.slice(node.end)}`
}

// Where each value of a JSON text starts and ends (the text is valid JSON: JSON.parse read it).
//   → { start, end, members?: [{ key, kstart, node }], items?: [node] }
function spans(text) {
  let i = 0
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++ }
  const string = () => { i++; while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1; i++ }
  const value = () => {
    ws()
    const start = i, c = text[i]
    if (c === '{' || c === '[') {
      i++; ws()
      const obj = c === '{', list = []
      if (text[i] === (obj ? '}' : ']')) { i++; return obj ? { start, end: i, members: list } : { start, end: i, items: list } }
      for (;;) {
        ws()
        if (obj) { const kstart = i; string(); const key = JSON.parse(text.slice(kstart, i)); ws(); i++; list.push({ key, kstart, node: value() }) } else list.push(value())
        ws()
        if (text[i++] === ',') continue
        return obj ? { start, end: i, members: list } : { start, end: i, items: list }
      }
    }
    if (c === '"') string()
    else while (i < text.length && !' \t\n\r,]}'.includes(text[i])) i++
    return { start, end: i }
  }
  return value()
}
