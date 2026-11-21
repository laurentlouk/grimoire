// grimoire graph · JavaScript and TypeScript module resolution: an import's specifier → the files it
// loads, the way the project's own bundler and compiler would find them, from what the repository's
// files state (no node_modules is read):
//   relative     `./x`, `../x/y`: the file with a code extension (`./x.js` naming x.ts too), the folder's
//                index, and every platform variant beside it (x.ios.tsx, x.android.tsx, x.native.tsx,
//                x.web.tsx, plus any suffix a tsconfig's `moduleSuffixes` adds), all of them; a file
//                with another extension (`./logo.png`, `./data.json`, `./schema.sql`) is that file,
//                indexed or not. A dotted name (`./config.base`, `./x.types`) keeps its dots.
//   aliases      the nearest tsconfig.json / jsconfig.json's `paths` (with `baseUrl` and relative
//                `extends`), the nearest babel config's module-resolver `alias` and `root` (when the
//                config holds them as literals), a package.json's `imports` (`#x`)
//   workspaces   a workspace package by its `name` (pnpm-workspace.yaml, package.json `workspaces`,
//                lerna.json; every package under an nx.json), through its `exports` (a string, subpaths,
//                patterns, conditions), else `source` / `types` / `main`; a target in build output
//                (`./dist/x.d.ts`) is mapped to its source (`./src/x.ts`) when that is the indexed file
//   fallback     `@/x`, `~/x`, `#/x` that no config maps: the file or folder whose path ends with x,
//                nearest to the importer first
// The answer: { files (indexed files), outside (true: the path names a file of the repository the index
// does not hold, an image, a JSON file) }. resolve.moduleOf(fileId): the module a file is one variant
// of (`a/Button` for a/Button.ios.tsx, or for a/Button.mobile.tsx found through `moduleSuffixes`).
import { readFileSync } from 'node:fs'
import path from 'node:path'

const P = path.posix
const JS_EXT = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/
export const PLATFORMS = ['.ios', '.android', '.native', '.web']
const PLATFORM = /\.(ios|android|native|web)$/
// a module's path with its code extension and platform suffix gone: `a/Button.ios.tsx` → `a/Button`
export const platformBase = (p) => p.replace(JS_EXT, '').replace(PLATFORM, '')
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.expo|coverage)\//
export const CONFIG = /(^|\/)(tsconfig\.json|jsconfig\.json|package\.json|pnpm-workspace\.yaml|lerna\.json|nx\.json|babel\.config\.(js|cjs|mjs|json)|\.babelrc(\.js|\.cjs|\.json)?)$/

