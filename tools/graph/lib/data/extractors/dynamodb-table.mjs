// grimoire graph · data · extractor: DynamoDB CreateTable inputs, the request a table is created with
// (`aws dynamodb create-table --cli-input-json` or `--cli-input-yaml`, and the local-dev table files
// written in its shape), JSON or YAML. Per file.
//
// Found by content, not by name: a .json, .yaml, .yml or .template file holding a KeySchema and
// AttributeDefinitions (readers/dynamodb.mjs tableLevel) and no table resource of a template (those
// are extractors/cloudformation.mjs's). In it, a table is an object with a KeySchema and a TableName:
// the document itself, each item of a list of them, or the one a `Table` or `TableDescription`
// member holds (describe-table's and create-table's answers). A key schema with no TableName is
// noted, not read. readers/dynamodb.mjs reads each table; references stay unresolved.
//
// The store is the repository's key-value tables, `dynamodb`, wherever each is declared: two files
// stating the same TableName are two declarations of one table, and their disagreements are its
// conflicts. A file does not describe the whole store (a table it lacks is no disagreement), but it
// describes each table it states whole (`whole`), unless a part of it is a reference.
import { DOC, documents, at as lineIn } from '../readers/documents.mjs'
import { LEVEL, readTable, isObj, isRef, textOf } from '../readers/dynamodb.mjs'

export const STORE = 'dynamodb'
const isInput = (x) => isObj(x) && 'KeySchema' in x && ('TableName' in x || 'AttributeDefinitions' in x)

// the tables of one document: [[table, path]]
function tablesIn(v) {
  if (Array.isArray(v)) return v.map((x, i) => [x, [i]]).filter(([x]) => isInput(x))
  if (!isObj(v)) return []
  if (isInput(v)) return [[v, []]]
  for (const w of ['Table', 'TableDescription']) if (isInput(v[w])) return [[v[w], [w]]]
  return []
}

export default {
  id: 'dynamodb-table',
  version: 1,
  kind: 'infra',
  scope: 'file',
  wants: (p) => DOC.test(p),
  discover: (info) => [...info].filter(([p, i]) => DOC.test(p) && i.ddl === LEVEL.schema).map(([p]) => ({ key: p, inputs: [p] })),
  extract(text, file, ctx) {
    const notes = [], entities = []
    for (const doc of documents(text, file, ctx)) {
      for (const [t, path] of tablesIn(doc.value)) {
        if (t.TableName === undefined || t.TableName === null) { notes.push(`a key schema with no TableName at line ${lineIn(doc, ...path, 'KeySchema').line}: not read`); continue }
        const name = isRef(t.TableName) ? textOf(t.TableName) : String(t.TableName)
        const r = readTable(t, { name, at: (...p) => ({ path: file, line: lineIn(doc, ...path, ...(p.length ? p : ['TableName'])).line }) })
        entities.push(r.entity)
        if (isRef(t.TableName)) notes.push(`${name}: its TableName is a reference, not resolved`)
        notes.push(...r.notes)
      }
    }
    if (!entities.length) return { declarations: [] }
    return { declarations: [{
      store: STORE, dialect: 'dynamodb', dialectFrom: null,
      source: { path: file, line: entities[0].line ?? 1, kind: 'infra', confidence: 'declared' },
      complete: false, partial: false, status: 'read',
      label: `CreateTable input${entities.length > 1 ? `, ${entities.length} tables` : ''}`,
      notes, entities,
    }] }
  },
}
