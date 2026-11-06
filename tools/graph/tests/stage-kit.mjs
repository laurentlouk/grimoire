// The stages' navigation (lib/stage-view.mjs), driven through a page's stub DOM. Shared by
// graph.test.mjs §2 (the file map), arch-docs.test.mjs §5 (Architecture) and data.test.mjs §9 (Data).
// Not a test file itself: the runner picks *.test.mjs only.
//
// stageKit(el) gives a stub element what a stage needs (a class list, a size, scroll offsets,
// pointer capture, focus) and `fire(type, init, ...path)` hands one event to the listeners the
// page's own script attached along `path` (default: the element), stopping where a listener stops
// it: the stub has no bubbling, so a click is passed through the stage, then the svg inside it.
export function stageKit(el, { width = 400, height = 300, scrollWidth = 2000, scrollHeight = 1500 } = {}) {
  const classes = new Set(String(el.attrs.class || '').split(/\s+/).filter(Boolean))
  const kit = { el, classes, captured: [], focused: null }
  el.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) }
  Object.assign(el, { clientWidth: width, clientHeight: height, scrollWidth, scrollHeight, scrollLeft: 0, scrollTop: 0 })
  el.setPointerCapture = (id) => kit.captured.push(id)
  el.focus = (opt) => { kit.focused = opt || {} }
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height })
  if (el.firstChild) el.firstChild.getBoundingClientRect = () => ({ left: 0, top: 0 }) // the svg drawn in a scroll box
  kit.fire = (type, init = {}, ...path) => {
    const e = { type, target: el, button: 0, pointerId: 1, clientX: 0, clientY: 0, key: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, stopImmediatePropagation() { this.stopped = true }, ...init }
    for (const node of path.length ? path : [el]) for (const f of node.on[type] || []) { if (e.stopped) return e; f(e) }
    return e
  }
  kit.key = (key, more = {}) => kit.fire('keydown', { key, ...more })
  return kit
}

// a target inside a stage that the stub draws as markup only: a table, a component
export const inside = (selector, dataset) => ({ tagName: 'g', closest: (sel) => (sel === selector ? { dataset } : null) })
// the stage's background (or anything in it that is not an item)
export const background = { tagName: 'svg', closest: () => null }

