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
//   architecture  the diagrams in docs/architecture (arch.mjs: checked against the index, laid out
//              here) and one drafted from the graph on every render; drawn by arch-view.mjs
//   data       the data model (lib/data, reconciled as graph_data answers): an ERD per SQL store,
//              laid out here (data/layout.mjs), a key card per table of a key-value store (`cards`, its
//              access patterns `acc` placed in the code graph's functions; no layout), with the folders found but not read, and two
//              overlays packed here: the branch against its base, and a design's delta (the
//              changes it proposes, each with its state against the code); drawn by data-view.mjs
//   docs       the project's Markdown notes (docs.mjs), rendered in the page (md.mjs) as an
//              Obsidian-like vault: tree, reading view, outline, backlinks, code they mention;
//              editable only when the page is served (serve.mjs), which adds connect-src 'self'
// The file map and the Architecture and Data diagrams share one way to move around (stage-view.mjs):
// drag the background (it never selects the page) or focus the stage and use the arrow keys, + − 0.
// Test code and ambiguous links are hidden until asked for; unique-name matches are drawn dashed.
// Views have plain anchors (#sym-12, #file-3, #mod-4, #arch-0, #data-1, #doc-7): they hold for the
// index the page was rendered from (a re-parsed file gets new ids; module, diagram, store and note
// numbers shift as those change).
// The helpers below the data section are pure, exported for the tests, and injected into the page.
// Like every graph answer, the page is a map: read the code at the path:line it points to.
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { openStore } from './store.mjs'
import { layoutMap } from './layout.mjs'
import { systemMap } from './modules.mjs'
import { analyze, draftArch, loadIndex, readDiagrams } from './arch.mjs'
import { archScope, archImpact, archDeltaStates, currentDiagrams } from './arch-change.mjs'
import { packArchChanges, packArchDelta } from './arch-pack.mjs'
import { scanDocs, docRoots, scanDeltas, readDelta } from './docs.mjs'
import { mdSlug, mdFront, mdToHtml } from './md.mjs'
import { archClient } from './arch-view.mjs'
import { docsClient } from './docs-view.mjs'
import { reconcile, storeSummary } from './data/reconcile.mjs'
import { bindingHow, dashed } from './data/binding.mjs'
import { kvIndex, kvTable, projectionText } from './data/model.mjs'
import { layoutErd, erdBox } from './data/layout.mjs'
import { diffModels } from './data/diff.mjs'
import { resolveBase, modelAt } from './data/base.mjs'
import { parseDelta, deltaStates, findTarget, changeText, diffText } from './data/delta.mjs'
import { changeVal, renameText, baseText, refName, CHANGE_KIND, symbolAt } from './query.mjs'
import { byFunction, siteHow, isRead } from './data/access.mjs'
import { dataClient } from './data-view.mjs'
import { stageClient } from './stage-view.mjs'

const KINDS = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS']
const MAP_MAX_FILES = 1500 // the file map keeps the most connected production files; the other tabs keep everything
export const DATA_COLLAPSE = 60 // a store with more tables starts collapsed: names only, until focused or searched

// opts.serve = { token }: the page is served by serve.mjs and may save notes back to it, and
// acknowledge a delta's changes
// opts.base: the ref the Data tab's change overlay compares against (else the default base,
// data/base.mjs); one given that does not resolve is an error, a default that does not resolve
// leaves the overlay out and the tab says why
// opts.delta: the delta the Data tab shows first (a path from the project root, or absolute; it is
// an error when it cannot be read), else the newest beside the specs (docs.mjs scanDeltas)
export async function renderGraph(project, opts = {}) {
  const changes = await baseFor(project, opts.base || null)
  const deltas = project.root ? deltaFiles(project, opts.delta || null) : []
  const db = await openStore(project.dbPath, { readOnly: true })
  try {
    const repos = db.prepare('SELECT name, root, head, indexed_at FROM repos ORDER BY name').all()
    const files = db.prepare('SELECT id, repo, path, lang, size, is_test, node_id FROM files ORDER BY repo, path').all()
    const nodes = db.prepare("SELECT id, file_id, kind, COALESCE(qualname, name) AS name, line, is_test FROM nodes WHERE kind != 'file'").all()
    const edges = db.prepare('SELECT src, dst, kind, confidence FROM edges').all()
    // each repository's 25 strongest pairs, each once: cochange.mjs stores a pair both ways unless one
    // side's partner cap cut it, so keep a < b, or the one way it was stored
    const cochange = db.prepare(`SELECT repo, a, b, n FROM (SELECT c.repo, c.a, c.b, c.n, ROW_NUMBER() OVER (PARTITION BY c.repo ORDER BY c.n DESC, c.a, c.b) AS rk FROM cochange c
      WHERE c.a < c.b OR NOT EXISTS (SELECT 1 FROM cochange m WHERE m.repo = c.repo AND m.a = c.b AND m.b = c.a)) WHERE rk <= 25 ORDER BY n DESC, repo, a, b`).all()
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
      ...(await archAndData(project, db, files, repos, changes, deltas)),
      docs: project.root ? scanDocs(project).map((d) => [d.repo, d.root, d.path, d.text, d.hash, d.big ? 1 : 0]) : [],
      ...(opts.serve ? { serve: { token: opts.serve.token } } : {}),
    }
    return html(data, !!opts.serve)
  } finally { db.close() }
}

// The Architecture and Data tabs, and the architecture change view between them: the branch's
// architectural impact against the base the Data tab compares against (arch-change.mjs archImpact,
// when that base resolved), drawn per saved diagram (`ch`, the Changes overlay), and each delta's
// architecture changes (`arch` on the Data tab's packed delta: one delta object, so an
// acknowledgement written from either tab updates the hash both send). archCh: the base, why the code
// was not compared (codeWhy: no base index, or one not at the fork point; codePart: compared in some
// repositories only), and the diagrams the branch removed. Nothing here names a path outside the
// project (whyPage): a rendered page may be shared. A project that draws no diagram and proposes no
// architecture change loads no second index (archScope).
async function archAndData(project, db, files, repos, changes, deltas) {
  const idx = loadIndex(db)
  let impact = null, why = changes?.why || 'no base was resolved'
  const proposed = deltas.some((f) => { const { delta } = parseDelta(f.text); return !!(delta && delta.architecture.length) })
  const scope = changes?.base && project.root ? archScope(project, changes.base, proposed) : null
  if (scope && scope.has) { try { impact = await archImpact(project, changes.base, { idx, scope }) } catch { why = 'the base\'s diagrams could not be read' } }
  const arch = archData(project, idx, impact)
  const data = dataData(db, files, repos, changes, deltas)
  const saved = arch.map((a, k) => ({ k, a, file: a.file, doc: a.doc })).filter((x) => x.doc)
  const current = impact ? impact.current : scope ? scope.current : project.root ? currentDiagrams(project) : []
  deltas.forEach((f, i) => {
    const p = (data.deltas || [])[i]
    const { delta } = p && !p.errors.length ? parseDelta(f.text) : {}
    if (!delta) return
    const st = archDeltaStates(delta.architecture, current, { base: impact ? impact.before : null, impact })
    p.arch = packArchDelta(st, { saved, before: impact ? impact.before : null, why: impact ? null : why })
    if (impact && impact.why) Object.assign(p.arch, { codeWhy: impact.whyPage, codePart: impact.findings !== null })
  })
  for (const a of arch) delete a.doc
  const removed = impact && impact.diagrams ? impact.diagrams.files.filter((f) => f.change === 'removed').map((f) => ({ file: f.file, title: f.title, n: f.changes.length })) : []
  const archCh = impact ? { base: { ref: refName(changes.base.ref), text: baseText(changes.base) }, diagramsWhy: impact.diagramsWhy, codeWhy: impact.whyPage, codePart: impact.findings !== null, removed, skipped: impact.diagrams ? impact.diagrams.skipped : [] } : { base: null, why }
  return { arch, archCh, data }
}

// The architecture tab: every saved diagram, checked against the index, then one drafted from the
// graph on this render. A diagram that fails its check carries its errors and is not drawn. With an
// impact (above), each saved diagram that is drawn carries its Changes overlay (`ch`).
function archData(project, idx, impact = null) {
  const out = []
  const roots = project.root ? docRoots(project) : null
  for (const { file, doc, error } of project.root ? readDiagrams(project.architectureDir) : []) {
    const rel = path.relative(project.root, path.join(project.architectureDir, file)).split(path.sep).join('/')
    // one broken diagram is reported in its own place, never takes the page down
    try {
      if (error) { out.push({ file: rel, title: file, errors: [error] }); continue }
      const a = packArch(doc, analyze(doc, idx, roots), { file: rel })
      if (a.comps) { Object.defineProperty(a, 'doc', { value: doc, enumerable: false, configurable: true }); const ch = packArchChanges(rel, doc, a, impact); if (ch) a.ch = ch }
      out.push(a)
    } catch (e) { out.push({ file: rel, title: file, errors: [`could not be checked: ${e.message}`] }) }
  }
  if (idx.files.some((f) => !f.is_test)) { const d = draftArch(idx, { title: 'From the graph' }); out.push(packArch(d, analyze(d, idx, null), { auto: true })) }
  return out
}
function packArch(doc, r, extra) {
  if (!r.code) return { ...extra, title: (doc && doc.title) || extra.file, errors: r.errors }
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
  const { problems, ...layout } = r.layout
  return {
    ...extra, title: doc.title, summary: doc.summary, draft: !!doc.draft,
    comps: doc.components.map((c) => pick(c, ['id', 'label', 'sublabel', 'type', 'tag', 'note', 'repo', 'paths', 'imports', 'sources'])),
    conns: (doc.connections || []).map((e) => pick(e, ['from', 'to', 'label', 'variant', 'via', 'note'])),
    cards: doc.cards || [], layout, members: r.code.members, evidence: r.code.evidence, checkable: r.checkable, ghosts: r.code.ghosts,
    errors: r.errors, warnings: r.warnings, info: r.info, checked: r.checked,
  }
}

// The Data tab: every store the data extractors read (lib/data), reconciled as graph_data does and
// in its order. A store with tables carries them in the page's packed shape and its ERD, laid out
// here once (data/layout.mjs). A source is [p, line], p indexing the store's `paths`, each [the path
// as shown, its file id in the index or -1, the declaration's kind]. What was found but not drawn (a
// folder of unknown dialect or order, a dialect with no reader yet, a replay that read no table) is
// listed with its reason, and so is every extractor that failed: the map never pretends to be complete.
//
// The change overlay (changes: { base, at } from baseFor, else { why }): the model against the base,
// diffed (data/diff.mjs) for the repositories the base resolved in. A store that changed carries
// `ch`: its counts, the rename candidates in words, the base's paths (`bpaths`; a base source is
// [bp, line], cited as text: those lines are the base's, not the working tree's), and its tables as
// the overlay draws them, each an index into `tables` when unchanged, else the table with its marks
// (ch: added | removed | modified, was: ['attr: before → after'], ren: a rename group) and the base's
// removed elements put back where they stood, removed tables (ghosts) last; laid out here once, as
// the ERD is, so a removed table is drawn among its foreign key neighbours. A store gone from the
// branch, or with no table read in it any more, is listed in changes.removed.
//
// The deltas (deltas: [{ repo, path, shown, text, hash, selected }], docs.mjs): each one's changes
// with their states against the model and the base (data/delta.mjs), packed by packDelta below;
// `delta` is the one shown first.
export function dataData(db, files, repos, changes = null, deltas = []) {
  const out = { stores: [], unread: [], failed: [], changes: { base: null, why: changes?.why || 'no base was resolved' } }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'data_facts'").get()) return out // an index built before the data model
  const root = new Map(repos.map((r) => [r.name, r.root]))
  const shown = (repo, p) => { const r = root.get(repo); return r && r !== '.' ? (p === '.' ? r : `${r}/${p}`) : p }
  const fileId = new Map(files.map((f) => [`${f.repo}\0${f.path}`, f.id]))
  const model = reconcile(db.prepare('SELECT repo, extractor, facts FROM data_facts WHERE facts IS NOT NULL ORDER BY repo, key, extractor').all().map((r) => ({ repo: r.repo, extractor: r.extractor, facts: JSON.parse(r.facts) })))
  // the access patterns (data/access.mjs), their calls placed in the code graph's functions
  const acc = model.access ? { sites: model.access.sites, sym: symbolAt(db) } : null
  out.access = model.access ? { files: model.access.files, calls: model.access.sites.length, placed: model.access.placed, leads: model.access.leads } : null
  out.accessError = model.accessError || null
  let diff = null, whole = null
  if (changes?.base) {
    const compared = new Set(changes.base.repos.map((r) => r.name))
    const d = diffModels(changes.at.model, { stores: model.stores.filter((s) => compared.has(s.repo)) })
    whole = d
    diff = new Map(d.stores.map((s) => [s.id, s]))
    out.changes = { base: { ref: refName(changes.base.ref), text: baseText(changes.base) }, n: d.counts, removed: [], skipped: changes.base.skipped,
      failed: changes.at.failed.map((f) => ({ extractor: f.extractor, at: shown(f.repo, f.key), error: f.error })) }
  }
  for (const st of model.stores) {
    const n = st.entities.length ? out.stores.length : -1
    if (n >= 0) out.stores.push(packStore(st, shown, fileId, diff?.get(st.id) || null, acc))
    for (const d of st.declarations) {
      if (n >= 0 && d.status !== 'not-read') continue
      const reason = d.status === 'not-read' ? d.label : d.stopped ? `replayed to ${shown(st.repo, d.stopped.path)}:${d.stopped.line}: ${d.error}` : `${d.label}: no table`
      out.unread.push({ store: st.id, n, dialect: d.dialect ?? st.dialect ?? null, reason, files: d.files ?? null, at: shown(st.repo, d.path), file: fileId.get(`${st.repo}\0${d.path}`) ?? -1 })
    }
  }
  const drawn = new Set(out.stores.map((s) => s.id))
  for (const [id, sd] of diff || []) {
    const gone = sd.changes.filter((c) => c.kind === 'entity' && c.change === 'removed')
    if (!drawn.has(id) && gone.length) out.changes.removed.push({ id, dialect: sd.dialect, why: sd.change === 'removed' ? 'absent from the branch' : 'no table read in the branch', tables: gone.map((c) => [c.name, shown(sd.repo, c.before.sources[0]?.path ?? sd.name), c.before.sources[0]?.line ?? null]) })
  }
  out.failed = db.prepare('SELECT repo, key, extractor, error FROM data_facts WHERE error IS NOT NULL ORDER BY repo, key').all()
    .map((f) => ({ repo: f.repo, extractor: f.extractor, at: shown(f.repo, f.key), file: fileId.get(`${f.repo}\0${f.key}`) ?? -1, error: f.error }))
  // the item types code converts (data/binding.mjs), each with the tables it is bound to: the unbound
  // ones are listed per repository
  const where = new Map(out.stores.flatMap((s, i) => s.tables.map((t, j) => [`${s.id}/${t.name}`, [i, j]])))
  out.items = (model.items || []).map((it) => {
    const bs = (model.bindings || []).filter((b) => b.item === it.id)
    return { id: it.id, repo: it.repo, name: it.name, kind: it.kind, at: `${shown(it.repo, it.path)}:${it.line}`, file: fileId.get(`${it.repo}\0${it.path}`) ?? -1, fields: it.fields.length, notes: it.notes || [],
      bound: bs.map((b) => ({ table: b.table, conf: b.confidence, cards: b.entities.map((id) => where.get(id)).filter(Boolean) })) }
  })
  out.itemsError = model.itemsError || null
  const packedAt = new Map(out.stores.map((s, i) => [s.id, i]))
  out.deltas = deltas.map((d) => packDelta(d, { model, base: changes?.base ? changes.at.model : null, diff: whole, why: changes?.why || null, stores: out.stores, packedAt, shown }))
  out.delta = Math.max(0, deltas.findIndex((d) => d.selected))
  return out
}

