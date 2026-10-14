// grimoire graph · the browsable page. Reads the index read-only and writes ONE self-contained HTML
// file (no network, no CDN: data and code are inlined; a CSP admits only the page's own script, by
// its hash):
//   overview   repositories, languages, file / symbol / link counts, how many call links are guesses
//   map        modules first (modules.mjs): one lane per repository, its largest modules in the order
//              code flows, linked by how many files use each other; click a module for its files on
//              the file map, laid out ONCE here, deterministically (layout.mjs)
//   files      every file; one shows the files using it and the files it uses, side by side
//   symbols    search every definition; one shows its callers on the left and its callees on the
//              right, and what it extends / implements or is extended by
//   hotspots   a size × churn map, most-called symbols and most-used files (links resolved by syntax
//              only), strongest co-change
// Test code and ambiguous links are hidden until asked for; unique-name matches are drawn dashed.
// Views have plain anchors (#sym-12, #file-3, #mod-4) a note can link until the next re-index.
// The helpers below the data section are pure, exported for the tests, and injected into the page.
// Like every graph answer, the page is a map: read the code at the path:line it points to.
import { createHash } from 'node:crypto'
import { openStore } from './store.mjs'
import { layoutMap } from './layout.mjs'
import { systemMap } from './modules.mjs'

const KINDS = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
const MAP_MAX_FILES = 1500 // the file map keeps the most connected production files; the other tabs keep everything

export async function renderGraph(project) {
  const db = await openStore(project.dbPath, { readOnly: true })
  try {
    const repos = db.prepare('SELECT name, root, head, indexed_at FROM repos ORDER BY name').all()
    const files = db.prepare('SELECT id, repo, path, lang, size, is_test, node_id FROM files ORDER BY repo, path').all()
    const nodes = db.prepare("SELECT id, file_id, kind, COALESCE(qualname, name) AS name, line, is_test FROM nodes WHERE kind != 'file'").all()
    const edges = db.prepare('SELECT src, dst, kind, confidence FROM edges').all()
    const cochange = db.prepare('SELECT repo, a, b, n FROM cochange ORDER BY n DESC LIMIT 200').all()
    const hasChurn = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'churn'").get() // an index built before schema 3 has none
    const churn = new Map(hasChurn ? db.prepare('SELECT repo, path, n FROM churn').all().map((c) => [`${c.repo}\0${c.path}`, c.n]) : [])
    const system = systemMap(files, nodes, edges)
    const moduleOf = new Map(system.fileModule)
    const confs = [...new Set(edges.map((e) => e.confidence || ''))]
    const kinds = [...new Set(nodes.map((n) => n.kind))]
    const data = {
      map: mapData(files, nodes, edges),
      system: { modules: system.modules, links: system.links },
      generatedAt: new Date().toISOString(),
      mapMax: MAP_MAX_FILES,
      repos,
      files: files.map((f) => [f.id, f.repo, f.path, f.lang, f.is_test ? 1 : 0, f.node_id, f.size || 0, churn.get(`${f.repo}\0${f.path}`) || 0, moduleOf.has(f.id) ? moduleOf.get(f.id) : -1]),
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

// The file-level graph for the file map: most connected files, weighted links, positions, groups.
// A link whose every edge is ambiguous is flagged [a, b, w, 1]: the page hides it until asked, and it
// counts for no file's rank, so name guesses never decide which files make the map.
export function mapData(files, nodes, edges) {
  const fileOfNode = new Map()
  for (const f of files) fileOfNode.set(f.node_id, f.id)
  for (const n of nodes) fileOfNode.set(n.id, n.file_id)
  const w = new Map(), sure = new Map(), deg = new Map()
  for (const e of edges) {
    const a = fileOfNode.get(e.src), b = fileOfNode.get(e.dst)
    if (a === undefined || b === undefined || a === b) continue
    const k = a < b ? `${a},${b}` : `${b},${a}`
    w.set(k, (w.get(k) || 0) + 1)
    if (e.confidence !== 'ambiguous') sure.set(k, (sure.get(k) || 0) + 1)
  }
  for (const k of sure.keys()) { const [a, b] = k.split(',').map(Number); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1) }
  // Production code first: test files only take slots production code leaves free. The cap is
  // shared out per repository, in proportion to its size and at least one file each, so filtering
  // to a small repo still shows its own best-connected files; unused slots go to the rest.
  const all = files.map((f) => ({ id: f.id, repo: f.repo, path: f.path, test: f.is_test ? 1 : 0, deg: deg.get(f.id) || 0 }))
    .sort((a, b) => a.test - b.test || b.deg - a.deg || (a.path < b.path ? -1 : 1))
  const perRepo = new Map()
  for (const f of all) (perRepo.get(f.repo) || perRepo.set(f.repo, []).get(f.repo)).push(f)
  const totals = Object.fromEntries([...perRepo].map(([r, fs]) => [r, fs.filter((f) => !f.test).length]))
  const production = all.filter((f) => !f.test).length
  let keep = all
  if (all.length > MAP_MAX_FILES) {
    const picked = new Set()
    for (const [, fs] of perRepo) for (const f of fs.slice(0, Math.max(1, Math.floor(((MAP_MAX_FILES - perRepo.size) * fs.length) / all.length)))) if (!f.test || picked.size >= production) picked.add(f)
    for (const f of all) { if (picked.size >= MAP_MAX_FILES) break; picked.add(f) }
    keep = all.filter((f) => picked.has(f))
  }
  const at = new Map(keep.map((f, i) => [f.id, i]))
  const links = []
  for (const [k, v] of w) { const [a, b] = k.split(',').map(Number); if (at.has(a) && at.has(b)) links.push([at.get(a), at.get(b), v, sure.has(k) ? 0 : 1]) }
  links.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const { pos, groups } = layoutMap(keep, links)
  return { files: keep.map((f) => f.id), deg: keep.map((f) => f.deg), pos, links, groups, total: production, totals }
}

// ── pure helpers: exported for the tests, injected into the page as they are ──
export const INITIAL = { tab: 'overview', repo: '', q: '', tests: false, guesses: false, mapMode: 'modules', module: null }
export const LANE_MAX = 14 // modules drawn per lane on the system map, the largest
export const MAXCOL = 12 // items per column of a neighbourhood

// HTML-escape text for markup and attributes. ([<] because html() rewrites every "<" "/" pair.)
export function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/[<]/g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
export function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s } // keep the start of a name
export function cutL(s, n) { return s.length > n ? '…' + s.slice(-(n - 1)) : s } // keep the end of a path
export function plural(n, word) { return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}` }

// '#sym-12' → { kind: 'sym', id: 12 }, '#map' → { kind: 'tab', tab: 'map' }, anything else → null
export function parseHash(hash, tabs) {
  const m = /^#(sym|file|mod)-(\d+)$/.exec(hash || '')
  if (m) return { kind: m[1], id: Number(m[2]) }
  const t = (hash || '').slice(1)
  return tabs.includes(t) ? { kind: 'tab', tab: t } : null
}

// A link between two files carries [edges, resolved, unique-name, ambiguous]: it is as sure as its
// surest edge.
export function pairConf(v) { return v[1] ? 'resolved' : v[2] ? 'unique-name' : 'ambiguous' }

// churn → colour band 0 (never changed) … 4, on a log scale: most files change rarely
export function heatOf(c, maxC) { return c <= 0 ? 0 : maxC <= 1 ? 4 : Math.min(4, 1 + Math.floor((3.999 * Math.log(c)) / Math.log(maxC))) }
// the churn range each band 1…4 covers, for the legend: [[band, low, high]]
export function heatBands(maxC) {
  const bands = []
  for (let c = 1; c <= maxC; c++) { const b = heatOf(c, maxC), last = bands[bands.length - 1]; if (last && last[0] === b) last[2] = c; else bands.push([b, c, c]) }
  return bands
}

// values sorted large to small → [x, y, w, h] each, in the same order, filling the rectangle
export function squarify(values, x, y, w, h) {
  const total = values.reduce((a, b) => a + b, 0)
  if (!values.length || total <= 0) return values.map(() => [x, y, 0, 0])
  const scale = (w * h) / total, areas = values.map((v) => v * scale), out = []
  const worst = (row, side) => { const s = row.reduce((a, b) => a + b, 0); return Math.max((side * side * Math.max(...row)) / (s * s), (s * s) / (side * side * Math.min(...row))) }
  for (let i = 0; i < areas.length;) {
    const side = Math.min(w, h), row = [areas[i]]
    let j = i + 1
    while (j < areas.length && areas[j] > 0 && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++])
    const s = row.reduce((a, b) => a + b, 0)
    if (s <= 0) { for (; i < areas.length; i++) out.push([x, y, 0, 0]); break }
    if (w >= h) { const cw = s / h; let cy = y; for (const a of row) { out.push([x, cy, cw, a / cw]); cy += a / cw } x += cw; w -= cw }
    else { const rh = s / w; let cx = x; for (const a of row) { out.push([cx, y, a / rh, rh]); cx += a / rh } y += rh; h -= rh }
    i = j
  }
  return out
}

// a lane keeps its `max` largest modules, in their flow order; the rest are counted
export function lanePick(mods, max) {
  const keep = new Set(mods.slice().sort((a, b) => b.files - a.files || a.i - b.i).slice(0, max))
  return { shown: mods.filter((m) => keep.has(m)), rest: mods.length - keep.size }
}

const HELPERS = [esc, cut, cutL, plural, parseHash, pairConf, heatOf, heatBands, squarify, lanePick]

function html(data) {
  // Every "<" becomes \\u003c, so no data string can close the <script> element.
  const blob = JSON.stringify(data).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029')
  const js = `${HELPERS.map((f) => f.toString()).join('\n')}\nconst INITIAL = ${JSON.stringify(INITIAL)}, LANE_MAX = ${LANE_MAX}, MAXCOL = ${MAXCOL};\n(${client.toString()})()`.replace(/<\//g, '<\\/')
  const hash = createHash('sha256').update(js, 'utf8').digest('base64')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; img-src 'none'">
<title>grimoire code graph</title><style>${CSS}</style></head>
<body><noscript>This page needs JavaScript to render the code graph.</noscript>
<script type="application/json" id="graph-data">${blob}</script>
<script>${js}</script>
</body></html>
`
}

