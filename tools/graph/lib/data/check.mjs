// grimoire graph · data · the refine file and its check (spec D8: the script extracts, an agent refines
// what no file declares, the script checks). A refine file is docs/architecture/<name>.data.json
// (graph.architectureDir moves the folder), beside the architecture diagrams, written by
// /grimoire:data-model after reading the code. Its claims, each citing the path:line that shows it:
//   bindings      an item type the script left ambiguous or unbound, bound to one key-value table
//   lineage       an entity of one store that mirrors an entity of another, field pair by field pair
//   relations     a relation no foreign key states (event_participants.event_id → events.id)
//   indexes       what an index is for
//   equivalences  declarations of one logical table no evidence ties (a local-dev CreateTable file's
//                 `Orders` and the production template `{env}-{project}-order`), each named as written:
//                 grouped by reconcile.mjs, so their differences are conflicts
//   stores        a store no extractor reads yet (a document collection, a search index), described
//                 entity by entity, a path:line per field
// Every claim is re-checked on each render, by graph_data and by `graph.mjs data check`: each citation's
// lines exist and name what the claim states (one of its names, letter case aside, not inside a longer
// identifier; a template by its longest literal part), and the claim agrees with the extracted model
// (its entities, fields, indexes and item types exist; an equivalence's declarations exist under the
// names or templates it states; no foreign key contradicts a relation, and no binding the code states
// at convention or above contradicts a binding; a described store is no store an extractor reads). A
// claim that fails is drift: reported with why, never drawn as fact. Refined facts are labelled
// refined, never extracted.
// Gaps: the datastores the code reaches through client imports (arch.mjs KNOWN's databases, and
// DynamoDB's clients) that no extracted store and no refined store covers: the map never pretends to be
// complete.
// Bounded: a file past MAX_BYTES or nested past MAX_DEPTH is not read; claims, citations, lists and
// strings are capped; a cited file past MAX_CITED is not read, a citation spans MAX_SPAN lines at most.
// Errors and drift say where (a claim's position, its line in the refine file, a cited path and line)
// and what the claim states, never what a cited file holds.
import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { KNOWN, importMatches, parseSource } from '../arch.mjs'
import { jsonLines, pathKey, deeperThan, jsonErrorAt, lineOfOffset } from './readers/json-lines.mjs'
import { KV_DIALECTS } from './model.mjs'
import { reconcile } from './reconcile.mjs'
import { bindingHow } from './binding.mjs'

export const SUFFIX = '.data.json'
export const MAX_BYTES = 1 << 20 // a refine file
export const MAX_DEPTH = 16
export const MAX_CLAIMS = 2000 // per file: bindings, lineage, relations, indexes, equivalences and stores together
export const MAX_LIST = 500 // a store's entities, an entity's fields, a lineage's field pairs, a relation's columns
export const MAX_SOURCES = 20 // a claim's citations
export const MAX_SIDES = 8 // an equivalence's declarations
export const MAX_NAME = 300 // a name, a citation
export const MAX_TEXT = 2000 // a why, a purpose, a note
export const MAX_CITED = 4 << 20 // a cited file
export const MAX_SPAN = 200 // lines a citation spans
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const CTRL = /[\u0000-\u001f\u007f\u2028\u2029]/
const CITE = /^(?:[^:\s]+:)?[^:\n]+:\d{1,7}(?:-\d{1,7})?$/
const ENTITY = /^[^:\s/]+:[^\n]*[^/\n]\/[^/\n][^\n]*$/
const ITEM = /^[^:\s]+:\S+$/
export const CLAIM_LISTS = ['bindings', 'lineage', 'relations', 'indexes', 'equivalences', 'stores']
const TOP = ['schema', 'title', 'summary', ...CLAIM_LISTS]