// The deltas a page shows: every one beside the specs, newest first, and the one asked for (shown
// first, read wherever it is). [{ repo, path, shown, text, hash, selected }]
function deltaFiles(project, explicit) {
  const list = scanDeltas(project)
  if (!explicit) return list.map((d, i) => ({ ...d, selected: i === 0 }))
  const one = readDelta(project, explicit)
  let real = one.abs
  try { real = realpathSync(one.abs) } catch {}
  const k = list.findIndex((d) => d.abs === real)
  return k >= 0 ? list.map((d, i) => ({ ...d, selected: i === k })) : [{ ...one, selected: true }, ...list]
}

// One delta as the Data tab draws it. Its changes (by their index in `data`), each with its state,
// acknowledgement, why, slice, origin, what differs (planned → built) or what it proposes (now →
// planned), and where it is drawn: `store` (a packed store's index, -1 for a store not in the model)
// and `tbl` (the table it concerns in that store's overlay, -1 when nothing can be drawn); then the
// branch's changes no change covers (unplanned), when a base resolved. Per store with either, the
// overlay (packDeltaStore). ackable: the delta sits beside the specs of a root, so the served page
// may acknowledge its changes (serve.mjs).
const DLIST = { field: 'fields', key: 'keys', index: 'indexes', relation: 'rels' }
const MLIST = { field: 'fields', key: 'keys', index: 'indexes', relation: 'relations' }
function packDelta(file, { model, base, diff, why, stores, packedAt, shown }) {
  const head = { name: path.basename(file.shown), shown: file.shown, repo: file.repo || null, path: file.path || null, hash: file.hash, ackable: !!(file.repo && file.path) }
  const { delta, errors } = parseDelta(file.text)
  if (errors.length) return { ...head, errors }
  const s = deltaStates(delta, model, { base, diff })
  const at = (repo, list) => list.map((x) => `${shown(repo, x.path)}${x.line ? `:${x.line}` : ''}`)
  const changes = s.changes.map((r) => ({
    id: r.id, text: changeText(r.change), op: r.change.op, kind: r.t.kind, state: r.state, ack: r.ack, by: r.change.ack?.by ?? null, at: r.change.ack?.at ?? null,
    why: r.change.why, slice: r.change.slice ?? null, origin: r.change.origin, after: afterText(r.t.kind, r.change),
    diffs: r.diffs.map((x) => diffText(x, (p) => shown(r.st.repo, p))), proposed: r.proposed.map((x) => diffText(x, (p) => shown(r.st.repo, p))), warn: r.warn,
    src: r.el && r.el.sources && r.state !== 'pending' ? at(r.st.repo, r.el.sources) : [], store: r.st && packedAt.has(r.st.id) ? packedAt.get(r.st.id) : -1, tbl: -1,
  }))
  const unplanned = s.unplanned.map((u) => ({ text: describeChange(u.c, u.st.dialect), change: u.c.change, target: u.target, store: packedAt.has(u.st.id) ? packedAt.get(u.st.id) : -1, tbl: -1,
    was: u.c.attrs.map((a) => `${a.attr === 'onDelete' ? 'on delete' : a.attr === 'onUpdate' ? 'on update' : a.attr}${a.in ? ` in ${shown(u.st.repo, a.in)}` : ''}: ${changeVal(a.attr, a.before, (p) => shown(u.st.repo, p))} → ${changeVal(a.attr, a.after, (p) => shown(u.st.repo, p))}`) }))
  const byStore = new Map()
  const slot = (n) => { if (!byStore.has(n)) byStore.set(n, { rs: [], us: [] }); return byStore.get(n) }
  s.changes.forEach((r, k) => { if (changes[k].store >= 0) slot(changes[k].store).rs.push([r, k]) })
  s.unplanned.forEach((u, j) => { if (unplanned[j].store >= 0) slot(unplanned[j].store).us.push([u, j]) })
  const overlay = stores.map((ps, n) => (byStore.has(n) ? packDeltaStore(ps, model.stores.find((x) => x.id === ps.id), byStore.get(n), { base, diff, changes, unplanned, shown }) : null))
  return { ...head, errors: [], spec: delta.spec, changes, unplanned, stores: overlay, unplWhy: diff ? null : why || 'no base was resolved' }
}
const describeChange = (c, dialect = null) => (c.kind === 'entity' ? `${(c.after || c.before).kind} ${c.name} ${c.change}` : `${dialect === 'dynamodb' && c.kind === 'field' ? 'attribute' : CHANGE_KIND[c.kind]} ${c.entity} · ${c.name} ${c.change}`)
// What `after` states, in a line (shown as text in the passport).
function afterText(kind, c) {
  const a = c.after
  if (!a || c.op === 'remove') return null
  if (c.op === 'rename') return `named ${a.name}`
  const f = (x) => [x.type, 'nullable' in x ? (x.nullable ? 'nullable' : 'not null') : null, 'default' in x ? `default ${x.default === null ? 'none' : x.default}` : null, 'generated' in x ? `generated ${x.generated}` : null].filter(Boolean).join(', ')
  // a GSI's or an LSI's keys and projection; a key-value table's billing and stream
  const kv = (x) => [x.kind ? (x.kind === 'lsi' ? 'local' : 'global') : null, x.partition ? `partition (${x.partition.join(', ')})` : null, x.sort && x.sort.length ? `sort (${x.sort.join(', ')})` : null, x.projection ? projectionText({ projection: x.projection, include: x.include || [] }) : x.include ? `including ${x.include.join(', ')}` : null].filter(Boolean).join(' · ')
  const own = (x) => ['billing' in x ? `billing ${x.billing}` : null, 'stream' in x ? (x.stream ? `stream ${x.stream}` : 'no stream') : null].filter(Boolean).join(' · ')
  if (kind === 'field') return f(a)
  if (kind === 'index' && ['kind', 'partition', 'sort', 'projection', 'include'].some((k) => k in a)) return kv(a)
  if (kind === 'index') return [a.columns ? `(${a.columns.join(', ')})` : null, 'unique' in a ? (a.unique ? 'unique' : 'not unique') : null, 'partial' in a ? (a.partial ? 'partial' : 'whole') : null].filter(Boolean).join(' ')
  if (kind === 'relation') return [a.onDelete ? `on delete ${a.onDelete}` : null, a.onUpdate ? `on update ${a.onUpdate}` : null].filter(Boolean).join(' · ') || null
  if (kind === 'key') return 'enabled' in a ? `TTL ${a.enabled ? 'on' : 'off'}` : null
  if (kind === 'entity') return a.fields ? `${a.kind || 'table'}: ${a.fields.map((x) => `${x.name} ${f(x)}`).join('; ')}${own(a) ? ` · ${own(a)}` : ''}` : [a.kind, own(a)].filter(Boolean).join(' · ')
  return null
}
// One store's delta overlay: its tables, each an index into the store's own when untouched, else a
// copy marked `dl: { s, c, gone }` on the table or an element: s one of prop (a proposed addition,
// drawn dashed), rm (a proposed removal, struck), pend (a proposed change or rename, with what it
// proposes), built (planned and built), diff (built differently, with planned → built) and unpl (in
// the branch, in no change: not in the plan); `c` the change indexes it carries; `gone` an element
// drawn from the base (a removal built, or one not in the plan, cited as the base's: `bpaths`).
// Proposed tables and the base's removed ones (ghosts) come after the store's tables, laid out with
// them here, once, as the ERD is. ks: the store's change indexes, us: its unplanned ones.
function packDeltaStore(ps, st, { rs, us }, { base, diff, changes, unplanned, shown }) {
  const tables = ps.tables, lower = (x) => String(x).toLowerCase()
  const sd = diff?.stores.find((x) => x.id === ps.id) || null
  const bst = sd?.before || base?.stores.find((x) => x.id === ps.id) || null
  const bpaths = [], bat = new Map()
  const bsrc = (list) => list.map((x) => { if (!bat.has(x.path)) { bat.set(x.path, bpaths.length); bpaths.push(shown(ps.repo, x.path)) } return [bat.get(x.path), x.line ?? null] })
  const packBase = bst ? packer(bst.entities, () => [], () => [], bsrc) : null
  const based = new Map()
  const baseTable = (i) => { if (!based.has(i)) based.set(i, packBase(bst.entities[i])); return based.get(i) }
  const marked = new Map()
  const mark = (i) => {
    if (!marked.has(i)) { const t = tables[i]; marked.set(i, { ...t, fields: t.fields.map((x) => ({ ...x })), keys: t.keys.map((x) => ({ ...x })), indexes: t.indexes.map((x) => ({ ...x })), rels: t.rels.map((x) => ({ ...x })), gone: { fields: [], keys: [], indexes: [], rels: [] }, extra: { fields: [], keys: [], indexes: [], rels: [] } }) }
    return marked.get(i)
  }
  const set = (x, s, c, line) => { x.dl = { s, c: [...(x.dl?.c || []), ...c], gone: !!x.dl?.gone }; if (line) x.was = [...(x.was || []), line] }
  const ghosts = [], proposed = [], where = [] // where: [the info, the table object it concerns]
  const entityAt = (e) => st.entities.indexOf(e)
  // a proposed table, from `after`, in the page's packed shape (no source: it is not in the code yet)
  // an index as `after` states it: a SQL one's columns, a GSI's or an LSI's keys and projection
  const indexOf = (name, x) => (x.kind === 'gsi' || x.kind === 'lsi' ? { name, unique: false, columns: [...(x.partition || []), ...(x.sort || [])], partial: false, ...kvPack(x) } : { name, unique: !!x.unique, columns: x.columns, partial: !!x.partial })
  const ghostOf = (name, a, c) => {
    const P = { s: 'prop', c }
    const keys = (a.keys || []).map((k) => ({ role: k.role, parts: k.parts, ...(k.role === 'ttl' ? { enabled: k.enabled ?? null } : {}), src: [], cf: [], dl: P }))
    const pk = new Set(keys.filter((k) => k.role === 'primary').flatMap((k) => k.parts.map(lower))), fk = new Set((a.relations || []).flatMap((r) => r.columns.map(lower)))
    return { name, kind: a.kind || 'table', ...(ps.cards ? { billing: a.billing ?? null, stream: a.stream ?? null } : {}), src: [], cf: [], dl: P,
      fields: a.fields.map((f) => ({ name: f.name, type: f.type, nullable: f.nullable, def: f.default ?? null, gen: f.generated ?? null, pk: pk.has(lower(f.name)) ? 1 : 0, fk: fk.has(lower(f.name)) ? 1 : 0, src: [], cf: [], dl: P })),
      keys, indexes: (a.indexes || []).map((x) => ({ ...indexOf(x.name, x), src: [], cf: [], dl: P })),
      rels: (a.relations || []).map((r) => ({ columns: r.columns, to: r.to, toColumns: r.toColumns, onDelete: r.onDelete || 'no action', onUpdate: r.onUpdate || 'no action', src: [], cf: [], dl: P })) }
  }
  const proposedEl = (kind, t, a, c) => {
    const P = { s: 'prop', c }
    if (kind === 'field') return { name: t.el.name, type: a.type, nullable: a.nullable, def: a.default ?? null, gen: a.generated ?? null, pk: 0, fk: 0, src: [], cf: [], dl: P }
    if (kind === 'index') return { ...indexOf(t.el.name, a), src: [], cf: [], dl: P }
    if (kind === 'key') return { role: t.el.role, parts: t.el.parts, ...(t.el.role === 'ttl' ? { enabled: a?.enabled ?? null } : {}), src: [], cf: [], dl: P }
    return { columns: t.el.columns, to: t.el.to, toColumns: t.el.toColumns, onDelete: a?.onDelete || 'no action', onUpdate: a?.onUpdate || 'no action', src: [], cf: [], dl: P }
  }
  // an element of the base put back where it stood there (a removal built, or one not in the plan);
  // a table gone from the branch comes back as a ghost
  const fromBase = (kind, t, s, c) => {
    const found = bst ? findTarget({ stores: [bst] }, { ...t, storeId: bst.id }) : null
    if (!found || !found.e) return null
    const bi = bst.entities.indexOf(found.e)
    if (kind === 'entity') { const g = { ...baseTable(bi), dl: { s, c, gone: true } }; ghosts.push(g); return g }
    if (!found.el) return null
    const cur = st.entities.findIndex((x) => found.fold(x.name) === found.fold(found.e.name))
    if (cur < 0) return null // the table itself is gone: its ghost carries it
    const k = found.e[MLIST[kind]].indexOf(found.el), host = mark(cur)
    host.gone[DLIST[kind]].push([k, { ...baseTable(bi)[DLIST[kind]][k], dl: { s, c, gone: true } }])
    return host
  }
  // the delta's changes, its tables first, so a column can join a proposed table
  const sorted = rs.slice().sort(([a], [b]) => (a.t.kind === 'entity' ? 0 : 1) - (b.t.kind === 'entity' ? 0 : 1))
  for (const [r, k] of sorted) {
    const c = [k], info = changes[k], kind = r.t.kind
    const line = r.state === 'built-differently' ? `planned → built: ${r.diffs.map((x) => diffText(x, (p) => shown(ps.repo, p))).join('; ')}` : r.proposed.length ? `proposed: ${r.proposed.map((x) => diffText(x, (p) => shown(ps.repo, p))).join('; ')}` : null
    const s = r.state === 'planned-built' ? 'built' : r.state === 'built-differently' ? 'diff' : r.change.op === 'add' ? 'prop' : r.change.op === 'remove' ? 'rm' : 'pend'
    const place = (t) => { if (t) where.push([info, t]) }
    if (s === 'built' && r.change.op === 'remove') { place(fromBase(kind, r.t, 'built', c)); continue }
    if (kind === 'entity') {
      if (r.e) { const t = mark(entityAt(r.e)); set(t, s, c, line); place(t) } else if (s === 'prop') { const g = ghostOf(r.t.entity, r.change.after, c); proposed.push(g); place(g) }
      continue
    }
    if (s === 'prop') {
      const host = r.e ? mark(entityAt(r.e)) : proposed.find((g) => lower(g.name) === lower(r.t.entity)) || null
      if (!host) continue
      ;(host.extra ? host.extra[DLIST[kind]] : host[DLIST[kind]]).push(proposedEl(kind, r.t, r.change.after, c))
      place(host)
      continue
    }
    if (!r.e || !r.el) continue
    const t = mark(entityAt(r.e))
    set(t[DLIST[kind]][r.e[MLIST[kind]].indexOf(r.el)], s, c, line)
    place(t)
  }
  // what the branch changed and no change covers: not in the plan
  for (const [u, j] of us) {
    const c = u.c, info = unplanned[j]
    if (c.change === 'removed') { const t = fromBase(c.kind, { entity: c.entity, kind: c.kind, el: c.before }, 'unpl', []); if (t) where.push([info, t]); continue }
    const t = mark(c.kind === 'entity' ? c.pos.after : c.owner.after)
    const el = c.kind === 'entity' ? t : t[DLIST[c.kind]][c.pos.after]
    el.dl = { s: 'unpl', c: [], gone: false }
    if (info.was.length) el.was = [...(el.was || []), `not in the plan: ${info.was.join('; ')}`]
    where.push([info, t])
  }
  const index = new Map()
  const list = tables.map((t, i) => {
    if (!marked.has(i)) return i
    const { gone, extra, ...m } = marked.get(i)
    for (const L of Object.values(DLIST)) { for (const [p, x] of gone[L].sort((a, b) => a[0] - b[0])) m[L].splice(Math.min(p, m[L].length), 0, x); m[L].push(...extra[L]) }
    index.set(marked.get(i), i)
    return m
  })
  ghosts.forEach((g, j) => index.set(g, tables.length + j))
  proposed.forEach((g, j) => index.set(g, tables.length + ghosts.length + j))
  for (const [info, t] of where) if (info.tbl < 0) info.tbl = index.get(t) ?? -1
  // a proposed foreign key names its table as the store does (SQLite: in any letter case)
  const drawn = [...list.map((t) => (typeof t === 'number' ? tables[t] : t)), ...ghosts, ...proposed]
  const names = new Map(drawn.map((t) => [lower(t.name), t.name]))
  for (const t of drawn) for (const r of t.rels) if (r.dl && r.dl.s === 'prop' && names.has(lower(r.to))) r.to = names.get(lower(r.to))
  return { tables: [...list, ...ghosts, ...proposed], layout: ps.cards ? null : layoutErd(drawn, { collapsed: ps.collapsed }), ks: rs.map(([, k]) => k).sort((a, b) => a - b), us: us.map(([, j]) => j).sort((a, b) => a - b), bpaths }
}

