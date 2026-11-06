# Data model map: plan

**Spec:** [2026-11-06-data-model-map-design.md](../specs/2026-11-06-data-model-map-design.md) (approved 2026-11-06) · **Research:** [2026-11-06-data-model-map.md](../research/2026-11-06-data-model-map.md)

## The problem, in the user's words

> Like we do with the graph in grimoire today, we would like to create a map of the data models: the SQLite in odyyy, the NoSQL like DynamoDB and others, the PGSQL in a project (usually with something like Drizzle and SQL-like tables). For NoSQL it's harder to define. We would like visuals like we do today with architecture, to see where it differs when there are updates to be done or explorations, and to update it as the code updates. The source of truth is always the code and infra, not the documentation.

## The solution, in the user's words

- **Agnostic.** "Take example on the odyyy stack, but the tool must be agnostic and used everywhere else as well."
- **It works like the graph and the architecture.** "This should work like grimoire architecture and graph."
- **A visual of what we plan to change.** "A view of what we consider changing with the plan before adding a feature", with "a visual that shows differences so we can visually validate and acknowledge what changes".
- **Never blocking.** "You should be able to solve it by yourself and update the mapped data after; just send a message to make sure the user has been aware. It's not a blocking point."
- **Architecture too.** "We should do the same with architectural changes: if there are impacted changes, note it visually and apply the same logic."

## User stories

1. As a developer joining a project, I want one page showing every datastore's tables, keys, indexes and item shapes, each linked to the code that declares it, so that I learn the data model without grepping four repositories.
2. As the owner, I want to see where two declarations of the same store disagree (local-dev table JSON against prod Terraform, a Drizzle schema against its last migration), so that drift is found before it bites.
3. As the owner, during a roast, I want the proposed data-model and architecture changes drawn over today's model, so that I validate them visually and acknowledge each one before anything is built.
4. As the owner, I want every PR's data-model and architecture changes listed as planned, pending or unplanned, with the agent's reason for each unplanned one, so that I stay aware without being blocked.
5. As `roast`, `to-plan` and `to-issues`, I want the model and the change view as tools, so that a plan names exactly which tables, fields, keys and components each slice touches.
6. As an implementer, the `migration-engineer` or the `reviewer`, I want the branch's model diff against base and against the acknowledged delta, so that I build and judge the change as a model change, not as lines.
7. As a user of grimoire on any stack (Prisma on Postgres, SAM on DynamoDB, Supabase, Drizzle), I want the same map, so that it is not an odyyy feature.
8. As the owner of a stack no extractor reads yet, I want an agent to describe the store from the code with citations the check keeps honest, and the map to list what it does not cover, so that the map is useful and never pretends to be complete.
9. As anyone, I want the map to stay current after every implementer commit with no step of mine, so that it is never a stale document.

## Seams

Four seams, all already exercised by the suite. No new kind of test harness.

| Seam | Where | Covers | Tested in |
| --- | --- | --- | --- |
| **A. `call(name, args, { root })`** | `tools/graph/lib/commands.mjs:119`, the single entry of the MCP server (`mcp.mjs`) and the CLI (`graph.mjs`) | extraction through `graph_index`, reconcile, `graph_data`, `graph_changes`, the data and architecture checks | new `tools/graph/tests/data.test.mjs`, in two parts. **Part 1** needs no parser runtime: the readers (SQL replay, DDL, HCL, Prisma), the model diff and the delta states, run directly on strings, like `arch-docs.test.mjs`. **Part 2** builds multi-ecosystem fixture projects under `tests/fixtures/data/`, indexes them and asserts through `call()`, as `graph.test.mjs` §2 does with `fixtures/poly` (skipped without the runtime, failing under CI) |
| **B. The page's own script in a stub DOM** | `lib/render.mjs` (the tabs, `render.mjs:430`), new `lib/data-view.mjs`, `lib/arch-view.mjs` | the Data tab, the overlays, the Architecture overlay, anchors | `data.test.mjs` §page, as `graph.test.mjs` §5 and `arch-docs.test.mjs` §5 do |
| **C. `serve` over HTTP** | `lib/serve.mjs` | acknowledgement writes: token, host and origin, `*.delta.json` only, 409 on a stale base | `arch-docs.test.mjs` §4's pattern, extended |
| **D. The engine and the skills** | `workflows/orchestrate-loop.js` (`draftBody` `:5938`, `withShipLock` `:1977`, `shipPrompt` `:1997`), `workflows/briefs/{hydrate,implement,review,ship}.md`, `skills/{roast,to-plan,to-issues,implement,review,architecture}/SKILL.md` | the delta in briefs, the PR section, the ship step's delta append, the skills' instructions | `workflows/tests/*.test.mjs`; `skills/*/evals/evals.json` through `npm run evals:check` |

