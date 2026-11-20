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
import { listPaths, skipped } from './project.mjs'

const MIN_NAME = 3 // shorter names are not searched as text
const MAX_HITS = 2000 // per term and repository: past it, the name is too common to sort hit by hit
const LISTED_FILES = 30, PER_FILE = 4, LISTED_SITES = 25
// files that may hold credentials: never searched, never named
const SECRETISH = /(^|\/)\.env(\.|$)|\.(pem|key|p12|pfx|jks|keystore|crt|cer|der)$|(^|\/)(id_rsa|id_ed25519|credentials|\.npmrc|\.pypirc|\.netrc)$/i
const ABSTRACT = new Set(['interface', 'trait', 'protocol'])
const CALL_KINDS = "('call','new','macro')"

// ── dispatch ──
export function dispatch(g, n) {
  if (n.kind !== 'method' || !n.parent_id) return { up: [], down: [] }
  const owner = g.node(n.parent_id)
  if (!owner) return { up: [], down: [] }
  const member = g.db.prepare("SELECT n.*, f.repo, f.path, f.lang FROM nodes n JOIN files f ON f.id = n.file_id WHERE n.parent_id = ? AND n.name = ? AND n.kind IN ('method','function') ORDER BY n.line LIMIT 1")
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
// [{ ref, src (node), file }] for refs naming one of the targets, in the target's language family and
// repository, with no CALLS edge from their site to anything of that name (one that resolved to
// another definition of the name is that definition's caller, not a lead).
export function unresolved(g, targets) {
  const out = [], seen = new Set()
  const linked = g.db.prepare("SELECT 1 FROM edges e JOIN nodes d ON d.id = e.dst WHERE e.src = ? AND e.kind = 'CALLS' AND d.name = ? LIMIT 1")
  for (const t of targets) {
    if (t.kind === 'file' || t.name.length < 2) continue
    const fam = familyOf(t.lang)
    const kinds = ['class', 'struct'].includes(t.kind) ? "('new','call')" : CALL_KINDS
    const rows = g.q(`SELECT r.*, f.repo, f.path, f.lang FROM refs r JOIN files f ON f.id = r.file_id WHERE r.name = ? AND r.kind IN ${kinds} AND f.repo = ? ORDER BY f.path, r.line`, t.name, t.repo)
    for (const r of rows) {
      if (familyOf(r.lang) !== fam || r.src_id === t.id) continue
      if (linked.get(r.src_id, r.name)) continue
      const k = `${r.file_id}|${r.line}|${r.name}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ ref: r, src: g.node(r.src_id), target: t })
    }
  }
  return out
}
export function unresolvedLines(g, sites) {
  if (!sites.length) return []
  const tests = sites.filter((s) => s.src?.is_test).length
  const out = [`Possible callers the graph could not link (a call by this name on a receiver of unknown type, or a name with many definitions; ${sites.length}${tests ? `, ${tests} in tests` : ''}): read each`]
  for (const s of sites.slice(0, LISTED_SITES)) {
    const where = s.src && s.src.kind !== 'file' ? `in ${s.src.qualname}` : 'at file level'
    out.push(`  ${g.loc({ repo: s.ref.repo, path: s.ref.path, kind: 'x', line: s.ref.line })}  ${where}  ${s.ref.qual ? `${s.ref.qual}.` : ''}${s.ref.name}${s.src?.is_test ? '  test' : ''}`)
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
const HASH_COMMENT = new Set(['python', 'ruby', 'php'])
// Where an occurrence sits in its line, read lexically (no parse): inside a string literal, after a
// comment marker, or in code. Multi-line strings and block comments are only caught by a line that
// opens with `*`, `/*`, `<!--` or `#`.
export function classify(text, at, lang = null) {
  if (/^\s*(\*|\/\*|<!--|\/\/)/.test(text) || (HASH_COMMENT.has(familyOf(lang)) && /^\s*#/.test(text))) return 'comment'
  let q = null, from = -1
  for (let i = 0; i < at; i++) {
    const c = text[i]
    if (q) {
      if (c === '\\') { i++; continue }
      if (c === q) q = null
      else if (q === '`' && c === '$' && text[i + 1] === '{') { const close = text.indexOf('}', i); if (close < 0 || close > at) return 'reference' } // inside a template's ${…}: code
      continue
    }
    if (c === '"' || c === '`' || (c === "'" && familyOf(lang) !== 'rust')) { q = c; from = i; continue }
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
const DECL_BEFORE = /(^|[^\p{L}\p{N}_$])(const|let|var|val|def|fn|func|function|class|struct|enum|interface|type|my|local)\s+$/u
export function refine(text, at, len, kind, targetKind) {
  if (kind !== 'reference') return kind
  const before = text.slice(0, at), after = text.slice(at + len)
  if (DECL_BEFORE.test(before)) return null
  if (/^\s*:(?!:)/.test(after) && !/\?\s*$/.test(before)) return 'key'
  const member = /(\.|->|::)\s*$/.test(before)
  if (member && targetKind !== 'method') return 'property'
  // a method is reached through a receiver (or `self`/`this`, which the edges cover): a bare name in
  // another definition is another binding
  if (!member && targetKind === 'method') return null
  return 'reference'
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One repository's lines holding any of the terms as a whole word: [{ path, line, text }].
function grepRepo(abs, terms, project) {
  const r = spawnSync('git', ['-C', abs, 'grep', '-n', '-I', '-w', '-z', '--untracked', '--full-name', '-F', ...terms.flatMap((t) => ['-e', t]), '--', '.'], { encoding: 'utf8', maxBuffer: 1 << 27 })
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
    if (skipped(rel, project)) continue
    let text
    try { if (statSync(path.join(abs, rel)).size > project.maxBytes) continue; text = readFileSync(path.join(abs, rel), 'utf8') } catch { continue }
    if (text.includes('\u0000')) continue
    text.split('\n').forEach((t, i) => { if (re.test(t)) out.push({ path: rel, line: i + 1, text: t }) })
  }
  return out
}

// terms: [{ term, targets: [node] }] (a node's name, a file's basename). explained: Set of node ids
// whose edges, refs and imports already account for a hit (the targets, and everything the impact
// reached is not needed: a hit is explained by its own line's edges).
export function mentions(g, project, terms) {
  const usable = terms.filter((t) => t.term.length >= MIN_NAME)
  const res = { hits: [], common: [], searched: usable.map((t) => t.term) }
  if (!usable.length) return res
  const targetIds = new Set(usable.flatMap((t) => t.targets.map((n) => n.id)))
  const defLines = new Set(usable.flatMap((t) => t.targets.filter((n) => n.kind !== 'file').map((n) => `${n.repo}|${n.path}|${n.line}`)))
  const fileRow = g.db.prepare('SELECT * FROM files WHERE repo = ? AND path = ?')
  const around = g.db.prepare("SELECT id, kind, qualname, line, end_line FROM nodes WHERE file_id = ? AND kind != 'file' AND line <= ? AND end_line >= ? ORDER BY (end_line - line) ASC")
  const otherDef = g.db.prepare("SELECT 1 FROM nodes WHERE file_id = ? AND line = ? AND name = ? AND kind != 'file' LIMIT 1")
  const edgeTo = g.db.prepare("SELECT dst FROM edges WHERE src = ? AND kind IN ('CALLS','EXTENDS','IMPLEMENTS')")
  const refNamed = g.db.prepare('SELECT 1 FROM refs WHERE src_id = ? AND name = ? LIMIT 1')
  const importAt = g.db.prepare('SELECT resolved FROM imports WHERE file_id = ? AND line = ?')
  const shadow = new Set()
  const callsTarget = new Map()
  const reachesTarget = (id) => { if (!callsTarget.has(id)) callsTarget.set(id, edgeTo.all(id).some((e) => targetIds.has(e.dst))); return callsTarget.get(id) }

  for (const repo of project.repos) {
    const hits = grepRepo(repo.abs, usable.map((t) => t.term), project)
    const perTerm = new Map()
    for (const h of hits) for (const t of usable) if (new RegExp(`(^|[^\\p{L}\\p{N}_$])${esc(t.term)}(?![\\p{L}\\p{N}_$])`, 'u').test(h.text)) perTerm.set(t.term, (perTerm.get(t.term) || 0) + 1)
    const tooMany = new Set([...perTerm].filter(([, n]) => n > MAX_HITS).map(([t]) => t))
    for (const t of tooMany) res.common.push({ repo: repo.name, term: t, n: perTerm.get(t) })
    for (const h of hits) {
      if (SECRETISH.test(h.path) || skipped(h.path, project)) continue
      const terms = usable.filter((t) => !tooMany.has(t.term))
      let kind = null, term = null
      const f = fileRow.get(repo.name, h.path)
      const nodes = f ? around.all(f.id, h.line, h.line) : []
      for (const t of terms) {
        const re = new RegExp(`(^|[^\\p{L}\\p{N}_$])(${esc(t.term)})(?![\\p{L}\\p{N}_$])`, 'gu')
        let m
        while ((m = re.exec(h.text))) {
          const at = m.index + m[1].length
          let k
          const codeLang = f ? (f.lang === 'other' ? null : f.lang) : langOf(h.path) === 'other' ? null : langOf(h.path)
          if (!codeLang) { k = kindOfPath(h.path); if (k === 'config' && classify(h.text, at) === 'text') k = 'text' } // prose in a config value
          else if (!f) k = refine(h.text, at, t.term.length, classify(h.text, at, codeLang), t.targets[0].kind) // too large to index: read as text
          else {
            if (defLines.has(`${repo.name}|${h.path}|${h.line}`)) continue // the definition itself
            if (otherDef.get(f.id, h.line, t.term)) continue // another definition of the same name
            // an import line: resolved, its edge is in the graph; unresolved (an alias path, another
            // package or repository), it is a lead the graph cannot follow
            const imp = importAt.all(f.id, h.line)
            if (imp.length) { if (imp.some((i) => i.resolved)) continue; k = 'import' }
            // the line's enclosing definitions (or the file) already call the target, or carry an
            // unresolved site of that name (listed apart): explained
            else if ([...nodes.map((n) => n.id), f.node_id].some((id) => reachesTarget(id) || refNamed.get(id, t.term))) continue
            else k = refine(h.text, at, t.term.length, classify(h.text, at, f.lang), t.targets[0].kind)
            if (k === null) { if (nodes[0]) shadow.add(`${f.id}|${nodes[0].id}|${t.term}`); continue }
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
  res.hits = res.hits.filter((h) => !(h.scope && !['string', 'text', 'comment'].includes(h.kind) && shadow.has(h.scope)))
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
