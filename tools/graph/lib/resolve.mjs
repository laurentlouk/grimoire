// grimoire graph · resolution. Turns the extracted names of one repository into edges.
//
// There is no type checker here: a call `x.area()` is linked by NAME, narrowed by what the syntax
// and the imports say, and every edge records how it was linked, strongest first:
//   same-class    self/this call, or a bare call inside a class, to a member of that class
//                 (or of one of its supertypes)
//   typed         `x.m()` where the syntax states x's type (a typed parameter, `x = new T()`,
//                 see bindings.mjs), to a member of that type or of one of its supertypes
//   qualified     `Type.m()` / `Type::m()` to a member of a type of that name
//   import        the name (or its qualifier) is bound by an import of the calling file
//   same-file     defined in the calling file
//   same-package  defined in the calling file's directory (Go/Java/Kotlin/Swift/C# packages)
//   unique-name   the only definition of that name in the repository
//   ambiguous     one of ≤ MAX_AMBIGUOUS definitions of that name (each gets an edge)
//   path          an import resolved to a file by its path
// A name with more candidates than that, or on a receiver whose type the repository does not
// define, stays unresolved: most such calls go to the standard library or a dependency.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { familyOf } from './langs.mjs'

const MAX_AMBIGUOUS = 3
const CALLABLE = new Set(['function', 'method', 'constructor'])
const CLASSY = new Set(['class', 'struct', 'interface', 'trait', 'enum', 'protocol', 'module', 'object', 'type'])
const SELF = /^(self|this|Self|super|cls|static|\$this|@)$/
const noExt = (p) => p.replace(/\.[^./]+$/, '')