// The base the overlay compares against, and its model: { base, at }, or { why } when there is none.
// A base given that does not resolve throws (the caller asked for it); a failure reading it is a why.
async function baseFor(project, explicit) {
  const base = resolveBase(project, { explicit })
  if (base.error) { if (explicit) throw new Error(base.error); return { why: base.error } }
  try { return { base, at: await modelAt(project, base) } } catch (e) { if (explicit) throw e; return { why: `the base could not be read: ${e.message}` } }
}

// A store's entities packed as the page draws them. src(sources) and cf(conflicts) pack what each
// element cites; bsrc, when given, packs its sources as the base's instead.
// SQLite resolves table and column names in any letter case, and keeps a foreign key's as written
// (`REFERENCES Authors(ID)` for `authors.id`): each is resolved here, once, to the name the store
// declares, so the layout and the page match names exactly. One that names nothing stays as written.
function packer(entities, src, cf, bsrc = null) {
  const lower = (s) => String(s).toLowerCase()
  const byName = new Map(), byLower = new Map()
  for (const e of entities) { byName.set(e.name, e); if (!byLower.has(lower(e.name))) byLower.set(lower(e.name), e) }
  const entity = (name) => byName.get(name) || byLower.get(lower(name)) || null
  const column = (e, c) => { if (!e || c === null || c === undefined) return c; const f = e.fields.find((x) => x.name === c) || e.fields.find((x) => lower(x.name) === lower(c)); return f ? f.name : c }
  const cite = (x) => ({ src: src(x.sources), cf: cf(x.conflicts), ...(bsrc ? { bsrc: bsrc(x.sources) } : {}) })
  return (e) => {
    const rels = e.relations.map((r) => { const to = entity(r.to); return { r, columns: r.columns.map((c) => column(e, c)), to: to ? to.name : r.to, toColumns: r.toColumns.map((c) => column(to, c)) } })
    const keys = e.keys.map((k) => ({ k, parts: k.parts.map((c) => column(e, c)) }))
    const pk = new Set(keys.filter(({ k }) => k.role === 'primary').flatMap(({ parts }) => parts)), fk = new Set(rels.flatMap(({ columns }) => columns))
    return {
      name: e.name, kind: e.kind, ...(kvTable(e) ? { billing: e.billing ?? null, stream: e.stream ?? null } : {}), ...(e.nameTemplate ? { nt: e.nameTemplate } : {}), ...cite(e),
      fields: e.fields.map((f) => ({ name: f.name, type: f.type.raw, nullable: f.nullable, def: f.default, gen: f.generated, pk: pk.has(f.name) ? 1 : 0, fk: fk.has(f.name) ? 1 : 0, ...cite(f),
        ...(f.item ? { it: f.item.map((i) => ({ t: i.type, raw: i.raw, kind: i.kind, nul: i.nullable ? 1 : 0, def: i.default ?? null, vals: i.values ?? null })), ...(f.sources.every((s) => s.kind === 'code') ? { code: 1 } : {}) } : {}) })),
      keys: keys.map(({ k, parts }) => ({ role: k.role, parts, ...(k.role === 'ttl' ? { enabled: k.enabled ?? null } : {}), ...cite(k) })),
      indexes: e.indexes.map((x) => ({ name: x.name, unique: x.unique, columns: x.columns, partial: x.partial, ...(kvIndex(x) ? kvPack(x) : {}), ...cite(x) })),
      rels: rels.map(({ r, columns, to, toColumns }) => ({ columns, to, toColumns, onDelete: r.onDelete, onUpdate: r.onUpdate, ...cite(r) })),
    }
  }
}
// A GSI's or an LSI's keys and projection, as the key cards draw them.
const kvPack = (x) => ({ kind: x.kind, partition: x.partition || [], sort: x.sort || [], projection: x.projection ?? null, include: x.include || [] })
// A key-value table's bindings and logical table, as its key card draws them (data/binding.mjs):
//   bound [{ type, conf, how, dash: drawn dashed (below convention), sites, at: [p, line], ev: [{ what,
//          text, src: [p, line], test }], riv: [{ table, conf, how }] }]
//   lg    { name, via, members, cf: [{ label, attr, values: [{ value, src }] }] }, lnote: why it joined none
// and each field an item type states carries `it` [{ t: the type, raw, kind, nul, def, vals }] (its
// source kind is code), `code: 1` when no declaration types it.
function packItems(e, src, cf) {
  const one = (x) => src([x])[0]
  return {
    ...(e.bound ? { bound: e.bound.map((b) => ({ type: b.type, conf: b.confidence, how: bindingHow(b), dash: dashed(b.confidence) ? 1 : 0, sites: b.sites, at: one(b), ev: b.evidence.map((x) => ({ what: x.what, text: x.text, src: one(x), ...(x.test ? { test: 1 } : {}) })), riv: b.rivals.map((r) => ({ table: r.table, conf: r.confidence, how: bindingHow(r) })) })) } : {}),
    ...(e.logical ? { lg: { name: e.logical.name, via: e.logical.via, members: e.logical.members, cf: e.logical.conflicts.map((c) => ({ label: c.label, ...cf([c])[0] })) } } : {}),
    ...(e.logicalNote ? { lnote: e.logicalNote } : {}),
  }
}
// A key-value table's access patterns (data/access.mjs), as its key card draws them:
//   acc { ix: [{ n: the index, q: [Fn] the functions querying it, lead: text | null }],
//         rw: [Fn + { r: it reads, wr: it writes }], cf: [{ label, attr, values: [{ value, src }] }]
//         (what a call writes that the bound item does not state), note? }
//   Fn  { n: its name (the code graph's symbol), ops: [words], w: [path written], at: [p, line],
//         lines: [the calls' lines], how: how the calls reached the table, test, c: its callers }
function packAccess(e, src, cf, acc) {
  if (!e.access || !acc) return {}
  const sites = (list) => list.map((k) => acc.sites[k])
  const fn = (f) => ({ n: f.name, ops: f.ops, w: f.writes, at: src([{ repo: f.repo, path: f.path, line: f.line, kind: 'code' }])[0], lines: f.sites.map((s) => s.line), how: [...new Set(f.sites.map(siteHow))].join(' · '), ...(f.test ? { test: 1 } : {}), c: f.callers })
  return {
    acc: {
      ix: e.access.indexes.map((i) => ({ n: i.name, q: byFunction(sites(i.sites), acc.sym).map(fn), lead: i.lead })),
      rw: byFunction(sites(e.access.sites), acc.sym).map((f) => ({ ...fn(f), r: f.sites.some(isRead) ? 1 : 0, wr: f.sites.some((s) => !isRead(s)) ? 1 : 0 })),
      cf: cf(e.access.conflicts).map((c, j) => ({ label: e.access.conflicts[j].label, ...c })),
      ...(e.access.note ? { note: e.access.note } : {}),
    },
  }
}
// A store drawn as key cards rather than an ERD: a key-value one (its tables have no foreign key to
// draw, and keys, indexes, TTL and stream to show).
const CARDS = new Set(['dynamodb'])
function packStore(st, shown, fileId, sd = null, acc = null) {
  const paths = [], at = new Map()
  // a path of the store's repository, or of another (the code an item type is bound from)
  const P = (p, kind = null, repo = st.repo) => {
    const k = `${repo}\0${p}`
    if (!at.has(k)) { at.set(k, paths.length); paths.push([shown(repo, p), fileId.get(k) ?? -1, kind]) } else if (kind && !paths[at.get(k)][2]) paths[at.get(k)][2] = kind
    return at.get(k)
  }
  // a source: [path index, line], and how the declaration names the element when it says (a template's logical id)
  const src = (list) => list.map((s) => (s.as ? [P(s.path, s.kind, s.repo ?? st.repo), s.line ?? null, s.as] : [P(s.path, s.kind, s.repo ?? st.repo), s.line ?? null]))
  const cf = (list) => list.map((c) => ({ attr: c.attr, values: c.values.map((v) => ({ value: v.value, src: src(v.sources) })) }))
  const tables = st.entities.map(packer(st.entities, src, cf))
  // a key-value table's item types (data/binding.mjs): its bindings with their evidence and rivals,
  // the logical table it is one declaration of with the conflicts across it
  if (CARDS.has(st.dialect)) st.entities.forEach((e, i) => Object.assign(tables[i], packItems(e, src, cf), packAccess(e, src, cf, acc)))
  const f = st.dialectFrom, cards = CARDS.has(st.dialect), collapsed = !cards && tables.length > DATA_COLLAPSE
  return {
    id: st.id, repo: st.repo, name: st.name, dialect: st.dialect, summary: storeSummary(st),
    how: f ? { how: f.how, marker: f.marker ?? null, at: f.path ? [P(f.path), f.line ?? null] : null } : null,
    decls: st.declarations.map((d) => ({ kind: d.kind, extractor: d.extractor, status: d.status, label: d.label, at: [P(d.path, d.kind), null], stopped: d.stopped ? [P(d.stopped.path, d.kind), d.stopped.line] : null, error: d.error, notes: d.notes })),
    paths, tables, collapsed, ...(cards ? { cards: true, layout: null } : { layout: layoutErd(tables, { collapsed }) }),
    ...(sd ? { ch: packChanges(sd, tables, collapsed, shown, cards) } : {}),
  }
}

