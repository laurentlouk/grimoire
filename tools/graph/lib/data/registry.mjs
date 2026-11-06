// grimoire graph · data · the extractors (spec D1) and how the index runs them (lib/indexer.mjs).
// An extractor names a format, never a project:
//   { id, version, kind: artifact | migration | infra | code | inferred, scope: file | unit,
//     wants(path): a file it may read (by path only: what the index stats and hashes),
//     discover(info, { overrides }): its jobs [{ key, inputs: [path], override?, salt? }] from the
//       candidate files (info: Map(path → { ddl }), ddl: what inspect() found),
//     extract(text, path, ctx) (scope file) | extract({ key, files: [{ path, text }], override }, ctx)
//       (scope unit) → facts: { declarations } (model.mjs) }
// A job runs again when the hash of any input, the extractor's version or its salt changes. One
// that throws loses its facts and leaves its error for graph_status; the index goes on.
import { schemaLevel } from './readers/sql-split.mjs'
import sqlMigrations, { upOnly } from './extractors/sql-migrations.mjs'
import drizzleSnapshot from './extractors/drizzle-snapshot.mjs'
import { skipped } from '../project.mjs'

export const EXTRACTORS = [sqlMigrations, drizzleSnapshot]
export const MAX_BYTES = 8 << 20 // an input past this is not read (its job reports it)
export const idOf = (ex) => `${ex.id}@${ex.version}`

// Test-support folders hold fixtures, not the project's stores. Only folders: a migration named
// `0007_tests.sql` creates a table, so test file-name patterns do not apply here.
const TEST_DIRS = /(^|\/)(tests?|__tests__|spec|specs|testing|__mocks__|mocks?|__fixtures__|fixtures?)\//

// The files any extractor may read, from a repository's file list.
export const candidates = (rels, project) => rels.filter((p) => EXTRACTORS.some((ex) => ex.wants(p)) && !TEST_DIRS.test(p) && !skipped(p, project))

// What the index keeps about an input's content beside its hash: for SQL, its schemaLevel (2: it
// creates or alters a table or an index, 1: other schema statements only, 0: none). A change to
// what this computes moves the store's SCHEMA_VERSION, so no stale level survives in an index.
export const inspect = (p, text) => (/\.sql$/i.test(p) ? schemaLevel(upOnly(text)) : null)

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