export function resolveRepo(db, repo, repoAbs) {
  const files = db.prepare('SELECT id, path, lang, node_id FROM files WHERE repo = ?').all(repo)
  const fileById = new Map(files.map((f) => [f.id, { ...f, family: familyOf(f.lang), dir: path.posix.dirname(f.path) }]))
  const nodes = db.prepare('SELECT n.id, n.file_id, n.kind, n.name, n.parent_id, n.container FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.repo = ?').all(repo)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  db.prepare('DELETE FROM edges WHERE src IN (SELECT n.id FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.repo = ?)').run(repo)

  // ── indexes ──
  const byName = new Map() // family|name → defs
  const add = (m, k, v) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]) }
  for (const n of nodes) if (n.kind !== 'file') add(byName, `${fileById.get(n.file_id).family}|${n.name}`, n)
  const fam = (fileId) => fileById.get(fileId).family
  const classesNamed = (family, name) => (byName.get(`${family}|${name}`) || []).filter((n) => CLASSY.has(n.kind))

  // Members declared in an `impl T` / `extension T` / receiver block: attach them to T.
  const setParent = db.prepare('UPDATE nodes SET parent_id = ? WHERE id = ?')
  for (const n of nodes) {
    if (n.parent_id || !n.container) continue
    const cands = classesNamed(fam(n.file_id), n.container)
    const t = cands.find((c) => c.file_id === n.file_id) || (cands.length === 1 ? cands[0] : null)
    if (t) { n.parent_id = t.id; setParent.run(t.id, n.id) }
  }
  const enclosingType = (n) => { for (let c = n; c; c = c.parent_id ? nodeById.get(c.parent_id) : null) if (c !== n && CLASSY.has(c.kind) && c.kind !== 'module') return c; return null }

  // ── imports → files ──
  const byPathNoExt = new Map(), byDir = new Map(), byBase = new Map()
  for (const f of fileById.values()) {
    add(byPathNoExt, noExt(f.path), f)
    add(byDir, f.dir, f)
    add(byBase, path.posix.basename(noExt(f.path)), f)
    if (/^(index|__init__|mod)$/.test(path.posix.basename(noExt(f.path)))) add(byPathNoExt, f.dir, f)
  }
  const sameFamily = (from, list) => (list || []).filter((f) => f.family === from.family)
  const exact = (from, p) => sameFamily(from, byPathNoExt.get(noExt(path.posix.normalize(p))))
  // Files whose path ends with segs (a/b/c → …/a/b/c.ext), nearest to the importer first.
  const suffix = (from, segs) => {
    if (!segs.length) return []
    const tail = segs.join('/')
    const hits = sameFamily(from, byBase.get(segs[segs.length - 1])).filter((f) => { const p = noExt(f.path); return p === tail || p.endsWith('/' + tail) || (/^(index|__init__|mod)$/.test(path.posix.basename(p)) && (f.dir === tail || f.dir.endsWith('/' + tail))) })
    const alsoDirs = sameFamily(from, byPathNoExt.get(tail) || [])
    const all = [...new Set([...hits, ...alsoDirs])]
    const common = (f) => { const a = from.path.split('/'), b = f.path.split('/'); let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
    return all.sort((x, y) => common(y) - common(x))
  }
  // go.mod is not an indexed language: read the module paths straight from disk.
  const goModules = []
  if (files.some((f) => f.lang === 'go')) {
    const dirs = new Set([...fileById.values()].filter((f) => f.family === 'go').map((f) => f.dir))
    for (const d of new Set([...dirs].flatMap((d) => { const up = []; for (let x = d; ; x = path.posix.dirname(x)) { up.push(x); if (x === '.' || x === '/') break } return up }))) {
      try { const m = /^module\s+(\S+)/m.exec(readFileSync(path.join(repoAbs, d, 'go.mod'), 'utf8')); if (m) goModules.push({ dir: d, module: m[1] }) } catch {}
    }
  }
  const namespaces = new Map()
  for (const n of nodes) if (n.kind === 'namespace') add(namespaces, n.name, fileById.get(n.file_id))

  function targetsOf(from, imp) {
    const s = imp.source, flags = imp.flags
    switch (from.family) {
      case 'js': {
        if (s.startsWith('.')) return exact(from, path.posix.join(from.dir, s)).slice(0, 1)
        const alias = /^(@|~|#)\/(.+)$/.exec(s) // tsconfig-style path aliases: @/x, ~/x
        return alias ? suffix(from, alias[2].split('/')).slice(0, 1) : []
      }
      case 'python': {
        const m = /^(\.*)(.*)$/.exec(s)
        const segs = m[2] ? m[2].split('.') : []
        if (m[1]) {
          let base = from.dir
          for (let i = 1; i < m[1].length; i++) base = path.posix.dirname(base)
          const mod = exact(from, path.posix.join(base, ...segs))
          const subs = imp.names.flatMap((n) => exact(from, path.posix.join(base, ...segs, n.split('=').pop())))
          return [...mod, ...subs]
        }
        const mod = suffix(from, segs).slice(0, 1)
        const subs = imp.names.flatMap((n) => suffix(from, [...segs, n.split('=').pop()]).slice(0, 1))
        return [...mod, ...subs]
      }
      case 'rust': {
        let segs = s.split('::')
        let base = null
        if (segs[0] === 'crate') { segs = segs.slice(1) } else if (segs[0] === 'self') { base = from.dir; segs = segs.slice(1) } else if (segs[0] === 'super') { base = path.posix.dirname(from.dir); segs = segs.slice(1) }
        if (flags.mod) { const own = path.posix.basename(noExt(from.path)); base = /^(mod|lib|main)$/.test(own) ? from.dir : path.posix.join(from.dir, own) }
        const tryPath = (ss) => (base !== null ? exact(from, path.posix.join(base, ...ss)) : suffix(from, ss).slice(0, 1))
        for (let k = segs.length; k > 0; k--) { const t = tryPath(segs.slice(0, k)); if (t.length) return t }
        return []
      }
      case 'go': {
        for (const gm of goModules) {
          if (s === gm.module || s.startsWith(gm.module + '/')) return sameFamily(from, byDir.get(path.posix.join(gm.dir, s.slice(gm.module.length + 1))) || [])
        }
        return sameFamily(from, byDir.get(s.split('/').slice(-2).join('/')) || [])
      }
      case 'jvm': {
        const segs = s.split('.')
        return flags.wildcard ? sameFamily(from, (byDir.get(segs.join('/')) || []).concat(...[...byDir.entries()].filter(([d]) => d.endsWith('/' + segs.join('/'))).map(([, fs]) => fs))) : suffix(from, segs).slice(0, 1)
      }
      case 'c': return flags.system ? suffix(from, noExt(s).split('/')).filter((f) => f.path.endsWith(s)).slice(0, 1) : [...exact(from, path.posix.join(from.dir, noExt(s))), ...suffix(from, noExt(s).split('/'))].filter((f) => f.path.endsWith(path.posix.basename(s))).slice(0, 1)
      case 'csharp': return namespaces.get(s) || []
      case 'ruby': return flags.relative ? exact(from, path.posix.join(from.dir, noExt(s))) : suffix(from, noExt(s).split('/')).slice(0, 1)
      case 'php': {
        if (flags.relative) return exact(from, path.posix.join(from.dir, noExt(s.replace(/^\//, '')))).slice(0, 1)
        const segs = s.split('\\').filter(Boolean)
        for (let k = 0; k <= Math.max(0, segs.length - 2); k++) { const t = suffix(from, segs.slice(k)).slice(0, 1); if (t.length) return t }
        return []
      }
      default: return []
    }
  }
  // Per file: what its imports bind. names: local → { orig, files }; quals: alias → files.
  const imports = db.prepare('SELECT i.id, i.file_id, i.source, i.names, i.alias, i.flags, i.line FROM imports i JOIN files f ON f.id = i.file_id WHERE f.repo = ?').all(repo)
  const bind = new Map()
  const bindingOf = (fid) => { if (!bind.has(fid)) bind.set(fid, { names: new Map(), quals: new Map(), files: new Set() }); return bind.get(fid) }
  const edgeIns = db.prepare('INSERT INTO edges(src, dst, kind, confidence, line) VALUES(?, ?, ?, ?, ?)')
  const setResolved = db.prepare('UPDATE imports SET resolved = ? WHERE id = ?')
  const importEdges = new Set()
  for (const imp of imports) {
    const from = fileById.get(imp.file_id)
    imp.names = JSON.parse(imp.names || '[]'); imp.flags = JSON.parse(imp.flags || '{}')
    const targets = targetsOf(from, imp).filter((t) => t.id !== from.id)
    setResolved.run(targets.length, imp.id)
    const b = bindingOf(from.id)
    for (const t of targets) {
      b.files.add(t.id)
      const k = `${from.node_id}|${t.node_id}`
      if (!importEdges.has(k)) { importEdges.add(k); edgeIns.run(from.node_id, t.node_id, 'IMPORTS', 'path', imp.line) }
    }
    const external = targets.length === 0
    for (const n of imp.names) { const [local, orig = local] = n.split('='); b.names.set(local, { orig, files: targets, external }) }
    if (imp.alias) b.quals.set(imp.alias, { files: targets, external })
    // `use std::fs; fs::read()`, `import a.b.Helper; Helper.help()`: an imported name used as a qualifier.
    for (const n of imp.names) { const [local] = n.split('='); if (!b.quals.has(local)) b.quals.set(local, { files: targets, external }) }
  }

  // ── refs → edges ──
  // Supertypes first: `typed` and `same-class` resolution climb them to find inherited members.
  const refs = db.prepare('SELECT r.file_id, r.src_id, r.kind, r.name, r.qual, r.qtype, r.from_type, r.line FROM refs r JOIN files f ON f.id = r.file_id WHERE f.repo = ?').all(repo)
    .sort((a, b) => (a.kind === 'extends' || a.kind === 'implements' ? 0 : 1) - (b.kind === 'extends' || b.kind === 'implements' ? 0 : 1))
  const supers = new Map()
  // Members of `types` named like the candidates, else of their supertypes, nearest level first:
  // an override shadows what it overrides.
  const membersUp = (types, cands) => {
    const seenT = new Set(types.map((t) => t.id))
    let level = [...seenT]
    for (let d = 0; d < 5 && level.length; d++) {
      const hit = cands.filter((c) => level.includes(c.parent_id))
      if (hit.length) return hit
      const next = []
      for (const id of level) for (const sup of supers.get(id) || []) if (!seenT.has(sup)) { seenT.add(sup); next.push(sup) }
      level = next
    }
    return []
  }
  const seen = new Set()
  const emit = (src, dst, kind, conf, line) => { const k = `${src}|${dst}|${kind}`; if (seen.has(k) || src === dst && kind !== 'CALLS') return; seen.add(k); edgeIns.run(src, dst, kind, conf, line) }
  const inFiles = (cands, files) => cands.filter((c) => files.some((f) => f.id === c.file_id))
  const stats = { calls: 0, resolved: 0 }

  for (const r of refs) {
    const from = fileById.get(r.file_id)
    const b = bind.get(from.id) || { names: new Map(), quals: new Map(), files: new Set() }
    if (r.kind === 'extends' || r.kind === 'implements') {
      const src = r.from_type ? (classesNamed(from.family, r.from_type).find((c) => c.file_id === from.id) || classesNamed(from.family, r.from_type)[0]) : nodeById.get(r.src_id)
      if (!src) continue
      const bound = b.names.get(r.name)
      const name = bound ? bound.orig : r.name
      const cands = classesNamed(from.family, name).filter((c) => c.id !== src.id)
      const pick = pickBy(cands, [
        ['same-file', (c) => c.file_id === from.id],
        ['import', (c) => (bound ? bound.files.some((f) => f.id === c.file_id) : b.files.has(c.file_id))],
        ['same-package', (c) => fileById.get(c.file_id).dir === from.dir],
      ])
      if (pick) for (const c of pick.nodes) { emit(src.id, c.id, r.kind === 'extends' ? 'EXTENDS' : 'IMPLEMENTS', pick.conf, r.line); add(supers, src.id, c.id) }
      continue
    }

    stats.calls++
    const srcNode = nodeById.get(r.src_id)
    const bound = !r.qual && b.names.get(r.name)
    if (bound && bound.external) continue // imported from a dependency
    const name = bound ? bound.orig : r.name
    let cands = (byName.get(`${from.family}|${name}`) || []).filter((c) => (r.kind === 'macro' ? c.kind === 'macro' : r.kind === 'new' ? CLASSY.has(c.kind) || c.kind === 'constructor' : CALLABLE.has(c.kind) || CLASSY.has(c.kind)))
    if (!cands.length) continue
    const qual = r.qual || ''
    const qHead = qual.split(/::|\.|->|\\/)[0]
    const qLast = qual.split(/::|\.|->|\\/).pop()
    const selfType = srcNode ? enclosingType(srcNode) : null
    let pick = null

    if (r.qtype && !SELF.test(qual)) {
      const types = classesNamed(from.family, r.qtype)
      if (types.length) {
        const members = membersUp(types, cands)
        if (!members.length) continue // a method the repo's own types do not declare: inherited from a dependency
        pick = { nodes: members.slice(0, MAX_AMBIGUOUS), conf: 'typed' }
      } else if (!(byName.get(`${from.family}|${r.qtype}`) || []).length) continue // a dependency's type (HashMap, List, Request …)
    }
    if (!pick && (SELF.test(qual) || (!qual && selfType))) {
      const own = selfType ? membersUp([selfType], cands) : []
      if (own.length) pick = { nodes: own, conf: 'same-class' }
      else if (SELF.test(qual)) pick = pickBy(cands.filter((c) => c.parent_id && nodeById.get(c.parent_id) && CLASSY.has(nodeById.get(c.parent_id).kind)), [['same-file', (c) => c.file_id === from.id]])
    }
    if (!pick && qual && !SELF.test(qual)) {
      const q = b.quals.get(qHead) || b.quals.get(qual)
      if (q) {
        if (q.external) continue
        const hit = inFiles(cands, q.files)
        const members = cands.filter((c) => { const p = c.parent_id && nodeById.get(c.parent_id); return p && p.name === qLast && q.files.some((f) => f.id === p.file_id) })
        if (members.length) pick = { nodes: members, conf: 'qualified' }
        else if (hit.length) pick = { nodes: hit.slice(0, MAX_AMBIGUOUS), conf: 'import' }
      }
      if (!pick) {
        const types = classesNamed(from.family, qLast)
        const members = cands.filter((c) => types.some((t) => t.id === c.parent_id))
        if (members.length) pick = { nodes: members.slice(0, MAX_AMBIGUOUS), conf: members.length === 1 || types.length === 1 ? 'qualified' : 'ambiguous' }
        else if (/^[A-Z]/.test(qLast) && !types.length && !/[.(]/.test(qual)) continue // a type the repo does not define: a dependency
      }
      if (!pick) {
        const methods = cands.filter((c) => c.kind === 'method' || c.kind === 'constructor' || (c.parent_id && CLASSY.has(nodeById.get(c.parent_id)?.kind)))
        pick = pickBy(methods, [['same-file', (c) => c.file_id === from.id], ['import', (c) => b.files.has(c.file_id)]])
      }
    }
    if (!pick && !qual) {
      pick = pickBy(cands, [
        ['import', (c) => bound && bound.files.some((f) => f.id === c.file_id)],
        ['same-file', (c) => c.file_id === from.id && !c.parent_id],
        ['import', (c) => b.files.has(c.file_id) && !c.parent_id],
        ['same-package', (c) => fileById.get(c.file_id).dir === from.dir && !c.parent_id && /^(go|jvm|swift|csharp)$/.test(from.family)],
      ], (c) => !c.parent_id || CLASSY.has(c.kind))
    }
    if (!pick) continue
    stats.resolved++
    const src = srcNode ? srcNode.id : from.node_id
    for (const c of pick.nodes) emit(src, c.id, 'CALLS', pick.conf, r.line)
  }
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(`calls:${repo}`, JSON.stringify(stats))
}

// First rule that matches wins; otherwise a unique candidate, otherwise ≤ MAX_AMBIGUOUS of them.
function pickBy(cands, rules, fallbackFilter = () => true) {
  if (!cands.length) return null
  for (const [conf, test] of rules) { const hit = cands.filter(test); if (hit.length) return { nodes: hit.slice(0, MAX_AMBIGUOUS), conf: hit.length === 1 ? conf : 'ambiguous' } }
  const rest = cands.filter(fallbackFilter)
  if (rest.length === 1) return { nodes: rest, conf: 'unique-name' }
  if (rest.length > 1 && rest.length <= MAX_AMBIGUOUS) return { nodes: rest, conf: 'ambiguous' }
  return null
}
