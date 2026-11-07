// grimoire graph · the command surface, shared by the MCP server (mcp.mjs) and the CLI (graph.mjs).
// Each tool: name, description (what an agent reads to pick it), JSON-schema params, handler.
//
// Freshness: before answering, a query re-indexes incrementally when files moved since the last
// index (throttled to once per FRESH_MS per process). A project never indexed is not indexed
// implicitly: that is graph_index's job (or the SubagentStop hook's `refresh`), since the first run
// can take a while on a large tree. A checkout with no index is seeded from its base checkout's
// (the branch it is based on, else the main checkout: freshness.mjs), and every index run re-bases
// onto it when that saves parsing, so a worktree only re-parses what its branch changed.
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { loadProject, scanRepo, listPaths } from './project.mjs'
import { openStore, SCHEMA_VERSION } from './store.mjs'
import { runIndex } from './run.mjs'
import { seed } from './freshness.mjs'
import { candidates } from './data/registry.mjs'
import { resolveBase, modelAt } from './data/base.mjs'
import { confinedDelta } from './docs.mjs'
import { parseDelta } from './data/delta.mjs'
import { loadIndex } from './arch.mjs'
import { archScope, archImpact, archLines, archDeltaStates, archDeltaLines } from './arch-change.mjs'
import { Graph, sql, baseText, FOOTER, DATA_FOOTER, CHANGES_FOOTER, DELTA_FOOTER, ARCH_CHANGES_FOOTER, ARCH_DELTA_FOOTER } from './query.mjs'

const FRESH_MS = Number(process.env.GRIMOIRE_GRAPH_FRESH_MS ?? 15_000)
let lastFresh = 0

const symbolParam = { type: 'string', description: 'A name (`area`), a qualified name (`Circle.area`, `Circle::area`), `path/to/file.ext:line`, or `#id` from an earlier answer.' }
const repoParam = { type: 'string', description: 'Limit to one repository of the project (its name in grimoire.config.json).' }
const strictParam = { type: 'boolean', default: false, description: 'Drop `ambiguous` edges (a name with several same-named definitions): fewer leads, fewer false ones.' }
const depthParam = (d, max) => ({ type: 'integer', minimum: 1, maximum: max, default: d, description: `How many hops to follow (default ${d}, max ${max}).` })

