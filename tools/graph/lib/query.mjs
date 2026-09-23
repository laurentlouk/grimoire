// grimoire graph · queries. Every answer is plain text an agent can act on: one line per symbol,
// with its kind, a project-relative `path:line` to open, and for edges how the name was resolved.
// The graph is a map for research (what relates to what, how far a change reaches). It is never
// the source of truth for what code does: that is read in the code, at the path:line given here.
import { langOf } from './langs.mjs'

export const FOOTER = 'Leads, not facts: edges are resolved by name from syntax. Open path:line before relying on any of it.'
const CLASSY = "'class','struct','interface','trait','enum','protocol','module','object','type','namespace'"
const MAX_TARGETS = 5

export class Graph {
  constructor(db) {
    this.db = db
    this.roots = new Map(db.prepare('SELECT name, root FROM repos').all().map((r) => [r.name, r.root]))
    this.q = (sql, ...a) => db.prepare(sql).all(...a)
    this.one = (sql, ...a) => db.prepare(sql).get(...a)
  }

  // ── presentation ──
  loc(n) { const root = this.roots.get(n.repo); const p = root && root !== '.' ? `${root}/${n.path}` : n.path; return n.kind === 'file' ? p : `${p}:${n.line}` }
  row(n, extra = '') { return `${n.kind === 'file' ? n.path : n.qualname}  ${n.kind}${n.is_test ? ' test' : ''}  ${this.loc(n)}${extra ? '  ' + extra : ''}` }
  node(id) { return this.one('SELECT n.*, f.repo, f.path, f.lang FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.id = ?', id) }

