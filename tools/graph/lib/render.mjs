// grimoire graph · the browsable page. Reads the index read-only and writes ONE self-contained HTML
// file (no network, no CDN: data and code are inlined, a CSP forbids everything else):
//   overview   repositories, languages, file / symbol / edge counts, when each repo was indexed
//   map        the file-level dependency map (imports + calls between files), laid out ONCE here,
//              deterministically (layout.mjs): files cluster by directory, the biggest carry their
//              name, the rest show it on hover; colored by repository; click a file to open it
//   symbols    search every definition; a symbol shows where it is, its callers, its callees, and
//              what it extends / implements or is extended by
//   hotspots   most-called symbols, most-imported files, widest fan-out, strongest co-change
// Like every graph answer, the page is a map: read the code at the path:line it points to.
import { openStore } from './store.mjs'
import { layoutMap } from './layout.mjs'

const KINDS = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
const MAP_MAX_FILES = 1500 // the map keeps the most connected files; the other tabs keep everything

export async function renderGraph(project) {
  const db = await openStore(project.dbPath, { readOnly: true })
  try {
    const repos = db.prepare('SELECT name, root, head, indexed_at FROM repos ORDER BY name').all()
    const files = db.prepare('SELECT id, repo, path, lang, is_test, node_id FROM files ORDER BY repo, path').all()
    const nodes = db.prepare("SELECT id, file_id, kind, COALESCE(qualname, name) AS name, line, is_test FROM nodes WHERE kind != 'file'").all()
    const edges = db.prepare('SELECT src, dst, kind, confidence FROM edges').all()
    const cochange = db.prepare('SELECT repo, a, b, n FROM cochange ORDER BY n DESC LIMIT 200').all()
    const confs = [...new Set(edges.map((e) => e.confidence || ''))]
    const kinds = [...new Set(nodes.map((n) => n.kind))]
    const data = {
      map: mapData(files, nodes, edges),
      generatedAt: new Date().toISOString(),
      mapMax: MAP_MAX_FILES,
      repos,
      files: files.map((f) => [f.id, f.repo, f.path, f.lang, f.is_test ? 1 : 0, f.node_id]),
      kinds,
      nodes: nodes.map((n) => [n.id, n.file_id, kinds.indexOf(n.kind), n.name, n.line, n.is_test ? 1 : 0]),
      edgeKinds: KINDS,
      confs,
      edges: edges.map((e) => [e.src, e.dst, KINDS.indexOf(e.kind), confs.indexOf(e.confidence || '')]),
      cochange: cochange.map((c) => [c.repo, c.a, c.b, c.n]),
    }
    return html(data)
  } finally { db.close() }
}

// The file-level graph for the map: most connected files, weighted links, positions, groups.
function mapData(files, nodes, edges) {
  const fileOfNode = new Map()
  for (const f of files) fileOfNode.set(f.node_id, f.id)
  for (const n of nodes) fileOfNode.set(n.id, n.file_id)
  const w = new Map(), deg = new Map()
  for (const e of edges) {
    const a = fileOfNode.get(e.src), b = fileOfNode.get(e.dst)
    if (a === undefined || b === undefined || a === b) continue
    const k = a < b ? `${a},${b}` : `${b},${a}`
    if (!w.has(k)) { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1) }
    w.set(k, (w.get(k) || 0) + 1)
  }
  // The cap is shared out per repository, in proportion to its size, so filtering to a small repo
  // still shows its own best-connected files; slots a repo cannot use go to the rest.
  const all = files.map((f) => ({ id: f.id, repo: f.repo, path: f.path, deg: deg.get(f.id) || 0 }))
    .sort((a, b) => b.deg - a.deg || (a.path < b.path ? -1 : 1))
  const perRepo = new Map()
  for (const f of all) (perRepo.get(f.repo) || perRepo.set(f.repo, []).get(f.repo)).push(f)
  const totals = Object.fromEntries([...perRepo].map(([r, fs]) => [r, fs.length]))
  let keep = all
  if (all.length > MAP_MAX_FILES) {
    const picked = new Set()
    for (const [, fs] of perRepo) for (const f of fs.slice(0, Math.floor((MAP_MAX_FILES * fs.length) / all.length))) picked.add(f)
    for (const f of all) { if (picked.size >= MAP_MAX_FILES) break; picked.add(f) }
    keep = all.filter((f) => picked.has(f))
  }
  const at = new Map(keep.map((f, i) => [f.id, i]))
  const links = []
  for (const [k, v] of w) { const [a, b] = k.split(',').map(Number); if (at.has(a) && at.has(b)) links.push([at.get(a), at.get(b), v]) }
  links.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const { pos, groups } = layoutMap(keep, links)
  return { files: keep.map((f) => f.id), deg: keep.map((f) => f.deg), pos, links, groups, total: files.length, totals }
}

