# Data model map: design

**Status:** approved 2026-11-06 · **Plan:** [2026-11-06-data-model-map-plan.md](../plans/2026-11-06-data-model-map-plan.md) · **Date:** 2026-11-06 · **Input:** [the data model map research](../research/2026-11-06-data-model-map.md)

## Problem

In the user's words: like the code graph and the architecture diagrams, grimoire should keep a **map of the data models**: SQLite on the device (a mobile app), DynamoDB and other NoSQL stores, Postgres with Drizzle-style tables. It should have visuals, show **where it differs when changes are planned or explored**, and **update as the code updates**. The code and the infra are the source of truth; documentation helps discovery and planning, never decides.

Today the graph indexes `.sql`, `.tf`, `.hcl` and `.graphql` as file nodes only (`tools/graph/lib/langs.mjs:345`), and nothing in grimoire knows what a table, a key or an index is. A roast that touches stored data finds the model by grep. A PR that adds a field, drops an index or changes a key is reviewed as lines of code. Nobody sees the model change as a model change, and nobody sees two declarations of one table disagreeing. In the project the research probed, the local-dev table JSON still declares two GSIs prod dropped, under different table names, and lacks six prod tables (research §1).

No mature open-source project solves this. Liam ERD is static and diffs, but is SQL only, with no IaC. Azimutt models NoSQL only by sampling a live database. tbls reads DynamoDB only live. No project joins an IaC key schema with a code item shape (research §4). Grimoire builds its own, under its rules: no dependency, Node only, never running the project's code, never connecting to its databases.

## Goals (v1)

- **One model of every datastore, read from code, migrations, generated artifacts and infra.** Every element (store, entity, field, key, index, relation) carries the `repo:path:line` of each place that declares it.
- **Stack-agnostic.** Extractors are written per *format*, never per project, and plug into one registry. The probed project is the proving ground, not the target.
- **A Data tab** in the graph page: an ERD per SQL store, a key card per NoSQL table (keys, indexes, TTL, streams, item shapes), lineage across stores, and every fact linking to its code.
- **A change view, for the data model and the architecture.**
  - A proposed delta written at design time, drawn over the current model, validated visually and acknowledged change by change.
  - A branch drawn against its base.
  - A check that tells planned-and-built from pending and from unplanned.
- **Fresh after every commit,** through the graph's index and its existing `SubagentStop` hook.
- **Tools for agents**: roast, to-plan and to-issues plan with the model; implementers, `migration-engineer` and the `reviewer` see the change.

## Non-goals (v1)

- Connecting to a database, live introspection, or sampling live data. Code and infra are the truth. An *observed* overlay from repo-resident fixtures can be roasted later.
- Running any project code: no ORM introspection, no `drizzle-kit`, no `terraform plan`, no CDK synth.
- Parity with Liam, tbls or Azimutt, or reading or writing their formats.
- Generating migrations or DDL from the model.
- A hard gate on data or architecture changes (D4).
- Every ORM and store in v1. After v1, coverage grows one extractor at a time on the same model (slices list).

## Decisions

**D1. An agnostic core with a registry of per-format extractors.**
- An extractor is `{ id, version, kind, discover(repoFiles), extract(text, path, ctx) → facts }`. Its `kind` is one of: artifact · migration · infra · code · inferred.
- It names a format: "a SQL migration folder", "Drizzle snapshot", "Terraform `aws_dynamodb_table`", "Rust serde struct", "TS interface". Never a project.
- Conventions come from what the project declares. A table-name binding uses the infra's own name expression (`"${var.env}-${var.project}-${each.key}"`), matched against the literals the code builds. Nothing like `-acme-` is ever written into grimoire.
- Each extractor ships with fixtures from at least two ecosystems.
- **Rejected: the probed project's stack as the target.** The user asked for a tool usable everywhere.

**D2. The model is keyed, nested and sourced, with conflicts kept and never resolved.**
- The shape, inspired by Liam's name-keyed records, Azimutt's nested attributes and provenance, and tbls's virtual relations:
  - `Store{id, kind, name, nameTemplate?}`
  - `Entity{store, name, physicalName?, kind: table | view | collection | itemType | keyPattern | index, host?, discriminator?}`
  - `Field{entity, path (dotted when nested), type{raw, norm}, nullable: true | false | unknown, default?, generated?, enum?}`
  - `Key{owner, role: primary | partition | sort | unique | ttl, parts[] (up to four per role, for DynamoDB's multi-attribute GSI keys)}`
  - `Index{entity, name, kind, keys, projection?}`
  - `Relation{from, to, kind: fk | ref | embed | link, cardinality, enforced}`
  - `Binding{entity, codeSymbol, via: mapper | env | nameTemplate | callSite, confidence}`