export const TOOLS = [
  {
    name: 'graph_status',
    description: 'What the code graph holds: indexed repositories, languages, symbol and edge counts, how many call sites resolved, and whether files changed since the last index. Call first when unsure the graph covers the code in question.',
    params: {},
    run: (g, a, ctx) => g.status(ctx.fresh),
  },
  {
    name: 'graph_index',
    description: 'Build or refresh the code graph (incremental: only changed files are re-parsed). The first run installs the parser runtime (~50 MB, once per machine) and may take a minute on a large tree. `full: true` rebuilds from scratch.',
    params: { full: { type: 'boolean', default: false }, repo: repoParam },
    index: true,
  },
  {
    name: 'graph_search',
    description: 'Find definitions (functions, methods, classes, structs, traits, interfaces, enums, types, modules) by name or fragment (`*` wildcards), or files by path fragment. Returns #id, kind, path:line and signature.',
    params: { query: { type: 'string', description: 'Name, fragment, `get*User`, or a path fragment like `auth/session`.' }, kind: { type: 'string', description: 'Only this kind, e.g. function, method, class, struct, trait, interface.' }, repo: repoParam, limit: { type: 'integer', default: 30 } },
    required: ['query'],
    run: (g, a) => g.search(a),
  },
  {
    name: 'graph_symbol',
    description: 'One definition in context: signature, container, members, and counts of callers, callees, supertypes, subtypes and tests reaching it.',
    params: { symbol: symbolParam, repo: repoParam },
    required: ['symbol'],
    run: (g, a) => g.symbol(a),
  },
  {
    name: 'graph_callers',
    description: 'Who calls this symbol, as a tree up to `depth` hops. Each edge says how its name was resolved (same-class, typed, qualified, import, same-file, same-package, unique-name, ambiguous).',
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
    description: 'Blast radius of changing a symbol or a file: everything reaching it through calls, inheritance and imports up to `depth` hops, grouped by file with distance, the tests on those paths, and the files that change together with it in git history. Use it to scope a plan, a task\'s declared files, or a review.',
    params: { target: { type: 'string', description: 'A symbol (as for graph_symbol) or a file path.' }, depth: depthParam(3, 6), strict: strictParam, repo: repoParam },
    required: ['target'],
    run: (g, a) => g.impact(a),
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
    description: 'The data model, read from SQL migrations, schema snapshots and key-value table declarations (DynamoDB CreateTable inputs, CloudFormation, SAM and Serverless table resources, JSON or YAML; Terraform aws_dynamodb_table resources, evaluated through the Terragrunt inputs or tfvars that set their module\'s variables), never from a database. No argument: every store (a migration folder, found by its DDL whatever its name: its dialect and how that is known; or a repository\'s key-value tables, `dynamodb`, found by their content; how each was read, its tables, foreign keys, indexes and conflicts). `store`: its entities. `entity`: one table with its fields, keys, indexes and foreign keys (for a key-value table: its attributes, partition and sort keys, TTL, GSIs and LSIs with their projection, stream and billing; references such as !Ref kept unresolved, a Terraform value no file states, such as another configuration\'s output, kept as ${…} and a name with such a part as its template, never guessed), each citing the path:line that declares it, and the conflicts where two declarations disagree (both sides kept). Key-value tables carry their item shapes, read from the Rust serde structs and TypeScript types the code converts to or from an item: the logical tables (one table declared in several places, grouped by its name template, never by a bare name across repositories, with the conflicts across its declarations, local-dev against prod), the item types each with the table it is bound to, the confidence (declared, convention, name-match, ambiguous), the way (an environment variable the infra sets, a name the table\'s template matches, in one function or one file) and its rivals, the unbound types; and for one table, its item tree (fields by dotted path, keys marked) and each binding\'s evidence at its path:line. Access patterns, inferred from the key-value SDK calls of Rust, TypeScript, JavaScript, Python and Go code: for one table, each GSI or LSI with the functions that query it (the code graph\'s symbols, path:line, callers) or the lead "no access found" (what was searched, and that a constant built elsewhere, another repository or a script may reach it: never a verdict), the functions that read and write it with their operations, and an attribute a call writes that the bound item does not state as an inferred conflict. Leads, never the database.',
    params: { store: { type: 'string', description: 'A store: its folder (`drizzle`), `dynamodb` for a repository\'s key-value tables, or `repo:folder`. Lists its entities.' }, entity: { type: 'string', description: 'One entity: `books`, `drizzle/books` or `repo:drizzle/books`.' }, repo: repoParam },
    run: (g, a) => g.data(a),
    footer: DATA_FOOTER,
  },
  {
    name: 'graph_changes',
    description: 'The data model of this branch against its base, element by element: stores, tables, columns, keys, indexes and foreign keys added, removed or modified (before → after), each with the path:line that declares it on its side, a key-value table\'s item fields too (`<table>.<field path>`, what each bound type stores there), and possible renames (a removed and an added element of the same shape), flagged and never decided. The base is read through git at its commit, nothing checked out: `base` when given, else baseBranch in grimoire.config.json, else the branch the index is based on, else main, compared at its merge base with HEAD. The branch side is the working tree as indexed. With `delta` (a design\'s docs/specs/<date>-<topic>.delta.json): each change it proposes with its state against the code (planned and built, pending, built differently: planned → built), its acknowledgement (acknowledged, stale once edited since, or not), then the branch\'s changes no change of the delta covers (unplanned), and a summary. The architecture follows, when the project saves diagrams (docs/architecture/*.architecture.json) or the delta proposes architecture changes: the diagrams against the base (components, connections, boundaries added, removed or modified), the check\'s findings on this index and not on the base checkout\'s (a new link no line draws, a module no component covers, a new external service by import, a drawn line the code no longer shows; with no base checkout index, only the diagram files are compared and it says so), and with `delta` each architecture change\'s state against the diagrams and the impact no change covers (unplanned). `repo` leaves the architecture out.',
    params: { base: { type: 'string', description: 'A branch, tag or commit to compare against (default: baseBranch, else the base branch, else main).' }, delta: { type: 'string', description: 'A design\'s delta beside the specs, as a path relative to the project root: docs/specs/<date>-<topic>.delta.json (or <repo folder>/docs/specs/… for a repository\'s own). Only such a file is read.' }, repo: repoParam },
    run: async (g, a, ctx) => {
      const base = resolveBase(ctx.project, { explicit: a.base || null, repo: a.repo || null })
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
        return g.changes(base, await modelAt(ctx.project, base)) + await arch(null)
      }
      const file = confinedDelta(ctx.project, String(a.delta))
      if (base.error && a.base) throw new Error(base.error)
      const { delta } = parseDelta(file.text)
      return g.delta(file, base.error ? { why: base.error } : { base, at: await modelAt(ctx.project, base) }, a.repo || null) + (delta ? await arch(delta) : '')
    },
    footer: CHANGES_FOOTER,
  },
  {
    name: 'graph_sql',
    description: 'A read-only SELECT over the graph for questions the other tools do not answer. Tables: files(id, repo, path, lang, is_test, node_id), nodes(id, file_id, kind, name, qualname, parent_id, line, end_line, signature, is_test), edges(src, dst, kind CALLS|IMPORTS|EXTENDS|IMPLEMENTS, confidence, line), imports(file_id, source, names, resolved), cochange(repo, a, b, n), churn(repo, path, n: recent commits touching the file), repos(name, root, head, indexed_at).',
    params: { sql: { type: 'string', description: 'One SELECT or WITH … SELECT statement.' } },
    required: ['sql'],
    raw: true,
  },
]

// Files that moved since the last index, per repo (cheap: stat only, no parsing): code files, and the
// files data extractors read. An index built by another grimoire version is stale as a whole: the
// next refresh rebuilds it with the current rules.
function staleness(project, db) {
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
