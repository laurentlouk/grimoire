// grimoire graph · the architecture change view, as the page draws it: render.mjs packs it with these,
// arch-view.mjs draws it. Two overlays over a saved diagram, one at a time:
//   changes  the branch against its base (arch-change.mjs archImpact): elements added, removed (a
//            ghost from the base) or modified (before → after), and the code's new links no line draws
//   delta    a design's architecture changes (arch-change.mjs archDeltaStates): a proposed component
//            as a dashed ghost placed by the layout, a proposed line dashed, a proposed removal
//            struck, each in its state; the branch's impact no change covers, "not in the plan"
//
// An overlay is the diagram with marks: its components, connections and boundaries (copies), then
// what the overlay adds after them (a proposed component, line or boundary; one of the base's put back
// where the branch removed it), laid out here, once, with them (layoutArch: an added component gives
// no col and row, so the layout places it by flow in a free cell). members, evidence and checkable
// stay aligned with the components and lines (an added one has no code: [], 0, false). Marks:
//   delta    comp.dl / conn.dl / bmarks[label] = { s, c: [change indexes], gone }: s one of prop (a
//            proposed addition, dashed), rm (a proposed removal, struck), pend (a proposed change or
//            rename), built (planned and built), diff (built differently), unpl (in the branch, in no
//            change); gone: drawn from the base (a removal built, or one not in the plan); was: lines
//   changes  comp.ch / conn.ch / bmarks[label].ch = added | removed | modified, was: ['attr: a → b']
//   links    [[from, to, text, unplanned index | -1]]: a code link no line draws, new on the branch
import { layoutArch } from './arch.mjs'
import { parseArchTarget } from './data/delta.mjs'
import { shown, describeEl, archChangeText } from './arch-change.mjs'

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const comps = (doc) => (isObj(doc) && Array.isArray(doc.components) ? doc.components : []).filter((c) => isObj(c) && typeof c.id === 'string')
const conns = (doc) => (isObj(doc) && Array.isArray(doc.connections) ? doc.connections : []).filter((e) => isObj(e) && typeof e.from === 'string' && typeof e.to === 'string')
const bounds = (doc) => (isObj(doc) && Array.isArray(doc.boundaries) ? doc.boundaries : []).filter((b) => isObj(b) && typeof b.label === 'string')
const PICK_C = ['id', 'label', 'sublabel', 'type', 'tag', 'note', 'repo', 'paths', 'imports', 'sources']
const PICK_E = ['from', 'to', 'label', 'variant', 'via', 'note']
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

function overlay(doc, a) {
  const lay = { components: doc.components.map((c) => ({ ...c })), connections: (doc.connections || []).map((e) => ({ ...e })), boundaries: (doc.boundaries || []).map((b) => ({ ...b, wraps: [...b.wraps] })) }
  const o = { comps: doc.components.map((c) => pick(c, PICK_C)), conns: (doc.connections || []).map((e) => pick(e, PICK_E)), bmarks: {}, links: [],
    members: a.members.slice(), evidence: a.evidence.slice(), checkable: a.checkable.slice() }
  const has = (id) => lay.components.some((c) => c.id === id)
  return {
    o, has,
    hasBound: (label) => lay.boundaries.some((b) => b.label === label),
    comp: (id) => o.comps.find((c) => c.id === id) || null,
    conn: (from, to, label = null) => { const all = o.conns.filter((e) => e.from === from && e.to === to); return (label !== null && label !== undefined ? all.find((e) => (e.label || '') === label) : all[0]) || null },
    addComp: (c) => { if (!isObj(c) || has(c.id)) return null; const { col, row, ...rest } = c; lay.components.push(rest); const p = pick(rest, PICK_C); o.comps.push(p); o.members.push([]); return p },
    addConn: (e) => { if (!isObj(e) || !has(e.from) || !has(e.to) || e.from === e.to) return null; lay.connections.push({ ...e }); const p = pick(e, PICK_E); o.conns.push(p); o.evidence.push(0); o.checkable.push(false); return p },
    addBound: (b) => { const wraps = (isObj(b) && Array.isArray(b.wraps) ? b.wraps : []).filter(has); if (!wraps.length || lay.boundaries.some((x) => x.label === b.label)) return false; lay.boundaries.push({ label: b.label, kind: b.kind, wraps }); return true },
    done: () => { const { problems, ...layout } = layoutArch(lay); return { ...o, layout } },
  }
}
const mark = (el, m) => { if (!el) return false; el.dl = { s: m.s, c: [...(el.dl ? el.dl.c : []), ...(m.c || [])], gone: !!m.gone || !!(el.dl && el.dl.gone) }; if (m.line) el.was = [...(el.was || []), m.line]; return true }
const bmark = (o, label, m) => { const had = o.bmarks[label] || {}; o.bmarks[label] = { s: m.s, c: [...(had.c || []), ...(m.c || [])], gone: !!m.gone || !!had.gone, was: [...(had.was || []), ...(m.line ? [m.line] : [])] }; return true }
const baseDoc = (before, file) => ((before || []).find((x) => x.file === file && x.doc) || {}).doc || null
const attrLine = (x) => `${x.attr}: ${shown(x.before)} → ${shown(x.after)}`

