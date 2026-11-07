// grimoire graph · the architecture change view (spec D7), its Node side: what a branch did to the
// architecture against its base, and the state of each architecture change a design's delta
// proposes. It reuses the data model's machinery: the base graph_changes compares against
// (data/base.mjs resolveBase, its merge base with HEAD), read through git with nothing checked out;
// the delta, its target grammar and its hash (data/delta.mjs); the base checkout's index
// (freshness.mjs baseIndex); the check (arch.mjs findings).
//
// A branch's architectural impact (archImpact) has two parts:
//   diagrams  the saved diagrams (docs/architecture/*.architecture.json, graph.architectureDir) at
//             the base against the working tree's: diagrams, components, connections and
//             boundaries added, removed or modified, before → after per attribute (diffDiagrams).
//   code      the check's findings on the branch's index and not on the base checkout's, each saved
//             diagram of the branch checked against both indexes (arch.mjs newFindings): a new link
//             no line draws, a module no component covers, a new external service by import, a
//             drawn line the code no longer shows. The diagram is the same on both sides, so what
//             differs is what the code did; what the diagrams did is the first part. With no base
//             index (no other checkout of the repository has one: freshness.mjs baseIndex), only the
//             diagram files are compared, and `why` says so.
//
// The delta's architecture changes (archDeltaStates), as its data changes are (data/delta.mjs
// deltaStates), against the saved diagrams of the working tree: the diagram is what a branch builds
// for its architecture (the check keeps it honest against the code):
//   planned-built      the diagrams have the target in the intended shape (a removal: it is gone;
//                      a rename: the new name is there and the old one is not)
//   pending            not drawn yet (a change: with what it proposes, now → planned)
//   built-differently  drawn in another shape (planned → built), or the branch touched it another way
//   acked | stale      the acknowledgement, apart (the same hash as a data change's)
//   unplanned          an item of the branch's impact no change covers: a diagram change (drawn in
//                      the branch, `built`), or a finding of the code (the code has it, the diagram
//                      does not draw it yet). A change covers an item that names its target (a
//                      connection's label only when both name one), a rename covers the old and the
//                      new element and the lines that meet it, a boundary that only wraps or unwraps
//                      the components the delta adds, removes or renames is covered with them, a
//                      planned component whose stated paths reach a module covers "no component
//                      covers it", and one whose stated imports reach a service covers the service.
import { existsSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { readDiagrams, validate, loadIndex, newFindings, globRe, importMatches, SUFFIX } from './arch.mjs'
import { treeAt, blobs } from './data/base.mjs'
import { parseArchTarget, archTargetOf, changeHash } from './data/delta.mjs'
import { baseIndex } from './freshness.mjs'
import { openStore } from './store.mjs'

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const git = (dir, args) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null }
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
// a path made real through its nearest existing ancestor (macOS: /var is /private/var)
function realish(p) {
  let head = path.resolve(p), rest = ''
  while (!existsSync(head) && head !== path.dirname(head)) { rest = rest ? path.join(path.basename(head), rest) : path.basename(head); head = path.dirname(head) }
  try { head = realpathSync(head) } catch {}
  return rest ? path.join(head, rest) : head
}
const rel = (from, to) => path.relative(from, to).split(path.sep).join('/')