// ── the format ─────────────────────────────────────────────────────────────────────────────
// A refine file's problems, each { at: [path…], msg }: its position, never its text.
export function validateRefine(doc) {
  const errors = []
  const bad = (at, msg) => errors.push({ at, msg })
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o)
  // only the keys the format names (a `__proto__` or `constructor` key is none of them)
  const keys = (o, allowed, at) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) { bad(at, `a key that is not part of the format (allowed: ${allowed.join(', ')})`); return } }
  const str = (v, at, max = MAX_NAME, need = true) => {
    if (v === undefined) { if (need) bad(at, 'required'); return false }
    if (typeof v !== 'string' || !v.trim()) { bad(at, 'must be a non-empty string'); return false }
    if (v.length > max) { bad(at, `longer than ${max} characters`); return false }
    if (max <= MAX_NAME && CTRL.test(v)) { bad(at, 'holds a control character'); return false }
    return true
  }
  const list = (v, at, { min = 0, max = MAX_LIST, need = true } = {}) => {
    if (v === undefined) { if (need) bad(at, 'required'); return [] }
    if (!Array.isArray(v)) { bad(at, 'must be a list'); return [] }
    if (v.length < min) { bad(at, `at least ${min}`); return [] }
    if (v.length > max) { bad(at, `at most ${max}`); return [] }
    return v
  }
  const names = (v, at, opts) => list(v, at, opts).forEach((x, i) => str(x, [...at, i]))
  const cites = (v, at, need = true) => list(v, at, { min: need ? 1 : 0, max: MAX_SOURCES, need }).forEach((x, i) => cite(x, [...at, i]))
  const cite = (v, at) => { if (str(v, at) && !CITE.test(v)) bad(at, 'must cite repo:path:line or repo:path:start-end') }
  const entity = (v, at) => { if (str(v, at) && !ENTITY.test(v)) bad(at, 'must name an entity as repo:store/entity (as graph_data prints its id)') }
  const each = (name, fn) => list(doc[name], [name], { max: MAX_CLAIMS, need: false }).forEach((x, i) => { const at = [name, i]; if (!isObj(x)) bad(at, 'must be an object'); else fn(x, at) })

  if (!isObj(doc)) return [{ at: [], msg: 'the file is not a JSON object' }]
  keys(doc, TOP, [])
  if (doc.schema !== 1) bad(['schema'], 'must be 1')
  str(doc.title, ['title'], MAX_TEXT, false)
  str(doc.summary, ['summary'], MAX_TEXT, false)
  const n = CLAIM_LISTS.reduce((a, k) => a + (Array.isArray(doc[k]) ? doc[k].length : 0), 0)
  if (n > MAX_CLAIMS) { bad([], `${n} claims: at most ${MAX_CLAIMS} per file`); return errors }
  if (!n && !errors.length) bad([], `no claim: give at least one of ${CLAIM_LISTS.join(', ')}`)
  each('bindings', (x, at) => {
    keys(x, ['item', 'table', 'why', 'sources'], at)
    if (str(x.item, [...at, 'item']) && !ITEM.test(x.item)) bad([...at, 'item'], 'must name an item type as repo:Type (as graph_data prints its id)')
    str(x.table, [...at, 'table']); str(x.why, [...at, 'why'], MAX_TEXT); cites(x.sources, [...at, 'sources'])
  })
  each('lineage', (x, at) => {
    keys(x, ['from', 'to', 'fields', 'why', 'sources'], at)
    entity(x.from, [...at, 'from']); entity(x.to, [...at, 'to'])
    if (typeof x.from === 'string' && x.from === x.to) bad([...at, 'to'], 'names the same entity as from')
    list(x.fields, [...at, 'fields'], { need: false }).forEach((f, i) => { const fa = [...at, 'fields', i]; if (!isObj(f)) { bad(fa, 'must be an object { from, to }'); return } keys(f, ['from', 'to'], fa); str(f.from, [...fa, 'from']); str(f.to, [...fa, 'to']) })
    str(x.why, [...at, 'why'], MAX_TEXT); cites(x.sources, [...at, 'sources'])
  })
  each('relations', (x, at) => {
    keys(x, ['from', 'columns', 'to', 'toColumns', 'why', 'sources'], at)
    entity(x.from, [...at, 'from']); entity(x.to, [...at, 'to'])
    names(x.columns, [...at, 'columns'], { min: 1 }); names(x.toColumns, [...at, 'toColumns'], { min: 1 })
    if (Array.isArray(x.columns) && Array.isArray(x.toColumns) && x.columns.length !== x.toColumns.length) bad([...at, 'toColumns'], 'must name as many columns as columns')
    str(x.why, [...at, 'why'], MAX_TEXT); cites(x.sources, [...at, 'sources'])
  })
  each('indexes', (x, at) => {
    keys(x, ['entity', 'index', 'purpose', 'sources'], at)
    entity(x.entity, [...at, 'entity']); str(x.index, [...at, 'index']); str(x.purpose, [...at, 'purpose'], MAX_TEXT); cites(x.sources, [...at, 'sources'])
  })
  each('equivalences', (x, at) => {
    keys(x, ['tables', 'why', 'sources'], at)
    const seen = new Set()
    list(x.tables, [...at, 'tables'], { min: 2, max: MAX_SIDES }).forEach((s, i) => {
      const sa = [...at, 'tables', i]
      if (!isObj(s)) { bad(sa, 'must be an object { repo, name | template, store?, path? }'); return }
      keys(s, ['repo', 'store', 'name', 'template', 'path'], sa)
      str(s.repo, [...sa, 'repo']); str(s.store, [...sa, 'store'], MAX_NAME, false); str(s.path, [...sa, 'path'], MAX_NAME, false)
      if ((s.name === undefined) === (s.template === undefined)) { bad(sa, 'give one of name (an exact name) or template (a name template)'); return }
      if (s.name !== undefined && str(s.name, [...sa, 'name']) && /[{}]/.test(s.name)) bad([...sa, 'name'], 'an exact name holds no {…}: give it as template')
      if (s.template !== undefined && str(s.template, [...sa, 'template']) && !/\{[^{}]*\}/.test(s.template)) bad([...sa, 'template'], 'a template holds an unknown part {…}: give an exact name as name')
      const k = `${s.repo}\0${s.store || 'dynamodb'}\0${s.name ?? s.template}`
      if (seen.has(k)) bad(sa, 'names a declaration another side names')
      seen.add(k)
    })
    str(x.why, [...at, 'why'], MAX_TEXT); cites(x.sources, [...at, 'sources'], false)
  })
  const storeIds = new Set()
  each('stores', (x, at) => {
    keys(x, ['repo', 'id', 'kind', 'label', 'imports', 'why', 'entities'], at)
    str(x.repo, [...at, 'repo'])
    if (str(x.id, [...at, 'id']) && !ID.test(x.id)) bad([...at, 'id'], `must match ${ID} (lower case, digits, . _ -)`)
    if (storeIds.has(`${x.repo}:${x.id}`)) bad([...at, 'id'], 'another store of this file has this repo and id')
    storeIds.add(`${x.repo}:${x.id}`)
    str(x.kind, [...at, 'kind']); str(x.label, [...at, 'label'], MAX_NAME, false); str(x.why, [...at, 'why'], MAX_TEXT, false)
    names(x.imports, [...at, 'imports'], { need: false, max: MAX_SOURCES })
    const ents = new Set()
    list(x.entities, [...at, 'entities'], { min: 1 }).forEach((e, i) => {
      const ea = [...at, 'entities', i]
      if (!isObj(e)) { bad(ea, 'must be an object { name, source, fields }'); return }
      keys(e, ['name', 'kind', 'source', 'note', 'fields'], ea)
      if (str(e.name, [...ea, 'name']) && ents.has(e.name)) bad([...ea, 'name'], 'another entity of this store has this name')
      ents.add(e.name)
      str(e.kind, [...ea, 'kind'], MAX_NAME, false); cite(e.source, [...ea, 'source']); str(e.note, [...ea, 'note'], MAX_TEXT, false)
      const fields = new Set()
      list(e.fields, [...ea, 'fields']).forEach((f, j) => {
        const fa = [...ea, 'fields', j]
        if (!isObj(f)) { bad(fa, 'must be an object { name, type?, source }'); return }
        keys(f, ['name', 'type', 'source', 'note'], fa)
        if (str(f.name, [...fa, 'name']) && fields.has(f.name)) bad([...fa, 'name'], 'another field of this entity has this name')
        fields.add(f.name)
        str(f.type, [...fa, 'type'], MAX_NAME, false); cite(f.source, [...fa, 'source']); str(f.note, [...fa, 'note'], MAX_TEXT, false)
      })
    })
  })
  return errors
}

