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
import { DOC, documents, at as lineIn } from '../readers/documents.mjs'
import { LEVEL, TABLE_TYPES, readTable, isObj, isRef, textOf, capNotes, NOTES } from '../readers/dynamodb.mjs'
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
  version: 1,
  kind: 'infra',
  scope: 'file',
  wants: (p) => DOC.test(p),
  discover: (info) => [...info].filter(([p, i]) => DOC.test(p) && i.ddl === LEVEL.template).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    const notes = [], entities = [], kinds = []
    for (const doc of documents(text, file, ctx)) {
      const types = []
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
    }
    if (!entities.length) return { declarations: [] }
    const kind = [...new Set(kinds)].join(' and ')
    return { declarations: [{
      store: STORE, dialect: 'dynamodb', dialectFrom: null,
      source: { path: file, line: entities[0].line ?? 1, kind: 'infra', confidence: 'declared' },
      complete: false, partial: false, status: 'read',
      label: `${kind}, ${entities.length} table${entities.length === 1 ? '' : 's'}`,
      notes: capNotes(notes, 4 * NOTES), entities,
    }] }
  },
}
