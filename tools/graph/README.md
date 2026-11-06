# 🕸️ The code graph

A local index of every repository in the project: definitions and how they relate. It answers *research* questions fast (where is X, who calls it, what reaches this file, how does A get to B, what implements this trait, what changes together) so scouts and the design skills can map a change before anyone reads a line.

**It is a map, not the territory.** It never answers what code *does* or whether it is *right*: that is read in the code, at the `path:line` every answer carries, before anything is stated, planned or reviewed. The rule and who applies it are in `AGENTS.md` (*The code graph*).

## What it holds

| | |
| --- | --- |
| **Nodes** | files, functions, methods, constructors, classes, structs, interfaces, traits, protocols, enums, types, modules, namespaces, macros (test code is marked, and so is test-support code: Storybook stories, mocks, fixtures) |
| **Edges** | `CALLS`, `IMPORTS`, `EXTENDS`, `IMPLEMENTS`, plus co-change pairs from git history |
| **History** | per-file churn: how many of the last 400 non-merge commits touched the file (commits touching more than 25 indexed files skipped) |
| **Languages** | TypeScript, TSX, JavaScript, Python, Rust, Go, Java, Kotlin, C, C++, C#, Ruby, PHP, Swift (definitions and relations); Vue, Svelte, Scala, Dart, Lua, Elixir, Zig, Solidity, OCaml, Objective-C, shell, SQL, proto, GraphQL, HCL / Terraform (file nodes only, searchable by path) |
| **Data models** | the stores the migrations and schema snapshots declare: tables, fields, keys, indexes and foreign keys, each with the `path:line` of every declaration, and where two declarations disagree ([Data models](#data-models)) |
| **Storage** | one SQLite file, `.grimoire/graph/graph.db` (gitignored with the rest of `.grimoire/`) |

Parsing is [tree-sitter](https://tree-sitter.github.io/) (WASM grammars); storage is Node's built-in `node:sqlite`, so it needs **Node ≥ 22.5**.

### How an edge is resolved

There is no type checker. A call is linked by name, narrowed by what the syntax and the imports say, and every edge records how:

| Confidence | Meaning |
| --- | --- |
| `same-class` | `self.m()` / `this.m()`, or a bare call inside a class, to a member of that class or a supertype |
| `typed` | `x.m()` where the syntax states x's type (a typed parameter, `x = new T()`, `T::new()`, a Go receiver), to a member of `T` or a supertype |
| `qualified` | `Type.m()` / `Type::m()` to a member of that type |
| `import` | the name or its qualifier is bound by an import of the calling file |
| `same-file` · `same-package` | defined in the calling file, or its directory (Go, Java, Kotlin, Swift, C#) |
| `unique-name` | the only definition of that name in the repository |
| `ambiguous` | one of up to three same-named definitions; each gets an edge (`strict: true` drops them) |

`unique-name` and `ambiguous` are the **name guesses**: `graph_status` reports their share per repository, and the page draws them apart (dashed, or hidden until asked). Every other confidence is called *resolved by syntax* here, though `import`, `same-file` and `same-package` still match a name within the scope the syntax gives.

A call on a receiver whose type the repository does not define (a `HashMap`, a `Request`), or a name with more than three candidates, stays unresolved: those go to dependencies. So does a standard-library method name (`len`, `get`, `has`, `map`… listed per language in `COMMON_METHODS`, `lib/langs.mjs`) on a receiver whose type the syntax does not state, and any method on a chain that starts at a type or crate the repository does not define (`Utc::now().timestamp()`, `PutItemOutput::builder().build()`). Without that, the one `len` a repository defines collects every `.len()` in it. **A missing edge proves nothing**: dynamic dispatch, callbacks, reflection, config wiring, string-keyed routes and other repositories are invisible, so "no callers" is confirmed with grep.

## Using it

As MCP tools (the plugin declares the server in `.mcp.json`; agents see `mcp__plugin_grimoire_graph__*`):

| Tool | Answers |
| --- | --- |
| `graph_status` | what is indexed, how much resolved, how many call links are name guesses, what changed since |
| `graph_index` | build or refresh (incremental); `full: true` rebuilds |
| `graph_search` | definitions by name or `*` pattern, files by path fragment |
| `graph_symbol` | one definition: signature, container, members, caller/callee/subtype/test counts |
| `graph_callers` · `graph_callees` | call trees, `depth` 1–5 |
| `graph_impact` | blast radius of a symbol or file: what reaches it by calls, inheritance and imports, grouped by file, the tests on those paths, co-changing files |
| `graph_file` | outline, imports (resolved or external), importers, co-change |
| `graph_hierarchy` | supertypes and subtypes / implementors |
| `graph_path` | the shortest call chain from A to B |
| `graph_data` | the data model: every store, one store's entities, or one entity with its sources and conflicts |
| `graph_changes` | the data model of this branch against its base: added, removed and modified elements (before → after) with `path:line` on each side, and possible renames, never decided |
| `graph_sql` | a read-only `SELECT` for anything else |

Symbols are named as `area`, `Circle.area` / `Circle::area`, `path/to/file.ts:42` (the innermost definition there) or `#id` from an earlier answer. A name matching several definitions answers for each (up to five) and says how to narrow.

From a shell, the same commands:

```sh
node tools/graph/graph.mjs index                 # or: npm run graph -- index
node tools/graph/graph.mjs impact src/auth/session.ts --depth 2
node tools/graph/graph.mjs callers Session.refresh --strict
node tools/graph/graph.mjs sql "SELECT kind, count(*) FROM nodes GROUP BY kind"
node tools/graph/graph.mjs data list [<store>]        # the stores, or one store's entities
node tools/graph/graph.mjs data show books            # one entity: books, drizzle/books or repo:drizzle/books
node tools/graph/graph.mjs changes [--base main]      # the data model against a base (default: baseBranch, else the base branch, else main)
```

`--root <dir>` points it at another project; otherwise it serves `$GRIMOIRE_PROJECT_DIR`, `$CLAUDE_PROJECT_DIR` or the current directory.

## Seeing it

`node tools/graph/graph.mjs render` (or `/grimoire:graph`) refreshes the index, then writes one self-contained page, `.grimoire/graph/graph.html` (`--out` elsewhere; `--base <ref>` for the Data tab's change overlay): an overview; a system map of modules (`lib/modules.mjs`: folders of production code, a folder holding more than 35% of its repository split into its subfolders, linked by the file pairs that use each other through links resolved by syntax, ranked in the order code flows) that opens onto the file-level map (one cluster per directory, laid out once and deterministically by `lib/layout.mjs`); every file and symbol as a neighbourhood, what uses it on the left and what it uses on the right; and hotspots (a size × churn treemap, most called, widest fan-out, most used, co-change), ranked by resolved links. Test code and ambiguous links are hidden until asked for (the system map never shows them); each lane draws its 14 largest modules; every view has a plain anchor (`#sym-12`, `#file-3`, `#mod-4`, `#arch-0`, `#data-1`, `#doc-7`); `#sym-` and `#file-` numbers are index ids that change when that file is re-parsed, and `#mod-`, `#arch-`, `#data-` and `#doc-` numbers follow the order of modules, diagrams, data stores and notes, which shifts as they change: an anchor holds for the index the page was rendered from. No network, no CDN: the page's CSP admits only its own script, by hash. It stays local.

Three more tabs:

- **Architecture** draws the diagrams in `docs/architecture/*.architecture.json` (below) and one drafted from the graph on every render: typed components in their boundaries, labelled lines, a passport per component, upstream and downstream reach, route tracing along the drawn lines, and the code links no line draws.
- **Data** draws the data model the index read (*Data models*, below): an ERD per SQL store with tables, `#data-<n>` opening the nth of them in `graph_data`'s order. Each table lists its columns (type, `PK`, `FK`, a filled diamond for `NOT NULL`, a hollow one for nullable), its unique keys and declared indexes (the indexes SQLite builds for keys are a count on the store, not rows); a line runs from each foreign key's column (many) to the column it references (one). The layout is computed once per render, in Node and deterministically (`lib/data/layout.mjs`: a table left of the tables that reference it, linked tables grouped, crossings cut by barycentre sweeps, tables with no foreign key last). Search names tables and columns; a click focuses a table, lights it and its foreign key neighbours, and opens its passport: every column, key, index and foreign key (both ways) with the `path:line` of each declaration, linked to the file in the Files tab when it is indexed (`.sql` files are), plain text otherwise. A conflict is badged on its column or table with both values, its tooltip citing both sources. A store of more than 60 tables starts as names only: a focus draws the table with its neighbours, a search the matching tables (40 at most), each with its columns, laid out by the same function; *Columns* draws them all. Under the store picker, the folders found but not read (dialect or order unknown, Postgres and MySQL not read yet) are listed with their reason, and so are the extractors that failed: the map never pretends to be complete.

  **Changes vs `<base>`**, a toggle above the stores (off by default), draws the branch against its base (*The model against a base*, below): added tables, columns, keys, indexes and foreign keys in green; removed ones struck through in red, a removed table drawn as a ghost box among its foreign key neighbours (the overlay is laid out with them, so it always has a place); modified ones in amber, with before → after on their row and in the passport; possible renames linked, never decided (two tables by a dashed line, two columns or indexes of one table by a bracket beside their rows). A legend says which is which, the store picker counts each store's changes, a store gone from the branch is listed apart, and the passport lists a table's changes with the base's `path:line` as text (those lines are the base's, not the working tree's). The overlay is packed in Node when the page is rendered, against `--base`, else the same default base as `graph_changes`, so the page stays static and network-free; with no base to compare against (not a repository under version control, no such branch), the toggle is absent and the tab says why.
- **Docs** is every Markdown note of the project (`lib/docs.mjs`: each repository's `.md` and `.markdown` files, the graph's skips and excludes applied, plus the project root's own in a hub), rendered in the page by `lib/md.mjs` (CommonMark's common subset, GFM tables and task lists, Obsidian callouts, `[[wikilinks]]`, embeds as links, tags, front matter as properties; raw HTML only as attribute-free allowlisted tags; linear time on any input, and a note past 200 KB shows as plain text) as a vault: tree and search, outline, backlinks, the indexed files a note names (and, on a file's page, the notes naming it).

Moving around a drawing (`lib/stage-view.mjs`): the file map and the Architecture and Data diagrams pan with a drag on their background and zoom with the wheel. A drag never selects the page around them, not even one that starts on a component or table, and it keeps panning when the pointer leaves the drawing or the drawing reaches its edge, until the button is released; a click (3 px or less) on a file, component or table still opens it. On a touch screen a finger scrolls the Architecture and Data drawings natively and pans the file map. Each drawing is also focusable (Tab, or a click on its background): the arrow keys pan by 60 px, Shift + an arrow by most of the visible size (at an edge, the arrow scrolls the page instead), `+` / `=` and `−` zoom about the centre, `0` fits, and Escape leaves full size. The keys never act from the search box or the passport, nor with Ctrl, ⌘ or Alt held.

### Editing the notes: `serve`

`node tools/graph/graph.mjs serve [--port n]` serves the same page on `127.0.0.1` (`lib/serve.mjs`), re-rendered on every load, with one difference: its Docs tab can save. It prints one address carrying a random access token. It answers only requests that name it as their host (no DNS rebinding) and carry the token (in the page's address, then as a header the page sends: a cross-origin page can neither read it nor send it without a CORS preflight, which is never granted), refuses cross-origin writes and non-JSON bodies, and writes only `.md` / `.markdown` files inside the project's repositories (no `..`, no absolute path, no skipped folder in any letter case, no symlink out, no read-only note), each through a temporary file renamed over it; a note symlinked to another note is written through to its real file, so the link stays, and a symlink whose real file is not itself a note (`x.md → .git/config`, a script, an excluded folder) is refused. A save must name the hash the note was loaded with; one from a copy that changed on disk since is refused with the disk text (409), and the page offers to load it or overwrite. New notes may create their folders, never overwrite. Listing follows the same rule: a symlink out of a repository is never read into the page, served or not. The page's CSP adds `connect-src 'self'`, only when served.

## Architecture diagrams

A diagram is `docs/architecture/<name>.architecture.json` (`graph.architectureDir` moves the folder). [archify](https://github.com/tt-a1i/archify) was the example; the format is grimoire's own, shaped by what the code graph can check and free to evolve with it (no dependency, no compatibility promise): `components` (`id`, `label`, `sublabel`, `type`: frontend · backend · worker · database · messagebus · cloud · security · external · library · cli, `paths` globs of its code, `imports` package prefixes reaching it, `sources` as `repo:path:start-end`, `note`, `tag`, optional `col`/`row`), `connections` (`from`, `to`, `label`, `variant`: default · emphasis · security · async · dashed, `via` for what carries a line the code graph cannot see), `boundaries` (`label`, `kind`, `wraps`) and `cards`. `/grimoire:architecture` writes and refines them.

```sh
node tools/graph/graph.mjs architecture draft [--out <file>] [--title t] [--force]   # a draft from the graph
node tools/graph/graph.mjs architecture check [<file>…]                              # check against the index
```

`lib/arch.mjs` drafts deterministically (one component per module of the system map, typed by folder names and the frameworks it imports, external services from imports of known client libraries, a line per module link resolved by syntax) and checks: the schema, every `paths` glob matching indexed production files, every source existing with its lines, each line between two code components counted in file pairs linked by syntax (or in files importing a component's `imports`), lines the code shows only the other way, code links no line draws, files in two components, and the share of production files covered. It lays a diagram out by flow (a column per step, top-level boundaries as bands, rows ordered to cut crossings, free components placed beside their neighbours outside the bands), unless every component gives its `col` and `row`.

## Data models

The index also reads the project's data model from what declares it in the repositories, never from a database and never by running the project's code (`lib/data/`). Each extractor names a format, not a project (`lib/data/registry.mjs`), and its facts are stored per file or per folder (`data_inputs`, `data_facts` in `graph.db`); `lib/data/reconcile.mjs` merges them when asked.

- **SQL migration folders** (`extractors/sql-migrations.mjs`), found by content: any folder with a `.sql` file that creates or alters a table or an index, whatever it is called (`drizzle/`, `prisma/migrations/`, `db/sql/`, `storage/schema-changes/`…), with one migration per file or per versioned subfolder (`<version>_<name>/migration.sql` or `up.sql`). Once found, every file of it holding a schema statement (`CREATE`, `ALTER`, `DROP`: a file with only a `DROP` or a view included) is part of it. Down migrations (`down.sql`, `*.down.sql`, a `-- migrate:down` or `-- +goose Down` section) and files with no schema statement (seeds, queries) are left out, and so are test-support folders.
  - *Order*: Drizzle's `meta/_journal.json` when there is one, else the numeric or timestamp prefix of the names, compared as numbers (`V2` before `V10`). Names without one prefix scheme, or two sharing a version, leave the order unknown: the folder is listed, not replayed.
  - *Dialect*: `graph.data.migrations` in `grimoire.config.json`, a `drizzle.config.*` whose `out` is the folder, Drizzle's journal, Prisma's `migration_lock.toml` or `schema.prisma` datasource, Supabase (Postgres); else sniffed from the SQL's own markers (`readers/sql-dialect.mjs`: `AUTOINCREMENT`, `WITHOUT ROWID`, `PRAGMA`, `STRICT` for SQLite; `SERIAL`, `::`, `$$`, `JSONB`, `TIMESTAMPTZ`… for Postgres; `ENGINE=`, `AUTO_INCREMENT`, `UNSIGNED`, backticks for MySQL). No marker, or markers of two dialects, is *unknown*: listed, never replayed as SQLite by assumption.
  - *SQLite* folders are replayed into an in-memory `node:sqlite` database, statement by statement (`readers/sql-split.mjs`: Drizzle's `--> statement-breakpoint`, `;` outside quotes and comments), and read back with `PRAGMA table_xinfo`, `index_list`, `index_info`, `foreign_key_list`: exactly what a fresh database gets. Each table, column, key, index and foreign key cites the migration line that created or last altered it. A statement SQLite rejects stops the replay there: the facts so far are kept, labelled *replayed to `file:line`*, with the error. `ATTACH`, `DETACH` and `VACUUM` are never run, and SQLite itself keeps the replay off the disk: no database may be attached (which also stops `VACUUM INTO`) and an authorizer denies `ATTACH`, `DETACH` and the process-wide `temp_store_directory` and `data_store_directory` PRAGMAs, wherever Node provides them, confirmed by a probe on each replay. On a Node with neither, a statement naming one of those keywords stops the replay. Postgres and MySQL folders are listed as found, not yet read.
- **Drizzle snapshots** (`extractors/drizzle-snapshot.mjs`): the newest `meta/NNNN_snapshot.json` of a folder (`tables{}`), and drizzle-kit v1's `<version>_<name>/snapshot.json` (`ddl[]`, the leaves of its `prevIds` DAG), each element at its JSON line.

A replay and a snapshot of one folder are two declarations of one store. Elements that agree carry both sources; where they disagree (a hand-edited migration, a schema edited without a migration), the element keeps a **conflict** with every side and its source: nothing is resolved by precedence, since the disagreement is the finding. Composite primary keys compare as keys. A replay that stopped early is shown but compared with nothing. Primary and unique keys are elements of their own; the indexes SQLite builds for them are counted apart (`13 indexes (+21 implicit, for keys)`).

### The model against a base

`graph_changes` (and `graph.mjs changes`) compares the data model of this branch with its base's, element by element (`lib/data/diff.mjs`, Liam's approach): stores, tables and views, columns, keys, indexes and foreign keys, each **added**, **removed** or **modified** (each attribute that changed, before → after), with the `path:line` that declares it on its side. The elements of an added or removed table are not listed one by one; a store absent from the base is an added store, one absent from the branch a removed one, never an error.

- *The base*: `base` (`--base`) when given, else `baseBranch` in `grimoire.config.json`, else the branch the index is based on (`lib/freshness.mjs`: the upstream, `origin/HEAD`, `main`, `master`), else `main`; compared at its merge base with each repository's `HEAD`, as `git diff base...HEAD` and a pull request are, so what the base gained since the branch left it is not shown as the branch's doing. A ref given that names no commit is an error; a repository where it names none is left out of both sides, and said so.
- *Read through git, nothing checked out* (`lib/data/base.mjs`): the base commit's files (`git ls-tree`), the candidates the index would read, chosen by the same rules and config, read as blobs through one `git cat-file --batch` (`git show <commit>:<path>` without a process per file; binary-safe, capped as the index caps a file), then the same discovery and extractors (`registry.mjs` `extractAll`). The base's facts never enter `graph.db`: they are memoised per process by repository, commit, extractor versions and the config that steers discovery, and recomputed otherwise. The branch side is the index: the working tree, uncommitted edits included.
- *Compared as reconcile compares*: names in any letter case where the dialect's are (SQLite), types lower-cased and blank-collapsed, defaults without one outer pair of parentheses, a key by its role and columns, as a whole. A change of formatting is no change.
- *Rename candidates*: a removed and an added element of the same kind and shape (a table: its columns and their types, in order; a column: its type and position; an index: its columns, uniqueness and partiality; a foreign key: its columns on both sides) are flagged as a possible rename and never decided: both stay a removal and an addition. Several of one shape on each side form one ambiguous group, listed whole, never a guess at which pairs with which.

`graph_data` (and `graph.mjs data`) answers with the stores (dialect and how it is known, how each declaration was read, counts, conflicts, extractor failures), one store's entities, or one entity with every field, key, index and foreign key and their `path:line`. An extractor that throws loses that file's or folder's facts and is reported by `graph_status`, `graph_index` and `graph_data`; the index goes on. Like the rest of the graph, these are leads: open the `path:line` before relying on them.

## Freshness

`graph_index` re-parses only files whose size or mtime moved and whose content hash changed, drops deleted files, and re-resolves the edges of a repository that changed. The files the data model reads are tracked the same way, and a data job (a file, or a migration folder) runs again only when one of its inputs changed: an edited or deleted migration re-runs its folder. An index built by another grimoire version (its schema differs) is rebuilt in full, on the next query or index. Every query first checks (stat only) whether files moved and refreshes incrementally if they did, at most every 15 s per process. A project that was never indexed is not indexed implicitly by a query: the first `graph_index` installs the parser runtime and can take a while on a large tree.

Indexing is always this script, never a model. Three things run it:

- **After every subagent**: the plugin's `SubagentStop` hook runs `graph.mjs refresh` in the background, so the graph follows each implementer's commit and each integrate merge of the build loop. `refresh` builds the first index when `grimoire.config.json` has a `graph` block, and does nothing when the graph is disabled or was never set up.
- **Before a query**, as above.
- **By hand**: `graph_index`, or `npm run graph -- index`.

One indexer runs per index at a time (a lock next to it). A second one does not wait: it marks the index pending and the running one goes again before it finishes, so no change is lost.

**Worktrees.** Each checkout has its own index, since each branch has its own code (`lib/freshness.mjs`).

- *Its base.* The first of these branches that another checkout of the repository has checked out with an index: `baseBranch` in the config (`origin/dev` → `dev`), the branch's upstream when it names another branch, `origin/HEAD`, then `main`, then `master`. Otherwise the main checkout, whatever it holds. A branch stacked on `dev` is based on the checkout holding `dev`.
- *Seed.* A checkout with no index yet starts from a snapshot of its base's (`VACUUM INTO`), then re-parses only what its branch changed. Without `repos[]`, the one repository is named after the main checkout in every worktree, so the copied rows match.
- *Re-base.* Each index run, under its lock, first checks whether HEAD moved since the last index (a pull, a rebase, a merge of the base). If it did, it counts the files to re-parse from its own index (`git diff --name-only <indexed commit> HEAD`) and from the base's, and copies the base's index in one transaction when that saves at least 20 files (`GRIMOIRE_GRAPH_REBASE_MIN`). So once work is merged into main and main's index has it, a worktree that picks it up copies instead of parsing. The incremental index that follows makes the result match the working tree either way: re-basing changes the cost, never the answers. `graph_status` names the base, in `meta('base')`.
- The base's index is refreshed by its own checkout (its sessions, its hook, `refresh --root`), never from a worktree.

The build loop's lanes live under `.worktrees/`, which is not indexed; the run branch they merge into is.

Measured on this machine: ripgrep (114 Rust files) 0.7 s, FastAPI (1,147 Python files) 1.4 s, Vite (1,576 JS/TS files) 1.5 s, full index.

## Configuration (`grimoire.config.json`)

```json
"graph": { "enabled": true, "repos": ["api", "web"], "dir": ".grimoire/graph", "exclude": ["generated/**", "fixtures"], "maxFileKB": 512, "architectureDir": "docs/architecture",
           "data": { "migrations": [{ "path": "api:db/sql", "dialect": "sqlite" }] } }
```

`data.migrations` states a migration folder's dialect (`sqlite`, `postgres` or `mysql`) when no config of its tool says it and its SQL carries no marker: `path` is the folder, relative to its repository, prefixed with `repo:` in a project of several. It wins over every other source of the dialect.

All optional, and read as every checkout sees it: a linked worktree without its own `grimoire.config.json` uses the main checkout's (`scripts/project-config.mjs`). Without a config the project root is one repository. `repos` defaults to every entry of the top-level `repos[]`; `exclude` adds to the built-in skips (dependencies, build output, caches, minified and generated files, `.d.ts`). `enabled: false` turns every tool into a pointer back to grep.

## The parser runtime

The plugin ships no `node_modules`. The first index installs the pinned runtime (`web-tree-sitter` + `tree-sitter-wasms`, ~50 MB, lockfile-checked with `npm ci --ignore-scripts`) into the user cache (`~/Library/Caches/grimoire/graph-deps/<lock hash>` on macOS, `$XDG_CACHE_HOME` or `~/.cache` elsewhere, or `$GRIMOIRE_GRAPH_DEPS`), once per machine. `tools/graph/node_modules`, when present (`npm ci --prefix tools/graph`, as CI does), is used first.

Indexing always runs in a child process with V8's Liftoff-only WASM tier: some grammars crash the optimizing WASM compiler of current Node, and that must never take the MCP server down.

## Layout

```
tools/graph/
  mcp.mjs · graph.mjs          MCP server (stdio JSON-RPC) · CLI, over lib/commands.mjs
  lib/langs.mjs                per-language specs: definitions, calls, imports, supertypes, tests
  lib/bindings.mjs             variable → type, where the syntax states it
  lib/extract.mjs              one syntax tree → symbols, refs, imports
  lib/resolve.mjs              names → edges, per repository, with confidence
  lib/indexer.mjs · worker.mjs · run.mjs   incremental indexing, in a child process
  lib/store.mjs · query.mjs · cochange.mjs · project.mjs · deps.mjs
  lib/modules.mjs · layout.mjs · render.mjs   the page: modules and the system map, the file map's layout, the HTML
  lib/arch.mjs · arch-view.mjs architecture diagrams: draft, check, layout · the Architecture tab
  lib/docs.mjs · md.mjs · docs-view.mjs        the notes and what may be written · Markdown · the Docs tab
  lib/serve.mjs                the page on 127.0.0.1, saving notes
  lib/data/model.mjs · registry.mjs · reconcile.mjs   the data model: its shape, the extractors, merging declarations
  lib/data/diff.mjs · base.mjs  a model against another (added, removed, modified, rename candidates) · the model at a git ref
  lib/data/readers/            sql-split · sql-dialect · sqlite-replay · json-lines
  lib/data/extractors/         sql-migrations · drizzle-snapshot
  tests/graph.test.mjs         node tools/graph/tests/graph.test.mjs
  tests/arch-docs.test.mjs     node tools/graph/tests/arch-docs.test.mjs (no parser runtime needed)
  tests/data.test.mjs          node tools/graph/tests/data.test.mjs (part 1 needs no parser runtime)
```

Adding a data extractor: a file in `lib/data/extractors/` (`id`, `version`, `kind`, `scope`, `wants`, `discover`, `extract`, as `registry.mjs` describes), its entry in `EXTRACTORS`, and fixtures from two ecosystems in `tests/fixtures/data/` with their expected facts in `tests/data.test.mjs`. Bump its `version` whenever what it extracts changes, so stored facts are extracted again.

Adding a language: a spec in `lib/langs.mjs` (dump a sample's tree with web-tree-sitter to find the node types), a sample in `tests/fixtures/langs/` with its expected facts in the test.
