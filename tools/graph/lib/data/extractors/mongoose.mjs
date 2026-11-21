// grimoire graph · data · extractor: Mongoose schemas, a document store's model declared in code (kind
// code). Through the pinned TypeScript grammar, nothing evaluated. Per unit: the model files of a
// repository (their common folder is the store, dialect `mongodb`); re-run when any changes.
//
// Found by content (bit 262144 of a source file's level): a TypeScript or JavaScript file importing
// `mongoose` that builds a schema (`new Schema(`, `new mongoose.Schema(`, or called without `new`,
// `mongoose.Schema(` and `Schema(`, which Mongoose accepts alike).
//
// What is read:
//   - `new Schema({ … }, { collection, timestamps, _id })` (or `Schema(…)`, no `new`) bound to a name, and the model built from it
//     (`model('User', userSchema)`, `mongoose.model(…)`, `models.User || model(…)`): a collection, named
//     by the model's third argument, else the schema's `collection` option, else the model's name as
//     Mongoose names it (lower case, pluralized by its own rules: `User` → `users`); a schema no model is
//     built from is noted (a sub-document);
//   - each path of the definition: a field (nested objects by dotted path, `address.city`; an array of
//     a type `[String]`, of a sub-schema `[]`), its type as written (`String`, `Number`, `ObjectId`,
//     `[String]`), required (`required: true`) or not, `default` kept when a number, a boolean or null,
//     else only that there is one (never a string's value); `_id` the key (an ObjectId unless the
//     schema says `_id: false`); `timestamps: true` its `createdAt` and `updatedAt`;
//   - `ref: 'User'` (or `ref: User.modelName`): a relation to that model's collection, declared by the
//     ORM (`enforced: 'client'`: a document store holds no foreign key), at its line;
//   - `unique: true`, `index: true` a field's index (`<path>_1`, unique or not), `schema.index({ a: 1,
//     b: -1 }, { unique })` a compound one (`a_1_b_-1`, or its `name`).
// A definition built by code (a spread, a computed key) leaves its collection stated in part.
import { named, field, lineOf } from '../readers/code.mjs'
import { value, keyText, str, bool, argsOf } from '../readers/ts-value.mjs'
import { common, counted } from '../readers/orm.mjs'