// The cases every svg stage in a scroll box shares (Architecture, Data), one block run per tab.
// v: { name, box(): the stage now, zoom0: its zoom, items: [two targets], opened(i): its passport is
//      open, fitted(): Fit is pressed, search: the header's search box, win(type, e): the window's
//      listeners, full(): toggles full size, isFull() }
export function scrollStageCases(ok, v) {
  const sel = () => { const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }; v.win('selectstart', e); return e.defaultPrevented }
  let b = v.box(), k = stageKit(b)
  ok(b.attrs.tabindex === '0' && b.attrs.role === 'region' && /arrow keys to pan \(Shift: a page\), \+ and − to zoom, 0 to fit/.test(b.attrs['aria-label'] || ''),
    `${v.name}: the stage is focusable, its label names the keys`)

  // a drag on the background: no selection, captured past 3 px, followed out of the stage and past its ends
  b.scrollLeft = 100; b.scrollTop = 100
  const down = k.fire('pointerdown', { target: background, clientX: 300, clientY: 200 })
  ok(down.defaultPrevented && k.classes.has('panning') && sel() && k.focused && k.focused.preventScroll === true && !k.captured.length,
    `${v.name}: the press on the background is cancelled (no text selection, no image drag), the stage takes the no-select class and the focus, without scrolling the page`)
  k.fire('pointermove', { clientX: 299, clientY: 199 })
  ok(!k.captured.length && b.scrollLeft === 101, `${v.name}: within 3 px it is still a click (the drawing follows, nothing is captured)`)
  k.fire('pointermove', { clientX: 290, clientY: 195 })
  ok(k.captured.join() === '1' && b.scrollLeft === 110 && b.scrollTop === 105, `${v.name}: past 3 px it is a pan: the pointer is captured and the box scrolls`)
  k.fire('pointermove', { clientX: -700, clientY: -800 })
  ok(b.scrollLeft === 1100 && b.scrollTop === 1100, `${v.name}: the pointer out of the stage: the pan follows it`)
  k.fire('pointermove', { clientX: -5000, clientY: -5000 })
  ok(b.scrollLeft === 1600 && b.scrollTop === 1200, `${v.name}: past the scroll ends the pan stops there, without error`)
  k.fire('pointerup', { clientX: -5000, clientY: -5000 })
  k.fire('pointermove', { clientX: 0, clientY: 0 })
  ok(!k.classes.has('panning') && b.scrollLeft === 1600 && !sel(), `${v.name}: released anywhere, the pan ends and selection is allowed again`)
  const after = k.fire('click', { target: v.items[0] }, b, b.firstChild)
  ok(after.stopped && !v.opened(0), `${v.name}: the click that ends a pan opens nothing, even over an item`)
  k.fire('pointerdown', { target: background, clientX: 10, clientY: 10 })
  k.fire('pointermove', { clientX: 30, clientY: 10 })
  k.fire('lostpointercapture', {})
  k.fire('pointermove', { clientX: 300, clientY: 10 })
  ok(!k.classes.has('panning') && b.scrollLeft === 1580, `${v.name}: a lost capture ends the pan too`)

  // a press on an item is no pan; its click still opens it
  const press = k.fire('pointerdown', { target: v.items[0], clientX: 50, clientY: 50 })
  k.fire('pointermove', { target: v.items[0], clientX: 80, clientY: 50 })
  k.fire('pointerup', { target: v.items[0] })
  ok(!press.defaultPrevented && !k.classes.has('panning') && k.captured.length === 2 && b.scrollLeft === 1580, `${v.name}: a press on an item starts no pan`)
  k.fire('click', { target: v.items[0] }, b, b.firstChild)
  ok(v.opened(0), `${v.name}: and its click opens it`)

  // the keys, with the focus on the stage or on an item inside it
  b = v.box(); k = stageKit(b); b.scrollLeft = 500; b.scrollTop = 500
  const r = k.key('ArrowRight')
  k.key('ArrowDown')
  ok(r.defaultPrevented && b.scrollLeft === 560 && b.scrollTop === 560, `${v.name}: → and ↓ pan by 60 px, and the page does not scroll as well`)
  k.key('ArrowLeft', { target: v.items[0] }); k.key('ArrowUp', { target: v.items[0] })
  ok(b.scrollLeft === 500 && b.scrollTop === 500, `${v.name}: ← and ↑ pan back, from an item inside the stage too`)
  k.key('ArrowRight', { shiftKey: true }); k.key('ArrowDown', { shiftKey: true })
  ok(b.scrollLeft === 860 && b.scrollTop === 770, `${v.name}: Shift + an arrow pans by most of the visible size`)
  for (let i = 0; i < 4; i++) { k.key('ArrowLeft', { shiftKey: true }); k.key('ArrowUp', { shiftKey: true }) }
  k.key('ArrowLeft')
  ok(b.scrollLeft === 0 && b.scrollTop === 0, `${v.name}: panning stops cleanly at the edges`)
  const ignored = [k.key('ArrowRight', { ctrlKey: true }), k.key('ArrowRight', { metaKey: true }), k.key('ArrowDown', { altKey: true }), k.key('ArrowRight', { target: v.search }),
    k.key('ArrowRight', { target: { tagName: 'BUTTON', closest: (s) => (s === '.passport' ? {} : null) } }), k.key('ArrowRight', { target: { tagName: 'DIV', isContentEditable: true, closest: () => null } })]
  ok(ignored.every((e) => !e.defaultPrevented) && b.scrollLeft === 0 && b.scrollTop === 0, `${v.name}: Ctrl, ⌘ or Alt + an arrow, and an arrow from the search box, the passport or an editable field, leave the diagram alone`)

  // + and − zoom in place about the visible centre, by the buttons' step; 0 fits
  const W = Number(/viewBox="0 0 ([\d.]+) /.exec(b.html)[1])
  const z1 = Math.round((v.zoom0 + 0.15) * 100) / 100
  b.scrollLeft = 300; b.scrollTop = 300
  const plus = k.key('+')
  ok(plus.defaultPrevented && b.firstChild.attrs.width === String(Math.round(W * z1)) && Math.abs(b.scrollLeft - (300 + 200 * (z1 / v.zoom0 - 1))) < 1e-6 && Math.abs(b.scrollTop - (300 + 150 * (z1 / v.zoom0 - 1))) < 1e-6,
    `${v.name}: + zooms in by the buttons' step (${v.zoom0} → ${z1}), in place, about the visible centre`)
  k.key('-')
  ok(b.firstChild.attrs.width === String(Math.round(W * v.zoom0)), `${v.name}: − zooms back out`)
  k.key('=')
  ok(b.firstChild.attrs.width === String(Math.round(W * z1)), `${v.name}: = zooms in too (the + key without Shift)`)
  const fit = k.key('0')
  ok(fit.defaultPrevented && v.fitted(), `${v.name}: 0 fits, as the Fit button does`)

  // Enter on an item still opens it; the stage leaves Enter, Space and Escape to the page
  b = v.box(); k = stageKit(b)
  const enter = k.fire('keydown', { key: 'Enter', target: v.items[1] }, b.firstChild, b)
  ok(enter.defaultPrevented && v.opened(1), `${v.name}: Enter on an item still opens it`)
  b = v.box(); k = stageKit(b)
  k.fire('pointerdown', { target: background, clientX: 5, clientY: 5 }); k.fire('pointerup', {})
  k.fire('click', { target: background }, b, b.firstChild)
  ok(!v.opened(1), `${v.name}: a click on the background (3 px or less) is still a click: it closes the passport`)
  v.full()
  b = v.box(); k = stageKit(b)
  const esc = k.key('Escape'), space = k.key(' ')
  v.win('keydown', { key: 'Escape' })
  ok(!esc.defaultPrevented && !space.defaultPrevented && !v.isFull(), `${v.name}: Escape still leaves full size`)
}