// The changes overlay of one saved diagram against the base (impact: archImpact's answer): its
// elements added, removed (ghosts from the base) or modified, the code's new links no line draws,
// and the list of both. null when the base's diagrams could not be read.
export function packArchChanges(file, doc, a, impact) {
  if (!impact || !impact.diagrams) return null
  const f = impact.diagrams.files.find((x) => x.file === file) || null
  const finds = (impact.findings || []).filter((x) => x.file === file)
  const ov = overlay(doc, a), o = ov.o
  for (const c of f ? f.changes : []) {
    const el = c.after || c.before, m = { ch: c.change, was: c.attrs.map(attrLine) }
    if (c.kind === 'boundary') { if (c.change === 'removed') ov.addBound(c.before); o.bmarks[el.label] = m; continue }
    if (c.change === 'removed') { const p = c.kind === 'component' ? ov.addComp(c.before) : ov.addConn(c.before); if (p) Object.assign(p, m); continue }
    const t = c.kind === 'component' ? ov.comp(el.id) : ov.conn(el.from, el.to, parseArchTarget(c.target).label)
    if (t) Object.assign(t, m)
  }
  for (const x of finds) if (x.kind === 'undrawn') { const t = parseArchTarget(x.target); if (ov.has(t.from) && ov.has(t.to)) o.links.push([t.from, t.to, x.text, -1]) }
  const n = (k) => (f ? f.changes.filter((c) => c.change === k).length : 0)
  return { change: f ? f.change : null, n: { added: n('added'), removed: n('removed'), modified: n('modified'), findings: finds.length },
    list: (f ? f.changes : []).map((c) => ({ change: c.change, kind: c.kind, target: c.target, text: `${describeEl(c.kind, c.after || c.before)}${c.attrs.length ? `: ${c.attrs.map(attrLine).join('; ')}` : ''}` })),
    findings: finds.map((x) => ({ kind: x.kind, target: x.target, text: x.text })), ...ov.done() }
}

// What a delta's `after` states, in a line (the page's change list).
export function archAfterText(c) {
  if (!isObj(c.after) || c.op === 'remove') return null
  if (c.op === 'rename') return `named ${c.after.id ?? c.after.label}`
  return Object.entries(c.after).map(([k, v]) => `${k} ${shown(v)}`).join(', ') || null
}

