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
//   import-guess  a method on a receiver of unknown type, picked because its file is imported:
//                 a name guess (counted with unique-name and ambiguous, hidden like ambiguous)
//   unique-name   the only definition of that name in the repository
//   ambiguous     one of ≤ MAX_AMBIGUOUS definitions of that name (each gets an edge)
//   path          an import resolved to a file by its path
// A name with more candidates than that, on a receiver whose type the repository does not define,
// or a standard-library method name (COMMON_METHODS) on a receiver whose type the syntax does not
// state, stays unresolved: most such calls go to the standard library or a dependency. So does a call
// qualified by a repository type that declares no member of that name, itself or up its supertypes
// (`Story.where`, `Hat.active` with no scope of that name): it is inherited from a framework. So does
// `super.m()` / `super().m()` the class's supertypes in the repository do not declare (same-class when
// they do), a call on a JavaScript runtime object (`console`, `window`, `JSON` …), a call typed by a
// name the file imports from a dependency, and a JavaScript name whose import resolved to a repository
// file that defines nothing by it (never a guess elsewhere). A name guess for production code never
// lands on test-support code (a mock, a fixture, a story).
//
// A field (a class's annotated attribute, a TypeScript field) and a member a framework call declares
// (Ruby `scope`, `has_many`, `attr_reader`, `delegate`: node via 'framework') are reached only by
// syntax: a typed, self or type-qualified call (`self.order_created()`, `plugin.order_created()`,
// `Story.active`, `story.user`), never by a name alone. Their names (`id`, `user`, `order`, `active`)
// are what every model declares; an untyped `x.id` is no more this class's than another's.
//
// REFERENCES: a function or method named as a value (an argument, a property value, an assignment's
// right side, a return, `task.delay()`), from the definition naming it. Linked only by syntax, with the
// call's confidences: same-class (`self.on_done`, a Ruby symbol), typed, qualified, import, same-file,
// same-package; never by a unique or ambiguous name (a bare name in a value position is as often a
// local or a dependency's as the repository's function).
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { familyOf, COMMON_METHODS } from './langs.mjs'
import { jsModules, platformBase } from './js-modules.mjs'
import { listPaths, SKIP_DIRS, readRepoText } from './project.mjs'
import { linkContracts } from './contracts.mjs'

const MAX_AMBIGUOUS = 3
// The confidences that are name guesses: graph_status's share, the overview's "most used" and the
// page's links resolved by syntax leave them out; `strict` and the page's default hide the last two.
export const GUESSES = ['unique-name', 'ambiguous', 'import-guess']
export const HIDDEN_GUESSES = ['ambiguous', 'import-guess']
export const guessSql = (list = GUESSES) => `(${list.map((c) => `'${c}'`).join(',')})`
const IMPLICIT_SELF = new Set(['jvm', 'csharp', 'swift', 'c', 'ruby'])
const CALLABLE = new Set(['function', 'method', 'constructor'])
const REFERABLE = new Set(['function', 'method'])
const CLASSY = new Set(['class', 'struct', 'interface', 'trait', 'enum', 'protocol', 'module', 'object', 'type'])
const TYPE_ONLY = new Set(['type', 'interface'])
const SELF = /^(self|this|Self|super|cls|static|\$this|@)$/
// the runtime's own objects in JavaScript: a call on one is the platform's, never the repository's
// the runtime's own functions and constructors, called bare (`Error(…)`, `new Map()`, `fetch(…)`)
const JS_BUILTINS = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Date', 'Promise', 'Symbol', 'Number', 'String', 'Boolean', 'BigInt', 'Array', 'Object', 'RegExp', 'Proxy', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader', 'FormData', 'Headers', 'Request', 'Response', 'AbortController', 'TextEncoder', 'TextDecoder', 'Image', 'Event', 'CustomEvent', 'Worker', 'WebSocket', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'queueMicrotask', 'structuredClone', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'atob', 'btoa', 'require'])
const JS_GLOBALS = new Set(['console', 'window', 'document', 'globalThis', 'global', 'process', 'navigator', 'JSON', 'Math', 'Promise', 'Object', 'Array', 'Reflect', 'Intl', 'Date', 'Number', 'String', 'jest'])
const noExt = (p) => p.replace(/\.[^./]+$/, '')