**Fixtures are synthetic.** They are written for the tests and shaped like the stacks they stand for (a Drizzle SQLite app, a Supabase Postgres app, a SAM DynamoDB service, a Rust and Terraform/Terragrunt backend, a Prisma app). Nothing is copied from odyyy, which is private: grimoire is a public repository. No token-like literals (harness memory). odyyy is where each slice is *demoed*, by hand, never where it is tested.

## Shape of the code

New files sit beside the architecture code they mirror:

```
tools/graph/lib/data/
  model.mjs       the keyed model (D2): elements, sources, conflicts, ids, normalised types
  registry.mjs    extractors by id, discovery by path, versions; per-file and per-unit extractors
  reconcile.mjs   merge declarations, bindings with confidence, conflicts, gaps (client imports from arch.mjs)
  diff.mjs        model against model (added / removed / modified, rename candidates)
  delta.mjs       the *.delta.json format, validation, computed states, hashes
  check.mjs       refine-file and delta checks against the extracted model
  readers/        sql-split.mjs · sqlite-replay.mjs · ddl.mjs · hcl.mjs · hcl-eval.mjs · prisma.mjs
  extractors/     one file per format (drizzle-snapshot, sql-migrations, dynamodb-json, cfn, terraform, serde, ts-types, dynamo-access, drizzle-ts, prisma…)
tools/graph/lib/data-view.mjs   the Data tab (browser-only, injected like arch-view.mjs)
```

- **Store:** new tables in `graph.db` (`store.mjs`), one row of facts per file and per unit, plus their extractor version. The store's schema version moves, so an older index is rebuilt in full (the README's freshness rule).
- **Tools:** new entries in `commands.mjs` `TOOLS` (`graph_data`, `graph_changes`) and the matching CLI commands.
- **Attribution:** code borrowed from Liam, Azimutt, tbls, typeshare or drizzle-kit keeps its notice in the file.

**Every slice:**
- bumps the plugin version and adds a CHANGELOG entry (`scripts/version-check.mjs`);
- refreshes `.harness/manifest.json` when it touches a file listed there (`npm run harness:manifest`);
- updates `tools/graph/README.md`, and the skills and `AGENTS.md` it changes;
- passes `npm test` and `npm run evals:check`.

## Vertical slices (smallest first)

Numbers in brackets are the spec's slice numbers. The spec's slice 1 is split in two here, so each piece fits one context window.

