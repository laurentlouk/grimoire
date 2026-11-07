// grimoire graph · data · extractor: key-value tables declared in Terraform (`resource
// "aws_dynamodb_table"`), as each instance of their module evaluates them: through the Terragrunt
// configurations that run the module, or with the module's own variable values. Per unit: one
// module folder, re-run when one of its files or any HCL file of the repository changes.
//
// Found by content, not by name: a folder is a module when one of its .tf files declares an
// `aws_dynamodb_table` resource (tfLevel). Its instances, first found:
//   - each `terragrunt.hcl` (Terragrunt's own file name for a configuration it runs) whose
//     `terraform { source }`, its own or an include's, resolves to that folder (a local path:
//     `../../modules/dynamodb`, `${get_repo_root()}/modules//dynamodb`); its `inputs`, merged with
//     its includes', set the module's variables (the module's terraform.tfvars and *.auto.tfvars
//     over them, as Terraform reads them);
//   - else each other *.tfvars beside the module (a var-file per environment), over the auto ones;
//   - else the module alone: its defaults, terraform.tfvars and *.auto.tfvars.
// Each instance is a declaration of the repository's key-value store (`dynamodb`, as
// dynamodb-table.mjs and cloudformation.mjs name it), at the file that instantiates it: two
// declarations stating one exact table name, here or in a CreateTable file or a template, are two
// declarations of one table, and their disagreements its conflicts.
//
// A table per for_each key (a map, or a set of strings) or count index. Read: name, hash_key,
// range_key, the `attribute` blocks, `global_secondary_index` (hash_key / range_key, or the newer
// `key_schema` blocks for multi-attribute keys; projection_type, non_key_attributes),
// `local_secondary_index` (the table's partition key, its range_key), `ttl` (attribute_name,
// enabled: false unless said), stream_enabled and stream_view_type, billing_mode (PROVISIONED
// unless said, as the provider documents); `dynamic` blocks expanded. Nothing else is evaluated,
// so a tag, a policy or a secret beside a table is never computed.
//
// Each element cites the line that states it, outside the resource's code when one does (the
// Terragrunt inputs entry for that table, its GSI's object, the tfvars line, the variable's
// default), else the resource's own line; and the module's line as a second source (`via`).
//
// Unknown, never guessed (readers/hcl-eval.mjs): a value from `dependency.*.outputs`, `get_env()`,
// a data source, another resource or module, a function the evaluator does not run, a file no input
// holds. It is kept as `${<expression>}` and noted; the table is then not `whole`. A name with an
// unknown part is named by its template, its literal parts kept and each unknown part `{label}`
// (`"${var.env}-${var.project}-orders"` → `{env}-{project}-orders`, also its `nameTemplate`), for a
// later slice to bind; two instances whose names are unknown alike share that template, and so one
// entity. A module out of reach (a git, registry or other remote source whose address names a
// key-value table module: found per file, `remote`) is noted as found, not read.
//
// The environment the module sets to its tables: a resource's `environment { variables = { … } }` (a
// function's) whose value is a table's `.name` or `.id` by its address, or its name evaluated, is kept
// on the declaration as `env` [{ name, table, path, line }], for the item binding (data/binding.mjs:
// code reading that variable names that table). No other variable is kept, by name or by value.
//
// Secrets: only what lands in the model is kept (names, keys, attribute names and types, index
// names, the TTL attribute, stream, billing); every other value is evaluated in memory, if at all,
// and dropped with the evaluation. A note names what the source writes (an expression, readers/hcl.mjs
// refText; a literal file or variable name), never a value it evaluates to; a file that does not parse
// is reported by its line alone (readers/json-lines.mjs parseJson, readers/hcl.mjs).
import path from 'node:path'
import { parseHcl, HclError, refText, HCL_MAX } from '../readers/hcl.mjs'
import {
  Evaluator, BudgetError, Unknown, Partial, isUnk, readModule, moduleScope, instancesOf, attrOf, blocksOf,
  tfvarsValues, jsonValues, Terragrunt, moduleDir, safeAddress, memberAt, isObj, EVAL_MS, child,
} from '../readers/hcl-eval.mjs'
import { jsonLines, pathKey, parseJson } from '../readers/json-lines.mjs'
import { capNotes, NOTES } from '../readers/dynamodb.mjs'
import { STORE } from './dynamodb-table.mjs'

