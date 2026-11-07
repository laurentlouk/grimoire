---
name: data-model
description: Refine the project's data model map with what no file declares, in a checked refine file backed by the code. Reads the map the code graph extracts (graph_data; migrations, schemas, table declarations, item shapes, access patterns), then, reading the code at each lead, writes docs/architecture/<name>.data.json - lineage across stores (the device's events mirroring the backend's event table, field by field), relations no foreign key states, what an index is for, bindings the script left ambiguous, equivalences between a local-dev table and its production template, and stores no extractor reads yet (a document collection, a cache, a search index) described entity by entity with a path:line per field - checks every claim with graph.mjs data check until no claim drifts, and shows it in the graph page's Data tab, each fact labelled refined. Use when the user says "map the data model", "refine the data model", "document how the data flows between stores", "which table mirrors which", "describe the Redis/Mongo/search store", "the local table and the prod table are the same", "fix the data map's drift", "/grimoire:data-model"; also when graph_data or graph_changes reports drift in a refine file, or a gap. Not for drawing services and their calls (the architecture skill), not for a migration or a schema change itself, and not for a numeric chart.
---

# Data model: what the code cannot say, checked

The map of a project's data is extracted by the code graph's index (`graph_data`): SQL migrations, schema snapshots and code-declared schemas, key-value table declarations (CreateTable files, templates, Terraform), item shapes bound to tables, access patterns. Some facts no file declares. They go in one typed JSON file per map, `docs/architecture/<name>.data.json` (beside the architecture diagrams; `graph.architectureDir` in `grimoire.config.json` moves the folder), and the graph page (`/grimoire:graph`) draws them in its **Data** tab, labelled *refined*.

Three hands, as for the architecture diagrams:

- **The script extracts** the model, deterministically, every element citing the `path:line` that declares it.
- **You refine**, reading the code: what mirrors what across stores, the relations and index purposes the code relies on, the binding the script could not settle, the declarations of one table the evidence does not tie, and the stores no extractor reads yet.
- **The script checks** every claim on every answer and every render: each citation's lines exist and name what the claim states (a name of the claim, letter case aside, not inside a longer identifier; a template by its longest literal part), and the claim agrees with the extracted model. A claim that fails is **drift**: reported with why, never drawn as fact.

The plugin root is the directory two levels above this `SKILL.md`; commands below run from the project root (where `grimoire.config.json` is).

## 1 · Explore before asking

- Read `grimoire.config.json`: `graph.enabled` (when `false`, say so and stop), `repos`, `graph.architectureDir`.
- Is there an index? `node <root>/tools/graph/graph.mjs status`; if not, `graph.mjs index` (the first run installs the parser runtime, ~50 MB, once per machine).
- Read the map: `graph_data` (or `graph.mjs data`): the stores, the logical tables, the item types bound or not, the access patterns' leads, then its **Refined**, **Drift** and **Gaps** parts. `graph_data` with a store or an entity says the rest (`graph.mjs data show <entity>`).
- **Updating** an existing refine file: start from it, never from a blank one, and run `graph.mjs data check` first: its drift is what to fix.
- Scope comes from the request: the whole project by default, or the stores it names. Ask the user only what the code, config and git history cannot tell you (whether a table no code uses is still deployed, say).

## 2 · Read the code at each lead

Use the graph to find *where* (`graph_search`, `graph_file`, `graph_callers`, a `codebase-scout`), then read the code at that `path:line` before writing a claim. The leads:

