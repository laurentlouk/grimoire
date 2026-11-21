// grimoire graph · the impact of a change (graph_diff): what the working tree changed against a base,
// definition by definition, and everything that change can break that the diff itself does not show.
//
//   1. The diff: `git diff -U0 <merge base>` per repository (staged, unstaged; renames followed) and
//      the untracked files, as added and removed line ranges per file.
//   2. Definitions: the index's (the working tree) against the same files at the base, parsed in a
//      process of their own (symbols-aside.mjs). A definition is added, removed, moved (removed here,
//      added there under the same qualified name), or modified (its lines changed), and its signature
//      changed or not. Matched by kind and qualified name; a rename reads as removed + added.
//   3. Contract changes (removed, moved, signature changed): who still names them, from the edges,
//      the call sites resolution left unlinked, and every other mention (reach.mjs). A removed name
//      still called is the classic break a diff hides.
//   4. Impact: what reaches the changed definitions (calls, inheritance, imports, dispatch through
//      supertypes), split into the files this diff touches and the ones it does not.
//   5. Tests: the tests reaching each changed definition (tests to run) and the changed code no test
//      reaches; tests the diff edits.
//   6. Co-change gaps: files that usually change with a changed file (git history) and are not in
//      this diff.
//   5b. Routes removed or moved: the routes the base's versions of the diff's files served (their
//      routes read aside with the definitions) that no route of the branch serves any more (a route
//      file moved or removed, a handler removed), with the call sites still naming them.
//   7. A risk line, with its reasons. Everything is a lead: open path:line before relying on it.
//   The data model's changes against the same base come with the definitions (dataChangeLines): a
//   removed or retyped table or column still named by the queries in code is a contract change too.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { langOf, familyOf } from './langs.mjs'
import { skipped, maxBytesOf } from './project.mjs'
import { treeAt, blobs } from './data/base.mjs'
import { symbolsAside } from './symbols-aside.mjs'
import { unresolved, mentions, kindOfPath, USE_KINDS, siteText, dispatch, TEST_EDGES, TEST_DEPTH } from './reach.mjs'
import { routesServedBy, routeCallers, routeTitle, routeScore, methodText } from './route-graph.mjs'
import { joinPath, UNKNOWN, hashSeg } from './routes.mjs'
import { describe } from './query.mjs'

const dispatchUp = (g, n) => dispatch(g, n).up.map((u) => u.node)

