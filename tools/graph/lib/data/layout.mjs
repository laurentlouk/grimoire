// grimoire graph · data · the Data tab's ERD layout. Deterministic: the same tables always give the
// same coordinates (no randomness, no animation, ties broken by name, never by input order).
// render.mjs lays every store out here, once per render; both functions are also injected into the
// page as they are (like render.mjs's pure helpers), so the page draws a box with the very geometry
// this sized it with, and lays out the subsets a large store shows on focus or search the same way.
// Each must stay self-contained: no imports, no module-level names.
//
// A table is the page's packed shape (render.mjs dataData): { name, kind, fields: [{ name, type,
// nullable, pk, fk, cf }], keys: [{ role, parts, cf }], indexes: [{ name, unique, columns, partial,
// cf }], rels: [{ columns, to, toColumns, cf }], cf }, every cf a conflict { attr, values: [{ value }] }.

// One table's box: its size and, unless collapsed (a name only), the rows it draws: a row per column,
// then a row per unique key and per declared index, each followed by a conflict badge line when the
// declarations disagree about it (the badge names both values). Offsets are from the box's top left.
//   → { w, h, collapsed, name, view, sub?, conflicts, head: badge | null, rows: [{ kind: field | unique |
//       index, i, y, name?, type?, text?, pk?, fk?, nullable?, badge }], fieldY: [y], divider: y | null }
//   a badge: { y, text, cf: [[prefix, conflict]] }   (names and texts cut to fit; the full ones stay in
//   the table, and the page's tooltips cite each conflict's sources)
export function erdBox(t, collapsed) {
  const CW = 7.2, TW = 6.6, XW = 6.6, BW = 6.3, HW = 7.6, HEAD = 30, ROW = 20, XROW = 18, BADGE = 17, MIN = 200, MAX = 460
  const cutS = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
  const fields = t.fields || [], keys = t.keys || [], indexes = t.indexes || [], rels = t.rels || []
  const view = t.kind === 'view'
  const all = [...(t.cf || []), ...fields.flatMap((f) => f.cf || []), ...keys.flatMap((k) => k.cf || []), ...indexes.flatMap((x) => x.cf || []), ...rels.flatMap((r) => r.cf || [])]
  if (collapsed) { // the name (after the table glyph), then the column count, a conflict count, a view pill
    const sub = `${fields.length} col${fields.length === 1 ? '' : 's'}`
    const side = 22 + sub.length * BW + (all.length ? 34 : 0) + (view ? 44 : 0)
    const w = Math.ceil(Math.min(300, Math.max(130, 30 + Math.min(32, t.name.length) * HW + side)))
    return { w, h: HEAD, collapsed: true, name: cutS(t.name, Math.floor((w - 30 - side) / HW)), view, sub, conflicts: all.length, head: null, rows: [], fieldY: [], divider: null }
  }
  // what the declarations disagree about, as a badge naming every value; each conflict goes on the
  // row of its element (a primary key's or a foreign key's on its first column), else the header's
  const val = (attr, v) => (attr === 'nullable' ? (v ? 'null' : 'not null') : attr === 'unique' ? (v ? 'unique' : 'not unique') : attr === 'partial' ? (v ? 'partial' : 'whole') : v === null || v === undefined || v === '' ? 'none' : String(v))
  const LABEL = { default: 'default', generated: 'generated', columns: 'columns', onDelete: 'on delete', onUpdate: 'on update' }
  const say = ([pre, c]) => `${pre}${LABEL[c.attr] ? `${LABEL[c.attr]}: ` : ''}${c.values.map((v) => val(c.attr, v.value)).join(' ≠ ')}`
  const own = (list) => (list || []).map((c) => ['', c])
  const head = own(t.cf)
  const byField = new Map(fields.map((f, i) => [f.name, i]))
  const onRow = fields.map((f) => own(f.cf))
  const attach = (col, pre, list) => { if (!list || !list.length) return; const i = byField.get(col); (i === undefined ? head : onRow[i]).push(...list.map((c) => [pre, c])) }
  for (const k of keys) if (k.role === 'primary') attach(k.parts[0], 'primary key: ', k.cf)
  for (const r of rels) attach(r.columns[0], `foreign key → ${r.to}: `, r.cf)
  const extra = [
    ...keys.map((k, i) => [k, i]).filter(([k]) => k.role !== 'primary').map(([k, i]) => ({ kind: 'unique', i, text: `${k.role} (${k.parts.join(', ')})`, badge: own(k.cf) })),
    ...indexes.map((x, i) => ({ kind: 'index', i, text: `${x.unique ? 'unique index' : 'index'} ${x.name} (${x.columns.join(', ')})${x.partial ? ' partial' : ''}`, badge: own(x.cf) })),
  ]
  const typeMax = Math.min(24, Math.max(0, ...fields.map((f) => String(f.type || '').length)))
  const nameMax = Math.min(30, Math.max(0, ...fields.map((f) => f.name.length)))
  const badges = [head, ...onRow, ...extra.map((x) => x.badge)].filter((b) => b.length).map((b) => b.map(say).join('; '))
  const w = Math.ceil(Math.min(MAX, Math.max(MIN,
    40 + Math.min(40, t.name.length) * HW + (view ? 50 : 0),
    43 + nameMax * CW + 16 + typeMax * TW + 26,
    42 + Math.min(52, Math.max(0, ...extra.map((x) => x.text.length))) * XW,
    48 + Math.min(60, Math.max(0, ...badges.map((b) => b.length))) * BW)))
  const badge = (list, y) => (list.length ? { y, text: cutS(list.map(say).join('; '), Math.floor((w - 48) / BW)), cf: list } : null)
  let y = HEAD
  const hb = badge(head, y)
  if (hb) y += BADGE
  const rows = [], fieldY = []
  fields.forEach((f, i) => {
    const type = cutS(String(f.type || ''), 24)
    const b = badge(onRow[i], y + ROW)
    rows.push({ kind: 'field', i, y, name: cutS(f.name, Math.max(4, Math.floor((w - 43 - 16 - type.length * TW - 26) / CW))), type, pk: !!f.pk, fk: !!f.fk, nullable: f.nullable, badge: b })
    fieldY.push(y + ROW / 2)
    y += ROW + (b ? BADGE : 0)
  })
  const divider = extra.length ? y + 3 : null
  if (extra.length) y += 6
  for (const x of extra) {
    const b = badge(x.badge, y + XROW)
    rows.push({ kind: x.kind, i: x.i, y, text: cutS(x.text, Math.floor((w - 42) / XW)), badge: b })
    y += XROW + (b ? BADGE : 0)
  }
  return { w, h: y + 6, collapsed: false, name: cutS(t.name, Math.floor((w - 40 - (view ? 50 : 0)) / HW)), view, conflicts: all.length, head: hb, rows, fieldY, divider }
}

