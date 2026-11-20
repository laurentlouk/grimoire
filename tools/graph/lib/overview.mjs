// grimoire graph · the project at a glance (graph_overview): where to start reading an unknown
// codebase, and where a question should go next. All of it from the index, deterministic:
//
//   - per repository: files by language, definitions, tests;
//   - modules (modules.mjs: folders of production code), each with its size, the modules it uses and
//     the ones using it (file pairs linked by syntax-resolved edges), users first;
//   - entry points: production functions nothing in the index calls that call the most (a CLI, a
//     handler, a job: whatever starts the flow, or code reached only through config or a framework);
//   - most used definitions (callers resolved by syntax) and hotspots (git churn × definitions);
//   - test reach per module: the share of its functions a test reaches within TEST_DEPTH calls, so
//     the untested areas show before anyone changes them.
import { systemMap } from './modules.mjs'
import { routeSummary, routesServedBy, routeTitle } from './route-graph.mjs'

const GUESSES = "('ambiguous','unique-name')"
const TEST_DEPTH = 6
const CALLABLE = "('function','method','constructor')"

export function overview(g, { repo = null, limit = 12 } = {}) {
  const R = repo ? ' AND f.repo = ?' : ''
  const ra = repo ? [repo] : []
  const repos = g.q(`SELECT * FROM repos${repo ? ' WHERE name = ?' : ''} ORDER BY name`, ...ra)
  if (!repos.length) return repo ? `No repository named "${repo}" in the index.` : 'The graph is empty: run graph_index.'
  const out = []
  for (const r of repos) {
    const langs = g.q('SELECT lang, count(*) c FROM files WHERE repo = ? GROUP BY lang ORDER BY c DESC', r.name).map((l) => `${l.lang} ${l.c}`).join(', ')
    const defs = g.one("SELECT count(*) c FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.repo = ? AND n.kind != 'file' AND n.is_test = 0", r.name).c
    const tests = g.one('SELECT count(*) c FROM files WHERE repo = ? AND is_test = 1', r.name).c
    out.push(`${r.name}  (${r.root})  files: ${langs} · ${defs} production definitions · ${tests} test file(s)`)
    const rs = routeSummary(g, r.name)
    if (rs) out.push(rs)
  }

  // ── modules ──
  const files = g.q(`SELECT f.id, f.repo, f.path, f.is_test, f.node_id FROM files f WHERE 1=1${R}`, ...ra)
  const nodes = g.q(`SELECT n.id, n.file_id FROM nodes n JOIN files f ON f.id = n.file_id WHERE 1=1${R}`, ...ra)
  const edges = g.q(`SELECT e.src, e.dst, e.kind, e.confidence FROM edges e JOIN nodes n ON n.id = e.src JOIN files f ON f.id = n.file_id WHERE e.kind != 'ROUTES_TO'${R}`, ...ra)
  const sys = systemMap(files, nodes, edges)
  const name = (m) => (repos.length > 1 ? `${m.repo}:${m.key}` : m.key)
  const usesOf = new Map(), usedBy = new Map()
  for (const [a, b, n] of sys.links) { (usesOf.get(a) || usesOf.set(a, []).get(a)).push([b, n]); (usedBy.get(b) || usedBy.set(b, []).get(b)).push([a, n]) }
  // test reach: production callables a test reaches within TEST_DEPTH calls
  const testIds = g.q(`SELECT n.id FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.is_test = 1${R}`, ...ra).map((x) => x.id)
  // a test reaching a handler through its route (by URL, by navigation) reaches it too
  const fileTests = g.q(`SELECT f.node_id AS id FROM files f WHERE f.is_test = 1${R}`, ...ra).map((x) => x.id)
  const reached = testIds.length || fileTests.length ? g.walk([...testIds, ...fileTests], ['CALLS', 'ROUTES_TO'], 'out', TEST_DEPTH) : new Map()
  const callables = g.q(`SELECT n.id, n.file_id FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.kind IN ${CALLABLE} AND n.is_test = 0${R}`, ...ra)
  const modOfFile = new Map(sys.fileModule)
  const reach = new Map()
  for (const c of callables) {
    const m = modOfFile.get(c.file_id)
    if (m === undefined) continue
    const x = reach.get(m) || reach.set(m, { all: 0, hit: 0 }).get(m)
    x.all++
    if (reached.has(c.id)) x.hit++
  }
  const pct = (m) => { const x = reach.get(m); return x && x.all ? `tests reach ${Math.round((100 * x.hit) / x.all)}% of ${x.all} functions` : 'no functions' }
  out.push(`Modules (${sys.modules.length}; folders of production code, users before what they use):`)
  sys.modules.slice(0, 30).forEach((m, i) => {
    const uses = (usesOf.get(i) || []).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([j, n]) => `${name(sys.modules[j])} (${n})`).join(', ')
    const by = (usedBy.get(i) || []).length
    out.push(`  ${name(m)}  ${m.files} file(s) · ${pct(i)}${uses ? ` · uses ${uses}` : ''}${by ? ` · used by ${by} module(s)` : ''}`)
  })
  if (sys.modules.length > 30) out.push(`  … ${sys.modules.length - 30} more`)

  // ── entry points ──
  // a route's handler or screen is an entry point reached through HTTP or navigation: listed apart
  const entries = g.q(`SELECT n.*, f.repo, f.path,
      (SELECT count(*) FROM edges e WHERE e.src = n.id AND e.kind = 'CALLS' AND e.confidence NOT IN ${GUESSES}) AS fanout
    FROM nodes n JOIN files f ON f.id = n.file_id
    WHERE n.kind IN ${CALLABLE} AND n.is_test = 0 AND n.parent_id IS NULL${R}
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.dst = n.id AND e.kind = 'CALLS')
      AND NOT EXISTS (SELECT 1 FROM routes r WHERE r.handler_id = n.id AND r.full IS NOT NULL)
    ORDER BY fanout DESC, f.path LIMIT ?`, ...ra, limit)
  out.push('Entry points (nothing in the index calls them; they call the most): where a flow starts, or code reached through config, a framework or another repository')
  for (const n of entries.filter((x) => x.fanout > 0)) out.push(`  ${g.row(n, `calls ${n.fanout}`)}`)
  const handlers = g.q(`SELECT DISTINCT n.*, f.repo, f.path, (SELECT count(*) FROM edges e WHERE e.dst = n.id AND e.kind = 'ROUTES_TO') AS hits
    FROM routes r JOIN nodes n ON n.id = r.handler_id JOIN files f ON f.id = n.file_id WHERE r.full IS NOT NULL${R} ORDER BY hits DESC, f.path, n.line LIMIT ?`, ...ra, limit)
  if (handlers.length) {
    out.push('Route handlers and screens (entry points through HTTP or navigation; graph_routes lists every route):')
    for (const n of handlers) { const rs = routesServedBy(g, [n.id]); out.push(`  ${g.row(n, `${rs.slice(0, 2).map(routeTitle).join(', ')}${rs.length > 2 ? ', …' : ''} · reached from ${n.hits} place(s)`)}`) }
  }

  // ── most used ──
  const used = g.q(`SELECT n.*, f.repo, f.path, count(DISTINCT e.src) AS callers FROM edges e JOIN nodes n ON n.id = e.dst JOIN files f ON f.id = n.file_id
    WHERE e.kind = 'CALLS' AND e.confidence NOT IN ${GUESSES} AND n.is_test = 0${R} GROUP BY n.id ORDER BY callers DESC, f.path LIMIT ?`, ...ra, limit)
  out.push('Most used (callers resolved by syntax): change these with graph_impact first')
  for (const n of used) out.push(`  ${g.row(n, `${n.callers} callers`)}`)

  // ── hotspots ──
  const hot = g.q(`SELECT f.repo, f.path, c.n AS commits, (SELECT count(*) FROM nodes n WHERE n.file_id = f.id AND n.kind != 'file') AS defs
    FROM churn c JOIN files f ON f.repo = c.repo AND f.path = c.path WHERE f.is_test = 0${R} ORDER BY c.n * (1 + (SELECT count(*) FROM nodes n WHERE n.file_id = f.id AND n.kind != 'file')) DESC LIMIT ?`, ...ra, limit)
  if (hot.length) {
    out.push('Hotspots (often changed × many definitions, last 400 commits):')
    for (const h of hot) out.push(`  ${g.loc({ ...h, kind: 'file' })}  ${h.commits} commits · ${h.defs} definitions`)
  }
  out.push('Next: graph_file <path> for a file, graph_search <words> to find a name, graph_impact <target> before a change, graph_diff to check one.')
  return out.join('\n')
}