// ── the diagrams, on each side ──
// The working tree's saved diagrams: [{ file (project-relative), doc } | { file, error }].
// The key of a diagram on both sides: its path from the project root, as the page names it.
const fileKey = (project, inDir) => rel(project.root, path.join(project.architectureDir, inDir))
export function currentDiagrams(project) {
  if (!project.root) return []
  return readDiagrams(project.architectureDir).map((d) => ({ ...d, file: fileKey(project, d.file) }))
}
// The saved diagrams at the base: the folder read through git at the base's merge base with HEAD
// (the repository's own `at` when the folder is in one of base.repos, else the same ref resolved in
// the git work tree that holds it), nothing checked out. → { list, at } | { why }
export function diagramsAt(project, base) {
  if (!project.root) return { why: 'no project root' }
  const dir = realish(project.architectureDir)
  let probe = dir
  while (!existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe)
  const top = git(probe, ['rev-parse', '--show-toplevel'])
  if (!top) return { why: 'the diagrams folder is not in a git repository' }
  const realTop = realish(top)
  const inDir = rel(realTop, dir)
  if (inDir.startsWith('..')) return { why: 'the diagrams folder is outside its git repository' }
  const repo = base.repos.find((r) => { const t = git(r.abs, ['rev-parse', '--show-toplevel']); return t && realish(t) === realTop })
  let at = repo ? repo.at : null
  if (!at) {
    const commit = git(realTop, ['rev-parse', '--verify', '-q', `${base.ref}^{commit}`])
    if (!commit) return { why: `${base.ref} is not a commit in ${realTop}` }
    const head = git(realTop, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])
    at = (head && git(realTop, ['merge-base', commit, head])) || commit
  }
  const files = treeAt(realTop, at)
  const want = [...files.keys()].filter((p) => (inDir === '' || p.startsWith(`${inDir}/`)) && p.endsWith(SUFFIX) && !p.slice(inDir ? inDir.length + 1 : 0).split('/').slice(0, -1).some((s) => s.startsWith('.'))).sort()
  const text = blobs(realTop, want.map((p) => files.get(p)))
  const list = want.map((p) => {
    const file = fileKey(project, inDir ? p.slice(inDir.length + 1) : p), b = text.get(files.get(p).oid)
    if (!b) return { file, error: 'could not be read at the base' }
    try { return { file, doc: JSON.parse(b.toString('utf8')) } } catch (e) { return { file, error: `does not parse: ${e.message}` } }
  })
  return { list, at }
}