// One store's overlay (see dataData). The marks sit on copies: the ERD's own tables stay as they are.
const LIST = { field: 'fields', key: 'keys', index: 'indexes', relation: 'rels' }
function packChanges(sd, tables, collapsed, shown, cards = false) {
  const bpaths = [], bat = new Map()
  const bsrc = (list) => list.map((s) => { if (!bat.has(s.path)) { bat.set(s.path, bpaths.length); bpaths.push(shown(sd.repo, s.path)) } return [bat.get(s.path), s.line ?? null] })
  const packBase = sd.before ? packer(sd.before.entities, () => [], () => [], bsrc) : null
  const based = new Map() // base entity index → its packed table, citing the base
  const base = (i) => { if (!based.has(i)) based.set(i, packBase(sd.before.entities[i])); return based.get(i) }
  const marked = new Map() // table index → its marked copy, with the base's removed elements aside
  const mark = (i) => {
    if (!marked.has(i)) { const t = tables[i]; marked.set(i, { ...t, ch: 'modified', fields: t.fields.map((x) => ({ ...x })), keys: t.keys.map((x) => ({ ...x })), indexes: t.indexes.map((x) => ({ ...x })), rels: t.rels.map((x) => ({ ...x })), gone: { fields: [], keys: [], indexes: [], rels: [] } }) }
    return marked.get(i)
  }
  const was = (c) => c.attrs.map((a) => `${a.attr === 'onDelete' ? 'on delete' : a.attr === 'onUpdate' ? 'on update' : a.attr}${a.in ? ` in ${shown(sd.repo, a.in)}` : ''}: ${changeVal(a.attr, a.before, (p) => shown(sd.repo, p))} → ${changeVal(a.attr, a.after, (p) => shown(sd.repo, p))}`)
  const ghosts = []
  for (const c of sd.changes) {
    const ren = c.rename ?? null
    if (c.kind === 'entity') {
      if (c.change === 'removed') ghosts.push({ ...base(c.pos.before), ch: 'removed', ren })
      else Object.assign(mark(c.pos.after), { ch: c.change, ren, ...(c.change === 'modified' ? { was: was(c), bsrc: base(c.pos.before).bsrc } : {}) })
      continue
    }
    const t = mark(c.owner.after), L = LIST[c.kind]
    if (c.change === 'removed') t.gone[L].push([c.pos.before, { ...base(c.owner.before)[L][c.pos.before], ch: 'removed', ren }])
    else Object.assign(t[L][c.pos.after], { ch: c.change, ren, ...(c.change === 'modified' ? { was: was(c), bsrc: base(c.owner.before)[L][c.pos.before].bsrc } : {}) })
  }
  const list = tables.map((t, i) => {
    if (!marked.has(i)) return i
    const { gone, ...m } = marked.get(i)
    for (const L of Object.values(LIST)) for (const [p, x] of gone[L].sort((a, b) => a[0] - b[0])) m[L].splice(Math.min(p, m[L].length), 0, x) // where it stood in the base
    return m
  })
  const drawn = [...list.map((t) => (typeof t === 'number' ? tables[t] : t)), ...ghosts]
  const n = (k) => sd.changes.filter((c) => c.change === k).length
  return {
    store: sd.change, n: { added: n('added'), removed: n('removed'), modified: n('modified'), renames: sd.renames.length },
    attrs: sd.attrs.map((a) => `${a.attr}: ${changeVal(a.attr, a.before)} → ${changeVal(a.attr, a.after)}`),
    renames: sd.renames.map((r) => ({ kind: r.kind, ambiguous: r.ambiguous, text: renameText(sd, r) })),
    bpaths, tables: [...list, ...ghosts], layout: cards ? null : layoutErd(drawn, { collapsed }),
  }
}

// The file-level graph for the file map: most connected files, weighted links, positions, groups.
// A link whose every edge is ambiguous is flagged [a, b, w, 1]: the page hides it until asked. Only
// links resolved by syntax rank a file, so no name guess decides which files make the map.
export function mapData(files, nodes, edges) {
  const fileOfNode = new Map()
  for (const f of files) fileOfNode.set(f.node_id, f.id)
  for (const n of nodes) fileOfNode.set(n.id, n.file_id)
  const w = new Map(), sure = new Map(), shown = new Map(), deg = new Map()
  for (const e of edges) {
    const a = fileOfNode.get(e.src), b = fileOfNode.get(e.dst)
    if (a === undefined || b === undefined || a === b) continue
    const k = a < b ? `${a},${b}` : `${b},${a}`
    w.set(k, (w.get(k) || 0) + 1)
    if (e.confidence !== 'ambiguous') shown.set(k, true)
    if (e.confidence !== 'ambiguous' && e.confidence !== 'unique-name') sure.set(k, (sure.get(k) || 0) + 1)
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
  for (const [k, v] of w) { const [a, b] = k.split(',').map(Number); if (at.has(a) && at.has(b)) links.push([at.get(a), at.get(b), v, shown.has(k) ? 0 : 1]) }
  links.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const { pos, groups } = layoutMap(keep, links)
  return { files: keep.map((f) => f.id), deg: keep.map((f) => f.deg), pos, links, groups, total: production, totals }
}

// ── pure helpers: exported for the tests, injected into the page as they are ──
export const INITIAL = { tab: 'overview', repo: '', q: '', tests: false, guesses: false, mapMode: 'modules', module: null,
  arch: 0, archSel: null, archTrace: null, archTo: null, archGhosts: false, archChanges: false, archDelta: false, archZoom: null, archScroll: null, sysZoom: null, full: null, doc: null, docMode: 'read', docAnchor: null, focusEditor: false, editorCaret: null,
  data: 0, dataSel: null, dataAll: false, dataZoom: null, dataScroll: null, dataChanges: false, dataDelta: false, deltaSel: null, dlStatus: null, dlOpen: null }
export const LANE_MAX = 14 // modules drawn per lane on the system map, the largest
export const MAXCOL = 12 // items per column of a neighbourhood

// HTML-escape text for markup and attributes. ([<] because html() rewrites every "<" "/" pair.)
export function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/[<]/g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
export function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s } // keep the start of a name
export function cutL(s, n) { return s.length > n ? '…' + s.slice(-(n - 1)) : s } // keep the end of a path
export function plural(n, word) { return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}` }

// '#sym-12' → { kind: 'sym', id: 12 }, '#map' → { kind: 'tab', tab: 'map' }, anything else → null
// (#arch-N opens a diagram, #data-N a data store, #doc-N a note)
export function parseHash(hash, tabs) {
  const m = /^#(sym|file|mod|arch|data|doc)-(\d+)$/.exec(hash || '')
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
// The scale a W×H drawing is shown at when fitted to its box: the box's width less its padding (at
// least 720 px, the system map's floor, except at full size), and at full size its height too, as
// the svg's own `meet` does. The zoom buttons step from this, so − never enlarges a fitted map.
export function fitOf(boxW, boxH, W, H, full) {
  const w = Math.max(full ? 1 : 720, boxW - 24) / W
  return full && boxH > 24 ? Math.min(w, (boxH - 24) / H) : w
}
export function lanePick(mods, max) {
  const keep = new Set(mods.slice().sort((a, b) => b.files - a.files || a.i - b.i).slice(0, max))
  return { shown: mods.filter((m) => keep.has(m)), rest: mods.length - keep.size }
}

const HELPERS = [esc, cut, cutL, plural, parseHash, pairConf, heatOf, heatBands, squarify, fitOf, lanePick, mdSlug, mdFront, mdToHtml, archClient, docsClient, erdBox, layoutErd, dataClient, stageClient]

function html(data, served) {
  // Every "<" becomes \\u003c, so no data string can close the <script> element.
  const blob = JSON.stringify(data).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029')
  const js = `${HELPERS.map((f) => f.toString()).join('\n')}\nconst INITIAL = ${JSON.stringify(INITIAL)}, LANE_MAX = ${LANE_MAX}, MAXCOL = ${MAXCOL};\n(${client.toString()})()`.replace(/<\//g, '<\\/').replace(/\r\n?/g, '\n') // LF only: a browser normalises line ends before it hashes
  // the script must never open an HTML comment or a script element: either would change where the
  // browser ends this <script> (the helpers spell them in pieces)
  if (/<!--|<script/i.test(js)) throw new Error('the page script holds "<!--" or "<script"; spell it in pieces')
  const hash = createHash('sha256').update(js, 'utf8').digest('base64')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; img-src 'none'; base-uri 'none'; form-action 'none'${served ? "; connect-src 'self'" : ''}"><meta name="referrer" content="no-referrer">
<title>grimoire code graph</title><style>${CSS}</style></head>
<body><noscript>This page needs JavaScript to render the code graph.</noscript>
<script type="application/json" id="graph-data">${blob}</script>
<script>${js}</script>
</body></html>
`
}