const SRC = /\.(?:ts|mts|cts|tsx|js|mjs|cjs)$/i
const DTS = /\.d\.[cm]?ts$/i
const IMPORT = /\bfrom[ \t]*['"]mongoose['"]|\brequire\([ \t]*['"]mongoose['"][ \t]*\)/
const SCHEMA = /\bnew[ \t]+(?:mongoose\.)?Schema\b|(?<![\w$.])(?:mongoose[ \t]*\.[ \t]*)?Schema[ \t]*\(/
export const mongooseLevel = (p, text) => (SRC.test(p) && !DTS.test(p) && IMPORT.test(text) && SCHEMA.test(text) ? 262144 : 0)
const MAX = { schemas: 500, fields: 1000, depth: 6, notes: 12 }
const langOf = (p) => (/\.tsx$/i.test(p) ? 'tsx' : /\.(?:ts|mts|cts)$/i.test(p) ? 'typescript' : 'javascript')

// Mongoose's own pluralization (lib/helpers/pluralize.js): the first rule matching, after lower case
const RULES = [[/(m)an$/i, '$1en'], [/(pe)rson$/i, '$1ople'], [/(child)$/i, '$1ren'], [/^(ox)$/i, '$1en'], [/(ax|test)is$/i, '$1es'], [/(octop|vir)us$/i, '$1i'], [/(alias|status)$/i, '$1es'], [/(bu)s$/i, '$1ses'], [/(buffal|tomat|potat)o$/i, '$1oes'], [/([ti])um$/i, '$1a'], [/sis$/i, 'ses'], [/(?:([^f])fe|([lr])f)$/i, '$1$2ves'], [/(hive)$/i, '$1s'], [/([^aeiouy]|qu)y$/i, '$1ies'], [/(x|ch|ss|sh)$/i, '$1es'], [/(matr|vert|ind)ix|ex$/i, '$1ices'], [/([m|l])ouse$/i, '$1ice'], [/(kn|w|l)ife$/i, '$1ives'], [/(quiz)$/i, '$1zes'], [/s$/i, 's'], [/([^a-z])$/, '$1'], [/$/, 's']]
const UNCOUNTABLE = new Set(['advice', 'energy', 'excretion', 'digestion', 'cooperation', 'health', 'justice', 'labour', 'machinery', 'equipment', 'information', 'pollution', 'sewage', 'paper', 'money', 'species', 'series', 'rain', 'rice', 'fish', 'sheep', 'moose', 'deer', 'news', 'expertise', 'status', 'media'])
export function collectionOf(model) {
  const s = String(model).toLowerCase()
  if (UNCOUNTABLE.has(s)) return s
  const r = RULES.find(([re]) => re.test(s))
  return r ? s.replace(r[0], (...g) => r[1].replace(/\$(\d)/g, (_, i) => g[Number(i)] ?? '')) : s
}

// a type as written: `String`, `Schema.Types.ObjectId` → ObjectId, `[String]`
function typeName(n, schemas) {
  const v = value(n)
  if (v.k === 'name') return schemas.has(v.v) ? 'subdocument' : v.v.split('.').pop()
  if (v.k === 'str') return v.v
  if (v.k === 'arr') return `[${v.items.length ? typeName(v.items[0], schemas) : 'Mixed'}]`
  return null
}
const TYPE_KEYS = new Set(['type'])
// a schema definition object → fields [{ path, type, required, default, ref, unique, index, line }]
function readDefinition(obj, prefix, schemas, out, depth = 0) {
  const v = value(obj)
  if (v.k !== 'obj' || depth > MAX.depth) { out.part = true; return }
  if (v.spread) out.part = true
  for (const p of named(obj)) {
    if (p.type !== 'pair') { if (p.type !== 'comment' && p.type !== 'shorthand_property_identifier') out.part = true; continue }
    const k = keyText(field(p, 'key'))
    if (k === null) { out.part = true; continue }
    if (out.fields.length >= MAX.fields) return
    const path = prefix ? `${prefix}.${k}` : k
    const val = field(p, 'value')
    const x = value(val)
    const line = lineOf(p)
    if (x.k === 'obj' && !x.pairs.has('type')) { readDefinition(val, path, schemas, out, depth + 1); continue } // a nested object
    if (x.k === 'arr' && x.items[0] && value(x.items[0]).k === 'obj' && !value(x.items[0]).pairs.has('type')) {
      out.fields.push({ path, type: '[]', required: false, default: null, line })
      readDefinition(x.items[0], `${path}[]`, schemas, out, depth + 1)
      continue
    }
    const f = { path, type: null, required: false, default: null, line }
    if (x.k === 'obj') {
      f.type = typeName(x.pairs.get('type'), schemas) || 'Mixed'
      const req = x.pairs.get('required'); if (req) { const r = value(req); f.required = r.k === 'true' || r.k === 'arr' && value(r.items[0]).k === 'true' }
      if (x.pairs.has('default')) { const d = value(x.pairs.get('default')); f.default = d.k === 'num' ? d.v : d.k === 'true' || d.k === 'false' || d.k === 'null' ? d.k : d.k === 'str' ? "'…'" : '(expression)'; if (d.k === 'str' || !['num', 'true', 'false', 'null'].includes(d.k)) f.unstatedDefault = true }
      if (x.pairs.has('ref')) { const r = value(x.pairs.get('ref')); f.ref = r.k === 'str' ? r.v : r.k === 'name' ? r.v.replace(/\.modelName$/, '').split('.').pop() : null; if (!f.ref) f.refCode = true }
      if (bool(x.pairs.get('unique')) === true) f.unique = true
      if (bool(x.pairs.get('index')) === true) f.index = true
      // `[{ type: ObjectId, ref: 'Tag' }]` handled below; enum values are never kept
    } else if (x.k === 'arr' && x.items[0] && value(x.items[0]).k === 'obj') {
      const inner = value(x.items[0])
      f.type = `[${typeName(inner.pairs.get('type'), schemas) || 'Mixed'}]`
      if (inner.pairs.has('ref')) { const r = value(inner.pairs.get('ref')); f.ref = r.k === 'str' ? r.v : null }
    } else f.type = typeName(val, schemas) || 'Mixed'
    // a field of another schema of the file (a sub-document): its paths under this one, once read
    const sub = x.k === 'name' ? x.v : x.k === 'arr' && x.items[0] && value(x.items[0]).k === 'name' ? value(x.items[0]).v : null
    if (sub && schemas.has(sub)) f.sub = { name: sub, list: x.k === 'arr' }
    out.fields.push(f)
  }
}

function readFile(root, file) {
  const out = { schemas: [], models: [], indexes: [], errors: [] }
  const schemaNodes = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === 'ERROR' && out.errors.length < 4) out.errors.push(lineOf(n))
    if (n.type === 'variable_declarator') {
      const init = field(n, 'value')
      // `new Schema(…)`, or the constructor called without `new` (`mongoose.Schema(…)`, `Schema(…)`)
      const ctor = init?.type === 'new_expression' ? field(init, 'constructor') : init?.type === 'call_expression' ? field(init, 'function') : null
      if (ctor && /^(?:mongoose\.)?Schema$/.test(ctor.text.replace(/\s+/g, ''))) schemaNodes.push([field(n, 'name')?.text, init])
    }
    if (n.type === 'call_expression') {
      const fn = field(n, 'function')?.text.replace(/\s+/g, '') || ''
      const a = argsOf(n)
      if (/(?:^|\.)model$/.test(fn) && a.length >= 2 && str(a[0])) out.models.push({ name: str(a[0]), schema: value(a[1]).k === 'name' ? value(a[1]).v : null, collection: a[2] ? str(a[2]) : null, line: lineOf(n) })
      const m = /^(\w+)\.index$/.exec(fn)
      if (m && a[0] && value(a[0]).k === 'obj') {
        const keys = []
        for (const p of named(a[0])) if (p.type === 'pair') { const k = keyText(field(p, 'key')); const d = value(field(p, 'value')); if (k) keys.push(`${k}_${d.k === 'num' ? d.v : d.k === 'str' ? d.v : '1'}`) }
        const o = a[1] ? value(a[1]) : null
        out.indexes.push({ schema: m[1], keys, unique: o?.k === 'obj' && bool(o.pairs.get('unique')) === true, name: o?.k === 'obj' && o.pairs.has('name') ? str(o.pairs.get('name')) : null, line: lineOf(n) })
      }
    }
    for (let cs = n.namedChildren, i = cs.length - 1; i >= 0; i--) stack.push(cs[i])
  }
  const names = new Set(schemaNodes.map(([n]) => n))
  for (const [name, nw] of schemaNodes.slice(0, MAX.schemas)) {
    const a = argsOf(nw)
    const s = { name, line: lineOf(nw), fields: [], part: false, collection: null, timestamps: false, id: true }
    if (a[0]) readDefinition(a[0], '', names, s)
    const o = a[1] ? value(a[1]) : null
    if (o?.k === 'obj') {
      if (o.pairs.has('collection')) s.collection = str(o.pairs.get('collection'))
      const t = o.pairs.get('timestamps'); if (t && (value(t).k === 'true' || value(t).k === 'obj')) s.timestamps = true
      if (bool(o.pairs.get('_id')) === false) s.id = false
    }
    out.schemas.push(s)
  }
  // each sub-document's paths under the field holding it (three levels at most)
  const byName = new Map(out.schemas.map((s) => [s.name, s]))
  const expand = (fields, depth) => fields.flatMap((f) => {
    const s = f.sub && byName.get(f.sub.name)
    if (!s || depth > 3) return [f]
    const prefix = `${f.path}${f.sub.list ? '[]' : ''}`
    return [{ ...f, sub: undefined }, ...expand(s.fields.map((x) => ({ ...x, path: `${prefix}.${x.path}`, line: f.line })), depth + 1)]
  })
  for (const s of out.schemas) s.fields = expand(s.fields, 0).slice(0, MAX.fields)
  return out
}