const P = path.posix
const TF = /\.tf$/i
const TFVARS = /\.tfvars(?:\.json)?$/i
const AUTO = /(?:^|\/)terraform\.tfvars(?:\.json)?$|\.auto\.tfvars(?:\.json)?$/i
const HCL = /\.hcl$/i
const UNIT_FILE = /(?:^|\/)terragrunt\.hcl$/
const NEVER = /\.tftest\.hcl$|(?:^|\/)\.terraform\.lock\.hcl$/i

// What a file declares, by content (registry.mjs inspect): a .tf declaring a table resource is a
// module; a terragrunt.hcl with a terraform, include or inputs is a configuration Terragrunt runs; a
// remote module source whose address names a key-value table module, out of reach. Each scan is per
// line and linear.
export const TF_LEVEL = { module: 4, unit: 5, remote: 6 }
const TABLE_RESOURCE = /^[ \t]*resource[ \t]+"aws_dynamodb_table"/m
const UNIT = /^[ \t]*(?:terraform|include)\b|^[ \t]*inputs[ \t]*=/m
const REMOTE = /^[ \t]*source[ \t]*=[ \t]*"(?![./$])[^"\n]*dynamodb/im
const MODULE_BLOCK = /^[ \t]*module[ \t]+"/m
export const wantsTf = (p) => (TF.test(p) || TFVARS.test(p) || HCL.test(p)) && !NEVER.test(p)
export function tfLevel(p, text) {
  if (TF.test(p)) return TABLE_RESOURCE.test(text) ? TF_LEVEL.module : MODULE_BLOCK.test(text) && REMOTE.test(text) ? TF_LEVEL.remote : 1
  if (UNIT_FILE.test(p)) return REMOTE.test(text) ? TF_LEVEL.remote : UNIT.test(text) ? TF_LEVEL.unit : 1
  return 1
}

export default {
  id: 'terraform',
  version: 2,
  kind: 'infra',
  scope: 'unit',
  wants: wantsTf,
  // a job per module folder (its .tf and .tfvars, and every HCL file: a Terragrunt configuration
  // anywhere may run it, and include or read any other; one past the reader's cap, which could not
  // be read, is left out, so it fails no module's job), and one per file whose module is out of reach
  discover(info) {
    const all = [...info.keys()].filter(wantsTf)
    const hcl = all.filter((p) => HCL.test(p) && !(info.get(p).size > HCL_MAX)).sort()
    const dirs = [...new Set(all.filter((p) => TF.test(p) && info.get(p).ddl === TF_LEVEL.module).map((p) => P.dirname(p)))].sort()
    const jobs = dirs.map((dir) => {
      const own = all.filter((p) => P.dirname(p) === dir && (TF.test(p) || TFVARS.test(p))).sort()
      return { key: dir, inputs: [...own, ...hcl.filter((p) => P.dirname(p) !== dir || !own.includes(p))] }
    })
    for (const p of all.filter((x) => info.get(x).ddl === TF_LEVEL.remote).sort()) jobs.push({ key: p, inputs: [p], override: 'remote' })
    return jobs
  },
  extract({ key, files, override }) {
    if (override === 'remote') return remote(key, files[0])
    return moduleUnit(key, files)
  },
}