// rels: the repository's file list (project.mjs listPaths), when the caller has it already.
export function resolveRepo(db, repo, repoAbs, rels = null) {
  const files = db.prepare('SELECT id, path, lang, node_id, is_test FROM files WHERE repo = ?').all(repo)
  const fileById = new Map(files.map((f) => [f.id, { ...f, family: familyOf(f.lang), dir: path.posix.dirname(f.path) }]))
  const nodes = db.prepare('SELECT n.id, n.file_id, n.kind, n.name, n.parent_id, n.container, n.via, n.is_test FROM nodes n JOIN files f ON f.id = n.file_id WHERE f.repo = ?').all(repo)
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
  // go.mod is not an indexed language: read the module paths from disk, guarded (project.mjs readRepoText)
  let realRoot
  const repoReal = () => { if (realRoot === undefined) { try { realRoot = realpathSync(repoAbs) } catch { realRoot = null } } return realRoot }
  const goModules = []
  if (files.some((f) => f.lang === 'go')) {
    const dirs = new Set([...fileById.values()].filter((f) => f.family === 'go').map((f) => f.dir))
    for (const d of new Set([...dirs].flatMap((d) => { const up = []; for (let x = d; ; x = path.posix.dirname(x)) { up.push(x); if (x === '.' || x === '/') break } return up }))) {
      const m = /^module\s+(\S+)/m.exec(readRepoText(repoAbs, path.posix.join(d, 'go.mod'), { root: repoReal() }) || ''); if (m) goModules.push({ dir: d, module: m[1] })
    }
  }
  const namespaces = new Map()
  for (const n of nodes) if (n.kind === 'namespace') add(namespaces, n.name, fileById.get(n.file_id))
  // JavaScript and TypeScript: the bundler's view (js-modules.mjs), from every file of the repository
  // (a configuration, an image, a JSON file is no indexed file but can be imported)
  const resolveJs = files.some((f) => familyOf(f.lang) === 'js')
    ? jsModules({ files: [...fileById.values()], paths: (rels || listPaths(repoAbs)).filter((p) => !p.split('/').some((x) => SKIP_DIRS.has(x))), abs: repoAbs })
    : null
  const outside = new Set() // imports naming a file of the repository the index does not hold
  // One definition in its platform variants (Button.ios.tsx, Button.android.tsx, Button.web.tsx, the
  // same name in the same place): one candidate, every variant linked, never an ambiguity among them.
  const variantOf = (c) => {
    const f = fileById.get(c.file_id)
    return f.family === 'js' ? `${resolveJs.moduleOf(f.id) || platformBase(f.path)}|${c.parent_id ? nodeById.get(c.parent_id)?.name : ''}|${c.name}` : c.id
  }

  function targetsOf(from, imp) {
    const s = imp.source, flags = imp.flags
    switch (from.family) {
      case 'js': {
        const r = resolveJs(from, s)
        if (r.outside) outside.add(imp.id)
        return r.files
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
      case 'proto': return [...exact(from, path.posix.join(from.dir, noExt(s))), ...suffix(from, noExt(s).split('/'))].slice(0, 1)
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
  // spaces: the names a namespace import binds (`import * as UI`, `const ui = require('./ui')`)
  const bindingOf = (fid) => { if (!bind.has(fid)) bind.set(fid, { names: new Map(), quals: new Map(), files: new Set(), spaces: new Set() }); return bind.get(fid) }
  const edgeIns = db.prepare('INSERT INTO edges(src, dst, kind, confidence, line) VALUES(?, ?, ?, ?, ?)')
  const setResolved = db.prepare('UPDATE imports SET resolved = ? WHERE id = ?')
  const importEdges = new Set()
  for (const imp of imports) {
    const from = fileById.get(imp.file_id)
    imp.names = JSON.parse(imp.names || '[]'); imp.flags = JSON.parse(imp.flags || '{}')
    const targets = targetsOf(from, imp).filter((t) => t.id !== from.id)
    setResolved.run(targets.length || (outside.has(imp.id) ? -1 : 0), imp.id) // -1: a file outside the index
    const b = bindingOf(from.id)
    for (const t of targets) {
      b.files.add(t.id)
      const k = `${from.node_id}|${t.node_id}`
      if (!importEdges.has(k)) { importEdges.add(k); edgeIns.run(from.node_id, t.node_id, 'IMPORTS', 'path', imp.line) }
    }
    const external = targets.length === 0
    for (const n of imp.names) { const [local, orig = local] = n.split('='); b.names.set(local, { orig, files: targets, external }) }
    if (imp.alias) { b.quals.set(imp.alias, { files: targets, external }); b.spaces.add(imp.alias) }
    // `use std::fs; fs::read()`, `import a.b.Helper; Helper.help()`: an imported name used as a qualifier.
    for (const n of imp.names) { const [local] = n.split('='); if (!b.quals.has(local)) b.quals.set(local, { files: targets, external }) }
  }

  // ── refs → edges ──
  // Supertypes first: `typed` and `same-class` resolution climb them to find inherited members.
  const allRefs = db.prepare('SELECT r.file_id, r.src_id, r.kind, r.name, r.qual, r.qtype, r.from_type, r.line FROM refs r JOIN files f ON f.id = r.file_id WHERE f.repo = ?').all(repo)
  // a contract hint (code implementing an API contract) and a GraphQL selection are linked apart,
  // once every call is (contracts.mjs linkContracts)
  const contractRefs = allRefs.filter((r) => r.kind === 'contract' || r.kind === 'select')
  // `export const X = Y` (Y a name the file imports): X is Y under another name, followed like a barrel's
  // re-export (extract.mjs records it as an `alias` ref)
  const aliases = new Map()
  for (const r of allRefs) if (r.kind === 'alias') { if (!aliases.has(r.file_id)) aliases.set(r.file_id, new Map()); aliases.get(r.file_id).set(r.name, r.qual) }
  const refs = allRefs.filter((r) => r.kind !== 'contract' && r.kind !== 'select' && r.kind !== 'alias')
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
  // a definition of `name` in one of `fs` of the kinds `ok` takes (by default, what a value can be: a
  // TypeScript type or interface is none)
  const VALUE_KIND = (c) => !TYPE_ONLY.has(c.kind)
  const definesIn = (fs, name, ok = VALUE_KIND) => (byName.get(`js|${name}`) || []).some((c) => ok(c) && fs.some((f) => f.id === c.file_id))
  // Where a JavaScript barrel takes `name` from, up to three files deep: `export { X } from './x'`,
  // `export * from './x'`, `export { Y as X } from './y'`, `export const X = Y` with Y imported. The
  // files that define it and the name they define it by ({ files: [] } when none does); null when one of
  // them takes it from a dependency.
  const reexported = (files, name, ok = VALUE_KIND) => {
    let level = files.map((f) => [f, name])
    for (let d = 0; d < 3; d++) {
      const next = new Map()
      for (const [f, nm] of level) {
        const bb = bind.get(f.id)
        if (!bb) continue
        let n = bb.names.get(nm)
        const y = !n && aliases.get(f.id)?.get(nm)
        if (y && y.includes('.')) { // `export const Slot = Header.Slot`: a member of a namespace the file imports,
          // or of a value of its own (`const group = createGroup(); export const Provider = group.Provider`)
          const q = bb.quals.get(y.slice(0, y.indexOf('.'))), last = y.split('.').pop()
          if (q && q.external) return null
          // (a value of its own: only a definition of the file by that name, the factory's, is it)
          for (const t of q ? q.files : definesIn([f], last, ok) ? [f] : []) next.set(`${t.id}|${last}`, [t, last])
          continue
        }
        if (y) n = bb.names.get(y)
        if (n) { if (n.external) return null; for (const t of n.files) next.set(`${t.id}|${n.orig}`, [t, n.orig]) } else for (const id of bb.files) next.set(`${id}|${nm}`, [fileById.get(id), nm])
      }
      level = [...next.values()]
      const hit = level.filter(([f, nm]) => definesIn([f], nm, ok))
      if (hit.length) { const nm = hit[0][1]; return { files: hit.filter((h) => h[1] === nm).map((h) => h[0]), name: nm } }
      if (!level.length) break
    }
    return { files: [], name }
  }
  // An imported name in JavaScript: the files defining it and the name they define it by, through barrels
  // and aliases; null for a dependency's
  const importedAs = (bound, name, family, ok = VALUE_KIND) => {
    if (family !== 'js' || !bound.files.length || definesIn(bound.files, name, ok)) return { files: bound.files, name }
    return reexported(bound.files, name, ok)
  }
  // A receiver that starts at a type the repository does not define (`Utc::now().timestamp()`,
  // `UpdateItemOutput::builder().build()`, `new Intl.NumberFormat(..).format()`) or, in Rust, at a
  // crate the repository does not have (`chrono::Utc::now()`, `std::env::var`) yields a dependency's
  // value: its methods are the dependency's, whatever the repository names the same. Only the path
  // before the first call counts, segment by segment: a call heading it to the repository's own
  // constructor or factory, or a repository type, namespace or module among its scopes, keeps the
  // chain in the repository, except that a Rust path is decided by its root alone (crate/self/super,
  // a repository module, or the crate's own Cargo.toml names). SCREAMING_CASE heads are constants, and a
  // property path with no call (`Api.users`, `App\Models\User`) is left to the rules below.
  const moduleNames = new Set([...fileById.values()].flatMap((f) => [path.posix.basename(noExt(f.path)), ...f.dir.split('/')]).flatMap((m) => [m, m.replace(/-/g, '_')]))
  for (const n of nodes) if (n.kind === 'module') moduleNames.add(n.name)
  if (files.some((f) => f.lang === 'rust')) { // a crate is named by its Cargo.toml, not its folder (`lib/` → `my_lib`)
    const dirs = new Set([...fileById.values()].filter((f) => f.family === 'rust').flatMap((f) => { const up = []; for (let x = f.dir; ; x = path.posix.dirname(x)) { up.push(x); if (x === '.' || x === '/') break } return up }))
    for (const d of dirs) {
      const toml = readRepoText(repoAbs, path.posix.join(d, 'Cargo.toml'), { root: repoReal() })
      if (toml === null) continue
      const tables = toml.split(/^[ \t]*\[/m) // each table up to the next header
      for (const t of tables.filter((sec) => /^(package|lib)\]/.test(sec))) { const m = /^\s*name\s*=\s*"([^"]+)"/m.exec(t); if (m) moduleNames.add(m[1].replace(/-/g, '_')) }
      for (const t of tables.filter((sec) => /^(dev-|build-)?dependencies\]/.test(sec))) for (const m of t.matchAll(/^\s*([\w-]+)\s*=\s*\{[^}\n]*\bpath\s*=/gm)) moduleNames.add(m[1].replace(/-/g, '_')) // a local path crate
    }
  }
  const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*/u
  const isRepoScope = (family, name) => moduleNames.has(name) || (byName.get(`${family}|${name}`) || []).some((c) => CLASSY.has(c.kind) || c.kind === 'namespace')
  const startsInDependency = (qual, family) => {
    const constructed = /^new\s/.test(qual), lead = qual.replace(/^(new|await)\s+/, '')
    const cut = lead.indexOf('(')
    const segs = (cut < 0 ? lead : lead.slice(0, cut)).split(/::|\.|->|\\/).map((x) => (IDENT.exec(x.replace(/^[\s?!]+/, '')) || [''])[0]).filter(Boolean)
    // the segment called first (`builder` in `Output::builder()`) is a function, not a scope; after
    // `new`, the whole path names a type
    const scopes = cut >= 0 && !constructed ? segs.slice(0, -1) : segs
    if (!segs.length || SELF.test(segs[0])) return false
    const head = segs[0]
    // `Order().total()`, `NewServer(80).Start()`, `Meters(5.0).double_it()`: the call heading the
    // chain is the repository's own constructor or factory
    if (segs.length === 1 && cut >= 0 && (byName.get(`${family}|${head}`) || []).length) return false
    // a Rust path is decided by its root: `aws_sdk::types::error::X` is the crate's even where the
    // repository has an `error` module (a turbofish `make::<T>()` is not a path)
    if (family === 'rust' && /^[\p{Ll}_]/u.test(head) && lead.startsWith(head + '::') && lead[head.length + 2] !== '<') return !/^(crate|self|super)$/.test(head) && !moduleNames.has(head)
    if (scopes.some((x) => isRepoScope(family, x))) return false
    return cut >= 0 && /^\p{Lu}/u.test(head) && /\p{Ll}/u.test(head)
  }
  // The type a receiver constructs, when the syntax says so: `new Store()`, `Store()`, `Store::new()`,
  // `crate::geo::Store::new()`, `Reg.getInstance()`, `Store.shared`, `(new Util())`. One call at
  // most, ending the receiver; the type is the last segment the repository defines as a type.
  const constructedType = (qual, family) => {
    let q = qual.trim()
    while (/^\(.*\)$/s.test(q) && balanced(q.slice(1, -1))) q = q.slice(1, -1).trim()
    const isNew = /^new\s/.test(q)
    q = q.replace(/^new\s+/, '')
    for (let prev; prev !== q;) { prev = q; q = q.replace(/<[^<>]*>/g, '') } // generics
    const open = q.indexOf('(')
    if (open >= 0 && (!q.endsWith(')') || !balanced(q.slice(open + 1, -1)))) return null
    const segs = (open >= 0 ? q.slice(0, open) : q).split(/::|\.|->|\\/).map((x) => (IDENT.exec(x.trim()) || [''])[0])
    if (!segs.length || segs.some((x) => !x)) return null
    for (const x of isNew ? [segs[segs.length - 1]] : segs.slice().reverse()) if (classesNamed(family, x).length) return x
    return null
  }
  const balanced = (t) => { let d = 0; for (const ch of t) { if (ch === '(') d++; else if (ch === ')' && --d < 0) return false } return d === 0 }
  const SELF_CLASS = /^(self\.class|self\.__class__|type\(self\)|this\.constructor)$/ // the class of `self`
  const superCall = (qual, family) => /^super\([^()]*\)$/.test(qual) || (family === 'php' && qual === 'parent')
  const stats = { calls: 0, resolved: 0, values: 0, referenced: 0 }
  // a node and its enclosing definitions: a nested function is named from inside its parent
  const within = (n, anc) => { for (let c = n; c; c = c.parent_id ? nodeById.get(c.parent_id) : null) if (c.id === anc) return true; return false }
  // c is a function nested in a definition enclosing `src` (a closure it can reach by its bare name), not a member
  const nestedFor = (src, c) => !!src && !!c.parent_id && within(src, c.parent_id) && !CLASSY.has(nodeById.get(c.parent_id)?.kind)
  // the first rule that matches, and nothing on a name alone (a definition's platform variants count once)
  const firstRule = (cands, rules) => pickBy(cands, rules, () => false, variantOf)
  const isTest = (n) => !!(n.is_test || fileById.get(n.file_id)?.is_test)
  const superTypes = (t) => (supers.get(t.id) || []).map((id) => nodeById.get(id)).filter(Boolean)
  // The repository's types a stated type names, for a caller (`prod`: production code). null: the
  // type is not the repository's (imported from a dependency; in JavaScript, imported from a file that
  // defines no type of that name, through its barrels; only test-support code defines it, as a mock
  // does). [] when no type has that name at all.
  const typesOf = (qtype, from, b, prod) => {
    const dot = qtype.indexOf('.')
    if (dot > 0) { // `new FileSystem.File(…)`: a type read from a namespace, a dependency's or one the file imports
      const q = b.quals.get(qtype.slice(0, dot))
      if (q && q.external) return null
      let types = classesNamed(from.family, qtype.slice(qtype.lastIndexOf('.') + 1))
      if (q) types = types.filter((t) => q.files.some((f) => f.id === t.file_id))
      if (prod) types = types.filter((t) => !isTest(t))
      return types.length ? types : null
    }
    const qb = b.names.get(qtype)
    if (qb && qb.external) return null
    let name = qb ? qb.orig : qtype
    let types = classesNamed(from.family, name)
    if (qb && qb.files.length) {
      if (from.family === 'js') {
        const at = importedAs(qb, name, 'js', (c) => CLASSY.has(c.kind))
        if (!at) return null
        name = at.name
        types = classesNamed(from.family, name).filter((t) => at.files.some((f) => f.id === t.file_id))
        if (!types.length) return null
      } else { const own = types.filter((t) => qb.files.some((f) => f.id === t.file_id)); if (own.length) types = own }
    }
    if (prod && types.length) { types = types.filter((t) => !isTest(t)); if (!types.length) return null }
    return types
  }
  // `super.m()`, `super().m()`, `parent::m()`: a member of the calling class's supertypes, never its own
  const isSuper = (qual, family) => qual === 'super' || superCall(qual, family)
  // (never the class's own member, even where a supertype guessed by name leads back to the class)
  const superMembers = (selfType, cands) => { const ups = selfType ? superTypes(selfType).filter((t) => t.id !== selfType.id) : []; return ups.length ? membersUp(ups, cands.filter((c) => c.parent_id !== selfType.id)) : [] }

  // A value naming a function or method (REFERENCES): resolved by syntax only, as a call would be.
  const referenced = (r, from, b) => {
    const srcNode = nodeById.get(r.src_id)
    // a namespace (`<Button.Button>`, `UI.Row` passed on) is no value of a function named like it
    if (!r.qual && b.spaces.has(r.name)) return null
    const bound = !r.qual && b.names.get(r.name)
    if (bound && bound.external) return null
    let name = bound ? bound.orig : r.name
    let boundFiles = bound ? bound.files : null
    if (bound && boundFiles.length) { const at = importedAs(bound, name, from.family); if (!at) return null; boundFiles = at.files; name = at.name }
    const cands = (byName.get(`${from.family}|${name}`) || []).filter((c) => REFERABLE.has(c.kind) && !(srcNode && c.id === srcNode.id))
    if (!cands.length) return null
    const qual = r.qual || ''
    if (!qual) {
      return firstRule(cands, [
        ['import', (c) => bound && boundFiles.some((f) => f.id === c.file_id)],
        // a function of this file: nested in a definition enclosing the one naming it (it shadows the
        // file's own of that name), else top-level
        ['same-file', (c) => c.file_id === from.id && nestedFor(srcNode, c)],
        ['same-file', (c) => c.file_id === from.id && !c.parent_id],
        // a name the file never imports is no function of an imported JavaScript module (each name is
        // imported by itself there); a C header, a Ruby or PHP require brings in all of a file's names
        ['import', (c) => !bound && from.family !== 'js' && b.files.has(c.file_id) && !c.parent_id],
        ['same-package', (c) => fileById.get(c.file_id).dir === from.dir && !c.parent_id && /^(go|jvm|swift|csharp)$/.test(from.family)],
      ])
    }
    const selfType = srcNode ? (CLASSY.has(srcNode.kind) && srcNode.kind !== 'module' ? srcNode : enclosingType(srcNode)) : null
    if (isSuper(qual, from.family)) { const up = superMembers(selfType, cands); return up.length ? { nodes: up.slice(0, MAX_AMBIGUOUS), conf: 'same-class' } : null }
    if (SELF.test(qual)) { const own = selfType ? membersUp([selfType], cands) : []; return own.length ? { nodes: own.slice(0, MAX_AMBIGUOUS), conf: 'same-class' } : null }
    if (r.qtype) { const types = typesOf(r.qtype, from, b, !(srcNode ? isTest(srcNode) : from.is_test)); const m = types && types.length ? membersUp(types, cands) : []; return m.length ? { nodes: m.slice(0, MAX_AMBIGUOUS), conf: 'typed' } : null }
    const segs = qual.split(/::|\?\.|\.|->|\\/)
    const q = b.quals.get(segs[0]) || b.quals.get(qual)
    if (q) {
      if (q.external) return null
      const qLast = segs[segs.length - 1]
      const members = cands.filter((c) => { const p = c.parent_id && nodeById.get(c.parent_id); return p && p.name === qLast && q.files.some((f) => f.id === p.file_id) })
      if (members.length) return { nodes: members.slice(0, MAX_AMBIGUOUS), conf: 'qualified' }
      const hit = segs.length === 1 ? inFiles(cands, q.files).filter((c) => !c.parent_id || !CLASSY.has(nodeById.get(c.parent_id)?.kind)) : []
      return firstRule(hit, [['import', () => true]])
    }
    const types = classesNamed(from.family, segs[segs.length - 1])
    const m = types.length ? membersUp(types, cands) : []
    return m.length ? { nodes: m.slice(0, MAX_AMBIGUOUS), conf: m.length === 1 || types.length === 1 ? 'qualified' : 'ambiguous' } : null
  }

  for (let r of refs) {
    const from = fileById.get(r.file_id)
    const b = bind.get(from.id) || { names: new Map(), quals: new Map(), files: new Set(), spaces: new Set() }
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
      ], undefined, variantOf)
      if (pick) for (const c of pick.nodes) { emit(src.id, c.id, r.kind === 'extends' ? 'EXTENDS' : 'IMPLEMENTS', pick.conf, r.line); add(supers, src.id, c.id) }
      continue
    }

    if (r.kind === 'ref') {
      stats.values++
      const pick = referenced(r, from, b)
      if (!pick) continue
      stats.referenced++
      const src = r.src_id && nodeById.get(r.src_id) ? r.src_id : from.node_id
      for (const c of pick.nodes) emit(src, c.id, 'REFERENCES', pick.conf, r.line)
      continue
    }

    stats.calls++
    // `const Slot = Header.Slot` (or `= Canonical`) at module level, then `<Slot>`: the call is the aliased one's
    const aliased = !r.qual && from.family === 'js' && !b.names.has(r.name) ? aliases.get(from.id)?.get(r.name) : null
    if (aliased) {
      const dot = aliased.indexOf('.')
      if (dot > 0 && !b.quals.has(aliased.slice(0, dot))) continue // a member of a value of the file's own: no definition
      r = dot > 0 ? { ...r, name: aliased.slice(dot + 1), qual: aliased.slice(0, dot), qtype: null } : { ...r, name: aliased }
    }
    const srcNode = nodeById.get(r.src_id)
    const prod = !(srcNode ? isTest(srcNode) : from.is_test)
    const bound = !r.qual && b.names.get(r.name)
    if (bound && bound.external) continue // imported from a dependency
    let name = bound ? bound.orig : r.name
    // a name imported from a file that only passes it on (`export { X } from './x'`, `export * from`,
    // `export const X = Y`): the files it passes on from, and the name they define; a dependency's
    // (`export { Text as Span } from 'react-native'`): no link
    let boundFiles = bound ? bound.files : null
    if (bound && boundFiles.length) { const at = importedAs(bound, name, from.family); if (!at) continue; boundFiles = at.files; name = at.name }
    // a TypeScript type or interface is no value: never called, never rendered
    const named_ = (byName.get(`${from.family}|${name}`) || []).filter((c) => !(from.family === 'js' && TYPE_ONLY.has(c.kind)))
    let cands = named_.filter((c) => (r.kind === 'macro' ? c.kind === 'macro' : r.kind === 'new' ? CLASSY.has(c.kind) || c.kind === 'constructor' : CALLABLE.has(c.kind) || CLASSY.has(c.kind)))
    // fields join only where the syntax names their owner (typed, self, a type's name); so do the
    // members a framework declares, which no rule below links by a name alone. A field of test-support
    // code (a mock's `write = jest.fn()`) is no production caller's callee.
    const withFields = r.kind === 'call' ? cands.concat(named_.filter((c) => c.kind === 'field' && !(prod && isTest(c)))) : cands
    const guess = cands.filter((c) => !c.via)
    if (!withFields.length) continue
    const qual = r.qual || ''
    const qHead = qual.split(/::|\.|->|\\/)[0]
    const qLast = qual.split(/::|\.|->|\\/).pop()
    const selfType = srcNode ? enclosingType(srcNode) : null
    // a name guess for production code never links a definition of test-support code (a mock, a
    // fixture), though it counts among the candidates: dropping it never makes a guess of the rest
    // (nor does a bare call link a method no class holds, `window.scrollTo = …`, which still counts)
    const prodGuess = (c) => !(prod && isTest(c))
    let pick = null

    // `super.save()`, `super().save()`: the supertypes' member, or none the repository defines
    if (isSuper(qual, from.family)) {
      const up = superMembers(selfType, withFields)
      if (!up.length) continue
      pick = { nodes: up.slice(0, MAX_AMBIGUOUS), conf: 'same-class' }
    }
    if (!pick && r.qtype && !SELF.test(qual)) {
      const types = typesOf(r.qtype, from, b, prod)
      if (!types) continue // a dependency's type (`Logger` from a logging library, a framework's `File`)
      if (types.length) {
        const members = membersUp(types, withFields)
        if (!members.length) continue // a method the repo's own types do not declare: inherited from a dependency
        pick = { nodes: members.slice(0, MAX_AMBIGUOUS), conf: 'typed' }
      } else if (!(byName.get(`${from.family}|${r.qtype}`) || []).length) continue // a dependency's type (HashMap, List, Request …)
    }
    // a bare call inside a class is one of its members only where a method reaches its siblings
    // without `this`/`self` (Java, Kotlin, C#, Swift, C++, Ruby); in Python, JavaScript, PHP or Rust
    // a bare name is a module-level function or an import, never the class's method
    if (!pick && (SELF.test(qual) || (!qual && selfType && IMPLICIT_SELF.has(from.family)))) {
      const own = selfType ? membersUp([selfType], withFields) : []
      if (own.length) pick = { nodes: own, conf: 'same-class' }
      else if (SELF.test(qual)) pick = pickBy(guess.filter((c) => c.parent_id && nodeById.get(c.parent_id) && CLASSY.has(nodeById.get(c.parent_id).kind)), [['same-file', (c) => c.file_id === from.id]])
    }
    if (!pick && qual && !SELF.test(qual)) {
      const q = b.quals.get(qHead) || b.quals.get(qual)
      // `console.error`, `window.open`, `JSON.parse(…).x()`: the runtime's own objects are a dependency
      if (!q && from.family === 'js' && JS_GLOBALS.has(qHead.replace(/[?!\s]+$/, ''))) continue
      if (q) {
        if (q.external) continue
        const hit = inFiles(cands, q.files)
        const members = cands.filter((c) => { const p = c.parent_id && nodeById.get(c.parent_id); return p && p.name === qLast && q.files.some((f) => f.id === p.file_id) })
        if (members.length) pick = { nodes: members, conf: 'qualified' }
        else if (hit.length) pick = { nodes: hit.slice(0, MAX_AMBIGUOUS), conf: 'import' }
      }
      else if (startsInDependency(qual, from.family)) continue
      if (!pick) {
        const types = classesNamed(from.family, qLast)
        const members = types.length ? membersUp(types, withFields) : []
        if (members.length) pick = { nodes: members.slice(0, MAX_AMBIGUOUS), conf: members.length === 1 || types.length === 1 ? 'qualified' : 'ambiguous' }
        else if (/^[A-Z]/.test(qLast) && !types.length && !/[.(]/.test(qual)) continue // a type the repo does not define: a dependency
        // `Story.where(…)`, `Hat.active`: a repository type that declares no such member, itself or up
        // its supertypes, inherits it from a framework; another type's member of that name is not it
        else if (types.length && /^\p{Lu}/u.test(qLast) && !/[(\[]/.test(qual)) continue
      }
      if (!pick) {
        // `x.len()`, `seen.has(k)`: an untyped receiver calling a standard-library name is that library's
        // method far more often than the repository's one definition of the name. A receiver the syntax
        // constructs from a repository type (`Store::new().len()`) is that type's.
        if (COMMON_METHODS[from.family]?.has(name)) {
          const own = SELF_CLASS.test(qual) && selfType ? membersUp([selfType], cands) : []
          const t = own.length ? null : constructedType(qual, from.family)
          const members = own.length ? own : t ? membersUp(classesNamed(from.family, t), cands) : []
          if (!members.length) continue
          pick = { nodes: members.slice(0, MAX_AMBIGUOUS), conf: own.length ? 'same-class' : 'typed' }
        }
      }
      if (!pick) {
        // a receiver of unknown type: by name, in this file, else an imported one (a name guess: the
        // import binds the file, not the receiver: `x.save()` is any `save` the file can see). A field of this
        // object (`this.svc.findAll()`, `self.repo.save()`; not a call chain, `self.filter(…).save()`,
        // which is the object's own) holds another object: never this class's own method of that name,
        // never the caller itself (Nest, Spring and Django delegation would read as self-recursion and
        // hide the real callee's callers). Where that guard removed a candidate, the name decides
        // nothing: the call stays an unlinked site rather than a guess at another class's method.
        const ownField = /^(this|self|@)[.>-]*[\p{L}_$][\p{L}\p{N}_$]*$/u.test(qual) || (/^(this|self)\??\.[\p{L}_$]/u.test(qual) && !qual.includes('('))
        const methods = guess.filter((c) => c.kind === 'method' || c.kind === 'constructor' || (c.parent_id && CLASSY.has(nodeById.get(c.parent_id)?.kind)))
        const kept = methods.filter((c) => !(srcNode && c.id === srcNode.id) && !(ownField && selfType && c.parent_id === selfType.id))
        pick = pickBy(kept, [['same-file', (c) => c.file_id === from.id], ['import-guess', (c) => b.files.has(c.file_id)]], kept.length < methods.length ? () => false : undefined, variantOf, prodGuess)
      }
    }
    if (!pick && !qual) {
      // a JavaScript name whose import names a repository file is that file's (or what it passes on):
      // where it defines nothing callable by the name, the call stays unlinked, never a guess elsewhere
      const imported = from.family === 'js' && bound && bound.files.length > 0
      // `Error(…)`, `Promise(…)`, `fetch(…)`: the runtime's, unless the file defines one of the name
      const builtin = from.family === 'js' && !bound && JS_BUILTINS.has(name)
      pick = pickBy(guess, [
        ['import', (c) => boundFiles && boundFiles.some((f) => f.id === c.file_id)],
        ...(builtin ? [['same-file', (c) => c.file_id === from.id && nestedFor(srcNode, c)], ['same-file', (c) => c.file_id === from.id && !c.parent_id]] : []),
        ...(imported || builtin ? [] : [
          // a function of this file: a closure of a definition enclosing the caller (it shadows the
          // file's own of that name), else top-level
          ['same-file', (c) => c.file_id === from.id && nestedFor(srcNode, c)],
          ['same-file', (c) => c.file_id === from.id && !c.parent_id],
          ['import', (c) => b.files.has(c.file_id) && !c.parent_id],
          ['same-package', (c) => fileById.get(c.file_id).dir === from.dir && !c.parent_id && /^(go|jvm|swift|csharp)$/.test(from.family)],
        ]),
      ], imported || builtin ? () => false : (c) => !c.parent_id || CLASSY.has(c.kind), variantOf, (c) => prodGuess(c) && c.kind !== 'method')
    }
    if (!pick) continue
    stats.resolved++
    const src = srcNode ? srcNode.id : from.node_id
    for (const c of pick.nodes) emit(src, c.id, 'CALLS', pick.conf, r.line)
  }
  if (contractRefs.length) { const sig = db.prepare('SELECT signature FROM nodes WHERE id = ?'); const sel = linkContracts({ refs: contractRefs, nodes, nodeById, byName, fileById, bindOf: (fid) => bind.get(fid), emit, signatureOf: (id) => sig.get(id)?.signature || '' }); if (sel) { stats.calls += sel.calls; stats.resolved += sel.resolved } }
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)").run(`calls:${repo}`, JSON.stringify(stats))
}

// First rule that matches wins; otherwise a unique candidate, otherwise ≤ MAX_AMBIGUOUS of them.
// groupOf: candidates that are one definition (its platform variants) count once, and are all kept.
// linkable: which of the name's candidates a guess may link (all of them count)
function pickBy(cands, rules, fallbackFilter = () => true, groupOf = (c) => c.id, linkable = () => true) {
  if (!cands.length) return null
  const groups = (xs) => new Set(xs.map(groupOf)).size
  for (const [conf, test] of rules) {
    const hit = cands.filter(test)
    if (hit.length) { const g = groups(hit); return { nodes: g === hit.length ? hit.slice(0, MAX_AMBIGUOUS) : g <= MAX_AMBIGUOUS ? hit : hit.slice(0, MAX_AMBIGUOUS), conf: g === 1 ? conf : 'ambiguous' } }
  }
  const rest = cands.filter(fallbackFilter), g = groups(rest), nodes = rest.filter(linkable)
  if (!nodes.length) return null
  if (g === 1) return { nodes, conf: 'unique-name' }
  if (g > 1 && g <= MAX_AMBIGUOUS) return { nodes, conf: 'ambiguous' }
  return null
}
