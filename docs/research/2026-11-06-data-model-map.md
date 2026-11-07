# Data model map: how to read any datastore's model from code and infra

Research input for a data-model map beside the code graph and the architecture diagrams, meant to feed `/roast`. Nothing here is decided.

> **Policy.** Code and infra are the source of truth; documentation helps discovery and planning, never decides. No third-party tool is adopted as a dependency: permissive code or the principle may be copied and adapted, with attribution in the files that borrow it. Everything runs in Node (≥ 22.5, the graph's floor), on the pinned parser runtime the graph already installs.

**Probed on 2026-11-06:** a real multi-repository project (anonymised; *the probed project* below): `backend` (Rust, DynamoDB, Redis/RediSearch), `infra` (Terraform + Terragrunt), `app` (Expo, Drizzle on expo-sqlite), `webapp` (Redis), plus `legacy-api` (Amplify Gen 1 GraphQL `@model`) and `backoffice` (Drizzle on better-sqlite3). Commands and scripts are in *Probes*.

---

## TL;DR

1. **No mature project does this.** Liam ERD (Apache-2.0) is static and diffs, but is SQL only, with no IaC. Azimutt (MIT) models NoSQL only by sampling a live database. tbls (MIT) reads DynamoDB and Mongo only live. **Nobody joins an IaC key schema with a code item shape statically.** Grimoire builds it, borrowing Liam's keyed model and JSON-patch diff, Azimutt's nested attributes and provenance, tbls's virtual relations and typeshare's serde rules (§4).
2. **The bottleneck has an answer per store, in six kinds of source** (§5): a generated *artifact*, *migrations* replayed, *infra*, the *code model*, *inferred* access patterns, *observed* samples, in that order of trust. Every fact keeps its source and line; where sources disagree, the disagreement is the finding.
3. **SQL is the easy half.**
   - For SQLite (the probed app's device database, libSQL, D1), replaying migrations into `node:sqlite` is exact and needs no parser: 25 Drizzle migrations gave the snapshot's 23 tables, 7 FKs and 34 indexes (§2).
   - Drizzle and MikroORM snapshots are plain JSON.
   - Postgres and MySQL DDL need a small interpreter for about 12 statement kinds.
4. **NoSQL is a four-part join** (§5):
   - key schema from infra;
   - item shape from code (a mapper, or a language type such as a serde struct);
   - a binding between them (mapper, env var, name template, call site);
   - access patterns from the SDK calls.
   
   In the probed project the binding is a naming convention (`<stage>-acme-<table>` ↔ `${env}-${project}-${key}`), and the access patterns already flag 8 prod GSIs with no `index_name("…")` call (§1).
5. **Drift is the norm** (§1): the probed project's local-dev table JSON declares two GSIs prod dropped (a past ticket), names tables differently, and lacks six prod tables.
6. **The parser runtime lacks SQL, HCL, GraphQL and Prisma grammars** (§3): hand readers for the declarative subsets (as `lib/md.mjs` did for Markdown), or vendored WASMs.
7. **Candidate shape** (§6), mirroring the architecture diagrams: the script extracts and reconciles inside `graph_index`; an agent refines what no file declares into a checked file; three diffs (ref vs ref, source vs source, proposal vs current); a *Data* tab; `graph_data` tools; fresh after every commit through the existing hook.

---

## 1. What one real project looks like

One logical entity, *an event*, is declared in six places across four repositories, and they do not all agree.

| Where | What it says | Kind |
| --- | --- | --- |
| `infra/live/prod/dynamodb/terragrunt.hcl:42` | table `event`, hash key `id`, one GSI `ByOwnerIndex`, stream off (a past ticket) | infra (prod) |
| `infra/modules/dynamodb/main.tf:1` | `for_each` over that map; name `"${env}-${project}-${key}"`, every key attribute typed `S`, TTL on `_ttl` | infra (module) |
| `backend/local/tables/events.json` | table `Events`, GSIs `ByOwnerIndex`, `ByTitleIndex`, `ByTitleFullIndex` | infra (local dev) |
| `backend/core/src/model/event.rs:97` | `struct Event`: ~25 serde fields, nested `Location`, `Photo`, `Vec<Session>`, `#[skip_store]` on one | code (item shape) |
| `backend/core/src/search/index.rs` | a RediSearch index built from `PublicEvent`, its schema assembled in code (`FT.CREATE` / `FT.ALTER`, `TAG`, `GEO`) | code (secondary store) |
| `app/db/schema.ts:110` · `drizzle/0000…0024.sql` · `drizzle/meta/0024_snapshot.json` | SQLite table `events` on the device, 25 migrations | code + migration + generated snapshot |

What that shows:

- **Divergence is the norm, and it is the valuable part.** The local-dev JSON still declares `ByTitleIndex` and `ByTitleFullIndex`; prod dropped `ByTitleFullIndex` (a past ticket: "dead ALL-projection GSI, zero Rust references") and never had `ByTitleIndex`. Table names differ too (`Events`, `members`, `tickets`, `comments` locally; `event`, `member`, `ticket`, `comment` in prod), and prod has tables the local JSON lacks (`payments`, `plans`, `audit_log`, `app_versions`, `notification_queue`, `reaction`).
- **For DynamoDB, the key schema and the item shape live apart.** Infra declares only key attributes, GSIs, TTL and streams. The item's shape is a Rust struct. Nothing in either file says the struct belongs to the table: the code binds them at runtime through a table name it formats (`format!("{:}-acme-trending_events", stage)`), which matches the Terraform convention `${env}-${project}-${key}` (55 uses of `-acme-event_participants`, 43 of `-acme-event`, … in the backend).
- **Access patterns are in the code, and they reveal waste.** The backend names GSIs in `index_name("…")` calls. Prod declares eight GSIs with no such call: `ByAuthorCreatedIndex`, `ByEmailIndex`, `ByHandleIndex`, `ByPaymentIndex`, `ByReporterIndex`, `ByStatusCreatedIndex`, `ByTargetIndex`, `ByTrackIndex`. These are leads, not proof: `ByFlagIndex` is reached through a constant, and another repository or a Lambda may query the rest. A past ticket removed exactly such an index for its write amplification.
- **Some schemas exist only as code that builds them.** The RediSearch index is assembled by functions (`FieldKind::schema_args`), so a static reader gets the field list only by reading the code, which is the refinement step's job, not the extractor's.
- **The same entity crosses stores.** The device's SQLite `events` table mirrors the backend's DynamoDB `event`. That lineage is the map's most useful line and the one no file declares.

## 2. SQL: replaying migrations is exact and needs no parser (SQLite)

`node:sqlite` (already the graph's store) can replay a migration folder into `:memory:` and read the result back with `PRAGMA table_info`, `foreign_key_list` and `index_list`. On `app/drizzle` (split on Drizzle's `--> statement-breakpoint`):

> 25 migrations → 23 tables, 7 foreign keys, 34 indexes. Columns, types, `NOT NULL` and primary keys match `drizzle/meta/0024_snapshot.json` table for table. The only differences came from the comparison script: the snapshot keeps composite primary keys apart (`compositePrimaryKeys`), and PRAGMA marks each column.

So, for SQLite, three representations exist and can be checked against each other for free:

| | Says | Drift it reveals |
| --- | --- | --- |
| `db/schema.ts` (Drizzle TS) | the intended model | ↔ latest snapshot: a schema edit nobody ran `drizzle-kit generate` for |
| `drizzle/meta/NNNN_snapshot.json` | the model as of migration NNNN, as JSON | ↔ replay: a hand-edited migration |
| `drizzle/*.sql` replayed | what a fresh database actually gets | the reference |

Not every project keeps migrations. `backoffice` uses Drizzle with no `drizzle/` folder at all (schema pushed, never generated): its only artifact is `src/db/schema.ts`, seven `sqliteTable("name", { col: text("col").notNull()… })` calls. That shape is declarative enough for a tree-sitter TypeScript walk (table name, column names and types, `notNull`, `primaryKey`, `references(() => t.id)`, `unique`, indexes in the third argument); a `$defaultFn(() => …)` is code and is recorded as a computed default, not evaluated.

The replay trick does not carry over to Postgres or MySQL DDL (SQLite accepts some of it, rejects much, and silently misreads types). Those need a DDL reader, or a generated artifact.

## 3. The parser runtime has no grammar for the declarative formats

The pinned `tree-sitter-wasms` set (`~/Library/Caches/grimoire/graph-deps/*/node_modules/tree-sitter-wasms/out/`) has JSON, YAML, TOML and every code language the graph indexes, but **no SQL, HCL, GraphQL or Prisma grammar**. `tools/graph/lib/langs.mjs:345` lists `.sql`, `.tf`, `.hcl`, `.graphql`, `.proto` as file-only nodes for that reason. Options: hand-written readers for the declarative subsets (grimoire already wrote its own Markdown parser, `lib/md.mjs`), or vendoring permissively licensed grammar WASMs into the pinned runtime.

## 4. Is there a mature project that already does this? No

Surveyed by a `reference-scout` on 2026-11-06. Stars and last push are from `gh repo view` that day; code was read in shallow clones.

| Project | License · stars · last push | Reads | NoSQL | Diff | Take |
| --- | --- | --- | --- | --- | --- |
| [liam-hq/liam](https://github.com/liam-hq/liam) | Apache-2.0 · 5.2k · 2026-11 | **Static files**: Postgres DDL (pg-query WASM), Prisma (DMMF), `schema.rb` (Prism WASM), Drizzle pg/mysql (SWC AST; no sqlite-core), tbls JSON | none | **yes**: `fast-json-patch compare(before, after)` → added / removed / modified per element, coloured on the ERD (`erd-core/src/features/diff`) | **The model to copy**: name-keyed records, JSON-patch diff |
| [k1LoW/tbls](https://github.com/k1LoW/tbls) | MIT · 4.4k · 2026-11 | Live DB; `json://`; external drivers printing `schema.json` | DynamoDB via `DescribeTable` (keys, indexes only); Mongo by `$sample` with per-field occurrence | DB vs generated Markdown, or DB vs DB | Principles: **virtual relations** for FK-less models, driver-emits-JSON protocol, lint and coverage |
| [azimuttapp/azimutt](https://github.com/azimuttapp/azimutt) | MIT · 2.2k · 2026-08 | Live (9 engines); static SQL (Postgres only), Prisma, DBML | Mongo, Couchbase by sampling (`libs/models/src/inferSchema.ts`) | `databaseDiff.ts` marked work in progress; CLI diff live vs live | **The NoSQL-capable shape**: recursive `attrs`, `extra.line` provenance, typed relation ends |
| [ariga/atlas](https://github.com/ariga/atlas) | Apache-2.0 · 8.8k | Live, HCL, SQL; ORM "providers" **run the ORM program** | none | `schema diff`; `migrate diff` needs a dev DB | Principle only (runs code, needs a DB) |
| [drizzle-kit](https://github.com/drizzle-team/drizzle-orm) | MIT · 36k | **Executes** the TS schema | none | snapshot JSON vs snapshot JSON, with rename prompts | Principle: snapshot diff, rename detection |
| [prisma](https://github.com/prisma/prisma) | Apache-2.0 · 47.7k | `schema.prisma` | Mongo, partly | `migrate diff --exit-code` (2 when different) | Principle: a CI exit code |
| [holistics/dbml](https://github.com/holistics/dbml) · [sqldef](https://github.com/sqldef/sqldef) | Apache-2.0 · MIT | DDL via ANTLR (5 dialects) · DDL files offline | none | none · DDL vs DDL | Dialect references for a DDL reader |
| [1Password/typeshare](https://github.com/1Password/typeshare) | Apache-2.0/MIT · 3.0k | **Static** `syn` parse of Rust, honouring serde `rename_all`, `flatten`, `default`, `tag`/`content` | item shape from Rust structs | n/a | **The only mature static reading of serde shapes**: port its rules to tree-sitter-rust |
| mongodb-schema (MongoDB, archived into devtools-shared) | Apache-2.0 | sampled documents | sampling only | none | Principle for an optional *observed* overlay |

Out: ChartDB and DrawDB (AGPL-3.0), SchemaSpy (LGPL-3.0), SchemaCrawler (live JDBC), Bytebase (proprietary parts, live), migra (deprecated), django-extensions / rails-erd / eralchemy (load the models at runtime), Hackolade (commercial; samples DynamoDB, no Terraform), AWS NoSQL Workbench (imports CloudFormation JSON; no public source found).

**What the survey settles.**

- No project covers code-first + SQL + NoSQL + IaC + visual + diff. Liam is static and diffs, but is SQL only, with no IaC. Azimutt models NoSQL, but only by sampling a live database, and its diff is unfinished. tbls reads DynamoDB and Mongo, but live only, and diffs Markdown.
- **The static join of an IaC key schema with a code item shape is unsolved in open source.** GitHub searches for "dynamodb erd", "nosql erd", "terraform erd", "redis schema visualizer" returned nothing alive (mongoose-erd repositories ≤ 29 stars, last push 2021). Terraform's own docs say `aws_dynamodb_table.attribute` must list only key attributes, so IaC can never give the item shape.
- Every mature tool that covers NoSQL samples a live database. That contradicts *code and infra are the source of truth*, so sampling can only ever be an optional, labelled overlay.
- **Worth copying** (Apache/MIT, notices kept): Liam's keyed model and JSON-patch diff; Azimutt's nested attributes and provenance; tbls's virtual relations; typeshare's serde rules; drizzle-kit's rename detection; sqldef and DBML grammars as DDL dialect references.
- **Not adopted**: anything that runs the user's code or needs a dev database (Atlas, drizzle-kit, ORM introspection), any live driver as the source, SWC / `@prisma/internals` / pg-query / elkjs as dependencies, AGPL and LGPL code.

## 5. How to get the model out of any datastore

Compiled by a research agent on 2026-11-06 from current docs and source (URLs in its sources list, kept below). Formats marked † were written from established knowledge, not re-fetched.

### Six kinds of source, in order of trust

| Kind | Example | Trust |
| --- | --- | --- |
| **artifact** (a generated, machine-readable final state) | Drizzle `meta/NNNN_snapshot.json`, MikroORM `.snapshot-*.json`, Rails `db/schema.rb`†, EF Core `*ModelSnapshot.cs`†, dbmate `db/schema.sql`†, Ent `ent/migrate/schema.go`, `firestore.indexes.json` | highest: the tool's own statement of the model |
| **migration** (replayed in order) | `*.sql` folders (Drizzle, Prisma, Flyway, golang-migrate, goose, dbmate, sqlx, Supabase, Diesel `up.sql`), Django operations†, Alembic `op.*`†, Liquibase changeSets† | exact for what a fresh database gets |
| **infra** | Terraform `aws_dynamodb_table`, CloudFormation / SAM / Serverless†, CDK†, SST, Pulumi†, raw `CreateTable` JSON, Elasticsearch mappings† | the deployed key schema, indexes, TTL, streams |
| **code model** | Drizzle `sqliteTable(…)`, `schema.prisma`, `@Entity`†, Mongoose†, GORM tags†, serde structs, ElectroDB / OneTable / Dynamoose, Convex `defineTable` | the intended shape; for NoSQL, the *only* item shape |
| **inferred** (access patterns) | DynamoDB `IndexName`, `KeyConditionExpression`, `UpdateExpression` + `ExpressionAttributeNames`; Mongo filters and `$set` paths; Redis commands and key templates | which code touches which entity; never overrides a declared fact |
| **observed** (sampling) | mongodb-schema, Variety†, quicktype† over documents | real nested shapes, but needs data; repo-resident fixtures or seeds only, never a live database by default |

**Merge rule:** keep every source on every element; never overwrite one with another. Where they disagree, record a *conflict*: that is the drift finding (a model saying nullable where the migration says `NOT NULL`; a GSI in dev JSON missing in prod).

### Difficulty per declaration (condensed)

| | Trivial | Moderate | Hard or needs evaluation |
| --- | --- | --- | --- |
| **SQL** | Drizzle snapshots (v7 `tables{…}`; v1 beta `version:"9"`, flat `ddl[]`, `prevIds[]` DAG), MikroORM snapshot, SQLite replay via `node:sqlite` | `schema.prisma` (7) and `contract.prisma` (8), Drizzle TS, `schema.rb`, EF ModelSnapshot, Diesel `table!` (token tree), Ent `migrate/schema.go`, GORM tags, JPA, SeaORM, Supabase `database.types.ts`, Postgres/MySQL DDL through a DDL interpreter | TypeORM entities (types inferred from TS), SQLAlchemy models (mixins, `declared_attr`), Knex and SeaQuery builder chains, `RunPython` |
| **DynamoDB** | `CreateTable` JSON, CloudFormation JSON | Terraform literal blocks, CloudFormation / SAM YAML (with `!Ref`, `!Sub`), SST, Pulumi, Amplify Gen 1 `@model` / Gen 2 `a.model`, ElectroDB, OneTable, Dynamoose, mapper annotations | Terraform `for_each` over Terragrunt `inputs` (needs a small evaluator: `var.*`, tfvars, `inputs` through `include`, `locals`, `each.*`, `lookup` / `try` / `merge`, `for`, `dynamic` blocks; `dependency.*.outputs`, `get_env`, data sources stay unknown), CDK with helpers or loops, dynamodb-toolbox `computeKey` |
| **Other** | Firestore indexes JSON, Elasticsearch mappings, `$jsonSchema` validators | Mongoose / Typegoose, Beanie, Spring Data, Convex, PocketBase migrations, Cassandra CQL (own tokenizer), Neo4j constraints, RediSearch `FT.CREATE` literals, `firestore.rules` paths | Redis key templates built in code, RediSearch schemas assembled by functions (the probed project), Mongoose plugins and discriminators |

Pitfalls worth carrying into the design:

- Ordering: Flyway compares versions numerically, Alembic follows `down_revision`, Liquibase follows its master changelog, Drizzle v1 is a DAG.
- Implicit fields: Rails, Django and Sequelize add `id`, timestamps or `_id` suffixes; Convex adds `_id`, `_creationTime`.
- Physical names: naming strategies, Sequelize and Mongoose pluralise, Postgres folds unquoted names, Amplify names tables only at deploy.
- Statement splitting comes before any SQL parse (`$$` and `$tag$`, MySQL `DELIMITER`, T-SQL `GO`), so one bad statement does not spoil the file.
- Terraform's DynamoDB GSIs now take `key_schema` with up to four attributes per key role: the model must allow multi-attribute keys.
- `node:sqlite`: the flag-free module starts at Node 22.13; in Node 26 the class is `Database` (`DatabaseSync` a deprecated alias). Feature-detect.

### NoSQL: the model is a four-part join

No file states a DynamoDB model. It is assembled:

1. **Key schema** from infra: hash and range keys, GSIs and LSIs with their projections, TTL, streams.
2. **Item shape** from code: a single-table mapper (ElectroDB, OneTable, Dynamoose, PynamoDB, the Java Enhanced Client) declares attributes *and* key composition; otherwise a language type (serde struct, Go `dynamodbav` tags, a TS type) is the shape.
3. **Binding** of shape to table, in falling confidence: declared in the mapper; an env-var chain (code reads `USERS_TABLE`, infra sets it); a name template (`"${var.env}-${var.project}-users"` matched on its literal segments, as in the probed project); the call-site type (`PutCommand({ TableName, Item: x as User })`).
4. **Access patterns** from code: which index each query uses, which attributes act as keys, which attributes each update writes. That gives the map its edges and finds dead indexes.

Mongo, Firestore and Redis follow the same pattern with fewer declared parts: a declared shape when a mapper or validator exists, otherwise inference from access patterns, with sampling of repo-resident fixtures as the last resort.

### Parsers

| Format | How |
| --- | --- |
| JSON | native |
| TS / JS, Rust, Go, Python, Java, Kotlin, C#, Ruby, PHP, YAML, TOML | the pinned tree-sitter grammars the graph already installs |
| SQLite DDL | `node:sqlite` replay: exact, no parser |
| Postgres / MySQL DDL | a statement splitter + an interpreter for about 12 statement kinds (CREATE / ALTER / DROP TABLE, CREATE / DROP INDEX, CREATE TYPE … AS ENUM, ALTER TYPE … ADD VALUE, RENAME, MySQL `MODIFY` / `CHANGE`), everything else counted as skipped. Either on a hand tokenizer or on DerekStride's tree-sitter-sql (MIT; v0.3.11 ships source only, so the WASM would be built and vendored) |
| HCL (Terraform, Terragrunt) | hand reader for blocks, attributes, literals, maps and lists, plus the small evaluator above; or tree-sitter-hcl (Apache-2.0, 146 stars, WASM to build) |
| Prisma, GraphQL SDL, CQL, Diesel `table!` | small hand readers |

## 6. A candidate shape, for the roast

Inspired by Liam ERD's keyed model and diff, Azimutt's nested attributes and provenance, tbls's virtual relations, and typeshare's serde rules. It follows the split that already works for the architecture diagrams: **the script extracts, an agent refines what the code cannot say, the script checks.**

- **Extract** (script, deterministic, inside `graph_index`, incremental by file hash): extractors emit one keyed model, `Store → Entity → Field / Key / Index / Relation / Binding`, every element carrying its `sources` (`repo:path:line`, kind, extractor, confidence) and its `conflicts`.
- **Reconcile** (script): group the declarations of one logical store across sources and repositories (dev JSON, prod Terraform, Rust struct, app SQLite) through bindings with a confidence (`declared` · `convention` · `name-match` · `ambiguous`, as the graph does for call edges), and list the conflicts.
- **Refine** (an agent, through a skill): what no file declares, such as a binding the script cannot resolve, lineage across stores (device `events` mirrors DynamoDB `event`), relations with no foreign key (`event_participants.event_id → event.id`), what an index is for. It is written to a checked file. Every claim is re-checked against the extracted model on each render; one the code no longer supports is reported as drift, never trusted.
- **Diff**, three kinds: *ref against ref* (a branch or PR against its base: re-extract from `git show <ref>:<path>`, JSON-patch the two models, per-element added / removed / modified, rename candidates flagged); *source against source* (the conflicts); *proposal against current* (an exploration or a roast writes a proposed delta, drawn over the current model; after the build, the check says which proposed changes the code now has).
- **View**: a *Data* tab in the graph page: an ERD per SQL store; DynamoDB tables as key cards (PK / SK, each index with the code that queries it or "no access found"); item shapes as trees; lineage lines across stores; diff colouring; conflict badges; every fact a link to its `path:line`. Architecture `database` components link to it.
- **Tools**: `graph_data` (stores, entities, one entity with its sources and the code that reads or writes it) and `graph_data_diff` (ref against ref) for scouts, `roast`, `to-plan`, `to-issues`, the `reviewer` (a destructive change in the same slice that stops reading it) and `migration-engineer` (the delta and its deploy order).
- **Freshness**: it rides the graph's index, so the `SubagentStop` refresh hook keeps it current after every implementer commit.

Owner decisions this leaves open: first-version coverage, whether a live or sampled overlay is ever allowed, the DDL and HCL parser route, the refinement file's place, the proposal format for explorations, rename handling in diffs.

---

## Sources

- Drizzle snapshots: [`pgSchema.ts`](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/serializer/pgSchema.ts); v1: [upgrade-v1](https://orm.drizzle.team/docs/upgrade-v1), [drizzle-kit generate](https://orm.drizzle.team/docs/drizzle-kit-generate)
- MikroORM snapshot, a real one: [medusa currency](https://github.com/medusajs/medusa/blob/develop/packages/modules/currency/src/migrations/.snapshot-medusa-currency.json); [migrations](https://mikro-orm.io/docs/migrations)
- Ent generated schema: [examples/start/ent/migrate/schema.go](https://github.com/ent/ent/blob/master/examples/start/ent/migrate/schema.go)
- Terraform [`aws_dynamodb_table`](https://github.com/hashicorp/terraform-provider-aws/blob/main/website/docs/r/dynamodb_table.html.markdown)
- [`node:sqlite`](https://nodejs.org/api/sqlite.html)
- Prisma 8: [schema location](https://www.prisma.io/docs/orm/prisma-schema/overview/location), [coming from Prisma 7](https://www.prisma.io/docs/orm/coming-from-prisma-orm-7), [migration API](https://www.prisma.io/docs/orm/reference/migration-api)
- [SST Dynamo](https://sst.dev/docs/component/aws/dynamo/); Amplify [Gen 2 secondary indexes](https://docs.amplify.aws/react/build-a-backend/data/data-modeling/secondary-index/), [Gen 1 `@key` and end of life](https://docs.amplify.aws/cli-legacy/graphql-transformer/key/)
- [Firestore index definitions](https://firebase.google.com/docs/reference/firestore/indexes); [ElectroDB indexes](https://electrodb.dev/en/modeling/indexes/); [OneTable](https://github.com/sensedeep/dynamodb-onetable); [dynamodb-toolbox v2](https://www.dynamodbtoolbox.com/docs/entities/usage)
- [mongodb-schema](https://github.com/mongodb-js/mongodb-schema); [Convex schemas](https://docs.convex.dev/database/schemas); [PocketBase JS migrations](https://pocketbase.io/docs/js-migrations/); [sqlx CLI](https://github.com/launchbadge/sqlx/blob/main/sqlx-cli/README.md); [SeaORM 2.0](https://www.sea-ql.org/blog/2025-10-20-sea-orm-2.0/); [EF Core migrations](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/)
- [tree-sitter-sql](https://github.com/DerekStride/tree-sitter-sql) (test corpus, v0.3.11 release); Supabase types: `supabase-js` `packages/core/postgrest-js/src/types/common/common.ts`
- Reference projects as in §4; Liam paths `frontend/packages/schema/src/parser/index.ts`, `schema/src/schema/schema.ts`, `migrationOperation/utils/getMigrationOperations.ts`; Azimutt `libs/models/src/database.ts`, `inferSchema.ts`, `databaseDiff.ts`; tbls `spec/tbls.schema.json_schema.json`, `drivers/dynamo/dynamo.go`, `drivers/mongodb/mongodb.go`; typeshare `core/src/parser.rs`

**Unverified:** Drizzle MySQL and SQLite snapshot version numbers; Prisma 8 `contract.json` contents; the `.sqlx` query JSON shape; `kysely-codegen`'s default output path; input names of `terraform-aws-modules/dynamodb-table`; elkjs's license.

---

## Probes

`/private/tmp/…/scratchpad/replay.mjs` (kept out of the repository) replays a Drizzle SQLite migration folder into `:memory:` and diffs it against the latest snapshot. Its core:

```js
const db = new DatabaseSync(':memory:')
for (const f of sqlFiles) for (const stmt of read(f).split('--> statement-breakpoint')) if (stmt.trim()) db.exec(stmt)
// then PRAGMA table_info / foreign_key_list / index_list per table, compared with meta/<last>_snapshot.json
```

Greps behind §1: `-acme-<table>` literals in `backend/{core,api,stream}/src`; `index_name("…")` calls there; `name = "…Index"` in `infra/live/prod/dynamodb/terragrunt.hcl`.