const msg = (e) => String(e?.message || e).split('\n')[0].slice(0, 200)
// the engine running out of room (a call stack, a string or a list past its size) on a hostile value:
// a stop like the budget's, said in a note, never the job's failure
const bounded = (e) => (e instanceof BudgetError ? e : e instanceof RangeError ? new BudgetError('a value too large or too deep for the evaluator') : null)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function moduleUnit(dir, files) {
  const deadline = Date.now() + EVAL_MS
  const texts = new Map(files.map((f) => [f.path, f.text]))
  const parsed = new Map()
  const body = (p) => {
    if (!parsed.has(p)) { try { parsed.set(p, parseHcl(texts.get(p), { deadline }).body) } catch (e) { parsed.set(p, e) } }
    const b = parsed.get(p)
    if (b instanceof Error) throw b
    return b
  }
  const fsx = { has: (p) => texts.has(p) && HCL.test(p), body }
  const notes = []
  const own = files.map((f) => f.path).filter((p) => P.dirname(p) === dir)
  const modFiles = []
  for (const p of own.filter((x) => TF.test(x))) { try { modFiles.push({ path: p, body: body(p) }) } catch (e) { notes.push(`${p} does not parse: ${msg(e)}`) } }
  const mod = readModule(modFiles)
  const resources = mod.resources.filter((r) => r.type === 'aws_dynamodb_table')
  const found = (path, label) => ({ declarations: [{ store: STORE, dialect: 'dynamodb', dialectFrom: null, source: { path, line: 1, kind: 'infra', confidence: 'declared' }, complete: false, partial: false, status: 'not-read', label, files: own.length, notes: capNotes(notes, 4 * NOTES), entities: [] }] })
  if (!resources.length) return found(own.find((p) => TF.test(p)) || dir, `Terraform module ${dir}: its table resources could not be read`)

  // the Terragrunt configurations that run this module
  const instances = [], unsure = []
  for (const u of files.map((f) => f.path).filter((p) => UNIT_FILE.test(p)).sort()) {
    const ev = new Evaluator({ deadline })
    let src
    try {
      const tg = new Terragrunt(u, fsx, ev)
      src = tg.source()
      if (!src) continue
      if (isUnk(src.v)) { unsure.push(`${u}: its module source is unknown (${(src.v instanceof Unknown ? src.v : src.v.parts.find((x) => x instanceof Unknown)).why})`); continue }
      if (typeof src.v !== 'string') continue
      const m = moduleDir(src.v, P.dirname(u))
      if (m.dir === dir) instances.push({ kind: 'terragrunt', path: u, line: src.at.line, tg, ev })
    } catch (e) {
      if (e instanceof HclError) { if (UNIT.test(texts.get(u) || '')) unsure.push(`${u} does not parse (${msg(e)})`); continue }
      if (bounded(e)) { unsure.push(`${u}: not evaluated (${msg(bounded(e))})`); continue }
      throw e
    }
  }
  const varFiles = own.filter((p) => TFVARS.test(p))
  const auto = varFiles.filter((p) => AUTO.test(p)).sort((a, b) => rankAuto(a) - rankAuto(b) || (a < b ? -1 : 1))
  if (!instances.length) {
    const named = varFiles.filter((p) => !AUTO.test(p)).sort()
    if (named.length) for (const p of named) instances.push({ kind: 'tfvars', path: p, line: 1 })
    else instances.push({ kind: 'module', path: resources[0].path, line: resources[0].block.line })
  }
  for (const u of unsure.slice(0, 8)) notes.push(`${u}: if it runs this module, its tables are missing`)
  if (unsure.length > 8) notes.push(`… and ${unsure.length - 8} more Terragrunt configurations not read`)

  return { declarations: instances.map((inst) => declaration(dir, mod, resources, inst, { auto, body, texts, deadline, base: notes })) }
}
// terraform.tfvars, then terraform.tfvars.json, then the *.auto.tfvars files (in name order)
const rankAuto = (p) => (/(?:^|\/)terraform\.tfvars$/i.test(p) ? 0 : /(?:^|\/)terraform\.tfvars\.json$/i.test(p) ? 1 : 2)

function declaration(dir, mod, resources, inst, { auto, body, texts, deadline, base }) {
  const notes = [...base]
  const ev = inst.ev || new Evaluator({ deadline })
  const entities = []
  const templated = new Map() // why a name has an unknown part → the templates it names
  let scope = null
  try {
    const values = new Map()
    if (inst.kind === 'terragrunt') {
      const { v, notes: n } = inst.tg.inputs()
      notes.push(...n)
      if (isUnk(v)) notes.push(`${inst.path}: its inputs are unknown (${(v instanceof Unknown ? v : v.parts.find((x) => x instanceof Unknown)).why})`)
      else if (isObj(v)) for (const k of Object.keys(v)) values.set(k, { v: v[k], at: memberAt(v, k) })
    }
    for (const p of [...auto, ...(inst.kind === 'tfvars' ? [inst.path] : [])]) {
      try { for (const [k, x] of varsOf(p, body, texts, ev)) values.set(k, x) } catch (e) { if (bounded(e)) throw e; notes.push(`${p} does not parse: ${msg(e)}`) }
    }
    scope = moduleScope(mod, values, { dir }).scope
    for (const res of resources) {
      const addr = `aws_dynamodb_table.${res.name}`
      const r = instancesOf(res, scope, ev)
      if (r.unknown) notes.push(`${addr}: its tables are unknown: ${refText(forEachOf(res))} is unknown (${r.unknown.why})`)
      if (r.error) notes.push(`${addr}: ${r.error}`)
      for (const one of r.list || []) {
        const t = table(res, one, ev, dir)
        entities.push(t.entity)
        notes.push(...t.notes)
        if (t.named) { if (!templated.has(t.named)) templated.set(t.named, []); templated.get(t.named).push(t.entity.name) }
      }
    }
  } catch (e) {
    if (!bounded(e)) throw e
    notes.push(`the evaluation stopped: ${msg(bounded(e))}; the tables read before it are kept`)
  }
  let env = []
  try { env = wiring(mod, entities, ev, scope) } catch (e) { if (!bounded(e)) throw e; notes.push(`the environment variables were not read: ${msg(bounded(e))}`) }
  // one note per reason a name is unknown, not one per table
  for (const [why, names] of templated) notes.unshift(names.length === 1 ? `${names[0]}: a part of its name is unknown (${why}): named by its template` : `${names.length} tables: a part of each name is unknown (${why}): each named by its template (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})`)
  const how = inst.kind === 'terragrunt' ? 'through Terragrunt' : inst.kind === 'tfvars' ? `with ${P.basename(inst.path)}` : auto.length ? `with ${auto.map((p) => P.basename(p)).join(', ')}` : 'with its defaults'
  return {
    store: STORE, dialect: 'dynamodb', dialectFrom: null,
    source: { path: inst.path, line: entities.find((e) => e.path === inst.path)?.line ?? inst.line ?? 1, kind: 'infra', confidence: 'declared' },
    complete: false, partial: false, status: entities.length ? 'read' : 'not-read',
    label: `Terraform module ${dir} ${how}, ${plural(entities.length, 'table')}`,
    files: 1,
    notes: capNotes(notes, 4 * NOTES), entities,
    ...(env.length ? { env } : {}),
  }
}

