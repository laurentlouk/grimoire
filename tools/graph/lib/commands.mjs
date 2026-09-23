// grimoire graph · the command surface, shared by the MCP server (mcp.mjs) and the CLI (graph.mjs).
// Each tool: name, description (what an agent reads to pick it), JSON-schema params, handler.
//
// Freshness: before answering, a query re-indexes incrementally when files moved since the last
// index (throttled to once per FRESH_MS per process). A project never indexed is not indexed
// implicitly: that is graph_index's job, since the first run can take a while on a large tree.
import { existsSync } from 'node:fs'
import { loadProject, scanRepo } from './project.mjs'
import { openStore } from './store.mjs'
import { runIndex } from './run.mjs'
import { Graph, sql, FOOTER } from './query.mjs'

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
    name: 'graph_sql',
    description: 'A read-only SELECT over the graph for questions the other tools do not answer. Tables: files(id, repo, path, lang, is_test, node_id), nodes(id, file_id, kind, name, qualname, parent_id, line, end_line, signature, is_test), edges(src, dst, kind CALLS|IMPORTS|EXTENDS|IMPLEMENTS, confidence, line), imports(file_id, source, names, resolved), cochange(repo, a, b, n), repos(name, root, head, indexed_at).',
    params: { sql: { type: 'string', description: 'One SELECT or WITH … SELECT statement.' } },
    required: ['sql'],
    raw: true,
  },
]

// Files that moved since the last index, per repo (cheap: stat only, no parsing).
function staleness(project, db) {
  const out = {}
  for (const repo of project.repos) {
    const known = new Map(db.prepare('SELECT path, size, mtime FROM files WHERE repo = ?').all(repo.name).map((f) => [f.path, f]))
    let changed = 0
    for (const f of scanRepo(repo, project)) { const k = known.get(f.path); if (!k || k.size !== f.size || k.mtime !== f.mtime) changed++; known.delete(f.path) }
    changed += known.size
    if (changed) out[repo.name] = `${changed} file(s) changed since`
  }
  return out
}

export async function call(name, args = {}, { root, log = () => {} } = {}) {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error(`unknown tool ${name}`)
  const project = loadProject(root)
  if (!project.enabled) return 'The code graph is disabled for this project (grimoire.config.json: graph.enabled = false). Use Grep/Glob/Read.'

  if (tool.index) {
    const r = await runIndex(project.root, { full: !!args.full, repo: args.repo || null, onLog: log })
    lastFresh = Date.now()
    if (r.error) return `Index failed: ${r.error}`
    return [`Indexed in ${(r.ms / 1000).toFixed(1)}s.`, ...r.repos.map((x) => `  ${x.repo}: ${x.files} files, ${x.parsed} parsed, ${x.removed} removed${x.failed.length ? `, ${x.failed.length} failed to parse (${x.failed.slice(0, 3).join('; ')})` : ''}`)].join('\n')
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
      note = r.error ? `(refresh failed, answering from the previous index: ${r.error})\n` : ''
    }
  }
  const db = await openStore(project.dbPath, { readOnly: true })
  try {
    if (tool.raw) return sql(db, args.sql)
    const g = new Graph(db)
    const fresh = name === 'graph_status' ? staleness(project, db) : null
    return `${note}${tool.run(g, args, { fresh })}\n\n${FOOTER}`
  } finally { db.close() }
}
