// grimoire graph · reach: what a change can touch that the resolved edges alone do not show. The
// edges are name-resolved leads (resolve.mjs); this module adds the three places they go blind, so an
// impact answer covers what a grep would find, sorted and explained instead of raw:
//
//   dispatch(g, node)   a method's declarations up its supertypes (an interface, a trait, a base
//                       class: a call typed to them may land here at run time) and the overrides down
//                       its subtypes (they redefine it: a contract change must reach them).
//   unresolved(g, ids)  call sites naming a target that resolution left unlinked: a receiver whose
//                       type the syntax does not state, a name with too many definitions. The refs
//                       table keeps them; each is a possible caller, never a verdict.
//   mentions(…)         every other place the target's name appears, in any file of any repository
//                       of the project (git grep, .gitignore honoured): a function passed as a value,
//                       a string key, a type annotation, config, docs, scripts. Each hit already
//                       explained by an edge, an import or an unresolved site is dropped, so what is
//                       left is what the graph cannot see. A hit is classified (string, comment,
//                       reference; config, docs, script, markup), never quoted: a line may hold a
//                       literal, and no answer of the graph carries a literal's value.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { familyOf, langOf } from './langs.mjs'
import { listPaths, skipped, maxBytesOf, SECRET_GLOBS, SECRETISH } from './project.mjs'

const MIN_NAME = 3 // shorter names are not searched as text
const MAX_HITS = 2000 // per term and repository: past it, the name is too common to sort hit by hit
const LISTED_FILES = 30, PER_FILE = 4, LISTED_SITES = 25
// files that may hold credentials: never searched, never named (project.mjs SECRET_GLOBS, SECRETISH)
export { SECRET_GLOBS, SECRETISH }
// a line past this length (minified code, data) is classified by its file alone; at most this many
// occurrences of a name are read per line: classification stays linear in the input
const MAX_LINE = 1000, PER_LINE = 8
const ABSTRACT = new Set(['interface', 'trait', 'protocol'])
// a type's members a call, an override and a receiver reach: methods, and fields (an annotated hook, a settings value)
const MEMBERS = new Set(['method', 'field'])
const CALL_KINDS = "('call','new','macro')"

// ── dispatch ──
export function dispatch(g, n) {
  if (!MEMBERS.has(n.kind) || !n.parent_id) return { up: [], down: [] }
  const owner = g.node(n.parent_id)
  if (!owner) return { up: [], down: [] }
  const member = g.db.prepare("SELECT n.*, f.repo, f.path, f.lang FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.parent_id = ? AND n.name = ? AND n.kind IN ('method','function','field') ORDER BY n.line LIMIT 1")
  const side = (dir) => {
    const out = []
    for (const [id, info] of g.walk([owner.id], ['EXTENDS', 'IMPLEMENTS'], dir, 4)) {
      if (info.depth === 0) continue
      const m = member.get(id, n.name)
      if (m) out.push({ node: m, type: g.node(id), depth: info.depth })
    }
    return out.sort((a, b) => a.depth - b.depth)
  }
  return { up: side('out'), down: side('in'), owner }
}
// The start set an impact walks from: a method's supertype declarations (their callers may dispatch
// here) and, for a declaration on an interface, trait or protocol, its implementations (a change to
// the contract is a change to each of them).
export function dispatchStarts(g, hits) {
  const extra = [], info = []
  for (const h of hits) {
    const d = dispatch(g, h)
    if (!d.up.length && !d.down.length) continue
    info.push({ target: h, ...d })
    for (const u of d.up) extra.push(u.node.id)
    if (d.owner && ABSTRACT.has(d.owner.kind)) for (const x of d.down) extra.push(x.node.id)
  }
  return { extra, info }
}
export function dispatchLines(g, info) {
  const out = []
  for (const d of info) {
    if (d.up.length) {
      out.push(`Dispatch: calls typed to these declarations may land on ${d.target.qualname} (their callers are in the impact above):`)
      for (const u of d.up) out.push(`  ${g.row(u.node)}  (${u.type.kind} ${u.type.qualname})`)
    }
    if (d.down.length) {
      out.push(`${ABSTRACT.has(d.owner.kind) ? 'Implementations' : 'Overrides'} of ${d.target.qualname} (they redefine it: a contract change must reach each):`)
      for (const x of d.down) out.push(`  ${g.row(x.node)}  (${x.type.kind} ${x.type.qualname})`)
    }
  }
  return out
}