// The environment variables the module's resources set to one of its tables (a function's
// `environment { variables = { ORDERS_TABLE = aws_dynamodb_table.this["orders"].name } }`), for the
// item binding (data/binding.mjs): [{ name, table, path, line }]. A value names a table when it is
// that table's `.name` or `.id` by its address (a literal key), or evaluates to its name, or to a
// template its name template is. Only those variables are kept: no other variable's name or value.
function wiring(mod, entities, ev, scope) {
  const out = []
  if (!entities.length) return out
  const byAs = new Map(entities.map((e) => [e.as, e]))
  for (const res of mod.resources) {
    for (const b of res.block.body.items) {
      if (b.t !== 'block' || b.type !== 'environment') continue
      const vars = b.body.items.find((x) => x.t === 'attr' && x.name === 'variables')
      if (!vars || vars.expr.t !== 'object') continue
      for (const it of vars.expr.items) {
        const key = it.key && it.key.t === 'lit' && typeof it.key.v === 'string' ? it.key.v : null
        if (!key || !it.value) continue
        const m = /^(aws_dynamodb_table\.[A-Za-z_][\w-]*(?:\[[^\]]+\])?)\.(?:name|id)$/.exec(refText(it.value, 200))
        let e = m ? byAs.get(m[1]) : null
        if (!e && scope && (it.value.t === 'lit' || it.value.t === 'tpl')) {
          let v = null
          try { v = ev.value(it.value, child(scope, {}, {}, res.path)) } catch (x) { if (bounded(x)) throw x }
          const name = typeof v === 'string' ? v : v instanceof Partial ? v.parts.map((p) => (typeof p === 'string' ? p : `{${p.label ?? 'name'}}`)).join('') : null
          if (name) e = entities.find((x) => x.name === name) || null
        }
        if (e) out.push({ name: key, table: e.name, path: res.path, line: it.line ?? b.line })
      }
    }
  }
  return out
}
const forEachOf =(res) => res.block.body.items.find((x) => x.t === 'attr' && (x.name === 'for_each' || x.name === 'count'))?.expr ?? null

// a tfvars file's values (HCL, or JSON with the line of each member)
function varsOf(p, body, texts, ev) {
  if (/\.json$/i.test(p)) {
    const text = texts.get(p).replace(/^\ufeff/, '')
    const lines = jsonLines(text)
    return jsonValues(p, parseJson(text), lines, pathKey, ev) // an error says where, never what the file holds there
  }
  return tfvarsValues(p, body(p), ev)
}

