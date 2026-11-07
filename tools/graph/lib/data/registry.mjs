// grimoire graph · data · the extractors (spec D1) and how the index runs them (lib/indexer.mjs).
// An extractor names a format, never a project:
//   { id, version, kind: artifact | migration | infra | code | inferred, scope: file | unit,
//     wants(path): a file it may read (by path only: what the index stats and hashes),
//     discover(info, { overrides }): its jobs [{ key, inputs: [path], override?, salt? }] from the
//       candidate files (info: Map(path → { ddl }), ddl: what inspect() found),
//     extract(text, path, ctx) (scope file) | extract({ key, files: [{ path, text }], override }, ctx)
//       (scope unit) → facts: { declarations } (model.mjs) }
// ctx: { DatabaseSync (node:sqlite, for the SQL replay), yaml(text) → readers/yaml.mjs documents (the
// index's parser; for a base, its YAML parsed aside: data/base.mjs), absent where no YAML is read,
// tree(lang, text) → a tree-sitter tree (the extractors marked `tree`: the index's grammars), or, for a base,
// aside(id, path, text) → what that extractor reads of one file (its `parse`, else its file extract), read
// in a process of its own (readers/code-aside.mjs) }
// An extractor may also say: tree (it parses source through the pinned grammars), parses(path, text)
// (whether it parses this file so: its level > 0 when absent), config(path) (a file it reads as
// configuration, kept whatever its content: a drizzle.config.*, a prisma.config.*).
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
import serde from './extractors/serde.mjs'
import tsTypes from './extractors/ts-types.mjs'
import dynamoAccess from './extractors/dynamo-access.mjs'
import drizzleTs from './extractors/drizzle-ts.mjs'
import prisma from './extractors/prisma.mjs'
import sqlQueries from './extractors/sql-queries.mjs'
import { DOC } from './readers/documents.mjs'
import { tableLevel } from './readers/dynamodb.mjs'
import { skipped } from '../project.mjs'

export const EXTRACTORS = [sqlMigrations, drizzleSnapshot, dynamodbTable, cloudformation, terraform, serde, tsTypes, dynamoAccess, drizzleTs, prisma, sqlQueries]
// the code and inferred extractors: their files are source (code, or a schema language), inspected by level
export const SOURCE = EXTRACTORS.filter((ex) => ex.kind === 'code' || ex.kind === 'inferred')
// those parsing source through the pinned grammars (ctx.tree), and the ones of them a base reads
// aside (readers/code-aside.mjs; a base does not compare access patterns)
export const TREE = EXTRACTORS.filter((ex) => ex.tree)
export const ASIDE = TREE.filter((ex) => ex.kind === 'code')
// the extractors a base parses this text with, aside
export const asideOf = (p, text) => ASIDE.filter((ex) => ex.wants(p) && (ex.parses ? ex.parses(p, text) : ex.level(p, text) > 0))
// A source file's level, bits: 1 what the item binding reads (its code extractor's level), 2 a
// key-value SDK call shape (extractors/dynamo-access.mjs), 4 a table-builder schema and 8 a barrel
// re-exporting relative modules (extractors/drizzle-ts.mjs), 16 a model, view or enum block and 32 a
// datasource block of a schema-language file (extractors/prisma.mjs), 64 a query call beside SQL text,
// or a SQL client import (extractors/sql-queries.mjs).
export const sourceLevel = (p, text) => { let l = 0; for (const ex of SOURCE) if (ex.wants(p)) l |= ex.level(p, text); return l }
const isSource = (p) => SOURCE.some((ex) => ex.wants(p))
export const MAX_BYTES = 8 << 20 // an input past this is not read (its job reports it)
export const idOf = (ex) => `${ex.id}@${ex.version}`

// Test-support folders hold fixtures, not the project's stores. Only folders: a migration named
// `0007_tests.sql` creates a table, so test file-name patterns do not apply here.
const TEST_DIRS = /(^|\/)(tests?|__tests__|spec|specs|testing|__mocks__|mocks?|__fixtures__|fixtures?)\//

// The files any extractor may read, from a repository's file list.
export const candidates = (rels, project) => rels.filter((p) => EXTRACTORS.some((ex) => ex.wants(p)) && !TEST_DIRS.test(p) && !skipped(p, project))

// What the index keeps about an input's content beside its hash, so discovery goes by content: for
// SQL, its schemaLevel (3: a schema dump's header over a table, 2: it creates or alters a table or
// an index, 1: other schema statements only, 0: none); for JSON and YAML, its tableLevel (3: it names a table resource of a template, 2:
// it holds a key schema, a CreateTable input; 0: neither); for Terraform and Terragrunt files
// (.tf, .tfvars, .tfvars.json, .hcl), extractors/terraform.mjs tfLevel (4: a module declaring a
// table resource, 5: a terragrunt.hcl Terragrunt runs, 6: a module out of reach, 1: other); for a
// source file (.rs, .ts, .js, .py, .go, .prisma), sourceLevel's bits (1: what the item binding reads:
// a serde derive, a type declaration, a conversion, an environment read, a string constant; 2: a
// key-value SDK call shape; 4, 8: a table-builder schema, a barrel; 16, 32: a schema-language file's
// models, its datasource; 64: a query call beside SQL text, a SQL client import; 0: none). A change to
// what this computes moves the store's SCHEMA_VERSION, so no
// stale level survives in an index.
export const inspect = (p, text) => (/\.sql$/i.test(p) ? schemaLevel(upOnly(text)) : wantsTf(p) ? tfLevel(p, text) : DOC.test(p) ? tableLevel(text) : isSource(p) ? sourceLevel(p, text) : null)
// A text worth keeping once inspected (an extractor may read it): every JSON and YAML file is a
// candidate, but one only the table extractors want and that declares no table is never read again,
// so the index and a base keep no copy of it; nor is a source file with nothing for the binding or
// the access patterns or a schema. A configuration an extractor reads is always kept (a base reads
// it too: a drizzle.config.ts holds no level of its own).
const TABLE_EXTRACTORS = new Set([dynamodbTable, cloudformation])
const isConfig = (p) => EXTRACTORS.some((ex) => ex.config?.(p))
export const keeps = (p, text) => isConfig(p) || (isSource(p) ? sourceLevel(p, text) > 0 : !DOC.test(p) || tableLevel(text) > 0 || EXTRACTORS.some((ex) => !TABLE_EXTRACTORS.has(ex) && ex.wants(p)))
// A job reads YAML (its context needs ctx.yaml): one of its inputs is a YAML file, or a .template
// that is not JSON (the extractors decide by the text: readers/documents.mjs).
export const readsYaml = (job) => job.inputs.some((p) => /\.(?:ya?ml|template)$/i.test(p))
// A job parses source code (its context needs ctx.tree(lang, text) → a tree-sitter tree).
export const readsCode = (job) => !!job.extractor.tree

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