// Every table of a store placed, every foreign key routed. Tables linked by foreign keys form a
// group; inside it, a table sits left of the tables that reference it (a column per step, cycles
// broken where a depth-first walk meets them), a table only referenced moves next to its nearest
// referrer, and the order inside each column is swept by barycentre to cut crossings. Groups are
// packed largest first, row after row; tables with no foreign key come last, by name. A line runs
// from the referencing column (the many side) to the referenced column (the one side), or to the
// table's header when that column is not drawn.
//   → { boxes: [{ x, y, w, h }] in the input's order, links: [{ from, to, k, d }] (from: the
//       referencing table, k: its relation), W, H, collapsed }
export function layoutErd(tables, opts = {}) {
  const collapsed = !!opts.collapsed
  const GX = collapsed ? 56 : 96, GY = collapsed ? 14 : 28, GC = collapsed ? 40 : 64, M = 24
  const n = tables.length
  const order = tables.map((_, i) => i).sort((a, b) => (tables[a].name < tables[b].name ? -1 : tables[a].name > tables[b].name ? 1 : a - b))
  const rk = new Array(n)
  order.forEach((i, r) => { rk[i] = r })
  const byRk = (a, b) => rk[a] - rk[b]
  const byName = new Map()
  for (const i of order) if (!byName.has(tables[i].name)) byName.set(tables[i].name, i)
  const geo = tables.map((t) => erdBox(t, collapsed))
  const kids = tables.map(() => []), pars = tables.map(() => [])
  for (const i of order) for (const r of tables[i].rels || []) { const p = byName.get(r.to); if (p !== undefined && p !== i && !kids[p].includes(i)) { kids[p].push(i); pars[i].push(p) } }
  for (const l of kids) l.sort(byRk)
  for (const l of pars) l.sort(byRk)
  // groups: tables linked by foreign keys, either way
  const comp = new Array(n).fill(-1), comps = []
  for (const s of order) {
    if (comp[s] >= 0) continue
    const list = [s]
    comp[s] = comps.length
    for (let q = 0; q < list.length; q++) for (const v of [...pars[list[q]], ...kids[list[q]]]) if (comp[v] < 0) { comp[v] = comps.length; list.push(v) }
    comps.push(list.sort(byRk))
  }
  // columns: the longest path from a referenced table, back edges (a cycle) left out
  const state = new Array(n).fill(0), back = new Set()
  for (const s of order) {
    if (state[s]) continue
    const stack = [[s, 0]]
    state[s] = 1
    while (stack.length) {
      const top = stack[stack.length - 1], u = top[0]
      if (top[1] < kids[u].length) { const v = kids[u][top[1]++]; if (state[v] === 1) back.add(`${u}>${v}`); else if (!state[v]) { state[v] = 1; stack.push([v, 0]) } }
      else { state[u] = 2; stack.pop() }
    }
  }
  const indeg = new Array(n).fill(0)
  for (let u = 0; u < n; u++) for (const v of kids[u]) if (!back.has(`${u}>${v}`)) indeg[v]++
  const rank = new Array(n).fill(0), queue = order.filter((u) => !indeg[u])
  for (let q = 0; q < queue.length; q++) { const u = queue[q]; for (const v of kids[u]) if (!back.has(`${u}>${v}`)) { rank[v] = Math.max(rank[v], rank[u] + 1); if (!--indeg[v]) queue.push(v) } }
  for (const u of order) if (!pars[u].length && kids[u].length) rank[u] = Math.max(0, Math.min(...kids[u].map((v) => rank[v])) - 1)
  // each group laid out on its own, then packed
  const local = new Array(n)
  const blocks = comps.map((list) => {
    const cols = new Map()
    for (const i of list) { if (!cols.has(rank[i])) cols.set(rank[i], []); cols.get(rank[i]).push(i) }
    const ks = [...cols.keys()].sort((a, b) => a - b)
    const pos = new Map()
    for (const k of ks) cols.get(k).forEach((i, p) => pos.set(i, p))
    for (let sweep = 0; sweep < 4; sweep++) {
      for (const k of sweep % 2 ? ks.slice().reverse() : ks) {
        const key = new Map(cols.get(k).map((i) => { const nb = sweep % 2 ? kids[i] : pars[i]; return [i, nb.length ? nb.reduce((a, j) => a + pos.get(j), 0) / nb.length : pos.get(i)] }))
        cols.get(k).sort((a, b) => key.get(a) - key.get(b) || rk[a] - rk[b]).forEach((i, p) => pos.set(i, p))
      }
    }
    const heights = ks.map((k) => cols.get(k).reduce((a, i) => a + geo[i].h, 0) + GY * (cols.get(k).length - 1))
    const H = Math.max(...heights)
    let x = 0
    ks.forEach((k, c) => {
      const w = Math.max(...cols.get(k).map((i) => geo[i].w))
      let y = (H - heights[c]) / 2
      for (const i of cols.get(k)) { local[i] = [x + (w - geo[i].w) / 2, y]; y += geo[i].h + GY }
      x += w + GX
    })
    return { list, w: x - GX, h: H }
  })
  const packed = blocks.slice().sort((a, b) => (b.list.length > 1) - (a.list.length > 1) || b.list.length - a.list.length || rk[a.list[0]] - rk[b.list[0]])
  const area = packed.reduce((a, b) => a + (b.w + GC) * (b.h + GC), 0)
  const TW = Math.max(opts.width || 1100, ...packed.map((b) => b.w), Math.sqrt(area * 1.9)) // a row as wide as a page at least
  const boxes = new Array(n)
  let cx = 0, cy = 0, shelf = 0
  for (const b of packed) {
    if (cx > 0 && cx + b.w > TW) { cx = 0; cy += shelf + GC; shelf = 0 }
    for (const i of b.list) boxes[i] = { x: Math.round(M + cx + local[i][0]), y: Math.round(M + cy + local[i][1]), w: geo[i].w, h: geo[i].h }
    cx += b.w + GC
    shelf = Math.max(shelf, b.h)
  }
  const at = (i, col) => { const f = (tables[i].fields || []).findIndex((x) => x.name === col); return f >= 0 && geo[i].fieldY[f] !== undefined ? geo[i].fieldY[f] : 15 }
  const r1 = (v) => Math.round(v * 10) / 10
  const links = []
  for (const i of order) {
    (tables[i].rels || []).forEach((r, k) => {
      const p = byName.get(r.to)
      if (p === undefined) return
      const A = boxes[i], B = boxes[p], y1 = A.y + at(i, r.columns[0])
      let y2 = B.y + at(p, r.toColumns[0]), d
      if (p === i) { // a table referencing itself: a loop on its right
        if (y2 === y1) y2 += 10
        const x = A.x + A.w, b = 30
        d = `M${x},${r1(y1)} C${x + b},${r1(y1)} ${x + b},${r1(y2)} ${x},${r1(y2)}`
      } else if (B.x + B.w <= A.x) { // the referenced table on the left: from the left edge to its right
        const x1 = A.x, x2 = B.x + B.w, c = Math.max(30, (x1 - x2) / 2)
        d = `M${x1},${r1(y1)} C${r1(x1 - c)},${r1(y1)} ${r1(x2 + c)},${r1(y2)} ${x2},${r1(y2)}`
      } else if (A.x + A.w <= B.x) { // on the right (a cycle's back edge)
        const x1 = A.x + A.w, x2 = B.x, c = Math.max(30, (x2 - x1) / 2)
        d = `M${x1},${r1(y1)} C${r1(x1 + c)},${r1(y1)} ${r1(x2 - c)},${r1(y2)} ${x2},${r1(y2)}`
      } else { // in the same column: around the right side
        const x1 = A.x + A.w, x2 = B.x + B.w, xm = Math.max(x1, x2) + Math.min(80, 30 + Math.abs(y2 - y1) / 10)
        d = `M${x1},${r1(y1)} C${r1(xm)},${r1(y1)} ${r1(xm)},${r1(y2)} ${x2},${r1(y2)}`
      }
      links.push({ from: i, to: p, k, d })
    })
  }
  const W = Math.max(M * 2 + 100, ...boxes.map((b) => b.x + b.w + M + 60)), H = Math.max(M * 2 + 40, ...boxes.map((b) => b.y + b.h + M))
  return { boxes, links, W: Math.ceil(W), H: Math.ceil(H), collapsed }
}