// ── unresolved call sites ──
// [{ ref, src (node), file }] for refs naming one of the targets, in the target's language family, in
// any repository of the project (no edge crosses repositories), that no CALLS edge accounts for: the
// site's definition is not already a linked caller of the target, and no edge from it links that very
// line to another definition of the name (that one is the other definition's caller, not a lead). A site
// whose receiver's type the syntax states (`this.userRepository.findOne()` on a `Repository<User>`) is
// a lead only when that type is the target's owner or one of its supertypes or subtypes.
export function unresolved(g, targets) {
  const out = [], seen = new Set()
  const callsTarget = g.db.prepare("SELECT 1 FROM edges WHERE src = ? AND dst = ? AND kind = 'CALLS' LIMIT 1")
  const linkedHere = g.db.prepare("SELECT 1 FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.src = ? AND e.kind = 'CALLS' AND d.name = ? AND e.line = ? LIMIT 1")
  for (const t of targets) {
    if (t.kind === 'file' || t.name.length < 2) continue
    const fam = familyOf(t.lang)
    const kinds = ['class', 'struct'].includes(t.kind) ? "('new','call')" : CALL_KINDS
    const rows = g.q(`SELECT r.*, f.repo, f.path, f.lang FROM refs r JOIN files f ON f.id = r.file_id WHERE r.name = ? AND r.kind IN ${kinds} ORDER BY f.repo != ?, f.repo, f.path, r.line`, t.name, t.repo || '')
    let related = null // the owner's name and its supertypes' and subtypes': the types a stated receiver may have
    const typedTo = (qtype) => {
      if (!related) {
        related = new Set()
        const owner = t.parent_id ? g.node(t.parent_id) : null
        if (owner) for (const dir of ['out', 'in']) for (const id of g.walk([owner.id], ['EXTENDS', 'IMPLEMENTS'], dir, 4).keys()) { const n = g.node(id); if (n) related.add(n.name) }
      }
      return related.has(qtype.split('.').pop())
    }
    for (const r of rows) {
      if (familyOf(r.lang) !== fam || r.src_id === t.id) continue
      if (r.qtype && t.id > 0 && !typedTo(r.qtype)) continue // (a name no definition holds yet: every site)
      if ((t.id > 0 && callsTarget.get(r.src_id, t.id)) || linkedHere.get(r.src_id, r.name, r.line)) continue
      const k = `${r.file_id}|${r.line}|${r.name}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ ref: r, src: g.node(r.src_id), target: t })
    }
  }
  return out
}
// a call site as `receiver.name`, on one line (a receiver's text can span lines)
export const siteText = (r) => `${r.qual ? `${r.qual.replace(/\s+/g, ' ').slice(0, 80)}.` : ''}${r.name}`
export function unresolvedLines(g, sites) {
  if (!sites.length) return []
  const tests = sites.filter((s) => s.src?.is_test).length
  const out = [`Possible callers the graph could not link (a call by this name on a receiver of unknown type, or a name with many definitions; ${sites.length}${tests ? `, ${tests} in tests` : ''}): read each`]
  for (const s of sites.slice(0, LISTED_SITES)) {
    const where = s.src && s.src.kind !== 'file' ? `in ${s.src.qualname}` : 'at file level'
    out.push(`  ${g.loc({ repo: s.ref.repo, path: s.ref.path, kind: 'x', line: s.ref.line })}  ${where}  ${siteText(s.ref)}${s.src?.is_test ? '  test' : ''}`)
  }
  if (sites.length > LISTED_SITES) out.push(`  … ${sites.length - LISTED_SITES} more`)
  return out
}

// ── text mentions ──
const KIND_BY_EXT = [
  [/\.(json|jsonc|json5|ya?ml|toml|ini|cfg|conf|xml|properties|plist|tf|tfvars|hcl|env\.example|gradle|cmake)$|(^|\/)(Dockerfile|Makefile|Procfile|docker-compose[^/]*|Jenkinsfile)$/i, 'config'],
  [/\.(md|mdx|markdown|rst|txt|adoc|org)$/i, 'docs'],
  [/\.(html?|vue|svelte|erb|hbs|handlebars|ejs|njk|j2|jinja2?|twig|liquid|astro)$/i, 'markup'],
  [/\.(sh|bash|zsh|fish|ps1|bat|cmd|sql|graphql|gql|proto)$/i, 'script'],
]
export const kindOfPath = (p) => (KIND_BY_EXT.find(([re]) => re.test(p)) || [null, 'other'])[1]
const HASH_COMMENT = new Set(['python', 'ruby', 'php', 'graphql'])
// API contracts read by hand (contracts.mjs): a line is a reference, a comment or a description
const CONTRACT_FAMILIES = new Set(['graphql', 'proto'])
// Where an occurrence sits in its line, read lexically (no parse): inside a string literal, after a
// comment marker, or in code. Multi-line strings and block comments are only caught by a line that
// opens with `*`, `/*`, `<!--` or `#`.
export function classify(text, at, lang = null) {
  if (/^\s*(\*(\s|\/|$)|\/\*|<!--|\/\/)/.test(text) || (HASH_COMMENT.has(familyOf(lang)) && /^\s*#/.test(text))) return 'comment'
  const rust = familyOf(lang) === 'rust'
  let q = null, from = -1
  for (let i = 0; i < at; i++) {
    const c = text[i]
    if (q) {
      if (c === '\\') { i++; continue }
      if (c === q) q = null
      else if (q === '`' && c === '$' && text[i + 1] === '{') { const close = text.indexOf('}', i); if (close < 0 || close > at) return 'reference' } // inside a template's ${…}: code
      continue
    }
    if (rust && c === "'") { const m = /^'(\\.[^']*|[^\\'])'/.exec(text.slice(i)); if (m) i += m[0].length - 1; continue } // a char literal, never a lifetime's quote
    if (c === '"' || c === '`' || c === "'") { q = c; from = i; continue }
    if (c === '/' && text[i + 1] === '/') return 'comment'
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); if (end < 0 || end > at) return 'comment'; i = end + 1; continue }
    if (c === '#' && HASH_COMMENT.has(familyOf(lang))) return 'comment'
  }
  if (!q) return 'reference'
  // the literal it sits in: a key (the name alone, or in a path, a dotted name, a route: no space) is
  // a lead; prose that happens to use the word is text
  let end = at
  while (end < text.length && text[end] !== q) end += text[end] === '\\' ? 2 : 1
  return /\s/.test(text.slice(from + 1, end)) ? 'text' : 'string'
}
const RANK = { reference: 0, import: 1, string: 2, key: 3, property: 4, config: 5, markup: 6, script: 7, other: 8, text: 9, docs: 10, comment: 11 }
// the kinds that can be a use of the target, not only a word about it
export const USE_KINDS = new Set(['reference', 'import', 'string', 'key', 'config', 'markup', 'script', 'other'])
// A code occurrence read closer: a local binding of the same name (`const x =`, `def x`, `fn x`) is
// another thing, dropped; `x:` an object key or a named parameter (a dispatch table's key is a lead);
// `.x` a property of something else, unless the target is a method (then a method passed as a value).
// A line of prose inside a docstring: five words or more, no code punctuation, the name not called
const PROSE_LANGS = new Set(['python'])
// (a member access `settings.SOME_NAME` is code; the name's own words, `ACCESS_TOKEN_EXPIRE`, are not counted)
const prose = (text, at, len) => !/[=(){}[\]]/.test(text) && !/^\s*[.(]/.test(text.slice(at + len)) && !/(\.|->)\s*$/.test(text.slice(0, at)) && ((text.slice(0, at) + text.slice(at + len)).match(/[\p{L}]{2,}/gu) || []).length >= 5
const DECL_BEFORE = /(^|[^\p{L}\p{N}_$])(const|let|var|val|def|fn|func|function|class|struct|enum|interface|type|my|local)\s+$/u
// Returns the kind, 'decl' for a local binding (it shadows the name in its definition), or null.
const SELF_MODULE = new Set(['exports']) // `exports.x`: a CommonJS module's own export
export function refine(text, at, len, kind, targetKind, lang = null, modules = null) {
  if (kind !== 'reference') return kind
  const before = text.slice(0, at), after = text.slice(at + len)
  if (familyOf(lang) === 'ruby' && /(^|[^:]):$/.test(before)) return 'reference' // a symbol: `&:valid?`, `send(:x)`, `before_action :x`
  if (/::\s*$/.test(before)) return 'reference' // a path: `util::triple`, `Type::make`
  if (DECL_BEFORE.test(before)) return 'decl'
  if (/^\s*:(?!:)/.test(after) && !/\?\s*$/.test(before)) return 'key'
  if (/^\s*=(?![=>])/.test(after) && /[(,]\s*$/.test(before)) return 'key' // a keyword argument: `f(name=…)`
  if (PROSE_LANGS.has(familyOf(lang)) && prose(text, at, len)) return 'text' // a docstring's line
  const member = /(\.|->)\s*$/.test(before)
  // `util.slug`, `ns.fn`: qualified by a module the file imports is a use, not another object's property
  const qual = /([\p{L}_$][\p{L}\p{N}_$]*)\s*(\.|->)\s*$/u.exec(before)
  if (member && !MEMBERS.has(targetKind) && qual && ((modules && modules.has(qual[1])) || SELF_MODULE.has(qual[1]))) return 'reference'
  if (member && !MEMBERS.has(targetKind)) return 'property'
  // a method is reached through a receiver (or `self`/`this`, which the edges cover): a bare name in
  // another definition is another binding
  if (!member && MEMBERS.has(targetKind)) return null
  return 'reference'
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One repository's lines holding any of the terms as a whole word: [{ path, line, text }].
function grepRepo(abs, terms, project) {
  const r = spawnSync('git', ['-C', abs, 'grep', '-n', '-I', '-w', '-z', '--untracked', '--full-name', '-F', ...terms.flatMap((t) => ['-e', t]), '--', '.', ...SECRET_GLOBS.map((x) => `:(exclude,glob)**/${x}`)], { encoding: 'utf8', maxBuffer: 1 << 27 })
  const prefix = spawnSync('git', ['-C', abs, 'rev-parse', '--show-prefix'], { encoding: 'utf8' })
  if (r.status === 0 || r.status === 1) {
    const pre = prefix.status === 0 ? prefix.stdout.trim() : ''
    const out = []
    for (const rec of r.stdout.split('\n')) {
      if (!rec) continue
      const a = rec.indexOf('\0'), b = rec.indexOf('\0', a + 1)
      if (a < 0 || b < 0) continue
      let p = rec.slice(0, a)
      if (pre) { if (!p.startsWith(pre)) continue; p = p.slice(pre.length) }
      out.push({ path: p, line: Number(rec.slice(a + 1, b)), text: rec.slice(b + 1) })
    }
    return out
  }
  // not a git work tree: read the files (text only, size-capped)
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_$])(${terms.map(esc).join('|')})(?![\\p{L}\\p{N}_$])`, 'u')
  const out = []
  for (const rel of listPaths(abs)) {
    if (skipped(rel, project) || SECRETISH.test(rel)) continue
    let text
    try { if (statSync(path.join(abs, rel)).size > maxBytesOf(project, rel)) continue; text = readFileSync(path.join(abs, rel), 'utf8') } catch { continue }
    if (text.includes('\u0000')) continue
    text.split('\n').forEach((t, i) => { if (re.test(t)) out.push({ path: rel, line: i + 1, text: t }) })
  }
  return out
}

// terms: [{ term, targets: [node] }] (a node's name, a file's basename). explained: Set of node ids
// whose edges, refs and imports already account for a hit (the targets, and everything the impact
// reached is not needed: a hit is explained by its own line's edges).
// opts.sites: the unlinked call sites already listed (unresolved()): their lines are explained.
export function mentions(g, project, terms, { sites = [] } = {}) {
  const usable = terms.filter((t) => t.term.length >= MIN_NAME)
  const res = { hits: [], common: [], searched: usable.map((t) => t.term) }
  if (!usable.length) return res
  const targetIds = new Set(usable.flatMap((t) => t.targets.map((n) => n.id)))
  const defLines = new Set(usable.flatMap((t) => t.targets.filter((n) => n.kind !== 'file').map((n) => `${n.repo}|${n.path}|${n.line}`)))
  const fileRow = g.db.prepare('SELECT * FROM files WHERE repo = ? AND path = ?')
  const around = g.db.prepare("SELECT id, kind, qualname, line, end_line FROM nodes WHERE file_id = ? AND kind != 'file' AND line <= ? AND end_line >= ? ORDER BY (end_line - line) ASC")
  const otherDef = g.db.prepare("SELECT 1 FROM nodes WHERE file_id = ? AND line = ? AND name = ? AND kind != 'file' LIMIT 1")
  const edgeTo = g.db.prepare("SELECT dst FROM edges WHERE src = ? AND kind IN ('CALLS','REFERENCES','EXTENDS','IMPLEMENTS')")
  const siteLines = new Set(sites.map((x) => `${x.ref.repo}|${x.ref.path}|${x.ref.line}`))
  // a line the configuration index holds for one of the terms (a read, a declaration, a mapping):
  // graph_config explains it, so it is not repeated as a mention
  const cfgLines = new Set()
  try {
    const ts = usable.map((t) => t.term), ph = ts.map(() => '?').join(',')
    for (const r of g.q(`SELECT repo, path, line FROM config WHERE key IN (${ph}) OR src_key IN (${ph})`, ...ts, ...ts)) cfgLines.add(`${r.repo}|${r.path}|${r.line}`)
  } catch {} // an index without the table
  // the lines of a GraphQL file inside a block description ("""…"""): prose, read once per file
  const descOf = new Map()
  const inDescription = (abs, rel, line) => {
    const k = `${abs}|${rel}`
    if (!descOf.has(k)) {
      const set = new Set()
      try {
        const text = readFileSync(path.join(abs, rel), 'utf8')
        let at = 0, ln = 1, open = -1
        for (let i = text.indexOf('"""'); i >= 0; i = text.indexOf('"""', i + 3)) {
          for (; at < i; at++) if (text.charCodeAt(at) === 10) ln++
          if (open < 0) open = ln
          else { for (let l = open; l <= ln; l++) set.add(l); open = -1 }
        }
      } catch {}
      descOf.set(k, set)
    }
    return descOf.get(k).has(line)
  }
  // a call on this line linked to another definition of the name: that definition's caller
  const linkedOther = g.db.prepare("SELECT d.id FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.src = ? AND e.line = ? AND e.kind IN ('CALLS','REFERENCES') AND d.name = ?")
  // the names a file's imports bind (a module, a namespace, an imported name): `util.slug` is a use
  const importNames = g.db.prepare('SELECT names, alias FROM imports WHERE file_id = ?')
  const modulesOf = new Map()
  const modules = (fid) => {
    if (!modulesOf.has(fid)) {
      const set = new Set()
      for (const i of importNames.all(fid)) { if (i.alias) set.add(i.alias); for (const n of JSON.parse(i.names || '[]')) set.add(String(n).split('=')[0]) }
      modulesOf.set(fid, set)
    }
    return modulesOf.get(fid)
  }
  const sizeOf = new Map()
  const tooBig = (abs, rel) => { const k = `${abs}|${rel}`; if (!sizeOf.has(k)) { let n = 0; try { n = statSync(path.join(abs, rel)).size } catch {} sizeOf.set(k, n) } return sizeOf.get(k) > maxBytesOf(project, rel) }
  const importAt = g.db.prepare('SELECT resolved FROM imports WHERE file_id = ? AND line = ?')
  // a line holding a contract hint for the name (`user: findUser` in a resolver map) whose IMPLEMENTS
  // edge reaches a target: that edge explains it (the edge carries the hint's line)
  const hintAt = g.db.prepare("SELECT 1 FROM refs WHERE file_id = ? AND line = ? AND kind = 'contract' AND name = ? LIMIT 1")
  const implAt = g.db.prepare("SELECT dst FROM edges WHERE kind = 'IMPLEMENTS' AND line = ? AND confidence IN ('contract', 'contract-name')")
  const hinted = (fid, line, term) => !!hintAt.get(fid, line, term) && implAt.all(line).some((e) => targetIds.has(e.dst))
  const edgeAt = g.db.prepare("SELECT dst FROM edges WHERE src = ? AND line = ? AND kind IN ('CALLS','REFERENCES','EXTENDS','IMPLEMENTS')")
  const shadow = new Map() // scope → the lines declaring the local
  const callsTarget = new Map()
  const reachesTarget = (id) => { if (!callsTarget.has(id)) callsTarget.set(id, edgeTo.all(id).some((e) => targetIds.has(e.dst))); return callsTarget.get(id) }

  for (const repo of project.repos) {
    const hits = grepRepo(repo.abs, usable.map((t) => t.term), project)
    const perTerm = new Map()
    for (const h of hits) for (const t of usable) if (new RegExp(`(^|[^\\p{L}\\p{N}_$])${esc(t.term)}(?![\\p{L}\\p{N}_$])`, 'u').test(h.text)) perTerm.set(t.term, (perTerm.get(t.term) || 0) + 1)
    const tooMany = new Set([...perTerm].filter(([, n]) => n > MAX_HITS).map(([t]) => t))
    for (const t of tooMany) res.common.push({ repo: repo.name, term: t, n: perTerm.get(t) })
    for (const h of hits) {
      if (SECRETISH.test(h.path) || skipped(h.path, project) || tooBig(repo.abs, h.path) || cfgLines.has(`${repo.name}|${h.path}|${h.line}`)) continue
      const terms = usable.filter((t) => !tooMany.has(t.term))
      let kind = null, term = null
      const f = fileRow.get(repo.name, h.path)
      const nodes = f ? around.all(f.id, h.line, h.line) : []
      const codeLang = f ? (f.lang === 'other' ? null : f.lang) : langOf(h.path) === 'other' ? null : langOf(h.path)
      if (h.text.length > MAX_LINE) { // minified code or data: its file says what it is, its line is not read
        const t = terms.find((x) => h.text.includes(x.term))
        if (t) res.hits.push({ repo: repo.name, path: h.path, line: h.line, kind: codeLang ? 'other' : kindOfPath(h.path), term: t.term, where: nodes[0] ? nodes[0].qualname : null, scope: null, test: f ? !!f.is_test : false })
        continue
      }
      for (const t of terms) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}_$])(${esc(t.term)})(?![\\p{L}\\p{N}_$])`, 'gu')
        let m, seen = 0
        while ((m = re.exec(h.text)) && seen++ < PER_LINE) {
          const at = m.index + m[1].length
          let k
          if (!codeLang) { k = kindOfPath(h.path); if (k === 'config' && classify(h.text, at) === 'text') k = 'text' } // prose in a config value
          else if (!f) { k = refine(h.text, at, t.term.length, classify(h.text, at, codeLang), t.targets[0].kind, codeLang); if (k === 'decl') k = null } // too large to index: read as text
          else {
            if (defLines.has(`${repo.name}|${h.path}|${h.line}`)) continue // the definition itself
            if (otherDef.get(f.id, h.line, t.term)) continue // another definition of the same name
            if (hinted(f.id, h.line, t.term)) continue // code implementing a contract element of that name: an edge
            // an import line: resolved, its edge is in the graph; unresolved (an alias path, another
            // package or repository), it is a lead the graph cannot follow
            const imp = importAt.all(f.id, h.line)
            if (imp.length) { if (imp.some((i) => i.resolved)) continue; k = 'import' }
            // the line's enclosing definitions already call the target, or carry an unresolved site
            // of that name (listed apart): explained. At file level (no definition around it), only
            // a call or a site on this very line explains it: top-level code is one big scope
            else if (siteLines.has(`${repo.name}|${h.path}|${h.line}`) || nodes.some((n) => reachesTarget(n.id)) || (!nodes.length && edgeAt.all(f.node_id, h.line).some((e) => targetIds.has(e.dst)))) continue
            // a call here linked to another definition of the name is that one's
            else if ([...nodes.map((n) => n.id), f.node_id].some((id) => linkedOther.all(id, h.line, t.term).some((d) => !targetIds.has(d.id)))) continue
            else if (CONTRACT_FAMILIES.has(familyOf(f.lang))) { const c = familyOf(f.lang) === 'graphql' && inDescription(repo.abs, h.path, h.line) ? 'text' : classify(h.text, at, f.lang); k = c === 'string' ? 'text' : c } // a type used, a comment, a description
            else k = refine(h.text, at, t.term.length, classify(h.text, at, f.lang), t.targets[0].kind, f.lang, modules(f.id))
            if (k === 'decl') { if (nodes[0]) { const sc = `${f.id}|${nodes[0].id}|${t.term}`; (shadow.get(sc) || shadow.set(sc, new Set()).get(sc)).add(h.line) } continue }
          }
          if (k === null) continue
          if (kind === null || RANK[k] < RANK[kind]) { kind = k; term = t.term }
        }
      }
      if (kind === null) continue
      const inner = nodes[0]
      res.hits.push({ repo: repo.name, path: h.path, line: h.line, kind, term, where: inner ? inner.qualname : null, scope: f && inner ? `${f.id}|${inner.id}|${term}` : null, test: f ? !!f.is_test : /(^|\/)(tests?|__tests__|spec)\//.test(h.path) })
    }
  }
  // a local binding of the name shadows it in its whole definition: its other hits there are that local
  // (a use on the declaring line itself, `const load = store.load`, stays)
  res.hits = res.hits.filter((h) => !(h.scope && !['string', 'text', 'comment'].includes(h.kind) && shadow.has(h.scope) && !shadow.get(h.scope).has(h.line)))
  res.hits.sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.test - b.test) || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line))
  return res
}
export function mentionLines(g, res, { ambiguous = [] } = {}) {
  const out = []
  if (res.hits.length) {
    const files = new Map()
    for (const h of res.hits) { const k = `${h.repo}|${h.path}`; if (!files.has(k)) files.set(k, []); files.get(k).push(h) }
    const byKind = {}
    for (const h of res.hits) byKind[h.kind] = (byKind[h.kind] || 0) + 1
    out.push(`Mentions the graph has no link for (${res.hits.length} in ${files.size} file(s): ${Object.entries(byKind).sort((a, b) => RANK[a[0]] - RANK[b[0]]).map(([k, n]) => `${k} ${n}`).join(', ')}): a value passed or stored, a string key, a type use, config or docs can reach it; read the uses, skim the rest`)
    if (ambiguous.length) out.push(`  (${ambiguous.map((a) => `${a.n} definitions are named ${a.name}`).join('; ')}: a hit may be any of them)`)
    for (const list of [...files.values()].slice(0, LISTED_FILES)) {
      const h0 = list[0]
      const shown = list.slice(0, PER_FILE).map((h) => `:${h.line} ${h.kind}${h.where ? ` in ${h.where}` : ''}`).join(' · ')
      out.push(`  ${g.loc({ repo: h0.repo, path: h0.path, kind: 'file' })}${h0.test ? ' (test)' : ''}  ${shown}${list.length > PER_FILE ? ` · … ${list.length - PER_FILE} more` : ''}`)
    }
    if (files.size > LISTED_FILES) out.push(`  … ${files.size - LISTED_FILES} more file(s)`)
  } else if (res.searched.length) out.push(`Mentions the graph has no link for: none (searched every file of the project for ${res.searched.map((t) => `"${t}"`).join(', ')})`)
  for (const c of res.common) out.push(`  "${c.term}" appears on ${c.n} lines of ${c.repo}: too common to sort; search it with a narrower pattern`)
  return out
}