// One table: its entity and the notes it raises.
function table(res, inst, ev, dir) {
  const notes = []
  const body = res.block.body, sc = inst.scope
  const key = inst.key === null ? '' : typeof inst.key === 'number' ? `[${inst.key}]` : `[${JSON.stringify(inst.key)}]`
  const addr = `aws_dynamodb_table.${res.name}${key}`
  const span = { path: res.path, from: res.block.line, to: res.block.end }
  const real = (a) => (a && a.path && a.line ? { path: a.path, line: a.line } : null)
  const code = (a) => a.path === span.path && a.line >= span.from && a.line <= span.to
  const entityAt = (() => { const a = real(inst.at); return a && !code(a) ? a : { path: res.path, line: res.block.line } })()
  // the line that states an element: the first origin outside the resource's code, else the table's
  const pick = (...ats) => ats.map(real).find((a) => a && !code(a)) ?? entityAt
  const via = (line, as = null) => ({ via: { path: res.path, line, ...(as ? { as } : {}) } })
  const unknowns = []
  // a scalar as the model keeps it: a string, or an unknown as ${expression} (and noted)
  const text = (v, what) => {
    if (v === null || v === undefined) return null
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v instanceof Unknown) { unknowns.push([`${what} is unknown`, v]); return `\${${v.text}}` }
    if (v instanceof Partial) { unknowns.push([`${what} is unknown`, v.parts.find((p) => p instanceof Unknown)]); return v.parts.map((p) => (typeof p === 'string' ? p : `\${${p.text}}`)).join('') }
    notes.push(`${addr}: ${what} is a list or an object, not a single value: not read`)
    return null
  }
  const at = (body, name, scope = sc) => attrOf(body, name, scope, ev)
  const blocks = (body, type, scope = sc) => {
    const b = blocksOf(body, type, scope, ev)
    for (const u of b.unknown) unknowns.push([`its ${type} blocks are unknown`, u])
    return b.list
  }

  // the name, or its template when a part is unknown
  const nm = at(body, 'name')
  let name, nameTemplate = null, named = null
  if (!nm.has) { name = addr; notes.push(`${addr}: no name: named by its address`) } else if (isUnk(nm.v)) {
    const parts = nm.v instanceof Partial ? nm.v.parts : [nm.v]
    nameTemplate = parts.map((p) => (typeof p === 'string' ? p : `{${p.label ?? 'name'}}`)).join('')
    name = nameTemplate
    named = parts.find((p) => p instanceof Unknown).why
  } else name = text(nm.v, 'its name') ?? addr

  const hk = at(body, 'hash_key'), rk = at(body, 'range_key')
  const hash = text(hk.v, 'hash_key'), range = text(rk.v, 'range_key')
  const keys = []
  if (hash !== null) keys.push({ role: 'partition', parts: [hash], ...pick(hk.at), ...via(hk.line) })
  if (range !== null) keys.push({ role: 'sort', parts: [range], ...pick(rk.at), ...via(rk.line) })

  // the attributes (a set in the provider: one block per name, duplicates collapse)
  const fields = [], typed = new Map()
  for (const b of blocks(body, 'attribute')) {
    const n = at(b.body, 'name', b.scope), t = at(b.body, 'type', b.scope)
    const fname = text(n.v, 'an attribute\'s name')
    if (fname === null) continue
    const type = text(t.v, `the type of ${fname}`) ?? ''
    if (typed.has(fname)) { if (typed.get(fname) !== type) notes.push(`${name}: the attribute ${fname} is typed twice (${typed.get(fname)}, ${type})`); continue }
    typed.set(fname, type)
    fields.push({ name: fname, type, nullable: true, default: null, generated: null, ...pick(n.at, b.at), ...via(b.line) })
  }

  const tb = blocks(body, 'ttl')[0]
  if (tb) {
    const an = at(tb.body, 'attribute_name', tb.scope), en = at(tb.body, 'enabled', tb.scope)
    const attr = text(an.v, 'the TTL attribute')
    const enabled = !en.has ? false : en.v === true || en.v === false ? en.v : en.v === null ? false : text(en.v, 'whether TTL is enabled')
    keys.push({ role: 'ttl', parts: attr ? [attr] : [], enabled, ...pick(en.at, an.at, tb.at), ...via(tb.line) })
  }

  const indexes = []
  const index = (b, kind, i) => {
    const n = at(b.body, 'name', b.scope)
    const ks = blocks(b.body, 'key_schema', b.scope)
    const partition = [], sort = []
    if (ks.length) {
      for (const k of ks) {
        const an = at(k.body, 'attribute_name', k.scope), kt = at(k.body, 'key_type', k.scope)
        const a = text(an.v, 'a key_schema attribute'), t = text(kt.v, 'a key_type')
        if (a === null) continue
        if (t === 'HASH') partition.push(a); else if (t === 'RANGE') sort.push(a); else notes.push(`${name}: a key_schema of ${kind} ${i} is no HASH or RANGE key`)
      }
    } else {
      if (kind === 'lsi') { if (hash !== null) partition.push(hash) } else { const h = text(at(b.body, 'hash_key', b.scope).v, 'an index\'s hash_key'); if (h !== null) partition.push(h) }
      const r = text(at(b.body, 'range_key', b.scope).v, 'an index\'s range_key')
      if (r !== null) sort.push(r)
    }
    const projection = text(at(b.body, 'projection_type', b.scope).v, 'an index\'s projection_type')
    const nk = at(b.body, 'non_key_attributes', b.scope).v
    const include = Array.isArray(nk) ? nk.map((x) => text(x, 'a non-key attribute')).filter((x) => x !== null) : nk === null || nk === undefined ? [] : [text(nk, 'non_key_attributes')].filter((x) => x !== null)
    const iname = text(n.v, 'an index\'s name') ?? `${kind} ${i}`
    for (const role of [partition, sort]) if (role.length > 4) notes.push(`${name}: the index ${iname} has ${role.length} attributes in one key, more than the four a key takes`)
    indexes.push({ name: iname, kind, partition, sort, projection, include, columns: [...partition, ...sort], unique: false, partial: false, ...pick(b.at, n.at), ...via(b.line) })
  }
  blocks(body, 'global_secondary_index').forEach((b, i) => index(b, 'gsi', i))
  blocks(body, 'local_secondary_index').forEach((b, i) => index(b, 'lsi', i))

  const se = at(body, 'stream_enabled')
  let stream = null
  if (se.v === true) stream = text(at(body, 'stream_view_type').v, 'stream_view_type') ?? 'enabled, no view type said'
  else if (isUnk(se.v)) stream = text(se.v, 'stream_enabled')
  const bm = at(body, 'billing_mode')
  const billing = bm.has && bm.v !== null ? text(bm.v, 'billing_mode') : 'PROVISIONED'

  // leads, as for a CreateTable input: a key no attribute types, an attribute that keys nothing
  const keyed = new Set([...keys.filter((k) => k.role !== 'ttl'), ...indexes].flatMap((x) => x.parts || x.columns))
  const tableKeys = new Set([hash, range].filter((x) => x !== null))
  for (const f of fields) f.nullable = !tableKeys.has(f.name) // not null when it keys the table; an index's key may be absent
  if (!unknowns.length) {
    for (const a of keyed) if (!typed.has(a)) notes.push(`${name}: the key ${a} is not among its attribute blocks`)
    for (const f of fields) if (!keyed.has(f.name)) notes.push(`${name}: ${f.name} is an attribute block and keys neither the table nor an index`)
  }
  const seen = new Set()
  for (const [what, u] of unknowns) {
    const line = `${name}: ${what} (${u.why})`
    if (!seen.has(line)) { seen.add(line); notes.push(line) }
  }
  return {
    entity: {
      name, kind: 'table', billing, stream, whole: !unknowns.length, as: addr, ...(nameTemplate ? { nameTemplate } : {}),
      ...entityAt, ...via(res.block.line, `the resource in ${dir}`), fields, keys, indexes, relations: [],
    },
    notes: capNotes(notes),
    named,
  }
}

