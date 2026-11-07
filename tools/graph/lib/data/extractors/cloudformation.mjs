// grimoire graph · data · extractor: the table resources of infrastructure templates: CloudFormation
// and SAM (a top-level `Resources`), and the Serverless Framework (`resources.Resources`, or a list
// of such objects), JSON or YAML, CloudFormation's short-form tags included. Per file.
//
// Found by content, not by name: a .json, .yaml, .yml or .template file that names a table resource
// type (readers/dynamodb.mjs tableLevel): AWS::DynamoDB::Table, AWS::DynamoDB::GlobalTable,
// AWS::Serverless::SimpleTable. Every other resource is left alone, and so is everything outside
// `Resources` (parameters, conditions, outputs: only what lands in a table's model is kept).
// readers/dynamodb.mjs reads each table's Properties; intrinsic functions (`!Ref`, `!Sub`,
// `!GetAtt`, `{ "Fn::If": … }`…) and `${…}` variables stay unresolved references, never evaluated.
//
// A table is named by its TableName when that is a literal, so a template and a CreateTable input
// stating the same TableName are two declarations of one table (extractors/dynamodb-table.mjs).
// When TableName is a reference, or absent (CloudFormation then names the table at deploy), the
// table is named by its logical id, and its name expression is kept on its `as` and in the notes:
// binding a name template to the names other declarations state is not done here.
//
// The environment a template's functions are given, where a variable names one of its tables
// (`ORDERS_TABLE: !Ref OrdersTable`), is kept on the declaration as `env`, for the item binding
// (data/binding.mjs; `wiring` below says where it is read). No other variable is kept.
import { DOC, documents, at as lineIn } from '../readers/documents.mjs'
import { LEVEL, TABLE_TYPES, readTable, isObj, isRef, textOf, capNotes, NOTES, fnOf } from '../readers/dynamodb.mjs'
import { tagOf } from '../readers/yaml.mjs'
import { STORE } from './dynamodb-table.mjs'

// a document's resource maps: [[resources, path]]
function resourcesOf(v) {
  const out = []
  if (!isObj(v)) return out
  if (isObj(v.Resources)) out.push([v.Resources, ['Resources']])
  const r = v.resources
  if (isObj(r) && isObj(r.Resources)) out.push([r.Resources, ['resources', 'Resources']])
  if (Array.isArray(r)) r.forEach((x, i) => { if (isObj(x) && isObj(x.Resources)) out.push([x.Resources, ['resources', i, 'Resources']]) })
  return out
}
// what kind of template a document is, in words
function kindOf(v, types) {
  if (isObj(v) && 'service' in v && 'resources' in v) return 'Serverless Framework resources'
  const tr = isObj(v) ? v.Transform : null
  const transforms = Array.isArray(tr) ? tr : [tr]
  if (transforms.some((t) => typeof t === 'string' && t.startsWith('AWS::Serverless')) || types.some((t) => t.startsWith('AWS::Serverless::'))) return 'SAM template'
  return 'CloudFormation template'
}

