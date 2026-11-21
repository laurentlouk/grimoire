// grimoire graph · the command surface, shared by the MCP server (mcp.mjs) and the CLI (graph.mjs).
// Each tool: name, description (what an agent reads to pick it), JSON-schema params, handler.
//
// Freshness: before answering, a query re-indexes incrementally when files moved since the last
// index (throttled to once per FRESH_MS per process). A project never indexed is not indexed
// implicitly: that is graph_index's job (or the SubagentStop hook's `refresh`), since the first run
// can take a while on a large tree. A checkout with no index is seeded from its base checkout's
// (the branch it is based on, else the main checkout: freshness.mjs), and every index run re-bases
// onto it when that saves parsing, so a worktree only re-parses what its branch changed.
import { existsSync, statSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { loadProject, scanRepo, listPaths, resolveInputPaths } from './project.mjs'
import { openStore, SCHEMA_VERSION } from './store.mjs'
import { runIndex } from './run.mjs'
import { seed } from './freshness.mjs'
import { candidates, inspect, asideOf, MAX_BYTES, SOURCE } from './data/registry.mjs'
import { resolveBase, modelAt, treeAt, blobs } from './data/base.mjs'
import { extractAside } from './data/readers/code-aside.mjs'
import { confinedDelta } from './docs.mjs'
import { parseDelta } from './data/delta.mjs'
import { readRefines, groupingFor } from './data/check.mjs'
import { docRoots } from './docs.mjs'
import { loadIndex } from './arch.mjs'
import { archScope, archImpact, archLines, archDeltaStates, archDeltaLines } from './arch-change.mjs'
import { changeImpact, readDiff } from './change.mjs'
import { diffModels } from './data/diff.mjs'
import { overview } from './overview.mjs'
import { routesTool } from './route-graph.mjs'
import { configAnswer, configDeclPaths } from './config.mjs'
import { Graph, sql, baseText, FOOTER, DATA_FOOTER, CHANGES_FOOTER, DELTA_FOOTER, ARCH_CHANGES_FOOTER, ARCH_DELTA_FOOTER } from './query.mjs'

const FRESH_MS = Number(process.env.GRIMOIRE_GRAPH_FRESH_MS ?? 15_000)
let lastFresh = 0

const symbolParam = { type: 'string', description: 'A name (`area`), a qualified name (`Circle.area`, `Circle::area`), `path/to/file.ext:line`, or `#id` from an earlier answer.' }
const repoParam = { type: 'string', description: 'Limit to one repository of the project (its name in grimoire.config.json).' }
const strictParam = { type: 'boolean', default: false, description: 'Drop `ambiguous` edges (a name with several same-named definitions) and `import-guess` ones (a method on a receiver of unknown type, picked because its file is imported): fewer leads, fewer false ones.' }
const depthParam = (d, max) => ({ type: 'integer', minimum: 1, maximum: max, default: d, description: `How many hops to follow (default ${d}, max ${max}).` })

export const TOOLS = [
  {
    name: 'graph_status',
    description: 'What the code graph holds: indexed repositories, languages, symbol and edge counts, how many call sites resolved, and whether files changed since the last index. Call first when unsure the graph covers the code in question.',
    params: {},
    run: (g, a, ctx) => g.status(ctx.fresh),
  },
  {
    name: 'graph_overview',
    description: 'The project at a glance, to start on an unknown codebase: per repository its languages, definitions and tests; its modules (folders of production code, users first) with what each uses and the share of its functions a test reaches; its routes (count, top prefixes); its entry points (functions nothing calls or passes as a value that call the most: where flows start, or code reached through config or a framework), the route handlers and screens listed apart; its most used definitions; and its hotspots (often changed and large). Then go to graph_file, graph_search or graph_impact.',
    params: { repo: repoParam, limit: { type: 'integer', default: 12, description: 'Rows per list (default 12).' } },
    run: (g, a) => overview(g, { repo: a.repo || null, limit: Math.max(1, Math.min(Number(a.limit) || 12, 50)) }),
  },
  {
    name: 'graph_index',
    description: 'Build or refresh the code graph (incremental: only changed files are re-parsed). The first run installs the parser runtime (~50 MB, once per machine) and may take a minute on a large tree. `full: true` rebuilds from scratch.',
    params: { full: { type: 'boolean', default: false }, repo: repoParam },
    index: true,
  },
  {
    name: 'graph_search',
    description: 'Find definitions (functions, methods, classes, structs, traits, interfaces, enums, types, modules) by name or fragment (`*` wildcards), or files by path fragment. Several words (`session refresh`) match definitions whose qualified name or path holds every word, best first. Returns #id, kind, path:line and signature; then the data model\'s tables and columns named like it (by their name, or the Drizzle variable or key code names them by), which graph_impact and graph_data take.',
    params: { query: { type: 'string', description: 'Name, fragment, `get*User`, several words (`user session`), or a path fragment like `auth/session`.' }, kind: { type: 'string', description: 'Only this kind, e.g. function, method, class, struct, trait, interface.' }, repo: repoParam, limit: { type: 'integer', default: 30 } },
    required: ['query'],
    run: (g, a) => g.search(a),
  },
  {
    name: 'graph_symbol',
    description: 'One definition in context: signature, container, members, and counts of callers, callees, supertypes, subtypes and test files reaching it (by calls, references, routes and a test file\'s imports, as graph_diff finds tests).',
    params: { symbol: symbolParam, repo: repoParam },
    required: ['symbol'],
    run: (g, a) => g.symbol(a),
  },
  {
    name: 'graph_callers',
    description: 'Who calls this symbol, as a tree up to `depth` hops. Each edge says how its name was resolved (same-class, typed, qualified, import, same-file, same-package; the name guesses unique-name, ambiguous and import-guess, a method on a receiver of unknown type picked because its file is imported).',
    params: { symbol: symbolParam, depth: depthParam(1, 5), strict: strictParam, repo: repoParam },
    required: ['symbol'],
    run: (g, a) => g.calls(a, 'in'),
  },
  {
    name: 'graph_callees',
    description: 'What this symbol calls, as a tree up to `depth` hops (calls into dependencies and the standard library are not in the graph).',
    params: { symbol: symbolParam, depth: depthParam(1, 5), strict: strictParam, repo: repoParam },
    required: ['symbol'],
    run: (g, a) => g.calls(a, 'out'),
  },
  {
    name: 'graph_impact',
    description: 'Blast radius of changing a symbol or a file, beyond what grep or the call edges alone show: everything reaching it through calls, inheritance, imports and routes (a call site naming a URL or a screen it handles) up to `depth` hops, grouped by file with distance; dispatch (a method\'s declarations on its interfaces, traits and base classes, whose callers may land on it, and the overrides or implementations that redefine it); the routes it handles with their callers in code and tests; the tests on those paths (a test calling its route among them); the configuration keys it reads (graph_config); the call sites naming it that resolution could not link (receiver of unknown type, too many same-named definitions); every other mention of its name in any file of the project that no edge explains, classified (a reference passed as a value, an unresolved import, a string key, config, markup, scripts, docs, comments) and never quoted; and the files that change together with it in git history. A data entity is a target too: a table (`notes`, `drizzle/notes`, `repo:drizzle/notes`, or the Drizzle variable code names it by) or a column (`notes.title`, or its Drizzle key): its declarations (schema, migrations, snapshot at path:line), its keys, indexes and foreign keys both ways, the functions reading and writing it (or naming the column) from the queries in code, what reaches those functions, and the table\'s mentions; when a code definition holds the name too, both are answered (`db:notes` names the data alone). A configuration key (`AUTH_JWT_SECRET`, `auth.secret`) answers with its readers, the keys it sets and their readers, what reaches them, and its other mentions; when a code definition holds the name too (a settings class\'s field), both are answered, the key first. Use it before changing something, to scope a plan, a task\'s declared files, or a review.',
    params: { target: { type: 'string', description: 'A symbol (as for graph_symbol), a file path, or a data entity: a table (`notes`, `store/notes`, `repo:store/notes`), a column (`notes.title`); `db:` before it names the data model alone.' }, depth: depthParam(3, 6), strict: strictParam, mentions: { type: 'boolean', default: true, description: 'Search the project\'s files for the name\'s mentions no edge explains (default true).' }, repo: repoParam },
    required: ['target'],
    run: (g, a, ctx) => g.impact(a, ctx.project),
  },
  {
    name: 'graph_diff',
    description: 'The impact of a change: what the working tree (committed, staged, unstaged and untracked) changed against a base, definition by definition, and what that can break that the diff does not show. Each definition added, removed, moved or modified, with its old and new signature when it changed (the base read through git, nothing checked out); for every contract change (removed, moved, new signature) who still names it: linked callers (inside or outside this diff), call sites resolution could not link, and the name\'s other mentions in the project (references passed as values, unresolved imports, string keys, config, scripts), classified and never quoted; the files reaching the changed definitions outside the diff (calls, inheritance, imports, dispatch through interfaces, overrides and implementations left unchanged); the routes the changed handlers serve, and the routes the base served that no route serves now (a route file moved or removed, a handler removed) with the call sites still naming them; the tests to run (a test calling a changed handler\'s route among them) and the changed code no test reaches; the files that usually change with the changed ones (git history) and are not in the diff; and a risk line with its reasons. The data model\'s changes against the same base follow the definitions (tables, columns, keys, indexes and foreign keys added, removed or modified, as graph_changes reads them), and a table or column removed or retyped that the code still names (the SQL the code sends, the Drizzle query builder\'s calls, an ORM class\'s attribute) is a contract change too; a not-null column added with no default lists the inserts that leave it out, and the conflicts between a code model and its migrations the diff creates are listed. Use it before committing, to review a branch, or to check a task\'s footprint. `base: "HEAD"` limits it to the uncommitted changes.',
    params: { base: { type: 'string', description: 'A branch, tag or commit; compared at its merge base with HEAD (default: baseBranch, else the base branch, else main). HEAD: only what is not committed.' }, depth: depthParam(2, 5), mentions: { type: 'boolean', default: true, description: 'Search the project for the mentions of contract changes (default true).' }, repo: repoParam },
    run: async (g, a, ctx) => {
      const base = resolveBase(ctx.project, { explicit: a.base || null, repo: a.repo || null })
      if (base.error) throw new Error(base.error)
      base.text = baseText(base)
      // the data model against the same base, as graph_changes reads it (the refine files' equivalences
      // grouping both sides alike), when the diff touches a file the data extractors read (a data input
      // the index holds, on either side of a rename, or a candidate of a format they read)
      let data = null
      const diff = readDiff(base, ctx.project, a.repo || null)
      if (touchesModel(g, ctx.project, diff)) {
        try {
          const eq = groupingFor(readRefines(ctx.project.architectureDir, ctx.project.root), docRoots(ctx.project))
          const at = await modelAt(ctx.project, base, eq)
          const current = g.currentModel(base.repos.map((r) => r.name), eq)
          const d = diffModels(at.model, current)
          data = d.stores.length || current.stores.length || at.model.stores.length ? { d, current, base: at.model, baseRows: at.rows } : null
        } catch (e) { data = { why: String(e?.message || e).split('\n')[0].slice(0, 200) } }
      }
      return changeImpact(g, ctx.project, base, { repo: a.repo || null, depth: Math.max(1, Math.min(Number(a.depth) || 2, 5)), text: a.mentions !== false && a.mentions !== 'false', data, diff })
    },
  },
  {
    name: 'graph_routes',
    description: 'The project\'s routes: HTTP routes (method + path template → handler definition: Express, Koa, Hono, Fastify, NestJS, Next.js route files and pages/api, Expo API routes, FastAPI, Flask, Django urls.py, Spring, Go net/http, gin, echo, chi, gorilla/mux, Rails config/routes.rb) and app navigation screens (Expo Router files, React Navigation screens), each path composed through the routers, groups and mounts the syntax states (a prefix the code computes is `{…}`, never guessed). No argument: every route with its handler and how many places call it. A path fragment, `GET /users`, a method or `kind` filters; one route (its path, or #r<id>) shows its handler path:line, its middleware where the syntax shows it, and its callers in code and in tests: the strings that are a URL matching its template (`/users/me`, `` `/a/${id}` ``, `\'/a/\' + slug`, a generated client\'s path, a `<Link href>`, `router.push`) or a screen name given to `navigate`, each with how it matched (exact, template, prefix unknown, name). Only the route\'s own path template is ever shown, never a call\'s text, query string or host.',
    params: { query: { type: 'string', description: 'A path fragment (`/users`), `METHOD /path`, a screen name, or #r<id> from an earlier answer.' }, method: { type: 'string', description: 'Only routes answering this method (GET, POST, …).' }, kind: { type: 'string', description: '`http` or `screen`.' }, repo: repoParam, limit: { type: 'integer', default: 60 } },
    run: (g, a) => routesTool(g, { query: a.query || '', method: a.method || '', kind: a.kind || '', repo: a.repo || '', limit: a.limit }),
  },
  {
    name: 'graph_file',
    description: 'A file at a glance: outline of its definitions with lines, what it imports (resolved to files, or external), what imports it, and what changes together with it.',
    params: { path: { type: 'string', description: 'File path, project-relative or repo-relative; a unique suffix is enough.' }, repo: repoParam },
    required: ['path'],
    run: (g, a) => g.file(a),
  },
  {
    name: 'graph_hierarchy',
    description: 'Supertypes (extends / implements / trait impls) and subtypes or implementors of a class, struct, trait, interface or protocol.',
    params: { symbol: symbolParam, depth: depthParam(3, 6), repo: repoParam },
    required: ['symbol'],
    run: (g, a) => g.hierarchy(a),
  },
  {
    name: 'graph_path',
    description: 'The shortest call chain from one symbol to another, if the graph has one: "how does the request handler reach the database write?"',
    params: { from: symbolParam, to: symbolParam, depth: depthParam(6, 10), strict: strictParam, repo: repoParam },
    required: ['from', 'to'],
    run: (g, a) => g.path(a),
  },
  {
    name: 'graph_data',
    description: 'The data model, read from SQL migrations (SQLite replayed; Postgres and MySQL read statement by statement, in each migration tool\'s order, the statements that do not shape the store counted), schema dumps (beside the replay, listed first), schema snapshots, code-declared SQL models (Drizzle TypeScript schemas, Prisma schemas: declarations of the store their migrations go to, so a schema edited with no migration generated is a conflict, and a push-only project\'s schema is its store) and key-value table declarations (DynamoDB CreateTable inputs, CloudFormation, SAM and Serverless table resources, JSON or YAML; Terraform aws_dynamodb_table resources, evaluated through the Terragrunt inputs or tfvars that set their module\'s variables), never from a database. No argument: every store (a migration folder, found by its DDL whatever its name: its dialect and how that is known; or a repository\'s key-value tables, `dynamodb`, found by their content; how each was read, its tables, foreign keys, indexes and conflicts). `store`: its entities. `entity`: one table with its fields, keys, indexes and foreign keys (for a key-value table: its attributes, partition and sort keys, TTL, GSIs and LSIs with their projection, stream and billing; references such as !Ref kept unresolved, a Terraform value no file states, such as another configuration\'s output, kept as ${…} and a name with such a part as its template, never guessed), each citing the path:line that declares it, and the conflicts where two declarations disagree (both sides kept). Key-value tables carry their item shapes, read from the Rust serde structs and TypeScript types the code converts to or from an item: the logical tables (one table declared in several places, grouped by its name template, never by a bare name across repositories, with the conflicts across its declarations, local-dev against prod), the item types each with the table it is bound to, the confidence (declared, convention, name-match, ambiguous), the way (an environment variable the infra sets, a name the table\'s template matches, in one function or one file) and its rivals, the unbound types; and for one table, its item tree (fields by dotted path, keys marked) and each binding\'s evidence at its path:line. Access patterns, inferred from the key-value SDK calls of Rust, TypeScript, JavaScript, Python and Go code: for one table, each GSI or LSI with the functions that query it (the code graph\'s symbols, path:line, callers) or the lead "no access found" (what was searched, and that a constant built elsewhere, another repository or a script may reach it: never a verdict), the functions that read and write it with their operations, and an attribute a call writes that the bound item does not state as an inferred conflict; a key-value table no item type is bound to and no call reaches says "declared, no code uses this name". Refined facts, from the refine files beside the diagrams (docs/architecture/*.data.json, written by /grimoire:data-model), each labelled refined and re-checked on every answer against the code and the model: lineage across stores (an entity mirroring another, field pairs), relations no foreign key states, what an index is for, bindings the script left ambiguous, equivalences (declarations of one table no evidence ties, such as a local-dev table and its production template: grouped, so their differences are conflicts) and stores no extractor reads, described entity by entity with a path:line per field (`store` or `entity` lists them); a claim that no longer holds is drift, listed with why and never trusted. SQL schemas inferred from the queries in code (for a database nothing in the repositories declares): the SQL TypeScript, JavaScript, Go, Python and Rust code sends to its query calls (a literal, a same-file constant, a concatenation, a format string; what code fills in is a parameter, never evaluated, so a table named by one is never a table; only identifiers kept, never a value) read statement by statement: per repository, attached to a declared SQL store only on evidence (the same client, the module they share; the only store of its dialect or of the repository only when the queries name a table it declares), saying how many of the tables they name it declares, adding only an [inferred] conflict where the code names a table or column the declarations lack and the code\'s access sites; otherwise a store of its own, `<repo>:sql (inferred, <dialect>)`, named by its clients, labelled inferred: its tables, the columns seen, relations inferred from a join (never foreign keys), unique keys from ON CONFLICT, lookup columns (leads for an index, never indexes), readers and writers per function, each at the path:line of every statement that shows it; types (but casts), nullability and defaults unknown. The Drizzle queries in code (inferred, identifiers only): for a table a Drizzle schema declares, the functions reading and writing it through the query builder (select … from, joins, insert, update, delete, $count, sql`` templates) and the relational API (db.query.<key>.findMany / findFirst and its `with`), each with its operations, the columns it names and the tables it joins, resolved through the schema\'s variables and relations(); the names no schema table resolves; where a running app applies the store\'s migrations (migrate, useMigrations). Gaps: the datastores the code reaches through client imports with no extractor and no refine entry (a client whose queries are read is none). Leads, never the database.',
    params: { store: { type: 'string', description: 'A store: its folder (`drizzle`), `dynamodb` for a repository\'s key-value tables, `repo:folder`, or a deduced one as listed (`api:sql (inferred, postgres)`). Lists its entities.' }, entity: { type: 'string', description: 'One entity: `books`, `drizzle/books` or `repo:drizzle/books`.' }, repo: repoParam },
    run: (g, a, ctx) => g.data(a, ctx.project),
    footer: DATA_FOOTER,
  },
  {
    name: 'graph_changes',
    description: 'The data model of this branch against its base, element by element: stores, tables, columns, keys, indexes and foreign keys added, removed or modified (before → after), each with the path:line that declares it on its side, a key-value table\'s item fields too (`<table>.<field path>`, what each bound type stores there), and possible renames (a removed and an added element of the same shape), flagged and never decided. The base is read through git at its commit, nothing checked out: `base` when given, else baseBranch in grimoire.config.json, else the branch the index is based on, else main, compared at its merge base with HEAD. The branch side is the working tree as indexed. With `delta` (a design\'s docs/specs/<date>-<topic>.delta.json): each change it proposes with its state against the code (planned and built, pending, built differently: planned → built), its acknowledgement (acknowledged, stale once edited since, or not), then the branch\'s changes no change of the delta covers (unplanned), and a summary. The architecture follows, when the project saves diagrams (docs/architecture/*.architecture.json) or the delta proposes architecture changes: the diagrams against the base (components, connections, boundaries added, removed or modified), the check\'s findings on this index and not on the base checkout\'s (a new link no line draws, a module no component covers, a new external service by import, a drawn line the code no longer shows; with no base checkout index, only the diagram files are compared and it says so), and with `delta` each architecture change\'s state against the diagrams and the impact no change covers (unplanned). `repo` leaves the architecture out.',
    params: { base: { type: 'string', description: 'A branch, tag or commit to compare against (default: baseBranch, else the base branch, else main).' }, delta: { type: 'string', description: 'A design\'s delta beside the specs, as a path relative to the project root: docs/specs/<date>-<topic>.delta.json (or <repo folder>/docs/specs/… for a repository\'s own). Only such a file is read.' }, repo: repoParam },
    run: async (g, a, ctx) => {
      const base = resolveBase(ctx.project, { explicit: a.base || null, repo: a.repo || null })
      // the refine files' equivalences group both sides alike (a diff compares the code), and their
      // claims are re-checked on this branch after the data model's part (no `repo`: they span them)
      const refines = readRefines(ctx.project.architectureDir, ctx.project.root)
      const eq = groupingFor(refines, docRoots(ctx.project)) // the equivalences that hold: their citations checked
      const refined = () => (a.repo ? '' : g.refinedChanges(ctx.project, refines))
      // the architecture's part (arch-change.mjs), after the data model's, when there is anything to
      // say: a saved diagram now or at the base, or a change the delta proposes, found before any
      // index is loaded (archScope), so a data-only answer costs and reads as it did. Diagrams span
      // the repositories: `repo` leaves it out. ctx.arch tells call() which footer to give.
      const arch = async (delta) => {
        if (a.repo) return ''
        const scope = archScope(ctx.project, base.error ? null : base, !!(delta && delta.architecture.length))
        if (!scope.has) return ''
        ctx.arch = true
        const impact = await archImpact(ctx.project, base.error ? null : base, { idx: () => loadIndex(g.db), scope })
        if (!delta) return `\n\n${archLines(impact, baseText(base)).join('\n')}`
        const s = archDeltaStates(delta.architecture, impact.current, { base: impact.before, impact: base.error ? null : impact })
        return `\n\n${archDeltaLines(s, { against: !base.error, impact, baseText: base.error ? '' : baseText(base), why: base.error }).join('\n')}`
      }
      if (!a.delta) {
        if (base.error) throw new Error(base.error)
        return g.changes(base, await modelAt(ctx.project, base, eq), eq) + refined() + await arch(null)
      }
      const file = confinedDelta(ctx.project, String(a.delta))
      if (base.error && a.base) throw new Error(base.error)
      const { delta } = parseDelta(file.text)
      return g.delta(file, base.error ? { why: base.error } : { base, at: await modelAt(ctx.project, base, eq) }, a.repo || null, eq) + refined() + (delta ? await arch(delta) : '')
    },
    footer: CHANGES_FOOTER,
  },
  {
    name: 'graph_config',
    description: 'Configuration keys, names only (never a value): environment variables and config paths, where the code reads them and where the project declares them. Reads: process.env.X, import.meta.env.X, Deno.env, os.environ / os.getenv / environ, pydantic BaseSettings fields (upper-cased, env_prefix), os.Getenv and env struct tags, System.getenv and @Value("${a.b}"), ENV[\'X\'] / ENV.fetch, std::env::var, getenv / env() / config(), Environment.GetEnvironmentVariable / Configuration["A:B"], NestJS ConfigService.get(\'a.b\'), Expo Constants.expoConfig.extra.x; each with the definition that reads it and its path:line. Declarations: .env.example / .env.sample / .env.template (names only; no other env or credential file is ever read), docker-compose environment:, CI workflow env:, .gitlab-ci.yml variables:, app.json expo.extra, application.properties / application.yml, and in code registerAs(\'ns\', () => ({ k: … })), a Nest config factory and app.config extra. Mappings where the syntax states them: `ns.k` ← X for registerAs\'s `k: process.env.X`, so an environment variable is followed to the code that reads the config path it sets. No key: every key (or those matching a fragment or a * pattern) with its reads, declarations and mappings, then the keys read but declared nowhere and those declared but read nowhere. One key: who reads it (definitions, path:line), what it sets and who reads that, what sets it, where it is declared. graph_impact on a definition lists the keys it reads.',
    params: { key: { type: 'string', description: 'A key (`AUTH_JWT_SECRET`, `auth.secret`, `extra.apiUrl`), a fragment, or a `*` pattern (`AUTH_*`). Omit to list every key.' }, kind: { type: 'string', enum: ['env', 'config'], description: 'Only environment variables, or only config paths.' }, repo: repoParam, limit: { type: 'integer', default: 60, description: 'Keys listed (default 60).' } },
    run: (g, a) => configAnswer(g, { key: a.key || null, kind: a.kind || null, repo: a.repo || null, limit: a.limit }),
  },
  {
    name: 'graph_sql',
    description: 'A read-only SELECT over the graph for questions the other tools do not answer. Tables: files(id, repo, path, lang, is_test, node_id), nodes(id, file_id, kind, name, qualname, parent_id, line, end_line, signature, is_test, via: framework for a member a framework call declares), edges(src, dst, kind CALLS|IMPORTS|EXTENDS|IMPLEMENTS|REFERENCES|ROUTES_TO, confidence, line), imports(file_id, source, names, resolved), cochange(repo, a, b, n), churn(repo, path, n: recent commits touching the file), repos(name, root, head, indexed_at), routes(id, file_id, line, kind http|screen, method, path, framework, handler_id, full: JSON paths it serves under), route_refs(id, file_id, src_id, line, kind, method), route_links(ref_id, route_id, how), config(repo, path, file_id, node_id, key, kind env|config, role read|declare|map (helper and defer: an env helper and a read the imports resolve, keyed `@…`), src_key, via, line: configuration key names, never values).',
    params: { sql: { type: 'string', description: 'One SELECT or WITH … SELECT statement.' } },
    required: ['sql'],
    raw: true,
  },
]

// Does a diff change what the data model holds, on either side? A data input that is no source file (a
// migration, a snapshot, a template) does whenever it changed. A source file does by its level's bits
// (registry.mjs inspect), now (the index) or at the base (its text there): a bit that declares a store
// (a schema, a model, an entity, a migration in code, a key-value cache's commands) always does; the
// SQL and the query-builder calls code sends and the access patterns are never compared at a base; what
// the item binding reads (TypeScript types, serde structs: bit 1) does only when the file's facts
// changed, read at the base aside (code-aside.mjs) and compared with the index's, line numbers aside.
const NOT_COMPARED = 2 | 64 | 2097152, BINDING = 1
const lineless = (v) => (Array.isArray(v) ? v.map(lineless) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !/^(line|end|start)$/.test(k)).map(([k, x]) => [k, lineless(x)])) : v)
function touchesModel(g, project, diff) {
  const input = g.db.prepare('SELECT ddl FROM data_inputs WHERE repo = ? AND path = ?')
  const factsOf = g.db.prepare('SELECT extractor, facts FROM data_facts WHERE repo = ? AND key = ?')
  const sources = [] // the source files whose bits need their base text
  const source = (p) => SOURCE.some((ex) => ex.wants(p))
  for (const f of diff) {
    const now = f.path ? input.get(f.repo, f.path) : null
    if (now && now.ddl === null) return true // too large to inspect: assume it does
    const sides = [f.path, f.oldPath].filter((p) => p && candidates([p], project).length > 0)
    if (!sides.length) { if (now && now.ddl > 0) return true; continue }
    if (sides.some((p) => !source(p))) { if (f.path && now && !source(f.path) ? now.ddl > 0 : true) return true; continue }
    sources.push({ f, now: now ? now.ddl : 0 })
  }
  if (!sources.length) return false
  // the base's texts of those files, one git read per repository
  const was = new Map()
  for (const [repo, list] of Map.groupBy(sources.filter((x) => x.f.oldPath && x.f.status !== 'A'), (x) => x.f.repo)) {
    const { abs, commit } = list[0].f
    const tree = treeAt(abs, commit, list.map((x) => x.f.oldPath))
    const want = list.map((x) => tree.get(x.f.oldPath)).filter((e) => e && e.size <= MAX_BYTES)
    const got = blobs(abs, want)
    for (const x of list) { const e = tree.get(x.f.oldPath), b = e && got.get(e.oid); if (b) was.set(`${repo}|${x.f.oldPath}`, b.toString('utf8')) }
  }
  const compare = []
  for (const { f, now } of sources) {
    const text = f.oldPath ? was.get(`${f.repo}|${f.oldPath}`) : null
    const bits = (now || 0) | (text != null ? inspect(f.oldPath, text) || 0 : 0)
    if (bits & ~(NOT_COMPARED | BINDING)) return true
    if (!(bits & BINDING)) continue
    if (f.status !== 'M' || text == null) return true // a file that came, went or moved: its declarations did
    compare.push({ f, text })
  }
  if (!compare.length) return false
  const items = compare.flatMap(({ f, text }) => asideOf(f.oldPath, text).map((ex) => ({ id: ex.id, path: f.oldPath, text, key: `${f.repo}\0${ex.id}\0${f.oldPath}` })))
  const base = extractAside(items)
  for (const { f, text } of compare) {
    const ids = asideOf(f.oldPath, text).map((ex) => ex.id)
    const cur = new Map(factsOf.all(f.repo, f.path).map((r) => [r.extractor.split('@')[0], r.facts]))
    for (const id of new Set([...ids, ...[...cur.keys()].filter((k) => ['ts-types', 'serde'].includes(k))])) {
      const b = base.get(`${f.repo}\0${id}\0${f.oldPath}`)
      if (b instanceof Error || b === undefined || !cur.has(id)) return true
      if (JSON.stringify(lineless(b)) !== JSON.stringify(lineless(JSON.parse(cur.get(id))))) return true
    }
  }
  return false
}

