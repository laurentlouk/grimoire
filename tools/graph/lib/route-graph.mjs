// grimoire graph · routes in the index: written per file, composed per repository, linked across
// the project, and read back for graph_routes, graph_impact, graph_diff and graph_overview.
//
//   routes        one row per declaration (routes.mjs): kind http | screen, method, the path as
//                 written, its router, its handler as named, and, once composed (resolveRoutes),
//                 `full` (JSON: each path it serves under, `{p, test}`, test when only a test mounts
//                 it) and handler_id (the definition). `full` NULL: not served (an Expo screen in
//                 a package that does not use expo-router).
//   route_facts   per file, its routers, mounts and notes (JSON), for the composition
//   route_refs    the places code names a route: hashed literal segments (`toks`), an unknown prefix
//                 (`lead`), the method or kind a client call states
//   route_links   ref → route, with how it matched (exact, template, prefix unknown, name)
// Every link is also an edge ROUTES_TO from the definition holding the ref to the handler, so the
// walks that find callers and tests (graph_impact, graph_diff, graph_symbol, test reach) follow it.
// The composition reads the edges (IMPORTS for a mounted file, CALLS for a router passed to a
// function), so it runs after resolve.mjs; the links span repositories, so they run last.
import path from 'node:path'
import { familyOf } from './langs.mjs'
import { UNKNOWN, hashSeg, joinPath } from './routes.mjs'

const CALLABLE = new Set(['function', 'method', 'constructor'])
const CLASSY = new Set(['class', 'struct', 'interface', 'module', 'object'])
const MAX_VARIANTS = 8, MAX_DEPTH = 8, MAX_TIES = 5