export default {
  id: 'mongoose',
  version: 2,
  kind: 'code',
  scope: 'unit',
  tree: true,
  wants: (p) => SRC.test(p) && !DTS.test(p),
  level: (p, text) => mongooseLevel(p, text),
  parses: (p, text) => mongooseLevel(p, text) > 0,
  discover(info) {
    const files = [...info].filter(([p, i]) => SRC.test(p) && i.ddl & 262144).map(([p]) => p).sort()
    return files.length ? [{ key: common(files), inputs: files }] : []
  },
  parse(text, file, ctx) {
    const tree = ctx.tree(langOf(file), text)
    try { return readFile(tree.rootNode, file) } finally { tree.delete?.() }
  },
  extract({ key, files }, ctx) {
    const notes = []
    const note = (s) => { if (notes.length < MAX.notes) notes.push(s) }
    const parsed = files.map((f) => ({ path: f.path, ...(ctx.aside ? ctx.aside('mongoose', f.path, f.text) : this.parse(f.text, f.path, ctx)) }))
    // every model, by name → its collection (and the schema it is built from)
    const models = new Map()
    for (const f of parsed) {
      for (const l of f.errors) note(`${f.path}:${l}: does not parse here; what parsed is kept`)
      for (const m of f.models) {
        const s = f.schemas.find((x) => x.name === m.schema)
        if (!s) { note(`${f.path}:${m.line}: model ${m.name}'s schema is not one this file builds: not read`); continue }
        if (!models.has(m.name)) models.set(m.name, { ...m, s, path: f.path, collection: m.collection || s.collection || collectionOf(m.name) })
      }
    }
    const used = new Set([...models.values()].map((m) => m.s))
    for (const f of parsed) for (const s of f.schemas) if (!used.has(s) && s.name) note(`${f.path}:${s.line}: schema ${s.name} has no model built from it here (a sub-document): not a collection`)
    const entities = []
    let refs = 0
    for (const m of models.values()) {
      const s = m.s
      const at = (line) => ({ path: m.path, line })
      const e = { name: m.collection, kind: 'collection', ...at(s.line), as: `model ${m.name}`, fields: [], keys: [], indexes: [], relations: [], ...(s.part ? { part: true } : {}) }
      if (s.part) note(`${m.path}:${s.line}: schema ${s.name} is built in part by code (a spread, a computed key): stated in part`)
      if (s.id) { e.fields.push({ name: '_id', type: 'ObjectId', nullable: false, default: null, generated: null, ...at(s.line), unstated: ['type'] }); e.keys.push({ role: 'primary', parts: ['_id'], ...at(s.line) }) }
      for (const f of s.fields) {
        const x = { name: f.path, type: f.type || 'Mixed', nullable: !f.required, default: f.default, generated: null, ...at(f.line), unstated: ['type', ...(f.unstatedDefault ? ['default'] : [])] }
        e.fields.push(x)
        if (f.unique || f.index) e.indexes.push({ name: `${f.path}_1`, unique: !!f.unique, columns: [f.path], partial: false, ...at(f.line) })
        if (f.ref) {
          const t = models.get(f.ref)
          if (!t) { note(`${m.path}:${f.line}: ${m.name}.${f.path} refers to ${f.ref}, no model read here`); continue }
          e.relations.push({ columns: [f.path], to: t.collection, toColumns: ['_id'], onDelete: 'no action', onUpdate: 'no action', enforced: 'client', ...at(f.line) })
          refs++
        } else if (f.refCode) note(`${m.path}:${f.line}: ${m.name}.${f.path} refers to a model code names: not read`)
      }
      if (s.timestamps) for (const n of ['createdAt', 'updatedAt']) e.fields.push({ name: n, type: 'Date', nullable: true, default: null, generated: null, ...at(s.line), unstated: ['type'], computed: 'timestamps' })
      const f0 = parsed.find((f) => f.path === m.path)
      for (const i of f0.indexes.filter((x) => x.schema === s.name)) e.indexes.push({ name: i.name || i.keys.join('_'), unique: i.unique, columns: i.keys.map((k) => k.replace(/_-?\w+$/, '')), partial: false, ...at(i.line) })
      entities.push(e)
    }
    if (!entities.length) return { declarations: [] }
    return { declarations: [{
      store: key, dialect: 'mongodb', dialectFrom: { how: 'stated', path: files[0].path, line: 1 },
      source: { path: files[0].path, line: 1, kind: 'code', confidence: 'declared' },
      complete: false, partial: false, status: 'read',
      label: `Mongoose schemas, read ${counted(files.length, 'file')}: ${counted(entities.length, 'collection')}, ${counted(refs, 'reference')}`,
      notes, files: files.length, clients: ['mongoose'],
      entities,
    }] }
  },
}