- Every element has `sources[]`, each `{repo, path, line, kind, extractor@version, confidence}`.
- Trust runs artifact → migration → infra → code → inferred.
- Where sources disagree, the element gets a `conflict`, and every source is kept. A conflict is a finding, drawn in the Data tab.
- **Rejected: a precedence that overwrites.** The disagreement *is* the drift the user wants to see.

**D3. Extraction rides the code graph's index.**
- `graph_index`'s per-file loop (`lib/indexer.mjs`) hands each changed file whose path an extractor discovers to that extractor. Facts are stored per file in new tables of the same `graph.db`.
- Extractors that need a whole folder or directory run once per touched unit after the loop: the migration replay, and the Terraform module with its inputs.
- **Reconcile** runs at query and render time over the stored facts: it merges declarations, scores bindings, lists conflicts.
- Freshness comes for free: the `SubagentStop` hook (`hooks/scripts/graph-refresh.sh`), the stat check before queries, worktree seeding and re-basing (`lib/freshness.mjs`).
- An extractor that throws loses that file's facts and is reported in `graph_status`, as parse failures are. It never fails the index.
- **Rejected: a separate tool and store.** It would duplicate the freshness, worktree and MCP machinery the graph already has.

**D4. Unplanned changes never block. The agent resolves them, the map is updated, and the user is told.**
- The implementer sees the acknowledged delta in its brief and the branch's changes through `graph_changes`.
- For any change not in the delta, it decides whether to keep or revert it, and gives a reason in its return.
- The ship step (single writer, under the ship lock) appends kept changes to the delta file as `origin: "unplanned"` with that reason.
- It writes a **"Data model and architecture changes"** section into the PR description, each change marked planned ✓, pending or unplanned ⚠ with its reason. It says the same in the session or in the run report.
- Unplanned entries stay badged "unacknowledged" in the page until the user acknowledges them.
- A change that is *wrong* (it drops an index another repository still queries, it loses data) is still a review finding on its merits, never for being unplanned.
- **Rejected:** blocking until acknowledged, and blocking destructive changes only. The user: "it's not a blocking point… just send a message to make sure the user has been aware".
- **Amended 2026-11-07 (#97): the delta is committed on the run branch.** Asked whether the build loop should commit the delta it updates, the owner answered: "Yes, commit it." Written in place in the orchestrating checkout, the append was carried by no branch and no PR, a later implementer's `git add -A` could sweep it into its own commit, and a stash or `git checkout .` dropped it.
  - The ship step writes the delta in its ship worktree, on the run branch of the repository whose checkout holds it, under the ship lock, through `delta-append.mjs` (the same validation, ids and lock), and commits the delta alone in its own commit, `chore(data): record unplanned changes in <path> (<tasks>)`, with the repository's own git identity and a `Grimoire-Run: <runId>` trailer. The push carries it; the PR holds it; the owner reviews and merges it with the code. The orchestrating checkout is not modified while tasks run.
  - The checkout's run branch never gets those commits, so every later ship of that repository carries them forward, with entries of its own or not: a merge that changes only the delta, then its own entries on top. On a resume, a local run branch that diverged from origin by those commits alone is `delta-ahead`, not a refusal. The gate brings them into the checkout before its gate command (a fast-forward, or that same kind of merge), so it certifies and pushes a tree that holds them. A merge that stops on the delta, changed on both sides, keeps the branch's version and appends the remote's unplanned changes to it.
  - A delta not yet on the run branch is copied from the orchestrating checkout, as the design wrote it, and committed with the first entries.
  - With `deliver: 'end'`, the seal commits what is left on what the gate pushed, and pushes it.
  - A delta outside every shipped repository (a hub folder that is not one) is written in place, as before, and the PR section says so. In a session, `implement` commits the delta on the issue's branch.
  - A refused entry, a held lock, a commit a hook refuses or a push that fails never fails the ship or its push: the entries stay pending for the next ship, and the DELTA receipts say why.

**D5. Proposals: a delta file beside the spec, drawn as a visual diff, acknowledged change by change, for the data model and the architecture alike.**
- File: `docs/specs/<date>-<topic>.delta.json`.
- Shape: `{schema: 1, spec, data: [change], architecture: [change]}`. Each change is `{id, op: add | change | remove | rename, target, before?, after?, why, slice?, origin: planned | unplanned, ack?: {by, at, hash}}`.
- Targets address model elements (`<repo>:<store>/<entity>.<field>`, `…/index:<name>`) and architecture elements (`component:<id>`, `connection:<from>-><to>`, `boundary:<label>`).
- `roast` drafts it while designing; `to-plan` and `to-issues` give each change a slice.
- States are **computed** by the check, never written:
  - **planned and built**: the code has it;
  - **pending**: not in the code yet;
  - **built differently**: the code has the target in another shape;
  - **unplanned**: in the branch, not in the delta;
  - **stale**: the change's hash no longer matches its acknowledgement.
- Acknowledging happens in the page under `graph.mjs serve`. It reuses the token-protected local write path that already saves notes (`lib/serve.mjs`), extended to write only `*.delta.json` files. The acknowledgement records `by` (git `user.name`), `at`, and a hash of the change.
- **Rejected: a branch diff only.** There would be nothing to draw during a roast, before code exists.
- **Rejected: a delta only.** There would be no view of what a PR actually did.

**D6. Three diffs, one renderer.**
- **Branch against base.** Re-extract only the model-bearing files at the base ref (`git show <ref>:<path>`, as `scripts/version-check.mjs` already does), then compare the two keyed models element by element (Liam's approach). Each element comes out added, removed or modified.
- **Rename candidates.** A removed and an added element with the same type and position are paired as a *possible rename*, never decided (drizzle-kit asks; we only flag).
- **Source against source.** These are D2's conflicts.
- **Delta against code.** These are D5's states.
- One overlay draws all three: added in green, removed struck in red, modified in amber with before → after, possible renames paired, conflicts badged.

**D7. The architecture change view reuses D5 and D6.**
- The Architecture tab draws the delta's `architecture` changes over the saved diagram, with the same states and acknowledgement.
- A branch's architectural impact has two parts:
  - the diff of `*.architecture.json` between base and branch;
  - what `architecture check` reports on the branch's index and not on the base's (a new link no line draws, a module no component covers, a new external service, a drawn line the code no longer shows).
- The base index is the base checkout's, which `lib/freshness.mjs` already locates. When there is none, only the diagram files are compared, and the view says so.
- An unplanned architectural impact follows D4: the agent updates the diagram in the same PR, as `/grimoire:architecture` does, and tells the user.

**D8. The script extracts, an agent refines, the script checks: the architecture diagrams' split.**
- A skill, `/grimoire:data-model`, refines what no file declares, in a checked file `docs/architecture/<name>.data.json`, beside the diagrams, under `graph.architectureDir`:
  - bindings the script left ambiguous;
  - lineage across stores (the device's `events` mirrors the backend's `event`);
  - relations no foreign key states (`event_participants.event_id → event.id`);
  - what an index is for;
  - **stores with no extractor yet**, described entity by entity with a `path:line` citation per field.
- The check re-verifies every claim on each render: each citation's lines must exist, contain the field's name, and agree with any extracted fact. A claim the code no longer supports is drift, never trusted.
- Refined facts are labelled *refined*, never *extracted*.
- Datastores detected through client imports (`lib/arch.mjs`'s known services) but neither extracted nor refined are listed as **gaps**.
- **Rejected: extraction only.** No file says the device's `events` mirrors the backend's `event`, and that is the map's most useful line.
- **Rejected: fields inside the architecture JSON.** It is a different granularity, so the files link through component ids instead.

**D9. Parsing: no vendored grammars.**
- SQLite DDL is replayed into `node:sqlite` `:memory:` and read back with PRAGMA: exact, measured on the probed project (research §2).
- Postgres and MySQL DDL: a statement splitter and an interpreter for about twelve statement kinds; everything else is counted as skipped.
- HCL: a reader for the declarative subset, plus a small evaluator for literals, `var.*` from defaults, tfvars and Terragrunt `inputs`, `locals`, `each.*`, `lookup` / `try` / `merge`, `for` and `dynamic` blocks. Anything else is *unknown*, never guessed.
- Prisma and GraphQL SDL: small hand readers.
- TS, Rust, YAML and the other code languages: the pinned tree-sitter grammars.
- These readers follow `lib/md.mjs`'s precedent (linear time, a size cap, fixtures).
- **Rejected: vendoring tree-sitter-sql or tree-sitter-hcl WASMs.** Neither ships a built WASM, and the pinned runtime is an npm lockfile. Vendoring would add a build pipeline grimoire does not have, for grammars whose semantics we would interpret by hand anyway.

**D10. Tools: `graph_data` and `graph_changes`.**
- `graph_data`: stores, entities, and one entity with all its sources, conflicts, bindings, and the code that reads or writes it (through the graph's callers of the binding's code).
- `graph_changes`: the branch against base and against the delta, for both maps.
- CLI equivalents: `graph.mjs data [list | show | check]` and `graph.mjs changes [--base <ref>] [--delta <file>]`.
- Scouts, `roast`, `to-plan`, `to-issues`, implementers, `migration-engineer` and the `reviewer` use them as research: the map says where, the code says what is true (AGENTS.md, *The code graph*).

## Vertical slices (smallest first)

Each slice is demoed on the probed project and on a fixture from a second ecosystem.

1. **SQL migrations into a Data tab.** Discover SQL migration folders **by content, whatever tool wrote them**: any folder of ordered `.sql` files containing DDL, whatever its name. The dialect comes from config when stated, else is sniffed from the SQL, else is unknown and not replayed; a `graph.data.migrations` override covers the rest. Conventional names (`drizzle/`, `migrations/`, `prisma/migrations/`, `supabase/migrations/`) are only a fast path. Replay SQLite ones. Read Drizzle snapshots (v7 and the v1 `ddl[]` format). Store facts, render an ERD per store, add `graph_data` and `graph.mjs data`. *Demo:* the probed app's 23 tables, 7 foreign keys and 34 indexes, each linking to its migration line.
2. **Branch against base.** Add `graph.mjs changes --base` and `graph_changes` for the data model, and the overlay in the Data tab. *Demo:* a branch adding a column and dropping an index is drawn green and red.
3. **Proposals and acknowledgement.** The delta format and its computed states, `roast` and `to-plan` drafting it, the overlay drawing it, acknowledgement through `serve`. *Demo:* a roast's delta drawn over today's model, acknowledged change by change, then a branch turning one change "planned and built".
4. **The pipeline.**
   - `to-issues` names each issue's model changes from the delta.
   - Implementer and `migration-engineer` briefs carry the delta.
   - Implementers resolve unplanned changes with a reason; the ship step appends them and writes the PR section and the message (D4).
   
   *Demo:* an unattended slice that adds an unplanned field ships with it listed, reasoned and badged.
5. **The architecture change view.** D7 on the Architecture tab, reusing slices 2–4. *Demo:* a roast proposing a new component, and a PR whose new cross-module link shows as an unplanned architectural change with the diagram updated.
6. **DynamoDB key schemas, declared.** Raw `CreateTable` JSON, plus CloudFormation, SAM and Serverless templates in JSON and YAML. Draw key cards, and source-against-source conflicts. *Demo:* the probed project's local-dev tables, plus a SAM fixture.
7. **Terraform and Terragrunt.** The HCL reader and evaluator; one table per `for_each` key; unknowns marked. *Demo:* the probed project's prod tables, with the local-dev versus prod conflicts (the `ByTitleIndex` / `ByTitleFullIndex` GSIs, the table names, six tables missing locally).
8. **Item shapes and binding.**
   - Item shapes from code types: Rust serde (typeshare's rules: `rename`, `rename_all`, `flatten`, `default`, `skip`) and TS interfaces and types.
   - Binding by mapper, env-var chain, name template and call site, with confidence.
   
   *Demo:* the probed backend's structs bound to their tables. Measured: 13 of 16 repository files pair the types they convert with a table by co-occurrence alone, 10 of them one-to-one (research §1; spec *Sources*).
9. **Access patterns.** DynamoDB SDK calls (`IndexName`, `KeyConditionExpression`, `UpdateExpression` with `ExpressionAttributeNames`) in Rust, TS, Python and Go. Each index shows the code that queries it, or "no access found" as a lead. *Demo:* the 8 prod GSIs with no `index_name("…")` call.
10. **Code-declared SQL models.** Drizzle TS (`sqliteTable` / `pgTable` / `mysqlTable`, for push-only projects) and `schema.prisma`, plus the conflict "schema edited, migration not generated". *Demo:* `backoffice`'s seven tables, plus a Prisma fixture.
11. **Postgres and MySQL DDL.** The splitter and interpreter for migration folders (Flyway, golang-migrate, goose, dbmate, sqlx, Supabase) and for `structure.sql` and `db/schema.sql` dumps. *Demo:* a Supabase fixture.
12. **The refine skill.** `/grimoire:data-model` and the checked `*.data.json`: bindings, lineage, FK-less relations, agent-described stores with citations re-verified, and the gaps list. *Demo:* the probed project's device `events` ↔ backend `event` lineage, and its RediSearch index described by citation.

**After v1, extractor-only slices on the same model**, in an order the owner can change: Mongoose and Typegoose; ElectroDB, OneTable and Dynamoose; Firestore indexes and rules; Redis key templates and RediSearch `FT.CREATE` literals; CDK and SST literals; Rails `schema.rb`; EF Core model snapshots; Django and Alembic operations; JPA; GORM; Elasticsearch mappings; Cassandra CQL; Convex; Supabase types.

## Edge cases and failure modes

- **Partial evaluation.** A Terraform value from `dependency.*.outputs`, `get_env`, a data source or remote state is *unknown*, drawn as such, never guessed. A table name with an unknown segment binds only through its literal segments, at a lower confidence.
- **Several environments.** Local-dev JSON and prod Terraform describing one store are two declarations of it, each labelled with its source. Their disagreement is a conflict, not an error.
- **Ordering.** Flyway compares versions numerically, Alembic follows `down_revision`, Drizzle v1 snapshots form a DAG (take the leaves), Liquibase follows its master changelog. A migration folder whose order cannot be decided is reported as such, not replayed in filename order by assumption.
- **A replay error** (a statement SQLite rejects, a data migration) stops that folder's replay at that statement. The facts so far are kept, labelled "replayed to `<file>:<line>`", and the error is shown.
- **Secrets.** The HCL evaluator and the YAML reader store only the values that land in a store's model (names, keys, index names, TTL attributes), never other variables. `*.tfvars` values are read into memory and dropped.
- **Size.** Every reader has a size cap and linear time, as `lib/md.mjs` does. A store with hundreds of entities is drawn collapsed per store, with search and focus, as the file map is.
- **Concurrency in the loop.** Parallel lanes never write the delta; only the ship step does, under the ship lock, on the run branch (D4, amended 2026-11-07). Acknowledgements come from the user's `serve` page; a write against a delta that changed on disk since it was loaded is refused (409), as note saves are.
- **Stale acknowledgements.** An acknowledged change whose content changed afterwards (a re-roast edited it) shows as stale until acknowledged again.
- **Worktrees.** A worktree's model is its own: it rides the graph's per-checkout index and its seeding from the base.
- **No extractor, no refine file.** The store is still listed, as a gap, through its client imports. The map never pretends to be complete.
- **Binding mistakes.** A binding below *convention* confidence is drawn dashed, the way name-guessed call edges are, and lists its rivals. A wrong binding is corrected in the refine file, and the check keeps the correction honest.

## Questions still owned by the user

- **Notification channel.** v1 tells you in the PR description, the session and the run report (D4). Should the manager briefing also list unacknowledged changes, or the opt-in shared post (`manager.share`) carry them? Default: no, until asked.
- **Coverage order after v1.** The list above is a default.

## Sources consulted

- Docs: `AGENTS.md` (*The code graph*); `tools/graph/README.md`; `skills/architecture/SKILL.md`; `skills/roast`, `to-plan`, `to-issues`; `agents/migration-engineer.md`; `docs/specs/2026-10-30-token-economy-design.md` (format); harness memory (build our own; run the pipeline autonomously; one review per issue).
- Code:
  - `tools/graph/lib/indexer.mjs` (the per-file loop D3 hooks into), `store.mjs:24-56` (`node:sqlite`, the Node floor), `langs.mjs:345` (SQL, HCL and GraphQL as file-only);
  - `lib/arch.mjs` (`validate`, `bindCode`, `checkSources`, `analyze`, `draftArch`, `readDiagrams`; known services by import), `render.mjs:69-87,430` (the tabs, diagrams checked on render), `lib/serve.mjs` (the token-protected write path), `lib/freshness.mjs` (base index);
  - `hooks/hooks.json:46` (the refresh hook), `scripts/version-check.mjs:35` (`git show <ref>:<path>`), `scripts/build-ship-lock.mjs`, `workflows/orchestrate-loop.js:1373` (the ship step's PR);
  - the pinned grammar list in the graph-deps cache (no SQL, HCL, GraphQL or Prisma).
- The probed project (research §1): `backend/local/tables/*.json`, `core/src/model/*.rs`, `core/src/repositories/*.rs`, `core/src/search/index.rs`, `macros/src/lib.rs`; `infra/modules/dynamodb/main.tf`, `infra/live/prod/dynamodb/terragrunt.hcl`; `app/db/schema.ts`, `drizzle/`, `drizzle.config.ts`; `backoffice/src/db/schema.ts`; `legacy-api/amplify/backend/api/<api>/schema.graphql`; `grimoire.config.json` (all four repos indexed).
- Scouts: a `reference-scout` (OSS survey) and a research agent (extraction per store); their reports are folded into the research doc's §4 and §5.
- Measured:
  - migration replay against the Drizzle snapshot: exact, research §2;
  - table-to-type co-occurrence per repository file: 13 of 16 paired, 10 of them one-to-one;
  - GSIs in prod Terraform against `index_name("…")` calls: 8 with no call (leads).

## Self-answered questions

| Question | Answer | Source |
| --- | --- | --- |
| Is there a mature tool to adopt? | No, and adopting one is against policy anyway; borrow Liam, Azimutt, tbls and typeshare's patterns | research §4; memory *build our own* |
| Live database or sampling? | Never in v1 | user: "source of truth is always the code and infra" |
| Where does extraction run, and how does it stay fresh? | Inside `graph_index`, so the existing hook and worktree machinery apply | `lib/indexer.mjs`, `hooks/hooks.json:46`, `lib/freshness.mjs` |
| SQLite without a parser? | Replay into `node:sqlite`; exact on the probed app's 25 migrations | research §2 |
| Vendor SQL or HCL grammars? | No: hand readers for the subsets (D9) | graph-deps grammar list; `lib/md.mjs` precedent |
| How does a NoSQL struct bind to its table? | Mapper, env var, the infra's name template, call site, with confidence; measured on the probed project | research §5; measurement above |
| Where does the view live? | A Data tab in the graph page; overlays in the Architecture tab | `render.mjs:430` |
| Where do refine files live? | `docs/architecture/<name>.data.json`, beside the diagrams | the architecture skill's convention |
| How are acknowledgements written? | The `serve` page's token-protected write path, limited to `*.delta.json`, 409 on a stale base | `lib/serve.mjs` |
| Who writes the delta during a run? | The ship step only, under the ship lock | `scripts/build-ship-lock.mjs` |
| Renames in diffs? | Flagged as candidates, never decided | drizzle-kit's prompts (research §4) |
| An index no code queries? | A lead, confirmed by grep, never a verdict | AGENTS.md: "a missing edge proves nothing" |

## Docs drift fixed

None found. `tools/graph/README.md` (file-only languages, the Architecture tab, `serve`), `skills/architecture/SKILL.md` and `AGENTS.md` (*The code graph*) match the code they describe. The README, AGENTS.md (*Docs* store), the architecture skill and the graph README will need additions as slices land; each slice updates them.

## Reference projects

| Repository | Path | Adopted | Not adopted |
| --- | --- | --- | --- |
| liam-hq/liam (Apache-2.0) | `frontend/packages/schema/src/schema/schema.ts`, `migrationOperation/utils/getMigrationOperations.ts`, `erd-core/src/features/diff` | a name-keyed model; element-level diff with added / removed / modified, coloured on the ERD | SWC, pg-query WASM, `@prisma/internals`, React / xyflow / elkjs |
| azimuttapp/azimutt (MIT) | `libs/models/src/database.ts`, `inferSchema.ts` | nested attributes; per-element source provenance | live connectors; sampling as truth |
| k1LoW/tbls (MIT) | `spec/tbls.schema.json_schema.json` | *virtual* relations for models with no foreign key; lint-style findings | live drivers; Markdown diff |
| 1Password/typeshare (Apache-2.0 / MIT) | `core/src/parser.rs` | serde rules for item shapes (`rename_all`, `flatten`, `default`, `skip`, `tag` / `content`) | `syn`; its code generators |
| drizzle-team/drizzle-orm, drizzle-kit (MIT) | `drizzle-kit/src/serializer/*Schema.ts`, `snapshotsDiffer.ts` | reading its snapshots; rename candidates | executing the schema; interactive prompts |

Code copied from these keeps its license notice in the file that borrows it.