// A file whose module is out of reach: found, not read, said so.
function remote(file, f) {
  let body
  try { body = parseHcl(f.text).body } catch { return { declarations: [] } }
  const found = []
  const scan = (items) => {
    for (const it of items) {
      if (it.t !== 'block') continue
      if ((it.type === 'terraform' && UNIT_FILE.test(file)) || (it.type === 'module' && TF.test(file))) {
        const s = it.body.items.find((x) => x.t === 'attr' && x.name === 'source')
        if (s && s.expr.t === 'lit' && typeof s.expr.v === 'string' && /dynamodb/i.test(s.expr.v) && moduleDir(s.expr.v, '.').remote) found.push({ line: s.line, address: safeAddress(s.expr.v) })
      }
    }
  }
  scan(body.items)
  if (!found.length) return { declarations: [] }
  return { declarations: [{
    store: STORE, dialect: 'dynamodb', dialectFrom: null,
    source: { path: file, line: found[0].line, kind: 'infra', confidence: 'declared' },
    complete: false, partial: false, status: 'not-read', files: 1,
    label: `a module out of reach (${found.map((x) => x.address).join(', ')})`,
    notes: found.map((x) => `${file}:${x.line}: its module ${x.address} is not in this repository (a remote source): the key-value tables it declares, if any, are unknown`),
    entities: [],
  }] }
}