const CSS = `
:root{--bg:#fbfaf8;--panel:#fff;--ink:#1d1d1f;--muted:#6b6b72;--line:#e6e4df;--accent:#6d4aff;--on-accent:#fff;--accent-soft:#eeeaff;--hover:#f2f0ec;--edge:rgba(60,60,70,.16);--link:rgba(60,60,70,.32);
--heat0:#e9e8e4;--heat1:#f6dcb2;--heat2:#efb46b;--heat3:#d97a33;--heat4:#a8461b;--tl3:#1d1d1f;--tl4:#fff}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1c1c21;--ink:#ececf1;--muted:#9a9aa6;--line:#2c2c33;--accent:#a08bff;--on-accent:#141417;--accent-soft:#2a2540;--hover:#24242b;--edge:rgba(220,220,235,.13);--link:rgba(220,220,235,.28);
--heat0:#28292e;--heat1:#4d3b25;--heat2:#85592a;--heat3:#c87430;--heat4:#f59a4a;--tl3:#1d1d1f;--tl4:#1d1d1f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
header{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:3}
header h1{font-size:16px;margin:0 8px 0 0}nav,.seg{display:flex;gap:4px}nav button,.seg button,select,input[type=search]{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
nav button,.seg button{cursor:pointer}nav button[aria-pressed=true],.seg button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
svg [tabindex]:focus-visible .box,svg [tabindex]:focus-visible .tile{stroke:var(--accent);stroke-width:2.5}
input[type=search]{min-width:220px;flex:1;max-width:420px}.tog{display:inline-flex;gap:6px;align-items:center;color:var(--muted);font-size:13px;cursor:pointer;white-space:nowrap}
main{padding:20px;max-width:1440px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.card b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.card span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:20px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600;font-size:12px}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;width:1%}td.mono,td.name{overflow-wrap:anywhere}
tr.click{cursor:pointer}tr.click:hover,tr.on{background:var(--hover)}code,.mono{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}
h2{font-size:15px;margin:22px 0 10px}.muted{color:var(--muted)}.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
.split{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.6fr);gap:20px;align-items:start}
.split>.side{position:sticky;top:var(--hdr,76px);max-height:calc(100vh - var(--hdr,76px) - 20px);overflow:auto}
@media (max-width:1100px){.split{grid-template-columns:1fr}.split>.side{position:static;max-height:none;order:-1}}
@media (max-width:900px){.grid2{grid-template-columns:1fr}}
#map{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;height:72vh;overflow:hidden}
#map canvas{width:100%;height:100%;display:block;cursor:grab}#tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);padding:4px 8px;border-radius:6px;font-size:12px;display:none;white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0;align-items:center}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;border:1px solid var(--line);font-size:11px;color:var(--muted);margin-left:6px}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:20px}.detail h3{margin:0 0 6px;font-size:15px;overflow-wrap:anywhere}
ul.links{list-style:none;padding:0;margin:6px 0 0}ul.links li{padding:3px 0;overflow-wrap:anywhere}a.jump{color:var(--accent);cursor:pointer;text-decoration:none}a.jump:hover{text-decoration:underline}
.note{color:var(--muted);font-size:12px;margin:8px 0}details{margin-top:12px}summary{cursor:pointer;color:var(--muted);font-size:13px}
.toolbar{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-bottom:12px}
.svgbox{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;overflow-x:auto}.svgbox svg{display:block;width:100%;height:auto;min-width:720px}
.detail .svgbox{border:0;padding:0;margin-top:10px}.detail .svgbox svg{min-width:600px;max-width:1000px}
svg text{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;fill:var(--ink)}svg .sub{font-size:10.5px;fill:var(--muted)}svg .head{font:600 11px ui-sans-serif,system-ui,sans-serif;fill:var(--muted);letter-spacing:.06em}
svg .box{fill:var(--panel);stroke:var(--line)}svg .focus{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5}svg .pillr{fill:none;stroke:var(--line);stroke-dasharray:4 4}
svg .edge{fill:none;stroke:var(--link);stroke-width:1.6}svg .edge.dash{stroke-dasharray:6 4}svg .edge.dot{stroke-dasharray:2 4}svg .arrow{fill:var(--link)}
svg [data-sym],svg [data-file],svg [data-mod]{cursor:pointer}svg [data-sym]:hover .box,svg [data-file]:hover .box,svg [data-mod]:hover .box{stroke:var(--accent)}
svg .lane{fill:var(--hover)}svg .mlink{fill:none;stroke:var(--link);transition:opacity .12s}svg .mcount{display:none;font-size:10.5px;fill:var(--accent)}
svg.hot .mlink{opacity:.12}svg.hot .mlink.on{opacity:1;stroke:var(--accent)}svg.hot .mcount.on{display:block}svg.hot [data-mod]{opacity:.35}svg.hot [data-mod].on{opacity:1}
svg .tile{stroke:var(--panel);stroke-width:1}svg .tile:hover{stroke:var(--ink)}svg .tlabel{font-size:10.5px;fill:var(--ink);pointer-events:none}svg .tlabel.h3{fill:var(--tl3)}svg .tlabel.h4{fill:var(--tl4)}
.swatch{display:inline-block;width:18px;height:10px;vertical-align:-1px}
@media (prefers-reduced-motion:reduce){svg .mlink{transition:none}}
`