  // ── finding what the caller means ──
  // `#12`, `path/to/file.ts`, `path/to/file.ts:42`, `Type.method` / `Type::method`, or a bare name.
  find(spec, { repo = null, kindFilter = null } = {}) {
    spec = String(spec || '').trim()
    if (!spec) return []
    const R = repo ? ' AND f.repo = ?' : ''
    const ra = repo ? [repo] : []
    const base = 'SELECT n.*, f.repo, f.path, f.lang FROM nodes n JOIN files f ON f.id = n.file_id WHERE '
    if (/^#\d+$/.test(spec)) return [this.node(Number(spec.slice(1)))].filter(Boolean)
    const pl = /^(.+?\.[A-Za-z0-9]+)(?::(\d+))?$/.exec(spec)
    if (pl && langOf(pl[1])) {
      const file = this.fileByPath(pl[1], repo)
      if (file) {
        if (!pl[2]) return [this.node(file.node_id)]
        const inner = this.one(`${base} n.file_id = ? AND n.kind != 'file' AND n.line <= ? AND n.end_line >= ? ORDER BY (n.end_line - n.line) ASC LIMIT 1`, file.id, Number(pl[2]), Number(pl[2]))
        return [inner || this.node(file.node_id)]
      }
    }
    const kf = kindFilter ? ` AND n.kind IN (${kindFilter})` : " AND n.kind != 'file'"
    const qual = spec.replace(/::|#|->/g, '.')
    if (qual.includes('.')) {
      const hits = this.q(`${base} (n.qualname = ? OR n.qualname LIKE ?)${kf}${R} ORDER BY n.is_test, f.path LIMIT 20`, qual, `%.${qual}`, ...ra)
      if (hits.length) return hits
    }
    return this.q(`${base} n.name = ?${kf}${R} ORDER BY n.is_test, f.path LIMIT 20`, qual.split('.').pop(), ...ra)
  }
  fileByPath(p, repo) {
    p = p.replace(/^\.\//, '')
    for (const [name, root] of this.roots) {
      if (repo && name !== repo) continue
      const rel = root !== '.' && p.startsWith(root + '/') ? p.slice(root.length + 1) : p
      const f = this.one('SELECT * FROM files WHERE repo = ? AND path = ?', name, rel)
      if (f) return f
    }
    return this.one(`SELECT * FROM files WHERE path LIKE ?${repo ? ' AND repo = ?' : ''} ORDER BY length(path) LIMIT 1`, `%${p}`, ...(repo ? [repo] : []))
  }
  // Resolve a spec to target nodes, or explain why not (none / too many).
  targets(spec, opts) {
    const hits = this.find(spec, opts)
    if (!hits.length) return { error: `No symbol or file matches "${spec}". Try graph_search with a fragment of the name.` }
    if (hits.length > MAX_TARGETS) return { error: `"${spec}" matches ${hits.length} symbols; narrow it with Type.name, path:line or #id:\n` + hits.map((h) => `  #${h.id}  ${this.row(h)}`).join('\n') }
    const note = hits.length > 1 ? `"${spec}" matches ${hits.length} symbols; showing all of them (narrow with Type.name, path:line or #id).` : ''
    return { hits, note }
  }

  // ── traversal ──
  // Breadth-first over edges of `kinds`, `dir` = 'in' (who points here) or 'out'. Returns
  // Map(id → { depth, via: parent id, conf, line }).
  walk(startIds, kinds, dir, depth, strict = false) {
    const K = kinds.map((k) => `'${k}'`).join(',') + ')' + (strict ? " AND confidence != 'ambiguous'" : '')
    const sql = dir === 'in' ? `SELECT src AS id, confidence, line FROM edges WHERE dst = ? AND kind IN (${K}` : `SELECT dst AS id, confidence, line FROM edges WHERE src = ? AND kind IN (${K}`
    const st = this.db.prepare(sql)
    const seen = new Map(startIds.map((id) => [id, { depth: 0, via: null }]))
    let frontier = startIds
    for (let d = 1; d <= depth && frontier.length; d++) {
      const next = []
      for (const id of frontier) for (const e of st.all(id)) if (!seen.has(e.id)) { seen.set(e.id, { depth: d, via: id, conf: e.confidence, line: e.line }); next.push(e.id) }
      frontier = next
    }
    return seen
  }
  tree(start, kinds, dir, depth, strict = false, limit = 80) {
    const K = kinds.map((k) => `'${k}'`).join(',') + ')' + (strict ? " AND confidence != 'ambiguous'" : '')
    const order = "ORDER BY confidence = 'ambiguous', line"
    const sql = dir === 'in' ? `SELECT src AS id, confidence, line, kind FROM edges WHERE dst = ? AND kind IN (${K} ${order}` : `SELECT dst AS id, confidence, line, kind FROM edges WHERE src = ? AND kind IN (${K} ${order}`
    const st = this.db.prepare(sql)
    const out = [], seen = new Set([start.id])
    let count = 0
    const rec = (id, d) => {
      if (d > depth) return
      for (const e of st.all(id)) {
        if (count >= limit) return
        const n = this.node(e.id)
        const again = seen.has(e.id)
        out.push(`${'  '.repeat(d)}${this.row(n, `[${e.confidence}]${again ? ' ↺' : ''}`)}`)
        count++
        if (!again) { seen.add(e.id); rec(e.id, d + 1) }
      }
    }
    rec(start.id, 1)
    return { lines: out, truncated: count >= limit }
  }

  // ── commands ──
  status(fresh) {
    const repos = this.q('SELECT * FROM repos ORDER BY name')
    if (!repos.length) return 'The graph is empty: run graph_index.'
    const lines = []
    for (const r of repos) {
      const langs = this.q('SELECT lang, count(*) c FROM files WHERE repo = ? GROUP BY lang ORDER BY c DESC', r.name).map((l) => `${l.lang} ${l.c}`).join(', ')
      const counts = this.one("SELECT count(*) c FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.repo = ? AND n.kind != 'file'", r.name).c
      const edges = this.q('SELECT e.kind, count(*) c FROM edges e JOIN nodes n ON n.id = e.src JOIN files f ON f.id = n.file_id WHERE f.repo = ? GROUP BY e.kind', r.name).map((e) => `${e.kind} ${e.c}`).join(', ')
      const calls = JSON.parse(this.one('SELECT value FROM meta WHERE key = ?', `calls:${r.name}`)?.value || '{"calls":0,"resolved":0}')
      const conf = this.q("SELECT e.confidence, count(*) c FROM edges e JOIN nodes n ON n.id = e.src JOIN files f ON f.id = n.file_id WHERE f.repo = ? AND e.kind = 'CALLS' GROUP BY e.confidence ORDER BY c DESC", r.name).map((e) => `${e.confidence} ${e.c}`).join(', ')
      lines.push(`${r.name}  (${r.root})  indexed ${r.indexed_at}${r.head ? ` at ${r.head.slice(0, 10)}` : ''}${fresh && fresh[r.name] ? `  ${fresh[r.name]}` : ''}`)
      lines.push(`  files: ${langs}`)
      lines.push(`  symbols: ${counts}   edges: ${edges || 'none'}`)
      lines.push(`  call sites resolved: ${calls.resolved}/${calls.calls}${conf ? ` (${conf})` : ''}`)
    }
    return lines.join('\n')
  }

  search({ query, kind, repo, limit = 30 }) {
    const qv = String(query || '').trim()
    if (!qv) return 'Give a name or a fragment of one.'
    const like = qv.includes('*') ? qv.replace(/\*/g, '%') : `%${qv}%`
    const args = [like, like]
    let where = "(n.name LIKE ? OR n.qualname LIKE ?) AND n.kind != 'file'"
    if (/[/\\]|\.[a-z]{1,5}$/.test(qv)) { where = "(f.path LIKE ?) AND n.kind = 'file'"; args.length = 0; args.push(like) }
    if (kind) { where += ' AND n.kind = ?'; args.push(kind) }
    if (repo) { where += ' AND f.repo = ?'; args.push(repo) }
    const exact = qv.replace(/\*/g, '')
    const rows = this.q(`SELECT n.*, f.repo, f.path FROM nodes n JOIN files f ON f.id = n.file_id WHERE ${where}
      ORDER BY (n.name = ?) DESC, (n.name LIKE ?) DESC, n.is_test, length(n.qualname), f.path LIMIT ?`, ...args, exact, `${exact}%`, Math.min(Number(limit) || 30, 200))
    if (!rows.length) return `Nothing named like "${qv}". The graph only knows definitions in indexed languages; fall back to grep for strings, config and docs.`
    return rows.map((n) => `#${n.id}  ${this.row(n)}${n.signature ? `\n      ${n.signature}` : ''}`).join('\n')
  }

  symbol({ symbol, repo }) {
    const t = this.targets(symbol, { repo })
    if (t.error) return t.error
    return [t.note, ...t.hits.map((n) => {
      const lines = [`#${n.id}  ${this.row(n)}`]
      if (n.signature) lines.push(`  ${n.signature}`)
      if (n.parent_id) { const p = this.node(n.parent_id); lines.push(`  member of ${this.row(p)}`) }
      const members = this.q('SELECT n.*, f.repo, f.path FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.parent_id = ? ORDER BY n.line LIMIT 40', n.id)
      if (members.length) lines.push(`  members: ${members.map((m) => `${m.name}:${m.line}`).join(', ')}`)
      const count = (sql) => this.one(sql, n.id).c
      const cin = count("SELECT count(*) c FROM edges WHERE dst = ? AND kind = 'CALLS'")
      const cout = count("SELECT count(*) c FROM edges WHERE src = ? AND kind = 'CALLS'")
      const sup = this.q("SELECT e.kind, d.qualname FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.src = ? AND e.kind IN ('EXTENDS','IMPLEMENTS')", n.id)
      const sub = count("SELECT count(*) c FROM edges WHERE dst = ? AND kind IN ('EXTENDS','IMPLEMENTS')")
      const tests = [...this.walk([n.id], ['CALLS'], 'in', 4).keys()].map((id) => this.node(id)).filter((x) => x.is_test && x.id !== n.id)
      lines.push(`  callers ${cin} · callees ${cout}${sup.length ? ` · ${sup.map((s) => `${s.kind.toLowerCase()} ${s.qualname}`).join(', ')}` : ''}${sub ? ` · subtypes ${sub}` : ''} · tests reaching it ${tests.length}`)
      return lines.join('\n')
    })].filter(Boolean).join('\n\n')
  }

  calls({ symbol, repo, depth = 1, strict = false }, dir) {
    const t = this.targets(symbol, { repo })
    if (t.error) return t.error
    const d = Math.max(1, Math.min(Number(depth) || 1, 5))
    const out = [t.note].filter(Boolean)
    for (const n of t.hits) {
      const { lines, truncated } = this.tree(n, ['CALLS'], dir, d, !!strict)
      out.push(`${dir === 'in' ? 'Callers of' : 'Called by'} ${this.row(n)} — depth ${d}`)
      out.push(lines.length ? lines.join('\n') : `  none found${dir === 'in' ? ' (dynamic dispatch, callbacks, reflection and cross-repo calls are invisible to the graph: grep the name before concluding it is unused)' : ''}`)
      if (truncated) out.push('  … truncated; lower the depth or query a narrower symbol')
    }
    return out.join('\n')
  }

  hierarchy({ symbol, repo, depth = 3 }) {
    const t = this.targets(symbol, { repo, kindFilter: CLASSY })
    if (t.error) return t.error
    const out = [t.note].filter(Boolean)
    for (const n of t.hits) {
      const up = this.tree(n, ['EXTENDS', 'IMPLEMENTS'], 'out', depth)
      const down = this.tree(n, ['EXTENDS', 'IMPLEMENTS'], 'in', depth)
      out.push(this.row(n), '  supertypes:', up.lines.length ? up.lines.map((l) => '  ' + l).join('\n') : '    none in the index', '  subtypes / implementors:', down.lines.length ? down.lines.map((l) => '  ' + l).join('\n') : '    none in the index')
    }
    return out.join('\n')
  }

  // Blast radius: everything that reaches the target through calls, inheritance and (for files)
  // imports, grouped by file, with the tests on those paths and the files that co-change with it.
  impact({ target, repo, depth = 3, strict = false }) {
    const t = this.targets(target, { repo })
    if (t.error) return t.error
    const d = Math.max(1, Math.min(Number(depth) || 3, 6))
    let start = t.hits.map((h) => h.id)
    const files = new Set(t.hits.map((h) => h.file_id))
    for (const h of t.hits) {
      if (h.kind === 'file') start = start.concat(this.q("SELECT id FROM nodes WHERE file_id = ? AND kind != 'file'", h.file_id).map((r) => r.id))
      else start = start.concat(this.q('SELECT id FROM nodes WHERE parent_id = ?', h.id).map((r) => r.id)) // a type's members
    }
    const reached = this.walk(start, ['CALLS', 'EXTENDS', 'IMPLEMENTS', 'IMPORTS'], 'in', d, !!strict)
    const byFile = new Map()
    const tests = []
    for (const [id, info] of reached) {
      if (info.depth === 0) continue
      const n = this.node(id)
      if (n.is_test) { tests.push([n, info]); continue }
      const key = `${n.repo}|${n.path}`
      if (!byFile.has(key)) byFile.set(key, [])
      byFile.get(key).push([n, info])
    }
    const out = [t.note, `Impact of ${t.hits.map((h) => this.row(h)).join(' + ')} — depth ${d}`].filter(Boolean)
    if (!byFile.size && !tests.length) out.push('  nothing in the index reaches it (check dynamic dispatch, config wiring, other repos, and grep the name)')
    const groups = [...byFile.values()].sort((a, b) => Math.min(...a.map(([, i]) => i.depth)) - Math.min(...b.map(([, i]) => i.depth)))
    for (const g of groups.slice(0, 60)) {
      const f = g[0][0]
      const syms = g.filter(([n]) => n.kind !== 'file').sort((a, b) => a[1].depth - b[1].depth)
      out.push(`  ${this.loc({ ...f, kind: 'file' })}  (distance ${Math.min(...g.map(([, i]) => i.depth))})`)
      for (const [n, i] of syms.slice(0, 8)) out.push(`    ${n.qualname}:${n.line}  d${i.depth} [${i.conf}]`)
      if (syms.length > 8) out.push(`    … ${syms.length - 8} more`)
    }
    if (groups.length > 60) out.push(`  … ${groups.length - 60} more files`)
    out.push(tests.length ? `Tests on these paths (${tests.length}):` : 'Tests on these paths: none found by the graph (search the test tree by name before concluding it is untested)')
    for (const [n, i] of tests.sort((a, b) => a[1].depth - b[1].depth).slice(0, 25)) out.push(`  ${this.row(n, `d${i.depth}`)}`)
    const cc = []
    for (const fid of files) {
      const f = this.one('SELECT repo, path FROM files WHERE id = ?', fid)
      for (const c of this.q('SELECT b, n FROM cochange WHERE repo = ? AND a = ? ORDER BY n DESC LIMIT 8', f.repo, f.path)) cc.push(`  ${this.loc({ repo: f.repo, path: c.b, kind: 'file' })}  ${c.n} shared commits`)
    }
    if (cc.length) out.push('Changes together with (git history):', ...cc)
    return out.join('\n')
  }

  file({ path: p, repo }) {
    const f = this.fileByPath(String(p || ''), repo)
    if (!f) return `No indexed file matches "${p}".`
    const fn = this.node(f.node_id)
    const out = [`${this.loc(fn)}  ${f.lang}${f.is_test ? ', test' : ''}`]
    const syms = this.q("SELECT n.*, f.repo, f.path FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.file_id = ? AND n.kind != 'file' ORDER BY n.line", f.id)
    const depth = (n) => { let d = 0; for (let c = n; c.parent_id; c = syms.find((s) => s.id === c.parent_id) || {}) d++; return d }
    out.push('Outline:', ...(syms.length ? syms.slice(0, 120).map((n) => `${'  '.repeat(depth(n) + 1)}${n.name}  ${n.kind}${n.is_test ? ' test' : ''}  :${n.line}`) : ['  (no symbols extracted)']))
    const imps = this.q("SELECT d.id FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.src = ? AND e.kind = 'IMPORTS'", f.node_id).map((r) => this.node(r.id))
    const ext = this.q('SELECT source FROM imports WHERE file_id = ? AND resolved = 0', f.id).map((r) => r.source)
    out.push('Imports:', ...imps.map((n) => `  ${this.loc(n)}`), ...(ext.length ? [`  external: ${[...new Set(ext)].join(', ')}`] : []), ...(imps.length || ext.length ? [] : ['  none']))
    const by = this.q("SELECT s.id FROM edges e JOIN nodes s ON s.id = e.src WHERE e.dst = ? AND e.kind = 'IMPORTS'", f.node_id).map((r) => this.node(r.id))
    out.push('Imported by:', ...(by.length ? by.slice(0, 40).map((n) => `  ${this.loc(n)}`) : ['  none in the index']))
    const cc = this.q('SELECT b, n FROM cochange WHERE repo = ? AND a = ? ORDER BY n DESC LIMIT 8', f.repo, f.path)
    if (cc.length) out.push('Changes together with:', ...cc.map((c) => `  ${this.loc({ repo: f.repo, path: c.b, kind: 'file' })}  ${c.n} commits`))
    return out.join('\n')
  }

  path({ from, to, repo, depth = 6, strict = false }) {
    const a = this.targets(from, { repo }), b = this.targets(to, { repo })
    if (a.error) return a.error
    if (b.error) return b.error
    const goal = new Set(b.hits.map((h) => h.id))
    const reached = this.walk(a.hits.map((h) => h.id), ['CALLS'], 'out', Math.min(Number(depth) || 6, 10), !!strict)
    const hit = [...goal].find((g) => reached.has(g))
    if (!hit) return `No call path from ${from} to ${to} within depth ${depth} in the index (it may go through dynamic dispatch, callbacks or another repository).`
    const chain = []
    for (let id = hit; id !== null; id = reached.get(id).via) chain.unshift([this.node(id), reached.get(id)])
    return [`Call path ${from} → ${to} (${chain.length - 1} hops):`, ...chain.map(([n, i], k) => `  ${k}. ${this.row(n, i.conf ? `[${i.conf}]` : '')}`)].join('\n')
  }
}

// A read-only SELECT against the schema (see store.mjs), for questions the commands do not cover.
export function sql(db, statement, limit = 200) {
  const s = String(statement || '').trim().replace(/;+\s*$/, '')
  if (!/^(select|with)\b/i.test(s) || /;/.test(s)) return 'Only a single SELECT (or WITH … SELECT) statement is allowed.'
  const rows = db.prepare(s).all()
  if (!rows.length) return '(no rows)'
  const cols = Object.keys(rows[0])
  return [cols.join('\t'), ...rows.slice(0, limit).map((r) => cols.map((c) => r[c]).join('\t')), ...(rows.length > limit ? [`… ${rows.length - limit} more rows`] : [])].join('\n')
}