// A position as shown: lineage[2].fields[0].from, and its line in the file when known.
export const atText = (at) => at.reduce((s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${k}` : k), '') || '(the file)'
function lineAt(lines, at) {
  for (let n = at.length; n > 0; n--) { const l = lines.get(pathKey(...at.slice(0, n))); if (l) return l }
  return null
}
const where = (at, lines) => { const l = lines ? lineAt(lines, at) : null; return `${atText(at)}${l ? ` (line ${l})` : ''}` }

// A refine file's text read: { doc (null when it does not validate), errors: [text], lines }. JSON
// nested past MAX_DEPTH is refused before it is parsed; one that does not parse says at which line
// only (never the engine's message: it quotes the text).
export function parseRefine(text) {
  if (text.length > MAX_BYTES) return { doc: null, errors: [`the file is larger than ${MAX_BYTES >> 10} KB: not read`], lines: new Map() }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const deep = deeperThan(text, MAX_DEPTH)
  if (deep >= 0) return { doc: null, errors: [`the JSON nests deeper than ${MAX_DEPTH} levels at line ${lineOfOffset(text, deep)}: not read`], lines: new Map() }
  let doc
  try { doc = JSON.parse(text) } catch {
    const at = jsonErrorAt(text)
    return { doc: null, errors: [at < 0 ? 'not valid JSON' : `not valid JSON at line ${lineOfOffset(text, at)}`], lines: new Map() }
  }
  let lines = new Map()
  try { lines = jsonLines(text) } catch {}
  const problems = validateRefine(doc)
  return { doc: problems.length ? null : doc, errors: problems.map((p) => `${where(p.at, lines)}: ${p.msg}`), lines }
}

// One refine file, read: { file (as given), doc, errors, lines }.
export function readRefine(abs, file) {
  let size
  try { size = statSync(abs).size } catch (e) { return { file, doc: null, errors: [`cannot be read: ${e.code || 'error'}`], lines: new Map() } }
  if (size > MAX_BYTES) return { file, doc: null, errors: [`the file is larger than ${MAX_BYTES >> 10} KB: not read`], lines: new Map() }
  let text
  try { text = readFileSync(abs, 'utf8') } catch (e) { return { file, doc: null, errors: [`cannot be read: ${e.code || 'error'}`], lines: new Map() } }
  return { file, ...parseRefine(text) }
}

// Every *.data.json under the directory (dot folders aside), each named from `root` (the project's):
// [{ file, doc, errors, lines }].
export function readRefines(dir, root = dir) {
  if (!dir || !existsSync(dir)) return []
  const out = []
  const walk = (d, depth) => {
    let list
    try { list = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of list.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d, e.name)
      if (e.isDirectory() && !e.name.startsWith('.') && depth < 8) walk(abs, depth + 1)
      else if (e.isFile() && e.name.endsWith(SUFFIX)) out.push(readRefine(abs, path.relative(root, abs).split(path.sep).join('/')))
    }
  }
  walk(dir, 0)
  return out
}

// ── citations ──────────────────────────────────────────────────────────────────────────────
// What a citation must name, for a name: itself; a template (`{env}-{project}-event`) by its longest
// literal part (`event`); a field path (`lines[].sku`) by itself or its last part (`sku`). A template
// with no literal part of two characters or more gives nothing to look for ([]).
export function citeNames(name) {
  const s = String(name)
  if (/\{[^{}]*\}/.test(s)) {
    const parts = s.split(/\{[^{}]*\}/).map((p) => p.replace(/^[-_.:/\s]+|[-_.:/\s]+$/g, '')).filter((p) => p.length >= 2).sort((a, b) => b.length - a.length)
    return parts.slice(0, 1)
  }
  const last = s.split('.').pop().replace(/\[\]|\{\}/g, '')
  return last && last !== s ? [s, last] : [s]
}
// One expression per list of names (a lineage's may hold a thousand): the text is scanned once.
const reCache = new Map()
const namesRe = (names) => {
  const k = names.join('\0')
  if (!reCache.has(k)) {
    if (reCache.size > 2000) reCache.clear()
    const alt = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    reCache.set(k, alt ? new RegExp(`(?<![A-Za-z0-9_])(?:${alt})(?![A-Za-z0-9_])`, 'i') : null)
  }
  return reCache.get(k)
}
// Does a text name one of the names: the name found, or null.
export function named(text, names) {
  const re = namesRe(names)
  const m = re ? re.exec(text) : null
  if (!m) return null
  const got = m[0].toLowerCase()
  return names.find((n) => n && n.toLowerCase() === got) ?? m[0]
}
const say = (names) => { const u = [...new Set(names)]; return u.length > 6 ? `${u.slice(0, 6).join(', ')} or ${u.length - 6} more` : u.join(', ') }
const sizeText = (n) => (n >= 1 << 20 ? `${Math.round(n / (1 << 20))} MB` : `${n} bytes`)

// What one check reads, at most: the cited files (each read once, by its real path, whatever the
// spelling: `./src/a.ts`, `src/../src/a.ts`), their bytes, and the characters scanned for names (a
// line is scanned up to MAX_LINE characters: a minified file cannot make every check slow). Past a
// limit a citation is drift, saying so; a test may pass smaller ones (`limits`).
export const MAX_CITED_FILES = 1000
export const MAX_CITED_TOTAL = 64 << 20
export const MAX_SCAN = 64 << 20
export const MAX_LINE = 4096
export function citeContext(roots = [], limits = {}) {
  return { roots, repoNames: roots.map((x) => x.name), files: new Map(), real: new Map(), stats: { files: 0, reads: 0, bytes: 0, scanned: 0 }, limits: { files: MAX_CITED_FILES, bytes: MAX_CITED_TOTAL, scan: MAX_SCAN, ...limits } }
}

// A file as a check keeps it: its text and where each line starts.
function readCited(real, size, ctx) {
  const L = ctx.limits, S = ctx.stats
  if (S.files >= L.files) return { why: `too many cited files (more than ${L.files}): not read` }
  if (S.bytes + size > L.bytes) return { why: `the cited text is past the check's budget (${sizeText(L.bytes)}): not read` }
  let text
  try { text = readFileSync(real, 'utf8') } catch { return { why: 'cannot be read' } }
  S.files++; S.reads++; S.bytes += size
  const starts = [0]
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  const n = starts[starts.length - 1] === text.length ? starts.length - 1 : starts.length // a last newline ends the last line
  return { text, starts: Uint32Array.from(starts), n }
}

// A citation checked: { cite, ok, repo?, path?, start?, end?, why? }. Confined to its repository (a link
// or a path leading out of it is no file of it).
function cite(s, names, ctx) {
  const p = parseSource(s, ctx.repoNames)
  const single = ctx.roots.length === 1 ? ctx.roots[0] : ctx.roots.find((r) => r.rel === '.') || null
  const root = p && (p.repo ? ctx.roots.find((r) => r.name === p.repo) : single)
  if (!p || p.start === undefined) return { cite: s, ok: false, why: `${s}: cite repo:path:line` }
  if (!root) return { cite: s, ok: false, why: `${s}: name its repository (repo:path:line)` }
  const shown = `${root.rel && root.rel !== '.' ? `${root.rel}/` : ''}${p.path}`
  const out = { cite: s, repo: root.name, path: p.path, start: p.start, end: p.end }
  // the real path of a spelling, once; the file of a real path, once
  const k = `${root.name}\0${p.path}`
  if (!ctx.real.has(k)) {
    ctx.real.set(k, (() => {
      let real, rootReal
      try { real = realpathSync(path.resolve(root.abs, p.path)); rootReal = realpathSync(root.abs) } catch { return { why: `no such file in ${root.name}` } }
      if (!(real === rootReal || real.startsWith(rootReal + path.sep))) return { why: `no such file in ${root.name}` }
      let st
      try { st = statSync(real) } catch { return { why: `no such file in ${root.name}` } }
      if (!st.isFile()) return { why: `no such file in ${root.name}` }
      if (st.size > MAX_CITED) return { why: `the file is larger than ${MAX_CITED >> 20} MB: not read` }
      return { real, size: st.size }
    })())
  }
  const at = ctx.real.get(k)
  if (at.why) return { ...out, ok: false, why: `${shown}: ${at.why}` }
  let file = ctx.files.get(at.real)
  if (!file) { file = readCited(at.real, at.size, ctx); if (!file.why || file.why === 'cannot be read') ctx.files.set(at.real, file) }
  if (file.why) return { ...out, ok: false, why: `${shown}: ${file.why}` }
  const n = file.n
  if (p.start < 1 || p.end < p.start) return { ...out, ok: false, why: `${shown}: lines ${p.start}-${p.end} are no range` }
  if (p.end > n) return { ...out, ok: false, why: `${shown} has ${n} line${n === 1 ? '' : 's'}: ${p.start === p.end ? `line ${p.start} is` : `lines ${p.start}-${p.end} are`} past its end` }
  if (p.end - p.start >= MAX_SPAN) return { ...out, ok: false, why: `${shown}: a citation spans ${MAX_SPAN} lines at most` }
  const where = `${shown} ${p.start === p.end ? `line ${p.start}` : `lines ${p.start}-${p.end}`}`
  if (!names.filter(Boolean).length) return { ...out, ok: false, why: `${where}: the template has no literal part to look for` }
  // the lines, each up to MAX_LINE characters, within the check's scan budget
  let text = '', cut = false
  for (let i = p.start; i <= p.end; i++) {
    const a = file.starts[i - 1], b = i < file.starts.length ? file.starts[i] - 1 : file.text.length
    if (b - a > MAX_LINE) cut = true
    text += (text ? '\n' : '') + file.text.slice(a, Math.min(b, a + MAX_LINE))
  }
  if (ctx.stats.scanned + text.length > ctx.limits.scan) return { ...out, ok: false, why: `${where}: the check's scan budget (${sizeText(ctx.limits.scan)}) is spent: not read` }
  ctx.stats.scanned += text.length
  if (!named(text, names)) return { ...out, ok: false, why: `${where} name${p.start === p.end ? 's' : ''} none of: ${say(names)}${cut ? ` (a line is read up to ${MAX_LINE} characters)` : ''}` }
  return { ...out, ok: true }
}

// The equivalences a model is grouped by: those whose citations hold, checked before any model is
// built (a failing claim is drift, never trusted, not even to group); its sides are found by reconcile
// against the model it groups (binding.mjs resolveSide), and one that is not found groups nothing.
// → { equivalences: [{ ref, file, sides }], cited: Map(ref → [citation]) }
const sideNames = (tables) => tables.flatMap((s) => citeNames(s.name ?? s.template))
export function heldEquivalences(refines, ctx) {
  const equivalences = [], cited = new Map()
  for (const r of refines) {
    if (!r.doc) continue
    ;(r.doc.equivalences || []).forEach((q, i) => {
      const ref = `${r.file} equivalences[${i}]`
      const sources = (q.sources || []).map((s) => cite(s, sideNames(q.tables), ctx))
      cited.set(ref, sources)
      if (sources.every((s) => s.ok)) equivalences.push({ ref, file: r.file, sides: q.tables })
    })
  }
  return { equivalences, cited }
}

// ── the check ──────────────────────────────────────────────────────────────────────────────
// The entities a claim may name: the model's ({ id, name, store, fields: [names], indexes, relations,
// kv, e }), and the refined stores' ({ …, refined: true }).
function entitiesOf(model) {
  const m = new Map()
  for (const st of model.stores) for (const e of st.entities) m.set(e.id, { id: e.id, name: e.name, store: st.id, kv: KV_DIALECTS.has(st.dialect), fields: e.fields.map((f) => f.name), e })
  return m
}
function fieldIn(ent, name) {
  if (ent.fields.includes(name)) return name
  if (ent.kv || ent.refined) return null // key-value attributes and described fields: as written
  const lower = name.toLowerCase() // a SQL store resolves names in any letter case
  return ent.fields.find((f) => f.toLowerCase() === lower) ?? null
}

// One file's claims, checked. A claim: { kind, file, at, line, text, ok, why: [reasons], notes,
// sources: [citation], …what it names, resolved }.
function checkFile(r, ctx) {
  const doc = r.doc
  const claims = []
  const add = (kind, at, c) => { const line = lineAt(r.lines, at); claims.push({ kind, file: r.file, at: atText(at), ...(line ? { line } : {}), notes: [], ...c, ok: !c.reasons.length && (c.sources || []).every((s) => s.ok) }) }
  const sources = (list, names) => (list || []).map((s) => cite(s, names, ctx))
  const ent = (ref) => ctx.entities.get(ref) || null
  const missing = (ref) => `${ref}: no such entity in the extracted model or a refined store`

  ;(doc.lineage || []).forEach((x, i) => {
    const A = ent(x.from), B = ent(x.to), why = []
    if (!A) why.push(missing(x.from))
    if (!B) why.push(missing(x.to))
    const fields = (x.fields || []).map((f) => {
      const a = A ? fieldIn(A, f.from) : null, b = B ? fieldIn(B, f.to) : null
      if (A && !a) why.push(`the field ${f.from} is not in ${A.id}`)
      if (B && !b) why.push(`the field ${f.to} is not in ${B.id}`)
      return { from: a ?? f.from, to: b ?? f.to }
    })
    const names = [...citeNames(A ? A.name : x.from.slice(x.from.lastIndexOf('/') + 1)), ...citeNames(B ? B.name : x.to.slice(x.to.lastIndexOf('/') + 1)), ...fields.flatMap((f) => [...citeNames(f.from), ...citeNames(f.to)])]
    add('lineage', ['lineage', i], { text: `${x.from} mirrors ${x.to}${fields.length ? ` (${fields.map((f) => `${f.from} → ${f.to}`).join(', ')})` : ''}`, from: x.from, to: x.to, fromStore: A?.store ?? null, toStore: B?.store ?? null, fromRefined: !!A?.refined, toRefined: !!B?.refined, fields, why: x.why, reasons: why, sources: sources(x.sources, names) })
  })
  ;(doc.relations || []).forEach((x, i) => {
    const A = ent(x.from), B = ent(x.to), why = [], notes = []
    if (!A) why.push(missing(x.from))
    if (!B) why.push(missing(x.to))
    const cols = x.columns.map((c) => { const f = A ? fieldIn(A, c) : null; if (A && !f) why.push(`the column ${c} is not in ${A.id}`); return f ?? c })
    const toCols = x.toColumns.map((c) => { const f = B ? fieldIn(B, c) : null; if (B && !f) why.push(`the column ${c} is not in ${B.id}`); return f ?? c })
    // a foreign key on the same columns: the same relation (said), or another one (drift)
    const fk = A && A.e ? A.e.relations.find((r) => r.columns.join('\0').toLowerCase() === cols.join('\0').toLowerCase()) : null
    if (fk && B) {
      // the foreign key's target is a table of A's own store: the same relation only when B is that table
      if (`${A.store}/${fk.to}`.toLowerCase() === B.id.toLowerCase() && fk.toColumns.join('\0').toLowerCase() === toCols.join('\0').toLowerCase()) notes.push('a foreign key now states it')
      else why.push(`a foreign key on (${fk.columns.join(', ')}) references ${fk.to}(${fk.toColumns.join(', ')}): the claim disagrees with it`)
    }
    const names = [...citeNames(A ? A.name : x.from), ...citeNames(B ? B.name : x.to), ...cols, ...toCols]
    add('relation', ['relations', i], { text: `${x.from}(${cols.join(', ')}) → ${x.to}(${toCols.join(', ')})`, from: x.from, to: x.to, columns: cols, toColumns: toCols, store: A?.store ?? null, why: x.why, reasons: why, notes, sources: sources(x.sources, names) })
  })
  ;(doc.indexes || []).forEach((x, i) => {
    const E = ent(x.entity), why = []
    if (!E) why.push(missing(x.entity))
    else if (!E.e || !E.e.indexes.some((ix) => ix.name === x.index || (!E.kv && ix.name.toLowerCase() === x.index.toLowerCase()))) why.push(`no index ${x.index} on ${E.id}`) // a SQL store's in any letter case
    add('index', ['indexes', i], { text: `${x.entity} index ${x.index}: ${x.purpose}`, entity: x.entity, store: E?.store ?? null, index: x.index, purpose: x.purpose, reasons: why, sources: sources(x.sources, [x.index]) })
  })
  ;(doc.bindings || []).forEach((x, i) => {
    const why = [], notes = []
    const it = (ctx.model.items || []).find((y) => y.id === x.item) || null
    if (!it) why.push(`no item type ${x.item} (the types code converts to or from an item)`)
    const tables = [...ctx.entities.values()].filter((y) => y.kv && (y.id === x.table || y.name === x.table || y.e.logical?.name === x.table))
    const groups = new Set(tables.map((y) => y.e.logical?.id ?? y.id))
    if (!tables.length) why.push(`no key-value table ${x.table}`)
    else if (groups.size > 1) why.push(`${x.table} names ${groups.size} tables: give one as its entity id`)
    const ids = new Set(tables.flatMap((y) => (y.e.logical ? y.e.logical.members : [y.id])))
    if (it && tables.length && groups.size === 1) {
      const mine = (ctx.model.bindings || []).filter((b) => b.item === x.item)
      const same = mine.find((b) => b.entities.some((id) => ids.has(id)))
      const strong = mine.find((b) => !b.entities.some((id) => ids.has(id)) && (b.confidence === 'declared' || b.confidence === 'convention'))
      if (strong) why.push(`the code binds ${x.item} to ${strong.table} (${strong.confidence}: ${bindingHow(strong)}): the claim disagrees with it`)
      else if (same) notes.push(`the code binds it so too (${same.confidence})`)
    }
    add('binding', ['bindings', i], { text: `${x.item} → ${x.table}`, item: x.item, table: x.table, entities: [...ids], why: x.why, reasons: why, notes, sources: sources(x.sources, [...(it ? [it.name] : [x.item.slice(x.item.indexOf(':') + 1)]), ...citeNames(x.table)]) })
  })
  ;(doc.equivalences || []).forEach((x, i) => {
    const ref = `${r.file} equivalences[${i}]`
    const q = (ctx.model.equivalences || []).find((y) => y.ref === ref)
    const cited = ctx.cited.get(ref) || sources(x.sources, sideNames(x.tables))
    const why = !cited.every((c) => c.ok) ? ['not grouped: a claim whose citations do not hold groups nothing'] : !q ? [ctx.model.itemsError || 'not resolved'] : q.ok ? [] : q.why
    const sideText = (s) => `${s.repo}:${s.store || 'dynamodb'}/${s.name ?? s.template}`
    const g = q && q.ok ? ctx.model.logical.find((lg) => q.ids.every((id) => lg.members.includes(id))) : null
    add('equivalence', ['equivalences', i], { text: x.tables.map(sideText).join(' ≡ '), sides: x.tables.map(sideText), members: q && q.ok ? q.ids : [], group: g ? g.name : null, conflicts: g ? g.conflicts.length : 0, why: x.why, reasons: why, sources: cited })
  })
  return claims
}

// A refined store's claims: one per store, its entities and fields each checked (an entity or a field
// that fails is drift on its own; the rest of the store holds).
function checkStores(r, ctx) {
  return (r.doc.stores || []).map((x, i) => {
    const id = `${x.repo}:${x.id}`, at = ['stores', i], why = []
    if (!ctx.repoNames.includes(x.repo)) why.push(`no repository ${x.repo} in this project`)
    if (ctx.model.stores.some((s) => s.id === id)) why.push(`an extractor reads ${id} now: its facts are extracted, drop the refined description or give it another id`)
    const entities = x.entities.map((e, k) => {
      const ea = [...at, 'entities', k]
      const src = cite(e.source, citeNames(e.name), ctx)
      const fields = e.fields.map((f, j) => { const fa = [...ea, 'fields', j]; const fs = cite(f.source, citeNames(f.name), ctx); return { name: f.name, type: f.type ?? null, note: f.note ?? null, source: fs, ok: fs.ok, at: atText(fa), line: lineAt(r.lines, fa) } })
      return { name: e.name, kind: e.kind ?? null, note: e.note ?? null, source: src, ok: src.ok, fields, at: atText(ea), line: lineAt(r.lines, ea) }
    })
    const line = lineAt(r.lines, at)
    return { kind: 'store', file: r.file, at: atText(at), ...(line ? { line } : {}), id, repo: x.repo, name: x.id, storeKind: x.kind, label: x.label ?? null, imports: x.imports || [], why: x.why ?? null, entities,
      text: `${id} (${x.kind}): ${entities.length} entit${entities.length === 1 ? 'y' : 'ies'}, ${entities.reduce((a, e) => a + e.fields.length, 0)} fields described by citation`, reasons: why, notes: [], sources: [],
      ok: !why.length && entities.every((e) => e.ok && e.fields.every((f) => f.ok)) }
  })
}

// Every refine file checked against a model reconciled with the equivalences that hold (refineCheck
// below is the one way in). roots: docRoots(project); imports: the production code's [{ repo, path,
// source }] (for the gaps); cite: the citation context and the equivalences' citations already checked.
// → { files: [{ file, title, summary, errors, claims }], claims, stores, drift: [Drift], gaps: [Gap],
//     cited: { files, reads, bytes } (what the check read) }
//   Drift { file, at, line?, kind, text, why: [reasons] }
//   Gap   { id, label, sources: [import], files: [{ repo, path }] (the first FILES_SHOWN), n }
export function checkRefines(refines, model, { roots = [], imports = [], cite: cc = null, cited = new Map(), limits = {} } = {}) {
  const ctx = { ...(cc || citeContext(roots, limits)), model, cited, entities: entitiesOf(model) }
  // the refined stores first: a lineage may end in one of their entities
  const stores = refines.filter((r) => r.doc).flatMap((r) => checkStores(r, ctx))
  for (const s of stores) {
    if (s.reasons.length) continue
    for (const e of s.entities) if (e.ok && !ctx.entities.has(`${s.id}/${e.name}`)) ctx.entities.set(`${s.id}/${e.name}`, { id: `${s.id}/${e.name}`, name: e.name, store: s.id, refined: true, fields: e.fields.filter((f) => f.ok).map((f) => f.name), e: null })
  }
  const files = refines.map((r) => {
    const claims = r.doc ? [...checkFile(r, ctx), ...stores.filter((s) => s.file === r.file)] : []
    return { file: r.file, title: r.doc?.title ?? null, summary: r.doc?.summary ?? null, errors: r.errors, claims }
  })
  const claims = files.flatMap((f) => f.claims)
  const { files: nf, reads, bytes } = ctx.stats
  return { files, claims, stores, drift: claims.flatMap(driftOf), gaps: gapsOf(model, stores, imports), cited: { files: nf, reads, bytes } }
}

// A claim's drift: the claim's own reasons and its failing citations; a store's, per entity and field.
function driftOf(c) {
  if (c.kind === 'store') {
    const out = c.reasons.length ? [{ file: c.file, at: c.at, ...(c.line ? { line: c.line } : {}), kind: 'store', text: c.text, why: c.reasons }] : []
    for (const e of c.entities) {
      if (!e.ok) out.push({ file: c.file, at: e.at, ...(e.line ? { line: e.line } : {}), kind: 'store entity', text: `${c.id}/${e.name}`, why: [e.source.why] })
      for (const f of e.fields) if (!f.ok) out.push({ file: c.file, at: f.at, ...(f.line ? { line: f.line } : {}), kind: 'store field', text: `${c.id}/${e.name}.${f.name}`, why: [f.source.why] })
    }
    return out
  }
  if (c.ok) return []
  return [{ file: c.file, at: c.at, ...(c.line ? { line: c.line } : {}), kind: c.kind, text: c.text, why: [...c.reasons, ...c.sources.filter((s) => !s.ok).map((s) => s.why)] }]
}

// ── gaps ───────────────────────────────────────────────────────────────────────────────────
// The datastores a client import reaches (arch.mjs KNOWN's databases, and DynamoDB's own clients),
// each with the dialects of the extracted stores that cover it; none: only a refined store covers it.
// A client of a repository whose queries the code sends are read (queries.mjs) is no gap either.
const COVERS = { postgres: ['postgres'], mysql: ['mysql'], sqlite: ['sqlite'], 'sql-db': ['sqlite', 'postgres', 'mysql'], dynamodb: ['dynamodb'] }
export const DATASTORES = [
  ...KNOWN.filter((k) => k.type === 'database').map((k) => ({ id: k.id, label: k.label, imports: k.imports })),
  { id: 'dynamodb', label: 'DynamoDB', imports: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', '@aws-sdk/util-dynamodb', 'aws-sdk/clients/dynamodb', 'aws_sdk_dynamodb', 'github.com/aws/aws-sdk-go-v2/service/dynamodb', 'github.com/aws/aws-sdk-go/service/dynamodb', 'software.amazon.awssdk.services.dynamodb', 'dynamoose', 'electrodb', 'dynamodb-toolbox', 'pynamodb'] },
]
const FILES_SHOWN = 5
export function gapsOf(model, stores, imports) {
  const out = []
  for (const d of DATASTORES) {
    const seen = imports.filter((im) => d.imports.some((p) => importMatches(im.source, p)))
    if (!seen.length) continue
    const dialects = COVERS[d.id] || []
    if (model.stores.some((s) => dialects.includes(s.dialect) && s.entities.length)) continue
    // an import a refined store names, or a client of a repository whose queries are read (queries.mjs)
    const read = model.queries?.clients || []
    const open = seen.filter((im) => !stores.some((s) => s.imports.some((p) => importMatches(im.source, p))) && !read.some((c) => c.repo === im.repo && c.source === im.source))
    if (!open.length) continue
    const files = [...new Set(open.map((im) => `${im.repo}\0${im.path}`))].sort()
    out.push({ id: d.id, label: d.label, sources: [...new Set(open.map((im) => im.source))].sort(), files: files.slice(0, FILES_SHOWN).map((k) => ({ repo: k.slice(0, k.indexOf('\0')), path: k.slice(k.indexOf('\0') + 1) })), n: files.length })
  }
  return out
}

// ── for the tools and the page ─────────────────────────────────────────────────────────────
// The one way every caller (graph_data, graph_changes, `data check`, the page) checks refine files:
// the equivalences' citations first, so only those that hold group the model; then the model; then
// every claim against it, through one citation context (each file read once, within the budget).
// → { model, refine, equivalences: the ones that held (for a base's model: data/base.mjs modelAt, so
//   the branch's diff compares the code) }
export function refineCheck(rows, refines, { roots = [], imports = [], limits = {} } = {}) {
  const cc = citeContext(roots, limits)
  const held = heldEquivalences(refines, cc)
  const model = reconcile(rows, { equivalences: held.equivalences })
  const refine = checkRefines(refines, model, { roots, imports, cite: cc, cited: held.cited })
  return { model, refine, equivalences: held.equivalences }
}
// A project's: its refine files read beside the diagrams → { model, refines, refine } (refine null when
// there is no refine file and no gap to say).
export function refineModel(rows, project, { imports = [], roots = [] } = {}) {
  const refines = project && project.root ? readRefines(project.architectureDir, project.root) : []
  const { model, refine } = refineCheck(rows, refines, { roots, imports })
  return { model, refines, refine: refines.length || refine.gaps.length ? refine : null }
}
// The equivalences a base's model is grouped by: those that hold now (their citations checked).
export const groupingFor = (refines, roots = []) => ({ equivalences: heldEquivalences(refines, citeContext(roots)).equivalences })