### 1. The model, SQL migrations and `graph_data` [spec 1, part 1]
- **What:**
  - `model.mjs`, `registry.mjs`, the store tables, a hook in `indexer.mjs`'s loop and a per-unit pass after it.
  - Extractors: SQL migration folders **found by content, whatever tool wrote them**, and Drizzle snapshots (v7 `tables{}` and v1 `ddl[]`) as a bonus where they exist. The owner, 2026-11-06: "if it's not Drizzle and it's another tool, it must work; that's what agnostic means".
  - Discovery: any folder of ordered `.sql` files containing DDL, whatever its name, plus per-migration subfolders (`<prefix>_<name>/migration.sql` or `up.sql`). Down migrations and seeds are excluded; conventional names are only a fast path.
  - Order: the tool's journal when present, else natural sort of the prefixes. Undecidable means "order unknown", not replayed.
  - Dialect: from config (`drizzle.config.*`, `schema.prisma`'s `provider`, Supabase), else sniffed from the SQL (its own module, reused by slice 12), else unknown and not replayed. `graph.data.migrations: [{ path, dialect }]` overrides.
  - SQLite folders are replayed into `node:sqlite` `:memory:` (`readers/sqlite-replay.mjs`, `readers/sql-split.mjs` for Drizzle's `--> statement-breakpoint` and plain `;`). Postgres and MySQL folders are recorded as *found, not yet read* until slice 12.
  - `graph_data` (stores, entities, one entity with sources) and `graph.mjs data list | show`.
  - `graph_status` reports extractor failures.
- **Done:** on a Drizzle SQLite fixture, the replay and the snapshot agree element for element and each table cites its migration line. A deliberately hand-edited migration shows as a conflict. On odyyy-app: 23 tables, 7 FKs, 34 indexes.
- **Seam:** A (parts 1 and 2).

### 2. The Data tab [spec 1, part 2]
- **What:** `data-view.mjs`, the tab in `render.mjs`, an ERD per SQL store (tables, columns, PK, FK lines, indexes), search and focus, the `#data-<n>` anchors, each fact a link to its file.
- **Done:** the page renders the fixture's stores. A store with 200 tables stays usable, collapsed and searchable. The CSP is unchanged.
- **Seam:** B.

### 3. Branch against base [spec 2]
- **What:**
  - `diff.mjs`: element-level added / removed / modified, plus rename candidates.
  - Re-extracting the model-bearing files at a base ref through `git show <ref>:<path>` (as `scripts/version-check.mjs:35`); the base is `baseBranch`, else the freshness base.
  - `graph_changes` and `graph.mjs changes --base`.
  - The Data tab's change overlay: green, red struck, amber before → after, renames paired.
- **Done:** a fixture branch that adds a column, drops an index and renames a table shows all three, the rename as a candidate.
- **Seams:** A, B.

### 4. Proposals and acknowledgement [spec 3]
- **What:**
  - `delta.mjs`: the format (D5), validation, element hashes, and the computed states: planned and built, pending, built differently, unplanned, stale.
  - The overlay draws a delta over the current model.
  - `serve` writes acknowledgements to `*.delta.json` only, with git `user.name`, a 409 on a stale base, and the same token, host and origin rules.
  - `roast` drafts the delta beside the spec; `to-plan` gives each change a slice.
- **Done:** a fixture delta is drawn; acknowledging it in the served page writes `ack`; editing the change afterwards shows it stale; a branch building one change turns it "planned and built".
- **Seams:** A, B, C, D (roast and to-plan evals).

### 5. The pipeline: unplanned changes resolved and reported [spec 4]
- **What:**
  - `to-issues` names each issue's model changes from the delta.
  - The hydrate, implement and `migration-engineer` briefs carry the task's delta changes and point at `graph_changes`.
  - The implementer returns `modelChanges: [{target, kept: true|false, reason}]` for each unplanned change.
  - The review brief: unplanned is never a finding by itself; a wrong change still is.
  - The ship step, under the ship lock, appends kept unplanned changes to the delta (`origin: "unplanned"`) and adds a **"Data model and architecture changes"** section to the PR body (`draftBody`).
  - The run report and the session say the same.
  - With no delta (an ad-hoc PR), the section still lists the branch's changes.
- **Done:** a workflow test where an implementer keeps one unplanned field and reverts another. The PR body lists both, with planned ✓, pending, unplanned ⚠ and the reason; the delta gains one entry; nothing blocks.
- **Seam:** D (with A for `graph_changes`).

### 6. The architecture change view [spec 5]
- **What:**
  - The delta's `architecture` changes drawn over the saved diagram in the Architecture tab, with the same states and acknowledgement.
  - A branch's architectural impact: the `*.architecture.json` diff, plus the check findings present on the branch's index and absent from the base checkout's (`lib/freshness.mjs`). With no base index, the diagram files only, and the view says so.
  - `graph_changes` covers both maps.
  - The architecture skill updates the diagram for an unplanned impact, and slice 5's PR section includes it.
- **Done:** a fixture where a branch adds an import between two components with no drawn line. It shows as an unplanned architectural change; the diagram updated in the branch turns it "built".
- **Seams:** A, B, D.

### 7. DynamoDB key schemas, declared [spec 6]
- **What:**
  - Extractors for raw `CreateTable` JSON and for CloudFormation, SAM and Serverless templates in JSON and YAML. YAML goes through the pinned tree-sitter grammar, with `!Ref`, `!Sub` and `!GetAtt` kept as unresolved references.
  - Key cards in the Data tab: PK and SK, GSIs and LSIs with projections, TTL, streams, multi-attribute keys.
  - Source-against-source conflicts across environments.
- **Done:** a SAM fixture and a local-dev JSON fixture declaring the same table differently show both declarations and the conflict.
- **Seams:** A, B.

### 8. Terraform and Terragrunt [spec 7]
- **What:**
  - `readers/hcl.mjs` (blocks, attributes, literals, maps, lists, heredocs, template strings).
  - `readers/hcl-eval.mjs`: `var.*` from defaults, `*.tfvars`, `*.auto.tfvars(.json)` and Terragrunt `inputs` through `include` / `find_in_parent_folders()`; `locals`, `each.*`, `lookup` / `try` / `merge`, `for`, `dynamic`.
  - Unknowns (`dependency.*.outputs`, `get_env`, data sources) are marked, never guessed.
  - One table per `for_each` key. The name template is kept for binding.
  - Only store-related values are retained.
- **Done:** a Terragrunt fixture (a module with `for_each` over a map, inputs in a child folder) yields its tables, GSIs and TTL. On odyyy: the prod tables, with the local-dev conflicts.
- **Seam:** A (part 1 for the evaluator, part 2 end to end).

### 9. Item shapes and binding [spec 8]
- **What:**
  - Item shapes from Rust serde structs (typeshare's rules: `rename`, `rename_all`, `flatten`, `default`, `skip`, `tag` / `content`, `Option` as nullable) and from TS interfaces and types, as nested fields.
  - Binding by:
    - mapper;
    - env-var chain (code reads `X_TABLE`; infra sets it);
    - the infra's name template matched against literals the code builds;
    - co-occurrence of a table literal and a type's conversion in one function, then one file;
    
    each with a confidence, rivals listed, and sub-convention bindings drawn dashed.
  - Item trees on the key cards.
- **Done:** Rust and TS fixtures bind as designed, including one ambiguous case listing its rivals. On odyyy: the co-occurrence measurement (13 of 16 repository files) reproduced or bettered.
- **Seams:** A, B.

### 10. Access patterns [spec 9]
- **What:** DynamoDB SDK calls in Rust, TS, Python and Go (`IndexName` / `index_name`, `KeyConditionExpression`, `UpdateExpression` with `ExpressionAttributeNames`, `TableName`). Each index shows the code that queries it, or "no access found" labelled as a lead. Attributes written but not in the item shape become a conflict.
- **Done:** fixtures in two languages, one with an unqueried GSI reported as a lead, one queried through a constant (not flagged).
- **Seams:** A, B.

### 11. Code-declared SQL models [spec 10]
- **What:** Drizzle TS (`sqliteTable` / `pgTable` / `mysqlTable`: columns, types, `notNull`, `primaryKey`, `references`, `unique`, the indexes in the third argument; `$defaultFn` recorded as computed) and `schema.prisma` (`readers/prisma.mjs`: models, `@id`, `@unique`, `@relation`, `@map` / `@@map`, enums), plus the conflict "schema edited, migration not generated".
- **Done:** a push-only Drizzle fixture and a Prisma fixture. On odyyy: `odyyy-generative-ai-content`'s seven tables.
- **Seam:** A.

### 12. Postgres and MySQL DDL [spec 11]
- **What:** `readers/ddl.mjs`, which splits statements (`$$` and `$tag$`, MySQL `DELIMITER`), interprets about twelve statement kinds and counts the rest as skipped per file. Migration ordering per tool (Flyway numeric versions, goose and dbmate sections, golang-migrate `.up.sql`, sqlx, Supabase timestamps). `structure.sql` and `db/schema.sql` dumps are preferred over replay. Folders found in slice 1 as "not yet read" become read.
- **Done:** a Supabase-style fixture with `ALTER` chains, an enum and a `DO $$` block (skipped and counted).
- **Seam:** A (part 1).

### 13. The refine skill [spec 12]
- **What:**
  - `skills/data-model/SKILL.md` (`/grimoire:data-model`, mirroring `/grimoire:architecture`) and the checked `docs/architecture/<name>.data.json`: bindings, lineage across stores, relations with no FK, index purposes, and agent-described stores with a citation per field.
  - `check.mjs` re-verifies each claim on every render: lines exist, they contain the field name, they agree with extracted facts.
  - Refined facts are labelled.
  - The gaps list: client imports with no extractor and no refine entry.
  - The skill's evals; the roster and the `AGENTS.md` docs store row.
- **Done:** a fixture refine file with one valid lineage, one stale citation (reported as drift) and one Mongoose store described by citation. On odyyy: the device-to-backend `orbits` lineage and the RediSearch index.
- **Seams:** A, B, D (evals).

### After v1

Extractor-only slices on the same model, each with its fixture:
- Mongoose and Typegoose;
- ElectroDB, OneTable and Dynamoose;
- Firestore indexes and rules;
- Redis key templates and RediSearch `FT.CREATE` literals;
- CDK and SST literals;
- Rails `schema.rb`; EF Core model snapshots; Django and Alembic operations; JPA; GORM;
- Elasticsearch mappings; Cassandra CQL; Convex; Supabase types.

Each one only adds an extractor; nothing else changes.

## Dependencies

- 1 → 2 → 3 → 4 → 5 → 6.
- 1 → 7 → 8 → 9 → 10.
- 1 → 11.
- 1 → 12.
- 2 and 9 → 13 (the refine file corrects bindings, so binding must exist).

Slices 7–12 can run in parallel with 3–6 once slice 2 exists (they touch extractors and readers, not the change view). Slices 7, 11 and 12 do not depend on each other.
