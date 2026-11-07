// grimoire graph · the page's Architecture tab. Runs in the browser only: render.mjs injects this
// function's source next to the page's helpers (esc, cut, plural) and calls it with the page's
// context. The diagrams arrive laid out (arch.mjs, layoutArch): this draws them, and lets a reader
// focus a component (its passport: code it covers, sources, connections and what the graph says
// about each), trace what it reaches upstream or downstream along the drawn connections, find the
// route between two components, and show the code links no line draws. Reach and route follow the
// diagram's own lines: authored reachability, not runtime impact.
//
// The architecture change view (packed in Node: arch-change.mjs, arch-pack.mjs), two overlays, one
// at a time, on a saved diagram, each with its legend and its list:
//   Changes vs <base>  the branch against its base: components, lines and boundaries added (green),
//                      removed (struck in red, a ghost where it stood) or modified (amber, before →
//                      after), and the code's new links no line draws (dotted). Absent when no base
//                      resolved (the tab says why); with no index of the base checkout, only the
//                      diagram files were compared, and it says so.
//   Delta              a design's architecture changes, the Data tab's visual language: a proposed
//                      component as a dashed ghost placed by the layout, a proposed line dashed, a
//                      proposed removal struck in amber dashes, a proposed change with what it
//                      proposes; planned and built solid green, built differently amber with planned →
//                      built; the branch's impact no change covers in its own colour, "not in the
//                      plan"; a stale acknowledgement badged. Each change lists its why, slice and
//                      acknowledgement. Served (graph.mjs serve), each can be acknowledged, as in the
//                      Data tab: the same delta object, the same PUT /api/delta, the same status beside
//                      the control (409 with a Reload that reopens the page on the same overlay).
export function archClient(ctx) {
  const { D, h, st, files, render, jumpFile, activate, stage, nav } = ctx
  const ICONS = {
    frontend: 'M3 4h14v10H3z M7 17h6 M10 14v3',
    backend: 'M3 3h14v5H3z M3 12h14v5H3z M6 5.5h.01 M6 14.5h.01',
    worker: 'M10 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z M10 2v2.5 M10 15.5V18 M2 10h2.5 M15.5 10H18 M4.3 4.3l1.8 1.8 M13.9 13.9l1.8 1.8 M4.3 15.7l1.8-1.8 M13.9 6.1l1.8-1.8',
    database: 'M3 5c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M3 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5 M3 10c0 1.7 3.1 3 7 3s7-1.3 7-3',
    messagebus: 'M2 5h16 M2 15h16 M5 10h2 M9 10h2 M13 10h2',
    cloud: 'M6 16h8.5a3.5 3.5 0 0 0 .5-7 5 5 0 0 0-9.6-1.4A3.8 3.8 0 0 0 6 16z',
    security: 'M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z M7 10l2 2 4-4',
    external: 'M10 2a8 8 0 1 0 0 16a8 8 0 1 0 0-16z M2 10h16 M10 2c2.6 2.6 2.6 13.4 0 16 M10 2c-2.6 2.6-2.6 13.4 0 16',
    library: 'M3 6l7-4 7 4v8l-7 4-7-4z M3 6l7 4 7-4 M10 10v8',
    cli: 'M3 4h14v12H3z M6 8l3 2-3 2 M11 13h3',
  }
  const TYPE_LABEL = { frontend: 'frontend', backend: 'backend / service', worker: 'worker', database: 'datastore', messagebus: 'queue / bus', cloud: 'cloud / infra', security: 'security', external: 'external', library: 'library', cli: 'CLI / tool' }
  const A = D.arch || []
  const ix = () => Math.min(Math.max(0, st.arch | 0), Math.max(0, A.length - 1))

  // ── the change view's overlays ──
  const DL = (D.data && D.data.deltas) || [], SERVE = D.serve || null
  const CH = D.archCh || { base: null, why: 'no base was resolved' }
  const REF = CH.base ? CH.base.ref : ''
  // a page reloaded after a refused acknowledgement opens as it was: the overlay, the delta, the diagram
  try {
    const kept = JSON.parse(sessionStorage.getItem('grimoire-arch-delta') || 'null')
    sessionStorage.removeItem('grimoire-arch-delta')
    if (kept) {
      const i = DL.findIndex((d) => d.shown === kept.delta)
      st.deltaSel = i >= 0 ? i : DL[kept.deltaSel] ? kept.deltaSel : st.deltaSel
      st.archDelta = !!kept.archDelta && !!DL[st.deltaSel]
      if (Number.isInteger(kept.arch) && A[kept.arch]) st.arch = kept.arch
    }
  } catch {}
  const dsel = () => (DL[st.deltaSel] ? st.deltaSel : DL[(D.data || {}).delta] ? D.data.delta : 0)
  const delta = () => { const d = st.archDelta ? DL[dsel()] : null; return d && !d.errors.length && d.arch ? d : null }
  // the diagram as drawn: its overlay's elements, marks and layout while an overlay is on
  const shownArch = (a, k) => {
    const d = delta()
    if (d) return { ...a, ...(d.arch.diagrams[k] || { ks: [], us: [], bmarks: {}, links: [] }), dv: true, delta: d }
    if (st.archChanges && a.ch) return { ...a, ...a.ch, ov: true }
    return a
  }
  const DSAY = { prop: 'proposed', rm: 'proposed removal', pend: 'proposed change', built: 'planned and built', diff: 'built differently', unpl: 'not in the plan' }
  const STATE = { 'planned-built': ['built', 'planned and built'], pending: ['pending', 'pending'], 'built-differently': ['diff', 'built differently'] }
  const CLS = { added: 'add', removed: 'del', modified: 'mod' }
  const SINCE = { added: `added since ${REF}`, removed: `removed since ${REF}`, modified: `modified since ${REF}` }
  const markOf = (a, el) => (a.dv ? el.dl || null : a.ov && el.ch ? el : null)
  const stale = (a, m) => !!(a.dv && m && m.c && m.c.some((k) => a.delta.arch.changes[k].ack === 'stale'))
  const mcls = (a, m) => (!m ? '' : a.dv ? ` d-${m.s}${m.gone ? ' gone' : ''}${stale(a, m) ? ' stale' : ''}` : ` ch-${CLS[m.ch]}`)
  const struck = (a, m) => !!m && (a.dv ? m.s === 'rm' || m.gone : m.ch === 'removed')
  const mword = (m) => (m.gone && m.s === 'built' ? 'removed as planned' : m.gone ? 'removed, not in the plan' : DSAY[m.s])
  const mtip = (a, m) => (!m ? '' : a.dv ? `\n${mword(m)}${(m.c || []).map((k) => { const c = a.delta.arch.changes[k]; return `\n${c.text}\nwhy: ${c.why}${c.slice !== null ? ` · slice ${c.slice}` : ''}${c.ack === 'stale' ? '\nacknowledgement stale: edited since' : c.ack ? `\nacknowledged by ${c.by}` : ''}` }).join('')}${(m.was || []).length ? `\n${m.was.join('\n')}` : ''}`
    : `\n${SINCE[m.ch]}${(m.was || []).length ? `: ${m.was.join('; ')}` : ''}`)
  // a target's ends: what a change or an unplanned item concerns, for a component's passport
  const ends = (t) => {
    if (!t) return []
    if (t.startsWith('component:')) return [t.slice(10)]
    if (!t.startsWith('connection:')) return []
    const e = t.slice(11).split('#')[0], gt = e.indexOf('>')
    return gt > 0 ? [e.slice(0, gt - 1), e.slice(gt + 1)] : []
  }

  // ── graph walks over the drawn connections ──
  function walk(a, from, dir) {
    const seen = new Set([from]), edges = new Set(), queue = [from]
    while (queue.length) {
      const u = queue.shift()
      a.conns.forEach((e, k) => {
        const [x, y] = dir === 'down' ? [e.from, e.to] : [e.to, e.from]
        if (x !== u) return
        edges.add(k)
        if (!seen.has(y)) { seen.add(y); queue.push(y) }
      })
    }
    return { nodes: seen, edges }
  }
  function route(a, from, to) {
    for (const directed of [true, false]) {
      const prev = new Map([[from, null]]), queue = [from]
      while (queue.length && !prev.has(to)) {
        const u = queue.shift()
        a.conns.forEach((e, k) => {
          const steps = directed ? [[e.from, e.to]] : [[e.from, e.to], [e.to, e.from]]
          for (const [x, y] of steps) if (x === u && !prev.has(y)) { prev.set(y, [u, k]); queue.push(y) }
        })
      }
      if (prev.has(to)) {
        const nodes = new Set([to]), edges = new Set()
        for (let v = to; prev.get(v); v = prev.get(v)[0]) { edges.add(prev.get(v)[1]); nodes.add(prev.get(v)[0]) }
        return { nodes, edges, directed, hops: edges.size }
      }
    }
    return null
  }

  // natural size by default (readable; drag, the arrow keys or the scrollbars pan, the wheel zooms); Fit shows it all.
  // At full size Fit uses the window (less the passport beside it), both ways, and may enlarge.
  const ZMIN = 0.2, ZMAX = 3
  const zoomOf = (L) => {
    if (st.archZoom !== 'fit') return st.archZoom || 1
    if (st.full === 'arch') {
      const vw = window.innerWidth || 1400, w = vw - 48 - (st.archSel ? Math.min(420, vw * 0.38) + 12 : 0), hgt = (window.innerHeight || 900) - 48
      return Math.min(2, Math.max(ZMIN, Math.min(w / (L.W + 8), hgt / (L.H + 8))))
    }
    return Math.min(1, Math.max(ZMIN, ((document.getElementById('arch-box') || {}).clientWidth || 1100) / (L.W + 8)))
  }
  function rerender() {
    const b = document.getElementById('arch-box')
    if (b) st.archScroll = [b.scrollLeft, b.scrollTop]
    render()
  }

  function diagram(a) {
    const L = a.layout, byId = new Map(a.comps.map((c, i) => [c.id, i]))
    const sel = st.archSel && byId.has(st.archSel) ? st.archSel : null
    let lit = null
    if (sel && st.archTrace === 'up') lit = walk(a, sel, 'up')
    else if (sel && st.archTrace === 'down') lit = walk(a, sel, 'down')
    else if (sel && st.archTrace === 'route' && st.archTo && byId.has(st.archTo)) lit = route(a, sel, st.archTo)
    const z = zoomOf(L)
    const parts = [`<svg viewBox="0 0 ${L.W} ${L.H}" width="${Math.round(L.W * z)}" height="${Math.round(L.H * z)}" class="arch${lit ? ' lit' : ''}" role="group" focusable="false" aria-label="${esc(a.title)}: ${plural(a.comps.length, 'component')}, ${plural(a.conns.length, 'connection')}">`,
      '<defs><marker id="ar-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,1L9,5L0,9z" class="ahead"/></marker>' +
      '<marker id="ar-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path d="M0,1L9,5L0,9z" class="ahead on"/></marker></defs>']
    L.bounds.slice().sort((x, y) => y.level - x.level).forEach((b) => {
      const bm = (a.dv || a.ov) && a.bmarks ? a.bmarks[b.label] || null : null
      parts.push(`<g class="bound k-${esc(b.kind)}${mcls(a, bm)}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14"/><text class="blabel" x="${b.x + 14}" y="${b.y + 17}">${esc(cut(b.label.toUpperCase(), Math.floor(b.w / 7.4)))}</text>${bm ? `<title>${esc(`${b.label}${mtip(a, bm)}`)}</title>` : ''}</g>`)
    })
    const curve = (f, t) => {
      const A0 = L.boxes[byId.get(f)], B0 = L.boxes[byId.get(t)]
      if (!A0 || !B0) return null
      const x1 = A0.x + A0.w / 2, y1 = A0.y + A0.h / 2, x2 = B0.x + B0.w / 2, y2 = B0.y + B0.h / 2
      return `M${x1},${y1} Q${(x1 + x2) / 2 + (y2 - y1) * 0.15},${(y1 + y2) / 2 - (x2 - x1) * 0.15} ${x2},${y2}`
    }
    if (st.archGhosts) for (const [f, t, n] of a.ghosts) {
      const dd = curve(f, t)
      if (dd) parts.push(`<path class="ghost" d="${dd}"><title>${esc(f)} uses ${esc(t)}: ${plural(n, 'file pair')} in the graph, no line drawn</title></path>`)
    }
    // the code's new links no line draws: in the plan's colours under the delta, "added" under Changes
    if ((a.dv || a.ov) && a.links) for (const [f, t, text] of a.links) {
      const dd = curve(f, t)
      if (dd) parts.push(`<path class="newlink ${a.dv ? 'd-unpl' : 'ch-add'}" d="${dd}"><title>${esc(`${text}\n${a.dv ? 'not in the plan: in the code, not drawn yet' : `new since ${REF}: in the code, not drawn yet`}`)}</title></path>`)
    }
    const labels = []
    a.conns.forEach((e, k) => {
      const r = L.routes[k]
      if (!r) return
      const on = lit && lit.edges.has(k), touch = sel && !lit && (e.from === sel || e.to === sel)
      const m = markOf(a, e)
      const seen = a.evidence[k], cls = `conn v-${esc(e.variant || 'default')}${on || touch ? ' on' : ''}${lit && !on ? ' dim' : ''}${a.checkable[k] && !seen && !e.via && !m ? ' unseen' : ''}${mcls(a, m)}`
      const tip = `${e.from} → ${e.to}${e.label ? `: ${e.label}` : ''}${e.via ? ` (via ${e.via})` : ''}\n${a.checkable[k] ? (seen ? `seen in the graph: ${plural(seen, 'file pair')}` : 'not seen in the graph') : 'not checkable against the code'}${mtip(a, m)}`
      parts.push(`<path class="${cls}" data-k="${k}" d="${r.d}" marker-end="url(#ar-arrow${on || touch ? '-on' : ''})"><title>${esc(tip)}</title></path>`)
      if (e.label) labels.push(`<g class="clab${on || touch ? ' on' : ''}${lit && !on ? ' dim' : ''}"><rect x="${r.lx - r.tw / 2}" y="${r.ly - 9}" width="${r.tw}" height="18" rx="9"/><text x="${r.lx}" y="${r.ly + 4}" text-anchor="middle">${esc(cut(e.label, Math.min(30, r.chars || 30)))}</text><title>${esc(e.label)}</title></g>`)
    })
    parts.push(...labels)
    a.comps.forEach((c, i) => {
      const b = L.boxes[i], on = !lit || lit.nodes.has(c.id), m = markOf(a, c)
      const label = cut(String(c.label), 21), sub = c.sublabel ? cut(String(c.sublabel), 26) : ''
      const said = m ? `, ${a.dv ? mword(m) : SINCE[m.ch]}${stale(a, m) ? ', acknowledgement stale' : ''}` : ''
      parts.push(`<g class="comp t-${esc(c.type)}${sel === c.id ? ' sel' : ''}${on ? '' : ' dim'}${mcls(a, m)}" data-comp="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.label)}, ${esc(TYPE_LABEL[c.type] || c.type)}${c.sublabel ? `, ${esc(c.sublabel)}` : ''}${esc(said)}: open its passport">` +
        `<title>${esc(c.label)}${c.sublabel ? `\n${esc(c.sublabel)}` : ''}\n${esc(TYPE_LABEL[c.type] || c.type)}${a.members[i].length ? ` · ${plural(a.members[i].length, 'file')}` : ''}${esc(mtip(a, m))}</title>` +
        `<rect class="cbox" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="11"/>` +
        `<rect class="cico" x="${b.x + 10}" y="${b.y + 14}" width="34" height="34" rx="9"/>` +
        `<path class="cglyph" transform="translate(${b.x + 17},${b.y + 21})" d="${ICONS[c.type] || ICONS.library}"/>` +
        `<text class="clabel" x="${b.x + 54}" y="${b.y + (sub ? 28 : 37)}">${esc(label)}</text>` +
        (sub ? `<text class="sub" x="${b.x + 54}" y="${b.y + 45}">${esc(sub)}</text>` : '') +
        (c.tag ? `<g class="ctag"><rect x="${b.x + b.w - Math.min(90, c.tag.length * 6 + 14) - 6}" y="${b.y - 9}" width="${Math.min(90, c.tag.length * 6 + 14)}" height="17" rx="8.5"/><text x="${b.x + b.w - Math.min(90, c.tag.length * 6 + 14) / 2 - 6}" y="${b.y + 3}" text-anchor="middle">${esc(cut(c.tag, 13))}</text></g>` : '') +
        (struck(a, m) ? `<line class="strike" x1="${b.x + 52}" x2="${Math.round(b.x + 56 + Math.min(label.length * 7.4, b.w - 62))}" y1="${b.y + (sub ? 24 : 33)}" y2="${b.y + (sub ? 24 : 33)}"/>` : '') +
        (stale(a, m) ? `<g class="stalemk"><circle cx="${b.x + 6}" cy="${b.y + 6}" r="7"/><text x="${b.x + 6}" y="${b.y + 9.5}" text-anchor="middle">!</text><title>acknowledgement stale: the change was edited after it was acknowledged</title></g>` : '') +
        '</g>')
    })
    parts.push('</svg>')
    const box = h('div', { class: 'svgbox archbox', id: 'arch-box', ...nav.attrs('arch', `${a.title || 'Architecture'} diagram`) })
    box.innerHTML = parts.join('')
    const svg = box.firstChild
    // keep the reader where they were across re-renders
    if (st.archScroll) { const [x, y] = st.archScroll; st.archScroll = null; requestAnimationFrame(() => { box.scrollLeft = x; box.scrollTop = y }) }
    // drag the background or use the arrow keys to pan; the wheel, + and − zoom in place (stage-view.mjs)
    nav.scroller(box, svg, { item: '[data-comp]', W: L.W, H: L.H, min: ZMIN, max: ZMAX, zoom: () => zoomOf(L), set: (z) => { st.archZoom = z }, ctl: 'arch', fit: () => { st.archZoom = 'fit'; rerender() } })

    const hot = (id) => {
      if (lit || sel) return
      svg.classList.toggle('hover', id !== null)
      for (const el of svg.querySelectorAll('.hov')) el.classList.remove('hov')
      if (id === null) return
      for (const el of svg.querySelectorAll('[data-k]')) { const e = a.conns[Number(el.dataset.k)]; if (e.from === id || e.to === id) el.classList.add('hov') }
      for (const el of svg.querySelectorAll('[data-comp]')) if (el.dataset.comp === id || a.conns.some((e) => (e.from === id && e.to === el.dataset.comp) || (e.to === id && e.from === el.dataset.comp))) el.classList.add('hov')
    }
    svg.addEventListener('mouseover', (e) => { const g = e.target.closest('[data-comp]'); hot(g ? g.dataset.comp : null) })
    svg.addEventListener('mouseleave', () => hot(null))
    const open = (e) => {
      const g = e.target.closest('[data-comp]')
      if (!g) { if (st.archSel) { st.archSel = null; st.archTrace = null; rerender() } return }
      st.archSel = st.archSel === g.dataset.comp && !st.archTrace ? null : g.dataset.comp
      st.archTrace = null; st.archTo = null; st.focusMain = true // the keyboard lands on the passport
      rerender()
    }
    svg.addEventListener('click', open)
    svg.addEventListener('keydown', (e) => { if (activate(e) && e.target.closest('[data-comp]')) { e.preventDefault(); open(e) } })
    return box
  }

  function passport(a, id) {
    const i = a.comps.findIndex((c) => c.id === id), c = a.comps[i]
    if (!c) return null
    const name = (x) => (a.comps.find((o) => o.id === x) || { label: x }).label
    const mem = a.members[i].map((fid) => files.get(fid)).filter(Boolean)
    const conn = (e, k, other) => h('li', null,
      h('button', { class: 'linkbtn', onclick: () => { st.archSel = other; st.archTrace = null; rerender() } }, name(other)),
      e.label ? h('span', { class: 'muted' }, ` · ${e.label}`) : null, e.via ? h('span', { class: 'muted' }, ` · via ${e.via}`) : null,
      a.checkable[k] ? h('span', { class: `pill ${a.evidence[k] ? 'ok' : 'warn'}` }, a.evidence[k] ? `seen: ${plural(a.evidence[k], 'file pair')}` : 'not in the graph') : null)
    const outs = a.conns.map((e, k) => [e, k]).filter(([e]) => e.from === id), ins = a.conns.map((e, k) => [e, k]).filter(([e]) => e.to === id)
    const ghosts = a.ghosts.filter(([f, t]) => f === id || t === id)
    const others = a.comps.filter((o) => o.id !== id)
    const routeSel = h('select', { 'aria-label': 'Route to', 'data-ctl': 'arch-route', onchange: (e) => { st.archTo = e.target.value || null; st.archTrace = st.archTo ? 'route' : null; rerender() } },
      h('option', { value: '' }, 'Route to…'), others.map((o) => h('option', { value: o.id }, o.label)))
    routeSel.value = st.archTrace === 'route' && st.archTo ? st.archTo : ''
    const r = st.archTrace === 'route' && st.archTo ? route(a, id, st.archTo) : null
    const tr = (k, label) => h('button', { 'data-ctl': `arch-${k}`, 'aria-pressed': String(st.archTrace === k), onclick: () => { st.archTrace = st.archTrace === k ? null : k; st.archTo = null; rerender() } }, label)
    const srcLink = (s) => {
      const pre = /^([^:/\s]+):(.+)$/.exec(s)
      const named = pre && D.repos.some((x) => x.name === pre[1])
      const repo = named ? pre[1] : c.repo || null
      const p = (/^(.+?)(?::\d+(?:-\d+)?)?$/.exec(named ? pre[2] : s) || [])[1]
      const f = [...files.values()].find((x) => x.path === p && (!repo || x.repo === repo))
      return f ? h('span', null, h('a', { class: 'jump mono', href: `#file-${f.id}` }, s)) : h('code', null, s)
    }
    return h('div', { class: 'detail passport' },
      h('h3', null, h('span', { class: `tdot t-${c.type}` }), c.label, h('span', { class: 'pill' }, TYPE_LABEL[c.type] || c.type), c.tag ? h('span', { class: 'pill' }, c.tag) : null),
      c.sublabel ? h('div', { class: 'muted' }, c.sublabel) : null,
      c.note ? h('p', null, c.note) : null,
      h('div', { class: 'seg trace' }, tr('up', 'Upstream'), tr('down', 'Downstream'), routeSel,
        st.archTrace ? h('button', { 'data-ctl': 'arch-clear', onclick: () => { st.archTrace = null; st.archTo = null; rerender() } }, 'Clear') : null),
      st.archTrace === 'route' && st.archTo ? h('p', { class: 'note' }, r ? `${plural(r.hops, 'hop')} to ${name(st.archTo)}${r.directed ? ', following the arrows' : ', ignoring the arrows: there is no directed route'}` : `No route to ${name(st.archTo)} along the drawn lines.`) : null,
      st.archTrace === 'up' || st.archTrace === 'down' ? h('p', { class: 'note' }, `Highlighted: what ${st.archTrace === 'up' ? 'reaches' : 'is reached from'} ${c.label} along the drawn connections. Drawn lines only: not runtime impact.`) : null,
      h('h2', null, `Connections out (${outs.length})`), outs.length ? h('ul', { class: 'links' }, outs.map(([e, k]) => conn(e, k, e.to))) : h('div', { class: 'muted' }, 'none drawn'),
      h('h2', null, `Connections in (${ins.length})`), ins.length ? h('ul', { class: 'links' }, ins.map(([e, k]) => conn(e, k, e.from))) : h('div', { class: 'muted' }, 'none drawn'),
      ghosts.length ? h('div', null, h('h2', null, 'In the code, not drawn'), h('ul', { class: 'links' }, ghosts.map(([f, t, n]) => h('li', null, f === id ? `uses ${name(t)}` : `used by ${name(f)}`, h('span', { class: 'pill warn' }, plural(n, 'file pair')))))) : null,
      changesHere(a, id),
      c.sources && c.sources.length ? h('div', null, h('h2', null, 'Sources'), h('ul', { class: 'links' }, c.sources.map((s) => h('li', null, srcLink(s))))) : null,
      h('h2', null, c.imports && c.imports.length && !mem.length ? 'Reached through imports' : mem.length ? `Code (${plural(mem.length, 'file')})` : 'Code'),
      !mem.length && !(c.imports && c.imports.length) ? h('div', { class: 'muted' }, c.paths && c.paths.length ? 'Its paths match no indexed file.' : 'None in the index: it is tied to the code by its sources.') : null,
      c.imports && c.imports.length ? h('div', { class: 'mono muted' }, c.imports.join(' · ')) : null,
      c.paths && c.paths.length ? h('div', { class: 'mono muted' }, c.paths.join(' · ')) : null,
      mem.length ? h('ul', { class: 'links' }, mem.slice(0, 12).map((f) => h('li', null, jumpFile(f))), mem.length > 12 ? h('li', { class: 'muted' }, `+${mem.length - 12} more`) : null) : null)
  }

  // what the overlay on says about one component, in its passport: the delta's changes that concern
  // it (it, or a line that meets it) and the branch's impact on it outside them; or its changes since
  // the base
  function changesHere(a, id) {
    if (a.dv) {
      const d = a.delta, ks = a.ks.filter((k) => ends(d.arch.changes[k].target).includes(id)), us = a.us.filter((j) => ends(d.arch.unplanned[j].target).includes(id))
      return ks.length || us.length ? [h('h2', null, `Delta: ${plural(ks.length, 'change')}${us.length ? `, ${us.length} not in the plan` : ''}`), h('ul', { class: 'links dlist' }, ks.map((k) => deltaItem(d, k, 'p')), us.map((j) => unplItem(d, j)))] : null
    }
    if (a.ov) {
      const xs = a.list.filter((x) => ends(x.target).includes(id)), fs = a.findings.filter((x) => ends(x.target).includes(id))
      return xs.length || fs.length ? [h('h2', null, `Changes since ${REF} (${xs.length + fs.length})`), h('ul', { class: 'links dlist' }, xs.map(chItem), fs.map(findItem))] : null
    }
    return null
  }
  const chItem = (x) => h('li', { class: `ch-${CLS[x.change]}` }, h('div', null, h('span', { class: 'mono' }, x.target), h('span', { class: `pill ${CLS[x.change]}` }, SINCE[x.change])), h('div', { class: 'srcline' }, x.text))
  const findItem = (x) => h('li', { class: 'ch-add' }, h('div', null, h('span', { class: 'mono' }, x.target || x.kind), h('span', { class: 'pill add' }, 'in the code, new')), h('div', { class: 'srcline' }, x.text))

  // ── the delta's changes: one item each, its state, why, slice and acknowledgement (as the Data tab) ──
  const ackText = (c) => (c.ack === 'acked' ? `acknowledged by ${c.by} at ${c.at}` : c.ack === 'stale' ? `stale: acknowledged by ${c.by} at ${c.at}, edited since` : 'not acknowledged')
  function deltaItem(d, k, where) {
    const c = d.arch.changes[k], [cls, word] = STATE[c.state]
    return h('li', { class: `dl-${cls}` },
      h('div', null, h('span', { class: 'mono' }, c.text), h('span', { class: `pill dl-${cls}` }, word), c.ack === 'stale' ? h('span', { class: 'pill dl-stale' }, 'stale') : null, c.origin === 'unplanned' ? h('span', { class: 'pill d-unpl' }, 'unplanned, kept') : null),
      c.after ? h('div', { class: 'srcline' }, 'as: ', h('code', null, c.after)) : null,
      c.diffs.length ? h('div', { class: 'srcline chgline' }, `planned → built: ${c.diffs.join('; ')}`) : null,
      c.proposed.length ? h('div', { class: 'srcline' }, `proposed: ${c.proposed.join('; ')}`) : null,
      c.warn ? h('div', { class: 'srcline err' }, `⚠ ${c.warn}`) : null,
      c.src.length ? h('div', { class: 'srcline' }, 'drawn in: ', c.src.flatMap((x, j) => [j ? ' · ' : null, h('code', null, x)])) : null,
      h('div', { class: 'srcline' }, `why: ${c.why}`),
      h('div', { class: 'srcline' }, c.slice !== null ? `slice ${c.slice} · ` : 'no slice yet · ', h('span', { class: c.ack === 'acked' ? null : 'dlack' }, ackText(c)), ackBtn(d, [k], c.ack !== 'acked', where, c.ack === 'acked' ? 'Unacknowledge' : c.ack === 'stale' ? 'Acknowledge again' : 'Acknowledge')))
  }
  const unplItem = (d, j) => { const u = d.arch.unplanned[j]; return h('li', { class: 'dl-unpl' }, h('div', null, h('span', { class: 'mono' }, u.target || u.kind), h('span', { class: 'pill d-unpl' }, 'not in the plan'), h('span', { class: 'pill' }, u.built ? 'drawn in the branch' : 'in the code, not drawn')), h('div', { class: 'srcline' }, u.text), h('div', { class: 'srcline muted' }, u.file)) }
  // served only, and only for a delta beside the specs: the server writes the acknowledgement; its
  // answer is said beside the control (with a Reload when the file changed since the page loaded)
  function ackBtn(d, ks, on, where, label) {
    if (!SERVE || !d.ackable || !ks.length) return null
    const ctl = `arch-ack-${where}${ks.length === 1 ? ks[0] : 'all'}`, said = st.dlStatus && st.dlStatus.ctl === ctl ? st.dlStatus : null
    return [h('button', { class: 'linkbtn dlbtn', 'data-ctl': ctl, title: on ? 'Write an acknowledgement into the delta: who, when, and the hash of the change as it is now' : 'Remove the acknowledgement from the delta', onclick: () => ack(d, ks, on, ctl) }, label),
      said ? h('span', { class: `dlstatus${said.conflict ? ' err' : ''}`, role: 'status', 'data-status-for': ctl }, said.text, said.conflict ? [' ', h('button', { class: 'linkbtn', 'data-ctl': 'arch-delta-reload', title: 'Load the page again, with the delta as it is on disk now', onclick: reload }, 'Reload')] : null) : null]
  }
  function reload() {
    try { sessionStorage.setItem('grimoire-arch-delta', JSON.stringify({ archDelta: !!st.archDelta, deltaSel: dsel(), delta: DL[dsel()] ? DL[dsel()].shown : null, arch: ix() })) } catch {}
    location.reload()
  }
  async function ack(d, ks, on, ctl) {
    const say = (text, conflict = false) => { st.dlStatus = { ctl, text, conflict } }
    say('Saving…')
    try {
      const r = await fetch('/api/delta', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-grimoire-token': SERVE.token }, body: JSON.stringify({ repo: d.repo, path: d.path, base: d.hash, ids: ks.map((k) => d.arch.changes[k].id), ack: on }) })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        d.hash = j.hash // the one delta object both tabs send
        for (const x of j.changes || []) for (const list of [d.arch.changes, d.changes || []]) { const c = list.find((y) => y.id === x.id); if (c) Object.assign(c, { ack: x.ack ? 'acked' : null, by: x.ack ? x.ack.by : null, at: x.ack ? x.ack.at : null }) }
        say(`${on ? 'Acknowledged' : 'Acknowledgement removed'}: ${plural(ks.length, 'change')}, written to ${d.shown}`)
      } else if (r.status === 409) say('Not saved: the delta changed on disk since this page was loaded. Reload it to see it as it is now, then acknowledge again.', true)
      else say(`Not saved: ${j.error || `HTTP ${r.status}`}`)
    } catch (e) { say(`Not saved: the server is not answering (${e.message})`) }
    rerender()
  }
  // the delta as a whole: which, for which design, its counts, what cannot be drawn
  function deltaHead(d) {
    if (d.errors.length) return h('div', { class: 'callout callout-danger banner' }, h('div', { class: 'callout-title' }, `${d.shown} does not validate (${plural(d.errors.length, 'problem')}): nothing drawn`), h('ul', { class: 'links' }, d.errors.map((e) => h('li', null, e))))
    const cs = d.arch.changes, k = (f) => cs.filter(f).length
    return h('div', { class: 'callout banner dlhead' },
      h('div', { class: 'callout-title' }, 'Delta ', h('span', { class: 'mono' }, d.shown)),
      h('p', null, 'For ', h('code', null, d.spec), `: ${plural(cs.length, 'architecture change')} · ${k((c) => c.state === 'planned-built')} planned and built · ${k((c) => c.state === 'pending')} pending · ${k((c) => c.state === 'built-differently')} built differently${d.arch.unplWhy ? '' : ` · ${d.arch.unplanned.length} not in the plan`} · ${k((c) => c.ack === 'acked')} acknowledged · ${k((c) => c.ack === 'stale')} stale`),
      d.arch.unplWhy ? h('p', { class: 'note' }, `Not in the plan: not listed, ${d.arch.unplWhy}.`) : d.arch.codeWhy ? h('p', { class: 'note' }, `Only the diagram files were compared: the code was not (${d.arch.codeWhy}).`) : null,
      !SERVE ? h('p', { class: 'note' }, 'Read-only snapshot. To acknowledge changes, serve the page: ', h('code', null, 'graph.mjs serve')) : !d.ackable ? h('p', { class: 'note' }, 'This delta is not beside the specs of a repository (docs/specs/<name>.delta.json): acknowledge it by editing the file.') : null,
      d.arch.outside.length ? [h('p', { class: 'note' }, `Not drawn: no saved diagram holds what they concern (${d.arch.outside.length})`), h('ul', { class: 'links dlist' }, d.arch.outside.map((i) => deltaItem(d, i, 'o')))] : null)
  }
  // the delta on this diagram: its legend, its counts, every change it carries here
  function deltaPanel(a) {
    const d = a.delta, ks = a.ks, us = a.us
    const n = (x) => ks.filter((k) => d.arch.changes[k].state === x).length
    const open = ks.filter((k) => d.arch.changes[k].ack !== 'acked')
    return [
      h('div', { class: 'legend dlegend chlegend', role: 'note', 'aria-label': 'Delta legend' }, h('b', null, 'Delta:'),
        h('span', null, h('i', { class: 'chsw d-prop' }), 'proposed (dashed)'), h('span', null, h('i', { class: 'chsw d-rm' }), h('s', null, 'proposed removal')), h('span', null, h('i', { class: 'chsw d-pend' }), 'proposed change: now → planned'),
        h('span', null, h('i', { class: 'chsw d-built' }), 'planned and built'), h('span', null, h('i', { class: 'chsw d-diff' }), 'built differently: planned → built'),
        h('span', null, h('i', { class: 'chsw d-unpl' }), 'not in the plan (dotted: in the code, not drawn yet)'), h('span', null, h('i', { class: 'chsw dl-stale' }), 'acknowledgement stale')),
      h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, ks.length || us.length ? `${n('planned-built')} planned and built · ${n('pending')} pending · ${n('built-differently')} built differently${d.arch.unplWhy ? '' : ` · ${us.length} not in the plan`} · ${ks.length - open.length} of ${ks.length} acknowledged` : 'The delta changes nothing on this diagram.'),
        open.length ? ackBtn(d, open, true, 'd', `Acknowledge all ${plural(open.length, 'change')} not acknowledged on this diagram`) : null),
      ks.length || us.length ? h('details', { class: 'problems dlchanges', open: st.dlOpen === false ? null : 'open', ontoggle: (e) => { st.dlOpen = e.target.open } }, h('summary', null, `Changes on this diagram (${ks.length})${us.length ? `, and ${us.length} not in the plan` : ''}`),
        h('ul', { class: 'links dlist' }, ks.map((k) => deltaItem(d, k, 'l')), us.map((j) => unplItem(d, j)))) : null]
  }
  // the branch against its base on this diagram: the legend, the counts, the list
  function changesPanel(a) {
    const k = a.n
    return [
      h('div', { class: 'legend dlegend chlegend', role: 'note', 'aria-label': 'Change overlay legend' }, h('b', null, `Changes since ${REF}:`),
        h('span', null, h('i', { class: 'chsw add' }), 'added'), h('span', null, h('i', { class: 'chsw del' }), h('s', null, 'removed'), ' (drawn where it stood)'),
        h('span', null, h('i', { class: 'chsw mod' }), 'modified: before → after'), h('span', null, h('i', { class: 'chsw newl' }), 'in the code, not drawn: a new link (dotted)')),
      h('div', { class: 'toolbar' }, a.change === 'added' ? h('span', { class: 'pill add' }, `diagram added since ${REF}`) : null, h('span', { class: 'muted' }, `${k.added} added · ${k.removed} removed · ${k.modified} modified · ${CH.codeWhy ? 'the code not compared' : `${plural(k.findings, 'new finding')} in the code`}`)),
      CH.codeWhy ? h('p', { class: 'note' }, `Only the diagram files were compared: the code was not (${CH.codeWhy}).`) : null,
      a.list.length || a.findings.length ? h('ul', { class: 'links dlist' }, a.list.map(chItem), a.findings.map(findItem)) : h('p', { class: 'muted' }, `No change to this diagram, nor in the code it draws, since ${REF}.`)]
  }

  function view() {
    if (!A.length) return h('section', null, h('p', { class: 'muted' }, 'No architecture diagram: the index holds no production code to draft one from.'))

    const k0 = ix(), a = shownArch(A[k0], k0)
    const seg = A.length > 1 ? h('div', { class: 'seg' }, A.map((x, k) => h('button', { 'data-ctl': `arch-${k}`, 'aria-pressed': String(k === ix()), title: x.file || 'drafted from the graph on every render', onclick: () => { st.arch = k; st.archSel = null; st.archTrace = null; st.archScroll = null; render() } }, x.auto ? 'From the graph (auto)' : x.title || x.file))) : null
    if (a.errors && !a.comps) {
      return h('section', null, h('div', { class: 'toolbar' }, seg), h('div', { class: 'detail problems' }, h('h3', null, a.file), h('p', null, 'This diagram does not pass its check, so it is not drawn:'), h('ul', null, a.errors.map((e) => h('li', null, e)))))
    }
    const types = [...new Set(a.comps.map((c) => c.type))]
    const legend = h('div', { class: 'legend' }, types.map((t) => h('span', null, h('i', { class: `tdot t-${t}` }), TYPE_LABEL[t] || t)),
      a.ghosts.length ? h('label', { class: 'tog' }, h('input', { type: 'checkbox', 'data-ctl': 'arch-ghosts', checked: st.archGhosts ? 'checked' : null, onchange: (e) => { st.archGhosts = e.target.checked; rerender() } }), `Code links not drawn (${a.ghosts.length})`) : null)
    const zoom = (z) => { st.archZoom = z; rerender() }
    const by = (d) => () => zoom(nav.step(zoomOf(a.layout), d, ZMIN, ZMAX)) // from the zoom as it is now: the wheel or a key may have changed it
    const cur = st.archZoom === 'fit' ? 'fit' : st.archZoom || 1
    const zoomSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zoom' },
      h('button', { 'data-ctl': 'arch-fit', 'aria-pressed': String(cur === 'fit'), title: 'Fit the diagram to the page (0)', onclick: () => zoom('fit') }, 'Fit'),
      h('button', { 'data-ctl': 'arch-out', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: by(-1) }, '−'),
      h('button', { 'data-ctl': 'arch-100', 'aria-pressed': String(cur === 1), title: 'Natural size', onclick: () => zoom(1) }, cur === 'fit' ? `${Math.round(zoomOf(a.layout) * 100)}%` : `${Math.round(cur * 100)}%`),
      h('button', { 'data-ctl': 'arch-in', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: by(1) }, '+'))
    const head = h('div', { class: 'toolbar' }, seg, h('span', { class: 'muted' }, `${plural(a.comps.length, 'component')} · ${plural(a.conns.length, 'connection')}${a.checked ? ` · ${a.checked}` : ''}`))
    const banner = a.auto || a.draft ? h('div', { class: 'callout callout-warning banner' }, h('div', { class: 'callout-title' }, a.auto ? 'Drafted from the graph on this render' : 'A draft from the graph, not refined yet'),
      h('p', null, 'One component per module, typed by folder names and imports; every name, type and grouping is a guess. ', h('code', null, '/grimoire:architecture'), a.auto ? ' writes it to docs/architecture and has an agent refine it from the code.' : ' has an agent refine it from the code.')) : null
    const problems = (a.errors || []).length || (a.warnings || []).length ? h('details', { class: 'problems' }, h('summary', null, `The check: ${plural((a.errors || []).length, 'error')}, ${plural((a.warnings || []).length, 'warning')}`),
      h('ul', null, (a.errors || []).map((e) => h('li', { class: 'err' }, e)), (a.warnings || []).map((w) => h('li', null, w)), (a.info || []).map((w) => h('li', { class: 'muted' }, w)))) : (a.info || []).length ? h('p', { class: 'note' }, a.info.join(' · ')) : null
    // the overlays' switches, one on at a time: the branch against its base, a design's delta
    const ch = !!(st.archChanges && A[k0].ch), dl = DL.length ? DL[dsel()] : null, don = !!st.archDelta && !!dl
    const toggle = A[k0].ch || DL.length ? h('div', { class: 'toolbar dchanges' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Overlay' },
        A[k0].ch ? h('button', { 'data-ctl': 'arch-changes', 'aria-pressed': String(ch), title: `Draw what changed against ${CH.base ? CH.base.text : ''}`, onclick: () => { st.archChanges = !st.archChanges; st.archDelta = false; rerender() } }, `Changes vs ${REF}`) : null,
        DL.length ? h('button', { 'data-ctl': 'arch-delta', 'aria-pressed': String(don), title: 'Draw a design\'s proposed architecture changes over the diagram, each with its state against the diagrams', onclick: () => { st.archDelta = !st.archDelta; st.archChanges = false; rerender() } }, 'Delta') : null),
      DL.length > 1 ? h('select', { 'data-ctl': 'arch-delta-file', 'aria-label': 'Which delta', onchange: (e) => { st.deltaSel = Number(e.target.value); st.archDelta = true; st.archChanges = false; st.dlStatus = null; rerender() } }, DL.map((x, i) => h('option', { value: String(i), selected: i === dsel() ? 'selected' : null }, x.shown))) : null,
      h('span', { class: 'muted' }, ch ? `against ${CH.base.text}` : don ? `the delta ${dl.shown} over the diagram` : `off: ${A[k0].ch ? `Changes draws what changed against ${CH.base.text}` : ''}${A[k0].ch && DL.length ? '; ' : ''}${DL.length ? 'Delta draws a design\'s architecture changes over the diagram' : ''}`)) : null
    const why = !CH.base && !A[k0].auto ? h('p', { class: 'note' }, `No change overlay: ${CH.why || 'no base was resolved'}.`) : null
    const removed = ch && CH.removed && CH.removed.length ? h('div', { class: 'callout callout-danger banner' }, h('div', { class: 'callout-title' }, `Diagrams removed since ${REF} (${CH.removed.length})`), h('ul', { class: 'links' }, CH.removed.map((x) => h('li', null, h('b', { class: 'mono struck' }, x.file), ` ${x.title} · ${plural(x.n, 'element')}`)))) : null
    const overlayParts = [toggle, why, removed, don ? deltaHead(dl) : null, a.dv ? deltaPanel(a) : null, a.ov ? changesPanel(a) : null]
    const sel = st.archSel && a.comps.some((c) => c.id === st.archSel) ? passport(a, st.archSel) : null
    const draw = stage('arch', 'Diagram', diagram(a), zoomSeg, sel)

    const cards = Array.isArray(a.cards) && a.cards.length ? h('div', { class: 'cards arch-cards' }, a.cards.map((c) => h('div', { class: `card acard c-${c.color || 'slate'}` }, h('div', { class: 'acard-title' }, h('i', null), c.title), h('ul', null, c.items.map((x) => h('li', null, x)))))) : null
    const note = h('p', { class: 'note' }, `${a.file ? `${a.file} · ` : ''}Scroll to zoom, drag to pan; with the diagram focused, the arrow keys pan (Shift: a page), + and − zoom, 0 fits. Click a component for its passport; Upstream, Downstream and Route follow the drawn lines. A line the graph confirms is solid; one it cannot see between two code components is dashed amber, unless it says what carries it (via). The graph is a map: read the code at the sources.`)
    return h('section', null, head, a.summary ? h('p', { class: 'summary' }, a.summary) : null, banner, problems, ...overlayParts, legend,
      sel && st.full !== 'arch' ? h('section', { class: 'split rev' }, h('div', null, draw), h('aside', { class: 'side' }, sel)) : draw, note, cards)
  }
  return { view }
}