const CSS = `
:root{--bg:#fbfaf8;--panel:#fff;--ink:#1d1d1f;--muted:#6b6b72;--line:#e6e4df;--accent:#6d4aff;--on-accent:#fff;--accent-soft:#eeeaff;--hover:#f2f0ec;--edge:rgba(60,60,70,.16);--link:rgba(60,60,70,.32);
--heat0:#e9e8e4;--heat1:#f6dcb2;--heat2:#efb46b;--heat3:#d97a33;--heat4:#a8461b;--tl3:#1d1d1f;--tl4:#fff;
--t-frontend:#2563eb;--t-backend:#7c3aed;--t-worker:#c026d3;--t-database:#059669;--t-messagebus:#d97706;--t-cloud:#0891b2;--t-security:#e11d48;--t-external:#64748b;--t-library:#65a30d;--t-cli:#ea580c;--ok:#15803d;--warn:#b45309;--err:#b91c1c}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1c1c21;--ink:#ececf1;--muted:#9a9aa6;--line:#2c2c33;--accent:#a08bff;--on-accent:#141417;--accent-soft:#2a2540;--hover:#24242b;--edge:rgba(220,220,235,.13);--link:rgba(220,220,235,.28);
--heat0:#28292e;--heat1:#4d3b25;--heat2:#85592a;--heat3:#c87430;--heat4:#f59a4a;--tl3:#1d1d1f;--tl4:#1d1d1f;
--t-frontend:#60a5fa;--t-backend:#a78bfa;--t-worker:#e879f9;--t-database:#34d399;--t-messagebus:#fbbf24;--t-cloud:#22d3ee;--t-security:#fb7185;--t-external:#94a3b8;--t-library:#a3e635;--t-cli:#fb923c;--ok:#4ade80;--warn:#fbbf24;--err:#f87171}}
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
#map canvas{width:100%;height:100%;display:block;cursor:grab;touch-action:none}#map canvas:focus-visible{outline-offset:-3px}#tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);padding:4px 8px;border-radius:6px;font-size:12px;display:none;white-space:nowrap}
.legend{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0;align-items:center}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
.pill{display:inline-block;padding:1px 7px;border-radius:999px;border:1px solid var(--line);font-size:11px;color:var(--muted);margin-left:6px}
.detail{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:20px}.detail h3{margin:0 0 6px;font-size:15px;overflow-wrap:anywhere}
ul.links{list-style:none;padding:0;margin:6px 0 0}ul.links li{padding:3px 0;overflow-wrap:anywhere}a.jump{color:var(--accent);cursor:pointer;text-decoration:none}a.jump:hover{text-decoration:underline}
.note{color:var(--muted);font-size:12px;margin:8px 0}.linkbtn{font:inherit;color:var(--accent);background:none;border:0;padding:0;cursor:pointer}.linkbtn:hover{text-decoration:underline}details{margin-top:12px}summary{cursor:pointer;color:var(--muted);font-size:13px}
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
.t-frontend{--c:var(--t-frontend)}.t-backend{--c:var(--t-backend)}.t-worker{--c:var(--t-worker)}.t-database{--c:var(--t-database)}.t-messagebus{--c:var(--t-messagebus)}
.t-cloud{--c:var(--t-cloud)}.t-security{--c:var(--t-security)}.t-external{--c:var(--t-external)}.t-library{--c:var(--t-library)}.t-cli{--c:var(--t-cli)}
.tdot{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--c);margin-right:6px;vertical-align:-1px}
.split.rev{grid-template-columns:minmax(0,1.6fr) minmax(0,.75fr)}@media (max-width:1100px){.split.rev{grid-template-columns:1fr}.split.rev>.side{order:0}}
.summary{font-size:15px;max-width:900px;margin:0 0 12px}.pill.ok{color:var(--ok);border-color:currentColor}.pill.warn{color:var(--warn);border-color:currentColor}
details.problems{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:8px 14px;margin:0 0 12px}details.problems ul{margin:8px 0 2px;padding-left:20px;font-size:13px}li.err{color:var(--err)}
.detail.problems ul{padding-left:20px}.passport h2{font-size:13px;margin:16px 0 6px}.seg.trace{flex-wrap:wrap;margin:12px 0 4px}
.stage{position:relative;display:flex;gap:12px;align-items:stretch}.stagebody{position:relative;flex:1;min-width:0}
.stagectl{position:absolute;top:8px;right:8px;z-index:3;display:flex;gap:6px;align-items:center;padding:4px;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.stagectl .seg button{padding:4px 9px;min-width:32px;line-height:1.2}
.stage.full{position:fixed;inset:0;z-index:50;background:var(--bg);padding:12px;overscroll-behavior:contain}.stage.full .stagebody>:first-child{height:100%;max-height:none;margin:0}
.stage.full>.stageside{width:min(420px,38vw);flex:none;overflow:auto;max-height:100%}.stage.full>.stageside>.detail{margin:0}
.stage.full .sysbox:not(.zoomed) svg{width:100%;height:100%;min-width:0}.stage.full #map{height:100%}.stage.full .archbox{display:flex}.stage.full .archbox svg{margin:auto;flex:none}.svgbox.zoomed{overflow:auto}.svgbox.zoomed svg{width:auto;min-width:0;max-width:none}
.archbox{padding:6px;overflow:auto;max-height:78vh;cursor:grab}.archbox:active{cursor:grabbing}.archbox svg{width:auto;min-width:0;max-width:none;height:auto;margin:0 auto}
.panning{-webkit-user-select:none;user-select:none}.archbox.panning,#map canvas.panning{cursor:grabbing}svg.arch text,svg.erd text{-webkit-user-select:none;user-select:none}
svg.arch text{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
svg.arch .bound rect{fill:color-mix(in srgb,var(--hover) 60%,transparent);stroke:var(--line);stroke-width:1.3;stroke-dasharray:7 5}
svg.arch .bound.k-trust rect{stroke:var(--t-security)}svg.arch .bound.k-region rect{stroke:var(--t-cloud)}svg.arch .bound.k-deploy rect{stroke:var(--t-backend)}svg.arch .bound.k-network rect{stroke:var(--t-messagebus)}svg.arch .bound.k-repo rect{stroke-dasharray:none}
svg.arch .blabel{font-size:10.5px;font-weight:600;fill:var(--muted);letter-spacing:.08em}
svg.arch .conn{fill:none;stroke:var(--link);stroke-width:1.7;transition:opacity .15s}svg.arch .conn.v-emphasis{stroke:var(--accent);stroke-width:2.6}
svg.arch .conn.v-security{stroke:var(--t-security);stroke-dasharray:8 4}svg.arch .conn.v-async{stroke-dasharray:2 5;stroke-linecap:round}svg.arch .conn.v-dashed{stroke-dasharray:7 5}svg.arch .conn.unseen{stroke:var(--warn);stroke-dasharray:5 4}
svg.arch .conn.on,svg.arch .conn.hov{stroke:var(--accent);stroke-width:2.6;opacity:1}svg.arch .conn.on{stroke-dasharray:9 6;animation:archflow .9s linear infinite}
@keyframes archflow{to{stroke-dashoffset:-15}}
svg.arch .ahead{fill:var(--link)}svg.arch .ahead.on{fill:var(--accent)}
svg.arch .clab rect{fill:var(--panel);stroke:var(--line)}svg.arch .clab text{font-size:11px;fill:var(--muted)}svg.arch .clab.on text{fill:var(--accent);font-weight:600}svg.arch .clab.on rect{stroke:var(--accent)}
svg.arch .ghost{fill:none;stroke:var(--warn);stroke-width:1.4;stroke-dasharray:2 5;stroke-linecap:round}
svg.arch .comp{cursor:pointer;transition:opacity .15s}svg.arch .cbox{fill:color-mix(in srgb,var(--c) 7%,var(--panel));stroke:color-mix(in srgb,var(--c) 45%,var(--line));stroke-width:1.3}
svg.arch .cico{fill:color-mix(in srgb,var(--c) 16%,var(--panel))}svg.arch .cglyph{fill:none;stroke:var(--c);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
svg.arch .clabel{font-size:13px;font-weight:600;fill:var(--ink)}svg.arch .comp .sub{font:11px ui-sans-serif,system-ui,sans-serif;fill:var(--muted)}
svg.arch .ctag rect{fill:var(--panel);stroke:color-mix(in srgb,var(--c) 55%,var(--line))}svg.arch .ctag text{font-size:10px;fill:var(--c);font-weight:600}
svg.arch .comp:hover .cbox,svg.arch .comp.sel .cbox,svg.arch [tabindex]:focus-visible .cbox{stroke:var(--c);stroke-width:2.4}svg.arch .comp.sel .cbox{fill:color-mix(in srgb,var(--c) 14%,var(--panel))}
svg.arch .dim{opacity:.22}svg.arch.hover .comp:not(.hov){opacity:.35}svg.arch.hover .conn:not(.hov),svg.arch.hover .clab{opacity:.25}
@media (prefers-reduced-motion:reduce){svg.arch .conn.on{animation:none}svg.arch .conn,svg.arch .comp{transition:none}}
svg.arch .comp.d-prop .cbox{fill:color-mix(in srgb,var(--ok) 5%,var(--panel));stroke:var(--ok);stroke-width:1.9;stroke-dasharray:7 4}svg.arch .comp.d-prop .clabel{fill:var(--ok)}svg.arch .comp.d-built .cbox{stroke:var(--ok);stroke-width:2.6}svg.arch .comp.d-diff .cbox{stroke:var(--warn);stroke-width:2.4}
svg.arch .comp.d-pend .cbox,svg.arch .comp.d-rm .cbox{stroke:var(--warn);stroke-width:1.9;stroke-dasharray:7 4}svg.arch .comp.d-rm .clabel{fill:var(--warn)}svg.arch .comp.d-unpl .cbox{stroke:var(--t-worker);stroke-width:2.4}svg.arch .comp.gone{opacity:.8}svg.arch .comp.gone .cbox{stroke-dasharray:6 4}
svg.arch .comp.ch-add .cbox{stroke:var(--ok);stroke-width:2.4}svg.arch .comp.ch-mod .cbox{stroke:var(--warn);stroke-width:2.2}svg.arch .comp.ch-del{opacity:.8}svg.arch .comp.ch-del .cbox{stroke:var(--err);stroke-width:1.8;stroke-dasharray:6 4}svg.arch .comp.ch-del .clabel{fill:var(--err)}
svg.arch .strike{stroke:var(--err);stroke-width:1.5}svg.arch .comp.d-rm .strike{stroke:var(--warn);stroke-dasharray:4 3}svg.arch .comp.d-built .strike{stroke:var(--ok)}svg.arch .comp.d-unpl .strike{stroke:var(--t-worker)}
svg.arch .conn.d-prop{stroke:var(--ok);stroke-width:2.2;stroke-dasharray:7 5}svg.arch .conn.d-built{stroke:var(--ok);stroke-width:2.4}svg.arch .conn.d-diff{stroke:var(--warn);stroke-width:2.4}svg.arch .conn.d-pend,svg.arch .conn.d-rm{stroke:var(--warn);stroke-width:2;stroke-dasharray:5 4}svg.arch .conn.d-unpl{stroke:var(--t-worker);stroke-width:2.4}svg.arch .conn.gone{stroke-dasharray:5 4;opacity:.8}
svg.arch .conn.ch-add{stroke:var(--ok);stroke-width:2.4}svg.arch .conn.ch-mod{stroke:var(--warn);stroke-width:2.4}svg.arch .conn.ch-del{stroke:var(--err);stroke-width:1.8;stroke-dasharray:5 4}
svg.arch .newlink{fill:none;stroke-width:2.2;stroke-dasharray:2 5;stroke-linecap:round}svg.arch .newlink.d-unpl{stroke:var(--t-worker)}svg.arch .newlink.ch-add{stroke:var(--ok)}
svg.arch .bound.d-prop rect{stroke:var(--ok);stroke-width:1.8}svg.arch .bound.d-built rect{stroke:var(--ok);stroke-width:2.2}svg.arch .bound.d-diff rect{stroke:var(--warn);stroke-width:2}svg.arch .bound.d-pend rect,svg.arch .bound.d-rm rect{stroke:var(--warn);stroke-width:1.8}svg.arch .bound.d-unpl rect{stroke:var(--t-worker);stroke-width:2}
svg.arch .bound.ch-add rect{stroke:var(--ok);stroke-width:2}svg.arch .bound.ch-mod rect{stroke:var(--warn);stroke-width:2}svg.arch .bound.ch-del rect{stroke:var(--err);stroke-width:1.6}
svg.arch .stalemk circle{fill:var(--warn)}svg.arch .stalemk text{font:700 10px ui-sans-serif,system-ui,sans-serif;fill:var(--panel)}.chsw.newl{height:0;border-radius:0;border-top:2px dotted var(--ok)}
.dstores{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:14px}
.dstore{font:inherit;color:inherit;text-align:left;cursor:pointer;background:var(--panel);border:1px solid var(--line);border-left:4px solid color-mix(in srgb,var(--t-database) 55%,var(--line));border-radius:12px;padding:9px 12px;display:flex;flex-direction:column;gap:3px}
.dstore:hover{border-color:color-mix(in srgb,var(--t-database) 55%,var(--line))}.dstore b{font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.dstore span{color:var(--muted);font-size:12px}
.dstore[aria-pressed=true]{border-color:var(--t-database);background:color-mix(in srgb,var(--t-database) 7%,var(--panel));box-shadow:0 0 0 1px var(--t-database) inset}
.banner ul.links{margin:4px 0}.banner li .pill{margin:0 6px}.err{color:var(--err)}ul.decls{margin:8px 0 2px}ul.decls .pill{margin:0}
.mkl{display:inline-block;font:700 9.5px ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;padding:1px 4px;border-radius:4px;margin-right:5px;vertical-align:1px}
.mkl.pk{color:var(--accent);background:var(--accent-soft)}.mkl.fk{color:var(--t-frontend);background:color-mix(in srgb,var(--t-frontend) 12%,var(--panel))}
.kcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;margin:12px 0}
.kcard{background:var(--panel);border:1px solid color-mix(in srgb,var(--t-database) 40%,var(--line));border-radius:12px;padding:10px 12px;min-width:0}
.khead{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.khead .pill{margin:0}.kname{font-size:14px;overflow-wrap:anywhere}.kas{font-size:12px;margin-top:3px;overflow-wrap:anywhere}
.ksub{font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 3px}.ksub.warn{color:var(--warn)}
ul.krows{list-style:none;margin:0;padding:0}.krow{padding:3px 6px;border-radius:6px;font-size:13px;overflow-wrap:anywhere}.krow:hover{background:var(--hover)}.krow .pill{margin:0 0 0 6px}
ul.kattrs{display:flex;flex-wrap:wrap;gap:2px 10px}ul.kattrs .krow{padding:1px 4px}.unk{text-decoration:underline dashed var(--warn);text-underline-offset:3px}.pill.unk{color:var(--warn);text-decoration:none}
.mkl.k-pk{color:var(--accent);background:var(--accent-soft)}.mkl.k-sk{color:var(--t-backend);background:color-mix(in srgb,var(--t-backend) 12%,var(--panel))}.mkl.k-ttl{color:var(--t-messagebus);background:color-mix(in srgb,var(--t-messagebus) 12%,var(--panel))}
.mkl.k-gsi,.mkl.k-lsi,.mkl.k-idx{color:var(--t-database);background:color-mix(in srgb,var(--t-database) 12%,var(--panel))}.mkl.k-a{color:var(--muted);background:var(--hover)}
.mkl.k-i{color:var(--t-backend);background:color-mix(in srgb,var(--t-backend) 10%,var(--panel))}ul.kitem .krow.d1{padding-left:20px}ul.kitem .krow.d2{padding-left:34px}ul.kitem .krow.d3{padding-left:48px}ul.kitem .krow.d4,ul.kitem .krow.d5,ul.kitem .krow.d6{padding-left:62px}
.krow .kacc{margin:1px 0 2px 30px;font-size:12px}.krow .kacc .pill{margin:0 4px 0 0}.kfn{overflow-wrap:anywhere}.mkl.k-r{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,var(--panel))}.mkl.k-w{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,var(--panel))}ul.kaccess .krow.test{opacity:.8}
.kbind{border:1px solid var(--border);border-radius:8px;padding:6px 8px;margin:4px 0}.kbind.dash{border-style:dashed}.kbind .srcline{margin:2px 0 0}.pill.c-declared,.pill.c-convention{color:var(--ok);border-color:currentColor}.pill.c-name-match,.pill.c-ambiguous{color:var(--warn);border-color:currentColor;border-style:dashed}
.kcard.ch-add,.kcard.dl-built{border:2px solid var(--ok)}.kcard.ch-del{border:2px dashed var(--err);opacity:.85}.kcard.ch-mod,.kcard.dl-diff{border:2px solid var(--warn)}
.kcard.dl-prop{border:2px dashed var(--ok)}.kcard.dl-pend,.kcard.dl-rm{border:2px dashed var(--warn)}.kcard.dl-unpl{border:2px solid var(--t-worker)}.kcard.gone{opacity:.85}
.krow.ch-add,.krow.dl-built{box-shadow:inset 3px 0 0 var(--ok);background:color-mix(in srgb,var(--ok) 9%,transparent)}.krow.ch-del{box-shadow:inset 3px 0 0 var(--err);background:color-mix(in srgb,var(--err) 7%,transparent)}
.krow.ch-mod,.krow.dl-diff{box-shadow:inset 3px 0 0 var(--warn);background:color-mix(in srgb,var(--warn) 9%,transparent)}.krow.dl-prop{outline:1px dashed var(--ok);background:color-mix(in srgb,var(--ok) 6%,transparent)}
.krow.dl-pend,.krow.dl-rm{outline:1px dashed var(--warn)}.krow.dl-unpl{box-shadow:inset 3px 0 0 var(--t-worker);background:color-mix(in srgb,var(--t-worker) 9%,transparent)}
.dlegend>span{display:inline-flex;align-items:center;gap:4px}.dia{display:inline-block;width:8px;height:8px;transform:rotate(45deg);border:1.5px solid var(--muted);margin:0 3px}.dia.nn{background:var(--muted)}
ul.dlist li{padding:5px 0;border-bottom:1px solid var(--line)}ul.dlist li:last-child{border-bottom:0}.srcline{font-size:12px;color:var(--muted);margin-top:2px}.srcline .pill{margin:0 4px 0 0}
svg.erd text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
svg.erd .tbl{cursor:pointer;transition:opacity .15s}svg.erd .tframe{fill:var(--panel);stroke:color-mix(in srgb,var(--t-database) 40%,var(--line));stroke-width:1.3}
svg.erd .thead{fill:color-mix(in srgb,var(--t-database) 10%,var(--panel))}svg.erd .tsep{stroke:color-mix(in srgb,var(--t-database) 22%,var(--line))}
svg.erd .tglyph{fill:none;stroke:var(--t-database);stroke-width:1.3;stroke-linejoin:round}
svg.erd .tview .tframe{stroke-dasharray:6 4}svg.erd .tpill rect{fill:var(--panel);stroke:color-mix(in srgb,var(--t-cloud) 55%,var(--line))}svg.erd .tpill text{font:600 10px ui-sans-serif,system-ui,sans-serif;fill:var(--t-cloud)}
svg.erd .tname{font:600 13px ui-sans-serif,system-ui,-apple-system,sans-serif;fill:var(--ink)}svg.erd .tcount{font-size:10.5px;fill:var(--muted)}
svg.erd .cname{font-size:12px;fill:var(--ink)}svg.erd .cname.key{font-weight:600}svg.erd .ctype{font-size:11px;fill:var(--muted)}
svg.erd .mk{font:700 9px ui-sans-serif,system-ui,sans-serif;letter-spacing:.03em}svg.erd .mk.mpk{fill:var(--accent)}svg.erd .mk.mfk{fill:var(--t-frontend)}
svg.erd .nn{fill:var(--muted);stroke:var(--muted);stroke-width:1}svg.erd .nul{fill:var(--panel);stroke:var(--muted);stroke-width:1.2}
svg.erd .rowbg{fill:transparent}svg.erd .row:hover .rowbg{fill:var(--hover)}svg.erd .row.hit .rowbg{fill:var(--accent-soft)}svg.erd .row.hit .cname{fill:var(--accent);font-weight:600}
svg.erd .xrow{font-size:10.5px;fill:var(--muted)}
svg.erd .cfbg{fill:color-mix(in srgb,var(--warn) 12%,var(--panel));stroke:color-mix(in srgb,var(--warn) 50%,transparent)}svg.erd .cft{font-size:10.5px;font-weight:600;fill:var(--warn)}
svg.erd .fk{fill:none;stroke:var(--link);stroke-width:1.5;transition:opacity .15s}svg.erd .mkr{fill:none;stroke:var(--link);stroke-width:1.4;stroke-linecap:round}
svg.erd .fk.on{stroke:var(--accent);stroke-width:2.3;stroke-dasharray:9 6;animation:archflow .9s linear infinite}svg.erd .mkr.on{stroke:var(--accent);stroke-width:1.8}
svg.erd .tbl:hover .tframe,svg.erd [tabindex]:focus-visible .tframe{stroke:var(--t-database);stroke-width:2.2}
svg.erd .tbl.sel .tframe{stroke:var(--accent);stroke-width:2.4}svg.erd .tbl.sel .thead{fill:var(--accent-soft)}svg.erd .tbl.on .tframe{stroke:var(--accent);stroke-width:1.6}
svg.erd .tbl.hit .tframe{stroke:var(--accent);stroke-width:2}svg.erd .dim{opacity:.22}svg.erd.q .tbl:not(.hit){opacity:.3}svg.erd.q .fk{opacity:.3}
@media (prefers-reduced-motion:reduce){svg.erd .fk.on{animation:none}svg.erd .tbl,svg.erd .fk{transition:none}}
svg.erd .tbl.add .tframe{stroke:var(--ok);stroke-width:2.2}svg.erd .tbl.add .thead{fill:color-mix(in srgb,var(--ok) 12%,var(--panel))}svg.erd .tbl.mod .tframe{stroke:var(--warn);stroke-width:1.8}
svg.erd .tbl.del{opacity:.8}svg.erd .tbl.del .tframe{fill:color-mix(in srgb,var(--err) 4%,var(--panel));stroke:var(--err);stroke-width:1.6;stroke-dasharray:6 4}svg.erd .tbl.del .thead{fill:color-mix(in srgb,var(--err) 9%,var(--panel))}svg.erd .tbl.del .tname,svg.erd .tbl.del .tglyph{fill:var(--err);stroke:var(--err)}svg.erd .tbl.del .tglyph{fill:none}
svg.erd .row.add .rowbg{fill:color-mix(in srgb,var(--ok) 13%,transparent)}svg.erd .row.del .rowbg{fill:color-mix(in srgb,var(--err) 10%,transparent)}svg.erd .row.mod .rowbg{fill:color-mix(in srgb,var(--warn) 13%,transparent)}
svg.erd .row.del .cname,svg.erd .row.del .ctype,svg.erd .xr.del .xrow{fill:var(--err)}svg.erd .xr.add .xrow{fill:var(--ok)}svg.erd .xr.mod .xrow{fill:var(--warn)}
svg.erd .chbar.add{fill:var(--ok)}svg.erd .chbar.del{fill:var(--err)}svg.erd .chbar.mod{fill:var(--warn)}svg.erd .strike{stroke:var(--err);stroke-width:1.4}
svg.erd .chgbg{fill:color-mix(in srgb,var(--warn) 9%,var(--panel));stroke:color-mix(in srgb,var(--warn) 45%,transparent)}svg.erd .chgt{font-size:10.5px;fill:var(--warn)}
svg.erd .fk.add{stroke:var(--ok);stroke-width:2}svg.erd .fk.del{stroke:var(--err);stroke-dasharray:5 4}svg.erd .fk.mod{stroke:var(--warn);stroke-width:2}
svg.erd .ren{fill:none;stroke:var(--accent);stroke-width:1.7;stroke-dasharray:2 4;stroke-linecap:round}svg.erd .ren.tren{stroke-width:2}
.pill.add{color:var(--ok);border-color:currentColor}.pill.del{color:var(--err);border-color:currentColor}.pill.mod{color:var(--warn);border-color:currentColor}.struck{text-decoration:line-through;color:var(--err)}
.chlegend .chsw{display:inline-block;width:14px;height:10px;border-radius:3px;margin-right:2px}.chsw.add{background:var(--ok)}.chsw.del{background:var(--err)}.chsw.mod{background:var(--warn)}.chsw.ren{height:0;border-radius:0;border-top:2px dashed var(--accent)}.chlegend s{color:var(--err)}
.dstore .dchg{font:600 11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--warn)}ul.renames{margin:0 0 10px;font-size:13px;color:var(--accent)}
svg.erd .tbl.d-prop .tframe{fill:color-mix(in srgb,var(--ok) 4%,var(--panel));stroke:var(--ok);stroke-width:1.8;stroke-dasharray:7 4}svg.erd .tbl.d-prop .thead{fill:color-mix(in srgb,var(--ok) 9%,var(--panel))}svg.erd .tbl.d-prop .tname{fill:var(--ok)}
svg.erd .tbl.d-built .tframe{stroke:var(--ok);stroke-width:2.4}svg.erd .tbl.d-built .thead{fill:color-mix(in srgb,var(--ok) 12%,var(--panel))}svg.erd .tbl.d-diff .tframe{stroke:var(--warn);stroke-width:2.2}
svg.erd .tbl.d-pend .tframe,svg.erd .tbl.d-rm .tframe{stroke:var(--warn);stroke-width:1.8;stroke-dasharray:7 4}svg.erd .tbl.d-rm .tname{fill:var(--warn)}
svg.erd .tbl.d-unpl .tframe{stroke:var(--t-worker);stroke-width:2.2}svg.erd .tbl.d-unpl .thead{fill:color-mix(in srgb,var(--t-worker) 10%,var(--panel))}svg.erd .tbl.gone{opacity:.8}svg.erd .tbl.gone .tframe{stroke-dasharray:6 4}
svg.erd .row.d-prop .rowbg{fill:color-mix(in srgb,var(--ok) 9%,transparent);stroke:var(--ok);stroke-dasharray:4 3}svg.erd .row.d-built .rowbg{fill:color-mix(in srgb,var(--ok) 14%,transparent)}
svg.erd .row.d-diff .rowbg{fill:color-mix(in srgb,var(--warn) 14%,transparent)}svg.erd .row.d-pend .rowbg,svg.erd .row.d-rm .rowbg{fill:color-mix(in srgb,var(--warn) 7%,transparent);stroke:var(--warn);stroke-dasharray:4 3}
svg.erd .row.d-unpl .rowbg{fill:color-mix(in srgb,var(--t-worker) 12%,transparent)}svg.erd .row.d-prop .cname,svg.erd .xr.d-prop .xrow{fill:var(--ok)}svg.erd .row.d-rm .cname,svg.erd .xr.d-rm .xrow{fill:var(--warn)}svg.erd .row.d-unpl .cname,svg.erd .xr.d-unpl .xrow{fill:var(--t-worker)}
svg.erd .chbar.d-prop,svg.erd .chbar.d-built{fill:var(--ok)}svg.erd .chbar.d-diff,svg.erd .chbar.d-pend,svg.erd .chbar.d-rm{fill:var(--warn)}svg.erd .chbar.d-unpl{fill:var(--t-worker)}
svg.erd .strike.d-rm{stroke:var(--warn);stroke-dasharray:4 3}svg.erd .strike.d-built{stroke:var(--ok)}svg.erd .strike.d-unpl{stroke:var(--t-worker)}
svg.erd .chg.d-unpl .chgbg{fill:color-mix(in srgb,var(--t-worker) 9%,var(--panel));stroke:color-mix(in srgb,var(--t-worker) 45%,transparent)}svg.erd .chg.d-unpl .chgt{fill:var(--t-worker)}svg.erd .chg.d-pend .chgbg{stroke-dasharray:4 3}
svg.erd .fk.d-prop{stroke:var(--ok);stroke-width:2;stroke-dasharray:6 4}svg.erd .fk.d-built{stroke:var(--ok);stroke-width:2}svg.erd .fk.d-diff{stroke:var(--warn);stroke-width:2}svg.erd .fk.d-rm,svg.erd .fk.d-pend{stroke:var(--warn);stroke-dasharray:5 4}svg.erd .fk.d-unpl{stroke:var(--t-worker);stroke-width:2}
svg.erd .stalemk circle{fill:var(--warn)}svg.erd .stalemk text{font:700 10px ui-sans-serif,system-ui,sans-serif;fill:var(--panel)}
.pill.d-prop,.pill.dl-pending{color:var(--ok);border-color:currentColor;border-style:dashed}.pill.d-built,.pill.dl-built{color:var(--ok);border-color:currentColor}.pill.d-diff,.pill.dl-diff{color:var(--warn);border-color:currentColor}
.pill.d-rm,.pill.d-pend{color:var(--warn);border-color:currentColor;border-style:dashed}.pill.d-unpl{color:var(--t-worker);border-color:currentColor}.pill.dl-stale{color:var(--on-accent);background:var(--warn);border-color:var(--warn)}
.chsw.d-prop{background:none;border:2px dashed var(--ok)}.chsw.d-built{background:var(--ok)}.chsw.d-diff{background:var(--warn)}.chsw.d-pend,.chsw.d-rm{background:none;border:2px dashed var(--warn)}.chsw.d-unpl{background:var(--t-worker)}.chsw.dl-stale{border-radius:50%;width:11px;height:11px;background:var(--warn)}
ul.dlist li.dl-built,ul.dlist li.d-built{box-shadow:inset 3px 0 0 var(--ok);padding-left:8px}ul.dlist li.dl-pending,ul.dlist li.dl-prop{box-shadow:inset 3px 0 0 color-mix(in srgb,var(--ok) 45%,transparent);padding-left:8px}ul.dlist li.dl-diff,ul.dlist li.dl-rm,ul.dlist li.dl-pend{box-shadow:inset 3px 0 0 var(--warn);padding-left:8px}ul.dlist li.dl-unpl{box-shadow:inset 3px 0 0 var(--t-worker);padding-left:8px}
.dlbtn{margin-left:10px;font-size:12px}.dlstatus{margin-left:8px;font-size:12px;color:var(--muted)}.dlstatus.err{color:var(--err)}.dlack{color:var(--warn)}.dlhead p{margin:.3em 0}details.dlchanges ul.dlist{padding-left:0;font-size:13px}
ul.dlist li.ch-add{box-shadow:inset 3px 0 0 var(--ok);padding-left:8px}ul.dlist li.ch-del{box-shadow:inset 3px 0 0 var(--err);padding-left:8px}ul.dlist li.ch-mod{box-shadow:inset 3px 0 0 var(--warn);padding-left:8px}ul.dlist li.ch-ren{color:var(--accent)}.chgline{color:var(--warn)}
.arch-cards{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));margin-top:14px}.acard{--c:var(--t-external)}.acard.c-cyan{--c:var(--t-cloud)}.acard.c-emerald{--c:var(--t-database)}.acard.c-violet{--c:var(--t-backend)}.acard.c-amber{--c:var(--t-messagebus)}.acard.c-rose{--c:var(--t-security)}.acard.c-orange{--c:var(--t-cli)}
.acard-title{font-weight:600;display:flex;gap:8px;align-items:center}.acard-title i{width:9px;height:9px;border-radius:50%;background:var(--c)}.acard ul{margin:6px 0 0;padding-left:18px;font-size:13px;color:var(--muted)}
.callout{border:1px solid color-mix(in srgb,var(--c,var(--accent)) 35%,var(--line));background:color-mix(in srgb,var(--c,var(--accent)) 7%,var(--panel));border-radius:10px;padding:8px 14px;margin:.8em 0}
.callout-title{font-weight:600;color:var(--c,var(--accent))}summary.callout-title{cursor:pointer;font-size:inherit}.callout p{margin:.4em 0}.banner{margin:0 0 12px}
.callout-warning,.callout-caution,.callout-attention{--c:var(--t-messagebus)}.callout-danger,.callout-error,.callout-bug,.callout-failure,.callout-fail,.callout-missing{--c:var(--t-security)}
.callout-tip,.callout-hint,.callout-success,.callout-check,.callout-done{--c:var(--t-database)}.callout-info,.callout-todo{--c:var(--t-frontend)}.callout-question,.callout-help,.callout-faq{--c:var(--t-cli)}.callout-example{--c:var(--t-worker)}.callout-quote,.callout-cite{--c:var(--t-external)}
.docs{display:grid;grid-template-columns:270px minmax(0,1fr) 230px;gap:18px;align-items:start}.docs.nodoc{grid-template-columns:270px minmax(0,1fr)}nav.explorer{display:block}
.explorer,.rail{position:sticky;top:var(--hdr,76px);max-height:calc(100vh - var(--hdr,76px) - 20px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px}
.rail{font-size:13px}@media (max-width:1100px){.docs,.docs.nodoc{grid-template-columns:1fr}.explorer,.rail{position:static;max-height:42vh}}
.xhead{display:flex;align-items:baseline;gap:6px;margin:2px 4px 8px}.xhead .linkbtn{margin-left:auto;font-size:13px}
ul.tree{list-style:none;margin:0;padding:0 0 0 12px}.explorer>ul.tree,.explorer>div>ul.tree{padding-left:0}
.xdir,.xfile{display:block;width:100%;text-align:left;font:13px/1.35 ui-sans-serif,system-ui,sans-serif;color:var(--ink);background:none;border:0;border-radius:6px;padding:3px 6px;cursor:pointer;text-decoration:none;overflow-wrap:anywhere}
.xdir{color:var(--muted)}.xdir:hover,.xfile:hover{background:var(--hover)}.xfile.on{background:var(--accent-soft);color:var(--accent);font-weight:600}.caret{display:inline-block;width:14px}
.xrepo{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:12px 6px 4px}
.tree.flat .xfile{padding:5px 6px}.xpath{display:block;font-size:11px;font-weight:400}.snip{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400}.dirty{color:var(--accent)}
.note-pane{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:0 28px 28px;min-width:0}
.notehead{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 0 10px;margin-bottom:6px;border-bottom:1px solid var(--line);position:sticky;top:var(--hdr,76px);background:var(--panel);z-index:2}
.grow{flex:1}.crumbs{font-size:12.5px}
button.primary{font:inherit;background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);border-radius:8px;padding:6px 12px;cursor:pointer}button.primary:disabled{opacity:.4;cursor:default}.seg button:disabled{opacity:.45;cursor:not-allowed}
textarea.editor{display:block;width:100%;min-height:72vh;resize:vertical;font:13.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;tab-size:2;margin-top:10px}
.splitedit{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start}.splitedit .pv{max-height:76vh;overflow:auto;margin-top:10px}@media (max-width:900px){.splitedit{grid-template-columns:1fr}}
.md{font-size:15px;line-height:1.65;max-width:820px;overflow-wrap:break-word}
.md h1{font-size:1.75em;margin:.6em 0 .4em;line-height:1.25}.md h2{font-size:1.35em;margin:1.4em 0 .5em;padding-bottom:.25em;border-bottom:1px solid var(--line);line-height:1.3}.md h3{font-size:1.12em;margin:1.2em 0 .4em}.md h4,.md h5,.md h6{font-size:1em;margin:1em 0 .3em}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{scroll-margin-top:calc(var(--hdr,76px) + 64px);border-radius:6px;transition:background .4s}.md .flash{background:var(--accent-soft)}
.md p,.md ul,.md ol,.md pre,.md blockquote,.md .table,.md details{margin:.65em 0}.md li>ul,.md li>ol{margin:.2em 0}
.md code{font:.86em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--hover);border-radius:5px;padding:.1em .35em}
.md pre{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow:auto}.md pre code{background:none;padding:0;font-size:12.5px;line-height:1.55}
.md blockquote{border-left:3px solid var(--line);margin-left:0;padding:.05em 1em;color:var(--muted)}
.md .table{overflow-x:auto}.md table{width:auto;min-width:50%;margin:0;border-radius:8px;font-size:14px}.md th,.md td{padding:6px 10px}
.md hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}.md li.task{list-style:none}.md li.task input{margin:0 .45em 0 -1.35em}
.md mark{background:color-mix(in srgb,var(--t-messagebus) 30%,transparent);color:inherit;border-radius:3px;padding:0 .15em}
.md .tag{color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:.05em .5em;font-size:.86em}
.md a{color:var(--accent);text-decoration:none}.md a:hover{text-decoration:underline}.md a.missing{opacity:.65;text-decoration:underline dotted}.md a.external:not(.img)::after{content:"\\2197";font-size:.72em;margin-left:2px;opacity:.7}
.md .unresolved{border-bottom:1px dotted var(--muted)}.md .img{color:var(--muted);font-style:italic}.md .img::before{content:"\\1F5BC  ";font-style:normal}.md a.code-link code{color:var(--accent)}
.md summary{cursor:pointer;color:var(--muted)}
table.props{width:auto;margin:10px 0 14px;font-size:13px;border-radius:8px}table.props th{width:1%;white-space:nowrap}
.rail h4{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:16px 4px 6px}.rail>:first-child h4,.rail>h4:first-child{margin-top:4px}
ul.outline{list-style:none;margin:0;padding:0}ul.outline li{padding:2px 4px}ul.outline .linkbtn{color:var(--ink);text-align:left;font-size:13px}.rail .snip{white-space:normal}
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
  const nav = stageClient() // drag and keys on the stages: the file map, the Architecture and Data tabs (stage-view.mjs)

  // ── the stage: a diagram with its controls inside it, and full size ──
  // Full size is a page state, not one element's fullscreen: every click re-renders the page, and
  // the class comes back each time. The browser's own fullscreen is asked of <html>, which a
  // re-render keeps; leaving it (Esc) leaves full size, and so does a view that has no such stage.
  let staged = null // the stage in full size that the view being built drew
  function stage(which, label, body, controls, side) {
    const on = st.full === which
    if (on) staged = which
    return h('div', { class: `stage${on ? ' full' : ''}`, 'data-stage': which },
      h('div', { class: 'stagebody' }, body,
        h('div', { class: 'stagectl', role: 'toolbar', 'aria-label': `${label} controls` }, controls,
          h('div', { class: 'seg' }, h('button', { 'data-ctl': `${which}-full`, 'aria-pressed': String(on), title: on ? 'Leave full size (Esc)' : 'Full size: fill the window',
            'aria-label': on ? 'Leave full size' : 'Full size', onclick: () => setFull(on ? null : which) }, on ? '✕' : '⛶')))),
      on && side ? h('aside', { class: 'stageside' }, side) : null)
  }
  function screen(want) {
    try {
      const de = document.documentElement
      if (want && de.requestFullscreen && !document.fullscreenElement) de.requestFullscreen().catch(() => {})
      if (!want && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {})
    } catch {}
  }
  function setFull(which) { st.full = which; screen(!!which); render() }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.full) setFull(null) })
  if (document.addEventListener) document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && st.full) setFull(null) })

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
  for (const [a, b, n] of S.links) if (modules[a] && modules[b]) { modules[a].uses.set(b, n); modules[b].usedBy.set(a, n) }
  const loc = (n) => `${n.file ? n.file.shown : '?'}:${n.line}`
  const short = (p) => p.split('/').slice(-2).join('/') // parent/file: never a bare index.ts
  const perRepo = new Map(D.repos.map((r) => [r.name, { files: 0, tests: 0, symbols: 0, modules: 0 }]))
  for (const f of files.values()) if (perRepo.has(f.repo)) { perRepo.get(f.repo).files++; if (f.test) perRepo.get(f.repo).tests++ }
  for (const n of nodes.values()) if (n.file && perRepo.has(n.file.repo)) perRepo.get(n.file.repo).symbols++
  for (const m of modules) if (perRepo.has(m.repo)) perRepo.get(m.repo).modules++

  // ── state ──
  const TABS = [['overview', 'Overview'], ['architecture', 'Architecture'], ['data', 'Data'], ['map', 'Map'], ['files', 'Files'], ['symbols', 'Symbols'], ['hotspots', 'Hotspots'], ['docs', 'Docs']]
  const st = { ...INITIAL, sel: null, docOpen: new Set() }
  let ARCH = null, DATA = null, DOCS = null // the Architecture, Data and Docs tabs (arch-view.mjs, data-view.mjs, docs-view.mjs), made once the shell exists
  const inRepo = (f) => !st.repo || (f && f.repo === st.repo)
  const showFile = (f) => !!f && inRepo(f) && (st.tests || !f.test)
  const showSym = (n) => !!n.file && showFile(n.file) && (st.tests || !n.test)
  const resolvedOf = (m) => [...m].filter(([g, v]) => showFile(g) && v[1] > 0)
  const openModule = (i) => { if (!modules[i]) return; if (st.repo && modules[i].repo !== st.repo) st.repo = ''; st.tab = 'map'; st.mapMode = 'files'; st.module = i }

  // Plain anchors only: #overview, #map, #sym-12, #file-3, #mod-4, #arch-0, #data-1, #doc-7.
  function readHash() {
    const p = parseHash(location.hash, TABS.map(([id]) => id))
    if (!p) return
    if (p.kind === 'sym' && nodes.has(p.id)) { st.sel = { sym: nodes.get(p.id) }; st.tab = 'symbols' }
    else if (p.kind === 'file' && files.has(p.id)) { st.sel = { file: files.get(p.id) }; st.tab = 'files' }
    else if (p.kind === 'mod') openModule(p.id)
    else if (p.kind === 'arch' && (D.arch || [])[p.id]) { if (st.arch !== p.id) { st.archSel = null; st.archTrace = null } st.arch = p.id; st.tab = 'architecture' }
    else if (p.kind === 'data' && DATA && DATA.has(p.id)) { DATA.open(p.id); st.tab = 'data' }
    else if (p.kind === 'doc' && DOCS && DOCS.has(p.id)) { st.doc = p.id; st.tab = 'docs' }
    else if (p.kind === 'tab') { st.tab = p.tab; if (p.tab === 'map') { st.mapMode = 'modules'; st.module = null } if (p.tab === 'docs') st.doc = null }
  }
  function writeHash() {
    const want = st.tab === 'map' && st.mapMode === 'files' && st.module !== null ? `#mod-${st.module}`
      : st.tab === 'symbols' && st.sel && st.sel.sym ? `#sym-${st.sel.sym.id}`
        : st.tab === 'files' && st.sel && st.sel.file ? `#file-${st.sel.file.id}`
          : st.tab === 'architecture' && (D.arch || []).length ? `#arch-${Math.min(st.arch, D.arch.length - 1)}`
            : st.tab === 'data' && DATA.has(st.data) ? `#data-${st.data}`
              : st.tab === 'docs' && st.doc !== null ? `#doc-${st.doc}` : `#${st.tab}`
    if (location.hash !== want) { try { history.replaceState(null, '', want) } catch {} }
  }
  window.addEventListener('hashchange', () => { const before = st.tab === 'docs' ? st.doc : -1; readHash(); st.focusMain = true; render(); if (window.innerWidth <= 1100 || (st.tab === 'docs' && st.doc !== before && !st.docAnchor)) window.scrollTo({ top: 0 }) })

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
    const parts = [`<svg viewBox="-2 0 ${W + 4} ${H}" role="group" focusable="false" aria-label="${esc(focus.label)}: ${esc(leftTitle)} ${L.total}, ${esc(rightTitle)} ${R.total}">`,
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
    box.addEventListener('keydown', (e) => { if (activate(e) && e.target.closest('[data-sym],[data-file],[data-mod]')) { e.preventDefault(); open(e) } })
    return box
  }

  function symDetail(n) {
    const it = ([m, conf]) => ({ sym: m.id, label: m.name, sub: loc(m), repo: m.file && m.file.repo, conf, test: m.test })
    const list = (title, xs, label) => h('div', null, h('h2', null, `${title} (${xs.length}${xs.length > 200 ? ', the first 200 listed' : ''})`),
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
    const notes = DOCS ? DOCS.mentionsOf(f) : []
    return h('div', { class: 'detail' },
      h('h3', { class: 'mono' }, f.shown), h('div', { class: 'muted' }, `${f.repo} · ${f.lang}${f.test ? ' · test code' : ''} · ${plural(f.defs.length, 'definition')}${f.churn ? ` · in ${plural(f.churn, 'recent commit')}` : ''}`,
        mod ? h('span', null, ' · module ', h('a', { class: 'jump mono', href: `#mod-${mod.i}` }, mod.key)) : null),
      neighbourhood({ label: short(f.path), sub: f.shown, kind: `${plural(f.in.size, 'file')} use${f.in.size === 1 ? 's' : ''} it · it uses ${f.out.size}`, repo: f.repo }, 'Used by', [...f.in].map(it), 'Uses', [...f.out].map(it)),
      h('p', { class: 'note' }, 'Solid: at least one link resolved by syntax · dashed: unique-name matches only · dotted: ambiguous matches only. Arrows point from the file that uses to the file it uses.'),
      notes.length ? h('div', null, h('h2', null, `Mentioned in ${plural(notes.length, 'note')}`), h('ul', { class: 'links' }, notes.slice(0, 30).map((d) => h('li', null, h('a', { class: 'jump mono', href: `#doc-${d.i}` }, d.shown))))) : null,
      h('details', null, h('summary', null, `Every file it uses (${f.out.size}), every file using it (${f.in.size}), its ${plural(f.defs.length, 'definition')}`),
        h('div', { class: 'grid2' },
          h('div', null, h('h2', null, `Uses${f.out.size > 200 ? ' (the first 200 listed)' : ''}`), h('ul', { class: 'links' }, byCount(f.out).slice(0, 200).map(([g, v]) => h('li', null, jumpFile(g), h('span', { class: 'pill' }, v[0]))))),
          h('div', null, h('h2', null, `Used by${f.in.size > 200 ? ' (the first 200 listed)' : ''}`), h('ul', { class: 'links' }, byCount(f.in).slice(0, 200).map(([g, v]) => h('li', null, jumpFile(g), h('span', { class: 'pill' }, v[0])))))),
        h('h2', null, 'Definitions'),
        h('ul', { class: 'links' }, f.defs.slice().sort((a, b) => a.line - b.line).map((n) => h('li', null, jumpSym(n), h('span', { class: 'pill' }, n.kind))))))
  }
  // real links: the keyboard reaches them, and the anchor they set is the navigation (readHash)
  const jumpFile = (f) => h('a', { class: 'jump mono', href: `#file-${f.id}` }, f.shown)
  const jumpSym = (n) => h('span', null, h('a', { class: 'jump', href: `#sym-${n.id}` }, n.name), h('span', { class: 'muted mono' }, `  ${loc(n)}`))
  function select(sel) {
    if (!sel || (!sel.sym && !sel.file)) return
    st.sel = sel; st.tab = sel.file ? 'files' : 'symbols'; st.focusMain = true
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
        hits.map((n) => h('tr', { class: `click${sel === n ? ' on' : ''}`, onclick: () => select({ sym: n }) }, h('td', { class: 'name' }, h('a', { class: 'jump', href: `#sym-${n.id}` }, n.name)), h('td', null, n.kind), h('td', { class: 'mono' }, loc(n)),
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
        fs.slice(0, 500).map((f) => h('tr', { class: `click${sel === f ? ' on' : ''}`, onclick: () => select({ file: f }) }, h('td', { class: 'mono' }, jumpFile(f), f.test ? h('span', { class: 'pill' }, 'test') : null), h('td', null, f.lang), h('td', { class: 'n' }, f.defs.length), h('td', { class: 'n' }, resolvedOf(f.out).length), h('td', { class: 'n' }, resolvedOf(f.in).length)))),
      h('p', { class: 'note' }, `${fs.length > 500 ? `First 500 of ${fs.length} files; search to narrow. ` : ''}Uses and used by count files linked by syntax.${st.tests ? '' : ' Test code hidden.'}`))
    return withSide(list, sel ? fileDetail(sel) : null)
  }

  // ── hotspots ──
  function treemap(fs) {
    const top = fs.filter((f) => f.size > 0).sort((a, b) => b.size - a.size).slice(0, 400)
    if (!top.length) return h('p', { class: 'muted' }, 'No file sizes in the index.')
    const W = 1200, H = 520, maxC = Math.max(0, ...top.map((f) => f.churn))
    const rects = squarify(top.map((f) => f.size), 0, 0, W, H)
    const parts = [`<svg viewBox="0 0 ${W} ${H}" role="group" focusable="false" aria-label="The ${plural(top.length, 'largest file')}: area is size, colour is how many recent commits touched it">`]
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
    box.addEventListener('keydown', (e) => { if (activate(e) && e.target.closest('[data-sym],[data-file],[data-mod]')) { e.preventDefault(); open(e) } })
    const sw = (k, t) => h('span', null, h('i', { class: 'swatch', style: `background:var(--heat${k})` }), ' ', t)
    const legend = maxC
      ? h('div', { class: 'legend' }, h('span', { class: 'muted' }, 'Area: file size. Colour: commits touching it among the last 400, commits touching more than 25 indexed files left out (log scale):'), sw(0, 'none'),
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
      rows.map(([n, v]) => h('tr', { class: 'click', onclick: () => select({ sym: n }) }, h('td', { class: 'name' }, h('a', { class: 'jump', href: `#sym-${n.id}` }, n.name)), h('td', { class: 'mono' }, loc(n)), h('td', { class: 'n' }, v), h('td', { class: 'n muted' }, guessed(n[side]))))))
    const fileTable = (title, rows, col) => h('div', null, h('h2', null, title), h('table', null, h('tr', null, h('th', null, 'file'), h('th', { class: 'n' }, col)),
      rows.map(([f, v]) => h('tr', { class: 'click', onclick: () => select({ file: f }) }, h('td', { class: 'mono' }, jumpFile(f)), h('td', { class: 'n' }, v)))))
    const co = D.cochange.filter(([repo]) => !st.repo || repo === st.repo).slice(0, 25) // already strongest first
    return h('section', null,
      h('p', { class: 'note' }, `Ranked by links resolved by syntax; name guesses (unique-name, ambiguous) are counted apart.${st.tests ? '' : ' Test code hidden.'}`),
      h('h2', null, 'Size and churn'), treemap(fs),
      h('div', { class: 'grid2' }, symTable('Most called', top(ns, (n) => resolved(n.callers)), 'callers', 'callers'), symTable('Widest fan-out', top(ns, (n) => resolved(n.callees)), 'callees', 'callees')),
      h('div', { class: 'grid2' }, fileTable('Most used files', top(fs, (f) => resolvedOf(f.in).length), 'files using it'), fileTable('Files using the most', top(fs, (f) => resolvedOf(f.out).length), 'files it uses')),
      h('h2', null, 'Change together (git history)'),
      co.length ? h('table', null, h('tr', null, h('th', null, 'repo'), h('th', null, 'file'), h('th', null, 'file'), h('th', { class: 'n' }, 'commits')), co.map(([r, a, b, n]) => h('tr', null, h('td', null, r), h('td', { class: 'mono' }, a), h('td', { class: 'mono' }, b), h('td', { class: 'n' }, n))))
        : h('p', { class: 'muted' }, 'No files here changed together in two or more recent commits (or no git history is indexed).'))
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
    const parts = [`<svg viewBox="0 0 ${W} ${H}" role="group" focusable="false" aria-label="System map: ${plural(drawn, 'module')} of ${total} in ${plural(lanes.length, 'repository lane')}, linked by how many files use each other">`,
      '<defs><marker id="sm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L8,4L0,8z" class="arrow"/></marker></defs>']
    lanes.forEach((l, li) => {
      const x = left + li * (laneW + gapX)
      parts.push(`<rect class="lane" x="${x}" y="${top - 12}" width="${laneW}" height="${(l.shown.length + (l.rest ? 1 : 0)) * (boxH + rowGap) + 8}" rx="10" opacity=".6"/>`,
        `<rect x="${x}" y="${top - 12}" width="${laneW}" height="3" fill="${repoColor.get(l.repo)}"/>`,
        `<text class="head" x="${x}" y="${top - 20}">${esc(cut(l.repo.toUpperCase(), 22))} · ${l.files.toLocaleString()} FILE${l.files === 1 ? '' : 'S'}</text>`)
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
    const sz = st.sysZoom // null: fit the box's width (and its height, at full size)
    const box = h('div', { class: `svgbox sysbox${sz ? ' zoomed' : ''}`, id: 'sys-box' })
    box.innerHTML = parts.join('')
    const svg = box.firstChild
    if (sz) { svg.setAttribute('width', String(Math.round(W * sz))); svg.setAttribute('height', String(Math.round(H * sz))) }
    const fitScale = () => { const b = document.getElementById('sys-box'); return b && b.clientWidth ? fitOf(b.clientWidth, b.clientHeight, W, H, st.full === 'sys') : 1 }
    const setZ = (z) => { st.sysZoom = z; render() }
    const step = (f) => setZ(Math.min(8, Math.max(0.1, Math.round((sz || fitScale()) * f * 100) / 100)))
    const zoomSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zoom' },
      h('button', { 'data-ctl': 'sys-fit', 'aria-pressed': String(!sz), title: 'Fit the map to its box', onclick: () => setZ(null) }, 'Fit'),
      h('button', { 'data-ctl': 'sys-out', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => step(1 / 1.25) }, '−'),
      h('button', { 'data-ctl': 'sys-100', 'aria-pressed': String(sz === 1), title: 'Natural size (100%)', onclick: () => setZ(1) }, sz ? `${Math.round(sz * 100)}%` : '100%'),
      h('button', { 'data-ctl': 'sys-in', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => step(1.25) }, '+'))
    // fitted, the size reads what is drawn: measured right after this render puts the box in the
    // page (a promise, not a frame: a background tab paints no frames)
    if (!sz) Promise.resolve().then(() => { const b = document.querySelector('[data-ctl="sys-100"]'); if (b && document.getElementById('sys-box')) b.textContent = `${Math.round(fitScale() * 100)}%` })
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
    const open = (e) => { const g = e.target.closest('[data-mod]'); if (g) { openModule(Number(g.dataset.mod)); st.focusMain = true; render() } }
    svg.addEventListener('click', open)
    svg.addEventListener('keydown', (e) => { if (activate(e) && e.target.closest('[data-sym],[data-file],[data-mod]')) { e.preventDefault(); open(e) } })
    return h('section', null, h('div', { class: 'toolbar' }, seg, h('span', { class: 'muted' }, `showing ${drawn} of ${plural(total, 'module')} · ${plural(shownLinks.length, 'link')} between them`)), stage('sys', 'System map', box, zoomSeg),
      h('p', { class: 'note' }, `A module is a folder of production code; a folder holding more than 35% of its repository is split into its subfolders. Each lane draws its ${LANE_MAX} largest modules, in the order code flows: a module sits below the modules that use it. A line is a module using another, its width the number of file pairs linked by syntax. This map never shows test code or name guesses, whatever the toggles say. Arcs on the left go down a lane, arcs on the right go up it (a cycle). Hover a module for its links and counts, click it for its files.`))
  }

  // ── map: files (laid out once, drawn on a canvas) ──
  const M = D.map
  const mapFiles = M.files.map((id, i) => ({ f: files.get(id), x: M.pos[i][0], y: M.pos[i][1], deg: M.deg[i], r: 2.5 + Math.min(9, Math.sqrt(M.deg[i])), nb: new Map() }))
  for (const [a, b, , amb] of M.links) if (mapFiles[a] && mapFiles[b]) { mapFiles[a].nb.set(b, !!amb); mapFiles[b].nb.set(a, !!amb) }
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
    const core = mod ? new Set(mod.list.map((f) => f.id)) : null
    const onMap = core ? mapFiles.filter((m) => core.has(m.f.id)).length : 0
    const wrap = h('div', { id: 'map' }), canvas = h('canvas', nav.attrs('files', mod ? `File map of ${mod.key} and its neighbours` : 'File map')), tip = h('div', { id: 'tip' })
    wrap.append(canvas, tip)
    const legend = h('div', { class: 'legend' }, D.repos.filter((r) => !st.repo || r.name === st.repo).map((r) => h('span', null, h('i', { style: `background:${repoColor.get(r.name)}` }), r.name)))
    const head = h('div', { class: 'toolbar' }, seg, mod
      ? h('span', null, 'Files of ', h('b', { class: 'mono' }, mod.key), ` (${mod.repo}, ${onMap === 0 ? `none of its ${plural(mod.files, 'file')} is among the ${D.mapMax.toLocaleString()} most connected the map holds` : onMap < mod.files ? `${onMap} of its ${plural(mod.files, 'file')} on the map, the most connected; the map holds ${D.mapMax.toLocaleString()} at most` : plural(mod.files, 'file')}) and the files they link to by syntax · `, h('button', { class: 'linkbtn', 'data-ctl': 'all-files', onclick: () => { st.module = null; render() } }, 'all files'))
      : h('span', { class: 'muted' }, `${prod.toLocaleString()} of ${plural(st.repo ? M.totals[st.repo] || 0 : M.total, 'production file')}${tests ? `, and ${plural(tests, 'test file')} where room was left` : ''} · the ${D.mapMax.toLocaleString()} most connected at most`))
    const note = h('p', { class: 'note' }, `Grouped by directory · the biggest are named, hover for the rest · lines are imports and calls between files${st.guesses ? '' : ', ambiguous-only links hidden'} · drag to pan, scroll to zoom, click to open, double-click to reset · focused, the arrow keys pan (Shift: a page), + and − zoom, 0 fits`)
    // the buttons drive the canvas's own view, which drawMap holds: it fills `mz` once it has drawn
    const mz = {}
    const pct = h('button', { 'data-ctl': 'files-100', title: 'Zoom, as a share of the fitted view: click to fit again', onclick: () => mz.fit && mz.fit() }, '100%')
    const zoomSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Zoom' },
      h('button', { 'data-ctl': 'files-fit', title: 'Fit the selection to the map (0)', onclick: () => mz.fit && mz.fit() }, 'Fit'),
      h('button', { 'data-ctl': 'files-out', title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => mz.zoom && mz.zoom(1 / 1.25) }, '−'), pct,
      h('button', { 'data-ctl': 'files-in', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => mz.zoom && mz.zoom(1.25) }, '+'))
    mz.label = pct
    requestAnimationFrame(() => drawMap(canvas, tip, vis, core ? (m) => core.has(m.f.id) : vis, mz))
    return h('section', null, head, legend, stage('files', 'File map', wrap, zoomSeg), note)
  }
  let resizeTimer = null
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (st.full || (st.tab === 'map' && st.mapMode === 'files')) render() }, 150) })
  function drawMap(canvas, tip, vis, fitTo, mz = {}) {
    if (!canvas.isConnected) return
    if (canvas.clientWidth < 50 || canvas.clientHeight < 50) return requestAnimationFrame(() => drawMap(canvas, tip, vis, fitTo, mz)) // not laid out yet
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
    const selIdx = () => { const i = st.sel && st.sel.file ? mapFiles.findIndex((m) => m.f === st.sel.file) : -1; return i >= 0 && vis(mapFiles[i]) ? i : -1 }
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
    // zoom about a point (the pointer, or the centre for the buttons and keys); the % is relative to the fit
    const label = () => { if (mz.label) mz.label.textContent = `${Math.round((view.k / fitK) * 100)}%` }
    const zoomAt = (mx, my, k0) => {
      const k = Math.min(fitK * 30, Math.max(fitK * 0.5, k0))
      view.x = mx - ((mx - view.x) / view.k) * k; view.y = my - ((my - view.y) / view.k) * k; view.k = k
      label(); redraw()
    }
    mz.zoom = (f) => zoomAt(W / 2, H / 2, view.k * f)
    mz.fit = () => { Object.assign(view, fit()); label(); redraw() }
    // a drag anywhere or the arrow keys pan, the wheel, + and − zoom, 0 fits (stage-view.mjs). Attached
    // before the click below: the click that ends a pan never reaches it.
    const pan = nav.view(canvas, {
      at: () => [view.x, view.y],
      pan: ([x, y], dx, dy) => { view.x = x + dx; view.y = y + dy; redraw() },
      zoom: (d) => mz.zoom(d > 0 ? 1.25 : 1 / 1.25),
      fit: () => mz.fit(),
      wheel: (e) => { const b = canvas.getBoundingClientRect(); zoomAt(e.clientX - b.left, e.clientY - b.top, view.k * (e.deltaY < 0 ? 1.18 : 1 / 1.18)) },
    })
    canvas.addEventListener('mousemove', (e) => {
      if (pan.panning()) return
      const i = hit(e), b = canvas.getBoundingClientRect()
      if (i !== hover) { hover = i; redraw() }
      if (i >= 0) { const m = mapFiles[i]; tip.textContent = `${m.f.shown} · used by ${resolvedOf(m.f.in).length} · uses ${resolvedOf(m.f.out).length} (linked by syntax)`; tip.style.display = 'block'; tip.style.left = `${Math.min(e.clientX - b.left + 14, W - tip.offsetWidth - 8)}px`; tip.style.top = `${e.clientY - b.top + 14}px` } else tip.style.display = 'none'
    })
    canvas.addEventListener('mouseleave', () => { if (hover !== -1) { hover = -1; redraw() } tip.style.display = 'none' })
    canvas.addEventListener('click', (e) => { const i = hit(e); if (i >= 0) select({ file: mapFiles[i].f }) })
    canvas.addEventListener('dblclick', () => mz.fit())
  }

  // ── shell ──
  let search = null
  function header() {
    search = search || h('input', { type: 'search', 'data-ctl': 'search', oninput: (e) => { st.q = e.target.value; if (st.tab !== 'files' && st.tab !== 'symbols' && st.tab !== 'docs' && st.tab !== 'data') st.tab = 'symbols'; render(true) } })
    const what = st.tab === 'docs' ? 'Search notes…' : st.tab === 'data' ? 'Search tables or columns…' : 'Search files or symbols…'
    search.setAttribute('placeholder', what); search.setAttribute('aria-label', what.slice(0, -1))
    const repoSel = h('select', { 'data-ctl': 'repo', 'aria-label': 'Repository', onchange: (e) => { st.repo = e.target.value; st.sel = null; st.module = null; render() } }, h('option', { value: '' }, 'all repositories'), D.repos.map((r) => h('option', { value: r.name }, r.name)))
    repoSel.value = st.repo
    const tog = (key, label) => h('label', { class: 'tog' }, h('input', { type: 'checkbox', 'data-ctl': `tog-${key}`, checked: st[key] ? 'checked' : null, onchange: (e) => { st[key] = e.target.checked; render() } }), label)
    return h('header', null, h('h1', null, 'Code graph'),
      h('nav', null, TABS.map(([id, label]) => h('button', { 'data-ctl': `tab-${id}`, 'aria-pressed': String(st.tab === id), onclick: () => { st.tab = id; render() } }, label))),
      D.repos.length > 1 ? repoSel : null, search, tog('tests', 'Test code'), tog('guesses', 'Ambiguous links'),
      h('span', { class: 'muted' }, `generated ${D.generatedAt.slice(0, 16).replace('T', ' ')} UTC · a map, not the code: read it at the path:line`))
  }
  function render(keepFocus) {
    // the header is rebuilt: hand keyboard focus back to the control that had it, the caret where it was
    const ctl = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ctl : null
    const caret = search ? [search.selectionStart, search.selectionEnd] : null
    staged = null
    const view = { overview, architecture: ARCH.view, data: DATA.view, map: mapView, files: filesView, symbols, hotspots, docs: DOCS.view }[st.tab]()
    if (st.full && staged !== st.full) { st.full = null; screen(false) }
    const hd = header()
    document.body.replaceChildren(hd, h('main', null, view))
    document.documentElement.style.setProperty('--hdr', `${hd.offsetHeight + 12}px`)
    writeHash()
    if (keepFocus) { search.focus({ preventScroll: true }); if (caret && caret[0] !== null) search.setSelectionRange(caret[0], caret[1]) }
    else {
      const t = st.focusMain && (document.querySelector('main .detail h3') || document.querySelector('main [data-focus]') || document.querySelector('main .toolbar'))
      if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }) }
      else if (ctl) { const el = document.querySelector(`[data-ctl="${ctl}"]`); if (el) el.focus({ preventScroll: true }) } // never scroll the page: the control is where it was
    }
    st.focusMain = false
  }
  const ctx = { D, h, st, files, render, jumpFile, activate, plural, stage, nav }
  ARCH = archClient(ctx)
  DATA = dataClient(ctx)
  DOCS = docsClient(ctx)
  readHash()
  render()
}
