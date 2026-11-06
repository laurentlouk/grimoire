// grimoire graph · the page's Data tab. Runs in the browser only: render.mjs injects this function's
// source next to the page's helpers (esc, plural, erdBox, layoutErd) and calls it with the page's
// context. The stores arrive reconciled and laid out (render.mjs dataData, data/layout.mjs): this
// draws an ERD per SQL store (tables with their columns, keys, indexes and conflicts, a line per
// foreign key), searches table and column names, focuses a table (it and its foreign key neighbours
// lit, its passport beside: every column with the files that declare it), and lists what was found
// but not read. A store of more than 60 tables starts as names only: a focus or a search draws the
// tables it concerns with their columns, laid out by the same function render.mjs used.
//
// The change overlay (render.mjs dataData packs it against the base, in Node): a toggle "Changes vs
// <base>", off by default and absent when no base resolved (the tab says why). On, a store that
// changed is drawn from its overlay tables and layout: added elements green, removed ones struck in
// red (a removed table as a ghost box among its foreign key neighbours), modified ones amber with
// before → after on their row and in the passport, possible renames linked (tables by a dashed line,
// columns and indexes by a bracket beside their rows), never decided. Base sources are cited as text.
//
// The delta overlay (render.mjs packDelta, in Node): a toggle "Delta", and a picker when several
// deltas sit beside the specs. On, the store is drawn from the delta's overlay tables and layout:
// a proposed table as a dashed ghost box among the others, a proposed column, key or index as a
// dashed row, a proposed removal struck in amber dashes, a proposed change with what it proposes;
// what is planned and built solid green, what is built differently amber with planned → built,
// what the branch changed and no change covers in its own colour, "not in the plan"; a stale
// acknowledgement badged. Each change lists its why, slice and acknowledgement (who, when) in the
// store's list and in its table's passport. Served (graph.mjs serve), each change can be
// acknowledged, or acknowledged no more, and so can every change of a store not acknowledged yet:
// the server writes the file (serve.mjs, PUT /api/delta); a static page stays read-only.
export function dataClient(ctx) {
  const { D, h, st, render, activate, stage, nav } = ctx
  const DD = D.data || { stores: [], unread: [], failed: [] }
  const S = DD.stores || []
  const CH = DD.changes || { base: null, why: null }
  const REF = CH.base ? CH.base.ref : ''
  const DL = DD.deltas || [], SERVE = D.serve || null
  if (st.deltaSel === null || st.deltaSel === undefined || !DL[st.deltaSel]) st.deltaSel = DL[DD.delta] ? DD.delta : 0
  const delta = () => (st.dataDelta && DL[st.deltaSel] && !DL[st.deltaSel].errors.length ? DL[st.deltaSel] : null)
  // what a delta mark says: its legend word, and the class of a change's state
  const DSAY = { prop: 'proposed', rm: 'proposed removal', pend: 'proposed change', built: 'planned and built', diff: 'built differently', unpl: 'not in the plan' }
  const STATE = { 'planned-built': ['built', 'planned and built'], pending: ['pending', 'pending'], 'built-differently': ['diff', 'built differently'] }
  const SUB_MAX = 40 // tables a search draws with their columns, in a store that starts collapsed
  const ZMIN = 0.2, ZMAX = 3
  const memo = new Map(), overlays = new Map()
  const lower = (s) => String(s).toLowerCase()
  const CLS = { added: 'add', removed: 'del', modified: 'mod' }
  const SINCE = { added: `added since ${REF}`, removed: `removed since ${REF}`, modified: `modified since ${REF}` }
  // the store as drawn: its overlay tables and layout while an overlay is on
  const shownStore = (n) => {
    const s = S[n], d = delta(), o = d && d.stores[n]
    if (o) {
      const k = `d${st.deltaSel}:${n}`
      if (!overlays.has(k)) overlays.set(k, { ...s, tables: o.tables.map((t) => (typeof t === 'number' ? s.tables[t] : t)), layout: o.layout, dv: true, dl: o, delta: d })
      return overlays.get(k)
    }
    if (!st.dataChanges || !s.ch) return s
    if (!overlays.has(`c${n}`)) overlays.set(`c${n}`, { ...s, tables: s.ch.tables.map((t) => (typeof t === 'number' ? s.tables[t] : t)), layout: s.ch.layout, ov: true })
    return overlays.get(`c${n}`)
  }
  // a delta mark's class, its stale acknowledgement, and what it says on hover
  const stale = (s, x) => !!(s.dv && x.dl && x.dl.c.some((k) => s.delta.changes[k].ack === 'stale'))
  const dcls = (s, x) => (s.dv && x.dl ? ` d-${x.dl.s}${x.dl.gone ? ' gone' : ''}${stale(s, x) ? ' stale' : ''}` : '')
  const struckD = (s, x) => !!(s.dv && x.dl && (x.dl.s === 'rm' || x.dl.gone))
  const dTip = (s, x) => (s.dv && x.dl ? `\n${x.dl.gone && x.dl.s === 'built' ? 'removed as planned' : x.dl.gone ? 'removed, not in the plan' : DSAY[x.dl.s]}${x.dl.c.map((k) => { const c = s.delta.changes[k]; return `\n${c.text}\nwhy: ${c.why}${c.slice !== null ? ` · slice ${c.slice}` : ''}${c.ack === 'stale' ? '\nacknowledgement stale: edited since' : c.ack ? `\nacknowledged by ${c.by}` : ''}` }).join('')}${x.dl.gone && x.bsrc && x.bsrc.length ? `\nat the base: ${x.bsrc.map((p) => bsrcText(s, p)).join(' · ')}` : ''}` : '')

  // ── sources: a link to the file in the Files tab when it is indexed, else path:line as text ──
  const srcText = (s, p) => { const [shown] = s.paths[p[0]]; return p[1] ? `${shown}:${p[1]}` : shown }
  const srcEl = (s, p) => { const [, file, kind] = s.paths[p[0]], t = srcText(s, p); return file >= 0 ? h('a', { class: 'jump mono', href: `#file-${file}`, title: kind ? `${kind}: open the file` : 'open the file' }, t) : h('code', { title: kind || null }, t) }
  const srcs = (s, list) => (list.length ? h('span', { class: 'srcs' }, list.flatMap((p, k) => (k ? [' · ', srcEl(s, p)] : [srcEl(s, p)]))) : h('span', { class: 'muted' }, 'no source'))
  // the base's sources: its lines, not the working tree's, so text, never a link to the file
  const bsrcText = (s, p) => `${(s.dv ? s.dl : s.ch).bpaths[p[0]]}${p[1] ? `:${p[1]}` : ''}`
  const bsrcs = (s, list) => h('span', { class: 'srcs' }, (list || []).flatMap((p, k) => [k ? ' · ' : null, h('code', { title: `at the base: ${CH.base ? CH.base.text : ''}` }, bsrcText(s, p))]))
  const val = (attr, v) => (attr === 'nullable' ? (v ? 'nullable' : 'not null') : attr === 'unique' ? (v ? 'unique' : 'not unique') : attr === 'partial' ? (v ? 'partial' : 'whole') : v === null || v === undefined || v === '' ? 'none' : String(v))
  const cfTip = (s, c) => `${c.attr}: ${c.values.map((v) => `${val(c.attr, v.value)} — ${v.src.map((p) => `${srcText(s, p)}${s.paths[p[0]][2] ? ` [${s.paths[p[0]][2]}]` : ''}`).join(' · ')}`).join(' | ')}`

  // ── what a store draws: its tables, a focus with its neighbours, or a search's matches ──
  const neighbours = (s, ti) => {
    const out = new Set()
    if (ti < 0) return out
    const t = s.tables[ti]
    s.tables.forEach((o, i) => { if (i !== ti && (t.rels.some((r) => r.to === o.name) || o.rels.some((r) => r.to === t.name))) out.add(i) })
    return out
  }
  const layoutOf = (s, n, list, collapsed) => {
    const key = `${n}|${s.ov ? 1 : s.dv ? `d${st.deltaSel}` : 0}|${collapsed ? 1 : 0}|${list.join(',')}`
    if (!memo.has(key)) { if (memo.size > 60) memo.clear(); memo.set(key, layoutErd(list.map((i) => s.tables[i]), { collapsed })) }
    return memo.get(key)
  }
  function scene(s, n) {
    const all = s.tables.map((_, i) => i)
    const q = lower(st.q.trim())
    const sel = st.dataSel === null ? -1 : s.tables.findIndex((t) => t.name === st.dataSel)
    const near = neighbours(s, sel)
    const colHit = (f) => !!q && lower(f.name).includes(q)
    const match = q ? all.filter((i) => lower(s.tables[i].name).includes(q) || s.tables[i].fields.some(colHit)) : []
    if (!s.collapsed) return { mode: 'all', list: all, L: s.layout, names: false, q, sel, near, match, colHit }
    if (sel >= 0) { const list = [sel, ...near].sort((a, b) => a - b); return { mode: 'focus', list, L: layoutOf(s, n, list, false), names: false, q, sel, near, match, colHit } }
    if (q) { const list = match.slice(0, SUB_MAX); return { mode: 'search', list, L: layoutOf(s, n, list, false), names: false, q, sel, near, match, colHit } }
    if (st.dataAll) return { mode: 'columns', list: all, L: layoutOf(s, n, all, false), names: false, q, sel, near, match, colHit }
    return { mode: 'names', list: all, L: s.layout, names: true, q, sel, near, match, colHit }
  }

  // natural size by default; Fit shows it all (at full size, the window less the passport beside it)
  const zoomOf = (L) => {
    if (st.dataZoom !== 'fit') return st.dataZoom || 1
    if (st.full === 'data') {
      const vw = window.innerWidth || 1400, w = vw - 48 - (st.dataSel !== null ? Math.min(420, vw * 0.38) + 12 : 0), hgt = (window.innerHeight || 900) - 48
      return Math.min(2, Math.max(ZMIN, Math.min(w / (L.W + 8), hgt / (L.H + 8))))
    }
    return Math.min(1, Math.max(ZMIN, ((document.getElementById('data-box') || {}).clientWidth || 1100) / (L.W + 8)))
  }
  function rerender(keep = true) {
    const b = document.getElementById('data-box')
    st.dataScroll = keep && b ? [b.scrollLeft, b.scrollTop] : null
    render()
  }

  // ── the ERD ──
  // what a change says on hover: since when, before → after, where it stood at the base
  const chTip = (s, x) => (s.ov && x.ch ? `\n${SINCE[x.ch]}${x.was ? `: ${x.was.join('; ')}` : ''}${x.bsrc && x.bsrc.length ? ` (at the base: ${x.bsrc.map((p) => bsrcText(s, p)).join(' · ')})` : ''}${x.ren !== null && x.ren !== undefined ? `\n${s.ch.renames[x.ren].text}` : ''}` : '')
  function table(s, ti, b, g, cls, sc) {
    const t = s.tables[ti], { x, y, w } = b
    const fkTo = new Map()
    for (const r of t.rels) r.columns.forEach((c, j) => { if (!fkTo.has(c)) fkTo.set(c, `${r.to} (${r.toColumns[j] || r.toColumns[0] || '?'})`) })
    const ov = s.ov && t.ch ? ` ${CLS[t.ch]}${t.ch === 'removed' ? ' ghost' : ''}` : ''
    const dv = dcls(s, t)
    const label = `${t.name}, ${t.kind}, ${plural(t.fields.length, 'column')}${g.conflicts ? `, ${plural(g.conflicts, 'conflict')}` : ''}${ov ? `, ${SINCE[t.ch]}` : ''}${dv ? `, ${t.dl.gone && t.dl.s === 'built' ? 'removed as planned' : t.dl.gone ? 'removed, not in the plan' : DSAY[t.dl.s]}${stale(s, t) ? ', acknowledgement stale' : ''}` : ''}: open its passport`
    const tip = `${t.name} · ${t.kind} · ${plural(t.fields.length, 'column')}${t.indexes.length ? ` · ${t.indexes.length} ${t.indexes.length === 1 ? 'index' : 'indexes'}` : ''}${g.conflicts ? `\n${plural(g.conflicts, 'conflict')}: the declarations disagree` : ''}${chTip(s, t)}${dTip(s, t)}${sc.names ? '\nclick to draw it with its columns and neighbours' : ''}`
    const out = [`<g class="tbl${t.kind === 'view' ? ' tview' : ''}${ov}${dv}${cls}" data-tbl="${ti}" tabindex="0" role="button" aria-label="${esc(label)}"><title>${esc(tip)}</title>`]
    const glyph = `<path class="tglyph" d="M${x + 11},${y + 10}h13v10h-13z M${x + 11},${y + 13.5}h13 M${x + 15.5},${y + 13.5}v6.5"/>`
    const struck = (s.ov && t.ch === 'removed') || struckD(s, t) ? `<line class="strike${s.dv ? ` d-${t.dl.s}` : ''}" x1="${x + 28}" x2="${Math.round(x + 32 + Math.min(g.name.length * 7.6, w - 44))}" y1="${y + 15.5}" y2="${y + 15.5}"/>` : ''
    // a stale acknowledgement: a badge beside the row or the header it concerns (outside the box)
    const staleMark = (cy) => `<g class="stalemk"><circle cx="${x + w + 10}" cy="${cy}" r="6.5"/><text x="${x + w + 10}" y="${cy + 3.5}" text-anchor="middle">!</text><title>acknowledgement stale: the change was edited after it was acknowledged</title></g>`
    if (g.collapsed) {
      out.push(`<rect class="tframe thead" x="${x}" y="${y}" width="${w}" height="${b.h}" rx="9"/>`, glyph, `<text class="tname" x="${x + 30}" y="${y + 19.5}">${esc(g.name)}</text>`, struck, stale(s, t) ? staleMark(y + 15) : '')
      let rx = x + w - 10
      out.push(`<text class="tcount" x="${rx}" y="${y + 19.5}" text-anchor="end">${esc(g.sub)}</text>`)
      rx -= g.sub.length * 6.3 + 8
      if (g.conflicts) { out.push(`<g class="cf"><rect class="cfbg" x="${rx - 28}" y="${y + 7}" width="28" height="16" rx="8"/><text class="cft" x="${rx - 14}" y="${y + 19}" text-anchor="middle">≠${g.conflicts}</text></g>`); rx -= 34 }
      if (g.view) out.push(`<g class="tpill"><rect x="${rx - 36}" y="${y + 7}" width="36" height="16" rx="8"/><text x="${rx - 18}" y="${y + 19}" text-anchor="middle">view</text></g>`)
      return `${out.join('')}</g>`
    }
    out.push(`<rect class="tframe" x="${x}" y="${y}" width="${w}" height="${b.h}" rx="9"/>`,
      `<path class="thead" d="M${x + 0.6},${y + 30}V${y + 9}Q${x + 0.6},${y + 0.6} ${x + 9},${y + 0.6}H${x + w - 9}Q${x + w - 0.6},${y + 0.6} ${x + w - 0.6},${y + 9}V${y + 30}Z"/>`,
      `<line class="tsep" x1="${x}" x2="${x + w}" y1="${y + 30}" y2="${y + 30}"/>`, glyph,
      `<text class="tname" x="${x + 30}" y="${y + 20}">${esc(g.name)}</text>`, struck, stale(s, t) ? staleMark(y + 15) : '')
    if (g.view) out.push(`<g class="tpill"><rect x="${x + w - 46}" y="${y + 7}" width="38" height="16" rx="8"/><text x="${x + w - 27}" y="${y + 19}" text-anchor="middle">view</text></g>`)
    const badge = (bd) => `<g class="cf"><rect class="cfbg" x="${x + 8}" y="${y + bd.y + 1}" width="${w - 16}" height="15" rx="4"/><text class="cft" x="${x + 16}" y="${y + bd.y + 12}">${esc(bd.text)}</text><title>${esc(bd.cf.map(([pre, c]) => pre + cfTip(s, c)).join('\n'))}</title></g>`
    const change = (c, el) => `<g class="chg${s.dv && el.dl ? ` d-${el.dl.s}` : ''}"><rect class="chgbg" x="${x + 8}" y="${y + c.y + 1}" width="${w - 16}" height="15" rx="4"/><text class="chgt" x="${x + 16}" y="${y + c.y + 12}">${esc(c.text)}</text><title>${esc(s.dv ? c.full : `was: ${c.full}${el.bsrc && el.bsrc.length ? ` (at the base: ${el.bsrc.map((p) => bsrcText(s, p)).join(' · ')})` : ''}`)}</title></g>`
    if (g.head) out.push(badge(g.head))
    if (g.headChg && (s.ov || s.dv)) out.push(change(g.headChg, t))
    if (g.divider !== null) out.push(`<line class="tsep" x1="${x + 8}" x2="${x + w - 8}" y1="${y + g.divider}" y2="${y + g.divider}"/>`)
    const mid = new Map() // a row's element → its middle, for the rename brackets
    for (const r of g.rows) {
      const ry = y + r.y, re = r.kind === 'field' ? t.fields[r.i] : r.kind === 'index' ? t.indexes[r.i] : t.keys[r.i]
      const rc = s.ov && r.ch ? ` ${CLS[r.ch]}` : dcls(s, re)
      const bar = rc ? `<rect class="chbar${rc}" x="${x + 1}" y="${ry}" width="3" height="${r.kind === 'field' ? 20 : 18}"/>` : ''
      if (stale(s, re)) out.push(staleMark(ry + (r.kind === 'field' ? 10 : 9)))
      if (r.kind === 'field') {
        const f = t.fields[r.i]
        mid.set(f, ry + 10)
        const ftip = `${f.name} ${f.type} · ${f.nullable ? 'nullable' : 'not null'}${f.def !== null && f.def !== undefined ? ` · default ${f.def}` : ''}${f.gen ? ` · generated ${f.gen}` : ''}${f.pk ? ' · primary key' : ''}${fkTo.has(f.name) ? ` · foreign key → ${fkTo.get(f.name)}` : ''}${chTip(s, f)}${dTip(s, f)}`
        out.push(`<g class="row${sc.colHit(f) ? ' hit' : ''}${rc}" data-col="${esc(f.name)}"><title>${esc(ftip)}</title><rect class="rowbg" x="${x + 1}" y="${ry}" width="${w - 2}" height="20"/>`, bar,
          f.pk ? `<text class="mk mpk" x="${x + 8}" y="${ry + 13.5}">PK</text>` : '',
          f.fk ? `<text class="mk mfk" x="${x + (f.pk ? 25 : 8)}" y="${ry + 13.5}">FK</text>` : '',
          `<text class="cname${f.pk ? ' key' : ''}" x="${x + 43}" y="${ry + 14}">${esc(r.name)}</text><text class="ctype" x="${x + w - 24}" y="${ry + 14}" text-anchor="end">${esc(r.type)}</text>`,
          `<path class="${f.nullable ? 'nul' : 'nn'}" d="M${x + w - 13},${ry + 6}l4,4l-4,4l-4,-4z"/>`,
          (r.ch === 'removed' && s.ov) || struckD(s, f) ? `<line class="strike${s.dv ? ` d-${f.dl.s}` : ''}" x1="${x + 40}" x2="${x + w - 20}" y1="${ry + 10}" y2="${ry + 10}"/>` : '', '</g>')
      } else {
        const el = r.kind === 'index' ? t.indexes[r.i] : t.keys[r.i]
        mid.set(el, ry + 9)
        out.push(`<g class="xr${rc}"><title>${esc(`${r.kind === 'index' ? `${el.unique ? 'unique index' : 'index'} ${el.name} (${el.columns.join(', ')})${el.partial ? ', partial' : ''}` : `${el.role} key (${el.parts.join(', ')})`} — ${el.src.length ? el.src.map((p) => srcText(s, p)).join(' · ') : s.dv && el.dl && el.dl.s === 'prop' ? 'proposed: not in the code yet' : 'not in the branch'}${chTip(s, el)}${dTip(s, el)}`)}</title>${bar}<text class="xrow" x="${x + 12}" y="${ry + 13}">${esc(r.text)}</text>`,
          (r.ch === 'removed' && s.ov) || struckD(s, el) ? `<line class="strike${s.dv ? ` d-${el.dl.s}` : ''}" x1="${x + 10}" x2="${Math.round(x + 14 + Math.min(r.text.length * 6.6, w - 24))}" y1="${ry + 9}" y2="${ry + 9}"/>` : '', '</g>')
      }
      if (r.badge) out.push(badge(r.badge))
      if (r.chg && (s.ov || s.dv)) out.push(change(r.chg, re))
    }
    // a possible rename inside the table: a bracket beside the two rows, from the removed to the added
    if (s.ov) {
      const els = [...t.fields, ...t.keys, ...t.indexes].filter((el) => mid.has(el) && el.ren !== null && el.ren !== undefined)
      for (const a of els.filter((el) => el.ch === 'removed')) for (const c of els.filter((el) => el.ch === 'added' && el.ren === a.ren)) {
        const y1 = mid.get(a), y2 = mid.get(c), bx = x + w + 4, cx = bx + 20
        out.push(`<path class="ren" data-ren="${a.ren}" d="M${bx},${y1} C${cx},${y1} ${cx},${y2} ${bx},${y2}"><title>${esc(s.ch.renames[a.ren].text)}</title></path>`)
      }
    }
    return `${out.join('')}</g>`
  }
  // a possible table rename: a dashed line from the removed table's box to the added one's
  function renLink(A, B, text, r) {
    let d
    if (B.x >= A.x + A.w) d = `M${A.x + A.w},${A.y + 15} C${A.x + A.w + 40},${A.y + 15} ${B.x - 40},${B.y + 15} ${B.x},${B.y + 15}`
    else if (B.x + B.w <= A.x) d = `M${A.x},${A.y + 15} C${A.x - 40},${A.y + 15} ${B.x + B.w + 40},${B.y + 15} ${B.x + B.w},${B.y + 15}`
    else { const [P, Q] = A.y <= B.y ? [A, B] : [B, A]; d = `M${P.x + P.w / 2},${P.y + P.h} C${P.x + P.w / 2},${P.y + P.h + 30} ${Q.x + Q.w / 2},${Q.y - 30} ${Q.x + Q.w / 2},${Q.y}` }
    return `<path class="ren tren" data-ren="${r}" d="${d}"><title>${esc(text)}</title></path>`
  }
  function diagram(s, n, sc) {
    const L = sc.L, z = zoomOf(L)
    const lit = sc.sel >= 0
    const cls = (ti) => `${ti === sc.sel ? ' sel' : sc.near.has(ti) ? ' on' : lit ? ' dim' : ''}${sc.q && sc.match.includes(ti) ? ' hit' : ''}`
    const parts = [`<svg viewBox="0 0 ${L.W} ${L.H}" width="${Math.round(L.W * z)}" height="${Math.round(L.H * z)}" class="erd${sc.names ? ' collapsed' : ''}${lit ? ' lit' : ''}${sc.q && sc.mode === 'all' ? ' q' : ''}${s.ov ? ' ov' : ''}${s.dv ? ' dv' : ''}" role="group" focusable="false" aria-label="${esc(s.id)}: ${plural(sc.list.length, 'table')}, ${plural(L.links.length, 'foreign key line')}${s.ov ? `, changes since ${esc(REF)} drawn` : ''}${s.dv ? `, the delta ${esc(s.delta.shown)} drawn` : ''}">`,
      '<defs>' + ['', '-on'].map((on) => `<marker id="erd-many${on}" viewBox="-12 -7 13 14" refX="0" refY="0" markerWidth="13" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path class="mkr${on ? ' on' : ''}" d="M-10,0L0,-5M-10,0L0,0M-10,0L0,5"/></marker>` +
        `<marker id="erd-one${on}" viewBox="-12 -7 13 14" refX="0" refY="0" markerWidth="13" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto"><path class="mkr${on ? ' on' : ''}" d="M-7,-5L-7,5"/></marker>`).join('') + '</defs>']
    for (const l of L.links) {
      const from = sc.list[l.from], to = sc.list[l.to], t = s.tables[from], r = t.rels[l.k]
      const on = lit && (from === sc.sel || to === sc.sel)
      const tip = `${t.name} (${r.columns.join(', ')}) → ${r.to} (${r.toColumns.join(', ')})\non delete ${r.onDelete} · on update ${r.onUpdate}${r.cf.length ? `\n${r.cf.map((c) => cfTip(s, c)).join('\n')}` : ''}${chTip(s, r)}${dTip(s, r)}`
      parts.push(`<path class="fk${s.ov && r.ch ? ` ${CLS[r.ch]}` : ''}${dcls(s, r)}${on ? ' on' : lit ? ' dim' : ''}" data-fk="${from}:${l.k}" d="${l.d}" marker-start="url(#erd-many${on ? '-on' : ''})" marker-end="url(#erd-one${on ? '-on' : ''})"><title>${esc(tip)}</title></path>`)
    }
    if (s.ov) sc.list.forEach((ti, j) => {
      const t = s.tables[ti]
      if (t.ch !== 'removed' || t.ren === null || t.ren === undefined) return
      sc.list.forEach((tk, k) => { const u = s.tables[tk]; if (u.ch === 'added' && u.ren === t.ren) parts.push(renLink(L.boxes[j], L.boxes[k], s.ch.renames[t.ren].text, t.ren)) })
    })
    sc.list.forEach((ti, j) => parts.push(table(s, ti, L.boxes[j], erdBox(s.tables[ti], sc.names), cls(ti), sc)))
    parts.push('</svg>')
    const box = h('div', { class: 'svgbox archbox', id: 'data-box', ...nav.attrs('data', `ERD of ${s.id}`) })
    box.innerHTML = parts.join('')
    const svg = box.firstChild
    const key = `${n}|${sc.mode}|${sc.list.length}`
    if (st.dataScroll && st.dataScrollKey === key) { const [x, y] = st.dataScroll; requestAnimationFrame(() => { box.scrollLeft = x; box.scrollTop = y }) }
    st.dataScroll = null; st.dataScrollKey = key
    // drag the background or use the arrow keys to pan; the wheel, + and − zoom in place (stage-view.mjs)
    nav.scroller(box, svg, { item: '[data-tbl]', W: L.W, H: L.H, min: ZMIN, max: ZMAX, zoom: () => zoomOf(L), set: (z) => { st.dataZoom = z }, ctl: 'data', fit: () => { st.dataZoom = 'fit'; rerender() } })
    const open = (e) => {
      const g = e.target.closest('[data-tbl]')
      if (!g) { if (st.dataSel !== null) { st.dataSel = null; rerender(!s.collapsed) } return }
      const name = s.tables[Number(g.dataset.tbl)].name
      st.dataSel = st.dataSel === name ? null : name
      st.focusMain = true // the keyboard lands on the passport
      rerender(!s.collapsed)
    }
    svg.addEventListener('click', open)
    svg.addEventListener('keydown', (e) => { if (activate(e) && e.target.closest('[data-tbl]')) { e.preventDefault(); open(e) } })
    return box
  }

  // ── a table's passport: every column with its sources, keys, indexes, foreign keys both ways ──
  function passport(s, ti) {
    const t = s.tables[ti]
    const go = (name) => h('button', { class: 'linkbtn mono', onclick: () => { st.dataSel = name; st.focusMain = true; rerender(!s.collapsed) } }, name)
    const known = new Set(s.tables.map((o) => o.name))
    const warn = (x) => (x.cf.length ? h('span', { class: 'pill warn', title: x.cf.map((c) => cfTip(s, c)).join('\n') }, plural(x.cf.length, 'conflict')) : null)
    const by = s.tables.flatMap((o) => o.rels.filter((r) => r.to === t.name && o !== t).map((r) => [o, r]))
    const conflicts = [[t.kind, t], ...t.fields.map((f) => [`column ${f.name}`, f]), ...t.keys.map((k) => [`${k.role} key (${k.parts.join(', ')})`, k]), ...t.indexes.map((x) => [`index ${x.name}`, x]), ...t.rels.map((r) => [`foreign key (${r.columns.join(', ')}) → ${r.to}`, r])]
      .flatMap(([label, x]) => x.cf.map((c) => [label, c]))
    const section = (title, list, row) => [h('h2', null, `${title} (${list.length})`), list.length ? h('ul', { class: 'links dlist' }, list.map(row)) : h('div', { class: 'muted' }, 'none')]
    // in the overlay: what changed since the base, its before → after, and where it stood there
    const ov = (x) => s.ov && x.ch
    const chPill = (x) => (ov(x) ? h('span', { class: `pill ${CLS[x.ch]}` }, SINCE[x.ch]) : null)
    const name = (x, cls, text) => h(cls === 'b' ? 'b' : 'span', { class: `mono${(ov(x) && x.ch === 'removed') || struckD(s, x) ? ' struck' : ''}` }, text)
    const where = (x) => (ov(x) && x.ch === 'removed' ? h('div', { class: 'srcline' }, 'at the base: ', bsrcs(s, x.bsrc))
      : s.dv && x.dl && x.dl.gone ? h('div', { class: 'srcline' }, x.dl.s === 'built' ? 'removed as planned; at the base: ' : 'removed, not in the plan; at the base: ', bsrcs(s, x.bsrc))
        : s.dv && x.dl && x.dl.s === 'prop' ? h('div', { class: 'srcline' }, 'proposed: not in the code yet') : h('div', { class: 'srcline' }, srcs(s, x.src)))
    const was = (x) => (ov(x) && x.was ? h('div', { class: 'srcline chgline' }, `was: ${x.was.join(' · ')}`, x.bsrc && x.bsrc.length ? [' — at the base: ', bsrcs(s, x.bsrc)] : null) : null)
    const dPill = (x) => (s.dv && x.dl ? h('span', { class: `pill d-${x.dl.s}` }, x.dl.gone && x.dl.s === 'built' ? 'removed as planned' : x.dl.gone ? 'removed, not in the plan' : DSAY[x.dl.s]) : null)
    const item = (x, ...head) => h('li', { class: ov(x) ? `ch-${CLS[x.ch]}` : s.dv && x.dl ? `dl-${x.dl.s}` : null }, h('div', null, ...head, chPill(x), dPill(x)), where(x), was(x))
    // the table itself only when it was added, removed, or changed its own kind (not merely its elements)
    const changed = s.ov ? [...(t.ch && (t.ch !== 'modified' || t.was) ? [[`${t.kind} ${t.name}`, t]] : []), ...t.fields.map((f) => [`column ${f.name}`, f]), ...t.keys.map((k) => [`${k.role} key (${k.parts.join(', ')})`, k]), ...t.indexes.map((x) => [`index ${x.name}`, x]), ...t.rels.map((r) => [`foreign key (${r.columns.join(', ')}) → ${r.to}`, r])].filter(([, x]) => x.ch) : []
    const rens = s.ov ? [...new Set([t, ...t.fields, ...t.keys, ...t.indexes, ...t.rels].map((x) => x.ren).filter((r) => r !== null && r !== undefined))] : []
    // in the delta overlay: the changes this table carries, and what the branch did to it outside them
    const dks = s.dv ? s.dl.ks.filter((k) => s.delta.changes[k].tbl === ti) : [], dus = s.dv ? s.dl.us.filter((j) => s.delta.unplanned[j].tbl === ti) : []
    return h('div', { class: 'detail passport' },
      h('h3', null, h('span', { class: 'tdot t-database' }), (ov(t) && t.ch === 'removed') || struckD(s, t) ? h('span', { class: 'struck' }, t.name) : t.name, h('span', { class: 'pill' }, t.kind), conflicts.length ? h('span', { class: 'pill warn' }, plural(conflicts.length, 'conflict')) : null, chPill(t), dPill(t)),
      h('div', { class: 'muted' }, `${s.id} · ${s.dialect || 'dialect unknown'}`),
      dks.length || dus.length ? [h('h2', null, `Delta: ${plural(dks.length, 'change')}${dus.length ? `, ${dus.length} not in the plan` : ''}`),
        h('ul', { class: 'links dlist' }, dks.map((k) => deltaItem(s.delta, k, 'p')), dus.map((j) => unplItem(s.delta, j)))] : null,
      changed.length || rens.length ? [h('h2', null, `Changes since ${REF} (${changed.length})`), h('p', { class: 'note' }, `Against ${CH.base.text}. A rename is a candidate, never decided.`),
        h('ul', { class: 'links dlist' }, changed.map(([label, x]) => h('li', { class: `ch-${CLS[x.ch]}` }, h('div', null, name(x, 'b', label), chPill(x)), was(x))),
          rens.map((r) => h('li', { class: 'ch-ren' }, h('div', null, s.ch.renames[r].text))))] : null,
      h('h2', null, 'Declared at'), h('div', null, ov(t) && t.ch === 'removed' ? ['at the base: ', bsrcs(s, t.bsrc)] : s.dv && t.dl && t.dl.gone ? ['at the base: ', bsrcs(s, t.bsrc)] : s.dv && t.dl && t.dl.s === 'prop' ? h('span', { class: 'muted' }, 'proposed: not in the code yet') : srcs(s, t.src)),
      section('Columns', t.fields, (f) => item(f,
        f.pk ? h('span', { class: 'mkl pk' }, 'PK') : null, f.fk ? h('span', { class: 'mkl fk' }, 'FK') : null, name(f, 'b', f.name), ' ', h('span', { class: 'mono muted' }, f.type), ' · ', h('span', { class: 'muted' }, f.nullable ? 'nullable' : 'not null'),
        f.def !== null && f.def !== undefined ? h('span', { class: 'muted' }, ' · default ', h('code', null, String(f.def))) : null, f.gen ? h('span', { class: 'muted' }, ` · generated ${f.gen}`) : null, warn(f))),
      t.keys.length ? section('Keys', t.keys, (k) => item(k, name(k, 'span', `${k.role} (${k.parts.join(', ')})`), warn(k))) : null,
      section('Indexes', t.indexes, (x) => item(x, name(x, 'span', `${x.name}${x.unique ? ' unique' : ''} (${x.columns.join(', ')})${x.partial ? ' partial' : ''}`), warn(x))),
      section('Foreign keys', t.rels, (r) => item(r,
        name(r, 'span', `(${r.columns.join(', ')}) → `), known.has(r.to) ? go(r.to) : h('span', { class: 'mono' }, r.to), h('span', { class: 'mono' }, ` (${r.toColumns.join(', ')})`), h('span', { class: 'muted' }, ` · on delete ${r.onDelete} · on update ${r.onUpdate}`), warn(r))),
      section('Referenced by', by, ([o, r]) => h('li', null, go(o.name), h('span', { class: 'mono muted' }, ` (${r.columns.join(', ')}) → (${r.toColumns.join(', ')})`))),
      conflicts.length ? [h('h2', null, `Conflicts (${conflicts.length})`), h('p', { class: 'note' }, 'The declarations disagree; each side is kept, none is resolved.'),
        h('ul', { class: 'links dlist' }, conflicts.map(([label, c]) => h('li', null, h('div', null, h('b', null, label), h('span', { class: 'muted' }, ` · ${c.attr}`)),
          c.values.map((v) => h('div', { class: 'srcline' }, h('span', { class: 'pill warn' }, val(c.attr, v.value)), ' ', srcs(s, v.src))))))] : null)
  }

  // ── a delta's changes: one item each, with its state, why, slice and acknowledgement ──
  const ackText = (c) => (c.ack === 'acked' ? `acknowledged by ${c.by} at ${c.at}` : c.ack === 'stale' ? `stale: acknowledged by ${c.by} at ${c.at}, edited since` : 'not acknowledged')
  function deltaItem(d, k, where) {
    const c = d.changes[k], [cls, word] = STATE[c.state]
    return h('li', { class: `dl-${cls}` },
      h('div', null, h('span', { class: 'mono' }, c.text), h('span', { class: `pill dl-${cls}` }, word), c.ack === 'stale' ? h('span', { class: 'pill dl-stale' }, 'stale') : null, c.origin === 'unplanned' ? h('span', { class: 'pill d-unpl' }, 'unplanned, kept') : null),
      c.after ? h('div', { class: 'srcline' }, 'as: ', h('code', null, c.after)) : null,
      c.diffs.length ? h('div', { class: 'srcline chgline' }, `planned → built: ${c.diffs.join('; ')}`) : null,
      c.proposed.length ? h('div', { class: 'srcline' }, `proposed: ${c.proposed.join('; ')}`) : null,
      c.warn ? h('div', { class: 'srcline err' }, `⚠ ${c.warn}`) : null,
      c.src.length ? h('div', { class: 'srcline' }, 'in the code: ', c.src.flatMap((x, j) => [j ? ' · ' : null, h('code', null, x)])) : null,
      h('div', { class: 'srcline' }, `why: ${c.why}`),
      h('div', { class: 'srcline' }, c.slice !== null ? `slice ${c.slice} · ` : 'no slice yet · ', h('span', { class: c.ack === 'acked' ? null : 'dlack' }, ackText(c)), ackBtn(d, [k], c.ack !== 'acked', where, c.ack === 'acked' ? 'Unacknowledge' : c.ack === 'stale' ? 'Acknowledge again' : 'Acknowledge')))
  }
  const unplItem = (d, j) => { const u = d.unplanned[j]; return h('li', { class: 'dl-unpl' }, h('div', null, h('span', { class: 'mono' }, u.target), h('span', { class: 'pill d-unpl' }, 'not in the plan')), h('div', { class: 'srcline' }, u.text), u.was.length ? h('div', { class: 'srcline' }, u.was.join('; ')) : null) }
  // served only, and only for a delta beside the specs: the server writes the acknowledgement
  function ackBtn(d, ks, on, where, label) {
    if (!SERVE || !d.ackable || !ks.length) return null
    return h('button', { class: 'linkbtn dlbtn', 'data-ctl': `delta-ack-${where}${ks.length === 1 ? ks[0] : 'all'}`, title: on ? 'Write an acknowledgement into the delta: who, when, and the hash of the change as it is now' : 'Remove the acknowledgement from the delta', onclick: () => ack(d, ks, on) }, label)
  }
  async function ack(d, ks, on) {
    st.dlStatus = 'Saving…'
    try {
      const r = await fetch('/api/delta', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-grimoire-token': SERVE.token }, body: JSON.stringify({ repo: d.repo, path: d.path, base: d.hash, ids: ks.map((k) => d.changes[k].id), ack: on }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        d.hash = j.hash
        for (const x of j.changes || []) { const c = d.changes.find((y) => y.id === x.id); if (c) Object.assign(c, { ack: x.ack ? 'acked' : null, by: x.ack ? x.ack.by : null, at: x.ack ? x.ack.at : null }) }
        st.dlStatus = `${on ? 'Acknowledged' : 'Acknowledgement removed'}: ${plural(ks.length, 'change')}, written to ${d.shown}`
      } else if (r.status === 409) { d.conflict = true; st.dlStatus = null } else st.dlStatus = `Not saved: ${j.error || `HTTP ${r.status}`}`
    } catch (e) { st.dlStatus = `Not saved: the server is not answering (${e.message})` }
    rerender()
  }
  // the delta in a store: its legend, its counts, every change it carries here, acknowledging them all
  function deltaPanel(s) {
    const d = s.delta, ks = s.dl.ks, us = s.dl.us
    const n = (st8) => ks.filter((k) => d.changes[k].state === st8).length
    const open = ks.filter((k) => d.changes[k].ack !== 'acked')
    return [
      h('div', { class: 'legend dlegend chlegend', role: 'note', 'aria-label': 'Delta legend' }, h('b', null, 'Delta:'),
        h('span', null, h('i', { class: 'chsw d-prop' }), 'proposed (dashed)'), h('span', null, h('i', { class: 'chsw d-rm' }), h('s', null, 'proposed removal')), h('span', null, h('i', { class: 'chsw d-pend' }), 'proposed change: now → planned'),
        h('span', null, h('i', { class: 'chsw d-built' }), 'planned and built'), h('span', null, h('i', { class: 'chsw d-diff' }), 'built differently: planned → built'),
        h('span', null, h('i', { class: 'chsw d-unpl' }), 'not in the plan'), h('span', null, h('i', { class: 'chsw dl-stale' }), 'acknowledgement stale')),
      h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, `${n('planned-built')} planned and built · ${n('pending')} pending · ${n('built-differently')} built differently${d.unplWhy ? '' : ` · ${us.length} not in the plan`} · ${ks.length - open.length} of ${ks.length} acknowledged`),
        open.length ? ackBtn(d, open, true, 's', `Acknowledge all ${plural(open.length, 'change')} not acknowledged in this store`) : null),
      h('details', { class: 'problems dlchanges', open: st.dlOpen === false ? null : 'open', ontoggle: (e) => { st.dlOpen = e.target.open } }, h('summary', null, `Changes in this store (${ks.length})${us.length ? `, and ${us.length} not in the plan` : ''}`),
        h('ul', { class: 'links dlist' }, ks.map((k) => deltaItem(d, k, 'l')), us.map((j) => unplItem(d, j))))]
  }
  // the delta as a whole, above the stores: which, for which design, and what cannot be drawn
  function deltaHead(d) {
    if (d.errors.length) return h('div', { class: 'callout callout-danger banner' }, h('div', { class: 'callout-title' }, `${d.shown} does not validate (${plural(d.errors.length, 'problem')}): nothing drawn`), h('ul', { class: 'links' }, d.errors.map((e) => h('li', null, e))))
    const outside = d.changes.map((c, k) => [c, k]).filter(([c]) => c.store < 0)
    const k = (f) => d.changes.filter(f).length
    return h('div', { class: 'callout banner dlhead' },
      h('div', { class: 'callout-title' }, 'Delta ', h('span', { class: 'mono' }, d.shown)),
      h('p', null, 'For ', h('code', null, d.spec), `: ${plural(d.changes.length, 'change')} · ${k((c) => c.state === 'planned-built')} planned and built · ${k((c) => c.state === 'pending')} pending · ${k((c) => c.state === 'built-differently')} built differently${d.unplWhy ? '' : ` · ${d.unplanned.length} not in the plan`} · ${k((c) => c.ack === 'acked')} acknowledged · ${k((c) => c.ack === 'stale')} stale`),
      d.unplWhy ? h('p', { class: 'note' }, `Not in the plan: not listed, ${d.unplWhy}.`) : null,
      !SERVE ? h('p', { class: 'note' }, 'Read-only snapshot. To acknowledge changes, serve the page: ', h('code', null, 'graph.mjs serve')) : !d.ackable ? h('p', { class: 'note' }, 'This delta is not beside the specs of a repository (docs/specs/<name>.delta.json): acknowledge it by editing the file.') : null,
      d.conflict ? h('div', { class: 'callout callout-warning' }, h('div', { class: 'callout-title' }, 'The delta changed on disk since this page was loaded'), h('p', null, 'Nothing was written. Reload the page to see it as it is now, then acknowledge again. '), h('button', { class: 'linkbtn', 'data-ctl': 'delta-reload', onclick: () => location.reload() }, 'Reload')) : null,
      st.dlStatus ? h('p', { class: 'note', role: 'status' }, st.dlStatus) : null,
      outside.length ? [h('p', { class: 'note' }, `Not drawn: their store is not in the model (${outside.length})`), h('ul', { class: 'links dlist' }, outside.map(([, i]) => deltaItem(d, i, 'o')))] : null)
  }

  // ── the tab ──
  function storeView(s, n) {
    const sc = scene(s, n)
    const cur = st.dataZoom === 'fit' ? 'fit' : st.dataZoom || 1
    const zoom = (z) => { st.dataZoom = z; rerender() }
    const by = (d) => () => zoom(nav.step(zoomOf(sc.L), d, ZMIN, ZMAX)) // from the zoom as it is now: the wheel or a key may have changed it
    const zoomSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zoom' },
      h('button', { 'data-ctl': 'data-fit', 'aria-pressed': String(cur === 'fit'), title: 'Fit the drawing to the page (0)', onclick: () => zoom('fit') }, 'Fit'),
      h('button', { 'data-ctl': 'data-out', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: by(-1) }, '−'),
      h('button', { 'data-ctl': 'data-100', 'aria-pressed': String(cur === 1), title: 'Natural size', onclick: () => zoom(1) }, `${Math.round((cur === 'fit' ? zoomOf(sc.L) : cur) * 100)}%`),
      h('button', { 'data-ctl': 'data-in', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: by(1) }, '+'))
    const total = s.tables.length
    const back = (label) => h('button', { class: 'linkbtn', 'data-ctl': 'data-all-tables', onclick: () => { st.dataSel = null; rerender(false) } }, label)
    const what = sc.mode === 'focus' ? h('span', null, h('b', { class: 'mono' }, st.dataSel), ` and its ${plural(sc.near.size, 'foreign key neighbour')}, of ${plural(total, 'table')} · `, back('all tables'))
      : sc.mode === 'search' ? h('span', { class: 'muted' }, `${plural(sc.match.length, 'table')} of ${total} match “${st.q.trim()}”${sc.match.length > SUB_MAX ? `: the first ${SUB_MAX} drawn, narrow the search` : ''}`)
        : sc.mode === 'names' || sc.mode === 'columns' ? h('span', { class: 'muted' }, sc.mode === 'names' ? `${plural(total, 'table')}, drawn as names: click a table or search to see its columns` : `${plural(total, 'table')} with their columns`)
          : sc.q ? h('span', { class: 'muted' }, `${plural(sc.match.length, 'table')} match “${st.q.trim()}”`) : null
    const cols = s.collapsed && (sc.mode === 'names' || sc.mode === 'columns') ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Tables drawn as' },
      h('button', { 'data-ctl': 'data-names', 'aria-pressed': String(!st.dataAll), onclick: () => { st.dataAll = false; rerender(false) } }, 'Names'),
      h('button', { 'data-ctl': 'data-columns', 'aria-pressed': String(!!st.dataAll), onclick: () => { st.dataAll = true; rerender(false) } }, 'Columns')) : null
    const how = s.how ? (s.how.how === 'stated' ? ['stated at ', srcEl(s, s.how.at)] : s.how.how === 'sniffed' ? [`sniffed: ${s.how.marker} at `, srcEl(s, s.how.at)] : s.how.how === 'supabase' ? ['Supabase migrations are Postgres'] : ['set in grimoire.config.json (graph.data.migrations)']) : ['unknown']
    const decls = h('ul', { class: 'links decls' }, s.decls.map((d) => h('li', null, h('span', { class: 'pill' }, d.kind), ' ', h('span', { class: 'mono muted' }, d.extractor), ' · ',
      d.stopped ? h('span', { class: 'err' }, 'replayed to ', srcEl(s, d.stopped), `: ${d.error}`) : d.status === 'not-read' ? h('span', { class: 'err' }, `not read: ${d.label}`) : d.label, ' · ', srcEl(s, d.at),
      d.notes && d.notes.length ? h('div', { class: 'note' }, d.notes.join(' · ')) : null)))
    const legend = h('div', { class: 'legend dlegend' }, h('span', null, h('span', { class: 'mkl pk' }, 'PK'), 'primary key'), h('span', null, h('span', { class: 'mkl fk' }, 'FK'), 'foreign key'),
      h('span', null, h('i', { class: 'dia nn' }), 'not null'), h('span', null, h('i', { class: 'dia nul' }), 'nullable'), h('span', null, h('span', { class: 'pill warn' }, 'a ≠ b'), ' the declarations disagree, both values shown'),
      h('span', { class: 'muted' }, 'a line runs from the referencing column (many) to the column it references (one)'))
    // the overlay's own legend, and what it says about the store as a whole
    const k = s.ov ? s.ch.n : null
    const overlay = s.ov ? [
      h('div', { class: 'legend dlegend chlegend', role: 'note', 'aria-label': 'Change overlay legend' }, h('b', null, `Changes since ${REF}:`),
        h('span', null, h('i', { class: 'chsw add' }), 'added'), h('span', null, h('i', { class: 'chsw del' }), h('s', null, 'removed'), ' (a removed table drawn as a ghost)'),
        h('span', null, h('i', { class: 'chsw mod' }), 'modified: before → after'), h('span', null, h('i', { class: 'chsw ren' }), 'possible rename, linked, never decided')),
      h('div', { class: 'toolbar' }, s.ch.store === 'added' ? h('span', { class: 'pill add' }, `store added since ${REF}`) : null, h('span', { class: 'muted' }, `${k.added} added · ${k.removed} removed · ${k.modified} modified · ${plural(k.renames, 'possible rename')}`), ...s.ch.attrs.map((a) => h('span', { class: 'pill mod' }, a))),
      s.ch.renames.length ? h('ul', { class: 'links renames' }, s.ch.renames.map((r) => h('li', { class: 'ch-ren' }, r.text))) : null] : null
    const sel = st.dataSel !== null && sc.sel >= 0 ? passport(s, sc.sel) : null
    const draw = stage('data', 'ERD', diagram(s, n, sc), zoomSeg, sel)
    return h('section', null,
      h('div', { class: 'toolbar' }, h('b', { class: 'mono' }, s.id), h('span', { class: 'pill' }, s.dialect || 'dialect unknown'), h('span', { class: 'muted' }, s.summary), cols, what),
      h('details', { class: 'problems' }, h('summary', null, `Read from ${plural(s.decls.length, 'declaration')} · dialect: `, ...how), decls),
      legend, overlay, s.dv ? deltaPanel(s) : null,
      sel && st.full !== 'data' ? h('section', { class: 'split rev' }, h('div', null, draw), h('aside', { class: 'side' }, sel)) : draw,
      h('p', { class: 'note' }, 'Read from migrations and schema snapshots, never from a database. Scroll to zoom, drag to pan; with the drawing focused, the arrow keys pan (Shift: a page), + and − zoom, 0 fits. Click a table for its passport: every column with the files that declare it, and its foreign keys both ways. Search names tables and columns. A map, not the database: read the code at the path:line.'))
  }
  function view() {
    const inRepo = (id) => !st.repo || id.startsWith(`${st.repo}:`)
    const list = S.map((s, i) => [s, i]).filter(([s]) => inRepo(s.id))
    const unread = (DD.unread || []).filter((u) => inRepo(u.store)), failed = (DD.failed || []).filter((f) => !st.repo || f.repo === st.repo)
    const gone = CH.base ? (CH.removed || []).filter((g) => inRepo(g.id)) : []
    if (!list.length && !unread.length && !failed.length && !gone.length) return h('section', null, h('p', { class: 'muted' }, 'No data store found: no folder of SQL migrations (.sql files that create or alter tables) and no schema snapshot in the indexed repositories. The data model is read from what declares it in the code, never from a database.'))
    if (list.length && !list.some(([, i]) => i === st.data)) open(list[0][1])
    const pick = (i) => () => { open(i); rerender(false) }
    const on = !!st.dataChanges && !!CH.base
    const dsel = DL[st.deltaSel] || null, don = !!st.dataDelta && !!dsel
    const dcount = (i) => { const o = delta() && delta().stores[i]; if (!o) return null; const d = delta(), c = (x) => o.ks.filter((k) => d.changes[k].state === x).length; return h('span', { class: 'dchg' }, `✓${c('planned-built')} · ${c('pending')} pending · ≠${c('built-differently')}${o.us.length ? ` · ${o.us.length} not in the plan` : ''}`) }
    const counts = (s, i) => (on && s.ch ? h('span', { class: 'dchg' }, `+${s.ch.n.added} −${s.ch.n.removed} ~${s.ch.n.modified}${s.ch.n.renames ? ` · ${plural(s.ch.n.renames, 'possible rename')}` : ''}`) : don ? dcount(i) : null)
    const picker = list.length ? h('div', { class: 'dstores', role: 'group', 'aria-label': 'Data stores' }, list.map(([s, i]) => h('button', { class: 'dstore', 'data-ctl': `data-store-${i}`, 'aria-pressed': String(i === st.data), onclick: pick(i) },
      h('b', null, s.id), h('span', null, `${s.dialect || 'dialect unknown'} · ${s.summary}`), counts(s, i)))) : null
    // the overlay's switch: off by default; absent, with the reason, when no base resolved
    const n = CH.n || { added: 0, removed: 0, modified: 0, renames: 0 }
    // the overlays' switches, one on at a time: the branch against its base, a design's delta
    const toggle = CH.base || DL.length ? h('div', { class: 'toolbar dchanges' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Overlay' },
        CH.base ? h('button', { 'data-ctl': 'data-changes', 'aria-pressed': String(on), title: `Draw what changed against ${CH.base.text}`, onclick: () => { st.dataChanges = !st.dataChanges; st.dataDelta = false; rerender(false) } }, `Changes vs ${REF}`) : null,
        DL.length ? h('button', { 'data-ctl': 'data-delta', 'aria-pressed': String(don), title: 'Draw a design\'s proposed changes over the model, each with its state against the code', onclick: () => { st.dataDelta = !st.dataDelta; st.dataChanges = false; rerender(false) } }, 'Delta') : null),
      DL.length > 1 ? h('select', { 'data-ctl': 'data-delta-file', 'aria-label': 'Which delta', onchange: (e) => { st.deltaSel = Number(e.target.value); st.dataDelta = true; st.dataChanges = false; st.dlStatus = null; rerender(false) } }, DL.map((x, i) => h('option', { value: String(i), selected: i === st.deltaSel ? 'selected' : null }, x.shown))) : null,
      h('span', { class: 'muted' }, on ? `${n.added} added · ${n.removed} removed · ${n.modified} modified · ${plural(n.renames, 'possible rename')}, against ${CH.base.text}` : don ? `the delta ${dsel.shown} over the model` : `off: ${CH.base ? `Changes draws what changed against ${CH.base.text}` : ''}${CH.base && DL.length ? '; ' : ''}${DL.length ? `Delta draws ${DL.length === 1 ? DL[0].shown : 'a design\'s delta'} over the model` : ''}`)) : null
    const why = CH.base ? null : h('p', { class: 'note' }, `No change overlay: ${CH.why || 'no base was resolved'}.`)
    const base = on ? [
      gone.length ? h('div', { class: 'callout callout-danger banner' }, h('div', { class: 'callout-title' }, `Stores removed since ${REF} (${gone.length})`),
        h('ul', { class: 'links' }, gone.map((g) => h('li', null, h('b', { class: 'mono struck' }, g.id), h('span', { class: 'pill del' }, g.why), ' ', g.tables.map(([t, at, line], j) => [j ? ', ' : '', h('span', { class: 'mono' }, t), ' ', h('code', { title: `at the base: ${CH.base.text}` }, `${at}${line ? `:${line}` : ''}`)]))))) : null,
      (CH.skipped || []).length ? h('p', { class: 'note' }, `Not compared: ${CH.skipped.map((x) => `${x.name} (${x.why})`).join(', ')}.`) : null,
      (CH.failed || []).length ? h('p', { class: 'note err' }, `At the base, extractor failures leave facts out of the comparison: ${CH.failed.map((f) => `${f.extractor} on ${f.at}: ${f.error}`).join('; ')}`) : null] : null
    const path = (u) => (u.file >= 0 ? h('a', { class: 'jump mono', href: `#file-${u.file}` }, u.at) : h('code', null, u.at))
    const found = unread.length ? h('div', { class: 'callout callout-warning banner' }, h('div', { class: 'callout-title' }, `Found, not read (${unread.length})`),
      h('ul', { class: 'links' }, unread.map((u) => h('li', null, h('b', { class: 'mono' }, u.store), h('span', { class: 'pill' }, u.dialect || 'dialect unknown'), ` ${u.reason}${u.files ? ` · ${plural(u.files, 'file')}` : ''} · `, path(u)))),
      h('p', null, 'Listed so the map never pretends to be complete: these folders hold schema statements no reader has drawn yet.')) : null
    const fails = failed.length ? h('div', { class: 'callout callout-danger banner' }, h('div', { class: 'callout-title' }, `Extractor failures (${failed.length}): their facts are missing`),
      h('ul', { class: 'links' }, failed.map((f) => h('li', null, h('span', { class: 'mono' }, `${f.extractor} on `), path(f), `: ${f.error}`)))) : null
    return h('section', null, toggle, why, base, don ? deltaHead(dsel) : null, picker, found, fails, list.length ? storeView(shownStore(st.data), st.data) : h('p', { class: 'muted' }, 'No store with tables to draw for this selection.'))
  }
  function open(n) { if (st.data !== n) { st.data = n; st.dataSel = null; st.dataAll = false; st.dataScroll = null } }
  return { view, has: (n) => !!S[n], open }
}