function html(data) {
  // Every "<" becomes \\u003c, so no data string can close the <script> element.
  const blob = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  const js = `(${client.toString()})()`.replace(/<\//g, '<\\/')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'">
<title>grimoire code graph</title><style>${CSS}</style></head>
<body><noscript>This page needs JavaScript to render the code graph.</noscript>
<script type="application/json" id="graph-data">${blob}</script>
<script>${js}</script>
</body></html>
`
}

const CSS = `
:root{--bg:#fbfaf8;--panel:#fff;--ink:#1d1d1f;--muted:#6b6b72;--line:#e6e4df;--accent:#6d4aff;--hover:#f2f0ec;--edge:rgba(60,60,70,.16)}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1c1c21;--ink:#ececf1;--muted:#9a9aa6;--line:#2c2c33;--accent:#a08bff;--hover:#24242b;--edge:rgba(220,220,235,.13)}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:2}
header h1{font-size:16px;margin:0 8px 0 0}nav{display:flex;gap:4px}nav button,select,input{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
nav button{cursor:pointer}nav button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
input[type=search]{min-width:240px;flex:1;max-width:420px}main{padding:20px;max-width:1400px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.card b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.card span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:20px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px}td.n{text-align:right;font-variant-numeric:tabular-nums}
tr.click{cursor:pointer}tr.click:hover{background:var(--hover)}code,.mono{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}
h2{font-size:15px;margin:22px 0 10px}.muted{color:var(--muted)}.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
@media (max-width:900px){.grid2{grid-template-columns:1fr}}
#map{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;height:72vh;overflow:hidden}
#map canvas{width:100%;height:100%;display:block;cursor:grab}#tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);padding:4px 8px;border-radius:6px;font-size:12px;display:none;white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;border:1px solid var(--line);font-size:11px;color:var(--muted);margin-left:6px}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:20px}.detail h3{margin:0 0 6px;font-size:15px}
ul.links{list-style:none;padding:0;margin:6px 0 0}ul.links li{padding:3px 0}a.jump{color:var(--accent);cursor:pointer;text-decoration:none}a.jump:hover{text-decoration:underline}
.note{color:var(--muted);font-size:12px;margin:8px 0}
`

// Runs in the browser. Self-contained: no imports, reads the inlined JSON.
function client() {
  const D = JSON.parse(document.getElementById('graph-data').textContent)
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) if (v !== undefined && v !== null && v !== false) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v)
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c))
    return el
  }
  const PALETTE = ['#6d4aff', '#e0527a', '#1f9d8a', '#e38b22', '#3b82f6', '#8b5cf6', '#16a34a', '#d946ef', '#0ea5e9', '#f43f5e']
  const repoColor = new Map(D.repos.map((r, i) => [r.name, PALETTE[i % PALETTE.length]]))

  // ── indexes ──
  const files = new Map(), fileByNode = new Map(), nodes = new Map()
  for (const [id, repo, path, lang, test, nodeId] of D.files) {
    const root = (D.repos.find((r) => r.name === repo) || {}).root
    const f = { id, repo, path, lang, test: !!test, nodeId, shown: root && root !== '.' ? `${root}/${path}` : path, defs: [], out: new Map(), in: new Map() }
    files.set(id, f)
    fileByNode.set(nodeId, f)
  }
  for (const [id, fileId, k, name, line, test] of D.nodes) {
    const f = files.get(fileId)
    const n = { id, file: f, kind: D.kinds[k], name, line, test: !!test, callers: [], callees: [], supers: [], subs: [] }
    nodes.set(id, n)
    if (f) f.defs.push(n)
  }
  const fileOf = (id) => fileByNode.get(id) || (nodes.get(id) || {}).file
  const edgeCount = {}
  for (const [src, dst, k, c] of D.edges) {
    const kind = D.edgeKinds[k]
    edgeCount[kind] = (edgeCount[kind] || 0) + 1
    const a = nodes.get(src), b = nodes.get(dst)
    if (kind === 'CALLS' && a && b) { a.callees.push([b, D.confs[c]]); b.callers.push([a, D.confs[c]]) }
    if ((kind === 'EXTENDS' || kind === 'IMPLEMENTS') && a && b) { a.supers.push([b, kind]); b.subs.push([a, kind]) }
    const fa = fileOf(src), fb = fileOf(dst)
    if (fa && fb && fa !== fb) {
      fa.out.set(fb, (fa.out.get(fb) || 0) + 1)
      fb.in.set(fa, (fb.in.get(fa) || 0) + 1)
    }
  }
  const loc = (n) => `${n.file ? n.file.shown : '?'}:${n.line}`
  const perRepo = new Map(D.repos.map((r) => [r.name, { files: 0, symbols: 0 }]))
  for (const f of files.values()) if (perRepo.has(f.repo)) perRepo.get(f.repo).files++
  for (const n of nodes.values()) if (n.file && perRepo.has(n.file.repo)) perRepo.get(n.file.repo).symbols++

  // ── state ──
  const st = { tab: 'overview', repo: '', q: '', sel: null }
  const inRepo = (f) => !st.repo || (f && f.repo === st.repo)

  // ── views ──
  function overview() {
    const fs = [...files.values()].filter(inRepo)
    const ns = [...nodes.values()].filter((n) => inRepo(n.file))
    const langs = {}
    for (const f of fs) langs[f.lang] = (langs[f.lang] || 0) + 1
    const card = (v, l) => h('div', { class: 'card' }, h('b', null, v.toLocaleString()), h('span', null, l))
    return h('section', null,
      h('div', { class: 'cards' }, card(fs.length, 'files'), card(fs.filter((f) => f.test).length, 'test files'), card(ns.length, 'symbols'),
        ...D.edgeKinds.map((k) => card(edgeCount[k] || 0, `${k} edges (all repos)`))),
      h('h2', null, 'Repositories'),
      h('table', null, h('tr', null, h('th', null, 'repo'), h('th', null, 'root'), h('th', null, 'files'), h('th', null, 'symbols'), h('th', null, 'HEAD'), h('th', null, 'indexed')),
        D.repos.filter((r) => !st.repo || r.name === st.repo).map((r) => h('tr', null,
          h('td', null, h('i', { style: `display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:${repoColor.get(r.name)}` }), r.name),
          h('td', { class: 'mono' }, r.root), h('td', { class: 'n' }, perRepo.get(r.name).files),
          h('td', { class: 'n' }, perRepo.get(r.name).symbols),
          h('td', { class: 'mono' }, (r.head || '').slice(0, 10)), h('td', null, r.indexed_at || '')))),
      h('h2', null, 'Languages'),
      h('table', null, h('tr', null, h('th', null, 'language'), h('th', null, 'files')),
        Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, n]) => h('tr', null, h('td', null, l), h('td', { class: 'n' }, n)))))
  }

  function fileDetail(f) {
    const byDeg = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
    return h('div', { class: 'detail' },
      h('h3', { class: 'mono' }, f.shown), h('div', { class: 'muted' }, `${f.repo} · ${f.lang}${f.test ? ' · test' : ''} · ${f.defs.length} definitions`),
      h('div', { class: 'grid2' },
        h('div', null, h('h2', null, `Depends on (${f.out.size})`), h('ul', { class: 'links' }, byDeg(f.out).slice(0, 60).map(([g, n]) => h('li', null, jumpFile(g), h('span', { class: 'pill' }, n))))),
        h('div', null, h('h2', null, `Used by (${f.in.size})`), h('ul', { class: 'links' }, byDeg(f.in).slice(0, 60).map(([g, n]) => h('li', null, jumpFile(g), h('span', { class: 'pill' }, n)))))),
      h('h2', null, 'Definitions'),
      h('ul', { class: 'links' }, f.defs.sort((a, b) => a.line - b.line).map((n) => h('li', null, jumpSym(n), h('span', { class: 'pill' }, n.kind)))))
  }
  function symDetail(n) {
    const list = (title, xs, label) => h('div', null, h('h2', null, `${title} (${xs.length})`),
      xs.length ? h('ul', { class: 'links' }, xs.slice(0, 80).map(([m, tag]) => h('li', null, jumpSym(m), h('span', { class: 'pill' }, label ? tag : tag || '')))) : h('div', { class: 'muted' }, 'none found (a missing edge proves nothing: check with grep)'))
    return h('div', { class: 'detail' },
      h('h3', null, n.name, h('span', { class: 'pill' }, n.kind), n.test ? h('span', { class: 'pill' }, 'test') : null),
      h('div', null, 'at ', h('code', null, loc(n)), ' · in ', n.file ? jumpFile(n.file) : '?'),
      h('div', { class: 'grid2' }, list('Callers', n.callers), list('Callees', n.callees)),
      h('div', { class: 'grid2' }, list('Extends / implements', n.supers, true), list('Extended / implemented by', n.subs, true)))
  }
  const jumpFile = (f) => h('a', { class: 'jump mono', onclick: () => select({ file: f }) }, f.shown)
  const jumpSym = (n) => h('a', { class: 'jump' }, h('span', { onclick: () => select({ sym: n }) }, n.name), h('span', { class: 'muted mono' }, `  ${loc(n)}`))
  function select(sel) { st.sel = sel; st.tab = sel.file ? (st.tab === 'map' ? 'map' : 'files') : 'symbols'; render(); window.scrollTo({ top: 0 }) }

  function symbols() {
    const q = st.q.trim().toLowerCase()
    const hits = q ? [...nodes.values()].filter((n) => inRepo(n.file) && n.name.toLowerCase().includes(q)).slice(0, 300) : []
    return h('section', null,
      st.sel && st.sel.sym ? symDetail(st.sel.sym) : null,
      q ? h('table', null, h('tr', null, h('th', null, 'symbol'), h('th', null, 'kind'), h('th', null, 'where'), h('th', null, 'callers'), h('th', null, 'callees')),
        hits.map((n) => h('tr', { class: 'click', onclick: () => select({ sym: n }) }, h('td', null, n.name), h('td', null, n.kind), h('td', { class: 'mono' }, loc(n)), h('td', { class: 'n' }, n.callers.length), h('td', { class: 'n' }, n.callees.length))))
        : st.sel ? null : h('p', { class: 'muted' }, 'Type in the search box to find a symbol.'),
      hits.length === 300 ? h('p', { class: 'note' }, 'First 300 matches; narrow the search.') : null)
  }
  function filesView() {
    const q = st.q.trim().toLowerCase()
    const fs = [...files.values()].filter((f) => inRepo(f) && (!q || f.shown.toLowerCase().includes(q)))
    return h('section', null,
      st.sel && st.sel.file ? fileDetail(st.sel.file) : null,
      h('table', null, h('tr', null, h('th', null, 'file'), h('th', null, 'language'), h('th', null, 'definitions'), h('th', null, 'depends on'), h('th', null, 'used by')),
        fs.slice(0, 500).map((f) => h('tr', { class: 'click', onclick: () => select({ file: f }) }, h('td', { class: 'mono' }, f.shown, f.test ? h('span', { class: 'pill' }, 'test') : null), h('td', null, f.lang), h('td', { class: 'n' }, f.defs.length), h('td', { class: 'n' }, f.out.size), h('td', { class: 'n' }, f.in.size)))),
      fs.length > 500 ? h('p', { class: 'note' }, `First 500 of ${fs.length} files; search to narrow.`) : null)
  }
  function hotspots() {
    const ns = [...nodes.values()].filter((n) => inRepo(n.file) && !n.test)
    const fs = [...files.values()].filter(inRepo)
    const top = (xs, key, n = 25) => xs.map((x) => [x, key(x)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n)
    const symTable = (title, rows, col) => h('div', null, h('h2', null, title), h('table', null, h('tr', null, h('th', null, 'symbol'), h('th', null, 'where'), h('th', null, col)),
      rows.map(([n, v]) => h('tr', { class: 'click', onclick: () => select({ sym: n }) }, h('td', null, n.name), h('td', { class: 'mono' }, loc(n)), h('td', { class: 'n' }, v)))))
    const fileTable = (title, rows, col) => h('div', null, h('h2', null, title), h('table', null, h('tr', null, h('th', null, 'file'), h('th', null, col)),
      rows.map(([f, v]) => h('tr', { class: 'click', onclick: () => select({ file: f }) }, h('td', { class: 'mono' }, f.shown), h('td', { class: 'n' }, v)))))
    const co = D.cochange.filter(([repo]) => !st.repo || repo === st.repo).slice(0, 25)
    return h('section', null,
      h('div', { class: 'grid2' }, symTable('Most called', top(ns, (n) => n.callers.length), 'callers'), symTable('Widest fan-out', top(ns, (n) => n.callees.length), 'callees')),
      h('div', { class: 'grid2' }, fileTable('Most depended-on files', top(fs, (f) => f.in.size), 'files using it'), fileTable('Files depending on the most', top(fs, (f) => f.out.size), 'files it uses')),
      h('h2', null, 'Change together (git history)'),
      co.length ? h('table', null, h('tr', null, h('th', null, 'repo'), h('th', null, 'file'), h('th', null, 'file'), h('th', null, 'commits')), co.map(([r, a, b, n]) => h('tr', null, h('td', null, r), h('td', { class: 'mono' }, a), h('td', { class: 'mono' }, b), h('td', { class: 'n' }, n))))
        : h('p', { class: 'muted' }, 'No co-change data (no git history indexed).'))
  }

  // ── map: a fixed layout (computed at render time), drawn on a canvas ──
  let drag = null
  window.addEventListener('mouseup', () => { drag = null })
  const M = D.map
  const mapFiles = M.files.map((id, i) => ({ f: files.get(id), x: M.pos[i][0], y: M.pos[i][1], deg: M.deg[i], r: 2.5 + Math.min(9, Math.sqrt(M.deg[i])), nb: new Set() }))
  for (const [a, b] of M.links) { mapFiles[a].nb.add(b); mapFiles[b].nb.add(a) }
  const byDeg = mapFiles.map((_, i) => i).sort((a, b) => mapFiles[b].deg - mapFiles[a].deg)
  const base = (p) => p.split('/').pop()
  function mapView() {
    const shown = mapFiles.filter((m) => inRepo(m.f)).length
    const total = st.repo ? M.totals[st.repo] || 0 : M.total
    const wrap = h('div', { id: 'map' }), canvas = h('canvas'), tip = h('div', { id: 'tip' })
    wrap.append(canvas, tip)
    const legend = h('div', { class: 'legend' }, D.repos.filter((r) => !st.repo || r.name === st.repo).map((r) => h('span', null, h('i', { style: `background:${repoColor.get(r.name)}` }), r.name)))
    const note = h('p', { class: 'note' }, `${shown} of ${total} files${total > shown ? ' (the most connected)' : ''}, grouped by directory · the biggest are named, hover for the rest · lines are imports and calls between files · drag to pan, scroll to zoom, click to open, double-click to reset`)
    requestAnimationFrame(() => drawMap(canvas, tip))
    return h('section', null, st.sel && st.sel.file ? fileDetail(st.sel.file) : null, legend, wrap, note)
  }
  let resizeTimer = null
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (st.tab === 'map') render() }, 150) })
  function drawMap(canvas, tip) {
    if (!canvas.isConnected) return
    if (canvas.clientWidth < 50 || canvas.clientHeight < 50) return requestAnimationFrame(() => drawMap(canvas, tip)) // not laid out yet
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth, H = canvas.clientHeight
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    const css = getComputedStyle(document.documentElement)
    const col = (v) => css.getPropertyValue(v).trim()
    const fitK = Math.min((W - 60) / 1000, (H - 60) / 1000)
    const view = { k: fitK, x: (W - 1000 * fitK) / 2, y: (H - 1000 * fitK) / 2 }
    let hover = -1
    const vis = (m) => inRepo(m.f)
    const selIdx = () => (st.sel && st.sel.file ? mapFiles.findIndex((m) => m.f === st.sel.file) : -1)
    const sx = (x) => view.x + x * view.k, sy = (y) => view.y + y * view.k
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const focus = hover >= 0 ? hover : selIdx()
      const near = focus >= 0 ? mapFiles[focus].nb : null
      // directory labels, behind everything, while zoomed out
      // directories: a faint disc each (their names are drawn last, on top)
      const groupsShown = M.groups.filter((g) => !st.repo || g.key.startsWith(st.repo + ':'))
      for (const g of groupsShown) { ctx.beginPath(); ctx.arc(sx(g.x), sy(g.y), g.r * view.k, 0, Math.PI * 2); ctx.fillStyle = col('--hover'); ctx.fill() }
      ctx.lineWidth = 1
      ctx.strokeStyle = col('--edge')
      ctx.beginPath()
      for (const [a, b] of M.links) if (vis(mapFiles[a]) && vis(mapFiles[b]) && (focus < 0 || (a !== focus && b !== focus))) { ctx.moveTo(sx(mapFiles[a].x), sy(mapFiles[a].y)); ctx.lineTo(sx(mapFiles[b].x), sy(mapFiles[b].y)) }
      ctx.stroke()
      if (focus >= 0) {
        ctx.strokeStyle = col('--accent'); ctx.lineWidth = 1.6; ctx.beginPath()
        for (const b of near) { ctx.moveTo(sx(mapFiles[focus].x), sy(mapFiles[focus].y)); ctx.lineTo(sx(mapFiles[b].x), sy(mapFiles[b].y)) }
        ctx.stroke()
      }
      const zr = Math.max(0.7, Math.sqrt(view.k / fitK))
      for (let i = 0; i < mapFiles.length; i++) {
        const m = mapFiles[i]
        if (!vis(m)) continue
        ctx.globalAlpha = focus >= 0 && i !== focus && !near.has(i) ? 0.18 : 1
        ctx.beginPath(); ctx.arc(sx(m.x), sy(m.y), m.r * zr, 0, Math.PI * 2)
        ctx.fillStyle = repoColor.get(m.f.repo) || '#888'; ctx.fill()
        if (i === focus) { ctx.lineWidth = 2; ctx.strokeStyle = col('--ink'); ctx.stroke() }
      }
      ctx.globalAlpha = 1
      // file names: the focus and its neighbors always; otherwise the most connected files first,
      // as many as fit without overlapping (more appear as you zoom in)
      // Directory names claim their space first, biggest directory first; file names avoid them.
      const boxes = [], dirLabels = []
      ctx.font = '600 12px ui-sans-serif,system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      for (const g of groupsShown) {
        if (g.r * view.k < 14) continue
        const t = g.key.split(':')[1], w = ctx.measureText(t).width, x = sx(g.x) - w / 2, y = sy(g.y) - g.r * view.k - 9
        const b = [x - 3, y - 8, x + w + 3, y + 8]
        if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue
        boxes.push(b); dirLabels.push([t, x, y])
      }
      ctx.font = '11.5px ui-sans-serif,system-ui,sans-serif'
      const place = (i, strong) => {
        const m = mapFiles[i]; if (!vis(m)) return
        const t = base(m.f.path), w = ctx.measureText(t).width, x = sx(m.x) + m.r * zr + 4, y = sy(m.y)
        if (x > W || y < 0 || y > H || x + w < 0) return
        const b = [x - 2, y - 8, x + w + 2, y + 8]
        if (!strong && boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return
        boxes.push(b)
        ctx.lineWidth = 3; ctx.strokeStyle = col('--panel'); ctx.strokeText(t, x, y)
        ctx.fillStyle = col('--ink'); ctx.globalAlpha = strong || focus < 0 ? 1 : 0.35; ctx.fillText(t, x, y); ctx.globalAlpha = 1
      }
      if (focus >= 0) { place(focus, true); for (const j of near) place(j, true) }
      const budget = Math.min(400, Math.round(30 * (view.k / fitK) ** 1.5))
      for (let r = 0, n = 0; r < byDeg.length && n < budget; r++) { const i = byDeg[r]; if (i === focus || (near && near.has(i))) continue; const before = boxes.length; place(i, false); if (boxes.length > before) n++ }
      ctx.font = '600 12px ui-sans-serif,system-ui,sans-serif'
      for (const [t, x, y] of dirLabels) { ctx.lineWidth = 4; ctx.strokeStyle = col('--panel'); ctx.strokeText(t, x, y); ctx.fillStyle = col('--muted'); ctx.fillText(t, x, y) }
    }
    let queued = false
    const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw() }) }
    draw()
    const hit = (e) => {
      const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, zr = Math.max(0.7, Math.sqrt(view.k / fitK))
      let best = -1, bd = Infinity
      for (let i = 0; i < mapFiles.length; i++) { const m = mapFiles[i]; if (!vis(m)) continue; const d = (sx(m.x) - x) ** 2 + (sy(m.y) - y) ** 2; if (d < bd && d < (m.r * zr + 5) ** 2) { bd = d; best = i } }
      return best
    }
    let moved = false
    canvas.addEventListener('mousedown', (e) => { drag = [e.clientX, e.clientY, view.x, view.y]; moved = false })
    canvas.addEventListener('mousemove', (e) => {
      if (drag) { view.x = drag[2] + e.clientX - drag[0]; view.y = drag[3] + e.clientY - drag[1]; moved = moved || Math.abs(e.clientX - drag[0]) + Math.abs(e.clientY - drag[1]) > 3; redraw(); return }
      const i = hit(e), b = canvas.getBoundingClientRect()
      if (i !== hover) { hover = i; redraw() }
      if (i >= 0) { const m = mapFiles[i]; tip.textContent = `${m.f.shown} · used by ${m.f.in.size} · uses ${m.f.out.size}`; tip.style.display = 'block'; tip.style.left = `${Math.min(e.clientX - b.left + 14, W - tip.offsetWidth - 8)}px`; tip.style.top = `${e.clientY - b.top + 14}px` } else tip.style.display = 'none'
    })
    canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; redraw() } tip.style.display = 'none' })
    canvas.addEventListener('click', (e) => { if (moved) return; const i = hit(e); if (i >= 0) { st.sel = { file: mapFiles[i].f }; render() } })
    canvas.addEventListener('dblclick', () => { view.k = fitK; view.x = (W - 1000 * fitK) / 2; view.y = (H - 1000 * fitK) / 2; redraw() })
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const b = canvas.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top
      const k = Math.min(fitK * 30, Math.max(fitK * 0.5, view.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)))
      view.x = mx - ((mx - view.x) / view.k) * k; view.y = my - ((my - view.y) / view.k) * k; view.k = k
      redraw()
    }, { passive: false })
  }

  // ── shell ──
  const TABS = [['overview', 'Overview'], ['map', 'Map'], ['files', 'Files'], ['symbols', 'Symbols'], ['hotspots', 'Hotspots']]
  let search = null
  function header() {
    search = search || h('input', { type: 'search', placeholder: 'Search files or symbols…', oninput: (e) => { st.q = e.target.value; if (st.tab !== 'files' && st.tab !== 'symbols') st.tab = 'symbols'; render(true) } })
    const repoSel = h('select', { onchange: (e) => { st.repo = e.target.value; st.sel = null; render() } }, h('option', { value: '' }, 'all repositories'), D.repos.map((r) => h('option', { value: r.name }, r.name)))
    repoSel.value = st.repo
    return h('header', null, h('h1', null, 'Code graph'),
      h('nav', null, TABS.map(([id, label]) => h('button', { 'aria-pressed': String(st.tab === id), onclick: () => { st.tab = id; render() } }, label))),
      D.repos.length > 1 ? repoSel : null, search,
      h('span', { class: 'muted' }, `generated ${D.generatedAt.slice(0, 16).replace('T', ' ')} UTC · a map, not the code: read it at the path:line`))
  }
  function render(keepFocus) {
    const view = { overview, map: mapView, files: filesView, symbols, hotspots }[st.tab]()
    const hd = header()
    document.body.replaceChildren(hd, h('main', null, view))
    if (keepFocus) { search.focus(); const n = search.value.length; search.setSelectionRange(n, n) }
  }
  render()
}
