// grimoire graph · data · the extractors (spec D1) and how the index runs them (lib/indexer.mjs).
// An extractor names a format, never a project:
//   { id, version, kind: artifact | migration | infra | code | inferred, scope: file | unit,
//     wants(path): a file it may read (by path only: what the index stats and hashes),
//     discover(info, { overrides }): its jobs [{ key, inputs: [path], override?, salt? }] from the
//       candidate files (info: Map(path → { ddl }), ddl: what inspect() found),
//     extract(text, path, ctx) (scope file) | extract({ key, files: [{ path, text }], override }, ctx)
//       (scope unit) → facts: { declarations } (model.mjs) }
// ctx: { DatabaseSync (node:sqlite, for the SQL replay), yaml(text) → readers/yaml.mjs documents (the
// index's parser; for a base, its YAML parsed aside: data/base.mjs), absent where no YAML is read }
// A job runs again when the hash of any input, the extractor's version or its salt changes. One
// that throws loses its facts and leaves its error for graph_status; the index goes on. The text
// comes from the working tree (the index) or from a commit (extractAll, for the base of a diff):
// one discovery and one set of extractors for both.
import { schemaLevel } from './readers/sql-split.mjs'
import sqlMigrations, { upOnly } from './extractors/sql-migrations.mjs'
import drizzleSnapshot from './extractors/drizzle-snapshot.mjs'
import dynamodbTable from './extractors/dynamodb-table.mjs'
import cloudformation from './extractors/cloudformation.mjs'
import terraform, { wantsTf, tfLevel } from './extractors/terraform.mjs'
import { DOC } from './readers/documents.mjs'
import { tableLevel } from './readers/dynamodb.mjs'
import { skipped } from '../project.mjs'

export const EXTRACTORS = [sqlMigrations, drizzleSnapshot, dynamodbTable, cloudformation, terraform]
export const MAX_BYTES = 8 << 20 // an input past this is not read (its job reports it)
export const idOf = (ex) => `${ex.id}@${ex.version}`

// Test-support folders hold fixtures, not the project's stores. Only folders: a migration named
// `0007_tests.sql` creates a table, so test file-name patterns do not apply here.
const TEST_DIRS = /(^|\/)(tests?|__tests__|spec|specs|testing|__mocks__|mocks?|__fixtures__|fixtures?)\//

// The files any extractor may read, from a repository's file list.
export const candidates = (rels, project) => rels.filter((p) => EXTRACTORS.some((ex) => ex.wants(p)) && !TEST_DIRS.test(p) && !skipped(p, project))

// What the index keeps about an input's content beside its hash, so discovery goes by content: for
// SQL, its schemaLevel (2: it creates or alters a table or an index, 1: other schema statements
// only, 0: none); for JSON and YAML, its tableLevel (3: it names a table resource of a template, 2:
// it holds a key schema, a CreateTable input; 0: neither); for Terraform and Terragrunt files
// (.tf, .tfvars, .tfvars.json, .hcl), extractors/terraform.mjs tfLevel (4: a module declaring a
// table resource, 5: a terragrunt.hcl Terragrunt runs, 6: a module out of reach, 1: other). A change
// to what this computes moves the store's SCHEMA_VERSION, so no stale level survives in an index.
export const inspect = (p, text) => (/\.sql$/i.test(p) ? schemaLevel(upOnly(text)) : wantsTf(p) ? tfLevel(p, text) : DOC.test(p) ? tableLevel(text) : null)
// A text worth keeping once inspected (an extractor may read it): every JSON and YAML file is a
// candidate, but one only the table extractors want and that declares no table is never read again,
// so the index and a base keep no copy of it.
const TABLE_EXTRACTORS = new Set([dynamodbTable, cloudformation])
export const keeps = (p, text) => !DOC.test(p) || tableLevel(text) > 0 || EXTRACTORS.some((ex) => !TABLE_EXTRACTORS.has(ex) && ex.wants(p))
// A job reads YAML (its context needs ctx.yaml): one of its inputs is a YAML file, or a .template
// that is not JSON (the extractors decide by the text: readers/documents.mjs).
export const readsYaml = (job) => job.inputs.some((p) => /\.(?:ya?ml|template)$/i.test(p))

export const plan = (info, opts = {}) => EXTRACTORS.flatMap((ex) => ex.discover(info, opts).map((job) => ({ ...job, extractor: ex })))

// One job, never throwing: { facts } or { error }. read(path) → its text.
export function run(job, read, ctx) {
  const ex = job.extractor
  try {
    if (ex.scope === 'file') return { facts: ex.extract(read(job.key), job.key, ctx) }
    return { facts: ex.extract({ key: job.key, files: job.inputs.map((p) => ({ path: p, text: read(p) })), override: job.override ?? null }, ctx) }
  } catch (e) {
    return { error: String(e?.message || e).split('\n')[0].slice(0, 240) }
  }
}

// Every job of one repository at once, from whatever holds its files' text: the same candidates,
// inspection, discovery and extractors the index runs (lib/indexer.mjs, incrementally there), with
// the same size cap. The model at a git ref (data/base.mjs) reads its files through this.
//   source { paths: the repository's files, size(path) → bytes, read(path) → its text }
//   overrides  graph.data.migrations entries for this repository
//   → [{ extractor: 'id@version', scope, key, facts } | { extractor, scope, key, error }]
export function extractAll(source, project, overrides, ctx) {
  const info = new Map()
  for (const p of candidates(source.paths, project)) {
    const size = source.size(p)
    let ddl = null
    if (size <= MAX_BYTES) { try { ddl = inspect(p, source.read(p)) } catch { continue } }
    info.set(p, { size, ddl })
  }
  const read = (p) => { if (info.get(p)?.size > MAX_BYTES) throw new Error(`${p} is larger than ${MAX_BYTES >> 20} MB: not read`); return source.read(p) }
  return plan(info, { overrides }).map((job) => ({ extractor: idOf(job.extractor), scope: job.extractor.scope, key: job.key, ...run(job, read, ctx) }))
}