// Runs in the browser. Self-contained: no imports; the helpers above are injected beside it.
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
  const GUESS = new Set(['ambiguous', 'unique-name'])
  const confRank = (c) => (c === 'ambiguous' ? 2 : c === 'unique-name' ? 1 : 0)
  const activate = (e) => e.key === 'Enter' || e.key === ' ' // a role=button answers both

  // ── indexes ──
  const files = new Map(), fileByNode = new Map(), nodes = new Map()
  for (const [id, repo, path, lang, test, nodeId, size, churn, module] of D.files) {
    const root = (D.repos.find((r) => r.name === repo) || {}).root
    const f = { id, repo, path, lang, test: !!test, nodeId, size: size || 0, churn: churn || 0, module: module ?? -1, shown: root && root !== '.' ? `${root}/${path}` : path, defs: [], out: new Map(), in: new Map() }
    files.set(id, f)
    fileByNode.set(nodeId, f)
  }
  for (const [id, fileId, k, name, line, test] of D.nodes) {
    const f = files.get(fileId)
    const n = { id, file: f, kind: D.kinds[k], name, line, test: !!test || !!(f && f.test), callers: [], callees: [], supers: [], subs: [] }
    nodes.set(id, n)
    if (f) f.defs.push(n)
  }
  const fileOf = (id) => fileByNode.get(id) || (nodes.get(id) || {}).file
  const edgeCount = {}
  let calls = 0, guesses = 0
  // a file link counts its edges: [all, resolved by syntax, unique-name, ambiguous]
  const bump = (m, k, conf) => { const v = m.get(k) || [0, 0, 0, 0]; v[0]++; v[conf === 'ambiguous' ? 3 : conf === 'unique-name' ? 2 : 1]++; m.set(k, v) }
  for (const [src, dst, k, c] of D.edges) {
    const kind = D.edgeKinds[k], conf = D.confs[c]
    edgeCount[kind] = (edgeCount[kind] || 0) + 1
    const a = nodes.get(src), b = nodes.get(dst)
    if (kind === 'CALLS') { calls++; if (GUESS.has(conf)) guesses++ }
    if (kind === 'CALLS' && a && b) { a.callees.push([b, conf]); b.callers.push([a, conf]) }
    if ((kind === 'EXTENDS' || kind === 'IMPLEMENTS') && a && b) { a.supers.push([b, kind]); b.subs.push([a, kind]) }
    const fa = fileOf(src), fb = fileOf(dst)
    if (fa && fb && fa !== fb) { bump(fa.out, fb, conf); bump(fb.in, fa, conf) }
  }
  const S = D.system || { modules: [], links: [] }
  const modules = S.modules.map((m, i) => ({ ...m, i, list: [], uses: new Map(), usedBy: new Map() }))
  for (const f of files.values()) if (f.module >= 0 && modules[f.module]) modules[f.module].list.push(f)
  for (const [a, b, n] of S.links) { modules[a].uses.set(b, n); modules[b].usedBy.set(a, n) }
  const loc = (n) => `${n.file ? n.file.shown : '?'}:${n.line}`
  const short = (p) => p.split('/').slice(-2).join('/') // parent/file: never a bare index.ts
  const perRepo = new Map(D.repos.map((r) => [r.name, { files: 0, tests: 0, symbols: 0, modules: 0 }]))
  for (const f of files.values()) if (perRepo.has(f.repo)) { perRepo.get(f.repo).files++; if (f.test) perRepo.get(f.repo).tests++ }
  for (const n of nodes.values()) if (n.file && perRepo.has(n.file.repo)) perRepo.get(n.file.repo).symbols++
  for (const m of modules) if (perRepo.has(m.repo)) perRepo.get(m.repo).modules++

  // ── state ──
  const TABS = [['overview', 'Overview'], ['map', 'Map'], ['files', 'Files'], ['symbols', 'Symbols'], ['hotspots', 'Hotspots']]
  const st = { ...INITIAL, sel: null }
  const inRepo = (f) => !st.repo || (f && f.repo === st.repo)
  const showFile = (f) => !!f && inRepo(f) && (st.tests || !f.test)
  const showSym = (n) => !!n.file && showFile(n.file) && (st.tests || !n.test)
  const resolvedOf = (m) => [...m].filter(([g, v]) => showFile(g) && v[1] > 0)
  const openModule = (i) => { if (!modules[i]) return; if (st.repo && modules[i].repo !== st.repo) st.repo = ''; st.tab = 'map'; st.mapMode = 'files'; st.module = i }

  // Plain anchors only: #overview, #map, #sym-12, #file-3, #mod-4.
  function readHash() {
    const p = parseHash(location.hash, TABS.map(([id]) => id))
    if (!p) return
    if (p.kind === 'sym' && nodes.has(p.id)) { st.sel = { sym: nodes.get(p.id) }; st.tab = 'symbols' }
    else if (p.kind === 'file' && files.has(p.id)) { st.sel = { file: files.get(p.id) }; st.tab = 'files' }
    else if (p.kind === 'mod') openModule(p.id)
    else if (p.kind === 'tab') { st.tab = p.tab; if (p.tab === 'map') { st.mapMode = 'modules'; st.module = null } }
  }
  function writeHash() {
    const want = st.tab === 'map' && st.mapMode === 'files' && st.module !== null ? `#mod-${st.module}`
      : st.tab === 'symbols' && st.sel && st.sel.sym ? `#sym-${st.sel.sym.id}`
        : st.tab === 'files' && st.sel && st.sel.file ? `#file-${st.sel.file.id}` : `#${st.tab}`
    if (location.hash !== want) { try { history.replaceState(null, '', want) } catch {} }
  }
  window.addEventListener('hashchange', () => { readHash(); render() })

  // ── overview ──
  function overview() {
    const fs = [...files.values()].filter(inRepo)
    const ns = [...nodes.values()].filter((n) => inRepo(n.file))
    const langs = {}
    for (const f of fs) langs[f.lang] = (langs[f.lang] || 0) + 1
    const card = (v, l) => h('div', { class: 'card' }, h('b', null, typeof v === 'number' ? v.toLocaleString() : v), h('span', null, l))
    return h('section', null,
      h('div', { class: 'cards' }, card(fs.filter((f) => !f.test).length, 'production files'), card(fs.filter((f) => f.test).length, 'test and support files'),
        card(ns.length, 'symbols'), card(modules.filter((m) => !st.repo || m.repo === st.repo).length, 'modules'),
        ...D.edgeKinds.map((k) => card(edgeCount[k] || 0, `${k} links (all repos)`)),
        card(calls ? `${Math.round((100 * guesses) / calls)}%` : '0%', 'of call links are name guesses: unique-name or ambiguous')),
      h('h2', null, 'Repositories'),
      h('table', null, h('tr', null, h('th', null, 'repo'), h('th', null, 'root'), h('th', { class: 'n' }, 'files'), h('th', { class: 'n' }, 'tests'), h('th', { class: 'n' }, 'modules'), h('th', { class: 'n' }, 'symbols'), h('th', null, 'HEAD'), h('th', null, 'indexed')),
        D.repos.filter((r) => !st.repo || r.name === st.repo).map((r) => h('tr', null,
          h('td', null, h('i', { style: `display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:${repoColor.get(r.name)}` }), r.name),
          h('td', { class: 'mono' }, r.root), h('td', { class: 'n' }, perRepo.get(r.name).files), h('td', { class: 'n' }, perRepo.get(r.name).tests),
          h('td', { class: 'n' }, perRepo.get(r.name).modules), h('td', { class: 'n' }, perRepo.get(r.name).symbols),
          h('td', { class: 'mono' }, (r.head || '').slice(0, 10)), h('td', null, r.indexed_at || '')))),
      h('h2', null, 'Languages'),
      h('table', null, h('tr', null, h('th', null, 'language'), h('th', { class: 'n' }, 'files')),
        Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l, n]) => h('tr', null, h('td', null, l), h('td', { class: 'n' }, n)))))
  }

  // ── neighbourhood: what uses the focus on the left, what it uses on the right ──
  // items: { sym | file, label, sub, repo, conf, n, test }
  function neighbourhood(focus, leftTitle, left, rightTitle, right) {
    const prep = (items) => {
      const shown = [], hid = { test: 0, amb: 0 }
      for (const it of items) { if (it.test && !st.tests) hid.test++; else if (it.conf === 'ambiguous' && !st.guesses) hid.amb++; else shown.push(it) }
      shown.sort((a, b) => confRank(a.conf) - confRank(b.conf) || (b.n || 0) - (a.n || 0) || (a.label < b.label ? -1 : 1))
      const pills = []
      if (shown.length > MAXCOL) pills.push(`+${shown.length - MAXCOL} more in the lists below`)
      if (hid.test) pills.push(`${hid.test} in test code hidden`)
      if (hid.amb) pills.push(`${hid.amb} ambiguous hidden`)
      return { items: shown.slice(0, MAXCOL), pills, total: items.length }
    }
    const L = prep(left), R = prep(right)
    const W = 880, colW = 260, F0 = 310, FW = 260, R0 = 620, rowH = 38, gap = 8, top = 30, focusH = 66
    const rows = Math.max(L.items.length + L.pills.length, R.items.length + R.pills.length, 2)
    const H = top + rows * (rowH + gap) + 8
    const fy = top + Math.max(0, (Math.max(L.items.length, R.items.length, 1) * (rowH + gap) - gap) / 2 - focusH / 2)
    const parts = [`<svg viewBox="-2 0 ${W + 4} ${H}" role="group" aria-label="${esc(focus.label)}: ${esc(leftTitle)} ${L.total}, ${esc(rightTitle)} ${R.total}">`,
      '<defs><marker id="nb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L8,4L0,8z" class="arrow"/></marker></defs>',
      `<text class="head" x="0" y="14">${esc(leftTitle.toUpperCase())} · ${L.total}</text>`,
      `<text class="head" x="${R0}" y="14">${esc(rightTitle.toUpperCase())} · ${R.total}</text>`]
    const cls = (c) => `edge${c === 'unique-name' ? ' dash' : c === 'ambiguous' ? ' dot' : ''}`
    const item = (it, x, y) => {
      const attr = it.sym !== undefined ? `data-sym="${it.sym}"` : `data-file="${it.file}"`
      const tag = it.n > 1 ? ` · ${it.n} links` : it.conf && it.conf !== 'resolved' ? ` · ${it.conf}` : ''
      return `<g ${attr} tabindex="0" role="button" aria-label="${esc(it.label)}, ${esc(it.sub)}${esc(tag)}"><title>${esc(it.label)}\n${esc(it.sub)}${esc(tag)}</title><rect class="box" x="${x}" y="${y}" width="${colW}" height="${rowH}" rx="5"/>` +
        `<rect x="${x}" y="${y}" width="4" height="${rowH}" fill="${repoColor.get(it.repo) || '#888'}"/>` +
        `<text x="${x + 12}" y="${y + 16}">${esc(cut(it.label, 33))}</text><text class="sub" x="${x + 12}" y="${y + 31}">${esc(cutL(it.sub + tag, 37))}</text></g>`
    }
    L.items.forEach((it, i) => { const y = top + i * (rowH + gap); parts.push(`<path class="${cls(it.conf)}" marker-end="url(#nb-arrow)" d="M${colW},${y + rowH / 2} C${colW + 24},${y + rowH / 2} ${F0 - 24},${fy + focusH / 2} ${F0 - 2},${fy + focusH / 2}"/>`) })
    R.items.forEach((it, i) => { const y = top + i * (rowH + gap); parts.push(`<path class="${cls(it.conf)}" marker-end="url(#nb-arrow)" d="M${F0 + FW},${fy + focusH / 2} C${F0 + FW + 24},${fy + focusH / 2} ${R0 - 24},${y + rowH / 2} ${R0 - 2},${y + rowH / 2}"/>`) })
    L.items.forEach((it, i) => parts.push(item(it, 0, top + i * (rowH + gap))))
    R.items.forEach((it, i) => parts.push(item(it, R0, top + i * (rowH + gap))))
    const pill = (t, x, y) => `<rect class="pillr" x="${x}" y="${y + 4}" width="${colW}" height="${rowH - 8}" rx="${(rowH - 8) / 2}"/><text class="sub" x="${x + colW / 2}" y="${y + rowH / 2 + 4}" text-anchor="middle">${esc(t)}</text>`
    L.pills.forEach((t, i) => parts.push(pill(t, 0, top + (L.items.length + i) * (rowH + gap))))
    R.pills.forEach((t, i) => parts.push(pill(t, R0, top + (R.items.length + i) * (rowH + gap))))
    parts.push(`<rect class="focus" x="${F0}" y="${fy}" width="${FW}" height="${focusH}" rx="7"/><rect x="${F0}" y="${fy}" width="5" height="${focusH}" fill="${repoColor.get(focus.repo) || '#888'}"/>`,
      `<text x="${F0 + 14}" y="${fy + 22}" font-weight="600">${esc(cut(focus.label, 32))}</text><text class="sub" x="${F0 + 14}" y="${fy + 40}">${esc(cutL(focus.sub, 37))}</text><text class="sub" x="${F0 + 14}" y="${fy + 56}">${esc(cut(focus.kind || '', 37))}</text>`)
    const none = (x) => `<text class="sub" x="${x}" y="${top + 16}">none found</text><text class="sub" x="${x}" y="${top + 31}">(a missing link proves nothing: grep)</text>`
    if (!L.total) parts.push(none(0))
    if (!R.total) parts.push(none(R0))
    parts.push('</svg>')
    const box = h('div', { class: 'svgbox' })
    box.innerHTML = parts.join('')
    const open = (e) => {
      const g = e.target.closest('[data-sym],[data-file]')
      if (!g) return
      if (g.dataset.sym) select({ sym: nodes.get(Number(g.dataset.sym)) }); else select({ file: files.get(Number(g.dataset.file)) })
    }
    box.addEventListener('click', open)
    box.addEventListener('keydown', (e) => { if (activate(e)) { e.preventDefault(); open(e) } })
    return box
  }

  function symDetail(n) {
    const it = ([m, conf]) => ({ sym: m.id, label: m.name, sub: loc(m), repo: m.file && m.file.repo, conf, test: m.test })
    const list = (title, xs, label) => h('div', null, h('h2', null, `${title} (${xs.length})`),
      xs.length ? h('ul', { class: 'links' }, xs.slice(0, 200).map(([m, tag]) => h('li', null, jumpSym(m), h('span', { class: 'pill' }, label ? tag : tag || '')))) : h('div', { class: 'muted' }, 'none found (a missing link proves nothing: check with grep)'))
    return h('div', { class: 'detail' },
      h('h3', null, n.name, h('span', { class: 'pill' }, n.kind), n.test ? h('span', { class: 'pill' }, 'test') : null),
      h('div', null, 'at ', h('code', null, loc(n)), ' · in ', n.file ? jumpFile(n.file) : '?'),
      neighbourhood({ label: n.name, sub: loc(n), kind: n.kind, repo: n.file && n.file.repo }, 'Callers', n.callers.map(it), 'Callees', n.callees.map(it)),
      h('p', { class: 'note' }, 'Solid: resolved by syntax · dashed: the only definition of that name (unique-name) · dotted: one of several (ambiguous). Arrows point from the caller to what it calls.'),
      n.supers.length || n.subs.length ? h('div', { class: 'grid2' }, list('Extends / implements', n.supers, true), list('Extended / implemented by', n.subs, true)) : null,
      h('details', null, h('summary', null, `Every caller (${n.callers.length}) and callee (${n.callees.length}), as lists, test code and guesses included`),
        h('div', { class: 'grid2' }, list('Callers', n.callers), list('Callees', n.callees))))
  }
  function fileDetail(f) {
    const it = ([g, v]) => ({ file: g.id, label: short(g.path), sub: g.shown, repo: g.repo, n: v[0], conf: pairConf(v), test: g.test })
    const byCount = (m) => [...m.entries()].sort((a, b) => b[1][0] - a[1][0])
    const mod = f.module >= 0 ? modules[f.module] : null
    return h('div', { class: 'detail' },
      h('h3', { class: 'mono' }, f.shown), h('div', { class: 'muted' }, `${f.repo} · ${f.lang}${f.test ? ' · test code' : ''} · ${plural(f.defs.length, 'definition')}${f.churn ? ` · in ${plural(f.churn, 'recent commit')}` : ''}`,
        mod ? h('span', null, ' · module ', h('a', { class: 'jump mono', onclick: () => { openModule(mod.i); render() } }, mod.key)) : null),
      neighbourhood({ label: short(f.path), sub: f.shown, kind: `${plural(f.in.size, 'file')} use it · it uses ${f.out.size}`, repo: f.repo }, 'Used by', [...f.in].map(it), 'Uses', [...f.out].map(it)),
      h('p', { class: 'note' }, 'Solid: at least one link resolved by syntax · dashed: unique-name matches only · dotted: ambiguous matches only. Arrows point from the file that uses to the file it uses.'),
      h('details', null, h('summary', null, `Every file it uses (${f.out.size}), every file using it (${f.in.size}), its ${plural(f.defs.length, 'definition')}`),
        h('div', { class: 'grid2' },
          h('div', null, h('h2', null, 'Uses'), h('ul', { class: 'links' }, byCount(f.out).slice(0, 200).map(([g, v]) => h('li', null, jumpFile(g), h('span', { class: 'pill' }, v[0]))))),
          h('div', null, h('h2', null, 'Used by'), h('ul', { class: 'links' }, byCount(f.in).slice(0, 200).map(([g, v]) => h('li', null, jumpFile(g), h('span', { class: 'pill' }, v[0])))))),
        h('h2', null, 'Definitions'),
        h('ul', { class: 'links' }, f.defs.slice().sort((a, b) => a.line - b.line).map((n) => h('li', null, jumpSym(n), h('span', { class: 'pill' }, n.kind))))))
  }
  const jumpFile = (f) => h('a', { class: 'jump mono', onclick: () => select({ file: f }) }, f.shown)
  const jumpSym = (n) => h('a', { class: 'jump' }, h('span', { onclick: () => select({ sym: n }) }, n.name), h('span', { class: 'muted mono' }, `  ${loc(n)}`))
  function select(sel) {
    if (!sel || (!sel.sym && !sel.file)) return
    st.sel = sel; st.tab = sel.file ? 'files' : 'symbols'
    render()
    if (window.innerWidth <= 1100) window.scrollTo({ top: 0 })
  }
  const withSide = (list, detail) => (list && detail ? h('section', { class: 'split' }, h('div', null, list), h('aside', { class: 'side' }, detail)) : h('section', null, detail, list))

  function symbols() {
    const q = st.q.trim().toLowerCase()
    const hits = q ? [...nodes.values()].filter((n) => showSym(n) && n.name.toLowerCase().includes(q)).slice(0, 300) : []
    const sel = st.sel && st.sel.sym
    const list = q ? h('div', null,
      h('table', null, h('tr', null, h('th', null, 'symbol'), h('th', null, 'kind'), h('th', null, 'where'), h('th', { class: 'n' }, 'callers'), h('th', { class: 'n' }, 'callees')),
        hits.map((n) => h('tr', { class: `click${sel === n ? ' on' : ''}`, onclick: () => select({ sym: n }) }, h('td', { class: 'name' }, n.name), h('td', null, n.kind), h('td', { class: 'mono' }, loc(n)),
          h('td', { class: 'n' }, n.callers.filter(([, c]) => !GUESS.has(c)).length), h('td', { class: 'n' }, n.callees.filter(([, c]) => !GUESS.has(c)).length)))),
      h('p', { class: 'note' }, `${hits.length === 300 ? 'First 300 matches; narrow the search. ' : ''}Counts are links resolved by syntax.${st.tests ? '' : ' Test code hidden.'}`))
      : null
    return withSide(list, sel ? symDetail(sel) : list ? null : h('p', { class: 'muted' }, 'Type in the search box to find a symbol.'))
  }
  function filesView() {
    const q = st.q.trim().toLowerCase()
    const fs = [...files.values()].filter((f) => showFile(f) && (!q || f.shown.toLowerCase().includes(q)))
    const sel = st.sel && st.sel.file
    const list = h('div', null,
      h('table', null, h('tr', null, h('th', null, 'file'), h('th', null, 'language'), h('th', { class: 'n' }, 'definitions'), h('th', { class: 'n' }, 'uses'), h('th', { class: 'n' }, 'used by')),
        fs.slice(0, 500).map((f) => h('tr', { class: `click${sel === f ? ' on' : ''}`, onclick: () => select({ file: f }) }, h('td', { class: 'mono' }, f.shown, f.test ? h('span', { class: 'pill' }, 'test') : null), h('td', null, f.lang), h('td', { class: 'n' }, f.defs.length), h('td', { class: 'n' }, resolvedOf(f.out).length), h('td', { class: 'n' }, resolvedOf(f.in).length)))),
      h('p', { class: 'note' }, `${fs.length > 500 ? `First 500 of ${fs.length} files; search to narrow. ` : ''}Uses and used by count files linked by syntax.${st.tests ? '' : ' Test code hidden.'}`))
    return withSide(list, sel ? fileDetail(sel) : null)
  }

  // ── hotspots ──
  function treemap(fs) {
    const top = fs.filter((f) => f.size > 0).sort((a, b) => b.size - a.size).slice(0, 400)
    if (!top.length) return h('p', { class: 'muted' }, 'No file sizes in the index.')
    const W = 1200, H = 520, maxC = Math.max(0, ...top.map((f) => f.churn))
    const rects = squarify(top.map((f) => f.size), 0, 0, W, H)
    const parts = [`<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="The ${plural(top.length, 'largest file')}: area is size, colour is how many recent commits touched it">`]
    top.forEach((f, i) => {
      const [x, y, w, hh] = rects[i], heat = heatOf(f.churn, maxC)
      parts.push(`<g data-file="${f.id}" tabindex="0" role="button" aria-label="${esc(f.shown)}, ${(f.size / 1024).toFixed(1)} KB, ${plural(f.churn, 'recent commit')}"><title>${esc(f.shown)}\n${(f.size / 1024).toFixed(1)} KB · ${plural(f.churn, 'recent commit')}</title><rect class="tile" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, hh).toFixed(1)}" fill="var(--heat${heat})"/>` +
        (w > 70 && hh > 18 ? `<text class="tlabel h${heat}" x="${(x + 5).toFixed(1)}" y="${(y + 14).toFixed(1)}">${esc(cut(short(f.path), Math.floor((w - 8) / 6.4)))}</text>` : '') + '</g>')
    })
    parts.push('</svg>')
    const box = h('div', { class: 'svgbox' })
    box.innerHTML = parts.join('')
    const open = (e) => { const g = e.target.closest('[data-file]'); if (g) select({ file: files.get(Number(g.dataset.file)) }) }
    box.addEventListener('click', open)
    box.addEventListener('keydown', (e) => { if (activate(e)) { e.preventDefault(); open(e) } })
    const sw = (k, t) => h('span', null, h('i', { class: 'swatch', style: `background:var(--heat${k})` }), ' ', t)
    const legend = maxC
      ? h('div', { class: 'legend' }, h('span', { class: 'muted' }, 'Area: file size. Colour: commits touching it among the last 400, sweeps of more than 25 files left out (log scale):'), sw(0, 'none'),
        heatBands(maxC).map(([b, lo, hi]) => sw(b, lo === hi ? String(lo) : `${lo}–${hi}`)))
      : h('p', { class: 'note' }, 'Area: file size. No git history is indexed, so colour says nothing about churn.')
    return h('div', null, box, legend)
  }
  function hotspots() {
    const ns = [...nodes.values()].filter(showSym)
    const fs = [...files.values()].filter(showFile)
    const resolved = (xs) => xs.filter(([m, c]) => !GUESS.has(c) && showSym(m)).length
    const guessed = (xs) => xs.filter(([m, c]) => GUESS.has(c) && showSym(m)).length
    const top = (xs, key, n = 20) => xs.map((x) => [x, key(x)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n)
    const symTable = (title, rows, col, side) => h('div', null, h('h2', null, title), h('table', null, h('tr', null, h('th', null, 'symbol'), h('th', null, 'where'), h('th', { class: 'n' }, col), h('th', { class: 'n' }, 'guesses')),
      rows.map(([n, v]) => h('tr', { class: 'click', onclick: () => select({ sym: n }) }, h('td', { class: 'name' }, n.name), h('td', { class: 'mono' }, loc(n)), h('td', { class: 'n' }, v), h('td', { class: 'n muted' }, guessed(n[side]))))))
    const fileTable = (title, rows, col) => h('div', null, h('h2', null, title), h('table', null, h('tr', null, h('th', null, 'file'), h('th', { class: 'n' }, col)),
      rows.map(([f, v]) => h('tr', { class: 'click', onclick: () => select({ file: f }) }, h('td', { class: 'mono' }, f.shown), h('td', { class: 'n' }, v)))))
    const co = D.cochange.filter(([repo]) => !st.repo || repo === st.repo).slice(0, 25)
    return h('section', null,
      h('p', { class: 'note' }, `Ranked by links resolved by syntax; name guesses (unique-name, ambiguous) are counted apart.${st.tests ? '' : ' Test code hidden.'}`),
      h('h2', null, 'Size and churn'), treemap(fs),
      h('div', { class: 'grid2' }, symTable('Most called', top(ns, (n) => resolved(n.callers)), 'callers', 'callers'), symTable('Widest fan-out', top(ns, (n) => resolved(n.callees)), 'callees', 'callees')),
      h('div', { class: 'grid2' }, fileTable('Most used files', top(fs, (f) => resolvedOf(f.in).length), 'files using it'), fileTable('Files using the most', top(fs, (f) => resolvedOf(f.out).length), 'files it uses')),
      h('h2', null, 'Change together (git history)'),
      co.length ? h('table', null, h('tr', null, h('th', null, 'repo'), h('th', null, 'file'), h('th', null, 'file'), h('th', { class: 'n' }, 'commits')), co.map(([r, a, b, n]) => h('tr', null, h('td', null, r), h('td', { class: 'mono' }, a), h('td', { class: 'mono' }, b), h('td', { class: 'n' }, n))))
        : h('p', { class: 'muted' }, 'No co-change data (no git history indexed).'))
  }

  // ── map: modules first ──
  function mapView() {
    const seg = h('div', { class: 'seg' },
      h('button', { 'data-ctl': 'mode-modules', 'aria-pressed': String(st.mapMode === 'modules'), onclick: () => { st.mapMode = 'modules'; st.module = null; render() } }, 'Modules'),
      h('button', { 'data-ctl': 'mode-files', 'aria-pressed': String(st.mapMode === 'files'), onclick: () => { st.mapMode = 'files'; render() } }, 'Files'))
    return st.mapMode === 'modules' ? systemView(seg) : fileMapView(seg)
  }
  function systemView(seg) {
    const lanes = D.repos.filter((r) => !st.repo || r.name === st.repo).map((r) => {
      const { shown, rest } = lanePick(modules.filter((m) => m.repo === r.name), LANE_MAX)
      return { repo: r.name, shown, rest, files: perRepo.get(r.name).files - perRepo.get(r.name).tests }
    }).filter((l) => l.shown.length)
    if (!lanes.length) return h('section', null, h('div', { class: 'toolbar' }, seg), h('p', { class: 'muted' }, 'No production code indexed for this selection.'))
    const laneW = 240, gapX = 90, boxW = 200, boxH = 34, rowGap = 16, top = 40, left = 50
    const W = left * 2 + lanes.length * laneW + (lanes.length - 1) * gapX
    const rowsMax = Math.max(...lanes.map((l) => l.shown.length + (l.rest ? 1 : 0)))
    const H = top + rowsMax * (boxH + rowGap) + 20
    const pos = new Map()
    lanes.forEach((l, li) => l.shown.forEach((m, ri) => pos.set(m.i, { x: left + li * (laneW + gapX) + (laneW - boxW) / 2, y: top + ri * (boxH + rowGap), lane: li, row: ri })))
    const shownLinks = S.links.filter(([a, b]) => pos.has(a) && pos.has(b))
    const maxN = Math.max(1, ...shownLinks.map((l) => l[2]))
    const drawn = lanes.reduce((a, l) => a + l.shown.length, 0), total = lanes.reduce((a, l) => a + l.shown.length + l.rest, 0)
    const parts = [`<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="System map: ${plural(drawn, 'module')} of ${total} in ${plural(lanes.length, 'repository lane')}, linked by how many files use each other">`,
      '<defs><marker id="sm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L8,4L0,8z" class="arrow"/></marker></defs>']
    lanes.forEach((l, li) => {
      const x = left + li * (laneW + gapX)
      parts.push(`<rect class="lane" x="${x}" y="${top - 12}" width="${laneW}" height="${(l.shown.length + (l.rest ? 1 : 0)) * (boxH + rowGap) + 8}" rx="10" opacity=".6"/>`,
        `<rect x="${x}" y="${top - 12}" width="${laneW}" height="3" fill="${repoColor.get(l.repo)}"/>`,
        `<text class="head" x="${x}" y="${top - 20}">${esc(l.repo.toUpperCase())} · ${esc(plural(l.files, 'FILE'))}</text>`)
    })
    const labels = []
    for (const [a, b, n] of shownLinks) {
      const A = pos.get(a), B = pos.get(b), sw = (1 + 6 * Math.sqrt(n / maxN)).toFixed(1)
      let d, lx, ly
      if (A.lane === B.lane) {
        const down = A.row < B.row, bend = 16 + 10 * Math.sqrt(Math.abs(B.row - A.row))
        const x = down ? A.x : A.x + boxW, s = down ? -1 : 1, y1 = A.y + boxH / 2 + (down ? 4 : -4), y2 = B.y + boxH / 2 + (down ? -4 : 4)
        d = `M${x},${y1} C${x + s * bend},${y1} ${x + s * bend},${y2} ${x + s * 3},${y2}`
        lx = x + s * (bend * 0.75 + 4); ly = (y1 + y2) / 2 + 4
      } else {
        const right = B.lane > A.lane, x1 = right ? A.x + boxW : A.x, x2 = right ? B.x - 3 : B.x + boxW + 3, y1 = A.y + boxH / 2, y2 = B.y + boxH / 2, k = (x2 - x1) / 2
        d = `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`
        lx = (x1 + x2) / 2; ly = (y1 + y2) / 2 - 4
      }
      parts.push(`<path class="mlink" data-a="${a}" data-b="${b}" stroke-width="${sw}" marker-end="url(#sm-arrow)" d="${d}"><title>${esc(modules[a].key)} uses ${esc(modules[b].key)}: ${plural(n, 'file pair')}</title></path>`)
      labels.push(`<text class="mcount" data-a="${a}" data-b="${b}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${A.lane === B.lane ? (A.row < B.row ? 'end' : 'start') : 'middle'}">${n}</text>`)
    }
    lanes.forEach((l, li) => {
      for (const m of l.shown) {
        const p = pos.get(m.i)
        parts.push(`<g data-mod="${m.i}" tabindex="0" role="button" aria-label="${esc(m.repo)} ${esc(m.key)}, ${plural(m.files, 'file')}, uses ${m.uses.size}, used by ${m.usedBy.size}: open its files"><title>${esc(m.repo)} · ${esc(m.key)}\n${plural(m.files, 'file')} · uses ${plural(m.uses.size, 'module')} · used by ${m.usedBy.size}\nclick for its files</title>` +
          `<rect class="box" x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="5"/><rect x="${p.x}" y="${p.y}" width="4" height="${boxH}" fill="${repoColor.get(m.repo)}"/>` +
          `<text x="${p.x + 12}" y="${p.y + 21}">${esc(cutL(m.key, 21))}</text><text class="sub" x="${p.x + boxW - 8}" y="${p.y + 21}" text-anchor="end">${m.files}</text></g>`)
      }
      if (l.rest) { const x = left + li * (laneW + gapX) + (laneW - boxW) / 2; parts.push(`<text class="sub" x="${x + 12}" y="${top + l.shown.length * (boxH + rowGap) + 18}">+${plural(l.rest, 'smaller module')}</text>`) }
    })
    parts.push(...labels, '</svg>')
    const box = h('div', { class: 'svgbox' })
    box.innerHTML = parts.join('')
    const svg = box.firstChild
    const light = (i) => {
      svg.classList.toggle('hot', i !== null)
      for (const el of svg.querySelectorAll('.on')) el.classList.remove('on')
      if (i === null) return
      const near = new Set([i])
      for (const el of svg.querySelectorAll('[data-a]')) if (el.dataset.a === String(i) || el.dataset.b === String(i)) { el.classList.add('on'); near.add(Number(el.dataset.a)); near.add(Number(el.dataset.b)) }
      for (const el of svg.querySelectorAll('[data-mod]')) if (near.has(Number(el.dataset.mod))) el.classList.add('on')
    }
    svg.addEventListener('mouseover', (e) => { const g = e.target.closest('[data-mod]'); light(g ? Number(g.dataset.mod) : null) })
    svg.addEventListener('focusin', (e) => { const g = e.target.closest('[data-mod]'); light(g ? Number(g.dataset.mod) : null) })
    svg.addEventListener('focusout', (e) => { if (!svg.contains(e.relatedTarget)) light(null) })
    svg.addEventListener('mouseleave', () => light(null))
    const open = (e) => { const g = e.target.closest('[data-mod]'); if (g) { openModule(Number(g.dataset.mod)); render() } }
    svg.addEventListener('click', open)
    svg.addEventListener('keydown', (e) => { if (activate(e)) { e.preventDefault(); open(e) } })
    return h('section', null, h('div', { class: 'toolbar' }, seg, h('span', { class: 'muted' }, `showing ${drawn} of ${plural(total, 'module')} · ${plural(shownLinks.length, 'link')} between them`)), box,
      h('p', { class: 'note' }, `A module is a folder of production code; a folder holding more than a third of its repository is split into its subfolders. Each lane draws its ${LANE_MAX} largest modules, in the order code flows: a module sits below the modules that use it. A line is a module using another, its width the number of file pairs linked by syntax. This map never shows test code or name guesses, whatever the toggles say. Arcs on the left go down a lane, arcs on the right go up it (a cycle). Hover a module for its links and counts, click it for its files.`))
  }

  // ── map: files (laid out once, drawn on a canvas) ──
  let drag = null
  window.addEventListener('mouseup', () => { drag = null })
  const M = D.map
  const mapFiles = M.files.map((id, i) => ({ f: files.get(id), x: M.pos[i][0], y: M.pos[i][1], deg: M.deg[i], r: 2.5 + Math.min(9, Math.sqrt(M.deg[i])), nb: new Map() }))
  for (const [a, b, , amb] of M.links) { mapFiles[a].nb.set(b, !!amb); mapFiles[b].nb.set(a, !!amb) }
  const byDeg = mapFiles.map((_, i) => i).sort((a, b) => mapFiles[b].deg - mapFiles[a].deg)
  function scopeOf(mi) { // a module's files and the files they link to by syntax
    if (mi === null || !modules[mi]) return null
    const ids = new Set()
    for (const f of modules[mi].list) { ids.add(f.id); for (const [g, v] of f.out) if (v[1]) ids.add(g.id); for (const [g, v] of f.in) if (v[1]) ids.add(g.id) }
    return ids
  }
  function fileMapView(seg) {
    const scope = scopeOf(st.module)
    const vis = (m) => showFile(m.f) && (!scope || scope.has(m.f.id))
    const shown = mapFiles.filter(vis), prod = shown.filter((m) => !m.f.test).length, tests = shown.length - prod
    const mod = st.module !== null ? modules[st.module] : null
    const wrap = h('div', { id: 'map' }), canvas = h('canvas', { role: 'img', 'aria-label': mod ? `File map of ${mod.key} and its neighbours` : 'File map' }), tip = h('div', { id: 'tip' })
    wrap.append(canvas, tip)
    const legend = h('div', { class: 'legend' }, D.repos.filter((r) => !st.repo || r.name === st.repo).map((r) => h('span', null, h('i', { style: `background:${repoColor.get(r.name)}` }), r.name)))
    const head = h('div', { class: 'toolbar' }, seg, mod
      ? h('span', null, 'Files of ', h('b', { class: 'mono' }, mod.key), ` (${mod.repo}, ${plural(mod.files, 'file')}) and the files they link to by syntax · `, h('a', { class: 'jump', onclick: () => { st.module = null; render() } }, 'all files'))
      : h('span', { class: 'muted' }, `${prod.toLocaleString()} of ${plural(st.repo ? M.totals[st.repo] || 0 : M.total, 'production file')}${tests ? `, and ${plural(tests, 'test file')} where room was left` : ''} · the ${D.mapMax.toLocaleString()} most connected at most`))
    const note = h('p', { class: 'note' }, `Grouped by directory · the biggest are named, hover for the rest · lines are imports and calls between files${st.guesses ? '' : ', ambiguous-only links hidden'} · drag to pan, scroll to zoom, click to open, double-click to reset`)
    const core = mod ? new Set(mod.list.map((f) => f.id)) : null
    requestAnimationFrame(() => drawMap(canvas, tip, vis, core ? (m) => core.has(m.f.id) : vis))
    return h('section', null, head, legend, wrap, note)
  }
  let resizeTimer = null
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (st.tab === 'map' && st.mapMode === 'files') render() }, 150) })
  function drawMap(canvas, tip, vis, fitTo) {
    if (!canvas.isConnected) return
    if (canvas.clientWidth < 50 || canvas.clientHeight < 50) return requestAnimationFrame(() => drawMap(canvas, tip, vis, fitTo)) // not laid out yet
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth, H = canvas.clientHeight
    canvas.width = W * dpr; canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    const css = getComputedStyle(document.documentElement)
    const col = (v) => css.getPropertyValue(v).trim()
    const linkShown = (amb) => st.guesses || !amb
    // fit what matters: a module's own files (its neighbours may run off the edge), else all shown
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const m of mapFiles) if (fitTo(m)) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x); y1 = Math.max(y1, m.y) }
    if (x0 === Infinity) { x0 = 0; y0 = 0; x1 = 1000; y1 = 1000 }
    const span = Math.max(80, x1 - x0, y1 - y0)
    const fitK = Math.min((W - 80) / span, (H - 80) / span)
    const fit = () => ({ k: fitK, x: W / 2 - ((x0 + x1) / 2) * fitK, y: H / 2 - ((y0 + y1) / 2) * fitK })
    const view = fit()
    let hover = -1
    const selIdx = () => (st.sel && st.sel.file ? mapFiles.findIndex((m) => m.f === st.sel.file) : -1)
    const sx = (x) => view.x + x * view.k, sy = (y) => view.y + y * view.k
    const groupsShown = M.groups.filter((g) => (!st.repo || g.key.startsWith(st.repo + ':')) && mapFiles.some((m) => vis(m) && Math.hypot(m.x - g.x, m.y - g.y) <= g.r))
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const focus = hover >= 0 ? hover : selIdx()
      const near = focus >= 0 ? mapFiles[focus].nb : null
      const isNear = (i) => !!near && near.has(i) && linkShown(near.get(i))
      // directories: a faint disc each (their names are drawn last, on top)
      for (const g of groupsShown) { ctx.beginPath(); ctx.arc(sx(g.x), sy(g.y), g.r * view.k, 0, Math.PI * 2); ctx.fillStyle = col('--hover'); ctx.fill() }
      ctx.lineWidth = 1
      ctx.strokeStyle = col('--edge')
      ctx.beginPath()
      for (const [a, b, , amb] of M.links) if (linkShown(amb) && vis(mapFiles[a]) && vis(mapFiles[b]) && (focus < 0 || (a !== focus && b !== focus))) { ctx.moveTo(sx(mapFiles[a].x), sy(mapFiles[a].y)); ctx.lineTo(sx(mapFiles[b].x), sy(mapFiles[b].y)) }
      ctx.stroke()
      if (focus >= 0) {
        ctx.strokeStyle = col('--accent'); ctx.lineWidth = 1.6; ctx.beginPath()
        for (const b of near.keys()) if (isNear(b) && vis(mapFiles[b])) { ctx.moveTo(sx(mapFiles[focus].x), sy(mapFiles[focus].y)); ctx.lineTo(sx(mapFiles[b].x), sy(mapFiles[b].y)) }
        ctx.stroke()
      }
      const zr = Math.max(0.7, Math.min(2.2, Math.sqrt(view.k / (1000 / Math.max(W, H)))))
      for (let i = 0; i < mapFiles.length; i++) {
        const m = mapFiles[i]
        if (!vis(m)) continue
        ctx.globalAlpha = focus >= 0 && i !== focus && !isNear(i) ? 0.18 : 1
        ctx.beginPath(); ctx.arc(sx(m.x), sy(m.y), m.r * zr, 0, Math.PI * 2)
        ctx.fillStyle = repoColor.get(m.f.repo) || '#888'; ctx.fill()
        if (i === focus) { ctx.lineWidth = 2; ctx.strokeStyle = col('--ink'); ctx.stroke() }
      }
      ctx.globalAlpha = 1
      // names: the focus and its neighbours always; otherwise the most connected files first, as
      // many as fit without overlapping (more appear as you zoom in). Directory names go first.
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
        const t = short(m.f.path), w = ctx.measureText(t).width, x = sx(m.x) + m.r * zr + 4, y = sy(m.y)
        if (x > W || y < 0 || y > H || x + w < 0) return
        const b = [x - 2, y - 8, x + w + 2, y + 8]
        if (!strong && boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return
        boxes.push(b)
        ctx.lineWidth = 3; ctx.strokeStyle = col('--panel'); ctx.strokeText(t, x, y)
        ctx.fillStyle = col('--ink'); ctx.globalAlpha = strong || focus < 0 ? 1 : 0.35; ctx.fillText(t, x, y); ctx.globalAlpha = 1
      }
      if (focus >= 0) { place(focus, true); for (const j of near.keys()) if (isNear(j)) place(j, true) }
      const budget = Math.min(400, Math.round(30 * (view.k / fitK) ** 1.5))
      for (let r = 0, n = 0; r < byDeg.length && n < budget; r++) { const i = byDeg[r]; if (i === focus || isNear(i)) continue; const before = boxes.length; place(i, false); if (boxes.length > before) n++ }
      ctx.font = '600 12px ui-sans-serif,system-ui,sans-serif'
      for (const [t, x, y] of dirLabels) { ctx.lineWidth = 4; ctx.strokeStyle = col('--panel'); ctx.strokeText(t, x, y); ctx.fillStyle = col('--muted'); ctx.fillText(t, x, y) }
    }
    let queued = false
    const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw() }) }
    draw()
    const hit = (e) => {
      const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, zr = Math.max(0.7, Math.min(2.2, Math.sqrt(view.k / (1000 / Math.max(W, H)))))
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
      if (i >= 0) { const m = mapFiles[i]; tip.textContent = `${m.f.shown} · used by ${resolvedOf(m.f.in).length} · uses ${resolvedOf(m.f.out).length} (linked by syntax)`; tip.style.display = 'block'; tip.style.left = `${Math.min(e.clientX - b.left + 14, W - tip.offsetWidth - 8)}px`; tip.style.top = `${e.clientY - b.top + 14}px` } else tip.style.display = 'none'
    })
    canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; redraw() } tip.style.display = 'none' })
    canvas.addEventListener('click', (e) => { if (moved) return; const i = hit(e); if (i >= 0) select({ file: mapFiles[i].f }) })
    canvas.addEventListener('dblclick', () => { Object.assign(view, fit()); redraw() })
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const b = canvas.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top
      const k = Math.min(fitK * 30, Math.max(fitK * 0.5, view.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)))
      view.x = mx - ((mx - view.x) / view.k) * k; view.y = my - ((my - view.y) / view.k) * k; view.k = k
      redraw()
    }, { passive: false })
  }

  // ── shell ──
  let search = null
  function header() {
    search = search || h('input', { type: 'search', 'data-ctl': 'search', placeholder: 'Search files or symbols…', 'aria-label': 'Search files or symbols', oninput: (e) => { st.q = e.target.value; if (st.tab !== 'files' && st.tab !== 'symbols') st.tab = 'symbols'; render(true) } })
    const repoSel = h('select', { 'data-ctl': 'repo', 'aria-label': 'Repository', onchange: (e) => { st.repo = e.target.value; st.sel = null; st.module = null; render() } }, h('option', { value: '' }, 'all repositories'), D.repos.map((r) => h('option', { value: r.name }, r.name)))
    repoSel.value = st.repo
    const tog = (key, label) => h('label', { class: 'tog' }, h('input', { type: 'checkbox', 'data-ctl': `tog-${key}`, checked: st[key] ? 'checked' : null, onchange: (e) => { st[key] = e.target.checked; render() } }), label)
    return h('header', null, h('h1', null, 'Code graph'),
      h('nav', null, TABS.map(([id, label]) => h('button', { 'data-ctl': `tab-${id}`, 'aria-pressed': String(st.tab === id), onclick: () => { st.tab = id; render() } }, label))),
      D.repos.length > 1 ? repoSel : null, search, tog('tests', 'Test code'), tog('guesses', 'Ambiguous links'),
      h('span', { class: 'muted' }, `generated ${D.generatedAt.slice(0, 16).replace('T', ' ')} UTC · a map, not the code: read it at the path:line`))
  }
  function render(keepFocus) {
    // the header is rebuilt: hand keyboard focus back to the control that had it
    const ctl = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ctl : null
    const view = { overview, map: mapView, files: filesView, symbols, hotspots }[st.tab]()
    const hd = header()
    document.body.replaceChildren(hd, h('main', null, view))
    document.documentElement.style.setProperty('--hdr', `${hd.offsetHeight + 12}px`)
    writeHash()
    if (keepFocus) { search.focus(); const n = search.value.length; search.setSelectionRange(n, n) }
    else if (ctl) { const el = document.querySelector(`[data-ctl="${ctl}"]`); if (el) el.focus() }
  }
  readHash()
  render()
}
