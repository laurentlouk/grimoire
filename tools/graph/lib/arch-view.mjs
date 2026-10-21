// grimoire graph · the page's Architecture tab. Runs in the browser only: render.mjs injects this
// function's source next to the page's helpers (esc, cut, plural) and calls it with the page's
// context. The diagrams arrive laid out (arch.mjs, layoutArch): this draws them, and lets a reader
// focus a component (its passport: code it covers, sources, connections and what the graph says
// about each), trace what it reaches upstream or downstream along the drawn connections, find the
// route between two components, and show the code links no line draws. Reach and route follow the
// diagram's own lines: authored reachability, not runtime impact.
export function archClient(ctx) {
  const { D, h, st, files, render, jumpFile, activate } = ctx
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

  let pan = null, moved = false // a drag on the background pans the diagram; one listener ends it
  window.addEventListener('mouseup', () => { pan = null })
  // natural size by default (readable; drag or the scrollbars pan, the wheel zooms); Fit shows it all
  const ZMIN = 0.2, ZMAX = 3
  const zoomOf = (L) => st.archZoom === 'fit' ? Math.min(1, Math.max(0.2, ((document.getElementById('arch-box') || {}).clientWidth || 1100) / (L.W + 8))) : st.archZoom || 1
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
      parts.push(`<g class="bound k-${esc(b.kind)}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14"/><text class="blabel" x="${b.x + 14}" y="${b.y + 17}">${esc(cut(b.label.toUpperCase(), Math.floor(b.w / 7.4)))}</text></g>`)
    })
    if (st.archGhosts) for (const [f, t, n] of a.ghosts) {
      const A0 = L.boxes[byId.get(f)], B0 = L.boxes[byId.get(t)]
      if (!A0 || !B0) continue
      const x1 = A0.x + A0.w / 2, y1 = A0.y + A0.h / 2, x2 = B0.x + B0.w / 2, y2 = B0.y + B0.h / 2
      parts.push(`<path class="ghost" d="M${x1},${y1} Q${(x1 + x2) / 2 + (y2 - y1) * 0.15},${(y1 + y2) / 2 - (x2 - x1) * 0.15} ${x2},${y2}"><title>${esc(f)} uses ${esc(t)}: ${plural(n, 'file pair')} in the graph, no line drawn</title></path>`)
    }
    const labels = []
    a.conns.forEach((e, k) => {
      const r = L.routes[k]
      if (!r) return
      const on = lit && lit.edges.has(k), touch = sel && !lit && (e.from === sel || e.to === sel)
      const seen = a.evidence[k], cls = `conn v-${esc(e.variant || 'default')}${on || touch ? ' on' : ''}${lit && !on ? ' dim' : ''}${a.checkable[k] && !seen && !e.via ? ' unseen' : ''}`
      const tip = `${e.from} → ${e.to}${e.label ? `: ${e.label}` : ''}${e.via ? ` (via ${e.via})` : ''}\n${a.checkable[k] ? (seen ? `seen in the graph: ${plural(seen, 'file pair')}` : 'not seen in the graph') : 'not checkable against the code'}`
      parts.push(`<path class="${cls}" data-k="${k}" d="${r.d}" marker-end="url(#ar-arrow${on || touch ? '-on' : ''})"><title>${esc(tip)}</title></path>`)
      if (e.label) labels.push(`<g class="clab${on || touch ? ' on' : ''}${lit && !on ? ' dim' : ''}"><rect x="${r.lx - r.tw / 2}" y="${r.ly - 9}" width="${r.tw}" height="18" rx="9"/><text x="${r.lx}" y="${r.ly + 4}" text-anchor="middle">${esc(cut(e.label, Math.min(30, r.chars || 30)))}</text><title>${esc(e.label)}</title></g>`)
    })
    parts.push(...labels)
    a.comps.forEach((c, i) => {
      const b = L.boxes[i], on = !lit || lit.nodes.has(c.id)
      const label = cut(c.label, 21), sub = c.sublabel ? cut(c.sublabel, 26) : ''
      parts.push(`<g class="comp t-${esc(c.type)}${sel === c.id ? ' sel' : ''}${on ? '' : ' dim'}" data-comp="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(c.label)}, ${esc(TYPE_LABEL[c.type] || c.type)}${c.sublabel ? `, ${esc(c.sublabel)}` : ''}: open its passport">` +
        `<title>${esc(c.label)}${c.sublabel ? `\n${esc(c.sublabel)}` : ''}\n${esc(TYPE_LABEL[c.type] || c.type)}${a.members[i].length ? ` · ${plural(a.members[i].length, 'file')}` : ''}</title>` +
        `<rect class="cbox" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="11"/>` +
        `<rect class="cico" x="${b.x + 10}" y="${b.y + 14}" width="34" height="34" rx="9"/>` +
        `<path class="cglyph" transform="translate(${b.x + 17},${b.y + 21})" d="${ICONS[c.type] || ICONS.library}"/>` +
        `<text class="clabel" x="${b.x + 54}" y="${b.y + (sub ? 28 : 37)}">${esc(label)}</text>` +
        (sub ? `<text class="sub" x="${b.x + 54}" y="${b.y + 45}">${esc(sub)}</text>` : '') +
        (c.tag ? `<g class="ctag"><rect x="${b.x + b.w - Math.min(90, c.tag.length * 6 + 14) - 6}" y="${b.y - 9}" width="${Math.min(90, c.tag.length * 6 + 14)}" height="17" rx="8.5"/><text x="${b.x + b.w - Math.min(90, c.tag.length * 6 + 14) / 2 - 6}" y="${b.y + 3}" text-anchor="middle">${esc(cut(c.tag, 13))}</text></g>` : '') +
        '</g>')
    })
    parts.push('</svg>')
    const box = h('div', { class: 'svgbox archbox', id: 'arch-box' })
    box.innerHTML = parts.join('')
    const svg = box.firstChild
    // keep the reader where they were across re-renders; drag the background to pan
    if (st.archScroll) { const [x, y] = st.archScroll; st.archScroll = null; requestAnimationFrame(() => { box.scrollLeft = x; box.scrollTop = y }) }
    box.addEventListener('mousedown', (e) => { if (e.button !== 0 || e.target.closest('[data-comp]')) return; pan = [e.clientX, e.clientY, box.scrollLeft, box.scrollTop]; moved = false })
    box.addEventListener('mousemove', (e) => { if (!pan) return; const dx = e.clientX - pan[0], dy = e.clientY - pan[1]; if (Math.abs(dx) + Math.abs(dy) > 3) moved = true; box.scrollLeft = pan[2] - dx; box.scrollTop = pan[3] - dy })
    // the wheel (or a trackpad pinch, which arrives as a wheel with ctrlKey) zooms around the
    // pointer, as d3-zoom and React Flow do: the point under it stays put. Resized in place, no
    // re-render, so it keeps up with a trackpad's stream of small deltas.
    box.addEventListener('wheel', (e) => {
      e.preventDefault()
      const z = zoomOf(L), r = svg.getBoundingClientRect()
      const ux = (e.clientX - r.left) / z, uy = (e.clientY - r.top) / z
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
      const nz = Math.min(ZMAX, Math.max(ZMIN, z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002))))
      if (Math.abs(nz - z) < 1e-4) return
      st.archZoom = nz
      svg.setAttribute('width', String(Math.round(L.W * nz))); svg.setAttribute('height', String(Math.round(L.H * nz)))
      const n = svg.getBoundingClientRect()
      box.scrollLeft += n.left + ux * nz - e.clientX; box.scrollTop += n.top + uy * nz - e.clientY
      const pct = document.querySelector('[data-ctl="arch-100"]'), fit = document.querySelector('[data-ctl="arch-fit"]')
      if (pct) { pct.textContent = `${Math.round(nz * 100)}%`; pct.setAttribute('aria-pressed', String(Math.abs(nz - 1) < 0.005)) }
      if (fit) fit.setAttribute('aria-pressed', 'false')
    }, { passive: false })

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
      if (moved) { moved = false; return }
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
      c.sources && c.sources.length ? h('div', null, h('h2', null, 'Sources'), h('ul', { class: 'links' }, c.sources.map((s) => h('li', null, srcLink(s))))) : null,
      h('h2', null, c.imports && c.imports.length && !mem.length ? 'Reached through imports' : mem.length ? `Code (${plural(mem.length, 'file')})` : 'Code'),
      !mem.length && !(c.imports && c.imports.length) ? h('div', { class: 'muted' }, c.paths && c.paths.length ? 'Its paths match no indexed file.' : 'None in the index: it is tied to the code by its sources.') : null,
      c.imports && c.imports.length ? h('div', { class: 'mono muted' }, c.imports.join(' · ')) : null,
      c.paths && c.paths.length ? h('div', { class: 'mono muted' }, c.paths.join(' · ')) : null,
      mem.length ? h('ul', { class: 'links' }, mem.slice(0, 12).map((f) => h('li', null, jumpFile(f))), mem.length > 12 ? h('li', { class: 'muted' }, `+${mem.length - 12} more`) : null) : null)
  }

  function view() {
    if (!A.length) return h('section', null, h('p', { class: 'muted' }, 'No architecture diagram: the index holds no production code to draft one from.'))
    const a = A[ix()]
    const seg = A.length > 1 ? h('div', { class: 'seg' }, A.map((x, k) => h('button', { 'data-ctl': `arch-${k}`, 'aria-pressed': String(k === ix()), title: x.file || 'drafted from the graph on every render', onclick: () => { st.arch = k; st.archSel = null; st.archTrace = null; st.archScroll = null; render() } }, x.auto ? 'From the graph (auto)' : x.title || x.file))) : null
    if (a.errors && !a.comps) {
      return h('section', null, h('div', { class: 'toolbar' }, seg), h('div', { class: 'detail problems' }, h('h3', null, a.file), h('p', null, 'This diagram does not pass its check, so it is not drawn:'), h('ul', null, a.errors.map((e) => h('li', null, e)))))
    }
    const types = [...new Set(a.comps.map((c) => c.type))]
    const legend = h('div', { class: 'legend' }, types.map((t) => h('span', null, h('i', { class: `tdot t-${t}` }), TYPE_LABEL[t] || t)),
      a.ghosts.length ? h('label', { class: 'tog' }, h('input', { type: 'checkbox', 'data-ctl': 'arch-ghosts', checked: st.archGhosts ? 'checked' : null, onchange: (e) => { st.archGhosts = e.target.checked; rerender() } }), `Code links not drawn (${a.ghosts.length})`) : null)
    const zoom = (z) => { st.archZoom = z; rerender() }
    const cur = st.archZoom === 'fit' ? 'fit' : st.archZoom || 1
    const zoomSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zoom' },
      h('button', { 'data-ctl': 'arch-fit', 'aria-pressed': String(cur === 'fit'), title: 'Fit the diagram to the page', onclick: () => zoom('fit') }, 'Fit'),
      h('button', { 'data-ctl': 'arch-out', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoom(Math.max(ZMIN, Math.round(((cur === 'fit' ? zoomOf(a.layout) : cur) - 0.15) * 100) / 100)) }, '−'),
      h('button', { 'data-ctl': 'arch-100', 'aria-pressed': String(cur === 1), title: 'Natural size', onclick: () => zoom(1) }, cur === 'fit' ? `${Math.round(zoomOf(a.layout) * 100)}%` : `${Math.round(cur * 100)}%`),
      h('button', { 'data-ctl': 'arch-in', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => zoom(Math.min(ZMAX, Math.round(((cur === 'fit' ? zoomOf(a.layout) : cur) + 0.15) * 100) / 100)) }, '+'))
    const head = h('div', { class: 'toolbar' }, seg, zoomSeg, h('span', { class: 'muted' }, `${plural(a.comps.length, 'component')} · ${plural(a.conns.length, 'connection')}${a.checked ? ` · ${a.checked}` : ''}`))
    const banner = a.auto || a.draft ? h('div', { class: 'callout callout-warning banner' }, h('div', { class: 'callout-title' }, a.auto ? 'Drafted from the graph on this render' : 'A draft from the graph, not refined yet'),
      h('p', null, 'One component per module, typed by folder names and imports; every name, type and grouping is a guess. ', h('code', null, '/grimoire:architecture'), a.auto ? ' writes it to docs/architecture and has an agent refine it from the code.' : ' has an agent refine it from the code.')) : null
    const problems = (a.errors || []).length || (a.warnings || []).length ? h('details', { class: 'problems' }, h('summary', null, `The check: ${plural((a.errors || []).length, 'error')}, ${plural((a.warnings || []).length, 'warning')}`),
      h('ul', null, (a.errors || []).map((e) => h('li', { class: 'err' }, e)), (a.warnings || []).map((w) => h('li', null, w)), (a.info || []).map((w) => h('li', { class: 'muted' }, w)))) : (a.info || []).length ? h('p', { class: 'note' }, a.info.join(' · ')) : null
    const sel = st.archSel && a.comps.some((c) => c.id === st.archSel) ? passport(a, st.archSel) : null
    const draw = diagram(a)
    const cards = Array.isArray(a.cards) && a.cards.length ? h('div', { class: 'cards arch-cards' }, a.cards.map((c) => h('div', { class: `card acard c-${c.color || 'slate'}` }, h('div', { class: 'acard-title' }, h('i', null), c.title), h('ul', null, c.items.map((x) => h('li', null, x)))))) : null
    const note = h('p', { class: 'note' }, `${a.file ? `${a.file} · ` : ''}Scroll to zoom, drag to pan. Click a component for its passport; Upstream, Downstream and Route follow the drawn lines. A line the graph confirms is solid; one it cannot see between two code components is dashed amber, unless it says what carries it (via). The graph is a map: read the code at the sources.`)
    return h('section', null, head, a.summary ? h('p', { class: 'summary' }, a.summary) : null, banner, problems, legend,
      sel ? h('section', { class: 'split rev' }, h('div', null, draw), h('aside', { class: 'side' }, sel)) : draw, note, cards)
  }
  return { view }
}