// Files that moved since the last index, per repo (cheap: stat only, no parsing): code files, the
// files data extractors read, the configuration declarations, and the files module resolution reads.
// An index built by another grimoire version is stale as a whole: the next refresh rebuilds it with
// the current rules.
export function staleness(project, db) {
  const out = {}
  const schema = (() => { try { return db.prepare("SELECT value FROM meta WHERE key = 'schema'").get()?.value } catch { return null } })()
  if (schema && schema !== SCHEMA_VERSION) { for (const repo of project.repos) out[repo.name] = 'built by another grimoire version: rebuilt on the next query'; return out }
  for (const repo of project.repos) {
    const rels = listPaths(repo.abs)
    const known = new Map(db.prepare('SELECT path, size, mtime FROM files WHERE repo = ?').all(repo.name).map((f) => [f.path, f]))
    let changed = 0
    for (const f of scanRepo(repo, project, rels)) { const k = known.get(f.path); if (!k || k.size !== f.size || k.mtime !== f.mtime) changed++; known.delete(f.path) }
    changed += known.size
    const inputs = new Map(db.prepare('SELECT path, size, mtime FROM data_inputs WHERE repo = ?').all(repo.name).map((f) => [f.path, f]))
    for (const p of candidates(rels, project)) {
      let st
      try { st = statSync(path.join(repo.abs, p)) } catch { continue }
      const k = inputs.get(p)
      if (!k || k.size !== st.size || k.mtime !== Math.floor(st.mtimeMs)) changed++
      inputs.delete(p)
    }
    changed += inputs.size
    for (const [table, paths] of [['config_inputs', configDeclPaths(rels, project)], ['resolve_inputs', resolveInputPaths(rels)]]) {
      let tracked = new Map()
      try { tracked = new Map(db.prepare(`SELECT path, size, mtime FROM ${table} WHERE repo = ?`).all(repo.name).map((f) => [f.path, f])) } catch {}
      for (const p of paths) {
        let st
        try { st = lstatSync(path.join(repo.abs, p)) } catch { continue }
        const k = tracked.get(p)
        if (!k || k.size !== st.size || k.mtime !== Math.floor(st.mtimeMs)) changed++
        tracked.delete(p)
      }
      changed += tracked.size
    }
    if (changed) out[repo.name] = `${changed} file(s) changed since`
  }
  return out
}