// ── writing a file's routes ──
export function writeRoutes(db, fileId, fileNode, ids, facts) {
  if (!facts) return
  const nodeOf = (i) => (i >= 0 && ids[i] !== undefined ? ids[i] : fileNode)
  const insR = db.prepare('INSERT INTO routes(file_id, line, kind, method, path, framework, router, handler, handler_line, middleware, app_root) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const r of facts.routes) insR.run(fileId, r.line, r.kind, r.method || null, r.path, r.framework, r.router || null, r.handler ? JSON.stringify(r.handler) : null, r.handlerLine || null, JSON.stringify(r.middleware || []), r.appRoot || null)
  const insF = db.prepare('INSERT OR REPLACE INTO route_facts(file_id, facts) VALUES(?, ?)')
  insF.run(fileId, JSON.stringify({ scopes: facts.scopes, mounts: facts.mounts.map((m) => (m.child.call ? { ...m, child: { ...m.child, src: nodeOf(m.child.src) } } : m)), meta: facts.meta }))
  const insX = db.prepare('INSERT INTO route_refs(file_id, src_id, line, kind, method, toks, lead, named) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
  for (const x of facts.refs) insX.run(fileId, nodeOf(x.src), x.line, x.kind, x.method || null, x.toks.join('/'), x.lead ? 1 : 0, x.named ? 1 : 0)
}
export function removeRoutes(db, fileId) {
  db.prepare('DELETE FROM route_links WHERE ref_id IN (SELECT id FROM route_refs WHERE file_id = ?) OR route_id IN (SELECT id FROM routes WHERE file_id = ?)').run(fileId, fileId)
  for (const t of ['routes', 'route_refs', 'route_facts']) db.prepare(`DELETE FROM ${t} WHERE file_id = ?`).run(fileId)
}

// ── composing a repository's routes: prefixes through mounts, handlers to definitions ──
export function resolveRoutes(db, repo) {
  const routes = db.prepare('SELECT r.*, f.path AS fpath FROM routes r JOIN files f ON f.id = r.file_id WHERE f.repo = ?').all(repo)
  const facts = new Map(db.prepare('SELECT rf.file_id, rf.facts FROM route_facts rf JOIN files f ON f.id = rf.file_id WHERE f.repo = ?').all(repo).map((r) => [r.file_id, JSON.parse(r.facts)]))
  if (!routes.length) return
  const files = new Map(db.prepare('SELECT id, path, lang, node_id, is_test FROM files WHERE repo = ?').all(repo).map((f) => [f.id, { ...f, dir: path.posix.dirname(f.path), family: familyOf(f.lang) }]))
  const byPath = new Map([...files.values()].map((f) => [f.path, f]))
  const nodes = db.prepare("SELECT n.id, n.file_id, n.kind, n.name, n.qualname, n.parent_id, n.line FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.repo = ? AND n.kind != 'file'").all(repo)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const defsIn = new Map(), byName = new Map()
  for (const n of nodes) { (defsIn.get(n.file_id) || defsIn.set(n.file_id, []).get(n.file_id)).push(n); (byName.get(n.name) || byName.set(n.name, []).get(n.name)).push(n) }
  const importRows = db.prepare('SELECT line, source, names, alias FROM imports WHERE file_id = ?')
  const importEdges = db.prepare("SELECT e.line, d.file_id FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.src = ? AND e.kind = 'IMPORTS'")
  const callsAt = db.prepare("SELECT dst FROM edges WHERE src = ? AND kind = 'CALLS' AND line = ?")

  // the files a local name of a file is imported from
  const importTargets = (fid, local) => {
    const f = files.get(fid)
    if (!f) return []
    const edges = importEdges.all(f.node_id)
    const out = new Set()
    for (const i of importRows.all(fid)) {
      const names = JSON.parse(i.names || '[]').map((x) => String(x).split('=')[0])
      if (i.alias !== local && !names.includes(local)) continue
      const atLine = edges.filter((e) => e.line === i.line).map((e) => e.file_id)
      const last = i.source.split(/[/.:\\]+/).filter(Boolean).pop()
      const byStem = edges.map((e) => e.file_id).filter((id) => { const p = files.get(id)?.path || ''; const st = path.posix.basename(p).replace(/\.[^.]+$/, ''); return st === local || st === last || (/^(index|__init__|mod)$/.test(st) && path.posix.basename(path.posix.dirname(p)) === (last || local)) })
      for (const id of [...atLine, ...byStem]) out.add(id)
    }
    // `from app.api.routes import items, users`: one line, several modules; the one named so
    const exact = [...out].filter((id) => path.posix.basename(files.get(id)?.path || '').replace(/\.[^.]+$/, '') === local)
    return exact.length ? exact : [...out]
  }

  // ── routers ──
  const scopes = new Map() // `${fid}|${key}` → scope
  const incoming = new Map() // node → [{ from: node, prefix, test }]
  const metaOf = (fid) => facts.get(fid)?.meta || {}
  for (const [fid, ff] of facts) for (const s of ff.scopes) scopes.set(`${fid}|${s.key}`, { ...s, fid })
  const routersIn = (fid) => [...scopes.values()].filter((s) => s.fid === fid)
  const childNodes = (fid, ch, parentKey) => {
    if (ch.var) return [`${fid}|${ch.var}`]
    if (ch.module) { // Django's include('app.urls')
      const want = ch.module.replace(/\./g, '/')
      return [...files.values()].filter((f) => f.path.replace(/\.py$/, '') === want || f.path.replace(/\.py$/, '').endsWith(`/${want}`)).map((f) => `${f.id}|django`)
    }
    if (ch.import) {
      const out = []
      for (const t of importTargets(fid, ch.import)) {
        if (parentKey === 'django') { out.push(`${t}|django`); continue }
        if (ch.attr) { if (scopes.has(`${t}|v:0:${ch.attr}`)) out.push(`${t}|v:0:${ch.attr}`); continue }
        const def = metaOf(t).defaultExport
        if (def && scopes.has(`${t}|${def}`)) { out.push(`${t}|${def}`); continue }
        const rs = routersIn(t).filter((s) => s.factory !== 'app' && !s.parent && s.key.startsWith('v:0:'))
        out.push(...rs.map((s) => `${t}|${s.key}`))
        if (!rs.length) out.push(...routersIn(t).filter((s) => s.key.startsWith('p:')).map((s) => `${t}|${s.key}`), ...functionParams(t, ch.import))
      }
      return out
    }
    if (ch.call) { // a router passed to a function: that function's parameter
      let dsts = callsAt.all(ch.src, mountLine.get(ch)).map((r) => nodeById.get(r.dst)).filter((n) => n && CALLABLE.has(n.kind))
      if (!dsts.length) { const c = (byName.get(ch.call) || []).filter((n) => CALLABLE.has(n.kind)); if (c.length === 1) dsts = c }
      return dsts.map((d) => `${d.file_id}|p:${d.line}:${ch.index}`)
    }
    return []
  }
  // Fastify's `register(plugin)` of an imported file: its exported function's first parameter
  const functionParams = (fid) => (defsIn.get(fid) || []).filter((n) => CALLABLE.has(n.kind) && !n.parent_id).map((n) => `${fid}|p:${n.line}:0`)
  const mountLine = new Map()
  for (const [fid, ff] of facts) {
    for (const m of ff.mounts) {
      mountLine.set(m.child, m.line)
      const from = `${fid}|${m.parent}`
      for (const to of childNodes(fid, m.child, m.parent)) (incoming.get(to) || incoming.set(to, []).get(to)).push({ from, prefix: m.prefix, test: !!files.get(fid)?.is_test })
    }
  }
  // Django: the root URLconf (settings' ROOT_URLCONF, else every urls.py no other includes) serves at /
  const rootConf = [...facts.values()].map((f) => f.meta?.rootUrlconf).find(Boolean)
  const djangoRoot = (fid) => {
    if (rootConf) { const want = rootConf.replace(/\./g, '/'); const p = files.get(fid)?.path.replace(/\.py$/, '') || ''; return p === want || p.endsWith(`/${want}`) }
    return !incoming.has(`${fid}|django`)
  }
  const memo = new Map()
  const prefixes = (node, depth = 0) => {
    if (memo.has(node)) return memo.get(node)
    if (depth > MAX_DEPTH) return [{ p: UNKNOWN, test: false }]
    memo.set(node, [{ p: UNKNOWN, test: false }]) // a cycle reads as unknown
    const [fidS, ...rest] = node.split('|')
    const fid = Number(fidS), key = rest.join('|')
    const s = scopes.get(node)
    const own = s ? s.prefix || '' : ''
    let res = []
    if (s && s.parent) for (const b of prefixes(`${fid}|${s.parent}`, depth + 1)) res.push({ p: joinPath(b.p, own), test: b.test })
    for (const m of incoming.get(node) || []) for (const b of prefixes(m.from, depth + 1)) res.push({ p: joinPath(joinPath(b.p, m.prefix), own), test: b.test || m.test })
    if (!res.length) {
      if (key === 'django') res = [{ p: djangoRoot(fid) ? '' : UNKNOWN, test: false }]
      else if (s && s.factory === 'app') res = [{ p: own, test: false }]
      else if (s && s.parent === null && s.key.startsWith('v:')) res = [{ p: joinPath(UNKNOWN, own), test: false }] // a router nothing mounts that we can see
      else if (key.startsWith('p:') || key.startsWith('a:')) res = [{ p: s ? joinPath(UNKNOWN, own) : UNKNOWN, test: false }]
      else if (key.startsWith('i:')) {
        const nm = key.slice(2)
        const t = importTargets(fid, nm).flatMap((x) => [scopes.has(`${x}|v:0:${nm}`) ? `${x}|v:0:${nm}` : null, metaOf(x).defaultExport && scopes.has(`${x}|${metaOf(x).defaultExport}`) ? `${x}|${metaOf(x).defaultExport}` : null]).filter(Boolean)
        res = t.length ? t.flatMap((x) => prefixes(x, depth + 1)) : [{ p: UNKNOWN, test: false }]
      } else res = [{ p: '', test: false }] // a value of unknown origin, a class-based or file-based route
    }
    const seen = new Map()
    for (const r of res) { const k = r.p || ''; if (!seen.has(k) || (seen.get(k).test && !r.test)) seen.set(k, { p: k, test: r.test }) }
    const out = [...seen.values()].sort((a, b) => a.test - b.test || (a.p < b.p ? -1 : 1)).slice(0, MAX_VARIANTS)
    memo.set(node, out)
    return out
  }

  // ── handlers ──
  const camel = (s) => s.split(/[_-]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  const resolveHandler = (r, h) => {
    const f = files.get(r.file_id)
    const defs = defsIn.get(r.file_id) || []
    if (r.handler_line) {
      const at = defs.filter((n) => n.line === r.handler_line && (CALLABLE.has(n.kind) || CLASSY.has(n.kind)))
      if (at.length) return at.find((n) => n.name === h?.name) || at[0]
    }
    if (!h || !h.name) return null
    const fam = f.family
    const pool = (byName.get(h.name) || []).filter((n) => familyOf(files.get(n.file_id)?.lang) === fam && (CALLABLE.has(n.kind) || CLASSY.has(n.kind)))
    if (h.rails) { // `api/articles#index`: Api::ArticlesController#index
      const segs = h.qual.split('/')
      const cls = `${camel(segs[segs.length - 1])}Controller`
      const cands = pool.filter((n) => n.parent_id && nodeById.get(n.parent_id)?.name === cls)
      const want = `app/controllers/${h.qual}_controller.rb`
      return cands.find((n) => files.get(n.file_id).path.endsWith(want)) || cands.find((n) => segs.length < 2 || nodeById.get(n.parent_id).qualname.toLowerCase().includes(segs[0].toLowerCase())) || cands[0] || null
    }
    if (!h.qual) {
      const same = pool.filter((n) => n.file_id === r.file_id)
      if (same.length) return same.find((n) => !n.parent_id) || same[0]
      const viaImport = importTargets(r.file_id, h.name).flatMap((t) => pool.filter((n) => n.file_id === t))
      if (viaImport.length) return viaImport[0]
      if (/^(go|jvm|swift|csharp)$/.test(fam)) { const pkg = pool.filter((n) => files.get(n.file_id).dir === f.dir); if (pkg.length) return pkg[0] }
      const top = pool.filter((n) => !n.parent_id || CLASSY.has(nodeById.get(n.parent_id)?.kind))
      return top.length === 1 ? top[0] : null
    }
    const head = h.qual.split('.')[0], last = h.qual.split('.').pop()
    const viaImport = importTargets(r.file_id, head).flatMap((t) => pool.filter((n) => n.file_id === t))
    if (viaImport.length) return viaImport.find((n) => !n.parent_id || nodeById.get(n.parent_id)?.name === last) || viaImport[0]
    const member = pool.filter((n) => n.parent_id && nodeById.get(n.parent_id)?.name === last)
    if (member.length === 1) return member[0]
    const methods = pool.filter((n) => CALLABLE.has(n.kind))
    return methods.length === 1 ? methods[0] : null
  }

  // Expo Router: screens only in a package that uses expo-router
  const usesExpo = new Map()
  const expoIn = (root) => {
    const pkg = root.replace(/(^|\/)(src\/)?app$/, '')
    if (!usesExpo.has(pkg)) usesExpo.set(pkg, !!db.prepare("SELECT 1 FROM imports i JOIN files f ON f.id = i.file_id WHERE f.repo = ? AND (i.source = 'expo-router' OR i.source LIKE 'expo-router/%') AND (? = '' OR f.path LIKE ? || '/%') LIMIT 1").get(repo, pkg, pkg))
    return usesExpo.get(pkg)
  }
  const globalPrefix = [...facts.values()].map((f) => f.meta?.globalPrefix).find((x) => x !== undefined)
  const upd = db.prepare('UPDATE routes SET full = ?, handler_id = ? WHERE id = ?')
  for (const r of routes) {
    if (r.framework === 'expo-router' && !expoIn(r.app_root || 'app')) { upd.run(null, null, r.id); continue }
    let full
    if (r.router && /^(v|p|i|g|a):/.test(r.router)) full = prefixes(`${r.file_id}|${r.router}`).map((b) => ({ p: joinPath(b.p, r.path), test: b.test }))
    else if (r.router === 'django') full = prefixes(`${r.file_id}|django`).map((b) => ({ p: joinPath(b.p, r.path), test: b.test }))
    else if (r.router === 'nest' && globalPrefix !== undefined) full = [{ p: joinPath(globalPrefix, r.path), test: false }]
    else full = [{ p: r.kind === 'screen' && !r.path.startsWith('/') ? r.path : joinPath('', r.path), test: false }]
    const seen = new Set()
    full = full.filter((x) => (seen.has(x.p) ? false : seen.add(x.p)))
    const h = resolveHandler(r, r.handler ? JSON.parse(r.handler) : null)
    // a file-based route whose screen or handler is no named definition: the file stands for it
    upd.run(JSON.stringify(full), h ? h.id : r.router === 'file' ? files.get(r.file_id)?.node_id ?? null : null, r.id)
  }
}

// ── matching a call site to the routes ──
// A template's segments: L a literal (hashed), P a parameter (`:id`, `{id}`, `[id]`, `<int:pk>`),
// M any number of segments (`{…}`, `*`, `**`, `[...slug]`, `{path...}`, `<path:x>`).
export function templateSegs(p) {
  return p.split('/').filter(Boolean).map((g) => {
    if (g === UNKNOWN || /^\*/.test(g) || /^\[\[?\.\.\./.test(g) || /^\{[^}]*\.\.\.\}$/.test(g) || /^<path:/.test(g) || /^\{\*/.test(g)) return { t: 'M' }
    if (/^[:*]/.test(g) || /[{}[\]<>]/.test(g) || /:\w/.test(g)) return { t: 'P' }
    return { t: 'L', h: hashSeg(g) }
  })
}
export function matchSegs(segs, toks, lead) {
  const R = segs.length, T = toks.length
  const memo = new Map()
  const better = (a, b) => !b || a.lits > b.lits || (a.lits === b.lits && a.params + 2 * a.wild < b.params + 2 * b.wild)
  const f = (i, j) => {
    const k = i * 128 + j
    if (memo.has(k)) return memo.get(k)
    let best = null
    const take = (r, dl, dp, dw) => { if (!r) return; const x = { lits: r.lits + dl, params: r.params + dp, wild: r.wild + dw }; if (better(x, best)) best = x }
    if (j === T) { if (segs.slice(i).every((s) => s.t === 'M')) best = { lits: 0, params: 0, wild: 0 } }
    else if (i < R) {
      const s = segs[i], t = toks[j]
      if (s.t === 'M') { take(f(i + 1, j), 0, 0, 0); take(f(i, j + 1), 0, 0, 1) }
      else if (s.t === 'P') take(f(i + 1, j + 1), 0, 1, 0)
      else if (t === s.h) take(f(i + 1, j + 1), 1, 0, 0)
    }
    memo.set(k, best)
    return best
  }
  if (!lead) return f(0, 0)
  let best = null
  for (let i = 0; i <= R; i++) { const r = f(i, 0); if (r) { const x = { ...r, wild: r.wild + (i ? 1 : 0) }; if (better(x, best)) best = x } }
  return best
}
const methodsOf = (m) => (!m || m === 'ANY' ? null : m.split(','))

export function linkRoutes(db) {
  db.prepare("DELETE FROM edges WHERE kind = 'ROUTES_TO'").run()
  db.prepare('DELETE FROM route_links').run()
  const routes = db.prepare('SELECT r.id, r.kind, r.method, r.path, r.full, r.handler_id, f.repo FROM routes r JOIN files f ON f.id = r.file_id WHERE r.full IS NOT NULL').all()
  if (!routes.length) return
  const lits = new Map(), names = new Map()
  const prepared = routes.map((r, idx) => {
    const full = JSON.parse(r.full)
    if (r.kind === 'screen' && !r.path.startsWith('/')) { const h = hashSeg(r.path); (names.get(h) || names.set(h, []).get(h)).push(r); return { ...r, variants: [] } }
    const variants = full.map((v) => templateSegs(v.p))
    for (const segs of variants) for (const s of segs) if (s.t === 'L') { const a = lits.get(s.h) || lits.set(s.h, new Set()).get(s.h); a.add(idx) }
    return { ...r, variants }
  })
  const insL = db.prepare('INSERT INTO route_links(ref_id, route_id, how) VALUES(?, ?, ?)')
  const insE = db.prepare("INSERT INTO edges(src, dst, kind, confidence, line) VALUES(?, ?, 'ROUTES_TO', 'route', ?)")
  const edges = new Set()
  for (const ref of db.prepare('SELECT x.*, f.repo FROM route_refs x JOIN files f ON f.id = x.file_id').all()) {
    const toks = ref.toks.split('/')
    let picks = []
    if (ref.named) {
      picks = (names.get(toks[0]) || []).map((r) => ({ r, score: r.repo === ref.repo ? 1 : 0, how: 'name' }))
      const top = Math.max(-Infinity, ...picks.map((p) => p.score))
      picks = picks.filter((p) => p.score === top)
    }
    else {
      const cand = new Set()
      for (const t of toks) for (const i of lits.get(t) || []) cand.add(i)
      for (const i of cand) {
        const r = prepared[i]
        if ((ref.kind === 'http' && r.kind !== 'http') || (ref.kind === 'screen' && r.kind !== 'screen')) continue
        const ms = methodsOf(r.method)
        if (ref.method && ms && !ms.includes(ref.method)) continue
        let best = null
        for (const segs of r.variants) { const m = matchSegs(segs, toks, !!ref.lead); if (m && m.lits && (!best || m.lits * 10 - m.params - 2 * m.wild > best.lits * 10 - best.params - 2 * best.wild)) best = m }
        if (!best) continue
        // a method the call states and the route names, then the call's own repository, break a tie
        const score = best.lits * 10 - best.params - 2 * best.wild + (ref.method && ms ? 1 : 0) + (r.repo === ref.repo ? 0.5 : 0)
        picks.push({ r, score, how: best.wild ? 'prefix unknown' : best.params ? 'template' : 'exact' })
      }
      const top = Math.max(-Infinity, ...picks.map((p) => p.score))
      picks = picks.filter((p) => p.score === top)
    }
    for (const p of picks.slice(0, MAX_TIES)) {
      insL.run(ref.id, p.r.id, p.how)
      const k = `${ref.src_id}|${p.r.handler_id}`
      if (p.r.handler_id && ref.src_id !== p.r.handler_id && !edges.has(k)) { edges.add(k); insE.run(ref.src_id, p.r.handler_id, ref.line) }
    }
  }
}

// ── reading them back ──
export const methodText = (r) => (r.kind === 'screen' ? 'SCREEN' : !r.method || r.method === 'ANY' ? '*' : r.method)
export const primaryPath = (r) => { const f = r.full ? JSON.parse(r.full) : []; return (f.find((x) => !x.test) || f[0] || { p: r.path }).p }
export const routeTitle = (r) => `${methodText(r)} ${primaryPath(r)}`
const ROUTE_ROWS = 'SELECT r.*, f.repo, f.path AS fpath, f.is_test AS ftest FROM routes r JOIN files f ON f.id = r.file_id WHERE r.full IS NOT NULL'
export function routesServedBy(g, ids) {
  if (!ids.length) return []
  const out = []
  const st = g.db.prepare(`${ROUTE_ROWS} AND r.handler_id = ? ORDER BY f.path, r.line`)
  for (const id of new Set(ids)) out.push(...st.all(id))
  return out
}
export function routeCallers(g, routeId) {
  return g.q(`SELECT l.how, x.line, x.src_id, f.repo, f.path, f.is_test AS ftest, n.kind AS skind, n.qualname AS sname, n.is_test AS stest
    FROM route_links l JOIN route_refs x ON x.id = l.ref_id JOIN files f ON f.id = x.file_id LEFT JOIN nodes n ON n.id = x.src_id
    WHERE l.route_id = ? ORDER BY f.is_test, f.repo, f.path, x.line`, routeId)
}
const isTestCaller = (c) => !!(c.ftest || c.stest)
export function callerLine(g, c) {
  const where = c.skind && c.skind !== 'file' ? `in ${c.sname}` : 'at file level'
  return `${g.loc({ repo: c.repo, path: c.path, kind: 'x', line: c.line })}  ${where}  (${c.how})${isTestCaller(c) ? '  test' : ''}`
}
// one route, its handler, its middleware and its callers, for graph_routes and graph_impact
export function routeLines(g, r, { callers = true, indent = '  ', limit = 25 } = {}) {
  const out = [`${indent}${routeTitle(r)}  (${r.kind}, ${r.framework})  declared ${g.loc({ repo: r.repo, path: r.fpath, kind: 'x', line: r.line })}  #r${r.id}`]
  const full = JSON.parse(r.full || '[]')
  if (full.length > 1) out.push(`${indent}  also served as: ${full.filter((x) => x.p !== primaryPath(r)).map((x) => `${x.p}${x.test ? ' (mounted in a test)' : ''}`).join(', ')}`)
  const h = r.handler_id ? g.node(r.handler_id) : null
  const named = r.handler ? JSON.parse(r.handler) : null
  out.push(`${indent}  handler: ${h ? g.row(h) : named ? `${named.qual ? `${named.qual}${named.rails ? '#' : '.'}` : ''}${named.name} (not resolved to a definition)` : 'inline (no definition of its own)'}`)
  const mw = JSON.parse(r.middleware || '[]')
  if (mw.length) out.push(`${indent}  middleware (where the syntax shows it): ${mw.join(', ')}`)
  if (!callers) return out
  const cs = routeCallers(g, r.id)
  const tests = cs.filter(isTestCaller), code = cs.filter((c) => !isTestCaller(c))
  out.push(`${indent}  callers in code (${code.length})${code.length ? ':' : ''}`)
  for (const c of code.slice(0, limit)) out.push(`${indent}    ${callerLine(g, c)}`)
  if (code.length > limit) out.push(`${indent}    … ${code.length - limit} more`)
  out.push(`${indent}  callers in tests (${tests.length})${tests.length ? ':' : ''}`)
  for (const c of tests.slice(0, limit)) out.push(`${indent}    ${callerLine(g, c)}`)
  if (tests.length > limit) out.push(`${indent}    … ${tests.length - limit} more`)
  return out
}

// graph_routes: every route, filtered by a path fragment, a method, a kind; one route in full
export function routesTool(g, { query = '', method = '', kind = '', repo = '', limit = 60 } = {}) {
  let q = String(query || '').trim()
  let m = String(method || '').trim().toUpperCase()
  const one = /^#?r(\d+)$/.exec(q)
  let rows = one ? g.q(`${ROUTE_ROWS} AND r.id = ?`, Number(one[1])) : g.q(`${ROUTE_ROWS}${repo ? ' AND f.repo = ?' : ''} ORDER BY f.repo, r.kind, r.path, r.line`, ...(repo ? [repo] : []))
  if (!one) {
    const mq = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|SCREEN)\s+(.*)$/i.exec(q)
    if (mq) { m = mq[1].toUpperCase(); q = mq[2].trim() }
    if (m === 'SCREEN') { kind = 'screen'; m = '' }
    if (kind) rows = rows.filter((r) => r.kind === kind)
    if (m) rows = rows.filter((r) => r.kind === 'http' && (!r.method || r.method === 'ANY' || r.method.split(',').includes(m)))
    if (q) {
      const lq = q.toLowerCase()
      rows = rows.filter((r) => JSON.parse(r.full).some((x) => x.p.toLowerCase().includes(lq)) || r.path.toLowerCase().includes(lq))
      const exact = rows.filter((r) => JSON.parse(r.full).some((x) => x.p === q))
      if (exact.length === 1 || (exact.length > 1 && exact.length <= 3 && m)) rows = exact
    }
  }
  const total = g.one('SELECT count(*) c FROM routes WHERE full IS NOT NULL').c
  if (!total) return 'No routes in the index: no HTTP route declaration or navigation screen this graph reads (routes.mjs lists the frameworks). Search the code for the router instead.'
  if (!rows.length) return `No route matches${q ? ` "${q}"` : ''}${m ? ` for ${m}` : ''}${kind ? ` (${kind})` : ''}: ${total} route(s) in the index; try a shorter path fragment.`
  if (rows.length <= 3 && (q || one)) return rows.flatMap((r) => routeLines(g, r)).join('\n')
  const cnt = g.db.prepare("SELECT count(*) c, sum(CASE WHEN f.is_test = 1 OR n.is_test = 1 THEN 1 ELSE 0 END) t FROM route_links l JOIN route_refs x ON x.id = l.ref_id JOIN files f ON f.id = x.file_id LEFT JOIN nodes n ON n.id = x.src_id WHERE l.route_id = ?")
  const lim = Math.max(1, Math.min(Number(limit) || 60, 500))
  const byKind = rows.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {})
  const out = [`Routes (${rows.length}${rows.length !== total ? ` of ${total}` : ''}: ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}); give one (its path, or #r<id>) for its handler, middleware and callers`]
  for (const r of rows.slice(0, lim)) {
    const h = r.handler_id ? g.node(r.handler_id) : null
    const c = cnt.get(r.id)
    out.push(`  #r${r.id}  ${routeTitle(r)}  → ${h ? `${h.qualname}  ${g.loc(h)}` : r.handler ? `${JSON.parse(r.handler).name} (not resolved)` : 'inline'}  · ${c.c} caller(s)${c.t ? `, ${c.t} in tests` : ''}  · ${r.framework}`)
  }
  if (rows.length > lim) out.push(`  … ${rows.length - lim} more (filter by a path fragment or a method)`)
  return out.join('\n')
}

// graph_overview's part: route counts and their top prefixes, per repository
export function routeSummary(g, repo) {
  const rows = g.q(`${ROUTE_ROWS} AND f.repo = ?`, repo)
  if (!rows.length) return null
  const http = rows.filter((r) => r.kind === 'http'), screens = rows.filter((r) => r.kind === 'screen')
  const pre = new Map()
  // a route's first two segments, up to its first parameter (`{…}`, an unknown prefix, counts as one)
  for (const r of http) {
    const segs = []
    for (const g of primaryPath(r).split('/').filter(Boolean)) { if (segs.length === 2 || (g !== UNKNOWN && templateSegs(g)[0]?.t !== 'L')) break; segs.push(g) }
    const k = segs.length ? (segs[0] === UNKNOWN ? '' : '/') + segs.join('/') : '/'
    pre.set(k, (pre.get(k) || 0) + 1)
  }
  const top = [...pre].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6)
  return `  routes: ${http.length} http${screens.length ? `, ${screens.length} screen(s)` : ''}${top.length ? ` · top prefixes ${top.map(([k, n]) => `${k} (${n})`).join(', ')}` : ''} (graph_routes)`
}

// How well one call site matches one route, as linkRoutes scores it (null: no match). route { kind,
// method, path, full: [{ p }], repo }; ref { kind, method, toks: [hash], lead, named, repo }. graph_diff
// (change.mjs) matches the call sites against a route the base served and the branch does not.
export function routeScore(route, ref) {
  if (ref.named) return route.kind === 'screen' && !route.path.startsWith('/') && hashSeg(route.path) === ref.toks[0] ? { score: route.repo === ref.repo ? 1 : 0, how: 'name' } : null
  if ((ref.kind === 'http' && route.kind !== 'http') || (ref.kind === 'screen' && route.kind !== 'screen')) return null
  if (route.kind === 'screen' && !route.path.startsWith('/')) return null
  const ms = methodsOf(route.method)
  if (ref.method && ms && !ms.includes(ref.method)) return null
  let best = null
  for (const v of route.full) { const m = matchSegs(templateSegs(v.p), ref.toks, !!ref.lead); if (m && m.lits && (!best || m.lits * 10 - m.params - 2 * m.wild > best.lits * 10 - best.params - 2 * best.wild)) best = m }
  if (!best) return null
  return { score: best.lits * 10 - best.params - 2 * best.wild + (ref.method && ms ? 1 : 0) + (route.repo === ref.repo ? 0.5 : 0), how: best.wild ? 'prefix unknown' : best.params ? 'template' : 'exact' }
}
