# 🕸️ The code graph

A local index of every repository in the project: definitions and how they relate. It answers *research* questions fast (where is X, who calls it, what reaches this file, how does A get to B, what implements this trait, what changes together) so scouts and the design skills can map a change before anyone reads a line.

**It is a map, not the territory.** It never answers what code *does* or whether it is *right*: that is read in the code, at the `path:line` every answer carries, before anything is stated, planned or reviewed. The rule and who applies it are in `AGENTS.md` (*The code graph*).

## What it holds

| | |
| --- | --- |
| **Nodes** | files, functions, methods, constructors, classes, structs, interfaces, traits, protocols, enums, types, modules, namespaces, macros (test code is marked) |
| **Edges** | `CALLS`, `IMPORTS`, `EXTENDS`, `IMPLEMENTS`, plus co-change pairs from git history |
| **Languages** | TypeScript, TSX, JavaScript, Python, Rust, Go, Java, Kotlin, C, C++, C#, Ruby, PHP, Swift (definitions and relations); Vue, Svelte, Scala, Dart, Lua, Elixir, Zig, Solidity, OCaml, Objective-C, shell, SQL, proto, GraphQL (file nodes only, searchable by path) |
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

A call on a receiver whose type the repository does not define (a `HashMap`, a `Request`), or a name with more than three candidates, stays unresolved: those go to dependencies. **A missing edge proves nothing**: dynamic dispatch, callbacks, reflection, config wiring, string-keyed routes and other repositories are invisible, so "no callers" is confirmed with grep.

## Using it

As MCP tools (the plugin declares the server in `.mcp.json`; agents see `mcp__plugin_grimoire_graph__*`):

| Tool | Answers |
| --- | --- |
| `graph_status` | what is indexed, how much resolved, what changed since |
| `graph_index` | build or refresh (incremental); `full: true` rebuilds |
| `graph_search` | definitions by name or `*` pattern, files by path fragment |
| `graph_symbol` | one definition: signature, container, members, caller/callee/subtype/test counts |
| `graph_callers` · `graph_callees` | call trees, `depth` 1–5 |
| `graph_impact` | blast radius of a symbol or file: what reaches it by calls, inheritance and imports, grouped by file, the tests on those paths, co-changing files |
| `graph_file` | outline, imports (resolved or external), importers, co-change |
| `graph_hierarchy` | supertypes and subtypes / implementors |
| `graph_path` | the shortest call chain from A to B |
| `graph_sql` | a read-only `SELECT` for anything else |

Symbols are named as `area`, `Circle.area` / `Circle::area`, `path/to/file.ts:42` (the innermost definition there) or `#id` from an earlier answer. A name matching several definitions answers for each (up to five) and says how to narrow.

From a shell, the same commands:

```sh
node tools/graph/graph.mjs index                 # or: npm run graph -- index
node tools/graph/graph.mjs impact src/auth/session.ts --depth 2
node tools/graph/graph.mjs callers Session.refresh --strict
node tools/graph/graph.mjs sql "SELECT kind, count(*) FROM nodes GROUP BY kind"
```

`--root <dir>` points it at another project; otherwise it serves `$GRIMOIRE_PROJECT_DIR`, `$CLAUDE_PROJECT_DIR` or the current directory.

## Seeing it

`node tools/graph/graph.mjs render` (or `/grimoire:graph`) refreshes the index, then writes one self-contained page, `.grimoire/graph/graph.html` (`--out` elsewhere): an overview, the file-level dependency map (one cluster per directory, laid out once and deterministically by `lib/layout.mjs`, the biggest files named, the rest on hover), every file and symbol with its callers, callees, dependencies and supertypes, and hotspots (most called, widest fan-out, most depended-on, co-change). No network, no CDN. It stays local.

## Freshness

`graph_index` re-parses only files whose size or mtime moved and whose content hash changed, drops deleted files, and re-resolves the edges of a repository that changed. Every query first checks (stat only) whether files moved and refreshes incrementally if they did, at most every 15 s per process. A project that was never indexed is not indexed implicitly by a query: the first `graph_index` installs the parser runtime and can take a while on a large tree.

Indexing is always this script, never a model. Three things run it:

- **After every subagent**: the plugin's `SubagentStop` hook runs `graph.mjs refresh` in the background, so the graph follows each implementer's commit and each integrate merge of the build loop. `refresh` builds the first index when `grimoire.config.json` has a `graph` block, and does nothing when the graph is disabled or was never set up.
- **Before a query**, as above.
- **By hand**: `graph_index`, or `npm run graph -- index`.

One indexer runs per index at a time (a lock next to it). A second one does not wait: it marks the index pending and the running one goes again before it finishes, so no change is lost.

**Worktrees.** Each checkout has its own index, since each branch has its own code. A linked git worktree with no index yet starts from a snapshot of the main checkout's, then re-parses only what its branch changed. The build loop's lanes live under `.worktrees/`, which is not indexed; the run branch they merge into is.

Measured on this machine: ripgrep (114 Rust files) 0.7 s, FastAPI (1,147 Python files) 1.4 s, Vite (1,576 JS/TS files) 1.5 s, full index.

## Configuration (`grimoire.config.json`)

```json
"graph": { "enabled": true, "repos": ["api", "web"], "dir": ".grimoire/graph", "exclude": ["generated/**", "fixtures"], "maxFileKB": 512 }
```

All optional. Without a config the project root is one repository. `repos` defaults to every entry of the top-level `repos[]`; `exclude` adds to the built-in skips (dependencies, build output, caches, minified and generated files, `.d.ts`). `enabled: false` turns every tool into a pointer back to grep.

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
  tests/graph.test.mjs         node tools/graph/tests/graph.test.mjs
```

Adding a language: a spec in `lib/langs.mjs` (dump a sample's tree with web-tree-sitter to find the node types), a sample in `tests/fixtures/langs/` with its expected facts in the test.
