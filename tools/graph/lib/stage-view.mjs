// grimoire graph · moving around a stage: the Architecture and Data tabs' diagrams and the file map.
// Runs in the browser only: render.mjs injects this function's source next to the page's helpers
// and calls it once, before the tabs, which share what it returns.
//   pan     a press on the stage's background drags it. The press is cancelled, so the browser
//           starts no text selection and drags no image, and selection stays off for the whole
//           drag. Once the press moves past 3 px it is a pan: the pointer is captured, so the pan
//           follows it out of the stage and past the scroll ends until the button is released
//           anywhere, and the click that ends it opens nothing. A press on a table, component or
//           file that moves 3 px or less stays a click.
//   keys    the stage is focusable, and a press on its background focuses it. With the focus on
//           it or inside it: the arrows pan by 60 px (Shift: most of the visible size), + and =
//           zoom in and − out about the visible centre, 0 fits. Never with Ctrl, ⌘ or Alt held,
//           never from a text field, and Enter, Space and Escape are left to the page.
//   wheel   zooms about the pointer, as each stage defines it.
// A pan or a key scrolls instantly (no smooth scrolling, so nothing to reduce for reduced motion).
export function stageClient() {
  const STEP = 60, PAGE = 0.9, SLOP = 3
  let live = null // the pan in progress, one at a time: its end
  // a pan that never got its capture still ends on a release anywhere, and selects nothing meanwhile
  window.addEventListener('pointerup', () => { if (live) live() })
  for (const t of ['selectstart', 'dragstart']) window.addEventListener(t, (e) => { if (live) e.preventDefault() }, true)
  const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || !!t.isContentEditable || !!(t.closest && t.closest('.passport')))

  // what a stage element carries: focusable, named with its keys, found again after a re-render
  const attrs = (ctl, label) => ({ tabindex: '0', role: 'region', 'data-ctl': `${ctl}-stage`, 'aria-label': `${label}: drag or use the arrow keys to pan (Shift: a page), + and − to zoom, 0 to fit` })
  // the step of the zoom buttons and keys, from the zoom as it is now
  const step = (z, d, min, max) => Math.min(max, Math.max(min, Math.round((z + d * 0.15) * 100) / 100))

  // el: the stage; o: { item: a selector a pan never starts on, at(): where the view is,
  // pan(from, dx, dy): the view moved by dx, dy from there, zoom(+1 | -1), fit(), wheel(e) }
  function nav(el, o) {
    let pan = null, moved = false
    const end = () => { if (!pan) return; pan = null; live = null; el.classList.remove('panning') }
    el.addEventListener('pointerdown', (e) => {
      moved = false
      if (e.button !== 0 || (o.item && e.target && e.target.closest && e.target.closest(o.item))) return
      if (e.target === el && (e.offsetX > el.clientWidth || e.offsetY > el.clientHeight)) return // its own scrollbar
      e.preventDefault()
      if (live) live()
      pan = { x: e.clientX, y: e.clientY, id: e.pointerId, from: o.at() }
      live = end
      el.classList.add('panning')
      el.focus({ preventScroll: true })
    })
    el.addEventListener('pointermove', (e) => {
      if (!pan || e.pointerId !== pan.id) return
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y
      if (!moved && Math.abs(dx) + Math.abs(dy) > SLOP) { moved = true; try { el.setPointerCapture(e.pointerId) } catch {} }
      o.pan(pan.from, dx, dy)
    })
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(t, (e) => { if (pan && e.pointerId === pan.id) end() })
    // the click that ends a pan opens nothing under it (registered first, and in the capture phase)
    el.addEventListener('click', (e) => { if (moved) { moved = false; e.preventDefault(); e.stopImmediatePropagation() } }, true)
    // a zoom or a fit may re-render the stage: the keyboard stays on it
    const keep = (fn) => {
      fn()
      if (el.isConnected) return
      const next = document.querySelector(`[data-ctl="${el.dataset.ctl}"]`), a = document.activeElement
      if (next && (!a || a === document.body)) next.focus({ preventScroll: true })
    }
    el.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return
      const k = e.key, arrow = /^Arrow(Left|Right|Up|Down)$/.exec(k)
      if (arrow) {
        const across = arrow[1] === 'Left' || arrow[1] === 'Right', back = arrow[1] === 'Left' || arrow[1] === 'Up'
        const d = (back ? 1 : -1) * (e.shiftKey ? Math.max(STEP, Math.round(PAGE * (across ? el.clientWidth : el.clientHeight))) : STEP)
        o.pan(o.at(), across ? d : 0, across ? 0 : d)
      } else if (k === '+' || k === '=') keep(() => o.zoom(1))
      else if (k === '-') keep(() => o.zoom(-1))
      else if (k === '0') keep(o.fit)
      else return
      e.preventDefault()
    })
    if (o.wheel) el.addEventListener('wheel', (e) => { e.preventDefault(); o.wheel(e) }, { passive: false })
    return { panning: () => !!pan }
  }

  // a diagram drawn as an svg in a scroll box (Architecture, Data): the box scrolls to pan, a zoom
  // resizes the svg in place, no re-render, about a point that stays put (as d3-zoom and React Flow
  // do): the pointer for the wheel (a trackpad pinch arrives as a wheel with ctrlKey), the box's
  // centre for the keys. o: { item, W, H, min, max, zoom(), set(z), ctl, fit() }
  function scroller(box, svg, o) {
    const zoomAt = (cx, cy, nz) => {
      const z = o.zoom(), r = svg.getBoundingClientRect()
      if (Math.abs(nz - z) < 1e-4) return
      const ux = (cx - r.left) / z, uy = (cy - r.top) / z
      o.set(nz)
      svg.setAttribute('width', String(Math.round(o.W * nz))); svg.setAttribute('height', String(Math.round(o.H * nz)))
      const n = svg.getBoundingClientRect()
      box.scrollLeft += n.left + ux * nz - cx; box.scrollTop += n.top + uy * nz - cy
      const pct = document.querySelector(`[data-ctl="${o.ctl}-100"]`), fit = document.querySelector(`[data-ctl="${o.ctl}-fit"]`)
      if (pct) { pct.textContent = `${Math.round(nz * 100)}%`; pct.setAttribute('aria-pressed', String(Math.abs(nz - 1) < 0.005)) }
      if (fit) fit.setAttribute('aria-pressed', 'false')
    }
    const lim = (v, max) => Math.max(0, Math.min(max > 0 ? max : 0, v)) // the scroll ends
    return nav(box, {
      item: o.item,
      at: () => [box.scrollLeft, box.scrollTop],
      pan: ([x, y], dx, dy) => { box.scrollLeft = lim(x - dx, box.scrollWidth - box.clientWidth); box.scrollTop = lim(y - dy, box.scrollHeight - box.clientHeight) },
      zoom: (d) => { const r = box.getBoundingClientRect(); zoomAt(r.left + box.clientWidth / 2, r.top + box.clientHeight / 2, step(o.zoom(), d, o.min, o.max)) },
      fit: o.fit,
      wheel: (e) => {
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1)
        zoomAt(e.clientX, e.clientY, Math.min(o.max, Math.max(o.min, o.zoom() * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)))))
      },
    })
  }
  return { attrs, step, view: nav, scroller }
}