// The architecture part of one delta, as the page draws it: its changes (each with its state,
// acknowledgement, why, slice, what differs or what it proposes, and the diagrams it is drawn on),
// the branch's impact no change covers (unplanned), and per saved diagram (by its index in the packed
// list) its overlay, or null when the delta does not concern it. outside: the changes drawn on no
// diagram (their elements are in none, or the project saves none).
//   s: archDeltaStates' answer; saved: [{ k, file, doc, a (the packed diagram) }], the diagrams that
//   validate; before: the base's diagrams (or null); why: why unplanned changes are not listed
export function packArchDelta(s, { saved, before, why }) {
  const changes = s.changes.map((r) => ({
    id: r.id, target: r.change.target, text: archChangeText(r.change), op: r.change.op, kind: r.t.kind || null, state: r.state, ack: r.ack, by: r.change.ack?.by ?? null, at: r.change.ack?.at ?? null,
    why: r.change.why, slice: r.change.slice ?? null, origin: r.change.origin, after: archAfterText(r.change), diffs: r.diffs.map((x) => x.text), proposed: r.proposed.map((x) => x.text), warn: r.warn,
    src: r.state !== 'pending' ? [...new Set(r.hits.map((h) => h.file))] : [], drawn: [],
  }))
  const unplanned = s.unplanned.map((u) => ({ source: u.source, built: u.built, kind: u.kind, change: u.change || null, target: u.target, text: u.text, file: u.file, drawn: -1 }))
  const diagrams = []
  const K = { component: 0, connection: 1, boundary: 2 }
  for (const { k, file, doc, a } of saved) {
    const ks = s.changes.filter((r) => !r.t.error && r.files.includes(file)).sort((x, y) => K[x.t.kind] - K[y.t.kind] || x.i - y.i)
    const us = s.unplanned.map((u, j) => [u, j]).filter(([u]) => u.file === file)
    if (!ks.length && !us.length) { diagrams[k] = null; continue }
    const ov = overlay(doc, a), o = ov.o, bdoc = baseDoc(before, file)
    for (const r of ks) {
      const c = r.change, t = r.t, op = c.op
      const st8 = r.state === 'planned-built' ? 'built' : r.state === 'built-differently' ? 'diff' : op === 'add' ? 'prop' : op === 'remove' ? 'rm' : 'pend'
      const line = r.state === 'built-differently' ? `planned → built: ${r.diffs.map((x) => x.text).join('; ')}` : r.proposed.length ? `proposed: ${r.proposed.map((x) => x.text).join('; ')}` : null
      const m = { s: st8, c: [r.i], line }
      let ok = false
      if (t.kind === 'component') {
        const id = op === 'rename' && st8 === 'built' ? c.after.id : t.id
        if (op === 'remove' && st8 === 'built') { const g = comps(bdoc).find((x) => x.id === t.id); ok = mark(g ? ov.addComp(g) : null, { ...m, gone: true }) }
        else if (ov.comp(id)) ok = mark(ov.comp(id), m)
        else if (st8 === 'prop') ok = mark(ov.addComp({ id: t.id, label: t.id, type: 'library', ...c.after }), m)
      } else if (t.kind === 'connection') {
        if (op === 'remove' && st8 === 'built') { const g = conns(bdoc).find((e) => e.from === t.from && e.to === t.to && (t.label === null || (e.label || '') === t.label)); ok = mark(g ? ov.addConn(g) : null, { ...m, gone: true }) }
        else if (ov.conn(t.from, t.to, t.label)) ok = mark(ov.conn(t.from, t.to, t.label), m)
        else if (st8 === 'prop') ok = mark(ov.addConn({ from: t.from, to: t.to, ...(t.label !== null ? { label: t.label } : {}), ...(c.after || {}) }), m)
      } else {
        const label = op === 'rename' && st8 === 'built' ? c.after.label : t.label
        if (op === 'remove' && st8 === 'built') { const g = bounds(bdoc).find((b) => b.label === t.label); ok = !!g && ov.addBound(g) && bmark(o, g.label, { ...m, gone: true }) }
        else if (ov.hasBound(label)) ok = bmark(o, label, m)
        else if (st8 === 'prop') ok = ov.addBound({ label: t.label, kind: c.after.kind, wraps: c.after.wraps }) && bmark(o, t.label, m)
      }
      if (ok) changes[r.i].drawn.push(k)
    }
    for (const [u, j] of us) {
      const m = { s: 'unpl', c: [] }
      let ok = false
      if (u.source === 'code') { if (u.kind === 'undrawn') { const t = parseArchTarget(u.target); if (ov.has(t.from) && ov.has(t.to)) { o.links.push([t.from, t.to, u.text, j]); ok = true } } }
      else if (u.kind === 'boundary') { if (u.change === 'removed') ov.addBound(u.before); ok = bmark(o, (u.after || u.before).label, { ...m, gone: u.change === 'removed', line: u.change === 'modified' ? u.text : null }) }
      else if (u.change === 'removed') ok = mark(u.kind === 'component' ? ov.addComp(u.before) : ov.addConn(u.before), { ...m, gone: true })
      else { const el = u.after, t = parseArchTarget(u.target); ok = mark(u.kind === 'component' ? ov.comp(el.id) : ov.conn(el.from, el.to, t.label), { ...m, line: u.change === 'modified' ? u.text : null }) }
      if (ok) unplanned[j].drawn = k
    }
    diagrams[k] = { ks: ks.map((r) => r.i).sort((x, y) => x - y), us: us.map(([, j]) => j), ...ov.done() }
  }
  const outside = changes.map((c, i) => [c, i]).filter(([c]) => !c.drawn.length).map(([, i]) => i)
  return { changes, unplanned, diagrams, outside, unplWhy: why || null }
}