export async function call(name, args = {}, { root, log = () => {} } = {}) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`unknown tool ${name}`)
  const project = loadProject(root)
  if (!project.enabled) return 'The code graph is disabled for this project (grimoire.config.json: graph.enabled = false). Use Grep/Glob/Read.'
  await seed(project).catch((e) => log(`could not seed from the base checkout: ${e.message}`))

  if (tool.index) {
    const r = await runIndex(project.root, { full: !!args.full, repo: args.repo || null, onLog: log })
    lastFresh = Date.now()
    if (r.error) return `Index failed: ${r.error}`
    if (r.busy) return 'Another index of this project is running; it will pick up the current changes before it finishes.'
    return [`Indexed in ${(r.ms / 1000).toFixed(1)}s.`, ...r.repos.map((x) => `  ${x.repo}: ${x.files} files, ${x.parsed} parsed, ${x.removed} removed${x.failed.length ? `, ${x.failed.length} failed to parse (${x.failed.slice(0, 3).join('; ')})` : ''}${x.data?.failed.length ? `, ${x.data.failed.length} data extractor failure(s) (${x.data.failed.slice(0, 3).join('; ')})` : ''}`)].join('\n')
  }

  if (!existsSync(project.dbPath)) return 'The code graph has not been built for this project yet: call graph_index first (or answer with Grep/Glob/Read).'
  let note = ''
  if (Date.now() - lastFresh >= FRESH_MS) {
    const probe = await openStore(project.dbPath, { readOnly: true })
    const stale = staleness(project, probe)
    probe.close()
    lastFresh = Date.now()
    if (Object.keys(stale).length) {
      const r = await runIndex(project.root, { onLog: log })
      note = r.error ? `(refresh failed, answering from the previous index: ${r.error})\n` : r.busy ? '(another index is running; answering from the previous index)\n' : ''
    }
  }
  const db = await openStore(project.dbPath, { readOnly: true })
  try {
    if (tool.raw) return sql(db, args.sql)
    const g = new Graph(db)
    const fresh = name === 'graph_status' ? staleness(project, db) : null
    const ctx = { fresh, project, arch: false }
    const text = await tool.run(g, args, ctx)
    const footer = name === 'graph_changes' ? (args.delta ? (ctx.arch ? ARCH_DELTA_FOOTER : DELTA_FOOTER) : ctx.arch ? ARCH_CHANGES_FOOTER : CHANGES_FOOTER) : tool.footer || FOOTER
    return `${note}${text}\n\n${footer}`
  } finally { db.close() }
}