const git = (dir, args) => spawnSync('git', ['-c', 'core.quotepath=off', '-C', dir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
const stem = (p) => path.posix.basename(p || '').replace(/\.[^.]+$/, '')
const CALLABLE = new Set(['function', 'method', 'constructor', 'macro'])
const LISTED = 40, GAP_MIN = 2, GAP_RATIO = 0.3

// `git diff -U0` → [{ path, oldPath, status A|M|D|R, added: [[from, to]], removed: [[from, to]], cuts: [line] }]
// (cuts: a pure deletion, after that line of the new side). C-quoted paths are unquoted.
export function parsePatch(text) {
  const files = []
  let cur = null
  const unq = (p) => { if (!p.startsWith('"')) return p; try { return JSON.parse(p) } catch { return p.slice(1, -1) } }
  // git ends a `---` / `+++` name holding a space with a tab
  const name = (p, side) => unq(p.replace(/\t$/, '')).replace(side, '')
  let inHunks = false
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) { cur = { path: null, oldPath: null, status: 'M', added: [], removed: [], cuts: [] }; files.push(cur); inHunks = false; continue }
    if (!cur) continue
    if (inHunks && !line.startsWith('@@')) continue // a hunk's own lines (`-- x` removed reads as `--- x`)
    if (line.startsWith('new file mode')) cur.status = 'A'
    else if (line.startsWith('deleted file mode')) cur.status = 'D'
    else if (line.startsWith('rename from ')) { cur.oldPath = unq(line.slice(12)); cur.status = 'R' }
    else if (line.startsWith('rename to ')) cur.path = unq(line.slice(10))
    else if (line.startsWith('--- ')) { const p = line.slice(4); if (p !== '/dev/null' && cur.status !== 'R') cur.oldPath = name(p, /^a\//) }
    else if (line.startsWith('+++ ')) { const p = line.slice(4); if (p !== '/dev/null' && cur.status !== 'R') cur.path = name(p, /^b\//) }
    else if (line.startsWith('@@')) {
      inHunks = true
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      if (!m) continue
      const os = Number(m[1]), ol = m[2] === undefined ? 1 : Number(m[2]), ns = Number(m[3]), nl = m[4] === undefined ? 1 : Number(m[4])
      if (ol) cur.removed.push([os, os + ol - 1])
      if (nl) cur.added.push([ns, ns + nl - 1])
      else cur.cuts.push(ns)
    }
  }
  for (const f of files) {
    if (f.status === 'D') f.path = null
    if (f.status === 'A') f.oldPath = null
    else if (!f.oldPath) f.oldPath = f.path
  }
  return files.filter((f) => f.path || f.oldPath)
}

// The innermost definitions holding any of the lines (ranges) or straddling a cut. defs: [{ line, endLine|end_line }]
export function touched(defs, ranges, cuts = []) {
  const end = (d) => d.endLine ?? d.end_line
  const hit = new Set()
  const innermost = (pred) => { let best = null; for (const d of defs) if (pred(d) && (!best || end(d) - d.line < end(best) - best.line)) best = d; return best }
  for (const [a, b] of ranges) {
    const top = Math.min(b, Math.max(0, ...defs.map(end)))
    for (let l = a; l <= top; l++) { const d = innermost((x) => x.line <= l && end(x) >= l); if (d) hit.add(d) }
  }
  for (const c of cuts) { const d = innermost((x) => x.line <= c && end(x) > c); if (d) hit.add(d) }
  return hit
}

// Match two lists of definitions by kind + qualified name. Several of one name (overloads, conditional
// definitions): those with the same signature pair first, the rest by order. → [[now | null, was | null]]
export function pair(now, was) {
  const group = (defs) => { const m = new Map(); for (const d of [...defs].sort((a, b) => a.line - b.line)) { const k = `${d.kind} ${d.qualname}`; (m.get(k) || m.set(k, []).get(k)).push(d) } return m }
  const A = group(now), B = group(was), out = []
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    const a = [...(A.get(k) || [])], b = [...(B.get(k) || [])]
    for (const x of [...a]) { const j = b.findIndex((y) => (y.signature || '') === (x.signature || '')); if (j >= 0) { out.push([x, b[j]]); b.splice(j, 1); a.splice(a.indexOf(x), 1) } }
    const n = Math.max(a.length, b.length)
    // what is left: an overload whose signature changed pairs only when one is left on each side
    if (a.length === 1 && b.length === 1) out.push([a[0], b[0]])
    else for (let i = 0; i < n; i++) { if (a[i]) out.push([a[i], null]); if (b[i]) out.push([null, b[i]]) }
  }
  return out
}

// `git diff --name-status -z`: every changed file with its exact path, binary, empty and mode-only
// changes included (a patch names those in no `---` / `+++` line)
export function parseNameStatus(text) {
  const parts = text.split('\0'), out = []
  for (let i = 0; i < parts.length && parts[i];) {
    const st = parts[i++][0]
    if (st === 'R' || st === 'C') { const from = parts[i++], to = parts[i++]; out.push(st === 'R' ? { status: 'R', oldPath: from, path: to } : { status: 'A', oldPath: null, path: to }) }
    else { const p = parts[i++]; out.push(st === 'A' ? { status: 'A', oldPath: null, path: p } : st === 'D' ? { status: 'D', oldPath: p, path: null } : { status: 'M', oldPath: p, path: p }) }
  }
  return out
}

export function readDiff(base, project, repo = null) {
  const files = []
  for (const r of base.repos) {
    if (repo && r.name !== repo) continue
    const args = ['--no-color', '--no-ext-diff', '-M', '--relative', r.at, '--', '.']
    const d = git(r.abs, ['diff', '-U0', ...args])
    const ns = git(r.abs, ['diff', '--name-status', '-z', ...args])
    if (d.status !== 0 || ns.status !== 0) throw new Error(`git diff failed in ${r.name}: ${((d.stderr || ns.stderr) || '').trim().split('\n')[0]}`)
    const hunks = new Map(parsePatch(d.stdout).map((f) => [`${f.oldPath}\0${f.path}`, f]))
    for (const f of parseNameStatus(ns.stdout)) {
      const h = hunks.get(`${f.oldPath}\0${f.path}`) || { added: [], removed: [], cuts: [] }
      files.push({ repo: r.name, abs: r.abs, commit: r.at, ...f, added: h.added, removed: h.removed, cuts: h.cuts })
    }
    const u = git(r.abs, ['ls-files', '--others', '--exclude-standard', '-z'])
    for (const p of (u.status === 0 ? u.stdout.split('\0') : []).filter(Boolean)) files.push({ repo: r.name, abs: r.abs, commit: r.at, path: p, oldPath: null, status: 'A', added: [[1, Number.MAX_SAFE_INTEGER]], removed: [], cuts: [] })
  }
  // a file moved into a skipped folder (or out of one) is a removal (an addition) of what the graph sees
  const out = []
  for (const f of files) {
    const oldIn = f.oldPath && !skipped(f.oldPath, project), newIn = f.path && !skipped(f.path, project)
    if (oldIn && newIn) out.push(f)
    else if (oldIn) out.push({ ...f, status: 'D', path: null })
    else if (newIn) out.push({ ...f, status: 'A', oldPath: null, added: [[1, Number.MAX_SAFE_INTEGER]], removed: [] })
  }
  return out
}

// The definitions of the diff's code files at the base: Map(`repo|oldPath` → defs | Error)
function baseDefs(files, project) {
  const out = new Map(), items = []
  const byRepo = new Map()
  for (const f of files) if (f.oldPath && f.status !== 'A') (byRepo.get(f.repo) || byRepo.set(f.repo, []).get(f.repo)).push(f)
  for (const list of byRepo.values()) {
    const { abs, commit } = list[0]
    let tree
    try { tree = treeAt(abs, commit, list.map((f) => f.oldPath)) } catch (e) { for (const f of list) out.set(`${f.repo}|${f.oldPath}`, e); continue }
    for (const f of list) { const e = tree.get(f.oldPath), cap = maxBytesOf(project, f.oldPath); if (e && e.size > cap) out.set(`${f.repo}|${f.oldPath}`, new Error(`over ${Math.round(cap / 1024)} KB at the base: not read`)) }
    const want = list.map((f) => ({ f, entry: tree.get(f.oldPath) })).filter((x) => x.entry && x.entry.size <= maxBytesOf(project, x.f.oldPath))
    const got = blobs(abs, want.map((x) => x.entry))
    for (const { f, entry } of want) {
      const buf = got.get(entry.oid)
      if (!buf) continue
      items.push({ key: `${f.repo}|${f.oldPath}`, path: f.oldPath, lang: langOf(f.oldPath), text: buf.toString('utf8') })
    }
  }
  // `rel`: the routes each base file declared come back too (on the list's `routes`)
  const parsed = symbolsAside(items.map((x) => ({ path: x.key, lang: x.lang, text: x.text, rel: x.path })))
  for (const [k, v] of parsed) out.set(k, v)
  return out
}

// The data model's part of a change (step 3b): the branch's model against the base's, read as
// graph_changes reads them (data/diff.mjs), each element added, removed or modified, and for a table
// or a column removed or retyped, the code still naming it: the Drizzle calls naming a table no schema
// table resolves any more (by the variable the base's schema named it by), the [inferred] conflicts
// the queries in code add where they name a column or a table the declarations lack (the SQL the code
// sends and the Drizzle calls alike), and for a retyped column the calls naming it (or, for SQL, the
// calls reading or writing its table). A use outside the lines this diff changed is still at risk.
// A column added not null with no default: the Drizzle inserts into its table that do not set it.
//   data: { d: diffModels(base, branch), current: the branch's model, baseRows: the base's facts } | { why }
export function dataChangeLines(g, data, inLines) {
  if (!data) return { out: [], risk: [] }
  if (data.why) return { out: [`Data model: not compared (${data.why})`], risk: [] }
  const { d, current } = data
  const k = d.counts
  if (!d.stores.length) return { out: ['Data model changes (against the same base): none'], risk: [] }
  const out = [`Data model changes (against the same base; graph_changes lists each in full): ${k.stores} store(s) changed · ${k.added} added · ${k.removed} removed · ${k.modified} modified${k.renames ? ` · ${k.renames} possible rename(s), never decided` : ''}`]
  const risk = []
  const loc = (repo, x) => g.dloc({ repo: x.repo ?? repo, path: x.path, line: x.line })
  // the base's Drizzle names: (store id, table) → its variable, (store id, table, column) → its key
  const baseVar = new Map(), baseKey = new Map()
  for (const r of data.baseRows || []) {
    if (!/^drizzle-ts@/.test(r.extractor)) continue
    for (const dd of r.facts.declarations || []) for (const e of dd.entities || []) {
      const sid = `${r.repo}:${dd.store}`
      if (e.var) baseVar.set(`${sid}\0${e.name}`, e.var)
      for (const f of e.fields || []) if (f.key) baseKey.set(`${sid}\0${e.name}\0${f.name}`, f.key)
    }
  }
  const sites = current.queries?.sites || []
  const z = current.drizzle || { unresolvedAt: [] }
  const named = (list, what) => {
    // a use is at risk unless this diff changed its line
    const outside = list.filter((x) => !inLines(x.repo, x.path, x.line))
    if (outside.length) risk.push(`${what} is still named outside the lines this diff changed (${outside.length} place(s))`)
    return list.slice(0, 8).map((x) => `${loc(null, x)}${x.fn ? ` (${x.fn})` : ''}${x.how ? ` [${x.how}]` : ''}${inLines(x.repo, x.path, x.line) ? ' changed in this diff' : ''}`).join(' · ') + (list.length > 8 ? ` · … ${list.length - 8} more` : '')
  }
  for (const st of d.stores) {
    out.push(`  ${st.id}  ${st.change === 'added' ? 'added (absent at the base)' : st.change === 'removed' ? 'removed (absent from the branch)' : 'modified'}`)
    const now = current.stores.find((x) => x.id === st.id)
    const entityNow = (name) => now?.entities.find((e) => e.name === name) || null
    let shown = 0
    for (const c of st.changes) {
      if (shown++ >= 30) { out.push(`    … ${st.changes.length - 30} more (graph_changes lists them)`); break }
      const el = c.after || c.before
      const src = (c.after || c.before).sources || []
      if (c.change === 'added') out.push(`    + ${describe(c, el, st.dialect)}  — ${src.map((x) => loc(st.repo, x)).join(' · ')}`)
      else if (c.change === 'removed') out.push(`    - ${describe(c, el, st.dialect)}  — was ${src.map((x) => loc(st.repo, x)).join(' · ')}`)
      else out.push(`    ~ ${describe(c, el, st.dialect)}  ${c.attrs.map((a) => `${a.attr}: ${a.before ?? 'none'} → ${a.after ?? 'none'}`).join('; ')}`)
      // who still names what the change took away or retyped
      if (c.kind === 'entity' && c.change === 'removed') {
        const v = baseVar.get(`${st.id}\0${c.name}`) || c.name
        const left = z.unresolvedAt.filter((u) => u.repo === st.repo && u.name === v).map((u) => ({ ...u, how: 'drizzle' }))
        const sql = (now?.queries?.conflicts || []).filter((x) => x.label.toLowerCase() === c.name.toLowerCase()).flatMap((x) => x.values[0].sources.map((y) => ({ ...y, how: 'sql' })))
        if (left.length || sql.length) out.push(`      still named: ${named([...left, ...sql], `removed table ${c.name}`)}`)
      }
      if (c.kind === 'field' && c.change === 'removed') {
        const e = entityNow(c.entity)
        const keys = new Set([c.name, baseKey.get(`${st.id}\0${c.entity}\0${c.name}`)].filter(Boolean))
        const left = (e?.queries?.conflicts || []).filter((x) => keys.has(x.path)).flatMap((x) => x.values[0].sources.map((y) => ({ ...y, how: y.extractor && /^drizzle-queries@/.test(y.extractor) ? 'drizzle' : 'sql' })))
        if (left.length) out.push(`      still named: ${named(left, `removed column ${c.entity}.${c.name}`)}`)
      }
      if (c.kind === 'field' && c.change === 'modified' && c.attrs.some((a) => a.attr === 'type')) {
        const e = entityNow(c.entity)
        const mine = (e?.queries?.sites || []).map((i) => sites[i]).filter(Boolean)
        const cols = mine.filter((x) => (x.columns || []).some((y) => y.entity === e.id && y.name === el.name)).map((x) => ({ repo: x.repo, path: x.path, line: x.line, fn: x.fn, how: 'drizzle' }))
        const sql = mine.filter((x) => x.call !== 'drizzle').map((x) => ({ repo: x.repo, path: x.path, line: x.line, fn: x.fn, how: 'sql, reads or writes its table' }))
        if (cols.length || sql.length) out.push(`      read or written by: ${named([...cols, ...sql], `retyped column ${c.entity}.${el.name}`)}`)
      }
      if (c.kind === 'field' && c.change === 'added' && c.after.nullable === false && (c.after.default === null || c.after.default === undefined) && !c.after.computed && !c.after.generated) {
        const e = entityNow(c.entity)
        const inserts = (e?.queries?.sites || []).map((i) => sites[i]).filter((x) => x && x.call === 'drizzle' && x.kinds.includes('insert') && x.writes.includes(e.id) && !x.open && !(x.columns || []).some((y) => y.entity === e.id && y.name === el.name))
        const outside = inserts.filter((x) => !inLines(x.repo, x.path, x.line))
        if (inserts.length) out.push(`      inserts that do not set it (a not-null column with no default): ${inserts.slice(0, 8).map((x) => `${loc(null, x)}${x.fn ? ` (${x.fn})` : ''}`).join(' · ')}`)
        if (outside.length) risk.push(`${outside.length} insert(s) into ${c.entity} do not set the not-null column ${el.name} added with no default`)
      }
    }
    for (const r of st.renames.slice(0, 5)) out.push(`    possible rename, not decided: ${r.from.map((i) => st.changes[i].name).join(', ')} → ${r.to.map((i) => st.changes[i].name).join(', ')}`)
  }
  return { out, risk }
}

// The routes the base's versions of the diff's code files served that no route of the branch serves:
// [{ repo, title, was (base path), line, handler, why (removed | moved with its file), now (what the
// renamed file serves instead), callers: call sites that match it at least as well as any route they
// reach now }]. A base route keeps its path as written; its prefix is composed as the index composes
// it: a file route's own, NestJS's global prefix, a router's from the routes the same router still
// serves in the file (else unknown, `{…}`, matched as any prefix).
function routesGone(g, code, based) {
  const files = code.filter((f) => f.oldPath && f.status !== 'A')
  const base = files.map((f) => ({ f, list: based.get(`${f.repo}|${f.oldPath}`)?.routes?.list || [], gp: based.get(`${f.repo}|${f.oldPath}`)?.routes?.globalPrefix })).filter((x) => x.list.length)
  if (!base.length) return []
  const rowsIn = g.db.prepare('SELECT r.*, f.repo FROM routes r JOIN files f ON f.id = r.file_id WHERE f.repo = ? AND f.path = ? AND r.full IS NOT NULL')
  const served = new Map() // repo → Set of `kind|method|path` served now
  const servedIn = (repo) => {
    if (!served.has(repo)) {
      const set = new Set()
      for (const r of g.q('SELECT r.kind, r.method, r.full FROM routes r JOIN files f ON f.id = r.file_id WHERE f.repo = ? AND r.full IS NOT NULL', repo)) for (const v of JSON.parse(r.full)) set.add(`${r.kind}|${methodText(r)}|${v.p}`)
      served.set(repo, set)
    }
    return served.get(repo)
  }
  const prefixOf = new Map() // repo → NestJS's global prefix now
  const globalPrefix = (repo) => {
    if (!prefixOf.has(repo)) prefixOf.set(repo, g.q('SELECT rf.facts FROM route_facts rf JOIN files f ON f.id = rf.file_id WHERE f.repo = ?', repo).map((r) => JSON.parse(r.facts).meta?.globalPrefix).find((x) => x !== undefined))
    return prefixOf.get(repo)
  }
  const gone = []
  for (const { f, list, gp } of base) {
    const now = f.path ? rowsIn.all(f.repo, f.path) : []
    for (const r of list) {
      // the same declaration in the file now (its router, method and path as written): still served
      if (now.some((x) => x.kind === r.kind && (x.method || null) === (r.method || null) && (x.router || null) === (r.router || null) && x.path === r.path)) continue
      let full
      if (r.router && /^(v|p|i|g|a):|^django$/.test(r.router)) {
        // the prefixes the same router serves under now, from its routes left in the file
        const pre = new Set()
        for (const x of now.filter((y) => y.router === r.router)) for (const v of JSON.parse(x.full)) { const own = joinPath('', x.path); if (v.p.endsWith(own) && joinPath(v.p.slice(0, v.p.length - own.length), x.path) === v.p) pre.add(v.p.slice(0, v.p.length - own.length)) }
        full = (pre.size ? [...pre] : [UNKNOWN]).map((p) => ({ p: joinPath(p, r.path) }))
      } else if (r.router === 'nest' && (gp ?? globalPrefix(f.repo)) !== undefined) full = [{ p: joinPath(gp ?? globalPrefix(f.repo), r.path) }]
      else full = [{ p: r.kind === 'screen' && !r.path.startsWith('/') ? r.path : joinPath('', r.path) }]
      // served elsewhere now under every path (a handler moved to another file, a route kept)
      const set = servedIn(f.repo), mt = methodText(r)
      if (full.every((v) => set.has(`${r.kind}|${mt}|${v.p}`) || set.has(`${r.kind}|*|${v.p}`))) continue
      const renamed = f.status === 'R' && f.path
      gone.push({ repo: f.repo, route: { ...r, full, repo: f.repo }, title: `${mt} ${full[0].p}`, was: f.oldPath, line: r.line, handler: r.handler?.name || null, why: renamed && now.length ? 'moved with its file' : f.path ? 'removed' : 'removed with its file', now: renamed ? now.slice(0, 3).map(routeTitle) : [] })
    }
  }
  if (!gone.length) return []
  // the call sites, each matched against the lost routes and against the route it reaches now
  const refs = g.q(`SELECT x.id, x.kind, x.method, x.toks, x.lead, x.named, x.line, f.repo, f.path, f.is_test AS ftest, n.kind AS skind, n.qualname AS sname, n.is_test AS stest
    FROM route_refs x JOIN files f ON f.id = x.file_id LEFT JOIN nodes n ON n.id = x.src_id ORDER BY f.is_test, f.repo, f.path, x.line`)
  const linkedTo = g.db.prepare('SELECT r.kind, r.method, r.path, r.full, f.repo FROM route_links l JOIN routes r ON r.id = l.route_id JOIN files f ON f.id = r.file_id WHERE l.ref_id = ?')
  const want = new Set(gone.flatMap((x) => x.route.full.flatMap((v) => (x.route.kind === 'screen' && !x.route.path.startsWith('/') ? [hashSeg(x.route.path)] : v.p.split('/').filter(Boolean).map(hashSeg)))))
  for (const ref of refs) {
    const toks = ref.toks.split('/')
    if (!toks.some((t) => want.has(t))) continue // no literal segment of a lost route: no match
    const site = { ...ref, toks }
    let nowBest = null
    for (const x of gone) {
      const m = routeScore(x.route, site)
      if (!m) continue
      if (nowBest === null) nowBest = Math.max(-Infinity, ...linkedTo.all(ref.id).map((r) => routeScore({ ...r, full: JSON.parse(r.full) }, site)?.score ?? -Infinity))
      if (m.score >= nowBest) x.callers = [...(x.callers || []), { ...ref, how: m.how }]
    }
  }
  for (const x of gone) x.callers ||= []
  return gone
}

export function changeImpact(g, project, base, { repo = null, depth = 2, text = true, data = null, diff = null } = {}) {
  const files = diff || readDiff(base, project, repo)
  const isCode = (p) => { const l = p && langOf(p); return !!l && l !== 'other' }
  const code = files.filter((f) => isCode(f.path || f.oldPath))
  const others = files.filter((f) => !isCode(f.path || f.oldPath))
  const inDiff = new Set(files.flatMap((f) => [f.path && `${f.repo}|${f.path}`, f.oldPath && `${f.repo}|${f.oldPath}`].filter(Boolean)))
  const head = `Changes against ${base.text}`
  if (!files.length) return `${head}: none (the working tree matches it).`

  const based = baseDefs(code, project)
  const fileRow = g.db.prepare('SELECT * FROM files WHERE repo = ? AND path = ?')
  const defsOf = g.db.prepare("SELECT n.*, f.repo, f.path, f.lang FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.file_id = ? AND n.kind != 'file'")
  const changes = [] // { op: + - ~ >, node?, was?, file, sig?: { was, now } }
  const notes = []
  for (const f of code) {
    const row = f.path ? fileRow.get(f.repo, f.path) : null
    if (f.path && !row) { notes.push(`${g.loc({ repo: f.repo, path: f.path, kind: 'file' })}: not in the index (too large, excluded or not parsed): its definitions are not compared`); continue }
    const now = row ? defsOf.all(row.id) : []
    const was = f.oldPath && f.status !== 'A' ? based.get(`${f.repo}|${f.oldPath}`) : []
    if (was instanceof Error) notes.push(`${g.loc({ repo: f.repo, path: f.oldPath, kind: 'file' })}: the base version could not be parsed (${was.message}): its changed definitions are listed as modified, none as removed`)
    if (f.status === 'A') { for (const n of now) changes.push({ op: '+', node: n, file: f }); continue }
    if (!was || was instanceof Error) { for (const n of touched(now, f.added, f.cuts)) changes.push({ op: '~', node: n, file: f }); continue }
    const nowHit = touched(now, f.added, f.cuts), wasHit = touched(was, f.removed)
    for (const [n, w] of pair(now, was)) {
      if (!w) { changes.push({ op: '+', node: n, file: f }); continue }
      if (!n) { changes.push({ op: '-', was: w, file: f }); continue }
      const sig = (w.signature || '') !== (n.signature || '') ? { was: w.signature, now: n.signature } : null
      if (nowHit.has(n) || wasHit.has(w) || sig) changes.push({ op: '~', node: n, was: w, file: f, sig })
    }
  }
  // removed here and added there under the same name: moved
  const added = changes.filter((c) => c.op === '+')
  for (const c of changes.filter((x) => x.op === '-')) {
    const to = added.find((a) => a.op === '+' && a.node.kind === c.was.kind && a.node.qualname === c.was.qualname && a.file !== c.file)
    if (to) { c.op = '>'; c.node = to.node; to.op = null; if ((c.was.signature || '') !== (to.node.signature || '')) c.sig = { was: c.was.signature, now: to.node.signature } }
  }
  const live = changes.filter((c) => c.op)
  const count = (op) => live.filter((c) => c.op === op).length
  const sigs = live.filter((c) => c.sig && c.op === '~').length
  const out = [`${head}: ${files.length} file(s) (${code.length} code, ${others.length} other), ${live.length} definition(s): ${count('~')} modified${sigs ? ` (${sigs} with a new signature)` : ''}, ${count('+')} added, ${count('-')} removed, ${count('>')} moved`]
  for (const n of notes) out.push(`  note: ${n}`)

  // ── the definitions ──
  const wasLoc = (c) => g.loc({ repo: c.file.repo, path: c.file.oldPath, kind: 'x', line: c.was.line })
  const shown = live.filter((c) => !(c.op === '+' && c.node.parent_id && live.some((p) => p.op === '+' && p.node.id === c.node.parent_id))) // an added type stands for its members
  const order = { '-': 0, '>': 1, '~': 2, '+': 3 }
  shown.sort((a, b) => order[a.op] - order[b.op] || (b.sig ? 1 : 0) - (a.sig ? 1 : 0))
  // test code the diff adds is counted, not listed
  const addedTests = shown.filter((c) => c.op === '+' && c.node.is_test)
  const listed = shown.filter((c) => !addedTests.includes(c))
  out.push('Definitions:')
  for (const c of listed.slice(0, LISTED)) {
    if (c.op === '-') out.push(`  - ${c.was.qualname}  ${c.was.kind}  (was ${wasLoc(c)})`)
    else if (c.op === '>') out.push(`  > ${c.node.qualname}  ${c.node.kind}  moved: ${wasLoc(c)} → ${g.loc(c.node)}`)
    else out.push(`  ${c.op} ${g.row(c.node)}${c.op === '~' ? (c.sig ? '  signature changed' : '  body') : ''}`)
    if (c.sig) out.push(`      was: ${c.sig.was || '(none)'}`, `      now: ${c.sig.now || '(none)'}`)
  }
  if (listed.length > LISTED) out.push(`  … ${listed.length - LISTED} more`)
  if (addedTests.length) out.push(`  + ${addedTests.length} test definition(s) in ${new Set(addedTests.map((c) => c.node.path)).size} test file(s)`)
  if (others.length) {
    const tag = (f) => `${g.loc({ repo: f.repo, path: f.path || f.oldPath, kind: 'file' })} (${f.status === 'A' ? 'added ' : f.status === 'D' ? 'removed ' : ''}${kindOfPath(f.path || f.oldPath)})`
    out.push(`Other files changed: ${others.slice(0, 20).map(tag).join(', ')}${others.length > 20 ? `, … ${others.length - 20} more` : ''}`)
  }

  // ── the data model: what the branch changed in it, and who still names what it removed ──
  const inLines = (r, p, line) => files.some((f) => f.repo === r && f.path === p && f.added.some(([a, b]) => a <= line && line <= b))
  const dm = dataChangeLines(g, data, inLines)
  out.push(...dm.out)

  // a line this diff changed (its new side)
  const ranges = new Map(files.filter((f) => f.path).map((f) => [`${f.repo}|${f.path}`, f.added]))
  const lineChanged = (repo, p, line) => (ranges.get(`${repo}|${p}`) || []).some(([a, b]) => line >= a && line <= b)

  // ── contract changes: who still names them ──
  const contract = live.filter((c) => c.op === '-' || c.op === '>' || c.sig)
  const risk = [...dm.risk]
  if (contract.length) {
    const pseudo = (c) => ({ id: -1, name: c.was.name, qualname: c.was.qualname, kind: c.was.kind, lang: langOf(c.file.oldPath), repo: c.file.repo, path: c.file.oldPath, line: -1, parent_id: null })
    const subjects = contract.map((c) => ({ c, t: c.op === '-' ? pseudo(c) : c.node }))
    for (const x of subjects) x.sites = unresolved(g, [x.t])
    const terms = new Map()
    for (const x of subjects) if (!['constructor'].includes(x.t.kind)) { if (!terms.has(x.t.name)) terms.set(x.t.name, []); terms.get(x.t.name).push(x.t) }
    const ment = project && text ? mentions(g, project, [...terms].map(([term, targets]) => ({ term, targets })), { sites: subjects.flatMap((x) => x.sites) }) : null
    // A use is at risk unless this diff changed it: a caller whose definition the diff changed, a
    // site or mention on a line the diff changed. A caller in a changed file, on an untouched line,
    // is still at risk.
    const changedIds = new Set(live.filter((c) => c.node).map((c) => c.node.id))
    const tag = (changed) => (changed ? '  (changed in this diff)' : '')
    // imports naming a removed or moved name (`from .helpers import x`, `import { x } from './a'`):
    // they fail at load time; one from the moved name's new module is fine
    const importsOf = g.db.prepare('SELECT i.line, i.source, i.names, f.repo, f.path, f.lang FROM imports i JOIN files f ON f.id = i.file_id')
    const allImports = importsOf.all().map((i) => ({ ...i, names: JSON.parse(i.names || '[]').map((n) => String(n).split('=').pop()) }))
    out.push('Contract changes (removed, moved, new signature): who still names them')
    subjects.forEach(({ c, t, sites }, i) => {
      const what = c.op === '-' ? `removed ${c.was.qualname}` : c.op === '>' ? `moved ${c.node.qualname}` : `new signature of ${c.node.qualname}`
      // a definition passing it as a value (REFERENCES) names it as surely as a caller
      const callers = t.id > 0 ? g.q("SELECT s.id, min(e.kind = 'REFERENCES') AS byRef FROM edges e JOIN nodes s ON s.id = e.src WHERE e.dst = ? AND e.kind IN ('CALLS','REFERENCES','EXTENDS','IMPLEMENTS') GROUP BY s.id ORDER BY min(e.rowid)", t.id).map((r) => ({ ...g.node(r.id), byRef: !!r.byRef })) : []
      const hits = ment ? ment.hits.filter((h) => h.term === t.name && (c.op !== '>' || USE_KINDS.has(h.kind))) : []
      const imps = c.op === '-' || c.op === '>' ? allImports.filter((im) => im.names.includes(t.name) && familyOf(im.lang) === familyOf(t.lang) && !(im.repo === c.file.repo && im.path === (c.op === '>' ? c.node.path : c.file.oldPath)) && !(c.op === '>' && im.source.split(/[/.:\\]+/).filter(Boolean).pop() === stem(c.node.path))) : []
      const uses = hits.filter((h) => USE_KINDS.has(h.kind) && !(h.kind === 'import' && imps.some((im) => im.repo === h.repo && im.path === h.path && im.line === h.line)))
      const atRisk = callers.filter((n) => !changedIds.has(n.id)).length + sites.filter((x) => !lineChanged(x.ref.repo, x.ref.path, x.ref.line)).length
        + imps.filter((im) => !lineChanged(im.repo, im.path, im.line)).length + uses.filter((h) => !lineChanged(h.repo, h.path, h.line)).length
      if (atRisk) risk.push(`${what} is still named outside the lines this diff changed (${atRisk} place(s))`)
      if (i >= 20) return
      out.push(`  ${what}: ${callers.length} linked caller(s), ${sites.length} unlinked call site(s)${imps.length ? `, ${imps.length} import(s)` : ''}, ${hits.length} other mention(s); ${atRisk} not changed by this diff`)
      for (const n of callers.slice(0, 10)) out.push(`    ${n.byRef ? 'value ' : 'caller'}  ${g.row(n)}${n.byRef ? '  (by reference)' : ''}${tag(changedIds.has(n.id))}`)
      for (const x of sites.slice(0, 10)) out.push(`    call    ${g.loc({ repo: x.ref.repo, path: x.ref.path, kind: 'x', line: x.ref.line })}  ${x.src && x.src.kind !== 'file' ? `in ${x.src.qualname}` : 'at file level'}  ${siteText(x.ref)}${tag(lineChanged(x.ref.repo, x.ref.path, x.ref.line))}`)
      for (const im of imps.slice(0, 10)) out.push(`    import  ${g.loc({ repo: im.repo, path: im.path, kind: 'x', line: im.line })}${tag(lineChanged(im.repo, im.path, im.line))}`)
      if (hits.length > uses.length) out.push(`    (${hits.length - uses.length} more in text, docs and comments: graph_impact lists them)`)
      for (const h of uses.slice(0, 10)) out.push(`    ${h.kind.padEnd(7)} ${g.loc({ repo: h.repo, path: h.path, kind: 'x', line: h.line })}${h.where ? `  in ${h.where}` : ''}${tag(lineChanged(h.repo, h.path, h.line))}`)
    })
    if (subjects.length > 20) out.push(`  … ${subjects.length - 20} more (each counted in the risk)`)
    for (const cm of ment ? ment.common : []) out.push(`  "${cm.term}" appears on ${cm.n} lines of ${cm.repo}: too common to sort`)
  }

  // ── files renamed or removed: imports still pointing at the old path ──
  // An import the resolver could not link whose last segment is the old file's name (`../auth/session`,
  // `app.auth.session`, `crate::auth::session`), in the same language family: it was this file's.
  const gone = code.filter((f) => f.oldPath && (f.status === 'D' || f.status === 'R'))
  if (gone.length) {
    const stale = g.db.prepare('SELECT i.line, i.source, f.repo, f.path, f.lang FROM imports i JOIN files f ON f.id = i.file_id WHERE i.resolved = 0 AND f.repo = ?')
    const famOf = (p) => familyOf(langOf(p))
    const lines = []
    for (const f of gone) {
      const st = stem(f.oldPath)
      if (/^(index|__init__|mod|main|lib)$/.test(st)) continue // a folder's entry: named by its folder, too common to match
      const hits = stale.all(f.repo).filter((i) => famOf(i.path) === famOf(f.oldPath) && i.source.split(/[/.:\\]+/).filter(Boolean).pop() === st)
      const outside = hits.filter((i) => !inDiff.has(`${i.repo}|${i.path}`))
      lines.push(`  ${f.status === 'D' ? 'removed' : 'renamed'} ${g.loc({ repo: f.repo, path: f.oldPath, kind: 'file' })}${f.status === 'R' ? ` → ${f.path}` : ''}: ${hits.length} unresolved import(s) still name it${hits.length ? ` (${outside.length} outside this diff)` : ''}`)
      for (const i of hits.slice(0, 10)) lines.push(`    import  ${g.loc({ repo: i.repo, path: i.path, kind: 'x', line: i.line })}${inDiff.has(`${i.repo}|${i.path}`) ? '  (in this diff)' : ''}`)
      if (outside.length) risk.push(`${f.status === 'D' ? 'removed' : 'renamed'} file ${f.oldPath} is still imported outside this diff (${outside.length})`)
    }
    if (lines.length) out.push('Files renamed or removed: imports the resolver can no longer follow', ...lines)
  }

  // ── impact: what reaches the changed definitions ──
  const nodes = live.filter((c) => c.node && c.op !== '+').map((c) => c.node)
  const r = nodes.length ? g.reachData(nodes, { depth, project: null, text: false, members: false, config: false, sites: false, routes: false, cochange: false }) : { byFile: new Map(), dispatch: [] }
  const outsideFiles = [...r.byFile.entries()].filter(([k]) => !inDiff.has(k))
  const insideN = r.byFile.size - outsideFiles.length
  out.push(`Impact (depth ${depth}): ${r.byFile.size} file(s) reach the changed definitions, ${outsideFiles.length} of them outside this diff${insideN ? ` (${insideN} in it)` : ''}`)
  outsideFiles.sort((a, b) => Math.min(...a[1].map(([, i]) => i.depth)) - Math.min(...b[1].map(([, i]) => i.depth)))
  for (const [, list] of outsideFiles.slice(0, 30)) {
    const f = list[0][0]
    const syms = list.filter(([n]) => n.kind !== 'file').sort((a, b) => a[1].depth - b[1].depth)
    out.push(`  ${g.loc({ ...f, kind: 'file' })}  (distance ${Math.min(...list.map(([, i]) => i.depth))})${syms.length ? `  ${syms.slice(0, 5).map(([n, i]) => `${n.qualname}:${n.line} d${i.depth}`).join(', ')}${syms.length > 5 ? `, … ${syms.length - 5} more` : ''}` : ''}`)
  }
  if (outsideFiles.length > 30) out.push(`  … ${outsideFiles.length - 30} more file(s)`)
  for (const d of r.dispatch) {
    for (const u of d.up) out.push(`  dispatch: ${d.target.qualname} is declared on ${u.type.kind} ${u.type.qualname} (${g.loc(u.node)}): calls typed to it may land here`)
    for (const x of d.down) if (!inDiff.has(`${x.node.repo}|${x.node.path}`) || !live.some((c) => c.node && c.node.id === x.node.id)) out.push(`  ${['interface', 'trait', 'protocol'].includes(d.owner.kind) ? 'implementation' : 'override'} not changed here: ${g.row(x.node)}`)
  }

  // ── routes: what the changed definitions serve, and who calls those routes ──
  const served = routesServedBy(g, live.filter((c) => c.node && c.op !== '+').map((c) => c.node.id))
  if (served.length) {
    out.push(`Routes these changes handle (${served.length}): their callers reach the change through the URL or the screen`)
    for (const x of served.slice(0, 20)) {
      const cs = routeCallers(g, x.id)
      const t = cs.filter((c) => c.ftest || c.stest).length
      const outside = cs.filter((c) => !inDiff.has(`${c.repo}|${c.path}`)).length
      out.push(`  ${routeTitle(x)}  → ${x.handler_id ? g.node(x.handler_id).qualname : '?'}  ${cs.length} caller(s), ${t} in tests, ${outside} outside this diff  (#r${x.id})`)
    }
    if (served.length > 20) out.push(`  … ${served.length - 20} more`)
  }

  // ── routes the base served and the branch does not: who still calls them ──
  const lost = routesGone(g, code, based)
  if (lost.length) {
    out.push(`Routes removed or moved (${lost.length}): served at the base, by no route now; the call sites naming them reach no handler`)
    for (const x of lost.slice(0, 20)) {
      const outside = x.callers.filter((c) => !lineChanged(c.repo, c.path, c.line))
      const t = x.callers.filter((c) => c.ftest || c.stest).length
      out.push(`  ${x.title}  was ${g.loc({ repo: x.repo, path: x.was, kind: 'x', line: x.line })}${x.handler ? ` → ${x.handler}` : ''}  ${x.why}${x.now.length ? ` (now ${x.now.join(', ')})` : ''}  ${x.callers.length} caller(s), ${t} in tests, ${outside.length} not changed by this diff`)
      for (const c of x.callers.slice(0, 10)) out.push(`    caller  ${g.loc({ repo: c.repo, path: c.path, kind: 'x', line: c.line })}  ${c.skind && c.skind !== 'file' ? `in ${c.sname}` : 'at file level'}  (${c.how})${c.ftest || c.stest ? '  test' : ''}${lineChanged(c.repo, c.path, c.line) ? '  (changed in this diff)' : ''}`)
      if (x.callers.length > 10) out.push(`    … ${x.callers.length - 10} more`)
      if (outside.length) risk.push(`route ${x.title} ${x.why} is still named outside the lines this diff changed (${outside.length} place(s))`)
    }
    if (lost.length > 20) out.push(`  … ${lost.length - 20} more`)
  }

  // ── tests ──
  // A function nested in another is tested through it: the outermost callable around a changed one
  // stands for it (its tests, its callers).
  const outer = (n) => { let x = n; for (let p = x.parent_id && g.node(x.parent_id); p && CALLABLE.has(p.kind); p = p.parent_id && g.node(p.parent_id)) x = p; return x }
  const testsOf = new Map()
  const reachTests = new Map()
  const addTest = (n, d, how) => { const k = `${n.repo}|${n.path}`; if (!reachTests.has(k) || reachTests.get(k).d > d) reachTests.set(k, { n, d, how }) }
  for (const c of live) {
    if (!c.node || c.node.is_test) continue
    const rep = outer(c.node)
    // a test calling the route it handles, by URL or by navigation, is a test on its path (ROUTES_TO)
    const ts = [...g.walk([rep.id], TEST_EDGES, 'in', TEST_DEPTH).entries()].filter(([id, i]) => i.depth > 0 && g.node(id).is_test).map(([id, i]) => [g.node(id), i])
    // a test calling it on a receiver the graph could not type is a test of it too
    const loose = c.op === '+' ? [] : unresolved(g, [rep]).filter((x) => x.src?.is_test)
    testsOf.set(c, ts.length + loose.length)
    for (const [n, i] of ts) addTest(n, i.depth, 'linked')
    for (const x of loose) addTest(x.src, 1, 'unlinked call')
  }
  const changedTests = files.filter((f) => f.path && fileRow.get(f.repo, f.path)?.is_test)
  // closest first; at one distance, a test file named after a changed definition or file first
  const names = new Set(live.flatMap((c) => [c.node?.name, c.was?.name, stem(c.file.path), stem(c.file.oldPath)]).filter((x) => x && x.length > 2).map((x) => x.toLowerCase()))
  const named = (p) => [...names].some((x) => p.toLowerCase().includes(x))
  const testList = [...reachTests.values()].sort((a, b) => a.d - b.d || named(b.n.path) - named(a.n.path) || (a.n.path < b.n.path ? -1 : 1))
  out.push(`Tests to run: ${reachTests.size} test file(s) reach the changed definitions${changedTests.length ? `; ${changedTests.length} test file(s) changed in this diff` : ''}`)
  for (const { n, d, how } of testList.slice(0, 25)) out.push(`  ${g.loc({ ...n, kind: 'file' })}  (distance ${d}${how === 'unlinked call' ? ', an unlinked call' : ''})${inDiff.has(`${n.repo}|${n.path}`) ? '  (in this diff)' : ''}`)
  if (testList.length > 25) out.push(`  … ${testList.length - 25} more`)
  const reps = new Map()
  for (const c of live) {
    if (!c.node || c.node.is_test || !CALLABLE.has(c.node.kind) || testsOf.get(c)) continue
    const rep = outer(c.node)
    if (!reps.has(rep.id)) reps.set(rep.id, { ...c, node: rep, via: rep.id !== c.node.id ? c.node : null })
  }
  const untested = [...reps.values()]
  if (untested.length) {
    out.push(`Changed code no test reaches (${untested.length}; the graph misses tests that reach code dynamically: check before writing one):`)
    for (const c of untested.slice(0, 20)) out.push(`  ${c.via ? '~' : c.op} ${g.row(c.node)}${c.via ? `  (through ${c.via.qualname})` : ''}`)
    if (untested.length > 20) out.push(`  … ${untested.length - 20} more`)
    // with callers: a CALLS edge into it (or a REFERENCES edge: passed as a value; a ROUTES_TO edge: a
    // call site naming the route it handles), or into a declaration it implements (dispatch)
    const callersIn = g.db.prepare("SELECT 1 FROM edges WHERE dst = ? AND kind IN ('CALLS','REFERENCES','ROUTES_TO') LIMIT 1")
    const used = untested.filter((c) => (c.op !== '+' || c.via) && [c.node, ...(dispatchUp(g, c.node))].some((n) => callersIn.get(n.id)))
    if (used.length) risk.push(`${used.length} changed definition(s) with callers and no test reaching them`)
  }

  // ── co-change gaps ──
  const churn = g.db.prepare('SELECT n FROM churn WHERE repo = ? AND path = ?')
  const gaps = new Map()
  for (const f of files) {
    if (!f.path) continue
    const hist = f.oldPath || f.path // a renamed file's history is under its old path
    const total = churn.get(f.repo, hist)?.n || churn.get(f.repo, f.path)?.n || 0
    if (!total) continue
    for (const c of g.q('SELECT b, n FROM cochange WHERE repo = ? AND a IN (?, ?) ORDER BY n DESC', f.repo, hist, f.path)) {
      const k = `${f.repo}|${c.b}`
      if (inDiff.has(k) || c.n < GAP_MIN || c.n / total < GAP_RATIO) continue
      const ratio = c.n / total
      if (!gaps.has(k) || gaps.get(k).ratio < ratio) gaps.set(k, { repo: f.repo, path: c.b, from: f.path, n: c.n, total, ratio })
    }
  }
  if (gaps.size) {
    const list = [...gaps.values()].sort((a, b) => b.ratio - a.ratio || b.n - a.n)
    out.push(`Usually changes with these files, not in this diff (git history: shared commits / commits of the changed file):`)
    for (const x of list.slice(0, 12)) out.push(`  ${g.loc({ repo: x.repo, path: x.path, kind: 'file' })}  with ${x.from}: ${x.n}/${x.total}`)
    const strong = list.filter((x) => x.ratio >= 0.5)
    if (strong.length) risk.push(`${strong.length} file(s) that change with these at least half the time are not in this diff`)
  }

  out.push(`Risk: ${risk.length ? (risk.some((x) => x.includes('still named') || x.includes('still imported')) ? 'high' : 'medium') : 'low'}${risk.length ? `: ${risk.join('; ')}` : ' (no contract change still named outside the diff, changed code with callers is tested, no usual partner missing)'}`)
  return out.join('\n')
}