export default {
  id: 'cloudformation',
  version: 2,
  kind: 'infra',
  scope: 'file',
  wants: (p) => DOC.test(p),
  discover: (info) => [...info].filter(([p, i]) => DOC.test(p) && i.ddl === LEVEL.template).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    const notes = [], entities = [], kinds = [], env = []
    for (const doc of documents(text, file, ctx)) {
      const types = []
      const byId = new Map() // a table resource's logical id → its entity's name
      for (const [resources, rpath] of resourcesOf(doc.value)) {
        for (const id of Object.keys(resources)) {
          const res = resources[id]
          if (!isObj(res) || typeof res.Type !== 'string' || !TABLE_TYPES.includes(res.Type)) continue
          types.push(res.Type)
          const props = res.Properties === undefined || res.Properties === null ? {} : res.Properties
          const base = [...rpath, id, 'Properties']
          const tn = isObj(props) ? props.TableName : undefined
          const literal = typeof tn === 'string' && !isRef(tn)
          const name = literal ? tn : id
          const as = `${id} (${res.Type})${literal || tn === undefined || tn === null ? '' : `, TableName ${textOf(tn)}`}`
          const own = lineIn(doc, ...rpath, id).line
          const at = (...p) => ({ path: file, line: p.length ? lineIn(doc, ...base, ...p).line : own })
          byId.set(id, name)
          if (!isObj(props) || isRef(props)) {
            notes.push(`${id}: its Properties are ${textOf(props)}, a reference, not resolved`)
            entities.push({ name, kind: 'table', billing: null, stream: null, whole: false, as, ...at(), fields: [], keys: [], indexes: [], relations: [] })
            continue
          }
          const r = readTable(props, { name, label: id, at, simple: res.Type === 'AWS::Serverless::SimpleTable', extra: { as } })
          if (tn === undefined || tn === null) r.notes.unshift(`${id}: no TableName (the table is named at deploy): named by its logical id`)
          else if (!literal) r.notes.unshift(`${id}: its TableName is ${textOf(tn)}, a reference, not resolved: named by its logical id`)
          entities.push(r.entity)
          notes.push(...r.notes)
        }
      }
      if (types.length) kinds.push(kindOf(doc.value, types))
      env.push(...wiring(doc, byId, new Set(entities.map((e) => e.name)), file))
    }
    if (!entities.length) return { declarations: [] }
    const kind = [...new Set(kinds)].join(' and ')
    return { declarations: [{
      store: STORE, dialect: 'dynamodb', dialectFrom: null,
      source: { path: file, line: entities[0].line ?? 1, kind: 'infra', confidence: 'declared' },
      complete: false, partial: false, status: 'read',
      label: `${kind}, ${entities.length} table${entities.length === 1 ? '' : 's'}`,
      notes: capNotes(notes, 4 * NOTES), entities,
      ...(env.length ? { env: env.slice(0, 200) } : {}),
    }] }
  },
}

// The environment variables a template sets to one of its tables, for the item binding
// (data/binding.mjs): [{ name, table, path, line }]. Read from each function's
// Properties.Environment.Variables (AWS::Lambda::Function, AWS::Serverless::Function), SAM's
// Globals.Function, and the Serverless Framework's provider.environment and functions.*.environment.
// A value names a table when it is `!Ref` (or `{ Ref }`) to a table resource of the document, or a
// literal equal to a table's name. Only those variables are kept: no other variable, by name or value.
const FUNCTION_TYPES = new Set(['AWS::Lambda::Function', 'AWS::Serverless::Function'])
function wiring(doc, byId, names, file) {
  const out = []
  const v = doc.value
  if (!isObj(v)) return out
  const maps = [] // [vars, path]
  for (const [resources, rpath] of resourcesOf(v)) {
    for (const id of Object.keys(resources)) {
      const r = resources[id]
      if (isObj(r) && FUNCTION_TYPES.has(r.Type) && isObj(r.Properties) && isObj(r.Properties.Environment) && isObj(r.Properties.Environment.Variables)) maps.push([r.Properties.Environment.Variables, [...rpath, id, 'Properties', 'Environment', 'Variables']])
    }
  }
  const g = isObj(v.Globals) && isObj(v.Globals.Function) && isObj(v.Globals.Function.Environment) ? v.Globals.Function.Environment.Variables : null
  if (isObj(g)) maps.push([g, ['Globals', 'Function', 'Environment', 'Variables']])
  if (isObj(v.provider) && isObj(v.provider.environment)) maps.push([v.provider.environment, ['provider', 'environment']])
  if (isObj(v.functions)) for (const f of Object.keys(v.functions)) if (isObj(v.functions[f]) && isObj(v.functions[f].environment)) maps.push([v.functions[f].environment, ['functions', f, 'environment']])
  for (const [vars, path] of maps) {
    for (const k of Object.keys(vars)) {
      const x = vars[k]
      const ref = fnOf(x) === 'Ref' ? (tagOf(x) ? x.value : x.Ref) : null
      const table = typeof ref === 'string' && byId.has(ref) ? byId.get(ref) : typeof x === 'string' && !isRef(x) && names.has(x) ? x : null
      if (table) out.push({ name: k, table, path: file, line: lineIn(doc, ...path, k).line })
    }
  }
  return out
}