// ── the elements of a diagram, and how two of them differ ──
const comps = (doc) => (isObj(doc) && Array.isArray(doc.components) ? doc.components : []).filter((c) => isObj(c) && typeof c.id === 'string')
const conns = (doc) => (isObj(doc) && Array.isArray(doc.connections) ? doc.connections : []).filter((e) => isObj(e) && typeof e.from === 'string' && typeof e.to === 'string')
const bounds = (doc) => (isObj(doc) && Array.isArray(doc.boundaries) ? doc.boundaries : []).filter((b) => isObj(b) && typeof b.label === 'string')
export const ATTRS = { component: ['label', 'sublabel', 'type', 'paths', 'imports', 'sources', 'repo', 'tag', 'note'], connection: ['label', 'variant', 'via', 'note'], boundary: ['kind', 'wraps'] }
const SETS = new Set(['paths', 'imports', 'sources', 'wraps'])
const norm = (attr, v) => (attr === 'variant' ? v || 'default' : attr === 'kind' ? v || 'group' : SETS.has(attr) ? [...new Set(Array.isArray(v) ? v : [])].sort() : v === undefined || v === null ? '' : v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// how a value reads: a list joined, an absent one "none"
export const shown = (v) => (Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v === '' || v === undefined || v === null ? 'none' : String(v))
// the attributes of `kind` that differ between two elements: [{ attr, before, after }] (only those
// `only` names, when given: what a change states)
function attrDiffs(kind, a, b, only = null) {
  const out = []
  for (const attr of only ? ATTRS[kind].filter((x) => only.includes(x)) : ATTRS[kind]) if (!same(norm(attr, a[attr]), norm(attr, b[attr]))) out.push({ attr, before: norm(attr, a[attr]), after: norm(attr, b[attr]) })
  return out
}
// an element in a line
export function describeEl(kind, el) {
  if (kind === 'component') return `component ${el.id}  "${el.label ?? ''}" (${el.type ?? 'no type'})`
  if (kind === 'boundary') return `boundary "${el.label}" (${el.kind || 'group'}) around ${shown(el.wraps)}`
  return `connection ${el.from} → ${el.to}${el.label ? `  "${el.label}"` : ''}${el.via ? ` via ${el.via}` : ''}`
}

// ── the diagrams at the base against the working tree's ──
// → { files: [{ file, title, change: added | removed | modified, changes: [Change] }], skipped:
//   [{ file, why }], counts: { files, added, removed, modified } }, where Change = { kind, change,
//   target, before, after, attrs: [{ attr, before, after }] }. A diagram is matched by its file; a
//   component by its id, a boundary by its label, a line by its two ends (and, where several lines
//   join the same two components on either side, by its label, its target then naming it: #<label>).
// A diagram added or removed lists each of its elements. One that does not parse on a side is not
// compared (skipped, with why).
export function diffDiagrams(before, after) {
  const names = [...new Set([...before, ...after].map((d) => d.file))].sort()
  const files = [], skipped = []
  for (const file of names) {
    const b = before.find((d) => d.file === file), a = after.find((d) => d.file === file)
    if ((b && b.error) || (a && a.error)) { skipped.push({ file, why: a && a.error ? `on the branch, it ${a.error}` : `at the base, it ${b.error}` }); continue }
    const changes = diffDoc(b ? b.doc : null, a ? a.doc : null)
    if (!changes.length && a && b) continue
    files.push({ file, title: (a || b).doc.title || file, change: !b ? 'added' : !a ? 'removed' : 'modified', changes })
  }
  const n = (k) => files.reduce((s, f) => s + f.changes.filter((c) => c.change === k).length, 0)
  return { files, skipped, counts: { files: files.length, added: n('added'), removed: n('removed'), modified: n('modified') } }
}
function diffDoc(b, a) {
  const out = []
  const put = (kind, change, target, before, after, attrs = []) => out.push({ kind, change, target, before, after, attrs })
  const cb = new Map(comps(b).map((c) => [c.id, c])), ca = new Map(comps(a).map((c) => [c.id, c]))
  for (const [id, c] of cb) if (!ca.has(id)) put('component', 'removed', `component:${id}`, c, null)
  for (const [id, c] of ca) { const o = cb.get(id); if (!o) put('component', 'added', `component:${id}`, null, c); else { const d = attrDiffs('component', o, c); if (d.length) put('component', 'modified', `component:${id}`, o, c, d) } }
  const pair = (e) => `${e.from}>${e.to}`
  for (const p of [...new Set([...conns(b), ...conns(a)].map(pair))]) {
    const lb = conns(b).filter((e) => pair(e) === p), la = conns(a).filter((e) => pair(e) === p)
    if (lb.length <= 1 && la.length <= 1) {
      const [o] = lb, [c] = la, target = archTargetOf('connection', o || c)
      if (!c) put('connection', 'removed', target, o, null)
      else if (!o) put('connection', 'added', target, null, c)
      else { const d = attrDiffs('connection', o, c); if (d.length) put('connection', 'modified', target, o, c, d) }
      continue
    }
    const left = [...la]
    for (const o of lb) {
      const k = left.findIndex((c) => (c.label || '') === (o.label || ''))
      if (k < 0) { put('connection', 'removed', archTargetOf('connection', o, o.label || ''), o, null); continue }
      const [c] = left.splice(k, 1), d = attrDiffs('connection', o, c)
      if (d.length) put('connection', 'modified', archTargetOf('connection', c, c.label || ''), o, c, d)
    }
    for (const c of left) put('connection', 'added', archTargetOf('connection', c, c.label || ''), null, c)
  }
  const bb = new Map(bounds(b).map((x) => [x.label, x])), ba = new Map(bounds(a).map((x) => [x.label, x]))
  for (const [label, x] of bb) if (!ba.has(label)) put('boundary', 'removed', `boundary:${label}`, x, null)
  for (const [label, x] of ba) { const o = bb.get(label); if (!o) put('boundary', 'added', `boundary:${label}`, null, x); else { const d = attrDiffs('boundary', o, x); if (d.length) put('boundary', 'modified', `boundary:${label}`, o, x, d) } }
  const K = { component: 0, connection: 1, boundary: 2 }
  return out.sort((x, y) => K[x.kind] - K[y.kind] || (x.target < y.target ? -1 : x.target > y.target ? 1 : 0))
}

// ── a branch's architectural impact ──
// → { diagrams: diffDiagrams' answer | null, diagramsWhy, findings: [{ file, kind, key, target, text,
//   … }] | null, why: null | why the code was not compared, where: { root, branch } (the base
//   checkout read) | null, current }. idx: the branch's index (arch.mjs loadIndex).
export async function archImpact(project, base, { idx, current = currentDiagrams(project) } = {}) {
  const at = base ? diagramsAt(project, base) : { why: 'no base' }
  const out = { diagrams: at.why ? null : diffDiagrams(at.list, current), diagramsWhy: at.why || null, before: at.why ? null : at.list, findings: null, why: null, where: null, current }
  const bi = await baseIndex(project)
  if (bi.why) { out.why = bi.why; return out }
  let baseIdx
  try { const db = await openStore(bi.dbPath, { readOnly: true }); try { baseIdx = loadIndex(db) } finally { db.close() } } catch (e) { out.why = `the base checkout's index cannot be read (${e.message})`; return out }
  out.where = { root: bi.root, branch: bi.branch }
  out.findings = []
  for (const d of current) if (d.doc && !validate(d.doc).errors.length) for (const f of newFindings(d.doc, idx, baseIdx)) out.findings.push({ file: d.file, ...f })
  return out
}
// Is there anything for the architecture to say? A diagram now or at the base, or a change proposed.
export const archHas = (impact, delta = null) => !!(impact && (impact.current.length || (impact.before && impact.before.length))) || !!(delta && delta.architecture && delta.architecture.length)

// ── the delta's architecture changes against the diagrams ──
// Where a target is drawn: [{ file, doc, el, amb }] across the diagrams (amb: a connection named by its
// ends alone, where the diagram draws several lines between them: the first is taken).
function locate(docs, t) {
  const out = []
  for (const d of docs) {
    if (!d.doc) continue
    if (t.kind === 'component') { const el = comps(d.doc).find((c) => c.id === t.id); if (el) out.push({ file: d.file, doc: d.doc, el }) }
    else if (t.kind === 'boundary') { const el = bounds(d.doc).find((b) => b.label === t.label); if (el) out.push({ file: d.file, doc: d.doc, el }) }
    else {
      const all = conns(d.doc).filter((e) => e.from === t.from && e.to === t.to)
      const hit = t.label !== null ? all.filter((e) => (e.label || '') === t.label) : all
      if (hit.length) out.push({ file: d.file, doc: d.doc, el: hit[0], amb: t.label === null && all.length > 1 })
    }
  }
  return out
}
const d = (attr, planned, built) => ({ attr, planned, built, text: `${attr}: ${shown(planned)} → ${shown(built)}` })
// what `after` states that the element does not have: planned → built
const stated = (kind, after, el) => attrDiffs(kind, el, after, Object.keys(after || {})).map((x) => d(x.attr, x.after, x.before))
// Two targets naming the same element (a connection's label counts only when both name one).
function sameTarget(a, b) {
  if (!a || !b || a.error || b.error || a.kind !== b.kind) return false
  if (a.kind === 'component') return a.id === b.id
  if (a.kind === 'boundary') return a.label === b.label
  return a.from === b.from && a.to === b.to && (a.label === null || b.label === null || a.label === b.label)
}
const newName = (c) => (c.after ? c.after.id ?? c.after.label : null)
export const archChangeText = (c) => `${c.op} ${c.target}${c.op === 'rename' && c.after ? ` → ${newName(c)}` : ''}`

//   archDeltaStates(list, current, { base, impact }) → { changes: [Result], unplanned: [Unplanned], counts }
//   list: the delta's `architecture`; current: the working tree's diagrams; base: the base's (or
//   null); impact: archImpact's answer (null: unplanned not listed).
//   Result     { i, change, id, hash, t, state, ack, diffs, proposed, warn, hits: [{ file, el }],
//                files: the diagrams it concerns (where it is drawn, or its ends are), touched }
//   Unplanned  { source: diagram | code, built, file, kind, target, change?, attrs?, text, finding? }
export function archDeltaStates(list, current, { base = null, impact = null } = {}) {
  const docs = current.filter((x) => x.doc && !validate(x.doc).errors.length)
  const diagramChanges = impact && impact.diagrams ? impact.diagrams.files.flatMap((f) => f.changes.map((c) => ({ ...c, file: f.file }))) : []
  const changes = (list || []).map((c, i) => {
    const hash = changeHash(c), t = parseArchTarget(c.target)
    const out = { i, change: c, id: c.id, hash, t, state: 'pending', ack: c.ack ? (c.ack.hash === hash ? 'acked' : 'stale') : null, diffs: [], proposed: [], warn: null, hits: [], files: [], touched: false }
    if (t.error) { out.warn = t.error; return out }
    const cur = locate(docs, t), was = base ? locate(base.filter((x) => x.doc), t) : []
    out.hits = cur.map(({ file, el }) => ({ file, el }))
    out.touched = diagramChanges.some((x) => sameTarget(parseArchTarget(x.target), t))
    if (cur.some((h) => h.amb)) out.warn = `several lines join ${t.from} and ${t.to}: name one with #<label> (the first is read)`
    if (c.op === 'add') {
      if (cur.length) { const best = cur.map((h) => stated(t.kind, c.after, h.el)); const k = best.findIndex((x) => !x.length); if (k >= 0) out.state = 'planned-built'; else { out.state = 'built-differently'; out.diffs = best[0] } }
    } else if (c.op === 'remove') {
      if (!cur.length) { out.state = 'planned-built'; if (base && !was.length && !out.warn) out.warn = 'not in the diagrams, nor at the base: check the target' }
    } else if (c.op === 'change') {
      if (!cur.length) {
        if (was.length) { out.state = 'built-differently'; out.diffs = [d(t.kind, 'changed', 'absent')] } else out.warn = out.warn || 'not in the diagrams: check the target'
      } else {
        const diffs = stated(t.kind, c.after, cur[0].el)
        if (!diffs.length) out.state = 'planned-built'
        else if (impact ? out.touched : isObj(c.before) ? stated(t.kind, c.before, cur[0].el).length > 0 : false) { out.state = 'built-differently'; out.diffs = diffs }
        else out.proposed = diffs.map((x) => ({ ...x, text: `${x.attr}: ${shown(x.built)} → ${shown(x.planned)}` }))
      }
    } else {
      const nt = t.kind === 'component' ? { kind: 'component', id: c.after.id } : { kind: 'boundary', label: c.after.label }
      const now = locate(docs, nt), neu = newName(c), old = `${t.kind} ${t.kind === 'component' ? t.id : t.label}`
      if (now.length && !cur.length) { out.state = 'planned-built'; out.hits = now.map(({ file, el }) => ({ file, el })) }
      else if (now.length && cur.length) { out.state = 'built-differently'; out.diffs = [{ attr: 'rename', planned: neu, built: 'both', text: `both ${old} and ${neu} are drawn` }] }
      else if (!now.length && !cur.length) { if (was.length) { out.state = 'built-differently'; out.diffs = [{ attr: 'rename', planned: neu, built: 'absent', text: `${old} is gone, and ${neu} is not drawn` }] } else out.warn = out.warn || 'neither name is in the diagrams: check the target' }
      else out.proposed = [{ attr: 'rename', planned: neu, built: null, text: `rename to ${neu}` }]
    }
    // the diagrams it concerns: where it is drawn, else where its ends or what it wraps are
    const ids = t.kind === 'component' ? [t.id, ...(c.op === 'rename' ? [c.after.id] : [])] : t.kind === 'connection' ? [t.from, t.to] : (c.after && Array.isArray(c.after.wraps) ? c.after.wraps : [])
    out.files = [...new Set([...out.hits.map((h) => h.file), ...docs.filter((x) => comps(x.doc).some((k) => ids.includes(k.id))).map((x) => x.file)])]
    return out
  })
  // a component proposed on its own concerns the diagrams of the lines the delta draws to it (whose
  // other end they hold), else the first diagram
  for (const r of changes) {
    if (r.t.error || r.t.kind !== 'component' || r.change.op !== 'add' || r.files.length) continue
    const near = changes.filter((x) => !x.t.error && x.t.kind === 'connection' && (x.t.from === r.t.id || x.t.to === r.t.id)).flatMap((x) => x.files)
    r.files = near.length ? [...new Set(near)] : docs.length ? [docs[0].file] : []
  }
  const unplanned = []
  if (impact) {
    const parsed = changes.filter((r) => !r.t.error)
    const adds = new Set(parsed.filter((r) => r.t.kind === 'component').flatMap((r) => [r.t.id, ...(r.change.op === 'rename' ? [r.change.after.id] : [])]))
    const planned = parsed.filter((r) => r.t.kind === 'component' && ['add', 'change'].includes(r.change.op) && isObj(r.change.after))
    const covers = (target, extra = null) => {
      const t = parseArchTarget(target)
      if (t.error) return false
      return parsed.some((r) => {
        if (sameTarget(r.t, t)) return true
        if (r.change.op === 'rename') {
          const nt = r.t.kind === 'component' ? { kind: 'component', id: r.change.after.id } : { kind: 'boundary', label: r.change.after.label }
          if (sameTarget(nt, t)) return true
          if (r.t.kind === 'component' && t.kind === 'connection' && [r.t.id, r.change.after.id].some((x) => x === t.from || x === t.to)) return true
        }
        return false
      }) || (extra ? extra() : false)
    }
    for (const x of diagramChanges) {
      // a boundary that only wraps or unwraps components the delta adds, removes or renames
      const wrapsOnly = () => x.kind === 'boundary' && x.change === 'modified' && x.attrs.every((a) => a.attr === 'wraps') && x.attrs.every((a) => [...a.before.filter((v) => !a.after.includes(v)), ...a.after.filter((v) => !a.before.includes(v))].every((v) => adds.has(v)))
      if (covers(x.target, wrapsOnly)) continue
      unplanned.push({ source: 'diagram', built: true, file: x.file, kind: x.kind, change: x.change, target: x.target, attrs: x.attrs, text: `${describeEl(x.kind, x.after || x.before)} ${x.change}${x.attrs.length ? `: ${x.attrs.map((a) => `${a.attr}: ${shown(a.before)} → ${shown(a.after)}`).join('; ')}` : ''}`, before: x.before, after: x.after })
    }
    for (const f of impact.findings || []) {
      let ok = false
      if (f.kind === 'uncovered') ok = planned.some((r) => (r.change.after.paths || []).some((p) => { const m = String(f.module).replace(/^[^:/]+:/, ''), q = p.replace(/^[^:/*]+:/, ''); return globRe(q).test(m) || globRe(q).test(`${m}/x`) }))
      else ok = covers(f.target, f.kind === 'service' ? () => planned.some((r) => (r.change.after.imports || []).some((p) => f.sources.some((s) => importMatches(s, p)))) : null)
      if (!ok) unplanned.push({ source: 'code', built: false, file: f.file, kind: f.kind, target: f.target, text: f.text, finding: f })
    }
  }
  const n = (f) => changes.filter(f).length
  return { changes, unplanned, counts: { changes: changes.length, 'planned-built': n((r) => r.state === 'planned-built'), pending: n((r) => r.state === 'pending'), 'built-differently': n((r) => r.state === 'built-differently'), acked: n((r) => r.ack === 'acked'), stale: n((r) => r.ack === 'stale'), unacked: n((r) => !r.ack), unplanned: unplanned.length } }
}

// ── graph_changes' architecture part ──
const KIND_WORD = { undrawn: 'in the code, not drawn', unseen: 'drawn, not in the code', uncovered: 'in no component', service: 'a service no component reaches' }
const elLine = (c) => `  ${c.change === 'added' ? '+' : c.change === 'removed' ? '-' : '~'} ${describeEl(c.kind, c.after || c.before)}${c.attrs.length ? `  ${c.attrs.map((a) => `${a.attr}: ${shown(a.before)} → ${shown(a.after)}`).join('; ')}` : ''}`
const codeWhy = (impact) => (impact.why ? `not compared (${impact.why}): only the diagram files were compared` : `${plural(impact.findings.length, 'finding')} on the branch's index and not on the base checkout's (${impact.where.branch || 'the main checkout'}, ${impact.where.root})`)
// Without a delta: the diagrams against the base, then what the code did. [lines]
export function archLines(impact, baseText) {
  const out = []
  const dg = impact.diagrams
  const head = dg ? `${dg.counts.files ? `${plural(dg.counts.files, 'diagram file')} changed · ${dg.counts.added} added · ${dg.counts.removed} removed · ${dg.counts.modified} modified` : 'no diagram file changed'}` : `diagram files not compared (${impact.diagramsWhy})`
  out.push(`Architecture against ${baseText}: ${head}; in the code: ${codeWhy(impact)}`)
  for (const f of dg ? dg.files : []) {
    out.push(`${f.file}  ${f.change === 'added' ? 'added (absent at the base)' : f.change === 'removed' ? 'removed (absent from the branch)' : 'modified'}`)
    for (const c of f.changes) out.push(elLine(c))
  }
  for (const s of dg ? dg.skipped : []) out.push(`Not compared: ${s.file} (${s.why}).`)
  if (impact.findings && impact.findings.length) {
    out.push('In the code (the check, against the base checkout\'s index):')
    for (const f of impact.findings) out.push(`  + ${f.text}  — ${f.file}${f.target ? `  → ${f.target}` : ''}`)
  }
  return out
}
// With a delta: each architecture change's state, then the impact no change covers. [lines]
export function archDeltaLines(s, { against, impact, baseText, why }) {
  const ackText = (r) => (r.ack === 'acked' ? `acknowledged by ${r.change.ack.by} at ${r.change.ack.at}` : r.ack === 'stale' ? `stale: acknowledged by ${r.change.ack.by} at ${r.change.ack.at}, edited since` : 'not acknowledged')
  const STATE = { 'planned-built': 'planned and built', pending: 'pending', 'built-differently': 'built differently' }
  const out = [`Architecture: ${plural(s.changes.length, 'change')} in the delta, against the saved diagrams${against ? ` and the branch against ${baseText}` : ` (no base: ${why}; unplanned changes not listed)`}`]
  for (const r of s.changes) {
    out.push(`  ${STATE[r.state]}  ${r.id}  ${archChangeText(r.change)}${r.hits.length && r.state !== 'pending' ? `  — ${[...new Set(r.hits.map((h) => h.file))].join(' · ')}` : ''}`)
    if (r.diffs.length) out.push(`    planned → built: ${r.diffs.map((x) => x.text).join('; ')}`)
    if (r.proposed.length) out.push(`    proposed: ${r.proposed.map((x) => x.text).join('; ')}`)
    if (r.warn) out.push(`    ⚠ ${r.warn}`)
    out.push(`    why: ${r.change.why}${r.change.slice !== undefined ? ` · slice ${r.change.slice}` : ''}${r.change.origin === 'unplanned' ? ' · unplanned, kept by the implementer' : ''} · ${ackText(r)}`)
  }
  if (against) {
    out.push(s.unplanned.length ? `Unplanned (${s.unplanned.length}): in the branch, in no change of the delta${impact.why ? ` (the code not compared: ${impact.why}; only the diagram files were)` : ''}` : `Unplanned: none${impact.why ? ` in the diagram files (the code not compared: ${impact.why})` : ', every architectural change of the branch is in the delta'}`)
    for (const u of s.unplanned) out.push(`  ${u.source === 'diagram' ? (u.change === 'added' ? '+' : u.change === 'removed' ? '-' : '~') : '+'} ${u.target || '(no target)'}  ${u.text}  — ${u.file}${u.source === 'diagram' ? ' (drawn in the branch)' : ` (${KIND_WORD[u.kind]}: update the diagram)`}`)
    for (const x of impact.diagrams ? impact.diagrams.skipped : []) out.push(`Not compared: ${x.file} (${x.why}).`)
  }
  const k = s.counts
  out.push(`Summary: ${k['planned-built']} planned and built · ${k.pending} pending · ${k['built-differently']} built differently${against ? ` · ${k.unplanned} unplanned` : ''} · ${k.acked} acknowledged · ${k.stale} stale · ${k.unacked} not acknowledged`)
  return out
}
