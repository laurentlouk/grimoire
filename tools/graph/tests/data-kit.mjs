// grimoire graph · tests · the Data tab's page, its data and its own script run in a small stub DOM
// (graph.test.mjs §5's): shared by data.test.mjs and data-redis.test.mjs.

export const blobOf = (page) => /<script type="application\/json" id="graph-data">([\s\S]*?)<\/script>/.exec(page)[1]
export const dataOf = (page) => JSON.parse(blobOf(page).replace(/\\u003c/g, '<'))
export const scriptOf = (page) => (/<script>([\s\S]*)<\/script>\s*<\/body>/.exec(page) || [])[1] || ''
export async function stubPage(page, hash, globals = {}) {
  const vm = await import('node:vm')
  const blob = blobOf(page), listeners = {}
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.kids = []; this.attrs = {}; this.on = {}; this.dataset = {}; this.html = ''; this.value = ''; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} } }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase())] = String(v) }
    getAttribute(k) { return this.attrs[k] ?? null }
    append(...c) { this.kids.push(...c) }
    addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f) }
    set innerHTML(v) { this.html = v; this.firstChild = new El('svg') }
    get innerHTML() { return this.html }
    querySelectorAll() { return [] }
    focus(o) { this.focusedWith = o || {} } setSelectionRange() {}
    get offsetHeight() { return 0 }
  }
  const { ctlQuery } = await import('./stage-kit.mjs')
  const doc = { createElement: (t) => new El(t), getElementById: (id) => (id === 'graph-data' ? { textContent: blob } : null), body: { replaceChildren(...c) { this.kids = c } }, documentElement: { style: { setProperty() {} } }, activeElement: null }
  doc.querySelector = ctlQuery(() => ({ kids: doc.body.kids || [] }))
  const loc = { hash, reload: () => { loc.reloads = (loc.reloads || 0) + 1 } }
  vm.runInNewContext(scriptOf(page), { document: doc, window: { addEventListener: (t, f) => { const prev = listeners[t]; listeners[t] = prev ? (e) => { prev(e); f(e) } : f }, innerWidth: 1400, scrollTo() {} }, location: loc, history: { replaceState: (a, b, h) => { loc.hash = h } }, requestAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), ...globals })
  const dump = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : `${n.html || ''} ${Object.values(n.attrs || {}).join(' ')} ${(n.kids || []).map(dump).join(' ')}`)
  const find = (n, pred) => { if (!n || typeof n !== 'object') return null; if (pred(n)) return n; for (const k of n.kids || []) { const f = find(k, pred); if (f) return f } return null }
  const all = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); for (const k of n.kids || []) all(k, pred, out) } return out }
  const body = () => ({ kids: doc.body.kids || [] })
  const flat = (n) => (n === null || n === undefined ? '' : typeof n !== 'object' ? String(n) : (n.kids || []).map(flat).join(''))
  const pg = {
    text: () => dump(body()),
    lines: (tag) => all(body(), (n) => n.tagName === tag).map(flat), // each element's text as read, e.g. every LI
    hash: () => loc.hash,
    reloads: () => loc.reloads || 0,
    textOf: (n) => flat(n),
    go: (h) => { loc.hash = h; listeners.hashchange() },
    find: (pred) => find(body(), pred),
    all: (pred) => all(body(), pred),
    ctl: (c) => find(body(), (n) => n.attrs && n.attrs['data-ctl'] === c),
    press: (c) => (pg.ctl(c).on.click || []).forEach((f) => f({})),
    pressed: (c) => Promise.all((pg.ctl(c).on.click || []).map((f) => f({}))), // and wait for what it started (a save)
    ctls: (re) => pg.all((n) => n.attrs && re.test(n.attrs['data-ctl'] || '')).map((n) => n.attrs['data-ctl']),
    search: (q) => pg.ctl('search').on.input[0]({ target: { value: q } }),
    erd: () => find(body(), (n) => n.attrs && n.attrs.id === 'data-box'), // the drawing: its svg markup is .html
    click: (i) => pg.erd().firstChild.on.click[0]({ target: { closest: (sel) => (/data-tbl/.test(sel) ? { dataset: { tbl: String(i) } } : null) } }),
    win: (t, e) => listeners[t] && listeners[t](e), // the window's own listeners
    active: (el) => { doc.activeElement = el }, // the element the document says has the focus
  }
  return pg
}