| Lead | Where it shows | What to read |
| --- | --- | --- |
| Two stores holding one entity | an entity of the same name or shape in two stores (a device's SQLite `events`, a backend table `{env}-{project}-event`) | the sync or upload code that copies one into the other: which field goes where |
| A relation no foreign key states | a column named after another table (`event_id`), a key-value attribute holding another item's key | the lookups and joins that use it |
| An index with no purpose said | every index; `no access found (lead)` in `graph_data` | the queries that name it (`IndexName`, `index_name`, a `WHERE` the index serves) |
| A binding left ambiguous | `graph_data`'s item types: `ambiguous: A \| B` | the call site: which table the conversion writes |
| Declarations of one table no evidence ties | a local-dev `Orders` beside a production `{env}-{project}-order`; `declared, no code uses this name` | where the local name is set (a compose file, an `.env.example`, a test setup, a seed script). No such line: the local declaration may be stale; say so, never pair by a guess |
| A store no extractor reads | **Gaps** (a Redis, MongoDB, search or other client imported, nothing covering it) | the code that defines its shape: a schema, the index creation (`FT.CREATE`), the key templates, the documents written |

Never invent: a claim you could not tie to a line is left out. Read enough to be sure, not everything.

## 3 · Write the refine file

`docs/architecture/<slug>.data.json`, one per map (one is usual). Top level: `schema: 1`, `title`, `summary` (two or three sentences), and one or more claim lists. Entities are named by their id as `graph_data` prints it, `repo:store/entity` (`app:drizzle/events`, `backend:dynamodb/{env}-{project}-event`); a described store's entity is `repo:<its id>/<name>`. A citation is `repo:path:line` or `repo:path:start-end` (up to 200 lines), on the line that names what the claim states.

| List | Each claim | Checked |
| --- | --- | --- |
| `lineage` | `from`, `to` (two entities, across stores), `fields` `[{ from, to }]`, `why`, `sources` | both entities exist, each field on its side, the citations name an entity or a field |
| `relations` | `from`, `columns`, `to`, `toColumns`, `why`, `sources` | the entities and columns exist; a foreign key on those columns to another table is drift, one stating the same is noted |
| `indexes` | `entity`, `index`, `purpose`, `sources` | the index exists on the entity; the citations name it |
| `bindings` | `item` (`repo:Type`), `table` (its name, template or entity id), `why`, `sources` | the item type and the table exist; a binding the code states at convention or above to another table is drift |
| `equivalences` | `tables`: two or more `{ repo, name \| template, store?, path? }` (`name` an exact name, `template` one with `{…}` parts, `path` the file that declares it; `store` defaults to `dynamodb`), `why`, `sources?` | each declaration exists under the name or template stated (in that file); they are then one logical table, their differences conflicts |
| `stores` | `repo`, `id`, `kind` (`redis`, `mongodb`, `redisearch`…), `label?`, `imports?` (the client packages that reach it: this covers the gap), `why?`, `entities` `[{ name, kind?, source, note?, fields: [{ name, type?, source, note? }] }]` | each entity's and each field's citation names it; no extractor reads a store of that id |

Bounds: 1 MB, 2000 claims, 20 citations per claim, 500 entities, fields or pairs per list. No other key (the check refuses one). Keep `why` to what you read: "the device pushes each row to the backend table in `push`".

## 4 · Check until it passes

```sh
node <root>/tools/graph/graph.mjs data check            # every refine file; or: data check docs/architecture/<slug>.data.json
```

Exit 1 on drift or a file that does not validate. Each drift line says where (`lineage[0] (line 6)`) and why: a line past the file's end, a line that names none of the claim's names (cite the line that does), an entity, field, index or item the model lacks (read the code again: renamed, moved, or gone), a contradicting foreign key or binding (the claim is wrong, or the code changed). Fix the claim or remove it; never cite a line only to make the check pass. A **gap** is never an error: describe that store under `stores`, or leave it and say why.

## 5 · Show it

```sh
node <root>/tools/graph/graph.mjs render          # → .grimoire/graph/graph.html, open it at #data-0
```

Open the page locally (`open` on macOS, `xdg-open` on Linux) and point the user at the Data tab: the **Refined** section (lineage drawn from one store's entity to the other's with the field pairs, the described stores as cards with each field's line, the relations, index purposes, bindings and equivalences), a relation no foreign key states as a dashed line on its ERD, an index's purpose under its row, a key card saying when its logical table is refined or no code uses its name; drift as a badge and a list; the gaps.

Reply with the file's path, what the refined map adds in a sentence or two, what was left out and why, and the check's result (no drift; the gaps left).

## 6 · When a branch changes what a claim cites

`graph_changes` (`graph.mjs changes`) ends its data part with the refine files re-checked on the branch: a claim the branch broke is listed as drift. Update the refine file in the same pull request: move a citation to the line that now holds the name, rename an entity or field the code renamed, remove a claim the code no longer supports. Then `graph.mjs data check` until it passes, and tell the user in one message what drifted and what you did. Never block on it.

## Rules

- **The code is the source of truth.** Every claim is backed by a line you read; the check confirms names at lines, not meaning, so read before you claim.
- **Refined, never extracted.** Do not restate what the map already extracts (a foreign key, a declared index, a binding at convention): the check notes it, the file grows stale with it.
- **No guess pairs two tables.** An equivalence needs a line that ties the names (where the local name is set); a local declaration no code uses is reported as such, never paired.
- **Keep it local.** The refine file holds paths and structure: commit it with the docs; never publish the page unless the user explicitly asks.
- **Refine, don't regenerate.** Once written, a refine file is edited in place.