// JSON with comments and trailing commas (tsconfig's own dialect); null when it does not parse.
export function jsonc(t) {
  if (t == null) return null
  let out = '', i = 0
  while (i < t.length) {
    const c = t[i]
    if (c === '"') { let j = i + 1; while (j < t.length && t[j] !== '"') j += t[j] === '\\' ? 2 : 1; out += t.slice(i, j + 1); i = j + 1 }
    else if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++ }
    else if (c === '/' && t[i + 1] === '*') { const j = t.indexOf('*/', i + 2); i = j < 0 ? t.length : j + 2 }
    else { out += c; i++ }
  }
  try { return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1')) } catch { return null }
}
const strings = (v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
const globRe = (g) => new RegExp(`^${g.replace(/^\.\//, '').replace(/\/+$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`)
const inside = (p) => p !== '..' && !p.startsWith('../') && !p.startsWith('/')

export function jsModules({ files, paths, abs }) {
  const add = (m, k, v) => { const a = m.get(k); if (a) { if (!a.includes(v)) a.push(v) } else m.set(k, [v]) }
  const byKey = new Map() // path with its code extension gone → JS files
  const byPath = new Map() // repository path → indexed file, any language
  const byTail = new Map() // a module's last segment → module paths (platform suffix and /index gone)
  for (const f of files) {
    byPath.set(f.path, f)
    if (f.family !== 'js') continue
    add(byKey, f.path.replace(JS_EXT, ''), f)
    let mod = platformBase(f.path)
    if (P.basename(mod) === 'index') mod = P.dirname(mod)
    if (mod !== '.') add(byTail, P.basename(mod), mod)
  }
  const all = new Set(paths)
  const moduleOf = new Map()
  const read = (p) => { try { return readFileSync(path.join(abs, p), 'utf8') } catch { return null } }
  const configs = paths.filter((p) => CONFIG.test(p) && !SKIP.test(p))
  const at = (name) => new Map(configs.filter((p) => P.basename(p) === name || (name === 'babel' && /^(babel\.config\.|\.babelrc)/.test(P.basename(p)))).map((p) => [P.dirname(p), p]))
  const nearest = (map, dir, cache) => {
    if (cache.has(dir)) return cache.get(dir)
    const v = map.has(dir) ? dir : dir === '.' || dir === '' ? null : nearest(map, P.dirname(dir), cache)
    cache.set(dir, v)
    return v
  }

  // ── tsconfig.json / jsconfig.json: paths, baseUrl, moduleSuffixes, through relative `extends` ──
  const tsFiles = new Map([...at('tsconfig.json'), ...[...at('jsconfig.json')].filter(([d]) => !at('tsconfig.json').has(d))])
  const tsMemo = new Map()
  const tsAt = (p, depth = 0) => {
    if (tsMemo.has(p)) return tsMemo.get(p)
    tsMemo.set(p, null)
    const j = jsonc(read(p)), dir = P.dirname(p)
    let cfg = { paths: null, pathsDir: null, baseUrl: null, suffixes: null }
    if (j && depth < 6) {
      for (const e of [].concat(j.extends || [])) {
        if (typeof e !== 'string' || !e.startsWith('.')) continue // a package's config: in node_modules
        let q = P.normalize(P.join(dir, e))
        if (!all.has(q) && all.has(q + '.json')) q += '.json'
        const up = inside(q) ? tsAt(q, depth + 1) : null
        if (up) cfg = { ...cfg, ...Object.fromEntries(Object.entries(up).filter(([, v]) => v != null)) }
      }
      const co = j.compilerOptions || {}
      if (typeof co.baseUrl === 'string') cfg.baseUrl = P.normalize(P.join(dir, co.baseUrl))
      if (co.paths && typeof co.paths === 'object') { cfg.paths = co.paths; cfg.pathsDir = dir }
      if (Array.isArray(co.moduleSuffixes)) cfg.suffixes = co.moduleSuffixes.filter((x) => typeof x === 'string' && x)
    }
    tsMemo.set(p, cfg)
    return cfg
  }
  const tsCache = new Map()
  const tsFor = (dir) => { const d = nearest(tsFiles, dir, tsCache); return d === null ? null : tsAt(tsFiles.get(d)) }

  // ── babel module-resolver: alias and root, when written as literals ──
  const babelFiles = at('babel')
  const babelMemo = new Map(), babelCache = new Map()
  const babelAt = (p) => {
    if (babelMemo.has(p)) return babelMemo.get(p)
    const t = read(p) || '', dir = P.dirname(p)
    const cfg = { alias: [], roots: [] }
    const mr = t.indexOf('module-resolver')
    if (mr >= 0) {
      const body = t.slice(mr)
      const obj = (key) => { const m = new RegExp(`\\b${key}\\s*['"]?\\s*:\\s*([[{])`).exec(body); if (!m) return null; const open = m.index + m[0].length - 1, close = m[1] === '{' ? '}' : ']'; let d = 0; for (let i = open; i < body.length; i++) { if (body[i] === m[1]) d++; else if (body[i] === close && --d === 0) return body.slice(open + 1, i) } return null }
      const a = obj('alias')
      if (a) for (const m of a.matchAll(/(['"]?)([^'"\s:,{}[\]]+)\1\s*:\s*(['"])([^'"]+)\3/g)) if (!m[2].startsWith('^')) cfg.alias.push({ key: m[2], target: P.normalize(P.join(dir, m[4])) })
      const r = obj('root')
      if (r) for (const m of r.matchAll(/(['"])([^'"]+)\1/g)) cfg.roots.push(P.normalize(P.join(dir, m[2])))
    }
    babelMemo.set(p, cfg)
    return cfg
  }
  const babelFor = (dir) => { const d = nearest(babelFiles, dir, babelCache); return d === null ? null : babelAt(babelFiles.get(d)) }

  // ── package.json: subpath imports (`#x`) and the workspace's packages ──
  const pkgFiles = at('package.json')
  const pkgMemo = new Map(), pkgCache = new Map()
  const pkgAt = (dir) => { if (!pkgMemo.has(dir)) pkgMemo.set(dir, jsonc(read(pkgFiles.get(dir)))); return pkgMemo.get(dir) }
  const pkgFor = (dir) => { const d = nearest(pkgFiles, dir, pkgCache); return d === null ? null : { dir: d, json: pkgAt(d) } }
  const workspaces = [] // { root, globs }
  for (const [d, p] of at('pnpm-workspace.yaml')) {
    const t = read(p) || '', m = /^packages\s*:\s*\n((?:[ \t]*(?:-.*|#.*)?\n?)*)/m.exec(t)
    const globs = m ? [...m[1].matchAll(/^[ \t]*-\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/gm)].map((x) => x[1]) : []
    if (globs.length) workspaces.push({ root: d, globs })
  }
  for (const [d] of pkgFiles) {
    const ws = pkgAt(d)?.workspaces
    const globs = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : []
    if (globs.length) workspaces.push({ root: d, globs: globs.filter((g) => typeof g === 'string') })
  }
  for (const [d, p] of at('lerna.json')) { const g = jsonc(read(p))?.packages; if (Array.isArray(g)) workspaces.push({ root: d, globs: g.filter((x) => typeof x === 'string') }) }
  for (const [d] of at('nx.json')) workspaces.push({ root: d, globs: ['**'] })
  const packages = new Map() // name → { dir, json }
  for (const w of workspaces) {
    const yes = w.globs.filter((g) => !g.startsWith('!')).map(globRe), no = w.globs.filter((g) => g.startsWith('!')).map((g) => globRe(g.slice(1)))
    for (const [d] of pkgFiles) {
      if (d === w.root) continue
      const rel = w.root === '.' ? d : d.startsWith(w.root + '/') ? d.slice(w.root.length + 1) : null
      if (rel === null || !yes.some((re) => re.test(rel)) || no.some((re) => re.test(rel))) continue
      const json = pkgAt(d)
      if (json && typeof json.name === 'string' && !packages.has(json.name)) packages.set(json.name, { dir: d, json })
    }
  }

  // ── a path → its files ──
  const suffixesFor = (dir) => { const ts = tsFor(dir); return ts && ts.suffixes ? [...new Set([...PLATFORMS, ...ts.suffixes])] : PLATFORMS }
  const none = { files: [], outside: false }
  const look = (p, sfx) => {
    p = P.normalize(p).replace(/\/+$/, '')
    if (!inside(p) || p === '.' || !p) return none
    const key = JS_EXT.test(p) ? p.replace(JS_EXT, '') : p
    const group = (k) => { const base = (byKey.get(k) || []).slice(0, 1); return [...base, ...sfx.flatMap((s) => (byKey.get(k + s) || []).slice(0, 1))] }
    let files = group(key), mod = key
    if (!files.length) { mod = P.join(p, 'index'); files = group(mod) }
    if (files.length > 1) for (const f of files) moduleOf.set(f.id, mod)
    if (files.length) return { files, outside: false }
    if (byPath.has(p)) return { files: [byPath.get(p)], outside: false } // a file of another kind the index holds (`.sql`)
    return all.has(p) ? { files: [], outside: true } : none
  }
  const first = (...tries) => { let outside = false; for (const t of tries) { const r = t(); if (r.files.length) return r; outside ||= r.outside } return { files: [], outside } }
  // a pattern table (tsconfig paths, package imports, exports): the longest matching key, its targets
  const matchKey = (keys, s) => {
    let best = null
    for (const k of keys) {
      const i = k.indexOf('*')
      if (i < 0) { if (k === s && (!best || k.length > best.pre.length)) best = { k, pre: k, star: null }; continue }
      const pre = k.slice(0, i), post = k.slice(i + 1)
      if (s.length >= pre.length + post.length && s.startsWith(pre) && s.endsWith(post) && (!best || pre.length > best.pre.length)) best = { k, pre, star: s.slice(pre.length, s.length - post.length) }
    }
    return best
  }
  const fill = (t, star) => (star === null ? t : t.replaceAll('*', star))
  // a package target, mapped back to source when it points at build output
  const leaf = (dir, t, sfx) => {
    const p = P.normalize(P.join(dir, t))
    const r = look(p.replace(/\.d\.[mc]?ts$/, ''), sfx)
    if (r.files.length) return r
    const src = p.replace(/(^|\/)(dist|build|lib|out|esm|cjs|types)\//, '$1src/').replace(/\.d\.[mc]?ts$|\.[mc]?js$/, '')
    return src !== p ? look(src, sfx) : r
  }
  const packageFiles = (pkg, sub, sfx) => {
    const ex = pkg.json.exports
    if (ex != null) {
      const map = typeof ex === 'string' || Array.isArray(ex) || !Object.keys(ex).some((k) => k.startsWith('.')) ? { '.': ex } : ex
      const m = matchKey(Object.keys(map), sub ? `./${sub}` : '.')
      if (!m) return none
      const rs = strings(map[m.k]).map((t) => leaf(pkg.dir, fill(t, m.star), sfx))
      const files = [...new Set(rs.flatMap((r) => r.files))]
      return { files, outside: !files.length && rs.some((r) => r.outside) }
    }
    if (sub) return first(() => look(P.join(pkg.dir, sub), sfx), () => look(P.join(pkg.dir, 'src', sub), sfx))
    const fields = ['source', 'react-native', 'types', 'typings', 'module', 'main'].map((k) => pkg.json[k]).filter((v) => typeof v === 'string')
    return first(...fields.map((t) => () => leaf(pkg.dir, t, sfx)), () => look(P.join(pkg.dir, 'index'), sfx), () => look(P.join(pkg.dir, 'src/index'), sfx))
  }
  // `@/x` that no config maps: the module whose path ends with x, nearest to the importer
  const byEnding = (from, tail, sfx) => {
    const segs = tail.split('/').filter(Boolean)
    if (!segs.length) return none
    const mods = (byTail.get(segs[segs.length - 1]) || []).filter((m) => m === tail || m.endsWith('/' + tail))
    const common = (m) => { const a = from.path.split('/'), b = m.split('/'); let i = 0; while (i < a.length && a[i] === b[i]) i++; return i }
    mods.sort((x, y) => common(y) - common(x) || x.length - y.length)
    return mods.length ? look(mods[0], sfx) : none
  }

  const resolveJs = (from, s) => {
    const sfx = suffixesFor(from.dir)
    if (s.startsWith('.')) return look(P.join(from.dir, s), sfx)
    if (s.startsWith('/') || /^[a-z][\w+.-]*:/i.test(s)) return none // an absolute path, `node:fs`, a URL
    const tries = []
    const ts = tsFor(from.dir)
    if (ts && ts.paths) {
      const m = matchKey(Object.keys(ts.paths), s)
      if (m) { const base = ts.baseUrl ?? ts.pathsDir; for (const t of strings(ts.paths[m.k])) tries.push(() => look(P.join(base, fill(t, m.star)), sfx)) }
    }
    const babel = babelFor(from.dir)
    if (babel) for (const a of babel.alias) if (s === a.key || s.startsWith(a.key.replace(/\/$/, '') + '/')) tries.push(() => look(a.target + s.slice(a.key.replace(/\/$/, '').length), sfx))
    if (s.startsWith('#')) {
      const pkg = pkgFor(from.dir), imp = pkg?.json?.imports
      if (imp && typeof imp === 'object') { const m = matchKey(Object.keys(imp), s); if (m) for (const t of strings(imp[m.k])) tries.push(() => leaf(pkg.dir, fill(t, m.star), sfx)) }
    }
    const parts = s.split('/'), name = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    const pkg = packages.get(name)
    if (pkg) tries.push(() => packageFiles(pkg, s.slice(name.length + 1), sfx))
    if (ts && ts.baseUrl) tries.push(() => look(P.join(ts.baseUrl, s), sfx))
    if (babel) for (const r of babel.roots) tries.push(() => look(P.join(r, s), sfx))
    const alias = /^[@~#]\/(.+)$/.exec(s)
    if (alias) tries.push(() => byEnding(from, alias[1], sfx))
    return first(...tries)
  }
  resolveJs.moduleOf = (id) => moduleOf.get(id) || null
  return resolveJs
}
